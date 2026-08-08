// Integration tests for the canonical meal-plan save boundary (Phase 3B).
// Run with: npm test  (node --test; Node 24 strips types natively)
//
// These run against a real libsql file database in a temp directory — the
// exact production code path through saveMealPlan/loadMealPlan and the db.ts
// exclusion queries, with only the recipe resolver injected (the default
// resolver needs the `@/`-aliased bundle import that plain node cannot load).

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point db.ts at an isolated database before any getDb() call happens.
process.env.NABU_DB_DIR = mkdtempSync(join(tmpdir(), "meals-persistence-test-"));
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;

import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { describe, it, before } from "node:test";
import {
  saveMealPlan,
  loadMealPlan,
  normalizeDayPlanningStates,
} from "./meals-persistence.ts";
import {
  getDb,
  createCookEvent,
  setRecipeFeedback,
  claimWeeklyInspirationEnsure,
  completeWeeklyInspirationEnsure,
} from "./db.ts";
import type { MealPlan } from "./meals.ts";
import type { Recipe } from "./recipes.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WEEK = "2026-W31";
const PRIOR_WEEK = "2026-W30";

function makeRecipe(id: string, name: string, extra: Partial<Recipe> = {}): Recipe {
  return {
    id,
    name,
    servings: "4",
    ingredients: [
      { item: "onion", amount: "1" },
      { item: "olive oil", amount: "2 tbsp" },
      { item: "salt", amount: "" },
    ],
    method: ["Step one.", "Step two."],
    category: { dish_type: ["main"], chapter: "" },
    ...extra,
  };
}

const FIXTURE_RECIPES: Record<string, Recipe> = {
  "fresh-vichyssoise": makeRecipe("fresh-vichyssoise", "Asparagus vichyssoise"),
  "cooked-recent": makeRecipe("cooked-recent", "Cooked Recently"),
  "planned-prior": makeRecipe("planned-prior", "Planned Prior Week"),
  "offered-prior": makeRecipe("offered-prior", "Offered Prior Week"),
  "neg-recent": makeRecipe("neg-recent", "Thumbs Downed"),
  "pos-cooked": makeRecipe("pos-cooked", "Loved But Just Cooked"),
  "assigned-one": makeRecipe("assigned-one", "Assigned This Week"),
  "gate-fail": makeRecipe("gate-fail", "Herb dressing", {
    category: { dish_type: ["condiment"], chapter: "" },
  }),
};

const resolveRecipe = async (id: string) => FIXTURE_RECIPES[id];

function emptyDays(): MealPlan["days"] {
  const dates = [
    ["2026-07-27", "Monday", "weekday"],
    ["2026-07-28", "Tuesday", "weekday"],
    ["2026-07-29", "Wednesday", "weekday"],
    ["2026-07-30", "Thursday", "weekday"],
    ["2026-07-31", "Friday", "weekday"],
    ["2026-08-01", "Saturday", "weekend"],
    ["2026-08-02", "Sunday", "weekend"],
  ] as const;
  return dates.map(([date, dayOfWeek, type]) => ({
    date,
    dayOfWeek,
    type,
    planningState: "open" as const,
    recipeId: null,
    recipeName: null,
  }));
}

function makePlan(week: string, overrides: Partial<MealPlan> = {}): MealPlan {
  return {
    week,
    days: emptyDays(),
    locked: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function candidateItem(recipeId: string, bucket = "meat") {
  const recipe = FIXTURE_RECIPES[recipeId];
  return {
    recipeId,
    recipeName: recipe?.name ?? recipeId,
    source: null,
    image: null,
    dietary: [],
    cuisine: "Other",
    time: null,
    category: "Main",
    courseTags: [],
    bucket: bucket as "meat",
  };
}

// ---------------------------------------------------------------------------
// Seed recent history: a cook event, a prior-week plan with an assignment and
// a candidate set, and feedback rows.
// ---------------------------------------------------------------------------

before(async () => {
  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const cookedOn = twoDaysAgo.toISOString().split("T")[0];
  await createCookEvent({ recipeId: "cooked-recent", cookedOn, source: "test" });
  await createCookEvent({ recipeId: "pos-cooked", cookedOn, source: "test" });
  await createCookEvent({ recipeId: "assigned-one", cookedOn, source: "test" });

  await setRecipeFeedback("neg-recent", "down");
  await setRecipeFeedback("pos-cooked", "up");

  const priorPlan = makePlan(PRIOR_WEEK, {
    days: emptyDays().map((day, i) =>
      i === 0
        ? { ...day, planningState: "assigned" as const, recipeId: "planned-prior", recipeName: "Planned Prior Week" }
        : day,
    ),
    candidateSet: {
      generatedAt: new Date().toISOString(),
      policyVersion: "planner-v2.2",
      bucketContract: [3, 3, 2, 2, 2],
      items: [candidateItem("offered-prior")],
    },
  });
  // Insert the prior week directly so its candidate set is stored verbatim —
  // the boundary under test must not sanitize the historical fixture.
  const client = await getDb();
  await client.execute({
    sql: `INSERT INTO meal_plans (week, data, locked, created_at, updated_at)
          VALUES (?, ?, 0, ?, ?)`,
    args: [PRIOR_WEEK, JSON.stringify(priorPlan), priorPlan.createdAt, priorPlan.createdAt],
  });
});

// ---------------------------------------------------------------------------
// Save-boundary enforcement
// ---------------------------------------------------------------------------

describe("saveMealPlan candidate-set boundary", () => {
  it("removes recently cooked/planned/offered and suppressed candidates on any save path", async () => {
    const plan = makePlan(WEEK, {
      days: emptyDays().map((day, i) =>
        i === 0
          ? { ...day, planningState: "assigned" as const, recipeId: "assigned-one", recipeName: "Assigned This Week" }
          : day,
      ),
      candidateSet: {
        generatedAt: new Date().toISOString(),
        policyVersion: "planner-v2.2",
        bucketContract: [3, 3, 2, 2, 2],
        items: [
          candidateItem("fresh-vichyssoise"),
          candidateItem("cooked-recent"),
          candidateItem("planned-prior"),
          candidateItem("offered-prior"),
          candidateItem("neg-recent"),
          candidateItem("pos-cooked"),
          candidateItem("assigned-one"),
        ],
      },
    });

    const result = await saveMealPlan(plan, { resolveRecipe });
    ok(result.ok, "save succeeds");
    ok(result.ok && result.candidateSanitation, "sanitation summary returned");

    const removedIds = result.ok
      ? result.candidateSanitation!.removed.map((r) => r.recipeId).sort()
      : [];
    deepStrictEqual(removedIds, ["cooked-recent", "neg-recent", "offered-prior", "planned-prior", "pos-cooked"]);

    const stored = await loadMealPlan(WEEK);
    const storedIds = stored?.candidateSet?.items.map((i) => i.recipeId).sort();
    deepStrictEqual(storedIds, ["assigned-one", "fresh-vichyssoise"]);
  });

  it("positive feedback never bypasses recent-cook exclusions", async () => {
    // pos-cooked is thumbs-upped AND recently cooked — the previous test
    // proved it was removed. Assert the DB state directly for clarity.
    const stored = await loadMealPlan(WEEK);
    ok(stored, "week stored");
    equal(
      stored!.candidateSet!.items.some((i) => i.recipeId === "pos-cooked"),
      false,
      "thumbs-upped but recently cooked recipe is not in the saved candidate set",
    );
  });

  it("keeps an assigned candidate even when it is excluded (visible-but-disabled)", async () => {
    const stored = await loadMealPlan(WEEK);
    equal(
      stored!.candidateSet!.items.some((i) => i.recipeId === "assigned-one"),
      true,
      "assigned-one is recently cooked but stays because it is assigned to a day",
    );
  });

  it("recomputes persisted bucket labels from the authoritative classifier", async () => {
    const stored = await loadMealPlan(WEEK);
    const vichyssoise = stored!.candidateSet!.items.find((i) => i.recipeId === "fresh-vichyssoise");
    equal(vichyssoise?.bucket, "soup", "persisted 'meat' label was overridden to soup");
  });

  it("drops candidates that fail the planner-main gate at save", async () => {
    const plan = makePlan("2026-W45", {
      candidateSet: {
        generatedAt: new Date().toISOString(),
        policyVersion: "planner-v2.2",
        bucketContract: [3, 3, 2, 2, 2],
        items: [candidateItem("gate-fail"), candidateItem("fresh-vichyssoise")],
      },
    });
    const result = await saveMealPlan(plan, { resolveRecipe });
    ok(result.ok);
    const stored = await loadMealPlan("2026-W45");
    deepStrictEqual(
      stored!.candidateSet!.items.map((i) => i.recipeId),
      ["fresh-vichyssoise"],
    );
    const removed = result.ok ? result.candidateSanitation!.removed : [];
    deepStrictEqual(removed.map((r) => [r.recipeId, ...r.reasons]), [["gate-fail", "not-main-eligible"]]);
  });

  it("keeps unresolvable candidate items unchanged (backward-compatible reads)", async () => {
    const ghostItem = { ...candidateItem("fresh-vichyssoise"), recipeId: "ghost-recipe", recipeName: "Ghost", bucket: "fish" as const };
    const plan = makePlan("2026-W46", {
      candidateSet: {
        generatedAt: new Date().toISOString(),
        policyVersion: "planner-v2.2",
        bucketContract: [3, 3, 2, 2, 2],
        items: [ghostItem],
      },
    });
    const result = await saveMealPlan(plan, { resolveRecipe });
    ok(result.ok);
    const stored = await loadMealPlan("2026-W46");
    equal(stored!.candidateSet!.items[0].recipeId, "ghost-recipe");
    equal(stored!.candidateSet!.items[0].bucket, "fish", "stale bucket kept when recipe is unresolvable");
  });

  it("still rejects writes to a locked plan", async () => {
    const client = await getDb();
    const locked = makePlan("2026-W34", { locked: true });
    await client.execute({
      sql: `INSERT INTO meal_plans (week, data, locked, created_at, updated_at)
            VALUES (?, ?, 1, ?, ?)`,
      args: ["2026-W34", JSON.stringify(locked), locked.createdAt, locked.createdAt],
    });
    const result = await saveMealPlan(makePlan("2026-W34"), { resolveRecipe });
    deepStrictEqual(result, { ok: false, reason: "locked" });
  });
});

// ---------------------------------------------------------------------------
// Skipped vs planned-but-unlogged (persistence side)
// ---------------------------------------------------------------------------

describe("skipped-day persistence", () => {
  it("persists skipped for unassigned days with dated skip-meal context", async () => {
    const plan = makePlan("2026-W35", {
      context: [
        { id: "ctx1", date: "2026-07-28", kind: "restaurant", note: "Out for dinner", effect: "skip-meal" },
      ],
    });
    const result = await saveMealPlan(plan, { resolveRecipe });
    ok(result.ok);
    const stored = await loadMealPlan("2026-W35");
    equal(stored!.days[1].planningState, "skipped", "Tuesday is persisted as skipped");
    equal(stored!.days[0].planningState, "open", "Monday stays open");
  });

  it("an assignment wins over a stale skipped marker, and removing context un-skips", () => {
    const plan = makePlan(WEEK, {
      days: emptyDays().map((day, i) => {
        if (i === 0) {
          return { ...day, planningState: "skipped" as const, recipeId: "assigned-one", recipeName: "Assigned" };
        }
        if (i === 1) return { ...day, planningState: "skipped" as const };
        return day;
      }),
    });
    const normalized = normalizeDayPlanningStates(plan);
    equal(normalized.days[0].planningState, "assigned", "assigned day cannot stay skipped");
    equal(normalized.days[1].planningState, "open", "skipped without context reverts to open");
  });
});

// ---------------------------------------------------------------------------
// Weekly-inspiration ensure claims
// ---------------------------------------------------------------------------

describe("claimWeeklyInspirationEnsure", () => {
  it("grants one claim, blocks concurrent claims, and enforces the cooldown", async () => {
    equal(await claimWeeklyInspirationEnsure("2026-W40"), true, "first claim wins");
    equal(await claimWeeklyInspirationEnsure("2026-W40"), false, "fresh running claim blocks");
    await completeWeeklyInspirationEnsure("2026-W40", "failed");
    equal(await claimWeeklyInspirationEnsure("2026-W40"), false, "completed attempt blocks until cooldown");
  });
});
