"use client";

import Link from "next/link";
import {
  NabuBadge,
  NabuIconFrame,
  NabuLinkButton,
  NabuSectionHeader,
  NabuStat,
  NabuSurface,
  cn,
} from "@/components/ui/nabu";
import {
  familyMembers,
  initialCompletions,
  initialRewards,
  dayLabels,
  currentDayIndex,
  weekSummary,
  todayStatusLabel,
  type FamilyPerson,
  type CompletionRecord,
  type RewardRecord,
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
  const percent = progressPercent(summary.done, summary.total);
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

      {/* Progress bar */}
      {summary.total > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-tertiary">
            <span>Week progress</span>
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
      )}

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="Done" value={summary.done} />
        <MiniStat label="Pending" value={summary.planned} />
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

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FamilyDashboardClient() {
  const today = currentDayIndex();
  const completions = initialCompletions;
  const rewards = initialRewards;

  const children = familyMembers.filter((p) => p.role === "child");
  const parents = familyMembers.filter((p) => p.role === "parent");

  const reviewCount = completions.filter(
    (c) => c.status === "submitted",
  ).length;

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
                This week
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

        {/* Summary strip */}
        <NabuSurface tone="muted" className="p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <NabuStat
              label="Today"
              value={dayLabels[today]}
              tone="blue"
            />
            <NabuStat
              label="Needs review"
              value={reviewCount.toString()}
              tone={reviewCount > 0 ? "amber" : "stone"}
            />
            <NabuStat
              label="Children"
              value={children.length.toString()}
              tone="green"
            />
            <NabuStat
              label="Family"
              value={familyMembers.length.toString()}
              tone="stone"
            />
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
