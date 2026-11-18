// Nov 18, 2026 (item 16): the Studio game start asks the bridge for the Studio volume, fire-and-forget.
// Run with: npm test

import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fireStudioStartAudio, STUDIO_START_AUDIO_REASON } from "./family-studio-audio.ts";
import { createLearningClient } from "./family-learning-client.ts";

describe("fireStudioStartAudio", () => {
  it("sends exactly one studio-start for the child and returns before the call settles", async () => {
    const calls: Array<[string, string]> = [];
    let settle: (v: string) => void = () => {};
    const client = { deviceAudio: (child: "santiago" | "isabel", reason: string) => { calls.push([child, reason]); return new Promise<string>((r) => { settle = r; }); } };
    const result = fireStudioStartAudio(client, "santiago");
    equal(result, undefined, "nothing to await");
    deepStrictEqual(calls, [["santiago", "studio-start"]]);
    equal(STUDIO_START_AUDIO_REASON, "studio-start");
    settle("sent");
  });
  it("a rejected call is swallowed (no unhandled rejection)", async () => {
    let unhandled = 0;
    const onUnhandled = () => { unhandled += 1; };
    process.on("unhandledRejection", onUnhandled);
    try {
      fireStudioStartAudio({ deviceAudio: () => Promise.reject(new Error("bridge down")) }, "isabel");
      await new Promise((r) => setTimeout(r, 20));
      equal(unhandled, 0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
  it("a synchronous throw never reaches the game start", () => {
    fireStudioStartAudio({ deviceAudio: () => { throw new Error("boom"); } }, "santiago");
  });
  it("with the real client: an unreachable app/bridge is a quiet failure, and the start never waits on it", async () => {
    let fetches = 0;
    const client = createLearningClient({ fetchImpl: (async () => { fetches += 1; throw new TypeError("offline"); }) as unknown as typeof fetch, now: () => 1 });
    fireStudioStartAudio(client, "santiago");
    await new Promise((r) => setTimeout(r, 10));
    ok(fetches >= 1);
  });
});

describe("play start wiring (source)", () => {
  const guarded = readFileSync(new URL("../app/family/games/play/client.tsx", import.meta.url), "utf8");
  const native = readFileSync(new URL("../app/family/games/play/native-client.tsx", import.meta.url), "utf8");
  it("the guarded Studio player (every frame game and chess) fires once right after the lease starts play, not on a rollover", () => {
    const playing = guarded.indexOf('setPhase({ kind: "playing", grant: grant.value');
    const fire = guarded.indexOf("fireStudioStartAudio(audio, child)");
    ok(playing > 0 && fire > playing, "after the game is set playing");
    ok(guarded.slice(playing, fire).includes("rolloverReacquireRef.current"), "a rollover re-acquire does not set the volume again");
    ok(guarded.includes("rolloverReacquireRef.current = true;\n      setAttempt"), "rollover marks its re-acquire");
    ok(!/await\s+fireStudioStartAudio/.test(guarded), "never awaited");
    ok(!guarded.includes("isDailyChessGame(gameId) && fireStudioStartAudio") && !/if \(!chess[^)]*\) fireStudioStartAudio/.test(guarded), "chess is not excluded");
  });
  it("the native Mac launcher fires when the child opens the game, never awaited", () => {
    const click = native.indexOf("const onLaunchClick = useCallback(");
    const end = native.indexOf("}, [audio, child]);", click);
    ok(click > 0 && end > click);
    ok(native.slice(click, end).includes("fireStudioStartAudio(audio, child);"));
    ok(!/await\s+fireStudioStartAudio/.test(native));
  });
});
