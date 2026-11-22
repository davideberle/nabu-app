import { NextResponse } from "next/server";
import { NO_STORE, requireChildGames } from "@/lib/family-games-auth";
import { CHESS_RECORD_MAX_BYTES, createChessRecordLimiter } from "@/lib/family-chess-records";
import { handleChessRecordPost } from "@/lib/family-chess-records-db";
import { getDb } from "@/lib/db";

/**
 * POST /api/family/play/chess-games — the chess coach reports one game (or, once per child, the browser profile it had
 * before records existed). Nov 22, 2026.
 *
 * Authorized like every other child play route: the household session plus a verified `family-games` bearer
 * (requireChildGames); the child is the bearer's, and a body for another child is refused (403). Rate-limited per child,
 * body at most 32 KB, strictly validated (closed shapes, bounds, enums; no free text). Idempotent per game id: a later
 * report (higher `seq`) replaces the row, a repeat changes nothing. Writes only the two chess record tables — never the
 * wallet, a lease or the level (the game keeps playing from its own browser profile).
 */
const admit = createChessRecordLimiter();

export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > CHESS_RECORD_MAX_BYTES) return NextResponse.json({ error: "Body too large" }, { status: 413, headers: NO_STORE });
  const out = await handleChessRecordPost({
    authorize: async () => {
      const authz = await requireChildGames(request);
      if (authz.ok) return { ok: true, child: authz.child };
      let error = "Unauthorized";
      try {
        error = ((await authz.response.clone().json()) as { error?: string }).error ?? error;
      } catch {
        /* keep the generic word */
      }
      return { ok: false, status: authz.response.status, error };
    },
    rawBody: () => request.text(),
    admit,
    db: () => getDb(),
  });
  return NextResponse.json(out.body, { status: out.status, headers: NO_STORE });
}
