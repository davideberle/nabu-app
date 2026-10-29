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
// Content version 4 (Visit 5, 2026-10-10) is the served version: version 3 plus the harbor chapter `v6`. Rollback to the
// released chapter set is this build with FAMILY_LEARNING_CONTENT_CAP=3 (a started v6 is parked untouched); CAP=2 / CAP=1
// keep the earlier behaviour. The vocabulary inventory follows the served content version (v3 adds German and the harbor
// words; a capped content serves the matching earlier inventory so every context reconciles).
// Content version 5 (Visit 6, 2026-10-16) is the served version: version 4 plus the mission visit `v7`. Rollback to the
// released chapter set is this build with FAMILY_LEARNING_CONTENT_CAP=4 (a started v7 is parked untouched, its mission state
// and every record stay readable; removing the cap resumes exactly). The vocabulary inventory is unchanged (v3) for 4 and 5.
// Content version 6 (Visit 7, 2026-10-23) is the served version: version 5 plus the scene mission visit `v8`. Rollback to the
// released chapter set is this build with FAMILY_LEARNING_CONTENT_CAP=5 (a started v8 is parked untouched, its mission state
// and every record stay readable; removing the cap resumes exactly). The vocabulary inventory is unchanged (v3).
// Content version 7 (Visit 8, 2026-10-26) is the served version: version 6 plus the map mission visit `v9` and the typing
// lesson TYPE-CH-COURSE-6. Rollback to the released chapter set is this build with FAMILY_LEARNING_CONTENT_CAP=6 (a started
// v9 is parked untouched, its mission state, Nokt talks and every record stay readable; removing the cap resumes exactly).
// The vocabulary inventory is unchanged (v3).
import contentV7 from "@/data/family-learning/content/santiago-expedition-v7.json";
import contentV6 from "@/data/family-learning/content/santiago-expedition-v6.json";
import contentV5 from "@/data/family-learning/content/santiago-expedition-v5.json";
import contentV4 from "@/data/family-learning/content/santiago-expedition-v4.json";
import contentV3 from "@/data/family-learning/content/santiago-expedition-v3.json";
import contentV2 from "@/data/family-learning/content/santiago-expedition-v2.json";
import contentV1 from "@/data/family-learning/content/santiago-expedition-v1.json";
import vocabularyV2 from "@/data/family-learning/content/vocabulary-inventory-v2.json";
import vocabularyV3 from "@/data/family-learning/content/vocabulary-inventory-v3.json";
import isabelWorkshopV1 from "@/data/family-learning/content/isabel-workshop-v1.json";
import isabelWorkshopV2 from "@/data/family-learning/content/isabel-workshop-v2.json";
import { asIsabelContent } from "./family-learning-isabel";
import type { ChildId } from "./family-assistant-turn";
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
    cachedVocabulary = asVocabularyInventory(servedContentVersion() >= 4 ? vocabularyV3 : vocabularyV2, loadLearningContent());
    return cachedVocabulary;
  } catch (error) {
    vocabularyFailure = error instanceof Error ? error : new Error(String(error));
    throw vocabularyFailure;
  }
}

/** The content version this server instance serves (7; 6, 5, 4, 3, 2 or 1 under the rollback cap). */
export function servedContentVersion(): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  const cap = process.env.FAMILY_LEARNING_CONTENT_CAP;
  return cap === "1" ? 1 : cap === "2" ? 2 : cap === "3" ? 3 : cap === "4" ? 4 : cap === "5" ? 5 : cap === "6" ? 6 : 7;
}

export function loadLearningContent(): LearningContent {
  if (cached) return cached;
  if (failure) throw failure;
  try {
    const served = servedContentVersion();
    cached = asLearningContent(served === 1 ? contentV1 : served === 2 ? contentV2 : served === 3 ? contentV3 : served === 4 ? contentV4 : served === 5 ? contentV5 : served === 6 ? contentV6 : contentV7);
    return cached;
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
    throw failure;
  }
}

// ---------------------------------------------------------------------------
// Isabel Visit 1 (2026-10-26): child-bound content. Each child is served HER/HIS OWN reviewed content line — Santiago the
// expedition (above, with its rollback cap), Isabel «Old Lilas kleine Werkstatt» (`isabel-workshop`, version 1). A route
// never serves one child's content to the other: the content is chosen by the child of the verified credential (or the
// parent's explicit child query), and its `child` field is checked again. Isabel's line has its own switch:
// FAMILY_LEARNING_ISABEL_CONTENT=off serves nothing for her (her honest "not prepared" state; a started workshop stays parked
// and readable), independent of Santiago's FAMILY_LEARNING_CONTENT_CAP.
// ---------------------------------------------------------------------------

// Isabel Visit 2 (2026-10-29): her content version 2 = version 1 unchanged + visit `v2` «Idas Garten». Rollback to her released
// visit set is this build with FAMILY_LEARNING_ISABEL_CONTENT_CAP=1: version-1 content is served, a started v2 is parked untouched
// (nothing offered in its place, nothing rewritten, every record readable) and removing the cap resumes it exactly. Santiago's
// FAMILY_LEARNING_CONTENT_CAP never affects her, and hers never affects him.

let cachedIsabel: LearningContent | null = null;
let isabelFailure: Error | null = null;

export function isabelContentServed(): boolean {
  return process.env.FAMILY_LEARNING_ISABEL_CONTENT !== "off";
}

/** Isabel's served content version (2; 1 under FAMILY_LEARNING_ISABEL_CONTENT_CAP=1). */
export function servedIsabelContentVersion(): 1 | 2 {
  return process.env.FAMILY_LEARNING_ISABEL_CONTENT_CAP === "1" ? 1 : 2;
}

export function loadIsabelContent(): LearningContent {
  if (cachedIsabel) return cachedIsabel;
  if (isabelFailure) throw isabelFailure;
  try {
    cachedIsabel = asIsabelContent(servedIsabelContentVersion() === 1 ? isabelWorkshopV1 : isabelWorkshopV2);
    return cachedIsabel;
  } catch (error) {
    isabelFailure = error instanceof Error ? error : new Error(String(error));
    throw isabelFailure;
  }
}

/** The content served to one child, or null when none is prepared for that child (her/his honest "not prepared" state). Throws when the served file does not reconcile. */
export function loadLearningContentFor(child: ChildId): LearningContent | null {
  if (child === "santiago") return loadLearningContent();
  if (child === "isabel") return isabelContentServed() ? loadIsabelContent() : null;
  return null;
}

/** The vocabulary inventory of a child's content (Santiago only; Isabel's workshop has no word inventory). */
export function loadVocabularyInventoryFor(child: ChildId): VocabularyInventory | null {
  return child === "santiago" ? loadVocabularyInventory() : null;
}

/** The content id whose records belong to a child (stable even when the content is switched off). */
export function contentIdFor(child: ChildId): string {
  return child === "isabel" ? "isabel-workshop" : "santiago-expedition";
}
