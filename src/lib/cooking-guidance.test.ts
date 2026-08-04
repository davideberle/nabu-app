// Unit tests for /cooking display support: table-side extraction, recipe-time
// formatting, and the pairing fallback. The meal-timeline generator these tests
// once covered is deleted — the page renders no second instruction set of any
// kind (live-cooking DESIGN.md §3 rule 11).
// Run with: npm test  (node --test; Node 24 strips types natively)

import { deepStrictEqual, equal, match, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPairingSuggestion,
  extractTableSides,
  formatRecipeTime,
} from "./cooking-guidance.ts";

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
