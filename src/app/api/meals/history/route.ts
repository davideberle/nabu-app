import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionsForDateRange } from "@/lib/cooking";
import { loadMealPlan } from "@/lib/meals-persistence";
import { parseWeekId, getWeekDates } from "@/lib/meals";

/**
 * Planner history projection for a given ISO week.
 *
 * For each day in the week returns a lightweight status:
 *   - "planned"           — recipe assigned, not yet cooked
 *   - "cooked-as-planned" — cooked the planned recipe
 *   - "cooked-other"      — cooked a different recipe than planned
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

  const [plan, sessions] = await Promise.all([
    loadMealPlan(weekParam),
    getSessionsForDateRange(from, to),
  ]);

  // Build session lookup by date
  const sessionByDate = new Map(sessions.map((s) => [s.date, s]));

  const days: DayHistory[] = weekDates.map((wd, i) => {
    const slot = plan?.days[i] ?? null;
    const session = sessionByDate.get(wd.date) ?? null;
    const hasPlannedRecipe = !!(slot?.recipeId);
    const hasCooked = !!(session && (session.status === "completed" || session.status === "active"));
    const isPast = wd.date < today;
    const cookedRecipeId = session?.anchor?.recipeId ?? null;

    let status: DayHistoryStatus = null;

    if (hasPlannedRecipe && hasCooked) {
      status =
        cookedRecipeId === slot!.recipeId
          ? "cooked-as-planned"
          : "cooked-other";
    } else if (hasPlannedRecipe && !hasCooked) {
      status = isPast ? "skipped" : "planned";
    } else if (!hasPlannedRecipe && hasCooked) {
      status = "cooked-other";
    }
    // else: null — no plan and no cook

    return {
      date: wd.date,
      status,
      plannedRecipeId: slot?.recipeId ?? null,
      plannedRecipeName: slot?.recipeName ?? null,
      cookedRecipeId,
      cookedRecipeName: session?.anchor?.title ?? null,
    };
  });

  return NextResponse.json({ week: weekParam, days });
}
