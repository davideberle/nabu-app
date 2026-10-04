"use client";

// ---------------------------------------------------------------------------
// Make or change a game — the child's scoped editor (GP-04: Edit is free and
// never a Play frame; "Test it" goes to the guarded play surface, which meters).
//
// Real Game Studio contract: a change request starts a semantic ANALYSIS and
// returns a plan. Nothing builds until the child answers the plan's material
// questions and explicitly approves that plan. The status shown here is the
// plan's own status — never a "working" claim before approval. Everything
// speaks to the Game Studio CHILD adapter with the child's library credential
// for the child's own projects only; the owner route is never involved.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/components/ui/nabu";
import { assistantProfileById } from "@/data/family-assistant";
import { useChildShell } from "@/components/family/child-shell-provider";
import type { ChildId } from "@/lib/family-assistant-turn";
import { childShellDestinationHref, guardedPlayHref } from "@/lib/family-child-shell";
import { createGamesClient, type StudioAccess, type StudioPlan, type StudioProject } from "@/lib/family-games-client";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500";
const pillClass = cn(
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-primary px-5 py-2 text-sm font-semibold transition-colors",
  focusRing,
);

type Load = { kind: "loading" } | { kind: "ready"; studio: StudioAccess; projects: StudioProject[] } | { kind: "unconfigured" } | { kind: "unreachable" } | { kind: "error" };

export const PLAN_STATUS_LABEL: Record<string, string> = {
  analyzing: "Game Studio is reading your request…",
  analysis_failed: "Game Studio couldn't understand that — try describing it differently.",
  awaiting_clarification: "Answer the questions below, then start the build.",
  awaiting_approval: "Plan ready — start the build when it looks right.",
  running: "Building your change…",
  failed: "The build failed. Ask a parent to look at it in Game Studio.",
  completed: "Done — test it or play it.",
};

export function FamilyGamesEditClient({ initialGameId }: { initialGameId: string | null }) {
  const { child } = useChildShell();
  if (!child) return null;
  return <Editor key={child} child={child} initialGameId={initialGameId} />;
}

function Editor({ child, initialGameId }: { child: ChildId; initialGameId: string | null }) {
  const profile = assistantProfileById(child)!;
  const client = useMemo(() => createGamesClient(), []);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<string | null>(initialGameId);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [plan, setPlan] = useState<StudioPlan | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const session = await client.session(child, controller.signal);
      if (controller.signal.aborted) return;
      if (!session) return setLoad({ kind: "error" });
      if (!session.studio) return setLoad({ kind: "unconfigured" });
      const projects = await client.projects(session.studio, controller.signal);
      if (controller.signal.aborted) return;
      if (!projects.ok) return setLoad(projects.failure === "network" || projects.failure === "unavailable" ? { kind: "unreachable" } : { kind: "error" });
      setLoad({ kind: "ready", studio: session.studio, projects: projects.value.projects });
    })();
    return () => controller.abort();
  }, [child, client, attempt]);

  const current = load.kind === "ready" && selected ? load.projects.find((p) => p.id === selected) ?? null : null;

  // Follow the selected project's latest plan (the real state of a change request).
  useEffect(() => {
    if (load.kind !== "ready" || !current?.latestPlanId) {
      setPlan(null);
      return;
    }
    const controller = new AbortController();
    const studio = load.studio;
    const planId = current.latestPlanId;
    (async () => {
      const outcome = await client.plan(studio, planId, controller.signal);
      if (controller.signal.aborted) return;
      setPlan(outcome.ok ? outcome.value : null);
    })();
    return () => controller.abort();
  }, [client, load, current?.id, current?.latestPlanId, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll while analysis or a build is in progress (a read, never a Play frame).
  useEffect(() => {
    if (load.kind !== "ready") return;
    const planBusy = plan && (plan.status === "analyzing" || plan.status === "running");
    const jobBusy = load.projects.some((p) => p.latestJob && (p.latestJob.status === "queued" || p.latestJob.status === "running"));
    if (!planBusy && !jobBusy) return;
    const timer = window.setTimeout(reload, 8_000);
    return () => window.clearTimeout(timer);
  }, [load, plan, reload]);

  const submit = useCallback(async () => {
    if (load.kind !== "ready" || busy || prompt.trim().length < 4) return;
    setBusy(true);
    setNotice(null);
    if (selected) {
      const outcome = await client.iterateProject(load.studio, selected, prompt.trim());
      setBusy(false);
      if (!outcome.ok) {
        setNotice(outcome.status === 409 ? "That game is still busy — wait a moment." : outcome.status === 403 ? "You can only change your own games." : "That didn't work. Try again in a moment.");
        return;
      }
      setPrompt("");
      setPlan(outcome.value.plan);
      setAnswers({});
      reload();
      return;
    }
    const outcome = await client.createProject(load.studio, prompt.trim());
    setBusy(false);
    if (!outcome.ok) {
      setNotice(outcome.status === 409 ? "The studio is busy — wait a moment." : "That didn't work. Try again in a moment.");
      return;
    }
    setPrompt("");
    setSelected(outcome.value.project.id);
    setNotice("Building your new game… this takes a few minutes.");
    reload();
  }, [busy, client, load, prompt, reload, selected]);

  const sendAnswers = useCallback(async () => {
    if (load.kind !== "ready" || !plan || busy) return;
    const open = plan.questions.filter((q) => q.kind === "material");
    const payload = open.map((q) => ({ question: q.text, answer: (answers[q.text] ?? "").trim() })).filter((a) => a.answer.length > 0);
    if (payload.length !== open.length) {
      setNotice("Please answer every question first.");
      return;
    }
    setBusy(true);
    setNotice(null);
    const outcome = await client.clarifyPlan(load.studio, plan.id, payload);
    setBusy(false);
    if (!outcome.ok) {
      setNotice("Couldn't send your answers. Try again in a moment.");
      return;
    }
    setPlan(outcome.value.plan);
    setAnswers({});
  }, [answers, busy, client, load, plan]);

  const approve = useCallback(async () => {
    if (load.kind !== "ready" || !plan || busy) return;
    setBusy(true);
    setNotice(null);
    const outcome = await client.approvePlan(load.studio, plan.id);
    setBusy(false);
    if (!outcome.ok) {
      setNotice(outcome.status === 409 ? "The plan isn't ready to build yet." : "Couldn't start the build. Try again in a moment.");
      return;
    }
    setPlan(outcome.value.plan);
    reload();
  }, [busy, client, load, plan, reload]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-5 pb-[max(3rem,env(safe-area-inset-bottom))] sm:px-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-quaternary">Game Studio</p>
        <h1 className="text-2xl font-semibold">{profile.displayName}&rsquo;s games</h1>
        <p className="text-sm text-tertiary">Making and changing is free. Testing in Play uses play time.</p>
      </div>

      {load.kind === "loading" ? (
        <p className="text-sm text-tertiary">Opening the studio…</p>
      ) : load.kind === "unconfigured" ? (
        <p className="rounded-3xl border border-dashed border-primary bg-primary/60 px-5 py-4 text-sm text-tertiary">The studio isn&rsquo;t connected on this server yet.</p>
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
                      <input value={answers[q.text] ?? ""} onChange={(e) => setAnswers((prev) => ({ ...prev, [q.text]: e.target.value }))} maxLength={2000} className="min-h-12 rounded-2xl border border-primary bg-secondary px-4 py-2 text-base text-primary" placeholder="Your answer" />
                    </label>
                  ))}
                  <div>
                    <button type="button" onClick={sendAnswers} disabled={busy} className={cn(pillClass, "bg-secondary text-primary hover:bg-primary")}>{busy ? "Sending…" : "Send answers"}</button>
                  </div>
                </div>
              ) : null}
              {plan.status === "awaiting_approval" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={approve} disabled={busy} className={cn(pillClass, "bg-secondary text-primary hover:bg-primary")}>{busy ? "Starting…" : "Start the build"}</button>
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
                  <Link href={guardedPlayHref({ childId: child }, current.id, "play")} className={cn(pillClass, "bg-secondary text-primary hover:bg-primary")}>▶ Test it (uses play time)</Link>
                ) : null}
              </div>
            ) : (
              <h2 className="text-lg font-semibold">What game do you want to make?</h2>
            )}
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-tertiary">{current ? "What should change?" : "Describe it in a few sentences"}</span>
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} maxLength={2000} className="min-h-24 rounded-2xl border border-primary bg-secondary px-4 py-3 text-base text-primary" placeholder={current ? "Make the enemies slower and add a double jump" : "A space game where I collect stars and dodge comets, with touch controls"} />
            </label>
            {notice ? <p role="status" className="text-sm font-medium text-secondary">{notice}</p> : null}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={submit} disabled={busy || prompt.trim().length < 4} className={cn(pillClass, prompt.trim().length >= 4 && !busy ? "bg-secondary text-primary hover:bg-primary" : "cursor-not-allowed bg-primary text-quaternary")}>
                {busy ? "Sending…" : current ? "Plan the change" : "Build it"}
              </button>
              <Link href={childShellDestinationHref("games", child)} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>Back to Games</Link>
            </div>
            <p className="text-xs text-tertiary">{current ? "Game Studio first shows you a plan and may ask questions; the build only starts when you approve it." : "A build takes a few minutes."} Deleting, restoring old versions and downloading are things a parent does.</p>
          </section>
        </>
      )}
    </main>
  );
}
