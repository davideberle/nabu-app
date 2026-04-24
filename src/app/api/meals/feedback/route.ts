import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  getCandidateFeedback,
  setCandidateFeedback,
  removeCandidateFeedback,
} from "@/lib/db";

/** GET /api/meals/feedback?week=2026-W17 */
export async function GET(request: NextRequest) {
  const week = request.nextUrl.searchParams.get("week");
  if (!week) {
    return NextResponse.json(
      { error: "Missing required query parameter: week" },
      { status: 400 }
    );
  }
  const feedback = await getCandidateFeedback(week);
  return NextResponse.json({ feedback });
}

/** POST /api/meals/feedback  { recipeId, week, feedback } or { recipeId, week, remove: true } */
export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    recipeId: string;
    week: string;
    feedback?: "up" | "down";
    remove?: boolean;
  };

  if (!body.recipeId || !body.week) {
    return NextResponse.json(
      { error: "Missing required fields: recipeId, week" },
      { status: 400 }
    );
  }

  if (body.remove) {
    await removeCandidateFeedback(body.recipeId, body.week);
    return NextResponse.json({ ok: true });
  }

  if (body.feedback !== "up" && body.feedback !== "down") {
    return NextResponse.json(
      { error: "feedback must be 'up' or 'down'" },
      { status: 400 }
    );
  }

  await setCandidateFeedback(body.recipeId, body.week, body.feedback);
  return NextResponse.json({ ok: true });
}
