// Planner day-expansion assembly.
//
// Pure and dependency-free (no database, network, or framework imports) so the
// wiring `/api/meals/expand` performs is testable on its own. The route's only
// job is to supply a `resolveRecipe` function and serialize the result.
//
// The one rule this module exists to enforce: an explicitly referenced
// component is resolved by id through `resolveRecipe`, never by looking it up
// in the browsable recipe collection. Saved sides can point at recipes from
// hidden cookbooks, and a lookup that silently drops them makes the meal review
// report "no findings" on a plate that actually repeats a seasoning lane.

import {
  analyzeMealCoherence,
  recipeToMealComponent,
  selectCoherentMealSet,
  type CoherentMealSet,
  type MealComponent,
  type MealCoherenceReview,
  type MealSetRole,
  type RecipeLike,
  // Explicit .ts extension: meal-expand.ts is loaded directly by `node --test`,
  // whose ESM resolver does not add extensions.
} from "./meal-coherence.ts";

/** Resolve one recipe by id, including recipes hidden from browse surfaces. */
export type ExpansionRecipeResolver = (
  id: string
) => Promise<RecipeLike | null | undefined>;

export type MealExpansionInput = {
  main: RecipeLike;
  /** Ranked complement candidates, best first, in Kitchen's own order. */
  candidates: { role: MealSetRole; recipe: RecipeLike }[];
  /** Component recipe ids already saved on the day. */
  sideIds: string[];
  /** Free-text table additions already saved on the day. */
  serveWith: string[];
  dayType: "weekday" | "weekend";
  resolveRecipe: ExpansionRecipeResolver;
};

export type MealExpansion = {
  /** Review of the meal as currently accepted: main + saved sides + serve-with. */
  coherence: MealCoherenceReview;
  /** The recommended set assembled as a meal on top of what is already saved. */
  recommendedSet: CoherentMealSet;
  /** Recipe ids the caller should mark `recommended`. */
  recommendedIds: string[];
  /** Saved side ids that actually resolved to a recipe, in request order. */
  acceptedIds: string[];
};

export async function buildMealExpansion(
  input: MealExpansionInput
): Promise<MealExpansion> {
  const uniqueSideIds = [...new Set(input.sideIds.filter((id) => id.length > 0))];
  const resolved = await Promise.all(uniqueSideIds.map((id) => input.resolveRecipe(id)));

  const savedComponents: MealComponent[] = [];
  const acceptedIds: string[] = [];
  resolved.forEach((recipe) => {
    if (!recipe) return;
    acceptedIds.push(recipe.id);
    savedComponents.push(recipeToMealComponent(recipe, "side"));
  });

  const mainComponent = recipeToMealComponent(input.main, "main");

  const coherence = analyzeMealCoherence({
    main: mainComponent,
    components: savedComponents,
    serveWith: input.serveWith,
    dayType: input.dayType,
  });

  const recommendedSet = selectCoherentMealSet({
    main: mainComponent,
    candidates: input.candidates.map((c) => ({
      role: c.role,
      component: recipeToMealComponent(c.recipe, c.role),
    })),
    assembled: savedComponents,
    serveWith: input.serveWith,
    dayType: input.dayType,
  });

  return {
    coherence,
    recommendedSet,
    recommendedIds: recommendedSet.selected.map((s) => s.componentId),
    acceptedIds,
  };
}
