import type { Metadata } from "next";
import { auth } from "@/auth";
import { FamilyRewardsClient } from "./client";

export const metadata: Metadata = {
  title: "Coins — Nabu",
  description: "The selected child's coin wallet: available, earned and spent",
};

// The one wallet/progress/spending surface (October 8, 2026). The legacy URL
// is kept for installed shortcuts; the selected child comes from the
// persistent `(shell)` layout provider. No week parameter is read any more.
export default async function FamilyRewardsPage() {
  await auth();
  return <FamilyRewardsClient />;
}
