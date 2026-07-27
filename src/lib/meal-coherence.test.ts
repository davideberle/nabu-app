// Unit tests for the pure whole-meal coherence analyzer.
// Run with: npm test  (node --test; Node 24 strips types natively)

import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MEAL_COHERENCE_VERSION,
  analyzeMealCoherence,
  hasBlockingFinding,
  recipeToMealComponent,
  selectCoherentMealSet,
  type MealComponent,
  type MealCoherenceReview,
  type MealSetCandidate,
} from "./meal-coherence.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ing(...items: string[]) {
  return items.map((item) => ({ item }));
}

function findingKinds(review: MealCoherenceReview): string[] {
  return review.findings.map((f) => f.kind);
}

function laneOwner(review: MealCoherenceReview, lane: string): string | undefined {
  return review.laneOwners.find((o) => o.lane === lane)?.componentTitle;
}

function suggestionFor(review: MealCoherenceReview, componentId: string) {
  return review.suggestions.find((s) => s.componentId === componentId);
}

// ---------------------------------------------------------------------------
// Acceptance fixture 1 — the 2026-07-27 Korean leftover bowl
// ---------------------------------------------------------------------------

/**
 * The failure that triggered this work: soy landed in the tofu glaze *and*
 * in the sprout/cucumber dressing, because each recipe was reviewed against
 * the main in isolation and never against the assembled plate.
 */
function koreanLeftoverBowl(): {
  main: MealComponent;
  components: MealComponent[];
} {
  const main: MealComponent = {
    id: "gochujang-soy-tofu",
    title: "Gochujang-Soy Glazed Tofu",
    role: "main",
    ingredients: ing(
      "firm tofu",
      "gochujang",
      "soy sauce",
      "sesame oil",
      "garlic",
      "rice vinegar",
      "maple syrup"
    ),
    method: [
      "Press the tofu and cut into slabs.",
      "Whisk gochujang, soy sauce, sesame oil and maple syrup into a glaze.",
      "Pan-fry the tofu, then spoon over the glaze and reduce.",
    ],
    timeMinutes: 25,
  };

  const components: MealComponent[] = [
    {
      id: "sprout-cucumber-side",
      title: "Bean Sprout & Cucumber Side",
      role: "side",
      // As originally suggested: a second soy dressing.
      ingredients: ing(
        "bean sprouts",
        "cucumber",
        "soy sauce",
        "sesame oil",
        "garlic",
        "sesame seeds"
      ),
      method: ["Blanch the sprouts, cool them, then dress with the soy mixture."],
      timeMinutes: 10,
    },
    {
      id: "cold-kimchi",
      title: "Cold Kimchi",
      role: "side",
      ingredients: ing("napa cabbage kimchi"),
      method: ["Serve straight from the jar, cold."],
      timeMinutes: 2,
    },
    {
      id: "kimchi-pancake",
      title: "Kimchi Pancake",
      role: "side",
      ingredients: ing("kimchi", "plain flour", "spring onion", "egg", "vegetable oil"),
      method: [
        "Mix the kimchi into a flour batter.",
        "Shallow-fry in hot oil until crisp on both sides.",
      ],
      timeMinutes: 20,
    },
  ];

  return { main, components };
}

describe("acceptance fixture: Korean leftover bowl", () => {
  const { main, components } = koreanLeftoverBowl();
  const review = analyzeMealCoherence({
    main,
    components,
    serveWith: ["Steamed short-grain rice"],
    dayType: "weekday",
  });

  it("flags the repeated soy lane as a major finding", () => {
    const soy = review.findings.find(
      (f) => f.kind === "seasoning-lane-repeat" && f.lane === "soy"
    );
    ok(soy, "expected a soy seasoning-lane-repeat finding");
    equal(soy.severity, "major");
    deepStrictEqual(soy.componentIds.sort(), ["gochujang-soy-tofu", "sprout-cucumber-side"]);
  });

  it("gives the tofu ownership of both the soy and gochujang lanes", () => {
    equal(laneOwner(review, "soy"), "Gochujang-Soy Glazed Tofu");
    equal(laneOwner(review, "gochujang"), "Gochujang-Soy Glazed Tofu");
    const soyFinding = review.findings.find((f) => f.lane === "soy");
    equal(soyFinding?.ownerId, "gochujang-soy-tofu");
  });

  it("proposes a lime-sesame-salt dressing for the sprouts and cucumber", () => {
    const suggestion = suggestionFor(review, "sprout-cucumber-side");
    ok(suggestion, "expected a suggestion for the sprout/cucumber side");
    equal(suggestion.kind, "reseason");
    equal(suggestion.adjustment.target, "seasoning");
    ok(
      /lime, sesame oil and salt/.test(suggestion.summary),
      `expected a lime/sesame/salt dressing, got: ${suggestion.summary}`
    );
  });

  it("credits cold kimchi with fermented acid and crunch instead of asking for more contrast", () => {
    ok(
      !findingKinds(review).includes("missing-contrast"),
      "kimchi and cucumber already supply freshness and crunch"
    );
    // Kimchi is the fermented-acid source and is never proposed for removal.
    equal(suggestionFor(review, "cold-kimchi"), undefined);
    equal(laneOwner(review, "ferment"), "Cold Kimchi");
  });

  it("omits the kimchi pancake as redundant fried/starchy work", () => {
    const redundant = review.findings.find(
      (f) => f.kind === "redundant-effort" && f.componentIds.includes("kimchi-pancake")
    );
    ok(redundant, "expected the kimchi pancake to be flagged as redundant effort");

    const suggestion = suggestionFor(review, "kimchi-pancake");
    ok(suggestion, "expected a suggestion for the kimchi pancake");
    equal(suggestion.kind, "make-optional");
    // The agreed outcome is that the pancake is left off tonight, not merely
    // downgraded: cold kimchi already owns the ferment lane.
    deepStrictEqual(suggestion.adjustment, {
      target: "component-status",
      componentId: "kimchi-pancake",
      status: "omitted",
    });
    ok(
      /^Skip Kimchi Pancake tonight/.test(suggestion.summary),
      `expected a skip-tonight summary, got: ${suggestion.summary}`
    );
  });

  it("never proposes a canonical recipe edit", () => {
    for (const suggestion of review.suggestions) {
      ok(
        ["component-status", "seasoning", "session-note"].includes(
          suggestion.adjustment.target
        ),
        `unexpected adjustment target: ${suggestion.adjustment.target}`
      );
    }
  });

  it("leaves every input component object untouched", () => {
    const fresh = koreanLeftoverBowl();
    analyzeMealCoherence({ main: fresh.main, components: fresh.components });
    deepStrictEqual(fresh.main, koreanLeftoverBowl().main);
    deepStrictEqual(fresh.components, koreanLeftoverBowl().components);
  });

  it("is deterministic across repeated runs", () => {
    const a = analyzeMealCoherence({ main, components, dayType: "weekday" });
    const b = analyzeMealCoherence({ main, components, dayType: "weekday" });
    deepStrictEqual(a, b);
  });

  it("stops nagging once the pancake is already set aside", () => {
    const { main: m, components: c } = koreanLeftoverBowl();
    const setAside = c.map((comp) =>
      comp.id === "kimchi-pancake" ? { ...comp, status: "optional" as const } : comp
    );
    const quieter = analyzeMealCoherence({ main: m, components: setAside });
    equal(suggestionFor(quieter, "kimchi-pancake"), undefined);
    ok(quieter.setAsideIds.includes("kimchi-pancake"));
  });

  it("clears the soy finding once the dressing is rebalanced", () => {
    const { main: m, components: c } = koreanLeftoverBowl();
    const rebalanced = c.map((comp) =>
      comp.id === "sprout-cucumber-side"
        ? {
            ...comp,
            ingredients: ing("bean sprouts", "cucumber", "lime juice", "sesame oil", "sea salt"),
            method: ["Blanch the sprouts, cool them, then dress with lime, sesame oil and salt."],
          }
        : comp
    );
    const after = analyzeMealCoherence({ main: m, components: rebalanced });
    ok(
      !after.findings.some((f) => f.lane === "soy" && f.kind === "seasoning-lane-repeat"),
      "soy should no longer be duplicated"
    );
  });
});

// ---------------------------------------------------------------------------
// Acceptance fixture 2 — a deliberately coherent meal
// ---------------------------------------------------------------------------

describe("acceptance fixture: coherent meal", () => {
  const review = analyzeMealCoherence({
    main: {
      id: "roast-chicken-lemon",
      title: "Lemon & Thyme Roast Chicken",
      role: "main",
      ingredients: ing("whole chicken", "lemon", "thyme", "olive oil", "sea salt"),
      method: ["Roast the chicken at 200C until the juices run clear.", "Rest before carving."],
      timeMinutes: 55,
    },
    components: [
      {
        id: "green-salad",
        title: "Green Salad with Mustard Dressing",
        role: "side",
        ingredients: ing("little gem lettuce", "radishes", "dijon mustard", "olive oil"),
        method: ["Toss the leaves with the dressing just before serving."],
        timeMinutes: 8,
      },
      {
        id: "steamed-green-beans",
        title: "Steamed Green Beans",
        role: "side",
        ingredients: ing("green beans", "butter"),
        method: ["Steam until just tender."],
        timeMinutes: 10,
      },
    ],
    dayType: "weekend",
  });

  it("returns no major finding", () => {
    ok(!hasBlockingFinding(review), `unexpected findings: ${JSON.stringify(review.findings)}`);
  });

  it("does not manufacture generic advice", () => {
    deepStrictEqual(review.suggestions, []);
    equal(review.severity, "none");
    deepStrictEqual(review.findings, []);
  });

  it("stays quiet for a lone main with nothing else assembled yet", () => {
    const solo = analyzeMealCoherence({
      main: {
        id: "cacio-e-pepe",
        title: "Cacio e Pepe",
        role: "main",
        ingredients: ing("spaghetti", "pecorino", "black pepper"),
        method: ["Emulsify the pecorino with pasta water."],
      },
    });
    equal(solo.severity, "none");
    deepStrictEqual(solo.findings, []);
  });
});

// ---------------------------------------------------------------------------
// Acceptance fixture 3 — general, not hard-coded to soy
// ---------------------------------------------------------------------------

describe("acceptance fixture: non-Korean cheese/cream and fried repetition", () => {
  const review = analyzeMealCoherence({
    main: {
      id: "mushroom-gratin",
      title: "Creamy Mushroom & Gruyere Gratin",
      role: "main",
      ingredients: ing("chestnut mushrooms", "double cream", "gruyere", "garlic", "thyme"),
      method: ["Bake in the oven at 190C until bubbling and golden."],
      timeMinutes: 45,
    },
    components: [
      {
        id: "cheese-croquettes",
        title: "Cheddar Croquettes",
        role: "starter",
        ingredients: ing("cheddar", "potato", "plain flour", "panko breadcrumbs", "sunflower oil"),
        method: ["Shape, crumb, and deep-fry until golden."],
        timeMinutes: 40,
      },
      {
        id: "courgette-fritters",
        title: "Courgette Fritters",
        role: "side",
        ingredients: ing("courgettes", "plain flour", "egg", "creme fraiche", "sunflower oil"),
        method: ["Shallow-fry spoonfuls of the batter until crisp."],
        timeMinutes: 30,
      },
    ],
    dayType: "weekday",
  });

  it("flags the repeated cheese lane, proving the analyzer is not soy-specific", () => {
    const cheese = review.findings.find(
      (f) => f.kind === "seasoning-lane-repeat" && f.lane === "cheese"
    );
    ok(cheese, "expected a cheese seasoning-lane-repeat finding");
    equal(cheese.severity, "major");
    equal(cheese.ownerId, "mushroom-gratin");
  });

  it("flags duplicated richness and starch", () => {
    ok(findingKinds(review).includes("richness-repeat"));
    ok(findingKinds(review).includes("starch-repeat"));
  });

  it("flags multiple fried components as texture repetition and execution pressure", () => {
    const fried = review.findings.find((f) => f.kind === "fried-repeat");
    ok(fried, "expected a fried-repeat finding");
    deepStrictEqual(fried.componentIds.sort(), ["cheese-croquettes", "courgette-fritters"]);
    ok(findingKinds(review).includes("execution-pressure"));
  });

  it("asks for a fresh, sharp element on an all-rich plate", () => {
    ok(findingKinds(review).includes("missing-contrast"));
    const contrast = review.suggestions.find((s) => s.kind === "add-contrast");
    ok(contrast);
    equal(contrast.adjustment.target, "session-note");
    equal(contrast.componentId, null);
  });

  it("offers to set aside a fried component rather than rewriting a recipe", () => {
    const setAside = review.suggestions.filter((s) => s.kind === "make-optional");
    ok(setAside.length >= 1);
    ok(setAside.every((s) => s.adjustment.target === "component-status"));
  });

  it("omits the croquettes: the gratin already owns cheese and they only add frying", () => {
    const setAside = review.suggestions.find((s) => s.componentId === "cheese-croquettes" && s.kind === "make-optional");
    ok(setAside, "expected a set-aside suggestion for the croquettes");
    equal(
      setAside.adjustment.target === "component-status" ? setAside.adjustment.status : null,
      "omitted"
    );
  });
});

// ---------------------------------------------------------------------------
// The set-aside status is graded: identified redundancy is omitted, a merely
// crowded pan is offered as optional.
// ---------------------------------------------------------------------------

describe("set-aside status", () => {
  it("keeps 'optional' when the only signal is a second fried component", () => {
    const review = analyzeMealCoherence({
      main: {
        id: "prawn-tempura",
        title: "Prawn Tempura",
        role: "main",
        ingredients: ing("prawns", "tempura flour", "sunflower oil"),
        method: ["Deep-fry the prawns in batter."],
        timeMinutes: 25,
      },
      components: [
        {
          id: "potato-latkes",
          title: "Potato Latkes",
          role: "side",
          ingredients: ing("potato", "onion", "egg", "sunflower oil"),
          method: ["Shallow-fry the grated potato until crisp."],
          timeMinutes: 25,
        },
      ],
      dayType: "weekday",
    });

    // No seasoning lane is duplicated, so nothing is identified as redundant.
    ok(!findingKinds(review).includes("redundant-effort"));
    const suggestion = suggestionFor(review, "potato-latkes");
    ok(suggestion, "expected a set-aside suggestion for the latkes");
    equal(suggestion.kind, "make-optional");
    deepStrictEqual(suggestion.adjustment, {
      target: "component-status",
      componentId: "potato-latkes",
      status: "optional",
    });
  });
});

// ---------------------------------------------------------------------------
// Individual signal behaviour
// ---------------------------------------------------------------------------

describe("seasoning lane detection", () => {
  it("does not treat soy milk or soybeans as the soy-sauce lane", () => {
    const review = analyzeMealCoherence({
      main: {
        id: "soy-braise",
        title: "Soy-Braised Short Ribs",
        role: "main",
        ingredients: ing("beef short ribs", "soy sauce", "star anise"),
        method: ["Braise gently for three hours."],
      },
      components: [
        {
          id: "soy-milk-panna",
          title: "Soy Milk Panna Cotta",
          role: "dessert",
          ingredients: ing("soy milk", "sugar", "agar"),
          method: ["Chill until set."],
        },
      ],
    });
    ok(!review.findings.some((f) => f.lane === "soy" && f.kind === "seasoning-lane-repeat"));
  });

  it("does not count a serve-it-with mention in the method as carrying the lane", () => {
    const review = analyzeMealCoherence({
      main: {
        id: "dumplings",
        title: "Steamed Dumplings",
        role: "main",
        ingredients: ing("pork mince", "cabbage", "soy sauce", "ginger"),
        method: ["Steam for 8 minutes."],
      },
      components: [
        {
          id: "smacked-cucumber",
          title: "Smacked Cucumber",
          role: "side",
          ingredients: ing("cucumber", "rice vinegar", "sesame oil", "garlic"),
          method: ["Smack, salt, drain, dress. Serve with soy sauce on the side if you like."],
        },
      ],
    });
    ok(
      !review.findings.some((f) => f.lane === "soy" && f.kind === "seasoning-lane-repeat"),
      "a method aside should not make the cucumber a soy dish"
    );
  });

  it("lets the main own a lane even when a side matches it more often", () => {
    const review = analyzeMealCoherence({
      main: {
        id: "miso-cod",
        title: "Miso-Glazed Cod",
        role: "main",
        ingredients: ing("cod fillets", "white miso", "mirin"),
        method: ["Grill under a high heat."],
      },
      components: [
        {
          id: "miso-aubergine",
          title: "Double-Miso Aubergine",
          role: "side",
          ingredients: ing("aubergine", "white miso", "red miso", "doenjang"),
          method: ["Roast until collapsing."],
        },
      ],
    });
    equal(laneOwner(review, "miso"), "Miso-Glazed Cod");
    equal(suggestionFor(review, "miso-aubergine")?.kind, "reseason");
  });

  it("reads a free-text serve-with line as a component", () => {
    const review = analyzeMealCoherence({
      main: {
        id: "dal",
        title: "Tarka Dal",
        role: "main",
        ingredients: ing("red lentils", "cumin", "turmeric"),
        method: ["Simmer until soft."],
      },
      serveWith: ["Basmati rice", "Naan bread"],
    });
    const starch = review.findings.find((f) => f.kind === "starch-repeat");
    ok(starch, "rice plus naan is duplicated starch");
    equal(starch.componentIds.length, 2);
  });
});

describe("execution pressure", () => {
  it("ignores total work when time metadata is incomplete", () => {
    const review = analyzeMealCoherence({
      main: {
        id: "slow-lamb",
        title: "Slow-Roast Lamb Shoulder",
        role: "main",
        ingredients: ing("lamb shoulder", "rosemary"),
        method: ["Roast low for five hours."],
        timeMinutes: 300,
      },
      components: [
        {
          id: "flatbreads",
          title: "Flatbreads",
          role: "side",
          ingredients: ing("plain flour", "yoghurt"),
          method: ["Cook on a dry pan."],
          // No timeMinutes — the sum would be misleading.
        },
      ],
    });
    ok(
      !review.findings.some(
        (f) => f.kind === "execution-pressure" && /minutes of cooking/.test(f.summary)
      ),
      "a partial time sum must not drive a workload finding"
    );
  });

  it("flags a long weeknight when every component reports its time", () => {
    const review = analyzeMealCoherence({
      main: {
        id: "porchetta",
        title: "Porchetta",
        role: "main",
        ingredients: ing("pork belly", "fennel seeds"),
        method: ["Roast slowly."],
        timeMinutes: 120,
      },
      components: [
        {
          id: "braised-fennel",
          title: "Braised Fennel",
          role: "side",
          ingredients: ing("fennel bulbs", "white wine"),
          method: ["Braise in the oven."],
          timeMinutes: 40,
        },
      ],
      dayType: "weekday",
    });
    ok(
      review.findings.some(
        (f) => f.kind === "execution-pressure" && /160 minutes of cooking/.test(f.summary)
      )
    );
  });

  it("does not treat a stir-fry as deep-pan frying", () => {
    const review = analyzeMealCoherence({
      main: {
        id: "veg-stir-fry",
        title: "Ginger Vegetable Stir-Fry",
        role: "main",
        ingredients: ing("pak choi", "ginger", "spring onions"),
        method: ["Stir-fry over the highest heat."],
      },
      components: [
        {
          id: "sesame-greens",
          title: "Sesame Greens",
          role: "side",
          ingredients: ing("tenderstem broccoli", "sesame seeds"),
          method: ["Stir-fry briefly, then dress."],
        },
      ],
    });
    ok(!review.findings.some((f) => f.kind === "fried-repeat"));
  });

  it("flags three oven components as appliance contention", () => {
    const oven = (id: string, title: string) => ({
      id,
      title,
      role: "side" as const,
      ingredients: ing("vegetables"),
      method: ["Roast in the oven at 220C."],
    });
    const review = analyzeMealCoherence({
      main: {
        id: "roast-cauliflower",
        title: "Whole Roast Cauliflower",
        role: "main",
        ingredients: ing("cauliflower", "olive oil"),
        method: ["Roast in the oven at 180C."],
      },
      components: [oven("roast-carrots", "Roast Carrots"), oven("roast-squash", "Roast Squash")],
    });
    ok(review.findings.some((f) => f.kind === "appliance-contention"));
  });
});

describe("contrast checks", () => {
  it("stays quiet about contrast on a light meal", () => {
    const review = analyzeMealCoherence({
      main: {
        id: "poached-cod",
        title: "Poached Cod in Broth",
        role: "main",
        ingredients: ing("cod", "leek", "white wine"),
        method: ["Poach gently."],
      },
      components: [
        {
          id: "boiled-jersey-royals",
          title: "Boiled Jersey Royals",
          role: "side",
          ingredients: ing("new potatoes"),
          method: ["Boil until tender."],
        },
      ],
    });
    ok(!findingKinds(review).includes("missing-contrast"));
  });

  it("notes an all-hot plate as info, not a warning", () => {
    const review = analyzeMealCoherence({
      main: {
        id: "beef-stew",
        title: "Beef Stew",
        role: "main",
        ingredients: ing("beef shin", "carrot"),
        method: ["Stew for three hours."],
      },
      components: [
        {
          id: "buttered-cabbage",
          title: "Buttered Cabbage",
          role: "side",
          ingredients: ing("savoy cabbage"),
          method: ["Steam, then toss in the pan."],
        },
        {
          id: "mashed-swede",
          title: "Mashed Swede",
          role: "side",
          ingredients: ing("swede"),
          method: ["Boil and mash."],
        },
      ],
    });
    const temp = review.findings.find((f) => f.kind === "no-temperature-contrast");
    if (temp) equal(temp.severity, "info");
    ok(!hasBlockingFinding(review));
  });
});

describe("recipeToMealComponent", () => {
  it("projects a recipe without mutating it", () => {
    const recipe = {
      id: "shakshuka",
      name: "Shakshuka",
      ingredients: [{ item: "eggs" }, { item: "tomatoes" }],
      method: ["Simmer, then crack in the eggs."],
      time: { prep: 10, cook: 20 },
    };
    const snapshot = JSON.parse(JSON.stringify(recipe));
    const component = recipeToMealComponent(recipe, "main");
    deepStrictEqual(recipe, snapshot);
    equal(component.id, "shakshuka");
    equal(component.role, "main");
    equal(component.timeMinutes, 30);
  });

  it("prefers an explicit total time and tolerates missing time", () => {
    equal(
      recipeToMealComponent(
        { id: "a", name: "A", time: { prep: 5, cook: 5, total: 45 } },
        "side"
      ).timeMinutes,
      45
    );
    equal(recipeToMealComponent({ id: "b", name: "B" }, "side").timeMinutes, null);
  });

  it("carries a component status through", () => {
    equal(
      recipeToMealComponent({ id: "c", name: "C" }, "side", { status: "deferred" }).status,
      "deferred"
    );
  });
});

describe("review shape", () => {
  it("stamps the contract version", () => {
    const review = analyzeMealCoherence({
      main: { id: "x", title: "X", role: "main" },
    });
    equal(review.version, MEAL_COHERENCE_VERSION);
  });
});

// ---------------------------------------------------------------------------
// Coherent set selection
//
// The planner scores each complement against the main alone, so two candidates
// can be individually excellent and jointly wrong. These tests pin the rule
// that the recommended set is assembled as a meal.
// ---------------------------------------------------------------------------

const NEUTRAL_MAIN: MealComponent = {
  id: "grilled-sea-bass",
  title: "Grilled Lemon Sea Bass",
  role: "main",
  ingredients: ing("sea bass fillets", "lemon", "olive oil", "parsley"),
  method: ["Grill the fillets skin-side down until just done."],
};

const SOY_CUCUMBER: MealComponent = {
  id: "smashed-cucumber",
  title: "Smashed Cucumber with Soy & Sesame",
  role: "side",
  ingredients: ing("cucumber", "soy sauce", "toasted sesame oil", "garlic"),
  method: ["Smash the cucumber, salt it, then dress."],
};

const SOY_EDAMAME: MealComponent = {
  id: "soy-edamame",
  title: "Edamame with Soy & Chilli",
  role: "starter",
  ingredients: ing("edamame", "soy sauce", "dried chilli flakes"),
  method: ["Steam the pods and toss through the dressing."],
};

const LEEK_VINAIGRETTE: MealComponent = {
  id: "leek-vinaigrette",
  title: "Leeks Vinaigrette",
  role: "starter",
  ingredients: ing("leeks", "dijon mustard", "olive oil", "red wine vinegar"),
  method: ["Simmer the leeks until tender, then dress while warm."],
};

function candidate(role: MealSetCandidate["role"], component: MealComponent): MealSetCandidate {
  return { role, component };
}

describe("selectCoherentMealSet", () => {
  it("will not recommend two components that share the same major seasoning lane", () => {
    // Both are sensible next to a plain grilled fish; together they are two soy
    // dressings on one plate.
    const set = selectCoherentMealSet({
      main: NEUTRAL_MAIN,
      candidates: [
        candidate("side", SOY_CUCUMBER),
        candidate("starter", SOY_EDAMAME),
        candidate("starter", LEEK_VINAIGRETTE),
      ],
    });

    deepStrictEqual(
      set.selected.map((s) => s.componentId),
      ["smashed-cucumber", "leek-vinaigrette"]
    );
    ok(
      !set.review.findings.some((f) => f.lane === "soy" && f.severity === "major"),
      "the recommended set must not repeat the soy lane"
    );

    const starter = set.decisions.find((d) => d.role === "starter");
    equal(starter?.outcome, "clear");
    deepStrictEqual(
      starter?.rejected.map((r) => r.componentId),
      ["soy-edamame"]
    );
    ok(starter?.rejected[0].summary.includes("soy"), "the swap says what collided");
  });

  it("will not recommend a set that turns into a three-pan fry", () => {
    const set = selectCoherentMealSet({
      main: {
        id: "buttermilk-fried-chicken",
        title: "Buttermilk Fried Chicken",
        role: "main",
        ingredients: ing("chicken thighs", "buttermilk", "plain flour"),
        method: ["Deep-fry in batches until golden."],
      },
      candidates: [
        candidate("side", {
          id: "potato-croquettes",
          title: "Potato Croquettes",
          role: "side",
          ingredients: ing("potatoes", "panko", "egg"),
          method: ["Shallow-fry until crisp all over."],
        }),
        candidate("starter", {
          id: "vegetable-tempura",
          title: "Vegetable Tempura",
          role: "starter",
          ingredients: ing("tempura batter", "courgette", "sweet potato"),
          method: ["Deep-fry in small batches."],
        }),
        candidate("starter", {
          id: "marinated-olives",
          title: "Marinated Olives",
          role: "starter",
          ingredients: ing("green olives", "orange zest", "fennel seeds"),
          method: ["Warm gently in olive oil and leave to sit."],
        }),
      ],
    });

    deepStrictEqual(
      set.selected.map((s) => s.componentId),
      ["potato-croquettes", "marinated-olives"]
    );
    ok(
      !set.review.findings.some((f) => f.kind === "fried-repeat" && f.severity === "major"),
      "a third fried component must not be recommended"
    );
    ok(
      set.decisions
        .find((d) => d.role === "starter")
        ?.rejected.some((r) => r.componentId === "vegetable-tempura")
    );
  });

  it("keeps the least-bad option rather than returning an empty role", () => {
    const set = selectCoherentMealSet({
      main: {
        id: "miso-black-cod",
        title: "Miso-Glazed Black Cod",
        role: "main",
        ingredients: ing("black cod fillets", "white miso", "mirin", "sake"),
        method: ["Marinate overnight, then grill."],
      },
      candidates: [
        candidate("side", {
          id: "miso-aubergine",
          title: "Roast Aubergine with Miso Butter",
          role: "side",
          ingredients: ing("aubergine", "white miso", "butter"),
          method: ["Roast until collapsing."],
        }),
      ],
    });

    equal(set.selected.length, 1, "the role is still filled");
    const decision = set.decisions[0];
    equal(decision.outcome, "least-bad");
    equal(decision.conflicts[0]?.lane, "miso");
    ok(decision.conflicts[0].summary.length > 0, "the conflict is exposed, not hidden");
  });

  it("keeps Kitchen's ranking when the top candidate fits", () => {
    const set = selectCoherentMealSet({
      main: NEUTRAL_MAIN,
      candidates: [
        candidate("side", {
          id: "charred-broccoli",
          title: "Charred Broccoli with Almonds",
          role: "side",
          ingredients: ing("tenderstem broccoli", "almonds", "olive oil"),
          method: ["Char in a hot pan."],
        }),
        candidate("side", SOY_CUCUMBER),
      ],
    });
    deepStrictEqual(
      set.selected.map((s) => s.componentId),
      ["charred-broccoli"]
    );
    equal(set.decisions[0].outcome, "clear");
    deepStrictEqual(set.decisions[0].rejected, []);
  });

  it("assembles around components already accepted on the day", () => {
    const set = selectCoherentMealSet({
      main: NEUTRAL_MAIN,
      assembled: [SOY_CUCUMBER],
      candidates: [candidate("starter", SOY_EDAMAME), candidate("starter", LEEK_VINAIGRETTE)],
    });
    deepStrictEqual(
      set.selected.map((s) => s.componentId),
      ["leek-vinaigrette"],
      "an accepted side constrains the recommendation and is not re-listed"
    );
  });

  it("fills every role that has candidates, in plate order", () => {
    const set = selectCoherentMealSet({
      main: NEUTRAL_MAIN,
      dayType: "weekend",
      candidates: [
        candidate("starter", LEEK_VINAIGRETTE),
        candidate("side", {
          id: "roast-potatoes",
          title: "Roast Potatoes",
          role: "side",
          ingredients: ing("potatoes", "olive oil", "rosemary"),
          method: ["Roast until crisp."],
        }),
        candidate("dessert", {
          id: "poached-pears",
          title: "Poached Pears",
          role: "dessert",
          ingredients: ing("pears", "sugar", "vanilla"),
          method: ["Poach gently."],
        }),
      ],
    });
    deepStrictEqual(
      set.selected.map((s) => s.role),
      ["side", "starter", "dessert"]
    );
  });

  it("is deterministic and never mutates its input", () => {
    const candidates = [
      candidate("side", SOY_CUCUMBER),
      candidate("starter", SOY_EDAMAME),
      candidate("starter", LEEK_VINAIGRETTE),
    ];
    const before = JSON.parse(JSON.stringify(candidates));
    const first = selectCoherentMealSet({ main: NEUTRAL_MAIN, candidates });
    const second = selectCoherentMealSet({ main: NEUTRAL_MAIN, candidates });
    deepStrictEqual(first, second);
    deepStrictEqual(JSON.parse(JSON.stringify(candidates)), before);
    equal(first.version, MEAL_COHERENCE_VERSION);
  });
});

// ---------------------------------------------------------------------------
// Calibration — these thresholds were tuned against the real 3512-recipe
// corpus, where an uncalibrated analyzer marked ~20% of arbitrary main+side
// pairs "major". These tests pin the decisions that fixed it.
// ---------------------------------------------------------------------------

describe("calibration", () => {
  it("treats an everyday cheese overlap as minor, not blocking", () => {
    const review = analyzeMealCoherence({
      main: {
        id: "spaghetti-carbonara",
        title: "Spaghetti Carbonara",
        role: "main",
        ingredients: ing("spaghetti", "guanciale", "egg yolks", "pecorino"),
        method: ["Toss off the heat."],
      },
      components: [
        {
          id: "tomato-feta-salad",
          title: "Tomato Salad",
          role: "side",
          ingredients: ing("tomatoes", "feta", "olive oil", "oregano"),
          method: ["Season and dress."],
        },
      ],
    });
    const cheese = review.findings.find((f) => f.lane === "cheese");
    ok(cheese, "the overlap is still reported");
    equal(cheese.severity, "minor");
    ok(!hasBlockingFinding(review));
  });

  it("escalates to major when cheese defines both dishes", () => {
    const review = analyzeMealCoherence({
      main: {
        id: "four-cheese-gratin",
        title: "Four-Cheese Potato Gratin",
        role: "main",
        ingredients: ing("potatoes", "gruyere", "cheddar", "parmesan"),
        method: ["Bake until bubbling."],
      },
      components: [
        {
          id: "halloumi-skewers",
          title: "Grilled Halloumi Skewers",
          role: "side",
          ingredients: ing("halloumi", "peppers"),
          method: ["Grill until charred."],
        },
      ],
    });
    equal(review.findings.find((f) => f.lane === "cheese")?.severity, "major");
  });

  it("never blocks a meal just because the total cooking time is long", () => {
    const review = analyzeMealCoherence({
      main: {
        id: "twelve-hour-brisket",
        title: "Twelve-Hour Brisket",
        role: "main",
        ingredients: ing("beef brisket", "black pepper"),
        method: ["Smoke low and slow."],
        timeMinutes: 720,
      },
      components: [
        {
          id: "quick-slaw",
          title: "Quick Slaw",
          role: "side",
          ingredients: ing("white cabbage", "cider vinegar"),
          method: ["Shred and dress."],
          timeMinutes: 10,
        },
      ],
      dayType: "weekend",
    });
    const pressure = review.findings.find((f) => f.kind === "execution-pressure");
    ok(pressure, "a long total is still surfaced");
    equal(pressure.severity, "minor");
    ok(!hasBlockingFinding(review), "unattended smoking time must not block the meal");
  });

  it("still blocks on three fried components", () => {
    const fry = (id: string, title: string) => ({
      id,
      title,
      role: "side" as const,
      ingredients: ing("plain flour", "sunflower oil"),
      method: ["Deep-fry until golden."],
    });
    const review = analyzeMealCoherence({
      main: {
        id: "fried-chicken",
        title: "Fried Chicken",
        role: "main",
        ingredients: ing("chicken thighs", "buttermilk", "plain flour"),
        method: ["Deep-fry in batches until golden."],
      },
      components: [fry("onion-rings", "Onion Rings"), fry("hush-puppies", "Hush Puppies")],
    });
    ok(hasBlockingFinding(review));
    equal(review.findings.find((f) => f.kind === "fried-repeat")?.severity, "major");
  });
});
