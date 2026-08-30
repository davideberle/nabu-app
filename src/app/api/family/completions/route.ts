import { NextResponse } from "next/server";
import {
  getCompletionsForWeek,
  upsertCompletion,
  removeCompletion,
  updateCompletionStatus,
} from "@/lib/family-db";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/access";
import { notifyFamilyReviewSubmission } from "@/lib/family-telegram";

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
  const { week, personId, routineId, day, status, note, challenge } = body;
  const validStatuses = ["done", "pending_review"];
  if (
    typeof week !== "string" || !/^\d{4}-W\d{2}$/.test(week) ||
    typeof personId !== "string" || !personId ||
    typeof routineId !== "string" || !routineId ||
    typeof day !== "number" || day < 0 || day > 6 ||
    typeof status !== "string" || !validStatuses.includes(status)
  ) {
    return NextResponse.json({ error: "Invalid fields" }, { status: 400 });
  }
  const record = {
    personId,
    routineId,
    day,
    status: status as "done" | "pending_review",
    ...(typeof note === "string" ? { note } : {}),
    ...(typeof challenge === "string" ? { challenge } : {}),
  };
  await upsertCompletion(week, record);
  if (record.status === "pending_review") {
    try {
      await notifyFamilyReviewSubmission({ week, record });
    } catch (error) {
      console.error("[family] review notification failed", error);
    }
  }
  return NextResponse.json({ ok: true });
}

/**
 * PATCH /api/family/completions
 * Body: { week, personId, routineId, day, action: "approve" | "hold" }
 * Parent review action: approve sets status to done, hold sets to on_hold.
 */
export async function PATCH(request: Request) {
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
  const { week, personId, routineId, day, action } = body;
  if (
    typeof week !== "string" || !/^\d{4}-W\d{2}$/.test(week) ||
    typeof personId !== "string" || !personId ||
    typeof routineId !== "string" || !routineId ||
    typeof day !== "number" || day < 0 || day > 6 ||
    (action !== "approve" && action !== "hold")
  ) {
    return NextResponse.json({ error: "Invalid fields" }, { status: 400 });
  }
  const newStatus = action === "approve" ? "done" : "on_hold";
  const updated = await updateCompletionStatus(week, personId, routineId, day, newStatus);
  return NextResponse.json({ ok: true, updated });
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
