import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getCookEventsForDateRange } from "@/lib/db";
import { loadMealPlan } from "@/lib/meals-persistence";
import { parseWeekId, getWeekDates } from "@/lib/meals";

/**
 * Planner history projection for a given ISO week.
 *
 * For each day in the week returns a lightweight status:
 *   - "planned"           — recipe assigned, not yet cooked
 *   - "cooked-as-planned" — explicitly marked cooked for the planned recipe
 *   - "cooked-other"      — explicitly marked cooked for a different recipe
 *   - "skipped"           — day was planned but no cook happened (past only)
 *   - null                — no plan and no cook for that day
 *
 * GET /api/meals/history?week=2026-W17
 */

export type DayHistoryStatus =
  | "planned"
  | "cooked-as-planned"
  | "cooked-other"
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

  const days: DayHistory[] = weekDates.map((wd, i) => {
    const slot = plan?.days[i] ?? null;
    const events = eventsByDate.get(wd.date) ?? [];
    const hasPlannedRecipe = !!(slot?.recipeId);
    const isPast = wd.date < today;
    const plannedCookEvent = hasPlannedRecipe
      ? events.find((event) => event.recipeId === slot!.recipeId)
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
      status = isPast ? "skipped" : "planned";
    } else if (!hasPlannedRecipe && hasCooked) {
      status = "cooked-other";
    }
    // else: null — no plan and no explicit cook event

    return {
      date: wd.date,
      status,
      plannedRecipeId: slot?.recipeId ?? null,
      plannedRecipeName: slot?.recipeName ?? null,
      cookedRecipeId,
      cookedRecipeName: null,
    };
  });

  return NextResponse.json({ week: weekParam, days });
}
