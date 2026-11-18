"use client";

// ---------------------------------------------------------------------------
// The ONE coin purchase flow (Nov 18, 2026: simplified for 7- and 9-year-olds).
//
// Two rows, one choice each, the price in plain words:
//   ♟️ Schach       · 15 Minuten · 1 Münze   [Kaufen]
//   🎮 Game Studio  · 15 Minuten · 3 Münzen  [Kaufen]
// Prices, seconds and the balance used for the decision are the server's
// (`/api/family/play/state`); nothing here computes a price or a balance.
//
// Safeguards (unchanged from the Games purchase flow of Oct 8 / Nov 1, 2026):
//   - every purchase needs an explicit confirmation showing the exact price;
//   - one idempotency key per confirmed purchase; a network failure KEEPS the
//     key so a retry can only replay, never charge twice; success, refusal and
//     "Nein" drop it;
//   - double-tap protection: `if (buying) return` plus a synchronous ref, and
//     the confirm button is disabled while buying;
//   - the server commits or refuses (409 insufficient funds commits nothing).
// Used by Coins (/family/rewards) and Games; both show the same rows.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { cn } from "@/components/ui/nabu";
import type { ChildId } from "@/lib/family-assistant-turn";
import { newIdempotencyKey, type GamesClient, type PlayStateView } from "@/lib/family-games-client";
import { formatPlayClock, type BudgetKind } from "@/lib/family-play";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500";
const bigButton = cn(
  "inline-flex min-h-14 min-w-32 items-center justify-center gap-2 rounded-full border px-6 py-3 text-lg font-semibold transition-colors",
  focusRing,
);

export type RedeemNotice = { kind: BudgetKind; code: "added" | "replayed" | "insufficient" | "retry" };

/** Plural for the child: «1 Münze», «3 Münzen». */
export function coinWord(n: number): string {
  return n === 1 ? "Münze" : "Münzen";
}

/**
 * Purchase state for one child: confirmation, buying, notice and the idempotency key.
 * `onSettled(kind, balance, remainingSeconds)` receives the server's authoritative numbers after a purchase or a refusal.
 */
export function useCoinPurchase(
  child: ChildId,
  client: GamesClient,
  onSettled: (kind: BudgetKind, balance: number, remainingSeconds: number | null) => void,
) {
  const [confirming, setConfirming] = useState<BudgetKind | null>(null);
  const [buying, setBuying] = useState(false);
  const [notice, setNotice] = useState<RedeemNotice | null>(null);
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);
  const openConfirm = useCallback((kind: BudgetKind) => {
    keyRef.current = null;
    setConfirming(kind);
    setNotice(null);
  }, []);
  const cancel = useCallback(() => {
    setConfirming(null);
    keyRef.current = null;
  }, []);
  const buy = useCallback(async (kind: BudgetKind) => {
    if (buying) return;
    if (inFlight.current) return;
    inFlight.current = true;
    setBuying(true);
    setNotice(null);
    if (!keyRef.current) keyRef.current = newIdempotencyKey();
    const outcome = await client.purchase(child, keyRef.current, undefined, kind);
    inFlight.current = false;
    setBuying(false);
    if (outcome.ok) {
      keyRef.current = null;
      setConfirming(null);
      setNotice({ kind, code: outcome.value.replayed ? "replayed" : "added" });
      onSettled(kind, outcome.value.balance, outcome.value.remainingSeconds);
      return;
    }
    if (outcome.failure === "insufficient") {
      keyRef.current = null;
      setConfirming(null);
      setNotice({ kind, code: "insufficient" });
      const detail = outcome.detail as { balance?: number; remainingSeconds?: number } | undefined;
      if (detail && typeof detail.balance === "number") onSettled(kind, detail.balance, typeof detail.remainingSeconds === "number" ? detail.remainingSeconds : null);
      return;
    }
    // Network/unknown: keep the SAME key so a retry can only replay, never double-charge.
    setNotice({ kind, code: "retry" });
  }, [buying, child, client, onSettled]);
  return { confirming, buying, notice, openConfirm, cancel, buy };
}

/** Apply the server's numbers after a purchase to the play state (the remaining seconds belong to the allowance bought). */
export function settlePlayState(prev: PlayStateView, kind: BudgetKind, balance: number, remaining: number | null): PlayStateView {
  if (kind === "chess") return { ...prev, balance, chess: { ...prev.chess, remainingSeconds: remaining ?? prev.chess.remainingSeconds } };
  return { ...prev, balance, remainingSeconds: remaining ?? prev.remainingSeconds };
}

const NOTICE_TEXT: Record<RedeemNotice["code"], string> = {
  added: "✓ 15 Minuten dazu!",
  replayed: "✓ Schon gekauft. Deine Zeit ist da.",
  insufficient: "Noch nicht genug Münzen.",
  retry: "Hat nicht geklappt. Tippe nochmal. Du zahlst nicht doppelt.",
};

type Row = { kind: BudgetKind; icon: string; title: string; coins: number; seconds: number; remainingSeconds: number };

/** The rows a child can buy, from the server's play state only. Chess is listed only when the server carries its price. */
export function redeemRows(state: PlayStateView): Row[] {
  const rows: Row[] = [];
  if (state.chess?.price && typeof state.chess.remainingSeconds === "number") {
    rows.push({ kind: "chess", icon: "♟️", title: "Schach", coins: state.chess.price.coins, seconds: state.chess.price.seconds, remainingSeconds: state.chess.remainingSeconds });
  }
  rows.push({ kind: "paid", icon: "🎮", title: "Game Studio", coins: state.price.coins, seconds: state.price.seconds, remainingSeconds: state.remainingSeconds });
  return rows;
}

export function CoinRedeemRows({
  state,
  purchase,
  playHref,
}: {
  state: PlayStateView;
  purchase: ReturnType<typeof useCoinPurchase>;
  /** Where to play once time is left (Coins only; Games has its own Play buttons). */
  playHref?: Partial<Record<BudgetKind, string>>;
}) {
  const { confirming, buying, notice, openConfirm, cancel, buy } = purchase;
  const balance = state.balance;
  return (
    <ul className="flex flex-col gap-3" aria-label="Zeit kaufen">
      {redeemRows(state).map((row) => {
        const minutes = Math.round(row.seconds / 60);
        const affordable = balance >= row.coins;
        const missing = row.coins - balance;
        return (
          <li
            key={row.kind}
            data-redeem-row={row.kind}
            data-redeem-affordable={affordable ? "true" : "false"}
            className={cn(
              "flex flex-col gap-3 rounded-3xl border bg-primary p-4 sm:flex-row sm:items-center sm:gap-5 sm:p-5",
              affordable ? "border-primary" : "border-secondary",
            )}
          >
            <div className="flex min-w-0 flex-1 items-center gap-4">
              <span aria-hidden="true" className={cn("flex size-16 shrink-0 items-center justify-center rounded-2xl bg-secondary text-4xl", !affordable && "opacity-50")}>{row.icon}</span>
              <div className="min-w-0">
                <h3 className="text-xl font-semibold text-primary">{row.title}</h3>
                <p className="text-lg text-secondary" data-redeem-price={row.kind}>
                  {minutes} Minuten · <span className="whitespace-nowrap">🪙 {row.coins} {coinWord(row.coins)}</span>
                </p>
                {row.remainingSeconds > 0 ? (
                  <p className="flex flex-wrap items-center gap-x-3 text-base text-tertiary" data-redeem-left={row.kind}>
                    <span>⏱️ Noch {formatPlayClock(row.remainingSeconds)}</span>
                    {playHref?.[row.kind] ? (
                      <Link href={playHref[row.kind]!} className={cn("inline-flex min-h-11 items-center font-semibold text-primary underline", focusRing)} data-redeem-play={row.kind}>▶ Spielen</Link>
                    ) : null}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
              {confirming !== row.kind ? (
                <button
                  type="button"
                  onClick={() => openConfirm(row.kind)}
                  disabled={!affordable}
                  data-redeem-buy={row.kind}
                  aria-label={affordable ? `${row.title}: ${minutes} Minuten für ${row.coins} ${coinWord(row.coins)} kaufen` : `${row.title}: dir fehlen noch ${missing} ${coinWord(missing)}`}
                  className={cn(
                    bigButton,
                    affordable ? "border-primary bg-secondary text-primary hover:bg-primary" : "cursor-not-allowed border-dashed border-secondary bg-primary text-quaternary",
                  )}
                >
                  {affordable ? "Kaufen" : `🔒 ${missing} ${coinWord(missing)} ${missing === 1 ? "fehlt" : "fehlen"}`}
                </button>
              ) : (
                <div role="group" aria-label={`${row.title} kaufen?`} className="flex flex-col gap-2 rounded-2xl border border-primary bg-secondary p-3 sm:items-end">
                  <p className="text-lg font-semibold text-primary">🪙 {row.coins} {coinWord(row.coins)} ausgeben?</p>
                  <p className="text-sm text-tertiary">Danach hast du 🪙 {balance - row.coins}.</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={cancel} disabled={buying} className={cn(bigButton, "min-w-24 border-primary bg-primary text-secondary hover:bg-secondary")}>Nein</button>
                    <button type="button" onClick={() => buy(row.kind)} disabled={buying} data-redeem-confirm={row.kind} className={cn(bigButton, "min-w-24 border-primary bg-primary-solid text-white hover:opacity-90")}>
                      {buying ? "…" : `Ja, kaufen für 🪙 ${row.coins}`}
                    </button>
                  </div>
                </div>
              )}
              {notice?.kind === row.kind ? <p role="status" className="text-base font-medium text-secondary">{NOTICE_TEXT[notice.code]}</p> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
