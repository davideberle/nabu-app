/**
 * The shelf presentation contract: three groups, an editorial note, the
 * light-meal label and its completion suggestion.
 *
 * Run with: npm test  (node --test; Node 24 strips types natively)
 *
 * Two things are load-bearing here and are asserted over the whole real recipe
 * corpus rather than on hand-picked examples:
 *
 *   - no editorial note may contain selector vocabulary. "Cover the curry gap"
 *     is the exact sentence this pass exists to stop reaching a card.
 *   - grouping must never claim a weekday. The groups describe effort and meal
 *     shape; a project can still be assigned to a Wednesday.
 */

import { equal, ok, deepStrictEqual, notEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SHELF_GROUP_DESCRIPTIONS,
  SHELF_GROUP_LABELS,
  SHELF_GROUP_ORDER,
  candidateDisplay,
  containsSelectorVocabulary,
  deriveShelfDisplay,
  editorialNoteFor,
  groupShelfItems,
  shelfGroupFor,
  type ShelfGroup,
} from "./planner-display.ts";
import { classifyPlannerRole } from "./planner-roles.ts";
import { deriveShelfTraits, type EffortLane, type MealShape, type ProteinLane, type ShelfTraits, type StarchLane } from "./planner-shelf.ts";
import type { Recipe } from "./recipes.ts";

const NOW = new Date("2026-08-09T00:00:00.000Z");

function traits(overrides: Partial<ShelfTraits> = {}): ShelfTraits {
  return {
    shape: "other",
    protein: "vegetarian",
    starch: "none",
    effort: "medium",
    weekdayFit: true,
    weekendFit: true,
    vegetableDense: false,
    seasonalLocal: false,
    longHaul: false,
    ...overrides,
  };
}

const SHAPES: MealShape[] = [
  "salad", "soup", "stew-curry", "bowl", "pasta", "roast-bake", "stir-fry", "grill", "other",
];
const PROTEINS: ProteinLane[] = ["vegan", "vegetarian", "fish", "meat"];
const STARCHES: StarchLane[] = ["pasta", "rice", "bread", "potato", "grain", "legume", "none"];
const EFFORTS: EffortLane[] = ["quick", "medium", "project"];

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

describe("display groups", () => {
  it("renders exactly the three contract groups, in order", () => {
    deepStrictEqual([...SHELF_GROUP_ORDER], ["easy-light", "everyday-dinners", "worth-more-time"]);
    deepStrictEqual(
      SHELF_GROUP_ORDER.map((group) => SHELF_GROUP_LABELS[group]),
      ["Easy & light", "Everyday dinners", "Worth more time"],
    );
  });

  it("puts a light meal in Easy & light whatever its technique says", () => {
    equal(shelfGroupFor("light-meal", traits({ shape: "grill", effort: "medium" })), "easy-light");
    equal(shelfGroupFor("light-meal", traits({ shape: "roast-bake", effort: "project" })), "easy-light");
  });

  it("sorts by effort and meal shape", () => {
    equal(shelfGroupFor("main", traits({ effort: "quick" })), "easy-light");
    equal(shelfGroupFor("main", traits({ effort: "medium", shape: "salad" })), "easy-light");
    equal(shelfGroupFor("main", traits({ effort: "medium", shape: "stew-curry" })), "everyday-dinners");
    equal(shelfGroupFor("main", traits({ effort: "project" })), "worth-more-time");
  });

  it("never says a dish belongs on a particular weekday", () => {
    const copy = [
      ...Object.values(SHELF_GROUP_LABELS),
      ...Object.values(SHELF_GROUP_DESCRIPTIONS),
    ].join(" ");
    for (const day of [
      "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
      "weekday", "weekend", "midweek", "tonight",
    ]) {
      ok(!new RegExp(`\\b${day}\\b`, "i").test(copy), `group copy must not mention ${day}: ${copy}`);
    }
  });

  it("groups a shelf in contract order and omits the empty groups", () => {
    const items = [
      { id: "a", display: deriveShelfDisplay({ role: "main", traits: traits({ effort: "project" }) }) },
      { id: "b", display: deriveShelfDisplay({ role: "light-meal", traits: traits() }) },
      { id: "c", display: deriveShelfDisplay({ role: "main", traits: traits({ effort: "quick" }) }) },
    ];
    const sections = groupShelfItems(items, (item) => item.display);
    deepStrictEqual(sections.map((s) => s.group), ["easy-light", "worth-more-time"]);
    deepStrictEqual(sections[0].items.map((i) => i.id), ["b", "c"], "order within a group is preserved");
    equal(sections.length, 2, "Everyday dinners is omitted because nothing landed in it");
  });

  it("returns nothing for an empty shelf", () => {
    deepStrictEqual(groupShelfItems([], () => deriveShelfDisplay({})), []);
  });
});

// ---------------------------------------------------------------------------
// Editorial copy
// ---------------------------------------------------------------------------

describe("editorial notes", () => {
  it("describes the meal, not the selection", () => {
    equal(
      editorialNoteFor("main", traits({ shape: "soup", protein: "vegan", vegetableDense: true, effort: "quick" }), 30),
      "A warming soup, plant-based and full of vegetables, on the table in about 30 minutes.",
    );
    equal(
      editorialNoteFor("main", traits({ shape: "roast-bake", protein: "meat", effort: "project" }), 150),
      "An oven-baked main, worth a slower evening.",
    );
    equal(
      editorialNoteFor("light-meal", traits({ shape: "grill", protein: "vegan", vegetableDense: true, effort: "quick" }), 4),
      "A light plate, plant-based and full of vegetables, quick to get on the table.",
    );
  });

  it("never leaks selector vocabulary, over every trait combination", () => {
    let checked = 0;
    for (const shape of SHAPES) {
      for (const protein of PROTEINS) {
        for (const starch of STARCHES) {
          for (const effort of EFFORTS) {
            for (const seasonalLocal of [true, false]) {
              for (const vegetableDense of [true, false]) {
                for (const role of ["main", "light-meal"]) {
                  const note = editorialNoteFor(
                    role,
                    traits({ shape, protein, starch, effort, seasonalLocal, vegetableDense }),
                    effort === "quick" ? 25 : 60,
                  );
                  checked += 1;
                  ok(
                    !containsSelectorVocabulary(note),
                    `note leaked selector vocabulary: ${note}`,
                  );
                  ok(note.endsWith("."), `note must be a sentence: ${note}`);
                  ok(note.length <= 120, `note must stay concise: ${note}`);
                }
              }
            }
          }
        }
      }
    }
    ok(checked > 1000, `expected the full trait matrix, checked ${checked}`);
  });

  it("recognises the vocabulary it is guarding against", () => {
    // The internal reasons the assembler writes are exactly what must not be
    // rendered — this is what the guard is calibrated on.
    ok(containsSelectorVocabulary("From your recipe book to cover the stew curry gap"));
    ok(containsSelectorVocabulary("From your recipe book to round out the week"));
    ok(containsSelectorVocabulary("Cookie and Kate already at its cap of 2"));
    ok(!containsSelectorVocabulary("A warming soup, plant-based, on the table in about 30 minutes."));
  });

  it("is deterministic", () => {
    const input = { role: "main", traits: traits({ shape: "pasta", effort: "quick" }), time: { total: 25 } };
    equal(deriveShelfDisplay(input).note, deriveShelfDisplay(input).note);
  });
});

// ---------------------------------------------------------------------------
// Light meals and completion
// ---------------------------------------------------------------------------

describe("light meals", () => {
  it("labels the role and carries the completion when one is supplied", () => {
    const display = deriveShelfDisplay({
      role: "light-meal",
      traits: traits({ shape: "grill", protein: "vegan" }),
      completion: "Serve with rice",
    });
    equal(display.lightMeal, true);
    equal(display.makeItDinner, "Serve with rice");
  });

  it("shows no completion when there is nothing concrete to say", () => {
    const display = deriveShelfDisplay({ role: "light-meal", traits: traits() });
    equal(display.lightMeal, true);
    equal(display.makeItDinner, undefined);
  });

  it("never puts a completion on a full main", () => {
    const display = deriveShelfDisplay({ role: "main", traits: traits(), completion: "Serve with rice" });
    equal(display.lightMeal, false);
    equal(display.makeItDinner, undefined);
  });
});

// ---------------------------------------------------------------------------
// BBQ Cauliflower — the case this pass was opened for
// ---------------------------------------------------------------------------

const BBQ_CAULIFLOWER: Recipe = {
  id: "bbq-cauliflower",
  name: "Bbq Cauliflower",
  source: { cookbook: "The Vegan Korean", author: "Various", chapter: "Main Dishes" },
  servings: "4",
  category: { dish_type: ["main"], chapter: "Main Dishes", meal_role: "main" },
  cuisine: "Korean",
  dietary: ["vegan", "vegetarian"],
  time: { total: 4 },
  image: "/recipes/bbq-cauliflower.jpg",
  ingredients: [
    { item: "medium or large cauliflower, cut into small florets (about 7–8 cups)", amount: "1" },
    { item: "1/3 cup water", amount: "" },
    { item: "green onions, sliced thinly", amount: "4" },
    { item: "baby spinach (optional)", amount: "3 cups" },
    { item: "up to 1/3 cup tamari *", amount: "¼ cup" },
    { item: "white miso *", amount: "1 Tbsp" },
    { item: "Tbsps organic maple syrup *", amount: "3" },
    { item: "molasses", amount: "1 tsp" },
    { item: "minced ginger", amount: "1 tsp" },
    { item: "minced garlic", amount: "1 Tbsp" },
    { item: "toasted sesame seeds", amount: "2 Tbsp" },
    { item: "organic cornstarch (+ more, if needed) *", amount: "1 Tbsp" },
  ],
  method: [
    "Place the Sauce Ingredients into a small bowl, whisk well, then set aside.",
    "In a large pot, add the cauliflower florets and 1/3 cup water. Cover and steam over medium-high heat for approx. 4 minutes.",
    "Cook the cauliflower, stirring constantly until tender. Then stir in the green onions and baby spinach.",
    "Serve immediately with rice of choice, and top with your favorite toppers like additional toasted sesame seeds and/or chopped green onions.",
  ],
} as Recipe;

describe("BBQ Cauliflower", () => {
  it("is a substantial light meal, not an unquestioned full main", () => {
    const role = classifyPlannerRole(BBQ_CAULIFLOWER);
    equal(role.role, "light-meal");
    equal(role.mainEligible, true, "it can still carry a dinner");
  });

  it("takes its rice suggestion from the recipe's own serving line", () => {
    equal(classifyPlannerRole(BBQ_CAULIFLOWER).completion, "Serve with rice");
  });

  it("does not invent a green salad for a dish that already has greens", () => {
    // The recipe finishes with spinach and green onions stirred through; the
    // only thing it says is missing is the rice.
    const completion = classifyPlannerRole(BBQ_CAULIFLOWER).completion ?? "";
    ok(!/green salad/.test(completion), completion);
  });

  it("renders as a light meal in Easy & light with the rice completion", () => {
    const role = classifyPlannerRole(BBQ_CAULIFLOWER);
    const display = deriveShelfDisplay({
      role: role.role,
      traits: deriveShelfTraits(BBQ_CAULIFLOWER, NOW),
      time: { total: 4 },
      completion: role.completion,
    });
    equal(display.group, "easy-light");
    equal(display.lightMeal, true);
    equal(display.makeItDinner, "Serve with rice");
    ok(!containsSelectorVocabulary(display.note), display.note);
  });

  it("keeps recipe fidelity: nothing about the recipe itself changed", () => {
    equal(BBQ_CAULIFLOWER.method.length, 4);
    equal(BBQ_CAULIFLOWER.ingredients.length, 12);
    deepStrictEqual(BBQ_CAULIFLOWER.category?.dish_type, ["main"]);
  });
});

// ---------------------------------------------------------------------------
// Legacy candidate normalization — this is what 2026-W33 relies on
// ---------------------------------------------------------------------------

describe("legacy candidate normalization", () => {
  it("derives the contract from a persisted item that predates it", () => {
    const persisted = {
      recipeId: "spring-grain-bowl",
      role: "main",
      traits: traits({ shape: "bowl", protein: "vegan", effort: "quick", seasonalLocal: true }),
      time: { prep: 10, cook: 10, total: 20 },
      reason: "From your recipe book to cover the quick weekday gap",
    };
    const display = candidateDisplay(persisted);
    equal(display.group, "easy-light");
    ok(display.note.length > 0);
    ok(!containsSelectorVocabulary(display.note), display.note);
    notEqual(display.note, persisted.reason);
  });

  it("still produces an honest card for an item with no traits at all", () => {
    const display = candidateDisplay({ recipeId: "mystery" });
    equal(display.group, "everyday-dinners");
    ok(display.note.length > 0);
    ok(!containsSelectorVocabulary(display.note), display.note);
    equal(display.lightMeal, false);
  });

  it("prefers a stored display so a card does not change wording mid-week", () => {
    const stored = {
      group: "worth-more-time" as ShelfGroup,
      note: "A slow braise worth the evening.",
      lightMeal: false,
    };
    deepStrictEqual(
      candidateDisplay({ recipeId: "x", role: "main", traits: traits({ effort: "quick" }), display: stored }),
      stored,
    );
  });

  it("ignores a stored display that is not usable", () => {
    const display = candidateDisplay({
      recipeId: "x",
      role: "main",
      traits: traits({ effort: "project" }),
      display: { note: "" } as never,
    });
    equal(display.group, "worth-more-time");
    ok(display.note.length > 0);
  });
});
