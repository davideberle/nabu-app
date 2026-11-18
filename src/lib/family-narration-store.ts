// ---------------------------------------------------------------------------------------------------------------------
// Prerecorded visit narration — server-only storage and the owner-run preparation (Isabel Visit 2, 2026-10-29; I2-06).
//
// Deterministic and cacheable: every narrated line is a REVIEWED, catalogued text (`narrationCatalog`), recorded ONCE with the
// voice of its character's slot (six-slot registry, `family-voice-registry.ts`) with the recording-only key and stored
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

import { createHash, randomBytes } from "node:crypto";
import { del, get, head, list, put } from "@vercel/blob";
import type { NarrationLine } from "./family-learning-narration.ts";
import { isVoiceSlot, resolveSlotVoiceId, VOICE_SLOTS, VOICE_SLOT_INFO, type VoiceSlot } from "./family-voice-registry.ts";

/** Prerecorded once, so the higher-quality multilingual model rather than the low-latency one used for live replies. */
export const NARRATION_TTS_MODEL_ID = "eleven_multilingual_v2";
export const NARRATION_OUTPUT_FORMAT = "mp3_44100_128";
const LINE_ID_PATTERN = /^n[0-9a-f]{28}$/;

export type Env = Record<string, string | undefined>;

// ---------------------------------------------------------------------------------------------------------------------
// Voice per line (Nov 18, Isabel Visit 5: David picked a new Ida voice, «but slower»). A slot's voice can change between visits
// without re-recording the finished ones: a catalogue line marked `voice: "previous"` (the lines only Isabel's finished visits
// speak, and the chess coach's lines) keeps resolving to the slot's PREVIOUS voice (`ELEVENLABS_VOICE_<SLOT>_PREVIOUS_ID`);
// every other line of the slot resolves to the slot's current voice. Unset previous id = the slot's current voice (no change).
// Optional provider speed per slot (`FAMILY_NARRATION_SPEED_<SLOT>`, 0.7–1.2): lines of the CURRENT slot voice are then
// recorded with the voice's stored settings and only `speed` changed, under their own clip key (voice + speed), and played at
// 1.0 (the clip route says so); pinned lines never get a provider speed.
// ---------------------------------------------------------------------------------------------------------------------

export const previousVoiceEnv = (slot: VoiceSlot) => VOICE_SLOT_INFO[slot].env.replace(/_ID$/, "_PREVIOUS_ID");
export const slotSpeedEnv = (slot: VoiceSlot) => `FAMILY_NARRATION_SPEED_${slot.replace("-", "_").toUpperCase()}`;
const VOICE_ID_PATTERN = /^[A-Za-z0-9]{8,64}$/;

/** The provider speed configured for a slot's current voice, or null (unset, malformed or outside the provider's 0.7–1.2). */
export function slotSpeed(slot: VoiceSlot, env: Env = process.env): number | null {
  const raw = env[slotSpeedEnv(slot)]?.trim();
  if (!raw || !/^[01](\.[0-9]{1,2})?$/.test(raw)) return null;
  const v = Number(raw);
  return v >= 0.7 && v <= 1.2 && v !== 1 ? v : null;
}

export type ResolvedVoice = {
  voiceId: string;
  /** Provider speed the clip is recorded with (null = the voice's normal speed). */
  speed: number | null;
  /** Which of the slot's voices: the current one, or the previous one a finished visit keeps. */
  era: "current" | "previous";
  /** First 12 hex of sha256(voice id [+ speed]): the clip folder and the ETag stem. Never the voice id itself. */
  key: string;
};

const voiceKeyOf = (voiceId: string, speed: number | null) => createHash("sha256").update(speed === null ? voiceId : `${voiceId}|speed=${speed}`).digest("hex").slice(0, 12);

/** The voice a catalogued line is recorded and played in, or null (no slot, or the slot has no voice configured). */
export function resolveLineVoice(l: { slot?: VoiceSlot | string | null; voice?: "previous" }, env: Env = process.env): ResolvedVoice | null {
  if (!l.slot || !isVoiceSlot(l.slot)) return null;
  const current = resolveSlotVoiceId(l.slot, env);
  if (l.voice === "previous") {
    const prev = env[previousVoiceEnv(l.slot)]?.trim();
    const voiceId = prev && VOICE_ID_PATTERN.test(prev) ? prev : current;
    return voiceId ? { voiceId, speed: null, era: prev && voiceId === prev ? "previous" : "current", key: voiceKeyOf(voiceId, null) } : null;
  }
  if (!current) return null;
  const speed = slotSpeed(l.slot, env);
  return { voiceId: current, speed, era: "current", key: voiceKeyOf(current, speed) };
}

/** The voice id of a line (see `resolveLineVoice`), or null — a line without a slot is never recorded. */
export function lineVoiceId(l: { slot?: VoiceSlot; voice?: "previous" }, env: Env = process.env): string | null {
  return resolveLineVoice(l, env)?.voiceId ?? null;
}

/** The playback rate a clip of this voice needs, when it differs from the player's per-language default: a clip recorded at a
 *  provider speed is already slow and plays at 1.0 (never slowed twice). Null = the player's default for the slot. */
export const clipPlaybackRate = (v: ResolvedVoice | null): number | null => (v && v.speed !== null ? 1 : null);
export const NARRATION_RATE_HEADER = "X-Narration-Rate";

export const isNarrationLineId = (id: string) => LINE_ID_PATTERN.test(id);

function pathFor(voiceKey: string, lineId: string): string {
  if (!isNarrationLineId(lineId)) throw new Error("not a narration line id");
  return `family-narration/${voiceKey}/${lineId}.mp3`;
}

/** The clip of a line in a voice at its normal speed (the layout every clip recorded before Nov 18 uses). */
export function clipPathname(voiceId: string, lineId: string): string {
  return pathFor(voiceKeyOf(voiceId, null), lineId);
}

/** The clip of a line in its resolved voice (voice + provider speed). */
export function lineClipPathname(v: ResolvedVoice, lineId: string): string {
  return pathFor(v.key, lineId);
}

/** The validator of one clip: changes when the line's resolved voice (or its speed) changes, so a device never replays another voice. */
export function clipEtag(l: { slot?: VoiceSlot | string | null; id: string; voice?: "previous" }, env: Env = process.env): string | null {
  const v = resolveLineVoice(l, env);
  return v ? `"${v.key}-${l.id}"` : null;
}

export type StoreDeps = {
  env?: Env;
  getImpl?: typeof get;
  headImpl?: typeof head;
  putImpl?: typeof put;
  delImpl?: typeof del;
  listImpl?: typeof list;
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

// ---------------------------------------------------------------------------------------------------------------------
// Owner spend budget (2026-10-29 12:05: «≤ 6000 characters across all calls/attempts of this approval»). A paid run needs
// `FAMILY_NARRATION_BUDGET=<approval id>:<characters>`; without it nothing is sent. Every provider request is RESERVED in the
// ledger before it is sent — one store object per request (a unique name), its characters in the path — so a failed, interrupted or uncertain
// request still counts, and a later run (any call, any instance) adds to the same total. The ledger is listed from the store API
// (not a cached copy); if it cannot be read or written, nothing is sent.
// ---------------------------------------------------------------------------------------------------------------------

export const BUDGET_SWITCH = "FAMILY_NARRATION_BUDGET";
/**
 * The provider key used ONLY for this owner-run recording — deliberately not the app's shared `ELEVENLABS_API_KEY`, which also
 * serves the children's live speech and the household transcription route: configuring recordings must never switch those on.
 */
export const NARRATION_KEY_ENV = "ELEVENLABS_NARRATION_API_KEY";
const BUDGET_PATTERN = /^([a-z0-9][a-z0-9-]{0,62}):([1-9][0-9]{0,5})$/;
export function narrationBudget(env: Env): { approval: string; characters: number } | null {
  const m = BUDGET_PATTERN.exec((env[BUDGET_SWITCH] ?? "").trim());
  return m ? { approval: m[1], characters: Number(m[2]) } : null;
}
export const ledgerPrefix = (approval: string) => `family-narration/budget/${approval}/`;

/** Characters already reserved under this approval (every request ever sent or attempted), or null when the ledger is unreadable. */
export async function budgetSpent(approval: string, token: string, deps: StoreDeps = {}): Promise<{ characters: number; requests: number } | null> {
  try {
    let characters = 0;
    let requests = 0;
    let cursor: string | undefined;
    do {
      const page = await (deps.listImpl ?? list)({ prefix: ledgerPrefix(approval), token, cursor, limit: 1000 });
      for (const b of page.blobs) {
        const n = /-(\d+)\.txt$/.exec(b.pathname);
        if (!n) return null;
        characters += Number(n[1]);
        requests += 1;
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return { characters, requests };
  } catch {
    return null;
  }
}

/** The stored clip of one catalogued line in its resolved voice, or null (no voice, no store, not recorded). */
export async function readNarrationClip(l: { slot?: VoiceSlot | string | null; id: string; voice?: "previous" }, deps: StoreDeps = {}): Promise<ReadableStream<Uint8Array> | null> {
  const env = deps.env ?? process.env;
  const voice = resolveLineVoice(l, env);
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!voice || !token || !isNarrationLineId(l.id)) return null;
  try {
    const res = await (deps.getImpl ?? get)(lineClipPathname(voice, l.id), { access: "public", token });
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

export async function exists(pathname: string, token: string, headImpl: typeof head): Promise<boolean> {
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
    const voice = resolveLineVoice(l, env);
    if (!voice || !token || !(await exists(lineClipPathname(voice, l.id), token, deps.headImpl ?? head))) missingLines.push(l);
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
  return { ready: missingLines.length === 0 && slots.every((x) => x.configured), slots, children, providerKeyConfigured: !!env[NARRATION_KEY_ENV], storeConfigured: !!token, model: NARRATION_TTS_MODEL_ID, lines: catalog.length, characters: chars(catalog), recorded: catalog.length - missingLines.length, missing: missingLines.length, missingCharacters: chars(missingLines), missingLines };
}

/** Characters per 1,000 the provider bills on the narration model (≈ $0.08, the rate the owner's cost estimates use). */
export const NARRATION_USD_PER_1000_CHARACTERS = 0.08;

export type NarrationPlan = {
  status: "planned" | "store-unavailable";
  /** Lines and characters a `prepare-narration` run would send now (public-safe lines with a configured voice, still missing). */
  missing: number;
  missingCharacters: number;
  /** Per slot × resolved voice («current» or «previous», with the provider speed if any): counts only, no text, no ids. */
  groups: { slot: VoiceSlot; voice: "current" | "previous"; speed: number | null; lines: number; missing: number; missingCharacters: number }[];
  /** Lines whose slot has no voice configured (never recorded) and lines naming a child (never sent). */
  unconfigured: number;
  personalSkipped: number;
  estimatedUsd: number;
  budget: { approval: string; limit: number; spent: number | null; requests: number | null } | null;
  providerKeyConfigured: boolean;
};

/**
 * FREE dry run of `prepareNarration` (owner/release key, `confirm: "plan-narration"`): reads which clips exist (store HEAD calls
 * and the ledger listing only) and reports what a paid run would send — no provider call, no ledger entry, no lock, no write.
 */
export async function planNarration(fullCatalog: NarrationLine[], deps: StoreDeps = {}): Promise<NarrationPlan> {
  const env = deps.env ?? process.env;
  const token = env.BLOB_READ_WRITE_TOKEN;
  const personalSkipped = fullCatalog.filter((l) => !isPublicSafeScript(l.text)).length;
  const catalog = fullCatalog.filter((l) => isPublicSafeScript(l.text));
  const b = narrationBudget(env);
  const spent = b && token ? await budgetSpent(b.approval, token, deps) : null;
  const budget = b ? { approval: b.approval, limit: b.characters, spent: spent?.characters ?? null, requests: spent?.requests ?? null } : null;
  const base = { personalSkipped, budget, providerKeyConfigured: !!env[NARRATION_KEY_ENV] };
  if (!token) return { status: "store-unavailable", missing: 0, missingCharacters: 0, groups: [], unconfigured: catalog.length, estimatedUsd: 0, ...base };
  const groups = new Map<string, NarrationPlan["groups"][number]>();
  let unconfigured = 0;
  for (const l of catalog) {
    const v = resolveLineVoice(l, env);
    if (!v || !l.slot) {
      unconfigured += 1;
      continue;
    }
    const k = `${l.slot}|${v.era}|${v.speed ?? ""}`;
    const g = groups.get(k) ?? { slot: l.slot, voice: v.era, speed: v.speed, lines: 0, missing: 0, missingCharacters: 0 };
    g.lines += 1;
    if (!(await exists(lineClipPathname(v, l.id), token, deps.headImpl ?? head))) {
      g.missing += 1;
      g.missingCharacters += l.text.length;
    }
    groups.set(k, g);
  }
  const list = [...groups.values()].sort((x, y) => (`${x.slot}|${x.voice}` < `${y.slot}|${y.voice}` ? -1 : 1));
  const missingCharacters = list.reduce((n, g) => n + g.missingCharacters, 0);
  return { status: "planned", missing: list.reduce((n, g) => n + g.missing, 0), missingCharacters, groups: list, unconfigured, estimatedUsd: Math.round(missingCharacters * NARRATION_USD_PER_1000_CHARACTERS * 10) / 10000, ...base };
}

export type PrepareResult = {
  status: "prepared" | "not-configured" | "no-budget" | "budget-unavailable" | "budget-reached" | "busy" | "cap-reached" | "upstream-failed" | "store-failed";
  recorded: number;
  charactersSent: number;
  remaining: number;
  failedStatus?: number;
  /** Lines naming a child: never sent, never stored in the public store (they stay «missing» until a storage decision). */
  personalSkipped: number;
  /** The owner budget after this run: characters reserved under the approval (all calls, failed ones included) and its limit. */
  budget?: { approval: string; limit: number; spent: number; requests: number };
};

export async function acquireLock(token: string, deps: StoreDeps): Promise<boolean> {
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
 * - the first upstream failure stops the run (no retries); only catalogued, public-safe text is ever sent;
 * - the owner's total budget (`FAMILY_NARRATION_BUDGET`) is enforced across runs: each request is reserved before it is sent.
 * Returns counts only — never the texts, the key or the voice id.
 */
export async function prepareNarration(fullCatalog: NarrationLine[], maxCharacters: number, deps: StoreDeps = {}): Promise<PrepareResult> {
  let catalog = fullCatalog;
  const env = deps.env ?? process.env;
  const token = env.BLOB_READ_WRITE_TOKEN;
  const key = env[NARRATION_KEY_ENV];
  const cap = Math.max(0, Math.min(maxCharacters, MAX_PREPARE_CHARACTERS));
  // Lines naming a child never go to the provider or into the public store; everything else is prepared.
  const personalSkipped = catalog.filter((l) => !isPublicSafeScript(l.text)).length;
  catalog = catalog.filter((l) => isPublicSafeScript(l.text));
  // Only lines whose slot has a configured voice are recorded; an unconfigured slot is reported, never filled with another voice.
  if (!token || !key || !catalog.some((l) => lineVoiceId(l, env))) return { status: "not-configured", recorded: 0, charactersSent: 0, remaining: catalog.length, personalSkipped };
  const budget = narrationBudget(env);
  if (!budget) return { status: "no-budget", recorded: 0, charactersSent: 0, remaining: catalog.length, personalSkipped };
  if (!(await acquireLock(token, deps))) return { status: "busy", recorded: 0, charactersSent: 0, remaining: -1, personalSkipped };
  try {
    const before = await budgetSpent(budget.approval, token, deps);
    if (!before) return { status: "budget-unavailable", recorded: 0, charactersSent: 0, remaining: -1, personalSkipped };
    let spent = before.characters;
    let requests = before.requests;
    const report = () => ({ approval: budget.approval, limit: budget.characters, spent, requests });
    const ready = await narrationReadiness(catalog, deps);
    let recorded = 0;
    let sent = 0;
    const settings = new Map<string, Record<string, unknown>>();
    for (const l of ready.missingLines) {
      const voice = resolveLineVoice(l, env);
      if (!voice) continue;
      if (sent + l.text.length > cap) return { status: "cap-reached", recorded, charactersSent: sent, remaining: ready.missing - recorded, personalSkipped, budget: report() };
      if (spent + l.text.length > budget.characters) return { status: "budget-reached", recorded, charactersSent: sent, remaining: ready.missing - recorded, personalSkipped, budget: report() };
      if (await exists(lineClipPathname(voice, l.id), token, deps.headImpl ?? head)) continue;
      // Reserve BEFORE sending: whatever happens to the request, it is counted.
      try {
        await (deps.putImpl ?? put)(`${ledgerPrefix(budget.approval)}${String((deps.now ?? Date.now)()).padStart(14, "0")}-${randomBytes(4).toString("hex")}-${l.id}-${l.text.length}.txt`, String(l.text.length), { access: "public", contentType: "text/plain", allowOverwrite: false, addRandomSuffix: false, token });
      } catch {
        return { status: "budget-unavailable", recorded, charactersSent: sent, remaining: ready.missing - recorded, personalSkipped, budget: report() };
      }
      spent += l.text.length;
      requests += 1;
      sent += l.text.length;
      let res: Response;
      try {
        // A provider speed: the voice's own stored settings (a free read, once per voice) with only `speed` changed.
        let voiceSettings: Record<string, unknown> | undefined;
        if (voice.speed !== null) {
          if (!settings.has(voice.voiceId)) {
            const vs = await (deps.fetchImpl ?? fetch)(`https://api.elevenlabs.io/v1/voices/${voice.voiceId}/settings`, { headers: { "xi-api-key": key, Accept: "application/json" } });
            if (!vs.ok) return { status: "upstream-failed", recorded, charactersSent: sent, remaining: ready.missing - recorded, failedStatus: vs.status, personalSkipped, budget: report() };
            settings.set(voice.voiceId, (await vs.json()) as Record<string, unknown>);
          }
          voiceSettings = { ...settings.get(voice.voiceId), speed: voice.speed };
        }
        res = await (deps.fetchImpl ?? fetch)(`https://api.elevenlabs.io/v1/text-to-speech/${voice.voiceId}?output_format=${NARRATION_OUTPUT_FORMAT}`, {
          method: "POST",
          headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
          body: JSON.stringify({ text: l.text, model_id: NARRATION_TTS_MODEL_ID, ...(voiceSettings ? { voice_settings: voiceSettings } : {}) }),
        });
      } catch {
        // No answer (network): the request may have been billed — it stays reserved, and the run stops.
        return { status: "upstream-failed", recorded, charactersSent: sent, remaining: ready.missing - recorded, failedStatus: 0, personalSkipped, budget: report() };
      }
      if (!res.ok) return { status: "upstream-failed", recorded, charactersSent: sent, remaining: ready.missing - recorded, failedStatus: res.status, personalSkipped, budget: report() };
      try {
        const bytes = await res.arrayBuffer();
        await (deps.putImpl ?? put)(lineClipPathname(voice, l.id), Buffer.from(bytes), { access: "public", contentType: "audio/mpeg", allowOverwrite: true, addRandomSuffix: false, token });
      } catch {
        return { status: "store-failed", recorded, charactersSent: sent, remaining: ready.missing - recorded, personalSkipped, budget: report() };
      }
      recorded += 1;
    }
    return { status: "prepared", recorded, charactersSent: sent, remaining: ready.missing - recorded, personalSkipped, budget: report() };
  } finally {
    await (deps.delImpl ?? del)(PREPARE_LOCK, { token }).catch(() => {});
  }
}
