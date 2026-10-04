import { NextResponse } from "next/server";
import { NO_STORE, requireChildGames } from "@/lib/family-games-auth";
import { getPlayState } from "@/lib/family-play-db";
import { FREE_GAME_IDS, PLAY_GRACE_SECONDS, PLAY_WARN_SECONDS } from "@/lib/family-play";

/** GET /api/family/play/state — the child's authoritative allowance, balance and active lease (GP-05). */
export async function GET(request: Request) {
  const authz = await requireChildGames(request);
  if (!authz.ok) return authz.response;
  const state = await getPlayState(authz.child);
  return NextResponse.json(
    {
      child: authz.child,
      balance: state.balance,
      remainingSeconds: state.remainingSeconds,
      allowance: state.allowance,
      price: state.price,
      freeGameIds: FREE_GAME_IDS,
      warnSeconds: PLAY_WARN_SECONDS,
      graceSeconds: PLAY_GRACE_SECONDS,
      activeLease: state.activeLease,
    },
    { headers: NO_STORE },
  );
}
