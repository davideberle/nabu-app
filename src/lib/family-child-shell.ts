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
  type CompletionRecord,
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
// Destinations — exactly three, by design
// ---------------------------------------------------------------------------

export type ChildShellDestinationId = "assistant" | "plan" | "rewards";

export type ChildShellDestination = {
  id: ChildShellDestinationId;
  /** Child-readable label rendered on the shell tab. */
  label: string;
  /** Decorative icon beside the label (aria-hidden in the UI). */
  icon: string;
  path: string;
};

/**
 * The three shell destinations. The shell renders exactly these — adding a
 * fourth is a product decision, not a code convenience
 * (`family-assistant/DESIGN.md` §7.5).
 *
 * The child-facing label of the first destination is **Home**
 * (`family-assistant/DESIGN.md` §2.1) — a product-language change only. Its
 * id stays `assistant` and its path stays `/family/assistant`, so deep links,
 * the installed PWA (`start_url`), and the manifest are untouched.
 */
export const childShellDestinations: readonly ChildShellDestination[] = [
  { id: "assistant", label: "Home", icon: "🏠", path: "/family/assistant" },
  { id: "plan", label: "Plan", icon: "📅", path: "/family/plan" },
  { id: "rewards", label: "Rewards", icon: "🏅", path: "/family/rewards" },
];

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
  if (!dest) return "/family/assistant";
  const params = new URLSearchParams();
  const childId = normalizeChildId(child);
  if (childId) params.set("child", childId);
  if (
    destination !== "assistant" &&
    typeof weekId === "string" &&
    WEEK_ID_PATTERN.test(weekId)
  ) {
    params.set("week", weekId);
  }
  const query = params.toString();
  return query ? `${dest.path}?${query}` : dest.path;
}

// ---------------------------------------------------------------------------
// Plan week navigation — the person board's WeekNav shape, scoped to the shell
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

export type ChildShellWeekNav = {
  weekId: string;
  currentWeekId: string;
  rangeLabel: string;
  prevHref: string;
  currentHref: string;
  nextHref: string;
  overviewHref: string;
};

/**
 * Week navigation for the Plan destination: identical semantics to the
 * `/family/dashboard/[person]` board, but every href stays inside the shell
 * and carries the selected child.
 */
export function buildPlanWeekNav(week: ChildShellWeekInfo, child: ChildId): ChildShellWeekNav {
  return {
    weekId: week.weekId,
    currentWeekId: week.currentWeekId,
    rangeLabel: week.rangeLabel,
    prevHref: childShellDestinationHref("plan", child, week.prevWeekId),
    currentHref: childShellDestinationHref("plan", child, week.currentWeekId),
    nextHref: childShellDestinationHref("plan", child, week.nextWeekId),
    overviewHref: `/family/dashboard?week=${week.weekId}`,
  };
}

/** Week navigation for the Rewards destination, same pattern as Plan. */
export function buildRewardsWeekNav(week: ChildShellWeekInfo, child: ChildId): ChildShellWeekNav {
  return {
    weekId: week.weekId,
    currentWeekId: week.currentWeekId,
    rangeLabel: week.rangeLabel,
    prevHref: childShellDestinationHref("rewards", child, week.prevWeekId),
    currentHref: childShellDestinationHref("rewards", child, week.currentWeekId),
    nextHref: childShellDestinationHref("rewards", child, week.nextWeekId),
    overviewHref: `/family/dashboard?week=${week.weekId}`,
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

/** Structural subset of a stored redemption the wallet math needs. */
export type ChildShellRedemption = { personId: string; rewardId: string };

export type ChildWallet = {
  earned: number;
  spent: number;
  balance: number;
  redeemedCounts: Record<string, number>;
};

/**
 * The child's wallet for one week: earned coin total from `done` completions,
 * spent total from redemptions, and the resulting balance. Same formula as
 * the person board (`[person]/client.tsx`) and the server-side balance check
 * in `POST /api/family/redemptions` — display only; the API remains the
 * enforcement point.
 */
export function computeChildWallet(
  child: ChildId,
  completions: readonly CompletionRecord[],
  redemptions: readonly ChildShellRedemption[],
  config: FamilyBoardConfig,
): ChildWallet {
  const routines = resolveShellRoutines(config);
  const rewards = resolveShellRewards(config);

  const earned = completions
    .filter((c) => c.personId === child && c.status === "done")
    .reduce((sum, c) => {
      const routine = routines.find((r) => r.id === c.routineId);
      return sum + (routine?.points ?? 0);
    }, 0);

  const redeemedCounts: Record<string, number> = {};
  for (const r of redemptions) {
    if (r.personId === child) {
      redeemedCounts[r.rewardId] = (redeemedCounts[r.rewardId] ?? 0) + 1;
    }
  }

  const spent = Object.entries(redeemedCounts).reduce((sum, [rewardId, count]) => {
    const reward = rewards.find((r) => r.id === rewardId);
    return sum + (reward ? reward.costPoints * count : 0);
  }, 0);

  return { earned, spent, balance: earned - spent, redeemedCounts };
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
  /** Stable Game Studio game id, once one exists. */
  gameId: string;
  title: string;
  tagline: string;
  /** Builds the launch href from a validated identity — never from a string. */
  hrefFor: (identity: ChildGameIdentity) => string;
};

/**
 * Parent-approved games shown on the Rewards destination.
 *
 * The Adaptive Chess Coach is the first pilot game (Game Studio-owned; the
 * runtime bundle is vendored under `public/games/adaptive-chess-coach/` because
 * Vercel cannot reach the Mac-mini Game Studio service yet — see
 * `game-studio/DESIGN.md` §"G1.1"). It launches directly (no reward gate) via a
 * child-shell page that embeds the game in a sandboxed iframe. The launch href
 * is built only from a validated `ChildGameIdentity`, so a child can never
 * hand-craft a sibling id into the launch. Family owns any later gating policy
 * (`family-assistant/DESIGN.md` §7.5.1).
 */
export const approvedGameLibrary: readonly ApprovedGameProjection[] = [
  {
    gameId: "adaptive-chess-coach",
    title: "Chess Coach ♟️",
    tagline: "Learn chess with friendly opponents who grow with you.",
    hrefFor: (identity) =>
      `/family/rewards/chess?child=${encodeURIComponent(identity.childId)}`,
  },
];
