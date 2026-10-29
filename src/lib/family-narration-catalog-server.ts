// Server-only: the story-voice catalogue of BOTH children (2026-10-29). Built from the content bundled in this build —
// independent of the rollback/content switches — so the owner can prepare and audition every recording while a visit is still
// parked. Isabel: her narrated Visit 2 (every screen line). Santiago: the story lines his released scenes speak today (foreign
// bubble lines and listening messages), each in the slot of the line's language × the character's gender. Fixed reviewed scripts
// only; no child record.
import isabelWorkshopV2 from "@/data/family-learning/content/isabel-workshop-v2.json";
import santiagoExpeditionV7 from "@/data/family-learning/content/santiago-expedition-v7.json";
import { asLearningContent } from "./family-learning-content";
import { asIsabelContent } from "./family-learning-isabel";
import { narrationCatalog, storyCatalog, type NarrationLine } from "./family-learning-narration";

let cached: NarrationLine[] | null = null;
export function servedNarrationCatalog(): NarrationLine[] {
  if (!cached) {
    const isabel = narrationCatalog(asIsabelContent(isabelWorkshopV2)).map((l) => ({ ...l, child: "isabel" as const }));
    const santiago = storyCatalog(asLearningContent(santiagoExpeditionV7), "santiago");
    cached = [...isabel, ...santiago];
  }
  return cached;
}
