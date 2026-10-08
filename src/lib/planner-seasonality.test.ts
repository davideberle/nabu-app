// Swiss monthly seasonality for the shelf (Kitchen DESIGN.md §4.3.1): the
// cited VSGP calendar, defining-ingredient selection, the five evidence
// classes, and the "a garnish cannot make or save a dish" rule. WP08.
//
// Run with: npm test  (node --test; Node 24 strips types natively)

import { equal, ok, deepStrictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  definingIngredients,
  isoWeekThursday,
  isSubstantialLine,
  monthForWeek,
  seasonCalendar,
  seasonalityForRecipe,
  seasonalityScore,
  withSeasonCalendar,
} from "./planner-seasonality.ts";

const OCTOBER = 10;
const JANUARY = 1;

describe("the calendar", () => {
  it("is the cited VSGP Saisonkalender with twelve-month rows", () => {
    const calendar = seasonCalendar();
    ok(calendar.source.organization.includes("VSGP"));
    equal(calendar.source.url, "https://www.gemuese.ch/saisonkalender");
    ok(calendar.rows.length >= 80, `expected the full VSGP table, got ${calendar.rows.length} rows`);
    const squash = calendar.rows.find((row) => row.name === "Kürbis");
    deepStrictEqual(squash?.months, ["jan", "feb", "jul", "aug", "sep", "oct", "nov", "dec"]);
    const asparagus = calendar.rows.find((row) => row.name === "Grünspargel");
    deepStrictEqual(asparagus?.months, ["apr", "may", "jun"]);
  });

  it("maps an ISO week to the month of its Thursday", () => {
    equal(isoWeekThursday("2026-W42")?.toISOString().slice(0, 10), "2026-10-15");
    equal(monthForWeek("2026-W42"), 10);
    equal(monthForWeek("2027-W01"), 1);
    equal(monthForWeek("2026-W53", new Date("2026-06-01T00:00:00Z")), 12, "W53 of 2026 does not exist; falls back to now");
  });
});

describe("defining ingredients", () => {
  it("counts produce in the title and substantial lines near the top, never aromatics", () => {
    const defining = definingIngredients(
      {
        name: "Roast squash with lentils",
        ingredients: [
          { item: "butternut squash", amount: "1", unit: "" },
          { item: "red lentils", amount: "250", unit: "g" },
          { item: "onion", amount: "1" },
          { item: "garlic cloves", amount: "3" },
          { item: "parsley", amount: "handful" },
          { item: "kale", amount: "200", unit: "g" },
        ],
      },
      OCTOBER,
    );
    deepStrictEqual(
      defining.map((d) => [d.produce, d.status, d.from]),
      [["Kürbis", "fresh", "name"], ["Federkohl", "fresh", "ingredients"]],
    );
  });

  it("treats a teaspoon, a sprig or a garnish as non-defining", () => {
    ok(!isSubstantialLine({ item: "fresh basil", amount: "2", unit: "tbsp" }, 0));
    ok(!isSubstantialLine({ item: "asparagus tips", amount: "", unit: "" }, 9), "deep in the list with no amount");
    ok(isSubstantialLine({ item: "asparagus", amount: "500", unit: "g" }, 9));
    ok(isSubstantialLine({ item: "asparagus", amount: "1 bunch" }, 3));
    ok(!isSubstantialLine({ item: "spinach", amount: "50", unit: "g" }, 0), "50 g is a garnish-sized amount");
  });

  it("reads canned, dried and frozen produce as preserved", () => {
    const defining = definingIngredients(
      { name: "Chickpea stew", ingredients: [{ item: "chopped tomatoes", amount: "400", unit: "g" }, { item: "frozen peas", amount: "150", unit: "g" }] },
      JANUARY,
    );
    deepStrictEqual(defining.map((d) => d.status), ["preserved", "preserved"]);
  });

  it("does not read black pepper as a bell pepper", () => {
    const defining = definingIngredients({ name: "Lentil soup", ingredients: [{ item: "black pepper", amount: "1", unit: "tsp" }, { item: "pepper", amount: "" }] }, OCTOBER);
    deepStrictEqual(defining, []);
  });
});

describe("recipe verdicts (WP08)", () => {
  it("October-defining produce is fresh with a supported note", () => {
    const result = seasonalityForRecipe(
      { name: "Pumpkin and kale gratin", ingredients: [{ item: "hokkaido pumpkin", amount: "800", unit: "g" }, { item: "kale", amount: "300", unit: "g" }] },
      OCTOBER,
    );
    equal(result.status, "fresh");
    equal(result.note, "Pumpkin and kale are in season in Switzerland in October.");
    equal(seasonalityScore(result.status), 3);
  });

  it("an out-of-season fresh ingredient is not cancelled by a seasonal garnish", () => {
    const result = seasonalityForRecipe(
      {
        name: "Tomato salad with pumpkin seeds",
        ingredients: [
          { item: "ripe tomatoes", amount: "600", unit: "g" },
          { item: "kale leaves, to garnish", amount: "a few" },
          { item: "pumpkin seeds", amount: "2", unit: "tbsp" },
        ],
      },
      JANUARY,
    );
    equal(result.status, "out-of-season");
    ok(result.note?.startsWith("Fresh tomatoes are out of the Swiss season in January"), result.note);
    equal(seasonalityScore(result.status), -3);
  });

  it("an out-of-season defining ingredient outranks an in-season one", () => {
    const result = seasonalityForRecipe(
      { name: "Asparagus and leek tart", ingredients: [{ item: "green asparagus", amount: "500", unit: "g" }, { item: "leeks", amount: "2" }] },
      OCTOBER,
    );
    equal(result.status, "out-of-season");
    ok(result.reasons.some((reason) => reason.includes("does not cancel")));
  });

  it("stored Swiss harvest is reported as storage, not as fresh", () => {
    const result = seasonalityForRecipe(
      { name: "Carrot and celeriac soup", ingredients: [{ item: "carrots", amount: "500", unit: "g" }, { item: "celeriac", amount: "1" }] },
      JANUARY,
    );
    equal(result.status, "storage");
    equal(result.note, "Carrots and celeriac come from stored Swiss harvest in January.");
    equal(seasonalityScore(result.status), 1);
  });

  it("preserved and pantry dishes are neutral and carry no note", () => {
    const preserved = seasonalityForRecipe(
      { name: "Chickpea curry", ingredients: [{ item: "canned chickpeas", amount: "2", unit: "cans" }, { item: "chopped tomatoes", amount: "400", unit: "g" }, { item: "coconut milk", amount: "400", unit: "ml" }] },
      JANUARY,
    );
    equal(preserved.status, "preserved");
    equal(preserved.note, undefined);
    equal(seasonalityScore(preserved.status), 0);

    const pantry = seasonalityForRecipe({ name: "Spaghetti aglio e olio", ingredients: [{ item: "spaghetti", amount: "400", unit: "g" }, { item: "garlic", amount: "4", unit: "cloves" }, { item: "olive oil", amount: "6", unit: "tbsp" }] }, JANUARY);
    equal(pantry.status, "pantry-neutral");
    equal(pantry.note, undefined);
  });

  it("produce the calendar does not cover is uncertain, never claimed local", () => {
    const result = seasonalityForRecipe(
      { name: "Avocado and mango bowl", ingredients: [{ item: "avocados", amount: "2" }, { item: "mango", amount: "1" }, { item: "rice", amount: "200", unit: "g" }] },
      OCTOBER,
    );
    equal(result.status, "uncertain");
    equal(result.note, undefined);
    ok(result.reasons[0].includes("no origin claimed"));
  });

  it("is bound to the calendar version and the month, not to the recipe content hash", () => {
    const recipe = { name: "Courgette fritters", ingredients: [{ item: "courgettes", amount: "3" }] };
    equal(seasonalityForRecipe(recipe, 7).status, "fresh");
    equal(seasonalityForRecipe(recipe, 1).status, "out-of-season");
    const swapped = withSeasonCalendar(
      { ...seasonCalendar(), calendarVersion: "test-calendar", rows: seasonCalendar().rows.map((row) => (row.name === "Zucchetti" ? { ...row, months: ["jan"] } : row)) },
      () => seasonalityForRecipe(recipe, 1),
    );
    equal(swapped.status, "fresh");
    equal(swapped.calendarVersion, "test-calendar");
  });
});
