// Nov 18 round: Santiago Visit 11 «Den Teich füllen» (content v10, visit v12) and Isabel Visit 5 «Die Vögel ziehen ein»
// (content v5, visit v6). Every number is NEXT-VISITS-V11.md: the test recomputes each answer from what the child sees.
// Synthetic and offline: no child data, no provider, no network.

import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { asLearningContent, SUPPORTED_CONTENT_VERSIONS } from "./family-learning-content.ts";
import { asIsabelContent, ISABEL_CONTENT_VERSIONS, reconcileIsabelContent } from "./family-learning-isabel.ts";
import { deriveHomeWorld, WORLDS } from "./family-home-map.ts";
import { ASSETS } from "./family-home-map-assets.ts";
import { stepStatuses, type MissionAction } from "./family-learning-mission.ts";
import { WORKSHOP_PICTURES } from "./family-learning-mission-spec.ts";
import { catalogKey, narrationCatalog, storyCatalog, type NarrationLine } from "./family-learning-narration.ts";
import { resolveObjective } from "./family-learning-skill-map.ts";
import { applyLearningOp, EMPTY_PARENT_SETTINGS, newMissionState, nextVisitAvailability, type LearningOp, type MissionState, type OpEnv, type ParentSettings } from "./family-learning-state.ts";
import { visitLabel } from "./family-learning-summary.ts";
import { sanitizeTelemetryEvent } from "./family-learning-telemetry-schema.ts";

const rd = (n: string) => JSON.parse(readFileSync(new URL(`../data/family-learning/content/${n}`, import.meta.url), "utf8"));
const s9 = asLearningContent(rd("santiago-expedition-v9.json"));
const s10 = asLearningContent(rd("santiago-expedition-v10.json"));
const i4 = asIsabelContent(rd("isabel-workshop-v4.json"));
const i5 = asIsabelContent(rd("isabel-workshop-v5.json"));
const fill = s10.missions!.find((m) => m.visit === "v12")!;
const food = i5.missions!.find((m) => m.visit === "v6")!;
type M = typeof fill;
const st = (m: M, id: string) => m.steps.find((s) => s.id === id)!;
const solve = (m: M, id: string, part: string) => st(m, id).solve!.parts.find((p) => p.id === part)!;

describe("versions: each new visit follows the last one; earlier visits stay byte-identical", () => {
  it("Santiago content v10 = v9 + visit v12; Isabel content v5 = v4 + visit v6", () => {
    ok(SUPPORTED_CONTENT_VERSIONS.includes(10) && ISABEL_CONTENT_VERSIONS.includes(5));
    const a = rd("santiago-expedition-v9.json");
    const b = rd("santiago-expedition-v10.json");
    deepEqual(b.missions.slice(0, a.missions.length), a.missions);
    deepEqual(b.visits.slice(0, a.visits.length), a.visits);
    deepEqual(b.typing.course.lessons.slice(0, a.typing.course.lessons.length), a.typing.course.lessons);
    const c = rd("isabel-workshop-v4.json");
    const d = rd("isabel-workshop-v5.json");
    deepEqual(d.missions.slice(0, c.missions.length), c.missions);
    deepEqual(d.visits.slice(0, c.visits.length), c.visits);
    deepEqual(reconcileIsabelContent(d).problems, []);
  });
  it("after Visit 10 Santiago is offered v12; after Visit 4 Isabel is offered v6, labelled «Besuch 11» / «Besuch 5»", () => {
    const s = newMissionState(s10, "santiago", "2026-09-29T13:00:00.000Z");
    s.visits = ["v1", "v2", "v4", "v5", "v6", "v7", "v8", "v9", "v10", "v11"].map((id, n) => ({ id: id as never, startedAt: `2026-10-${String(n + 1).padStart(2, "0")}T10:00:00.000Z`, finishedAt: `2026-10-${String(n + 1).padStart(2, "0")}T11:00:00.000Z`, stageIndex: 99, skippedStages: [], reflection: "easy" }));
    equal(nextVisitAvailability(s, s10, new Date()).visit, "v12");
    equal(nextVisitAvailability(s, s9, new Date()).visit, null, "under the cap (v9) nothing further is offered");
    ok(/Besuch 11/.test(visitLabel(s, s10, "v12")), visitLabel(s, s10, "v12"));
    const i = newMissionState(i5, "isabel", "2026-10-28T16:00:00.000Z");
    i.visits = ["v1", "v2", "v4", "v5"].map((id, n) => ({ id: id as never, startedAt: `2026-11-0${n + 1}T10:00:00.000Z`, finishedAt: `2026-11-0${n + 1}T11:00:00.000Z`, stageIndex: 99, skippedStages: [], reflection: "right" }));
    equal(nextVisitAvailability(i, i5, new Date()).visit, "v6");
    equal(nextVisitAvailability(i, i4, new Date()).visit, null, "under her cap (v4) nothing further is offered");
    ok(/Besuch 5/.test(visitLabel(i, i5, "v6")), visitLabel(i, i5, "v6"));
  });
  it("telemetry knows the new step ids", () => {
    for (const id of ["F7-BOMBA", "F7J-SPOT", "F12-END", "IF2-WARM", "IF9-EI"]) ok(sanitizeTelemetryEvent({ t: 1, kind: "stage-enter", stage: "mission", step: id }), id);
  });
});

describe("Santiago Visit 11 — every number recomputed from what he sees", () => {
  it("warm-ups (delayed checks of Visit 10): 5 × 4 m bed, a stone every 50 cm on 6 m, «piedras» from memory", () => {
    equal(solve(fill, "F2-AROUND", "around").answer, 2 * (5 + 4));
    equal(solve(fill, "F2C-STONES", "stones").answer, (6 * 100) / 50);
    ok(st(fill, "F2S-PIEDRAS").produce!.keywords.includes("piedras"));
    ok(st(fill, "F2S-PIEDRAS").produce!.bankAfterAttempt, "word list only after a first try");
    for (const id of ["F2-AROUND", "F2C-STONES", "F2S-PIEDRAS"]) ok(st(fill, id).warmup?.taughtIn.some((t) => t.mission === "MISSION-TURTLE-POND"), id);
  });
  it("the tank question he never reached on Nov 8 is now the normal version (12 × 2 L, 120 L lasts 5 days)", () => {
    equal(solve(fill, "F3-TANK", "day").answer, 12 * 2);
    equal(solve(fill, "F3-TANK", "days").answer, 120 / (12 * 2));
    const p6h = s9.missions!.find((m) => m.visit === "v10")!.steps.find((s) => s.id === "P6H-LITERS")!;
    deepEqual(st(fill, "F3-TANK").solve!.parts.map((p) => p.answer), p6h.solve!.parts.map((p) => p.answer));
    equal(solve(fill, "F3E-BARREL", "days").answer, 60 / 10);
    equal(solve(fill, "F3H-SUMMER", "day").answer, 12 * 3);
    equal(solve(fill, "F3H-SUMMER", "days").answer, Math.floor(120 / (12 * 3)));
    equal(120 - 3 * 36, 12, "the teach line's remainder");
  });
  it("1 cm of water in the 4 m × 3 m pond is 120 L (one full tank); liters, buckets and pump minutes", () => {
    const perCm = (4 * 100) * (3 * 100) * 1 / 1000; // cm³ → liters
    equal(perCm, 120);
    equal(solve(fill, "F5-LITERS", "liters").answer, 10 * perCm);
    equal(solve(fill, "F5E-TWO", "liters").answer, 2 * perCm);
    equal(solve(fill, "F5H-LATER", "liters").answer, 20 * perCm);
    equal(solve(fill, "F6-BUCKETS", "buckets").answer, 1200 / 10);
    equal(solve(fill, "F6E-BUCKETS-SMALL", "buckets").answer, 240 / 10);
    equal(solve(fill, "F6H-BIG-BUCKET", "buckets").answer, 1200 / 12);
    equal(solve(fill, "F8-PUMP", "minutes").answer, 1200 / 100);
    equal(solve(fill, "F8E-PUMP-SHORT", "minutes").answer, 300 / 100);
    equal(solve(fill, "F8H-PUMP-LATER", "minutes").answer, 2400 / 100);
    for (const id of ["F3-TANK", "F5-LITERS", "F6-BUCKETS", "F8-PUMP"]) for (const p of st(fill, id).solve!.parts) for (const h of p.hints) if (h.check) ok(String(h.check.answer).length, `${id}/${h.id}`);
    equal(Number(solve(fill, "F5-LITERS", "liters").hints[0].check!.answer), 2 * perCm);
    equal(Number(solve(fill, "F6-BUCKETS", "buckets").hints[0].check!.answer), 100 / 10);
    equal(Number(solve(fill, "F8-PUMP", "minutes").hints[0].check!.answer), 300 / 100);
  });
  it("the pump spot: only A keeps both rules (in sea water, at most 15 m of hose)", () => {
    const spots = [["a", true, 12], ["b", true, 20], ["c", false, 6]] as const;
    const d = st(fill, "F7J-SPOT").decide!;
    for (const [id, water, m] of spots) equal(d.options.find((o) => o.id === id)!.viable, water && m <= 15, id);
    equal(d.singleViable, true);
    equal(d.noktAfterWrong, 2);
  });
  it("listening: the numbers are in the audio, every answer is an option with a picture", () => {
    ok(/diez centímetros/.test(st(fill, "F4-MATEO").text!.body));
    equal(st(fill, "F4-MATEO").questions![0].answer, "10 cm tief");
    ok(/ahora/.test(st(fill, "F4H-LATER").text!.body) && /veinte/.test(st(fill, "F4H-LATER").text!.body));
    deepEqual(st(fill, "F4H-LATER").questions!.map((q) => q.answer), ["10 cm tief", "20 cm tief"]);
    ok(/behind the rocks/.test(st(fill, "F9-JUNE").text!.body) && /over the sand/.test(st(fill, "F9-JUNE").text!.body));
    ok(/in front of the pump/.test(st(fill, "F9H-NET").text!.body));
    for (const id of ["F4-MATEO", "F4E-DIEZ", "F4H-LATER", "F9-JUNE", "F9H-NET"]) for (const q of st(fill, id).questions!) {
      ok(q.options!.includes(q.answer), `${id}/${q.id}`);
      for (const o of q.options!) { ok(q.pictures?.[o], `${id}/${o}`); ok(o.length <= 40, o); }
    }
  });
  it("the pump order: new word «bomba», typed, word list only after a first try; «tubo» stays out of the answer", () => {
    const p = st(fill, "F7-BOMBA").produce!;
    deepEqual(p.modelled, ["bomba"]);
    ok(p.accepted.includes("Necesitamos una bomba") && p.bankAfterAttempt);
    ok(p.distractors.includes("tubo"));
  });
  it("characters speak their own language; Dr. Mateo on es-male; the turtle on every scene", () => {
    const lang: Record<string, string> = { supplier: "es", vet: "es", gardener: "en", planner: "de" };
    for (const s of fill.steps) for (const l of [...s.intro, ...s.done, ...Object.values(s.doneBy ?? {}).flat()]) if (l.speaker) equal(l.language, lang[l.speaker], `${s.id}: ${l.text}`);
    equal(fill.characters.find((c) => c.id === "vet")!.voice, "es-male");
    equal(fill.companion?.id, "turtle");
  });
  it("ends on a picture choice with one word each; cliffhanger once; home task; no craft", () => {
    equal(fill.noNextChoice, undefined);
    deepEqual(fill.nextAdventure!.choices.map((c) => c.label), ["Seegras", "Krebse", "Quallen"]);
    for (const c of fill.nextAdventure!.choices) { ok(!/\s/.test(c.label)); ok((WORKSHOP_PICTURES as readonly string[]).includes(c.picture), c.picture); }
    equal(fill.closing?.cliffhanger, "{Turtle} schwimmt. Aber was frisst eine Meeresschildkröte?");
    ok(/Liter/.test(st(fill, "F12-END").home!.text));
    ok(!fill.steps.some((s) => s.kind === "craft"));
  });
  it("typing lesson 9 (w, o): only keys he has met", () => {
    const l9 = s10.typing.course!.lessons.find((l) => l.id === "TYPE-CH-COURSE-9")!;
    deepEqual(l9.keys, ["w", "o"]);
    ok((fill.typingBlock!.material?.["TYPE-CH-COURSE-9"] ?? []).length >= 4);
  });
});

describe("Isabel Visit 5 — every number recomputed from what she sees", () => {
  const c = (id: string, p: string) => solve(food, id, p).counters!;
  it("seed bags of ten (closed), tens or ones", () => {
    for (const [id, part, bags, ones] of [["IF2-WARM", "seeds", 3, 7], ["IF2E-WARM-EASY", "seeds", 1, 4], ["IF3-SEEDS", "which", 5, 2], ["IF3E-SEEDS-EASY", "which", 1, 2]] as const) {
      equal(solve(food, id, part).answer, bags * 10 + ones, id);
      deepEqual([c(id, part).a, c(id, part).b, c(id, part).icon, c(id, part).closed], [bags * 10, ones, "seed", true], id);
    }
    ok(/25 oder 52/.test(solve(food, "IF3-SEEDS", "which").question), "the swapped digits are the choice (her 56/26 slip)");
  });
  it("how many more: the difference up to Papa's amount", () => {
    for (const [id, mama, papa] of [["IF4-MORE", 20, 30], ["IF4E-MORE-EASY", 6, 8], ["IF4H-MORE-HARD", 24, 30]] as const) {
      equal(solve(food, id, "more").answer, papa - mama, id);
      deepEqual([c(id, "more").a, c(id, "more").frame], [mama, papa], id);
      ok(new RegExp(`Mama hat ${mama} Körner\\. Papa hat ${papa}\\.`).test(solve(food, id, "more").question), id);
    }
  });
  it("taking away: the birds peck", () => {
    for (const [id, had, peck] of [["IF5-AWAY", 15, 5], ["IF5E-AWAY-EASY", 7, 3], ["IF5H-AWAY-MORE", 14, 6]] as const) {
      equal(solve(food, id, "away").answer, had - peck, id);
      deepEqual([c(id, "away").a, c(id, "away").b, c(id, "away").op], [had, peck, "-"], id);
    }
  });
  it("reading: NEST (her wish, from memory), FUTTER and EI (new); letters only after a miss; nothing said before she reads", () => {
    deepEqual(["IF2N-NEST", "IF6-FUTTER", "IF9-EI"].map((id) => st(food, id).text!.body), ["NEST", "FUTTER", "EI"]);
    for (const id of ["IF2N-NEST", "IF6-FUTTER", "IF9-EI"]) {
      const s = st(food, id);
      equal(s.letters?.afterMiss, true);
      for (const l of s.intro) ok(!new RegExp(`\\b${s.text!.body}\\b`, "i").test(l.text), `${id}: ${l.text}`);
      for (const o of s.questions![0].options!) ok(s.questions![0].pictures?.[o], `${id}/${o}`);
    }
    ok(st(food, "IF2N-NEST").warmup);
  });
  it("listening: three details, four pictures", () => {
    const l = st(food, "IF7-LISTEN");
    ok(/rote Schale/.test(l.text!.body) && /auf das Brett/.test(l.text!.body) && /neben das Vogelhaus/.test(l.text!.body));
    equal(l.questions![0].options!.length, 4);
    for (const o of l.questions![0].options!) ok(o.length <= 40, o);
  });
  it("her food choice is a story choice shown on the map; the end is a picture choice with one word each", () => {
    const d = st(food, "IF8-FOOD").decide!;
    equal(d.storyKey, "birdFood");
    deepEqual(d.options.map((o) => o.id), ["seeds", "berries", "worms"]);
    deepEqual(food.world.map((w) => w.choice?.option), ["seeds", "berries", "worms"]);
    deepEqual(food.nextAdventure!.choices.map((x) => x.label), ["Wasser", "Wolle", "Busch"]);
    deepEqual(food.closing?.liked?.options.map((x) => x.label), ["Körner", "Lesen", "Vögel"]);
  });
  it("the cliffhanger is one line; a home task; no craft", () => {
    deepEqual(st(food, "IF10-HOME").done.map((l) => l.text), ["Ein Ei im Nest. Ob bald noch mehr kommen?"]);
    ok(st(food, "IF10-HOME").home && !food.steps.some((s) => s.kind === "craft"));
  });
});

describe("a full walk through Isabel's Visit 5 with right answers (synthetic)", () => {
  type Env = OpEnv & { settings: ParentSettings };
  const env: Env = (() => { let t = Date.UTC(2026, 10, 20, 15, 0, 0); let n = 0; return { content: i5, settings: { ...EMPTY_PARENT_SETTINGS }, now: () => new Date((t += 10_000)), newId: () => `id-${(n += 1)}`, tutorAvailable: false }; })();
  const op = (s: MissionState, o: LearningOp) => applyLearningOp(s, o, env).state;
  const m = (s: MissionState, action: MissionAction) => op(s, { op: "mission", action });
  it("every required step completes; the harder versions open, the easier ones are not needed", () => {
    let s = newMissionState(i5, "isabel", "2026-10-28T16:00:00.000Z");
    s.visits = ["v1", "v2", "v4", "v5"].map((id, n) => ({ id: id as never, startedAt: `2026-11-0${n + 1}T10:00:00.000Z`, finishedAt: `2026-11-0${n + 1}T11:00:00.000Z`, stageIndex: 99, skippedStages: [], reflection: "right" }));
    s = op(s, { op: "start-visit" });
    const done = (id: string, act: (x: MissionState) => MissionState) => { s = m(s, { a: "open", step: id }); s = act(s); s = m(s, { a: "leave" }); };
    done("IF1-HELLO", (x) => m(x, { a: "story-done", step: "IF1-HELLO" }));
    done("IF2-WARM", (x) => m(x, { a: "answer-part", step: "IF2-WARM", part: "seeds", value: "37" }));
    done("IF2N-NEST", (x) => m(x, { a: "answer-question", step: "IF2N-NEST", question: "word", value: "Nest" }));
    done("IF3-SEEDS", (x) => m(x, { a: "answer-part", step: "IF3-SEEDS", part: "which", value: "52" }));
    done("IF4-MORE", (x) => m(x, { a: "answer-part", step: "IF4-MORE", part: "more", value: "10" }));
    let status = stepStatuses(food, s.missions![food.id]);
    equal(status["IF2E-WARM-EASY"], "not-needed");
    equal(status["IF3E-SEEDS-EASY"], "not-needed");
    equal(status["IF4E-MORE-EASY"], "not-needed");
    equal(status["IF4H-MORE-HARD"], "available");
    done("IF4H-MORE-HARD", (x) => m(x, { a: "answer-part", step: "IF4H-MORE-HARD", part: "more", value: "6" }));
    done("IF5-AWAY", (x) => m(x, { a: "answer-part", step: "IF5-AWAY", part: "away", value: "10" }));
    done("IF5H-AWAY-MORE", (x) => m(x, { a: "answer-part", step: "IF5H-AWAY-MORE", part: "away", value: "8" }));
    done("IF6-FUTTER", (x) => m(x, { a: "answer-question", step: "IF6-FUTTER", question: "word", value: "Futter" }));
    done("IF7-LISTEN", (x) => m(m(m(x, { a: "support", step: "IF7-LISTEN", kind: "play" }), { a: "listen-outcome", step: "IF7-LISTEN", outcome: "recorded" }), { a: "answer-question", step: "IF7-LISTEN", question: "show", value: "Rote Schale, auf dem Brett, beim Haus" }));
    done("IF8-FOOD", (x) => m(x, { a: "decide", step: "IF8-FOOD", option: "worms" }));
    done("IF9-EI", (x) => m(x, { a: "answer-question", step: "IF9-EI", question: "word", value: "Ei" }));
    s = m(s, { a: "open", step: "IF10-HOME" });
    status = stepStatuses(food, s.missions![food.id]);
    for (const id of ["IF1-HELLO", "IF2-WARM", "IF2N-NEST", "IF3-SEEDS", "IF4-MORE", "IF5-AWAY", "IF6-FUTTER", "IF7-LISTEN", "IF8-FOOD", "IF9-EI"]) equal(status[id], "done", id);
    equal(s.story?.birdFood?.optionId, "worms");
    equal(s.story?.roofColor, undefined, "her roof color stays whatever Visit 4 stored (none in this synthetic state)");
  });
});

describe("a walk through Santiago's Visit 11 with right answers, warm-ups to the pump (synthetic)", () => {
  type Env = OpEnv & { settings: ParentSettings };
  const env: Env = (() => { let t = Date.UTC(2026, 10, 20, 10, 0, 0); let n = 0; return { content: s10, settings: { ...EMPTY_PARENT_SETTINGS }, now: () => new Date((t += 10_000)), newId: () => `id-${(n += 1)}`, tutorAvailable: false }; })();
  const op = (s: MissionState, o: LearningOp) => applyLearningOp(s, o, env).state;
  const m = (s: MissionState, action: MissionAction) => op(s, { op: "mission", action });
  it("solve, recall, listen, produce and the judgment all take his answers; the harder versions open", () => {
    let s = newMissionState(s10, "santiago", "2026-09-29T13:00:00.000Z");
    s.visits = ["v1", "v2", "v4", "v5", "v6", "v7", "v8", "v9", "v10", "v11"].map((id, n) => ({ id: id as never, startedAt: `2026-10-${String(n + 1).padStart(2, "0")}T10:00:00.000Z`, finishedAt: `2026-10-${String(n + 1).padStart(2, "0")}T11:00:00.000Z`, stageIndex: 99, skippedStages: [], reflection: "easy" }));
    s = op(s, { op: "start-visit" });
    const done = (id: string, act: (x: MissionState) => MissionState) => { s = m(s, { a: "arrive", place: st(fill, id).place }); s = m(s, { a: "open", step: id }); s = act(s); s = m(s, { a: "leave" }); };
    const listen = (id: string) => (x: MissionState) => m(m(x, { a: "support", step: id, kind: "play" }), { a: "listen-outcome", step: id, outcome: "recorded" });
    done("F1-POND", (x) => m(x, { a: "story-done", step: "F1-POND" }));
    done("F1R-RADIO", (x) => m(x, { a: "story-done", step: "F1R-RADIO" }));
    done("F2-AROUND", (x) => m(x, { a: "answer-part", step: "F2-AROUND", part: "around", value: "18" }));
    done("F2C-STONES", (x) => m(x, { a: "answer-part", step: "F2C-STONES", part: "stones", value: "12" }));
    done("F2S-PIEDRAS", (x) => m(x, { a: "produce", step: "F2S-PIEDRAS", response: "Necesitamos piedras", modality: "typed" }));
    done("F3-TANK", (x) => m(m(x, { a: "answer-part", step: "F3-TANK", part: "day", value: "24" }), { a: "answer-part", step: "F3-TANK", part: "days", value: "5" }));
    let status = stepStatuses(fill, s.missions![fill.id]);
    equal(status["F3H-SUMMER"], "available");
    equal(status["F3E-BARREL"], "not-needed");
    done("F3H-SUMMER", (x) => m(m(x, { a: "answer-part", step: "F3H-SUMMER", part: "day", value: "36" }), { a: "answer-part", step: "F3H-SUMMER", part: "days", value: "3" }));
    done("F4-MATEO", (x) => m(listen("F4-MATEO")(x), { a: "answer-question", step: "F4-MATEO", question: "deep", value: "10 cm tief" }));
    done("F4H-LATER", (x) => m(m(listen("F4H-LATER")(x), { a: "answer-question", step: "F4H-LATER", question: "now", value: "10 cm tief" }), { a: "answer-question", step: "F4H-LATER", question: "later", value: "20 cm tief" }));
    done("F5-LITERS", (x) => m(x, { a: "answer-part", step: "F5-LITERS", part: "liters", value: "1200" }));
    done("F5H-LATER", (x) => m(x, { a: "answer-part", step: "F5H-LATER", part: "liters", value: "2400" }));
    done("F6-BUCKETS", (x) => m(x, { a: "answer-part", step: "F6-BUCKETS", part: "buckets", value: "120" }));
    done("F6H-BIG-BUCKET", (x) => m(x, { a: "answer-part", step: "F6H-BIG-BUCKET", part: "buckets", value: "100" }));
    done("F7-BOMBA", (x) => m(x, { a: "produce", step: "F7-BOMBA", response: "Necesitamos una bomba", modality: "typed" }));
    done("F7J-SPOT", (x) => m(x, { a: "decide", step: "F7J-SPOT", option: "a" }));
    done("F8-PUMP", (x) => m(x, { a: "answer-part", step: "F8-PUMP", part: "minutes", value: "12" }));
    done("F8H-PUMP-LATER", (x) => m(x, { a: "answer-part", step: "F8H-PUMP-LATER", part: "minutes", value: "24" }));
    done("F9-JUNE", (x) => m(m(listen("F9-JUNE")(x), { a: "answer-question", step: "F9-JUNE", question: "pump", value: "Hinter die Felsen" }), { a: "answer-question", step: "F9-JUNE", question: "hose", value: "Über den Sand" }));
    status = stepStatuses(fill, s.missions![fill.id]);
    for (const id of ["F1-POND", "F2-AROUND", "F2C-STONES", "F2S-PIEDRAS", "F3-TANK", "F4-MATEO", "F5-LITERS", "F6-BUCKETS", "F7-BOMBA", "F7J-SPOT", "F8-PUMP", "F9-JUNE"]) equal(status[id], "done", id);
    for (const id of ["F3H-SUMMER", "F4H-LATER", "F5H-LATER", "F6H-BIG-BUCKET", "F8H-PUMP-LATER"]) equal(status[id], "done", id);
    equal(status["F9H-NET"], "available");
    for (const id of ["F4E-DIEZ", "F5E-TWO", "F6E-BUCKETS-SMALL", "F8E-PUMP-SHORT"]) equal(status[id], "not-needed", id);
  });
});

describe("recordings: released lines unchanged, the new ones name-free", () => {
  const keys = (l: NarrationLine[]) => new Map(l.map((x) => [catalogKey(x), x.text]));
  it("every line already recorded keeps its id and text (Isabel v4 → v5, Santiago v9 → v10)", () => {
    for (const [a, b] of [[narrationCatalog(i4), narrationCatalog(i5)], [storyCatalog(s9, "santiago"), storyCatalog(s10, "santiago")]] as const) {
      const after = keys(b);
      for (const [k, t] of keys(a)) equal(after.get(k), t, k);
    }
  });
  it("new lines: Isabel 104 (4,341 characters), Santiago 12 (507), as in NEXT-VISITS-V11", () => {
    const added = (a: NarrationLine[], b: NarrationLine[]) => { const old = new Set(a.map(catalogKey)); return b.filter((l) => !old.has(catalogKey(l))); };
    const ia = added(narrationCatalog(i4), narrationCatalog(i5));
    const sa = added(storyCatalog(s9, "santiago"), storyCatalog(s10, "santiago"));
    deepEqual([ia.length, ia.reduce((n, l) => n + l.text.length, 0)], [104, 4341]);
    deepEqual([sa.length, sa.reduce((n, l) => n + l.text.length, 0)], [12, 507]);
    for (const l of [...ia, ...sa]) ok(!/[{}]|Tula|Pepe|Flip|Kira|Santi\b|Santiago|Isabel|ß/.test(l.text), l.text);
    for (const l of ia) equal(l.slot, "de-female");
    deepEqual([...new Set(sa.map((l) => l.slot))].sort(), ["en-female", "es-female", "es-male"]);
  });
  it("no tech word in anything either new visit says or shows", () => {
    const RX = /gespeichert|version|aufgabe|modus/i;
    const walk = (v: unknown, key: string): void => {
      if (typeof v === "string") ok(!RX.test(v) || ["objective", "note", "parentNote", "source"].includes(key), `${key}: ${v}`);
      else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (k === "theme" || k === "objective") continue; walk(x, k); }
    };
    walk(fill, "");
    walk(food, "");
    walk(s10.visits.find((v) => v.id === "v12"), "");
    walk(i5.visits.find((v) => v.id === "v6"), "");
  });
  it("every new objective sits on a ladder row or is named as not a skill", () => {
    for (const [child, m] of [["santiago", fill], ["isabel", food]] as const) for (const s of m.steps) {
      const r = resolveObjective(child, s.objective, (s.text?.language ?? "de") as never);
      ok(r.kind === "row" || r.kind === "not-a-skill", `${child} ${s.id} ${s.objective}`);
    }
  });
});

describe("the map after each visit", () => {
  const input = (child: "santiago" | "isabel", visits: { id: string; finishedAt: string | null }[], current: string | null, choices: Record<string, string> = {}, story?: { turtleName?: { value: string } }) => ({ child, visits, choices, current: current ? { visit: current, mission: "M", places: [], start: null } : null, seen: [], story });
  const piece = (w: ReturnType<typeof deriveHomeWorld>, id: string) => w.pieces.find((p) => p.id === id);
  const done = (id: string) => ({ id, finishedAt: "2026-11-20T12:00:00Z" });
  it("Santiago: during Visit 11 the pond is dug and Flip in the crate; after it, water in the pond, the crate gone, the pump there", () => {
    const during = deriveHomeWorld(input("santiago", [done("v11"), { id: "v12", finishedAt: null }], "v12", {}, { turtleName: { value: "Flip" } }));
    equal(piece(during, "s-pond")?.asset, "s-pond-dug-built");
    equal(piece(during, "s-turtle-crate")?.label, "Flip");
    equal(piece(during, "s-pump"), undefined, "no pump site: it arrives finished");
    const after = deriveHomeWorld(input("santiago", [done("v11"), done("v12")], null, {}, { turtleName: { value: "Flip" } }));
    equal(piece(after, "s-pond")?.asset, "s-pond-water-built");
    equal(piece(after, "s-pond")?.label, "Teich · Flip");
    equal(piece(after, "s-turtle-crate"), undefined);
    equal(piece(after, "s-pump")?.asset, "s-pump-built");
  });
  it("Isabel: from the start of Visit 5 the robins sit on the birdhouse in her roof color; the feeder shows her food", () => {
    for (const roof of ["red", "blue", "yellow"]) {
      const w = deriveHomeWorld(input("isabel", [done("v5"), { id: "v6", finishedAt: null }], "v6", { "IV10-ROOF": roof }));
      equal(piece(w, "i-birdhouse")?.asset, `i-birdhouse-${roof}-birds-built`);
      deepEqual(w.effects, [], "they sit, so they no longer circle");
      equal(piece(w, "i-feeder")?.asset, "i-feeder-site");
    }
    equal(deriveHomeWorld(input("isabel", [done("v5")], "v6", { "IV10-ROOF": "blue" })).effects.length, 1, "before she starts, they still circle");
    for (const f of ["seeds", "berries", "worms"]) equal(piece(deriveHomeWorld(input("isabel", [done("v5"), done("v6")], null, { "IV10-ROOF": "blue", "IF8-FOOD": f })), "i-feeder")?.asset, `i-feeder-${f}-built`);
  });
  it("every file the new stages can ask for is in the manifest, and no new piece sits on a path", () => {
    const have = new Set(ASSETS.map((a) => a.id));
    for (const id of ["s-pond-water-built", "s-pump-built", "i-feeder-site", ...["red", "blue", "yellow"].map((c) => `i-birdhouse-${c}-birds-built`), ...["seeds", "berries", "worms"].map((f) => `i-feeder-${f}-built`)]) ok(have.has(id), id);
    for (const [child, id] of [["santiago", "s-pump"], ["isabel", "i-feeder"]] as const) {
      const p = WORLDS[child].pieces.find((x) => x.id === id)!;
      ok(!WORLDS[child].paths.some((t) => t.c === p.tile.c && t.r === p.tile.r), id);
    }
  });
});

