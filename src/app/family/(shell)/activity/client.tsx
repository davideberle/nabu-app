"use client";

// ---------------------------------------------------------------------------
// Activity — source-linked chronology for the selected child (FH-08).
// Presentation only: the server composes the list from canonical claims,
// reviews and redemptions by stable id; weekly filtering is a view and the
// balance always comes from the shared wallet projection (FH-06).
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/components/ui/nabu";
import { assistantProfileById } from "@/data/family-assistant";
import { useChildShell } from "@/components/family/child-shell-provider";
import type { ActivityFilter, ActivityItem } from "@/lib/family-activity";
import { filterActivity } from "@/lib/family-activity";
import type { ChildId } from "@/lib/family-assistant-turn";
import { childShellDestinationHref, type ChildShellWeekInfo } from "@/lib/family-child-shell";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500";
const pillClass = cn(
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-primary px-5 py-2 text-sm font-semibold transition-colors",
  focusRing,
);

type Load =
  | { kind: "loading" }
  | { kind: "ready"; items: ActivityItem[]; currentWeek: string }
  | { kind: "error" };

const STATUS_TONE: Record<ActivityItem["status"], string> = {
  pending: "border-amber-300 text-amber-800 dark:border-amber-700 dark:text-amber-200",
  approved: "border-emerald-300 text-emerald-800 dark:border-emerald-700 dark:text-emerald-200",
  "on-hold": "border-stone-300 text-stone-700 dark:border-stone-600 dark:text-stone-300",
  "try-again": "border-rose-300 text-rose-800 dark:border-rose-700 dark:text-rose-200",
  redeemed: "border-sky-300 text-sky-800 dark:border-sky-700 dark:text-sky-200",
  refunded: "border-stone-300 text-stone-700 dark:border-stone-600 dark:text-stone-300",
};

export function FamilyActivityClient({ weekInfo }: { weekInfo: ChildShellWeekInfo }) {
  const { child } = useChildShell();
  if (!child) return null;
  return <Activity key={child} child={child} weekInfo={weekInfo} />;
}

function formatWhen(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function Activity({ child, weekInfo }: { child: ChildId; weekInfo: ChildShellWeekInfo }) {
  const { wallet } = useChildShell();
  const profile = assistantProfileById(child)!;
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<ActivityFilter>("all");

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ kind: "loading" });
    (async () => {
      try {
        const res = await fetch(`/api/family/activity?person=${encodeURIComponent(child)}`, { signal: controller.signal, cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { person: string; currentWeek: string; items: ActivityItem[] };
        if (controller.signal.aborted) return;
        // Cross-child guard: a late answer for another profile is dropped, never rendered.
        if (data.person !== child) return;
        setLoad({ kind: "ready", items: data.items, currentWeek: data.currentWeek });
      } catch {
        if (!controller.signal.aborted) setLoad({ kind: "error" });
      }
    })();
    return () => controller.abort();
  }, [child, attempt]);

  const balance = wallet.status === "ready" ? wallet.wallet.balance : null;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-5 pb-[max(3rem,env(safe-area-inset-bottom))] sm:px-6">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-quaternary">Activity</p>
          <h1 className="text-2xl font-semibold">What {profile.displayName} did</h1>
          <p className="text-sm text-tertiary">
            {balance !== null ? `You have 🪙 ${balance} coins — the same wallet everywhere.` : wallet.status === "error" ? "Couldn't load your wallet." : "Loading your coins…"}
          </p>
        </div>
        <Link href={childShellDestinationHref("plan", child, weekInfo.weekId)} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>
          📅 This week&rsquo;s plan
        </Link>
      </section>

      <div role="group" aria-label="Show" className="flex gap-2">
        {(["all", "week"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={filter === option}
            onClick={() => setFilter(option)}
            className={cn(pillClass, filter === option ? "bg-secondary text-primary" : "bg-primary text-secondary hover:bg-secondary")}
          >
            {option === "all" ? "All time" : "This week"}
          </button>
        ))}
      </div>

      {load.kind === "loading" ? (
        <p className="text-sm text-tertiary">Loading your activity…</p>
      ) : load.kind === "error" ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-primary bg-primary px-4 py-3">
          <p className="text-sm text-secondary">Your activity couldn&rsquo;t load. Check the internet connection, then try again.</p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>
            ↻ Try again
          </button>
        </div>
      ) : (
        <ActivityList items={filterActivity(load.items, filter, load.currentWeek)} emptyLabel={filter === "week" ? "Nothing recorded this week yet." : "Nothing recorded yet."} />
      )}
    </main>
  );
}

function ActivityList({ items, emptyLabel }: { items: ActivityItem[]; emptyLabel: string }) {
  if (items.length === 0) {
    return <p className="rounded-3xl border border-dashed border-primary bg-primary/60 px-5 py-4 text-sm text-tertiary">{emptyLabel}</p>;
  }
  return (
    <ol aria-label="Activity" className="flex flex-col gap-3">
      {items.map((item) => {
        const submitted = formatWhen(item.submittedAt);
        const reviewed = formatWhen(item.reviewedAt);
        const redeemed = formatWhen(item.redeemedAt);
        return (
          <li key={item.id} data-activity-id={item.id} className="flex items-start gap-4 rounded-2xl border border-primary bg-primary px-4 py-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-secondary text-2xl" aria-hidden>
              {item.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-base font-semibold text-primary">{item.title}</p>
                <p className={cn("text-base font-semibold", item.coinDelta === null ? "text-quaternary" : item.coinDelta >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-sky-700 dark:text-sky-300")}>
                  {item.coinDelta === null ? "🪙 —" : item.coinDelta > 0 ? `🪙 +${item.coinDelta}` : item.coinDelta < 0 ? `🪙 ${item.coinDelta}` : "🪙 0"}
                </p>
              </div>
              <p className="mt-1">
                <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium", STATUS_TONE[item.status])}>{item.statusLabel}</span>
              </p>
              <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-tertiary">
                {submitted ? (<div><dt className="inline">Recorded </dt><dd className="inline">{submitted}</dd></div>) : null}
                {reviewed ? (<div><dt className="inline">Reviewed </dt><dd className="inline">{reviewed}</dd></div>) : null}
                {redeemed ? (<div><dt className="inline">Redeemed </dt><dd className="inline">{redeemed}</dd></div>) : null}
                {!submitted && !reviewed && !redeemed ? (<div><dt className="inline">Week </dt><dd className="inline">{item.week}</dd></div>) : null}
              </dl>
              {item.detail ? <p className="mt-1 text-sm text-secondary">&ldquo;{item.detail}&rdquo;</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
