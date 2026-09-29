// ---------------------------------------------------------------------------
// Tutor turn sequencing for the mission workspace (CONTRACT "Tutor contract").
//
// Pure orchestration with injected dependencies, so the ordering guarantees
// are unit-tested rather than assumed:
//
//   1. record `tutor_question` durably (applied or replayed — nothing else
//      counts) against the ORIGINAL task and this turn id, using the latest
//      revision and retrying once on a stale revision;
//   2. only then dispatch the bridge turn (unchanged bridge contract);
//   3. record `tutor_reply` with the same task/turn binding — again applied or
//      replayed only — BEFORE the reply is shown or spoken;
//   4. if step 3 cannot be confirmed, the reply is withheld: the child sees a
//      neutral notice, never an unclassified answer.
//
// A cancelled or lost turn leaves the question event in place, so the item's
// eligibility can never be restored by abandoning the turn.
// ---------------------------------------------------------------------------

import { buildTutorMessage, type LearningOp, type TutorContext } from "./family-learning-state.ts";

export type SupportOutcome = "applied" | "replayed" | "stale" | "refused" | "failed";

export type TutorRunnerDeps = {
  /** Record one support op with the given revision. Must map every outcome. */
  recordSupport: (op: LearningOp & { op: "support" }, expectedRevision: number) => Promise<{ outcome: SupportOutcome; revision: number }>;
  /** The latest revision the workspace has rendered. */
  currentRevision: () => number;
  /** Bridge turn on the existing contract; resolves to the reply text or null. */
  ask: (message: string, turnId: string) => Promise<{ ok: boolean; text: string }>;
  newTurnId: () => string;
  isAlive: () => boolean;
};

export type TutorTurnResult =
  | { status: "answered"; turnId: string; text: string }
  | { status: "question-not-recorded"; turnId: string }
  | { status: "reply-withheld"; turnId: string; reason: "not-recorded" | "gone" }
  | { status: "bridge-unavailable"; turnId: string };

const MAX_RECORD_ATTEMPTS = 3;

/**
 * Record a support op, refreshing the revision on `stale` (the server returned
 * the current view, which the caller applied). Success is `applied` or
 * `replayed` only — a stale or refused response is never treated as recorded.
 */
export async function recordSupportConfirmed(
  deps: Pick<TutorRunnerDeps, "recordSupport" | "currentRevision">,
  op: LearningOp & { op: "support" },
): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_RECORD_ATTEMPTS; attempt += 1) {
    const result = await deps.recordSupport(op, deps.currentRevision());
    if (result.outcome === "applied" || result.outcome === "replayed") return true;
    if (result.outcome !== "stale") return false;
  }
  return false;
}

export async function runTutorTurn(deps: TutorRunnerDeps, context: TutorContext | null, childText: string): Promise<TutorTurnResult> {
  const turnId = deps.newTurnId();
  const taskId = context?.taskId ?? null;
  const questionRecorded = await recordSupportConfirmed(deps, {
    op: "support",
    taskId,
    kind: "tutor_question",
    payload: { text: childText.slice(0, 500), taskId, turnId },
  });
  if (!questionRecorded) return { status: "question-not-recorded", turnId };
  if (!deps.isAlive()) return { status: "reply-withheld", turnId, reason: "gone" };

  const message = context ? buildTutorMessage(context, childText) : childText;
  const reply = await deps.ask(message, turnId);
  if (!deps.isAlive()) return { status: "reply-withheld", turnId, reason: "gone" };
  const replyText = reply.ok ? reply.text : "";

  const replyRecorded = await recordSupportConfirmed(deps, {
    op: "support",
    taskId,
    kind: "tutor_reply",
    payload: { text: replyText, ok: reply.ok, taskId, turnId },
  });
  if (!replyRecorded) return { status: "reply-withheld", turnId, reason: "not-recorded" };
  if (!reply.ok || !replyText) return { status: "bridge-unavailable", turnId };
  return { status: "answered", turnId, text: replyText };
}
