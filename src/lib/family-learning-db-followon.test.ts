// September 30 follow-on — persistence: a production-shaped version-1 row is
// served with the chapter as Visit 3, the progress strip and the vocabulary
// ledger without any write; completions ground the strip; deletion erases
// derived data; the previous build can still read every row. Run: npm test

import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { createClient, type Client } from "@libsql/client";
import { asLearningContent } from "./family-learning-content.ts";
import { applyMutation, correctAttempt, deleteChildRecords, ensureLearningTables, loadMissionState, readChildView, readEvidence, readProgressSources } from "./family-learning-db.ts";
import type { LearningOp } from "./family-learning-state.ts";
import { REVIEW_VERSION } from "./family-learning-summary.ts";
import { asVocabularyInventory } from "./family-learning-vocabulary.ts";
import { isChildView } from "./family-learning-view-guard.ts";

const v1 = asLearningContent(JSON.parse(readFileSync(new URL("../data/family-learning/content/santiago-expedition-v1.json", import.meta.url), "utf8")));
const v2 = asLearningContent(JSON.parse(readFileSync(new URL("../data/family-learning/content/santiago-expedition-v2.json", import.meta.url), "utf8")));
const inventory = asVocabularyInventory(JSON.parse(readFileSync(new URL("../data/family-learning/content/vocabulary-inventory-v1.json", import.meta.url), "utf8")), v2);

const dir = mkdtempSync(join(tmpdir(), "family-learning-followon-"));
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
const key = () => `f-${(k += 1)}`;
/** Synthetic clock: 2026-09-29 13:28Z + one minute per call (the production visits' day). */
let t = Date.UTC(2026, 8, 29, 13, 28, 0);
const now = () => new Date((t += 60_000));
const TZ = "Europe/Zurich";
async function step(client: Client, op: LearningOp, content = v2, idempotencyKey = key(), timeZone: string | null = TZ) {
  const view = await readChildView(client, "santiago", content, now(), { timeZone, vocabulary: inventory });
  const context = { erasureGeneration: view.erasureGeneration, visit: view.visit ? { id: view.visit.id, startedAt: view.visit.startedAt } : null };
  const out = await applyMutation(client, { child: "santiago", op, idempotencyKey, expectedRevision: view.revision, context }, content, now, { timeZone, vocabulary: inventory });
  if (out.status !== "applied") throw new Error(`${op.op}: ${out.status} ${"message" in out ? out.message : ""}`);
  return out;
}
const en = (stepId: string, response: string, modality: "typed" | "word-choice" | "listen" = "typed"): LearningOp => ({ op: "language-step", segmentId: "LANG-EN-WATER", stepId, response, modality });
const es = (stepId: string, response: string, modality: "typed" | "word-choice" | "listen" = "typed"): LearningOp => ({ op: "language-step", segmentId: "LANG-ES-AGUA", stepId, response, modality });

/** Production-shaped row: v1 + v2 completed under version-1 content with both language segments done; no completion rows (they were created by the release-day evidence read). */
async function persistProductionShaped(client: Client) {
  const ops: LearningOp[] = [
    { op: "start-visit" }, { op: "name-base", name: "Sonnenküste" }, { op: "place-base", locationId: "shore" },
    { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" },
    { op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" },
    { op: "explain", text: "Ich habe geteilt.", modality: "typed" },
    en("listen", "", "listen"), en("pick", "water", "word-choice"), en("produce", "water"), en("reuse", "tools", "word-choice"),
    { op: "typing-label", taskId: "TYPE-LABEL-BASE", typed: "Sonnenküste", seconds: 20 }, { op: "save-log", text: "Ichhabe2Schildkroten gesehen." }, { op: "reflect", optionId: "easy" },
    { op: "start-visit" }, { op: "resume-base" }, { op: "answer-math", itemId: "EQ-RETURN", answer: 7, raw: "7", modality: "typed" },
    es("listen", "", "listen"), es("pick", "agua", "word-choice"), es("produce", "agua"), es("reuse", "herramientas", "word-choice"),
    { op: "typing-label", taskId: "TYPE-LABEL-GARDEN", typed: "Garten der Basis", seconds: 30 }, { op: "save-log", text: "Der Garten ist fertig." }, { op: "reflect", optionId: "easy" },
  ];
  for (const op of ops) await step(client, op, v1, key(), null);
  await client.execute("DELETE FROM family_learning_completions WHERE child_id = 'santiago'");
  // Like the live rows: language records without visit ids, and the picks classified under the pre-retirement rule
  // (button modality recorded as "word-choice" support, attempt rows "supported") — in BOTH the state and the attempts table.
  const row = (await client.execute("SELECT state_json, revision FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0];
  const state = JSON.parse(String(row.state_json));
  for (const seg of Object.values(state.language) as { records: { visit?: string; evidence: string; support: string[] }[] }[]) {
    for (const r of seg.records) {
      delete r.visit;
      if (r.evidence === "recognition") r.support = ["word-choice"];
    }
  }
  await client.execute({ sql: "UPDATE family_learning_missions SET state_json = ? WHERE child_id = 'santiago'", args: [JSON.stringify(state)] });
  await client.execute("UPDATE family_learning_attempts SET support_json = '[\"word-choice\"]', evidence = 'supported' WHERE child_id = 'santiago' AND objective LIKE '%-recognition'");
}
const stateRow = async (client: Client) => (await client.execute("SELECT content_version, revision, state_json FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0];
async function snapshot(client: Client): Promise<string> {
  const parts: string[] = [];
  for (const table of ["family_learning_missions", "family_learning_attempts", "family_learning_work_samples", "family_learning_support_events", "family_learning_exposures", "family_learning_mutations"]) {
    const rows = await client.execute(`SELECT * FROM ${table} ORDER BY 1, 2`);
    parts.push(`${table}:${JSON.stringify(rows.rows)}`);
  }
  return parts.join("\n");
}

describe("follow-on persistence — old rows, new reads", () => {
  it("a production-shaped version-1 row: the chapter is Visit 3, v3 is retired, the strip counts the two completed events, the ledger derives from the historical records — and nothing is written", async () => {
    const client = await fresh();
    await persistProductionShaped(client);
    const before = await snapshot(client);
    const rowBefore = await stateRow(client);
    equal(Number(rowBefore.content_version), 1);
    const view = await readChildView(client, "santiago", v2, new Date("2026-09-30T14:00:00.000Z"), { timeZone: TZ, vocabulary: inventory });
    ok(isChildView(view, "santiago"));
    deepStrictEqual(view.next, { visit: "v4", ordinal: 3, availableAt: null, reason: null });
    equal(view.delayedCheck!.status, "retired");
    equal(view.progress.completedTotal, 2);
    equal(view.progress.completedThisWeek, 2, "both were completed on Tuesday 29 Sept of the week Mon 28 Sept – Sun 4 Oct");
    equal(view.progress.week.label, "Montag, 28. September bis Sonntag, 4. Oktober");
    equal(view.progress.next.kind, "start");
    equal(view.progress.next.label, "Besuch 3 — Die Beobachtungsstation");
    // No completion rows yet (exactly the pre-release-read production shape): the success claim is suppressed, the artifact shown.
    equal(view.progress.recent!.did, null);
    equal(view.progress.recent!.grounding.suppressed!.reason, "review-missing");
    equal(view.progress.recent!.artifact.text, "Der Garten ist fertig.");
    ok(view.vocabulary && view.vocabulary.words.length > 0);
    equal(await snapshot(client), before, "a child read writes nothing");
    // The evidence read (parent) backfills the two historical reviews (release-day behaviour) — then the strip quotes the stored review.
    const evidence = await readEvidence(client, "santiago", v2.contentId, undefined, v2, inventory);
    equal(evidence.completions.length, 2);
    ok(evidence.completions.every((c) => c.historical && c.review?.identity.reviewVersion === REVIEW_VERSION));
    equal(evidence.vocabulary!.observations.length, 8);
    deepStrictEqual(evidence.vocabulary!.observations.map((o) => o.visit), ["v1", "v1", "v1", "v1", "v2", "v2", "v2", "v2"], "records without visit ids are attributed by the visit window");
    equal(evidence.vocabulary!.entries.find((e) => e.entryId === "EN-WATER")!.dimensions.recall.status, "independent");
    equal(evidence.vocabulary!.entries.find((e) => e.entryId === "EN-WATER")!.dimensions.recognition.status, "supported-only", "legacy picks stay 'mit Hilfe' in both views");
    const grounded = await readChildView(client, "santiago", v2, new Date("2026-09-30T14:00:00.000Z"), { timeZone: TZ, vocabulary: inventory });
    equal(grounded.progress.recent!.grounding.source, "review-historical");
    ok(/28 Setzlinge/.test(grounded.progress.recent!.did!), grounded.progress.recent!.did!);
    equal(grounded.progress.recent!.tryNext, evidence.completions[1].review!.learning.childSummary.next.text);
    // Still no write to the mission row or the child's evidence rows (only the two additive completion rows exist).
    const rowAfter = await stateRow(client);
    equal(String(rowAfter.state_json), String(rowBefore.state_json));
    equal(Number(rowAfter.content_version), 1);
    const sources = await readProgressSources(client, "santiago", v2.contentId);
    equal(sources.reviews.length, 2);
  });
  it("finishing the chapter through the mutation path: the completion written in the same transaction grounds the strip in the applied view; the week/total counts move with the finish event; a replay changes nothing", async () => {
    const client = await fresh();
    await persistProductionShaped(client);
    await readEvidence(client, "santiago", v2.contentId, undefined, v2, inventory);
    const started = await step(client, { op: "start-visit" });
    equal(started.view.visit!.id, "v4");
    equal(started.view.visit!.ordinal, 3);
    equal(started.view.visit!.title, "Besuch 3 — Die Beobachtungsstation");
    equal(started.view.progress.next.kind, "continue");
    equal(started.view.progress.completedTotal, 2);
    for (const op of [{ op: "resume-base" }, { op: "choose-station", theme: "turtles" }, { op: "skip-stage", stage: "typing-course", reason: "child" }, { op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" }, { op: "skip-stage", stage: "explain", reason: "child" }] as LearningOp[]) await step(client, op);
    for (const op of [
      { op: "language-step", segmentId: "LANG-ES-STATION", stepId: "listen", response: "", modality: "listen" },
      { op: "language-step", segmentId: "LANG-ES-STATION", stepId: "pick", response: "lámpara", modality: "word-choice" },
      { op: "language-step", segmentId: "LANG-ES-STATION", stepId: "produce", response: "necesitamos una lámpara", modality: "typed" },
      { op: "language-step", segmentId: "LANG-ES-STATION", stepId: "reuse", response: "agua", modality: "word-choice" },
      { op: "build-station", spot: "rocks" }, { op: "save-log", text: "Die Station steht." }, { op: "skip-stage", stage: "log-revise", reason: "child" }, { op: "skip-stage", stage: "log-transfer", reason: "child" }, { op: "summary-seen" },
    ] as LearningOp[]) await step(client, op);
    // Finish on Monday 5 Oct 2026 10:00 CEST → the following calendar week.
    t = Date.UTC(2026, 9, 5, 8, 0, 0);
    const finishKey = key();
    const finished = await step(client, { op: "reflect", optionId: "right", feedback: { enjoyment: "yes", clarity: "clear" } }, v2, finishKey);
    equal(finished.view.progress.completedTotal, 3);
    equal(finished.view.progress.completedThisWeek, 1);
    equal(finished.view.progress.completed[2].ordinal, 3);
    equal(finished.view.progress.next.kind, "none");
    equal(finished.view.progress.next.reason, "all-visits-done");
    equal(finished.view.progress.recent!.visit, "v4");
    equal(finished.view.progress.recent!.label, "Besuch 3 — Die Beobachtungsstation");
    equal(finished.view.progress.recent!.grounding.source, "review", "the completion of this very transaction grounds the sentence");
    ok(finished.view.progress.recent!.did, "the remainder item was solved independently");
    const rowsAfter = await snapshot(client);
    // Lost-ACK replay: same key → replayed, same counts, nothing doubled.
    const view = await readChildView(client, "santiago", v2, now(), { timeZone: TZ, vocabulary: inventory });
    const replay = await applyMutation(client, { child: "santiago", op: { op: "reflect", optionId: "right" }, idempotencyKey: finishKey, expectedRevision: view.revision - 1, context: { erasureGeneration: view.erasureGeneration, visit: null } }, v2, now, { timeZone: TZ, vocabulary: inventory });
    equal(replay.status, "replayed");
    equal(replay.view.progress.completedTotal, 3);
    equal(await snapshot(client), rowsAfter);
    equal(Number((await client.execute("SELECT COUNT(*) AS c FROM family_learning_completions WHERE child_id = 'santiago'")).rows[0].c), 3);
    // The ledger now has the station observations: agua's new pick is independent, its legacy pick stays supported → one independent, not 'repeated'.
    const evidence = await readEvidence(client, "santiago", v2.contentId, undefined, v2, inventory);
    const agua = evidence.vocabulary!.entries.find((e) => e.entryId === "ES-AGUA")!;
    equal(agua.dimensions.recognition.status, "independent");
    equal(agua.dimensions.recognition.independentCorrect, 1);
    equal(agua.dimensions.recognition.supportedCorrect, 1);
    equal(evidence.vocabulary!.entries.find((e) => e.entryId === "ES-LAMPARA")!.dimensions.recall.status, "independent");
    equal(evidence.vocabulary!.entries.find((e) => e.entryId === "ES-LAMPARA")!.dimensions.writing.status, "independent");
    // The parent's visit labels come from the same rule.
    equal(evidence.state!.visits.map((v) => v.id).join(","), "v1,v2,v4");
  });
  it("time zone: a zone west of Zurich shifts the week; an invalid zone falls back; the PUT path honours its own zone", async () => {
    const client = await fresh();
    await persistProductionShaped(client);
    // Set both completions to Monday 28 Sept 00:30 CEST (Sunday 27 Sept 18:30 in New York).
    const row = await stateRow(client);
    const state = JSON.parse(String(row.state_json));
    state.visits[0].finishedAt = "2026-09-27T22:30:00.000Z";
    state.visits[1].finishedAt = "2026-09-27T22:40:00.000Z";
    await client.execute({ sql: "UPDATE family_learning_missions SET state_json = ? WHERE child_id = 'santiago'", args: [JSON.stringify(state)] });
    const at = new Date("2026-09-30T14:00:00.000Z");
    equal((await readChildView(client, "santiago", v2, at, { timeZone: "Europe/Zurich", vocabulary: inventory })).progress.completedThisWeek, 2);
    equal((await readChildView(client, "santiago", v2, at, { timeZone: "America/New_York", vocabulary: inventory })).progress.completedThisWeek, 0);
    const fallback = await readChildView(client, "santiago", v2, at, { timeZone: "Mars/Olympus", vocabulary: inventory });
    equal(fallback.progress.timeZone, "Europe/Zurich");
    const v = await readChildView(client, "santiago", v2, at, { vocabulary: inventory });
    const put = await applyMutation(client, { child: "santiago", op: { op: "start-visit" }, idempotencyKey: key(), expectedRevision: v.revision, context: { erasureGeneration: v.erasureGeneration, visit: null } }, v2, () => at, { timeZone: "America/New_York", vocabulary: inventory });
    equal(put.status, "applied");
    equal(put.view.progress.timeZone, "America/New_York");
    equal(put.view.progress.completedThisWeek, 0);
    equal(put.view.progress.completedTotal, 2);
  });
  it("a parent correction on a language attempt is reflected in the ledger; deletion erases source and derived state (strip empty, ledger empty, cue empty) and a later read resurrects nothing", async () => {
    const client = await fresh();
    await persistProductionShaped(client);
    const before = await readEvidence(client, "santiago", v2.contentId, undefined, v2, inventory);
    const produce = before.attempts.find((a) => a.taskId === "LANG-EN-WATER/produce")!;
    ok(await correctAttempt(client, { child: "santiago", attemptId: produce.id, evidence: "unscored", note: "Ein Erwachsener hat vorgesagt.", adminEmail: "info@davideberle.com" }));
    const corrected = await readEvidence(client, "santiago", v2.contentId, undefined, v2, inventory);
    const obs = corrected.vocabulary!.observations.find((o) => o.id === "EN-WATER/LANG-EN-WATER/produce/1/recall")!;
    equal(obs.correction!.evidence, "unscored");
    equal(obs.countable, false);
    equal(corrected.vocabulary!.entries.find((e) => e.entryId === "EN-WATER")!.dimensions.recall.status, "practice");
    equal(corrected.vocabulary!.entries.find((e) => e.entryId === "EN-WATER")!.dimensions.recognition.status, "supported-only");
    // Delete.
    const counts = await deleteChildRecords(client, "santiago", "info@davideberle.com");
    ok(counts.family_learning_missions === 1 && counts.family_learning_completions === 2);
    const after = await readEvidence(client, "santiago", v2.contentId, undefined, v2, inventory);
    equal(after.state, null);
    equal(after.completions.length, 0);
    equal(after.vocabulary!.observations.length, 0);
    ok(after.vocabulary!.entries.every((e) => Object.values(e.dimensions).every((d) => d.observations === 0)));
    const view = await readChildView(client, "santiago", v2, now(), { timeZone: TZ, vocabulary: inventory });
    equal(view.progress.completedTotal, 0);
    equal(view.progress.recent, null);
    equal(view.progress.next.visit, "v1");
    equal(view.vocabulary!.words.length, 0);
    equal(view.erasureGeneration, 1);
    equal(Number((await client.execute("SELECT COUNT(*) AS c FROM family_learning_completions WHERE child_id = 'santiago'")).rows[0].c), 0, "the read after deletion creates nothing");
    equal((await loadMissionState(client, "santiago", v2.contentId)), null);
  });
  it("both parent views agree on the same attempt: the attempts table row and the ledger observation carry the same support list and the same independence (new picks, opened list, legacy rows)", async () => {
    const client = await fresh();
    await persistProductionShaped(client);
    // New picks in the chapter: one plain (independent), then the word list opened before the reuse pick (supported).
    await readEvidence(client, "santiago", v2.contentId, undefined, v2, inventory);
    for (const op of [{ op: "start-visit" }, { op: "resume-base" }, { op: "choose-station", theme: "turtles" }, { op: "skip-stage", stage: "typing-course", reason: "child" }, { op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" }, { op: "skip-stage", stage: "explain", reason: "child" },
      { op: "language-step", segmentId: "LANG-ES-STATION", stepId: "listen", response: "", modality: "listen" },
      { op: "language-step", segmentId: "LANG-ES-STATION", stepId: "pick", response: "lámpara", modality: "word-choice" },
      { op: "support", taskId: "LANG-ES-STATION", kind: "word_choice" },
      { op: "language-step", segmentId: "LANG-ES-STATION", stepId: "produce", response: "una lámpara", modality: "word-choice" },
      { op: "language-step", segmentId: "LANG-ES-STATION", stepId: "reuse", response: "agua", modality: "word-choice" }] as LearningOp[]) await step(client, op);
    const evidence = await readEvidence(client, "santiago", v2.contentId, undefined, v2, inventory);
    const attemptFor = (taskId: string, attemptNo: number) => evidence.attempts.find((a) => a.taskId === taskId && a.attemptNo === attemptNo)!;
    const obsFor = (id: string) => evidence.vocabulary!.observations.find((o) => o.id === id)!;
    const cases: [string, string][] = [
      ["ES-LAMPARA/LANG-ES-STATION/pick/1/recognition", "LANG-ES-STATION/pick"],
      ["ES-LAMPARA/LANG-ES-STATION/produce/1/recall", "LANG-ES-STATION/produce"],
      ["ES-AGUA/LANG-ES-STATION/reuse/1/recognition", "LANG-ES-STATION/reuse"],
      ["EN-WATER/LANG-EN-WATER/pick/1/recognition", "LANG-EN-WATER/pick"],
      ["ES-HERRAMIENTAS/LANG-ES-AGUA/reuse/1/recognition", "LANG-ES-AGUA/reuse"],
    ];
    for (const [obsId, taskId] of cases) {
      const o = obsFor(obsId);
      const a = attemptFor(taskId, 1);
      deepStrictEqual(o.support, a.support, obsId);
      equal(o.independent, a.evidence === "independent", obsId);
    }
    equal(attemptFor("LANG-ES-STATION/pick", 1).evidence, "independent", "plain button pick: independent in the raw table");
    equal(attemptFor("LANG-ES-STATION/produce", 1).evidence, "supported", "button-selected text in a produce step: supported");
    equal((attemptFor("LANG-ES-STATION/produce", 1).answer as { productionKind: string }).productionKind, "copying");
    equal(attemptFor("LANG-ES-STATION/reuse", 1).evidence, "supported", "pick after the list was opened: supported");
    equal(attemptFor("LANG-EN-WATER/pick", 1).evidence, "supported", "legacy pick row: unchanged, supported");
    deepStrictEqual(attemptFor("LANG-EN-WATER/pick", 1).support, ["word-choice"]);
  });
  it("rollback: under the version-1 cap the same rows read fine, nothing further is offered, the strip says so, the ledger only serves the v1 contexts; and no MissionState field was added for the previous build to trip over", async () => {
    const client = await fresh();
    await persistProductionShaped(client);
    const before = await snapshot(client);
    const capped = await readChildView(client, "santiago", v1, new Date("2026-10-06T10:00:00.000Z"), { timeZone: TZ, vocabulary: inventory });
    deepStrictEqual(capped.next, { visit: null, ordinal: null, availableAt: null, reason: "no-further-visit-served" });
    equal(capped.progress.next.kind, "none");
    equal(capped.progress.next.reason, "no-further-visit-served");
    equal(capped.progress.completedTotal, 2);
    equal(capped.delayedCheck!.status, "retired");
    const refused = await applyMutation(client, { child: "santiago", op: { op: "start-visit" }, idempotencyKey: key(), expectedRevision: capped.revision, context: { erasureGeneration: capped.erasureGeneration, visit: null } }, v1, now, { timeZone: TZ, vocabulary: inventory });
    equal(refused.status, "refused");
    const evidence = await readEvidence(client, "santiago", v2.contentId, undefined, v1, inventory);
    equal(evidence.vocabulary!.entries.find((e) => e.entryId === "ES-LAMPARA")!.dimensions.recognition.status, "no-opportunity", "station contexts are not served under the cap");
    equal(evidence.vocabulary!.entries.find((e) => e.entryId === "ES-AGUA")!.dimensions.recognition.opportunities, 1);
    // Reads under the cap wrote nothing to the child's rows (the two additive historical completions aside).
    equal(await snapshot(client), before);
    // A row written by this candidate has the released build's state keys plus the additive keys `feedback` (2026-10-03) and
    // `pier` (Visit 4, 2026-10-04)
    // (world-first 2026-10-03: lesson repairs, practice focus, acknowledged lesson feedback). The previous build clones
    // the parsed JSON and keeps unknown keys, so it reads and re-writes this row unchanged apart from its own fields.
    const started = await step(client, { op: "start-visit" });
    const keys = Object.keys(JSON.parse(String((await stateRow(client)).state_json))).sort();
    deepStrictEqual(keys, ["base", "child", "contentVersion", "createdAt", "currentVisit", "explanations", "feedback", "language", "logRevisions", "math", "missionId", "modelShownAt", "pages", "pier", "revision", "station", "stationModelShownAt", "teachingFirstAt", "transfers", "typing", "updatedAt", "upgradedAt", "visits"]);
    equal(started.view.visit!.id, "v4");
  });
});
