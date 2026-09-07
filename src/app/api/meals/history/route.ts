import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getCookEventsForDateRange, getMyRecipe } from "@/lib/db";
import { getSessionsForDateRange } from "@/lib/cooking";
import { todayInZurich } from "@/lib/date";
import { getRecipe } from "@/lib/recipes";
import { loadMealPlan } from "@/lib/meals-persistence";
import { parseWeekId, getWeekDates } from "@/lib/meals";
import {
  projectDayHistory,
  type DayHistory,
} from "@/lib/meal-history";

export type { DayHistory, DayHistoryStatus } from "@/lib/meal-history";

/**
 * Planner history projection for a given ISO week.
 *
 * For each day in the week returns a lightweight status:
 *   - "planned"           — recipe assigned, not yet cooked
 *   - "in-progress"       — today's explicitly established Live Cooking meal
 *   - "cooked-as-planned" — actual cooking evidence matches the planned recipe
 *   - "cooked-other"      — actual cooking evidence differs, or had no plan
 *   - "planned-unlogged"  — day was planned but no cook was logged (past only)
 *   - "skipped"           — day was intentionally empty (skip-meal context or
 *                            a persisted `planningState: "skipped"`); distinct
 *                            from a planned meal that simply has no cook log
 *   - null                — no plan and no cook for that day
 *
 * GET /api/meals/history?week=2026-W17
 */

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
  const today = todayInZurich();

  const [plan, cookEvents, cookingSessions] = await Promise.all([
    loadMealPlan(weekParam),
    getCookEventsForDateRange(from, to),
    getSessionsForDateRange(from, to),
  ]);

  const eventsByDate = new Map<string, typeof cookEvents>();
  for (const event of cookEvents) {
    const existing = eventsByDate.get(event.cookedOn) ?? [];
    existing.push(event);
    eventsByDate.set(event.cookedOn, existing);
  }

  const sessionsByDate = new Map<string, typeof cookingSessions>();
  for (const session of cookingSessions) {
    const existing = sessionsByDate.get(session.date) ?? [];
    existing.push(session);
    sessionsByDate.set(session.date, existing);
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
    const sessions = sessionsByDate.get(wd.date) ?? [];
    const isIntentionallySkipped =
      (slot?.planningState === "skipped" || skipContextDates.has(wd.date));

    return projectDayHistory({
      date: wd.date,
      today,
      slot,
      cookEvents: events,
      sessions,
      recipeNames: recipeNameCache,
      intentionallySkipped: isIntentionallySkipped,
    });
  });

  return NextResponse.json({ week: weekParam, days });
}
