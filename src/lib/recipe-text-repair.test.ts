// November 10, 2026 catalog cleanup — workstream A. Every fixture below is a
// real record from the static catalog before the repair. Run with: npm test

import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  normalizeTitle,
  recipeTextMetrics,
  rejoinInlineHyphenation,
  rejoinLigatureSplits,
  repairIngredientSplits,
  repairMethodSteps,
} from "./recipe-text-repair.ts";

// A small fixed lexicon keeps the rules testable without the corpus.
const WORDS = new Set([
  "preheat", "preheated", "heat", "pre", "large", "green", "litre", "litres", "lebanese", "fish", "finely", "finger", "flour",
  "firm", "remaining", "oyster", "tender", "influenced", "briefly", "olive", "rated", "grated", "fourth", "one",
  "crisp", "safe", "microwave", "garlic", "low", "medium", "our", "ten",
]);
const isWord = (w: string) => WORDS.has(w.toLowerCase());
const STANDALONE = new Set(["olive", "rated", "one", "fourth", "crisp", "safe", "microwave", "low", "medium", "our", "ten"]);
const isStandalone = (w: string) => STANDALONE.has(w.toLowerCase());

describe("repairMethodSteps — one sentence split across steps", () => {
  it("greek-lentil-soup: rejoins “…smoked” / “paprika…” and leaves the short complete steps alone", () => {
    const method = [
      "Take a large pan.",
      "Add the chopped onions and olive oil into it.",
      "Add the tomatoes, oregano, bay leaf, salt, black pepper, thyme, smoked",
      "paprika, mix spice powder, and chives into the pan.",
      "Cook the ingredients well.",
    ];
    const { steps, changes } = repairMethodSteps(method, { isWord });
    deepStrictEqual(steps, [
      "Take a large pan.",
      "Add the chopped onions and olive oil into it.",
      "Add the tomatoes, oregano, bay leaf, salt, black pepper, thyme, smoked paprika, mix spice powder, and chives into the pan.",
      "Cook the ingredients well.",
    ]);
    equal(changes.filter((c) => c.kind === "merge").length, 1);
  });

  it("french-onion-soup: drops the bled-in chapter introduction after the last step", () => {
    const method = [
      "Serve the soup with toasted bread slices.",
      "The dish is ready to be served.",
      "Chapter 3: The Famous French Dinner Recipes",
      "French dinner recipes are extremely healthy and loved by people everywhere",
      "in the world. Following are some classic dinner recipes that are rich in",
    ];
    const { steps } = repairMethodSteps(method, { isWord });
    deepStrictEqual(steps, ["Serve the soup with toasted bread slices.", "The dish is ready to be served."]);
  });

  it("brioche-bread: joins a clause cut after a comma and keeps a new sentence separate", () => {
    const { steps } = repairMethodSteps(
      [
        "Knead until the dough becomes glossy and elastic, about 10 to 13 minutes,",
        "scraping down the bowl every 4 to 5 minutes.",
        "preheat oven to 400 degrees Fahrenheit (190 degrees Celsius).",
      ],
      { isWord },
    );
    deepStrictEqual(steps, [
      "Knead until the dough becomes glossy and elastic, about 10 to 13 minutes, scraping down the bowl every 4 to 5 minutes.",
      "Preheat oven to 400 degrees Fahrenheit (190 degrees Celsius).",
    ]);
  });

  it("joins “…preheat oven to” / “375°F.” and “…in a” / “Dutch oven…”, but not a numbered step or a lost paragraph", () => {
    deepStrictEqual(
      repairMethodSteps(["Grease the loaf pans and preheat oven to", "375°F. Mix the flour."], { isWord }).steps,
      ["Grease the loaf pans and preheat oven to 375°F. Mix the flour."],
    );
    deepStrictEqual(
      repairMethodSteps(["Heat 2 tablespoons oil in a", "Dutch oven over medium high heat."], { isWord }).steps,
      ["Heat 2 tablespoons oil in a Dutch oven over medium high heat."],
    );
    // green-tomato-salsa: "having a" / "2 Put …" — text was lost, a join would invent a sentence.
    deepStrictEqual(
      repairMethodSteps(["Place them on a baking sheet having a", "2 Put the baking sheet in the oven."], { isWord }).steps,
      ["Place them on a baking sheet having a", "2 Put the baking sheet in the oven."],
    );
    // buckwheat-oatmeal: "…even better if" / "The buckwheat…" stays apart.
    deepStrictEqual(
      repairMethodSteps(["They taste even better if", "The buckwheat oatmeal in this recipe is soft."], { isWord }).steps,
      ["They taste even better if", "The buckwheat oatmeal in this recipe is soft."],
    );
  });

  it("does not join a section heading to the step that follows it", () => {
    const method = ["MAKE SPONGE:", "Heat milk to around 100 degrees.", "For the sauce", "Melt the butter."];
    deepStrictEqual(repairMethodSteps(method, { isWord }).steps, method);
  });

  it("hyphenation: “pre-” + “heated” becomes one word; “one-” + “fourth” keeps its hyphen", () => {
    deepStrictEqual(
      repairMethodSteps(["Season and place in pre-", "heated pan; brown well on all sides."], { isWord, isStandaloneWord: isStandalone }).steps,
      ["Season and place in preheated pan; brown well on all sides."],
    );
    deepStrictEqual(
      repairMethodSteps(["Sprinkle with one-", "fourth of the spinach-cheese mixture."], { isWord, isStandaloneWord: isStandalone }).steps,
      ["Sprinkle with one-fourth of the spinach-cheese mixture."],
    );
  });

  it("drops the next recipe's page (Ottolenghi Simple: title, intro and notes after the last step)", () => {
    const method = [
      "Bring a large pot of salted water to a boil and cook the spaghetti until al dente.",
      "Finish with a sprinkling of chile flakes and serve, with a lemon wedge on the side.",
      "Gnocchi alla Romana",
      "Comfort food does not get any more comforting than this.",
      "Pictured on this page, left",
    ];
    const { steps, changes } = repairMethodSteps(method, {
      isWord,
      otherTitles: new Set([normalizeTitle("Gnocchi alla Romana")]),
    });
    deepStrictEqual(steps, method.slice(0, 2));
    ok(changes.some((c) => c.kind === "drop-next-recipe"));
  });

  it("drops a swallowed recipe announced by a title + “Instructions” heading (burrito-egg-rolls)", () => {
    const method = ["Serve immediately with the guacamole.", "Cabbage Burritos", "Instructions", "1 tbsp. olive oil"];
    deepStrictEqual(repairMethodSteps(method, { isWord }).steps, ["Serve immediately with the guacamole."]);
  });

  it("drops page notes, separators and metadata lines, never an instruction", () => {
    const method = [
      "Cook Time: 45 minutes",
      "Servings Size: 6",
      "Preheat your oven to 350 degrees F.",
      "Pictured on this page",
      "XXXXXXXXXXXXXXXXXXXX",
      "Bake for 20 minutes.",
    ];
    deepStrictEqual(repairMethodSteps(method, { isWord }).steps, ["Preheat your oven to 350 degrees F.", "Bake for 20 minutes."]);
  });

  it("repairs ligature damage inside a step (coconut-crusted-fish-fingers, Real Thai)", () => {
    const { steps } = repairMethodSteps(
      ["Leave in the fridge (don’t leave it for much longer, as the  sh will start to disintegrate).", "Add the fi sh sauce and the oys- ter sauce."],
      { isWord, isStandaloneWord: isStandalone },
    );
    deepStrictEqual(steps, [
      "Leave in the fridge (don’t leave it for much longer, as the fish will start to disintegrate).",
      "Add the fish sauce and the oyster sauce.",
    ]);
  });

  it("never invents, reorders or rewords: every output word comes from the input", () => {
    const input = ["Add the tomatoes, smoked", "paprika and stock.", "Simmer."];
    const out = repairMethodSteps(input, { isWord }).steps;
    deepStrictEqual(out.join(" ").split(/\s+/), input.join(" ").split(/\s+/));
  });
});

describe("repairIngredientSplits — a word split between amount and item", () => {
  it("rejoins the letter the importer took for a unit", () => {
    const { ingredients, changes } = repairIngredientSplits(
      [
        { amount: "1 g", item: "reen bell pepper, diced" },
        { amount: "2 l", item: "arge portabella mushroom caps" },
        { amount: "1 L", item: "ebanese cucumber, peeled" },
        { amount: "2 l", item: "itres chicken stock" },
        { amount: "½ l", item: "arge Savoy cabbage" },
      ],
      { isWord, isStandaloneWord: isStandalone },
    );
    deepStrictEqual(ingredients, [
      { amount: "1", item: "green bell pepper, diced" },
      { amount: "2", item: "large portabella mushroom caps" },
      { amount: "1", item: "Lebanese cucumber, peeled" },
      { amount: "2", item: "litres chicken stock" },
      { amount: "½", item: "large Savoy cabbage" },
    ]);
    equal(changes.length, 5);
  });

  it("leaves real units and ambiguous splits alone", () => {
    const input = [
      { amount: "2 T", item: "olive oil" }, // a tablespoon, and “olive” is a word
      { amount: "1 g", item: "rated cheese" }, // “rated” is a word: ambiguous, untouched
      { amount: "200 g", item: "flour" },
    ];
    const { ingredients, changes } = repairIngredientSplits(input, { isWord, isStandaloneWord: isStandalone });
    deepStrictEqual(ingredients, input);
    equal(changes.length, 0);
  });

  it("rejoins ligature splits and drops bare step numbers filed as ingredients (Ottolenghi Simple)", () => {
    const { ingredients } = repairIngredientSplits(
      [
        { amount: "4", item: "fi sh sauce" },
        { amount: "1", item: "lemon:  nely zest to get 1 tsp" },
        { amount: "", item: "1." },
        { amount: "", item: "2." },
      ],
      { isWord, isStandaloneWord: isStandalone },
    );
    deepStrictEqual(ingredients, [
      { amount: "4", item: "fish sauce" },
      { amount: "1", item: "lemon: finely zest to get 1 tsp" },
    ]);
  });

  it("keeps every amount digit (only a stray letter moves)", () => {
    const { ingredients } = repairIngredientSplits([{ amount: "3–4 g", item: "arlic cloves, sliced" }], { isWord, isStandaloneWord: isStandalone });
    deepStrictEqual(ingredients, [{ amount: "3–4", item: "garlic cloves, sliced" }]);
  });
});

describe("text helpers", () => {
  it("rejoinLigatureSplits keeps “fl oz”", () => {
    equal(rejoinLigatureSplits("4 fl oz fi sh sauce, infl uenced, briefl y", isWord), "4 fl oz fish sauce, influenced, briefly");
  });
  it("rejoinInlineHyphenation joins line-end hyphens only when the tail is not a word", () => {
    equal(rejoinInlineHyphenation("heat the remain- ing oil; medium- low; ten- der", isWord, isStandalone), "heat the remaining oil; medium- low; tender");
  });
});

describe("recipeTextMetrics — the November 10 baseline definitions", () => {
  it("counts short steps, lowercase starts, continuation pairs and ingredient splits", () => {
    const m = recipeTextMetrics(
      {
        method: ["Add the tomatoes, smoked", "paprika into the pan.", "Mix well."],
        ingredients: [{ amount: "1 g", item: "reen pepper" }],
      },
      isWord,
      isStandalone,
    );
    deepStrictEqual(m, { shortSteps: 3, lowercaseStart: true, continuationPairs: 1, ingredientSplits: 1 });
  });
});

describe("the repaired catalog", () => {
  const bundle = JSON.parse(
    readFileSync(new URL("../data/recipes-bundle.json", import.meta.url), "utf8"),
  ) as { id: string; method: string[]; ingredients: { item: string; amount: string }[] }[];
  const byId = new Map(bundle.map((r) => [r.id, r]));

  it("greek-lentil-soup reads as whole sentences", () => {
    const steps = byId.get("greek-lentil-soup")?.method ?? [];
    ok(steps.includes("Add the tomatoes, oregano, bay leaf, salt, black pepper, thyme, smoked paprika, mix spice powder, and chives into the pan."));
    ok(steps.every((s) => /^[A-Z]/.test(s)));
  });

  it("french-onion-soup ends with its own last step", () => {
    const steps = byId.get("french-onion-soup")?.method ?? [];
    equal(steps.at(-1), "The dish is ready to be served.");
    ok(!steps.some((s) => /chapter/i.test(s)));
  });

  it("no static recipe has a step that starts lowercase", () => {
    const offenders = bundle.filter((r) => r.method.some((s) => /^[a-z]/.test(s.trim()))).map((r) => r.id);
    deepStrictEqual(offenders, []);
  });

  it("whole-roasted celery root has its book steps back (Ottolenghi Simple rebuild)", () => {
    const recipe = byId.get("whole-roasted-celery-root-with-coriander-seed-oil");
    equal(recipe?.method[0], "Preheat the oven to 375°F.");
    equal(recipe?.method.length, 3);
    ok(!recipe?.ingredients.some((i) => /^\d+\.$/.test(i.item.trim())));
  });

  it("no ingredient keeps a letter split like “1 g” + “reen”", () => {
    const offenders = bundle.flatMap((r) =>
      r.ingredients.filter((i) => /^(reen|arge|itres?|ebanese)\b/.test(String(i.item ?? ""))).map(() => r.id),
    );
    deepStrictEqual(offenders, []);
  });
});
