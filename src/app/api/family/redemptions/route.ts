import { NextResponse } from "next/server";
import {
  getRedemptionsForWeek,
  getCompletionsForWeek,
  getBoardConfig,
  resolveRoutines,
  resolveRewards,
  createRedemption,
  removeRedemption,
} from "@/lib/family-db";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/access";

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
 * Body: { personId, rewardId, week }
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
    typeof rewardId !== "string" || !rewardId ||
    typeof week !== "string" || !/^\d{4}-W\d{2}$/.test(week)
  ) {
    return NextResponse.json({ error: "Invalid fields" }, { status: 400 });
  }

  // Server-side balance check
  const [completions, existingRedemptions, boardConfig] = await Promise.all([
    getCompletionsForWeek(week),
    getRedemptionsForWeek(week),
    getBoardConfig(),
  ]);
  const resolved = resolveRoutines(boardConfig);
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
  const earned = completions
    .filter((c) => c.personId === personId && c.status === "done")
    .reduce((sum, c) => {
      const routine = resolved.find((r) => r.id === c.routineId);
      return sum + (routine?.points ?? 0);
    }, 0);
  const spent = existingRedemptions
    .filter((r) => r.personId === personId)
    .reduce((sum, r) => {
      const rw = resolvedRew.find((x) => x.id === r.rewardId);
      return sum + (rw?.costPoints ?? 0);
    }, 0);
  const balance = earned - spent;
  if (balance < reward.costPoints) {
    return NextResponse.json({ error: "Insufficient balance" }, { status: 409 });
  }

  const redemption = await createRedemption(personId, rewardId, week);
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
