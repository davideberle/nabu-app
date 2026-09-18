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
});
