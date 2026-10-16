// Visit 6 (content v5, 2026-10-16): the reviewed, data-driven mission. Every fixture here is SYNTHETIC (no child record);
// the shape of the "five visits done" state follows the read-only Visit 5 evidence summary (typing course at lesson 5 with
// two open key focus entries, the open herramientas focus, the saved destination "ship"), never its private content.
import { deepStrictEqual, equal, notEqual, ok, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { asLearningContent, reconcileLearningContent, EXPECTED_V7_STAGES, type LearningContent } from "./family-learning-content.ts";
import { analyzeProduction, buildMissionView, editDistance, missionDefFor, planningInput, planTypingBlock, repairLine, stepStatuses, type MissionAction } from "./family-learning-mission.ts";
import { applyLearningOp, buildChildView, currentStage, EMPTY_PARENT_SETTINGS, LearningOpError, newMissionState, nextVisitAvailability, upgradeMissionState, type LearningOp, type MissionState, type OpEnv, type ParentSettings, type Records } from "./family-learning-state.ts";
import { buildParentReview, buildVisitSummary, visitLabel } from "./family-learning-summary.ts";
import { buildVisitReports } from "./family-learning-feedback.ts";
import { isChildView } from "./family-learning-view-guard.ts";
import type { MissionProduce } from "./family-learning-mission-spec.ts";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../data/family-learning/content/${name}`, import.meta.url), "utf8"));
const rawV4 = read("santiago-expedition-v4.json");
const rawV5 = read("santiago-expedition-v5.json");
const v4: LearningContent = asLearningContent(rawV4);
const v5: LearningContent = asLearningContent(rawV5);
const mission = missionDefFor(v5, "v7")!;

type Env = OpEnv & { settings: ParentSettings };
function makeEnv(content: LearningContent = v5, settings: Partial<ParentSettings> = {}): Env {
  let t = Date.UTC(2026, 9, 17, 14, 0, 0);
  let n = 0;
  return { content, settings: { ...EMPTY_PARENT_SETTINGS, keyboardLayout: "ch-de-qwertz", ...settings }, now: () => new Date((t += 20_000)), newId: () => `id-${(n += 1)}` };
}

/** Synthetic: v1, v2, v4, v5, v6 finished; base named; destination "ship"; course at lesson 5 with measured bursts; open focus entries. */
function fiveVisitsDone(env: Env): MissionState {
  const s = newMissionState(env.content, "santiago", "2026-09-29T10:00:00.000Z");
  const day = (d: number, h: number) => new Date(Date.UTC(2026, 8, 29 + d, h, 0, 0)).toISOString();
  s.visits = (["v1", "v2", "v4", "v5", "v6"] as const).map((id, i) => ({ id, startedAt: day(i * 3, 10), finishedAt: day(i * 3, 11), stageIndex: 99, skippedStages: [], reflection: "easy" }));
  s.base = { name: "Fixture Basis", locationId: "shore", supplies: { agua: 3, cuerdas: 1 } };
  s.harbor = { destination: "ship", planned: true, plannedAt: day(12, 10), roped: true, entered: ["typing", "planning", "closing"] };
  s.typing.alignment = { layout: "ch-de-qwertz", checkedAt: day(6, 10), result: "match", observed: [], matchesLayout: "ch-de-qwertz" };
  const burst = (lessonId: string, chars: number, seconds: number) => ({ lessonId, visit: "v6" as const, lineCount: 2, lines: [], expectedChars: chars, typedChars: chars, correctChars: chars, extraChars: 0, omittedChars: 0, substitutedChars: 0, denominator: chars, accuracy: 1, comfort: "easy" as const, metricVersion: 2 as const, seconds, at: day(12, 10) });
  s.typing.course = { layout: "ch-de-qwertz", lessonIndex: 4, bursts: [burst("TYPE-CH-COURSE-3", 14, 32), burst("TYPE-CH-COURSE-4", 16, 17), burst("TYPE-CH-COURSE-4", 16, 101), burst("TYPE-CH-COURSE-5", 24, 62)], decision: null, completed: ["TYPE-CH-COURSE-1", "TYPE-CH-COURSE-2", "TYPE-CH-COURSE-3", "TYPE-CH-COURSE-4"] };
  const focus = (id: string, kind: "typing-key" | "language", key: string) => ({ id, kind, key, openedAt: day(12, 10), openedIn: { visit: "v6" as const, lesson: "fixture" }, evidence: "fixture", status: "open" as const, retiredAt: null, retiredBy: null, reopened: 0 });
  s.feedback = { repairs: [], acknowledged: [], focus: [focus("typing-key:h", "typing-key", "h"), focus("language:es:herramientas", "language", "es:herramientas")] };
  return s;
}

function op(state: MissionState, o: LearningOp, env: Env) {
  return applyLearningOp(state, o, env);
}
function m(state: MissionState, action: MissionAction, env: Env): MissionState {
  return op(state, { op: "mission", action }, env).state;
}
function mr(state: MissionState, action: MissionAction, env: Env) {
  return op(state, { op: "mission", action }, env);
}
function started(env: Env = makeEnv()) {
  return op(fiveVisitsDone(env), { op: "start-visit" }, env).state;
}
const view = (s: MissionState, env: Env) => buildChildView(s, env.content, env.settings, env.now(), 0);
const review = (s: MissionState) => buildParentReview(s, v5, "v7", null, { historical: false });
const run = (s: MissionState) => s.missions![mission.id];
function walkOpen(s: MissionState, step: string, env: Env) {
  const place = mission.steps.find((x) => x.id === step)!.place;
  s = m(s, { a: "leave" }, env);
  s = m(s, { a: "arrive", place }, env);
  return m(s, { a: "open", step }, env);
}
function finishTyping(s: MissionState, env: Env, opts: { extra?: boolean } = {}) {
  s = walkOpen(s, "S12-TYPING", env);
  s = m(s, { a: "typing-start" }, env);
  for (;;) {
    const tv = buildMissionView(s, env.content, "v7")!.active!.typing!;
    if (!tv.nextDrill) break;
    s = m(s, { a: "typing-drill", no: tv.nextDrill.no, lines: tv.nextDrill.lines, seconds: 60, activeSeconds: 50, idleSeconds: 10 }, env);
  }
  s = m(s, { a: "typing-comfort", comfort: "ok" }, env);
  s = m(s, { a: "typing-extra", take: !!opts.extra }, env);
  if (opts.extra) {
    const tv = buildMissionView(s, env.content, "v7")!.active!.typing!;
    s = m(s, { a: "typing-drill", no: tv.nextDrill!.no, lines: tv.nextDrill!.lines, seconds: 60, activeSeconds: 55, idleSeconds: 5 }, env);
  }
  return m(s, { a: "leave" }, env);
}
/** The whole mission with first-try answers (S13 not needed). */
function wholeMission(env: Env, s = started(env), rosa = "Necesitamos cuerdas") {
  s = walkOpen(s, "S1-BRIEF", env);
  s = m(s, { a: "story-done", step: "S1-BRIEF" }, env);
  s = walkOpen(s, "S2-BOARD", env);
  s = m(s, { a: "answer-question", step: "S2-BOARD", question: "boat-max", value: "6" }, env);
  s = m(s, { a: "answer-question", step: "S2-BOARD", question: "reef-max", value: "4" }, env);
  s = walkOpen(s, "S3-RADIO", env);
  s = m(m(s, { a: "support", step: "S3-RADIO", kind: "play" }, env), { a: "listen-outcome", step: "S3-RADIO", outcome: "browser" }, env);
  for (const [q, v] of [["crew", "7"], ["bottles", "4"], ["ask", "Seile"]]) s = m(s, { a: "answer-question", step: "S3-RADIO", question: q, value: v }, env);
  s = walkOpen(s, "S4-WATER", env);
  s = m(s, { a: "answer-calc", step: "S4-WATER", values: { total: 28 }, raw: "28" }, env);
  s = walkOpen(s, "S5-CRATES", env);
  s = m(s, { a: "answer-calc", step: "S5-CRATES", values: { full: 4, rest: 4, needed: 5 }, raw: "4 4 5" }, env);
  s = walkOpen(s, "S6-ROSA", env);
  s = m(s, { a: "produce", step: "S6-ROSA", response: rosa, modality: "typed" }, env);
  if (run(s).steps["S6-ROSA"].status === "active") s = m(s, { a: "produce", step: "S6-ROSA", response: "Necesitamos cuerdas", modality: "typed" }, env);
  s = walkOpen(s, "S7-ROSA-REPLY", env);
  s = m(m(s, { a: "support", step: "S7-ROSA-REPLY", kind: "play" }, env), { a: "listen-outcome", step: "S7-ROSA-REPLY", outcome: "browser" }, env);
  s = m(s, { a: "answer-question", step: "S7-ROSA-REPLY", question: "ropes", value: "5" }, env);
  s = walkOpen(s, "S8-TOOLS", env);
  s = m(s, { a: "produce", step: "S8-TOOLS", response: "Necesitamos herramientas.", modality: "typed" }, env);
  s = walkOpen(s, "S9-LOAD", env);
  s = m(s, { a: "answer-calc", step: "S9-LOAD", values: { total: 8, boats: 2 }, raw: "8 2" }, env);
  s = walkOpen(s, "S10-ROPES", env);
  s = m(s, { a: "answer-calc", step: "S10-ROPES", values: { need: 4, left: 1 }, raw: "4 1" }, env);
  s = walkOpen(s, "S11-ROUTE", env);
  s = m(s, { a: "choose", step: "S11-ROUTE", option: "reef-4-4" }, env);
  s = finishTyping(s, env);
  if (stepStatuses(mission, run(s))["S13-RECALL-CUERDAS"] === "available") {
    s = walkOpen(s, "S13-RECALL-CUERDAS", env);
    s = m(s, { a: "produce", step: "S13-RECALL-CUERDAS", response: "Necesitamos cuerdas", modality: "typed" }, env);
  }
  s = walkOpen(s, "S14-LAUNCH", env);
  s = m(s, { a: "story-done", step: "S14-LAUNCH" }, env);
  s = m(s, { a: "leave" }, env);
  return s;
}
function refused(fn: () => unknown, code?: string) {
  throws(fn, (e: unknown) => e instanceof LearningOpError && (!code || e.code === code));
}

describe("Visit 6 — content version 5 (reviewed, additive)", () => {
  it("v5 is a strict additive superset of v4 and validates; v7 is one data-driven mission stage plus summary and reflection", () => {
    const r = reconcileLearningContent(rawV5);
    deepStrictEqual(r.problems, []);
    for (const key of Object.keys(rawV4)) if (!["contentVersion", "supersedes", "reviewed", "visits", "reflection"].includes(key)) deepStrictEqual(rawV5[key], rawV4[key], key);
    deepStrictEqual(rawV5.visits.slice(0, rawV4.visits.length), rawV4.visits);
    deepStrictEqual(v5.visits.find((v) => v.id === "v7")!.stages, [...EXPECTED_V7_STAGES]);
    ok(reconcileLearningContent(rawV4).ok, "version 4 still validates on its own");
  });
  it("the mission has 4 connected calculations, one plan choice, one typing block, reading and listening apart, and a theme from a saved choice", () => {
    const kinds = mission.steps.map((s) => s.kind);
    equal(kinds.filter((k) => k === "calc").length, 4);
    equal(kinds.filter((k) => k === "choice").length, 1);
    equal(kinds.filter((k) => k === "typing-block").length, 1);
    ok(mission.steps.some((s) => s.kind === "read" && s.text?.language === "de"));
    ok(mission.steps.some((s) => s.kind === "listen" && s.text?.language === "en" && s.character === "keeper"), "Mrs Finley's English encounter is a listening task of its own");
    equal(mission.theme.basis, "continues-saved-choice");
    ok(/not a research-proven optimum/.test(mission.typingBlock.note));
  });
  it("the validator refuses matcher wording, missing repair words, unreachable places, cycles and an uncalibrated typing claim", () => {
    const clone = () => JSON.parse(JSON.stringify(rawV5));
    const probe = (mutate: (c: any) => void, pattern: RegExp) => {
      const c = clone();
      mutate(c);
      ok(reconcileLearningContent(c).problems.some((p) => pattern.test(p)), String(pattern));
    };
    probe((c) => (c.missions[0].steps.find((s: any) => s.id === "S6-ROSA").produce.feedback.unclear = "Das konnte keiner Antwort zugeordnet werden."), /matcher wording/);
    probe((c) => (c.missions[0].steps.find((s: any) => s.id === "S6-ROSA").produce.repairWords = []), /repairWords required/);
    probe((c) => (c.missions[0].map.paths = c.missions[0].map.paths.filter((p: string[]) => !p.includes("pier"))), /not reachable/);
    probe((c) => c.missions[0].steps.find((s: any) => s.id === "S1-BRIEF").requires.push("S14-LAUNCH"), /cycle/);
    probe((c) => (c.missions[0].typingBlock.note = "Five minutes is optimal."), /calibration/);
    probe((c) => (c.missions[0].steps.find((s: any) => s.id === "S4-WATER").calc.teach = "So geht das."), /teaching text does not state/);
    probe((c) => delete c.reflection.nextInterest, /nextInterest/);
    probe((c) => (rawV4.missions = undefined, (c.contentVersion = 4)), /missions exist only from content version 5/);
  });
});

describe("Visit 6 — progression, rollback cap, compatibility", () => {
  it("after Besuch 5 the mission chapter v7 is offered immediately and labelled Besuch 6; nothing further is promised after it", () => {
    const env = makeEnv();
    const s = fiveVisitsDone(env);
    deepStrictEqual(nextVisitAvailability(s, v5, env.now()), { visit: "v7", availableAt: null });
    equal(visitLabel(s, v5, "v7"), "Besuch 6 — Die Fahrt zum Forschungsschiff");
    const done = m(wholeMission(env), { a: "finish" }, env);
    let f = op(done, { op: "summary-seen" }, env).state;
    f = op(f, { op: "reflect", optionId: "right", interest: { kind: "unsure" } }, env).state;
    deepStrictEqual(nextVisitAvailability(f, v5, env.now()), { visit: null, availableAt: null, reason: "all-visits-done" });
  });
  it("under CAP=4 (version-4 content) nothing new is offered, a running v7 is parked untouched and every view still builds", () => {
    const env = makeEnv(v4);
    const s = fiveVisitsDone(makeEnv());
    deepStrictEqual(nextVisitAvailability(s, v4, env.now()), { visit: null, availableAt: null, reason: "all-visits-done" });
    const running = started();
    deepStrictEqual(nextVisitAvailability(running, v4, env.now()), { visit: null, availableAt: null, reason: "chapter-unavailable" });
    const capped = view(running, env);
    equal(capped.mission, null);
    ok(isChildView(JSON.parse(JSON.stringify(capped)), "santiago"));
    refused(() => op(running, { op: "mission", action: { a: "arrive", place: "shop" } }, env));
  });
  it("a saved mission state without the new keys upgrades additively; upgrading twice changes nothing", () => {
    const env = makeEnv();
    const s = fiveVisitsDone(env);
    delete (s as Partial<MissionState>).missions;
    delete (s as Partial<MissionState>).interests;
    const u1 = upgradeMissionState(s, v5, env.now().toISOString());
    const u2 = upgradeMissionState(u1.state, v5, env.now().toISOString());
    equal(u2.changed, false);
    deepStrictEqual(u1.state.visits, s.visits);
    ok(isChildView(JSON.parse(JSON.stringify(view(u1.state, env))), "santiago"));
  });
});

describe("V6-01 walkable island — steps live at places, reached on foot", () => {
  it("a step opens only at its place and only when its information dependencies are resolved", () => {
    const env = makeEnv();
    let s = started(env);
    equal(currentStage(s, v5), "mission");
    equal(run(s).position, "harbor");
    refused(() => m(s, { a: "open", step: "S1-BRIEF" }, env), "not-allowed"); // still at the quay
    s = m(s, { a: "arrive", place: "office" }, env);
    refused(() => m(s, { a: "open", step: "S4-WATER" }, env), "not-allowed"); // locked: the radio message is not known yet
    s = m(s, { a: "open", step: "S1-BRIEF" }, env);
    s = m(s, { a: "story-done", step: "S1-BRIEF" }, env);
    const st = stepStatuses(mission, run(s));
    equal(st["S2-BOARD"], "available");
    equal(st["S3-RADIO"], "available");
    equal(st["S4-WATER"], "locked");
    refused(() => m(s, { a: "arrive", place: "nowhere" }, env), "invalid");
  });
  it("visible world changes appear only after the step that causes them", () => {
    const env = makeEnv();
    const s = wholeMission(env);
    const ids = buildMissionView(s, v5, "v7")!.world.map((w) => w.id);
    deepStrictEqual(ids, ["W-RADIO", "W-CRATES", "W-ROPES", "W-TOOLS", "W-BOATS", "W-ROPED", "W-ROUTE", "W-SAIL"]);
    const early = buildMissionView(started(env), v5, "v7")!;
    deepStrictEqual(early.world, []);
  });
});

describe("V6-07 listening playback that failed — recoverable, never listening evidence", () => {
  it("a failed play unlocks nothing; retries are allowed; the text (help) unlocks answers that are supported, never independent", () => {
    const env = makeEnv();
    let s = started(env);
    s = walkOpen(s, "S1-BRIEF", env);
    s = m(s, { a: "story-done", step: "S1-BRIEF" }, env);
    s = walkOpen(s, "S3-RADIO", env);
    refused(() => m(s, { a: "listen-outcome", step: "S3-RADIO", outcome: "browser" }, env), "not-allowed"); // nothing was requested
    s = m(m(s, { a: "support", step: "S3-RADIO", kind: "play" }, env), { a: "listen-outcome", step: "S3-RADIO", outcome: "failed" }, env);
    refused(() => m(s, { a: "answer-question", step: "S3-RADIO", question: "crew", value: "7" }, env), "not-allowed");
    refused(() => m(s, { a: "listen-outcome", step: "S3-RADIO", outcome: "browser" }, env), "not-allowed"); // one outcome per play
    s = m(m(s, { a: "support", step: "S3-RADIO", kind: "play" }, env), { a: "listen-outcome", step: "S3-RADIO", outcome: "failed" }, env);
    const v = buildMissionView(s, v5, "v7")!.active!.listen!;
    deepStrictEqual([v.plays, v.completedPlays, v.failures], [2, 0, 2]);
    s = m(s, { a: "support", step: "S3-RADIO", kind: "transcript" }, env);
    s = m(s, { a: "answer-question", step: "S3-RADIO", question: "crew", value: "7" }, env);
    equal(run(s).steps["S3-RADIO"].attempts[0].evidence, "supported");
    ok(review(s).learning.whatHappened.some((l) => l.includes("davon mit gemeldetem Abspiel-Ende 0×, ohne Abspiel-Ende 2×")));
  });
  it("an answer after a confirmed play without help stays independent even if an earlier play failed", () => {
    const env = makeEnv();
    let s = started(env);
    s = walkOpen(s, "S1-BRIEF", env);
    s = m(s, { a: "story-done", step: "S1-BRIEF" }, env);
    s = walkOpen(s, "S3-RADIO", env);
    s = m(m(s, { a: "support", step: "S3-RADIO", kind: "play" }, env), { a: "listen-outcome", step: "S3-RADIO", outcome: "failed" }, env);
    s = m(m(s, { a: "support", step: "S3-RADIO", kind: "play" }, env), { a: "listen-outcome", step: "S3-RADIO", outcome: "child-voice" }, env);
    s = m(s, { a: "answer-question", step: "S3-RADIO", question: "crew", value: "7" }, env);
    equal(run(s).steps["S3-RADIO"].attempts[0].evidence, "independent");
  });
});

describe("V6-07 reading versus listening", () => {
  it("listening: no answer and no transcript before listening; replays are allowed and are not help; the transcript is recorded support before it is shown", () => {
    const env = makeEnv();
    let s = started(env);
    s = walkOpen(s, "S1-BRIEF", env);
    s = m(s, { a: "story-done", step: "S1-BRIEF" }, env);
    s = walkOpen(s, "S3-RADIO", env);
    const v0 = buildMissionView(s, v5, "v7")!.active!;
    equal(v0.listen!.script, null);
    ok(!JSON.stringify(v0).includes("seven scientists"), "the script is never in the view before the transcript support");
    refused(() => m(s, { a: "answer-question", step: "S3-RADIO", question: "crew", value: "7" }, env), "not-allowed");
    refused(() => m(s, { a: "support", step: "S3-RADIO", kind: "transcript" }, env), "not-allowed");
    let r = mr(s, { a: "support", step: "S3-RADIO", kind: "play" }, env);
    equal(r.records.supports[0].kind, "mission_listen_play");
    equal(r.result.script, mission.steps.find((x) => x.id === "S3-RADIO")!.text!.body, "the script travels only in the result of a recorded play");
    refused(() => m(r.state, { a: "answer-question", step: "S3-RADIO", question: "crew", value: "7" }, env), "not-allowed");
    s = m(r.state, { a: "listen-outcome", step: "S3-RADIO", outcome: "child-voice" }, env);
    s = m(m(s, { a: "support", step: "S3-RADIO", kind: "play" }, env), { a: "listen-outcome", step: "S3-RADIO", outcome: "browser" }, env);
    s = m(s, { a: "answer-question", step: "S3-RADIO", question: "crew", value: "7" }, env);
    equal(run(s).steps["S3-RADIO"].attempts[0].evidence, "independent", "two plays, no transcript: still independent listening");
    r = mr(s, { a: "support", step: "S3-RADIO", kind: "transcript" }, env);
    equal(r.records.supports[0].kind, "mission_transcript");
    s = r.state;
    ok(buildMissionView(s, v5, "v7")!.active!.listen!.script!.includes("seven scientists"));
    s = m(s, { a: "answer-question", step: "S3-RADIO", question: "bottles", value: "4" }, env);
    equal(run(s).steps["S3-RADIO"].attempts[1].evidence, "supported", "after the transcript: supported, never independent listening");
  });
  it("reading: the text is shown, there is no recording to play and no read-aloud", () => {
    const env = makeEnv();
    let s = started(env);
    s = walkOpen(s, "S1-BRIEF", env);
    s = m(s, { a: "story-done", step: "S1-BRIEF" }, env);
    s = walkOpen(s, "S2-BOARD", env);
    const a = buildMissionView(s, v5, "v7")!.active!;
    ok(a.readText!.includes("HAFENREGELN"));
    equal(a.listen, null);
    refused(() => m(s, { a: "support", step: "S2-BOARD", kind: "play" }, env), "invalid");
  });
  it("a wrong answer gets the reviewed hint; a second wrong answer shows the answer (recorded) so the mission continues — never credited", () => {
    const env = makeEnv();
    let s = started(env);
    s = walkOpen(s, "S1-BRIEF", env);
    s = m(s, { a: "story-done", step: "S1-BRIEF" }, env);
    s = walkOpen(s, "S2-BOARD", env);
    s = m(s, { a: "answer-question", step: "S2-BOARD", question: "boat-max", value: "4" }, env);
    equal(buildMissionView(s, v5, "v7")!.active!.questions[0].hint, "Lies die erste Regel auf der Tafel noch einmal.");
    const r = mr(s, { a: "answer-question", step: "S2-BOARD", question: "boat-max", value: "5" }, env);
    ok(r.records.exposures.some((e) => e.kind === "answer_revealed"));
    equal(r.state.missions![mission.id].facts.boatMax.source, "given");
    equal(buildMissionView(r.state, v5, "v7")!.active!.questions[0].shownAnswer, "6");
  });
});

describe("V6-06 connected calculations and the plan choice", () => {
  function atWater(env: Env) {
    let s = started(env);
    s = walkOpen(s, "S1-BRIEF", env);
    s = m(s, { a: "story-done", step: "S1-BRIEF" }, env);
    s = walkOpen(s, "S3-RADIO", env);
    s = m(m(s, { a: "support", step: "S3-RADIO", kind: "play" }, env), { a: "listen-outcome", step: "S3-RADIO", outcome: "browser" }, env);
    for (const [q, v] of [["crew", "7"], ["bottles", "4"], ["ask", "Seile"]]) s = m(s, { a: "answer-question", step: "S3-RADIO", question: q, value: v }, env);
    return walkOpen(s, "S4-WATER", env);
  }
  it("first try right without help is independent; the view never carries the answer before teaching", () => {
    const env = makeEnv();
    const s = atWater(env);
    const before = JSON.stringify(buildMissionView(s, v5, "v7")!.active);
    ok(!before.includes("28"), "no answer key in the view");
    const r = mr(s, { a: "answer-calc", step: "S4-WATER", values: { total: 28 }, raw: "28" }, env);
    equal(r.records.attempts[0].evidence, "independent");
    equal(r.records.attempts[0].taskId, "MISSION-SHIP-SUPPLY/S4-WATER");
  });
  it("bounded retry: clarification, then the counters picture, then teaching (answer revealed) — each recorded before it is shown", () => {
    const env = makeEnv();
    let s = atWater(env);
    let r = mr(s, { a: "answer-calc", step: "S4-WATER", values: { total: 11 }, raw: "11" }, env);
    equal(r.records.supports[0].kind, "mission_clarification");
    ok(buildMissionView(r.state, v5, "v7")!.active!.calc!.clarification);
    r = mr(r.state, { a: "answer-calc", step: "S4-WATER", values: { total: 24 }, raw: "24" }, env);
    equal(r.records.supports[0].kind, "mission_representation");
    r = mr(r.state, { a: "answer-calc", step: "S4-WATER", values: { total: 32 }, raw: "32" }, env);
    ok(r.records.exposures.some((e) => e.kind === "answer_revealed"));
    s = r.state;
    equal(run(s).steps["S4-WATER"].status, "taught");
    ok(buildMissionView(s, v5, "v7")!.active!.calc!.teach!.includes("28"));
    deepStrictEqual(run(s).steps["S4-WATER"].attempts.map((a) => a.raw), ["11", "24", "32"], "every original answer kept verbatim");
  });
  it("a correct answer after a clarification is supported, never independent; per-field feedback names what is already right", () => {
    const env = makeEnv();
    let s = atWater(env);
    s = m(s, { a: "answer-calc", step: "S4-WATER", values: { total: 28 }, raw: "28" }, env);
    s = walkOpen(s, "S5-CRATES", env);
    s = m(s, { a: "answer-calc", step: "S5-CRATES", values: { full: 4, rest: 4, needed: 4 }, raw: "4 4 4" }, env);
    deepStrictEqual(buildMissionView(s, v5, "v7")!.active!.calc!.fields.map((f) => f.correct), [true, true, false]);
    s = m(s, { a: "answer-calc", step: "S5-CRATES", values: { full: 4, rest: 4, needed: 5 }, raw: "4 4 5" }, env);
    equal(run(s).steps["S5-CRATES"].outcome, "supported");
  });
  it("the plan choice: an allowed but slower plan gets reviewed feedback and another try; the best plan after feedback is supported", () => {
    const env = makeEnv();
    const s0 = wholeMission(env);
    ok(run(s0).steps["S11-ROUTE"].outcome === "independent");
    const env2 = makeEnv();
    let s = started(env2);
    s = walkOpen(s, "S1-BRIEF", env2);
    s = m(s, { a: "story-done", step: "S1-BRIEF" }, env2);
    // jump the dependencies synthetically: resolve the prerequisites by playing them
    const full = wholeMission(env2);
    const st = full.missions![mission.id];
    delete st.steps["S11-ROUTE"];
    st.active = null;
    st.finishedAt = null;
    s = full;
    s = walkOpen(s, "S11-ROUTE", env2);
    s = m(s, { a: "choose", step: "S11-ROUTE", option: "around-6-2" }, env2);
    const picked = buildMissionView(s, v5, "v7")!.active!.choice!.picked;
    ok(picked[0].feedback.includes("doppelt so lange"));
    s = m(s, { a: "choose", step: "S11-ROUTE", option: "reef-4-4" }, env2);
    equal(run(s).steps["S11-ROUTE"].outcome, "supported");
  });
});

describe("V6-10 helpful language repair (bounded, reviewed — no live inference)", () => {
  const rosa = mission.steps.find((s) => s.id === "S6-ROSA")!.produce!;
  it("analyzeProduction: «Necesitamos querdas» is understood as «Necesitamos cuerdas» with one spelling correction", () => {
    const a = analyzeProduction(rosa, "Necesitamos querdas");
    deepStrictEqual(a, { kind: "spelling", understood: "Necesitamos cuerdas", corrections: [{ given: "querdas", meant: "cuerdas" }] });
    equal(repairLine(rosa, (a as { corrections: { given: string; meant: string }[] }).corrections), "Du möchtest sagen: Wir brauchen Seile. „Seile“ schreibt man auf Spanisch cuerdas, mit c. Versuch den Satz noch einmal.");
    equal(analyzeProduction(rosa, "necesitamos cuerdas").kind, "correct");
    equal(analyzeProduction(rosa, "cuerdas").kind, "lexical");
    equal(analyzeProduction(rosa, "Necesitamos agua").kind, "distractor");
    equal(analyzeProduction(rosa, "hola").kind, "unclear");
    deepStrictEqual(analyzeProduction(rosa, "nesesitamos querdas"), { kind: "spelling", understood: "Necesitamos cuerdas", corrections: [{ given: "nesesitamos", meant: "necesitamos" }, { given: "querdas", meant: "cuerdas" }] });
    equal(editDistance("querdas", "cuerdas"), 1);
  });
  it("genuinely ambiguous spelling asks instead of inventing a meaning", () => {
    const p: MissionProduce = { ...rosa, keywords: ["casas", "cajas"], accepted: ["Necesitamos cajas", "Necesitamos casas"], lexical: ["cajas", "casas"], distractors: ["agua"], repairWords: [{ word: "cajas", meaningDe: "Kisten", spellingNote: "x" }, { word: "casas", meaningDe: "Häuser", spellingNote: "y" }] };
    const a = analyzeProduction(p, "Necesitamos catas");
    equal(a.kind, "ambiguous");
    deepStrictEqual((a as { options: { word: string }[] }).options.map((o) => o.word).sort(), ["cajas", "casas"]);
  });
  it("in the mission: the original is kept, the repair line is recorded before it is shown, the next try is supported and after-supplied", () => {
    const env = makeEnv();
    let s = started(env);
    s = walkOpen(s, "S1-BRIEF", env);
    s = m(s, { a: "story-done", step: "S1-BRIEF" }, env);
    s = walkOpen(s, "S3-RADIO", env);
    s = m(m(s, { a: "support", step: "S3-RADIO", kind: "play" }, env), { a: "listen-outcome", step: "S3-RADIO", outcome: "browser" }, env);
    for (const [q, v] of [["crew", "7"], ["bottles", "4"], ["ask", "Seile"]]) s = m(s, { a: "answer-question", step: "S3-RADIO", question: q, value: v }, env);
    s = walkOpen(s, "S6-ROSA", env);
    const r = mr(s, { a: "produce", step: "S6-ROSA", response: "Necesitamos querdas", modality: "typed" }, env);
    equal(r.records.attempts[0].correct, false);
    equal((r.records.attempts[0].answer as { raw: string }).raw, "Necesitamos querdas");
    equal(r.records.samples[0].text, "Necesitamos querdas");
    equal(r.records.supports[0].kind, "mission_language_repair");
    const v = buildMissionView(r.state, v5, "v7")!.active!.produce!;
    equal(v.repairLine, "Du möchtest sagen: Wir brauchen Seile. „Seile“ schreibt man auf Spanisch cuerdas, mit c. Versuch den Satz noch einmal.");
    ok(!JSON.stringify(buildChildView(r.state, v5, env.settings, env.now(), 0)).match(/zuordnen|zugeordnet/), "no matcher wording anywhere in the child view");
    s = m(r.state, { a: "produce", step: "S6-ROSA", response: "Necesitamos cuerdas", modality: "typed" }, env);
    const second = run(s).steps["S6-ROSA"].attempts[1];
    equal(second.correct, true);
    equal(second.evidence, "supported");
    equal(second.recall, "after-supplied");
    equal(run(s).steps["S6-ROSA"].outcome, "supported");
  });
  it("the unclear line is friendly and actionable; nothing skips to completion; exhausted tries end in supported practice or an explicit unresolved item", () => {
    const env = makeEnv();
    let s = started(env);
    s = walkOpen(s, "S1-BRIEF", env);
    s = m(s, { a: "story-done", step: "S1-BRIEF" }, env);
    s = walkOpen(s, "S3-RADIO", env);
    s = m(m(s, { a: "support", step: "S3-RADIO", kind: "play" }, env), { a: "listen-outcome", step: "S3-RADIO", outcome: "browser" }, env);
    for (const [q, v] of [["crew", "7"], ["bottles", "4"], ["ask", "Seile"]]) s = m(s, { a: "answer-question", step: "S3-RADIO", question: q, value: v }, env);
    s = walkOpen(s, "S6-ROSA", env);
    s = m(s, { a: "produce", step: "S6-ROSA", response: "hola", modality: "typed" }, env);
    equal(buildMissionView(s, v5, "v7")!.active!.produce!.feedback, rosa.feedback.unclear);
    refused(() => op(s, { op: "skip-stage", stage: "mission" as never, reason: "child" }, env));
    s = m(s, { a: "produce", step: "S6-ROSA", response: "Necesitamos agua", modality: "typed" }, env);
    refused(() => m(s, { a: "later", step: "S6-ROSA" }, env), "not-allowed");
    s = m(s, { a: "produce", step: "S6-ROSA", response: "no sé", modality: "typed" }, env);
    equal(run(s).steps["S6-ROSA"].phase, "exhausted");
    equal(buildMissionView(s, v5, "v7")!.active!.produce!.shownSentence, "Necesitamos cuerdas");
    const practiced = m(s, { a: "practice", step: "S6-ROSA", response: "Necesitamos cuerdas" }, env);
    equal(run(practiced).steps["S6-ROSA"].status, "practiced");
    equal(run(practiced).steps["S6-ROSA"].attempts.at(-1)!.evidence, "answer_exposed");
    const later = m(s, { a: "later", step: "S6-ROSA" }, env);
    equal(run(later).steps["S6-ROSA"].status, "unresolved");
    equal(stepStatuses(mission, run(later))["S7-ROSA-REPLY"], "available", "the mission continues; the item stays explicitly open");
  });
});

describe("V6-10 — earlier visits never show matcher wording to the child", () => {
  it("the frozen Visit 5 'unclear' sentence is replaced in child-facing projections; content and records are unchanged", async () => {
    const { childFacingUnclear, FRIENDLY_UNCLEAR } = await import("./family-learning-feedback.ts");
    const old = v5.language.segments.find((x) => x.id === "LANG-ES-HARBOR-CHECK")!.steps[0] as { unclear?: string };
    ok(/zuordnen/.test(old.unclear!), "the reviewed v4 content keeps its text");
    equal(childFacingUnclear(old.unclear), FRIENDLY_UNCLEAR);
    equal(childFacingUnclear("Sag den ganzen Satz."), "Sag den ganzen Satz.");
  });
});

describe("V6-09 retrieval practice — later in the mission and across visits", () => {
  it("S13 is offered only when the first request did not end independent; S8 retires the Visit 5 focus only on a fresh independent answer", () => {
    const env = makeEnv();
    const clean = wholeMission(env);
    equal(stepStatuses(mission, run(clean))["S13-RECALL-CUERDAS"], "not-needed");
    equal(clean.feedback!.focus.find((f) => f.id === "language:es:herramientas")!.status, "retired");
    const env2 = makeEnv();
    const repaired = wholeMission(env2, started(env2), "Necesitamos querdas");
    equal(run(repaired).steps["S13-RECALL-CUERDAS"].status, "done", "the repaired request is revisited later in the mission");
    equal(run(repaired).steps["S13-RECALL-CUERDAS"].attempts[0].recall, "after-supplied", "the word was supplied earlier — not fresh recall");
  });
  it("opening the word help in S6 (which lists herramientas) makes the later S8 recall after-supplied; the focus stays open", () => {
    const env = makeEnv();
    let s = started(env);
    s = walkOpen(s, "S1-BRIEF", env);
    s = m(s, { a: "story-done", step: "S1-BRIEF" }, env);
    s = walkOpen(s, "S3-RADIO", env);
    s = m(m(s, { a: "support", step: "S3-RADIO", kind: "play" }, env), { a: "listen-outcome", step: "S3-RADIO", outcome: "browser" }, env);
    for (const [q, v] of [["crew", "7"], ["bottles", "4"], ["ask", "Seile"]]) s = m(s, { a: "answer-question", step: "S3-RADIO", question: q, value: v }, env);
    s = walkOpen(s, "S6-ROSA", env);
    s = m(s, { a: "support", step: "S6-ROSA", kind: "word-bank" }, env);
    s = m(s, { a: "produce", step: "S6-ROSA", response: "Necesitamos cuerdas", modality: "word-bank" }, env);
    s = walkOpen(s, "S7-ROSA-REPLY", env);
    s = m(m(s, { a: "support", step: "S7-ROSA-REPLY", kind: "play" }, env), { a: "listen-outcome", step: "S7-ROSA-REPLY", outcome: "browser" }, env);
    s = m(s, { a: "answer-question", step: "S7-ROSA-REPLY", question: "ropes", value: "5" }, env);
    s = walkOpen(s, "S8-TOOLS", env);
    s = m(s, { a: "produce", step: "S8-TOOLS", response: "Necesitamos herramientas", modality: "typed" }, env);
    equal(run(s).steps["S8-TOOLS"].attempts[0].recall, "after-supplied");
    equal(run(s).steps["S8-TOOLS"].outcome, "supported");
    equal(s.feedback!.focus.find((f) => f.id === "language:es:herramientas")!.status, "open");
  });
});

describe("V6-04/05 finite typing block, calibrated by observed pace, global pause", () => {
  it("plans the block from the observed pace (≈ 5 minutes of focused typing), clamped to the reviewed bounds", () => {
    const env = makeEnv();
    const s = fiveVisitsDone(env);
    const plan = planTypingBlock(s, v5, mission.typingBlock, ["h"])!;
    equal(plan.paceBasis, "observed");
    ok(plan.drills.length >= mission.typingBlock.minDrills && plan.drills.length <= mission.typingBlock.maxDrills);
    ok(plan.estimatedSeconds >= 180 && plan.estimatedSeconds <= 420, `estimated ${plan.estimatedSeconds}s`);
    ok(plan.drills.some((d) => d.source === "focus" && d.lines.some((l) => l.includes("h"))) || plan.drills.length < 4, "an open focus key gets its own drill");
    const noPace = fiveVisitsDone(env);
    noPace.typing.course!.bursts = [];
    equal(planTypingBlock(noPace, v5, mission.typingBlock, [])!.paceBasis, "fallback");
  });
  it("drills follow one another without a stop/continue decision; too little typing is not an attempt; time alone never completes", () => {
    const env = makeEnv();
    let s = started(env);
    s = walkOpen(s, "S1-BRIEF", env);
    s = m(s, { a: "story-done", step: "S1-BRIEF" }, env);
    s = walkOpen(s, "S12-TYPING", env);
    s = m(s, { a: "typing-start" }, env);
    let tv = buildMissionView(s, v5, "v7")!.active!.typing!;
    equal(tv.phase, "drill");
    ok(tv.announce.includes(`${tv.planned} kurze Tippübungen`));
    s = m(s, { a: "typing-drill", no: 1, lines: tv.nextDrill!.lines.map(() => "f"), seconds: 900, activeSeconds: 900, idleSeconds: 0 }, env);
    tv = buildMissionView(s, v5, "v7")!.active!.typing!;
    equal(tv.completed, 0, "a long time with almost nothing typed is not an attempt");
    equal(tv.nextDrill!.no, 1);
    refused(() => m(s, { a: "typing-drill", no: 2, lines: ["x"], seconds: 1, activeSeconds: 1, idleSeconds: 0 }, env), "stale");
    // global pause: partial work is saved and never completes anything
    s = m(s, { a: "typing-pause", no: 1, lines: ["fff"], activeSeconds: 4 }, env);
    s = m(s, { a: "leave" }, env);
    equal(run(s).steps["S12-TYPING"].status, "active");
    equal(run(s).typing!.completedAt, null);
    // resume where it stopped
    s = m(s, { a: "open", step: "S12-TYPING" }, env);
    for (;;) {
      tv = buildMissionView(s, v5, "v7")!.active!.typing!;
      if (!tv.nextDrill) break;
      // imperfect typing still counts as an attempt (accuracy is never a gate)
      s = m(s, { a: "typing-drill", no: tv.nextDrill.no, lines: tv.nextDrill.lines.map((l) => l.slice(0, -1) + "x"), seconds: 60, activeSeconds: 45, idleSeconds: 15 }, env);
    }
    tv = buildMissionView(s, v5, "v7")!.active!.typing!;
    equal(tv.phase, "comfort");
    s = m(s, { a: "typing-comfort", comfort: null }, env);
    refused(() => m(s, { a: "typing-comfort", comfort: "ok" }, env), "not-allowed");
    equal(buildMissionView(s, v5, "v7")!.active!.typing!.phase, "extra-offer");
    s = m(s, { a: "typing-extra", take: true }, env);
    tv = buildMissionView(s, v5, "v7")!.active!.typing!;
    ok(tv.nextDrill!.extra);
    s = m(s, { a: "typing-drill", no: tv.nextDrill!.no, lines: tv.nextDrill!.lines, seconds: 40, activeSeconds: 38, idleSeconds: 2 }, env);
    equal(run(s).steps["S12-TYPING"].status, "done");
    refused(() => m(s, { a: "typing-extra", take: true }, env), "not-allowed");
  });
  it("comfort feeds the existing course progression; a declined rating invents nothing", () => {
    const env = makeEnv();
    const s = finishTyping((() => {
      let x = started(env);
      x = walkOpen(x, "S1-BRIEF", env);
      return m(x, { a: "story-done", step: "S1-BRIEF" }, env);
    })(), env);
    ok(s.typing.course!.bursts.some((b) => b.visit === "v7" && b.comfort === "ok" && b.blockId === "TYPE-BLOCK-V7"));
    equal(view(s, env).lastLesson, null, "block drills raise no per-round lesson card in the mission");
  });
  it("without a confirmed keyboard the block is an explicit unresolved item, never credit", () => {
    const env = makeEnv(v5, { keyboardLayout: null });
    let s = op(fiveVisitsDone(env), { op: "start-visit" }, env).state;
    s = walkOpen(s, "S1-BRIEF", env);
    s = m(s, { a: "story-done", step: "S1-BRIEF" }, env);
    s = walkOpen(s, "S12-TYPING", env);
    s = m(s, { a: "typing-start" }, env);
    equal(run(s).steps["S12-TYPING"].status, "unresolved");
    equal(buildMissionView(s, v5, "v7")!.active!.typing!.phase, "unavailable");
  });
});

describe("V6-11 the next-visit question and completion", () => {
  it("finishing is refused while required steps are open; a finished mission moves to the summary; the closing requires the interest answer", () => {
    const env = makeEnv();
    const s = started(env);
    refused(() => m(s, { a: "finish" }, env), "not-allowed");
    let done = wholeMission(env);
    ok(buildMissionView(done, v5, "v7")!.canFinish);
    done = m(done, { a: "finish" }, env);
    equal(currentStage(done, v5), "summary");
    done = op(done, { op: "summary-seen" }, env).state;
    const reflectView = view(done, env);
    ok(reflectView.reflection!.nextInterest!.prompt.includes("nächsten Besuch"));
    refused(() => op(done, { op: "reflect", optionId: "right" }, env), "invalid");
    refused(() => op(done, { op: "reflect", optionId: "right", interest: { kind: "text", text: "   " } }, env), "invalid");
    const r = op(done, { op: "reflect", optionId: "right", interest: { kind: "text", text: "Ich will mit dem U-Boot tauchen, glaube ich" } }, env);
    equal(r.finishedVisit, "v7");
    equal(r.records.samples.find((x) => x.kind === "next_interest")!.text, "Ich will mit dem U-Boot tauchen, glaube ich");
    deepStrictEqual(r.state.interests!.map((i) => [i.kind, i.text, i.source]), [["text", "Ich will mit dem U-Boot tauchen, glaube ich", "closing"]]);
    const review = buildParentReview(r.state, v5, "v7", null, { historical: false });
    deepStrictEqual(review.experience.childFeedback.nextInterest!.text, "Ich will mit dem U-Boot tauchen, glaube ich");
    equal(planningInput(r.state, v5).interests[0].text, "Ich will mit dem U-Boot tauchen, glaube ich");
    const report = buildVisitReports(r.state, v5).find((x) => x.visit === "v7")!;
    deepStrictEqual(report.interest, { kind: "text", text: "Ich will mit dem U-Boot tauchen, glaube ich" });
    ok(report.mission!.steps.length >= 13);
    ok(isChildView(JSON.parse(JSON.stringify(view(r.state, env))), "santiago"));
  });
  it("uncertainty and no preference are stored as such; leaving early prompts at the next entry and never invents an interest", () => {
    const env = makeEnv();
    let s = started(env);
    s = m(s, { a: "arrive", place: "office" }, env);
    // left early: nothing is recorded, the next entry asks
    equal((s.interests ?? []).length, 0);
    const prompt = view(s, env).interestPrompt!;
    equal(prompt.visit, "v7");
    s = op(s, { op: "record-interest", kind: "no-preference" }, env).state;
    equal(view(s, env).interestPrompt, null);
    deepStrictEqual(s.interests!.map((i) => [i.kind, i.text, i.source]), [["no-preference", null, "entry"]]);
    refused(() => op(s, { op: "record-interest", kind: "unsure" }, env), "not-allowed");
    const env2 = makeEnv();
    let f = m(wholeMission(env2), { a: "finish" }, env2);
    f = op(f, { op: "summary-seen" }, env2).state;
    f = op(f, { op: "reflect", optionId: null, difficultySkipped: true, interest: { kind: "unsure" } }, env2).state;
    deepStrictEqual(f.interests!.map((i) => [i.kind, i.text]), [["unsure", null]]);
  });
  it("the parent review keeps original and supported attempts apart and names the typing block's active time separately from wall time", () => {
    const env = makeEnv();
    let s = wholeMission(env, started(env), "Necesitamos querdas");
    s = m(s, { a: "finish" }, env);
    const review = buildParentReview(s, v5, "v7", null, { historical: false });
    const rosa = review.learning.objectives.filter((o) => o.taskId === "MISSION-SHIP-SUPPLY/S6-ROSA");
    deepStrictEqual(rosa.map((o) => [o.outcome, o.evidence]), [["meaning-understood-spelling-wrong", "incorrect"], ["correct", "supported"]]);
    ok(review.learning.whatHappened.some((l) => l.includes("„Necesitamos querdas“") && l.includes("querdas→cuerdas")));
    ok(review.learning.whatHappened.some((l) => /Tippblock: .*aktive Tippzeit \d+ s.*Gesamtzeit inkl\. Lesen\/Menüs/.test(l)));
    const summary = buildVisitSummary(s, v5, "v7");
    ok(summary.practiced!.text.includes("cuerdas, mit c"));
    notEqual(summary.artifact.kind, "none");
  });
});
