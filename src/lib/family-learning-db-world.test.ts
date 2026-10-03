// World-first learner experience (2026-10-03) — persistence: the lesson
// repair survives reload and replay, a completed visit's report is readable
// after the finishing write and after a fresh process, the parent review
// carries the same lesson feedback, and erasure removes it all. Run: npm test

import { equal, ok, deepStrictEqual } from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { createClient, type Client } from "@libsql/client";
import { asLearningContent } from "./family-learning-content.ts";
import { applyMutation, deleteChildRecords, ensureLearningTables, loadMissionState, readChildView, readEvidence, writeParentSettings } from "./family-learning-db.ts";
import type { LearningOp } from "./family-learning-state.ts";
import { REVIEW_VERSION } from "./family-learning-summary.ts";
import { asVocabularyInventory } from "./family-learning-vocabulary.ts";
import { isChildView } from "./family-learning-view-guard.ts";

const v2 = asLearningContent(JSON.parse(readFileSync(new URL("../data/family-learning/content/santiago-expedition-v2.json", import.meta.url), "utf8")));
const inventory = asVocabularyInventory(JSON.parse(readFileSync(new URL("../data/family-learning/content/vocabulary-inventory-v1.json", import.meta.url), "utf8")), v2);

const dir = mkdtempSync(join(tmpdir(), "family-learning-world-"));
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
const key = () => `w-${(k += 1)}`;
let t = Date.UTC(2026, 9, 3, 12, 0, 0);
const now = () => new Date((t += 60_000));
const TZ = "Europe/Zurich";
const OWNER = "info@davideberle.com";
async function view(client: Client) {
  return readChildView(client, "santiago", v2, now(), { timeZone: TZ, vocabulary: inventory });
}
async function step(client: Client, op: LearningOp, idempotencyKey = key()) {
  const v = await view(client);
  const context = { erasureGeneration: v.erasureGeneration, visit: v.visit ? { id: v.visit.id, startedAt: v.visit.startedAt } : null };
  const out = await applyMutation(client, { child: "santiago", op, idempotencyKey, expectedRevision: v.revision, context }, v2, now, { timeZone: TZ, vocabulary: inventory });
  if (out.status !== "applied" && out.status !== "replayed") throw new Error(`${op.op}: ${out.status} ${"message" in out ? out.message : ""}`);
  return out;
}
async function ack(client: Client) {
  const v = await view(client);
  if (v.lastLesson) await step(client, { op: "lesson-feedback-seen", id: v.lastLesson.id });
}
const lang = (segmentId: "LANG-EN-WATER" | "LANG-ES-AGUA" | "LANG-ES-STATION", stepId: string, response: string, modality: "typed" | "word-choice" | "listen" = "typed"): LearningOp => ({ op: "language-step", segmentId, stepId, response, modality });

async function twoVisits(client: Client) {
  for (const op of [{ op: "start-visit" }, { op: "name-base", name: "Sonnenküste" }, { op: "place-base", locationId: "shore" }, { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }] as LearningOp[]) await step(client, op);
  await ack(client);
  await step(client, { op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" });
  await ack(client);
  for (const op of [{ op: "explain", text: "Ich habe geteilt.", modality: "typed" }, lang("LANG-EN-WATER", "listen", "", "listen"), lang("LANG-EN-WATER", "pick", "water", "word-choice"), lang("LANG-EN-WATER", "produce", "water"), lang("LANG-EN-WATER", "reuse", "tools", "word-choice")] as LearningOp[]) await step(client, op);
  await ack(client);
  await step(client, { op: "typing-label", taskId: "TYPE-LABEL-BASE", typed: "Sonnenküste", seconds: 20 });
  await ack(client);
  await step(client, { op: "save-log", text: "Tag eins." });
  await step(client, { op: "reflect", optionId: "easy" });
  await step(client, { op: "start-visit" });
  await step(client, { op: "resume-base" });
  await step(client, { op: "answer-math", itemId: "EQ-RETURN", answer: 7, raw: "7", modality: "typed" });
  await ack(client);
  await step(client, { op: "skip-stage", stage: "LANG-ES-AGUA", reason: "child" });
  await step(client, { op: "typing-label", taskId: "TYPE-LABEL-GARDEN", typed: "Garten der Basis", seconds: 30 });
  await ack(client);
  await step(client, { op: "save-log", text: "Der Garten ist fertig." });
  await step(client, { op: "reflect", optionId: "easy" });
}

describe("world-first persistence — repair, report and review", () => {
  it("a typing repair survives reload and replay; retries are exactly-once by key; the report of a finished visit is readable after the finishing write, after a fresh process, and reopens the same derivation the parent review stores", async () => {
    const client = await fresh();
    await twoVisits(client);
    await writeParentSettings(client, "santiago", [{ key: "keyboard_layout", value: "ch-de-qwertz" }], OWNER, 0);
    await step(client, { op: "start-visit" });
    await step(client, { op: "resume-base" });
    await step(client, { op: "choose-station", theme: "turtles" });
    await step(client, { op: "typing-check", observed: ["'", "ö", "z"] });
    const burst = await step(client, { op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["fff hhj", "fj fj jf"], seconds: 20, comfort: "ok" });
    const fb = burst.view.lastLesson!;
    equal(fb.repair.status, "available");
    // reload: the pending feedback is still there with the same id
    const reloaded = await view(client);
    ok(isChildView(reloaded, "santiago"));
    equal(reloaded.lastLesson?.id, fb.id);
    await step(client, { op: "repair-explain", repairId: fb.repair.repairId! });
    const retryKey = key();
    const r1 = await step(client, { op: "typing-retry", repairId: fb.repair.repairId!, retryNo: 1, lineIndex: 0, typed: "fff jjj", seconds: 5 }, retryKey);
    const replay = await step(client, { op: "typing-retry", repairId: fb.repair.repairId!, retryNo: 1, lineIndex: 0, typed: "fff jjj", seconds: 5 }, retryKey);
    equal(r1.status, "applied");
    equal(replay.status, "replayed");
    equal((await loadMissionState(client, "santiago", v2.contentId, v2))!.feedback!.repairs[0].retries.length, 1);
    equal(Number((await client.execute("SELECT COUNT(*) AS c FROM family_learning_work_samples WHERE kind = 'typing_retry'")).rows[0].c), 1);
    // after a "fresh process" (new client on the same file) the open repair is intact
    const restarted = createClient({ url: `file:${join(dir, "db-1.sqlite")}` });
    clients.push(restarted);
    const afterRestart = await view(restarted);
    equal(afterRestart.lastLesson?.repair.status, "open");
    equal(afterRestart.lastLesson?.repair.retries.length, 1);
    // F3: the second (last) retry closes the repair inside the same transaction; the view read afterwards is already closed, a late close replays as a no-op.
    const last = await step(restarted, { op: "typing-retry", repairId: fb.repair.repairId!, retryNo: 2, lineIndex: 1, typed: "fj fj jf", seconds: 5 });
    equal((last.result as { closed?: boolean }).closed, true);
    equal((await view(restarted)).lastLesson?.repair.status, "closed");
    equal(((await step(restarted, { op: "repair-close", repairId: fb.repair.repairId!, reason: "done" })).result as { repeated?: boolean }).repeated, true);
    await step(restarted, { op: "lesson-feedback-seen", id: fb.id });
    // finish the chapter
    await step(restarted, { op: "typing-course-continue" });
    await step(restarted, { op: "answer-remainder", itemId: "EQ-STATION", used: 32, remaining: 0, raw: "32, 0", modality: "typed" });
    await step(restarted, { op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" });
    await ack(restarted);
    await step(restarted, { op: "skip-stage", stage: "explain", reason: "child" });
    for (const op of [lang("LANG-ES-STATION", "listen", "", "listen"), lang("LANG-ES-STATION", "pick", "lámpara", "word-choice"), lang("LANG-ES-STATION", "produce", "necesitamos una lámpara"), lang("LANG-ES-STATION", "reuse", "agua", "word-choice")]) await step(restarted, op);
    await ack(restarted);
    await step(restarted, { op: "build-station", spot: "rocks" });
    await step(restarted, { op: "save-log", text: "Die Station steht und 2 Setzlinge sind übrig." });
    await step(restarted, { op: "revise-log", text: "Die Station steht und 2 Setzlinge sind übrig." });
    // F2 through the DB layer: a typed flagged transfer at the final step → offered repair; explain; the sentence retry replays exactly-once by key; the second attempt closes it.
    const tr = await step(restarted, { op: "write-transfer", text: "Morgen zählt die Station3 Schildkröten." });
    equal(tr.view.lastLesson?.repair.status, "available");
    equal(tr.view.lastLesson?.repair.kind, "writing");
    await step(restarted, { op: "repair-explain", repairId: tr.view.lastLesson!.repair.repairId! });
    const wKey = key();
    const w1 = await step(restarted, { op: "writing-retry", repairId: tr.view.lastLesson!.repair.repairId!, retryNo: 1, text: "Morgen zählt die Station3 Schildkröten." }, wKey);
    equal(w1.status, "applied");
    equal((await step(restarted, { op: "writing-retry", repairId: tr.view.lastLesson!.repair.repairId!, retryNo: 1, text: "Morgen zählt die Station3 Schildkröten." }, wKey)).status, "replayed");
    equal(Number((await restarted.execute("SELECT COUNT(*) AS c FROM family_learning_work_samples WHERE kind = 'writing_retry'")).rows[0].c), 1);
    const w2 = await step(restarted, { op: "writing-retry", repairId: tr.view.lastLesson!.repair.repairId!, retryNo: 2, text: "Morgen zählt die Station 3 Schildkröten." });
    equal((w2.result as { closed?: boolean; outcome?: string }).closed, true);
    equal(w2.view.lastLesson?.close.kind, "corrected-with-practice");
    await ack(restarted);
    await step(restarted, { op: "summary-seen" });
    const finished = await step(restarted, { op: "reflect", optionId: "right", feedback: { enjoyment: "yes", clarity: "clear" } });
    const report = finished.view.reports.find((r) => r.visit === "v4")!;
    equal(report.partial, false);
    ok(report.finishedAt);
    equal(report.lessons.length, 4, "typing round, EQ-STATION, Spanish segment, writing");
    const again = (await view(restarted)).reports.find((r) => r.visit === "v4")!;
    deepStrictEqual(again.summary, report.summary);
    deepStrictEqual(again.lessons.map((l) => [l.id, l.close.kind]), report.lessons.map((l) => [l.id, l.close.kind]));
    // the parent review of this completion carries the same lessons and summary
    const evidence = await readEvidence(restarted, "santiago", v2.contentId, undefined, v2, inventory);
    const completion = evidence.completions.find((c) => c.visitId === "v4")!;
    equal(completion.review!.identity.reviewVersion, REVIEW_VERSION);
    deepStrictEqual(completion.review!.learning.childSummary, report.summary);
    deepStrictEqual(completion.review!.learning.lessons!.map((l) => [l.id, l.close.kind]), report.lessons.map((l) => [l.id, l.close.kind]));
    // the j focus was retired by the clean second line? No second full round happened: it stays open and the state says so
    const state = (await loadMissionState(restarted, "santiago", v2.contentId, v2))!;
    equal(state.feedback!.focus.find((f) => f.id === "typing-key:j")!.status, "open");
    // erasure removes the feedback with the state
    await deleteChildRecords(restarted, "santiago", OWNER);
    equal(await loadMissionState(restarted, "santiago", v2.contentId, v2), null);
    equal(Number((await restarted.execute("SELECT COUNT(*) AS c FROM family_learning_work_samples WHERE kind = 'typing_retry'")).rows[0].c), 0);
  });
});
