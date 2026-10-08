#!/usr/bin/env node
/**
 * The weekly content review — minimized Jev second opinion for the shelf
 * (Kitchen DESIGN.md §4.3.1; TOOL-ROUTING.md `kitchen-jev-openrouter`).
 *
 * Three steps, three verbs, deliberately separable:
 *
 *   export   build the week's batch: the staged web ideas, minimized to
 *            name / servings / ingredient item-amount-unit, privacy-screened,
 *            reusing any result already bound to the exact content hash.
 *            Writes <dir>/<week>/batch.json. No network.
 *   run      send the batch items to the OpenRouter Decisions API, model
 *            typesafe/jev-1.13, through the protected Gateway egress route
 *            ONLY. The process must already carry the Gateway's credential
 *            sentinel (`OPENROUTER_API_KEY` starting `oc-sent-`), its
 *            `HTTPS_PROXY` and its `SSL_CERT_FILE`. Anything else — a raw key,
 *            a missing proxy — is refused before any output or network.
 *            Writes <dir>/<week>/results.json. Never logs auth.
 *   import   validate each result against its request hash, provider, model
 *            and answer set, persist the bound reviews and the run's usage
 *            into the app database, and write <dir>/<week>/import.json.
 *
 * `scripts/prepare-weekly-shelf.mjs` calls `prepareWeeklyReview`, which
 * exports, then runs + imports only when the Gateway context is present.
 * A scheduled run on this Mac has no Gateway context (OpenClaw cron command
 * payloads spawn without the secret sentinel), so it leaves the batch on
 * disk, records the pending state, and the shelf is prepared with its
 * unreviewed ideas labelled as such. The parent executes `run` and `import`
 * under Gateway exec; a later preparation or watchdog then picks the bound
 * reviews up from the database. No key is copied anywhere.
 *
 *   node scripts/review-planner-candidates.mjs export --week 2026-W42
 *   node scripts/review-planner-candidates.mjs run    --week 2026-W42     # Gateway exec only
 *   node scripts/review-planner-candidates.mjs import --week 2026-W42
 *   node scripts/review-planner-candidates.mjs import-sweep                # reuse the Jev v2 audit results
 *
 * Flags: --week <YYYY-Www>, --dir <path> (default <app>/.planner-review),
 *        --env <path> (default <app>/.env.vercel), --dry-run, --json.
 */

import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  PLANNER_REVIEW_ENDPOINT,
  PLANNER_REVIEW_LIMITS,
  PLANNER_REVIEW_MODEL,
  PLANNER_REVIEW_RUBRIC_SHA256,
  bindReviewResult,
  buildReviewBatch,
  encodeReviewJson,
  minimizeRecipeForReview,
  reviewMatches,
  summarizeReviewUsage,
} from "../src/lib/planner-review.ts";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE_ROOT = path.resolve(APP_DIR, "../../..");
const DEFAULT_DIR = path.join(APP_DIR, ".planner-review");
const DEFAULT_ENV_FILE = path.join(APP_DIR, ".env.vercel");
const V2_AUDIT_DIR = path.join(WORKSPACE_ROOT, "projects/kitchen/audits/jev-category-validation-2026-09-29/v2");

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------------------------
// Gateway context — the only transport
// ---------------------------------------------------------------------------

/**
 * Is this process running under the protected Gateway egress route?
 *
 * The Gateway injects a credential *sentinel* (never the key) plus the proxy
 * that substitutes it on the way out and the CA bundle that proxy presents.
 * All three must be present. A real-looking key in the environment is not a
 * route — it is refused, so a raw key can never become a fallback.
 */
export function gatewayContext(env = process.env) {
  const token = env.OPENROUTER_API_KEY ?? "";
  const proxy = env.HTTPS_PROXY ?? "";
  const cafile = env.SSL_CERT_FILE ?? "";
  const problems = [];
  if (!token) problems.push("OPENROUTER_API_KEY sentinel absent");
  else if (!token.startsWith("oc-sent-") || token.length <= 16) problems.push("OPENROUTER_API_KEY is not a Gateway sentinel (raw keys are refused)");
  let proxyUrl = null;
  try {
    proxyUrl = proxy ? new URL(proxy) : null;
  } catch {
    proxyUrl = null;
  }
  if (!proxyUrl || !["http:", "https:"].includes(proxyUrl.protocol) || !proxyUrl.hostname) problems.push("HTTPS_PROXY (Gateway egress proxy) absent");
  if (!cafile) problems.push("SSL_CERT_FILE (Gateway CA bundle) absent");
  return { ok: problems.length === 0, problems, token: problems.length === 0 ? token : null, proxy: proxyUrl, cafile };
}

// ---------------------------------------------------------------------------
// Database access (same env resolution as prepare-weekly-shelf.mjs)
// ---------------------------------------------------------------------------

async function loadEnv(envFile) {
  const { loadEnvFile } = await import("./prepare-weekly-shelf.mjs");
  try {
    await loadEnvFile(envFile);
  } catch (error) {
    if (!process.env.TURSO_DATABASE_URL && !process.env.NABU_DB_DIR) throw error;
  }
}

async function dbClient() {
  const { getAppDbClient, closeAppDbClient } = await import("./weekly-inspirations.mjs");
  return { client: getAppDbClient(), close: closeAppDbClient };
}

const REVIEWS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS planner_candidate_reviews (
    recipe_id          TEXT NOT NULL,
    content_sha256     TEXT NOT NULL,
    rubric_sha256      TEXT NOT NULL,
    model_requested    TEXT NOT NULL,
    model_resolved     TEXT NOT NULL,
    provider           TEXT NOT NULL,
    request_sha256     TEXT NOT NULL,
    response_sha256    TEXT NOT NULL,
    verdict            TEXT NOT NULL CHECK (verdict IN ('yes', 'no', 'uncertain')),
    interpretation     TEXT NOT NULL,
    answers            TEXT NOT NULL,
    usage              TEXT NOT NULL,
    source             TEXT NOT NULL,
    reviewed_at        TEXT NOT NULL,
    PRIMARY KEY (recipe_id, content_sha256, rubric_sha256)
  )
`;
const RUNS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS planner_review_runs (
    week          TEXT NOT NULL,
    run_id        TEXT NOT NULL,
    started_at    TEXT NOT NULL,
    status        TEXT NOT NULL CHECK (status IN ('succeeded', 'partial', 'failed', 'skipped')),
    calls         INTEGER NOT NULL DEFAULT 0,
    succeeded     INTEGER NOT NULL DEFAULT 0,
    failed        INTEGER NOT NULL DEFAULT 0,
    reused        INTEGER NOT NULL DEFAULT 0,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd      REAL NOT NULL DEFAULT 0,
    over_budget   INTEGER NOT NULL DEFAULT 0,
    detail        TEXT,
    PRIMARY KEY (week, run_id)
  )
`;

async function ensureTables(client) {
  await client.execute(REVIEWS_TABLE_SQL);
  await client.execute(RUNS_TABLE_SQL);
}

function rowToRecord(row) {
  try {
    return {
      recipeId: String(row.recipe_id),
      contentSha256: String(row.content_sha256),
      rubricSha256: String(row.rubric_sha256),
      modelRequested: String(row.model_requested),
      modelResolved: String(row.model_resolved),
      provider: String(row.provider),
      requestSha256: String(row.request_sha256),
      responseSha256: String(row.response_sha256),
      interpretation: JSON.parse(String(row.interpretation)),
      answers: JSON.parse(String(row.answers)),
      usage: JSON.parse(String(row.usage)),
      source: String(row.source),
      reviewedAt: String(row.reviewed_at),
    };
  } catch {
    return null;
  }
}

/** Read-only: an export against a database that has never stored a review must not create tables. */
async function loadExistingReviews(client, recipeIds) {
  const out = new Map();
  if (recipeIds.length === 0) return out;
  const present = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'planner_candidate_reviews'");
  if (present.rows.length === 0) return out;
  for (let offset = 0; offset < recipeIds.length; offset += 200) {
    const chunk = recipeIds.slice(offset, offset + 200);
    const result = await client.execute({
      sql: `SELECT * FROM planner_candidate_reviews WHERE recipe_id IN (${chunk.map(() => "?").join(", ")})`,
      args: chunk,
    });
    for (const row of result.rows) {
      const record = rowToRecord(row);
      if (record) out.set(`${record.recipeId}:${record.contentSha256}`, record);
    }
  }
  return out;
}

async function saveReviews(client, records) {
  await ensureTables(client);
  for (const record of records) {
    await client.execute({
      sql: `INSERT INTO planner_candidate_reviews
              (recipe_id, content_sha256, rubric_sha256, model_requested, model_resolved, provider, request_sha256, response_sha256, verdict, interpretation, answers, usage, source, reviewed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (recipe_id, content_sha256, rubric_sha256) DO UPDATE SET
              model_resolved = excluded.model_resolved, provider = excluded.provider,
              request_sha256 = excluded.request_sha256, response_sha256 = excluded.response_sha256,
              verdict = excluded.verdict, interpretation = excluded.interpretation, answers = excluded.answers,
              usage = excluded.usage, source = excluded.source, reviewed_at = excluded.reviewed_at`,
      args: [
        record.recipeId, record.contentSha256, record.rubricSha256, record.modelRequested, record.modelResolved,
        record.provider, record.requestSha256, record.responseSha256, record.interpretation.verdict,
        JSON.stringify(record.interpretation), JSON.stringify(record.answers), JSON.stringify(record.usage),
        record.source, record.reviewedAt,
      ],
    });
  }
}

async function saveRun(client, run) {
  await ensureTables(client);
  await client.execute({
    sql: `INSERT INTO planner_review_runs
            (week, run_id, started_at, status, calls, succeeded, failed, reused, input_tokens, output_tokens, cost_usd, over_budget, detail)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (week, run_id) DO UPDATE SET
            status = excluded.status, calls = excluded.calls, succeeded = excluded.succeeded, failed = excluded.failed,
            reused = excluded.reused, input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
            cost_usd = excluded.cost_usd, over_budget = excluded.over_budget, detail = excluded.detail`,
    args: [
      run.week, run.runId, run.startedAt, run.status, run.usage.calls, run.usage.succeeded, run.usage.failed,
      run.usage.reused, run.usage.inputTokens, run.usage.outputTokens, run.usage.costUsd, run.usage.overBudget ? 1 : 0,
      run.detail ?? null,
    ],
  });
}

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

/** The week's staged web ideas, as review candidates. Reads the same rows the shelf reads. */
async function stagedWebCandidates(client, week) {
  const rows = await client.execute({ sql: "SELECT recipe_id FROM web_recipe_inspirations WHERE week = ?", args: [week] });
  const candidates = [];
  for (const row of rows.rows) {
    const recipeId = String(row.recipe_id ?? "");
    if (!recipeId) continue;
    const data = await client.execute({ sql: "SELECT data FROM recipes WHERE id = ?", args: [recipeId] });
    if (data.rows.length === 0) continue;
    let recipe;
    try {
      recipe = JSON.parse(String(data.rows[0].data));
    } catch {
      continue;
    }
    candidates.push({ recipeId, origin: "web", recipe: { name: recipe.name, servings: recipe.servings, ingredients: recipe.ingredients } });
  }
  return candidates;
}

export async function exportBatch({ week, dir, client, candidates }) {
  const pool = candidates ?? (await stagedWebCandidates(client, week));
  const existing = await loadExistingReviews(client, pool.map((c) => c.recipeId));
  const batch = buildReviewBatch({ week, candidates: pool, existing: (id, sha) => existing.get(`${id}:${sha}`) ?? null });
  const weekDir = path.join(dir, week);
  await mkdir(weekDir, { recursive: true });
  const serialized = encodeReviewJson({
    ...batch,
    exportedAt: new Date().toISOString(),
    items: batch.items.map((item) => ({ ...item, requestBytesSha256: sha256(encodeReviewJson(item.request)) })),
  });
  await writeFile(path.join(weekDir, "batch.json"), serialized);
  return {
    file: path.join(weekDir, "batch.json"),
    batchSha256: sha256(serialized),
    items: batch.items.length,
    reused: batch.reused.length,
    excluded: batch.excluded.length,
    needsOwnerReview: batch.needsOwnerReview.length,
    deferred: batch.deferred.length,
    batch,
  };
}

// ---------------------------------------------------------------------------
// run — Gateway exec only
// ---------------------------------------------------------------------------

async function postDecision(item, context, fetchImpl) {
  const body = encodeReviewJson(item.request);
  if (sha256(body) !== item.requestSha256) throw new Error(`request bytes drifted for ${item.recipeId}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PLANNER_REVIEW_LIMITS.requestTimeoutMs);
  try {
    const response = await fetchImpl(PLANNER_REVIEW_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${context.token}`, "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });
    const raw = await response.text();
    if (response.status !== 200) return { ok: false, httpStatus: response.status, errorClass: "HTTPError" };
    return { ok: true, httpStatus: 200, raw, responseSha256: sha256(raw), response: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, httpStatus: null, errorClass: error?.name ?? "Error" };
  } finally {
    clearTimeout(timer);
  }
}

/** Node's fetch honours HTTPS_PROXY/SSL_CERT_FILE only through an explicit dispatcher. */
async function gatewayFetch(context) {
  const { ProxyAgent, fetch: undiciFetch } = await import("undici").catch(() => ({}));
  if (!ProxyAgent || !undiciFetch) {
    throw new Error("undici ProxyAgent unavailable; cannot route through the Gateway egress proxy");
  }
  const { readFileSync } = await import("node:fs");
  const ca = readFileSync(context.cafile, "utf8");
  const dispatcher = new ProxyAgent({ uri: context.proxy.toString(), requestTls: { ca } });
  return (url, init) => undiciFetch(url, { ...init, dispatcher });
}

export async function runBatch({ week, dir, env = process.env, fetchImpl, log = () => {} }) {
  const context = gatewayContext(env);
  if (!context.ok) {
    return { ok: false, refused: true, problems: context.problems };
  }
  const weekDir = path.join(dir, week);
  const batch = JSON.parse(await readFile(path.join(weekDir, "batch.json"), "utf8"));
  if (batch.model !== PLANNER_REVIEW_MODEL || batch.endpoint !== PLANNER_REVIEW_ENDPOINT || batch.rubricSha256 !== PLANNER_REVIEW_RUBRIC_SHA256) {
    throw new Error("batch route/rubric does not match the pinned review contract");
  }
  const doFetch = fetchImpl ?? (await gatewayFetch(context));
  const startedAt = new Date().toISOString();
  const results = [];
  let calls = 0;
  for (const item of batch.items.slice(0, PLANNER_REVIEW_LIMITS.maxCallsPerRun)) {
    let outcome = null;
    for (let attempt = 1; attempt <= PLANNER_REVIEW_LIMITS.maxAttemptsPerItem; attempt++) {
      calls += 1;
      outcome = await postDecision(item, context, doFetch);
      if (outcome.ok) break;
    }
    results.push({
      recipeId: item.recipeId,
      contentSha256: item.contentSha256,
      requestSha256: item.requestSha256,
      ...(outcome.ok
        ? { status: "result", httpStatus: 200, responseSha256: outcome.responseSha256, response: outcome.response, completedAt: new Date().toISOString() }
        : { status: "failed", httpStatus: outcome.httpStatus, errorClass: outcome.errorClass }),
    });
    log(`    review ${item.recipeId}: ${outcome.ok ? "result" : `failed (${outcome.errorClass})`}`);
  }
  const serialized = encodeReviewJson({ week, startedAt, finishedAt: new Date().toISOString(), batchSha256: sha256(await readFile(path.join(weekDir, "batch.json"), "utf8")), calls, results });
  await writeFile(path.join(weekDir, "results.json"), serialized);
  return { ok: true, file: path.join(weekDir, "results.json"), calls, results: results.length, failed: results.filter((r) => r.status === "failed").length };
}

// ---------------------------------------------------------------------------
// import — bind and persist
// ---------------------------------------------------------------------------

export async function importResults({ week, dir, client, results: given, batch: givenBatch, runId = randomUUID(), log = () => {} }) {
  const weekDir = path.join(dir, week);
  const batch = givenBatch ?? JSON.parse(await readFile(path.join(weekDir, "batch.json"), "utf8"));
  const results = given ?? JSON.parse(await readFile(path.join(weekDir, "results.json"), "utf8"));
  const byId = new Map(batch.items.map((item) => [item.recipeId, item]));
  const records = [];
  const rejected = [];
  let failed = 0;
  for (const result of results.results) {
    const item = byId.get(result.recipeId);
    if (!item) {
      rejected.push({ recipeId: result.recipeId, problems: ["result for a recipe that is not in the batch"] });
      continue;
    }
    if (result.status !== "result") {
      failed += 1;
      continue;
    }
    const bound = bindReviewResult({
      recipeId: item.recipeId,
      payload: item.payload,
      response: result.response,
      responseSha256: result.responseSha256,
      requestSha256: result.requestSha256,
      source: "weekly-review",
      reviewedAt: result.completedAt ?? results.finishedAt,
    });
    if (!bound.ok) {
      rejected.push({ recipeId: item.recipeId, problems: bound.problems });
      continue;
    }
    if (bound.record.contentSha256 !== item.contentSha256) {
      rejected.push({ recipeId: item.recipeId, problems: ["content hash drifted between export and import"] });
      continue;
    }
    records.push(bound.record);
  }
  const usage = summarizeReviewUsage({ records, failed, reused: batch.reused?.length ?? 0 });
  const status = records.length === 0 && failed > 0 ? "failed" : failed > 0 || rejected.length > 0 ? "partial" : "succeeded";
  await saveReviews(client, records);
  await saveRun(client, {
    week,
    runId,
    startedAt: results.startedAt ?? new Date().toISOString(),
    status,
    usage,
    detail: rejected.length ? `rejected: ${rejected.map((r) => `${r.recipeId} (${r.problems.join("; ")})`).join(", ")}` : null,
  });
  const summary = { week, runId, status, persisted: records.length, failed, rejected, usage, verdicts: Object.fromEntries(records.map((r) => [r.recipeId, r.interpretation.verdict])) };
  await mkdir(weekDir, { recursive: true });
  await writeFile(path.join(weekDir, "import.json"), encodeReviewJson(summary));
  log(`    review import: ${records.length} bound, ${failed} failed, ${rejected.length} rejected (${status})`);
  return summary;
}

// ---------------------------------------------------------------------------
// import-sweep — reuse the Jev v2 audit results as verified findings
// ---------------------------------------------------------------------------

/**
 * Every per-ID v2 result whose payload hash still matches the minimized
 * content of the current record becomes a bound review. A changed record
 * (different hash) is skipped — it was reviewed as something else. Nothing
 * is sent anywhere.
 */
export async function importSweep({ client, recipes, auditDir = V2_AUDIT_DIR, log = () => {} }) {
  const sources = [
    ["jev-v2-catalog", path.join(auditDir, "catalog/per-id-v2")],
    ["jev-v2-representative", path.join(auditDir, "per-id-v2")],
    ["jev-v2-targeted", path.join(auditDir, "targeted/per-id-v2")],
  ];
  const records = [];
  const skipped = { noRecord: 0, excluded: 0, contentChanged: 0, unbound: 0 };
  for (const [source, folder] of sources) {
    let files = [];
    try {
      files = (await readdir(folder)).filter((f) => f.endsWith(".json"));
    } catch {
      continue;
    }
    for (const file of files) {
      const result = JSON.parse(await readFile(path.join(folder, file), "utf8"));
      if (result.status !== "result") {
        skipped.excluded += 1;
        continue;
      }
      const recipe = await recipes(result.id);
      if (!recipe) {
        skipped.noRecord += 1;
        continue;
      }
      const minimized = minimizeRecipeForReview(recipe);
      if (!minimized.ok || minimized.contentSha256 !== result.payload_sha256) {
        skipped.contentChanged += 1;
        continue;
      }
      const bound = bindReviewResult({
        recipeId: result.id,
        payload: minimized.payload,
        response: result.response,
        responseSha256: result.response_sha256,
        requestSha256: result.request_sha256,
        source,
        reviewedAt: result.completed_at,
      });
      if (!bound.ok) {
        skipped.unbound += 1;
        continue;
      }
      records.push(bound.record);
    }
  }
  // Only persist what is not already there with the same binding.
  const existing = await loadExistingReviews(client, [...new Set(records.map((r) => r.recipeId))]);
  const fresh = records.filter((r) => !reviewMatches(existing.get(`${r.recipeId}:${r.contentSha256}`), { recipeId: r.recipeId, contentSha256: r.contentSha256 }));
  await saveReviews(client, fresh);
  const summary = { bound: records.length, persisted: fresh.length, alreadyPresent: records.length - fresh.length, skipped, verdicts: records.reduce((acc, r) => ({ ...acc, [r.interpretation.verdict]: (acc[r.interpretation.verdict] ?? 0) + 1 }), {}) };
  log(`    sweep reuse: ${summary.bound} bound, ${summary.persisted} persisted`);
  return summary;
}

// ---------------------------------------------------------------------------
// The step prepare-weekly-shelf.mjs calls
// ---------------------------------------------------------------------------

export async function prepareWeeklyReview({ week, outDir = DEFAULT_DIR, dryRun = false, log = () => {}, env = process.env }) {
  const { client, close } = await dbClient();
  try {
    const exported = await exportBatch({ week, dir: outDir, client });
    log(`  review: ${exported.items} to send, ${exported.reused} reused, ${exported.excluded} excluded, ${exported.needsOwnerReview} need owner review → ${exported.file}`);
    const context = gatewayContext(env);
    if (dryRun) {
      return { exported: exported.items, reused: exported.reused, excluded: exported.excluded, state: "exported-dry-run", file: exported.file };
    }
    if (exported.items === 0) {
      return { exported: 0, reused: exported.reused, excluded: exported.excluded, state: "nothing-to-send", file: exported.file };
    }
    if (!context.ok) {
      // The honest scheduled outcome: the batch is on disk for the parent's
      // Gateway execution; this run records that it could not review.
      await saveRun(client, {
        week,
        runId: `pending-${new Date().toISOString().slice(0, 10)}`,
        startedAt: new Date().toISOString(),
        status: "skipped",
        usage: { calls: 0, succeeded: 0, failed: 0, reused: exported.reused, inputTokens: 0, outputTokens: 0, costUsd: 0, overBudget: false },
        detail: `review pending: ${exported.items} item(s) exported; protected Gateway route not available in this runtime (${context.problems.join("; ")})`,
      });
      log(`  review: pending — ${context.problems.join("; ")}. Execute 'run' + 'import' for ${week} under Gateway exec.`);
      return { exported: exported.items, reused: exported.reused, excluded: exported.excluded, state: "pending-gateway-execution", file: exported.file, problems: context.problems };
    }
    const ran = await runBatch({ week, dir: outDir, env, log });
    const imported = await importResults({ week, dir: outDir, client, log });
    return { exported: exported.items, reused: exported.reused, excluded: exported.excluded, state: "reviewed", calls: ran.calls, ...imported };
  } finally {
    await close?.();
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { command: argv[0], week: null, dir: DEFAULT_DIR, envFile: DEFAULT_ENV_FILE, dryRun: false, json: false };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--week") args.week = argv[++i];
    else if (a === "--dir") args.dir = path.resolve(argv[++i]);
    else if (a === "--env") args.envFile = path.resolve(argv[++i]);
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--json") args.json = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!["export", "run", "import", "import-sweep"].includes(args.command)) throw new Error("Usage: review-planner-candidates.mjs <export|run|import|import-sweep> --week YYYY-Www [--dir <path>]");
  if (args.command !== "import-sweep" && !/^\d{4}-W\d{2}$/.test(args.week ?? "")) throw new Error("--week must look like YYYY-Www");
  return args;
}

async function main(argv) {
  const args = parseArgs(argv);
  const log = args.json ? () => {} : (m) => console.log(m);
  if (args.command === "run") {
    // No database, no env file: a run is network only, under Gateway context only.
    const outcome = await runBatch({ week: args.week, dir: args.dir, log });
    if (outcome.refused) {
      console.error(`refused: ${outcome.problems.join("; ")}`);
      return 2;
    }
    console.log(JSON.stringify({ week: args.week, ...outcome }, null, 2));
    return outcome.failed > 0 ? 1 : 0;
  }
  await loadEnv(args.envFile);
  const { client, close } = await dbClient();
  try {
    if (args.command === "export") {
      const out = await exportBatch({ week: args.week, dir: args.dir, client });
      const { batch: _batch, ...summary } = out;
      console.log(JSON.stringify({ week: args.week, ...summary }, null, 2));
      return 0;
    }
    if (args.command === "import") {
      const summary = await importResults({ week: args.week, dir: args.dir, client, log });
      console.log(JSON.stringify(summary, null, 2));
      return summary.status === "failed" ? 1 : 0;
    }
    const { readFile: read } = await import("node:fs/promises");
    const recipes = async (id) => {
      try {
        return JSON.parse(await read(path.join(APP_DIR, "src/data/recipes", `${id}.json`), "utf8"));
      } catch {
        return null;
      }
    };
    const summary = await importSweep({ client, recipes, log });
    console.log(JSON.stringify(summary, null, 2));
    return 0;
  } finally {
    await close?.();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
