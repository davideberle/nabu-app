// Phase 4E — recipe-render QA, trait inference, shelf quality, completion,
// shortlist, and Not this week. Run with: npm test

import { equal, ok, deepStrictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeIngredientUnits,
  qaMethodSteps,
  qaRecipeForShelf,
  qaTimePlausibility,
  renderIngredientLine,
} from "./recipe-render-qa.ts";
import { normalizeIngredient } from "./normalize-ingredients.ts";
import {
  applyNotThisWeek,
  assembleWeeklyShelf,
  assessShelfQuality,
  canAdmit,
  completeShelfAgainstPlan,
  deriveShelfTraits,
  shortlistShelf,
  SHELF_LIMITS,
  type ShelfCandidate,
  type ShelfItem,
  type ShelfTraits,
} from "./planner-shelf.ts";
import { assessShelfHealth, SHELF_POLICY_VERSION, toShelfCandidate } from "./planner-preparation.ts";
import type { Recipe } from "./recipes";
import type { MealPlan } from "./meals";

const NOW = new Date("2026-09-15T05:30:00.000Z");

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: "r-" + Math.random().toString(36).slice(2, 8),
    name: "Roasted Pumpkin Risotto",
    servings: "serves 4",
    ingredients: [
      { item: "pumpkin", amount: "600", unit: "g" },
      { item: "risotto rice", amount: "300", unit: "g" },
      { item: "vegetable stock", amount: "1", unit: "l" },
      { item: "parmesan", amount: "50", unit: "g" },
    ],
    method: [
      "Roast the pumpkin at 200°C until tender, about 25 minutes.",
      "Toast the rice in butter, then add stock a ladle at a time, stirring.",
      "Fold in the pumpkin and parmesan and season to taste.",
    ],
    image: "https://img.example/pumpkin.jpg",
    time: { prep: 15, cook: 35, total: 50 },
    category: { dish_type: ["main"], chapter: "Mains", meal_role: "main" },
    dietary: ["vegetarian"],
    ...overrides,
  };
}

describe("ingredient unit normalization", () => {
  it("renders a stranded metric unit with the number in every recipe view", () => {
    deepStrictEqual(normalizeIngredient("200", "g plain flour"), { amount: "200 g", item: "plain flour" });
  });
  it("rejoins common measures and split mixed quantities in every recipe view", () => {
    deepStrictEqual(normalizeIngredient("4", "teaspoons olive oil"), { amount: "4 tsp", item: "olive oil" });
    deepStrictEqual(normalizeIngredient("1", "clove garlic"), { amount: "1 clove", item: "garlic" });
    deepStrictEqual(normalizeIngredient("3", "½ cups water"), { amount: "3½ cups", item: "water" });
  });
  it("moves a stranded metric unit from the item into unit when an amount is present", () => {
    for (const unit of ["g", "kg", "ml", "l"]) {
      const { ingredient, fix } = normalizeIngredientUnits({ item: `${unit} plain flour`, amount: "200" });
      equal(ingredient.unit, unit);
      equal(ingredient.item, "plain flour");
      equal(ingredient.amount, "200");
      ok(fix && fix.code === "stranded-unit");
      equal(renderIngredientLine(ingredient), `200 ${unit} plain flour`);
    }
  });
  it("lifts a leading amount+unit out of the item when the amount is empty", () => {
    const { ingredient } = normalizeIngredientUnits({ item: "250 ml coconut milk", amount: "" });
    deepStrictEqual([ingredient.amount, ingredient.unit, ingredient.item], ["250", "ml", "coconut milk"]);
  });
  it("safely rejoins a mixed quantity split across amount and item", () => {
    const { ingredient, fix } = normalizeIngredientUnits({ item: "½ cups water", amount: "3" });
    deepStrictEqual([ingredient.amount, ingredient.unit, ingredient.item], ["3½", "cups", "water"]);
    equal(fix?.code, "split-mixed-quantity");
    equal(renderIngredientLine(ingredient), "3½ cups water");
  });
  it("leaves ambiguous lines alone and reports them", () => {
    const { ingredient, fix } = normalizeIngredientUnits({ item: "g", amount: "200" });
    equal(fix, null);
    equal(ingredient.item, "g");
    const result = qaRecipeForShelf(recipe({ ingredients: [{ item: "g", amount: "200" }, { item: "salt", amount: "" }, { item: "oil", amount: "1 tbsp" }] }));
    ok(!result.ok);
    ok(result.issues.some((i) => i.code === "unit-in-item"));
  });
  it("preserves wording when a unit is already separate", () => {
    const { ingredient, fix } = normalizeIngredientUnits({ item: "ginger, grated", amount: "2", unit: "cm" });
    equal(fix, null);
    equal(ingredient.item, "ginger, grated");
  });
  it("quarantines importer debris that would render as a broken ingredient row", () => {
    const result = qaRecipeForShelf(recipe({ ingredients: [
      { item: "pprox 800g chopped pumpkin", amount: "a" },
      { item: "½ cups water", amount: "3" },
      { item: "&frac14; cup pepitas", amount: "" },
    ] }));
    const codes = new Set(result.issues.map((issue) => issue.code));
    ok(codes.has("invalid-amount-token"));
    ok(codes.has("html-entity"));
    ok(codes.has("truncated-word"));
  });
});

describe("method QA", () => {
  it("collapses line breaks inside a step without merging distinct steps", () => {
    const out = qaMethodSteps(["Heat the oil in a\nlarge pan over medium heat.", "Add the onions and cook until soft."]);
    equal(out.method.length, 2);
    equal(out.method[0], "Heat the oil in a large pan over medium heat.");
    ok(out.fixes.some((f) => f.code === "whitespace"));
    equal(out.issues.length, 0);
  });
  it("rejects empty, fragmentary, duplicated and badly split steps", () => {
    const out = qaMethodSteps([
      "",
      "Step 2",
      "Add the onions and cook until soft and",
      "golden, then add the garlic.",
      "Add the onions and cook until soft and",
    ]);
    const codes = new Set(out.issues.map((i) => i.code));
    ok(codes.has("empty-step"));
    ok(codes.has("fragment"));
    ok(codes.has("badly-split"));
    ok(codes.has("duplicate-step"));
  });
  it("rejects a method with no steps", () => {
    ok(qaMethodSteps([]).issues.some((i) => i.code === "no-steps"));
  });
});

describe("time plausibility and full gate", () => {
  it("refuses a 3-minute total", () => {
    const issue = qaTimePlausibility({ time: { total: 3 }, method: ["a", "b"], ingredients: [] });
    ok(issue && issue.code === "implausibly-short");
  });
  it("passes a clean recipe and returns a normalized copy", () => {
    const original = recipe({ ingredients: [{ item: "g pumpkin", amount: "600" }, { item: "rice", amount: "300", unit: "g" }, { item: "stock", amount: "1", unit: "l" }] });
    const result = qaRecipeForShelf(original, { role: "main" });
    ok(result.ok, JSON.stringify(result.issues));
    equal(result.recipe.ingredients[0].unit, "g");
    equal(original.ingredients[0].item, "g pumpkin");
  });
  it("quarantines a recipe without an image or a dinner-capable role", () => {
    ok(qaRecipeForShelf(recipe({ image: null })).issues.some((i) => i.code === "missing-image"));
    ok(qaRecipeForShelf(recipe(), { role: "pairing" }).issues.some((i) => i.code === "not-dinner-capable"));
  });
});

describe("trait inference", () => {
  it("a vegan recipe can never be fish, even with fish sauce and a fishy name", () => {
    const t = deriveShelfTraits(
      { name: "Clear Mung Bean Dumplings", dietary: ["vegan"], ingredients: [{ item: "vegan fish sauce" }, { item: "mung beans" }] },
      NOW,
    );
    equal(t.protein, "vegan");
    const u = deriveShelfTraits({ name: "Vegan fish and chips", ingredients: [{ item: "banana blossom" }] }, NOW);
    equal(u.protein, "vegan");
  });
  it("fish sauce alone does not make a fish dish", () => {
    const t = deriveShelfTraits({ name: "Tofu Larb", ingredients: [{ item: "tofu" }, { item: "fish sauce" }] }, NOW);
    equal(t.protein, "vegan");
    equal(t.hero, "tofu");
  });
  it("toast and steamed buns are bread-led, never pasta", () => {
    const toast = deriveShelfTraits({ name: "Mushroom Toast", ingredients: [{ item: "rice noodles, for garnish" }] }, NOW);
    equal(toast.starch, "bread");
    ok(toast.shape !== "pasta");
    const buns = deriveShelfTraits({ name: "Steamed Kimchi Buns", ingredients: [{ item: "ramen seasoning" }] }, NOW);
    equal(buns.starch, "bread");
    ok(buns.shape !== "pasta");
  });
  it("an implausible total never becomes a quick claim", () => {
    const t = deriveShelfTraits({ name: "Spicy Tofu", time: { total: 3 }, ingredients: [{ item: "tofu" }] }, NOW);
    equal(t.effort, "medium");
    const c = toShelfCandidate(recipe({ name: "Spicy Tofu", time: { total: 3 } }), { origin: "web", discovery: "search" }, NOW);
    equal(c.time, null);
    ok(!c.display?.note.includes("minutes"));
  });
});

function traits(overrides: Partial<ShelfTraits> = {}): ShelfTraits {
  return { shape: "other", protein: "vegetarian", starch: "none", effort: "medium", weekdayFit: true, weekendFit: true, vegetableDense: true, seasonalLocal: false, longHaul: false, hero: null, ...overrides };
}
let seq = 0;
function cand(overrides: Partial<ShelfCandidate> = {}): ShelfCandidate {
  seq += 1;
  return { recipeId: `c${seq}`, recipeName: `Candidate ${seq}`, origin: "catalog", discovery: "catalog", role: "main", bucket: "vegetarian", cuisine: "Other", image: "x.jpg", traits: traits(), ...overrides };
}
function item(overrides: Partial<ShelfItem> = {}): ShelfItem {
  return { ...cand(), reason: "", assigned: false, ...overrides };
}

describe("shelf quality and health", () => {
  it("the assembler cannot create a shelf its display-group health rule rejects", () => {
    const efforts = ["quick", "medium", "project"] as const;
    const pool = Array.from({ length: 24 }, (_, index) =>
      cand({
        cuisine: `Cuisine ${index}`,
        traits: traits({
          effort: efforts[index % efforts.length],
          shape: index % 5 === 0 ? "salad" : "other",
          protein: (["vegan", "vegetarian", "fish", "meat"] as const)[index % 4],
        }),
      }),
    );
    const shelf = assembleWeeklyShelf({ web: [], catalog: pool });
    const problems = assessShelfQuality(shelf.items, {
      webConsidered: shelf.diagnostics.webConsidered,
      cookbookCapRelaxed: shelf.diagnostics.cookbookCapRelaxed,
    });
    ok(!problems.some((problem) => /group/.test(problem)), problems.join("\n"));
  });

  it("caps a cookbook at two catalog ideas and a hero ingredient at two", () => {
    const current = [cand({ sourceName: "Vegan Vietnamese" }), cand({ sourceName: "Vegan Vietnamese" })];
    const third = canAdmit(cand({ sourceName: "Vegan Vietnamese" }), current);
    ok(!third.ok && /Vegan Vietnamese/.test(third.reason));
    ok(canAdmit(cand({ sourceName: "Vegan Vietnamese" }), current, { relaxCookbookCap: true }).ok);
    const tofu = [cand({ traits: traits({ hero: "tofu" }) }), cand({ traits: traits({ hero: "tofu" }) })];
    const v = canAdmit(cand({ traits: traits({ hero: "tofu" }) }), tofu);
    ok(!v.ok && /tofu/.test(v.reason));
  });
  it("names the W38 problems concretely and the health endpoint reports unhealthy", () => {
    const items = [
      ...Array.from({ length: 4 }, (_, i) => ({ recipeId: `w${i}`, recipeName: `Web ${i}`, origin: "web", image: "x", traits: traits({ effort: "quick" }), time: { prep: 5, cook: 10, total: 15 } })),
      { recipeId: "vv1", recipeName: "Spicy Tofu", origin: "catalog", source: { cookbook: "Vegan Vietnamese" }, image: "x", dietary: ["vegan"], traits: traits({ effort: "quick", hero: "tofu" }), time: { prep: 1, cook: 2, total: 3 } },
      { recipeId: "vv2", recipeName: "Tofu Curry", origin: "catalog", source: { cookbook: "Vegan Vietnamese" }, image: "x", dietary: ["vegan"], traits: traits({ effort: "quick", hero: "tofu" }), time: { total: 20 } },
      { recipeId: "vv3", recipeName: "Clear Mung Bean Dumplings", origin: "catalog", source: { cookbook: "Vegan Vietnamese" }, image: "x", dietary: ["vegan"], traits: traits({ protein: "fish", effort: "quick" }), time: { total: 30 } },
      { recipeId: "c4", recipeName: "Mushroom Toast", origin: "catalog", source: { cookbook: "Other Book" }, image: "x", traits: traits({ shape: "pasta", starch: "pasta", effort: "quick" }), time: { total: 20 } },
      ...Array.from({ length: 4 }, (_, i) => ({ recipeId: `c${i}`, recipeName: `Catalog ${i}`, origin: "catalog", source: { cookbook: `Book ${i}` }, image: "x", traits: traits({ effort: "medium" }), time: { total: 40 } })),
    ];
    const problems = assessShelfQuality(items);
    ok(problems.some((p) => /only 4 web idea/.test(p)), problems.join("\n"));
    ok(problems.some((p) => /3 catalog ideas come from Vegan Vietnamese/.test(p)));
    ok(problems.some((p) => /Clear Mung Bean Dumplings is vegan but its traits say fish/.test(p)));
    ok(problems.some((p) => /Mushroom Toast is bread-led/.test(p)));
    ok(problems.some((p) => /Spicy Tofu claims a 3-minute total/.test(p)));
    ok(problems.some((p) => /easy-light group/.test(p)));
    ok(problems.some((p) => /weekend project/.test(p)));

    const plan = { week: "2026-W38", locked: false, createdAt: NOW.toISOString(), days: [], candidateSet: { generatedAt: NOW.toISOString(), policyVersion: SHELF_POLICY_VERSION, items } } as unknown as MealPlan;
    const health = assessShelfHealth(plan, NOW);
    equal(health.healthy, false);
    ok(health.problems.length >= 5);
  });
  it("a short web yield remains unhealthy and names the qualified availability", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ recipeId: `c${i}`, recipeName: `C ${i}`, origin: "catalog", source: { cookbook: `B${i}` }, image: "x", traits: traits({ effort: i % 3 === 0 ? "quick" : i % 3 === 1 ? "medium" : "project" }), time: { total: 40 } }));
    ok(assessShelfQuality(items).some((p) => /web idea/.test(p)));
    ok(assessShelfQuality(items, { webConsidered: 2 }).some((p) => /2 qualified considered/.test(p)));
  });
  it("reports web-source, cuisine, and protein-lane concentration", () => {
    const crowded = Array.from({ length: 8 }, (_, i) => ({
      recipeId: `crowded-${i}`,
      recipeName: `Crowded ${i}`,
      origin: "web",
      sourceName: "Unknown Weekly",
      cuisine: "Italian",
      image: "x",
      traits: traits({ protein: "vegan", effort: i % 3 === 0 ? "project" : "medium" }),
    }));
    const problems = assessShelfQuality(crowded);
    ok(problems.some((p) => /web ideas come from Unknown Weekly/.test(p)), problems.join("\n"));
    ok(problems.some((p) => /Italian cuisine lane/.test(p)), problems.join("\n"));
    ok(problems.some((p) => /vegan protein lane/.test(p)), problems.join("\n"));
  });
});

describe("context-aware completion", () => {
  it("keeps assigned cards fixed and reranks only unassigned ideas against the plan", () => {
    const soup = item({ recipeId: "soup", assigned: true, traits: traits({ shape: "soup", hero: "pumpkin", protein: "vegan" }) });
    const parm = item({ recipeId: "parm", assigned: true, traits: traits({ protein: "meat", hero: "chicken", shape: "roast-bake" }) });
    const secondSoup = item({ recipeId: "soup2", traits: traits({ shape: "soup", hero: "pumpkin", protein: "vegan" }) });
    const chicken = item({ recipeId: "chicken2", traits: traits({ protein: "meat", hero: "chicken" }) });
    const fish = item({ recipeId: "fish", traits: traits({ protein: "fish", hero: "salmon" }) });
    const result = completeShelfAgainstPlan([secondSoup, chicken, soup, parm, fish], { assignedTraits: [soup.traits, parm.traits], openWeekdays: 3, openWeekendDays: 2 }, [], { target: { min: 3, max: 6 } });
    deepStrictEqual(result.shelf.slice(0, 2).map((i) => i.recipeId), ["soup", "parm"]);
    ok(result.shelf.every((i) => i.assigned === (i.recipeId === "soup" || i.recipeId === "parm")));
    const open = result.shelf.filter((i) => !i.assigned).map((i) => i.recipeId);
    equal(open[0], "fish");
    ok(open.indexOf("soup2") > open.indexOf("fish"));
  });
  it("replaces an idea the assigned days now rule out", () => {
    const meats = [item({ recipeId: "m1", assigned: true, traits: traits({ protein: "meat" }) }), item({ recipeId: "m2", assigned: true, traits: traits({ protein: "meat" }) })];
    const thirdMeat = item({ recipeId: "m3", traits: traits({ protein: "meat" }) });
    const result = completeShelfAgainstPlan([...meats, thirdMeat], { assignedTraits: meats.map((m) => m.traits), openWeekdays: 4, openWeekendDays: 1 }, [cand({ recipeId: "veg" })], { target: { min: 3, max: 4 } });
    ok(result.removed.some((r) => r.recipeId === "m3"));
    ok(result.added.some((a) => a.recipeId === "veg"));
    ok(result.shelf.some((i) => i.recipeId === "m1" && i.assigned));
  });
});

describe("shortlist and Not this week", () => {
  it("shows 5–7 strongest first with a weekend idea and group variation", () => {
    const rows: { recipeId: string; traits: ShelfTraits; assigned?: boolean }[] = [
      ...Array.from({ length: 8 }, (_, i) => ({ recipeId: `q${i}`, traits: traits({ effort: "quick" }) })),
      { recipeId: "proj", traits: traits({ effort: "project" }) },
      { recipeId: "mid", traits: traits({ effort: "medium" }) },
      { recipeId: "pinned", traits: traits(), assigned: true },
    ];
    const { primary, secondary } = shortlistShelf(rows);
    const open = primary.filter((r) => !r.assigned);
    ok(open.length >= 5 && open.length <= 7, String(open.length));
    ok(open.some((r) => r.recipeId === "proj"));
    ok(open.some((r) => r.recipeId === "mid"));
    ok(primary.some((r) => r.recipeId === "pinned"));
    equal(primary.length + secondary.length, rows.length);
  });
  it("removes the idea for the week only and protects assigned ideas", () => {
    const set = { items: [{ recipeId: "a", origin: "web" as const }, { recipeId: "b", origin: "catalog" as const }], notThisWeek: [] };
    const out = applyNotThisWeek(set, "a", new Set<string>(), NOW);
    deepStrictEqual(out.items.map((i) => i.recipeId), ["b"]);
    deepStrictEqual(out.notThisWeek.map((r) => r.recipeId), ["a"]);
    equal(out.notThisWeek[0].origin, "web");
    const kept = applyNotThisWeek(set, "b", new Set(["b"]), NOW);
    equal(kept.protectedAssigned, true);
    equal(kept.items.length, 2);
  });
  it("never re-adds an explicitly dismissed recipe during completion", () => {
    const dismissed = new Set(["a"]);
    const result = completeShelfAgainstPlan(
      [item({ recipeId: "b" })],
      { assignedTraits: [], openWeekdays: 5, openWeekendDays: 2 },
      [cand({ recipeId: "a" }), cand({ recipeId: "c" })],
      { target: { min: 2, max: 3 }, excludeRecipeIds: dismissed },
    );
    ok(!result.shelf.some((row) => row.recipeId === "a"));
    ok(result.shelf.some((row) => row.recipeId === "c"));
  });
});
