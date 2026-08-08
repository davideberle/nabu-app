// The POST /api/meals/plan response contract, shared by the route and /meals.
//
// It exists because the planner UI cannot render what it *sent*. The save
// boundary can change the plan on the way in (kitchen DESIGN.md §"Phase 4C"):
// a meal-changing edit to a finalized week returns that week to `draft` and
// invalidates the shopping list generated from it. A client that keeps showing
// its optimistic copy shows a "Week finalized" badge for a week the server has
// already reopened, and a shopping list that can no longer be approved, until
// someone reloads.
//
// So the route answers with the plan as stored plus what the save did to the
// week's shopping state, and the page reconciles to that.

import type { MealPlan } from "./meals";

export type ShoppingInvalidationSummary = {
  /**
   * `meals-changed` — the set of planned recipes differs, so the week was
   * returned to draft and its shopping list marked out of date.
   * `reopened` — a finalized week was explicitly reopened; the list still
   * describes the right meals, but its approval was withdrawn.
   */
  cause: "meals-changed" | "reopened";
  returnedToDraft: boolean;
  cancelledOutboxItems: number;
};

export type SavePlanResponse = {
  ok: true;
  /** The plan exactly as stored — not as sent. */
  plan: MealPlan;
  status: "draft" | "finalized";
  shoppingInvalidated?: ShoppingInvalidationSummary;
};

/**
 * One sentence for the week-status card when a save changed the week's
 * shopping state under the planner's feet.
 *
 * It names what happened and what to do about it, because the user's next
 * action differs: a meal change needs the list regenerated, a reopen only needs
 * it re-approved.
 */
export function shoppingInvalidationNotice(
  invalidation: ShoppingInvalidationSummary,
): string {
  const cancelled = invalidation.cancelledOutboxItems;
  const queued =
    cancelled > 0
      ? ` ${cancelled} queued Bring item${cancelled === 1 ? "" : "s"} cancelled.`
      : "";
  if (invalidation.cause === "meals-changed") {
    return (
      "That meal change reopened the week and marked its shopping list out of date." +
      `${queued} Finalize the week again and regenerate the list.`
    );
  }
  return (
    "Reopening the week withdrew its shopping approval." +
    `${queued} Finalize again and re-approve to queue Bring.`
  );
}

/**
 * What a save response is allowed to change on the page.
 *
 * `stale` means a newer edit was committed while this save was in flight, so
 * the response describes a plan the planner has already moved past.
 */
export type SavedPlanReconciliation =
  | { stale: true }
  | { stale: false; plan: MealPlan; notice: string | null };

/**
 * Decide what an in-flight save's response may apply.
 *
 * The identity check is the whole point: a save answers about the plan it was
 * *sent*, so a response that arrives after a newer local edit is describing
 * history. Every side effect derived from that response — the stored plan and
 * the shopping notice alike — has to sit behind the same guard. A superseded
 * save that could still set or clear the notice would flash an invalidation
 * banner for an edit the planner has already replaced, or wipe the banner the
 * *current* plan legitimately earned.
 *
 * `current` is the plan the page holds right now (its ref, read at response
 * time); `sent` is the object the save was given. Identity, not deep equality:
 * every local commit produces a new object. The comparison is identity only, so
 * the parameter is generic — /meals carries its own structurally looser plan
 * type, and this does not need to agree with it.
 */
export function reconcileSavedPlanResponse<TPlan>(
  sent: TPlan,
  current: TPlan | null,
  response: SavePlanResponse,
): SavedPlanReconciliation {
  if (current !== sent) return { stale: true };
  return {
    stale: false,
    plan: response.plan,
    notice: response.shoppingInvalidated
      ? shoppingInvalidationNotice(response.shoppingInvalidated)
      : null,
  };
}
