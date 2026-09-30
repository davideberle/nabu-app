// Approved learning redesign (2026-09-29) — content version 2, additive
// migration, availability priority, remainder teaching, typing course,
// spacing revision, summary/review builders. Run with: npm test

import { deepStrictEqual, equal, ok, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { asLearningContent, reconcileLearningContent, type LearningContent } from "./family-learning-content.ts";
import {
  applyLearningOp,
  buildChildView,
  currentStage,
  EMPTY_PARENT_SETTINGS,
  ensureItemShown,
  newMissionState,
  nextVisitAvailability,
  practiceAvailability,
  upgradeMissionState,
  type LearningOp,
  type MissionState,
  type OpEnv,
  type ParentSettings,
} from "./family-learning-state.ts";
import { buildParentReview, buildSceneModel, buildVisitSummary, completionIdentity, delayAnchorInfo, delayedCheckInfo, recommendNext, summariseTelemetry } from "./family-learning-summary.ts";
import { assessSpacing, evaluateRevision, flagSpacing } from "./family-learning-writing.ts";
import { applySubmitOutcome, canSend, markSending, payloadKeyOf, submitDraftFor } from "./family-learning-submit-draft.ts";

const rawV1 = JSON.parse(readFileSync(new URL("../data/family-learning/content/santiago-expedition-v1.json", import.meta.url), "utf8"));
const rawV2 = JSON.parse(readFileSync(new URL("../data/family-learning/content/santiago-expedition-v2.json", import.meta.url), "utf8"));
const v1: LearningContent = asLearningContent(rawV1);
const v2: LearningContent = asLearningContent(rawV2);

const T0 = Date.UTC(2026, 8, 28, 10, 0, 0);
function makeEnv(content: LearningContent, settings: Partial<ParentSettings> = {}, start = T0): OpEnv & { tick: (ms: number) => void; set: (ms: number) => void } {
  let t = start;
  let n = 0;
  return { content, settings: { ...EMPTY_PARENT_SETTINGS, ...settings }, now: () => new Date(t), newId: () => `id-${(n += 1)}`, tick: (ms) => (t += ms), set: (ms) => (t = ms) };
}
function run(state: MissionState, ops: LearningOp[], env: OpEnv): MissionState {
  return ops.reduce((s, op) => applyLearningOp(s, op, env).state, state);
}
/** Santiago's live-like fixture: v1 and v2 completed under version-1 content, three independent math successes, no typing lessons, layout unset, shore base, two pages. */
function completedTwoVisitsUnderV1(): { state: MissionState; env: ReturnType<typeof makeEnv> } {
  const env = makeEnv(v1);
  let s = newMissionState(v1, "santiago", env.now().toISOString());
  s = run(s, [{ op: "start-visit" }, { op: "name-base", name: "Sonnenküste" }, { op: "place-base", locationId: "shore" }], env);
  s = ensureItemShown(s, v1, env.now()).state;
  s = run(s, [{ op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }], env);
  s = ensureItemShown(s, v1, env.now()).state;
  s = run(s, [{ op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" }, { op: "explain", text: "Ich habe geteilt.", modality: "typed" }, { op: "skip-stage", stage: "LANG-EN-WATER", reason: "child" }, { op: "typing-label", taskId: "TYPE-LABEL-BASE", typed: "Sonnenküste", seconds: 20 }, { op: "save-log", text: "Ichhabe2Schildkroten gesehen." }, { op: "reflect", optionId: "easy" }], env);
  env.tick(11_000);
  s = run(s, [{ op: "start-visit" }, { op: "resume-base" }], env);
  s = ensureItemShown(s, v1, env.now()).state;
  s = run(s, [{ op: "answer-math", itemId: "EQ-RETURN", answer: 7, raw: "7", modality: "typed" }, { op: "skip-stage", stage: "LANG-ES-AGUA", reason: "child" }, { op: "typing-label", taskId: "TYPE-LABEL-GARDEN", typed: "Garten der Basis", seconds: 30 }, { op: "save-log", text: "Der Garten ist fertig." }, { op: "reflect", optionId: "easy" }], env);
  return { state: s, env };
}

describe("content version 2 — reconciliation by stable ID", () => {
  it("accepts the version-2 inventory with exact counts and keeps every version-1 entry byte-identical", () => {
    const r = reconcileLearningContent(rawV2);
    deepStrictEqual(r.problems, []);
    equal(r.version, 2);
    deepStrictEqual(r.counts, { math: 7, language: 3, typingLessons: 3, typingLabels: 2, typingCourse: 5, visits: 4 });
    for (const item of rawV1.math.items) deepStrictEqual(rawV2.math.items.find((x: { id: string }) => x.id === item.id), item);
    for (const seg of rawV1.language.segments) deepStrictEqual(rawV2.language.segments.find((x: { id: string }) => x.id === seg.id), seg);
    deepStrictEqual(rawV2.typing.lessons, rawV1.typing.lessons);
    deepStrictEqual(rawV2.typing.labelTasks, rawV1.typing.labelTasks);
    deepStrictEqual(rawV2.visits.slice(0, 3), rawV1.visits);
  });
  it("refuses a remainder item whose arithmetic, remainder bound or version-1 placement is wrong", () => {
    const broken = JSON.parse(JSON.stringify(rawV2));
    const station = broken.math.items.find((i: { id: string }) => i.id === "EQ-STATION");
    station.answers.remaining = 3;
    let r = reconcileLearningContent(broken);
    ok(r.problems.some((p) => p.includes("32 − 30 is not 3")));
    station.answers = { used: 30, remaining: 2 };
    station.perGroup = 2;
    r = reconcileLearningContent(broken);
    ok(r.problems.some((p) => p.includes("5 × 2 is not 30")));
    const v1broken = JSON.parse(JSON.stringify(rawV1));
    v1broken.math.items[0].kind = "remainder";
    ok(reconcileLearningContent(v1broken).problems.some((p) => p.includes("remainder items exist only from content version 2")));
  });
  it("refuses a course line using an unintroduced key, a wrong practiced list, a thumb-less space and an undistinguishable alignment check", () => {
    const broken = JSON.parse(JSON.stringify(rawV2));
    broken.typing.course.lessons[1].lines[0] = "ddd kkk sss";
    ok(reconcileLearningContent(broken).problems.some((p) => p.includes("uses s before it was introduced")));
    const broken2 = JSON.parse(JSON.stringify(rawV2));
    broken2.typing.course.lessons[2].practiced = ["f"];
    ok(reconcileLearningContent(broken2).problems.some((p) => p.includes("practiced keys must equal")));
    const broken3 = JSON.parse(JSON.stringify(rawV2));
    delete broken3.typing.course.fingers[" "];
    ok(reconcileLearningContent(broken3).problems.some((p) => p.includes("space bar must be assigned to the thumb")));
    const broken4 = JSON.parse(JSON.stringify(rawV2));
    for (const k of broken4.typing.course.alignmentCheck.keys) k.expected["de-qwertz"] = k.expected["ch-de-qwertz"];
    ok(reconcileLearningContent(broken4).problems.some((p) => p.includes("cannot distinguish ch-de-qwertz from de-qwertz")));
  });
});

describe("additive migration of a saved version-1 mission", () => {
  it("adds the new records with defaults, keeps every historical id/timestamp/answer, and is idempotent", () => {
    const { state } = completedTwoVisitsUnderV1();
    const before = JSON.stringify(state);
    const once = upgradeMissionState(state, v2, "2026-09-29T16:00:00.000Z");
    ok(once.changed);
    equal(once.state.contentVersion, 2);
    equal(once.state.upgradedAt, "2026-09-29T16:00:00.000Z");
    ok(once.state.math["EQ-STATION"]);
    ok(once.state.language["LANG-ES-STATION"]);
    deepStrictEqual(once.state.station, { theme: null, chosenAt: null, spot: null, built: false, builtAt: null, lampLit: false });
    equal(once.state.typing.course, null);
    equal(once.state.typing.alignment, null);
    deepStrictEqual(once.state.logRevisions, []);
    // The delayed-check anchor (teaching or v1-completion fallback) is exactly the one recorded under version 1.
    equal(once.state.teachingFirstAt, state.teachingFirstAt);
    deepStrictEqual(delayAnchorInfo(once.state), delayAnchorInfo(state));
    deepStrictEqual(delayedCheckInfo(once.state, v2, new Date("2026-09-29T16:00:00.000Z"))?.anchor, delayAnchorInfo(state));
    // Historical content untouched.
    deepStrictEqual(once.state.math["EQ-ENTRY"], state.math["EQ-ENTRY"]);
    deepStrictEqual(once.state.visits, state.visits);
    deepStrictEqual(once.state.pages, state.pages);
    deepStrictEqual(once.state.typing.labels, state.typing.labels);
    equal(JSON.stringify(state), before, "input not mutated");
    const twice = upgradeMissionState(once.state, v2, "2026-09-29T17:00:00.000Z");
    equal(twice.changed, false);
    deepStrictEqual(twice.state, once.state);
    // Upgrading an empty version-1 mission keeps its in-flight stage index meaning (stage lists are unchanged).
    const env = makeEnv(v1);
    let s = newMissionState(v1, "santiago", env.now().toISOString());
    s = run(s, [{ op: "start-visit" }, { op: "name-base", name: "X" }], env);
    const up = upgradeMissionState(s, v2, env.now().toISOString()).state;
    equal(currentStage(up, v2), "place-base");
    equal(currentStage(s, v1), "place-base");
  });
  it("retained visits keep identical stage lists and an in-flight visit 2/3 keeps its current stage across the upgrade (M4)", () => {
    for (const id of ["v1", "v2", "v3"] as const) deepStrictEqual(v2.visits.find((v) => v.id === id)?.stages, v1.visits.find((v) => v.id === id)?.stages, id);
    // Every retained stage index of every retained visit resolves to the same stage id under both versions,
    // and a reordered retained visit is rejected by reconciliation (the lists are frozen in code).
    for (const id of ["v1", "v2", "v3"] as const) {
      const stages = v1.visits.find((v) => v.id === id)!.stages;
      for (let index = 0; index < stages.length; index += 1) {
        const inFlight = newMissionState(v1, "santiago", "2026-09-28T10:00:00.000Z");
        inFlight.currentVisit = id;
        inFlight.visits.push({ id, startedAt: "2026-09-28T10:00:00.000Z", finishedAt: null, stageIndex: index, skippedStages: [], reflection: null });
        const upgraded = upgradeMissionState(JSON.parse(JSON.stringify(inFlight)), v2, "2026-09-29T10:00:00.000Z").state;
        equal(currentStage(upgraded, v2), currentStage(inFlight, v1), `${id}[${index}]`);
        equal(currentStage(upgraded, v2), stages[index]);
      }
    }
    const reordered = JSON.parse(JSON.stringify(rawV2));
    reordered.visits.find((v: { id: string }) => v.id === "v2").stages = ["restore", "LANG-ES-AGUA", "EQ-RETURN", "typing", "log", "reflect"];
    ok(reconcileLearningContent(reordered).problems.some((p) => /visit v2: retained stage list is frozen/.test(p)));
    const inserted = JSON.parse(JSON.stringify(rawV2));
    inserted.visits.find((v: { id: string }) => v.id === "v1").stages.splice(2, 0, "station-choice");
    ok(reconcileLearningContent(inserted).problems.some((p) => /visit v1: retained stage list is frozen/.test(p)));
    const { state, env } = completedTwoVisitsUnderV1();
    // A running visit 2 under version 1, stopped after EQ-RETURN (at the Spanish segment).
    const envV1 = makeEnv(v1);
    let s = newMissionState(v1, "santiago", envV1.now().toISOString());
    s = run(s, [{ op: "start-visit" }, { op: "name-base", name: "Sonnenküste" }, { op: "place-base", locationId: "shore" }, { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }, { op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" }, { op: "skip-stage", stage: "explain", reason: "child" }, { op: "skip-stage", stage: "LANG-EN-WATER", reason: "child" }, { op: "skip-stage", stage: "typing", reason: "child" }, { op: "save-log", text: "Tag eins." }, { op: "reflect", optionId: "easy" }], envV1);
    s = run(s, [{ op: "start-visit" }, { op: "resume-base" }, { op: "answer-math", itemId: "EQ-RETURN", answer: 7, raw: "7", modality: "typed" }], envV1);
    equal(currentStage(s, v1), "LANG-ES-AGUA");
    const up = upgradeMissionState(JSON.parse(JSON.stringify(s)), v2, envV1.now().toISOString()).state;
    equal(currentStage(up, v2), "LANG-ES-AGUA");
    equal(up.currentVisit, "v2");
    deepStrictEqual(up.math["EQ-RETURN"], s.math["EQ-RETURN"]);
    // It can be finished under version 2 with the same remaining stages and then reach chapter 4.
    const envV2 = makeEnv(v2);
    const done = run(up, [{ op: "skip-stage", stage: "LANG-ES-AGUA", reason: "child" }, { op: "skip-stage", stage: "typing", reason: "child" }, { op: "save-log", text: "Tag zwei." }, { op: "reflect", optionId: "easy" }], envV2);
    equal(done.currentVisit, null);
    equal(nextVisitAvailability(done, v2, envV2.now()).visit, "v4");
    void state;
    void env;
  });
  it("historical typing records keep their version-1 meaning (no metric version), new label records carry version 2", () => {
    const { state } = completedTwoVisitsUnderV1();
    equal(state.typing.labels[0].metricVersion, 2);
    const legacy = JSON.parse(JSON.stringify(state)) as MissionState;
    delete legacy.typing.labels[0].metricVersion;
    const up = upgradeMissionState(legacy, v2, "2026-09-29T16:00:00.000Z").state;
    equal(up.typing.labels[0].metricVersion, undefined, "no retrospective alignment is fabricated");
  });
});

describe("availability after two completed visits (F4/C3, M2/M3)", () => {
  it("offers the new chapter now, before the six days; never forces v1/v2 again; the delayed check keeps its clock", () => {
    const { state, env } = completedTwoVisitsUnderV1();
    const s = upgradeMissionState(state, v2, env.now().toISOString()).state;
    const now = env.now();
    deepStrictEqual(nextVisitAvailability(s, v2, now), { visit: "v4", availableAt: null });
    const info = delayedCheckInfo(s, v2, now)!;
    equal(info.status, "waiting");
    equal(info.anchor?.kind, "visit1-completion");
    ok(info.childText.includes("kommt am"));
    ok(info.parentText.includes("kein Beweis von Können"));
    // Under version-1 content the same state still waits (v4 does not exist there).
    equal(nextVisitAvailability(state, v1, now).visit, null);
  });
  it("after the due date the delayed check comes first, then v4; after v4 the delayed check still waits with its date; both done → all done", () => {
    const { state, env } = completedTwoVisitsUnderV1();
    let s = upgradeMissionState(state, v2, env.now().toISOString()).state;
    const anchor = new Date(s.visits[0].finishedAt!).getTime();
    env.set(anchor + 6 * 24 * 3600 * 1000 + 1000);
    equal(nextVisitAvailability(s, v2, env.now()).visit, "v3");
    equal(delayedCheckInfo(s, v2, env.now())!.status, "open");
    // Complete v3 (delayed check) — then v4 opens.
    const envV2 = makeEnv(v2, {}, env.now().getTime());
    s = run(s, [{ op: "start-visit" }, { op: "resume-base" }], envV2);
    s = ensureItemShown(s, v2, envV2.now()).state;
    s = run(s, [{ op: "answer-math", itemId: "EQ-DELAY", answer: 8, raw: "8", modality: "typed" }, { op: "save-log", text: "Proben verpackt." }, { op: "reflect", optionId: "right" }], envV2);
    equal(nextVisitAvailability(s, v2, envV2.now()).visit, "v4");
    // Alternative order: v4 first before due, then waiting for v3.
    const { state: s0, env: e0 } = completedTwoVisitsUnderV1();
    const early = makeEnv(v2, { keyboardLayout: "ch-de-qwertz" }, e0.now().getTime());
    let t = upgradeMissionState(s0, v2, early.now().toISOString()).state;
    t = completeVisit4(t, early);
    const after = nextVisitAvailability(t, v2, early.now());
    equal(after.visit, null);
    equal((after as { reason: string }).reason, "delayed-check-waits");
    ok(after.availableAt);
  });
});

/** Walk visit 4 to completion with the typing course available (layout confirmed + alignment match). */
function completeVisit4(input: MissionState, env: OpEnv): MissionState {
  let s = run(input, [{ op: "start-visit" }, { op: "resume-base" }, { op: "choose-station", theme: "turtles" }], env);
  equal(currentStage(s, v2), "typing-course");
  s = run(s, [{ op: "typing-check", observed: ["'", "ö", "z"] }], env);
  s = run(s, [{ op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["fff jjj", "fj fj jf"], seconds: 20, comfort: "ok" }, { op: "typing-course-continue" }], env);
  s = ensureItemShown(s, v2, env.now()).state;
  s = run(s, [{ op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30 und 2", modality: "typed" }, { op: "explain", text: "5 mal 6 sind 30, 2 bleiben.", modality: "typed" }], env);
  s = run(s, [
    { op: "language-step", segmentId: "LANG-ES-STATION", stepId: "listen", response: "", modality: "listen" },
    { op: "language-step", segmentId: "LANG-ES-STATION", stepId: "pick", response: "lámpara", modality: "word-choice" },
    { op: "language-step", segmentId: "LANG-ES-STATION", stepId: "produce", response: "Necesitamos una lámpara.", modality: "typed" },
    { op: "language-step", segmentId: "LANG-ES-STATION", stepId: "reuse", response: "agua", modality: "word-choice" },
  ], env);
  s = run(s, [{ op: "build-station", spot: "beach" }, { op: "save-log", text: "Ichhabe2Schildkroten gesehen." }, { op: "revise-log", text: "Ich habe 2 Schildkroten gesehen." }, { op: "write-transfer", text: "Morgen zählt die Station 3 Wellen.", modality: "typed" }, { op: "summary-seen" }, { op: "reflect", optionId: "right" }], env);
  return s;
}

describe("visit 4 — the next chapter", () => {
  it("runs restore → choice → typing course → remainder → explain → Spanish request → build → log → revision → summary → reflect with honest records", () => {
    const { state, env: e0 } = completedTwoVisitsUnderV1();
    const env = makeEnv(v2, { keyboardLayout: "ch-de-qwertz" }, e0.now().getTime());
    const s = completeVisit4(upgradeMissionState(state, v2, env.now().toISOString()).state, env);
    const v4 = s.visits.find((v) => v.id === "v4")!;
    ok(v4.finishedAt);
    equal(s.station!.theme, "turtles");
    equal(s.station!.built, true);
    equal(s.station!.lampLit, true, "the Spanish pick supplied the lamp");
    equal(s.base.supplies["lámpara"], 1);
    equal(s.base.supplies["Setzlinge"], 28 + 30, "the remainder item adds only the planted seedlings");
    const item = s.math["EQ-STATION"]!;
    equal(item.outcome, "correct");
    deepStrictEqual(item.remainderResult, { used: 30, remaining: 2 });
    equal(item.attempts[0].evidence, "independent");
    equal(s.explanations.at(-1)!.taskId, "EQ-STATION");
    const prod = s.language["LANG-ES-STATION"]!.records.find((r) => r.stepId === "produce")!;
    equal(prod.evidence, "production");
    equal(prod.correct, true);
    equal(s.logRevisions[0].outcome, "revised");
    equal(s.logRevisions[0].original, "Ichhabe2Schildkroten gesehen.");
    equal(s.logRevisions[0].revised, "Ich habe 2 Schildkroten gesehen.");
    equal(s.typing.course!.bursts.length, 1);
    const scene = buildSceneModel(s, v2);
    equal(scene.station.built, true);
    equal(scene.station.lamp, true);
    equal(scene.beds.filter((b) => b.id.startsWith("station")).length, 5);
    equal(scene.leftovers, 2);
    equal(scene.base, "hut-garden");
  });
  it("declining the turtle theme leads to the alternative, and a wrong theme is refused", () => {
    const { state, env: e0 } = completedTwoVisitsUnderV1();
    const env = makeEnv(v2, {}, e0.now().getTime());
    let s = upgradeMissionState(state, v2, env.now().toISOString()).state;
    s = run(s, [{ op: "start-visit" }, { op: "resume-base" }], env);
    throws(() => applyLearningOp(s, { op: "choose-station", theme: "dragons" }, env), /unknown station theme/);
    s = run(s, [{ op: "choose-station", theme: "waves" }], env);
    equal(s.station!.theme, "waves");
    equal(currentStage(s, v2), "typing-course");
  });
  it("remainder teaching loop: wrong twice → clarification, then the remainder example, then teach-or-stop; taught result is exposed, never independent", () => {
    const { state, env: e0 } = completedTwoVisitsUnderV1();
    const env = makeEnv(v2, {}, e0.now().getTime());
    let s = upgradeMissionState(state, v2, env.now().toISOString()).state;
    s = run(s, [{ op: "start-visit" }, { op: "resume-base" }, { op: "choose-station", theme: "none" }, { op: "typing-course-continue" }], env);
    equal(currentStage(s, v2), "EQ-STATION");
    s = ensureItemShown(s, v2, env.now()).state;
    throws(() => applyLearningOp(s, { op: "answer-math", itemId: "EQ-STATION", answer: 6, raw: "6", modality: "typed" }, env), /asks for two numbers/);
    // 6.4 per bed is not an answer shape; used right, remaining wrong → clarification names the half.
    let r = applyLearningOp(s, { op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 0, raw: "30, 0", modality: "typed" }, env);
    equal(r.result.feedback, "clarify");
    equal(r.result.usedCorrect, true);
    equal(r.result.remainingCorrect, false);
    let view = buildChildView(r.state, v2, env.settings, env.now());
    deepStrictEqual(view.math!.lastPartial, { usedCorrect: true, remainingCorrect: false });
    r = applyLearningOp(r.state, { op: "answer-remainder", itemId: "EQ-STATION", used: 32, remaining: 0, raw: "32, 0", modality: "typed" }, env);
    equal(r.result.feedback, "example");
    view = buildChildView(r.state, v2, env.settings, env.now());
    ok(view.math!.example && view.math!.example.prompt.includes("14 Setzlinge"));
    equal(r.records.exposures.some((e) => e.taskId === "EQ-STATION-MODEL" && e.kind === "example_shown"), true);
    r = applyLearningOp(r.state, { op: "continue-item", itemId: "EQ-STATION" }, env);
    r = applyLearningOp(r.state, { op: "answer-remainder", itemId: "EQ-STATION", used: 31, remaining: 1, raw: "31, 1", modality: "typed" }, env);
    equal(r.result.feedback, "teach-or-stop");
    r = applyLearningOp(r.state, { op: "request-teaching", itemId: "EQ-STATION" }, env);
    equal(r.state.math["EQ-STATION"]!.outcome, "taught");
    deepStrictEqual(r.state.math["EQ-STATION"]!.remainderResult, { used: 30, remaining: 2 });
    equal(r.state.math["EQ-STATION"]!.exposure, "answer_revealed");
    // A correct answer after support is supported, never independent.
    const { state: s2, env: e2 } = completedTwoVisitsUnderV1();
    const env2 = makeEnv(v2, {}, e2.now().getTime());
    let t = upgradeMissionState(s2, v2, env2.now().toISOString()).state;
    t = run(t, [{ op: "start-visit" }, { op: "resume-base" }, { op: "choose-station", theme: "none" }, { op: "typing-course-continue" }], env2);
    t = ensureItemShown(t, v2, env2.now()).state;
    t = run(t, [{ op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 0, raw: "30, 0", modality: "typed" }, { op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" }], env2);
    equal(t.math["EQ-STATION"]!.attempts[1].evidence, "supported");
    // A tutor reply that names 30 or 2 exposes the item.
    const { state: s3, env: e3 } = completedTwoVisitsUnderV1();
    const env3 = makeEnv(v2, {}, e3.now().getTime());
    let u = upgradeMissionState(s3, v2, env3.now().toISOString()).state;
    u = run(u, [{ op: "start-visit" }, { op: "resume-base" }, { op: "choose-station", theme: "none" }, { op: "typing-course-continue" }], env3);
    u = ensureItemShown(u, v2, env3.now()).state;
    u = run(u, [{ op: "support", taskId: "EQ-STATION", kind: "tutor_reply", payload: { text: "Es bleiben 2 übrig." } }], env3);
    equal(u.math["EQ-STATION"]!.exposure, "answer_revealed");
  });
  it("Spanish request: lexical completion is not phrase production; the other construction stays a different claim; plausible longer wording is unscored; a distractor is wrong", () => {
    const { state, env: e0 } = completedTwoVisitsUnderV1();
    const env = makeEnv(v2, {}, e0.now().getTime());
    let s = upgradeMissionState(state, v2, env.now().toISOString()).state;
    s = run(s, [{ op: "start-visit" }, { op: "resume-base" }, { op: "choose-station", theme: "none" }, { op: "typing-course-continue" }], env);
    s = ensureItemShown(s, v2, env.now()).state;
    s = run(s, [{ op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" }, { op: "skip-stage", stage: "explain", reason: "child" }], env);
    s = run(s, [{ op: "language-step", segmentId: "LANG-ES-STATION", stepId: "listen", response: "", modality: "listen" }, { op: "language-step", segmentId: "LANG-ES-STATION", stepId: "pick", response: "lámpara", modality: "word-choice" }], env);
    const produce = (text: string) => applyLearningOp(s, { op: "language-step", segmentId: "LANG-ES-STATION", stepId: "produce", response: text, modality: "typed" }, env);
    equal(produce("lámpara").result.evidence, "completion");
    equal(produce("Necesitamos una lampara").result.evidence, "production");
    equal(produce("Necesitamos una lampara").result.correct, true);
    equal(produce("Necesitamos una lámpara para la noche.").result.correct, null, "valid unfamiliar wording stays unscored, never wrong");
    equal(produce("Necesitamos agua.").result.correct, false, "the water phrase is a different request here");
    equal(produce("La estación necesita una lámpara.").result.correct, null, "another construction is neither accepted nor called wrong");
  });
});

describe("typing course — setup check, progression and honest metrics", () => {
  function atCourse(settings: Partial<ParentSettings>) {
    const { state, env: e0 } = completedTwoVisitsUnderV1();
    const env = makeEnv(v2, settings, e0.now().getTime());
    let s = upgradeMissionState(state, v2, env.now().toISOString()).state;
    s = run(s, [{ op: "start-visit" }, { op: "resume-base" }, { op: "choose-station", theme: "turtles" }], env);
    return { s, env };
  }
  it("setup cannot fall through: unconfirmed layout, unchecked or mismatched input source all keep practice unavailable with an explicit reason", () => {
    const unset = atCourse({});
    deepStrictEqual(practiceAvailability(unset.s, v2, unset.env.settings), { available: false, reason: "layout-unconfirmed" });
    throws(() => applyLearningOp(unset.s, { op: "typing-check", observed: ["'", "ö", "z"] }, unset.env), /has not confirmed/);
    throws(() => applyLearningOp(unset.s, { op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["fff jjj", "fj fj jf"], seconds: 10, comfort: "ok" }, unset.env), /layout-unconfirmed/);
    const ch = atCourse({ keyboardLayout: "ch-de-qwertz" });
    deepStrictEqual(practiceAvailability(ch.s, v2, ch.env.settings), { available: false, reason: "alignment-unchecked" });
    let view = buildChildView(ch.s, v2, ch.env.settings, ch.env.now());
    equal(view.typingCourse!.unavailable, "alignment-unchecked");
    equal(view.typingCourse!.alignment.keys.length, 3);
    // The computer writes German (DE) characters although the parent confirmed Swiss: mismatch, practice stays locked, parent-readable.
    let r = applyLearningOp(ch.s, { op: "typing-check", observed: ["ß", "ö", "z"] }, ch.env);
    equal(r.result.result, "mismatch");
    equal(r.result.matchesLayout, "de-qwertz");
    deepStrictEqual(practiceAvailability(r.state, v2, ch.env.settings), { available: false, reason: "alignment-mismatch" });
    throws(() => applyLearningOp(r.state, { op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["fff jjj", "fj fj jf"], seconds: 10, comfort: "ok" }, ch.env), /alignment-mismatch/);
    // Re-check after fixing the input source: match, course starts at lesson 1.
    r = applyLearningOp(r.state, { op: "typing-check", observed: ["'", "ö", "z"] }, ch.env);
    equal(r.result.result, "match");
    equal(r.state.typing.course!.decision!.action, "start");
    view = buildChildView(r.state, v2, ch.env.settings, ch.env.now());
    equal(view.typingCourse!.unavailable, null);
    equal(view.typingCourse!.lesson!.id, "TYPE-CH-COURSE-1");
    deepStrictEqual(view.typingCourse!.lesson!.keys, ["f", "j", " "]);
    equal(view.typingCourse!.fingers[" "], "Daumen");
    // DE/US layouts have no course: never a Swiss fallback.
    const de = atCourse({ keyboardLayout: "de-qwertz" });
    const rd = applyLearningOp(de.s, { op: "typing-check", observed: ["ß", "ö", "z"] }, de.env);
    equal(rd.result.result, "match");
    deepStrictEqual(practiceAvailability(rd.state, v2, de.env.settings), { available: false, reason: "no-course-for-layout" });
    // Changing the confirmed layout invalidates the check; progression never transfers.
    const changed = { ...ch.env, settings: { ...ch.env.settings, keyboardLayout: "de-qwertz" as const } };
    deepStrictEqual(practiceAvailability(r.state, v2, changed.settings), { available: false, reason: "alignment-unchecked" });
  });
  it("progression needs two good bursts; a hard or inaccurate burst repeats or shrinks, never promotes; reload keeps the decision", () => {
    const { s, env } = atCourse({ keyboardLayout: "ch-de-qwertz" });
    let r = applyLearningOp(s, { op: "typing-check", observed: ["'", "ö", "z"] }, env);
    const burst = (state: MissionState, lines: string[], comfort: "easy" | "ok" | "hard") => applyLearningOp(state, { op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines, seconds: 15, comfort }, env);
    r = burst(r.state, ["fff jjj", "fj fj jf"], "ok");
    equal(r.result.decision, "repeat");
    equal(r.state.typing.course!.lessonIndex, 0);
    r = burst(r.state, ["fff jjj", "fj fj jf"], "hard");
    equal(r.result.decision, "repeat", "an uncomfortable burst does not count towards promotion");
    r = burst(r.state, ["fff jjj", "fj fj jf"], "ok");
    equal(r.result.decision, "advance");
    equal(r.state.typing.course!.lessonIndex, 1);
    deepStrictEqual(r.state.typing.course!.completed, ["TYPE-CH-COURSE-1"]);
    equal(r.result.nextLessonId, "TYPE-CH-COURSE-2");
    // Reload = same state object; the decision persists in state, not in the client.
    const reloaded = JSON.parse(JSON.stringify(r.state)) as MissionState;
    equal(buildChildView(reloaded, v2, env.settings, env.now()).typingCourse!.lesson!.id, "TYPE-CH-COURSE-2");
    // Two bad bursts in a row → smaller.
    // Accuracy is judged over the whole burst (both lines): 12/14 and 14/17 are below 90 %.
    let q = applyLearningOp(r.state, { op: "typing-burst", lessonId: "TYPE-CH-COURSE-2", lines: ["dxd kxk", "fdk jkd"], seconds: 15, comfort: "ok" }, env);
    equal(q.result.decision, "repeat");
    q = applyLearningOp(q.state, { op: "typing-burst", lessonId: "TYPE-CH-COURSE-2", lines: ["ddd kkk", "fdk jkdxxx"], seconds: 15, comfort: "hard" }, env);
    equal(q.result.decision, "smaller");
    equal(q.state.typing.course!.lessonIndex, 1);
    // A stale lesson id is refused.
    throws(() => applyLearningOp(q.state, { op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["fff jjj", "fj fj jf"], seconds: 15, comfort: "ok" }, env), /current lesson is TYPE-CH-COURSE-2/);
  });
  it("burst metrics are alignment-aware per line and stored with metric version 2", () => {
    const { s, env } = atCourse({ keyboardLayout: "ch-de-qwertz" });
    let r = applyLearningOp(s, { op: "typing-check", observed: ["'", "ö", "z"] }, env);
    r = applyLearningOp(r.state, { op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["fffx jjj", "fj fjjf"], seconds: 15, comfort: "ok" }, env);
    const b = r.state.typing.course!.bursts[0];
    equal(b.metricVersion, 2);
    equal(b.correctChars, 14, "one insertion and one omission cost exactly one each");
    equal(b.extraChars, 1);
    equal(b.omittedChars, 1);
    equal(b.denominator, 8 + 8);
    equal(r.records.samples[0].kind, "typing_burst");
    // Moving on without any burst is a recorded skip, not practice.
    const skip = applyLearningOp(applyLearningOp(s, { op: "typing-check", observed: ["'", "ö", "z"] }, env).state, { op: "typing-course-continue" }, env);
    equal(skip.result.practiced, false);
    deepStrictEqual(skip.state.visits.at(-1)!.skippedStages, [{ stage: "typing-course", reason: "child" }]);
  });
});

describe("log revision — actionable spacing feedback (F2)", () => {
  function atRevise(text: string) {
    const { state, env: e0 } = completedTwoVisitsUnderV1();
    const env = makeEnv(v2, {}, e0.now().getTime());
    let s = upgradeMissionState(state, v2, env.now().toISOString()).state;
    s = run(s, [{ op: "start-visit" }, { op: "resume-base" }, { op: "choose-station", theme: "none" }, { op: "typing-course-continue" }], env);
    s = ensureItemShown(s, v2, env.now()).state;
    s = run(s, [{ op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" }, { op: "skip-stage", stage: "explain", reason: "child" }, { op: "skip-stage", stage: "LANG-ES-STATION", reason: "child" }, { op: "build-station", spot: "rocks" }, { op: "save-log", text }], env);
    return { s, env };
  }
  it("the child sees the flagged places and a suggestion; the original is kept; unchanged text earns no praise; partial and full are counted", () => {
    const { s, env } = atRevise("Ichhabe2Schildkroten gesehen.");
    const view = buildChildView(s, v2, env.settings, env.now());
    equal(view.logRevise!.marked, "Ich|habe|2|Schildkroten gesehen.");
    equal(view.logRevise!.suggested, "Ich habe 2 Schildkroten gesehen.");
    equal(view.logRevise!.flags, 3);
    const unchanged = applyLearningOp(s, { op: "revise-log", text: "Ichhabe2Schildkroten gesehen." }, env);
    equal(unchanged.result.outcome, "unchanged");
    equal(unchanged.state.logRevisions[0].original, "Ichhabe2Schildkroten gesehen.");
    const partial = applyLearningOp(s, { op: "revise-log", text: "Ichhabe 2 Schildkroten gesehen." }, env);
    equal(partial.result.outcome, "partial");
    equal(partial.result.resolved, 2);
    const full = applyLearningOp(s, { op: "revise-log", text: "Ich habe 2 Schildkroten gesehen." }, env);
    equal(full.result.outcome, "revised");
    equal(full.records.samples[0].kind, "expedition_log_revision");
    deepStrictEqual((full.records.samples[0].metrics as { spellingJudged: boolean }).spellingJudged, false);
    // The station lamp stays unlit when no lamp was supplied (Spanish skipped).
    equal(full.state.station!.lampLit, false);
  });
  it("a correct sentence has nothing to fix, and skipping keeps the original with a recorded skip", () => {
    const { s, env } = atRevise("Wir haben 2 Schildkröten gesehen.");
    const view = buildChildView(s, v2, env.settings, env.now());
    equal(view.logRevise!.flags, 0);
    const r = applyLearningOp(s, { op: "revise-log", text: "Wir haben 2 Schildkröten gesehen." }, env);
    equal(r.result.outcome, "no-flags");
    const sk = applyLearningOp(s, { op: "skip-stage", stage: "log-revise", reason: "child" }, env);
    equal(sk.state.logRevisions[0].outcome, "skipped");
    equal(currentStage(sk.state, v2), "log-transfer", "the fresh transfer check follows the revision (round 2)");
  });
});

describe("summary and parent review — evidence-bound, branch-sensitive, one per completion", () => {
  it("historical visits: success cites the actual independent attempt, practice cites the spacing, recommendation responds to success + easy", () => {
    const { state, env } = completedTwoVisitsUnderV1();
    const s = upgradeMissionState(state, v2, env.now().toISOString()).state;
    const v1s = buildVisitSummary(s, v2, "v1");
    ok(v1s.success!.text.includes("24 Essenspakete gerecht auf 4 Forscher"));
    ok(v1s.success!.basis.startsWith("attempt EQ-ENTRY#1 independent"));
    equal(v1s.next.branch, "success-easy");
    equal(v1s.artifact.kind, "page");
    const review = buildParentReview(s, v2, "v1", null, { historical: true, contentVersion: 1 });
    equal(review.historical, true);
    equal(review.identity.contentVersion, 1);
    equal(review.experience.telemetry.supported, false);
    ok(review.experience.missing.some((m) => m.includes("Keine Telemetrie")));
    ok(review.learning.teachNext.uncertainty.includes("Historischer Besuch"));
    ok(review.learning.objectives.every((o) => o.taskId !== "EQ-STATION"));
    equal(completionIdentity(s, s.visits[0]), `santiago/santiago-expedition/v1/${s.visits[0].startedAt}`);
  });
  it("branches: supported success, struggling, missing data — and never praise for persistence or attention", () => {
    const { state, env: e0 } = completedTwoVisitsUnderV1();
    const env = makeEnv(v2, {}, e0.now().getTime());
    let s = upgradeMissionState(state, v2, env.now().toISOString()).state;
    s = run(s, [{ op: "start-visit" }, { op: "resume-base" }, { op: "choose-station", theme: "none" }, { op: "typing-course-continue" }], env);
    s = ensureItemShown(s, v2, env.now()).state;
    // supported: wrong once, then right
    const supported = run(s, [{ op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 0, raw: "30, 0", modality: "typed" }, { op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" }], env);
    equal(recommendNext(supported, v2, "v4").branch, "supported");
    // struggling: taught
    const struggling = run(s, [
      { op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 0, raw: "30, 0", modality: "typed" },
      { op: "answer-remainder", itemId: "EQ-STATION", used: 32, remaining: 0, raw: "32, 0", modality: "typed" },
      { op: "continue-item", itemId: "EQ-STATION" },
      { op: "answer-remainder", itemId: "EQ-STATION", used: 31, remaining: 1, raw: "31, 1", modality: "typed" },
      { op: "request-teaching", itemId: "EQ-STATION" },
    ], env);
    equal(recommendNext(struggling, v2, "v4").branch, "struggling");
    const sum = buildVisitSummary(struggling, v2, "v4");
    ok(sum.success!.text.includes("zusammen gelöst"));
    ok(!/Ausdauer|Konzentration|Aufmerksamkeit|Finger/.test(JSON.stringify(sum)));
    // missing data: nothing recorded in the visit
    equal(recommendNext(s, v2, "v4").branch, "missing-data");
    // telemetry summary: active intervals are summed under the idle rule, never called attention
    const tele = summariseTelemetry([{ t: 1, kind: "stage-enter", stage: "EQ-STATION" }, { t: 2, kind: "active-interval", stage: "EQ-STATION", detail: { seconds: 40 } }, { t: 3, kind: "hidden" }, { t: 4, kind: "save-failure" }]);
    equal(tele.foregroundActiveSeconds, 40);
    equal(tele.hiddenIntervals, 1);
    equal(tele.saveFailures, 1);
    equal(tele.idleRuleSeconds, 60);
  });
});

// ---------------------------------------------------------------------------
// Independent repair (2026-09-30): C1–C3 and the release rollback gate.
// ---------------------------------------------------------------------------

function atV4(ops: LearningOp[] = [], pages?: { text: string }[]) {
  const { state, env: e0 } = completedTwoVisitsUnderV1();
  const env = makeEnv(v2, { keyboardLayout: "ch-de-qwertz" }, e0.now().getTime());
  let s = upgradeMissionState(state, v2, env.now().toISOString()).state;
  if (pages) s.pages = pages.map((p, i) => ({ ...s.pages[0], text: p.text, at: `2026-09-28T1${i}:00:00.000Z` }));
  s = run(s, [{ op: "start-visit" }, { op: "resume-base" }, ...ops], env);
  return { s, env };
}

describe("C1 — spacing feedback counts every original occurrence and never claims global correctness", () => {
  it("the independent probe: correcting only the first of two identical sentences is partial (3/6), both is revised (6/6)", () => {
    const original = "Ichhabe2Schildkroten. Ichhabe2Schildkroten.";
    const flags = flagSpacing(original, v2.writing!.spacing.joins);
    equal(flags.length, 6);
    deepStrictEqual(evaluateRevision(original, "Ich habe 2 Schildkroten. Ichhabe2Schildkroten.", flags).resolved, 3);
    equal(evaluateRevision(original, "Ich habe 2 Schildkroten. Ichhabe2Schildkroten.", flags).outcome, "partial");
    deepStrictEqual(evaluateRevision(original, "Ichhabe2Schildkroten. Ich habe 2 Schildkroten.", flags).resolved, 3, "fixing only the second occurrence is partial too");
    equal(evaluateRevision(original, "Ich habe 2 Schildkroten. Ich habe 2 Schildkroten.", flags).outcome, "revised");
    equal(evaluateRevision(original, original, flags).outcome, "unchanged");
  });
  it("unreviewed missing spaces yield no flags, and the state records 'no-flags' — not a correctness claim; the view never marks anything", () => {
    equal(flagSpacing("DieSchildkröteschwimmtimMeer", v2.writing!.spacing.joins).length, 0);
    const { s, env } = atV4([{ op: "choose-station", theme: "none" }, { op: "typing-course-continue" }]);
    let t = ensureItemShown(s, v2, env.now()).state;
    t = run(t, [{ op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" }, { op: "skip-stage", stage: "explain", reason: "child" }, { op: "skip-stage", stage: "LANG-ES-STATION", reason: "child" }, { op: "build-station", spot: "rocks" }, { op: "save-log", text: "DieSchildkröteschwimmtimMeer" }], env);
    const view = buildChildView(t, v2, env.settings, env.now());
    equal(view.logRevise!.flags, 0);
    equal(view.logRevise!.marked, "DieSchildkröteschwimmtimMeer");
    const r = applyLearningOp(t, { op: "revise-log", text: "DieSchildkröteschwimmtimMeer" }, env);
    equal(r.state.logRevisions[0].outcome, "no-flags");
    equal(r.state.logRevisions[0].helpShown, false);
  });
});

describe("C2 — the station prompt refers only to what the child actually saved", () => {
  it("unrelated log → neutral wording; empty log → neutral; a turtle log → a narrow reference; decline/waves/none all work", () => {
    const unrelated = atV4([], [{ text: "Wir sahen Wellen." }]);
    const vu = buildChildView(unrelated.s, v2, unrelated.env.settings, unrelated.env.now());
    equal(vu.station!.reference.kind, "none");
    ok(!/Schildkr/.test(vu.station!.reference.text), vu.station!.reference.text);
    const empty = atV4([], []);
    equal(buildChildView(empty.s, v2, empty.env.settings, empty.env.now()).station!.reference.kind, "none");
    const turtles = atV4([], [{ text: "Ichhabe2Schildkroten gesehen." }]);
    const vt = buildChildView(turtles.s, v2, turtles.env.settings, turtles.env.now());
    equal(vt.station!.reference.kind, "turtles-in-log");
    ok(/erwähnt/.test(vt.station!.reference.text));
    for (const theme of ["turtles", "waves", "none"]) {
      const r = applyLearningOp(unrelated.s, { op: "choose-station", theme }, unrelated.env);
      equal(r.state.station!.theme, theme);
      equal(currentStage(r.state, v2), "typing-course");
    }
  });
});

describe("C3 — persisted typing decisions: repeat / smaller / advance / stop with real fixtures; shorter bursts are practice only", () => {
  const full = ["fff jjj", "fj fj jf"];
  function ready() {
    const { s, env } = atV4([{ op: "choose-station", theme: "none" }]);
    return { s: applyLearningOp(s, { op: "typing-check", observed: ["'", "ö", "z"] }, env).state, env };
  }
  const burst = (state: MissionState, env: OpEnv, lines: string[], comfort: "easy" | "ok" | "hard", lessonId = "TYPE-CH-COURSE-1") => applyLearningOp(state, { op: "typing-burst", lessonId, lines, seconds: 15, comfort }, env);
  it("smaller after two bad bursts; a shorter burst is then allowed, recorded with its line count, and never counts towards promotion", () => {
    const { s, env } = ready();
    throws(() => burst(s, env, ["fff jjj"], "ok"), /shorter burst is only offered after a smaller decision/);
    let r = burst(s, env, ["fxf jjj", "fj fj jf"], "hard");
    equal(r.result.decision, "repeat");
    r = burst(r.state, env, ["fxf jxj", "fj fjjf"], "hard");
    equal(r.result.decision, "smaller");
    const view = buildChildView(r.state, v2, env.settings, env.now());
    equal(view.typingCourse!.decision!.action, "smaller", "the decision is served on reload");
    r = burst(r.state, env, ["fff jjj"], "ok");
    equal(r.state.typing.course!.bursts.at(-1)!.lineCount, 1);
    equal(r.state.typing.course!.bursts.at(-1)!.accuracy, 1);
    equal(r.result.decision, "repeat", "a perfect short burst is practice, not a good full burst");
    equal(r.records.samples.at(-1)!.text, "fff jjj");
    r = burst(r.state, env, full, "ok");
    equal(r.result.decision, "repeat", "one good full burst of the required two");
    r = burst(r.state, env, full, "ok");
    equal(r.result.decision, "advance");
    equal(buildChildView(r.state, v2, env.settings, env.now()).typingCourse!.burstsThisVisit.map((b) => b.lineCount).join(","), "2,2,1,2,2");
  });
  it("stop after the last lesson: two good bursts per lesson through the whole course", () => {
    let { s, env } = ready();
    const lessons = v2.typing.course!.lessons;
    for (let i = 0; i < lessons.length; i += 1) {
      const lines = lessons[i].lines;
      let r = burst(s, env, lines, "ok", lessons[i].id);
      equal(r.result.decision, "repeat");
      r = burst(r.state, env, lines, "ok", lessons[i].id);
      equal(r.result.decision, i === lessons.length - 1 ? "stop" : "advance", lessons[i].id);
      s = r.state;
    }
    deepStrictEqual(s.typing.course!.completed, lessons.map((l) => l.id));
    equal(s.typing.course!.lessonIndex, lessons.length - 1);
    equal(buildChildView(s, v2, env.settings, env.now()).typingCourse!.decision!.action, "stop");
  });
});

describe("release rollback gate — a started chapter 4 under version-1 content is parked, never rewritten, and resumes", () => {
  it("under v1 content the view renders without throwing, nothing is offered in place of the chapter, no downgrade is written, and v2 resumes at the same stage", () => {
    const { s, env } = atV4([{ op: "choose-station", theme: "turtles" }]);
    equal(currentStage(s, v2), "typing-course");
    const capped = makeEnv(v1, { keyboardLayout: "ch-de-qwertz" }, env.now().getTime());
    const up = upgradeMissionState(JSON.parse(JSON.stringify(s)), v1, capped.now().toISOString());
    equal(up.changed, false, "no downgrade write");
    equal(up.state.contentVersion, 2);
    equal(currentStage(up.state, v1), null);
    const view = buildChildView(up.state, v1, capped.settings, capped.now());
    equal(view.visit, null);
    deepStrictEqual(view.next, { visit: null, availableAt: null, reason: "chapter-unavailable" });
    ok(/nicht verfügbar/.test(view.nextStep) && /gespeichert/.test(view.nextStep), view.nextStep);
    equal(view.contentVersion, 2);
    equal(view.pages.length, 2);
    throws(() => applyLearningOp(up.state, { op: "typing-course-continue" }, capped), /not active/);
    throws(() => applyLearningOp(up.state, { op: "start-visit" }, capped), /./, "nothing else can start while the chapter is parked");
    // Back under v2: same stage, same station choice, same revision.
    equal(currentStage(up.state, v2), "typing-course");
    equal(up.state.station!.theme, "turtles");
    equal(up.state.revision, s.revision);
  });
  it("a finished chapter 4 under v1 content: the delayed check keeps its own rule; the completed v4 stays recorded", () => {
    const { s, env } = atV4([{ op: "choose-station", theme: "none" }, { op: "typing-course-continue" }]);
    let t = ensureItemShown(s, v2, env.now()).state;
    t = run(t, [{ op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" }, { op: "skip-stage", stage: "explain", reason: "child" }, { op: "skip-stage", stage: "LANG-ES-STATION", reason: "child" }, { op: "build-station", spot: "rocks" }, { op: "save-log", text: "Fertig." }, { op: "skip-stage", stage: "log-revise", reason: "child" }, { op: "skip-stage", stage: "log-transfer", reason: "child" }, { op: "summary-seen" }, { op: "reflect", optionId: "right" }], env);
    const capped = makeEnv(v1, {}, env.now().getTime());
    const view = buildChildView(t, v1, capped.settings, capped.now());
    equal(view.next.reason, "delayed-check-waits");
    equal(view.pages.length, 3);
    equal(t.visits.find((v) => v.id === "v4")!.finishedAt !== null, true);
  });
});

// ---------------------------------------------------------------------------
// Independent repair round 2 (2026-09-30): R2-1 … R2-6.
// ---------------------------------------------------------------------------

function atStage(stage: "log-transfer" | "reflect" | "LANG-ES-STATION", theme: string, revise: "revised" | "skipped" | "none" = "revised") {
  const { s, env } = atV4([{ op: "choose-station", theme }, { op: "typing-course-continue" }]);
  let t = ensureItemShown(s, v2, env.now()).state;
  t = run(t, [{ op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" }, { op: "skip-stage", stage: "explain", reason: "child" }], env);
  if (stage === "LANG-ES-STATION") return { s: t, env };
  t = run(t, [{ op: "skip-stage", stage: "LANG-ES-STATION", reason: "child" }, { op: "build-station", spot: "rocks" }, { op: "save-log", text: revise === "none" ? "Die Station steht." : "Ichhabe2Schildkroten gesehen." }], env);
  if (revise === "revised") t = run(t, [{ op: "revise-log", text: "Ich habe 2 Schildkroten gesehen." }], env);
  else if (revise === "skipped") t = run(t, [{ op: "skip-stage", stage: "log-revise", reason: "child" }], env);
  else t = run(t, [{ op: "revise-log", text: "Die Station steht." }], env);
  if (stage === "log-transfer") return { s: t, env };
  t = run(t, [{ op: "write-transfer", text: "Morgen zählt die Station 3 Wellen.", modality: "typed" }, { op: "summary-seen" }], env);
  return { s: t, env };
}

describe("R2-1 — occurrence-accurate spacing feedback by alignment", () => {
  const joins = () => v2.writing!.spacing.joins;
  const original = "Ichhabe2Schildkroten. Ichhabe2Schildkroten.";
  it("the independent adversary: split fixes across the two sentences are 3/6", () => {
    const flags = flagSpacing(original, joins());
    equal(flags.length, 6);
    const r = evaluateRevision(original, "Ichhabe 2 Schildkroten. Ich habe2Schildkroten.", flags);
    equal(r.resolved, 3);
    equal(r.outcome, "partial");
    deepStrictEqual(r.unresolved.map((f) => f.index), [3, 29, 30]);
  });
  it("first-only, second-only, both, neither, and independent single boundaries", () => {
    const flags = flagSpacing(original, joins());
    equal(evaluateRevision(original, "Ich habe 2 Schildkroten. Ichhabe2Schildkroten.", flags).resolved, 3);
    equal(evaluateRevision(original, "Ichhabe2Schildkroten. Ich habe 2 Schildkroten.", flags).resolved, 3);
    equal(evaluateRevision(original, "Ich habe 2 Schildkroten. Ich habe 2 Schildkroten.", flags).outcome, "revised");
    equal(evaluateRevision(original, original, flags).outcome, "unchanged");
    equal(evaluateRevision(original, "Ichhabe2 Schildkroten. Ichhabe2Schildkroten.", flags).resolved, 1, "one digit boundary in the first sentence only");
    deepStrictEqual(evaluateRevision(original, "Ichhabe2Schildkroten. Ichhabe 2Schildkroten.", flags).unresolved.map((f) => f.index), [3, 7, 8, 25, 30]);
  });
  it("insertions, deletions, reordering and unmatched material never count as fixes; spelling changes next to a boundary do not block it", () => {
    const flags = flagSpacing(original, joins());
    equal(evaluateRevision(original, "Gestern: Ich habe 2 Schildkroten. Ichhabe2Schildkroten.", flags).resolved, 3, "inserted words elsewhere do not disturb the alignment");
    equal(evaluateRevision(original, "Ich habe 2 Schildkröten. Ichhabe2Schildkroten.", flags).resolved, 3, "spelling change elsewhere in the word is not judged");
    // Deleting a whole sentence makes it ambiguous which occurrence was corrected: the alignment credits at most one occurrence and never calls it "revised".
    const deleted = evaluateRevision(original, "Ich habe 2 Schildkroten.", flags);
    ok(deleted.resolved <= 3 && deleted.outcome !== "revised", JSON.stringify(deleted));
    // A corrected copy inserted between the two originals is credited once, never twice.
    equal(evaluateRevision(original, "Ichhabe2Schildkroten. Ich habe 2 Schildkroten. Ichhabe2Schildkroten.", flags).resolved, 3);
    equal(evaluateRevision(original, "Wir sahen Wellen.", flags).resolved, 0, "unrelated text resolves nothing");
    equal(evaluateRevision(original, "Ich  habe  2  Schildkroten. Ichhabe2Schildkroten.", flags).resolved, 3, "doubled spaces are normalised, still one space");
    equal(evaluateRevision(original, "Ich-habe-2-Schildkroten. Ichhabe2Schildkroten.", flags).resolved, 0, "a hyphen is not a space");
    const single = "Ichhabe2Schildkroten gesehen.";
    const f1 = flagSpacing(single, joins());
    equal(evaluateRevision(single, "ich habe 2 schildkroten gesehen.", f1).outcome, "revised", "case-insensitive");
  });
  it("through the state machine: the persisted revision records the accurate count, original, modality and help", () => {
    const { s, env } = atV4([{ op: "choose-station", theme: "none" }, { op: "typing-course-continue" }]);
    let t = ensureItemShown(s, v2, env.now()).state;
    t = run(t, [{ op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" }, { op: "skip-stage", stage: "explain", reason: "child" }, { op: "skip-stage", stage: "LANG-ES-STATION", reason: "child" }, { op: "build-station", spot: "rocks" }, { op: "save-log", text: original }], env);
    const r = applyLearningOp(t, { op: "revise-log", text: "Ichhabe 2 Schildkroten. Ich habe2Schildkroten." }, env);
    const rec = r.state.logRevisions.at(-1)!;
    equal(rec.resolved, 3);
    equal(rec.outcome, "partial");
    equal(rec.original, original);
    equal(rec.helpShown, true);
    equal(rec.modality, "typed");
  });
});

describe("R2-3 — fresh writing transfer (WRITE-TRANSFER-1)", () => {
  it("the stage follows the revision, is reachable from the completed-v1/v2 fixture, records first-attempt evidence with exposure, and links the revision", () => {
    const { s, env } = atStage("log-transfer", "none", "revised");
    equal(currentStage(s, v2), "log-transfer");
    const view = buildChildView(s, v2, env.settings, env.now());
    equal(view.transfer!.id, "WRITE-TRANSFER-1");
    equal(view.transfer!.helpExposed, true);
    const r = applyLearningOp(s, { op: "write-transfer", text: "Morgen zählt die Station 3 Wellen.", modality: "typed" }, env);
    const t = r.state.transfers!.at(-1)!;
    equal(t.outcome, "clean");
    equal(t.helpExposed, true, "the spacing help was shown in this visit");
    equal(t.linkedRevisionAt, s.logRevisions.at(-1)!.at);
    const attempt = r.records.attempts.find((a) => a.taskId === "WRITE-TRANSFER-1")!;
    equal(attempt.objective, "writing-spacing-transfer");
    equal(attempt.evidence, "supported", "clean after shown help is supported, not independent");
    deepStrictEqual(attempt.support, ["revision-help"]);
    equal(r.records.samples.find((x) => x.kind === "writing_transfer")!.text, "Morgen zählt die Station 3 Wellen.");
    equal(currentStage(r.state, v2), "summary");
    // Without prior help (nothing to revise): independent evidence.
    const clean = atStage("log-transfer", "none", "none");
    equal(buildChildView(clean.s, v2, clean.env.settings, clean.env.now()).transfer!.helpExposed, false);
    const r2 = applyLearningOp(clean.s, { op: "write-transfer", text: "Morgen zählt die Station 3 Wellen.", modality: "typed" }, clean.env);
    equal(r2.records.attempts.at(-1)!.evidence, "independent");
    // Flagged sentence: incorrect, limited to the reviewed cases; spoken: unscored.
    const r3 = applyLearningOp(s, { op: "write-transfer", text: "Morgenzählt die Station2Wellen.", modality: "typed" }, env);
    equal(r3.state.transfers!.at(-1)!.outcome, "flagged");
    equal(r3.state.transfers!.at(-1)!.flagged.length, 2);
    equal(r3.records.attempts.at(-1)!.evidence, "incorrect");
    const r4 = applyLearningOp(s, { op: "write-transfer", text: "Morgen zählt die Station 3 Wellen.", modality: "spoken" }, env);
    equal(r4.records.attempts.at(-1)!.evidence, "unscored");
    // Copying the page or the shown correction is refused; skipping is recorded.
    throws(() => applyLearningOp(s, { op: "write-transfer", text: "Ich habe 2 Schildkroten gesehen." }, env), /NEW sentence/);
    throws(() => applyLearningOp(s, { op: "write-transfer", text: "Ichhabe2Schildkroten gesehen." }, env), /NEW sentence/);
    const sk = applyLearningOp(s, { op: "skip-stage", stage: "log-transfer", reason: "child" }, env);
    equal(sk.state.transfers!.at(-1)!.outcome, "skipped");
    equal(currentStage(sk.state, v2), "summary");
  });
  it("summary and parent review carry the transfer; deletion is covered by the state; the retained stage lists are untouched; delayed-check timing unchanged", () => {
    const { s, env } = atStage("reflect", "none", "revised");
    const summary = buildVisitSummary(s, v2, "v4");
    ok(summary.success && summary.success.basis, "a success line with its basis exists (the math success outranks the transfer)");
    // Without a math success the clean transfer becomes the success line, citing help exposure.
    const noMath = JSON.parse(JSON.stringify(s)) as MissionState;
    noMath.math["EQ-STATION"]!.attempts = [];
    noMath.math["EQ-STATION"]!.outcome = "pending";
    const s2 = buildVisitSummary(noMath, v2, "v4");
    ok(/neuer Satz/i.test(s2.success?.text ?? "") && /transfer WRITE-TRANSFER-1 clean/.test(s2.success?.basis ?? ""), JSON.stringify(s2.success));
    const review = buildParentReview(s, v2, "v4", null, { historical: false });
    ok(review.learning.objectives.some((o) => o.taskId === "WRITE-TRANSFER-1" && o.objective === "writing-spacing-transfer"));
    ok(review.learning.whatHappened.some((w) => /Transfer/.test(w)));
    for (const id of ["v1", "v2", "v3"] as const) deepStrictEqual(v2.visits.find((v) => v.id === id)?.stages, v1.visits.find((v) => v.id === id)?.stages, id);
    equal(v2.visits.find((v) => v.id === "v4")!.stages.length, 12);
    const info = delayedCheckInfo(s, v2, env.now());
    equal(info?.minDays, 6);
    // A fresh v2 state also has the field; an upgraded v1 state gets it additively.
    equal(newMissionState(v2, "santiago", "2026-09-30T00:00:00.000Z").transfers!.length, 0);
    const { state } = completedTwoVisitsUnderV1();
    deepStrictEqual(upgradeMissionState(state, v2, "2026-09-30T00:00:00.000Z").state.transfers, []);
  });
});

describe("R2-4 — the chapter stays coherent with the chosen theme (turtles / waves / none)", () => {
  it("the Spanish reuse sentence follows the actual choice, the answer stays agua, and the record keeps the variant", () => {
    const expected: Record<string, RegExp> = { turtles: /tortugas/, waves: /equipo/, none: /estación/ };
    for (const theme of ["turtles", "waves", "none"]) {
      const { s, env } = atStage("LANG-ES-STATION", theme);
      let t = run(s, [
        { op: "language-step", segmentId: "LANG-ES-STATION", stepId: "listen", response: "", modality: "listen" },
        { op: "language-step", segmentId: "LANG-ES-STATION", stepId: "pick", response: "lámpara", modality: "word-choice" },
        { op: "language-step", segmentId: "LANG-ES-STATION", stepId: "produce", response: "Necesitamos una lámpara.", modality: "typed" },
      ], env);
      const view = buildChildView(t, v2, env.settings, env.now());
      const step = view.language!.step!;
      ok(step.kind === "pick-supply" && expected[theme].test(step.sentence), `${theme}: ${step.kind === "pick-supply" ? step.sentence : ""}`);
      if (theme !== "turtles") ok(step.kind === "pick-supply" && !/tortug/.test(step.sentence), "no turtle wording without the turtle choice");
      t = applyLearningOp(t, { op: "language-step", segmentId: "LANG-ES-STATION", stepId: "reuse", response: "agua", modality: "word-choice" }, env).state;
      const rec = t.language["LANG-ES-STATION"]!.records.at(-1)!;
      equal(rec.correct, true);
      equal(rec.variant, theme);
      // Reload = same state: the sentence is derived from the durable choice, not a client value.
      const reloaded = JSON.parse(JSON.stringify(t)) as MissionState;
      equal(reloaded.station!.theme, theme);
    }
    // Glosses cover every variant word; the content validator accepts the variants and rejects an unknown theme.
    const es = v2.language.segments.find((x) => x.id === "LANG-ES-STATION")!;
    ok(es.glosses.some((g) => g.word === "equipo") && es.glosses.some((g) => g.word === "tortugas") && es.glosses.some((g) => g.word === "estación"));
    equal(es.glosses.length, 6);
    const bad = JSON.parse(JSON.stringify(rawV2));
    bad.language.segments.find((x: { id: string }) => x.id === "LANG-ES-STATION").steps.find((x: { id: string }) => x.id === "reuse").variants.dragons = "Necesitamos agua para los dragones.";
    ok(reconcileLearningContent(bad).problems.some((p) => /variant dragons is not a station theme/.test(p)));
  });
});

describe("R2-5 — explicit child feedback: difficulty required, enjoyment/clarity optional with explicit skip", () => {
  it("answers and skips are stored on the visit, the review shows them separately from hypotheses, unknown values are refused, v1 content offers none", () => {
    const { s, env } = atStage("reflect", "none");
    const view = buildChildView(s, v2, env.settings, env.now());
    deepStrictEqual(view.reflection!.dimensions.map((d) => d.id), ["enjoyment", "clarity"]);
    const r = applyLearningOp(s, { op: "reflect", optionId: "right", feedback: { enjoyment: "yes", clarity: null } }, env);
    const visit = r.state.visits.find((v) => v.id === "v4")!;
    equal(visit.reflection, "right");
    deepStrictEqual(visit.feedback, { answers: { difficulty: "right", enjoyment: "yes" }, skipped: ["clarity"], unanswered: [], offered: ["difficulty", "enjoyment", "clarity"] });
    const review = buildParentReview(r.state, v2, "v4", null, { historical: false });
    deepStrictEqual(review.experience.childFeedback, { difficulty: "right", enjoyment: "yes", clarity: null, skipped: ["clarity"], unanswered: [], notOffered: [] });
    ok(review.experience.missing.some((m) => /bewusst nicht gesagt: clarity/.test(m)));
    const none = applyLearningOp(s, { op: "reflect", optionId: "tricky" }, env);
    deepStrictEqual(none.state.visits.find((v) => v.id === "v4")!.feedback, { answers: { difficulty: "tricky" }, skipped: [], unanswered: ["enjoyment", "clarity"], offered: ["difficulty", "enjoyment", "clarity"] }, "left open is recorded as unanswered, not as skipped");
    throws(() => applyLearningOp(s, { op: "reflect", optionId: "right", feedback: { enjoyment: "great" } }, env), /unknown enjoyment option/);
    // Historical visits (version-1 content) never offered the dimensions: explicitly not offered, never neutral.
    const { state } = completedTwoVisitsUnderV1();
    const hist = buildParentReview(state, v1, "v1", null, { historical: true, contentVersion: 1 });
    deepStrictEqual(hist.experience.childFeedback, { difficulty: "easy", enjoyment: null, clarity: null, skipped: [], unanswered: [], notOffered: ["enjoyment", "clarity"] });
    ok(hist.experience.missing.some((m) => /nicht abgefragt/.test(m)));
  });
});

describe("R2-6 — recipient wording follows the kind of recipient", () => {
  it("every math item carries a recipient kind in v2; people versus containers; v1 content falls back to a conservative heuristic", () => {
    for (const item of v2.math.items) ok(v2.math.recipientKinds![item.id] === "people" || v2.math.recipientKinds![item.id] === "container", item.id);
    deepStrictEqual(Object.entries(v2.math.recipientKinds!).filter(([, k]) => k === "people").map(([id]) => id), ["EQ-ENTRY", "EQ-FRESH"]);
    const env = makeEnv(v2);
    let s = newMissionState(v2, "santiago", env.now().toISOString());
    s = run(s, [{ op: "start-visit" }, { op: "name-base", name: "X" }, { op: "place-base", locationId: "shore" }], env);
    s = ensureItemShown(s, v2, env.now()).state;
    equal(buildChildView(s, v2, env.settings, env.now()).math!.groupKind, "people");
    const envV1 = makeEnv(v1);
    let u = newMissionState(v1, "santiago", envV1.now().toISOString());
    u = run(u, [{ op: "start-visit" }, { op: "name-base", name: "X" }, { op: "place-base", locationId: "shore" }], envV1);
    u = ensureItemShown(u, v1, envV1.now()).state;
    equal(buildChildView(u, v1, envV1.settings, envV1.now()).math!.groupKind, "people", "v1 content (rollback cap) infers people from the recipient noun");
    const bad = JSON.parse(JSON.stringify(rawV2));
    delete bad.math.recipientKinds["EQ-DELAY"];
    ok(reconcileLearningContent(bad).problems.some((p) => /EQ-DELAY: recipientKinds/.test(p)));
  });
});

// ---------------------------------------------------------------------------
// Independent repair round 3 (2026-09-30): R3-1 … R3-5 and partial-gate evidence.
// ---------------------------------------------------------------------------

describe("R3-1 — transfer evidence only where a reviewed boundary can be assessed", () => {
  const joins = () => v2.writing!.spacing.joins;
  it("assessSpacing counts assessed reviewed boundaries: none for Hallo / xyz / an unreviewed join; correct and missing ones otherwise", () => {
    for (const t of ["Hallo", "xyz", "Diemorgensonneistwarm", "Die Station beobachtet Wellen."]) deepStrictEqual(assessSpacing(t, joins()), { assessed: 0, correct: 0, flags: [], assessable: false }, t);
    deepStrictEqual(assessSpacing("Morgen zählt die Station 3 Wellen.", joins()).assessed, 2);
    deepStrictEqual(assessSpacing("Morgen zählt die Station 3 Wellen.", joins()).correct, 2);
    const flagged = assessSpacing("Morgenzählt die Station2Wellen.", joins());
    equal(flagged.assessed, 2);
    equal(flagged.correct, 0);
    equal(flagged.flags.length, 2);
    const mixed = assessSpacing("Ich habe 2 Wellen gesehen.Dann kam Wind.", joins());
    equal(mixed.correct, 3, "ich habe + habe 2 + 2 Wellen");
    equal(mixed.flags.length, 1, "gesehen.Dann");
    equal(mixed.assessed, 4);
    equal(assessSpacing("Ichhabe 2 Wellen gesehen.", joins()).assessed, 3);
  });
  it("write-transfer: unassessable text is unscored (never independent/correct), clean assessable text keeps limited credit, flagged is incorrect, spoken is unscored", () => {
    for (const text of ["Hallo", "xyz", "Diemorgensonneistwarm"]) {
      const { s, env } = atStage("log-transfer", "none", "none");
      const r = applyLearningOp(s, { op: "write-transfer", text, modality: "typed" }, env);
      const rec = r.state.transfers!.at(-1)!;
      equal(rec.outcome, "unassessable", text);
      equal(rec.assessed, 0);
      const a = r.records.attempts.at(-1)!;
      equal(a.evidence, "unscored", text);
      equal(a.correct, null);
      ok(/nothing to assess/.test(a.uncertainty ?? ""));
      const review = buildParentReview(r.state, v2, "v4", null, { historical: false });
      const obj = review.learning.objectives.find((o) => o.taskId === "WRITE-TRANSFER-1")!;
      equal(obj.outcome, "unscored");
      equal(obj.evidence, "unscored");
      ok(/nichts zu bewerten/.test(obj.uncertainty ?? ""));
      const summary = buildVisitSummary(r.state, v2, "v4");
      ok(!/neuer Satz/i.test(summary.success?.text ?? ""), "no success line from an unassessable sentence");
    }
    const { s, env } = atStage("log-transfer", "none", "none");
    const clean = applyLearningOp(s, { op: "write-transfer", text: "Morgen zählt die Station 3 Wellen.", modality: "typed" }, env);
    equal(clean.state.transfers!.at(-1)!.outcome, "clean");
    equal(clean.state.transfers!.at(-1)!.assessed, 2);
    equal(clean.records.attempts.at(-1)!.evidence, "independent");
    deepStrictEqual(clean.records.attempts.at(-1)!.answer, { assessed: 2, correct: 2, flags: 0, rules: [] });
    const helped = atStage("log-transfer", "none", "revised");
    equal(applyLearningOp(helped.s, { op: "write-transfer", text: "Morgen zählt die Station 3 Wellen.", modality: "typed" }, helped.env).records.attempts.at(-1)!.evidence, "supported");
    const flagged = applyLearningOp(s, { op: "write-transfer", text: "Morgenzählt die Station2Wellen.", modality: "typed" }, env);
    equal(flagged.state.transfers!.at(-1)!.outcome, "flagged");
    equal(flagged.records.attempts.at(-1)!.evidence, "incorrect");
    equal(applyLearningOp(s, { op: "write-transfer", text: "Morgen zählt die Station 3 Wellen.", modality: "spoken" }, env).records.attempts.at(-1)!.evidence, "unscored");
  });
  it("records written before round 3 are recomputed on upgrade: a false clean credit becomes unassessable, a real clean one keeps its count", () => {
    const { s, env } = atStage("reflect", "none", "none");
    const legacy = JSON.parse(JSON.stringify(s)) as MissionState;
    const t = legacy.transfers!.at(-1)!;
    delete t.assessed;
    t.text = "Hallo";
    t.outcome = "clean";
    const up = upgradeMissionState(legacy, v2, env.now().toISOString());
    equal(up.changed, true);
    equal(up.state.transfers!.at(-1)!.outcome, "unassessable");
    equal(up.state.transfers!.at(-1)!.assessed, 0);
    const review = buildParentReview(up.state, v2, "v4", null, { historical: false });
    equal(review.learning.objectives.find((o) => o.taskId === "WRITE-TRANSFER-1")!.evidence, "unscored");
    const legacy2 = JSON.parse(JSON.stringify(s)) as MissionState;
    delete legacy2.transfers!.at(-1)!.assessed;
    const up2 = upgradeMissionState(legacy2, v2, env.now().toISOString());
    equal(up2.state.transfers!.at(-1)!.assessed, 2);
    equal(up2.state.transfers!.at(-1)!.outcome, "clean");
    // A record that has no count at all (text lost) is shown as unknown, never credited.
    const legacy3 = JSON.parse(JSON.stringify(s)) as MissionState;
    delete legacy3.transfers!.at(-1)!.assessed;
    legacy3.transfers!.at(-1)!.text = null;
    const rev3 = buildParentReview(legacy3, v2, "v4", null, { historical: false });
    equal(rev3.learning.objectives.find((o) => o.taskId === "WRITE-TRANSFER-1")!.evidence, "unscored");
    ok(/vor dem 30.09.2026/.test(rev3.learning.objectives.find((o) => o.taskId === "WRITE-TRANSFER-1")!.uncertainty ?? ""));
  });
});

describe("R3-2 — the shown correction never masquerades as new work", () => {
  const cases = [
    ["revised", "Ich habe 2 Schildkroten gesehen."],
    ["skipped", "Ich habe 2 Schildkroten gesehen."],
    ["skipped", "Ich|habe|2|Schildkroten gesehen."],
    ["skipped", "ich habe 2 schildkroten gesehen"],
    ["skipped", "  Ich  habe 2  Schildkroten gesehen!  "],
    ["revised", "Ichhabe2Schildkroten gesehen."],
    ["none", "Die Station steht."],
  ] as const;
  it("refuses the page, the saved revision and the shown suggestion (also after a skipped revision), under bounded normalisation, with a specific code and no row", () => {
    for (const [mode, text] of cases) {
      const { s, env } = atStage("log-transfer", "none", mode);
      const before = s.transfers?.length ?? 0;
      let code: string | null = null;
      try {
        applyLearningOp(s, { op: "write-transfer", text, modality: "typed" }, env);
      } catch (e) {
        code = (e as { code?: string }).code ?? null;
      }
      equal(code, "copied-text", `${mode}: ${text}`);
      equal(s.transfers?.length ?? 0, before, "no transfer row on refusal");
    }
    // Exposure is retained even when the revision was skipped; a genuinely different reviewed sentence is accepted.
    const { s, env } = atStage("log-transfer", "none", "skipped");
    equal(buildChildView(s, v2, env.settings, env.now()).transfer!.helpExposed, true);
    const r = applyLearningOp(s, { op: "write-transfer", text: "Ich habe 3 Wellen gesehen.", modality: "typed" }, env);
    equal(r.state.transfers!.at(-1)!.outcome, "clean");
    equal(r.state.transfers!.at(-1)!.helpExposed, true);
    equal(r.records.attempts.at(-1)!.evidence, "supported");
    // No correction was ever offered (clean page): only the page itself is a copy.
    const none = atStage("log-transfer", "none", "none");
    let code: string | null = null;
    try {
      applyLearningOp(none.s, { op: "write-transfer", text: "Die Station steht." }, none.env);
    } catch (e) {
      code = (e as { code?: string }).code ?? null;
    }
    equal(code, "copied-text");
    equal(applyLearningOp(none.s, { op: "write-transfer", text: "Die Station zählt 4 Wellen." }, none.env).state.transfers!.at(-1)!.outcome, "clean");
  });
});

describe("R3-3 — optional difficulty; answered / explicitly skipped / left open / not offered", () => {
  it("every combination is stored truthfully and the review reports it; v1 content still requires difficulty", () => {
    const { s, env } = atStage("reflect", "none");
    const cases: { op: LearningOp; expect: { answers: Record<string, string>; skipped: string[]; unanswered: string[] } }[] = [
      { op: { op: "reflect", optionId: "right", feedback: { enjoyment: "yes", clarity: "clear" } }, expect: { answers: { difficulty: "right", enjoyment: "yes", clarity: "clear" }, skipped: [], unanswered: [] } },
      { op: { op: "reflect", optionId: "right" }, expect: { answers: { difficulty: "right" }, skipped: [], unanswered: ["enjoyment", "clarity"] } },
      { op: { op: "reflect", optionId: null, feedback: { enjoyment: "yes" } }, expect: { answers: { enjoyment: "yes" }, skipped: [], unanswered: ["difficulty", "clarity"] } },
      { op: { op: "reflect", optionId: null, feedback: { clarity: "unclear" } }, expect: { answers: { clarity: "unclear" }, skipped: [], unanswered: ["difficulty", "enjoyment"] } },
      { op: { op: "reflect", optionId: null, difficultySkipped: true, feedback: { enjoyment: null, clarity: null } }, expect: { answers: {}, skipped: ["difficulty", "enjoyment", "clarity"], unanswered: [] } },
      { op: { op: "reflect", optionId: null }, expect: { answers: {}, skipped: [], unanswered: ["difficulty", "enjoyment", "clarity"] } },
      { op: { op: "reflect", optionId: null, difficultySkipped: true, feedback: { enjoyment: "partly", clarity: "partly" } }, expect: { answers: { enjoyment: "partly", clarity: "partly" }, skipped: ["difficulty"], unanswered: [] } },
    ];
    for (const c of cases) {
      const r = applyLearningOp(s, c.op, env);
      const visit = r.state.visits.find((v) => v.id === "v4")!;
      deepStrictEqual(visit.feedback, { ...c.expect, offered: ["difficulty", "enjoyment", "clarity"] }, JSON.stringify(c.op));
      equal(visit.reflection, c.expect.answers.difficulty ?? null);
      equal(visit.finishedAt, env.now().toISOString(), "the visit completes without a difficulty answer");
      const review = buildParentReview(r.state, v2, "v4", null, { historical: false });
      deepStrictEqual(review.experience.childFeedback, { difficulty: c.expect.answers.difficulty ?? null, enjoyment: c.expect.answers.enjoyment ?? null, clarity: c.expect.answers.clarity ?? null, skipped: c.expect.skipped, unanswered: c.expect.unanswered, notOffered: [] });
      if (c.expect.skipped.includes("difficulty")) ok(review.experience.missing.some((m) => /Schwierigkeit: vom Kind bewusst nicht gesagt/.test(m)));
      if (c.expect.unanswered.includes("difficulty")) ok(review.experience.missing.some((m) => /Schwierigkeit: offen gelassen/.test(m)));
      const summary = buildVisitSummary(r.state, v2, "v4");
      ok(summary.next.branch !== "success-easy" || c.expect.answers.difficulty === "easy");
    }
    throws(() => applyLearningOp(s, { op: "reflect", optionId: "great" }, env), /unknown reflection option/);
    // Version-1 content has no skip label: difficulty stays required there (retained meaning).
    const { state, env: e1 } = completedTwoVisitsUnderV1();
    void state;
    const envV1 = makeEnv(v1, {}, e1.now().getTime());
    let u = newMissionState(v1, "santiago", envV1.now().toISOString());
    u = run(u, [{ op: "start-visit" }, { op: "name-base", name: "X" }, { op: "place-base", locationId: "shore" }, { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }, { op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" }, { op: "skip-stage", stage: "explain", reason: "child" }, { op: "skip-stage", stage: "LANG-EN-WATER", reason: "child" }, { op: "skip-stage", stage: "typing", reason: "child" }, { op: "save-log", text: "Tag eins." }], envV1);
    throws(() => applyLearningOp(u, { op: "reflect", optionId: null }, envV1), /difficulty is required/);
    equal(applyLearningOp(u, { op: "reflect", optionId: "easy" }, envV1).state.visits[0].feedback, undefined, "v1 content records no feedback dimensions");
  });
});

describe("R3-4 — stable completed-draft retries (pure helper)", () => {
  it("same payload keeps its key through network failure, refusal and stale; a changed payload gets a new key; saving cannot be resent; double submit is one send", () => {
    let n = 0;
    const newKey = () => `k-${(n += 1)}`;
    const key = payloadKeyOf({ op: "write-transfer", text: "  Morgen  zählt die Station 3 Wellen. " });
    equal(key, payloadKeyOf({ text: "Morgen zählt die Station 3 Wellen.", op: "write-transfer" }), "whitespace and key order do not change the identity");
    let d = submitDraftFor(null, key, newKey);
    equal(d.idempotencyKey, "k-1");
    ok(canSend(d));
    d = markSending(d);
    ok(!canSend(d), "in flight: a second click sends nothing");
    equal(submitDraftFor(d, key, newKey), d, "the same payload returns the in-flight draft, no new key");
    d = applySubmitOutcome(d, { kind: "network" });
    equal(d.phase, "failed");
    equal(submitDraftFor(d, key, newKey).idempotencyKey, "k-1", "retry after a network failure keeps the key");
    d = applySubmitOutcome(markSending(submitDraftFor(d, key, newKey)), { kind: "refused", code: "copied-text" });
    equal(d.refusalCode, "copied-text");
    equal(submitDraftFor(d, key, newKey).idempotencyKey, "k-1", "an unchanged refused payload keeps its key (the server answers the same)");
    const changed = submitDraftFor(d, payloadKeyOf({ op: "write-transfer", text: "Die Station zählt 4 Wellen." }), newKey);
    equal(changed.idempotencyKey, "k-2", "a deliberately changed payload is a new draft");
    d = applySubmitOutcome(markSending(submitDraftFor(d, key, newKey)), { kind: "stale" });
    equal(d.failure, "stale");
    d = applySubmitOutcome(markSending(submitDraftFor(d, key, newKey)), { kind: "replayed" });
    equal(d.phase, "saved");
    equal(d.idempotencyKey, "k-1");
    equal(d.attempts, 4);
    equal(applySubmitOutcome(d, { kind: "network" }), d, "outcomes after saved are ignored");
  });
});

describe("R3-5 — grouping instructions per recipient kind (state view)", () => {
  it("people items expose kind people, container items container, for every scored item and both teaching models", () => {
    const kinds = v2.math.recipientKinds!;
    deepStrictEqual(kinds, { "EQ-ENTRY": "people", "EQ-MODEL": "container", "EQ-FRESH": "people", "EQ-RETURN": "container", "EQ-DELAY": "container", "EQ-STATION": "container", "EQ-STATION-MODEL": "container" });
    const env = makeEnv(v2);
    let s = newMissionState(v2, "santiago", env.now().toISOString());
    s = run(s, [{ op: "start-visit" }, { op: "name-base", name: "X" }, { op: "place-base", locationId: "shore" }], env);
    s = ensureItemShown(s, v2, env.now()).state;
    const entry = buildChildView(s, v2, env.settings, env.now()).math!;
    equal(entry.groupKind, "people");
    equal(entry.representation, null, "before any answer the content representation is not shown; the UI's initial instruction is derived from the recipient kind");
    s = run(s, [{ op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }], env);
    s = ensureItemShown(s, v2, env.now()).state;
    equal(buildChildView(s, v2, env.settings, env.now()).math!.groupKind, "people");
  });
});

describe("partial-gate evidence — W4 summary matrix, C2 exact due-time boundaries, M8 malformed legacy state", () => {
  it("W4: exact branch per synthetic case — independent, after help, incorrect/uncertain, skipped practice, failed save, typed versus dictated log", () => {
    // independent success
    const base = atStage("reflect", "none", "none");
    const indep = buildVisitSummary(base.s, v2, "v4");
    equal(indep.next.branch, "success");
    ok(/ohne Hilfe, beim ersten Versuch/.test(indep.success!.text));
    // success after help (clarification then correct)
    const { s: h0, env: he } = atV4([{ op: "choose-station", theme: "none" }, { op: "typing-course-continue" }]);
    let h = ensureItemShown(h0, v2, he.now()).state;
    h = run(h, [{ op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 0, raw: "30, 0", modality: "typed" }, { op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" }], he);
    const helped = buildVisitSummary(h, v2, "v4");
    equal(helped.next.branch, "supported");
    ok(/mit Hilfe gelöst/.test(helped.success!.text));
    ok(/erst die vollen Beete/.test(helped.practiced!.text));
    // incorrect / uncertain (unscored spoken answer)
    let u = ensureItemShown(h0, v2, he.now()).state;
    u = run(u, [{ op: "answer-remainder", itemId: "EQ-STATION", used: null, remaining: null, raw: "äh", modality: "spoken", uncertain: true }], he);
    const uns = buildVisitSummary(u, v2, "v4");
    ok(/klar sagen oder tippen/.test(uns.practiced?.text ?? "") || uns.next.branch === "missing-data", JSON.stringify(uns));
    // skipped practice
    let sk = ensureItemShown(h0, v2, he.now()).state;
    sk = run(sk, [{ op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" }, { op: "skip-stage", stage: "explain", reason: "child" }, { op: "skip-stage", stage: "LANG-ES-STATION", reason: "child" }], he);
    ok(/ausgelassen/.test(buildVisitSummary(sk, v2, "v4").practiced?.text ?? ""));
    // failed save = no page in the visit: no artifact, no page success
    const noPage = buildVisitSummary(sk, v2, "v4");
    equal(noPage.artifact.kind, "none");
    // typed versus dictated log
    let d = run(sk, [{ op: "build-station", spot: "rocks" }, { op: "save-log", text: "Die Station steht.", modality: "spoken" }], he);
    const dictated = buildVisitSummary(d, v2, "v4");
    ok(/gesprochen/.test(dictated.artifact.text), dictated.artifact.text);
    const rev = buildParentReview(d, v2, "v4", null, { historical: false });
    ok(rev.learning.whatHappened.some((w) => /Logbuchseite gesprochen/.test(w)));
    let ty = run(sk, [{ op: "build-station", spot: "rocks" }, { op: "save-log", text: "Die Station steht.", modality: "typed" }], he);
    ok(!/gesprochen/.test(buildVisitSummary(ty, v2, "v4").artifact.text));
    void d;
    void ty;
  });
  it("R5-2: feedback-only telemetry never yields measured zeros; observed UX yields numbers (genuine zeros included) and names unobserved stages", () => {
    const fbOnly = summariseTelemetry([{ t: 1, kind: "feedback", stage: "reflect", detail: { dimension: "difficulty", option: "right" } }, { t: 1, kind: "feedback", stage: "reflect", detail: { dimension: "enjoyment", option: "yes" } }], 1, ["restore", "reflect"]);
    equal(fbOnly.supported, true);
    equal(fbOnly.uxObserved, false);
    equal(fbOnly.feedbackEvents, 2);
    equal(fbOnly.uxEvents, 0);
    equal(fbOnly.foregroundActiveSeconds, null);
    equal(fbOnly.hiddenIntervals, null);
    equal(fbOnly.saveFailures, null);
    equal(fbOnly.retries, null);
    equal(fbOnly.pauses, null);
    equal(fbOnly.unobservedStages, null);
    const observed = summariseTelemetry([{ t: 1, kind: "stage-enter", stage: "restore" }, { t: 2, kind: "active-interval", stage: "restore", detail: { seconds: 12 } }, { t: 3, kind: "feedback", stage: "reflect", detail: { dimension: "difficulty", option: "right" } }], 2, ["restore", "reflect", "summary"]);
    equal(observed.uxObserved, true);
    equal(observed.uxEvents, 2);
    equal(observed.foregroundActiveSeconds, 12);
    equal(observed.hiddenIntervals, 0, "a genuine recorded zero stays 0 when UX was observed");
    equal(observed.saveFailures, 0);
    deepStrictEqual(observed.unobservedStages, ["reflect", "summary"]);
    equal(summariseTelemetry(null).uxObserved, false);
    equal(summariseTelemetry(null).supported, false);
    equal(summariseTelemetry([], 0).uxObserved, false);
  });
  it("W4: recommendation branches — success-easy, success, supported, struggling and missing-data each come from their own evidence", () => {
    const easy = atStage("reflect", "none", "none");
    const e = applyLearningOp(easy.s, { op: "reflect", optionId: "easy" }, easy.env);
    equal(buildVisitSummary(e.state, v2, "v4").next.branch, "success-easy");
    const right = applyLearningOp(easy.s, { op: "reflect", optionId: "right" }, easy.env);
    equal(buildVisitSummary(right.state, v2, "v4").next.branch, "success");
    const { s: h0, env: he } = atV4([{ op: "choose-station", theme: "none" }, { op: "typing-course-continue" }]);
    let h = ensureItemShown(h0, v2, he.now()).state;
    h = run(h, [{ op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 0, raw: "30, 0", modality: "typed" }, { op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" }], he);
    equal(buildVisitSummary(h, v2, "v4").next.branch, "supported");
    let st = ensureItemShown(h0, v2, he.now()).state;
    st = run(st, [{ op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 0, raw: "30, 0", modality: "typed" }, { op: "answer-remainder", itemId: "EQ-STATION", used: 32, remaining: 0, raw: "32, 0", modality: "typed" }], he);
    st = run(st, [{ op: "continue-item", itemId: "EQ-STATION" }, { op: "answer-remainder", itemId: "EQ-STATION", used: 31, remaining: 1, raw: "31, 1", modality: "typed" }, { op: "request-teaching", itemId: "EQ-STATION" }], he);
    equal(buildVisitSummary(st, v2, "v4").next.branch, "struggling");
    const { s: m0, env: me } = atV4([{ op: "choose-station", theme: "none" }]);
    equal(buildVisitSummary(m0, v2, "v4").next.branch, "missing-data");
    void me;
  });
  it("C2: the delayed check opens exactly at the stored date, not one millisecond earlier — for the teaching anchor and the v1-completion fallback", () => {
    const { state } = completedTwoVisitsUnderV1();
    const s = upgradeMissionState(state, v2, "2026-09-29T12:00:00.000Z").state;
    const info = delayedCheckInfo(s, v2, new Date("2026-09-29T12:00:00.000Z"))!;
    equal(info.anchor!.kind, "visit1-completion");
    const due = new Date(info.availableAt!);
    equal(delayedCheckInfo(s, v2, new Date(due.getTime() - 1))!.status, "waiting");
    equal(delayedCheckInfo(s, v2, due)!.status, "open");
    equal(delayedCheckInfo(s, v2, new Date(due.getTime() + 1))!.status, "open");
    equal(nextVisitAvailability(s, v2, new Date(due.getTime() - 1)).visit, "v4", "before due: chapter 4, never v3");
    equal(nextVisitAvailability(s, v2, due).visit, "v3", "exactly at due: the delayed check comes first");
    const taught = JSON.parse(JSON.stringify(s)) as MissionState;
    taught.teachingFirstAt = "2026-09-29T09:00:00.000Z";
    const ti = delayedCheckInfo(taught, v2, new Date("2026-09-29T12:00:00.000Z"))!;
    equal(ti.anchor!.kind, "teaching");
    equal(ti.availableAt, "2026-10-05T09:00:00.000Z");
    equal(delayedCheckInfo(taught, v2, new Date("2026-10-05T08:59:59.999Z"))!.status, "waiting");
    equal(delayedCheckInfo(taught, v2, new Date("2026-10-05T09:00:00.000Z"))!.status, "open");
  });
  it("M8: a legacy state missing every new field gets compatible defaults without touching history; a mission of another child never leaks", () => {
    const { state } = completedTwoVisitsUnderV1();
    const legacy = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    for (const k of ["station", "logRevisions", "transfers", "stationModelShownAt", "upgradedAt"]) delete legacy[k];
    delete (legacy.typing as Record<string, unknown>).course;
    delete (legacy.typing as Record<string, unknown>).alignment;
    const up = upgradeMissionState(legacy as unknown as MissionState, v2, "2026-09-30T00:00:00.000Z").state;
    deepStrictEqual(up.visits, state.visits);
    deepStrictEqual(up.pages, state.pages);
    deepStrictEqual(up.math["EQ-ENTRY"], state.math["EQ-ENTRY"]);
    deepStrictEqual(up.transfers, []);
    equal(up.typing.course, null);
    equal(up.station!.theme, null);
    equal(up.child, "santiago");
  });
});
