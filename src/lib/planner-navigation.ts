export type PlannerDayHistoryLink = {
  status:
    | "planned"
    | "in-progress"
    | "cooked-as-planned"
    | "cooked-other"
    | "planned-unlogged"
    | "skipped"
    | null;
  cookedRecipeId: string | null;
};

const ACTUAL_MEAL_STATUSES = new Set<PlannerDayHistoryLink["status"]>([
  "in-progress",
  "cooked-as-planned",
  "cooked-other",
]);

/**
 * Resolve the recipe whose name the planner card is currently presenting.
 *
 * Actual/current meal history is rendered ahead of a saved plan, so its recipe
 * ID must also own the card link. Falling back to the planned ID keeps future
 * and unlogged planned meals navigable without rewriting planner state.
 *
 * A day can name a meal that has no saved recipe — a restaurant dinner, a meal
 * out, or an improvised dish recorded under a `meal-…`/`restaurant-…` id. Those
 * ids are history, not recipe links: when `isRecipe` says an id does not
 * resolve, the card is not a link rather than a 404.
 */
export function resolvePlannerDayRecipeId(input: {
  plannedRecipeId: string | null | undefined;
  plannedMealRecipeId?: string | null;
  history: PlannerDayHistoryLink | null | undefined;
  isRecipe?: (recipeId: string) => boolean;
}): string | null {
  const linkable = (id: string | null | undefined): string | null =>
    id && (!input.isRecipe || input.isRecipe(id)) ? id : null;

  if (
    input.history &&
    ACTUAL_MEAL_STATUSES.has(input.history.status) &&
    input.history.cookedRecipeId
  ) {
    return linkable(input.history.cookedRecipeId);
  }

  return linkable(input.plannedRecipeId ?? input.plannedMealRecipeId ?? null);
}
