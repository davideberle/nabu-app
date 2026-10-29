// ---------------------------------------------------------------------------------------------------------------------
// Prerecorded visit narration — server-only storage and the owner-run preparation (Isabel Visit 2, 2026-10-29; I2-06).
//
// Deterministic and cacheable: every narrated line is a REVIEWED, catalogued text (`narrationCatalog`), recorded ONCE with the
// voice of its character's slot (six-slot registry, `family-voice-registry.ts`) through the existing ElevenLabs route and stored
// as an MP3 in the existing Blob store under
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
import { del, get, head, put } from "@vercel/blob";
import type { NarrationLine } from "./family-learning-narration.ts";
import { isVoiceSlot, resolveSlotVoiceId, VOICE_SLOTS, VOICE_SLOT_INFO, type VoiceSlot } from "./family-voice-registry.ts";

/** Prerecorded once, so the higher-quality multilingual model rather than the low-latency one used for live replies. */
export const NARRATION_TTS_MODEL_ID = "eleven_multilingual_v2";
export const NARRATION_OUTPUT_FORMAT = "mp3_44100_128";
const LINE_ID_PATTERN = /^n[0-9a-f]{28}$/;

export type Env = Record<string, string | undefined>;

/** The configured voice of the line's story slot (six-slot registry), or null — a line without a slot is never recorded. */
export function lineVoiceId(l: { slot?: VoiceSlot }, env: Env = process.env): string | null {
  return l.slot ? resolveSlotVoiceId(l.slot, env) : null;
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
  delImpl?: typeof del;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

/** The public store may hold only fixed, non-private scripts: no child's name (or anything that looks like a record) is ever recorded. */
const PRIVATE_TEXT = /\b(isabel|santiago|santi|eberle)\b/i;
export const isPublicSafeScript = (text: string) => !PRIVATE_TEXT.test(text) && text.length <= 300;
/** A preparation run holds this lock; a second run (double click, retry, two tabs) is refused instead of paying twice. */
const LOCK_STALE_MS = 15 * 60_000;
export const MAX_PREPARE_CHARACTERS = 20_000;
/** One lock for all slots: preparation runs one at a time whatever voices it records. */
export const PREPARE_LOCK = "family-narration/prepare.lock";

/** The stored clip of one catalogued line for the configured voice, or null (no voice, no store, not recorded). */
export async function readNarrationClip(slot: string, lineId: string, deps: StoreDeps = {}): Promise<ReadableStream<Uint8Array> | null> {
  const env = deps.env ?? process.env;
  const voice = isVoiceSlot(slot) ? resolveSlotVoiceId(slot, env) : null;
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!voice || !token || !isNarrationLineId(lineId)) return null;
  try {
    const res = await (deps.getImpl ?? get)(clipPathname(voice, lineId), { access: "public", token });
    return res && "stream" in res && res.stream ? (res.stream as ReadableStream<Uint8Array>) : null;
  } catch {
    return null;
  }
}

export type SlotReadiness = { slot: VoiceSlot; language: string; gender: string; configured: boolean; lines: number; characters: number; recorded: number; missing: number; missingCharacters: number };
export type NarrationReadiness = {
  /** True only when every slot the catalogue needs has a selected voice AND every line is recorded — the release gate. */
  ready: boolean;
  /** Slots the catalogue needs, with their configuration and recording state (voice ids are never reported). */
  slots: SlotReadiness[];
  /** The same totals per child (Isabel's narration and Santiago's story lines are counted apart). */
  children: { child: string; ready: boolean; lines: number; characters: number; recorded: number; missing: number; missingCharacters: number; personal: number }[];
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

/** Read-only: which catalogued lines already have a clip in their slot's configured voice (no provider call, no write). */
export async function narrationReadiness(catalog: NarrationLine[], deps: StoreDeps = {}): Promise<NarrationReadiness & { missingLines: NarrationLine[] }> {
  const env = deps.env ?? process.env;
  const token = env.BLOB_READ_WRITE_TOKEN ?? null;
  const missingLines: NarrationLine[] = [];
  for (const l of catalog) {
    const voice = lineVoiceId(l, env);
    if (!voice || !token || !(await exists(clipPathname(voice, l.id), token, deps.headImpl ?? head))) missingLines.push(l);
  }
  const missing = new Set(missingLines);
  const chars = (ls: NarrationLine[]) => ls.reduce((n, l) => n + l.text.length, 0);
  const slots = VOICE_SLOTS.filter((sl) => catalog.some((l) => l.slot === sl)).map((sl) => {
    const ls = catalog.filter((l) => l.slot === sl);
    const miss = ls.filter((l) => missing.has(l));
    return { slot: sl, language: VOICE_SLOT_INFO[sl].language, gender: VOICE_SLOT_INFO[sl].gender, configured: !!resolveSlotVoiceId(sl, env), lines: ls.length, characters: chars(ls), recorded: ls.length - miss.length, missing: miss.length, missingCharacters: chars(miss) };
  });
  const children = [...new Set(catalog.map((l) => l.child ?? "?"))].map((c) => {
    const ls = catalog.filter((l) => (l.child ?? "?") === c);
    const miss = ls.filter((l) => missing.has(l));
    const needed = new Set(ls.map((l) => l.slot));
    const slotsOk = slots.filter((x) => needed.has(x.slot)).every((x) => x.configured);
    return { child: c, ready: miss.length === 0 && slotsOk, lines: ls.length, characters: chars(ls), recorded: ls.length - miss.length, missing: miss.length, missingCharacters: chars(miss), personal: ls.filter((l) => !isPublicSafeScript(l.text)).length };
  });
  return { ready: missingLines.length === 0 && slots.every((x) => x.configured), slots, children, providerKeyConfigured: !!env.ELEVENLABS_API_KEY, storeConfigured: !!token, model: NARRATION_TTS_MODEL_ID, lines: catalog.length, characters: chars(catalog), recorded: catalog.length - missingLines.length, missing: missingLines.length, missingCharacters: chars(missingLines), missingLines };
}

export type PrepareResult = { status: "prepared" | "not-configured" | "busy" | "cap-reached" | "upstream-failed"; recorded: number; charactersSent: number; remaining: number; failedStatus?: number; /** Lines naming a child: never sent, never stored in the public store (they stay «missing» until a storage decision). */ personalSkipped: number };

async function acquireLock(token: string, deps: StoreDeps): Promise<boolean> {
  const path = PREPARE_LOCK;
  const now = (deps.now ?? Date.now)();
  const take = async () => {
    await (deps.putImpl ?? put)(path, String(now), { access: "public", contentType: "text/plain", allowOverwrite: false, addRandomSuffix: false, token });
    return true;
  };
  try {
    return await take();
  } catch {
    // Already locked: take over only a stale lock (a crashed run), never a live one.
    try {
      const h = await (deps.headImpl ?? head)(path, { token });
      if (now - new Date(h.uploadedAt).getTime() < LOCK_STALE_MS) return false;
      await (deps.delImpl ?? del)(path, { token });
      return await take();
    } catch {
      return false;
    }
  }
}

/**
 * Owner-run, PAID: records the missing catalogued lines (each at most once) until `maxCharacters` would be exceeded.
 * - one run at a time (store lock; a concurrent or retried request answers «busy» and sends nothing);
 * - every line is re-checked right before its request, and stored as soon as it arrives, so an interrupted run resumes with
 *   exactly the lines still missing and nothing is paid twice;
 * - the first upstream failure stops the run (no retries); only catalogued, public-safe text is ever sent.
 * Returns counts only — never the texts, the key or the voice id.
 */
export async function prepareNarration(fullCatalog: NarrationLine[], maxCharacters: number, deps: StoreDeps = {}): Promise<PrepareResult> {
  let catalog = fullCatalog;
  const env = deps.env ?? process.env;
  const token = env.BLOB_READ_WRITE_TOKEN;
  const key = env.ELEVENLABS_API_KEY;
  const cap = Math.max(0, Math.min(maxCharacters, MAX_PREPARE_CHARACTERS));
  // Lines naming a child never go to the provider or into the public store; everything else is prepared.
  const personalSkipped = catalog.filter((l) => !isPublicSafeScript(l.text)).length;
  catalog = catalog.filter((l) => isPublicSafeScript(l.text));
  // Only lines whose slot has a configured voice are recorded; an unconfigured slot is reported, never filled with another voice.
  if (!token || !key || !catalog.some((l) => lineVoiceId(l, env))) return { status: "not-configured", recorded: 0, charactersSent: 0, remaining: catalog.length, personalSkipped };
  if (!(await acquireLock(token, deps))) return { status: "busy", recorded: 0, charactersSent: 0, remaining: -1, personalSkipped };
  try {
    const ready = await narrationReadiness(catalog, deps);
    let recorded = 0;
    let sent = 0;
    for (const l of ready.missingLines) {
      const voice = lineVoiceId(l, env);
      if (!voice) continue;
      if (sent + l.text.length > cap) return { status: "cap-reached", recorded, charactersSent: sent, remaining: ready.missing - recorded, personalSkipped };
      if (await exists(clipPathname(voice, l.id), token, deps.headImpl ?? head)) continue;
      const res = await (deps.fetchImpl ?? fetch)(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=${NARRATION_OUTPUT_FORMAT}`, {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text: l.text, model_id: NARRATION_TTS_MODEL_ID }),
      });
      sent += l.text.length;
      if (!res.ok) return { status: "upstream-failed", recorded, charactersSent: sent, remaining: ready.missing - recorded, failedStatus: res.status, personalSkipped };
      const bytes = await res.arrayBuffer();
      await (deps.putImpl ?? put)(clipPathname(voice, l.id), Buffer.from(bytes), { access: "public", contentType: "audio/mpeg", allowOverwrite: true, addRandomSuffix: false, token });
      recorded += 1;
    }
    return { status: "prepared", recorded, charactersSent: sent, remaining: ready.missing - recorded, personalSkipped };
  } finally {
    await (deps.delImpl ?? del)(PREPARE_LOCK, { token }).catch(() => {});
  }
}
