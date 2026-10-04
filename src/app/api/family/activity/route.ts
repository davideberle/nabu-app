import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { composeActivity } from "@/lib/family-activity";
import { isChildId } from "@/lib/family-assistant-turn";
import { getCompletionsFromWeek, getRedemptionsFromWeek } from "@/lib/family-db";
import { NO_STORE } from "@/lib/family-games-auth";
import { getPurchasesFromWeek } from "@/lib/family-play-db";
import { FAMILY_WALLET_EPOCH_WEEK } from "@/lib/family-wallet";
import { isoWeekIdInZurich } from "@/lib/date";

/**
 * GET /api/family/activity?person=santiago|isabel
 *
 * The composed chronology for one child (FH-08). Like every other family read,
 * the household session may view either child — the `person` parameter picks
 * a projection, it grants nothing. Items are source-linked and carry only
 * stored coin snapshots; the wallet balance itself comes from /api/family/wallet.
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const person = searchParams.get("person");
  if (!isChildId(person)) return NextResponse.json({ error: "person must be santiago or isabel" }, { status: 400 });
  const [completions, redemptions, purchases] = await Promise.all([
    getCompletionsFromWeek(FAMILY_WALLET_EPOCH_WEEK),
    getRedemptionsFromWeek(FAMILY_WALLET_EPOCH_WEEK),
    getPurchasesFromWeek(FAMILY_WALLET_EPOCH_WEEK),
  ]);
  const items = composeActivity({ personId: person, completions, redemptions, purchases });
  return NextResponse.json({ person, currentWeek: isoWeekIdInZurich(), epochWeek: FAMILY_WALLET_EPOCH_WEEK, items }, { headers: NO_STORE });
}
