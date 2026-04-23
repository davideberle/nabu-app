import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  getTodaySession,
  createCookingSession,
  updateSessionRecipeData,
  updateSessionStep,
  updateSessionTonight,
  updateSessionFeedback,
  completeSession,
  getRecipeHistory,
} from "@/lib/cooking";
import type { CookingFeedback } from "@/lib/cooking";
import { loadMealPlan } from "@/lib/meals-persistence";
import { getISOWeek } from "@/lib/meals";
import { getRecipe } from "@/lib/recipes";

/**
 * GET /api/cooking?date=2026-04-21
 * Returns today's cooking session. If none exists but today has a planned
 * meal, auto-creates the session so the cooking page loads seamlessly.
 *
 * When an existing session was sourced from the meal plan, the base recipe
 * data is refreshed from the current recipe so cleaned/updated recipes are
 * picked up without losing session state (currentStep, status, etc.).
 */
export async function GET(request: NextRequest) {
  const today =
    request.nextUrl.searchParams.get("date") ??
    new Date().toISOString().split("T")[0];

  // 1. Check for existing session
  const existing = await getTodaySession(today);
  if (existing) {
    // Refresh base recipe data from the current recipe source so that
    // cleaned / updated recipes are reflected without losing user progress.
    const currentRecipe = await getRecipe(existing.recipeId);
    if (currentRecipe) {
      // Also refresh serveWith from the current meal plan slot
      const now = new Date(today + "T12:00:00Z");
      const { year, week } = getISOWeek(now);
      const weekId = `${year}-W${String(week).padStart(2, "0")}`;
      const plan = await loadMealPlan(weekId);
      const todaySlot = plan?.days.find((d) => d.date === today);
      const freshServeWith = todaySlot?.meal?.serveWith ?? null;

      const recipeChanged =
        JSON.stringify(existing.recipeData) !== JSON.stringify(currentRecipe);
      const nameChanged = existing.recipeName !== currentRecipe.name;
      const serveWithChanged =
        JSON.stringify(existing.serveWith ?? null) !==
        JSON.stringify(freshServeWith?.length ? freshServeWith : null);

      if (recipeChanged || nameChanged || serveWithChanged) {
        await updateSessionRecipeData(existing.id, {
          recipeName: currentRecipe.name,
          recipeData: currentRecipe,
          serveWith: freshServeWith?.length ? freshServeWith : null,
        });
        existing.recipeName = currentRecipe.name;
        existing.recipeData = currentRecipe;
        existing.serveWith = freshServeWith?.length ? freshServeWith : undefined;
      }
    }
    // Include recipe history derived from past completed sessions
    const history = await getRecipeHistory(existing.recipeId);
    return NextResponse.json({ session: existing, history });
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

  const history = await getRecipeHistory(recipe.id);
  return NextResponse.json({ session, history });
}

/**
 * PATCH /api/cooking
 * Body: { id, currentStep } | { id, status: "completed" } |
 *       { id, tonight } | { id, feedback }
 * Updates step pointer, marks session completed, updates tonight plan,
 * or saves post-cook feedback.
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

  if ("tonight" in body) {
    await updateSessionTonight(body.id, body.tonight ?? null);
    return NextResponse.json({ ok: true });
  }

  if ("feedback" in body && body.feedback) {
    const fb = body.feedback as CookingFeedback;
    await updateSessionFeedback(body.id, {
      verdict: fb.verdict,
      wouldCookAgain: fb.wouldCookAgain,
      ...(fb.notes ? { notes: fb.notes } : {}),
      ...(fb.keepForNextTime?.length ? { keepForNextTime: fb.keepForNextTime } : {}),
      ...(fb.changeNextTime?.length ? { changeNextTime: fb.changeNextTime } : {}),
      capturedAt: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json(
    { error: "Provide currentStep, status, tonight, or feedback" },
    { status: 400 }
  );
}
