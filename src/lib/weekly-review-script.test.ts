// The local review script end to end, offline, against a throwaway SQLite
// database: export → (fake Gateway transport) run → import → the app's own
// `getCandidateReviews` sees the bound rows. WP05 (one checked result reused
// across the staging path and the shelf), WP06 (the transport refuses
// anything but the Gateway sentinel route; excluded content never reaches
// the wire), WP07 (a failed run is recorded as such, never as a pass).
//
// Run with: npm test  (node --test; Node 24 strips types natively)

import { equal, ok, deepStrictEqual } from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Pure module: safe to import before the database location is pinned below.
import { buildReviewQuestions, minimizeRecipeForReview, PLANNER_REVIEW_RUBRIC_SHA256 } from "./planner-review.ts";

const workDir = mkdtempSync(join(tmpdir(), "nabu-review-"));
process.env.NABU_DB_DIR = workDir;
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;

const WEEK = "2026-W42";
const RECIPE = {
  id: "web-squash-gratin",
  name: "Squash and kale gratin",
  servings: "serves 4",
  source: { cookbook: "My Recipes", author: "FOOBY", publication: "FOOBY · Web inspiration", url: "https://fooby.ch/en/recipes/1/squash-gratin.html" },
  ingredients: [
    { item: "butternut squash", amount: "800", unit: "g" },
    { item: "kale", amount: "200", unit: "g" },
    { item: "cream", amount: "200", unit: "ml" },
    { item: "gruyère", amount: "100", unit: "g" },
  ],
  method: ["Roast the squash.", "Layer with kale and cream, top with cheese and bake."],
  tips: "Source: https://fooby.ch/en/recipes/1/squash-gratin.html. Imported as weekly web inspiration for 2026-W42.",
  visibility: "planner-candidate",
  image: "/recipes/web-squash-gratin.jpg",
};

type Client = { execute: (q: string | { sql: string; args: unknown[] }) => Promise<{ rows: Record<string, unknown>[] }> };
let client: Client;
let close: () => Promise<void>;
// The script is plain JavaScript; its inferred parameter types are too narrow
// for the optional fields, so the test treats it as an untyped module.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let script: Record<string, (...args: any[]) => Promise<any>>;

before(async () => {
  // The app creates its own schema (migrations) in the throwaway database;
  // the script then talks to the same file through the importer's client.
  const db = await import("./db.ts");
  await db.getDb();
  const importer = await import("../../scripts/weekly-inspirations.mjs");
  client = importer.getAppDbClient();
  close = importer.closeAppDbClient;
  script = (await import("../../scripts/review-planner-candidates.mjs")) as unknown as typeof script;
  const columns = new Set((await client.execute("PRAGMA table_info(recipes)")).rows.map((row) => String(row.name)));
  const now = "2026-10-08T03:30:00.000Z";
  const extra = ["created_at", "updated_at"].filter((column) => columns.has(column));
  await client.execute({
    sql: `INSERT OR REPLACE INTO recipes (id, data${extra.map((c) => `, ${c}`).join("")}) VALUES (?, ?${extra.map(() => ", ?").join("")})`,
    args: [RECIPE.id, JSON.stringify(RECIPE), ...extra.map(() => now)],
  });
  await client.execute({
    sql: "INSERT OR REPLACE INTO web_recipe_inspirations (recipe_id, week, source_url, source_name, imported_at) VALUES (?, ?, ?, ?, ?)",
    args: [RECIPE.id, WEEK, RECIPE.source.url, "FOOBY", now],
  });
});

after(async () => {
  await close?.();
  rmSync(workDir, { recursive: true, force: true });
});

function fakeResponse(main: number) {
  const answers: Record<string, unknown> = {};
  for (const key of Object.keys(buildReviewQuestions())) if (key.startsWith("dish_")) answers[key] = { type: "noul", noul: 0.03 };
  answers.recipe_form = { type: "choice", choice: "finished_dish", confidence: 1, probabilities: { finished_dish: 1, standalone_preparation: 0, uncertain: 0 } };
  answers.meal_role = { type: "choice", choice: main >= 0.5 ? "main" : "side", confidence: main, probabilities: { main, side: 1 - main, starter: 0, dessert: 0, breakfast: 0, drink: 0, component: 0, snack: 0, condiment: 0, uncertain: 0 } };
  answers.content_sufficient = { type: "noul", noul: 0.97 };
  return { id: "gen-dec-fixture", model: "typesafe/jev-1.13-20260917", provider: "TypeSafe", answers, usage: { input_tokens: 2100, output_tokens: 320, cost: 0.0000951 } };
}

const GATEWAY_ENV = { OPENROUTER_API_KEY: "oc-sent-fixture-sentinel-0000", HTTPS_PROXY: "http://127.0.0.1:9", SSL_CERT_FILE: "/dev/null" };

describe("review script, offline", () => {
  it("export writes a minimized, screened batch for the staged web ideas and nothing else", async () => {
    const out = await script.exportBatch({ week: WEEK, dir: workDir, client });
    equal(out.items, 1);
    equal(out.reused, 0);
    const batch = JSON.parse(readFileSync(out.file, "utf8"));
    deepStrictEqual(batch.items[0].payload, {
      name: "Squash and kale gratin",
      servings: "serves 4",
      ingredients: [
        { item: "butternut squash", amount: "800", unit: "g" },
        { item: "kale", amount: "200", unit: "g" },
        { item: "cream", amount: "200", unit: "ml" },
        { item: "gruyère", amount: "100", unit: "g" },
      ],
    });
    const wire = JSON.stringify(batch.items[0].request);
    ok(!wire.includes("fooby.ch") && !wire.includes("Imported") && !wire.includes("Roast"), "URL, provenance note and method never leave");
    equal(batch.model, "typesafe/jev-1.13");
    equal(batch.endpoint, "https://openrouter.ai/api/alpha/decisions");
    const tables = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'planner_candidate_reviews'");
    equal(tables.rows.length, 0, "an export is read-only on the database");
  });

  it("run refuses without the Gateway sentinel route, and refuses a raw key", async () => {
    const noRoute = await script.runBatch({ week: WEEK, dir: workDir, env: {} });
    ok(noRoute.refused && noRoute.problems.length === 3);
    const rawKey = await script.runBatch({ week: WEEK, dir: workDir, env: { ...GATEWAY_ENV, OPENROUTER_API_KEY: "sk-or-v1-notasentinel-abcdefghijklmnop" } });
    ok(rawKey.refused && rawKey.problems.some((p: string) => /raw keys are refused/.test(p)));
  });

  it("run + import bind the response to the exact request, persist it, and the app reads it back", async () => {
    const seen: { url: string; auth: string; body: string }[] = [];
    const fetchImpl = async (url: string, init: { headers: Record<string, string>; body: string }) => {
      seen.push({ url, auth: init.headers.Authorization, body: init.body });
      return { status: 200, text: async () => JSON.stringify(fakeResponse(0.92)) };
    };
    const ran = await script.runBatch({ week: WEEK, dir: workDir, env: GATEWAY_ENV, fetchImpl });
    equal(ran.ok, true);
    equal(ran.calls, 1);
    equal(seen[0].url, "https://openrouter.ai/api/alpha/decisions");
    equal(seen[0].auth, "Bearer oc-sent-fixture-sentinel-0000", "only the sentinel is ever sent; the proxy swaps it");
    ok(!seen[0].body.includes("fooby.ch"));

    const imported = await script.importResults({ week: WEEK, dir: workDir, client, runId: "fixture-run" });
    equal(imported.status, "succeeded");
    equal(imported.persisted, 1);
    deepStrictEqual(imported.verdicts, { "web-squash-gratin": "yes" });
    equal(imported.usage.calls, 1);
    ok(imported.usage.costUsd > 0 && imported.usage.overBudget === false);

    const db = await import("./db.ts");
    const minimized = minimizeRecipeForReview(RECIPE as never);
    ok(minimized.ok);
    const reviews = await db.getCandidateReviews([{ recipeId: RECIPE.id, contentSha256: minimized.contentSha256 }]);
    const record = reviews.get(`${RECIPE.id}:${minimized.contentSha256}`)!;
    ok(record, "the shelf reads the same bound review the staging path wrote");
    equal(record.rubricSha256, PLANNER_REVIEW_RUBRIC_SHA256);
    equal(record.modelResolved, "typesafe/jev-1.13-20260917");
    equal(record.interpretation.verdict, "yes");
    const runs = await db.getPlannerReviewRuns(WEEK);
    equal(runs[0].status, "succeeded");

    // A second export reuses the bound result: no item to send.
    const again = await script.exportBatch({ week: WEEK, dir: workDir, client });
    equal(again.items, 0);
    equal(again.reused, 1);

    // Edited content invalidates it.
    const edited = { ...RECIPE, ingredients: [...RECIPE.ingredients, { item: "nutmeg", amount: "1", unit: "pinch" }] };
    await client.execute({ sql: "UPDATE recipes SET data = ? WHERE id = ?", args: [JSON.stringify(edited), RECIPE.id] });
    const afterEdit = await script.exportBatch({ week: WEEK, dir: workDir, client });
    equal(afterEdit.items, 1, "changed content needs a new review");
    equal(afterEdit.reused, 0);
  });

  it("a failed transport is recorded as a failed run, never as a pass", async () => {
    const fetchImpl = async () => ({ status: 503, text: async () => "upstream unavailable" });
    const ran = await script.runBatch({ week: WEEK, dir: workDir, env: GATEWAY_ENV, fetchImpl });
    equal(ran.ok, true);
    equal(ran.failed, 1);
    equal(ran.calls, 2, "one bounded retry, then stop");
    const imported = await script.importResults({ week: WEEK, dir: workDir, client, runId: "fixture-failed" });
    equal(imported.status, "failed");
    equal(imported.persisted, 0);
    const db = await import("./db.ts");
    const runs = await db.getPlannerReviewRuns(WEEK);
    equal(runs[0]?.runId, "fixture-failed", "the latest run is the failed one");
    equal(runs[0]?.status, "failed", "which is what the next preparation reads to label unreviewed ideas as provider-unavailable");
  });

  it("a response bound to a different request is rejected on import", async () => {
    const fetchImpl = async () => ({ status: 200, text: async () => JSON.stringify({ ...fakeResponse(0.9), model: "openai/gpt-x" }) });
    await script.runBatch({ week: WEEK, dir: workDir, env: GATEWAY_ENV, fetchImpl });
    const imported = await script.importResults({ week: WEEK, dir: workDir, client, runId: "fixture-wrong-model" });
    equal(imported.persisted, 0);
    equal(imported.rejected.length, 1);
    ok(/model/.test(imported.rejected[0].problems.join(" ")));
  });
});
