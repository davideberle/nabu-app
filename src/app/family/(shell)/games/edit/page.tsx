import type { Metadata } from "next";
import { auth } from "@/auth";
import { FamilyGamesEditClient } from "./client";

export const metadata: Metadata = {
  title: "Make a game — Nabu",
  description: "Create and change your own games — editing is free; testing in Play uses play time",
};

type Props = { searchParams?: Promise<{ game?: string; child?: string }> };

// Child-scoped Game Studio editing (G1): the child's OWN projects only, through
// the child adapter and the child's library credential. Never David's owner
// route. Delete/restore/download and global admin stay parent-only.
export default async function FamilyGamesEditPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {};
  await auth();
  return <FamilyGamesEditClient initialGameId={typeof params.game === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(params.game) ? params.game : null} />;
}
