import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { isTrackerOnlyEmail } from "@/lib/access";
import { saveMealPlan, loadMealPlan } from "@/lib/meals-persistence";
import { reclassifyCandidateItems, type MealPlan } from "@/lib/meals";
import { withShelfDisplay } from "@/lib/planner-preparation";
import { getRecipe } from "@/lib/recipes";

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
    // Persisted bucket labels never override the authoritative classifier —
    // reclassify on the way out so stale stored labels cannot reach the UI.
    //
    // The display contract is attached in the same pass. It is a read-time
    // derivation on purpose: a week prepared before the contract existed gains
    // its groups, editorial notes and light-meal labels here, without its shelf
    // being regenerated or any day assignment moving.
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

      const { items } = await reclassifyCandidateItems(plan.candidateSet.items, resolveRecipe);
      const displayed = await withShelfDisplay(items, resolveRecipe, new Date());
      return NextResponse.json({
        ...plan,
        candidateSet: { ...plan.candidateSet, items: displayed },
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
    const result = await saveMealPlan(plan);
    if (!result.ok) {
      return NextResponse.json(
        { error: "Plan is locked", locked: true },
        { status: 409 }
      );
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
