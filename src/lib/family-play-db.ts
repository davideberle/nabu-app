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
import {
  FAMILY_WALLET_EPOCH_WEEK,
} from "./family-wallet.ts";
import { insertRedemptionIfAffordable } from "./family-wallet-ledger.ts";
import { isoWeekIdInZurich } from "./date.ts";
import {
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
      device_label     TEXT
    )
  `);
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
  | { ok: true; lease: PlayLease; replaced: string | null; remainingSeconds: number }
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
    if (decision.replaces) {
      await tx.execute({
        sql: "UPDATE family_play_leases SET state = 'ended', ended_at = ?, end_reason = ? WHERE id = ? AND state = 'active'",
        args: [now.toISOString(), input.takeover ? "replaced-by-takeover" : "replaced-stale", decision.replaces],
      });
    }
    const metered = price.kind === "metered";
    const lease: PlayLease = {
      id: input.leaseId,
      personId: input.personId,
      gameId: input.gameId,
      mode: input.mode,
      metered,
      budgetSeconds: metered ? remaining : 0,
      consumedSeconds: 0,
      state: "active",
      issuedAt: now.toISOString(),
      lastSettledAt: null,
      endedAt: null,
      endReason: null,
      deviceLabel: input.deviceLabel,
    };
    await tx.execute({
      sql: `INSERT INTO family_play_leases
              (id, person_id, game_id, mode, metered, budget_seconds, consumed_seconds, state, issued_at, device_label)
            VALUES (?, ?, ?, ?, ?, ?, 0, 'active', ?, ?)`,
      args: [lease.id, lease.personId, lease.gameId, lease.mode, metered ? 1 : 0, lease.budgetSeconds, lease.issuedAt, lease.deviceLabel],
    });
    await tx.commit();
    return { ok: true, lease, replaced: decision.replaces, remainingSeconds: remaining };
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
  | { ok: true; lease: PlayLease; remainingSeconds: number; delta: number }
  | { ok: false; reason: "not-found" | "ended" };

/**
 * Apply a measured-consumption report from the Game Studio meter. Monotonic
 * and bounded (`applySettlement`); the allowance moves by exactly the delta.
 * `end` closes the lease; an ended lease still accepts its final report once
 * so a late last tick is not lost, but never re-opens.
 */
export async function settlePlayLease(
  input: { leaseId: string; consumedSeconds: number; end: boolean; endReason?: string | null; now?: Date },
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
    if (lease.state === "ended" && lease.endedAt && Date.parse(at) - Date.parse(lease.endedAt) > 60_000) {
      await tx.rollback();
      return { ok: false, reason: "ended" };
    }
    const applied = applySettlement(lease, input.consumedSeconds);
    const ends = input.end || (lease.metered && applied.exhausted);
    await tx.execute({
      sql: `UPDATE family_play_leases SET consumed_seconds = ?, last_settled_at = ?,
              state = CASE WHEN ? THEN 'ended' ELSE state END,
              ended_at = CASE WHEN ? AND ended_at IS NULL THEN ? ELSE ended_at END,
              end_reason = CASE WHEN ? AND end_reason IS NULL THEN ? ELSE end_reason END
            WHERE id = ?`,
      args: [applied.consumedSeconds, at, ends ? 1 : 0, ends ? 1 : 0, at, ends ? 1 : 0, input.endReason ?? (applied.exhausted ? "exhausted" : "ended"), lease.id],
    });
    if (applied.delta > 0) {
      await tx.execute({
        sql: `INSERT INTO family_play_allowances (person_id, granted_seconds, consumed_seconds, updated_at)
              VALUES (?, 0, ?, ?)
              ON CONFLICT(person_id) DO UPDATE SET
                consumed_seconds = MIN(granted_seconds, consumed_seconds + excluded.consumed_seconds),
                updated_at = excluded.updated_at`,
        args: [lease.personId, applied.delta, at],
      });
    }
    const allowance = await readAllowance(tx, lease.personId);
    const updated = await readLease(tx, lease.id);
    await tx.commit();
    return { ok: true, lease: updated!, remainingSeconds: allowanceRemaining(allowance), delta: applied.delta };
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
  const at = (input.now ?? new Date()).toISOString();
  const result = await db.execute({
    sql: "UPDATE family_play_leases SET state = 'ended', ended_at = ?, end_reason = ? WHERE id = ? AND person_id = ? AND state = 'active'",
    args: [at, input.reason, input.leaseId, input.personId],
  });
  return result.rowsAffected > 0;
}

export async function getLeasesForPerson(personId: ChildId, client?: Client): Promise<PlayLease[]> {
  const db = client ?? (await getDb());
  await ensurePlayTables(db);
  const result = await db.execute({ sql: "SELECT * FROM family_play_leases WHERE person_id = ? ORDER BY issued_at ASC", args: [personId] });
  return result.rows.map((row) => rowToLease(row as Record<string, unknown>));
}
