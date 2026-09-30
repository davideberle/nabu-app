// Approved learning redesign (2026-09-29) — persistence: additive upgrade on
// load, exactly one completion review per finished visit under every retry
// shape, historical backfill, telemetry idempotency and deletion of derived
// stores. Run with: npm test

import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { createClient, type Client } from "@libsql/client";
import { asLearningContent } from "./family-learning-content.ts";
import { LEARNING_RULES_VERSION, REVIEW_VERSION } from "./family-learning-summary.ts";
import { applyMutation, deleteChildRecords, ensureHistoricalCompletions, ensureLearningTables, loadMissionState, readChildView, readEvidence, recordTelemetry, writeParentSetting } from "./family-learning-db.ts";
import type { LearningOp } from "./family-learning-state.ts";

const v1 = asLearningContent(JSON.parse(readFileSync(new URL("../data/family-learning/content/santiago-expedition-v1.json", import.meta.url), "utf8")));
const v2 = asLearningContent(JSON.parse(readFileSync(new URL("../data/family-learning/content/santiago-expedition-v2.json", import.meta.url), "utf8")));

const dir = mkdtempSync(join(tmpdir(), "family-learning-redesign-"));
let n = 0;
const clients: Client[] = [];
async function fresh(): Promise<Client> {
  const client = createClient({ url: `file:${join(dir, `db-${(n += 1)}.sqlite`)}` });
  clients.push(client);
  await ensureLearningTables(client);
  return client;
}
after(() => {
  for (const client of clients) client.close();
  rmSync(dir, { recursive: true, force: true });
});

let k = 0;
const key = () => `k-${(k += 1)}`;
/** The batch identity a client obtains from the server view: generation + visit instance. */
async function identity(client: Client, visitId: string): Promise<{ visitId: string; visitStartedAt: string; erasureGeneration: number }> {
  const view = await readChildView(client, "santiago", v2);
  const state = await loadMissionState(client, "santiago", v2.contentId, v2);
  const visit = state?.visits.find((v) => v.id === visitId);
  return { visitId, visitStartedAt: visit?.startedAt ?? "none", erasureGeneration: view.erasureGeneration };
}
async function step(client: Client, op: LearningOp, content = v2, idempotencyKey = key()) {
  const view = await readChildView(client, "santiago", content);
  const out = await applyMutation(client, { child: "santiago", op, idempotencyKey, expectedRevision: view.revision }, content);
  if (out.status !== "applied") throw new Error(`${op.op}: ${out.status} ${"message" in out ? out.message : ""}`);
  return out;
}

/** Santiago's live-like history persisted under version-1 content (two completed visits). */
async function persistTwoVisitsUnderV1(client: Client) {
  const ops: LearningOp[] = [
    { op: "start-visit" }, { op: "name-base", name: "Sonnenküste" }, { op: "place-base", locationId: "shore" },
    { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" },
    { op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" },
    { op: "explain", text: "Ich habe geteilt.", modality: "typed" }, { op: "skip-stage", stage: "LANG-EN-WATER", reason: "child" },
    { op: "typing-label", taskId: "TYPE-LABEL-BASE", typed: "Sonnenküste", seconds: 20 }, { op: "save-log", text: "Ichhabe2Schildkroten gesehen." }, { op: "reflect", optionId: "easy" },
    { op: "start-visit" }, { op: "resume-base" }, { op: "answer-math", itemId: "EQ-RETURN", answer: 7, raw: "7", modality: "typed" },
    { op: "skip-stage", stage: "LANG-ES-AGUA", reason: "child" }, { op: "typing-label", taskId: "TYPE-LABEL-GARDEN", typed: "Garten der Basis", seconds: 30 },
    { op: "save-log", text: "Der Garten ist fertig." }, { op: "reflect", optionId: "easy" },
  ];
  for (const op of ops) await step(client, op, v1);
  // Production completed these visits before the completion table existed: no review rows yet.
  await client.execute("DELETE FROM family_learning_completions WHERE child_id = 'santiago'");
}

describe("upgrade on load", () => {
  it("a version-1 mission row is served upgraded under version-2 content, persisted on the next write, and its history is byte-identical", async () => {
    const client = await fresh();
    await persistTwoVisitsUnderV1(client);
    const rawBefore = await client.execute("SELECT content_version, state_json FROM family_learning_missions WHERE child_id = 'santiago'");
    equal(Number(rawBefore.rows[0].content_version), 1);
    const saved = JSON.parse(String(rawBefore.rows[0].state_json));
    // Read under v2: in-memory upgrade, no write.
    const view = await readChildView(client, "santiago", v2);
    equal(view.contentVersion, 2);
    equal(view.next.visit, "v4");
    equal(Number((await client.execute("SELECT content_version FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0].content_version), 1, "a read does not write");
    // First write under v2 persists the upgraded shape, revision +1 only.
    await step(client, { op: "start-visit" }, v2);
    const rawAfter = await client.execute("SELECT content_version, revision, state_json FROM family_learning_missions WHERE child_id = 'santiago'");
    equal(Number(rawAfter.rows[0].content_version), 2);
    equal(Number(rawAfter.rows[0].revision), saved.revision + 1);
    const upgraded = JSON.parse(String(rawAfter.rows[0].state_json));
    deepStrictEqual(upgraded.math["EQ-ENTRY"], saved.math["EQ-ENTRY"]);
    deepStrictEqual(upgraded.visits.slice(0, 2), saved.visits);
    deepStrictEqual(upgraded.pages, saved.pages);
    ok(upgraded.math["EQ-STATION"]);
    // Attempt/sample rows untouched (same ids, same count).
    const attempts = await client.execute("SELECT COUNT(*) AS c FROM family_learning_attempts WHERE child_id = 'santiago'");
    equal(Number(attempts.rows[0].c), 3);
    // Isabel: no Santiago fallback under v2 either.
    const isabel = await loadMissionState(client, "isabel", v2.contentId, v2);
    equal(isabel, null);
  });
});

/** Chapter 4 through the reflect stage; "up-to-transfer" stops at the log-transfer stage (nothing written there yet). */
async function completeVisit4(client: Client, upTo?: "up-to-transfer") {
  await writeParentSetting(client, "santiago", "keyboard_layout", "ch-de-qwertz");
  const ops: LearningOp[] = [
    { op: "start-visit" }, { op: "resume-base" }, { op: "choose-station", theme: "turtles" },
    { op: "typing-check", observed: ["'", "ö", "z"] },
    { op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["fff jjj", "fj fj jf"], seconds: 20, comfort: "ok" }, { op: "typing-course-continue" },
    { op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30 und 2", modality: "typed" }, { op: "explain", text: "5 mal 6 sind 30.", modality: "typed" },
    { op: "language-step", segmentId: "LANG-ES-STATION", stepId: "listen", response: "", modality: "listen" },
    { op: "language-step", segmentId: "LANG-ES-STATION", stepId: "pick", response: "lámpara", modality: "word-choice" },
    { op: "language-step", segmentId: "LANG-ES-STATION", stepId: "produce", response: "Necesitamos una lámpara.", modality: "typed" },
    { op: "language-step", segmentId: "LANG-ES-STATION", stepId: "reuse", response: "agua", modality: "word-choice" },
    { op: "build-station", spot: "beach" }, { op: "save-log", text: "Ichhabe2Schildkroten gesehen." }, { op: "revise-log", text: "Ich habe 2 Schildkroten gesehen." }, { op: "write-transfer", text: "Morgen zählt die Station 3 Wellen.", modality: "typed" }, { op: "summary-seen" },
  ];
  const list = upTo === "up-to-transfer" ? ops.slice(0, ops.findIndex((o) => o.op === "write-transfer")) : ops;
  for (const op of list) await step(client, op, v2);
}

describe("exactly one review per completed visit (F6/R1)", () => {
  it("finishing v4 writes one completion; replaying the same key, retrying with a new key, a stale tab and a re-read never add another", async () => {
    const client = await fresh();
    await persistTwoVisitsUnderV1(client);
    await completeVisit4(client);
    await recordTelemetry(client, "santiago", v2.contentId, { ...(await identity(client, "v4")), batchId: "b1", events: [{ t: 1, kind: "stage-enter", stage: "EQ-STATION" }, { t: 2, kind: "active-interval", stage: "EQ-STATION", detail: { seconds: 30 } }, { t: 3, kind: "keystream", detail: { keys: "secret" } }] });
    const view = await readChildView(client, "santiago", v2);
    const finishKey = key();
    const first = await applyMutation(client, { child: "santiago", op: { op: "reflect", optionId: "right" }, idempotencyKey: finishKey, expectedRevision: view.revision }, v2);
    equal(first.status, "applied");
    const count = async () => Number((await client.execute("SELECT COUNT(*) AS c FROM family_learning_completions WHERE child_id = 'santiago' AND visit_id = 'v4'")).rows[0].c);
    equal(await count(), 1);
    // Lost ACK → same key replays.
    const replay = await applyMutation(client, { child: "santiago", op: { op: "reflect", optionId: "right" }, idempotencyKey: finishKey, expectedRevision: view.revision }, v2);
    equal(replay.status, "replayed");
    equal(await count(), 1);
    // A retry with a NEW key at the old revision is stale; at the new revision it is refused (no visit running).
    const stale = await applyMutation(client, { child: "santiago", op: { op: "reflect", optionId: "right" }, idempotencyKey: key(), expectedRevision: view.revision }, v2);
    equal(stale.status, "stale");
    const refused = await applyMutation(client, { child: "santiago", op: { op: "reflect", optionId: "right" }, idempotencyKey: key(), expectedRevision: view.revision + 1 }, v2);
    equal(refused.status, "refused");
    equal(await count(), 1);
    // The review carries the telemetry summary (the rejected key-stream event was dropped) and separates learning from UX.
    const bundle = await readEvidence(client, "santiago", v2.contentId, undefined, v2);
    const v4 = bundle.completions.find((c) => c.visitId === "v4")!;
    equal(v4.historical, false);
    equal(v4.contentVersion, 2);
    equal(v4.review!.experience.telemetry.supported, true);
    equal(v4.review!.experience.telemetry.foregroundActiveSeconds, 30);
    // 2 accepted UX events + the finishing reflect's answered difficulty, which the server records itself (R4-1).
    equal(v4.review!.experience.telemetry.events, 3);
    equal(v4.review!.learning.childSummary.success!.basis.startsWith("attempt EQ-STATION#1 independent"), true);
    ok(v4.review!.learning.objectives.some((o) => o.taskId === "LANG-ES-STATION/produce" && o.outcome === "correct"));
    equal(v4.delivery!.channel, "cockpit");
    ok(v4.delivery!.clavus.startsWith("unavailable"));
    equal(bundle.telemetry.batches, 2, "the UX batch and the server-owned feedback batch of the finishing reflect");
    // Historical v1/v2 reviews were backfilled once, marked historical, content version 1.
    const historical = bundle.completions.filter((c) => c.historical);
    deepStrictEqual(historical.map((c) => [c.visitId, c.contentVersion]), [["v1", 1], ["v2", 1]]);
    equal(historical[0].review!.experience.telemetry.supported, false);
    equal(await ensureHistoricalCompletions(client, "santiago", v2), 0, "backfill is idempotent");
    equal(bundle.completions.length, 3);
  });
  it("telemetry batches are idempotent by id, bound to the visit instance, and unknown kinds are dropped", async () => {
    const client = await fresh();
    await persistTwoVisitsUnderV1(client);
    const id = await identity(client, "v1");
    const a = await recordTelemetry(client, "santiago", v2.contentId, { ...id, batchId: "same", events: [{ t: 1, kind: "submit", detail: { op: "save-log", ok: true } }, { t: 2, kind: "audio-archive", detail: { blob: "x" } }] });
    deepStrictEqual(a, { stored: true, accepted: 1 });
    const b = await recordTelemetry(client, "santiago", v2.contentId, { ...id, batchId: "same", events: [{ t: 1, kind: "submit", detail: { op: "save-log", ok: true } }] });
    deepStrictEqual(b, { stored: false, accepted: 1 }, "legitimate duplicate retry: not stored twice, not refused");
    equal(Number((await client.execute("SELECT COUNT(*) AS c FROM family_learning_telemetry")).rows[0].c), 1);
    // A batch for a visit the child never had, or for another instance of the same visit id, is dropped.
    deepStrictEqual(await recordTelemetry(client, "santiago", v2.contentId, { ...id, batchId: "other", visitId: "v4", events: [{ t: 1, kind: "hidden" }] }), { stored: false, accepted: 0, reason: "no-visit" });
    deepStrictEqual(await recordTelemetry(client, "santiago", v2.contentId, { ...id, batchId: "other2", visitStartedAt: "2020-01-01T00:00:00.000Z", events: [{ t: 1, kind: "hidden" }] }), { stored: false, accepted: 0, reason: "no-visit" });
  });
  it("P1 — a deletion that completes before the fenced write leaves nothing: the batch is dropped by generation, no row is recreated", async () => {
    const client = await fresh();
    await persistTwoVisitsUnderV1(client);
    await step(client, { op: "start-visit" }, v2);
    const id = await identity(client, "v4");
    // The independent probe's shape: erase on the first database call the store makes (before its write transaction can begin).
    let armed = true;
    const proxy = new Proxy(client, {
      get(target, key) {
        if (key === "execute") {
          return async (q: unknown) => {
            if (armed) {
              armed = false;
              await deleteChildRecords(client, "santiago", "synthetic-owner");
            }
            return target.execute(q as never);
          };
        }
        const v = (target as unknown as Record<string | symbol, unknown>)[key];
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    const out = await recordTelemetry(proxy as Client, "santiago", v2.contentId, { ...id, batchId: "race", events: [{ t: 1, kind: "submit", detail: { op: "start-visit", ok: true } }] });
    deepStrictEqual(out, { stored: false, accepted: 0, reason: "generation" });
    equal(Number((await client.execute("SELECT COUNT(*) AS c FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0].c), 0);
    equal(Number((await client.execute("SELECT COUNT(*) AS c FROM family_learning_telemetry WHERE child_id = 'santiago'")).rows[0].c), 0);
    // A deletion that commits AFTER the store removes the row (no window between the two).
    const client2 = await fresh();
    await persistTwoVisitsUnderV1(client2);
    await step(client2, { op: "start-visit" }, v2);
    const id2 = await identity(client2, "v4");
    equal((await recordTelemetry(client2, "santiago", v2.contentId, { ...id2, batchId: "before", events: [{ t: 1, kind: "hidden" }] })).stored, true);
    await deleteChildRecords(client2, "santiago", "synthetic-owner");
    equal(Number((await client2.execute("SELECT COUNT(*) AS c FROM family_learning_telemetry WHERE child_id = 'santiago'")).rows[0].c), 0);
  });
  it("P2 — an old batch replayed after erasure and a fresh visit never attaches (stale generation; stale visit instance)", async () => {
    const client = await fresh();
    await step(client, { op: "start-visit" }, v2);
    const old = await identity(client, "v1");
    const batch = { ...old, batchId: "old-batch", events: [{ t: 1, kind: "control", stage: "my private typed words", detail: { key: "PRIVATE_RAW_KEY", text: "PRIVATE_RAW_TEXT" } }, { t: 2, kind: "hidden" }] };
    equal((await recordTelemetry(client, "santiago", v2.contentId, batch)).stored, true);
    await deleteChildRecords(client, "santiago", "synthetic-owner");
    await step(client, { op: "start-visit" }, v2);
    const replay = await recordTelemetry(client, "santiago", v2.contentId, batch);
    deepStrictEqual(replay, { stored: false, accepted: 0, reason: "generation" });
    // Even with the new generation, the old visit instance (startedAt) does not match the fresh v1.
    const fresh2 = await identity(client, "v1");
    const wrongInstance = await recordTelemetry(client, "santiago", v2.contentId, { ...batch, erasureGeneration: fresh2.erasureGeneration });
    deepStrictEqual(wrongInstance, { stored: false, accepted: 0, reason: "no-visit" });
    const rows = await client.execute("SELECT events_json FROM family_learning_telemetry WHERE child_id = 'santiago'");
    equal(rows.rows.length, 0);
  });
  it("P4 — stored JSON never contains free text: arbitrary stage/detail strings are dropped, only enumerated values remain", async () => {
    const client = await fresh();
    await step(client, { op: "start-visit" }, v2);
    const id = await identity(client, "v1");
    const out = await recordTelemetry(client, "santiago", v2.contentId, {
      ...id,
      batchId: "priv",
      events: [
        { t: 1, kind: "control", stage: "my private typed words", detail: { key: "PRIVATE_RAW_KEY", text: "PRIVATE_RAW_TEXT" } },
        { t: 2, kind: "control", stage: "name-base", detail: { name: "stop", key: "PRIVATE_RAW_KEY", text: "PRIVATE_RAW_TEXT" } },
        { t: 3, kind: "submit", stage: "name-base", detail: { op: "name-base", ok: true, raw: "PRIVATE_BASE_NAME" } },
        { t: 4, kind: "active-interval", stage: "name-base", detail: { seconds: 7, note: "PRIVATE" } },
      ],
    });
    deepStrictEqual(out, { stored: true, accepted: 3 });
    const stored = String((await client.execute("SELECT events_json FROM family_learning_telemetry WHERE child_id = 'santiago'")).rows[0].events_json);
    ok(!stored.includes("PRIVATE"), stored);
    deepStrictEqual(JSON.parse(stored), [
      { t: 2, kind: "control", stage: "name-base", detail: { name: "stop" } },
      { t: 3, kind: "submit", stage: "name-base", detail: { op: "name-base", ok: true } },
      { t: 4, kind: "active-interval", stage: "name-base", detail: { seconds: 7 } },
    ]);
  });
  it("P3 — a historical review is derived inside the fenced transaction: erasure before it creates nothing and no private log text reappears", async () => {
    const client = await fresh();
    await step(client, { op: "start-visit" }, v2);
    // The independent probe's fixture: a finished v1 whose page holds private text, no completion row yet.
    const row = await client.execute("SELECT state_json FROM family_learning_missions WHERE child_id = 'santiago'");
    const s = JSON.parse(String(row.rows[0].state_json));
    s.visits[0].finishedAt = new Date().toISOString();
    s.currentVisit = null;
    s.pages = [{ visit: "v1", title: "x", baseName: "x", locationId: null, supplies: {}, explanation: null, text: "ERASED_PRIVATE_LOG", at: s.visits[0].startedAt }];
    await client.execute({ sql: "UPDATE family_learning_missions SET state_json = ? WHERE child_id = 'santiago'", args: [JSON.stringify(s)] });
    let armed = true;
    const proxy = new Proxy(client, {
      get(target, key) {
        if (key === "execute") {
          return async (q: unknown) => {
            if (armed) {
              armed = false;
              await deleteChildRecords(client, "santiago", "synthetic-owner");
            }
            return target.execute(q as never);
          };
        }
        const v = (target as unknown as Record<string | symbol, unknown>)[key];
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    const created = await ensureHistoricalCompletions(proxy as Client, "santiago", v2);
    equal(created, 0);
    const rows = await client.execute("SELECT review_json FROM family_learning_completions WHERE child_id = 'santiago'");
    equal(rows.rows.length, 0);
    ok(!JSON.stringify(rows.rows).includes("ERASED_PRIVATE_LOG"));
    // Without the interleaving the same fixture yields exactly one historical review, and a later erasure removes it.
    const client2 = await fresh();
    await step(client2, { op: "start-visit" }, v2);
    await client2.execute({ sql: "UPDATE family_learning_missions SET state_json = ? WHERE child_id = 'santiago'", args: [JSON.stringify(s)] });
    equal(await ensureHistoricalCompletions(client2, "santiago", v2), 1);
    equal(await ensureHistoricalCompletions(client2, "santiago", v2), 0);
    await deleteChildRecords(client2, "santiago", "synthetic-owner");
    equal(Number((await client2.execute("SELECT COUNT(*) AS c FROM family_learning_completions")).rows[0].c), 0);
  });
});

describe("deletion covers derived and queued data (F6/R4)", () => {
  it("deletes completions and telemetry with the child's records, keeps another child's rows, and the erasure fence advances", async () => {
    const client = await fresh();
    await persistTwoVisitsUnderV1(client);
    await recordTelemetry(client, "santiago", v2.contentId, { ...(await identity(client, "v1")), batchId: "b1", events: [{ t: 1, kind: "submit", detail: { op: "save-log", ok: true } }] });
    await readEvidence(client, "santiago", v2.contentId, undefined, v2); // backfills historical reviews
    await applyMutation(client, { child: "isabel", op: { op: "start-visit" }, idempotencyKey: "i1", expectedRevision: 0 }, v2);
    equal(Number((await client.execute("SELECT COUNT(*) AS c FROM family_learning_completions WHERE child_id = 'santiago'")).rows[0].c), 2);
    const counts = await deleteChildRecords(client, "santiago", "info@davideberle.com");
    equal(counts.family_learning_completions, 2);
    equal(counts.family_learning_telemetry, 1);
    equal(Number((await client.execute("SELECT COUNT(*) AS c FROM family_learning_completions")).rows[0].c), 0);
    equal(Number((await client.execute("SELECT COUNT(*) AS c FROM family_learning_telemetry")).rows[0].c), 0);
    const after = await readEvidence(client, "santiago", v2.contentId, undefined, v2);
    equal(after.completions.length, 0, "no review is resurrected by the read-time backfill after deletion");
    equal(after.erasureGeneration, 1);
    equal((await readChildView(client, "isabel", v2)).revision, 1);
  });
});

describe("round 2 — transfer and feedback rows are persisted with the visit and erased with the child", () => {
  it("writing_transfer sample + attempt rows, the visit feedback and the review's child feedback exist after chapter 4 and are gone after erasure", async () => {
    const client = await fresh();
    await persistTwoVisitsUnderV1(client);
    await completeVisit4(client);
    await step(client, { op: "reflect", optionId: "right", feedback: { enjoyment: "partly", clarity: "unclear" } }, v2);
    const ev = await readEvidence(client, "santiago", v2.contentId, undefined, v2);
    equal(ev.samples.filter((s) => s.kind === "writing_transfer").length, 1);
    const attempt = ev.attempts.find((a) => a.taskId === "WRITE-TRANSFER-1")!;
    equal(attempt.objective, "writing-spacing-transfer");
    equal(attempt.evidence, "supported");
    const review = ev.completions.find((c) => c.visitId === "v4")!.review!;
    deepStrictEqual(review.experience.childFeedback, { difficulty: "right", enjoyment: "partly", clarity: "unclear", skipped: [], unanswered: [], notOffered: [] });
    ok(review.learning.objectives.some((o) => o.taskId === "WRITE-TRANSFER-1"));
    // Replaying the finishing reflect with the same key stores nothing twice.
    equal(ev.completions.length, 3);
    await deleteChildRecords(client, "santiago", "info@davideberle.com");
    const after = await readEvidence(client, "santiago", v2.contentId, undefined, v2);
    equal(after.samples.length, 0);
    equal(after.attempts.length, 0);
    equal(after.completions.length, 0);
    equal(after.state, null);
  });
});

describe("round 3 — malformed persisted legacy JSON fails honestly and a restarted process replays the finishing key once", () => {
  it("M8: unparsable state_json throws on read (route → 503/500 recoverable load error), never a silent reset or a fresh mission", async () => {
    const client = await fresh();
    await persistTwoVisitsUnderV1(client);
    await client.execute("UPDATE family_learning_missions SET state_json = '{not json' WHERE child_id = 'santiago'");
    let threw = false;
    try {
      await readChildView(client, "santiago", v2);
    } catch {
      threw = true;
    }
    ok(threw, "the malformed row is reported, not replaced");
    equal(String((await client.execute("SELECT state_json FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0].state_json), "{not json", "the row is untouched");
    equal(Number((await client.execute("SELECT COUNT(*) AS c FROM family_learning_missions")).rows[0].c), 1, "no second mission was created");
  });
  it("R1: after a process restart (new client on the same file) the finishing reflect replays with its key — one completion, one feedback record", async () => {
    const client = await fresh();
    await persistTwoVisitsUnderV1(client);
    await completeVisit4(client);
    const view = await readChildView(client, "santiago", v2);
    const finishKey = key();
    const first = await applyMutation(client, { child: "santiago", op: { op: "reflect", optionId: null, difficultySkipped: true, feedback: { enjoyment: "yes" } }, idempotencyKey: finishKey, expectedRevision: view.revision }, v2);
    equal(first.status, "applied");
    const restarted = createClient({ url: `file:${join(dir, `db-${n}.sqlite`)}` });
    clients.push(restarted);
    const replay = await applyMutation(restarted, { child: "santiago", op: { op: "reflect", optionId: null, difficultySkipped: true, feedback: { enjoyment: "yes" } }, idempotencyKey: finishKey, expectedRevision: view.revision }, v2);
    equal(replay.status, "replayed");
    const rows = await restarted.execute("SELECT COUNT(*) AS c FROM family_learning_completions WHERE child_id = 'santiago' AND visit_id = 'v4'");
    equal(Number(rows.rows[0].c), 1);
    const ev = await readEvidence(restarted, "santiago", v2.contentId, undefined, v2);
    deepStrictEqual(ev.state!.visits.find((v) => v.id === "v4")!.feedback, { answers: { enjoyment: "yes" }, skipped: ["difficulty"], unanswered: ["clarity"], offered: ["difficulty", "enjoyment", "clarity"] });
    deepStrictEqual(ev.completions.find((c) => c.visitId === "v4")!.review!.experience.childFeedback, { difficulty: null, enjoyment: "yes", clarity: null, skipped: ["difficulty"], unanswered: ["clarity"], notOffered: [] });
  });
});

describe("round 4 — R4-1 server-owned feedback telemetry, R4-3 review refresh, R1 completion matrix", () => {
  const fbEvents = async (client: Client) => (await client.execute("SELECT batch_id, events_json FROM family_learning_telemetry WHERE child_id = 'santiago' AND visit_id = 'v4'")).rows.flatMap((r) => (JSON.parse(String(r.events_json)) as { kind: string; detail: { dimension: string; option: string } }[]).filter((e) => e.kind === "feedback").map((e) => ({ batch: String(r.batch_id), ...e.detail })));
  it("R4-1: the finishing reflect writes exactly one feedback event per answered dimension in its own transaction; replay, new key, restart and erasure keep it exactly-once", async () => {
    const client = await fresh();
    await persistTwoVisitsUnderV1(client);
    await completeVisit4(client);
    const view = await readChildView(client, "santiago", v2);
    const finishKey = key();
    const first = await applyMutation(client, { child: "santiago", op: { op: "reflect", optionId: "right", feedback: { enjoyment: "yes", clarity: null } }, idempotencyKey: finishKey, expectedRevision: view.revision }, v2);
    equal(first.status, "applied");
    const events = await fbEvents(client);
    deepStrictEqual(events.map((e) => [e.dimension, e.option]).sort(), [["difficulty", "right"], ["enjoyment", "yes"]], "answered dimensions only; the skipped one produces no event");
    equal(new Set(events.map((e) => e.batch)).size, 1);
    equal(events[0].batch, `fb-${finishKey}`);
    // The review built in the same transaction already counts the batch.
    const ev = await readEvidence(client, "santiago", v2.contentId, undefined, v2);
    const review = ev.completions.find((c) => c.visitId === "v4")!.review!;
    ok(review.experience.telemetry.events >= 2 && review.experience.telemetry.supported);
    // Same key → replayed, nothing added; new key at the old revision → stale, nothing added; process restart → same.
    equal((await applyMutation(client, { child: "santiago", op: { op: "reflect", optionId: "right", feedback: { enjoyment: "yes", clarity: null } }, idempotencyKey: finishKey, expectedRevision: view.revision }, v2)).status, "replayed");
    equal((await applyMutation(client, { child: "santiago", op: { op: "reflect", optionId: "tricky" }, idempotencyKey: key(), expectedRevision: view.revision }, v2)).status, "stale");
    const restarted = createClient({ url: `file:${join(dir, `db-${n}.sqlite`)}` });
    clients.push(restarted);
    equal((await applyMutation(restarted, { child: "santiago", op: { op: "reflect", optionId: "right", feedback: { enjoyment: "yes", clarity: null } }, idempotencyKey: finishKey, expectedRevision: view.revision }, v2)).status, "replayed");
    equal((await fbEvents(restarted)).length, 2);
    equal(Number((await restarted.execute("SELECT COUNT(*) AS c FROM family_learning_completions WHERE child_id = 'santiago' AND visit_id = 'v4'")).rows[0].c), 1);
    // Nothing answered → no feedback batch at all; erasure removes everything.
    const client2 = await fresh();
    await persistTwoVisitsUnderV1(client2);
    await completeVisit4(client2);
    await step(client2, { op: "reflect", optionId: null, difficultySkipped: true, feedback: { enjoyment: null, clarity: null } }, v2);
    equal((await fbEvents(client2)).length, 0);
    await deleteChildRecords(client, "santiago", "info@davideberle.com");
    equal((await fbEvents(client)).length, 0);
  });
  it("R4-3: a stored review that still credits an unassessable transfer is re-derived on read — identity, dates and original text kept, the earlier derivation retained; repeated reads, restart and erasure behave", async () => {
    const client = await fresh();
    await persistTwoVisitsUnderV1(client);
    await completeVisit4(client);
    await step(client, { op: "reflect", optionId: "right" }, v2);
    // Turn the persisted records into the archived round-2 shape: transfer text "Hallo" credited clean, review crediting correct/independent, no review version.
    const row = (await client.execute("SELECT state_json, review_json FROM family_learning_missions m JOIN family_learning_completions c ON c.child_id = m.child_id AND c.visit_id = 'v4' WHERE m.child_id = 'santiago'")).rows[0];
    const s = JSON.parse(String(row.state_json));
    const t = s.transfers.at(-1);
    delete t.assessed;
    t.text = "Hallo";
    t.outcome = "clean";
    await client.execute({ sql: "UPDATE family_learning_missions SET state_json = ? WHERE child_id = 'santiago'", args: [JSON.stringify(s)] });
    const oldReview = JSON.parse(String(row.review_json));
    delete oldReview.identity.reviewVersion;
    delete oldReview.identity.derivedAt;
    delete oldReview.previousReviews;
    const obj = oldReview.learning.objectives.find((o: { taskId: string }) => o.taskId === "WRITE-TRANSFER-1");
    obj.outcome = "correct";
    obj.evidence = "independent";
    obj.support = [];
    await client.execute({ sql: "UPDATE family_learning_completions SET review_json = ? WHERE child_id = 'santiago' AND visit_id = 'v4'", args: [JSON.stringify(oldReview)] });
    const before = (await client.execute("SELECT completion_id, finished_at, created_at FROM family_learning_completions WHERE child_id = 'santiago' AND visit_id = 'v4'")).rows[0];
    const ev = await readEvidence(client, "santiago", v2.contentId, undefined, v2);
    const c4 = ev.completions.find((c) => c.visitId === "v4")!;
    const now = c4.review!.learning.objectives.find((o) => o.taskId === "WRITE-TRANSFER-1")!;
    equal(now.evidence, "unscored");
    equal(now.outcome, "unscored");
    equal(c4.review!.identity.reviewVersion, REVIEW_VERSION);
    equal(c4.review!.previousReviews!.length, 1);
    equal(c4.review!.previousReviews![0].objectives.find((o) => o.taskId === "WRITE-TRANSFER-1")!.evidence, "independent", "the earlier derivation is retained for provenance");
    const after = (await client.execute("SELECT completion_id, finished_at, created_at FROM family_learning_completions WHERE child_id = 'santiago' AND visit_id = 'v4'")).rows[0];
    deepStrictEqual(after, before, "identity and dates unchanged");
    equal(ev.state!.transfers!.at(-1)!.text, "Hallo", "original text preserved");
    equal(ev.state!.transfers!.at(-1)!.outcome, "unassessable");
    // Repeated read: stable, no second previous entry; restart: same; the other completions (v1/v2 historical) were refreshed once too and keep their meaning.
    const ev2 = await readEvidence(client, "santiago", v2.contentId, undefined, v2);
    equal(ev2.completions.find((c) => c.visitId === "v4")!.review!.previousReviews!.length, 1);
    const restarted = createClient({ url: `file:${join(dir, `db-${n}.sqlite`)}` });
    clients.push(restarted);
    const ev3 = await readEvidence(restarted, "santiago", v2.contentId, undefined, v2);
    equal(ev3.completions.find((c) => c.visitId === "v4")!.review!.previousReviews!.length, 1);
    equal(ev3.completions.length, 3);
    ok(ev3.completions.filter((c) => c.historical).every((c) => c.review!.identity.reviewVersion === REVIEW_VERSION));
    // Controls: an assessed clean transfer keeps its credit through a refresh; helped stays supported; spoken stays unscored.
    const c2 = await fresh();
    await persistTwoVisitsUnderV1(c2);
    await completeVisit4(c2);
    await step(c2, { op: "reflect", optionId: "right" }, v2);
    const r2 = (await c2.execute("SELECT review_json FROM family_learning_completions WHERE child_id = 'santiago' AND visit_id = 'v4'")).rows[0];
    const old2 = JSON.parse(String(r2.review_json));
    delete old2.identity.reviewVersion;
    await c2.execute({ sql: "UPDATE family_learning_completions SET review_json = ? WHERE child_id = 'santiago' AND visit_id = 'v4'", args: [JSON.stringify(old2)] });
    const evc = await readEvidence(c2, "santiago", v2.contentId, undefined, v2);
    const kept = evc.completions.find((c) => c.visitId === "v4")!.review!.learning.objectives.find((o) => o.taskId === "WRITE-TRANSFER-1")!;
    equal(kept.outcome, "correct");
    equal(kept.evidence, "supported", "clean after shown help stays supported after the refresh");
    // Erasure removes the refreshed review too.
    await deleteChildRecords(client, "santiago", "info@davideberle.com");
    equal((await readEvidence(client, "santiago", v2.contentId, undefined, v2)).completions.length, 0);
  });
  it("R1: completion matrix — same key replays, a new key at the old revision is stale, a stale tab (older revision) is stale, a second finish is refused; always exactly one completion", async () => {
    const client = await fresh();
    await persistTwoVisitsUnderV1(client);
    await completeVisit4(client);
    const view = await readChildView(client, "santiago", v2);
    const finishKey = key();
    equal((await applyMutation(client, { child: "santiago", op: { op: "reflect", optionId: "easy" }, idempotencyKey: finishKey, expectedRevision: view.revision }, v2)).status, "applied");
    equal((await applyMutation(client, { child: "santiago", op: { op: "reflect", optionId: "easy" }, idempotencyKey: finishKey, expectedRevision: view.revision }, v2)).status, "replayed");
    equal((await applyMutation(client, { child: "santiago", op: { op: "reflect", optionId: "easy" }, idempotencyKey: key(), expectedRevision: view.revision }, v2)).status, "stale");
    equal((await applyMutation(client, { child: "santiago", op: { op: "reflect", optionId: "easy" }, idempotencyKey: key(), expectedRevision: view.revision - 1 }, v2)).status, "stale");
    const current = await readChildView(client, "santiago", v2);
    equal((await applyMutation(client, { child: "santiago", op: { op: "reflect", optionId: "easy" }, idempotencyKey: key(), expectedRevision: current.revision }, v2)).status, "refused", "no visit is running any more");
    equal(Number((await client.execute("SELECT COUNT(*) AS c FROM family_learning_completions WHERE child_id = 'santiago' AND visit_id = 'v4'")).rows[0].c), 1);
  });
});

describe("round 5 — R5-1 request context fence, R5-2 UX missingness, R5-4 capped review projection", () => {
  const contextOf = async (client: Client) => {
    const view = await readChildView(client, "santiago", v2);
    return { erasureGeneration: view.erasureGeneration, visit: view.visit ? { id: view.visit.id, startedAt: view.visit.startedAt } : null };
  };
  const textAnywhere = async (client: Client, needle: string) => {
    const tables = ["missions", "mutations", "attempts", "work_samples", "completions", "telemetry", "exposures", "support_events"];
    const hits: string[] = [];
    for (const t of tables) {
      const rows = (await client.execute(`SELECT * FROM family_learning_${t}`)).rows;
      if (JSON.stringify(rows).includes(needle)) hits.push(t);
    }
    return hits;
  };
  /** Erase the child and rebuild the same v4 state up to the same stage — the revision number repeats, the generation and the visit start do not. */
  const eraseAndRecreate = async (client: Client, toStage: "transfer" | "reflect") => {
    await deleteChildRecords(client, "santiago", "info@davideberle.com");
    await persistTwoVisitsUnderV1(client);
    await completeVisit4(client, toStage === "reflect" ? undefined : "up-to-transfer");
  };
  it("R5-1 transfer: an old mounted request (old generation / old visit instance, same revision) is stale after erase + recreate — same key and new key — and nothing of it is stored; the fresh generation accepts new work; the same-generation lost-ACK retry replays", async () => {
    const client = await fresh();
    await persistTwoVisitsUnderV1(client);
    await completeVisit4(client, "up-to-transfer");
    const oldCtx = await contextOf(client);
    const oldView = await readChildView(client, "santiago", v2);
    equal(oldView.visit?.stage, "log-transfer");
    const oldKey = key();
    const oldOp = { op: "write-transfer", text: "Ich sehe 3 Wellen.", modality: "typed" } as LearningOp;
    // The request "failed before commit" (never sent). Now the owner erases and the child legitimately rebuilds the same state.
    await eraseAndRecreate(client, "transfer");
    const newView = await readChildView(client, "santiago", v2);
    equal(newView.revision, oldView.revision, "the revision number repeats after recreation");
    ok(newView.erasureGeneration !== oldView.erasureGeneration && newView.visit!.startedAt !== oldView.visit!.startedAt);
    const stale1 = await applyMutation(client, { child: "santiago", op: oldOp, idempotencyKey: oldKey, expectedRevision: oldView.revision, context: oldCtx }, v2);
    equal(stale1.status, "stale");
    equal((stale1 as { reason?: string }).reason, "generation");
    const stale2 = await applyMutation(client, { child: "santiago", op: oldOp, idempotencyKey: key(), expectedRevision: oldView.revision, context: oldCtx }, v2);
    equal(stale2.status, "stale", "a new key with the old identity is stale too");
    const stale3 = await applyMutation(client, { child: "santiago", op: oldOp, idempotencyKey: key(), expectedRevision: newView.revision, context: { erasureGeneration: newView.erasureGeneration, visit: oldCtx.visit } }, v2);
    equal(stale3.status, "stale", "the right generation but the old visit instance is stale");
    equal((stale3 as { reason?: string }).reason, "visit");
    deepStrictEqual(await textAnywhere(client, "Wellen"), [], "nothing of the old draft reached any table");
    equal(((await loadMissionState(client, "santiago", v2.contentId, v2))!.transfers ?? []).length, 0);
    equal(Number((await client.execute({ sql: "SELECT COUNT(*) AS c FROM family_learning_mutations WHERE idempotency_key = ?", args: [oldKey] })).rows[0].c), 0, "no ledger row for a stale request");
    // Positive: the same words typed fresh in the new generation apply once; the same-generation lost-ACK retry replays.
    const freshKey = key();
    const fresh1 = await applyMutation(client, { child: "santiago", op: oldOp, idempotencyKey: freshKey, expectedRevision: newView.revision, context: await contextOf(client) }, v2);
    equal(fresh1.status, "applied");
    const replay = await applyMutation(client, { child: "santiago", op: oldOp, idempotencyKey: freshKey, expectedRevision: newView.revision, context: { erasureGeneration: newView.erasureGeneration, visit: { id: newView.visit!.id, startedAt: newView.visit!.startedAt } } }, v2);
    equal(replay.status, "replayed");
    equal(((await loadMissionState(client, "santiago", v2.contentId, v2))!.transfers ?? []).length, 1);
    // Process restart: the replay still holds; the old identity is still stale.
    const restarted = createClient({ url: `file:${join(dir, `db-${n}.sqlite`)}` });
    clients.push(restarted);
    equal((await applyMutation(restarted, { child: "santiago", op: oldOp, idempotencyKey: freshKey, expectedRevision: newView.revision, context: { erasureGeneration: newView.erasureGeneration, visit: { id: newView.visit!.id, startedAt: newView.visit!.startedAt } } }, v2)).status, "replayed");
    equal((await applyMutation(restarted, { child: "santiago", op: oldOp, idempotencyKey: key(), expectedRevision: oldView.revision, context: oldCtx }, v2)).status, "stale");
  });
  it("R5-1 reflect: the old finishing request is stale after erase + recreate (same revision); no completion, review or feedback telemetry from it; the fresh generation finishes once", async () => {
    const client = await fresh();
    await persistTwoVisitsUnderV1(client);
    await completeVisit4(client);
    const oldCtx = await contextOf(client);
    const oldView = await readChildView(client, "santiago", v2);
    equal(oldView.visit?.stage, "reflect");
    const oldKey = key();
    const reflect = { op: "reflect", optionId: "right", feedback: { enjoyment: "yes", clarity: "clear" } } as LearningOp;
    await eraseAndRecreate(client, "reflect");
    const newView = await readChildView(client, "santiago", v2);
    equal(newView.revision, oldView.revision);
    equal((await applyMutation(client, { child: "santiago", op: reflect, idempotencyKey: oldKey, expectedRevision: oldView.revision, context: oldCtx }, v2)).status, "stale");
    equal((await applyMutation(client, { child: "santiago", op: reflect, idempotencyKey: key(), expectedRevision: oldView.revision, context: oldCtx }, v2)).status, "stale");
    equal(Number((await client.execute("SELECT COUNT(*) AS c FROM family_learning_completions WHERE child_id = 'santiago' AND visit_id = 'v4'")).rows[0].c), 0);
    equal(Number((await client.execute("SELECT COUNT(*) AS c FROM family_learning_telemetry WHERE child_id = 'santiago'")).rows[0].c), 0);
    ok(!(await readChildView(client, "santiago", v2)).visit || (await readChildView(client, "santiago", v2)).visit!.stage === "reflect", "the recreated visit is untouched");
    const freshKey = key();
    equal((await applyMutation(client, { child: "santiago", op: reflect, idempotencyKey: freshKey, expectedRevision: newView.revision, context: await contextOf(client) }, v2)).status, "applied");
    equal((await applyMutation(client, { child: "santiago", op: reflect, idempotencyKey: freshKey, expectedRevision: newView.revision, context: { erasureGeneration: newView.erasureGeneration, visit: { id: "v4", startedAt: newView.visit!.startedAt } } }, v2)).status, "replayed");
    equal(Number((await client.execute("SELECT COUNT(*) AS c FROM family_learning_completions WHERE child_id = 'santiago' AND visit_id = 'v4'")).rows[0].c), 1);
    const events = (await client.execute("SELECT events_json FROM family_learning_telemetry WHERE child_id = 'santiago'")).rows.flatMap((r) => JSON.parse(String(r.events_json)) as { kind: string }[]);
    equal(events.filter((e) => e.kind === "feedback").length, 3);
    // Under the version-1 cap a started chapter 4 is parked and absent from the view: the client's honest "no visit" context matches and the op meets the ordinary refusal (ROLLBACK-CONTRACT), never a stale answer.
    const cap = await fresh();
    await persistTwoVisitsUnderV1(cap);
    await completeVisit4(cap, "up-to-transfer");
    const cappedView = await readChildView(cap, "santiago", v1);
    equal(cappedView.visit, null);
    const parked = await applyMutation(cap, { child: "santiago", op: { op: "typing-course-continue" }, idempotencyKey: key(), expectedRevision: cappedView.revision, context: { erasureGeneration: cappedView.erasureGeneration, visit: null } }, v1);
    equal(parked.status, "refused");
    const parkedStart = await applyMutation(cap, { child: "santiago", op: { op: "start-visit" }, idempotencyKey: key(), expectedRevision: cappedView.revision, context: { erasureGeneration: cappedView.erasureGeneration, visit: null } }, v1);
    equal(parkedStart.status, "refused");
    // A context whose visit is "none" while a visit runs, or a running visit while none is expected, is stale as well; a start-visit with the honest "none" context applies.
    const c2 = await fresh();
    await persistTwoVisitsUnderV1(c2);
    const v = await readChildView(c2, "santiago", v2);
    equal((await applyMutation(c2, { child: "santiago", op: { op: "start-visit" }, idempotencyKey: key(), expectedRevision: v.revision, context: { erasureGeneration: v.erasureGeneration, visit: { id: "v4", startedAt: "2026-09-30T00:00:00.000Z" } } }, v2)).status, "stale");
    equal((await applyMutation(c2, { child: "santiago", op: { op: "start-visit" }, idempotencyKey: key(), expectedRevision: v.revision, context: { erasureGeneration: v.erasureGeneration, visit: null } }, v2)).status, "applied");
  });
  it("R5-2 persisted: a completion whose only telemetry is the server-owned feedback reports UX as unobserved (null, never 0) on the API; a stored older review with zeros is re-derived on read; observed UX keeps its numbers", async () => {
    const client = await fresh();
    await persistTwoVisitsUnderV1(client);
    await completeVisit4(client);
    await step(client, { op: "reflect", optionId: "right", feedback: { enjoyment: "yes", clarity: "clear" } }, v2);
    let ev = await readEvidence(client, "santiago", v2.contentId, undefined, v2);
    let tele = ev.completions.find((c) => c.visitId === "v4")!.review!.experience.telemetry;
    equal(tele.supported, true);
    equal(tele.uxObserved, false);
    equal(tele.feedbackEvents, 3);
    equal(tele.foregroundActiveSeconds, null);
    equal(tele.hiddenIntervals, null);
    equal(tele.saveFailures, null);
    equal(tele.retries, null);
    ok(ev.completions.find((c) => c.visitId === "v4")!.review!.experience.missing.some((m) => /nicht erfasst/.test(m)));
    equal(ev.completions.find((c) => c.visitId === "v4")!.review!.experience.hypotheses.length, 0);
    equal(ev.completions.find((c) => c.visitId === "v4")!.derivation.status, "current");
    // Legacy: the same completion stored under the round-4 rules with false zeros.
    const row = (await client.execute("SELECT review_json FROM family_learning_completions WHERE child_id = 'santiago' AND visit_id = 'v4'")).rows[0];
    const old = JSON.parse(String(row.review_json));
    old.identity.reviewVersion = 3;
    old.experience.telemetry = { supported: true, batches: 1, events: 3, foregroundActiveSeconds: 0, idleRuleSeconds: 60, hiddenIntervals: 0, saveFailures: 0, retries: 0, corrections: 0, hints: 0, pauses: 0, byStage: {} };
    old.experience.missing = old.experience.missing.filter((m: string) => !/nicht erfasst/.test(m));
    await client.execute({ sql: "UPDATE family_learning_completions SET review_json = ? WHERE child_id = 'santiago' AND visit_id = 'v4'", args: [JSON.stringify(old)] });
    ev = await readEvidence(client, "santiago", v2.contentId, undefined, v2);
    const c4 = ev.completions.find((c) => c.visitId === "v4")!;
    tele = c4.review!.experience.telemetry;
    equal(c4.review!.identity.reviewVersion, REVIEW_VERSION);
    equal(tele.uxObserved, false);
    equal(tele.foregroundActiveSeconds, null);
    equal(c4.review!.previousReviews!.length, 1);
    equal(c4.review!.previousReviews![0].reviewVersion, 3);
    // Control: delivered UX telemetry keeps numbers, including a genuine zero.
    const c2 = await fresh();
    await persistTwoVisitsUnderV1(c2);
    await completeVisit4(c2);
    await recordTelemetry(c2, "santiago", v2.contentId, { ...(await identity(c2, "v4")), batchId: "ux-1", events: [{ t: 1, kind: "stage-enter", stage: "reflect" }, { t: 2, kind: "active-interval", stage: "reflect", detail: { seconds: 7 } }] });
    await step(c2, { op: "reflect", optionId: "right", feedback: { enjoyment: "yes", clarity: "clear" } }, v2);
    const t2 = (await readEvidence(c2, "santiago", v2.contentId, undefined, v2)).completions.find((c) => c.visitId === "v4")!.review!.experience.telemetry;
    equal(t2.uxObserved, true);
    equal(t2.foregroundActiveSeconds, 7);
    equal(t2.hiddenIntervals, 0);
    equal(t2.feedbackEvents, 3);
    ok(t2.unobservedStages!.includes("restore") && !t2.unobservedStages!.includes("reflect"));
  });
  it("R5-4: under the version-1 cap an archived chapter-4 review that predates the learning rules is served as obsolete (no credit, raw facts kept) without any write; repeated reads and a fresh process agree; without the cap it is re-derived; a current-rules review under the cap is served as stored with a projected UX summary", async () => {
    const client = await fresh();
    await persistTwoVisitsUnderV1(client);
    await completeVisit4(client);
    await step(client, { op: "reflect", optionId: "right", feedback: { enjoyment: "yes", clarity: "clear" } }, v2);
    // Archived round-2 shape: Hallo credited clean, review crediting correct/independent, no review version.
    const row = (await client.execute("SELECT state_json, review_json FROM family_learning_missions m JOIN family_learning_completions c ON c.child_id = m.child_id AND c.visit_id = 'v4' WHERE m.child_id = 'santiago'")).rows[0];
    const s = JSON.parse(String(row.state_json));
    const t = s.transfers.at(-1);
    delete t.assessed;
    t.text = "Hallo";
    t.outcome = "clean";
    await client.execute({ sql: "UPDATE family_learning_missions SET state_json = ? WHERE child_id = 'santiago'", args: [JSON.stringify(s)] });
    const oldReview = JSON.parse(String(row.review_json));
    delete oldReview.identity.reviewVersion;
    delete oldReview.identity.derivedAt;
    delete oldReview.previousReviews;
    const obj = oldReview.learning.objectives.find((o: { taskId: string }) => o.taskId === "WRITE-TRANSFER-1");
    obj.outcome = "correct";
    obj.evidence = "independent";
    await client.execute({ sql: "UPDATE family_learning_completions SET review_json = ? WHERE child_id = 'santiago' AND visit_id = 'v4'", args: [JSON.stringify(oldReview)] });
    const rowsBefore = async () => JSON.stringify((await client.execute("SELECT * FROM family_learning_completions WHERE child_id = 'santiago' AND visit_id = 'v4'")).rows) + JSON.stringify((await client.execute("SELECT state_json, revision FROM family_learning_missions WHERE child_id = 'santiago'")).rows) + JSON.stringify((await client.execute("SELECT * FROM family_learning_attempts WHERE child_id = 'santiago'")).rows);
    const before = await rowsBefore();
    // Cap-first: read under version-1 content before any uncapped read.
    const capped = await readEvidence(client, "santiago", v1.contentId, undefined, v1);
    const c4 = capped.completions.find((c) => c.visitId === "v4")!;
    equal(c4.derivation.status, "obsolete");
    equal(c4.review, null, "no learning credit is served from the obsolete derivation");
    ok(!JSON.stringify(c4).includes('"independent"'), "the disproven credit appears nowhere in the served completion");
    if (c4.derivation.status === "obsolete") {
      equal(c4.derivation.storedVersion, 1);
      equal(c4.derivation.reason, "visit-not-served");
      equal(c4.derivation.retained.childFeedback!.difficulty, "right");
      equal(c4.derivation.retained.telemetry.uxObserved, false);
    }
    equal(c4.completionId, JSON.parse(String(row.review_json)).identity.completionId);
    equal(await rowsBefore(), before, "chapter-4 rows are byte-identical after the capped read");
    ok(capped.completions.filter((c) => c.historical).every((c) => c.review!.identity.reviewVersion === REVIEW_VERSION), "the visits the served content knows are refreshed normally");
    const again = await readEvidence(client, "santiago", v1.contentId, undefined, v1);
    equal(again.completions.find((c) => c.visitId === "v4")!.derivation.status, "obsolete");
    equal(await rowsBefore(), before);
    const restarted = createClient({ url: `file:${join(dir, `db-${n}.sqlite`)}` });
    clients.push(restarted);
    equal((await readEvidence(restarted, "santiago", v1.contentId, undefined, v1)).completions.find((c) => c.visitId === "v4")!.derivation.status, "obsolete");
    equal(await rowsBefore(), before);
    // Cap removed: the review is re-derived (one write), unscored, with the earlier derivation disclosed.
    const uncapped = await readEvidence(client, "santiago", v2.contentId, undefined, v2);
    const fixed = uncapped.completions.find((c) => c.visitId === "v4")!;
    equal(fixed.derivation.status, "current");
    equal(fixed.review!.learning.objectives.find((o) => o.taskId === "WRITE-TRANSFER-1")!.evidence, "unscored");
    equal(fixed.review!.previousReviews![0].objectives.find((o) => o.taskId === "WRITE-TRANSFER-1")!.evidence, "independent");
    // Control: a review stored under the current learning rules (version 3, assessed clean after help = supported) is served as stored under the cap, UX projected, nothing written.
    const c2 = await fresh();
    await persistTwoVisitsUnderV1(c2);
    await completeVisit4(c2);
    await step(c2, { op: "reflect", optionId: "right" }, v2);
    const r2 = (await c2.execute("SELECT review_json FROM family_learning_completions WHERE child_id = 'santiago' AND visit_id = 'v4'")).rows[0];
    const v3 = JSON.parse(String(r2.review_json));
    v3.identity.reviewVersion = LEARNING_RULES_VERSION;
    v3.experience.telemetry = { ...v3.experience.telemetry, foregroundActiveSeconds: 0, hiddenIntervals: 0, saveFailures: 0, retries: 0, corrections: 0, hints: 0, pauses: 0 };
    await c2.execute({ sql: "UPDATE family_learning_completions SET review_json = ? WHERE child_id = 'santiago' AND visit_id = 'v4'", args: [JSON.stringify(v3)] });
    const stored = JSON.stringify((await c2.execute("SELECT * FROM family_learning_completions WHERE child_id = 'santiago' AND visit_id = 'v4'")).rows);
    const cap2 = (await readEvidence(c2, "santiago", v1.contentId, undefined, v1)).completions.find((c) => c.visitId === "v4")!;
    equal(cap2.derivation.status, "projected");
    equal(cap2.review!.learning.objectives.find((o) => o.taskId === "WRITE-TRANSFER-1")!.evidence, "supported", "current-rules credit stays visible under the cap");
    equal(cap2.review!.experience.telemetry.uxObserved, false);
    equal(cap2.review!.experience.telemetry.foregroundActiveSeconds, null, "the projected UX summary does not repeat the stored false zero");
    equal(JSON.stringify((await c2.execute("SELECT * FROM family_learning_completions WHERE child_id = 'santiago' AND visit_id = 'v4'")).rows), stored, "nothing written under the cap");
    // Erase/read interleaving under the cap: nothing resurrects.
    await deleteChildRecords(c2, "santiago", "info@davideberle.com");
    equal((await readEvidence(c2, "santiago", v1.contentId, undefined, v1)).completions.length, 0);
  });
});
