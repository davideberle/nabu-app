import { NextResponse } from "next/server";
import {
  getRedemptionsForWeek,
  createRedemption,
  removeRedemption,
} from "@/lib/family-db";

/**
 * GET /api/family/redemptions?week=2026-W23
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const week = searchParams.get("week");
  if (!week) {
    return NextResponse.json({ error: "week parameter required" }, { status: 400 });
  }
  const redemptions = await getRedemptionsForWeek(week);
  return NextResponse.json(redemptions);
}

/**
 * POST /api/family/redemptions
 * Body: { personId, rewardId, week }
 */
export async function POST(request: Request) {
  const body = await request.json();
  const { personId, rewardId, week } = body;
  if (!personId || !rewardId || !week) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  const redemption = await createRedemption(personId, rewardId, week);
  return NextResponse.json(redemption);
}

/**
 * DELETE /api/family/redemptions
 * Body: { id }
 */
export async function DELETE(request: Request) {
  const body = await request.json();
  const { id } = body;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const removed = await removeRedemption(id);
  return NextResponse.json({ ok: true, removed });
}
