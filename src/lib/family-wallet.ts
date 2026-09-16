import type { CompletionRecord } from "../data/family-routines.ts";
import { isoWeekIdInZurich } from "./date.ts";

/** The first real family-rewards week. Earlier demo/history rows never fund wallets. */
export const FAMILY_WALLET_EPOCH_WEEK = "2026-W34";

export type WalletCompletion = CompletionRecord & { week: string };
export type WalletRedemption = {
  personId: string;
  rewardId: string;
  week: string;
  chargedPoints: number;
};

export type FamilyWallet = {
  earned: number;
  spent: number;
  balance: number;
  redeemedCounts: Record<string, number>;
};

export type FamilyWalletProjection = {
  epochWeek: string;
  currentWeek: string;
  wallets: Record<string, FamilyWallet>;
};

export type RedemptionWeekResolution =
  | { ok: true; week: string }
  | { ok: false; currentWeek: string };

/** Capture the configured amount for a newly earned completion. */
export function snapshotCompletionAward(points: number, creditCount: number): number {
  return points * creditCount;
}

/**
 * Correct a credited unit count without repricing the old completion from
 * today's configuration. The fallback is only for a pre-migration row that
 * has no captured amount yet.
 */
export function correctedCompletionAward(
  previousAward: number | null,
  previousCount: number,
  nextCount: number,
  fallbackPoints: number,
): number {
  const pointsPerCredit = previousAward !== null && previousCount > 0
    ? previousAward / previousCount
    : fallbackPoints;
  return pointsPerCredit * nextCount;
}

/** Server contract: omit week, or echo the actual current week; never backdate. */
export function resolveRedemptionWeek(
  requestedWeek: unknown,
  now = new Date(),
): RedemptionWeekResolution {
  const currentWeek = isoWeekIdInZurich(now);
  return requestedWeek === undefined || requestedWeek === currentWeek
    ? { ok: true, week: currentWeek }
    : { ok: false, currentWeek };
}

/**
 * Project one permanent wallet from the append-only completion/redemption
 * history. Week remains audit metadata; only the epoch boundary affects the
 * spendable balance.
 */
export function computeFamilyWallet(
  personId: string,
  completions: readonly WalletCompletion[],
  redemptions: readonly WalletRedemption[],
  epochWeek = FAMILY_WALLET_EPOCH_WEEK,
): FamilyWallet {
  const eligibleCompletions = completions.filter(
    (row) => row.week >= epochWeek && row.status === "done" && Number.isFinite(row.awardedPoints),
  );
  const eligibleRedemptions = redemptions.filter((row) => row.week >= epochWeek);
  const earned = eligibleCompletions.reduce(
    (sum, row) => sum + (row.personId === personId ? row.awardedPoints! : 0),
    0,
  );
  const redeemedCounts: Record<string, number> = {};
  for (const redemption of eligibleRedemptions) {
    if (redemption.personId !== personId) continue;
    redeemedCounts[redemption.rewardId] = (redeemedCounts[redemption.rewardId] ?? 0) + 1;
  }
  const spent = eligibleRedemptions.reduce(
    (sum, row) => sum + (row.personId === personId ? row.chargedPoints : 0),
    0,
  );
  return { earned, spent, balance: earned - spent, redeemedCounts };
}
