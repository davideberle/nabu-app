// Visit 6 (V6-07): playing a reviewed listening text and reporting honestly whether playback reached its completion event.
//
// Order: the child voice route (via the shared speech player) → the browser's own speech in the text's language → "failed".
// Only the playback completion event (`ended` / `end`) counts as a completed play; an error, a missing speech engine or a timeout
// without it is "failed" —
// the child may try again or open the text (recorded help), and a play without a completion event never counts as listening.
// A completion event proves that playback ran to its end on the device — not that sound was audible or that the child listened.
// Isomorphic and dependency-free so `node --test` covers it with mocks.

export type ListenOutcome = "child-voice" | "browser" | "failed" | "cancelled";
export type VoiceResult = "played" | "fallback" | "cancelled";
export type BrowserSpeechResult = "ended" | "error" | "unavailable" | "timeout";

export type ListeningDeps = {
  /** The shared child speech player (`createChildSpeechPlayer().speak`). */
  voice: (text: string) => Promise<VoiceResult>;
  /** Browser speech for the same text; resolves how it ended. */
  browser: (text: string, language: string) => Promise<BrowserSpeechResult>;
};

export async function playListening(text: string, language: string, deps: ListeningDeps): Promise<ListenOutcome> {
  let voice: VoiceResult;
  try {
    voice = await deps.voice(text);
  } catch {
    voice = "fallback";
  }
  if (voice === "played") return "child-voice";
  if (voice === "cancelled") return "cancelled";
  let browser: BrowserSpeechResult;
  try {
    browser = await deps.browser(text, language);
  } catch {
    browser = "error";
  }
  return browser === "ended" ? "browser" : "failed";
}

export const SPEECH_LANG: Record<string, string> = { en: "en-GB", es: "es-ES", de: "de-CH" };

type SynthLike = { cancel: () => void; speak: (u: UtteranceLike) => void };
type UtteranceLike = { lang: string; rate: number; onend: (() => void) | null; onerror: (() => void) | null };

/** Browser speech with a bounded wait. Injectable for tests; the real client passes nothing. */
export function browserSpeech(env?: { synth?: SynthLike | null; makeUtterance?: (text: string) => UtteranceLike; setTimer?: (fn: () => void, ms: number) => unknown; clearTimer?: (t: unknown) => void }) {
  return (text: string, language: string): Promise<BrowserSpeechResult> => {
    const g = globalThis as unknown as { speechSynthesis?: SynthLike; SpeechSynthesisUtterance?: new (t: string) => UtteranceLike };
    const synth = env?.synth !== undefined ? env.synth : g.speechSynthesis ?? null;
    const make = env?.makeUtterance ?? (g.SpeechSynthesisUtterance ? (t: string) => new g.SpeechSynthesisUtterance!(t) : null);
    if (!synth || !make) return Promise.resolve("unavailable");
    const setTimer = env?.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    const clearTimer = env?.clearTimer ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>));
    return new Promise((resolve) => {
      let done = false;
      const finish = (r: BrowserSpeechResult) => {
        if (done) return;
        done = true;
        clearTimer(timer);
        resolve(r);
      };
      const timer = setTimer(() => finish("timeout"), Math.min(30000, 3000 + text.length * 90));
      try {
        synth.cancel();
        const u = make(text);
        u.lang = SPEECH_LANG[language] ?? language;
        u.rate = 0.9;
        u.onend = () => finish("ended");
        u.onerror = () => finish("error");
        synth.speak(u);
      } catch {
        finish("error");
      }
    });
  };
}
