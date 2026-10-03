// Reviewed planner evidence: canonical digest, pure SHA-256, registry shape
// and the trust rules of the shared match (stale / forged / conflicting
// evidence never activates). Run with: npm test (node --test).

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deepStrictEqual, equal, ok, throws } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertReviewedPlannerEvidenceRegistry,
  canonicalJson,
  canonicalRecipeDigest,
  hasReviewedPlatedMainEvidence,
  hasReviewedStarterEvidence,
  matchReviewedPlannerEvidence,
  reviewedMainCookingBlock,
  reviewedPlannerEvidenceRegistry,
  sha256Hex,
  withReviewedPlannerEvidence,
  type ReviewedPlannerEvidenceRegistry,
} from "./planner-evidence.ts";
import type { Recipe } from "./recipes.ts";

const here = dirname(fileURLToPath(import.meta.url));
const recipesDir = join(here, "..", "data", "recipes");
const loadRecipe = (id: string): Recipe => JSON.parse(readFileSync(join(recipesDir, `${id}.json`), "utf8"));
const nodeSha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

const REVIEW = "a".repeat(64);
function registryWith(exceptions: ReviewedPlannerEvidenceRegistry["plannerExceptions"]): ReviewedPlannerEvidenceRegistry {
  return {
    version: 1,
    owner: "test",
    reviewRecordSha256: REVIEW,
    canonicalization: "test",
    categoryCorrections: [],
    categoryHolds: [],
    plannerExceptions: exceptions,
  };
}
function mainEntry(recipe: Recipe, overrides: Partial<ReviewedPlannerEvidenceRegistry["plannerExceptions"][number]> = {}) {
  return {
    id: recipe.id,
    reviewedRole: "main" as const,
    projectedRecipeSha256: canonicalRecipeDigest(recipe),
    reviewRecordSha256: REVIEW,
    completedPlatedMain: true,
    multiActionSingleParagraph: true,
    cookingReady: true,
    evidence: [{ pointer: "/method/0", quote: "test" }],
    ...overrides,
  };
}

describe("sha256Hex (pure) equals node:crypto", () => {
  const samples = ["", "abc", "The quick brown fox", "ü–“”’ ½ ¼ ‘tsp’ 🍝".repeat(40), "x".repeat(55), "y".repeat(56), "z".repeat(64), "w".repeat(1000)];
  for (const sample of samples) {
    it(`matches for ${JSON.stringify(sample.slice(0, 12))}… (${sample.length} chars)`, () => {
      equal(sha256Hex(sample), nodeSha(sample));
    });
  }
  it("matches on canonical JSON of real records", () => {
    for (const id of ["basic-pasta-sauce", "sunday-sauce", "watercress-salad-with-quail-eggs-ricotta-and-seeds", "acha-pudding", "carrot-juice"]) {
      const text = canonicalJson(loadRecipe(id));
      equal(sha256Hex(text), nodeSha(text), id);
    }
  });
  it("is the well-known digest of 'abc'", () => {
    equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("canonicalJson", () => {
  it("is key-order independent at every depth and drops undefined", () => {
    equal(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: undefined } }), '{"a":{"d":[1,{"y":2,"z":1}]},"b":1}');
    equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }));
  });
  it("keeps array order and null", () => {
    equal(canonicalJson([3, null, "x"]), '[3,null,"x"]');
  });
  it("changes the digest when any field changes", () => {
    const recipe = loadRecipe("sunday-sauce");
    const edited = structuredClone(recipe);
    edited.method[0] += " ";
    ok(canonicalRecipeDigest(recipe) !== canonicalRecipeDigest(edited));
  });
});

describe("registry shape is validated fail-closed", () => {
  it("accepts the mirrored Kitchen ledger", () => {
    const registry = reviewedPlannerEvidenceRegistry();
    equal(registry.version, 1);
    equal(registry.plannerExceptions.length, 3);
    equal(registry.categoryCorrections.length, 30);
    equal(registry.categoryHolds.length, 20);
  });
  it("rejects a bad digest, a blocked entry without reason, duplicate ids, and a foreign review record", () => {
    const base = mainEntry(loadRecipe("sunday-sauce"));
    throws(() => assertReviewedPlannerEvidenceRegistry(registryWith([{ ...base, projectedRecipeSha256: "nope" }])), /digest/);
    throws(() => assertReviewedPlannerEvidenceRegistry(registryWith([{ ...base, cookingReady: false }])), /without a reason/);
    throws(() => assertReviewedPlannerEvidenceRegistry(registryWith([base, base])), /duplicate/);
    throws(() => assertReviewedPlannerEvidenceRegistry(registryWith([{ ...base, reviewRecordSha256: "b".repeat(64) }])), /different review record/);
    throws(() => assertReviewedPlannerEvidenceRegistry({ ...registryWith([]), version: 2 }), /version/);
  });
});

describe("matchReviewedPlannerEvidence trust rules", () => {
  const sauce = loadRecipe("sunday-sauce"); // reviewed category already applied in the deployable record
  equal(sauce.category?.meal_role, "main");

  it("matches exactly the attested record", () => {
    withReviewedPlannerEvidence(registryWith([mainEntry(sauce)]), () => {
      ok(matchReviewedPlannerEvidence(sauce));
      ok(hasReviewedPlatedMainEvidence(sauce));
    });
  });
  it("stale: any content edit deactivates the entry", () => {
    withReviewedPlannerEvidence(registryWith([mainEntry(sauce)]), () => {
      const edited = structuredClone(sauce);
      edited.method[0] += " Changed source.";
      equal(matchReviewedPlannerEvidence(edited), null);
      const relisted = structuredClone(sauce);
      relisted.ingredients.push({ item: "fettuccine", amount: "1 package" });
      equal(matchReviewedPlannerEvidence(relisted), null);
    });
  });
  it("forged: recipe-side flags, same id, cannot match the trusted digest", () => {
    withReviewedPlannerEvidence(registryWith([mainEntry(sauce)]), () => {
      const forged = structuredClone(sauce) as Recipe & { plannerEligibility?: unknown };
      forged.plannerEligibility = { reviewed_completed_plated_main: true };
      equal(matchReviewedPlannerEvidence(forged), null);
      const renamed = structuredClone(sauce);
      renamed.id = "unreviewed-sauce";
      equal(matchReviewedPlannerEvidence(renamed), null);
    });
  });
  it("conflicting: a declared role other than the reviewed one, or a competing top-level mealRole, never activates", () => {
    withReviewedPlannerEvidence(registryWith([mainEntry(sauce)]), () => {
      for (const role of ["side", "dessert", "snack", "condiment", "component"]) {
        const conflicting = structuredClone(sauce);
        conflicting.category!.meal_role = role;
        equal(matchReviewedPlannerEvidence(conflicting), null, role);
      }
      const topLevel = structuredClone(sauce);
      topLevel.mealRole = "side";
      equal(matchReviewedPlannerEvidence(topLevel), null);
    });
  });
  it("blocked main: matches but never unlocks the planner, and says why", () => {
    withReviewedPlannerEvidence(registryWith([mainEntry(sauce, { cookingReady: false, cookingBlockReason: "cheese and pasta quantities missing" })]), () => {
      ok(matchReviewedPlannerEvidence(sauce));
      equal(hasReviewedPlatedMainEvidence(sauce), false);
      equal(reviewedMainCookingBlock(sauce), "cheese and pasta quantities missing");
    });
  });
  it("a main entry is not starter evidence and vice versa", () => {
    const watercress = loadRecipe("watercress-salad-with-quail-eggs-ricotta-and-seeds");
    withReviewedPlannerEvidence(
      registryWith([
        mainEntry(sauce),
        { ...mainEntry(watercress), reviewedRole: "starter", completedPlatedMain: false, multiActionSingleParagraph: false },
      ]),
      () => {
        equal(hasReviewedStarterEvidence(sauce), false);
        equal(hasReviewedStarterEvidence(watercress), true);
        equal(hasReviewedPlatedMainEvidence(watercress), false);
      },
    );
  });
  it("the test override is scoped: the mirrored ledger is back afterwards", () => {
    withReviewedPlannerEvidence(registryWith([]), () => {
      equal(reviewedPlannerEvidenceRegistry().plannerExceptions.length, 0);
    });
    equal(reviewedPlannerEvidenceRegistry().plannerExceptions.length, 3);
  });
});

describe("the mirrored Kitchen ledger binds the deployable records", () => {
  const registry = reviewedPlannerEvidenceRegistry();
  for (const entry of registry.plannerExceptions) {
    it(`${entry.id}: digest and declared role match the shipped record`, () => {
      const recipe = loadRecipe(entry.id);
      equal(canonicalRecipeDigest(recipe), entry.projectedRecipeSha256);
      equal(recipe.category?.meal_role, entry.reviewedRole);
      deepStrictEqual(matchReviewedPlannerEvidence(recipe), entry);
    });
  }
  it("every correction and hold carries the reviewed category", () => {
    for (const entry of [...registry.categoryCorrections, ...registry.categoryHolds]) {
      const recipe = loadRecipe(entry.id);
      equal(recipe.category?.meal_role, entry.category.meal_role, entry.id);
      deepStrictEqual(recipe.category?.dish_type, entry.category.dish_type, entry.id);
    }
  });
  it("the two pasta mains are cooking-blocked; the starter is not a main", () => {
    const blocked = registry.plannerExceptions.filter((e) => e.reviewedRole === "main");
    equal(blocked.length, 2);
    ok(blocked.every((e) => e.cookingReady === false && e.cookingBlockReason));
    equal(registry.plannerExceptions.filter((e) => e.reviewedRole === "starter").length, 1);
  });
});
