import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAllRecipes, getRecipe, getCuisine, getDietary, isLowCalorie } from "@/lib/recipes";
import { selectDayComplements, getDisplayCategory } from "@/lib/meals";
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
 * GET /api/meals/expand?mainId=<recipeId>&dayType=weekday|weekend
 *
 * Returns complement suggestions (starters, sides, desserts) for an
 * assigned main dish on a specific day.
 */
export async function GET(request: NextRequest) {
  const mainId = request.nextUrl.searchParams.get("mainId");
  const dayType = (request.nextUrl.searchParams.get("dayType") || "weekday") as "weekday" | "weekend";

  if (!mainId) {
    return NextResponse.json({ error: "mainId is required" }, { status: 400 });
  }

  const mainRecipe = await getRecipe(mainId);
  if (!mainRecipe) {
    return NextResponse.json({ error: "Main recipe not found" }, { status: 404 });
  }

  const allRecipes = await getAllRecipes();
  const complements = selectDayComplements(mainRecipe, allRecipes, dayType);

  const grouped = {
    starters: complements
      .filter((c) => c.role === "starter")
      .map((c) => summarize(c.recipe)),
    sides: complements
      .filter((c) => c.role === "side")
      .map((c) => summarize(c.recipe)),
    desserts: complements
      .filter((c) => c.role === "dessert")
      .map((c) => summarize(c.recipe)),
    mainCuisine: getCuisine(mainRecipe),
  };

  return NextResponse.json(grouped);
}
