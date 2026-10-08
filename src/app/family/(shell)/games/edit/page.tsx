import type { Metadata } from "next";
import { auth } from "@/auth";
import { FamilyGamesEditClient } from "./client";

export const metadata: Metadata = {
  title: "Make a game — Nabu",
  description: "Create and change your own games in Game Studio — making, changing and playing share one paid time allowance",
};

type Props = { searchParams?: Promise<{ game?: string; child?: string }> };

// Child-scoped Game Studio editing (G1; October 8, 2026): the child's OWN
// projects only, through the child adapter under the PAID studio lease. Never
// David's owner route. Delete/restore/download and global admin stay parent-only.
export default async function FamilyGamesEditPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {};
  await auth();
  return <FamilyGamesEditClient initialGameId={typeof params.game === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(params.game) ? params.game : null} />;
}
