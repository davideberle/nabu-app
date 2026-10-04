// Visit 4 (content version 3, 2026-10-04) — the pier chapter `v5`: content reconciliation, reachable progression from the
// completed-three-visits fixture, the new tasks' scoring/evidence, the durable world change, the honest closeout and the
// compatibility of saved state under the version-2 cap. Pure state-machine tests; run: npm test

import { deepStrictEqual, equal, ok, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { asLearningContent, EXPECTED_V5_STAGES, reconcileLearningContent, transferDefFor, type LearningContent } from "./family-learning-content.ts";
import { buildVisitReports, lastLessonFeedback, reminderFor } from "./family-learning-feedback.ts";
import { applyLearningOp, buildChildView, EMPTY_PARENT_SETTINGS, ensureItemShown, newMissionState, nextVisitAvailability, upgradeMissionState, type LearningOp, type MissionState, type OpEnv, type ParentSettings } from "./family-learning-state.ts";
import { buildParentReview, buildSceneModel, buildVisitSummary, visitLabel, visitOrdinal } from "./family-learning-summary.ts";
import { asVocabularyInventory, reconcileVocabularyInventory } from "./family-learning-vocabulary.ts";
import { isChildView } from "./family-learning-view-guard.ts";

const rawV2 = JSON.parse(readFileSync(new URL("../data/family-learning/content/santiago-expedition-v2.json", import.meta.url), "utf8"));
const rawV3 = JSON.parse(readFileSync(new URL("../data/family-learning/content/santiago-expedition-v3.json", import.meta.url), "utf8"));
const rawInv1 = JSON.parse(readFileSync(new URL("../data/family-learning/content/vocabulary-inventory-v1.json", import.meta.url), "utf8"));
const rawInv2 = JSON.parse(readFileSync(new URL("../data/family-learning/content/vocabulary-inventory-v2.json", import.meta.url), "utf8"));
const v2: LearningContent = asLearningContent(rawV2);
const v3: LearningContent = asLearningContent(rawV3);

function makeEnv(content: LearningContent, settings: Partial<ParentSettings> = {}, startMs = Date.UTC(2026, 9, 4, 9, 0, 0)): OpEnv & { settings: ParentSettings } {
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
function ackPending(state: MissionState, env: OpEnv): MissionState {
  const pending = lastLessonFeedback(state, env.content);
  return pending ? run(state, [{ op: "lesson-feedback-seen", id: pending.id }], env) : state;
}
const lang = (segmentId: "LANG-EN-WATER" | "LANG-ES-AGUA" | "LANG-ES-STATION" | "LANG-EN-PIER", stepId: string, response: string, modality: "typed" | "word-choice" | "listen" = "typed"): LearningOp => ({ op: "language-step", segmentId, stepId, response, modality });
const CH = ["'", "ö", "z"];

/** Explicitly SYNTHETIC compatibility fixture (no child record): v1, v2 and v4 finished with scripted answers, station built with the lamp, one course round taken. The shape from which Besuch 4 must be offered. */
function threeVisitsDone(env: OpEnv): MissionState {
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
  return s;
}
/** Chapter 4 to the pier task: restore, one course round, continue. */
function toPierMath(env: OpEnv): MissionState {
  let s = threeVisitsDone(env);
  s = run(s, [{ op: "start-visit" }, { op: "resume-base" }, { op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["fff jjj", "fj fj jf"], seconds: 15, comfort: "ok" }], env);
  s = ackPending(s, env);
  return run(s, [{ op: "typing-course-continue" }], env);
}
const ENGLISH_PIER: LearningOp[] = [lang("LANG-EN-PIER", "listen", "", "listen"), lang("LANG-EN-PIER", "pick", "wood", "word-choice"), lang("LANG-EN-PIER", "produce", "we need wood"), lang("LANG-EN-PIER", "reuse", "rope", "word-choice")];
function finishVisit4(env: OpEnv, spot = "bay"): MissionState {
  let s = toPierMath(env);
  s = run(s, [{ op: "answer-remainder", itemId: "EQ-PIER", used: 42, remaining: 3, raw: "42, 3", modality: "typed" }], env);
  s = ackPending(s, env);
  s = run(s, [{ op: "explain", text: "Sechs mal sieben ist 42, drei bleiben.", modality: "typed" }, ...ENGLISH_PIER], env);
  s = ackPending(s, env);
  s = run(s, [{ op: "build-pier", spot }, { op: "save-log", text: "Heute steht der Steg in der Bucht." }, { op: "revise-log", text: "Heute steht der Steg in der Bucht." }, { op: "write-transfer", text: "Morgen bringt das Boot 5 Kisten.", modality: "typed" }], env);
  s = ackPending(s, env);
  return run(s, [{ op: "summary-seen" }, { op: "reflect", optionId: "right" }], env);
}

describe("V4-1 / V4-6 — content version 3 reconciles as a strict additive superset", () => {
  it("version 3 carries exactly the version-2 inventory plus v5, EQ-PIER, LANG-EN-PIER and the second transfer check", () => {
    const r = reconcileLearningContent(rawV3);
    deepStrictEqual(r.problems, []);
    equal(r.version, 3);
    deepStrictEqual(r.counts, { math: 8, language: 4, typingLessons: 3, typingLabels: 2, typingCourse: 5, visits: 5 });
    // every retained entry is byte-identical to version 2 (meaning immutable)
    deepStrictEqual(rawV3.visits.slice(0, 4), rawV2.visits);
    deepStrictEqual(rawV3.math.items.slice(0, 7), rawV2.math.items);
    deepStrictEqual(rawV3.language.segments.slice(0, 3), rawV2.language.segments);
    deepStrictEqual(rawV3.typing, rawV2.typing);
    deepStrictEqual(rawV3.writing.spacing, rawV2.writing.spacing);
    deepStrictEqual(rawV3.writing.transfer, rawV2.writing.transfer);
    deepStrictEqual(rawV3.reflection, rawV2.reflection);
    deepStrictEqual(v3.visits.find((v) => v.id === "v5")!.stages, [...EXPECTED_V5_STAGES]);
    equal(rawV3.reviewed.status, "independently-reviewed-2026-10-04");
    // version 2 still reconciles unchanged
    deepStrictEqual(reconcileLearningContent(rawV2).problems, []);
  });
  it("refuses a version-3 file whose v5 stage list, v4 stage list, pier spots or transfer binding deviate", () => {
    const a = JSON.parse(JSON.stringify(rawV3));
    a.visits[4].stages = a.visits[4].stages.filter((s: string) => s !== "pier-build");
    ok(reconcileLearningContent(a).problems.some((p) => /visit v5: stages must be exactly/.test(p)));
    const b = JSON.parse(JSON.stringify(rawV3));
    b.visits[3].stages.push("pier-build");
    ok(reconcileLearningContent(b).problems.some((p) => /visit v4: stages must be exactly/.test(p)));
    const c = JSON.parse(JSON.stringify(rawV3));
    c.pier.spots = [c.pier.spots[0]];
    ok(reconcileLearningContent(c).problems.some((p) => /pier: at least two reviewed spots/.test(p)));
    const d = JSON.parse(JSON.stringify(rawV3));
    d.writing.transfers[1].id = "WRITE-TRANSFER-9";
    ok(reconcileLearningContent(d).problems.some((p) => /WRITE-TRANSFER-2/.test(p)));
    const e = JSON.parse(JSON.stringify(rawV3));
    e.math.items[7].answers.remaining = 4;
    ok(reconcileLearningContent(e).problems.some((p) => /EQ-PIER: 45 − 42 is not 4/.test(p)));
  });
  it("the vocabulary inventory v2 reconciles against v3 (and against v2 with the pier contexts unserved); v1 stays valid", () => {
    const r3 = reconcileVocabularyInventory(rawInv2, v3);
    deepStrictEqual(r3.problems, []);
    deepStrictEqual(r3.counts, { entries: 17, contexts: 12, served: 12 });
    const r2 = reconcileVocabularyInventory(rawInv2, v2);
    deepStrictEqual(r2.problems, []);
    equal(r2.counts.served, 9);
    deepStrictEqual(reconcileVocabularyInventory(rawInv1, v2).problems, []);
    deepStrictEqual(rawInv2.entries.slice(0, 13), rawInv1.entries);
    // every gloss word of the new segment has an inventory entry
    const seg = v3.language.segments.find((s) => s.id === "LANG-EN-PIER")!;
    const forms = new Set(rawInv2.entries.flatMap((e: { forms: string[] }) => e.forms));
    for (const g of seg.glosses) ok(forms.has(g.word), `gloss ${g.word} has an entry`);
    asVocabularyInventory(rawInv2, v3);
  });
});

describe("V4-2 — reachable progression from the completed-three-visits shape", () => {
  it("offers exactly v5 as 'Besuch 4' after v4, without replay, wait or the retired v3; completion count stays 3 until the new completion", () => {
    const env = makeEnv(v3);
    const s = threeVisitsDone(env);
    deepStrictEqual(nextVisitAvailability(s, v3, env.now()), { visit: "v5", availableAt: null });
    equal(visitOrdinal(s, "v5"), 4);
    equal(visitLabel(s, v3, "v5"), "Besuch 4 — Der Steg in der Bucht");
    const view = buildChildView(s, v3, env.settings, env.now(), 0, { timeZone: "Europe/Zurich" });
    ok(isChildView(view, "santiago"));
    deepStrictEqual(view.next, { visit: "v5", ordinal: 4, availableAt: null, reason: null });
    equal(view.progress.next.kind, "start");
    equal(view.progress.next.visit, "v5");
    equal(view.progress.completedTotal, 3);
    equal(view.nextStep, "Ein neues Kapitel (Besuch 4): der Steg in der Bucht.");
    equal(view.reports.length, 3);
    equal(view.pier?.built, false);
    equal(view.scene.pier.built, false);
  });
  it("earlier shapes are unchanged: empty → v1; two visits → v4; a running v4 resumes; a historical v3 keeps its numbers (v5 = Besuch 5)", () => {
    const env = makeEnv(v3);
    const empty = newMissionState(v3, "santiago", env.now().toISOString());
    equal(nextVisitAvailability(empty, v3, env.now()).visit, "v1");
    let s = newMissionState(v3, "santiago", env.now().toISOString());
    s = run(s, [{ op: "start-visit" }, { op: "name-base", name: "B" }, { op: "place-base", locationId: "shore" }, { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }], env);
    s = ackPending(s, env);
    s = run(s, [{ op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" }], env);
    s = ackPending(s, env);
    s = run(s, [{ op: "explain", text: "x", modality: "typed" }, { op: "skip-stage", stage: "LANG-EN-WATER", reason: "child" }, { op: "skip-stage", stage: "typing", reason: "child" }, { op: "save-log", text: "a" }, { op: "reflect", optionId: "easy" }], env);
    s = run(s, [{ op: "start-visit" }, { op: "resume-base" }, { op: "answer-math", itemId: "EQ-RETURN", answer: 7, raw: "7", modality: "typed" }], env);
    s = ackPending(s, env);
    s = run(s, [{ op: "skip-stage", stage: "LANG-ES-AGUA", reason: "child" }, { op: "skip-stage", stage: "typing", reason: "child" }, { op: "save-log", text: "b" }, { op: "reflect", optionId: "easy" }], env);
    equal(nextVisitAvailability(s, v3, env.now()).visit, "v4");
    s = run(s, [{ op: "start-visit" }, { op: "resume-base" }], env);
    equal(nextVisitAvailability(s, v3, env.now()).visit, "v4", "a running visit always takes precedence");
    const withV3 = structuredClone(threeVisitsDone(env));
    withV3.visits.splice(2, 0, { id: "v3", startedAt: "2026-09-29T15:00:00.000Z", finishedAt: "2026-09-29T15:10:00.000Z", stageIndex: 4, skippedStages: [], reflection: "easy" });
    equal(visitOrdinal(withV3, "v5"), 5);
    equal(visitLabel(withV3, v3, "v4"), "Besuch 4 — Die Beobachtungsstation");
  });
  it("the additive upgrade 2 → 3 adds only `pier`, keeps the pilot upgrade date and is idempotent", () => {
    const env2 = makeEnv(v2);
    // a row as the released build wrote it: content version 2 and no `pier` key
    const { pier: _fresh, ...oldRow } = threeVisitsDone(env2);
    const old = oldRow as MissionState;
    equal(old.contentVersion, 2);
    const up = upgradeMissionState(old, v3, "2026-10-04T10:00:00.000Z");
    equal(up.changed, true);
    equal(up.state.contentVersion, 3);
    equal(up.state.upgradedAt, old.upgradedAt, "the upgrade date of the pilot content is not moved");
    deepStrictEqual(up.state.pier, { spot: null, built: false, builtAt: null, boatMoored: false });
    ok(up.state.math["EQ-PIER"], "the new item's state is prepared");
    ok(up.state.language["LANG-EN-PIER"]);
    const keysBefore = Object.keys(old).sort();
    const keysAfter = Object.keys(up.state).sort();
    deepStrictEqual(keysAfter.filter((k) => !keysBefore.includes(k)), ["pier"]);
    const again = upgradeMissionState(up.state, v3, "2026-10-04T11:00:00.000Z");
    equal(again.changed, false, "a second migration changes nothing");
    deepStrictEqual(nextVisitAvailability(up.state, v3, env2.now()), { visit: "v5", availableAt: null });
    // a mission created directly on version 2 (no pilot upgrade) keeps upgradedAt null across 2 → 3
    equal(old.upgradedAt, null);
    equal(up.state.upgradedAt, null);
  });
});

describe("V4-3 / V4-4 — the new tasks: scoring, evidence, feedback, world change", () => {
  it("EQ-PIER: 42 verbaut, 3 übrig is independent on the first typed attempt; the planks appear in the world; wording says verbaut", () => {
    const env = makeEnv(v3);
    let s = toPierMath(env);
    const view = buildChildView(s, v3, env.settings, env.now());
    equal(view.visit?.stage, "EQ-PIER");
    equal(view.math?.kind, "remainder");
    deepStrictEqual(view.math?.usedWord, { past: "verbaut", label: "Verbaut" });
    equal(view.reminder, null, "no open focus, no reminder");
    const r = applyLearningOp(s, { op: "answer-remainder", itemId: "EQ-PIER", used: 42, remaining: 3, raw: "42, 3", modality: "typed" }, env);
    equal(r.result.correct, true);
    s = r.state;
    const item = s.math["EQ-PIER"]!;
    equal(item.attempts[0].evidence, "independent");
    deepStrictEqual(item.remainderResult, { used: 42, remaining: 3 });
    equal(s.base.supplies.Bretter, 42);
    const scene = buildSceneModel(s, v3);
    deepStrictEqual(scene.pier, { spot: null, built: false, boat: false, sections: 6, planksLeft: 3 });
    const fb = lastLessonFeedback(s, v3)!;
    equal(fb.lesson.kind, "math");
    ok(/42 verbaut, 3 übrig — ohne Hilfe, beim ersten Versuch/.test(fb.success!.text), fb.success!.text);
    equal(fb.close.kind, "none-needed");
  });
  it("EQ-PIER wrong twice shows the shared remainder example (EQ-STATION-MODEL) and keeps original attempts; the focus opens with the verbaut wording", () => {
    const env = makeEnv(v3);
    let s = toPierMath(env);
    s = run(s, [{ op: "answer-remainder", itemId: "EQ-PIER", used: 45, remaining: 0, raw: "45, 0", modality: "typed" }], env);
    equal(s.math["EQ-PIER"]!.phase, "clarify");
    s = run(s, [{ op: "answer-remainder", itemId: "EQ-PIER", used: 40, remaining: 5, raw: "40, 5", modality: "typed" }], env);
    equal(s.math["EQ-PIER"]!.phase, "example");
    ok(s.stationModelShownAt, "the remainder example is recorded as shown");
    const view = buildChildView(s, v3, env.settings, env.now());
    equal(view.math?.example?.quantity, 14, "EQ-STATION-MODEL serves every remainder item");
    s = run(s, [{ op: "continue-item", itemId: "EQ-PIER" }, { op: "answer-remainder", itemId: "EQ-PIER", used: 42, remaining: 3, raw: "42, 3", modality: "typed" }], env);
    const item = s.math["EQ-PIER"]!;
    equal(item.outcome, "correct");
    equal(item.attempts.length, 3);
    equal(item.attempts[2].evidence, "supported");
    deepStrictEqual(item.attempts.map((a) => a.correct), [false, false, true], "original attempts immutable");
    const fb = lastLessonFeedback(s, v3)!;
    equal(fb.mistakes.length, 2);
    equal(fb.mistakes[0].given, "45 verbaut, 0 übrig");
    equal(fb.mistakes[0].expected, "42 verbaut, 3 übrig");
    equal(fb.repair.explanation?.title, "Erst die vollen Abschnitte, dann der Rest");
    equal(fb.close.kind, "corrected-with-help");
    const focus = s.feedback!.focus.find((f) => f.id === "math:remainder")!;
    equal(focus.status, "open");
    ok(/du hattest 45 verbaut, 0 übrig, richtig war 42 verbaut, 3 übrig/.test(focus.evidence), focus.evidence);
  });
  it("an uncertain transcript on EQ-PIER is unscored, never a mistake", () => {
    const env = makeEnv(v3);
    const s = run(toPierMath(env), [{ op: "answer-remainder", itemId: "EQ-PIER", used: null, remaining: null, raw: "zweiundvierzig und so", modality: "spoken", uncertain: true }], env);
    const a = s.math["EQ-PIER"]!.attempts[0];
    equal(a.correct, null);
    equal(a.evidence, "unscored");
    equal(s.feedback!.focus.length, 0);
  });
  it("a relevant remainder focus from the station chapter is reminded at the start of EQ-PIER; an unrelated Spanish word focus is not reminded at the English segment", () => {
    const env = makeEnv(v3);
    let s = threeVisitsDone(env);
    // open a remainder focus and a Spanish word focus directly (as earlier lessons would have)
    s = structuredClone(s);
    s.feedback!.focus.push({ id: "math:remainder", kind: "math", key: "remainder", openedAt: "2026-10-03T09:40:00.000Z", openedIn: { visit: "v4", lesson: "math:EQ-STATION" }, evidence: "Letztes Mal (32 Setzlinge auf 5 Beete): du hattest 32 gepflanzt, 0 übrig, richtig war 30 gepflanzt, 2 übrig.", status: "open", retiredAt: null, retiredBy: null, reopened: 0 });
    s.feedback!.focus.push({ id: "language:es:lámpara", kind: "language", key: "es:lámpara", openedAt: "2026-10-03T09:41:00.000Z", openedIn: { visit: "v4", lesson: "language:LANG-ES-STATION" }, evidence: "Letztes Mal: „lámpara“ heisst Lampe — du hattest Wasser gewählt.", status: "open", retiredAt: null, retiredBy: null, reopened: 0 });
    s = run(s, [{ op: "start-visit" }, { op: "resume-base" }, { op: "skip-stage", stage: "typing-course", reason: "child" }], env);
    const atMath = buildChildView(s, v3, env.settings, env.now());
    equal(atMath.visit?.stage, "EQ-PIER");
    equal(atMath.reminder?.focusId, "math:remainder");
    s = run(s, [{ op: "answer-remainder", itemId: "EQ-PIER", used: 42, remaining: 3, raw: "42, 3", modality: "typed" }], env);
    s = ackPending(s, env);
    equal(s.feedback!.focus.find((f) => f.id === "math:remainder")!.status, "retired", "an independent first-attempt remainder item retires the remainder focus");
    s = run(s, [{ op: "skip-stage", stage: "explain", reason: "child" }], env);
    const atEnglish = buildChildView(s, v3, env.settings, env.now());
    equal(atEnglish.visit?.stage, "LANG-EN-PIER");
    equal(atEnglish.reminder, null, "the Spanish word is not offered by the English segment");
    equal(reminderFor(s, v3, { stage: "LANG-EN-PIER", typingLines: null, mathKind: null, language: "en", languageWords: ["wood", "rope", "pier", "boat", "need"] }), null);
  });
  it("LANG-EN-PIER: the pick delivers wood, 'we need wood' is phrase production, the bare word a lexical completion, a distractor incorrect, 'we need planks' unscored", () => {
    const env = makeEnv(v3);
    let s = toPierMath(env);
    s = run(s, [{ op: "answer-remainder", itemId: "EQ-PIER", used: 42, remaining: 3, raw: "42, 3", modality: "typed" }], env);
    s = ackPending(s, env);
    s = run(s, [{ op: "skip-stage", stage: "explain", reason: "child" }, lang("LANG-EN-PIER", "listen", "", "listen"), lang("LANG-EN-PIER", "pick", "wood", "word-choice")], env);
    equal(s.base.supplies.wood, 1);
    const phrase = applyLearningOp(s, lang("LANG-EN-PIER", "produce", "we need wood"), env);
    const rec = phrase.state.language["LANG-EN-PIER"]!.records.find((r) => r.stepId === "produce")!;
    equal(rec.correct, true);
    equal(rec.evidence, "production");
    equal(rec.support.length, 0);
    const lexical = applyLearningOp(s, lang("LANG-EN-PIER", "produce", "wood"), env);
    equal(lexical.state.language["LANG-EN-PIER"]!.records.find((r) => r.stepId === "produce")!.evidence, "completion");
    const wrong = applyLearningOp(s, lang("LANG-EN-PIER", "produce", "we need water"), env);
    equal(wrong.state.language["LANG-EN-PIER"]!.records.find((r) => r.stepId === "produce")!.correct, false);
    const unclear = applyLearningOp(s, lang("LANG-EN-PIER", "produce", "we need planks"), env);
    equal(unclear.state.language["LANG-EN-PIER"]!.records.find((r) => r.stepId === "produce")!.correct, null);
    s = run(phrase.state, [lang("LANG-EN-PIER", "reuse", "rope", "word-choice")], env);
    equal(s.base.supplies.rope, 1);
    const fb = lastLessonFeedback(s, v3)!;
    equal(fb.lesson.kind, "language");
    ok(/auf Englisch gesagt: „we need wood“ — ohne Hilfe/.test(fb.success!.text), fb.success!.text);
    equal(fb.close.kind, "none-needed");
  });
  it("the pier is built only at the pier-build stage, at a reviewed spot, once; the boat moors only with wood supplied; the change is durable and attributed to this visit", () => {
    const env = makeEnv(v3);
    let s = toPierMath(env);
    throws(() => applyLearningOp(s, { op: "build-pier", spot: "bay" }, env), /stage is not active|not active/);
    s = run(s, [{ op: "answer-remainder", itemId: "EQ-PIER", used: 42, remaining: 3, raw: "42, 3", modality: "typed" }], env);
    s = ackPending(s, env);
    s = run(s, [{ op: "skip-stage", stage: "explain", reason: "child" }, { op: "skip-stage", stage: "LANG-EN-PIER", reason: "child" }], env);
    equal(buildChildView(s, v3, env.settings, env.now()).visit?.stage, "pier-build");
    throws(() => applyLearningOp(s, { op: "build-pier", spot: "cliff" }, env), /unknown pier spot/);
    const built = applyLearningOp(s, { op: "build-pier", spot: "beach" }, env);
    deepStrictEqual(built.result, { spot: "beach", boatMoored: false });
    const scene = buildSceneModel(built.state, v3);
    deepStrictEqual(scene.pier, { spot: "beach", built: true, boat: false, sections: 6, planksLeft: 3 });
    throws(() => applyLearningOp(built.state, { op: "build-pier", spot: "bay" }, env), /stage is not active|not active|already built/);
    // with wood: the boat moors
    let w = toPierMath(env);
    w = run(w, [{ op: "answer-remainder", itemId: "EQ-PIER", used: 42, remaining: 3, raw: "42, 3", modality: "typed" }], env);
    w = ackPending(w, env);
    w = run(w, [{ op: "skip-stage", stage: "explain", reason: "child" }, ...ENGLISH_PIER], env);
    w = ackPending(w, env);
    const view = buildChildView(w, v3, env.settings, env.now());
    equal(view.pier?.woodAvailable, true);
    w = run(w, [{ op: "build-pier", spot: "bay" }], env);
    equal(buildSceneModel(w, v3).pier.boat, true);
    const report = buildVisitReports(w, v3).find((r) => r.visit === "v5")!;
    equal(report.partial, true);
    ok(report.worldChanges.includes("Steg gebaut — das Boot hat angelegt."), report.worldChanges.join("|"));
    ok(report.worldChanges.includes("6 Steg-Abschnitte mit Brettern belegt, 3 Bretter übrig."), report.worldChanges.join("|"));
    ok(report.worldChanges.includes("Lieferung erhalten: Holz."));
  });
  it("the second transfer check WRITE-TRANSFER-2 is the one served in v5 (v4 keeps WRITE-TRANSFER-1); skipping it is recorded under its own id", () => {
    equal(transferDefFor(v3, "v4")!.id, "WRITE-TRANSFER-1");
    equal(transferDefFor(v3, "v5")!.id, "WRITE-TRANSFER-2");
    equal(transferDefFor(v2, "v4")!.id, "WRITE-TRANSFER-1");
    equal(transferDefFor(v2, "v5"), null);
    const env = makeEnv(v3);
    let s = toPierMath(env);
    s = run(s, [{ op: "answer-remainder", itemId: "EQ-PIER", used: 42, remaining: 3, raw: "42, 3", modality: "typed" }], env);
    s = ackPending(s, env);
    s = run(s, [{ op: "skip-stage", stage: "explain", reason: "child" }, { op: "skip-stage", stage: "LANG-EN-PIER", reason: "child" }, { op: "build-pier", spot: "bay" }, { op: "save-log", text: "Der Steg steht." }, { op: "revise-log", text: "Der Steg steht." }], env);
    const view = buildChildView(s, v3, env.settings, env.now());
    equal(view.visit?.stage, "log-transfer");
    equal(view.transfer?.id, "WRITE-TRANSFER-2");
    ok(/wie viele davon/.test(view.transfer!.prompt));
    const skipped = run(s, [{ op: "skip-stage", stage: "log-transfer", reason: "child" }], env);
    equal(skipped.transfers!.at(-1)!.id, "WRITE-TRANSFER-2");
    equal(skipped.transfers!.at(-1)!.outcome, "skipped");
    const written = run(s, [{ op: "write-transfer", text: "Morgen bringt das Boot 5 Kisten.", modality: "typed" }], env);
    const t = written.transfers!.at(-1)!;
    equal(t.id, "WRITE-TRANSFER-2");
    equal(t.outcome, "clean");
    equal(t.assessed, 2, "Boot 5 and 5 Kisten: two reviewed digit boundaries");
  });
});

describe("V4-5 / V4-6 — closeout, honest next step, parent review, cap compatibility", () => {
  it("finishing v5 counts the fourth completion, opens a complete report with the pier artifact, and the next step promises no fifth visit", () => {
    const env = makeEnv(v3);
    const s = finishVisit4(env);
    equal(s.visits.filter((v) => v.finishedAt).length, 4);
    deepStrictEqual(nextVisitAvailability(s, v3, env.now()), { visit: null, availableAt: null, reason: "all-visits-done" });
    const view = buildChildView(s, v3, env.settings, env.now(), 0, { timeZone: "Europe/Zurich" });
    ok(isChildView(view, "santiago"));
    equal(view.progress.completedTotal, 4);
    equal(view.progress.next.reason, "all-visits-done");
    equal(view.nextStep, "Alle Besuche sind geschafft.");
    const report = view.reports.find((r) => r.visit === "v5")!;
    equal(report.partial, false);
    equal(report.ordinal, 4);
    equal(report.label, "Besuch 4 — Der Steg in der Bucht");
    equal(report.summary.artifact.kind, "revision", "the revised page outranks the pier as the visit's artifact; the pier is a world change");
    ok(report.worldChanges.some((c) => c.startsWith("Steg gebaut")));
    ok(report.lessons.some((l) => l.lesson.ref === "EQ-PIER"));
    ok(report.lessons.some((l) => l.lesson.ref === "LANG-EN-PIER"));
    ok(!/Besuch 5/.test(report.summary.next.text), report.summary.next.text);
    const summary = buildVisitSummary(s, v3, "v5");
    ok(/42 verbaut, 3 übrig/.test(summary.success!.text), summary.success!.text);
    const review = buildParentReview(s, v3, "v5", null, { historical: false, contentVersion: 3, telemetryBatches: 0, lessons: report.lessons });
    equal(review.identity.visit, "v5");
    ok((review.learning.lessons ?? []).length >= 2);
    // the station artifact of v4 is untouched by the pier
    const r4 = buildVisitSummary(s, v3, "v4");
    ok(r4.artifact.kind !== "pier");
    equal(buildSceneModel(s, v3).station.built, true);
  });
  it("under the version-2 cap a running v5 is parked untouched and a finished v5 is counted; nothing is rewritten and no v5 record is lost", () => {
    const env = makeEnv(v3);
    const running = run(toPierMath(env), [], env);
    const capped = makeEnv(v2);
    deepStrictEqual(nextVisitAvailability(running, v2, capped.now()), { visit: null, availableAt: null, reason: "chapter-unavailable" });
    const parkedView = buildChildView(running, v2, capped.settings, capped.now(), 0, { timeZone: "Europe/Zurich" });
    ok(isChildView(parkedView, "santiago"));
    equal(parkedView.visit, null);
    equal(parkedView.progress.next.reason, "chapter-unavailable");
    equal(parkedView.progress.completedTotal, 3);
    throws(() => applyLearningOp(running, { op: "start-visit" }, capped), /chapter-unavailable/);
    throws(() => applyLearningOp(running, { op: "answer-remainder", itemId: "EQ-PIER", used: 42, remaining: 3, raw: "42, 3", modality: "typed" }, capped));
    const up = upgradeMissionState(running, v2, capped.now().toISOString());
    equal(up.changed, false, "a lower served version never rewrites the saved shape");
    equal(up.state.contentVersion, 3);
    // the same rows read with version 3 again resume exactly
    equal(buildChildView(running, v3, env.settings, env.now()).visit?.stage, "EQ-PIER");
    const done = finishVisit4(env);
    const doneCapped = buildChildView(done, v2, capped.settings, capped.now(), 0, { timeZone: "Europe/Zurich" });
    ok(isChildView(doneCapped, "santiago"));
    equal(doneCapped.progress.completedTotal, 4);
    equal(doneCapped.progress.next.reason, "all-visits-done");
    equal(doneCapped.reports.length, 3, "the capped content cannot narrate v5, but every row stays readable");
    equal(doneCapped.scene.pier.built, true, "the saved world keeps the pier the child built; only the chapter narration needs version 3");
    equal(doneCapped.scene.pier.sections, 0, "version-2 content cannot describe the pier's sections");
    equal(done.pier!.built, true);
  });
});
