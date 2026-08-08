// The prepared shelf has to survive being written down.
//
// Preparation assembles a 12–14 idea shelf and hands it to the canonical save
// boundary, which then applies the planner's exclusion rules to it. Those two
// halves disagreed: the shelf is built with exposure memory applied (a 12-week
// rest, written at rollover), while the save boundary re-applied the *older*
// blanket five-week "was offered recently" lookback to every set regardless of
// policy. The result was a boundary that deleted the shelf it had just been
// given — week two of any two consecutive prepared weeks lost every idea week
// one had offered, and the Friday watchdog then found a set too short to be
// healthy and rebuilt it into the same hole.
//
// These run against a real libsql file database, through the real
// prepareWeek → saveMealPlan → loadMealPlan path, with only the recipe
// resolver and the candidate pool injected.
//
// Run with: npm test  (node --test; Node 24 strips types natively)

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point db.ts at an isolated database before any getDb() call happens.
process.env.NABU_DB_DIR = mkdtempSync(join(tmpdir(), "planner-save-boundary-test-"));
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;

import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { before, describe, it } from "node:test";
import {
  assessShelfHealth,
  prepareWeek,
  runWatchdog,
  toShelfCandidate,
  type PreparationDeps,
} from "./planner-preparation.ts";
import { SHELF_POLICY_VERSION } from "./planner-shelf.ts";
import { loadMealPlan, saveMealPlan } from "./meals-persistence.ts";
import { createCookEvent, getDb, setRecipeFeedback } from "./db.ts";
import type { MealPlan } from "./meals.ts";
import type { Recipe } from "./recipes.ts";

const NOW = new Date("2026-08-13T05:30:00.000Z"); // a Thursday
const LEGACY_WEEK = "2026-W33";

// ---------------------------------------------------------------------------
// A catalog wide enough for the shelf's diversity rules
// ---------------------------------------------------------------------------

type Spec = {
  id: string;
  name: string;
  cuisine: string;
  protein: string;
  starch: string;
  dietary?: string[];
};

const SPECS: Spec[] = [
  { id: "lentil-stew", name: "Winter lentil stew", cuisine: "French", protein: "lentils", starch: "potatoes", dietary: ["vegan"] },
  { id: "chickpea-curry", name: "Chickpea and spinach curry", cuisine: "Indian", protein: "chickpeas", starch: "basmati rice", dietary: ["vegan"] },
  { id: "roast-cod", name: "Roast cod with fennel", cuisine: "Italian", protein: "cod", starch: "potatoes" },
  { id: "tofu-stir-fry", name: "Ginger tofu stir-fry", cuisine: "Chinese", protein: "tofu", starch: "jasmine rice", dietary: ["vegan"] },
  { id: "chicken-traybake", name: "Lemon chicken traybake", cuisine: "Greek", protein: "chicken thighs", starch: "potatoes" },
  { id: "mushroom-barley", name: "Mushroom and barley pot", cuisine: "Swiss", protein: "mushrooms", starch: "pearl barley", dietary: ["vegetarian"] },
  { id: "salmon-miso", name: "Miso glazed salmon", cuisine: "Japanese", protein: "salmon", starch: "short grain rice" },
  { id: "bean-chili", name: "Black bean chili", cuisine: "Mexican", protein: "black beans", starch: "corn tortillas", dietary: ["vegan"] },
  { id: "pumpkin-risotto", name: "Pumpkin risotto", cuisine: "Italian", protein: "parmesan", starch: "risotto rice", dietary: ["vegetarian"] },
  { id: "prawn-noodles", name: "Prawn and lime noodles", cuisine: "Thai", protein: "prawns", starch: "rice noodles" },
  { id: "aubergine-bake", name: "Aubergine and tomato bake", cuisine: "Greek", protein: "feta", starch: "bulgur", dietary: ["vegetarian"] },
  { id: "beef-braise", name: "Slow braised beef with root vegetables", cuisine: "French", protein: "beef shin", starch: "potatoes" },
  { id: "leek-tart", name: "Leek and gruyere tart", cuisine: "Swiss", protein: "gruyere", starch: "spelt", dietary: ["vegetarian"] },
  { id: "cauliflower-dal", name: "Cauliflower dal", cuisine: "Indian", protein: "red lentils", starch: "basmati rice", dietary: ["vegan"] },
  { id: "trout-greens", name: "Pan fried trout with greens", cuisine: "Swiss", protein: "trout", starch: "new potatoes" },
  { id: "pasta-puttanesca", name: "Pasta puttanesca", cuisine: "Italian", protein: "anchovies", starch: "spaghetti" },
  { id: "tempeh-bowl", name: "Smoked tempeh grain bowl", cuisine: "Japanese", protein: "tempeh", starch: "farro", dietary: ["vegan"] },
  { id: "lamb-tagine", name: "Lamb and apricot tagine", cuisine: "Moroccan", protein: "lamb shoulder", starch: "couscous" },
  { id: "squash-soup", name: "Roast squash and sage soup", cuisine: "Swiss", protein: "white beans", starch: "sourdough", dietary: ["vegetarian"] },
  { id: "kimchi-fried-rice", name: "Kimchi fried rice", cuisine: "Korean", protein: "eggs", starch: "rice", dietary: ["vegetarian"] },
  { id: "sardine-pasta", name: "Sardine and lemon linguine", cuisine: "Italian", protein: "sardines", starch: "linguine" },
  { id: "pork-cabbage", name: "Braised pork with cabbage", cuisine: "Swiss", protein: "pork shoulder", starch: "potatoes" },
  { id: "halloumi-traybake", name: "Halloumi and pepper traybake", cuisine: "Greek", protein: "halloumi", starch: "quinoa", dietary: ["vegetarian"] },
  { id: "duck-lentils", name: "Duck legs with green lentils", cuisine: "French", protein: "duck legs", starch: "green lentils" },
];

function recipeFor(spec: Spec): Recipe {
  return {
    id: spec.id,
    name: spec.name,
    servings: "4",
    cuisine: spec.cuisine,
    dietary: spec.dietary ?? [],
    image: `/recipes/${spec.id}.jpg`,
    time: { prep: 15, cook: 30, total: 45 },
    category: { dish_type: ["main"], chapter: "" },
    ingredients: [
      { item: spec.protein, amount: "400 g" },
      { item: spec.starch, amount: "300 g" },
      { item: "onion", amount: "1" },
      { item: "carrot", amount: "2" },
      { item: "olive oil", amount: "2 tbsp" },
    ],
    method: ["Prepare the vegetables.", "Cook the base.", "Finish and season."],
  };
}

const RECIPES = new Map<string, Recipe>(SPECS.map((spec) => [spec.id, recipeFor(spec)]));

/** Two recipes that exist only to prove the harder rules still bite. */
for (const [id, name] of [
  ["legacy-offered-idea", "Offered under the old policy"],
  ["cooked-this-week", "Cooked two days ago"],
  ["planned-last-week", "Planned last week"],
  ["thumbed-down-idea", "Thumbed down"],
] as const) {
  RECIPES.set(id, recipeFor({ id, name, cuisine: "Other", protein: "chicken", starch: "rice" }));
}

const resolveRecipe = async (id: string) => RECIPES.get(id);

const catalogCandidates = SPECS.map((spec) =>
  toShelfCandidate(RECIPES.get(spec.id)!, { origin: "catalog", discovery: "catalog" }, NOW),
);

/**
 * The real production wiring, minus the two seams a plain-node test cannot
 * load: the recipe bundle and the web importer. `savePlan` is the same adapter
 * `buildPreparationDeps` uses.
 */
const deps: PreparationDeps = {
  now: NOW,
  loadPlan: (week) => loadMealPlan(week),
  savePlan: async (plan) => {
    const result = await saveMealPlan(plan, { resolveRecipe });
    return result.ok ? { ok: true, plan: result.plan } : { ok: false, reason: result.reason };
  },
  ensureWebInspirations: async () => ({ status: "skipped" }),
  loadWebCandidates: async () => [],
  loadCatalogCandidates: async () => catalogCandidates,
};

function candidateItem(recipeId: string) {
  return {
    recipeId,
    recipeName: RECIPES.get(recipeId)?.name ?? recipeId,
    source: null,
    image: null,
    dietary: [],
    cuisine: "Other",
    time: null,
    category: "main",
    courseTags: [],
    bucket: "meat" as const,
  };
}

function shelfPlan(week: string, recipeIds: string[], policyVersion = SHELF_POLICY_VERSION): MealPlan {
  return {
    week,
    days: [],
    locked: false,
    createdAt: NOW.toISOString(),
    candidateSet: {
      generatedAt: NOW.toISOString(),
      policyVersion,
      items: recipeIds.map(candidateItem),
    },
  };
}

// ---------------------------------------------------------------------------
// History the exclusion rules read
// ---------------------------------------------------------------------------

before(async () => {
  const twoDaysAgo = new Date(NOW.getTime() - 2 * 86_400_000).toISOString().split("T")[0];
  await createCookEvent({ recipeId: "cooked-this-week", cookedOn: twoDaysAgo, source: "test" });
  await setRecipeFeedback("thumbed-down-idea", "down");

  // An old-policy week: it never wrote an exposure record, so its offered ideas
  // are exactly what the five-week lookback still has to guard.
  const legacy: MealPlan = {
    ...shelfPlan(LEGACY_WEEK, ["legacy-offered-idea"], "planner-v2.2"),
    days: [
      {
        date: "2026-08-10",
        dayOfWeek: "Monday",
        type: "weekday",
        planningState: "assigned",
        recipeId: "planned-last-week",
        recipeName: "Planned last week",
      },
    ],
  };
  // Inserted directly: the boundary under test must not sanitize the fixture.
  const client = await getDb();
  await client.execute({
    sql: `INSERT INTO meal_plans (week, data, locked, created_at, updated_at)
          VALUES (?, ?, 0, ?, ?)`,
    args: [LEGACY_WEEK, JSON.stringify(legacy), legacy.createdAt, legacy.createdAt],
  });
});

// ---------------------------------------------------------------------------
// Two consecutive prepared weeks
// ---------------------------------------------------------------------------

describe("preparing two weeks in a row", () => {
  it("W34 stores a healthy 12–14 idea shelf", async () => {
    const outcome = await prepareWeek("2026-W34", deps);

    equal(outcome.status, "prepared");
    equal(outcome.healthy, true);
    ok(
      (outcome.shelfSize ?? 0) >= 12 && (outcome.shelfSize ?? 0) <= 14,
      `stored shelf size ${outcome.shelfSize} is outside 12–14`,
    );

    const stored = await loadMealPlan("2026-W34");
    equal(stored?.candidateSet?.policyVersion, SHELF_POLICY_VERSION);
    equal(stored?.candidateSet?.items.length, outcome.shelfSize);
    equal(assessShelfHealth(stored, NOW).healthy, true);
  });

  it("W35 stores a healthy shelf too — last week's shelf does not delete it", async () => {
    const outcome = await prepareWeek("2026-W35", deps);

    equal(outcome.status, "prepared");
    equal(outcome.healthy, true, "the second week is not left short by its own save");
    ok(
      (outcome.shelfSize ?? 0) >= 12 && (outcome.shelfSize ?? 0) <= 14,
      `stored shelf size ${outcome.shelfSize} is outside 12–14`,
    );

    const w34 = await loadMealPlan("2026-W34");
    const w35 = await loadMealPlan("2026-W35");
    const w34Ids = new Set(w34!.candidateSet!.items.map((i) => i.recipeId));
    const overlap = w35!.candidateSet!.items.filter((i) => w34Ids.has(i.recipeId));
    ok(
      overlap.length > 0,
      "the weeks really do overlap — without that, this test would prove nothing",
    );
    equal(assessShelfHealth(w35, NOW).healthy, true);
  });

  it("the watchdog leaves both stored weeks exactly as they are", async () => {
    for (const week of ["2026-W34", "2026-W35"]) {
      const before = await loadMealPlan(week);
      const outcome = await runWatchdog(week, deps);
      equal(outcome.status, "already-healthy", `${week} needed no repair`);
      equal(outcome.healthy, true);

      const after = await loadMealPlan(week);
      deepStrictEqual(
        after!.candidateSet!.items.map((i) => i.recipeId),
        before!.candidateSet!.items.map((i) => i.recipeId),
        `${week} was not rewritten`,
      );
      equal(after!.updatedAt, before!.updatedAt, `${week} was not touched at all`);
    }
  });
});

// ---------------------------------------------------------------------------
// What the policy-aware boundary still enforces
// ---------------------------------------------------------------------------

describe("save boundary under planner-shelf-1", () => {
  it("still drops recently cooked, recently planned and thumbed-down ideas", async () => {
    const result = await saveMealPlan(
      shelfPlan("2026-W37", [
        "cooked-this-week",
        "planned-last-week",
        "thumbed-down-idea",
        "lentil-stew",
      ]),
      { resolveRecipe },
    );
    ok(result.ok);

    const removed = result.ok ? result.candidateSanitation!.removed : [];
    deepStrictEqual(
      removed.map((r) => [r.recipeId, ...r.reasons]).sort(),
      [
        ["cooked-this-week", "recently-cooked"],
        ["planned-last-week", "recently-planned"],
        ["thumbed-down-idea", "negative-feedback"],
      ].sort(),
      "the harder rules are untouched by the policy split",
    );
    const stored = await loadMealPlan("2026-W37");
    deepStrictEqual(stored!.candidateSet!.items.map((i) => i.recipeId), ["lentil-stew"]);
  });

  it("still applies the offered lookback to ideas an older-policy week showed", async () => {
    // 2026-W33 was written under planner-v2.2 and produced no exposure record,
    // so the five-week guard is the only memory of it — and it still applies.
    const result = await saveMealPlan(
      shelfPlan("2026-W36", ["legacy-offered-idea", "chickpea-curry"]),
      { resolveRecipe },
    );
    ok(result.ok);

    const removed = result.ok ? result.candidateSanitation!.removed : [];
    deepStrictEqual(removed.map((r) => [r.recipeId, ...r.reasons]), [
      ["legacy-offered-idea", "recently-offered"],
    ]);
    const stored = await loadMealPlan("2026-W36");
    deepStrictEqual(stored!.candidateSet!.items.map((i) => i.recipeId), ["chickpea-curry"]);
  });

  it("keeps applying the blanket lookback to an older-policy set being saved", async () => {
    // Nothing changes for a set that is *itself* pre-policy: it has no exposure
    // memory behind it, so the old guard is all it has.
    const result = await saveMealPlan(
      shelfPlan("2026-W38", ["legacy-offered-idea", "lentil-stew"], "planner-v2.2"),
      { resolveRecipe },
    );
    ok(result.ok);

    const stored = await loadMealPlan("2026-W38");
    equal(
      stored!.candidateSet!.items.some((i) => i.recipeId === "legacy-offered-idea"),
      false,
      "an old-policy save still honours the old rule",
    );
  });
});
