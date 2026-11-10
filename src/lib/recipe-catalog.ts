// Pure catalog rules shared by the recipe pages and their tests: which static
// cookbooks are hidden, photo-first ordering, and search ranking. No database,
// no bundle import — `recipes.ts` applies these to the data.

import type { Recipe } from "./recipes.ts";
import { getCuisine, getDietary } from "./meals-core.ts";

// Cookbooks hidden from browsing, search and planner suggestions. The recipe
// files stay in the bundle, and `getRecipe` still resolves every hidden id, so
// meal plans, cooking sessions, cook history and My Recipes overrides that
// reference one keep opening at /recipes/<id>. Remove a name here to restore
// a book; nothing else needs to change.
//
// November 10, 2026 catalog cleanup (Kitchen plan note
// `kitchen/work/catalog-cleanup-2026-11-10.md`): re-checked after the step
// repair and photo check. Italian And Lebanese stays hidden (David: definitely),
// and so do Mexican Home Cooking and The Complete Greek Cookbook — see the plan
// note for the per-book numbers behind that decision.
export const HIDDEN_COOKBOOKS: ReadonlySet<string> = new Set([
  "Pasta for All Seasons",
  "Mexican Home Cooking",
  "Italian And Lebanese Cookbook",
  "The Complete Greek Cookbook",
  "Brunch Cookbook",
  "The Curry Guy Bible",
  "The Curry Guy",
  "The Authentic Greek Kitchen",
  "Vegan Nigerian Kitchen",
  "Falastin",
]);

/** True when a static recipe may appear in browsing, search and suggestions. */
export function isBrowsableStaticRecipe(recipe: Pick<Recipe, "source">): boolean {
  const cookbook = recipe.source?.cookbook ?? "";
  return cookbook !== "My Recipes" && !HIDDEN_COOKBOOKS.has(cookbook);
}

/** A recipe card can show a photo. */
export function hasRecipeImage(recipe: Pick<Recipe, "image">): boolean {
  return typeof recipe.image === "string" && recipe.image.trim() !== "";
}

/**
 * Photo recipes first, otherwise the incoming order (a stable sort): recipes
 * without a photo are demoted in browse lists, never removed (November 10,
 * 2026 catalog cleanup, workstream D).
 */
export function photoFirst<T extends Pick<Recipe, "image">>(recipes: readonly T[]): T[] {
  return [...recipes].sort((a, b) => Number(!hasRecipeImage(a)) - Number(!hasRecipeImage(b)));
}

// Generic occasion/meal-time strings that are not meaningful course labels.
const OCCASION_TAGS = new Set(["dinner", "lunch", "supper", "brunch"]);

// Get course/category tags for a recipe (e.g. "Main", "Bread", "Salad").
// Cookbook recipes use category.dish_type (string[]), while My Recipes store
// category as a plain string and optionally mealRole.
export function getCourseTags(recipe: Recipe): string[] {
  if (recipe.category && typeof recipe.category === "object" && recipe.category.dish_type) {
    return recipe.category.dish_type;
  }
  const tags: string[] = [];
  const cat = recipe.category as unknown;
  if (typeof cat === "string" && cat && !OCCASION_TAGS.has(cat.toLowerCase())) {
    tags.push(cat);
  }
  if (recipe.mealRole && !tags.some((t) => t.toLowerCase() === recipe.mealRole!.toLowerCase())) {
    tags.push(recipe.mealRole);
  }
  return tags;
}

export type RecipeSearchResult = Recipe & {
  searchScore: number;
};

/**
 * Ranking demotion for a search result without a photo. It is larger than
 * every non-title bonus a result can collect for a query of up to four words
 * (cookbook/cuisine/tag 800 + 120 per word, ingredients 350 + 50 per word), so
 * among results that match the title equally a photo recipe always comes
 * first; it is smaller than the title tiers (exact title +10000, title phrase
 * +5000 + 3000), so a better title match without a photo still ranks above a
 * weaker one with a photo.
 */
export const NO_PHOTO_SEARCH_PENALTY = 2000;

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function searchTerms(query: string): string[] {
  return Array.from(
    new Set(tokenizeSearchText(query)),
  );
}

function tokenizeSearchText(value: string): string[] {
  return normalizeSearchText(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function recipeCuisineTerms(recipe: Recipe): string[] {
  const cuisine = recipe.cuisine;
  return [
    ...(Array.isArray(cuisine) ? cuisine : cuisine ? [cuisine] : []),
    getCuisine(recipe),
  ];
}

function hasSearchPhrase(text: string, phrase: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(text);
}

function scoreText(text: string, tokens: Set<string>, phrase: string, terms: string[], phraseScore: number, termScore: number): number {
  if (!text) return 0;

  let score = hasSearchPhrase(text, phrase) ? phraseScore : 0;
  for (const term of terms) {
    if (tokens.has(term)) score += termScore;
  }
  return score;
}

export function searchRecipes(query: string, recipes: Recipe[]): RecipeSearchResult[] {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  const phrase = normalizeSearchText(trimmedQuery);
  const terms = searchTerms(trimmedQuery);
  if (terms.length === 0) return [];

  const scored = recipes
    .map((recipe) => {
      const nameText = normalizeSearchText(recipe.name);
      const metadataText = normalizeSearchText(
        [
          recipe.source?.cookbook,
          recipe.source?.author,
          recipe.source?.chapter,
          recipe.source?.publication,
          ...recipeCuisineTerms(recipe),
          ...getCourseTags(recipe),
          ...getDietary(recipe),
          recipe.category?.meal_role,
          recipe.mealRole,
        ]
          .filter(Boolean)
          .join(" "),
      );
      const ingredientText = normalizeSearchText(
        recipe.ingredients
          .map((ingredient) => [ingredient.item, ingredient.group].filter(Boolean).join(" "))
          .join(" "),
      );
      const nameTokens = new Set(tokenizeSearchText(recipe.name));
      const metadataTokens = new Set(tokenizeSearchText(metadataText));
      const ingredientTokens = new Set(tokenizeSearchText(ingredientText));
      const searchableTokens = new Set([...nameTokens, ...metadataTokens, ...ingredientTokens]);

      if (!terms.every((term) => searchableTokens.has(term))) {
        return null;
      }

      let searchScore = 0;
      if (nameText === phrase) searchScore += 10000;
      if (hasSearchPhrase(nameText, phrase)) searchScore += 5000;
      searchScore += scoreText(nameText, nameTokens, phrase, terms, 3000, 500);
      searchScore += scoreText(metadataText, metadataTokens, phrase, terms, 800, 120);
      searchScore += scoreText(ingredientText, ingredientTokens, phrase, terms, 350, 50);

      return { ...recipe, searchScore };
    })
    .filter((recipe): recipe is RecipeSearchResult => recipe !== null);

  const rank = (recipe: RecipeSearchResult) =>
    recipe.searchScore - (hasRecipeImage(recipe) ? 0 : NO_PHOTO_SEARCH_PENALTY);
  return scored.sort((a, b) => {
    const diff = rank(b) - rank(a);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name);
  });
}
