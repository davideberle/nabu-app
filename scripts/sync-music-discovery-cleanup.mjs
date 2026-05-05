import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx);
    if (process.env[key]) continue;
    let value = line.slice(idx + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function buildUrl() {
  if (process.env.TURSO_DATABASE_URL) return process.env.TURSO_DATABASE_URL;
  const dir = process.env.NABU_DB_DIR || process.cwd();
  return `file:${dir}/nabu.db`;
}

function optionalYear(value) {
  if (Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function optionalArtworkUrl(candidate) {
  return candidate.artwork_url || candidate.cover_art_url || candidate.source_signals?.artwork_url || null;
}

function sourceSignals(candidate) {
  return candidate.source_signals && typeof candidate.source_signals === 'object'
    ? candidate.source_signals
    : {};
}

function historyWithAutoReject(existingHistory, now) {
  let history = [];
  if (typeof existingHistory === 'string' && existingHistory.trim()) {
    try {
      const parsed = JSON.parse(existingHistory);
      if (Array.isArray(parsed)) history = parsed;
    } catch {
      history = [];
    }
  }
  if (!history.some((entry) => entry?.action === 'auto_reject_in_library')) {
    history.push({
      from: 'inbox',
      to: 'rejected',
      action: 'auto_reject_in_library',
      reason: 'Already in David’s Apple Music library',
      at: now,
    });
  }
  return JSON.stringify(history);
}

loadEnvFile('.env.vercel');

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

const columns = await db.execute('PRAGMA table_info(discovery_candidates)');
const columnNames = new Set(columns.rows.map((row) => String(row.name)));
for (const [name, ddl] of [
  ['artwork_url', 'ALTER TABLE discovery_candidates ADD COLUMN artwork_url TEXT'],
  ['album_year', 'ALTER TABLE discovery_candidates ADD COLUMN album_year INTEGER'],
  ['release_year', 'ALTER TABLE discovery_candidates ADD COLUMN release_year INTEGER'],
]) {
  if (!columnNames.has(name)) await db.execute(ddl);
}

let metadataUpdates = 0;
let rejectedAlreadyInLibrary = 0;
let inserted = 0;
const now = new Date().toISOString();
const inLibrary = [];

for (const candidate of candidates) {
  const createdAt = candidate.created_at || now;
  const updatedAt = candidate.updated_at || createdAt;
  const artworkUrl = optionalArtworkUrl(candidate);
  const albumYear = optionalYear(candidate.album_year ?? candidate.source_signals?.album_year ?? candidate.release_year ?? candidate.source_signals?.release_year);
  const releaseYear = optionalYear(candidate.release_year ?? candidate.source_signals?.release_year ?? candidate.album_year ?? candidate.source_signals?.album_year);
  const signals = sourceSignals(candidate);

  const insertResult = await db.execute({
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
      artworkUrl,
      albumYear,
      releaseYear,
      JSON.stringify(signals),
      candidate.played_count || 0,
      JSON.stringify(candidate.history || []),
      createdAt,
      updatedAt,
    ],
  });
  inserted += Number(insertResult.rowsAffected || 0);

  const updateResult = await db.execute({
    sql: `UPDATE discovery_candidates
          SET library_status = COALESCE(?, library_status),
              artwork_url = COALESCE(?, artwork_url),
              album_year = COALESCE(album_year, ?),
              release_year = COALESCE(release_year, ?),
              source_signals_json = ?,
              updated_at = ?
          WHERE id = ?`,
    args: [
      candidate.library_status || null,
      artworkUrl,
      albumYear,
      releaseYear,
      JSON.stringify(signals),
      now,
      candidate.id,
    ],
  });
  metadataUpdates += Number(updateResult.rowsAffected || 0);

  if (candidate.library_status === 'in_library') {
    const existing = await db.execute({
      sql: 'SELECT status, history_json FROM discovery_candidates WHERE id = ?',
      args: [candidate.id],
    });
    const row = existing.rows[0] || {};
    inLibrary.push({ id: candidate.id, name: candidate.name, artist: candidate.artist || null });
    if (row.status === 'inbox') {
      const historyJson = historyWithAutoReject(row.history_json, now);
      const rejectResult = await db.execute({
        sql: `UPDATE discovery_candidates
              SET status = 'rejected',
                  history_json = ?,
                  updated_at = ?
              WHERE id = ? AND status = 'inbox'`,
        args: [historyJson, now, candidate.id],
      });
      rejectedAlreadyInLibrary += Number(rejectResult.rowsAffected || 0);
    }
  }
}

const counts = await db.execute('SELECT status, COUNT(*) as count FROM discovery_candidates GROUP BY status ORDER BY status');
const craig = await db.execute({
  sql: 'SELECT id, name, artist, status, library_status, album_year, release_year, artwork_url FROM discovery_candidates WHERE id = ? OR (artist = ? AND name LIKE ?)',
  args: ['R21', 'Craig David', '%Born to Do It%'],
});
const withArtwork = await db.execute('SELECT COUNT(*) as count FROM discovery_candidates WHERE artwork_url IS NOT NULL');
const withYears = await db.execute('SELECT COUNT(*) as count FROM discovery_candidates WHERE album_year IS NOT NULL OR release_year IS NOT NULL');

console.log(JSON.stringify({
  statePath,
  source_candidates: candidates.length,
  inserted,
  metadata_updates: metadataUpdates,
  rejected_already_in_library: rejectedAlreadyInLibrary,
  in_library_count: inLibrary.length,
  in_library: inLibrary,
  rows_with_artwork: Number(withArtwork.rows[0]?.count || 0),
  rows_with_years: Number(withYears.rows[0]?.count || 0),
  craig,
  counts: counts.rows,
}, null, 2));
