// ---------------------------------------------------------------------------
// Family Review Queue — the canonical parent-review contract
// (Family DESIGN.md §"Parent Review" + Phase R7; projects/family/REVIEW-QUEUE.md)
//
// The queue is not a second table of copied submissions: it is the ordered
// projection of completion records whose status is `pending_review` or
// `on_hold`, keyed by the stable completion identity (week, person, routine,
// day). This module owns the Family-owned semantics of that projection —
// deterministic ordering, deterministic numbering, the snapshot id a numbered
// reply must be resolved against, the fail-closed review-action resolution,
// and the non-inventing normalized summary. Companion App routes and clients
// consume it; they do not redefine it.
//
// Pure and client-safe: no React, no DOM, no server imports. Loaded directly
// by `node --test` (hence the explicit `.ts` extensions on relative imports).
// ---------------------------------------------------------------------------

import type { CompletionStatus } from "../data/family-routines.ts";

/** The two statuses that place a completion in the parent queue. */
export const REVIEW_QUEUE_STATUSES = ["pending_review", "on_hold"] as const;

export type ReviewQueueStatus = (typeof REVIEW_QUEUE_STATUSES)[number];

export function isReviewQueueStatus(value: unknown): value is ReviewQueueStatus {
  return value === "pending_review" || value === "on_hold";
}

/** A completion row as the queue projection needs it (week included). */
export type ReviewQueueRow = {
  week: string;
  personId: string;
  routineId: string;
  day: number;
  status: ReviewQueueStatus;
  note?: string;
  normalizedSummary?: string;
  challenge?: string;
  submittedAt?: string;
};

/**
 * The stable identity of one submission. Every review action names this
 * identity explicitly — never a bare queue number — which is what makes a
 * stale number unable to mutate a different submission.
 */
export function completionIdentityKey(
  week: string,
  personId: string,
  routineId: string,
  day: number,
): string {
  return `${week}:${personId}:${routineId}:${day}`;
}

export type ReviewQueueItem = ReviewQueueRow & {
  /** 1-based deterministic queue number, valid only within its snapshot. */
  number: number;
  /** Stable identity key (`week:personId:routineId:day`). */
  key: string;
};

export type ReviewQueueSnapshot = {
  /**
   * Deterministic id of this exact ordered queue (identities + statuses).
   * Two reads of an unchanged queue produce the same id; any submission,
   * approval, hold, redo, or resubmission changes it.
   */
  snapshotId: string;
  items: ReviewQueueItem[];
};

/**
 * Deterministic queue order: oldest submission first (`submittedAt`
 * ascending, missing timestamps last), then the identity fields as
 * tie-breakers so equal timestamps still order identically everywhere.
 */
export function compareReviewQueueRows(a: ReviewQueueRow, b: ReviewQueueRow): number {
  const at = a.submittedAt ?? "￿";
  const bt = b.submittedAt ?? "￿";
  if (at !== bt) return at < bt ? -1 : 1;
  if (a.week !== b.week) return a.week < b.week ? -1 : 1;
  if (a.personId !== b.personId) return a.personId < b.personId ? -1 : 1;
  if (a.routineId !== b.routineId) return a.routineId < b.routineId ? -1 : 1;
  return a.day - b.day;
}

/** FNV-1a 32-bit — a small, dependency-free, deterministic content hash. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Build the canonical numbered snapshot from raw queue rows. Rows whose
 * status is not a queue status are dropped rather than trusted — the queue
 * fails closed against a caller that forgot to filter.
 */
export function buildReviewQueueSnapshot(
  rows: readonly ReviewQueueRow[],
): ReviewQueueSnapshot {
  const items = rows
    .filter((row) => isReviewQueueStatus(row.status))
    .slice()
    .sort(compareReviewQueueRows)
    .map((row, index) => ({
      ...row,
      number: index + 1,
      key: completionIdentityKey(row.week, row.personId, row.routineId, row.day),
    }));
  // The digest covers identity, status AND transcript content: a child
  // resubmitting over the same pending identity changes the snapshot too, so
  // a numbered reply held against the old snapshot is refused rather than
  // approving words the parent never read.
  const digest = items
    .map((item) => `${item.key}=${item.status}=${fnv1a(item.note ?? "")}`)
    .join("|");
  return { snapshotId: `q-${fnv1a(digest)}-${items.length}`, items };
}

// ---------------------------------------------------------------------------
// Review actions — admin-only, idempotent, fail closed on staleness
// ---------------------------------------------------------------------------

export const REVIEW_ACTIONS = ["approve", "hold", "redo"] as const;

export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export function isReviewAction(value: unknown): value is ReviewAction {
  return value === "approve" || value === "hold" || value === "redo";
}

/** The status each action moves a submission to. Only `done` ever earns. */
export const REVIEW_ACTION_TARGET: Record<ReviewAction, CompletionStatus> = {
  approve: "done",
  hold: "on_hold",
  redo: "redo",
};

export type ReviewActionResolution =
  /** Perform the transition (exactly once — the row is not at the target). */
  | { kind: "apply"; to: CompletionStatus }
  /** Already at the target: idempotent success, no write, no second reward. */
  | { kind: "noop"; status: CompletionStatus }
  /**
   * Fail closed: the row is not in the state the caller saw. A numbered reply
   * resolved against a stale snapshot lands here instead of mutating a
   * submission the parent never looked at.
   */
  | { kind: "conflict"; status: CompletionStatus | null }
  /** No such completion exists (and the caller stated no expectation). */
  | { kind: "missing" };

/**
 * Resolve a review action against the row's current status.
 *
 * `expectedStatus` is the status the caller observed when it showed the queue
 * (its snapshot row). When provided, the action applies only if the row still
 * has that status — otherwise it conflicts. When the row already carries the
 * action's target status the action is an idempotent no-op regardless of
 * expectation, which is what makes repeat approval award nothing twice.
 */
export function resolveReviewAction(input: {
  current: { status: CompletionStatus } | null;
  action: ReviewAction;
  expectedStatus?: CompletionStatus;
}): ReviewActionResolution {
  const target = REVIEW_ACTION_TARGET[input.action];
  if (!input.current) {
    return input.expectedStatus ? { kind: "conflict", status: null } : { kind: "missing" };
  }
  const status = input.current.status;
  if (status === target) return { kind: "noop", status };
  if (input.expectedStatus && status !== input.expectedStatus) {
    return { kind: "conflict", status };
  }
  return { kind: "apply", to: target };
}

// ---------------------------------------------------------------------------
// Normalized summary — derived, never invented
// ---------------------------------------------------------------------------

/** Display bound for the normalized summary. */
export const MAX_SUMMARY_CHARS = 160;

/**
 * Leading filler tokens stripped from the start of a transcript only.
 * Deliberately restricted to unambiguous hesitation sounds: words like
 * "so", "well" or "also" open real English sentences and must survive.
 */
const LEADING_FILLERS = new Set([
  "um", "uh", "uhm", "ehm", "hm", "hmm", "äh", "ähm",
]);

/**
 * Derive the short display summary from the child's transcript
 * (Family DESIGN.md: the summary "may never replace the transcript, invent
 * duration or detail, or award credit").
 *
 * The derivation is strictly reductive: collapse whitespace, drop leading
 * filler words, capitalize the first letter, and truncate at a word boundary
 * with an ellipsis. Every word in the output appears verbatim in the
 * transcript (`summaryIsHonest` asserts exactly that).
 */
export function normalizeGuidedSummary(transcript: string | null | undefined): string {
  if (typeof transcript !== "string") return "";
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  while (words.length > 0) {
    const head = words[0].toLowerCase().replace(/[.,!?…]+$/u, "");
    if (LEADING_FILLERS.has(head)) {
      words.shift();
    } else {
      break;
    }
  }
  let text = words.join(" ");
  if (!text) return "";
  if (text.length > MAX_SUMMARY_CHARS) {
    const cut = text.slice(0, MAX_SUMMARY_CHARS);
    const lastSpace = cut.lastIndexOf(" ");
    // No word boundary inside the bound means the transcript opens with one
    // giant token; cutting it would invent a fragment, so there is no honest
    // summary — the UI falls back to the transcript itself.
    if (lastSpace <= 0) return "";
    text = `${cut.slice(0, lastSpace).replace(/[\s.,]+$/u, "")}…`;
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * True when every word of `summary` occurs in `transcript`
 * (case-insensitive; the ellipsis is the only permitted addition). This is
 * the checkable meaning of "non-invented".
 */
export function summaryIsHonest(summary: string, transcript: string): boolean {
  const source = new Set(
    transcript
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
      .filter(Boolean),
  );
  return summary
    .toLowerCase()
    .replace(/…/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean)
    .every((word) => source.has(word));
}
