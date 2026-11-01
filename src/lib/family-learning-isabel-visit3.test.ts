// Step 1 / Isabel Visit 3 (content v3, 2026-11-01): «Ernten und probieren». Every fixture is SYNTHETIC. Child isolation is
// checked against Santiago's content v8 in both directions.
import { deepStrictEqual, equal, ok, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { asLearningContent, type LearningContent } from "./family-learning-content.ts";
import { asIsabelContent, reconcileIsabelContent, workshopMission, ALL_ISABEL_STEP_IDS } from "./family-learning-isabel.ts";
import { stepStatuses, type MissionAction } from "./family-learning-mission.ts";
import { applyLearningOp, EMPTY_PARENT_SETTINGS, newMissionState, nextVisitAvailability, type LearningOp, type MissionState, type OpEnv, type ParentSettings } from "./family-learning-state.ts";
import { visitLabel } from "./family-learning-summary.ts";
import { sanitizeTelemetryEvent } from "./family-learning-telemetry-schema.ts";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../data/family-learning/content/${name}`, import.meta.url), "utf8"));
const v2: LearningContent = asIsabelContent(read("isabel-workshop-v2.json"));
const v3: LearningContent = asIsabelContent(read("isabel-workshop-v3.json"));
const santiago: LearningContent = asLearningContent(read("santiago-expedition-v8.json"));
const harvest = workshopMission(v3, "v4")!;

type Env = OpEnv & { settings: ParentSettings };
function makeEnv(content: LearningContent = v3, start = Date.UTC(2026, 10, 7, 15, 0, 0)): Env {
  let t = start;
  let n = 0;
  return { content, settings: { ...EMPTY_PARENT_SETTINGS }, now: () => new Date((t += 10_000)), newId: () => `id-${(n += 1)}`, tutorAvailable: false };
}
const op = (s: MissionState, o: LearningOp, env: Env) => applyLearningOp(s, o, env).state;
const m = (s: MissionState, action: MissionAction, env: Env) => op(s, { op: "mission", action }, env);

/** Synthetic: Visits 1 and 2 finished (shape only). */
function twoVisitsDone(content: LearningContent = v3): MissionState {
  const s = newMissionState(content, "isabel", "2026-10-28T16:34:00.000Z");
  s.visits = [
    { id: "v1", startedAt: "2026-10-28T16:34:00.000Z", finishedAt: "2026-10-28T16:50:00.000Z", stageIndex: 99, skippedStages: [], reflection: "right" },
    { id: "v2", startedAt: "2026-11-01T13:48:55.000Z", finishedAt: "2026-11-01T13:57:49.000Z", stageIndex: 99, skippedStages: [], reflection: "right" },
  ];
  s.interests = [{ id: "fx", visit: "v2", source: "closing", kind: "choice", text: "Ernten und probieren", choice: "harvest", at: "2026-11-01T13:57:49.000Z" }];
  return s;
}

describe("Isabel content v3: Visit 3 follows Visit 2; cap 2 parks it; learner-facing «Besuch 3»", () => {
  it("v1, v2 and v3 reconcile; v3 keeps v1/v2 byte-identical", () => {
    for (const v of [1, 2, 3]) deepStrictEqual(reconcileIsabelContent(read(`isabel-workshop-v${v}.json`)).problems, [], `v${v}`);
    const raw2 = read("isabel-workshop-v2.json");
    const raw3 = read("isabel-workshop-v3.json");
    deepStrictEqual(raw3.missions.slice(0, 2), raw2.missions);
    deepStrictEqual(raw3.visits.slice(0, 2), raw2.visits);
  });
  it("after Visit 2 her next visit is v4 under v3, nothing under v2", () => {
    equal(nextVisitAvailability(twoVisitsDone(), v3, new Date()).visit, "v4");
    equal(nextVisitAvailability(twoVisitsDone(v2), v2, new Date()).visit, null);
    ok(/Besuch 3/.test(visitLabel(twoVisitsDone(), v3, "v4")), visitLabel(twoVisitsDone(), v3, "v4"));
  });
  it("no craft inside the visit; a home task at the end (S1-10); about 12–15 minutes", () => {
    ok(!harvest.steps.some((x) => x.kind === "craft"));
    ok(harvest.steps.find((x) => x.kind === "outcome")!.home);
    deepStrictEqual(harvest.estimatedMinutes, { min: 12, max: 15 });
  });
});

describe("reading: she reads before anything is spoken (never hear-the-target-first)", () => {
  it("no spoken line before the attempt names MAIS, NUSS or the phrase", () => {
    for (const id of ["IH7-READ", "IH8-READ", "IH9-PHRASE"]) {
      const st = harvest.steps.find((x) => x.id === id)!;
      for (const word of st.text!.body.split(" ").filter((w) => w.length > 3)) {
        for (const l of st.intro) ok(!new RegExp(word, "i").test(l.text), `${id} intro says ${word}`);
        ok(!new RegExp(word, "i").test(st.questions![0].prompt), `${id} question says ${word}`);
      }
    }
  });
});

describe("tens and adding: adaptive paths (S1-11, S1-15)", () => {
  function atTens(env: Env) {
    let s = op(twoVisitsDone(), { op: "start-visit" }, env);
    s = m(m(s, { a: "open", step: "IH1-HELLO" }, env), { a: "story-done", step: "IH1-HELLO" }, env);
    s = m(s, { a: "leave" }, env);
    s = m(m(s, { a: "open", step: "IH2-PICK" }, env), { a: "decide", step: "IH2-PICK", option: "apples" }, env);
    s = m(s, { a: "leave" }, env);
    s = m(m(s, { a: "open", step: "IH3-BUNDLE" }, env), { a: "answer-part", step: "IH3-BUNDLE", part: "one", value: "10" }, env);
    s = m(s, { a: "leave" }, env);
    return m(s, { a: "open", step: "IH4-TENS" }, env);
  }
  it("tens right first time → no fresh repeat; adding right first time → the harder 8 + 5, not the easier one", () => {
    const env = makeEnv();
    let s = atTens(env);
    for (const [part, v] of [["sticks", 43], ["which", 23], ["apples", 14]] as const) s = m(s, { a: "answer-part", step: "IH4-TENS", part, value: String(v) }, env);
    s = m(s, { a: "leave" }, env);
    let st = stepStatuses(harvest, s.missions![harvest.id]);
    equal(st["IH5-TENS-AGAIN"], "not-needed");
    s = m(s, { a: "open", step: "IH6-PLUS" }, env);
    s = m(s, { a: "answer-part", step: "IH6-PLUS", part: "plus", value: "10" }, env);
    s = m(s, { a: "answer-part", step: "IH6-PLUS", part: "minus", value: "10" }, env);
    st = stepStatuses(harvest, s.missions![harvest.id]);
    equal(st["IH6H-BRIDGE"], "available");
    equal(st["IH6E-SMALL"], "not-needed");
  });
  it("a miss on the tens → the fresh application is offered; a miss on adding → the easier one, never the harder", () => {
    const env = makeEnv();
    let s = atTens(env);
    s = m(s, { a: "answer-part", step: "IH4-TENS", part: "sticks", value: "34" }, env);
    for (const [part, v] of [["sticks", 43], ["which", 23], ["apples", 14]] as const) s = m(s, { a: "answer-part", step: "IH4-TENS", part, value: String(v) }, env);
    s = m(s, { a: "leave" }, env);
    equal(stepStatuses(harvest, s.missions![harvest.id])["IH5-TENS-AGAIN"], "available");
  });
});

describe("child isolation: each child is served only her/his own content, records and steps", () => {
  it("Isabel's content refuses Santiago's file and vice versa", () => {
    throws(() => asIsabelContent(read("santiago-expedition-v8.json")));
    throws(() => asLearningContent(read("isabel-workshop-v3.json")));
  });
  it("no mission, step or character id is shared between the two lines", () => {
    const ids = (c: LearningContent) => new Set((c.missions ?? []).flatMap((x) => [x.id, ...x.steps.map((st) => st.id)]));
    const a = ids(v3);
    for (const id of ids(santiago)) ok(!a.has(id), id);
    ok(!santiago.missions!.some((x) => x.characters.some((c) => c.id === "ida")));
  });
  it("Isabel's state never offers Santiago's visit v10, and her telemetry vocabulary names her new steps", () => {
    ok(!v3.visits.some((v) => v.id === "v10"));
    for (const id of ["IH4-TENS", "IH9-PHRASE"]) ok(ALL_ISABEL_STEP_IDS.includes(id) && sanitizeTelemetryEvent({ t: 1, kind: "stage-enter", stage: "mission", step: id }));
  });
});
