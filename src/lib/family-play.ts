// ---------------------------------------------------------------------------
// Family-owned paid active-play policy (Family DESIGN.md "Game Studio
// entitlements", accepted 2026-10-04; GP-01..GP-10).
//
// Family owns: the price, the debit, the durable allowance (seconds), the
// single consuming lease per child, settlement of measured consumption and
// compensation. Game Studio owns measurement/enforcement evidence and game
// content; it never sees or recomputes a coin balance. Companion App is the
// presentation and credential plumbing between the two.
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
/** Games that never consume allowance (GP-01). Stable Game Studio ids. */
export const FREE_GAME_IDS: readonly string[] = ["adaptive-chess-coach"];
/** A lease without any settlement for this long is considered abandoned. */
export const LEASE_STALE_SECONDS = 10 * 60;
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
  | { kind: "free" }
  | { kind: "metered"; coins: number; seconds: number };

/** GP-01: chess is free; every other approved game is 3 coins / 15 minutes. Edit mode is always free. */
export function playPriceFor(gameId: string, mode: PlayMode = "play"): PlayPrice {
  if (mode === "edit") return { kind: "free" };
  if (FREE_GAME_IDS.includes(gameId)) return { kind: "free" };
  return { kind: "metered", coins: PLAY_BLOCK_COINS, seconds: PLAY_BLOCK_SECONDS };
}

export function isFreeGame(gameId: string): boolean {
  return FREE_GAME_IDS.includes(gameId);
}

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
  /** False for free games / edit mode: the lease exists for authorization only. */
  metered: boolean;
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

export type LeaseDecision =
  | { ok: true; replaces: string | null }
  | { ok: false; reason: "no-allowance" | "lease-held"; heldBy?: { leaseId: string; gameId: string; deviceLabel: string | null } };

/**
 * Whether a new lease may be issued. A metered lease needs remaining
 * allowance. A live lease on another device blocks issuance unless the child
 * explicitly takes over (which ends the other lease — tabs/devices never run
 * in parallel, GP-03). A stale lease is replaced silently.
 */
export function decideLeaseIssue(input: {
  price: PlayPrice;
  remainingSeconds: number;
  existing: PlayLease | null;
  takeover: boolean;
  now: Date;
}): LeaseDecision {
  const { price, remainingSeconds, existing, takeover, now } = input;
  if (price.kind === "metered" && remainingSeconds <= 0) return { ok: false, reason: "no-allowance" };
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
