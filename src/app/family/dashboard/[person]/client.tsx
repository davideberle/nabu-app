"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  NabuBadge,
  NabuLinkButton,
  NabuSectionHeader,
  NabuSurface,
  cn,
} from "@/components/ui/nabu";
import {
  familyMembers,
  routineDefinitions,
  categoryMeta,
  swimlaneCategories,
  dayLabels,
  currentDayIndex,
  rewardDefinitions,
  routineProgress,
  weekPoints,
  type CompletionRecord,
  type RoutineCategory,
  type RoutineDefinition,
  type RewardDefinition,
} from "@/data/family-routines";
import type {
  FamilyBoardConfig,
  RoutineOverride,
  RewardOverride,
  RewardRedemption,
} from "@/lib/family-db";

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

// ---------------------------------------------------------------------------
// Voice coach types
// ---------------------------------------------------------------------------

type CoachPhase = "ask" | "recording" | "typed" | "analyzing" | "follow-up" | "accepted" | "parent-review";

type CoachSession = {
  routine: RoutineDefinition;
  day: number;
  phase: CoachPhase;
  transcript: string;
  hasVoiceMemo: boolean;
  seconds: number;
  coachResponse: string;
  followUpAnswer: string;
};

type RealtimeStatus =
  | { state: "checking"; label: string }
  | { state: "ready"; label: string }
  | { state: "demo"; label: string }
  | { state: "error"; label: string };

// ---------------------------------------------------------------------------
// Deterministic voice coach analysis
// ---------------------------------------------------------------------------

function analyzeForCoach(
  text: string,
  routine: RoutineDefinition,
  hasVoiceMemo: boolean,
): { accepted: boolean; response: string; needsFollowUp: boolean } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lower = text.toLowerCase();

  if (words.length === 0 && !hasVoiceMemo) {
    return {
      accepted: false,
      response: `Tell me what you did for ${routine.title} — even one sentence is fine.`,
      needsFollowUp: false,
    };
  }

  if (words.length === 0 && hasVoiceMemo) {
    return {
      accepted: false,
      response: `I heard you, but can you say one specific thing you did? Like which piece you practiced or which exercises you finished.`,
      needsFollowUp: true,
    };
  }

  if (routine.category === "practice") {
    const hasPracticeDetail = /\b(page|piece|song|sheet|chapter|problem|exercise|minute|scale|section|level|lesson)\b/i.test(lower);
    if (!hasPracticeDetail && words.length < 8) {
      return {
        accepted: false,
        response: `What specifically did you work on? Which piece, page, or exercise?`,
        needsFollowUp: true,
      };
    }
  }

  if (routine.id.includes("physio")) {
    const hasPhysioDetail = /\b(stretch|exercise|rep|set|minute|balance|squat|lunge|plank|push|pull|leg|arm|back|core)\b/i.test(lower);
    if (!hasPhysioDetail && words.length < 8) {
      return {
        accepted: false,
        response: `Which exercises did you do? Name at least one specific one.`,
        needsFollowUp: true,
      };
    }
  }

  if (routine.category === "household" && /dinner|table/i.test(routine.title)) {
    const hasDinnerDetail = /\b(set|clear|wash|wipe|plate|glass|cutlery|serve|help|cook|chop|stir|pour)\b/i.test(lower);
    if (!hasDinnerDetail && words.length < 6) {
      return {
        accepted: false,
        response: `What part did you handle — setting, clearing, or helping cook?`,
        needsFollowUp: true,
      };
    }
  }

  if (words.length >= 4) {
    return {
      accepted: true,
      response: `Got it — nice work on ${routine.title}!`,
      needsFollowUp: false,
    };
  }

  if (/\b(did|finished|completed|done|helped|practiced|cleaned|set|cleared)\b/i.test(lower)) {
    return {
      accepted: true,
      response: `Okay, locked in. Good job.`,
      needsFollowUp: false,
    };
  }

  return {
    accepted: false,
    response: `Can you add one more detail about what you actually did?`,
    needsFollowUp: true,
  };
}

function analyzeFollowUp(
  text: string,
  _routine: RoutineDefinition,
): { accepted: boolean; response: string } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return { accepted: true, response: "Thanks — that's enough. Marked done!" };
  }
  return { accepted: false, response: "I'll send this to a parent to check." };
}

// ---------------------------------------------------------------------------
// Simple done flow for non-proof tasks
// ---------------------------------------------------------------------------

type SimpleDone = {
  routine: RoutineDefinition;
  day: number;
};

// ---------------------------------------------------------------------------
// Tile component
// ---------------------------------------------------------------------------

function TaskTile({
  routine,
  isDone,
  isToday,
  isScheduled,
  onTap,
}: {
  routine: RoutineDefinition;
  isDone: boolean;
  isToday: boolean;
  isScheduled: boolean;
  onTap: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      disabled={isDone}
      aria-label={
        isDone
          ? `${routine.title}: completed`
          : `${routine.title}: tap to mark done`
      }
      className={cn(
        "flex h-full min-h-[56px] w-full items-center justify-center rounded-md border transition-all",
        isDone
          ? "cursor-default border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
          : "border-stone-200 bg-stone-50 hover:shadow-sm active:scale-[0.98] dark:border-stone-700 dark:bg-stone-800/60",
        isToday && !isDone && "ring-1 ring-stone-300 dark:ring-stone-600",
        !isScheduled && !isDone && "border-dashed opacity-65",
      )}
    >
      {isDone ? (
        <span className="flex items-center gap-1">
          <svg className="h-5 w-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          <svg className="h-3 w-3 text-emerald-400/60" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
          </svg>
        </span>
      ) : (
        <span className="h-4 w-4 rounded-full border-2 border-stone-300 dark:border-stone-500" aria-hidden="true" />
      )}
      {!isScheduled && !isDone && (
        <span className="ml-1.5 text-[10px] text-quaternary">bonus</span>
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

// ---------------------------------------------------------------------------
// Reward wallet card
// ---------------------------------------------------------------------------

function RewardWalletCard({
  reward,
  balance,
  spent,
  redeeming,
  onRedeem,
}: {
  reward: RewardDefinition;
  balance: number;
  spent: number;
  redeeming: boolean;
  onRedeem: (rewardId: string) => void;
}) {
  const redeemedCount = spent;
  const canAfford = balance >= reward.costPoints;

  return (
    <div className={cn(
      "min-w-0 rounded-lg border p-3 transition-colors",
      redeemedCount > 0
        ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20"
        : "border-secondary bg-primary",
    )}>
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
            {redeemedCount > 0
              ? `Redeemed x${redeemedCount}`
              : canAfford
                ? "Available"
                : `${reward.costPoints - balance} more needed`}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-xs text-tertiary">
          Cost: {reward.costPoints} pts
        </span>
        <button
          type="button"
          disabled={!canAfford || redeeming}
          onClick={() => onRedeem(reward.id)}
          className={cn(
            "rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors",
            canAfford && !redeeming
              ? "bg-stone-900 text-white hover:bg-stone-800 dark:bg-white dark:text-stone-900 dark:hover:bg-stone-100"
              : "bg-stone-100 text-quaternary dark:bg-stone-800",
          )}
        >
          {redeeming ? "Redeeming…" : redeemedCount > 0 ? "Redeem again" : "Redeem"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Week nav bar
// ---------------------------------------------------------------------------

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
// Voice Coach Modal
// ---------------------------------------------------------------------------

function VoiceCoachModal({
  session,
  onUpdate,
  onClose,
  onComplete,
  onParentReview,
}: {
  session: CoachSession;
  onUpdate: (s: CoachSession) => void;
  onClose: () => void;
  onComplete: (routine: RoutineDefinition, day: number, note: string) => void;
  onParentReview: (routine: RoutineDefinition, day: number, note: string) => void;
}) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>({
    state: "checking",
    label: "Checking voice",
  });

  useEffect(() => {
    let cancelled = false;

    async function checkRealtimeSession() {
      try {
        const response = await fetch("/api/family/voice-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            personId: session.routine.assignedTo[0] ?? "child",
            routineId: session.routine.id,
            routineTitle: session.routine.title,
            day: session.day,
            date: new Date().toISOString().slice(0, 10),
          }),
        });
        const data = await response.json();
        if (cancelled) return;
        if (response.ok && data.available) {
          setRealtimeStatus({ state: "ready", label: "Realtime ready" });
        } else if (response.ok && data.reason === "demo") {
          setRealtimeStatus({ state: "demo", label: "Demo coach" });
        } else {
          setRealtimeStatus({ state: "error", label: "Voice fallback" });
        }
      } catch {
        if (!cancelled) {
          setRealtimeStatus({ state: "error", label: "Voice fallback" });
        }
      }
    }

    checkRealtimeSession();

    return () => {
      cancelled = true;
    };
  }, [session.day, session.routine.assignedTo, session.routine.id, session.routine.title]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const stopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    onUpdate({ ...session, phase: "analyzing" });

    setTimeout(() => {
      const result = analyzeForCoach(session.transcript, session.routine, true);
      if (result.accepted) {
        onUpdate({
          ...session,
          phase: "accepted",
          coachResponse: result.response,
          hasVoiceMemo: true,
        });
      } else if (result.needsFollowUp) {
        onUpdate({
          ...session,
          phase: "follow-up",
          coachResponse: result.response,
          hasVoiceMemo: true,
        });
      } else {
        onUpdate({
          ...session,
          phase: "parent-review",
          coachResponse: result.response,
          hasVoiceMemo: true,
        });
      }
    }, 600);
  }, [session, onUpdate]);

  const startRecording = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      onUpdate({ ...session, phase: "typed" });
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
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      const updated = { ...session, phase: "recording" as const, seconds: 0 };
      onUpdate(updated);
      let sec = 0;
      timerRef.current = setInterval(() => {
        sec += 1;
        if (sec >= 30) {
          stopRecording();
          return;
        }
        onUpdate({ ...updated, seconds: sec });
      }, 1000);
    } catch {
      onUpdate({ ...session, phase: "typed" });
    }
  }, [session, onUpdate, stopRecording]);

  const submitTyped = useCallback(() => {
    const result = analyzeForCoach(session.transcript, session.routine, session.hasVoiceMemo);
    if (result.accepted) {
      onUpdate({ ...session, phase: "accepted", coachResponse: result.response });
    } else if (result.needsFollowUp) {
      onUpdate({ ...session, phase: "follow-up", coachResponse: result.response });
    } else {
      onUpdate({ ...session, phase: "parent-review", coachResponse: result.response });
    }
  }, [session, onUpdate]);

  const submitFollowUp = useCallback(() => {
    const result = analyzeFollowUp(session.followUpAnswer, session.routine);
    if (result.accepted) {
      onUpdate({ ...session, phase: "accepted", coachResponse: result.response });
    } else {
      onUpdate({ ...session, phase: "parent-review", coachResponse: result.response });
    }
  }, [session, onUpdate]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4">
      <div className="w-full max-w-md rounded-lg border border-secondary bg-primary p-5 shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-widest text-quaternary">
              Voice coach
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-primary">
                {session.routine.icon} {session.routine.title} · {dayLabels[session.day]}
              </h2>
              <NabuBadge
                tone={
                  realtimeStatus.state === "ready"
                    ? "green"
                    : realtimeStatus.state === "checking"
                      ? "blue"
                      : realtimeStatus.state === "demo"
                        ? "amber"
                        : "stone"
                }
              >
                {realtimeStatus.label}
              </NabuBadge>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md border border-secondary text-quaternary hover:text-primary"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {session.phase === "ask" && (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-secondary">
              What did you do for {session.routine.title}?
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={startRecording}
                className="flex-1 rounded-md bg-stone-900 px-3 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-stone-900"
              >
                Record answer
              </button>
              <button
                type="button"
                onClick={() => onUpdate({ ...session, phase: "typed" })}
                className="rounded-md border border-secondary px-3 py-2.5 text-sm font-semibold text-secondary"
              >
                Type instead
              </button>
            </div>
          </div>
        )}

        {session.phase === "recording" && (
          <div className="mt-4 space-y-4">
            <div className="flex items-center gap-3">
              <span className="h-3 w-3 animate-pulse rounded-full bg-red-500" />
              <span className="text-sm font-semibold text-primary">
                Recording… {session.seconds}s / 30s
              </span>
            </div>
            <textarea
              value={session.transcript}
              onChange={(e) => onUpdate({ ...session, transcript: e.target.value })}
              rows={2}
              placeholder="Add typed notes while recording…"
              className="w-full resize-none rounded-md border border-secondary bg-secondary px-3 py-2 text-sm text-primary outline-none placeholder:text-quaternary focus:border-stone-400"
            />
            <button
              type="button"
              onClick={stopRecording}
              className="w-full rounded-md border-2 border-red-200 bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
            >
              Stop & submit
            </button>
          </div>
        )}

        {session.phase === "typed" && (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-secondary">
              Tell me what you did for {session.routine.title}:
            </p>
            <textarea
              value={session.transcript}
              onChange={(e) => onUpdate({ ...session, transcript: e.target.value })}
              rows={3}
              placeholder="I practiced scales for 10 minutes, then worked on the new piece…"
              className="w-full resize-none rounded-md border border-secondary bg-secondary px-3 py-2 text-sm text-primary outline-none placeholder:text-quaternary focus:border-stone-400"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-secondary px-3 py-2 text-sm font-semibold text-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitTyped}
                className="rounded-md bg-stone-900 px-3 py-2 text-sm font-semibold text-white dark:bg-white dark:text-stone-900"
              >
                Submit
              </button>
            </div>
          </div>
        )}

        {session.phase === "analyzing" && (
          <div className="mt-4 flex items-center gap-3 py-4">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-stone-600" />
            <span className="text-sm text-secondary">Checking your answer…</span>
          </div>
        )}

        {session.phase === "follow-up" && (
          <div className="mt-4 space-y-4">
            <div className="rounded-md bg-amber-50 p-3 dark:bg-amber-950/20">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                {session.coachResponse}
              </p>
            </div>
            <textarea
              value={session.followUpAnswer}
              onChange={(e) => onUpdate({ ...session, followUpAnswer: e.target.value })}
              rows={2}
              placeholder="Add the detail here…"
              className="w-full resize-none rounded-md border border-secondary bg-secondary px-3 py-2 text-sm text-primary outline-none placeholder:text-quaternary focus:border-stone-400"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-secondary px-3 py-2 text-sm font-semibold text-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitFollowUp}
                className="rounded-md bg-stone-900 px-3 py-2 text-sm font-semibold text-white dark:bg-white dark:text-stone-900"
              >
                Submit
              </button>
            </div>
          </div>
        )}

        {session.phase === "accepted" && (
          <div className="mt-4 space-y-4">
            <div className="rounded-md bg-emerald-50 p-3 dark:bg-emerald-950/20">
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                {session.coachResponse}
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                onComplete(session.routine, session.day, session.transcript || "Voice confirmed")
              }
              className="w-full rounded-md bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white"
            >
              Lock it in
            </button>
          </div>
        )}

        {session.phase === "parent-review" && (
          <div className="mt-4 space-y-4">
            <div className="rounded-md bg-stone-100 p-3 dark:bg-stone-800">
              <p className="text-sm font-medium text-secondary">
                {session.coachResponse}
              </p>
            </div>
            <p className="text-xs text-tertiary">
              A parent will review this and decide.
            </p>
            <button
              type="button"
              onClick={() =>
                onParentReview(session.routine, session.day, session.transcript || "Sent for review")
              }
              className="w-full rounded-md border border-secondary px-3 py-2.5 text-sm font-semibold text-secondary"
            >
              Send to parent
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Simple confirm modal for non-proof tasks
// ---------------------------------------------------------------------------

function SimpleConfirmModal({
  draft,
  onConfirm,
  onClose,
}: {
  draft: SimpleDone;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4">
      <div className="w-full max-w-sm rounded-lg border border-secondary bg-primary p-5 shadow-xl">
        <h2 className="text-base font-semibold text-primary">
          {draft.routine.icon} {draft.routine.title}
        </h2>
        <p className="mt-2 text-sm text-secondary">
          Mark as done for {dayLabels[draft.day]}?
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-secondary px-3 py-2 text-sm font-semibold text-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-stone-900 px-3 py-2 text-sm font-semibold text-white dark:bg-white dark:text-stone-900"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Parent Controls Panel
// ---------------------------------------------------------------------------

function ParentControlsPanel({
  personId,
  weekId,
  completions,
  redemptions,
  config,
  allRoutines,
  allRewards,
  saveStatus,
  onUndoCompletion,
  onUndoRedemption,
  onConfigChange,
}: {
  personId: string;
  weekId: string;
  completions: Map<string, CompletionRecord>;
  redemptions: RewardRedemption[];
  config: FamilyBoardConfig;
  allRoutines: RoutineDefinition[];
  allRewards: RewardDefinition[];
  saveStatus: "idle" | "saving" | "saved";
  onUndoCompletion: (routineId: string, day: number) => void;
  onUndoRedemption: (redemptionId: string) => void;
  onConfigChange: (config: FamilyBoardConfig) => void;
}) {
  const [open, setOpen] = useState(false);
  // Include all seed routines for this person (even disabled ones) for toggle display
  const allPersonRoutines = routineDefinitions.filter((r) => r.assignedTo.includes(personId));
  const personRedemptions = redemptions.filter((r) => r.personId === personId);
  const personCompletions = Array.from(completions.entries())
    .filter(([, c]) => c.personId === personId)
    .map(([key, c]) => ({ key, ...c }));

  // Group routines by category for clearer display
  const routinesByCategory = useMemo(() => {
    const groups: { category: RoutineCategory; label: string; routines: RoutineDefinition[] }[] = [];
    for (const cat of swimlaneCategories) {
      const items = allPersonRoutines.filter((r) => r.category === cat);
      if (items.length > 0) {
        groups.push({ category: cat, label: categoryMeta[cat].label, routines: items });
      }
    }
    return groups;
  }, [allPersonRoutines]);

  const updateRoutineOverride = (routineId: string, field: keyof RoutineOverride, value: number | boolean) => {
    const prev = config.routineOverrides[routineId] ?? {};
    onConfigChange({
      ...config,
      routineOverrides: {
        ...config.routineOverrides,
        [routineId]: { ...prev, [field]: value },
      },
    });
  };

  const updateRewardOverride = (rewardId: string, field: keyof RewardOverride, value: number | boolean) => {
    const prev = config.rewardOverrides[rewardId] ?? {};
    onConfigChange({
      ...config,
      rewardOverrides: {
        ...config.rewardOverrides,
        [rewardId]: { ...prev, [field]: value },
      },
    });
  };

  const isRoutineEnabled = (routineId: string) => {
    return config.routineOverrides[routineId]?.enabled !== false;
  };

  const isRewardEnabled = (rewardId: string) => {
    return config.rewardOverrides[rewardId]?.enabled !== false;
  };

  return (
    <NabuSurface tone="muted" className="p-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between"
      >
        <div className="text-left">
          <p className="text-[10px] font-medium uppercase tracking-widest text-quaternary">
            Parent controls
          </p>
          <p className="mt-0.5 text-sm font-semibold text-primary">
            Adjust routines, rewards & undo completions
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saveStatus === "saving" && (
            <span className="flex items-center gap-1 text-[11px] text-tertiary">
              <span className="h-2 w-2 animate-spin rounded-full border border-stone-300 border-t-stone-600" />
              Saving
            </span>
          )}
          {saveStatus === "saved" && (
            <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">Saved</span>
          )}
          <span className="rounded-md border border-secondary px-2 py-1 text-xs font-semibold text-quaternary">
            {open ? "Close" : "Open"}
          </span>
        </div>
      </button>

      {open && (
        <div className="mt-4 space-y-6">
          {/* Undo completions */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-quaternary">
              Undo completions this week
            </h3>
            <p className="mt-1 text-[11px] text-tertiary">
              Reverse a child completion if it was tapped by mistake.
            </p>
            {personCompletions.length === 0 ? (
              <p className="mt-2 text-xs text-tertiary">No completions to undo.</p>
            ) : (
              <div className="mt-2 space-y-1">
                {personCompletions.map((c) => {
                  const routine = routineDefinitions.find((r) => r.id === c.routineId);
                  return (
                    <div key={c.key} className="flex items-center justify-between rounded-md border border-secondary bg-primary px-3 py-2">
                      <span className="text-xs text-primary">
                        {routine?.icon} {routine?.title ?? c.routineId} · {dayLabels[c.day]}
                        {c.note ? <span className="ml-2 text-quaternary">({c.note})</span> : null}
                      </span>
                      <button
                        type="button"
                        onClick={() => onUndoCompletion(c.routineId, c.day)}
                        className="rounded px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/20"
                      >
                        Undo
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Undo redemptions */}
          {personRedemptions.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-widest text-quaternary">
                Undo redemptions this week
              </h3>
              <p className="mt-1 text-[11px] text-tertiary">
                Refund a redeemed reward and restore the points.
              </p>
              <div className="mt-2 space-y-1">
                {personRedemptions.map((r) => {
                  const reward = rewardDefinitions.find((rw) => rw.id === r.rewardId);
                  return (
                    <div key={r.id} className="flex items-center justify-between rounded-md border border-secondary bg-primary px-3 py-2">
                      <span className="text-xs text-primary">
                        {reward?.icon} {reward?.title ?? r.rewardId}
                      </span>
                      <button
                        type="button"
                        onClick={() => onUndoRedemption(r.id)}
                        className="rounded px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/20"
                      >
                        Undo
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Routine settings — grouped by category */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-quaternary">
              Routine settings
            </h3>
            <p className="mt-1 text-[11px] text-tertiary">
              Change weekly targets, point values, or disable routines. Changes apply immediately.
            </p>
            {routinesByCategory.map((group) => (
              <div key={group.category} className="mt-3">
                <p className="mb-1.5 text-[11px] font-semibold text-secondary">
                  {laneIcon[group.category]} {group.label}
                </p>
                <div className="space-y-1.5">
                  {group.routines.map((routine) => {
                    const ov = config.routineOverrides[routine.id] ?? {};
                    const enabled = isRoutineEnabled(routine.id);
                    const target = ov.weeklyTarget ?? routine.weeklyTarget;
                    const pts = ov.points ?? routine.points;
                    return (
                      <div
                        key={routine.id}
                        className={cn(
                          "rounded-md border border-secondary bg-primary px-3 py-2",
                          !enabled && "opacity-50",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm">{routine.icon}</span>
                            <span className="text-xs font-semibold text-primary">{routine.title}</span>
                          </div>
                          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-tertiary">
                            <input
                              type="checkbox"
                              checked={enabled}
                              onChange={(e) => updateRoutineOverride(routine.id, "enabled", e.target.checked)}
                              className="h-3.5 w-3.5 rounded border-stone-300 accent-stone-900 dark:accent-stone-100"
                            />
                            Active
                          </label>
                        </div>
                        {enabled && (
                          <div className="mt-2 flex flex-wrap items-center gap-4">
                            <label className="flex items-center gap-1.5 text-[11px] text-tertiary">
                              Weekly target
                              <input
                                type="number"
                                min={0}
                                max={7}
                                value={target}
                                onChange={(e) => updateRoutineOverride(routine.id, "weeklyTarget", Number(e.target.value))}
                                className="w-12 rounded border border-secondary bg-secondary px-1.5 py-0.5 text-xs text-primary"
                              />
                            </label>
                            <label className="flex items-center gap-1.5 text-[11px] text-tertiary">
                              Points per completion
                              <input
                                type="number"
                                min={0}
                                max={10}
                                value={pts}
                                onChange={(e) => updateRoutineOverride(routine.id, "points", Number(e.target.value))}
                                className="w-12 rounded border border-secondary bg-secondary px-1.5 py-0.5 text-xs text-primary"
                              />
                            </label>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Reward settings */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-quaternary">
              Reward settings
            </h3>
            <p className="mt-1 text-[11px] text-tertiary">
              Set how many points a reward needs to unlock and how much it costs to redeem.
            </p>
            <div className="mt-2 space-y-1.5">
              {rewardDefinitions.filter((r) => r.assignedTo.includes(personId)).map((reward) => {
                const ov = config.rewardOverrides[reward.id] ?? {};
                const enabled = isRewardEnabled(reward.id);
                const cost = ov.costPoints ?? reward.costPoints;
                const target = ov.targetPoints ?? reward.targetPoints;
                return (
                  <div
                    key={reward.id}
                    className={cn(
                      "rounded-md border border-secondary bg-primary px-3 py-2",
                      !enabled && "opacity-50",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{reward.icon}</span>
                        <span className="text-xs font-semibold text-primary">{reward.title}</span>
                        <NabuBadge tone={reward.period === "daily" ? "blue" : reward.period === "weekly" ? "green" : "violet"}>
                          {reward.period}
                        </NabuBadge>
                      </div>
                      <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-tertiary">
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={(e) => updateRewardOverride(reward.id, "enabled", e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-stone-300 accent-stone-900 dark:accent-stone-100"
                        />
                        Active
                      </label>
                    </div>
                    {enabled && (
                      <div className="mt-2 flex flex-wrap items-center gap-4">
                        <label className="flex items-center gap-1.5 text-[11px] text-tertiary">
                          Unlock at
                          <input
                            type="number"
                            min={1}
                            max={200}
                            value={target}
                            onChange={(e) => updateRewardOverride(reward.id, "targetPoints", Number(e.target.value))}
                            className="w-14 rounded border border-secondary bg-secondary px-1.5 py-0.5 text-xs text-primary"
                          />
                          <span className="text-quaternary">pts</span>
                        </label>
                        <label className="flex items-center gap-1.5 text-[11px] text-tertiary">
                          Redeem cost
                          <input
                            type="number"
                            min={1}
                            max={200}
                            value={cost}
                            onChange={(e) => updateRewardOverride(reward.id, "costPoints", Number(e.target.value))}
                            className="w-14 rounded border border-secondary bg-secondary px-1.5 py-0.5 text-xs text-primary"
                          />
                          <span className="text-quaternary">pts</span>
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </NabuSurface>
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

  // Board config from DB
  const [config, setConfig] = useState<FamilyBoardConfig>({
    routineOverrides: {},
    rewardOverrides: {},
  });

  // Completion state — loaded from DB
  const [completions, setCompletions] = useState<Map<string, CompletionRecord>>(
    () => new Map(),
  );
  const [loaded, setLoaded] = useState(false);

  // Redemptions from DB
  const [redemptions, setRedemptions] = useState<RewardRedemption[]>([]);

  // Modal state
  const [simpleDraft, setSimpleDraft] = useState<SimpleDone | null>(null);
  const [coachSession, setCoachSession] = useState<CoachSession | null>(null);

  // Load data from API on mount / week change
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

      const map = new Map<string, CompletionRecord>();
      for (const c of compData) {
        map.set(completionKey(c.routineId, c.personId, c.day), c);
      }
      setCompletions(map);
      setRedemptions(redData);
      setConfig(cfgData);
      setLoaded(true);
    }
    load();
    return () => { cancelled = true; };
  }, [weekNav.weekId]);

  // Resolved definitions with config overrides
  const resolvedRoutines = useMemo(() => resolveRoutinesClient(config), [config]);
  const resolvedRewards = useMemo(() => resolveRewardsClient(config), [config]);

  const routines = useMemo(() => resolvedRoutines.filter((r) => r.assignedTo.includes(personId)), [resolvedRoutines, personId]);
  const completionList = useMemo(
    () => Array.from(completions.values()),
    [completions],
  );

  // Points calculation using resolved routines (with config overrides)
  const totalEarned = useMemo(() => {
    return completionList
      .filter((c) => c.personId === personId && c.status === "done")
      .reduce((sum, c) => {
        const routine = resolvedRoutines.find((r) => r.id === c.routineId);
        return sum + (routine?.points ?? 0);
      }, 0);
  }, [completionList, personId, resolvedRoutines]);

  // Redemption counts per reward
  const redeemedCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of redemptions) {
      if (r.personId === personId) {
        counts[r.rewardId] = (counts[r.rewardId] ?? 0) + 1;
      }
    }
    return counts;
  }, [redemptions, personId]);

  const totalSpent = useMemo(() => {
    return Object.entries(redeemedCounts).reduce((sum, [rewardId, count]) => {
      const reward = resolvedRewards.find((r) => r.id === rewardId);
      return sum + (reward ? reward.costPoints * count : 0);
    }, 0);
  }, [redeemedCounts, resolvedRewards]);

  const balance = totalEarned - totalSpent;

  const rewardGoals = resolvedRewards.filter((reward) =>
    reward.assignedTo.includes(personId),
  );
  const pocketMoneyJobs = routines.filter((routine) => routine.category === "job");

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

  // Completion handlers — persist to DB
  const markDone = useCallback(
    async (routine: RoutineDefinition, day: number, note?: string) => {
      const record: CompletionRecord = {
        routineId: routine.id,
        personId,
        day,
        status: "done",
        note,
      };
      // Optimistic update
      setCompletions((prev) => {
        const next = new Map(prev);
        next.set(completionKey(routine.id, personId, day), record);
        return next;
      });
      // Persist
      await fetch("/api/family/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          week: weekNav.weekId,
          ...record,
        }),
      });
    },
    [personId, weekNav.weekId],
  );

  const handleTileTap = useCallback(
    (routine: RoutineDefinition, day: number) => {
      const key = completionKey(routine.id, personId, day);
      if (completions.has(key)) return;

      if (routine.proofMode === "voice-coach") {
        setCoachSession({
          routine,
          day,
          phase: "ask",
          transcript: "",
          hasVoiceMemo: false,
          seconds: 0,
          coachResponse: "",
          followUpAnswer: "",
        });
        return;
      }

      setSimpleDraft({ routine, day });
    },
    [completions, personId],
  );

  const [redeemingReward, setRedeemingReward] = useState<string | null>(null);

  const handleRedeem = useCallback(async (rewardId: string) => {
    if (redeemingReward) return; // prevent double-submit
    setRedeemingReward(rewardId);
    try {
      const res = await fetch("/api/family/redemptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId, rewardId, week: weekNav.weekId }),
      });
      if (!res.ok) return; // server rejected (e.g. insufficient balance)
      const redemption: RewardRedemption = await res.json();
      setRedemptions((prev) => [...prev, redemption]);
    } finally {
      setRedeemingReward(null);
    }
  }, [personId, weekNav.weekId, redeemingReward]);

  // Parent controls: undo completion
  const handleUndoCompletion = useCallback(async (routineId: string, day: number) => {
    const key = completionKey(routineId, personId, day);
    setCompletions((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    await fetch("/api/family/completions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ week: weekNav.weekId, personId, routineId, day }),
    });
  }, [personId, weekNav.weekId]);

  // Parent controls: undo redemption
  const handleUndoRedemption = useCallback(async (redemptionId: string) => {
    setRedemptions((prev) => prev.filter((r) => r.id !== redemptionId));
    await fetch("/api/family/redemptions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: redemptionId }),
    });
  }, []);

  // Parent controls: save config with status indicator
  const [configSaveStatus, setConfigSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const configSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleConfigChange = useCallback((newConfig: FamilyBoardConfig) => {
    setConfig(newConfig);
    setConfigSaveStatus("saving");
    // Debounce save
    if (configSaveTimer.current) clearTimeout(configSaveTimer.current);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    configSaveTimer.current = setTimeout(async () => {
      await fetch("/api/family/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newConfig),
      });
      setConfigSaveStatus("saved");
      savedTimer.current = setTimeout(() => setConfigSaveStatus("idle"), 2000);
    }, 500);
  }, []);

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

        {/* Loading state */}
        {!loaded && (
          <div className="flex items-center gap-3 py-8">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-stone-600" />
            <span className="text-sm text-secondary">Loading board…</span>
          </div>
        )}

        {loaded && (
          <>
            {/* Wallet */}
            {person.role === "child" && (
              <NabuSurface tone="muted" className="p-4">
                <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-quaternary">
                      Reward wallet
                    </p>
                    <h2 className="mt-0.5 text-base font-semibold text-primary">
                      {balance} pts available
                    </h2>
                    <p className="text-xs text-tertiary">
                      {totalEarned} earned · {totalSpent} spent
                    </p>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                  {rewardGoals.map((reward) => (
                    <RewardWalletCard
                      key={reward.id}
                      reward={reward}
                      balance={balance}
                      spent={redeemedCounts[reward.id] ?? 0}
                      redeeming={redeemingReward === reward.id}
                      onRedeem={handleRedeem}
                    />
                  ))}
                </div>
              </NabuSurface>
            )}

            {/* Board grid */}
            <NabuSurface className="overflow-x-auto p-0">
              <div className="min-w-[760px]">
                {/* Day headers */}
                <div className="grid grid-cols-[180px_repeat(7,1fr)] border-b border-secondary">
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
                  return lane.routines.map((routine) => {
                    const progress = routineProgress(personId, routine.id, completionList, resolvedRoutines);
                    return (
                      <div
                        key={routine.id}
                        className="grid grid-cols-[180px_repeat(7,1fr)] border-b border-secondary last:border-b-0"
                      >
                        <div className="flex flex-col justify-center p-3">
                          <div className="flex items-center gap-2">
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-stone-100 text-base dark:bg-stone-800">
                              {routine.icon}
                            </span>
                            <div className="min-w-0 space-y-1">
                              <span className="block text-xs font-semibold leading-tight text-primary">
                                {routine.title}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <div className="relative h-3.5 w-16 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700">
                                  <div
                                    className="h-full rounded-full bg-emerald-400 transition-all"
                                    style={{
                                      width: `${progress.target > 0 ? Math.round((progress.done / progress.target) * 100) : 0}%`,
                                    }}
                                  />
                                  <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-stone-700 dark:text-stone-200">
                                    {progress.done}
                                  </span>
                                </div>
                                <span className="text-[10px] font-semibold text-quaternary">
                                  / {progress.target}
                                </span>
                              </div>
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
                                isToday={dayIdx === today}
                                isScheduled={scheduled}
                                onTap={() => handleTileTap(routine, dayIdx)}
                              />
                            </div>
                          );
                        })}
                      </div>
                    );
                  });
                })}
              </div>
            </NabuSurface>

            {/* Pocket money jobs */}
            {person.role === "child" && pocketMoneyJobs.length > 0 && (
              <NabuSurface className="overflow-x-auto p-0">
                <div className="min-w-[760px]">
                  <div className="grid grid-cols-[180px_repeat(7,1fr)] border-b border-secondary">
                    <div className="flex flex-col justify-center p-3">
                      <LaneLabel category="job" />
                      <span className="mt-1 text-[10px] text-quaternary">
                        0 pts · parent approval
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
                      className="grid grid-cols-[180px_repeat(7,1fr)] border-b border-secondary last:border-b-0"
                    >
                      <div className="flex flex-col justify-center p-3">
                        <div className="flex items-center gap-2">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-emerald-50 text-base dark:bg-emerald-950/30">
                            {routine.icon}
                          </span>
                          <div className="min-w-0">
                            <span className="block text-xs font-semibold leading-tight text-primary">
                              {routine.title}
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

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-quaternary">
              <span className="font-medium text-tertiary">Legend:</span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30">
                  <svg className="h-3 w-3 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                Completed
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-flex h-3 w-3 items-center justify-center rounded-sm border border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-800/60">
                  <span className="h-1.5 w-1.5 rounded-full border border-stone-300 dark:border-stone-500" />
                </span>
                Open
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm border border-dashed border-stone-300 dark:border-stone-600" />
                Bonus day
              </span>
            </div>

            {/* Parent controls — always available at bottom */}
            <ParentControlsPanel
              personId={personId}
              weekId={weekNav.weekId}
              completions={completions}
              redemptions={redemptions}
              config={config}
              allRoutines={resolvedRoutines}
              allRewards={resolvedRewards}
              saveStatus={configSaveStatus}
              onUndoCompletion={handleUndoCompletion}
              onUndoRedemption={handleUndoRedemption}
              onConfigChange={handleConfigChange}
            />
          </>
        )}
      </div>

      {/* Simple confirm modal */}
      {simpleDraft && (
        <SimpleConfirmModal
          draft={simpleDraft}
          onConfirm={() => {
            markDone(simpleDraft.routine, simpleDraft.day);
            setSimpleDraft(null);
          }}
          onClose={() => setSimpleDraft(null)}
        />
      )}

      {/* Voice coach modal */}
      {coachSession && (
        <VoiceCoachModal
          session={coachSession}
          onUpdate={setCoachSession}
          onClose={() => setCoachSession(null)}
          onComplete={(routine, day, note) => {
            markDone(routine, day, note);
            setCoachSession(null);
          }}
          onParentReview={(routine, day, note) => {
            markDone(routine, day, `[pending review] ${note}`);
            setCoachSession(null);
          }}
        />
      )}
    </main>
  );
}
