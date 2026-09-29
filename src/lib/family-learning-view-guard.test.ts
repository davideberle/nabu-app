// Runtime ChildView contract guard (independent M3 r2 review, 2026-09-29).
// Run with: npm test

import { equal } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { asLearningContent, type LearningContent } from "./family-learning-content.ts";
import { applyLearningOp, buildChildView, ensureItemShown, EMPTY_PARENT_SETTINGS, newMissionState, type LearningOp, type MissionState, type OpEnv } from "./family-learning-state.ts";
import { isChildView, isLanguageStepView, isMathItemView, isTypingView } from "./family-learning-view-guard.ts";

const raw = JSON.parse(readFileSync(new URL("../data/family-learning/content/santiago-expedition-v1.json", import.meta.url), "utf8"));
const content: LearningContent = asLearningContent(raw);

function env(layout: "ch-de-qwertz" | null = null): OpEnv {
  let n = 0;
  const t = Date.UTC(2026, 8, 29, 10, 0, 0);
  return { content, settings: { ...EMPTY_PARENT_SETTINGS, keyboardLayout: layout }, now: () => new Date(t), newId: () => `id-${(n += 1)}` };
}
function run(state: MissionState, ops: LearningOp[], e: OpEnv): MissionState {
  return ops.reduce((s, op) => applyLearningOp(s, op, e).state, state);
}

describe("isChildView — real views built by the state machine pass", () => {
  it("fresh, started, named, placed and math-shown views are all valid", () => {
    const e = env();
    let state = newMissionState(content, "santiago", e.now().toISOString());
    const views = [buildChildView(state, content, e.settings, e.now())];
    state = run(state, [{ op: "start-visit" }], e);
    views.push(buildChildView(state, content, e.settings, e.now()));
    state = run(state, [{ op: "name-base", name: "Guard Basis" }], e);
    views.push(buildChildView(state, content, e.settings, e.now()));
    state = run(state, [{ op: "place-base", locationId: content.locations[0].id }], e);
    state = ensureItemShown(state, content, e.now()).state;
    const mathView = buildChildView(state, content, e.settings, e.now());
    views.push(mathView);
    for (const v of views) {
      equal(isChildView(v), true);
      equal(isChildView(v, "santiago"), true);
      equal(isChildView(v, "isabel"), false, "child mismatch is never accepted");
    }
    equal(mathView.math !== null && isMathItemView(mathView.math), true);
    // A JSON round trip (what the browser actually receives) is still valid.
    equal(isChildView(JSON.parse(JSON.stringify(mathView)), "santiago"), true);
  });

  it("nested discriminated shapes: language steps and typing views", () => {
    equal(isLanguageStepView({ id: "s1", kind: "listen-read", sentence: "We need water.", instruction: "Hör zu." }), true);
    equal(isLanguageStepView({ id: "s2", kind: "pick-supply", sentence: "x", instruction: "y", options: [{ id: "water", label: "Wasser", emoji: "💧" }] }), true);
    equal(isLanguageStepView({ id: "s3", kind: "produce", instruction: "y", frame: "We need ___.", target: "We need water.", choices: ["water", "tools"] }), true);
    equal(isLanguageStepView({ id: "s4", kind: "produce", instruction: "y" }), false, "produce without frame/target/choices");
    equal(isLanguageStepView({ id: "s5", kind: "unknown", instruction: "y" }), false);
    const label = { taskId: "TYPE-LABEL-BASE", instruction: "Tipp das Schild", target: "Basis" };
    equal(isTypingView({ available: false, reason: "layout-unconfirmed", label }), true);
    equal(isTypingView({ available: false, reason: "layout-unconfirmed", label: null }), true);
    equal(isTypingView({ available: true, lesson: { id: "L", title: "T", layout: "ch-de-qwertz", homeRow: ["a"], fingers: { a: "left-pinky" }, lines: ["asdf"] }, label, lessonDone: false }), true);
    equal(isTypingView({ available: true, label, lessonDone: false }), false, "available without a lesson");
    equal(isTypingView({ available: false, reason: "other", label: null }), false);
  });
});

describe("isChildView — the independent reviewer's exact malformed probes and neighbours are rejected", () => {
  it("a matching child alone is not a view", () => {
    equal(isChildView({ child: "santiago" }, "santiago"), false);
    equal(isChildView({ child: "santiago", prepared: false, view: { child: "santiago" } }, "santiago"), false);
  });
  it("incomplete or contradictory nested fields are rejected", () => {
    const e = env();
    let state = newMissionState(content, "santiago", e.now().toISOString());
    state = run(state, [{ op: "start-visit" }, { op: "name-base", name: "Guard Basis" }, { op: "place-base", locationId: content.locations[0].id }], e);
    state = ensureItemShown(state, content, e.now()).state;
    const valid = JSON.parse(JSON.stringify(buildChildView(state, content, e.settings, e.now())));
    const mutate = (fn: (v: Record<string, unknown>) => void) => {
      const copy = JSON.parse(JSON.stringify(valid));
      fn(copy);
      return copy;
    };
    equal(isChildView(valid, "santiago"), true);
    equal(isChildView(mutate((v) => delete v.visit), "santiago"), false, "missing visit");
    equal(isChildView(mutate((v) => (v.visit = { id: "v1" })), "santiago"), false, "partial visit");
    equal(isChildView(mutate((v) => delete v.base), "santiago"), false, "missing base");
    equal(isChildView(mutate((v) => ((v.base as Record<string, unknown>).supplies = "none")), "santiago"), false, "supplies not a number record");
    equal(isChildView(mutate((v) => delete v.next), "santiago"), false, "missing next");
    equal(isChildView(mutate((v) => (v.math = { id: "EQ-ENTRY" })), "santiago"), false, "partial math item");
    equal(isChildView(mutate((v) => ((v.math as Record<string, unknown>).phase = "surprise")), "santiago"), false, "unknown math phase");
    equal(isChildView(mutate((v) => (v.language = { id: "LANG-EN-WATER" })), "santiago"), false, "partial language segment");
    equal(isChildView(mutate((v) => (v.typing = { available: true })), "santiago"), false, "typing available without lesson");
    equal(isChildView(mutate((v) => (v.reflection = { prompt: "x" })), "santiago"), false, "reflection without options");
    equal(isChildView(mutate((v) => (v.tutor = { taskId: "EQ-ENTRY" })), "santiago"), false, "partial tutor context");
    equal(isChildView(mutate((v) => (v.pages = [{ title: "only" }])), "santiago"), false, "partial page");
    equal(isChildView(mutate((v) => (v.locations = [{ id: "crater" }])), "santiago"), false, "partial location");
    equal(isChildView(mutate((v) => (v.revision = -1)), "santiago"), false, "negative revision");
    equal(isChildView(mutate((v) => (v.revision = "3")), "santiago"), false, "string revision");
    equal(isChildView(mutate((v) => (v.child = "isabel")), "santiago"), false, "other child");
    equal(isChildView(mutate((v) => (v.child = "nobody")), "santiago"), false, "unknown child");
    equal(isChildView(null), false);
    equal(isChildView([]), false);
    equal(isChildView("view"), false);
  });
});
