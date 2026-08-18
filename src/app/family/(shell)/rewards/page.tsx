import type { Metadata } from "next";
import { childShellWeekInfo } from "@/lib/family-child-shell";
import { FamilyRewardsClient } from "./client";

export const metadata: Metadata = {
  title: "Rewards — Nabu",
  description: "The selected child's rewards and game corner",
};

type Props = { searchParams?: Promise<{ week?: string; child?: string }> };

// The selected child comes from the persistent `(shell)` layout provider
// (URL `?child=` validated by `normalizeChildId`, then the stored selection);
// this page only resolves the viewed week.
export default async function FamilyRewardsPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {};
  return <FamilyRewardsClient weekInfo={childShellWeekInfo(params.week)} />;
}
