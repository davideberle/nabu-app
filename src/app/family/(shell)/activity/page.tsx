import type { Metadata } from "next";
import { auth } from "@/auth";
import { childShellWeekInfo } from "@/lib/family-child-shell";
import { FamilyActivityClient } from "./client";

export const metadata: Metadata = {
  title: "Activity — Nabu",
  description: "What happened when: recorded, reviewed and redeemed, with the coins each one changed",
};

type Props = { searchParams?: Promise<{ week?: string; child?: string }> };

// Activity (FH-08): the chronological overview that replaces Plan as the main
// child view; the routine grid stays reachable as "This week's plan".
export default async function FamilyActivityPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {};
  await auth();
  return <FamilyActivityClient weekInfo={childShellWeekInfo(params.week)} />;
}
