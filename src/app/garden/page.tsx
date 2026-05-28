"use client";

import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  NabuBadge,
  NabuButton,
  NabuCard,
  NabuEmptyState,
  NabuHeader,
  NabuMain,
  NabuPageShell,
  NabuSectionHeader,
  NabuSurface,
  cn,
} from "@/components/ui/nabu";
import type { GardenScheduleSnapshot, GardenWateringLogEntry, GardenZoneSnapshot } from "@/lib/garden-irrigation";

function formatDateTime(value?: string | null) {
  if (!value) return "Never";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatShortDateTime(value?: string | null) {
  if (!value) return "Never";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatGenerated(value?: string | null) {
  if (!value) return "Unknown";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatRain(value?: number | null) {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(value >= 10 ? 0 : 1)} mm`;
}

function formatTemperature(value?: number | null) {
  if (value === null || value === undefined) return "—";
  return `${Math.round(value)}°C`;
}

function formatPercent(value?: number | null) {
  if (value === null || value === undefined) return "—";
  return `${Math.round(value)}%`;
}

function formatMinutes(value?: number | null) {
  if (value === null || value === undefined) return "—";
  return `${value} min`;
}

function sentence(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function compactReasons(reasons?: string[], fallback = "No reason recorded") {
  if (!reasons?.length) return fallback;
  return reasons.slice(0, 3).map(sentence).join(" · ");
}

function zoneIsSkipping(zone: GardenZoneSnapshot, globalSkip: boolean) {
  return globalSkip || zone.nextAction === "skip-zone";
}

function zonePlanText(zone: GardenZoneSnapshot, globalSkip: boolean) {
  if (zoneIsSkipping(zone, globalSkip)) return "Skip today";
  return `${formatMinutes(zone.nextPlannedMinutes)} planned`;
}

function zoneBadgeTone(zone: GardenZoneSnapshot, globalSkip: boolean) {
  if (zone.state === "open") return "green" as const;
  if (zoneIsSkipping(zone, globalSkip)) return "amber" as const;
  return "blue" as const;
}

function zoneBadgeText(zone: GardenZoneSnapshot, globalSkip: boolean) {
  if (zone.state === "open") return "Running";
  if (zoneIsSkipping(zone, globalSkip)) return "Skip";
  return "Planned";
}

function healthTone(snapshot: GardenScheduleSnapshot, runningCount: number) {
  if (!snapshot.ok || snapshot.error) return "amber" as const;
  if (!snapshot.automation.enabled) return "red" as const;
  if (snapshot.skip.active) return "amber" as const;
  if (runningCount) return "green" as const;
  return "green" as const;
}

function healthTitle(snapshot: GardenScheduleSnapshot, runningCount: number) {
  if (!snapshot.ok || snapshot.error) return "Garden data needs attention";
  if (!snapshot.automation.enabled) return "Automatic watering is off";
  if (snapshot.skip.active) return "Rain brake active";
  if (runningCount === 1) return `${runningCount} zone watering now`;
  if (runningCount > 1) return `${runningCount} zones watering now`;
  return "All valves are closed";
}

function healthDescription(snapshot: GardenScheduleSnapshot, runningCount: number) {
  if (snapshot.skip.active) {
    return compactReasons(snapshot.skip.reasons, "Rain or forecast conditions are suppressing watering.");
  }
  if (runningCount) return "Active valves should be visible in the Gardena app.";
  return "The next watering decision is already calculated from live weather and the latest run history.";
}

function weatherLine(snapshot: GardenScheduleSnapshot) {
  const w = snapshot.weather;
  if (!w) return "Weather snapshot unavailable";
  return [
    `${formatTemperature(w.max_temp_today_c)} max`,
    `${formatPercent(w.avg_daylight_cloud_cover_pct)} cloud`,
    `ET0 ${formatRain(w.et0_today_mm)}`,
    `${formatRain(w.next_24h_mm)} rain next 24h`,
  ].join(" · ");
}

function StatTile({
  label,
  value,
  helper,
  tone = "stone",
}: {
  label: string;
  value: ReactNode;
  helper?: ReactNode;
  tone?: "stone" | "green" | "amber" | "blue" | "red";
}) {
  const toneClass = {
    stone: "border-secondary bg-primary",
    green: "border-utility-success-200 bg-utility-success-50/70 dark:border-utility-success-800 dark:bg-utility-success-950/25",
    amber: "border-utility-warning-200 bg-utility-warning-50/70 dark:border-utility-warning-800 dark:bg-utility-warning-950/25",
    blue: "border-utility-blue-200 bg-utility-blue-50/70 dark:border-utility-blue-800 dark:bg-utility-blue-950/25",
    red: "border-utility-error-200 bg-utility-error-50/70 dark:border-utility-error-800 dark:bg-utility-error-950/25",
  }[tone];

  return (
    <div className={cn("min-w-0 rounded-2xl border p-4", toneClass)}>
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-quaternary">{label}</p>
      <div className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-primary">{value}</div>
      {helper ? <p className="mt-1 text-xs leading-5 text-tertiary">{helper}</p> : null}
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl bg-secondary px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-quaternary">{label}</p>
      <p className="mt-1 text-sm font-semibold text-primary">{value}</p>
    </div>
  );
}

function HeroStatus({ snapshot, runningCount }: { snapshot: GardenScheduleSnapshot; runningCount: number }) {
  return (
    <NabuSurface tone="accent" className="relative overflow-hidden p-5 sm:p-6">
      <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-utility-success-200/35 blur-3xl dark:bg-utility-success-700/10" />
      <div className="relative flex min-w-0 flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <NabuBadge tone={healthTone(snapshot, runningCount)}>{snapshot.automation.enabled ? "Automation on" : "Automation off"}</NabuBadge>
            <NabuBadge tone={snapshot.automation.rainSuppression ? "blue" : "amber"}>Rain brake</NabuBadge>
            <NabuBadge tone={snapshot.automation.visibleInGardenaApp ? "green" : "amber"}>Gardena-visible</NabuBadge>
          </div>
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-primary sm:text-4xl">
            {healthTitle(snapshot, runningCount)}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-tertiary">
            {healthDescription(snapshot, runningCount)}
          </p>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2 lg:w-64">
          <MiniMetric label="Updated" value={formatGenerated(snapshot.generatedAt)} />
          <MiniMetric label="Source" value={snapshot.source === "live" ? "Live" : sentence(snapshot.source)} />
          <MiniMetric label="Rain 24h" value={formatRain(snapshot.weather?.next_24h_mm)} />
          <MiniMetric label="Heat" value={formatTemperature(snapshot.weather?.max_temp_today_c)} />
        </div>
      </div>
      <p className="relative mt-5 rounded-xl bg-primary/55 px-3 py-2 text-xs leading-5 text-quaternary">
        {weatherLine(snapshot)}
      </p>
    </NabuSurface>
  );
}

function ZoneRow({ zone, globalSkip, skipReasons }: { zone: GardenZoneSnapshot; globalSkip: boolean; skipReasons: string[] }) {
  const skipping = zoneIsSkipping(zone, globalSkip);
  const reasons = globalSkip ? skipReasons : zone.nextReason;

  return (
    <NabuCard className="p-0">
      <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_auto] sm:items-center sm:p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold tracking-[-0.02em] text-primary">{zone.name}</h3>
            <NabuBadge tone={zoneBadgeTone(zone, globalSkip)}>{zoneBadgeText(zone, globalSkip)}</NabuBadge>
          </div>
          <p className="mt-1 text-sm leading-5 text-tertiary">{zone.planting}</p>
          <p className="mt-2 text-xs text-quaternary">Daily check at {zone.scheduledTime}</p>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:grid-cols-3">
          <MiniMetric label="Today" value={zonePlanText(zone, globalSkip)} />
          <MiniMetric label="Last run" value={formatMinutes(zone.lastMinutes)} />
          <MiniMetric label="Valve" value={<span className="capitalize">{zone.state || "unknown"}</span>} />
        </div>

        {zone.state === "open" ? (
          <div className="rounded-2xl border border-utility-success-200 bg-utility-success-50 px-4 py-3 text-sm text-utility-success-700 dark:border-utility-success-800 dark:bg-utility-success-950/25 dark:text-utility-success-300 sm:w-36">
            <p className="text-[10px] font-medium uppercase tracking-[0.14em]">Remaining</p>
            <p className="mt-1 font-semibold">{formatMinutes(zone.remainingMinutes)}</p>
          </div>
        ) : (
          <div className={cn(
            "rounded-2xl border px-4 py-3 text-sm sm:w-36",
            skipping
              ? "border-utility-warning-200 bg-utility-warning-50 text-utility-warning-700 dark:border-utility-warning-800 dark:bg-utility-warning-950/25 dark:text-utility-warning-300"
              : "border-utility-blue-200 bg-utility-blue-50 text-utility-blue-700 dark:border-utility-blue-800 dark:bg-utility-blue-950/25 dark:text-utility-blue-300",
          )}>
            <p className="text-[10px] font-medium uppercase tracking-[0.14em]">Next</p>
            <p className="mt-1 font-semibold">{skipping ? "No water" : formatMinutes(zone.nextPlannedMinutes)}</p>
          </div>
        )}
      </div>

      <div className="border-t border-secondary bg-secondary/45 px-4 py-3 sm:px-5">
        <div className="grid gap-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <p className="leading-6 text-tertiary">
            <span className="font-medium text-primary">Why: </span>
            {compactReasons(reasons)}
          </p>
          <p className="text-xs text-quaternary">Last started {formatShortDateTime(zone.lastStartedAt)}</p>
        </div>
      </div>
    </NabuCard>
  );
}

function WeatherPanel({ snapshot }: { snapshot: GardenScheduleSnapshot }) {
  const weather = snapshot.weather;
  return (
    <NabuSurface className="p-5">
      <NabuSectionHeader
        eyebrow="Weather input"
        title="Why the schedule thinks this is dry or wet"
        description="The watering script mainly looks at recent rain, upcoming rain, heat, cloud cover, and ET0."
      />
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Recent rain"
          value={formatRain(weather?.recent_24h_mm)}
          helper="Last 24 hours"
          tone={(weather?.recent_24h_mm || 0) > 2 ? "green" : "stone"}
        />
        <StatTile
          label="Forecast rain"
          value={formatRain(weather?.next_24h_mm)}
          helper={`${formatRain(weather?.next_72h_mm)} next 72h`}
          tone={snapshot.skip.active ? "amber" : "blue"}
        />
        <StatTile
          label="Temperature"
          value={formatTemperature(weather?.max_temp_today_c)}
          helper={`Cloud cover ${formatPercent(weather?.avg_daylight_cloud_cover_pct)}`}
          tone={(weather?.max_temp_today_c || 0) >= 28 ? "amber" : "green"}
        />
        <StatTile
          label="ET0"
          value={formatRain(weather?.et0_today_mm)}
          helper="Evapotranspiration today"
          tone={(weather?.et0_today_mm || 0) >= 5 ? "amber" : "stone"}
        />
      </div>
    </NabuSurface>
  );
}

function logTitle(entry: GardenWateringLogEntry) {
  if (entry.decision === "skip") return "Skipped watering";
  if (entry.decision === "water") return "Watered";
  return sentence(entry.decision || "Garden decision");
}

function logDetail(entry: GardenWateringLogEntry) {
  if (entry.reasons?.length) return compactReasons(entry.reasons);
  if (entry.results?.length) {
    return entry.results.map((result) => `${sentence(result.zone)}: ${formatMinutes(result.minutes)}`).join(" · ");
  }
  if (entry.zones?.length) return entry.zones.map(sentence).join(" · ");
  return "No details recorded";
}

function RecentRuns({ snapshot }: { snapshot: GardenScheduleSnapshot }) {
  return (
    <NabuSurface className="p-5">
      <NabuSectionHeader
        eyebrow="History"
        title="Recent watering decisions"
        description="Quick audit trail of what actually happened. Routine success stays quiet in Telegram."
      />
      <div className="mt-4 overflow-hidden rounded-2xl border border-secondary">
        {snapshot.recentLog.length ? snapshot.recentLog.slice(0, 7).map((entry, index) => (
          <div key={`${entry.ts}-${index}`} className="grid gap-3 border-b border-secondary bg-primary p-4 text-sm last:border-b-0 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
            <div className={cn(
              "hidden h-9 w-9 place-items-center rounded-full sm:grid",
              entry.decision === "skip" ? "bg-utility-warning-50 text-utility-warning-700 dark:bg-utility-warning-950/30 dark:text-utility-warning-300" : "bg-utility-success-50 text-utility-success-700 dark:bg-utility-success-950/30 dark:text-utility-success-300",
            )}>
              {entry.decision === "skip" ? "↯" : "✓"}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-primary">{logTitle(entry)}</p>
                <span className="text-quaternary">·</span>
                <p className="text-tertiary">{formatDateTime(entry.ts)}</p>
              </div>
              <p className="mt-1 text-xs leading-5 text-quaternary">{logDetail(entry)}</p>
            </div>
            <NabuBadge tone={entry.decision === "skip" ? "amber" : "green"}>{entry.decision}</NabuBadge>
          </div>
        )) : (
          <div className="bg-primary p-4 text-sm text-quaternary">No watering log published yet.</div>
        )}
      </div>
    </NabuSurface>
  );
}

function GardenContent() {
  const [snapshot, setSnapshot] = useState<GardenScheduleSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/garden", { cache: "no-store" });
      const data = (await res.json()) as GardenScheduleSnapshot;
      setSnapshot(data);
      setNotice(data.error || null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Garden status unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [refresh]);

  const running = useMemo(
    () => snapshot?.zones.filter((zone) => zone.state === "open") || [],
    [snapshot],
  );

  return (
    <NabuPageShell>
      <NabuHeader
        title="Garden"
        backHref="/"
        subtitle="Readable Gardena status, today’s plan, and recent runs."
        icon="🌿"
        action={<NabuButton tone="secondary" size="sm" onClick={refresh}>Refresh</NabuButton>}
      />

      <NabuMain>
        {loading || !snapshot ? (
          <NabuEmptyState title="Loading garden…" />
        ) : (
          <div className="space-y-6">
            {notice ? (
              <div className="rounded-xl border border-utility-warning-200 bg-utility-warning-50 px-4 py-3 text-sm text-utility-warning-800 dark:border-utility-warning-900 dark:bg-utility-warning-950 dark:text-utility-warning-200">
                {notice}
              </div>
            ) : null}

            <HeroStatus snapshot={snapshot} runningCount={running.length} />

            <section>
              <NabuSectionHeader
                eyebrow="Today"
                title="Watering plan by zone"
                description="Readable rows instead of dense debug cards: what happens today, when it last ran, and the reason."
              />
              <div className="mt-4 space-y-3">
                {snapshot.zones.map((zone) => (
                  <ZoneRow key={zone.id} zone={zone} globalSkip={snapshot.skip.active} skipReasons={snapshot.skip.reasons} />
                ))}
              </div>
            </section>

            <WeatherPanel snapshot={snapshot} />
            <RecentRuns snapshot={snapshot} />
          </div>
        )}
      </NabuMain>
    </NabuPageShell>
  );
}

export default function GardenPage() {
  return (
    <Suspense fallback={<NabuPageShell><NabuHeader title="Garden" backHref="/" subtitle="Loading irrigation…" icon="🌿" /><NabuMain><NabuEmptyState title="Loading garden…" /></NabuMain></NabuPageShell>}>
      <GardenContent />
    </Suspense>
  );
}
