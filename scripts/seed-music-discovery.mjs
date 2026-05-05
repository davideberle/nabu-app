import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

function buildUrl() {
  if (process.env.TURSO_DATABASE_URL) return process.env.TURSO_DATABASE_URL;
  const dir = process.env.NABU_DB_DIR || process.cwd();
  return `file:${dir}/nabu.db`;
}

const root = process.env.SONOS_MUSIC_ROOT || path.resolve(process.cwd(), '../../sonos-music');
const statePath = process.env.DISCOVERY_STATE_PATH || path.join(root, 'discovery-state.json');
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const candidates = Array.isArray(state.candidates) ? state.candidates : [];

const db = createClient({ url: buildUrl(), authToken: process.env.TURSO_AUTH_TOKEN });
await db.execute(`
  CREATE TABLE IF NOT EXISTS discovery_candidates (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'inbox',
    lane TEXT,
    score INTEGER,
    type TEXT,
    name TEXT NOT NULL,
    artist TEXT,
    genres_json TEXT NOT NULL DEFAULT '[]',
    reasons TEXT,
    library_status TEXT,
    artwork_url TEXT,
    album_year INTEGER,
    release_year INTEGER,
    source_signals_json TEXT,
    played_count INTEGER NOT NULL DEFAULT 0,
    history_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

const columns = await db.execute("PRAGMA table_info(discovery_candidates)");
const columnNames = new Set(columns.rows.map((row) => String(row.name)));
if (!columnNames.has("artwork_url")) {
  await db.execute("ALTER TABLE discovery_candidates ADD COLUMN artwork_url TEXT");
}
if (!columnNames.has("album_year")) {
  await db.execute("ALTER TABLE discovery_candidates ADD COLUMN album_year INTEGER");
}
if (!columnNames.has("release_year")) {
  await db.execute("ALTER TABLE discovery_candidates ADD COLUMN release_year INTEGER");
}

function optionalArtworkUrl(candidate) {
  return candidate.artwork_url || candidate.cover_art_url || candidate.source_signals?.artwork_url || null;
}

function optionalYear(value) {
  if (Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

let inserted = 0;
for (const candidate of candidates) {
  const createdAt = candidate.created_at || new Date().toISOString();
  const updatedAt = candidate.updated_at || createdAt;
  const result = await db.execute({
    sql: `INSERT OR IGNORE INTO discovery_candidates (
      id, status, lane, score, type, name, artist, genres_json, reasons, library_status,
      artwork_url, album_year, release_year, source_signals_json, played_count, history_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      candidate.id,
      candidate.status || 'inbox',
      candidate.lane || null,
      Number.isFinite(candidate.score) ? candidate.score : null,
      candidate.type || null,
      candidate.name,
      candidate.artist || null,
      JSON.stringify(candidate.genres || []),
      candidate.reasons || null,
      candidate.library_status || null,
      optionalArtworkUrl(candidate),
      optionalYear(candidate.album_year),
      optionalYear(candidate.release_year),
      JSON.stringify(candidate.source_signals || {}),
      candidate.played_count || 0,
      JSON.stringify(candidate.history || []),
      createdAt,
      updatedAt,
    ],
  });
  inserted += Number(result.rowsAffected || 0);
}

const count = await db.execute('SELECT COUNT(*) as count FROM discovery_candidates');
console.log(JSON.stringify({ statePath, source: candidates.length, inserted, total: Number(count.rows[0].count || 0) }, null, 2));
