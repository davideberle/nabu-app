import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getRecipe } from "@/lib/recipes";

/**
 * Lightweight lookup: returns current canonical image for a list of recipe IDs.
 * Used by the meals page to reconcile stale persisted candidate data.
 *
 * GET /api/meals/lookup?ids=recipe-a,recipe-b
 * Returns: { "recipe-a": { image: "/recipes/foo.jpg" }, "recipe-b": { image: null } }
 */
export async function GET(request: NextRequest) {
  const idsParam = request.nextUrl.searchParams.get("ids");
  if (!idsParam) {
    return NextResponse.json({});
  }

  const ids = idsParam.split(",").filter(Boolean).slice(0, 50);
  const result: Record<string, { image: string | null }> = {};

  await Promise.all(
    ids.map(async (id) => {
      const recipe = await getRecipe(id);
      result[id] = { image: recipe?.image ?? null };
    })
  );

  return NextResponse.json(result);
}
