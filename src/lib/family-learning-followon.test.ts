// September 30 follow-on (DESIGN §7.6 "September 30 follow-on"): retired
// delayed check, learner-facing visit numbering, the progress strip and the
// vocabulary evidence ledger — pure rules. Run with: npm test

import { deepStrictEqual, equal, notEqual, ok, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { asLearningContent, type LearningContent, type VisitId } from "./family-learning-content.ts";
import { applyLearningOp, buildChildView, currentStage, EMPTY_PARENT_SETTINGS, ensureItemShown, newMissionState, nextVisitAvailability, upgradeMissionState, type LearningOp, type MissionState, type OpEnv, type ParentSettings } from "./family-learning-state.ts";
import { buildParentReview, buildVisitSummary, delayedCheckInfo, LEARNING_RULES_VERSION, REVIEW_VERSION, visitLabel, visitOrdinal } from "./family-learning-summary.ts";
import { buildProgress, COUNTING_RULE, localMidnightUtc, localWeekBounds, resolveTimeZone, type ProgressSources } from "./family-learning-progress.ts";
import { asVocabularyInventory, buildVocabularyLedger, childVocabularyCue, reconcileVocabularyInventory, tokenize, VOCABULARY_LEDGER_VERSION } from "./family-learning-vocabulary.ts";
import { isChildView, isChildVocabularyCue, isProgressStrip } from "./family-learning-view-guard.ts";

const rawV1 = JSON.parse(readFileSync(new URL("../data/family-learning/content/santiago-expedition-v1.json", import.meta.url), "utf8"));
const rawV2 = JSON.parse(readFileSync(new URL("../data/family-learning/content/santiago-expedition-v2.json", import.meta.url), "utf8"));
const rawInventory = JSON.parse(readFileSync(new URL("../data/family-learning/content/vocabulary-inventory-v1.json", import.meta.url), "utf8"));
const v1: LearningContent = asLearningContent(rawV1);
const v2: LearningContent = asLearningContent(rawV2);
const inventory = asVocabularyInventory(rawInventory, v2);

const T0 = Date.UTC(2026, 8, 29, 13, 28, 0);
function makeEnv(content: LearningContent, settings: Partial<ParentSettings> = {}, start = T0): OpEnv & { tick: (ms: number) => void; set: (ms: number) => void } {
  let t = start;
  let n = 0;
  return { content, settings: { ...EMPTY_PARENT_SETTINGS, ...settings }, now: () => new Date(t), newId: () => `id-${(n += 1)}`, tick: (ms) => (t += ms), set: (ms) => (t = ms) };
}
function run(state: MissionState, ops: LearningOp[], env: OpEnv & { tick: (ms: number) => void }): MissionState {
  return ops.reduce((s, op) => {
    env.tick(30_000);
    return applyLearningOp(s, op, env).state;
  }, state);
}
const en = (stepId: string, response: string, modality: "typed" | "spoken" | "word-choice" | "listen" = "typed"): LearningOp => ({ op: "language-step", segmentId: "LANG-EN-WATER", stepId, response, modality, ...(modality === "spoken" ? { transcriptConfirmed: true } : {}) });
const es = (stepId: string, response: string, modality: "typed" | "spoken" | "word-choice" | "listen" = "typed"): LearningOp => ({ op: "language-step", segmentId: "LANG-ES-AGUA", stepId, response, modality, ...(modality === "spoken" ? { transcriptConfirmed: true } : {}) });

/**
 * Production-shaped history: v1 and v2 completed under version-1 content on
 * 2026-09-29 with both language segments done (listen / pick / produce /
 * reuse), records WITHOUT visit ids (as the live rows are), no v3, no v4.
 */
function productionShaped(options: { enOps?: LearningOp[]; esOps?: LearningOp[]; before?: (s: MissionState, env: ReturnType<typeof makeEnv>) => MissionState } = {}): { state: MissionState; env: ReturnType<typeof makeEnv> } {
  const env = makeEnv(v1);
  let s = newMissionState(v1, "santiago", env.now().toISOString());
  s = run(s, [{ op: "start-visit" }, { op: "name-base", name: "Sonnenküste" }, { op: "place-base", locationId: "shore" }], env);
  s = ensureItemShown(s, v1, env.now()).state;
  s = run(s, [{ op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }], env);
  s = ensureItemShown(s, v1, env.now()).state;
  s = run(s, [{ op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" }, { op: "explain", text: "Ich habe geteilt.", modality: "typed" }], env);
  if (options.before) s = options.before(s, env);
  s = run(s, options.enOps ?? [en("listen", "", "listen"), en("pick", "water", "word-choice"), en("produce", "water"), en("reuse", "tools", "word-choice")], env);
  s = run(s, [{ op: "typing-label", taskId: "TYPE-LABEL-BASE", typed: "Sonnenküste", seconds: 20 }, { op: "save-log", text: "Ichhabe2Schildkroten gesehen." }, { op: "reflect", optionId: "easy" }], env);
  s = run(s, [{ op: "start-visit" }, { op: "resume-base" }], env);
  s = ensureItemShown(s, v1, env.now()).state;
  s = run(s, [{ op: "answer-math", itemId: "EQ-RETURN", answer: 7, raw: "7", modality: "typed" }], env);
  s = run(s, options.esOps ?? [es("listen", "", "listen"), es("pick", "agua", "word-choice"), es("produce", "agua"), es("reuse", "herramientas", "word-choice")], env);
  s = run(s, [{ op: "typing-label", taskId: "TYPE-LABEL-GARDEN", typed: "Garten der Basis", seconds: 30 }, { op: "save-log", text: "Der Garten ist fertig." }, { op: "reflect", optionId: "easy" }], env);
  for (const seg of Object.values(s.language)) for (const r of seg!.records) delete (r as { visit?: VisitId }).visit;
  return { state: s, env };
}

/** Walk the observation chapter to its Spanish segment (typing course skipped). */
function atStationSpanish(input: MissionState, env: ReturnType<typeof makeEnv>, theme = "turtles"): MissionState {
  let s = run(input, [{ op: "start-visit" }, { op: "resume-base" }, { op: "choose-station", theme }, { op: "skip-stage", stage: "typing-course", reason: "child" }], env);
  s = ensureItemShown(s, v2, env.now()).state;
  s = run(s, [{ op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" }, { op: "skip-stage", stage: "explain", reason: "child" }], env);
  equal(currentStage(s, v2), "LANG-ES-STATION");
  return s;
}
function finishStation(input: MissionState, env: ReturnType<typeof makeEnv>): MissionState {
  return run(input, [{ op: "build-station", spot: "rocks" }, { op: "save-log", text: "Die Station steht." }, { op: "skip-stage", stage: "log-revise", reason: "child" }, { op: "skip-stage", stage: "log-transfer", reason: "child" }, { op: "summary-seen" }, { op: "reflect", optionId: "right" }], env);
}
const stationStep = (stepId: string, response: string, modality: "typed" | "spoken" | "word-choice" | "listen" = "typed"): LearningOp => ({ op: "language-step", segmentId: "LANG-ES-STATION", stepId, response, modality, ...(modality === "spoken" ? { transcriptConfirmed: true } : {}) });

// ---------------------------------------------------------------------------
// M1 — retired delayed check, stable ids, learner-facing numbering
// ---------------------------------------------------------------------------

describe("M1 — the retired delayed check and learner-facing visit numbers", () => {
  it("old state (production-shaped, version-1 row): the chapter is offered immediately as Visit 3, v3 is retired without a date, nothing is renumbered", () => {
    const { state, env } = productionShaped();
    const s = upgradeMissionState(state, v2, "2026-09-30T14:00:00.000Z").state;
    const now = new Date("2026-09-30T14:00:00.000Z");
    deepStrictEqual(nextVisitAvailability(s, v2, now), { visit: "v4", availableAt: null });
    equal(delayedCheckInfo(s, v2, now)!.status, "retired");
    equal(delayedCheckInfo(s, v2, now)!.availableAt, null);
    equal(visitOrdinal(s, "v1"), 1);
    equal(visitOrdinal(s, "v2"), 2);
    equal(visitOrdinal(s, "v3"), null);
    equal(visitOrdinal(s, "v4"), 3);
    equal(visitLabel(s, v2, "v4"), "Besuch 3 — Die Beobachtungsstation");
    equal(visitLabel(s, v2, "v3"), "Der späte Check (zurückgezogen)");
    equal(visitLabel(s, v2, "v1"), "Besuch 1 — Die Basis entsteht");
    // Content ids, stage lists and titles are untouched: v3 remains readable by its stable id.
    ok(v2.visits.some((v) => v.id === "v3" && v.stages.includes("EQ-DELAY")));
    equal(v2.visits.find((v) => v.id === "v4")!.title, "Besuch 4 — Die Beobachtungsstation", "the reviewed content text is not rewritten; the label is derived");
    // Past the former due date and far in the future: still the chapter, never v3.
    for (const at of ["2026-10-05T12:00:00.000Z", "2026-10-05T13:44:58.931Z", "2027-03-01T00:00:00.000Z"]) {
      equal(nextVisitAvailability(s, v2, new Date(at)).visit, "v4");
      equal(delayedCheckInfo(s, v2, new Date(at))!.status, "retired");
    }
    const view = buildChildView(s, v2, EMPTY_PARENT_SETTINGS, now);
    equal(view.next.ordinal, 3);
    ok(/Besuch 3/.test(view.nextStep) && /Beobachtungsstation/.test(view.nextStep));
    equal(view.delayedCheck!.childText, "");
  });
  it("new state (fresh mission under v2): v1 → v2 → v4 (Visit 3) → all done; v3 never starts and no v3 record is created", () => {
    const env = makeEnv(v2, { keyboardLayout: "ch-de-qwertz" }, Date.UTC(2026, 9, 2, 9, 0, 0));
    let s = newMissionState(v2, "santiago", env.now().toISOString());
    equal(nextVisitAvailability(s, v2, env.now()).visit, "v1");
    s = run(s, [{ op: "start-visit" }, { op: "name-base", name: "Nordkap" }, { op: "place-base", locationId: "shore" }], env);
    s = ensureItemShown(s, v2, env.now()).state;
    s = run(s, [{ op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }], env);
    s = ensureItemShown(s, v2, env.now()).state;
    s = run(s, [{ op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" }, { op: "skip-stage", stage: "explain", reason: "child" }, { op: "skip-stage", stage: "LANG-EN-WATER", reason: "child" }, { op: "skip-stage", stage: "typing", reason: "child" }, { op: "save-log", text: "Tag eins." }, { op: "reflect", optionId: "easy" }], env);
    equal(buildChildView(s, v2, env.settings, env.now()).next.ordinal, 2);
    s = run(s, [{ op: "start-visit" }, { op: "resume-base" }], env);
    s = ensureItemShown(s, v2, env.now()).state;
    s = run(s, [{ op: "answer-math", itemId: "EQ-RETURN", answer: 7, raw: "7", modality: "typed" }, { op: "skip-stage", stage: "LANG-ES-AGUA", reason: "child" }, { op: "skip-stage", stage: "typing", reason: "child" }, { op: "save-log", text: "Tag zwei." }, { op: "reflect", optionId: "easy" }], env);
    deepStrictEqual(nextVisitAvailability(s, v2, env.now()), { visit: "v4", availableAt: null });
    const started = applyLearningOp(s, { op: "start-visit" }, env).state;
    equal(started.currentVisit, "v4");
    const view = buildChildView(started, v2, env.settings, env.now());
    equal(view.visit!.id, "v4");
    equal(view.visit!.ordinal, 3);
    equal(view.visit!.title, "Besuch 3 — Die Beobachtungsstation");
    equal(view.visit!.stageCount, 12);
    let t = atStationSpanish(s, env, "none");
    t = run(t, [{ op: "skip-stage", stage: "LANG-ES-STATION", reason: "child" }], env);
    t = finishStation(t, env);
    deepStrictEqual(nextVisitAvailability(t, v2, env.now()), { visit: null, availableAt: null, reason: "all-visits-done" });
    throws(() => applyLearningOp(t, { op: "start-visit" }, env), /all-visits-done/);
    deepStrictEqual(t.visits.map((v) => v.id), ["v1", "v2", "v4"]);
    equal(buildVisitSummary(t, v2, "v4").title, "Besuch 3 — Die Beobachtungsstation");
    equal(buildParentReview(t, v2, "v4", null, { historical: false }).learning.childSummary.title, "Besuch 3 — Die Beobachtungsstation");
  });
  it("in-flight state: a v3 running before the retirement resumes by its stable identity, keeps number 3, and the chapter becomes Visit 4 for that child only", () => {
    const { state, env } = productionShaped();
    const s = upgradeMissionState(state, v2, "2026-09-30T14:00:00.000Z").state;
    const e2 = makeEnv(v2, {}, Date.UTC(2026, 9, 6, 9, 0, 0));
    const inflight = JSON.parse(JSON.stringify(s)) as MissionState;
    inflight.visits.push({ id: "v3", startedAt: "2026-10-05T14:00:00.000Z", finishedAt: null, stageIndex: 1, skippedStages: [], reflection: null });
    inflight.currentVisit = "v3";
    equal(delayedCheckInfo(inflight, v2, e2.now())!.status, "running");
    deepStrictEqual(nextVisitAvailability(inflight, v2, e2.now()), { visit: "v3", availableAt: null });
    const view = buildChildView(inflight, v2, e2.settings, e2.now());
    equal(view.visit!.ordinal, 3);
    equal(view.visit!.title, "Besuch 3 — Der späte Check");
    equal(view.progress.next.kind, "continue");
    let t = ensureItemShown(inflight, v2, e2.now()).state;
    t = run(t, [{ op: "answer-math", itemId: "EQ-DELAY", answer: 8, raw: "8", modality: "typed" }, { op: "save-log", text: "Proben verpackt." }, { op: "reflect", optionId: "right" }], e2);
    equal(delayedCheckInfo(t, v2, e2.now())!.status, "done");
    ok(delayedCheckInfo(t, v2, e2.now())!.parentText.includes("vor seiner Zurückziehung"));
    equal(visitOrdinal(t, "v4"), 4);
    equal(visitLabel(t, v2, "v4"), "Besuch 4 — Die Beobachtungsstation");
    deepStrictEqual(nextVisitAvailability(t, v2, e2.now()), { visit: "v4", availableAt: null });
    const p = buildProgress(t, v2, { now: e2.now(), timeZone: "Europe/Zurich", sources: null });
    deepStrictEqual(p.completed.map((c) => [c.visit, c.ordinal]), [["v1", 1], ["v2", 2], ["v3", 3]]);
    equal(p.completedTotal, 3);
  });
  it("rollback compatibility: under version-1 content (cap) nothing further is offered after two visits — not v3, not even when it was formerly due; a running chapter is parked as before", () => {
    const { state, env } = productionShaped();
    const capped = makeEnv(v1, {}, Date.UTC(2026, 9, 10));
    deepStrictEqual(nextVisitAvailability(state, v1, capped.now()), { visit: null, availableAt: null, reason: "no-further-visit-served" });
    throws(() => applyLearningOp(state, { op: "start-visit" }, capped), /no-further-visit-served/);
    const view = buildChildView(state, v1, capped.settings, capped.now());
    ok(/nicht verfügbar/.test(view.nextStep) && /gespeichert/.test(view.nextStep));
    equal(view.progress.next.kind, "none");
    equal(view.progress.next.reason, "no-further-visit-served");
    equal(view.delayedCheck!.status, "retired");
    // A running chapter under the cap stays parked (unchanged rule).
    const e2 = makeEnv(v2, { keyboardLayout: "ch-de-qwertz" }, env.now().getTime());
    const s = run(upgradeMissionState(state, v2, e2.now().toISOString()).state, [{ op: "start-visit" }, { op: "resume-base" }], e2);
    const parked = buildChildView(s, v1, capped.settings, capped.now());
    deepStrictEqual(parked.next, { visit: null, ordinal: null, availableAt: null, reason: "chapter-unavailable" });
    equal(parked.progress.next.reason, "chapter-unavailable");
    // No MissionState field was added: the row a candidate writes has exactly the keys the released build wrote.
    deepStrictEqual(Object.keys(s).sort(), Object.keys(upgradeMissionState(state, v2, e2.now().toISOString()).state).sort());
  });
});

// ---------------------------------------------------------------------------
// M2 — progress strip
// ---------------------------------------------------------------------------

describe("M2 — progress strip: local Monday–Sunday weeks, completed events only, grounded sentences", () => {
  it("resolves only valid IANA zones and falls back to the household default", () => {
    equal(resolveTimeZone("Europe/Zurich"), "Europe/Zurich");
    equal(resolveTimeZone("America/New_York"), "America/New_York");
    equal(resolveTimeZone("Not/AZone"), "Europe/Zurich");
    equal(resolveTimeZone(""), "Europe/Zurich");
    equal(resolveTimeZone(null), "Europe/Zurich");
    equal(resolveTimeZone("x".repeat(80)), "Europe/Zurich");
    equal(resolveTimeZone("Europe/Zurich; DROP"), "Europe/Zurich");
  });
  it("week bounds: Monday 00:00 local to next Monday 00:00 local, across the CEST→CET switch and in another zone", () => {
    // Wednesday 30 Sept 2026 16:00 CEST.
    const w = localWeekBounds(new Date("2026-09-30T14:00:00.000Z"), "Europe/Zurich");
    equal(new Date(w.start).toISOString(), "2026-09-27T22:00:00.000Z");
    equal(new Date(w.end).toISOString(), "2026-10-04T22:00:00.000Z");
    // Week containing the DST switch (25 Oct 2026, 03:00 CEST → 02:00 CET): 8 days minus one hour... i.e. 7×24h + 1h.
    const dst = localWeekBounds(new Date("2026-10-25T10:00:00.000Z"), "Europe/Zurich");
    equal(new Date(dst.start).toISOString(), "2026-10-18T22:00:00.000Z");
    equal(new Date(dst.end).toISOString(), "2026-10-25T23:00:00.000Z");
    equal(dst.end - dst.start, 7 * 24 * 3600 * 1000 + 3600 * 1000);
    // Sunday 23:59:59 local is still the same week; Monday 00:00:00 local is the next.
    const sundayLate = localWeekBounds(new Date("2026-10-04T21:59:59.000Z"), "Europe/Zurich");
    equal(new Date(sundayLate.start).toISOString(), "2026-09-27T22:00:00.000Z");
    const mondayEarly = localWeekBounds(new Date("2026-10-04T22:00:00.000Z"), "Europe/Zurich");
    equal(new Date(mondayEarly.start).toISOString(), "2026-10-04T22:00:00.000Z");
    // Another zone: the same instant is Tuesday in Auckland; the week starts Monday 00:00 NZDT (= Sunday 11:00Z).
    const nz = localWeekBounds(new Date("2026-09-29T13:00:00.000Z"), "Pacific/Auckland");
    equal(new Date(nz.start).toISOString(), "2026-09-27T11:00:00.000Z");
    equal(localMidnightUtc(2026, 10, 25, "Europe/Zurich"), Date.parse("2026-10-24T22:00:00.000Z"));
    equal(localMidnightUtc(2026, 10, 26, "Europe/Zurich"), Date.parse("2026-10-25T23:00:00.000Z"));
  });
  it("counts completed visit EVENTS in the child's local week — a completion at Sunday 23:59:59 Zurich counts, Monday 00:00:00 does not; starts and attempts never count", () => {
    const { state } = productionShaped();
    const s = upgradeMissionState(state, v2, "2026-09-30T14:00:00.000Z").state;
    const edge = JSON.parse(JSON.stringify(s)) as MissionState;
    edge.visits[0].finishedAt = "2026-09-27T21:59:59.000Z"; // Sunday 23:59:59 CEST — previous week
    edge.visits[1].finishedAt = "2026-09-27T22:00:00.000Z"; // Monday 00:00:00 CEST — this week
    const p = buildProgress(edge, v2, { now: new Date("2026-09-30T14:00:00.000Z"), timeZone: "Europe/Zurich", sources: null });
    equal(p.completedThisWeek, 1);
    equal(p.completedTotal, 2);
    deepStrictEqual(p.completed.map((c) => [c.visit, c.thisWeek]), [["v1", false], ["v2", true]]);
    equal(p.week.label, "Montag, 28. September bis Sonntag, 4. Oktober");
    equal(p.counting, COUNTING_RULE);
    // In a zone west of Zurich the same Monday-00:00-CEST instant is still Sunday: both fall into the previous week.
    const west = buildProgress(edge, v2, { now: new Date("2026-09-30T14:00:00.000Z"), timeZone: "America/New_York", sources: null });
    equal(west.completedThisWeek, 0);
    equal(west.completedTotal, 2);
    // A running visit with attempts is a start, not a completion.
    const e2 = makeEnv(v2, {}, Date.UTC(2026, 8, 30, 15));
    let running = run(edge, [{ op: "start-visit" }, { op: "resume-base" }, { op: "choose-station", theme: "waves" }, { op: "skip-stage", stage: "typing-course", reason: "child" }], e2);
    running = ensureItemShown(running, v2, e2.now()).state;
    running = run(running, [{ op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" }], e2);
    const q = buildProgress(running, v2, { now: e2.now(), timeZone: "Europe/Zurich", sources: null });
    equal(q.completedThisWeek, 1);
    equal(q.completedTotal, 2);
    equal(q.next.kind, "continue");
    equal(q.next.label, "Besuch 3 — Die Beobachtungsstation");
    // Finishing it is the event that counts — in the week of the finish instant.
    let done = run(running, [{ op: "skip-stage", stage: "explain", reason: "child" }, { op: "skip-stage", stage: "LANG-ES-STATION", reason: "child" }], e2);
    e2.set(Date.UTC(2026, 9, 5, 8)); // Monday 5 Oct 10:00 CEST — the following week
    done = finishStation(done, e2);
    const r = buildProgress(done, v2, { now: e2.now(), timeZone: "Europe/Zurich", sources: null });
    equal(r.completedThisWeek, 1);
    equal(r.completedTotal, 3);
    equal(r.completed[2].visit, "v4");
    equal(r.completed[2].ordinal, 3);
    equal(r.next.kind, "none");
    equal(r.next.reason, "all-visits-done");
    // Counts agree with completed event identities: one per (visit id, startedAt) with a finishedAt.
    equal(r.completedTotal, done.visits.filter((v) => v.finishedAt).length);
  });
  it("'You did / Try next' is quoted from the stored review of the most recent completed visit; missing, obsolete or success-less reviews suppress the claim and show the artifact + an ordinary next step", () => {
    const { state } = productionShaped();
    const s = upgradeMissionState(state, v2, "2026-09-30T14:00:00.000Z").state;
    const now = new Date("2026-09-30T14:00:00.000Z");
    const last = s.visits[1];
    // No sources at all (e.g. a pure view): suppressed, factual artifact, ordinary next step.
    const none = buildProgress(s, v2, { now, timeZone: "Europe/Zurich", sources: null }).recent!;
    equal(none.did, null);
    equal(none.grounding.source, "none");
    equal(none.grounding.suppressed!.reason, "review-missing");
    deepStrictEqual(none.artifact, { kind: "page", text: "Der Garten ist fertig." });
    equal(none.tryNext, "Start: Besuch 3 — Die Beobachtungsstation.");
    // A stored review at the current rules: quoted verbatim (success + recommendation), historical flagged as such.
    const review = buildParentReview(s, v2, "v2", null, { historical: true, derivedAt: "2026-09-30T13:26:00.000Z" });
    const sources: ProgressSources = { reviews: [{ visitId: "v2", visitStartedAt: last.startedAt, historical: true, reviewVersion: REVIEW_VERSION, childSummary: review.learning.childSummary }] };
    const grounded = buildProgress(s, v2, { now, timeZone: "Europe/Zurich", sources }).recent!;
    equal(grounded.grounding.source, "review-historical");
    equal(grounded.grounding.suppressed, null);
    equal(grounded.did, review.learning.childSummary.success!.text);
    ok(/28 Setzlinge gerecht auf 4 Beete verteilt — ohne Hilfe/.test(grounded.did!), grounded.did!);
    equal(grounded.tryNext, review.learning.childSummary.next.text);
    // Identity matters: a review for the same visit id but another start instant is not this completion.
    const other: ProgressSources = { reviews: [{ ...sources.reviews[0], visitStartedAt: "2020-01-01T00:00:00.000Z" }] };
    equal(buildProgress(s, v2, { now, timeZone: "Europe/Zurich", sources: other }).recent!.grounding.suppressed!.reason, "review-missing");
    // Obsolete learning rules: never quoted.
    const obsolete: ProgressSources = { reviews: [{ ...sources.reviews[0], reviewVersion: LEARNING_RULES_VERSION - 1 }] };
    const ob = buildProgress(s, v2, { now, timeZone: "Europe/Zurich", sources: obsolete }).recent!;
    equal(ob.did, null);
    equal(ob.grounding.suppressed!.reason, "review-obsolete");
    const unversioned: ProgressSources = { reviews: [{ ...sources.reviews[0], reviewVersion: null }] };
    equal(buildProgress(s, v2, { now, timeZone: "Europe/Zurich", sources: unversioned }).recent!.grounding.suppressed!.reason, "review-obsolete");
    // A review without a success line: no claim, artifact instead, but the recommendation is still the review's.
    const noSuccess: ProgressSources = { reviews: [{ ...sources.reviews[0], childSummary: { ...review.learning.childSummary, success: null } }] };
    const ns = buildProgress(s, v2, { now, timeZone: "Europe/Zurich", sources: noSuccess }).recent!;
    equal(ns.did, null);
    equal(ns.grounding.suppressed!.reason, "no-success-line");
    equal(ns.tryNext, review.learning.childSummary.next.text);
    // Nothing completed: no recent block, next = start v1.
    const fresh = buildProgress(newMissionState(v2, "santiago", "2026-09-30T00:00:00.000Z"), v2, { now, timeZone: "Europe/Zurich", sources: null });
    equal(fresh.recent, null);
    equal(fresh.completedTotal, 0);
    equal(fresh.next.kind, "start");
    equal(fresh.next.visit, "v1");
  });
  it("the view carries the strip and the guard accepts it; no grade-like field exists", () => {
    const { state } = productionShaped();
    const s = upgradeMissionState(state, v2, "2026-09-30T14:00:00.000Z").state;
    const view = buildChildView(s, v2, EMPTY_PARENT_SETTINGS, new Date("2026-09-30T14:00:00.000Z"), 0, { timeZone: "Europe/Zurich" });
    ok(isProgressStrip(view.progress));
    ok(isChildView(view, "santiago"));
    equal(view.progress.timeZone, "Europe/Zurich");
    const json = JSON.stringify(view.progress);
    ok(!/percent|score|rank|grade|isabel/i.test(json), json);
    // The guard rejects a strip with a missing week label or a malformed next.
    const broken = JSON.parse(JSON.stringify(view));
    broken.progress.next = { kind: "later" };
    equal(isChildView(broken, "santiago"), false);
    const broken2 = JSON.parse(JSON.stringify(view));
    delete broken2.progress;
    equal(isChildView(broken2, "santiago"), false);
  });
});

// ---------------------------------------------------------------------------
// M3 — vocabulary evidence ledger
// ---------------------------------------------------------------------------

describe("M3 — vocabulary inventory reconciles by stable id against the served content", () => {
  it("the shipped inventory reconciles under v2 (all 9 contexts served) and under v1 (the station contexts are simply not served)", () => {
    const r2 = reconcileVocabularyInventory(rawInventory, v2);
    deepStrictEqual(r2.problems, []);
    deepStrictEqual(r2.counts, { entries: 13, contexts: 9, served: 9 });
    const r1 = reconcileVocabularyInventory(rawInventory, v1);
    deepStrictEqual(r1.problems, []);
    deepStrictEqual(r1.counts, { entries: 13, contexts: 9, served: 6 });
    equal(rawInventory.reviewed.status, "independently-reviewed-2026-09-30");
    ok(/pilot/i.test(rawInventory.policy.note));
    // Every inventory lemma is a reviewed gloss word of the released segments; nothing is invented.
    const glossWords = new Set(v2.language.segments.flatMap((seg) => seg.glosses.map((g) => g.word.toLowerCase())));
    for (const e of rawInventory.entries) ok(glossWords.has(String(e.lemma).toLowerCase()), e.id);
  });
  it("refuses a stimulus, answer, target, version, step or theme variant that does not match the reviewed content, and a duplicate id", () => {
    const clone = () => JSON.parse(JSON.stringify(rawInventory));
    let b = clone();
    b.entries[0].contexts[0].stimulus = "We need water.";
    ok(reconcileVocabularyInventory(b, v2).problems.some((p) => /stimulus differs/.test(p)));
    b = clone();
    b.entries[0].contexts[1].target = "We need the water.";
    ok(reconcileVocabularyInventory(b, v2).problems.some((p) => /target differs/.test(p)));
    b = clone();
    b.entries[0].contexts[0].version = 2;
    ok(reconcileVocabularyInventory(b, v2).problems.some((p) => /version 2 does not match/.test(p)));
    b = clone();
    b.entries[0].contexts[0].stepId = "nope";
    ok(reconcileVocabularyInventory(b, v2).problems.some((p) => /step nope does not exist/.test(p)));
    b = clone();
    b.entries[1].contexts[0].stepId = "pick"; // tools is not the answer of pick
    ok(reconcileVocabularyInventory(b, v2).problems.some((p) => /is not a form of EN-TOOLS/.test(p)));
    b = clone();
    const agua = b.entries.find((e: { id: string }) => e.id === "ES-AGUA");
    agua.contexts[2].variants.turtles = "Necesitamos agua para los peces.";
    ok(reconcileVocabularyInventory(b, v2).problems.some((p) => /variants differ/.test(p)));
    b = clone();
    b.entries[1].id = "EN-WATER";
    ok(reconcileVocabularyInventory(b, v2).problems.some((p) => /duplicate entry id/.test(p)));
    b = clone();
    b.entries[0].writtenForms = ["wasser"];
    ok(reconcileVocabularyInventory(b, v2).problems.some((p) => /writtenForm "wasser" is not one of the forms/.test(p)));
    b = clone();
    b.policy.independentSuccesses = 0;
    ok(reconcileVocabularyInventory(b, v2).problems.some((p) => /policy.independentSuccesses/.test(p)));
    b = clone();
    b.child = "isabel";
    ok(reconcileVocabularyInventory(b, v2).problems.some((p) => /child isabel/.test(p)));
    throws(() => asVocabularyInventory(b, v2), /does not reconcile/);
  });
});

describe("M3 — observations keep recognition, prompted recall, writing and spontaneous use apart; support never becomes independence", () => {
  it("production-shaped history: each word gets its own observations with task/step/version/context/visit; a single independent hit is 'independent', never 'repeated'; missingness is explicit", () => {
    const { state } = productionShaped();
    const s = upgradeMissionState(state, v2, "2026-09-30T14:00:00.000Z").state;
    const ledger = buildVocabularyLedger(s, v2, inventory);
    equal(ledger.ledgerVersion, VOCABULARY_LEDGER_VERSION);
    equal(ledger.inventoryVersion, 1);
    deepStrictEqual(ledger.observations.map((o) => o.id), [
      "EN-WATER/LANG-EN-WATER/pick/1/recognition",
      "EN-WATER/LANG-EN-WATER/produce/1/recall",
      "EN-WATER/LANG-EN-WATER/produce/1/writing",
      "EN-TOOLS/LANG-EN-WATER/reuse/1/recognition",
      "ES-AGUA/LANG-ES-AGUA/pick/1/recognition",
      "ES-AGUA/LANG-ES-AGUA/produce/1/recall",
      "ES-AGUA/LANG-ES-AGUA/produce/1/writing",
      "ES-HERRAMIENTAS/LANG-ES-AGUA/reuse/1/recognition",
    ]);
    const pick = ledger.observations[0];
    deepStrictEqual({ task: pick.taskId, step: pick.stepId, v: pick.taskVersion, ctx: pick.contextId, stim: pick.stimulus, resp: pick.response, mod: pick.modality, visit: pick.visit, ord: pick.visitOrdinal, indep: pick.independent, out: pick.outcome, ref: pick.attemptRef }, { task: "LANG-EN-WATER", step: "pick", v: 1, ctx: "EN-WATER/pick", stim: "We need water for the garden.", resp: "water", mod: "word-choice", visit: "v1", ord: 1, indep: true, out: "correct", ref: { taskId: "LANG-EN-WATER/pick", attemptNo: 1 } });
    ok(ledger.observations.every((o) => o.at >= s.visits[0].startedAt), "records without a visit id are attributed by the visit window");
    equal(ledger.observations[4].visit, "v2");
    const water = ledger.entries.find((e) => e.entryId === "EN-WATER")!;
    equal(water.dimensions.recognition.status, "independent");
    equal(water.dimensions.recall.status, "independent");
    equal(water.dimensions.writing.status, "independent");
    equal(water.dimensions.spontaneous.status, "not-observed");
    equal(water.dimensions.recall.independentCorrect, 1);
    equal(water.dimensions.recall.distinctContexts, 1);
    equal(water.dimensions.recall.separateVisits, 1);
    ok(water.missing.some((m) => /nur 1 geprüfter Kontext/.test(m)));
    const tools = ledger.entries.find((e) => e.entryId === "EN-TOOLS")!;
    equal(tools.dimensions.recall.status, "no-opportunity");
    equal(tools.dimensions.writing.status, "no-opportunity");
    const need = ledger.entries.find((e) => e.entryId === "EN-NEED")!;
    equal(need.dimensions.recognition.status, "no-opportunity");
    ok(need.note && /no independent opportunity/.test(need.note));
    const lamp = ledger.entries.find((e) => e.entryId === "ES-LAMPARA")!;
    equal(lamp.dimensions.recognition.status, "not-observed");
    ok(!ledger.entries.some((e) => Object.values(e.dimensions).some((d) => d.status === "independent-repeated")), "one hit is never 'repeated'");
    ok(!/master|beherrsch/i.test(JSON.stringify(ledger.entries.map((e) => e.dimensions))));
    // Deterministic: the same input yields the same ledger with the same ids (reload / re-derivation).
    deepStrictEqual(buildVocabularyLedger(s, v2, inventory), ledger);
    deepStrictEqual(buildVocabularyLedger(JSON.parse(JSON.stringify(s)), v2, inventory), ledger);
  });
  it("gloss, audio, an opened word list, tutor help, a retry and earlier feedback make the observation supported; the button pick itself is not help", () => {
    // Gloss on 'water' before the pick and the production → both supported.
    const glossed = productionShaped({ before: (s, env) => run(s, [{ op: "support", taskId: "LANG-EN-WATER", kind: "gloss", payload: { word: "water" } }], env) });
    let ledger = buildVocabularyLedger(upgradeMissionState(glossed.state, v2, "2026-09-30T14:00:00.000Z").state, v2, inventory);
    let water = ledger.entries.find((e) => e.entryId === "EN-WATER")!;
    equal(water.dimensions.recognition.status, "supported-only");
    equal(water.dimensions.recall.status, "supported-only");
    deepStrictEqual(ledger.observations[0].support, ["gloss"]);
    equal(ledger.observations[1].productionKind, "glossed");
    // Read-aloud on the sentence → supported (audio); typed production after audio is repetition.
    const audio = productionShaped({ before: (s, env) => run(s, [{ op: "support", taskId: "LANG-EN-WATER", kind: "read_aloud", payload: { text: "We need water for the garden." } }], env) });
    ledger = buildVocabularyLedger(upgradeMissionState(audio.state, v2, "2026-09-30T14:00:00.000Z").state, v2, inventory);
    equal(ledger.observations[1].productionKind, "repetition");
    equal(ledger.observations[1].independent, false);
    // Word list opened during the segment → every later pick in that segment carries "word-choice" support, the production is copying.
    const list = productionShaped({ before: (s, env) => run(s, [{ op: "support", taskId: "LANG-EN-WATER", kind: "word_choice" }], env) });
    ledger = buildVocabularyLedger(upgradeMissionState(list.state, v2, "2026-09-30T14:00:00.000Z").state, v2, inventory);
    deepStrictEqual(ledger.observations[0].support, ["word-choice"]);
    equal(ledger.observations[1].productionKind, "copying");
    equal(ledger.entries.find((e) => e.entryId === "EN-TOOLS")!.dimensions.recognition.status, "supported-only");
    // Tutor question → supported.
    const tutor = productionShaped({ before: (s, env) => run(s, [{ op: "support", taskId: "LANG-EN-WATER/pick", kind: "tutor_question", payload: { text: "Was heisst water?" } }], env) });
    ledger = buildVocabularyLedger(upgradeMissionState(tutor.state, v2, "2026-09-30T14:00:00.000Z").state, v2, inventory);
    deepStrictEqual(ledger.observations[0].support, ["tutor"]);
    // Retry: a wrong pick, then the right one → the first is an incorrect observation, the second is supported (retry), never independent.
    const retry = productionShaped({ enOps: [en("listen", "", "listen"), en("pick", "tools", "word-choice"), en("pick", "water", "word-choice"), en("produce", "water"), en("reuse", "tools", "word-choice")] });
    ledger = buildVocabularyLedger(upgradeMissionState(retry.state, v2, "2026-09-30T14:00:00.000Z").state, v2, inventory);
    const picks = ledger.observations.filter((o) => o.entryId === "EN-WATER" && o.dimension === "recognition");
    deepStrictEqual(picks.map((o) => [o.attemptRef!.attemptNo, o.outcome, o.independent, o.support]), [[1, "incorrect", false, []], [2, "correct", false, ["retry"]]]);
    water = ledger.entries.find((e) => e.entryId === "EN-WATER")!;
    equal(water.dimensions.recognition.status, "supported-only");
    equal(water.dimensions.recognition.incorrect, 1);
    // The earlier incorrect step showed feedback: the production later in the segment is 'feedback'-supported.
    const recall = ledger.observations.find((o) => o.entryId === "EN-WATER" && o.dimension === "recall")!;
    deepStrictEqual(recall.support, ["feedback"]);
    equal(recall.independent, false);
    equal(ledger.entries.find((e) => e.entryId === "EN-TOOLS")!.dimensions.recognition.status, "supported-only", "the later reuse pick also carries the feedback support");
  });
  it("modality: a spoken production is prompted recall only (no writing observation); a typed accent-less 'lampara' is a recall hit but its spelling goes to review; a distractor is incorrect; an unclear answer stays unscored", () => {
    const spoken = productionShaped({ esOps: [es("listen", "", "listen"), es("pick", "agua", "word-choice"), es("produce", "necesitamos agua", "spoken"), es("reuse", "herramientas", "word-choice")] });
    let ledger = buildVocabularyLedger(upgradeMissionState(spoken.state, v2, "2026-09-30T14:00:00.000Z").state, v2, inventory);
    const agua = ledger.entries.find((e) => e.entryId === "ES-AGUA")!;
    equal(agua.dimensions.recall.status, "independent");
    equal(agua.dimensions.writing.status, "not-observed");
    ok(!ledger.observations.some((o) => o.entryId === "ES-AGUA" && o.dimension === "writing"));
    equal(ledger.observations.find((o) => o.entryId === "ES-AGUA" && o.dimension === "recall")!.uncertainty, "transcript-confirmed-by-child");
    // Chapter: 'lampara' typed without the accent.
    const { state, env } = productionShaped();
    const e2 = makeEnv(v2, {}, Date.UTC(2026, 9, 1, 9));
    void env;
    let s = atStationSpanish(upgradeMissionState(state, v2, "2026-09-30T14:00:00.000Z").state, e2, "turtles");
    s = run(s, [stationStep("listen", "", "listen"), stationStep("pick", "lámpara", "word-choice"), stationStep("produce", "necesitamos una lampara"), stationStep("reuse", "agua", "word-choice")], e2);
    ledger = buildVocabularyLedger(s, v2, inventory);
    const lamp = ledger.entries.find((e) => e.entryId === "ES-LAMPARA")!;
    equal(lamp.dimensions.recall.status, "independent");
    equal(lamp.dimensions.writing.status, "practice", "a variant spelling is review, never a writing credit");
    const writing = ledger.observations.find((o) => o.entryId === "ES-LAMPARA" && o.dimension === "writing")!;
    equal(writing.outcome, "review");
    equal(writing.countable, false);
    ok(/Akzent/.test(writing.uncertainty!));
    // The station reuse pick is a NEW context and a separate visit for 'agua': recognition now meets the policy (2 independent, 2 contexts, 2 visits).
    const agua2 = ledger.entries.find((e) => e.entryId === "ES-AGUA")!;
    equal(agua2.dimensions.recognition.status, "independent-repeated");
    equal(agua2.dimensions.recognition.distinctContexts, 2);
    equal(agua2.dimensions.recognition.separateVisits, 2);
    equal(agua2.dimensions.recall.status, "independent", "recall has only one reviewed context — never 'repeated'");
    const reuse = ledger.observations.find((o) => o.contextId === "ES-AGUA/station-reuse")!;
    equal(reuse.stimulus, "Es de noche. La bióloga dice: Necesitamos agua para las tortugas.", "the stimulus is the theme variant the child actually saw");
    equal(reuse.visitOrdinal, 3);
    // Same two contexts but within ONE visit would not meet the 'separate visits' rule — shown by a synthetic second pick in v2.
    const oneVisit = JSON.parse(JSON.stringify(upgradeMissionState(state, v2, "2026-09-30T14:00:00.000Z").state)) as MissionState;
    const rec = oneVisit.language["LANG-ES-AGUA"]!.records[1];
    oneVisit.language["LANG-ES-STATION"]!.records.push({ ...rec, stepId: "reuse", at: "2026-09-29T13:44:00.000Z", visit: "v2" });
    const same = buildVocabularyLedger(oneVisit, v2, inventory).entries.find((e) => e.entryId === "ES-AGUA")!.dimensions.recognition;
    equal(same.distinctContexts, 2);
    equal(same.separateVisits, 1);
    equal(same.status, "independent");
    // Distractor and unclear answers.
    const wrong = productionShaped({ esOps: [es("listen", "", "listen"), es("pick", "agua", "word-choice"), es("produce", "herramientas"), { op: "language-continue", segmentId: "LANG-ES-AGUA", stepId: "produce" }, es("reuse", "herramientas", "word-choice")] });
    ledger = buildVocabularyLedger(upgradeMissionState(wrong.state, v2, "2026-09-30T14:00:00.000Z").state, v2, inventory);
    const bad = ledger.observations.find((o) => o.entryId === "ES-AGUA" && o.dimension === "recall")!;
    equal(bad.outcome, "incorrect");
    equal(ledger.entries.find((e) => e.entryId === "ES-AGUA")!.dimensions.recall.status, "practice");
    const unclear = productionShaped({ esOps: [es("listen", "", "listen"), es("pick", "agua", "word-choice"), es("produce", "hola"), { op: "language-continue", segmentId: "LANG-ES-AGUA", stepId: "produce" }, es("reuse", "herramientas", "word-choice")] });
    ledger = buildVocabularyLedger(upgradeMissionState(unclear.state, v2, "2026-09-30T14:00:00.000Z").state, v2, inventory);
    const un = ledger.observations.find((o) => o.entryId === "ES-AGUA" && o.dimension === "recall")!;
    equal(un.outcome, "unscored");
    equal(un.countable, false);
  });
  it("ONE recognition-support rule: the attempt row written by the state engine and the ledger observation classify the same pick identically (button pick = independent, opened list = supported, button-selected text in a produce step = copying, legacy rows stay supported)", () => {
    const env = makeEnv(v1);
    let s = newMissionState(v1, "santiago", env.now().toISOString());
    s = run(s, [{ op: "start-visit" }, { op: "name-base", name: "Basis" }, { op: "place-base", locationId: "shore" }], env);
    s = ensureItemShown(s, v1, env.now()).state;
    s = run(s, [{ op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }], env);
    s = ensureItemShown(s, v1, env.now()).state;
    s = run(s, [{ op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" }, { op: "explain", text: "Geteilt.", modality: "typed" }, en("listen", "", "listen")], env);
    // (a) plain button pick → attempt row independent, ledger independent.
    const pick = applyLearningOp(s, en("pick", "water", "word-choice"), env);
    equal(pick.records.attempts[0].evidence, "independent");
    deepStrictEqual(pick.records.attempts[0].support, []);
    let ledger = buildVocabularyLedger(pick.state, v1, inventory);
    let obs = ledger.observations.find((o) => o.id === "EN-WATER/LANG-EN-WATER/pick/1/recognition")!;
    equal(obs.independent, true);
    deepStrictEqual(obs.support, pick.records.attempts[0].support);
    // (b) button-selected TEXT in the produce step (word list open) → copying, attempt supported, ledger not independent.
    const opened = applyLearningOp(pick.state, { op: "support", taskId: "LANG-EN-WATER", kind: "word_choice" }, env).state;
    const copied = applyLearningOp(opened, en("produce", "water", "word-choice"), env);
    equal(copied.records.attempts[0].evidence, "supported");
    deepStrictEqual(copied.records.attempts[0].support, ["word-choice"]);
    equal((copied.records.attempts[0].answer as { productionKind: string }).productionKind, "copying");
    ledger = buildVocabularyLedger(copied.state, v1, inventory);
    obs = ledger.observations.find((o) => o.id === "EN-WATER/LANG-EN-WATER/produce/1/recall")!;
    equal(obs.independent, false);
    equal(obs.productionKind, "copying");
    deepStrictEqual(obs.support, ["word-choice"]);
    // (c) a pick AFTER the list was opened → supported in both views (the list is help; the button is not).
    const reuse = applyLearningOp(copied.state, en("reuse", "tools", "word-choice"), env);
    equal(reuse.records.attempts[0].evidence, "supported");
    deepStrictEqual(reuse.records.attempts[0].support, ["word-choice"]);
    ledger = buildVocabularyLedger(reuse.state, v1, inventory);
    obs = ledger.observations.find((o) => o.id === "EN-TOOLS/LANG-EN-WATER/reuse/1/recognition")!;
    equal(obs.independent, false);
    deepStrictEqual(obs.support, ["word-choice"]);
    // (d) a legacy row (recorded before 2026-09-30 with the button modality as support) stays supported in both views — nothing is reclassified.
    const legacy = JSON.parse(JSON.stringify(pick.state)) as MissionState;
    legacy.language["LANG-EN-WATER"]!.records[1].support = ["word-choice"];
    const legacyObs = buildVocabularyLedger(legacy, v1, inventory).observations.find((o) => o.id === "EN-WATER/LANG-EN-WATER/pick/1/recognition")!;
    equal(legacyObs.independent, false);
    deepStrictEqual(legacyObs.support, ["word-choice"]);
    equal(buildVocabularyLedger(legacy, v1, inventory).entries.find((e) => e.entryId === "EN-WATER")!.dimensions.recognition.status, "supported-only");
    // Every recognition observation agrees with its record's support list — no remapping anywhere.
    for (const o of buildVocabularyLedger(reuse.state, v1, inventory).observations.filter((x) => x.dimension === "recognition")) {
      const rec = reuse.state.language["LANG-EN-WATER"]!.records.filter((r) => r.stepId === o.stepId)[o.attemptRef!.attemptNo - 1];
      deepStrictEqual(o.support, rec.support);
      equal(o.independent, o.outcome === "correct" && rec.support.length === 0);
    }
  });
  it("a legacy record outside every visit window is attributed to no visit ('unknown'), never to v1, and never advances 'separate visits'", () => {
    const { state } = productionShaped();
    const s = upgradeMissionState(state, v2, "2026-09-30T14:00:00.000Z").state;
    const stray = JSON.parse(JSON.stringify(s)) as MissionState;
    // A second, independent 'agua' pick recorded (without visit id) one day before the first visit ever started — outside every window.
    const pick = stray.language["LANG-ES-AGUA"]!.records[1];
    stray.language["LANG-ES-STATION"]!.records.push({ ...pick, stepId: "reuse", at: new Date(new Date(stray.visits[0].startedAt).getTime() - 86400000).toISOString() });
    const ledger = buildVocabularyLedger(stray, v2, inventory);
    const obs = ledger.observations.find((o) => o.contextId === "ES-AGUA/station-reuse")!;
    equal(obs.visit, null);
    equal(obs.visitOrdinal, null);
    equal(obs.independent, true, "the observation itself is kept with its own classification");
    const agua = ledger.entries.find((e) => e.entryId === "ES-AGUA")!.dimensions.recognition;
    equal(agua.independentCorrect, 2);
    equal(agua.distinctContexts, 2);
    equal(agua.separateVisits, 1, "an unknown visit never counts as a separate visit");
    equal(agua.status, "independent", "two contexts but only one known visit: not 'repeated'");
    ok(!ledger.observations.some((o) => o.contextId === "ES-AGUA/station-reuse" && o.visit === "v1"));
    // Records inside a window keep their attribution.
    equal(ledger.observations.find((o) => o.contextId === "ES-AGUA/pick")!.visit, "v2");
  });
  it("spontaneous use is collected from the child's own free text for review only and never credited; parent corrections exclude an observation from the counts; deletion (no state) leaves nothing", () => {
    const { state } = productionShaped();
    const s = upgradeMissionState(state, v2, "2026-09-30T14:00:00.000Z").state;
    const withText = JSON.parse(JSON.stringify(s)) as MissionState;
    withText.pages[1].text = "Wir brauchen agua für die planta. Water!";
    const ledger = buildVocabularyLedger(withText, v2, inventory);
    const spont = ledger.observations.filter((o) => o.dimension === "spontaneous");
    deepStrictEqual(spont.map((o) => [o.entryId, o.outcome, o.countable, o.taskId]).sort(), [["EN-WATER", "review", false, "free-text/page"], ["ES-AGUA", "review", false, "free-text/page"], ["ES-PLANTA", "review", false, "free-text/page"]].sort());
    equal(ledger.entries.find((e) => e.entryId === "ES-PLANTA")!.dimensions.spontaneous.status, "review-pending");
    equal(ledger.entries.find((e) => e.entryId === "ES-PLANTA")!.dimensions.recall.status, "no-opportunity", "free text never turns into recall or writing credit");
    deepStrictEqual(tokenize("¡Necesitamos una lámpara, por favor!"), ["necesitamos", "una", "lámpara", "por", "favor"]);
    // A parent correction on the linked attempt: shown, excluded from counts.
    const corrections = new Map([["LANG-EN-WATER/produce#1", { evidence: "unscored", note: "Ein Erwachsener hat geholfen.", by: "info@davideberle.com", at: "2026-09-30T15:00:00.000Z" }]]);
    const corrected = buildVocabularyLedger(s, v2, inventory, corrections);
    const recall = corrected.observations.find((o) => o.id === "EN-WATER/LANG-EN-WATER/produce/1/recall")!;
    deepStrictEqual(recall.correction, corrections.get("LANG-EN-WATER/produce#1"));
    equal(recall.countable, false);
    const water = corrected.entries.find((e) => e.entryId === "EN-WATER")!;
    equal(water.dimensions.recall.independentCorrect, 0);
    equal(water.dimensions.recall.status, "practice");
    equal(water.dimensions.writing.independentCorrect, 0);
    equal(water.dimensions.recognition.status, "independent", "the correction touches only the linked attempt");
    // Deletion: the state is gone → no observations, every dimension not observed / no opportunity.
    const erased = buildVocabularyLedger(null, v2, inventory);
    equal(erased.observations.length, 0);
    ok(erased.entries.every((e) => Object.values(e.dimensions).every((d) => d.observations === 0 && ["not-observed", "no-opportunity"].includes(d.status))));
  });
  it("child cue: concrete words the child has met, a try-next line per word, at most three, no counts; unseen words are never previewed; the view guard accepts it", () => {
    const { state } = productionShaped();
    const s = upgradeMissionState(state, v2, "2026-09-30T14:00:00.000Z").state;
    const cue = childVocabularyCue(buildVocabularyLedger(s, v2, inventory), v2, s);
    ok(isChildVocabularyCue(cue));
    ok(cue.words.length <= 3 && cue.words.length > 0);
    ok(!cue.words.some((w) => w.entryId === "ES-LAMPARA"), "never encountered → never previewed");
    ok(!/\d/.test(cue.words.map((w) => w.try).join(" ")), "no numbers in the child cue");
    const agua = cue.words.find((w) => w.entryId === "ES-AGUA")!;
    ok(agua.upcoming, "agua returns in the observation chapter");
    ok(/Necesitamos agua\./.test(agua.try));
    // A practised word (incorrect last) ranks first with a look-again cue.
    const wrong = productionShaped({ esOps: [es("listen", "", "listen"), es("pick", "herramientas", "word-choice"), es("pick", "agua", "word-choice"), es("produce", "herramientas"), { op: "language-continue", segmentId: "LANG-ES-AGUA", stepId: "produce" }, es("reuse", "herramientas", "word-choice")] });
    const cue2 = childVocabularyCue(buildVocabularyLedger(upgradeMissionState(wrong.state, v2, "2026-09-30T14:00:00.000Z").state, v2, inventory), v2, wrong.state);
    equal(cue2.words[0].entryId, "ES-AGUA");
    ok(/heisst „Wasser“/.test(cue2.words[0].try));
    // In the view.
    const view = buildChildView(s, v2, EMPTY_PARENT_SETTINGS, new Date("2026-09-30T14:00:00.000Z"), 0, { vocabulary: inventory });
    ok(view.vocabulary && view.vocabulary.words.length > 0);
    ok(isChildView(view, "santiago"));
    equal(buildChildView(s, v2, EMPTY_PARENT_SETTINGS, new Date("2026-09-30T14:00:00.000Z")).vocabulary, null, "no inventory → null, honestly");
    const broken = JSON.parse(JSON.stringify(view));
    broken.vocabulary.words[0].try = 5;
    equal(isChildView(broken, "santiago"), false);
  });
});

describe("follow-on — nothing else moved", () => {
  it("visit ids, retained stage lists and the v4 stage list are unchanged; the strip and the ledger add no MissionState field", () => {
    deepStrictEqual(v2.visits.map((v) => v.id), ["v1", "v2", "v3", "v4"]);
    deepStrictEqual(v2.visits.find((v) => v.id === "v3")!.stages, ["restore", "EQ-DELAY", "log", "reflect"]);
    const { state } = productionShaped();
    const before = JSON.stringify(state);
    const s = upgradeMissionState(state, v2, "2026-09-30T14:00:00.000Z").state;
    buildChildView(s, v2, EMPTY_PARENT_SETTINGS, new Date(), 0, { timeZone: "Europe/Zurich", vocabulary: inventory });
    buildVocabularyLedger(s, v2, inventory);
    equal(JSON.stringify(state), before, "views and ledgers never mutate the state");
    notEqual(visitOrdinal(s, "v4"), 4);
  });
});
