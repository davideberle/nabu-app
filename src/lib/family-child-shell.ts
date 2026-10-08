// ---------------------------------------------------------------------------
// Family Child Shell — identity, persistence, navigation and projection
// contract for the persistent shared-iPad child shell (Assistant / Plan /
// Rewards).
//
// The selected child is UI-owned state only: it decides which projection the
// shell renders and which destination href it builds. It is never an API
// authority — the family APIs return whole-week family data and project
// client-side, and the assistant bridge token is minted server-side from its
// own allowlist (`isChildId` in the mint route), so a tampered stored/URL
// value can at worst re-open the child chooser.
//
// Pure and client-safe: no React, no DOM globals at module scope, no server
// imports. Loaded directly by `node --test` (hence the explicit `.ts`
// extensions on relative imports).
// ---------------------------------------------------------------------------

import { CHILD_IDS, isChildId, type ChildId } from "./family-assistant-turn.ts";
import {
  formatWeekId,
  getISOWeek,
  getWeekDates,
  offsetWeek,
  parseWeekId,
} from "./meals-core.ts";
import {
  routineDefinitions,
  rewardDefinitions,
  type RoutineDefinition,
  type RewardDefinition,
} from "../data/family-routines.ts";
import type { FamilyBoardConfig } from "./family-db.ts";

export type { ChildId } from "./family-assistant-turn.ts";
export { CHILD_IDS } from "./family-assistant-turn.ts";

// ---------------------------------------------------------------------------
// Child identity — strict normalization
// ---------------------------------------------------------------------------

/**
 * Strictly normalize a free-form value (URL param, storage read, prop) to a
 * child id. Exact allowlist match only — no trimming, case-folding or
 * coercion, so a crafted value can never widen into an identity claim.
 */
export function normalizeChildId(value: unknown): ChildId | null {
  return isChildId(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Selection persistence — UI-owned, strictly validated on both sides
// ---------------------------------------------------------------------------

/** localStorage key for the shell's selected child. */
export const CHILD_SHELL_STORAGE_KEY = "family-child-shell.selected-child";

/** Structural subset of Web Storage the shell needs (test-injectable). */
export type ChildShellStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The browser's localStorage, or null when unavailable (SSR, privacy mode). */
export function browserChildShellStorage(): ChildShellStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Read the persisted selection; anything but an exact child id is null. */
export function readStoredChild(storage: ChildShellStorage | null): ChildId | null {
  if (!storage) return null;
  try {
    return normalizeChildId(storage.getItem(CHILD_SHELL_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * Persist a selection. Only exact child ids are ever written; any other value
 * clears the key instead, so junk can never round-trip through storage.
 */
export function storeSelectedChild(storage: ChildShellStorage | null, value: unknown): void {
  if (!storage) return;
  try {
    const child = normalizeChildId(value);
    if (child) {
      storage.setItem(CHILD_SHELL_STORAGE_KEY, child);
    } else {
      storage.removeItem(CHILD_SHELL_STORAGE_KEY);
    }
  } catch {
    /* storage write refused — selection still lives in component state */
  }
}

// ---------------------------------------------------------------------------
// Destinations — every child surface the shell can address
// ---------------------------------------------------------------------------

export type ChildShellDestinationId =
  | "home"
  | "assistant"
  | "rewards"
  | "activity"
  | "games"
  | "learn"
  | "listen"
  | "record";

export type ChildShellDestination = {
  id: ChildShellDestinationId;
  /** Child-readable label. */
  label: string;
  /** Decorative icon beside the label (aria-hidden in the UI). */
  icon: string;
  path: string;
};

/**
 * The child surfaces (family-assistant DESIGN.md §7.5, accepted 2026-10-04;
 * simplified October 8, 2026). Home is the menu; the persistent header shows
 * only Home, the profile and the wallet — the other destinations are reached
 * from Home, never from a growing tab row. The weekly plan grid is retired:
 * `/family/plan` redirects to Activity. `/family/rewards` keeps its URL (an
 * installed shortcut may point at it) but is the one Coins surface — wallet,
 * earned, spent — not a shop.
 */
export const childShellDestinations: readonly ChildShellDestination[] = [
  { id: "home", label: "Home", icon: "🏠", path: "/family/home" },
  { id: "assistant", label: "Ask Nabu", icon: "💬", path: "/family/assistant" },
  { id: "record", label: "Record something I did", icon: "🎙️", path: "/family/assistant/record" },
  { id: "activity", label: "Activity", icon: "🗓️", path: "/family/activity" },
  { id: "rewards", label: "Coins", icon: "🪙", path: "/family/rewards" },
  { id: "learn", label: "Lernen", icon: "🧭", path: "/family/learn" },
  { id: "games", label: "Games", icon: "🎮", path: "/family/games" },
  { id: "listen", label: "Hörspiele", icon: "🎧", path: "/family/listen" },
];

/** The destinations rendered in the persistent header: Home only. */
export const childShellHeaderDestinations: readonly ChildShellDestination[] = childShellDestinations.filter((d) => d.id === "home");

/** Destinations whose URL may carry a viewed week (history filters only; nothing is gated by it). */
const WEEK_SCOPED: readonly ChildShellDestinationId[] = ["activity"];

/** Map a pathname to the shell destination it belongs to. */
export function activeShellDestination(pathname: string): ChildShellDestinationId {
  if (pathname === "/family/home" || pathname.startsWith("/family/home/")) return "home";
  if (pathname.startsWith("/family/activity")) return "activity";
  // Legacy plan URLs redirect to Activity; until they do, they belong there.
  if (pathname.startsWith("/family/plan")) return "activity";
  if (pathname.startsWith("/family/rewards")) return "rewards";
  if (pathname.startsWith("/family/learn")) return "learn";
  if (pathname.startsWith("/family/games")) return "games";
  if (pathname.startsWith("/family/listen")) return "listen";
  if (pathname.startsWith("/family/assistant/record")) return "record";
  return "assistant";
}

/** Mirrors the family API route validation (`/^\d{4}-W\d{2}$/`). */
export const WEEK_ID_PATTERN = /^\d{4}-W\d{2}$/;

/**
 * Build a destination href carrying the selected child (and, for the
 * week-scoped destinations, the viewed week). Invalid child or week values
 * are dropped rather than forwarded, so the target page falls back to its
 * chooser / current week.
 */
export function childShellDestinationHref(
  destination: ChildShellDestinationId,
  child: unknown,
  weekId?: string | null,
): string {
  const dest = childShellDestinations.find((d) => d.id === destination);
  if (!dest) return "/family/home";
  const params = new URLSearchParams();
  const childId = normalizeChildId(child);
  if (childId) params.set("child", childId);
  if (
    WEEK_SCOPED.includes(destination) &&
    typeof weekId === "string" &&
    WEEK_ID_PATTERN.test(weekId)
  ) {
    params.set("week", weekId);
  }
  const query = params.toString();
  return query ? `${dest.path}?${query}` : dest.path;
}

// ---------------------------------------------------------------------------
// Week identity — history filters only (no surface is gated by a week)
// ---------------------------------------------------------------------------

/** Server-derived week identity handed to the shell clients. */
export type ChildShellWeekInfo = {
  weekId: string;
  currentWeekId: string;
  rangeLabel: string;
  prevWeekId: string;
  nextWeekId: string;
};

/**
 * Resolve a `?week=` param to the shell's week identity, exactly like the
 * family dashboard pages do: an invalid or absent value falls back to the
 * current ISO week.
 */
export function childShellWeekInfo(
  weekParam: string | undefined,
  now: Date = new Date(),
): ChildShellWeekInfo {
  const current = getISOWeek(now);
  const parsed = weekParam ? parseWeekId(weekParam) : null;
  const active = parsed ?? current;
  const dates = getWeekDates(active.year, active.week);
  const prev = offsetWeek(active.year, active.week, -1);
  const next = offsetWeek(active.year, active.week, 1);
  return {
    weekId: formatWeekId(active.year, active.week),
    currentWeekId: formatWeekId(current.year, current.week),
    rangeLabel: `${dates[0].dayOfWeek.slice(0, 3)} ${dates[0].date.slice(5)} - ${dates[6].dayOfWeek.slice(0, 3)} ${dates[6].date.slice(5)}`,
    prevWeekId: formatWeekId(prev.year, prev.week),
    nextWeekId: formatWeekId(next.year, next.week),
  };
}

// ---------------------------------------------------------------------------
// Reward projection — the same math as the person board and the redemptions
// API, in one client-safe place
// ---------------------------------------------------------------------------

/**
 * Config-resolved routine definitions. Behaviorally identical to
 * `family-db.ts#resolveRoutines` (asserted by test) but importable from
 * client components — `family-db.ts` pulls in the libSQL client.
 */
export function resolveShellRoutines(config: FamilyBoardConfig): RoutineDefinition[] {
  return routineDefinitions
    .map((r) => {
      const ov = config.routineOverrides[r.id];
      if (!ov) return r;
      if (ov.enabled === false) return null;
      return {
        ...r,
        ...("weeklyTarget" in ov ? { weeklyTarget: ov.weeklyTarget } : {}),
        ...(ov.points !== undefined ? { points: ov.points } : {}),
      };
    })
    .filter((r): r is RoutineDefinition => r !== null);
}

/** Config-resolved reward definitions; mirror of `family-db.ts#resolveRewards`. */
export function resolveShellRewards(config: FamilyBoardConfig): RewardDefinition[] {
  return rewardDefinitions
    .map((r) => {
      const ov = config.rewardOverrides[r.id];
      if (!ov) return r;
      if (ov.enabled === false) return null;
      return {
        ...r,
        ...(ov.costPoints !== undefined ? { costPoints: ov.costPoints } : {}),
        ...(ov.targetPoints !== undefined ? { targetPoints: ov.targetPoints } : {}),
      };
    })
    .filter((r): r is RewardDefinition => r !== null);
}

// ---------------------------------------------------------------------------
// Game library seam — identity only, fail closed
// ---------------------------------------------------------------------------

/**
 * The identity a game operation may carry. Derived exclusively from the
 * shell's validated selected child — there is no constructor that accepts a
 * free-form id, so a child cannot choose a sibling id inside a game
 * operation.
 */
export type ChildGameIdentity = { readonly childId: ChildId };

/** Derive a game identity from the selected child; anything else is null. */
export function childGameIdentity(value: unknown): ChildGameIdentity | null {
  const childId = normalizeChildId(value);
  return childId ? { childId } : null;
}

export type ApprovedGameProjection = {
  /** Stable Game Studio game id. */
  gameId: string;
  title: string;
  tagline: string;
  /** Builds the launch href from a validated identity — never from a string. */
  hrefFor: (identity: ChildGameIdentity) => string;
};

/**
 * Launch href for any approved game through the guarded play surface. The
 * child comes from a validated identity, the game id from the stable Game
 * Studio id grammar; anything else falls back to the library.
 */
export function guardedPlayHref(identity: ChildGameIdentity, gameId: string, mode: "play" | "edit" = "play"): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(gameId)) return `/family/games?child=${encodeURIComponent(identity.childId)}`;
  const base = mode === "edit" ? "/family/games/edit" : "/family/games/play";
  return `${base}?game=${encodeURIComponent(gameId)}&child=${encodeURIComponent(identity.childId)}`;
}

/**
 * The chess pilot card on Games (October 8, 2026).
 *
 * The Adaptive Chess Coach is Game Studio-owned; its bundle is embedded in this
 * app and served ONLY by the credential-gated route behind the guarded play
 * surface, which issues the child's daily chess lease (15 free minutes after a
 * parent approves something the child did today). The launch href is built
 * only from a validated `ChildGameIdentity`, so a child can never hand-craft a
 * sibling id into the launch. Family owns the gate (`family-play.ts`).
 */
export const approvedGameLibrary: readonly ApprovedGameProjection[] = [
  {
    gameId: "adaptive-chess-coach",
    title: "Chess Coach ♟️",
    tagline: "Learn chess with friendly opponents who grow with you.",
    hrefFor: (identity) => guardedPlayHref(identity, "adaptive-chess-coach", "play"),
  },
];
