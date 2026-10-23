// ---------------------------------------------------------------------------
// Nokt's microphone — speech-to-text behind one replaceable adapter (content v6, N7-03).
//
// **Server-only.** Reads `process.env` (the OpenAI key) and is imported by the
// Nokt transcribe route; nothing here may reach a client bundle.
//
// Owner selection (David, October 23 12:25): OpenAI transcription for Nokt's
// microphone, model `gpt-transcribe` — the model OpenAI's speech-to-text guide
// recommends for recorded speech. Not ElevenLabs (its terms exclude voice data
// of anyone under 18), and the existing household `/api/family/transcribe`
// route is unchanged. A different recognizer later = a second adapter behind
// `NoktTranscriber`; the route and the panel do not change.
//
// Recognition bias: the request carries the model, the audio and the
// language hint ONLY. No `prompt`, no `keywords`, nothing from the task or its
// answer key — a recognizer nudged toward the expected answer would turn a
// child's wrong «fünf» into the right «vier» before anyone heard it.
//
// Audio and transcript are transient: never written, never logged. Errors
// carry the upstream status only.
//
// Real-child activation is GATED (`NOKT_CHILD_TRANSCRIPTION_ACTIVATED = false`).
// OpenAI documents `/v1/audio/transcriptions` with no abuse-monitoring and no
// application-state retention by default, and separately asks that personal
// data of children under 13 is processed only "after implementing zero data
// retention in our API". Whether the endpoint default satisfies that is not
// stated in the documentation (checked October 23), so this build transcribes
// for Nokt only on an isolated local database (`fictional-stub`): a fake
// recognizer by default, or OpenAI with an explicit provider flag and key for
// adult-voiced fictional tests. Anywhere else the route answers 503.
// ---------------------------------------------------------------------------

import { noktModeFromEnv } from "./family-learning-nokt.ts";

/** Stays false until the under-13 question is resolved and the owner activates it in a reviewed change. */
export const NOKT_CHILD_TRANSCRIPTION_ACTIVATED = false;

export const OPENAI_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";
export const NOKT_STT_MODEL = "gpt-transcribe";
/**
 * Nokt is a German tutor. One language hint, deliberately: whether adding `es`/`en`
 * (Rosa's and June's lines) helps or hurts German recognition is unmeasured.
 */
export const NOKT_STT_LANGUAGES = ["de"] as const;
/** OpenAI documents 25 MB per file; the household upload bound (15 MB) is tighter and applies first. */
export const OPENAI_MAX_FILE_BYTES = 25 * 1024 * 1024;
/** A spoken turn is short; a stuck upstream must not leave the child on "ich schreibe mit". */
export const NOKT_STT_TIMEOUT_MS = 30_000;

export type NoktTranscription = { transcript: string; provider: "openai" | "fictional-fake"; model: string };

/** The one seam: a recognizer takes the uploaded file and a cancellation signal, and returns plain text. */
export type NoktTranscriber = {
  provider: NoktTranscription["provider"];
  model: string;
  transcribe: (file: File, signal: AbortSignal) => Promise<NoktTranscription>;
};

export type NoktSttMode =
  | { kind: "off" }
  | { kind: "unconfigured" }
  | { kind: "fictional-fake" }
  | { kind: "openai"; apiKey: string };

/**
 * Which recognizer this server may use for Nokt. Never reads a request: the
 * decision is the deployment's, so no client can switch providers.
 */
export function noktSttModeFromEnv(env: Record<string, string | undefined>, activated: boolean = NOKT_CHILD_TRANSCRIPTION_ACTIVATED): NoktSttMode {
  if (!activated && noktModeFromEnv(env) !== "fictional-stub") return { kind: "off" };
  if (env.FAMILY_NOKT_STT_PROVIDER === "openai") {
    const apiKey = env.OPENAI_API_KEY;
    return apiKey ? { kind: "openai", apiKey } : { kind: "unconfigured" };
  }
  // Only the isolated fictional database falls back to the fake; an activated deployment must name its provider.
  return activated && noktModeFromEnv(env) !== "fictional-stub" ? { kind: "unconfigured" } : { kind: "fictional-fake" };
}

/** The multipart body sent to OpenAI, exported so tests prove exactly what is — and is not — sent. */
export function buildNoktSttForm(file: File): FormData {
  const form = new FormData();
  form.append("model", NOKT_STT_MODEL);
  form.append("file", file);
  for (const language of NOKT_STT_LANGUAGES) form.append("languages[]", language);
  return form;
}

export class NoktSttUpstreamError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`OpenAI transcription failed (${status})`);
    this.name = "NoktSttUpstreamError";
    this.status = status;
  }
}

export function openAiNoktTranscriber(apiKey: string, deps: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): NoktTranscriber {
  const doFetch = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? NOKT_STT_TIMEOUT_MS;
  return {
    provider: "openai",
    model: NOKT_STT_MODEL,
    async transcribe(file, signal) {
      // The caller's signal (the child cancelled, closed Nokt or changed task) and a bounded timeout both abort the upstream call.
      const response = await doFetch(OPENAI_TRANSCRIPTIONS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: buildNoktSttForm(file),
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      });
      // Status only: the upstream body may quote the request and is never read into a log.
      if (!response.ok) throw new NoktSttUpstreamError(response.status);
      const data: { text?: unknown } = await response.json();
      return { transcript: typeof data.text === "string" ? data.text.trim() : "", provider: "openai", model: NOKT_STT_MODEL };
    },
  };
}

/** Isolated fictional database only: no network, a fixed fictional sentence that is not an answer to any task. */
export const FICTIONAL_TRANSCRIPT = "Ich weiss nicht, wie ich anfangen soll.";

export function fictionalNoktTranscriber(): NoktTranscriber {
  return {
    provider: "fictional-fake",
    model: "none",
    async transcribe(_file, signal) {
      signal.throwIfAborted();
      return { transcript: FICTIONAL_TRANSCRIPT, provider: "fictional-fake", model: "none" };
    },
  };
}

export function noktTranscriberFor(mode: NoktSttMode, deps: { fetchImpl?: typeof fetch } = {}): NoktTranscriber | null {
  if (mode.kind === "openai") return openAiNoktTranscriber(mode.apiKey, deps);
  if (mode.kind === "fictional-fake") return fictionalNoktTranscriber();
  return null;
}
