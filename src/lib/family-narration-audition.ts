// ---------------------------------------------------------------------------------------------------------------------
// Owner-only German voice audition (Nov 18 round, 2026-11-18). David finds the current de-female narration voice flat; before
// any re-recording he picks a new one by ear. This module records a FIXED, compiled list — four native German library voices ×
// two fixed lines in Gärtnerin Ida's voice (Isabel's Visit 5 «Die Vögel ziehen ein») — once, with the same model, output
// format, recording-only key, global lock and owner budget ledger as the catalogue preparation in `family-narration-store.ts`.
//
// - Nothing in the request selects a voice or a text: the route passes only the character cap.
// - Clips live under their own prefix `family-narration/audition-20261118/<voice key>/line<n>.mp3`, which no child route reads
//   (child clips are `family-narration/<12 hex>/<catalogue line id>.mp3`, served by catalogue id only). The audition voices are
//   not in the voice registry, so they can never speak a child-facing line unless the owner later sets a slot to one of them.
// - Idempotent: an existing clip is never paid for again; it is read back and returned with the new ones.
// This module reads `process.env` and must never be imported by a client component or a child route.
// ---------------------------------------------------------------------------------------------------------------------

import { randomBytes } from "node:crypto";
import { del, get, head, put } from "@vercel/blob";
import { acquireLock, budgetSpent, exists, isPublicSafeScript, ledgerPrefix, MAX_PREPARE_CHARACTERS, NARRATION_KEY_ENV, NARRATION_OUTPUT_FORMAT, NARRATION_TTS_MODEL_ID, narrationBudget, PREPARE_LOCK, type StoreDeps } from "./family-narration-store.ts";

export const AUDITION_ID = "audition-20261118";

/** The four candidates (native German, standard accent, verified for German on eleven_multilingual_v2, female). Fixed. */
export const AUDITION_VOICES: readonly { readonly key: string; readonly label: string; readonly voiceId: string }[] = Object.freeze([
  Object.freeze({ key: "annika", label: "Annika", voiceId: "ViKqgJNeCiWZlYgHiAOO" }),
  Object.freeze({ key: "emilia", label: "Emilia", voiceId: "ghgFyr7gmpr57xyTgX9q" }),
  Object.freeze({ key: "ela", label: "Ela", voiceId: "NE7AIW5DoJ7lUosXV2KR" }),
  Object.freeze({ key: "sabrina", label: "Sabrina", voiceId: "cqPdIo76zSHFDcSZpFov" }),
]);

/** Ida, Isabel's Visit 5 (not in the catalogue yet): one narrative line, one question. Swiss spelling, no child names. */
export const AUDITION_LINES: readonly { readonly line: 1 | 2; readonly text: string }[] = Object.freeze([
  Object.freeze({ line: 1 as const, text: "Schau mal! Die Rotkehlchen sind eingezogen. Jetzt haben sie bestimmt Hunger." }),
  Object.freeze({ line: 2 as const, text: "Wie viele Körner sind das? Zähl mit mir: zehn, zwanzig, dreissig …" }),
]);

/**
 * Nov 18, afternoon (David picked Sabrina, "but slower"): ONE extra fixed clip — Sabrina, line 1, with the provider's own speed
 * setting 0.85 (played at 1.0) — to compare with the app's 0.85 playback of her normal clip. Fixed like the rest: nothing from the
 * request selects it. Her stored voice settings are read first (free) so only the speed differs from her normal clip.
 */
export const AUDITION_SLOW = Object.freeze({ key: "sabrina-speed085", label: "Sabrina (Tempo 0.85)", voiceId: "cqPdIo76zSHFDcSZpFov", line: 1 as const, speed: 0.85 });

/** Characters one full audition sends (each line once per voice, plus the one slow clip): the cost basis. */
export const AUDITION_CHARACTERS = AUDITION_VOICES.length * AUDITION_LINES.reduce((n, l) => n + l.text.length, 0) + AUDITION_LINES[0].text.length;

export const auditionClipPathname = (voiceKey: string, line: number) => `family-narration/${AUDITION_ID}/${voiceKey}/line${line}.mp3`;

// ---------------------------------------------------------------------------------------------------------------------
// The POST body of the owner narration route, strict: exactly `confirm` and `maxCharacters`, nothing else (no text, no voice).
// ---------------------------------------------------------------------------------------------------------------------

export type NarrationPost = { mode: "prepare-narration" | "record-audition"; maxCharacters: number };
export function parseNarrationPost(body: unknown): { ok: true; value: NarrationPost } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body) || Object.keys(body).some((k) => k !== "confirm" && k !== "maxCharacters")) return { ok: false, error: "Body accepts exactly confirm and maxCharacters (no text: only the reviewed catalogue is ever recorded)" };
  const { confirm, maxCharacters } = body as Record<string, unknown>;
  if (confirm !== "prepare-narration" && confirm !== "record-audition") return { ok: false, error: "confirm must be \"prepare-narration\"" };
  if (typeof maxCharacters !== "number" || !Number.isInteger(maxCharacters) || maxCharacters < 1 || maxCharacters > MAX_PREPARE_CHARACTERS) return { ok: false, error: `maxCharacters must be an integer between 1 and ${MAX_PREPARE_CHARACTERS}` };
  return { ok: true, value: { mode: confirm, maxCharacters } };
}

// ---------------------------------------------------------------------------------------------------------------------
// The paid run.
// ---------------------------------------------------------------------------------------------------------------------

export type AuditionClip = { label: string; line: number; characters: number; status: "recorded" | "existing" | "not-recorded"; audioBase64?: string };
export type AuditionResult = {
  status: "recorded" | "not-configured" | "no-budget" | "budget-unavailable" | "budget-reached" | "busy" | "cap-reached" | "upstream-failed" | "store-failed";
  recorded: number;
  existing: number;
  charactersSent: number;
  failedStatus?: number;
  budget?: { approval: string; limit: number; spent: number; requests: number };
  /** One entry per fixed (voice, line), in list order: label + line number + characters + status (+ the MP3 as base64). */
  clips: AuditionClip[];
};

async function readClip(pathname: string, token: string, deps: StoreDeps): Promise<Buffer | null> {
  try {
    const res = await (deps.getImpl ?? get)(pathname, { access: "public", token });
    if (!res || !("stream" in res) || !res.stream) return null;
    return Buffer.from(await new Response(res.stream as ReadableStream<Uint8Array>).arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Owner-run, PAID (≈ AUDITION_CHARACTERS characters once): records the fixed audition list. Same guarantees as
 * `prepareNarration`: global lock, every request reserved in the owner ledger BEFORE it is sent, first failure stops the run
 * (no retry), existing clips are skipped (never paid twice). Never logs or returns the key, a voice id or the texts.
 */
export async function recordAudition(maxCharacters: number, deps: StoreDeps = {}): Promise<AuditionResult> {
  const env = deps.env ?? process.env;
  const token = env.BLOB_READ_WRITE_TOKEN;
  const key = env[NARRATION_KEY_ENV];
  const cap = Math.max(0, Math.min(maxCharacters, MAX_PREPARE_CHARACTERS));
  const plan: { voice: { key: string; label: string; voiceId: string }; line: number; text: string; path: string; speed?: number }[] = [
    ...AUDITION_VOICES.flatMap((v) => AUDITION_LINES.map((l) => ({ voice: v, line: l.line, text: l.text, path: auditionClipPathname(v.key, l.line) }))),
    { voice: AUDITION_SLOW, line: AUDITION_SLOW.line, text: AUDITION_LINES[0].text, path: auditionClipPathname(AUDITION_SLOW.key, AUDITION_SLOW.line), speed: AUDITION_SLOW.speed },
  ];
  const clips: AuditionClip[] = plan.map((p) => ({ label: p.voice.label, line: p.line, characters: p.text.length, status: "not-recorded" }));
  const base = { recorded: 0, existing: 0, charactersSent: 0, clips };
  // Defence in depth: the fixed lines are public-safe by construction (a test pins it).
  if (!plan.every((p) => isPublicSafeScript(p.text))) return { status: "not-configured", ...base };
  if (!token || !key) return { status: "not-configured", ...base };
  const budget = narrationBudget(env);
  if (!budget) return { status: "no-budget", ...base };
  if (!(await acquireLock(token, deps))) return { status: "busy", ...base };
  try {
    const before = await budgetSpent(budget.approval, token, deps);
    if (!before) return { status: "budget-unavailable", ...base };
    let spent = before.characters;
    let requests = before.requests;
    let recorded = 0;
    let existing = 0;
    let sent = 0;
    const out = (status: AuditionResult["status"], extra: Partial<AuditionResult> = {}): AuditionResult => ({ status, recorded, existing, charactersSent: sent, budget: { approval: budget.approval, limit: budget.characters, spent, requests }, clips, ...extra });
    for (const [i, p] of plan.entries()) {
      if (await exists(p.path, token, deps.headImpl ?? head)) {
        const bytes = await readClip(p.path, token, deps);
        if (bytes) clips[i] = { ...clips[i], status: "existing", audioBase64: bytes.toString("base64") };
        existing += 1;
        continue;
      }
      if (sent + p.text.length > cap) return out("cap-reached");
      if (spent + p.text.length > budget.characters) return out("budget-reached");
      // Reserve BEFORE sending: whatever happens to the request, it is counted.
      try {
        await (deps.putImpl ?? put)(`${ledgerPrefix(budget.approval)}${String((deps.now ?? Date.now)()).padStart(14, "0")}-${randomBytes(4).toString("hex")}-${AUDITION_ID}-${p.voice.key}-line${p.line}-${p.text.length}.txt`, String(p.text.length), { access: "public", contentType: "text/plain", allowOverwrite: false, addRandomSuffix: false, token });
      } catch {
        return out("budget-unavailable");
      }
      spent += p.text.length;
      requests += 1;
      sent += p.text.length;
      let res: Response;
      try {
        // The slow clip: the voice's own stored settings (free read) with only the speed changed.
        let voiceSettings: Record<string, unknown> | undefined;
        if (p.speed !== undefined) {
          const vs = await (deps.fetchImpl ?? fetch)(`https://api.elevenlabs.io/v1/voices/${p.voice.voiceId}/settings`, { headers: { "xi-api-key": key, Accept: "application/json" } });
          if (!vs.ok) return out("upstream-failed", { failedStatus: vs.status });
          voiceSettings = { ...((await vs.json()) as Record<string, unknown>), speed: p.speed };
        }
        res = await (deps.fetchImpl ?? fetch)(`https://api.elevenlabs.io/v1/text-to-speech/${p.voice.voiceId}?output_format=${NARRATION_OUTPUT_FORMAT}`, {
          method: "POST",
          headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
          body: JSON.stringify({ text: p.text, model_id: NARRATION_TTS_MODEL_ID, ...(voiceSettings ? { voice_settings: voiceSettings } : {}) }),
        });
      } catch {
        return out("upstream-failed", { failedStatus: 0 });
      }
      if (!res.ok) return out("upstream-failed", { failedStatus: res.status });
      let bytes: Buffer;
      try {
        bytes = Buffer.from(await res.arrayBuffer());
        await (deps.putImpl ?? put)(p.path, bytes, { access: "public", contentType: "audio/mpeg", allowOverwrite: true, addRandomSuffix: false, token });
      } catch {
        return out("store-failed");
      }
      clips[i] = { ...clips[i], status: "recorded", audioBase64: bytes.toString("base64") };
      recorded += 1;
    }
    return out("recorded");
  } finally {
    await (deps.delImpl ?? del)(PREPARE_LOCK, { token }).catch(() => {});
  }
}
