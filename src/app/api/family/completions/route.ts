import { NextResponse } from "next/server";
import {
  getCompletionsForWeek,
  upsertCompletion,
  removeCompletion,
} from "@/lib/family-db";

/**
 * GET /api/family/completions?week=2026-W23
 * Returns all completion records for the given ISO week.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const week = searchParams.get("week");
  if (!week) {
    return NextResponse.json({ error: "week parameter required" }, { status: 400 });
  }
  const completions = await getCompletionsForWeek(week);
  return NextResponse.json(completions);
}

/**
 * POST /api/family/completions
 * Body: { week, personId, routineId, day, status, note? }
 * Upserts a completion record.
 */
export async function POST(request: Request) {
  const body = await request.json();
  const { week, personId, routineId, day, status, note } = body;
  if (!week || !personId || !routineId || day === undefined || !status) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  await upsertCompletion(week, { personId, routineId, day, status, note });
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/family/completions
 * Body: { week, personId, routineId, day }
 * Removes a completion (parent reversal).
 */
export async function DELETE(request: Request) {
  const body = await request.json();
  const { week, personId, routineId, day } = body;
  if (!week || !personId || !routineId || day === undefined) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  const removed = await removeCompletion(week, personId, routineId, day);
  return NextResponse.json({ ok: true, removed });
}
