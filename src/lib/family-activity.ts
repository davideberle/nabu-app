// ---------------------------------------------------------------------------
// Activity — the child's chronological "what happened when" (proposal
// "History, not another balance"; FH-08).
//
// Composes canonical completions (claims and their reviews) and redemptions
// into one list keyed by stable source ids. A claim and its approval are ONE
// item (never two apparent earnings); genuine submitted / reviewed / redeemed
// timestamps are kept apart and nothing is invented for old rows. Coin deltas
// come only from the stored snapshots (`awardedPoints`, `chargedPoints`), so
// the list can never disagree with the wallet projection. Weekly filtering is
// a view on the list and never touches the balance (FH-06).
//
// Pure and client-safe. Loaded directly by `node --test`.
// ---------------------------------------------------------------------------

import { routineDefinitions, rewardDefinitions, type CompletionRecord } from "../data/family-routines.ts";
import type { ChildId } from "./family-assistant-turn.ts";
import { PLAY_PURCHASE_REWARD_ID, type PlayPurchase } from "./family-play.ts";
import type { WalletRedemption } from "./family-wallet.ts";

export type ActivityStatus = "pending" | "approved" | "on-hold" | "try-again" | "redeemed" | "refunded";

export type ActivityItem = {
  /** Stable source-linked id, e.g. `completion:2026-W40:santiago:kumon:2` or `redemption:<uuid>`. */
  id: string;
  kind: "claim" | "redemption" | "play-purchase";
  personId: string;
  week: string;
  title: string;
  icon: string;
  status: ActivityStatus;
  statusLabel: string;
  /** Spendable coin change this item caused; null while nothing has been earned (pending/held/try-again). */
  coinDelta: number | null;
  /** Genuine timestamps; absent when the source never recorded them. */
  submittedAt: string | null;
  reviewedAt: string | null;
  redeemedAt: string | null;
  /** The latest genuine timestamp — used for ordering, never shown as "happened at". */
  sortAt: string;
  detail: string | null;
};

export type ActivityCompletion = CompletionRecord & { week: string };
export type ActivityRedemption = WalletRedemption & { id: string; createdAt: string };

const STATUS_LABEL: Record<ActivityStatus, string> = {
  pending: "Waiting for review",
  approved: "Approved",
  "on-hold": "On hold — a parent will talk to you",
  "try-again": "Needs another try",
  redeemed: "Redeemed",
  refunded: "Refunded",
};

export function activityStatusLabel(status: ActivityStatus): string {
  return STATUS_LABEL[status];
}

function completionStatus(c: CompletionRecord): ActivityStatus {
  switch (c.status) {
    case "done":
      return "approved";
    case "pending_review":
      return "pending";
    case "on_hold":
      return "on-hold";
    case "redo":
      return "try-again";
  }
}

/**
 * ISO date of the Monday of an ISO week (`2026-W35` → `2026-08-24`). Used only
 * as the ORDER position of a legacy row that recorded no timestamp; it is
 * never shown as a time of occurrence.
 */
export function weekStartIso(week: string): string {
  const match = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!match) return week;
  const year = Number(match[1]);
  const wk = Number(match[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4.getTime() - (jan4Day - 1) * 86_400_000 + (wk - 1) * 7 * 86_400_000);
  return monday.toISOString().slice(0, 10);
}

export function completionActivityId(c: ActivityCompletion): string {
  return `completion:${c.week}:${c.personId}:${c.routineId}:${c.day}`;
}

export function redemptionActivityId(id: string): string {
  return `redemption:${id}`;
}

export function completionToActivity(c: ActivityCompletion): ActivityItem {
  const routine = routineDefinitions.find((r) => r.id === c.routineId);
  const status = completionStatus(c);
  const submittedAt = c.submittedAt ?? null;
  const reviewedAt = c.reviewedAt ?? null;
  const sortAt = reviewedAt ?? submittedAt ?? weekStartIso(c.week);
  const units = (c.creditCount ?? 1) > 1 ? ` ×${c.creditCount}` : "";
  return {
    id: completionActivityId(c),
    kind: "claim",
    personId: c.personId,
    week: c.week,
    title: `${routine?.title ?? c.routineId}${units}`,
    icon: routine?.icon ?? "✅",
    status,
    statusLabel: STATUS_LABEL[status],
    coinDelta: status === "approved" && typeof c.awardedPoints === "number" ? c.awardedPoints : null,
    submittedAt,
    reviewedAt,
    redeemedAt: null,
    sortAt,
    detail: c.normalizedSummary ?? null,
  };
}

export function redemptionToActivity(r: ActivityRedemption, purchases: readonly PlayPurchase[] = []): ActivityItem {
  const isPlay = r.rewardId === PLAY_PURCHASE_REWARD_ID;
  const reward = rewardDefinitions.find((d) => d.id === r.rewardId);
  const purchase = isPlay ? purchases.find((p) => p.redemptionId === r.id) ?? null : null;
  const refunded = purchase?.state === "refunded";
  const status: ActivityStatus = refunded ? "refunded" : "redeemed";
  return {
    id: redemptionActivityId(r.id),
    kind: isPlay ? "play-purchase" : "redemption",
    personId: r.personId,
    week: r.week,
    title: isPlay ? "Game time · 15 minutes" : reward?.title ?? r.rewardId,
    icon: isPlay ? "🎮" : reward?.icon ?? "🎁",
    status,
    statusLabel: STATUS_LABEL[status],
    coinDelta: refunded ? 0 : -Math.abs(r.chargedPoints),
    submittedAt: null,
    reviewedAt: null,
    redeemedAt: r.createdAt,
    sortAt: r.createdAt,
    detail: null,
  };
}

/**
 * The composed chronology for one child, newest first. Items with no usable
 * timestamp (legacy rows) sort by their week only and are never given an
 * invented clock time.
 */
export function composeActivity(input: {
  personId: ChildId;
  completions: readonly ActivityCompletion[];
  redemptions: readonly ActivityRedemption[];
  purchases?: readonly PlayPurchase[];
}): ActivityItem[] {
  const items: ActivityItem[] = [];
  const seen = new Set<string>();
  for (const c of input.completions) {
    if (c.personId !== input.personId) continue;
    const item = completionToActivity(c);
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  for (const r of input.redemptions) {
    if (r.personId !== input.personId) continue;
    const item = redemptionToActivity(r, input.purchases ?? []);
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return items.sort((a, b) => (a.sortAt < b.sortAt ? 1 : a.sortAt > b.sortAt ? -1 : a.id < b.id ? -1 : 1));
}

export type ActivityFilter = "all" | "week";

export function filterActivity(items: readonly ActivityItem[], filter: ActivityFilter, currentWeek: string): ActivityItem[] {
  return filter === "week" ? items.filter((item) => item.week === currentWeek) : [...items];
}

/** Sum of the shown coin deltas — a display total for a filter, never the wallet. */
export function activityCoinTotal(items: readonly ActivityItem[]): number {
  return items.reduce((sum, item) => sum + (item.coinDelta ?? 0), 0);
}
