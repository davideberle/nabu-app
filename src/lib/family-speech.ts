// Client-side playback controller for ElevenLabs child speech.
//
// Isomorphic and dependency-free: imported by a client component and by the
// `node --test` suite, so every browser capability (fetch, Audio, object URLs)
// is injectable. The real client passes nothing and gets browser defaults.
//
// ## The contract with the UI
//
// `speak()` resolves to exactly one of three outcomes:
//
//  - `"played"`    — the ElevenLabs audio finished playing;
//  - `"fallback"`  — speech could not be fetched or played (request failed,
//                    text too long, playback blocked). The caller falls back to
//                    browser `speechSynthesis`, so the child still hears the
//                    reply — and the visible reply was rendered before any of
//                    this ran, so a total audio failure loses nothing;
//  - `"cancelled"` — a newer `speak()`/`cancel()` superseded this one. The
//                    caller does nothing: whatever cancelled it owns the stage.
//
// ## iPad Safari specifics, handled here so the UI stays simple
//
//  - Safari only lets audio start from a user gesture, so `unlock()` is called
//    from a tap handler: it plays a silent clip through the *same* element
//    later reused for real speech, which marks that element user-activated.
//  - Every turn bumps a sequence number. Audio that arrives for a stale
//    sequence is revoked and dropped, so a slow reply can never speak over a
//    newer one.
//  - Object URLs are revoked on every exit path — end, error, cancel, stale.

/** Path of the authenticated TTS route. The only speech URL the browser sees. */
export const CHILD_TTS_PATH = "/api/family/assistant/tts";

/**
 * Client-side mirror of the server bound. Longer text goes straight to
 * `"fallback"` (browser synthesis speaks it in full) instead of a doomed
 * request.
 */
export const MAX_SPEAKABLE_CHARS = 6000;

/**
 * A beat of silence (44-byte WAV, one zero sample). Playing it from a tap is
 * what unlocks the audio element on iPad Safari.
 */
const SILENT_WAV_DATA_URI =
  "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQIAAAAAAA==";

/** The slice of HTMLAudioElement this controller uses. */
export type AudioLike = {
  src: string;
  play: () => Promise<void>;
  pause: () => void;
  onended: (() => void) | null;
  onerror: (() => void) | null;
};

export type SpeakResult = "played" | "fallback" | "cancelled";

export type ChildSpeechPlayerDeps = {
  fetchImpl?: typeof fetch;
  createAudio?: () => AudioLike | null;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
};

export type ChildSpeechPlayer = {
  /** Call from a user tap. Idempotent; never throws. */
  unlock: () => void;
  /** Fetches and plays the reply in the child's voice. See contract above. */
  speak: (params: { childId: string; text: string }) => Promise<SpeakResult>;
  /** Stops playback and invalidates any in-flight speech. */
  cancel: () => void;
};

function defaultCreateAudio(): AudioLike | null {
  // The cast bridges a handler-arity mismatch only: HTMLAudioElement's
  // `onended` takes an Event this controller never reads.
  return typeof Audio === "undefined" ? null : (new Audio() as unknown as AudioLike);
}

export function createChildSpeechPlayer(
  deps: ChildSpeechPlayerDeps = {},
): ChildSpeechPlayer {
  const doFetch = deps.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const createAudio = deps.createAudio ?? defaultCreateAudio;
  const createObjectUrl =
    deps.createObjectUrl ?? ((blob: Blob) => URL.createObjectURL(blob));
  const revokeObjectUrl =
    deps.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url));

  let audio: AudioLike | null | undefined;
  let seq = 0;
  let unlocked = false;
  let abortController: AbortController | null = null;
  let currentUrl: string | null = null;
  let settlePending: ((result: SpeakResult) => void) | null = null;

  function ensureAudio(): AudioLike | null {
    if (audio === undefined) audio = createAudio();
    return audio;
  }

  function releaseUrl() {
    if (currentUrl !== null) {
      try {
        revokeObjectUrl(currentUrl);
      } catch {
        /* revoking twice is harmless; failing to is a leak we tried to avoid */
      }
      currentUrl = null;
    }
  }

  function stopPlayback() {
    const element = audio;
    if (element) {
      element.onended = null;
      element.onerror = null;
      try {
        element.pause();
      } catch {
        /* nothing was playing */
      }
    }
    releaseUrl();
  }

  function cancel() {
    seq += 1;
    abortController?.abort();
    abortController = null;
    stopPlayback();
    settlePending?.("cancelled");
    settlePending = null;
  }

  function unlock() {
    if (unlocked) return;
    const element = ensureAudio();
    if (!element) return;
    // A retried unlock must never stomp the element while a real turn is
    // using it; the tap after that turn settles gets to retry instead.
    if (settlePending !== null || abortController !== null) return;
    try {
      element.src = SILENT_WAV_DATA_URI;
      const attempt = element.play();
      if (attempt) {
        // Latch only when the silent play actually succeeded. A rejection
        // (Safari not honoring the gesture) leaves `unlocked` false so the
        // next tap retries instead of the element staying locked forever.
        attempt
          .then(() => {
            unlocked = true;
            // Guarded so a real turn that started meanwhile is not paused.
            if (element.src === SILENT_WAV_DATA_URI) element.pause();
          })
          .catch(() => {});
      } else {
        // Older Safari returns undefined from play(): no rejection signal
        // exists, so latch as before.
        unlocked = true;
      }
    } catch {
      /* unlock is best-effort; real playback still falls back cleanly */
    }
  }

  async function speak(params: { childId: string; text: string }): Promise<SpeakResult> {
    // Supersede whatever was speaking; that promise resolves "cancelled".
    cancel();
    const mySeq = seq;

    const element = ensureAudio();
    if (!element) return "fallback";
    if (params.text.length > MAX_SPEAKABLE_CHARS) return "fallback";

    const controller = new AbortController();
    abortController = controller;

    let blob: Blob;
    try {
      const response = await doFetch(CHILD_TTS_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ childId: params.childId, text: params.text }),
        cache: "no-store",
        signal: controller.signal,
      });
      if (seq !== mySeq) return "cancelled";
      if (!response.ok) return "fallback";
      blob = await response.blob();
    } catch {
      return seq === mySeq ? "fallback" : "cancelled";
    }
    if (seq !== mySeq) return "cancelled";
    abortController = null;

    let url: string;
    try {
      url = createObjectUrl(blob);
    } catch {
      // Object-URL creation failing (quota, hostile shim) is a playback
      // failure like any other: fall back, don't reject.
      return "fallback";
    }
    currentUrl = url;

    return await new Promise<SpeakResult>((resolve) => {
      const settle = (result: SpeakResult) => {
        if (settlePending !== settle) return;
        settlePending = null;
        element.onended = null;
        element.onerror = null;
        // `cancel()` already released the URL on its own path.
        if (result !== "cancelled") releaseUrl();
        resolve(result);
      };
      settlePending = settle;
      element.onended = () => settle("played");
      element.onerror = () => settle("fallback");
      try {
        element.src = url;
        const attempt = element.play();
        attempt?.catch(() => settle("fallback"));
      } catch {
        settle("fallback");
      }
    });
  }

  return { unlock, speak, cancel };
}
