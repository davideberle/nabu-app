// November 10, 2026 catalog cleanup — workstreams C (hidden books) and D
// (recipes without a photo rank lower). Run with: npm test

import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  HIDDEN_COOKBOOKS,
  NO_PHOTO_SEARCH_PENALTY,
  hasRecipeImage,
  isBrowsableStaticRecipe,
  photoFirst,
  searchRecipes,
} from "./recipe-catalog.ts";
import { qaRecipeForShelf } from "./recipe-render-qa.ts";
import type { Recipe } from "./recipes.ts";

const bundle = JSON.parse(
  readFileSync(new URL("../data/recipes-bundle.json", import.meta.url), "utf8"),
) as Recipe[];
const byId = new Map(bundle.map((r) => [r.id, r]));

function recipe(id: string, name: string, image: string | null, extra: Partial<Recipe> = {}): Recipe {
  return {
    id,
    name,
    servings: "4",
    ingredients: [{ item: "lentils", amount: "200 g" }],
    method: ["Cook the lentils."],
    image,
    source: { cookbook: "Test Book", author: "Test" },
    category: { dish_type: ["soup"], chapter: "Soups", meal_role: "main" },
    ...extra,
  };
}

describe("C — hidden cookbooks", () => {
  it("hides the three weak books named on November 10 (Italian And Lebanese definitely)", () => {
    for (const book of ["Italian And Lebanese Cookbook", "Mexican Home Cooking", "The Complete Greek Cookbook"]) {
      ok(HIDDEN_COOKBOOKS.has(book), book);
    }
  });

  it("keeps the recipe files: every hidden book still has its recipes in the bundle", () => {
    for (const book of HIDDEN_COOKBOOKS) {
      ok(bundle.some((r) => r.source?.cookbook === book), `${book} has no recipes in the bundle`);
    }
  });

  it("excludes hidden-book recipes from browsing, search and suggestions", () => {
    const lentil = byId.get("greek-lentil-soup");
    ok(lentil, "greek-lentil-soup must stay in the bundle");
    equal(isBrowsableStaticRecipe(lentil), false);
    const visible = bundle.filter(isBrowsableStaticRecipe);
    deepStrictEqual(searchRecipes("greek lentil soup", visible).filter((r) => r.id === "greek-lentil-soup"), []);
    ok(visible.every((r) => !HIDDEN_COOKBOOKS.has(r.source?.cookbook ?? "")));
  });

  it("ids referenced in production (plans, sessions, My Recipes overrides) are still in the bundle", () => {
    // Read-only Turso scan, November 10, 2026: the only hidden-book ids referenced
    // by meal plans, cooking sessions, cook history or My Recipes overrides.
    for (const id of ["cg-cucumber-raita", "authentic-naans", "greek-souvlaki"]) {
      const hit = byId.get(id);
      ok(hit, `${id} must keep resolving`);
      ok(HIDDEN_COOKBOOKS.has(hit.source?.cookbook ?? ""), `${id} is expected to be in a hidden book`);
    }
  });

  it("getRecipe resolves hidden ids from the full bundle, not the browsable list", () => {
    const source = readFileSync(new URL("./recipes.ts", import.meta.url), "utf8");
    const getRecipe = source.slice(source.indexOf("export async function getRecipe("), source.indexOf("export async function getRecipesByChapter"));
    ok(/allStaticRecipes\.find\(/.test(getRecipe), "getRecipe must fall back to allStaticRecipes");
    ok(!/staticRecipes\.find\(/.test(getRecipe.replace(/allStaticRecipes/g, "")), "getRecipe must not use the filtered list");
  });
});

describe("D — recipes without a photo rank lower", () => {
  it("search: among equal title matches, the photo recipe comes first", () => {
    const results = searchRecipes("lentil soup", [
      recipe("a-no-photo", "Lentil Soup", null),
      recipe("b-photo", "Lentil Soup", "https://example.com/b.jpg"),
    ]);
    deepStrictEqual(results.map((r) => r.id), ["b-photo", "a-no-photo"]);
  });

  it("search: a photo recipe outranks a no-photo one even when metadata gave the no-photo one more points", () => {
    const results = searchRecipes("soup", [
      recipe("tagged", "Carrot Soup", null, { category: { dish_type: ["soup"], chapter: "Soups", meal_role: "main" } }),
      recipe("untagged", "Pea Soup", "https://example.com/p.jpg", { category: { dish_type: ["main"], chapter: "Mains", meal_role: "main" } }),
    ]);
    deepStrictEqual(results.map((r) => r.id), ["untagged", "tagged"]);
  });

  it("search: it is a demotion, not an exclusion — a better title match without a photo still ranks above", () => {
    const results = searchRecipes("lentil soup", [
      recipe("exact-no-photo", "Lentil Soup", null),
      recipe("weak-photo", "Spiced Red Lentil and Tomato Soup", "https://example.com/w.jpg"),
      recipe("ingredient-only-photo", "Harira", "https://example.com/h.jpg", {
        ingredients: [{ item: "lentil", amount: "1 cup" }, { item: "soup bones", amount: "1" }],
      }),
    ]);
    deepStrictEqual(results.map((r) => r.id), ["exact-no-photo", "weak-photo", "ingredient-only-photo"]);
    equal(results.length, 3);
  });

  it("the penalty sits between the non-title bonuses and the title tiers", () => {
    ok(NO_PHOTO_SEARCH_PENALTY > 800 + 120 * 4 + 350 + 50 * 4);
    ok(NO_PHOTO_SEARCH_PENALTY < 5000);
  });

  it("browse lists: photo recipes first, otherwise the original order", () => {
    const list = [
      recipe("a", "Apple", null),
      recipe("b", "Bean", "x.jpg"),
      recipe("c", "Carrot", ""),
      recipe("d", "Date", "y.jpg"),
    ];
    deepStrictEqual(photoFirst(list).map((r) => r.id), ["b", "d", "a", "c"]);
    equal(hasRecipeImage(recipe("e", "E", "   ")), false);
  });

  it("soups search on the live catalog lists every photo soup before the first soup without one", () => {
    const visible = bundle.filter(isBrowsableStaticRecipe);
    const results = searchRecipes("soup", visible);
    ok(results.length > 20);
    const firstNoPhoto = results.findIndex((r) => !hasRecipeImage(r));
    const titleTier = (r: Recipe) => /\bsoups?\b/i.test(r.name);
    // Within the title-match tier (the soups), photos come first.
    const soups = results.filter(titleTier);
    const lastPhotoSoup = soups.map(hasRecipeImage).lastIndexOf(true);
    const firstNoPhotoSoup = soups.findIndex((r) => !hasRecipeImage(r));
    ok(firstNoPhotoSoup === -1 || lastPhotoSoup < firstNoPhotoSoup, "a photo soup ranked below a no-photo soup");
    ok(firstNoPhoto === -1 || firstNoPhoto > 0);
  });

  it("planner suggestions keep their stricter existing rule: no photo, no shelf", () => {
    const withPhoto = qaRecipeForShelf(
      recipe("p", "Lentil Soup", "x.jpg", {
        ingredients: [
          { item: "lentils", amount: "200 g" },
          { item: "onion", amount: "1" },
          { item: "stock", amount: "1 l" },
        ],
        method: ["Soften the onion in a little oil.", "Add the lentils and stock and simmer for 30 minutes."],
        time: { total: 45 },
      }),
      { role: "main" },
    );
    ok(withPhoto.ok, JSON.stringify(withPhoto.issues));
    const without = qaRecipeForShelf({ ...withPhoto.recipe, image: null }, { role: "main" });
    equal(without.ok, false);
    ok(without.issues.some((i) => i.code === "missing-image"));
  });
});
