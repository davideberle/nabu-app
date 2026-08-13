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
