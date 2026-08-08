// The fingerprint that binds a shopping draft to the exact plan it came from.
//
// Kept in its own module because two independent layers need it and must not
// depend on each other: `meals-persistence.ts` computes it at the plan-save
// boundary to detect meal-changing edits, and the shopping draft layer
// computes it when generating and approving a draft.
//
// The plan traversal lives here rather than in the shopping generator so the
// planner's save boundary does not depend on the generator: the invalidation
// rule ships with the planner, and the draft generator — which is pure and
// crypto-free — imports the signature from here when it lands.

import { createHash } from "node:crypto";

/** Structural subset of `MealPlan` the shopping signature reads. */
export type ShoppingPlanLike = {
  week: string;
  status?: "draft" | "finalized";
  days: {
    date: string;
    dayOfWeek: string;
    planningState?: "open" | "assigned" | "meal" | "skipped";
    recipeId?: string | null;
    recipeName?: string | null;
    meal?: {
      main: { id: string; name: string };
      sides?: { id: string; name: string }[];
    } | null;
    brunch?: {
      main: { id: string; name: string };
      sides?: { id: string; name: string }[];
    } | null;
  }[];
};

export type MealSlot = "dinner" | "brunch";
export type RecipeRole = "main" | "side";

/** One planned recipe the week actually calls for. */
export type PlannedRecipeRef = {
  recipeId: string;
  recipeName: string;
  date: string;
  dayOfWeek: string;
  slot: MealSlot;
  role: RecipeRole;
};

/**
 * Every real planned recipe in a week, in stable week order.
 *
 * Included: dinner mains (structured `meal.main` or the legacy `recipeId`),
 * dinner sides, brunch mains, brunch sides. Excluded: open and skipped days,
 * and the free-text `serveWith` lines, which are table notes rather than
 * recipes with ingredient lists.
 */
export function collectPlannedRecipes(plan: ShoppingPlanLike): PlannedRecipeRef[] {
  const refs: PlannedRecipeRef[] = [];
  const days = [...plan.days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  for (const day of days) {
    if (day.planningState === "open" || day.planningState === "skipped") continue;

    const push = (
      recipeId: string | null | undefined,
      recipeName: string | null | undefined,
      slot: MealSlot,
      role: RecipeRole,
    ) => {
      if (!recipeId) return;
      refs.push({
        recipeId,
        recipeName: recipeName || recipeId,
        date: day.date,
        dayOfWeek: day.dayOfWeek,
        slot,
        role,
      });
    };

    // The structured meal wins; `recipeId` is the legacy single-recipe shape
    // and is only used when there is no structured main for the same slot.
    if (day.meal?.main?.id) {
      push(day.meal.main.id, day.meal.main.name, "dinner", "main");
    } else {
      push(day.recipeId, day.recipeName, "dinner", "main");
    }
    for (const side of day.meal?.sides ?? []) {
      push(side.id, side.name, "dinner", "side");
    }

    if (day.brunch?.main?.id) {
      push(day.brunch.main.id, day.brunch.main.name, "brunch", "main");
    }
    for (const side of day.brunch?.sides ?? []) {
      push(side.id, side.name, "brunch", "side");
    }
  }

  return refs;
}

/**
 * Canonical serialization of everything in a plan that can change a shopping
 * list. Two plans with the same signature must produce the same draft.
 *
 * The caller hashes this (persistence uses SHA-256) to detect meal-changing
 * edits after finalization. Deliberately excludes candidate sets, notes,
 * context, and timestamps: those move without changing what has to be bought.
 */
export function mealPlanShoppingSignature(plan: ShoppingPlanLike): string {
  const refs = collectPlannedRecipes(plan).map(
    (r) => `${r.date}|${r.slot}|${r.role}|${r.recipeId}`,
  );
  return JSON.stringify({ week: plan.week, refs });
}

/**
 * A stable hash of everything in a plan that can change what has to be bought.
 *
 * Equal fingerprints mean the same set of planned recipes, so a draft generated
 * under one is still valid under the other. Any difference — a swapped main, an
 * added side, a newly skipped day — produces a different hash and invalidates
 * the draft.
 */
export function computePlanShoppingFingerprint(plan: ShoppingPlanLike): string {
  return createHash("sha256")
    .update(mealPlanShoppingSignature(plan), "utf8")
    .digest("hex");
}
