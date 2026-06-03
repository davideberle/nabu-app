"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  NabuBadge,
  NabuIconFrame,
  NabuLinkButton,
  NabuSurface,
  cn,
} from "@/components/ui/nabu";
import {
  familyMembers,
  routinesForPerson,
  categoryMeta,
  swimlaneCategories,
  dayLabels,
  currentDayIndex,
  initialCompletions,
  initialRewards,
  type CompletionRecord,
  type CompletionStatus,
  type RewardRecord,
  type RewardStatus,
  type RoutineCategory,
  type RoutineDefinition,
} from "@/data/family-routines";

// ---------------------------------------------------------------------------
// Color tokens per person
// ---------------------------------------------------------------------------

type PersonColor = "blue" | "violet" | "amber" | "green";

const colorAccent: Record<PersonColor, string> = {
  blue: "text-blue-600 dark:text-blue-400",
  violet: "text-violet-600 dark:text-violet-400",
  amber: "text-amber-600 dark:text-amber-400",
  green: "text-emerald-600 dark:text-emerald-400",
};

// ---------------------------------------------------------------------------
// Tile status styling
// ---------------------------------------------------------------------------

const statusLabel: Record<CompletionStatus, string> = {
  planned: "Planned",
  done: "Done",
  submitted: "In review",
  approved: "Approved",
  skipped: "Skipped",
  missed: "Missed",
  "needs-help": "Help",
};

const statusStyle: Record<
  CompletionStatus,
  { bg: string; text: string; border: string }
> = {
  planned: {
    bg: "bg-stone-50 dark:bg-stone-800/60",
    text: "text-secondary",
    border: "border-stone-200 dark:border-stone-700",
  },
  done: {
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    text: "text-emerald-700 dark:text-emerald-400",
    border: "border-emerald-200 dark:border-emerald-800",
  },
  submitted: {
    bg: "bg-amber-50 dark:bg-amber-950/30",
    text: "text-amber-700 dark:text-amber-400",
    border: "border-amber-200 dark:border-amber-800",
  },
  approved: {
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    text: "text-emerald-700 dark:text-emerald-400",
    border: "border-emerald-300 dark:border-emerald-700",
  },
  skipped: {
    bg: "bg-stone-50 dark:bg-stone-800/40",
    text: "text-quaternary",
    border: "border-stone-200 dark:border-stone-700",
  },
  missed: {
    bg: "bg-stone-50 dark:bg-stone-800/40",
    text: "text-quaternary",
    border: "border-stone-200 dark:border-stone-700",
  },
  "needs-help": {
    bg: "bg-violet-50 dark:bg-violet-950/30",
    text: "text-violet-700 dark:text-violet-400",
    border: "border-violet-200 dark:border-violet-800",
  },
};

const rewardStatusLabel: Record<RewardStatus, string> = {
  "not-yet": "Not yet",
  earned: "Earned",
  approved: "Approved",
  redeemed: "Redeemed",
};

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

function completionKey(routineId: string, personId: string, day: number) {
  return `${routineId}:${personId}:${day}`;
}

function rewardKey(personId: string, day: number) {
  return `${personId}:${day}`;
}

// ---------------------------------------------------------------------------
// Tile component
// ---------------------------------------------------------------------------

function TaskTile({
  routine,
  status,
  note,
  isToday,
  isScheduled,
  onTap,
}: {
  routine: RoutineDefinition;
  status: CompletionStatus | null;
  note?: string;
  isToday: boolean;
  isScheduled: boolean;
  onTap: () => void;
}) {
  if (!status) {
    // Empty slot — day not scheduled
    return (
      <button
        type="button"
        onClick={onTap}
        className={cn(
          "flex h-full min-h-[52px] w-full items-center justify-center rounded-md border border-dashed transition-colors",
          "border-stone-200 dark:border-stone-700",
          isToday
            ? "hover:border-stone-400 hover:bg-stone-50 dark:hover:border-stone-500 dark:hover:bg-stone-800/40"
            : "opacity-55 hover:opacity-100",
        )}
        aria-label={`Log ${routine.title} for an unscheduled day`}
      >
        <span className="text-[10px] text-quaternary">
          {isScheduled ? "+" : "Log"}
        </span>
      </button>
    );
  }

  const style = statusStyle[status];
  return (
    <button
      type="button"
      onClick={onTap}
      className={cn(
        "flex h-full min-h-[52px] w-full flex-col items-start justify-center gap-0.5 rounded-md border px-2.5 py-2 text-left transition-all",
        style.bg,
        style.border,
        isToday && "ring-1 ring-stone-300 dark:ring-stone-600",
        "hover:shadow-sm active:scale-[0.98]",
      )}
    >
      <span className={cn("text-[11px] font-medium leading-tight", style.text)}>
        {statusLabel[status]}
      </span>
      {note && (
        <span className="line-clamp-1 text-[10px] leading-tight text-quaternary">
          {note}
        </span>
      )}
    </button>
  );
}

function RewardTile({
  status,
  title,
  isToday,
}: {
  status: RewardStatus | null;
  title: string;
  isToday: boolean;
}) {
  if (!status) {
    return (
      <div
        className={cn(
          "flex h-full min-h-[52px] items-center justify-center rounded-md border border-dashed",
          "border-stone-200 dark:border-stone-700",
          !isToday && "opacity-40",
        )}
      />
    );
  }

  const isEarned = status === "earned" || status === "approved" || status === "redeemed";
  return (
    <div
      className={cn(
        "flex h-full min-h-[52px] flex-col items-start justify-center gap-0.5 rounded-md border px-2.5 py-2",
        isEarned
          ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/20"
          : "border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-800/40",
        isToday && "ring-1 ring-stone-300 dark:ring-stone-600",
      )}
    >
      <span
        className={cn(
          "text-[11px] font-medium leading-tight",
          isEarned
            ? "text-emerald-700 dark:text-emerald-400"
            : "text-quaternary",
        )}
      >
        {rewardStatusLabel[status]}
      </span>
      <span className="line-clamp-1 text-[10px] leading-tight text-quaternary">
        {title}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Swimlane row label
// ---------------------------------------------------------------------------

function LaneLabel({ category }: { category: RoutineCategory }) {
  const meta = categoryMeta[category];
  return (
    <div className="flex h-full min-w-[110px] max-w-[140px] items-center pr-2">
      <span className="text-xs font-semibold text-tertiary">{meta.label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main board component
// ---------------------------------------------------------------------------

export function PersonBoardClient({ personId }: { personId: string }) {
  const person = familyMembers.find((p) => p.id === personId);
  const today = currentDayIndex();

  // Local mutable state
  const [completions, setCompletions] = useState<Map<string, CompletionRecord>>(
    () => {
      const map = new Map<string, CompletionRecord>();
      for (const c of initialCompletions) {
        if (c.personId === personId) {
          map.set(completionKey(c.routineId, c.personId, c.day), c);
        }
      }
      return map;
    },
  );

  const [rewards] = useState<Map<string, RewardRecord>>(() => {
    const map = new Map<string, RewardRecord>();
    for (const r of initialRewards) {
      if (r.personId === personId) {
        map.set(rewardKey(r.personId, r.day), r);
      }
    }
    return map;
  });

  const routines = useMemo(() => routinesForPerson(personId), [personId]);

  // Grouped by category
  const laneData = useMemo(() => {
    return swimlaneCategories
      .map((cat) => ({
        category: cat,
        routines: routines
          .filter((r) => r.category === cat)
          .sort((a, b) => a.title.localeCompare(b.title)),
      }))
      .filter((lane) => lane.category === "reward" || lane.routines.length > 0);
  }, [routines]);

  // Tap handler — cycle planned → done, or create ad-hoc
  const handleTileTap = useCallback(
    (routineId: string, day: number) => {
      setCompletions((prev) => {
        const next = new Map(prev);
        const key = completionKey(routineId, personId, day);
        const existing = next.get(key);

        if (!existing) {
          // Ad-hoc: create as done
          next.set(key, {
            routineId,
            personId,
            day,
            status: "done",
            note: "Logged from board",
          });
        } else if (existing.status === "planned") {
          next.set(key, { ...existing, status: "done" });
        } else if (existing.status === "done") {
          // Toggle back to planned
          next.set(key, { ...existing, status: "planned" });
        } else if (existing.status === "submitted") {
          // Show pending — no change (visual feedback only)
        }
        return next;
      });
    },
    [personId],
  );

  if (!person) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-secondary text-primary">
        <div className="text-center">
          <p className="text-lg font-semibold">Person not found</p>
          <NabuLinkButton href="/family/dashboard" tone="secondary" size="sm" className="mt-4">
            Back to board
          </NabuLinkButton>
        </div>
      </main>
    );
  }

  const color = person.colorToken as PersonColor;

  return (
    <main className="min-h-screen overflow-x-hidden bg-secondary px-3 py-4 text-primary sm:px-5 sm:py-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 pb-12">
        {/* Header */}
        <header className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/family/dashboard"
              aria-label="Back"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-primary bg-primary text-quaternary shadow-xs transition-colors hover:text-secondary"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-quaternary">
                Weekly board
              </p>
              <h1 className={cn("truncate text-2xl font-semibold tracking-normal", colorAccent[color])}>
                {person.displayName}
              </h1>
            </div>
          </div>
          <NabuLinkButton href="/family/dashboard" tone="secondary" size="sm">
            Family overview
          </NabuLinkButton>
        </header>

        {/* Board grid */}
        <NabuSurface className="overflow-x-auto p-0">
          <div className="min-w-[600px]">
            {/* Day headers */}
            <div className="grid grid-cols-[140px_repeat(7,1fr)] border-b border-secondary">
              <div className="p-3" />
              {dayLabels.map((label, i) => (
                <div
                  key={label}
                  className={cn(
                    "flex items-center justify-center p-3 text-xs font-semibold",
                    i === today
                      ? "bg-stone-100 text-primary dark:bg-stone-800"
                      : "text-quaternary",
                  )}
                >
                  {label}
                </div>
              ))}
            </div>

            {/* Swimlanes */}
            {laneData.map((lane) => {
              if (lane.category === "reward") {
                return (
                  <div
                    key="reward"
                    className="grid grid-cols-[140px_repeat(7,1fr)] border-b border-secondary last:border-b-0"
                  >
                    <div className="flex items-center p-3">
                      <LaneLabel category="reward" />
                    </div>
                    {dayLabels.map((_, dayIdx) => {
                      const rKey = rewardKey(personId, dayIdx);
                      const reward = rewards.get(rKey);
                      return (
                        <div key={dayIdx} className="p-1.5">
                          <RewardTile
                            status={reward?.status ?? null}
                            title={reward?.title ?? ""}
                            isToday={dayIdx === today}
                          />
                        </div>
                      );
                    })}
                  </div>
                );
              }

              return lane.routines.map((routine) => (
                <div
                  key={routine.id}
                  className="grid grid-cols-[140px_repeat(7,1fr)] border-b border-secondary last:border-b-0"
                >
                  <div className="flex flex-col justify-center p-3">
                    <span className="text-[11px] font-medium text-secondary">
                      {routine.title}
                    </span>
                    <span className="text-[10px] text-quaternary">
                      {categoryMeta[routine.category].label}
                    </span>
                  </div>
                  {dayLabels.map((_, dayIdx) => {
                    const scheduled =
                      routine.days === null || routine.days.includes(dayIdx);
                    const key = completionKey(routine.id, personId, dayIdx);
                    const record = completions.get(key);

                    return (
                      <div key={dayIdx} className="p-1.5">
                        <TaskTile
                          routine={routine}
                          status={record?.status ?? (scheduled ? "planned" : null)}
                          note={record?.note}
                          isToday={dayIdx === today}
                          isScheduled={scheduled}
                          onTap={() => handleTileTap(routine.id, dayIdx)}
                        />
                      </div>
                    );
                  })}
                </div>
              ));
            })}
          </div>
        </NabuSurface>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-quaternary">
          <span className="font-medium text-tertiary">Tap to toggle:</span>
          {(["planned", "done", "submitted"] as const).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span
                className={cn(
                  "inline-block h-3 w-3 rounded-sm border",
                  statusStyle[s].bg,
                  statusStyle[s].border,
                )}
              />
              {statusLabel[s]}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm border border-dashed border-stone-300 dark:border-stone-600" />
            Empty (tap to log)
          </span>
        </div>
      </div>
    </main>
  );
}
