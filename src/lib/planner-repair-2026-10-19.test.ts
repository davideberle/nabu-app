// Regression tests for the 2026-10-19 meal planner repair (kitchen
// planner-repair-2026-10-19/WORK.md, R2 R4 R5 R6):
//
// - week finalization is retired: no save can finalize or reopen a week, and
//   ordinary planning saves have no shopping effects
// - a weekend brunch and a dinner on the same date persist and project
//   separately
// - a household adaptation and its original are one dish for recency, so
//   cooking or planning one keeps the other off the shelf
// - cook events stay idempotent
//
// Real libsql file database in a temp directory, like meals-persistence.test.ts.
// Run with: npm test

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NABU_DB_DIR = mkdtempSync(join(tmpdir(), "planner-repair-test-"));
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;

import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { before, describe, it } from "node:test";
import { createHash } from "node:crypto";
import { loadMealPlan, saveMealPlan } from "./meals-persistence.ts";
import {
  createCookEvent,
  createCookEventIfMissing,
  createMyRecipe,
  getCookEventsForDateRange,
  getDb,
  getPlannerRecencyExclusions,
} from "./db.ts";
import { expandRecipeAliases } from "./meals-core.ts";
import { projectDayHistory } from "./meal-history.ts";
import type { MealPlan } from "./meals.ts";
import type { Recipe } from "./recipes.ts";

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
    method: ["Prepare all ingredients for the recipe.", "Cook everything until it is ready to serve."],
    category: { dish_type: ["main"], chapter: "" },
    image: `/recipes/${id}.jpg`,
    time: { total: 30 },
    ...extra,
  };
}

const RECIPES: Record<string, Recipe> = {
  "fooby-original-risotto": makeRecipe("fooby-original-risotto", "Pumpkin and Feta Risotto"),
  "household-saffron-risotto": makeRecipe("household-saffron-risotto", "Saffron risotto with roasted pumpkin", {
    adaptedFrom: { recipeId: "fooby-original-risotto", name: "Pumpkin and Feta Risotto" },
  }),
  "planned-adaptation": makeRecipe("planned-adaptation", "Planned household version", {
    adaptedFrom: { recipeId: "planned-original" },
  }),
  "planned-original": makeRecipe("planned-original", "Planned original"),
  "similar-name-risotto": makeRecipe("similar-name-risotto", "Pumpkin risotto"),
  "lentil-stew": makeRecipe("lentil-stew", "Lentil stew"),
  "huevos": makeRecipe("huevos", "Huevos Rancheros"),
  "ranchero": makeRecipe("ranchero", "Ranchero Sauce", { category: { dish_type: ["sauce"], chapter: "" } }),
  "beans": makeRecipe("beans", "Refried Beans", { category: { dish_type: ["side"], chapter: "" } }),
  "pasta": makeRecipe("pasta", "Creamy pumpkin pasta"),
};
const resolveRecipe = async (id: string) => RECIPES[id];

// 2026-W44 (Oct 26 – Nov 1) relative to "now" is irrelevant: the cooked window
// is computed from the real clock, so cook dates below are relative to today.
function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split("T")[0];
}

const WEEK = "2026-W44";
const PRIOR_WEEK = "2026-W43";

function days(week: "W43" | "W44"): MealPlan["days"] {
  const start = week === "W44" ? 26 : 19;
  const names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  return names.map((dayOfWeek, i) => {
    const day = start + i;
    const date = day <= 31 ? `2026-10-${String(day).padStart(2, "0")}` : `2026-11-${String(day - 31).padStart(2, "0")}`;
    return {
      date,
      dayOfWeek,
      type: i >= 4 ? ("weekend" as const) : ("weekday" as const),
      planningState: "open" as const,
      recipeId: null,
      recipeName: null,
      meal: null,
      brunch: null,
    };
  });
}

function shelfItem(recipeId: string) {
  return {
    recipeId,
    recipeName: RECIPES[recipeId]?.name ?? recipeId,
    source: null,
    image: null,
    dietary: [],
    cuisine: "Other",
    time: null,
    category: "Main",
    courseTags: [],
    bucket: "vegetarian" as const,
  };
}

function plan(week: string, overrides: Partial<MealPlan> = {}): MealPlan {
  return {
    week,
    status: "draft",
    days: days(week === WEEK ? "W44" : "W43"),
    context: [],
    notes: "Stored week note that the planner no longer shows",
    locked: false,
    createdAt: "2026-10-19T00:00:00.000Z",
    ...overrides,
  };
}

async function shoppingDigest(): Promise<string> {
  const client = await getDb();
  const drafts = await client.execute("SELECT * FROM shopping_drafts ORDER BY week");
  const outbox = await client.execute("SELECT * FROM shopping_outbox ORDER BY id");
  return createHash("sha256")
    .update(JSON.stringify([drafts.rows, outbox.rows], (_k, v) => (typeof v === "bigint" ? String(v) : v)))
    .digest("hex");
}

before(async () => {
  for (const id of ["household-saffron-risotto", "planned-adaptation"]) {
    await createMyRecipe(RECIPES[id]);
  }
  await createCookEvent({ recipeId: "household-saffron-risotto", cookedOn: isoDaysAgo(4), source: "test" });

  // A historical shopping record on an unrelated week must survive untouched.
  const client = await getDb();
  await client.execute({
    sql: `INSERT INTO shopping_drafts (week, status, plan_fingerprint, stale, data, approved_at, created_at, updated_at)
          VALUES ('2026-W30', 'approved', 'fp-old', 0, '{}', '2026-07-20T00:00:00Z', '2026-07-20T00:00:00Z', '2026-07-20T00:00:00Z')`,
  });
  await client.execute({
    sql: `INSERT INTO shopping_outbox (id, week, channel, item_id, item_name, quantity, reason, plan_fingerprint, status, attempts, last_error, synced_at, created_at, updated_at)
          VALUES ('2026-W30:david:milk', '2026-W30', 'david', 'milk', 'Milk', '1 l', NULL, 'fp-old', 'synced', 1, NULL, '2026-07-20T00:00:00Z', '2026-07-20T00:00:00Z', '2026-07-20T00:00:00Z')`,
  });

  // Prior week planned the household adaptation of "planned-original".
  const prior = plan(PRIOR_WEEK);
  prior.days[2] = {
    ...prior.days[2],
    planningState: "assigned",
    recipeId: "planned-adaptation",
    recipeName: "Planned household version",
    meal: { main: { id: "planned-adaptation", name: "Planned household version" } },
  };
  await client.execute({
    sql: "INSERT INTO meal_plans (week, data, locked, created_at, updated_at) VALUES (?, ?, 0, ?, ?)",
    args: [PRIOR_WEEK, JSON.stringify(prior), prior.createdAt, prior.createdAt],
  });
});

describe("week finalization is retired (R5)", () => {
  it("never stores a finalized status sent by a client", async () => {
    const result = await saveMealPlan(plan(WEEK, { status: "finalized" }), { resolveRecipe });
    ok(result.ok);
    equal(result.ok && result.plan.status, "draft");
    equal((await loadMealPlan(WEEK))!.status, "draft");
  });

  it("planning saves (assign, change, clear) have zero shopping effects", async () => {
    const before = await shoppingDigest();
    const assigned = plan(WEEK);
    assigned.days[0] = {
      ...assigned.days[0],
      planningState: "assigned",
      recipeId: "lentil-stew",
      recipeName: "Lentil stew",
      meal: { main: { id: "lentil-stew", name: "Lentil stew" } },
    };
    const first = await saveMealPlan({ ...assigned, updatedAt: new Date().toISOString() }, { resolveRecipe });
    ok(first.ok);
    equal(first.ok && first.shoppingInvalidated, undefined, "no draft for the week, nothing to invalidate");

    const cleared = { ...assigned, days: plan(WEEK).days, updatedAt: new Date(Date.now() + 1000).toISOString() };
    const second = await saveMealPlan(cleared, { resolveRecipe });
    ok(second.ok);
    equal(second.ok && second.shoppingInvalidated, undefined);

    equal(await shoppingDigest(), before, "shopping drafts and outbox are byte-identical");
    const client = await getDb();
    const queued = await client.execute("SELECT COUNT(*) AS n FROM shopping_outbox WHERE status = 'pending'");
    equal(Number(queued.rows[0]["n"]), 0, "nothing was ever enqueued");
  });

  it("keeps a historical finalized week fail-closed: no reopen, and a meal change only withdraws", async () => {
    const week = "2026-W29";
    const finalized = plan(week, { status: "finalized" });
    finalized.days[0] = {
      ...finalized.days[0],
      planningState: "assigned",
      recipeId: "lentil-stew",
      recipeName: "Lentil stew",
      meal: { main: { id: "lentil-stew", name: "Lentil stew" } },
    };
    const client = await getDb();
    await client.execute({
      sql: "INSERT INTO meal_plans (week, data, locked, created_at, updated_at) VALUES (?, ?, 0, ?, ?)",
      args: [week, JSON.stringify(finalized), finalized.createdAt, finalized.createdAt],
    });
    await client.execute({
      sql: `INSERT INTO shopping_drafts (week, status, plan_fingerprint, stale, data, approved_at, created_at, updated_at)
            VALUES (?, 'approved', 'fp', 0, '{}', '2026-07-13T00:00:00Z', '2026-07-13T00:00:00Z', '2026-07-13T00:00:00Z')`,
      args: [week],
    });
    await client.execute({
      sql: `INSERT INTO shopping_outbox (id, week, channel, item_id, item_name, quantity, reason, plan_fingerprint, status, attempts, last_error, synced_at, created_at, updated_at)
            VALUES (?, ?, 'david', 'lentils', 'Lentils', '500 g', NULL, 'fp', 'pending', 0, NULL, NULL, '2026-07-13T00:00:00Z', '2026-07-13T00:00:00Z')`,
      args: [`${week}:david:lentils`, week],
    });
    const otherWeeksBefore = await client.execute("SELECT * FROM shopping_outbox WHERE week <> '2026-W29' ORDER BY id");

    // A client that still sends "draft" (the old Reopen) changes nothing.
    const sameMeals = await saveMealPlan(
      { ...finalized, status: "draft", updatedAt: new Date().toISOString() },
      { resolveRecipe },
    );
    ok(sameMeals.ok);
    equal(sameMeals.ok && sameMeals.plan.status, "finalized");
    equal(sameMeals.ok && sameMeals.shoppingInvalidated, undefined);
    equal(String((await client.execute("SELECT status FROM shopping_outbox WHERE week = '2026-W29'")).rows[0]["status"]), "pending");

    // A meal change withdraws: draft, stale, queued row cancelled; nothing new.
    const changed = { ...finalized, updatedAt: new Date(Date.now() + 500).toISOString(), days: finalized.days.map((day, i) => (i === 0 ? { ...day, recipeId: "pasta", recipeName: "Creamy pumpkin pasta", meal: { main: { id: "pasta", name: "Creamy pumpkin pasta" } } } : day)) };
    const result = await saveMealPlan(changed, { resolveRecipe });
    ok(result.ok);
    equal(result.ok && result.plan.status, "draft");
    deepStrictEqual(result.ok && result.shoppingInvalidated, { cause: "meals-changed", returnedToDraft: true, cancelledOutboxItems: 1 });
    const draft = (await client.execute("SELECT status, stale FROM shopping_drafts WHERE week = '2026-W29'")).rows[0];
    equal(String(draft["status"]), "draft");
    equal(Number(draft["stale"]), 1);
    equal(String((await client.execute("SELECT status FROM shopping_outbox WHERE week = '2026-W29'")).rows[0]["status"]), "cancelled");
    const otherWeeksAfter = await client.execute("SELECT * FROM shopping_outbox WHERE week <> '2026-W29' ORDER BY id");
    deepStrictEqual(JSON.stringify(otherWeeksAfter.rows), JSON.stringify(otherWeeksBefore.rows), "historical synced rows untouched");
    equal(Number((await client.execute("SELECT COUNT(*) AS n FROM shopping_outbox WHERE status = 'pending'")).rows[0]["n"]), 0);
  });

  it("keeps stored week notes even though the planner no longer shows them (R3)", async () => {
    const stored = await loadMealPlan(WEEK);
    equal(stored!.notes, "Stored week note that the planner no longer shows");
  });
});

describe("brunch and dinner on the same date (R4)", () => {
  it("persist side by side", async () => {
    const current = (await loadMealPlan(WEEK))!;
    const sunday = current.days[6];
    current.days[6] = {
      ...sunday,
      planningState: "assigned",
      recipeId: "pasta",
      recipeName: "Creamy pumpkin pasta",
      meal: { main: { id: "pasta", name: "Creamy pumpkin pasta" } },
      brunch: {
        main: { id: "huevos", name: "Huevos Rancheros" },
        sides: [
          { id: "ranchero", name: "Ranchero Sauce" },
          { id: "beans", name: "Refried Beans" },
        ],
      },
    };
    const result = await saveMealPlan({ ...current, updatedAt: new Date(Date.now() + 2000).toISOString() }, { resolveRecipe });
    ok(result.ok);
    const stored = (await loadMealPlan(WEEK))!.days[6];
    equal(stored.meal?.main.id, "pasta");
    equal(stored.brunch?.main.id, "huevos");
    deepStrictEqual(stored.brunch?.sides?.map((side) => side.id), ["ranchero", "beans"]);
  });

  it("project separately: a dinner cook never marks the brunch cooked, and vice versa", async () => {
    const slot = (await loadMealPlan(WEEK))!.days[6];
    const base = {
      date: slot.date,
      today: "2026-11-05",
      slot,
      sessions: [],
      recipeNames: new Map<string, string>(),
      intentionallySkipped: false,
    };

    const dinnerOnly = projectDayHistory({ ...base, cookEvents: [{ recipeId: "pasta" }] });
    equal(dinnerOnly.status, "cooked-as-planned");
    equal(dinnerOnly.cookedRecipeId, "pasta");
    equal(dinnerOnly.brunch?.status, "planned-unlogged", "import/plan alone is not cooking");

    const brunchOnly = projectDayHistory({ ...base, cookEvents: [{ recipeId: "huevos" }, { recipeId: "beans" }] });
    equal(brunchOnly.brunch?.status, "cooked-as-planned");
    equal(brunchOnly.status, "planned-unlogged", "a brunch cook is not the dinner");
    equal(brunchOnly.cookedRecipeId, null);

    const both = projectDayHistory({ ...base, cookEvents: [{ recipeId: "huevos" }, { recipeId: "pasta" }] });
    equal(both.status, "cooked-as-planned");
    equal(both.cookedRecipeId, "pasta");
    equal(both.brunch?.status, "cooked-as-planned");
  });
});

describe("brunch side shared with dinner (R4)", () => {
  it("a dinner side that is also a brunch side does not mark the brunch cooked", () => {
    const slot = {
      date: "2026-11-01",
      dayOfWeek: "Sunday",
      type: "weekend" as const,
      planningState: "meal" as const,
      recipeId: "pasta",
      recipeName: "Creamy pumpkin pasta",
      meal: { main: { id: "pasta", name: "Creamy pumpkin pasta" }, sides: [{ id: "green-salad", name: "Green salad" }] },
      brunch: { main: { id: "huevos", name: "Huevos Rancheros" }, sides: [{ id: "green-salad", name: "Green salad" }] },
    };
    const history = projectDayHistory({
      date: slot.date,
      today: "2026-11-05",
      slot,
      cookEvents: [{ recipeId: "pasta" }, { recipeId: "green-salad" }],
      sessions: [],
      recipeNames: new Map(),
      intentionallySkipped: false,
    });
    equal(history.status, "cooked-as-planned");
    equal(history.brunch?.status, "planned-unlogged");
  });
});

describe("recent cooks across adaptation aliases (R6)", () => {
  it("expands only explicit links, in both directions and across siblings", () => {
    const links = [
      { recipeId: "household-a", adaptedFromId: "original" },
      { recipeId: "household-b", adaptedFromId: "original" },
    ];
    deepStrictEqual(
      [...expandRecipeAliases(new Set(["household-a"]), links)].sort(),
      ["household-a", "household-b", "original"],
    );
    deepStrictEqual([...expandRecipeAliases(new Set(["original"]), links)].sort(), ["household-a", "household-b", "original"]);
    deepStrictEqual([...expandRecipeAliases(new Set(["unrelated"]), links)], ["unrelated"]);
  });

  it("puts the original of a just-cooked adaptation into the cooked exclusion", async () => {
    const exclusions = await getPlannerRecencyExclusions(WEEK);
    ok(exclusions.recentlyCooked.has("household-saffron-risotto"));
    ok(exclusions.recentlyCooked.has("fooby-original-risotto"), "alias of the cooked adaptation");
    ok(!exclusions.recentlyCooked.has("similar-name-risotto"), "no name-based guessing");
    ok(exclusions.recentlyPlanned.has("planned-original"), "alias of last week's planned adaptation");
  });

  it("drops the alias from an already-built shelf at the save boundary, keeping unrelated ideas", async () => {
    const current = (await loadMealPlan(WEEK))!;
    const withShelf: MealPlan = {
      ...current,
      updatedAt: new Date(Date.now() + 3000).toISOString(),
      candidateSet: {
        generatedAt: "2026-10-18T08:36:37.795Z",
        policyVersion: "planner-shelf-2",
        items: ["fooby-original-risotto", "planned-original", "similar-name-risotto", "lentil-stew"].map(shelfItem),
      },
    };
    const result = await saveMealPlan(withShelf, {
      resolveRecipe,
      getLegacyOffered: async () => new Set(),
      resolveReviews: async () => new Map(),
    });
    ok(result.ok);
    const removed = result.ok ? result.candidateSanitation!.removed : [];
    deepStrictEqual(
      removed.filter((r) => r.reasons.some((reason) => reason.startsWith("recently-"))).map((r) => [r.recipeId, ...r.reasons]).sort(),
      [
        ["fooby-original-risotto", "recently-cooked"],
        ["planned-original", "recently-planned"],
      ],
    );
    const kept = (await loadMealPlan(WEEK))!.candidateSet!.items.map((item) => item.recipeId);
    ok(!kept.includes("fooby-original-risotto"));
    ok(kept.includes("similar-name-risotto"), "a different recipe with a similar name is not suppressed");
    // Assigned meals are untouched by the shelf cleanup.
    equal((await loadMealPlan(WEEK))!.days[6].meal?.main.id, "pasta");
  });
});

describe("cook events (R2)", () => {
  it("are idempotent per recipe, date and source", async () => {
    const date = isoDaysAgo(3);
    await createCookEventIfMissing({ recipeId: "lentil-stew", cookedOn: date, source: "meal-planner" });
    await createCookEventIfMissing({ recipeId: "lentil-stew", cookedOn: date, source: "meal-planner" });
    const events = (await getCookEventsForDateRange(date, date)).filter((e) => e.recipeId === "lentil-stew");
    equal(events.length, 1);
  });
});
