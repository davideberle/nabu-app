// ---------------------------------------------------------------------------------------------------------------------
// Which voice speaks a catalogued line when a slot gets a new voice (Nov 18, 2026: David picked Sabrina for Gärtnerin Ida from
// Isabel's Visit 5 on; the finished visits stay in Ava). Pure and isomorphic (node --test).
//
// Rule for a slot with a new voice from a visit on (`NEW_VOICE_FROM`):
//  - a line that some narrated mission of that visit or a later one speaks → the slot's CURRENT voice (the new one). This covers
//    the shared lines Visit 5 replays («Wie war es heute?», «Tipp auf das Ohr und hör gut zu.», «Richtig.» …): a visit never
//    mixes two voices;
//  - a line ONLY the finished visits speak, and every chess coach line (`where: ["chess", …]`) → `voice: "previous"`, i.e. the
//    slot's previous voice (`ELEVENLABS_VOICE_<SLOT>_PREVIOUS_ID`), so nothing already recorded has to be paid for again.
// The line ids and texts never change; only the optional `voice` marker is added. With no previous voice configured, the marker
// resolves to the current voice — exactly the behaviour before this change.
// ---------------------------------------------------------------------------------------------------------------------

import type { LearningContent } from "./family-learning-content.ts";
import { catalogKey, narrated, narrationCatalog, type NarrationLine } from "./family-learning-narration.ts";
import type { VoiceSlot } from "./family-voice-registry.ts";

/** Per slot: the first visit (app visit id of Isabel's narrated content) recorded in the slot's new voice. */
export const NEW_VOICE_FROM: Partial<Record<VoiceSlot, { child: "isabel"; visit: string }>> = {
  // Isabel's Visit 5 «Die Vögel ziehen ein» is app visit v6.
  "de-female": { child: "isabel", visit: "v6" },
};

const visitNumber = (v: string | undefined) => {
  const m = /^v(\d+)$/.exec(v ?? "");
  return m ? Number(m[1]) : NaN;
};

/** The catalogue keys (slot|id) each narrated mission's visit speaks: the same catalogue function, one mission at a time. */
export function catalogKeysByVisit(content: LearningContent): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const m of (content.missions ?? []).filter((x) => narrated(x))) {
    const keys = out.get(m.visit) ?? new Set<string>();
    for (const l of narrationCatalog({ ...content, missions: [m] } as LearningContent)) keys.add(catalogKey(l));
    out.set(m.visit, keys);
  }
  return out;
}

/**
 * Marks the served catalogue's lines that keep the previous voice. `isabelContent` = the bundled narrated content of the child
 * the new voice starts with. Lines of other slots, and of other children, are returned untouched.
 */
export function pinPreviousVoices(catalog: NarrationLine[], isabelContent: LearningContent): NarrationLine[] {
  const byVisit = catalogKeysByVisit(isabelContent);
  return catalog.map((l) => {
    const rule = l.slot ? NEW_VOICE_FROM[l.slot] : undefined;
    if (!rule) return l;
    if (l.where?.[0] === "chess") return { ...l, voice: "previous" as const };
    if (l.child !== rule.child) return l;
    const from = visitNumber(rule.visit);
    const k = catalogKey(l);
    const spokenFromNewVisitOn = [...byVisit].some(([v, keys]) => visitNumber(v) >= from && keys.has(k));
    return spokenFromNewVisitOn ? l : { ...l, voice: "previous" as const };
  });
}
