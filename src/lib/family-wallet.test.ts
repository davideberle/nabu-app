import { deepStrictEqual, equal } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  rewardDefinitions,
  routineDefinitions,
  type CompletionRecord,
} from "../data/family-routines.ts";
import { computeFamilyWallet, FAMILY_WALLET_EPOCH_WEEK, resolveRedemptionWeek } from "./family-wallet.ts";

const row = (
  week: string,
  routineId: string,
  personId: string,
  day: number,
  status = "done",
  creditCount = 1,
) => ({ week, routineId, personId, day, status, creditCount } as CompletionRecord & { week: string });

const w37 = [
  row("2026-W37", "i-piano", "isabel", 0),
  row("2026-W37", "i-kumon", "isabel", 1, "done", 4),
  row("2026-W37", "i-physio", "isabel", 2),
  row("2026-W37", "i-dinner", "isabel", 3),
  row("2026-W37", "s-kumon", "santiago", 0),
  row("2026-W37", "s-piano", "santiago", 1),
  row("2026-W37", "s-physio", "santiago", 2),
  row("2026-W37", "s-table-dinner", "santiago", 3),
  row("2026-W37", "s-extra-bonus", "santiago", 4),
];

describe("permanent family wallet", () => {
  it("starts at W34 and excludes pre-epoch demo/history rows", () => {
    equal(FAMILY_WALLET_EPOCH_WEEK, "2026-W34");
    const wallet = computeFamilyWallet(
      "isabel",
      [row("2026-W33", "i-kumon", "isabel", 0), ...w37],
      [{ personId: "isabel", rewardId: "friends", week: "2026-W33" }],
      routineDefinitions,
      rewardDefinitions,
    );
    deepStrictEqual(wallet, { earned: 7, spent: 0, balance: 7, redeemedCounts: {} });
  });

  it("carries W37 credits into an empty W38 wallet with creditCount semantics", () => {
    equal(computeFamilyWallet("isabel", w37, [], routineDefinitions, rewardDefinitions).balance, 7);
    equal(computeFamilyWallet("santiago", w37, [], routineDefinitions, rewardDefinitions).balance, 5);
  });

  it("carries a debit forward and counts only done completions", () => {
    const wallet = computeFamilyWallet(
      "isabel",
      [...w37, row("2026-W38", "i-kumon", "isabel", 0, "pending_review")],
      [{ personId: "isabel", rewardId: "friends", week: "2026-W37" }],
      routineDefinitions,
      rewardDefinitions,
    );
    deepStrictEqual(wallet, { earned: 7, spent: 3, balance: 4, redeemedCounts: { friends: 1 } });
  });

  it("is week-invariant because viewed week is not a ledger input", () => {
    const fromHistoricalView = computeFamilyWallet("santiago", w37, [], routineDefinitions, rewardDefinitions);
    const fromCurrentView = computeFamilyWallet("santiago", w37, [], routineDefinitions, rewardDefinitions);
    deepStrictEqual(fromHistoricalView, fromCurrentView);
  });

  it("uses resolved point and reward-cost overrides", () => {
    const routines = routineDefinitions.map((routine) =>
      routine.id === "s-kumon" ? { ...routine, points: 2 } : routine,
    );
    const rewards = rewardDefinitions.map((reward) =>
      reward.id === "friends" ? { ...reward, costPoints: 4 } : reward,
    );
    const wallet = computeFamilyWallet(
      "santiago",
      [row("2026-W37", "s-kumon", "santiago", 0)],
      [{ personId: "santiago", rewardId: "friends", week: "2026-W38" }],
      routines,
      rewards,
    );
    deepStrictEqual(wallet, { earned: 2, spent: 4, balance: -2, redeemedCounts: { friends: 1 } });
  });
});

describe("redemption week contract", () => {
  const now = new Date("2026-09-16T12:00:00Z");

  it("server-stamps an omitted week with the current ISO week", () => {
    deepStrictEqual(resolveRedemptionWeek(undefined, now), { ok: true, week: "2026-W38" });
  });

  it("accepts an explicit current week but rejects historical backdating", () => {
    deepStrictEqual(resolveRedemptionWeek("2026-W38", now), { ok: true, week: "2026-W38" });
    deepStrictEqual(resolveRedemptionWeek("2026-W37", now), { ok: false, currentWeek: "2026-W38" });
  });
});
