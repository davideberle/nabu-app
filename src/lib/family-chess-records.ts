// ---------------------------------------------------------------------------------------------------------------------
// Chess game records (Nov 22, 2026; David's approval after Isabel's Nov 21 games). Pure and isomorphic (node --test).
//
// The Adaptive Chess Coach (Game Studio-owned, `chess-coach.js` → gameRecord / importRecord) reports every game to
// POST /api/family/play/chess-games with the child's `family-games` bearer. This module is the strict gate for those bodies:
//   - closed shapes (unknown keys refused), bounded numbers, ISO dates in a sane window, enums for every word;
//   - no free text and no names: ids, enums, dates, numbers and the coach's four fixed English level labels only;
//   - the child in the body must be the bearer's child (checked by the caller).
// It also builds the parent's English view of the stored rows. The local browser profile stays what the game plays from;
// nothing here drives the level.
// ---------------------------------------------------------------------------------------------------------------------

import { isChildId, type ChildId } from "./family-assistant-turn.ts";

export const CHESS_RECORDS_PATH = "/api/family/play/chess-games";
export const CHESS_RECORD_MAX_BYTES = 32 * 1024;
export const CHESS_MAX_LEVEL = 8;
export const CHESS_MAX_NUDGES = 3;
export const CHESS_HISTORY_LIMIT = 20;
export const CHESS_IMPORT_SOURCE = "imported-from-browser";

export const CHESS_OPPONENTS = ["pip", "waffles", "bongo", "gizmo", "luna", "hoot"] as const;
export type ChessOpponentId = (typeof CHESS_OPPONENTS)[number];
/** English names for the parent report (the child sees the German ones). */
export const CHESS_OPPONENT_NAMES: Record<ChessOpponentId, string> = {
  pip: "Pip the Penguin",
  waffles: "Sir Waffles",
  bongo: "Bongo the Sloth",
  gizmo: "Gizmo the Robot",
  luna: "Captain Luna",
  hoot: "Professor Hoot",
};
/** Opponent by level (the hardest one unlocked), mirroring chess-coach.js. */
const OPPONENT_MIN_LEVEL: Record<ChessOpponentId, number> = { pip: 0, waffles: 1, bongo: 2, gizmo: 3, luna: 4, hoot: 5 };
export function chessOpponentForLevel(level: number): ChessOpponentId {
  let chosen: ChessOpponentId = "pip";
  for (const id of CHESS_OPPONENTS) if (OPPONENT_MIN_LEVEL[id] <= level) chosen = id;
  return chosen;
}

export const CHESS_RESULTS = ["win", "loss", "draw", "opponent-resigned", "unfinished"] as const;
export type ChessResult = (typeof CHESS_RESULTS)[number];
export const CHESS_END_REASONS = ["checkmate", "stalemate", "fifty-move", "resignation", "time-out", "new-game", "page-left"] as const;
export type ChessEndReason = (typeof CHESS_END_REASONS)[number];
export const CHESS_NUDGE_THREATS = ["p", "n", "b", "r", "q", "mate", "other"] as const;
export const CHESS_NUDGE_CHOICES = ["kept", "followed", "changed", "open"] as const;
export const CHESS_REASON_KEYS = [
  "win-wobbly", "win-up", "resigned-wobbly", "resigned-up", "unfinished-wobbly", "unfinished-up", "unfinished-even",
  "loss-clean", "loss-down", "draw", "parent-set", "other", "already-counted",
] as const;
export type ChessReasonKey = (typeof CHESS_REASON_KEYS)[number];
export const CHESS_LEVEL_LABELS = ["Just starting out", "Getting the hang of it", "Playing real games", "Sharp player"] as const;
const CONCEPT_IDS = ["center", "develop", "castle", "queen-late", "look-captures", "protect", "knight-rim", "trade-up"] as const;
const LOG_RESULTS = [...CHESS_RESULTS, "parent-set"] as const;

export type ChessNudge = { threat: (typeof CHESS_NUDGE_THREATS)[number]; choice: (typeof CHESS_NUDGE_CHOICES)[number] };

export type ChessHistoryEntry = {
  gameId: string | null;
  date: string | null;
  opponentId: ChessOpponentId | null;
  result: ChessResult | null;
  movesPlayed: number | null;
  blunders: number | null;
  hintsTaken: number | null;
  // Entries from Nov 22, 2026 on:
  nudges?: number | null;
  followed?: number | null;
  kept?: number | null;
  endReason?: ChessEndReason | null;
  from?: number | null;
  to?: number | null;
};

export type ChessLogEntry = {
  gameId: string | null;
  date: string | null;
  result: (typeof LOG_RESULTS)[number] | null;
  blunders: number | null;
  from: number | null;
  to: number | null;
  reasonKey: ChessReasonKey;
};

export type ChessProfileSnapshot = {
  level: number;
  label: (typeof CHESS_LEVEL_LABELS)[number];
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  unfinishedGames: number;
  hintsUsed: number;
  unlockedOpponents: ChessOpponentId[];
  conceptsSeen: string[];
  lastOpponentId: ChessOpponentId | null;
  history: ChessHistoryEntry[];
  progressionLog: ChessLogEntry[];
};

export type ChessGameRecord = {
  kind: "game";
  child: ChildId;
  gameId: string;
  seq: number;
  startedAt: string | null;
  endedAt: string | null;
  opponentId: ChessOpponentId;
  levelBefore: number;
  levelAfter: number;
  result: ChessResult;
  endReason: ChessEndReason;
  judged: "win" | "none" | null;
  movesPlayed: number;
  activeSeconds: number;
  nudgesShown: number;
  nudgesFollowed: number;
  nudgesKept: number;
  nudges: ChessNudge[];
  materialBalance: number;
  levelReason: ChessReasonKey;
  profile: ChessProfileSnapshot;
};

export type ChessImportRecord = { kind: "import"; child: ChildId; source: typeof CHESS_IMPORT_SOURCE; profile: ChessProfileSnapshot };
export type ChessRecordBody = ChessGameRecord | ChessImportRecord;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

// ---- primitive checks ------------------------------------------------------------------------------------------------
class Invalid extends Error {}
const fail = (msg: string): never => {
  throw new Invalid(msg);
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
function closed(v: unknown, where: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!isObj(v)) fail(`${where} must be an object`);
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!required.includes(k) && !optional.includes(k)) fail(`${where}.${k} is not allowed`);
  for (const k of required) if (!(k in o)) fail(`${where}.${k} is required`);
  return o;
}
function int(v: unknown, where: string, lo: number, hi: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) fail(`${where} must be a whole number ${lo}..${hi}`);
  return v as number;
}
function intOrNull(v: unknown, where: string, lo: number, hi: number): number | null {
  return v === null || v === undefined ? null : int(v, where, lo, hi);
}
function oneOf<T extends string>(v: unknown, where: string, list: readonly T[]): T {
  if (typeof v !== "string" || !(list as readonly string[]).includes(v)) fail(`${where} is not one of ${list.join(", ")}`);
  return v as T;
}
function oneOfOrNull<T extends string>(v: unknown, where: string, list: readonly T[]): T | null {
  return v === null || v === undefined ? null : oneOf(v, where, list);
}
const EARLIEST = Date.parse("2025-01-01T00:00:00Z");
function isoOrNull(v: unknown, where: string, nowMs: number): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string" || v.length > 40) fail(`${where} must be an ISO date`);
  const t = Date.parse(v as string);
  if (!Number.isFinite(t) || t < EARLIEST || t > nowMs + 24 * 3600_000) fail(`${where} is outside the allowed dates`);
  return new Date(t).toISOString();
}
export const CHESS_GAME_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
function gameIdOrNull(v: unknown, where: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string" || !CHESS_GAME_ID_PATTERN.test(v)) fail(`${where} is not a game id`);
  return v as string;
}
function idList<T extends string>(v: unknown, where: string, list: readonly T[]): T[] {
  if (!Array.isArray(v) || v.length > list.length) fail(`${where} must be a short list`);
  const out = (v as unknown[]).map((x, i) => oneOf(x, `${where}[${i}]`, list));
  if (new Set(out).size !== out.length) fail(`${where} has duplicates`);
  return out;
}

// ---- shapes -------------------------------------------------------------------------------------------------------------
const HISTORY_REQUIRED = ["gameId", "date", "opponentId", "result", "movesPlayed", "blunders", "hintsTaken"] as const;
const HISTORY_NEW = ["nudges", "followed", "kept", "endReason", "from", "to"] as const;

function parseHistoryEntry(v: unknown, where: string, nowMs: number): ChessHistoryEntry {
  const o = closed(v, where, [], [...HISTORY_REQUIRED, ...HISTORY_NEW]);
  const e: ChessHistoryEntry = {
    gameId: gameIdOrNull(o.gameId, `${where}.gameId`),
    date: isoOrNull(o.date, `${where}.date`, nowMs),
    opponentId: oneOfOrNull(o.opponentId, `${where}.opponentId`, CHESS_OPPONENTS),
    result: oneOfOrNull(o.result, `${where}.result`, CHESS_RESULTS),
    movesPlayed: intOrNull(o.movesPlayed, `${where}.movesPlayed`, 0, 1000),
    blunders: intOrNull(o.blunders, `${where}.blunders`, 0, 20),
    hintsTaken: intOrNull(o.hintsTaken, `${where}.hintsTaken`, 0, 20),
  };
  if ("nudges" in o) {
    e.nudges = intOrNull(o.nudges, `${where}.nudges`, 0, CHESS_MAX_NUDGES);
    e.followed = intOrNull(o.followed, `${where}.followed`, 0, CHESS_MAX_NUDGES);
    e.kept = intOrNull(o.kept, `${where}.kept`, 0, CHESS_MAX_NUDGES);
    e.endReason = oneOfOrNull(o.endReason, `${where}.endReason`, CHESS_END_REASONS);
    e.from = intOrNull(o.from, `${where}.from`, 0, CHESS_MAX_LEVEL);
    e.to = intOrNull(o.to, `${where}.to`, 0, CHESS_MAX_LEVEL);
  }
  return e;
}

function parseLogEntry(v: unknown, where: string, nowMs: number): ChessLogEntry {
  const o = closed(v, where, ["reasonKey"], ["gameId", "date", "result", "blunders", "from", "to"]);
  return {
    gameId: gameIdOrNull(o.gameId, `${where}.gameId`),
    date: isoOrNull(o.date, `${where}.date`, nowMs),
    result: oneOfOrNull(o.result, `${where}.result`, LOG_RESULTS),
    blunders: intOrNull(o.blunders, `${where}.blunders`, 0, 20),
    from: intOrNull(o.from, `${where}.from`, 0, CHESS_MAX_LEVEL),
    to: intOrNull(o.to, `${where}.to`, 0, CHESS_MAX_LEVEL),
    reasonKey: oneOf(o.reasonKey, `${where}.reasonKey`, CHESS_REASON_KEYS),
  };
}

const PROFILE_KEYS = ["level", "label", "gamesPlayed", "wins", "losses", "draws", "unfinishedGames", "hintsUsed", "unlockedOpponents", "conceptsSeen", "lastOpponentId", "history", "progressionLog"] as const;

function parseProfile(v: unknown, where: string, nowMs: number): ChessProfileSnapshot {
  const o = closed(v, where, PROFILE_KEYS);
  const list = (x: unknown, w: string) => {
    if (!Array.isArray(x) || x.length > CHESS_HISTORY_LIMIT) fail(`${w} must be a list of at most ${CHESS_HISTORY_LIMIT}`);
    return x as unknown[];
  };
  return {
    level: int(o.level, `${where}.level`, 0, CHESS_MAX_LEVEL),
    label: oneOf(o.label, `${where}.label`, CHESS_LEVEL_LABELS),
    gamesPlayed: int(o.gamesPlayed, `${where}.gamesPlayed`, 0, 100000),
    wins: int(o.wins, `${where}.wins`, 0, 100000),
    losses: int(o.losses, `${where}.losses`, 0, 100000),
    draws: int(o.draws, `${where}.draws`, 0, 100000),
    unfinishedGames: int(o.unfinishedGames, `${where}.unfinishedGames`, 0, 100000),
    hintsUsed: int(o.hintsUsed, `${where}.hintsUsed`, 0, 100000),
    unlockedOpponents: idList(o.unlockedOpponents, `${where}.unlockedOpponents`, CHESS_OPPONENTS),
    conceptsSeen: idList(o.conceptsSeen, `${where}.conceptsSeen`, CONCEPT_IDS),
    lastOpponentId: oneOfOrNull(o.lastOpponentId, `${where}.lastOpponentId`, CHESS_OPPONENTS),
    history: list(o.history, `${where}.history`).map((e, i) => parseHistoryEntry(e, `${where}.history[${i}]`, nowMs)),
    progressionLog: list(o.progressionLog, `${where}.progressionLog`).map((e, i) => parseLogEntry(e, `${where}.progressionLog[${i}]`, nowMs)),
  };
}

const GAME_KEYS = [
  "kind", "child", "gameId", "seq", "startedAt", "endedAt", "opponentId", "levelBefore", "levelAfter", "result", "endReason", "judged",
  "movesPlayed", "activeSeconds", "nudgesShown", "nudgesFollowed", "nudgesKept", "nudges", "materialBalance", "levelReason", "profile",
] as const;

function parseGame(o0: unknown, nowMs: number): ChessGameRecord {
  const o = closed(o0, "body", GAME_KEYS);
  const child = isChildId(o.child) ? (o.child as ChildId) : fail("body.child must be santiago or isabel");
  const gameId = gameIdOrNull(o.gameId, "body.gameId") ?? fail("body.gameId is required");
  const result = oneOf(o.result, "body.result", CHESS_RESULTS);
  const endReason = oneOf(o.endReason, "body.endReason", CHESS_END_REASONS);
  const judged = o.judged === null ? null : oneOf(o.judged, "body.judged", ["win", "none"] as const);
  if ((result === "unfinished") !== (judged !== null)) fail("body.judged is required exactly for an unfinished game");
  const unfinishedReasons: ChessEndReason[] = ["time-out", "new-game", "page-left"];
  if ((result === "unfinished") !== unfinishedReasons.includes(endReason)) fail("body.endReason does not fit the result");
  if (result === "opponent-resigned" && endReason !== "resignation") fail("body.endReason does not fit the result");
  if (!Array.isArray(o.nudges) || o.nudges.length > CHESS_MAX_NUDGES) fail(`body.nudges must be a list of at most ${CHESS_MAX_NUDGES}`);
  const nudges = (o.nudges as unknown[]).map((n, i) => {
    const x = closed(n, `body.nudges[${i}]`, ["threat", "choice"]);
    return { threat: oneOf(x.threat, `body.nudges[${i}].threat`, CHESS_NUDGE_THREATS), choice: oneOf(x.choice, `body.nudges[${i}].choice`, CHESS_NUDGE_CHOICES) };
  });
  const nudgesShown = int(o.nudgesShown, "body.nudgesShown", 0, CHESS_MAX_NUDGES);
  const nudgesFollowed = int(o.nudgesFollowed, "body.nudgesFollowed", 0, CHESS_MAX_NUDGES);
  const nudgesKept = int(o.nudgesKept, "body.nudgesKept", 0, CHESS_MAX_NUDGES);
  if (nudges.length !== nudgesShown || nudges.filter((n) => n.choice === "followed").length !== nudgesFollowed || nudges.filter((n) => n.choice === "kept").length !== nudgesKept) {
    fail("body.nudges does not match the nudge counts");
  }
  return {
    kind: "game",
    child,
    gameId,
    seq: int(o.seq, "body.seq", 1, 1_000_000),
    startedAt: isoOrNull(o.startedAt, "body.startedAt", nowMs),
    endedAt: isoOrNull(o.endedAt, "body.endedAt", nowMs),
    opponentId: oneOf(o.opponentId, "body.opponentId", CHESS_OPPONENTS),
    levelBefore: int(o.levelBefore, "body.levelBefore", 0, CHESS_MAX_LEVEL),
    levelAfter: int(o.levelAfter, "body.levelAfter", 0, CHESS_MAX_LEVEL),
    result,
    endReason,
    judged,
    movesPlayed: int(o.movesPlayed, "body.movesPlayed", 0, 1000),
    activeSeconds: int(o.activeSeconds, "body.activeSeconds", 0, 6 * 3600),
    nudgesShown,
    nudgesFollowed,
    nudgesKept,
    nudges,
    materialBalance: int(o.materialBalance, "body.materialBalance", -100, 100),
    levelReason: oneOf(o.levelReason, "body.levelReason", CHESS_REASON_KEYS),
    profile: parseProfile(o.profile, "body.profile", nowMs),
  };
}

function parseImport(o0: unknown, nowMs: number): ChessImportRecord {
  const o = closed(o0, "body", ["kind", "child", "source", "profile"]);
  const child = isChildId(o.child) ? (o.child as ChildId) : fail("body.child must be santiago or isabel");
  oneOf(o.source, "body.source", [CHESS_IMPORT_SOURCE] as const);
  return { kind: "import", child, source: CHESS_IMPORT_SOURCE, profile: parseProfile(o.profile, "body.profile", nowMs) };
}

/** The one gate for a report body (raw text): size, JSON, closed shape, bounds. */
export function parseChessRecordBody(raw: string, nowMs: number): Parsed<ChessRecordBody> {
  if (raw.length > CHESS_RECORD_MAX_BYTES) return { ok: false, error: "Body too large" };
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Body must be JSON" };
  }
  try {
    if (!isObj(body)) fail("body must be an object");
    const kind = (body as Record<string, unknown>).kind;
    if (kind === "game") return { ok: true, value: parseGame(body, nowMs) };
    if (kind === "import") return { ok: true, value: parseImport(body, nowMs) };
    return fail("body.kind must be game or import");
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message };
    throw e;
  }
}

// ---- rate limit (per child and server instance; a brake on a runaway page, not a quota) ---------------------------------
export const CHESS_RECORD_LIMIT = 40;
export const CHESS_RECORD_WINDOW_MS = 60_000;
export function createChessRecordLimiter(limit = CHESS_RECORD_LIMIT, windowMs = CHESS_RECORD_WINDOW_MS) {
  const windows = new Map<string, number[]>();
  return (child: string, nowMs: number): boolean => {
    const recent = (windows.get(child) ?? []).filter((t) => nowMs - t < windowMs);
    if (recent.length >= limit) {
      windows.set(child, recent);
      return false;
    }
    recent.push(nowMs);
    windows.set(child, recent);
    return true;
  };
}

// ---- parent view (English) ------------------------------------------------------------------------------------------------
export type ChessGameRow = Omit<ChessGameRecord, "kind" | "child" | "profile"> & { child: ChildId; updatedAt: string; firstReceivedAt: string };
export type ChessChildView = {
  child: ChildId;
  /** From the latest stored profile snapshot (a game's, else the import's); null when the coach never reported. */
  current: { level: number; label: string; opponentId: ChessOpponentId; opponentName: string; gamesPlayed: number; wins: number; losses: number; draws: number; unfinishedGames: number; asOf: string } | null;
  games: ChessGameRow[];
  imported: { receivedAt: string; history: ChessHistoryEntry[]; progressionLog: ChessLogEntry[] } | null;
};

export function chessChildView(child: ChildId, games: ChessGameRow[], latestProfile: { profile: ChessProfileSnapshot; at: string } | null, imported: { receivedAt: string; profile: ChessProfileSnapshot } | null): ChessChildView {
  const source = latestProfile ?? (imported ? { profile: imported.profile, at: imported.receivedAt } : null);
  const current = source
    ? {
        level: source.profile.level,
        label: source.profile.label,
        opponentId: chessOpponentForLevel(source.profile.level),
        opponentName: CHESS_OPPONENT_NAMES[chessOpponentForLevel(source.profile.level)],
        gamesPlayed: source.profile.gamesPlayed,
        wins: source.profile.wins,
        losses: source.profile.losses,
        draws: source.profile.draws,
        unfinishedGames: source.profile.unfinishedGames,
        asOf: source.at,
      }
    : null;
  return {
    child,
    current,
    games,
    imported: imported ? { receivedAt: imported.receivedAt, history: imported.profile.history, progressionLog: imported.profile.progressionLog } : null,
  };
}

/** One-line English labels the parent page uses. */
export function chessResultLabel(result: ChessResult | null, endReason: ChessEndReason | null | undefined, judged?: "win" | "none" | null, opponentId?: ChessOpponentId | null): string {
  const who = opponentId ? CHESS_OPPONENT_NAMES[opponentId].split(" ")[0] : "The opponent";
  switch (result) {
    case "win":
      return endReason === "stalemate" ? "Won" : "Won (checkmate)";
    case "loss":
      return "Lost (checkmate)";
    case "draw":
      return endReason === "fifty-move" ? "Draw (50-move rule)" : endReason === "stalemate" ? "Draw (stalemate)" : "Draw";
    case "opponent-resigned":
      return `Won (${who} gave up)`;
    case "unfinished": {
      const how = endReason === "time-out" ? "time ran out" : endReason === "new-game" ? "new game started" : endReason === "page-left" ? "page left" : "not finished";
      return `Unfinished (${how})${judged === "win" ? ", clearly ahead: counts as a win" : judged === "none" ? ", not clearly ahead" : ""}`;
    }
    default:
      return "Unknown";
  }
}

export function chessNudgeLabel(shown: number, followed: number, kept: number): string {
  if (!shown) return "no tips";
  const other = shown - followed - kept;
  const parts = [followed ? `${followed} followed` : "", kept ? `${kept} kept her move` : "", other ? `${other} other` : ""].filter(Boolean);
  return `${shown} tip${shown === 1 ? "" : "s"}: ${parts.join(", ")}`;
}

export const CHESS_REASON_LABELS: Record<ChessReasonKey, string> = {
  "win-wobbly": "won, but kept 3 flagged moves: stays",
  "win-up": "won: up one level",
  "resigned-wobbly": "opponent gave up, but 3 flagged moves kept: stays",
  "resigned-up": "opponent gave up: up one level",
  "unfinished-wobbly": "unfinished, ahead, but 3 flagged moves kept: stays",
  "unfinished-up": "unfinished but clearly ahead: up one level",
  "unfinished-even": "unfinished, not clearly ahead: no change",
  "loss-clean": "lost without kept mistakes: stays",
  "loss-down": "lost with kept mistakes: down one level",
  draw: "draw: stays",
  "parent-set": "set by a parent",
  other: "level changed",
  "already-counted": "already counted",
};
