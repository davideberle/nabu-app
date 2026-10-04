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
import { createHeartbeat } from "@/lib/family-play-heartbeat";

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
  | { kind: "ended"; reason: "exhausted" | "ended" | "replaced" | "left" | "expired"; remaining: number | null }
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
  /** Pushes the current paused/ended state into the guarded frame (freezes/thaws the game). */
  const frameStateRef = useRef<((phase: string, remaining: number, ended: boolean) => void) | null>(null);
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
  /** Apply a pause/hidden change synchronously (ref first, so the frame freeze and the next beat see it), then beat once. */
  const applyPlayFlags = useCallback((flags: { paused?: boolean; hidden?: boolean }) => {
    const current = phaseRef.current;
    if (current.kind !== "playing") return;
    const next = { ...current, ...flags };
    phaseRef.current = next;
    setPhase(next);
    frameStateRef.current?.(next.tick?.phase ?? "playing", next.tick?.remainingSeconds ?? 0, false);
    beatRef.current?.();
  }, []);
  useEffect(() => {
    const onVisibility = () => applyPlayFlags({ hidden: document.visibilityState === "hidden" });
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [applyPlayFlags]);

  // ---- heartbeat ----------------------------------------------------------
  // One controller per lease: single-flight, coalesced, fenced outcomes, one
  // timer (GP-04/05/07). Pause/visibility/offline changes freeze the frame
  // synchronously and ask for ONE follow-up beat; a stale success can never
  // clear a newer failure or raise the clock, and leaving the page stops
  // every pending callback.
  useEffect(() => {
    if (phase.kind !== "playing") return;
    const { studio, grant } = phase;
    const leaseId = grant.lease.id;
    const origin = new URL(studio.url).origin;
    const postFrameState = (phaseName: string, remainingSeconds: number, ended: boolean) => {
      const current = phaseRef.current;
      const live = current.kind === "playing" && current.grant.lease.id === leaseId;
      const paused = live ? current.paused || current.hidden || current.offline : true;
      const reason = live && current.offline ? "offline" : live && current.hidden ? "hidden" : "paused";
      try {
        frameRef.current?.contentWindow?.postMessage({ type: FRAME_PING_TYPE, leaseId, remainingSeconds, phase: phaseName, paused, reason, ended }, origin);
      } catch {
        /* frame not ready */
      }
    };
    frameStateRef.current = postFrameState;

    type Outcome = Awaited<ReturnType<typeof client.tick>>;
    const heartbeat = createHeartbeat<Outcome>({
      intervalMs: TICK_MS,
      input: () => {
        const current = phaseRef.current;
        const live = current.kind === "playing" && current.grant.lease.id === leaseId;
        const paused = live ? current.paused : true;
        const hidden = live ? current.hidden : true;
        return { active: live && !paused && !hidden, hidden, paused };
      },
      send: (input) => client.tick(studio, leaseId, input),
      onOutcome: (outcome) => {
        const current = phaseRef.current;
        if (current.kind !== "playing" || current.grant.lease.id !== leaseId) return;
        if (!outcome.ok) {
          if (outcome.failure === "no-allowance" || outcome.status === 410 || outcome.status === 404 || outcome.status === 401) {
            const detail = outcome.detail as { endReason?: string; remainingSeconds?: number; ended?: boolean } | undefined;
            const reason = detail?.endReason === "replaced" || detail?.endReason === "revoked" || detail?.endReason === "superseded" ? "replaced" : detail?.endReason === "credential-expired" || outcome.status === 401 ? "expired" : "exhausted";
            postFrameState("exhausted", 0, true);
            heartbeat.stop();
            setPhase({ kind: "ended", reason, remaining: detail?.remainingSeconds ?? null });
            void client.release(child, leaseId, detail?.endReason ?? "ended");
            return;
          }
          // Meter unreachable or refusing: fail closed — freeze the frame NOW, count nothing, keep retrying.
          setPhase((p) => (p.kind === "playing" && p.grant.lease.id === leaseId ? { ...p, offline: true } : p));
          phaseRef.current = current.kind === "playing" ? { ...current, offline: true } : current;
          postFrameState("offline", current.tick?.remainingSeconds ?? 0, false);
          return;
        }
        const tick = outcome.value;
        if (tick.ended || tick.phase === "exhausted") {
          postFrameState("exhausted", 0, true);
          heartbeat.stop();
          setPhase({ kind: "ended", reason: tick.endReason === "replaced" ? "replaced" : "exhausted", remaining: tick.remainingSeconds });
          void client.release(child, leaseId, tick.endReason ?? "exhausted");
          return;
        }
        setPhase((p) => (p.kind === "playing" && p.grant.lease.id === leaseId ? { ...p, tick, offline: false } : p));
        phaseRef.current = current.kind === "playing" ? { ...current, tick, offline: false } : current;
        postFrameState(tick.phase, tick.remainingSeconds, false);
      },
    });
    beatRef.current = () => heartbeat.request();
    heartbeat.request();
    return () => {
      heartbeat.stop();
      beatRef.current = null;
      frameStateRef.current = null;
    };
    // The loop restarts only when the lease changes, not on every tick.
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
          <h2 className="text-xl font-semibold">{phase.reason === "exhausted" ? "Time's up!" : phase.reason === "replaced" ? "You continued on another screen" : phase.reason === "expired" ? "This play session timed out" : "Game closed"}</h2>
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
                  <button type="button" onClick={() => applyPlayFlags({ paused: false })} className={cn(pillClass, "bg-secondary text-primary hover:bg-primary")}>▶ Continue</button>
                ) : null}
              </div>
            ) : null}
          </div>
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-primary px-3 py-2">
            <div className="flex gap-2">
              {!free ? (
                <button type="button" onClick={() => applyPlayFlags({ paused: !(phaseRef.current.kind === "playing" && phaseRef.current.paused) })} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>
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
