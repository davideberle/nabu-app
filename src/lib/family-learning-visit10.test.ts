// Nov 8 round: the defects that reached production and the rules around Nokt. Fictional and offline: fake fetch, fake audio,
// no provider, no bridge, no child data.

import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createClient, type Client } from "@libsql/client";
import { annotateDisplayError, DISPLAY_ERROR_NOTE, ensureLearningTables } from "./family-learning-db.ts";
import { learningLadder } from "./family-learning-skill-ladder.ts";
import { noktModeFromEnv } from "./family-learning-nokt.ts";
import { createLearningClient, LEARNING_NOKT_DISPATCH_PATH, LEARNING_NOKT_REPLY_PATH, LEARNING_SESSION_PATH, BRIDGE_NOKT_PATH } from "./family-learning-client.ts";
import { checkNoktReply, NOKT_MAX_CHILD_TURNS, NOKT_SYSTEM_PROMPT_DE, noktTaskContext, parseNoktReply, type NoktTurnText } from "./family-learning-nokt-contract.ts";
import { NOKT_TALK_MAX_CHILD_TURNS, talkAppLine, talkEnded, talkSystemPrompt } from "./family-learning-nokt-talk.ts";
import { WORKSHOP_PICTURES } from "./family-learning-mission-spec.ts";
import { asLearningContent } from "./family-learning-content.ts";
import { buildChildView, EMPTY_PARENT_SETTINGS, newMissionState } from "./family-learning-state.ts";
import { createNarrationPlayer, NARRATION_PLAYBACK_RATE, playbackRateFor, SPANISH_PLAYBACK_RATE } from "./family-narration-player.ts";
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
    equal(playbackRateFor("es-female"), SPANISH_PLAYBACK_RATE);
    equal(playbackRateFor("es-male"), SPANISH_PLAYBACK_RATE);
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
  it("a conversation in the visit is capped at about eight of his turns (Nov 14: four ended it while he still wanted help)", () => {
    equal(NOKT_TALK_MAX_CHILD_TURNS.visit, 8);
    equal(NOKT_TALK_MAX_CHILD_TURNS.debrief, 4);
    equal(NOKT_TALK_MAX_CHILD_TURNS.writing, 5, "his sentence counts as the first line, then four replies");
    equal(NOKT_TALK_MAX_CHILD_TURNS.welcome, 2);
  });
  it("Nov 14: the visit prompt forbids invented hints and sending him away, and the closing line is not a goodbye", () => {
    const sys = talkSystemPrompt("visit");
    ok(sys.includes("context.where.helpOnPage"));
    ok(sys.includes("Erfinde keinen Hinweis"));
    ok(sys.includes("verabschiede dich nicht"));
    ok(sys.includes("Sag nicht Tschüss"));
    ok(sys.length < 6000, "fits the runtime's system limit");
    ok(!talkAppLine("welcome", true, "stale-page").includes("Gewächshaus"), "the welcome stand-in names no old visit");
  });
  it("the talk is over when Nokt closes it or the app's phase ends it", () => {
    ok(talkEnded("close", "satz"));
    ok(talkEnded("ask", "schliessen"));
    ok(talkEnded("respond", "abschluss"));
    ok(!talkEnded("ask", "satz"));
  });
});


describe("Review round — display errors never rewrite, and never count", () => {
  const tmp = mkdtempSync(join(tmpdir(), "visit10-"));
  const attempt = (id: string, task: string, correct: number, evidence: string, at: string) =>
    ({ sql: "INSERT INTO family_learning_attempts (id, child_id, mission_id, visit_id, task_id, task_version, objective, attempt_no, answer_json, correct, evidence, support_json, exposure_before, stimulus_language, response_language, modality, created_at) VALUES (?, 'isabel', 'content-x', 'v4', ?, 1, 'early-reading-word-picture', 1, '{\"raw\":\"Mais\"}', ?, ?, '[]', 0, 'de', 'de', 'pick', ?)", args: [id, task, correct, evidence, at] });
  const owner = "owner@fixture.invalid";
  const setup = async () => {
    const client = createClient({ url: `file:${join(tmp, `d-${Math.random().toString(36).slice(2)}.sqlite`)}` });
    await ensureLearningTables(client);
    await client.execute(attempt("a-ih7-0001", "M/IH7-READ/word", 1, "independent", "2026-11-08T12:40:00.000Z"));
    await client.execute(attempt("a-ih8-0001", "M/IH8-READ/word", 1, "independent", "2026-11-08T12:41:00.000Z"));
    return client;
  };
  const input = { child: "isabel" as const, contentId: "content-x", missionId: "M", visitId: "v4", steps: [{ step: "IH7-READ", objective: "early-reading-word-picture" }, { step: "IH8-READ", objective: "early-reading-word-picture" }], observation: "Checked by hand: read slowly.", adminEmail: owner };
  const row = async (client: Client, id: string) => (await client.execute({ sql: "SELECT answer_json, correct, evidence, parent_correction_json FROM family_learning_attempts WHERE id = ?", args: [id] })).rows[0];

  it("keeps the answer, adds the annotation and one supported observation per task, with audit rows", async () => {
    const client = await setup();
    deepEqual(await annotateDisplayError(client, input), { annotated: 2, observed: 2, attempts: 2 });
    const r = await row(client, "a-ih7-0001");
    equal(r.answer_json, '{"raw":"Mais"}');
    equal(Number(r.correct), 1);
    equal(r.evidence, "independent");
    equal(JSON.parse(String(r.parent_correction_json)).annotation, "display-error");
    equal(JSON.parse(String(r.parent_correction_json)).note, DISPLAY_ERROR_NOTE);
    const obs = await client.execute("SELECT payload_json FROM family_learning_support_events WHERE kind = 'parent_observation'");
    equal(obs.rows.length, 2);
    equal(JSON.parse(String(obs.rows[0].payload_json)).countsAs, "supported");
    equal((await client.execute("SELECT id FROM family_learning_parent_audit")).rows.length, 4);
  });
  it("is safe to send twice", async () => {
    const client = await setup();
    await annotateDisplayError(client, input);
    deepEqual(await annotateDisplayError(client, input), { annotated: 0, observed: 0, attempts: 2 });
    equal((await client.execute("SELECT id FROM family_learning_parent_audit")).rows.length, 4);
  });
  it("one transaction: a task without answers leaves nothing behind", async () => {
    const client = await setup();
    await rejects(() => annotateDisplayError(client, { ...input, steps: [...input.steps, { step: "IH9-PHRASE", objective: "early-reading-first-phrase-picture" }] }));
    equal((await row(client, "a-ih7-0001")).parent_correction_json, null);
    equal((await client.execute("SELECT id FROM family_learning_parent_audit")).rows.length, 0);
    equal((await client.execute("SELECT id FROM family_learning_support_events")).rows.length, 0);
  });
  const ladderFor = (attempts: unknown[], parentObserved: unknown[]) => learningLadder({ child: "isabel", attempts: attempts as never, parentObserved: parentObserved as never, samples: [], visits: [{ id: "v4", label: "Visit 3", startedAt: "2026-11-08T12:00:00.000Z", finishedAt: null }], typing: null });
  const a = { id: "a1", visitId: "v4", taskId: "M/IH7-READ/word", objective: "early-reading-word-picture", answer: { raw: "Mais" }, correct: true, evidence: "independent", stimulusLanguage: "de", teachingMove: null, teachingReason: null, secondsSinceTeaching: null, createdAt: "2026-11-08T12:40:00.000Z", parentCorrection: null };
  const read = (l: ReturnType<typeof learningLadder>) => l.rows.find((r) => r.id === "i-read")!;
  it("the ladder leaves an annotated answer out and counts the observation as with help, never on own", () => {
    equal(read(ladderFor([a], [])).status, "on-own-once");
    const annotated = { ...a, parentCorrection: { note: DISPLAY_ERROR_NOTE, annotation: "display-error", by: "x", at: a.createdAt } };
    equal(read(ladderFor([annotated], [])).status, "not-seen");
    equal(read(ladderFor([annotated], [{ id: "o1", visitId: "v4", taskId: "IH7-READ/parent-reading-check", objective: "early-reading-word-picture", at: "2026-11-08T14:00:00.000Z" }])).status, "with-help");
  });
});

describe("Review round — the fictional-mode banner", () => {
  const prod = { VERCEL: "1", TURSO_DATABASE_URL: "libsql://x", FAMILY_NOKT_CONVERSATION: "subscription", FAMILY_ASSISTANT_BRIDGE_URL: "https://bridge.example", FAMILY_BRIDGE_TOKEN_SECRET: "x".repeat(40) };
  it("production can never be in the fictional mode, whatever the flags say", () => {
    equal(noktModeFromEnv({ ...prod, FAMILY_NOKT_FICTIONAL_STUB: "1" }), "subscription");
    equal(noktModeFromEnv({ VERCEL: "1", NABU_DB_DIR: "/tmp/x", FAMILY_NOKT_FICTIONAL_STUB: "1" }), "unavailable");
  });
  it("the banner is only rendered for that mode", () => {
    const panel = readFileSync(here("../components/family/learning/nokt-panel.tsx"), "utf8");
    ok(panel.includes('fictional={mode === "fictional-stub"}'));
    ok(/\{fictional \? \(\s*<p[^>]*>\s*Testmodus: erfundene Antworten/.test(panel));
    equal((panel.match(/Testmodus:/g) ?? []).length, 1);
  });
});
