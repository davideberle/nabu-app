// Explicit .ts extensions: meals-persistence.ts is loaded directly by
// node --test, whose ESM resolver does not add extensions.
import {
  getDb,
  getLegacyOfferedRecipeIds,
  getPlannerRecencyExclusions,
  saveMealPlanRowWithInvalidation,
  type PlannerRecencyExclusions,
  type ShoppingInvalidation,
} from "./db.ts";
import { computePlanShoppingFingerprint } from "./shopping-fingerprint.ts";
import {
  getRecentWeekIds,
  plannerPolicy,
  sanitizeCandidateItems,
  reclassifyCandidateItems,
  type CandidateRemoval,
  type CandidateRelabel,
} from "./meals-core.ts";
import { SHELF_POLICY_VERSION } from "./planner-shelf.ts";
import type { MealPlan } from "./meals";
import type { Recipe } from "./recipes";

type MealDay = MealPlan["days"][number];

function timestamp(value: string | undefined | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasAssignedMeal(day: MealDay | undefined): boolean {
  return Boolean(day?.recipeId || day?.meal?.main?.id || day?.brunch?.main?.id);
}

function isOpenDay(day: MealDay): boolean {
  return (
    !day.recipeId &&
    !day.recipeName &&
    !day.meal &&
    !day.brunch &&
    (day.planningState === undefined || day.planningState === "open")
  );
}

function preserveStoredAssignmentsForStaleSave(
  incomingPlan: MealPlan,
  storedPlan: MealPlan
): MealPlan {
  const incomingAt = timestamp(incomingPlan.updatedAt);
  const storedAt = timestamp(storedPlan.updatedAt);
  if (storedAt === null || (incomingAt !== null && incomingAt >= storedAt)) {
    return incomingPlan;
  }

  const storedDaysByDate = new Map(
    storedPlan.days.map((day) => [day.date, day])
  );
  const days = incomingPlan.days.map((incomingDay) => {
    const storedDay = storedDaysByDate.get(incomingDay.date);
    if (storedDay && isOpenDay(incomingDay) && hasAssignedMeal(storedDay)) {
      return storedDay;
    }
    return incomingDay;
  });

  return { ...incomingPlan, days };
}

function collectAssignedRecipeIds(value: unknown, ids = new Set<string>()): Set<string> {
  if (!value) return ids;
  if (Array.isArray(value)) {
    for (const item of value) collectAssignedRecipeIds(item, ids);
    return ids;
  }
  if (typeof value !== "object") return ids;

  const record = value as Record<string, unknown>;
  for (const key of ["recipeId", "id"]) {
    if (typeof record[key] === "string" && record[key]) ids.add(record[key]);
  }
  for (const nested of Object.values(record)) collectAssignedRecipeIds(nested, ids);
  return ids;
}

async function promoteAssignedPlannerCandidates(
  client: Awaited<ReturnType<typeof getDb>>,
  plan: MealPlan,
): Promise<void> {
  const ids = new Set<string>();
  for (const day of plan.days) {
    if (day.planningState === "open" || day.planningState === "skipped") continue;
    collectAssignedRecipeIds(day, ids);
  }
  if (ids.size === 0) return;

  const columns = await client.execute("PRAGMA table_info(recipes)");
  const hasUpdatedAt = columns.rows.some((row) => row.name === "updated_at");

  for (const id of ids) {
    const result = await client.execute({
      sql: "SELECT data FROM recipes WHERE id = ?",
      args: [id],
    });
    if (result.rows.length === 0) continue;

    const recipe = JSON.parse(result.rows[0]["data"] as string) as Recipe;
    if (recipe.visibility !== "planner-candidate") continue;

    // Assignment is retention: the recipe stops being hidden staging and
    // becomes a normal, browsable My Recipe. `personal` rather than nothing,
    // because putting it on a day is exactly the deliberate choice that
    // visibility records — and it keeps a substantial light meal usable as a
    // dinner instead of dropping out of the planner on promotion.
    recipe.visibility = "personal";
    await client.execute({
      sql: hasUpdatedAt
        ? "UPDATE recipes SET data = ?, updated_at = ? WHERE id = ?"
        : "UPDATE recipes SET data = ? WHERE id = ?",
      args: hasUpdatedAt
        ? [JSON.stringify(recipe), new Date().toISOString(), id]
        : [JSON.stringify(recipe), id],
    });
  }
}

/**
 * True when a skip-meal context item targets this specific date. Week-level
 * context without a date never skips individual days.
 */
function hasSkipContextForDate(plan: MealPlan, date: string): boolean {
  return (plan.context ?? []).some(
    (item) => item.effect === "skip-meal" && item.date === date,
  );
}

/**
 * Normalize per-day planning states at the save boundary so an intentionally
 * skipped day is persisted distinguishably from a planned-but-unlogged one:
 *
 * - an unassigned day with a dated skip-meal context becomes `skipped`
 * - an unassigned day marked `skipped` without any skip context reverts to
 *   `open` (skipped is derived from context, so removing the context un-skips)
 * - an assigned day never stays `skipped`; the assignment wins
 *
 * Exported for tests.
 */
export function normalizeDayPlanningStates(plan: MealPlan): MealPlan {
  let changed = false;
  const days = plan.days.map((day) => {
    const assigned = hasAssignedMeal(day);
    const skipContext = hasSkipContextForDate(plan, day.date);

    let nextState = day.planningState;
    if (assigned) {
      if (day.planningState === "skipped" || day.planningState === "open" || day.planningState === undefined) {
        nextState = day.meal?.sides?.length ? "meal" : "assigned";
      }
    } else if (skipContext) {
      nextState = "skipped";
    } else if (day.planningState === "skipped") {
      nextState = "open";
    }

    if (nextState === day.planningState) return day;
    changed = true;
    return { ...day, planningState: nextState };
  });
  return changed ? { ...plan, days } : plan;
}

export type CandidateSanitationSummary = {
  removed: CandidateRemoval[];
  relabeled: CandidateRelabel[];
};

export type SaveResult =
  | {
      ok: true;
      candidateSanitation?: CandidateSanitationSummary;
      /**
       * The plan exactly as it was stored, after the save boundary applied
       * stale-save preservation, planning-state normalization, candidate
       * sanitation, and the shopping safety rule. Callers must reconcile their
       * local state to this rather than to what they sent: a meal-changing save
       * can return the week to `draft` server-side, and a client that keeps
       * showing "finalized" is showing a state that no longer exists.
       */
      plan: MealPlan;
      /**
       * Set when the save invalidated the week's shopping state — either
       * because it changed which recipes the week plans, or because it
       * explicitly reopened a finalized week.
       */
      shoppingInvalidated?: {
        cause: "meals-changed" | "reopened";
        returnedToDraft: boolean;
        cancelledOutboxItems: number;
      };
    }
  | { ok: false; reason: "locked" };

/** Test seams; production callers use the defaults. */
export type SaveMealPlanDeps = {
  getExclusions?: (week: string) => Promise<PlannerRecencyExclusions>;
  /** Ids offered by *older-policy* shelves in the recent-week window. */
  getLegacyOffered?: (week: string) => Promise<Set<string>>;
  resolveRecipe?: (id: string) => Promise<Recipe | undefined | null>;
};

function defaultLegacyOffered(week: string): Promise<Set<string>> {
  return getLegacyOfferedRecipeIds(
    getRecentWeekIds(week, plannerPolicy().recentWeeksLookback),
    SHELF_POLICY_VERSION,
  );
}

async function defaultResolveRecipe(id: string): Promise<Recipe | undefined> {
  // Dynamic import: recipes.ts pulls in the bundled JSON via the `@/` alias,
  // which plain-node test runs cannot resolve — tests inject a resolver.
  const { getRecipe } = await import("./recipes.ts");
  return getRecipe(id);
}

/**
 * Enforce the Phase 3B candidate-set save rules on the plan being written:
 * recent cooked/planned/offered and active negative-feedback exclusions,
 * followed by authoritative reclassification (bucket labels, planner-facing
 * name/cuisine, main-dish gate). Runs for every writer — the generator, the
 * planner UI, and any direct/manual/curated save all pass through here.
 *
 * The offered rule is the one that is policy-dependent, and it has to be:
 *
 *   `planner-shelf-1` sets are built with exposure memory already applied, and
 *     exposure is the authoritative "he saw this and passed" signal. Re-applying
 *     the blanket five-week offered lookback here would delete the shelf the
 *     Thursday run just assembled — every idea a recent week offered would be
 *     stripped on the way to disk, and the Friday watchdog would find a set too
 *     short to be healthy, week after week. Only shelves written under an
 *     *older* policy, which never produced an exposure record, still need the
 *     old guard.
 *   Older sets keep the blanket lookback exactly as before.
 *
 * Recent-cook, recent-plan and negative-feedback exclusions are unconditional
 * under both policies — they are harder rules than "was offered", and nothing
 * here relaxes them.
 */
async function enforceCandidateSaveBoundary(
  plan: MealPlan,
  deps: SaveMealPlanDeps,
): Promise<{ plan: MealPlan; summary: CandidateSanitationSummary | undefined }> {
  const items = plan.candidateSet?.items;
  if (!plan.candidateSet || !Array.isArray(items) || items.length === 0) {
    return { plan, summary: undefined };
  }

  const currentPolicy = plan.candidateSet.policyVersion === SHELF_POLICY_VERSION;
  const [exclusions, legacyOffered] = await Promise.all([
    (deps.getExclusions ?? getPlannerRecencyExclusions)(plan.week),
    currentPolicy
      ? (deps.getLegacyOffered ?? defaultLegacyOffered)(plan.week)
      : Promise.resolve(new Set<string>()),
  ]);

  const assignedIds = new Set<string>();
  for (const day of plan.days) {
    if (day.planningState === "open" || day.planningState === "skipped") continue;
    collectAssignedRecipeIds(day, assignedIds);
  }

  const sanitized = sanitizeCandidateItems(items, assignedIds, {
    recentlyCooked: exclusions.recentlyCooked,
    recentlyPlanned: exclusions.recentlyPlanned,
    recentlyOffered: currentPolicy ? legacyOffered : exclusions.recentlyOffered,
    negativeFeedback: exclusions.negativeFeedback,
  });

  const reclassified = await reclassifyCandidateItems(
    sanitized.items,
    deps.resolveRecipe ?? defaultResolveRecipe,
  );

  const summary: CandidateSanitationSummary = {
    removed: [...sanitized.removed, ...reclassified.dropped],
    relabeled: reclassified.relabeled,
  };

  return {
    plan: {
      ...plan,
      candidateSet: { ...plan.candidateSet, items: reclassified.items },
    },
    summary,
  };
}

export async function saveMealPlan(plan: MealPlan, deps: SaveMealPlanDeps = {}): Promise<SaveResult> {
  const client = await getDb();
  const now = new Date().toISOString();
  const existing = await client.execute({
    sql: "SELECT data, locked, updated_at FROM meal_plans WHERE week = ?",
    args: [plan.week],
  });

  const storedPlan =
    existing.rows.length > 0
      ? (JSON.parse(existing.rows[0]["data"] as string) as MealPlan)
      : null;

  // Reject mutations to a locked plan unless the incoming payload is also locked
  // (i.e. the only allowed write to a locked plan is one that keeps it locked).
  const storedLocked = existing.rows.length > 0 && (existing.rows[0]["locked"] as number) === 1;
  if (storedLocked && !plan.locked) {
    return { ok: false, reason: "locked" };
  }
  if (storedLocked && plan.locked) {
    // Plan is locked — block all content mutations.
    return { ok: false, reason: "locked" };
  }

  if (storedPlan && !storedPlan.updatedAt) {
    storedPlan.updatedAt = existing.rows[0]["updated_at"] as string | undefined;
  }
  let planToSave = storedPlan
    ? preserveStoredAssignmentsForStaleSave(plan, storedPlan)
    : plan;
  planToSave = normalizeDayPlanningStates(planToSave);
  const boundary = await enforceCandidateSaveBoundary(planToSave, deps);
  planToSave = boundary.plan;

  // Shopping safety boundary (kitchen DESIGN.md §"Phase 4C").
  //
  // Two things invalidate a week's shopping state, and both are decided here so
  // there is one place that knows:
  //
  //   meals-changed — the set of planned recipes differs from what is stored,
  //     so a generated draft is about a meal that is no longer happening. The
  //     week returns to `draft`, the draft is marked stale, and its pending
  //     outbox rows are cancelled.
  //   reopened — a finalized week is explicitly returned to draft without any
  //     meal edit. The draft still describes the right meals, so it is *not*
  //     staled, but the approval it was syncing under is withdrawn: its queued
  //     rows are cancelled, and it must be approved again after re-finalizing.
  //
  // Finalizing a draft week changes nothing about the shopping state.
  const storedStatus = storedPlan?.status ?? "draft";
  const mealsChanged =
    storedPlan !== null &&
    computePlanShoppingFingerprint(storedPlan) !== computePlanShoppingFingerprint(planToSave);
  if (mealsChanged && planToSave.status === "finalized") {
    planToSave = { ...planToSave, status: "draft" };
  }
  const reopened = storedStatus === "finalized" && (planToSave.status ?? "draft") === "draft";

  const invalidation: ShoppingInvalidation | null = mealsChanged
    ? { markStale: true, reason: "planned meals changed after approval" }
    : reopened
      ? { markStale: false, reason: "week reopened after approval" }
      : null;

  const updatedPlan: MealPlan = {
    ...planToSave,
    updatedAt: now,
    createdAt: planToSave.createdAt || storedPlan?.createdAt || now,
  };

  await promoteAssignedPlannerCandidates(client, updatedPlan);

  // One transaction. The plan write and the invalidation are a single fact
  // about the week: if the invalidation fails, the plan save must fail too,
  // rather than leaving pending outbox rows eligible for a plan they no longer
  // describe. Database errors propagate — the v16 migration guarantees these
  // tables, so a failure here is a real failure, not a missing table.
  const result = await saveMealPlanRowWithInvalidation({
    week: planToSave.week,
    data: JSON.stringify(updatedPlan),
    locked: Boolean(planToSave.locked),
    createdAt: updatedPlan.createdAt,
    updatedAt: now,
    invalidate: invalidation,
  });

  return {
    ok: true,
    plan: updatedPlan,
    ...(boundary.summary ? { candidateSanitation: boundary.summary } : {}),
    ...(invalidation && (result.invalidatedDraft || result.cancelledItems > 0)
      ? {
          shoppingInvalidated: {
            cause: mealsChanged ? ("meals-changed" as const) : ("reopened" as const),
            returnedToDraft: result.invalidatedDraft,
            cancelledOutboxItems: result.cancelledItems,
          },
        }
      : {}),
  };
}

export async function loadMealPlan(weekId: string): Promise<MealPlan | null> {
  const client = await getDb();
  const result = await client.execute({
    sql: "SELECT data FROM meal_plans WHERE week = ?",
    args: [weekId],
  });
  if (result.rows.length === 0) return null;
  return JSON.parse(result.rows[0]["data"] as string) as MealPlan;
}
