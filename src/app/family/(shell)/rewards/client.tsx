"use client";

// ---------------------------------------------------------------------------
// Coins — the child's coin screen (UI-03, October 8, 2026; simplified
// November 18, 2026 for 7- and 9-year-olds). The 🪙 pill in the shell bar
// ("redeem") lands here, so this is where a child spends coins:
//   - the balance, once, big;
//   - one row per thing coins buy (chess, Game Studio) with the price in plain
//     words and one big button — the shared purchase flow in
//     `components/family/coin-redeem.tsx`, the same one Games shows;
//   - one quiet line with earned/spent from the permanent wallet projection
//     (W = E − S since the wallet epoch, 2026-W34) and where coins come from.
// No week navigation, no weekly number, no shop, no catalog rewards. The URL
// stays `/family/rewards` so installed shortcuts keep working.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/components/ui/nabu";
import { useChildShell } from "@/components/family/child-shell-provider";
import { CoinRedeemRows, coinWord, settlePlayState, useCoinPurchase } from "@/components/family/coin-redeem";
import type { ChildId } from "@/lib/family-assistant-turn";
import { approvedGameLibrary, childGameIdentity, childShellDestinationHref } from "@/lib/family-child-shell";
import { createGamesClient, type PlayStateView } from "@/lib/family-games-client";
import { CHESS_BLOCK_COINS, CHESS_BLOCK_SECONDS, PLAY_BLOCK_COINS, PLAY_BLOCK_SECONDS, type BudgetKind } from "@/lib/family-play";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500";
const pillClass = cn(
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-primary px-5 py-2 text-base font-semibold transition-colors",
  focusRing,
);

type StateLoad = { kind: "loading" } | { kind: "ready"; state: PlayStateView } | { kind: "error" };

export function FamilyRewardsClient() {
  const { child } = useChildShell();
  if (!child) return null;
  return <Coins key={child} child={child} />;
}

function Coins({ child }: { child: ChildId }) {
  const { wallet, refreshWallet } = useChildShell();
  const known = wallet.status === "ready" ? wallet.wallet : wallet.status === "loading" || wallet.status === "error" ? wallet.wallet : null;
  const epoch = wallet.status === "ready" ? wallet.projection.epochWeek : null;

  // The server's play state: authoritative prices, remaining time and the balance a purchase is decided on.
  const client = useMemo(() => createGamesClient(), []);
  const [state, setState] = useState<StateLoad>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    void client.state(child, controller.signal).then((s) => {
      if (controller.signal.aborted) return;
      if (s.ok && s.value.child === child) setState({ kind: "ready", state: s.value });
      else if (!s.ok) setState({ kind: "error" });
    });
    return () => controller.abort();
  }, [child, client, attempt]);
  const onSettled = useCallback((kind: BudgetKind, balance: number, remaining: number | null) => {
    setState((prev) => (prev.kind === "ready" ? { kind: "ready", state: settlePlayState(prev.state, kind, balance, remaining) } : prev));
    refreshWallet();
  }, [refreshWallet]);
  const purchase = useCoinPurchase(child, client, onSettled);

  // Chess launches through the guarded play surface (DA-04); Studio games are picked on Games.
  const playHref = useMemo(() => ({ chess: approvedGameLibrary[0].hrefFor(childGameIdentity(child)!), paid: childShellDestinationHref("games", child) }), [child]);
  const balance = state.kind === "ready" ? state.state.balance : known ? known.balance : null;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-5 pb-[max(3rem,env(safe-area-inset-bottom))] sm:px-6">
      <section aria-label="Deine Münzen" className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-medium text-tertiary">Deine Münzen</h1>
          <p className="text-5xl font-semibold" aria-live="polite" data-wallet-balance={known ? known.balance : ""}>
            🪙 {balance ?? "…"}
          </p>
        </div>
        {wallet.status === "error" && !known ? (
          <button type="button" onClick={refreshWallet} className={cn(pillClass, "bg-secondary text-primary hover:bg-primary")}>↻ Nochmal</button>
        ) : null}
      </section>

      <section aria-label="Zeit kaufen" className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Was möchtest du?</h2>
        {state.kind === "ready" ? (
          <CoinRedeemRows state={state.state} purchase={purchase} playHref={playHref} />
        ) : state.kind === "loading" ? (
          <ul className="flex flex-col gap-3" aria-busy="true">
            {[
              ["♟️", "Schach", CHESS_BLOCK_COINS, CHESS_BLOCK_SECONDS],
              ["🎮", "Game Studio", PLAY_BLOCK_COINS, PLAY_BLOCK_SECONDS],
            ].map(([icon, title, coins, seconds]) => (
              <li key={String(title)} className="flex items-center gap-4 rounded-3xl border border-secondary bg-primary p-4 opacity-60 sm:p-5">
                <span aria-hidden="true" className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-secondary text-4xl">{icon}</span>
                <div>
                  <p className="text-xl font-semibold">{title}</p>
                  <p className="text-lg text-secondary">{Number(seconds) / 60} Minuten · 🪙 {coins} {coinWord(Number(coins))}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-primary bg-primary p-5">
            <p className="text-lg text-secondary">Das hat nicht geladen.</p>
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className={cn(pillClass, "bg-secondary text-primary hover:bg-primary")}>↻ Nochmal</button>
          </div>
        )}
      </section>

      <p className="text-sm text-tertiary">
        <span data-wallet-earned={known ? known.earned : ""}>Verdient 🪙 {known ? known.earned : "…"}</span>
        {" · "}
        <span data-wallet-spent={known ? known.spent : ""}>Ausgegeben 🪙 {known ? known.spent : "…"}</span>
        {epoch ? <span className="sr-only"> (seit {epoch})</span> : null}
        {" · "}
        <Link href={childShellDestinationHref("activity", child)} className="underline">Woher?</Link>
        {" · "}
        <Link href={childShellDestinationHref("games", child)} className="underline">🎮 Spiele</Link>
      </p>
    </main>
  );
}
