/**
 * Runtime wiring for weekly preparation.
 *
 * `planner-preparation.ts` holds the orchestration and takes every data
 * dependency as an injected function so it stays testable without a database
 * or the recipe bundle. This module is the other half: it binds those
 * dependencies to the real Turso helpers, the real recipe corpus, and the real
 * Kitchen importer. It is imported only by API routes.
 */

import {
  getCountedExposureRecipeIds,
  getExposureExcludedRecipeIds,
  getExposureRecords,
  getLegacyOfferedRecipeIds,
  getMyRecipe,
  getPlannedRecipeIdsForWeeks,
  getPlannedRecipeIdsSince,
  getPlannerRecencyExclusions,
  getStagedWebRecipes,
  getStagedWebRecipesImportedBefore,
  getWebInspirationsForWeek,
  expireStagedWebRecipe,
  promoteStagedWebRecipe,
  saveCountedExposureRecipeIds,
  saveExposureRecords,
  saveExposureWithCountedIds,
} from "@/lib/db";
import { getAllRecipes, getRecipe } from "@/lib/recipes";
import { loadMealPlan, saveMealPlan } from "@/lib/meals-persistence";
import { resolveWebInspirations } from "@/lib/meal-inspirations";
import { catalogExclusionIds, toShelfCandidate } from "@/lib/planner-preparation";
import type { PreparationDeps, RolloverDeps } from "@/lib/planner-preparation";
import { SHELF_POLICY_VERSION, type ShelfCandidate } from "@/lib/planner-shelf";
import { getRecentWeekIds, plannerPolicy } from "@/lib/meals-core";
import { classifyPlannerRole } from "@/lib/planner-roles";
import { isStagedRecipe } from "@/lib/planner-staging";

/**
 * Staged web ideas for a week, resolved and role-classified.
 *
 * Order is preserved as the discovery rank, so an editorially prominent pick
 * keeps its position advantage in scoring without being auto-qualified.
 */
export async function loadWebCandidatesForWeek(week: string, now: Date): Promise<ShelfCandidate[]> {
  const [inspirations, staged] = await Promise.all([
    getWebInspirationsForWeek(week),
    getStagedWebRecipes([week]),
  ]);
  const discoveryById = new Map(staged.map((record) => [record.recipeId, record.discovery ?? null]));

  const candidates: ShelfCandidate[] = [];
  let rank = 0;
  for (const inspiration of inspirations) {
    const recipe = await getMyRecipe(inspiration.recipe_id);
    if (!recipe) continue;
    const discovery = discoveryById.get(inspiration.recipe_id) === "editorial" ? "editorial" : "search";
    candidates.push(
      toShelfCandidate(
        recipe,
        {
          origin: "web",
          discovery,
          sourceName: inspiration.source_name,
          rank: rank++,
        },
        now,
      ),
    );
  }
  return candidates;
}

/**
 * Catalog ideas eligible for gap-fill.
 *
 * Three exclusion layers, in increasing softness:
 *   - recently cooked / recently planned / active negative feedback — the
 *     existing hard rules, unchanged
 *   - exposure memory — shown once and ignored (12-week cooldown), or shown
 *     twice and ignored (out of automatic suggestion). This *replaces* the old
 *     five-week offered lookback rather than stacking with it: both describe
 *     "he saw this and passed", and applying them together would let a five-
 *     week window quietly release a recipe the 12-week policy is still resting.
 *     Weeks whose shelf predates this policy never wrote an exposure record, so
 *     those — and only those — keep the old guard
 *   - staged web records that are *still staging* — they are handled by the web
 *     half of the shelf and must never be double-counted as catalog ideas. A
 *     promoted record is not staging any more: its recipe is a normal My Recipe
 *     and belongs in gap-fill like any other
 *
 * `catalogExclusionIds` states that combination in one pure place.
 */
export async function loadCatalogCandidatesForWeek(week: string, now: Date): Promise<ShelfCandidate[]> {
  const legacyWeeks = getRecentWeekIds(week, plannerPolicy().recentWeeksLookback);
  const [recipes, exclusions, legacyOffered, exposureExcluded, stagedWeb] = await Promise.all([
    getAllRecipes(),
    getPlannerRecencyExclusions(week),
    getLegacyOfferedRecipeIds(legacyWeeks, SHELF_POLICY_VERSION),
    getExposureExcludedRecipeIds(now),
    getStagedWebRecipes(),
  ]);

  const excluded = catalogExclusionIds({
    recentlyCooked: exclusions.recentlyCooked,
    recentlyPlanned: exclusions.recentlyPlanned,
    negativeFeedback: exclusions.negativeFeedback,
    legacyOffered,
    exposureExcluded,
    staged: stagedWeb,
  });

  const candidates: ShelfCandidate[] = [];
  for (const recipe of recipes) {
    if (excluded.has(recipe.id)) continue;
    if (isStagedRecipe(recipe)) continue;
    // A planner-visible catalog card must have an image; that rule predates
    // this work and is not weakened here.
    if (!recipe.image) continue;
    const role = classifyPlannerRole(recipe);
    if (role.role === "reject") continue;
    candidates.push(toShelfCandidate(recipe, { origin: "catalog", discovery: "catalog" }, now));
  }
  return candidates;
}

/** Fresh replacement candidates for a targeted chat-driven swap. */
export async function loadReplacementCandidates(
  week: string,
  now: Date,
  excludeRecipeIds: ReadonlySet<string>,
): Promise<ShelfCandidate[]> {
  const catalog = await loadCatalogCandidatesForWeek(week, now);
  return catalog.filter((candidate) => !excludeRecipeIds.has(candidate.recipeId));
}

export function buildPreparationDeps(now = new Date()): PreparationDeps {
  return {
    now,
    loadPlan: (week) => loadMealPlan(week),
    // Preparation reports on what was stored, so the refusal and the stored
    // plan both have to survive the crossing from the save boundary.
    savePlan: async (plan) => {
      const result = await saveMealPlan(plan);
      return result.ok ? { ok: true, plan: result.plan } : { ok: false, reason: result.reason };
    },
    // Never a child process. On Vercel this reads what the local Kitchen
    // runtime already staged and reports `web-not-staged` when it finds
    // nothing, rather than shelling out to an importer that cannot run there.
    ensureWebInspirations: async (week) => {
      const result = await resolveWebInspirations(week);
      return {
        status: result.status,
        accepted: "accepted" in result ? result.accepted : undefined,
        staged: "staged" in result ? result.staged : undefined,
        error: "error" in result ? result.error : undefined,
        reason: "reason" in result ? result.reason : undefined,
      };
    },
    loadWebCandidates: (week) => loadWebCandidatesForWeek(week, now),
    loadCatalogCandidates: (week) => loadCatalogCandidatesForWeek(week, now),
  };
}

export function buildRolloverDeps(now = new Date()): RolloverDeps {
  return {
    now,
    loadPlan: (week) => loadMealPlan(week),
    loadStagedRecipes: (weeks) => getStagedWebRecipes(weeks),
    loadExpirableStagedRecipes: (before) => getStagedWebRecipesImportedBefore(before),
    loadAssignedRecipeIds: (weeks) => getPlannedRecipeIdsForWeeks(weeks),
    loadAssignedRecipeIdsSince: (fromWeek) => getPlannedRecipeIdsSince(fromWeek),
    loadExposureRecords: () => getExposureRecords(),
    saveExposure: (records) => saveExposureRecords(records),
    loadCountedExposureIds: (week) => getCountedExposureRecipeIds(week),
    saveCountedExposureIds: (week, recipeIds) => saveCountedExposureRecipeIds(week, recipeIds, now),
    saveExposureWithCountedIds: (records, week, recipeIds) =>
      saveExposureWithCountedIds(records, week, recipeIds, now),
    promote: (record) => promoteStagedWebRecipe(record, now),
    expire: (record) => expireStagedWebRecipe(record, now),
  };
}

/** Re-exported so routes have a single import site for recipe resolution. */
export { getRecipe };
