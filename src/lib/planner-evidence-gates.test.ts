// The ONE shared compatibility rule as consumed by the dinner gate, the role
// classifier, the candidate save boundary and the lookup predicate — on the
// actual Priority-50 records. Run with: npm test (node --test).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { equal, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import { isDinnerWorthy, isMainPlannerCandidate, reclassifyCandidateItems } from "./meals-core.ts";
import { classifyPlannerRole, isMainSlotEligible } from "./planner-roles.ts";
import {
  canonicalRecipeDigest,
  reviewedPlannerEvidenceRegistry,
  withReviewedPlannerEvidence,
  type ReviewedPlannerEvidenceRegistry,
} from "./planner-evidence.ts";
import type { Recipe } from "./recipes.ts";

const here = dirname(fileURLToPath(import.meta.url));
const recipesDir = join(here, "..", "data", "recipes");
const load = (id: string): Recipe => JSON.parse(readFileSync(join(recipesDir, `${id}.json`), "utf8"));
const basic = load("basic-pasta-sauce");
const sunday = load("sunday-sauce");
const watercress = load("watercress-salad-with-quail-eggs-ricotta-and-seeds");

const shipped = reviewedPlannerEvidenceRegistry();
const emptyRegistry: ReviewedPlannerEvidenceRegistry = { ...shipped, plannerExceptions: [] };
/** The ledger as it would read once the pasta ingredient lists are source-complete (fresh review, fresh digests). */
function cookingReadyRegistry(records: Recipe[]): ReviewedPlannerEvidenceRegistry {
  return {
    ...shipped,
    plannerExceptions: shipped.plannerExceptions.map((entry) => {
      const record = records.find((r) => r.id === entry.id);
      if (!record || entry.reviewedRole !== "main") return entry;
      const { cookingBlockReason: _reason, ...rest } = entry;
      return { ...rest, cookingReady: true, projectedRecipeSha256: canonicalRecipeDigest(record) };
    }),
  };
}
async function saved(recipe: Recipe) {
  const result = await reclassifyCandidateItems([{ recipeId: recipe.id, recipeName: recipe.name }], async () => recipe);
  return result.items.length;
}

describe("shipped ledger: semantic role corrected, planner cooking availability still blocked", () => {
  for (const recipe of [basic, sunday]) {
    it(`${recipe.id}: category is main/main, every consumer still refuses the main slot`, async () => {
      equal(recipe.category?.meal_role, "main");
      equal(isDinnerWorthy(recipe), false);
      equal(isMainPlannerCandidate(recipe), false);
      const role = classifyPlannerRole(recipe);
      equal(role.mainEligible, false);
      equal(isMainSlotEligible(recipe), false);
      ok(role.reasons.some((r) => r.includes("planner availability blocked")), role.reasons.join(" / "));
      equal(await saved(recipe), 0);
    });
  }
  it("watercress: reviewed starter is a pairing everywhere, not a main", async () => {
    equal(watercress.category?.meal_role, "starter");
    equal(isDinnerWorthy(watercress), false);
    equal(isMainPlannerCandidate(watercress), false);
    const role = classifyPlannerRole(watercress);
    equal(role.role, "pairing");
    equal(role.category, "starter");
    equal(role.pairingEligible, true);
    equal(await saved(watercress), 0);
  });
  it("without the ledger the legacy salad-as-main path would still admit the starter — the evidence is what aligns the consumers", () => {
    withReviewedPlannerEvidence(emptyRegistry, () => {
      equal(isDinnerWorthy(watercress), true);
      equal(classifyPlannerRole(watercress).role, "pairing");
    });
  });
});

describe("cooking-ready ledger (the post-reconciliation state): narrow exceptions, consistently", () => {
  const ready = cookingReadyRegistry([basic, sunday]);
  for (const recipe of [basic, sunday]) {
    it(`${recipe.id}: condiment title and one-paragraph method no longer refuse the reviewed plated main`, async () => {
      await withReviewedPlannerEvidence(ready, async () => {
        equal(isDinnerWorthy(recipe), true);
        equal(isMainPlannerCandidate(recipe), true);
        const role = classifyPlannerRole(recipe);
        equal(role.role, "main");
        equal(role.mainEligible, true);
        equal(await saved(recipe), 1);
      });
    });
    it(`${recipe.id}: stale content, forged flags and conflicting roles still fail`, async () => {
      await withReviewedPlannerEvidence(ready, async () => {
        const stale = structuredClone(recipe);
        stale.method[0] += " Changed source.";
        equal(isDinnerWorthy(stale), false);
        equal(classifyPlannerRole(stale).mainEligible, false);
        const forged = structuredClone(recipe) as Recipe & { plannerEligibility?: unknown };
        forged.plannerEligibility = { reviewed_completed_plated_main: true };
        equal(isDinnerWorthy(forged), false);
        const renamed = structuredClone(recipe);
        renamed.id = "unreviewed-sauce";
        equal(isDinnerWorthy(renamed), false);
        for (const reject of ["snack", "dessert", "condiment", "component"]) {
          const conflicting = structuredClone(recipe);
          conflicting.category!.meal_role = reject;
          equal(isDinnerWorthy(conflicting), false, reject);
          equal(classifyPlannerRole(conflicting).mainEligible, false, reject);
          equal(await saved(conflicting), 0, reject);
        }
      });
    });
  }
  it("evidence never bypasses declared reject categories, chapter exclusions or the ingredient minimum", () => {
    withReviewedPlannerEvidence(ready, () => {
      const dessertTyped = structuredClone(sunday);
      dessertTyped.category!.dish_type = ["dessert"];
      equal(isDinnerWorthy(dessertTyped), false); // digest differs AND dessert is excluded
      const fewIngredients = structuredClone(basic);
      fewIngredients.ingredients = fewIngredients.ingredients.slice(0, 2);
      equal(isDinnerWorthy(fewIngredients), false);
    });
  });
  it("an ordinary unreviewed one-step 'pasta' main stays ineligible — no global title or step-count bypass", () => {
    withReviewedPlannerEvidence(ready, () => {
      const generic: Recipe = {
        id: "unreviewed-one-step",
        name: "Tomato Pasta Sauce",
        category: { dish_type: ["main"], chapter: "Mains", meal_role: "main" },
        servings: "serves 2",
        ingredients: [{ item: "pasta", amount: "200 g" }, { item: "tomato", amount: "2" }, { item: "oil", amount: "1 tbsp" }],
        method: ["Mix and serve."],
      };
      equal(isDinnerWorthy(generic), false);
      equal(classifyPlannerRole(generic).mainEligible, false);
    });
  });
});

describe("controls: a hold record behaves identically with and without the ledger", () => {
  for (const id of ["anchovies-with-salsa-verde", "spicy-broccoli-and-herb-slaw", "not-so-southern-sausage-gravy", "tomato-salad-in-coconut-broth"]) {
    it(id, () => {
      const recipe = load(id);
      const withLedger = { dinner: isDinnerWorthy(recipe), role: classifyPlannerRole(recipe) };
      const without = withReviewedPlannerEvidence(emptyRegistry, () => ({ dinner: isDinnerWorthy(recipe), role: classifyPlannerRole(recipe) }));
      equal(JSON.stringify(withLedger), JSON.stringify(without));
    });
  }
});
