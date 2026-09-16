import { NextResponse } from "next/server";
import {
  getRedemptionsForWeek,
  getBoardConfig,
  resolveRewards,
  createRedemption,
  removeRedemption,
} from "@/lib/family-db";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/access";
import { getFamilyWalletProjection } from "@/lib/family-wallet-server";
import { resolveRedemptionWeek } from "@/lib/family-wallet";

/**
 * GET /api/family/redemptions?week=2026-W23
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const week = searchParams.get("week");
  if (!week || !/^\d{4}-W\d{2}$/.test(week)) {
    return NextResponse.json({ error: "week parameter required (YYYY-Wnn)" }, { status: 400 });
  }
  const redemptions = await getRedemptionsForWeek(week);
  return NextResponse.json(redemptions);
}

/**
 * POST /api/family/redemptions
 * Body: { personId, rewardId }. The server always stamps the actual current
 * ISO week. A supplied week is accepted only when it matches, so an old UI
 * cannot silently backdate a debit while browsing history.
 * Server-side balance check prevents overspend.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { personId, rewardId, week } = body;
  if (
    typeof personId !== "string" || !personId ||
    typeof rewardId !== "string" || !rewardId
  ) {
    return NextResponse.json({ error: "Invalid fields" }, { status: 400 });
  }
  const redemptionWeek = resolveRedemptionWeek(week);
  if (!redemptionWeek.ok) {
    return NextResponse.json(
      { error: "Redemptions can only be recorded in the current week", currentWeek: redemptionWeek.currentWeek },
      { status: 409 },
    );
  }

  // Server-side permanent-wallet balance check.
  const [walletProjection, boardConfig] = await Promise.all([
    getFamilyWalletProjection(),
    getBoardConfig(),
  ]);
  const resolvedRew = resolveRewards(boardConfig);
  const reward = resolvedRew.find((r) => r.id === rewardId);
  if (!reward) {
    return NextResponse.json({ error: "Unknown reward" }, { status: 400 });
  }
  if (!reward.assignedTo.includes(personId)) {
    return NextResponse.json({ error: "Reward not assigned to this person" }, { status: 403 });
  }
  // NOTE: balance check + insert is not atomic — a concurrent request could
  // double-spend. Acceptable for a single-household iPad app; if needed later,
  // move to a Turso transaction with a balance sub-query.
  const balance = walletProjection.wallets[personId]?.balance;
  if (balance === undefined) {
    return NextResponse.json({ error: "Unknown person" }, { status: 400 });
  }
  if (balance < reward.costPoints) {
    return NextResponse.json({ error: "Insufficient balance" }, { status: 409 });
  }

  const redemption = await createRedemption(personId, rewardId, redemptionWeek.week);
  return NextResponse.json(redemption);
}

/**
 * DELETE /api/family/redemptions
 * Body: { id }
 */
export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminEmail(session.user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { id } = body;
  if (typeof id !== "string" || !id) {
    return NextResponse.json({ error: "id required (string)" }, { status: 400 });
  }
  const removed = await removeRedemption(id);
  return NextResponse.json({ ok: true, removed });
}
