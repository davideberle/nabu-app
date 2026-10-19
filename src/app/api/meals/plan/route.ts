import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { isTrackerOnlyEmail } from "@/lib/access";
import { saveMealPlan, loadMealPlan } from "@/lib/meals-persistence";
import type { MealPlan } from "@/lib/meals";
import { assignedRecipeIdsForPlan, hydrateShelfItems, toCandidateItem } from "@/lib/planner-preparation";
import { getCandidateReviews, getPlannerRecencyExclusions } from "@/lib/db";
import { sanitizeCandidateItems } from "@/lib/meals-core";
import { completePlanShelf, reviewProviderStatusFor } from "@/lib/planner-runtime";
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

      // A shelf persisted before a recent cook or plan was recorded must not
      // keep offering it: the hard recency rules (cooked within the window,
      // planned in recent prior weeks, including explicit adaptation aliases)
      // and active thumbs-down apply on the way out too. Read-only — the stored
      // shelf is cleaned by the save boundary on its next write, and the
      // offered/exposure rules stay where the shelf builder applied them.
      // If the exclusion read fails, show the stored shelf rather than fail
      // the whole planner load.
      const assigned = assignedRecipeIdsForPlan(plan);
      let current = plan.candidateSet.items;
      try {
        const exclusions = await getPlannerRecencyExclusions(plan.week);
        current = sanitizeCandidateItems(plan.candidateSet.items, assigned, {
          recentlyCooked: exclusions.recentlyCooked,
          recentlyPlanned: exclusions.recentlyPlanned,
          recentlyOffered: new Set<string>(),
          negativeFeedback: exclusions.negativeFeedback,
        }).items;
      } catch (error) {
        console.error(`Recency filter failed for ${plan.week}:`, error);
      }

      // Read-only: the planned week binds seasonality and persisted reviews
      // re-bind each card (a stale pass drops, a current hold shows). No
      // inference is ever triggered by a page load.
      const items = await hydrateShelfItems(
        current,
        assigned,
        resolveRecipe,
        new Date(),
        {
          week: plan.week,
          resolveReviews: (bindings) => getCandidateReviews(bindings),
          // The latest review run's outcome keeps an outage distinct from
          // "never reviewed" on the actual read as well.
          providerStatus: await reviewProviderStatusFor(plan.week),
        },
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
    // it — stale-save preservation can keep a stored assignment the client did
    // not have, and candidate sanitation can drop ideas. There is no week
    // finalization any more: a save never changes shopping eligibility beyond
    // marking an existing draft out of date.
    return NextResponse.json({
      ok: true,
      plan: result.plan,
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
