"use client";

// ---------------------------------------------------------------------------
// Home — the child's menu, not the chat screen (FH-01/FH-05/FH-06/FH-07).
//
// Composes read-only projections: the shared wallet from the shell provider,
// a Start/Continue label from the child's own saved learning state, and
// links into every existing capability. Every action writes through its
// owning surface; nothing here computes coins or learning state.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/components/ui/nabu";
import { assistantProfileById } from "@/data/family-assistant";
import { useChildShell } from "@/components/family/child-shell-provider";
import type { ChildId } from "@/lib/family-assistant-turn";
import { childShellDestinationHref } from "@/lib/family-child-shell";
import { browserTimeZone, createLearningClient } from "@/lib/family-learning-client";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500";

const actionClass = cn(
  "flex min-h-24 items-center gap-4 rounded-2xl border border-primary bg-primary px-5 py-4 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-md dark:shadow-none",
  focusRing,
);
const actionIconClass = "grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-secondary text-3xl";
const pillClass = cn(
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-primary bg-secondary px-5 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary",
  focusRing,
);

type LearnLabel =
  | { kind: "loading" }
  | { kind: "continue"; title: string; ordinal: number | null }
  | { kind: "start"; ordinal: number | null; label: string | null }
  | { kind: "waiting"; reason: string | null }
  | { kind: "unprepared" }
  | { kind: "trouble" };

export function FamilyHomeClient({ canSeeFamilyOverview }: { canSeeFamilyOverview: boolean }) {
  const { child } = useChildShell();
  if (!child) return null;
  // Keyed by child: switching profiles discards the other child's labels instantly.
  return <Home key={child} child={child} canSeeFamilyOverview={canSeeFamilyOverview} />;
}

function Home({ child, canSeeFamilyOverview }: { child: ChildId; canSeeFamilyOverview: boolean }) {
  const { wallet, refreshWallet } = useChildShell();
  const profile = assistantProfileById(child)!;
  const client = useMemo(() => createLearningClient(), []);
  const [learn, setLearn] = useState<LearnLabel>({ kind: "loading" });

  // FH-05: the label comes from THIS child's saved state, read under this
  // child's own learning credential — Isabel never receives Santiago's tasks.
  useEffect(() => {
    const abort = new AbortController();
    (async () => {
      const outcome = await client.read(child, { signal: abort.signal, timeZone: browserTimeZone() });
      if (abort.signal.aborted) return;
      if (!outcome.ok) {
        setLearn(outcome.status === 404 || outcome.failure === "unprepared" ? { kind: "unprepared" } : { kind: "trouble" });
        return;
      }
      const view = outcome.view;
      if (view.visit) setLearn({ kind: "continue", title: view.visit.title, ordinal: view.visit.ordinal });
      else if (view.next.visit) setLearn({ kind: "start", ordinal: view.next.ordinal, label: view.progress.next.label ?? null });
      else setLearn({ kind: "waiting", reason: view.next.reason });
    })();
    return () => abort.abort();
  }, [child, client]);

  const href = (destination: Parameters<typeof childShellDestinationHref>[0]) => childShellDestinationHref(destination, child);
  const balance = wallet.status === "ready" ? wallet.wallet : wallet.status === "loading" || wallet.status === "error" ? wallet.wallet : null;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-5 pb-[max(3rem,env(safe-area-inset-bottom))] sm:px-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-[-0.02em] text-primary">{profile.greeting}</h1>
        <p className="mt-1 text-base text-tertiary">What do you want to do?</p>
      </div>

      {/* Wallet — the same server projection as the header chip and Redeem (FH-06). */}
      <section aria-label="Coin wallet" className="flex flex-col gap-4 rounded-3xl border border-primary bg-primary px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-quaternary">Your coins</p>
            {wallet.status === "error" && !balance ? (
              <p className="text-lg font-semibold text-primary">Couldn&rsquo;t load your wallet</p>
            ) : (
              <p className="text-3xl font-semibold" aria-live="polite">
                🪙 You have {balance ? balance.balance : "…"} coins
              </p>
            )}
            {balance ? (
              <p className={cn("text-sm text-tertiary", wallet.status !== "ready" && "italic")}>
                {wallet.status === "ready" ? `${balance.earned} earned · ${balance.spent} spent` : "updating…"}
              </p>
            ) : null}
          </div>
          {wallet.status === "error" ? (
            <button type="button" onClick={refreshWallet} className={pillClass}>
              ↻ Try again
            </button>
          ) : null}
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Link href={href("record")} className={pillClass}>🎙️ Record something I did</Link>
          <Link href={href("rewards")} className={pillClass}>🏅 Redeem</Link>
          <Link href={href("activity")} className={pillClass}>🗓️ See activity</Link>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <HomeAction href={href("learn")} icon="🧭" title="Lernen" className="sm:col-span-2">
          <LearnCaption label={learn} />
        </HomeAction>
        <HomeAction href={`${href("assistant")}&focus=general`} icon="💬" title="Ask Nabu">
          Questions, ideas and help — talk or type
        </HomeAction>
        <HomeAction href={href("games")} icon="🎮" title="Games">
          Approved games — chess is free, others cost coins to play
        </HomeAction>
      </div>

      {/* Music and Hörspiele keep both capabilities inside one audio section. */}
      <section aria-label="Listen" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Listen</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <HomeAction href={`${href("assistant")}&focus=music`} icon="🎵" title="Music">
            Say what you want to hear — you pick before it plays
          </HomeAction>
          <HomeAction href={href("listen")} icon="🎧" title="Hörspiele">
            Your stories — browse, play and continue
          </HomeAction>
        </div>
      </section>

      {canSeeFamilyOverview ? (
        <nav aria-label="Parent links" className="flex flex-wrap gap-2 pt-2 text-sm">
          <Link href="/family" className={pillClass}>Family overview</Link>
          <Link href="/family/dashboard" className={pillClass}>Family board</Link>
          <Link href="/family/learn/parent" className={pillClass}>Learning (parent)</Link>
        </nav>
      ) : null}
    </main>
  );
}

function HomeAction({ href, icon, title, className, children }: { href: string; icon: string; title: string; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={cn(actionClass, className)}>
      <span className={actionIconClass} aria-hidden>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-lg font-semibold text-primary">{title}</span>
        <span className="block text-sm text-tertiary">{children}</span>
      </span>
    </Link>
  );
}

function LearnCaption({ label }: { label: LearnLabel }) {
  switch (label.kind) {
    case "loading":
      return <>Deine Expedition wird geladen…</>;
    case "continue":
      return <>Weitermachen: {label.title}</>;
    case "start":
      return <>Starten: {label.label ?? (label.ordinal ? `Besuch ${label.ordinal}` : "nächster Besuch")}</>;
    case "waiting":
      return <>{label.reason ?? "Heute ist Pause — deine Basis bleibt gespeichert."}</>;
    case "unprepared":
      return <>Deine Expedition ist noch nicht vorbereitet.</>;
    case "trouble":
      return <>Die Expedition ist gerade nicht erreichbar — deine Basis bleibt sicher.</>;
  }
}
