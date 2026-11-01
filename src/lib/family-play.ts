// ---------------------------------------------------------------------------
// Family-owned gaming-access policy (Family DESIGN.md "Selected access-policy
// changes — October 8, 2026", superseding GP-01/GP-04/GP-06 of October 4).
//
// Two budgets, one lease:
//   - PAID: the existing `game-play-15min` block (3 coins → 900 s) funds every
//     paid Studio interaction — creating, editing, plan reading/answering,
//     approving and playing — on ONE durable allowance per child.
//   - CHESS (November 1, 2026, replacing the free daily allowance): a
//     `chess-15min` block (1 coin → 900 s) from the same permanent wallet,
//     explicitly bought, on a separate durable chess allowance per child. No
//     same-day activity requirement; it funds digital chess only.
// Exactly one interactive lease per child spans chess, play and the Studio
// editor; budgets never mix.
//
// Family owns: the price, the debit, both allowances, the single consuming
// lease, settlement of measured consumption and compensation. Game Studio owns
// measurement/enforcement evidence, jobs and game content; it never sees or
// recomputes a coin balance. Companion App is presentation and credential
// plumbing between the two.
//
// Pure and client-safe: no React, no DOM, no server imports. Loaded directly by
// `node --test` (hence the explicit `.ts` extension on relative imports).
// ---------------------------------------------------------------------------

import { isChildId, type ChildId } from "./family-assistant-turn.ts";

/** Coins debited for one purchased block of shared active-play allowance. */
export const PLAY_BLOCK_COINS = 3;
/** Seconds of active play granted by one block (15 minutes). */
export const PLAY_BLOCK_SECONDS = 900;
/** Remaining-time threshold for the single warning. */
export const PLAY_WARN_SECONDS = 120;
/** One bounded finish/save grace per purchased allowance, after exhaustion. */
export const PLAY_GRACE_SECONDS = 30;
/**
 * The debit is a real row of the permanent wallet's redemption ledger with this
 * reward id, so one wallet projection, one history and the parent tools all
 * see it without a second ledger (proposal "History, not another balance").
 */
export const PLAY_PURCHASE_REWARD_ID = "game-play-15min";
/** The one game that runs on the chess allowance instead of the Studio block. Stable Game Studio id. */
export const DAILY_CHESS_GAME_ID = "adaptive-chess-coach";
/** Coins debited for one block of digital chess (November 1, 2026). */
export const CHESS_BLOCK_COINS = 1;
/** Seconds of digital chess granted by one block (15 minutes). */
export const CHESS_BLOCK_SECONDS = 900;
/** Wallet redemption reward id of a chess block: its own history label, never the Studio block's. */
export const CHESS_PURCHASE_REWARD_ID = "chess-15min";
/**
 * The durable purchased chess allowance lives in `family_chess_allowances`
 * under this key instead of a calendar date, and chess leases carry it as
 * their `budget_date`. Dated rows are the retired free daily grants: kept as
 * history, never granted or runnable again.
 */
export const PURCHASED_CHESS_BUDGET_DATE = "purchased";
/**
 * The Studio editor lease is not bound to one game: creating a game happens
 * BEFORE it has an id. The lease (and its credential) carries this sentinel
 * as its game id; it cannot collide with a Game Studio project id (UUIDs) or
 * the chess pilot, and the adapter accepts it only with scope `studio`.
 */
export const STUDIO_SCOPE_GAME_ID = "*";
/** Which allowance a lease consumes. Additive column on family_play_leases. */
export type BudgetKind = "paid" | "chess";
/**
 * Reward ids retired on October 8, 2026: no NEW redemption is accepted for
 * them whatever the stored configuration says; their history, charged
 * snapshots and parent undo stay intact. No replacement charge or threshold.
 */
export const RETIRED_REWARD_IDS: readonly string[] = ["friends", "mini-game", "movie-night", "afternoon-excursion", "proper-trip"];
export function isRetiredRewardId(value: unknown): boolean {
  return typeof value === "string" && RETIRED_REWARD_IDS.includes(value);
}
/** A lease without any settlement for this long is considered abandoned. */
export const LEASE_STALE_SECONDS = 10 * 60;
/**
 * Authority window (cross-service fence, GP-03/GP-08). Every signed status
 * read that answers "active" grants the meter an EXCLUSIVE authority window of
 * this many seconds: Family promises that no successor lease of the child
 * becomes active before the window lapses, unless the meter acknowledges the
 * predecessor's end first (its terminal report). A Family-side end of a lease
 * that holds a window takes effect at the window's end, and a successor issued
 * meanwhile is reported `pending` to the meter until then. The meter, in turn,
 * commits on a status answer only inside its own (shorter) copy of the window,
 * measured from the instant it sent the request. So an answer delivered late
 * — by any delay — can never authorize play while a successor is active.
 */
export const AUTHORITY_WINDOW_SECONDS = 2;
/** Idempotency keys are client-generated UUID-like opaque strings. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/;
/** Stable Game Studio game/project ids (same grammar as the owner adapter). */
export const GAME_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
export const LEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;

export type PlayMode = "play" | "edit";
export const PLAY_MODES: readonly PlayMode[] = ["play", "edit"];
export function isPlayMode(value: unknown): value is PlayMode {
  return typeof value === "string" && (PLAY_MODES as readonly string[]).includes(value);
}

export type PlayPrice =
  /** Digital chess: 1 coin / 15 minutes on the chess allowance. */
  | { kind: "chess"; coins: number; seconds: number }
  /** Everything else — paid play AND the Studio editor — on the 3-coin Studio allowance. */
  | { kind: "metered"; coins: number; seconds: number };

/**
 * November 1 policy: chess in Play mode runs on the chess allowance (1 coin /
 * 15 minutes); every other interaction — paid games and any Studio
 * editing/creation (`mode: "edit"`, game id `*`) — is 3 coins / 15 minutes on
 * the shared paid allowance. Nothing is unmetered.
 */
export function playPriceFor(gameId: string, mode: PlayMode = "play"): PlayPrice {
  if (mode === "play" && gameId === DAILY_CHESS_GAME_ID) return { kind: "chess", coins: CHESS_BLOCK_COINS, seconds: CHESS_BLOCK_SECONDS };
  return { kind: "metered", coins: PLAY_BLOCK_COINS, seconds: PLAY_BLOCK_SECONDS };
}

/** The budget a lease for this game/mode consumes. */
export function budgetKindFor(gameId: string, mode: PlayMode = "play"): BudgetKind {
  return playPriceFor(gameId, mode).kind === "chess" ? "chess" : "paid";
}

export function isDailyChessGame(gameId: string): boolean {
  return gameId === DAILY_CHESS_GAME_ID;
}

/** What one explicit purchase of a block for this allowance costs and grants, and its wallet reward id. */
export function blockFor(kind: BudgetKind): { coins: number; seconds: number; rewardId: string } {
  return kind === "chess"
    ? { coins: CHESS_BLOCK_COINS, seconds: CHESS_BLOCK_SECONDS, rewardId: CHESS_PURCHASE_REWARD_ID }
    : { coins: PLAY_BLOCK_COINS, seconds: PLAY_BLOCK_SECONDS, rewardId: PLAY_PURCHASE_REWARD_ID };
}

/** `YYYY-MM-DD` as produced by `todayInZurich`. */
export const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export function isValidCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !CALENDAR_DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export const WEEK_ID_PATTERN = /^\d{4}-W\d{2}$/;

/**
 * The calendar date (`YYYY-MM-DD`) a completion identity refers to: the Monday
 * of its ISO week plus its Monday-zero day. Null for a malformed week/day — a
 * malformed identity never matches today.
 */
export function occurrenceDateOf(week: string, day: number): string | null {
  if (!WEEK_ID_PATTERN.test(week) || !Number.isInteger(day) || day < 0 || day > 6) return null;
  const year = Number(week.slice(0, 4));
  const wk = Number(week.slice(6, 8));
  if (wk < 1 || wk > 53) return null;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4.getTime() - (jan4Day - 1) * 86_400_000 + (wk - 1) * 7 * 86_400_000);
  // Week 53 only exists in long years: a date that rolls into a different ISO week is not a real identity.
  const date = new Date(monday.getTime() + day * 86_400_000);
  const check = isoWeekOfUtcDate(date);
  if (check !== week) return null;
  return date.toISOString().slice(0, 10);
}

function isoWeekOfUtcDate(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNumber);
  const isoYear = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** A completion row as the eligibility rule needs it. */
export type ApprovalEvidence = {
  status: string;
  reviewedAt: string | null;
  approvalSource: string | null;
};

/**
 * Trustworthy parent approval (DA-01/PR-02): the explicit additive marker, or
 * — for rows written before the marker existed — a review timestamp, which only
 * admin-guarded code paths ever write (a child's POST always clears it). A
 * self-marked `done` without either is effort the parent never confirmed.
 */
export function isParentApproved(row: ApprovalEvidence): boolean {
  if (row.status !== "done") return false;
  if (row.approvalSource === "parent-review" || row.approvalSource === "parent-assisted") return true;
  return typeof row.reviewedAt === "string" && row.reviewedAt.length > 0;
}

/** One `family_chess_allowances` row: the purchased chess allowance, or a retired dated daily grant. */
export type ChessAllowance = {
  personId: ChildId;
  date: string;
  grantedSeconds: number;
  consumedSeconds: number;
};

export function isValidIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && IDEMPOTENCY_KEY_PATTERN.test(value);
}

export function isValidGameId(value: unknown): value is string {
  return typeof value === "string" && GAME_ID_PATTERN.test(value);
}

export function isValidLeaseId(value: unknown): value is string {
  return typeof value === "string" && LEASE_ID_PATTERN.test(value);
}

// ---------------------------------------------------------------------------
// Allowance — durable per-child seconds, shared across paid games (GP-03)
// ---------------------------------------------------------------------------

export type PlayAllowance = {
  personId: ChildId;
  grantedSeconds: number;
  consumedSeconds: number;
};

export function allowanceRemaining(allowance: Pick<PlayAllowance, "grantedSeconds" | "consumedSeconds"> | null): number {
  if (!allowance) return 0;
  return Math.max(0, allowance.grantedSeconds - allowance.consumedSeconds);
}

// ---------------------------------------------------------------------------
// Lease — exactly one consuming lease per child
// ---------------------------------------------------------------------------

export type LeaseState = "active" | "ended";

export type PlayLease = {
  id: string;
  personId: ChildId;
  gameId: string;
  mode: PlayMode;
  /** False only for legacy rows issued before October 8 (free edit/chess); every new lease is metered against one of the two budgets. */
  metered: boolean;
  /** Which allowance this lease consumes (`paid` = Studio block, `chess` = chess allowance). */
  budgetKind: BudgetKind;
  /** Chess leases: `PURCHASED_CHESS_BUDGET_DATE`, or the Zurich date of a retired free daily grant (legacy rows). Null for paid leases. */
  budgetDate: string | null;
  /** Seconds of allowance this lease may consume at most (remaining at issue). */
  budgetSeconds: number;
  /** Highest settled consumption reported by the Game Studio meter (monotonic). */
  consumedSeconds: number;
  state: LeaseState;
  issuedAt: string;
  lastSettledAt: string | null;
  endedAt: string | null;
  endReason: string | null;
  deviceLabel: string | null;
  /** The lease this one replaced (device switch / stale takeover), if any. */
  predecessorId: string | null;
  /** Seconds held back from this budget for other unresolved leases' possible reports. */
  reserveSeconds: number;
  /** Hard ceiling for this lease's total reported consumption; frozen when Family ends the lease. */
  capSeconds: number;
  /** True once the meter reported this lease's end (its reserve is released). */
  finalSettled: boolean;
  /** The ceiling that applied when the terminal report was accepted (null until then): the bound for a late terminal correction within LATE_TERMINAL_CORRECTION_SECONDS of the end. */
  fenceCapSeconds: number | null;
  /** When the meter first validated this lease with Family (null = never activated). */
  activatedAt: string | null;
  /** Meter time of the last reading that advanced consumption (the measurement watermark); null = none yet. */
  measuredAt: string | null;
  /** End of the exclusive authority window granted by the latest status read (ISO), or null if none was granted. */
  authorityUntil: string | null;
};

/**
 * Settlement is monotonic and bounded: the meter may only ever report a value
 * at least as high as the last one, and never above the lease budget. Anything
 * else is ignored rather than applied, so a replayed or regressed report can
 * neither refund nor over-consume (GP-02/GP-07).
 */
export function applySettlement(
  lease: Pick<PlayLease, "consumedSeconds" | "budgetSeconds" | "metered">,
  reportedSeconds: number,
): { consumedSeconds: number; delta: number; exhausted: boolean } {
  if (!lease.metered) return { consumedSeconds: 0, delta: 0, exhausted: false };
  const reported = Number.isFinite(reportedSeconds) ? Math.floor(reportedSeconds) : 0;
  const next = Math.min(lease.budgetSeconds, Math.max(lease.consumedSeconds, reported, 0));
  return {
    consumedSeconds: next,
    delta: next - lease.consumedSeconds,
    exhausted: next >= lease.budgetSeconds,
  };
}

/** A lease is alive when it is active and has been settled (or issued) recently. */
export function leaseIsAlive(
  lease: Pick<PlayLease, "state" | "issuedAt" | "lastSettledAt">,
  now: Date,
  staleSeconds = LEASE_STALE_SECONDS,
): boolean {
  if (lease.state !== "active") return false;
  const last = Date.parse(lease.lastSettledAt ?? lease.issuedAt);
  if (!Number.isFinite(last)) return false;
  return now.getTime() - last < staleSeconds * 1000;
}

export type LeaseRefusal = "no-allowance" | "lease-held";

export type LeaseDecision =
  | { ok: true; replaces: string | null }
  | { ok: false; reason: LeaseRefusal; heldBy?: { leaseId: string; gameId: string; deviceLabel: string | null } };

/**
 * Whether a new lease may be issued. A metered lease — chess included — needs
 * remaining allowance on its own budget. A live lease on another device blocks
 * issuance unless the child explicitly takes over (which ends the other lease
 * — tabs/devices never run in parallel, GP-03). A stale lease is replaced
 * silently.
 */
export function decideLeaseIssue(input: {
  remainingSeconds: number;
  existing: PlayLease | null;
  takeover: boolean;
  now: Date;
}): LeaseDecision {
  const { remainingSeconds, existing, takeover, now } = input;
  if (remainingSeconds <= 0) return { ok: false, reason: "no-allowance" };
  if (existing && existing.state === "active") {
    if (leaseIsAlive(existing, now) && !takeover) {
      return {
        ok: false,
        reason: "lease-held",
        heldBy: { leaseId: existing.id, gameId: existing.gameId, deviceLabel: existing.deviceLabel },
      };
    }
    return { ok: true, replaces: existing.id };
  }
  return { ok: true, replaces: null };
}

// ---------------------------------------------------------------------------
// Purchase — one atomic debit + durable grant, idempotent per child key
// ---------------------------------------------------------------------------

export type PlayPurchase = {
  id: string;
  personId: ChildId;
  /** Which allowance the block granted (`paid` for every purchase before November 1, 2026). */
  budgetKind: BudgetKind;
  idempotencyKey: string;
  redemptionId: string;
  chargedPoints: number;
  grantedSeconds: number;
  state: "committed" | "refunded";
  createdAt: string;
  refundedAt: string | null;
  refundReason: string | null;
};

export type PurchaseOutcome =
  | { ok: true; purchase: PlayPurchase; replayed: boolean; remainingSeconds: number; balance: number }
  | { ok: false; reason: "insufficient-funds"; balance: number; remainingSeconds: number }
  | { ok: false; reason: "conflict" };

// ---------------------------------------------------------------------------
// Child-facing projection of the lease clock (server numbers, never a client timer)
// ---------------------------------------------------------------------------

export type PlayPhase = "playing" | "warning" | "grace" | "exhausted" | "unmetered";

/** Per-child purchased chess allowance for Home/Games/parent tools (server numbers only). */
export type ChessStatusView = {
  grantedSeconds: number;
  consumedSeconds: number;
  remainingSeconds: number;
  price: { coins: number; seconds: number };
};

export function projectPlayPhase(input: {
  metered: boolean;
  remainingSeconds: number;
  graceRemainingSeconds: number | null;
}): PlayPhase {
  if (!input.metered) return "unmetered";
  if (input.remainingSeconds > PLAY_WARN_SECONDS) return "playing";
  if (input.remainingSeconds > 0) return "warning";
  if (input.graceRemainingSeconds !== null && input.graceRemainingSeconds > 0) return "grace";
  return "exhausted";
}

export function formatPlayClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function assertChildId(value: unknown): ChildId {
  if (!isChildId(value)) throw new Error("not a child id");
  return value;
}
