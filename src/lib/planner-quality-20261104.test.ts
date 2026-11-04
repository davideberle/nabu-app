// November 4, 2026 suggestion-quality repair: not-dinner and off-season
// recipes, one fish dinner a week counting the actual week, sides kept off
// the shelf, bowl and hearty-salad lanes, liked recipes ranked up.

import { equal, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canAdmit,
  coverageGaps,
  measureCoverage,
  scoreCandidate,
  weekProteinsOf,
  type ShelfCandidate,
  type ShelfTraits,
} from "./planner-shelf.ts";
import { isOffSeason, notDinnerReason } from "./planner-dinner-fit.ts";
import { sideOnlyRecipeIdsOf } from "./planner-preparation.ts";
import type { MealPlan } from "./meals";

function traits(overrides: Partial<ShelfTraits> = {}): ShelfTraits {
  return {
    shape: "other", protein: "vegetarian", starch: "none", effort: "medium",
    weekdayFit: true, weekendFit: true, vegetableDense: true, seasonalLocal: false, longHaul: false,
    ...overrides,
  };
}
let seq = 0;
function candidate(overrides: Partial<ShelfCandidate> = {}): ShelfCandidate {
  seq += 1;
  return {
    recipeId: `q-${seq}`, recipeName: `Q ${seq}`, origin: "catalog", discovery: "catalog", sourceName: null,
    role: "main", bucket: "vegetarian", cuisine: "Other", image: "/x.jpg", traits: traits(),
    review: { state: "unreviewed", reason: "fixture" },
    ...overrides,
  };
}

describe("dinner fit", () => {
  it("recognizes preserves, condiments and lunch-for-one dishes", () => {
    ok(notDinnerReason({ name: "Tuna in Oil", source: { chapter: "Summer" } }));
    ok(notDinnerReason({ name: "My Dream Lunch Sando", source: { chapter: "Cooking for One" } }));
    ok(notDinnerReason({ name: "Lemon Chutney" }));
    equal(notDinnerReason({ name: "Kidney Bean Butter Masala" }), null);
    equal(notDinnerReason({ name: "Pasta with Pesto and Potatoes" }), null);
    equal(notDinnerReason({ name: "Lentil and leek stew", source: { chapter: "Autumn" } }), null);
  });

  it("flags a dish declared only for summer as off-season in November, not one declared all-year", () => {
    ok(isOffSeason({ source: { chapter: "Summer" } }, 11));
    ok(!isOffSeason({ source: { chapter: "Autumn" } }, 11));
    ok(!isOffSeason({ tags: { season: ["all"] } }, 11));
    ok(!isOffSeason({}, 11));
    ok(!isOffSeason({ tags: { season: ["summer"] } }, 7));
  });

  it("refuses a not-dinner candidate", () => {
    const verdict = canAdmit(candidate({ notDinner: "a preserve or condiment" }), []);
    ok(!verdict.ok);
  });

  it("refuses an uncertain review that reads the recipe as a side, keeps a genuinely uncertain one", () => {
    ok(!canAdmit(candidate({ review: { state: "uncertain", role: "side", reason: "x" } }), []).ok);
    ok(canAdmit(candidate({ review: { state: "uncertain", role: "uncertain", reason: "x" } }), []).ok);
  });

  it("refuses a recipe whose content looks merged", () => {
    ok(!canAdmit(candidate({ review: { state: "excluded-private", reason: "ingredients: over 50 entries; possible merged recipe" } }), []).ok);
  });
});

describe("the actual week", () => {
  it("allows no further fish idea once the week has a fish dinner", () => {
    const fish = candidate({ traits: traits({ protein: "fish" }) });
    ok(canAdmit(fish, []).ok);
    const week = weekProteinsOf([{ protein: "fish" }]);
    ok(!canAdmit(fish, [], { weekProteins: week }).ok);
    ok(canAdmit(candidate(), [], { weekProteins: week }).ok);
  });

  it("treats a recipe used only as a side as part of a meal, not an idea", () => {
    const plan = {
      days: [
        { planningState: "meal", recipeId: "fish-curry", meal: { main: { id: "fish-curry", name: "Fish curry" }, sides: [{ id: "green-bean-curry", name: "Green bean curry" }] } },
        { planningState: "open", recipeId: null, meal: null },
      ],
    } as unknown as MealPlan;
    const sides = sideOnlyRecipeIdsOf(plan);
    ok(sides.has("green-bean-curry"));
    ok(!sides.has("fish-curry"));
  });
});

describe("variety lanes", () => {
  it("names a missing bowl and counts only a main salad as the salad", () => {
    const sideSalad = candidate({ role: "light-meal", traits: traits({ shape: "salad" }) });
    const gaps = coverageGaps(measureCoverage([sideSalad]));
    ok(gaps.includes("salad"));
    ok(gaps.includes("bowl"));
    const mainSalad = candidate({ traits: traits({ shape: "salad" }) });
    const bowl = candidate({ traits: traits({ shape: "bowl" }) });
    const after = coverageGaps(measureCoverage([mainSalad, bowl]));
    ok(!after.includes("salad"));
    ok(!after.includes("bowl"));
  });
});

describe("ranking", () => {
  it("ranks a liked recipe above an otherwise equal one and an off-season one below", () => {
    const base = candidate({ recipeId: "same" });
    ok(scoreCandidate({ ...base, liked: true }) > scoreCandidate(base));
    ok(scoreCandidate({ ...base, offSeason: true }) < scoreCandidate(base));
  });
});

import { seasonalityForRecipe } from "./planner-seasonality.ts";

describe("winter tomatoes", () => {
  it("does not treat fresh tomatoes as in season in November, but canned ones are fine", () => {
    const salad = seasonalityForRecipe({ name: "Tomato salad", ingredients: [{ item: "ripe tomatoes, sliced", amount: "600", unit: "g" }] } as never, 11);
    equal(salad.status, "out-of-season");
    const july = seasonalityForRecipe({ name: "Tomato salad", ingredients: [{ item: "ripe tomatoes, sliced", amount: "600", unit: "g" }] } as never, 7);
    equal(july.status, "fresh");
  });
});
