"use client";

// ---------------------------------------------------------------------------
// Native launcher (October 25, 2026) — Deimos Rising plays as a Mac app.
//
// Same Family lease as every paid game (one allowance, one consuming lease per
// child, "Continue here" takeover), but no frame: this page asks Game Studio
// for a ONE-TIME launch link for the lease and shows it as a button. The click
// is an ordinary navigation that macOS hands to the Family app on THIS Mac; the
// app redeems the link on the Mac's own Game Studio service and then meters its
// own gameplay (menus, pauses, background and outages never count).
//
// This page never sends meter reports itself. Leaving before the launch button
// was ever clicked releases the lease (nothing can have run). After a click the
// lease belongs to the app: leaving the page leaves the game running there; it
// stops by itself when its time runs out or another game takes over (a click
// that never reached an app leaves a lease that the meter closes unused).
// Devices that are not a desktop Mac never acquire a lease here.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/components/ui/nabu";
import { assistantProfileById } from "@/data/family-assistant";
import type { ChildId } from "@/lib/family-assistant-turn";
import { childShellDestinationHref } from "@/lib/family-child-shell";
import { createGamesClient, deviceLabel, type LeaseGrant, type NativeStatus, type StudioAccess } from "@/lib/family-games-client";
import { currentNativeSupport, isLaunchUrl } from "@/lib/family-native-games";
import { formatPlayClock } from "@/lib/family-play";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500";
const pillClass = cn("inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-primary px-5 py-2 text-sm font-semibold transition-colors", focusRing);
const boxClass = "m-6 flex max-w-md flex-col gap-3 rounded-3xl border border-primary bg-primary p-5";
/** Refresh the one-time link before its 60 s expiry while nobody clicked it. */
const TICKET_REFRESH_MS = 40_000;
const STATUS_POLL_MS = 2_000;
/** After a click, how long to wait for the app's first report before suggesting what may be wrong. */
const ATTACH_HINT_MS = 20_000;

type Phase =
  | { kind: "checking" }
  | { kind: "unsupported" }
  | { kind: "starting" }
  | { kind: "needs-time" }
  | { kind: "held"; deviceLabel: string | null }
  | { kind: "ready"; grant: LeaseGrant; studio: StudioAccess }
  | { kind: "ended"; reason: string | null; remaining: number | null }
  | { kind: "unavailable"; message: string };

export function NativeLaunchClient({ child, gameId, title }: { child: ChildId; gameId: string; title: string }) {
  const profile = assistantProfileById(child)!;
  const client = useMemo(() => createGamesClient(), []);
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [attempt, setAttempt] = useState(0);
  const [takeover, setTakeover] = useState(false);
  const [launchUrl, setLaunchUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<NativeStatus | null>(null);
  const [clickedAt, setClickedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const attachedRef = useRef(false);
  const clickedRef = useRef(false);
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;
  const gamesHref = childShellDestinationHref("games", child);

  // ---- device check, then the lease (never on an iPad, phone or non-Mac) ----
  useEffect(() => {
    if (!currentNativeSupport().supported) {
      setPhase({ kind: "unsupported" });
      return;
    }
    const controller = new AbortController();
    setPhase({ kind: "starting" });
    setLaunchUrl(null);
    setStatus(null);
    attachedRef.current = false;
    clickedRef.current = false;
    (async () => {
      const grant = await client.lease(child, { gameId, mode: "play", takeover, device: deviceLabel() }, controller.signal);
      if (controller.signal.aborted) return;
      if (!grant.ok) {
        if (grant.failure === "no-allowance") return setPhase({ kind: "needs-time" });
        if (grant.failure === "lease-held") {
          const detail = grant.detail as { heldBy?: { deviceLabel: string | null } } | undefined;
          return setPhase({ kind: "held", deviceLabel: detail?.heldBy?.deviceLabel ?? null });
        }
        return setPhase({ kind: "unavailable", message: grant.failure === "unauthorized" ? "Please sign in again." : "Play isn't available right now. Your time is kept." });
      }
      if (grant.value.child !== child) return;
      if (!grant.value.studio) {
        await client.release(child, grant.value.lease.id, "studio-unconfigured");
        return setPhase({ kind: "unavailable", message: "Game Studio isn't connected yet. Your time is kept." });
      }
      setPhase({ kind: "ready", grant: grant.value, studio: grant.value.studio });
    })();
    return () => controller.abort();
  }, [child, gameId, client, attempt, takeover]);

  // ---- the one-time launch link, refreshed until the app has it ----
  const leaseId = phase.kind === "ready" ? phase.grant.lease.id : null;
  const studio = phase.kind === "ready" ? phase.studio : null;
  useEffect(() => {
    if (!leaseId || !studio) return;
    let stopped = false;
    const fetchTicket = async () => {
      if (attachedRef.current || document.visibilityState === "hidden") return;
      const t = await client.nativeTicket(studio, leaseId);
      if (stopped) return;
      if (t.ok && isLaunchUrl(t.value.launchUrl)) setLaunchUrl(t.value.launchUrl);
      else if (!t.ok && (t.status === 410 || t.status === 403)) setPhase({ kind: "ended", reason: "ended", remaining: null });
      else if (!t.ok) setLaunchUrl(null);
    };
    void fetchTicket();
    const timer = setInterval(() => void fetchTicket(), TICKET_REFRESH_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [leaseId, studio, client]);

  // ---- read-only meter status: has the app attached; the server's clock ----
  useEffect(() => {
    if (!leaseId || !studio) return;
    let stopped = false;
    const poll = async () => {
      const s = await client.nativeStatus(studio, leaseId);
      if (stopped || !s.ok) return;
      setStatus(s.value);
      setNow(Date.now());
      if (s.value.attached) attachedRef.current = true;
      if (s.value.ended) setPhase({ kind: "ended", reason: s.value.endReason ?? null, remaining: s.value.remainingSeconds });
    };
    void poll();
    const timer = setInterval(() => void poll(), STATUS_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [leaseId, studio, client]);

  // ---- leaving: release only a lease no app can have taken over ----
  useEffect(() => {
    return () => {
      const current = phaseRef.current;
      if (current.kind === "ready" && !attachedRef.current && !clickedRef.current) {
        void client.end(current.studio, current.grant.lease.id, "left", true, null);
        void client.release(child, current.grant.lease.id, "left");
      }
    };
  }, [child, client]);

  const onLaunchClick = useCallback(() => {
    clickedRef.current = true;
    setClickedAt(Date.now());
  }, []);
  const showHint = clickedAt !== null && !status?.attached && now - clickedAt > ATTACH_HINT_MS;

  return (
    <div className="flex min-h-dvh flex-col bg-secondary text-primary">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-primary px-3 py-2">
        <Link href={gamesHref} className={cn("inline-flex min-h-11 items-center gap-2 rounded-full border border-primary bg-primary px-4 py-2 text-sm font-medium text-secondary transition-colors hover:bg-secondary", focusRing)}>
          ← Games
        </Link>
        <p className="text-sm font-semibold">{profile.displayName} · {title}</p>
        <p aria-live="polite" className="min-h-11 rounded-full border border-primary bg-primary px-4 py-2 text-sm font-semibold tabular-nums" data-remaining-seconds={status?.remainingSeconds ?? ""}>
          ⏱️ {status?.remainingSeconds != null ? formatPlayClock(status.remainingSeconds) : "…"}
        </p>
      </header>

      {phase.kind === "checking" || phase.kind === "starting" ? (
        <p className="p-6 text-sm text-tertiary">Getting {title} ready…</p>
      ) : phase.kind === "unsupported" ? (
        <section aria-label="Plays on the Mac" className={boxClass} data-native-unsupported>
          <h2 className="text-xl font-semibold">{title} plays on the family Mac</h2>
          <p className="text-sm text-secondary">It&rsquo;s a Mac app, so it can&rsquo;t start from this device. Open your Games page on the family Mac to play. Nothing was used from your time.</p>
          <Link href={gamesHref} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>Back to Games</Link>
        </section>
      ) : phase.kind === "needs-time" ? (
        <section aria-label="Buy play time" className={boxClass}>
          <h2 className="text-xl font-semibold">No play time left</h2>
          <p className="text-sm text-secondary">Buy more Game Studio time on your Games page first — only if you choose to.</p>
          <Link href={gamesHref} className={cn(pillClass, "bg-secondary text-primary hover:bg-primary")}>Go to Games</Link>
        </section>
      ) : phase.kind === "held" ? (
        <section aria-label="Game open elsewhere" className={boxClass}>
          <h2 className="text-xl font-semibold">You&rsquo;re already playing on {phase.deviceLabel ? `a ${phase.deviceLabel}` : "another screen"}</h2>
          <p className="text-sm text-secondary">Play time is shared, so only one game counts at a time. Continue here instead? The other game will stop.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setTakeover(true)} className={cn(pillClass, "bg-secondary text-primary hover:bg-primary")}>Continue here</button>
            <Link href={gamesHref} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>Back to Games</Link>
          </div>
        </section>
      ) : phase.kind === "unavailable" ? (
        <section className={boxClass}>
          <h2 className="text-xl font-semibold">Not right now</h2>
          <p className="text-sm text-secondary">{phase.message}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className={cn(pillClass, "bg-secondary text-primary hover:bg-primary")}>↻ Try again</button>
            <Link href={gamesHref} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>Back to Games</Link>
          </div>
        </section>
      ) : phase.kind === "ended" ? (
        <section aria-label="Play ended" className={boxClass}>
          <h2 className="text-xl font-semibold">{phase.reason === "exhausted" ? "Time's up!" : phase.reason === "replaced" ? "You continued in another game" : "This play session is over"}</h2>
          <p className="text-sm text-secondary">{phase.reason === "exhausted" ? "Your play time is used up. Your game was saved." : "Your remaining time is kept."}</p>
          <div className="flex flex-wrap gap-2">
            {phase.reason !== "exhausted" ? <button type="button" onClick={() => setAttempt((n) => n + 1)} className={cn(pillClass, "bg-secondary text-primary hover:bg-primary")}>Play again</button> : null}
            <Link href={gamesHref} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>Back to Games</Link>
          </div>
        </section>
      ) : (
        <section aria-label={`Open ${title}`} className={boxClass} data-native-launcher data-attached={status?.attached ? "true" : "false"}>
          {status?.attached ? (
            <>
              <h2 className="text-xl font-semibold">{title} is open on this Mac</h2>
              <p className="text-sm text-secondary">Your time counts only while a level is running and the game is in front. Menus, Caps Lock pause and other windows don&rsquo;t count. You can close this page.</p>
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold">Ready to play {title}</h2>
              <p className="text-sm text-secondary">It opens as an app on this Mac. Your time starts only when a level is running.</p>
              {launchUrl ? (
                <a href={launchUrl} onClick={onLaunchClick} className={cn(pillClass, "bg-secondary text-primary hover:bg-primary")} data-native-launch>
                  ▶ Open {title}
                </a>
              ) : (
                <p className="text-sm text-tertiary">Preparing the launch…</p>
              )}
              {showHint ? <p role="status" className="text-sm text-secondary">Nothing opened? This computer may not have the family {title} app. Ask a parent, or play on the family Mac.</p> : null}
            </>
          )}
          <Link href={gamesHref} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>Back to Games</Link>
        </section>
      )}
    </div>
  );
}
