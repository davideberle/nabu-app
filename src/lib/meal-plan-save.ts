// The POST /api/meals/plan response contract, shared by the route and /meals.
//
// It exists because the planner UI cannot render what it *sent*. The save
// boundary can change the plan on the way in (kitchen DESIGN.md §"Phase 4C"):
// stale-save preservation can keep a stored assignment the client did not
// have, candidate sanitation can drop or relabel ideas, and a meal-changing
// edit marks any existing shopping draft for the week out of date.
//
// So the route answers with the plan as stored plus what the save did to the
// week's shopping state, and the page reconciles to that. Week finalization
// was retired on 2026-10-19; there is no finalize/reopen transition any more.

import type { MealPlan } from "./meals";

export type ShoppingInvalidationSummary = {
  /**
   * `meals-changed` — the set of planned recipes differs from an existing
   * shopping draft's, so that draft was marked out of date and any of its
   * still-queued rows were cancelled. Nothing is ever enqueued by a save.
   */
  cause: "meals-changed";
  returnedToDraft: boolean;
  cancelledOutboxItems: number;
};

export type SavePlanResponse = {
  ok: true;
  /** The plan exactly as stored — not as sent. */
  plan: MealPlan;
  shoppingInvalidated?: ShoppingInvalidationSummary;
};

/**
 * One sentence for the planner when a save marked an existing shopping draft
 * out of date. Only reachable for a week that already had a draft; shopping
 * generation is parked, so new weeks never do.
 */
export function shoppingInvalidationNotice(
  invalidation: ShoppingInvalidationSummary,
): string {
  const cancelled = invalidation.cancelledOutboxItems;
  const queued =
    cancelled > 0
      ? ` ${cancelled} queued Bring item${cancelled === 1 ? "" : "s"} cancelled.`
      : "";
  return `That meal change marked this week's shopping list out of date.${queued}`;
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
