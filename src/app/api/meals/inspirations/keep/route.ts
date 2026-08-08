/**
 * POST /api/meals/inspirations/keep  { recipeId, kept }
 *
 * Reversible `Keep` for a hidden web-staging idea (Kitchen DESIGN.md §4.3,
 * "Weekly web inspiration contract").
 *
 * Keep records *pending retention* — it does not promote anything and does not
 * put the recipe into My Recipes. Promotion happens at week rollover, for
 * recipes that are kept **or** assigned. Un-keeping simply clears the intent.
 *
 * Browser action, so this uses the canonical planner-write session policy.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { evaluatePlannerWriteAccess } from "@/lib/access";
import { setWebInspirationKeep } from "@/lib/db";

export async function POST(request: NextRequest) {
  const access = evaluatePlannerWriteAccess(await auth());
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  let body: { recipeId?: unknown; kept?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const recipeId = typeof body.recipeId === "string" ? body.recipeId.trim() : "";
  if (!recipeId) {
    return NextResponse.json({ error: "recipeId is required" }, { status: 400 });
  }
  if (typeof body.kept !== "boolean") {
    return NextResponse.json({ error: "kept must be a boolean" }, { status: 400 });
  }

  try {
    const record = await setWebInspirationKeep(recipeId, body.kept);
    if (!record) {
      return NextResponse.json(
        { error: "Not a staged web inspiration", recipeId },
        { status: 404 },
      );
    }
    return NextResponse.json({
      recipeId: record.recipeId,
      week: record.week,
      kept: Boolean(record.keptAt),
      keptAt: record.keptAt,
      promotedAt: record.promotedAt,
    });
  } catch (error) {
    console.error(`Failed to set Keep for ${recipeId}:`, error);
    return NextResponse.json({ error: "Failed to update Keep" }, { status: 500 });
  }
}
