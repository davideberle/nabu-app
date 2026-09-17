// New plays history: the Companion App half of adaptive music discovery.
//
// The app is thin here on purpose (ARCHITECTURE.md). It owns NO music truth:
// no ranking, no lifecycle, no approval semantics. It only
//
//   (a) mirrors a read-only projection that `projects/sonos-music`
//       (`new-plays-sync.js`) pushes with PUT /api/music/new-plays,
//   (b) queues typed action requests in an outbox that the same script pulls
//       (GET /api/music/new-plays/actions?status=pending) and acknowledges
//       (POST /api/music/new-plays/actions/ack), and
//   (c) renders.
//
// Every state change to feedback, the Apple Music library, or the DJ profile
// shows up here only when sonos-music pushes a new mirror. Rows are stored as
// opaque JSON (`row_json`) so nothing in this module interprets a domain
// field beyond what the page needs for display.
//
// Explicit .ts extension: this module is loaded directly by `node --test`,
// whose ESM resolver does not add extensions.
import { getDb } from "./db.ts";

// Pure types and helpers live in ./music-new-plays-view.ts (browser-safe, no
// db import) and are re-exported here so server code has a single import.
export * from "./music-new-plays-view.ts";
import {
  normalizeNewPlayRow,
  type NewPlayAction,
  type NewPlayActionAckResult,
  type NewPlayActionRecord,
  type NewPlayActionRequest,
  type NewPlayActionStatus,
  type NewPlayListItem,
  type NewPlayPendingAction,
  type NewPlayRow,
} from "./music-new-plays-view.ts";

function asString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

type DbClient = Awaited<ReturnType<typeof getDb>>;

export async function ensureNewPlaysSchema(db?: DbClient): Promise<DbClient> {
  const client = db ?? (await getDb());
  await client.execute(`
    CREATE TABLE IF NOT EXISTS music_new_plays (
      play_id TEXT PRIMARY KEY,
      played_at TEXT NOT NULL,
      row_json TEXT NOT NULL,
      synced_at TEXT NOT NULL
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS music_new_play_actions (
      id TEXT PRIMARY KEY,
      play_id TEXT NOT NULL,
      action TEXT NOT NULL,
      context TEXT,
      requested_at TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      status TEXT NOT NULL,
      result_message TEXT,
      result_code TEXT,
      event_id TEXT,
      applied_at TEXT
    )
  `);
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_music_new_play_actions_status ON music_new_play_actions (status, requested_at)",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_music_new_play_actions_play ON music_new_play_actions (play_id)",
  );
  return client;
}

/** Mirror pushed rows. Returns the number of rows written. */
export async function upsertNewPlays(rows: NewPlayRow[], syncedAt: string): Promise<number> {
  if (rows.length === 0) return 0;
  const db = await ensureNewPlaysSchema();
  const stamp = asString(syncedAt) ?? new Date().toISOString();
  let count = 0;
  for (const row of rows) {
    await db.execute({
      sql: `INSERT INTO music_new_plays (play_id, played_at, row_json, synced_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(play_id) DO UPDATE SET
              played_at = excluded.played_at,
              row_json = excluded.row_json,
              synced_at = excluded.synced_at`,
      args: [row.playId, row.playedAt, JSON.stringify(row), stamp],
    });
    count += 1;
  }
  return count;
}

function rowToActionRecord(row: Record<string, unknown>): NewPlayActionRecord {
  return {
    id: String(row.id),
    playId: String(row.play_id),
    action: String(row.action) as NewPlayAction,
    context: asString(row.context),
    requestedAt: String(row.requested_at),
    requestedBy: String(row.requested_by),
    status: String(row.status) as NewPlayActionStatus,
    resultMessage: asString(row.result_message),
    resultCode: asString(row.result_code),
    eventId: asString(row.event_id),
    appliedAt: asString(row.applied_at),
  };
}

/** Newest first, each row joined with its pending/failed action requests. */
export async function listNewPlays(
  limit = 100,
): Promise<{ items: NewPlayListItem[]; syncedAt: string | null }> {
  const db = await ensureNewPlaysSchema();
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.trunc(limit), 500) : 100;

  const result = await db.execute({
    sql: "SELECT play_id, played_at, row_json FROM music_new_plays ORDER BY played_at DESC LIMIT ?",
    args: [safeLimit],
  });

  const items: NewPlayListItem[] = [];
  const ids: string[] = [];
  for (const raw of result.rows as unknown as Record<string, unknown>[]) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(String(raw.row_json));
    } catch {
      parsed = null;
    }
    let row: NewPlayRow;
    try {
      row = normalizeNewPlayRow(parsed);
    } catch {
      // A corrupt mirror row is skipped rather than breaking the whole list;
      // the next sync overwrites it.
      continue;
    }
    ids.push(row.playId);
    items.push({ ...row, pendingActions: [] });
  }

  if (ids.length > 0) {
    const placeholders = ids.map(() => "?").join(", ");
    const actions = await db.execute({
      sql: `SELECT * FROM music_new_play_actions
            WHERE status IN ('pending', 'failed') AND play_id IN (${placeholders})
            ORDER BY requested_at ASC`,
      args: ids,
    });
    const byPlay = new Map<string, NewPlayPendingAction[]>();
    for (const raw of actions.rows as unknown as Record<string, unknown>[]) {
      const record = rowToActionRecord(raw);
      const list = byPlay.get(record.playId) ?? [];
      list.push({
        id: record.id,
        action: record.action,
        context: record.context,
        requestedAt: record.requestedAt,
        status: record.status,
        resultMessage: record.resultMessage,
      });
      byPlay.set(record.playId, list);
    }
    for (const item of items) {
      item.pendingActions = byPlay.get(item.playId) ?? [];
    }
  }

  const synced = await db.execute("SELECT MAX(synced_at) AS synced_at FROM music_new_plays");
  const syncedAt = asString(synced.rows[0]?.synced_at);

  return { items, syncedAt };
}

export type EnqueueResult =
  | { ok: true; action: NewPlayActionRecord }
  | { ok: false; error: string; status: 409 };

/**
 * Queue a typed action for the home runtime to apply. A duplicate pending
 * request (same play, action, and context) is refused with a 409-style
 * result rather than queued twice.
 */
export async function enqueueAction(
  request: NewPlayActionRequest,
  requestedBy: string,
): Promise<EnqueueResult> {
  const db = await ensureNewPlaysSchema();
  const context = asString(request.context);

  const existing = await db.execute({
    sql: `SELECT id FROM music_new_play_actions
          WHERE status = 'pending' AND play_id = ? AND action = ? AND COALESCE(context, '') = ?
          LIMIT 1`,
    args: [request.playId, request.action, context ?? ""],
  });
  if (existing.rows.length > 0) {
    return {
      ok: false,
      status: 409,
      error: `${request.action} is already queued for this play${context ? ` (${context})` : ""}`,
    };
  }

  const record: NewPlayActionRecord = {
    id: crypto.randomUUID(),
    playId: request.playId,
    action: request.action,
    context,
    requestedAt: new Date().toISOString(),
    requestedBy: asString(requestedBy) ?? "companion-app",
    status: "pending",
    resultMessage: null,
    resultCode: null,
    eventId: null,
    appliedAt: null,
  };

  await db.execute({
    sql: `INSERT INTO music_new_play_actions
            (id, play_id, action, context, requested_at, requested_by, status)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      record.id,
      record.playId,
      record.action,
      record.context,
      record.requestedAt,
      record.requestedBy,
      record.status,
    ],
  });

  return { ok: true, action: record };
}

export async function listActions(
  status: NewPlayActionStatus | null = "pending",
  limit = 200,
): Promise<NewPlayActionRecord[]> {
  const db = await ensureNewPlaysSchema();
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.trunc(limit), 1000) : 200;
  const result = status
    ? await db.execute({
        sql: "SELECT * FROM music_new_play_actions WHERE status = ? ORDER BY requested_at ASC LIMIT ?",
        args: [status, safeLimit],
      })
    : await db.execute({
        sql: "SELECT * FROM music_new_play_actions ORDER BY requested_at DESC LIMIT ?",
        args: [safeLimit],
      });
  return (result.rows as unknown as Record<string, unknown>[]).map(rowToActionRecord);
}

/**
 * Record what the home runtime did with each queued action. Returns how many
 * rows changed. Re-acknowledging an already-terminal row is a no-op.
 */
export async function ackActions(results: NewPlayActionAckResult[]): Promise<number> {
  if (results.length === 0) return 0;
  const db = await ensureNewPlaysSchema();
  const now = new Date().toISOString();
  let updated = 0;
  for (const result of results) {
    const id = asString(result.id);
    if (!id) continue;
    const status: NewPlayActionStatus = result.ok ? "applied" : "failed";
    const outcome = await db.execute({
      sql: `UPDATE music_new_play_actions
            SET status = ?, result_message = ?, result_code = ?, event_id = ?, applied_at = ?
            WHERE id = ? AND status = 'pending'`,
      args: [
        status,
        asString(result.message)?.slice(0, 500) ?? null,
        asString(result.code) ?? null,
        asString(result.eventId) ?? null,
        now,
        id,
      ],
    });
    updated += Number(outcome.rowsAffected ?? 0);
  }
  return updated;
}
