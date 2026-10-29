// Isabel Visit 2 — «Idas Garten» + the narration standard (2026-10-29, I2-01…I2-08). Fictional data only; no provider, no audio.
import { describe, it } from "node:test";
import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { asLearningContent, type LearningContent } from "./family-learning-content.ts";
import { asIsabelContent, reconcileIsabelContent, EXPECTED_GARDEN_STEPS } from "./family-learning-isabel.ts";
import { applyLearningOp, buildChildView, currentStage, EMPTY_PARENT_SETTINGS, newMissionState, upgradeMissionState, type LearningOp, type MissionState, type OpEnv, type ParentSettings } from "./family-learning-state.ts";
import { buildMissionView, missionDefFor, missionEvidence, missionVisitSummary, type MissionAction, type MissionView } from "./family-learning-mission.ts";
import { buildVisitSummary, correctedWorkshopChildSummary, type VisitSummary } from "./family-learning-summary.ts";
import { line, missionNarration, narrationCatalog, narrationId, NARRATION_UI, type NarrationLine } from "./family-learning-narration.ts";
import { createNarrationPlayer, pickGermanVoice, type VoiceLike } from "./family-narration-player.ts";
import { budgetSpent, clipPathname, narrationBudget, narrationReadiness, prepareNarration } from "./family-narration-store.ts";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../data/family-learning/content/${name}`, import.meta.url), "utf8"));
const rawV1 = read("isabel-workshop-v1.json");
const rawV2 = read("isabel-workshop-v2.json");
const v1: LearningContent = asIsabelContent(rawV1);
const v2: LearningContent = asIsabelContent(rawV2);
const santiago: LearningContent = asLearningContent(read("santiago-expedition-v7.json"));
const GARDEN = "MISSION-IDA-GARDEN";
const WORKSHOP = "MISSION-OLD-LILA-WORKSHOP";

type Env = OpEnv & { settings: ParentSettings };
function makeEnv(content: LearningContent, start = Date.UTC(2026, 9, 28, 16, 34, 32)): Env {
  let t = start;
  let n = 0;
  return { content, settings: { ...EMPTY_PARENT_SETTINGS }, now: () => new Date((t += 15_000)), newId: () => `fixture-${(n += 1)}` };
}
const op = (s: MissionState, o: LearningOp, env: Env) => applyLearningOp(s, o, env).state;
const m = (s: MissionState, action: MissionAction, env: Env) => op(s, { op: "mission", action }, env);
const open = (s: MissionState, step: string, env: Env) => m(s, { a: "open", step }, env);
const leave = (s: MissionState, env: Env) => m(s, { a: "leave" }, env);
const parts = (s: MissionState, step: string, values: Record<string, number>, env: Env) => Object.entries(values).reduce((x, [part, v]) => m(x, { a: "answer-part", step, part, value: String(v) }, env), s);
const mview = (s: MissionState, content = v2): MissionView => buildMissionView(s, content, "v2")!;

/** Visit 1 as Isabel actually did it (fictional replay of the reviewed shape): she chose the WALL; everything first try. */
function visit1(env: Env): MissionState {
  let s = op(newMissionState(v1, "isabel", "2026-10-28T16:34:00.000Z"), { op: "start-visit" }, env);
  s = m(open(s, "W1-HELLO", env), { a: "story-done", step: "W1-HELLO" }, env);
  s = m(open(leave(s, env), "W2-MAKE", env), { a: "decide", step: "W2-MAKE", option: "wall" }, env);
  s = open(leave(s, env), "W3-MATERIALS", env);
  for (const [q, v] of [["chair", "Holz"], ["window", "Glas"], ["wall", "Ziegel"]]) s = m(s, { a: "answer-question", step: "W3-MATERIALS", question: q, value: v }, env);
  s = parts(open(leave(s, env), "W4-COUNT", env), "W4-COUNT", { plus: 7, minus: 6 }, env);
  s = parts(open(leave(s, env), "W5-TENS", env), "W5-TENS", { total: 21 }, env);
  s = open(leave(s, env), "W8-READ", env);
  s = m(s, { a: "answer-question", step: "W8-READ", question: "word", value: "Ast" }, env);
  s = open(leave(s, env), "W9-LISTEN", env);
  s = m(s, { a: "support", step: "W9-LISTEN", kind: "play" }, env);
  s = m(s, { a: "listen-outcome", step: "W9-LISTEN", outcome: "browser" }, env);
  s = m(s, { a: "answer-question", step: "W9-LISTEN", question: "show", value: "Fenster" }, env);
  s = open(leave(s, env), "W10-CRAFT", env);
  s = m(s, { a: "craft-found", step: "W10-CRAFT", items: ["table", "spoon", "door"] }, env);
  s = m(s, { a: "story-done", step: "W10-CRAFT" }, env);
  s = m(open(leave(s, env), "W11-ROOM", env), { a: "story-done", step: "W11-ROOM" }, env);
  s = m(s, { a: "finish" }, env);
  s = op(s, { op: "closing-feedback", feedback: { difficulty: "easy" } }, env);
  return op(s, { op: "reflect", interest: { kind: "choice", choice: "garden" } } as LearningOp, env);
}

/** Visit 1 done (content v1), then served content v2 — the additive upgrade as the server does it on read. */
function afterVisit1() {
  const env1 = makeEnv(v1);
  const done = visit1(env1);
  const upgraded = upgradeMissionState(done, v2, "2026-10-29T15:00:00.000Z").state;
  return { done, upgraded, env: makeEnv(v2, Date.UTC(2026, 9, 29, 15, 0, 0)) };
}

/** Every narration line said on the way must be in the catalogue (prerecordable); collects them for the safety checks. */
function said(s: MissionState, seen: string[] = []): NarrationLine[] {
  const script = missionNarration(mview(s), seen);
  return script?.lines ?? [];
}

describe("Visit 2 content — her own line, version 2 = version 1 unchanged + Idas Garten (I2-01, I2-02, I2-03)", () => {
  it("reconciles; every version-1 entry is byte-for-byte the released one", () => {
    deepStrictEqual(reconcileIsabelContent(rawV2).problems, []);
    equal(rawV2.contentVersion, 2);
    deepStrictEqual(rawV2.missions[0], rawV1.missions[0]);
    deepStrictEqual(rawV2.visits[0], rawV1.visits[0]);
    deepStrictEqual(rawV2.reflection, rawV1.reflection);
    deepStrictEqual(rawV2.missions[1].steps.map((s: { id: string }) => s.id), [...EXPECTED_GARDEN_STEPS]);
  });
  it("the gardener is a separate story character; Old Lila is never re-cast; narration is automatic", () => {
    const g = v2.missions!.find((x) => x.id === GARDEN)!;
    deepStrictEqual(g.characters.map((c) => [c.id, c.name]), [["ida", "Gärtnerin Ida"]]);
    deepStrictEqual(g.narration, { mode: "auto" });
    for (const s of g.steps) for (const l of [...s.intro, ...s.done]) equal(l.speaker, "ida");
    const bad = structuredClone(rawV2);
    bad.missions[1].characters[0] = { id: "lila", name: "Old Lila", role: "Gärtnerin", language: "de", plate: "keeper" };
    ok(reconcileIsabelContent(bad).problems.some((p) => /must not be Old Lila/.test(p)));
    const silent = structuredClone(rawV2);
    delete silent.missions[1].narration;
    ok(reconcileIsabelContent(silent).problems.some((p) => /narration.mode must be auto/.test(p)));
  });
  it("progression from her actual Visit 1: fresh tens (not 21/23), a new reading word, a new listening sentence, missing part to ten", () => {
    const g = v2.missions!.find((x) => x.id === GARDEN)!;
    const tens = g.steps.flatMap((s) => (s.solve?.parts ?? []).filter((p) => p.counters?.bundles).map((p) => p.answer));
    deepStrictEqual(tens, [32, 25]);
    equal(g.steps.find((s) => s.kind === "read")!.text!.body, "NEST");
    equal(g.steps.find((s) => s.kind === "listen")!.text!.body, "Zeig mir die Schnecke auf dem Blatt.");
    const ten = g.steps.find((s) => s.id === "IG5-PLANTING")!.solve!.parts.find((p) => p.id === "ten")!;
    deepStrictEqual([ten.counters!.frame, ten.counters!.a, ten.counters!.ask, ten.answer], [10, 7, "missing", 3]);
    const reused = structuredClone(rawV2);
    reused.missions[1].steps[2].solve.parts[0] = { ...reused.missions[1].steps[2].solve.parts[0], answer: 21, counters: { a: 20, b: 1, op: "+", unit: "Stäbe", bundles: true } };
    ok(reconcileIsabelContent(reused).problems.some((p) => /21 was already asked/.test(p)));
    const oldWord = structuredClone(rawV2);
    const r = oldWord.missions[1].steps.find((s: { kind: string }) => s.kind === "read");
    r.text.body = "AST";
    r.letters = { word: "AST", letters: [{ letter: "A", sound: "a" }, { letter: "S", sound: "s" }, { letter: "T", sound: "t" }], spoken: "A. S. T. Ast.", teach: "Ast." };
    ok(reconcileIsabelContent(oldWord).problems.some((p) => /AST was already read/.test(p)));
  });
  it("Swiss standard orthography, short lines, no praise in non-independent endings, no typing", () => {
    const text = JSON.stringify(rawV2.missions[1]);
    ok(!/ß/.test(text));
    const g = v2.missions!.find((x) => x.id === GARDEN)!;
    ok(!g.steps.some((s) => ["typing-block", "write", "produce", "recall"].includes(s.kind)));
    equal(g.typingBlock, undefined);
    const sharp = structuredClone(rawV2);
    sharp.missions[1].steps[0].intro[0].text = "Hallo! Heute ist es heiß.";
    ok(reconcileIsabelContent(sharp).problems.some((p) => /Swiss standard orthography/.test(p)));
  });
});

describe("continuity after her completed Visit 1 (I2-01)", () => {
  it("upgrades additively: Visit 1 records unchanged, no pilot date, Visit 2 offered next on her own hub", () => {
    const { done, upgraded, env } = afterVisit1();
    deepStrictEqual(upgraded.missions![WORKSHOP], done.missions![WORKSHOP]);
    deepStrictEqual(upgraded.visits, done.visits);
    deepStrictEqual(upgraded.interests, done.interests);
    equal(upgraded.upgradedAt ?? null, null, "her 1 → 2 upgrade dates no pilot");
    equal(upgraded.contentVersion, 2);
    const view = buildChildView(upgraded, v2, env.settings, new Date(Date.UTC(2026, 9, 29, 15, 0, 0)), 0, { noktMode: "subscription" });
    equal(view.next.visit, "v2");
    equal(view.nextStep, "Heute baust du mit Gärtnerin Ida einen Garten.");
    equal(view.visitText?.character, "Gärtnerin Ida");
    equal(view.nokt?.mode ?? "unavailable", "unavailable", "never Nokt for Isabel");
    // Capped back to version 1 (rollback): Visit 1 still reads, nothing further is offered.
    const back = buildChildView(upgraded, v1, env.settings, new Date(), 0, { noktMode: "unavailable" });
    equal(back.next.visit, null);
  });
  it("the Visit 1 summary names HER wall and never praises her choice; the stored wording is corrected on read only", () => {
    const { upgraded } = afterVisit1();
    const now = buildVisitSummary(upgraded, v2, "v1");
    equal(now.artifact.text, "Im Zimmer: eine Wand.");
    equal(now.success?.text, "Du hast alle Materialien beim ersten Versuch richtig zugeordnet.");
    ok(!/wall|Was baust du/.test(JSON.stringify(now)));
    // What the old derivation stored (the defect Nabu read on October 28).
    const stored: VisitSummary = { visit: "v1", title: now.title, success: { text: "Was baust du?: „wall“ — ohne Hilfe, beim ersten Versuch.", basis: "x" }, practiced: null, next: now.next, artifact: { kind: "mission", text: "Im Zimmer: ein Regal." } };
    const fix = correctedWorkshopChildSummary(stored, upgraded, v2, "v1")!;
    equal(fix.summary.artifact.text, "Im Zimmer: eine Wand.");
    deepStrictEqual(fix.stored, stored, "the stored wording is kept beside it");
    ok(/Vorliebe und kein Erfolg/.test(fix.note));
    equal(correctedWorkshopChildSummary(now, upgraded, v2, "v1"), null, "a correct summary is returned unchanged");
    equal(correctedWorkshopChildSummary(stored, upgraded, santiago, "v1"), null, "never applied to Santiago's content");
  });
});

/** Visit 2, everything first try (fictional). Returns the state after the closing and every narration line on the way. */
function gardenFirstTry() {
  const { upgraded, env } = afterVisit1();
  const heard: NarrationLine[] = [];
  const hear = (s: MissionState, seen?: string[]) => heard.push(...said(s, seen));
  let s = op(upgraded, { op: "start-visit" }, env);
  equal(currentStage(s, v2), "mission");
  s = open(s, "IG1-HELLO", env); hear(s);
  s = m(s, { a: "story-done", step: "IG1-HELLO" }, env); hear(s);
  s = open(leave(s, env), "IG2-PLANT", env); hear(s);
  s = m(s, { a: "decide", step: "IG2-PLANT", option: "flowers" }, env); hear(s);
  s = open(leave(s, env), "IG3-STICKS", env); hear(s);
  s = parts(s, "IG3-STICKS", { total: 32 }, env); hear(s);
  s = open(leave(s, env), "IG5-PLANTING", env); hear(s);
  s = parts(s, "IG5-PLANTING", { plus: 9 }, env); hear(s);
  hear(s, ["plus"]);
  s = parts(s, "IG5-PLANTING", { minus: 5 }, env); hear(s, ["plus"]);
  hear(s, ["plus", "minus"]);
  s = parts(s, "IG5-PLANTING", { ten: 3 }, env); hear(s, ["plus", "minus", "ten"]);
  s = open(leave(s, env), "IG7-READ", env); hear(s);
  s = m(s, { a: "answer-question", step: "IG7-READ", question: "word", value: "Nest" }, env); hear(s);
  s = open(leave(s, env), "IG8-LISTEN", env); hear(s);
  s = m(s, { a: "support", step: "IG8-LISTEN", kind: "play" }, env);
  s = m(s, { a: "listen-outcome", step: "IG8-LISTEN", outcome: "device-de" }, env); hear(s);
  s = m(s, { a: "answer-question", step: "IG8-LISTEN", question: "show", value: "Schnecke auf dem Blatt" }, env); hear(s);
  s = open(leave(s, env), "IG9-CRAFT", env); hear(s);
  s = m(s, { a: "craft-found", step: "IG9-CRAFT", items: ["flower", "grass", "tree"] }, env);
  s = m(s, { a: "story-done", step: "IG9-CRAFT" }, env); hear(s);
  s = open(leave(s, env), "IG10-GARDEN", env); hear(s);
  const outcome = mview(s).active!;
  s = m(s, { a: "story-done", step: "IG10-GARDEN" }, env); hear(s);
  s = m(s, { a: "finish" }, env);
  return { s, env, heard, outcome };
}

describe("Visit 2 journey — first tries (fictional)", () => {
  it("runs every beat; the fresh application and the easier path are not needed; her garden shows HER choice", () => {
    const { s, outcome } = gardenFirstTry();
    const run = s.missions![GARDEN];
    equal(run.steps["IG4-STICKS-AGAIN"], undefined);
    equal(run.steps["IG6-PLANTING-EASIER"], undefined);
    equal(outcome.recap, "Im Garten wachsen Blumen.");
    equal(outcome.picture?.id, "garden-flowers");
    equal(outcome.ending?.success, "Die Stäbe hast du beim ersten Versuch richtig gezählt.");
    equal(outcome.ending?.next, NARRATION_UI.noOpenNext);
    equal(currentStage(s, v2), "reflect");
    const closing = buildChildView(s, v2, EMPTY_PARENT_SETTINGS, new Date(), 0, { noktMode: "unavailable" }).reflection!.closing!;
    equal(closing.narrated, true);
    deepStrictEqual(closing.farewell, ["Danke! Bis bald im Garten!", "Dein Garten ist gespeichert."]);
  });
  it("every spoken line is a catalogued, reviewed line (prerecordable); none says a reading word or an option before her attempt", () => {
    const { heard } = gardenFirstTry();
    const catalog = new Set(narrationCatalog(v2).map((l) => l.id));
    for (const l of heard) ok(catalog.has(l.id), `catalogued: ${l.text}`);
    ok(heard.some((l) => l.text === "Was soll in deinem Garten wachsen? Tipp auf ein Bild."));
    ok(heard.some((l) => l.text === "Danke! Bis bald im Garten!"), "the ending is spoken");
  });
  it("the closing records her answers and her own next-visit choice; Visit 1's records stay untouched", () => {
    const { s, env } = gardenFirstTry();
    let x = op(s, { op: "closing-feedback", feedback: { difficulty: "easy", enjoyment: "yes" } }, env);
    x = op(x, { op: "reflect", interest: { kind: "choice", choice: "birdhouse" } } as LearningOp, env);
    ok(x.visits.find((v) => v.id === "v2")!.finishedAt);
    deepStrictEqual((x.interests ?? []).map((i) => [i.visit, i.kind, i.choice]), [["v1", "choice", "garden"], ["v2", "choice", "birdhouse"]]);
    deepStrictEqual(x.missions![WORKSHOP], afterVisit1().upgraded.missions![WORKSHOP]);
    const summary = missionVisitSummary(x, v2, "v2")!;
    equal(summary.artifact?.text, "Im Garten wachsen Blumen.");
    ok(!/Blumen gewählt/.test(summary.success?.text ?? ""), "her choice is never the success");
  });
});

describe("Visit 2 journey — wrong answers, help, support paths and narration safety (I2-03, I2-05)", () => {
  it("tens missed → hint only after the try → fresh application 25; the math answer is never spoken before it was answered or taught", () => {
    const { upgraded, env } = afterVisit1();
    let s = op(upgraded, { op: "start-visit" }, env);
    s = m(open(s, "IG1-HELLO", env), { a: "story-done", step: "IG1-HELLO" }, env);
    s = m(open(leave(s, env), "IG2-PLANT", env), { a: "decide", step: "IG2-PLANT", option: "tree" }, env);
    s = open(leave(s, env), "IG3-STICKS", env);
    const before = said(s);
    ok(before.some((l) => /3 Bündel und 2 einzelne/.test(l.text)));
    ok(!before.some((l) => /\b32\b/.test(l.text)), "the question is spoken, never its answer");
    equal(mview(s).active!.solve!.parts[0].hintAllowed, false, "no hint before the first try");
    s = parts(s, "IG3-STICKS", { total: 23 }, env);
    const retry = said(s);
    deepStrictEqual(retry.map((l) => l.text), ["Noch nicht. Schau: In jedem Bündel sind 10 Stäbe."]);
    s = parts(s, "IG3-STICKS", { total: 23 }, env);
    ok(!said(s).some((l) => /23/.test(l.text)), "her own repeated number is never spoken back");
    s = m(s, { a: "hint", step: "IG3-STICKS", part: "total" }, env);
    deepStrictEqual(said(s).map((l) => l.text), ["Ein Bündel hat 10 Stäbe. Zähl die Bündel in Zehnern: 10, 20 …", "Wie viele Stäbe sind in 3 Bündeln?"]);
    s = m(s, { a: "hint-check", step: "IG3-STICKS", part: "total", hint: "IG3-total-H1", value: "30" }, env);
    ok(said(s)[0].text.startsWith("Genau, 30."));
    s = parts(s, "IG3-STICKS", { total: 32 }, env);
    ok(said(s).some((l) => l.text === "Richtig! 32 Stäbe."), "the answer is said only after her own correct answer");
    equal(s.missions![GARDEN].steps["IG3-STICKS"].outcome, "supported");
    s = open(leave(s, env), "IG4-STICKS-AGAIN", env);
    ok(!said(s).some((l) => /\b25\b/.test(l.text)));
    s = parts(s, "IG4-STICKS-AGAIN", { total: 25 }, env);
    equal(s.missions![GARDEN].steps["IG4-STICKS-AGAIN"].outcome, "independent");
  });
  it("small sums missed → the easier path; the ending names an honest success and the open item", () => {
    const { upgraded, env } = afterVisit1();
    let s = op(upgraded, { op: "start-visit" }, env);
    s = m(open(s, "IG1-HELLO", env), { a: "story-done", step: "IG1-HELLO" }, env);
    s = m(open(leave(s, env), "IG2-PLANT", env), { a: "decide", step: "IG2-PLANT", option: "vegetables" }, env);
    s = parts(open(leave(s, env), "IG3-STICKS", env), "IG3-STICKS", { total: 32 }, env);
    s = open(leave(s, env), "IG5-PLANTING", env);
    s = parts(s, "IG5-PLANTING", { plus: 8 }, env);
    s = parts(s, "IG5-PLANTING", { plus: 9 }, env);
    s = parts(s, "IG5-PLANTING", { minus: 5, ten: 3 }, env);
    equal(s.missions![GARDEN].steps["IG5-PLANTING"].outcome !== "independent", true);
    s = open(leave(s, env), "IG6-PLANTING-EASIER", env);
    s = parts(s, "IG6-PLANTING-EASIER", { small: 6 }, env);
    s = open(leave(s, env), "IG7-READ", env);
    // Reading: two misses → the word is shown (never credited) — and only THEN spoken.
    const intro = said(s);
    ok(!intro.some((l) => /nest/i.test(l.text)));
    s = m(s, { a: "answer-question", step: "IG7-READ", question: "word", value: "Igel" }, env);
    const retry = said(s);
    ok(!retry.some((l) => /nest|igel|topf/i.test(l.text)), "after a miss: the reviewed hint, never the word or an option");
    s = m(s, { a: "answer-question", step: "IG7-READ", question: "word", value: "Topf" }, env);
    deepStrictEqual(said(s).map((l) => l.text).slice(0, 1), ["Das Wort heisst: Nest."]);
    equal(s.missions![GARDEN].steps["IG7-READ"].outcome, "answer_exposed");
    s = open(leave(s, env), "IG8-LISTEN", env);
    ok(!said(s).some((l) => /schnecke|käfer|blatt/i.test(l.text)), "the listening options and sentence are never narrated");
    let refusedAnswer = false;
    try {
      m(s, { a: "answer-question", step: "IG8-LISTEN", question: "show", value: "Schnecke auf dem Blatt" }, env);
    } catch {
      refusedAnswer = true;
    }
    ok(refusedAnswer, "answering before a completed play is refused");
    s = m(s, { a: "support", step: "IG8-LISTEN", kind: "play" }, env);
    let wrongOutcome = false;
    try {
      m(s, { a: "listen-outcome", step: "IG8-LISTEN", outcome: "browser" }, env);
    } catch {
      wrongOutcome = true;
    }
    ok(wrongOutcome, "a narrated visit reports recorded / device-de / failed only");
    s = m(s, { a: "listen-outcome", step: "IG8-LISTEN", outcome: "recorded" }, env);
    s = m(s, { a: "answer-question", step: "IG8-LISTEN", question: "show", value: "Schnecke auf dem Blatt" }, env);
    s = open(leave(s, env), "IG9-CRAFT", env);
    s = m(s, { a: "story-done", step: "IG9-CRAFT" }, env);
    s = open(leave(s, env), "IG10-GARDEN", env);
    const ending = mview(s).active!.ending!;
    equal(ending.success, "Die Stäbe hast du beim ersten Versuch richtig gezählt.");
    equal(ending.next, "Nächstes Mal schauen wir wieder Buchstaben an.", "the easier path replaced the planting item; the reading stays open");
    const ev = missionEvidence(s, v2, "v2")!;
    ok(ev.steps.some((x) => x.id === "IG6-PLANTING-EASIER"), "the easier path is in the parent evidence");
  });
  it("supported letter learning: recorded first, then (only then) the word may be spoken; never independent reading", () => {
    const { upgraded, env } = afterVisit1();
    let s = op(upgraded, { op: "start-visit" }, env);
    for (const [step, action] of [["IG1-HELLO", { a: "story-done", step: "IG1-HELLO" }], ["IG2-PLANT", { a: "decide", step: "IG2-PLANT", option: "flowers" }]] as const) s = m(open(s, step, env), action as MissionAction, env), (s = leave(s, env));
    s = parts(open(s, "IG3-STICKS", env), "IG3-STICKS", { total: 32 }, env);
    s = parts(open(leave(s, env), "IG5-PLANTING", env), "IG5-PLANTING", { plus: 9, minus: 5, ten: 3 }, env);
    s = open(leave(s, env), "IG7-READ", env);
    ok(!said(s).some((l) => /nest|n\. e\. s/i.test(l.text)));
    s = m(s, { a: "support", step: "IG7-READ", kind: "letters" }, env);
    const letters = said(s).map((l) => l.text);
    deepStrictEqual(letters.slice(0, 2), ["N. E. S. T. Nest.", "N, E, S und T zusammen: Nest. Im Nest wohnen kleine Vögel."]);
    s = m(s, { a: "answer-question", step: "IG7-READ", question: "word", value: "Nest" }, env);
    equal(s.missions![GARDEN].steps["IG7-READ"].outcome, "supported");
    equal(said(s)[0].text, NARRATION_UI.readCorrectWithLetters);
  });
  it("stop and resume: leaving keeps every answer; the open question continues; nothing is re-credited", () => {
    const { upgraded, env } = afterVisit1();
    let s = op(upgraded, { op: "start-visit" }, env);
    s = m(open(s, "IG1-HELLO", env), { a: "story-done", step: "IG1-HELLO" }, env);
    s = m(open(leave(s, env), "IG2-PLANT", env), { a: "decide", step: "IG2-PLANT", option: "flowers" }, env);
    s = open(leave(s, env), "IG3-STICKS", env);
    s = parts(s, "IG3-STICKS", { total: 30 }, env);
    const before = JSON.stringify(s.missions![GARDEN].steps["IG3-STICKS"].attempts);
    const resumed = op(s, { op: "start-visit" }, env);
    equal(JSON.stringify(resumed.missions![GARDEN].steps["IG3-STICKS"].attempts), before);
    equal(mview(resumed).active?.id, "IG3-STICKS");
    equal(said(resumed)[0].text, "Noch nicht. Schau: In jedem Bündel sind 10 Stäbe.", "after a reload the current feedback is what «Vorlesen» says");
  });
});

describe("narration is scoped to narrated missions (I2-07): Santiago and Visit 1 unchanged", () => {
  it("no narration script or catalogue for Santiago's content or Visit 1", () => {
    deepStrictEqual(narrationCatalog(santiago), []);
    deepStrictEqual(narrationCatalog(v1), []);
    const env = makeEnv(v1);
    let s = op(newMissionState(v1, "isabel", "2026-10-28T16:34:00.000Z"), { op: "start-visit" }, env);
    s = open(s, "W1-HELLO", env);
    equal(missionNarration(buildMissionView(s, v1, "v1")!), null);
    equal(missionDefFor(v1, "v1")!.narration, undefined);
  });
  it("line ids are stable and text-bound", () => {
    equal(narrationId("Hallo  Isabel! "), narrationId("Hallo Isabel!"));
    ok(narrationId("Hallo Isabel!") !== narrationId("Hallo Isabel."));
    ok(/^n[0-9a-f]{28}$/.test(narrationId("x")));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The player (I2-04 / I2-06) — fakes only, nothing audible
// ---------------------------------------------------------------------------------------------------------------------

type FakeU = { text: string; lang: string; rate: number; voice?: unknown; onend: (() => void) | null; onerror: ((e?: { error?: string }) => void) | null };
function fakes(opts: { voices?: VoiceLike[]; clips?: Record<string, boolean>; clipDelay?: number; playRejects?: string | null; speechEnds?: boolean } = {}) {
  const spoken: { text: string; voice: string | null; lang: string }[] = [];
  const played: string[] = [];
  const revoked: string[] = [];
  let cancelled = 0;
  let pending: FakeU | null = null;
  const synth = {
    getVoices: () => opts.voices ?? [{ name: "Samantha", lang: "en-US", default: true }, { name: "Anna", lang: "de-DE" }],
    cancel: () => {
      cancelled += 1;
      const u = pending;
      pending = null;
      u?.onerror?.({ error: "interrupted" });
    },
    speak: (u: FakeU) => {
      spoken.push({ text: u.text, voice: (u.voice as VoiceLike | undefined)?.name ?? null, lang: u.lang });
      pending = u;
      if (opts.speechEnds !== false) queueMicrotask(() => { if (pending === u) { pending = null; u.onend?.(); } });
    },
  };
  let audioEl: { src: string; play: () => Promise<void>; pause: () => void; onended: (() => void) | null; onerror: (() => void) | null } | null = null;
  const timers: (() => void)[] = [];
  const player = createNarrationPlayer({
    fetchClip: async (l) => {
      if (opts.clipDelay) await new Promise((r) => setTimeout(r, opts.clipDelay));
      return opts.clips?.[l.text] ? new Blob(["mp3"], { type: "audio/mpeg" }) : null;
    },
    createAudio: () => (audioEl = {
      src: "",
      play() {
        if (this.src.startsWith("blob:")) {
          played.push(this.src);
          if (opts.playRejects) return Promise.reject(Object.assign(new Error("x"), { name: opts.playRejects }));
          queueMicrotask(() => this.onended?.());
        }
        return Promise.resolve();
      },
      pause() {},
      onended: null,
      onerror: null,
    }),
    createObjectUrl: () => `blob:${played.length + revoked.length + 1}`,
    revokeObjectUrl: (u) => revoked.push(u),
    synth: synth as never,
    makeUtterance: (text) => ({ text, lang: "", rate: 1, onend: null, onerror: null }) as FakeU,
    setTimer: (fn) => { timers.push(fn); return timers.length; },
    clearTimer: () => {},
  });
  return { player, spoken, played, revoked, cancelledCount: () => cancelled, audio: () => audioEl, fireTimers: () => timers.splice(0).forEach((f) => f()) };
}
const script = (key: string, ...texts: string[]) => ({ key, lines: texts.map((t) => line(t)) });

describe("narration player — fakes only", () => {
  it("speaks nothing before the deliberate tap; after unlock it plays the script once", async () => {
    const f = fakes();
    equal(await f.player.play(script("a", "Hallo Isabel!")), "locked");
    equal(f.spoken.length, 0);
    f.player.unlock();
    equal(await f.player.play(script("a", "Hallo Isabel!", "Komm mit.")), "done");
    deepStrictEqual(f.spoken.map((x) => [x.text, x.voice]), [["Hallo Isabel!", "Anna"], ["Komm mit.", "Anna"]]);
  });
  it("prefers the prerecorded clip; revokes every object URL", async () => {
    const f = fakes({ clips: { "Hallo Isabel!": true } });
    f.player.unlock();
    equal(await f.player.play(script("a", "Hallo Isabel!", "Komm mit.")), "done");
    equal(f.played.length, 1);
    deepStrictEqual(f.spoken.map((x) => x.text), ["Komm mit."]);
    deepStrictEqual(f.revoked, f.played);
    equal(f.player.lastLineOutcome(), "device-de");
  });
  it("never falls back to an English or default voice: no German voice = nothing spoken, status «unavailable»", async () => {
    const f = fakes({ voices: [{ name: "Samantha", lang: "en-US", default: true }, { name: "Daniel", lang: "en-GB" }] });
    f.player.unlock();
    equal(await f.player.play(script("a", "Hallo Isabel!")), "unavailable");
    equal(f.spoken.length, 0);
    equal(f.player.status(), "unavailable");
  });
  it("a refused play (autoplay after reload) is «blocked» — one tap unlocks and replays", async () => {
    const f = fakes({ clips: { "Hallo Isabel!": true }, playRejects: "NotAllowedError" });
    f.player.unlock();
    equal(await f.player.play(script("a", "Hallo Isabel!")), "blocked");
    equal(f.player.status(), "blocked");
  });
  it("a new screen supersedes the old one at once: late audio of the old screen is never spoken (no overlap)", async () => {
    const f = fakes({ clipDelay: 5 });
    f.player.unlock();
    const first = f.player.play(script("a", "Alter Satz."));
    const second = f.player.play(script("b", "Neuer Satz."));
    equal(await first, "cancelled");
    equal(await second, "done");
    deepStrictEqual(f.spoken.map((x) => x.text), ["Neuer Satz."]);
  });
  it("stop silences the current line and never advances anything", async () => {
    const f = fakes({ speechEnds: false });
    f.player.unlock();
    const p = f.player.play(script("a", "Eins.", "Zwei."));
    await new Promise((r) => setTimeout(r, 0));
    f.player.stop();
    equal(await p, "cancelled");
    deepStrictEqual(f.spoken.map((x) => x.text), ["Eins."]);
    equal(f.player.status(), "idle");
  });
  it("a device that never reports the end does not hang the screen (bounded timer)", async () => {
    const f = fakes({ speechEnds: false });
    f.player.unlock();
    const p = f.player.play(script("a", "Eins."));
    await new Promise((r) => setTimeout(r, 0));
    f.fireTimers();
    equal(await p, "done");
  });
  it("picks a real German voice, never a novelty voice", () => {
    equal(pickGermanVoice([{ name: "Eddy (Deutsch (Deutschland))", lang: "de-DE" }, { name: "Anna", lang: "de-DE" }])?.name, "Anna");
    equal(pickGermanVoice([{ name: "Anna", lang: "de-DE" }, { name: "Google Deutsch", lang: "de-DE" }])?.name, "Google Deutsch");
    equal(pickGermanVoice([{ name: "Grandma (Deutsch (Deutschland))", lang: "de-DE" }]), null);
    equal(pickGermanVoice([{ name: "Samantha", lang: "en-US" }]), null);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Prerecording (I2-06) — mocked provider and store only; no request leaves the test
// ---------------------------------------------------------------------------------------------------------------------

describe("prerecorded narration — readiness and the owner's capped preparation (mocked)", () => {
  const catalog = narrationCatalog(v2);
  const chars = catalog.reduce((n, l) => n + l.text.length, 0);
  it("the catalogue is finite, reviewed and small; its character count is the cost basis", () => {
    ok(catalog.length > 50 && catalog.length < 200, `lines: ${catalog.length}`);
    ok(chars > 2000 && chars < 12000, `characters: ${chars}`);
    ok(catalog.every((l) => !/ß/.test(l.text)));
    ok(!catalog.some((l) => /Santiago|Nokt/.test(l.text)));
  });
  it("without a configured narration voice nothing is called and nothing is written", async () => {
    let calls = 0;
    const r = await prepareNarration(catalog, 99999, { env: { ELEVENLABS_NARRATION_API_KEY: "k", BLOB_READ_WRITE_TOKEN: "t" }, fetchImpl: (async () => { calls += 1; return new Response(); }) as typeof fetch, headImpl: (async () => { throw new Error("none"); }) as never, putImpl: (async () => { calls += 1; }) as never });
    equal(r.status, "not-configured");
    equal(calls, 0);
  });
  /** An in-memory store with the semantics prepare relies on (put without overwrite fails when the path exists). */
  function fakeStore(initial: string[] = [], lockAgeMs: number | null = null) {
    const stored = new Map<string, number>(initial.map((p) => [p, Date.now()]));
    const sent: { url: string; body: { text: string; model_id: string } }[] = [];
    return {
      stored,
      sent,
      lockAt: (_voice?: string) => "family-narration/prepare.lock",
      seedLock(_voice?: string) {
        stored.set("family-narration/prepare.lock", Date.now() - (lockAgeMs ?? 0));
      },
      deps(env: Record<string, string>, fetchOk: (n: number) => boolean | "throw" = () => true) {
        return {
          env,
          now: () => Date.now(),
          headImpl: (async (p: string) => { if (!stored.has(p)) throw new Error("not found"); return { uploadedAt: new Date(stored.get(p)!) }; }) as never,
          putImpl: (async (p: string, _b: unknown, o: { allowOverwrite?: boolean }) => { if (o.allowOverwrite === false && stored.has(p)) throw new Error("exists"); stored.set(p, Date.now()); return {}; }) as never,
          delImpl: (async (p: string) => { stored.delete(p); }) as never,
          listImpl: (async ({ prefix }: { prefix: string }) => ({ blobs: [...stored.keys()].filter((k) => k.startsWith(prefix)).map((pathname) => ({ pathname })), hasMore: false })) as never,
          fetchImpl: (async (url: string, init: RequestInit) => { sent.push({ url, body: JSON.parse(String(init.body)) }); const v = fetchOk(sent.length); if (v === "throw") throw new Error("network"); return v ? new Response(new Uint8Array([1, 2, 3])) : new Response("no", { status: 401 }); }) as unknown as typeof fetch,
        };
      },
    };
  }
  const ENV = { ELEVENLABS_NARRATION_API_KEY: "k", BLOB_READ_WRITE_TOKEN: "t", ELEVENLABS_VOICE_DE_FEMALE_ID: "VoiceAbc12345", FAMILY_NARRATION_BUDGET: "test-approval:99999" };
  it("records only missing catalogued lines, with the configured voice, within the character cap", async () => {
    const st = fakeStore([clipPathname("VoiceAbc12345", catalog[0].id)]);
    equal((await narrationReadiness(catalog, st.deps(ENV))).recorded, 1);
    const cap = catalog[1].text.length + catalog[2].text.length;
    const r = await prepareNarration(catalog, cap, st.deps(ENV));
    equal(r.status, "cap-reached");
    equal(r.recorded, 2);
    ok(st.sent.every((x) => x.url.includes("/v1/text-to-speech/VoiceAbc12345") && x.body.model_id === "eleven_multilingual_v2"));
    ok(st.sent.every((x) => catalog.some((l) => l.text === x.body.text)), "only reviewed catalogue text is sent");
    ok(!JSON.stringify(r).includes(catalog[1].text), "the result carries counts, not texts");
    ok(!st.stored.has(st.lockAt("VoiceAbc12345")), "the lock is released");
  });
  it("a failure stops at once (no retry); the next run resumes with exactly the missing lines — nothing is paid twice", async () => {
    const st = fakeStore();
    const first = await prepareNarration(catalog, 99999, st.deps(ENV, (n) => n <= 5));
    equal(first.status, "upstream-failed");
    equal(first.recorded, 5);
    equal(st.sent.length, 6, "five recorded, the sixth failed, nothing after it");
    const second = await prepareNarration(catalog, 99999, st.deps(ENV));
    equal(second.status, "prepared");
    equal(second.recorded, catalog.length - 5);
    const texts = st.sent.map((x) => x.body.text);
    equal(new Set(texts.slice(0, 5)).size + texts.slice(6).length, catalog.length, "each line synthesised once (plus the one failed request)");
    equal((await narrationReadiness(catalog, st.deps(ENV))).missing, 0);
    const third = await prepareNarration(catalog, 99999, st.deps(ENV));
    equal(third.recorded, 0);
    equal(st.sent.length, catalog.length + 1, "a repeated run sends nothing");
  });
  it("two runs at once: the second is refused («busy») and sends nothing; a stale lock (crashed run) is taken over", async () => {
    const st = fakeStore();
    const [a, b] = await Promise.all([prepareNarration(catalog, 99999, st.deps(ENV)), prepareNarration(catalog, 99999, st.deps(ENV))]);
    deepStrictEqual([a.status, b.status].sort(), ["busy", "prepared"]);
    equal(st.sent.length, catalog.length, "no line was synthesised twice");
    const live = fakeStore([], 60_000);
    live.seedLock("VoiceAbc12345");
    equal((await prepareNarration(catalog, 99999, live.deps(ENV))).status, "busy");
    equal(live.sent.length, 0);
    const stale = fakeStore([], 20 * 60_000);
    stale.seedLock("VoiceAbc12345");
    equal((await prepareNarration(catalog, 99999, stale.deps(ENV))).status, "prepared");
  });
  it("recording uses its own key: the app's shared ELEVENLABS_API_KEY alone never records (and is never needed for it)", async () => {
    const st = fakeStore();
    const { ELEVENLABS_NARRATION_API_KEY: _k, ...shared } = ENV;
    const r = await prepareNarration(catalog, 99999, st.deps({ ...shared, ELEVENLABS_API_KEY: "shared" }));
    equal(r.status, "not-configured");
    equal(st.sent.length, 0);
    equal((await narrationReadiness(catalog, st.deps({ ...shared, ELEVENLABS_API_KEY: "shared" }))).providerKeyConfigured, false);
  });
  it("no owner budget, no request: without FAMILY_NARRATION_BUDGET nothing is sent and nothing is written", async () => {
    const st = fakeStore();
    const { FAMILY_NARRATION_BUDGET: _b, ...noBudget } = ENV;
    const r = await prepareNarration(catalog, 99999, st.deps(noBudget));
    equal(r.status, "no-budget");
    equal(st.sent.length, 0);
    equal(st.stored.size, 0);
    equal(narrationBudget({ FAMILY_NARRATION_BUDGET: "Owner Approval:6000" }), null, "a malformed budget is no budget");
    equal(narrationBudget({ FAMILY_NARRATION_BUDGET: "owner-20261029-1205:6000" })?.characters, 6000);
  });
  it("the owner budget holds across runs and counts every attempt — failed and unanswered requests included", async () => {
    const limit = catalog.slice(0, 12).reduce((n, l) => n + l.text.length, 0);
    const env = { ...ENV, FAMILY_NARRATION_BUDGET: `test-approval:${limit}` };
    const st = fakeStore();
    const frozen = { ...st.deps(env), now: () => 1_793_000_000_000 };
    equal((await prepareNarration(catalog.slice(0, 1), 99999, { ...frozen, fetchImpl: (async () => new Response("no", { status: 500 })) as unknown as typeof fetch })).status, "upstream-failed");
    equal((await prepareNarration(catalog.slice(0, 1), 99999, { ...frozen, fetchImpl: (async () => new Response("no", { status: 500 })) as unknown as typeof fetch })).status, "upstream-failed", "a retry in the same millisecond is reserved again (unique ledger entry), not refused");
    equal((await budgetSpent("test-approval", "t", st.deps(env)))?.requests, 2);
    for (const k of [...st.stored.keys()]) if (k.includes("/budget/")) st.stored.delete(k);
    const first = await prepareNarration(catalog, 99999, st.deps(env, (n) => (n === 4 ? false : true)));
    equal(first.status, "upstream-failed");
    equal(first.budget?.requests, 4, "the failed request is counted");
    const second = await prepareNarration(catalog, 99999, st.deps(env, (n) => (n === 8 ? "throw" : true)));
    equal(second.status, "upstream-failed");
    equal(second.failedStatus, 0, "no answer: reported, counted, stopped");
    const third = await prepareNarration(catalog, 99999, st.deps(env));
    equal(third.status, "budget-reached");
    const spent = await budgetSpent("test-approval", "t", st.deps(env));
    equal(spent?.requests, st.sent.length, "the ledger has one entry per request ever sent");
    equal(spent?.characters, st.sent.reduce((n, x) => n + x.body.text.length, 0), "and its characters are exactly what was sent");
    ok(spent!.characters <= limit, `never above the budget: ${spent!.characters} ≤ ${limit}`);
    const other = await budgetSpent("another-approval", "t", st.deps(env));
    equal(other?.characters, 0, "a different approval starts its own total");
  });
  it("an unreadable or unwritable ledger sends nothing", async () => {
    const st = fakeStore();
    const deps = { ...st.deps(ENV), listImpl: (async () => { throw new Error("store down"); }) as never };
    equal((await prepareNarration(catalog, 99999, deps)).status, "budget-unavailable");
    equal(st.sent.length, 0);
    const st2 = fakeStore();
    const d2 = st2.deps(ENV);
    const putClip = d2.putImpl as unknown as (p: string, b: unknown, o: { allowOverwrite?: boolean }) => Promise<unknown>;
    const deps2 = { ...d2, putImpl: (async (p: string, b: unknown, o: { allowOverwrite?: boolean }) => { if (p.includes("/budget/")) throw new Error("no write"); return putClip(p, b, o); }) as never };
    equal((await prepareNarration(catalog, 99999, deps2)).status, "budget-unavailable");
    equal(st2.sent.length, 0);
  });
  it("the ledger and the clips carry no text and no name: a line id and a character count only", async () => {
    const st = fakeStore();
    await prepareNarration(catalog.slice(0, 3), 99999, st.deps(ENV));
    const ledger = [...st.stored.keys()].filter((k) => k.includes("/budget/"));
    equal(ledger.length, 3);
    ok(ledger.every((k) => /^family-narration\/budget\/test-approval\/\d{14}-[0-9a-f]{8}-n[0-9a-f]{28}-\d+\.txt$/.test(k)), ledger.join(" "));
  });
  it("a line naming a child is never sent to the provider or stored in the public store; the rest is still prepared", async () => {
    const st = fakeStore();
    const r = await prepareNarration([...catalog, line("Hallo Isabel!", "de-female")], 99999, st.deps(ENV));
    equal(r.status, "prepared");
    equal(r.personalSkipped, 1);
    ok(!st.sent.some((x) => /Isabel/.test(x.body.text)));
    equal(st.sent.length, catalog.length);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Coverage (pre-release review, 2026-10-29): every line any branch can speak is in the catalogue, and every catalogue line is
// reachable — so the prerecording is complete AND minimal. Seeded random walks through the real engine.
// ---------------------------------------------------------------------------------------------------------------------
import { closingLines, farewellLines } from "./family-learning-narration.ts";
import { isPublicSafeScript } from "./family-narration-store.ts";

function rng(seed: number) {
  let x = seed * 2654435761 >>> 0 || 1;
  return () => ((x = (x ^ (x << 13)) >>> 0, x = (x ^ (x >>> 17)) >>> 0, x = (x ^ (x << 5)) >>> 0) % 10000) / 10000;
}
function walk(seed: number, spoken: Map<string, string>) {
  const r = rng(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const { upgraded, env } = afterVisit1();
  let s = op(upgraded, { op: "start-visit" }, env);
  const tryM = (a: MissionAction) => {
    try {
      s = m(s, a, env);
      return true;
    } catch {
      return false;
    }
  };
  const hear = () => {
    const v = mview(s);
    const parts = v.active?.solve?.parts ?? [];
    for (const seen of [[], parts.filter((p) => p.status !== "open").map((p) => p.id)]) for (const l of missionNarration(v, seen)?.lines ?? []) spoken.set(l.id, l.text);
  };
  for (let i = 0; i < 160; i += 1) {
    const v = mview(s);
    const a = v.active;
    if (!a) {
      const next = v.steps.find((x) => x.status === "available" || x.status === "active");
      if (next) tryM({ a: "open", step: next.id });
      else {
        tryM({ a: "finish" });
        break;
      }
      hear();
      continue;
    }
    if (a.status !== "active") {
      hear();
      tryM({ a: "leave" });
      continue;
    }
    if (a.kind === "story" || a.kind === "outcome") tryM({ a: "story-done", step: a.id });
    else if (a.kind === "craft") {
      if (r() < 0.5) tryM({ a: "craft-found", step: a.id, items: a.craft!.find!.options.slice(0, 1 + Math.floor(r() * 3)).map((o) => o.id) });
      tryM({ a: "story-done", step: a.id });
    } else if (a.kind === "decide") tryM({ a: "decide", step: a.id, option: pick(a.decide!.options).id });
    else if (a.kind === "solve") {
      const p = a.solve!.parts.find((x) => x.status === "open");
      const def = missionDefFor(v2, "v2")!.steps.find((x) => x.id === a.id)!.solve!.parts.find((x) => x.id === p?.id);
      if (!p || !def) {
        tryM({ a: "leave" });
      } else {
        const pendingHint = p.hints.find((h) => h.check && h.check.result === null);
        const choice = r();
        if (pendingHint && choice < 0.6) tryM({ a: "hint-check", step: a.id, part: p.id, hint: pendingHint.id, value: r() < 0.5 ? String((def.hints.find((h) => h.id === pendingHint.id)?.check?.answer) ?? "0") : "1" });
        else if (p.phase === "taught") tryM(choice < 0.4 ? { a: "practice-part", step: a.id, part: p.id, value: String(def.answer) } : choice < 0.8 ? { a: "practice-part", step: a.id, part: p.id, value: String(def.answer + 1 + Math.floor(r() * 5)) } : { a: "later-part", step: a.id, part: p.id });
        else if (choice < 0.35) tryM({ a: "answer-part", step: a.id, part: p.id, value: String(def.answer) });
        else if (choice < 0.65) tryM({ a: "answer-part", step: a.id, part: p.id, value: String(r() < 0.3 && p.lastWrong !== null ? p.lastWrong : def.answer + 1 + Math.floor(r() * 7)) });
        else if (choice < 0.8) tryM({ a: "hint", step: a.id, part: p.id });
        else tryM({ a: "show-solution", step: a.id, part: p.id });
      }
    } else if (a.kind === "read") {
      const q = a.questions[0];
      const c = r();
      if (c < 0.25) tryM({ a: "support", step: a.id, kind: "letters" });
      else tryM({ a: "answer-question", step: a.id, question: q.id, value: c < 0.6 ? String(missionDefFor(v2, "v2")!.steps.find((x) => x.id === a.id)!.questions![0].answer) : pick((q.options ?? []).slice(1)) });
    } else if (a.kind === "listen") {
      const q = a.questions[0];
      const c = r();
      if (c < 0.3) {
        tryM({ a: "support", step: a.id, kind: "play" });
        tryM({ a: "listen-outcome", step: a.id, outcome: pick(["recorded", "device-de", "failed"] as const) });
      } else if (c < 0.4) tryM({ a: "support", step: a.id, kind: "transcript" });
      else tryM({ a: "answer-question", step: a.id, question: q.id, value: c < 0.7 ? "Schnecke auf dem Blatt" : pick(["Schnecke unter dem Blatt", "Käfer auf dem Blatt"]) });
    }
    hear();
  }
  return s;
}

describe("narration catalogue coverage — complete and minimal (pre-release review)", () => {
  const catalog = narrationCatalog(v2);
  const ids = new Set(catalog.map((l) => l.id));
  const spoken = new Map<string, string>();
  let finished = 0;
  for (let seed = 1; seed <= 600; seed += 1) if (walk(seed, spoken).missions![GARDEN].finishedAt) finished += 1;
  // The closing screens and the goodbye use the same functions as the screens.
  const src = { reflection: v2.reflection, adventure: v2.missions!.find((x) => x.id === GARDEN)!.nextAdventure ?? null } as never;
  for (const k of ["difficulty", "enjoyment", "next"] as const) for (const t of closingLines(k, src)) spoken.set(line(t).id, line(t).text);
  for (const t of farewellLines(v2, v2.missions!.find((x) => x.id === GARDEN)!)) spoken.set(line(t).id, line(t).text);
  // The listening sentence is spoken by the ear button (recorded play), not by the screen script.
  const listenBody = v2.missions!.find((x) => x.id === GARDEN)!.steps.find((x) => x.kind === "listen")!.text!.body;
  spoken.set(line(listenBody).id, listenBody);
  it("many walks reach the end", () => ok(finished > 300, `finished ${finished}/600`));
  it("every spoken line of every branch is catalogued (prerecordable)", () => {
    const missing = [...spoken].filter(([id]) => !ids.has(id)).map(([, t]) => t);
    deepStrictEqual(missing, []);
  });
  it("every catalogued line is actually spoken somewhere (nothing recorded for nothing)", () => {
    const unused = catalog.filter((l) => !spoken.has(l.id)).map((l) => `${l.where?.join("/")}: ${l.text}`);
    deepStrictEqual(unused, []);
  });
  it("the listening stimulus and the supported letters/word are catalogued (recorded audio, not the old live route)", () => {
    ok(ids.has(line("Zeig mir die Schnecke auf dem Blatt.").id));
    ok(ids.has(line("N. E. S. T. Nest.").id) && ids.has(line("N, E, S und T zusammen: Nest. Im Nest wohnen kleine Vögel.").id));
  });
  it("every catalogue line is a fixed public-safe script (no child name; public store)", () => {
    deepStrictEqual(catalog.filter((l) => !isPublicSafeScript(l.text)).map((l) => l.text), []);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Six-slot story voice registry (owner direction 2026-10-29 09:34) — fakes only
// ---------------------------------------------------------------------------------------------------------------------
import { ASSISTANT_IDENTITIES, resolveSlotVoiceId, slotFitsCharacter, VOICE_SLOTS, VOICE_SLOT_INFO } from "./family-voice-registry.ts";
import { parseChildTtsRequest, resolveSpeechVoiceId } from "./family-tts.ts";
import { pickNativeVoice } from "./family-narration-player.ts";
import { readNarrationClip } from "./family-narration-store.ts";

describe("six-slot story voice registry", () => {
  it("has exactly de/es/en × female/male, each with its own server-only env name and the owner's variety", () => {
    deepStrictEqual([...VOICE_SLOTS], ["de-female", "de-male", "es-female", "es-male", "en-female", "en-male"]);
    equal(new Set(VOICE_SLOTS.map((x) => VOICE_SLOT_INFO[x].env)).size, 6);
    deepStrictEqual(VOICE_SLOTS.map((x) => VOICE_SLOT_INFO[x].dialect.decided), ["Standard German", "Standard German", "Mexican Spanish", "Mexican Spanish", "American English", "American English"]);
  });
  it("resolves a slot only from its own env and never interpolates a malformed id", () => {
    equal(resolveSlotVoiceId("es-female", { ELEVENLABS_VOICE_ES_FEMALE_ID: "Abc12345xyz" }), "Abc12345xyz");
    equal(resolveSlotVoiceId("es-female", { ELEVENLABS_VOICE_ES_MALE_ID: "Abc12345xyz" }), null);
    equal(resolveSlotVoiceId("de-female", { ELEVENLABS_VOICE_DE_FEMALE_ID: "../evil" }), null);
  });
  it("assistants are not story characters; a character's slot must be of its own language", () => {
    deepStrictEqual(ASSISTANT_IDENTITIES.map((a) => a.id), ["nokt", "lila"]);
    ok(slotFitsCharacter("de-female", "de") && !slotFitsCharacter("en-female", "de") && !slotFitsCharacter("nokt", "de"));
    const nokt = structuredClone(rawV2);
    nokt.missions[1].characters[0] = { ...nokt.missions[1].characters[0], id: "nokt", name: "Nokt" };
    ok(reconcileIsabelContent(nokt).problems.some((p) => /assistant identity is never a story character/.test(p)));
    const wrong = structuredClone(rawV2);
    wrong.missions[1].characters[0].voice = "en-female";
    ok(reconcileIsabelContent(wrong).problems.some((p) => /voice slot of its own language/.test(p)));
    const v1voice = structuredClone(rawV1);
    v1voice.missions[0].characters[0].voice = "de-female";
    ok(reconcileIsabelContent(v1voice).problems.some((p) => /Visit 1 stays exactly as released/.test(p)), "Visit 1 is not re-voiced");
  });
  it("Visit 2's gardener speaks with the de-female slot: every catalogued and spoken line carries it", () => {
    ok(narrationCatalog(v2).every((l) => l.slot === "de-female"));
    const { upgraded, env } = afterVisit1();
    const s = open(op(upgraded, { op: "start-visit" }, env), "IG1-HELLO", env);
    ok(said(s).every((l) => l.slot === "de-female"));
  });
  it("a clip is read with its slot's voice only; an unconfigured or unknown slot has none", async () => {
    let asked = "";
    const deps = { env: { BLOB_READ_WRITE_TOKEN: "t", ELEVENLABS_VOICE_DE_FEMALE_ID: "VoiceAbc12345" }, getImpl: (async (p: string) => { asked = p; return null; }) as never };
    await readNarrationClip("de-female", narrationCatalog(v2)[0].id, deps);
    equal(asked, clipPathname("VoiceAbc12345", narrationCatalog(v2)[0].id));
    equal(await readNarrationClip("de-male", narrationCatalog(v2)[0].id, deps), null);
    equal(await readNarrationClip("xx-female", narrationCatalog(v2)[0].id, deps), null);
  });
  it("preparation records only lines whose slot has a voice; other slots are reported, never filled with another voice", async () => {
    const r = await narrationReadiness(narrationCatalog(v2), { env: { BLOB_READ_WRITE_TOKEN: "t", ELEVENLABS_VOICE_DE_MALE_ID: "VoiceMale12345" }, headImpl: (async () => { throw new Error("none"); }) as never });
    deepStrictEqual(r.slots.map((x) => [x.slot, x.configured]), [["de-female", false]]);
    let calls = 0;
    const p = await prepareNarration(narrationCatalog(v2), 99999, { env: { ELEVENLABS_NARRATION_API_KEY: "k", BLOB_READ_WRITE_TOKEN: "t", ELEVENLABS_VOICE_DE_MALE_ID: "VoiceMale12345" }, fetchImpl: (async () => { calls += 1; return new Response(); }) as unknown as typeof fetch, headImpl: (async () => { throw new Error("none"); }) as never, putImpl: (async () => ({})) as never, delImpl: (async () => {}) as never });
    equal(p.status, "not-configured");
    equal(calls, 0);
  });
  it("the shared live speech route: a slot picks only that slot's native voice; without a slot routing is exactly as before (Santiago, Nokt)", () => {
    const env = { ELEVENLABS_VOICE_ES_FEMALE_ID: "EsFemale1234", ELEVENLABS_VOICE_ES_ID: "LegacyEs1234", ELEVENLABS_NOKT_DE_VOICE_ID: "Nokt12345678" };
    equal(resolveSpeechVoiceId({ childId: "santiago", language: "es", speaker: "character", slot: "es-female" }, env), "EsFemale1234");
    equal(resolveSpeechVoiceId({ childId: "santiago", language: "es", speaker: "character" }, env), "LegacyEs1234", "no slot → the earlier language voice");
    equal(resolveSpeechVoiceId({ childId: "santiago", language: "de", speaker: "nokt" }, env), "Nokt12345678", "Nokt keeps its own voice");
    equal(resolveSpeechVoiceId({ childId: "santiago", language: "de", speaker: "character", slot: "es-female" }, env), null, "a slot of another language is refused");
    ok(!parseChildTtsRequest({ childId: "isabel", text: "x", speaker: "nokt", slot: "de-female" }).ok, "the tutor never takes a story slot");
    ok(!parseChildTtsRequest({ childId: "isabel", text: "x", speaker: "character", slot: "fr-female" }).ok);
    ok(parseChildTtsRequest({ childId: "isabel", text: "x", language: "de", speaker: "character", slot: "de-male" }).ok);
  });
  it("device fallback is native per language — never another language's default", () => {
    const voices = [{ name: "Samantha", lang: "en-US", default: true }, { name: "Anna", lang: "de-DE" }, { name: "Mónica", lang: "es-ES" }, { name: "Daniel", lang: "en-GB" }];
    equal(pickNativeVoice(voices, "es")?.name, "Mónica");
    equal(pickNativeVoice(voices, "de")?.name, "Anna");
    equal(pickNativeVoice(voices.filter((v) => !v.lang.startsWith("es")), "es"), null);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Both children's story voices (owner «Proceed with implementation», 2026-10-29) — fakes only
// ---------------------------------------------------------------------------------------------------------------------
import { characterGender, configuredSlots, slotFor } from "./family-voice-registry.ts";
import { storyCatalog, catalogCharacters, catalogKey, spokenText, storyLine } from "./family-learning-narration.ts";

describe("story voices for both children", () => {
  const sCat = storyCatalog(santiago, "santiago");
  it("Santiago: exactly the lines his scenes speak today, in the slot of the line's language × the character's gender", () => {
    equal(sCat.length, 9);
    equal(catalogCharacters(sCat), 552, "572 displayed characters; the three name lines are spoken 20 characters shorter");
    deepStrictEqual([...new Set(sCat.map((l) => l.slot))].sort(), ["en-female", "es-female"]);
    ok(sCat.filter((l) => l.slot === "es-female").every((l) => /[¡¿]|Aquí|Gracias|Hola|cuerdas/.test(l.text)), "Rosa's Spanish → es-female");
    ok(sCat.some((l) => l.slot === "en-female" && /June/.test(l.text)), "June's English → en-female");
    ok(!sCat.some((l) => (l.slot ?? "").startsWith("de-")), "his German bubble lines are read, not spoken — not recorded");
  });
  it("a character keeps her identity across languages; only the voice of the line's language changes (Rosa)", () => {
    const rosa = { id: "rosa" };
    equal(slotFor(characterGender("santiago-expedition", rosa), "es"), "es-female");
    equal(slotFor(characterGender("santiago-expedition", rosa), "de"), "de-female", "her German instruction: a German voice, never the Spanish one");
    equal(slotFor(characterGender("santiago-expedition", { id: "planner" }), "de"), "de-male");
    equal(slotFor(characterGender("santiago-expedition", { id: "nokt" }), "de"), null, "an assistant never gets a story voice");
    equal(slotFor(characterGender("isabel-workshop", { id: "lila" }), "de"), null, "Old Lila neither");
  });
  it("the combined catalogue keeps Isabel's 4,731 characters apart from Santiago's increment", () => {
    equal(catalogCharacters(narrationCatalog(v2)), 4731);
    equal(catalogCharacters(narrationCatalog(v2)) + catalogCharacters(sCat), 5283);
  });
  // Owner decision 2026-10-29 12:05: recordings never say his name; the screen keeps it.
  const NAMED = ["¡Hola, Santi!", "¡Gracias, Santi! Hasta pronto.", "Hello Santi! The new beds are ready. Put the tomatoes next to the door. Put the beans at the back, on the left. Thank you!"];
  /** Every displayed line his scenes speak (the same walk as the catalogue, WITHOUT variants): the source lines to reconcile. */
  function displayedSources() {
    const out = new Map<string, { slot: string; text: string }>();
    for (const m of (santiago.missions ?? []).filter((x) => !(x as { narration?: unknown }).narration)) {
      for (const st of m.steps) {
        const add = (text: string | undefined, speaker: string | null | undefined, language: string | undefined) => {
          if (!text) return;
          const slot = slotFor(characterGender(santiago.contentId, m.characters.find((c) => c.id === speaker) ?? null), language);
          if (slot) out.set(`${slot}|${text}`, { slot, text });
        };
        if (m.presentation === "scene") for (const l of [...(st.intro ?? []), ...(st.done ?? []), ...Object.values(st.doneBy ?? {}).flat()]) if (l && l.language !== "de") add(l.text, l.speaker, l.language);
        if (st.kind === "listen" && st.text) add(st.text.body, st.character, st.text.language);
      }
    }
    return [...out.values()];
  }
  it("reconciliation: every displayed source line maps to exactly one catalogued clip — none omitted, none extra, no name", () => {
    const sources = displayedSources();
    const isabelSources = narrationCatalog(v2);
    equal(sources.length + isabelSources.length, 132, "132 required source lines");
    const keys = new Set(sCat.map((l) => catalogKey(l)));
    const hit = new Map<string, number>();
    for (const src of sources) {
      const clip = storyLine(src.text, src.slot as never);
      ok(keys.has(catalogKey(clip)), `source line has its clip: ${src.slot}`);
      hit.set(catalogKey(clip), (hit.get(catalogKey(clip)) ?? 0) + 1);
      if (clip.text !== src.text) ok(sCat.find((l) => catalogKey(l) === catalogKey(clip))!.sources!.includes(narrationId(src.text)), "the clip names its source line");
    }
    equal(hit.size, sCat.length, "no catalogued clip without a source line");
    equal(sCat.length + isabelSources.length, 132, "132 unique clips (no variant collides with another line)");
    equal(sources.filter((x) => NAMED.includes(x.text)).length, 3, "the three named lines are among the sources");
    deepStrictEqual(sCat.filter((l) => !isPublicSafeScript(l.text)).map((l) => l.text), [], "no catalogued clip says a name");
    ok(!/santi|isabel|eberle/i.test(JSON.stringify(sCat.map((l) => ({ id: l.id, slot: l.slot, text: l.text, sources: l.sources })))), "nor in its id, text or source ids");
    ok(sCat.every((l) => !/santi/i.test(clipPathname("AnaSofia123456", l.id))));
  });
  it("the spoken variants are exact, fixed and meaning-preserving; nothing else is altered", () => {
    deepStrictEqual(NAMED.map((t) => spokenText(t)), ["¡Hola!", "¡Gracias! Hasta pronto.", "Hello! The new beds are ready. Put the tomatoes next to the door. Put the beans at the back, on the left. Thank you!"]);
    equal(spokenText("Thank you, Santi!"), "Thank you, Santi!", "no general stripping: an unlisted line is unchanged (this one is not spoken)");
    equal(spokenText("¡Hola, Santiago!"), "¡Hola, Santiago!");
    for (const sp of [...displayedSources(), ...narrationCatalog(v2)]) if (!NAMED.includes(sp.text)) equal(spokenText(sp.text), sp.text);
    // The listening message keeps everything its question asks about.
    const listen = (santiago.missions ?? []).flatMap((m) => m.steps).find((st) => st.id === "H7-JUNE")!;
    const spoken = spokenText(listen.text!.body);
    for (const w of ["tomatoes", "door", "beans", "back", "left"]) ok(spoken.includes(w), w);
    equal(spoken, listen.text!.body.replace("Hello Santi!", "Hello!"));
    ok(listen.text!.body.includes("Santi"), "the displayed message still greets him");
    // Playback binds to the same clip: the scene's display text resolves to the catalogued variant.
    equal(storyLine(listen.text!.body, "en-female").id, narrationId(spoken));
  });
  it("readiness is a gate: ready only when every needed slot has a voice and every line is recorded; totals per child", async () => {
    const cat = [...narrationCatalog(v2).map((l) => ({ ...l, child: "isabel" as const })), ...sCat];
    const none = await narrationReadiness(cat, { env: { BLOB_READ_WRITE_TOKEN: "t" }, headImpl: (async () => { throw new Error("none"); }) as never });
    equal(none.ready, false);
    deepStrictEqual(none.children.map((c) => [c.child, c.lines, c.characters, c.personal, c.ready]), [["isabel", 123, 4731, 0, false], ["santiago", 9, 552, 0, false]]);
    deepStrictEqual(none.slots.map((x) => x.slot), ["de-female", "es-female", "en-female"]);
    const env = { BLOB_READ_WRITE_TOKEN: "t", ELEVENLABS_VOICE_DE_FEMALE_ID: "Hannah12345678", ELEVENLABS_VOICE_ES_FEMALE_ID: "AnaSofia123456", ELEVENLABS_VOICE_EN_FEMALE_ID: "Jessica1234567" };
    const all = await narrationReadiness(cat, { env, headImpl: (async () => ({ uploadedAt: new Date() })) as never });
    equal(all.ready, true);
    // One missing Santiago clip (e.g. the variant of the listening message): Isabel is ready, Santiago is not.
    const gone = clipPathname("Jessica1234567", storyLine(NAMED[2], "en-female").id);
    const real = await narrationReadiness(cat, { env, headImpl: (async (p: string) => { if (p === gone) throw new Error("none"); return { uploadedAt: new Date() }; }) as never });
    deepStrictEqual(real.children.map((c) => [c.child, c.ready]), [["isabel", true], ["santiago", false]]);
    deepStrictEqual(configuredSlots(env), ["de-female", "es-female", "en-female"]);
  });
  it("a selected voice is never replaced: with the slot configured and no recording, nothing is spoken and the state is «missing»", async () => {
    const spoken: string[] = [];
    const player = createNarrationPlayer({
      fetchClip: async () => null,
      configuredSlots: () => new Set(["es-female"]),
      synth: { getVoices: () => [{ name: "Mónica", lang: "es-ES" }, { name: "Anna", lang: "de-DE" }, { name: "Samantha", lang: "en-US", default: true }], cancel: () => {}, speak: (u: { text: string; onend: (() => void) | null }) => { spoken.push(u.text); queueMicrotask(() => u.onend?.()); } } as never,
      makeUtterance: (text) => ({ text, lang: "", rate: 1, onend: null, onerror: null }) as never,
      setTimer: () => 0,
      clearTimer: () => {},
    });
    player.unlock();
    equal(await player.play({ key: "a", lines: [line("¡Hola, Santi!", "es-female")] }), "missing");
    equal(player.status(), "missing");
    equal(player.lastLineOutcome(), "missing-recording");
    deepStrictEqual(spoken, []);
    equal(await player.play({ key: "b", lines: [line("Hallo!", "de-female")] }), "done", "an unconfigured slot keeps the native device fallback");
    deepStrictEqual(spoken, ["Hallo!"]);
  });
  it("the engine accepts a recorded play for non-narrated missions; the play stays a device report, never help", () => {
    const env2 = makeEnv(v1);
    let t = op(newMissionState(v1, "isabel", "2026-10-28T16:34:00.000Z"), { op: "start-visit" }, env2);
    t = open(t, "W1-HELLO", env2);
    const out = applyLearningOp(t, { op: "mission", action: { a: "line-audio", step: "W1-HELLO", line: 0, outcome: "recorded" } }, env2);
    const ev = out.records.supports.find((x) => x.kind === "mission_line_audio");
    ok(ev, "recorded as a line-audio event");
    equal((ev!.payload as { help: boolean; outcome: string }).help, false);
    equal((ev!.payload as { outcome: string }).outcome, "recorded");
    let refused = false;
    try {
      applyLearningOp(t, { op: "mission", action: { a: "line-audio", step: "W1-HELLO", line: 0, outcome: "nonsense" as never } }, env2);
    } catch {
      refused = true;
    }
    ok(refused);
  });
});

describe("children's story-voice switch", () => {
  it("children hear selected voices only after FAMILY_STORY_VOICES=recorded; the owner can prepare before", async () => {
    const { childStoryVoices } = await import("./family-voice-registry.ts");
    const env = { ELEVENLABS_VOICE_DE_FEMALE_ID: "Hannah12345678" };
    deepStrictEqual(childStoryVoices(env), []);
    deepStrictEqual(childStoryVoices({ ...env, FAMILY_STORY_VOICES: "recorded" }), ["de-female"]);
    deepStrictEqual(childStoryVoices({ ...env, FAMILY_STORY_VOICES: "isabel" }, "isabel"), ["de-female"]);
    deepStrictEqual(childStoryVoices({ ...env, FAMILY_STORY_VOICES: "isabel" }, "santiago"), [], "one child can go live while the other waits");
    deepStrictEqual(configuredSlots(env), ["de-female"]);
  });
});
