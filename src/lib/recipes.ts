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

export type Recipe = {
  id: string;
  name: string;
  source?: {
    cookbook: string;
    author: string;
    chapter?: string;
    publication?: string;
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
  madeHistory?: { date: string; note: string }[];
  lastMade?: string;
};

// Cookbook to cuisine mapping
const COOKBOOK_CUISINES: Record<string, string> = {
  "Ottolenghi: The Cookbook": "Middle Eastern",
  Jerusalem: "Middle Eastern",
  Falastin: "Middle Eastern",
  Persiana: "Middle Eastern",
  "Souk to Table": "Middle Eastern",
  Plenty: "Middle Eastern",
  "Plenty More": "Middle Eastern",
  "Ottolenghi Simple": "Middle Eastern",
  "The Curry Guy": "Indian",
  "The Curry Guy Bible": "Indian",
  "The Indian Vegan": "Indian",
  "Vietnamese Food Any Day": "Vietnamese",
  "Vegan Vietnamese": "Vietnamese",
  "Afro-Vegan": "African & Caribbean",
  Plentiful: "Caribbean",
  "Black Rican Vegan": "Caribbean",
  "The Vegan Korean": "Korean",
  "Mexican Home Cooking": "Mexican",
  "Land of Fish and Rice": "Chinese",
  "Four Seasons": "Italian",
  "Italian And Lebanese Cookbook": "Mediterranean",
  "More Than Carbonara": "Italian",
  "Pasta for All Seasons": "Italian",
  "The Best Pasta Recipes": "Italian",
  "The Classic Italian Cook Book": "Italian",
  "Zagami Family Cookbook": "Italian",
  "The Authentic Greek Kitchen": "Greek",
  "The Complete Greek Cookbook": "Greek",
  "The Complete and Authentic Thai Curry Cookbook 2": "Thai",
  "Real Thai Cooking": "Thai",
  "Thai Spice Recipes": "Thai",
  "Vegan Nigerian Kitchen": "Nigerian",
  "Tagine Cookbook": "Moroccan",
  "Jamie's Food Revolution": "British",
};

// Static cookbook recipes loaded from the pre-built bundle (see scripts/bundle-recipes.mjs).
// Using a static import instead of fs.readdirSync avoids Turbopack bundling thousands
// of individual JSON files into every serverless function that touches this module.
const staticRecipes: Recipe[] = (recipesBundle as Recipe[])
  .filter((r) => r.source?.cookbook !== "My Recipes")
  .sort((a, b) => a.name.localeCompare(b.name));

// Deduplicated fetch of all recipes (static + Turso My Recipes) per request
export const getAllRecipes = cache(async (): Promise<Recipe[]> => {
  const myRecipes = await getAllMyRecipes();
  return [...staticRecipes, ...myRecipes].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
});

export async function getRecipe(id: string): Promise<Recipe | undefined> {
  // Check static first (fast path for the vast majority)
  const staticHit = staticRecipes.find((r) => r.id === id);
  if (staticHit) return staticHit;
  // Fall back to Turso for My Recipes
  return getMyRecipe(id);
}

export async function getRecipesByChapter(
  chapter: string
): Promise<Recipe[]> {
  const all = await getAllRecipes();
  return all.filter(
    (r) => r.source?.chapter === chapter || r.category?.chapter === chapter
  );
}

export async function getRecipesWithImages(): Promise<Recipe[]> {
  const all = await getAllRecipes();
  return all.filter((r) => r.image !== null);
}

// Get cuisine for a recipe (sync — pure function)
export function getCuisine(recipe: Recipe): string {
  const cookbook = recipe.source?.cookbook;
  if (cookbook && COOKBOOK_CUISINES[cookbook]) {
    return COOKBOOK_CUISINES[cookbook];
  }
  return "Other";
}

// Get dietary tags for a recipe (sync — pure function)
export function getDietary(recipe: Recipe): string[] {
  return recipe.dietary || recipe.tags?.dietary || [];
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
  Jerusalem: "/cookbooks/jerusalem.jpg",
  Falastin: "/cookbooks/falastin.jpg",
  Persiana: "/cookbooks/persiana.jpg",
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
  "The Authentic Greek Kitchen": "/cookbooks/the-authentic-greek-kitchen.jpg",
  "Zagami Family Cookbook": "/cookbooks/zagami-family-cookbook.jpg",
  "My Recipes": "/cookbooks/my-recipes.jpg",
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
  return allRecipes.filter((r) => {
    const cookbook = r.source?.cookbook;
    return cookbook && slugify(cookbook) === cookbookSlug;
  });
}

export async function getRecipesByCuisine(
  cuisineSlug: string
): Promise<Recipe[]> {
  const allRecipes = await getAllRecipes();
  return allRecipes.filter((r) => slugify(getCuisine(r)) === cuisineSlug);
}

export async function getRecipesByDietary(
  dietary: string
): Promise<Recipe[]> {
  const allRecipes = await getAllRecipes();
  return allRecipes.filter((r) => {
    const tags = getDietary(r);
    return tags.includes(dietary.toLowerCase());
  });
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

export { slugify as _slugify };
