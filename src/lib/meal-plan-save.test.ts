// Unit tests for the user-facing notice /meals shows when a save marked an
// existing shopping draft out of date, and for the save-response reconciliation
// guard. Week finalization was retired on 2026-10-19, so there is one cause.
//
// Run with: npm test  (node --test; Node 24 strips types natively)

import { equal, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  reconcileSavedPlanResponse,
  shoppingInvalidationNotice,
  type SavePlanResponse,
} from "./meal-plan-save.ts";
import type { MealPlan } from "./meals.ts";

describe("shoppingInvalidationNotice", () => {
  it("says a meal change marked the shopping list out of date", () => {
    const notice = shoppingInvalidationNotice({
      cause: "meals-changed",
      returnedToDraft: true,
      cancelledOutboxItems: 0,
    });
    ok(/out of date/.test(notice));
  });

  it("never asks anyone to finalize or re-approve — that workflow is retired", () => {
    const notice = shoppingInvalidationNotice({
      cause: "meals-changed",
      returnedToDraft: true,
      cancelledOutboxItems: 2,
    });
    equal(/finali[sz]e|re-approve|reopen/i.test(notice), false);
  });

  it("reports cancelled Bring items, with correct singular and plural", () => {
    const one = shoppingInvalidationNotice({
      cause: "meals-changed",
      returnedToDraft: true,
      cancelledOutboxItems: 1,
    });
    ok(/1 queued Bring item cancelled/.test(one));

    const many = shoppingInvalidationNotice({
      cause: "meals-changed",
      returnedToDraft: true,
      cancelledOutboxItems: 7,
    });
    ok(/7 queued Bring items cancelled/.test(many));
  });

  it("says nothing about Bring when nothing was queued", () => {
    const notice = shoppingInvalidationNotice({
      cause: "meals-changed",
      returnedToDraft: true,
      cancelledOutboxItems: 0,
    });
    equal(/Bring item/.test(notice), false);
  });
});

describe("reconcileSavedPlanResponse", () => {
  function planFor(week: string): MealPlan {
    return {
      week,
      status: "draft",
      plannerVersion: "vNext-1",
      candidateSet: null,
      days: [],
      context: [],
      notes: "",
      locked: false,
      createdAt: "2026-10-01T00:00:00.000Z",
    };
  }

  const INVALIDATED: SavePlanResponse["shoppingInvalidated"] = {
    cause: "meals-changed",
    returnedToDraft: true,
    cancelledOutboxItems: 3,
  };

  it("adopts the stored plan and its notice when nothing newer is pending", () => {
    const sent = planFor("2026-W41");
    const stored = { ...planFor("2026-W41"), notes: "stored" };
    const outcome = reconcileSavedPlanResponse(sent, sent, {
      ok: true,
      plan: stored,
    });
    equal(outcome.stale, false);
    ok(!outcome.stale && outcome.plan === stored);
    ok(!outcome.stale && outcome.notice === null);
  });

  it("carries the invalidation notice through for a current response", () => {
    const sent = planFor("2026-W41");
    const outcome = reconcileSavedPlanResponse(sent, sent, {
      ok: true,
      plan: sent,
      shoppingInvalidated: INVALIDATED,
    });
    ok(!outcome.stale);
    equal(outcome.notice, shoppingInvalidationNotice(INVALIDATED));
  });

  it("lets a superseded response change nothing — not the plan, not the notice", () => {
    // The regression: the notice used to be set before the identity guard, so a
    // slow save could raise an invalidation banner for an edit the planner had
    // already replaced.
    const sent = planFor("2026-W41");
    const newer = planFor("2026-W41");
    const outcome = reconcileSavedPlanResponse(sent, newer, {
      ok: true,
      plan: sent,
      shoppingInvalidated: INVALIDATED,
    });
    equal(outcome.stale, true);
    equal("notice" in outcome, false, "a stale response must carry no side effect at all");
  });

  it("does not let a superseded response clear a notice either", () => {
    const sent = planFor("2026-W41");
    const newer = planFor("2026-W41");
    const outcome = reconcileSavedPlanResponse(sent, newer, {
      ok: true,
      plan: sent,
    });
    equal(outcome.stale, true);
  });

  it("treats an unloaded page as superseding — identity, not deep equality", () => {
    const sent = planFor("2026-W41");
    equal(reconcileSavedPlanResponse(sent, null, { ok: true, plan: sent }).stale, true);
    // A structurally identical but distinct object is still a later commit.
    equal(
      reconcileSavedPlanResponse(sent, planFor("2026-W41"), {
        ok: true,
        plan: sent,
      }).stale,
      true,
    );
  });
});
