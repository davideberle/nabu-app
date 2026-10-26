// Visit 8 (content v7, 2026-10-26): the greenhouse map mission and the continuous Nokt conversation. Every fixture is
// SYNTHETIC (invented state; no child record, no real answers or timestamps). The "Visit 7 finished" state only has the
// SHAPE a finished Visit 7 leaves behind (a closing choice from the reviewed buttons, a typing course at lesson 5).
import { deepStrictEqual, equal, notEqual, ok, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { asLearningContent, reconcileLearningContent, type LearningContent } from "./family-learning-content.ts";
import { buildMissionView, missionDefFor, missionEvidence, stepStatuses, planTypingBlock, planningInput, type MissionAction, type MissionRun } from "./family-learning-mission.ts";
import { gridCounts } from "./family-learning-mission-spec.ts";
import { applyLearningOp, buildChildView, currentStage, EMPTY_PARENT_SETTINGS, LearningOpError, newMissionState, nextVisitAvailability, type LearningOp, type MissionState, type OpEnv, type ParentSettings } from "./family-learning-state.ts";
import { visitLabel } from "./family-learning-summary.ts";
import { isChildView } from "./family-learning-view-guard.ts";
import { sha256Hex } from "./family-learning-hash.ts";
import { carriesAnswerKey, checkTalkReply, noktTalkEvidence, parseTalkReplyText, talkStateOf, type NoktTalkPurpose } from "./family-learning-nokt-talk.ts";
import type { VerifiedReceipt } from "./family-learning-trust.ts";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../data/family-learning/content/${name}`, import.meta.url), "utf8"));
const rawV6 = read("santiago-expedition-v6.json");
const rawV7 = read("santiago-expedition-v7.json");
const v6: LearningContent = asLearningContent(rawV6);
const v7: LearningContent = asLearningContent(rawV7);
const gh = missionDefFor(v7, "v9")!;

type Env = OpEnv & { settings: ParentSettings };
function makeEnv(extra: Partial<OpEnv> = {}, content: LearningContent = v7): Env {
  let t = Date.UTC(2026, 9, 27, 14, 0, 0);
  let n = 0;
  return { content, settings: { ...EMPTY_PARENT_SETTINGS, keyboardLayout: "ch-de-qwertz" }, now: () => new Date((t += 15_000)), newId: () => `id-${(n += 1)}`, ...extra };
}
const op = (s: MissionState, o: LearningOp, env: Env) => applyLearningOp(s, o, env);
const m = (s: MissionState, action: MissionAction, env: Env) => op(s, { op: "mission", action }, env).state;
const mr = (s: MissionState, action: MissionAction, env: Env) => op(s, { op: "mission", action }, env);
function refused(fn: () => unknown, code?: string, message?: RegExp) {
  throws(fn, (e: unknown) => e instanceof LearningOpError && (!code || e.code === code) && (!message || message.test(e.message)));
}
const run = (s: MissionState): MissionRun => s.missions![gh.id];
const view = (s: MissionState) => buildMissionView(s, v7, "v9")!;

/** Synthetic: every earlier visit finished; a closing choice tapped at the end of Visit 7; typing course at lesson 5 (g/h). */
function sevenVisitsDone(opts: { choice?: boolean; goodBursts?: boolean } = {}): MissionState {
  const s = newMissionState(v7, "santiago", "2026-09-29T10:00:00.000Z");
  const day = (d: number, h: number) => new Date(Date.UTC(2026, 8, 29 + d, h, 0, 0)).toISOString();
  s.visits = (["v1", "v2", "v4", "v5", "v6", "v7", "v8"] as const).map((id, i) => ({ id, startedAt: day(i * 3, 10), finishedAt: day(i * 3, 11), stageIndex: 99, skippedStages: [], reflection: "easy" }));
  s.base = { name: "Fixture Basis", locationId: "shore", supplies: {} };
  s.typing.alignment = { layout: "ch-de-qwertz", checkedAt: day(6, 10), result: "match", observed: [], matchesLayout: "ch-de-qwertz" };
  const burst = (lessonId: string, chars: number, seconds: number, accuracy = 1) => ({ lessonId, visit: "v8" as const, lineCount: 3, lines: [], expectedChars: chars, typedChars: chars, correctChars: Math.round(chars * accuracy), extraChars: 0, omittedChars: 0, substitutedChars: 0, denominator: chars, accuracy, comfort: "easy" as const, metricVersion: 2 as const, seconds, at: day(18, 10) });
  s.typing.course = { layout: "ch-de-qwertz", lessonIndex: 4, bursts: opts.goodBursts === false ? [burst("TYPE-CH-COURSE-5", 21, 25, 0.7)] : [burst("TYPE-CH-COURSE-5", 21, 25), burst("TYPE-CH-COURSE-5", 21, 24)], decision: null, completed: ["TYPE-CH-COURSE-1", "TYPE-CH-COURSE-2", "TYPE-CH-COURSE-3", "TYPE-CH-COURSE-4"] };
  s.interests = opts.choice === false ? [{ id: "fx-i", visit: "v8", source: "closing", kind: "unsure", text: null, at: day(18, 11) }] : [{ id: "fx-i", visit: "v8", source: "closing", kind: "choice", text: "Das Gewächshaus vergrössern", choice: "greenhouse", at: day(18, 11) }];
  return s;
}
function started(env: Env, opts?: Parameters<typeof sevenVisitsDone>[0]) {
  return op(sevenVisitsDone(opts), { op: "start-visit" }, env).state;
}
/** Walks (records arrival at) the step's place, then opens it. */
function openAt(s: MissionState, step: string, env: Env) {
  const place = gh.steps.find((x) => x.id === step)!.place;
  s = m(s, { a: "arrive", place }, env);
  return m(s, { a: "open", step }, env);
}
function answer(s: MissionState, step: string, values: Record<string, number>, env: Env) {
  for (const [part, value] of Object.entries(values)) s = m(s, { a: "answer-part", step, part, value: String(value) }, env);
  return s;
}

// Fake verified receipt — what the reply route hands the engine after the SIGNATURE check (the binding is the engine's).
function receiptFor(s: MissionState, turnId: string, reply: string, child = "santiago"): VerifiedReceipt {
  const session = talkStateOf(s).sessions.find((x) => x.dispatches.some((d) => d.turnId === turnId))!;
  const d = session.dispatches.find((x) => x.turnId === turnId)!;
  return { sub: child, sid: "learn", key: turnId, req: d.reqHash, res: sha256Hex(reply), iat: 1_800_000_000, mdl: "openai/fake-fixture", run: "fake-run" };
}
const say = (text: string, intent = "ask") => JSON.stringify({ v: 1, say: text, intent, outcome: null });
let seq = 0;
const tid = () => `turn-fixture-${(seq += 1).toString().padStart(4, "0")}`;
function dispatch(s: MissionState, env: Env, purpose: NoktTalkPurpose, session: string, text?: string, via: "voice" | "typed" = "typed") {
  const turnId = tid();
  const out = op(s, { op: "nokt-talk", action: { a: "dispatch", purpose, sessionId: session, turnId, ...(text !== undefined ? { text, via } : {}) } }, { ...env, tutorAvailable: true });
  return { s: out.state, turnId, result: out.result as { request: { context: Record<string, unknown>; transcript: unknown[]; system: string }; phase: string; page: string } };
}
function reply(s: MissionState, env: Env, turnId: string, text: string, receipt: VerifiedReceipt | { invalid: string } | null | "auto" = "auto", noReply?: string) {
  const r = receipt === "auto" ? receiptFor(s, turnId, text) : receipt;
  const out = op(s, { op: "nokt-talk", action: { a: "reply", turnId, reply: text, ...(noReply ? { noReply: noReply as never } : {}) } }, { ...env, tutorAvailable: true, tutorReceipt: r });
  return { s: out.state, result: out.result as { shown: boolean; say?: string; reason?: string; line?: string }, records: out.records };
}

describe("content v7 — Visit 8 is a strict additive superset", () => {
  it("reconciles; every earlier content version still reconciles", () => {
    for (const v of [5, 6, 7]) deepStrictEqual(reconcileLearningContent(read(`santiago-expedition-v${v}.json`)).problems, []);
  });
  it("keeps every v6 visit, mission and course lesson byte-for-byte; adds v9, the greenhouse mission and lesson 6 only", () => {
    deepStrictEqual(rawV7.visits.slice(0, rawV6.visits.length), rawV6.visits);
    deepStrictEqual(rawV7.missions.slice(0, rawV6.missions.length), rawV6.missions);
    deepStrictEqual(rawV7.typing.course.lessons.slice(0, 5), rawV6.typing.course.lessons);
    deepStrictEqual(rawV7.visits.map((v: { id: string }) => v.id).slice(rawV6.visits.length), ["v9"]);
    deepStrictEqual(rawV7.missions.map((x: { id: string }) => x.id).slice(rawV6.missions.length), ["MISSION-GREENHOUSE-GROW"]);
    equal(rawV7.typing.course.lessons[5].id, "TYPE-CH-COURSE-6");
    for (const [k, v] of Object.entries(rawV6.typing.course.fingers)) equal(rawV7.typing.course.fingers[k], v);
    for (const key of ["math", "language", "writing", "harbor", "reasoning", "reflection", "station", "pier"]) deepStrictEqual(rawV7[key], rawV6[key], key);
  });
  it("the reviewed answers equal what the floor plans show (counts from the cells, never from art)", () => {
    const floor = gh.steps.find((s) => s.id === "H4-FLOOR")!.solve!;
    const plans = gh.steps.find((s) => s.id === "H5-PLANS")!.solve!;
    const [a, b] = plans.grids!.map(gridCounts);
    const f = gridCounts(floor.grids![0]);
    equal(floor.parts.find((p) => p.id === "row")!.answer, floor.grids![0].cols);
    equal(floor.parts.find((p) => p.id === "rows")!.answer, floor.grids![0].rows);
    equal(floor.parts.find((p) => p.id === "all")!.answer, f.fields);
    equal(plans.parts.find((p) => p.id === "bedsA")!.answer, a.bedFields);
    equal(plans.parts.find((p) => p.id === "bedsB")!.answer, b.bedFields);
    equal(a.fields - a.path, a.bedFields);
    deepStrictEqual([a.unreachable, b.unreachable], [[], []]);
    const c = gh.steps.find((s) => s.id === "H6-CHOOSE")!.decide!.options.find((o) => o.id === "C")!;
    ok(gridCounts(c.grid!).unreachable.length > 0, "the non-viable plan really has a bed without path");
    // No open answer is visible as a fact: the child must reason, not copy (24 and 18 never appear among the facts).
    for (const p of plans.parts) ok(!plans.facts.some((x) => new RegExp(`(^|\\D)${p.answer}(\\D|$)`).test(x)), p.id);
  });
  it("the retrieval check has no hint before the first try and a conditional fresh application", () => {
    const h2 = gh.steps.find((s) => s.id === "H2-POTS")!;
    const h3 = gh.steps.find((s) => s.id === "H3-POTS-AGAIN")!;
    equal(h2.solve!.parts[0].hintsAfterFirstAttempt, true);
    deepStrictEqual(h3.when, { step: "H2-POTS", unlessEvidence: "independent" });
    equal(h3.required, false);
    equal(h3.solve!.application!.of, "H2-POTS");
  });
});

describe("progression — Visit 8 follows Visit 7; the cap parks it", () => {
  it("offers v9 after v8; v7 content (v6) offers nothing new", () => {
    deepStrictEqual(nextVisitAvailability(sevenVisitsDone(), v7, new Date()), { visit: "v9", availableAt: null });
    deepStrictEqual(nextVisitAvailability(sevenVisitsDone(), v6, new Date()), { visit: null, availableAt: null, reason: "all-visits-done" });
    equal(visitLabel(sevenVisitsDone(), v7, "v9"), "Besuch 8 — Das grössere Gewächshaus");
  });
  it("starts at the harbor on the walkable map, stages mission → reflect", () => {
    const env = makeEnv();
    const s = started(env);
    equal(currentStage(s, v7), "mission");
    equal(view(s).presentation, "map");
    equal(run(s).position, "harbor");
    // A step opens only where it is: walking is real.
    refused(() => m(s, { a: "open", step: "H1-PLAN" }, env), "not-allowed", /walk to greenhouse/);
    ok(view(s).places.filter((p) => p.kind === "place").length >= 5);
  });
  it("a running v9 under content v6 (rollback cap) is parked untouched", () => {
    const env = makeEnv();
    const s = started(env);
    deepStrictEqual(nextVisitAvailability(s, v6, new Date()), { visit: null, availableAt: null, reason: "chapter-unavailable" });
  });
});

describe("division retrieval — brief, diagnosed, never a gate on everything", () => {
  it("first try right without help → independent, the fresh application is not needed", () => {
    const env = makeEnv();
    let s = started(env);
    s = openAt(s, "H1-PLAN", env);
    s = m(s, { a: "story-done", step: "H1-PLAN" }, env);
    s = m(s, { a: "leave" }, env);
    refused(() => m(openAt(s, "H2-POTS", env), { a: "hint", step: "H2-POTS", part: "total" }, env), "not-allowed", /try the question first/);
    s = answer(openAt(s, "H2-POTS", env), "H2-POTS", { total: 4 }, env);
    equal(run(s).steps["H2-POTS"].outcome, "independent");
    equal(stepStatuses(gh, run(s))["H3-POTS-AGAIN"], "not-needed");
  });
  it("a miss leads to hints/teaching and then ONE fresh application; other places stay open meanwhile", () => {
    const env = makeEnv();
    let s = started(env);
    s = m(openAt(s, "H1-PLAN", env), { a: "story-done", step: "H1-PLAN" }, env);
    s = m(s, { a: "leave" }, env);
    s = answer(openAt(s, "H2-POTS", env), "H2-POTS", { total: 3 }, env);
    s = m(s, { a: "hint", step: "H2-POTS", part: "total" }, env);
    s = answer(s, "H2-POTS", { total: 4 }, env);
    equal(run(s).steps["H2-POTS"].outcome, "supported");
    s = m(s, { a: "leave" }, env);
    const st = stepStatuses(gh, run(s));
    equal(st["H3-POTS-AGAIN"], "available");
    // Not a gate: measurement, typing and the plan are reachable independently of the retrieval.
    equal(st["H4-FLOOR"], "available");
    equal(st["H10-TYPING"], "available");
    s = answer(openAt(s, "H3-POTS-AGAIN", env), "H3-POTS-AGAIN", { total: 5 }, env);
    equal(run(s).steps["H3-POTS-AGAIN"].outcome, "independent");
  });
});

describe("measurement, plans and the judgment", () => {
  function toPlans(env: Env) {
    let s = started(env);
    s = m(openAt(s, "H1-PLAN", env), { a: "story-done", step: "H1-PLAN" }, env);
    s = m(s, { a: "leave" }, env);
    s = answer(openAt(s, "H4-FLOOR", env), "H4-FLOOR", { row: 6, rows: 5, all: 30 }, env);
    s = m(s, { a: "leave" }, env);
    s = answer(openAt(s, "H5-PLANS", env), "H5-PLANS", { bedsA: 24, bedsB: 18 }, env);
    s = m(s, { a: "leave" }, env);
    return openAt(s, "H6-CHOOSE", env);
  }
  it("a non-viable plan gets the rule explained and the step stays open; a viable pick is the child's own choice", () => {
    const env = makeEnv();
    let s = toPlans(env);
    const out = mr(s, { a: "decide", step: "H6-CHOOSE", option: "C" }, env);
    deepStrictEqual(out.result, { viable: false, option: "C" });
    s = out.state;
    equal(run(s).steps["H6-CHOOSE"].status, "active");
    ok(/Weg/.test(view(s).active!.decide!.picked[0].feedback));
    s = m(s, { a: "decide", step: "H6-CHOOSE", option: "B" }, env);
    equal(run(s).steps["H6-CHOOSE"].outcome, "supported");
    deepStrictEqual(view(s).world.map((w) => w.id), ["W-PLAN-B"], "only the chosen plan becomes the world");
  });
  it("either viable plan on the first pick is independent — the preference is never scored", () => {
    for (const option of ["A", "B"]) {
      const env = makeEnv();
      const s = m(toPlans(env), { a: "decide", step: "H6-CHOOSE", option }, env);
      equal(run(s).steps["H6-CHOOSE"].outcome, "independent");
      const ev = missionEvidence(s, v7, "v9")!.steps.find((x) => x.id === "H6-CHOOSE")!;
      ok(ev.missing.some((x) => /nicht bewertet/.test(x)));
    }
  });
});

describe("writing — the original is immutable; one reviewed tip; one typed revision", () => {
  function toJournal(env: Env, nokt: boolean) {
    const e = { ...env, noktEnabled: nokt };
    let s = started(e);
    const steps = ["H1-PLAN", "H2-POTS", "H4-FLOOR", "H5-PLANS", "H6-CHOOSE", "H7-JUNE"];
    for (const id of steps) {
      s = openAt(s, id, e);
      if (id === "H1-PLAN") s = m(s, { a: "story-done", step: id }, e);
      if (id === "H2-POTS") s = answer(s, id, { total: 4 }, e);
      if (id === "H4-FLOOR") s = answer(s, id, { row: 6, rows: 5, all: 30 }, e);
      if (id === "H5-PLANS") s = answer(s, id, { bedsA: 24, bedsB: 18 }, e);
      if (id === "H6-CHOOSE") s = m(s, { a: "decide", step: id, option: "A" }, e);
      if (id === "H7-JUNE") {
        s = m(s, { a: "support", step: id, kind: "play" }, e);
        s = m(s, { a: "listen-outcome", step: id, outcome: "browser" }, e);
        s = m(s, { a: "answer-question", step: id, question: "tomatoes", value: "Neben die Tür" }, e);
        s = m(s, { a: "answer-question", step: id, question: "beans", value: "Hinten links" }, e);
      }
      s = m(s, { a: "leave" }, e);
    }
    return { s: openAt(s, "H11-JOURNAL", e), e };
  }
  it("a lowercase start gets the reviewed capital tip; the revision is kept apart and judged on that rule only", () => {
    const { s: s0, e } = toJournal(makeEnv(), false);
    let s = m(s0, { a: "write", step: "H11-JOURNAL", text: "heute haben wir zwei pläne verglichen" }, e);
    const w = run(s).steps["H11-JOURNAL"].writing!;
    equal(w.original, "heute haben wir zwei pläne verglichen");
    equal(w.correction!.rule, "capital-start");
    deepStrictEqual(w.mechanics, ["capital-start", "end-mark"]);
    equal(view(s).active!.write!.awaitingRevision, true);
    s = m(s, { a: "revise", step: "H11-JOURNAL", text: "Heute haben wir zwei pläne verglichen" }, e);
    const r = run(s).steps["H11-JOURNAL"];
    equal(r.writing!.original, "heute haben wir zwei pläne verglichen", "the original never changes");
    equal(r.writing!.revision!.outcome, "revised");
    equal(r.attempts[1].evidence, "supported");
    equal(r.attempts[0].evidence, "incorrect", "mechanics of the first attempt stay as recorded");
  });
  it("a clean sentence finishes at once without Nokt, but waits for Nokt's reaction and the revision when Nokt is on", () => {
    const off = toJournal(makeEnv(), false);
    const done = m(off.s, { a: "write", step: "H11-JOURNAL", text: "Heute haben wir Beete geplant." }, off.e);
    equal(run(done).steps["H11-JOURNAL"].status, "done");
    const on = toJournal(makeEnv(), true);
    const waiting = m(on.s, { a: "write", step: "H11-JOURNAL", text: "Heute haben wir Beete geplant." }, on.e);
    equal(run(waiting).steps["H11-JOURNAL"].status, "active");
    equal(view(waiting).active!.write!.correction, null);
    const kept = m(waiting, { a: "revise", step: "H11-JOURNAL", text: null }, on.e);
    equal(run(kept).steps["H11-JOURNAL"].status, "done");
    equal(run(kept).steps["H11-JOURNAL"].outcome, "independent");
  });
  it("Nokt's writing reaction reacts to the SAVED original (server copy), never before it, and is recorded as help", () => {
    const { s: s0, e } = toJournal(makeEnv(), true);
    refused(() => dispatch(s0, e, "writing", "sess-writing-0001"), "not-allowed", /write your own sentence first/);
    refused(() => dispatch(s0, e, "visit", "sess-visit-00001", "Schreib du den Satz"), "not-allowed", /write your own sentence first/);
    let s = m(s0, { a: "write", step: "H11-JOURNAL", text: "heute haben wir 2 pläne gemacht" }, e);
    const d = dispatch(s, e, "writing", "sess-writing-0001");
    deepStrictEqual(d.result.request.transcript, [{ role: "child", text: "heute haben wir 2 pläne gemacht", via: "typed" }]);
    equal((d.result.request.context.writing as { hisSentence: string }).hisSentence, "heute haben wir 2 pläne gemacht");
    const text = say("Du hast zwei Pläne gemacht. Wie schreibt man den Anfang eines Satzes?", "ask");
    const r = reply(d.s, e, d.turnId, text);
    equal(r.result.shown, true);
    s = r.s;
    ok(run(s).steps["H11-JOURNAL"].support.some((x) => x.kind === "nokt-writing"));
    s = m(s, { a: "revise", step: "H11-JOURNAL", text: "Heute haben wir 2 pläne gemacht" }, e);
    ok(run(s).steps["H11-JOURNAL"].attempts[1].support.includes("nokt-writing"));
    equal(run(s).steps["H11-JOURNAL"].writing!.original, "heute haben wir 2 pläne gemacht");
  });
});

describe("typing — about five focused minutes, varied material, the new key group only by the existing rule", () => {
  function toTyping(goodBursts: boolean) {
    const env = makeEnv();
    let s = started(env, { goodBursts });
    s = m(openAt(s, "H1-PLAN", env), { a: "story-done", step: "H1-PLAN" }, env);
    s = m(s, { a: "leave" }, env);
    return { s: openAt(s, "H10-TYPING", env), env };
  }
  it("lesson 5 met the progression rule before (ceiling) → the block starts with lesson 6 (e/i) and lesson 5 as review", () => {
    const { s: s0, env } = toTyping(true);
    const s = m(s0, { a: "typing-start" }, env);
    equal(s.typing.course!.lessonIndex, 5);
    ok(/re-applied/.test(s.typing.course!.decision!.reason));
    const plan = run(s).typing!.plan;
    equal(plan.lessonId, "TYPE-CH-COURSE-6");
    ok(plan.drills.length > 6, `more than six drills for five minutes at the observed pace (got ${plan.drills.length})`);
    ok(plan.drills.length <= gh.typingBlock!.maxDrills);
    const current = plan.drills.filter((d) => d.lessonId === "TYPE-CH-COURSE-6").map((d) => d.lines.join("|"));
    ok(new Set(current).size > 1, "the reviewed line sets are cycled, not the same lines again and again");
  });
  it("without the criterion met, the lesson stays (no skip, no new rule)", () => {
    const { s: s0, env } = toTyping(false);
    const s = m(s0, { a: "typing-start" }, env);
    equal(s.typing.course!.lessonIndex, 4);
    equal(run(s).typing!.plan.lessonId, "TYPE-CH-COURSE-5");
  });
  it("time alone completes nothing: a pause saves partial work only", () => {
    const { s: s0, env } = toTyping(true);
    let s = m(s0, { a: "typing-start" }, env);
    s = m(s, { a: "typing-pause", no: 1, lines: ["ee"], activeSeconds: 600 }, env);
    equal(run(s).typing!.completedAt, null);
    equal(run(s).steps["H10-TYPING"].status, "active");
  });
  it("the plan is finite and drawn from reviewed material only", () => {
    const s = sevenVisitsDone();
    const plan = planTypingBlock(s, v7, gh.typingBlock!, [])!;
    // lesson 5 is current here (no catch-up in a plan preview); lesson 4 is its review; the focus source falls back to current.
    const allowed = new Set([...gh.typingBlock!.material!["TYPE-CH-COURSE-5"].flat(), ...v7.typing.course!.lessons[4].lines, ...v7.typing.course!.lessons[3].lines]);
    for (const d of plan.drills) for (const l of d.lines) ok(allowed.has(l), l);
  });
});

describe("Spanish — fresh retrieval, then one new SUPPORTED exchange", () => {
  it("the modelled new word makes even a first-try answer supported (after-supplied), never fresh recall", () => {
    const env = makeEnv();
    let s = started(env);
    s = m(openAt(s, "H1-PLAN", env), { a: "story-done", step: "H1-PLAN" }, env);
    s = m(s, { a: "leave" }, env);
    s = answer(openAt(s, "H4-FLOOR", env), "H4-FLOOR", { row: 6, rows: 5, all: 30 }, env);
    s = m(s, { a: "leave" }, env);
    s = answer(openAt(s, "H5-PLANS", env), "H5-PLANS", { bedsA: 24, bedsB: 18 }, env);
    s = m(s, { a: "leave" }, env);
    s = m(openAt(s, "H6-CHOOSE", env), { a: "decide", step: "H6-CHOOSE", option: "A" }, env);
    s = m(s, { a: "leave" }, env);
    s = m(openAt(s, "H8-TOOLS", env), { a: "produce", step: "H8-TOOLS", response: "Necesitamos herramientas", modality: "typed" }, env);
    equal(run(s).steps["H8-TOOLS"].outcome, "independent");
    equal(run(s).steps["H8-TOOLS"].attempts[0].recall, "fresh");
    s = m(s, { a: "leave" }, env);
    s = m(openAt(s, "H9-WATERING", env), { a: "produce", step: "H9-WATERING", response: "Necesitamos una regadera", modality: "typed" }, env);
    equal(run(s).steps["H9-WATERING"].attempts[0].recall, "after-supplied");
    equal(run(s).steps["H9-WATERING"].outcome, "supported");
  });
});

describe("Nokt talk — server-built, page-bound, verified, never an assessment", () => {
  it("is refused without the Nokt route (the generic mission route cannot dispatch or reply)", () => {
    const env = makeEnv();
    const s = started(env);
    refused(() => op(s, { op: "nokt-talk", action: { a: "dispatch", purpose: "home", sessionId: "sess-home-00001", turnId: "turn-generic-0001", text: "Hallo", via: "typed" } }, env), "not-available");
    refused(() => op(s, { op: "mission", action: { a: "tutor-dispatch", step: "H2-POTS", part: "total", purpose: "diagnostic", entry: "manual", turnId: "turn-generic-0002", sessionId: "s", text: "x", via: "typed" } }, { ...env, noktEnabled: true }), "not-available");
  });
  it("Home: the request carries his visits and his own saved wish only — no answer key, no sibling, no history dump", () => {
    const env = makeEnv();
    const s = sevenVisitsDone();
    const d = dispatch(s, env, "home", "sess-home-00001", "Was machen wir heute?");
    const json = JSON.stringify(d.result.request);
    equal(carriesAnswerKey(d.result.request), false);
    ok(!/isabel|lila/i.test(json), "no sibling data");
    ok(!/"answer"/.test(json));
    equal((d.result.request.context.home as { hisLastWish: string }).hisLastWish, "Das Gewächshaus vergrössern");
    equal(d.result.page, "home");
    ok(json.length < 8000, "bounded, not a history dump");
    const r = reply(d.s, env, d.turnId, say("Heute kannst du Besuch 8 starten.", "respond"));
    equal(r.result.shown, true);
    equal(r.records.attempts.length, 0, "a chat records no attempt");
    equal(r.s.visits.filter((v) => v.finishedAt === null).length, 0, "and starts or completes nothing");
  });
  it("welcome: once per visit instance, only before anything was opened, grounded in the saved choice (or none)", () => {
    const env = makeEnv();
    let s = started(env);
    const before = buildChildView(s, v7, env.settings, new Date(), 0, { noktMode: "subscription" });
    equal(before.nokt!.talk!.welcome, "due");
    ok(isChildView(before));
    const d = dispatch(s, env, "welcome", "sess-welcome-0001");
    deepStrictEqual(d.result.request.transcript, [], "an opener invents no child line");
    equal(d.result.request.context.hisSavedChoice, "Das Gewächshaus vergrössern");
    equal(d.result.phase, "begruessung");
    s = reply(d.s, env, d.turnId, say("Hallo Santi! Du wolltest das Gewächshaus vergrössern. Bist du bereit?")).s;
    equal(buildChildView(s, v7, env.settings, new Date(), 0, { noktMode: "subscription" }).nokt!.talk!.welcome, "done");
    refused(() => dispatch(s, env, "welcome", "sess-welcome-0002"), "not-allowed", /welcome of this visit happened/);
    const s2 = openAt(s, "H1-PLAN", env);
    refused(() => dispatch(s2, env, "welcome", "sess-welcome-0001", "ja"), "not-allowed", /already begun/);
    const none = dispatch(started(makeEnv(), { choice: false }), env, "welcome", "sess-welcome-0003");
    equal(none.result.request.context.hisSavedChoice, null, "no invented memory when he saved no choice");
  });
  it("a forged, cross-child, malformed or missing receipt is withheld; a second reply to the same turn is refused", () => {
    const env = makeEnv();
    const s = sevenVisitsDone();
    const text = say("Worüber möchtest du reden?");
    const d1 = dispatch(s, env, "home", "sess-home-00002", "Hallo");
    equal(reply(d1.s, env, d1.turnId, text, { ...receiptFor(d1.s, d1.turnId, text), res: sha256Hex("other bytes") }).result.reason, "origin-invalid");
    const d2 = dispatch(s, env, "home", "sess-home-00003", "Hallo");
    equal(reply(d2.s, env, d2.turnId, text, receiptFor(d2.s, d2.turnId, text, "isabel")).result.reason, "origin-invalid");
    const d3 = dispatch(s, env, "home", "sess-home-00004", "Hallo");
    equal(reply(d3.s, env, d3.turnId, text, { invalid: "malformed" }).result.reason, "origin-malformed");
    const d4 = dispatch(s, env, "home", "sess-home-00005", "Hallo");
    const r4 = reply(d4.s, env, d4.turnId, text, null);
    equal(r4.result.reason, "origin-missing");
    ok(!/Nokt/.test(r4.result.line ?? "") || /keine passende/.test(r4.result.line ?? ""), "the child sees the app line");
    refused(() => reply(r4.s, env, d4.turnId, text), "not-allowed", /already has its reply/);
    const d6 = dispatch(s, env, "home", "sess-home-00006", "Hallo");
    refused(() => op(d6.s, { op: "nokt-talk", action: { a: "reply", turnId: "turn-unknown-9999", reply: text } }, { ...env, tutorAvailable: true, tutorReceipt: null }), "stale", /unknown Nokt turn/);
  });
  it("no reply: the browser's report only names the reason; a used-up day shows the kind pause line", () => {
    const env = makeEnv();
    const d = dispatch(sevenVisitsDone(), env, "home", "sess-home-00007", "Hallo");
    const r = reply(d.s, env, d.turnId, "", null, "attempts_exhausted");
    equal(r.result.shown, false);
    equal(r.result.reason, "no-reply-attempts_exhausted");
    ok(/Pause/.test(r.result.line!));
    const d2 = dispatch(sevenVisitsDone(), env, "home", "sess-home-00008", "Hallo");
    equal(reply(d2.s, env, d2.turnId, "", null, "unreachable").result.reason, "no-reply-unreachable");
  });
  it("a reply for a page he already left is withheld (stale); task/child changes never bind late work", () => {
    const env = makeEnv();
    let s = started(env);
    s = m(openAt(s, "H1-PLAN", env), { a: "story-done", step: "H1-PLAN" }, env);
    const d = dispatch(s, env, "visit", "sess-visit-00002", "Was soll ich hier machen?");
    equal(d.result.page, "visit:v9:step:H1-PLAN");
    const moved = m(d.s, { a: "leave" }, env);
    const r = reply(moved, env, d.turnId, say("Geh zum Hafenladen."));
    equal(r.result.reason, "stale-page");
  });
  it("guards: outcome must be null; answer disclosure on an open question; several questions; a reward promise", () => {
    const env = makeEnv();
    let s = started(env);
    for (const id of ["H1-PLAN", "H4-FLOOR", "H5-PLANS", "H6-CHOOSE"]) {
      s = openAt(s, id, env);
      if (id === "H1-PLAN") s = m(s, { a: "story-done", step: id }, env);
      if (id === "H4-FLOOR") s = answer(s, id, { row: 6, rows: 5, all: 30 }, env);
      if (id === "H5-PLANS") s = answer(s, id, { bedsA: 24, bedsB: 18 }, env);
      if (id === "H6-CHOOSE") s = m(s, { a: "decide", step: id, option: "A" }, env);
      s = m(s, { a: "leave" }, env);
    }
    s = openAt(s, "H7-JUNE", env);
    const cases: [string, string][] = [
      [JSON.stringify({ v: 1, say: "Gut gemacht.", intent: "respond", outcome: { status: "understood", support: "none", next: "continue" } }), "malformed"],
      [say("Die Tomaten kommen neben die Tür.", "respond"), "answer-disclosed"],
      [say("Was hörst du? Wohin gehen die Bohnen?"), "several-questions"],
      [say("Dafür bekommst du drei Münzen!", "encourage"), "promises-reward"],
    ];
    for (const [text, reason] of cases) {
      const d = dispatch(s, env, "visit", `sess-guard-${reason.slice(0, 8).padEnd(8, "x")}`, "Hilf mir");
      equal(reply(d.s, env, d.turnId, text).result.reason, reason, reason);
    }
    // A solve question still open has its own task talk (the assessment path) — the visit talk is refused there.
    s = m(s, { a: "leave" }, env);
    s = m(openAt(s, "H2-POTS", env), { a: "answer-part", step: "H2-POTS", part: "total", value: "3" }, env);
    refused(() => dispatch(s, env, "visit", "sess-visit-00003", "Wie viele?"), "not-allowed", /its own talk/);
    ok(checkTalkReply(parseTalkReplyText(say("Lies die Frage noch einmal.")), { purpose: "visit", phase: "begleiten", transcript: [], open: { numbers: [], phrases: [] } }).ok);
  });
});

describe("debrief — his button answers, one question at a time, his own next-interest words", () => {
  function finishedMission(env: Env) {
    let s = started({ ...env, noktEnabled: false });
    const e = env;
    const order = ["H1-PLAN", "H2-POTS", "H4-FLOOR", "H5-PLANS", "H6-CHOOSE", "H7-JUNE", "H8-TOOLS", "H9-WATERING", "H10-TYPING", "H11-JOURNAL", "H12-DONE"];
    for (const id of order) {
      s = openAt(s, id, e);
      const def = gh.steps.find((x) => x.id === id)!;
      if (def.kind === "story" || def.kind === "outcome") s = m(s, { a: "story-done", step: id }, e);
      if (id === "H2-POTS") s = answer(s, id, { total: 4 }, e);
      if (id === "H4-FLOOR") s = answer(s, id, { row: 6, rows: 5, all: 30 }, e);
      if (id === "H5-PLANS") s = answer(s, id, { bedsA: 24, bedsB: 18 }, e);
      if (id === "H6-CHOOSE") s = m(s, { a: "decide", step: id, option: "A" }, e);
      if (id === "H7-JUNE") {
        s = m(s, { a: "support", step: id, kind: "play" }, e);
        s = m(s, { a: "listen-outcome", step: id, outcome: "browser" }, e);
        s = m(s, { a: "answer-question", step: id, question: "tomatoes", value: "Neben die Tür" }, e);
        s = m(s, { a: "answer-question", step: id, question: "beans", value: "Hinten links" }, e);
      }
      if (id === "H8-TOOLS") s = m(s, { a: "produce", step: id, response: "Necesitamos herramientas", modality: "typed" }, e);
      if (id === "H9-WATERING") s = m(s, { a: "produce", step: id, response: "Necesitamos una regadera", modality: "typed" }, e);
      if (id === "H10-TYPING") {
        s = m(s, { a: "typing-start" }, e);
        for (;;) {
          const block = run(s).typing!;
          const next = block.plan.drills.find((d) => !block.drills.some((x) => x.no === d.no && x.attempted));
          if (!next) break;
          s = m(s, { a: "typing-drill", no: next.no, lines: next.lines, seconds: 30, activeSeconds: 28, idleSeconds: 2 }, e);
        }
        s = m(s, { a: "typing-comfort", comfort: "easy" }, e);
        s = m(s, { a: "typing-extra", take: false }, e);
      }
      if (id === "H11-JOURNAL") s = m(s, { a: "write", step: id, text: "Heute haben wir Beete geplant." }, e);
      s = m(s, { a: "leave" }, e);
    }
    s = m(s, { a: "finish" }, e);
    return s;
  }
  it("the mission finishes only through its own work; the closing card shows his plan", () => {
    const env = makeEnv();
    const s = finishedMission(env);
    equal(currentStage(s, v7), "reflect");
    const v = buildChildView(s, v7, env.settings, new Date(), 0, { noktMode: "subscription" });
    ok(isChildView(v));
    equal(v.reflection!.closing!.plan!.label, "Plan A: schmaler Weg");
    ok(v.nokt!.talk!.debrief);
    equal(v.nokt!.talk!.debrief!.interestRecorded, false);
  });
  it("buttons first; the look back uses them; his answer to the next-interest question is saved verbatim; reflect needs nothing more", () => {
    const env = makeEnv();
    let s = finishedMission(env);
    s = op(s, { op: "closing-feedback", feedback: { difficulty: "right", enjoyment: "yes", clarity: null } }, env).state;
    const sess = "sess-debrief-0001";
    let d = dispatch(s, env, "debrief", sess);
    deepStrictEqual(d.result.request.transcript, []);
    equal(d.result.phase, "rueckblick-start");
    const buttons = d.result.request.context.buttons as Record<string, string>;
    ok(Object.values(buttons).includes("Ja") && Object.values(buttons).includes("lieber nicht gesagt"));
    s = reply(d.s, env, d.turnId, say("Was war heute knifflig?")).s;
    d = dispatch(s, env, "debrief", sess, "die pläne", "voice");
    equal(d.result.phase, "rueckblick");
    s = reply(d.s, env, d.turnId, say("Pläne vergleichen braucht Geduld. Was würdest du jemandem zeigen?")).s;
    d = dispatch(s, env, "debrief", sess, "das gewächshaus");
    equal(d.result.phase, "naechstes");
    s = reply(d.s, env, d.turnId, say("Schön. Was möchtest du beim nächsten Besuch machen?")).s;
    const before = (s.interests ?? []).length;
    d = dispatch(s, env, "debrief", sess, "tomaten ernten und einen markt machen");
    equal(d.result.phase, "abschluss");
    s = d.s;
    equal((s.interests ?? []).length, before + 1);
    const rec = s.interests!.at(-1)!;
    deepStrictEqual([rec.source, rec.kind, rec.text, rec.visit], ["debrief", "text", "tomaten ernten und einen markt machen", "v9"]);
    s = reply(s, env, d.turnId, say("Danke, Santi! Tomaten ernten und einen Markt machen.", "close")).s;
    const fin = op(s, { op: "reflect" } as LearningOp, env);
    equal(fin.result.finished, "v9");
    const visit = fin.state.visits.find((v) => v.id === "v9")!;
    deepStrictEqual(visit.feedback!.answers, { difficulty: "right", enjoyment: "yes" });
    equal(visit.reflection, "right");
    equal((fin.state.interests ?? []).filter((i) => i.visit === "v9").length, 1, "nothing recorded twice");
  });
  it("a withheld next-interest question records nothing — the reviewed buttons stay the honest fallback", () => {
    const env = makeEnv();
    let s = finishedMission(env);
    const sess = "sess-debrief-0002";
    let d = dispatch(s, env, "debrief", sess);
    s = reply(d.s, env, d.turnId, say("Was war heute schön?")).s;
    d = dispatch(s, env, "debrief", sess, "alles");
    s = reply(d.s, env, d.turnId, say("Was würdest du zeigen?")).s;
    d = dispatch(s, env, "debrief", sess, "den plan");
    s = reply(d.s, env, d.turnId, "", null, "timeout").s;
    d = dispatch(s, env, "debrief", sess, "wasser");
    equal((d.s.interests ?? []).filter((i) => i.visit === "v9").length, 0);
    refused(() => op(d.s, { op: "reflect" } as LearningOp, env), "invalid", /answer it or choose/);
    const fin = op(d.s, { op: "reflect", interest: { kind: "choice", choice: "water-pipe" } } as LearningOp, env);
    equal(fin.state.interests!.at(-1)!.text, "Eine Wasserleitung zum Gewächshaus bauen");
  });
  /** Opener → two look-back answers → the shown next-interest question; returns the state and session. */
  function toNextQuestion(env: Env, sess: string) {
    let s = finishedMission(env);
    let d = dispatch(s, env, "debrief", sess);
    s = reply(d.s, env, d.turnId, say("Was war heute knifflig?")).s;
    d = dispatch(s, env, "debrief", sess, "die pläne");
    s = reply(d.s, env, d.turnId, say("Was würdest du jemandem zeigen?")).s;
    d = dispatch(s, env, "debrief", sess, "mein plan");
    equal(d.result.phase, "naechstes");
    deepStrictEqual(d.result.request.context.nextIdeas, ["Im Gewächshaus ernten", "Eine Wasserleitung zum Gewächshaus bauen"], "the two reviewed ideas are in the briefing");
    ok(/zwei Ideen aus context\.nextIdeas/.test(d.result.request.system) && !/Mach keinen Vorschlag/.test(d.result.request.system), "Nokt offers the ideas instead of a blank question");
    return { s: reply(d.s, env, d.turnId, say("Möchtest du im Gewächshaus ernten, eine Wasserleitung bauen oder hast du eine eigene Idee?")).s, d };
  }
  const v9 = (s: MissionState) => (s.interests ?? []).filter((i) => i.visit === "v9");
  it("a question back («Was meinst du?») is never saved as a wish; Nokt explains and asks again; then his answer counts", () => {
    const env = makeEnv();
    let { s } = toNextQuestion(env, "sess-debrief-c001");
    let d = dispatch(s, env, "debrief", "sess-debrief-c001", "Was meinst du?");
    equal(v9(d.s).length, 0);
    equal(d.result.phase, "naechstes");
    equal(d.result.request.context.lastAnswerKind, "nachfrage");
    s = reply(d.s, env, d.turnId, say("Ernten heisst: Tomaten pflücken. Oder Wasser holen mit einer Leitung. Was möchtest du?")).s;
    d = dispatch(s, env, "debrief", "sess-debrief-c001", "eine leitung bauen", "voice");
    deepStrictEqual(v9(d.s).map((i) => [i.kind, i.text]), [["text", "eine leitung bauen"]]);
    ok(/gesprochen/.test(v9(d.s)[0].uncertainty ?? "") && /nicht gedeutet/.test(v9(d.s)[0].uncertainty ?? ""));
    equal(d.result.phase, "abschluss");
    equal(d.result.request.context.hisWish, "eine leitung bauen");
  });
  it("a refusal is recorded as «lieber nicht sagen», never as a topic; «weiss nicht» as unsure", () => {
    const env = makeEnv();
    const { s } = toNextQuestion(env, "sess-debrief-r001");
    const d = dispatch(s, env, "debrief", "sess-debrief-r001", "Das sag ich lieber nicht");
    deepStrictEqual(v9(d.s).map((i) => [i.kind, i.text]), [["declined", null]]);
    equal(op(d.s, { op: "reflect" } as LearningOp, env).result.finished, "v9", "no endless gate: the closing accepts it");
    const u = toNextQuestion(makeEnv(), "sess-debrief-u001");
    deepStrictEqual(v9(dispatch(u.s, env, "debrief", "sess-debrief-u001", "weiss nicht").s).map((i) => [i.kind, i.text]), [["unsure", null]]);
  });
  it("a correction keeps both answers verbatim; the latest counts and points to the one it corrects", () => {
    const env = makeEnv();
    let { s } = toNextQuestion(env, "sess-debrief-k001");
    let d = dispatch(s, env, "debrief", "sess-debrief-k001", "tomaten ernten");
    s = reply(d.s, env, d.turnId, say("Danke, Santi! Tomaten ernten.", "close")).s;
    d = dispatch(s, env, "debrief", "sess-debrief-k001", "nein, ich meine eine wasserleitung bauen");
    const list = v9(d.s);
    deepStrictEqual(list.map((i) => i.text), ["tomaten ernten", "nein, ich meine eine wasserleitung bauen"]);
    equal(list[1].corrects, list[0].id);
    const plan = planningInput(d.s, v7);
    equal(plan.interests.at(-1)!.text, "nein, ich meine eine wasserleitung bauen");
    // A plain «nein» without new words is not a new wish.
    const d2 = dispatch(d.s, env, "debrief", "sess-debrief-k001", "nein");
    equal(v9(d2.s).length, 2);
  });
  it("a tapped reviewed idea is recorded as that choice (its label, its id); a tap before the question is not", () => {
    const env = makeEnv();
    const early = finishedMission(env);
    const e1 = dispatch(early, env, "debrief", "sess-debrief-t000");
    const e2 = reply(e1.s, env, e1.turnId, say("Was war heute knifflig?")).s;
    const tap = op(e2, { op: "nokt-talk", action: { a: "dispatch", purpose: "debrief", sessionId: "sess-debrief-t000", turnId: tid(), text: "Im Gewächshaus ernten", via: "typed", choice: "harvest" } }, { ...env, tutorAvailable: true });
    equal(v9(tap.state).length, 0, "too early: Nokt has not asked about the next visit yet");
    const { s } = toNextQuestion(env, "sess-debrief-t001");
    const out = op(s, { op: "nokt-talk", action: { a: "dispatch", purpose: "debrief", sessionId: "sess-debrief-t001", turnId: tid(), text: "anything the client claims", via: "typed", choice: "water-pipe" } }, { ...env, tutorAvailable: true });
    const rec = v9(out.state)[0];
    deepStrictEqual([rec.kind, rec.choice, rec.text], ["choice", "water-pipe", "Eine Wasserleitung zum Gewächshaus bauen"]);
    const turns = talkStateOf(out.state).sessions.find((x) => x.id === "sess-debrief-t001")!.turns;
    deepStrictEqual([turns.at(-1)!.text, turns.at(-1)!.via], ["Eine Wasserleitung zum Gewächshaus bauen", "choice"], "the transcript shows the reviewed label, not client words");
    refused(() => op(s, { op: "nokt-talk", action: { a: "dispatch", purpose: "debrief", sessionId: "sess-debrief-t001", turnId: tid(), text: "x", via: "typed", choice: "rocket" } }, { ...env, tutorAvailable: true }), "invalid");
  });
  it("after a withheld next-interest line his reply waits; the retried question (shown) gets the answer; three tries at most", () => {
    const env = makeEnv();
    let s = finishedMission(env);
    const sess = "sess-debrief-w001";
    let d = dispatch(s, env, "debrief", sess);
    s = reply(d.s, env, d.turnId, say("Was war heute knifflig?")).s;
    d = dispatch(s, env, "debrief", sess, "nichts");
    s = reply(d.s, env, d.turnId, say("Was würdest du zeigen?")).s;
    d = dispatch(s, env, "debrief", sess, "den plan");
    const withheld = reply(d.s, env, d.turnId, "", null, "timeout");
    ok(/Tipp unten eine Idee an/.test(withheld.result.line!), "the app asks the reviewed question with the taps");
    d = dispatch(withheld.s, env, "debrief", sess, "wasser");
    equal(v9(d.s).length, 0, "a reply to a withheld question is not saved");
    equal(d.result.phase, "naechstes", "the question is asked again");
    s = reply(d.s, env, d.turnId, say("Möchtest du ernten oder eine Wasserleitung bauen?")).s;
    d = dispatch(s, env, "debrief", sess, "wasserleitung");
    deepStrictEqual(v9(d.s).map((i) => i.text), ["wasserleitung"]);
    // Bounded: three unanswered next-interest questions → Nokt closes; the reviewed buttons remain.
    let b = toNextQuestion(makeEnv(), "sess-debrief-w002").s;
    for (let i = 0; i < 2; i += 1) {
      const q = dispatch(b, env, "debrief", "sess-debrief-w002", "Was meinst du?");
      b = reply(q.s, env, q.turnId, say(`Ernten oder Wasser? (${i})`)).s;
    }
    const last = dispatch(b, env, "debrief", "sess-debrief-w002", "Was meinst du?");
    equal(last.result.phase, "abschluss");
    equal(v9(last.s).length, 0);
  });
  it("the briefing never turns «no recorded app help» into «without any help»", () => {
    const env = makeEnv();
    const d = dispatch(finishedMission(env), env, "debrief", "sess-debrief-h001");
    const work = d.result.request.context.work as { title: string; result?: string }[];
    const independent = work.find((w) => w.title === "Töpfe packen")!;
    ok(/ohne aufgezeichnete Hilfe in der App/.test(independent.result!) && /Erwachsener/.test(independent.result!), independent.result);
    ok(!work.some((w) => /ohne Hilfe$|beim ersten Versuch ohne Hilfe/.test(w.result ?? "")));
    ok(/Sag nie, er habe es ganz allein geschafft/.test(String(d.result.request.context.workNote)));
  });
  it("parent evidence keeps every line with its provenance and says it is no assessment", () => {
    const env = makeEnv();
    let s = finishedMission(env);
    const d = dispatch(s, env, "debrief", "sess-debrief-0003");
    s = reply(d.s, env, d.turnId, say("Was war heute knifflig?")).s;
    const ev = noktTalkEvidence(s, v7);
    equal(ev[0].lines[0].who, "Nokt");
    ok(/fake-fixture/.test(ev[0].lines[0].detail));
    ok(/keine Bewertung/.test(ev[0].note));
  });
});

describe("Visit 7 and earlier stay exactly as they were", () => {
  it("a finished Visit 7 run reads identically under content v6 and v7", () => {
    const s = sevenVisitsDone();
    notEqual(missionDefFor(v7, "v8"), null);
    deepStrictEqual(missionEvidence(s, v7, "v8"), missionEvidence(s, v6, "v8"));
    deepStrictEqual(buildMissionView(s, v7, "v8"), buildMissionView(s, v6, "v8"));
  });
  it("the view under content v6 carries no talk block (the Visit 7 child view is unchanged)", () => {
    const env = makeEnv({}, v6);
    const s = newMissionState(v6, "santiago", "2026-10-24T08:00:00.000Z");
    const v = buildChildView(s, v6, env.settings, new Date(), 0, { noktMode: "subscription" });
    deepStrictEqual(v.nokt, { mode: "subscription", mic: false });
  });
});

describe("Nokt plumbing for the new purposes (fake fetch, fake env)", () => {
  it("the fake recognizer never switches on outside an isolated local database", async () => {
    const { noktSttModeFromEnv } = await import("./family-learning-nokt-stt.ts");
    equal(noktSttModeFromEnv({ FAMILY_NOKT_STT_FAKE: "1", NABU_DB_DIR: "/tmp/x" }).kind, "fictional-fake");
    for (const extra of [{ TURSO_DATABASE_URL: "libsql://x" }, { VERCEL: "1" }, { VERCEL_ENV: "production" }, { VERCEL_URL: "x.vercel.app" }, { NABU_DB_DIR: "" }]) equal(noktSttModeFromEnv({ FAMILY_NOKT_STT_FAKE: "1", NABU_DB_DIR: "/tmp/x", ...extra }).kind, "off", JSON.stringify(extra));
    equal(noktSttModeFromEnv({ FAMILY_NOKT_CONVERSATION: "subscription" }).kind, "off", "the conversation switch alone never enables a microphone");
  });
  it("the browser's report of a runtime refusal is a closed vocabulary that only names a reason", async () => {
    const { noReplyCodeOf } = await import("./family-learning-client.ts");
    deepStrictEqual([noReplyCodeOf(429, "attempts_exhausted"), noReplyCodeOf(429, "busy"), noReplyCodeOf(429, "x"), noReplyCodeOf(400, "bad_request"), noReplyCodeOf(409, "replay"), noReplyCodeOf(504, "timeout"), noReplyCodeOf(503, "reauthorize"), noReplyCodeOf(502, "x")], ["attempts_exhausted", "busy", "usage_limit", "bad_request", "bad_request", "timeout", "unavailable", "unavailable"]);
  });
  it("a talk turn posts its purpose (never a step) and passes the runtime's refusal on; the task talk keeps its Visit 7 contract", async () => {
    const { createLearningClient, LEARNING_NOKT_DISPATCH_PATH, LEARNING_NOKT_REPLY_PATH, LEARNING_SESSION_PATH } = await import("./family-learning-client.ts");
    const v = buildChildView(sevenVisitsDone(), v7, EMPTY_PARENT_SETTINGS, new Date(), 0);
    const run = async (turn: Parameters<ReturnType<typeof createLearningClient>["noktTurn"]>[1], bridge: () => Response | Promise<Response>) => {
      const calls: { url: string; body: unknown }[] = [];
      const impl = (async (url: string, init: RequestInit = {}) => {
        calls.push({ url: String(url), body: init.body ? JSON.parse(String(init.body)) : null });
        if (url === LEARNING_SESSION_PATH) return Response.json({ child: "santiago", token: "t", expiresAt: Date.now() + 3_600_000 });
        if (url === LEARNING_NOKT_DISPATCH_PATH) return Response.json({ status: "applied", view: v, result: { turnId: turn.turnId, request: { x: 1 }, reqHash: "h", bridge: { url: "https://nokt-bridge.invalid:8787", token: "fcm1.a.b", expiresAt: 1 } } });
        if (String(url).endsWith("/v1/nokt/turn")) return bridge();
        if (url === LEARNING_NOKT_REPLY_PATH) return Response.json({ status: "applied", view: v, result: { shown: false } });
        return new Response("x", { status: 500 });
      }) as typeof fetch;
      await createLearningClient({ fetchImpl: impl }).noktTurn("santiago", turn, 1, { signal: new AbortController().signal, context: { erasureGeneration: 0, visit: null } });
      return calls.find((c) => c.url === LEARNING_NOKT_REPLY_PATH)!.body as Record<string, unknown>;
    };
    const talk = await run({ purpose: "home", sessionId: "sess-home-00009", turnId: "turn-client-0001", text: "Hallo", via: "typed" }, () => Response.json({ ok: false, code: "busy" }, { status: 429 }));
    deepStrictEqual([talk.purpose, "step" in talk, talk.reply, talk.noReply], ["home", false, null, "busy"]);
    const down = await run({ purpose: "welcome", sessionId: "sess-welc-00009", turnId: "turn-client-0002" }, () => Promise.reject(new TypeError("network")));
    equal(down.noReply, "unreachable");
    const task = await run({ step: "H2-POTS", part: "total", purpose: "diagnostic", entry: "manual", sessionId: "s", turnId: "turn-client-0003", text: "x", via: "typed" }, () => Response.json({ ok: false, code: "busy" }, { status: 429 }));
    deepStrictEqual([task.step, "noReply" in task], ["H2-POTS", false], "Visit 7 task talk: only the used-up day is passed on");
  });
  it("the view guard refuses a malformed talk block", () => {
    const v = buildChildView(started(makeEnv()), v7, EMPTY_PARENT_SETTINGS, new Date(), 0, { noktMode: "subscription" });
    ok(isChildView(v));
    ok(!isChildView({ ...v, nokt: { ...v.nokt, talk: { sessions: [{ id: "x", purpose: "home", page: "home", closed: false, lines: [{ role: "model", text: "x" }] }], welcome: "due" } } }));
  });
});
