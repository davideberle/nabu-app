import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/access";
import { CHILD_IDS } from "@/lib/family-assistant-turn";
import { getBoardConfig, getCompletionsFromWeek, getRedemptionsFromWeek } from "@/lib/family-db";
import { NO_STORE } from "@/lib/family-games-auth";
import { chessStatusFor, getPurchasesFromWeek } from "@/lib/family-play-db";
import { getDb } from "@/lib/db";
import { FAMILY_WALLET_EPOCH_WEEK } from "@/lib/family-wallet";
import { familyTodayInZurich } from "@/lib/date";

/**
 * GET /api/family/parent/records — the compact parent tools' one read
 * (October 8, 2026): every completion, redemption and play purchase since the
 * permanent-wallet epoch for both children, the board configuration and each
 * child's chess status for today. Owner session only (middleware refuses
 * tracker-only sessions on the whole `/api/family/parent/` prefix; the handler
 * refuses every non-owner session itself). Read-only, never cached.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminEmail(session.user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const now = new Date();
  const db = await getDb();
  const [completions, redemptions, purchases, config] = await Promise.all([
    getCompletionsFromWeek(FAMILY_WALLET_EPOCH_WEEK),
    getRedemptionsFromWeek(FAMILY_WALLET_EPOCH_WEEK),
    getPurchasesFromWeek(FAMILY_WALLET_EPOCH_WEEK),
    getBoardConfig(),
  ]);
  const chess = Object.fromEntries(await Promise.all(CHILD_IDS.map(async (child) => [child, await chessStatusFor(db, child, now)] as const)));
  return NextResponse.json(
    { generatedAt: now.toISOString(), today: familyTodayInZurich(now), epochWeek: FAMILY_WALLET_EPOCH_WEEK, completions, redemptions, purchases, config, chess },
    { headers: NO_STORE },
  );
}
