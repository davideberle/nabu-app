import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  getCookEventsForRecipe,
  getRecentCookEvents,
  createCookEvent,
} from "@/lib/db";

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
 * Body: { recipeId, cookedOn, note?, source? }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();

  if (!body.recipeId || !body.cookedOn) {
    return NextResponse.json(
      { error: "recipeId and cookedOn are required" },
      { status: 400 }
    );
  }

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.cookedOn)) {
    return NextResponse.json(
      { error: "cookedOn must be YYYY-MM-DD" },
      { status: 400 }
    );
  }

  const event = await createCookEvent({
    recipeId: body.recipeId,
    cookedOn: body.cookedOn,
    note: body.note,
    source: body.source,
  });

  return NextResponse.json(event, { status: 201 });
}
