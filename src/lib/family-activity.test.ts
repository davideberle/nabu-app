// Activity chronology (FH-08): source-linked ids, one item per claim, genuine timestamps, filters never change coins. Run: npm test

import { deepEqual, equal, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import { activityCoinTotal, composeActivity, filterActivity, type ActivityCompletion, type ActivityRedemption } from "./family-activity.ts";

const completions: ActivityCompletion[] = [
  { week: "2026-W40", personId: "santiago", routineId: "s-kumon", day: 1, status: "pending_review", submittedAt: "2026-09-29T15:00:00.000Z", creditCount: 2, note: "zwei Blätter", normalizedSummary: "zwei Blätter" },
  { week: "2026-W40", personId: "santiago", routineId: "s-piano", day: 2, status: "done", submittedAt: "2026-09-30T15:00:00.000Z", reviewedAt: "2026-09-30T18:00:00.000Z", awardedPoints: 1, creditCount: 1 },
  { week: "2026-W39", personId: "santiago", routineId: "s-piano", day: 4, status: "redo", submittedAt: "2026-09-25T15:00:00.000Z", reviewedAt: "2026-09-25T18:00:00.000Z" },
  { week: "2026-W35", personId: "santiago", routineId: "s-kumon", day: 0, status: "done", awardedPoints: 1 },
  { week: "2026-W40", personId: "isabel", routineId: "i-kumon", day: 1, status: "done", submittedAt: "2026-09-29T15:00:00.000Z", reviewedAt: "2026-09-29T16:00:00.000Z", awardedPoints: 4, creditCount: 4 },
];
const redemptions: ActivityRedemption[] = [
  { id: "r-1", personId: "santiago", rewardId: "mini-game", week: "2026-W40", chargedPoints: 2, createdAt: "2026-10-01T10:00:00.000Z" },
  { id: "r-2", personId: "santiago", rewardId: "game-play-15min", week: "2026-W40", chargedPoints: 3, createdAt: "2026-10-02T10:00:00.000Z" },
];

describe("composeActivity", () => {
  const items = composeActivity({ personId: "santiago", completions, redemptions, purchases: [{ id: "p-1", personId: "santiago", idempotencyKey: "k", redemptionId: "r-2", chargedPoints: 3, grantedSeconds: 900, state: "committed", createdAt: "2026-10-02T10:00:00.000Z", refundedAt: null, refundReason: null }] });

  it("never shows the sibling and keys every item by its stable source id", () => {
    ok(items.every((i) => i.personId === "santiago"));
    deepEqual(items.map((i) => i.id), [
      "redemption:r-2",
      "redemption:r-1",
      "completion:2026-W40:santiago:s-piano:2",
      "completion:2026-W40:santiago:s-kumon:1",
      "completion:2026-W39:santiago:s-piano:4",
      "completion:2026-W35:santiago:s-kumon:0",
    ]);
    equal(new Set(items.map((i) => i.id)).size, items.length);
  });

  it("a claim is one item: pending earns nothing, approval carries the stored award, redo earns nothing", () => {
    const pending = items.find((i) => i.id.endsWith("s-kumon:1"))!;
    equal(pending.status, "pending");
    equal(pending.coinDelta, null);
    equal(pending.title, "Kumon ×2");
    const approved = items.find((i) => i.id.endsWith("s-piano:2"))!;
    equal(approved.status, "approved");
    equal(approved.coinDelta, 1);
    equal(approved.submittedAt, "2026-09-30T15:00:00.000Z");
    equal(approved.reviewedAt, "2026-09-30T18:00:00.000Z");
    equal(items.find((i) => i.id.endsWith("s-piano:4"))!.coinDelta, null);
  });

  it("keeps a legacy row without timestamps instead of inventing a clock time", () => {
    const legacy = items.find((i) => i.id.endsWith("s-kumon:0"))!;
    equal(legacy.submittedAt, null);
    equal(legacy.reviewedAt, null);
    equal(legacy.sortAt, "2026-08-24");
    equal(legacy.coinDelta, 1);
  });

  it("redemptions and game-time purchases are negative deltas with the redeemed timestamp", () => {
    const mini = items.find((i) => i.id === "redemption:r-1")!;
    equal(mini.coinDelta, -2);
    equal(mini.redeemedAt, "2026-10-01T10:00:00.000Z");
    const play = items.find((i) => i.id === "redemption:r-2")!;
    equal(play.kind, "play-purchase");
    equal(play.title, "Game time · 15 minutes");
    equal(play.coinDelta, -3);
  });

  it("a refunded purchase shows as refunded with no coin change", () => {
    const refunded = composeActivity({ personId: "santiago", completions: [], redemptions: [redemptions[1]], purchases: [{ id: "p-1", personId: "santiago", idempotencyKey: "k", redemptionId: "r-2", chargedPoints: 3, grantedSeconds: 900, state: "refunded", createdAt: "x", refundedAt: "y", refundReason: "issuance failed" }] });
    equal(refunded[0].status, "refunded");
    equal(refunded[0].coinDelta, 0);
  });

  it("the weekly filter narrows the list but the totals are display sums, not a wallet", () => {
    const week = filterActivity(items, "week", "2026-W40");
    deepEqual(week.map((i) => i.week), ["2026-W40", "2026-W40", "2026-W40", "2026-W40"]);
    equal(activityCoinTotal(week), -4);
    equal(activityCoinTotal(items), -3);
    equal(filterActivity(items, "all", "2026-W40").length, items.length);
  });
});
