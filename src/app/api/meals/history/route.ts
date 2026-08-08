import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getCookEventsForDateRange, getMyRecipe } from "@/lib/db";
import { getRecipe } from "@/lib/recipes";
import { loadMealPlan } from "@/lib/meals-persistence";
import { parseWeekId, getWeekDates, type MealPlan } from "@/lib/meals";

/**
 * Planner history projection for a given ISO week.
 *
 * For each day in the week returns a lightweight status:
 *   - "planned"           — recipe assigned, not yet cooked
 *   - "cooked-as-planned" — explicitly marked cooked for the planned recipe
 *   - "cooked-other"      — explicitly marked cooked for a different recipe
 *   - "planned-unlogged"  — day was planned but no cook was logged (past only)
 *   - "skipped"           — day was intentionally empty (skip-meal context or
 *                            a persisted `planningState: "skipped"`); distinct
 *                            from a planned meal that simply has no cook log
 *   - null                — no plan and no cook for that day
 *
 * GET /api/meals/history?week=2026-W17
 */

export type DayHistoryStatus =
  | "planned"
  | "cooked-as-planned"
  | "cooked-other"
  | "planned-unlogged"
  | "skipped"
  | null;

export type DayHistory = {
  date: string;
  status: DayHistoryStatus;
  plannedRecipeId: string | null;
  plannedRecipeName: string | null;
  cookedRecipeId: string | null;
  cookedRecipeName: string | null;
};

export async function GET(request: NextRequest) {
  const weekParam = request.nextUrl.searchParams.get("week");
  if (!weekParam) {
    return NextResponse.json(
      { error: "Missing week query param" },
      { status: 400 },
    );
  }

  const parsed = parseWeekId(weekParam);
  if (!parsed) {
    return NextResponse.json(
      { error: "Invalid week format — expected YYYY-Www" },
      { status: 400 },
    );
  }

  const weekDates = getWeekDates(parsed.year, parsed.week);
  const from = weekDates[0].date;
  const to = weekDates[6].date;
  const today = new Date().toISOString().split("T")[0];

  const [plan, cookEvents] = await Promise.all([
    loadMealPlan(weekParam),
    getCookEventsForDateRange(from, to),
  ]);

  const eventsByDate = new Map<string, typeof cookEvents>();
  for (const event of cookEvents) {
    const existing = eventsByDate.get(event.cookedOn) ?? [];
    existing.push(event);
    eventsByDate.set(event.cookedOn, existing);
  }

  // Collect all planned recipe IDs (main + brunch) so we can match cook events
  function getPlannedIds(slot: MealPlan["days"][number] | null): string[] {
    if (!slot) return [];
    const ids: string[] = [];
    if (slot.recipeId) ids.push(slot.recipeId);
    if (slot.meal?.main?.id && !ids.includes(slot.meal.main.id)) ids.push(slot.meal.main.id);
    if (slot.brunch?.main?.id) ids.push(slot.brunch.main.id);
    return ids;
  }

  // Build a set of cooked recipe IDs for name resolution
  const cookedRecipeIds = new Set<string>();
  for (const ev of cookEvents) cookedRecipeIds.add(ev.recipeId);

  // Resolve recipe names for cooked events (My Recipes + static cookbook fallback)
  const recipeNameCache = new Map<string, string>();
  await Promise.all(
    [...cookedRecipeIds].map(async (id) => {
      try {
        const recipe = await getMyRecipe(id) ?? await getRecipe(id);
        if (recipe) recipeNameCache.set(id, recipe.name);
      } catch { /* best-effort */ }
    }),
  );

  // A day is intentionally skipped when its persisted state says so, or when
  // a dated skip-meal context targets it (older records predate the persisted
  // state). An assignment always wins over a stale skip marker.
  const skipContextDates = new Set(
    (plan?.context ?? [])
      .filter((item) => item.effect === "skip-meal" && item.date)
      .map((item) => item.date as string),
  );

  const days: DayHistory[] = weekDates.map((wd, i) => {
    const slot = plan?.days[i] ?? null;
    const events = eventsByDate.get(wd.date) ?? [];
    const plannedIds = getPlannedIds(slot);
    const hasPlannedRecipe = plannedIds.length > 0;
    const isPast = wd.date < today;
    const isIntentionallySkipped =
      !hasPlannedRecipe &&
      (slot?.planningState === "skipped" || skipContextDates.has(wd.date));

    // Match cook event against any planned ID (main or brunch)
    const plannedCookEvent = hasPlannedRecipe
      ? events.find((event) => plannedIds.includes(event.recipeId))
      : null;
    const cookedEvent = plannedCookEvent ?? events[0] ?? null;
    const hasCooked = !!cookedEvent;
    const cookedRecipeId = cookedEvent?.recipeId ?? null;

    let status: DayHistoryStatus = null;

    if (hasPlannedRecipe && plannedCookEvent) {
      status = "cooked-as-planned";
    } else if (hasPlannedRecipe && hasCooked) {
      status = "cooked-other";
    } else if (hasPlannedRecipe && !hasCooked) {
      status = isPast ? "planned-unlogged" : "planned";
    } else if (!hasPlannedRecipe && hasCooked) {
      status = "cooked-other";
    } else if (isIntentionallySkipped) {
      status = "skipped";
    }
    // else: null — no plan and no explicit cook event

    // Resolve cooked recipe name from cache, slot data, or leave null
    let cookedRecipeName: string | null = null;
    if (cookedRecipeId) {
      cookedRecipeName =
        recipeNameCache.get(cookedRecipeId) ??
        (cookedRecipeId === slot?.recipeId ? slot?.recipeName ?? null : null) ??
        (cookedRecipeId === slot?.meal?.main?.id ? slot?.meal?.main?.name ?? null : null) ??
        (cookedRecipeId === slot?.brunch?.main?.id ? slot?.brunch?.main?.name ?? null : null) ??
        null;
    }

    return {
      date: wd.date,
      status,
      plannedRecipeId: slot?.recipeId ?? slot?.meal?.main?.id ?? null,
      plannedRecipeName: slot?.recipeName ?? slot?.meal?.main?.name ?? null,
      cookedRecipeId,
      cookedRecipeName,
    };
  });

  return NextResponse.json({ week: weekParam, days });
}
