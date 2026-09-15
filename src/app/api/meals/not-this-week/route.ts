/**
 * POST /api/meals/not-this-week  { week, recipeId }
 *
 * "Not this week" (Kitchen DESIGN.md, Phase 4E). Removes one unassigned idea
 * from the week's shelf immediately and records the dismissal with the
 * week's candidate set — exposure state for that week only, never a
 * permanent dislike. The remaining unassigned recommendations are then
 * reranked/replaced against the actual plan; assigned days never move.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guardRuntimeWrite } from "@/lib/api-guards";
import { applyNotThisWeek, assignedRecipeIdsForPlan } from "@/lib/planner-preparation";
import { completePlanShelf } from "@/lib/planner-runtime";
import { loadMealPlan, saveMealPlan } from "@/lib/meals-persistence";

const WEEK_PATTERN = /^\d{4}-W\d{2}$/;

export async function POST(request: NextRequest) {
  const guard = await guardRuntimeWrite(request);
  if (guard.response) return guard.response;

  let body: { week?: unknown; recipeId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const week = typeof body.week === "string" ? body.week : "";
  const recipeId = typeof body.recipeId === "string" ? body.recipeId.trim() : "";
  if (!WEEK_PATTERN.test(week)) {
    return NextResponse.json({ error: "Invalid week format (expected YYYY-Wnn)" }, { status: 400 });
  }
  if (!recipeId) return NextResponse.json({ error: "recipeId is required" }, { status: 400 });

  try {
    const plan = await loadMealPlan(week);
    if (!plan?.candidateSet?.items?.length) {
      return NextResponse.json({ error: "No saved idea shelf for that week", week }, { status: 404 });
    }
    if (plan.locked) {
      return NextResponse.json({ error: "Plan is locked", week, locked: true }, { status: 409 });
    }
    const now = new Date();
    const applied = applyNotThisWeek(plan.candidateSet, recipeId, assignedRecipeIdsForPlan(plan), now);
    if (applied.protectedAssigned) {
      return NextResponse.json({ error: "That idea is assigned to a day", week, recipeId }, { status: 409 });
    }
    if (!applied.removed) {
      return NextResponse.json({ error: "That idea is not on this week's shelf", week, recipeId }, { status: 404 });
    }
    const dismissedPlan = {
      ...plan,
      candidateSet: { ...plan.candidateSet, items: applied.items, notThisWeek: applied.notThisWeek },
      updatedAt: now.toISOString(),
    };
    const completed = (await completePlanShelf(dismissedPlan, now)) ?? dismissedPlan;
    const saved = await saveMealPlan(completed);
    if (!saved.ok) {
      return NextResponse.json({ error: "Plan is locked", week, locked: true }, { status: 409 });
    }
    return NextResponse.json({
      week,
      recipeId,
      removed: applied.removed,
      notThisWeek: applied.notThisWeek,
      shelfSize: saved.plan.candidateSet?.items?.length ?? 0,
      plan: saved.plan,
    });
  } catch (error) {
    console.error(`Not-this-week failed for ${week}/${recipeId}:`, error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Not this week failed", week }, { status: 500 });
  }
}
