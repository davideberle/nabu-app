// Visit 7 (content v6, 2026-10-23): the shared learning fixes and the Rosas Inselgarten scene mission. Every fixture is
// SYNTHETIC (no child record). The "Visit 6 finished" state follows the SHAPE of the read-only October 22/23 evidence
// summary (Kisten 4,4,4 → 4,4,28 → 4,4,5; Rosa «nes», «Nesesitmos Querdas», «Necesitamos Querdas», practice «Necesitamos ue»;
// next interest unsure) — never its private content or timestamps.
import { deepStrictEqual, equal, notEqual, ok, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { asLearningContent, reconcileLearningContent, type LearningContent } from "./family-learning-content.ts";
import { analyzeProduction, buildMissionView, doneLinesFor, missionDefFor, missionEvidence, sceneEnding, stepStatuses, type MissionAction, type MissionRun } from "./family-learning-mission.ts";
import { applyLearningOp, buildChildView, currentStage, EMPTY_PARENT_SETTINGS, LearningOpError, newMissionState, nextVisitAvailability, type LearningOp, type MissionState, type OpEnv, type ParentSettings } from "./family-learning-state.ts";
import { buildVisitSummary, visitLabel } from "./family-learning-summary.ts";
import { isChildView } from "./family-learning-view-guard.ts";
import { validateTutorOutcome, type TutorDispatch } from "./family-learning-tutor-outcome.ts";
import { sanitizeTelemetryEvent } from "./family-learning-telemetry-schema.ts";
import { createTelemetryBuffer, enterStage, noteControl, noteInput, takeBatch } from "./family-learning-telemetry.ts";
import { summariseTelemetry } from "./family-learning-summary.ts";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../data/family-learning/content/${name}`, import.meta.url), "utf8"));
const rawV5 = read("santiago-expedition-v5.json");
const rawV6 = read("santiago-expedition-v6.json");
const v5: LearningContent = asLearningContent(rawV5);
const v6: LearningContent = asLearningContent(rawV6);
const ship = missionDefFor(v6, "v7")!;
const garden = missionDefFor(v6, "v8")!;

type Env = OpEnv & { settings: ParentSettings };
function makeEnv(content: LearningContent = v6, extra: Partial<OpEnv> = {}): Env {
  let t = Date.UTC(2026, 9, 24, 15, 0, 0);
  let n = 0;
  return { content, settings: { ...EMPTY_PARENT_SETTINGS, keyboardLayout: "ch-de-qwertz" }, now: () => new Date((t += 20_000)), newId: () => `id-${(n += 1)}`, ...extra };
}
function op(state: MissionState, o: LearningOp, env: Env) {
  return applyLearningOp(state, o, env);
}
const m = (s: MissionState, action: MissionAction, env: Env) => op(s, { op: "mission", action }, env).state;
const mr = (s: MissionState, action: MissionAction, env: Env) => op(s, { op: "mission", action }, env);
function refused(fn: () => unknown, code?: string, message?: RegExp) {
  throws(fn, (e: unknown) => e instanceof LearningOpError && (!code || e.code === code) && (!message || message.test(e.message)));
}
const gardenRun = (s: MissionState): MissionRun => s.missions![garden.id];
const shipRun = (s: MissionState): MissionRun => s.missions![ship.id];
const active = (s: MissionState) => buildMissionView(s, v6, "v8")!.active!;

/** Synthetic: v1, v2, v4, v5, v6 and v7 finished; v7 carries a mission run in the shape of the Visit 6 records. */
function sixVisitsDone(): MissionState {
  const s = newMissionState(v6, "santiago", "2026-09-29T10:00:00.000Z");
  const day = (d: number, h: number) => new Date(Date.UTC(2026, 8, 29 + d, h, 0, 0)).toISOString();
  s.visits = (["v1", "v2", "v4", "v5", "v6", "v7"] as const).map((id, i) => ({ id, startedAt: day(i * 3, 10), finishedAt: day(i * 3, 11), stageIndex: 99, skippedStages: [], reflection: "easy" }));
  s.base = { name: "Fixture Basis", locationId: "shore", supplies: { agua: 3, cuerdas: 1 } };
  s.harbor = { destination: "ship", planned: true, plannedAt: day(12, 10), roped: true, entered: ["typing", "planning", "closing"] };
  s.typing.alignment = { layout: "ch-de-qwertz", checkedAt: day(6, 10), result: "match", observed: [], matchesLayout: "ch-de-qwertz" };
  const burst = (lessonId: string, chars: number, seconds: number) => ({ lessonId, visit: "v7" as const, lineCount: 2, lines: [], expectedChars: chars, typedChars: chars, correctChars: chars, extraChars: 0, omittedChars: 0, substitutedChars: 0, denominator: chars, accuracy: 1, comfort: "easy" as const, metricVersion: 2 as const, seconds, at: day(15, 10) });
  s.typing.course = { layout: "ch-de-qwertz", lessonIndex: 4, bursts: [burst("TYPE-CH-COURSE-4", 16, 17), burst("TYPE-CH-COURSE-5", 24, 62)], decision: null, completed: ["TYPE-CH-COURSE-1", "TYPE-CH-COURSE-2", "TYPE-CH-COURSE-3", "TYPE-CH-COURSE-4"] };
  const focus = (id: string, kind: "typing-key" | "language" | "spacing", key: string) => ({ id, kind, key, openedAt: day(12, 10), openedIn: { visit: "v6" as const, lesson: "fixture" }, evidence: "fixture", status: "open" as const, retiredAt: null, retiredBy: null, reopened: 0 });
  s.feedback = { repairs: [], acknowledged: [], focus: [focus("language:es:herramientas", "language", "es:herramientas"), focus("spacing:rule", "spacing", "rule")] };
  // The Visit 6 run in the stored SHAPE: S13 finished "practiced" after a WRONG copy (the defect the shared fix addresses).
  const at = day(15, 10);
  const att = (no: number, raw: string, correct: boolean | null, kind: "answer" | "practice") => ({ no, at, raw, correct, evidence: (correct ? "answer_exposed" : "incorrect") as "incorrect", support: [], modality: "typed" as const, kind, recall: "after-supplied" as const });
  s.missions = {
    [ship.id]: {
      missionId: ship.id, version: 1, visit: "v7", startedAt: day(15, 10), position: "pier", visited: ["harbor", "pier"], active: null, facts: {}, shownWords: ["cuerdas", "necesitamos"], typing: null, finishedAt: day(15, 11),
      steps: {
        "S13-RECALL-CUERDAS": { status: "practiced", openedAt: at, finishedAt: at, attempts: [att(1, "nes", null, "answer"), att(2, "Nesesitmos Querdas", false, "answer"), att(3, "Necesitamos Querdas", false, "answer"), att(4, "Necesitamos ue", false, "practice")], support: [{ kind: "answer-shown", at }], plays: 0, questions: {}, phase: "finished", outcome: "practiced" },
      },
    },
  };
  s.interests = [{ id: "fixture-interest", visit: "v7", source: "closing", kind: "unsure", text: null, at: day(15, 11) }];
  return s;
}
function started(env: Env = makeEnv()) {
  return op(sixVisitsDone(), { op: "start-visit" }, env).state;
}
function openNext(s: MissionState, env: Env): MissionState {
  const next = buildMissionView(s, v6, "v8")!.beat!.next!;
  return m(s, { a: "open", step: next }, env);
}
function through(s: MissionState, env: Env, untilStep: string): MissionState {
  // Opens and completes beats in order with first-try answers until `untilStep` is open.
  for (;;) {
    s = openNext(s, env);
    const a = active(s);
    if (a.id === untilStep) return s;
    s = complete(s, env, a.id);
    s = m(s, { a: "leave" }, env);
  }
}
function complete(s: MissionState, env: Env, step: string): MissionState {
  const def = garden.steps.find((x) => x.id === step)!;
  if (def.kind === "story" || def.kind === "outcome") return m(s, { a: "story-done", step }, env);
  if (def.kind === "solve") {
    for (const p of def.solve!.parts) s = m(s, { a: "answer-part", step, part: p.id, value: String(p.answer) }, env);
    return s;
  }
  if (def.kind === "listen") {
    s = m(m(s, { a: "support", step, kind: "play" }, env), { a: "listen-outcome", step, outcome: "child-voice" }, env);
    for (const q of def.questions!) s = m(s, { a: "answer-question", step, question: q.id, value: q.answer }, env);
    return s;
  }
  if (def.kind === "recall") return m(s, { a: "produce", step, response: "Necesitamos herramientas", modality: "typed" }, env);
  if (def.kind === "typing-block") {
    s = m(s, { a: "typing-start" }, env);
    for (;;) {
      const tv = active(s).typing!;
      if (!tv.nextDrill) break;
      s = m(s, { a: "typing-drill", no: tv.nextDrill.no, lines: tv.nextDrill.lines, seconds: 50, activeSeconds: 40, idleSeconds: 10 }, env);
    }
    s = m(s, { a: "typing-comfort", comfort: "easy" }, env);
    return m(s, { a: "typing-extra", take: false }, env);
  }
  if (def.kind === "write") return m(s, { a: "write", step, text: "Heute habe ich 5 Tragen gepackt." }, env);
  throw new Error(`no completion for ${step}`);
}

describe("Visit 7 — content version 6 (additive, reviewed)", () => {
  it("v6 is a strict additive superset of v5, validates, and adds exactly visit v8 with its scene mission", () => {
    ok(reconcileLearningContent(rawV6).ok, JSON.stringify(reconcileLearningContent(rawV6).problems));
    ok(reconcileLearningContent(rawV5).ok);
    for (const key of Object.keys(rawV5)) if (!["contentVersion", "reviewed", "supersedes", "visits", "missions"].includes(key)) deepStrictEqual(rawV6[key], rawV5[key], key);
    deepStrictEqual(rawV6.visits.slice(0, rawV5.visits.length), rawV5.visits);
    deepStrictEqual(rawV6.missions[0], rawV5.missions[0]);
    deepStrictEqual(rawV6.visits.at(-1).stages, ["mission", "summary", "reflect"]);
    equal(garden.presentation, "scene");
    deepStrictEqual(garden.steps.map((x) => x.id), ["G1-REQUEST", "G2-PACK", "G3-DELIVERY", "G4-RADIO", "G5-TOOLS", "G6-TYPING", "G7-FRESH", "G8-JOURNAL", "G9-HOME"]);
    deepStrictEqual(garden.steps.find((x) => x.id === "G2-PACK")!.solve!.parts.map((p) => [p.id, p.answer, p.unit]), [["full", 4, "Tragen"], ["left", 2, "Setzlinge"], ["total", 5, "Tragen"]]);
    deepStrictEqual(garden.steps.find((x) => x.id === "G7-FRESH")!.solve!.parts.map((p) => [p.id, p.answer, p.hintsAfterFirstAttempt]), [["total", 4, true]]);
    equal(garden.theme.basis, "owner-chosen");
    ok(/not a claimed interest/.test(garden.theme.note));
  });
  it("the validator refuses praise after practice, missing teaching answers, unordered hints and a question without a question mark", () => {
    const bad = structuredClone(rawV6);
    const g = bad.missions.find((x: { id: string }) => x.id === "MISSION-ISLAND-GARDEN");
    g.steps.find((x: { id: string }) => x.id === "G5-TOOLS").doneBy.practiced = [{ speaker: "rosa", text: "¡Muy bien!", language: "es", de: "Sehr gut!" }];
    const pack = g.steps.find((x: { id: string }) => x.id === "G2-PACK");
    pack.solve.parts[0].teach = "So geht es.";
    pack.solve.parts[0].hints[1].level = 3;
    pack.solve.parts[1].question = "Setzlinge übrig";
    const problems = reconcileLearningContent(bad).problems.join("\n");
    ok(/doneBy.practiced must not praise/.test(problems), problems);
    ok(/teaching must state the answer 4/.test(problems), problems);
    ok(/hint levels must be 1, 2, 3/.test(problems), problems);
    ok(/one complete question/.test(problems), problems);
  });
});

describe("Visit 7 — progression, labels, rollback cap, Visit 6 preserved", () => {
  it("after Visit 6 the garden visit v8 is offered as Besuch 7; Visit 6 is never offered again", () => {
    const env = makeEnv();
    const s = sixVisitsDone();
    deepStrictEqual(nextVisitAvailability(s, v6, new Date()), { visit: "v8", availableAt: null });
    equal(visitLabel(s, v6, "v8"), "Besuch 7 — Rosas Inselgarten");
    const st = op(s, { op: "start-visit" }, env).state;
    equal(currentStage(st, v6), "mission");
    equal(buildMissionView(st, v6, "v8")!.presentation, "scene");
    deepStrictEqual(buildMissionView(st, v6, "v8")!.beat, { index: 1, count: 9, next: "G1-REQUEST" });
  });
  it("under CAP=5 (version-5 content) v8 is not offered, a running v8 is parked untouched and every view still builds", () => {
    const env5 = makeEnv(v5);
    deepStrictEqual(nextVisitAvailability(sixVisitsDone(), v5, new Date()), { visit: null, availableAt: null, reason: "all-visits-done" });
    const running = started();
    const before = JSON.stringify(running);
    deepStrictEqual(nextVisitAvailability(running, v5, new Date()), { visit: null, availableAt: null, reason: "chapter-unavailable" });
    refused(() => op(running, { op: "mission", action: { a: "open", step: "G1-REQUEST" } }, env5));
    ok(isChildView(JSON.parse(JSON.stringify(buildChildView(running, v5, env5.settings, new Date(), 0))), "santiago"));
    equal(JSON.stringify(running), before);
  });
  it("the stored Visit 6 run is byte-identical after a complete Visit 7 journey (immutable history)", () => {
    const env = makeEnv();
    const s0 = sixVisitsDone();
    const v7Before = JSON.stringify({ run: shipRun(s0), visit: s0.visits.find((v) => v.id === "v7"), interests: s0.interests });
    let s = op(s0, { op: "start-visit" }, env).state;
    s = through(s, env, "G9-HOME");
    s = m(s, { a: "story-done", step: "G9-HOME" }, env);
    s = m(m(s, { a: "leave" }, env), { a: "finish" }, env);
    equal(JSON.stringify({ run: shipRun(s), visit: s.visits.find((v) => v.id === "v7"), interests: s.interests!.slice(0, 1) }), v7Before);
  });
});

describe("V6-F06 — no false praise; the practice transition only counts a matching copy", () => {
  it("a stored Visit 6 run that finished 'practiced' after a WRONG copy is projected with neutral lines, never «¡Muy bien, capitán!»", () => {
    const s = sixVisitsDone();
    const step = ship.steps.find((x) => x.id === "S13-RECALL-CUERDAS")!;
    const lines = doneLinesFor(step, shipRun(s).steps["S13-RECALL-CUERDAS"]);
    ok(!lines.some((l) => /muy bien/i.test(l.text)), JSON.stringify(lines));
    ok(lines.some((l) => /stimmt noch nicht ganz/.test(l.text)));
    // The record itself is unchanged: still "practiced", the wrong copy still incorrect.
    equal(shipRun(s).steps["S13-RECALL-CUERDAS"].status, "practiced");
    equal(shipRun(s).steps["S13-RECALL-CUERDAS"].attempts.at(-1)!.correct, false);
  });
  it("success lines need success: taught / practiced / unresolved steps never show the success closing", () => {
    const step = ship.steps.find((x) => x.id === "S3-RADIO")!;
    const base = { openedAt: "", finishedAt: "", attempts: [], support: [], plays: 1, questions: {}, phase: "finished" as const };
    deepStrictEqual(doneLinesFor(step, { ...base, status: "done", outcome: "independent" }), step.done);
    ok(!doneLinesFor(step, { ...base, status: "taught", outcome: "answer_exposed" }).some((l) => /great/i.test(l.text)));
    ok(!doneLinesFor(step, { ...base, status: "unresolved", outcome: "unresolved" }).some((l) => /great/i.test(l.text)));
  });
  it("in Visit 7 a wrong copy after the shown sentence stays open (bounded); a matching copy is practiced; keep-for-later always remains", () => {
    const env = makeEnv();
    let s = through(started(env), env, "G5-TOOLS");
    for (const r of ["hola", "Necesitamos agua", "no sé"]) s = m(s, { a: "produce", step: "G5-TOOLS", response: r, modality: "typed" }, env);
    equal(gardenRun(s).steps["G5-TOOLS"].phase, "exhausted");
    equal(active(s).produce!.shownSentence, "Necesitamos herramientas");
    s = m(s, { a: "practice", step: "G5-TOOLS", response: "Necesitamos ue" }, env);
    equal(gardenRun(s).steps["G5-TOOLS"].status, "active", "a wrong copy is not practice completion");
    ok(/Noch nicht ganz gleich/.test(active(s).produce!.practiceFeedback!));
    const matched = m(s, { a: "practice", step: "G5-TOOLS", response: "Necesitamos herramientas" }, env);
    equal(gardenRun(matched).steps["G5-TOOLS"].status, "practiced");
    ok(!active(matched).done.some((l) => /claro/i.test(l.text)), "practice never gets the success line");
    s = m(s, { a: "practice", step: "G5-TOOLS", response: "Necesitamos herra" }, env);
    refused(() => m(s, { a: "practice", step: "G5-TOOLS", response: "x" }, env), "not-allowed");
    const later = m(s, { a: "later", step: "G5-TOOLS" }, env);
    equal(gardenRun(later).steps["G5-TOOLS"].status, "unresolved");
    equal(stepStatuses(garden, gardenRun(later))["G6-TYPING"], "available", "never trapped");
  });
});

describe("V7-D02 / V6-F04 — one clear question at a time; correct parts stay correct", () => {
  it("only the current question (a full sentence with its unit) is in the view; later questions are not", () => {
    const env = makeEnv();
    const s = through(started(env), env, "G2-PACK");
    const sv = active(s).solve!;
    equal(sv.parts.length, 1);
    equal(sv.parts[0].question, "Wie viele Tragen kannst du mit je 4 Setzlingen ganz füllen?");
    equal(sv.parts[0].unit, "Tragen");
    equal(sv.parts[0].value, null);
    equal(sv.parts[0].teach, null);
    deepStrictEqual(sv.facts, ["18 Setzlinge", "höchstens 4 Setzlinge in eine Trage"]);
    ok(!("answer" in sv.parts[0]) && !JSON.stringify(sv).includes('"answer":'), "no answer key in the view");
    ok(!JSON.stringify(sv).includes("G2-full-H1"), "no hint before it is requested");
  });
  it("a correct first question is preserved while the next is wrong; nothing is asked twice", () => {
    const env = makeEnv();
    let s = through(started(env), env, "G2-PACK");
    s = m(s, { a: "answer-part", step: "G2-PACK", part: "full", value: "4" }, env);
    s = m(s, { a: "answer-part", step: "G2-PACK", part: "left", value: "3" }, env);
    const sv = active(s).solve!;
    deepStrictEqual(sv.parts.map((p) => [p.id, p.status, p.value]), [["full", "correct", 4], ["left", "open", null]]);
    equal(sv.parts[1].feedback!.tone, "retry");
    refused(() => m(s, { a: "answer-part", step: "G2-PACK", part: "full", value: "4" }, env), "not-allowed");
    refused(() => m(s, { a: "answer-part", step: "G2-PACK", part: "total", value: "5" }, env), "not-allowed", /answer question left first/);
  });
  it("incomplete input and accidental Enter never become attempts; a deliberate repeat of the same wrong number is a real, flagged attempt", () => {
    const env = makeEnv();
    let s = through(started(env), env, "G2-PACK");
    for (const value of ["", "   ", "vier", "4,5", "-4", "12345"]) refused(() => m(s, { a: "answer-part", step: "G2-PACK", part: "full", value }, env), "invalid");
    equal(gardenRun(s).steps["G2-PACK"].attempts.length, 0);
    s = m(s, { a: "answer-part", step: "G2-PACK", part: "full", value: "5" }, env);
    s = m(s, { a: "answer-part", step: "G2-PACK", part: "full", value: "05" }, env);
    const attempts = gardenRun(s).steps["G2-PACK"].attempts;
    deepStrictEqual(attempts.map((a) => [a.raw, a.correct, a.repeatOf ?? null]), [["5", false, null], ["05", false, 1]]);
    equal(gardenRun(s).steps["G2-PACK"].parts!.full.misses, 2, "the deliberate repeat counts — it cannot bypass the choices");
    ok(active(s).solve!.parts[0].feedback!.text.startsWith("Das ist wieder 05."));
    equal(active(s).solve!.parts[0].feedback!.tone, "stuck");
  });
});

describe("Retries are never blocked and never expose an answer by themselves (Nabu round 2 regression scenarios)", () => {
  const exposuresOf = (rs: { records: { exposures: { kind: string; taskId: string }[] } }[]) => rs.flatMap((r) => r.records.exposures.filter((x) => x.kind === "answer_revealed").map((x) => x.taskId));
  it("first miss: one neutral recheck line; second miss: one short line — no hint, choice card or solution opened for him", () => {
    const env = makeEnv();
    let s = through(started(env), env, "G2-PACK");
    const r1 = mr(s, { a: "answer-part", step: "G2-PACK", part: "full", value: "3" }, env);
    s = r1.state;
    equal(active(s).solve!.parts[0].feedback!.text, garden.steps[1].solve!.parts[0].recheck);
    const r2 = mr(s, { a: "answer-part", step: "G2-PACK", part: "full", value: "5" }, env);
    s = r2.state;
    const pv = active(s).solve!.parts[0];
    deepStrictEqual([pv.feedback!.tone, pv.feedback!.text], ["stuck", garden.steps[1].solve!.parts[0].stuck]);
    deepStrictEqual([pv.hints.length, pv.solutionOffered, pv.teach, pv.offer], [0, false, null, null]);
    ok(r2.records.supports.some((x) => x.kind === "mission_tutor_unavailable"), "the missing diagnostic talk is recorded internally");
    deepStrictEqual(exposuresOf([r1, r2]), []);
  });
  it("three misses then correct with no hint: accepted, supported (retries), no hint invented, no exposure", () => {
    const env = makeEnv();
    let s = through(started(env), env, "G2-PACK");
    const rs: ReturnType<typeof mr>[] = [];
    for (const v of ["3", "5", "6", "4"]) {
      const r = mr(s, { a: "answer-part", step: "G2-PACK", part: "full", value: v }, env);
      rs.push(r);
      s = r.state;
    }
    const pr = gardenRun(s).steps["G2-PACK"].parts!.full;
    deepStrictEqual([pr.status, pr.evidence, pr.hints.length, pr.exposed.length], ["correct", "supported", 0, 0]);
    deepStrictEqual(exposuresOf(rs), []);
    deepStrictEqual(gardenRun(s).steps["G2-PACK"].attempts.at(-1)!.support, ["retry"]);
  });
  it("three misses, every guided step answered, a further wrong try, then correct: never blocked, no exposure", () => {
    const env = makeEnv();
    let s = through(started(env), env, "G2-PACK");
    const rs: ReturnType<typeof mr>[] = [];
    const step = (a: MissionAction) => {
      const r = mr(s, a, env);
      rs.push(r);
      s = r.state;
    };
    for (const v of ["3", "5", "6"]) step({ a: "answer-part", step: "G2-PACK", part: "full", value: v });
    step({ a: "hint", step: "G2-PACK", part: "full" });
    step({ a: "hint-check", step: "G2-PACK", part: "full", hint: "G2-full-H1", value: "16" });
    step({ a: "hint", step: "G2-PACK", part: "full" });
    step({ a: "hint-check", step: "G2-PACK", part: "full", hint: "G2-full-H2", value: "Nein" });
    equal(active(s).solve!.parts[0].solutionOffered, true, "the solution is now the last level of the hint control — offered, not shown");
    step({ a: "answer-part", step: "G2-PACK", part: "full", value: "5" });
    step({ a: "answer-part", step: "G2-PACK", part: "full", value: "4" });
    const pr = gardenRun(s).steps["G2-PACK"].parts!.full;
    deepStrictEqual([pr.status, pr.evidence, pr.exposed.length], ["correct", "supported", 0]);
    deepStrictEqual(exposuresOf(rs), []);
  });
  it("the same wrong value deliberately repeated is two attempts, the second flagged; nothing exposed", () => {
    const env = makeEnv();
    let s = through(started(env), env, "G2-PACK");
    const rs = [mr(s, { a: "answer-part", step: "G2-PACK", part: "full", value: "5" }, env)];
    rs.push(mr(rs[0].state, { a: "answer-part", step: "G2-PACK", part: "full", value: "5" }, env));
    rs.push(mr(rs[1].state, { a: "answer-part", step: "G2-PACK", part: "full", value: "5" }, env));
    s = rs[2].state;
    deepStrictEqual(gardenRun(s).steps["G2-PACK"].attempts.map((a) => a.repeatOf ?? null), [null, 1, 2]);
    equal(gardenRun(s).steps["G2-PACK"].parts!.full.misses, 3);
    deepStrictEqual(exposuresOf(rs), []);
  });
  it("the worked solution is shown only when asked for (last hint level), recorded then; a wrong copy stays open; keep-for-later after the copies is an exit, not credit", () => {
    const env = makeEnv();
    let s = through(started(env), env, "G2-PACK");
    s = m(s, { a: "answer-part", step: "G2-PACK", part: "full", value: "3" }, env);
    refused(() => m(s, { a: "show-solution", step: "G2-PACK", part: "full" }, env), "not-allowed", /last hint level/);
    s = m(s, { a: "hint", step: "G2-PACK", part: "full" }, env);
    refused(() => m(s, { a: "hint", step: "G2-PACK", part: "full" }, env), "not-allowed", /answer the question in this step first/);
    s = m(s, { a: "hint-check", step: "G2-PACK", part: "full", hint: "G2-full-H1", value: "16" }, env);
    s = m(s, { a: "hint", step: "G2-PACK", part: "full" }, env);
    s = m(s, { a: "hint-check", step: "G2-PACK", part: "full", hint: "G2-full-H2", value: "Nein" }, env);
    const shown = mr(s, { a: "show-solution", step: "G2-PACK", part: "full" }, env);
    ok(shown.records.exposures.some((x) => x.kind === "answer_revealed" && x.taskId.endsWith("/full") && x.source === "mission-part-solution-chosen"));
    s = shown.state;
    equal(active(s).solve!.parts[0].teach, garden.steps[1].solve!.parts[0].teach);
    s = m(s, { a: "practice-part", step: "G2-PACK", part: "full", value: "3" }, env);
    s = m(s, { a: "practice-part", step: "G2-PACK", part: "full", value: "5" }, env);
    equal(active(s).solve!.parts[0].practiceLeft, 0);
    s = m(s, { a: "later-part", step: "G2-PACK", part: "full" }, env);
    deepStrictEqual([gardenRun(s).steps["G2-PACK"].parts!.full.status, gardenRun(s).steps["G2-PACK"].parts!.full.evidence], ["unresolved", "answer_exposed"]);
    equal(active(s).solve!.current, "left", "the mission goes on");
  });
});

describe("N7-01 / V7-D10 — reviewed hints: exact id, order, exposure, across questions", () => {
  it("each hint level is recorded with id/type/level and the attempts before it, and only then appears in the view", () => {
    const env = makeEnv();
    let s = through(started(env), env, "G2-PACK");
    equal(active(s).solve!.parts[0].hintsLeft, 2);
    const r1 = mr(s, { a: "hint", step: "G2-PACK", part: "full" }, env);
    const row = r1.records.supports.find((x) => x.kind === "mission_hint")!;
    deepStrictEqual([(row.payload as Record<string, unknown>).hint, (row.payload as Record<string, unknown>).type, (row.payload as Record<string, unknown>).level, (row.payload as Record<string, unknown>).afterAttempts], ["G2-full-H1", "grouping", 1, 0]);
    s = r1.state;
    equal(active(s).solve!.parts[0].hints[0].text, garden.steps[1].solve!.parts[0].hints[0].text);
    // the small question inside the hint is its own record; a wrong reply shows a different representation (recorded first)
    const wrong = mr(s, { a: "hint-check", step: "G2-PACK", part: "full", hint: "G2-full-H1", value: "12" }, env);
    ok(wrong.records.attempts.some((a) => a.objective === "quotient-full-rest-needed-hint-check" && a.correct === false));
    ok(wrong.records.supports.some((x) => x.kind === "mission_representation"));
    s = wrong.state;
    ok(active(s).solve!.parts[0].hints[0].check!.representation);
    s = m(s, { a: "answer-part", step: "G2-PACK", part: "full", value: "4" }, env);
    const pr = gardenRun(s).steps["G2-PACK"].parts!.full;
    equal(pr.evidence, "supported");
    deepStrictEqual(gardenRun(s).steps["G2-PACK"].attempts.at(-1)!.hintsBefore, ["G2-full-H1"]);
  });
  it("help on an earlier question makes a later first answer supported (rule 3); a hint that shows the answer is answer exposure", () => {
    const env = makeEnv();
    let s = through(started(env), env, "G2-PACK");
    s = m(s, { a: "hint", step: "G2-PACK", part: "full" }, env);
    s = m(s, { a: "answer-part", step: "G2-PACK", part: "full", value: "4" }, env);
    s = m(s, { a: "answer-part", step: "G2-PACK", part: "left", value: "2" }, env);
    equal(gardenRun(s).steps["G2-PACK"].parts!.left.evidence, "supported");
    deepStrictEqual(gardenRun(s).steps["G2-PACK"].parts!.left.inheritedSupport, ["earlier-hint:G2-full-H1"]);
    s = m(s, { a: "hint", step: "G2-PACK", part: "total" }, env);
    refused(() => m(s, { a: "hint", step: "G2-PACK", part: "total" }, env), "not-allowed", /answer the question in this step first/);
    s = m(s, { a: "hint-check", step: "G2-PACK", part: "total", hint: "G2-total-H1", value: "Ja" }, env);
    const exposing = mr(s, { a: "hint", step: "G2-PACK", part: "total" }, env);
    ok(exposing.records.exposures.some((x) => x.kind === "answer_revealed" && x.taskId.endsWith("/total")));
    s = m(exposing.state, { a: "answer-part", step: "G2-PACK", part: "total", value: "5" }, env);
    equal(gardenRun(s).steps["G2-PACK"].parts!.total.evidence, "answer_exposed");
    equal(gardenRun(s).steps["G2-PACK"].outcome, "answer_exposed");
    refused(() => m(s, { a: "hint", step: "G2-PACK", part: "total" }, env), "not-allowed");
  });
  it("no further hint than the reviewed ladder; hints of the fresh application only after its first attempt", () => {
    const env = makeEnv();
    let s = through(started(env), env, "G7-FRESH");
    equal(active(s).solve!.parts[0].hintAllowed, false);
    refused(() => m(s, { a: "hint", step: "G7-FRESH", part: "total" }, env), "not-allowed", /try the question first/);
    s = m(s, { a: "answer-part", step: "G7-FRESH", part: "total", value: "3" }, env);
    equal(active(s).solve!.parts[0].hintAllowed, true);
    for (const [h, v] of [["G7-total-H1", "9"], ["G7-total-H2", "2"], ["G7-total-H3", "Ja"]]) {
      s = m(s, { a: "hint", step: "G7-FRESH", part: "total" }, env);
      equal(active(s).solve!.parts[0].hintPending, true);
      s = m(s, { a: "hint-check", step: "G7-FRESH", part: "total", hint: h, value: v }, env);
    }
    refused(() => m(s, { a: "hint", step: "G7-FRESH", part: "total" }, env), "not-allowed", /no further hint/);
  });
});

describe("Supported correction versus fresh application (V7-D11, beat 8)", () => {
  it("the packing task after hints stays supported; a first-try fresh application is independent and labelled same-day application", () => {
    const env = makeEnv();
    let s = through(started(env), env, "G2-PACK");
    s = m(s, { a: "answer-part", step: "G2-PACK", part: "full", value: "4" }, env);
    s = m(s, { a: "answer-part", step: "G2-PACK", part: "left", value: "2" }, env);
    s = m(s, { a: "answer-part", step: "G2-PACK", part: "total", value: "4" }, env);
    s = m(s, { a: "hint", step: "G2-PACK", part: "total" }, env);
    s = m(s, { a: "hint-check", step: "G2-PACK", part: "total", hint: "G2-total-H1", value: "Ja" }, env);
    s = m(s, { a: "answer-part", step: "G2-PACK", part: "total", value: "5" }, env);
    equal(gardenRun(s).steps["G2-PACK"].outcome, "supported");
    s = m(s, { a: "leave" }, env);
    s = through(s, env, "G7-FRESH");
    s = m(s, { a: "answer-part", step: "G7-FRESH", part: "total", value: "4" }, env);
    equal(gardenRun(s).steps["G7-FRESH"].outcome, "independent");
    const ev = missionEvidence(s, v6, "v8")!;
    const pack = ev.steps.find((x) => x.id === "G2-PACK")!;
    deepStrictEqual(pack.questions.map((q) => q.result), ["first-try", "first-try", "after-hint"]);
    deepStrictEqual(pack.questions[2].answers.map((a) => [a.raw, a.correct, a.kind]), [["4", false, "answer"], ["Ja", true, "hint-check"], ["5", true, "answer"]]);
    ok(pack.missing.some((x) => /Erklärung des Rechenwegs zu «total»: nicht erhoben/.test(x)));
    ok(pack.missing.some((x) => /Ursache der falschen Antwort/.test(x)));
    const fresh = ev.steps.find((x) => x.id === "G7-FRESH")!;
    equal(fresh.questions[0].result, "first-try");
    ok(/Frische Anwendung am selben Tag/.test(fresh.laterCheck!) && /kein Nachweis für Behalten/.test(fresh.laterCheck!));
    ok(ending(s).success!.startsWith("Die zweite Lieferung"));
  });
});
const ending = (s: MissionState) => sceneEnding(garden, gardenRun(s));

describe("Listening, audio failure and an honest fallback (V6-F09, beat 5)", () => {
  it("a failed playback unlocks nothing and is never listening credit; the text help unlocks a supported answer", () => {
    const env = makeEnv();
    let s = through(started(env), env, "G4-RADIO");
    s = m(m(s, { a: "support", step: "G4-RADIO", kind: "play" }, env), { a: "listen-outcome", step: "G4-RADIO", outcome: "failed" }, env);
    refused(() => m(s, { a: "answer-question", step: "G4-RADIO", question: "plants", value: "Ins Gewächshaus" }, env), "not-allowed");
    s = m(s, { a: "support", step: "G4-RADIO", kind: "transcript" }, env);
    s = m(s, { a: "answer-question", step: "G4-RADIO", question: "plants", value: "Ins Gewächshaus" }, env);
    s = m(s, { a: "answer-question", step: "G4-RADIO", question: "tools", value: "Am Tor" }, env);
    equal(gardenRun(s).steps["G4-RADIO"].outcome, "supported");
    const ev = missionEvidence(s, v6, "v8")!.steps.find((x) => x.id === "G4-RADIO")!;
    ok(ev.observed.some((x) => /fehlgeschlagen 1×/.test(x)));
    ok(ev.missing.some((x) => /hörbar/.test(x)));
  });
});

describe("Spanish near miss (V6-F07, beat 6)", () => {
  it("acknowledges the understood word first, then ONE correction; only the shown word counts as supplied", () => {
    const g5 = garden.steps.find((x) => x.id === "G5-TOOLS")!;
    const a = analyzeProduction(g5.produce!, "Nesesitamos herramentas");
    equal(a.kind, "spelling");
    const env = makeEnv();
    let s = through(started(env), env, "G5-TOOLS");
    s = m(s, { a: "produce", step: "G5-TOOLS", response: "Nesesitamos herramentas", modality: "typed" }, env);
    const line = active(s).produce!.repairLine!;
    ok(line.startsWith("Rosa versteht dich"), line);
    ok(line.includes("ne-ce-si-ta-mos") && !line.includes("rr in der Mitte"), "one correction per try");
    deepStrictEqual(gardenRun(s).shownWords, ["necesitamos"]);
    s = m(s, { a: "produce", step: "G5-TOOLS", response: "Necesitamos herramentas", modality: "typed" }, env);
    ok(active(s).produce!.repairLine!.includes("rr in der Mitte"));
    s = m(s, { a: "produce", step: "G5-TOOLS", response: "Necesitamos herramientas", modality: "typed" }, env);
    equal(gardenRun(s).steps["G5-TOOLS"].status, "done");
    equal(gardenRun(s).steps["G5-TOOLS"].outcome, "supported");
    equal(s.feedback!.focus.find((f) => f.id === "language:es:herramientas")!.status, "open", "a helped answer never retires the retrieval focus");
  });
  it("a fresh, first-try request retires the earlier herramientas focus", () => {
    const env = makeEnv();
    let s = through(started(env), env, "G5-TOOLS");
    s = m(s, { a: "produce", step: "G5-TOOLS", response: "Necesitamos herramientas.", modality: "typed" }, env);
    equal(gardenRun(s).steps["G5-TOOLS"].outcome, "independent");
    equal(s.feedback!.focus.find((f) => f.id === "language:es:herramientas")!.status, "retired");
  });
});

describe("Own German sentence (beat 9, D-W1)", () => {
  it("a flagged sentence gets ONE correction; original and revision are kept apart; no meaning verdict", () => {
    const env = makeEnv();
    let s = through(started(env), env, "G8-JOURNAL");
    refused(() => m(s, { a: "write", step: "G8-JOURNAL", text: "   " }, env), "invalid");
    s = m(s, { a: "write", step: "G8-JOURNAL", text: "Heute habeich 5Tragen gepackt." }, env);
    const w = active(s).write!;
    ok(w.correction && w.correction.marked.length > 0);
    s = m(s, { a: "revise", step: "G8-JOURNAL", text: "Heute habeich 5 Tragen gepackt." }, env);
    const r = gardenRun(s).steps["G8-JOURNAL"];
    equal(r.status, "done");
    equal(r.writing!.original, "Heute habeich 5Tragen gepackt.");
    equal(r.writing!.revision!.text, "Heute habeich 5 Tragen gepackt.");
    ok(missionEvidence(s, v6, "v8")!.steps.find((x) => x.id === "G8-JOURNAL")!.missing.some((x) => /Inhalt und Grammatik/.test(x)));
  });
});

describe("Short truthful ending and the next adventure (V7-D12, V7-D13)", () => {
  it("world accounting is coherent: two shipments (18 + 11 = 29) in separate pictures; the greenhouse choice is an extension; tool question uses place words", () => {
    const g9 = garden.steps.find((x) => x.id === "G9-HOME")!;
    deepStrictEqual(g9.shipments!.map((x) => [x.diagram.total, x.diagram.perGroup]), [[18, 4], [11, 3]]);
    ok(g9.intro[0].text.includes("18") && g9.intro[0].text.includes("11"));
    equal(garden.world.find((w) => w.id === "W-GARDEN")!.count, 29);
    ok(/vergrössern/.test(garden.nextAdventure!.choices[0].label) && /voll/.test(garden.nextAdventure!.prompt));
    deepStrictEqual(garden.steps.find((x) => x.id === "G4-RADIO")!.questions!.find((q) => q.id === "tools")!.options, ["Im Gewächshaus", "Am Tor", "Auf dem Boot"]);
    ok(!/herramienta/i.test(JSON.stringify(garden.steps.slice(0, 4))), "no advance exposure of the Spanish target word before its request");
  });
  it("all first-try → the fresh application is named; with help → an honest 'mit Hilfe' line; never a zero-mistake claim", () => {
    const env = makeEnv();
    let s = through(started(env), env, "G9-HOME");
    const e = active(s).ending!;
    ok(e.success!.includes("beim ersten Versuch"), JSON.stringify({ e, g7: gardenRun(s).steps["G7-FRESH"] }));
    ok(!/ohne Fehler|perfekt|Profi/i.test(JSON.stringify(e)));
    const env2 = makeEnv();
    let h = through(started(env2), env2, "G2-PACK");
    for (const p of ["full", "left", "total"]) {
      h = m(h, { a: "hint", step: "G2-PACK", part: p }, env2);
      h = m(h, { a: "answer-part", step: "G2-PACK", part: p, value: String(garden.steps[1].solve!.parts.find((x) => x.id === p)!.answer) }, env2);
    }
    h = m(h, { a: "leave" }, env2);
    h = through(h, env2, "G7-FRESH");
    h = m(h, { a: "answer-part", step: "G7-FRESH", part: "total", value: "3" }, env2);
    h = m(h, { a: "answer-part", step: "G7-FRESH", part: "total", value: "4" }, env2);
    const he = ending(h);
    // Math needed help everywhere, so the ending names the one success that really happened first-try (the Spanish request) —
    // and never claims the math was first-try.
    equal(he.success, "Du hast Rosa auf Spanisch gesagt: «Necesitamos herramientas».");
    equal(he.next, "Nächstes Mal sagst du Rosa noch einmal auf Spanisch, was ihr braucht.".length > 0 ? he.next : "", "one next step");
    ok(!/Lieferung: Du hast beim ersten Versuch/.test(he.success ?? ""));
  });
  it("the closing offers concrete choices; a picked choice is stored as the child's choice; an unknown choice is refused; leaving without choosing stays honest", () => {
    const env = makeEnv();
    let s = through(started(env), env, "G9-HOME");
    s = m(m(m(s, { a: "story-done", step: "G9-HOME" }, env), { a: "leave" }, env), { a: "finish" }, env);
    const summary = buildVisitSummary(s, v6, "v8");
    ok(summary.success && summary.success.text.length < 90, summary.success?.text);
    s = op(s, { op: "summary-seen" }, env).state;
    const v = buildChildView(s, v6, env.settings, new Date(), 0);
    deepStrictEqual(v.reflection!.adventure!.choices.map((c) => c.id), ["greenhouse", "water"]);
    refused(() => op(s, { op: "reflect", optionId: null, difficultySkipped: true, interest: { kind: "choice", choice: "volcano" } }, env), "invalid");
    const done = op(s, { op: "reflect", optionId: null, difficultySkipped: true, interest: { kind: "choice", choice: "greenhouse" } }, env);
    deepStrictEqual(done.state.interests!.at(-1)!.kind, "choice");
    equal(done.state.interests!.at(-1)!.choice, "greenhouse");
    equal(done.state.interests!.at(-1)!.text, "Das Gewächshaus vergrössern");
    const declined = op(s, { op: "reflect", optionId: null, difficultySkipped: true, interest: { kind: "declined" } }, env);
    equal(declined.state.interests!.at(-1)!.choice, undefined);
    ok(isChildView(JSON.parse(JSON.stringify(buildChildView(done.state, v6, env.settings, new Date(), 0))), "santiago"));
  });
});

describe("N7-04 / N7-06 — Nokt entry points and the structured tutor outcome contract", () => {
  it("opening Nokt is recorded with its entry point and availability, never as help; dispatch and outcome are refused while unavailable", () => {
    const env = makeEnv();
    let s = through(started(env), env, "G2-PACK");
    const r = mr(s, { a: "tutor-open", step: "G2-PACK", entry: "manual", part: "full" }, env);
    const row = r.records.supports.find((x) => x.kind === "mission_tutor_open")!;
    deepStrictEqual([(row.payload as Record<string, unknown>).available, (row.payload as Record<string, unknown>).help], [false, false]);
    s = r.state;
    s = m(s, { a: "answer-part", step: "G2-PACK", part: "full", value: "4" }, env);
    equal(gardenRun(s).steps["G2-PACK"].parts!.full.evidence, "independent", "opening Nokt is not help");
    refused(() => m(s, { a: "tutor-dispatch", step: "G2-PACK", part: "left", purpose: "diagnostic", entry: "manual", turnId: "turn-000001", sessionId: "s1" }, env), "not-available");
    refused(() => m(s, { a: "tutor-outcome", step: "G2-PACK", outcome: {} }, env), "not-available");
  });
  it("with a (test-only) available tutor: the repeated-error offer appears once and can be dismissed; it never starts anything", () => {
    const env = makeEnv(v6, { tutorAvailable: true });
    let s = through(started(env), env, "G2-PACK");
    s = m(s, { a: "answer-part", step: "G2-PACK", part: "full", value: "3" }, env);
    s = m(s, { a: "answer-part", step: "G2-PACK", part: "full", value: "5" }, env);
    equal(buildMissionView(s, v6, "v8", { tutorAvailable: true })!.active!.solve!.parts[0].offer, "shown");
    s = m(s, { a: "tutor-offer", step: "G2-PACK", part: "full", response: "dismissed" }, env);
    equal(buildMissionView(s, v6, "v8", { tutorAvailable: true })!.active!.solve!.parts[0].offer, null);
    refused(() => m(s, { a: "tutor-offer", step: "G2-PACK", part: "full", response: "accepted" }, env), "not-allowed");
  });
  it("forged, stale, cross-child, replayed, unsupported and free-text results are refused; a bound verified result is stored as the tutor's revisable assessment", () => {
    const base = { child: "santiago", origin: "verified" as const, nowIso: "2026-10-24T15:05:00.000Z", currentRevision: 3 };
    const dispatch: TutorDispatch = { turnId: "turn-000001", child: "santiago", missionId: garden.id, visit: "v8", step: "G2-PACK", part: "total", taskVersion: 1, sessionId: "nokt-1", revision: 3, purpose: "reflection", entry: "planned", at: "2026-10-24T15:00:00.000Z", status: "pending" };
    const claim = { v: 1, turnId: "turn-000001", child: "santiago", missionId: garden.id, visit: "v8", step: "G2-PACK", part: "total", taskVersion: 1, sessionId: "nokt-1", revision: 3, status: "understood", evidence: { attempts: [3], transcriptTurns: 2 }, support: { kind: "none", answerExposed: false }, next: "advance" };
    const q = { status: "correct" as const, attemptNos: [3], helped: false, answerExposed: false };
    ok(validateTutorOutcome(claim, { ...base, dispatch, question: q }).ok);
    const reason = (raw: unknown, over: Partial<Parameters<typeof validateTutorOutcome>[1]> = {}) => {
      const v = validateTutorOutcome(raw, { ...base, dispatch, question: q, ...over });
      return v.ok ? "ok" : v.reason;
    };
    equal(reason("Santi hat es verstanden. PASS"), "malformed");
    equal(reason({ ...claim, verdict: "pass" }), "malformed");
    equal(reason({ ...claim, status: "passed" }), "malformed");
    equal(reason(claim, { origin: "missing" }), "origin-unverified");
    equal(reason(claim, { origin: "invalid" }), "origin-unverified");
    equal(reason(claim, { child: "isabel" }), "cross-child");
    equal(reason({ ...claim, child: "isabel" }), "cross-child");
    equal(reason({ ...claim, step: "G7-FRESH" }), "binding-mismatch");
    equal(reason({ ...claim, revision: 2 }), "binding-mismatch");
    equal(reason(claim, { currentRevision: 4 }), "stale");
    equal(reason(claim, { nowIso: "2026-10-24T15:30:00.000Z" }), "stale");
    equal(reason(claim, { dispatch: { ...dispatch, status: "consumed" } }), "unknown-or-consumed");
    equal(reason({ ...claim, evidence: { attempts: [9], transcriptTurns: 2 } }), "evidence-mismatch");
    equal(reason(claim, { question: { ...q, helped: true } }), "false-independent");
    equal(reason({ ...claim, support: { kind: "teaching", answerExposed: false } }), "false-independent");
    equal(reason({ ...claim, status: "needs_practice", next: "advance" }), "transition-not-allowed");
    equal(reason({ ...claim, status: "understood_with_support", support: { kind: "clarification", answerExposed: false }, next: "advance" }), "ok");
    // a diagnostic talk about an open question can never mark it answered
    equal(reason({ ...claim, next: "advance" }, { dispatch: { ...dispatch, purpose: "diagnostic" }, question: { ...q, status: "open" } }), "transition-not-allowed");
  });
  it("through the engine: dispatch is recorded first; a verified bound result is stored once; a new answer makes an older result stale", () => {
    const env = makeEnv(v6, { tutorAvailable: true, tutorOrigin: "verified" });
    let s = through(started(env), env, "G2-PACK");
    s = m(s, { a: "answer-part", step: "G2-PACK", part: "full", value: "3" }, env);
    const d = mr(s, { a: "tutor-dispatch", step: "G2-PACK", part: "full", purpose: "diagnostic", entry: "manual", turnId: "turn-000001", sessionId: "nokt-1" }, env);
    ok(d.records.supports.some((x) => x.kind === "mission_tutor_dispatch"));
    const dispatch = (d.result as { dispatch: TutorDispatch }).dispatch;
    s = d.state;
    const claim = { v: 1, turnId: dispatch.turnId, child: "santiago", missionId: garden.id, visit: "v8", step: "G2-PACK", part: "full", taskVersion: 1, sessionId: "nokt-1", revision: dispatch.revision, status: "not_established", evidence: { attempts: [1], transcriptTurns: 1 }, support: { kind: "clarification", answerExposed: false }, next: "retry" };
    // the child answers again before the tutor's result arrives: the older result no longer describes the work → stale
    const answered = m(s, { a: "answer-part", step: "G2-PACK", part: "full", value: "5" }, env);
    refused(() => m(answered, { a: "tutor-outcome", step: "G2-PACK", outcome: claim }, env), "invalid", /stale/);
    // an unverified origin is refused even when everything else binds
    refused(() => m(s, { a: "tutor-outcome", step: "G2-PACK", outcome: claim }, { ...env, tutorOrigin: "missing" }), "invalid", /origin-unverified/);
    const accepted = mr(s, { a: "tutor-outcome", step: "G2-PACK", outcome: claim }, env);
    s = accepted.state;
    equal(gardenRun(s).steps["G2-PACK"].tutorOutcomes!.length, 1);
    equal(gardenRun(s).steps["G2-PACK"].tutorOutcomes![0].note, "Einschätzung des Tutors, revidierbar — kein Nachweis von Können");
    refused(() => m(s, { a: "tutor-outcome", step: "G2-PACK", outcome: claim }, env), "stale", /unknown-or-consumed/);
    // the help in the talk is recorded: the later correct answer is supported, never independent
    s = m(s, { a: "answer-part", step: "G2-PACK", part: "full", value: "4" }, env);
    equal(gardenRun(s).steps["G2-PACK"].parts!.full.evidence, "supported");
    equal(gardenRun(s).steps["G2-PACK"].parts!.full.status, "correct", "the talk did not answer the question — the child did");
  });
});

describe("View guard and child view", () => {
  it("every Visit 7 beat builds a child view that passes the guard", () => {
    const env = makeEnv();
    let s = started(env);
    for (;;) {
      const v = buildChildView(s, v6, env.settings, new Date(), 0);
      ok(isChildView(JSON.parse(JSON.stringify(v)), "santiago"), `guard at ${v.mission?.active?.id ?? v.mission?.beat?.next}`);
      const next = v.mission?.beat?.next;
      if (!next) break;
      s = m(s, { a: "open", step: next }, env);
      ok(isChildView(JSON.parse(JSON.stringify(buildChildView(s, v6, env.settings, new Date(), 0))), "santiago"), `guard in ${next}`);
      s = m(complete(s, env, next), { a: "leave" }, env);
    }
    notEqual(gardenRun(s).steps["G9-HOME"], undefined);
  });
});

describe("N7-02 — the existing telemetry, reconciled (no parallel store, no keystrokes, closed vocabulary)", () => {
  it("a mission step id is accepted only inside the mission stage and only from the reviewed list", () => {
    deepStrictEqual(sanitizeTelemetryEvent({ t: 1, kind: "stage-enter", stage: "mission", step: "G2-PACK" }), { t: 1, kind: "stage-enter", stage: "mission", step: "G2-PACK" });
    equal(sanitizeTelemetryEvent({ t: 1, kind: "stage-enter", stage: "mission", step: "Ich glaube es sind 4" }), null);
    equal(sanitizeTelemetryEvent({ t: 1, kind: "stage-enter", stage: "summary", step: "G2-PACK" }), null);
    deepStrictEqual(sanitizeTelemetryEvent({ t: 1, kind: "control", stage: "mission", step: "G2-PACK", detail: { name: "hint-open", text: "secret" } }), { t: 1, kind: "control", stage: "mission", step: "G2-PACK", detail: { name: "hint-open" } });
    equal(sanitizeTelemetryEvent({ t: 1, kind: "control", stage: "mission", detail: { name: "keystroke" } }), null);
  });
  it("per-step entry, exit and active time are attributed to the step on screen; the parent summary carries them", () => {
    let b = createTelemetryBuffer();
    b = enterStage(b, "mission", 0, "G2-PACK");
    b = noteInput(b, 1000);
    b = noteInput(b, 31_000);
    b = noteControl(b, 32_000, "hint-open");
    b = enterStage(b, "mission", 40_000, "G3-DELIVERY");
    b = noteInput(b, 41_000);
    const { batch } = takeBatch(b, 51_000, "batch-1");
    ok(batch!.events.some((e) => e.kind === "stage-exit" && e.step === "G2-PACK"));
    ok(batch!.events.some((e) => e.kind === "control" && e.step === "G2-PACK"));
    const summary = summariseTelemetry(batch!.events, 1, ["mission", "summary", "reflect"]);
    deepStrictEqual(summary.byStep, { "G2-PACK": { enters: 1, activeSeconds: 39 }, "G3-DELIVERY": { enters: 1, activeSeconds: 10 } });
  });
});

describe("Nokt turn through the engine — his line first, verified reply, app phases (fictional, offline)", () => {
  const reply = (say: string, intent: string, outcome: unknown = null) => JSON.stringify({ v: 1, say, intent, outcome });
  type Turn = { request: { context: { phase: string; resultAllowed: boolean }; transcript: unknown[] }; reqHash: string; dispatch: TutorDispatch };
  function atG2(env: Env) {
    let s = through(started(env), env, "G2-PACK");
    s = m(s, { a: "answer-part", step: "G2-PACK", part: "full", value: "3" }, env);
    return s;
  }
  const dispatchTurn = (s: MissionState, env: Env, turnId: string, text: string) => mr(s, { a: "tutor-dispatch", step: "G2-PACK", part: "full", purpose: "diagnostic", entry: "manual", turnId, sessionId: "talk-1", text, via: "voice" }, env);
  const replyTurn = (s: MissionState, env: Env, turnId: string, json: string, origin: "verified" | "missing" | "invalid" = "verified") => mr(s, { a: "tutor-reply", step: "G2-PACK", turnId, reply: json }, { ...env, tutorOrigin: origin });
  const g2 = (s: MissionState) => gardenRun(s).steps["G2-PACK"];

  it("his line is recorded before anything is asked; the request carries what he sees and the app's phase — never the answer", () => {
    const env = makeEnv(v6, { tutorAvailable: true });
    const d = dispatchTurn(atG2(env), env, "turn-a00001", "ich glaube fünf");
    const t = d.result as unknown as Turn;
    equal(t.request.context.phase, "nachfragen");
    equal(t.request.context.resultAllowed, false);
    ok(!/"answer"/.test(JSON.stringify(t.request)));
    ok(/^[0-9a-f]{64}$/.test(t.reqHash));
    equal(t.dispatch.reqHash, t.reqHash);
    deepStrictEqual(g2(d.state).tutorTurns!.map((x) => [x.role, x.text, x.via]), [["child", "ich glaube fünf", "voice"]]);
    ok(d.records.supports.some((x) => x.kind === "mission_tutor_dispatch" && (x.payload as { text?: string }).text === "ich glaube fünf"));
  });

  it("a verified, fitting reply is shown as Nokt; prose completes nothing", () => {
    const env = makeEnv(v6, { tutorAvailable: true });
    let s = dispatchTurn(atG2(env), env, "turn-a00002", "fünf").state;
    const r = replyTurn(s, env, "turn-a00002", reply("Super, das schaffst du! Was sollst du bei dieser Frage herausfinden?", "clarify"));
    s = r.state;
    deepStrictEqual(r.result, { shown: true, say: "Super, das schaffst du! Was sollst du bei dieser Frage herausfinden?", intent: "clarify", outcome: null });
    equal(g2(s).parts!.full.status, "open", "no false completion from prose");
    equal(g2(s).status, "active");
    equal((g2(s).parts!.full.inheritedSupport ?? []).length, 0);
  });

  it("ADVERSARIAL: an unverified or forged reply (origin missing/invalid) is withheld; he sees the reviewed app line", () => {
    const env = makeEnv(v6, { tutorAvailable: true });
    const s = dispatchTurn(atG2(env), env, "turn-a00003", "fünf").state;
    for (const origin of ["missing", "invalid"] as const) {
      const r = replyTurn(s, env, "turn-a00003", reply("Was sollst du herausfinden?", "clarify"), origin);
      deepStrictEqual(r.result, { shown: false, reason: `origin-${origin}`, line: "Nokt hat gerade keine passende Antwort. Probier es oben noch einmal oder öffne den Hinweis." });
      equal(g2(r.state).tutorTurns!.at(-1)!.shown, false);
    }
  });

  it("ADVERSARIAL: the model's «teach» label with the answer in the assessment phase is withheld — no help, no exposure", () => {
    const env = makeEnv(v6, { tutorAvailable: true });
    const s = dispatchTurn(atG2(env), env, "turn-a00004", "fünf").state;
    const r = replyTurn(s, env, "turn-a00004", reply("Es sind 4 Tragen, 2 Setzlinge bleiben übrig.", "teach"));
    equal((r.result as { reason: string }).reason, "intent-not-in-phase");
    equal(g2(r.state).parts!.full.exposed.length, 0);
    equal((g2(r.state).parts!.full.inheritedSupport ?? []).length, 0);
  });

  it("replay: a second reply to the same turn is refused; a stale reply (he answered again meanwhile) is withheld", () => {
    const env = makeEnv(v6, { tutorAvailable: true });
    let s = dispatchTurn(atG2(env), env, "turn-a00005", "fünf").state;
    const first = replyTurn(s, env, "turn-a00005", reply("Was sollst du herausfinden?", "clarify")).state;
    refused(() => replyTurn(first, env, "turn-a00005", reply("Was sollst du herausfinden?", "clarify")), "not-allowed", /already/);
    s = dispatchTurn(first, env, "turn-a00006", "warte").state;
    s = m(s, { a: "answer-part", step: "G2-PACK", part: "full", value: "6" }, env);
    equal((replyTurn(s, env, "turn-a00006", reply("Wie bist du auf deine Zahl gekommen?", "ask-method")).result as { reason: string }).reason, "stale");
    refused(() => replyTurn(s, env, "turn-unknown1", reply("x", "clarify")), "stale");
  });

  it("cancel: a dispatch without a reply leaves his line, no Nokt line and no result; the next turn works", () => {
    const env = makeEnv(v6, { tutorAvailable: true });
    let s = dispatchTurn(atG2(env), env, "turn-a00007", "fünf").state;
    equal(g2(s).tutorTurns!.filter((t) => t.role === "nokt").length, 0);
    equal(g2(s).tutorDispatches!.at(-1)!.status, "pending");
    s = dispatchTurn(s, env, "turn-a00008", "nochmal").state;
    equal(replyTurn(s, env, "turn-a00008", reply("Was sollst du herausfinden?", "clarify")).result!.shown, true);
  });

  it("ADVERSARIAL: a judgement needs a clarification first; after two clarifications the app moves to teaching, which is help", () => {
    const env = makeEnv(v6, { tutorAvailable: true });
    let s = dispatchTurn(atG2(env), env, "turn-b00001", "fünf").state;
    // The model gives its judgement only; the app binds it to the dispatch (turn id kept in the call for readability).
    const claim = (_turnId: string, status: string, support: string, next: string) => ({ status, support, next });
    const premature = replyTurn(s, env, "turn-b00001", reply("Was sollst du herausfinden?", "clarify", claim("turn-b00001", "needs_practice", "none", "hint")));
    deepStrictEqual((premature.result as { outcome: unknown }).outcome, { refused: "premature-judgement" });
    s = premature.state;
    s = dispatchTurn(s, env, "turn-b00002", "wie viele Tragen").state;
    s = replyTurn(s, env, "turn-b00002", reply("Wie bist du auf fünf gekommen?", "ask-method")).state;
    // two clarifications done: the next request is in the teaching phase, a third clarification is withheld
    const third = dispatchTurn(s, env, "turn-b00003", "geraten");
    equal((third.result as unknown as Turn).request.context.phase, "erklaeren");
    s = third.state;
    equal((replyTurn(s, env, "turn-b00003", reply("Und was denkst du jetzt?", "clarify")).result as { reason: string }).reason, "intent-not-in-phase");
    s = dispatchTurn(replyTurn(s, env, "turn-b00003", reply("x", "clarify")).state, env, "turn-b00004", "weiss nicht").state;
    const taught = replyTurn(s, env, "turn-b00004", reply("Schau: In jede Trage kommen 4 Setzlinge. Wie viele sind in 2 vollen Tragen?", "teach", claim("turn-b00004", "understood", "clarification", "retry")));
    deepStrictEqual((taught.result as { outcome: unknown }).outcome, { refused: "support-understated" });
    s = taught.state;
    deepStrictEqual(g2(s).parts!.full.inheritedSupport, ["tutor:teaching"]);
    // the later correct answer is supported — teaching never gives independent credit
    s = m(s, { a: "answer-part", step: "G2-PACK", part: "full", value: "4" }, env);
    equal(g2(s).parts!.full.evidence, "supported");
    // the parent sees the whole talk: his words, Nokt's verified lines and the withheld replies with the reason
    const talk = missionEvidence(s, v6, "v8")!.steps.find((x) => x.id === "G2-PACK")!.talk;
    ok(talk.some((t) => t.who === "Kind" && t.text === "fünf" && /gesprochen/.test(t.detail)));
    ok(talk.some((t) => t.who === "Nokt" && /geprüft/.test(t.detail)));
    ok(talk.some((t) => t.who === "zurückgehalten" && t.detail === "passte nicht zur Gesprächsphase"));
  });

  it("an accepted reply's judgement is bound by the app and validated: accepted with help, refused as false independence after a hint; recorded for the parent", () => {
    const env = makeEnv(v6, { tutorAvailable: true });
    // case 1: one answered clarification, no help → a supported judgement is accepted, the question stays open
    let s = dispatchTurn(atG2(env), env, "turn-o00001", "fünf, die halbe Trage zählt auch").state;
    s = replyTurn(s, env, "turn-o00001", reply("Was bedeutet «ganz füllen» in der Frage?", "clarify")).state;
    s = dispatchTurn(s, env, "turn-o00002", "Ganz füllen heisst vier drin. Die halbe zählt nicht. Ich rechne nochmal.").state;
    const ok1 = replyTurn(s, env, "turn-o00002", reply("Wie willst du jetzt vorgehen?", "close", { status: "understood_with_support", support: "clarification", next: "retry" }));
    deepStrictEqual((ok1.result as { outcome: unknown }).outcome, { status: "understood_with_support", next: "retry" });
    equal(g2(ok1.state).parts!.full.status, "open", "no false completion");
    equal(g2(ok1.state).tutorOutcomes!.length, 1);
    deepStrictEqual(g2(ok1.state).tutorOutcomes![0].evidence, { attempts: [1], transcriptTurns: 2 }, "evidence from the app's own record");
    ok(missionEvidence(ok1.state, v6, "v8")!.steps.find((x) => x.id === "G2-PACK")!.talk.some((t) => /von der App angenommen/.test(t.detail)));
    // case 2: after a hint (help), the model claiming independent understanding is refused by the validator
    const env2 = makeEnv(v6, { tutorAvailable: true });
    let h = atG2(env2);
    h = m(h, { a: "hint", step: "G2-PACK", part: "full" }, env2);
    h = dispatchTurn(h, env2, "turn-o00011", "Mit dem Hinweis: in drei Tragen sind 12").state;
    h = replyTurn(h, env2, "turn-o00011", reply("Was hast du im Hinweis gesehen?", "clarify")).state;
    h = dispatchTurn(h, env2, "turn-o00012", "Dann noch eine volle Trage mit vier, und zwei bleiben übrig.").state;
    // Round 15: claiming no support after an answered pointing question is refused as understated (before the validator)…
    deepStrictEqual((replyTurn(h, env2, "turn-o00012", reply("Probier es oben noch einmal.", "close", { status: "understood", support: "none", next: "retry" })).result as { outcome: unknown }).outcome, { refused: "support-understated" });
    // …and the form the model actually produced live (round 14) still meets the validator's false-independence rule.
    const refused = replyTurn(h, env2, "turn-o00012", reply("Probier es oben noch einmal.", "close", { status: "understood", support: "clarification", next: "retry" }));
    deepStrictEqual((refused.result as { outcome: unknown }).outcome, { refused: "false-independent" });
    equal((g2(refused.state).tutorOutcomes ?? []).length, 0);
    ok(missionEvidence(refused.state, v6, "v8")!.steps.find((x) => x.id === "G2-PACK")!.talk.some((t) => /abgelehnt \(false-independent\)/.test(t.detail)));
  });

  it("round 15: the exact round-14 live failure, reproduced through the engine — the request now states the evidence and the allowed combinations", () => {
    const env = makeEnv(v6, { tutorAvailable: true });
    let s = dispatchTurn(atG2(env), env, "turn-q00001", "Ich habe fünf geschrieben, weil die zwei übrigen Setzlinge auch eine Trage brauchen.").state;
    s = replyTurn(s, env, "turn-q00001", reply("Was bedeutet «ganz füllen» in der Frage?", "clarify")).state;
    const d = dispatchTurn(s, env, "turn-q00002", "Nur volle Tragen zählen: 18 durch 4 sind 4 volle Tragen, 2 Setzlinge bleiben übrig.");
    const ctxOut = (d.result as { request: { context: { evidence: Record<string, unknown>; allowedOutcomes: { status: string; support: string[]; next: string[] }[] } } }).request.context;
    deepStrictEqual(ctxOut.evidence, { purpose: "diagnostic", questionStatus: "open", helpRecorded: false, answerExposed: false, answeredClarifications: 1, answeredMethodQuestions: 0, teachingGiven: false, supportAtLeast: "clarification" });
    ok(!ctxOut.allowedOutcomes.some((o) => o.status === "understood"));
    ok(!ctxOut.allowedOutcomes.some((o) => o.next.includes("advance")));
    ok(ctxOut.allowedOutcomes.some((o) => o.status === "understood_with_support" && o.support.includes("clarification") && o.next.includes("retry")));
    // the exact live reply bytes of round 14 are still refused for the same reason
    const live = '{"v":1,"say":"Du unterscheidest jetzt volle Tragen von einer Trage mit übrigen Setzlingen.","intent":"close","outcome":{"status":"understood","support":"clarification","next":"advance"}}';
    deepStrictEqual((replyTurn(d.state, env, "turn-q00002", live).result as { outcome: unknown }).outcome, { refused: "false-independent" });
    // a warranted judgement from the offered set is accepted and keeps the question open
    const acc = replyTurn(d.state, env, "turn-q00002", reply("Du zählst nur volle Tragen. Trag deine Zahl oben ein.", "close", { status: "understood_with_support", support: "clarification", next: "retry" }));
    deepStrictEqual((acc.result as { outcome: unknown }).outcome, { status: "understood_with_support", next: "retry" });
    equal(g2(acc.state).parts!.full.status, "open");
  });

  it("round 15: independent vs. hinted through the engine — «understood» is offered only without any recorded help", () => {
    const env = makeEnv(v6, { tutorAvailable: true });
    let s = dispatchTurn(atG2(env), env, "turn-q00011", "fünf").state;
    s = replyTurn(s, env, "turn-q00011", reply("Wie bist du auf deine Zahl gekommen?", "ask-method")).state;
    const d = dispatchTurn(s, env, "turn-q00012", "Ich habe 18 durch 4 gerechnet, das sind 4 volle Tragen und 2 übrig.");
    const offered = (d.result as { request: { context: { allowedOutcomes: { status: string; support: string[] }[] } } }).request.context.allowedOutcomes;
    deepStrictEqual(offered.find((o) => o.status === "understood")?.support, ["none"]);
    deepStrictEqual((replyTurn(d.state, env, "turn-q00012", reply("Trag deine Zahl oben ein.", "close", { status: "understood", support: "none", next: "retry" })).result as { outcome: unknown }).outcome, { status: "understood", next: "retry" });
    const env2 = makeEnv(v6, { tutorAvailable: true });
    let h = m(atG2(env2), { a: "hint", step: "G2-PACK", part: "full" }, env2);
    h = dispatchTurn(h, env2, "turn-q00021", "fünf").state;
    h = replyTurn(h, env2, "turn-q00021", reply("Wie bist du auf deine Zahl gekommen?", "ask-method")).state;
    const dh = dispatchTurn(h, env2, "turn-q00022", "Im Hinweis: 12 in 3 Tragen, 6 übrig, noch eine volle Trage, 2 bleiben.");
    const ctxH = (dh.result as { request: { context: { evidence: { helpRecorded: boolean }; allowedOutcomes: { status: string }[] } } }).request.context;
    equal(ctxH.evidence.helpRecorded, true);
    ok(!ctxH.allowedOutcomes.some((o) => o.status === "understood"));
    deepStrictEqual((replyTurn(dh.state, env2, "turn-q00022", reply("Trag deine Zahl oben ein.", "close", { status: "understood", support: "none", next: "retry" })).result as { outcome: unknown }).outcome, { refused: "false-independent" }, "false independence still refused by the validator");
  });

  it("round 16: the parent sees the model's claimed help apart from the help the app recorded — a hint is never shown as a «Nachfrage»", () => {
    const env = makeEnv(v6, { tutorAvailable: true });
    let h = m(atG2(env), { a: "hint", step: "G2-PACK", part: "full" }, env);
    h = dispatchTurn(h, env, "turn-u00001", "Im Hinweis steht: In 3 vollen Tragen sind 12 Setzlinge.").state;
    h = replyTurn(h, env, "turn-u00001", reply("Was machst du mit den übrigen Setzlingen?", "ask-method")).state;
    h = dispatchTurn(h, env, "turn-u00002", "Es bleiben 6 übrig, davon 4 in noch eine Trage, 2 bleiben übrig. Also 4 volle Tragen.").state;
    // exactly the round-15 live J outcome: the model claims «clarification» although the talk only asked how he worked
    const out = replyTurn(h, env, "turn-u00002", reply("Du hast volle Tragen und die übrigen Setzlinge auseinandergehalten.", "close", { status: "understood_with_support", support: "clarification", next: "retry" }));
    deepStrictEqual((out.result as { outcome: unknown }).outcome, { status: "understood_with_support", next: "retry" });
    const tutor = missionEvidence(out.state, v6, "v8", "subscription")!.steps.find((x) => x.id === "G2-PACK")!.tutor;
    ok(/Hilfe laut Modell: Nachfrage\. Von der App erfasst: Hinweis 1/.test(tutor), tutor);
    ok(!/zeigende Nachfrage im Gespräch/.test(tutor), "the talk had no pointing question — the app does not invent one");
    equal(g2(out.state).tutorOutcomes![0].support.kind, "clarification", "the model's judgement is kept as it was (not relabelled)");
    // independence guard unchanged: «understood» after the hint is still refused
    const env2 = makeEnv(v6, { tutorAvailable: true });
    let k = m(atG2(env2), { a: "hint", step: "G2-PACK", part: "full" }, env2);
    k = dispatchTurn(k, env2, "turn-u00011", "fünf").state;
    k = replyTurn(k, env2, "turn-u00011", reply("Wie bist du darauf gekommen?", "ask-method")).state;
    k = dispatchTurn(k, env2, "turn-u00012", "Mit dem Hinweis: 4 volle Tragen.").state;
    deepStrictEqual((replyTurn(k, env2, "turn-u00012", reply("Gut.", "close", { status: "understood", support: "none", next: "retry" })).result as { outcome: unknown }).outcome, { refused: "false-independent" });
  });

  it("round 16: the child view carries the conversation mode and shows the microphone only where transcription exists", () => {
    const st = newMissionState(v6, "santiago", "2026-09-29T10:00:00.000Z");
    const at = new Date("2026-10-24T08:00:00Z");
    const typed = buildChildView(st, v6, EMPTY_PARENT_SETTINGS, at, 0, { noktMode: "subscription", noktMic: false });
    deepStrictEqual(typed.nokt, { mode: "subscription", mic: false });
    ok(isChildView(JSON.parse(JSON.stringify(typed))), "the browser's view guard accepts it");
    deepStrictEqual(buildChildView(st, v6, EMPTY_PARENT_SETTINGS, at, 0, { noktMode: "subscription", noktMic: true }).nokt, { mode: "subscription", mic: true });
    deepStrictEqual(buildChildView(st, v6, EMPTY_PARENT_SETTINGS, at, 0, { noktMode: "unavailable", noktMic: true }).nokt, { mode: "unavailable", mic: false }, "never a microphone while Nokt is off");
  });

  it("round 16: «used up for today» — an empty reply the browser reports as exhausted is recorded with that reason, still withheld; never for a non-empty reply", () => {
    const env = makeEnv(v6, { tutorAvailable: true });
    const d = dispatchTurn(atG2(env), env, "turn-x00001", "fünf").state;
    const ex = mr(d, { a: "tutor-reply", step: "G2-PACK", turnId: "turn-x00001", reply: "", noReply: "attempts_exhausted" }, { ...env, tutorOrigin: "missing" });
    deepStrictEqual({ shown: (ex.result as { shown: boolean }).shown, reason: (ex.result as { reason: string }).reason }, { shown: false, reason: "no-reply-daily-allowance" });
    const talk = missionEvidence(ex.state, v6, "v8", "subscription")!.steps.find((x) => x.id === "G2-PACK")!.talk;
    ok(talk.some((t) => t.who === "zurückgehalten" && /Tageskontingent/.test(t.detail)));
    ok(!(g2(ex.state).tutorOutcomes ?? []).length);
    const d2 = dispatchTurn(atG2(env), env, "turn-x00002", "fünf").state;
    const notEmpty = mr(d2, { a: "tutor-reply", step: "G2-PACK", turnId: "turn-x00002", reply: '{"v":1,"say":"x","intent":"clarify","outcome":null}', noReply: "attempts_exhausted" }, { ...env, tutorOrigin: "missing" });
    equal((notEmpty.result as { reason: string }).reason, "origin-missing", "a reply that came is never labelled exhausted");
  });

  it("parent summary (round 13): conversation and assessment come from the persisted records, never from panel opens", () => {
    const step = (st: MissionState, mode?: "unavailable" | "fictional-stub") => missionEvidence(st, v6, "v8", mode)!.steps.find((x) => x.id === "G2-PACK")!;
    const reload = (st: MissionState): MissionState => JSON.parse(JSON.stringify(st));
    const INACTIVE = /nicht aktiv/;
    // a. Nokt unavailable, no events at all → the old, accurate statement stays
    const plain = makeEnv(v6);
    const none = step(atG2(plain), "unavailable");
    equal(none.tutor, "Nokt nicht aktiv — kein Gespräch. Keine Tutor-Einschätzung (Nokt nicht aktiv).");
    deepStrictEqual(none.tutorActivity, { opened: 0, openedAvailable: 0, dispatches: 0, childLines: 0, verifiedLines: 0, withheld: 0, accepted: 0, refused: 0 });
    // b. normal panel open without a turn → opened, no conversation, no assessment
    const env = makeEnv(v6, { tutorAvailable: true });
    const opened = step(mr(atG2(env), { a: "tutor-open", step: "G2-PACK", entry: "manual", part: "full" }, env).state, "fictional-stub");
    equal(opened.tutor, "Nokt geöffnet 1× (manual). Gespräch verfügbar, aber kein Gespräch geführt. Keine Tutor-Einschätzung erfasst.");
    // c. persisted history reloaded, ZERO panel-open events, verified line without a judgement → conversation, no assessment
    let s = dispatchTurn(atG2(env), env, "turn-p00001", "fünf, die halbe Trage zählt auch").state;
    s = replyTurn(s, env, "turn-p00001", reply("Was bedeutet «ganz füllen» in der Frage?", "clarify")).state;
    const talked = reload(s);
    equal((g2(talked).tutor ?? []).length, 0, "no panel-open event recorded");
    for (const mode of ["unavailable", "fictional-stub", undefined] as const) {
      const v = step(talked, mode);
      equal(v.tutor, "Gespräch mit Nokt aufgezeichnet: 1 Zeile(n) des Kindes, 1 geprüfte Antwort(en) von Nokt. Keine Tutor-Einschätzung erfasst.", String(mode));
      ok(!INACTIVE.test(v.tutor) && !v.missing.some((x) => INACTIVE.test(x)), "no inactive text next to a recorded conversation");
    }
    // d. accepted outcome (bound by the app) → stated as accepted
    s = dispatchTurn(talked, env, "turn-p00002", "Ganz füllen heisst vier drin. Die halbe zählt nicht. Ich rechne nochmal.").state;
    const acc = step(replyTurn(s, env, "turn-p00002", reply("Wie willst du jetzt vorgehen?", "close", { status: "understood_with_support", support: "clarification", next: "retry" })).state, "fictional-stub");
    ok(/2 Zeile\(n\) des Kindes, 2 geprüfte Antwort\(en\)/.test(acc.tutor), acc.tutor);
    ok(/Einschätzung zu «full» von der App angenommen: understood_with_support → retry; Hilfe laut Modell: Nachfrage\. Von der App erfasst: .*zeigende Nachfrage im Gespräch/.test(acc.tutor), acc.tutor);
    equal(acc.tutorActivity.accepted, 1);
    ok(!/Keine Tutor-Einschätzung/.test(acc.tutor));
    // e. refused false-independence after a hint → stated as refused, nothing accepted
    const env2 = makeEnv(v6, { tutorAvailable: true });
    let h = m(atG2(env2), { a: "hint", step: "G2-PACK", part: "full" }, env2);
    h = dispatchTurn(h, env2, "turn-p00011", "Mit dem Hinweis: in drei Tragen sind 12").state;
    h = replyTurn(h, env2, "turn-p00011", reply("Was hast du im Hinweis gesehen?", "clarify")).state;
    h = dispatchTurn(h, env2, "turn-p00012", "Dann noch eine volle Trage mit vier, und zwei bleiben übrig.").state;
    const ref = step(reload(replyTurn(h, env2, "turn-p00012", reply("Probier es oben noch einmal.", "close", { status: "understood", support: "clarification", next: "retry" })).state), "fictional-stub");
    ok(/Einschätzung des Modells zu «full» von der App abgelehnt \(false-independent\) — nicht übernommen\./.test(ref.tutor), ref.tutor);
    ok(!/angenommen/.test(ref.tutor));
    deepStrictEqual([ref.tutorActivity.accepted, ref.tutorActivity.refused], [0, 1]);
    // f. a WITHHELD reply is never an assessment, whatever it carried
    let w = dispatchTurn(atG2(env), env, "turn-p00021", "fünf").state;
    w = replyTurn(w, env, "turn-p00021", reply("Es sind 4 Tragen.", "teach", { status: "understood", support: "teaching", next: "advance" })).state;
    const wv = step(reload(w), "fictional-stub");
    equal(wv.tutor, "Gespräch mit Nokt aufgezeichnet: 1 Zeile(n) des Kindes, 0 geprüfte Antwort(en) von Nokt, 1 zurückgehalten (nicht gezeigt). Keine Tutor-Einschätzung erfasst.");
    deepStrictEqual([wv.tutorActivity.accepted, wv.tutorActivity.refused, wv.tutorActivity.withheld], [0, 0, 1]);
  });

  it("the reply route's receipt is bound by the ENGINE to its dispatch: right turn/request/bytes verified; anything else withheld", async () => {
    const { sha256Hex } = await import("./family-learning-hash.ts");
    const env = makeEnv(v6, { tutorAvailable: true });
    const d = dispatchTurn(atG2(env), env, "turn-r00001", "fünf");
    const reqHash = (d.result as unknown as Turn).reqHash;
    const json = reply("Was sollst du bei dieser Frage herausfinden?", "clarify");
    const rec = (over: Record<string, unknown> = {}) => ({ sub: "santiago", sid: "learn", key: "turn-r00001", req: reqHash, res: sha256Hex(json), iat: 1, mdl: "openai/fictional", run: "resp_1", ...over });
    const withReceipt = (receipt: unknown) => mr(d.state, { a: "tutor-reply", step: "G2-PACK", turnId: "turn-r00001", reply: json }, { ...env, tutorReceipt: receipt as never });
    equal((withReceipt(rec()).result as { shown: boolean }).shown, true);
    equal((withReceipt(rec({ key: "turn-other1" })).result as { reason: string }).reason, "origin-invalid", "another turn's receipt");
    equal((withReceipt(rec({ sub: "isabel" })).result as { reason: string }).reason, "origin-invalid", "cross-child");
    equal((withReceipt(rec({ req: sha256Hex("changed in the browser") })).result as { reason: string }).reason, "origin-invalid", "request changed");
    equal((withReceipt(rec({ sid: "listening" })).result as { reason: string }).reason, "origin-invalid", "listening session");
    equal((withReceipt({ invalid: "bad-signature" }).result as { reason: string }).reason, "origin-invalid");
    equal((withReceipt(null).result as { reason: string }).reason, "origin-missing");
  });

  it("the generic mission route cannot reach any of it: without the Nokt route's env the tutor is unavailable", () => {
    const env = makeEnv(v6);
    const s = atG2(env);
    refused(() => dispatchTurn(s, env, "turn-c00001", "fünf"), "not-available");
    refused(() => replyTurn(s, env, "turn-c00001", reply("x", "clarify")), "not-available");
  });
});
