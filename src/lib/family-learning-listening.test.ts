import { equal } from "node:assert/strict";
import { describe, it } from "node:test";
import { browserSpeech, playListening, type BrowserSpeechResult, type VoiceResult } from "./family-learning-listening.ts";

const voice = (r: VoiceResult | "throw") => async () => {
  if (r === "throw") throw new Error("network");
  return r;
};
const browser = (r: BrowserSpeechResult) => async () => r;

describe("V6-07 listening playback — mocked outcomes (no audio)", () => {
  it("child voice played → completedPlays via the child voice; the browser is not used", async () => {
    let used = false;
    equal(await playListening("x", "en", { voice: voice("played"), browser: async () => ((used = true), "ended") }), "child-voice");
    equal(used, false);
  });
  it("child voice fails → browser speech that ends → completedPlays via the browser", async () => {
    equal(await playListening("x", "en", { voice: voice("fallback"), browser: browser("ended") }), "browser");
    equal(await playListening("x", "en", { voice: voice("throw"), browser: browser("ended") }), "browser");
  });
  it("both fail, no speech engine, or no end confirmation → failed (never completedPlays)", async () => {
    for (const b of ["error", "unavailable", "timeout"] as const) equal(await playListening("x", "es", { voice: voice("fallback"), browser: browser(b) }), "failed");
  });
  it("a superseded play is cancelled and reports nothing", async () => {
    equal(await playListening("x", "en", { voice: voice("cancelled"), browser: browser("ended") }), "cancelled");
  });
  it("browserSpeech: end, error, missing engine and a timeout are told apart; the language tag follows the text", async () => {
    const make = () => ({ lang: "", rate: 1, onend: null as (() => void) | null, onerror: null as (() => void) | null });
    let last: ReturnType<typeof make> | null = null;
    const synth = (mode: "end" | "error" | "silent") => ({ cancel() {}, speak(u: ReturnType<typeof make>) { last = u; if (mode === "end") u.onend?.(); if (mode === "error") u.onerror?.(); } });
    let fire: (() => void) | null = null;
    const timers = { setTimer: (fn: () => void) => ((fire = fn), 1), clearTimer: () => {} };
    equal(await browserSpeech({ synth: synth("end"), makeUtterance: make, ...timers })("Hello", "en"), "ended");
    equal(last!.lang, "en-GB");
    equal(await browserSpeech({ synth: synth("error"), makeUtterance: make, ...timers })("Hola", "es"), "error");
    equal(last!.lang, "es-ES");
    equal(await browserSpeech({ synth: null, makeUtterance: make, ...timers })("x", "en"), "unavailable");
    const pending = browserSpeech({ synth: synth("silent"), makeUtterance: make, ...timers })("x", "en");
    fire!();
    equal(await pending, "timeout");
  });
});
