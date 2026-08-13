// Unit tests for the ElevenLabs speech playback controller.
//
// What matters here is the lifecycle, not the audio: stale replies never
// speak over newer ones, every failure routes to the browser-synthesis
// fallback instead of silence-with-no-signal, object URLs are always revoked,
// and cancellation settles the in-flight promise as "cancelled" so the caller
// knows not to fall back over the top of a newer turn.
//
// Run with: npm test  (node --test; types stripped natively)

import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHILD_TTS_PATH,
  MAX_SPEAKABLE_CHARS,
  createChildSpeechPlayer,
  type AudioLike,
} from "./family-speech.ts";

/** A controllable stand-in for HTMLAudioElement. */
function fakeAudio() {
  const element: AudioLike & {
    played: string[];
    paused: number;
    playCalls: number;
    finish: () => void;
    fail: () => void;
    playShouldReject: boolean;
  } = {
    src: "",
    played: [],
    paused: 0,
    playCalls: 0,
    playShouldReject: false,
    onended: null,
    onerror: null,
    play() {
      element.playCalls += 1;
      if (element.playShouldReject) return Promise.reject(new Error("blocked"));
      element.played.push(element.src);
      return Promise.resolve();
    },
    pause() {
      element.paused += 1;
    },
    finish() {
      element.onended?.();
    },
    fail() {
      element.onerror?.();
    },
  };
  return element;
}

function makeDeps(options: { status?: number; failFetch?: boolean } = {}) {
  const calls: { url: string; body: unknown }[] = [];
  const revoked: string[] = [];
  let created = 0;
  const audio = fakeAudio();
  const deps = {
    fetchImpl: (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      if (options.failFetch) throw new Error("network down");
      if (init?.signal?.aborted) throw new Error("aborted");
      return new Response(new Uint8Array([9, 9]).buffer, {
        status: options.status ?? 200,
        headers: { "Content-Type": "audio/mpeg" },
      });
    }) as typeof fetch,
    createAudio: () => audio,
    createObjectUrl: () => `blob:fake-${(created += 1)}`,
    revokeObjectUrl: (url: string) => revoked.push(url),
  };
  return { deps, audio, calls, revoked };
}

describe("createChildSpeechPlayer.speak", () => {
  it("fetches child speech from the TTS route and resolves played on ended", async () => {
    const { deps, audio, calls, revoked } = makeDeps();
    const player = createChildSpeechPlayer(deps);
    const pending = player.speak({ childId: "santiago", text: "Hi!" });
    // Let the fetch/microtasks settle, then end playback.
    await new Promise((resolve) => setImmediate(resolve));
    audio.finish();
    equal(await pending, "played");
    equal(calls.length, 1);
    equal(calls[0].url, CHILD_TTS_PATH);
    deepStrictEqual(calls[0].body, { childId: "santiago", text: "Hi!" });
    deepStrictEqual(audio.played, ["blob:fake-1"]);
    deepStrictEqual(revoked, ["blob:fake-1"]);
  });

  it("falls back when the route refuses", async () => {
    const { deps } = makeDeps({ status: 503 });
    const player = createChildSpeechPlayer(deps);
    equal(await player.speak({ childId: "isabel", text: "Hi!" }), "fallback");
  });

  it("falls back when the network fails", async () => {
    const { deps } = makeDeps({ failFetch: true });
    const player = createChildSpeechPlayer(deps);
    equal(await player.speak({ childId: "isabel", text: "Hi!" }), "fallback");
  });

  it("falls back when playback is blocked, revoking the URL", async () => {
    const { deps, audio, revoked } = makeDeps();
    audio.playShouldReject = true;
    const player = createChildSpeechPlayer(deps);
    equal(await player.speak({ childId: "santiago", text: "Hi!" }), "fallback");
    deepStrictEqual(revoked, ["blob:fake-1"]);
  });

  it("falls back when the audio element errors mid-play", async () => {
    const { deps, audio, revoked } = makeDeps();
    const player = createChildSpeechPlayer(deps);
    const pending = player.speak({ childId: "santiago", text: "Hi!" });
    await new Promise((resolve) => setImmediate(resolve));
    audio.fail();
    equal(await pending, "fallback");
    deepStrictEqual(revoked, ["blob:fake-1"]);
  });

  it("refuses overlong text locally instead of sending a doomed request", async () => {
    const { deps, calls } = makeDeps();
    const player = createChildSpeechPlayer(deps);
    equal(
      await player.speak({ childId: "santiago", text: "a".repeat(MAX_SPEAKABLE_CHARS + 1) }),
      "fallback",
    );
    equal(calls.length, 0);
  });

  it("resolves fallback — not an unhandled rejection — when createObjectUrl throws", async () => {
    const audio = fakeAudio();
    const player = createChildSpeechPlayer({
      fetchImpl: (async () =>
        new Response(new ArrayBuffer(2), { status: 200 })) as typeof fetch,
      createAudio: () => audio,
      createObjectUrl: () => {
        throw new Error("quota exceeded");
      },
      revokeObjectUrl: () => {},
    });
    equal(await player.speak({ childId: "santiago", text: "Hi!" }), "fallback");
    // The blob never reached the element.
    deepStrictEqual(audio.played, []);
  });

  it("falls back where no Audio exists (server render, ancient browser)", async () => {
    const player = createChildSpeechPlayer({
      fetchImpl: (async () => new Response(new ArrayBuffer(1))) as typeof fetch,
      createAudio: () => null,
    });
    equal(await player.speak({ childId: "santiago", text: "Hi!" }), "fallback");
  });
});

describe("cancellation and staleness", () => {
  it("a newer speak() supersedes the old one, which resolves cancelled", async () => {
    const { deps, audio } = makeDeps();
    const player = createChildSpeechPlayer(deps);
    const first = player.speak({ childId: "santiago", text: "First" });
    await new Promise((resolve) => setImmediate(resolve));
    const second = player.speak({ childId: "santiago", text: "Second" });
    equal(await first, "cancelled");
    await new Promise((resolve) => setImmediate(resolve));
    audio.finish();
    equal(await second, "played");
  });

  it("cancel() stops playback, revokes the URL, and settles the promise", async () => {
    const { deps, audio, revoked } = makeDeps();
    const player = createChildSpeechPlayer(deps);
    const pending = player.speak({ childId: "santiago", text: "Hi!" });
    await new Promise((resolve) => setImmediate(resolve));
    player.cancel();
    equal(await pending, "cancelled");
    ok(audio.paused >= 1);
    deepStrictEqual(revoked, ["blob:fake-1"]);
    // A late ended event from the cancelled audio is inert.
    audio.finish();
  });

  it("cancel() before the response arrives resolves cancelled, not fallback", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const audio = fakeAudio();
    const player = createChildSpeechPlayer({
      fetchImpl: (async () => {
        await gate;
        return new Response(new ArrayBuffer(1), { status: 200 });
      }) as typeof fetch,
      createAudio: () => audio,
      createObjectUrl: () => "blob:late",
      revokeObjectUrl: () => {},
    });
    const pending = player.speak({ childId: "santiago", text: "Hi!" });
    player.cancel();
    release();
    equal(await pending, "cancelled");
    // The stale audio never reached the element.
    deepStrictEqual(audio.played, []);
  });
});

describe("unlock", () => {
  it("primes the shared audio element from a gesture and is idempotent", () => {
    const { deps, audio } = makeDeps();
    const player = createChildSpeechPlayer(deps);
    player.unlock();
    const primedSrc = audio.src;
    ok(primedSrc.startsWith("data:audio/wav;base64,"));
    player.unlock();
    equal(audio.src, primedSrc);
  });

  it("never throws when audio is unavailable", () => {
    const player = createChildSpeechPlayer({ createAudio: () => null });
    player.unlock();
  });

  it("retries after a rejected silent play instead of latching locked", async () => {
    const { deps, audio } = makeDeps();
    audio.playShouldReject = true;
    const player = createChildSpeechPlayer(deps);

    player.unlock();
    await new Promise((resolve) => setImmediate(resolve));
    equal(audio.playCalls, 1);

    // Safari honors the next tap: the retry must actually attempt play again.
    audio.playShouldReject = false;
    player.unlock();
    await new Promise((resolve) => setImmediate(resolve));
    equal(audio.playCalls, 2);

    // Now that a silent play succeeded, unlock is latched and idempotent.
    player.unlock();
    equal(audio.playCalls, 2);
  });
});
