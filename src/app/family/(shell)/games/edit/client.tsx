"use client";

// ---------------------------------------------------------------------------
// Make or change a game — the child's scoped Game Studio editor under the
// PAID studio lease (October 8, 2026; SC-01..SC-09).
//
// What this surface does:
//   1. acquires the child's single interactive lease in `edit` mode from
//      Family (the same 3-coin / 15-minute allowance play uses; "continue
//      here" when another screen holds it; an explicit purchase when empty);
//   2. sends the same heartbeat the play wrapper sends while the editor is in
//      the FOREGROUND — visible, not paused, not in an attested build-only wait.
//      Thinking in the open editor counts; reading or answering a plan counts;
//      a hidden tab, an explicit pause and a server-attested wait do not;
//   3. talks to the Game Studio CHILD adapter with the studio credential for
//      create / iterate / clarify / approve — every one of which the adapter
//      re-authorizes against Family immediately before the upstream call;
//   4. keeps the draft (prompt, answers) in local storage per child/project so
//      exhaustion never loses typed work; when the server says the time is up
//      the controls close, submitted jobs keep running upstream, results stay
//      readable, and only an explicit purchase reopens interaction.
//
// Real Game Studio contract: a change request starts a semantic ANALYSIS and
// returns a plan; nothing builds until the child answers the plan's material
// questions and explicitly approves that plan. The status shown is the plan's
// own status. The owner route is never involved.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/components/ui/nabu";
import { assistantProfileById } from "@/data/family-assistant";
import { useChildShell } from "@/components/family/child-shell-provider";
import type { ChildId } from "@/lib/family-assistant-turn";
import { childShellDestinationHref, guardedPlayHref } from "@/lib/family-child-shell";
import { createGamesClient, deviceLabel, newIdempotencyKey, type LeaseGrant, type StudioAccess, type StudioPlan, type StudioProject, type TickView, type WaitClaim } from "@/lib/family-games-client";
import { PLAY_BLOCK_COINS, PLAY_BLOCK_SECONDS, formatPlayClock } from "@/lib/family-play";
import { createHeartbeat, type HeartbeatInput } from "@/lib/family-play-heartbeat";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500";
const pillClass = cn(
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-primary px-5 py-2 text-sm font-semibold transition-colors",
  focusRing,
);
/** Heartbeat cadence (same as play: well inside the meter's 2 s authority window). */
export const EDITOR_TICK_MS = 800;
/** Draft storage key per child and project ("new" for a game that has no id yet). */
export function studioDraftKey(child: ChildId, projectId: string | null): string {
  return `family-studio-draft:${child}:${projectId ?? "new"}`;
}

export const PLAN_STATUS_LABEL: Record<string, string> = {
  analyzing: "Game Studio is reading your request… (your time is paused while it works)",
  analysis_failed: "Game Studio couldn't understand that — try describing it differently.",
  awaiting_clarification: "Answer the questions below, then start the build.",
  awaiting_approval: "Plan ready — start the build when it looks right.",
  running: "Building your change… (your time is paused while it builds)",
  failed: "The build failed. Ask a parent to look at it in Game Studio.",
  completed: "Done — test it or play it.",
};

type Load = { kind: "loading" } | { kind: "ready"; projects: StudioProject[] } | { kind: "unreachable" } | { kind: "error" };

type Phase =
  | { kind: "starting" }
  | { kind: "needs-time"; balance: number | null }
  | { kind: "held"; heldBy: { gameId: string; deviceLabel: string | null } }
  | { kind: "editing"; grant: LeaseGrant; studio: StudioAccess; tick: TickView | null; paused: boolean; hidden: boolean; offline: boolean; lapsed: boolean; waiting: WaitClaim | null }
  | { kind: "ended"; reason: "exhausted" | "replaced" | "expired" | "ended" }
  | { kind: "unavailable"; message: string };

export function FamilyGamesEditClient({ initialGameId }: { initialGameId: string | null }) {
  const { child } = useChildShell();
  if (!child) return null;
  return <Editor key={child} child={child} initialGameId={initialGameId} />;
}

function readDraft(key: string): { prompt: string; answers: Record<string, string> } {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { prompt: "", answers: {} };
    const parsed = JSON.parse(raw) as { prompt?: unknown; answers?: unknown };
    return { prompt: typeof parsed.prompt === "string" ? parsed.prompt : "", answers: typeof parsed.answers === "object" && parsed.answers !== null ? (parsed.answers as Record<string, string>) : {} };
  } catch {
    return { prompt: "", answers: {} };
  }
}

function writeDraft(key: string, draft: { prompt: string; answers: Record<string, string> }): void {
  try {
    if (!draft.prompt && Object.keys(draft.answers).length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    /* storage unavailable — the draft still lives in component state */
  }
}

function Editor({ child, initialGameId }: { child: ChildId; initialGameId: string | null }) {
  const profile = assistantProfileById(child)!;
  const client = useMemo(() => createGamesClient(), []);
  const [phase, setPhase] = useState<Phase>({ kind: "starting" });
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;
  const [attempt, setAttempt] = useState(0);
  const [takeover, setTakeover] = useState(false);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [reloadSeq, setReloadSeq] = useState(0);
  const [selected, setSelected] = useState<string | null>(initialGameId);
  const [prompt, setPrompt] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [plan, setPlan] = useState<StudioPlan | null>(null);
  const beatRef = useRef<(() => void) | null>(null);
  const reload = useCallback(() => setReloadSeq((n) => n + 1), []);

  // ---- drafts: restore per child/project, persist on every change -----------
  const draftKey = studioDraftKey(child, selected);
  useEffect(() => {
    const draft = readDraft(draftKey);
    setPrompt(draft.prompt);
    setAnswers(draft.answers);
  }, [draftKey]);
  useEffect(() => {
    writeDraft(draftKey, { prompt, answers });
  }, [draftKey, prompt, answers]);

  // ---- lease acquisition (the paid studio lease; game id is the `*` sentinel) ----
  useEffect(() => {
    const controller = new AbortController();
    setPhase({ kind: "starting" });
    (async () => {
      const grant = await client.lease(child, { mode: "edit", takeover, device: deviceLabel() }, controller.signal);
      if (controller.signal.aborted) return;
      if (!grant.ok) {
        if (grant.failure === "no-allowance") {
          const state = await client.state(child, controller.signal);
          if (controller.signal.aborted) return;
          setPhase({ kind: "needs-time", balance: state.ok ? state.value.balance : null });
          return;
        }
        if (grant.failure === "lease-held") {
          const detail = grant.detail as { heldBy?: { gameId: string; deviceLabel: string | null } } | undefined;
          setPhase({ kind: "held", heldBy: detail?.heldBy ?? { gameId: "", deviceLabel: null } });
          return;
        }
        setPhase({ kind: "unavailable", message: grant.failure === "unauthorized" ? "Please sign in again." : "The studio isn't available right now. Your time is kept." });
        return;
      }
      if (grant.value.child !== child) return;
      if (!grant.value.studio) {
        await client.release(child, grant.value.lease.id, "studio-unconfigured");
        setPhase({ kind: "unavailable", message: "Game Studio isn't connected on this server yet. Your time is kept." });
        return;
      }
      setPhase({ kind: "editing", grant: grant.value, studio: grant.value.studio, tick: null, paused: false, hidden: typeof document !== "undefined" && document.visibilityState === "hidden", offline: false, lapsed: false, waiting: null });
    })();
    return () => controller.abort();
  }, [child, client, attempt, takeover]);

  // ---- release on leave ------------------------------------------------------
  useEffect(() => {
    return () => {
      const current = phaseRef.current;
      if (current.kind === "editing") {
        void client.end(current.studio, current.grant.lease.id, "left", true);
        void client.release(child, current.grant.lease.id, "left");
      }
    };
  }, [child, client]);

  // ---- projects + plan (reads: possible with the studio credential) ------------
  useEffect(() => {
    if (phase.kind !== "editing") return;
    const controller = new AbortController();
    const studio = phase.studio;
    (async () => {
      const projects = await client.projects(studio, controller.signal);
      if (controller.signal.aborted) return;
      if (!projects.ok) return setLoad(projects.failure === "network" || projects.failure === "unavailable" ? { kind: "unreachable" } : { kind: "error" });
      setLoad({ kind: "ready", projects: projects.value.projects });
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.kind === "editing" ? phase.grant.lease.id : null, client, reloadSeq]);

  const current = load.kind === "ready" && selected ? load.projects.find((p) => p.id === selected) ?? null : null;

  useEffect(() => {
    if (phase.kind !== "editing" || load.kind !== "ready" || !current?.latestPlanId) {
      setPlan(null);
      return;
    }
    const controller = new AbortController();
    const studio = phase.studio;
    const planId = current.latestPlanId;
    (async () => {
      const outcome = await client.plan(studio, planId, controller.signal);
      if (controller.signal.aborted) return;
      setPlan(outcome.ok ? outcome.value : null);
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, phase.kind, load, current?.id, current?.latestPlanId, reloadSeq]);

  // ---- the build-only wait the editor CLAIMS (the meter attests it) ------------
  const claimedWait: WaitClaim | null = useMemo(() => {
    if (plan && (plan.status === "analyzing" || plan.status === "running")) return { kind: "plan", id: plan.id };
    const job = current?.latestJob;
    if (job && (job.status === "queued" || job.status === "running")) return { kind: "job", id: job.id };
    return null;
  }, [plan, current]);
  useEffect(() => {
    const live = phaseRef.current;
    if (live.kind !== "editing") return;
    if ((live.waiting?.id ?? null) === (claimedWait?.id ?? null) && (live.waiting?.kind ?? null) === (claimedWait?.kind ?? null)) return;
    const next = { ...live, waiting: claimedWait };
    phaseRef.current = next;
    setPhase(next);
    beatRef.current?.();
  }, [claimedWait]);

  // Poll while analysis or a build is in progress (reads only).
  useEffect(() => {
    if (phase.kind !== "editing" || !claimedWait) return;
    const timer = window.setTimeout(reload, 8_000);
    return () => window.clearTimeout(timer);
  }, [phase.kind, claimedWait, reload, reloadSeq]);

  // ---- visibility / pause -----------------------------------------------------
  const applyFlags = useCallback((flags: { paused?: boolean; hidden?: boolean }) => {
    const live = phaseRef.current;
    if (live.kind !== "editing") return;
    const next = { ...live, ...flags };
    phaseRef.current = next;
    setPhase(next);
    beatRef.current?.();
  }, []);
  useEffect(() => {
    const onVisibility = () => applyFlags({ hidden: document.visibilityState === "hidden" });
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [applyFlags]);

  // ---- heartbeat: the editor IS the runtime; foreground = visible, not paused, not in an attested wait ----
  useEffect(() => {
    if (phase.kind !== "editing") return;
    const { studio, grant } = phase;
    const leaseId = grant.lease.id;
    let authorizedUntil = 0;
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
    const armDeadline = () => {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      deadlineTimer = setTimeout(() => {
        deadlineTimer = null;
        const live = phaseRef.current;
        if (live.kind !== "editing" || live.grant.lease.id !== leaseId || Date.now() < authorizedUntil) return;
        const next = { ...live, lapsed: true };
        phaseRef.current = next;
        setPhase(next);
        heartbeat.request();
      }, Math.max(0, authorizedUntil - Date.now()));
    };
    type Outcome = { outcome: Awaited<ReturnType<typeof client.tick>>; sentAt: number; input: HeartbeatInput & { waiting?: WaitClaim | null } };
    const heartbeat = createHeartbeat<Outcome>({
      intervalMs: EDITOR_TICK_MS,
      input: () => {
        const live = phaseRef.current;
        const ok = live.kind === "editing" && live.grant.lease.id === leaseId;
        const paused = ok ? live.paused : true;
        const hidden = ok ? live.hidden : true;
        const waiting = ok ? live.waiting : null;
        const foreground = ok && !paused && !hidden && !waiting;
        // Interactive = foreground and authorized (not offline/lapsed). The editor runs itself, so an intent and a
        // running report coincide: foreground reports attest interaction at once.
        const active = foreground && !live.offline && !live.lapsed;
        return { active, hidden, paused, foreground, waiting: foreground ? null : waiting };
      },
      send: async (input) => {
        const sentAt = Date.now();
        return { outcome: await client.tick(studio, leaseId, input), sentAt, input };
      },
      onOutcome: ({ outcome, sentAt, input }) => {
        const live = phaseRef.current;
        if (live.kind !== "editing" || live.grant.lease.id !== leaseId) return;
        if (!outcome.ok) {
          if (outcome.failure === "no-allowance" || outcome.status === 410 || outcome.status === 404 || outcome.status === 401) {
            const detail = outcome.detail as { endReason?: string } | undefined;
            const reason = detail?.endReason === "replaced" || detail?.endReason === "revoked" || detail?.endReason === "superseded" ? "replaced" : detail?.endReason === "credential-expired" || outcome.status === 401 ? "expired" : "exhausted";
            authorizedUntil = 0;
            heartbeat.stop();
            void client.end(studio, leaseId, "stopped", true);
            void client.release(child, leaseId, detail?.endReason ?? "ended");
            setPhase({ kind: "ended", reason });
            return;
          }
          // Meter unreachable or refusing: fail closed — interaction is frozen, nothing counted, retry continues.
          const next = { ...live, offline: true };
          phaseRef.current = next;
          setPhase(next);
          return;
        }
        const tick = outcome.value;
        if (tick.ended) {
          authorizedUntil = 0;
          heartbeat.stop();
          void client.end(studio, leaseId, "stopped", true);
          void client.release(child, leaseId, tick.endReason ?? "exhausted");
          setPhase({ kind: "ended", reason: tick.endReason === "replaced" ? "replaced" : "exhausted" });
          return;
        }
        authorizedUntil = sentAt + Math.max(0, tick.authorizedForMs ?? 0);
        const lapsed = Boolean(input.foreground) && Date.now() >= authorizedUntil;
        // A wait the meter could NOT attest is over: the editor must resume (billed) or the child pauses.
        const waiting = tick.waiting && tick.waiting.attested === false ? null : live.waiting;
        const next = { ...live, tick, offline: false, lapsed, waiting };
        phaseRef.current = next;
        setPhase(next);
        if (Boolean(input.foreground) && !lapsed) armDeadline();
      },
    });
    beatRef.current = () => heartbeat.request();
    heartbeat.request();
    return () => {
      heartbeat.stop();
      if (deadlineTimer) clearTimeout(deadlineTimer);
      beatRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.kind === "editing" ? phase.grant.lease.id : null, client, child]);

  // ---- purchase from the empty / ended state (explicit, 3 coins) --------------
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

  // ---- submissions (the adapter re-checks authority right before each upstream call) ----
  const editing = phase.kind === "editing" ? phase : null;
  const interactive = Boolean(editing && !editing.paused && !editing.hidden && !editing.offline && !editing.lapsed && (!editing.tick || (editing.tick.phase !== "grace" && editing.tick.phase !== "exhausted")));
  const explain = (status: number | undefined, fallback: string) => {
    if (status === 410) return "Your Game Studio time is up — your draft is saved. Buy more time to continue.";
    if (status === 409) return "That game is still busy — wait a moment.";
    if (status === 403) return "You can only change your own games.";
    if (status === 503) return "Game Studio can't check your time right now. Your draft is saved.";
    return fallback;
  };
  const submit = useCallback(async () => {
    if (!editing || !interactive || load.kind !== "ready" || busy || prompt.trim().length < 4) return;
    setBusy(true);
    setNotice(null);
    if (selected) {
      const outcome = await client.iterateProject(editing.studio, selected, prompt.trim());
      setBusy(false);
      if (!outcome.ok) {
        setNotice(explain(outcome.status, "That didn't work. Try again in a moment — your draft is saved."));
        return;
      }
      setPrompt("");
      setPlan(outcome.value.plan);
      setAnswers({});
      reload();
      return;
    }
    const outcome = await client.createProject(editing.studio, prompt.trim());
    setBusy(false);
    if (!outcome.ok) {
      setNotice(explain(outcome.status, "That didn't work. Try again in a moment — your draft is saved."));
      return;
    }
    setPrompt("");
    setSelected(outcome.value.project.id);
    setNotice("Building your new game… this takes a few minutes. Your time is paused while it builds.");
    reload();
  }, [busy, client, editing, interactive, load.kind, prompt, reload, selected]);

  const sendAnswers = useCallback(async () => {
    if (!editing || !interactive || !plan || busy) return;
    const open = plan.questions.filter((q) => q.kind === "material");
    const payload = open.map((q) => ({ question: q.text, answer: (answers[q.text] ?? "").trim() })).filter((a) => a.answer.length > 0);
    if (payload.length !== open.length) {
      setNotice("Please answer every question first.");
      return;
    }
    setBusy(true);
    setNotice(null);
    const outcome = await client.clarifyPlan(editing.studio, plan.id, payload);
    setBusy(false);
    if (!outcome.ok) {
      setNotice(explain(outcome.status, "Couldn't send your answers. Try again in a moment — they are saved."));
      return;
    }
    setPlan(outcome.value.plan);
    setAnswers({});
  }, [answers, busy, client, editing, interactive, plan]);

  const approve = useCallback(async () => {
    if (!editing || !interactive || !plan || busy) return;
    setBusy(true);
    setNotice(null);
    const outcome = await client.approvePlan(editing.studio, plan.id);
    setBusy(false);
    if (!outcome.ok) {
      setNotice(explain(outcome.status, "Couldn't start the build. Try again in a moment."));
      return;
    }
    setPlan(outcome.value.plan);
    reload();
  }, [busy, client, editing, interactive, plan, reload]);

  const gamesHref = childShellDestinationHref("games", child);
  const tickPhase = editing?.tick?.phase ?? null;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-5 pb-[max(3rem,env(safe-area-inset-bottom))] sm:px-6" data-studio-phase={phase.kind}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-quaternary">Game Studio</p>
          <h1 className="text-2xl font-semibold">{profile.displayName}&rsquo;s games</h1>
          <p className="text-sm text-tertiary">Making, changing and playing all use your Game Studio time. Waiting for a build doesn&rsquo;t.</p>
        </div>
        {editing ? (
          <p aria-live="polite" className="rounded-full border border-primary bg-primary px-4 py-2 text-sm font-semibold tabular-nums" data-remaining-seconds={editing.tick?.remainingSeconds ?? ""}>
            ⏱️ {editing.tick ? formatPlayClock(editing.tick.remainingSeconds) : "…"}
          </p>
        ) : null}
      </div>

      {phase.kind === "starting" ? (
        <p className="text-sm text-tertiary">Opening the studio…</p>
      ) : phase.kind === "needs-time" ? (
        <section aria-label="Buy Game Studio time" className="flex max-w-md flex-col gap-3 rounded-3xl border border-primary bg-primary p-5">
          <h2 className="text-xl font-semibold">No Game Studio time left</h2>
          <p className="text-sm text-secondary">{PLAY_BLOCK_COINS} coins buy {PLAY_BLOCK_SECONDS / 60} minutes of making, changing and playing.{phase.balance !== null ? ` You have 🪙 ${phase.balance} coins.` : ""} Your games and drafts are kept.</p>
          {buyNotice ? <p role="status" className="text-sm font-medium text-secondary">{buyNotice}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={buy} disabled={buying || (phase.balance !== null && phase.balance < PLAY_BLOCK_COINS)} className={cn(pillClass, phase.balance === null || phase.balance >= PLAY_BLOCK_COINS ? "bg-secondary text-primary hover:bg-primary" : "cursor-not-allowed bg-primary text-quaternary")}>
              {buying ? "Buying…" : `Buy ${PLAY_BLOCK_SECONDS / 60} minutes for 🪙 ${PLAY_BLOCK_COINS}`}
            </button>
            <Link href={gamesHref} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>Back to Games</Link>
          </div>
        </section>
      ) : phase.kind === "held" ? (
        <section aria-label="Studio open elsewhere" className="flex max-w-md flex-col gap-3 rounded-3xl border border-primary bg-primary p-5">
          <h2 className="text-xl font-semibold">You&rsquo;re already using your time on {phase.heldBy.deviceLabel ? `a ${phase.heldBy.deviceLabel}` : "another screen"}</h2>
          <p className="text-sm text-secondary">Game Studio time is shared, so only one screen counts at a time. Continue here instead? The other screen will stop.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setTakeover(true)} className={cn(pillClass, "bg-secondary text-primary hover:bg-primary")}>Continue here</button>
            <Link href={gamesHref} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>Back to Games</Link>
          </div>
        </section>
      ) : phase.kind === "unavailable" ? (
        <section className="flex max-w-md flex-col gap-3 rounded-3xl border border-primary bg-primary p-5">
          <h2 className="text-xl font-semibold">Not right now</h2>
          <p className="text-sm text-secondary">{phase.message}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className={cn(pillClass, "bg-secondary text-primary hover:bg-primary")}>↻ Try again</button>
            <Link href={gamesHref} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>Back to Games</Link>
          </div>
        </section>
      ) : phase.kind === "ended" ? (
        <section aria-label="Studio time ended" className="flex max-w-md flex-col gap-3 rounded-3xl border border-primary bg-primary p-5" data-studio-ended={phase.reason}>
          <h2 className="text-xl font-semibold">{phase.reason === "exhausted" ? "Time's up!" : phase.reason === "replaced" ? "You continued on another screen" : phase.reason === "expired" ? "This studio session timed out" : "Studio closed"}</h2>
          <p className="text-sm text-secondary">
            {phase.reason === "exhausted" ? `Your Game Studio time is used up. Your drafts are saved and any build you already started keeps going. Buying another ${PLAY_BLOCK_SECONDS / 60} minutes costs 🪙 ${PLAY_BLOCK_COINS} — only if you choose to.` : "Your remaining time and your drafts are kept."}
          </p>
          {buyNotice ? <p role="status" className="text-sm font-medium text-secondary">{buyNotice}</p> : null}
          <div className="flex flex-wrap gap-2">
            {phase.reason === "exhausted" ? (
              <button type="button" onClick={buy} disabled={buying} className={cn(pillClass, "bg-secondary text-primary hover:bg-primary")}>{buying ? "Buying…" : `Buy ${PLAY_BLOCK_SECONDS / 60} minutes for 🪙 ${PLAY_BLOCK_COINS}`}</button>
            ) : (
              <button type="button" onClick={() => setAttempt((n) => n + 1)} className={cn(pillClass, "bg-secondary text-primary hover:bg-primary")}>Open the studio again</button>
            )}
            <Link href={gamesHref} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>Back to Games</Link>
          </div>
        </section>
      ) : editing ? (
        <>
          {tickPhase === "warning" ? (
            <p role="status" className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">⏳ Two minutes of Game Studio time left — finish what you&rsquo;re typing.</p>
          ) : tickPhase === "grace" ? (
            <p role="alert" className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-900 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-100">⏱️ Time&rsquo;s up — {editing.tick?.graceRemainingSeconds ?? 0} seconds to finish. Your draft is saved; new changes need more time.</p>
          ) : null}
          {editing.paused || editing.hidden || editing.offline || editing.lapsed || editing.waiting ? (
            <div role="status" aria-label={editing.offline ? "Reconnecting" : editing.paused || editing.hidden ? "Paused" : editing.waiting ? "Waiting for Game Studio" : "Checking"} className="flex flex-col items-start gap-2 rounded-2xl border border-primary bg-secondary px-4 py-3" data-studio-waiting={editing.waiting ? `${editing.waiting.kind}:${editing.waiting.id}` : ""}>
              <p className="text-base font-semibold">{editing.offline ? "Reconnecting to Game Studio…" : editing.paused ? "Paused" : editing.hidden ? "Paused (tab hidden)" : editing.waiting ? (editing.waiting.kind === "plan" ? "Game Studio is thinking about your request…" : "Game Studio is building…") : "Checking your time…"}</p>
              <p className="text-sm text-secondary">{editing.offline ? "Your time isn't counting while the connection is down." : editing.waiting ? "Your time is paused while Game Studio works. It counts again once there's something for you to read, answer or approve." : "Your time isn't counting while paused."}</p>
              {editing.paused ? <button type="button" onClick={() => applyFlags({ paused: false })} className={cn(pillClass, "bg-secondary text-primary hover:bg-primary")}>▶ Continue</button> : null}
            </div>
          ) : null}

          {load.kind === "loading" ? (
            <p className="text-sm text-tertiary">Loading your games…</p>
          ) : load.kind === "unreachable" ? (
            <div className="flex flex-col items-start gap-3 rounded-3xl border border-primary bg-primary px-5 py-4">
              <p className="text-sm text-secondary">Game Studio isn&rsquo;t reachable from this device right now — it needs the home network connection.</p>
              <button type="button" onClick={reload} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>↻ Try again</button>
            </div>
          ) : load.kind === "error" ? (
            <div className="flex flex-col items-start gap-3 rounded-3xl border border-primary bg-primary px-5 py-4">
              <p className="text-sm text-secondary">The studio couldn&rsquo;t load.</p>
              <button type="button" onClick={reload} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>↻ Try again</button>
            </div>
          ) : (
            <>
              <section aria-label="Your games" className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-2">
                  <button type="button" aria-pressed={selected === null} onClick={() => setSelected(null)} className={cn(pillClass, selected === null ? "bg-secondary text-primary" : "bg-primary text-secondary hover:bg-secondary")}>✨ New game</button>
                  {load.projects.map((p) => (
                    <button key={p.id} type="button" aria-pressed={selected === p.id} onClick={() => setSelected(p.id)} className={cn(pillClass, selected === p.id ? "bg-secondary text-primary" : "bg-primary text-secondary hover:bg-secondary")}>
                      {p.title}
                    </button>
                  ))}
                </div>
              </section>

              {current && plan ? (
                <section aria-label="Your change plan" data-plan-status={plan.status} className="flex flex-col gap-3 rounded-3xl border border-primary bg-primary p-5">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.14em] text-quaternary">Your change</p>
                    <p className="text-base font-semibold">&ldquo;{plan.request}&rdquo;</p>
                    <p role="status" className="text-sm text-secondary">{PLAN_STATUS_LABEL[plan.status] ?? plan.status}</p>
                    {plan.planningError ? <p className="text-sm text-tertiary">{plan.planningError}</p> : null}
                  </div>
                  {plan.steps.length > 0 ? (
                    <ol className="list-decimal pl-5 text-sm text-secondary">
                      {plan.steps.map((step) => (
                        <li key={step.index}>{step.title ?? step.instruction}{step.status !== "pending" ? ` · ${step.status}` : ""}</li>
                      ))}
                    </ol>
                  ) : null}
                  {plan.status === "awaiting_clarification" ? (
                    <div className="flex flex-col gap-3">
                      {plan.questions.filter((q) => q.kind === "material").map((q) => (
                        <label key={q.text} className="flex flex-col gap-1 text-sm">
                          <span className="font-medium text-primary">{q.text}</span>
                          <input value={answers[q.text] ?? ""} onChange={(e) => setAnswers((prev) => ({ ...prev, [q.text]: e.target.value }))} maxLength={2000} disabled={!interactive} className="min-h-12 rounded-2xl border border-primary bg-secondary px-4 py-2 text-base text-primary" placeholder="Your answer" />
                        </label>
                      ))}
                      <div>
                        <button type="button" onClick={sendAnswers} disabled={busy || !interactive} className={cn(pillClass, interactive ? "bg-secondary text-primary hover:bg-primary" : "cursor-not-allowed bg-primary text-quaternary")}>{busy ? "Sending…" : "Send answers"}</button>
                      </div>
                    </div>
                  ) : null}
                  {plan.status === "awaiting_approval" ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={approve} disabled={busy || !interactive} className={cn(pillClass, interactive ? "bg-secondary text-primary hover:bg-primary" : "cursor-not-allowed bg-primary text-quaternary")}>{busy ? "Starting…" : "Start the build"}</button>
                      <span className="text-xs text-tertiary">Nothing changes until you tap this.</span>
                    </div>
                  ) : null}
                  {plan.clarifications.length > 0 ? (
                    <details className="text-xs text-tertiary">
                      <summary>Your answers</summary>
                      <ul className="mt-1 list-disc pl-5">{plan.clarifications.map((c, i) => <li key={i}>{c.question} — {c.answer}</li>)}</ul>
                    </details>
                  ) : null}
                </section>
              ) : null}

              <section aria-label={current ? `Change ${current.title}` : "Describe a new game"} className="flex flex-col gap-3 rounded-3xl border border-primary bg-primary p-5">
                {current ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-lg font-semibold">{current.title}</h2>
                      <p className="text-xs text-tertiary">{current.status}{current.latestJob ? ` · last build ${current.latestJob.status}` : ""}{current.latestJob?.error ? ` — ${current.latestJob.error}` : ""}</p>
                    </div>
                    {current.currentVersionId ? (
                      <Link href={guardedPlayHref({ childId: child }, current.id, "play")} className={cn(pillClass, "bg-secondary text-primary hover:bg-primary")}>▶ Test it (same time)</Link>
                    ) : null}
                  </div>
                ) : (
                  <h2 className="text-lg font-semibold">What game do you want to make?</h2>
                )}
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-tertiary">{current ? "What should change?" : "Describe it in a few sentences"}</span>
                  <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} maxLength={2000} disabled={!interactive} data-studio-draft className="min-h-24 rounded-2xl border border-primary bg-secondary px-4 py-3 text-base text-primary" placeholder={current ? "Make the enemies slower and add a double jump" : "A space game where I collect stars and dodge comets, with touch controls"} />
                </label>
                {notice ? <p role="status" className="text-sm font-medium text-secondary">{notice}</p> : null}
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={submit} disabled={busy || !interactive || prompt.trim().length < 4} className={cn(pillClass, prompt.trim().length >= 4 && !busy && interactive ? "bg-secondary text-primary hover:bg-primary" : "cursor-not-allowed bg-primary text-quaternary")}>
                    {busy ? "Sending…" : current ? "Plan the change" : "Build it"}
                  </button>
                  <button type="button" onClick={() => applyFlags({ paused: !(phaseRef.current.kind === "editing" && phaseRef.current.paused) })} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>
                    {editing.paused ? "▶ Continue" : "⏸ Pause"}
                  </button>
                  <Link href={gamesHref} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>Back to Games</Link>
                </div>
                <p className="text-xs text-tertiary">{current ? "Game Studio first shows you a plan and may ask questions; the build only starts when you approve it." : "A build takes a few minutes; your time is paused while it builds."} Deleting, restoring old versions and downloading are things a parent does.</p>
              </section>
            </>
          )}
        </>
      ) : null}
    </main>
  );
}
