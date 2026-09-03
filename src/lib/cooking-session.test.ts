// Unit tests for the pure Cooking Session contract module.
// Run with: npm test  (node --test; Node 24 strips types natively)

import { deepStrictEqual, equal, notEqual, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activeComponents,
  anchorProvenanceLabel,
  applyPatch,
  composeWorkingIngredients,
  duplicatesWorkingRecipe,
  firstServingsClause,
  isChatOriginText,
  isCompleteOverride,
  mergeRelatedRecipes,
  normalizeSession,
  orderedCookStack,
  recipeProvenanceLabel,
  resolveMainDish,
  resolveSessionCoherence,
  resolveSessionHero,
  resolveWorkingRecipe,
  reviewSessionCoherence,
  sessionRecipeIds,
  setAsideComponents,
  syncSessionWithPlan,
  validatePatch,
  validateSessionBody,
  visibleServeWith,
  visibleSessionNotes,
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
    equal(normalized?.preparationOrder, undefined);
  });

  it("preserves an explicit preparation order", () => {
    const normalized = normalizeSession(
      makeSession({ preparationOrder: ["crispy-roasted-chickpeas", "main"] }),
    );
    deepStrictEqual(normalized?.preparationOrder, ["crispy-roasted-chickpeas", "main"]);
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

// The 2026-08-03 incident fixture: a real external anchor (The Pasta Table)
// with the modest intended session changes — roasted peppers instead of the
// cherry tomatoes, lemon for brightness, salmon cooked separately on top.
function farfalleSession(overrides: Partial<CookingSession> = {}): CookingSession {
  return makeSession({
    id: "cook_2026-08-03_farfalle",
    date: "2026-08-03",
    anchor: {
      type: "external-recipe",
      title: "Slow Roasted Tomato & Mascarpone Farfalle",
      provenance: {
        source: "The Pasta Table",
        url: "https://www.thepastatable.com/post/slow-roasted-tomato-mascarpone-farfalle",
        author: "The Pasta Table",
      },
    },
    relatedRecipes: [],
    serveWith: [],
    ingredients: {
      base: [
        { amount: "1/2", item: "farfalle", unit: "lb" },
        { amount: "2", item: "cherry tomatoes, halved", unit: "pints" },
        { amount: "1/4", item: "extra virgin olive oil", unit: "cup" },
        { amount: "1/2", item: "shallot, chopped" },
        { amount: "8", item: "mascarpone", unit: "oz" },
      ],
      session: [
        {
          amount: "3",
          item: "already-roasted peppers, sliced into ribbons",
          replaces: "cherry tomatoes",
        },
        { amount: "1–2", item: "lemon juice", unit: "tsp" },
      ],
    },
    method: {
      base: [
        "Roast the tomatoes low and slow until soft and semi dry.",
        "Cook the pasta until al dente and reserve pasta water.",
        "Sauté the shallot and garlic, then stir in the mascarpone.",
        "Toss the pasta with the sauce, the tomatoes and basil, and serve.",
      ],
      // The peppers replace the tomatoes, so base steps 1 and 4 are no longer
      // instructions this cook can follow. A truthful session therefore writes
      // tonight's method out in full instead of appending to a method that
      // contradicts its own ingredient list — see live-cooking DESIGN.md §3
      // rule 11 and the 2026-08-03 incident.
      sessionMode: "override",
      session: [
        "Cook the farfalle until al dente and reserve pasta water.",
        "Season and cook the salmon steaks separately, then rest them.",
        "Sauté the shallot and garlic, warm the roasted peppers through, then stir in the mascarpone with pasta water.",
        "Toss with the pasta, squeeze the lemon over, and serve with the salmon on top.",
      ],
    },
    ...overrides,
  });
}

describe("resolveWorkingRecipe", () => {
  it("renders session lists as the working recipe when the main is a different dish", () => {
    const working = resolveWorkingRecipe(makeSession({ main: KOREAN_MAIN }));
    equal(working.isSessionVersion, true);
    equal(working.hasSessionChanges, true);
    equal(working.ingredients[0].item, "salmon fillets");
    equal(working.method.length, 4);
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
    equal(working.hasSessionChanges, false);
    equal(working.ingredients[0].item, "salmon fillets");
    deepStrictEqual(working.method.map((step) => step.text), ["Roast the salmon."]);
  });

  it("keeps complete session overrides as the working recipe for the anchor main", () => {
    const working = resolveWorkingRecipe(makeSession());
    equal(working.isSessionVersion, true);
    equal(working.ingredients[0].item, "salmon fillets");
  });

  it("integrates a minor substitution into one list and one method — no detached correction lists", () => {
    const working = resolveWorkingRecipe(farfalleSession());
    equal(working.hasSessionChanges, true);

    // One ingredient list: the peppers stand where the tomatoes stood, the
    // tomatoes are gone, and the lemon is appended. Nothing to merge mentally.
    const items = working.ingredients.map((row) => row.item);
    deepStrictEqual(items, [
      "farfalle",
      "already-roasted peppers, sliced into ribbons",
      "extra virgin olive oil",
      "shallot, chopped",
      "mascarpone",
      "lemon juice",
    ]);
    equal(working.ingredients[1].replacedItem, "cherry tomatoes, halved");
    equal(working.ingredients[1].tonight, true);
    equal(working.ingredients[5].tonight, true);
    equal(working.ingredients[5].replacedItem, undefined);

    // One procedural sequence — tonight's complete method, not the anchor
    // method with a step bolted on.
    deepStrictEqual(
      working.method.map((step) => step.text),
      [
        "Cook the farfalle until al dente and reserve pasta water.",
        "Season and cook the salmon steaks separately, then rest them.",
        "Sauté the shallot and garlic, warm the roasted peppers through, then stir in the mascarpone with pasta water.",
        "Toss with the pasta, squeeze the lemon over, and serve with the salmon on top.",
      ]
    );
  });

  // The 2026-08-03 incident, pinned in both directions.
  it("never instructs the cook to use an ingredient the substitution removed", () => {
    const working = resolveWorkingRecipe(farfalleSession());
    const method = working.method.map((step) => step.text).join(" ").toLowerCase();
    const items = working.ingredients.map((row) => row.item.toLowerCase());

    // The tomatoes are gone from the list, so nothing may tell the cook to
    // roast them or toss them in.
    ok(!items.some((item) => item.includes("cherry tomatoes")));
    ok(!/roast the tomatoes/.test(method), `method still roasts tomatoes: ${method}`);
    ok(!/\btomatoes\b/.test(method), `method still uses tomatoes: ${method}`);
    // And what IS in the list is what the method cooks.
    ok(/peppers/.test(method));
    ok(/salmon/.test(method));
    ok(/lemon/.test(method));
  });

  it("appends session steps only while the base instructions still hold", () => {
    // No ingredient change invalidates the base method here, so an extra step
    // continues the anchor sequence rather than replacing it.
    const session = farfalleSession({
      ingredients: {
        base: farfalleSession().ingredients.base,
        session: [{ amount: "1–2", item: "lemon juice", unit: "tsp" }],
      },
      method: {
        base: farfalleSession().method.base,
        sessionMode: "append",
        session: ["Squeeze the lemon over just before serving."],
      },
    });
    const working = resolveWorkingRecipe(session);
    equal(working.method.length, 5);
    deepStrictEqual(working.method.slice(0, 4).map((step) => step.text), session.method.base);
    equal(working.method[4].text, "Squeeze the lemon over just before serving.");
    equal(working.method[4].tonight, true);
    equal(working.method[3].tonight, undefined);
  });

  it("never mutates the anchor's verbatim base lists", () => {
    const session = farfalleSession();
    resolveWorkingRecipe(session);
    equal(session.ingredients.base[1].item, "cherry tomatoes, halved");
    equal(session.ingredients.base.length, 5);
    equal(session.method.base.length, 4);
  });
});

describe("composeWorkingIngredients", () => {
  const base: SessionIngredient[] = [
    { amount: "2", item: "cherry tomatoes, halved", unit: "pints" },
    { amount: "1", item: "tomato paste", unit: "tbsp" },
    { amount: "8", item: "mascarpone", unit: "oz", group: "Sauce" },
  ];

  it("substitutes the named base row in place, not the lookalike", () => {
    const result = composeWorkingIngredients(base, [
      { amount: "3", item: "roasted peppers", replaces: "cherry tomatoes" },
    ]);
    deepStrictEqual(
      result.map((row) => row.item),
      ["roasted peppers", "tomato paste", "mascarpone"]
    );
    equal(result[0].replacedItem, "cherry tomatoes, halved");
  });

  it("re-quantifies a same-named item in place without a replaced hint", () => {
    const result = composeWorkingIngredients(base, [
      { amount: "150", item: "mascarpone", unit: "g" },
    ]);
    equal(result.length, 3);
    equal(result[2].amount, "150");
    equal(result[2].tonight, true);
    equal(result[2].replacedItem, undefined);
    // The substituted row stays in its base group.
    equal(result[2].group, "Sauce");
  });

  it("appends unmatched entries as additions and drops blank noise", () => {
    const result = composeWorkingIngredients(base, [
      { amount: "1", item: "lemon" },
      { amount: "", item: "   " },
    ]);
    equal(result.length, 4);
    equal(result[3].item, "lemon");
    equal(result[3].tonight, true);
  });

  it("removes a base row for an omission (blank item + replaces)", () => {
    const result = composeWorkingIngredients(base, [
      { amount: "", item: "", replaces: "tomato paste" },
    ]);
    deepStrictEqual(
      result.map((row) => row.item),
      ["cherry tomatoes, halved", "mascarpone"]
    );
  });

  it("an omission of something absent is a no-op", () => {
    const result = composeWorkingIngredients(base, [
      { amount: "", item: "", replaces: "saffron" },
    ]);
    equal(result.length, 3);
  });

  // Regression: fuzzy containment is a reading of an explicit `replaces`, never
  // of a plain addition. Without this, adding salt deleted the salted butter
  // and adding lemon deleted the lemon zest — an ingredient the cook still
  // needs silently vanished from the only list they can see.
  it("an addition without `replaces` never fuzzy-replaces a base row", () => {
    const pantry: SessionIngredient[] = [
      { amount: "100", item: "salted butter", unit: "g" },
      { amount: "1", item: "lemon zest" },
      { amount: "200", item: "flour", unit: "g" },
    ];

    const withSalt = composeWorkingIngredients(pantry, [{ amount: "1", item: "salt", unit: "tsp" }]);
    deepStrictEqual(
      withSalt.map((row) => row.item),
      ["salted butter", "lemon zest", "flour", "salt"]
    );
    equal(withSalt[3].tonight, true);
    equal(withSalt[3].replacedItem, undefined);

    const withLemon = composeWorkingIngredients(pantry, [{ amount: "1", item: "lemon" }]);
    deepStrictEqual(
      withLemon.map((row) => row.item),
      ["salted butter", "lemon zest", "flour", "lemon"]
    );
    equal(withLemon[0].tonight, undefined);
    equal(withLemon[1].tonight, undefined);
  });

  it("an explicit `replaces` still matches by containment", () => {
    const pantry: SessionIngredient[] = [
      { amount: "100", item: "salted butter", unit: "g" },
      { amount: "1", item: "lemon zest" },
    ];
    const result = composeWorkingIngredients(pantry, [
      { amount: "100", item: "olive oil", unit: "ml", replaces: "butter" },
    ]);
    deepStrictEqual(result.map((row) => row.item), ["olive oil", "lemon zest"]);
    equal(result[0].replacedItem, "salted butter");
  });

  it("an addition may still re-quantify the same ingredient by exact or core name", () => {
    const byExact = composeWorkingIngredients(base, [
      { amount: "150", item: "mascarpone", unit: "g" },
    ]);
    equal(byExact.length, 3);
    equal(byExact[2].amount, "150");

    const byCore = composeWorkingIngredients(base, [
      { amount: "3", item: "cherry tomatoes, quartered", unit: "pints" },
    ]);
    equal(byCore.length, 3);
    equal(byCore[0].amount, "3");
    equal(byCore[0].item, "cherry tomatoes, quartered");
  });

  it("two session entries never claim the same base row", () => {
    const result = composeWorkingIngredients(base, [
      { amount: "3", item: "roasted peppers", replaces: "tomatoes" },
      { amount: "1", item: "sun-dried tomatoes", replaces: "tomatoes" },
    ]);
    // First entry claims the cherry tomatoes; the second matches no free row
    // by core name — "tomato paste" is a different core — so it appends.
    deepStrictEqual(
      result.map((row) => row.item),
      ["roasted peppers", "tomato paste", "mascarpone", "sun-dried tomatoes"]
    );
  });
});

describe("isCompleteOverride", () => {
  it("empty session list is never an override", () => {
    equal(isCompleteOverride([], [1, 2]), false);
  });
  it("any session list overrides an empty base", () => {
    equal(isCompleteOverride([1], []), true);
  });
  it("needs at least 3 items covering half the base when no mode is set", () => {
    equal(isCompleteOverride([1, 2], [1, 2, 3, 4]), false);
    equal(isCompleteOverride([1, 2, 3], [1, 2, 3, 4, 5, 6]), true);
    equal(isCompleteOverride([1, 2, 3], [1, 2, 3, 4, 5, 6, 7]), false);
  });

  // An explicit mode is what the runtime should set; the length heuristic
  // cannot tell a one-step override from a one-step addition, and the
  // 2026-08-03 farfalle session was exactly that case.
  it("an explicit mode decides, whatever the lengths are", () => {
    equal(isCompleteOverride([1], [1, 2, 3, 4], "override"), true);
    equal(isCompleteOverride([1, 2, 3, 4, 5], [1, 2], "append"), false);
  });

  it("an empty session list is never an override, even when marked", () => {
    equal(isCompleteOverride([], [1, 2], "override"), false);
    equal(isCompleteOverride([], [], "override"), false);
  });

  it("legacy rows with no mode keep their previous behaviour exactly", () => {
    equal(isCompleteOverride([1], [], undefined), true);
    equal(isCompleteOverride([1, 2], [1, 2, 3, 4], undefined), false);
    equal(isCompleteOverride([1, 2, 3], [1, 2, 3, 4, 5, 6], undefined), true);
  });
});

describe("recipe provenance (rule 10)", () => {
  it("renders the real anchor source for an external recipe", () => {
    equal(
      anchorProvenanceLabel(farfalleSession()),
      // Author repeats the source, so the label is the source alone.
      "The Pasta Table"
    );
  });

  it("joins source and author when they differ", () => {
    equal(
      recipeProvenanceLabel({ source: "Ottolenghi Simple", author: "Yotam Ottolenghi" }),
      "Ottolenghi Simple · Yotam Ottolenghi"
    );
  });

  it("never renders chat-origin metadata as recipe provenance", () => {
    equal(
      recipeProvenanceLabel({
        source: "Tonight's meal as confirmed by David in Telegram",
      }),
      null
    );
    equal(recipeProvenanceLabel({ source: "kitchen", author: "via Telegram" }), null);
    equal(recipeProvenanceLabel({ source: "updated live from the cooking chat" }), null);
  });

  it("a synthesized plan has no recipe provenance at all", () => {
    const session = farfalleSession({
      anchor: {
        type: "synthesized-plan",
        title: "Farfalle with Mascarpone, Roasted Peppers and Salmon Steak",
        provenance: { source: "Nabu" },
      },
    });
    equal(anchorProvenanceLabel(session), null);
    // The best available recipe truth still renders: the title and lists.
    equal(resolveMainDish(session).title, session.anchor.title);
    ok(resolveWorkingRecipe(session).ingredients.length > 0);
  });

  it("flags chat wording, not chefs or publications", () => {
    equal(isChatOriginText("The Pasta Table"), false);
    equal(isChatOriginText("Jamie Oliver — Wonderful Veg Tagine"), false);
    equal(isChatOriginText("Tonight's meal as confirmed by David in Telegram"), true);
    equal(isChatOriginText("set via chat while shopping"), true);
  });

  it("drops a chat-origin hero credit but keeps the truthful image", () => {
    const hero = resolveSessionHero(
      farfalleSession({
        heroImage: {
          url: "https://example.com/farfalle.jpg",
          source: "sent by Nabu in Telegram",
        },
      }),
      null
    );
    equal(hero.kind, "image");
    if (hero.kind === "image") {
      equal(hero.url, "https://example.com/farfalle.jpg");
      equal(hero.source, undefined);
    }
  });
});

describe("visibleSessionNotes", () => {
  const working = resolveWorkingRecipe(farfalleSession());
  const adaptations = [
    {
      id: "adapt-1",
      kind: "ingredient-substitution" as const,
      summary:
        "Use three already-roasted peppers instead of the slow-roasted cherry tomatoes; brighten with lemon.",
      createdAt: "2026-08-03T15:55:00.000Z",
    },
  ];

  it("hides a note that duplicates the integrated working recipe", () => {
    equal(
      visibleSessionNotes(
        "Use the already-roasted peppers instead of the cherry tomatoes tonight.",
        working,
        adaptations
      ),
      null
    );
  });

  it("hides a note that restates an appended session step", () => {
    equal(
      visibleSessionNotes(
        "Cook the salmon steaks separately and serve them on top of the pasta.",
        working,
        adaptations
      ),
      null
    );
  });

  it("keeps a genuinely new note", () => {
    equal(
      visibleSessionNotes("Guests arrive at seven — table outside if warm.", working, adaptations),
      "Guests arrive at seven — table outside if warm."
    );
  });

  it("still drops drink, backstory, filler, and short noise lines", () => {
    equal(visibleSessionNotes("Pairs well with a crisp Riesling", working), null);
    equal(visibleSessionNotes("Backstory: an old Roman classic", working), null);
    equal(visibleSessionNotes("Enjoy the meal!", working), null);
    equal(visibleSessionNotes("ok", working), null);
  });

  it("filters per line, keeping the useful ones", () => {
    equal(
      visibleSessionNotes(
        "Enjoy!\nGuests arrive at seven — table outside if warm.",
        working
      ),
      "Guests arrive at seven — table outside if warm."
    );
  });

  it("duplicate detection requires real substance", () => {
    // Two meaningful tokens are not enough to call a note a duplicate.
    equal(duplicatesWorkingRecipe("lemon pasta", working), false);
  });
});

describe("historical malformed and synthesized sessions fail safely", () => {
  it("the incident shape renders best-available truth with no invented provenance", () => {
    // As synthesized on 2026-08-03: chat-origin provenance, no real anchor.
    const incident = farfalleSession({
      anchor: {
        type: "synthesized-plan",
        title: "Farfalle with Mascarpone, Roasted Peppers and Salmon Steak",
        provenance: { source: "Tonight's meal as confirmed by David in Telegram" },
      },
    });
    equal(anchorProvenanceLabel(incident), null);
    const working = resolveWorkingRecipe(incident);
    ok(working.ingredients.length > 0, "the lists still render");
    ok(working.method.length > 0);
  });

  it("a session with empty lists still resolves an empty working recipe, not a crash", () => {
    const bare = farfalleSession({
      ingredients: { base: [], session: [] },
      method: { base: [], session: [] },
    });
    const working = resolveWorkingRecipe(bare);
    deepStrictEqual(working.ingredients, []);
    deepStrictEqual(working.method, []);
    equal(working.hasSessionChanges, false);
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

describe("orderedCookStack", () => {
  it("uses the stable main → secondary anchor → active related fallback", () => {
    const session = makeSession({
      main: KOREAN_MAIN,
      relatedRecipes: [
        { kind: "side", recipeId: "cucumber-salad", title: "Cucumber Salad" },
        { kind: "side", recipeId: "kimchi-pancakes", title: "Kimchi Pancakes", status: "deferred" },
        { kind: "dessert", recipeId: "pear-tart", title: "Pear Tart" },
      ],
    });
    deepStrictEqual(orderedCookStack(session), [
      { kind: "main", ref: "main" },
      { kind: "anchor", ref: null },
      { kind: "related", ref: "cucumber-salad" },
      { kind: "related", ref: "pear-tart" },
    ]);
  });

  it("puts explicitly ordered chickpeas before the cauliflower main", () => {
    const session = makeSession({
      anchor: {
        type: "kitchen-recipe",
        recipeId: "roasted-cauliflower-with-sultanas-and-pecan-brown-butter",
        title: "Roasted Cauliflower with Sultanas and Pecan Brown Butter",
        provenance: { source: "Plentiful" },
      },
      relatedRecipes: [
        {
          kind: "side",
          recipeId: "crispy-roasted-chickpeas",
          title: "Crispy Roasted Chickpeas",
        },
      ],
      preparationOrder: ["crispy-roasted-chickpeas", "main"],
    });
    deepStrictEqual(orderedCookStack(session), [
      { kind: "related", ref: "crispy-roasted-chickpeas" },
      { kind: "main", ref: "main" },
    ]);
  });

  it("ignores stale references and appends omitted active dishes in fallback order", () => {
    const session = makeSession({
      relatedRecipes: [
        { kind: "side", recipeId: "first-side", title: "First Side" },
        { kind: "side", recipeId: "second-side", title: "Second Side" },
      ],
      preparationOrder: ["stale-recipe", "second-side"],
    });
    deepStrictEqual(orderedCookStack(session), [
      { kind: "related", ref: "second-side" },
      { kind: "main", ref: "main" },
      { kind: "related", ref: "first-side" },
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
      preparationOrder: ["kimchi-pancakes", "main"],
    });
    const synced = syncSessionWithPlan(existing, planData());
    deepStrictEqual(synced.main, KOREAN_MAIN);
    deepStrictEqual(synced.heroImage, { url: "/recipes/salmon-tonight.jpg" });
    equal(synced.ingredients.session[0].item, "salmon fillets");
    equal(synced.method.session.length, 4);
    deepStrictEqual(synced.preparationOrder, ["kimchi-pancakes", "main"]);
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

  it("validates and persists preparation order, including an empty reset", () => {
    equal(validatePatch({ preparationOrder: ["crispy-roasted-chickpeas", "main"] }), null);
    const updated = applyPatch(makeSession(), {
      preparationOrder: [" crispy-roasted-chickpeas ", "main"],
    });
    deepStrictEqual(updated.preparationOrder, ["crispy-roasted-chickpeas", "main"]);
    deepStrictEqual(applyPatch(updated, { preparationOrder: [] }).preparationOrder, []);

    notEqual(validatePatch({ preparationOrder: ["main", "main"] }), null);
    notEqual(validatePatch({ preparationOrder: ["main", "  "] }), null);
    notEqual(
      validatePatch({ preparationOrder: "main" as unknown as string[] }),
      null,
    );
  });

  it("accepts session lists with substitutions and rejects malformed ones", () => {
    equal(
      validatePatch({
        ingredients: {
          session: [
            { amount: "3", item: "roasted peppers", replaces: "cherry tomatoes" },
          ],
        },
        method: { session: ["Cook the salmon separately."] },
      }),
      null
    );
    notEqual(
      validatePatch({
        ingredients: {
          session: [{ amount: "3" } as unknown as SessionIngredient],
        },
      }),
      null
    );
    notEqual(
      validatePatch({
        ingredients: {
          session: [
            { amount: "3", item: "peppers", replaces: 7 as unknown as string },
          ],
        },
      }),
      null
    );
    notEqual(
      validatePatch({
        method: { session: [42 as unknown as string] },
      }),
      null
    );
  });

  it("a patched substitution round-trips through applyPatch into the working recipe", () => {
    const session = farfalleSession({
      ingredients: { base: farfalleSession().ingredients.base, session: [] },
      method: { base: farfalleSession().method.base, session: [] },
    });
    const patch = {
      ingredients: {
        session: [
          {
            amount: "3",
            item: "already-roasted peppers",
            replaces: "cherry tomatoes",
          },
        ],
      },
    };
    equal(validatePatch(patch), null);
    const working = resolveWorkingRecipe(applyPatch(session, patch));
    equal(working.ingredients[1].item, "already-roasted peppers");
    equal(working.ingredients[1].replacedItem, "cherry tomatoes, halved");
  });
});

describe("reviewSessionCoherence", () => {
  it("reviews the session as one meal and never touches the anchor base lists", () => {
    const session = makeSession({
      main: KOREAN_MAIN,
      relatedRecipes: [
        { kind: "side", recipeId: "kimchi-pancakes", title: "Kimchi Pancakes" },
        { kind: "side", recipeId: "cold-kimchi", title: "Cold Kimchi" },
      ],
    });
    const baseBefore = JSON.parse(JSON.stringify(session.ingredients.base));
    const methodBefore = JSON.parse(JSON.stringify(session.method.base));

    const review = reviewSessionCoherence(session);

    ok(review.findings.length > 0, "the Korean session is not coherent as-is");
    deepStrictEqual(session.ingredients.base, baseBefore);
    deepStrictEqual(session.method.base, methodBefore);
  });

  it("reads tonight's session glaze, not the anchor's, for the resolved main", () => {
    const session = makeSession({ main: KOREAN_MAIN });
    const review = reviewSessionCoherence(session);
    // The salmon session list carries soy and gochujang; the doenjang
    // aubergine anchor carries soy and doenjang. Both lanes must resolve to
    // the salmon, which is tonight's main.
    equal(
      review.laneOwners.find((o) => o.lane === "gochujang")?.componentTitle,
      "Gochujang-Glazed Salmon"
    );
    equal(
      review.laneOwners.find((o) => o.lane === "soy")?.componentTitle,
      "Gochujang-Glazed Salmon"
    );
  });

  it("proposes only session-scoped adjustments", () => {
    const session = makeSession({ main: KOREAN_MAIN });
    const review = reviewSessionCoherence(session);
    for (const suggestion of review.suggestions) {
      ok(
        ["component-status", "seasoning", "session-note"].includes(
          suggestion.adjustment.target
        ),
        `unexpected adjustment target: ${suggestion.adjustment.target}`
      );
    }
  });

  it("does not review a serve-with line that restates the main or a component", () => {
    // The Korean session lists the salmon and the kimchi pancakes in
    // serveWith as well. Counting those lines again made the review tell the
    // cook to reseason the main so the main could own its own lane, and put
    // the set-aside pancake back on the plate as a fried ferment dish.
    const session = makeSession({
      main: KOREAN_MAIN,
      relatedRecipes: [
        {
          kind: "side",
          recipeId: "kimchi-pancakes",
          title: "Kimchi Pancakes",
          status: "optional",
        },
      ],
    });
    const review = reviewSessionCoherence(session);

    equal(
      review.laneOwners.find((o) => o.lane === "gochujang")?.componentTitle,
      "Gochujang-Glazed Salmon"
    );
    ok(
      !review.suggestions.some((s) => /salmon/i.test(s.componentTitle ?? "")),
      "the main must never be told to reseason itself"
    );
    ok(
      !review.findings.some((f) => f.lane === "ferment"),
      "an optional component's serve-with line must not re-enter the plate"
    );
    ok(
      !review.findings.some((f) => f.kind === "fried-repeat"),
      "the omitted pancake is not fried tonight"
    );
  });

  it("excludes components that were already set aside", () => {
    const session = makeSession({
      main: KOREAN_MAIN,
      relatedRecipes: [
        {
          kind: "side",
          recipeId: "kimchi-pancakes",
          title: "Kimchi Pancakes",
          status: "omitted",
        },
      ],
    });
    const review = reviewSessionCoherence(session);
    ok(review.setAsideIds.includes("kimchi-pancakes"));
    ok(!review.suggestions.some((s) => s.componentId === "kimchi-pancakes"));
  });

  it("uses looked-up recipes for component ingredients when available", () => {
    const session = makeSession({
      main: null,
      ingredients: { base: [ing("cod fillets"), ing("white miso")], session: [] },
      method: { base: ["Grill until just done."], session: [] },
      anchor: {
        type: "kitchen-recipe",
        recipeId: "miso-cod",
        title: "Miso-Glazed Cod",
        provenance: { source: "kitchen" },
      },
      relatedRecipes: [
        { kind: "side", recipeId: "miso-aubergine", title: "Roast Aubergine" },
      ],
      serveWith: [],
    });

    const withoutLookup = reviewSessionCoherence(session);
    ok(
      !withoutLookup.findings.some((f) => f.lane === "miso"),
      "a title-only side gives no miso signal"
    );

    const withLookup = reviewSessionCoherence(session, {
      "miso-aubergine": {
        id: "miso-aubergine",
        name: "Roast Aubergine",
        ingredients: [{ item: "aubergine" }, { item: "white miso" }],
        method: ["Roast until collapsing."],
      },
    });
    const miso = withLookup.findings.find(
      (f) => f.kind === "seasoning-lane-repeat" && f.lane === "miso"
    );
    ok(miso, "the looked-up side reveals the duplicated miso lane");
    equal(miso.ownerId, "miso-cod");
  });

  it("is deterministic", () => {
    const session = makeSession({ main: KOREAN_MAIN });
    deepStrictEqual(reviewSessionCoherence(session), reviewSessionCoherence(session));
  });
});

// ---------------------------------------------------------------------------
// The API-facing helpers: what GET /api/cooking/session[?date|/:id] returns.
// The routes are thin wrappers that bind `resolve` to `getRecipe` and put the
// result on a `coherence` property; everything decidable is decided here.
// ---------------------------------------------------------------------------

describe("sessionRecipeIds", () => {
  it("returns nothing to load for the external-anchor Korean session", () => {
    // The anchor is an external recipe and the explicit main is ad-hoc, so the
    // only stored recipe the session references is its component.
    deepStrictEqual(sessionRecipeIds(makeSession({ main: KOREAN_MAIN })), [
      "kimchi-pancakes",
    ]);
  });

  it("lists the resolved main, the anchor, and every component, deduplicated", () => {
    const ids = sessionRecipeIds(
      makeSession({
        anchor: {
          type: "kitchen-recipe",
          recipeId: "doenjang-aubergine",
          title: "Doenjang Aubergine",
          provenance: { source: "kitchen" },
        },
        main: { ...KOREAN_MAIN, recipeId: "gochujang-salmon" },
        relatedRecipes: [
          { kind: "side", recipeId: "kimchi-pancakes", title: "Kimchi Pancakes" },
          { kind: "side", recipeId: "kimchi-pancakes", title: "Kimchi Pancakes" },
          { kind: "starter", recipeId: "cold-kimchi", title: "Cold Kimchi" },
        ],
      })
    );
    // Resolved main first, then the anchor it displaced (which renders as a
    // secondary dish), then components.
    deepStrictEqual(ids, [
      "gochujang-salmon",
      "doenjang-aubergine",
      "kimchi-pancakes",
      "cold-kimchi",
    ]);
  });
});

describe("resolveSessionCoherence", () => {
  const misoSession = () =>
    makeSession({
      main: null,
      ingredients: { base: [ing("cod fillets"), ing("white miso")], session: [] },
      method: { base: ["Grill until just done."], session: [] },
      anchor: {
        type: "kitchen-recipe",
        recipeId: "miso-cod",
        title: "Miso-Glazed Cod",
        provenance: { source: "kitchen" },
      },
      relatedRecipes: [
        { kind: "side", recipeId: "miso-aubergine", title: "Roast Aubergine" },
      ],
      serveWith: [],
    });

  it("loads component recipes and finds what a title alone cannot show", async () => {
    const session = misoSession();
    const asked: string[] = [];
    const review = await resolveSessionCoherence(session, async (id) => {
      asked.push(id);
      return id === "miso-aubergine"
        ? {
            id,
            name: "Roast Aubergine",
            ingredients: [{ item: "aubergine" }, { item: "white miso" }],
            method: ["Roast until collapsing."],
          }
        : null;
    });

    deepStrictEqual(asked, ["miso-cod", "miso-aubergine"], "each id is resolved once");
    const miso = review.findings.find(
      (f) => f.kind === "seasoning-lane-repeat" && f.lane === "miso"
    );
    ok(miso, "the resolved side reveals the duplicated miso lane");
    equal(miso.ownerId, "miso-cod");
  });

  it("matches reviewSessionCoherence with the same lookup", async () => {
    const session = misoSession();
    const recipes = {
      "miso-aubergine": {
        id: "miso-aubergine",
        name: "Roast Aubergine",
        ingredients: [{ item: "aubergine" }, { item: "white miso" }],
        method: ["Roast until collapsing."],
      },
    };
    deepStrictEqual(
      await resolveSessionCoherence(session, async (id) =>
        id === "miso-aubergine" ? recipes["miso-aubergine"] : null
      ),
      reviewSessionCoherence(session, recipes)
    );
  });

  it("reviews the Korean session without mutating it", async () => {
    const session = makeSession({
      main: KOREAN_MAIN,
      relatedRecipes: [
        { kind: "side", recipeId: "kimchi-pancakes", title: "Kimchi Pancakes" },
        { kind: "side", recipeId: "cold-kimchi", title: "Cold Kimchi" },
      ],
    });
    const before = JSON.parse(JSON.stringify(session));

    const review = await resolveSessionCoherence(session, async () => null);

    ok(review.findings.length > 0, "the Korean session is not coherent as-is");
    equal(
      review.laneOwners.find((o) => o.lane === "gochujang")?.componentTitle,
      "Gochujang-Glazed Salmon"
    );
    deepStrictEqual(JSON.parse(JSON.stringify(session)), before);
  });

  it("survives a resolver that knows nothing", async () => {
    const review = await resolveSessionCoherence(misoSession(), async () => undefined);
    ok(
      !review.findings.some((f) => f.lane === "miso"),
      "a title-only side gives no miso signal, and nothing throws"
    );
  });
});

// ---------------------------------------------------------------------------
// Full-body validation
//
// The bug these pin: POST /api/cooking/session accepted any JSON with truthy
// id/date/anchor. `anchor: "chicken"` passed, persisted, and then made every
// read of that row throw inside the derived coherence review — both GET routes
// returned 500 permanently for the affected date and id.
// ---------------------------------------------------------------------------

describe("validateSessionBody", () => {
  it("accepts a real production-shaped session unchanged in meaning", () => {
    const source = makeSession();
    const result = validateSessionBody(JSON.parse(JSON.stringify(source)));
    ok(result.ok);
    if (!result.ok) return;
    equal(result.session.id, source.id);
    equal(result.session.date, source.date);
    equal(result.session.anchor.title, source.anchor.title);
    equal(result.session.anchor.provenance.source, source.anchor.provenance.source);
    deepStrictEqual(result.session.relatedRecipes, source.relatedRecipes);
    deepStrictEqual(result.session.serveWith, source.serveWith);
    equal(result.session.ingredients.base.length, source.ingredients.base.length);
    equal(result.session.method.base.length, source.method.base.length);
    equal(result.session.coachCards.wine, source.coachCards.wine);
  });

  it("normalizes a valid preparation order and rejects invalid shapes", () => {
    const result = validateSessionBody({
      ...makeSession(),
      preparationOrder: [" crispy-roasted-chickpeas ", "main"],
    });
    ok(result.ok);
    if (result.ok) {
      deepStrictEqual(result.session.preparationOrder, ["crispy-roasted-chickpeas", "main"]);
    }

    equal(validateSessionBody({ ...makeSession(), preparationOrder: "main" }).ok, false);
    equal(validateSessionBody({ ...makeSession(), preparationOrder: ["main", ""] }).ok, false);
    equal(validateSessionBody({ ...makeSession(), preparationOrder: ["main", "main"] }).ok, false);
  });

  it("keeps a validated session readable by the derived review", async () => {
    // The end-to-end property that matters: anything POST accepts, GET can
    // review without throwing.
    const result = validateSessionBody(JSON.parse(JSON.stringify(makeSession())));
    ok(result.ok);
    if (!result.ok) return;
    const review = await resolveSessionCoherence(result.session, async () => null);
    ok(review);
  });

  it("rejects a string anchor", () => {
    const body = { ...makeSession(), anchor: "chicken" };
    const result = validateSessionBody(body);
    equal(result.ok, false);
    if (result.ok) return;
    ok(/anchor/.test(result.error));
  });

  it("rejects every structurally unusable anchor", () => {
    for (const anchor of [null, undefined, 42, [], ["a"], { title: "" }, { title: "   " }, { title: 7 }]) {
      const result = validateSessionBody({ ...makeSession(), anchor });
      equal(result.ok, false, `anchor=${JSON.stringify(anchor)}`);
    }
  });

  it("rejects a body that is not an object at all", () => {
    for (const body of ["session", 3, null, [], true]) {
      equal(validateSessionBody(body).ok, false, JSON.stringify(body));
    }
  });

  it("rejects a missing or malformed id and date", () => {
    equal(validateSessionBody({ ...makeSession(), id: "" }).ok, false);
    equal(validateSessionBody({ ...makeSession(), id: 7 }).ok, false);
    equal(validateSessionBody({ ...makeSession(), date: "" }).ok, false);
    equal(validateSessionBody({ ...makeSession(), date: "26 July" }).ok, false);
  });

  it("rejects structurally unusable collections", () => {
    equal(validateSessionBody({ ...makeSession(), relatedRecipes: "kimchi" }).ok, false);
    equal(validateSessionBody({ ...makeSession(), relatedRecipes: ["kimchi"] }).ok, false);
    equal(
      validateSessionBody({ ...makeSession(), relatedRecipes: [{ title: "No id" }] }).ok,
      false,
    );
    equal(validateSessionBody({ ...makeSession(), serveWith: "rice" }).ok, false);
    equal(validateSessionBody({ ...makeSession(), serveWith: [{ dish: "rice" }] }).ok, false);
    equal(
      validateSessionBody({ ...makeSession(), method: { base: "step one", session: [] } }).ok,
      false,
    );
    equal(
      validateSessionBody({ ...makeSession(), ingredients: { base: [{ amount: "1" }], session: [] } })
        .ok,
      false,
    );
    equal(validateSessionBody({ ...makeSession(), coachCards: "none" }).ok, false);
    equal(validateSessionBody({ ...makeSession(), adaptations: [{ id: "a" }] }).ok, false);
  });

  it("rejects an unknown status, source, or component status", () => {
    equal(validateSessionBody({ ...makeSession(), status: "cooking" }).ok, false);
    equal(validateSessionBody({ ...makeSession(), source: "smoke-signal" }).ok, false);
    equal(
      validateSessionBody({
        ...makeSession(),
        relatedRecipes: [{ kind: "side", recipeId: "x", title: "X", status: "maybe" }],
      }).ok,
      false,
    );
  });

  it("applies the same main/hero/story rules a patch does", () => {
    equal(validateSessionBody({ ...makeSession(), main: { title: "  " } }).ok, false);
    equal(validateSessionBody({ ...makeSession(), heroImage: { url: "javascript:x" } }).ok, false);
    equal(validateSessionBody({ ...makeSession(), story: { text: "" } }).ok, false);
    ok(validateSessionBody({ ...makeSession(), heroImage: { url: "/images/x.jpg" } }).ok);
    ok(validateSessionBody({ ...makeSession(), main: null }).ok);
  });

  it("keeps ingredient substitution targets through a full-body write", () => {
    const body = {
      id: "cook_2026-08-03_farfalle",
      date: "2026-08-03",
      anchor: {
        type: "external-recipe",
        title: "Slow Roasted Tomato & Mascarpone Farfalle",
        provenance: { source: "The Pasta Table" },
      },
      ingredients: {
        base: [{ amount: "2", item: "cherry tomatoes, halved" }],
        session: [
          { amount: "3", item: "roasted peppers", replaces: "cherry tomatoes" },
          { amount: "1", item: "lemon", replaces: "   " },
        ],
      },
    };
    const result = validateSessionBody(body);
    ok(result.ok);
    if (!result.ok) return;
    equal(result.session.ingredients.session[0].replaces, "cherry tomatoes");
    // A blank target is dropped, not stored.
    equal(result.session.ingredients.session[1].replaces, undefined);
    notEqual(
      validateSessionBody({
        ...body,
        ingredients: {
          base: [],
          session: [{ amount: "3", item: "peppers", replaces: 7 }],
        },
      }).ok,
      true
    );
  });

  it("accepts a minimal legacy session and fills the empty shape in", () => {
    const result = validateSessionBody({
      id: "cook_2026-01-02_legacy",
      date: "2026-01-02",
      anchor: { title: "Roast chicken" },
    });
    ok(result.ok);
    if (!result.ok) return;
    equal(result.session.anchor.type, "kitchen-recipe");
    equal(result.session.anchor.provenance.source, "");
    equal(result.session.preparationOrder, undefined);
    equal(result.session.status, "draft");
    deepStrictEqual(result.session.relatedRecipes, []);
    deepStrictEqual(result.session.serveWith, []);
    deepStrictEqual(result.session.ingredients, { base: [], session: [] });
    deepStrictEqual(result.session.method, { base: [], session: [] });
    deepStrictEqual(result.session.coachCards, {
      nextMove: null,
      upgrade: null,
      shortcut: null,
      wine: null,
    });
  });

  it("accepts a legacy anchor with only a source string in its provenance", () => {
    const result = validateSessionBody({
      id: "cook_2026-01-03_legacy",
      date: "2026-01-03",
      anchor: { type: "kitchen-recipe", recipeId: "roast-chicken", title: "Roast chicken", provenance: { source: "kitchen" } },
    });
    ok(result.ok);
    if (!result.ok) return;
    equal(result.session.anchor.recipeId, "roast-chicken");
    equal(result.session.anchor.provenance.source, "kitchen");
  });

  it("returns the normalized session, not the caller's object", () => {
    const body = {
      ...makeSession(),
      coherence: { findings: [], suggestions: [] },
      somethingElse: "ignored",
    };
    const result = validateSessionBody(body);
    ok(result.ok);
    if (!result.ok) return;
    equal("coherence" in result.session, false, "the derived review must never persist");
    equal("somethingElse" in result.session, false);
  });
});

// ---------------------------------------------------------------------------
// Explicit session-list mode (append vs override)
// ---------------------------------------------------------------------------

describe("session list mode round trip", () => {
  const farfalleBody = () => {
    const session = farfalleSession();
    return JSON.parse(JSON.stringify(session)) as unknown;
  };

  it("survives a full-body write and still renders as tonight's whole method", () => {
    const result = validateSessionBody(farfalleBody());
    ok(result.ok);
    if (!result.ok) return;
    equal(result.session.method.sessionMode, "override");
    equal(result.session.ingredients.sessionMode, undefined);

    const working = resolveWorkingRecipe(result.session);
    equal(working.method.length, 4);
    ok(!working.method.some((step) => /tomatoes/i.test(step.text)));
    // The anchor's verbatim method is still stored untouched.
    equal(result.session.method.base.length, 4);
    ok(result.session.method.base[0].includes("Roast the tomatoes"));
  });

  it("refuses an unknown mode instead of silently inferring one", () => {
    const body = farfalleBody() as { method: { sessionMode: string } };
    body.method.sessionMode = "replace";
    const result = validateSessionBody(body);
    equal(result.ok, false);
    if (result.ok) return;
    ok(result.error.includes("method.sessionMode"));

    equal(
      validatePatch({ method: { session: ["x"], sessionMode: "replace" as never } }),
      'Invalid method.sessionMode: replace'
    );
    equal(
      validatePatch({ ingredients: { session: [], sessionMode: "replace" as never } }),
      'Invalid ingredients.sessionMode: replace'
    );
    equal(validatePatch({ method: { session: ["x"], sessionMode: "override" } }), null);
  });

  it("a patch that rewrites a list owns its mode, and omitting it clears a stale one", () => {
    const session = farfalleSession();
    equal(session.method.sessionMode, "override");

    // A later, smaller adjustment must not inherit "override" — that would
    // claim one appended line is the whole method.
    const appended = applyPatch(session, {
      method: { session: ["Grate more Parmigiano at the table."] },
    });
    equal(appended.method.sessionMode, undefined);
    const working = resolveWorkingRecipe(appended);
    equal(working.method.length, session.method.base.length + 1);

    const marked = applyPatch(session, {
      method: { session: ["Do it all differently."], sessionMode: "override" },
    });
    equal(marked.method.sessionMode, "override");
    deepStrictEqual(resolveWorkingRecipe(marked).method.map((s) => s.text), [
      "Do it all differently.",
    ]);
  });

  it("a plan resync keeps the mode with its list and clears it with a reset", () => {
    const kept = syncSessionWithPlan(
      makeSession({
        source: "meal-plan",
        anchor: {
          type: "my-recipe",
          recipeId: "korean-sunday-spread",
          title: "Korean Sunday Spread",
          provenance: { source: "My Recipes" },
        },
        method: { base: ["Cook it."], session: ["Tonight's method."], sessionMode: "override" },
      }),
      planData()
    );
    equal(kept.method.sessionMode, "override");
    deepStrictEqual(kept.method.session, ["Tonight's method."]);

    const reset = syncSessionWithPlan(
      makeSession({
        source: "meal-plan",
        anchor: {
          type: "kitchen-recipe",
          recipeId: "old-recipe",
          title: "Old Recipe",
          provenance: { source: "kitchen" },
        },
        method: { base: ["Cook it."], session: ["Tonight's method."], sessionMode: "override" },
      }),
      planData()
    );
    deepStrictEqual(reset.method.session, []);
    equal(reset.method.sessionMode, undefined, "a cleared list must not keep an override claim");
  });

  it("legacy rows with no mode are untouched by the field existing", () => {
    const legacy = validateSessionBody({
      id: "cook_2026-01-01_legacy",
      date: "2026-01-01",
      anchor: { title: "Legacy Dish", provenance: { source: "kitchen" } },
      method: { base: ["A.", "B.", "C.", "D."], session: ["Extra step."] },
    });
    ok(legacy.ok);
    if (!legacy.ok) return;
    equal(legacy.session.method.sessionMode, undefined);
    equal("sessionMode" in legacy.session.method, false);
    // Same inference as before the field existed: one step against four appends.
    equal(resolveWorkingRecipe(legacy.session).method.length, 5);
  });
});
