#!/usr/bin/env node
/**
 * The weekly shelf ritual, run from David's Mac.
 *
 * Web research is a *local* job. The importer needs a writable image
 * directory, the workspace beside the app, and minutes of outbound scraping —
 * none of which a Vercel function has. Production learned that the expensive
 * way: a released prepare endpoint tried to `execFile` the importer, produced a
 * perfectly healthy twelve-item shelf, and reported `webSelected: 0`.
 *
 * So the handoff is explicit and this script is its one entry point:
 *
 *   1. work out next ISO week (Thursday preparation targets the week ahead)
 *   2. load the app's own env file — production Turso + Blob — without ever
 *      printing a value
 *   3. run the Kitchen importer editorial-first, writing images, My Recipes
 *      rows, and `web_recipe_inspirations` week provenance
 *   4. verify from the database that qualified web ideas were actually staged
 *   5. call the trusted `/api/meals/prepare` endpoint with the runtime token,
 *      read natively out of the macOS Keychain
 *   6. verify the stored shelf: 12–14 combined ideas, healthy, and — the whole
 *      point — `webSelected > 0`
 *
 * Safe to re-run. The importer refuses duplicate URLs and titles, provenance is
 * upserted rather than appended, and preparation takes a DB-level claim; a
 * second run that finds the claim already taken falls back to verifying the
 * stored shelf instead of treating it as a failure.
 *
 * The runtime token is never printed, never written anywhere, and never passed
 * on a command line — only the name of the source it came from is shown.
 *
 * Usage:
 *   node scripts/prepare-weekly-shelf.mjs
 *   node scripts/prepare-weekly-shelf.mjs --week 2026-W34
 *   node scripts/prepare-weekly-shelf.mjs --dry-run
 *   node scripts/prepare-weekly-shelf.mjs --skip-import   # re-verify + prepare only
 *
 * Flags:
 *   --week <YYYY-Www>  target week. Default: next ISO week.
 *   --count <n>        ideas to ask the importer for. Default: 8.
 *   --base-url <url>   default https://app.davideberle.com
 *   --env <path>       default <app>/.env.vercel
 *   --skip-import      skip step 3; verify what is already staged, then prepare.
 *   --dry-run          do everything read-only: no import, no prepare call.
 *   --json             print one machine-readable result object.
 *
 * The env flag is `--env`, not `--env-file`, and there is deliberately no
 * `--env-file` alias: Node reserves that name and consumes it *before* argv
 * reaches this script, even when it is written after the script path. A
 * mistyped path under the old name never got here — Node exited 9 with
 * `node: <path>: not found` — so the friendly "run `vercel env pull` first"
 * error could not fire. Under `--env` it does.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { classifyPlannerRole } from "../src/lib/planner-roles.ts";

const execFileAsync = promisify(execFile);

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE_ROOT = path.resolve(APP_DIR, "../../..");

const DEFAULT_BASE_URL = "https://app.davideberle.com";
const DEFAULT_ENV_FILE = path.join(APP_DIR, ".env.vercel");
const DEFAULT_COUNT = 8;

/** The combined shelf contract: 12 minimum, 14 the most that is useful. */
const SHELF_MIN = 12;
const SHELF_MAX = 14;

/** Credentials the staging half needs. Presence is checked; values are not shown. */
const REQUIRED_ENV = ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "BLOB_READ_WRITE_TOKEN"];

const MIN_TOKEN_LENGTH = 20;
const KEYCHAIN_SERVICE = "nabu-companion-app-runtime-token";
const KEYCHAIN_ACCOUNT = "assistant@davideberle.com";
const SECURITY_BIN = "/usr/bin/security";
const KEYCHAIN_TIMEOUT_MS = 10_000;
const SECRET_FILE = path.join(WORKSPACE_ROOT, "secrets/companion-app-runtime-token.txt");

// ---------------------------------------------------------------------------
// Week
// ---------------------------------------------------------------------------

export function isoWeekId(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * The week Thursday preparation targets: the one after the current week.
 *
 * Computed by adding seven days and re-deriving the ISO week rather than by
 * incrementing the week number, so 52/53-week years and the year boundary come
 * out right without a special case.
 */
export function nextIsoWeekId(now = new Date()) {
  return isoWeekId(new Date(now.getTime() + 7 * 86_400_000));
}

// ---------------------------------------------------------------------------
// Environment — names may be logged, values never
// ---------------------------------------------------------------------------

/**
 * Parse a `KEY=value` env file.
 *
 * Deliberately small: this reads the file the Vercel CLI already wrote, not an
 * arbitrary shell script. `export ` prefixes, `#` comments, and single or
 * double quoting are handled; nothing is interpolated.
 */
export function parseEnvFile(text) {
  const out = new Map();
  for (const rawLine of String(text).split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.replace(/^export\s+/, "").match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out.set(match[1], value);
  }
  return out;
}

/**
 * Load the app env file into `process.env`.
 *
 * The file wins over whatever happens to be exported in the shell. That is the
 * opposite of dotenv's default and it is the right way round here: the ritual's
 * job is to talk to *production* Turso and Blob, and a stale local
 * `TURSO_DATABASE_URL` left over from a dev session would otherwise silently
 * stage the week into a file database nobody reads.
 *
 * Returns the key *names* only.
 */
export async function loadEnvFile(file, env = process.env) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch {
    throw new Error(
      `Could not read ${file}. Run \`vercel env pull .env.vercel\` in the app directory first.`,
    );
  }
  const parsed = parseEnvFile(text);
  const overridden = [];
  for (const [key, value] of parsed) {
    if (env[key] !== undefined && env[key] !== value) overridden.push(key);
    env[key] = value;
  }
  return { loaded: [...parsed.keys()], overridden };
}

/** Host of a database URL, for a log line that identifies it without leaking it. */
function describeDbUrl(url) {
  if (!url) return "(unset)";
  try {
    const parsed = new URL(url);
    return parsed.protocol === "file:" ? `file:${path.basename(parsed.pathname)}` : parsed.host;
  } catch {
    return "(unparseable)";
  }
}

// ---------------------------------------------------------------------------
// Trusted-runtime credential — resolved, never printed
// ---------------------------------------------------------------------------

function firstLine(text) {
  return typeof text === "string" ? text.split("\n")[0].trim() : "";
}

/**
 * Read the trusted-runtime token from the macOS Keychain.
 *
 * `security` gets only the service and account on argv, and returns the
 * password on stdout, so the secret is never a command-line argument and never
 * appears in a process listing. Only stderr is ever quoted back in an error.
 */
export async function readKeychainSecret({
  service = KEYCHAIN_SERVICE,
  account = KEYCHAIN_ACCOUNT,
  securityBin = SECURITY_BIN,
} = {}) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      securityBin,
      ["find-generic-password", "-s", service, "-a", account, "-w"],
      { encoding: "utf8", timeout: KEYCHAIN_TIMEOUT_MS, maxBuffer: 64 * 1024 },
    ));
  } catch (error) {
    // 44 = errSecItemNotFound; ENOENT = no `security` binary, i.e. not macOS.
    if (error?.code === 44 || error?.code === "ENOENT") return null;
    const detail =
      firstLine(error?.stderr) ||
      (error?.killed ? `timed out after ${KEYCHAIN_TIMEOUT_MS} ms` : `exit ${error?.code}`);
    throw new Error(`macOS Keychain lookup for ${service}/${account} failed: ${detail}`);
  }

  const token = stdout.trim();
  if (!token) return null;
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `The macOS Keychain entry ${service}/${account} is shorter than the minimum ` +
        "length the server accepts; the server would fail closed. Fix the secret, do not print it.",
    );
  }
  return token;
}

/**
 * Resolve the trusted-runtime token: env, then file, then the Keychain — which
 * is where the production credential actually lives on this machine.
 *
 * Returns `{ token, source }` where `source` is safe to print and the token is
 * not.
 */
export async function resolveRuntimeToken({
  env = process.env,
  platform = process.platform,
  secretFile = SECRET_FILE,
  keychain = readKeychainSecret,
} = {}) {
  const inline = env.TRUSTED_RUNTIME_TOKEN;
  if (typeof inline === "string" && inline.trim().length >= MIN_TOKEN_LENGTH) {
    return { token: inline.trim(), source: "env:TRUSTED_RUNTIME_TOKEN" };
  }
  if (typeof inline === "string" && inline.trim().length > 0) {
    throw new Error(
      "TRUSTED_RUNTIME_TOKEN is set but shorter than the minimum length the server " +
        "accepts; the server would fail closed. Fix the secret, do not print it.",
    );
  }

  for (const file of [env.TRUSTED_RUNTIME_TOKEN_FILE, secretFile].filter(Boolean)) {
    let raw;
    try {
      raw = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const token = raw.trim();
    if (token.length < MIN_TOKEN_LENGTH) {
      throw new Error(
        `Credential file ${file} is empty or too short; the server would fail closed. ` +
          "Fix the secret, do not print it.",
      );
    }
    return { token, source: `file:${file}` };
  }

  if (platform === "darwin") {
    const service = env.TRUSTED_RUNTIME_TOKEN_KEYCHAIN_SERVICE || KEYCHAIN_SERVICE;
    const account = env.TRUSTED_RUNTIME_TOKEN_KEYCHAIN_ACCOUNT || KEYCHAIN_ACCOUNT;
    const token = await keychain({ service, account });
    if (token) return { token, source: `keychain:${service}/${account}` };
  }

  throw new Error(
    "No trusted-runtime credential found. Set TRUSTED_RUNTIME_TOKEN, set " +
      `TRUSTED_RUNTIME_TOKEN_FILE, place the token in ${secretFile}` +
      (platform === "darwin"
        ? `, or store it in the macOS Keychain as ${KEYCHAIN_SERVICE}/${KEYCHAIN_ACCOUNT}.`
        : " (the macOS Keychain fallback is unavailable on this platform)."),
  );
}

// ---------------------------------------------------------------------------
// Staging verification
// ---------------------------------------------------------------------------

/**
 * What is actually staged for the week, read back from the database the
 * importer just wrote to.
 *
 * "Qualified" is the planner's own bar, not the importer's word for it: the
 * provenance row must carry a real source URL and name, the recipe it points at
 * must resolve, and the production role classifier must not reject it. Mains
 * and light meals are counted apart from pairings, because a week staged
 * entirely with serve-with ideas has no dinner in it.
 */
export async function inspectStagedWeek(client, week) {
  const rows = await client.execute({
    sql: "SELECT * FROM web_recipe_inspirations WHERE week = ?",
    args: [week],
  });

  const result = { rows: rows.rows.length, qualified: 0, pairings: 0, problems: [], sources: {} };

  for (const row of rows.rows) {
    const recipeId = String(row.recipe_id ?? "");
    const sourceUrl = String(row.source_url ?? "");
    const sourceName = String(row.source_name ?? "");
    if (!recipeId || !sourceUrl || !sourceName) {
      result.problems.push(`provenance row for "${recipeId || "(no id)"}" is missing source URL or name`);
      continue;
    }

    const recipeRow = await client.execute({
      sql: "SELECT data FROM recipes WHERE id = ?",
      args: [recipeId],
    });
    if (recipeRow.rows.length === 0) {
      result.problems.push(`${recipeId}: provenance row points at a recipe that is not in the DB`);
      continue;
    }

    let recipe;
    try {
      recipe = JSON.parse(String(recipeRow.rows[0].data));
    } catch {
      result.problems.push(`${recipeId}: stored recipe JSON is unreadable`);
      continue;
    }
    if (!recipe.image) {
      result.problems.push(`${recipeId}: staged without a persisted image`);
      continue;
    }

    const role = classifyPlannerRole(recipe);
    if (role.role === "reject") {
      result.problems.push(`${recipeId}: classifier rejects it as a planner idea`);
      continue;
    }
    if (role.role === "pairing") {
      result.pairings += 1;
      continue;
    }

    result.qualified += 1;
    result.sources[sourceName] = (result.sources[sourceName] ?? 0) + 1;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Prepare endpoint
// ---------------------------------------------------------------------------

async function callPrepare(baseUrl, token, week) {
  const response = await fetch(new URL("/api/meals/prepare", baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ week, mode: "prepare" }),
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function readPrepareStatus(baseUrl, week) {
  const url = new URL("/api/meals/prepare", baseUrl);
  url.searchParams.set("week", week);
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

/**
 * Is the stored shelf the thing the ritual was run to produce?
 *
 * `webSelected > 0` is the check that would have caught the released bug, so it
 * is a failure here rather than a note. A shelf can be perfectly healthy and
 * still be evidence that research never happened.
 */
export function assessShelf({ shelfSize, healthy, webSelected }) {
  const problems = [];
  if (!(shelfSize >= SHELF_MIN && shelfSize <= SHELF_MAX)) {
    problems.push(`shelf has ${shelfSize} ideas, expected ${SHELF_MIN}–${SHELF_MAX}`);
  }
  if (!healthy) problems.push("stored shelf is not healthy");
  if (!(webSelected > 0)) {
    problems.push("no web ideas reached the shelf (webSelected: 0) — staging did not land");
  }
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function requireValue(flag, value) {
  if (value === undefined) throw new Error(`${flag} needs a value`);
  return value;
}

export function parseArgs(argv) {
  const args = {
    week: null,
    count: DEFAULT_COUNT,
    baseUrl: DEFAULT_BASE_URL,
    envFile: DEFAULT_ENV_FILE,
    skipImport: false,
    dryRun: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--week") args.week = argv[++i];
    else if (a === "--count") args.count = Number.parseInt(argv[++i], 10);
    else if (a === "--base-url") args.baseUrl = argv[++i];
    // `--env`, because Node owns `--env-file` and would swallow it first.
    else if (a === "--env") args.envFile = path.resolve(requireValue(a, argv[++i]));
    else if (a === "--skip-import") args.skipImport = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--json") args.json = true;
    else if (a === "--help" || a === "-h") args.help = true;
    // Only reachable if a Node release stops reserving the name; on every
    // current version Node exits first. Named anyway, so the answer is here.
    else if (a === "--env-file") {
      throw new Error("Use --env <path>. --env-file is Node's own option, so it never reaches this script.");
    }
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (args.week && !/^\d{4}-W\d{2}$/.test(args.week)) {
    throw new Error(`--week must look like YYYY-Www, got: ${args.week}`);
  }
  if (!Number.isFinite(args.count) || args.count < 1 || args.count > 12) {
    throw new Error("--count must be a number from 1 to 12");
  }
  return args;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }

  const week = args.week ?? nextIsoWeekId();
  const log = args.json ? () => {} : (message) => console.log(message);
  const result = { week, baseUrl: args.baseUrl, dryRun: args.dryRun, steps: {} };

  log(`Weekly shelf ritual — ${week}`);

  // 1. Environment. Names only, never values.
  const { loaded, overridden } = await loadEnvFile(args.envFile);
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`${args.envFile} is missing required keys: ${missing.join(", ")}`);
  }
  log(`  env: ${loaded.length} keys from ${args.envFile}` +
    (overridden.length ? ` (overrode shell values for ${overridden.join(", ")})` : ""));
  log(`  database: ${describeDbUrl(process.env.TURSO_DATABASE_URL)}`);
  result.steps.env = { file: args.envFile, keys: loaded.length, overridden };

  // 2. Credential, before doing any work — a ritual that stages for two minutes
  //    and then discovers it cannot authenticate has wasted the scrape.
  const { token, source } = await resolveRuntimeToken();
  log(`  credential: ${source}`);
  result.steps.credential = { source };

  // 3. Import + stage. In-process: the importer is a module here, so there is
  //    no child process, no stdout parsing, and no exit code to interpret.
  if (args.skipImport || args.dryRun) {
    log(`  import: skipped (${args.dryRun ? "--dry-run" : "--skip-import"})`);
    result.steps.import = { skipped: true };
  } else {
    const { runWeeklyInspirations } = await import("./weekly-inspirations.mjs");
    const report = await runWeeklyInspirations({
      week,
      count: args.count,
      writeAppFiles: true,
      writeAppDb: true,
      stageWeek: true,
    });
    log(
      `  import: ${report.imported.length} main/light, ${report.pairings.length} pairing, ` +
        `${report.stagedProvenance.length} provenance row(s), ${report.skipped.length} skipped`,
    );
    for (const error of report.errors.slice(0, 5)) log(`    ! ${error.url}: ${error.message}`);
    result.steps.import = {
      imported: report.imported.length,
      pairings: report.pairings.length,
      staged: report.stagedProvenance.length,
      skipped: report.skipped.length,
      errors: report.errors.length,
    };
  }

  // 4. Verify staging from the database, not from the importer's own report.
  const { createClient } = await import("@libsql/client");
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  let staged;
  try {
    staged = await inspectStagedWeek(client, week);
  } finally {
    await client.close?.();
  }
  log(
    `  staged: ${staged.qualified} qualified main/light idea(s), ${staged.pairings} pairing(s) ` +
      `across ${Object.keys(staged.sources).length} source(s)`,
  );
  for (const problem of staged.problems.slice(0, 8)) log(`    - ${problem}`);
  result.steps.staged = staged;

  if (staged.qualified === 0) {
    throw new Error(
      `No qualified web ideas are staged for ${week}. Preparation would produce a ` +
        "catalog-only shelf, so it is not being called. Re-run without --skip-import, " +
        "or check the importer's skip reasons above.",
    );
  }

  // 5. Prepare, over the trusted-runtime endpoint.
  if (args.dryRun) {
    log("  prepare: skipped (--dry-run)");
    result.steps.prepare = { skipped: true };
    if (args.json) console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  const prepared = await callPrepare(args.baseUrl, token, week);
  const outcome = prepared.body ?? {};
  log(`  prepare: HTTP ${prepared.status}, status "${outcome.status ?? "?"}"`);
  for (const warning of outcome.warnings ?? []) log(`    ! ${warning}`);
  result.steps.prepare = {
    httpStatus: prepared.status,
    status: outcome.status ?? null,
    webStatus: outcome.webStatus ?? null,
    warnings: outcome.warnings ?? [],
  };

  if (prepared.status === 401 || prepared.status === 403) {
    throw new Error(
      `The prepare endpoint rejected the runtime credential (HTTP ${prepared.status}). ` +
        "The token was not printed; check the Keychain entry and the server's TRUSTED_RUNTIME_TOKEN.",
    );
  }
  if (outcome.status === "failed") {
    throw new Error(`Preparation failed for ${week}: ${outcome.error ?? "unknown error"}`);
  }

  // 6. Verify the stored shelf. Always read it back, including after a
  //    `claim-not-acquired` — a concurrent or immediately repeated run is not a
  //    failure, it just means somebody else did the write and this run's job is
  //    to confirm the result.
  const status = await readPrepareStatus(args.baseUrl, week);
  const shelf = {
    shelfSize: status.body?.shelfSize ?? 0,
    healthy: Boolean(status.body?.healthy),
    webSelected: status.body?.webSelected ?? 0,
    catalogSelected: status.body?.catalogSelected ?? 0,
  };
  const assessment = assessShelf(shelf);
  log(
    `  shelf: ${shelf.shelfSize} ideas (${shelf.webSelected} web, ${shelf.catalogSelected} catalog), ` +
      `healthy: ${shelf.healthy}`,
  );
  for (const problem of assessment.problems) log(`    - ${problem}`);
  result.steps.shelf = { ...shelf, ...assessment };
  result.ok = assessment.ok;

  if (args.json) console.log(JSON.stringify(result, null, 2));
  if (!assessment.ok) {
    log(`FAILED — ${week} shelf did not meet the contract`);
    return 1;
  }
  log(`OK — ${week} shelf is ready`);
  return 0;
}

function usage() {
  return `Usage:
  node scripts/prepare-weekly-shelf.mjs [options]

Stage next week's web ideas locally, then have production assemble the shelf.

Options:
  --week <YYYY-Www>  Target week. Default: next ISO week.
  --count <n>        Ideas to ask the importer for (1-12). Default: ${DEFAULT_COUNT}.
  --base-url <url>   Default: ${DEFAULT_BASE_URL}
  --env <path>       Default: <app>/.env.vercel
                     (not --env-file: Node reserves that name and would
                     consume it before this script sees it)
  --skip-import      Verify what is already staged, then prepare. No scraping.
  --dry-run          Read-only: no import, no prepare call.
  --json             Print one machine-readable result object.
  --help             Show this help.

Safe to re-run: duplicate URLs are refused, provenance is upserted, and a
preparation claim already held by another run is verified rather than retried.`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
