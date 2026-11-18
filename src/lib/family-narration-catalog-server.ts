// Server-only: the story-voice catalogue of BOTH children (2026-10-29). Built from the content bundled in this build —
// independent of the rollback/content switches — so the owner can prepare and audition every recording while a visit is still
// parked. Isabel: her narrated Visits 2 and 3 (every screen line; step 1 adds Visit 3, content v3). Santiago: the story lines his released scenes speak today (foreign
// bubble lines and listening messages), each in the slot of the line's language × the character's gender. Fixed reviewed scripts
// only; no child record.
// Nov 18, 2026: the chess coach's closed German line set (de-female, `where: ["chess", …]`) is appended after both children's
// lines — the learning lines and their ids are unchanged (family-chess-narration.test.ts pins them).
import isabelWorkshopV4 from "@/data/family-learning/content/isabel-workshop-v4.json";
import santiagoExpeditionV9 from "@/data/family-learning/content/santiago-expedition-v9.json";
import { ADAPTIVE_CHESS_COACH_LINES_DE } from "@/data/adaptive-chess-coach/bundle.generated";
import { withChessLines } from "./family-chess-narration";
import { asLearningContent } from "./family-learning-content";
import { asIsabelContent } from "./family-learning-isabel";
import { narrationCatalog, storyCatalog, type NarrationLine } from "./family-learning-narration";

let cached: NarrationLine[] | null = null;
export function servedNarrationCatalog(): NarrationLine[] {
  if (!cached) {
    const isabel = narrationCatalog(asIsabelContent(isabelWorkshopV4)).map((l) => ({ ...l, child: "isabel" as const }));
    const santiago = storyCatalog(asLearningContent(santiagoExpeditionV9), "santiago");
    cached = withChessLines([...isabel, ...santiago], ADAPTIVE_CHESS_COACH_LINES_DE);
  }
  return cached;
}
