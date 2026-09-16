import { familyMembers } from "@/data/family-routines";
import {
  getBoardConfig,
  getCompletionsFromWeek,
  getRedemptionsFromWeek,
  resolveRewards,
  resolveRoutines,
} from "@/lib/family-db";
import {
  computeFamilyWallet,
  FAMILY_WALLET_EPOCH_WEEK,
  type FamilyWalletProjection,
} from "@/lib/family-wallet";
import { currentIsoWeekId } from "@/lib/meals-core";

export async function getFamilyWalletProjection(
  now = new Date(),
): Promise<FamilyWalletProjection> {
  const [completions, redemptions, config] = await Promise.all([
    getCompletionsFromWeek(FAMILY_WALLET_EPOCH_WEEK),
    getRedemptionsFromWeek(FAMILY_WALLET_EPOCH_WEEK),
    getBoardConfig(),
  ]);
  const routines = resolveRoutines(config);
  const rewards = resolveRewards(config);
  const wallets = Object.fromEntries(
    familyMembers
      .filter((person) => person.role === "child")
      .map((person) => [
        person.id,
        computeFamilyWallet(person.id, completions, redemptions, routines, rewards),
      ]),
  );
  return {
    epochWeek: FAMILY_WALLET_EPOCH_WEEK,
    currentWeek: currentIsoWeekId(now),
    wallets,
  };
}
