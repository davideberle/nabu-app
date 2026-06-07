"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  NabuBadge,
  NabuIconFrame,
  NabuLinkButton,
  NabuSectionHeader,
  NabuSurface,
  cn,
} from "@/components/ui/nabu";
import {
  familyMembers,
  routineDefinitions,
  rewardDefinitions,
  dayLabels,
  currentDayIndex,
  weekSummary,
  weekPoints,
  nextRewardForPerson,
  todayStatusLabel,
  type FamilyPerson,
  type CompletionRecord,
  type RoutineDefinition,
  type RewardDefinition,
} from "@/data/family-routines";
import type { FamilyBoardConfig, RewardRedemption } from "@/lib/family-db";

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

type PersonColor = "blue" | "violet" | "amber" | "green";

const colorBorder: Record<PersonColor, string> = {
  blue: "border-blue-200 dark:border-blue-800",
  violet: "border-violet-200 dark:border-violet-800",
  amber: "border-amber-200 dark:border-amber-800",
  green: "border-emerald-200 dark:border-emerald-800",
};

const colorBg: Record<PersonColor, string> = {
  blue: "bg-blue-50 dark:bg-blue-950/30",
  violet: "bg-violet-50 dark:bg-violet-950/30",
  amber: "bg-amber-50 dark:bg-amber-950/30",
  green: "bg-emerald-50 dark:bg-emerald-950/30",
};

const colorAccent: Record<PersonColor, string> = {
  blue: "text-blue-600 dark:text-blue-400",
  violet: "text-violet-600 dark:text-violet-400",
  amber: "text-amber-600 dark:text-amber-400",
  green: "text-emerald-600 dark:text-emerald-400",
};

const colorDot: Record<PersonColor, string> = {
  blue: "bg-blue-400",
  violet: "bg-violet-400",
  amber: "bg-amber-400",
  green: "bg-emerald-400",
};

type BadgeTone = "stone" | "green" | "amber" | "blue" | "violet" | "red";
type WeekNav = {
  weekId: string;
  currentWeekId: string;
  rangeLabel: string;
  prevHref: string;
  currentHref: string;
  nextHref: string;
};

function statusBadgeTone(label: string): BadgeTone {
  if (label === "All done") return "green";
  if (label === "Rest day") return "stone";
  return "amber";
}

function rewardProgress(points: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.round((points / target) * 100));
}

// ---------------------------------------------------------------------------
// Person card
// ---------------------------------------------------------------------------

function PersonCard({
  person,
  completions,
  redemptions,
  today,
  weekId,
  resolvedRoutines,
  resolvedRewards,
}: {
  person: FamilyPerson;
  completions: CompletionRecord[];
  redemptions: RewardRedemption[];
  today: number;
  weekId: string;
  resolvedRoutines: RoutineDefinition[];
  resolvedRewards: RewardDefinition[];
}) {
  const color = person.colorToken as PersonColor;
  const summary = weekSummary(person.id, completions, resolvedRoutines);
  const todayLabel = todayStatusLabel(person.id, completions, today, resolvedRoutines);
  const earned = weekPoints(person.id, completions, resolvedRoutines);
  const spent = redemptions
    .filter((r) => r.personId === person.id)
    .reduce((sum, r) => {
      const rw = resolvedRewards.find((x) => x.id === r.rewardId);
      return sum + (rw?.costPoints ?? 0);
    }, 0);
  const balance = earned - spent;
  const nextReward = nextRewardForPerson(person.id, balance, resolvedRewards);
  const percent = nextReward
    ? rewardProgress(balance, nextReward.reward.targetPoints)
    : summary.total > 0
      ? Math.round((summary.done / summary.total) * 100)
      : 0;

  return (
    <Link
      href={`/family/dashboard/${person.id}?week=${weekId}`}
      className={cn(
        "group flex min-w-0 flex-col gap-3 rounded-xl border-2 p-5 transition-all",
        "hover:-translate-y-0.5 hover:shadow-md",
        colorBorder[color],
        colorBg[color],
      )}
    >
      {/* Header */}
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={cn(
              "grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold",
              colorBg[color],
              colorAccent[color],
              "border",
              colorBorder[color],
            )}
          >
            {person.displayName.charAt(0)}
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-primary">
              {person.displayName}
            </h3>
            <p className="text-xs capitalize text-quaternary">{person.role}</p>
          </div>
        </div>
        <NabuBadge tone={statusBadgeTone(todayLabel)}>{todayLabel}</NabuBadge>
      </div>

      {/* Goal progress */}
      {person.role === "child" && nextReward ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-tertiary">
            <span className="truncate">
              {nextReward.reward.icon} {nextReward.reward.title}
            </span>
            <span className="font-medium text-secondary">
              {nextReward.missing === 0
                ? "available"
                : `${nextReward.missing} pts to go`}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700">
            <div
              className={cn("h-full rounded-full transition-all", colorDot[color])}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      ) : summary.total > 0 ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-tertiary">
            <span>This week</span>
            <span className="font-medium text-secondary">
              {summary.done}/{summary.total}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700">
            <div
              className={cn("h-full rounded-full transition-all", colorDot[color])}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      ) : null}

      {person.role === "child" && (
        <div className="rounded-md bg-white/60 px-3 py-2 dark:bg-white/5">
          <p className="text-[10px] uppercase tracking-widest text-quaternary">
            Available
          </p>
          <p className="text-sm font-semibold text-primary">
            {balance} pts
          </p>
        </div>
      )}
    </Link>
  );
}

function RewardGoalCard({
  reward,
  childProgress,
}: {
  reward: RewardDefinition;
  childProgress: { name: string; points: number }[];
}) {
  const current = Math.round(
    childProgress.reduce((sum, child) => sum + child.points, 0) /
      Math.max(1, childProgress.length),
  );
  const missing = Math.max(0, reward.targetPoints - current);
  const ready = missing === 0;

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-secondary bg-primary p-3">
      <div className="flex min-w-0 items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-amber-50 text-xl dark:bg-amber-950/30">
          {reward.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate text-sm font-semibold text-primary">
              {reward.title}
            </p>
            <NabuBadge tone={reward.period === "daily" ? "blue" : reward.period === "weekly" ? "green" : "violet"}>
              {reward.period}
            </NabuBadge>
          </div>
          <p className="mt-1 text-xs font-semibold text-secondary">
            {ready ? "Available" : `${missing} pts to go`}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 rounded-md bg-secondary p-2">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-quaternary">Cost</p>
          <p className="text-sm font-semibold text-primary">{reward.costPoints}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-quaternary">Avg balance</p>
          <p className="text-sm font-semibold text-primary">{current}</p>
        </div>
      </div>
    </div>
  );
}

function WeekNavBar({ weekNav }: { weekNav: WeekNav }) {
  const isCurrentWeek = weekNav.weekId === weekNav.currentWeekId;

  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-secondary bg-primary p-3">
      <div>
        <p className="text-[10px] font-medium uppercase tracking-widest text-quaternary">
          Week
        </p>
        <p className="text-sm font-semibold text-primary">
          {weekNav.weekId} · {weekNav.rangeLabel}
          {isCurrentWeek ? " · This week" : ""}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <NabuLinkButton href={weekNav.prevHref} tone="secondary" size="sm">
          Prev
        </NabuLinkButton>
        {!isCurrentWeek && (
          <NabuLinkButton href={weekNav.currentHref} tone="secondary" size="sm">
            This week
          </NabuLinkButton>
        )}
        <NabuLinkButton href={weekNav.nextHref} tone="secondary" size="sm">
          Next
        </NabuLinkButton>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Resolve routines/rewards with config overrides (client-side mirror)
// ---------------------------------------------------------------------------

function resolveRoutinesClient(config: FamilyBoardConfig): RoutineDefinition[] {
  return routineDefinitions
    .map((r) => {
      const ov = config.routineOverrides[r.id];
      if (!ov) return r;
      if (ov.enabled === false) return null;
      return {
        ...r,
        ...(ov.weeklyTarget !== undefined ? { weeklyTarget: ov.weeklyTarget } : {}),
        ...(ov.points !== undefined ? { points: ov.points } : {}),
      };
    })
    .filter((r): r is RoutineDefinition => r !== null);
}

function resolveRewardsClient(config: FamilyBoardConfig): RewardDefinition[] {
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

export function FamilyDashboardClient({ weekNav }: { weekNav: WeekNav }) {
  const today = currentDayIndex();
  const [completions, setCompletions] = useState<CompletionRecord[]>([]);
  const [redemptions, setRedemptions] = useState<RewardRedemption[]>([]);
  const [config, setConfig] = useState<FamilyBoardConfig>({
    routineOverrides: {},
    rewardOverrides: {},
  });
  const [loaded, setLoaded] = useState(false);

  // Load completions, redemptions, and config from DB
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [compRes, redRes, cfgRes] = await Promise.all([
        fetch(`/api/family/completions?week=${weekNav.weekId}`),
        fetch(`/api/family/redemptions?week=${weekNav.weekId}`),
        fetch("/api/family/config"),
      ]);
      if (cancelled) return;
      const compData: CompletionRecord[] = await compRes.json();
      const redData: RewardRedemption[] = await redRes.json();
      const cfgData: FamilyBoardConfig = await cfgRes.json();
      setCompletions(compData);
      setRedemptions(redData);
      setConfig(cfgData);
      setLoaded(true);
    }
    load();
    return () => { cancelled = true; };
  }, [weekNav.weekId]);

  const resolvedRoutines = useMemo(() => resolveRoutinesClient(config), [config]);
  const resolvedRewards = useMemo(() => resolveRewardsClient(config), [config]);

  const children = familyMembers.filter((p) => p.role === "child");
  const parents = familyMembers.filter((p) => p.role === "parent");

  // Per-child redemption spending
  const childSpent = useMemo(() => {
    const result: Record<string, number> = {};
    for (const child of children) {
      result[child.id] = redemptions
        .filter((r) => r.personId === child.id)
        .reduce((sum, r) => {
          const reward = resolvedRewards.find((rw) => rw.id === r.rewardId);
          return sum + (reward?.costPoints ?? 0);
        }, 0);
    }
    return result;
  }, [children, redemptions, resolvedRewards]);

  const childProgress = useMemo(
    () =>
      children.map((child) => ({
        name: child.displayName,
        points: weekPoints(child.id, completions, resolvedRoutines) - (childSpent[child.id] ?? 0),
      })),
    [children, completions, resolvedRoutines, childSpent],
  );

  return (
    <main className="min-h-screen overflow-x-hidden bg-secondary px-4 py-5 text-primary sm:px-6 sm:py-7">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-12">
        {/* Header */}
        <header className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <NabuIconFrame className="h-11 w-11 border-amber-200/70 bg-amber-50 text-xl dark:border-amber-900/50 dark:bg-amber-900/20">
              📋
            </NabuIconFrame>
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-quaternary">
                Family board
              </p>
              <h1 className="truncate text-2xl font-semibold tracking-normal text-primary sm:text-3xl">
                Family rewards
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <NabuLinkButton href="/" tone="secondary" size="sm">
              Dashboard
            </NabuLinkButton>
          </div>
        </header>

        <WeekNavBar weekNav={weekNav} />

        {/* Week day indicator */}
        <div className="flex items-center gap-1 overflow-x-auto">
          {dayLabels.map((label, i) => (
            <span
              key={label}
              className={cn(
                "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                i === today
                  ? "bg-stone-900 text-white dark:bg-white dark:text-stone-900"
                  : "text-quaternary",
              )}
            >
              {label}
            </span>
          ))}
        </div>

        {/* Loading state */}
        {!loaded && (
          <div className="flex items-center gap-3 py-8">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-stone-600" />
            <span className="text-sm text-secondary">Loading board…</span>
          </div>
        )}

        {loaded && (
          <>
            {/* Reward shop */}
            <NabuSurface tone="muted" className="p-4">
              <NabuSectionHeader
                title="Reward shop"
                description="Earn points, redeem rewards."
                className="mb-3"
              />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {resolvedRewards.map((reward) => (
                  <RewardGoalCard
                    key={reward.id}
                    reward={reward}
                    childProgress={childProgress}
                  />
                ))}
              </div>
            </NabuSurface>

            {/* Children cards */}
            <section>
              <NabuSectionHeader className="mb-3" eyebrow="Children" />
              <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                {children.map((person) => (
                  <PersonCard
                    key={person.id}
                    person={person}
                    completions={completions}
                    redemptions={redemptions}
                    today={today}
                    weekId={weekNav.weekId}
                    resolvedRoutines={resolvedRoutines}
                    resolvedRewards={resolvedRewards}
                  />
                ))}
              </div>
            </section>

            {/* Parents */}
            <section>
              <NabuSectionHeader className="mb-3" eyebrow="Parents" />
              <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                {parents.map((person) => (
                  <PersonCard
                    key={person.id}
                    person={person}
                    completions={completions}
                    redemptions={redemptions}
                    today={today}
                    weekId={weekNav.weekId}
                    resolvedRoutines={resolvedRoutines}
                    resolvedRewards={resolvedRewards}
                  />
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
