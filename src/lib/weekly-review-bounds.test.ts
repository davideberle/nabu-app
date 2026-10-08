// Executor bounds and fail-closed evidence import (REPAIR-1 R2/R3; WP05,
// WP07). Offline: a fake Gateway transport, a recording fake database
// client, synthetic recipes. Zero provider calls.
//
// Run with: npm test  (node --test; Node 24 strips types natively)

import { equal, ok, deepStrictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildReviewBatch,
  buildReviewQuestions,
  encodeReviewJson,
  PLANNER_REVIEW_LIMITS,
  PLANNER_REVIEW_MODEL,
  type ReviewBatch,
} from "./planner-review.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let script: Record<string, (...args: any[]) => Promise<any>>;
const WEEK = "2026-W42";
const ENV = { OPENROUTER_API_KEY: "oc-sent-fixture-0000", HTTPS_PROXY: "http://127.0.0.1:9", SSL_CERT_FILE: "/dev/null" };
const recipe = { name: "Lentil stew", servings: "4", ingredients: [{ item: "lentils", amount: "250", unit: "g" }, { item: "pumpkin", amount: "500", unit: "g" }, { item: "olive oil", amount: "1", unit: "tbsp" }] };

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function response(cost = 0.0001, main = 0.95) {
  const answers: Record<string, unknown> = {};
  for (const [key, question] of Object.entries(buildReviewQuestions())) {
    answers[key] = question.type === "noul"
      ? { type: "noul", noul: key === "content_sufficient" ? 0.95 : 0.02 }
      : { type: "choice", choice: key === "meal_role" ? "main" : "finished_dish", confidence: 0.95, probabilities: key === "meal_role" ? { main, side: 1 - main } : { finished_dish: 1 } };
  }
  return { model: `${PLANNER_REVIEW_MODEL}-20260917`, provider: "TypeSafe", answers, usage: { cost, input_tokens: 100, output_tokens: 20 } };
}

function batchOf(n: number, limits?: Partial<typeof PLANNER_REVIEW_LIMITS>): ReviewBatch {
  return buildReviewBatch({ week: WEEK, candidates: Array.from({ length: n }, (_, i) => ({ recipeId: `review-${i}`, origin: "web", recipe })), existing: () => null, limits: { maxCallsPerRun: 100, ...(limits ?? {}) } });
}

function dirWith(batch: ReviewBatch): string {
  const dir = mkdtempSync(join(tmpdir(), "review-bounds-"));
  mkdirSync(join(dir, WEEK), { recursive: true });
  writeFileSync(join(dir, WEEK, "batch.json"), encodeReviewJson(batch));
  return dir;
}

function fakeClient() {
  const writes: { sql: string; args: unknown[] }[] = [];
  return {
    writes,
    execute: async (q: string | { sql: string; args: unknown[] }) => {
      if (typeof q !== "string") writes.push(q);
      return { rows: [] };
    },
  };
}

async function load() {
  script = (await import("../../scripts/review-planner-candidates.mjs")) as unknown as typeof script;
}

describe("executor bounds (R2)", () => {
  it("counts every attempt, retries included, and stops at the call bound", async () => {
    await load();
    const dir = dirWith(batchOf(24));
    let attempts = 0;
    const ran = await script.runBatch({ week: WEEK, dir, env: ENV, fetchImpl: async () => { attempts += 1; return { status: 503, text: async () => "" }; } });
    equal(attempts, PLANNER_REVIEW_LIMITS.maxCallsPerRun, "no more HTTP attempts than the bound, whatever the retry policy");
    equal(ran.attempts, attempts);
    equal(ran.failed + ran.deferred, 24);
    ok(ran.deferred > 0, "items the bound prevented are deferred, not silently skipped");
    ok(/call bound/.test(ran.stoppedBy));
    const client = fakeClient();
    const imported = await script.importResults({ week: WEEK, dir, client, runId: "bounds-fail" });
    equal(imported.usage.calls, attempts, "persisted usage records the actual attempts");
    equal(imported.usage.deferred, ran.deferred);
    equal(imported.status, "failed");
    equal(imported.persisted, 0);
    rmSync(dir, { recursive: true, force: true });
  });

  it("stops further requests once the observed cost reaches the bound", async () => {
    await load();
    const dir = dirWith(batchOf(3));
    let calls = 0;
    const ran = await script.runBatch({ week: WEEK, dir, env: ENV, fetchImpl: async () => { calls += 1; return { status: 200, text: async () => JSON.stringify(response(0.06)) }; } });
    equal(calls, 1, "the first response disclosed a cost over the bound; nothing else is sent");
    equal(ran.deferred, 2);
    ok(/cost bound/.test(ran.stoppedBy));
    ok(Math.abs(ran.costUsd - 0.06) < 1e-9);
    const client = fakeClient();
    const imported = await script.importResults({ week: WEEK, dir, client, runId: "bounds-cost" });
    equal(imported.status, "partial");
    equal(imported.persisted, 1);
    equal(imported.usage.overBudget, true, "the overrun is recorded, not hidden");
    ok(Math.abs(imported.usage.costUsd - 0.06) < 1e-9);
    rmSync(dir, { recursive: true, force: true });
  });

  it("enforces the total run deadline, not only the per-request timeout", async () => {
    await load();
    const dir = dirWith(batchOf(5));
    let now = 0;
    let calls = 0;
    const ran = await script.runBatch({
      week: WEEK,
      dir,
      env: ENV,
      clock: () => now,
      limits: { ...PLANNER_REVIEW_LIMITS, maxRunMs: 1000 },
      fetchImpl: async () => { calls += 1; now += 600; return { status: 200, text: async () => JSON.stringify(response()) }; },
    });
    equal(calls, 2, "the third request would start after the deadline");
    equal(ran.deferred, 3);
    ok(/deadline/.test(ran.stoppedBy));
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("fail-closed evidence import (R3)", () => {
  it("empty results for a non-empty batch cannot succeed and persist nothing", async () => {
    await load();
    const client = fakeClient();
    const imported = await script.importResults({ week: WEEK, dir: tmpdir(), client, batch: batchOf(3), results: { results: [], calls: 0 }, runId: "r3-empty" });
    equal(imported.status, "failed");
    equal(imported.persisted, 0);
    ok(imported.defects.some((d: string) => /no disposition for 3/.test(d)));
    ok(imported.defects.some((d: string) => /batch hash/.test(d)));
    ok(!client.writes.some((w) => /INSERT INTO planner_candidate_reviews/.test(w.sql)), "no review row is written");
    ok(client.writes.some((w) => /INSERT INTO planner_review_runs/.test(w.sql) && w.args.includes("failed")), "the run is recorded as failed");
  });

  it("a wrong batch hash, a mismatched content hash, or a response that does not match its retained bytes is refused", async () => {
    await load();
    const batch = batchOf(1);
    const item = batch.items[0];
    const good = response();
    const raw = JSON.stringify(good);
    const bound = (overrides: Record<string, unknown>) => ({
      batchSha256: sha(encodeReviewJson(batch)),
      attempts: 1,
      results: [{ recipeId: item.recipeId, contentSha256: item.contentSha256, requestSha256: item.requestSha256, status: "result", responseSha256: sha(raw), responseRaw: raw, response: good, completedAt: "2026-10-08T00:00:00Z", ...overrides }],
    });
    const client = fakeClient();
    // Control: the honest shape persists exactly one record.
    const okImport = await script.importResults({ week: WEEK, dir: tmpdir(), client, batch, results: bound({}), runId: "r3-ok" });
    equal(okImport.persisted, 1);
    equal(okImport.status, "succeeded");

    const wrongBatch = await script.importResults({ week: WEEK, dir: tmpdir(), client: fakeClient(), batch, results: { ...bound({}), batchSha256: "wrong" }, runId: "r3-batch" });
    equal(wrongBatch.persisted, 0);
    equal(wrongBatch.status, "failed");

    const wrongContent = await script.importResults({ week: WEEK, dir: tmpdir(), client: fakeClient(), batch, results: bound({ contentSha256: "other" }), runId: "r3-content" });
    equal(wrongContent.persisted, 0);
    ok(wrongContent.rejected[0].problems.some((p: string) => /content hash/.test(p)));

    const tampered = structuredClone(good);
    (tampered.answers.meal_role as { probabilities: Record<string, number> }).probabilities = { main: 0.99, side: 0.01 };
    const tamperedImport = await script.importResults({ week: WEEK, dir: tmpdir(), client: fakeClient(), batch, results: bound({ response: tampered }), runId: "r3-tamper" });
    equal(tamperedImport.persisted, 0);
    ok(tamperedImport.rejected[0].problems.some((p: string) => /retained response bytes/.test(p)));

    const noBytes = await script.importResults({ week: WEEK, dir: tmpdir(), client: fakeClient(), batch, results: bound({ responseRaw: undefined }), runId: "r3-nobytes" });
    equal(noBytes.persisted, 0);
    ok(noBytes.rejected[0].problems.some((p: string) => /no retained response bytes/.test(p)));

    const outOfRange = structuredClone(good);
    (outOfRange.answers.meal_role as { probabilities: Record<string, number> }).probabilities.main = 99;
    const rawOut = JSON.stringify(outOfRange);
    const outImport = await script.importResults({ week: WEEK, dir: tmpdir(), client: fakeClient(), batch, results: bound({ response: outOfRange, responseRaw: rawOut, responseSha256: sha(rawOut) }), runId: "r3-range" });
    equal(outImport.persisted, 0);
    ok(outImport.rejected[0].problems.some((p: string) => /out of range/.test(p)));
  });

  it("unknown, duplicate or unaccounted identities fail the whole import", async () => {
    await load();
    const batch = batchOf(2);
    const good = response();
    const raw = JSON.stringify(good);
    const result = (item: ReviewBatch["items"][number]) => ({ recipeId: item.recipeId, contentSha256: item.contentSha256, requestSha256: item.requestSha256, status: "result", responseSha256: sha(raw), responseRaw: raw, response: good });
    const base = { batchSha256: sha(encodeReviewJson(batch)), attempts: 2 };
    const duplicate = await script.importResults({ week: WEEK, dir: tmpdir(), client: fakeClient(), batch, results: { ...base, results: [result(batch.items[0]), result(batch.items[0]), result(batch.items[1])] }, runId: "r3-dup" });
    equal(duplicate.status, "failed");
    ok(duplicate.defects.some((d: string) => /duplicate/.test(d)));
    const unknown = await script.importResults({ week: WEEK, dir: tmpdir(), client: fakeClient(), batch, results: { ...base, results: [result(batch.items[0]), result(batch.items[1]), { ...result(batch.items[0]), recipeId: "stranger" }] }, runId: "r3-unknown" });
    equal(unknown.status, "failed");
    const missing = await script.importResults({ week: WEEK, dir: tmpdir(), client: fakeClient(), batch, results: { ...base, results: [result(batch.items[0])] }, runId: "r3-missing" });
    equal(missing.status, "failed");
    ok(missing.defects.some((d: string) => /no disposition for 1/.test(d)));
    const lowAttempts = await script.importResults({ week: WEEK, dir: tmpdir(), client: fakeClient(), batch, results: { ...base, attempts: 1, results: [result(batch.items[0]), result(batch.items[1])] }, runId: "r3-attempts" });
    equal(lowAttempts.status, "failed");
    ok(lowAttempts.defects.some((d: string) => /attempt count/.test(d)));
    deepStrictEqual(lowAttempts.inventory, { sourceCount: 2, uniqueSourceCount: 2, duplicateSources: 0, outputCount: 2, results: 2, failed: 0, deferred: 0, rejected: 0, missing: 0 });
  });

  it("a pinned-route mismatch on the batch is refused before anything else", async () => {
    await load();
    const batch = { ...batchOf(1), model: "typesafe/jev-2" } as unknown as ReviewBatch;
    const imported = await script.importResults({ week: WEEK, dir: tmpdir(), client: fakeClient(), batch, results: { batchSha256: sha(encodeReviewJson(batch)), attempts: 0, results: [] }, runId: "r3-route" });
    equal(imported.status, "failed");
    ok(imported.defects.some((d: string) => /pinned review contract/.test(d)));
  });
});

describe("repair 2: run context, identities, model syntax and the in-flight deadline", () => {
  it("refuses a batch that names the same recipe twice before anything is collapsed", async () => {
    await load();
    const batch = batchOf(1);
    batch.items.push(structuredClone(batch.items[0]));
    const good = response();
    const raw = JSON.stringify(good);
    const env = { batchSha256: sha(encodeReviewJson(batch)), attempts: 1, results: [{ recipeId: batch.items[0].recipeId, contentSha256: batch.items[0].contentSha256, requestSha256: batch.items[0].requestSha256, status: "result", responseSha256: sha(raw), responseRaw: raw, response: good }] };
    const client = fakeClient();
    const imported = await script.importResults({ week: WEEK, dir: tmpdir(), client, batch, results: env, runId: "r2-dup-source" });
    equal(imported.status, "failed");
    equal(imported.persisted, 0);
    ok(imported.defects.some((d: string) => /duplicate source identities/.test(d)));
    equal(imported.inventory.sourceCount, 2, "both inputs are counted as source items");
    equal(imported.inventory.uniqueSourceCount, 1);
    equal(imported.inventory.duplicateSources, 1);
  });

  it("refuses a batch or results whose week differs from the run week", async () => {
    await load();
    const batch = { ...batchOf(1), week: "2026-W43" } as ReviewBatch;
    const good = response();
    const raw = JSON.stringify(good);
    const env = { batchSha256: sha(encodeReviewJson(batch)), attempts: 1, results: [{ recipeId: batch.items[0].recipeId, contentSha256: batch.items[0].contentSha256, requestSha256: batch.items[0].requestSha256, status: "result", responseSha256: sha(raw), responseRaw: raw, response: good }] };
    const imported = await script.importResults({ week: WEEK, dir: tmpdir(), client: fakeClient(), batch, results: env, runId: "r2-week" });
    equal(imported.status, "failed");
    ok(imported.defects.some((d: string) => /batch week 2026-W43 does not match the run week 2026-W42/.test(d)));
    const right = batchOf(1);
    const env2 = { ...env, week: "2026-W43", batchSha256: sha(encodeReviewJson(right)), results: [{ ...env.results[0], recipeId: right.items[0].recipeId, contentSha256: right.items[0].contentSha256, requestSha256: right.items[0].requestSha256 }] };
    const imported2 = await script.importResults({ week: WEEK, dir: tmpdir(), client: fakeClient(), batch: right, results: env2, runId: "r2-results-week" });
    equal(imported2.status, "failed");
    ok(imported2.defects.some((d: string) => /results week/.test(d)));
    // And the run step refuses to even start on a mismatched batch.
    const dir = dirWith(batch);
    await script.runBatch({ week: WEEK, dir: join(dir), env: ENV, fetchImpl: async () => ({ status: 200, text: async () => "{}" }) }).then(
      () => ok(false, "run must refuse a batch for another week"),
      (error: Error) => ok(/not the requested 2026-W42/.test(error.message)),
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it("accepts the pinned model and its dated snapshot only; a prefix collision is refused", async () => {
    await load();
    const { isAcceptedResolvedModel, validateReviewResponse } = await import("./planner-review.ts");
    ok(isAcceptedResolvedModel("typesafe/jev-1.13"));
    ok(isAcceptedResolvedModel("typesafe/jev-1.13-20260917"));
    ok(!isAcceptedResolvedModel("typesafe/jev-1.130-other"));
    ok(!isAcceptedResolvedModel("typesafe/jev-1.13-other"));
    ok(!isAcceptedResolvedModel("typesafe/jev-1.13x"));
    ok(!isAcceptedResolvedModel("openai/typesafe/jev-1.13"));
    ok(validateReviewResponse({ ...response(), model: "typesafe/jev-1.130-other" }).some((p) => /model/.test(p)));
    const batch = batchOf(1);
    const bad = { ...response(), model: "typesafe/jev-1.130-other" };
    const raw = JSON.stringify(bad);
    const env = { batchSha256: sha(encodeReviewJson(batch)), attempts: 1, results: [{ recipeId: batch.items[0].recipeId, contentSha256: batch.items[0].contentSha256, requestSha256: batch.items[0].requestSha256, status: "result", responseSha256: sha(raw), responseRaw: raw, response: bad }] };
    const imported = await script.importResults({ week: WEEK, dir: tmpdir(), client: fakeClient(), batch, results: env, runId: "r2-model" });
    equal(imported.persisted, 0);
    equal(imported.status, "failed");
  });

  it("aborts an in-flight request at the total run deadline and records it honestly", async () => {
    await load();
    const dir = dirWith(batchOf(2));
    let aborted = 0;
    const started = Date.now();
    const ran = await script.runBatch({
      week: WEEK,
      dir,
      env: ENV,
      limits: { ...PLANNER_REVIEW_LIMITS, maxRunMs: 40, requestTimeoutMs: 500, maxAttemptsPerItem: 2 },
      fetchImpl: (_url: string, init: { signal: AbortSignal }) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve({ status: 200, text: async () => JSON.stringify(response()) }), 300);
          init.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            aborted += 1;
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        }),
    });
    const elapsed = Date.now() - started;
    equal(aborted, 1, "the first request is aborted when the run deadline passes; no retry and no second request");
    ok(elapsed < 250, `the run returned at the deadline, not after the request timeout (${elapsed} ms)`);
    equal(ran.attempts, 1);
    equal(ran.failed, 1);
    equal(ran.deferred, 1, "the second item never started");
    ok(/deadline/.test(ran.stoppedBy));
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("audit-sweep ingress (R3)", () => {
  it("re-verifies request reproduction and the response contract, and records that no wire bytes were retained", async () => {
    await load();
    const auditDir = mkdtempSync(join(tmpdir(), "sweep-"));
    mkdirSync(join(auditDir, "catalog/per-id-v2"), { recursive: true });
    const { minimizeRecipeForReview, buildReviewRequest, PLANNER_REVIEW_RUBRIC_SHA256, PLANNER_REVIEW_ENDPOINT } = await import("./planner-review.ts");
    const minimized = minimizeRecipeForReview(recipe as never);
    ok(minimized.ok);
    const { requestSha256 } = buildReviewRequest(minimized.payload);
    const good = { id: "sweep-good", status: "result", rubric_sha256: PLANNER_REVIEW_RUBRIC_SHA256, model_requested: PLANNER_REVIEW_MODEL, endpoint: PLANNER_REVIEW_ENDPOINT, payload_sha256: minimized.contentSha256, request_sha256: requestSha256, response_sha256: "a".repeat(64), response: response(), completed_at: "2026-10-02T00:00:00Z" };
    const badRange = { ...good, id: "sweep-range", response: (() => { const r = response(); (r.answers.meal_role as { probabilities: Record<string, number> }).probabilities.main = 7; return r; })() };
    const wrongRubric = { ...good, id: "sweep-rubric", rubric_sha256: "other" };
    const wrongRequest = { ...good, id: "sweep-request", request_sha256: "0".repeat(64) };
    for (const row of [good, badRange, wrongRubric, wrongRequest]) writeFileSync(join(auditDir, "catalog/per-id-v2", `${row.id}.json`), JSON.stringify(row));
    const client = fakeClient();
    const summary = await script.importSweep({ client, recipes: async () => ({ id: "x", ...recipe }), auditDir });
    equal(summary.bound, 1);
    equal(summary.skipped.unbound, 3);
    const insert = client.writes.find((w) => /INSERT INTO planner_candidate_reviews/.test(w.sql))!;
    ok(insert, "the one verifiable result is persisted");
    const evidence = JSON.parse(String(insert.args[insert.args.length - 1]));
    equal(evidence.responseBytesVerified, false, "the sweep retained no raw bytes; the record says so");
    ok(evidence.sourceFileSha256 && evidence.sourcePath.endsWith("sweep-good.json"));
    rmSync(auditDir, { recursive: true, force: true });
  });
});
