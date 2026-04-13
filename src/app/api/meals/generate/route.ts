import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAllRecipes, getCuisine, getDietary, getRecipe } from "@/lib/recipes";
import { selectMealOptions, getDisplayCategory, type WeekendMealOption } from "@/lib/meals";
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
  };
}

function summarizeMealCombo(combo: WeekendMealOption) {
  return {
    main: summarize(combo.main),
    sides: combo.sides.map(summarize),
  };
}

export async function GET(request: NextRequest) {
  const allRecipes = await getAllRecipes();

  // Support "exclude" param to avoid re-showing already-seen recipes
  const excludeParam = request.nextUrl.searchParams.get("exclude");
  const excludeIds = excludeParam ? new Set(excludeParam.split(",")) : new Set<string>();

  const { weekday, weekend, weekendMeals } = selectMealOptions(allRecipes, excludeIds);

  return NextResponse.json({
    weekday: weekday.map(summarize),
    weekend: weekend.map(summarize),
    weekendMeals: weekendMeals.map(summarizeMealCombo),
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
