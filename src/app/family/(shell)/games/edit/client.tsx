"use client";

// ---------------------------------------------------------------------------
// Make or change a game — the child's scoped editor (GP-04: Edit is free and
// never a Play frame; "Test it" goes to the guarded play surface, which meters).
// Everything here speaks to the Game Studio CHILD adapter with the child's
// library credential; the owner route is never involved.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/components/ui/nabu";
import { assistantProfileById } from "@/data/family-assistant";
import { useChildShell } from "@/components/family/child-shell-provider";
import type { ChildId } from "@/lib/family-assistant-turn";
import { childShellDestinationHref, guardedPlayHref } from "@/lib/family-child-shell";
import { createGamesClient, type StudioAccess, type StudioProject } from "@/lib/family-games-client";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500";
const pillClass = cn(
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-primary px-5 py-2 text-sm font-semibold transition-colors",
  focusRing,
);

type Load = { kind: "loading" } | { kind: "ready"; studio: StudioAccess; projects: StudioProject[] } | { kind: "unconfigured" } | { kind: "unreachable" } | { kind: "error" };

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

  // Poll while a build runs (a build is minutes long; this is a read, never a Play frame).
  useEffect(() => {
    if (load.kind !== "ready") return;
    const running = load.projects.some((p) => p.latestJob && (p.latestJob.status === "queued" || p.latestJob.status === "running"));
    if (!running) return;
    const timer = window.setTimeout(reload, 8_000);
    return () => window.clearTimeout(timer);
  }, [load, reload]);

  const submit = useCallback(async () => {
    if (load.kind !== "ready" || busy || prompt.trim().length < 4) return;
    setBusy(true);
    setNotice(null);
    const outcome = selected ? await client.iterateProject(load.studio, selected, prompt.trim()) : await client.createProject(load.studio, prompt.trim());
    setBusy(false);
    if (!outcome.ok) {
      setNotice(outcome.status === 409 ? "That game is still building — wait a moment." : outcome.status === 403 ? "You can only change your own games." : "That didn't work. Try again in a moment.");
      return;
    }
    setPrompt("");
    if (!selected && "project" in outcome.value) setSelected((outcome.value as { project: StudioProject }).project.id);
    setNotice(selected ? "Working on your change…" : "Building your game…");
    reload();
  }, [busy, client, load, prompt, reload, selected]);

  const current = load.kind === "ready" && selected ? load.projects.find((p) => p.id === selected) ?? null : null;

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
                {busy ? "Sending…" : current ? "Change it" : "Build it"}
              </button>
              <Link href={childShellDestinationHref("games", child)} className={cn(pillClass, "bg-primary text-secondary hover:bg-secondary")}>Back to Games</Link>
            </div>
            <p className="text-xs text-tertiary">A build takes a few minutes. Deleting, restoring old versions and downloading are things a parent does.</p>
          </section>
        </>
      )}
    </main>
  );
}
