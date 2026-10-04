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
import { createHeartbeat, type HeartbeatInput } from "@/lib/family-play-heartbeat";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500";
const pillClass = cn(
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-primary px-5 py-2 text-sm font-semibold transition-colors",
  focusRing,
);
/**
 * Heartbeat cadence. Every successful heartbeat carries an authority deadline
 * (the meter's Family-granted window, 2 s): the frame is authorized only until
 * then and freezes itself without a renewal, so the wrapper renews well inside
 * the window. Pause/visibility/offline changes still beat immediately.
 */
export const TICK_MS = 800;
/** Child-visible frame-to-game handshake; the adapter's injected guard expects it. */
export const FRAME_PING_TYPE = "family-play:alive";
/** The guard's acknowledgment that it froze (and killed) the game after an ended message. */
export const FRAME_STOPPED_TYPE = "family-play:stopped";
/** The guard's report of what the frame is actually doing after an alive message: running (thawed) or not. */
export const FRAME_RUNNING_TYPE = "family-play:running";
/** How long to wait for the guard's stop acknowledgment before ending without it (the meter then waits out the handed deadline). */
export const STOP_ACK_TIMEOUT_MS = 400;

type Phase =
  | { kind: "starting" }
  | { kind: "needs-time"; balance: number | null; remaining: number }
  | { kind: "held"; heldBy: { gameId: string; deviceLabel: string | null } }
  | { kind: "playing"; grant: LeaseGrant; studio: StudioAccess; tick: TickView | null; paused: boolean; hidden: boolean; offline: boolean; handover: boolean; lapsed: boolean; armed: boolean }
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
  /** The frame's observed running session as last reported by the guard: carried on every end request (round 12). */
  const observationRef = useRef<{ grant: number | null; runMs: number }>({ grant: null, runMs: 0 });
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
      setPhase({ kind: "playing", grant: grant.value, studio: grant.value.studio, tick: null, paused: false, hidden: typeof document !== "undefined" && document.visibilityState === "hidden", offline: false, handover: false, lapsed: false, armed: false });
    })();
    return () => controller.abort();
  }, [child, gameId, client, attempt, takeover]);

  /**
   * Stop the game frame with evidence: post the terminal message and wait for the guard's acknowledgment that it
   * froze and killed the game. Resolves true only on that acknowledgment (or when no frame exists any more); on a
   * timeout it resolves false and the meter keeps the handed-frame fence until the deadline lapses.
   */
  const stopFrame = useCallback((leaseId: string, origin: string): Promise<boolean> => {
    const frame = frameRef.current;
    const target = frame?.contentWindow ?? null;
    if (!target) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (value: boolean) => {
        if (done) return;
        done = true;
        window.removeEventListener("message", onMessage);
        clearTimeout(timer);
        resolve(value);
      };
      const onMessage = (event: MessageEvent) => {
        const data = event.data as { type?: string; leaseId?: string; frozen?: boolean; ranMs?: number } | null;
        if (event.origin !== origin || event.source !== target || !data || data.type !== FRAME_STOPPED_TYPE || data.leaseId !== leaseId) return;
        if (typeof data.ranMs === "number") observationRef.current = { ...observationRef.current, runMs: Math.max(observationRef.current.runMs, data.ranMs) };
        finish(data.frozen === true);
      };
      const timer = setTimeout(() => finish(false), STOP_ACK_TIMEOUT_MS);
      window.addEventListener("message", onMessage);
      try {
        target.postMessage({ type: FRAME_PING_TYPE, leaseId, remainingSeconds: 0, phase: "exhausted", paused: true, reason: "ended", ended: true, authorizedForMs: 0 }, origin);
      } catch {
        finish(false);
      }
    });
  }, []);

  // ---- release on leave -------------------------------------------------
  useEffect(() => {
    return () => {
      const current = phaseRef.current;
      if (current.kind === "playing") {
        // The frame is unmounted with this component: nothing can run it any more.
        void client.end(current.studio, current.grant.lease.id, "left", true, observationRef.current);
        void client.release(child, current.grant.lease.id, "left");
      }
    };
  }, [child, client]);

  // ---- visibility ---------------------------------------------------------
  /** Apply a pause/hidden change synchronously (ref first, so the frame freeze and the next beat see it), then beat once. */
  const applyPlayFlags = useCallback((flags: { paused?: boolean; hidden?: boolean }) => {
    const current = phaseRef.current;
    if (current.kind !== "playing") return;
    // Any change disarms the frame: it thaws again only when the meter has answered a foreground report (billing restarts there).
    const next = { ...current, ...flags, armed: false };
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
    /** Authority deadline (Date.now() ms) from the newest successful heartbeat: play is not authorized past it. */
    let authorizedUntil = 0;
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
    /**
     * Observed running window (round 11). `running` is true only after the GUARD confirmed it thawed on the grant
     * we posted (`grantSeq`); `thawAt` is that instant; `runMs()` is how long the frame has actually run under the
     * session grant. Every report carries the session grant and the duration, so the meter can bill the genuine
     * run even when a running report is delayed or lost — bounded by the window the meter itself vouches for.
     */
    let grantSeq: number | null = null;
    let running = false;
    let sessionGrant: number | null = null;
    /** The guard's own measurement of how long the game has run under the session (monotonic; never an arrival-time estimate). */
    let observedMs = 0;
    const runMs = () => observedMs;
    const publishObservation = () => { observationRef.current = { grant: sessionGrant, runMs: observedMs }; };
    /** The wrapper no longer believes the frame runs (pause, hidden, offline, lapse, disarm); the guard's next reply fixes the duration. */
    const stopRunning = () => { running = false; };
    const postFrameState = (phaseName: string, remainingSeconds: number, ended: boolean) => {
      const current = phaseRef.current;
      const live = current.kind === "playing" && current.grant.lease.id === leaseId;
      // The frame runs only while ARMED: the meter answered a foreground report with a grant that is still open.
      const paused = live ? current.paused || current.hidden || current.offline || current.lapsed || !current.armed : true;
      const reason = live && current.offline ? "offline" : live && current.hidden ? "hidden" : "paused";
      // The frame freezes itself at the deadline whatever the wrapper does (fail-closed); here the same deadline is handed over.
      const authorizedForMs = ended || paused ? 0 : Math.max(0, authorizedUntil - Date.now());
      if (paused || ended) stopRunning();
      try {
        frameRef.current?.contentWindow?.postMessage({ type: FRAME_PING_TYPE, leaseId, remainingSeconds, phase: phaseName, paused, reason, ended, authorizedForMs, grant: grantSeq, session: sessionGrant }, origin);
      } catch {
        /* frame not ready */
      }
    };
    frameStateRef.current = postFrameState;
    /** The guard answers every alive message with what the frame is actually doing: running starts (and is billed) only on its word. */
    const onFrameRunning = (event: MessageEvent) => {
      const data = event.data as { type?: string; leaseId?: string; grant?: number | null; session?: number | null; running?: boolean; ranMs?: number } | null;
      const target = frameRef.current?.contentWindow ?? null;
      if (event.origin !== origin || !target || event.source !== target || !data || data.type !== FRAME_RUNNING_TYPE || data.leaseId !== leaseId) return;
      // Fence: a reply about an earlier session (a stale reorder) cannot touch the current observation.
      const replySession = data.session ?? data.grant ?? null;
      if (sessionGrant !== null && replySession !== null && replySession !== sessionGrant) return;
      const current = phaseRef.current;
      const live = current.kind === "playing" && current.grant.lease.id === leaseId;
      const wantsRunning = live && current.armed && !current.paused && !current.hidden && !current.offline && !current.lapsed;
      if (data.running === true && wantsRunning && grantSeq !== null && (data.grant === grantSeq || replySession === sessionGrant)) {
        const started = !running;
        if (started) {
          running = true;
          if (sessionGrant === null) { sessionGrant = replySession ?? grantSeq; observedMs = 0; }
        }
        if (typeof data.ranMs === "number") observedMs = Math.max(observedMs, data.ranMs);
        publishObservation();
        // Report at once only on the TRANSITION to running (billing starts there); while running, the regular
        // renewals carry the guard's latest measurement — a report per reply would feed back into itself.
        if (started) heartbeat.request();
      } else {
        // The guard's complete interval for this session (it also tells us about its own deadline/orphan freezes).
        if (typeof data.ranMs === "number" && (sessionGrant === null || replySession === sessionGrant || replySession === null)) observedMs = Math.max(observedMs, data.ranMs);
        publishObservation();
        if (running) {
          stopRunning();
          heartbeat.request(); // the frame stopped on its own (deadline): report the stop and the final duration now
        }
      }
    };
    window.addEventListener("message", onFrameRunning);
    /** Enforce the deadline in the wrapper too: no renewal by then → frozen frame and an honest "checking" state until the next good answer. */
    const armDeadline = () => {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      deadlineTimer = setTimeout(() => {
        deadlineTimer = null;
        const current = phaseRef.current;
        if (current.kind !== "playing" || current.grant.lease.id !== leaseId || Date.now() < authorizedUntil) return;
        const next = { ...current, lapsed: true, armed: false };
        phaseRef.current = next;
        setPhase(next);
        stopRunning();
        postFrameState(current.tick?.phase ?? "playing", current.tick?.remainingSeconds ?? 0, false);
        // Renew at once: the next answered foreground report re-arms the frame.
        heartbeat.request();
      }, Math.max(0, authorizedUntil - Date.now()));
    };

    type Outcome = { outcome: Awaited<ReturnType<typeof client.tick>>; sentAt: number; input: HeartbeatInput };
    const heartbeat = createHeartbeat<Outcome>({
      intervalMs: TICK_MS,
      input: () => {
        const current = phaseRef.current;
        const live = current.kind === "playing" && current.grant.lease.id === leaseId;
        const paused = live ? current.paused : true;
        const hidden = live ? current.hidden : true;
        // `foreground` is the child's intent (not paused, not hidden); `active` attests that the frame is armed and
        // running RIGHT NOW. The meter bills only between running reports: a frozen frame — waiting for an answer,
        // lapsed, offline — is never billed, and the first running report after a grant is the acknowledgment that
        // starts billing (sent the moment the frame thaws).
        const foreground = live && !paused && !hidden;
        const active = foreground && running && current.armed && !current.offline && !current.lapsed;
        if (!active) stopRunning();
        return { active, hidden, paused, foreground, grant: sessionGrant, runMs: runMs() };
      },
      send: async (input) => {
        const sentAt = Date.now();
        return { outcome: await client.tick(studio, leaseId, input), sentAt, input };
      },
      onOutcome: ({ outcome, sentAt, input }) => {
        const current = phaseRef.current;
        if (current.kind !== "playing" || current.grant.lease.id !== leaseId) return;
        if (!outcome.ok) {
          if (outcome.failure === "no-allowance" || outcome.status === 410 || outcome.status === 404 || outcome.status === 401) {
            const detail = outcome.detail as { endReason?: string; remainingSeconds?: number; ended?: boolean } | undefined;
            const reason = detail?.endReason === "replaced" || detail?.endReason === "revoked" || detail?.endReason === "superseded" ? "replaced" : detail?.endReason === "credential-expired" || outcome.status === 401 ? "expired" : "exhausted";
            authorizedUntil = 0;
            heartbeat.stop();
            // Stop the frame with the guard's acknowledgment, then tell the meter (so a successor need not wait out the deadline).
            void stopFrame(leaseId, origin).then((stopped) => client.end(studio, leaseId, "stopped", stopped, observationRef.current));
            setPhase({ kind: "ended", reason, remaining: detail?.remainingSeconds ?? null });
            void client.release(child, leaseId, detail?.endReason ?? "ended");
            return;
          }
          // Meter unreachable or refusing: fail closed — freeze the frame NOW, count nothing, keep retrying.
          // 409 = handover pending: Family still fences this lease behind the previous session's
          // authority window; the meter retries by itself on the next beat (nothing counted meanwhile).
          const handover = outcome.status === 409;
          stopRunning();
          setPhase((p) => (p.kind === "playing" && p.grant.lease.id === leaseId ? { ...p, offline: true, handover, armed: false } : p));
          phaseRef.current = current.kind === "playing" ? { ...current, offline: true, handover, armed: false } : current;
          postFrameState("offline", current.tick?.remainingSeconds ?? 0, false);
          return;
        }
        const tick = outcome.value;
        if (tick.ended || tick.phase === "exhausted") {
          authorizedUntil = 0;
          heartbeat.stop();
          void stopFrame(leaseId, origin).then((stopped) => client.end(studio, leaseId, "stopped", stopped, observationRef.current));
          setPhase({ kind: "ended", reason: tick.endReason === "replaced" ? "replaced" : "exhausted", remaining: tick.remainingSeconds });
          void client.release(child, leaseId, tick.endReason ?? "exhausted");
          return;
        }
        // The deadline counts from the instant THIS request was sent (the meter's own window started no earlier),
        // so delivery delay only shortens it; a missing grant authorizes nothing.
        authorizedUntil = sentAt + Math.max(0, tick.authorizedForMs ?? 0);
        const lapsed = Date.now() >= authorizedUntil;
        // Arm (thaw) only on the answer to a report with foreground intent whose grant is still open — never on the
        // answer to a pause/background report or a lapsed grant. The meter is NOT billing yet on an intent answer
        // (`billing: "armed"`): the running report sent right after the thaw is the acknowledgment that starts it.
        const armed = Boolean(input.foreground ?? input.active) && !lapsed && (tick.authorizedForMs ?? 0) > 0;
        if (armed && typeof tick.grant === "number") {
          grantSeq = tick.grant;
          // A stop report with the final duration has been answered (billing "stopped"/"armed", not running): the next
          // thaw opens a new session, so the guard's counter and ours start afresh on the next running reply.
          if (!running && tick.billing !== "running" && !input.active && sessionGrant !== null && input.grant === sessionGrant) { sessionGrant = null; observedMs = 0; publishObservation(); }
        }
        if (!armed) stopRunning();
        setPhase((p) => (p.kind === "playing" && p.grant.lease.id === leaseId ? { ...p, tick, offline: false, handover: false, lapsed, armed } : p));
        phaseRef.current = current.kind === "playing" ? { ...current, tick, offline: false, handover: false, lapsed, armed } : current;
        // Post the grant to the frame. The guard answers with what the frame is actually doing; only its "running"
        // answer makes the wrapper report running (billing starts there) — a frame that has not loaded answers nothing.
        postFrameState(tick.phase, tick.remainingSeconds, false);
        if (armed) armDeadline();
        else if (!current.paused && !current.hidden) heartbeat.request(); // the child wants to play: send the intent report that arms the frame
      },
    });
    beatRef.current = () => heartbeat.request();
    heartbeat.request();
    return () => {
      heartbeat.stop();
      window.removeEventListener("message", onFrameRunning);
      if (deadlineTimer) clearTimeout(deadlineTimer);
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
        // Evidence first: freeze the frame and wait for the guard's acknowledgment, then end at the meter and release at Family.
        const stopped = await stopFrame(current.grant.lease.id, new URL(current.studio.url).origin);
        setPhase({ kind: "ended", reason: "left", remaining: current.tick?.remainingSeconds ?? null });
        await Promise.all([client.end(current.studio, current.grant.lease.id, reason, stopped, observationRef.current), client.release(child, current.grant.lease.id, reason)]);
      }
    },
    [child, client, stopFrame],
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
            {phase.paused || phase.hidden || phase.offline || phase.lapsed || !phase.armed ? (
              <div role="dialog" aria-label={phase.offline ? (phase.handover ? "Starting" : "Reconnecting") : phase.paused || phase.hidden ? "Paused" : "Checking"} className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-secondary/95 p-6 text-center backdrop-blur-sm">
                <p className="text-xl font-semibold">{phase.offline ? (phase.handover ? "Closing your other session…" : "Reconnecting to Game Studio…") : phase.paused || phase.hidden ? "Paused" : phase.lapsed ? "Checking your play time…" : "Starting…"}</p>
                <p className="max-w-sm text-sm text-secondary">{phase.offline ? (phase.handover ? "Your game starts here in a moment. Your play time isn't counting yet." : "Your play time isn't counting while the connection is down. We'll continue when it's back.") : phase.paused || phase.hidden ? "Your play time isn't counting while paused." : "Waiting for Game Studio to confirm your time. Nothing is counted meanwhile."}</p>
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
