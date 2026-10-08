import type { Client, InValue } from "@libsql/client";

/** Any handle that can run one statement: a client or an open transaction. */
export type LedgerDb = Pick<Client, "execute">;

export type CompletionIdentity = {
  week: string;
  personId: string;
  routineId: string;
  day: number;
};

export type CompletionTransitionGuard = {
  status: string;
  submittedAt: string | null;
};

/**
 * Change only the review state of a completion. Once an award has been
 * captured it is immutable: non-earning states gate whether it contributes to
 * the wallet, but never erase the historical amount. A first approval fills a
 * still-null snapshot exactly once.
 */
export async function transitionCompletionStatus(
  client: LedgerDb,
  identity: CompletionIdentity,
  newStatus: "done" | "on_hold" | "redo",
  firstApprovalAward: number,
  reviewedAt: string,
  guard?: CompletionTransitionGuard,
  /** Explicit provenance of an approval (October 8, 2026); hold/redo clear it so a later approval must re-assert it. */
  approvalSource: string = "parent-review",
): Promise<boolean> {
  const guardSql = guard
    ? " AND status = ? AND created_at IS ?"
    : "";
  const guardArgs: InValue[] = guard ? [guard.status, guard.submittedAt] : [];
  const result = await client.execute({
    sql: `UPDATE family_completions SET status = ?, reviewed_at = ?,
            awarded_points = CASE
              WHEN ? = 'done' THEN COALESCE(awarded_points, ?)
              ELSE awarded_points
            END,
            approval_source = CASE WHEN ? = 'done' THEN ? ELSE NULL END
          WHERE week = ? AND person_id = ? AND routine_id = ? AND day = ?${guardSql}`,
    args: [
      newStatus,
      reviewedAt,
      newStatus,
      firstApprovalAward,
      newStatus,
      approvalSource,
      identity.week,
      identity.personId,
      identity.routineId,
      identity.day,
      ...guardArgs,
    ],
  });
  return result.rowsAffected > 0;
}

export type RedemptionInsert = {
  id: string;
  personId: string;
  rewardId: string;
  week: string;
  createdAt: string;
  chargedPoints: number;
  /** Optional client key: a duplicate tap/retry with the same key never debits twice. */
  idempotencyKey?: string | null;
};

/**
 * Append a debit only if the permanent wallet can afford it. The balance
 * predicate and INSERT are one SQLite/libSQL statement, so concurrent callers
 * cannot both spend the same coins.
 */
export async function insertRedemptionIfAffordable(
  client: LedgerDb,
  redemption: RedemptionInsert,
  epochWeek: string,
): Promise<boolean> {
  // The idempotency column is only named when a key is supplied, so the
  // statement stays valid on a ledger that predates the column.
  const withKey = typeof redemption.idempotencyKey === "string" && redemption.idempotencyKey.length > 0;
  const affordable = `
          WHERE
            COALESCE((
              SELECT SUM(awarded_points)
              FROM family_completions
              WHERE person_id = ? AND week >= ? AND status = 'done'
            ), 0)
            - COALESCE((
              SELECT SUM(charged_points)
              FROM family_reward_redemptions
              WHERE person_id = ? AND week >= ?
            ), 0) >= ?`;
  const result = await client.execute({
    sql: withKey
      ? `INSERT INTO family_reward_redemptions
            (id, person_id, reward_id, week, created_at, charged_points, idempotency_key)
          SELECT ?, ?, ?, ?, ?, ?, ?${affordable}`
      : `INSERT INTO family_reward_redemptions
            (id, person_id, reward_id, week, created_at, charged_points)
          SELECT ?, ?, ?, ?, ?, ?${affordable}`,
    args: [
      redemption.id,
      redemption.personId,
      redemption.rewardId,
      redemption.week,
      redemption.createdAt,
      redemption.chargedPoints,
      ...(withKey ? [redemption.idempotencyKey as string] : []),
      redemption.personId,
      epochWeek,
      redemption.personId,
      epochWeek,
      redemption.chargedPoints,
    ],
  });
  return result.rowsAffected === 1;
}
