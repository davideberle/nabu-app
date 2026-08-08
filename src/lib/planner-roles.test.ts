// Planner role classification, plus the FOOBY fallback extractor end to end
// against a deterministic fixture captured from the real featured page.
//
// Run with: npm test  (node --test; Node 24 strips types natively)
//
// No network: the FOOBY page is a checked-in fixture
// (src/lib/fixtures/fooby-featured-watermelon-goat-cheese.html), trimmed from
// the live page on 2026-08-08 and otherwise verbatim.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { equal, ok, deepStrictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyPlannerRole, isMainSlotEligible } from "./planner-roles.ts";
import { isDinnerWorthy } from "./meals-core.ts";
import type { Recipe } from "./recipes.ts";
import {
  extractRecipeFromHtml,
  extractFoobyRecipe,
  parseFoobyRecipeJson,
  toCompanionRecipe,
} from "../../scripts/weekly-inspirations.mjs";
import { findSourceById } from "./planner-sources.ts";

/**
 * The importer is plain JS, so TypeScript infers only structural types from it.
 * These aliases pin the shape the tests actually assert on rather than
 * scattering casts through the file.
 */
type ExtractedRecipe = {
  name: string;
  ingredients: string[];
  ingredientEntries: { text: string; group: string | null }[];
  method: string[];
  image: string | null;
  servings: number;
  totalMinutes: number;
  category?: string;
  dietary: string[];
  extractedBy?: string;
};

const extractRecipe = extractRecipeFromHtml as (
  html: string,
  url: string,
  source: unknown,
) => ExtractedRecipe | null;
const extractFooby = extractFoobyRecipe as (
  html: string,
  url: string,
  source: unknown,
) => ExtractedRecipe | null;
const toStoredRecipe = toCompanionRecipe as (
  extracted: unknown,
  opts: { slug: string; week: string; image: string | null },
) => Recipe;

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(
  join(__dirname, "fixtures", "fooby-featured-watermelon-goat-cheese.html"),
  "utf8",
);
const FIXTURE_URL = "https://fooby.ch/en/recipes/29338/watermelon-with-soft-goat-s-cheese";

function foobySource() {
  const registry = findSourceById("fooby");
  ok(registry);
  return {
    id: registry.id,
    name: registry.name,
    host: registry.host,
    cuisine: registry.cuisine,
    lane: registry.lane,
    visibleCap: registry.visibleCap,
    strategy: registry.searchStrategy,
    extraction: registry.extraction,
  };
}

function recipe(overrides: Partial<Recipe> & { name: string }): Recipe {
  return {
    id: overrides.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    servings: "4",
    ingredients: [
      { item: "olive oil", amount: "2 tbsp" },
      { item: "onion", amount: "1" },
      { item: "salt", amount: "" },
      { item: "black pepper", amount: "" },
    ],
    method: ["Do the first thing.", "Do the second thing."],
    category: { dish_type: ["main"], chapter: "" },
    ...overrides,
  } as Recipe;
}

// ---------------------------------------------------------------------------
// Non-main rejection
// ---------------------------------------------------------------------------

describe("non-main items cannot consume a main slot", () => {
  const cases: { label: string; input: Recipe; category: string }[] = [
    {
      label: "dessert (declared)",
      input: recipe({ name: "Poached Pears in Red Wine", category: { dish_type: ["dessert"], chapter: "" } }),
      category: "dessert",
    },
    {
      label: "dessert (by name)",
      input: recipe({ name: "Nectarine Cobbler", category: { dish_type: ["main"], chapter: "" } }),
      category: "dessert",
    },
    {
      label: "bread",
      input: recipe({ name: "Potato Dinner Rolls", category: { dish_type: ["main"], chapter: "" } }),
      category: "bread",
    },
    {
      label: "baking (declared)",
      input: recipe({ name: "Zopf", category: { dish_type: ["baking"], chapter: "" } }),
      category: "baking",
    },
    {
      label: "dip",
      input: recipe({ name: "Baked Goat's Cheese Dip with Apricot Sauce", category: { dish_type: ["main"], chapter: "" } }),
      category: "dip",
    },
    {
      label: "drink",
      input: recipe({ name: "Sarti Spritz", category: { dish_type: ["main"], chapter: "" } }),
      category: "drink",
    },
    {
      label: "snack",
      input: recipe({ name: "Energy Balls", category: { dish_type: ["main"], chapter: "" } }),
      category: "snack",
    },
    {
      label: "breakfast",
      input: recipe({ name: "Buttermilk Pancakes", category: { dish_type: ["main"], chapter: "" } }),
      category: "breakfast",
    },
    {
      label: "condiment",
      input: recipe({ name: "Green Chilli Chutney", category: { dish_type: ["main"], chapter: "" } }),
      category: "condiment",
    },
    {
      label: "collection page",
      input: recipe({ name: "29 Easy Vegan Dinner Recipes", category: { dish_type: ["main"], chapter: "" } }),
      category: "collection",
    },
  ];

  for (const { label, input, category } of cases) {
    it(`rejects ${label}`, () => {
      const result = classifyPlannerRole(input);
      equal(result.role, "reject", `${label} must not be main-eligible`);
      equal(result.category, category);
      equal(result.mainEligible, false);
      equal(isMainSlotEligible(input), false);
    });
  }

  it("rejects a record without usable recipe structure", () => {
    const thin = recipe({ name: "Mystery Dish", ingredients: [{ item: "salt", amount: "" }], method: [] });
    const result = classifyPlannerRole(thin);
    equal(result.role, "reject");
    equal(result.category, "unstructured");
  });
});

// ---------------------------------------------------------------------------
// Mains, light meals, pairings
// ---------------------------------------------------------------------------

describe("mains and substantial light meals qualify", () => {
  it("accepts an ordinary dinner main", () => {
    const result = classifyPlannerRole(recipe({ name: "Chickpea and Spinach Curry" }));
    equal(result.role, "main");
    equal(result.mainEligible, true);
  });

  it("accepts a substantial light meal", () => {
    const wrap = recipe({
      name: "Spinach Feta Tortilla Wrap",
      visibility: "planner-candidate",
      ingredients: [
        { item: "tortillas", amount: "4" },
        { item: "feta", amount: "150 g" },
        { item: "spinach", amount: "200 g" },
        { item: "eggs", amount: "2" },
        { item: "olive oil", amount: "1 tbsp" },
        { item: "lemon", amount: "1" },
      ],
    });
    const result = classifyPlannerRole(wrap);
    equal(result.role, "light-meal");
    equal(result.mainEligible, true);
  });

  it("demotes a light-meal shape with no substance to a pairing", () => {
    const thin = recipe({
      name: "Tomato Bruschetta",
      visibility: "planner-candidate",
      ingredients: [
        { item: "bread", amount: "4 slices" },
        { item: "tomato", amount: "2" },
        { item: "basil", amount: "" },
      ],
    });
    const result = classifyPlannerRole(thin);
    equal(result.role, "pairing");
    equal(result.mainEligible, false);
    equal(result.pairingEligible, true);
  });

  it("keeps a declared starter as a pairing rather than a main or a loss", () => {
    const starter = recipe({
      name: "Watermelon with soft goat's cheese",
      category: { dish_type: ["starter"], chapter: "" },
      mealRole: "starter",
    });
    const result = classifyPlannerRole(starter);
    equal(result.role, "pairing");
    equal(result.mainEligible, false);
    equal(result.pairingEligible, true);
  });

  it("keeps a side salad as a pairing", () => {
    const side = recipe({ name: "Fennel and Orange Salad", category: { dish_type: ["side", "salad"], chapter: "" } });
    const result = classifyPlannerRole(side);
    equal(result.role, "pairing");
    equal(result.pairingEligible, true);
  });

  it("never promotes something the production main gate refuses", () => {
    const oneStep = recipe({ name: "Roast Carrots", method: ["Roast them."] });
    equal(isDinnerWorthy(oneStep), false, "the existing gate still needs two steps for a main");
    equal(classifyPlannerRole(oneStep).mainEligible, false);
  });
});

// ---------------------------------------------------------------------------
// FOOBY fallback extraction
// ---------------------------------------------------------------------------

describe("FOOBY fallback extractor", () => {
  it("the fixture's Recipe JSON-LD alone is not enough for the structured path", () => {
    // This is the actual defect: the page ships Recipe JSON-LD whose whole
    // preparation is one HowToStep, so structured extraction returns null.
    const withoutFallback = extractRecipe(FIXTURE, FIXTURE_URL, {
      ...foobySource(),
      extraction: { primary: "json-ld" },
    });
    equal(withoutFallback, null);
  });

  it("extracts the featured watermelon / goat's-cheese page via the fallback", () => {
    const extracted = extractRecipe(FIXTURE, FIXTURE_URL, foobySource());
    ok(extracted, "the FOOBY fallback must handle the featured page");
    equal(extracted.name, "Watermelon with soft goat's cheese");
    equal(extracted.extractedBy, "fooby-embedded-json");
    equal(extracted.ingredients.length, 6);
    ok(extracted.ingredients.some((line) => /500 g watermelons/.test(line)));
    ok(extracted.ingredients.some((line) => /a little sea salt/.test(line)));
    ok(extracted.method.length >= 1);
    ok(/Arrange the watermelon/.test(extracted.method[0]));
    equal(extracted.image, "https://recipecontent.fooby.ch/29338_3-2_1200-800.jpg");
    equal(extracted.servings, 2);
    equal(extracted.totalMinutes, 10);
    equal(extracted.category, "starter", "the declared category survives the fallback");
    deepStrictEqual(extracted.dietary, ["vegetarian", "gluten-free"]);
  });

  it("keeps FOOBY's ingredient grouping", () => {
    const extracted = extractFooby(FIXTURE, FIXTURE_URL, foobySource());
    ok(extracted);
    ok(extracted.ingredientEntries.every((entry) => entry.group === "Salad"));
  });

  it("classifies the extracted page as a pairing, not a dinner main", () => {
    const extracted = extractRecipe(FIXTURE, FIXTURE_URL, foobySource());
    const stored = toStoredRecipe(extracted, {
      slug: "watermelon-with-soft-goat-s-cheese",
      week: "2026-W33",
      image: "/recipes/watermelon-with-soft-goat-s-cheese.jpg",
    });
    deepStrictEqual(stored.category?.dish_type, ["starter"]);
    const role = classifyPlannerRole(stored);
    equal(role.role, "pairing");
    equal(role.mainEligible, false);
  });

  it("prefers structured extraction when the JSON-LD is complete", () => {
    const complete = `<!doctype html><html><head>
      <script type="application/ld+json">${JSON.stringify({
        "@context": "http://schema.org",
        "@type": "Recipe",
        name: "Structured Lentil Stew",
        image: "https://recipecontent.fooby.ch/1_3-2_1200-800.jpg",
        recipeYield: "4",
        recipeCategory: "main dish",
        recipeIngredient: ["300 g lentils", "2 carrots", "1 onion", "1 l stock"],
        recipeInstructions: [
          { "@type": "HowToStep", text: "Sweat the onion and carrot until soft." },
          { "@type": "HowToStep", text: "Add lentils and stock, simmer for 30 minutes." },
        ],
      })}</script></head><body>
      <script> var recipeJSON = ${JSON.stringify({
        name: "Fallback Should Not Win",
        amount: 2,
        images: { large: "https://recipecontent.fooby.ch/2_3-2_1200-800.jpg" },
        items: [{ title: "All", step: "Do it all at once.", ingredients: [
          { unit: "g", amount: 1, text: "a" }, { unit: "g", amount: 1, text: "b" }, { unit: "g", amount: 1, text: "c" },
        ] }],
      })};</script></body></html>`;

    const extracted = extractRecipe(complete, "https://fooby.ch/en/recipes/1/x", foobySource());
    ok(extracted);
    equal(extracted.name, "Structured Lentil Stew");
    equal(extracted.extractedBy, undefined, "structured extraction leaves no fallback marker");
  });

  it("refuses a page with no embedded payload rather than inventing one", () => {
    equal(parseFoobyRecipeJson("<html><body>nothing here</body></html>"), null);
    equal(extractFooby("<html><body>nothing here</body></html>", FIXTURE_URL, foobySource()), null);
  });

  it("refuses a payload without enough structure", () => {
    const thin = `<script> var recipeJSON = ${JSON.stringify({
      name: "Two Ingredient Thing",
      amount: 2,
      items: [{ title: "x", step: "Mix.", ingredients: [{ text: "a" }, { text: "b" }] }],
    })};</script>`;
    equal(extractFooby(thin, FIXTURE_URL, foobySource()), null);
  });
});
