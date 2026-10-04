"use client";

// ---------------------------------------------------------------------------
// Guarded play — the Companion App wrapper around a Game Studio game.
//
// What this wrapper does (GP-03..GP-08):
//   1. gets the child's single lease from Family (or offers a purchase when
//      the allowance is empty; "continue here" when another device holds it);
//   2. loads the game ONLY through the Studio child adapter's guarded content
//      URL, bound to this lease;
//   3. sends a foreground heartbeat to the Studio meter every TICK_MS and
//      renders the server's remaining time, warning, grace and end — the
//      clock shown is the server's, never a local countdown;
//   4. stops sending ticks (and shows a pause screen) while the tab is hidden,
//      the child paused explicitly, or the meter is unreachable — those
//      intervals are not measured;
//   5. ends the lease on leave/Edit/profile switch and removes the frame at
//      exhaustion after the single server-granted grace.
//
// A copied raw content URL is not a play path: the adapter serves content
// only under a valid, unexpired lease credential and the served page stops
// without this wrapper's heartbeats (documented limit: browser-side code is
// not tamper-proof).
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/components/ui/nabu";
import { assistantProfileById } from "@/data/family-assistant";
import type { ChildId } from "@/lib/family-assistant-turn";
import { childShellDestinationHref, guardedPlayHref } from "@/lib/family-child-shell";
import { createGamesClient, deviceLabel, newIdempotencyKey, type LeaseGrant, type StudioAccess, type TickView } from "@/lib/family-games-client";
import { PLAY_BLOCK_COINS, PLAY_BLOCK_SECONDS, formatPlayClock, isFreeGame } from "@/lib/family-play";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500";
const pillClass = cn(
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-primary px-5 py-2 text-sm font-semibold transition-colors",
  focusRing,
);
export const TICK_MS = 5_000;
/** Child-visible frame-to-game handshake; the adapter's injected guard expects it. */
export const FRAME_PING_TYPE = "family-play:alive";

type Phase =
  | { kind: "starting" }
  | { kind: "needs-time"; balance: number | null; remaining: number }
  | { kind: "held"; heldBy: { gameId: string; deviceLabel: string | null } }
  | { kind: "playing"; grant: LeaseGrant; studio: StudioAccess; tick: TickView | null; paused: boolean; hidden: boolean; offline: boolean }
  | { kind: "ended"; reason: "exhausted" | "ended" | "replaced" | "left"; remaining: number | null }
  | { kind: "unavailable"; message: string };

export function GuardedPlayClient({ child, gameId }: { child: ChildId; gameId: string }) {
  const profile = assistantProfileById(child)!;
  const client = useMemo(() => createGamesClient(), []);
  const [phase, setPhase] = useState<Phase>({ kind: "starting" });
  const [attempt, setAttempt] = useState(0);
  const [takeover, setTakeover] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;
  /** The running heartbeat; called directly on pause/continue so the clock settles at once. */
  const beatRef = useRef<(() => void) | null>(null);
  const free = isFreeGame(gameId);

  // ---- lease acquisition ----------------------------------------------
  useEffect(() => {
    const controller = new AbortController();
    setPhase({ kind: "starting" });
    (async () => {
      const grant = await client.lease(child, { gameId, mode: "play", takeover, device: deviceLabel() }, controller.signal);
      if (controller.signal.aborted) return;
      if (!grant.ok) {
        if (grant.failure === "no-allowance") {
          const detail = grant.detail as { remainingSeconds?: number } | undefined;
          const state = await client.state(child, controller.signal);
          if (controller.signal.aborted) return;
          setPhase({ kind: "needs-time", balance: state.ok ? state.value.balance : null, remaining: detail?.remainingSeconds ?? 0 });
          return;
        }
        if (grant.failure === "lease-held") {
          const detail = grant.detail as { heldBy?: { gameId: string; deviceLabel: string | null } } | undefined;
          setPhase({ kind: "held", heldBy: detail?.heldBy ?? { gameId: "", deviceLabel: null } });
          return;
        }
        setPhase({ kind: "unavailable", message: grant.failure === "unauthorized" ? "Please sign in again." : "Play isn't available right now. Your time is kept." });
        return;
      }
      if (grant.value.child !== child) return;
      if (!grant.value.studio) {
        await client.release(child, grant.value.lease.id, "studio-unconfigured");
        setPhase({ kind: "unavailable", message: "Game Studio isn't connected on this server yet. Your time is kept." });
        return;
      }
      setPhase({ kind: "playing", grant: grant.value, studio: grant.value.studio, tick: null, paused: false, hidden: typeof document !== "undefined" && document.visibilityState === "hidden", offline: false });
    })();
    return () => controller.abort();
  }, [child, gameId, client, attempt, takeover]);

  // ---- release on leave -------------------------------------------------
  useEffect(() => {
    return () => {
      const current = phaseRef.current;
      if (current.kind === "playing") {
        void client.end(current.studio, current.grant.lease.id, "left");
        void client.release(child, current.grant.lease.id, "left");
      }
    };
  }, [child, client]);

  // ---- visibility ---------------------------------------------------------
  useEffect(() => {
    const onVisibility = () => setPhase((p) => (p.kind === "playing" ? { ...p, hidden: document.visibilityState === "hidden" } : p));
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // ---- heartbeat ----------------------------------------------------------
  useEffect(() => {
    if (phase.kind !== "playing") return;
    const { studio, grant } = phase;
    let cancelled = false;
    let timer: number | null = null;
    const beat = async () => {
      const current = phaseRef.current;
      if (cancelled || current.kind !== "playing") return;
      const active = !current.paused && !current.hidden;
      const outcome = await client.tick(studio, grant.lease.id, { active, hidden: current.hidden, paused: current.paused });
      if (cancelled) return;
      if (!outcome.ok) {
        if (outcome.failure === "no-allowance" || outcome.status === 410 || outcome.status === 404) {
          const detail = outcome.detail as { endReason?: string; remainingSeconds?: number } | undefined;
          setPhase({ kind: "ended", reason: detail?.endReason === "replaced" ? "replaced" : "exhausted", remaining: detail?.remainingSeconds ?? 0 });
          void client.release(child, grant.lease.id, detail?.endReason ?? "ended");
          return;
        }
        // Meter unreachable: fail closed — suspend play; nothing is counted meanwhile.
        setPhase((p) => (p.kind === "playing" ? { ...p, offline: true } : p));
      } else {
        const tick = outcome.value;
        if (tick.ended || tick.phase === "exhausted") {
          setPhase({ kind: "ended", reason: tick.endReason === "replaced" ? "replaced" : "exhausted", remaining: tick.remainingSeconds });
          void client.release(child, grant.lease.id, tick.endReason ?? "exhausted");
          return;
        }
        setPhase((p) => (p.kind === "playing" ? { ...p, tick, offline: false } : p));
        // Frame handshake: tells the guarded page it is inside the wrapper.
        try {
          frameRef.current?.contentWindow?.postMessage({ type: FRAME_PING_TYPE, leaseId: grant.lease.id, remainingSeconds: tick.remainingSeconds, phase: tick.phase }, new URL(studio.url).origin);
        } catch {
          /* frame not ready */
        }
      }
      timer = window.setTimeout(beat, TICK_MS);
    };
    beatRef.current = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      void beat();
    };
    void beat();
    return () => {
      cancelled = true;
      beatRef.current = null;
      if (timer !== null) window.clearTimeout(timer);
    };
    // The tick loop restarts only when the lease changes, not on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.kind === "playing" ? phase.grant.lease.id : null, client, child]);

  // ---- purchase from the empty state -------------------------------------
  const [buying, setBuying] = useState(false);
  const [buyNotice, setBuyNotice] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);
  const buy = useCallback(async () => {
    if (buying) return;
    setBuying(true);
    setBuyNotice(null);
    if (!keyRef.current) keyRef.current = newIdempotencyKey();
    const outcome = await client.purchase(child, keyRef.current);
    setBuying(false);
    if (outcome.ok) {
      keyRef.current = null;
      setAttempt((n) => n + 1);
      return;
    }
    if (outcome.failure === "insufficient") {
      keyRef.current = null;
      setBuyNotice("Not enough coins yet — keep going!");
      return;
    }
    setBuyNotice("That didn't go through — tap again; you will not be charged twice.");
  }, [buying, child, client]);

  const leaveAndGo = useCallback(
    async (reason: string) => {
      const current = phaseRef.current;
      if (current.kind === "playing") {
        setPhase({ kind: "ended", reason: "left", remaining: current.tick?.remainingSeconds ?? null });
        await Promise.all([client.end(current.studio, current.grant.lease.id, reason), client.release(child, current.grant.lease.id, reason)]);
      }
    },
    [child, client],
  );

  const gamesHref = childShellDestinationHref("games", child);
  const identity = { childId: child } as const;

  return (
    <div className="flex h-dvh flex-col bg-secondary text-primary">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-primary px-3 py-2">
        <Link href={gamesHref} onClick={() => void leaveAndGo("left")} className={cn("inline-flex min-h-11 items-center gap-2 rounded-full border border-primary bg-primary px-4 py-2 text-sm font-medium text-secondary transition-colors hover:bg-secondary", focusRing)}>
          ← Games
        </Link>
        <p className="text-sm font-semibold">{profile.displayName} is playing</p>
        <PlayClock phase={phase} free={free} />
      </header>

      {phase.kind === "starting" ? (
        <p className="p-6 text-sm text-tertiary">Getting your game ready…</p>
      ) : phase.kind === "needs-time" ? (
        <section aria-label="Buy play time" className="m-6 flex max-w-md flex-col gap-3 rounded-3xl border border-primary bg-primary p-5">
          <h2 className="text-xl font-semibold">No play time left</h2>
          <p className="text-sm text-secondary">{PLAY_BLOCK_COINS} coins buy {PLAY_BLOCK_SECONDS / 60} minutes of active play for all approved games.{phase.balance !== null ? ` You have 🪙 ${phase.balance} coins.` : ""}</p>
          {buyNotice ? <p role="status" className="text-sm font-medium text-secondary">{buyNotice}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={buy} disabled={buying || (phase.balance !== null && phase.balance < PLAY_BLOCK_COINS)} className={cn(pillClass, phase.balance === null || phase.balance >= PLAY_BLOCK_COINS ? "bg-secondary text-primary hover:bg-primary" : "cursor-not-allowed bg-primary text-quaternary")}>
              {buying ? "Buying…" : `Buy ${PLAY_BLOCK_SECONDS / 60} minutes for 🪙 ${PLAY_BLOCK_COINS}`}
            </button>
            <Link href={gamesHref} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>Back to Games</Link>
          </div>
        </section>
      ) : phase.kind === "held" ? (
        <section aria-label="Game open elsewhere" className="m-6 flex max-w-md flex-col gap-3 rounded-3xl border border-primary bg-primary p-5">
          <h2 className="text-xl font-semibold">You&rsquo;re already playing on {phase.heldBy.deviceLabel ? `a ${phase.heldBy.deviceLabel}` : "another screen"}</h2>
          <p className="text-sm text-secondary">Play time is shared, so only one screen counts at a time. Continue here instead? The other screen will stop.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setTakeover(true)} className={cn(pillClass, "bg-secondary text-primary hover:bg-primary")}>Continue here</button>
            <Link href={gamesHref} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>Back to Games</Link>
          </div>
        </section>
      ) : phase.kind === "unavailable" ? (
        <section className="m-6 flex max-w-md flex-col gap-3 rounded-3xl border border-primary bg-primary p-5">
          <h2 className="text-xl font-semibold">Not right now</h2>
          <p className="text-sm text-secondary">{phase.message}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className={cn(pillClass, "bg-secondary text-primary hover:bg-primary")}>↻ Try again</button>
            <Link href={gamesHref} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>Back to Games</Link>
          </div>
        </section>
      ) : phase.kind === "ended" ? (
        <section aria-label="Play ended" className="m-6 flex max-w-md flex-col gap-3 rounded-3xl border border-primary bg-primary p-5">
          <h2 className="text-xl font-semibold">{phase.reason === "exhausted" ? "Time's up!" : phase.reason === "replaced" ? "You continued on another screen" : "Game closed"}</h2>
          <p className="text-sm text-secondary">
            {phase.reason === "exhausted" ? `Your play time is used up. Buying another ${PLAY_BLOCK_SECONDS / 60} minutes costs 🪙 ${PLAY_BLOCK_COINS} — only if you choose to.` : "Your remaining time is kept."}
          </p>
          <div className="flex flex-wrap gap-2">
            {phase.reason === "exhausted" ? (
              <button type="button" onClick={() => setPhase({ kind: "needs-time", balance: null, remaining: 0 })} className={cn(pillClass, "bg-secondary text-primary hover:bg-primary")}>Buy more time</button>
            ) : phase.reason !== "left" ? (
              <button type="button" onClick={() => setAttempt((n) => n + 1)} className={cn(pillClass, "bg-secondary text-primary hover:bg-primary")}>Play again</button>
            ) : null}
            <Link href={gamesHref} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>Back to Games</Link>
          </div>
        </section>
      ) : (
        <>
          {phase.tick?.phase === "warning" ? (
            <p role="status" className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">⏳ Two minutes left — find a good place to stop.</p>
          ) : phase.tick?.phase === "grace" ? (
            <p role="alert" className="border-b border-rose-300 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-900 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-100">⏱️ Time&rsquo;s up — {phase.tick.graceRemainingSeconds ?? 0} seconds to finish and save.</p>
          ) : null}
          <div className="relative flex-1">
            <iframe
              ref={frameRef}
              title={`Game for ${profile.displayName}`}
              src={client.contentUrl(phase.studio, phase.grant.lease.id, gameId)}
              className="h-full w-full border-0"
              // Cross-origin (tailnet) content: `allow-same-origin` gives the game its
              // own Studio origin for per-device saves and no reach into this page.
              sandbox="allow-scripts allow-same-origin"
              allow="fullscreen"
            />
            {phase.paused || phase.hidden || phase.offline ? (
              <div role="dialog" aria-label={phase.offline ? "Reconnecting" : "Paused"} className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-secondary/95 p-6 text-center backdrop-blur-sm">
                <p className="text-xl font-semibold">{phase.offline ? "Reconnecting to Game Studio…" : "Paused"}</p>
                <p className="max-w-sm text-sm text-secondary">{phase.offline ? "Your play time isn't counting while the connection is down. We'll continue when it's back." : "Your play time isn't counting while paused."}</p>
                {phase.paused ? (
                  <button type="button" onClick={() => { setPhase((p) => (p.kind === "playing" ? { ...p, paused: false } : p)); window.setTimeout(() => beatRef.current?.(), 0); }} className={cn(pillClass, "bg-secondary text-primary hover:bg-primary")}>▶ Continue</button>
                ) : null}
              </div>
            ) : null}
          </div>
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-primary px-3 py-2">
            <div className="flex gap-2">
              {!free ? (
                <button type="button" onClick={() => { setPhase((p) => (p.kind === "playing" ? { ...p, paused: !p.paused } : p)); window.setTimeout(() => beatRef.current?.(), 0); }} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>
                  {phase.paused ? "▶ Continue" : "⏸ Pause"}
                </button>
              ) : null}
              <Link href={guardedPlayHref(identity, gameId, "edit")} onClick={() => void leaveAndGo("edit")} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>✏️ Edit</Link>
            </div>
            <p className="text-xs text-tertiary">{free ? "Free game — no play time used." : "Only visible play counts. Pause, another tab or Edit stops the clock."}</p>
          </footer>
        </>
      )}
    </div>
  );
}

function PlayClock({ phase, free }: { phase: Phase; free: boolean }) {
  if (free) return <span className="text-sm text-tertiary">Free</span>;
  if (phase.kind !== "playing") return <span aria-hidden className="min-h-11 w-[88px]" />;
  const tick = phase.tick;
  return (
    <p aria-live="polite" className="rounded-full border border-primary bg-primary px-4 py-2 text-sm font-semibold tabular-nums" data-remaining-seconds={tick?.remainingSeconds ?? ""}>
      ⏱️ {tick ? formatPlayClock(tick.remainingSeconds) : "…"}
    </p>
  );
}
