// Recipe types and data loading
// Static cookbook recipes from JSON + My Recipes from Turso

import { cache } from "react";
import { getAllMyRecipes, getMyRecipe } from "./db";
import recipesBundle from "@/data/recipes-bundle.json";

export type Ingredient = {
  item: string;
  amount: string;
  unit?: string;
  original?: string;
  group?: string | null;
};

export type RecipeMethodSection = {
  title: string;
  steps: string[];
};

export type Recipe = {
  id: string;
  name: string;
  source?: {
    cookbook: string;
    author: string;
    chapter?: string;
    publication?: string;
    /** Original web recipe, when this record was imported from a URL. */
    url?: string;
  };
  introduction?: string | null;
  intro?: string;
  tips?: string;
  category?: {
    dish_type: string[];
    chapter: string;
    meal_role?: string; // main | side | starter | dessert | component | breakfast | drink
  };
  servings: string;
  time?: { prep?: number; cook?: number; total?: number };
  ingredients: Ingredient[];
  method: string[];
  /** Optional editorial grouping for recipes made of several distinct dishes. */
  methodSections?: RecipeMethodSection[];
  serving?: string;
  related_recipes?: { name: string; page?: number }[];
  tags?: {
    dietary: string[];
    season?: string[];
  };
  dietary?: string[];
  image?: string | null;
  // Extra fields used by My Recipes
  cuisine?: string | string[];
  mealRole?: string;
  visibility?: "personal" | "planner-candidate";
  /**
   * A household adaptation of another recipe (what was actually cooked, kept
   * distinct from the original). The planner treats the two ids as one dish for
   * recent-cook and recent-plan exclusions; the original stays unchanged.
   */
  adaptedFrom?: { recipeId: string; name?: string; url?: string; note?: string };
  madeHistory?: { date: string; note: string }[];
  lastMade?: string;
};

// Cookbook→cuisine mapping and the pure cuisine/dietary helpers moved to
// meals-core.ts so the planner gate/classifier stay dependency-free; they are
// re-exported here unchanged for all existing importers.
import { getCuisine, getDietary } from "./meals-core.ts";
export { getCuisine, getDietary, COOKBOOK_CUISINES } from "./meals-core.ts";
import { isBrowsableStaticRecipe, photoFirst } from "./recipe-catalog.ts";
export {
  HIDDEN_COOKBOOKS,
  HIDDEN_RECIPE_IDS,
  NO_PHOTO_SEARCH_PENALTY,
  getCourseTags,
  hasRecipeImage,
  isBrowsableStaticRecipe,
  photoFirst,
  searchRecipes,
  type RecipeSearchResult,
} from "./recipe-catalog.ts";

// Static cookbook recipes loaded from the pre-built bundle (see scripts/bundle-recipes.mjs).
// Using a static import instead of fs.readdirSync avoids Turbopack bundling thousands
// of individual JSON files into every serverless function that touches this module.
const allStaticRecipes: Recipe[] = recipesBundle as Recipe[];

const staticRecipes: Recipe[] = allStaticRecipes
  .filter(isBrowsableStaticRecipe)
  .sort((a, b) => a.name.localeCompare(b.name));

// On Vercel builds without Turso configured, the local SQLite fallback doesn't
// exist.  Skip DB access in that case — static recipes are sufficient for
// prerendering; My Recipes are fetched at runtime when the Turso URL is set.
const canAccessDb =
  !!process.env.TURSO_DATABASE_URL || !process.env.VERCEL;

// Deduplicated fetch of all recipes (static + Turso My Recipes) per request
export const getAllRecipes = cache(async (): Promise<Recipe[]> => {
  const myRecipes = canAccessDb ? await getAllMyRecipes() : [];
  const myRecipeIds = new Set(myRecipes.map((recipe) => recipe.id));
  return [
    ...staticRecipes.filter((recipe) => !myRecipeIds.has(recipe.id)),
    ...myRecipes,
  ].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
});

export async function getRecipe(id: string): Promise<Recipe | undefined> {
  const myRecipe = canAccessDb ? await getMyRecipe(id) : undefined;
  if (myRecipe) return myRecipe;

  // My Recipes can intentionally override imported/static slugs. Fall back to
  // the full static bundle so hidden cookbook recipes still resolve when they
  // are referenced explicitly, for example as live-cooking sides.
  const staticHit = allStaticRecipes.find((r) => r.id === id);
  if (staticHit) return staticHit;
  return undefined;
}

export async function getRecipesByChapter(
  chapter: string
): Promise<Recipe[]> {
  const all = await getAllRecipes();
  return photoFirst(all.filter(
    (r) => r.source?.chapter === chapter || r.category?.chapter === chapter
  ));
}

export async function getRecipesWithImages(): Promise<Recipe[]> {
  const all = await getAllRecipes();
  return all.filter((r) => r.image !== null);
}

// Derive low-calorie flag from name/dish_type heuristics.
// No explicit calorie data exists in the dataset, so we use a conservative
// approach: only flag recipes whose name or dish_type clearly indicates a
// lighter dish (salad, soup, bowl). Quick cook time alone is NOT sufficient.
const LOW_CAL_WORDS = ["salad", "soup", "bowl", "broth"];

export function isLowCalorie(recipe: Recipe): boolean {
  const nameLower = recipe.name.toLowerCase();
  if (LOW_CAL_WORDS.some((w) => nameLower.includes(w))) return true;
  const dishTypes = (recipe.category?.dish_type ?? []).map((t) => t.toLowerCase());
  if (dishTypes.some((d) => LOW_CAL_WORDS.some((w) => d.includes(w)))) return true;
  return false;
}

// Format servings for display. Normalizes inconsistent patterns like
// "4 servings", "serves 4", bare "4" into a consistent "Serves N" style,
// while leaving complex/descriptive strings (e.g. "1 bread wreath") intact.
export function formatServings(raw: string): string {
  if (!raw) return "";
  const trimmed = raw.trim();

  // "4 servings" / "4 to 6 servings" → "Serves 4" / "Serves 4 to 6"
  const nServings = trimmed.match(/^(\d[\d\s–—\-to]*\d?)\s+servings?$/i);
  if (nServings) return `Serves ${nServings[1]}`;

  // Bare number like "4" or "6–8"
  if (/^\d[\d–—\-\s]*$/.test(trimmed)) return `Serves ${trimmed}`;

  // Already starts with "serves" — just capitalize
  if (/^serves\s/i.test(trimmed)) {
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  }

  // Complex strings ("makes 2 small loaves …") — capitalize first letter
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

// Cookbook cover images
const COOKBOOK_COVERS: Record<string, string> = {
  "Ottolenghi: The Cookbook": "/cookbooks/ottolenghi-the-cookbook.jpg",
  "Ottolenghi Simple": "/cookbooks/ottolenghi-simple.jpg",
  Jerusalem: "/cookbooks/jerusalem.jpg",
  Falastin: "/cookbooks/falastin.jpg",
  Persiana: "/cookbooks/persiana.jpg",
  Plenty: "/cookbooks/plenty.jpg",
  "Plenty More": "/cookbooks/plenty-more.jpg",
  "The Curry Guy": "/cookbooks/the-curry-guy.jpg",
  "The Curry Guy Bible": "/cookbooks/the-curry-guy-bible.jpg",
  "The Indian Vegan": "/cookbooks/the-indian-vegan.jpg",
  "Vietnamese Food Any Day": "/cookbooks/vietnamese-food-any-day.jpg",
  "Afro-Vegan": "/cookbooks/afro-vegan.jpg",
  Plentiful: "/cookbooks/plentiful.jpg",
  "The Vegan Korean": "/cookbooks/the-vegan-korean.jpg",
  "Black Rican Vegan": "/cookbooks/black-rican-vegan.jpg",
  "Brunch Cookbook": "/cookbooks/brunch-cookbook.jpg",
  "Four Seasons": "/cookbooks/four-seasons.jpg",
  "The High-Protein Vegan Cookbook":
    "/cookbooks/the-high-protein-vegan-cookbook.jpg",
  "Land of Fish and Rice": "/cookbooks/land-of-fish-and-rice.jpg",
  "Vegan Chocolate": "/cookbooks/vegan-chocolate.jpg",
  "Vegan Vietnamese": "/cookbooks/vegan-vietnamese.jpg",
  "The Authentic Greek Kitchen": "/cookbooks/the-authentic-greek-kitchen.jpg",
  "The Complete Greek Cookbook": "/cookbooks/the-complete-greek-cookbook.jpg",
  "Zagami Family Cookbook": "/cookbooks/zagami-family-cookbook.jpg",
  "Jamie's Food Revolution": "/cookbooks/jamies-food-revolution.jpg",
  "Tagine Cookbook": "/cookbooks/tagine-cookbook.jpg",
  "Raw Food": "/cookbooks/raw-food.jpg",
  "My Recipes": "/cookbooks/my-recipes-cover.jpg",
};

export async function getCookbooks(): Promise<
  { name: string; slug: string; count: number; author?: string; cover?: string }[]
> {
  const allRecipes = await getAllRecipes();
  const cookbookMap = new Map<string, { count: number; author?: string }>();

  for (const recipe of allRecipes) {
    const cookbook = recipe.source?.cookbook;
    if (cookbook) {
      const existing = cookbookMap.get(cookbook);
      if (existing) {
        existing.count++;
      } else {
        cookbookMap.set(cookbook, { count: 1, author: recipe.source?.author });
      }
    }
  }

  return Array.from(cookbookMap.entries())
    .map(([name, data]) => ({
      name,
      slug: slugify(name),
      count: data.count,
      author: data.author,
      cover: COOKBOOK_COVERS[name],
    }))
    .sort((a, b) => {
      if (a.slug === "my-recipes") return -1;
      if (b.slug === "my-recipes") return 1;
      return b.count - a.count;
    });
}

export async function getCuisines(): Promise<
  { name: string; slug: string; count: number }[]
> {
  const allRecipes = await getAllRecipes();
  const cuisineMap = new Map<string, number>();

  for (const recipe of allRecipes) {
    const cuisine = getCuisine(recipe);
    cuisineMap.set(cuisine, (cuisineMap.get(cuisine) || 0) + 1);
  }

  return Array.from(cuisineMap.entries())
    .map(([name, count]) => ({
      name,
      slug: slugify(name),
      count,
    }))
    .sort((a, b) => b.count - a.count);
}

export async function getRecipesByCookbook(
  cookbookSlug: string
): Promise<Recipe[]> {
  const allRecipes = await getAllRecipes();
  return photoFirst(allRecipes.filter((r) => {
    const cookbook = r.source?.cookbook;
    return cookbook && slugify(cookbook) === cookbookSlug;
  }));
}

export async function getRecipesByCuisine(
  cuisineSlug: string
): Promise<Recipe[]> {
  const allRecipes = await getAllRecipes();
  return photoFirst(allRecipes.filter((r) => slugify(getCuisine(r)) === cuisineSlug));
}

export async function getRecipesByDietary(
  dietary: string
): Promise<Recipe[]> {
  const allRecipes = await getAllRecipes();
  return photoFirst(allRecipes.filter((r) => {
    const tags = getDietary(r);
    return tags.includes(dietary.toLowerCase());
  }));
}

// Helper to create URL-safe slugs
function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function getDietaryOptions(): Promise<
  { name: string; slug: string; count: number }[]
> {
  const allRecipes = await getAllRecipes();
  const dietaryMap = new Map<string, number>();

  for (const recipe of allRecipes) {
    const tags = getDietary(recipe);
    for (const tag of tags) {
      dietaryMap.set(tag, (dietaryMap.get(tag) || 0) + 1);
    }
  }

  return Array.from(dietaryMap.entries())
    .map(([name, count]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      slug: name.toLowerCase(),
      count,
    }))
    .sort((a, b) => b.count - a.count);
}

// Get the meal role for display (main, side, starter, dessert, component, breakfast, drink)
export function getMealRole(recipe: Recipe): string | null {
  const role = recipe.mealRole || recipe.category?.meal_role;
  return role || null;
}

// Re-export the centralized ingredient normalizer so server components can
// import it alongside other recipe utilities.
export { normalizeIngredient } from "./normalize-ingredients";

export { slugify as _slugify };
