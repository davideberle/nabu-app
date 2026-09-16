import { deepStrictEqual, equal } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type CompletionRecord,
} from "../data/family-routines.ts";
import {
  computeFamilyWallet,
  correctedCompletionAward,
  FAMILY_WALLET_EPOCH_WEEK,
  resolveRedemptionWeek,
  snapshotCompletionAward,
} from "./family-wallet.ts";

const row = (
  week: string,
  routineId: string,
  personId: string,
  day: number,
  status = "done",
  creditCount = 1,
  pointsPerCredit = 1,
) => ({
  week,
  routineId,
  personId,
  day,
  status,
  creditCount,
  awardedPoints: status === "done" ? creditCount * pointsPerCredit : undefined,
} as CompletionRecord & { week: string });

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
  it("snapshots points times credit count and preserves that price during a later count correction", () => {
    equal(snapshotCompletionAward(2, 4), 8);
    equal(correctedCompletionAward(8, 4, 5, 9), 10);
    equal(correctedCompletionAward(null, 1, 3, 2), 6);
  });

  it("starts at W34 and excludes pre-epoch demo/history rows", () => {
    equal(FAMILY_WALLET_EPOCH_WEEK, "2026-W34");
    const wallet = computeFamilyWallet(
      "isabel",
      [row("2026-W33", "i-kumon", "isabel", 0), ...w37],
      [{ personId: "isabel", rewardId: "friends", week: "2026-W33", chargedPoints: 3 }],
    );
    deepStrictEqual(wallet, { earned: 7, spent: 0, balance: 7, redeemedCounts: {} });
  });

  it("carries W37 credits into an empty W38 wallet with creditCount semantics", () => {
    equal(computeFamilyWallet("isabel", w37, []).balance, 7);
    equal(computeFamilyWallet("santiago", w37, []).balance, 5);
  });

  it("carries a debit forward and counts only done completions", () => {
    const wallet = computeFamilyWallet(
      "isabel",
      [...w37, row("2026-W38", "i-kumon", "isabel", 0, "pending_review")],
      [{ personId: "isabel", rewardId: "friends", week: "2026-W37", chargedPoints: 3 }],
    );
    deepStrictEqual(wallet, { earned: 7, spent: 3, balance: 4, redeemedCounts: { friends: 1 } });
  });

  it("is week-invariant because viewed week is not a ledger input", () => {
    const fromHistoricalView = computeFamilyWallet("santiago", w37, []);
    const fromCurrentView = computeFamilyWallet("santiago", w37, []);
    deepStrictEqual(fromHistoricalView, fromCurrentView);
  });

  it("uses durable event amounts rather than current definitions", () => {
    const wallet = computeFamilyWallet(
      "santiago",
      [row("2026-W37", "removed-routine", "santiago", 0, "done", 1, 2)],
      [{ personId: "santiago", rewardId: "removed-reward", week: "2026-W38", chargedPoints: 4 }],
    );
    deepStrictEqual(wallet, { earned: 2, spent: 4, balance: -2, redeemedCounts: { "removed-reward": 1 } });
  });

  it("never earns from non-earning states even if a stale amount is present", () => {
    const nonEarning = ["pending_review", "on_hold", "redo"].map((status, day) => ({
      ...row("2026-W38", "s-kumon", "santiago", day, status),
      awardedPoints: 99,
    }));
    deepStrictEqual(computeFamilyWallet("santiago", nonEarning, []), {
      earned: 0,
      spent: 0,
      balance: 0,
      redeemedCounts: {},
    });
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

  it("uses the Zurich Monday after local midnight even while UTC is still Sunday", () => {
    const zurichMondayUtcSunday = new Date("2026-09-20T22:30:00Z");
    deepStrictEqual(resolveRedemptionWeek(undefined, zurichMondayUtcSunday), {
      ok: true,
      week: "2026-W39",
    });
  });

  it("handles Zurich DST and ISO-year boundaries", () => {
    deepStrictEqual(resolveRedemptionWeek(undefined, new Date("2026-12-31T23:30:00Z")), {
      ok: true,
      week: "2026-W53",
    });
    deepStrictEqual(resolveRedemptionWeek(undefined, new Date("2027-01-03T23:30:00Z")), {
      ok: true,
      week: "2027-W01",
    });
  });
});
