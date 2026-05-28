import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getRecipe } from "@/lib/recipes";

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
  }> = {};

  await Promise.all(
    ids.map(async (id) => {
      const recipe = await getRecipe(id);
      if (recipe) {
        result[id] = {
          image: recipe.image ?? null,
          time: recipe.time ?? {},
          category: recipe.category?.dish_type?.[0] ?? "main",
          courseTags: recipe.category?.dish_type ?? ["main"],
          source: recipe.source,
          name: recipe.name,
        };
      } else {
        result[id] = { image: null };
      }
    })
  );

  return NextResponse.json(result);
}
