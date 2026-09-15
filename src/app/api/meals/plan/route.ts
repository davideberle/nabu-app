import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { isTrackerOnlyEmail } from "@/lib/access";
import { saveMealPlan, loadMealPlan } from "@/lib/meals-persistence";
import type { MealPlan } from "@/lib/meals";
import { assignedRecipeIdsForPlan, hydrateShelfItems, toCandidateItem } from "@/lib/planner-preparation";
import { completePlanShelf } from "@/lib/planner-runtime";
import { getRecipe } from "@/lib/recipes";

function sameIds(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

export async function GET(request: NextRequest) {
  const week = request.nextUrl.searchParams.get("week");
  if (!week) {
    return NextResponse.json(
      { error: "Missing week query param" },
      { status: 400 }
    );
  }
  try {
    const plan = await loadMealPlan(week);
    if (!plan) {
      return NextResponse.json(null);
    }
    // Re-resolve and QA every card on the way out. Historical or manually
    // written metadata is never proof that the underlying recipe is safe to
    // render; invalid cards disappear while assigned days remain untouched.
    if (plan.candidateSet?.items?.length) {
      // Both passes resolve the same ~13 recipes; memoize so a shelf costs one
      // lookup per recipe rather than two round-trips each.
      const resolved = new Map<string, ReturnType<typeof getRecipe>>();
      const resolveRecipe = (id: string) => {
        const hit = resolved.get(id);
        if (hit) return hit;
        const pending = getRecipe(id);
        resolved.set(id, pending);
        return pending;
      };

      const items = await hydrateShelfItems(
        plan.candidateSet.items,
        assignedRecipeIdsForPlan(plan),
        resolveRecipe,
        new Date(),
      );
      return NextResponse.json({
        ...plan,
        candidateSet: { ...plan.candidateSet, items: items.map(toCandidateItem) },
      });
    }
    return NextResponse.json(plan);
  } catch {
    return NextResponse.json(
      { error: "Failed to load plan" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (isTrackerOnlyEmail(session.user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const plan = (await request.json()) as MealPlan;
    if (!plan.week || !plan.days) {
      return NextResponse.json(
        { error: "Invalid plan data" },
        { status: 400 }
      );
    }
    const previous = await loadMealPlan(plan.week).catch(() => null);
    let result = await saveMealPlan(plan);
    if (!result.ok) {
      return NextResponse.json(
        { error: "Plan is locked", locked: true },
        { status: 409 }
      );
    }
    // Context-aware completion (Phase 4E): when the set of assigned recipes
    // changed — an assignment or a clear — keep the assigned days fixed and
    // rerank/replace only the unassigned recommendations against the plan.
    const before = assignedRecipeIdsForPlan(previous);
    const after = assignedRecipeIdsForPlan(result.plan);
    if (!sameIds(before, after) && result.plan.candidateSet?.items?.length) {
      try {
        const completed = await completePlanShelf(result.plan, new Date());
        if (completed) {
          const again = await saveMealPlan(completed);
          if (again.ok) result = { ...result, plan: again.plan };
        }
      } catch (error) {
        console.error(`Shelf completion failed for ${plan.week}:`, error);
      }
    }
    // Return the plan *as stored*, not as sent. The save boundary can change
    // it — a meal-changing edit to a finalized week returns that week to
    // `draft` server-side, and stale-save preservation can keep a stored
    // assignment the client did not have. A client that keeps rendering what
    // it sent would show a "Week finalized" badge for a week that is no longer
    // finalized until the next reload.
    return NextResponse.json({
      ok: true,
      plan: result.plan,
      status: result.plan.status ?? "draft",
      ...(result.candidateSanitation ? { candidateSanitation: result.candidateSanitation } : {}),
      ...(result.shoppingInvalidated ? { shoppingInvalidated: result.shoppingInvalidated } : {}),
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to save plan" },
      { status: 500 }
    );
  }
}
