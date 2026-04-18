import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAllRecipes, getCuisine, getDietary, isLowCalorie, getRecipe } from "@/lib/recipes";
import { selectMealOptions, getDisplayCategory, type WeekendMealOption, type WeekContextItem } from "@/lib/meals";
import { getRecentlyCookedRecipeIds } from "@/lib/db";
import type { Recipe } from "@/lib/recipes";

function summarize(r: Recipe) {
  return {
    id: r.id,
    name: r.name,
    source: r.source,
    image: r.image ?? null,
    dietary: getDietary(r),
    cuisine: getCuisine(r),
    time: r.time ?? null,
    category: getDisplayCategory(r),
    lowCalorie: isLowCalorie(r),
  };
}

function summarizeMealCombo(combo: WeekendMealOption) {
  return {
    main: summarize(combo.main),
    sides: combo.sides.map(summarize),
    rationale: combo.rationale ?? null,
  };
}

export async function GET(request: NextRequest) {
  const allRecipes = await getAllRecipes();

  // Support "exclude" param to avoid re-showing already-seen recipes
  const excludeParam = request.nextUrl.searchParams.get("exclude");
  const excludeIds = excludeParam ? new Set(excludeParam.split(",")) : new Set<string>();

  // Also exclude recipes cooked in the last 14 days to avoid repetition
  const recentlyCooked = await getRecentlyCookedRecipeIds(14);
  for (const id of recentlyCooked) excludeIds.add(id);

  // Parse week context to influence generation
  let weekContext: WeekContextItem[] = [];
  const contextParam = request.nextUrl.searchParams.get("context");
  if (contextParam) {
    try {
      weekContext = JSON.parse(contextParam);
    } catch {
      // ignore malformed context
    }
  }

  // Count skip-meal days to reduce generated slot counts
  const skipCount = weekContext.filter(
    (c) => c.effect === "skip-meal"
  ).length;

  // Bias toward quick/light meals if any context requests it
  const wantQuick = weekContext.some(
    (c) => c.effect === "quick-meal" || c.effect === "light-meal"
  );
  const wantGuestFriendly = weekContext.some(
    (c) => c.effect === "guest-friendly"
  );

  const { weekday, weekend, weekendMeals } = selectMealOptions(allRecipes, excludeIds, {
    skipCount,
    preferQuick: wantQuick,
    preferGuestFriendly: wantGuestFriendly,
  });

  return NextResponse.json({
    weekday: weekday.map(summarize),
    weekend: weekend.map(summarize),
    weekendMeals: weekendMeals.map(summarizeMealCombo),
    appliedContext: weekContext.length > 0 ? { skipCount, wantQuick, wantGuestFriendly } : undefined,
  });
}

// POST — full recipe detail for Quick View
export async function POST(request: NextRequest) {
  const { id } = (await request.json()) as { id: string };
  const recipe = await getRecipe(id);
  if (!recipe) {
    return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
  }
  return NextResponse.json({
    ...summarize(recipe),
    introduction: recipe.introduction || recipe.intro || null,
    tips: recipe.tips || null,
    servings: recipe.servings,
    ingredients: recipe.ingredients.map((ing) => ({
      item: ing.item,
      amount: ing.amount,
      unit: ing.unit,
      group: ing.group,
    })),
    method: recipe.method,
  });
}
