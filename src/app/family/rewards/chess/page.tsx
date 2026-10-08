import { redirect } from "next/navigation";
import { normalizeChildId } from "@/lib/family-child-shell";
import { DAILY_CHESS_GAME_ID } from "@/lib/family-play";

type Props = { searchParams?: Promise<{ child?: string }> };

// Legacy chess launch page (DA-04): every runnable chess path goes through the
// guarded play surface, which issues the daily chess lease. An absent or
// unrecognised child goes back to Family Home.
export default async function FamilyChessPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {};
  const child = normalizeChildId(params.child);
  if (!child) redirect("/family/home");
  redirect(`/family/games/play?game=${DAILY_CHESS_GAME_ID}&child=${encodeURIComponent(child)}`);
}
