/**
 * POST /api/meals/replace
 *   { week, removeRecipeIds?, dropWhere?, wish? }
 *
 * Targeted replacement of *unassigned* recommendations (Kitchen DESIGN.md
 * §4.3, step 9: "Chat-driven wishes use this same targeted replacement path;
 * they never reroll the week").
 *
 * What this guarantees:
 *   - a recipe that is assigned to a day is never removed, even when it is
 *     explicitly named. It is reported back in `protectedAssigned` instead
 *   - replacements are revalidated against the same set-level rules as the
 *     weekly shelf, so a wish cannot create three pasta nights
 *   - the rest of the shelf keeps its cards, order, and reasons
 *
 * This is the deterministic service seam a chat bridge calls. The natural-
 * language → `{ dropWhere, wish }` adapter is a separate, still-open task; it
 * has no business inside this route.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guardRuntimeWrite } from "@/lib/api-guards";
import { applyTargetedReplacement } from "@/lib/planner-shelf";
import type { ShelfTraits } from "@/lib/planner-shelf";
import {
  assignedRecipeIdsForPlan,
  hydrateShelfItems,
  toCandidateItem,
  SHELF_POLICY_VERSION,
} from "@/lib/planner-preparation";
import { loadMealPlan, saveMealPlan } from "@/lib/meals-persistence";
import { loadReplacementCandidates } from "@/lib/planner-runtime";
import { getRecipe } from "@/lib/recipes";

const WEEK_PATTERN = /^\d{4}-W\d{2}$/;
const DROP_KEYS = ["protein", "shape", "starch", "effort"] as const;

function parseDropWhere(raw: unknown): Partial<Pick<ShelfTraits, "protein" | "shape" | "starch" | "effort">> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const source = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of DROP_KEYS) {
    if (typeof source[key] === "string") out[key] = source[key];
  }
  return Object.keys(out).length > 0
    ? (out as Partial<Pick<ShelfTraits, "protein" | "shape" | "starch" | "effort">>)
    : undefined;
}

export async function POST(request: NextRequest) {
  const guard = await guardRuntimeWrite(request);
  if (guard.response) return guard.response;

  let body: { week?: unknown; removeRecipeIds?: unknown; dropWhere?: unknown; wish?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const week = typeof body.week === "string" ? body.week : "";
  if (!WEEK_PATTERN.test(week)) {
    return NextResponse.json({ error: "Invalid week format (expected YYYY-Wnn)" }, { status: 400 });
  }

  const removeRecipeIds = Array.isArray(body.removeRecipeIds)
    ? body.removeRecipeIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  const dropWhere = parseDropWhere(body.dropWhere);
  const wish = typeof body.wish === "string" ? body.wish.slice(0, 200) : undefined;

  if (removeRecipeIds.length === 0 && !dropWhere) {
    return NextResponse.json(
      { error: "Nothing to replace — supply removeRecipeIds and/or dropWhere" },
      { status: 400 },
    );
  }

  try {
    const plan = await loadMealPlan(week);
    if (!plan?.candidateSet?.items?.length) {
      return NextResponse.json({ error: "No saved idea shelf for that week", week }, { status: 404 });
    }
    if (plan.locked) {
      return NextResponse.json({ error: "Plan is locked", week, locked: true }, { status: 409 });
    }

    const now = new Date();
    const assigned = assignedRecipeIdsForPlan(plan);
    const shelf = await hydrateShelfItems(plan.candidateSet.items, assigned, getRecipe, now);
    const onShelf = new Set(shelf.map((item) => item.recipeId));
    const replacements = await loadReplacementCandidates(week, now, onShelf);

    const result = applyTargetedReplacement(shelf, {
      removeRecipeIds,
      dropWhere,
      replacements,
      wish,
    });

    const saved = await saveMealPlan({
      ...plan,
      candidateSet: {
        ...plan.candidateSet,
        // A targeted swap re-stamps the policy version but deliberately keeps
        // `generatedAt`: the shelf was prepared then, not now, and the watchdog
        // staleness check must keep measuring from the real preparation time.
        policyVersion: SHELF_POLICY_VERSION,
        items: result.shelf.map(toCandidateItem),
      },
      updatedAt: now.toISOString(),
    });

    if (!saved.ok) {
      return NextResponse.json({ error: "Plan is locked", week, locked: true }, { status: 409 });
    }

    return NextResponse.json({
      week,
      removed: result.removed,
      added: result.added.map((item) => ({
        recipeId: item.recipeId,
        recipeName: item.recipeName,
        reason: item.reason,
        origin: item.origin,
      })),
      protectedAssigned: result.protectedAssigned,
      shelfSize: result.shelf.length,
      remainingGaps: result.remainingGaps,
      warnings: result.warnings,
      plan: saved.plan,
    });
  } catch (error) {
    console.error(`Targeted replacement failed for ${week}:`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Targeted replacement failed", week },
      { status: 500 },
    );
  }
}
