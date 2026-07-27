import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAllRecipes, getRecipe, getCuisine, getDietary, isLowCalorie } from "@/lib/recipes";
import { selectDayComplements, getDisplayCategory } from "@/lib/meals";
import { buildMealExpansion } from "@/lib/meal-expand";
import type { Recipe } from "@/lib/recipes";

function parseMinutes(v: unknown): number {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string") { const n = parseInt(v, 10); return isFinite(n) ? n : 0; }
  return 0;
}

function normalizeTime(time: Recipe["time"]): { prep: number; cook: number; total: number } | null {
  if (!time) return null;
  const prep = parseMinutes(time.prep);
  const cook = parseMinutes(time.cook);
  let total = parseMinutes(time.total);
  if (total <= 0 && prep + cook > 0) total = prep + cook;
  if (total <= 0) return null;
  return { prep, cook, total };
}

function summarize(r: Recipe) {
  return {
    id: r.id,
    name: r.name,
    source: r.source ?? null,
    image: r.image ?? null,
    dietary: getDietary(r),
    cuisine: getCuisine(r),
    time: normalizeTime(r.time),
    category: getDisplayCategory(r),
    lowCalorie: isLowCalorie(r),
  };
}

/**
 * GET /api/meals/expand
 *   ?mainId=<recipeId>
 *   &dayType=weekday|weekend
 *   &sideIds=<recipeId,recipeId>   optional: components already saved on the day
 *   &serveWith=<text>              optional, repeatable: free-text table additions
 *
 * Returns complement suggestions (starters, sides, desserts) for an assigned
 * main dish plus two reviews (kitchen DESIGN.md §4.3):
 *
 * - `coherence` — the day's meal as currently accepted: the main together with
 *   `sideIds` and `serveWith`.
 * - `recommendedSet` — the starter/side/dessert set the planner recommends,
 *   assembled as one meal rather than three independent picks, with the
 *   decisions that produced it. `recommended` on each grouped item mirrors it.
 *
 * Complements are still *scored* one at a time against the main, which is why
 * two components can independently land on the same seasoning; the coherent
 * selection step is what stops both of them being recommended together.
 *
 * Recipes are read read-only and never rewritten; suggestions are session and
 * runtime adjustments for the caller to accept or ignore.
 *
 * `sideIds` are explicit references, so they resolve through `getRecipe` — the
 * browsable collection from `getAllRecipes` excludes hidden cookbooks, and a
 * saved side from one of those must still be reviewed.
 */
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const mainId = query.get("mainId");
  const dayType = (query.get("dayType") || "weekday") as "weekday" | "weekend";
  const sideIds = (query.get("sideIds") || "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  const serveWith = query.getAll("serveWith").filter((text) => text.trim().length > 0);

  if (!mainId) {
    return NextResponse.json({ error: "mainId is required" }, { status: 400 });
  }

  const mainRecipe = await getRecipe(mainId);
  if (!mainRecipe) {
    return NextResponse.json({ error: "Main recipe not found" }, { status: 404 });
  }

  const allRecipes = await getAllRecipes();
  const complements = selectDayComplements(mainRecipe, allRecipes, dayType);

  const expansion = await buildMealExpansion({
    main: mainRecipe,
    candidates: complements.map((c) => ({ role: c.role, recipe: c.recipe })),
    sideIds,
    serveWith,
    dayType,
    resolveRecipe: getRecipe,
  });
  const recommendedIds = new Set(expansion.recommendedIds);

  const group = (role: "starter" | "side" | "dessert") =>
    complements
      .filter((c) => c.role === role)
      .map((c) => ({
        ...summarize(c.recipe),
        rationale: c.rationale,
        recommended: recommendedIds.has(c.recipe.id),
      }));

  const grouped = {
    starters: group("starter"),
    sides: group("side"),
    desserts: group("dessert"),
    mainCuisine: getCuisine(mainRecipe),
    coherence: expansion.coherence,
    recommendedSet: expansion.recommendedSet,
  };

  return NextResponse.json(grouped);
}
