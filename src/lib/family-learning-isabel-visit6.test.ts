// Nov 21: Isabel Visit 6 «Das Küken schlüpft» (content v6, visit v7, mission MISSION-IDA-CHICK). Every number is the draft's
// (isabel-visit6-2026-11-21/VISIT-6-DRAFT.md); the test recomputes each answer from what she sees and hears. Synthetic and
// offline: no child data, no provider, no network.

import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { asIsabelContent, ISABEL_CONTENT_VERSIONS, reconcileIsabelContent } from "./family-learning-isabel.ts";
import { deriveHomeWorld, WORLDS } from "./family-home-map.ts";
import { ASSETS } from "./family-home-map-assets.ts";
import { BIRD_FOODS, buildMissionView, sanitizeStoryName, stepStatuses, storyPicture, type MissionAction } from "./family-learning-mission.ts";
import { COUNTER_ICONS, WORKSHOP_PICTURES } from "./family-learning-mission-spec.ts";
import { catalogKey, missionNarration, narrationCatalog, type NarrationLine } from "./family-learning-narration.ts";
import { resolveObjective } from "./family-learning-skill-map.ts";
import { applyLearningOp, EMPTY_PARENT_SETTINGS, newMissionState, nextVisitAvailability, type LearningOp, type MissionState, type OpEnv, type ParentSettings } from "./family-learning-state.ts";
import { cleanStoryNameInput } from "./family-learning-story-name.ts";
import { visitLabel } from "./family-learning-summary.ts";
import { sanitizeTelemetryEvent } from "./family-learning-telemetry-schema.ts";

const rd = (n: string) => JSON.parse(readFileSync(new URL(`../data/family-learning/content/${n}`, import.meta.url), "utf8"));
const i5 = asIsabelContent(rd("isabel-workshop-v5.json"));
const i6 = asIsabelContent(rd("isabel-workshop-v6.json"));
const chick = i6.missions!.find((m) => m.visit === "v7")!;
type M = typeof chick;
const st = (m: M, id: string) => m.steps.find((s) => s.id === id)!;
const part = (id: string) => st(chick, id).solve!.parts[0];
const finishedV = (ids: string[]) => ids.map((id, n) => ({ id: id as never, startedAt: `2026-11-${String(n + 1).padStart(2, "0")}T10:00:00.000Z`, finishedAt: `2026-11-${String(n + 1).padStart(2, "0")}T11:00:00.000Z`, stageIndex: 99, skippedStages: [], reflection: "right" }));

describe("versions: content v6 = v5 + visit v7; earlier visits byte-identical", () => {
  it("v5's visits and missions are unchanged; the check passes", () => {
    ok(ISABEL_CONTENT_VERSIONS.includes(6));
    const a = rd("isabel-workshop-v5.json");
    const b = rd("isabel-workshop-v6.json");
    deepEqual(b.missions.slice(0, a.missions.length), a.missions);
    deepEqual(b.visits.slice(0, a.visits.length), a.visits);
    for (const k of ["reflection", "retention", "math", "language", "typing", "theme", "locations", "visitBudgetMinutes", "anchorLanguage"]) deepEqual(b[k], a[k], k);
    deepEqual(reconcileIsabelContent(b).problems, []);
    deepEqual(reconcileIsabelContent(a).problems, [], "v5 still passes under the extended check");
  });
  it("after Visit 5 she is offered v7 («Besuch 6»); under her cap (v5) nothing further", () => {
    const i = newMissionState(i6, "isabel", "2026-10-28T16:00:00.000Z");
    i.visits = finishedV(["v1", "v2", "v4", "v5", "v6"]);
    equal(nextVisitAvailability(i, i6, new Date()).visit, "v7");
    equal(nextVisitAvailability(i, i5, new Date()).visit, null);
    ok(/Besuch 6/.test(visitLabel(i, i6, "v7")), visitLabel(i, i6, "v7"));
  });
  it("telemetry knows the new step ids", () => {
    for (const id of chick.steps.map((s) => s.id)) ok(sanitizeTelemetryEvent({ t: 1, kind: "stage-enter", stage: "mission", step: id }), id);
  });
  it("every picture and counter icon is known", () => {
    for (const s of chick.steps) {
      for (const q of s.questions ?? []) for (const p of Object.values(q.pictures ?? {})) ok((WORKSHOP_PICTURES as readonly string[]).includes(p), p);
      for (const p of s.solve?.parts ?? []) ok(!p.counters?.icon || (COUNTER_ICONS as readonly string[]).includes(p.counters.icon), p.id);
    }
  });
});

describe("content first: the robin facts are true and the math uses them", () => {
  it("five eggs; two weeks of 7 days = 14 (the incubation); 14 − 9 = 5", () => {
    ok(/fünf Eier/.test(st(chick, "I61-PSST").intro[0].text));
    equal(part("I65-DAYS").answer, 7 + 7);
    equal(part("I65-DAYS").counters!.a + part("I65-DAYS").counters!.b, 14);
    equal(part("I65E-DAYS-EASY").answer, 14);
    equal(part("I65H-DAYS-LEFT").answer, 14 - 9);
    equal(part("I65H-DAYS-LEFT").counters!.frame, 14);
    ok(/14 Tage später/.test(st(chick, "I67-KNACK").intro[0].text), "the hatch comes after the 14 days");
  });
  it("doubling caterpillars: 6 + 6, 3 + 3, 8 + 8", () => {
    deepEqual(["I66-FOOD", "I66E-FOOD-EASY", "I66H-FOOD-HARD"].map((id) => part(id).answer), [12, 6, 16]);
    for (const id of ["I66-FOOD", "I66E-FOOD-EASY", "I66H-FOOD-HARD"]) equal(part(id).counters!.a, part(id).counters!.b, id);
  });
  it("about 10 flights an hour: 3 h → 30, 2 h → 20, 5 h → 50, drawn as rows of ten", () => {
    ok(/etwa 10 Mal in einer Stunde/.test(st(chick, "I611-FLIGHTS").intro[0].text));
    for (const [id, h] of [["I611-FLIGHTS", 3], ["I611E-FLIGHTS-EASY", 2], ["I611H-FLIGHTS-MORE", 5]] as const) {
      equal(part(id).answer, 10 * h, id);
      ok(part(id).question.includes(`${h} Stunden`), id);
      equal(part(id).counters!.layout, "rows");
    }
  });
  it("the number flip by ear: the spoken word is the stimulus, two written choices, the picture only after a miss", () => {
    for (const [id, word, n, flipped] of [["I62-FLIP", "Zweiundvierzig", 42, 24], ["I62E-FLIP-EASY", "Zwölf", 12, 21], ["I62H-FLIP-HARD", "Fünfunddreissig", 35, 53]] as const) {
      const p = part(id);
      ok(p.question.startsWith(`${word} Federn.`), id);
      equal(p.answer, n);
      deepEqual([...p.choices!].sort(), [n, flipped].sort());
      ok(p.countersAfterMiss && p.counters!.a + p.counters!.b === n, id);
      ok(!p.question.includes(String(n)) && !p.recheck.includes(String(n)), `${id}: the digits are never said before the answer`);
    }
  });
  it("the facts reach her through what she reads and hears, then she answers about them", () => {
    equal(st(chick, "I63-EGGS").text!.body, "DAS EI HAT PUNKTE.");
    equal(st(chick, "I63-EGGS").questions![0].pictures![st(chick, "I63-EGGS").questions![0].answer], "egg-dots");
    equal(st(chick, "I64-MAMA").text!.body, "Nur die Mama sitzt auf den Eiern und hält sie warm. Der Papa bringt ihr Futter.");
    equal(st(chick, "I64-MAMA").questions![0].answer, "Mama");
    ok(/Küken können noch keine Körner fressen\. Sie brauchen weiche Insekten und Raupen\./.test(st(chick, "I610-FEED").intro[0].text));
    deepEqual(st(chick, "I610-FEED").decide!.options.filter((o) => o.viable).map((o) => o.id), ["caterpillars"]);
    ok(/Vögel trinken und baden\. Das Wasser muss jeden Tag frisch sein, auch im Winter\./.test(st(chick, "I612-WATER").intro[0].text));
    equal(st(chick, "I612-WATER").text!.body, "Stell die flache Schale unter den Busch, nicht ins Gras.");
    equal(st(chick, "I613-BOOK").text!.body, "TAG 1: NACKT UND BLIND.");
    equal(st(chick, "I613-BOOK").questions![0].pictures!.Nackt, "chick-naked");
  });
  it("the check refuses blue robin eggs, a stated season and a placeholder in any content line", () => {
    const bad = (mut: (m: M) => void) => {
      const raw = rd("isabel-workshop-v6.json");
      mut(raw.missions.find((m: M) => m.visit === "v7"));
      return reconcileIsabelContent(raw).problems.join(" | ");
    };
    ok(/never blue/.test(bad((m) => { st(m, "I63-EGGS").done[0].text = "Die Eier sind blau."; })));
    ok(/no season/.test(bad((m) => { st(m, "I67-KNACK").done[0].text = "Im Frühling schlüpfen sie."; })));
    ok(/placeholder/.test(bad((m) => { st(m, "I610-FEED").decide!.options[0].feedback = "{chick} frisst."; })));
    ok(/name step/.test(bad((m) => { st(m, "I69-NAME").decide!.name!.max = 20; })));
    ok(/care decision/.test(bad((m) => { st(m, "I610-FEED").decide!.options[1].viable = true; })));
    ok(/home task/.test(bad((m) => { (st(m, "I614-END") as { home?: unknown }).home = { text: "Stell Wasser hin.", parentNote: "x" }; })));
  });
  it("the sentences are short, read word by word after a miss, never said before she reads", () => {
    for (const id of ["I63-EGGS", "I613-BOOK"]) {
      const s = st(chick, id);
      ok(s.text!.body.length <= 24 && s.letters!.letters.length === s.text!.body.split(" ").length, id);
      ok(s.letters!.afterMiss, id);
      for (const l of s.intro) ok(!l.text.toUpperCase().includes(s.text!.body.replace(/[.:]/g, "").split(" ").slice(-1)[0]), `${id}: «${l.text}»`);
    }
  });
});

describe("walks through Visit 6 (synthetic)", () => {
  type Env = OpEnv & { settings: ParentSettings };
  const mkEnv = (): Env => { let t = Date.UTC(2026, 10, 21, 14, 0, 0); let n = 0; return { content: i6, settings: { ...EMPTY_PARENT_SETTINGS }, now: () => new Date((t += 10_000)), newId: () => `id-${(n += 1)}`, tutorAvailable: false }; };
  const start = () => {
    let s = newMissionState(i6, "isabel", "2026-10-28T16:00:00.000Z");
    s.visits = finishedV(["v1", "v2", "v4", "v5", "v6"]);
    s.story = { roofColor: { value: "Blau", optionId: "blue", kind: "preset", visit: "v5", at: "2026-11-15T10:00:00.000Z" }, birdFood: { value: "Würmer", optionId: "worms", kind: "preset", visit: "v6", at: "2026-11-21T10:40:00.000Z" } };
    return s;
  };
  const runner = () => {
    const env = mkEnv();
    const samples: unknown[] = [];
    const op = (s: MissionState, o: LearningOp) => { const r = applyLearningOp(s, o, env); samples.push(...((r as { records?: { samples?: unknown[] } }).records?.samples ?? [])); return r.state; };
    const m = (s: MissionState, action: MissionAction) => op(s, { op: "mission", action });
    return { op, m, samples };
  };
  const listen = (m: ReturnType<typeof runner>["m"], id: string) => (x: MissionState) => m(m(x, { a: "support", step: id, kind: "play" }), { a: "listen-outcome", step: id, outcome: "recorded" });

  it("right first time: the harder versions open, the easier ones are not needed; her name and her care choice are stored", () => {
    const { op, m, samples } = runner();
    let s = op(start(), { op: "start-visit" });
    const done = (id: string, act: (x: MissionState) => MissionState) => { s = m(s, { a: "open", step: id }); s = act(s); s = m(s, { a: "leave" }); };
    done("I61-PSST", (x) => m(x, { a: "story-done", step: "I61-PSST" }));
    done("I62-FLIP", (x) => m(x, { a: "answer-part", step: "I62-FLIP", part: "flip", value: "42" }));
    let status = stepStatuses(chick, s.missions![chick.id]);
    equal(status["I62E-FLIP-EASY"], "not-needed");
    equal(status["I62H-FLIP-HARD"], "available");
    done("I62H-FLIP-HARD", (x) => m(x, { a: "answer-part", step: "I62H-FLIP-HARD", part: "flip", value: "35" }));
    done("I63-EGGS", (x) => m(x, { a: "answer-question", step: "I63-EGGS", question: "word", value: "Punkte" }));
    done("I64-MAMA", (x) => m(listen(m, "I64-MAMA")(x), { a: "answer-question", step: "I64-MAMA", question: "show", value: "Mama" }));
    done("I65-DAYS", (x) => m(x, { a: "answer-part", step: "I65-DAYS", part: "days", value: "14" }));
    done("I65H-DAYS-LEFT", (x) => m(x, { a: "answer-part", step: "I65H-DAYS-LEFT", part: "left", value: "5" }));
    done("I66-FOOD", (x) => m(x, { a: "answer-part", step: "I66-FOOD", part: "food", value: "12" }));
    done("I66H-FOOD-HARD", (x) => m(x, { a: "answer-part", step: "I66H-FOOD-HARD", part: "food", value: "16" }));
    done("I67-KNACK", (x) => m(x, { a: "story-done", step: "I67-KNACK" }));
    done("I68-KUEKEN", (x) => m(x, { a: "answer-question", step: "I68-KUEKEN", question: "word", value: "Küken" }));
    done("I69-NAME", (x) => m(x, { a: "decide", step: "I69-NAME", option: "own", name: "Pip" }));
    done("I610-FEED", (x) => m(x, { a: "decide", step: "I610-FEED", option: "caterpillars" }));
    done("I611-FLIGHTS", (x) => m(x, { a: "answer-part", step: "I611-FLIGHTS", part: "flights", value: "30" }));
    done("I611H-FLIGHTS-MORE", (x) => m(x, { a: "answer-part", step: "I611H-FLIGHTS-MORE", part: "flights", value: "50" }));
    done("I612-WATER", (x) => m(listen(m, "I612-WATER")(x), { a: "answer-question", step: "I612-WATER", question: "show", value: "Flach, unter dem Busch" }));
    done("I613-BOOK", (x) => m(x, { a: "answer-question", step: "I613-BOOK", question: "word", value: "Nackt" }));
    s = m(s, { a: "open", step: "I614-END" });
    status = stepStatuses(chick, s.missions![chick.id]);
    for (const id of ["I61-PSST", "I62-FLIP", "I62H-FLIP-HARD", "I63-EGGS", "I64-MAMA", "I65-DAYS", "I65H-DAYS-LEFT", "I66-FOOD", "I66H-FOOD-HARD", "I67-KNACK", "I68-KUEKEN", "I69-NAME", "I610-FEED", "I611-FLIGHTS", "I611H-FLIGHTS-MORE", "I612-WATER", "I613-BOOK"]) equal(status[id], "done", id);
    for (const id of ["I62E-FLIP-EASY", "I65E-DAYS-EASY", "I66E-FOOD-EASY", "I611E-FLIGHTS-EASY"]) equal(status[id], "not-needed", id);
    equal(s.story?.chickName?.value, "Pip");
    equal(s.story?.chickName?.kind, "own");
    equal(s.missions![chick.id].steps["I610-FEED"].outcome, "independent");
    // Her chick's name is her own writing: one sample, verbatim, never scored.
    const named = samples.filter((x) => (x as { kind?: string }).kind === "story_name") as { text: string; metrics: { scored: boolean } }[];
    equal(named.length, 1);
    equal(named[0].text, "Pip");
    equal(named[0].metrics.scored, false);
    // The end: her roof (blue) × her Visit 5 food (worms), the chicks; her chick's name as text; no spoken line carries it.
    const view = buildMissionView(s, i6, "v7")!;
    equal(view.active?.picture?.id, "chicks-blue-worms");
    equal(view.active?.storyName, "Pip");
    equal(view.active?.recap, "Dein Küken frisst weiche Raupen.");
    for (const l of missionNarration(view)?.lines ?? []) ok(!l.text.includes("Pip"), l.text);
  });

  it("wrong first: the easier versions follow; a wrong food turns the chick away, its reason is said, the second pick counts as with help", () => {
    const { op, m } = runner();
    let s = op(start(), { op: "start-visit" });
    const done = (id: string, act: (x: MissionState) => MissionState) => { s = m(s, { a: "open", step: id }); s = act(s); s = m(s, { a: "leave" }); };
    done("I61-PSST", (x) => m(x, { a: "story-done", step: "I61-PSST" }));
    s = m(s, { a: "open", step: "I62-FLIP" });
    equal(buildMissionView(s, i6, "v7")!.active!.solve!.parts[0].counters, undefined, "no picture before her first answer: the word is the task");
    deepEqual(buildMissionView(s, i6, "v7")!.active!.solve!.parts[0].choices, [24, 42]);
    s = m(s, { a: "answer-part", step: "I62-FLIP", part: "flip", value: "24" });
    ok(buildMissionView(s, i6, "v7")!.active!.solve!.parts[0].counters, "the bags appear after the miss");
    s = m(s, { a: "answer-part", step: "I62-FLIP", part: "flip", value: "42" });
    s = m(s, { a: "leave" });
    let status = stepStatuses(chick, s.missions![chick.id]);
    equal(status["I62E-FLIP-EASY"], "available");
    equal(status["I62H-FLIP-HARD"], "not-needed");
    done("I62E-FLIP-EASY", (x) => m(x, { a: "answer-part", step: "I62E-FLIP-EASY", part: "flip", value: "12" }));
    done("I63-EGGS", (x) => m(m(x, { a: "answer-question", step: "I63-EGGS", question: "word", value: "Blau" }), { a: "answer-question", step: "I63-EGGS", question: "word", value: "Punkte" }));
    done("I64-MAMA", (x) => m(m(listen(m, "I64-MAMA")(x), { a: "answer-question", step: "I64-MAMA", question: "show", value: "Beide" }), { a: "answer-question", step: "I64-MAMA", question: "show", value: "Mama" }));
    done("I65-DAYS", (x) => m(m(x, { a: "answer-part", step: "I65-DAYS", part: "days", value: "12" }), { a: "answer-part", step: "I65-DAYS", part: "days", value: "14" }));
    status = stepStatuses(chick, s.missions![chick.id]);
    equal(status["I65E-DAYS-EASY"], "available");
    done("I65E-DAYS-EASY", (x) => m(x, { a: "answer-part", step: "I65E-DAYS-EASY", part: "days", value: "14" }));
    done("I66-FOOD", (x) => m(m(x, { a: "answer-part", step: "I66-FOOD", part: "food", value: "11" }), { a: "answer-part", step: "I66-FOOD", part: "food", value: "12" }));
    done("I66E-FOOD-EASY", (x) => m(x, { a: "answer-part", step: "I66E-FOOD-EASY", part: "food", value: "6" }));
    done("I67-KNACK", (x) => m(x, { a: "story-done", step: "I67-KNACK" }));
    done("I68-KUEKEN", (x) => m(m(x, { a: "answer-question", step: "I68-KUEKEN", question: "word", value: "Kuchen" }), { a: "answer-question", step: "I68-KUEKEN", question: "word", value: "Küken" }));
    s = m(s, { a: "open", step: "I69-NAME" });
    throws(() => m(s, { a: "decide", step: "I69-NAME", option: "own", name: "Pip3" }), "no digits");
    throws(() => m(s, { a: "decide", step: "I69-NAME", option: "own", name: "Abcdefghijklm" }), "at most 12 letters");
    s = m(s, { a: "decide", step: "I69-NAME", option: "own", name: "lulu" });
    s = m(s, { a: "leave" });
    equal(s.story?.chickName?.value, "Lulu", "shown with a capital first letter; her typed text stays in the sample");
    s = m(s, { a: "open", step: "I610-FEED" });
    s = m(s, { a: "decide", step: "I610-FEED", option: "bread" });
    const turned = buildMissionView(s, i6, "v7")!;
    equal(turned.active!.status, "active", "she picks again");
    deepEqual(missionNarration(turned)!.lines.map((l) => l.text), ["Dein Küken dreht den Kopf weg. Brot macht Vögel krank."]);
    s = m(s, { a: "decide", step: "I610-FEED", option: "caterpillars" });
    equal(s.missions![chick.id].steps["I610-FEED"].outcome, "supported", "recorded as with help");
    deepEqual(missionNarration(buildMissionView(s, i6, "v7")!)!.lines.map((l) => l.text), ["Mmh! Dein Küken frisst die Raupen.", "So wird dein Küken gross und stark."]);
    s = m(s, { a: "leave" });
    done("I611-FLIGHTS", (x) => m(m(x, { a: "answer-part", step: "I611-FLIGHTS", part: "flights", value: "3" }), { a: "answer-part", step: "I611-FLIGHTS", part: "flights", value: "30" }));
    done("I611E-FLIGHTS-EASY", (x) => m(x, { a: "answer-part", step: "I611E-FLIGHTS-EASY", part: "flights", value: "20" }));
    done("I612-WATER", (x) => m(m(listen(m, "I612-WATER")(x), { a: "answer-question", step: "I612-WATER", question: "show", value: "Tief, im Gras" }), { a: "answer-question", step: "I612-WATER", question: "show", value: "Flach, unter dem Busch" }));
    s = m(s, { a: "open", step: "I613-BOOK" });
    equal(buildMissionView(s, i6, "v7")!.active!.storyName, "Lulu", "the book page shows her chick's name as text");
    s = m(s, { a: "answer-question", step: "I613-BOOK", question: "word", value: "Flaumig" });
    s = m(s, { a: "support", step: "I613-BOOK", kind: "letters" });
    deepEqual(buildMissionView(s, i6, "v7")!.active!.letters!.shown!.letters.map((l) => l.letter), ["TAG", "1:", "NACKT", "UND", "BLIND."]);
    s = m(s, { a: "answer-question", step: "I613-BOOK", question: "word", value: "Nackt" });
    s = m(s, { a: "leave" });
    s = m(s, { a: "open", step: "I614-END" });
    const status2 = stepStatuses(chick, s.missions![chick.id]);
    for (const id of ["I62H-FLIP-HARD", "I65H-DAYS-LEFT", "I66H-FOOD-HARD", "I611H-FLIGHTS-MORE"]) equal(status2[id], "not-needed", id);
    const end = buildMissionView(s, i6, "v7")!;
    equal(end.active!.picture!.id, "chicks-blue-worms");
    for (const l of missionNarration(end)?.lines ?? []) ok(!/Lulu|lulu/.test(l.text), l.text);
  });
});

describe("her chick's name: letters only, at most 12, never spoken", () => {
  it("the field keeps letters only and at most 12; the server takes 2 to 12 letters", () => {
    equal(cleanStoryNameInput("Pi p!3"), "Pip");
    equal(cleanStoryNameInput("Zwölfbuchstabenlang"), "Zwölfbuchsta");
    equal(cleanStoryNameInput("Zwölfbuchstabenlang").length, 12);
    equal(cleanStoryNameInput("Émile-Ünal"), "ÉmileÜnal");
    equal(sanitizeStoryName("Pip"), "Pip");
    equal(sanitizeStoryName("P"), null);
    equal(sanitizeStoryName("Pip3"), null);
    equal(sanitizeStoryName("a".repeat(13)), null);
  });
  it("no recorded line carries a placeholder or a name", () => {
    for (const l of narrationCatalog(i6)) ok(!/[{}]|\bchick\b|Isabel|Santiago|ß/.test(l.text), l.text);
  });
});

describe("recordings: released lines unchanged; the new ones in Ida's voice", () => {
  const keys = (l: NarrationLine[]) => new Map(l.map((x) => [catalogKey(x), x.text]));
  it("every line of v5 keeps its id and text in v6", () => {
    const after = keys(narrationCatalog(i6));
    for (const [k, t] of keys(narrationCatalog(i5))) equal(after.get(k), t, k);
  });
  it("the new lines are all de-female (Ida), and none of them is long", () => {
    const old = new Set(narrationCatalog(i5).map(catalogKey));
    const added = narrationCatalog(i6).filter((l) => !old.has(catalogKey(l)));
    ok(added.length > 50 && added.length < 160, String(added.length));
    for (const l of added) {
      equal(l.slot, "de-female", l.text);
      ok(l.text.length <= 110, l.text);
    }
  });
  it("every objective of the visit sits on a ladder row or is named as not a skill", () => {
    for (const s of chick.steps) {
      const r = resolveObjective("isabel", s.objective, "de");
      ok(r.kind === "row" || r.kind === "not-a-skill", `${s.id} ${s.objective}`);
    }
    equal(resolveObjective("isabel", "robin-facts-chick-food", "de").kind, "not-a-skill");
  });
});

describe("the map and the end picture", () => {
  const input = (visits: { id: string; finishedAt: string | null }[], current: string | null, choices: Record<string, string>, story?: { chickName?: { value: string } }) => ({ child: "isabel" as const, visits, choices, current: current ? { visit: current, mission: "M", places: [], start: null } : null, seen: [], story });
  const piece = (w: ReturnType<typeof deriveHomeWorld>, id: string) => w.pieces.find((p) => p.id === id);
  const done = (id: string) => ({ id, finishedAt: "2026-11-21T12:00:00Z" });
  it("during Visit 6 the robins still sit on the house; after it the chicks peek out in her roof colour, the label names her chick, the water bowl stands", () => {
    for (const roof of ["red", "blue", "yellow"]) {
      const during = deriveHomeWorld(input([done("v5"), done("v6"), { id: "v7", finishedAt: null }], "v7", { "IV10-ROOF": roof, "IF8-FOOD": "worms" }));
      equal(piece(during, "i-birdhouse")?.asset, `i-birdhouse-tree-${roof}-birds-built`);
      equal(piece(during, "i-water-bowl"), undefined, "no site: it arrives finished");
      const after = deriveHomeWorld(input([done("v5"), done("v6"), done("v7")], null, { "IV10-ROOF": roof, "IF8-FOOD": "worms" }, { chickName: { value: "Pip" } }));
      equal(piece(after, "i-birdhouse")?.asset, `i-birdhouse-tree-${roof}-chicks-built`);
      equal(piece(after, "i-birdhouse")?.label, "Vogelhaus · Pip");
      equal(piece(after, "i-water-bowl")?.asset, "i-water-bowl-built");
      equal(piece(after, "i-feeder")?.asset, "i-feeder-worms-built");
    }
    const p = WORLDS.isabel.pieces.find((x) => x.id === "i-water-bowl")!;
    ok(!WORLDS.isabel.paths.some((t) => t.c === p.tile.c && t.r === p.tile.r), "not on a path");
    const have = new Set(ASSETS.map((a) => a.id));
    for (const id of ["i-water-bowl-built", ...["red", "blue", "yellow"].map((c) => `i-birdhouse-tree-${c}-chicks-built`)]) {
      ok(have.has(id), id);
      ok(existsSync(new URL(`../../public/family/home-map/${id}.png`, import.meta.url)), id);
    }
  });
  it("the end picture is her roof × her Visit 5 food with the chicks; fallbacks red / seeds; every file exists and is wired", () => {
    for (const roof of ["red", "blue", "yellow"]) for (const f of BIRD_FOODS) {
      equal(storyPicture("food-caterpillars", { roofColor: { optionId: roof }, birdFood: { optionId: f } }), `chicks-${roof}-${f}`);
      ok(existsSync(new URL(`../assets/family-learning/cozy/chicks-${roof}-${f}.webp`, import.meta.url)), `${roof}-${f}`);
    }
    equal(storyPicture("food-caterpillars", {}), "chicks-red-seeds");
    equal(storyPicture("food-worms", { roofColor: { optionId: "blue" } }), "birds-blue-worms", "Visit 5 unchanged");
    const src = readFileSync(new URL("../components/family/learning/workshop-pictures.tsx", import.meta.url), "utf8");
    for (const roof of ["red", "blue", "yellow"]) for (const f of BIRD_FOODS) ok(src.includes(`"chicks-${roof}-${f}": cozy`), `${roof}-${f} wired`);
    for (const id of ["eggs-five", "egg-dots", "egg-blue", "egg-white", "mama-on-eggs", "papa-on-eggs", "both-on-eggs", "chicks-hatch", "chick-naked", "chick-fluffy", "chick-redbreast", "food-caterpillars", "food-bread", "cake", "box", "water-flat-bush", "water-deep-bush", "water-flat-grass", "water-deep-grass", "next-eyes", "next-feathers", "next-fly"]) {
      ok(existsSync(new URL(`../assets/family-learning/cozy/${id}.webp`, import.meta.url)), id);
      ok(src.includes(`"${id}": cozy`), `${id} wired`);
    }
  });
});
