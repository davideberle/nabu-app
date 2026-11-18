// Nov 18 (Isabel Visit 5): Ida's new voice from Visit 5 on, finished visits and chess in the previous voice; provider speed;
// the free dry run of the owner recording. Run: node --test src/lib/family-narration-voices.test.ts
import { describe, it } from "node:test";
import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ADAPTIVE_CHESS_COACH_LINES_DE } from "../data/adaptive-chess-coach/bundle.generated.ts";
import { withChessLines } from "./family-chess-narration.ts";
import { asLearningContent } from "./family-learning-content.ts";
import { asIsabelContent } from "./family-learning-isabel.ts";
import { catalogKey, narrationCatalog, storyCatalog, type NarrationLine } from "./family-learning-narration.ts";
import { parseNarrationPost } from "./family-narration-audition.ts";
import { clipRateFromHeader, createNarrationPlayer } from "./family-narration-player.ts";
import { clipEtag, clipPathname, clipPlaybackRate, lineClipPathname, planNarration, prepareNarration, previousVoiceEnv, resolveLineVoice, slotSpeed, slotSpeedEnv } from "./family-narration-store.ts";
import { catalogKeysByVisit, NEW_VOICE_FROM, pinPreviousVoices } from "./family-narration-voices.ts";

const content = (f: string) => JSON.parse(readFileSync(new URL(`../data/family-learning/content/${f}`, import.meta.url), "utf8"));
const isabelNow = asIsabelContent(content("isabel-workshop-v5.json"));
const santiagoNow = asLearningContent(content("santiago-expedition-v10.json"));

/** The served catalogue exactly as `servedNarrationCatalog()` builds it (that module imports JSON through the app alias). */
function served(isabelFile = "isabel-workshop-v5.json", santiagoFile = "santiago-expedition-v10.json", pin = true): NarrationLine[] {
  const isabel = asIsabelContent(content(isabelFile));
  const base = withChessLines([...narrationCatalog(isabel).map((l) => ({ ...l, child: "isabel" as const })), ...storyCatalog(asLearningContent(content(santiagoFile)), "santiago")], ADAPTIVE_CHESS_COACH_LINES_DE);
  return pin ? pinPreviousVoices(base, isabel) : base;
}
/** What production serves today (81dadfb3): Isabel content v4, Santiago v9, chess. */
const releasedCatalog = () => served("isabel-workshop-v4.json", "santiago-expedition-v9.json", false);

const AVA = "AnvlJBAqSLDzEevYr9Ap";
const SABRINA = "cqPdIo76zSHFDcSZpFov";
const SLOTS = { ELEVENLABS_VOICE_ES_FEMALE_ID: "RosaVoice1234", ELEVENLABS_VOICE_ES_MALE_ID: "MateoVoice123", ELEVENLABS_VOICE_EN_FEMALE_ID: "JuneVoice1234", ELEVENLABS_VOICE_DE_MALE_ID: "DeMaleVoice12" };
/** Today's production env: the slot is Ava, no previous voice. */
const ENV_TODAY = { ...SLOTS, ELEVENLABS_VOICE_DE_FEMALE_ID: AVA };
/** The release env: the slot switched to Sabrina, Ava pinned as the previous voice. */
const ENV_SWITCHED = { ...SLOTS, ELEVENLABS_VOICE_DE_FEMALE_ID: SABRINA, ELEVENLABS_VOICE_DE_FEMALE_PREVIOUS_ID: AVA };

describe("Ida's voice per visit (Nov 18)", () => {
  const cat = served();
  const v6 = catalogKeysByVisit(isabelNow).get("v6")!;
  const deFemale = cat.filter((l) => l.slot === "de-female");

  it("the env names and the rule", () => {
    equal(previousVoiceEnv("de-female"), "ELEVENLABS_VOICE_DE_FEMALE_PREVIOUS_ID");
    equal(slotSpeedEnv("de-female"), "FAMILY_NARRATION_SPEED_DE_FEMALE");
    deepStrictEqual(NEW_VOICE_FROM["de-female"], { child: "isabel", visit: "v6" });
  });

  it("pinning changes no id, text, slot or order — only the optional voice marker", () => {
    const unpinned = served(undefined, undefined, false);
    deepStrictEqual(cat.map(({ voice: _v, ...l }) => l), unpinned);
    ok(cat.every((l) => l.voice === undefined || l.voice === "previous"));
  });

  it("every line production serves today keeps its id and text in the new catalogue", () => {
    const now = new Map(cat.map((l) => [catalogKey(l), l.text]));
    for (const l of releasedCatalog()) equal(now.get(catalogKey(l)), l.text, `${catalogKey(l)} kept`);
  });

  it("the per-visit split covers the whole catalogue of Isabel (no line without a visit)", () => {
    const union = new Set([...catalogKeysByVisit(isabelNow).values()].flatMap((s) => [...s]));
    deepStrictEqual(new Set(narrationCatalog(isabelNow).map(catalogKey)), union);
  });

  it("every de-female line of Visit 5 (every scene, closing and goodbye) resolves to the slot's voice — Sabrina after the switch", () => {
    ok(v6.size > 100);
    for (const l of cat.filter((x) => v6.has(catalogKey(x)))) {
      equal(l.voice, undefined, l.text);
      const v = resolveLineVoice(l, ENV_SWITCHED)!;
      equal(v.voiceId, SABRINA, l.text);
      equal(v.era, "current");
    }
    // the shared lines Visit 5 replays are among them
    for (const t of ["Wie war es heute?", "Tipp auf das Ohr und hör gut zu.", "Richtig."]) {
      const l = deFemale.find((x) => x.text === t);
      ok(l && v6.has(catalogKey(l)), `${t} is spoken by Visit 5`);
      equal(resolveLineVoice(l!, ENV_SWITCHED)!.voiceId, SABRINA);
    }
  });

  it("chess lines and lines only Visits 1–4 speak keep Ava after the switch", () => {
    const chess = deFemale.filter((l) => l.where?.[0] === "chess");
    equal(chess.length, 30);
    for (const l of chess) equal(resolveLineVoice(l, ENV_SWITCHED)!.voiceId, AVA);
    const onlyOld = deFemale.filter((l) => l.child === "isabel" && !v6.has(catalogKey(l)));
    ok(onlyOld.length > 200);
    for (const l of onlyOld) {
      equal(l.voice, "previous");
      equal(resolveLineVoice(l, ENV_SWITCHED)!.voiceId, AVA, l.text);
    }
    // and nothing else is pinned
    equal(deFemale.filter((l) => l.voice === "previous").length, chess.length + onlyOld.length);
  });

  it("no finished-visit clip moves: with today's env every line resolves exactly as before (same path, same ETag stem)", () => {
    for (const l of cat) {
      const v = resolveLineVoice(l, ENV_TODAY);
      if (!l.slot) continue;
      const before = (SLOTS as Record<string, string>)[`ELEVENLABS_VOICE_${l.slot.replace("-", "_").toUpperCase()}_ID`] ?? AVA;
      equal(lineClipPathname(v!, l.id), clipPathname(before, l.id));
    }
    // Ava's pinned lines keep the very clip files recorded with Ava as the slot voice
    const old = deFemale.find((l) => l.voice === "previous")!;
    equal(lineClipPathname(resolveLineVoice(old, ENV_SWITCHED)!, old.id), clipPathname(AVA, old.id));
  });

  it("the ETag follows the line's resolved voice; an unconfigured previous voice falls back to the slot (never to a device)", () => {
    const old = deFemale.find((l) => l.voice === "previous")!;
    const shared = deFemale.find((l) => l.text === "Richtig.")!;
    ok(clipEtag(old, ENV_SWITCHED) !== clipEtag(shared, ENV_SWITCHED));
    equal(clipEtag(old, ENV_SWITCHED), clipEtag(old, ENV_TODAY));
    ok(clipEtag(shared, ENV_SWITCHED) !== clipEtag(shared, ENV_TODAY));
    equal(resolveLineVoice(old, { ...ENV_SWITCHED, ELEVENLABS_VOICE_DE_FEMALE_PREVIOUS_ID: undefined })!.voiceId, SABRINA);
    equal(resolveLineVoice(old, { ...ENV_SWITCHED, ELEVENLABS_VOICE_DE_FEMALE_PREVIOUS_ID: "bad id!" })!.voiceId, SABRINA);
    ok(!clipEtag(old, ENV_SWITCHED)!.includes(AVA));
  });
});

describe("provider speed per slot (option b) and the matching playback", () => {
  const cat = served();
  const shared = cat.find((l) => l.slot === "de-female" && l.text === "Richtig.")!;
  const chess = cat.find((l) => l.where?.[0] === "chess")!;
  const SLOW = { ...ENV_SWITCHED, FAMILY_NARRATION_SPEED_DE_FEMALE: "0.85" };

  it("only a sane speed counts", () => {
    equal(slotSpeed("de-female", SLOW), 0.85);
    for (const bad of ["", "1", "1.0", "0.5", "1.3", "abc", "0,85", "0.855"]) equal(slotSpeed("de-female", { FAMILY_NARRATION_SPEED_DE_FEMALE: bad }), null, bad);
  });
  it("the slot voice's lines get their own clip key and play at 1.0; pinned lines (chess, finished visits) keep their clips and 0.85", () => {
    const v = resolveLineVoice(shared, SLOW)!;
    equal(v.speed, 0.85);
    ok(lineClipPathname(v, shared.id) !== clipPathname(SABRINA, shared.id));
    equal(clipPlaybackRate(v), 1);
    const c = resolveLineVoice(chess, SLOW)!;
    equal(c.speed, null);
    equal(lineClipPathname(c, chess.id), clipPathname(AVA, chess.id));
    equal(clipPlaybackRate(c), null);
    // option (a), the default: no speed env → normal clips, the player's 0.85
    equal(clipPlaybackRate(resolveLineVoice(shared, ENV_SWITCHED)), null);
  });
  it("the player takes the clip route's rate header, else its per-language default", async () => {
    equal(clipRateFromHeader("1"), 1);
    for (const bad of [null, "", "abc", "0.1", "3"]) equal(clipRateFromHeader(bad), null);
    const rates: number[] = [];
    const audio = { src: "", paused: true, ended: false, onended: null as null | (() => void), onerror: null as null | (() => void), set playbackRate(r: number) { rates.push(r); }, get playbackRate() { return rates.at(-1) ?? 1; }, defaultPlaybackRate: 1, pause() {}, play() { queueMicrotask(() => this.onended?.()); return Promise.resolve(); } };
    for (const [answer, want] of [[{ blob: new Blob(["x"], { type: "audio/mpeg" }), rate: 1 }, 1], [{ blob: new Blob(["x"], { type: "audio/mpeg" }), rate: null }, 0.85], [new Blob(["x"], { type: "audio/mpeg" }), 0.85]] as const) {
      rates.length = 0;
      const player = createNarrationPlayer({ fetchClip: async () => answer as never, createAudio: () => audio as never, createObjectUrl: () => "blob:x", revokeObjectUrl: () => {}, synth: null, setTimer: () => 1, clearTimer: () => {} });
      player.unlock();
      await player.play({ key: `k${want}`, lines: [shared] });
      ok(rates.length > 0 && rates.every((r) => r === want), `rate ${want}: ${rates}`);
      player.stop();
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The recording run after the switch, against a mocked store that already holds every clip production has today.
// ---------------------------------------------------------------------------------------------------------------------

function storeWithTodaysClips() {
  const files = new Set<string>();
  for (const l of releasedCatalog()) {
    const v = resolveLineVoice(l, ENV_TODAY);
    if (v) files.add(lineClipPathname(v, l.id));
  }
  const puts: string[] = [];
  const sent: { url: string; body: Record<string, unknown> | null }[] = [];
  const deps = (env: Record<string, string | undefined>) => ({
    env: { ...env, BLOB_READ_WRITE_TOKEN: "t", ELEVENLABS_NARRATION_API_KEY: "k", FAMILY_NARRATION_BUDGET: "owner-test:20000" },
    headImpl: (async (p: string) => {
      if (!files.has(p)) throw new Error("404");
      return { uploadedAt: new Date(0) };
    }) as never,
    putImpl: (async (p: string) => {
      puts.push(p);
      if (p.endsWith(".mp3")) files.add(p);
      return {};
    }) as never,
    delImpl: (async () => {}) as never,
    listImpl: (async () => ({ blobs: [], hasMore: false })) as never,
    fetchImpl: (async (url: string, init?: { body?: string }) => {
      sent.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      if (url.endsWith("/settings")) return new Response(JSON.stringify({ stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1 }), { status: 200 });
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }) as never,
    now: () => 1,
  });
  return { files, puts, sent, deps };
}

describe("recording after the switch (mocked store with today's clips)", () => {
  const cat = served();
  const v6 = catalogKeysByVisit(isabelNow).get("v6")!;
  const released = new Set(releasedCatalog().map(catalogKey));
  const expected = cat.filter((l) => (l.slot === "de-female" && v6.has(catalogKey(l))) || (l.slot !== "de-female" && l.slot && !released.has(catalogKey(l))));
  const chars = (ls: NarrationLine[]) => ls.reduce((n, l) => n + l.text.length, 0);

  it("today's env: only the new lines are missing (Visit 5's new Ida lines + Santiago's new es/en lines)", async () => {
    const s = storeWithTodaysClips();
    const plan = await planNarration(cat, s.deps(ENV_TODAY));
    const newLines = cat.filter((l) => !released.has(catalogKey(l)));
    equal(plan.missing, newLines.length);
    equal(plan.missingCharacters, chars(newLines));
    console.log(`  [counts] today's voice: ${plan.missing} lines / ${plan.missingCharacters} characters missing — ${plan.groups.filter((g) => g.missing).map((g) => `${g.slot}(${g.voice}) ${g.missing}/${g.missingCharacters}`).join(", ")}`);
  });

  it("the dry run sends nothing and writes nothing, and predicts exactly what prepare-narration then records", async () => {
    const s = storeWithTodaysClips();
    const plan = await planNarration(cat, s.deps(ENV_SWITCHED));
    equal(s.sent.length, 0);
    equal(s.puts.length, 0);
    equal(plan.status, "planned");
    equal(plan.missing, expected.length);
    equal(plan.missingCharacters, chars(expected));
    const json = JSON.stringify(plan);
    ok(!json.includes(SABRINA) && !json.includes(AVA) && !cat.some((l) => json.includes(l.id)), "no ids in the plan");
    ok(!cat.slice(0, 50).some((l) => l.text.length > 12 && json.includes(l.text)), "no text in the plan");
    const deCur = plan.groups.find((g) => g.slot === "de-female" && g.voice === "current")!;
    const dePrev = plan.groups.find((g) => g.slot === "de-female" && g.voice === "previous")!;
    equal(dePrev.missing, 0);
    equal(deCur.missing, v6.size);
    console.log(`  [counts] after the switch: ${plan.missing} lines / ${plan.missingCharacters} characters (≈ $${plan.estimatedUsd}) — ${plan.groups.map((g) => `${g.slot}(${g.voice}${g.speed ? ` @${g.speed}` : ""}) ${g.missing}/${g.missingCharacters} of ${g.lines}`).join(", ")}`);
    const shared = expected.filter((l) => l.slot === "de-female" && released.has(catalogKey(l)));
    console.log(`  [counts] of the de-female lines: ${expected.filter((l) => l.slot === "de-female").length - shared.length} new (${chars(expected.filter((l) => l.slot === "de-female" && !released.has(catalogKey(l))))} ch) + ${shared.length} shared lines Visit 5 replays (${chars(shared)} ch)`);

    const r = await prepareNarration(cat, 20000, s.deps(ENV_SWITCHED));
    equal(r.status, "prepared");
    equal(r.recorded, expected.length);
    equal(r.charactersSent, chars(expected));
    const tts = s.sent.filter((x) => x.url.includes("/text-to-speech/"));
    deepStrictEqual(new Set(tts.map((x) => x.body!.text)), new Set(expected.map((l) => l.text)));
    ok(tts.every((x) => !x.url.includes(AVA)), "nothing re-recorded in Ava");
    ok(tts.every((x) => x.body!.voice_settings === undefined), "option (a): no provider speed");
    const after = await planNarration(cat, s.deps(ENV_SWITCHED));
    equal(after.missing, 0);
  });

  it("option (b): with a provider speed the slot voice's lines are recorded with the stored settings and only the speed changed", async () => {
    const s = storeWithTodaysClips();
    const env = { ...ENV_SWITCHED, FAMILY_NARRATION_SPEED_DE_FEMALE: "0.85" };
    const plan = await planNarration(cat, s.deps(env));
    equal(plan.missing, expected.length);
    equal(plan.groups.find((g) => g.slot === "de-female" && g.voice === "current")!.speed, 0.85);
    const r = await prepareNarration(cat, 20000, s.deps(env));
    equal(r.recorded, expected.length);
    equal(s.sent.filter((x) => x.url.endsWith("/settings")).length, 1, "settings read once");
    const de = s.sent.filter((x) => x.url.includes(`/text-to-speech/${SABRINA}`));
    equal(de.length, v6.size);
    ok(de.every((x) => JSON.stringify(x.body!.voice_settings) === JSON.stringify({ stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 0.85 })));
    ok(s.sent.filter((x) => x.url.includes("/text-to-speech/") && !x.url.includes(SABRINA)).every((x) => x.body!.voice_settings === undefined), "other slots unchanged");
  });

  it("the strict body of the dry run", () => {
    deepStrictEqual(parseNarrationPost({ confirm: "plan-narration" }), { ok: true, value: { mode: "plan-narration" } });
    equal(parseNarrationPost({ confirm: "plan-narration", maxCharacters: 10 }).ok, false);
    equal(parseNarrationPost({ confirm: "plan-narration", text: "x" }).ok, false);
    equal(parseNarrationPost({ confirm: "prepare-narration", maxCharacters: 10 }).ok, true);
  });

  it("the route dispatches the dry run before any paid mode, behind the same release-key guard", () => {
    const src = readFileSync(new URL("../app/api/family/learning/parent/narration/route.ts", import.meta.url), "utf8");
    const guard = src.indexOf("requireOwnerOrReleaseKey(request");
    const plan = src.indexOf('mode === "plan-narration"');
    ok(guard > 0 && plan > guard && plan < src.indexOf("recordAudition(maxCharacters)") && plan < src.indexOf("prepareNarration(servedNarrationCatalog()"));
    const clip = readFileSync(new URL("../app/api/family/learning/narration/[slot]/[id]/route.ts", import.meta.url), "utf8");
    ok(clip.includes("readNarrationClip(line)") && clip.includes("clipEtag(line)") && clip.includes("NARRATION_RATE_HEADER"));
  });
});
