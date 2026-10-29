// ---------------------------------------------------------------------------------------------------------------------
// Prerecorded visit narration — server-only storage and the owner-run preparation (Isabel Visit 2, 2026-10-29; I2-06).
//
// Deterministic and cacheable: every narrated line is a REVIEWED, catalogued text (`narrationCatalog`), recorded ONCE with the
// configured German voice through the existing ElevenLabs route and stored as an MP3 in the existing Blob store under
//   family-narration/<voice key>/<line id>.mp3        (voice key = first 12 hex of sha256(voice id); the voice id never leaves)
// The child's browser only ever RECEIVES stored clips (GET clip route, authenticated, catalogued ids only). No child path calls
// the provider; no free text, no child answer and no child record is ever sent to it. A missing clip means the device's own
// German voice (or nothing) — never a live synthesis during a visit.
//
// Preparation is a separate, owner-only, explicitly confirmed and character-capped step (parent route), idempotent (existing
// clips are skipped), so its cost is known in advance: characters × the provider's current per-character rate.
// This module reads `process.env` and must never be imported by a client component.
// ---------------------------------------------------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { get, head, put } from "@vercel/blob";
import type { NarrationLine } from "./family-learning-narration.ts";

/** Server-only env: the ONE German narration voice. Unset = no prerecording possible (device German voice only). */
export const NARRATION_VOICE_ENV = "ELEVENLABS_NARRATION_DE_VOICE_ID";
/** Prerecorded once, so the higher-quality multilingual model rather than the low-latency one used for live replies. */
export const NARRATION_TTS_MODEL_ID = "eleven_multilingual_v2";
export const NARRATION_OUTPUT_FORMAT = "mp3_44100_128";
const VOICE_ID_PATTERN = /^[A-Za-z0-9]{8,64}$/;
const LINE_ID_PATTERN = /^n[0-9a-f]{28}$/;

export type Env = Record<string, string | undefined>;

export function narrationVoiceId(env: Env = process.env): string | null {
  const v = env[NARRATION_VOICE_ENV]?.trim();
  return v && VOICE_ID_PATTERN.test(v) ? v : null;
}

export const isNarrationLineId = (id: string) => LINE_ID_PATTERN.test(id);

export function clipPathname(voiceId: string, lineId: string): string {
  if (!isNarrationLineId(lineId)) throw new Error("not a narration line id");
  const voiceKey = createHash("sha256").update(voiceId).digest("hex").slice(0, 12);
  return `family-narration/${voiceKey}/${lineId}.mp3`;
}

export type StoreDeps = {
  env?: Env;
  getImpl?: typeof get;
  headImpl?: typeof head;
  putImpl?: typeof put;
  fetchImpl?: typeof fetch;
};

/** The stored clip of one catalogued line for the configured voice, or null (no voice, no store, not recorded). */
export async function readNarrationClip(lineId: string, deps: StoreDeps = {}): Promise<ReadableStream<Uint8Array> | null> {
  const env = deps.env ?? process.env;
  const voice = narrationVoiceId(env);
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!voice || !token || !isNarrationLineId(lineId)) return null;
  try {
    const res = await (deps.getImpl ?? get)(clipPathname(voice, lineId), { access: "public", token });
    return res && "stream" in res && res.stream ? (res.stream as ReadableStream<Uint8Array>) : null;
  } catch {
    return null;
  }
}

export type NarrationReadiness = {
  voiceConfigured: boolean;
  providerKeyConfigured: boolean;
  storeConfigured: boolean;
  model: string;
  lines: number;
  characters: number;
  recorded: number;
  missing: number;
  missingCharacters: number;
};

async function exists(pathname: string, token: string, headImpl: typeof head): Promise<boolean> {
  try {
    await headImpl(pathname, { token });
    return true;
  } catch {
    return false;
  }
}

/** Read-only: which catalogued lines already have a clip for the configured voice (no provider call, no write). */
export async function narrationReadiness(catalog: NarrationLine[], deps: StoreDeps = {}): Promise<NarrationReadiness & { missingLines: NarrationLine[] }> {
  const env = deps.env ?? process.env;
  const voice = narrationVoiceId(env);
  const token = env.BLOB_READ_WRITE_TOKEN ?? null;
  const characters = catalog.reduce((n, l) => n + l.text.length, 0);
  const base = { voiceConfigured: !!voice, providerKeyConfigured: !!env.ELEVENLABS_API_KEY, storeConfigured: !!token, model: NARRATION_TTS_MODEL_ID, lines: catalog.length, characters };
  if (!voice || !token) return { ...base, recorded: 0, missing: catalog.length, missingCharacters: characters, missingLines: catalog };
  const missingLines: NarrationLine[] = [];
  for (const l of catalog) if (!(await exists(clipPathname(voice, l.id), token, deps.headImpl ?? head))) missingLines.push(l);
  return { ...base, recorded: catalog.length - missingLines.length, missing: missingLines.length, missingCharacters: missingLines.reduce((n, l) => n + l.text.length, 0), missingLines };
}

export type PrepareResult = { status: "prepared" | "not-configured" | "cap-reached" | "upstream-failed"; recorded: number; charactersSent: number; remaining: number; failedStatus?: number };

/**
 * Owner-run, PAID: records the missing catalogued lines (each at most once) until `maxCharacters` would be exceeded. Stops on the
 * first upstream failure (no retries). Returns counts only — never the texts, the key or the voice id.
 */
export async function prepareNarration(catalog: NarrationLine[], maxCharacters: number, deps: StoreDeps = {}): Promise<PrepareResult> {
  const env = deps.env ?? process.env;
  const voice = narrationVoiceId(env);
  const token = env.BLOB_READ_WRITE_TOKEN;
  const key = env.ELEVENLABS_API_KEY;
  const ready = await narrationReadiness(catalog, deps);
  if (!voice || !token || !key) return { status: "not-configured", recorded: 0, charactersSent: 0, remaining: ready.missing };
  let recorded = 0;
  let sent = 0;
  for (const l of ready.missingLines) {
    if (sent + l.text.length > maxCharacters) return { status: "cap-reached", recorded, charactersSent: sent, remaining: ready.missing - recorded };
    const res = await (deps.fetchImpl ?? fetch)(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=${NARRATION_OUTPUT_FORMAT}`, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text: l.text, model_id: NARRATION_TTS_MODEL_ID }),
    });
    sent += l.text.length;
    if (!res.ok) return { status: "upstream-failed", recorded, charactersSent: sent, remaining: ready.missing - recorded, failedStatus: res.status };
    const bytes = await res.arrayBuffer();
    await (deps.putImpl ?? put)(clipPathname(voice, l.id), Buffer.from(bytes), { access: "public", contentType: "audio/mpeg", allowOverwrite: true, addRandomSuffix: false, token });
    recorded += 1;
  }
  return { status: "prepared", recorded, charactersSent: sent, remaining: 0 };
}
