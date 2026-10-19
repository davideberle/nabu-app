import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolvePlannerDayRecipeId } from "./planner-navigation.ts";

describe("planner day navigation", () => {
  it("links an ad-hoc current meal when the planner day is empty", () => {
    assert.equal(
      resolvePlannerDayRecipeId({
        plannedRecipeId: null,
        history: {
          status: "in-progress",
          cookedRecipeId: "green-beans-shallots-garlic-anchovies",
        },
      }),
      "green-beans-shallots-garlic-anchovies",
    );
  });

  it("links a past actual meal when the planner day was empty", () => {
    assert.equal(
      resolvePlannerDayRecipeId({
        plannedRecipeId: null,
        history: {
          status: "cooked-other",
          cookedRecipeId: "pomegranate-salmon-feast",
        },
      }),
      "pomegranate-salmon-feast",
    );
  });

  it("links the actual recipe when it replaced a different planned meal", () => {
    assert.equal(
      resolvePlannerDayRecipeId({
        plannedRecipeId: "planned-lasagna",
        history: {
          status: "cooked-other",
          cookedRecipeId: "actual-risotto",
        },
      }),
      "actual-risotto",
    );
  });

  it("falls back to the stored meal main for a planned day", () => {
    assert.equal(
      resolvePlannerDayRecipeId({
        plannedRecipeId: null,
        plannedMealRecipeId: "legacy-planned-main",
        history: {
          status: "planned",
          cookedRecipeId: null,
        },
      }),
      "legacy-planned-main",
    );
  });

  it("does not turn a title-only actual meal into a broken recipe link", () => {
    assert.equal(
      resolvePlannerDayRecipeId({
        plannedRecipeId: null,
        history: {
          status: "cooked-other",
          cookedRecipeId: null,
        },
      }),
      null,
    );
  });

  // W42 (2026-10-12…18) saved meals out and improvised dinners under ids that
  // were never recipes; every one of those cards used to link to a 404.
  it("does not link a planned meal whose id is not a saved recipe", () => {
    const recipes = new Set(["kohlrabi-curry", "meal-2026-10-15-pumpkin-risotto"]);
    const isRecipe = (id: string) => recipes.has(id);
    for (const id of [
      "meal-2026-10-14-burgers",
      "restaurant-2026-10-17-taverna-saint-johan",
      "meal-2026-10-16-bratwurst",
    ]) {
      assert.equal(
        resolvePlannerDayRecipeId({
          plannedRecipeId: id,
          history: { status: "cooked-as-planned", cookedRecipeId: id },
          isRecipe,
        }),
        null,
        id,
      );
    }
    assert.equal(
      resolvePlannerDayRecipeId({
        plannedRecipeId: "meal-2026-10-15-pumpkin-risotto",
        history: { status: "cooked-as-planned", cookedRecipeId: "meal-2026-10-15-pumpkin-risotto" },
        isRecipe,
      }),
      "meal-2026-10-15-pumpkin-risotto",
    );
  });

  it("links nothing while recipe resolution is still unknown", () => {
    assert.equal(
      resolvePlannerDayRecipeId({
        plannedRecipeId: "kohlrabi-curry",
        history: null,
        isRecipe: () => false,
      }),
      null,
    );
  });
});
