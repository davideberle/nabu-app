import { createHash } from "node:crypto";
import type { Client, Row } from "@libsql/client";
import { FAMILY_WALLET_EPOCH_WEEK, snapshotCompletionAward } from "./family-wallet.ts";
import { extractBearerToken, getTrustedRuntimeToken, tokensMatch } from "./runtime-auth.ts";

/** Only this explicitly authorized capability, never a general parent session. */
export function canDirectlyApprove(header: string | null, env: Record<string, string | undefined> = process.env): boolean {
  return tokensMatch(extractBearerToken(header), getTrustedRuntimeToken(env));
}

export type Submission = {
  week: string; personId: string; routineId: string; day: number; status: string;
  note?: string; normalizedSummary?: string; challenge?: string;
  creditCount?: number; submittedAt?: string;
};

/** SHA-256 binds the exact words, occurrence, state, quantity, time and price. */
export function directApprovalHash(row: Submission, pointsPerUnit: number): string {
  return createHash("sha256").update(JSON.stringify([
    row.week, row.personId, row.routineId, row.day, row.status,
    row.note ?? "", row.normalizedSummary ?? "", row.challenge ?? "",
    row.creditCount ?? 1, row.submittedAt ?? null, pointsPerUnit,
  ])).digest("hex");
}

export type DirectApproval = {
  week: string; personId: "santiago" | "isabel"; routineId: string; day: number;
  submissionHash: string; approvedCreditCount: number; expectedPoints: number;
  approvalReference: string;
};

export function parseDirectApproval(value: unknown): DirectApproval | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const b = value as Record<string, unknown>;
  const keys = ["week", "personId", "routineId", "day", "submissionHash", "approvedCreditCount", "expectedPoints", "approvalReference"];
  if (Object.keys(b).length !== keys.length || keys.some(k => !(k in b))) return null;
  if (typeof b.week !== "string" || !/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(b.week) || b.week < FAMILY_WALLET_EPOCH_WEEK ||
      (b.personId !== "santiago" && b.personId !== "isabel") ||
      typeof b.routineId !== "string" || !/^[a-z0-9-]{1,80}$/.test(b.routineId) ||
      !Number.isInteger(b.day) || Number(b.day) < 0 || Number(b.day) > 6 ||
      typeof b.submissionHash !== "string" || !/^[a-f0-9]{64}$/.test(b.submissionHash) ||
      !Number.isInteger(b.approvedCreditCount) || Number(b.approvedCreditCount) < 1 || Number(b.approvedCreditCount) > 20 ||
      !Number.isInteger(b.expectedPoints) || Number(b.expectedPoints) < 1 || Number(b.expectedPoints) > 1000 ||
      typeof b.approvalReference !== "string" || b.approvalReference.trim().length < 8 || b.approvalReference.length > 240) return null;
  return b as DirectApproval;
}

export class DirectApprovalConflict extends Error {}

function submission(row: Row, input: DirectApproval): Submission {
  return { week: input.week, personId: input.personId, routineId: input.routineId, day: input.day,
    status: String(row.status), note: String(row.note ?? ""), normalizedSummary: String(row.normalized_summary ?? ""),
    challenge: String(row.challenge ?? ""), creditCount: Number(row.credit_count ?? 1),
    ...(row.created_at != null ? { submittedAt: String(row.created_at) } : {}),
  };
}

/** One write transaction; completion rows ARE the existing permanent-wallet credits. */
export async function approveDirectSubmission(
  client: Client, input: DirectApproval,
  routine: { id: string; points: number; assignedTo: string[] },
) {
  if (routine.id !== input.routineId || !routine.assignedTo.includes(input.personId)) throw new DirectApprovalConflict("Unknown activity for child");
  const requestHash = createHash("sha256").update(JSON.stringify([
    input.week, input.personId, input.routineId, input.day, input.submissionHash,
    input.approvedCreditCount, input.expectedPoints, input.approvalReference,
  ])).digest("hex");
  const provenance = `parent-direct:${requestHash}`;
  const tx = await client.transaction("write");
  try {
    const args = [input.week, input.personId, input.routineId, input.day];
    const current = await tx.execute({ sql: "SELECT * FROM family_completions WHERE week=? AND person_id=? AND routine_id=? AND day=?", args });
    const row = current.rows[0];
    if (!row) throw new DirectApprovalConflict("Submission not found");
    const balance = async () => {
      const r = await tx.execute({ sql: `SELECT
        COALESCE((SELECT SUM(awarded_points) FROM family_completions WHERE person_id=? AND week>=? AND status='done'),0)
        - COALESCE((SELECT SUM(charged_points) FROM family_reward_redemptions WHERE person_id=? AND week>=?),0) AS balance`,
        args: [input.personId, FAMILY_WALLET_EPOCH_WEEK, input.personId, FAMILY_WALLET_EPOCH_WEEK] });
      return Number(r.rows[0].balance);
    };
    const before = await balance();
    if (row.status === "done" && row.approval_source === provenance && Number(row.credit_count) === input.approvedCreditCount && Number(row.awarded_points) === input.expectedPoints) {
      await tx.commit();
      return { ok: true, updated: false, receiptId: requestHash, status: "done", creditCount: input.approvedCreditCount, awardedPoints: input.expectedPoints, walletBefore: before, walletAfter: before };
    }
    if ((row.status !== "pending_review" && row.status !== "on_hold") || row.awarded_points != null) throw new DirectApprovalConflict("Already reviewed; use parent controls for reversals");
    const stored = await tx.execute("SELECT data FROM family_board_config WHERE id='default'");
    const config = stored.rows[0] ? JSON.parse(String(stored.rows[0].data)) : {};
    const override = config.routineOverrides?.[routine.id];
    const points = override?.points ?? routine.points;
    if (override?.enabled === false || !Number.isInteger(points) || points < 1 ||
        directApprovalHash(submission(row, input), points) !== input.submissionHash ||
        snapshotCompletionAward(points, input.approvedCreditCount) !== input.expectedPoints) throw new DirectApprovalConflict("Submission or price changed");
    const reviewedAt = new Date().toISOString();
    const changed = await tx.execute({ sql: `UPDATE family_completions SET status='done', credit_count=?, awarded_points=?, reviewed_at=?, approval_source=?
      WHERE week=? AND person_id=? AND routine_id=? AND day=? AND status=? AND created_at IS ? AND awarded_points IS NULL`,
      args: [input.approvedCreditCount, input.expectedPoints, reviewedAt, provenance, ...args, String(row.status), row.created_at] });
    if (changed.rowsAffected !== 1) throw new DirectApprovalConflict("Submission changed");
    const after = await balance();
    if (after - before !== input.expectedPoints) throw new Error("Wallet verification failed");
    await tx.commit();
    return { ok: true, updated: true, receiptId: requestHash, status: "done", creditCount: input.approvedCreditCount, awardedPoints: input.expectedPoints, reviewedAt, walletBefore: before, walletAfter: after };
  } catch (error) { await tx.rollback(); throw error; }
  finally { tx.close(); }
}
