import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { normalizeChildId } from "@/lib/family-child-shell";
import { isValidGameId } from "@/lib/family-play";
import { GuardedPlayClient } from "./client";

export const metadata: Metadata = {
  title: "Play — Nabu",
  description: "Guarded play for an approved game with the shared play-time clock",
};

type Props = { searchParams?: Promise<{ child?: string; game?: string }> };

// Guarded play surface (Game Studio DESIGN G1/G2). Full-screen, outside the
// shell chrome like the chess page. The child and game ids are validated
// strictly; the authority is the server-minted lease and Studio credential,
// never these parameters. The chess pilot keeps its own local launch page.
export default async function GuardedPlayPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {};
  const child = normalizeChildId(params.child);
  if (!child) redirect("/family/home");
  if (!isValidGameId(params.game)) redirect(`/family/games?child=${encodeURIComponent(child)}`);
  if (params.game === "adaptive-chess-coach") redirect(`/family/rewards/chess?child=${encodeURIComponent(child)}`);
  return <GuardedPlayClient child={child} gameId={params.game} />;
}
