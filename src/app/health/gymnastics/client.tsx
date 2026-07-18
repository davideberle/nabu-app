"use client";

import { useCallback, useMemo, useState } from "react";
import {
  NabuBadge,
  NabuCard,
  NabuEmptyState,
  NabuHeader,
  NabuMain,
  NabuPageShell,
  NabuSectionHeader,
  NabuSurface,
  cn,
} from "@/components/ui/nabu";
import {
  GYMNASTICS_SESSION_KEYS,
  summarizeProgress,
  videosByMovement,
  type GymnasticsProgram,
  type GymnasticsProgressRow,
  type GymnasticsSession,
  type GymnasticsSessionKey,
  type GymnasticsWeek,
} from "@/lib/gymnastics";

type StatusMap = Record<string, { completed: boolean; completedAt: string | null }>;

function keyOf(week: number, session: GymnasticsSessionKey): string {
  return `${week}-${session}`;
}

function toRows(status: StatusMap): GymnasticsProgressRow[] {
  return Object.entries(status).map(([key, value]) => {
    const [weekStr, session] = key.split("-");
    return {
      week: Number(weekStr),
      session: session as GymnasticsSessionKey,
      completed: value.completed,
      completedAt: value.completedAt,
    };
  });
}

// ---------------------------------------------------------------------------
// Main client
// ---------------------------------------------------------------------------

export function GymnasticsClient({
  program,
  initialProgress,
  restricted,
}: {
  program: GymnasticsProgram;
  initialProgress: GymnasticsProgressRow[];
  restricted: boolean;
}) {
  const [status, setStatus] = useState<StatusMap>(() => {
    const map: StatusMap = {};
    for (const row of initialProgress) {
      map[keyOf(row.week, row.session)] = {
        completed: row.completed,
        completedAt: row.completedAt,
      };
    }
    return map;
  });

  const summary = useMemo(
    () => summarizeProgress(program, toRows(status)),
    [program, status],
  );

  const [selectedWeek, setSelectedWeek] = useState<number>(() => {
    const first = summarizeProgress(program, initialProgress).firstIncompleteWeek;
    return Math.min(first, program.durationWeeks);
  });

  const [pending, setPending] = useState<Record<string, boolean>>({});

  const toggle = useCallback(
    async (week: number, session: GymnasticsSessionKey) => {
      const k = keyOf(week, session);
      if (pending[k]) return;
      const nextCompleted = !(status[k]?.completed ?? false);

      // Optimistic update
      const previous = status[k];
      setStatus((s) => ({
        ...s,
        [k]: { completed: nextCompleted, completedAt: nextCompleted ? new Date().toISOString() : null },
      }));
      setPending((p) => ({ ...p, [k]: true }));

      try {
        const res = await fetch("/api/health/gymnastics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ week, session, completed: nextCompleted }),
        });
        if (!res.ok) throw new Error("save failed");
        const data = (await res.json()) as { record?: { completedAt: string | null } };
        setStatus((s) => ({
          ...s,
          [k]: { completed: nextCompleted, completedAt: data.record?.completedAt ?? null },
        }));
      } catch {
        // Revert on failure
        setStatus((s) => {
          const copy = { ...s };
          if (previous) copy[k] = previous;
          else delete copy[k];
          return copy;
        });
      } finally {
        setPending((p) => {
          const copy = { ...p };
          delete copy[k];
          return copy;
        });
      }
    },
    [pending, status],
  );

  if (restricted) {
    return (
      <NabuPageShell>
        <NabuHeader title="Gymnastics" eyebrow="Health" backHref="/health" icon="🤸" />
        <NabuMain className="pb-20">
          <NabuEmptyState
            icon="🔒"
            title="Access restricted"
            description="The gymnastics program is not available for this account."
          />
        </NabuMain>
      </NabuPageShell>
    );
  }

  const week = program.weeks.find((w) => w.week === selectedWeek) ?? program.weeks[0];
  const percent = Math.round((summary.completedCount / summary.totalSessions) * 100);
  const finished = summary.firstIncompleteWeek > program.durationWeeks;

  return (
    <NabuPageShell>
      <NabuHeader
        title="Gymnastics"
        eyebrow="Health"
        subtitle={program.subtitle}
        backHref="/health"
        icon="🤸"
      />

      <NabuMain className="space-y-6 pb-20">
        {/* Progress overview */}
        <NabuSurface tone="accent" className="p-4 sm:p-5">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-quaternary">
                Progress
              </p>
              <p className="mt-0.5 text-2xl font-semibold tracking-[-0.02em] text-primary">
                {summary.completedCount}
                <span className="text-base font-normal text-quaternary"> / {summary.totalSessions} sessions</span>
              </p>
            </div>
            <NabuBadge tone={finished ? "green" : "amber"}>
              {finished ? "Program complete" : `Week ${summary.firstIncompleteWeek} up next`}
            </NabuBadge>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-tertiary">{program.summary}</p>
          <p className="mt-2 text-[11px] text-quaternary">
            Two sessions a week, {program.spacingHours.min}–{program.spacingHours.max}h apart · A ={" "}
            {program.sessionLabels.A} · B = {program.sessionLabels.B}
          </p>
        </NabuSurface>

        {/* Week selector */}
        <section>
          <NabuSectionHeader className="mb-3" eyebrow={`${program.durationWeeks} weeks`} title="Pick a week" />
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {program.weeks.map((w) => {
              const done = GYMNASTICS_SESSION_KEYS.filter(
                (s) => status[keyOf(w.week, s)]?.completed,
              ).length;
              const isActive = w.week === selectedWeek;
              return (
                <button
                  key={w.week}
                  type="button"
                  onClick={() => setSelectedWeek(w.week)}
                  aria-pressed={isActive}
                  className={cn(
                    "flex shrink-0 flex-col items-center gap-1 rounded-lg border px-3 py-2 transition-colors",
                    isActive
                      ? "border-primary bg-primary text-primary shadow-xs"
                      : "border-secondary bg-secondary text-quaternary hover:text-secondary",
                  )}
                >
                  <span className="text-xs font-semibold">W{w.week}</span>
                  <span className="flex gap-0.5">
                    {GYMNASTICS_SESSION_KEYS.map((s) => (
                      <span
                        key={s}
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          status[keyOf(w.week, s)]?.completed ? "bg-emerald-400" : "bg-utility-neutral-300 dark:bg-utility-neutral-600",
                        )}
                      />
                    ))}
                  </span>
                  <span className="sr-only">{done} of 2 sessions done</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Selected week */}
        <WeekPanel
          week={week}
          status={status}
          pending={pending}
          onToggle={toggle}
        />

        {/* Warm-up */}
        <NabuSurface className="p-4">
          <NabuSectionHeader eyebrow="Every session" title={program.warmup.title} />
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {program.warmup.items.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-tertiary">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-quaternary" />
                {item}
              </li>
            ))}
          </ul>
        </NabuSurface>

        {/* Progression rule */}
        <NabuSurface tone="muted" className="p-4">
          <p className="text-[10px] uppercase tracking-[0.14em] text-quaternary">Progression rule</p>
          <p className="mt-1 text-sm leading-relaxed text-secondary">{program.progressionRule}</p>
        </NabuSurface>

        {/* M60 scaling */}
        <M60Card program={program} />

        {/* Prerequisites & safety */}
        <PrerequisitesCard program={program} />

        {/* Videos */}
        <VideosSection program={program} />
      </NabuMain>
    </NabuPageShell>
  );
}

// ---------------------------------------------------------------------------
// Week panel
// ---------------------------------------------------------------------------

function WeekPanel({
  week,
  status,
  pending,
  onToggle,
}: {
  week: GymnasticsWeek;
  status: StatusMap;
  pending: Record<string, boolean>;
  onToggle: (week: number, session: GymnasticsSessionKey) => void;
}) {
  return (
    <section>
      <NabuSectionHeader
        className="mb-3"
        eyebrow={`Week ${week.week} · ${week.phase}`}
        title={week.focus}
      />
      <div className="grid gap-3 lg:grid-cols-2">
        {GYMNASTICS_SESSION_KEYS.map((sessionKey) => (
          <SessionCard
            key={sessionKey}
            sessionKey={sessionKey}
            session={week.sessions[sessionKey]}
            completed={status[keyOf(week.week, sessionKey)]?.completed ?? false}
            completedAt={status[keyOf(week.week, sessionKey)]?.completedAt ?? null}
            pending={pending[keyOf(week.week, sessionKey)] ?? false}
            onToggle={() => onToggle(week.week, sessionKey)}
          />
        ))}
      </div>
    </section>
  );
}

function SessionCard({
  sessionKey,
  session,
  completed,
  completedAt,
  pending,
  onToggle,
}: {
  sessionKey: GymnasticsSessionKey;
  session: GymnasticsSession;
  completed: boolean;
  completedAt: string | null;
  pending: boolean;
  onToggle: () => void;
}) {
  return (
    <NabuCard className="flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.14em] text-quaternary">Session {sessionKey}</p>
          <h3 className="mt-0.5 text-sm font-semibold tracking-[-0.01em] text-primary">{session.label}</h3>
        </div>
        {completed ? <NabuBadge tone="green">Done</NabuBadge> : null}
      </div>

      <ul className="mt-3 flex-1 space-y-2">
        {session.blocks.map((block, i) => (
          <li key={`${block.movement}-${i}`} className="rounded-lg border border-secondary bg-secondary/60 p-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 text-sm font-medium text-primary">{block.movement}</span>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-tertiary">{block.prescription}</span>
            </div>
            {block.note ? <p className="mt-0.5 text-[11px] leading-snug text-quaternary">{block.note}</p> : null}
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onToggle}
        disabled={pending}
        aria-pressed={completed}
        className={cn(
          "mt-3 w-full rounded-full border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60",
          completed
            ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-300"
            : "border-primary bg-primary text-primary shadow-xs hover:bg-primary_hover",
        )}
      >
        {pending ? "Saving…" : completed ? "✓ Completed — tap to undo" : "Mark session complete"}
      </button>
      {completed && completedAt ? (
        <p className="mt-1.5 text-center text-[10px] text-quaternary">
          Completed {formatCompletedAt(completedAt)}
        </p>
      ) : null}
    </NabuCard>
  );
}

function formatCompletedAt(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "Europe/Zurich",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// M60 scaling
// ---------------------------------------------------------------------------

function M60Card({ program }: { program: GymnasticsProgram }) {
  return (
    <NabuSurface className="border-utility-blue-200 bg-utility-blue-50/50 p-4 dark:border-utility-blue-800/50 dark:bg-utility-blue-950/20">
      <NabuSectionHeader eyebrow="Scaling" title={program.m60Scaling.title} description={program.m60Scaling.intro} />
      <ul className="mt-3 space-y-2">
        {program.m60Scaling.points.map((point, i) => (
          <li key={i} className="flex items-start gap-2 text-sm leading-relaxed text-secondary">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-blue-400" />
            {point}
          </li>
        ))}
      </ul>
    </NabuSurface>
  );
}

// ---------------------------------------------------------------------------
// Prerequisites & safety
// ---------------------------------------------------------------------------

function PrerequisitesCard({ program }: { program: GymnasticsProgram }) {
  const p = program.prerequisites;
  return (
    <NabuSurface className="p-4">
      <NabuSectionHeader eyebrow="Safety" title={p.title} />
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-[10px] uppercase tracking-[0.12em] text-quaternary">Have this first</p>
          <ul className="mt-1.5 space-y-1">
            {p.mustHave.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-tertiary">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-emerald-400" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.12em] text-quaternary">Stop if you feel</p>
          <ul className="mt-1.5 space-y-1">
            {p.stopRules.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-tertiary">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-red-400" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mt-3 rounded-lg border border-secondary bg-secondary/60 p-3">
        <p className="text-[10px] uppercase tracking-[0.12em] text-quaternary">Rep caps</p>
        <p className="mt-0.5 text-sm text-secondary">
          Start near <strong className="font-semibold text-primary">{p.repCaps.initial}</strong> full dynamic reps per
          session, building toward <strong className="font-semibold text-primary">{p.repCaps.later}</strong>. {p.repCaps.note}
        </p>
      </div>
      <ul className="mt-3 space-y-1.5">
        {p.notes.map((note) => (
          <li key={note} className="text-[11px] leading-relaxed text-quaternary">
            {note}
          </li>
        ))}
      </ul>
    </NabuSurface>
  );
}

// ---------------------------------------------------------------------------
// Videos
// ---------------------------------------------------------------------------

function VideosSection({ program }: { program: GymnasticsProgram }) {
  const groups = videosByMovement(program);
  return (
    <section>
      <NabuSectionHeader className="mb-3" eyebrow="Watch" title="Movement references" />
      <div className="space-y-4">
        {groups.map((group) => (
          <div key={group.movement}>
            <p className="mb-2 text-[10px] uppercase tracking-[0.12em] text-quaternary">{group.label}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {group.videos.map((video) => (
                <a
                  key={video.id}
                  href={video.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-3 rounded-lg border border-primary bg-primary p-3 shadow-xs transition-all hover:-translate-y-0.5 hover:border-secondary_hover hover:shadow-md dark:shadow-none dark:hover:shadow-none"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-red-500/10 text-red-500">
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-primary">{video.title}</span>
                    <span className="block text-[11px] text-quaternary">{video.source} · YouTube</span>
                  </span>
                  <svg
                    className="h-4 w-4 shrink-0 text-quaternary transition-transform group-hover:translate-x-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5l7 7-7 7" />
                  </svg>
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
