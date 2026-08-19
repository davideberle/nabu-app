import type { Client } from "@libsql/client";
import { getDb } from "./db";
import type { GymnasticsSessionKey } from "./gymnastics";

// ---------------------------------------------------------------------------
// Idempotent table guard (mirrors ensureFamilyTables in family-db.ts)
// ---------------------------------------------------------------------------

async function ensureHealthTables(client: Client): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS health_daily_logs (
      date                TEXT PRIMARY KEY,
      breakfast_override  TEXT,
      lunch_note          TEXT,
      dinner_source       TEXT,
      dinner_summary      TEXT,
      day_note            TEXT,
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS health_alcohol_events (
      id                    TEXT PRIMARY KEY,
      date                  TEXT NOT NULL,
      drink_type            TEXT NOT NULL,
      amount_label          TEXT,
      estimated_grams       REAL,
      context               TEXT,
      created_at            TEXT NOT NULL
    )
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_health_alcohol_date
      ON health_alcohol_events (date)
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS health_sleep_reports (
      date           TEXT PRIMARY KEY,
      sleep_quality  TEXT,
      hours          REAL,
      note           TEXT,
      created_at     TEXT NOT NULL
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS health_meditation_logs (
      date       TEXT PRIMARY KEY,
      minutes    INTEGER,
      completed  INTEGER NOT NULL DEFAULT 0,
      note       TEXT,
      created_at TEXT NOT NULL
    )
  `);
}

// ---------------------------------------------------------------------------
// Gymnastics program progress (Phase 3A)
//
// Tracks completion of each week/session of the gymnastics skill add-on so
// progress follows David across devices. Keyed by program_id + week + session.
// ---------------------------------------------------------------------------

async function ensureGymnasticsTable(client: Client): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS health_gymnastics_progress (
      program_id   TEXT NOT NULL,
      week         INTEGER NOT NULL,
      session      TEXT NOT NULL,
      completed    INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      note         TEXT,
      PRIMARY KEY (program_id, week, session)
    )
  `);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HealthDailyLog = {
  date: string;
  breakfastOverride?: string;
  lunchNote?: string;
  dinnerSource?: string;
  dinnerSummary?: string;
  dayNote?: string;
  createdAt: string;
  updatedAt: string;
};

export type HealthAlcoholEvent = {
  id: string;
  date: string;
  drinkType: string;
  amountLabel?: string;
  estimatedGrams?: number;
  context?: string;
  createdAt: string;
};

export type HealthSleepReport = {
  date: string;
  sleepQuality?: string;
  hours?: number;
  note?: string;
  createdAt: string;
};

export type HealthMeditationLog = {
  date: string;
  minutes?: number;
  completed: boolean;
  note?: string;
  createdAt: string;
};

// ---------------------------------------------------------------------------
// Daily logs
// ---------------------------------------------------------------------------

export async function getDailyLog(date: string): Promise<HealthDailyLog | null> {
  const client = await getDb();
  await ensureHealthTables(client);
  const result = await client.execute({
    sql: "SELECT * FROM health_daily_logs WHERE date = ?",
    args: [date],
  });
  if (result.rows.length === 0) return null;
  return rowToDailyLog(result.rows[0] as Record<string, unknown>);
}

export async function getDailyLogsForRange(
  from: string,
  to: string,
): Promise<HealthDailyLog[]> {
  const client = await getDb();
  await ensureHealthTables(client);
  const result = await client.execute({
    sql: "SELECT * FROM health_daily_logs WHERE date >= ? AND date <= ? ORDER BY date DESC",
    args: [from, to],
  });
  return result.rows.map((row) => rowToDailyLog(row as Record<string, unknown>));
}

export async function upsertDailyLog(log: {
  date: string;
  breakfastOverride?: string;
  lunchNote?: string;
  dinnerSource?: string;
  dinnerSummary?: string;
  dayNote?: string;
}): Promise<void> {
  const client = await getDb();
  await ensureHealthTables(client);
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO health_daily_logs (date, breakfast_override, lunch_note, dinner_source, dinner_summary, day_note, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (date) DO UPDATE SET
            breakfast_override = COALESCE(excluded.breakfast_override, health_daily_logs.breakfast_override),
            lunch_note = COALESCE(excluded.lunch_note, health_daily_logs.lunch_note),
            dinner_source = COALESCE(excluded.dinner_source, health_daily_logs.dinner_source),
            dinner_summary = COALESCE(excluded.dinner_summary, health_daily_logs.dinner_summary),
            day_note = COALESCE(excluded.day_note, health_daily_logs.day_note),
            updated_at = excluded.updated_at`,
    args: [
      log.date,
      log.breakfastOverride ?? null,
      log.lunchNote ?? null,
      log.dinnerSource ?? null,
      log.dinnerSummary ?? null,
      log.dayNote ?? null,
      now,
      now,
    ],
  });
}

function rowToDailyLog(row: Record<string, unknown>): HealthDailyLog {
  return {
    date: row["date"] as string,
    ...(row["breakfast_override"] ? { breakfastOverride: row["breakfast_override"] as string } : {}),
    ...(row["lunch_note"] ? { lunchNote: row["lunch_note"] as string } : {}),
    ...(row["dinner_source"] ? { dinnerSource: row["dinner_source"] as string } : {}),
    ...(row["dinner_summary"] ? { dinnerSummary: row["dinner_summary"] as string } : {}),
    ...(row["day_note"] ? { dayNote: row["day_note"] as string } : {}),
    createdAt: row["created_at"] as string,
    updatedAt: row["updated_at"] as string,
  };
}

// ---------------------------------------------------------------------------
// Alcohol events
// ---------------------------------------------------------------------------

export async function getAlcoholEventsForRange(
  from: string,
  to: string,
): Promise<HealthAlcoholEvent[]> {
  const client = await getDb();
  await ensureHealthTables(client);
  const result = await client.execute({
    sql: "SELECT * FROM health_alcohol_events WHERE date >= ? AND date <= ? ORDER BY date DESC, created_at DESC",
    args: [from, to],
  });
  return result.rows.map((row) => rowToAlcoholEvent(row as Record<string, unknown>));
}

export async function createAlcoholEvent(event: {
  date: string;
  drinkType: string;
  amountLabel?: string;
  estimatedGrams?: number;
  context?: string;
}): Promise<HealthAlcoholEvent> {
  const client = await getDb();
  await ensureHealthTables(client);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO health_alcohol_events (id, date, drink_type, amount_label, estimated_grams, context, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, event.date, event.drinkType, event.amountLabel ?? null, event.estimatedGrams ?? null, event.context ?? null, now],
  });
  return {
    id,
    date: event.date,
    drinkType: event.drinkType,
    ...(event.amountLabel ? { amountLabel: event.amountLabel } : {}),
    ...(event.estimatedGrams !== undefined ? { estimatedGrams: event.estimatedGrams } : {}),
    ...(event.context ? { context: event.context } : {}),
    createdAt: now,
  };
}

export async function deleteAlcoholEvent(id: string): Promise<boolean> {
  const client = await getDb();
  await ensureHealthTables(client);
  const result = await client.execute({
    sql: "DELETE FROM health_alcohol_events WHERE id = ?",
    args: [id],
  });
  return result.rowsAffected > 0;
}

function rowToAlcoholEvent(row: Record<string, unknown>): HealthAlcoholEvent {
  return {
    id: row["id"] as string,
    date: row["date"] as string,
    drinkType: row["drink_type"] as string,
    ...(row["amount_label"] ? { amountLabel: row["amount_label"] as string } : {}),
    ...(row["estimated_grams"] != null ? { estimatedGrams: row["estimated_grams"] as number } : {}),
    ...(row["context"] ? { context: row["context"] as string } : {}),
    createdAt: row["created_at"] as string,
  };
}

// ---------------------------------------------------------------------------
// Sleep reports
// ---------------------------------------------------------------------------

export async function getSleepReportsForRange(
  from: string,
  to: string,
): Promise<HealthSleepReport[]> {
  const client = await getDb();
  await ensureHealthTables(client);
  const result = await client.execute({
    sql: "SELECT * FROM health_sleep_reports WHERE date >= ? AND date <= ? ORDER BY date DESC",
    args: [from, to],
  });
  return result.rows.map((row) => rowToSleepReport(row as Record<string, unknown>));
}

export async function upsertSleepReport(report: {
  date: string;
  sleepQuality?: string;
  hours?: number;
  note?: string;
}): Promise<void> {
  const client = await getDb();
  await ensureHealthTables(client);
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO health_sleep_reports (date, sleep_quality, hours, note, created_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (date) DO UPDATE SET
            sleep_quality = excluded.sleep_quality,
            hours = excluded.hours,
            note = excluded.note`,
    args: [report.date, report.sleepQuality ?? null, report.hours ?? null, report.note ?? null, now],
  });
}

function rowToSleepReport(row: Record<string, unknown>): HealthSleepReport {
  return {
    date: row["date"] as string,
    ...(row["sleep_quality"] ? { sleepQuality: row["sleep_quality"] as string } : {}),
    ...(row["hours"] != null ? { hours: row["hours"] as number } : {}),
    ...(row["note"] ? { note: row["note"] as string } : {}),
    createdAt: row["created_at"] as string,
  };
}

// ---------------------------------------------------------------------------
// Meditation logs
// ---------------------------------------------------------------------------

export async function getMeditationLogsForRange(
  from: string,
  to: string,
): Promise<HealthMeditationLog[]> {
  const client = await getDb();
  await ensureHealthTables(client);
  const result = await client.execute({
    sql: "SELECT * FROM health_meditation_logs WHERE date >= ? AND date <= ? ORDER BY date DESC",
    args: [from, to],
  });
  return result.rows.map((row) => rowToMeditationLog(row as Record<string, unknown>));
}

export async function upsertMeditationLog(log: {
  date: string;
  minutes?: number;
  completed: boolean;
  note?: string;
}): Promise<void> {
  const client = await getDb();
  await ensureHealthTables(client);
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO health_meditation_logs (date, minutes, completed, note, created_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (date) DO UPDATE SET
            minutes = excluded.minutes,
            completed = excluded.completed,
            note = excluded.note`,
    args: [log.date, log.minutes ?? null, log.completed ? 1 : 0, log.note ?? null, now],
  });
}

function rowToMeditationLog(row: Record<string, unknown>): HealthMeditationLog {
  return {
    date: row["date"] as string,
    ...(row["minutes"] != null ? { minutes: row["minutes"] as number } : {}),
    completed: (row["completed"] as number) === 1,
    ...(row["note"] ? { note: row["note"] as string } : {}),
    createdAt: row["created_at"] as string,
  };
}

// ---------------------------------------------------------------------------
// Gymnastics progress
// ---------------------------------------------------------------------------

export type GymnasticsProgressRecord = {
  week: number;
  session: GymnasticsSessionKey;
  completed: boolean;
  completedAt: string | null;
  note?: string;
};

/** All stored progress rows for a program. Absent week/session pairs are simply not returned. */
export async function getGymnasticsProgress(
  programId: string,
): Promise<GymnasticsProgressRecord[]> {
  const client = await getDb();
  await ensureGymnasticsTable(client);
  const result = await client.execute({
    sql: "SELECT week, session, completed, completed_at, note FROM health_gymnastics_progress WHERE program_id = ? ORDER BY week ASC, session ASC",
    args: [programId],
  });
  return result.rows.map((row) => rowToGymnasticsProgress(row as Record<string, unknown>));
}

export type GymnasticsHistoryRecord = GymnasticsProgressRecord & { programId: string };

/**
 * Completed rows for a set of retired programs, oldest first.
 *
 * Read-only by construction: there is no writer for another program id anywhere
 * in the app, and the `completed = 1` filter means an untouched leftover row
 * from a retired block never reads back as training that happened. An empty id
 * list short-circuits rather than building a `WHERE program_id IN ()`.
 */
export async function getCompletedGymnasticsHistory(
  programIds: string[],
): Promise<GymnasticsHistoryRecord[]> {
  if (programIds.length === 0) return [];
  const client = await getDb();
  await ensureGymnasticsTable(client);
  const placeholders = programIds.map(() => "?").join(", ");
  const result = await client.execute({
    sql: `SELECT program_id, week, session, completed, completed_at, note
            FROM health_gymnastics_progress
           WHERE program_id IN (${placeholders})
             AND completed = 1
           ORDER BY completed_at ASC, week ASC, session ASC`,
    args: programIds,
  });
  return result.rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      programId: row["program_id"] as string,
      ...rowToGymnasticsProgress(row),
    };
  });
}

/**
 * Upsert the completion state of a single week/session. When `completed` is
 * true the timestamp is stamped; when false it is cleared (uncomplete).
 */
export async function setGymnasticsProgress(entry: {
  programId: string;
  week: number;
  session: GymnasticsSessionKey;
  completed: boolean;
  note?: string;
}): Promise<GymnasticsProgressRecord> {
  const client = await getDb();
  await ensureGymnasticsTable(client);
  const completedAt = entry.completed ? new Date().toISOString() : null;
  // A row that is already completed keeps its original completed_at when it is
  // written again as completed (e.g. a feedback-note save): completed_at is the
  // instant the session was trained, not the instant of the latest write.
  // Uncompleting clears it; completing an uncompleted row stamps it fresh.
  await client.execute({
    sql: `INSERT INTO health_gymnastics_progress (program_id, week, session, completed, completed_at, note)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (program_id, week, session) DO UPDATE SET
            completed = excluded.completed,
            completed_at = CASE
              WHEN excluded.completed = 1 AND health_gymnastics_progress.completed = 1
                THEN health_gymnastics_progress.completed_at
              ELSE excluded.completed_at
            END,
            note = COALESCE(excluded.note, health_gymnastics_progress.note)`,
    args: [
      entry.programId,
      entry.week,
      entry.session,
      entry.completed ? 1 : 0,
      completedAt,
      entry.note ?? null,
    ],
  });
  // Read the row back rather than echoing the inputs: the upsert may have kept
  // an earlier completed_at or an earlier note, and the caller needs the truth.
  const readBack = await client.execute({
    sql: "SELECT week, session, completed, completed_at, note FROM health_gymnastics_progress WHERE program_id = ? AND week = ? AND session = ?",
    args: [entry.programId, entry.week, entry.session],
  });
  const row = readBack.rows[0];
  if (row) return rowToGymnasticsProgress(row as Record<string, unknown>);
  return {
    week: entry.week,
    session: entry.session,
    completed: entry.completed,
    completedAt,
    ...(entry.note ? { note: entry.note } : {}),
  };
}

function rowToGymnasticsProgress(row: Record<string, unknown>): GymnasticsProgressRecord {
  return {
    week: row["week"] as number,
    session: row["session"] as GymnasticsSessionKey,
    completed: (row["completed"] as number) === 1,
    completedAt: (row["completed_at"] as string | null) ?? null,
    ...(row["note"] ? { note: row["note"] as string } : {}),
  };
}
