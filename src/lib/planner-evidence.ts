/**
 * Companion App binding of the Kitchen-owned reviewed planner evidence rule.
 *
 * The rule itself lives in projects/kitchen/planner-evidence/planner-evidence-rule.ts
 * and is projected verbatim into ./kitchen/planner-evidence-rule.ts
 * (parity-checked by scripts/sync-planner-evidence.mjs --check in prebuild);
 * the ledger is projected into src/data/kitchen/. This module only binds the
 * mirrored ledger to the rule so meals-core.ts, planner-roles.ts, the save
 * boundary and the lookup route consume one registry through one API.
 *
 * Dependency-free (type-only Recipe import): `node --test` and the
 * verification scripts load it directly.
 */

import type { Recipe } from "./recipes.ts";
import { REVIEWED_PLANNER_EVIDENCE } from "../data/kitchen/reviewed-planner-evidence.generated.ts";
import {
  assertReviewedPlannerEvidenceRegistry,
  hasReviewedPlatedMainEvidence as ruleHasReviewedPlatedMainEvidence,
  hasReviewedStarterEvidence as ruleHasReviewedStarterEvidence,
  matchReviewedPlannerEvidence as ruleMatchReviewedPlannerEvidence,
  reviewedMainCookingBlock as ruleReviewedMainCookingBlock,
  type ReviewedPlannerEvidenceRegistry,
  type ReviewedPlannerException,
} from "./kitchen/planner-evidence-rule.ts";

export {
  PLANNER_EVIDENCE_RULE_VERSION,
  assertReviewedPlannerEvidenceRegistry,
  canonicalJson,
  canonicalRecipeDigest,
  sha256Hex,
} from "./kitchen/planner-evidence-rule.ts";
export type {
  ReviewedCategory,
  ReviewedCategoryCorrection,
  ReviewedCategoryHold,
  ReviewedPlannerEvidenceRegistry,
  ReviewedPlannerException,
  ReviewedPlannerRole,
} from "./kitchen/planner-evidence-rule.ts";

let activeRegistry: ReviewedPlannerEvidenceRegistry = assertReviewedPlannerEvidenceRegistry(REVIEWED_PLANNER_EVIDENCE);

export function reviewedPlannerEvidenceRegistry(): ReviewedPlannerEvidenceRegistry {
  return activeRegistry;
}

/**
 * Test-only: run `fn` with a different registry in force (sync or async).
 * Production code never calls this; the mirror generated at build time is the
 * only registry.
 */
export function withReviewedPlannerEvidence<T>(registry: ReviewedPlannerEvidenceRegistry, fn: () => T): T {
  const previous = activeRegistry;
  activeRegistry = assertReviewedPlannerEvidenceRegistry(registry);
  let result: T;
  try {
    result = fn();
  } catch (error) {
    activeRegistry = previous;
    throw error;
  }
  if (result instanceof Promise) {
    return result.finally(() => {
      activeRegistry = previous;
    }) as T;
  }
  activeRegistry = previous;
  return result;
}

export function matchReviewedPlannerEvidence(recipe: Recipe): ReviewedPlannerException | null {
  return ruleMatchReviewedPlannerEvidence(recipe, activeRegistry);
}

export function hasReviewedPlatedMainEvidence(recipe: Recipe): boolean {
  return ruleHasReviewedPlatedMainEvidence(recipe, activeRegistry);
}

export function hasReviewedStarterEvidence(recipe: Recipe): boolean {
  return ruleHasReviewedStarterEvidence(recipe, activeRegistry);
}

export function reviewedMainCookingBlock(recipe: Recipe): string | null {
  return ruleReviewedMainCookingBlock(recipe, activeRegistry);
}
