"use client";

// ---------------------------------------------------------------------------
// Parent tools — the compact replacement for the retired family board and the
// person weekly grids (October 8, 2026; PR-01). Owner-only (the page gates).
//
// Everything here acts BY IDENTITY on the canonical Family records through the
// existing routes — approve/hold/redo and count correction via PATCH
// /api/family/completions with the expected status and submission time (a
// stale action fails closed and the lists reload), undo via DELETE, routine
// configuration via PUT /api/family/config, parent-assisted dated capture via
// POST /api/family/completions with `parentAssisted`. No copied review table;
// the queue is the server's cross-week projection.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/components/ui/nabu";
import { dayLabels, familyMembers, routineDefinitions, type CompletionRecord } from "@/data/family-routines";
import { CHILD_IDS, type ChildId } from "@/lib/family-assistant-turn";
import type { FamilyBoardConfig, RewardRedemption } from "@/lib/family-db";
import type { ChessStatusView, PlayPurchase } from "@/lib/family-play";
import { PLAY_PURCHASE_REWARD_ID, formatPlayClock, occurrenceDateOf } from "@/lib/family-play";
import { rewardDefinitions } from "@/data/family-routines";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500";
const pill = cn("inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-primary px-4 py-2 text-sm font-semibold transition-colors", focusRing);
const primaryPill = cn(pill, "bg-secondary text-primary hover:bg-primary");
const secondaryPill = cn(pill, "bg-primary text-secondary hover:bg-secondary");
const card = "flex flex-col gap-3 rounded-3xl border border-primary bg-primary p-5";

type Milestone = { id: string; label: string; when: string; daysUntil: number; planning: string; status: string };
type QueueItem = { key: string; number: number; week: string; personId: string; routineId: string; day: number; status: "pending_review" | "on_hold"; note?: string; normalizedSummary?: string; challenge?: string; creditCount?: number; submittedAt?: string; childName: string; activity: string; icon: string; dayLabel: string };
type Queue = { snapshotId: string; count: number; items: QueueItem[] };
type Records = {
  generatedAt: string;
  today: { date: string; week: string; day: number };
  epochWeek: string;
  completions: (CompletionRecord & { week: string })[];
  redemptions: RewardRedemption[];
  purchases: (PlayPurchase & { week: string })[];
  config: FamilyBoardConfig;
  chess: Record<ChildId, ChessStatusView>;
};

const childName = (id: string) => familyMembers.find((m) => m.id === id)?.displayName ?? id;
const routineTitle = (id: string) => routineDefinitions.find((r) => r.id === id)?.title ?? id;
const routineIcon = (id: string) => routineDefinitions.find((r) => r.id === id)?.icon ?? "";
const STATUS_LABEL: Record<CompletionRecord["status"], string> = { done: "Approved", pending_review: "Waiting for review", on_hold: "On hold", redo: "Try again" };

export function FamilyParentClient({ milestones }: { milestones: Milestone[] }) {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [records, setRecords] = useState<Records | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const [q, r] = await Promise.all([
          fetch("/api/family/review-queue", { cache: "no-store", signal: controller.signal }),
          fetch("/api/family/parent/records", { cache: "no-store", signal: controller.signal }),
        ]);
        if (!q.ok || !r.ok) throw new Error(`${q.status}/${r.status}`);
        const [qj, rj] = await Promise.all([q.json() as Promise<Queue>, r.json() as Promise<Records>]);
        if (controller.signal.aborted) return;
        setQueue(qj);
        setRecords(rj);
        setError(null);
      } catch (e) {
        if (!controller.signal.aborted) setError(`The parent tools couldn't load (${(e as Error).message}).`);
      }
    })();
    return () => controller.abort();
  }, [attempt]);

  const act = useCallback(async (label: string, run: () => Promise<Response>) => {
    setNotice(null);
    try {
      const res = await run();
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) setNotice(res.status === 409 ? `${label}: that item changed meanwhile — lists reloaded, nothing was changed.` : `${label} failed: ${body?.error ?? res.status}.`);
      else setNotice(`${label}: done.`);
    } catch {
      setNotice(`${label} failed: no connection.`);
    }
    reload();
  }, [reload]);

  const review = (item: QueueItem | (CompletionRecord & { week: string }), action: "approve" | "hold" | "redo") =>
    act(`${action[0].toUpperCase()}${action.slice(1)} ${routineTitle(item.routineId)}`, () =>
      fetch("/api/family/completions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ week: item.week, personId: item.personId, routineId: item.routineId, day: item.day, action, expectedStatus: item.status, expectedSubmittedAt: item.submittedAt ?? null }) }));
  const undoCompletion = (c: CompletionRecord & { week: string }) =>
    act(`Undo ${routineTitle(c.routineId)}`, () => fetch("/api/family/completions", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ week: c.week, personId: c.personId, routineId: c.routineId, day: c.day }) }));
  const setCount = (c: CompletionRecord & { week: string }, creditCount: number) =>
    act(`Set ${routineTitle(c.routineId)} to ${creditCount}`, () => fetch("/api/family/completions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ week: c.week, personId: c.personId, routineId: c.routineId, day: c.day, action: "set-credit-count", creditCount }) }));
  const undoRedemption = (r: RewardRedemption) =>
    act(`Undo ${r.rewardId === PLAY_PURCHASE_REWARD_ID ? "Game Studio time" : r.rewardId}`, () => fetch("/api/family/redemptions", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id }) }));

  // ---- routine configuration (debounced full-config PUT; reward overrides preserved untouched) ----
  const [config, setConfig] = useState<FamilyBoardConfig | null>(null);
  useEffect(() => { if (records) setConfig(records.config); }, [records]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const changeRoutine = (routineId: string, patch: { enabled?: boolean; weeklyTarget?: number | null; points?: number }) => {
    if (!config) return;
    const next: FamilyBoardConfig = { ...config, routineOverrides: { ...config.routineOverrides, [routineId]: { ...(config.routineOverrides[routineId] ?? {}), ...patch } } };
    setConfig(next);
    setSaveStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const res = await fetch("/api/family/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      setSaveStatus(res.ok ? "saved" : "failed");
    }, 500);
  };

  // ---- parent-assisted dated capture ------------------------------------------
  const [entry, setEntry] = useState<{ child: ChildId; routineId: string; date: string; note: string; creditCount: number }>({ child: "santiago", routineId: "s-kumon", date: "", note: "", creditCount: 1 });
  useEffect(() => { if (records && !entry.date) setEntry((e) => ({ ...e, date: records.today.date })); }, [records, entry.date]);
  const entryRoutines = routineDefinitions.filter((r) => r.assignedTo.includes(entry.child) && (config?.routineOverrides[r.id]?.enabled !== false));
  const submitEntry = async () => {
    const week = isoWeekOf(entry.date);
    const day = weekdayOf(entry.date);
    if (!week || day === null) { setNotice("Pick a valid date."); return; }
    await act(`Record ${routineTitle(entry.routineId)} for ${childName(entry.child)} on ${entry.date}`, () =>
      fetch("/api/family/completions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ week, personId: entry.child, routineId: entry.routineId, day, status: "pending_review", note: entry.note, creditCount: entry.creditCount, parentAssisted: true }) }));
    setEntry((e) => ({ ...e, note: "", creditCount: 1 }));
  };

  const history = useMemo(() => {
    if (!records) return [];
    return [...records.completions].filter((c) => c.status !== "pending_review" && c.status !== "on_hold").sort((a, b) => (a.week === b.week ? b.day - a.day : a.week < b.week ? 1 : -1)).slice(0, 60);
  }, [records]);
  const spending = useMemo(() => {
    if (!records) return [];
    return [...records.redemptions].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 40);
  }, [records]);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 px-4 py-5 pb-16 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-quaternary">Parent tools</p>
          <h1 className="text-2xl font-semibold">Santiago &amp; Isabel</h1>
          <p className="text-sm text-tertiary">Review, correct and undo across every week. Nothing here is visible to the children.</p>
        </div>
        <nav className="flex flex-wrap gap-2">
          <Link href="/family/home" className={secondaryPill}>Family Home</Link>
          <Link href="/family/learn/parent" className={secondaryPill}>Learning (parent)</Link>
          <Link href="/" className={secondaryPill}>Nabu</Link>
        </nav>
      </header>

      {notice ? <p role="status" className="rounded-2xl border border-primary bg-primary px-4 py-2 text-sm font-medium text-secondary" data-parent-notice>{notice}</p> : null}
      {error ? (
        <div className={card}><p className="text-sm text-secondary">{error}</p><button type="button" onClick={reload} className={secondaryPill}>↻ Try again</button></div>
      ) : null}

      {/* 1. Review queue — cross-week, by identity */}
      <section aria-label="Review queue" className={card} data-queue-count={queue?.count ?? ""}>
        <h2 className="text-lg font-semibold">Waiting for review {queue ? `(${queue.count})` : ""}</h2>
        {!queue ? <p className="text-sm text-tertiary">Loading…</p> : queue.items.length === 0 ? <p className="text-sm text-tertiary">Nothing waiting.</p> : (
          <ol className="flex flex-col gap-3">
            {queue.items.map((item) => (
              <li key={item.key} data-queue-key={item.key} className="flex flex-col gap-2 rounded-2xl border border-secondary bg-secondary px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-base font-semibold">{item.icon} {item.childName} · {item.activity}{(item.creditCount ?? 1) > 1 ? ` ×${item.creditCount}` : ""}</p>
                  <p className="text-xs text-tertiary">{item.dayLabel} · {item.week} · {item.status === "on_hold" ? "On hold" : "Review"}</p>
                </div>
                {item.normalizedSummary ? <p className="text-sm text-primary">{item.normalizedSummary}</p> : null}
                {item.note ? <p className="text-sm text-secondary">&ldquo;{item.note}&rdquo;</p> : null}
                {item.challenge ? <p className="text-xs text-tertiary">{item.challenge}</p> : null}
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => review(item, "approve")} className={primaryPill}>✓ Approve</button>
                  {item.status !== "on_hold" ? <button type="button" onClick={() => review(item, "hold")} className={secondaryPill}>Hold</button> : null}
                  <button type="button" onClick={() => review(item, "redo")} className={secondaryPill}>Ask to redo</button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* 2. Chess today — server status per child */}
      <section aria-label="Chess today" className={card}>
        <h2 className="text-lg font-semibold">Chess today {records ? `· ${records.today.date}` : ""}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {CHILD_IDS.map((child) => {
            const c = records?.chess[child];
            return (
              <div key={child} className="rounded-2xl border border-secondary bg-secondary px-4 py-3" data-chess-child={child} data-chess-eligible={c ? String(c.eligible) : ""} data-chess-remaining={c ? c.remainingSeconds : ""}>
                <p className="text-base font-semibold">{childName(child)}</p>
                {!c ? <p className="text-sm text-tertiary">…</p> : (
                  <>
                    <p className="text-sm text-primary">{c.eligible ? `Unlocked · ${formatPlayClock(c.remainingSeconds)} left of 15:00` : c.grantedSeconds > 0 ? `Locked (approval removed) · ${formatPlayClock(Math.max(0, c.grantedSeconds - c.consumedSeconds))} would come back` : "Locked — no approved activity today"}</p>
                    {c.qualifiedBy ? <p className="text-xs text-tertiary">Unlocked by {routineTitle(c.qualifiedBy.routineId)} ({dayLabels[c.qualifiedBy.day]} {c.qualifiedBy.week})</p> : null}
                  </>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-tertiary">One approved activity occurring today unlocks 15 free minutes of digital chess for that day. More activities don&rsquo;t add time; coins never buy it; the real board is always free.</p>
      </section>

      {/* 3. Record a day for a child */}
      <section aria-label="Record for a child" className={card}>
        <h2 className="text-lg font-semibold">Record something for a child</h2>
        <p className="text-sm text-tertiary">For a day the child couldn&rsquo;t record (no device, offline) or when you were there. It lands on that day&rsquo;s real identity, approved by you — never twice.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm"><span className="text-tertiary">Child</span>
            <select value={entry.child} onChange={(e) => { const child = e.target.value as ChildId; setEntry((v) => ({ ...v, child, routineId: routineDefinitions.find((r) => r.assignedTo.includes(child))?.id ?? v.routineId })); }} className="min-h-11 rounded-2xl border border-primary bg-secondary px-3" data-entry-child>
              {CHILD_IDS.map((c) => <option key={c} value={c}>{childName(c)}</option>)}
            </select></label>
          <label className="flex flex-col gap-1 text-sm"><span className="text-tertiary">Activity</span>
            <select value={entry.routineId} onChange={(e) => setEntry((v) => ({ ...v, routineId: e.target.value }))} className="min-h-11 rounded-2xl border border-primary bg-secondary px-3" data-entry-routine>
              {entryRoutines.map((r) => <option key={r.id} value={r.id}>{r.icon} {r.title}</option>)}
            </select></label>
          <label className="flex flex-col gap-1 text-sm"><span className="text-tertiary">Day it happened</span>
            <input type="date" value={entry.date} max={records?.today.date} onChange={(e) => setEntry((v) => ({ ...v, date: e.target.value }))} className="min-h-11 rounded-2xl border border-primary bg-secondary px-3" data-entry-date /></label>
          <label className="flex flex-col gap-1 text-sm"><span className="text-tertiary">Units (e.g. Kumon sheets)</span>
            <input type="number" min={1} max={20} value={entry.creditCount} onChange={(e) => setEntry((v) => ({ ...v, creditCount: Math.max(1, Math.min(20, Number(e.target.value) || 1)) }))} className="min-h-11 rounded-2xl border border-primary bg-secondary px-3" data-entry-count /></label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2"><span className="text-tertiary">What they did (kept as the claim)</span>
            <input value={entry.note} onChange={(e) => setEntry((v) => ({ ...v, note: e.target.value }))} maxLength={2000} className="min-h-11 rounded-2xl border border-primary bg-secondary px-3" placeholder="Kumon sheets 12–14, done at Oma's" data-entry-note /></label>
        </div>
        <div><button type="button" onClick={submitEntry} className={primaryPill} data-entry-submit>Record and approve</button></div>
      </section>

      {/* 4. History with corrections and undo */}
      <section aria-label="Recent history" className={card}>
        <h2 className="text-lg font-semibold">Recent history</h2>
        {!records ? <p className="text-sm text-tertiary">Loading…</p> : history.length === 0 ? <p className="text-sm text-tertiary">Nothing recorded since {records.epochWeek}.</p> : (
          <ol className="flex flex-col gap-2">
            {history.map((c) => {
              const key = `${c.week}:${c.personId}:${c.routineId}:${c.day}`;
              return (
                <li key={key} data-history-key={key} data-history-status={c.status} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-secondary bg-secondary px-4 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{routineIcon(c.routineId)} {childName(c.personId)} · {routineTitle(c.routineId)}{(c.creditCount ?? 1) > 1 ? ` ×${c.creditCount}` : ""} <span className="font-normal text-tertiary">· {dayLabels[c.day]} {c.week} ({occurrenceDateOf(c.week, c.day) ?? "?"})</span></p>
                    <p className="text-xs text-tertiary">{STATUS_LABEL[c.status]}{typeof c.awardedPoints === "number" && c.status === "done" ? ` · 🪙 +${c.awardedPoints}` : ""}{c.approvalSource ? ` · ${c.approvalSource === "parent-assisted" ? "entered by a parent" : "parent-reviewed"}` : c.status === "done" && c.reviewedAt ? " · parent-reviewed" : c.status === "done" ? " · self-marked (never unlocks chess)" : ""}</p>
                    {c.normalizedSummary ? <p className="text-xs text-secondary">{c.normalizedSummary}</p> : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {c.status === "done" ? (
                      <>
                        <button type="button" onClick={() => setCount(c, Math.max(1, (c.creditCount ?? 1) - 1))} className={secondaryPill} aria-label="One unit fewer">−1</button>
                        <button type="button" onClick={() => setCount(c, Math.min(20, (c.creditCount ?? 1) + 1))} className={secondaryPill} aria-label="One unit more">+1</button>
                        <button type="button" onClick={() => review(c, "hold")} className={secondaryPill}>Hold</button>
                      </>
                    ) : c.status === "redo" ? null : null}
                    <button type="button" onClick={() => undoCompletion(c)} className={secondaryPill}>Undo</button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* 5. Spending with undo (purchases refund exactly once) */}
      <section aria-label="Spending" className={card}>
        <h2 className="text-lg font-semibold">Spending</h2>
        {!records ? <p className="text-sm text-tertiary">Loading…</p> : spending.length === 0 ? <p className="text-sm text-tertiary">Nothing spent since {records.epochWeek}.</p> : (
          <ol className="flex flex-col gap-2">
            {spending.map((r) => {
              const purchase = r.rewardId === PLAY_PURCHASE_REWARD_ID ? records.purchases.find((p) => p.redemptionId === r.id) ?? null : null;
              const reward = rewardDefinitions.find((d) => d.id === r.rewardId);
              return (
                <li key={r.id} data-redemption-id={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-secondary bg-secondary px-4 py-2">
                  <p className="text-sm"><span className="font-semibold">{purchase ? "🎮 Game Studio time · 15 minutes" : `${reward?.icon ?? "🎁"} ${reward?.title ?? r.rewardId}`}</span> <span className="text-tertiary">· {childName(r.personId)} · {r.week} · 🪙 −{r.chargedPoints}{reward?.retired ? " · retired reward (history only)" : ""}</span></p>
                  <button type="button" onClick={() => undoRedemption(r)} className={secondaryPill}>{purchase ? "Refund" : "Undo"}</button>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* 6. Routine configuration */}
      <section aria-label="Routines" className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Routines</h2>
          <span className="text-xs text-tertiary" data-config-status={saveStatus}>{saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved" : saveStatus === "failed" ? "Save failed" : ""}</span>
        </div>
        {!config ? <p className="text-sm text-tertiary">Loading…</p> : (
          <div className="grid gap-4 sm:grid-cols-2">
            {CHILD_IDS.map((child) => (
              <div key={child} className="flex flex-col gap-2">
                <p className="text-sm font-semibold">{childName(child)}</p>
                {routineDefinitions.filter((r) => r.assignedTo.includes(child)).map((r) => {
                  const ov = config.routineOverrides[r.id] ?? {};
                  const enabled = ov.enabled !== false;
                  const target = "weeklyTarget" in ov ? ov.weeklyTarget : r.weeklyTarget;
                  const points = ov.points ?? r.points;
                  return (
                    <div key={r.id} data-routine-config={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-secondary bg-secondary px-3 py-2 text-sm">
                      <label className="flex items-center gap-2"><input type="checkbox" checked={enabled} onChange={(e) => changeRoutine(r.id, { enabled: e.target.checked })} /> {r.icon} {r.title}</label>
                      <span className="flex items-center gap-2 text-xs text-tertiary">
                        <label>per week <input type="number" min={0} max={7} value={target ?? ""} placeholder="–" onChange={(e) => changeRoutine(r.id, { weeklyTarget: e.target.value === "" ? null : Number(e.target.value) })} className="w-12 rounded-lg border border-primary bg-primary px-1 text-center" /></label>
                        <label>coins <input type="number" min={0} max={10} value={points} onChange={(e) => changeRoutine(r.id, { points: Number(e.target.value) })} className="w-12 rounded-lg border border-primary bg-primary px-1 text-center" /></label>
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-tertiary">The five old catalog rewards (friends, mini-game, movie night, excursion, trip) are retired: nothing new can be redeemed for them; their history stays above.</p>
      </section>

      {/* 7. Upcoming dates (canonical DATES.md projection) */}
      <section aria-label="Upcoming dates" className={card}>
        <h2 className="text-lg font-semibold">Upcoming dates</h2>
        <ol className="flex flex-col gap-1">
          {milestones.map((m) => (
            <li key={m.id} data-milestone-id={m.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span><span className="font-semibold">{m.label}</span> <span className="text-tertiary">· {m.when}</span></span>
              <span className={cn("text-xs", m.status === "planning-window" ? "font-medium text-utility-warning-600 dark:text-utility-warning-400" : "text-quaternary")}>{m.daysUntil === 0 ? "Today" : m.daysUntil === 1 ? "Tomorrow" : `${m.daysUntil} days`} · {m.planning}</span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

/** ISO week id of a `YYYY-MM-DD` date, or null. */
export function isoWeekOf(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [y, m, d] = date.split("-").map(Number);
  const wall = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(wall.getTime())) return null;
  const dayNumber = wall.getUTCDay() || 7;
  wall.setUTCDate(wall.getUTCDate() + 4 - dayNumber);
  const isoYear = wall.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((wall.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** Monday-zero weekday of a `YYYY-MM-DD` date, or null. */
export function weekdayOf(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [y, m, d] = date.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return Number.isNaN(js) ? null : js === 0 ? 6 : js - 1;
}
