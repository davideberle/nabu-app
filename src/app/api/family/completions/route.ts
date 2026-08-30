import { NextResponse } from "next/server";
import {
  getCompletion,
  getCompletionsForWeek,
  upsertCompletion,
  removeCompletion,
  updateCompletionStatus,
} from "@/lib/family-db";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/access";
import { notifyFamilyReviewSubmission } from "@/lib/family-telegram";
import {
  isReviewAction,
  normalizeGuidedSummary,
  resolveReviewAction,
} from "@/lib/family-review-queue";
import type { CompletionStatus } from "@/data/family-routines";

const COMPLETION_STATUSES: readonly CompletionStatus[] = [
  "done",
  "pending_review",
  "on_hold",
  "redo",
];

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
  // A submission may never silently overwrite a parent's decision: once a row
  // is `done` (earning) or `on_hold` (parent kept it for a conversation), a
  // re-POST on the same identity is refused. `pending_review` may be
  // resubmitted (the child correcting their own account — it refreshes the
  // submission time, so a stale approval fails closed), and `redo` is exactly
  // the state a resubmission is meant to leave.
  const existing = await getCompletion(week, personId, routineId, day);
  if (existing && (existing.status === "done" || existing.status === "on_hold")) {
    return NextResponse.json(
      { error: "Already reviewed", status: existing.status },
      { status: 409 },
    );
  }
  // The display summary is derived server-side from the submitted transcript
  // (Family DESIGN.md Phase R7): strictly reductive, never invented, and never
  // trusted from the client.
  const normalizedSummary =
    status === "pending_review" && typeof note === "string"
      ? normalizeGuidedSummary(note)
      : "";
  const record = {
    personId,
    routineId,
    day,
    status: status as "done" | "pending_review",
    ...(typeof note === "string" ? { note } : {}),
    ...(normalizedSummary ? { normalizedSummary } : {}),
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
 * Body: { week, personId, routineId, day, action: "approve" | "hold" | "redo",
 *         expectedStatus? }
 *
 * Parent review action against the canonical queue contract
 * (`lib/family-review-queue.ts`): approve sets status to done, hold to
 * on_hold, redo to the non-earning `redo` revision state that preserves the
 * child's original transcript. Actions are idempotent — a row already at the
 * action's target is a no-op success, so repeat approval can never award a
 * second coin. `expectedStatus` is the status the caller's queue snapshot
 * showed; when the row no longer carries it the action fails closed with 409
 * instead of mutating a submission the parent never looked at.
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
  const { week, personId, routineId, day, action, expectedStatus, expectedSubmittedAt } = body;
  if (
    typeof week !== "string" || !/^\d{4}-W\d{2}$/.test(week) ||
    typeof personId !== "string" || !personId ||
    typeof routineId !== "string" || !routineId ||
    typeof day !== "number" || day < 0 || day > 6 ||
    !isReviewAction(action) ||
    (expectedStatus !== undefined &&
      !COMPLETION_STATUSES.includes(expectedStatus as CompletionStatus)) ||
    (expectedSubmittedAt !== undefined && typeof expectedSubmittedAt !== "string")
  ) {
    return NextResponse.json({ error: "Invalid fields" }, { status: 400 });
  }
  const current = await getCompletion(week, personId, routineId, day);
  // `expectedSubmittedAt` is the submission time the caller's queue showed.
  // A resubmission refreshes it, so an approval of words the parent never
  // read fails closed here even though the status still matches.
  if (
    expectedSubmittedAt !== undefined &&
    (current?.submittedAt ?? null) !== expectedSubmittedAt
  ) {
    return NextResponse.json(
      { error: "Stale review action", status: current?.status ?? null },
      { status: 409 },
    );
  }
  const resolution = resolveReviewAction({
    current,
    action,
    ...(expectedStatus !== undefined
      ? { expectedStatus: expectedStatus as CompletionStatus }
      : {}),
  });
  if (resolution.kind === "conflict") {
    return NextResponse.json(
      { error: "Stale review action", status: resolution.status },
      { status: 409 },
    );
  }
  if (resolution.kind === "noop") {
    return NextResponse.json({ ok: true, updated: false, status: resolution.status });
  }
  if (resolution.kind === "missing") {
    return NextResponse.json({ ok: true, updated: false });
  }
  // Compare-and-swap on exactly the row that was read: if a concurrent
  // review or resubmission slipped between the read and this write, zero
  // rows update and the caller gets the same fail-closed 409.
  const updated = await updateCompletionStatus(
    week, personId, routineId, day,
    resolution.to as "done" | "on_hold" | "redo",
    { status: current!.status, submittedAt: current!.submittedAt ?? null },
  );
  if (!updated) {
    return NextResponse.json(
      { error: "Stale review action", status: null },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, updated, status: resolution.to });
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
