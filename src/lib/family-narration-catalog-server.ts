// Server-only: the story-voice catalogue of BOTH children (2026-10-29). Built from the content bundled in this build —
// independent of the rollback/content switches — so the owner can prepare and audition every recording while a visit is still
// parked. Isabel: her narrated Visits 2 and 3 (every screen line; step 1 adds Visit 3, content v3). Santiago: the story lines his released scenes speak today (foreign
// bubble lines and listening messages), each in the slot of the line's language × the character's gender. Fixed reviewed scripts
// only; no child record.
// Nov 18, 2026: the chess coach's closed German line set (de-female, `where: ["chess", …]`) is appended after both children's
// lines — the learning lines and their ids are unchanged (family-chess-narration.test.ts pins them).
// Nov 21, 2026: Isabel content v6 (Visit 6 «Das Küken schlüpft», v7); every earlier line keeps its id, text and voice.
import isabelWorkshopV6 from "@/data/family-learning/content/isabel-workshop-v6.json";
import santiagoExpeditionV10 from "@/data/family-learning/content/santiago-expedition-v10.json";
import { ADAPTIVE_CHESS_COACH_LINES_DE } from "@/data/adaptive-chess-coach/bundle.generated";
import { withChessLines } from "./family-chess-narration";
import { asLearningContent } from "./family-learning-content";
import { asIsabelContent } from "./family-learning-isabel";
import { narrationCatalog, storyCatalog, type NarrationLine } from "./family-learning-narration";
import { pinPreviousVoices } from "./family-narration-voices";

let cached: NarrationLine[] | null = null;
export function servedNarrationCatalog(): NarrationLine[] {
  if (!cached) {
    const isabel = narrationCatalog(asIsabelContent(isabelWorkshopV6)).map((l) => ({ ...l, child: "isabel" as const }));
    const santiago = storyCatalog(asLearningContent(santiagoExpeditionV10), "santiago");
    // Nov 18: Ida's new voice starts with Isabel's Visit 5 — lines only the finished visits (and chess) speak keep the previous one.
    cached = pinPreviousVoices(withChessLines([...isabel, ...santiago], ADAPTIVE_CHESS_COACH_LINES_DE), asIsabelContent(isabelWorkshopV6));
  }
  return cached;
}
