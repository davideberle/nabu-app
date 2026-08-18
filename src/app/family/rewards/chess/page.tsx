import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { normalizeChildId } from "@/lib/family-child-shell";
import { ChessCoachClient } from "./client";

export const metadata: Metadata = {
  title: "Chess Coach — Nabu",
  description: "The adaptive chess coach for the selected child",
};

type Props = { searchParams?: Promise<{ child?: string }> };

// Launch surface for the Adaptive Chess Coach pilot. The child identity is
// taken from the validated selected child (the Rewards game corner builds this
// href only from a `ChildGameIdentity`). An absent or unrecognised child sends
// the player back to Rewards rather than loading a game with no owner, so the
// per-child learning profile is always keyed to a real child.
export default async function FamilyChessPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {};
  const child = normalizeChildId(params.child);
  if (!child) redirect("/family/rewards");
  return <ChessCoachClient child={child} />;
}
