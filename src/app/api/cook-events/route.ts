import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  getCookEventsForRecipe,
  getRecentCookEvents,
  createCookEventIfMissing,
} from "@/lib/db";
import { loadMealPlan } from "@/lib/meals-persistence";
import { getISOWeek, formatWeekId } from "@/lib/meals";

/**
 * GET /api/cook-events?recipeId=foo  — events for one recipe
 * GET /api/cook-events               — recent events across all recipes
 */
export async function GET(request: NextRequest) {
  const recipeId = request.nextUrl.searchParams.get("recipeId");
  const events = recipeId
    ? await getCookEventsForRecipe(recipeId)
    : await getRecentCookEvents();
  // vNext: date-only presentation — strip per-event notes from API output
  const cleaned = events.map(({ note: _note, ...rest }) => rest);
  return NextResponse.json(cleaned);
}

/**
 * POST /api/cook-events
 * Body: { recipeId, cookedOn, note?, source? } or { recipeIds: [], cookedOn, note?, source? }
 */
export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    recipeId?: unknown;
    recipeIds?: unknown;
    cookedOn?: unknown;
    note?: unknown;
    source?: unknown;
  };
  const rawRecipeIds = Array.isArray(body.recipeIds)
    ? body.recipeIds
    : body.recipeId
      ? [body.recipeId]
      : [];
  const recipeIds: string[] = [
    ...new Set(rawRecipeIds.filter((id: unknown): id is string => typeof id === "string" && id.trim().length > 0)),
  ];

  if (recipeIds.length === 0 || typeof body.cookedOn !== "string") {
    return NextResponse.json(
      { error: "recipeId or recipeIds and cookedOn are required" },
      { status: 400 }
    );
  }
  const cookedOn = body.cookedOn;

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cookedOn)) {
    return NextResponse.json(
      { error: "cookedOn must be YYYY-MM-DD" },
      { status: 400 }
    );
  }

  // Enforce locked weekly plans server-side
  const cookedDate = new Date(cookedOn + "T12:00:00Z");
  const { year, week } = getISOWeek(cookedDate);
  const weekPlan = await loadMealPlan(formatWeekId(year, week));
  if (weekPlan?.locked) {
    return NextResponse.json(
      { error: "Plan is locked", locked: true },
      { status: 409 },
    );
  }

  // Idempotency: if an event with the same recipe/date/source already exists, return it.
  const effectiveSource = typeof body.source === "string" && body.source ? body.source : "manual";
  const note = typeof body.note === "string" ? body.note : undefined;
  const results = await Promise.all(
    recipeIds.map((recipeId) =>
      createCookEventIfMissing({
        recipeId,
        cookedOn,
        note,
        source: effectiveSource,
      }),
    ),
  );
  const events = results.map((result) => result.event);
  const createdCount = results.filter((result) => result.created).length;

  if (!Array.isArray(body.recipeIds) && typeof body.recipeId === "string") {
    return NextResponse.json(events[0], { status: createdCount > 0 ? 201 : 200 });
  }

  return NextResponse.json(
    {
      events,
      created: createdCount,
      existing: events.length - createdCount,
    },
    { status: createdCount > 0 ? 201 : 200 },
  );
}
