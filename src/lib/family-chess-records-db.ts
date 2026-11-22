// ---------------------------------------------------------------------------------------------------------------------
// Chess game records — persistence (Nov 22, 2026). Two NEW tables; no existing table is touched:
//
//   family_chess_games    one row per game (client-generated game id), the latest report wins by `seq`; a row never
//                         changes owner (a game id reported by another child is refused). Carries the profile snapshot
//                         the game reported (JSON, validated by family-chess-records.ts).
//   family_chess_imports  one row per child: the browser profile as it was on the first open after the release, marked
//                         `imported-from-browser`. Written once; later imports are ignored.
//
// Server-only (libSQL). The pure gate and the parent's view live in family-chess-records.ts. The handler below is the
// whole POST behind the route, with authorization injected, so node --test drives it against a temp SQLite file.
// ---------------------------------------------------------------------------------------------------------------------

import type { Client, Transaction } from "@libsql/client";
import { CHILD_IDS, type ChildId } from "./family-assistant-turn.ts";
import {
  CHESS_HISTORY_LIMIT,
  chessChildView,
  parseChessRecordBody,
  type ChessChildView,
  type ChessGameRecord,
  type ChessGameRow,
  type ChessImportRecord,
  type ChessProfileSnapshot,
} from "./family-chess-records.ts";

type Db = Client | Transaction;

const ready = new WeakMap<Db, Promise<void>>();

export function ensureChessRecordTables(client: Db): Promise<void> {
  let p = ready.get(client);
  if (!p) {
    p = createTables(client);
    ready.set(client, p);
    p.catch(() => ready.delete(client));
  }
  return p;
}

async function createTables(client: Db): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS family_chess_games (
      game_id           TEXT PRIMARY KEY,
      person_id         TEXT NOT NULL,
      seq               INTEGER NOT NULL,
      started_at        TEXT,
      ended_at          TEXT,
      opponent_id       TEXT NOT NULL,
      level_before      INTEGER NOT NULL,
      level_after       INTEGER NOT NULL,
      result            TEXT NOT NULL,
      end_reason        TEXT NOT NULL,
      judged            TEXT,
      moves_played      INTEGER NOT NULL,
      active_seconds    INTEGER NOT NULL,
      nudges_shown      INTEGER NOT NULL,
      nudges_followed   INTEGER NOT NULL,
      nudges_kept       INTEGER NOT NULL,
      nudges_json       TEXT NOT NULL,
      material_balance  INTEGER NOT NULL,
      level_reason      TEXT NOT NULL,
      profile_json      TEXT NOT NULL,
      first_received_at TEXT NOT NULL,
      updated_at        TEXT NOT NULL
    )
  `);
  await client.execute(`CREATE INDEX IF NOT EXISTS family_chess_games_person_idx ON family_chess_games (person_id, updated_at)`);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS family_chess_imports (
      person_id    TEXT PRIMARY KEY,
      source       TEXT NOT NULL,
      profile_json TEXT NOT NULL,
      received_at  TEXT NOT NULL
    )
  `);
}

export type StoreOutcome =
  | { ok: true; stored: "inserted" | "updated" | "unchanged" }
  | { ok: false; status: 409; error: "game-belongs-to-another-child" };

/** Idempotent upsert: a report with a higher `seq` replaces the row; an equal or lower one changes nothing. */
export async function storeChessGame(db: Db, rec: ChessGameRecord, now: Date): Promise<StoreOutcome> {
  await ensureChessRecordTables(db);
  const at = now.toISOString();
  const existed = (await db.execute({ sql: "SELECT 1 FROM family_chess_games WHERE game_id = ?", args: [rec.gameId] })).rows.length > 0;
  const args = [
    rec.gameId, rec.child, rec.seq, rec.startedAt, rec.endedAt, rec.opponentId, rec.levelBefore, rec.levelAfter, rec.result, rec.endReason, rec.judged,
    rec.movesPlayed, rec.activeSeconds, rec.nudgesShown, rec.nudgesFollowed, rec.nudgesKept, JSON.stringify(rec.nudges), rec.materialBalance,
    rec.levelReason, JSON.stringify(rec.profile), at, at,
  ];
  const res = await db.execute({
    sql: `INSERT INTO family_chess_games (game_id, person_id, seq, started_at, ended_at, opponent_id, level_before, level_after, result, end_reason, judged,
            moves_played, active_seconds, nudges_shown, nudges_followed, nudges_kept, nudges_json, material_balance, level_reason, profile_json,
            first_received_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (game_id) DO UPDATE SET
            seq = excluded.seq, started_at = excluded.started_at, ended_at = excluded.ended_at, opponent_id = excluded.opponent_id,
            level_before = excluded.level_before, level_after = excluded.level_after, result = excluded.result, end_reason = excluded.end_reason,
            judged = excluded.judged, moves_played = excluded.moves_played, active_seconds = excluded.active_seconds,
            nudges_shown = excluded.nudges_shown, nudges_followed = excluded.nudges_followed, nudges_kept = excluded.nudges_kept,
            nudges_json = excluded.nudges_json, material_balance = excluded.material_balance, level_reason = excluded.level_reason,
            profile_json = excluded.profile_json, updated_at = excluded.updated_at
          WHERE family_chess_games.person_id = excluded.person_id AND excluded.seq > family_chess_games.seq`,
    args,
  });
  const row = (await db.execute({ sql: "SELECT person_id FROM family_chess_games WHERE game_id = ?", args: [rec.gameId] })).rows[0];
  if (!row || row.person_id !== rec.child) return { ok: false, status: 409, error: "game-belongs-to-another-child" };
  if (res.rowsAffected === 0) return { ok: true, stored: "unchanged" };
  return { ok: true, stored: existed ? "updated" : "inserted" };
}

/** Written once per child; a later import changes nothing. */
export async function storeChessImport(db: Db, rec: ChessImportRecord, now: Date): Promise<{ ok: true; stored: "inserted" | "already-imported" }> {
  await ensureChessRecordTables(db);
  const res = await db.execute({
    sql: "INSERT OR IGNORE INTO family_chess_imports (person_id, source, profile_json, received_at) VALUES (?, ?, ?, ?)",
    args: [rec.child, rec.source, JSON.stringify(rec.profile), now.toISOString()],
  });
  return { ok: true, stored: res.rowsAffected > 0 ? "inserted" : "already-imported" };
}

function rowToGame(r: Record<string, unknown>): ChessGameRow {
  return {
    child: r.person_id as ChildId,
    gameId: String(r.game_id),
    seq: Number(r.seq),
    startedAt: (r.started_at as string | null) ?? null,
    endedAt: (r.ended_at as string | null) ?? null,
    opponentId: r.opponent_id as ChessGameRow["opponentId"],
    levelBefore: Number(r.level_before),
    levelAfter: Number(r.level_after),
    result: r.result as ChessGameRow["result"],
    endReason: r.end_reason as ChessGameRow["endReason"],
    judged: (r.judged as ChessGameRow["judged"]) ?? null,
    movesPlayed: Number(r.moves_played),
    activeSeconds: Number(r.active_seconds),
    nudgesShown: Number(r.nudges_shown),
    nudgesFollowed: Number(r.nudges_followed),
    nudgesKept: Number(r.nudges_kept),
    nudges: JSON.parse(String(r.nudges_json)),
    materialBalance: Number(r.material_balance),
    levelReason: r.level_reason as ChessGameRow["levelReason"],
    updatedAt: String(r.updated_at),
    firstReceivedAt: String(r.first_received_at),
  };
}

/** The parent's read for one child: the last games, the latest profile snapshot, the import. Read-only. */
export async function readChessChildView(db: Db, child: ChildId, limit = CHESS_HISTORY_LIMIT): Promise<ChessChildView> {
  await ensureChessRecordTables(db);
  const games = (
    await db.execute({
      sql: `SELECT * FROM family_chess_games WHERE person_id = ? ORDER BY COALESCE(ended_at, updated_at) DESC, updated_at DESC LIMIT ?`,
      args: [child, limit],
    })
  ).rows.map((r) => rowToGame(r as unknown as Record<string, unknown>));
  const latest = (await db.execute({ sql: "SELECT profile_json, updated_at FROM family_chess_games WHERE person_id = ? ORDER BY updated_at DESC LIMIT 1", args: [child] })).rows[0];
  const imp = (await db.execute({ sql: "SELECT profile_json, received_at FROM family_chess_imports WHERE person_id = ?", args: [child] })).rows[0];
  return chessChildView(
    child,
    games,
    latest ? { profile: JSON.parse(String(latest.profile_json)) as ChessProfileSnapshot, at: String(latest.updated_at) } : null,
    imp ? { receivedAt: String(imp.received_at), profile: JSON.parse(String(imp.profile_json)) as ChessProfileSnapshot } : null,
  );
}

export async function readChessViews(db: Db): Promise<Record<ChildId, ChessChildView>> {
  const out = {} as Record<ChildId, ChessChildView>;
  for (const child of CHILD_IDS) out[child] = await readChessChildView(db, child);
  return out;
}

// ---- the POST behind /api/family/play/chess-games ---------------------------------------------------------------------------
export type ChessRecordAuth = { ok: true; child: ChildId } | { ok: false; status: number; error: string };
export type ChessRecordResponse = { status: number; body: Record<string, unknown> };

/**
 * authorize → rate limit → parse (strict) → same child as the bearer → store. Never touches the wallet, leases or the level.
 * `authorize` is requireChildGames in the route (household session + verified `family-games` bearer).
 */
export async function handleChessRecordPost(input: {
  authorize: () => Promise<ChessRecordAuth>;
  rawBody: () => Promise<string>;
  admit: (child: ChildId, nowMs: number) => boolean;
  db: () => Promise<Db>;
  now?: () => Date;
}): Promise<ChessRecordResponse> {
  const authz = await input.authorize();
  if (!authz.ok) return { status: authz.status, body: { error: authz.error } };
  const now = (input.now ?? (() => new Date()))();
  if (!input.admit(authz.child, now.getTime())) return { status: 429, body: { error: "Too many chess reports" } };
  let raw: string;
  try {
    raw = await input.rawBody();
  } catch {
    return { status: 400, body: { error: "Body could not be read" } };
  }
  const parsed = parseChessRecordBody(raw, now.getTime());
  if (!parsed.ok) return { status: parsed.error === "Body too large" ? 413 : 400, body: { error: parsed.error } };
  const rec = parsed.value;
  if (rec.child !== authz.child) return { status: 403, body: { error: "This report is for another child" } };
  const db = await input.db();
  if (rec.kind === "import") {
    const r = await storeChessImport(db, rec, now);
    return { status: 200, body: { ok: true, stored: r.stored } };
  }
  const r = await storeChessGame(db, rec, now);
  if (!r.ok) return { status: r.status, body: { error: r.error } };
  return { status: 200, body: { ok: true, stored: r.stored } };
}
