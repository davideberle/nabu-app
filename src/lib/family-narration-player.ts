// ---------------------------------------------------------------------------------------------------------------------
// Visit narration player (Isabel Visit 2, 2026-10-29; I2-04 / I2-06) — HOW a narration script is spoken.
//
// One player per page, one script at a time:
//  - nothing plays before `unlock()` — called only from the child's deliberate tap (Start, or «Vorlesen» after a reload);
//  - `play(script)` supersedes whatever was playing (sequence number): late audio of an old screen is dropped, never spoken
//    over the new one; `stop()` silences everything and leaves the screen as it is; nothing ever advances the visit;
//  - each line: the PRERECORDED clip of the reviewed text (authenticated clip route, catalogued lines only) → else the
//    device's own speech with an explicitly chosen GERMAN voice → else nothing («unavailable»: no German voice on this
//    device). Never the device's default voice: an English voice reading German is not a fallback (I2-06);
//  - a refused play() (autoplay policy after a reload) is reported as «blocked» so the UI can offer one big «Vorlesen» tap;
//  - every exit path revokes object URLs; a bounded timer ends a line whose device never reports its end.
// A played line proves only that the device reported playback, not that it was audible or understood.
// Isomorphic and dependency-free so `node --test` covers it with fakes; the real client passes nothing.
// ---------------------------------------------------------------------------------------------------------------------

import type { NarrationLine, NarrationScript } from "./family-learning-narration.ts";

export const NARRATION_CLIP_PATH = "/api/family/learning/narration";

export type NarrationStatus = "locked" | "idle" | "speaking" | "blocked" | "unavailable";
export type LineOutcome = "recorded" | "device-de" | "no-german-voice" | "blocked" | "failed";
export type PlayResult = "done" | "cancelled" | "locked" | "blocked" | "unavailable";

export type VoiceLike = { name: string; lang: string; localService?: boolean; default?: boolean };
type UtteranceLike = { lang: string; rate: number; voice?: unknown; onend: (() => void) | null; onerror: ((e?: { error?: string }) => void) | null };
type SynthLike = { cancel: () => void; speak: (u: UtteranceLike) => void; getVoices: () => VoiceLike[]; addEventListener?: (t: string, fn: () => void) => void; removeEventListener?: (t: string, fn: () => void) => void };
type AudioLike = { src: string; play: () => Promise<void> | void; pause: () => void; onended: (() => void) | null; onerror: (() => void) | null };

export type NarrationPlayerDeps = {
  /** Fetch the prerecorded clip of one line, or null when none is recorded (404/503/network). */
  fetchClip?: (line: NarrationLine, signal: AbortSignal) => Promise<Blob | null>;
  createAudio?: () => AudioLike | null;
  createObjectUrl?: (b: Blob) => string;
  revokeObjectUrl?: (u: string) => void;
  synth?: SynthLike | null;
  makeUtterance?: (text: string) => UtteranceLike;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  onStatus?: (s: NarrationStatus) => void;
  onLine?: (line: NarrationLine, outcome: LineOutcome, voice: string | null) => void;
};

export type NarrationPlayer = {
  unlock: () => void;
  isUnlocked: () => boolean;
  play: (script: NarrationScript) => Promise<PlayResult>;
  stop: () => void;
  status: () => NarrationStatus;
  /** How the most recent line of the most recent `play` ended (null before any line). */
  lastLineOutcome: () => LineOutcome | null;
};

/** Novelty / effect voices macOS lists under German too — never used to read to a child. */
const NOVELTY = /^(eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|ralph|kathy)\b/i;

/** The best German voice of the device, or null. Swiss/German locales only; enhanced/premium and Google voices first. */
export function pickGermanVoice(voices: readonly VoiceLike[]): VoiceLike | null {
  const german = voices.filter((v) => /^de([-_]|$)/i.test(v.lang ?? ""));
  if (!german.length) return null;
  const score = (v: VoiceLike) => (NOVELTY.test(v.name) ? -10 : 0) + (/premium|enhanced|erweitert|natural|neural/i.test(v.name) ? 4 : 0) + (/google/i.test(v.name) ? 3 : 0) + (/^de[-_]ch/i.test(v.lang) ? 1 : 0) + (/^(anna|helena|petra|markus|yannick|viktor|martin)\b/i.test(v.name) ? 2 : 0);
  const best = [...german].sort((a, b) => score(b) - score(a))[0];
  return best && score(best) > -10 ? best : null;
}

const defaultFetchClip = async (l: NarrationLine, signal: AbortSignal): Promise<Blob | null> => {
  try {
    const r = await fetch(`${NARRATION_CLIP_PATH}/${encodeURIComponent(l.id)}`, { cache: "force-cache", signal, credentials: "same-origin" });
    if (!r.ok) return null;
    const type = r.headers.get("content-type") ?? "";
    return type.startsWith("audio/") ? await r.blob() : null;
  } catch {
    return null;
  }
};

export function createNarrationPlayer(deps: NarrationPlayerDeps = {}): NarrationPlayer {
  const g = globalThis as unknown as { speechSynthesis?: SynthLike; SpeechSynthesisUtterance?: new (t: string) => UtteranceLike; Audio?: new () => AudioLike };
  const fetchClip = deps.fetchClip ?? defaultFetchClip;
  const createAudio = deps.createAudio ?? (() => (g.Audio ? new g.Audio() : null));
  const createObjectUrl = deps.createObjectUrl ?? ((b: Blob) => URL.createObjectURL(b));
  const revokeObjectUrl = deps.revokeObjectUrl ?? ((u: string) => URL.revokeObjectURL(u));
  const synth = deps.synth !== undefined ? deps.synth : g.speechSynthesis ?? null;
  const makeUtterance = deps.makeUtterance ?? (g.SpeechSynthesisUtterance ? (t: string) => new g.SpeechSynthesisUtterance!(t) : null);
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>));

  let unlocked = false;
  let seq = 0;
  let current: NarrationStatus = "locked";
  let audio: AudioLike | null | undefined;
  let url: string | null = null;
  let abort: AbortController | null = null;
  let finishLine: ((r: "ended" | "error" | "blocked" | "cancelled") => void) | null = null;
  let lastOutcome: LineOutcome | null = null;

  const setStatus = (s: NarrationStatus) => {
    current = s;
    deps.onStatus?.(s);
  };
  const ensureAudio = () => (audio === undefined ? (audio = createAudio()) : audio);
  const release = () => {
    if (url) {
      try {
        revokeObjectUrl(url);
      } catch {
        /* already revoked */
      }
      url = null;
    }
  };
  const silence = () => {
    abort?.abort();
    abort = null;
    const a = audio;
    if (a) {
      a.onended = null;
      a.onerror = null;
      try {
        a.pause();
      } catch {
        /* nothing playing */
      }
    }
    try {
      synth?.cancel();
    } catch {
      /* no engine */
    }
    release();
    finishLine?.("cancelled");
    finishLine = null;
  };

  async function voices(): Promise<VoiceLike[]> {
    if (!synth) return [];
    let list = synth.getVoices?.() ?? [];
    if (list.length || !synth.addEventListener) return list;
    // Chrome fills the list asynchronously: wait briefly for `voiceschanged`.
    await new Promise<void>((resolve) => {
      const done = () => {
        synth.removeEventListener?.("voiceschanged", done);
        clearTimer(t);
        resolve();
      };
      const t = setTimer(done, 1500);
      synth.addEventListener!("voiceschanged", done);
    });
    list = synth.getVoices?.() ?? [];
    return list;
  }

  /** Waits for one line's end; a device that never reports it is ended by a bounded timer (never blocks the next screen). */
  const waitLine = (text: string, start: () => void) =>
    new Promise<"ended" | "error" | "blocked" | "cancelled">((resolve) => {
      let settled = false;
      const timer = setTimer(() => settle("ended"), Math.min(30000, 4000 + text.length * 110));
      const settle = (r: "ended" | "error" | "blocked" | "cancelled") => {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        if (finishLine === settle) finishLine = null;
        resolve(r);
      };
      finishLine = settle;
      try {
        start();
      } catch {
        settle("error");
      }
    });

  async function speakLine(l: NarrationLine, mySeq: number): Promise<LineOutcome | "cancelled"> {
    abort = new AbortController();
    const blob = await fetchClip(l, abort.signal);
    if (seq !== mySeq) return "cancelled";
    const el = blob ? ensureAudio() : null;
    if (blob && el) {
      release();
      try {
        url = createObjectUrl(blob);
      } catch {
        url = null;
      }
      if (url) {
        const r = await waitLine(l.text, () => {
          el.onended = () => finishLine?.("ended");
          el.onerror = () => finishLine?.("error");
          el.src = url!;
          const p = el.play();
          if (p && typeof (p as Promise<void>).catch === "function") (p as Promise<void>).catch((e: { name?: string }) => finishLine?.(e?.name === "NotAllowedError" ? "blocked" : "error"));
        });
        el.onended = null;
        el.onerror = null;
        release();
        if (r === "cancelled" || seq !== mySeq) return "cancelled";
        if (r === "blocked") return "blocked";
        if (r === "ended") {
          deps.onLine?.(l, "recorded", null);
          return "recorded";
        }
        // A broken clip: this line falls through to the German device voice.
      }
    }
    const voice = pickGermanVoice(await voices());
    if (seq !== mySeq) return "cancelled";
    if (!voice || !synth || !makeUtterance) {
      deps.onLine?.(l, "no-german-voice", null);
      return "no-german-voice";
    }
    const r = await waitLine(l.text, () => {
      const u = makeUtterance(l.text);
      u.lang = voice.lang;
      u.rate = 0.95;
      try {
        u.voice = voice;
      } catch {
        /* a fake voice object in tests */
      }
      u.onend = () => finishLine?.("ended");
      u.onerror = (e) => finishLine?.(e?.error === "not-allowed" ? "blocked" : e?.error === "interrupted" || e?.error === "canceled" ? "cancelled" : "error");
      synth.speak(u);
    });
    if (r === "cancelled" || seq !== mySeq) return "cancelled";
    if (r === "blocked") return "blocked";
    deps.onLine?.(l, r === "ended" ? "device-de" : "failed", voice.name);
    return r === "ended" ? "device-de" : "failed";
  }

  async function play(script: NarrationScript): Promise<PlayResult> {
    seq += 1;
    silence();
    const mySeq = seq;
    if (!unlocked) {
      setStatus("locked");
      return "locked";
    }
    setStatus("speaking");
    lastOutcome = null;
    for (const l of script.lines) {
      const r = await speakLine(l, mySeq);
      if (r === "cancelled" || seq !== mySeq) return "cancelled";
      lastOutcome = r;
      if (r === "blocked") {
        setStatus("blocked");
        return "blocked";
      }
      if (r === "no-german-voice") {
        setStatus("unavailable");
        return "unavailable";
      }
    }
    if (seq === mySeq) setStatus("idle");
    return "done";
  }

  function unlock() {
    unlocked = true;
    if (current === "locked" || current === "blocked") setStatus("idle");
    // Prime the audio element inside the tap (Safari/Chrome autoplay): a silent play marks it user-activated.
    const el = ensureAudio();
    if (el) {
      try {
        el.src = "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQIAAAAAAA==";
        const p = el.play();
        if (p && typeof (p as Promise<void>).catch === "function") (p as Promise<void>).catch(() => {});
      } catch {
        /* best effort */
      }
    }
  }

  function stop() {
    seq += 1;
    silence();
    setStatus(unlocked ? "idle" : "locked");
  }

  return { unlock, isUnlocked: () => unlocked, play, stop, status: () => current, lastLineOutcome: () => lastOutcome };
}
