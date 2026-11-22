// Nov 22: Isabel Visit 7 «Wann kann Isa sehen?» (content v7, visit v8, mission MISSION-IDA-CHICK-EYES). Every number and fact is the
// draft's (isabel-visit7-2026-11-22/VISIT-7-DRAFT.md); the test recomputes each answer from what she sees and hears. Also the two
// app-wide fixes from David's feedback: answers locked while a feedback line plays, and a fact said once per visit.
// Synthetic and offline: no child data, no provider, no network.

import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { asIsabelContent, coreWords, ISABEL_CONTENT_VERSIONS, reconcileIsabelContent, repeatedFacts, spokenUnits } from "./family-learning-isabel.ts";
import { deriveHomeWorld } from "./family-home-map.ts";
import { ASSETS } from "./family-home-map-assets.ts";
import { buildMissionView, canonicalAnswer, checkedAnswer, retentionClass, stepStatuses, storyPicture, type MissionAction } from "./family-learning-mission.ts";
import { COUNTER_ICONS, WORKSHOP_PICTURES, type MissionQuestion } from "./family-learning-mission-spec.ts";
import { catalogKey, feedbackLock, missionNarration, narrationCatalog, type NarrationLine } from "./family-learning-narration.ts";
import { createNarrationPlayer } from "./family-narration-player.ts";
import { resolveObjective } from "./family-learning-skill-map.ts";
import { applyLearningOp, buildChildView, EMPTY_PARENT_SETTINGS, newMissionState, nextVisitAvailability, type LearningOp, type MissionState, type OpEnv, type ParentSettings } from "./family-learning-state.ts";
import { visitLabel } from "./family-learning-summary.ts";
import { sanitizeTelemetryEvent } from "./family-learning-telemetry-schema.ts";

const rd = (n: string) => JSON.parse(readFileSync(new URL(`../data/family-learning/content/${n}`, import.meta.url), "utf8"));
const i6 = asIsabelContent(rd("isabel-workshop-v6.json"));
const i7 = asIsabelContent(rd("isabel-workshop-v7.json"));
const eyes = i7.missions!.find((m) => m.visit === "v8")!;
type M = typeof eyes;
const st = (m: M, id: string) => m.steps.find((s) => s.id === id)!;
const part = (id: string, n = 0) => st(eyes, id).solve!.parts[n];
const finishedV = (ids: string[]) => ids.map((id, n) => ({ id: id as never, startedAt: `2026-11-${String(n + 1).padStart(2, "0")}T10:00:00.000Z`, finishedAt: `2026-11-${String(n + 1).padStart(2, "0")}T11:00:00.000Z`, stageIndex: 99, skippedStages: [], reflection: "right" }));
const bad = (mut: (m: M) => void) => {
  const raw = rd("isabel-workshop-v7.json");
  mut(raw.missions.find((m: M) => m.visit === "v8"));
  return reconcileIsabelContent(raw).problems.join(" | ");
};

describe("versions: content v7 = v6 + visit v8; earlier visits byte-identical", () => {
  it("v6's visits and missions are unchanged; the check passes for v7 and still for v6", () => {
    ok(ISABEL_CONTENT_VERSIONS.includes(7));
    const a = rd("isabel-workshop-v6.json");
    const b = rd("isabel-workshop-v7.json");
    deepEqual(b.missions.slice(0, a.missions.length), a.missions);
    deepEqual(b.visits.slice(0, a.visits.length), a.visits);
    for (const k of ["reflection", "retention", "math", "language", "typing", "theme", "locations", "visitBudgetMinutes", "anchorLanguage"]) deepEqual(b[k], a[k], k);
    deepEqual(reconcileIsabelContent(b).problems, []);
    deepEqual(reconcileIsabelContent(a).problems, [], "v6 still passes under the extended check");
    equal(b.missions.length, a.missions.length + 1);
  });
  it("after Visit 6 she is offered v8 («Besuch 7»); under the cap (content 6) nothing further", () => {
    const i = newMissionState(i7, "isabel", "2026-10-28T16:00:00.000Z");
    i.visits = finishedV(["v1", "v2", "v4", "v5", "v6", "v7"]);
    equal(nextVisitAvailability(i, i7, new Date()).visit, "v8");
    equal(nextVisitAvailability(i, i6, new Date()).visit, null);
    ok(/Besuch 7/.test(visitLabel(i, i7, "v8")), visitLabel(i, i7, "v8"));
  });
  it("the hub's title names her chick from her record (text only); before a name: «dein Küken»", () => {
    const i = newMissionState(i7, "isabel", "2026-10-28T16:00:00.000Z");
    i.visits = finishedV(["v1", "v2", "v4", "v5", "v6", "v7"]);
    equal(buildChildView(i, i7, { ...EMPTY_PARENT_SETTINGS }, new Date()).visitText?.title, "Wann kann dein Küken sehen?");
    i.story = { chickName: { value: "Isa", optionId: "own", kind: "own", visit: "v7", at: "2026-11-22T12:58:00.000Z" } };
    equal(buildChildView(i, i7, { ...EMPTY_PARENT_SETTINGS }, new Date()).visitText?.title, "Wann kann Isa sehen?");
  });
  it("telemetry knows the new step ids", () => {
    for (const id of eyes.steps.map((s) => s.id)) ok(sanitizeTelemetryEvent({ t: 1, kind: "stage-enter", stage: "mission", step: id }), id);
  });
  it("every picture and counter icon is known, painted ones exist as files and are wired", () => {
    const src = readFileSync(new URL("../components/family/learning/workshop-pictures.tsx", import.meta.url), "utf8");
    const used = new Set<string>();
    for (const s of eyes.steps) {
      if (s.picture) used.add(s.picture);
      for (const q of s.questions ?? []) for (const p of [...Object.values(q.pictures ?? {}), ...(q.picture ? [q.picture] : [])]) used.add(p);
      for (const o of s.decide?.options ?? []) if (o.picture) used.add(o.picture);
      if (s.book?.previous) used.add(s.book.previous.picture);
      for (const p of s.solve?.parts ?? []) ok(!p.counters?.icon || (COUNTER_ICONS as readonly string[]).includes(p.counters.icon), p.id);
    }
    for (const o of eyes.closing!.liked!.options) used.add(o.picture);
    for (const c of eyes.nextAdventure!.choices) used.add(c.picture);
    for (const p of used) {
      ok((WORKSHOP_PICTURES as readonly string[]).includes(p), p);
      if (p !== "coin-five") ok(src.includes(`"${p}": cozy`), `${p} wired`);
    }
    for (const id of ["chicks-day4", "hatch-1-hole", "hatch-2-crack", "hatch-3-out", "eizahn", "ice-cream-cone", "tooth", "animal-robin", "animal-turtle", "animal-dog", "animal-baby", "milk-bottle", "chick-eyes-open-beak-open", "chick-eyes-open-beak-closed", "chick-eyes-closed-beak-open", "chick-eyes-closed-beak-closed", "next-bath-chick", "peek-red", "peek-blue", "peek-yellow"]) ok(existsSync(new URL(`../assets/family-learning/cozy/${id}.webp`, import.meta.url)), id);
    ok(src.includes('case "coin-five":'), "the coin is drawn in code");
  });
});

describe("content first: the draft's facts, and the math recomputed from what she sees", () => {
  it("day 4, eyes still closed; two days later it is day 6; 14 − 6 = 8 on a 1–14 strip; easier 10 − 6 = 4", () => {
    ok(/4 Tage alt/.test(st(eyes, "I71-PSST").intro[0].text));
    ok(/Augen sind noch zu/.test(st(eyes, "I71-PSST").intro[1].text));
    ok(/Zwei Tage später … Heute ist Tag 6\./.test(st(eyes, "I79-DAY6").intro[0].text), "4 + 2 = 6");
    ok(/Am Tag 14 verlässt dein Küken das Nest\. Heute ist Tag 6\./.test(st(eyes, "I710-DAYS").intro[0].text));
    for (const [id, today, until] of [["I710-DAYS", 6, 14], ["I710E-DAYS-EASY", 6, 10]] as const) {
      const c = part(id).counters!;
      equal(c.layout, "strip");
      equal(c.a, today, id);
      equal(c.frame, until, id);
      equal(part(id).answer, until - today, id);
      equal(c.frame! - c.a, c.b, id);
    }
  });
  it("the number flip: 63 TAUGHT (6 bags appear, then 3 single ones), then 47 by ear; harder 81; the digits are never said", () => {
    const t = part("I73-FLIP", 0);
    equal(t.answer, 63);
    deepEqual([t.counters!.a, t.counters!.b, t.counters!.appear], [60, 3, true]);
    ok(!t.countersAfterMiss, "the bags are shown while Ida says the number (teaching first)");
    deepEqual(st(eyes, "I73-FLIP").intro.map((l) => l.text), ["Hör gut zu: Dreiundsechzig.", "Zuerst die Zehner, dann die Einer."]);
    for (const [p, word, n, flipped] of [[part("I73-FLIP", 1), "Siebenundvierzig", 47, 74], [part("I73H-FLIP-HARD"), "Einundachtzig", 81, 18]] as const) {
      ok(p.question.startsWith(`${word} Federn.`), word);
      equal(p.answer, n);
      deepEqual([...p.choices!].sort(), [n, flipped].sort());
      ok(p.countersAfterMiss && p.counters!.a + p.counters!.b === n, `${word}: the bags only after a miss (the draft's easier version)`);
      ok(!p.question.includes(String(n)) && !p.recheck.includes(String(n)), `${word}: digits never said before the answer`);
    }
    deepEqual([...part("I73-FLIP", 0).choices!].sort(), [36, 63]);
  });
  it("coins in tens: 5 chicks × 10 = 50, easier 2 × 10 = 20, harder 5 chicks + Mama = 60, drawn as rows of ten coins", () => {
    ok(/so leicht wie ein Fünfräppler/.test(st(eyes, "I78-COINS").intro[0].text));
    ok(/nach 10 Tagen so schwer wie 10 Fünfräppler, fast so schwer wie seine Mama/.test(st(eyes, "I78-COINS").intro[1].text));
    for (const [id, rows] of [["I78-COINS", 5], ["I78E-COINS-EASY", 2], ["I78H-COINS-MAMA", 6]] as const) {
      equal(part(id).answer, 10 * rows, id);
      deepEqual([part(id).counters!.a, part(id).counters!.layout, part(id).counters!.icon], [10 * rows, "rows", "coin"], id);
    }
    ok(/Mama wiegt auch etwa 10 Fünfräppler/.test(st(eyes, "I78H-COINS-MAMA").intro[0].text));
  });
  it("hatching: egg tooth, a hole, turning, all round, hard work; three pictures in order hole → crack → out", () => {
    const h = st(eyes, "I74-HATCH");
    equal(h.text!.body, "Das Küken hat vorne auf dem Schnabel einen kleinen, harten Eizahn. Damit pickt es ein Loch in die Schale. Dann dreht es sich und pickt rundherum, bis die Schale aufbricht. Das ist harte Arbeit und dauert lange.");
    const q = h.questions![0];
    equal(q.kind, "order");
    equal(q.answer, "Loch|Riss|Raus");
    deepEqual(q.answer.split("|").map((o) => q.pictures![o]), ["hatch-1-hole", "hatch-2-crack", "hatch-3-out"]);
    ok(q.options!.join("|") !== q.answer, "shown in another order");
    deepEqual([h.priorKnowledge!.know, h.priorKnowledge!.show], ["Ich weiss es", "Zeig es mir"]);
    ok(/Später verschwindet der Eizahn wieder\. Auch Schildkröten-Babys haben einen\./.test(st(eyes, "I75-EIZAHN").done[0].text));
    equal(st(eyes, "I75-EIZAHN").text!.body, "EIZAHN");
    deepEqual(st(eyes, "I75-EIZAHN").questions![0].pictures, { Eis: "ice-cream-cone", Eizahn: "eizahn", Zahn: "tooth" });
  });
  it("egg or belly; milk or caterpillars; eyes open on day 6; the book's page 2", () => {
    equal(st(eyes, "I76-EGG").text!.body, "Die Mama hat jeden Morgen ein Ei gelegt, bis alle fünf da waren. Vogelbabys wachsen in einem Ei. Menschenbabys wachsen im Bauch der Mama.");
    deepEqual([st(eyes, "I76-EGG").questions![0].kind, st(eyes, "I76-EGG").questions![0].answer], ["multi", "Vogel|Schildkröte"]);
    equal(st(eyes, "I77-MILK").questions![0].answer, "Raupen");
    equal(st(eyes, "I77-MILK").done[0].text, "Vogelbabys trinken nie Milch.");
    equal(st(eyes, "I79-DAY6").questions![0].pictures![st(eyes, "I79-DAY6").questions![0].answer], "chick-eyes-open-beak-open");
    const b = st(eyes, "I712-BOOK");
    equal(b.text!.body, "TAG 6: DIE AUGEN SIND AUF.");
    deepEqual(b.book, { page: 2, previous: { page: 1, text: "TAG 1: NACKT UND BLIND.", picture: "chick-naked" } });
    equal(b.questions![0].pictures![b.questions![0].answer], "chick-eyes-open-beak-closed");
    ok(/Das ist das Buch über dein Küken/.test(b.intro[0].text), "the book is introduced before it is used");
  });
  it("the end, the cliffhanger said once, the closing choices of the draft", () => {
    const end = st(eyes, "I713-END");
    deepEqual(end.done.map((l) => l.text), ["Bald wachsen deinem Küken Federn. Zuerst sehen sie aus wie kleine Röhrchen."]);
    deepEqual(eyes.closing!.liked!.options.map((o) => o.label), ["Ei-Bilder", "Fünfräppler", "Augen"]);
    deepEqual(eyes.nextAdventure!.choices.map((o) => o.label), ["Federn", "Fliegen", "Baden"]);
    equal(eyes.world[0].picture, "peek");
  });
  it("writing AUGE: heard (said in the instruction, never on screen), tiles = its letters + two others", () => {
    const w = st(eyes, "I711-AUGE");
    const q = w.questions![0];
    deepEqual([q.kind, q.answer], ["spell", "AUGE"]);
    ok(!/auge/i.test(w.intro[0].text), "the visible line does not show the word");
    ok(/Auge/.test(w.intro[1].text), "the word is said");
    deepEqual([...q.tiles!].sort(), ["A", "E", "G", "N", "O", "U"]);
    ok(w.listenOptional);
  });
});

describe("the content check (Visit 7)", () => {
  it("refuses blue eggs, a season, a placeholder in a line, her chick's name token in a line", () => {
    ok(/never blue/.test(bad((m) => { st(m, "I76-EGG").text!.body = "Die Eier sind blau."; })));
    ok(/no season/.test(bad((m) => { st(m, "I79-DAY6").intro[0].text = "Im Frühling ist Tag 6."; })));
    ok(/placeholder/.test(bad((m) => { st(m, "I77-MILK").done[0].text = "{chick} trinkt nie Milch."; })));
  });
  it("refuses a restated fact (a fact is said once)", () => {
    ok(/a fact is said once/.test(bad((m) => { st(m, "I77-MILK").done[0].text = "Genau. Vogelbabys wachsen in einem Ei."; })));
    ok(/a fact is said once/.test(bad((m) => { st(m, "I79-DAY6").done = [{ speaker: "ida", text: "Dein Küken verlässt das Nest am Tag 14.", language: "de" }]; })));
    ok(/a fact is said once/.test(bad((m) => { st(m, "I710-DAYS").solve!.parts[0].teach = "Das Küken hat einen kleinen, harten Eizahn auf dem Schnabel."; })));
  });
  it("refuses a broken ordering, an all-options multi, a written word shown on screen, a too-long sentence", () => {
    ok(/ordering/.test(bad((m) => { st(m, "I74-HATCH").questions![0].answer = "Loch|Riss"; })));
    ok(/ordering/.test(bad((m) => { st(m, "I74-HATCH").questions![0].options = ["Loch", "Riss", "Raus"]; })));
    ok(/several answers/.test(bad((m) => { st(m, "I76-EGG").questions![0].answer = "Vogel|Hund|Schildkröte|Baby"; })));
    ok(/visible line never shows the word/.test(bad((m) => { st(m, "I711-AUGE").intro[0].text = "Schreib das Wort Auge."; })));
    ok(/tiles/.test(bad((m) => { st(m, "I711-AUGE").questions![0].tiles = ["A", "U", "G", "E"]; })));
    ok(/at most 28 characters/.test(bad((m) => { st(m, "I712-BOOK").text!.body = "TAG 6: DIE KLEINEN AUGEN SIND AUF."; })));
    ok(/«Ich weiss es»/.test(bad((m) => { (st(m, "I77-MILK") as { priorKnowledge?: unknown }).priorKnowledge = st(m, "I74-HATCH").priorKnowledge; })));
  });
  it("the fact-once rule would have caught Visit 6's Mama/Papa repeats (David, Nov 22) — Visit 6 itself stays as recorded", () => {
    const v6 = rd("isabel-workshop-v6.json").missions.find((m: M) => m.visit === "v7");
    const units = spokenUnits(v6).map((u) => (u.where === "I64-MAMA/text" ? { ...u, fact: true } : u));
    deepEqual([...new Set(repeatedFacts(units).map((p) => p.againWhere))].sort(), ["I64-MAMA/done", "I65-DAYS/done", "I65E-DAYS-EASY/done", "I66-FOOD/intro1"]);
    deepEqual(repeatedFacts(spokenUnits(eyes as never)), [], "Visit 7: no fact said twice");
    deepEqual(coreWords("Der Papa bringt ihr Futter."), ["papa", "bringt", "futter"]);
  });
});

describe("answer rules: ordering, several answers, writing", () => {
  const order = st(eyes, "I74-HATCH").questions![0] as MissionQuestion;
  const multi = st(eyes, "I76-EGG").questions![0] as MissionQuestion;
  const spell = st(eyes, "I711-AUGE").questions![0] as MissionQuestion;
  it("an ordering names every picture once; only the right order is right", () => {
    equal(checkedAnswer(order, "Loch|Riss|Raus"), canonicalAnswer(order));
    ok(checkedAnswer(order, "Riss|Loch|Raus") !== canonicalAnswer(order));
    throws(() => checkedAnswer(order, "Loch|Loch|Raus"));
    throws(() => checkedAnswer(order, "Loch|Riss"));
    throws(() => checkedAnswer(order, "Loch|Riss|Ei"));
  });
  it("several answers: the order of her taps does not matter; all and only the right ones", () => {
    equal(checkedAnswer(multi, "Schildkröte|Vogel"), canonicalAnswer(multi));
    ok(checkedAnswer(multi, "Vogel") !== canonicalAnswer(multi));
    ok(checkedAnswer(multi, "Vogel|Schildkröte|Baby") !== canonicalAnswer(multi));
    throws(() => checkedAnswer(multi, ""));
    throws(() => checkedAnswer(multi, "Vogel|Katze"));
  });
  it("writing: letters only, small or capital letters both right", () => {
    for (const v of ["AUGE", "auge", "Auge", " aUgE "]) equal(checkedAnswer(spell, v), canonicalAnswer(spell), v);
    for (const v of ["AUGEN", "AGUE", "OUGE"]) ok(checkedAnswer(spell, v) !== canonicalAnswer(spell), v);
    throws(() => checkedAnswer(spell, "AUG3"));
    throws(() => checkedAnswer(spell, "AU GE"));
  });
});

describe("walks through Visit 7 (synthetic)", () => {
  type Env = OpEnv & { settings: ParentSettings };
  const mkEnv = (): Env => { let t = Date.UTC(2026, 10, 29, 14, 0, 0); let n = 0; return { content: i7, settings: { ...EMPTY_PARENT_SETTINGS }, now: () => new Date((t += 10_000)), newId: () => `id-${(n += 1)}`, tutorAvailable: false }; };
  // Isabel's real shape after Visit 6: roof blue (Visit 4), worms (Visit 5), her chick «Isa» (she typed «IsA»), Visit 6 finished.
  const start = (taughtAt = "2026-11-22T13:02:00.000Z") => {
    const s = newMissionState(i7, "isabel", "2026-10-28T16:00:00.000Z");
    s.visits = finishedV(["v1", "v2", "v4", "v5", "v6", "v7"]);
    s.story = { roofColor: { value: "Blau", optionId: "blue", kind: "preset", visit: "v5", at: "2026-11-15T10:00:00.000Z" }, birdFood: { value: "Würmer", optionId: "worms", kind: "preset", visit: "v6", at: "2026-11-21T10:40:00.000Z" }, chickName: { value: "Isa", optionId: "own", kind: "own", visit: "v7", at: "2026-11-22T13:00:00.000Z" } };
    s.missions = { "MISSION-IDA-CHICK": { missionId: "MISSION-IDA-CHICK", version: 1, visit: "v7", startedAt: "2026-11-22T12:52:00.000Z", position: "birdhouse", visited: [], active: null, steps: { "I610-FEED": { status: "done", openedAt: taughtAt, finishedAt: taughtAt, attempts: [], support: [], plays: 0, questions: {}, phase: "finished", outcome: "independent" } }, facts: {}, shownWords: [], typing: null, finishedAt: "2026-11-22T13:08:00.000Z" } } as never;
    return s;
  };
  const runner = () => {
    const env = mkEnv();
    const attempts: { objective: string; correct: boolean | null; evidence: string; teachingReason: string | null; secondsSinceTeaching: number | null; support: string[]; answer: { step: string; question: string | null } }[] = [];
    const supports: { kind: string }[] = [];
    const op = (s: MissionState, o: LearningOp) => { const r = applyLearningOp(s, o, env) as unknown as { state: MissionState; records?: { attempts?: never[]; supports?: never[] } }; attempts.push(...(r.records?.attempts ?? [])); supports.push(...(r.records?.supports ?? [])); return r.state; };
    const m = (s: MissionState, action: MissionAction) => op(s, { op: "mission", action });
    return { op, m, attempts, supports };
  };
  const play = (m: ReturnType<typeof runner>["m"], id: string) => (x: MissionState) => m(m(x, { a: "support", step: id, kind: "play" }), { a: "listen-outcome", step: id, outcome: "recorded" });
  const view = (s: MissionState) => buildMissionView(s, i7, "v8")!;

  it("right first time («Ich weiss es» right): the harder versions open, the easier ones are not needed; prior knowledge recorded apart", () => {
    const { op, m, attempts } = runner();
    let s = op(start(), { op: "start-visit" });
    const done = (id: string, act: (x: MissionState) => MissionState) => { s = m(s, { a: "open", step: id }); s = act(s); s = m(s, { a: "leave" }); };
    s = m(s, { a: "open", step: "I71-PSST" });
    equal(view(s).active!.storyName, "Isa", "her chick's name on the scene (text)");
    equal(view(s).active!.picture!.id, "chicks-day4");
    s = m(m(s, { a: "story-done", step: "I71-PSST" }), { a: "leave" });
    done("I72-RECALL", (x) => m(x, { a: "decide", step: "I72-RECALL", option: "caterpillars" }));
    done("I73-FLIP", (x) => m(m(x, { a: "answer-part", step: "I73-FLIP", part: "teach", value: "63" }), { a: "answer-part", step: "I73-FLIP", part: "ear", value: "47" }));
    let status = stepStatuses(eyes, s.missions![eyes.id]);
    equal(status["I73H-FLIP-HARD"], "available");
    done("I73H-FLIP-HARD", (x) => m(x, { a: "answer-part", step: "I73H-FLIP-HARD", part: "flip", value: "81" }));
    // «Ich weiss es»: she orders BEFORE the explanation; right → the explanation still plays, then the step ends.
    s = m(s, { a: "open", step: "I74-HATCH" });
    throws(() => m(s, { a: "answer-question", step: "I74-HATCH", question: "order", value: "Loch|Riss|Raus" }), "no ordering before her choice or the explanation");
    s = m(s, { a: "support", step: "I74-HATCH", kind: "prior-claim" });
    equal(view(s).active!.questions[0].order, null, "the right order is not on screen before her ordering");
    deepEqual(missionNarration(view(s))!.lines.map((l) => l.text), ["Tipp die drei Bilder der Reihe nach an."]);
    s = m(s, { a: "answer-question", step: "I74-HATCH", question: "order", value: "Loch|Riss|Raus" });
    equal(view(s).active!.status, "active", "the explanation still comes");
    deepEqual(missionNarration(view(s))!.lines.map((l) => l.text), ["Genau! Tipp auf «Zeig es mir», dann hörst du, wie es geht."]);
    s = play(m, "I74-HATCH")(s);
    equal(s.missions![eyes.id].steps["I74-HATCH"].outcome, "independent");
    deepEqual(missionNarration(view(s))!.lines.map((l) => l.text), ["Und schon ist es draussen!"], "no second «Richtig», no repeat of the explanation");
    s = m(s, { a: "leave" });
    done("I75-EIZAHN", (x) => m(x, { a: "answer-question", step: "I75-EIZAHN", question: "word", value: "Eizahn" }));
    done("I76-EGG", (x) => m(play(m, "I76-EGG")(x), { a: "answer-question", step: "I76-EGG", question: "egg", value: "Schildkröte|Vogel" }));
    done("I77-MILK", (x) => m(play(m, "I77-MILK")(x), { a: "answer-question", step: "I77-MILK", question: "show", value: "Raupen" }));
    done("I78-COINS", (x) => m(x, { a: "answer-part", step: "I78-COINS", part: "coins", value: "50" }));
    done("I78H-COINS-MAMA", (x) => m(x, { a: "answer-part", step: "I78H-COINS-MAMA", part: "coins", value: "60" }));
    done("I79-DAY6", (x) => m(play(m, "I79-DAY6")(x), { a: "answer-question", step: "I79-DAY6", question: "show", value: "Augen auf, Schnabel auf" }));
    done("I710-DAYS", (x) => m(x, { a: "answer-part", step: "I710-DAYS", part: "left", value: "8" }));
    done("I711-AUGE", (x) => m(x, { a: "answer-question", step: "I711-AUGE", question: "word", value: "auge" }));
    s = m(s, { a: "open", step: "I712-BOOK" });
    deepEqual(view(s).active!.book, { page: 2, previous: { page: 1, text: "TAG 1: NACKT UND BLIND.", picture: "chick-naked" } });
    equal(view(s).active!.storyName, "Isa");
    s = m(m(s, { a: "answer-question", step: "I712-BOOK", question: "word", value: "Augen auf" }), { a: "leave" });
    s = m(s, { a: "open", step: "I713-END" });
    status = stepStatuses(eyes, s.missions![eyes.id]);
    for (const id of ["I72-RECALL", "I73-FLIP", "I73H-FLIP-HARD", "I74-HATCH", "I75-EIZAHN", "I76-EGG", "I77-MILK", "I78-COINS", "I78H-COINS-MAMA", "I79-DAY6", "I710-DAYS", "I711-AUGE", "I712-BOOK"]) equal(status[id], "done", id);
    for (const id of ["I78E-COINS-EASY", "I710E-DAYS-EASY"]) equal(status[id], "not-needed", id);
    for (const id of ["I72-RECALL", "I73-FLIP", "I74-HATCH", "I76-EGG", "I711-AUGE"]) equal(s.missions![eyes.id].steps[id].outcome, "independent", id);
    // Prior knowledge and the delayed check are recorded as such.
    const prior = attempts.filter((a) => a.answer.question === "order:prior");
    deepEqual(prior.map((a) => [a.objective, a.correct, a.evidence]), [["sequencing-pictures-prior-knowledge", true, "independent"]]);
    equal(attempts.filter((a) => a.objective === "sequencing-pictures").length, 0, "no ordering after the explanation was needed");
    const recall = attempts.find((a) => a.objective === "delayed-fact-recall-chick-food")!;
    equal(recall.teachingReason, "robin-chick-food:delayed-retention", "7 days after Visit 6's I610 → a delayed check");
    ok(recall.secondsSinceTeaching! >= 6 * 86_400);
    ok(attempts.some((a) => a.objective === "writing-heard-word" && a.correct === true && a.evidence === "independent"));
    // The end: her chick peeks out of HER (blue) birdhouse; her chick's name as text; no spoken line carries it.
    const end = view(s);
    equal(end.active?.picture?.id, "peek-blue");
    equal(end.active?.storyName, "Isa");
    equal(end.active?.recap, "Jetzt kann dein Küken dich sehen!");
    for (const l of missionNarration(end)?.lines ?? []) ok(!/Isa\b/.test(l.text), l.text);
  });

  it("wrong first («Zeig es mir»): the easier versions follow; the bags after a miss; first picture shown; tiles after a miss — all with help", () => {
    const { op, m, attempts, supports } = runner();
    let s = op(start(new Date(Date.UTC(2026, 10, 28, 9)).toISOString()), { op: "start-visit" });
    const done = (id: string, act: (x: MissionState) => MissionState) => { s = m(s, { a: "open", step: id }); s = act(s); s = m(s, { a: "leave" }); };
    done("I71-PSST", (x) => m(x, { a: "story-done", step: "I71-PSST" }));
    s = m(s, { a: "open", step: "I72-RECALL" });
    s = m(s, { a: "decide", step: "I72-RECALL", option: "seeds" });
    deepEqual(missionNarration(view(s))!.lines.map((l) => l.text), ["Dein Küken dreht den Kopf weg. Körner sind zu hart für Babys."]);
    s = m(m(s, { a: "decide", step: "I72-RECALL", option: "caterpillars" }), { a: "leave" });
    equal(s.missions![eyes.id].steps["I72-RECALL"].outcome, "supported", "recalled with help");
    equal(attempts.find((a) => a.objective === "delayed-fact-recall-chick-food")!.teachingReason, "robin-chick-food:short-check", "a day later: a short check, never called delayed");
    s = m(s, { a: "open", step: "I73-FLIP" });
    ok(view(s).active!.solve!.parts[0].counters, "the bags are there from the start (taught)");
    s = m(s, { a: "answer-part", step: "I73-FLIP", part: "teach", value: "63" });
    s = m(s, { a: "answer-part", step: "I73-FLIP", part: "ear", value: "74" });
    // The evidence case (Visit 6, I62): the correction plays → the screen's script is feedback → answers are locked while it plays.
    const corr = missionNarration(view(s), ["teach"])!;
    deepEqual(corr.lines.map((l) => l.text), ["Noch nicht. Wir sagen zuerst die Sieben, aber wir schreiben zuerst die Vier."]);
    ok(corr.feedback && feedbackLock(true, corr));
    ok(view(s).active!.solve!.parts[1].counters, "the bags appear after the miss (the easier version inside the step)");
    s = m(m(s, { a: "answer-part", step: "I73-FLIP", part: "ear", value: "47" }), { a: "leave" });
    equal(stepStatuses(eyes, s.missions![eyes.id])["I73H-FLIP-HARD"], "not-needed");
    // «Zeig es mir»: the explanation first, then she orders; a miss → the first picture is shown, she orders the rest (with help).
    s = m(s, { a: "open", step: "I74-HATCH" });
    s = play(m, "I74-HATCH")(s);
    deepEqual(view(s).active!.questions[0].order, ["Loch", "Riss", "Raus"], "taught: the right order was shown with the explanation");
    deepEqual(missionNarration(view(s))!.lines.map((l) => l.text), ["Tipp die drei Bilder der Reihe nach an."]);
    s = m(s, { a: "answer-question", step: "I74-HATCH", question: "order", value: "Riss|Loch|Raus" });
    equal(view(s).active!.questions[0].firstShown, "Loch");
    s = m(m(s, { a: "answer-question", step: "I74-HATCH", question: "order", value: "Loch|Riss|Raus" }), { a: "leave" });
    equal(s.missions![eyes.id].steps["I74-HATCH"].outcome, "supported");
    ok(supports.some((x) => x.kind === "mission_first_shown"));
    deepEqual(attempts.filter((a) => a.answer.step === "I74-HATCH").map((a) => a.objective), ["sequencing-pictures", "sequencing-pictures"], "after teaching only");
    done("I75-EIZAHN", (x) => m(m(m(x, { a: "answer-question", step: "I75-EIZAHN", question: "word", value: "Zahn" }), { a: "support", step: "I75-EIZAHN", kind: "letters" }), { a: "answer-question", step: "I75-EIZAHN", question: "word", value: "Eizahn" }));
    // Several answers: a miss names each, she tries again.
    s = m(play(m, "I76-EGG")(m(s, { a: "open", step: "I76-EGG" })), { a: "answer-question", step: "I76-EGG", question: "egg", value: "Vogel|Hund" });
    deepEqual(missionNarration(view(s))!.lines.map((l) => l.text), ["Ein Hund wächst im Bauch, ein Baby auch. Eine Schildkröte schlüpft aus einem Ei. Und ein Vogel?"]);
    s = m(m(s, { a: "answer-question", step: "I76-EGG", question: "egg", value: "Vogel|Schildkröte" }), { a: "leave" });
    equal(s.missions![eyes.id].steps["I76-EGG"].outcome, "supported");
    done("I77-MILK", (x) => m(m(play(m, "I77-MILK")(x), { a: "answer-question", step: "I77-MILK", question: "show", value: "Milch" }), { a: "answer-question", step: "I77-MILK", question: "show", value: "Raupen" }));
    done("I78-COINS", (x) => m(m(x, { a: "answer-part", step: "I78-COINS", part: "coins", value: "5" }), { a: "answer-part", step: "I78-COINS", part: "coins", value: "50" }));
    equal(stepStatuses(eyes, s.missions![eyes.id])["I78E-COINS-EASY"], "available");
    done("I78E-COINS-EASY", (x) => m(x, { a: "answer-part", step: "I78E-COINS-EASY", part: "coins", value: "20" }));
    done("I79-DAY6", (x) => m(m(play(m, "I79-DAY6")(x), { a: "answer-question", step: "I79-DAY6", question: "show", value: "Augen auf, Schnabel zu" }), { a: "answer-question", step: "I79-DAY6", question: "show", value: "Augen auf, Schnabel auf" }));
    done("I710-DAYS", (x) => m(m(x, { a: "answer-part", step: "I710-DAYS", part: "left", value: "14" }), { a: "answer-part", step: "I710-DAYS", part: "left", value: "8" }));
    done("I710E-DAYS-EASY", (x) => m(x, { a: "answer-part", step: "I710E-DAYS-EASY", part: "left", value: "4" }));
    // Writing: a miss → the tiles (recorded help first), the second answer counts as with help.
    s = m(s, { a: "open", step: "I711-AUGE" });
    equal(view(s).active!.questions[0].tiles, null, "no tiles before her first try");
    s = m(s, { a: "answer-question", step: "I711-AUGE", question: "word", value: "OGE" });
    deepEqual(view(s).active!.questions[0].tiles, ["G", "U", "N", "E", "A", "O"]);
    s = m(m(s, { a: "answer-question", step: "I711-AUGE", question: "word", value: "AUGE" }), { a: "leave" });
    equal(s.missions![eyes.id].steps["I711-AUGE"].outcome, "supported");
    ok(attempts.filter((a) => a.objective === "writing-heard-word").at(-1)!.support.includes("letters"));
    done("I712-BOOK", (x) => m(m(m(x, { a: "answer-question", step: "I712-BOOK", question: "word", value: "Federn" }), { a: "support", step: "I712-BOOK", kind: "letters" }), { a: "answer-question", step: "I712-BOOK", question: "word", value: "Augen auf" }));
    s = m(s, { a: "open", step: "I713-END" });
    equal(view(s).active!.picture!.id, "peek-blue");
    for (const id of ["I73H-FLIP-HARD", "I78H-COINS-MAMA"]) equal(stepStatuses(eyes, s.missions![eyes.id])[id], "not-needed", id);
  });

  it("«Ich weiss es» and wrong: her ordering before is recorded as prior knowledge; after the explanation she orders again (after teaching)", () => {
    const { op, m, attempts } = runner();
    let s = op(start(), { op: "start-visit" });
    for (const id of ["I71-PSST"]) s = m(m(m(s, { a: "open", step: id }), { a: "story-done", step: id }), { a: "leave" });
    s = m(m(m(s, { a: "open", step: "I72-RECALL" }), { a: "decide", step: "I72-RECALL", option: "caterpillars" }), { a: "leave" });
    s = m(m(m(m(s, { a: "open", step: "I73-FLIP" }), { a: "answer-part", step: "I73-FLIP", part: "teach", value: "63" }), { a: "answer-part", step: "I73-FLIP", part: "ear", value: "47" }), { a: "leave" });
    s = m(m(m(s, { a: "open", step: "I73H-FLIP-HARD" }), { a: "answer-part", step: "I73H-FLIP-HARD", part: "flip", value: "18" }), { a: "answer-part", step: "I73H-FLIP-HARD", part: "flip", value: "81" });
    s = m(s, { a: "leave" });
    s = m(s, { a: "open", step: "I74-HATCH" });
    s = m(s, { a: "support", step: "I74-HATCH", kind: "prior-claim" });
    s = m(s, { a: "answer-question", step: "I74-HATCH", question: "order", value: "Raus|Loch|Riss" });
    deepEqual(missionNarration(view(s))!.lines.map((l) => l.text), ["Noch nicht ganz. Tipp auf «Zeig es mir», ich erkläre es dir."]);
    throws(() => m(s, { a: "answer-question", step: "I74-HATCH", question: "order", value: "Loch|Riss|Raus" }), "she hears the explanation first");
    s = play(m, "I74-HATCH")(s);
    equal(view(s).active!.questions[0].tries, 0, "the ordering after the explanation starts fresh");
    s = m(s, { a: "answer-question", step: "I74-HATCH", question: "order", value: "Loch|Riss|Raus" });
    equal(s.missions![eyes.id].steps["I74-HATCH"].outcome, "independent", "right first time after the explanation");
    deepEqual(attempts.filter((a) => a.answer.step === "I74-HATCH").map((a) => [a.objective, a.correct]), [["sequencing-pictures-prior-knowledge", false], ["sequencing-pictures", true]]);
  });
});

describe("no tapping while feedback plays (both children)", () => {
  it("a feedback script locks while it plays; an intro does not; a failed or missing line unlocks at once", async () => {
    // Visit 6, I62 (the evidence: 24 at 11:53:26.6Z, 42 at 11:53:30.7Z while the correction played).
    const chick = i6.missions!.find((m) => m.visit === "v7")!;
    let s = newMissionState(i6, "isabel", "2026-10-28T16:00:00.000Z");
    s.visits = finishedV(["v1", "v2", "v4", "v5", "v6"]);
    let t = Date.UTC(2026, 10, 22, 11, 50);
    const env = { content: i6, settings: { ...EMPTY_PARENT_SETTINGS }, now: () => new Date((t += 4_000)), newId: () => `x${t}`, tutorAvailable: false };
    const m = (a: MissionAction) => (s = applyLearningOp(s, { op: "mission", action: a }, env).state);
    s = applyLearningOp(s, { op: "start-visit" }, env).state;
    m({ a: "open", step: "I61-PSST" });
    m({ a: "story-done", step: "I61-PSST" });
    m({ a: "leave" });
    m({ a: "open", step: "I62-FLIP" });
    const intro = missionNarration(buildMissionView(s, i6, "v7")!)!;
    ok(!intro.feedback && !feedbackLock(true, intro), "the question itself: answers open");
    m({ a: "answer-part", step: "I62-FLIP", part: "flip", value: "24" });
    const corr = missionNarration(buildMissionView(s, i6, "v7")!)!;
    deepEqual(corr.lines.map((l) => l.text), ["Noch nicht. Wir sagen zuerst die Zwei, aber wir schreiben zuerst die Vier."]);
    ok(feedbackLock(true, corr), "locked while the correction plays");
    ok(!feedbackLock(false, corr), "unlocked when it has ended");
    // A line with no recording: the player reports «missing», not «speaking» — so the answers unlock (never stuck).
    const player = createNarrationPlayer({ fetchClip: async () => null, createAudio: () => null, synth: null, configuredSlots: () => new Set(["de-female"]) });
    player.unlock();
    await player.play(corr);
    ok(player.status() !== "speaking");
    ok(!feedbackLock(player.status() === "speaking", corr));
    void chick;
  });
  it("every feedback kind is marked: a wrong pick, a hint, a read/listen answer, a finished beat", () => {
    const { lines: _l, ...rest } = { lines: [] };
    void _l;
    void rest;
    let s = newMissionState(i7, "isabel", "2026-10-28T16:00:00.000Z");
    s.visits = finishedV(["v1", "v2", "v4", "v5", "v6", "v7"]);
    let t = Date.UTC(2026, 10, 29, 10);
    const env = { content: i7, settings: { ...EMPTY_PARENT_SETTINGS }, now: () => new Date((t += 4_000)), newId: () => `y${t}`, tutorAvailable: false };
    const m = (a: MissionAction) => (s = applyLearningOp(s, { op: "mission", action: a }, env).state);
    const sc = () => missionNarration(buildMissionView(s, i7, "v8")!)!;
    s = applyLearningOp(s, { op: "start-visit" }, env).state;
    m({ a: "open", step: "I71-PSST" });
    ok(!sc().feedback);
    m({ a: "story-done", step: "I71-PSST" });
    m({ a: "leave" });
    m({ a: "open", step: "I72-RECALL" });
    ok(!sc().feedback);
    m({ a: "decide", step: "I72-RECALL", option: "bread" });
    ok(sc().feedback, "after a wrong pick");
    m({ a: "decide", step: "I72-RECALL", option: "caterpillars" });
    ok(sc().feedback, "after the right pick");
    m({ a: "leave" });
    m({ a: "open", step: "I73-FLIP" });
    ok(!sc().feedback);
    m({ a: "answer-part", step: "I73-FLIP", part: "teach", value: "36" });
    ok(sc().feedback);
  });
  it("the scenes lock their answers with a disabled, dimmed fieldset; replay sits outside it", () => {
    const ws = readFileSync(new URL("../components/family/learning/workshop-scene.tsx", import.meta.url), "utf8");
    ok(ws.includes("const locked = feedbackLock(narration.speaking, script);"));
    ok(/<fieldset disabled=\{locked\}[^>]*opacity-60/.test(ws));
    ok(ws.indexOf("<NarrationControl status={narration.status}") < ws.indexOf("<fieldset disabled={locked}"), "replay outside the locked area");
    const mw = readFileSync(new URL("../components/family/learning/mission-world.tsx", import.meta.url), "utf8");
    ok(/<fieldset disabled=\{feedbackLock\}/.test(mw), "Santiago's scenes too");
  });
});

describe("recordings: Visit 6 lines unchanged; the new ones in Ida's voice; her chick's name never in a line", () => {
  const keys = (l: NarrationLine[]) => new Map(l.map((x) => [catalogKey(x), x.text]));
  it("every line of v6 keeps its id and text in v7", () => {
    const after = keys(narrationCatalog(i7));
    for (const [k, t] of keys(narrationCatalog(i6))) equal(after.get(k), t, k);
  });
  it("the new lines are all de-female (Ida), short, Swiss spelling, without a placeholder or a name", () => {
    const old = new Set(narrationCatalog(i6).map(catalogKey));
    const added = narrationCatalog(i7).filter((l) => !old.has(catalogKey(l)));
    ok(added.length > 50 && added.length < 160, String(added.length));
    for (const l of added) {
      equal(l.slot, "de-female", l.text);
      ok(l.text.length <= 230, l.text);
      ok(!/[{}ß]|\bIsa\b|IsA|Isabel|Santiago/.test(l.text), l.text);
    }
  });
  it("every objective of the visit sits on a ladder row or is named as not a skill", () => {
    for (const o of [...eyes.steps.map((s) => s.objective), st(eyes, "I74-HATCH").priorKnowledge!.objective]) {
      const r = resolveObjective("isabel", o, "de");
      ok(r.kind === "row" || r.kind === "not-a-skill", o);
    }
    for (const o of ["delayed-fact-recall-chick-food", "writing-heard-word", "sequencing-pictures-prior-knowledge"]) equal(resolveObjective("isabel", o, "de").kind, "not-a-skill", o);
    equal(resolveObjective("isabel", "sequencing-pictures", "de").kind, "row");
  });
  it("a delayed check is called delayed only after 6 days", () => {
    equal(retentionClass(6 * 86_400), "delayed-retention");
    equal(retentionClass(6 * 86_400 - 1), "short-check");
  });
});

describe("the map and the end picture", () => {
  const input = (visits: { id: string; finishedAt: string | null }[], current: string | null, choices: Record<string, string>, story?: { chickName?: { value: string } }) => ({ child: "isabel" as const, visits, choices, current: current ? { visit: current, mission: "M", places: [], start: null } : null, seen: [], story });
  const piece = (w: ReturnType<typeof deriveHomeWorld>, id: string) => w.pieces.find((p) => p.id === id);
  const done = (id: string) => ({ id, finishedAt: "2026-11-22T13:08:00Z" });
  it("during Visit 7 the chicks stage stays; after it her chick peeks out (4th stage), the label names her chick, the water bowl stays", () => {
    for (const roof of ["red", "blue", "yellow"]) {
      const during = deriveHomeWorld(input([done("v5"), done("v6"), done("v7"), { id: "v8", finishedAt: null }], "v8", { "IV10-ROOF": roof, "IF8-FOOD": "worms" }, { chickName: { value: "Isa" } }));
      equal(piece(during, "i-birdhouse")?.asset, `i-birdhouse-tree-${roof}-chicks-built`);
      const after = deriveHomeWorld(input([done("v5"), done("v6"), done("v7"), done("v8")], null, { "IV10-ROOF": roof, "IF8-FOOD": "worms" }, { chickName: { value: "Isa" } }));
      equal(piece(after, "i-birdhouse")?.asset, `i-birdhouse-tree-${roof}-peek-built`);
      equal(piece(after, "i-birdhouse")?.label, "Vogelhaus · Isa");
      equal(piece(after, "i-water-bowl")?.asset, "i-water-bowl-built");
    }
    const have = new Set(ASSETS.map((a) => a.id));
    for (const c of ["red", "blue", "yellow"]) {
      const id = `i-birdhouse-tree-${c}-peek-built`;
      ok(have.has(id), id);
      ok(existsSync(new URL(`../../public/family/home-map/${id}.png`, import.meta.url)), id);
    }
  });
  it("the end picture is her roof's peek picture (fallback red); Visit 6's pictures are unchanged", () => {
    for (const roof of ["red", "blue", "yellow"]) equal(storyPicture("peek", { roofColor: { optionId: roof } }), `peek-${roof}`);
    equal(storyPicture("peek", {}), "peek-red");
    equal(storyPicture("food-caterpillars", { roofColor: { optionId: "blue" }, birdFood: { optionId: "worms" } }), "chicks-blue-worms");
  });
});
