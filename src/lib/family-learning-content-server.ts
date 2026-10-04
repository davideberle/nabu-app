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
// Content version 3 (Visit 4, 2026-10-04) is the served version: version 2 plus the pier chapter `v5`. Rollback to the
// released chapter set is this build with FAMILY_LEARNING_CONTENT_CAP=2 (a started v5 is parked untouched, nothing
// rewritten, every record readable); CAP=1 keeps the pilot content as before.
import contentV3 from "@/data/family-learning/content/santiago-expedition-v3.json";
import contentV2 from "@/data/family-learning/content/santiago-expedition-v2.json";
import contentV1 from "@/data/family-learning/content/santiago-expedition-v1.json";
import vocabularyV2 from "@/data/family-learning/content/vocabulary-inventory-v2.json";
import { asLearningContent, type LearningContent } from "./family-learning-content";
import { asVocabularyInventory, type VocabularyInventory } from "./family-learning-vocabulary";

let cached: LearningContent | null = null;
let failure: Error | null = null;
let cachedVocabulary: VocabularyInventory | null = null;
let vocabularyFailure: Error | null = null;

/**
 * The reviewed vocabulary inventory (follow-on M3), reconciled by stable id
 * against the SERVED content once per server instance. Contexts of segments
 * the served content does not carry (content cap) are simply not served.
 * A file that does not reconcile makes the learning routes answer 503, like
 * mis-keyed content.
 */
export function loadVocabularyInventory(): VocabularyInventory {
  if (cachedVocabulary) return cachedVocabulary;
  if (vocabularyFailure) throw vocabularyFailure;
  try {
    cachedVocabulary = asVocabularyInventory(vocabularyV2, loadLearningContent());
    return cachedVocabulary;
  } catch (error) {
    vocabularyFailure = error instanceof Error ? error : new Error(String(error));
    throw vocabularyFailure;
  }
}

/** The content version this server instance serves (3; 2 or 1 under the rollback cap). */
export function servedContentVersion(): 1 | 2 | 3 {
  const cap = process.env.FAMILY_LEARNING_CONTENT_CAP;
  return cap === "1" ? 1 : cap === "2" ? 2 : 3;
}

export function loadLearningContent(): LearningContent {
  if (cached) return cached;
  if (failure) throw failure;
  try {
    const served = servedContentVersion();
    cached = asLearningContent(served === 1 ? contentV1 : served === 2 ? contentV2 : contentV3);
    return cached;
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
    throw failure;
  }
}
