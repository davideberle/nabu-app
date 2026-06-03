"use client";

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
  initialCompletions,
  initialRewards,
  rewardDefinitions,
  dayLabels,
  currentDayIndex,
  weekSummary,
  weekPoints,
  nextRewardForPerson,
  todayStatusLabel,
  type FamilyPerson,
  type CompletionRecord,
  type RewardRecord,
  type RewardDefinition,
} from "@/data/family-routines";

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

function statusBadgeTone(label: string): BadgeTone {
  if (label === "All done") return "green";
  if (label === "Waiting for review") return "amber";
  if (label === "Rest day") return "stone";
  return "blue";
}

function progressPercent(done: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((done / total) * 100);
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
  rewards,
  today,
}: {
  person: FamilyPerson;
  completions: CompletionRecord[];
  rewards: RewardRecord[];
  today: number;
}) {
  const color = person.colorToken as PersonColor;
  const summary = weekSummary(person.id, completions);
  const todayLabel = todayStatusLabel(person.id, completions, today);
  const points = weekPoints(person.id, completions);
  const nextReward = nextRewardForPerson(person.id, points);
  const percent = nextReward
    ? rewardProgress(points, nextReward.reward.targetPoints)
    : progressPercent(summary.done, summary.total);
  const todayReward = rewards.find(
    (r) => r.personId === person.id && r.day === today,
  );

  return (
    <Link
      href={`/family/dashboard/${person.id}`}
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
                ? "ready"
                : `${nextReward.missing} pts missing`}
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
            <span>Logged this week</span>
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
            This week
          </p>
          <p className="text-sm font-semibold text-primary">
            {points} habit points
          </p>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="Done" value={summary.done} />
        <MiniStat label="Open" value={summary.planned} />
        {summary.submitted > 0 && (
          <MiniStat label="Review" value={summary.submitted} />
        )}
        {todayReward && summary.submitted === 0 && (
          <MiniStat
            label="Reward"
            value={todayReward.status === "earned" ? "Earned" : "Pending"}
          />
        )}
      </div>
    </Link>
  );
}

function MiniStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md bg-white/60 p-2 dark:bg-white/5">
      <p className="text-[10px] uppercase tracking-widest text-quaternary">
        {label}
      </p>
      <p className="text-sm font-semibold text-primary">{String(value)}</p>
    </div>
  );
}

function RewardGoalCard({
  reward,
  childCount,
}: {
  reward: RewardDefinition;
  childCount: number;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-lg border border-secondary bg-primary p-3">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-amber-50 text-xl dark:bg-amber-950/30">
        {reward.icon}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="truncate text-sm font-semibold text-primary">
            {reward.title}
          </p>
          <NabuBadge tone={reward.period === "daily" ? "blue" : reward.period === "weekly" ? "green" : "violet"}>
            {reward.period}
          </NabuBadge>
        </div>
        <p className="mt-1 text-xs leading-snug text-tertiary">
          {reward.targetPoints} pts target
          {reward.period === "daily" ? " today" : " this cycle"} · {childCount} kids
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FamilyDashboardClient() {
  const today = currentDayIndex();
  const completions = initialCompletions;
  const rewards = initialRewards;

  const children = familyMembers.filter((p) => p.role === "child");
  const parents = familyMembers.filter((p) => p.role === "parent");

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

        {/* Reward goals */}
        <NabuSurface tone="muted" className="p-4">
          <NabuSectionHeader
            title="What are we earning?"
            description="Daily privileges, weekly family time, and longer goals."
            className="mb-3"
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {rewardDefinitions.map((reward) => (
              <RewardGoalCard
                key={reward.id}
                reward={reward}
                childCount={children.length}
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
                rewards={rewards}
                today={today}
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
                rewards={rewards}
                today={today}
              />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
