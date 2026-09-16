import { weekPoints, type CompletionRecord, type RewardDefinition, type RoutineDefinition } from "../data/family-routines.ts";
import { currentIsoWeekId } from "./meals-core.ts";

/** The first real family-rewards week. Earlier demo/history rows never fund wallets. */
export const FAMILY_WALLET_EPOCH_WEEK = "2026-W34";

export type WalletCompletion = CompletionRecord & { week: string };
export type WalletRedemption = {
  personId: string;
  rewardId: string;
  week: string;
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

/** Server contract: omit week, or echo the actual current week; never backdate. */
export function resolveRedemptionWeek(
  requestedWeek: unknown,
  now = new Date(),
): RedemptionWeekResolution {
  const currentWeek = currentIsoWeekId(now);
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
  routines: readonly RoutineDefinition[],
  rewards: readonly RewardDefinition[],
  epochWeek = FAMILY_WALLET_EPOCH_WEEK,
): FamilyWallet {
  const eligibleCompletions = completions.filter((row) => row.week >= epochWeek);
  const eligibleRedemptions = redemptions.filter((row) => row.week >= epochWeek);
  const earned = weekPoints(personId, [...eligibleCompletions], [...routines]);
  const redeemedCounts: Record<string, number> = {};
  for (const redemption of eligibleRedemptions) {
    if (redemption.personId !== personId) continue;
    redeemedCounts[redemption.rewardId] = (redeemedCounts[redemption.rewardId] ?? 0) + 1;
  }
  const spent = Object.entries(redeemedCounts).reduce((sum, [rewardId, count]) => {
    const reward = rewards.find((candidate) => candidate.id === rewardId);
    return sum + (reward?.costPoints ?? 0) * count;
  }, 0);
  return { earned, spent, balance: earned - spent, redeemedCounts };
}
