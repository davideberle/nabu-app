import { NextResponse } from "next/server";
import { getTodaySession, createCookingSession } from "@/lib/cooking";
import { loadMealPlan } from "@/lib/meals-persistence";
import { getISOWeek } from "@/lib/meals";
import { getRecipe } from "@/lib/recipes";

/**
 * POST /api/cooking/start
 * Creates a cooking session from today's meal plan.
 * Returns 409 if a session already exists for today.
 * Returns 404 if no recipe is planned for today.
 */
export async function POST() {
  const now = new Date();
  const today = now.toISOString().split("T")[0];

  // Check for existing session
  const existing = await getTodaySession(today);
  if (existing) {
    return NextResponse.json(
      { error: "A cooking session already exists for today", session: existing },
      { status: 409 }
    );
  }

  // Find today's planned recipe from the meal plan
  const { year, week } = getISOWeek(now);
  const weekId = `${year}-W${String(week).padStart(2, "0")}`;
  const plan = await loadMealPlan(weekId);

  if (!plan) {
    return NextResponse.json(
      { error: "No meal plan found for this week" },
      { status: 404 }
    );
  }

  const todaySlot = plan.days.find((d) => d.date === today);
  if (!todaySlot?.recipeId) {
    return NextResponse.json(
      { error: "No recipe planned for today" },
      { status: 404 }
    );
  }

  // Load the full recipe
  const recipe = await getRecipe(todaySlot.recipeId);
  if (!recipe) {
    return NextResponse.json(
      { error: `Recipe ${todaySlot.recipeId} not found` },
      { status: 404 }
    );
  }

  const session = await createCookingSession({
    date: today,
    recipeId: recipe.id,
    recipeName: recipe.name,
    recipeData: recipe,
  });

  return NextResponse.json({ session }, { status: 201 });
}
