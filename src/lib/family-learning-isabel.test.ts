// Isabel Visit 1 — «Old Lilas kleine Werkstatt»: content rules, the engine journey and child isolation. Fictional data only.
import { describe, it } from "node:test";
import { deepStrictEqual, equal, ok, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { asLearningContent, reconcileLearningContent, type LearningContent } from "./family-learning-content.ts";
import { asIsabelContent, reconcileIsabelContent, EXPECTED_WORKSHOP_STEPS } from "./family-learning-isabel.ts";
import { applyLearningOp, buildChildView, currentStage, EMPTY_PARENT_SETTINGS, newMissionState, type LearningOp, type MissionState, type OpEnv, type ParentSettings } from "./family-learning-state.ts";
import { missionEvidence, type MissionAction } from "./family-learning-mission.ts";
import { talkPage } from "./family-learning-nokt-talk.ts";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../data/family-learning/content/${name}`, import.meta.url), "utf8"));
const rawIsabel = read("isabel-workshop-v1.json");
const rawSantiago = read("santiago-expedition-v7.json");
const isabel: LearningContent = asIsabelContent(rawIsabel);
const santiago: LearningContent = asLearningContent(rawSantiago);
const MISSION = "MISSION-OLD-LILA-WORKSHOP";

type Env = OpEnv & { settings: ParentSettings };
function makeEnv(): Env {
  let t = Date.UTC(2026, 9, 26, 15, 0, 0);
  let n = 0;
  return { content: isabel, settings: { ...EMPTY_PARENT_SETTINGS }, now: () => new Date((t += 15_000)), newId: () => `isabel-fixture-${(n += 1)}` };
}
const op = (s: MissionState, o: LearningOp, env: Env) => applyLearningOp(s, o, env);
const m = (s: MissionState, action: MissionAction, env: Env) => op(s, { op: "mission", action }, env).state;
const mr = (s: MissionState, action: MissionAction, env: Env) => op(s, { op: "mission", action }, env);
const run = (s: MissionState) => s.missions![MISSION];
const view = (s: MissionState, env: Env) => buildChildView(s, isabel, env.settings, new Date(Date.UTC(2026, 9, 26, 16, 0, 0)), 0, { noktMode: "unavailable" });
function refused(fn: () => unknown, code?: string) {
  throws(fn, (e: Error & { code?: string }) => (code ? e.code === code : true));
}
function started(env: Env) {
  return op(newMissionState(isabel, "isabel", "2026-10-26T14:00:00.000Z"), { op: "start-visit" }, env).state;
}
const open = (s: MissionState, step: string, env: Env) => m(s, { a: "open", step }, env);
const next = (s: MissionState, env: Env) => m(s, { a: "leave" }, env);
function answerParts(s: MissionState, step: string, values: Record<string, number>, env: Env) {
  for (const [part, value] of Object.entries(values)) s = m(s, { a: "answer-part", step, part, value: String(value) }, env);
  return s;
}
/** Through the materials (first try) and the small sums. */
function toTens(env: Env, materials: "first" | "retry" = "first") {
  let s = started(env);
  s = m(open(s, "W1-HELLO", env), { a: "story-done", step: "W1-HELLO" }, env);
  s = m(open(next(s, env), "W2-MAKE", env), { a: "decide", step: "W2-MAKE", option: "chair" }, env);
  s = open(next(s, env), "W3-MATERIALS", env);
  if (materials === "retry") s = m(s, { a: "answer-question", step: "W3-MATERIALS", question: "chair", value: "Glas" }, env);
  for (const [q, v] of [["chair", "Holz"], ["window", "Glas"], ["wall", "Ziegel"]]) s = m(s, { a: "answer-question", step: "W3-MATERIALS", question: q, value: v }, env);
  s = answerParts(open(next(s, env), "W4-COUNT", env), "W4-COUNT", { plus: 7, minus: 6 }, env);
  return open(next(s, env), "W5-TENS", env);
}
function readListenCraft(s: MissionState, env: Env, readPath: "first" | "letters") {
  s = open(next(s, env), "W8-READ", env);
  if (readPath === "letters") {
    s = m(s, { a: "answer-question", step: "W8-READ", question: "word", value: "Ball" }, env);
    s = m(s, { a: "support", step: "W8-READ", kind: "letters" }, env);
  }
  s = m(s, { a: "answer-question", step: "W8-READ", question: "word", value: "Ast" }, env);
  s = open(next(s, env), "W9-LISTEN", env);
  s = m(s, { a: "support", step: "W9-LISTEN", kind: "play" }, env);
  s = m(s, { a: "listen-outcome", step: "W9-LISTEN", outcome: "browser" }, env);
  s = m(s, { a: "answer-question", step: "W9-LISTEN", question: "show", value: "Fenster" }, env);
  s = open(next(s, env), "W10-CRAFT", env);
  s = m(s, { a: "craft-found", step: "W10-CRAFT", items: ["table", "spoon", "door"] }, env);
  s = m(s, { a: "story-done", step: "W10-CRAFT" }, env);
  s = open(next(s, env), "W11-ROOM", env);
  return m(s, { a: "story-done", step: "W11-ROOM" }, env);
}

describe("Isabel's content — her own reviewed line, reconciled by its own rules", () => {
  it("reconciles, and each child's validator refuses the other child's content", () => {
    deepStrictEqual(reconcileIsabelContent(rawIsabel).problems, []);
    ok(!reconcileIsabelContent(rawSantiago).ok);
    ok(reconcileLearningContent(rawIsabel).problems.some((p) => /child must be santiago/.test(p)), "Santiago's rules are unchanged and refuse Isabel's file");
    equal(santiago.child, "santiago");
  });
  it("is named Old Lila, has no typing or sentence writing, and the reading word is never in a spoken line", () => {
    const mission = isabel.missions![0];
    deepStrictEqual(mission.characters.map((c) => c.name), ["Old Lila"]);
    deepStrictEqual(mission.steps.map((s) => s.id), [...EXPECTED_WORKSHOP_STEPS]);
    ok(!mission.steps.some((s) => ["typing-block", "write", "produce", "recall"].includes(s.kind)));
    equal(mission.typingBlock, undefined);
    const readStep = mission.steps.find((s) => s.kind === "read")!;
    ok(!readStep.intro.some((l) => /\bast\b/i.test(l.text)), "the target is not spoken before the attempt");
    const bad = structuredClone(rawIsabel);
    bad.missions[0].steps.find((s: { id: string }) => s.id === "W8-READ").intro.push({ speaker: "lila", text: "Das Wort heisst AST.", language: "de" });
    ok(reconcileIsabelContent(bad).problems.some((p) => /must not say the word/.test(p)));
    const typing = structuredClone(rawIsabel);
    typing.missions[0].typingBlock = { id: "x" };
    ok(reconcileIsabelContent(typing).problems.some((p) => /no typing block/.test(p)));
  });
  it("never asserts the family home's material and never estimates trees per house", () => {
    for (const text of ["Euer Haus ist aus Holz.", "Für ein Haus braucht man 20 Bäume."]) {
      const bad = structuredClone(rawIsabel);
      bad.missions[0].steps[0].done = [{ speaker: "lila", text, language: "de" }];
      ok(!reconcileIsabelContent(bad).ok, text);
    }
  });
  it("every pictured quantity agrees with its answer", () => {
    const bad = structuredClone(rawIsabel);
    bad.missions[0].steps.find((s: { id: string }) => s.id === "W4-COUNT").solve.parts[0].counters.b = 3;
    ok(reconcileIsabelContent(bad).problems.some((p) => /must equal the answer/.test(p)));
  });
});

describe("Isabel's journey — first tries", () => {
  it("runs the whole visit; the fresh check and the easier path are not needed; the closing shows her chair and a factual recap", () => {
    const env = makeEnv();
    let s = toTens(env);
    equal(view(s, env).mission!.presentation, "workshop");
    ok(/Old Lila/.test(view(s, env).nextStep));
    equal(view(s, env).mission!.active!.solve!.parts[0].hintAllowed, false, "bundling is explained only after a first try");
    deepStrictEqual(view(s, env).mission!.active!.solve!.parts[0].counters, { a: 20, b: 1, op: "+", unit: "Stäbe", bundles: true });
    s = answerParts(s, "W5-TENS", { total: 21 }, env);
    const st = view(s, env).mission!.steps;
    equal(st.find((x) => x.id === "W6-TENS-AGAIN")!.status, "not-needed");
    equal(st.find((x) => x.id === "W7-EASIER")!.status, "not-needed", "the easier path follows only a missed fresh check");
    s = readListenCraft(s, env, "first");
    equal(run(s).steps["W8-READ"].outcome, "independent");
    s = m(s, { a: "finish" }, env);
    equal(currentStage(s, isabel), "reflect");
    const closing = view(s, env).reflection!.closing!;
    equal(closing.made!.id, "chair");
    equal(closing.recap, "Du hast einen Stuhl gewählt, Materialien zugeordnet, Klötze und Stäbe gezählt, zum Wort AST das passende Bild gefunden und beim Zuhören das richtige Bild gefunden.");
    equal(closing.made!.room, "Im Zimmer: ein Stuhl");
    equal(closing.success, "Du hast alle Materialien beim ersten Versuch richtig zugeordnet.");
    s = op(s, { op: "closing-feedback", feedback: { difficulty: "right", enjoyment: "yes" } }, env).state;
    s = op(s, { op: "reflect", interest: { kind: "choice", choice: "furniture" } } as LearningOp, env).state;
    ok(s.visits.find((v) => v.id === "v1")!.finishedAt);
    deepStrictEqual((s.interests ?? []).map((i) => [i.visit, i.kind, i.choice]), [["v1", "choice", "furniture"]]);
    ok(/geschafft/.test(view(s, env).nextStep));
  });
  it("records her own «found» report as hers (not verified) and refuses unknown or too many things", () => {
    const env = makeEnv();
    let s = answerParts(toTens(env), "W5-TENS", { total: 21 }, env);
    s = open(next(s, env), "W8-READ", env);
    s = m(s, { a: "answer-question", step: "W8-READ", question: "word", value: "Ast" }, env);
    s = open(next(s, env), "W9-LISTEN", env);
    s = m(s, { a: "support", step: "W9-LISTEN", kind: "play" }, env);
    s = m(s, { a: "listen-outcome", step: "W9-LISTEN", outcome: "browser" }, env);
    s = m(s, { a: "answer-question", step: "W9-LISTEN", question: "show", value: "Fenster" }, env);
    s = open(next(s, env), "W10-CRAFT", env);
    refused(() => m(s, { a: "craft-found", step: "W10-CRAFT", items: ["table", "spoon", "door", "frame"] }, env), "invalid");
    refused(() => m(s, { a: "craft-found", step: "W10-CRAFT", items: ["tree"] }, env), "invalid");
    const out = mr(s, { a: "craft-found", step: "W10-CRAFT", items: ["table", "pencil"] }, env);
    deepStrictEqual(out.records.samples.map((x) => [x.kind, x.text, (x.metrics as { verified: boolean }).verified]), [["self_report", "Tisch, Bleistift", false]]);
    const ev = missionEvidence(out.state, isabel, "v1")!.steps.find((x) => x.id === "W10-CRAFT")!;
    ok(ev.observed.some((x) => /Selbst gemeldet \(nicht überprüft\): gefunden Tisch, Bleistift/.test(x)));
    ok(ev.missing.some((x) => /nur der Eintrag der Eltern zählt/.test(x)));
  });
  it("asks no typing of her: every typing action is refused", () => {
    const env = makeEnv();
    const s = toTens(env);
    refused(() => m(s, { a: "typing-start" }, env), "invalid");
  });
});

describe("Isabel's journey — wrong answers, help and the easier path", () => {
  it("a wrong material keeps the first try visible and the step supported; no success line, no praise", () => {
    const env = makeEnv();
    const s = toTens(env, "retry");
    const r = run(s).steps["W3-MATERIALS"];
    equal(r.outcome, "supported");
    deepStrictEqual(r.attempts.slice(0, 2).map((a) => [a.questionId, a.raw, a.correct, a.evidence]), [["chair", "Glas", false, "incorrect"], ["chair", "Holz", true, "supported"]]);
  });
  it("tens missed → hint after the first try → fresh check 20+3 → missed again → the easier small-number path", () => {
    const env = makeEnv();
    let s = toTens(env);
    s = answerParts(s, "W5-TENS", { total: 12 }, env);
    ok(view(s, env).mission!.active!.solve!.parts[0].hintAllowed, "the bundling hint comes after the first try");
    s = m(s, { a: "hint", step: "W5-TENS", part: "total" }, env);
    s = m(s, { a: "hint-check", step: "W5-TENS", part: "total", hint: "W5-total-H1", value: "20" }, env);
    s = answerParts(s, "W5-TENS", { total: 21 }, env);
    equal(run(s).steps["W5-TENS"].outcome, "supported");
    equal(view(s, env).mission!.steps.find((x) => x.id === "W6-TENS-AGAIN")!.status, "available");
    s = open(next(s, env), "W6-TENS-AGAIN", env);
    deepStrictEqual(view(s, env).mission!.active!.solve!.parts[0].counters, { a: 20, b: 3, op: "+", unit: "Stäbe", bundles: true });
    s = answerParts(s, "W6-TENS-AGAIN", { total: 5 }, env);
    s = answerParts(s, "W6-TENS-AGAIN", { total: 50 }, env);
    s = answerParts(s, "W6-TENS-AGAIN", { total: 32 }, env);
    ok(run(s).steps["W6-TENS-AGAIN"].outcome !== "independent");
    // After teaching she copies the number herself (practice) — the fresh check never counts as independent.
    // Still open after three misses: the hint, then the worked solution she chooses herself, then she enters the number.
    equal(run(s).steps["W6-TENS-AGAIN"].parts!.total.status, "open");
    s = m(s, { a: "hint", step: "W6-TENS-AGAIN", part: "total" }, env);
    s = m(s, { a: "show-solution", step: "W6-TENS-AGAIN", part: "total" }, env);
    s = m(s, { a: "practice-part", step: "W6-TENS-AGAIN", part: "total", value: "23" }, env);
    equal(view(s, env).mission!.steps.find((x) => x.id === "W7-EASIER")!.status, "available");
    s = answerParts(open(next(s, env), "W7-EASIER", env), "W7-EASIER", { small: 5 }, env);
    equal(run(s).steps["W7-EASIER"].outcome, "independent");
    s = readListenCraft(s, env, "letters");
    s = m(s, { a: "finish" }, env);
    const closing = view(s, env).reflection!.closing!;
    ok(!/Bündel.*beim ersten Versuch/.test(closing.success ?? ""));
    equal(closing.next, "Nächstes Mal zählen wir noch einmal mit Bündeln.");
    ok(/das Wort AST mit Buchstabenhilfe angeschaut/.test(closing.recap!) && /\(die Bündel mit Hilfe\)/.test(closing.recap!), closing.recap!);
    const ev = missionEvidence(s, isabel, "v1")!;
    ok(ev.steps.find((x) => x.id === "W5-TENS")!.missing.some((x) => /unterstützte Anschauung/.test(x)), "visual counters are supported visual arithmetic, not place-value mastery");
    ok(ev.steps.find((x) => x.id === "W5-TENS")!.questions[0].result === "after-hint");
  });
  it("reading: the letter help is recorded before it is shown, makes the answer supported, and is never independent reading", () => {
    const env = makeEnv();
    let s = answerParts(toTens(env), "W5-TENS", { total: 21 }, env);
    s = open(next(s, env), "W8-READ", env);
    equal(view(s, env).mission!.active!.letters!.shown, null, "no letters (and no word audio) before the switch");
    const sw = mr(s, { a: "support", step: "W8-READ", kind: "letters" }, env);
    ok(/letters/.test(sw.records.supports[0].kind));
    equal((sw.result as { spoken: string }).spoken, "A. S. T. Ast.");
    s = m(sw.state, { a: "answer-question", step: "W8-READ", question: "word", value: "Ast" }, env);
    equal(run(s).steps["W8-READ"].outcome, "supported");
    const ev = missionEvidence(s, isabel, "v1")!.steps.find((x) => x.id === "W8-READ")!;
    ok(ev.missing.some((x) => /kein selbständiges Lesen/.test(x)));
    ok(ev.observed.some((x) => /nach 0 Leseversuch/.test(x)));
  });
  it("reading: two misses show the answer (never credited)", () => {
    const env = makeEnv();
    let s = answerParts(toTens(env), "W5-TENS", { total: 21 }, env);
    s = open(next(s, env), "W8-READ", env);
    s = m(s, { a: "answer-question", step: "W8-READ", question: "word", value: "Ball" }, env);
    s = m(s, { a: "answer-question", step: "W8-READ", question: "word", value: "Haus" }, env);
    equal(run(s).steps["W8-READ"].outcome, "answer_exposed");
  });
  it("listening: answering before a completed play is refused; listening is recorded apart from reading", () => {
    const env = makeEnv();
    let s = answerParts(toTens(env), "W5-TENS", { total: 21 }, env);
    s = open(next(s, env), "W8-READ", env);
    s = m(s, { a: "answer-question", step: "W8-READ", question: "word", value: "Ast" }, env);
    s = open(next(s, env), "W9-LISTEN", env);
    refused(() => m(s, { a: "answer-question", step: "W9-LISTEN", question: "show", value: "Fenster" }, env), "not-allowed");
    s = m(s, { a: "support", step: "W9-LISTEN", kind: "play" }, env);
    s = m(s, { a: "listen-outcome", step: "W9-LISTEN", outcome: "browser" }, env);
    s = m(s, { a: "answer-question", step: "W9-LISTEN", question: "show", value: "Fenster" }, env);
    const ev = missionEvidence(s, isabel, "v1")!.steps.find((x) => x.id === "W9-LISTEN")!;
    ok(ev.missing.some((x) => /getrennt von Lesen/.test(x)));
    equal(run(s).steps["W8-READ"].outcome, "independent");
  });
  it("stop and resume: leaving keeps every answer; the open step continues where it was", () => {
    const env = makeEnv();
    let s = toTens(env);
    s = answerParts(s, "W5-TENS", { total: 12 }, env);
    s = next(s, env);
    equal(run(s).active, null);
    s = open(s, "W5-TENS", env);
    equal(run(s).steps["W5-TENS"].attempts.length, 1);
    equal(view(s, env).mission!.active!.solve!.parts[0].tries, 1);
  });
});

describe("child-specific rollout — each child's new visit can be switched on its own", () => {
  it("Isabel's view never offers Nokt, even where the server runs Santiago's Nokt conversation", () => {
    const env = makeEnv();
    const v = buildChildView(started(env), isabel, env.settings, new Date(), 0, { noktMode: "subscription", noktMic: true });
    deepStrictEqual(v.nokt, { mode: "unavailable", mic: false });
  });
  it("under Santiago's rollback cap (content v6) none of Nokt's new conversations exist — Home included", () => {
    const v6 = asLearningContent(read("santiago-expedition-v6.json"));
    const s = newMissionState(v6, "santiago", "2026-10-26T14:00:00.000Z");
    const home = talkPage(s, v6, "home");
    equal(home.ok, false);
    const v7home = talkPage(newMissionState(santiago, "santiago", "2026-10-26T14:00:00.000Z"), santiago, "home");
    equal(v7home.ok, true, "content v7 keeps Home");
    const view6 = buildChildView(s, v6, { ...EMPTY_PARENT_SETTINGS }, new Date(), 0, { noktMode: "subscription" });
    equal(view6.nokt?.talk, undefined, "no talk block → Family Home shows the earlier card");
  });
});
