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
 */
export function resolvePlannerDayRecipeId(input: {
  plannedRecipeId: string | null | undefined;
  plannedMealRecipeId?: string | null;
  history: PlannerDayHistoryLink | null | undefined;
}): string | null {
  if (
    input.history &&
    ACTUAL_MEAL_STATUSES.has(input.history.status) &&
    input.history.cookedRecipeId
  ) {
    return input.history.cookedRecipeId;
  }

  return input.plannedRecipeId ?? input.plannedMealRecipeId ?? null;
}
