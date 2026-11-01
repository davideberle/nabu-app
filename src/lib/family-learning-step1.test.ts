// Step 1 (2026-11-01): adaptive versions (S1-11), warm-up timing (S1-12), written calculations (S1-09), the end-mark rule
// (S1-13a) and one helper per moment (S1-05). Pure engine checks on small synthetic missions; no database, no network.
import { deepStrictEqual, equal, ok, throws } from "node:assert/strict";
import { describe, it } from "node:test";
import { checkAdaptiveBudget, type MissionDef, type MissionStep } from "./family-learning-mission-spec.ts";
import { DELAYED_RETENTION_DAYS, parseCalculation, retentionClass, stepStatuses, warmupAnchors, type MissionRun, type MissionStepRun } from "./family-learning-mission.ts";

const line = (text: string) => ({ speaker: null, text, language: "de" as const });
const step = (id: string, extra: Partial<MissionStep> = {}): MissionStep => ({ id, version: 1, kind: "story", title: id, place: "p", character: null, requires: [], required: true, objective: "story", intro: [line("x")], done: [line("y")], ...extra });
const def = (steps: MissionStep[]): MissionDef => ({ id: "M-TEST", version: 1, visit: "v10", title: "t", objective: "o", presentation: "map", theme: { basis: "owner-chosen", source: "s", value: "v", note: "n" }, map: { start: "p", places: [], paths: [] }, characters: [], steps, world: [], estimatedMinutes: { min: 1, max: 2 }, rules: { maxCalcAttempts: 3, maxQuestionAttempts: 2, maxProduceAttempts: 3, maxChoiceAttempts: 2 } } as unknown as MissionDef);
const finished = (outcome: MissionStepRun["outcome"]): MissionStepRun => ({ status: "done", openedAt: "2026-11-07T09:00:00Z", finishedAt: "2026-11-07T09:05:00Z", attempts: [], support: [], plays: 0, questions: {}, phase: "answer", outcome });
const run = (steps: Record<string, MissionStepRun>): MissionRun => ({ missionId: "M-TEST", version: 1, visit: "v10", startedAt: "2026-11-07T09:00:00Z", position: "p", visited: [], active: null, steps, facts: {}, shownWords: [], typing: null, finishedAt: null } as MissionRun);

const adaptive = def([
  step("N", { required: true, adaptive: { skill: "perimeter", level: "normal" } }),
  step("H", { required: false, requires: ["N"], when: { step: "N", ifEvidence: "independent" }, adaptive: { skill: "perimeter", level: "harder" } }),
  step("E", { required: false, requires: ["N"], when: { step: "N", unlessEvidence: "independent" }, adaptive: { skill: "perimeter", level: "easier" } }),
  step("N2", { required: false, requires: ["E"], when: { step: "N", unlessEvidence: "independent" }, adaptive: { skill: "perimeter", level: "normal-again" } }),
]);

describe("S1-11 adaptive versions", () => {
  it("right first time unaided → only the harder version is offered", () => {
    const st = stepStatuses(adaptive, run({ N: finished("independent") }));
    equal(st.H, "available");
    equal(st.E, "not-needed");
    equal(st.N2, "not-needed");
  });
  it("wrong (taught or supported) → easier, then a fresh normal one; never the harder one", () => {
    for (const outcome of ["supported", "answer_exposed", "unresolved"] as const) {
      let st = stepStatuses(adaptive, run({ N: finished(outcome) }));
      equal(st.H, "not-needed", outcome);
      equal(st.E, "available", outcome);
      equal(st.N2, "locked", "normal-again waits for the easier one");
      st = stepStatuses(adaptive, run({ N: finished(outcome), E: finished("independent") }));
      equal(st.N2, "available");
    }
  });
  it("nothing is offered before the normal version is resolved", () => {
    const st = stepStatuses(adaptive, run({}));
    deepStrictEqual([st.H, st.E, st.N2], ["locked", "locked", "locked"]);
  });
  it("the validator allows at most two extra tasks per skill and path, and one normal version", () => {
    const problems: string[] = [];
    checkAdaptiveBudget(adaptive.steps as unknown[], "M", problems);
    deepStrictEqual(problems, []);
    const tooMany = [...adaptive.steps, step("E2", { required: false, when: { step: "N", unlessEvidence: "independent" }, adaptive: { skill: "perimeter", level: "easier" } })];
    checkAdaptiveBudget(tooMany as unknown[], "M", problems);
    ok(problems.some((p) => /more than 2 extra/.test(p)), problems.join("; "));
    const orphan: string[] = [];
    checkAdaptiveBudget([step("H", { when: { step: "X", ifEvidence: "independent" }, adaptive: { skill: "s", level: "harder" } })] as unknown[], "M", orphan);
    ok(orphan.some((p) => /exactly one normal/.test(p)));
  });
});

describe("S1-12 warm-up timing", () => {
  it("≥ 6 days counts as delayed retention, shorter as a short check, none without a teaching record", () => {
    equal(DELAYED_RETENTION_DAYS, 6);
    equal(retentionClass(6 * 86_400), "delayed-retention");
    equal(retentionClass(6 * 86_400 - 1), "short-check");
    equal(retentionClass(3600), "short-check");
    equal(retentionClass(null), "no-teaching-record");
  });
  it("the anchor is the latest finish of the named steps in THIS child's own mission runs", () => {
    const d = def([step("W1", { warmup: { skill: "groups-with-leftovers", taughtIn: [{ mission: "MISSION-ISLAND-GARDEN", step: "G2-PACK" }, { mission: "MISSION-GREENHOUSE-GROW", step: "H2-POTS" }] } }), step("W2", { warmup: { skill: "never", taughtIn: [{ mission: "MISSION-NONE", step: "X" }] } })]);
    const state = { missions: { "MISSION-ISLAND-GARDEN": { steps: { "G2-PACK": { finishedAt: "2026-10-26T10:00:00Z" } } }, "MISSION-GREENHOUSE-GROW": { steps: { "H2-POTS": { finishedAt: "2026-11-01T11:14:32Z" } } } } };
    const anchors = warmupAnchors(state as never, d);
    equal(anchors.W1, "2026-11-01T11:14:32Z");
    equal(anchors.W2, null);
    const seconds = (Date.parse("2026-11-07T09:00:00Z") - Date.parse(anchors.W1!)) / 1000;
    equal(retentionClass(seconds), "short-check", "Nov 1 → Nov 7 morning is 5.9 days: a short check, not delayed retention");
    equal(retentionClass((Date.parse("2026-11-08T09:00:00Z") - Date.parse(anchors.W1!)) / 1000), "delayed-retention");
  });
});

describe("S1-09 written calculations", () => {
  it("accepts the two factors in either order with the usual signs; a wrong calculation is a wrong attempt, not an error", () => {
    for (const v of ["5 × 6", "6x5", "5*6", "5 · 6", "5 mal 6", "6 X 5 = 30", "5×6=30"]) equal(parseCalculation(v, [5, 6]), 30, v);
    equal(parseCalculation("5 × 7", [5, 6]), -1);
    equal(parseCalculation("5 × 6 = 31", [5, 6]), -1);
    for (const v of ["30", "", "5 + 6", "fünf mal sechs"]) throws(() => parseCalculation(v, [5, 6]), v);
  });
});
