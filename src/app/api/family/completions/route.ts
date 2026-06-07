import { NextResponse } from "next/server";
import {
  getCompletionsForWeek,
  upsertCompletion,
  removeCompletion,
} from "@/lib/family-db";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/access";

/**
 * GET /api/family/completions?week=2026-W23
 * Returns all completion records for the given ISO week.
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
  const completions = await getCompletionsForWeek(week);
  return NextResponse.json(completions);
}

/**
 * POST /api/family/completions
 * Body: { week, personId, routineId, day, status, note? }
 * Upserts a completion record.
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
  const { week, personId, routineId, day, status, note } = body;
  if (
    typeof week !== "string" || !/^\d{4}-W\d{2}$/.test(week) ||
    typeof personId !== "string" || !personId ||
    typeof routineId !== "string" || !routineId ||
    typeof day !== "number" || day < 0 || day > 6 ||
    status !== "done"
  ) {
    return NextResponse.json({ error: "Invalid fields" }, { status: 400 });
  }
  await upsertCompletion(week, {
    personId,
    routineId,
    day,
    status,
    ...(typeof note === "string" ? { note } : {}),
  });
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/family/completions
 * Body: { week, personId, routineId, day }
 * Removes a completion (parent reversal).
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
  const { week, personId, routineId, day } = body;
  if (
    typeof week !== "string" || !/^\d{4}-W\d{2}$/.test(week) ||
    typeof personId !== "string" || !personId ||
    typeof routineId !== "string" || !routineId ||
    typeof day !== "number" || day < 0 || day > 6
  ) {
    return NextResponse.json({ error: "Invalid fields" }, { status: 400 });
  }
  const removed = await removeCompletion(week, personId, routineId, day);
  return NextResponse.json({ ok: true, removed });
}
