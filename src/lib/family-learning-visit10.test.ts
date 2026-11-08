// Nov 8 round: the defects that reached production and the rules around Nokt. Fictional and offline: fake fetch, fake audio,
// no provider, no bridge, no child data.

import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createLearningClient, LEARNING_NOKT_DISPATCH_PATH, LEARNING_NOKT_REPLY_PATH, LEARNING_SESSION_PATH, BRIDGE_NOKT_PATH } from "./family-learning-client.ts";
import { checkNoktReply, NOKT_MAX_CHILD_TURNS, NOKT_SYSTEM_PROMPT_DE, noktTaskContext, parseNoktReply, type NoktTurnText } from "./family-learning-nokt-contract.ts";
import { NOKT_TALK_MAX_CHILD_TURNS, talkEnded } from "./family-learning-nokt-talk.ts";
import { WORKSHOP_PICTURES } from "./family-learning-mission-spec.ts";
import { asLearningContent } from "./family-learning-content.ts";
import { buildChildView, EMPTY_PARENT_SETTINGS, newMissionState } from "./family-learning-state.ts";
import { createNarrationPlayer, NARRATION_PLAYBACK_RATE, playbackRateFor } from "./family-narration-player.ts";
import { clipEtag } from "./family-narration-store.ts";
import { closingLines, spokenClosingLines, type ClosingSource } from "./family-learning-narration.ts";

const here = (p: string) => new URL(p, import.meta.url);
const pictures = readFileSync(here("../components/family/learning/workshop-pictures.tsx"), "utf8");
const content = (name: string) => JSON.parse(readFileSync(here(`../data/family-learning/content/${name}`), "utf8"));

describe("A1 — every picture id draws something", () => {
  it("each id in WORKSHOP_PICTURES has its own case in the drawing", () => {
    const missing = WORKSHOP_PICTURES.filter((id) => !pictures.includes(`case "${id}":`));
    deepEqual(missing, []);
  });
  it("the drawing switch stays exhaustive, so a new id without a drawing does not compile", () => ok(/const missing: never = id;/.test(pictures)));
  it("every picture the children's content names exists in the list", () => {
    const named = new Set<string>();
    const walk = (v: unknown, key = ""): void => {
      if (typeof v === "string" && (key === "picture" || key === "__pictures")) named.add(v);
      else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k === "pictures" ? "__pictures" : key === "__pictures" ? "__pictures" : k);
    };
    walk(content("isabel-workshop-v3.json"));
    const unknown = [...named].filter((id) => !(WORKSHOP_PICTURES as readonly string[]).includes(id) && id !== "greenhouse" && id !== "water");
    deepEqual(unknown, []);
    ok(named.has("corn") && named.has("nut-and-corn") && named.has("harvest-carrots"), "the walk reached Isabel's Visit 3 pictures");
  });
});

type FakeAudio = { src: string; playbackRate?: number; defaultPlaybackRate?: number; preservesPitch?: boolean; webkitPreservesPitch?: boolean; onended: (() => void) | null; onerror: (() => void) | null; play: () => void; pause: () => void };
function fakePlayer(slot: "de-female" | "de-male") {
  let timerMs = 0;
  const audio: FakeAudio = { src: "", onended: null, onerror: null, play() { if (audio.src.startsWith("blob:")) queueMicrotask(() => audio.onended?.()); }, pause() {} };
  const player = createNarrationPlayer({ fetchClip: async () => new Blob(["x"], { type: "audio/mpeg" }), createAudio: () => audio as never, createObjectUrl: () => "blob:x", revokeObjectUrl: () => {}, synth: null, setTimer: (_fn, ms) => { timerMs = ms; return 1; }, clearTimer: () => {} });
  player.unlock();
  return { audio, player, line: { id: "a1b2c3d4", text: "Hallo zusammen.", slot }, timer: () => timerMs };
}

describe("A3 — slower narration, pitch preserved, nothing cut off", () => {
  it("Ava, Rosa and June play at 0.88 with the pitch kept", async () => {
    const { audio, player, line } = fakePlayer("de-female");
    await player.play({ key: "k", lines: [line] });
    equal(audio.playbackRate, 0.88);
    equal(audio.defaultPlaybackRate, 0.88);
    equal(audio.preservesPitch, true);
    equal(audio.webkitPreservesPitch, true);
  });
  it("the rate applies to those three voices only", () => {
    equal(playbackRateFor("de-female"), NARRATION_PLAYBACK_RATE);
    equal(playbackRateFor("es-female"), NARRATION_PLAYBACK_RATE);
    equal(playbackRateFor("en-female"), NARRATION_PLAYBACK_RATE);
    equal(playbackRateFor("de-male"), 1);
    equal(playbackRateFor(null), 1);
  });
  it("the safety timer grows with the slower speed, so it cannot end a line early", async () => {
    const slow = fakePlayer("de-female");
    await slow.player.play({ key: "a", lines: [slow.line] });
    const normal = fakePlayer("de-male");
    await normal.player.play({ key: "b", lines: [normal.line] });
    ok(Math.abs(slow.timer() - normal.timer() / 0.88) < 1);
  });
});

describe("A2 — a device can never replay another voice's clip", () => {
  const env = (id: string) => ({ ELEVENLABS_VOICE_DE_FEMALE_ID: id });
  it("the validator changes with the voice and is stable for the same voice", () => {
    const hannah = clipEtag("de-female", "abc12345", env("hannahVoice123"));
    const ava = clipEtag("de-female", "abc12345", env("avaVoice456789"));
    ok(hannah && ava && hannah !== ava);
    equal(clipEtag("de-female", "abc12345", env("avaVoice456789")), ava);
  });
  it("no voice id leaks into it", () => ok(!clipEtag("de-female", "abc12345", env("avaVoice456789"))!.includes("avaVoice")));
  it("the route revalidates and the player asks it to", () => {
    const route = readFileSync(here("../app/api/family/learning/narration/[slot]/[id]/route.ts"), "utf8");
    ok(route.includes('"private, no-cache"') && !route.includes("max-age=86400"));
    const player = readFileSync(here("./family-narration-player.ts"), "utf8");
    ok(player.includes('cache: "no-cache"') && !player.includes("force-cache"));
  });
});

describe("A5 — the next-visit choice speaks only its question", () => {
  const src = { reflection: { prompt: "Wie war es?", options: [{ label: "Leicht" }], nextInterest: { prompt: "Was nächstes Mal?", unsureLabel: "Weiss nicht", declineLabel: "Nein" } }, adventure: { prompt: "Was machen wir?", choices: [{ label: "Ein Vogelhaus bauen" }, { label: "Tiere im Garten" }] } } as ClosingSource;
  it("the options are no longer read aloud", () => deepEqual(spokenClosingLines("next", src), ["Was machen wir?"]));
  it("the recorded catalogue of released content is unchanged", () => ok(closingLines("next", src).includes("Ein Vogelhaus bauen")));
  it("other closing questions still read their answers", () => deepEqual(spokenClosingLines("difficulty", src), closingLines("difficulty", src)));
});

describe("A7 — a reply survives taps that move the revision", () => {
  function harness(staleTimes: number) {
    const replyRevisions: number[] = [];
    let stale = staleTimes;
    const v6 = asLearningContent(content("santiago-expedition-v6.json"));
    const baseView = JSON.parse(JSON.stringify(buildChildView(newMissionState(v6, "santiago", "2026-09-29T10:00:00.000Z"), v6, EMPTY_PARENT_SETTINGS, new Date("2026-10-23T12:00:00Z"), 0)));
    const view = (revision: number) => ({ ...baseView, revision });
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (url.includes(LEARNING_SESSION_PATH)) return json({ child: "santiago", token: "t", expiresAt: Date.now() + 3_600_000 });
      if (url.endsWith(LEARNING_NOKT_DISPATCH_PATH)) return json({ status: "applied", view: view(7), result: { turnId: "turn-000001", request: { promptVersion: "x", system: "x", context: {}, transcript: [] }, bridge: { url: "http://127.0.0.1:8797", token: "b" } } });
      if (url.endsWith(BRIDGE_NOKT_PATH)) return json({ reply: '{"v":1,"say":"Hallo","intent":"ask","outcome":null}', receipt: "fcr1.x.y" });
      if (url.endsWith(LEARNING_NOKT_REPLY_PATH)) {
        replyRevisions.push(body.expectedRevision);
        if (stale > 0) {
          stale -= 1;
          return new Response(JSON.stringify({ status: "stale", view: view(body.expectedRevision + 1) }), { status: 409, headers: { "Content-Type": "application/json" } });
        }
        return json({ status: "applied", view: view(body.expectedRevision + 1), result: { shown: true, say: "Hallo", ended: false } });
      }
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    const client = createLearningClient({ fetchImpl });
    return { client, replyRevisions };
  }
  const turn = { purpose: "debrief", sessionId: "s-12345678", turnId: "turn-000001" } as const;
  const options = { signal: new AbortController().signal, context: { erasureGeneration: 0, visit: null } };
  it("a stale answer is re-posted on the newest revision", async () => {
    const { client, replyRevisions } = harness(2);
    const out = await client.noktTurn("santiago", turn, 7, options);
    ok(out.ok && out.status === "applied");
    deepEqual(replyRevisions, [7, 8, 9]);
  });
  it("it stops after a bounded number of tries", async () => {
    const { client, replyRevisions } = harness(50);
    const out = await client.noktTurn("santiago", turn, 7, options);
    ok(out.ok && out.status === "stale");
    equal(replyRevisions.length, 6);
  });
});

describe("C — Nokt's rules", () => {
  const reply = (say: string, intent: string) => parseNoktReply({ v: 1, say, intent, outcome: null });
  const child = (text: string): NoktTurnText => ({ role: "child", text, via: "typed" });
  const base = { purpose: "diagnostic" as const, answer: 14, unit: "m", visibleText: ["Das Beet ist 4 m lang und 3 m breit."], attempts: ["7"], disclosureAllowed: false };
  it("it may ask about his own wrong number", () => deepEqual(checkNoktReply(reply("Warum hast du 7 m gerechnet?", "ask-method"), { ...base, transcript: [] }), { ok: true }));
  for (const say of ["Brauchst du Hilfe?", "Möchtest du Hilfe bei der Aufgabe?", "Soll ich dir helfen?"]) {
    it(`never: «${say}»`, () => deepEqual(checkNoktReply(reply(say, "ask-method"), { ...base, transcript: [] }), { ok: false, reason: "offers-help" }));
  }
  it("it can't name the answer", () => deepEqual(checkNoktReply(reply("Es sind 14 m rundherum.", "ask-method"), { ...base, transcript: [] }), { ok: false, reason: "answer-disclosed" }));
  it("after four of his turns it must close", () => {
    equal(NOKT_MAX_CHILD_TURNS, 4);
    const four = [child("a"), child("b"), child("c"), child("d")];
    deepEqual(checkNoktReply(reply("Was denkst du?", "ask-method"), { ...base, transcript: four }), { ok: false, reason: "must-close" });
    deepEqual(checkNoktReply(reply("Danke, probier es jetzt selbst.", "close"), { ...base, transcript: four }), { ok: true });
  });
  it("the prompt tells it to open about his own answer and never to offer help", () => {
    ok(NOKT_SYSTEM_PROMPT_DE.includes("Warum hast du 7 m gerechnet?"));
    ok(NOKT_SYSTEM_PROMPT_DE.includes("Frag nie, ob es Hilfe braucht"));
  });
  it("the context carries his actual answers and tells it when to close, never the solution", () => {
    const part = { id: "p", question: "Wie lang ist das Rohr?", answer: 14, unit: "m", hints: [] };
    const c = noktTaskContext({ step: "S", solve: { facts: ["f"], parts: [part] } as never, part: part as never, purpose: "diagnostic", attempts: ["7", "12"], hintIdsShown: [], phase: "nachfragen", resultAllowed: false, closeNow: true });
    deepEqual(c.attempts, ["7", "12"]);
    equal(c.closeNow, true);
    ok(!JSON.stringify(c).includes('"answer"'));
  });
  it("a conversation in the visit is capped at about four of his turns", () => {
    equal(NOKT_TALK_MAX_CHILD_TURNS.visit, 4);
    equal(NOKT_TALK_MAX_CHILD_TURNS.debrief, 4);
    equal(NOKT_TALK_MAX_CHILD_TURNS.writing, 5, "his sentence counts as the first line, then four replies");
    equal(NOKT_TALK_MAX_CHILD_TURNS.welcome, 2);
  });
  it("the talk is over when Nokt closes it or the app's phase ends it", () => {
    ok(talkEnded("close", "satz"));
    ok(talkEnded("ask", "schliessen"));
    ok(talkEnded("respond", "abschluss"));
    ok(!talkEnded("ask", "satz"));
  });
});

