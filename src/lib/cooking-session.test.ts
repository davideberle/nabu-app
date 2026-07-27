// Unit tests for the pure Cooking Session contract module.
// Run with: npm test  (node --test; Node 24 strips types natively)

import { deepStrictEqual, equal, notEqual, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activeComponents,
  applyPatch,
  firstServingsClause,
  isCompleteOverride,
  mergeRelatedRecipes,
  normalizeSession,
  resolveMainDish,
  resolveSessionHero,
  resolveWorkingRecipe,
  setAsideComponents,
  syncSessionWithPlan,
  validatePatch,
  visibleServeWith,
  type CookingSession,
  type PlanSyncData,
  type SessionIngredient,
} from "./cooking-session.ts";

function ing(item: string, amount = "1"): SessionIngredient {
  return { amount, item };
}

function makeSession(overrides: Partial<CookingSession> = {}): CookingSession {
  return {
    id: "cook_2026-07-26_korean_family",
    date: "2026-07-26",
    status: "draft",
    source: "telegram",
    mealPlanRef: null,
    anchor: {
      type: "external-recipe",
      title: "Savoury Doenjang-Glazed Aubergine",
      provenance: {
        source: "Judy Joo — Doenjang-glazed grilled Asian aubergine",
        url: "https://example.com/doenjang-aubergine",
        author: "Judy Joo",
      },
    },
    main: null,
    heroImage: null,
    relatedRecipes: [
      { kind: "side", recipeId: "kimchi-pancakes", title: "Kimchi Pancakes" },
    ],
    serveWith: [
      "Gochujang-glazed salmon (700 g; mild soy-sesame glaze for the kids)",
      "Spicy cucumber salad (oi-muchim)",
      "Steamed Korean short-grain or sushi rice",
      "Kimchi pancakes — optional",
    ],
    servings: { base: "4", current: "4" },
    ingredients: {
      base: [
        ing("Asian aubergines", "3–4"),
        ing("doenjang", "80"),
        ing("honey", "20"),
        ing("garlic cloves, grated", "3"),
        ing("spring onions, thinly sliced", "2"),
        ing("soy sauce", "1"),
        ing("toasted sesame oil", "1"),
        ing("sesame seeds and gochugaru, to finish", ""),
      ],
      session: [
        ing("salmon fillets", "700"),
        ing("gochujang — adults only", "1.5"),
        ing("soy sauce — divided", "2"),
        ing("honey or maple syrup — divided", "2"),
        ing("toasted sesame oil — divided", "2"),
        ing("garlic clove, grated", "1"),
        ing("rice vinegar", "1"),
      ],
    },
    method: {
      base: [
        "Score the aubergine flesh, brush with oil and season lightly.",
        "Grill skin-side up, turn and grill until tender and golden.",
        "Whisk the glaze, spread over the flesh and grill until charred.",
      ],
      session: [
        "Start the rice, then prepare the aubergine and cucumber salad.",
        "Split the salmon: adult gochujang glaze, mild kids' glaze.",
        "Roast the salmon at 200°C for 10–13 minutes, then broil briefly.",
        "Skip the dubu-jorim tonight; keep the kimchi pancake optional.",
      ],
    },
    adaptations: [],
    coachCards: { nextMove: null, upgrade: null, shortcut: null, wine: null },
    story: null,
    notes: "",
    createdAt: "2026-07-25T06:55:00.418Z",
    updatedAt: "2026-07-26T17:09:24.250Z",
    ...overrides,
  };
}

const KOREAN_MAIN = {
  title: "Gochujang-Glazed Salmon",
  summary: "700 g; adult gochujang glaze, mild soy-sesame for the kids",
  setBy: "telegram" as const,
};

describe("normalizeSession", () => {
  it("defaults main and heroImage to null on legacy sessions", () => {
    const legacy = makeSession();
    delete (legacy as Record<string, unknown>)["main"];
    delete (legacy as Record<string, unknown>)["heroImage"];
    const normalized = normalizeSession(legacy);
    equal(normalized?.main, null);
    equal(normalized?.heroImage, null);
  });

  it("drops empty-titled mains and empty-url hero images", () => {
    const normalized = normalizeSession(
      makeSession({
        main: { title: "  " },
        heroImage: { url: "" },
      })
    );
    equal(normalized?.main, null);
    equal(normalized?.heroImage, null);
  });

  it("still migrates drink serve-with entries into coachCards.wine", () => {
    const normalized = normalizeSession(
      makeSession({ serveWith: ["Basmati rice", "Riesling, well chilled"] })
    );
    deepStrictEqual(normalized?.serveWith, ["Basmati rice"]);
    equal(normalized?.coachCards.wine, "Riesling, well chilled");
  });
});

describe("resolveMainDish", () => {
  it("falls back to the anchor when no explicit main is set", () => {
    const resolved = resolveMainDish(makeSession());
    equal(resolved.title, "Savoury Doenjang-Glazed Aubergine");
    equal(resolved.isExplicit, false);
    equal(resolved.anchorIsSecondary, false);
  });

  it("prefers an explicit main over the anchor", () => {
    const resolved = resolveMainDish(makeSession({ main: KOREAN_MAIN }));
    equal(resolved.title, "Gochujang-Glazed Salmon");
    equal(resolved.isExplicit, true);
    equal(resolved.anchorIsSecondary, true);
    equal(resolved.summary, KOREAN_MAIN.summary);
  });

  it("treats a main matching the anchor title as the same dish", () => {
    const resolved = resolveMainDish(
      makeSession({
        anchor: {
          type: "kitchen-recipe",
          recipeId: "doenjang-aubergine",
          title: "Savoury Doenjang-Glazed Aubergine",
          provenance: { source: "kitchen" },
        },
        main: { title: "savoury doenjang glazed aubergine" },
      })
    );
    equal(resolved.anchorIsSecondary, false);
    equal(resolved.recipeId, "doenjang-aubergine");
  });
});

describe("resolveSessionHero", () => {
  it("uses the stored recipe image when the main resolves to a recipe", () => {
    const session = makeSession({
      main: { ...KOREAN_MAIN, recipeId: "gochujang-salmon" },
      heroImage: { url: "/recipes/other.jpg" },
    });
    const hero = resolveSessionHero(session, "/recipes/gochujang-salmon.jpg");
    deepStrictEqual(hero, {
      kind: "image",
      url: "/recipes/gochujang-salmon.jpg",
      alt: "Gochujang-Glazed Salmon",
    });
  });

  it("uses the session hero image for external/ad-hoc mains", () => {
    const session = makeSession({
      main: KOREAN_MAIN,
      heroImage: { url: "/recipes/salmon-tonight.jpg", alt: "Tonight's salmon" },
    });
    const hero = resolveSessionHero(session, undefined);
    equal(hero.kind, "image");
    ok(hero.kind === "image" && hero.url === "/recipes/salmon-tonight.jpg");
  });

  it("never falls back to another dish's image — placeholder instead", () => {
    // The anchor (aubergine) may have an image, but the resolved main is the
    // salmon, so that image must not be used and no image means placeholder.
    const session = makeSession({ main: KOREAN_MAIN });
    const hero = resolveSessionHero(session, undefined);
    deepStrictEqual(hero, { kind: "placeholder", title: "Gochujang-Glazed Salmon" });
  });

  it("keeps the session hero when the recipe has no trusted image", () => {
    const session = makeSession({
      main: { ...KOREAN_MAIN, recipeId: "gochujang-salmon" },
      heroImage: { url: "/recipes/salmon-tonight.jpg" },
    });
    const hero = resolveSessionHero(session, null);
    ok(hero.kind === "image" && hero.url === "/recipes/salmon-tonight.jpg");
  });
});

describe("resolveWorkingRecipe", () => {
  it("renders session lists as the working recipe when the main is a different dish", () => {
    const working = resolveWorkingRecipe(makeSession({ main: KOREAN_MAIN }));
    equal(working.isSessionVersion, true);
    equal(working.ingredients[0].item, "salmon fillets");
    equal(working.method.length, 4);
    deepStrictEqual(working.ingredientAdjustments, []);
    deepStrictEqual(working.methodAdjustments, []);
  });

  it("uses the stored main recipe when an explicit main has no session lists", () => {
    const session = makeSession({
      main: { ...KOREAN_MAIN, recipeId: "gochujang-salmon" },
      ingredients: { base: makeSession().ingredients.base, session: [] },
      method: { base: makeSession().method.base, session: [] },
    });
    const working = resolveWorkingRecipe(session, {
      ingredients: [ing("salmon fillets", "700")],
      method: ["Roast the salmon."],
    });
    equal(working.isSessionVersion, false);
    equal(working.ingredients[0].item, "salmon fillets");
    deepStrictEqual(working.method, ["Roast the salmon."]);
  });

  it("keeps complete session overrides as the working recipe for the anchor main", () => {
    const working = resolveWorkingRecipe(makeSession());
    equal(working.isSessionVersion, true);
    equal(working.ingredients[0].item, "salmon fillets");
  });

  it("keeps short session lists as adjustments alongside the base recipe", () => {
    const session = makeSession({
      ingredients: {
        base: makeSession().ingredients.base,
        session: [ing("smoked paprika", "1")],
      },
      method: { base: makeSession().method.base, session: [] },
    });
    const working = resolveWorkingRecipe(session);
    equal(working.isSessionVersion, false);
    equal(working.ingredients[0].item, "Asian aubergines");
    equal(working.ingredientAdjustments[0].item, "smoked paprika");
  });
});

describe("isCompleteOverride", () => {
  it("empty session list is never an override", () => {
    equal(isCompleteOverride([], [1, 2]), false);
  });
  it("any session list overrides an empty base", () => {
    equal(isCompleteOverride([1], []), true);
  });
  it("needs at least 3 items covering half the base", () => {
    equal(isCompleteOverride([1, 2], [1, 2, 3, 4]), false);
    equal(isCompleteOverride([1, 2, 3], [1, 2, 3, 4, 5, 6]), true);
    equal(isCompleteOverride([1, 2, 3], [1, 2, 3, 4, 5, 6, 7]), false);
  });
});

describe("component status", () => {
  it("partitions active and set-aside components", () => {
    const session = makeSession({
      relatedRecipes: [
        { kind: "side", recipeId: "cucumber-salad", title: "Cucumber Salad" },
        { kind: "side", recipeId: "kimchi-pancakes", title: "Kimchi Pancakes", status: "optional" },
        { kind: "side", recipeId: "dubu-jorim", title: "Braised Tofu", status: "deferred" },
      ],
    });
    deepStrictEqual(activeComponents(session).map((r) => r.recipeId), ["cucumber-salad"]);
    deepStrictEqual(setAsideComponents(session).map((r) => r.recipeId), [
      "kimchi-pancakes",
      "dubu-jorim",
    ]);
  });
});

describe("visibleServeWith", () => {
  it("drops entries restating the main or a listed component, keeps real table items", () => {
    const session = makeSession({ main: KOREAN_MAIN });
    const visible = visibleServeWith(session, ["Kimchi Pancakes"]);
    deepStrictEqual(visible, [
      "Spicy cucumber salad (oi-muchim)",
      "Steamed Korean short-grain or sushi rice",
    ]);
  });

  it("drops drink entries", () => {
    const session = makeSession({ serveWith: ["Basmati rice", "Grüner Veltliner"] });
    deepStrictEqual(visibleServeWith(session, []), ["Basmati rice"]);
  });
});

describe("mergeRelatedRecipes", () => {
  it("preserves session-local non-active statuses when the plan re-adds a side", () => {
    const merged = mergeRelatedRecipes(
      [{ kind: "side", recipeId: "kimchi-pancakes", title: "Kimchi Pancakes" }],
      [{ kind: "side", recipeId: "kimchi-pancakes", title: "Kimchi Pancakes", status: "deferred" }]
    );
    equal(merged.length, 1);
    equal(merged[0].status, "deferred");
  });

  it("keeps session-only extras and plan-only additions", () => {
    const merged = mergeRelatedRecipes(
      [{ kind: "side" as const, recipeId: "a", title: "A" }],
      [{ kind: "side" as const, recipeId: "b", title: "B" }]
    );
    deepStrictEqual(merged.map((r) => r.recipeId), ["a", "b"]);
  });
});

function planData(overrides: Partial<PlanSyncData> = {}): PlanSyncData {
  return {
    weekId: "2026-W30",
    dayOfWeek: "Sunday",
    anchorType: "my-recipe",
    provenance: { source: "My Recipes" },
    recipe: {
      id: "korean-sunday-spread",
      name: "Korean Sunday Spread",
      servings: "4",
      ingredients: [ing("aubergine", "2")],
      method: ["Cook the spread."],
    },
    relatedRecipes: [
      { kind: "side", recipeId: "kimchi-pancakes", title: "Kimchi Pancakes" },
    ],
    serveWithFood: ["Steamed rice"],
    planDrink: null,
    ...overrides,
  };
}

describe("syncSessionWithPlan", () => {
  it("preserves explicit main, hero image, and session lists on resync", () => {
    const existing = makeSession({
      source: "meal-plan",
      anchor: {
        type: "my-recipe",
        recipeId: "korean-sunday-spread",
        title: "Korean Sunday Spread",
        provenance: { source: "My Recipes" },
      },
      main: KOREAN_MAIN,
      heroImage: { url: "/recipes/salmon-tonight.jpg" },
    });
    const synced = syncSessionWithPlan(existing, planData());
    deepStrictEqual(synced.main, KOREAN_MAIN);
    deepStrictEqual(synced.heroImage, { url: "/recipes/salmon-tonight.jpg" });
    equal(synced.ingredients.session[0].item, "salmon fillets");
    equal(synced.method.session.length, 4);
  });

  it("does not reactivate a deferred side on resync", () => {
    const existing = makeSession({
      source: "meal-plan",
      anchor: {
        type: "my-recipe",
        recipeId: "korean-sunday-spread",
        title: "Korean Sunday Spread",
        provenance: { source: "My Recipes" },
      },
      relatedRecipes: [
        { kind: "side", recipeId: "kimchi-pancakes", title: "Kimchi Pancakes", status: "deferred" },
      ],
    });
    const synced = syncSessionWithPlan(existing, planData());
    equal(synced.relatedRecipes[0].status, "deferred");
  });

  it("resets base lists and clears session lists when the plan main changed without an explicit main", () => {
    const existing = makeSession({
      source: "meal-plan",
      anchor: {
        type: "kitchen-recipe",
        recipeId: "old-recipe",
        title: "Old Recipe",
        provenance: { source: "kitchen" },
      },
    });
    const synced = syncSessionWithPlan(existing, planData());
    equal(synced.anchor.recipeId, "korean-sunday-spread");
    deepStrictEqual(synced.ingredients.session, []);
    deepStrictEqual(synced.method.session, []);
    equal(synced.ingredients.base[0].item, "aubergine");
  });

  it("keeps session lists across an anchor change when an explicit main owns them", () => {
    // The session lists are the explicit main's working recipe (e.g. the
    // salmon flow), so a plan-anchor swap must not clear them — but the base
    // lists still sync to the new anchor recipe.
    const existing = makeSession({
      source: "meal-plan",
      anchor: {
        type: "kitchen-recipe",
        recipeId: "old-recipe",
        title: "Old Recipe",
        provenance: { source: "kitchen" },
      },
      main: KOREAN_MAIN,
      heroImage: { url: "/recipes/salmon-tonight.jpg" },
      relatedRecipes: [
        { kind: "side", recipeId: "kimchi-pancakes", title: "Kimchi Pancakes", status: "deferred" },
      ],
    });
    const synced = syncSessionWithPlan(existing, planData());
    equal(synced.anchor.recipeId, "korean-sunday-spread");
    equal(synced.ingredients.session[0].item, "salmon fillets");
    equal(synced.method.session.length, 4);
    equal(synced.ingredients.base[0].item, "aubergine");
    deepStrictEqual(synced.method.base, ["Cook the spread."]);
    deepStrictEqual(synced.main, KOREAN_MAIN);
    deepStrictEqual(synced.heroImage, { url: "/recipes/salmon-tonight.jpg" });
    equal(synced.relatedRecipes[0].status, "deferred");
  });

  it("keeps user-adjusted servings when the plan main is unchanged", () => {
    const existing = makeSession({
      source: "meal-plan",
      anchor: {
        type: "my-recipe",
        recipeId: "korean-sunday-spread",
        title: "Korean Sunday Spread",
        provenance: { source: "My Recipes" },
      },
      servings: { base: "4", current: "6" },
    });
    const synced = syncSessionWithPlan(existing, planData());
    equal(synced.servings.current, "6");
    equal(synced.servings.base, "4");
  });
});

describe("firstServingsClause", () => {
  it("cuts jammed second clauses from corrupted source strings", () => {
    equal(firstServingsClause("serves 2 to 4makes about 8 fritters"), "serves 2 to 4");
    equal(firstServingsClause("makes 6each enough for a substantial snack"), "makes 6");
  });

  it("leaves clean servings strings untouched", () => {
    equal(firstServingsClause("serves 4"), "serves 4");
    equal(firstServingsClause("4 servings"), "4 servings");
    equal(firstServingsClause("6–8"), "6–8");
    equal(firstServingsClause("makes 2 small loaves"), "makes 2 small loaves");
    equal(firstServingsClause("makes 400g of sauce"), "makes 400g of sauce");
    equal(firstServingsClause(""), "");
  });
});

describe("patch validation and application", () => {
  it("accepts and applies an explicit main patch", () => {
    equal(validatePatch({ main: KOREAN_MAIN }), null);
    const updated = applyPatch(makeSession(), { main: KOREAN_MAIN });
    deepStrictEqual(updated.main, KOREAN_MAIN);
  });

  it("clears main and heroImage with null", () => {
    const session = makeSession({
      main: KOREAN_MAIN,
      heroImage: { url: "/x.jpg" },
    });
    const updated = applyPatch(session, { main: null, heroImage: null });
    equal(updated.main, null);
    equal(updated.heroImage, null);
  });

  it("rejects empty main titles and non-url hero images", () => {
    notEqual(validatePatch({ main: { title: "  " } }), null);
    notEqual(validatePatch({ heroImage: { url: "not-a-url" } }), null);
    equal(validatePatch({ heroImage: { url: "/recipes/x.jpg" } }), null);
    equal(validatePatch({ heroImage: { url: "https://example.com/x.jpg" } }), null);
  });

  it("rejects invalid component statuses", () => {
    notEqual(
      validatePatch({
        relatedRecipes: [
          {
            kind: "side",
            recipeId: "x",
            title: "X",
            status: "cancelled" as unknown as "active",
          },
        ],
      }),
      null
    );
    equal(
      validatePatch({
        relatedRecipes: [
          { kind: "side", recipeId: "x", title: "X", status: "deferred" },
        ],
      }),
      null
    );
  });
});
