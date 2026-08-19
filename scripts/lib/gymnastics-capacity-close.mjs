/**
 * The two evidence-backed sessions that closed the kipping-capacity block but
 * were never persisted, plus the SQL contract used to write them.
 *
 * Data only — no database connection, no side effects — so the contract can be
 * asserted in `npm test` without touching Turso. The CLI that actually connects
 * is `scripts/backfill-kipping-capacity-close.mjs`.
 *
 * Provenance: both sessions are recorded in the Health Dashboard project log
 * (`projects/health-dashboard/KIPPING-CAPACITY-BLOCK.md` progression and
 * `PROJECT.md`, entries of 2026-08-15 and 2026-08-18). Week 3 session A — the
 * clean-forty gate — was never trained (the 18 August application superseded
 * it), so this backfill deliberately writes NO row for it: an absent row is
 * what keeps it out of Training history. Nothing here is inferred.
 */

/** The retired block these sessions belong to. Never the current program. */
export const ARCHIVED_PROGRAM_ID = "gym-kipping-capacity-3wk-v1";

/**
 * Sessions happened on these calendar dates in Europe/Zurich. 12:00Z is 14:00
 * local in CEST, so the stored instant lands on the correct day whether it is
 * read back in UTC or in Zurich. Only the date is evidence; the time of day is
 * a deliberate mid-afternoon placeholder and the UI shows day/month only.
 */
const AT = (date) => `${date}T12:00:00.000Z`;

export const BACKFILL_ROWS = [
  {
    week: 2,
    session: "B",
    date: "2026-08-15",
    note: "Grips-confirmed descending ladder, replacing the failed 12 August 1×8 + 4×4 exposure: with the fingerless gymnastics grips, 8/7/6/5/4/3/2 for 35 reps as the rests shortened 90/75/60/45/30/15 s. The opening eight left roughly two reps in reserve. Confirms a secure grip interface and at least eight clean fresh reps.",
  },
  {
    week: 3,
    session: "B",
    date: "2026-08-18",
    note: "Fifty-rep WOD application: 6×5 plus 5×4 in 8:15, during the FMD and a day after 36 strict chin-ups plus bench press. Tiring but not near failure. Superseded the clean-forty gate and closed the block; ordinary kipping moves to WOD maintenance.",
  },
].map((row) => ({ ...row, completedAt: AT(row.date) }));

/**
 * Idempotent upsert on the table's natural key. Re-running converges on exactly
 * the same rows: the historical `completed_at` is written verbatim rather than
 * stamped with `now`, and `note` is replaced with the same text, so a second
 * run is a no-op in effect.
 */
export const UPSERT_SQL = `INSERT INTO health_gymnastics_progress
    (program_id, week, session, completed, completed_at, note)
  VALUES (?, ?, ?, 1, ?, ?)
  ON CONFLICT (program_id, week, session) DO UPDATE SET
    completed = 1,
    completed_at = excluded.completed_at,
    note = excluded.note`;

/** Positional args for `UPSERT_SQL`, scoped to the archived program id. */
export function argsFor(row) {
  return [ARCHIVED_PROGRAM_ID, row.week, row.session, row.completedAt, row.note];
}

/**
 * Refuse to run against the live block. The backfill exists to complete
 * retired history; writing any of it under the current program id would mark
 * sessions done that David has not trained.
 */
export function assertNotCurrentProgram(currentProgramId) {
  if (currentProgramId === ARCHIVED_PROGRAM_ID) {
    throw new Error(
      `Refusing to backfill: ${ARCHIVED_PROGRAM_ID} is the current program, not a retired block.`,
    );
  }
}

/** True when a stored row already matches what the backfill would write. */
export function rowMatches(existing, row) {
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

/** Only the archived block's rows are ever read or written. */
export const SELECT_EXISTING_SQL = `SELECT week, session, completed, completed_at, note
    FROM health_gymnastics_progress
   WHERE program_id = ?`;

/**
 * Decide, per session, what a run would do — `insert`, `update`, or
 * `unchanged`. Pure: it takes the rows already stored for the archived block
 * and returns one entry per backfill row, in `BACKFILL_ROWS` order.
 */
export function planBackfill(existingRows) {
  const existing = new Map(
    (existingRows ?? []).map((r) => [`${r.week}-${r.session}`, r]),
  );
  return BACKFILL_ROWS.map((row) => {
    const prior = existing.get(`${row.week}-${row.session}`);
    return {
      row,
      action: !prior ? "insert" : rowMatches(prior, row) ? "unchanged" : "update",
    };
  });
}

/**
 * Read what is stored, plan, and (when `write`) apply. The client is passed in
 * so this is exercisable against an in-memory database in `npm test` and
 * against Turso from the CLI with no difference in the code path.
 *
 * `onStep` receives each planned step for display. The returned counts always
 * describe the plan, so a dry run reports exactly what `--write` would do.
 */
export async function applyBackfill(client, { write = false, onStep } = {}) {
  await client.execute(CREATE_TABLE_SQL);

  const existing = await client.execute({
    sql: SELECT_EXISTING_SQL,
    args: [ARCHIVED_PROGRAM_ID],
  });
  const steps = planBackfill(existing.rows);

  const counts = { insert: 0, update: 0, unchanged: 0 };
  for (const step of steps) {
    counts[step.action]++;
    onStep?.(step);
    if (write && step.action !== "unchanged") {
      await client.execute({ sql: UPSERT_SQL, args: argsFor(step.row) });
    }
  }
  return { steps, ...counts };
}
