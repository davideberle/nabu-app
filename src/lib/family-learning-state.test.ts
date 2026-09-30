// Teaching, scoring, exposure and recovery rules of the learning cockpit
// (family-assistant/learning/CONTRACT.md; DESIGN §7.6 M1/M2).
// Run with: npm test

import { deepStrictEqual, equal, ok, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  asLearningContent,
  reconcileLearningContent,
  type LearningContent,
} from "./family-learning-content.ts";
import { runTutorTurn } from "./family-learning-tutor.ts";
import {
  applyLearningOp,
  buildChildView,
  buildTutorMessage,
  ensureItemShown,
  EMPTY_PARENT_SETTINGS,
  LearningOpError,
  newMissionState,
  nextVisitAvailability,
  tutorReplyRevealsAnswer,
  type LearningOp,
  type MissionState,
  type OpEnv,
} from "./family-learning-state.ts";

const raw = JSON.parse(
  readFileSync(new URL("../data/family-learning/content/santiago-expedition-v1.json", import.meta.url), "utf8"),
);
const content: LearningContent = asLearningContent(raw);

function makeEnv(start = Date.UTC(2026, 8, 28, 10, 0, 0)): OpEnv & { tick: (ms: number) => void } {
  let t = start;
  let n = 0;
  return {
    content,
    settings: { ...EMPTY_PARENT_SETTINGS },
    now: () => new Date(t),
    newId: () => `id-${(n += 1)}`,
    tick: (ms) => {
      t += ms;
    },
  };
}

function run(state: MissionState, ops: LearningOp[], env: OpEnv) {
  let s = state;
  const results = [];
  for (const op of ops) {
    const out = applyLearningOp(s, op, env);
    s = out.state;
    results.push(out);
  }
  return { state: s, results };
}

describe("content reconciliation by stable ID", () => {
  it("accepts the version-1 inventory with exact counts", () => {
    const r = reconcileLearningContent(raw);
    deepStrictEqual(r.problems, []);
    equal(r.version, 1);
    deepStrictEqual(r.counts, { math: 5, language: 2, typingLessons: 3, typingLabels: 2, typingCourse: 0, visits: 3 });
  });
  it("refuses a wrong answer key and a missing item", () => {
    const broken = JSON.parse(JSON.stringify(raw));
    broken.math.items[0].answer = 5;
    broken.math.items.splice(2, 1);
    const r = reconcileLearningContent(broken);
    equal(r.ok, false);
    ok(r.problems.some((p) => p.includes("24 ÷ 4 is not 5")));
    ok(r.problems.some((p) => p.includes("missing EQ-FRESH")));
  });
});

describe("visit 1 — independent path", () => {
  it("runs entry → fresh → explain → English → typing label → log → reflect with honest evidence", () => {
    const env = makeEnv();
    let state = newMissionState(content, "santiago", env.now().toISOString());
    ({ state } = run(state, [{ op: "start-visit" }, { op: "name-base", name: "Sternwarte" }, { op: "place-base", locationId: "ice" }], env));
    const shown = ensureItemShown(state, content, env.now());
    equal(shown.changed, true);
    equal(shown.records.exposures[0].kind, "shown");
    state = shown.state;
    const entry = applyLearningOp(state, { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }, env);
    equal(entry.result.evidence, "independent");
    equal(entry.records.attempts[0].evidence, "independent");
    state = entry.state;
    state = ensureItemShown(state, content, env.now()).state;
    const fresh = applyLearningOp(state, { op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" }, env);
    equal(fresh.result.evidence, "independent");
    state = fresh.state;
    equal(state.base.supplies["Essenspakete"], 59);
    ({ state } = run(state, [{ op: "explain", text: "Ich habe 35 durch 5 geteilt.", modality: "typed" }], env));
    const view = buildChildView(state, content, env.settings, env.now());
    equal(view.visit?.stage, "LANG-EN-WATER");
    ({ state } = run(
      state,
      [
        { op: "language-step", segmentId: "LANG-EN-WATER", stepId: "listen", response: "", modality: "listen" },
        { op: "language-step", segmentId: "LANG-EN-WATER", stepId: "pick", response: "water", modality: "word-choice" },
        { op: "language-step", segmentId: "LANG-EN-WATER", stepId: "produce", response: "We need water.", modality: "typed" },
        { op: "language-step", segmentId: "LANG-EN-WATER", stepId: "reuse", response: "tools", modality: "word-choice" },
      ],
      env,
    ));
    equal(state.language["LANG-EN-WATER"]!.done, true);
    equal(state.base.supplies.water, 1);
    // No help was recorded in this segment: the typed production is independent.
    const production = state.language["LANG-EN-WATER"]!.records.find((r) => r.stepId === "produce");
    deepStrictEqual(production?.support, []);
    const typingView = buildChildView(state, content, env.settings, env.now());
    equal(typingView.visit?.stage, "typing");
    ok(typingView.typing && typingView.typing.available === false && typingView.typing.reason === "layout-unconfirmed");
    throws(
      () => applyLearningOp(state, { op: "typing-lesson", lessonId: "TYPE-CH-QWERTZ-HOME", lines: ["fff jjj fj fj", "ddd kkk dk dk", "asdf jklö"], seconds: 30 }, env),
      (e: unknown) => e instanceof LearningOpError && e.code === "not-available",
    );
    const label = applyLearningOp(state, { op: "typing-label", taskId: "TYPE-LABEL-BASE", typed: "Sternwarte", seconds: 20 }, env);
    equal(label.result.accuracy, 1);
    state = label.state;
    ({ state } = run(state, [{ op: "save-log", text: "Heute haben wir die Basis gebaut." }, { op: "reflect", optionId: "right" }], env));
    equal(state.currentVisit, null);
    equal(state.pages.length, 1);
    equal(state.pages[0].explanation, "Ich habe 35 durch 5 geteilt.");
    equal(state.visits[0].finishedAt !== null, true);
    // Visit 2 is available immediately; visit 3 waits.
    deepStrictEqual(nextVisitAvailability(state, content, env.now()).visit, "v2");
  });
});

describe("teaching loop and evidence downgrades", () => {
  function toEntry() {
    const env = makeEnv();
    let state = newMissionState(content, "santiago", env.now().toISOString());
    ({ state } = run(state, [{ op: "start-visit" }, { op: "name-base", name: "Basis" }, { op: "place-base", locationId: "crater" }], env));
    state = ensureItemShown(state, content, env.now()).state;
    return { env, state };
  }

  it("clarifies once, then shows the model example, then offers direct teaching", () => {
    const { env, state: s0 } = toEntry();
    const a1 = applyLearningOp(s0, { op: "answer-math", itemId: "EQ-ENTRY", answer: 5, raw: "5", modality: "typed" }, env);
    equal(a1.result.feedback, "clarify");
    equal(a1.records.attempts[0].evidence, "incorrect");
    equal(a1.state.teachingFirstAt, env.now().toISOString());
    const a2 = applyLearningOp(a1.state, { op: "answer-math", itemId: "EQ-ENTRY", answer: 4, raw: "4", modality: "typed" }, env);
    // Second incorrect: the model example is shown (EQ-MODEL exposure recorded)
    // and direct teaching is already on offer.
    equal(a2.result.feedback, "example");
    equal(a2.state.modelShownAt, env.now().toISOString());
    equal(a2.records.exposures[0].taskId, "EQ-MODEL");
    ok(buildChildView(a2.state, content, env.settings, env.now()).math?.teachingOffered);
    const back = applyLearningOp(a2.state, { op: "continue-item", itemId: "EQ-ENTRY" }, env);
    const a3 = applyLearningOp(back.state, { op: "answer-math", itemId: "EQ-ENTRY", answer: 5, raw: "5", modality: "typed" }, env);
    equal(a3.result.feedback, "teach-or-stop");
    // Three substantive attempts are the ceiling: no fourth guess is accepted.
    throws(() => applyLearningOp(a3.state, { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }, env));
    // Teaching could also have been taken right after the example.
    ok(applyLearningOp(a2.state, { op: "request-teaching", itemId: "EQ-ENTRY" }, env).state.math["EQ-ENTRY"]!.outcome === "taught");
    const taught = applyLearningOp(a3.state, { op: "request-teaching", itemId: "EQ-ENTRY" }, env);
    equal(taught.state.math["EQ-ENTRY"]!.exposure, "answer_revealed");
    equal(taught.state.math["EQ-ENTRY"]!.outcome, "taught");
    equal(taught.records.exposures[0].kind, "answer_revealed");
    // A correct answer after the example is supported (example + clarification recorded).
    const a3ok = applyLearningOp(back.state, { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }, env);
    equal(a3ok.result.evidence, "supported");
    ok(a3ok.records.attempts[0].support.includes("example"));
    const view = buildChildView(taught.state, content, env.settings, env.now());
    equal(view.visit?.stage, "EQ-FRESH");
  });

  it("a correct answer after clarification is supported, never independent", () => {
    const { env, state: s0 } = toEntry();
    const a1 = applyLearningOp(s0, { op: "answer-math", itemId: "EQ-ENTRY", answer: 5, raw: "5", modality: "typed" }, env);
    const a2 = applyLearningOp(a1.state, { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }, env);
    equal(a2.result.evidence, "supported");
    ok(a2.records.attempts[0].support.includes("clarification"));
  });

  it("counters make a first-try correct answer supported", () => {
    const { env, state: s0 } = toEntry();
    const a = applyLearningOp(s0, { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "counters" }, env);
    equal(a.result.evidence, "supported");
  });

  it("a tutor question marks the attempt supported; a reply with the answer marks it exposed", () => {
    const { env, state: s0 } = toEntry();
    const q = applyLearningOp(s0, { op: "support", taskId: "EQ-ENTRY", kind: "tutor_question", payload: { text: "Was heisst gerecht?" } }, env);
    const r = applyLearningOp(q.state, { op: "support", taskId: "EQ-ENTRY", kind: "tutor_reply", payload: { text: "Gerecht heisst gleich viele: jede Person bekommt 6 Pakete." } }, env);
    equal(r.state.math["EQ-ENTRY"]!.exposure, "answer_revealed");
    equal(r.records.exposures[0].source, "tutor_reply");
    const a = applyLearningOp(r.state, { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }, env);
    equal(a.result.evidence, "answer_exposed");
    // A reply without the number is only ever "supported".
    const q2 = applyLearningOp(s0, { op: "support", taskId: "EQ-ENTRY", kind: "tutor_question" }, env);
    const r2 = applyLearningOp(q2.state, { op: "support", taskId: "EQ-ENTRY", kind: "tutor_reply", payload: { text: "Teile die Pakete in vier gleich grosse Gruppen." } }, env);
    equal(r2.state.math["EQ-ENTRY"]!.exposure, "shown");
    const a2 = applyLearningOp(r2.state, { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }, env);
    equal(a2.result.evidence, "supported");
  });

  it("read-aloud is recorded but does not downgrade math reasoning", () => {
    const { env, state: s0 } = toEntry();
    const ra = applyLearningOp(s0, { op: "support", taskId: "EQ-ENTRY", kind: "read_aloud" }, env);
    equal(ra.records.supports[0].kind, "read_aloud");
    const a = applyLearningOp(ra.state, { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }, env);
    equal(a.result.evidence, "independent");
  });

  it("an uncertain transcript is unscored and does not consume an attempt", () => {
    const { env, state: s0 } = toEntry();
    const a = applyLearningOp(s0, { op: "answer-math", itemId: "EQ-ENTRY", answer: null, raw: "sechzehn?", modality: "spoken", uncertain: true }, env);
    equal(a.result.evidence, "unscored");
    equal(a.state.math["EQ-ENTRY"]!.phase, "answer");
    const b = applyLearningOp(a.state, { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "spoken" }, env);
    equal(b.result.evidence, "independent");
  });

  it("an item shown in an earlier visit is no longer fresh after a reload next day", () => {
    const env = makeEnv();
    let state = newMissionState(content, "santiago", env.now().toISOString());
    ({ state } = run(state, [{ op: "start-visit" }, { op: "name-base", name: "Basis" }, { op: "place-base", locationId: "crater" }], env));
    state = ensureItemShown(state, content, env.now()).state;
    // Simulate: the item was shown, the child left; the visit is stopped and a
    // later visit re-opens it. We model that by mutating shownVisit to v0.
    const stale = JSON.parse(JSON.stringify(state)) as MissionState;
    stale.math["EQ-ENTRY"]!.shownVisit = "v3";
    const a = applyLearningOp(stale, { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }, env);
    equal(a.result.evidence, "supported");
    equal(a.records.attempts[0].evidence, "supported");
  });

  it("tutorReplyRevealsAnswer is a positive signal only", () => {
    const item = content.math.items[0];
    equal(tutorReplyRevealsAnswer("Es sind 6 pro Person.", item), true);
    equal(tutorReplyRevealsAnswer("Je 6.", item), true);
    equal(tutorReplyRevealsAnswer("Denk an 24 und 4 Gruppen.", item), false);
    equal(tutorReplyRevealsAnswer("Zähle 16 minus zehn.", item), false);
  });
});

describe("stage guards, idempotent resume and delayed check", () => {
  it("refuses out-of-stage operations and supports targeting other tasks", () => {
    const env = makeEnv();
    const state = newMissionState(content, "santiago", env.now().toISOString());
    throws(() => applyLearningOp(state, { op: "name-base", name: "X" }, env), (e: unknown) => e instanceof LearningOpError && e.code === "not-allowed");
    const started = applyLearningOp(state, { op: "start-visit" }, env);
    throws(() => applyLearningOp(started.state, { op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" }, env));
    // Support may name any KNOWN task (a late reply binds to its original item); unknown ids are refused.
    throws(() => applyLearningOp(started.state, { op: "support", taskId: "EQ-NOPE", kind: "gloss" }, env));
    const again = applyLearningOp(started.state, { op: "start-visit" }, env);
    equal(again.result.resumed, true);
    equal(again.state.visits.length, 1);
  });

  it("opens the delayed check only after six real days and records elapsed seconds", () => {
    const env = makeEnv();
    let state = newMissionState(content, "santiago", env.now().toISOString());
    ({ state } = run(state, [{ op: "start-visit" }, { op: "name-base", name: "Basis" }, { op: "place-base", locationId: "shore" }], env));
    state = ensureItemShown(state, content, env.now()).state;
    ({ state } = run(state, [{ op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }], env));
    state = ensureItemShown(state, content, env.now()).state;
    ({ state } = run(
      state,
      [
        { op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" },
        { op: "skip-stage", stage: "explain", reason: "time" },
        { op: "skip-stage", stage: "LANG-EN-WATER", reason: "time" },
        { op: "skip-stage", stage: "typing", reason: "time" },
        { op: "save-log", text: "Kurzer Besuch." },
        { op: "reflect", optionId: "easy" },
      ],
      env,
    ));
    // Visit 2 right away.
    ({ state } = run(state, [{ op: "start-visit" }, { op: "resume-base" }], env));
    equal(state.currentVisit, "v2");
    state = ensureItemShown(state, content, env.now()).state;
    ({ state } = run(
      state,
      [
        { op: "answer-math", itemId: "EQ-RETURN", answer: 7, raw: "7", modality: "typed" },
        { op: "skip-stage", stage: "LANG-ES-AGUA", reason: "child" },
        { op: "skip-stage", stage: "typing", reason: "child" },
        { op: "save-log", text: "Garten angelegt." },
        { op: "reflect", optionId: "right" },
      ],
      env,
    ));
    const waiting = nextVisitAvailability(state, content, env.now());
    equal(waiting.visit, null);
    ok(waiting.availableAt);
    throws(() => applyLearningOp(state, { op: "start-visit" }, env), (e: unknown) => e instanceof LearningOpError && e.code === "not-available");
    env.tick(6 * 24 * 3600 * 1000 + 1000);
    const v3 = applyLearningOp(state, { op: "start-visit" }, env);
    equal(v3.state.currentVisit, "v3");
    let s3 = ensureItemShown(applyLearningOp(v3.state, { op: "resume-base" }, env).state, content, env.now()).state;
    const delay = applyLearningOp(s3, { op: "answer-math", itemId: "EQ-DELAY", answer: 8, raw: "8", modality: "typed" }, env);
    ok((delay.records.attempts[0].secondsSinceTeaching ?? 0) >= 6 * 24 * 3600);
    s3 = delay.state;
    equal(buildChildView(s3, content, env.settings, env.now()).visit?.stage, "log");
  });

  it("typing drills become available once the parent confirms the layout", () => {
    const env = makeEnv();
    env.settings.keyboardLayout = "ch-de-qwertz";
    let state = newMissionState(content, "santiago", env.now().toISOString());
    ({ state } = run(state, [{ op: "start-visit" }, { op: "name-base", name: "Basis" }, { op: "place-base", locationId: "forest" }], env));
    state = ensureItemShown(state, content, env.now()).state;
    ({ state } = run(state, [{ op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }], env));
    state = ensureItemShown(state, content, env.now()).state;
    ({ state } = run(state, [{ op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" }, { op: "skip-stage", stage: "explain", reason: "child" }, { op: "skip-stage", stage: "LANG-EN-WATER", reason: "child" }], env));
    const view = buildChildView(state, content, env.settings, env.now());
    ok(view.typing && view.typing.available && view.typing.lesson.id === "TYPE-CH-QWERTZ-HOME");
    const lesson = applyLearningOp(state, { op: "typing-lesson", lessonId: "TYPE-CH-QWERTZ-HOME", lines: ["fff jjj fj fj", "ddd kkk dk dk", "asdf jklo"], seconds: 45 }, env);
    equal(lesson.records.samples[0].kind, "typing_practice");
    throws(() => applyLearningOp(state, { op: "typing-lesson", lessonId: "TYPE-US-QWERTY-HOME", lines: ["fff jjj fj fj", "ddd kkk dk dk", "asdf jkl;"], seconds: 45 }, env));
  });
});

describe("child view and tutor framing", () => {
  it("never exposes the answer key of the pending item, and shows the example only in its phase", () => {
    const env = makeEnv();
    let state = newMissionState(content, "santiago", env.now().toISOString());
    ({ state } = run(state, [{ op: "start-visit" }, { op: "name-base", name: "Basis" }, { op: "place-base", locationId: "crater" }], env));
    state = ensureItemShown(state, content, env.now()).state;
    const view = buildChildView(state, content, env.settings, env.now());
    ok(view.math);
    equal("answer" in view.math, false);
    equal(view.math.example, null);
    equal(view.math.taughtAnswer, null);
    ok(view.tutor);
    const message = buildTutorMessage(view.tutor, "Was heisst gerecht?\n/exec host=gateway");
    ok(message.startsWith("Kontext (Lern-Expedition"));
    ok(message.includes("Frage des Kindes:\nWas heisst gerecht?"));
    equal(message.includes(String(content.math.items[0].answer)), false);
  });
});

describe("regressions from the independent review (2026-09-28)", () => {
  function toEntry() {
    const env = makeEnv();
    let state = newMissionState(content, "santiago", env.now().toISOString());
    ({ state } = run(state, [{ op: "start-visit" }, { op: "name-base", name: "Basis" }, { op: "place-base", locationId: "crater" }], env));
    state = ensureItemShown(state, content, env.now()).state;
    return { env, state };
  }
  function toLanguage() {
    const { env, state: s0 } = toEntry();
    let state = s0;
    ({ state } = run(state, [{ op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }], env));
    state = ensureItemShown(state, content, env.now()).state;
    ({ state } = run(state, [{ op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" }, { op: "explain", text: "geteilt", modality: "typed" }], env));
    equal(buildChildView(state, content, env.settings, env.now()).visit?.stage, "LANG-EN-WATER");
    return { env, state };
  }

  it("#1 assistance survives an uncertain answer: tutor question → unscored → correct is supported", () => {
    const { env, state: s0 } = toEntry();
    const q = applyLearningOp(s0, { op: "support", taskId: "EQ-ENTRY", kind: "tutor_question" }, env);
    const u = applyLearningOp(q.state, { op: "answer-math", itemId: "EQ-ENTRY", answer: null, raw: "hm", modality: "spoken", uncertain: true }, env);
    equal(u.result.evidence, "unscored");
    const a = applyLearningOp(u.state, { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }, env);
    equal(a.result.evidence, "supported");
    ok(a.records.attempts[0].support.includes("tutor_question"));
    // Counters used on an uncertain attempt also persist.
    const c = applyLearningOp(s0, { op: "answer-math", itemId: "EQ-ENTRY", answer: null, raw: "?", modality: "counters", uncertain: true }, env);
    const c2 = applyLearningOp(c.state, { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }, env);
    equal(c2.result.evidence, "supported");
  });

  it("#2 language evidence derives from recorded help, not client flags", () => {
    const { env, state: s0 } = toLanguage();
    // Gloss recorded server-side; the later step op carries no flags at all.
    const g = applyLearningOp(s0, { op: "support", taskId: "LANG-EN-WATER", kind: "gloss", payload: { word: "need" } }, env);
    deepStrictEqual(g.state.language["LANG-EN-WATER"]!.help.gloss, ["need"]);
    let state = g.state;
    ({ state } = run(state, [
      { op: "language-step", segmentId: "LANG-EN-WATER", stepId: "listen", response: "", modality: "listen" },
      { op: "language-step", segmentId: "LANG-EN-WATER", stepId: "pick", response: "water", modality: "word-choice" },
    ], env));
    const produced = applyLearningOp(state, { op: "language-step", segmentId: "LANG-EN-WATER", stepId: "produce", response: "We need water.", modality: "typed" }, env);
    equal(produced.records.attempts[0].evidence, "supported");
    deepStrictEqual((produced.records.attempts[0].answer as { productionKind: string }).productionKind, "glossed");
    // Tutor question in the segment → supported as well.
    const t = applyLearningOp(s0, { op: "support", taskId: "LANG-EN-WATER", kind: "tutor_question", payload: { text: "what is need" } }, env);
    let s2 = t.state;
    ({ state: s2 } = run(s2, [
      { op: "language-step", segmentId: "LANG-EN-WATER", stepId: "listen", response: "", modality: "listen" },
      { op: "language-step", segmentId: "LANG-EN-WATER", stepId: "pick", response: "water", modality: "word-choice" },
    ], env));
    equal(applyLearningOp(s2, { op: "language-step", segmentId: "LANG-EN-WATER", stepId: "produce", response: "We need water.", modality: "typed" }, env).records.attempts[0].evidence, "supported");
    // Word choices opened → copying; audio heard → repetition.
    const w = applyLearningOp(s0, { op: "support", taskId: "LANG-EN-WATER", kind: "word_choice" }, env);
    let s3 = w.state;
    ({ state: s3 } = run(s3, [
      { op: "language-step", segmentId: "LANG-EN-WATER", stepId: "listen", response: "", modality: "listen" },
      { op: "language-step", segmentId: "LANG-EN-WATER", stepId: "pick", response: "water", modality: "word-choice" },
    ], env));
    const copied = applyLearningOp(s3, { op: "language-step", segmentId: "LANG-EN-WATER", stepId: "produce", response: "We need water.", modality: "typed" }, env);
    equal((copied.records.attempts[0].answer as { productionKind: string }).productionKind, "copying");
    const h = applyLearningOp(s0, { op: "support", taskId: "LANG-EN-WATER", kind: "read_aloud", payload: { text: "We need water for the garden." } }, env);
    let s4 = h.state;
    ({ state: s4 } = run(s4, [
      { op: "language-step", segmentId: "LANG-EN-WATER", stepId: "listen", response: "", modality: "listen" },
      { op: "language-step", segmentId: "LANG-EN-WATER", stepId: "pick", response: "water", modality: "word-choice" },
    ], env));
    equal(s4.language["LANG-EN-WATER"]!.records[0].response, "listened");
    const repeated = applyLearningOp(s4, { op: "language-step", segmentId: "LANG-EN-WATER", stepId: "produce", response: "We need water.", modality: "spoken", transcriptConfirmed: true }, env);
    equal((repeated.records.attempts[0].answer as { productionKind: string }).productionKind, "repetition");
    // An unconfirmed spoken transcript is refused, never scored.
    throws(() => applyLearningOp(s4, { op: "language-step", segmentId: "LANG-EN-WATER", stepId: "produce", response: "We need water.", modality: "spoken" }, env), (e: unknown) => e instanceof LearningOpError && e.code === "invalid");
  });

  it("#4 a late tutor reply binds to the original task even after it advanced", () => {
    const { env, state: s0 } = toEntry();
    const q = applyLearningOp(s0, { op: "support", taskId: "EQ-ENTRY", kind: "tutor_question" }, env);
    const a = applyLearningOp(q.state, { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }, env);
    equal(a.result.evidence, "supported");
    // Stage is now EQ-FRESH; the reply for EQ-ENTRY still lands on EQ-ENTRY.
    const r = applyLearningOp(a.state, { op: "support", taskId: "EQ-ENTRY", kind: "tutor_reply", payload: { text: "Es sind 6.", turnId: "t1" } }, env);
    equal(r.records.supports[0].taskId, "EQ-ENTRY");
    equal(r.state.math["EQ-ENTRY"]!.exposure, "answer_revealed");
    equal(r.state.math["EQ-FRESH"]!.exposure, "none");
    throws(() => applyLearningOp(a.state, { op: "support", taskId: "EQ-NOPE", kind: "tutor_reply" }, env), (e: unknown) => e instanceof LearningOpError && e.code === "invalid");
  });

  it("spoken log entries keep their modality", () => {
    const { env, state: s0 } = toEntry();
    let state = s0;
    ({ state } = run(state, [
      { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" },
    ], env));
    state = ensureItemShown(state, content, env.now()).state;
    ({ state } = run(state, [
      { op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" },
      { op: "skip-stage", stage: "explain", reason: "child" },
      { op: "skip-stage", stage: "LANG-EN-WATER", reason: "child" },
      { op: "skip-stage", stage: "typing", reason: "child" },
    ], env));
    const saved = applyLearningOp(state, { op: "save-log", text: "Gesprochen.", modality: "spoken" }, env);
    equal(saved.records.samples[0].modality, "spoken");
  });
});

describe("regressions from the independent review, round 2 (2026-09-28)", () => {
  function toStage(stage: "LANG-EN-WATER" | "LANG-ES-AGUA" | "typing") {
    const env = makeEnv();
    env.settings.keyboardLayout = "ch-de-qwertz";
    let state = newMissionState(content, "santiago", env.now().toISOString());
    ({ state } = run(state, [{ op: "start-visit" }, { op: "name-base", name: "Fixture" }, { op: "place-base", locationId: "crater" }], env));
    state = ensureItemShown(state, content, env.now()).state;
    ({ state } = run(state, [{ op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }], env));
    state = ensureItemShown(state, content, env.now()).state;
    ({ state } = run(state, [{ op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" }, { op: "skip-stage", stage: "explain", reason: "child" }], env));
    if (stage === "typing") ({ state } = run(state, [{ op: "skip-stage", stage: "LANG-EN-WATER", reason: "child" }], env));
    if (stage === "LANG-ES-AGUA") {
      ({ state } = run(state, [{ op: "skip-stage", stage: "LANG-EN-WATER", reason: "child" }, { op: "skip-stage", stage: "typing", reason: "child" }, { op: "save-log", text: "x" }, { op: "reflect", optionId: "right" }, { op: "start-visit" }, { op: "resume-base" }], env));
      state = ensureItemShown(state, content, env.now()).state;
      ({ state } = run(state, [{ op: "answer-math", itemId: "EQ-RETURN", answer: 7, raw: "7", modality: "typed" }], env));
    }
    equal(buildChildView(state, content, env.settings, env.now()).visit?.stage, stage);
    return { env, state };
  }

  for (const segmentId of ["LANG-EN-WATER", "LANG-ES-AGUA"] as const) {
    it(`R2-1 the actual tutor context for ${segmentId} flows view → runner → state and is recorded`, async () => {
      const { env, state: s0 } = toStage(segmentId);
      let state = s0;
      const view = buildChildView(state, content, env.settings, env.now());
      ok(view.tutor && view.tutor.taskId === `${segmentId}/listen`);
      const bridgeCalls: string[] = [];
      const result = await runTutorTurn(
        {
          recordSupport: async (op, expectedRevision) => {
            equal(expectedRevision, state.revision);
            try {
              state = applyLearningOp(state, op, env).state;
              return { outcome: "applied", revision: state.revision };
            } catch {
              return { outcome: "refused", revision: state.revision };
            }
          },
          currentRevision: () => state.revision,
          ask: async (message) => {
            bridgeCalls.push(message);
            return { ok: true, text: "Das heisst brauchen." };
          },
          newTurnId: () => "turn-x",
          isAlive: () => true,
        },
        view.tutor,
        "Was heisst need?",
      );
      equal(result.status, "answered");
      equal(bridgeCalls.length, 1);
      ok(bridgeCalls[0].includes(`Aufgabe ${segmentId}/listen v1`));
      equal(state.language[segmentId]!.help.tutor, 2);
      // The tutor help now makes every production in this segment supported.
      ({ state } = run(state, [
        { op: "language-step", segmentId, stepId: "listen", response: "", modality: "listen" },
        { op: "language-step", segmentId, stepId: "pick", response: segmentId === "LANG-EN-WATER" ? "water" : "agua", modality: "word-choice" },
      ], env));
      const produced = applyLearningOp(state, { op: "language-step", segmentId, stepId: "produce", response: segmentId === "LANG-EN-WATER" ? "We need water." : "Necesitamos agua.", modality: "typed" }, env);
      equal(produced.records.attempts[0].evidence, "supported");
      ok(produced.records.attempts[0].support.includes("tutor"));
      // An unknown step under a known segment is refused, as is an unknown segment.
      throws(() => applyLearningOp(state, { op: "support", taskId: `${segmentId}/nope`, kind: "tutor_question" }, env));
      throws(() => applyLearningOp(state, { op: "support", taskId: "LANG-XX/listen", kind: "tutor_question" }, env));
    });
  }

  it("R2-1 the math tutor context flows the same way", async () => {
    const env = makeEnv();
    let state = newMissionState(content, "santiago", env.now().toISOString());
    ({ state } = run(state, [{ op: "start-visit" }, { op: "name-base", name: "B" }, { op: "place-base", locationId: "ice" }], env));
    state = ensureItemShown(state, content, env.now()).state;
    const view = buildChildView(state, content, env.settings, env.now());
    const result = await runTutorTurn(
      {
        recordSupport: async (op) => {
          state = applyLearningOp(state, op, env).state;
          return { outcome: "applied", revision: state.revision };
        },
        currentRevision: () => state.revision,
        ask: async () => ({ ok: true, text: "Jede Person bekommt 6." }),
        newTurnId: () => "turn-m",
        isAlive: () => true,
      },
      view.tutor,
      "Wie geht das?",
    );
    equal(result.status, "answered");
    equal(state.math["EQ-ENTRY"]!.exposure, "answer_revealed");
    equal(applyLearningOp(state, { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }, env).result.evidence, "answer_exposed");
  });

  it("R2-4 a retry after an incorrect production (with a serialized reload) is never independent", () => {
    const { env, state: s0 } = toStage("LANG-EN-WATER");
    let state = s0;
    ({ state } = run(state, [
      { op: "language-step", segmentId: "LANG-EN-WATER", stepId: "listen", response: "", modality: "listen" },
      { op: "language-step", segmentId: "LANG-EN-WATER", stepId: "pick", response: "water", modality: "word-choice" },
    ], env));
    const wrong = applyLearningOp(state, { op: "language-step", segmentId: "LANG-EN-WATER", stepId: "produce", response: "lamp", modality: "typed" }, env);
    equal(wrong.records.attempts[0].evidence, "incorrect");
    const reloaded = JSON.parse(JSON.stringify(wrong.state)) as MissionState;
    const retry = applyLearningOp(reloaded, { op: "language-step", segmentId: "LANG-EN-WATER", stepId: "produce", response: "We need water.", modality: "typed" }, env);
    equal(retry.records.attempts[0].attemptNo, 2);
    equal(retry.records.attempts[0].correct, true);
    equal(retry.records.attempts[0].evidence, "supported");
    ok(retry.records.attempts[0].support.includes("retry"));
    // An earlier incorrect recognition pick also counts as feedback for the later production.
    let s2 = s0;
    ({ state: s2 } = run(s2, [
      { op: "language-step", segmentId: "LANG-EN-WATER", stepId: "listen", response: "", modality: "listen" },
      { op: "language-step", segmentId: "LANG-EN-WATER", stepId: "pick", response: "lamp", modality: "word-choice" },
      { op: "language-step", segmentId: "LANG-EN-WATER", stepId: "pick", response: "water", modality: "word-choice" },
    ], env));
    const afterFeedback = applyLearningOp(s2, { op: "language-step", segmentId: "LANG-EN-WATER", stepId: "produce", response: "We need water.", modality: "typed" }, env);
    equal(afterFeedback.records.attempts[0].evidence, "supported");
    ok(afterFeedback.records.attempts[0].support.includes("feedback"));
  });

  it("R2-5 production scoring: phrase, lexical completion, noncanonical → unscored, distractor → incorrect, in both languages", () => {
    const cases = [
      { segmentId: "LANG-EN-WATER" as const, phrase: "We need water.", lexical: "water", noncanonical: "We need fresh water and bread.", distractor: "We need a lamp.", unclear: "Yes please" },
      { segmentId: "LANG-ES-AGUA" as const, phrase: "Necesitamos agua.", lexical: "agua", noncanonical: "Necesitamos mucha agua ahora.", distractor: "Necesitamos una lámpara.", unclear: "Sí" },
    ];
    for (const c of cases) {
      const { env, state: s0 } = toStage(c.segmentId);
      let base = s0;
      ({ state: base } = run(base, [
        { op: "language-step", segmentId: c.segmentId, stepId: "listen", response: "", modality: "listen" },
        { op: "language-step", segmentId: c.segmentId, stepId: "pick", response: c.segmentId === "LANG-EN-WATER" ? "water" : "agua", modality: "word-choice" },
      ], env));
      const score = (response: string) => applyLearningOp(base, { op: "language-step", segmentId: c.segmentId, stepId: "produce", response, modality: "typed" }, env).records.attempts[0];
      const phrase = score(c.phrase);
      equal(phrase.evidence, "independent");
      equal(phrase.objective, `language-${c.segmentId === "LANG-EN-WATER" ? "en" : "es"}-production`);
      const lexical = score(c.lexical);
      equal(lexical.correct, true);
      ok(lexical.objective.endsWith("-completion"), "bare word is lexical completion, not phrase production");
      const non = score(c.noncanonical);
      equal(non.evidence, "unscored");
      equal(non.uncertainty, "noncanonical-pending-clarification");
      const bad = score(c.distractor);
      equal(bad.evidence, "incorrect");
      const unclear = score(c.unclear);
      equal(unclear.evidence, "unscored");
      // A noncanonical response keeps the step open for one clarification try.
      const kept = applyLearningOp(base, { op: "language-step", segmentId: c.segmentId, stepId: "produce", response: c.noncanonical, modality: "typed" }, env);
      equal(kept.state.language[c.segmentId]!.stepIndex, base.language[c.segmentId]!.stepIndex);
    }
  });

  it("R2-6 extra typed characters reduce label and lesson accuracy through the real payloads", () => {
    const { env, state } = toStage("typing");
    const label = applyLearningOp(state, { op: "typing-label", taskId: "TYPE-LABEL-BASE", typed: "FixtureZZZZZ", seconds: 9 }, env);
    equal(label.result.accuracy, 7 / 12);
    deepStrictEqual((label.records.samples[0].metrics as { extraChars: number; typedChars: number }).extraChars, 5);
    const exact = applyLearningOp(state, { op: "typing-label", taskId: "TYPE-LABEL-BASE", typed: "Fixture", seconds: 9 }, env);
    equal(exact.result.accuracy, 1);
    const lesson = applyLearningOp(state, { op: "typing-lesson", lessonId: "TYPE-CH-QWERTZ-HOME", lines: ["fff jjj fj fjZZZZZZZZZZ", "ddd kkk dk dk", "asdf jklö"], seconds: 40 }, env);
    equal(lesson.result.accuracy, 35 / 45);
    // The server computes every metric from the typed lines; a payload with the wrong line count is refused.
    throws(() => applyLearningOp(state, { op: "typing-lesson", lessonId: "TYPE-CH-QWERTZ-HOME", lines: ["fff jjj fj fj"], seconds: 40 }, env));
  });
});

describe("regressions from the independent review, round 3 (2026-09-28)", () => {
  function toStage(stage: "LANG-EN-WATER" | "LANG-ES-AGUA" | "typing", layout: "ch-de-qwertz" | "de-qwertz" | "us-qwerty" = "ch-de-qwertz") {
    const env = makeEnv();
    env.settings.keyboardLayout = layout;
    let state = newMissionState(content, "santiago", env.now().toISOString());
    ({ state } = run(state, [{ op: "start-visit" }, { op: "name-base", name: "Fixture" }, { op: "place-base", locationId: "crater" }], env));
    state = ensureItemShown(state, content, env.now()).state;
    ({ state } = run(state, [{ op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }], env));
    state = ensureItemShown(state, content, env.now()).state;
    ({ state } = run(state, [{ op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" }, { op: "skip-stage", stage: "explain", reason: "child" }], env));
    if (stage === "typing") ({ state } = run(state, [{ op: "skip-stage", stage: "LANG-EN-WATER", reason: "child" }], env));
    if (stage === "LANG-ES-AGUA") {
      ({ state } = run(state, [{ op: "skip-stage", stage: "LANG-EN-WATER", reason: "child" }, { op: "skip-stage", stage: "typing", reason: "child" }, { op: "save-log", text: "x" }, { op: "reflect", optionId: "right" }, { op: "start-visit" }, { op: "resume-base" }], env));
      state = ensureItemShown(state, content, env.now()).state;
      ({ state } = run(state, [{ op: "answer-math", itemId: "EQ-RETURN", answer: 7, raw: "7", modality: "typed" }], env));
    }
    return { env, state };
  }

  for (const c of [
    { segmentId: "LANG-EN-WATER" as const, pick: "water", wrongPick: "lamp", noncanonical: "We need fresh water.", wrong: "We need a lamp.", phrase: "We need water." },
    { segmentId: "LANG-ES-AGUA" as const, pick: "agua", wrongPick: "lámpara", noncanonical: "Necesitamos mucha agua.", wrong: "Necesitamos una lámpara.", phrase: "Necesitamos agua." },
  ]) {
    it(`R3-2 ${c.segmentId}: visible clarification/correction, no silent advance, explicit continue`, () => {
      const { env, state: s0 } = toStage(c.segmentId);
      let state = s0;
      ({ state } = run(state, [{ op: "language-step", segmentId: c.segmentId, stepId: "listen", response: "", modality: "listen" }], env));
      // Incorrect recognition pick shows the reviewed correction and allows one more pick.
      const wrongPick = applyLearningOp(state, { op: "language-step", segmentId: c.segmentId, stepId: "pick", response: c.wrongPick, modality: "word-choice" }, env);
      const pickView = buildChildView(wrongPick.state, content, env.settings, env.now());
      ok(pickView.language?.feedback && pickView.language.feedback.kind === "incorrect" && pickView.language.feedback.message.includes("nicht diese Lieferung"));
      ({ state } = run(state, [{ op: "language-step", segmentId: c.segmentId, stepId: "pick", response: c.pick, modality: "word-choice" }], env));
      // Noncanonical production: unscored, clarification visible, step still open.
      const non = applyLearningOp(state, { op: "language-step", segmentId: c.segmentId, stepId: "produce", response: c.noncanonical, modality: "typed" }, env);
      equal(non.records.attempts[0].evidence, "unscored");
      const view = buildChildView(non.state, content, env.settings, env.now());
      equal(view.language?.step?.id, "produce");
      ok(view.language?.feedback && view.language.feedback.kind === "clarify");
      ok(view.language.feedback.message.includes("Satzanfang"));
      ok(view.language.feedback.continueOffered && view.language.feedback.retryAllowed);
      // The identical answer again is refused, never silently advanced.
      throws(() => applyLearningOp(non.state, { op: "language-step", segmentId: c.segmentId, stepId: "produce", response: c.noncanonical, modality: "typed" }, env), (e: unknown) => e instanceof LearningOpError && /same-answer/.test(e.message));
      equal(non.state.language[c.segmentId]!.stepIndex, state.language[c.segmentId]!.stepIndex);
      // Explicit continuation keeps the unscored record and moves on.
      const cont = applyLearningOp(non.state, { op: "language-continue", segmentId: c.segmentId, stepId: "produce" }, env);
      equal(cont.state.language[c.segmentId]!.stepIndex, state.language[c.segmentId]!.stepIndex + 1);
      equal(cont.records.supports[0].kind, "step_down");
      deepStrictEqual(cont.state.language[c.segmentId]!.records.filter((r) => r.stepId === "produce").map((r) => r.correct), [null]);
      // A canonical phrase after clarification is still scored (supported: retry).
      const fixed = applyLearningOp(non.state, { op: "language-step", segmentId: c.segmentId, stepId: "produce", response: c.phrase, modality: "typed" }, env);
      equal(fixed.records.attempts[0].correct, true);
      equal(fixed.records.attempts[0].evidence, "supported");
      // Incorrect production shows the reviewed correction; continue is offered; a second wrong answer ends the tries.
      const wrong = applyLearningOp(state, { op: "language-step", segmentId: c.segmentId, stepId: "produce", response: c.wrong, modality: "typed" }, env);
      const wrongView = buildChildView(wrong.state, content, env.settings, env.now());
      ok(wrongView.language?.feedback?.kind === "incorrect" && wrongView.language.feedback.message.includes("etwas anderes"));
      const wrong2 = applyLearningOp(wrong.state, { op: "language-step", segmentId: c.segmentId, stepId: "produce", response: c.wrong + " now", modality: "typed" }, env);
      const v2 = buildChildView(wrong2.state, content, env.settings, env.now());
      ok(v2.language?.feedback && v2.language.feedback.retryAllowed === false && v2.language.feedback.continueOffered);
      throws(() => applyLearningOp(state, { op: "language-continue", segmentId: c.segmentId, stepId: "produce" }, env));
    });
  }

  for (const layout of ["ch-de-qwertz", "de-qwertz", "us-qwerty"] as const) {
    it(`R3-5 ${layout}: insertions on one line never cancel omissions on another`, () => {
      const { env, state } = toStage("typing", layout);
      const view = buildChildView(state, content, env.settings, env.now());
      ok(view.typing && view.typing.available);
      const lines = view.typing.lesson.lines;
      const typed = [lines[0] + "ZZ", lines[1].slice(0, -2), lines[2]];
      const r = applyLearningOp(state, { op: "typing-lesson", lessonId: view.typing.lesson.id, lines: typed, seconds: 30 }, env);
      const m = r.records.samples[0].metrics as { correctChars: number; extraChars: number; omittedChars: number; denominator: number; expectedChars: number; lines: unknown[] };
      equal(m.expectedChars, 35);
      equal(m.correctChars, 33);
      equal(m.extraChars, 2);
      equal(m.omittedChars, 2);
      equal(m.denominator, 37);
      equal(m.lines.length, 3);
      equal(r.result.accuracy, 33 / 37);
    });
  }
});
