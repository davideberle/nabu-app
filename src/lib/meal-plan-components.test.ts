// Unit tests for merging accepted complements into a planned day.
// Run with: npm test  (node --test; Node 24 strips types natively)

import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeMealComponents, type PlanComponentRef } from "./meal-plan-components.ts";

const STARTER: PlanComponentRef = { id: "sprout-cucumber-side", name: "Bean Sprout & Cucumber Side" };
const SIDE: PlanComponentRef = { id: "cold-kimchi", name: "Cold Kimchi" };
const DESSERT: PlanComponentRef = { id: "poached-rhubarb", name: "Poached Rhubarb" };

describe("mergeMealComponents", () => {
  it("keeps both recommendations, in order, when 'Add these 2' is pressed", () => {
    const merged = mergeMealComponents([], [STARTER, SIDE]);
    deepStrictEqual(merged.components, [STARTER, SIDE]);
    deepStrictEqual(merged.added, [STARTER, SIDE]);
    ok(merged.changed);
  });

  it("keeps all three recommendations, in order, when 'Add these 3' is pressed", () => {
    const merged = mergeMealComponents([], [STARTER, SIDE, DESSERT]);
    deepStrictEqual(
      merged.components.map((c) => c.id),
      ["sprout-cucumber-side", "cold-kimchi", "poached-rhubarb"]
    );
    deepStrictEqual(merged.added.length, 3);
  });

  it("preserves already-accepted sides and appends the new ones after them", () => {
    const existing = [{ id: "steamed-rice", name: "Steamed Short-Grain Rice" }];
    const merged = mergeMealComponents(existing, [STARTER, SIDE]);
    deepStrictEqual(
      merged.components.map((c) => c.id),
      ["steamed-rice", "sprout-cucumber-side", "cold-kimchi"]
    );
    deepStrictEqual(merged.added, [STARTER, SIDE]);
    // The saved list is never mutated in place.
    deepStrictEqual(existing, [{ id: "steamed-rice", name: "Steamed Short-Grain Rice" }]);
  });

  it("drops a recommendation that is already on the day", () => {
    const merged = mergeMealComponents([SIDE], [STARTER, SIDE, DESSERT]);
    deepStrictEqual(
      merged.components.map((c) => c.id),
      ["cold-kimchi", "sprout-cucumber-side", "poached-rhubarb"]
    );
    deepStrictEqual(merged.added, [STARTER, DESSERT]);
  });

  it("collapses an id repeated inside one batch to its first occurrence", () => {
    const merged = mergeMealComponents(
      [],
      [STARTER, { id: "sprout-cucumber-side", name: "Bean Sprout & Cucumber Side (alt)" }, SIDE]
    );
    deepStrictEqual(merged.components, [STARTER, SIDE]);
    deepStrictEqual(merged.added, [STARTER, SIDE]);
  });

  it("collapses a duplicated id already present in the saved list", () => {
    const merged = mergeMealComponents([SIDE, { ...SIDE }], [STARTER]);
    deepStrictEqual(
      merged.components.map((c) => c.id),
      ["cold-kimchi", "sprout-cucumber-side"]
    );
  });

  it("reports no change when every recommendation is already accepted", () => {
    const merged = mergeMealComponents([STARTER, SIDE], [SIDE, STARTER]);
    equal(merged.changed, false);
    deepStrictEqual(merged.added, []);
    deepStrictEqual(merged.components, [STARTER, SIDE]);
  });

  it("ignores blank and whitespace-only ids from either side", () => {
    const merged = mergeMealComponents(
      [{ id: "  ", name: "Ghost" }],
      [{ id: "", name: "Nameless" }, STARTER]
    );
    deepStrictEqual(merged.components, [STARTER]);
    deepStrictEqual(merged.added, [STARTER]);
  });

  it("treats a padded id as the same component", () => {
    const merged = mergeMealComponents([SIDE], [{ id: " cold-kimchi ", name: "Cold Kimchi" }]);
    equal(merged.changed, false);
    deepStrictEqual(merged.components, [SIDE]);
  });

  it("handles missing lists without throwing", () => {
    deepStrictEqual(mergeMealComponents(null, undefined), {
      components: [],
      added: [],
      changed: false,
    });
    deepStrictEqual(mergeMealComponents(undefined, [STARTER]).components, [STARTER]);
  });

  it("is deterministic across repeated runs", () => {
    const existing = [SIDE];
    const additions = [STARTER, SIDE, DESSERT, STARTER];
    deepStrictEqual(
      mergeMealComponents(existing, additions),
      mergeMealComponents(existing, additions)
    );
  });
});
