// November 10, 2026 catalog cleanup — workstreams C (hidden books) and D
// (recipes without a photo rank lower). Run with: npm test

import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  HIDDEN_COOKBOOKS,
  HIDDEN_RECIPE_IDS,
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

  it("hides the 25 Raw Food / Real Thai records whose content is another dish, keeping their files", () => {
    equal(HIDDEN_RECIPE_IDS.size, 25);
    for (const id of HIDDEN_RECIPE_IDS) {
      const hit = byId.get(id);
      ok(hit, `${id} must stay in the bundle`);
      ok(["Raw Food", "Real Thai Cooking"].includes(hit.source?.cookbook ?? ""), id);
      equal(isBrowsableStaticRecipe(hit), false, id);
    }
    const khaoThom = byId.get("khao-thom-rice-porridge");
    ok(khaoThom && hasRecipeImage(khaoThom), "fixture: hidden despite having a photo");
  });

  it("referenced ids that are no longer browsable still resolve (November 10 read-only production scan)", () => {
    // A sample across every referencing table: meal plans, cooking sessions,
    // cook history, planner reviews and My Recipes overrides.
    for (const id of [
      "chard-and-saffron-omelettes", // plan + session + cook event, no photo
      "spicy-shaved-brussels-sprouts", // plan + session + cook event, no photo
      "tomato-salad-with-pomegranate-molasses", // plan + cook event, no photo
      "hungarian-goulash", // plan + session, no photo
      "fava-bean-burgers", // W46 shelf + planner review, photo removed
      "hokkien-fried-noodles", // plan, misaligned record
      "sushi", // plan, misaligned record
      "weisse-bohnen-suppe-mit-basilikum-und-mandeln", // cook event + My Recipes override, no photo
    ]) {
      const hit = byId.get(id);
      ok(hit, `${id} must keep resolving`);
      equal(isBrowsableStaticRecipe(hit), false, id);
    }
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

describe("D — static recipes without a photo are excluded (November 10 follow-up)", () => {
  it("no browsable static recipe lacks a photo, and the files are kept", () => {
    const visible = bundle.filter(isBrowsableStaticRecipe);
    deepStrictEqual(visible.filter((r) => !hasRecipeImage(r)).map((r) => r.id), []);
    equal(bundle.length, 3493);
    equal(visible.length, 1695);
    equal(isBrowsableStaticRecipe({ id: "x", source: { cookbook: "Plenty", author: "Y" }, image: null }), false);
    equal(isBrowsableStaticRecipe({ id: "x", source: { cookbook: "Plenty", author: "Y" }, image: "https://x/y.jpg" }), true);
  });

  it("search for “soup” returns only photo recipes", () => {
    const results = searchRecipes("soup", bundle.filter(isBrowsableStaticRecipe));
    ok(results.length > 20);
    deepStrictEqual(results.filter((r) => !hasRecipeImage(r)).map((r) => r.id), []);
    ok(!results.some((r) => r.id === "tom-kha-gai-chicken-coconut-soup"), "a hidden misaligned record must not appear");
  });
});

describe("D — My Recipes rows without a photo still rank lower (they are never excluded)", () => {
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
