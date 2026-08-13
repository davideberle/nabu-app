// ElevenLabs Scribe v2 speech-to-text for the Family Assistant child surface.
//
// **Server-only.** Reads `process.env` and is imported by the transcribe route
// handler; the API key must never reach a client bundle.
//
// The audio is transient: uploaded, transcribed, and never written anywhere.
// Neither the recording nor the transcript is ever logged — it is a child's
// spoken words.

const ELEVENLABS_STT_URL = "https://api.elevenlabs.io/v1/speech-to-text";

export const STT_MODEL_ID = "scribe_v2";

export type TranscriptionResult = {
  transcript: string;
  provider: "elevenlabs";
  model: typeof STT_MODEL_ID;
};

/**
 * The multipart body sent to ElevenLabs, exported so tests can prove exactly
 * what is — and is not — sent without a network call or credentials.
 *
 * Deliberately no `language_code`: the household speaks English, German and
 * Spanish, and Scribe v2 detects the language per utterance. Pinning `en`
 * would mistranscribe the other two.
 */
export function buildSttForm(audioFile: File): FormData {
  const form = new FormData();
  form.append("model_id", STT_MODEL_ID);
  form.append("file", audioFile);
  form.append("no_verbatim", "true");
  form.append("timestamps_granularity", "none");
  return form;
}

export async function transcribeAudio(
  audioFile: File,
  deps: {
    fetchImpl?: typeof fetch;
    env?: Record<string, string | undefined>;
  } = {},
): Promise<TranscriptionResult> {
  const env = deps.env ?? process.env;
  const doFetch = deps.fetchImpl ?? fetch;
  const apiKey = env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new TranscriptionConfigError("ELEVENLABS_API_KEY is not configured");
  }

  const response = await doFetch(ELEVENLABS_STT_URL, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: buildSttForm(audioFile),
  });

  if (!response.ok) {
    // Bounded operator detail for the server log; the route never sends it to
    // a browser.
    const body = await response.text().catch(() => "");
    throw new Error(
      `ElevenLabs STT failed (${response.status}): ${body.slice(0, 200)}`,
    );
  }

  const data: { text?: string } = await response.json();
  return {
    transcript: (data.text ?? "").trim(),
    provider: "elevenlabs",
    model: STT_MODEL_ID,
  };
}

/** Thrown when the API key is missing — caller maps to 503. */
export class TranscriptionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptionConfigError";
  }
}

// ---------------------------------------------------------------------------
// Upload validation
// ---------------------------------------------------------------------------

export const MAX_AUDIO_BYTES = 15 * 1024 * 1024; // 15 MB

export type AudioUploadIssue = "missing-audio" | "unsupported-type" | "oversized";

export type AudioUploadCheck =
  | { ok: true; file: File }
  | { ok: false; issue: AudioUploadIssue };

/**
 * Closed refusal messages: fixed strings only. A client-supplied content type
 * (or any other part of the request) is never echoed back.
 */
export const AUDIO_UPLOAD_ISSUE_MESSAGES: Record<AudioUploadIssue, string> = {
  "missing-audio": "Missing or empty audio file",
  "unsupported-type": "Unsupported audio content type",
  oversized: "Audio file is too large",
};

/** Accepts audio/*, WebM (Chrome records video/webm), and untyped chunks. */
export function checkAudioUpload(candidate: unknown): AudioUploadCheck {
  if (!(candidate instanceof File) || candidate.size === 0) {
    return { ok: false, issue: "missing-audio" };
  }
  const ct = candidate.type.toLowerCase();
  const allowed =
    ct.startsWith("audio/") ||
    ct === "video/webm" ||
    ct === "application/octet-stream";
  if (!allowed) return { ok: false, issue: "unsupported-type" };
  if (candidate.size > MAX_AUDIO_BYTES) return { ok: false, issue: "oversized" };
  return { ok: true, file: candidate };
}

// ---------------------------------------------------------------------------
// Admission
// ---------------------------------------------------------------------------

/**
 * Per-identity transcription budget for one server instance. Push-to-talk is
 * one request per spoken turn, so this bounds a stuck or hostile client
 * without ever getting in a child's way. Mirrors the TTS route's window.
 */
export const TRANSCRIPTIONS_PER_WINDOW = 30;
export const TRANSCRIPTION_WINDOW_MS = 60_000;

/**
 * A factory so the route gets one shared window map and each test gets its
 * own. Keys must be *authenticated* identities — never a client-supplied
 * field — which also keeps the map bounded: it can only grow one entry per
 * identity the auth layer admits, and expired windows are swept on the way in.
 */
export function createTranscriptionAdmission(): (
  identity: string,
  nowMs: number,
) => boolean {
  const windows = new Map<string, { startedAt: number; count: number }>();
  return (identity, nowMs) => {
    for (const [key, window] of windows) {
      if (nowMs - window.startedAt >= TRANSCRIPTION_WINDOW_MS) windows.delete(key);
    }
    const existing = windows.get(identity);
    if (!existing) {
      windows.set(identity, { startedAt: nowMs, count: 1 });
      return true;
    }
    if (existing.count >= TRANSCRIPTIONS_PER_WINDOW) return false;
    existing.count += 1;
    return true;
  };
}
