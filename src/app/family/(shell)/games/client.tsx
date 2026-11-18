"use client";

// ---------------------------------------------------------------------------
// Games — October 8, 2026 policy (UI-10, SC-01), chess price of November 1, 2026.
//
// Two clearly separate things, one page:
//   1. Chess: 1 coin → 15 minutes of digital chess on its own allowance, from
//      the permanent wallet, no activity requirement. The status here is the
//      server's (remaining, price); the launch goes through the guarded play
//      surface.
//   2. Game Studio: the approved library plus the child's own games, all on ONE
//      paid allowance (3 coins → 15 minutes) that covers making, changing and
//      playing.
// Both are bought only by an explicit confirmation showing the exact price and
// the authoritative balance; the server commits or refuses. Since November 18,
// 2026 the buying itself is the shared rows of `components/family/coin-redeem`
// (the same flow and look as Coins): one row per block, price in plain words. Looking, opening
// and cancelling the confirmation cost nothing. No shop, no generic mini-game
// checkout, no duplicate chess card.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/components/ui/nabu";
import { assistantProfileById } from "@/data/family-assistant";
import { useChildShell } from "@/components/family/child-shell-provider";
import { CoinRedeemRows, settlePlayState, useCoinPurchase } from "@/components/family/coin-redeem";
import type { ChildId } from "@/lib/family-assistant-turn";
import { approvedGameLibrary, childGameIdentity, childShellDestinationHref, guardedPlayHref } from "@/lib/family-child-shell";
import { createGamesClient, type LibraryGame, type PlayStateView, type StudioAccess } from "@/lib/family-games-client";
import { DAILY_CHESS_GAME_ID, formatPlayClock, type BudgetKind } from "@/lib/family-play";
import { currentNativeSupport } from "@/lib/family-native-games";

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

/** Child-readable chess status from the server numbers only; null when the answer carries no chess price (a server without it). */
export function chessStatusCopy(chess: PlayStateView["chess"] | undefined): { headline: string; detail: string; playable: boolean } | null {
  if (!chess?.price || typeof chess.remainingSeconds !== "number") return null;
  const minutes = Math.round(chess.price.seconds / 60);
  if (chess.remainingSeconds > 0) {
    return { headline: `${formatPlayClock(chess.remainingSeconds)} of chess left`, detail: "Your chess time follows you on every screen. Only visible play counts — pausing stops the clock.", playable: true };
  }
  return { headline: `Chess: 🪙 ${chess.price.coins} for ${minutes} minutes`, detail: `Buy ${minutes} minutes when you want to play. Chess on the real board is always free.`, playable: false };
}

function Games({ child }: { child: ChildId }) {
  const { refreshWallet } = useChildShell();
  const profile = assistantProfileById(child)!;
  const client = useMemo(() => createGamesClient(), []);
  const [state, setState] = useState<StateLoad>({ kind: "loading" });
  const [library, setLibrary] = useState<LibraryLoad>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const identity = childGameIdentity(child)!;
  // A native (Mac app) card offers Play only in a browser on the family Mac itself: a desktop-Mac user agent first,
  // then Game Studio's answer from the tailnet device address (the server cannot know the device at render time).
  const [macDesktop, setMacDesktop] = useState(false);
  const nativeStudio = library.kind === "ready" && library.games.some((g) => g.launch === "native") ? library.studio : null;
  useEffect(() => {
    setMacDesktop(false);
    if (!nativeStudio || !currentNativeSupport().supported) return;
    const controller = new AbortController();
    void client.nativeDevice(nativeStudio, controller.signal).then((r) => {
      if (!controller.signal.aborted) setMacDesktop(r.ok && r.value.thisMac);
    });
    return () => controller.abort();
  }, [client, nativeStudio]);

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
      // Chess has its own card above; it is never listed twice.
      setLibrary({ kind: "ready", games: lib.value.games.filter((g) => g.gameId !== DAILY_CHESS_GAME_ID), canCreate: lib.value.canCreate, studio: session.studio });
    })();
    return () => controller.abort();
  }, [child, client, attempt]);

  // Purchase — the shared flow (explicit confirmation per block, idempotency key per confirmed tap, double-tap guard).
  const onSettled = useCallback((kind: BudgetKind, balance: number, remaining: number | null) => {
    setState((prev) => (prev.kind === "ready" ? { kind: "ready", state: settlePlayState(prev.state, kind, balance, remaining) } : prev));
    refreshWallet();
  }, [refreshWallet]);
  const purchase = useCoinPurchase(child, client, onSettled);

  const chess = state.kind === "ready" ? chessStatusCopy(state.state.chess) : null;
  const chessCard = approvedGameLibrary[0];

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-5 pb-[max(3rem,env(safe-area-inset-bottom))] sm:px-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-quaternary">Games</p>
        <h1 className="text-2xl font-semibold">{profile.displayName}&rsquo;s games</h1>
      </div>

      {/* Chess — its own purchased allowance (server status only); buying is in the rows below. */}
      <section aria-label="Chess" className={cn(cardClass)} data-chess-remaining={state.kind === "ready" ? state.state.chess?.remainingSeconds ?? "" : ""}>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{chessCard.title}</h2>
          <p className="text-sm text-tertiary">{chessCard.tagline}</p>
        </div>
        {state.kind === "ready" && chess?.playable ? (
          <div className="flex flex-wrap items-center gap-3">
            <Link href={chessCard.hrefFor(identity)} className={cn(pillClass, "min-h-14 bg-secondary px-6 text-lg text-primary hover:bg-primary")} data-chess-play>♟️ Play chess</Link>
            <p role="status" className="text-base font-semibold text-primary">{chess.headline}</p>
          </div>
        ) : null}
      </section>

      {/* Buying time — the shared purchase rows (same flow and look as Coins; server numbers only). */}
      <section aria-label="Play time" className="flex flex-col gap-3" data-remaining-seconds={state.kind === "ready" ? state.state.remainingSeconds : undefined}>
        <h2 className="text-lg font-semibold">🪙 Zeit kaufen</h2>
        {state.kind === "loading" ? (
          <p className="text-sm text-tertiary">…</p>
        ) : state.kind === "error" ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-primary bg-primary px-5 py-4">
            <p className="text-sm text-secondary">Couldn&rsquo;t load your time.</p>
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>↻ Try again</button>
          </div>
        ) : (
          <>
            <CoinRedeemRows state={state.state} purchase={purchase} />
            {state.state.activeLease ? (
              <p className="text-xs text-tertiary">{state.state.activeLease.mode === "edit" ? "The studio is open" : "A game is open"} on {state.state.activeLease.deviceLabel ? `another ${state.state.activeLease.deviceLabel}` : "another screen"}. Opening one here continues the same time.</p>
            ) : null}
          </>
        )}
      </section>

      {/* Studio library — through the child adapter only (G1). */}
      <section aria-label="Approved games" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Game Studio</h2>
          {library.kind === "ready" && library.canCreate ? (
            <Link href={`/family/games/edit?child=${encodeURIComponent(child)}`} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>✨ Make or change a game (uses Game Studio time)</Link>
          ) : null}
        </div>
        {library.kind === "loading" ? (
          <p className="text-sm text-tertiary">Loading the library…</p>
        ) : library.kind === "unconfigured" ? (
          <p className="rounded-3xl border border-dashed border-primary bg-primary/60 px-5 py-4 text-sm text-tertiary">Game Studio isn&rsquo;t connected on this server yet. Games and timed chess come here once it is linked.</p>
        ) : library.kind === "unreachable" ? (
          <div className="flex flex-col items-start gap-3 rounded-3xl border border-primary bg-primary px-5 py-4">
            <p className="text-sm text-secondary">Game Studio isn&rsquo;t reachable from this device right now — it needs the home network connection. Chess on the real board still works.</p>
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>↻ Try again</button>
          </div>
        ) : library.kind === "error" ? (
          <div className="flex flex-col items-start gap-3 rounded-3xl border border-primary bg-primary px-5 py-4">
            <p className="text-sm text-secondary">The library couldn&rsquo;t load.</p>
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>↻ Try again</button>
          </div>
        ) : library.games.length === 0 ? (
          <p className="rounded-3xl border border-dashed border-primary bg-primary/60 px-5 py-4 text-sm text-tertiary">No approved Studio games yet. A parent approves games in Game Studio; your own games appear here once you make one.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {library.games.map((game) => (
              <article key={game.gameId} className={cardClass} data-game-id={game.gameId}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold">{game.title}</h3>
                    {game.tagline ? <p className="text-sm text-tertiary">{game.tagline}</p> : null}
                    <p className="text-xs text-quaternary">{game.launch === "native" ? "Mac app · approved by a parent" : game.source === "own" ? "Your own game" : "Approved by a parent"}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {game.launch === "native" && !macDesktop ? (
                    <span className="text-sm text-tertiary" data-native-elsewhere>Plays on the family Mac</span>
                  ) : game.playable ? (
                    <Link href={guardedPlayHref(identity, game.gameId, "play")} className={cn(pillClass, "bg-secondary text-primary hover:bg-primary")}>{game.launch === "native" ? "▶ Play on this Mac" : "▶ Play"}</Link>
                  ) : (
                    <span className="text-sm text-tertiary">Not playable yet ({game.status})</span>
                  )}
                  {game.source === "own" ? (
                    <Link href={guardedPlayHref(identity, game.gameId, "edit")} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>✏️ Change</Link>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <p className="text-xs text-tertiary">
        <Link href={childShellDestinationHref("home", child)} className="underline">Back to Home</Link> · Game saves stay on the device you play on; your time follows you across devices, saves don&rsquo;t.
      </p>
    </main>
  );
}
