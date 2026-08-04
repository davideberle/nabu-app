/**
 * The one completed session of the live kipping-capacity block, plus the SQL
 * contract used to record it.
 *
 * Data only — no database connection, no side effects — so the contract can be
 * asserted in `npm test` without touching Turso. The CLI that actually connects
 * is `scripts/record-gymnastics-session-one.mjs`.
 *
 * Provenance: David reported this session to Nabu on 2026-08-04 and it is
 * recorded in the health domain's `KIPPING-CAPACITY-BLOCK.md` progression and
 * `PROJECT.md`. The whole remaining block was adapted from this result, so the
 * row has to exist in production for the plan to make sense. Nothing here is
 * inferred.
 */

/** The live block. This module writes to this program id and no other. */
export const CURRENT_PROGRAM_ID = "gym-kipping-capacity-3wk-v1";

/**
 * Exactly one row: week 1 session A of the current block.
 *
 * `completedAt` is the instant David's report was recorded, written verbatim
 * rather than stamped with the time the script happens to run — the same rule
 * the retired-block backfill follows.
 */
export const SESSION_ROW = {
  week: 1,
  session: "A",
  completedAt: "2026-08-04T13:51:39.042Z",
  note: "6×4 with 60-second rests — 24 linked reps in about 5:30 total. Felt fine and comfortable throughout; roughly two more sets of four were still in reserve.",
};

/**
 * Idempotent upsert on the table's natural key, so re-running converges on the
 * same single row instead of duplicating it. Only this row's columns are
 * written; every other row in the table is untouched by the statement.
 */
export const UPSERT_SQL = `INSERT INTO health_gymnastics_progress
    (program_id, week, session, completed, completed_at, note)
  VALUES (?, ?, ?, 1, ?, ?)
  ON CONFLICT (program_id, week, session) DO UPDATE SET
    completed = 1,
    completed_at = excluded.completed_at,
    note = excluded.note`;

/** Positional args for `UPSERT_SQL`, scoped to the current program id. */
export function argsFor(row = SESSION_ROW) {
  return [CURRENT_PROGRAM_ID, row.week, row.session, row.completedAt, row.note];
}

/**
 * Refuse to run if the projection no longer describes the block this row
 * belongs to. A later block gets a fresh program id, and marking its week 1
 * session A done would claim a session David has not trained.
 */
export function assertCurrentProgram(projectionProgramId) {
  if (projectionProgramId !== CURRENT_PROGRAM_ID) {
    throw new Error(
      `Refusing to record: this row belongs to ${CURRENT_PROGRAM_ID}, but the projection now ships ${projectionProgramId}.`,
    );
  }
}

/** True when the stored row already says exactly what this script would write. */
export function rowMatches(existing, row = SESSION_ROW) {
  return (
    Boolean(existing) &&
    Number(existing.completed) === 1 &&
    existing.completed_at === row.completedAt &&
    existing.note === row.note
  );
}

/** SQL guaranteeing the table exists, identical to the app's own guard. */
export const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS health_gymnastics_progress (
    program_id   TEXT NOT NULL,
    week         INTEGER NOT NULL,
    session      TEXT NOT NULL,
    completed    INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    note         TEXT,
    PRIMARY KEY (program_id, week, session)
  )`;

/** Reads only the single row this script owns — not the block, not the table. */
export const SELECT_ROW_SQL = `SELECT week, session, completed, completed_at, note
    FROM health_gymnastics_progress
   WHERE program_id = ? AND week = ? AND session = ?`;

/** What a run would do to the one row: `insert`, `update`, or `unchanged`. Pure. */
export function planRecord(existing, row = SESSION_ROW) {
  return { row, action: !existing ? "insert" : rowMatches(existing, row) ? "unchanged" : "update" };
}

/**
 * Read the one row, plan, and (when `write`) apply. The client is passed in so
 * this runs against an in-memory database in `npm test` and against production
 * Turso from the CLI through the same code path.
 *
 * The returned action always describes the plan, so a dry run reports exactly
 * what `--write` would do.
 */
export async function applyRecord(client, { write = false, row = SESSION_ROW } = {}) {
  await client.execute(CREATE_TABLE_SQL);

  const existing = await client.execute({
    sql: SELECT_ROW_SQL,
    args: [CURRENT_PROGRAM_ID, row.week, row.session],
  });
  const step = planRecord(existing.rows[0], row);

  if (write && step.action !== "unchanged") {
    await client.execute({ sql: UPSERT_SQL, args: argsFor(row) });
  }
  return step;
}
