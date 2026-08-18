"use client";

// ---------------------------------------------------------------------------
// Rewards — the child shell's rewards destination.
//
// Renders the selected child's real reward projection from the existing
// family model: the same three API reads as the boards
// (`/api/family/completions?week=`, `/api/family/redemptions?week=`,
// `/api/family/config`) and the same wallet math (`computeChildWallet`,
// asserted against `family-db.ts` by test). Redeeming posts to the existing
// `/api/family/redemptions` route, whose server-side balance check remains
// the enforcement point.
//
// The shell chrome (avatar, tabs, switcher) and the selected child live in
// the persistent `(shell)` layout provider, so navigating here never
// remounts them. The data covers the whole family for the viewed week, so
// switching child is a synchronous re-projection — no refetch, no
// intermediate mixed-child render. The game corner launches only through the
// fail-closed identity seam: hrefs are built from a validated
// `ChildGameIdentity`, never from a free-form string.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/components/ui/nabu";
import type { CompletionRecord } from "@/data/family-routines";
import type { FamilyBoardConfig, RewardRedemption } from "@/lib/family-db";
import { assistantProfileById } from "@/data/family-assistant";
import { useChildShell } from "@/components/family/child-shell-provider";
import {
  approvedGameLibrary,
  buildRewardsWeekNav,
  childGameIdentity,
  computeChildWallet,
  resolveShellRewards,
  type ChildShellWeekInfo,
} from "@/lib/family-child-shell";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500";

const EMPTY_CONFIG: FamilyBoardConfig = { routineOverrides: {}, rewardOverrides: {} };

const periodLabel = {
  daily: "Daily",
  weekly: "Weekly",
  "long-term": "Long-term",
} as const;

export function FamilyRewardsClient({ weekInfo }: { weekInfo: ChildShellWeekInfo }) {
  const { child } = useChildShell();

  const [completions, setCompletions] = useState<CompletionRecord[]>([]);
  const [redemptions, setRedemptions] = useState<RewardRedemption[]>([]);
  const [config, setConfig] = useState<FamilyBoardConfig>(EMPTY_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // Load the whole family's week — same contract as the boards.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [compRes, redRes, cfgRes] = await Promise.all([
          fetch(`/api/family/completions?week=${weekInfo.weekId}`),
          fetch(`/api/family/redemptions?week=${weekInfo.weekId}`),
          fetch("/api/family/config"),
        ]);
        if (cancelled) return;
        if (!compRes.ok || !redRes.ok || !cfgRes.ok) {
          setLoadError(true);
          return;
        }
        const compData: CompletionRecord[] = await compRes.json();
        const redData: RewardRedemption[] = await redRes.json();
        const cfgData: FamilyBoardConfig = await cfgRes.json();
        if (cancelled) return;
        setCompletions(compData);
        setRedemptions(redData);
        setConfig(cfgData);
        setLoaded(true);
      } catch {
        if (!cancelled) setLoadError(true);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [weekInfo.weekId]);

  const weekNav = child ? buildRewardsWeekNav(weekInfo, child) : null;
  const wallet = useMemo(
    () => (child ? computeChildWallet(child, completions, redemptions, config) : null),
    [child, completions, redemptions, config],
  );
  const rewards = useMemo(
    () =>
      child
        ? resolveShellRewards(config).filter((reward) => reward.assignedTo.includes(child))
        : [],
    [child, config],
  );
  const gameIdentity = childGameIdentity(child);

  // Redeem through the existing route; the server re-checks the balance.
  const [redeemingReward, setRedeemingReward] = useState<string | null>(null);
  const [redeemNotice, setRedeemNotice] = useState<string | null>(null);
  const handleRedeem = useCallback(
    async (rewardId: string) => {
      if (!child || redeemingReward) return;
      setRedeemingReward(rewardId);
      setRedeemNotice(null);
      try {
        const res = await fetch("/api/family/redemptions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ personId: child, rewardId, week: weekInfo.weekId }),
        });
        if (!res.ok) {
          setRedeemNotice(
            res.status === 409
              ? "Not enough coins yet — keep going!"
              : "That didn't work — please try again.",
          );
          return;
        }
        const redemption: RewardRedemption = await res.json();
        setRedemptions((prev) => [...prev, redemption]);
      } catch {
        setRedeemNotice("That didn't work — please try again.");
      } finally {
        setRedeemingReward(null);
      }
    },
    [child, redeemingReward, weekInfo.weekId],
  );

  const profile = child ? assistantProfileById(child) : null;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-5 pb-[max(3rem,env(safe-area-inset-bottom))] sm:px-6">
      {child && profile && weekNav ? (
        <>
          {/* Week context */}
          <section
            aria-label="Week"
            className="flex flex-wrap items-center justify-between gap-2"
          >
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-quaternary">
                Rewards
              </p>
              <h1 className="text-2xl font-semibold">
                {profile.displayName}&rsquo;s rewards
              </h1>
              <p className="text-sm text-tertiary">
                {weekNav.weekId === weekNav.currentWeekId
                  ? `This week · ${weekNav.rangeLabel}`
                  : `${weekNav.weekId} · ${weekNav.rangeLabel}`}
              </p>
            </div>
            <nav aria-label="Week navigation" className="flex items-center gap-2">
              <Link
                href={weekNav.prevHref}
                aria-label="Previous week"
                className={cn(
                  "grid h-12 w-12 place-items-center rounded-full border border-primary bg-primary text-secondary transition-colors hover:bg-secondary",
                  focusRing,
                )}
              >
                ←
              </Link>
              <Link
                href={weekNav.currentHref}
                className={cn(
                  "inline-flex min-h-12 items-center rounded-full border border-primary bg-primary px-4 py-2 text-sm font-medium text-secondary transition-colors hover:bg-secondary",
                  focusRing,
                )}
              >
                This week
              </Link>
              <Link
                href={weekNav.nextHref}
                aria-label="Next week"
                className={cn(
                  "grid h-12 w-12 place-items-center rounded-full border border-primary bg-primary text-secondary transition-colors hover:bg-secondary",
                  focusRing,
                )}
              >
                →
              </Link>
            </nav>
          </section>

          {loadError ? (
            <p className="rounded-2xl border border-primary bg-primary px-4 py-3 text-sm text-secondary">
              The rewards couldn&rsquo;t load. Check the connection and reload.
            </p>
          ) : !loaded ? (
            <p className="text-sm text-tertiary">Loading rewards…</p>
          ) : wallet ? (
            <>
              {/* Wallet */}
              <section
                aria-label="Coin wallet"
                className="flex flex-wrap items-center gap-6 rounded-3xl border border-primary bg-primary px-5 py-4"
              >
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-quaternary">
                    Coins to spend
                  </p>
                  <p className="text-3xl font-semibold">
                    🪙 {wallet.balance}
                  </p>
                </div>
                <div className="text-sm text-tertiary">
                  <p>{wallet.earned} earned this week</p>
                  <p>{wallet.spent} already spent</p>
                </div>
              </section>

              {redeemNotice ? (
                <p role="status" className="text-sm font-medium text-secondary">
                  {redeemNotice}
                </p>
              ) : null}

              {/* Rewards */}
              <section aria-label="Rewards to earn" className="grid gap-4 sm:grid-cols-2">
                {rewards.map((reward) => {
                  const redeemedCount = wallet.redeemedCounts[reward.id] ?? 0;
                  const canAfford = wallet.balance >= reward.costPoints;
                  const missing = Math.max(0, reward.costPoints - wallet.balance);
                  return (
                    <article
                      key={reward.id}
                      className="flex min-w-0 flex-col gap-3 rounded-3xl border border-primary bg-primary p-5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-3xl" aria-hidden="true">
                            {reward.icon}
                          </p>
                          <h2 className="mt-1 text-lg font-semibold">{reward.title}</h2>
                          <p className="text-sm text-tertiary">{reward.description}</p>
                        </div>
                        <span className="shrink-0 rounded-full border border-secondary px-3 py-1 text-xs font-medium text-tertiary">
                          {periodLabel[reward.period]}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm font-medium">
                          🪙 {reward.costPoints}
                          {redeemedCount > 0 ? (
                            <span className="ml-2 text-tertiary">
                              used {redeemedCount}× this week
                            </span>
                          ) : null}
                        </p>
                        <button
                          type="button"
                          onClick={() => handleRedeem(reward.id)}
                          disabled={!canAfford || redeemingReward !== null}
                          className={cn(
                            "inline-flex min-h-12 items-center rounded-full border border-primary px-5 py-2 text-sm font-semibold transition-colors",
                            canAfford
                              ? "bg-secondary text-primary hover:bg-primary"
                              : "cursor-not-allowed bg-primary text-quaternary",
                            focusRing,
                          )}
                        >
                          {canAfford
                            ? redeemingReward === reward.id
                              ? "Getting it…"
                              : "Get it"
                            : `${missing} more`}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </section>

              {/* Game corner — the approved-game seam */}
              <section aria-label="Game corner" className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold">Game corner</h2>
                {gameIdentity && approvedGameLibrary.length > 0 ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {approvedGameLibrary.map((game) => (
                      <Link
                        key={game.gameId}
                        href={game.hrefFor(gameIdentity)}
                        className={cn(
                          "flex min-h-12 flex-col gap-1 rounded-3xl border border-primary bg-primary p-5 transition-colors hover:bg-secondary",
                          focusRing,
                        )}
                      >
                        <span className="text-lg font-semibold">{game.title}</span>
                        <span className="text-sm text-tertiary">{game.tagline}</span>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-3xl border border-dashed border-primary bg-primary/60 px-5 py-4 text-sm text-tertiary">
                    Your games will live here. The first one — a friendly chess
                    coach — is on its way.
                  </p>
                )}
              </section>
            </>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
