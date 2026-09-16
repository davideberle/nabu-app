import type { Client } from "@libsql/client";
import { getDb } from "./db";
import {
  routineDefinitions,
  rewardDefinitions,
  type CompletionRecord,
  type RoutineDefinition,
  type RewardDefinition,
} from "@/data/family-routines";
import {
  correctedCompletionAward,
  FAMILY_WALLET_EPOCH_WEEK,
  snapshotCompletionAward,
} from "@/lib/family-wallet";

function routinePoints(config: FamilyBoardConfig, routineId: string): number {
  const definition = routineDefinitions.find((routine) => routine.id === routineId);
  if (!definition) return 0;
  return config.routineOverrides[routineId]?.points ?? definition.points;
}

function rewardCost(config: FamilyBoardConfig, rewardId: string): number {
  const definition = rewardDefinitions.find((reward) => reward.id === rewardId);
  if (!definition) return 0;
  return config.rewardOverrides[rewardId]?.costPoints ?? definition.costPoints;
}

async function storedBoardConfig(client: Client): Promise<FamilyBoardConfig> {
  const result = await client.execute(
    "SELECT data FROM family_board_config WHERE id = 'default'",
  );
  if (result.rows.length === 0) return EMPTY_CONFIG;
  try {
    return JSON.parse(result.rows[0]["data"] as string) as FamilyBoardConfig;
  } catch {
    return EMPTY_CONFIG;
  }
}

// ---------------------------------------------------------------------------
// Idempotent table guard (mirrors ensureTravelItemStatesTable in db.ts)
// ---------------------------------------------------------------------------

async function ensureFamilyTables(client: Client): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS family_completions (
      person_id   TEXT NOT NULL,
      routine_id  TEXT NOT NULL,
      week        TEXT NOT NULL,
      day         INTEGER NOT NULL,
      status      TEXT NOT NULL DEFAULT 'done',
      note        TEXT,
      challenge   TEXT,
      created_at  TEXT NOT NULL,
      reviewed_at TEXT,
      credit_count INTEGER NOT NULL DEFAULT 1,
      awarded_points INTEGER,
      PRIMARY KEY (person_id, routine_id, week, day)
    )
  `);
  // Migrate existing tables that lack the new columns
  try {
    await client.execute(`ALTER TABLE family_completions ADD COLUMN challenge TEXT`);
  } catch { /* column already exists */ }
  try {
    await client.execute(`ALTER TABLE family_completions ADD COLUMN reviewed_at TEXT`);
  } catch { /* column already exists */ }
  try {
    await client.execute(`ALTER TABLE family_completions ADD COLUMN normalized_summary TEXT`);
  } catch { /* column already exists */ }
  try {
    await client.execute(`ALTER TABLE family_completions ADD COLUMN credit_count INTEGER NOT NULL DEFAULT 1`);
  } catch { /* column already exists */ }
  try {
    await client.execute(`ALTER TABLE family_completions ADD COLUMN awarded_points INTEGER`);
  } catch { /* column already exists */ }
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_family_completions_week
      ON family_completions (week, person_id)
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS family_reward_redemptions (
      id         TEXT PRIMARY KEY,
      person_id  TEXT NOT NULL,
      reward_id  TEXT NOT NULL,
      week       TEXT NOT NULL,
      created_at TEXT NOT NULL,
      charged_points INTEGER
    )
  `);
  try {
    await client.execute(`ALTER TABLE family_reward_redemptions ADD COLUMN charged_points INTEGER`);
  } catch { /* column already exists */ }
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_family_redemptions_week
      ON family_reward_redemptions (week, person_id)
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS family_board_config (
      id         TEXT PRIMARY KEY DEFAULT 'default',
      data       TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // One-time, idempotent migration of the real wallet era. Amounts are
  // captured from the configuration that exists at migration time and are
  // never recalculated during reads, so later disabling/repricing cannot
  // rewrite history.
  const config = await storedBoardConfig(client);
  const credits = await client.execute({
    sql: `SELECT person_id, routine_id, week, day, credit_count
          FROM family_completions
          WHERE week >= ? AND status = 'done' AND awarded_points IS NULL`,
    args: [FAMILY_WALLET_EPOCH_WEEK],
  });
  for (const row of credits.rows) {
    const count = Number(row["credit_count"] ?? 1);
    await client.execute({
      sql: `UPDATE family_completions SET awarded_points = ?
            WHERE person_id = ? AND routine_id = ? AND week = ? AND day = ?
              AND status = 'done' AND awarded_points IS NULL`,
      args: [
        snapshotCompletionAward(routinePoints(config, row["routine_id"] as string), count),
        row["person_id"] as string,
        row["routine_id"] as string,
        row["week"] as string,
        row["day"] as number,
      ],
    });
  }
  const debits = await client.execute({
    sql: `SELECT id, reward_id FROM family_reward_redemptions
          WHERE week >= ? AND charged_points IS NULL`,
    args: [FAMILY_WALLET_EPOCH_WEEK],
  });
  for (const row of debits.rows) {
    await client.execute({
      sql: `UPDATE family_reward_redemptions SET charged_points = ?
            WHERE id = ? AND charged_points IS NULL`,
      args: [rewardCost(config, row["reward_id"] as string), row["id"] as string],
    });
  }
}

// ---------------------------------------------------------------------------
// Completions
// ---------------------------------------------------------------------------

export async function getCompletionsForWeek(
  week: string,
): Promise<CompletionRecord[]> {
  const client = await getDb();
  await ensureFamilyTables(client);
  const result = await client.execute({
    sql: "SELECT person_id, routine_id, day, status, note, normalized_summary, challenge, created_at, reviewed_at, credit_count, awarded_points FROM family_completions WHERE week = ?",
    args: [week],
  });
  return result.rows.map((row) =>
    rowToCompletionRecord(row as unknown as Record<string, unknown>),
  );
}

/** Wallet ledger credits from the permanent-wallet epoch onward. */
export async function getCompletionsFromWeek(
  fromWeek: string,
): Promise<(CompletionRecord & { week: string })[]> {
  const client = await getDb();
  await ensureFamilyTables(client);
  const result = await client.execute({
    sql: `SELECT week, person_id, routine_id, day, status, note, normalized_summary, challenge, created_at, reviewed_at, credit_count, awarded_points
          FROM family_completions WHERE week >= ? ORDER BY week ASC`,
    args: [fromWeek],
  });
  return result.rows.map((row) => ({
    ...rowToCompletionRecord(row as unknown as Record<string, unknown>),
    week: row["week"] as string,
  }));
}

/**
 * Non-earning review states are preserved exactly; anything unrecognized
 * collapses to `done` (the pre-review legacy value). `redo` is a preserved
 * state: collapsing it would silently turn a requested revision into a coin.
 */
function narrowCompletionStatus(status: string): CompletionRecord["status"] {
  return status === "pending_review" || status === "on_hold" || status === "redo"
    ? status
    : "done";
}

function rowToCompletionRecord(row: Record<string, unknown>): CompletionRecord {
  return {
    personId: row["person_id"] as string,
    routineId: row["routine_id"] as string,
    day: row["day"] as number,
    status: narrowCompletionStatus(row["status"] as string),
    creditCount: Number(row["credit_count"] ?? 1),
    ...(row["awarded_points"] !== null && row["awarded_points"] !== undefined
      ? { awardedPoints: Number(row["awarded_points"]) }
      : {}),
    ...(row["note"] ? { note: row["note"] as string } : {}),
    ...(row["normalized_summary"]
      ? { normalizedSummary: row["normalized_summary"] as string }
      : {}),
    ...(row["challenge"] ? { challenge: row["challenge"] as string } : {}),
    ...(row["created_at"] ? { submittedAt: row["created_at"] as string } : {}),
    ...(row["reviewed_at"] ? { reviewedAt: row["reviewed_at"] as string } : {}),
  };
}

/** Read one completion by its stable identity, or null when absent. */
export async function getCompletion(
  week: string,
  personId: string,
  routineId: string,
  day: number,
): Promise<CompletionRecord | null> {
  const client = await getDb();
  await ensureFamilyTables(client);
  const result = await client.execute({
    sql: `SELECT person_id, routine_id, day, status, note, normalized_summary, challenge, created_at, reviewed_at, credit_count, awarded_points
          FROM family_completions
          WHERE week = ? AND person_id = ? AND routine_id = ? AND day = ?`,
    args: [week, personId, routineId, day],
  });
  if (result.rows.length === 0) return null;
  return rowToCompletionRecord(result.rows[0] as unknown as Record<string, unknown>);
}

/**
 * All completions currently awaiting parent review, across every week —
 * the raw rows behind the canonical queue projection
 * (`lib/family-review-queue.ts`). Read-only. The ordering that matters is
 * the one `buildReviewQueueSnapshot` derives — consumers must project
 * through it rather than trusting this row order (SQL sorts a NULL
 * `created_at` first while the projection sorts a missing timestamp last).
 */
export async function getReviewQueueCompletions(): Promise<
  (CompletionRecord & { week: string })[]
> {
  const client = await getDb();
  await ensureFamilyTables(client);
  const result = await client.execute(
    `SELECT week, person_id, routine_id, day, status, note, normalized_summary, challenge, created_at, reviewed_at, credit_count, awarded_points
     FROM family_completions
     WHERE status IN ('pending_review', 'on_hold')
     ORDER BY created_at ASC, week ASC, person_id ASC, routine_id ASC, day ASC`,
  );
  return result.rows.map((row) => ({
    ...rowToCompletionRecord(row as unknown as Record<string, unknown>),
    week: row["week"] as string,
  }));
}

export async function upsertCompletion(
  week: string,
  record: CompletionRecord,
): Promise<void> {
  const client = await getDb();
  await ensureFamilyTables(client);
  const now = new Date().toISOString();
  const config = await storedBoardConfig(client);
  const awardedPoints = record.status === "done"
    ? snapshotCompletionAward(routinePoints(config, record.routineId), record.creditCount ?? 1)
    : null;
  // A conflict is a resubmission: it carries a fresh submission time and is
  // no longer reviewed, so `created_at` is refreshed and `reviewed_at`
  // cleared. This is what makes a resubmitted transcript detectable — the
  // review-action `expectedSubmittedAt` guard and the queue's oldest-first
  // ordering both key on it.
  await client.execute({
    sql: `INSERT INTO family_completions (person_id, routine_id, week, day, status, note, normalized_summary, challenge, created_at, credit_count, awarded_points)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (person_id, routine_id, week, day) DO UPDATE SET
            status = excluded.status, note = excluded.note,
            normalized_summary = excluded.normalized_summary,
            challenge = excluded.challenge,
            created_at = excluded.created_at,
            credit_count = excluded.credit_count,
            awarded_points = excluded.awarded_points,
            reviewed_at = NULL`,
    args: [
      record.personId,
      record.routineId,
      week,
      record.day,
      record.status,
      record.note ?? null,
      record.normalizedSummary ?? null,
      record.challenge ?? null,
      now,
      record.creditCount ?? 1,
      awardedPoints,
    ],
  });
}

/** Parent-only correction of the credited unit count on an approved row. */
export async function updateCompletionCreditCount(
  week: string,
  personId: string,
  routineId: string,
  day: number,
  creditCount: number,
): Promise<boolean> {
  const client = await getDb();
  await ensureFamilyTables(client);
  const config = await storedBoardConfig(client);
  const current = await client.execute({
    sql: `SELECT credit_count, awarded_points FROM family_completions
          WHERE week = ? AND person_id = ? AND routine_id = ? AND day = ? AND status = 'done'`,
    args: [week, personId, routineId, day],
  });
  if (current.rows.length === 0) return false;
  const previousCount = Number(current.rows[0]["credit_count"] ?? 1);
  const previousAward = current.rows[0]["awarded_points"];
  // A count correction changes the event deliberately but preserves the
  // per-unit price captured when it was approved. Today's config must not
  // reprice an older completion.
  const awardedPoints = correctedCompletionAward(
    previousAward !== null && previousAward !== undefined ? Number(previousAward) : null,
    previousCount,
    creditCount,
    routinePoints(config, routineId),
  );
  const result = await client.execute({
    sql: `UPDATE family_completions SET credit_count = ?, awarded_points = ?, reviewed_at = ?
          WHERE week = ? AND person_id = ? AND routine_id = ? AND day = ? AND status = 'done'`,
    args: [creditCount, awardedPoints, new Date().toISOString(), week, personId, routineId, day],
  });
  return result.rowsAffected > 0;
}

/**
 * Update a completion's status (for parent review actions). Status-only:
 * `note`, `normalized_summary` and `challenge` are untouched, which is what
 * lets `redo` keep the child's original transcript intact.
 *
 * `guard` makes the write a compare-and-swap: when provided, the UPDATE
 * applies only while the row still carries exactly that status and
 * submission time, so two parents acting on the same item from different
 * devices cannot silently overwrite each other — the loser's write affects
 * zero rows and the route reports the conflict.
 */
export async function updateCompletionStatus(
  week: string,
  personId: string,
  routineId: string,
  day: number,
  newStatus: "done" | "on_hold" | "redo",
  guard?: { status: string; submittedAt: string | null },
): Promise<boolean> {
  const client = await getDb();
  await ensureFamilyTables(client);
  const now = new Date().toISOString();
  const config = await storedBoardConfig(client);
  const current = await client.execute({
    sql: `SELECT credit_count FROM family_completions
          WHERE week = ? AND person_id = ? AND routine_id = ? AND day = ?`,
    args: [week, personId, routineId, day],
  });
  const creditCount = Number(current.rows[0]?.["credit_count"] ?? 1);
  const awardedPoints = snapshotCompletionAward(routinePoints(config, routineId), creditCount);
  const guardSql = guard
    ? " AND status = ? AND created_at IS ?"
    : "";
  const guardArgs = guard ? [guard.status, guard.submittedAt] : [];
  const result = await client.execute({
    sql: `UPDATE family_completions SET status = ?, reviewed_at = ?,
            awarded_points = CASE WHEN ? = 'done' THEN COALESCE(awarded_points, ?) ELSE NULL END
          WHERE week = ? AND person_id = ? AND routine_id = ? AND day = ?${guardSql}`,
    args: [newStatus, now, newStatus, awardedPoints, week, personId, routineId, day, ...guardArgs],
  });
  return result.rowsAffected > 0;
}

export async function removeCompletion(
  week: string,
  personId: string,
  routineId: string,
  day: number,
): Promise<boolean> {
  const client = await getDb();
  await ensureFamilyTables(client);
  const result = await client.execute({
    sql: "DELETE FROM family_completions WHERE week = ? AND person_id = ? AND routine_id = ? AND day = ?",
    args: [week, personId, routineId, day],
  });
  return result.rowsAffected > 0;
}

// ---------------------------------------------------------------------------
// Reward redemptions
// ---------------------------------------------------------------------------

export type RewardRedemption = {
  id: string;
  personId: string;
  rewardId: string;
  week: string;
  createdAt: string;
  chargedPoints: number;
};

export async function getRedemptionsForWeek(
  week: string,
): Promise<RewardRedemption[]> {
  const client = await getDb();
  await ensureFamilyTables(client);
  const result = await client.execute({
    sql: "SELECT id, person_id, reward_id, week, created_at, charged_points FROM family_reward_redemptions WHERE week = ?",
    args: [week],
  });
  return result.rows.map((row) => ({
    id: row["id"] as string,
    personId: row["person_id"] as string,
    rewardId: row["reward_id"] as string,
    week: row["week"] as string,
    createdAt: row["created_at"] as string,
    chargedPoints: Number(row["charged_points"] ?? 0),
  }));
}

/** Wallet ledger debits from the permanent-wallet epoch onward. */
export async function getRedemptionsFromWeek(
  fromWeek: string,
): Promise<RewardRedemption[]> {
  const client = await getDb();
  await ensureFamilyTables(client);
  const result = await client.execute({
    sql: `SELECT id, person_id, reward_id, week, created_at, charged_points
          FROM family_reward_redemptions WHERE week >= ? ORDER BY created_at ASC`,
    args: [fromWeek],
  });
  return result.rows.map((row) => ({
    id: row["id"] as string,
    personId: row["person_id"] as string,
    rewardId: row["reward_id"] as string,
    week: row["week"] as string,
    createdAt: row["created_at"] as string,
    chargedPoints: Number(row["charged_points"] ?? 0),
  }));
}

export async function createRedemption(
  personId: string,
  rewardId: string,
  week: string,
  chargedPoints: number,
): Promise<RewardRedemption> {
  const client = await getDb();
  await ensureFamilyTables(client);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO family_reward_redemptions (id, person_id, reward_id, week, created_at, charged_points)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, personId, rewardId, week, now, chargedPoints],
  });
  return { id, personId, rewardId, week, createdAt: now, chargedPoints };
}

export async function removeRedemption(id: string): Promise<boolean> {
  const client = await getDb();
  await ensureFamilyTables(client);
  const result = await client.execute({
    sql: "DELETE FROM family_reward_redemptions WHERE id = ?",
    args: [id],
  });
  return result.rowsAffected > 0;
}

// ---------------------------------------------------------------------------
// Board config — parent-editable overrides
// ---------------------------------------------------------------------------

export type RoutineOverride = {
  weeklyTarget?: number | null;
  points?: number;
  enabled?: boolean;
};

export type RewardOverride = {
  costPoints?: number;
  targetPoints?: number;
  enabled?: boolean;
};

export type FamilyBoardConfig = {
  routineOverrides: Record<string, RoutineOverride>;
  rewardOverrides: Record<string, RewardOverride>;
};

const EMPTY_CONFIG: FamilyBoardConfig = {
  routineOverrides: {},
  rewardOverrides: {},
};

export async function getBoardConfig(): Promise<FamilyBoardConfig> {
  const client = await getDb();
  await ensureFamilyTables(client);
  try {
    const result = await client.execute(
      "SELECT data FROM family_board_config WHERE id = 'default'",
    );
    if (result.rows.length === 0) return EMPTY_CONFIG;
    return JSON.parse(result.rows[0]["data"] as string) as FamilyBoardConfig;
  } catch {
    return EMPTY_CONFIG;
  }
}

export async function saveBoardConfig(
  config: FamilyBoardConfig,
): Promise<void> {
  const client = await getDb();
  await ensureFamilyTables(client);
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO family_board_config (id, data, updated_at)
          VALUES ('default', ?, ?)
          ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    args: [JSON.stringify(config), now],
  });
}

// ---------------------------------------------------------------------------
// Resolved definitions — merge seed data with config overrides
// ---------------------------------------------------------------------------

export function resolveRoutines(
  config: FamilyBoardConfig,
): RoutineDefinition[] {
  return routineDefinitions
    .map((r) => {
      const ov = config.routineOverrides[r.id];
      if (!ov) return r;
      if (ov.enabled === false) return null;
      return {
        ...r,
        ...("weeklyTarget" in ov ? { weeklyTarget: ov.weeklyTarget } : {}),
        ...("points" in ov ? { points: ov.points } : {}),
      };
    })
    .filter((r): r is RoutineDefinition => r !== null);
}

export function resolveRewards(
  config: FamilyBoardConfig,
): RewardDefinition[] {
  return rewardDefinitions
    .map((r) => {
      const ov = config.rewardOverrides[r.id];
      if (!ov) return r;
      if (ov.enabled === false) return null;
      return {
        ...r,
        ...(ov.costPoints !== undefined ? { costPoints: ov.costPoints } : {}),
        ...(ov.targetPoints !== undefined ? { targetPoints: ov.targetPoints } : {}),
      };
    })
    .filter((r): r is RewardDefinition => r !== null);
}
