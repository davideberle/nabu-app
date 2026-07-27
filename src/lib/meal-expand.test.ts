// Unit tests for planner day-expansion assembly.
// Run with: npm test  (node --test; Node 24 strips types natively)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMealExpansion, type ExpansionRecipeResolver } from "./meal-expand.ts";
import type { RecipeLike } from "./meal-coherence.ts";

// ---------------------------------------------------------------------------
// Real corpus fixture
//
// The regression this file exists for is a data-shaped one, so it uses the
// actual bundle rather than a hand-written stand-in.
// ---------------------------------------------------------------------------

type BundleRecipe = RecipeLike & { source?: { cookbook?: string } };

const bundle: BundleRecipe[] = JSON.parse(
  readFileSync(join(import.meta.dirname, "../data/recipes-bundle.json"), "utf8")
);

/**
 * Mirrors HIDDEN_COOKBOOKS in ./recipes.ts. These cookbooks are filtered out of
 * `getAllRecipes` — the browsable collection — while `getRecipe` still resolves
 * them by id so explicit references keep working.
 */
const HIDDEN_COOKBOOKS = new Set([
  "Pasta for All Seasons",
  "Mexican Home Cooking",
  "Italian And Lebanese Cookbook",
  "The Complete Greek Cookbook",
  "Brunch Cookbook",
  "The Curry Guy Bible",
  "The Curry Guy",
  "The Authentic Greek Kitchen",
  "Vegan Nigerian Kitchen",
  "Falastin",
]);

const MISO_SOUP_ID = "cashew-and-miso-cream-soup";
const HIDDEN_MISO_SIDE_ID =
  "casarecce-with-miso-marinated-alaskan-black-cod-baby-bok-choy-and-black-sesame-s";

function fromBundle(id: string): BundleRecipe {
  const recipe = bundle.find((r) => r.id === id);
  ok(recipe, `fixture recipe ${id} is missing from the bundle`);
  return recipe;
}

/** What `getRecipe` does: resolve any recipe by id, hidden cookbooks included. */
const explicitResolver: ExpansionRecipeResolver = async (id) =>
  bundle.find((r) => r.id === id) ?? null;

/** The defect: resolving explicit references through the browsable collection. */
const browsableOnlyResolver: ExpansionRecipeResolver = async (id) =>
  bundle.find(
    (r) => r.id === id && !HIDDEN_COOKBOOKS.has(r.source?.cookbook ?? "")
  ) ?? null;

describe("explicit component resolution", () => {
  it("has a fixture that is genuinely hidden from browse surfaces", () => {
    const side = fromBundle(HIDDEN_MISO_SIDE_ID);
    ok(
      HIDDEN_COOKBOOKS.has(side.source?.cookbook ?? ""),
      "the fixture must come from a hidden cookbook for this test to mean anything"
    );
  });

  it("reviews a saved side from a hidden cookbook", async () => {
    const expansion = await buildMealExpansion({
      main: fromBundle(MISO_SOUP_ID),
      candidates: [],
      sideIds: [HIDDEN_MISO_SIDE_ID],
      serveWith: [],
      dayType: "weekday",
      resolveRecipe: explicitResolver,
    });

    deepStrictEqual(expansion.acceptedIds, [HIDDEN_MISO_SIDE_ID]);
    const miso = expansion.coherence.findings.find(
      (f) => f.kind === "seasoning-lane-repeat" && f.lane === "miso"
    );
    ok(miso, "miso in both the soup and the saved side must be reported");
    equal(miso.severity, "major");
    ok(miso.componentIds.includes(HIDDEN_MISO_SIDE_ID));
  });

  it("would miss it if explicit references went through the browsable collection", async () => {
    // Documents the failure mode this module was written to prevent: the side
    // silently disappears, so a repeated lane reads as a coherent meal.
    const expansion = await buildMealExpansion({
      main: fromBundle(MISO_SOUP_ID),
      candidates: [],
      sideIds: [HIDDEN_MISO_SIDE_ID],
      serveWith: [],
      dayType: "weekday",
      resolveRecipe: browsableOnlyResolver,
    });
    deepStrictEqual(expansion.acceptedIds, []);
    equal(expansion.coherence.severity, "none");
  });

  it("skips unresolvable ids and de-duplicates repeats without failing", async () => {
    const expansion = await buildMealExpansion({
      main: fromBundle(MISO_SOUP_ID),
      candidates: [],
      sideIds: [HIDDEN_MISO_SIDE_ID, HIDDEN_MISO_SIDE_ID, "no-such-recipe", ""],
      serveWith: [],
      dayType: "weekday",
      resolveRecipe: explicitResolver,
    });
    deepStrictEqual(expansion.acceptedIds, [HIDDEN_MISO_SIDE_ID]);
  });
});

// ---------------------------------------------------------------------------
// Recommended-set wiring
// ---------------------------------------------------------------------------

function recipe(id: string, name: string, items: string[], method: string[]): RecipeLike {
  return { id, name, ingredients: items.map((item) => ({ item })), method };
}

const PLAIN_MAIN = recipe(
  "grilled-sea-bass",
  "Grilled Lemon Sea Bass",
  ["sea bass fillets", "lemon", "olive oil", "parsley"],
  ["Grill the fillets skin-side down until just done."]
);
const SOY_CUCUMBER = recipe(
  "smashed-cucumber",
  "Smashed Cucumber with Soy & Sesame",
  ["cucumber", "soy sauce", "toasted sesame oil"],
  ["Smash, salt, then dress."]
);
const SOY_EDAMAME = recipe(
  "soy-edamame",
  "Edamame with Soy & Chilli",
  ["edamame", "soy sauce", "dried chilli flakes"],
  ["Steam and toss."]
);
const LEEKS = recipe(
  "leek-vinaigrette",
  "Leeks Vinaigrette",
  ["leeks", "dijon mustard", "olive oil", "red wine vinegar"],
  ["Simmer, then dress while warm."]
);

describe("recommended set", () => {
  it("recommends a set that holds together rather than three separate picks", async () => {
    const expansion = await buildMealExpansion({
      main: PLAIN_MAIN,
      candidates: [
        { role: "side", recipe: SOY_CUCUMBER },
        { role: "starter", recipe: SOY_EDAMAME },
        { role: "starter", recipe: LEEKS },
      ],
      sideIds: [],
      serveWith: [],
      dayType: "weekday",
      resolveRecipe: explicitResolver,
    });

    deepStrictEqual(expansion.recommendedIds, ["smashed-cucumber", "leek-vinaigrette"]);
    ok(
      !expansion.recommendedSet.review.findings.some(
        (f) => f.lane === "soy" && f.severity === "major"
      )
    );
  });

  it("recommends around what the day has already accepted", async () => {
    const accepted = { ...SOY_CUCUMBER, id: "accepted-cucumber" };
    const expansion = await buildMealExpansion({
      main: PLAIN_MAIN,
      candidates: [
        { role: "starter", recipe: SOY_EDAMAME },
        { role: "starter", recipe: LEEKS },
      ],
      sideIds: ["accepted-cucumber"],
      serveWith: ["Steamed rice"],
      dayType: "weekday",
      resolveRecipe: async (id) => (id === accepted.id ? accepted : null),
    });

    deepStrictEqual(expansion.recommendedIds, ["leek-vinaigrette"]);
    deepStrictEqual(expansion.acceptedIds, ["accepted-cucumber"]);
  });

  it("stays quiet when the accepted meal is coherent", async () => {
    const expansion = await buildMealExpansion({
      main: PLAIN_MAIN,
      candidates: [],
      sideIds: ["charred-broccoli"],
      serveWith: [],
      dayType: "weekday",
      resolveRecipe: async () =>
        recipe(
          "charred-broccoli",
          "Charred Broccoli with Almonds",
          ["tenderstem broccoli", "almonds", "olive oil"],
          ["Char in a hot pan."]
        ),
    });
    equal(expansion.coherence.severity, "none");
    deepStrictEqual(expansion.coherence.findings, []);
  });
});
