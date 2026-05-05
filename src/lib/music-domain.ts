import { getDb } from "./db";

export type MusicActionResult = {
  ok?: boolean;
  message?: string;
  detail?: Record<string, unknown>;
  error?: string;
};

export type NowPlaying = {
  track: string | null;
  artist: string | null;
  album: string | null;
  albumArtUri: string | null;
  state: string | null;
  volume: number | null;
  trackNo: number | null;
};

export type LastMedia = {
  name: string;
  type: string;
  lastPlayed: string | null;
  lastTrack: {
    title?: string | null;
    artist?: string | null;
    trackNo?: number | null;
  } | null;
  playCount: number;
  feedback: string | null;
  room: string;
};

export type RoomProjection = {
  room: string;
  nowPlaying: NowPlaying | null;
  lastMedia: LastMedia | null;
};

export type DiscoveryCandidate = {
  id: string;
  name: string;
  artist?: string | null;
  type?: string;
  genres?: string[];
  lane?: string;
  score?: number;
  reasons?: string;
  library_status?: string;
  artwork_url?: string | null;
  album_year?: number | null;
  release_year?: number | null;
  status?: "inbox" | "trial" | "promoted" | "rejected";
  played_count?: number;
  last_played_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type DiscoverySummary = {
  counts: Record<"inbox" | "trial" | "promoted" | "rejected", number>;
  updated_at?: string | null;
};


function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}


function parseJsonObject<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeAction(action: string) {
  if (["try", "trial"].includes(action)) return "trial";
  if (["promote", "accept", "accepted"].includes(action)) return "promoted";
  if (["reject", "rejected"].includes(action)) return "rejected";
  if (["undo_reject", "inbox", "reset"].includes(action)) return "inbox";
  return "";
}

export async function getRoomProjections(): Promise<RoomProjection[]> {
  const rooms = ["Living Room", "Cinema", "Penthouse", "Pool"];
  return rooms.map((room) => ({ room, nowPlaying: null, lastMedia: null }));
}

function asOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function rowToDiscoveryCandidate(row: Record<string, unknown>): DiscoveryCandidate {
  return {
    id: row.id as string,
    name: row.name as string,
    artist: asString(row.artist),
    type: asString(row.type) || undefined,
    genres: parseJsonObject<string[]>(row.genres_json ?? row.genres, []),
    lane: asString(row.lane) || undefined,
    score: typeof row.score === "number" ? row.score : undefined,
    reasons: asString(row.reasons) || undefined,
    library_status: asString(row.library_status) || undefined,
    artwork_url: asString(row.artwork_url) || undefined,
    album_year: asOptionalNumber(row.album_year),
    release_year: asOptionalNumber(row.release_year),
    status: (asString(row.status) as DiscoveryCandidate["status"]) || "inbox",
    played_count: typeof row.played_count === "number" ? row.played_count : 0,
    last_played_at: asString(row.last_played_at),
    created_at: asString(row.created_at) || undefined,
    updated_at: asString(row.updated_at) || undefined,
  };
}

async function ensureDiscoverySchema() {
  const db = await getDb();
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

  return db;
}

export async function getDiscovery(limit = 8) {
  const db = await ensureDiscoverySchema();
  const statuses = ["inbox", "trial", "promoted", "rejected"] as const;
  const counts: DiscoverySummary["counts"] = {
    inbox: 0,
    trial: 0,
    promoted: 0,
    rejected: 0,
  };

  const countResult = await db.execute(
    "SELECT status, COUNT(*) as count FROM discovery_candidates GROUP BY status"
  );
  for (const row of countResult.rows as unknown as Record<string, unknown>[]) {
    const status = asString(row.status) as keyof typeof counts;
    if (status && status in counts) counts[status] = Number(row.count || 0);
  }

  const updatedResult = await db.execute(
    "SELECT MAX(updated_at) as updated_at FROM discovery_candidates"
  );
  const updated_at = asString(updatedResult.rows[0]?.updated_at);

  const lists = await Promise.all(
    statuses.map(async (status) => {
      const result = await db.execute({
        sql: `SELECT * FROM discovery_candidates WHERE status = ? ORDER BY score DESC, updated_at DESC LIMIT ?`,
        args: [status, limit],
      });
      return result.rows.map((row) => rowToDiscoveryCandidate(row as Record<string, unknown>));
    })
  );

  return {
    summary: { counts, updated_at },
    inbox: lists[0],
    trial: lists[1],
    promoted: lists[2],
    rejected: lists[3],
  };
}

export async function transitionDiscoveryCandidate(id: string, action: string) {
  const status = normalizeAction(action);
  if (!status) return { ok: false, message: `Unknown discovery action: ${action}` };

  const db = await ensureDiscoverySchema();
  const existing = await db.execute({
    sql: "SELECT * FROM discovery_candidates WHERE id = ?",
    args: [id],
  });
  if (existing.rows.length === 0) {
    return { ok: false, message: `Discovery candidate not found: ${id}` };
  }

  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE discovery_candidates
          SET status = ?, updated_at = ?, played_count = played_count + ?
          WHERE id = ?`,
    args: [status, now, status === "trial" ? 1 : 0, id],
  });

  const updated = await db.execute({
    sql: "SELECT * FROM discovery_candidates WHERE id = ?",
    args: [id],
  });

  return {
    ok: true,
    message: `Moved to ${status}`,
    candidate: rowToDiscoveryCandidate(updated.rows[0] as Record<string, unknown>),
  };
}

export async function setTrackFeedback(input: {
  artist?: string;
  title: string;
  album?: string;
  action: "love" | "dislike";
}) {
  const db = await getDb();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS music_track_feedback (
      id TEXT PRIMARY KEY,
      artist TEXT,
      title TEXT NOT NULL,
      album TEXT,
      action TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  const id = `${(input.artist || "").toLowerCase()}::${input.title.toLowerCase()}::${(input.album || "").toLowerCase()}`;
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO music_track_feedback (id, artist, title, album, action, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (id) DO UPDATE SET action = ?, updated_at = ?`,
    args: [id, input.artist || null, input.title, input.album || null, input.action, now, input.action, now],
  });
  return { ok: true };
}

export async function setPlaylistFeedback(input: {
  name: string;
  rating: "love" | "like" | "skip" | "occasional";
  notes?: string;
}) {
  const db = await getDb();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS music_playlist_feedback (
      name TEXT PRIMARY KEY,
      rating TEXT NOT NULL,
      notes TEXT,
      updated_at TEXT NOT NULL
    )
  `);
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO music_playlist_feedback (name, rating, notes, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (name) DO UPDATE SET rating = ?, notes = ?, updated_at = ?`,
    args: [input.name, input.rating, input.notes || null, now, input.rating, input.notes || null, now],
  });
  return { ok: true };
}

export async function resolveMusicRequest(input: {
  action: "play" | "pause" | "resume";
  room?: string;
  query?: string;
  type?: string;
  source?: string;
}): Promise<MusicActionResult> {
  return {
    ok: false,
    message:
      "Remote Sonos control is only available on the home runtime. This deployed app can review discovery and save feedback, but cannot reach localhost:5005 from Vercel.",
    detail: {
      action: input.action,
      room: input.room || "Living Room",
      query: input.query || null,
      type: input.type || null,
      source: input.source || "companion-app",
    },
  };
}
