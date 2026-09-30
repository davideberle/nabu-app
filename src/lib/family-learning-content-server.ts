// Server-only loader for the mirrored Family Assistant learning content.
//
// The JSON is the byte-identical mirror maintained by
// `scripts/sync-family-learning.mjs` (checked in `prebuild`). Reconciliation by
// stable ID runs once per server instance; a content file that does not match
// its declared version's inventory makes every learning route answer 503
// rather than serve a partial or mis-keyed mission.

// Content version 2 (approved redesign 2026-09-29) is the served version; it
// is a strict additive superset of version 1, which stays mirrored for
// parity/history. Saved missions are upgraded additively on load.
//
// Forward-repair rollback (independent repair, release rollback gate): the
// previous production build cannot read a mission that has started chapter 4
// (its state module throws "unknown visit v4"), so re-deploying it is NOT a
// safe rollback once any v4 record exists. The supported rollback is this
// same build with FAMILY_LEARNING_CONTENT_CAP=1: version-1 content is served,
// a started chapter 4 is parked untouched (nothing offered in its place,
// nothing rewritten), every record stays readable in the parent cockpit, and
// removing the cap resumes chapter 4 exactly where it was.
import contentV2 from "@/data/family-learning/content/santiago-expedition-v2.json";
import contentV1 from "@/data/family-learning/content/santiago-expedition-v1.json";
import { asLearningContent, type LearningContent } from "./family-learning-content";

let cached: LearningContent | null = null;
let failure: Error | null = null;

/** The content version this server instance serves (2, or 1 under the rollback cap). */
export function servedContentVersion(): 1 | 2 {
  return process.env.FAMILY_LEARNING_CONTENT_CAP === "1" ? 1 : 2;
}

export function loadLearningContent(): LearningContent {
  if (cached) return cached;
  if (failure) throw failure;
  try {
    cached = asLearningContent(servedContentVersion() === 1 ? contentV1 : contentV2);
    return cached;
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
    throw failure;
  }
}
