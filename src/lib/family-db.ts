import type { Client } from "@libsql/client";
import { getDb } from "./db";
import {
  routineDefinitions,
  rewardDefinitions,
  type CompletionRecord,
  type RoutineDefinition,
  type RewardDefinition,
} from "@/data/family-routines";

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
      created_at TEXT NOT NULL
    )
  `);
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
    sql: "SELECT person_id, routine_id, day, status, note, normalized_summary, challenge, created_at, reviewed_at FROM family_completions WHERE week = ?",
    args: [week],
  });
  return result.rows.map((row) =>
    rowToCompletionRecord(row as unknown as Record<string, unknown>),
  );
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
    sql: `SELECT person_id, routine_id, day, status, note, normalized_summary, challenge, created_at, reviewed_at
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
    `SELECT week, person_id, routine_id, day, status, note, normalized_summary, challenge, created_at, reviewed_at
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
  // A conflict is a resubmission: it carries a fresh submission time and is
  // no longer reviewed, so `created_at` is refreshed and `reviewed_at`
  // cleared. This is what makes a resubmitted transcript detectable — the
  // review-action `expectedSubmittedAt` guard and the queue's oldest-first
  // ordering both key on it.
  await client.execute({
    sql: `INSERT INTO family_completions (person_id, routine_id, week, day, status, note, normalized_summary, challenge, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (person_id, routine_id, week, day) DO UPDATE SET
            status = excluded.status, note = excluded.note,
            normalized_summary = excluded.normalized_summary,
            challenge = excluded.challenge,
            created_at = excluded.created_at,
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
    ],
  });
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
  const guardSql = guard
    ? " AND status = ? AND created_at IS ?"
    : "";
  const guardArgs = guard ? [guard.status, guard.submittedAt] : [];
  const result = await client.execute({
    sql: `UPDATE family_completions SET status = ?, reviewed_at = ?
          WHERE week = ? AND person_id = ? AND routine_id = ? AND day = ?${guardSql}`,
    args: [newStatus, now, week, personId, routineId, day, ...guardArgs],
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
};

export async function getRedemptionsForWeek(
  week: string,
): Promise<RewardRedemption[]> {
  const client = await getDb();
  await ensureFamilyTables(client);
  const result = await client.execute({
    sql: "SELECT id, person_id, reward_id, week, created_at FROM family_reward_redemptions WHERE week = ?",
    args: [week],
  });
  return result.rows.map((row) => ({
    id: row["id"] as string,
    personId: row["person_id"] as string,
    rewardId: row["reward_id"] as string,
    week: row["week"] as string,
    createdAt: row["created_at"] as string,
  }));
}

export async function createRedemption(
  personId: string,
  rewardId: string,
  week: string,
): Promise<RewardRedemption> {
  const client = await getDb();
  await ensureFamilyTables(client);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO family_reward_redemptions (id, person_id, reward_id, week, created_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [id, personId, rewardId, week, now],
  });
  return { id, personId, rewardId, week, createdAt: now };
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
