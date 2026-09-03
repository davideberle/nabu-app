// Unit tests for /cooking display support: the course menu, table-side
// extraction, recipe-time formatting, and the pairing fallback. The
// meal-timeline generator these tests once covered is deleted — the page
// renders no second instruction set of any kind (live-cooking DESIGN.md §3
// rule 11).
// Run with: npm test  (node --test; Node 24 strips types natively)

import { deepStrictEqual, equal, match, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCourseMenu,
  buildPairingSuggestion,
  extractTableSides,
  formatRecipeTime,
} from "./cooking-guidance.ts";

describe("buildCourseMenu", () => {
  it("orders lanes starter → main → accompaniments → dessert and omits empty ones", () => {
    deepStrictEqual(
      buildCourseMenu({
        mainTitle: "Coconut red curry stew",
        components: [
          { kind: "dessert", title: "Rhubarb tart" },
          { kind: "side", title: "Cucumber raita" },
          { kind: "starter", title: "Avocado kimchi toast" },
        ],
        tableSides: ["Jasmine rice"],
      }),
      [
        { kind: "starter", label: "Starter", dishes: ["Avocado kimchi toast"] },
        { kind: "main", label: "Main", dishes: ["Coconut red curry stew"] },
        {
          kind: "accompaniments",
          label: "Accompaniments",
          dishes: ["Cucumber raita", "Jasmine rice"],
        },
        { kind: "dessert", label: "Dessert", dishes: ["Rhubarb tart"] },
      ]
    );
  });

  it("carries no lane the meal does not have", () => {
    deepStrictEqual(
      buildCourseMenu({
        mainTitle: "Roast chicken",
        tableSides: ["Green salad"],
      }).map((course) => course.kind),
      ["main", "accompaniments"]
    );
  });

  it("lists each dish once, keeping the earlier course", () => {
    deepStrictEqual(
      buildCourseMenu({
        mainTitle: "Farfalle with roasted peppers",
        components: [{ kind: "side", title: "Green salad" }],
        // The same salad reached the page twice: as a typed side and as
        // serve-with text.
        tableSides: ["green  salad", "Crusty bread"],
      }),
      [
        { kind: "main", label: "Main", dishes: ["Farfalle with roasted peppers"] },
        {
          kind: "accompaniments",
          label: "Accompaniments",
          dishes: ["Green salad", "Crusty bread"],
        },
      ]
    );
  });

  it("keeps a displaced anchor in the main lane", () => {
    deepStrictEqual(buildCourseMenu({
      mainTitle: "Gochujang tofu bowl",
      alsoMains: ["Kimchi fried rice"],
    }), [
      {
        kind: "main",
        label: "Mains",
        dishes: ["Gochujang tofu bowl", "Kimchi fried rice"],
      },
    ]);
  });

  it("shows no menu for a main-only meal, which would only restate the recipe title", () => {
    deepStrictEqual(buildCourseMenu({ mainTitle: "Roast chicken" }), []);
    deepStrictEqual(
      buildCourseMenu({ mainTitle: "Roast chicken", tableSides: ["  "] }),
      []
    );
  });
});

describe("extractTableSides", () => {
  it("collects serve-with items and for-serving ingredients, dropping drinks", () => {
    deepStrictEqual(
      extractTableSides(
        [
          { amount: "1", item: "crusty bread, for serving" },
          { amount: "2", item: "salmon steaks" },
        ],
        ["Green salad", "Riesling"]
      ),
      ["Green salad", "crusty bread"]
    );
  });

  it("deduplicates by normalized label", () => {
    deepStrictEqual(
      extractTableSides(
        [{ amount: "", item: "green salad, for serving" }],
        ["Green Salad"]
      ),
      ["Green Salad"]
    );
  });
});

describe("formatRecipeTime", () => {
  it("formats total plus prep/cook when both exist", () => {
    equal(
      formatRecipeTime({ prep: "15 min", cook: "30 min" }),
      "45 min total · 15 min prep · 30 min cook"
    );
  });

  it("returns null without usable values", () => {
    equal(formatRecipeTime(undefined), null);
    equal(formatRecipeTime({}), null);
  });
});

describe("buildPairingSuggestion", () => {
  it("suggests a white lane for a fish main", () => {
    const pairing = buildPairingSuggestion({
      mainTitle: "Roasted salmon with lemon",
      ingredients: [{ amount: "2", item: "salmon fillets" }],
      method: ["Roast the salmon."],
      tableSides: [],
    });
    match(pairing.wine, /white|Chardonnay|Sauvignon|Riesling|Albariño|Chablis|Grüner/i);
    ok(pairing.nonAlcoholic.length > 0);
  });
});
