// November 10, 2026 catalog cleanup: all 25 misaligned Raw Food / Real Thai
// records are removed from the static bundle. Stored meal plans (W33–W46) still
// name some of them in `candidateSet.reserves` and `candidateSet.qaDiagnostics`,
// and the stored rows are not edited. This pins that a missing id there — or in
// any exclusion set derived from history — breaks neither loading a week nor
// choosing suggestions. Run with: npm test

import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { sanitizeCandidateItems } from "./meals-core.ts";
import { selectCandidateMains } from "./meals.ts";
import { catalogExclusionIds, hydrateShelfItems } from "./planner-preparation.ts";
import { classifyPlannerRole } from "./planner-roles.ts";
import { isBrowsableStaticRecipe } from "./recipe-catalog.ts";
import { qaRecipeForShelf } from "./recipe-render-qa.ts";
import type { Recipe } from "./recipes.ts";

const bundle = JSON.parse(
  readFileSync(new URL("../data/recipes-bundle.json", import.meta.url), "utf8"),
) as Recipe[];
const byId = new Map(bundle.map((r) => [r.id, r]));
const resolve = async (id: string) => byId.get(id);

// The ids the read-only production scan found in stored W33–W46 plan rows.
const REMOVED_BUT_STORED = [
  "arugula-and-pear-salad",
  "asian-kelp-noodles",
  "nori-rolls",
  "spicy-mango-salad",
  "sushi",
  "sweet-potato-curry",
  "hokkien-fried-noodles",
  "pon-pla-tu-mackerel-salad",
];

// Real shelf-eligible mains from the shipped bundle.
const mains = bundle
  .filter(isBrowsableStaticRecipe)
  .filter((r) => {
    const role = classifyPlannerRole(r).role;
    return (role === "main" || role === "light-meal") && qaRecipeForShelf(r, { role }).ok;
  })
  .slice(0, 6);

function storedPlanShape() {
  return {
    week: "2026-W46",
    candidateSet: {
      items: mains.map((r) => ({ recipeId: r.id, recipeName: r.name, origin: "catalog", image: r.image })),
      reserves: REMOVED_BUT_STORED.slice(0, 3).map((id) => ({ recipeId: id, recipeName: id })),
      qaDiagnostics: REMOVED_BUT_STORED.map((id) => ({ recipeId: id, recipeName: id, issues: ["missing-image"], fixes: [] })),
    },
  };
}

describe("removed recipes still named in stored plan rows", () => {
  it("fixture: every removed id is gone from the bundle and the shelf mains are real", () => {
    for (const id of REMOVED_BUT_STORED) equal(byId.has(id), false, id);
    equal(mains.length, 6);
  });

  it("loading a week: the shelf hydrates unchanged; reserves and diagnostics are never resolved", async () => {
    const plan = storedPlanShape();
    const sanitized = sanitizeCandidateItems(plan.candidateSet.items, new Set(), {
      recentlyCooked: new Set(REMOVED_BUT_STORED),
      recentlyPlanned: new Set(REMOVED_BUT_STORED),
      recentlyOffered: new Set(),
      negativeFeedback: new Set(REMOVED_BUT_STORED),
    }).items;
    deepStrictEqual(sanitized.map((i) => i.recipeId), mains.map((r) => r.id));
    const hydrated = await hydrateShelfItems(sanitized, new Set(), resolve, new Date("2026-11-10T12:00:00Z"), { week: plan.week });
    deepStrictEqual(hydrated.map((i) => i.recipeId), mains.map((r) => r.id));
  });

  it("a removed id that did reach the stored shelf is dropped quietly, never throws", async () => {
    const items = [
      { recipeId: "sushi", recipeName: "Sushi", origin: "catalog" },
      ...storedPlanShape().candidateSet.items,
      { recipeId: "hokkien-fried-noodles", recipeName: "Hokkien Fried Noodles", origin: "catalog" },
    ];
    const hydrated = await hydrateShelfItems(items, new Set(["sushi"]), resolve, new Date("2026-11-10T12:00:00Z"), { week: "2026-W47" });
    deepStrictEqual(hydrated.map((i) => i.recipeId), mains.map((r) => r.id));
  });

  it("choosing suggestions: exclusion sets that name removed ids select normally", () => {
    const excluded = catalogExclusionIds({
      recentlyCooked: REMOVED_BUT_STORED,
      recentlyPlanned: [],
      negativeFeedback: [],
      legacyOffered: REMOVED_BUT_STORED,
      exposureExcluded: REMOVED_BUT_STORED,
      staged: [],
    });
    ok(REMOVED_BUT_STORED.every((id) => excluded.has(id)));
    const pool = bundle.filter(isBrowsableStaticRecipe);
    const withRemovedExcluded = selectCandidateMains(pool, excluded);
    const plain = selectCandidateMains(pool, new Set());
    ok(withRemovedExcluded.candidates.length > 0);
    deepStrictEqual(
      withRemovedExcluded.candidates.map((c) => c.recipe.id),
      plain.candidates.map((c) => c.recipe.id),
      "ids that no longer exist must not change the selection",
    );
  });
});
