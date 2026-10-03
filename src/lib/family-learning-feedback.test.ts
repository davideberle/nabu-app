// World-first learner experience (2026-10-03) — lesson-end feedback, bounded
// repair and next-lesson reminders (UX-5a/5b/5c), the reopenable visit report
// and the honest partial recap. Pure state-machine tests; run: npm test

import { deepStrictEqual, equal, ok, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { asLearningContent } from "./family-learning-content.ts";
import { buildVisitReports, lastLessonFeedback, reminderFor, typingErrors, typingRetryItems, typingLessonDef, updateSpacingFocus, updateTypingFocus, emptyFeedbackState, MAX_RETRIES } from "./family-learning-feedback.ts";
import { applyLearningOp, buildChildView, EMPTY_PARENT_SETTINGS, ensureItemShown, newMissionState, upgradeMissionState, type LearningOp, type MissionState, type OpEnv, type ParentSettings } from "./family-learning-state.ts";
import { isChildView } from "./family-learning-view-guard.ts";

const v2 = asLearningContent(JSON.parse(readFileSync(new URL("../data/family-learning/content/santiago-expedition-v2.json", import.meta.url), "utf8")));
const v1 = asLearningContent(JSON.parse(readFileSync(new URL("../data/family-learning/content/santiago-expedition-v1.json", import.meta.url), "utf8")));

function makeEnv(settings: Partial<ParentSettings> = {}, startMs = Date.UTC(2026, 9, 3, 9, 0, 0)): OpEnv & { settings: ParentSettings } {
  let t = startMs;
  let n = 0;
  return { content: v2, settings: { ...EMPTY_PARENT_SETTINGS, ...settings }, now: () => new Date((t += 30_000)), newId: () => `id-${(n += 1)}` };
}
function run(state: MissionState, ops: LearningOp[], env: OpEnv): MissionState {
  let s = state;
  for (const op of ops) {
    s = ensureItemShown(s, env.content, env.now()).state;
    s = applyLearningOp(s, op, env).state;
  }
  return ensureItemShown(s, env.content, env.now()).state;
}
const lang = (segmentId: "LANG-EN-WATER" | "LANG-ES-AGUA" | "LANG-ES-STATION", stepId: string, response: string, modality: "typed" | "word-choice" | "listen" = "typed"): LearningOp => ({ op: "language-step", segmentId, stepId, response, modality });
const CH = ["'", "ö", "z"];

/** Acknowledge the pending lesson feedback, if any (the real client does this with "Weiter"). */
function ackPending(state: MissionState, env: OpEnv): MissionState {
  const pending = lastLessonFeedback(state, env.content);
  return pending ? run(state, [{ op: "lesson-feedback-seen", id: pending.id }], env) : state;
}

/** Two finished visits (v1, v2), chapter 4 started up to the typing course with the layout confirmed and aligned. */
function atTypingCourse(env: OpEnv) {
  let s = newMissionState(v2, "santiago", env.now().toISOString());
  s = run(s, [{ op: "start-visit" }, { op: "name-base", name: "Sonnenküste" }, { op: "place-base", locationId: "shore" }, { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }], env);
  s = ackPending(s, env);
  s = run(s, [{ op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" }], env);
  s = ackPending(s, env);
  s = run(s, [{ op: "explain", text: "Ich habe geteilt.", modality: "typed" }, { op: "skip-stage", stage: "LANG-EN-WATER", reason: "child" }, { op: "skip-stage", stage: "typing", reason: "child" }, { op: "save-log", text: "Tag eins." }, { op: "reflect", optionId: "easy" }], env);
  s = run(s, [{ op: "start-visit" }, { op: "resume-base" }, { op: "answer-math", itemId: "EQ-RETURN", answer: 7, raw: "7", modality: "typed" }], env);
  s = ackPending(s, env);
  s = run(s, [{ op: "skip-stage", stage: "LANG-ES-AGUA", reason: "child" }, { op: "skip-stage", stage: "typing", reason: "child" }, { op: "save-log", text: "Tag zwei." }, { op: "reflect", optionId: "easy" }], env);
  s = run(s, [{ op: "start-visit" }, { op: "resume-base" }, { op: "choose-station", theme: "turtles" }, { op: "typing-check", observed: CH }], env);
  return s;
}

describe("typing errors — per-character mismatches of the final text (never keystrokes)", () => {
  it("records substitutions, omissions and extras per line with a cap", () => {
    deepStrictEqual(typingErrors(["fff jjj"], ["fff hhj"]), [
      { line: 0, kind: "substitute", expected: "j", typed: "h" },
      { line: 0, kind: "substitute", expected: "j", typed: "h" },
    ]);
    deepStrictEqual(typingErrors(["fj"], ["f"]), [{ line: 0, kind: "omit", expected: "j", typed: null }]);
    deepStrictEqual(typingErrors(["fj"], ["fjj"]), [{ line: 0, kind: "extra", expected: null, typed: "j" }]);
    equal(typingErrors(["fff jjj"], ["fff jjj"]).length, 0);
    ok(typingErrors(["a".repeat(100)], ["b".repeat(100)]).length <= 60);
  });
  it("retry items: the line with the most errors on the key first (correct the original), then other lines with the key (fresh checks), at most three", () => {
    const lesson = typingLessonDef(v2, "TYPE-CH-COURSE-1")!;
    const items = typingRetryItems(lesson, "j", typingErrors(lesson.lines, ["fff hhj", "fj fj jf"]));
    deepStrictEqual(items.map((i) => [i.purpose, i.text]), [["correct-original", "fff jjj"], ["fresh-check", "fj fj jf"]]);
    ok(items.length <= MAX_RETRIES);
    equal(typingRetryItems(lesson, "x", []).length, 0, "a key not in the lesson has no retry item");
  });
});

describe("UX-5a — lesson end after a typing round", () => {
  it("names the one pattern with the child's key and the reviewed finger, groups repeats, keeps a clean line as the evidence-backed success", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    const s = run(atTypingCourse(env), [{ op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["fff hhj", "fj fj jf"], seconds: 20, comfort: "ok" }], env);
    const fb = lastLessonFeedback(s, v2)!;
    equal(fb.lesson.kind, "typing");
    equal(fb.pattern?.id, "key:j");
    equal(fb.pattern?.count, 2);
    equal(fb.pattern?.given, "h (2×)");
    equal(fb.pattern?.expected, "j");
    ok(/Zeigefinger rechts/.test(fb.pattern!.correction));
    ok(/Noppe/.test(fb.pattern!.correction), "the anchor key names its bump");
    deepStrictEqual(fb.pattern?.visual, { kind: "key", key: "j", finger: "Zeigefinger rechts", typed: "h" });
    equal(fb.success?.text, "Die Zeile „fj fj jf“ war ganz richtig.");
    equal(fb.unscored.length, 0);
    equal(fb.repair.status, "available");
    equal(fb.repair.items.length, 2);
    equal(fb.close.kind, "pending");
    equal(fb.acknowledged, false);
    // the burst itself keeps its errors; the progression decision is the usual one (repeat)
    const burst = s.typing.course!.bursts[0];
    equal(burst.errors!.length, 2);
    equal(s.typing.course!.decision!.action, "repeat");
  });
  it("a clean round needs no mini-lesson; extras are named but open no focus; rounds without recorded detail are shown as unscored, never invented", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    let s = run(atTypingCourse(env), [{ op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["fff jjj", "fj fj jf"], seconds: 20, comfort: "easy" }], env);
    let fb = lastLessonFeedback(s, v2)!;
    equal(fb.mistakes.length, 0);
    equal(fb.repair.status, "none-needed");
    equal(fb.close.kind, "none-needed");
    equal(fb.success?.text, "Alle 2 Zeilen richtig getippt.");
    equal(s.feedback!.focus.length, 0);
    s = run(s, [{ op: "lesson-feedback-seen", id: fb.id }, { op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["fff jjjj", "fj fj jf"], seconds: 20, comfort: "ok" }], env);
    fb = lastLessonFeedback(s, v2)!;
    equal(fb.mistakes[0].id, "extra:j");
    equal(fb.mistakes[0].focus, null);
    equal(fb.repair.status, "none-needed");
    equal(s.feedback!.focus.length, 0, "an extra character opens no practice focus");
    // a historical round without `errors`
    const legacy = structuredClone(s);
    delete legacy.typing.course!.bursts[1].errors;
    legacy.feedback!.acknowledged = [];
    const lfb = lastLessonFeedback(legacy, v2)!;
    equal(lfb.mistakes.length, 0);
    equal(lfb.unscored[0].id, "no-detail");
    equal(lfb.close.kind, "unscored");
  });
});

describe("UX-5b — explain → retry → close, bounded, recorded apart from the round", () => {
  it("records the worked example before a retry, each retry separately, closes honestly and never touches the round or the progression", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    let s = run(atTypingCourse(env), [{ op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["fff hhj", "fj fj jf"], seconds: 20, comfort: "ok" }], env);
    const fb = lastLessonFeedback(s, v2)!;
    const repairId = fb.repair.repairId!;
    throws(() => applyLearningOp(s, { op: "typing-retry", repairId, retryNo: 1, lineIndex: 0, typed: "fff jjj", seconds: 5 }, env), /worked example comes before/);
    const explained = applyLearningOp(s, { op: "repair-explain", repairId }, env);
    equal(explained.records.supports.filter((r) => r.kind === "mini_lesson").length, 1);
    s = explained.state;
    const again = applyLearningOp(s, { op: "repair-explain", repairId }, env);
    equal(again.records.supports.length, 0, "idempotent");
    throws(() => applyLearningOp(s, { op: "typing-retry", repairId, retryNo: 2, lineIndex: 0, typed: "fff jjj", seconds: 5 }, env), /next retry is 1/);
    throws(() => applyLearningOp(s, { op: "typing-retry", repairId, retryNo: 1, lineIndex: 1, typed: "fj fj jf", seconds: 5 }, env), /does not match/);
    const r1 = applyLearningOp(s, { op: "typing-retry", repairId, retryNo: 1, lineIndex: 0, typed: "fff jjj", seconds: 5 }, env);
    equal(r1.records.samples[0].kind, "typing_retry");
    equal(r1.result.focusErrors, 0);
    s = r1.state;
    const r2 = applyLearningOp(s, { op: "typing-retry", repairId, retryNo: 2, lineIndex: 1, typed: "fj fj jf", seconds: 5 }, env);
    s = r2.state;
    // F3: the last item closes the repair in the same write; a third retry is refused as closed and a late close is an idempotent no-op.
    equal(r2.result.closed, true);
    throws(() => applyLearningOp(s, { op: "typing-retry", repairId, retryNo: 3, lineIndex: 0, typed: "fff jjj", seconds: 5 }, env), /closed/);
    const closed = applyLearningOp(s, { op: "repair-close", repairId, reason: "done" }, env);
    equal(closed.result.repeated, true);
    s = closed.state;
    const repair = s.feedback!.repairs[0];
    equal(repair.outcome, "corrected-with-practice");
    equal(repair.retries.length, 2);
    deepStrictEqual(repair.retries.map((r) => [r.purpose, r.result]), [["correct-original", "correct"], ["fresh-check", "correct"]]);
    equal(lastLessonFeedback(s, v2)!.close.kind, "corrected-with-practice");
    // the first attempt is untouched; retries are not bursts; the progression did not move
    equal(s.typing.course!.bursts.length, 1);
    equal(s.typing.course!.bursts[0].errors!.length, 2);
    equal(s.typing.course!.decision!.action, "repeat");
    // the helped retry alone never retires the focus
    equal(s.feedback!.focus.find((f) => f.id === "typing-key:j")!.status, "open");
    // closing twice is a no-op
    equal(applyLearningOp(s, { op: "repair-close", repairId, reason: "skip" }, env).result.repeated, true);
  });
  it("a still-wrong retry closes as practice-again; moving on without practice closes as skipped; both keep the focus open", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    let s = run(atTypingCourse(env), [{ op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["ddd jjj", "fj fj jf"], seconds: 20, comfort: "hard" }], env);
    let fb = lastLessonFeedback(s, v2)!;
    equal(fb.pattern?.id, "key:f");
    s = run(s, [{ op: "repair-explain", repairId: fb.repair.repairId! }, { op: "typing-retry", repairId: fb.repair.repairId!, retryNo: 1, lineIndex: 0, typed: "ddd jjj", seconds: 5 }, { op: "repair-close", repairId: fb.repair.repairId!, reason: "done" }], env);
    equal(s.feedback!.repairs[0].outcome, "practice-again");
    equal(lastLessonFeedback(s, v2)!.close.kind, "practice-again");
    equal(s.feedback!.focus.find((f) => f.id === "typing-key:f")!.status, "open");
    s = run(s, [{ op: "lesson-feedback-seen", id: fb.id }, { op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["fff jjj", "fj fj jd"], seconds: 20, comfort: "ok" }], env);
    fb = lastLessonFeedback(s, v2)!;
    equal(fb.repair.status, "available");
    s = run(s, [{ op: "lesson-feedback-seen", id: fb.id }], env);
    equal(s.feedback!.repairs[1].outcome, "skipped");
    equal(lastLessonFeedback(s, v2), null);
  });
});

describe("UX-5c — one relevant reminder, grounded, retired only by a later independent check", () => {
  it("shows the typing cue before the next round, omits it on other stages, retires it after a later error-free full round", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    let s = run(atTypingCourse(env), [{ op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["fff hhj", "fj fj jf"], seconds: 20, comfort: "ok" }], env);
    const fb = lastLessonFeedback(s, v2)!;
    s = run(s, [{ op: "lesson-feedback-seen", id: fb.id }], env);
    const view = buildChildView(s, v2, env.settings, env.now());
    ok(isChildView(view, "santiago"));
    equal(view.lastLesson, null);
    equal(view.reminder?.focusId, "typing-key:j");
    ok(/„j“/.test(view.reminder!.cue) && /Zeigefinger rechts/.test(view.reminder!.cue));
    ok(/stattdessen „h“/.test(view.reminder!.grounding), view.reminder!.grounding);
    equal(view.reminder?.openedIn.label, "Besuch 3 — Die Beobachtungsstation");
    // not on the math stage
    const t = run(s, [{ op: "typing-course-continue" }], env);
    equal(buildChildView(t, v2, env.settings, env.now()).reminder, null);
    // a later full round without j errors retires it (the retry alone would not)
    const u = run(s, [{ op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["fff jjj", "fj fj jf"], seconds: 20, comfort: "ok" }], env);
    const f = u.feedback!.focus.find((x) => x.id === "typing-key:j")!;
    equal(f.status, "retired");
    ok(/fehlerfrei/.test(f.retiredBy!));
    const seen = run(u, [{ op: "lesson-feedback-seen", id: lastLessonFeedback(u, v2)!.id }], env);
    equal(buildChildView(seen, v2, env.settings, env.now()).reminder, null);
    // a new mistake on j re-opens the same focus (reopened counter), never a duplicate entry
    const w = run(seen, [{ op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["fff hjj", "fj fj jf"], seconds: 20, comfort: "ok" }], env);
    equal(w.feedback!.focus.filter((x) => x.id === "typing-key:j").length, 1);
    equal(w.feedback!.focus.find((x) => x.id === "typing-key:j")!.reopened, 1);
  });
  it("math: a wrong first answer opens the sharing focus; the reminder appears before the next sharing item and only an independent first-try success retires it", () => {
    const env = makeEnv();
    let s = newMissionState(v2, "santiago", env.now().toISOString());
    s = run(s, [{ op: "start-visit" }, { op: "name-base", name: "Basis" }, { op: "place-base", locationId: "crater" }, { op: "answer-math", itemId: "EQ-ENTRY", answer: 5, raw: "5", modality: "typed" }], env);
    equal(buildChildView(s, v2, env.settings, env.now()).reminder, null, "the focus opens at resolution, not before");
    s = run(s, [{ op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }], env);
    const fb = lastLessonFeedback(s, v2)!;
    equal(fb.lesson.kind, "math");
    equal(fb.mistakes[0].given, "5");
    equal(fb.mistakes[0].expected, "6 pro Forscherin");
    equal(fb.mistakes[0].visual?.kind, "sharing");
    equal(fb.close.kind, "corrected-with-help");
    equal(fb.repair.status, "closed");
    equal(fb.repair.outcome, "corrected-with-practice");
    equal(fb.success?.text, "24 Essenspakete gerecht auf 4 Forscher verteilt — mit Hilfe gelöst.");
    const focus = s.feedback!.focus.find((f) => f.id === "math:sharing")!;
    equal(focus.status, "open");
    ok(/du hattest 5, richtig war 6/.test(focus.evidence));
    s = run(s, [{ op: "lesson-feedback-seen", id: fb.id }], env);
    const view = buildChildView(s, v2, env.settings, env.now());
    equal(view.visit?.stage, "EQ-FRESH");
    equal(view.reminder?.focusId, "math:sharing");
    ok(/gleich viele/.test(view.reminder!.cue));
    // EQ-FRESH solved independently → retired
    s = run(s, [{ op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" }], env);
    equal(s.feedback!.focus.find((f) => f.id === "math:sharing")!.status, "retired");
    const fresh = lastLessonFeedback(s, v2)!;
    equal(fresh.close.kind, "none-needed");
    equal(fresh.success?.text, "35 Essenspakete gerecht auf 5 Forscher verteilt — ohne Hilfe, beim ersten Versuch.");
  });
  it("math: a taught or stopped item opens the focus; an unscored transcript opens nothing and is listed apart", () => {
    const env = makeEnv();
    let s = newMissionState(v2, "santiago", env.now().toISOString());
    s = run(s, [{ op: "start-visit" }, { op: "name-base", name: "Basis" }, { op: "place-base", locationId: "crater" }, { op: "answer-math", itemId: "EQ-ENTRY", answer: null, raw: "sechsundzwanzig?", modality: "spoken", uncertain: true }, { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }], env);
    let fb = lastLessonFeedback(s, v2)!;
    equal(fb.mistakes.length, 0);
    equal(fb.unscored.length, 1);
    equal(fb.unscored[0].given, "„sechsundzwanzig?“");
    equal(s.feedback!.focus.length, 0);
    s = run(s, [{ op: "lesson-feedback-seen", id: fb.id }, { op: "answer-math", itemId: "EQ-FRESH", answer: 5, raw: "5", modality: "typed" }, { op: "answer-math", itemId: "EQ-FRESH", answer: 5, raw: "5", modality: "typed" }, { op: "stop-item", itemId: "EQ-FRESH" }], env);
    fb = lastLessonFeedback(s, v2)!;
    equal(fb.mistakes[0].count, 2);
    equal(fb.close.kind, "practice-again");
    equal(s.feedback!.focus.find((f) => f.id === "math:sharing")!.status, "open");
  });
  it("language: a wrong pick then a right one closes as corrected with practice; the reminder shows only on the next segment of that language and an independent success there retires it", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    let s = atTypingCourse(env);
    s = run(s, [{ op: "typing-course-continue" }, { op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" }], env);
    s = run(s, [{ op: "lesson-feedback-seen", id: lastLessonFeedback(s, v2)!.id }, { op: "skip-stage", stage: "explain", reason: "child" }], env);
    // the Spanish segment from visit 2 was skipped, so no language focus exists yet → no reminder here
    equal(buildChildView(s, v2, env.settings, env.now()).reminder, null);
    s = run(s, [lang("LANG-ES-STATION", "listen", "", "listen"), lang("LANG-ES-STATION", "pick", "agua", "word-choice"), lang("LANG-ES-STATION", "pick", "lámpara", "word-choice"), lang("LANG-ES-STATION", "produce", "necesitamos una lámpara"), lang("LANG-ES-STATION", "reuse", "agua", "word-choice")], env);
    const fb = lastLessonFeedback(s, v2)!;
    equal(fb.lesson.kind, "language");
    equal(fb.mistakes[0].given, "Wasser");
    equal(fb.mistakes[0].expected, "Lampe");
    equal(fb.mistakes[0].visual?.kind, "word");
    equal(fb.close.kind, "corrected-with-practice");
    ok(fb.success && /Necesitamos|necesitamos/.test(fb.success.text));
    equal(s.feedback!.focus.find((f) => f.id === "language:es:lámpara")!.status, "open");
  });
  it("writing (F2): a typed flagged transfer at the loop's final step offers its own bounded repair of the child's sentence; the focus opens; the explanation is recorded before the retry; the close is honest", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    let s = atTypingCourse(env);
    s = run(s, [{ op: "typing-course-continue" }, { op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" }], env);
    s = run(s, [{ op: "lesson-feedback-seen", id: lastLessonFeedback(s, v2)!.id }, { op: "skip-stage", stage: "explain", reason: "child" }, { op: "skip-stage", stage: "LANG-ES-STATION", reason: "child" }, { op: "build-station", spot: "rocks" }, { op: "save-log", text: "Heute steht die Station." }, { op: "revise-log", text: "Heute steht die Station." }, { op: "write-transfer", text: "Morgen zählt sie3 Schildkröten." }], env);
    let fb = lastLessonFeedback(s, v2)!;
    equal(fb.lesson.kind, "writing");
    equal(fb.mistakes.length, 1, "the transfer is the one confirmed mistake (the page had none)");
    equal(fb.repair.status, "available");
    equal(fb.repair.kind, "writing");
    equal(fb.repair.items.length, 2);
    equal(fb.repair.items[0].kind, "sentence");
    equal(fb.repair.retries.length, 0, "the first transfer is NOT relabelled as a retry");
    equal(fb.close.kind, "pending");
    equal(s.feedback!.focus.find((f) => f.id === "spacing:rule")!.status, "open");
    equal(buildChildView(s, v2, env.settings, env.now()).visit?.stage, "summary", "the stage already moved on; the repair runs from the lesson end");
    throws(() => applyLearningOp(s, { op: "writing-retry", repairId: fb.repair.repairId!, retryNo: 1, text: "Morgen zählt sie 3 Schildkröten." }, env), /worked example comes before/);
    s = run(s, [{ op: "repair-explain", repairId: fb.repair.repairId! }], env);
    fb = lastLessonFeedback(s, v2)!;
    equal(fb.repair.status, "open");
    equal(fb.repair.explanation?.recorded, true);
    const r1 = applyLearningOp(s, { op: "writing-retry", repairId: fb.repair.repairId!, retryNo: 1, text: "Morgen zählt sie3 Schildkröten." }, env);
    equal(r1.result.result, "incorrect");
    equal(r1.records.samples[0].kind, "writing_retry");
    s = r1.state;
    const r2 = applyLearningOp(s, { op: "writing-retry", repairId: fb.repair.repairId!, retryNo: 2, text: "Morgen zählt sie 3 Schildkröten." }, env);
    equal(r2.result.result, "correct");
    equal(r2.result.closed, true, "the last item closes the repair in the same write (F3)");
    s = r2.state;
    fb = lastLessonFeedback(s, v2)!;
    equal(fb.repair.status, "closed");
    equal(fb.close.kind, "corrected-with-practice");
    deepStrictEqual(fb.repair.retries.map((r) => [r.purpose, r.result]), [["correct-original", "incorrect"], ["correct-original", "correct"]]);
    ok((s.transfers ?? [])[0].text === "Morgen zählt sie3 Schildkröten." && (s.transfers ?? [])[0].outcome === "flagged", "the original transfer record is untouched");
    equal(s.feedback!.focus.find((f) => f.id === "spacing:rule")!.status, "open", "a helped correction never retires the focus");
    const view = buildChildView(run(s, [{ op: "lesson-feedback-seen", id: fb.id }], env), v2, env.settings, env.now());
    equal(view.visit?.stage, "summary");
    equal(view.reminder, null, "no reminder on the summary stage");
  });
});

describe("the reopenable visit report and the honest partial recap", () => {
  it("one report per visit the content knows; the running visit is partial with its lessons so far; a finished visit carries world changes", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    const s = atTypingCourse(env);
    const reports = buildVisitReports(s, v2);
    deepStrictEqual(reports.map((r) => [r.visit, r.partial, r.ordinal]), [["v1", false, 1], ["v2", false, 2], ["v4", true, 3]]);
    const r1 = reports[0];
    ok(r1.lessons.some((l) => l.lesson.ref === "EQ-ENTRY") && r1.lessons.some((l) => l.lesson.ref === "EQ-FRESH"));
    ok(r1.worldChanges.some((c) => /Basis „Sonnenküste“/.test(c)));
    ok(r1.summary.success !== null);
    const r4 = reports[2];
    equal(r4.finishedAt, null);
    equal(r4.stagesDone, 2);
    equal(r4.stageCount, 12);
    equal(r4.lessons.length, 0);
    const view = buildChildView(s, v2, env.settings, env.now());
    ok(isChildView(view, "santiago"));
    equal(view.reports.length, 3);
  });
  it("a saved row without the feedback key (previous build) is upgraded additively and reads with reports; under the version-1 cap the parked chapter's items are left out, never thrown on", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    const s = run(atTypingCourse(env), [{ op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["fff hhj", "fj fj jf"], seconds: 20, comfort: "ok" }, { op: "typing-course-continue" }, { op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" }], env);
    const legacy = structuredClone(s) as MissionState & { feedback?: unknown };
    delete legacy.feedback;
    const up = upgradeMissionState(legacy, v2, env.now().toISOString());
    equal(up.changed, true);
    deepStrictEqual(up.state.feedback, emptyFeedbackState());
    const capped = buildChildView(up.state, v1, env.settings, env.now());
    ok(isChildView(capped, "santiago"));
    equal(capped.reports.length, 2, "the parked chapter is not reported under the cap");
    equal(capped.lastLesson, null);
    equal(capped.reminder, null);
  });
  it("acknowledging is bounded to the pending lesson; a stray id is refused; focus updates are pure and idempotent", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    const s = run(atTypingCourse(env), [{ op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["fff hhj", "fj fj jf"], seconds: 20, comfort: "ok" }], env);
    throws(() => applyLearningOp(s, { op: "lesson-feedback-seen", id: "typing:TYPE-CH-COURSE-1@nope" }, env), /not pending/);
    const fb = emptyFeedbackState();
    const once = updateTypingFocus(fb, { lessonId: "TYPE-CH-COURSE-1", lines: ["fff jjj"], errors: [{ line: 0, kind: "substitute", expected: "j", typed: "h" }], at: "2026-10-03T10:00:00.000Z", visit: "v4", fingers: v2.typing.course!.fingers });
    const twice = updateTypingFocus(once, { lessonId: "TYPE-CH-COURSE-1", lines: ["fff jjj"], errors: [{ line: 0, kind: "substitute", expected: "j", typed: "h" }], at: "2026-10-03T10:00:00.000Z", visit: "v4", fingers: v2.typing.course!.fingers });
    equal(twice.focus.length, 1);
    equal(twice.focus[0].status, "open");
    equal(reminderFor({ ...s, feedback: twice }, v2, { stage: "typing-course", typingLines: ["fff jjj"], mathKind: null, language: null, languageWords: null })?.focusId, "typing-key:j");
    equal(reminderFor({ ...s, feedback: twice }, v2, { stage: "typing-course", typingLines: ["ddd kkk"], mathKind: null, language: null, languageWords: null }), null, "a lesson without the key gets no cue");
  });
});

// ---------------------------------------------------------------------------
// Independent repair round 1 (2026-10-03): F1–F4 reproduced from candidate/independent/domain-probes.ts,
// plus the source concerns (reminder relevance/retirement, recorded explanations).
// ---------------------------------------------------------------------------

function toWriting(env: OpEnv) {
  let s = atTypingCourse(env);
  s = run(s, [{ op: "typing-course-continue" }, { op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30,2", modality: "typed" }], env);
  s = ackPending(s, env);
  return run(s, [{ op: "skip-stage", stage: "explain", reason: "child" }, { op: "skip-stage", stage: "LANG-ES-STATION", reason: "child" }, { op: "build-station", spot: "rocks" }, { op: "save-log", text: "Heute steht die Station." }, { op: "revise-log", text: "Heute steht die Station." }], env);
}

describe("repair round 1 — F1 spoken spacing stays unscored", () => {
  it("a spoken transfer with sie3 is unscored in the attempt, listed apart, never a mistake, never a focus, never a repair; the close is unscored; the report agrees", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    const result = applyLearningOp(toWriting(env), { op: "write-transfer", text: "Morgen zählt sie3 Schildkröten.", modality: "spoken" }, env);
    deepStrictEqual(result.records.attempts.map((a) => [a.correct, a.evidence]), [[null, "unscored"]]);
    const s = result.state;
    const fb = lastLessonFeedback(s, v2)!;
    equal(fb.mistakes.length, 0);
    equal(fb.unscored.length, 1);
    ok(/Gesprochen/.test(fb.unscored[0].correction));
    equal(fb.repair.status, "none-needed");
    equal(fb.close.kind, "unscored");
    equal(s.feedback!.focus.length, 0, "no spacing focus from transcription");
    equal(s.feedback!.repairs.length, 0);
    const report = buildVisitReports(s, v2).find((r) => r.visit === "v4")!;
    const lesson = report.lessons.find((l) => l.lesson.kind === "writing")!;
    equal(lesson.mistakes.length, 0);
    equal(lesson.close.kind, "unscored");
    const view = buildChildView(s, v2, env.settings, env.now());
    equal(view.reminder, null);
  });
});

describe("repair round 1 — F2 a first terminal error gets a real correction opportunity", () => {
  it("writing: the first typed transfer error is NOT a retry; the offer, the recorded example and two correction attempts exist (see the writing test above); a label written wrong gets the same loop", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    let s = newMissionState(v2, "santiago", env.now().toISOString());
    s = run(s, [{ op: "start-visit" }, { op: "name-base", name: "Sonnenküste" }, { op: "place-base", locationId: "shore" }, { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }], env);
    s = ackPending(s, env);
    s = run(s, [{ op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" }], env);
    s = ackPending(s, env);
    s = run(s, [{ op: "explain", text: "Ich habe geteilt.", modality: "typed" }, { op: "skip-stage", stage: "LANG-EN-WATER", reason: "child" }, { op: "typing-label", taskId: "TYPE-LABEL-BASE", typed: "Sonenküste", seconds: 20 }], env);
    let fb = lastLessonFeedback(s, v2)!;
    equal(fb.lesson.ref, "TYPE-LABEL-BASE");
    equal(fb.mistakes.length, 1);
    equal(fb.repair.status, "available");
    equal(fb.repair.kind, "label");
    equal(fb.repair.items.length, 2);
    equal(fb.repair.items[0].kind, "label");
    equal(fb.repair.retries.length, 0);
    equal(fb.close.kind, "pending");
    equal(buildChildView(s, v2, env.settings, env.now()).visit?.stage, "log");
    s = run(s, [{ op: "repair-explain", repairId: fb.repair.repairId! }], env);
    const r1 = applyLearningOp(s, { op: "typing-retry", repairId: fb.repair.repairId!, retryNo: 1, lineIndex: 0, typed: "Sonnenküste", seconds: 8 }, env);
    equal(r1.result.result, "correct");
    equal(r1.result.closed, true, "a correct attempt closes the repair when only repeat attempts of the same label would remain");
    s = r1.state;
    equal(applyLearningOp(s, { op: "repair-close", repairId: fb.repair.repairId!, reason: "done" }, env).result.repeated, true);
    fb = lastLessonFeedback(s, v2)!;
    equal(fb.close.kind, "corrected-with-practice");
    equal(s.typing.labels[0].typed, "Sonenküste", "the original label record is untouched");
    equal(s.feedback!.focus.length, 0, "a label opens no key focus");
  });
  it("language: a pick still wrong after its two tries offers the same pick again as a repair; its retries are recorded apart from the language records (never ledger evidence)", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    let s = atTypingCourse(env);
    s = run(s, [{ op: "typing-course-continue" }, { op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30,2", modality: "typed" }], env);
    s = ackPending(s, env);
    s = run(s, [{ op: "skip-stage", stage: "explain", reason: "child" }, lang("LANG-ES-STATION", "listen", "", "listen"), lang("LANG-ES-STATION", "pick", "lámpara", "word-choice"), lang("LANG-ES-STATION", "produce", "necesitamos una lámpara"), lang("LANG-ES-STATION", "reuse", "herramientas", "word-choice"), lang("LANG-ES-STATION", "reuse", "semillas", "word-choice")], env);
    let fb = lastLessonFeedback(s, v2)!;
    equal(fb.lesson.kind, "language");
    equal(fb.repair.status, "available");
    equal(fb.repair.kind, "language");
    equal(fb.repair.items[0].kind, "pick");
    equal(fb.repair.items[0].purpose, "correct-original");
    equal(fb.repair.retries.length, 1, "the reviewed second try of the reuse step is the one in-loop retry");
    equal(fb.repair.retries[0].result, "incorrect");
    const recordsBefore = s.language["LANG-ES-STATION"]!.records.length;
    s = run(s, [{ op: "repair-explain", repairId: fb.repair.repairId! }], env);
    const r = applyLearningOp(s, { op: "language-retry", repairId: fb.repair.repairId!, retryNo: 1, stepId: "reuse", response: "agua" }, env);
    equal(r.result.result, "correct");
    equal(r.result.closed, true, "one item → closed in the same write");
    equal(r.records.samples[0].kind, "language_retry");
    s = r.state;
    equal(s.language["LANG-ES-STATION"]!.records.length, recordsBefore, "no language record was added by the retry");
    fb = lastLessonFeedback(s, v2)!;
    equal(fb.close.kind, "corrected-with-practice");
    equal(s.feedback!.focus.find((f) => f.id === "language:es:agua")!.status, "open", "the helped retry never retires the word's focus");
  });
});

describe("repair round 1 — F3 the end of the retries never strands the child", () => {
  it("the last retry closes the repair in the same write; a reload between retries lands on an open repair with its next item; an open repair with nothing left (legacy row) still exposes finish/skip through close", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    let s = run(atTypingCourse(env), [{ op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["fff hhj", "fj fj jf"], seconds: 20, comfort: "ok" }], env);
    const id = lastLessonFeedback(s, v2)!.repair.repairId!;
    s = run(s, [{ op: "repair-explain", repairId: id }, { op: "typing-retry", repairId: id, retryNo: 1, lineIndex: 0, typed: "fff jjj", seconds: 5 }], env);
    const reloaded = lastLessonFeedback(JSON.parse(JSON.stringify(s)), v2)!;
    equal(reloaded.repair.status, "open");
    equal(reloaded.repair.items[reloaded.repair.retries.length]?.purpose, "fresh-check", "after a reload the next item is still there");
    const r2 = applyLearningOp(s, { op: "typing-retry", repairId: id, retryNo: 2, lineIndex: 1, typed: "fj fj jf", seconds: 5 }, env);
    equal(r2.result.closed, true);
    equal(r2.result.outcome, "corrected-with-practice");
    s = r2.state;
    const after = lastLessonFeedback(JSON.parse(JSON.stringify(s)), v2)!;
    equal(after.repair.status, "closed");
    equal(after.close.kind, "corrected-with-practice");
    equal(applyLearningOp(s, { op: "repair-close", repairId: id, reason: "done" }, env).result.repeated, true, "a late close is an idempotent no-op");
    // Legacy row shape from candidate 1: open with all items used but no close → repair-close still works and is the only thing needed.
    const legacy = JSON.parse(JSON.stringify(s)) as MissionState;
    legacy.feedback!.repairs[0].outcome = "open";
    legacy.feedback!.repairs[0].closedAt = null;
    const legacyFb = lastLessonFeedback(legacy, v2)!;
    equal(legacyFb.repair.status, "open");
    equal(legacyFb.repair.remaining, 0);
    const closed = applyLearningOp(legacy, { op: "repair-close", repairId: id, reason: "done" }, env);
    equal(closed.result.outcome, "corrected-with-practice");
  });
});

describe("repair round 1 — F4 ambiguous language work stays unscored in the retries", () => {
  it("wrong pick → right pick → unscored production → continue → right reuse: retries are the same-item pick and the reuse fresh check; the production stays unscored, never an incorrect retry", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    let s = run(atTypingCourse(env), [{ op: "typing-course-continue" }, { op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30,2", modality: "typed" }], env);
    s = ackPending(s, env);
    s = run(s, [{ op: "skip-stage", stage: "explain", reason: "child" }, lang("LANG-ES-STATION", "listen", "", "listen"), lang("LANG-ES-STATION", "pick", "agua", "word-choice"), lang("LANG-ES-STATION", "pick", "lámpara", "word-choice"), lang("LANG-ES-STATION", "produce", "xxxxxxxx"), { op: "language-continue", segmentId: "LANG-ES-STATION", stepId: "produce" }, lang("LANG-ES-STATION", "reuse", "agua", "word-choice")], env);
    const fb = lastLessonFeedback(s, v2)!;
    deepStrictEqual(fb.repair.retries.map((r) => [r.item, r.purpose, r.result]), [["LANG-ES-STATION/pick", "correct-original", "correct"], ["LANG-ES-STATION/reuse", "fresh-check", "correct"]]);
    equal(fb.unscored.length, 1);
    equal(fb.unscored[0].given, "„xxxxxxxx“");
    equal(fb.repair.status, "closed", "no step is still wrong — the in-loop retries are the repair");
    equal(fb.close.kind, "corrected-with-practice");
    const report = buildVisitReports(s, v2).find((r) => r.visit === "v4")!;
    const lesson = report.lessons.find((l) => l.lesson.kind === "language")!;
    deepStrictEqual(lesson.repair.retries.map((r) => r.result), ["correct", "correct"]);
  });
});

describe("repair round 1 — reminder relevance and retirement, recorded explanations", () => {
  it("math: a remainder focus is never answered by a sharing item and vice versa; retirement needs the same kind solved independently", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    let s = run(atTypingCourse(env), [{ op: "typing-course-continue" }, { op: "answer-remainder", itemId: "EQ-STATION", used: 32, remaining: 0, raw: "32,0", modality: "typed" }, { op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30,2", modality: "typed" }], env);
    equal(s.feedback!.focus.find((f) => f.id === "math:remainder")!.status, "open");
    equal(reminderFor(s, v2, { stage: "EQ-RETURN", typingLines: null, mathKind: "sharing", language: null, languageWords: null }), null, "no fallback from remainder to sharing");
    equal(reminderFor(s, v2, { stage: "EQ-STATION", typingLines: null, mathKind: "remainder", language: null, languageWords: null })?.focusId, "math:remainder");
  });
  it("language: the focus names the word; the reminder appears only on a segment that offers that word and a correct answer on another word never retires it; an independent first-try record for the word in a LATER segment does", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    let s = newMissionState(v2, "santiago", env.now().toISOString());
    s = run(s, [{ op: "start-visit" }, { op: "name-base", name: "Basis" }, { op: "place-base", locationId: "shore" }, { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }], env);
    s = ackPending(s, env);
    s = run(s, [{ op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" }], env);
    s = ackPending(s, env);
    s = run(s, [{ op: "explain", text: "Geteilt.", modality: "typed" }, { op: "skip-stage", stage: "LANG-EN-WATER", reason: "child" }, { op: "skip-stage", stage: "typing", reason: "child" }, { op: "save-log", text: "Tag eins." }, { op: "reflect", optionId: "easy" }, { op: "start-visit" }, { op: "resume-base" }, { op: "answer-math", itemId: "EQ-RETURN", answer: 7, raw: "7", modality: "typed" }], env);
    s = ackPending(s, env);
    // Visit 2: agua picked wrong first (then right) → focus language:es:agua; herramientas reuse right.
    s = run(s, [lang("LANG-ES-AGUA", "listen", "", "listen"), lang("LANG-ES-AGUA", "pick", "semillas", "word-choice"), lang("LANG-ES-AGUA", "pick", "agua", "word-choice"), lang("LANG-ES-AGUA", "produce", "necesitamos agua"), lang("LANG-ES-AGUA", "reuse", "herramientas", "word-choice")], env);
    const focus = s.feedback!.focus.find((f) => f.id === "language:es:agua")!;
    equal(focus.status, "open");
    ok(/semillas|Samen/.test(focus.evidence));
    s = ackPending(s, env);
    s = run(s, [{ op: "skip-stage", stage: "typing", reason: "child" }, { op: "save-log", text: "Tag zwei." }, { op: "reflect", optionId: "easy" }, { op: "start-visit" }, { op: "resume-base" }, { op: "choose-station", theme: "turtles" }, { op: "typing-course-continue" }, { op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30,2", modality: "typed" }], env);
    s = ackPending(s, env);
    s = run(s, [{ op: "skip-stage", stage: "explain", reason: "child" }], env);
    const view = buildChildView(s, v2, env.settings, env.now());
    equal(view.visit?.stage, "LANG-ES-STATION");
    equal(view.reminder?.focusId, "language:es:agua", "the station segment offers agua (its reuse step) → the cue is relevant");
    ok(/agua/.test(view.reminder!.cue));
    // lámpara right, production right — but agua not yet checked: the focus stays open.
    s = run(s, [lang("LANG-ES-STATION", "listen", "", "listen"), lang("LANG-ES-STATION", "pick", "lámpara", "word-choice"), lang("LANG-ES-STATION", "produce", "necesitamos una lámpara")], env);
    equal(s.feedback!.focus.find((f) => f.id === "language:es:agua")!.status, "open", "correct work on another word never retires the focus");
    s = run(s, [lang("LANG-ES-STATION", "reuse", "agua", "word-choice")], env);
    const retired = s.feedback!.focus.find((f) => f.id === "language:es:agua")!;
    equal(retired.status, "retired");
    ok(/agua/.test(retired.retiredBy!));
  });
  it("spacing: a later clean transfer retires the focus only without prior help; explanations count as recorded only with a durable support record", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    const s = run(toWriting(env), [{ op: "write-transfer", text: "Morgen zählt sie3 Schildkröten.", modality: "typed" }], env);
    const fb = lastLessonFeedback(s, v2)!;
    equal(fb.repair.explanation?.recorded, false, "nothing shown yet");
    const explained = run(s, [{ op: "repair-explain", repairId: fb.repair.repairId! }], env);
    equal(lastLessonFeedback(explained, v2)!.repair.explanation?.recorded, true);
    // helped vs independent retirement is decided by helpExposed (unit-level: the pure updater)
    const open = updateSpacingFocus(emptyFeedbackState(), { outcome: "flagged", modality: "typed", helpExposed: false, flagged: 1, text: "sie3", at: "2026-10-03T10:00:00.000Z", visit: "v4", lesson: "writing:A" });
    equal(updateSpacingFocus(open, { outcome: "clean", modality: "typed", helpExposed: true, flagged: 0, text: "x 3", at: "2026-10-04T10:00:00.000Z", visit: "v4", lesson: "writing:B" }).focus[0].status, "open", "helped clean transfer keeps it open");
    equal(updateSpacingFocus(open, { outcome: "clean", modality: "spoken", helpExposed: false, flagged: 0, text: "x 3", at: "2026-10-04T10:00:00.000Z", visit: "v4", lesson: "writing:B" }).focus[0].status, "open", "spoken never retires");
    equal(updateSpacingFocus(open, { outcome: "clean", modality: "typed", helpExposed: false, flagged: 0, text: "x 3", at: "2026-10-04T10:00:00.000Z", visit: "v4", lesson: "writing:B" }).focus[0].status, "retired");
    equal(updateSpacingFocus(emptyFeedbackState(), { outcome: "flagged", modality: "spoken", helpExposed: false, flagged: 1, text: "sie3", at: "2026-10-03T10:00:00.000Z", visit: "v4", lesson: "writing:A" }).focus.length, 0, "spoken never opens");
    // math: the explanation is recorded only when a clarification/representation/example support exists on the item
    const env2 = makeEnv();
    let m = newMissionState(v2, "santiago", env2.now().toISOString());
    m = run(m, [{ op: "start-visit" }, { op: "name-base", name: "B" }, { op: "place-base", locationId: "crater" }, { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }], env2);
    equal(lastLessonFeedback(m, v2)!.repair.status, "none-needed");
    let m2 = newMissionState(v2, "santiago", env2.now().toISOString());
    m2 = run(m2, [{ op: "start-visit" }, { op: "name-base", name: "B" }, { op: "place-base", locationId: "crater" }, { op: "answer-math", itemId: "EQ-ENTRY", answer: 5, raw: "5", modality: "typed" }, { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }], env2);
    equal(lastLessonFeedback(m2, v2)!.repair.explanation?.recorded, true, "the clarification support event was written by the first wrong answer");
  });
});

describe("repair round 1 — history retries vs the next repair item", () => {
  it("a language step wrong twice lists the in-task second try as history, but the repair's first item is still the next one", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    let s = atTypingCourse(env);
    s = run(s, [{ op: "typing-course-continue" }, { op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" }], env);
    s = ackPending(s, env);
    s = run(s, [{ op: "skip-stage", stage: "explain", reason: "child" }], env);
    for (const o of [lang("LANG-ES-STATION", "listen", "", "listen"), lang("LANG-ES-STATION", "pick", "lámpara", "word-choice"), lang("LANG-ES-STATION", "produce", "necesitamos una lámpara"), lang("LANG-ES-STATION", "reuse", "herramientas", "word-choice"), lang("LANG-ES-STATION", "reuse", "semillas", "word-choice")]) s = run(s, [o], env);
    let fb = lastLessonFeedback(s, v2)!;
    equal(fb.repair.status, "available");
    equal(fb.repair.retries.length, 1, "the second in-task pick is listed as history");
    equal(fb.repair.used, 0, "nothing recorded on the repair yet");
    equal(fb.repair.items[fb.repair.used]?.kind, "pick", "the next item is the reviewed pick");
    s = run(s, [{ op: "repair-explain", repairId: fb.repair.repairId! }], env);
    const r = applyLearningOp(s, { op: "language-retry", repairId: fb.repair.repairId!, retryNo: 1, stepId: "reuse", response: "agua" }, env);
    equal(r.result.result, "correct");
    equal(r.result.closed, true);
    fb = lastLessonFeedback(r.state, v2)!;
    equal(fb.repair.used, 1);
    equal(fb.repair.retries.length, 2, "history: the in-task try and the repair attempt");
    equal(fb.close.kind, "corrected-with-practice");
  });
});

// ---------------------------------------------------------------------------
// Repair round 2 (independent re-acceptance, 2026-10-03): R2-1 multi-item language repairs, R2-2 unscored never resolves
// ---------------------------------------------------------------------------

function atStationLanguage(env: OpEnv) {
  let s = atTypingCourse(env);
  s = run(s, [{ op: "typing-course-continue" }, { op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" }], env);
  s = ackPending(s, env);
  return run(s, [{ op: "skip-stage", stage: "explain", reason: "child" }], env);
}
const TWO_WRONG_WORDS: LearningOp[] = [lang("LANG-ES-STATION", "listen", "", "listen"), lang("LANG-ES-STATION", "pick", "agua", "word-choice"), lang("LANG-ES-STATION", "pick", "herramientas", "word-choice"), lang("LANG-ES-STATION", "produce", "necesitamos una lámpara"), lang("LANG-ES-STATION", "reuse", "herramientas", "word-choice"), lang("LANG-ES-STATION", "reuse", "semillas", "word-choice")];

describe("repair round 2 — R2-1: every unresolved language item stays reachable with its own cue", () => {
  it("two wrong words: the repair offers both items with their own cues and one attempt each", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    const s = run(atStationLanguage(env), TWO_WRONG_WORDS, env);
    const fb = lastLessonFeedback(s, v2)!;
    equal(fb.repair.status, "available");
    deepStrictEqual(fb.repair.items.map((i) => i.item), ["LANG-ES-STATION/pick", "LANG-ES-STATION/reuse"]);
    equal(fb.repair.items[0].kind === "pick" ? fb.repair.items[0].cue.word : null, "lámpara");
    equal(fb.repair.items[1].kind === "pick" ? fb.repair.items[1].cue.word : null, "agua", "the second item carries the second word's gloss, not the first word's");
    equal(fb.repair.remaining, 2);
    equal(fb.repair.explanation?.title, "lámpara = Lampe");
  });
  it("correcting the first word does NOT close the repair; the second word is the next item; both correct → corrected", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    let s = run(atStationLanguage(env), TWO_WRONG_WORDS, env);
    const id = lastLessonFeedback(s, v2)!.repair.repairId!;
    s = run(s, [{ op: "repair-explain", repairId: id }], env);
    const r1 = applyLearningOp(s, { op: "language-retry", repairId: id, retryNo: 1, stepId: "pick", response: "lámpara" }, env);
    equal(r1.result.result, "correct");
    equal(r1.result.closed, false, "a second unresolved word is not a repeat attempt of the corrected one");
    equal(r1.result.remaining, 1);
    s = r1.state;
    let fb = lastLessonFeedback(s, v2)!;
    equal(fb.repair.status, "open");
    equal(fb.repair.used, 1);
    const next = fb.repair.items[fb.repair.used];
    equal(next?.item, "LANG-ES-STATION/reuse");
    equal(next?.kind === "pick" ? next.cue.word : null, "agua");
    equal(fb.close.kind, "pending");
    const r2 = applyLearningOp(s, { op: "language-retry", repairId: id, retryNo: 2, stepId: "reuse", response: "agua" }, env);
    equal(r2.result.closed, true);
    equal(r2.result.outcome, "corrected-with-practice");
    fb = lastLessonFeedback(r2.state, v2)!;
    equal(fb.close.kind, "corrected-with-practice");
    equal(fb.repair.retries.filter((r) => r.result === "correct").length, 2);
  });
  it("per-item outcomes: a second word still wrong, or never attempted, keeps the honest practice-again", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    let s = run(atStationLanguage(env), TWO_WRONG_WORDS, env);
    const id = lastLessonFeedback(s, v2)!.repair.repairId!;
    s = run(s, [{ op: "repair-explain", repairId: id }, { op: "language-retry", repairId: id, retryNo: 1, stepId: "pick", response: "lámpara" }], env);
    // (a) second item wrong → attempts used up → practice-again
    const wrong = applyLearningOp(s, { op: "language-retry", repairId: id, retryNo: 2, stepId: "reuse", response: "semillas" }, env);
    equal(wrong.result.closed, true);
    equal(wrong.result.outcome, "practice-again");
    equal(lastLessonFeedback(wrong.state, v2)!.close.kind, "practice-again");
    // (b) stopping after the first item → the second word was never corrected → practice-again, never "corrected"
    const stopped = applyLearningOp(s, { op: "repair-close", repairId: id, reason: "done" }, env);
    equal(stopped.result.outcome, "practice-again");
    // (c) first item wrong, second right → the first word stays unresolved → practice-again; the second item was still reachable
    let t = run(atStationLanguage(env), TWO_WRONG_WORDS, env);
    const id2 = lastLessonFeedback(t, v2)!.repair.repairId!;
    t = run(t, [{ op: "repair-explain", repairId: id2 }], env);
    const w1 = applyLearningOp(t, { op: "language-retry", repairId: id2, retryNo: 1, stepId: "pick", response: "agua" }, env);
    equal(w1.result.closed, false);
    equal(lastLessonFeedback(w1.state, v2)!.repair.items[1].item, "LANG-ES-STATION/reuse");
    const c2 = applyLearningOp(w1.state, { op: "language-retry", repairId: id2, retryNo: 2, stepId: "reuse", response: "agua" }, env);
    equal(c2.result.closed, true);
    equal(c2.result.outcome, "practice-again");
    // the focus of each word stays open (helped practice never retires)
    const focus = (c2.state.feedback?.focus ?? []).filter((f) => f.id.startsWith("language:es:"));
    deepStrictEqual(focus.map((f) => [f.id, f.status]).sort(), [["language:es:agua", "open"], ["language:es:lámpara", "open"]]);
  });
  it("a single-focus repair (typing) keeps the last-scored-attempt rule and the fresh check after a correct first retry", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    let s = run(atTypingCourse(env), [{ op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["fff hhj", "fj fj jf"], seconds: 20, comfort: "ok" }], env);
    const id = lastLessonFeedback(s, v2)!.repair.repairId!;
    s = run(s, [{ op: "repair-explain", repairId: id }], env);
    const fb = lastLessonFeedback(s, v2)!;
    const r1 = applyLearningOp(s, { op: "typing-retry", repairId: id, retryNo: 1, lineIndex: (fb.repair.items[0] as { lineIndex: number }).lineIndex, typed: "fff jjj", seconds: 5 }, env);
    equal(r1.result.closed, false, "the fresh check of another line still follows");
    const r2 = applyLearningOp(r1.state, { op: "typing-retry", repairId: id, retryNo: 2, lineIndex: (fb.repair.items[1] as { lineIndex: number }).lineIndex, typed: "fj fj jf", seconds: 5 }, env);
    equal(r2.result.outcome, "corrected-with-practice");
  });
});

describe("repair round 2 — R2-2: an unscored production never resolves the earlier confirmed error", () => {
  const WRONG_THEN_UNSCORED: LearningOp[] = [lang("LANG-ES-STATION", "listen", "", "listen"), lang("LANG-ES-STATION", "pick", "agua", "word-choice"), lang("LANG-ES-STATION", "pick", "lámpara", "word-choice"), lang("LANG-ES-STATION", "produce", "agua"), lang("LANG-ES-STATION", "produce", "xxxxxxxx"), { op: "language-continue", segmentId: "LANG-ES-STATION", stepId: "produce" }, lang("LANG-ES-STATION", "reuse", "agua", "word-choice")];
  it("wrong production, unscored second try, correct pick and reuse → the production is still unresolved and gets its own repair", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    const s = run(atStationLanguage(env), WRONG_THEN_UNSCORED, env);
    const fb = lastLessonFeedback(s, v2)!;
    ok(fb.mistakes.some((m) => m.id.startsWith("produce:")), "the confirmed wrong production stays a mistake");
    equal(fb.unscored.length, 1, "the unclear second try stays unscored");
    equal(fb.repair.status, "available", "unrelated correct items (pick, reuse) do not resolve the production");
    deepStrictEqual(fb.repair.items.map((i) => [i.item, i.kind]), [["LANG-ES-STATION/produce", "produce"]]);
    equal(fb.repair.items[0].kind === "produce" ? fb.repair.items[0].cue.word : null, "lámpara");
    equal(fb.close.kind, "pending");
    equal(s.feedback?.focus.find((f) => f.id === "language:es:lámpara")?.status, "open");
  });
  it("the same-item scored correction closes it as corrected; skipping keeps practice-again and the open focus", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    let s = run(atStationLanguage(env), WRONG_THEN_UNSCORED, env);
    const fb = lastLessonFeedback(s, v2)!;
    const id = fb.repair.repairId!;
    const skipped = run(s, [{ op: "lesson-feedback-seen", id: fb.id }], env);
    equal(skipped.feedback?.repairs.find((r) => r.id === id)?.outcome, "skipped");
    equal(skipped.feedback?.focus.find((f) => f.id === "language:es:lámpara")?.status, "open");
    s = run(s, [{ op: "repair-explain", repairId: id }], env);
    const unclear = applyLearningOp(s, { op: "language-retry", repairId: id, retryNo: 1, stepId: "produce", response: "zzzz" }, env);
    equal(unclear.result.result, "unscored", "an unclear retry stays unscored");
    equal(unclear.result.outcome, "practice-again", "and never counts as the correction");
    const fixed = applyLearningOp(s, { op: "language-retry", repairId: id, retryNo: 1, stepId: "produce", response: "necesitamos una lámpara" }, env);
    equal(fixed.result.result, "correct");
    equal(fixed.result.outcome, "corrected-with-practice");
    equal(lastLessonFeedback(fixed.state, v2)!.close.kind, "corrected-with-practice");
    equal(fixed.state.feedback?.focus.find((f) => f.id === "language:es:lámpara")?.status, "open", "a helped correction never retires the focus");
  });
});

// ---------------------------------------------------------------------------
// Repair round 3 (independent re-acceptance, 2026-10-03): three unresolved language steps, persisted two-item compatibility
// ---------------------------------------------------------------------------

const THREE_WRONG: LearningOp[] = [lang("LANG-ES-STATION", "listen", "", "listen"), lang("LANG-ES-STATION", "pick", "agua", "word-choice"), lang("LANG-ES-STATION", "pick", "herramientas", "word-choice"), lang("LANG-ES-STATION", "produce", "agua"), lang("LANG-ES-STATION", "produce", "agua"), { op: "language-continue", segmentId: "LANG-ES-STATION", stepId: "produce" }, lang("LANG-ES-STATION", "reuse", "herramientas", "word-choice"), lang("LANG-ES-STATION", "reuse", "semillas", "word-choice")];
const PICK = "LANG-ES-STATION/pick";
const PRODUCE = "LANG-ES-STATION/produce";
const REUSE = "LANG-ES-STATION/reuse";
function openedThreeWrong(env: OpEnv) {
  let s = run(atStationLanguage(env), THREE_WRONG, env);
  const id = lastLessonFeedback(s, v2)!.repair.repairId!;
  s = run(s, [{ op: "repair-explain", repairId: id }], env);
  return { s, id };
}
const retryOp = (id: string, no: number, stepId: string, response: string): LearningOp => ({ op: "language-retry", repairId: id, retryNo: no, stepId, response });

describe("repair round 3 — every unresolved language step is reachable (pick, produce, reuse)", () => {
  it("three wrong steps → three items with their own cues, one attempt each", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    const s = run(atStationLanguage(env), THREE_WRONG, env);
    const fb = lastLessonFeedback(s, v2)!;
    equal(fb.repair.status, "available");
    deepStrictEqual(fb.repair.items.map((i) => i.item), [PICK, PRODUCE, REUSE]);
    deepStrictEqual(fb.repair.items.map((i) => (i.kind === "pick" || i.kind === "produce" ? i.cue.word : null)), ["lámpara", "lámpara", "agua"]);
    equal(fb.repair.remaining, 3);
    equal(s.feedback?.repairs.find((r) => r.id === fb.id)?.maxRetries, 3);
    deepStrictEqual(s.feedback?.repairs.find((r) => r.id === fb.id)?.items, [PICK, PRODUCE, REUSE]);
  });
  it("three correct → corrected-with-practice; nothing closes before the third; the focuses stay open", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    const { s, id } = openedThreeWrong(env);
    const r1 = applyLearningOp(s, retryOp(id, 1, "pick", "lámpara"), env);
    equal(r1.result.closed, false);
    const r2 = applyLearningOp(r1.state, retryOp(id, 2, "produce", "necesitamos una lámpara"), env);
    equal(r2.result.closed, false, "the third step (reuse/agua) is still unattempted");
    equal(r2.result.remaining, 1);
    let fb = lastLessonFeedback(r2.state, v2)!;
    equal(fb.repair.status, "open");
    equal(fb.repair.items[fb.repair.used]?.item, REUSE);
    equal(fb.close.kind, "pending");
    const r3 = applyLearningOp(r2.state, retryOp(id, 3, "reuse", "agua"), env);
    equal(r3.result.closed, true);
    equal(r3.result.outcome, "corrected-with-practice");
    fb = lastLessonFeedback(r3.state, v2)!;
    equal(fb.close.kind, "corrected-with-practice");
    equal(fb.repair.used, 3);
    deepStrictEqual((r3.state.feedback?.focus ?? []).filter((f) => f.id.startsWith("language:es:")).map((f) => [f.id, f.status]).sort(), [["language:es:agua", "open"], ["language:es:lámpara", "open"]]);
  });
  it("third wrong, or a step left unscored, or stopping early → practice-again, never corrected; skipping → skipped", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    const { s, id } = openedThreeWrong(env);
    const two = run(s, [retryOp(id, 1, "pick", "lámpara"), retryOp(id, 2, "produce", "necesitamos una lámpara")], env);
    const thirdWrong = applyLearningOp(two, retryOp(id, 3, "reuse", "semillas"), env);
    equal(thirdWrong.result.closed, true);
    equal(thirdWrong.result.outcome, "practice-again");
    equal(lastLessonFeedback(thirdWrong.state, v2)!.close.kind, "practice-again");
    // the produce attempt unscored (unclear), the other two right
    const unclear = run(s, [retryOp(id, 1, "pick", "lámpara"), retryOp(id, 2, "produce", "zzzz")], env);
    equal(lastLessonFeedback(unclear, v2)!.repair.retries.at(-1)?.result, "unscored");
    const afterUnclear = applyLearningOp(unclear, retryOp(id, 3, "reuse", "agua"), env);
    equal(afterUnclear.result.outcome, "practice-again", "an unscored attempt never counts as the correction of its step");
    // stopping after the second: the third was never attempted
    const stopped = applyLearningOp(two, { op: "repair-close", repairId: id, reason: "done" }, env);
    equal(stopped.result.outcome, "practice-again");
    equal(lastLessonFeedback(stopped.state, v2)!.close.kind, "practice-again");
    equal(lastLessonFeedback(stopped.state, v2)!.repair.used, 2, "no fabricated third attempt");
    // skipping at the offer
    const fbId = lastLessonFeedback(s, v2)!.id;
    const skipped = run(s, [{ op: "lesson-feedback-seen", id: fbId }], env);
    equal(skipped.feedback?.repairs.find((r) => r.id === id)?.outcome, "skipped");
    ok((skipped.feedback?.focus ?? []).filter((f) => f.id.startsWith("language:es:")).every((f) => f.status === "open"));
    // a fourth attempt is refused: the loop stays bounded
    const r3 = applyLearningOp(two, retryOp(id, 3, "reuse", "agua"), env);
    throws(() => applyLearningOp(r3.state, retryOp(id, 4, "reuse", "agua"), env), /closed/);
  });
});

describe("repair round 3 — persisted two-item records (rounds 1–2 shape) read back honestly", () => {
  /** A record as round 2 persisted it: two items, maxRetries 2, with three steps unresolved in the segment records. */
  function legacyOpen(env: OpEnv) {
    const { s, id } = openedThreeWrong(env);
    const t = structuredClone(s);
    t.feedback!.repairs = t.feedback!.repairs.map((r) => (r.id === id ? { ...r, items: [PICK, PRODUCE], maxRetries: 2 } : r));
    return { s: t, id };
  }
  it("an OPEN two-item record: the third unresolved step is still offered; two corrections do not close it; the third decides", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    const { s, id } = legacyOpen(env);
    let fb = lastLessonFeedback(s, v2)!;
    deepStrictEqual(fb.repair.items.map((i) => i.item), [PICK, PRODUCE, REUSE]);
    equal(fb.repair.remaining, 3);
    const two = run(s, [retryOp(id, 1, "pick", "lámpara")], env);
    const r2 = applyLearningOp(two, retryOp(id, 2, "produce", "necesitamos una lámpara"), env);
    equal(r2.result.closed, false, "maxRetries 2 of the old record does not close away the third step");
    equal(r2.result.remaining, 1);
    fb = lastLessonFeedback(r2.state, v2)!;
    equal(fb.repair.items[fb.repair.used]?.item, REUSE);
    const r3 = applyLearningOp(r2.state, retryOp(id, 3, "reuse", "agua"), env);
    equal(r3.result.outcome, "corrected-with-practice");
    // stopping after two: the third step is required even though the old record never listed it
    const stopped = applyLearningOp(r2.state, { op: "repair-close", repairId: id, reason: "done" }, env);
    equal(stopped.result.outcome, "practice-again");
  });
  it("a CLOSED two-item record that claimed 'corrected' with the third step never offered reads back as practice-again, attempts preserved", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    const { s, id } = legacyOpen(env);
    const two = run(s, [retryOp(id, 1, "pick", "lámpara"), retryOp(id, 2, "produce", "necesitamos una lámpara")], env);
    const t = structuredClone(two);
    const closedAt = env.now().toISOString();
    t.feedback!.repairs = t.feedback!.repairs.map((r) => (r.id === id ? { ...r, outcome: "corrected-with-practice", closedAt } : r));
    const fb = lastLessonFeedback(t, v2)!;
    equal(fb.repair.status, "closed");
    equal(fb.repair.used, 2, "no fabricated third attempt");
    equal(fb.repair.retries.filter((r) => r.result === "correct").length, 2, "the recorded corrections stay");
    equal(fb.close.kind, "practice-again", "honest readback: reuse/agua was never corrected");
    equal(fb.repair.outcome, "corrected-with-practice", "the persisted outcome itself is not rewritten");
    equal(t.feedback?.focus.find((f) => f.id === "language:es:agua")?.status, "open");
    const report = buildVisitReports(t, v2).find((r) => r.visit === "v4");
    equal(report?.lessons.find((l) => l.id === fb.id)?.close.kind, "practice-again", "the report says the same");
    throws(() => applyLearningOp(t, retryOp(id, 3, "reuse", "agua"), env), /closed/, "a closed record is not reopened");
  });
  it("a round-1 record without `items` and with maxRetries 2 behaves the same (third step offered, honest close)", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    const { s, id } = openedThreeWrong(env);
    const t = structuredClone(s);
    t.feedback!.repairs = t.feedback!.repairs.map((r) => {
      if (r.id !== id) return r;
      const { items: _items, ...rest } = r;
      return { ...rest, maxRetries: 2 };
    });
    equal(lastLessonFeedback(t, v2)!.repair.remaining, 3);
    const two = run(t, [retryOp(id, 1, "pick", "lámpara"), retryOp(id, 2, "produce", "necesitamos una lámpara")], env);
    equal(lastLessonFeedback(two, v2)!.repair.status, "open");
    const stopped = applyLearningOp(two, { op: "repair-close", repairId: id, reason: "done" }, env);
    equal(stopped.result.outcome, "practice-again");
  });
  it("other repair kinds keep their bound: a typing repair still has exactly its two line items", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    let s = run(atTypingCourse(env), [{ op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["fff hhj", "fj fj jf"], seconds: 20, comfort: "ok" }], env);
    const fb = lastLessonFeedback(s, v2)!;
    equal(fb.repair.items.length, 2);
    equal(fb.repair.remaining, 2);
  });
});

// ---------------------------------------------------------------------------
// Repair round 4 (R3-F1): every NEW closure — explicit close, exhausted close and acknowledgment — uses the complete
// current required-item inventory; already-closed history stays immutable while projections stay truthful.
// ---------------------------------------------------------------------------

describe("repair round 4 — acknowledgment closes an open repair with the complete required inventory", () => {
  type Shape = "current" | "two-items" | "no-items";
  type Mode = "repair-close" | "lesson-feedback-seen";
  function shaped(env: OpEnv, shape: Shape) {
    const { s, id } = openedThreeWrong(env);
    const t = structuredClone(s);
    if (shape !== "current") {
      t.feedback!.repairs = t.feedback!.repairs.map((r) => {
        if (r.id !== id) return r;
        if (shape === "two-items") return { ...r, items: [PICK, PRODUCE], maxRetries: 2 };
        const { items: _items, ...rest } = r;
        return { ...rest, maxRetries: 2 };
      });
    }
    return { s: run(t, [retryOp(id, 1, "pick", "lámpara"), retryOp(id, 2, "produce", "necesitamos una lámpara")], env), id };
  }
  /** The persisted boundary: serialise, deserialise and run the real upgrade, as the store does on the next read. */
  const persisted = (state: MissionState, env: OpEnv) => upgradeMissionState(JSON.parse(JSON.stringify(state)) as MissionState, v2, env.now().toISOString()).state;
  for (const shape of ["current", "two-items", "no-items"] as Shape[]) {
    for (const mode of ["repair-close", "lesson-feedback-seen"] as Mode[]) {
      it(`${shape} record, closed by ${mode} after pick and produce were corrected → stored AND read as practice-again, reuse unattempted`, () => {
        const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
        const { s, id } = shaped(env, shape);
        const originals = JSON.stringify(s.language["LANG-ES-STATION"]!.records);
        const closed = run(s, [mode === "repair-close" ? { op: "repair-close", repairId: id, reason: "skip" } : { op: "lesson-feedback-seen", id }], env);
        const p = persisted(closed, env);
        const record = p.feedback!.repairs.find((r) => r.id === id)!;
        equal(record.outcome, "practice-again", "the NEW stored outcome is honest");
        ok(record.closedAt, "closed");
        equal(record.retries.length, 2, "no fabricated third attempt");
        const lesson = buildVisitReports(p, v2).find((r) => r.visit === "v4")!.lessons.find((l) => l.id === id)!;
        equal(lesson.close.kind, "practice-again");
        equal(lesson.repair.outcome, "practice-again", "raw record, child report and parent projection agree");
        deepStrictEqual((p.feedback!.focus ?? []).filter((f) => f.id.startsWith("language:es:")).map((f) => f.status), ["open", "open"], "helped practice never retires a focus");
        equal(JSON.stringify(p.language["LANG-ES-STATION"]!.records), originals, "original attempts untouched");
        equal(record.retries.filter((x) => x.result === "correct").length, 2, "the two recorded corrections are preserved on the record");
        // idempotent: acknowledging (again) or closing again changes nothing and does not reopen
        const ack1 = applyLearningOp(p, { op: "lesson-feedback-seen", id }, env);
        if (mode === "repair-close") equal(ack1.result.repeated, undefined, "after an explicit close the first acknowledgment is a genuine one");
        else equal(ack1.result.repeated, true);
        equal(ack1.state.feedback!.repairs.find((r) => r.id === id)!.outcome, "practice-again");
        equal(applyLearningOp(ack1.state, { op: "lesson-feedback-seen", id }, env).result.repeated, true);
        const closeAgain = applyLearningOp(ack1.state, { op: "repair-close", repairId: id, reason: "done" }, env);
        equal(closeAgain.result.repeated, true);
        equal(closeAgain.state.feedback!.repairs.find((r) => r.id === id)!.outcome, "practice-again");
        throws(() => applyLearningOp(p, retryOp(id, 3, "reuse", "agua"), env), /closed/);
      });
    }
  }
  it("a record ALREADY closed by an earlier round keeps its stored outcome on acknowledgment; the projections stay truthful", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    const { s, id } = shaped(env, "two-items");
    const t = structuredClone(s);
    const closedAt = env.now().toISOString();
    t.feedback!.repairs = t.feedback!.repairs.map((r) => (r.id === id ? { ...r, outcome: "corrected-with-practice", closedAt } : r));
    const acked = run(t, [{ op: "lesson-feedback-seen", id }], env);
    const p = persisted(acked, env);
    const record = p.feedback!.repairs.find((r) => r.id === id)!;
    equal(record.outcome, "corrected-with-practice", "immutable history: not rewritten");
    equal(record.closedAt, closedAt);
    equal(record.retries.length, 2);
    const lesson = buildVisitReports(p, v2).find((r) => r.visit === "v4")!.lessons.find((l) => l.id === id)!;
    equal(lesson.close.kind, "practice-again", "truthful projection");
    ok(p.feedback!.acknowledged.includes(id));
  });
  it("acknowledging a repair that was never started (no attempts) still stores skipped", () => {
    const env = makeEnv({ keyboardLayout: "ch-de-qwertz" });
    const { s, id } = openedThreeWrong(env);
    const p = persisted(run(s, [{ op: "lesson-feedback-seen", id }], env), env);
    equal(p.feedback!.repairs.find((r) => r.id === id)!.outcome, "skipped");
  });
});
