// Nov 18 review — the visit flow: no spoken line is skipped, nothing advances before its narration ends, every line plays at
// most once per screen, the cliffhanger plays once, and the narration player never falls back to a device voice for a recorded
// line. Walks every narrated mission of the bundled content through the REAL engine with the scene's own tap rule
// (`narratedBeatTap`) and the screen's own script (`missionNarration`). Fictional states only.

import { describe, it } from "node:test";
import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { asIsabelContent } from "./family-learning-isabel.ts";
import type { LearningContent } from "./family-learning-content.ts";
import { applyLearningOp, buildChildView, currentStage, EMPTY_PARENT_SETTINGS, newMissionState, type LearningOp, type MissionState, type OpEnv, type ParentSettings } from "./family-learning-state.ts";
import { buildMissionView, missionDefFor, type MissionAction, type MissionView } from "./family-learning-mission.ts";
import { farewellLines, farewellScreenLines, missionNarration, narrated, narrationCatalog, normaliseNarration, type NarrationScript } from "./family-learning-narration.ts";
import { narratedBeatTap } from "./family-learning-visit-flow.ts";
import { createNarrationPlayer, GERMAN_PLAYBACK_RATE, lineSafetyMs, playbackRateFor, SPANISH_PLAYBACK_RATE } from "./family-narration-player.ts";
import { learningHomeHref } from "./family-learning-exit.ts";

const dir = new URL("../data/family-learning/content/", import.meta.url);
const isabelFiles = readdirSync(dir).filter((f) => /^isabel-workshop-v\d+\.json$/.test(f)).sort();
const latestIsabel = isabelFiles[isabelFiles.length - 1];
const read = (name: string) => JSON.parse(readFileSync(new URL(name, dir), "utf8"));

type Env = OpEnv & { settings: ParentSettings };
function makeEnv(content: LearningContent): Env {
  let t = Date.UTC(2026, 10, 18, 12, 0, 0);
  let n = 0;
  return { content, settings: { ...EMPTY_PARENT_SETTINGS }, now: () => new Date((t += 5_000)), newId: () => `flow-${(n += 1)}` };
}
const ago = (days: number) => new Date(Date.UTC(2026, 10, 18) - days * 86_400_000).toISOString();

/** A fictional state with every visit before `visit` finished (the shape of `scripts/next-visits-seed.mjs`). */
function stateBefore(content: LearningContent, visit: string): MissionState {
  const s = newMissionState(content, "isabel", ago(60));
  const order = content.visits.map((v) => v.id);
  const before: string[] = order.slice(0, order.indexOf(visit as (typeof order)[number]));
  s.visits = before.map((id, i) => ({ id, startedAt: ago(40 - i * 5), finishedAt: ago(40 - i * 5 - 0.01), stageIndex: 99, skippedStages: [], reflection: "easy" })) as never;
  const missions: Record<string, unknown> = {};
  for (const m of content.missions ?? []) {
    if (!before.includes(m.visit)) continue;
    const at = ago(10);
    const steps = Object.fromEntries(m.steps.map((st) => [st.id, { status: "done", openedAt: at, finishedAt: at, attempts: [], support: [], plays: 0, questions: {}, phase: "answer", outcome: "independent" }]));
    missions[m.id] = { missionId: m.id, version: 1, visit: m.visit, startedAt: at, position: "garden", visited: [], active: null, steps, facts: {}, shownWords: [], typing: null, finishedAt: at };
  }
  s.missions = missions as never;
  return s;
}

function rng(seed: number) {
  let x = (seed * 2654435761) >>> 0 || 1;
  return () => ((x = (x ^ (x << 13)) >>> 0), (x = (x ^ (x >>> 17)) >>> 0), (x = (x ^ (x << 5)) >>> 0), (x % 10000) / 10000);
}

type Screen = { key: string; step: string; status: string; lines: string[] };
type Walk = { screens: Screen[]; violations: string[]; opened: Map<string, string[]>; finished: boolean; heardDone: Set<string> };

/**
 * One visit, tap by tap. After every child action the screen's script is "played to its end" (the child can only tap once
 * «Weiter» is enabled). Every state the scene reaches WITHOUT a new tap (the writes inside one tap and the scene's own
 * open-next) must have nothing to say: a line there would start and be superseded at once — the Nov 18 defect.
 */
function walk(content: LearningContent, visit: string, seed: number | "first-try"): Walk {
  const env = makeEnv(content);
  const def = missionDefFor(content, visit as never)!;
  const r = seed === "first-try" ? () => 0 : rng(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  let s = applyLearningOp(stateBefore(content, visit), { op: "start-visit" } as LearningOp, env).state;
  equal(currentStage(s, content), "mission", `${visit} starts on its mission`);
  const view = (): MissionView => buildMissionView(s, content, visit as never)!;
  const tryM = (a: MissionAction) => {
    try {
      s = applyLearningOp(s, { op: "mission", action: a }, env).state;
      return true;
    } catch {
      return false;
    }
  };
  const out: Walk = { screens: [], violations: [], opened: new Map(), finished: false, heardDone: new Set() };
  let seen: string[] = [];
  let lastKey = "";
  const settle = (_tap: boolean) => {
    const v = view();
    const sc: NarrationScript | null = missionNarration(v, seen);
    if (!sc) return;
    if (sc.key === lastKey) return; // the same screen: nothing new is said (no double play)
    lastKey = sc.key;
    const a = v.active!;
    out.screens.push({ key: sc.key, step: a.id, status: a.status, lines: sc.lines.map((l) => l.text) });
    if (!out.opened.has(a.id)) out.opened.set(a.id, sc.lines.map((l) => l.text));
    if (a.status !== "active") for (const l of sc.lines) out.heardDone.add(`${a.id}|${l.text}`);
  };
  /**
   * A write the scene makes by itself (no new tap): the state it LEAVES must have had nothing to say — a line there would have
   * started with the tap's first write and been superseded by this one before it could be heard.
   */
  const auto = (a: MissionAction) => {
    const v = view();
    const sc = missionNarration(v, seen);
    if (sc) out.violations.push(`${v.active?.id}/${v.active?.status}: «${sc.lines[0]?.text}» superseded by an automatic «${a.a}»`);
    return tryM(a);
  };
  /** The scene's «Weiter»: `narratedBeatTap` (the tap's own write), then the scene's own open-next (automatic). */
  const weiter = () => {
    const v = view();
    const tap = narratedBeatTap(v.active);
    let tapped = false;
    const write = (a: MissionAction) => (tapped ? auto(a) : ((tapped = true), tryM(a)));
    if (tap === "finish-beat") {
      write({ a: "story-done", step: v.active!.id });
      settle(false);
      return;
    }
    if (tap === "leave") write({ a: "leave" });
    seen = [];
    const fresh = view();
    const upcoming = fresh.steps.find((x) => x.status === "available" || x.status === "active") ?? null;
    if (upcoming) {
      write({ a: "open", step: upcoming.id });
      settle(false); // the newly opened beat: its own script starts here (the tap's purpose)
    } else {
      write({ a: "finish" });
      out.finished = true;
    }
  };
  // The scene opens the first beat by itself (nothing was said before it).
  auto({ a: "open", step: def.steps[0].id });
  settle(false);
  for (let i = 0; i < 220 && !out.finished; i += 1) {
    const v = view();
    const a = v.active;
    if (!a || a.status !== "active" || a.kind === "story" || a.kind === "outcome") {
      weiter();
      continue;
    }
    const sd = def.steps.find((x) => x.id === a.id)!;
    if (a.kind === "craft") {
      if (r() < 0.5 && a.craft?.find) tryM({ a: "craft-found", step: a.id, items: a.craft.find.options.slice(0, 1).map((o) => o.id) });
      weiter();
    } else if (a.kind === "decide") tryM({ a: "decide", step: a.id, option: pick(a.decide!.options).id });
    else if (a.kind === "solve") {
      const p = a.solve!.parts.find((x) => x.status === "open");
      const pd = sd.solve?.parts.find((x) => x.id === p?.id);
      if (!p || !pd) {
        // A resolved part waits for «Nächste Frage» (the child's tap), then the next part.
        const resolved = a.solve!.parts.filter((x) => x.status !== "open").map((x) => x.id);
        seen = resolved;
        settle(false);
        weiter();
        continue;
      }
      const c = r();
      const pending = p.hints.find((h) => h.check && h.check.result === null);
      if (seed === "first-try" || c < 0.45) tryM({ a: "answer-part", step: a.id, part: p.id, value: String(pd.answer) });
      else if (pending && c < 0.6) tryM({ a: "hint-check", step: a.id, part: p.id, hint: pending.id, value: String(pd.hints?.find((h) => h.id === pending.id)?.check?.answer ?? "1") });
      else if (p.phase === "taught") tryM({ a: "practice-part", step: a.id, part: p.id, value: String(pd.answer) });
      else if (c < 0.8) tryM({ a: "answer-part", step: a.id, part: p.id, value: String(Number(pd.answer) + 1 + Math.floor(r() * 5)) });
      else if (c < 0.9) tryM({ a: "hint", step: a.id, part: p.id });
      else tryM({ a: "show-solution", step: a.id, part: p.id });
      // «Nächste Frage» after a resolved part (a tap)
      const after = view().active;
      const res = after?.solve?.parts.filter((x) => x.status !== "open").map((x) => x.id) ?? [];
      settle(false);
      if (after?.status === "active" && res.length && after.solve!.parts.some((x) => x.status === "open")) seen = res;
    } else if (a.kind === "read" || a.kind === "listen") {
      const q = a.questions.find((x) => x.status === "open");
      if (!q) {
        weiter();
        continue;
      }
      const answer = String(sd.questions?.find((x) => x.id === q.id)?.answer ?? "");
      if (a.kind === "listen" && (a.listen?.completedPlays ?? 0) === 0) {
        tryM({ a: "support", step: a.id, kind: "play" });
        tryM({ a: "listen-outcome", step: a.id, outcome: "recorded" });
      }
      tryM({ a: "answer-question", step: a.id, question: q.id, value: seed === "first-try" || r() < 0.6 ? answer : pick((q.options ?? []).filter((o) => o !== answer)) ?? answer });
    } else weiter();
    settle(false);
  }
  return out;
}

const narratedMissions = (content: LearningContent) => (content.missions ?? []).filter((m) => narrated(m));

describe("Nov 18 — no line is skipped, nothing advances before its narration ends (every narrated mission of every Isabel content)", () => {
  for (const file of isabelFiles) {
    const content = asIsabelContent(read(file));
    for (const m of narratedMissions(content)) {
      const walks = [walk(content, m.visit, "first-try"), ...Array.from({ length: 40 }, (_, i) => walk(content, m.visit, i + 1))];
      it(`${file} ${m.visit}: walks reach the end`, () => ok(walks.filter((w) => w.finished).length >= 20, `${walks.filter((w) => w.finished).length}/41 finished`));
      it(`${file} ${m.visit}: no state the scene passes through without a tap has a line to say`, () => deepStrictEqual([...new Set(walks.flatMap((w) => w.violations))], []));
      it(`${file} ${m.visit}: the opening line of every opened beat is the first thing said there`, () => {
        const wrong: string[] = [];
        for (const w of walks)
          for (const [step, lines] of w.opened) {
            const sd = m.steps.find((x) => x.id === step)!;
            const first = sd.intro?.[0]?.text;
            if (first && sd.kind !== "solve" && sd.kind !== "read" && sd.kind !== "listen" && lines[0] !== normaliseNarration(first)) wrong.push(`${step}: ${lines[0]}`);
            if (first && (sd.kind === "solve" || sd.kind === "read" || sd.kind === "listen") && !lines.includes(normaliseNarration(first))) wrong.push(`${step}: ${lines.join(" / ")}`);
          }
        deepStrictEqual([...new Set(wrong)], []);
      });
      it(`${file} ${m.visit}: every story, craft and outcome beat's done line is said on its finished beat (first-try walk)`, () => {
        const w = walks[0];
        const missing: string[] = [];
        for (const sd of m.steps) {
          if (!(sd.kind === "story" || sd.kind === "craft" || sd.kind === "outcome") || !w.opened.has(sd.id)) continue;
          for (const l of sd.done ?? []) if (!w.heardDone.has(`${sd.id}|${normaliseNarration(l.text)}`)) missing.push(`${sd.id}: ${l.text}`);
        }
        deepStrictEqual(missing, []);
      });
      it(`${file} ${m.visit}: within one walk no screen says the same line twice in a row (each line once per screen visit)`, () => {
        for (const w of walks) for (let i = 1; i < w.screens.length; i += 1) ok(w.screens[i].key !== w.screens[i - 1].key);
      });
      it(`${file} ${m.visit}: every line said is in the recorded catalogue`, () => {
        const cat = new Set(narrationCatalog(content).map((l) => l.text));
        deepStrictEqual([...new Set(walks.flatMap((w) => w.screens.flatMap((x) => x.lines)).filter((t) => !cat.has(t)))], []);
      });
      it(`${file} ${m.visit}: the goodbye screen never repeats the outcome beat's lines (the cliffhanger plays once)`, () => {
        const outcome = (m.steps.find((x) => x.kind === "outcome")?.done ?? []).map((l) => normaliseNarration(l.text));
        const bye = farewellScreenLines(content, m).map(normaliseNarration);
        ok(bye.length > 0);
        if (bye.some((t) => !outcome.includes(t))) deepStrictEqual(bye.filter((t) => outcome.includes(t)), []);
        const cat = new Set(narrationCatalog(content).map((l) => l.text));
        deepStrictEqual(bye.filter((t) => !cat.has(t)), [], "the goodbye lines are recorded");
      });
    }
  }
});

describe("Nov 18 — the current Isabel visit (Visit 4 «Ein Zuhause für die Vögel»)", () => {
  const content = asIsabelContent(read(latestIsabel));
  const birds = narratedMissions(content).find((m) => m.visit === "v5")!;
  it("«Bauen wir ihnen ein Haus?» is said on the finished first beat, and «Weiter» there only leaves", () => {
    const w = walk(content, "v5", "first-try");
    const hello = w.screens.find((x) => x.step === "IV1-HELLO" && x.status !== "active");
    ok(hello, "the finished hello beat is a screen of its own");
    deepStrictEqual(hello!.lines, ["Bauen wir ihnen ein Haus?"]);
    deepStrictEqual(w.screens.find((x) => x.step === "IV1-HELLO" && x.status === "active")!.lines, ["Schau, zwei kleine Rotkehlchen fliegen durch den Garten.", "Sie suchen einen sicheren Ort für ihr Nest."]);
    equal(narratedBeatTap({ kind: "story", status: "done" }), "leave");
  });
  it("the cliffhanger is said once in the whole visit (outcome beat), not again on the goodbye", () => {
    const w = walk(content, "v5", "first-try");
    const said = w.screens.flatMap((x) => x.lines).filter((t) => t === "Ob sie einziehen?").length;
    equal(said, 1);
    const bye = farewellScreenLines(content, birds);
    deepStrictEqual(bye, ["Dein Vogelhaus steht jetzt im Garten. Bis bald!"]);
    ok(farewellLines(content, birds).includes("Ob sie einziehen?"), "still in the recorded catalogue (outcome beat)");
  });
  it("the child view's goodbye is that line only", () => {
    const env = makeEnv(content);
    let s = applyLearningOp(stateBefore(content, "v5"), { op: "start-visit" } as LearningOp, env).state;
    // finish every beat quickly through the engine (first-try walk) then reach the closing
    const w = walk(content, "v5", "first-try");
    ok(w.finished);
    void s;
    s = applyLearningOp(stateBefore(content, "v5"), { op: "start-visit" } as LearningOp, env).state;
    const def = missionDefFor(content, "v5" as never)!;
    const mm = (a: MissionAction) => (s = applyLearningOp(s, { op: "mission", action: a }, env).state);
    for (const sd of def.steps) {
      const v = buildMissionView(s, content, "v5" as never)!;
      if (v.steps.find((x) => x.id === sd.id)?.status !== "available") continue;
      mm({ a: "open", step: sd.id });
      if (sd.kind === "story" || sd.kind === "outcome") mm({ a: "story-done", step: sd.id });
      else if (sd.kind === "craft") mm({ a: "story-done", step: sd.id });
      else if (sd.kind === "decide") mm({ a: "decide", step: sd.id, option: sd.decide!.options[0].id });
      else if (sd.kind === "solve") for (const p of sd.solve!.parts) mm({ a: "answer-part", step: sd.id, part: p.id, value: String(p.answer) });
      else if (sd.kind === "listen") {
        mm({ a: "support", step: sd.id, kind: "play" });
        mm({ a: "listen-outcome", step: sd.id, outcome: "recorded" });
        for (const q of sd.questions ?? []) mm({ a: "answer-question", step: sd.id, question: q.id, value: String(q.answer) });
      } else for (const q of sd.questions ?? []) mm({ a: "answer-question", step: sd.id, question: q.id, value: String(q.answer) });
      if (sd.kind !== "outcome") mm({ a: "leave" });
    }
    mm({ a: "finish" });
    const closing = buildChildView(s, content, EMPTY_PARENT_SETTINGS, new Date(Date.UTC(2026, 10, 18, 13)), 0, { noktMode: "unavailable" }).reflection?.closing;
    deepStrictEqual(closing?.farewell, ["Dein Vogelhaus steht jetzt im Garten. Bis bald!"]);
  });
});

describe("Nov 18 — the tap rule", () => {
  it("an unfinished story, craft or outcome beat is finished and stays; a finished beat leaves; nothing open opens the next", () => {
    for (const kind of ["story", "craft", "outcome"]) equal(narratedBeatTap({ kind, status: "active" }), "finish-beat");
    for (const kind of ["story", "craft", "outcome", "solve", "decide", "read", "listen"]) equal(narratedBeatTap({ kind, status: "done" }), "leave");
    equal(narratedBeatTap(null), "open-next");
  });
});

describe("Nov 18 — the end of a visit stays in the learning app", () => {
  it("lands on the learning Home screen (the map), never Family Home", () => {
    equal(learningHomeHref("isabel"), "/family/learn?child=isabel");
    equal(learningHomeHref("santiago"), "/family/learn?child=santiago");
  });
  it("neither end path of the visit page navigates to Family Home", () => {
    const src = readFileSync(new URL("../app/family/(shell)/learn/mission/client.tsx", import.meta.url), "utf8");
    ok(!/router\.(push|replace)\(`\/family\/home/.test(src), "no router push to /family/home on the visit page");
    ok((src.match(/router\.push\(learningHomeHref\(child\)\)/g) ?? []).length >= 2, "Isabel's goodbye and Santiago's look back both go to the map");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The player: slower German, pitch kept, a playing clip is never cut off, and no device voice for a recorded line
// ---------------------------------------------------------------------------------------------------------------------

type FakeAudio = { src: string; paused: boolean; ended: boolean; playbackRate?: number; defaultPlaybackRate?: number; preservesPitch?: boolean; onended: (() => void) | null; onerror: (() => void) | null; play: () => void; pause: () => void };
function fakeClock() {
  let t = 0;
  let id = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    set: (fn: () => void, ms: number) => (timers.set((id += 1), { at: t + ms, fn }), id),
    clear: (h: unknown) => void timers.delete(h as number),
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        t = due[1].at;
        due[1].fn();
      }
      t = end;
    },
  };
}
const tick = () => new Promise<void>((r) => setImmediate(r));

describe("Nov 18 — narration speed and the safety timer", () => {
  it("German story voices play at 0.85, Spanish stays 0.8, English stays 0.88", () => {
    equal(GERMAN_PLAYBACK_RATE, 0.85);
    equal(playbackRateFor("de-female"), 0.85);
    equal(playbackRateFor("de-male"), 0.85);
    equal(playbackRateFor("es-female"), SPANISH_PLAYBACK_RATE);
    equal(SPANISH_PLAYBACK_RATE, 0.8);
    equal(playbackRateFor("en-female"), 0.88);
  });
  it("the safety timer scales with the rate", () => ok(Math.abs(lineSafetyMs("Hallo zusammen.", 0.85) - lineSafetyMs("Hallo zusammen.", 1) / 0.85) < 1e-6));
  it("a clip still playing when the safety timer fires is not cut off; the line ends with the clip", async () => {
    const clock = fakeClock();
    const audio: FakeAudio = { src: "", paused: true, ended: false, onended: null, onerror: null, play() { audio.paused = false; }, pause() { audio.paused = true; } };
    const ended: string[] = [];
    const player = createNarrationPlayer({ fetchClip: async () => new Blob(["x"], { type: "audio/mpeg" }), createAudio: () => audio as never, createObjectUrl: () => "blob:x", revokeObjectUrl: () => {}, synth: null, setTimer: clock.set, clearTimer: clock.clear, onLine: (l) => ended.push(l.text) });
    player.unlock();
    audio.paused = true;
    const line = { id: "n1", text: "Sie suchen einen sicheren Ort für ihr Nest.", slot: "de-female" as const };
    const done = player.play({ key: "k", lines: [line] });
    await tick();
    equal(audio.playbackRate, 0.85);
    equal(audio.preservesPitch, true);
    clock.advance(lineSafetyMs(line.text, 0.85) * 3);
    await tick();
    deepStrictEqual(ended, [], "still playing: the timer re-armed instead of ending the line");
    equal(player.status(), "speaking");
    audio.ended = true;
    audio.paused = true;
    audio.onended?.();
    equal(await done, "done");
    deepStrictEqual(ended, [line.text]);
  });
  it("a recorded (slotted) line whose clip is missing is reported as missing and never spoken by a device voice — configured or not", async () => {
    let spoke = 0;
    const synth = { cancel() {}, speak() { spoke += 1; }, getVoices: () => [{ name: "Anna", lang: "de-DE" }] };
    for (const configured of [new Set<string>(), new Set(["de-female"])]) {
      const player = createNarrationPlayer({ fetchClip: async () => null, createAudio: () => null, synth, makeUtterance: () => ({ lang: "", rate: 1, onend: null, onerror: null }), configuredSlots: () => configured });
      player.unlock();
      equal(await player.play({ key: "k", lines: [{ id: "n1", text: "Bauen wir ihnen ein Haus?", slot: "de-female" }] }), "missing");
      equal(player.status(), "missing");
      equal(player.lastLineOutcome(), "missing-recording");
    }
    equal(spoke, 0);
  });
});
