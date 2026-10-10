// Visit 5 (content version 4, 2026-10-10) — the harbor chapter `v6`: content reconciliation by stable id, reachable progression
// from the completed-four-visits fixture, the free workplace order (route), the two-part quotient item, the reviewed reasoning
// probe policy (valid alternative strategies, vague and contradictory explanations, bounded probing, scaffold), the Spanish
// supplier, the harbor plan, the writing review of the child's own sentence (broad diagnosis, one or two taught points,
// unknown words asked not rewritten, copied suggestion never independent), the honest closeout, the ledger/wordbook, the
// content cap and the additive upgrade. Pure state-machine tests on an explicitly SYNTHETIC fixture (no child record); run: npm test

import { deepStrictEqual, equal, notEqual, ok, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { asLearningContent, EXPECTED_HARBOR_WORKPLACES, EXPECTED_V6_STAGES, reconcileLearningContent, type LearningContent } from "./family-learning-content.ts";
import { buildVisitReports, lastLessonFeedback, reminderFor } from "./family-learning-feedback.ts";
import { applyLearningOp, buildChildView, currentStage, EMPTY_PARENT_SETTINGS, ensureItemShown, LearningOpError, newMissionState, nextVisitAvailability, upgradeMissionState, workplaceStatuses, type LearningOp, type MissionState, type OpEnv, type ParentSettings } from "./family-learning-state.ts";
import { applyReasoningChoice, applyReasoningTurn, classifyExplanation, newReasoningState } from "./family-learning-reasoning.ts";
import { buildParentReview, buildSceneModel, buildVisitSummary, visitLabel, visitOrdinal } from "./family-learning-summary.ts";
import { asVocabularyInventory, buildVocabularyLedger, childWordbook, reconcileVocabularyInventory } from "./family-learning-vocabulary.ts";
import { isChildView } from "./family-learning-view-guard.ts";
import { evaluateLogRevision, reviewLogSentence } from "./family-learning-writing-review.ts";
import { TELEMETRY_OPS, TELEMETRY_STAGES } from "./family-learning-telemetry-schema.ts";

const rawV3 = JSON.parse(readFileSync(new URL("../data/family-learning/content/santiago-expedition-v3.json", import.meta.url), "utf8"));
const rawV4 = JSON.parse(readFileSync(new URL("../data/family-learning/content/santiago-expedition-v4.json", import.meta.url), "utf8"));
const rawInv2 = JSON.parse(readFileSync(new URL("../data/family-learning/content/vocabulary-inventory-v2.json", import.meta.url), "utf8"));
const rawInv3 = JSON.parse(readFileSync(new URL("../data/family-learning/content/vocabulary-inventory-v3.json", import.meta.url), "utf8"));
const v3: LearningContent = asLearningContent(rawV3);
const v4: LearningContent = asLearningContent(rawV4);
const inv3 = asVocabularyInventory(rawInv3, v4);

function makeEnv(content: LearningContent, settings: Partial<ParentSettings> = {}, startMs = Date.UTC(2026, 9, 10, 9, 0, 0)): OpEnv & { settings: ParentSettings } {
  let t = startMs;
  let n = 0;
  return { content, settings: { ...EMPTY_PARENT_SETTINGS, keyboardLayout: "ch-de-qwertz", ...settings }, now: () => new Date((t += 30_000)), newId: () => `id-${(n += 1)}` };
}
function run(state: MissionState, ops: LearningOp[], env: OpEnv): MissionState {
  let s = state;
  for (const op of ops) {
    s = ensureItemShown(s, env.content, env.now()).state;
    s = applyLearningOp(s, op, env).state;
  }
  return ensureItemShown(s, env.content, env.now()).state;
}
function apply(state: MissionState, op: LearningOp, env: OpEnv) {
  return applyLearningOp(ensureItemShown(state, env.content, env.now()).state, op, env);
}
function ackPending(state: MissionState, env: OpEnv): MissionState {
  const pending = lastLessonFeedback(state, env.content);
  return pending ? run(state, [{ op: "lesson-feedback-seen", id: pending.id }], env) : state;
}
const lang = (segmentId: "LANG-EN-WATER" | "LANG-ES-AGUA" | "LANG-ES-STATION" | "LANG-EN-PIER" | "LANG-ES-HARBOR" | "LANG-ES-HARBOR-CHECK", stepId: string, response: string, modality: "typed" | "word-choice" | "listen" = "typed"): LearningOp => ({ op: "language-step", segmentId, stepId, response, modality });
const CH = ["'", "ö", "z"];

/** Explicitly SYNTHETIC fixture (no child record): v1, v2, v4 and v5 finished with scripted answers — the shape from which Besuch 5 must be offered. */
function fourVisitsDone(env: OpEnv): MissionState {
  let s = newMissionState(env.content, "santiago", env.now().toISOString());
  s = run(s, [{ op: "start-visit" }, { op: "name-base", name: "Fixture Basis" }, { op: "place-base", locationId: "shore" }, { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }], env);
  s = ackPending(s, env);
  s = run(s, [{ op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" }], env);
  s = ackPending(s, env);
  s = run(s, [{ op: "explain", text: "Ich habe geteilt.", modality: "typed" }, lang("LANG-EN-WATER", "listen", "", "listen"), lang("LANG-EN-WATER", "pick", "water", "word-choice"), lang("LANG-EN-WATER", "produce", "water"), lang("LANG-EN-WATER", "reuse", "tools", "word-choice")], env);
  s = ackPending(s, env);
  s = run(s, [{ op: "skip-stage", stage: "typing", reason: "child" }, { op: "save-log", text: "Tag eins." }, { op: "reflect", optionId: "easy" }], env);
  s = run(s, [{ op: "start-visit" }, { op: "resume-base" }, { op: "answer-math", itemId: "EQ-RETURN", answer: 7, raw: "7", modality: "typed" }], env);
  s = ackPending(s, env);
  s = run(s, [{ op: "skip-stage", stage: "LANG-ES-AGUA", reason: "child" }, { op: "skip-stage", stage: "typing", reason: "child" }, { op: "save-log", text: "Tag zwei." }, { op: "reflect", optionId: "easy" }], env);
  s = run(s, [{ op: "start-visit" }, { op: "resume-base" }, { op: "choose-station", theme: "turtles" }, { op: "typing-check", observed: CH }, { op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["fff jjj", "fj fj jf"], seconds: 15, comfort: "ok" }], env);
  s = ackPending(s, env);
  s = run(s, [{ op: "typing-course-continue" }, { op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" }], env);
  s = ackPending(s, env);
  s = run(s, [{ op: "explain", text: "Fünf mal sechs.", modality: "typed" }, lang("LANG-ES-STATION", "listen", "", "listen"), lang("LANG-ES-STATION", "pick", "lámpara", "word-choice"), lang("LANG-ES-STATION", "produce", "lámpara"), lang("LANG-ES-STATION", "reuse", "agua", "word-choice")], env);
  s = ackPending(s, env);
  s = run(s, [{ op: "build-station", spot: "beach" }, { op: "save-log", text: "Heute steht die Station." }, { op: "revise-log", text: "Heute steht die Station." }, { op: "write-transfer", text: "Morgen beobachten wir die Schildkröten.", modality: "typed" }], env);
  s = ackPending(s, env);
  s = run(s, [{ op: "summary-seen" }, { op: "reflect", optionId: "easy" }], env);
  s = run(s, [{ op: "start-visit" }, { op: "resume-base" }, { op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["fff jjj", "fj fj jf"], seconds: 15, comfort: "ok" }], env);
  s = ackPending(s, env);
  s = run(s, [{ op: "typing-course-continue" }, { op: "answer-remainder", itemId: "EQ-PIER", used: 42, remaining: 3, raw: "42, 3", modality: "typed" }], env);
  s = ackPending(s, env);
  s = run(s, [{ op: "explain", text: "Sechs mal sieben ist 42, drei bleiben.", modality: "typed" }, lang("LANG-EN-PIER", "listen", "", "listen"), lang("LANG-EN-PIER", "pick", "wood", "word-choice"), lang("LANG-EN-PIER", "produce", "we need wood"), lang("LANG-EN-PIER", "reuse", "rope", "word-choice")], env);
  s = ackPending(s, env);
  s = run(s, [{ op: "build-pier", spot: "bay" }, { op: "save-log", text: "Heute steht der Steg in der Bucht." }, { op: "revise-log", text: "Heute steht der Steg in der Bucht." }, { op: "write-transfer", text: "Morgen bringt das Boot 5 Kisten.", modality: "typed" }], env);
  s = ackPending(s, env);
  return run(s, [{ op: "summary-seen" }, { op: "reflect", optionId: "easy" }], env);
}
/** The whole planning block with scripted, consistent answers (part A and B first try, a consistent explanation, the Spanish segment, the plan, the log). */
function planningBlock(s: MissionState, env: OpEnv, logText = "wir haben 6 bote beladen und 2 kisten sind übrig"): MissionState {
  s = run(s, [{ op: "answer-quotient", itemId: "EQ-HARBOR", full: 6, remaining: 2, raw: "6 voll, 2 übrig", modality: "typed" }, { op: "answer-needed", itemId: "EQ-HARBOR", needed: 7, raw: "7", modality: "typed" }], env);
  s = ackPending(s, env);
  s = run(s, [{ op: "reasoning-turn", text: "6 mal 6 ist 36, 38 minus 36 sind 2 übrig, also 7 Boote.", modality: "typed" }], env);
  s = run(s, [lang("LANG-ES-HARBOR", "listen", "", "listen"), lang("LANG-ES-HARBOR", "produce", "necesitamos herramientas"), lang("LANG-ES-HARBOR", "pick", "cuerdas", "word-choice"), lang("LANG-ES-HARBOR", "reuse", "agua", "word-choice")], env);
  s = ackPending(s, env);
  return run(s, [{ op: "plan-harbor", destination: "lighthouse" }, { op: "save-log", text: logText }], env);
}
function typingBlock(s: MissionState, env: OpEnv): MissionState {
  s = run(s, [{ op: "typing-burst", lessonId: "TYPE-CH-COURSE-2", lines: ["ddd kkk", "fdk jkd"], seconds: 15, comfort: "ok" }], env);
  s = ackPending(s, env);
  return run(s, [{ op: "typing-course-continue" }], env);
}
function closingBlock(s: MissionState, env: OpEnv, revised = "Wir haben 6 Boote beladen und 2 Kisten sind übrig."): MissionState {
  s = run(s, [{ op: "answer-quotient", itemId: "EQ-HARBOR-CHECK", full: 5, remaining: 1, raw: "5, 1", modality: "typed" }, { op: "answer-needed", itemId: "EQ-HARBOR-CHECK", needed: 6, raw: "6", modality: "typed" }], env);
  s = ackPending(s, env);
  s = run(s, [lang("LANG-ES-HARBOR-CHECK", "produce", "necesitamos cuerdas")], env);
  s = ackPending(s, env);
  s = run(s, [{ op: "review-log", text: revised }], env);
  return ackPending(s, env);
}

describe("Visit 5 content (version 4) — reconciliation by stable id", () => {
  it("version 4 reconciles; versions 1–3 still reconcile; the retained v3 entries are byte-identical in v4", () => {
    const r = reconcileLearningContent(rawV4);
    deepStrictEqual(r.problems, []);
    deepStrictEqual(r.counts, { math: 11, language: 6, typingLessons: 3, typingLabels: 2, typingCourse: 5, visits: 6 });
    ok(reconcileLearningContent(rawV3).ok);
    deepStrictEqual(rawV4.visits.slice(0, 5), rawV3.visits, "v1–v5 unchanged");
    deepStrictEqual(rawV4.math.items.slice(0, rawV3.math.items.length), rawV3.math.items);
    deepStrictEqual(rawV4.language.segments.slice(0, rawV3.language.segments.length), rawV3.language.segments);
    deepStrictEqual(rawV4.typing, rawV3.typing);
    deepStrictEqual(rawV4.writing.spacing, rawV3.writing.spacing);
    deepStrictEqual(rawV4.writing.transfers, rawV3.writing.transfers);
    deepStrictEqual(rawV4.visits[5].stages, EXPECTED_V6_STAGES);
    deepStrictEqual(["restore", "island", ...EXPECTED_HARBOR_WORKPLACES.typing, "island", ...EXPECTED_HARBOR_WORKPLACES.planning, "island", ...EXPECTED_HARBOR_WORKPLACES.closing, "summary", "reflect"], EXPECTED_V6_STAGES);
  });
  it("refuses a broken quotient key, a non-composing stage list, a missing character language or a frozen v5 list change", () => {
    const bad = (mutate: (c: typeof rawV4) => void) => {
      const c = JSON.parse(JSON.stringify(rawV4));
      mutate(c);
      return reconcileLearningContent(c);
    };
    ok(!bad((c) => (c.math.items.find((m: { id: string }) => m.id === "EQ-HARBOR").answers.needed = 6)).ok, "needed must be full + 1");
    ok(!bad((c) => (c.math.items.find((m: { id: string }) => m.id === "EQ-HARBOR").answers.remaining = 3)).ok);
    ok(!bad((c) => c.visits[5].stages.reverse()).ok);
    ok(!bad((c) => (c.harbor.characters[0].language = "de")).ok, "three languages, one each");
    ok(!bad((c) => c.visits[4].stages.push("island")).ok, "v5 frozen");
    ok(!bad((c) => (c.writing.review.maxTeachingPoints = 3)).ok, "at most two taught points");
    ok(!bad((c) => (c.writing.review.misspellings[0].right = "groß")).ok, "Swiss spelling");
    ok(!bad((c) => (c.reasoning.maxProbes = 5)).ok, "bounded probing");
  });
  it("vocabulary inventory v3 reconciles against v4 (German writing contexts bound to the captain's log), v2 still reconciles against v3; the 17 earlier entries keep their ids", () => {
    const r = reconcileVocabularyInventory(rawInv3, v4);
    deepStrictEqual(r.problems, []);
    equal(r.counts.entries, 30);
    ok(reconcileVocabularyInventory(rawInv2, v3).ok);
    const ids2 = rawInv2.entries.map((e: { id: string }) => e.id);
    deepStrictEqual(rawInv3.entries.slice(0, 17).map((e: { id: string }) => e.id), ids2);
    equal(rawInv3.entries.filter((e: { language: string }) => e.language === "de").length, 9);
    // German entries exist only from inventory version 3
    const c = JSON.parse(JSON.stringify(rawInv3));
    c.inventoryVersion = 2;
    ok(!reconcileVocabularyInventory(c, v4).ok);
  });
  it("the telemetry enumerations cover the new ops and stages", () => {
    for (const op of ["enter-workplace", "answer-quotient", "answer-needed", "reasoning-turn", "reasoning-choice", "plan-harbor", "review-log"]) ok((TELEMETRY_OPS as readonly string[]).includes(op), op);
    for (const stage of EXPECTED_V6_STAGES) ok((TELEMETRY_STAGES as readonly string[]).includes(stage), stage);
  });
});

describe("Visit 5 — progression and the free workplace order", () => {
  it("is offered immediately after the finished pier chapter as Besuch 5 (internal v6); never from fewer visits; parked under the v3 cap", () => {
    const env = makeEnv(v4);
    const s = fourVisitsDone(env);
    deepStrictEqual(nextVisitAvailability(s, v4, env.now()), { visit: "v6", availableAt: null });
    equal(visitOrdinal(s, "v6"), 5);
    equal(visitLabel(s, v4, "v6"), "Besuch 5 — Der Hafen");
    deepStrictEqual(nextVisitAvailability(s, v3, env.now()), { visit: null, availableAt: null, reason: "all-visits-done" });
    const view = buildChildView(s, v4, env.settings, env.now(), 0, { vocabulary: inv3 });
    ok(isChildView(view, "santiago"));
    equal(view.next.visit, "v6");
    equal(view.progress.next.label, "Besuch 5 — Der Hafen");
    equal(view.progress.completedTotal, 4);
    // Under the v3 cap a RUNNING v6 is parked: nothing offered, nothing changed, the view still validates.
    const running = run(s, [{ op: "start-visit" }, { op: "resume-base" }, { op: "enter-workplace", workplace: "planning" }], env);
    deepStrictEqual(nextVisitAvailability(running, v3, env.now()), { visit: null, availableAt: null, reason: "chapter-unavailable" });
    equal(currentStage(running, v3), null, "a parked visit has no stage under the cap, whatever its saved route says");
    equal(ensureItemShown(running, v3, env.now()).changed, false);
    const capped = buildChildView(running, v3, env.settings, env.now(), 0);
    ok(isChildView(capped, "santiago"));
    equal(capped.visit, null);
    equal(capped.harbor, null);
    throws(() => apply(running, { op: "enter-workplace", workplace: "typing" }, makeEnv(v3)), LearningOpError);
  });
  it("starting v6 creates the per-visit route; entering a workplace moves its block to the front; the closing check stays locked until both are done; a done workplace cannot be entered again", () => {
    const env = makeEnv(v4);
    let s = run(fourVisitsDone(env), [{ op: "start-visit" }, { op: "resume-base" }], env);
    const visit = s.visits.find((v) => v.id === "v6")!;
    deepStrictEqual(visit.route, [...EXPECTED_V6_STAGES]);
    equal(currentStage(s, v4), "island");
    deepStrictEqual(workplaceStatuses(s, v4, visit).map((w) => `${w.id}:${w.status}`), ["typing:open", "planning:open", "closing:locked"]);
    throws(() => apply(s, { op: "enter-workplace", workplace: "closing" }, env), /not open/);
    // planning first
    s = run(s, [{ op: "enter-workplace", workplace: "planning" }], env);
    deepStrictEqual(s.visits.find((v) => v.id === "v6")!.route, ["restore", "island", "EQ-HARBOR", "explain", "LANG-ES-HARBOR", "harbor-build", "log", "island", "typing-course", "island", "EQ-HARBOR-CHECK", "LANG-ES-HARBOR-CHECK", "log-review", "summary", "reflect"]);
    equal(currentStage(s, v4), "EQ-HARBOR");
    deepStrictEqual(s.harbor!.entered, ["planning"]);
    s = planningBlock(s, env);
    equal(currentStage(s, v4), "island");
    deepStrictEqual(workplaceStatuses(s, v4, s.visits.find((v) => v.id === "v6")!).map((w) => `${w.id}:${w.status}`), ["typing:open", "planning:done", "closing:locked"]);
    throws(() => apply(s, { op: "enter-workplace", workplace: "planning" }, env), /not open/);
    s = run(s, [{ op: "enter-workplace", workplace: "typing" }], env);
    equal(currentStage(s, v4), "typing-course");
    s = typingBlock(s, env);
    equal(currentStage(s, v4), "island");
    deepStrictEqual(workplaceStatuses(s, v4, s.visits.find((v) => v.id === "v6")!).map((w) => `${w.id}:${w.status}`), ["typing:done", "planning:done", "closing:open"]);
    s = run(s, [{ op: "enter-workplace", workplace: "closing" }], env);
    equal(currentStage(s, v4), "EQ-HARBOR-CHECK");
    const view = buildChildView(s, v4, env.settings, env.now(), 0, { vocabulary: inv3 });
    equal(view.visit!.stageCount, 15);
    ok(isChildView(view, "santiago"));
  });
  it("typing first keeps the default order; the typing course resumes at the saved lesson (nothing replayed) and a skipped round is a skip, not practice", () => {
    const env = makeEnv(v4);
    let s = run(fourVisitsDone(env), [{ op: "start-visit" }, { op: "resume-base" }, { op: "enter-workplace", workplace: "typing" }], env);
    deepStrictEqual(s.visits.find((v) => v.id === "v6")!.route, [...EXPECTED_V6_STAGES]);
    const view = buildChildView(s, v4, env.settings, env.now(), 0);
    equal(view.typingCourse!.lesson!.id, "TYPE-CH-COURSE-2", "the fixture advanced to lesson 2 after two good rounds; the course continues there");
    equal(s.typing.course!.bursts.length, 2);
    s = run(s, [{ op: "typing-course-continue" }], env);
    equal(currentStage(s, v4), "island");
    deepStrictEqual(s.visits.find((v) => v.id === "v6")!.skippedStages, [{ stage: "typing-course", reason: "child" }]);
    deepStrictEqual(workplaceStatuses(s, v4, s.visits.find((v) => v.id === "v6")!).map((w) => w.status), ["done", "open", "locked"]);
  });
  it("save/leave is always possible: a visit parked at any stage resumes at the same stage with the same route after a reload (JSON round trip)", () => {
    const env = makeEnv(v4);
    const s = run(fourVisitsDone(env), [{ op: "start-visit" }, { op: "resume-base" }, { op: "enter-workplace", workplace: "planning" }, { op: "answer-quotient", itemId: "EQ-HARBOR", full: 6, remaining: 2, raw: "6, 2", modality: "typed" }], env);
    const reloaded = upgradeMissionState(JSON.parse(JSON.stringify(s)), v4, env.now().toISOString()).state;
    equal(currentStage(reloaded, v4), "EQ-HARBOR");
    equal(reloaded.math["EQ-HARBOR"]!.part, "needed");
    deepStrictEqual(reloaded.visits.find((v) => v.id === "v6")!.route, s.visits.find((v) => v.id === "v6")!.route);
    deepStrictEqual(nextVisitAvailability(reloaded, v4, env.now()), { visit: "v6", availableAt: null });
  });
});

describe("Visit 5 — the two-part harbor item (quotient)", () => {
  function toHarbor(env: OpEnv) {
    return run(fourVisitsDone(env), [{ op: "start-visit" }, { op: "resume-base" }, { op: "enter-workplace", workplace: "planning" }], env);
  }
  it("part A (full boats, remaining) then part B (boats for all); each part has its own freshness; the supplies grow; the lesson feedback names both parts", () => {
    const env = makeEnv(v4);
    let s = toHarbor(env);
    let view = buildChildView(s, v4, env.settings, env.now(), 0);
    equal(view.math!.kind, "quotient");
    equal(view.math!.part, "full-remaining");
    deepStrictEqual(view.math!.quotientWords, { fullLabel: "Volle Boote", remainingLabel: "Kisten übrig", neededLabel: "Boote für alle Kisten" });
    throws(() => apply(s, { op: "answer-needed", itemId: "EQ-HARBOR", needed: 7, raw: "7", modality: "typed" }, env), /full groups/);
    throws(() => apply(s, { op: "answer-remainder", itemId: "EQ-HARBOR", used: 36, remaining: 2, raw: "", modality: "typed" }, env), LearningOpError);
    const a = apply(s, { op: "answer-quotient", itemId: "EQ-HARBOR", full: 6, remaining: 2, raw: "6 voll, 2 übrig", modality: "typed" }, env);
    deepStrictEqual({ correct: a.result.correct, evidence: a.result.evidence, nextPart: a.result.nextPart }, { correct: true, evidence: "independent", nextPart: "needed" });
    s = a.state;
    equal(s.math["EQ-HARBOR"]!.outcome, "pending", "not resolved before part B");
    view = buildChildView(s, v4, env.settings, env.now(), 0);
    equal(view.math!.part, "needed");
    equal(view.math!.decisionPrompt, "Alle 38 Kisten müssen mit. Wie viele Boote braucht ihr dafür insgesamt?");
    deepStrictEqual(view.math!.partA, { full: 6, remaining: 2 });
    const b1 = apply(s, { op: "answer-needed", itemId: "EQ-HARBOR", needed: 6, raw: "6", modality: "typed" }, env);
    deepStrictEqual({ correct: b1.result.correct, feedback: b1.result.feedback }, { correct: false, feedback: "clarify" });
    equal(buildChildView(b1.state, v4, env.settings, env.now(), 0).math!.clarification, "Die übrigen Kisten müssen auch mit. Passen sie noch in ein volles Boot — oder braucht es ein Boot mehr?");
    const b2 = apply(b1.state, { op: "answer-needed", itemId: "EQ-HARBOR", needed: 7, raw: "7", modality: "typed" }, env);
    deepStrictEqual({ correct: b2.result.correct, evidence: b2.result.evidence, feedback: b2.result.feedback }, { correct: true, evidence: "supported", feedback: "done" });
    s = b2.state;
    deepStrictEqual(s.math["EQ-HARBOR"]!.quotientResult, { full: 6, remaining: 2, needed: 7 });
    equal(s.base.supplies.Kisten, 38);
    equal(currentStage(s, v4), "explain");
    const attempts = s.math["EQ-HARBOR"]!.attempts;
    deepStrictEqual(attempts.map((x) => [x.part, x.correct, x.evidence]), [["full-remaining", true, "independent"], ["needed", false, "incorrect"], ["needed", true, "supported"]]);
    const fb = lastLessonFeedback(s, v4)!;
    equal(fb.lesson.kind, "math");
    equal(fb.close.kind, "corrected-with-help");
    deepStrictEqual(fb.mistakes.map((m) => [m.given, m.expected]), [["6 für alle", "7 Boote für alle"]]);
    ok(fb.success && /6 Boote voll, 2 übrig, 7 Boote für alle/.test(fb.success.text));
  });
  it("two wrong part-A answers reach the quotient example (recorded once), a third wrong offers teaching; direct teaching resolves both parts with answer_revealed", () => {
    const env = makeEnv(v4);
    let s = toHarbor(env);
    s = run(s, [{ op: "answer-quotient", itemId: "EQ-HARBOR", full: 7, remaining: 0, raw: "7, 0", modality: "typed" }], env);
    equal(s.math["EQ-HARBOR"]!.phase, "clarify");
    const second = apply(s, { op: "answer-quotient", itemId: "EQ-HARBOR", full: 5, remaining: 8, raw: "5, 8", modality: "typed" }, env);
    equal(second.result.feedback, "example");
    equal(second.state.harborModelShownAt !== null && second.state.harborModelShownAt !== undefined, true);
    deepStrictEqual(second.records.exposures.map((e) => [e.taskId, e.kind]), [["EQ-HARBOR-MODEL", "example_shown"]]);
    s = second.state;
    const view = buildChildView(s, v4, env.settings, env.now(), 0);
    equal(view.math!.example!.prompt, "Schau zu: 14 Kisten, und in jeden Karren passen genau 4.");
    ok(view.math!.teachingOffered);
    s = run(s, [{ op: "continue-item", itemId: "EQ-HARBOR" }], env);
    const third = apply(s, { op: "answer-quotient", itemId: "EQ-HARBOR", full: 4, remaining: 14, raw: "4, 14", modality: "typed" }, env);
    equal(third.result.feedback, "teach-or-stop");
    const taught = apply(third.state, { op: "request-teaching", itemId: "EQ-HARBOR" }, env);
    equal(taught.state.math["EQ-HARBOR"]!.outcome, "taught");
    deepStrictEqual(taught.state.math["EQ-HARBOR"]!.quotientResult, { full: 6, remaining: 2, needed: 7 });
    equal(taught.state.math["EQ-HARBOR"]!.exposure, "answer_revealed");
    equal(currentStage(taught.state, v4), "explain");
    const scene = buildSceneModel(taught.state, v4);
    deepStrictEqual({ full: scene.harbor.fullBoats, remaining: scene.harbor.remaining, needed: scene.harbor.boatsNeeded }, { full: 6, remaining: 2, needed: 7 });
  });
  it("an uncertain answer stays unscored and keeps the phase; the counters make a later correct answer supported", () => {
    const env = makeEnv(v4);
    const s = toHarbor(env);
    const u = apply(s, { op: "answer-quotient", itemId: "EQ-HARBOR", full: null, remaining: null, raw: "weiss nicht", modality: "typed", uncertain: true }, env);
    deepStrictEqual({ correct: u.result.correct, evidence: u.result.evidence }, { correct: null, evidence: "unscored" });
    equal(u.state.math["EQ-HARBOR"]!.phase, "answer");
    const c = apply(u.state, { op: "answer-quotient", itemId: "EQ-HARBOR", full: 6, remaining: 2, raw: "6 voll, 2 übrig", modality: "counters" }, env);
    equal(c.result.evidence, "supported");
  });
});

describe("Visit 5 — the reasoning conversation (reviewed probe policy)", () => {
  const item = v4.math.items.find((m) => m.id === "EQ-HARBOR")!;
  const def = v4.reasoning!;
  it("classifies: vague, numbers without meaning, consistent multiplication (6×6 and 6×7 alike), division, repeated addition, a contradiction", () => {
    equal(classifyExplanation("Ich habe ales mal gerechnet.", item).kind, "vague");
    equal(classifyExplanation("einfach so", item).kind, "vague");
    equal(classifyExplanation("6 und 7", item).kind, "numbers-no-meaning");
    equal(classifyExplanation("6 mal 6 ist 36", item).kind, "consistent");
    equal(classifyExplanation("sechs mal sieben ist 42, das ist zu viel, also 6 Boote", item).kind, "consistent", "6 × 7 = 42 > 38 is a valid strategy");
    equal(classifyExplanation("38 geteilt durch 6", item).kind, "consistent");
    equal(classifyExplanation("6 plus 6 plus 6 plus 6 plus 6 plus 6 ist 36", item).kind, "consistent");
    equal(classifyExplanation("ich habe die Kisten gezählt, immer 6", item).kind, "consistent");
    const contra = classifyExplanation("5 mal 6 ist 36", item);
    equal(contra.kind, "contradiction");
    equal(contra.claim, "5 mal 6 ist 36");
    equal(classifyExplanation("4 Boote waren voll", item).kind, "contradiction");
    ok(classifyExplanation("6 mal 6 ist 36 und 2 bleiben übrig", item).mentionsRemainder);
  });
  it("accepts a consistent first explanation with remainder as explained-independently; a consistent one without the remainder gets the remainder probe, then acceptance after probing", () => {
    const t = "2026-10-10T10:00:00.000Z";
    let st = newReasoningState("EQ-HARBOR", def, t);
    equal(st.turns[0].text, def.prompt);
    const a = applyReasoningTurn(st, "6 mal 6 ist 36, 38 minus 36 sind 2 übrig", "typed", item, def, t);
    deepStrictEqual({ done: a.done, method: a.state.method, kind: a.nabu.kind }, { done: true, method: "explained-independently", kind: "accept" });
    st = newReasoningState("EQ-HARBOR", def, t);
    const b = applyReasoningTurn(st, "6 mal 7 ist 42", "spoken", item, def, t);
    deepStrictEqual({ done: b.done, probe: b.nabu.probe, text: b.nabu.text }, { done: false, probe: "remainder", text: def.probes.remainder });
    const c = applyReasoningTurn(b.state, "38 minus 36 sind 2 übrig", "spoken", item, def, t);
    deepStrictEqual({ done: c.done, method: c.state.method, probesUsed: c.state.probesUsed }, { done: true, method: "explained-after-probing", probesUsed: 1 });
    ok(c.state.turns.filter((x) => x.role === "child").every((x) => x.modality === "spoken"));
  });
  it("probes a vague explanation with the multiplication wording, then asks for the meaning of named numbers, challenges a specific contradiction, and stops after maxProbes with the scaffold", () => {
    const t = "2026-10-10T10:00:00.000Z";
    const st = newReasoningState("EQ-HARBOR", def, t);
    const p1 = applyReasoningTurn(st, "Ich habe ales mal gerechnet.", "spoken", item, def, t);
    equal(p1.nabu.text, "Welche Zahlen hast du miteinander malgenommen?");
    const p2 = applyReasoningTurn(p1.state, "6 und 7", "spoken", item, def, t);
    equal(p2.nabu.text, "Was bedeuten die 6 und die 7 in deinem Plan?");
    const p3 = applyReasoningTurn(p2.state, "5 mal 6 ist 36", "typed", item, def, t);
    equal(p3.nabu.text, "Du sagst 5 mal 6 ist 36. Wie viele Boote waren bei dir voll?");
    equal(p3.state.probesUsed, 3);
    const p4 = applyReasoningTurn(p3.state, "weiss nicht", "typed", item, def, t);
    deepStrictEqual({ done: p4.done, status: p4.state.status, text: p4.nabu.text }, { done: false, status: "scaffold", text: def.scaffold });
    throws(() => applyReasoningTurn(p4.state, "noch was", "typed", item, def, t), /closed|scaffold/);
    // scaffold: continue → not yet established; teach → explained with support; counters → one more turn, then "with support" even if consistent
    equal(applyReasoningChoice(p4.state, "continue", def, t).state.method, "not-yet-established");
    const teach = applyReasoningChoice(p4.state, "teach", def, t);
    deepStrictEqual({ method: teach.state.method, text: teach.nabu.text, support: teach.state.support }, { method: "explained-with-support", text: def.teach, support: ["teaching"] });
  });
  it("never records a probe or Nabu's line as the child's explanation; the explanation sample carries only the child's words", () => {
    const env = makeEnv(v4);
    let s = run(fourVisitsDone(env), [{ op: "start-visit" }, { op: "resume-base" }, { op: "enter-workplace", workplace: "planning" }, { op: "answer-quotient", itemId: "EQ-HARBOR", full: 6, remaining: 2, raw: "6, 2", modality: "typed" }, { op: "answer-needed", itemId: "EQ-HARBOR", needed: 7, raw: "7", modality: "typed" }], env);
    s = ackPending(s, env);
    throws(() => apply(s, { op: "explain", text: "x", modality: "typed" }, env), /reasoning-turn/);
    const r1 = apply(s, { op: "reasoning-turn", text: "Ich habe ales mal gerechnet.", modality: "spoken" }, env);
    equal(r1.records.samples[0].kind, "reasoning_turn");
    equal(r1.records.samples[0].modality, "spoken");
    equal((r1.records.samples[0].metrics as { spellingJudged: boolean }).spellingJudged, false);
    equal(currentStage(r1.state, v4), "explain", "the stage stays until the conversation is done");
    const view = buildChildView(r1.state, v4, env.settings, env.now(), 0);
    equal(view.reasoning!.status, "open");
    equal(view.reasoning!.probesLeft, 2);
    equal(view.tutor!.taskId, "EQ-HARBOR");
    equal(view.tutor!.page, "mission");
    deepStrictEqual(view.tutor!.priorAttempts, ["„Ich habe ales mal gerechnet.“ (spoken)"]);
    const r2 = apply(r1.state, { op: "reasoning-turn", text: "6 mal 6 sind 36 und 2 sind übrig", modality: "typed" }, env);
    equal(r2.result.done, true);
    equal(currentStage(r2.state, v4), "LANG-ES-HARBOR");
    const explanation = r2.state.explanations.at(-1)!;
    equal(explanation.text, "Ich habe ales mal gerechnet. 6 mal 6 sind 36 und 2 sind übrig");
    equal(explanation.taskId, "EQ-HARBOR");
    const sample = r2.records.samples.find((x) => x.kind === "explanation")!;
    deepStrictEqual((sample.metrics as { method: string; probesUsed: number; support: string[] }), { ...(sample.metrics as object), method: "explained-after-probing", probesUsed: 1, support: [] } as never);
    // skipping an open conversation closes it honestly
    const skipped = apply(r1.state, { op: "skip-stage", stage: "explain", reason: "child" }, env);
    equal(skipped.state.reasoning!["EQ-HARBOR"]!.method, "not-yet-established");
    equal(skipped.state.reasoning!["EQ-HARBOR"]!.status, "done");
  });
  it("the counters at the scaffold are recorded as answer-relevant support on the resolved item and make the explanation 'with support'", () => {
    const env = makeEnv(v4);
    let s = run(fourVisitsDone(env), [{ op: "start-visit" }, { op: "resume-base" }, { op: "enter-workplace", workplace: "planning" }, { op: "answer-quotient", itemId: "EQ-HARBOR", full: 6, remaining: 2, raw: "6, 2", modality: "typed" }, { op: "answer-needed", itemId: "EQ-HARBOR", needed: 7, raw: "7", modality: "typed" }], env);
    s = ackPending(s, env);
    s = run(s, [{ op: "reasoning-turn", text: "keine ahnung", modality: "typed" }, { op: "reasoning-turn", text: "hm", modality: "typed" }, { op: "reasoning-turn", text: "egal", modality: "typed" }, { op: "reasoning-turn", text: "weiss nicht", modality: "typed" }], env);
    equal(s.reasoning!["EQ-HARBOR"]!.status, "scaffold");
    const c = apply(s, { op: "reasoning-choice", choice: "counters" }, env);
    deepStrictEqual(c.records.supports.map((x) => [x.taskId, x.kind]), [["EQ-HARBOR", "representation"]]);
    ok(c.state.math["EQ-HARBOR"]!.supportGiven.includes("representation"));
    equal(c.state.math["EQ-HARBOR"]!.attempts[0].evidence, "independent", "earlier independent answers are never reclassified");
    const after = apply(c.state, { op: "reasoning-turn", text: "6 Boote voll, 2 übrig, 6 mal 6 ist 36", modality: "typed" }, env);
    equal(after.state.reasoning!["EQ-HARBOR"]!.method, "explained-with-support");
    equal(after.result.done, true);
  });
});

describe("Visit 5 — Spanish supplier, plan and the island consequences", () => {
  it("recall of herramientas before the word is shown is independent; opening the word list makes it copying; the new word cuerdas is recognised; cuerdas supply ties the boats", () => {
    const env = makeEnv(v4);
    let s = run(fourVisitsDone(env), [{ op: "start-visit" }, { op: "resume-base" }, { op: "enter-workplace", workplace: "planning" }, { op: "answer-quotient", itemId: "EQ-HARBOR", full: 6, remaining: 2, raw: "6, 2", modality: "typed" }, { op: "answer-needed", itemId: "EQ-HARBOR", needed: 7, raw: "7", modality: "typed" }], env);
    s = ackPending(s, env);
    s = run(s, [{ op: "reasoning-turn", text: "6 mal 6 ist 36 und 2 übrig", modality: "typed" }, lang("LANG-ES-HARBOR", "listen", "", "listen")], env);
    const view = buildChildView(s, v4, env.settings, env.now(), 0);
    equal(view.language!.step!.kind, "produce");
    const independent = apply(s, lang("LANG-ES-HARBOR", "produce", "necesitamos herramientas"), env);
    equal(independent.records.attempts[0].evidence, "independent");
    equal((independent.records.attempts[0].answer as { productionKind: string }).productionKind, "independent");
    const helped = run(s, [{ op: "support", taskId: "LANG-ES-HARBOR", kind: "word_choice", payload: { text: "opened" } }], env);
    const copied = apply(helped, lang("LANG-ES-HARBOR", "produce", "necesitamos herramientas", "word-choice"), env);
    equal((copied.records.attempts[0].answer as { productionKind: string }).productionKind, "copying");
    equal(copied.records.attempts[0].evidence, "supported");
    const bare = apply(s, lang("LANG-ES-HARBOR", "produce", "herramientas"), env);
    equal(bare.records.attempts[0].objective, "language-es-completion", "a bare word is a lexical completion, not phrase production");
    const wrong = apply(s, lang("LANG-ES-HARBOR", "produce", "necesitamos agua"), env);
    equal(wrong.result.correct, false);
    s = run(independent.state, [lang("LANG-ES-HARBOR", "pick", "cuerdas", "word-choice"), lang("LANG-ES-HARBOR", "reuse", "agua", "word-choice")], env);
    equal(s.base.supplies.cuerdas, 1);
    s = ackPending(s, env);
    const planned = apply(s, { op: "plan-harbor", destination: "lighthouse" }, env);
    deepStrictEqual(planned.result, { destination: "lighthouse", roped: true });
    throws(() => apply(planned.state, { op: "plan-harbor", destination: "mainland" }, makeEnv(v4)), LearningOpError);
    const scene = buildSceneModel(planned.state, v4);
    deepStrictEqual({ planned: scene.harbor.planned, destination: scene.harbor.destination, roped: scene.harbor.roped, boats: scene.harbor.fullBoats }, { planned: true, destination: "lighthouse", roped: true, boats: 6 });
  });
  it("without cuerdas the plan is saved with loose boats (honest consequence)", () => {
    const env = makeEnv(v4);
    let s = run(fourVisitsDone(env), [{ op: "start-visit" }, { op: "resume-base" }, { op: "enter-workplace", workplace: "planning" }, { op: "answer-quotient", itemId: "EQ-HARBOR", full: 6, remaining: 2, raw: "6, 2", modality: "typed" }, { op: "answer-needed", itemId: "EQ-HARBOR", needed: 7, raw: "7", modality: "typed" }], env);
    s = ackPending(s, env);
    s = run(s, [{ op: "reasoning-turn", text: "6 mal 6 ist 36 und 2 übrig", modality: "typed" }, { op: "skip-stage", stage: "LANG-ES-HARBOR", reason: "child" }], env);
    const planned = apply(s, { op: "plan-harbor", destination: "ship" }, env);
    equal(planned.result.roped, false);
    ok(/ohne Seile/.test(buildVisitReports(planned.state, v4).find((r) => r.visit === "v6")!.worldChanges.join(" ")));
  });
});

describe("Visit 5 — writing review of the child's own sentence", () => {
  const def = v4.writing!.review!;
  const joins = v4.writing!.spacing.joins;
  it("diagnoses broadly but teaches at most two points in priority order; names the clean aspects; never says everything is right", () => {
    const r = reviewLogSentence("wir haben 6 bote beladen und 2 kisten sind übrig", def, joins);
    deepStrictEqual(r.findings.map((f) => f.id), ["capitalization:start", "capitalization:kisten", "spelling:bote", "punctuation:end"]);
    deepStrictEqual([...new Set(r.taught.map((f) => f.aspect))], ["capitalization", "spelling"]);
    deepStrictEqual(r.clean, ["meaning", "completeness", "spacing"]);
    equal(r.suggestion, "Wir haben 6 Boote beladen und 2 Kisten sind übrig");
    ok(/Satzzeichen kommt ein andermal/.test(r.summary));
    ok(/Alles andere habe ich nicht geprüft/.test(r.summary));
    ok(!/alles richtig/i.test(r.summary));
    equal(r.taskFulfilled, true);
  });
  it("a sentence without the task's content is a meaning finding first; a missing verb is incompleteness; spacing uses the reviewed checker", () => {
    const r = reviewLogSentence("Heute war ich da.", def, joins);
    equal(r.taught[0].aspect, "meaning");
    equal(r.taskFulfilled, false);
    ok(/sagt noch nicht, was gebaut oder transportiert wurde/.test(r.taught[0].teaching));
    const v = reviewLogSentence("Die Boote und die Kisten.", def, joins);
    ok(v.findings.some((f) => f.id === "completeness:verb"));
    const sp = reviewLogSentence("Ichhabe 6Boote beladen.", def, joins);
    ok(sp.findings.some((f) => f.aspect === "spacing"));
    equal(sp.marked, "Ich|habe 6|Boote beladen.");
  });
  it("an unknown word is asked about, never rewritten or called wrong; meaning stays undecidable while it is the only clue", () => {
    const r = reviewLogSentence("Wir haben die Flurbs transportiert.", def, joins);
    deepStrictEqual(r.unknownWords, ["Flurbs"]);
    equal(r.taskFulfilled, true, "transportiert names the task");
    ok(!r.findings.some((f) => f.given === "Flurbs"));
    const only = reviewLogSentence("Wir haben Flurbs gemacht.", def, joins);
    equal(only.taskFulfilled, null);
    ok(!only.findings.some((f) => f.aspect === "meaning"), "ambiguity stays unscored, not wrong");
    ok(/Flurbs/.test(only.summary));
  });
  it("a reviewed misspelling of a task word still fulfils the task; Swiss spelling is never flagged as wrong", () => {
    const r = reviewLogSentence("Wir haben 6 Bote beladen.", def, joins);
    equal(r.taskFulfilled, true);
    deepStrictEqual(r.findings.map((f) => f.id), ["spelling:bote"]);
    const ss = reviewLogSentence("Das Boot ist gross und voll.", def, joins);
    ok(!ss.findings.some((f) => f.aspect === "spelling"));
  });
  it("the revision is judged on the taught points only: resolved, partial, unchanged; copying the suggestion is marked", () => {
    const r = reviewLogSentence("wir haben 6 bote beladen und 2 kisten sind übrig", def, joins);
    const all = evaluateLogRevision(r, "Wir haben 6 Boote beladen und 2 Kisten sind übrig", def, joins);
    deepStrictEqual({ outcome: all.outcome, unresolved: all.unresolved, copied: all.copiedSuggestion }, { outcome: "revised", unresolved: [], copied: true });
    const own = evaluateLogRevision(r, "Wir haben 6 Boote beladen und 2 Kisten sind übrig.", def, joins);
    deepStrictEqual({ outcome: own.outcome, copied: own.copiedSuggestion }, { outcome: "revised", copied: false });
    const part = evaluateLogRevision(r, "Wir haben 6 bote beladen und 2 Kisten sind übrig", def, joins);
    deepStrictEqual({ outcome: part.outcome, unresolved: part.unresolved }, { outcome: "partial", unresolved: ["spelling:bote"] });
    equal(evaluateLogRevision(r, "wir haben 6 bote beladen und 2 kisten sind übrig", def, joins).outcome, "unchanged");
    const none = reviewLogSentence("Wir haben 6 Boote beladen.", def, joins);
    equal(evaluateLogRevision(none, "Wir haben 6 Boote beladen.", def, joins).outcome, "none-needed");
  });
  it("in the state machine: the review is the closing writing lesson; original and revision stay apart; a copied suggestion is supported, an own revision after the shown suggestion is supported too, nothing taught is unscored; a spoken page is not reviewed", () => {
    const env = makeEnv(v4);
    let s = run(fourVisitsDone(env), [{ op: "start-visit" }, { op: "resume-base" }, { op: "enter-workplace", workplace: "planning" }], env);
    s = planningBlock(s, env);
    s = run(s, [{ op: "enter-workplace", workplace: "typing" }], env);
    s = typingBlock(s, env);
    s = run(s, [{ op: "enter-workplace", workplace: "closing" }, { op: "answer-quotient", itemId: "EQ-HARBOR-CHECK", full: 5, remaining: 1, raw: "5, 1", modality: "typed" }, { op: "answer-needed", itemId: "EQ-HARBOR-CHECK", needed: 6, raw: "6", modality: "typed" }], env);
    s = ackPending(s, env);
    s = run(s, [lang("LANG-ES-HARBOR-CHECK", "produce", "necesitamos cuerdas")], env);
    s = ackPending(s, env);
    equal(currentStage(s, v4), "log-review");
    const view = buildChildView(s, v4, env.settings, env.now(), 0);
    equal(view.logReview!.original, "wir haben 6 bote beladen und 2 kisten sind übrig");
    deepStrictEqual(view.logReview!.taught.map((t) => t.aspect), ["capitalization", "capitalization", "spelling"]);
    ok(isChildView(view, "santiago"));
    const copied = apply(s, { op: "review-log", text: view.logReview!.suggestion! }, env);
    equal(copied.records.attempts[0].evidence, "supported");
    ok(/copied/.test(copied.records.attempts[0].uncertainty ?? ""));
    const own = apply(s, { op: "review-log", text: "Wir haben 6 Boote beladen und 2 Kisten sind übrig." }, env);
    deepStrictEqual({ outcome: own.result.outcome, evidence: own.records.attempts[0].evidence }, { outcome: "revised", evidence: "supported" });
    const rec = own.state.logReviews!.at(-1)!;
    equal(rec.original, "wir haben 6 bote beladen und 2 kisten sind übrig");
    equal(rec.revised, "Wir haben 6 Boote beladen und 2 Kisten sind übrig.");
    equal(rec.helpShown, true);
    const fb = lastLessonFeedback(own.state, v4)!;
    equal(fb.lesson.kind, "writing");
    equal(fb.close.kind, "corrected-with-practice");
    ok(fb.success && /Grossschreibung und Schreibweise/.test(fb.success.text));
    const skipped = apply(s, { op: "skip-stage", stage: "log-review", reason: "child" }, env);
    equal(skipped.state.logReviews!.at(-1)!.outcome, "skipped");
    equal(currentStage(skipped.state, v4), "summary");
  });
});

describe("Visit 5 — closeout, reports, parent evidence, ledger, wordbook, upgrade", () => {
  function finished(logText?: string) {
    const env = makeEnv(v4);
    let s = run(fourVisitsDone(env), [{ op: "start-visit" }, { op: "resume-base" }, { op: "enter-workplace", workplace: "planning" }], env);
    s = planningBlock(s, env, logText);
    s = run(s, [{ op: "enter-workplace", workplace: "typing" }], env);
    s = typingBlock(s, env);
    s = run(s, [{ op: "enter-workplace", workplace: "closing" }], env);
    s = closingBlock(s, env);
    s = run(s, [{ op: "summary-seen" }, { op: "reflect", optionId: "right", feedback: { enjoyment: "yes", clarity: "clear" } }], env);
    return { s, env };
  }
  it("finishing v6 is the honest end (no sixth visit), the report lists the island changes, the artifact is the revised sentence, the check is called application not retention", () => {
    const { s, env } = finished();
    deepStrictEqual(nextVisitAvailability(s, v4, env.now()), { visit: null, availableAt: null, reason: "all-visits-done" });
    const view = buildChildView(s, v4, env.settings, env.now(), 0, { vocabulary: inv3 });
    ok(isChildView(view, "santiago"));
    equal(view.progress.completedTotal, 5);
    equal(view.nextStep, "Alle Besuche sind geschafft.");
    const report = view.reports.find((r) => r.visit === "v6")!;
    equal(report.partial, false);
    equal(report.label, "Besuch 5 — Der Hafen");
    equal(report.summary.artifact.kind, "log-review");
    ok(report.worldChanges.some((c) => /6 Boote voll beladen, 2 Kisten übrig, 7 Boote für alle/.test(c)));
    ok(report.worldChanges.some((c) => /Hafenplan gespeichert: Ziel Zur Leuchtturm-Insel — die Boote sind mit Seilen festgemacht/.test(c)));
    ok(report.worldChanges.some((c) => /Lieferung erhalten: Seile/.test(c)));
    deepStrictEqual(report.lessons.map((l) => l.lesson.kind), ["math", "language", "typing", "math", "language", "writing"]);
    const review = buildParentReview(s, v4, "v6", null, { historical: false });
    ok(review.learning.objectives.some((o) => o.taskId === "EQ-HARBOR/reasoning" && o.evidence === "independent"));
    ok(review.learning.objectives.some((o) => o.taskId === "EQ-HARBOR-CHECK/full-remaining" && o.evidence === "independent"));
    ok(review.learning.objectives.some((o) => o.taskId === "WRITE-LOG-HARBOR" && o.outcome === "revised" && o.evidence === "supported"));
    ok(review.learning.whatHappened.some((w) => /Kapitänslogbuch .*Original „wir haben 6 bote/.test(w)));
    ok(review.learning.whatHappened.some((w) => /Erklärung: 1 Antwort/.test(w)));
    equal(review.experience.childFeedback.enjoyment, "yes");
  });
  it("the ledger separates dimensions: herramientas recalled independently in a new context, cuerdas recognised and recalled the same day (never 'repeated'), German writing from the typed original (bote → practice, übrig → independent); the wordbook lists met words per language", () => {
    const { s } = finished();
    const ledger = buildVocabularyLedger(s, v4, inv3);
    const e = (id: string) => ledger.entries.find((x) => x.entryId === id)!;
    equal(e("ES-HERRAMIENTAS").dimensions.recall.status, "independent");
    equal(e("ES-HERRAMIENTAS").dimensions.recall.distinctContexts, 1);
    equal(e("ES-CUERDAS").dimensions.recognition.status, "independent");
    equal(e("ES-CUERDAS").dimensions.recall.status, "independent");
    notEqual(e("ES-CUERDAS").dimensions.recall.status, "independent-repeated", "same-visit recall is not repeated independent use");
    equal(e("ES-AGUA").dimensions.recognition.status, "independent-repeated");
    equal(e("DE-BOOT").dimensions.writing.status, "practice");
    equal(e("DE-BOOT").dimensions.writing.incorrect, 1);
    equal(e("DE-UEBRIG").dimensions.writing.status, "independent");
    equal(e("DE-KISTE").dimensions.writing.status, "practice", "kisten written lowercase: review, not credit; here the reviewed misspelling list has no entry so the lowercase form is 'review'");
    equal(e("DE-HAFEN").dimensions.writing.status, "not-observed");
    const wb = childWordbook(ledger, v4, s, inv3);
    deepStrictEqual(wb.languages.map((l) => l.language), ["de", "en", "es"]);
    ok(wb.languages.find((l) => l.language === "de")!.words.some((w) => w.lemma === "Boot"));
    ok(wb.languages.find((l) => l.language === "es")!.words.some((w) => w.lemma === "cuerdas"));
    ok(!wb.languages.find((l) => l.language === "de")!.words.some((w) => w.lemma === "Hafen"), "a word never met is not listed");
    ok(wb.languages.every((l) => l.words.every((w) => !("status" in w))), "no status, count or rank reaches the child");
  });
  it("the ledger of the historical records is unchanged by the new inventory (no retrospective upgrade)", () => {
    const env = makeEnv(v4);
    const s = fourVisitsDone(env);
    const before = buildVocabularyLedger(s, v3, asVocabularyInventory(rawInv2, v3));
    const after = buildVocabularyLedger(s, v4, inv3);
    for (const b of before.entries) {
      const a = after.entries.find((x) => x.entryId === b.entryId)!;
      for (const d of ["recognition", "recall", "writing"] as const) {
        // Counts never change; a status may only move from "no-opportunity" to "not-observed" because v4 ADDS an opportunity (nothing is credited).
        deepStrictEqual({ independentCorrect: a.dimensions[d].independentCorrect, supportedCorrect: a.dimensions[d].supportedCorrect, incorrect: a.dimensions[d].incorrect, observations: a.dimensions[d].observations }, { independentCorrect: b.dimensions[d].independentCorrect, supportedCorrect: b.dimensions[d].supportedCorrect, incorrect: b.dimensions[d].incorrect, observations: b.dimensions[d].observations }, `${b.entryId}/${d}`);
        ok(a.dimensions[d].status === b.dimensions[d].status || (b.dimensions[d].status === "no-opportunity" && a.dimensions[d].status === "not-observed"), `${b.entryId}/${d}: ${b.dimensions[d].status} → ${a.dimensions[d].status}`);
      }
    }
  });
  it("a saved v3-shaped row upgrades additively (harbor, reasoning, logReviews added; nothing reset); a v6 row written by this build keeps its keys under JSON round trip; the reminder before the harbor item uses the remainder focus", () => {
    const env = makeEnv(v4);
    const stripped = JSON.parse(JSON.stringify(fourVisitsDone(env)));
    delete stripped.harbor;
    delete stripped.reasoning;
    delete stripped.logReviews;
    stripped.contentVersion = 3;
    const up = upgradeMissionState(stripped, v4, env.now().toISOString());
    ok(up.changed);
    deepStrictEqual(up.state.harbor, { destination: null, planned: false, plannedAt: null, roped: false, entered: [] });
    deepStrictEqual(up.state.reasoning, {});
    deepStrictEqual(up.state.logReviews, []);
    equal(up.state.contentVersion, 4);
    equal(up.state.upgradedAt, null, "the 2 → 3 → 4 upgrades never move upgradedAt");
    equal(upgradeMissionState(up.state, v4, env.now().toISOString()).changed, false);
    // a wrong remainder earlier opens math:remainder; the harbor (quotient) item shows that reminder
    let s = fourVisitsDone(env);
    s = run(s, [{ op: "start-visit" }, { op: "resume-base" }, { op: "enter-workplace", workplace: "planning" }], env);
    const fb = { ...s.feedback!, focus: [{ id: "math:remainder", kind: "math" as const, key: "remainder", openedAt: "2026-10-09T10:00:00.000Z", openedIn: { visit: "v5" as const, lesson: "math:EQ-PIER" }, evidence: "Letztes Mal …", status: "open" as const, retiredAt: null, retiredBy: null, reopened: 0 }] };
    const reminder = reminderFor({ ...s, feedback: fb }, v4, { stage: "EQ-HARBOR", typingLines: null, mathKind: "remainder", languageWords: null, language: null });
    ok(reminder && /vollen Gruppen/.test(reminder.cue));
  });
  it("the summary of v6 names the independent check first and the revised sentence as the artifact", () => {
    const { s } = finished();
    const summary = buildVisitSummary(s, v4, "v6");
    ok(summary.success && /ohne Hilfe/.test(summary.success.text));
    equal(summary.artifact.kind, "log-review");
  });
});
