"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  NabuBadge,
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
  rewardDefinitions,
  routineProgress,
  weekPoints,
  nextRewardForPerson,
  type CompletionRecord,
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

const doneTile = {
  bg: "bg-emerald-50 dark:bg-emerald-950/30",
  text: "text-emerald-700 dark:text-emerald-400",
  border: "border-emerald-200 dark:border-emerald-800",
};

const notDoneTile = {
  bg: "bg-stone-50 dark:bg-stone-800/60",
  text: "text-secondary",
  border: "border-stone-200 dark:border-stone-700",
};

const laneIcon: Record<RoutineCategory, string> = {
  practice: "🎼",
  "body-care": "🏃",
  household: "🍽️",
  "family-contribution": "🏠",
  job: "💶",
  reward: "🎁",
};

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

function completionKey(routineId: string, personId: string, day: number) {
  return `${routineId}:${personId}:${day}`;
}

type WeekNav = {
  weekId: string;
  currentWeekId: string;
  rangeLabel: string;
  prevHref: string;
  currentHref: string;
  nextHref: string;
  overviewHref: string;
};

type LogDraft = {
  routine: RoutineDefinition;
  day: number;
  text: string;
  hasVoiceMemo: boolean;
  seconds: number;
};

function analyzeMemo(text: string, routine: RoutineDefinition, hasVoiceMemo: boolean): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lower = text.toLowerCase();
  if (words.length === 0 && hasVoiceMemo) {
    return `Voice memo saved. Next time, add one concrete detail so we know what made ${routine.title} count.`;
  }
  if (words.length < 6) {
    return `Too vague. What exactly did you do for ${routine.title}? Add one detail next time.`;
  }
  if (/\b(help|clean|clear|practice|exercise|finish|set|read|write|cook|table|dish|plate)\b/.test(lower)) {
    return `Good detail. Nice if that really happened; make sure the quality matches the points.`;
  }
  return `Logged. I want one more specific detail next time: what changed because you did it?`;
}

// ---------------------------------------------------------------------------
// Tile component
// ---------------------------------------------------------------------------

function TaskTile({
  routine,
  isDone,
  note,
  challenge,
  isToday,
  isScheduled,
  onTap,
}: {
  routine: RoutineDefinition;
  isDone: boolean;
  note?: string;
  challenge?: string;
  isToday: boolean;
  isScheduled: boolean;
  onTap: () => void;
}) {
  const style = isDone ? doneTile : notDoneTile;
  return (
    <button
      type="button"
      onClick={onTap}
      className={cn(
        "flex h-full min-h-[64px] w-full flex-col items-start justify-center gap-0.5 rounded-md border px-2.5 py-2 text-left transition-all",
        style.bg,
        style.border,
        isToday && "ring-1 ring-stone-300 dark:ring-stone-600",
        !isScheduled && !isDone && "border-dashed opacity-65",
        "hover:shadow-sm active:scale-[0.98]",
      )}
    >
      <span className={cn("text-[11px] font-medium leading-tight", style.text)}>
        {isDone ? "Done" : "Not done"}
      </span>
      {!isDone && (
        <span className="text-[10px] font-semibold leading-tight text-quaternary">
          +{routine.points} pts
        </span>
      )}
      {isDone && (
        <span className="text-[10px] font-semibold leading-tight text-emerald-700 dark:text-emerald-400">
          +{routine.points} pts
        </span>
      )}
      {challenge && (
        <span className="line-clamp-1 text-[10px] leading-tight text-tertiary">
          {challenge}
        </span>
      )}
      {!challenge && note && (
        <span className="line-clamp-1 text-[10px] leading-tight text-quaternary">
          {note}
        </span>
      )}
      {!isScheduled && !isDone && (
        <span className="text-[10px] leading-tight text-quaternary">
          Bonus log
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Swimlane row label
// ---------------------------------------------------------------------------

function LaneLabel({ category }: { category: RoutineCategory }) {
  const meta = categoryMeta[category];
  return (
    <div className="flex h-full min-w-[110px] max-w-[140px] items-center gap-2 pr-2">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-stone-100 text-base dark:bg-stone-800">
        {laneIcon[category]}
      </span>
      <span className="text-xs font-semibold text-tertiary">{meta.label}</span>
    </div>
  );
}

function RewardGoalCard({
  reward,
  points,
}: {
  reward: (typeof rewardDefinitions)[number];
  points: number;
}) {
  const progress = Math.min(100, Math.round((points / reward.targetPoints) * 100));
  const missing = Math.max(0, reward.targetPoints - points);
  const ready = missing === 0;

  return (
    <div className="min-w-0 rounded-lg border border-secondary bg-primary p-3">
      <div className="flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-amber-50 text-2xl dark:bg-amber-950/30">
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
            {ready ? "Ready to claim" : `${missing} pts missing`}
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 rounded-md bg-secondary p-2">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-quaternary">Target</p>
          <p className="text-sm font-semibold text-primary">{reward.targetPoints}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-quaternary">Earned</p>
          <p className="text-sm font-semibold text-primary">{points}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-quaternary">Missing</p>
          <p className="text-sm font-semibold text-primary">{missing}</p>
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700">
        <div
          className="h-full rounded-full bg-amber-400 transition-all"
          style={{ width: `${progress}%` }}
        />
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
// Main board component
// ---------------------------------------------------------------------------

export function PersonBoardClient({
  personId,
  weekNav,
}: {
  personId: string;
  weekNav: WeekNav;
}) {
  const person = familyMembers.find((p) => p.id === personId);
  const today = currentDayIndex();
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
  const [logDraft, setLogDraft] = useState<LogDraft | null>(null);
  const [isRecording, setIsRecording] = useState(false);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const routines = useMemo(() => routinesForPerson(personId), [personId]);
  const completionList = useMemo(
    () => Array.from(completions.values()),
    [completions],
  );
  const points = weekPoints(personId, completionList);
  const nextReward = nextRewardForPerson(personId, points);
  const rewardGoals = rewardDefinitions.filter((reward) =>
    reward.assignedTo.includes(personId),
  );
  const pocketMoneyJobs = routines.filter((routine) => routine.category === "job");

  // Grouped by category
  const laneData = useMemo(() => {
    return swimlaneCategories
      .filter((cat) => cat !== "reward" && cat !== "job")
      .map((cat) => ({
        category: cat,
        routines: routines
          .filter((r) => r.category === cat)
          .sort((a, b) => a.title.localeCompare(b.title)),
      }))
      .filter((lane) => lane.routines.length > 0);
  }, [routines]);

  const stopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    if (!logDraft || typeof navigator === "undefined" || !navigator.mediaDevices) {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) mediaChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        setLogDraft((draft) =>
          draft ? { ...draft, hasVoiceMemo: true } : draft,
        );
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      timerRef.current = setInterval(() => {
        setLogDraft((draft) => {
          if (!draft) return draft;
          const nextSeconds = Math.min(30, draft.seconds + 1);
          if (nextSeconds >= 30) stopRecording();
          return { ...draft, seconds: nextSeconds };
        });
      }, 1000);
    } catch {
      setLogDraft((draft) =>
        draft
          ? {
              ...draft,
              text: draft.text || "Microphone unavailable, typed note instead.",
            }
          : draft,
      );
    }
  }, [logDraft, stopRecording]);

  const submitLogDraft = useCallback(() => {
    if (!logDraft) return;
    stopRecording();
    const challenge = analyzeMemo(
      logDraft.text,
      logDraft.routine,
      logDraft.hasVoiceMemo,
    );
    setCompletions((prev) => {
      const next = new Map(prev);
      next.set(completionKey(logDraft.routine.id, personId, logDraft.day), {
        routineId: logDraft.routine.id,
        personId,
        day: logDraft.day,
        status: "done",
        note: logDraft.text.trim() || (logDraft.hasVoiceMemo ? "Voice memo" : undefined),
        challenge,
      });
      return next;
    });
    setLogDraft(null);
  }, [logDraft, personId, stopRecording]);

  // Tap handler: done toggles back to not done; not-done opens the voice memo flow.
  const handleTileTap = useCallback(
    (routine: RoutineDefinition, day: number) => {
      const key = completionKey(routine.id, personId, day);
      const existing = completions.get(key);

      if (existing) {
        setCompletions((prev) => {
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
        return;
      }

      setLogDraft({
        routine,
        day,
        text: "",
        hasVoiceMemo: false,
        seconds: 0,
      });
    },
    [completions, personId],
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
              href={weekNav.overviewHref}
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
          <NabuLinkButton href={weekNav.overviewHref} tone="secondary" size="sm">
            Family overview
          </NabuLinkButton>
        </header>

        <WeekNavBar weekNav={weekNav} />

        {person.role === "child" && (
          <NabuSurface tone="muted" className="p-4">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-quaternary">
                  Reward goals
                </p>
                <h2 className="mt-0.5 text-base font-semibold text-primary">
                  {points} habit points this week
                </h2>
              </div>
              {nextReward ? (
                <NabuBadge tone={nextReward.missing === 0 ? "green" : "amber"}>
                  {nextReward.missing === 0
                    ? `${nextReward.reward.title} ready`
                    : `${nextReward.missing} pts missing`}
                </NabuBadge>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {rewardGoals.map((reward) => (
                <RewardGoalCard key={reward.id} reward={reward} points={points} />
              ))}
            </div>
          </NabuSurface>
        )}

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
              return lane.routines.map((routine) => (
                <div
                  key={routine.id}
                  className="grid grid-cols-[140px_repeat(7,1fr)] border-b border-secondary last:border-b-0"
                >
                  <div className="flex flex-col justify-center p-3">
                    <div className="flex items-center gap-2">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-stone-100 text-base dark:bg-stone-800">
                        {routine.icon}
                      </span>
                      <div className="min-w-0 space-y-1">
                        <span className="block truncate text-xs font-semibold text-primary">
                          {routine.title}
                        </span>
                        <span className="inline-flex rounded-md bg-stone-100 px-2 py-0.5 text-[11px] font-semibold text-secondary dark:bg-stone-800">
                          {(() => {
                            const progress = routineProgress(personId, routine.id, completionList);
                            return `${progress.done}/${progress.target} target · +${routine.points} pts`;
                          })()}
                        </span>
                      </div>
                    </div>
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
                          isDone={record?.status === "done"}
                          note={record?.note}
                          challenge={record?.challenge}
                          isToday={dayIdx === today}
                          isScheduled={scheduled}
                          onTap={() => handleTileTap(routine, dayIdx)}
                        />
                      </div>
                    );
                  })}
                </div>
              ));
            })}
          </div>
        </NabuSurface>

        {person.role === "child" && pocketMoneyJobs.length > 0 && (
          <NabuSurface className="overflow-x-auto p-0">
            <div className="min-w-[600px]">
              <div className="grid grid-cols-[140px_repeat(7,1fr)] border-b border-secondary">
                <div className="flex flex-col justify-center p-3">
                  <LaneLabel category="job" />
                  <span className="mt-1 text-[10px] text-quaternary">
                    Weekly pocket money
                  </span>
                </div>
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
              {pocketMoneyJobs.map((routine) => (
                <div
                  key={routine.id}
                  className="grid grid-cols-[140px_repeat(7,1fr)] border-b border-secondary last:border-b-0"
                >
                  <div className="flex flex-col justify-center p-3">
                    <div className="flex items-center gap-2">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-emerald-50 text-base dark:bg-emerald-950/30">
                        {routine.icon}
                      </span>
                      <div className="min-w-0 space-y-1">
                        <span className="block truncate text-xs font-semibold text-primary">
                          {routine.title}
                        </span>
                        <span className="inline-flex rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
                          Grocery shopping · approval
                        </span>
                      </div>
                    </div>
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
                          isDone={record?.status === "done"}
                          note={record?.note}
                          challenge={record?.challenge}
                          isToday={dayIdx === today}
                          isScheduled={scheduled}
                          onTap={() => handleTileTap(routine, dayIdx)}
                        />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </NabuSurface>
        )}

        {logDraft && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4">
            <div className="w-full max-w-md rounded-lg border border-secondary bg-primary p-4 shadow-xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-widest text-quaternary">
                    Done memo · max 30s
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-primary">
                    {logDraft.routine.title} · {dayLabels[logDraft.day]}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    stopRecording();
                    setLogDraft(null);
                  }}
                  className="grid h-8 w-8 place-items-center rounded-md border border-secondary text-quaternary hover:text-primary"
                  aria-label="Close memo"
                >
                  ×
                </button>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={isRecording ? stopRecording : startRecording}
                  className={cn(
                    "rounded-md border px-3 py-2 text-sm font-semibold transition-colors",
                    isRecording
                      ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
                      : "border-secondary bg-secondary text-secondary hover:text-primary",
                  )}
                >
                  {isRecording ? `Stop ${logDraft.seconds}s` : "Record voice"}
                </button>
                {logDraft.hasVoiceMemo && (
                  <NabuBadge tone="green">Voice memo saved</NabuBadge>
                )}
                <span className="text-xs text-quaternary">
                  {30 - logDraft.seconds}s left
                </span>
              </div>

              <label className="mt-4 block">
                <span className="text-xs font-semibold text-secondary">
                  What did you do?
                </span>
                <textarea
                  value={logDraft.text}
                  onChange={(event) =>
                    setLogDraft((draft) =>
                      draft ? { ...draft, text: event.target.value } : draft,
                    )
                  }
                  rows={4}
                  placeholder="I cleared the plates, wiped the table, and helped put glasses away."
                  className="mt-1 w-full resize-none rounded-md border border-secondary bg-secondary px-3 py-2 text-sm text-primary outline-none transition-colors placeholder:text-quaternary focus:border-stone-400"
                />
              </label>

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    stopRecording();
                    setLogDraft(null);
                  }}
                  className="rounded-md border border-secondary px-3 py-2 text-sm font-semibold text-secondary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitLogDraft}
                  className="rounded-md bg-stone-900 px-3 py-2 text-sm font-semibold text-white dark:bg-white dark:text-stone-900"
                >
                  Mark done
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-quaternary">
          <span className="font-medium text-tertiary">Tap:</span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30" />
            Done
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm border border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-800/60" />
            Not done
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm border border-dashed border-stone-300 dark:border-stone-600" />
            Bonus day
          </span>
        </div>
      </div>
    </main>
  );
}
