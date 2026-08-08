import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getRecipe } from "@/lib/recipes";
import { isMainPlannerCandidate } from "@/lib/meals";

/**
 * Lightweight lookup: returns current canonical fields for a list of recipe IDs.
 * Used by the meals page to reconcile stale persisted candidate data with
 * live recipe image/time/category/source/name.
 *
 * GET /api/meals/lookup?ids=recipe-a,recipe-b
 * Returns: { "recipe-a": { image, time, category, courseTags, source, name }, ... }
 */
export async function GET(request: NextRequest) {
  const idsParam = request.nextUrl.searchParams.get("ids");
  if (!idsParam) {
    return NextResponse.json({});
  }

  const ids = idsParam.split(",").filter(Boolean).slice(0, 50);
  const result: Record<string, {
    image: string | null;
    time?: { prep?: number; cook?: number; total?: number };
    category?: string;
    courseTags?: string[];
    source?: { cookbook: string; author: string; chapter?: string; publication?: string };
    name?: string;
    mealRole?: string;
    isMain?: boolean;
  }> = {};

  await Promise.all(
    ids.map(async (id) => {
      const recipe = await getRecipe(id);
      if (recipe) {
        const mealRole = (recipe as Record<string, unknown>).mealRole as string | undefined
          ?? recipe.category?.meal_role
          ?? "main";
        // The authoritative planner-main gate — the same rule candidate
        // generation and the save boundary enforce.
        const isMain = isMainPlannerCandidate(recipe);
        result[id] = {
          image: recipe.image ?? null,
          time: recipe.time ?? {},
          category: recipe.category?.dish_type?.[0] ?? "main",
          courseTags: recipe.category?.dish_type ?? ["main"],
          source: recipe.source,
          name: recipe.name,
          mealRole,
          isMain,
        };
      } else {
        result[id] = { image: null };
      }
    })
  );

  return NextResponse.json(result);
}
