import { deepEqual, equal, match, ok } from "node:assert/strict";
import vm from "node:vm";
import { describe, it } from "node:test";

import {
  BROWSER_AUDIO_GUARD_SCRIPT,
  FAMILY_TTS_ROUTE,
  audioSafeChromiumLaunchOptions,
  installBrowserAudioGuard,
} from "../../scripts/lib/browser-audio-guard.mjs";

describe("Family Assistant browser-test audio guard", () => {
  it("always launches Chromium muted without dropping fake microphone flags", () => {
    const options = audioSafeChromiumLaunchOptions({
      headless: true,
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--use-file-for-fake-audio-capture=/tmp/silent-mic.wav",
      ],
    });
    deepEqual(options.args, [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--use-file-for-fake-audio-capture=/tmp/silent-mic.wav",
      "--mute-audio",
    ]);
    equal(options.headless, true);
    equal(audioSafeChromiumLaunchOptions({ args: ["--mute-audio"] }).args.length, 1);
  });

  it("installs the guard before pages and refuses the real Family TTS route", async () => {
    const calls: string[] = [];
    let routePattern: RegExp | undefined;
    let routeHandler: ((route: { abort(reason: string): void }) => void) | undefined;
    const context = {
      async addInitScript(script: { content: string }) {
        calls.push("init");
        equal(script.content, BROWSER_AUDIO_GUARD_SCRIPT);
      },
      async route(pattern: RegExp, handler: typeof routeHandler) {
        calls.push("route");
        routePattern = pattern;
        routeHandler = handler;
      },
    };

    await installBrowserAudioGuard(context);
    deepEqual(calls, ["init", "route"]);
    ok(routePattern?.test("https://example.test/api/family/assistant/tts"));
    ok(routePattern?.test("https://example.test/api/family/assistant/tts?child=santiago"));
    equal(routePattern?.test("https://example.test/api/family/assistant/turn"), false);

    let refusal = "";
    routeHandler?.({ abort(reason) { refusal = reason; } });
    equal(refusal, "blockedbyclient");
    equal(routePattern, FAMILY_TTS_ROUTE);
  });

  it("blocks speech, media, Audio, and Web Audio output pathways", async () => {
    let speechCalls = 0;
    let nativePlayCalls = 0;
    let nativeStartCalls = 0;
    let suspendCalls = 0;

    class HTMLMediaElement {
      autoplay = true;
      muted = false;
      volume = 1;
      play() { nativePlayCalls++; return Promise.reject(new Error("native play called")); }
    }
    class Audio extends HTMLMediaElement {}
    class AudioContext {
      resume() { return Promise.reject(new Error("native resume called")); }
      suspend() { suspendCalls++; return Promise.resolve(); }
    }
    class AudioScheduledSourceNode { start() { nativeStartCalls++; } }

    const sandbox = {
      Promise,
      Proxy,
      Reflect,
      Object,
      HTMLMediaElement,
      Audio,
      AudioContext,
      AudioScheduledSourceNode,
      speechSynthesis: {
        speak() { speechCalls++; },
        cancel() {},
      },
    };
    vm.runInNewContext(BROWSER_AUDIO_GUARD_SCRIPT, sandbox);

    sandbox.speechSynthesis.speak();
    const audio = new sandbox.Audio();
    await audio.play();
    const context = new sandbox.AudioContext();
    await context.resume();
    new sandbox.AudioScheduledSourceNode().start();

    equal(speechCalls, 0);
    equal(nativePlayCalls, 0);
    equal(nativeStartCalls, 0);
    equal(suspendCalls, 1);
    equal(audio.autoplay, false);
    equal(audio.muted, true);
    equal(audio.volume, 0);
  });

  it("pins the fail-closed pathways in the init script", () => {
    match(BROWSER_AUDIO_GUARD_SCRIPT, /speechSynthesis/);
    match(BROWSER_AUDIO_GUARD_SCRIPT, /HTMLMediaElement/);
    match(BROWSER_AUDIO_GUARD_SCRIPT, /AudioScheduledSourceNode/);
    match(BROWSER_AUDIO_GUARD_SCRIPT, /AudioContext/);
  });
});
