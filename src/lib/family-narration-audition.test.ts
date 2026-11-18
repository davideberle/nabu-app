import { describe, it } from "node:test";
import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AUDITION_CHARACTERS, AUDITION_LINES, AUDITION_VOICES, auditionClipPathname, parseNarrationPost, recordAudition } from "./family-narration-audition.ts";
import { budgetSpent, clipPathname, isPublicSafeScript, prepareNarration, PREPARE_LOCK } from "./family-narration-store.ts";
import { guardWithReleaseKey, resetReleaseKeyLimit } from "./family-learning-release-key.ts";
import { narrationCatalog } from "./family-learning-narration.ts";
import { asIsabelContent } from "./family-learning-isabel.ts";

const catalogV2 = () => narrationCatalog(asIsabelContent(JSON.parse(readFileSync(new URL("../data/family-learning/content/isabel-workshop-v2.json", import.meta.url), "utf8"))));
import { VOICE_SLOTS, resolveSlotVoiceId } from "./family-voice-registry.ts";

/** In-memory store with the semantics the recorder relies on (same as the catalogue preparation tests). */
function fakeStore(initial: string[] = [], lockAgeMs: number | null = null) {
  const stored = new Map<string, { at: number; body: Uint8Array }>(initial.map((p) => [p, { at: Date.now(), body: new Uint8Array([9, 9]) }]));
  if (lockAgeMs !== null) stored.set(PREPARE_LOCK, { at: Date.now() - lockAgeMs, body: new Uint8Array([1]) });
  const sent: { url: string; key: string; body: { text: string; model_id: string } }[] = [];
  const order: string[] = [];
  return {
    stored,
    sent,
    order,
    deps(env: Record<string, string>, fetchOk: (n: number) => boolean | "throw" = () => true) {
      return {
        env,
        now: () => Date.now(),
        headImpl: (async (p: string) => { if (!stored.has(p)) throw new Error("not found"); return { uploadedAt: new Date(stored.get(p)!.at) }; }) as never,
        getImpl: (async (p: string) => { const b = stored.get(p); if (!b) return null; return { stream: new Response(new Blob([b.body as BlobPart])).body }; }) as never,
        putImpl: (async (p: string, b: unknown, o: { allowOverwrite?: boolean }) => {
          if (!b) throw new Error("body is required");
          if (o.allowOverwrite === false && stored.has(p)) throw new Error("exists");
          if (p.includes("/budget/")) order.push("reserve");
          stored.set(p, { at: Date.now(), body: typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b as Buffer) });
          return {};
        }) as never,
        delImpl: (async (p: string) => { stored.delete(p); }) as never,
        listImpl: (async ({ prefix }: { prefix: string }) => ({ blobs: [...stored.keys()].filter((k) => k.startsWith(prefix)).map((pathname) => ({ pathname })), hasMore: false })) as never,
        fetchImpl: (async (url: string, init: RequestInit) => {
          order.push("send");
          sent.push({ url, key: (init.headers as Record<string, string>)["xi-api-key"], body: JSON.parse(String(init.body)) });
          const v = fetchOk(sent.length);
          if (v === "throw") throw new Error("network");
          return v ? new Response(new Uint8Array([0xff, 0xfb, sent.length])) : new Response("no", { status: 401 });
        }) as unknown as typeof fetch,
      };
    },
  };
}

const ENV = { ELEVENLABS_NARRATION_API_KEY: "rec-key", ELEVENLABS_API_KEY: "shared-key", BLOB_READ_WRITE_TOKEN: "t", ELEVENLABS_VOICE_DE_FEMALE_ID: "AnvlJBAqSLDzEevYr9Ap", FAMILY_NARRATION_BUDGET: "test-approval:5000" };
const TOTAL = AUDITION_VOICES.length * AUDITION_LINES.length;

describe("voice audition — the fixed list", () => {
  it("four native German candidates × two fixed Ida lines; no Ava, no Hannah, no child name, Swiss spelling, ≤ 160 characters", () => {
    equal(AUDITION_VOICES.length, 4);
    equal(AUDITION_LINES.length, 2);
    equal(new Set(AUDITION_VOICES.map((v) => v.voiceId)).size, 4);
    equal(new Set(AUDITION_VOICES.map((v) => v.key)).size, 4);
    ok(!AUDITION_VOICES.some((v) => v.voiceId === "AnvlJBAqSLDzEevYr9Ap" || /ava|hannah/i.test(v.label)));
    ok(AUDITION_LINES.every((l) => isPublicSafeScript(l.text) && !/ß/.test(l.text)));
    const perVoice = AUDITION_LINES.reduce((n, l) => n + l.text.length, 0);
    ok(perVoice <= 160, `${perVoice}`);
    equal(AUDITION_CHARACTERS, perVoice * 4);
    ok(AUDITION_CHARACTERS * 0.08 / 1000 < 1, "well under $1 at $0.08 per 1,000 characters");
    ok(Object.isFrozen(AUDITION_VOICES) && AUDITION_VOICES.every((v) => Object.isFrozen(v)) && Object.isFrozen(AUDITION_LINES));
  });
  it("audition clips live under their own prefix, which the child clip path can never produce", () => {
    const p = auditionClipPathname("annika", 1);
    equal(p, "family-narration/audition-20261118/annika/line1.mp3");
    const child = clipPathname("ViKqgJNeCiWZlYgHiAOO", catalogV2()[0].id);
    ok(/^family-narration\/[0-9a-f]{12}\/n[0-9a-f]{28}\.mp3$/.test(child));
    ok(!/^family-narration\/[0-9a-f]{12}\//.test(p));
  });
  it("audition voices are not child-facing: no slot resolves to one by default, and no child route imports the module", () => {
    for (const slot of VOICE_SLOTS) {
      const id = resolveSlotVoiceId(slot, {});
      ok(!AUDITION_VOICES.some((v) => v.voiceId === id), slot);
    }
    const api = fileURLToPath(new URL("../app/api", import.meta.url));
    const files = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? files(join(d, n)) : [join(d, n)]));
    const users = files(api).filter((f) => readFileSync(f, "utf8").includes("family-narration-audition"));
    deepStrictEqual(users.map((f) => f.slice(api.length + 1)), ["family/learning/parent/narration/route.ts"]);
    const comps = fileURLToPath(new URL("../components", import.meta.url));
    ok(!files(comps).some((f) => readFileSync(f, "utf8").includes("family-narration-audition")), "no client component imports it");
  });
});

describe("voice audition — strict body", () => {
  it("accepts exactly confirm + maxCharacters, for both modes", () => {
    deepStrictEqual(parseNarrationPost({ confirm: "record-audition", maxCharacters: 600 }), { ok: true, value: { mode: "record-audition", maxCharacters: 600 } });
    deepStrictEqual(parseNarrationPost({ confirm: "prepare-narration", maxCharacters: 1200 }), { ok: true, value: { mode: "prepare-narration", maxCharacters: 1200 } });
  });
  it("refuses any other key (text, voice, voiceId, lines), any other confirm, and a bad cap — with the former messages", () => {
    for (const extra of [{ text: "Hallo" }, { voice: "x" }, { voiceId: "AnvlJBAqSLDzEevYr9Ap" }, { lines: [1] }, { model_id: "eleven_v3" }]) {
      const r = parseNarrationPost({ confirm: "record-audition", maxCharacters: 600, ...extra });
      equal(r.ok, false, JSON.stringify(extra));
      equal(!r.ok && r.error, "Body accepts exactly confirm and maxCharacters (no text: only the reviewed catalogue is ever recorded)");
    }
    for (const bad of [null, [], "record-audition", 5]) equal(parseNarrationPost(bad).ok, false);
    for (const c of ["Record-Audition", "audition", "", undefined]) {
      const r = parseNarrationPost({ confirm: c, maxCharacters: 600 });
      equal(!r.ok && r.error, "confirm must be \"prepare-narration\"");
    }
    for (const m of [0, -1, 1.5, "600", 20001, null]) {
      const r = parseNarrationPost({ confirm: "record-audition", maxCharacters: m });
      equal(!r.ok && r.error, "maxCharacters must be an integer between 1 and 20000");
    }
  });
});

describe("voice audition — access (release key like the existing recording)", () => {
  const KEY = "synthetic-release-key-0123456789-abcdefghijk";
  const noOwner = async () => ({ ok: false as const, status: 401, error: "Unauthorized" });
  it("the release key opens the narration POST; a wrong key is 401", async () => {
    resetReleaseKeyLimit();
    deepStrictEqual(await guardWithReleaseKey({ authorization: `Bearer ${KEY}`, route: "narration-recording", owner: noOwner, env: { FAMILY_RELEASE_TOKEN: KEY }, log: () => {} }), { ok: true, via: "release-key" });
    const wrong = await guardWithReleaseKey({ authorization: "Bearer wrong-key", route: "narration-recording", owner: noOwner, env: { FAMILY_RELEASE_TOKEN: KEY }, log: () => {} });
    equal(!wrong.ok && wrong.status, 401);
  });
  it("the route guards first, then parses strictly, then dispatches; the audition gets only the cap", () => {
    const src = readFileSync(fileURLToPath(new URL("../app/api/family/learning/parent/narration/route.ts", import.meta.url)), "utf8");
    const post = src.split("export async function POST")[1];
    ok(post.indexOf('requireOwnerOrReleaseKey(request, "narration-recording")') < post.indexOf("request.json()"));
    ok(post.indexOf("parseNarrationPost(body)") < post.indexOf("recordAudition("));
    ok(post.includes("recordAudition(maxCharacters)"), "nothing but the cap is passed");
  });
});

describe("voice audition — the paid run (mocked)", () => {
  it("records the 8 fixed clips with the recording key, multilingual_v2 and the fixed voices; returns label, line, base64", async () => {
    const st = fakeStore();
    const r = await recordAudition(5000, st.deps(ENV));
    equal(r.status, "recorded");
    equal(r.recorded, TOTAL);
    equal(r.charactersSent, AUDITION_CHARACTERS);
    equal(st.sent.length, TOTAL);
    ok(st.sent.every((x) => x.key === "rec-key" && x.body.model_id === "eleven_multilingual_v2" && x.url.endsWith("?output_format=mp3_44100_128")));
    deepStrictEqual(st.sent.map((x) => x.url.split("/text-to-speech/")[1].split("?")[0]), AUDITION_VOICES.flatMap((v) => [v.voiceId, v.voiceId]));
    deepStrictEqual(st.sent.map((x) => x.body.text), AUDITION_VOICES.flatMap(() => AUDITION_LINES.map((l) => l.text)));
    ok(!st.sent.some((x) => x.url.includes("AnvlJBAqSLDzEevYr9Ap")), "the configured slot voice is never used");
    deepStrictEqual(r.clips.map((c) => `${c.label}-${c.line}-${c.status}`), AUDITION_VOICES.flatMap((v) => [`${v.label}-1-recorded`, `${v.label}-2-recorded`]));
    ok(r.clips.every((c) => typeof c.audioBase64 === "string" && Buffer.from(c.audioBase64, "base64")[0] === 0xff));
    for (const v of AUDITION_VOICES) for (const l of AUDITION_LINES) ok(st.stored.has(auditionClipPathname(v.key, l.line)));
    const json = JSON.stringify(r);
    ok(!json.includes("rec-key") && !AUDITION_VOICES.some((v) => json.includes(v.voiceId)) && !json.includes("Rotkehlchen"), "no key, voice id or text in the result");
    ok(!st.stored.has(PREPARE_LOCK), "lock released");
  });
  it("every request is reserved in the owner ledger before it is sent", async () => {
    const st = fakeStore();
    await recordAudition(5000, st.deps(ENV));
    deepStrictEqual(st.order, Array.from({ length: TOTAL }, () => ["reserve", "send"]).flat());
    const spent = await budgetSpent("test-approval", "t", st.deps(ENV));
    deepStrictEqual(spent, { characters: AUDITION_CHARACTERS, requests: TOTAL });
  });
  it("an idempotent re-run sends nothing, reserves nothing and returns the stored clips", async () => {
    const st = fakeStore();
    await recordAudition(5000, st.deps(ENV));
    const sentBefore = st.sent.length;
    const ledgerBefore = [...st.stored.keys()].filter((k) => k.includes("/budget/")).length;
    const again = await recordAudition(5000, st.deps(ENV));
    equal(again.status, "recorded");
    equal(again.recorded, 0);
    equal(again.existing, TOTAL);
    equal(again.charactersSent, 0);
    equal(st.sent.length, sentBefore);
    equal([...st.stored.keys()].filter((k) => k.includes("/budget/")).length, ledgerBefore);
    ok(again.clips.every((c) => c.status === "existing" && c.audioBase64));
  });
  it("stops on the first failure (no retry); the failed request stays counted; the next run resumes with only the missing clips", async () => {
    const st = fakeStore();
    const first = await recordAudition(5000, st.deps(ENV, (n) => n <= 3));
    equal(first.status, "upstream-failed");
    equal(first.failedStatus, 401);
    equal(first.recorded, 3);
    equal(st.sent.length, 4);
    equal(first.budget?.requests, 4);
    const second = await recordAudition(5000, st.deps(ENV, () => "throw"));
    equal(second.status, "upstream-failed");
    equal(second.failedStatus, 0);
    equal(st.sent.length, 5);
    const third = await recordAudition(5000, st.deps(ENV));
    equal(third.status, "recorded");
    equal(third.recorded, TOTAL - 3);
    equal(third.existing, 3);
    equal(st.sent.length, 5 + TOTAL - 3);
  });
  it("holds the owner budget and the cap; without a budget, key or store nothing is sent", async () => {
    const perLine = AUDITION_LINES.map((l) => l.text.length);
    const tight = fakeStore();
    const r = await recordAudition(5000, tight.deps({ ...ENV, FAMILY_NARRATION_BUDGET: `test-approval:${perLine[0] + perLine[1] + 1}` }));
    equal(r.status, "budget-reached");
    equal(tight.sent.length, 2);
    const capped = fakeStore();
    const c = await recordAudition(perLine[0], capped.deps(ENV));
    equal(c.status, "cap-reached");
    equal(capped.sent.length, 1);
    for (const env of [{ ...ENV, FAMILY_NARRATION_BUDGET: "" }, { ...ENV, ELEVENLABS_NARRATION_API_KEY: "" }, { ...ENV, BLOB_READ_WRITE_TOKEN: "" }]) {
      const st = fakeStore();
      const out = await recordAudition(5000, st.deps(env));
      ok(["no-budget", "not-configured"].includes(out.status), out.status);
      equal(st.sent.length, 0);
      equal(st.stored.size, 0);
    }
    const unreadable = fakeStore();
    equal((await recordAudition(5000, { ...unreadable.deps(ENV), listImpl: (async () => { throw new Error("down"); }) as never })).status, "budget-unavailable");
    equal(unreadable.sent.length, 0);
  });
  it("shares the global lock with the catalogue preparation: a live lock means «busy» and nothing is sent", async () => {
    const live = fakeStore([], 60_000);
    equal((await recordAudition(5000, live.deps(ENV))).status, "busy");
    equal(live.sent.length, 0);
    const st = fakeStore();
    const catalog = catalogV2().slice(0, 5);
    const [a, b] = await Promise.all([recordAudition(5000, st.deps(ENV)), prepareNarration(catalog, 99999, st.deps(ENV))]);
    ok([a.status, b.status].includes("busy"), `${a.status} ${b.status}`);
  });
});
