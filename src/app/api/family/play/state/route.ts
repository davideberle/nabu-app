import { NextResponse } from "next/server";
import { NO_STORE, requireChildGames } from "@/lib/family-games-auth";
import { getPlayState } from "@/lib/family-play-db";
import { DAILY_CHESS_GAME_ID, PLAY_GRACE_SECONDS, PLAY_WARN_SECONDS } from "@/lib/family-play";

/**
 * GET /api/family/play/state — the child's authoritative Studio allowance,
 * balance, active lease and purchased chess allowance with its price (server
 * numbers; never a client clock or flag). Reading it is free: nothing is bought.
 */
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
      warnSeconds: PLAY_WARN_SECONDS,
      graceSeconds: PLAY_GRACE_SECONDS,
      activeLease: state.activeLease,
      chess: { ...state.chess, gameId: DAILY_CHESS_GAME_ID },
    },
    { headers: NO_STORE },
  );
}
