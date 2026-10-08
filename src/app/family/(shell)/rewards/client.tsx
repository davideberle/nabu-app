"use client";

// ---------------------------------------------------------------------------
// Coins — the child shell's one wallet/progress/spending surface (UI-03,
// October 8, 2026). It renders the server-owned permanent wallet projection:
// available W, approved earned E since the wallet epoch (2026-W34) and spent S,
// with W = E − S. No week navigation, no "earned this week", no shop and no
// daily/weekly/long-term labels: the catalog rewards are retired, and the only
// thing coins buy is Game Studio time, through the one purchase flow on Games.
// The URL stays `/family/rewards` so installed shortcuts keep working.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { cn } from "@/components/ui/nabu";
import { assistantProfileById } from "@/data/family-assistant";
import { useChildShell } from "@/components/family/child-shell-provider";
import type { ChildId } from "@/lib/family-assistant-turn";
import { childShellDestinationHref } from "@/lib/family-child-shell";
import { PLAY_BLOCK_COINS, PLAY_BLOCK_SECONDS } from "@/lib/family-play";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500";
const pillClass = cn(
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-primary px-5 py-2 text-sm font-semibold transition-colors",
  focusRing,
);

export function FamilyRewardsClient() {
  const { child } = useChildShell();
  if (!child) return null;
  return <Coins key={child} child={child} />;
}

function Coins({ child }: { child: ChildId }) {
  const { wallet, refreshWallet } = useChildShell();
  const profile = assistantProfileById(child)!;
  const known = wallet.status === "ready" ? wallet.wallet : wallet.status === "loading" || wallet.status === "error" ? wallet.wallet : null;
  const epoch = wallet.status === "ready" ? wallet.projection.epochWeek : null;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-5 pb-[max(3rem,env(safe-area-inset-bottom))] sm:px-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-quaternary">Coins</p>
        <h1 className="text-2xl font-semibold">{profile.displayName}&rsquo;s coins</h1>
        <p className="text-sm text-tertiary">Every approved thing you did earns coins. They stay in your wallet until you spend them.</p>
      </div>

      <section aria-label="Coin wallet" className="flex flex-col gap-4 rounded-3xl border border-primary bg-primary px-5 py-4">
        {wallet.status === "error" && !known ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-lg font-semibold text-primary">Couldn&rsquo;t load your wallet</p>
            <button type="button" onClick={refreshWallet} className={cn(pillClass, "bg-secondary text-primary hover:bg-primary")}>↻ Try again</button>
          </div>
        ) : (
          <>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-quaternary">Available</p>
              <p className="text-4xl font-semibold" aria-live="polite" data-wallet-balance={known ? known.balance : ""}>
                🪙 {known ? known.balance : "…"}
              </p>
              {wallet.status !== "ready" && known ? <p className="text-sm italic text-tertiary">updating…</p> : null}
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl border border-secondary bg-secondary px-4 py-3">
                <dt className="text-xs font-medium uppercase tracking-[0.14em] text-quaternary">Earned</dt>
                <dd className="text-2xl font-semibold" data-wallet-earned={known ? known.earned : ""}>🪙 {known ? known.earned : "…"}</dd>
                <dd className="text-xs text-tertiary">approved{epoch ? ` since ${epoch}` : ""}</dd>
              </div>
              <div className="rounded-2xl border border-secondary bg-secondary px-4 py-3">
                <dt className="text-xs font-medium uppercase tracking-[0.14em] text-quaternary">Spent</dt>
                <dd className="text-2xl font-semibold" data-wallet-spent={known ? known.spent : ""}>🪙 {known ? known.spent : "…"}</dd>
                <dd className="text-xs text-tertiary">on Game Studio time</dd>
              </div>
            </dl>
          </>
        )}
      </section>

      <section aria-label="What coins buy" className="flex flex-col gap-3 rounded-3xl border border-primary bg-primary px-5 py-4">
        <h2 className="text-lg font-semibold">What coins buy</h2>
        <p className="text-sm text-secondary">
          🪙 {PLAY_BLOCK_COINS} coins = {PLAY_BLOCK_SECONDS / 60} minutes in Game Studio — making, changing and playing your own games. Chess is free every day you did something useful.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href={childShellDestinationHref("games", child)} className={cn(pillClass, "bg-secondary text-primary hover:bg-primary")}>🎮 Go to Games</Link>
          <Link href={childShellDestinationHref("activity", child)} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>🗓️ See what earned them</Link>
        </div>
      </section>
    </main>
  );
}
