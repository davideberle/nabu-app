import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  getTodaySession,
  createCookingSession,
  updateSessionStep,
  completeSession,
} from "@/lib/cooking";
import { loadMealPlan } from "@/lib/meals-persistence";
import { getISOWeek } from "@/lib/meals";
import { getRecipe } from "@/lib/recipes";

/**
 * GET /api/cooking?date=2026-04-21
 * Returns today's cooking session. If none exists but today has a planned
 * meal, auto-creates the session so the cooking page loads seamlessly.
 */
export async function GET(request: NextRequest) {
  const today =
    request.nextUrl.searchParams.get("date") ??
    new Date().toISOString().split("T")[0];

  // 1. Return existing session if found
  const existing = await getTodaySession(today);
  if (existing) {
    return NextResponse.json({ session: existing });
  }

  // 2. Try to auto-create from today's meal plan
  const now = new Date(today + "T12:00:00Z");
  const { year, week } = getISOWeek(now);
  const weekId = `${year}-W${String(week).padStart(2, "0")}`;
  const plan = await loadMealPlan(weekId);

  if (!plan) {
    return NextResponse.json({ session: null });
  }

  const todaySlot = plan.days.find((d) => d.date === today);
  if (!todaySlot?.recipeId) {
    return NextResponse.json({ session: null });
  }

  const recipe = await getRecipe(todaySlot.recipeId);
  if (!recipe) {
    return NextResponse.json({ session: null });
  }

  const serveWith = todaySlot.meal?.serveWith;
  const session = await createCookingSession({
    date: today,
    recipeId: recipe.id,
    recipeName: recipe.name,
    recipeData: recipe,
    ...(serveWith?.length ? { serveWith } : {}),
  });

  return NextResponse.json({ session });
}

/**
 * PATCH /api/cooking
 * Body: { id, currentStep } or { id, status: "completed" }
 * Updates step pointer or marks session completed.
 */
export async function PATCH(request: NextRequest) {
  const body = await request.json();

  if (!body.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  if (body.status === "completed") {
    await completeSession(body.id);
    return NextResponse.json({ ok: true });
  }

  if (typeof body.currentStep === "number") {
    await updateSessionStep(body.id, body.currentStep);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json(
    { error: "Provide currentStep (number) or status: 'completed'" },
    { status: 400 }
  );
}
