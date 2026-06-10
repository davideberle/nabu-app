import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isTrackerOnlyEmail } from "@/lib/access";
import { createAlcoholEvent, deleteAlcoholEvent } from "@/lib/health-db";

const VALID_DRINK_TYPES = ["wine", "beer", "cocktail", "spirit", "other"];

/**
 * POST /api/health/alcohol
 * Body: { date, drinkType, amountLabel?, estimatedGrams?, context? }
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (isTrackerOnlyEmail(session.user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { date, drinkType, amountLabel, estimatedGrams, context } = body;
  if (
    typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    typeof drinkType !== "string" || !VALID_DRINK_TYPES.includes(drinkType)
  ) {
    return NextResponse.json({ error: "date and drinkType required" }, { status: 400 });
  }

  const event = await createAlcoholEvent({
    date,
    drinkType,
    ...(typeof amountLabel === "string" ? { amountLabel } : {}),
    ...(typeof estimatedGrams === "number" ? { estimatedGrams } : {}),
    ...(typeof context === "string" ? { context } : {}),
  });

  return NextResponse.json(event);
}

/**
 * DELETE /api/health/alcohol
 * Body: { id }
 */
export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (isTrackerOnlyEmail(session.user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { id } = body;
  if (typeof id !== "string" || !id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const removed = await deleteAlcoholEvent(id);
  return NextResponse.json({ ok: true, removed });
}
