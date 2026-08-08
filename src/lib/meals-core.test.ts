// Unit tests for the authoritative planner gate, bucket classifier, metadata
// normalizers, save-boundary sanitizer, and policy windows (Phase 3B).
// Run with: npm test  (node --test; Node 24 strips types natively)
//
// These exercise `meals-core.ts` directly — it carries no `@/` imports on
// purpose, so the test runner needs no path-alias resolution. The audit's
// named regressions are pinned against the real recipe bundle.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isMainPlannerCandidate,
  classifyPlannerBucket,
  normalizePlannerCuisine,
  normalizePlannerTitle,
  sanitizeCandidateItems,
  reclassifyCandidateItems,
  plannerPolicy,
  DEFAULT_PLANNER_POLICY,
  CANDIDATE_BUCKET_CONTRACT,
  CANDIDATE_BUCKET_ORDER,
  currentIsoWeekId,
  getRecentWeekIds,
} from "./meals-core.ts";
import type { Recipe } from "./recipes.ts";

const bundle: Recipe[] = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "data", "recipes-bundle.json"), "utf8"),
);

function fromBundle(id: string): Recipe {
  const recipe = bundle.find((r) => r.id === id);
  ok(recipe, `bundle recipe ${id} must exist`);
  return recipe!;
}

function makeRecipe(name: string, extra: Partial<Recipe> = {}): Recipe {
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name,
    servings: "4",
    ingredients: [
      { item: "onion", amount: "1" },
      { item: "olive oil", amount: "2 tbsp" },
      { item: "salt", amount: "" },
    ],
    method: ["Do the first thing.", "Do the second thing."],
    category: { dish_type: ["main"], chapter: "" },
    ...extra,
  };
}

describe("classifyPlannerBucket (authoritative)", () => {
  it("classifies Asparagus vichyssoise as soup (audit regression, real bundle recipe)", () => {
    equal(classifyPlannerBucket(fromBundle("asparagus-vichyssoise")), "soup");
  });

  it("classifies Smoked Turkey Pho as meat (audit regression, real bundle recipe)", () => {
    equal(classifyPlannerBucket(fromBundle("smoked-turkey-pho")), "meat");
  });

  it("keeps noodle-soup mains in their protein bucket", () => {
    equal(classifyPlannerBucket(makeRecipe("Chicken Ramen")), "meat");
  });

  it("recognizes named soup styles without a literal soup word", () => {
    equal(classifyPlannerBucket(makeRecipe("Tomato bisque")), "soup");
    equal(classifyPlannerBucket(makeRecipe("Summer gazpacho")), "soup");
  });

  it("classifies salads, fish, and vegetarian dishes", () => {
    equal(classifyPlannerBucket(makeRecipe("Fennel and orange salad")), "salad");
    equal(classifyPlannerBucket(makeRecipe("Grilled salmon with herbs")), "fish");
    equal(
      classifyPlannerBucket(makeRecipe("Roasted vegetable platter", { dietary: ["vegetarian"] })),
      "vegetarian",
    );
  });
});

describe("classifyPlannerBucket — production false positives (2026-08 dry-run audit, real bundle recipes)", () => {
  it("keeps vegan-cookbook mains vegetarian despite oyster-mushroom / analog-name triggers", () => {
    equal(classifyPlannerBucket(fromBundle("king-oyster-mushroom-scallops-with-coconut-rundown-risotto")), "vegetarian");
    equal(classifyPlannerBucket(fromBundle("grilled-eggplant")), "vegetarian");
    equal(classifyPlannerBucket(fromBundle("mushroom-hotpot")), "vegetarian");
    equal(classifyPlannerBucket(fromBundle("king-fakin-bacun")), "vegetarian");
    equal(classifyPlannerBucket(fromBundle("sorrel-hoisin-fried-chicken-burger")), "vegetarian");
    equal(classifyPlannerBucket(fromBundle("zesty-creamy-cajun-shrimp-pasta")), "vegetarian");
  });

  it("keeps Moroccan Shabbat Fish in fish — chicken bouillon granules are not meat", () => {
    equal(classifyPlannerBucket(fromBundle("moroccan-shabbat-fish")), "fish");
  });

  it("classifies an untagged curry with only fish-sauce seasoning as vegetarian", () => {
    equal(classifyPlannerBucket(fromBundle("curry-with-cashews-jackfruit")), "vegetarian");
  });

  it("keeps a real beef panang curry in meat (fish-sauce/shrimp-paste noise ignored)", () => {
    equal(classifyPlannerBucket(fromBundle("panang-curry")), "meat");
  });

  it("trusts vegan-book shorthand over plain analog ingredient names", () => {
    // The Vegan Korean writes "sausage, sliced" for its (vegan) sausage.
    equal(classifyPlannerBucket(fromBundle("budae-chigae")), "vegetarian");
  });

  it("real unmarked animal ingredients override corrupt vegetarian dietary tags", () => {
    // Bulk imports mis-tagged these real fish/poultry dishes as vegetarian.
    equal(classifyPlannerBucket(fromBundle("tandoori-whole-fish")), "fish");
    equal(classifyPlannerBucket(fromBundle("panfried-sea-bass-with-harissa-and-rose")), "fish");
    equal(classifyPlannerBucket(fromBundle("prawn-masala-curry")), "fish");
    equal(classifyPlannerBucket(fromBundle("harissa-and-preserved-lemon-roasted-poussins")), "meat");
  });

  it("recognizes proteins the legacy lexicon missed", () => {
    equal(classifyPlannerBucket(fromBundle("pan-fried-ribbonfish")), "fish");
    equal(classifyPlannerBucket(fromBundle("roast-spatchcock")), "meat");
    equal(classifyPlannerBucket(fromBundle("orecchiette-with-escarole-nduja-and-burrata")), "meat");
    equal(classifyPlannerBucket(fromBundle("clams-with-spring-onion-oil")), "fish");
  });

  it("keeps real lamb when the same ingredient line also mentions curry stock", () => {
    equal(classifyPlannerBucket(fromBundle("aloo-gosht")), "meat");
  });

  it("uses the earliest name protein when a title carries both fish and meat", () => {
    equal(classifyPlannerBucket(fromBundle("bowl-steamed-chicken-with-salted-fish")), "meat");
    equal(classifyPlannerBucket(fromBundle("prawn-and-chorizo-quesadilla")), "fish");
  });
});

describe("classifyPlannerBucket — analog/condiment/false-trigger rules (adversarial fixtures)", () => {
  const ing = (...items: string[]) =>
    items.map((item) => ({ item, amount: "1" }));

  it("stock/broth phrases in any form are never protein", () => {
    equal(
      classifyPlannerBucket(makeRecipe("Lemon herb risotto", {
        ingredients: ing("arborio rice", "broth (chicken or vegetable)", "parmesan"),
      })),
      "vegetarian",
    );
    equal(
      classifyPlannerBucket(makeRecipe("Mushroom bourguignon", {
        ingredients: ing("mushrooms", "beef stock", "red wine"),
      })),
      "vegetarian",
    );
  });

  it("vegan analog products are never protein, whatever the brand phrasing", () => {
    equal(
      classifyPlannerBucket(makeRecipe("Tempeh spring rolls", {
        ingredients: ing("rice paper", "pack Lightlife Smoky Bacon Tempeh ((170 g))", "hoisin"),
      })),
      "vegetarian",
    );
    equal(
      classifyPlannerBucket(makeRecipe("Arroz festival", {
        ingredients: ing("rice", "vegan chicken chunks ((see notes))", "sliced vegan sausages or chorizo ((see notes))"),
      })),
      "vegetarian",
    );
    equal(
      classifyPlannerBucket(makeRecipe("Loaded rice skillet", {
        ingredients: ing("rice", "Beyond Meat ground beef", "package Impossible brand sausage"),
      })),
      "vegetarian",
    );
  });

  it("vegetarian condiments do not create fish: chop-suey stays vegetarian", () => {
    equal(
      classifyPlannerBucket(makeRecipe("Easy chop suey stir-fried vegetables", {
        ingredients: ing("cabbage", "carrots", "vegetarian oyster sauce (or more to taste)"),
      })),
      "vegetarian",
    );
  });

  it("a vegan/vegetarian title is absolute", () => {
    equal(
      classifyPlannerBucket(makeRecipe("Vegan Arroz Valenciana", {
        ingredients: ing("rice", "sausages, sliced"),
      })),
      "vegetarian",
    );
  });

  it("quoted analog names carry no protein", () => {
    equal(
      classifyPlannerBucket(makeRecipe("Jerk ‘pork’ rice bowl", {
        ingredients: ing("rice", "jerk seasoning", "spring onions"),
      })),
      "vegetarian",
    );
  });

  it("plant-prefixed protein words are analogs", () => {
    equal(classifyPlannerBucket(makeRecipe("Watermelon tuna poke bowl")), "vegetarian");
    equal(classifyPlannerBucket(makeRecipe("Celeriac schnitzel with capers")), "vegetarian");
  });

  it("oyster in a mushroom context is the mushroom, not the shellfish — even untagged outside vegan cookbooks", () => {
    equal(
      classifyPlannerBucket(makeRecipe("Clay pot mushroom rice", {
        ingredients: ing("ounces assorted mushrooms (button, shiitake, oyster, crimini, enoki, king, etc.)", "jasmine rice", "napa cabbage"),
      })),
      "vegetarian",
    );
    equal(classifyPlannerBucket(makeRecipe("Oyster mushroom stir-fry with turmeric")), "vegetarian");
  });

  it("real proteins still win: name identity first, then ingredients", () => {
    equal(
      classifyPlannerBucket(makeRecipe("Roast chicken with fish sauce butter", {
        ingredients: ing("chicken thighs", "fish sauce", "butter"),
      })),
      "meat",
    );
    equal(
      classifyPlannerBucket(makeRecipe("Beef and oyster mushroom stir-fry", {
        ingredients: ing("beef strips", "oyster mushrooms"),
      })),
      "meat",
    );
    equal(classifyPlannerBucket(makeRecipe("Grilled oysters with garlic butter", {
      ingredients: ing("oysters, shucked", "garlic", "butter"),
    })), "fish");
    equal(classifyPlannerBucket(makeRecipe("Seared scallops with pea purée")), "fish");
    equal(classifyPlannerBucket(makeRecipe("Roast goose with apples")), "meat");
    equal(
      classifyPlannerBucket(makeRecipe("Fisherman's pot", {
        ingredients: ing("Two cups of fish stock", "One cup of mixed Mediterranean fish"),
      })),
      "fish",
    );
  });

  it("corrupt vegetarian tags lose to unmarked animal ingredients outside vegetarian cookbooks", () => {
    equal(
      classifyPlannerBucket(makeRecipe("Pan-roasted fillets", {
        dietary: ["vegetarian"],
        ingredients: ing("sea bass fillets, pin bones removed", "olive oil", "lemon"),
      })),
      "fish",
    );
  });

  it("scalloped potatoes and goat cheese never register as protein", () => {
    equal(classifyPlannerBucket(makeRecipe("Scalloped potato gratin")), "vegetarian");
    equal(
      classifyPlannerBucket(makeRecipe("Beet and goat cheese stack", {
        ingredients: ing("beets", "goat cheese", "walnuts"),
      })),
      "vegetarian",
    );
  });

  it("untagged dishes with zero protein evidence are vegetarian, not meat", () => {
    equal(classifyPlannerBucket(makeRecipe("Kohlrabi curry")), "vegetarian");
    equal(classifyPlannerBucket(makeRecipe("Instant pot red wine and beet risotto")), "vegetarian");
  });
});

describe("isMainPlannerCandidate (authoritative gate)", () => {
  it("accepts a plain main and rejects condiments/breakfast/drinks", () => {
    equal(isMainPlannerCandidate(makeRecipe("Braised chicken with olives")), true);
    equal(
      isMainPlannerCandidate(makeRecipe("Herb dressing", { category: { dish_type: ["condiment"], chapter: "" } })),
      false,
    );
    equal(
      isMainPlannerCandidate(makeRecipe("Morning granola", { category: { dish_type: ["breakfast"], chapter: "" } })),
      false,
    );
    equal(
      isMainPlannerCandidate(makeRecipe("Hibiscus cooler", { category: { dish_type: ["drink"], chapter: "" } })),
      false,
    );
  });

  it("rejects side-only dishes without a main/soup/salad role", () => {
    equal(
      isMainPlannerCandidate(makeRecipe("Roasted potatoes", { category: { dish_type: ["side"], chapter: "" } })),
      false,
    );
  });

  it("course-typed soups survive breakfast/snack prose in their intros (production false negatives)", () => {
    // All three carry dish_type "soup" + meal_role main; their intros mention
    // "snack foods" (annatto), "a long morning's skiing", "late-night snack".
    equal(isMainPlannerCandidate(fromBundle("spicy-hue-noodle-soup")), true);
    equal(isMainPlannerCandidate(fromBundle("pearl-barley-soup")), true);
    equal(isMainPlannerCandidate(fromBundle("chicken-congee")), true);
  });

  it("intro prose still excludes when no course/planner signal backs the recipe", () => {
    const prose = "This is ideal for a warming lunch after a long morning's skiing.";
    equal(
      isMainPlannerCandidate(makeRecipe("Hearty barley pot", {
        category: { dish_type: ["soup"], chapter: "", meal_role: "main" },
        introduction: prose,
      })),
      true,
    );
    equal(
      isMainPlannerCandidate(makeRecipe("Hearty barley pot", { introduction: prose })),
      false,
    );
  });

  it("Shanghai noodles stay out: blanket main labels don't beat the author's snack framing", () => {
    equal(isMainPlannerCandidate(fromBundle("shanghai-noodles-with-dried-shrimp-and-spring-onion-oil")), false);
  });

  it("planner-candidate visibility is user intent: light-meal names and intro prose don't override it", () => {
    const wrap = {
      category: { dish_type: ["main"], chapter: "", meal_role: "main" },
      introduction: "A crispy pan-toasted wrap — perfect for appetizers, brunch, or light dinner.",
    };
    equal(isMainPlannerCandidate(makeRecipe("Spinach feta tortilla wrap", wrap)), false);
    equal(
      isMainPlannerCandidate(makeRecipe("Spinach feta tortilla wrap", { ...wrap, visibility: "planner-candidate" })),
      true,
    );
  });

  it("snack-food identity names stay out even for planner candidates", () => {
    equal(
      isMainPlannerCandidate(makeRecipe("Air fryer zucchini chips", { visibility: "planner-candidate" })),
      false,
    );
  });

  it("rejects lunch/snack dish types and plural dessert names despite corrupt course labels", () => {
    equal(
      isMainPlannerCandidate(makeRecipe("Cheese quesadilla", { category: { dish_type: ["lunch"], chapter: "" } })),
      false,
    );
    equal(
      isMainPlannerCandidate(makeRecipe("Taco bites", { category: { dish_type: ["snack"], chapter: "" } })),
      false,
    );
    // Real bundle corruption: a cookie recipe labeled dish_type "salad".
    equal(isMainPlannerCandidate(fromBundle("orange-cranberry-power-cookies")), false);
  });

  it("rejects a pure condiment on dish_type alone, with no name-heuristic backup", () => {
    // "Preserved lemon gremolata" deliberately avoids every non-main name,
    // chapter, snack, breakfast, and dessert heuristic, so the `condiment`
    // dish_type exclusion is the only gate standing between it and dinner.
    const pureCondiment = makeRecipe("Preserved lemon gremolata", {
      category: { dish_type: ["condiment"], chapter: "" },
    });
    equal(isMainPlannerCandidate(pureCondiment), false);
    // Control: the identical recipe tagged main passes, proving no other
    // check rejects this fixture — remove `condiment` from the excluded
    // dish types and the assertion above fails.
    equal(isMainPlannerCandidate(makeRecipe("Preserved lemon gremolata")), true);
  });
});

describe("normalizePlannerTitle", () => {
  it("collapses whitespace and strips zero-width characters", () => {
    equal(normalizePlannerTitle("  Salade   Niçoise ​ "), "Salade Niçoise");
  });

  it("degrades malformed input to empty instead of inventing", () => {
    equal(normalizePlannerTitle(undefined), "");
    equal(normalizePlannerTitle(42), "");
  });
});

describe("normalizePlannerCuisine", () => {
  it("prefers the recipe's own cuisine with canonical casing", () => {
    equal(normalizePlannerCuisine(makeRecipe("x", { cuisine: ["  swiss "] })), "Swiss");
    equal(normalizePlannerCuisine(makeRecipe("x", { cuisine: "hungarian" })), "Hungarian");
  });

  it("takes the first segment of scraper multi-values", () => {
    equal(normalizePlannerCuisine(makeRecipe("x", { cuisine: "international, mediterranean" })), "International");
  });

  it("keeps unknown non-empty values verbatim after cleanup", () => {
    equal(normalizePlannerCuisine(makeRecipe("x", { cuisine: " Southeast  Asian " })), "Southeast Asian");
  });

  it("falls back to the cookbook mapping, then Other", () => {
    equal(
      normalizePlannerCuisine(makeRecipe("x", { cuisine: "", source: { cookbook: "Persiana", author: "" } })),
      "Middle Eastern",
    );
    equal(normalizePlannerCuisine(makeRecipe("x")), "Other");
  });
});

describe("sanitizeCandidateItems (save boundary)", () => {
  const exclusions = {
    recentlyCooked: new Set(["cooked"]),
    recentlyPlanned: new Set(["planned"]),
    recentlyOffered: new Set(["offered"]),
    negativeFeedback: new Set(["downvoted"]),
  };

  it("removes recently cooked/planned/offered and negative-feedback candidates", () => {
    const { items, removed } = sanitizeCandidateItems(
      [
        { recipeId: "fresh" },
        { recipeId: "cooked" },
        { recipeId: "planned" },
        { recipeId: "offered" },
        { recipeId: "downvoted" },
      ],
      new Set(),
      exclusions,
    );
    deepStrictEqual(items.map((i) => i.recipeId), ["fresh"]);
    deepStrictEqual(
      removed.map((r) => [r.recipeId, ...r.reasons]),
      [
        ["cooked", "recently-cooked"],
        ["planned", "recently-planned"],
        ["offered", "recently-offered"],
        ["downvoted", "negative-feedback"],
      ],
    );
  });

  it("keeps candidates assigned to a day of this plan (visible-but-disabled)", () => {
    const { items } = sanitizeCandidateItems(
      [{ recipeId: "cooked" }],
      new Set(["cooked"]),
      exclusions,
    );
    deepStrictEqual(items.map((i) => i.recipeId), ["cooked"]);
  });

  it("collapses duplicate candidate ids", () => {
    const { items, removed } = sanitizeCandidateItems(
      [{ recipeId: "fresh" }, { recipeId: "fresh" }],
      new Set(),
      exclusions,
    );
    equal(items.length, 1);
    deepStrictEqual(removed[0].reasons, ["duplicate"]);
  });

  it("has no positive-feedback input by design — preference cannot bypass exclusions", () => {
    // The exclusion sets are the only inputs; a thumbs-up carries no weight
    // here, so a recently cooked favourite is still removed.
    const { items } = sanitizeCandidateItems([{ recipeId: "cooked" }], new Set(), exclusions);
    equal(items.length, 0);
  });
});

describe("reclassifyCandidateItems (persisted labels never override)", () => {
  const vichyssoise = fromBundle("asparagus-vichyssoise");
  const condiment = makeRecipe("Herb dressing", { category: { dish_type: ["condiment"], chapter: "" } });
  const resolver = async (id: string) => {
    if (id === "asparagus-vichyssoise") return vichyssoise;
    if (id === "herb-dressing") return condiment;
    return undefined;
  };

  it("recomputes wrong persisted buckets from the classifier", async () => {
    const { items, relabeled } = await reclassifyCandidateItems(
      [{ recipeId: "asparagus-vichyssoise", recipeName: "Asparagus vichyssoise", bucket: "meat", cuisine: "Other" }],
      resolver,
    );
    equal(items[0].bucket, "soup");
    deepStrictEqual(relabeled, [{ recipeId: "asparagus-vichyssoise", from: "meat", to: "soup" }]);
  });

  it("drops resolved candidates that fail the planner-main gate", async () => {
    const { items, dropped } = await reclassifyCandidateItems(
      [{ recipeId: "herb-dressing", recipeName: "Herb dressing", bucket: "vegetarian" }],
      resolver,
    );
    equal(items.length, 0);
    deepStrictEqual(dropped[0].reasons, ["not-main-eligible"]);
  });

  it("keeps unresolvable candidates unchanged instead of inventing or destroying", async () => {
    const item = { recipeId: "ghost", recipeName: "Ghost", bucket: "fish" as const };
    const { items, dropped, relabeled } = await reclassifyCandidateItems([item], resolver);
    deepStrictEqual(items, [item]);
    equal(dropped.length, 0);
    equal(relabeled.length, 0);
  });
});

describe("plannerPolicy", () => {
  it("pins the documented default windows literally", () => {
    // Literal values on purpose: comparing against DEFAULT_PLANNER_POLICY
    // would pass even if a mutant changed the exported defaults.
    deepStrictEqual(DEFAULT_PLANNER_POLICY, {
      recentlyCookedDays: 45,
      recentWeeksLookback: 5,
      negativeFeedbackDays: 60,
    });
    deepStrictEqual(plannerPolicy({}), {
      recentlyCookedDays: 45,
      recentWeeksLookback: 5,
      negativeFeedbackDays: 60,
    });
  });

  it("accepts positive-integer env overrides and rejects junk", () => {
    equal(plannerPolicy({ PLANNER_NEGATIVE_FEEDBACK_DAYS: "90" }).negativeFeedbackDays, 90);
    equal(plannerPolicy({ PLANNER_NEGATIVE_FEEDBACK_DAYS: "-3" }).negativeFeedbackDays, 60);
    equal(plannerPolicy({ PLANNER_RECENTLY_COOKED_DAYS: "banana" }).recentlyCookedDays, 45);
  });
});

describe("candidate bucket contract", () => {
  it("pins the documented weekly contract literally", () => {
    deepStrictEqual([...CANDIDATE_BUCKET_CONTRACT], [3, 3, 2, 2, 2]);
    deepStrictEqual(CANDIDATE_BUCKET_ORDER, ["salad", "soup", "vegetarian", "fish", "meat"]);
    equal(CANDIDATE_BUCKET_CONTRACT.reduce((a, b) => a + b, 0), 12);
  });
});

describe("isMainPlannerCandidate — dessert/bread/component gate (2026-08 verification gaps)", () => {
  const ing = (...items: string[]) =>
    items.map((item) => ({ item, amount: "1" }));

  it("rejects desserts and breakfast pastries mislabeled dish_type main (real bundle records)", () => {
    for (const id of [
      "mother-s-kisses", "lemon-granita", "mulberry-granita", "apple-strudel",
      "cinnamon-rolls", "matcha-donuts", "potato-onion-donuts",
      "quick-croissants", "ham-and-cheese-croissants", "blueberry-scones",
      "bacon-and-cheese-scones", "hard-dough-cherry-bostock",
    ]) {
      equal(isMainPlannerCandidate(fromBundle(id)), false, id);
    }
  });

  it("rejects batch-yield confections and bulk components (real bundle records)", () => {
    for (const id of [
      "cherry-bars", "cinnamon-balls", "crunchy-nuts-and-seeds-protein-bars",
      "tropical-lemon-protein-bites", "protein-power-pistachio-bites",
      "besciamella", "garam-masala", "cumin-pickled-onions",
      "zesty-lime-chile-vinaigrette", "maria-s-ricotta", "pizza-dough",
    ]) {
      equal(isMainPlannerCandidate(fromBundle(id)), false, id);
    }
  });

  it("rejects FOOBY web-import bread/dessert records shaped like production rows", () => {
    // visibility "planner-candidate" comes from the weekly importer here, not
    // from a user decision about this dish; name/structural identity applies.
    const dinnerRolls = makeRecipe("Potato dinner rolls", {
      visibility: "planner-candidate",
      servings: "12",
      dietary: ["vegetarian"],
      ingredients: ing("white flour", "sugar", "parcel dry yeast", "dl milk", "mealy potatoes", "salt"),
    });
    equal(isMainPlannerCandidate(dinnerRolls), false);
    // Bread-object name alone is enough — no yeast line needed.
    const dinnerRollsNoYeast = { ...dinnerRolls, ingredients: ing("white flour", "milk", "mealy potatoes", "salt") };
    equal(isMainPlannerCandidate(dinnerRollsNoYeast), false);
    const tiramisu = makeRecipe("Vegan apricot tiramisu", {
      visibility: "planner-candidate",
      servings: "8",
      dietary: ["vegan"],
      ingredients: ing("white flour", "sugar", "apricots", "vegan quark substitute"),
    });
    equal(isMainPlannerCandidate(tiramisu), false);
  });

  it("yeast-dough roll batches are bread; yeastless and savory-titled rolls stay mains", () => {
    equal(
      isMainPlannerCandidate(makeRecipe("Potato rolls", {
        ingredients: ing("lukewarm water", "active dry yeast", "all-purpose flour", "mashed potato", "butter"),
      })),
      false,
    );
    equal(isMainPlannerCandidate(fromBundle("sausage-stuffed-cabbage-rolls")), true);
    equal(isMainPlannerCandidate(fromBundle("corn-spring-rolls")), true);
    equal(
      isMainPlannerCandidate(makeRecipe("The BEST Chicken Kathi rolls", {
        ingredients: ing("chicken breasts", "yogurt", "Kawan parathas"),
      })),
      true,
    );
    // A savory title identity survives even a from-scratch yeast dough.
    equal(
      isMainPlannerCandidate(makeRecipe("Chicken kathi rolls", {
        ingredients: ing("chicken breasts", "flour", "yeast", "yogurt"),
      })),
      true,
    );
  });

  it("savory mains with dessert-adjacent structure stay eligible (real bundle records)", () => {
    for (const id of [
      "eggplant-cheesecake", "fresh-clam-custard", "root-vegetable-pies",
      "ricotta-and-parmesan-tarts", "pizza-margherita", "sardinian-ravioli",
      "steamed-kimchi-buns", "meat-loaf-with-hardboiled-eggs",
      "gnocchi-roll-with-spinach", "safavid-style-beef-pastries",
      "spiced-beef-and-potato-cakes",
    ]) {
      equal(isMainPlannerCandidate(fromBundle(id)), true, id);
    }
  });
});

describe("isMainPlannerCandidate — title identity and curated trust beat incidental intro prose", () => {
  it("David's personal chicken tagine survives its 'tart' intro (production shape)", () => {
    const tagine = makeRecipe("Chicken Tagine with Rhubarb", {
      visibility: "personal",
      servings: "serves 4 to 6",
      category: { dish_type: ["main", "chicken", "stew"], chapter: "", meal_role: "main" },
      introduction:
        "A savoury rhubarb chicken tagine from Christian Seiler: tart poached rhubarb, green olives, cinnamon, turmeric and paprika balance the braised chicken.",
    });
    equal(isMainPlannerCandidate(tagine), true);
  });

  it("a savory protein title beats intro dessert vocabulary (real bundle false negatives)", () => {
    for (const id of [
      "lamb-chops-with-lemon-anchovy-butter",
      "steamed-chopped-pork-with-salted-fish",
      "steamed-pork-in-lotus-leaves",
      "broccoli-tofu-quiche",
      "stuffed-sardines-with-spicy-tomato-dagga",
    ]) {
      equal(isMainPlannerCandidate(fromBundle(id)), true, id);
    }
  });

  it("desserts without a savory title still lose to their intro (guard)", () => {
    for (const id of ["caramel-cream", "christmas-log", "chin-chin"]) {
      equal(isMainPlannerCandidate(fromBundle(id)), false, id);
    }
  });

  it("personal visibility alone is user intent: intro prose does not exclude", () => {
    const skillet = makeRecipe("Rhubarb and barley skillet", {
      visibility: "personal",
      introduction: "Sweet-tart rhubarb over barley — great after a morning at the market.",
    });
    equal(isMainPlannerCandidate(skillet), true);
    // Control: identical cookbook-style record stays excluded by the same intro.
    equal(isMainPlannerCandidate({ ...skillet, visibility: undefined }), false);
  });

  it("breakfast/snack intro framing still excludes protein-titled cookbook dishes", () => {
    equal(isMainPlannerCandidate(fromBundle("baked-shrimp-and-celery-toasts")), false);
  });
});

describe("classifyPlannerBucket — plant-prefixed meat-dish analogs", () => {
  const ing = (...items: string[]) =>
    items.map((item) => ({ item, amount: "1" }));

  it("chickpea/jackfruit gyros are vegetarian; real gyros/shawarma stay meat (real bundle records)", () => {
    equal(classifyPlannerBucket(fromBundle("greek-chickpea-gyros")), "vegetarian");
    equal(classifyPlannerBucket(fromBundle("greek-jackfruit-gyros")), "vegetarian");
    equal(classifyPlannerBucket(fromBundle("greek-chicken-gyros")), "meat");
    equal(classifyPlannerBucket(fromBundle("greek-slow-cooked-lamb-gyros")), "meat");
    equal(classifyPlannerBucket(fromBundle("lamb-shawarma")), "meat");
    equal(classifyPlannerBucket(fromBundle("sheet-pan-chicken-shawarma")), "meat");
  });

  it("plant prefixes neutralize meat-style dish words without masking real ones", () => {
    equal(classifyPlannerBucket(makeRecipe("Cauliflower shawarma bowls")), "vegetarian");
    equal(classifyPlannerBucket(makeRecipe("Jackfruit carnitas tacos")), "vegetarian");
    equal(classifyPlannerBucket(makeRecipe("Lentil kofta curry")), "vegetarian");
    equal(classifyPlannerBucket(makeRecipe("Mushroom gyros")), "vegetarian");
    equal(classifyPlannerBucket(makeRecipe("Chicken shawarma")), "meat");
    equal(
      classifyPlannerBucket(makeRecipe("Gyros with tzatziki", {
        ingredients: ing("pork shoulder", "tzatziki", "pita"),
      })),
      "meat",
    );
  });
});

describe("classifyPlannerBucket — compound fish species", () => {
  const ing = (...items: string[]) =>
    items.map((item) => ({ item, amount: "1" }));

  it("lingcod fettuccine classifies fish (real bundle record)", () => {
    equal(
      classifyPlannerBucket(fromBundle("fettuccine-with-pacific-northwest-lingcod-purple-cauliflower-castelvetrano-olive")),
      "fish",
    );
  });

  it("compound cod market names are fish; lookalike words are not", () => {
    equal(
      classifyPlannerBucket(makeRecipe("Weeknight fillet supper", {
        ingredients: ing("lingcod fillets", "lemon", "butter"),
      })),
      "fish",
    );
    equal(classifyPlannerBucket(makeRecipe("Roasted blackcod with miso")), "fish");
    equal(classifyPlannerBucket(makeRecipe("Lingonberry glazed tempeh")), "vegetarian");
  });
});

describe("classifyPlannerBucket — mushroom-context ordering", () => {
  const ing = (...items: string[]) =>
    items.map((item) => ({ item, amount: "1" }));

  it("mushroom 'scallops' outside vegan cookbooks stay vegetarian", () => {
    equal(
      classifyPlannerBucket(makeRecipe("King oyster mushroom scallops with garlic butter", {
        ingredients: ing("king oyster mushrooms", "garlic", "butter"),
      })),
      "vegetarian",
    );
    equal(classifyPlannerBucket(makeRecipe("Trumpet mushroom scallops")), "vegetarian");
    equal(
      classifyPlannerBucket(makeRecipe("Weeknight sheet pan dinner", {
        ingredients: ing("king oyster mushroom scallops", "asparagus", "olive oil"),
      })),
      "vegetarian",
    );
  });

  it("real scallops with mushrooms elsewhere in the recipe still classify fish", () => {
    equal(
      classifyPlannerBucket(makeRecipe("Seared scallops with mushroom cream sauce", {
        ingredients: ing("sea scallops", "mushrooms", "cream"),
      })),
      "fish",
    );
  });
});

describe("week id helpers", () => {
  it("derives the current ISO week id", () => {
    equal(currentIsoWeekId(new Date("2026-08-01T12:00:00Z")), "2026-W31");
  });

  it("walks recent weeks across year boundaries", () => {
    deepStrictEqual(getRecentWeekIds("2026-W02", 3), ["2026-W01", "2025-W52", "2025-W51"]);
  });
});
