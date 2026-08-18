import type { Metadata } from "next";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/access";
import { childShellWeekInfo } from "@/lib/family-child-shell";
import { FamilyPlanClient } from "./client";

export const metadata: Metadata = {
  title: "Plan — Nabu",
  description: "The selected child's weekly routines board",
};

type Props = { searchParams?: Promise<{ week?: string; child?: string }> };

// The selected child comes from the persistent `(shell)` layout provider
// (URL `?child=` validated by `normalizeChildId`, then the stored selection);
// this page only resolves the viewed week and the parent-controls capability.
export default async function FamilyPlanPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {};
  const session = await auth();
  return (
    <FamilyPlanClient
      weekInfo={childShellWeekInfo(params.week)}
      canManageParentControls={isAdminEmail(session?.user?.email)}
    />
  );
}
