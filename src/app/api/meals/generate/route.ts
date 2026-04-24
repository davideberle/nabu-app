import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAllRecipes, getCuisine, getDietary, isLowCalorie, getCourseTags, getRecipe } from "@/lib/recipes";
import { selectMealOptions, selectCandidateMains, getDisplayCategory, CANDIDATE_BUCKET_CONTRACT, type WeekendMealOption, type WeekContextItem, type CandidateItem, type CandidateBucket, type QualityGatedResult, type TaggedCandidate } from "@/lib/meals";
import { getRecentlyCookedRecipeIds, getThumbsDownRecipeIds } from "@/lib/db";
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
    courseTags: getCourseTags(r),
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

  // Exclude recipes the user has thumbs-downed in any week
  const thumbsDown = await getThumbsDownRecipeIds();
  for (const id of thumbsDown) excludeIds.add(id);

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

  const hints = {
    skipCount,
    preferQuick: wantQuick,
    preferGuestFriendly: wantGuestFriendly,
  };

  // vNext quality-gated candidates mode (default)
  const mode = request.nextUrl.searchParams.get("mode");
  if (mode !== "legacy") {
    const { candidates: taggedCandidates, diagnostics } = selectCandidateMains(allRecipes, excludeIds, hints);

    const summarized = taggedCandidates.map(({ recipe, bucket }) => ({
      ...summarize(recipe),
      bucket,
    }));

    // Persistable candidateSet with diagnostics for staleness detection and review
    const candidateSet = {
      generatedAt: new Date().toISOString(),
      policyVersion: "planner-v2.1",
      bucketContract: CANDIDATE_BUCKET_CONTRACT,
      items: summarized.map((s) => ({
        recipeId: s.id,
        recipeName: s.name,
        source: s.source ?? null,
        image: s.image ?? null,
        dietary: s.dietary,
        cuisine: s.cuisine,
        time: s.time,
        category: s.category,
        courseTags: s.courseTags,
        bucket: s.bucket,
      })) satisfies CandidateItem[],
      diagnostics,
    };

    return NextResponse.json({
      candidates: summarized,
      candidateSet,
      appliedContext: weekContext.length > 0 ? { skipCount, wantQuick, wantGuestFriendly } : undefined,
      qualityDiagnostics: diagnostics,
    });
  }

  // Legacy mode: weekday/weekend split (kept for backward compat)
  const { weekday, weekend, weekendMeals } = selectMealOptions(allRecipes, excludeIds, hints);

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
