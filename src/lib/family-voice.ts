// Push-to-talk recording helpers for the Family Assistant child surface.
//
// Isomorphic and dependency-free: imported by a client component and by the
// `node --test` suite, so it must not touch `window`, `navigator` or React —
// every browser capability comes in as an argument.
//
// The recording itself is transient. It exists as an in-memory blob between
// "tap to finish" and the `/api/family/transcribe` response, and nothing here
// stores, replays or logs it.

import { MAX_CHILD_TURN_CHARS } from "./family-assistant-turn.ts";

/**
 * MediaRecorder MIME preference, most-compatible first.
 *
 * `audio/mp4` (AAC) is what iPad Safari records natively and what ElevenLabs
 * Scribe accepts directly, so it leads. The Opus/WebM entries are the
 * Chrome/Firefox path for desktop verification. An empty pick (null) means
 * "let the browser choose its default", which is still a valid recording.
 */
export const RECORDER_MIME_PREFERENCES = [
  "audio/mp4",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/webm;codecs=opus",
  "audio/webm",
] as const;

/** Longest push-to-talk recording; the recorder is stopped at this bound. */
export const MAX_RECORDING_MS = 60_000;

/**
 * Shortest live capture before a stop is honoured.
 *
 * The first tap of a session spends its startup window on the permission
 * prompt, and iPad Safari will happily hand back a well-formed but *contentless*
 * MP4 for a capture that lasted a couple of frames — which the transcription
 * service then answers, correctly, with an empty transcript. Holding the stop
 * for this long means every accepted turn contains real audio.
 */
export const MIN_LIVE_CAPTURE_MS = 400;

/**
 * Bounded wait for a final `dataavailable` that lands *after* `stop`.
 *
 * The spec orders the last chunk before the stop event, but the ordering is
 * worth not depending on: waiting a beat costs nothing and turns a would-be
 * "I couldn't hear anything" into the utterance the child actually said.
 */
export const FINAL_CHUNK_GRACE_MS = 250;

/**
 * Bounded wait for a `stop` event that never arrives. Without it a recorder
 * that dies quietly would leave the child on "Listening…" forever; with it the
 * turn finishes with whatever was captured.
 */
export const STOP_EVENT_TIMEOUT_MS = 1_500;

export function pickRecorderMimeType(
  isTypeSupported: (type: string) => boolean,
): string | null {
  for (const candidate of RECORDER_MIME_PREFERENCES) {
    try {
      if (isTypeSupported(candidate)) return candidate;
    } catch {
      // A hostile/legacy implementation throwing counts as "not supported".
    }
  }
  return null;
}

/**
 * Filename for the transcription upload, derived from the *actual* recorded
 * MIME (which may differ from the requested one). The transcription provider
 * sniffs content, so the extension is a hint, not a contract.
 */
export function recordingFileName(mimeType: string | null | undefined): string {
  const mime = (mimeType ?? "").toLowerCase();
  if (mime.includes("mp4")) return "utterance.m4a";
  if (mime.includes("webm")) return "utterance.webm";
  if (mime.includes("ogg")) return "utterance.ogg";
  if (mime.includes("mpeg")) return "utterance.mp3";
  return "utterance.audio";
}

/** Blob type for assembled chunks; octet-stream when the recorder gave none. */
export function recordingBlobType(mimeType: string | null | undefined): string {
  const mime = (mimeType ?? "").trim();
  return mime || "application/octet-stream";
}

// ---------------------------------------------------------------------------
// Utterance validation for the editable confirmation control
// ---------------------------------------------------------------------------

export type ChildUtteranceCheck =
  | { ok: true; text: string }
  | { ok: false; reason: "empty" | "overlong"; limit: number };

/**
 * The single validation for the confirm-before-send control, aligned with
 * `MAX_CHILD_TURN_CHARS` so the UI refuses exactly what the bridge would.
 *
 * Deliberately a refusal rather than a silent truncation: a spoken turn is the
 * one place the child is explicitly reviewing their words, so cutting them
 * behind their back would defeat the review.
 */
export function checkChildUtterance(raw: string): ChildUtteranceCheck {
  const text = raw.trim();
  if (!text) return { ok: false, reason: "empty", limit: MAX_CHILD_TURN_CHARS };
  if (text.length > MAX_CHILD_TURN_CHARS) {
    return { ok: false, reason: "overlong", limit: MAX_CHILD_TURN_CHARS };
  }
  return { ok: true, text };
}

// ---------------------------------------------------------------------------
// Capability detection
// ---------------------------------------------------------------------------

type VoiceCaptureHost = {
  navigator?: { mediaDevices?: { getUserMedia?: unknown } };
  MediaRecorder?: unknown;
};

/**
 * True when this browser can record real audio: `getUserMedia` plus
 * `MediaRecorder`. Browser `SpeechRecognition` is deliberately not consulted —
 * it is no longer the source of truth for anything on this surface.
 */
export function voiceCaptureSupported(host: VoiceCaptureHost | undefined): boolean {
  if (!host) return false;
  return (
    typeof host.MediaRecorder === "function" &&
    typeof host.navigator?.mediaDevices?.getUserMedia === "function"
  );
}

// ---------------------------------------------------------------------------
// The push-to-talk session
//
// One tap starts a session, one tap (or the 60-second bound) finishes it, and
// exactly one outcome comes back. Everything browser-shaped — the microphone,
// the recorder, timers, the clock — arrives as a dependency, so the whole
// lifecycle is exercised by `node --test` without a DOM.
//
// The lifecycle exists because starting a recorder is *slow* and the child does
// not know that. `getUserMedia` can take a second (longer with a permission
// prompt), and a tap of Stop inside that window used to find no recorder and
// silently drop the utterance. So:
//
//  - the session is "starting" until `start()` has actually returned, and only
//    then does `onLive` fire — the UI must not claim to be listening before it;
//  - a Stop during startup is *remembered*, not dropped, and applied once live;
//  - an accepted stop waits out `MIN_LIVE_CAPTURE_MS`, so the shortest possible
//    turn still carries frames rather than an empty container;
//  - chunk assembly tolerates both stop/dataavailable orderings and a stop
//    event that never comes, each on a bounded timer;
//  - every exit path releases the microphone and reports exactly once.
// ---------------------------------------------------------------------------

/** The slice of `MediaStreamTrack` this controller uses. */
export type RecorderTrack = { stop: () => void };

/** The slice of `MediaStream` this controller uses. */
export type RecorderStream = { getTracks: () => RecorderTrack[] };

/** Recorder lifecycle events, delivered by the host's adapter. */
export type RecorderHandlers = {
  onData: (chunk: Blob) => void;
  onStop: () => void;
  onError: () => void;
};

/**
 * The slice of `MediaRecorder` this controller drives. The host adapts the DOM
 * object to this shape (see `adaptMediaRecorder` in the assistant client), so
 * no DOM handler types leak in here.
 */
export type RecorderControl = {
  start: () => void;
  stop: () => void;
  /** The MIME actually being recorded, which may differ from the request. */
  mimeType: () => string | null;
  /** Detaches the handlers; nothing may fire after this. */
  detach: () => void;
};

/**
 * How a session ended. Exactly one of these is delivered, exactly once.
 *
 *  - `recorded`  — real audio, ready to transcribe;
 *  - `empty`     — the recorder produced no bytes (nothing to send);
 *  - `denied`    — the microphone said no;
 *  - `failed`    — the recorder could not be built, started, or ran into an error;
 *  - `cancelled` — the caller superseded this session. Say nothing: whatever
 *                  cancelled it owns the screen.
 */
export type PushToTalkOutcome =
  | { kind: "recorded"; blob: Blob; mimeType: string | null; fileName: string }
  | { kind: "empty" }
  | { kind: "denied" }
  | { kind: "failed" }
  | { kind: "cancelled" };

type TimerHandle = unknown;

export type PushToTalkDeps<S extends RecorderStream = RecorderStream> = {
  /** Opens the microphone. Rejecting means `denied`. */
  getUserMedia: () => Promise<S>;
  /** Builds the recorder with the handlers already attached. */
  createRecorder: (
    stream: S,
    mimeType: string | null,
    handlers: RecorderHandlers,
  ) => RecorderControl;
  /** `MediaRecorder.isTypeSupported`; omitted means "browser default MIME". */
  isTypeSupported?: (type: string) => boolean;
  /** Fires once, when capture is genuinely live. Never before. */
  onLive?: () => void;
  /** Fires exactly once, with the single outcome of this session. */
  onSettle: (outcome: PushToTalkOutcome) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  createBlob?: (parts: Blob[], type: string) => Blob;
  minLiveMs?: number;
  maxRecordingMs?: number;
};

export type PushToTalkSession = {
  /** Finish and report. Safe during startup, and safe to call repeatedly. */
  stop: () => void;
  /** Drop the recording, release the microphone, report `cancelled`. */
  cancel: () => void;
  /** True once capture is live — what the UI may call "listening". */
  isLive: () => boolean;
};

export function startPushToTalk<S extends RecorderStream = RecorderStream>(
  deps: PushToTalkDeps<S>,
): PushToTalkSession {
  const now = deps.now ?? (() => Date.now());
  const setTimer: (fn: () => void, ms: number) => TimerHandle =
    deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer: (handle: TimerHandle) => void =
    deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const createBlob = deps.createBlob ?? ((parts: Blob[], type: string) => new Blob(parts, { type }));
  const isTypeSupported = deps.isTypeSupported ?? (() => false);
  const minLiveMs = deps.minLiveMs ?? MIN_LIVE_CAPTURE_MS;
  const maxRecordingMs = deps.maxRecordingMs ?? MAX_RECORDING_MS;

  /**
   * `starting` → `live` → `stopping` → `done`, with `done` reachable from
   * anywhere. Every transition out of `done` is refused, which is what makes
   * "exactly one outcome" true no matter how the events interleave.
   */
  let phase: "starting" | "live" | "stopping" | "done" = "starting";
  let stopRequested = false;
  let sawStopEvent = false;
  let stream: RecorderStream | null = null;
  let recorder: RecorderControl | null = null;
  let liveAt = 0;
  const chunks: Blob[] = [];
  const timers = new Set<{ handle?: TimerHandle }>();

  /** Read through a call so the startup task sees settles from its callbacks. */
  const settled = () => phase === "done";

  function arm(fn: () => void, ms: number): void {
    const slot: { handle?: TimerHandle } = {};
    timers.add(slot);
    slot.handle = setTimer(() => {
      timers.delete(slot);
      fn();
    }, ms);
  }

  function clearArmedTimers(): void {
    for (const slot of timers) {
      try {
        clearTimer(slot.handle);
      } catch {
        /* a timer that cannot be cleared is harmless: every callback re-checks `phase` */
      }
    }
    timers.clear();
  }

  function releaseMicrophone(target: RecorderStream | null): void {
    if (!target) return;
    let tracks: RecorderTrack[] = [];
    try {
      tracks = target.getTracks();
    } catch {
      return;
    }
    for (const track of tracks) {
      try {
        track.stop();
      } catch {
        /* already ended */
      }
    }
  }

  function settle(outcome: PushToTalkOutcome): void {
    if (phase === "done") return;
    phase = "done";
    clearArmedTimers();
    const control = recorder;
    recorder = null;
    // Detach *before* stopping: a shim that fires `stop` synchronously must not
    // be able to turn a cancel into a recorded turn.
    try {
      control?.detach();
    } catch {
      /* nothing left to detach */
    }
    try {
      control?.stop();
    } catch {
      /* already inactive */
    }
    const open = stream;
    stream = null;
    releaseMicrophone(open);
    chunks.length = 0;
    deps.onSettle(outcome);
  }

  function finalize(): void {
    if (phase === "done") return;
    let mime: string | null = null;
    try {
      mime = recorder?.mimeType() ?? null;
    } catch {
      mime = null;
    }
    const parts = chunks.filter((chunk) => (chunk?.size ?? 0) > 0);
    if (parts.length === 0) {
      // A nonzero-length capture that produced nothing, or nothing at all: the
      // caller says "I couldn't hear that" rather than posting empty audio.
      settle({ kind: "empty" });
      return;
    }
    let blob: Blob;
    try {
      blob = createBlob(parts, recordingBlobType(mime));
    } catch {
      settle({ kind: "failed" });
      return;
    }
    settle({ kind: "recorded", blob, mimeType: mime, fileName: recordingFileName(mime) });
  }

  const handlers: RecorderHandlers = {
    onData: (chunk) => {
      if (phase === "done") return;
      if ((chunk?.size ?? 0) > 0) chunks.push(chunk);
      // The chunk the stop event was waiting for: assemble now instead of
      // sitting out the rest of the grace window.
      if (sawStopEvent) finalize();
    },
    onStop: () => {
      if (phase === "done") return;
      sawStopEvent = true;
      phase = "stopping";
      if (chunks.length > 0) {
        finalize();
        return;
      }
      arm(finalize, FINAL_CHUNK_GRACE_MS);
    },
    onError: () => {
      settle({ kind: "failed" });
    },
  };

  function commitStop(): void {
    if (phase !== "stopping") return;
    // Armed before `stop()` so a synchronous stop event clears it on the way out.
    arm(finalize, STOP_EVENT_TIMEOUT_MS);
    try {
      recorder?.stop();
    } catch {
      // The recorder refused to stop: report what was captured rather than
      // waiting on an event that is now never coming.
      finalize();
    }
  }

  function beginStop(): void {
    if (phase !== "live") return;
    phase = "stopping";
    const remaining = minLiveMs - (now() - liveAt);
    if (remaining > 0) {
      arm(commitStop, remaining);
      return;
    }
    commitStop();
  }

  function stop(): void {
    if (phase === "starting") {
      // The child tapped Stop while the microphone was still opening. Remember
      // it — this is the tap that used to vanish.
      stopRequested = true;
      return;
    }
    beginStop();
  }

  function cancel(): void {
    settle({ kind: "cancelled" });
  }

  void (async () => {
    let acquired: S;
    try {
      acquired = await deps.getUserMedia();
    } catch {
      settle({ kind: "denied" });
      return;
    }
    if (settled()) {
      // Cancelled while permission was pending: hand the microphone straight
      // back rather than leaving the recording indicator lit.
      releaseMicrophone(acquired);
      return;
    }
    stream = acquired;
    try {
      const mime = pickRecorderMimeType(isTypeSupported);
      recorder = deps.createRecorder(acquired, mime, handlers);
      recorder.start();
    } catch {
      settle({ kind: "failed" });
      return;
    }
    // A recorder that errored (or was cancelled) synchronously inside
    // `start()` has already settled; it must not be resurrected as live.
    if (settled()) return;
    phase = "live";
    liveAt = now();
    try {
      deps.onLive?.();
    } catch {
      /* presentation only; the recording carries on */
    }
    // Recordings are bounded; a forgotten open mic stops itself.
    arm(() => beginStop(), maxRecordingMs);
    if (stopRequested) beginStop();
  })();

  return { stop, cancel, isLive: () => phase === "live" || phase === "stopping" };
}
