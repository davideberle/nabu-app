"use client";

import { useCallback, useEffect, useState } from "react";
import {
  NabuBadge,
  NabuButton,
  NabuCard,
  NabuEmptyState,
  NabuHeader,
  NabuMain,
  NabuPageShell,
  NabuSectionHeader,
  NabuStat,
  NabuSurface,
  cn,
} from "@/components/ui/nabu";
import type { DataConfidence, HealthDaySnapshot, HealthWeekSummary } from "@/lib/health";

// ---------------------------------------------------------------------------
// Types from API
// ---------------------------------------------------------------------------

type HealthData = {
  today: string;
  summary: HealthWeekSummary;
};

// ---------------------------------------------------------------------------
// Confidence badge
// ---------------------------------------------------------------------------

function ConfidenceDot({ confidence }: { confidence: DataConfidence }) {
  const color =
    confidence === "logged"
      ? "bg-emerald-400"
      : confidence === "assumed"
        ? "bg-amber-400"
        : "bg-stone-300 dark:bg-stone-600";
  return <span className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", color)} />;
}

function ConfidenceLabel({ confidence }: { confidence: DataConfidence }) {
  return (
    <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-quaternary">
      <ConfidenceDot confidence={confidence} />
      {confidence}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Today card
// ---------------------------------------------------------------------------

function TodayCard({
  day,
  onRefresh,
}: {
  day: HealthDaySnapshot;
  onRefresh: () => void;
}) {
  return (
    <NabuSurface tone="muted" className="p-4 sm:p-5">
      <NabuSectionHeader eyebrow={`${day.dayOfWeek} — Today`} title="Corrections" />
      <p className="mt-1 text-[11px] text-quaternary">
        Nothing here needs a daily entry — fix something only when the inferred picture is wrong.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <SignalRow label="Breakfast" value={day.breakfast.label} confidence={day.breakfast.confidence} />
        <LunchField date={day.date} initial={day.lunch.label} confidence={day.lunch.confidence} onSaved={onRefresh} />
        <SignalRow
          label="Dinner"
          value={day.dinner.label ?? "Not logged"}
          confidence={day.dinner.confidence}
          detail={day.dinner.source ? `via ${day.dinner.source}` : undefined}
        />
        <AlcoholField date={day.date} events={day.alcohol.events} onSaved={onRefresh} />
        <SleepField date={day.date} report={day.sleep.report} onSaved={onRefresh} />
        <MeditationField date={day.date} log={day.meditation.log} onSaved={onRefresh} />
      </div>
    </NabuSurface>
  );
}

function SignalRow({
  label,
  value,
  confidence,
  detail,
}: {
  label: string;
  value: string;
  confidence: DataConfidence;
  detail?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-2 rounded-lg border border-secondary bg-primary/60 p-3">
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-[0.12em] text-quaternary">{label}</p>
        <p className="mt-0.5 text-sm font-medium text-primary">{value}</p>
        {detail ? <p className="mt-0.5 text-[11px] text-quaternary">{detail}</p> : null}
      </div>
      <ConfidenceDot confidence={confidence} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editable fields
// ---------------------------------------------------------------------------

function LunchField({
  date,
  initial,
  confidence,
  onSaved,
}: {
  date: string;
  initial: string | null;
  confidence: DataConfidence;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initial ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await fetch("/api/health/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, lunchNote: value }),
    });
    setSaving(false);
    setEditing(false);
    onSaved();
  };

  if (editing) {
    return (
      <div className="rounded-lg border border-secondary bg-primary/60 p-3">
        <p className="text-[10px] uppercase tracking-[0.12em] text-quaternary">Lunch</p>
        <input
          type="text"
          className="mt-1 w-full rounded border border-secondary bg-secondary px-2 py-1 text-sm text-primary outline-none focus:border-quaternary"
          placeholder="e.g. Salad, leftovers, skipped..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
        <div className="mt-2 flex gap-2">
          <NabuButton size="sm" onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </NabuButton>
          <NabuButton size="sm" tone="ghost" onClick={() => setEditing(false)}>
            Cancel
          </NabuButton>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="flex items-start justify-between gap-2 rounded-lg border border-secondary bg-primary/60 p-3 text-left transition-colors hover:bg-secondary"
      onClick={() => setEditing(true)}
    >
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-[0.12em] text-quaternary">Lunch</p>
        <p className="mt-0.5 text-sm font-medium text-primary">
          {initial ?? "Tap to log"}
        </p>
      </div>
      <ConfidenceDot confidence={confidence} />
    </button>
  );
}

function AlcoholField({
  date,
  events,
  onSaved,
}: {
  date: string;
  events: HealthDaySnapshot["alcohol"]["events"];
  onSaved: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [drinkType, setDrinkType] = useState("wine");
  const [amountLabel, setAmountLabel] = useState("1 glass");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await fetch("/api/health/alcohol", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, drinkType, amountLabel }),
    });
    setSaving(false);
    setAdding(false);
    setDrinkType("wine");
    setAmountLabel("1 glass");
    onSaved();
  };

  const remove = async (id: string) => {
    await fetch("/api/health/alcohol", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    onSaved();
  };

  return (
    <div className="rounded-lg border border-secondary bg-primary/60 p-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.12em] text-quaternary">Alcohol</p>
        <ConfidenceDot confidence={events.length > 0 ? "logged" : "missing"} />
      </div>
      {events.length > 0 ? (
        <div className="mt-1 space-y-1">
          {events.map((e) => (
            <div key={e.id} className="flex items-center justify-between text-sm">
              <span className="text-primary">
                {e.amountLabel ?? "1"} {e.drinkType}
              </span>
              <button
                type="button"
                className="text-[10px] text-quaternary hover:text-red-500"
                onClick={() => remove(e.id)}
              >
                remove
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-0.5 text-sm text-quaternary">None logged</p>
      )}

      {adding ? (
        <div className="mt-2 space-y-2">
          <select
            className="w-full rounded border border-secondary bg-secondary px-2 py-1 text-sm text-primary"
            value={drinkType}
            onChange={(e) => setDrinkType(e.target.value)}
          >
            <option value="wine">Wine</option>
            <option value="beer">Beer</option>
            <option value="cocktail">Cocktail</option>
            <option value="spirit">Spirit</option>
            <option value="other">Other</option>
          </select>
          <input
            type="text"
            className="w-full rounded border border-secondary bg-secondary px-2 py-1 text-sm text-primary outline-none"
            placeholder="Amount (e.g. 1 glass)"
            value={amountLabel}
            onChange={(e) => setAmountLabel(e.target.value)}
          />
          <div className="flex gap-2">
            <NabuButton size="sm" onClick={save} disabled={saving}>
              {saving ? "Saving..." : "Add"}
            </NabuButton>
            <NabuButton size="sm" tone="ghost" onClick={() => setAdding(false)}>
              Cancel
            </NabuButton>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="mt-2 text-xs font-medium text-quaternary hover:text-secondary"
          onClick={() => setAdding(true)}
        >
          + Add drink
        </button>
      )}
    </div>
  );
}

function SleepField({
  date,
  report,
  onSaved,
}: {
  date: string;
  report: HealthDaySnapshot["sleep"]["report"];
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [quality, setQuality] = useState(report?.sleepQuality ?? "ok");
  const [hours, setHours] = useState(report?.hours?.toString() ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await fetch("/api/health/sleep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date,
        sleepQuality: quality,
        ...(hours ? { hours: parseFloat(hours) } : {}),
      }),
    });
    setSaving(false);
    setEditing(false);
    onSaved();
  };

  if (editing) {
    return (
      <div className="rounded-lg border border-secondary bg-primary/60 p-3">
        <p className="text-[10px] uppercase tracking-[0.12em] text-quaternary">Sleep</p>
        <div className="mt-1 flex gap-2">
          {(["poor", "ok", "good"] as const).map((q) => (
            <button
              key={q}
              type="button"
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                quality === q
                  ? "border-primary bg-primary text-primary shadow-xs"
                  : "border-secondary bg-secondary text-quaternary hover:text-secondary",
              )}
              onClick={() => setQuality(q)}
            >
              {q}
            </button>
          ))}
        </div>
        <input
          type="number"
          step="0.5"
          min="0"
          max="24"
          className="mt-2 w-full rounded border border-secondary bg-secondary px-2 py-1 text-sm text-primary outline-none"
          placeholder="Hours (optional)"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
        />
        <div className="mt-2 flex gap-2">
          <NabuButton size="sm" onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </NabuButton>
          <NabuButton size="sm" tone="ghost" onClick={() => setEditing(false)}>
            Cancel
          </NabuButton>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="flex items-start justify-between gap-2 rounded-lg border border-secondary bg-primary/60 p-3 text-left transition-colors hover:bg-secondary"
      onClick={() => setEditing(true)}
    >
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-[0.12em] text-quaternary">Sleep</p>
        <p className="mt-0.5 text-sm font-medium text-primary">
          {report
            ? `${report.sleepQuality ?? "logged"}${report.hours ? ` — ${report.hours}h` : ""}`
            : "Tap to log"}
        </p>
      </div>
      <ConfidenceDot confidence={report ? "logged" : "missing"} />
    </button>
  );
}

function MeditationField({
  date,
  log,
  onSaved,
}: {
  date: string;
  log: HealthDaySnapshot["meditation"]["log"];
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);

  const toggle = async () => {
    setSaving(true);
    await fetch("/api/health/meditation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, completed: !(log?.completed ?? false) }),
    });
    setSaving(false);
    onSaved();
  };

  return (
    <button
      type="button"
      className="flex items-start justify-between gap-2 rounded-lg border border-secondary bg-primary/60 p-3 text-left transition-colors hover:bg-secondary"
      onClick={toggle}
      disabled={saving}
    >
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-[0.12em] text-quaternary">Meditation</p>
        <p className="mt-0.5 text-sm font-medium text-primary">
          {log?.completed ? "Done" : "Tap to mark done"}
          {log?.minutes ? ` — ${log.minutes} min` : ""}
        </p>
      </div>
      <ConfidenceDot confidence={log ? "logged" : "missing"} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// 7-day summary
// ---------------------------------------------------------------------------

function AlcoholStatusBadge({ day }: { day: HealthDaySnapshot }) {
  if (day.alcohol.status === "alcohol") {
    return (
      <NabuBadge tone="amber">
        {day.alcohol.count} drink{day.alcohol.count > 1 ? "s" : ""}
      </NabuBadge>
    );
  }
  if (day.alcohol.status === "alcohol_free") {
    return <NabuBadge tone="green">Alcohol-free</NabuBadge>;
  }
  return <NabuBadge tone="stone">Unknown</NabuBadge>;
}

function WeekAlcoholSection({ summary }: { summary: HealthWeekSummary }) {
  return (
    <section>
      <NabuSectionHeader className="mb-3" eyebrow="Rolling 7 days" title="Alcohol week" />

      <div className="grid grid-cols-3 gap-3">
        <NabuStat
          label="Alcohol days"
          value={`${summary.alcoholDays}/7`}
          tone={summary.alcoholDays > 4 ? "amber" : "stone"}
        />
        <NabuStat
          label="Confirmed free"
          value={`${summary.alcoholFreeDays}/7`}
          tone={summary.alcoholFreeDays > 0 ? "green" : "stone"}
        />
        <NabuStat label="Unknown" value={`${summary.unknownAlcoholDays}/7`} tone="stone" />
      </div>

      <p className="mt-2 text-[11px] text-quaternary">
        Days without evidence stay unknown — they never count as alcohol-free. The Sunday
        review is the place to settle them.
      </p>

      {/* Day-by-day breakdown */}
      <div className="mt-4 space-y-2">
        {summary.days.map((day) => (
          <DaySummaryRow key={day.date} day={day} />
        ))}
      </div>
    </section>
  );
}

function DaySummaryRow({ day }: { day: HealthDaySnapshot }) {
  const isToday = day.date === new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(new Date());
  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(day.date + "T12:00:00"));

  return (
    <NabuCard>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className={cn("text-xs font-medium", isToday ? "text-primary" : "text-tertiary")}>
            {dateLabel}
            {isToday ? <NabuBadge tone="green" className="ml-2">Today</NabuBadge> : null}
          </p>
          <p className="mt-1 truncate text-[11px] text-quaternary">
            {day.dinner.label
              ? `Dinner: ${day.dinner.label}${day.dinner.source ? ` (${day.dinner.source})` : ""}`
              : "Dinner unknown"}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <AlcoholStatusBadge day={day} />
        </div>
      </div>
    </NabuCard>
  );
}

function SecondarySignalsSection({ summary }: { summary: HealthWeekSummary }) {
  return (
    <section>
      <NabuSectionHeader className="mb-3" eyebrow="Optional signals" title="Sleep & meditation" />
      <div className="grid grid-cols-2 gap-3">
        <NabuStat
          label="Sleep"
          value={
            summary.averageSleepHours
              ? `${summary.averageSleepHours}h avg`
              : summary.sleepLogged > 0
                ? `${summary.sleepLogged} reported`
                : "Nothing reported"
          }
          tone="stone"
        />
        <NabuStat
          label="Meditation"
          value={
            summary.meditationDays > 0
              ? `${summary.meditationDays} day${summary.meditationDays > 1 ? "s" : ""}`
              : "Nothing reported"
          }
          tone="stone"
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function HealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/health/logs?range=7");
      if (!res.ok) {
        if (res.status === 403) {
          setError("Health dashboard is not available for this account.");
          setLoading(false);
          return;
        }
        throw new Error("Failed to load health data");
      }
      const json = await res.json();
      setData(json);
      setError(null);
    } catch {
      setError("Could not load health data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const todaySnapshot = data?.summary.days.find((d) => d.date === data.today) ?? null;

  return (
    <NabuPageShell>
      <NabuHeader title="Health" eyebrow="Personal" backHref="/" icon="🫀" />

      <NabuMain className="space-y-6 pb-20">
        <NabuCard href="/health/gymnastics" className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-primary bg-secondary text-lg shadow-xs">
            🤸
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold tracking-[-0.01em] text-primary">Gymnastics program</span>
            <span className="block truncate text-xs text-quaternary">
              Ordinary kipping pull-up capacity · 3-week block, track your sessions
            </span>
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
        </NabuCard>

        {loading ? (
          <NabuSurface tone="muted" className="p-8 text-center">
            <p className="text-sm text-quaternary">Loading...</p>
          </NabuSurface>
        ) : error ? (
          <NabuEmptyState icon="🔒" title="Access restricted" description={error} />
        ) : data && todaySnapshot ? (
          <>
            <WeekAlcoholSection summary={data.summary} />
            <SecondarySignalsSection summary={data.summary} />

            {/* Confidence legend */}
            <div className="flex gap-4 text-[10px] text-quaternary">
              <ConfidenceLabel confidence="logged" />
              <ConfidenceLabel confidence="assumed" />
              <ConfidenceLabel confidence="missing" />
            </div>

            <TodayCard day={todaySnapshot} onRefresh={load} />
          </>
        ) : (
          <NabuEmptyState
            icon="📊"
            title="No health data yet"
            description="Start logging your first day to see your dashboard."
          />
        )}
      </NabuMain>
    </NabuPageShell>
  );
}
