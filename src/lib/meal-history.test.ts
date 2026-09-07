import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CookingSession } from "./cooking-session.ts";
import { projectDayHistory } from "./meal-history.ts";
import type { MealPlan } from "./meals.ts";

const TODAY = "2026-09-07";
const PAST_DATE = "2026-09-06";

function makeSlot(
  recipeId: string | null,
  recipeName: string | null,
): MealPlan["days"][number] {
  return {
    date: PAST_DATE,
    dayOfWeek: "Sunday",
    type: "weekend",
    planningState: recipeId ? "assigned" : "open",
    recipeId,
    recipeName,
    meal: recipeId && recipeName
      ? { main: { id: recipeId, name: recipeName } }
      : null,
    brunch: null,
  };
}

function makeSession(overrides: Partial<CookingSession> = {}): CookingSession {
  return {
    id: "cook_2026-09-06_fish-gnocchi-tomato",
    date: PAST_DATE,
    status: "draft",
    source: "ad-hoc",
    mealPlanRef: null,
    anchor: {
      type: "kitchen-recipe",
      recipeId: "fish-with-gnocchi-and-fresh-tomato-sauce",
      title: "Fish with gnocchi and fresh tomato sauce",
      provenance: { source: "kitchen" },
    },
    main: null,
    heroImage: null,
    relatedRecipes: [],
    preparationOrder: [],
    serveWith: [],
    servings: { base: "4", current: "4" },
    ingredients: { base: [], session: [] },
    method: { base: [], session: [] },
    adaptations: [],
    coachCards: { nextMove: null, upgrade: null, shortcut: null, wine: null },
    story: null,
    notes: "",
    createdAt: "2026-09-06T15:00:00.000Z",
    updatedAt: "2026-09-06T17:00:00.000Z",
    ...overrides,
  };
}

function project(input: {
  date?: string;
  today?: string;
  slot?: MealPlan["days"][number] | null;
  cookEvents?: { recipeId: string }[];
  sessions?: CookingSession[];
  recipeNames?: Map<string, string>;
  intentionallySkipped?: boolean;
}) {
  return projectDayHistory({
    date: input.date ?? PAST_DATE,
    today: input.today ?? TODAY,
    slot: input.slot ?? null,
    cookEvents: input.cookEvents ?? [],
    sessions: input.sessions ?? [],
    recipeNames: input.recipeNames ?? new Map(),
    intentionallySkipped: input.intentionallySkipped ?? false,
  });
}

describe("meal history projection", () => {
  it("fills yesterday's open planner day from an ad-hoc draft Live Cooking session", () => {
    const result = project({ sessions: [makeSession()] });

    assert.equal(result.status, "cooked-other");
    assert.equal(result.cookedRecipeId, "fish-with-gnocchi-and-fresh-tomato-sauce");
    assert.equal(result.cookedRecipeName, "Fish with gnocchi and fresh tomato sauce");
    assert.equal(result.plannedRecipeId, null);
  });

  it("lets an explicit cook event win over a conflicting inferred session", () => {
    const result = project({
      cookEvents: [{ recipeId: "explicit-recipe" }],
      sessions: [makeSession()],
      recipeNames: new Map([["explicit-recipe", "Explicitly logged dinner"]]),
    });

    assert.equal(result.cookedRecipeId, "explicit-recipe");
    assert.equal(result.cookedRecipeName, "Explicitly logged dinner");
  });

  it("does not treat an uncompleted meal-plan draft session as cooked", () => {
    const result = project({
      slot: makeSlot("planned-recipe", "Planned recipe"),
      sessions: [
        makeSession({
          source: "meal-plan",
          anchor: {
            type: "kitchen-recipe",
            recipeId: "planned-recipe",
            title: "Planned recipe",
            provenance: { source: "kitchen" },
          },
        }),
      ],
    });

    assert.equal(result.status, "planned-unlogged");
    assert.equal(result.cookedRecipeId, null);
  });

  it("includes a completed meal-plan session as actual history", () => {
    const result = project({
      slot: makeSlot("planned-recipe", "Planned recipe"),
      sessions: [
        makeSession({
          source: "meal-plan",
          status: "completed",
          anchor: {
            type: "kitchen-recipe",
            recipeId: "planned-recipe",
            title: "Planned recipe",
            provenance: { source: "kitchen" },
          },
        }),
      ],
    });

    assert.equal(result.status, "cooked-as-planned");
    assert.equal(result.cookedRecipeName, "Planned recipe");
  });

  it("never uses an abandoned session as actual history", () => {
    const result = project({ sessions: [makeSession({ status: "abandoned" })] });

    assert.equal(result.status, null);
    assert.equal(result.cookedRecipeName, null);
  });

  it("uses the field-resolved actual main while retaining a divergent plan", () => {
    const result = project({
      slot: makeSlot("planned-lasagna", "Planned lasagna"),
      sessions: [
        makeSession({
          main: {
            recipeId: "actual-risotto",
            title: "Actual mushroom risotto",
            setBy: "app",
          },
        }),
      ],
    });

    assert.equal(result.status, "cooked-other");
    assert.equal(result.cookedRecipeId, "actual-risotto");
    assert.equal(result.cookedRecipeName, "Actual mushroom risotto");
    assert.equal(result.plannedRecipeId, "planned-lasagna");
    assert.equal(result.plannedRecipeName, "Planned lasagna");
  });

  it("shows today's ad-hoc Live Cooking session as in progress", () => {
    const result = project({
      date: TODAY,
      sessions: [makeSession({ date: TODAY, status: "active" })],
    });

    assert.equal(result.status, "in-progress");
    assert.equal(result.cookedRecipeId, "fish-with-gnocchi-and-fresh-tomato-sauce");
    assert.equal(result.cookedRecipeName, "Fish with gnocchi and fresh tomato sauce");
  });

  it("does not treat today's incomplete meal-plan session as actual", () => {
    const result = project({
      date: TODAY,
      slot: makeSlot("planned-recipe", "Planned recipe"),
      sessions: [
        makeSession({
          date: TODAY,
          source: "meal-plan",
          status: "active",
          anchor: {
            type: "kitchen-recipe",
            recipeId: "planned-recipe",
            title: "Planned recipe",
            provenance: { source: "kitchen" },
          },
        }),
      ],
    });

    assert.equal(result.status, "planned");
    assert.equal(result.cookedRecipeName, null);
  });

  it("does not treat a future ad-hoc session as actual", () => {
    const future = "2026-09-08";
    const result = project({
      date: future,
      sessions: [makeSession({ date: future, status: "active" })],
    });

    assert.equal(result.status, null);
    assert.equal(result.cookedRecipeName, null);
  });

  it("keeps explicit cook events above today's in-progress session", () => {
    const result = project({
      date: TODAY,
      cookEvents: [{ recipeId: "explicit-recipe" }],
      sessions: [makeSession({ date: TODAY, status: "active" })],
      recipeNames: new Map([["explicit-recipe", "Explicitly logged dinner"]]),
    });

    assert.equal(result.status, "cooked-other");
    assert.equal(result.cookedRecipeId, "explicit-recipe");
    assert.equal(result.cookedRecipeName, "Explicitly logged dinner");
  });

  it("treats today's completed session as cooked rather than in progress", () => {
    const result = project({
      date: TODAY,
      sessions: [makeSession({ date: TODAY, status: "completed" })],
    });

    assert.equal(result.status, "cooked-other");
    assert.equal(result.cookedRecipeName, "Fish with gnocchi and fresh tomato sauce");
  });

  it("keeps restaurant context as skipped rather than inventing an actual meal", () => {
    const result = project({ intentionallySkipped: true });

    assert.equal(result.status, "skipped");
    assert.equal(result.cookedRecipeId, null);
    assert.equal(result.cookedRecipeName, null);
  });
});
