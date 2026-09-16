import { familyMembers } from "@/data/family-routines";
import {
  getCompletionsFromWeek,
  getRedemptionsFromWeek,
} from "@/lib/family-db";
import {
  computeFamilyWallet,
  FAMILY_WALLET_EPOCH_WEEK,
  type FamilyWalletProjection,
} from "@/lib/family-wallet";
import { isoWeekIdInZurich } from "@/lib/date";

export async function getFamilyWalletProjection(
  now = new Date(),
): Promise<FamilyWalletProjection> {
  const [completions, redemptions] = await Promise.all([
    getCompletionsFromWeek(FAMILY_WALLET_EPOCH_WEEK),
    getRedemptionsFromWeek(FAMILY_WALLET_EPOCH_WEEK),
  ]);
  const wallets = Object.fromEntries(
    familyMembers
      .filter((person) => person.role === "child")
      .map((person) => [
        person.id,
        computeFamilyWallet(person.id, completions, redemptions),
      ]),
  );
  return {
    epochWeek: FAMILY_WALLET_EPOCH_WEEK,
    currentWeek: isoWeekIdInZurich(now),
    wallets,
  };
}
