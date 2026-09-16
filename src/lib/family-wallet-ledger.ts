import type { Client, InValue } from "@libsql/client";

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
  client: Client,
  identity: CompletionIdentity,
  newStatus: "done" | "on_hold" | "redo",
  firstApprovalAward: number,
  reviewedAt: string,
  guard?: CompletionTransitionGuard,
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
            END
          WHERE week = ? AND person_id = ? AND routine_id = ? AND day = ?${guardSql}`,
    args: [
      newStatus,
      reviewedAt,
      newStatus,
      firstApprovalAward,
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
};

/**
 * Append a debit only if the permanent wallet can afford it. The balance
 * predicate and INSERT are one SQLite/libSQL statement, so concurrent callers
 * cannot both spend the same coins.
 */
export async function insertRedemptionIfAffordable(
  client: Client,
  redemption: RedemptionInsert,
  epochWeek: string,
): Promise<boolean> {
  const result = await client.execute({
    sql: `INSERT INTO family_reward_redemptions
            (id, person_id, reward_id, week, created_at, charged_points)
          SELECT ?, ?, ?, ?, ?, ?
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
            ), 0) >= ?`,
    args: [
      redemption.id,
      redemption.personId,
      redemption.rewardId,
      redemption.week,
      redemption.createdAt,
      redemption.chargedPoints,
      redemption.personId,
      epochWeek,
      redemption.personId,
      epochWeek,
      redemption.chargedPoints,
    ],
  });
  return result.rowsAffected === 1;
}
