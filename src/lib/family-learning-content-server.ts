// Server-only loader for the mirrored Family Assistant learning content.
//
// The JSON is the byte-identical mirror maintained by
// `scripts/sync-family-learning.mjs` (checked in `prebuild`). Reconciliation by
// stable ID runs once per server instance; a content file that does not match
// the version-1 inventory makes every learning route answer 503 rather than
// serve a partial or mis-keyed mission.

import contentJson from "@/data/family-learning/content/santiago-expedition-v1.json";
import { asLearningContent, type LearningContent } from "./family-learning-content";

let cached: LearningContent | null = null;
let failure: Error | null = null;

export function loadLearningContent(): LearningContent {
  if (cached) return cached;
  if (failure) throw failure;
  try {
    cached = asLearningContent(contentJson);
    return cached;
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
    throw failure;
  }
}
