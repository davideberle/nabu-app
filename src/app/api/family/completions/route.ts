import { NextResponse } from "next/server";
import {
  getCompletion,
  getCompletionsForWeek,
  upsertCompletion,
  removeCompletion,
  updateCompletionCreditCount,
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
import { guidedCategoryForRoutine, reviewGuidedSubmission } from "@/lib/family-guided-capture";
import { lockChessIfIneligible } from "@/lib/family-play-db";
import { isChildId } from "@/lib/family-assistant-turn";
import { occurrenceDateOf } from "@/lib/family-play";
import { todayInZurich } from "@/lib/date";
import { routineDefinitions } from "@/data/family-routines";

/**
 * After any mutation that can remove today's qualifying approval, the child's
 * active chess lease (if any) is ended at once — no coin, no refund, consumed
 * seconds stay consumed (DA-03). Never throws into the response path.
 */
async function reconcileChessAccess(personId: string): Promise<void> {
  if (!isChildId(personId)) return;
  try {
    await lockChessIfIneligible(personId);
  } catch (error) {
    console.error("[family] chess lock reconciliation failed", error);
  }
}

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
 * Body: { week, personId, routineId, day, status, note?, challenge?, creditCount?, parentAssisted? }
 * Upserts a completion record.
 *
 * October 8, 2026: a non-owner session may only submit `pending_review` — the
 * guided capture path. Writing `done` directly is an owner action: either a
 * plain parent-entered row, or (`parentAssisted: true`) a dated capture for a
 * day the child could not record (offline day, parent present): it enters
 * `pending_review` on the real occurrence identity through the normal path
 * and is approved in the same request with explicit `parent-assisted`
 * provenance, so the claim stays inspectable and nothing is credited twice.
 * The occurrence date may not lie in the future.
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
  const { week, personId, routineId, day, status, note, challenge, creditCount, parentAssisted } = body;
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
  const admin = isAdminEmail(session.user.email);
  if ((status === "done" || parentAssisted === true) && !admin) {
    return NextResponse.json({ error: "Forbidden", reason: "parent-only" }, { status: 403 });
  }
  const occurrence = occurrenceDateOf(week, day);
  if (!occurrence) {
    return NextResponse.json({ error: "Invalid occurrence date" }, { status: 400 });
  }
  if (occurrence > todayInZurich()) {
    return NextResponse.json({ error: "Occurrence date is in the future", today: todayInZurich() }, { status: 400 });
  }
  if (parentAssisted === true) {
    const routine = routineDefinitions.find((r) => r.id === routineId);
    if (!routine || !routine.assignedTo.includes(personId)) {
      return NextResponse.json({ error: "Unknown routine for this person" }, { status: 400 });
    }
    const existing = await getCompletion(week, personId, routineId, day);
    if (existing && (existing.status === "done" || existing.status === "on_hold")) {
      return NextResponse.json({ error: "Already reviewed", status: existing.status }, { status: 409 });
    }
    const units = Number.isInteger(creditCount) && (creditCount as number) >= 1 && (creditCount as number) <= 20 ? (creditCount as number) : 1;
    const text = typeof note === "string" ? note.trim().slice(0, 2000) : "";
    const record = {
      personId,
      routineId,
      day,
      status: "pending_review" as const,
      ...(text ? { note: text, normalizedSummary: normalizeGuidedSummary(text) } : {}),
      challenge: `Entered by a parent for ${occurrence}`,
      creditCount: units,
    };
    await upsertCompletion(week, record);
    const current = await getCompletion(week, personId, routineId, day);
    const approved = await updateCompletionStatus(
      week, personId, routineId, day, "done",
      { status: "pending_review", submittedAt: current?.submittedAt ?? null },
      "parent-assisted",
    );
    if (!approved) {
      return NextResponse.json({ error: "Stale review action", status: null }, { status: 409 });
    }
    return NextResponse.json({ ok: true, approved: true, occurrence, creditCount: units });
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
  const guidedCategory =
    typeof challenge === "string" && challenge.startsWith('Recorded with the guided "')
      ? guidedCategoryForRoutine(personId, routineId)
      : null;
  const guidedReview = guidedCategory && typeof note === "string"
    ? reviewGuidedSubmission(guidedCategory, note)
    : null;
  if (guidedReview && !guidedReview.ok) {
    return NextResponse.json({ error: guidedReview.issue }, { status: 422 });
  }
  const resolvedCreditCount = guidedReview?.ok ? guidedReview.creditCount : 1;
  if (creditCount !== undefined && creditCount !== resolvedCreditCount) {
    return NextResponse.json({ error: "Invalid credit count" }, { status: 400 });
  }
  const record = {
    personId,
    routineId,
    day,
    status: status as "done" | "pending_review",
    ...(typeof note === "string" ? { note } : {}),
    ...(normalizedSummary ? { normalizedSummary } : {}),
    ...(typeof challenge === "string" ? { challenge } : {}),
    creditCount: resolvedCreditCount,
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
  const { week, personId, routineId, day, action, expectedStatus, expectedSubmittedAt, creditCount } = body;
  if (
    typeof week !== "string" || !/^\d{4}-W\d{2}$/.test(week) ||
    typeof personId !== "string" || !personId ||
    typeof routineId !== "string" || !routineId ||
    typeof day !== "number" || day < 0 || day > 6 ||
    (action !== "set-credit-count" && !isReviewAction(action)) ||
    (expectedStatus !== undefined &&
      !COMPLETION_STATUSES.includes(expectedStatus as CompletionStatus)) ||
    (expectedSubmittedAt !== undefined && typeof expectedSubmittedAt !== "string")
  ) {
    return NextResponse.json({ error: "Invalid fields" }, { status: 400 });
  }
  if (action === "set-credit-count") {
    if (!Number.isInteger(creditCount) || (creditCount as number) < 1 || (creditCount as number) > 20) {
      return NextResponse.json({ error: "Invalid credit count" }, { status: 400 });
    }
    const updated = await updateCompletionCreditCount(
      week, personId, routineId, day, creditCount as number,
    );
    return updated
      ? NextResponse.json({ ok: true, updated, creditCount })
      : NextResponse.json({ error: "Approved completion not found" }, { status: 409 });
  }
  // A review action can only remove today's chess eligibility (hold/redo of
  // the last approval); an approval can only add it. Reconciled after the write.
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
    "parent-review",
  );
  if (!updated) {
    return NextResponse.json(
      { error: "Stale review action", status: null },
      { status: 409 },
    );
  }
  if (resolution.to !== "done") await reconcileChessAccess(personId);
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
  if (removed) await reconcileChessAccess(personId);
  return NextResponse.json({ ok: true, removed });
}
