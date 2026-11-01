// Step 1 / Santiago Visit 9 (content v8, 2026-11-01): «Die Wasserleitung». Every fixture is SYNTHETIC (invented state; no
// child record, no real answers). The "Visit 8 finished" state only has the SHAPE a finished Visit 8 leaves behind.
import { deepStrictEqual, equal, ok, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { asLearningContent, reconcileLearningContent, type LearningContent } from "./family-learning-content.ts";
import { missionDefFor, stepStatuses, type MissionAction, type MissionRun } from "./family-learning-mission.ts";
import { applyLearningOp, EMPTY_PARENT_SETTINGS, LearningOpError, newMissionState, nextVisitAvailability, type LearningOp, type MissionState, type OpEnv, type ParentSettings } from "./family-learning-state.ts";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../data/family-learning/content/${name}`, import.meta.url), "utf8"));
const rawV7 = read("santiago-expedition-v7.json");
const rawV8 = read("santiago-expedition-v8.json");
const v7: LearningContent = asLearningContent(rawV7);
const v8: LearningContent = asLearningContent(rawV8);
const pipe = missionDefFor(v8, "v10")!;

type Env = OpEnv & { settings: ParentSettings };
function makeEnv(start = Date.UTC(2026, 10, 8, 9, 0, 0), extra: Partial<OpEnv> = {}, content: LearningContent = v8): Env {
  let t = start;
  let n = 0;
  return { content, settings: { ...EMPTY_PARENT_SETTINGS, keyboardLayout: "ch-de-qwertz" }, now: () => new Date((t += 15_000)), newId: () => `id-${(n += 1)}`, ...extra };
}
const op = (s: MissionState, o: LearningOp, env: Env) => applyLearningOp(s, o, env);
const m = (s: MissionState, action: MissionAction, env: Env) => op(s, { op: "mission", action }, env).state;
const run = (s: MissionState): MissionRun => s.missions![pipe.id];

/** Synthetic: every earlier visit finished; the greenhouse mission finished on Nov 1 with its taught steps; course at lesson 6. */
function eightVisitsDone(content: LearningContent = v8): MissionState {
  const s = newMissionState(content, "santiago", "2026-09-29T10:00:00.000Z");
  const day = (d: number, h: number) => new Date(Date.UTC(2026, 8, 29 + d, h, 0, 0)).toISOString();
  s.visits = (["v1", "v2", "v4", "v5", "v6", "v7", "v8", "v9"] as const).map((id, i) => ({ id, startedAt: day(i * 3, 10), finishedAt: day(i * 3, 11), stageIndex: 99, skippedStages: [], reflection: "easy" }));
  s.base = { name: "Fixture Basis", locationId: "shore", supplies: {} };
  s.typing.alignment = { layout: "ch-de-qwertz", checkedAt: day(6, 10), result: "match", observed: [], matchesLayout: "ch-de-qwertz" };
  s.typing.course = { layout: "ch-de-qwertz", lessonIndex: 5, bursts: [], decision: null, completed: ["TYPE-CH-COURSE-1", "TYPE-CH-COURSE-2", "TYPE-CH-COURSE-3", "TYPE-CH-COURSE-4", "TYPE-CH-COURSE-5"] };
  const done = (at: string) => ({ status: "done" as const, openedAt: at, finishedAt: at, attempts: [], support: [], plays: 0, questions: {}, phase: "answer" as const, outcome: "independent" as const });
  s.missions = { "MISSION-GREENHOUSE-GROW": { missionId: "MISSION-GREENHOUSE-GROW", version: 1, visit: "v9", startedAt: "2026-11-01T11:02:00.000Z", position: "greenhouse", visited: [], active: null, steps: { "H2-POTS": done("2026-11-01T11:14:32.000Z"), "H4-FLOOR": done("2026-11-01T11:17:30.000Z"), "H5-PLANS": done("2026-11-01T11:19:30.000Z"), "H9-WATERING": done("2026-11-01T11:28:00.000Z") }, facts: {}, shownWords: [], typing: null, finishedAt: "2026-11-01T11:34:24.000Z" } } as never;
  s.interests = [{ id: "fx-i", visit: "v9", source: "closing", kind: "choice", text: "Eine Wasserleitung zum Gewächshaus bauen", choice: "water-pipe", at: day(24, 11) }];
  return s;
}
const started = (env: Env) => op(eightVisitsDone(), { op: "start-visit" }, env).state;
function openAt(s: MissionState, step: string, env: Env) {
  // Leave a finished task scene first (the map mission returns to the island between tasks).
  if (run(s)?.active && run(s).steps[run(s).active!]?.status !== "active") s = m(s, { a: "leave" }, env);
  s = m(s, { a: "arrive", place: pipe.steps.find((x) => x.id === step)!.place }, env);
  return m(s, { a: "open", step }, env);
}
const story = (s: MissionState, env: Env) => m(openAt(s, "P1-START", env), { a: "story-done", step: "P1-START" }, env);

describe("content v8: Visit 9 follows Visit 8; rollback cap 7 parks it", () => {
  it("reconciles, with every step authored in advance", () => {
    const r = reconcileLearningContent(rawV8);
    deepStrictEqual(r.problems, []);
    equal(pipe.steps.length, 23);
    ok(pipe.steps.filter((x) => x.adaptive).length >= 12);
  });
  it("v10 is offered after the finished v9 under v8 — and nothing under v7", () => {
    equal(nextVisitAvailability(eightVisitsDone(), v8, new Date()).visit, "v10");
    equal(nextVisitAvailability(eightVisitsDone(v7), v7, new Date()).visit, null);
  });
  it("no character speaks outside their language (S1-08): Rosa only Spanish, June only English, Herr Baumann German", () => {
    for (const st of pipe.steps) for (const l of [...st.intro, ...st.done, ...Object.values(st.doneBy ?? {}).flat()]) {
      if (l.speaker === "supplier") equal(l.language, "es", `${st.id}: ${l.text}`);
      if (l.speaker === "gardener") equal(l.language, "en", `${st.id}: ${l.text}`);
      if (l.speaker === "planner") equal(l.language, "de", `${st.id}: ${l.text}`);
    }
  });
  it("no craft inside the visit (S1-10): the end carries a home task instead", () => {
    ok(!pipe.steps.some((x) => x.kind === "craft"));
    ok(pipe.steps.find((x) => x.id === "P12-DONE")!.home);
  });
});

describe("warm-up (S1-12): the attempt records the time since teaching and its retention class", () => {
  it("Nov 8 (≥ 6 days after Nov 1) → delayed retention; the Nov 1 anchor is his own record", () => {
    const env = makeEnv(Date.UTC(2026, 10, 8, 9, 0, 0));
    let s = story(started(env), env);
    s = openAt(s, "P2-PIPES", env);
    const out = op(s, { op: "mission", action: { a: "answer-part", step: "P2-PIPES", part: "pieces", value: "5" } }, env);
    const row = out.records.attempts.at(-1)!;
    equal(row.teachingMove, "warmup");
    equal(row.teachingReason, "groups-with-leftovers:delayed-retention");
    ok(row.secondsSinceTeaching! >= 6 * 86_400);
  });
  it("Nov 7 morning (5.9 days) → short check, never delayed retention", () => {
    const env = makeEnv(Date.UTC(2026, 10, 7, 9, 0, 0));
    let s = story(started(env), env);
    s = openAt(s, "P3-TANKBED", env);
    const out = op(s, { op: "mission", action: { a: "answer-part", step: "P3-TANKBED", part: "all", value: "7 × 4" } }, env);
    const row = out.records.attempts.at(-1)!;
    equal(row.teachingReason, "area-multiplication:short-check");
    equal(row.correct, true);
    deepStrictEqual((row.answer as { raw: string }).raw, "7 × 4", "the written calculation is kept verbatim as evidence (S1-09)");
  });
});

describe("adaptive area station (S1-11): right first time → harder; wrong → teaching, easier, normal again", () => {
  function atBeds(env: Env) {
    let s = story(started(env), env);
    s = openAt(s, "P2-PIPES", env);
    s = m(s, { a: "answer-part", step: "P2-PIPES", part: "pieces", value: "5" }, env);
    s = m(s, { a: "answer-part", step: "P2-PIPES", part: "cut", value: "2" }, env);
    s = openAt(s, "P3-TANKBED", env);
    s = m(s, { a: "answer-part", step: "P3-TANKBED", part: "all", value: "4x7" }, env);
    return openAt(s, "P5-BEDS", env);
  }
  it("right first time unaided → only the harder version", () => {
    const env = makeEnv();
    let s = atBeds(env);
    s = m(s, { a: "answer-part", step: "P5-BEDS", part: "all", value: "5 × 6" }, env);
    s = m(s, { a: "answer-part", step: "P5-BEDS", part: "beds", value: "24" }, env);
    equal(run(s).steps["P5-BEDS"].status, "active", "the «which way» question keeps the problem open");
    s = m(s, { a: "method", step: "P5-BEDS", choice: "minus" }, env);
    const st = stepStatuses(pipe, run(s));
    equal(st["P5-BEDS"], "done");
    equal(st["P5H-BEDS-BIG"], "available");
    equal(st["P5E-BEDS-SMALL"], "not-needed");
    equal(st["P5N-BEDS-AGAIN"], "not-needed");
  });
  it("a wrong calculation is a wrong attempt; after a miss the easier version and then a fresh normal one are offered", () => {
    const env = makeEnv();
    let s = atBeds(env);
    const wrong = op(s, { op: "mission", action: { a: "answer-part", step: "P5-BEDS", part: "all", value: "5 × 5" } }, env);
    equal(wrong.records.attempts.at(-1)!.correct, false);
    s = wrong.state;
    s = m(s, { a: "answer-part", step: "P5-BEDS", part: "all", value: "6 · 5" }, env);
    s = m(s, { a: "answer-part", step: "P5-BEDS", part: "beds", value: "24" }, env);
    s = m(s, { a: "method", step: "P5-BEDS", choice: "rows" }, env);
    const st = stepStatuses(pipe, run(s));
    equal(st["P5H-BEDS-BIG"], "not-needed");
    equal(st["P5E-BEDS-SMALL"], "available");
    equal(st["P5N-BEDS-AGAIN"], "locked");
  });
  it("«which way» is unscored and only after the question is solved", () => {
    const env = makeEnv();
    const s = atBeds(env);
    throws(() => m(s, { a: "method", step: "P5-BEDS", choice: "minus" }, env), (e: unknown) => e instanceof LearningOpError);
  });
});

describe("writing (S1-13a, S1-05): the end mark alone is a revision prompt; Nokt first, the app's tip only without Nokt", () => {
  function atJournal(env: Env) {
    let s = story(started(env), env);
    // The journal requires the two normal math stations; walk them right first time.
    s = openAt(s, "P2-PIPES", env);
    s = m(s, { a: "answer-part", step: "P2-PIPES", part: "pieces", value: "5" }, env);
    s = m(s, { a: "answer-part", step: "P2-PIPES", part: "cut", value: "2" }, env);
    s = openAt(s, "P3-TANKBED", env);
    s = m(s, { a: "answer-part", step: "P3-TANKBED", part: "all", value: "4x7" }, env);
    s = openAt(s, "P5-BEDS", env);
    s = m(s, { a: "answer-part", step: "P5-BEDS", part: "all", value: "5x6" }, env);
    s = m(s, { a: "answer-part", step: "P5-BEDS", part: "beds", value: "24" }, env);
    s = m(s, { a: "method", step: "P5-BEDS", choice: "minus" }, env);
    s = openAt(s, "P6-EDGE", env);
    s = m(s, { a: "answer-part", step: "P6-EDGE", part: "cm", value: "200" }, env);
    s = m(s, { a: "answer-part", step: "P6-EDGE", part: "around", value: "14" }, env);
    s = m(s, { a: "answer-part", step: "P6-EDGE", part: "inside", value: "3 x 4" }, env);
    return openAt(s, "P11-JOURNAL", env);
  }
  it("Visit 8's sentence (no period) is not «incorrect»: unscored original, a revision with the period is supported", () => {
    const env = makeEnv();
    let s = atJournal(env);
    const out = op(s, { op: "mission", action: { a: "write", step: "P11-JOURNAL", text: "Heute haben wir eine Wasserleitung gebaut. Das Wasser fliesst ins Gewächshaus" } }, env);
    const row = out.records.attempts.at(-1)!;
    equal(row.evidence, "unscored");
    equal(row.correct, null);
    s = out.state;
    equal(run(s).steps["P11-JOURNAL"].writing!.endMarkOnly, true);
    const rev = op(s, { op: "mission", action: { a: "revise", step: "P11-JOURNAL", text: "Heute haben wir eine Wasserleitung gebaut. Das Wasser fliesst ins Gewächshaus." } }, env);
    const r2 = rev.records.attempts.at(-1)!;
    equal(r2.evidence, "supported");
    equal(r2.correct, true);
    equal(run(rev.state).steps["P11-JOURNAL"].writing!.original, "Heute haben wir eine Wasserleitung gebaut. Das Wasser fliesst ins Gewächshaus", "the original is kept as typed");
  });
  it("with Nokt planned, the app's tip is held (no help recorded); it is shown only when Nokt did not react — never both", () => {
    const env = makeEnv(undefined, { noktEnabled: true });
    let s = atJournal(env);
    const out = op(s, { op: "mission", action: { a: "write", step: "P11-JOURNAL", text: "heute haben wir gebaut." } }, env);
    deepStrictEqual(out.records.supports.filter((x) => /correction/.test(x.kind)), [], "no tip shown yet");
    s = out.state;
    equal(run(s).steps["P11-JOURNAL"].writing!.correction, null);
    ok(run(s).steps["P11-JOURNAL"].writing!.pendingCorrection);
    const tip = op(s, { op: "mission", action: { a: "writing-tip", step: "P11-JOURNAL" } }, env);
    equal(tip.records.supports.filter((x) => x.kind === "mission_capital_start_correction").length, 1);
    equal(run(tip.state).steps["P11-JOURNAL"].writing!.correction!.rule, "capital-start");
    // Once Nokt's reaction is recorded as shown, the app's tip is refused.
    const withNokt = structuredClone(s);
    run(withNokt).steps["P11-JOURNAL"].support.push({ kind: "nokt-writing", at: "2026-11-08T09:10:00.000Z", detail: "turn-x" });
    throws(() => op(withNokt, { op: "mission", action: { a: "writing-tip", step: "P11-JOURNAL" } }, env), (e: unknown) => e instanceof LearningOpError);
  });
});

import { meaningfulSuccess, wishLine } from "./family-learning-mission.ts";
import { noktNoReplyLine, visitReportEn, PARENT_HELPED_NOTE } from "./family-learning-parent-report-en.ts";

describe("closing summary (S1-13d) and the English parent report (S1-13e, S1-06, S1-13c)", () => {
  const done = (outcome: "independent" | "supported") => ({ status: "done" as const, openedAt: "x", finishedAt: "x", attempts: [], support: [], plays: 0, questions: {}, phase: "answer" as const, outcome });
  it("the most meaningful success: the harder version beats the newest normal station and a warm-up", () => {
    const r = { steps: { "P2-PIPES": done("independent"), "P5-BEDS": done("independent"), "P5H-BEDS-BIG": done("independent") } } as unknown as MissionRun;
    ok(/schwierigere Aufgabe/.test(meaningfulSuccess(pipe, r)!));
    const r2 = { steps: { "P2-PIPES": done("independent"), "P5-BEDS": done("supported"), "P6-EDGE": done("independent") } } as unknown as MissionRun;
    ok(meaningfulSuccess(pipe, r2)!.startsWith("Rund herum und innen"));
    const r3 = { steps: { "P2-PIPES": done("independent") } } as unknown as MissionRun;
    ok(/noch gewusst/.test(meaningfulSuccess(pipe, r3)!));
  });
  it("the next-visit line names the wish actually chosen — never «dein Wunsch zählt»", () => {
    const s = eightVisitsDone();
    s.interests = [...(s.interests ?? []), { id: "w", visit: "v10", source: "closing", kind: "choice", text: "Einen kleinen Teich anlegen", choice: "pond", at: "2026-11-08T10:00:00.000Z" }];
    equal(wishLine(s, "v10"), "Nächstes Mal: «Einen kleinen Teich anlegen» — das hast du dir gewünscht.");
    ok(!/Wunsch zählt/.test(wishLine(eightVisitsDone(), "v10")));
  });
  it("«Nokt did not respond 3× (unreachable 3)», versions, warm-up timing and «I helped here» from the records", () => {
    const env = makeEnv(Date.UTC(2026, 10, 8, 9, 0, 0));
    let s = story(started(env), env);
    s = openAt(s, "P2-PIPES", env);
    const out = op(s, { op: "mission", action: { a: "answer-part", step: "P2-PIPES", part: "pieces", value: "5" } }, env);
    s = out.state;
    (s as unknown as { noktTalks: unknown }).noktTalks = { welcomes: [], sessions: (["welcome", "writing", "debrief"] as const).map((purpose, i) => ({ id: `s${i}`, purpose, visit: "v10", visitStartedAt: null, page: `p${i}`, startedAt: "x", closedAt: null, turns: [{ turnId: `t${i}`, role: "nokt", text: "", origin: "missing", shown: false, reason: "no-reply-unreachable", phase: "x", provenance: null, at: "x" }], dispatches: [] })) };
    const rows = out.records.attempts.map((a, i) => ({ ...a, id: `a${i}`, createdAt: a.at, parentCorrection: i === 0 ? { evidence: "supported", note: PARENT_HELPED_NOTE, by: "parent@example.invalid", at: "x" } : null })) as never;
    const rep = visitReportEn({ state: s, attempts: rows, supports: [] }, v8, "v10", "Visit 9")!;
    equal(noktNoReplyLine(rep.nokt), "Nokt did not respond 3× (unreachable 3)");
    const t = rep.tasks.find((x) => x.step === "P2-PIPES")!;
    equal(t.warmup!.counts, "delayed retention");
    equal(t.attempts[0].result, "right first time");
    equal(t.attempts[0].parentHelped, true);
    ok(rep.homeTask && /Massband/.test(rep.homeTask));
  });
});
