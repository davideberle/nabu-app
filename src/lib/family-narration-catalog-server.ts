// Server-only: the narration catalogue (Isabel Visit 2, 2026-10-29). It is built from every NARRATED content version bundled in
// this build — independent of the rollback/content switches — so the owner can prepare and audition the recordings while the
// visit itself is still parked (FAMILY_LEARNING_ISABEL_CONTENT_CAP=1). Only fixed reviewed scripts; no child record.
import isabelWorkshopV2 from "@/data/family-learning/content/isabel-workshop-v2.json";
import { asIsabelContent } from "./family-learning-isabel";
import { narrationCatalog, type NarrationLine } from "./family-learning-narration";

let cached: NarrationLine[] | null = null;
export function servedNarrationCatalog(): NarrationLine[] {
  if (!cached) cached = narrationCatalog(asIsabelContent(isabelWorkshopV2));
  return cached;
}
