// ---------------------------------------------------------------------------
// Family-owned persistence for paid active play (Family DESIGN "Game Studio
// entitlements"). Three tables beside the existing wallet ledger:
//
//   family_play_purchases   one row per committed block purchase, unique per
//                           (child, idempotency key); the debit itself is a
//                           normal `family_reward_redemptions` row.
//   family_play_allowances  one row per child: granted vs consumed seconds.
//   family_play_leases      the single consuming lease per child (partial
//                           unique index on active rows) and its settlements.
//
// Every write that must be all-or-nothing runs inside one write transaction
// (purchase = debit + purchase + grant; settlement = lease + allowance), so a
// crash leaves either everything or nothing (GP-02, GP-07).
//
// Server-only: imports the libSQL client. The pure policy lives in
// `family-play.ts`; the test suite drives these functions against a temp
// SQLite file through `ensurePlayTables(client)`.
// ---------------------------------------------------------------------------

import type { Client, Transaction } from "@libsql/client";
import { getDb } from "./db.ts";
import type { ChildId } from "./family-assistant-turn.ts";
import type { LeaseState } from "./family-play.ts";
import { AUTHORITY_WINDOW_SECONDS } from "./family-play.ts";
import {
  FAMILY_WALLET_EPOCH_WEEK,
} from "./family-wallet.ts";
import { insertRedemptionIfAffordable } from "./family-wallet-ledger.ts";
import { isoWeekIdInZurich } from "./date.ts";
import {
  LEASE_STALE_SECONDS,
  PLAY_BLOCK_COINS,
  PLAY_BLOCK_SECONDS,
  PLAY_PURCHASE_REWARD_ID,
  allowanceRemaining,
  applySettlement,
  decideLeaseIssue,
  playPriceFor,
  type PlayAllowance,
  type PlayLease,
  type PlayMode,
  type PlayPurchase,
  type PurchaseOutcome,
} from "./family-play.ts";

type Db = Client | Transaction;

export async function ensurePlayTables(client: Db): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS family_play_purchases (
      id              TEXT PRIMARY KEY,
      person_id       TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      redemption_id   TEXT NOT NULL,
      charged_points  INTEGER NOT NULL,
      granted_seconds INTEGER NOT NULL,
      state           TEXT NOT NULL DEFAULT 'committed',
      created_at      TEXT NOT NULL,
      refunded_at     TEXT,
      refund_reason   TEXT,
      UNIQUE (person_id, idempotency_key)
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS family_play_allowances (
      person_id        TEXT PRIMARY KEY,
      granted_seconds  INTEGER NOT NULL DEFAULT 0,
      consumed_seconds INTEGER NOT NULL DEFAULT 0,
      updated_at       TEXT NOT NULL
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS family_play_leases (
      id               TEXT PRIMARY KEY,
      person_id        TEXT NOT NULL,
      game_id          TEXT NOT NULL,
      mode             TEXT NOT NULL,
      metered          INTEGER NOT NULL,
      budget_seconds   INTEGER NOT NULL,
      consumed_seconds INTEGER NOT NULL DEFAULT 0,
      state            TEXT NOT NULL,
      issued_at        TEXT NOT NULL,
      last_settled_at  TEXT,
      ended_at         TEXT,
      end_reason       TEXT,
      device_label     TEXT,
      predecessor_id   TEXT,
      reserve_seconds  INTEGER NOT NULL DEFAULT 0
    )
  `);
  for (const column of ["predecessor_id TEXT", "reserve_seconds INTEGER NOT NULL DEFAULT 0", "cap_seconds INTEGER", "final_settled INTEGER NOT NULL DEFAULT 0", "activated_at TEXT", "measured_at TEXT", "authority_until TEXT", "fence_cap_seconds INTEGER"]) {
    try {
      await client.execute(`ALTER TABLE family_play_leases ADD COLUMN ${column}`);
    } catch {
      /* column already exists */
    }
  }
  await client.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_family_play_leases_active
      ON family_play_leases (person_id) WHERE state = 'active'
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_family_play_leases_person
      ON family_play_leases (person_id, issued_at)
  `);
}

async function beginWrite(client: Client): Promise<Transaction> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await client.transaction("write");
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "SQLITE_BUSY" || attempt >= 10) throw error;
      try {
        await client.reconnect();
      } catch {
        /* the next transaction() opens a fresh connection anyway */
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
}

function release(tx: Transaction): void {
  try {
    tx.close();
  } catch {
    /* already closed */
  }
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToAllowance(row: Record<string, unknown> | undefined, personId: ChildId): PlayAllowance {
  return {
    personId,
    grantedSeconds: Number(row?.["granted_seconds"] ?? 0),
    consumedSeconds: Number(row?.["consumed_seconds"] ?? 0),
  };
}

function rowToLease(row: Record<string, unknown>): PlayLease {
  return {
    id: String(row["id"]),
    personId: row["person_id"] as ChildId,
    gameId: String(row["game_id"]),
    mode: row["mode"] as PlayMode,
    metered: Number(row["metered"]) === 1,
    budgetSeconds: Number(row["budget_seconds"]),
    consumedSeconds: Number(row["consumed_seconds"] ?? 0),
    state: row["state"] === "active" ? "active" : "ended",
    issuedAt: String(row["issued_at"]),
    lastSettledAt: (row["last_settled_at"] as string | null) ?? null,
    endedAt: (row["ended_at"] as string | null) ?? null,
    endReason: (row["end_reason"] as string | null) ?? null,
    deviceLabel: (row["device_label"] as string | null) ?? null,
    predecessorId: (row["predecessor_id"] as string | null) ?? null,
    reserveSeconds: Number(row["reserve_seconds"] ?? 0),
    capSeconds: row["cap_seconds"] === null || row["cap_seconds"] === undefined ? Number(row["budget_seconds"]) : Number(row["cap_seconds"]),
    finalSettled: Number(row["final_settled"] ?? 0) === 1,
    activatedAt: (row["activated_at"] as string | null) ?? null,
    measuredAt: (row["measured_at"] as string | null) ?? null,
    authorityUntil: (row["authority_until"] as string | null) ?? null,
    fenceCapSeconds: row["fence_cap_seconds"] === null || row["fence_cap_seconds"] === undefined ? null : Number(row["fence_cap_seconds"]),
  };
}

function rowToPurchase(row: Record<string, unknown>): PlayPurchase {
  return {
    id: String(row["id"]),
    personId: row["person_id"] as ChildId,
    idempotencyKey: String(row["idempotency_key"]),
    redemptionId: String(row["redemption_id"]),
    chargedPoints: Number(row["charged_points"]),
    grantedSeconds: Number(row["granted_seconds"]),
    state: row["state"] === "refunded" ? "refunded" : "committed",
    createdAt: String(row["created_at"]),
    refundedAt: (row["refunded_at"] as string | null) ?? null,
    refundReason: (row["refund_reason"] as string | null) ?? null,
  };
}

/**
 * The most a lease can still report beyond what Family has already applied.
 * The meter re-checks Family's authority before it counts any interval and
 * suspends when it cannot, so after Family ends a lease nothing more is
 * measured: the bound is the wall time since the lease's last settlement (or
 * issue) up to its end — exactly, with no slack — capped by its budget. An
 * ended lease keeps that reserve until its meter reports the end (or Family
 * learns it was never activated, see `recordLeaseActivation`). No expiry:
 * allowance is conserved across every unresolved lease, however old.
 */
/**
 * Genuine measured time may exceed an ended lease's frozen cap by a small,
 * bounded amount: the meter confirms authority before every heartbeat and
 * counts only up to the confirming instant, so the overlap is at most the
 * Family round-trip plus clock skew between the Mac mini and Family. Such a
 * report is ACCEPTED (charged to the child) and the successor's live budget is
 * re-derived to shrink by the same amount — measured overlap is never refused
 * and handed back as usable time. Anything beyond the tolerance is refused and
 * surfaced as `refusedSeconds` (an inflated report).
 */
export const CAP_OVERLAP_TOLERANCE_SECONDS = 15;

/**
 * Late terminal correction window (round 14). A meter's terminal report is final, but an authenticated observation the
 * meter received only after it had to finalize (a frame's final beacon overtaken by the end, a sweep) is still genuine
 * evidence: for this long after the lease's end, a LATER terminal report may raise consumption — never above the
 * ceiling that applied at finalization (`fence_cap_seconds`: the frozen cap plus bounded overlap), never above the
 * allowance room, never reviving the lease or touching its successor's fence (the successor's live budget is simply
 * re-derived, as for any late report). After the window the lease is immutable and such a report is refused in full.
 */
export const LATE_TERMINAL_CORRECTION_SECONDS = 120;

/**
 * The measurement watermark: the meter's own time of the last reading that
 * advanced this lease (`measured_at`, carried in the signed report), falling
 * back to the issue time. Arrival time is never used — a delayed or duplicate
 * report would otherwise pretend the meter had measured up to its arrival.
 */
function measurementWatermark(lease: Pick<PlayLease, "measuredAt" | "issuedAt">): number {
  const measured = lease.measuredAt ? Date.parse(lease.measuredAt) : Number.NaN;
  const issued = Date.parse(lease.issuedAt);
  return Number.isFinite(measured) ? Math.max(measured, Number.isFinite(issued) ? issued : measured) : issued;
}

export function outstandingSeconds(lease: Pick<PlayLease, "metered" | "budgetSeconds" | "capSeconds" | "consumedSeconds" | "finalSettled" | "measuredAt" | "issuedAt" | "state" | "endedAt">, now: Date): number {
  if (!lease.metered || lease.finalSettled) return 0;
  if (lease.state === "ended") return Math.max(0, Math.min(lease.capSeconds, lease.budgetSeconds) - lease.consumedSeconds);
  const since = measurementWatermark(lease);
  const elapsed = Number.isFinite(since) ? Math.max(0, Math.ceil((now.getTime() - since) / 1000)) : LEASE_STALE_SECONDS;
  return Math.max(0, Math.min(lease.budgetSeconds - lease.consumedSeconds, elapsed));
}

/** Freeze the cap of a lease Family is ending now: consumed so far plus what its meter may lawfully still report since its last MEASUREMENT. */
export function endedCapSeconds(lease: Pick<PlayLease, "metered" | "budgetSeconds" | "consumedSeconds" | "measuredAt" | "issuedAt">, now: Date): number {
  if (!lease.metered) return 0;
  const since = measurementWatermark(lease);
  const elapsed = Number.isFinite(since) ? Math.max(0, Math.ceil((now.getTime() - since) / 1000)) : LEASE_STALE_SECONDS;
  return Math.max(lease.consumedSeconds, Math.min(lease.budgetSeconds, lease.consumedSeconds + elapsed));
}

async function unresolvedLeases(db: Db, personId: ChildId, exceptId: string | null): Promise<PlayLease[]> {
  const result = await db.execute({ sql: "SELECT * FROM family_play_leases WHERE person_id = ? AND metered = 1 AND final_settled = 0", args: [personId] });
  return result.rows.map((row) => rowToLease(row as Record<string, unknown>)).filter((lease) => lease.id !== exceptId);
}

/** Sum of what every other unresolved lease of the child may still report. */
async function reserveFor(db: Db, personId: ChildId, exceptId: string | null, now: Date): Promise<number> {
  const others = await unresolvedLeases(db, personId, exceptId);
  return others.reduce((sum, lease) => sum + outstandingSeconds(lease, now), 0);
}

/**
 * Re-derive the budget of every ACTIVE metered lease of the child from the
 * current allowance and the reserves of all other unresolved leases. Called
 * after every settlement and every lease end, so a late ancestor report or a
 * finished predecessor moves the live cap in the right direction at once.
 */
async function reconcileActiveBudgets(db: Db, personId: ChildId, now: Date): Promise<void> {
  const active = await db.execute({ sql: "SELECT * FROM family_play_leases WHERE person_id = ? AND state = 'active' AND metered = 1", args: [personId] });
  if (active.rows.length === 0) return;
  const allowance = await readAllowance(db, personId);
  for (const row of active.rows) {
    const lease = rowToLease(row as Record<string, unknown>);
    const reserve = await reserveFor(db, personId, lease.id, now);
    const budget = Math.max(lease.consumedSeconds, allowanceRemaining(allowance) + lease.consumedSeconds - reserve);
    await db.execute({ sql: "UPDATE family_play_leases SET budget_seconds = ?, cap_seconds = ?, reserve_seconds = ? WHERE id = ?", args: [budget, budget, reserve, lease.id] });
  }
}

/**
 * The instant a Family-side end of this lease takes effect: now, or the end of
 * the exclusive authority window its meter currently holds, whichever is
 * later (the cross-service fence — see AUTHORITY_WINDOW_SECONDS).
 */
export function fenceInstant(lease: Pick<PlayLease, "authorityUntil">, now: Date): Date {
  const until = lease.authorityUntil ? Date.parse(lease.authorityUntil) : Number.NaN;
  return Number.isFinite(until) && until > now.getTime() ? new Date(until) : now;
}

/**
 * The instant until which a successor of this child is `pending`: the latest
 * fence of any unresolved metered lease that Family ended but whose meter has
 * not yet reported its end. Null when nothing fences (or the fences passed).
 */
async function handoverUntil(db: Db, personId: ChildId, exceptId: string | null, now: Date): Promise<string | null> {
  const result = await db.execute({
    sql: "SELECT MAX(ended_at) AS until FROM family_play_leases WHERE person_id = ? AND id <> ? AND state = 'ended' AND metered = 1 AND final_settled = 0 AND ended_at > ?",
    args: [personId, exceptId ?? "", now.toISOString()],
  });
  const until = result.rows[0]?.["until"];
  return typeof until === "string" && until ? until : null;
}

/**
 * End a lease (Family-initiated: takeover, stale replacement, release, refund).
 * The end takes effect at the fence instant — now, or the end of the authority
 * window its meter holds — and the cap is frozen at what the meter may
 * lawfully still measure up to that instant, so a late report can never
 * exceed it and a successor is held `pending` until then (or until the
 * meter's terminal report arrives first).
 */
async function endLeaseRow(db: Db, lease: PlayLease, reason: string, now: Date): Promise<void> {
  const effective = fenceInstant(lease, now);
  const cap = endedCapSeconds(lease, effective);
  await db.execute({
    sql: "UPDATE family_play_leases SET state = 'ended', ended_at = ?, end_reason = ?, cap_seconds = ?, budget_seconds = MIN(budget_seconds, ?) WHERE id = ? AND state = 'active'",
    args: [effective.toISOString(), reason, cap, cap, lease.id],
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function readAllowance(db: Db, personId: ChildId): Promise<PlayAllowance> {
  const result = await db.execute({ sql: "SELECT granted_seconds, consumed_seconds FROM family_play_allowances WHERE person_id = ?", args: [personId] });
  return rowToAllowance(result.rows[0] as Record<string, unknown> | undefined, personId);
}

async function readWalletBalance(db: Db, personId: ChildId): Promise<number> {
  const result = await db.execute({
    sql: `SELECT
            COALESCE((SELECT SUM(awarded_points) FROM family_completions WHERE person_id = ? AND week >= ? AND status = 'done'), 0)
          - COALESCE((SELECT SUM(charged_points) FROM family_reward_redemptions WHERE person_id = ? AND week >= ?), 0) AS balance`,
    args: [personId, FAMILY_WALLET_EPOCH_WEEK, personId, FAMILY_WALLET_EPOCH_WEEK],
  });
  return Number(result.rows[0]?.["balance"] ?? 0);
}

async function readActiveLease(db: Db, personId: ChildId): Promise<PlayLease | null> {
  const result = await db.execute({ sql: "SELECT * FROM family_play_leases WHERE person_id = ? AND state = 'active' LIMIT 1", args: [personId] });
  return result.rows[0] ? rowToLease(result.rows[0] as Record<string, unknown>) : null;
}

async function readLease(db: Db, leaseId: string): Promise<PlayLease | null> {
  const result = await db.execute({ sql: "SELECT * FROM family_play_leases WHERE id = ?", args: [leaseId] });
  return result.rows[0] ? rowToLease(result.rows[0] as Record<string, unknown>) : null;
}

export type PlayState = {
  personId: ChildId;
  balance: number;
  allowance: PlayAllowance;
  remainingSeconds: number;
  price: { coins: number; seconds: number };
  activeLease: PlayLease | null;
};

export async function getPlayState(personId: ChildId, client?: Client): Promise<PlayState> {
  const db = client ?? (await getDb());
  await ensurePlayTables(db);
  const [allowance, balance, activeLease] = await Promise.all([
    readAllowance(db, personId),
    readWalletBalance(db, personId),
    readActiveLease(db, personId),
  ]);
  return {
    personId,
    balance,
    allowance,
    remainingSeconds: allowanceRemaining(allowance),
    price: { coins: PLAY_BLOCK_COINS, seconds: PLAY_BLOCK_SECONDS },
    activeLease,
  };
}

export async function getLease(leaseId: string, client?: Client): Promise<PlayLease | null> {
  const db = client ?? (await getDb());
  await ensurePlayTables(db);
  return readLease(db, leaseId);
}

export async function getPurchasesFromWeek(fromWeek: string, client?: Client): Promise<(PlayPurchase & { week: string })[]> {
  const db = client ?? (await getDb());
  await ensurePlayTables(db);
  const result = await db.execute({
    sql: `SELECT p.*, r.week AS week FROM family_play_purchases p
          LEFT JOIN family_reward_redemptions r ON r.id = p.redemption_id
          WHERE r.week >= ? OR r.week IS NULL ORDER BY p.created_at ASC`,
    args: [fromWeek],
  });
  return result.rows.map((row) => ({ ...rowToPurchase(row as Record<string, unknown>), week: String((row as Record<string, unknown>)["week"] ?? "") }));
}

export async function getPurchaseByRedemptionId(redemptionId: string, client?: Client): Promise<PlayPurchase | null> {
  const db = client ?? (await getDb());
  await ensurePlayTables(db);
  const result = await db.execute({ sql: "SELECT * FROM family_play_purchases WHERE redemption_id = ?", args: [redemptionId] });
  return result.rows[0] ? rowToPurchase(result.rows[0] as Record<string, unknown>) : null;
}

// ---------------------------------------------------------------------------
// Purchase — GP-02
// ---------------------------------------------------------------------------

export async function purchasePlayBlock(
  input: { personId: ChildId; idempotencyKey: string; purchaseId: string; redemptionId: string; now?: Date },
  client?: Client,
): Promise<PurchaseOutcome> {
  const db = client ?? (await getDb());
  await ensurePlayTables(db);
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const tx = await beginWrite(db);
  try {
    const existing = await tx.execute({
      sql: "SELECT * FROM family_play_purchases WHERE person_id = ? AND idempotency_key = ?",
      args: [input.personId, input.idempotencyKey],
    });
    if (existing.rows[0]) {
      const purchase = rowToPurchase(existing.rows[0] as Record<string, unknown>);
      const allowance = await readAllowance(tx, input.personId);
      const balance = await readWalletBalance(tx, input.personId);
      await tx.commit();
      return { ok: true, purchase, replayed: true, remainingSeconds: allowanceRemaining(allowance), balance };
    }
    const debited = await insertRedemptionIfAffordable(
      tx,
      {
        id: input.redemptionId,
        personId: input.personId,
        rewardId: PLAY_PURCHASE_REWARD_ID,
        week: isoWeekIdInZurich(now),
        createdAt,
        chargedPoints: PLAY_BLOCK_COINS,
      },
      FAMILY_WALLET_EPOCH_WEEK,
    );
    if (!debited) {
      const allowance = await readAllowance(tx, input.personId);
      const balance = await readWalletBalance(tx, input.personId);
      await tx.rollback();
      return { ok: false, reason: "insufficient-funds", balance, remainingSeconds: allowanceRemaining(allowance) };
    }
    await tx.execute({
      sql: `INSERT INTO family_play_purchases
              (id, person_id, idempotency_key, redemption_id, charged_points, granted_seconds, state, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'committed', ?)`,
      args: [input.purchaseId, input.personId, input.idempotencyKey, input.redemptionId, PLAY_BLOCK_COINS, PLAY_BLOCK_SECONDS, createdAt],
    });
    await tx.execute({
      sql: `INSERT INTO family_play_allowances (person_id, granted_seconds, consumed_seconds, updated_at)
            VALUES (?, ?, 0, ?)
            ON CONFLICT(person_id) DO UPDATE SET
              granted_seconds = granted_seconds + excluded.granted_seconds,
              updated_at = excluded.updated_at`,
      args: [input.personId, PLAY_BLOCK_SECONDS, createdAt],
    });
    const allowance = await readAllowance(tx, input.personId);
    const balance = await readWalletBalance(tx, input.personId);
    await tx.commit();
    return {
      ok: true,
      replayed: false,
      remainingSeconds: allowanceRemaining(allowance),
      balance,
      purchase: {
        id: input.purchaseId,
        personId: input.personId,
        idempotencyKey: input.idempotencyKey,
        redemptionId: input.redemptionId,
        chargedPoints: PLAY_BLOCK_COINS,
        grantedSeconds: PLAY_BLOCK_SECONDS,
        state: "committed",
        createdAt,
        refundedAt: null,
        refundReason: null,
      },
    };
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      /* already finished */
    }
    // A concurrent identical key that slipped past the SELECT hits the unique
    // constraint; the caller retries and receives the committed replay.
    if (/UNIQUE|constraint/i.test(String((error as Error).message))) return { ok: false, reason: "conflict" };
    throw error;
  } finally {
    release(tx);
  }
}

/**
 * Exactly-once compensation (GP-07): refund a committed purchase — the debit
 * row is deleted (the wallet's existing undo semantics) and the unconsumed
 * part of its grant is withdrawn. A second call is a no-op.
 */
export async function refundPlayPurchase(
  input: { purchaseId: string; reason: string; now?: Date },
  client?: Client,
): Promise<{ ok: true; purchase: PlayPurchase } | { ok: false; reason: "not-found" | "already-refunded" }> {
  const db = client ?? (await getDb());
  await ensurePlayTables(db);
  const at = (input.now ?? new Date()).toISOString();
  const tx = await beginWrite(db);
  try {
    const found = await tx.execute({ sql: "SELECT * FROM family_play_purchases WHERE id = ?", args: [input.purchaseId] });
    if (!found.rows[0]) {
      await tx.rollback();
      return { ok: false, reason: "not-found" };
    }
    const purchase = rowToPurchase(found.rows[0] as Record<string, unknown>);
    const flipped = await tx.execute({
      sql: "UPDATE family_play_purchases SET state = 'refunded', refunded_at = ?, refund_reason = ? WHERE id = ? AND state = 'committed'",
      args: [at, input.reason, input.purchaseId],
    });
    if (flipped.rowsAffected !== 1) {
      await tx.rollback();
      return { ok: false, reason: "already-refunded" };
    }
    await tx.execute({ sql: "DELETE FROM family_reward_redemptions WHERE id = ?", args: [purchase.redemptionId] });
    await tx.execute({
      sql: `UPDATE family_play_allowances
            SET granted_seconds = MAX(consumed_seconds, granted_seconds - ?), updated_at = ?
            WHERE person_id = ?`,
      args: [purchase.grantedSeconds, at, purchase.personId],
    });
    // The withdrawn grant must not stay usable: live budgets are re-derived at
    // once, and an active lease left with no room is ended and capped here, in
    // the same transaction — the meter learns on its next authority check.
    await reconcileActiveBudgets(tx, purchase.personId, input.now ?? new Date());
    const live = await tx.execute({ sql: "SELECT * FROM family_play_leases WHERE person_id = ? AND state = 'active' AND metered = 1", args: [purchase.personId] });
    for (const row of live.rows) {
      const lease = rowToLease(row as Record<string, unknown>);
      if (lease.budgetSeconds <= lease.consumedSeconds) {
        await tx.execute({
          sql: "UPDATE family_play_leases SET state = 'ended', ended_at = ?, end_reason = 'refunded', cap_seconds = consumed_seconds, budget_seconds = consumed_seconds WHERE id = ? AND state = 'active'",
          args: [fenceInstant(lease, input.now ?? new Date()).toISOString(), lease.id],
        });
      }
    }
    await reconcileActiveBudgets(tx, purchase.personId, input.now ?? new Date());
    await tx.commit();
    return { ok: true, purchase: { ...purchase, state: "refunded", refundedAt: at, refundReason: input.reason } };
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      /* already finished */
    }
    throw error;
  } finally {
    release(tx);
  }
}

// ---------------------------------------------------------------------------
// Leases — GP-03 / GP-08
// ---------------------------------------------------------------------------

export type IssueLeaseOutcome =
  | { ok: true; lease: PlayLease; replaced: string | null; remainingSeconds: number; handoverAt: string | null }
  | { ok: false; reason: "no-allowance" | "lease-held"; remainingSeconds: number; heldBy?: { leaseId: string; gameId: string; deviceLabel: string | null } };

export async function issuePlayLease(
  input: { personId: ChildId; gameId: string; mode: PlayMode; leaseId: string; takeover: boolean; deviceLabel: string | null; now?: Date },
  client?: Client,
): Promise<IssueLeaseOutcome> {
  const db = client ?? (await getDb());
  await ensurePlayTables(db);
  const now = input.now ?? new Date();
  const price = playPriceFor(input.gameId, input.mode);
  const tx = await beginWrite(db);
  try {
    const allowance = await readAllowance(tx, input.personId);
    const remaining = allowanceRemaining(allowance);
    const existing = await readActiveLease(tx, input.personId);
    const decision = decideLeaseIssue({ price, remainingSeconds: remaining, existing, takeover: input.takeover, now });
    if (!decision.ok) {
      await tx.rollback();
      return decision.reason === "lease-held"
        ? { ok: false, reason: "lease-held", remainingSeconds: remaining, heldBy: decision.heldBy }
        : { ok: false, reason: "no-allowance", remainingSeconds: remaining };
    }
    if (decision.replaces && existing) {
      await endLeaseRow(tx, existing, input.takeover ? "replaced-by-takeover" : "replaced-stale", now);
    }
    // Hold back everything every unresolved lease of this child (replaced,
    // released, stale — any that has not reported its end) may still report.
    const reserve = await reserveFor(tx, input.personId, null, now);
    const metered = price.kind === "metered";
    const lease: PlayLease = {
      id: input.leaseId,
      personId: input.personId,
      gameId: input.gameId,
      mode: input.mode,
      metered,
      budgetSeconds: metered ? Math.max(0, remaining - reserve) : 0,
      consumedSeconds: 0,
      state: "active",
      issuedAt: now.toISOString(),
      lastSettledAt: null,
      fenceCapSeconds: null,
      endedAt: null,
      endReason: null,
      deviceLabel: input.deviceLabel,
      predecessorId: decision.replaces,
      reserveSeconds: metered ? reserve : 0,
      capSeconds: metered ? Math.max(0, remaining - reserve) : 0,
      finalSettled: !metered,
      activatedAt: null,
      measuredAt: null,
      authorityUntil: null,
    };
    await tx.execute({
      sql: `INSERT INTO family_play_leases
              (id, person_id, game_id, mode, metered, budget_seconds, consumed_seconds, state, issued_at, device_label, predecessor_id, reserve_seconds, cap_seconds, final_settled)
            VALUES (?, ?, ?, ?, ?, ?, 0, 'active', ?, ?, ?, ?, ?, ?)`,
      args: [lease.id, lease.personId, lease.gameId, lease.mode, metered ? 1 : 0, lease.budgetSeconds, lease.issuedAt, lease.deviceLabel, lease.predecessorId, lease.reserveSeconds, lease.capSeconds, metered ? 0 : 1],
    });
    // A predecessor whose meter still holds an authority window fences this
    // lease: the meter is told `pending` until that window lapses or the
    // predecessor's terminal report arrives, whichever is first.
    const handoverAt = metered ? await handoverUntil(tx, input.personId, lease.id, now) : null;
    await tx.commit();
    return { ok: true, lease, replaced: decision.replaces, remainingSeconds: remaining, handoverAt };
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      /* already finished */
    }
    if (/UNIQUE|constraint/i.test(String((error as Error).message))) {
      // Two simultaneous issues for the same child: the loser reports the
      // lease as held so the client re-reads state instead of retrying blindly.
      return { ok: false, reason: "lease-held", remainingSeconds: 0 };
    }
    throw error;
  } finally {
    release(tx);
  }
}

export type SettleOutcome =
  | { ok: true; lease: PlayLease; remainingSeconds: number; delta: number; budgetSeconds: number; state: LeaseState; endReason: string | null; refusedSeconds: number }
  | { ok: false; reason: "not-found" };

/**
 * Apply a measured-consumption report from the Game Studio meter. Monotonic
 * and bounded by the lease budget (`applySettlement`); the allowance moves by
 * exactly the delta. `end` closes the lease. An ended lease keeps accepting
 * late reports (offline/restart recovery) — they can only move forward within
 * its own budget and never re-open it — and a successor lease's budget is
 * recomputed from the predecessor's actual, now-known consumption (GP-03/07).
 */
export async function settlePlayLease(
  input: { leaseId: string; consumedSeconds: number; end: boolean; endReason?: string | null; measuredAt?: number | string | null; now?: Date },
  client?: Client,
): Promise<SettleOutcome> {
  const db = client ?? (await getDb());
  await ensurePlayTables(db);
  const at = (input.now ?? new Date()).toISOString();
  const tx = await beginWrite(db);
  try {
    const lease = await readLease(tx, input.leaseId);
    if (!lease) {
      await tx.rollback();
      return { ok: false, reason: "not-found" };
    }
    // Bounded by the frozen cap of an ended lease, then by what the allowance
    // can still give without touching the live budgets of other active
    // leases: excess is refused (recorded), never absorbed by saturating totals.
    const requested = Number.isFinite(input.consumedSeconds) ? Math.floor(input.consumedSeconds) : 0;
    const requestedDelta = Math.max(0, requested - lease.consumedSeconds);
    // Frozen cap, plus — for an ended lease that has not yet reported its end —
    // only the overlap its meter GENUINELY measured after the end: the report's
    // own measurement time minus the end time, bounded by the tolerance. A
    // report without a measurement time, or measured before the end, gets no
    // overlap at all (the frozen cap never grows for it).
    const reportMeasuredMs = typeof input.measuredAt === "number" ? input.measuredAt : typeof input.measuredAt === "string" ? Date.parse(input.measuredAt) : Number.NaN;
    const endedMs = lease.endedAt ? Date.parse(lease.endedAt) : Number.NaN;
    const measuredOverlap = Number.isFinite(reportMeasuredMs) && Number.isFinite(endedMs) ? Math.max(0, Math.ceil((reportMeasuredMs - endedMs) / 1000)) : 0;
    const overlapAllowance = lease.state === "ended" && !lease.finalSettled ? Math.min(CAP_OVERLAP_TOLERANCE_SECONDS, measuredOverlap) : 0;
    const nowForWindow = Date.parse(at);
    const lateCorrection = lease.state === "ended" && lease.finalSettled && input.end === true && Number.isFinite(endedMs) && nowForWindow - endedMs <= LATE_TERMINAL_CORRECTION_SECONDS * 1000;
    const ceiling = lease.state === "ended" && !lease.finalSettled
      ? lease.capSeconds + overlapAllowance
      : lateCorrection
        ? Math.max(lease.consumedSeconds, lease.fenceCapSeconds ?? Math.min(lease.budgetSeconds, lease.capSeconds))
        : Math.min(lease.budgetSeconds, lease.capSeconds);
    const applied = applySettlement({ ...lease, budgetSeconds: ceiling }, input.consumedSeconds);
    let delta = applied.delta;
    let consumedNext = applied.consumedSeconds;
    if (delta > 0) {
      // Bounded by what the allowance can still give at all: the sum of per-lease
      // consumption then equals the allowance's consumption and never exceeds the
      // grant. Live budgets of other leases are re-derived right after (they
      // shrink by what this report took), so measured overlap is charged, not
      // refused and handed back.
      const allowanceNow = await readAllowance(tx, lease.personId);
      const room = Math.max(0, allowanceRemaining(allowanceNow));
      if (delta > room) {
        delta = room;
        consumedNext = lease.consumedSeconds + room;
      }
    }
    const ends = input.end || (lease.metered && consumedNext >= ceiling);
    const finalReport = input.end === true;
    // The watermark moves only with a reading that advances consumption, and only
    // to the meter's own measurement time (bounded by now) — never on a duplicate
    // or reordered report, never to the arrival time.
    const measuredMs = typeof input.measuredAt === "number" ? input.measuredAt : typeof input.measuredAt === "string" ? Date.parse(input.measuredAt) : Number.NaN;
    const nowMs = Date.parse(at);
    const watermarkCandidate = delta > 0 && Number.isFinite(measuredMs) ? Math.min(measuredMs, nowMs) : null;
    const nextMeasuredAt = watermarkCandidate !== null && watermarkCandidate > measurementWatermark(lease) ? new Date(watermarkCandidate).toISOString() : lease.measuredAt;
    await tx.execute({
      sql: `UPDATE family_play_leases SET consumed_seconds = ?, last_settled_at = ?, measured_at = ?,
              state = CASE WHEN ? THEN 'ended' ELSE state END,
              ended_at = CASE WHEN ? AND ended_at IS NULL THEN ? ELSE ended_at END,
              end_reason = CASE WHEN ? AND end_reason IS NULL THEN ? ELSE end_reason END,
              final_settled = CASE WHEN ? THEN 1 ELSE final_settled END,
              fence_cap_seconds = CASE WHEN ? THEN COALESCE(fence_cap_seconds, ?) ELSE fence_cap_seconds END,
              cap_seconds = CASE WHEN ? THEN ? ELSE cap_seconds END
            WHERE id = ?`,
      args: [consumedNext, at, nextMeasuredAt, ends ? 1 : 0, ends ? 1 : 0, at, ends ? 1 : 0, input.endReason ?? (applied.exhausted ? "exhausted" : "ended"), finalReport ? 1 : 0, finalReport ? 1 : 0, Math.floor(ceiling), finalReport ? 1 : 0, consumedNext, lease.id],
    });
    if (delta > 0) {
      await tx.execute({
        sql: `INSERT INTO family_play_allowances (person_id, granted_seconds, consumed_seconds, updated_at)
              VALUES (?, 0, ?, ?)
              ON CONFLICT(person_id) DO UPDATE SET
                consumed_seconds = MIN(granted_seconds, consumed_seconds + excluded.consumed_seconds),
                updated_at = excluded.updated_at`,
        args: [lease.personId, delta, at],
      });
    }
    // Any report changes what the other leases may still claim: re-derive every live budget.
    await reconcileActiveBudgets(tx, lease.personId, input.now ?? new Date());
    const allowance = await readAllowance(tx, lease.personId);
    const updated = await readLease(tx, lease.id);
    await tx.commit();
    // Every second the meter reported beyond what was accepted — cap truncation and allowance clamping alike — is surfaced.
    return { ok: true, lease: updated!, remainingSeconds: allowanceRemaining(allowance), delta, budgetSeconds: updated!.budgetSeconds, state: updated!.state, endReason: updated!.endReason, refusedSeconds: requestedDelta - delta };
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      /* already finished */
    }
    throw error;
  } finally {
    release(tx);
  }
}

/** The child ends their own lease (leaving the game, switching profile, going to Edit). */
export async function endPlayLease(
  input: { leaseId: string; personId: ChildId; reason: string; now?: Date },
  client?: Client,
): Promise<boolean> {
  const db = client ?? (await getDb());
  await ensurePlayTables(db);
  const now = input.now ?? new Date();
  const tx = await beginWrite(db);
  try {
    const lease = await readLease(tx, input.leaseId);
    if (!lease || lease.personId !== input.personId || lease.state !== "active") {
      await tx.rollback();
      return false;
    }
    await endLeaseRow(tx, lease, input.reason, now);
    await reconcileActiveBudgets(tx, lease.personId, now);
    await tx.commit();
    return true;
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      /* already finished */
    }
    throw error;
  } finally {
    release(tx);
  }
}

export type LeaseStatus = {
  leaseId: string;
  personId: ChildId;
  gameId: string;
  mode: PlayMode;
  metered: boolean;
  /** `pending`: issued, but a predecessor's authority window has not lapsed and its meter has not reported its end — the meter must not run it yet. */
  state: LeaseState | "pending";
  endReason: string | null;
  budgetSeconds: number;
  consumedSeconds: number;
  remainingSeconds: number;
  issuedAt: string;
  lastSettledAt: string | null;
  capSeconds: number;
  finalSettled: boolean;
  /** Family's recorded end instant (ISO), or null while active; the meter counts no authorized time past it. */
  endedAt: string | null;
  /** Family server time when this answer was produced (ISO). */
  asOf: string;
  /**
   * Exclusive authority window granted to the meter by THIS read (seconds,
   * relative to the read; null unless the lease is active and runnable): Family
   * will not activate a successor of the child before it lapses unless the
   * meter reports this lease's end first. The meter commits on this answer only
   * inside its own copy of the window, measured from the instant it sent the request.
   */
  authorizedForSeconds: number | null;
  /** End of the granted window on Family's clock (ISO), informational. */
  authorizedUntil: string | null;
  /** While `pending`: the instant the fence lapses (ISO); the meter retries by then or on the predecessor's end. */
  startsAt: string | null;
};

/**
 * The meter's signed status read is the moment a lease becomes "activated"
 * (the adapter never meters a lease it did not validate first). It also lets
 * Family resolve leases that can no longer produce any report: an ended lease
 * whose meter was never activated — the adapter would refuse it now — releases
 * its reserve. Runs in one transaction and re-derives live budgets.
 */
export async function recordLeaseActivation(leaseId: string, now = new Date(), client?: Client): Promise<void> {
  const db = client ?? (await getDb());
  await ensurePlayTables(db);
  const tx = await beginWrite(db);
  try {
    const lease = await readLease(tx, leaseId);
    if (!lease) {
      await tx.rollback();
      return;
    }
    const at = now.toISOString();
    // Ended and never activated ⇒ its meter can never report: resolve it (the asked lease included).
    await tx.execute({
      sql: `UPDATE family_play_leases SET final_settled = 1, cap_seconds = consumed_seconds
            WHERE person_id = ? AND state = 'ended' AND activated_at IS NULL AND final_settled = 0 AND metered = 1`,
      args: [lease.personId],
    });
    if (lease.state === "active") {
      const pendingUntil = await handoverUntil(tx, lease.personId, lease.id, now);
      if (pendingUntil === null) {
        // Grant (or extend) the exclusive authority window for this read. A
        // Family-side end of this lease now takes effect no earlier than the
        // window's end, and successors issued meanwhile are `pending` until then.
        const until = new Date(now.getTime() + AUTHORITY_WINDOW_SECONDS * 1000).toISOString();
        await tx.execute({
          sql: "UPDATE family_play_leases SET activated_at = COALESCE(activated_at, ?), authority_until = CASE WHEN authority_until IS NULL OR authority_until < ? THEN ? ELSE authority_until END WHERE id = ? AND state = 'active'",
          args: [at, until, until, lease.id],
        });
      }
    }
    await reconcileActiveBudgets(tx, lease.personId, now);
    await tx.commit();
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      /* already finished */
    }
    throw error;
  } finally {
    release(tx);
  }
}

/** Authoritative lease state for the Game Studio meter (status endpoint). */
export async function getLeaseStatus(leaseId: string, client?: Client, now: Date = new Date()): Promise<LeaseStatus | null> {
  const db = client ?? (await getDb());
  await ensurePlayTables(db);
  const lease = await readLease(db, leaseId);
  if (!lease) return null;
  const allowance = await readAllowance(db, lease.personId);
  const startsAt = lease.state === "active" ? await handoverUntil(db, lease.personId, lease.id, now) : null;
  const pending = startsAt !== null;
  const granted = lease.state === "active" && !pending && lease.authorityUntil !== null;
  return {
    leaseId: lease.id,
    personId: lease.personId,
    gameId: lease.gameId,
    mode: lease.mode,
    metered: lease.metered,
    state: pending ? "pending" : lease.state,
    endReason: lease.endReason,
    budgetSeconds: lease.budgetSeconds,
    consumedSeconds: lease.consumedSeconds,
    remainingSeconds: allowanceRemaining(allowance),
    issuedAt: lease.issuedAt,
    lastSettledAt: lease.lastSettledAt,
    capSeconds: lease.capSeconds,
    finalSettled: lease.finalSettled,
    endedAt: lease.endedAt,
    asOf: now.toISOString(),
    authorizedForSeconds: granted ? AUTHORITY_WINDOW_SECONDS : null,
    authorizedUntil: granted ? lease.authorityUntil : null,
    startsAt,
  };
}

export async function getLeasesForPerson(personId: ChildId, client?: Client): Promise<PlayLease[]> {
  const db = client ?? (await getDb());
  await ensurePlayTables(db);
  const result = await db.execute({ sql: "SELECT * FROM family_play_leases WHERE person_id = ? ORDER BY issued_at ASC", args: [personId] });
  return result.rows.map((row) => rowToLease(row as Record<string, unknown>));
}
