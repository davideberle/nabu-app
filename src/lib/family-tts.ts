// ElevenLabs text-to-speech for the Family Assistant child surface.
//
// **Server-only.** This module reads `process.env` and is imported by the TTS
// route handler; it must never be imported from a client component, because the
// API key and the per-child voice IDs are exactly the values that must not
// reach the browser bundle. There is deliberately no `NEXT_PUBLIC_*` anywhere
// on this path.
//
// The audio is transient: synthesized, returned to the authenticated caller,
// and never written anywhere. The text being spoken is a child's reply and is
// never logged — errors carry an upstream status and a bounded operator detail,
// not the utterance.

import { isChildId, type ChildId } from "./family-assistant-turn.ts";

const ELEVENLABS_TTS_URL_BASE = "https://api.elevenlabs.io/v1/text-to-speech";

/**
 * `eleven_flash_v2_5` is ElevenLabs' low-latency multilingual model. It covers
 * the three household languages (English, German, Spanish) and detects the
 * language from the text itself, so no per-turn language field is needed.
 */
export const CHILD_TTS_MODEL_ID = "eleven_flash_v2_5";

/**
 * MP3 because every iPad Safari — including the older ones this surface must
 * run on — plays `audio/mpeg` from a blob URL without MSE or codec surprises.
 */
export const CHILD_TTS_OUTPUT_FORMAT = "mp3_44100_128";
export const CHILD_TTS_CONTENT_TYPE = "audio/mpeg";

/**
 * Longest reply the TTS endpoint will speak.
 *
 * Deliberately larger than `MAX_CHILD_TURN_CHARS` (which bounds what a child
 * *sends*): the agent's reply can be longer than the question. A reply past
 * this bound is refused here and the client falls back to browser synthesis,
 * which speaks the full text — so the spoken words and the visible words never
 * diverge by truncation.
 */
export const MAX_CHILD_SPEECH_CHARS = 6000;

/** Env var names for the per-child production voices. Server-only. */
export const CHILD_VOICE_ENV_VARS: Record<ChildId, string> = {
  santiago: "ELEVENLABS_SANTIAGO_VOICE_ID",
  isabel: "ELEVENLABS_ISABEL_VOICE_ID",
};

/**
 * Premade ElevenLabs voices used when the per-child variables are not set, so
 * local verification and builds need no voice configuration. These are public
 * catalog voice IDs, not secrets; the production voices are chosen via the env
 * vars above and never appear in code.
 */
const DEFAULT_CHILD_VOICE_IDS: Record<ChildId, string> = {
  santiago: "TX3LPaxmHKxFdv7VOQHJ", // "Liam" — young, warm
  isabel: "pFZP5JQG7iQjIQuC4Bku", // "Lily" — bright, friendly
};

/** ElevenLabs voice IDs are short alphanumeric handles; anything else is a
 * misconfigured variable and must not be interpolated into a request path. */
const VOICE_ID_PATTERN = /^[A-Za-z0-9]{8,64}$/;

export function resolveChildVoiceId(
  childId: ChildId,
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = env[CHILD_VOICE_ENV_VARS[childId]]?.trim();
  if (configured && VOICE_ID_PATTERN.test(configured)) return configured;
  return DEFAULT_CHILD_VOICE_IDS[childId];
}

// ---------------------------------------------------------------------------
// Language / speaker routing (Visit 7, 2026-10-23; V6-F08)
// ---------------------------------------------------------------------------
//
// A request that names no language keeps the exact earlier behaviour (the child's
// voice). A request that names its language and speaker is routed to a voice
// configured FOR that language/speaker, never to a voice of another language:
// Spanish lines must not be spoken by the English child voice. When no such voice
// is configured the route answers 503 and the client speaks the text with the
// browser's own voice in that language — an honest fallback, never a mismatched
// accent presented as the character. Configuration is server-only env, read here;
// this build adds the names below but sets none of them.

export const SPEECH_LANGUAGES = ["de", "en", "es"] as const;
export type SpeechLanguage = (typeof SPEECH_LANGUAGES)[number];
/** `child` = the legacy child voice; `nokt` = the German tutor voice (N7-03); `character` = a story character speaking its own language. */
export const SPEECH_SPEAKERS = ["child", "nokt", "character"] as const;
export type SpeechSpeaker = (typeof SPEECH_SPEAKERS)[number];

/** Server-only env names for language/speaker voices (none is set by this build). */
export const LANGUAGE_VOICE_ENV_VARS: Record<SpeechLanguage, string> = {
  de: "ELEVENLABS_VOICE_DE_ID",
  en: "ELEVENLABS_VOICE_EN_ID",
  es: "ELEVENLABS_VOICE_ES_ID",
};
export const NOKT_VOICE_ENV_VAR = "ELEVENLABS_NOKT_DE_VOICE_ID";

/** The premade child voices are English catalog voices: they may speak English, never another language for a character. */
const CHILD_DEFAULT_LANGUAGE: SpeechLanguage = "en";

/**
 * Resolves the voice for one request, or null when no voice of that language/speaker is configured (→ 503 → browser speech in
 * that language). Never interpolates a malformed configured value.
 */
export function resolveSpeechVoiceId(
  request: { childId: ChildId; language?: SpeechLanguage; speaker?: SpeechSpeaker },
  env: Record<string, string | undefined> = process.env,
): string | null {
  const configured = (name: string) => {
    const v = env[name]?.trim();
    return v && VOICE_ID_PATTERN.test(v) ? v : null;
  };
  if (!request.language && (!request.speaker || request.speaker === "child")) return resolveChildVoiceId(request.childId, env);
  if (request.speaker === "nokt") return request.language === undefined || request.language === "de" ? configured(NOKT_VOICE_ENV_VAR) : null;
  const language = request.language ?? CHILD_DEFAULT_LANGUAGE;
  const byLanguage = configured(LANGUAGE_VOICE_ENV_VARS[language]);
  if (byLanguage) return byLanguage;
  // English character lines may keep the (English) child voice; German and Spanish need their own configured voice.
  if (language === CHILD_DEFAULT_LANGUAGE) return resolveChildVoiceId(request.childId, env);
  return null;
}

// ---------------------------------------------------------------------------
// Request contract
// ---------------------------------------------------------------------------

export type ChildTtsRequest = { childId: ChildId; text: string; language?: SpeechLanguage; speaker?: SpeechSpeaker };

export type ChildTtsRequestIssue =
  | "not-an-object"
  | "unknown-field"
  | "invalid-child"
  | "empty-text"
  | "overlong-text"
  | "invalid-language"
  | "invalid-speaker";

export type ChildTtsParseResult =
  | { ok: true; request: ChildTtsRequest }
  | { ok: false; issue: ChildTtsRequestIssue };

const ALLOWED_TTS_FIELDS = new Set(["childId", "text", "language", "speaker"]);

/**
 * Closed request schema: exactly `childId` and `text`, nothing else.
 *
 * An unknown field is a refusal rather than something to ignore — the same
 * rule the bridge applies to child turns, and for the same reason: a field
 * this surface silently drops today is a field an attacker can rely on being
 * ignored tomorrow.
 */
export function parseChildTtsRequest(body: unknown): ChildTtsParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, issue: "not-an-object" };
  }
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ALLOWED_TTS_FIELDS.has(key)) return { ok: false, issue: "unknown-field" };
  }
  if (!isChildId(record.childId)) return { ok: false, issue: "invalid-child" };
  if (typeof record.text !== "string" || !record.text.trim()) {
    return { ok: false, issue: "empty-text" };
  }
  if (record.text.length > MAX_CHILD_SPEECH_CHARS) {
    return { ok: false, issue: "overlong-text" };
  }
  if (record.language !== undefined && !(SPEECH_LANGUAGES as readonly unknown[]).includes(record.language)) return { ok: false, issue: "invalid-language" };
  if (record.speaker !== undefined && !(SPEECH_SPEAKERS as readonly unknown[]).includes(record.speaker)) return { ok: false, issue: "invalid-speaker" };
  const request: ChildTtsRequest = { childId: record.childId, text: record.text.trim() };
  if (record.language !== undefined) request.language = record.language as SpeechLanguage;
  if (record.speaker !== undefined) request.speaker = record.speaker as SpeechSpeaker;
  return { ok: true, request };
}

// ---------------------------------------------------------------------------
// Synthesis
// ---------------------------------------------------------------------------

/** Thrown when no voice of the requested language/speaker is configured — caller maps to 503 (client: browser speech in that language). */
export class TtsVoiceUnavailableError extends Error {
  constructor() {
    super("no voice configured for this language/speaker");
    this.name = "TtsVoiceUnavailableError";
  }
}

/** Thrown when the API key is missing — caller maps to 503. */
export class TtsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TtsConfigError";
  }
}

/**
 * Thrown when ElevenLabs refuses or fails. `operatorDetail` is a bounded slice
 * of the upstream body for the server log; it must never be sent to a browser.
 */
export class TtsUpstreamError extends Error {
  readonly status: number;
  readonly operatorDetail: string;
  constructor(status: number, operatorDetail: string) {
    super(`ElevenLabs TTS failed (${status})`);
    this.name = "TtsUpstreamError";
    this.status = status;
    this.operatorDetail = operatorDetail.slice(0, 200);
  }
}

export type ChildSpeechResult = {
  audio: ArrayBuffer;
  contentType: typeof CHILD_TTS_CONTENT_TYPE;
};

export async function synthesizeChildSpeech(
  request: ChildTtsRequest,
  deps: {
    fetchImpl?: typeof fetch;
    env?: Record<string, string | undefined>;
  } = {},
): Promise<ChildSpeechResult> {
  const env = deps.env ?? process.env;
  const doFetch = deps.fetchImpl ?? fetch;
  const apiKey = env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new TtsConfigError("ELEVENLABS_API_KEY is not configured");
  }

  const voiceId = resolveSpeechVoiceId(request, env);
  // No provider call at all when no voice of this language/speaker exists (no paid request with a mismatched voice).
  if (!voiceId) throw new TtsVoiceUnavailableError();
  const url = `${ELEVENLABS_TTS_URL_BASE}/${voiceId}?output_format=${CHILD_TTS_OUTPUT_FORMAT}`;
  const response = await doFetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: CHILD_TTS_CONTENT_TYPE,
    },
    body: JSON.stringify({ text: request.text, model_id: CHILD_TTS_MODEL_ID }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new TtsUpstreamError(response.status, detail);
  }

  return { audio: await response.arrayBuffer(), contentType: CHILD_TTS_CONTENT_TYPE };
}
