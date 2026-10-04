"use client";

// ---------------------------------------------------------------------------
// Games — the approved library and the shared play-time allowance (GP-01,
// GP-02, GP-09). The chess pilot is free and local; Studio games come from the
// Game Studio child adapter on the tailnet and cost 3 coins per shared
// 15-minute allowance. Buying is an explicit confirmation showing the exact
// price and the authoritative balance; the server commits or refuses.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/components/ui/nabu";
import { assistantProfileById } from "@/data/family-assistant";
import { useChildShell } from "@/components/family/child-shell-provider";
import type { ChildId } from "@/lib/family-assistant-turn";
import { approvedGameLibrary, childGameIdentity, childShellDestinationHref, guardedPlayHref } from "@/lib/family-child-shell";
import { createGamesClient, newIdempotencyKey, type LibraryGame, type PlayStateView, type StudioAccess } from "@/lib/family-games-client";
import { formatPlayClock } from "@/lib/family-play";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500";
const pillClass = cn(
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-primary px-5 py-2 text-sm font-semibold transition-colors",
  focusRing,
);
const cardClass = "flex min-w-0 flex-col gap-3 rounded-3xl border border-primary bg-primary p-5";

type StateLoad = { kind: "loading" } | { kind: "ready"; state: PlayStateView } | { kind: "error"; failure: string };
type LibraryLoad = { kind: "loading" } | { kind: "ready"; games: LibraryGame[]; canCreate: boolean; studio: StudioAccess } | { kind: "unconfigured" } | { kind: "unreachable" } | { kind: "error" };

export function FamilyGamesClient() {
  const { child } = useChildShell();
  if (!child) return null;
  return <Games key={child} child={child} />;
}

function Games({ child }: { child: ChildId }) {
  const { refreshWallet } = useChildShell();
  const profile = assistantProfileById(child)!;
  const client = useMemo(() => createGamesClient(), []);
  const [state, setState] = useState<StateLoad>({ kind: "loading" });
  const [library, setLibrary] = useState<LibraryLoad>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const identity = childGameIdentity(child)!;

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    setLibrary({ kind: "loading" });
    (async () => {
      const s = await client.state(child, controller.signal);
      if (controller.signal.aborted) return;
      if (!s.ok) {
        setState({ kind: "error", failure: s.failure });
      } else if (s.value.child !== child) {
        return;
      } else {
        setState({ kind: "ready", state: s.value });
      }
      const session = await client.session(child, controller.signal);
      if (controller.signal.aborted) return;
      if (!session) {
        setLibrary({ kind: "error" });
        return;
      }
      if (!session.studio) {
        setLibrary({ kind: "unconfigured" });
        return;
      }
      const lib = await client.library(session.studio, controller.signal);
      if (controller.signal.aborted) return;
      if (!lib.ok) {
        setLibrary(lib.failure === "network" || lib.failure === "unavailable" ? { kind: "unreachable" } : { kind: "error" });
        return;
      }
      if (lib.value.child !== child) return;
      setLibrary({ kind: "ready", games: lib.value.games, canCreate: lib.value.canCreate, studio: session.studio });
    })();
    return () => controller.abort();
  }, [child, client, attempt]);

  // Purchase — explicit confirmation, idempotency key per confirmed tap.
  const [confirming, setConfirming] = useState(false);
  const [buying, setBuying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);
  const buy = useCallback(async () => {
    if (buying) return;
    setBuying(true);
    setNotice(null);
    if (!keyRef.current) keyRef.current = newIdempotencyKey();
    const outcome = await client.purchase(child, keyRef.current);
    setBuying(false);
    if (outcome.ok) {
      keyRef.current = null;
      setConfirming(false);
      setNotice(outcome.value.replayed ? "Already bought — your time is ready." : "15 minutes added.");
      setState((prev) => (prev.kind === "ready" ? { kind: "ready", state: { ...prev.state, balance: outcome.value.balance, remainingSeconds: outcome.value.remainingSeconds } } : prev));
      refreshWallet();
      return;
    }
    if (outcome.failure === "insufficient") {
      keyRef.current = null;
      setConfirming(false);
      setNotice("Not enough coins yet — keep going!");
      const detail = outcome.detail as { balance?: number; remainingSeconds?: number } | undefined;
      if (detail && typeof detail.balance === "number") {
        setState((prev) => (prev.kind === "ready" ? { kind: "ready", state: { ...prev.state, balance: detail.balance!, remainingSeconds: detail.remainingSeconds ?? prev.state.remainingSeconds } } : prev));
      }
      return;
    }
    // Network/unknown: keep the SAME key so a retry can only replay, never double-charge.
    setNotice("That didn't go through — tap Buy again; you will not be charged twice.");
  }, [buying, child, client, refreshWallet]);

  const price = state.kind === "ready" ? state.state.price : { coins: 3, seconds: 900 };

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-5 pb-[max(3rem,env(safe-area-inset-bottom))] sm:px-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-quaternary">Games</p>
        <h1 className="text-2xl font-semibold">{profile.displayName}&rsquo;s games</h1>
        <p className="text-sm text-tertiary">Chess is free. Other approved games use play time: {price.coins} coins buy {Math.round(price.seconds / 60)} minutes of active play, shared across them.</p>
      </div>

      {/* Allowance — server numbers only (GP-05). */}
      <section aria-label="Play time" className="flex flex-col gap-3 rounded-3xl border border-primary bg-primary px-5 py-4">
        {state.kind === "loading" ? (
          <p className="text-sm text-tertiary">Checking your play time…</p>
        ) : state.kind === "error" ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-secondary">Couldn&rsquo;t load your play time.</p>
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>↻ Try again</button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-quaternary">Play time left</p>
                <p className="text-3xl font-semibold" data-remaining-seconds={state.state.remainingSeconds}>⏱️ {formatPlayClock(state.state.remainingSeconds)}</p>
                <p className="text-sm text-tertiary">You have 🪙 {state.state.balance} coins.</p>
              </div>
              {!confirming ? (
                <button type="button" onClick={() => { setConfirming(true); setNotice(null); }} disabled={state.state.balance < price.coins} className={cn(pillClass, state.state.balance >= price.coins ? "bg-secondary text-primary hover:bg-primary" : "cursor-not-allowed bg-primary text-quaternary")}>
                  {state.state.balance >= price.coins ? `Buy ${Math.round(price.seconds / 60)} minutes for 🪙 ${price.coins}` : `${price.coins - state.state.balance} more coins for ${Math.round(price.seconds / 60)} minutes`}
                </button>
              ) : (
                <div role="group" aria-label="Confirm purchase" className="flex flex-col items-end gap-2 rounded-2xl border border-primary bg-secondary px-4 py-3">
                  <p className="text-sm font-medium text-primary">Spend 🪙 {price.coins} of your {state.state.balance} coins for {Math.round(price.seconds / 60)} minutes of play?</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => { setConfirming(false); keyRef.current = null; }} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>Not now</button>
                    <button type="button" onClick={buy} disabled={buying} className={cn(pillClass, "bg-secondary text-primary hover:bg-primary")}>{buying ? "Buying…" : `Yes, buy for 🪙 ${price.coins}`}</button>
                  </div>
                </div>
              )}
            </div>
            {notice ? <p role="status" className="text-sm font-medium text-secondary">{notice}</p> : null}
            {state.state.activeLease ? (
              <p className="text-xs text-tertiary">A game is open on {state.state.activeLease.deviceLabel ? `another ${state.state.activeLease.deviceLabel}` : "another screen"}. Opening a game here continues the same time.</p>
            ) : null}
          </>
        )}
      </section>

      {/* Free pilot — local, ungated (GP-01). */}
      <section aria-label="Free games" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Free</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {approvedGameLibrary.map((game) => (
            <Link key={game.gameId} href={game.hrefFor(identity)} className={cn(cardClass, "transition-colors hover:bg-secondary", focusRing)}>
              <span className="flex items-center justify-between gap-2"><span className="text-lg font-semibold">{game.title}</span><span className="rounded-full border border-secondary px-3 py-1 text-xs font-medium text-tertiary">Free</span></span>
              <span className="text-sm text-tertiary">{game.tagline}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Studio library — through the child adapter only (G1). */}
      <section aria-label="Approved games" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Approved games</h2>
          {library.kind === "ready" && library.canCreate ? (
            <Link href={`/family/games/edit?child=${encodeURIComponent(child)}`} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>✨ Make or change a game</Link>
          ) : null}
        </div>
        {library.kind === "loading" ? (
          <p className="text-sm text-tertiary">Loading the library…</p>
        ) : library.kind === "unconfigured" ? (
          <p className="rounded-3xl border border-dashed border-primary bg-primary/60 px-5 py-4 text-sm text-tertiary">The game library isn&rsquo;t connected on this server yet. Chess works; other games come here once Game Studio is linked.</p>
        ) : library.kind === "unreachable" ? (
          <div className="flex flex-col items-start gap-3 rounded-3xl border border-primary bg-primary px-5 py-4">
            <p className="text-sm text-secondary">Game Studio isn&rsquo;t reachable from this device right now — it needs the home network connection. Chess still works.</p>
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>↻ Try again</button>
          </div>
        ) : library.kind === "error" ? (
          <div className="flex flex-col items-start gap-3 rounded-3xl border border-primary bg-primary px-5 py-4">
            <p className="text-sm text-secondary">The library couldn&rsquo;t load.</p>
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>↻ Try again</button>
          </div>
        ) : library.games.length === 0 ? (
          <p className="rounded-3xl border border-dashed border-primary bg-primary/60 px-5 py-4 text-sm text-tertiary">No approved games yet. A parent approves games in Game Studio.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {library.games.map((game) => (
              <article key={game.gameId} className={cardClass} data-game-id={game.gameId}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold">{game.title}</h3>
                    {game.tagline ? <p className="text-sm text-tertiary">{game.tagline}</p> : null}
                    <p className="text-xs text-quaternary">{game.source === "own" ? "Your own game" : "Approved by a parent"}</p>
                  </div>
                  <span className="shrink-0 rounded-full border border-secondary px-3 py-1 text-xs font-medium text-tertiary">{game.free ? "Free" : `🪙 ${price.coins} / ${Math.round(price.seconds / 60)} min`}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {game.playable ? (
                    <Link href={guardedPlayHref(identity, game.gameId, "play")} className={cn(pillClass, "bg-secondary text-primary hover:bg-primary")}>▶ Play</Link>
                  ) : (
                    <span className="text-sm text-tertiary">Not playable yet ({game.status})</span>
                  )}
                  {game.source === "own" ? (
                    <Link href={guardedPlayHref(identity, game.gameId, "edit")} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>✏️ Edit</Link>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <p className="text-xs text-tertiary">
        <Link href={childShellDestinationHref("home", child)} className="underline">Back to Home</Link> · Game saves stay on the device you play on; play time follows you across devices, saves don&rsquo;t.
      </p>
    </main>
  );
}
