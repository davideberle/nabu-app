// ---------------------------------------------------------------------------------------------------------------------
// Spoken chess coach lines (Nov 18, 2026) — the Adaptive Chess Coach's closed German line set in the EXISTING recorded-narration
// pipeline. Pure and isomorphic (node --test).
//
// The set itself is Game Studio-owned (`chess-lines-de.js`, projected by ops/sync-chess-pilot.sh and embedded by
// scripts/bundle-chess-pilot.mjs as ADAPTIVE_CHESS_COACH_LINES_DE). Here it becomes:
//  - catalogue lines in the `de-female` slot (the learning narration voice), tagged `where: ["chess", "chess:<key>"]`, appended
//    AFTER the learning catalogue (whose lines and ids stay exactly as they were), so the owner's normal recording run
//    (POST /api/family/learning/parent/narration) records them like any catalogue line and the clip route serves them;
//  - a key → same-origin clip URL map injected into the gated chess document as `window.__CHESS_VOICE__`. The game plays a clip by
//    key with HTMLAudio at 0.85 with the pitch preserved, one at a time; a missing clip (404) is silence. Never device speech.
// The lines are name-free (the screen adds the child's name; a recording never says it).
// ---------------------------------------------------------------------------------------------------------------------

import { catalogKey, line, type NarrationLine } from "./family-learning-narration.ts";
import { NARRATION_CLIP_PATH } from "./family-narration-player.ts";
import type { VoiceSlot } from "./family-voice-registry.ts";

export const CHESS_NARRATION_SLOT: VoiceSlot = "de-female";
/** Slower than the learning narration (0.88): the coach speaks to a 7-year-old mid-game. */
export const CHESS_PLAYBACK_RATE = 0.85;

/** The chess lines as catalogue lines (sorted by key; one line per key). */
export function chessNarrationCatalog(lines: Readonly<Record<string, string>>): NarrationLine[] {
  return Object.keys(lines)
    .sort()
    .map((key) => ({ ...line(lines[key], CHESS_NARRATION_SLOT), where: ["chess", `chess:${key}`] }));
}

/**
 * The served catalogue: the learning catalogue UNCHANGED, then the chess lines. A chess line whose text is already catalogued in
 * the same slot would be the same recording under two owners — refused at build/serve time instead of silently merged.
 */
export function withChessLines(base: NarrationLine[], lines: Readonly<Record<string, string>>): NarrationLine[] {
  const taken = new Set(base.map(catalogKey));
  const chess = chessNarrationCatalog(lines);
  for (const l of chess) if (taken.has(catalogKey(l))) throw new Error(`chess line ${l.where?.[1]} duplicates a learning narration line`);
  return [...base, ...chess];
}

/** key → the authenticated same-origin clip route of that line. */
export function chessClipMap(lines: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of chessNarrationCatalog(lines)) out[l.where![1].slice("chess:".length)] = `${NARRATION_CLIP_PATH}/${CHESS_NARRATION_SLOT}/${l.id}`;
  return out;
}

/** The inline script the gated route injects before the game scripts (JSON made safe for an HTML script block). */
export function chessVoiceScript(lines: Readonly<Record<string, string>>): string {
  const json = JSON.stringify({ rate: CHESS_PLAYBACK_RATE, clips: chessClipMap(lines) }).replace(/[<\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return `<script data-chess-voice>window.__CHESS_VOICE__=Object.freeze(${json});</script>`;
}
