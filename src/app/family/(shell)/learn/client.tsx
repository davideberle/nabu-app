"use client";

// ---------------------------------------------------------------------------
// The expedition world — /family/learn (world-first learner experience,
// 2026-10-03; family-assistant DESIGN §7.6 UX-1/UX-2/UX-5).
//
// The screen IS the world: an illustrated isometric settlement drawn from the
// saved mission state, with the three visit sites in their true state, the
// base, garden, station beds, station and lamp, supply crates and the logbook.
// One dominant next action sits over it; a minimal HUD shows the two honest
// counts of the progress rule (completed visits this week / in total). The
// visit report of every finished visit reopens from its flag (and from
// `?report=<visit>` after a reload); a running visit opens an honest partial
// recap. The logbook pages, the vocabulary cue and the full progress strip
// live in a side panel, not on the map. Isabel gets her own not-yet-prepared
// state and never sees Santiago's world.
//
// Presentation only: the server view (child-scoped credential) is the truth.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/components/ui/nabu";
import { useChildShell } from "@/components/family/child-shell-provider";
import type { ChildId } from "@/lib/family-assistant-turn";
import { browserTimeZone, createLearningClient } from "@/lib/family-learning-client";
import { retireAllDrafts } from "@/lib/family-learning-draft-store";
import type { ChildView } from "@/lib/family-learning-state";
import type { ProgressStrip } from "@/lib/family-learning-progress";
import type { VisitReport } from "@/lib/family-learning-feedback";
import { ExpeditionWorld, supplyRows, type WorldMarker } from "@/components/family/learning/expedition-world";
import { ExpeditionNotPrepared } from "@/components/family/learning/not-prepared";
import { VisitReportView } from "@/components/family/learning/visit-report";
import { focusRing, primaryButton, secondaryButton } from "./mission/styles";

type Load =
  | { kind: "loading" }
  | { kind: "ready"; view: ChildView }
  | { kind: "unprepared" }
  | { kind: "trouble"; message: string };

export function FamilyLearnClient() {
  const { child, restored } = useChildShell();
  if (!restored || !child) return null;
  // Keyed by child: switching profiles discards the other child's view instantly instead of rendering it for a frame.
  return <World key={child} child={child} />;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("de-CH", { weekday: "long", day: "numeric", month: "long" });
  } catch {
    return iso;
  }
}

/** The three visit sites of the reviewed content with their TRUE state; nothing beyond the served content is shown. */
export function worldMarkers(view: ChildView): WorldMarker[] {
  const running = view.visit;
  const completed = new Set(view.progress.completed.map((c) => c.visit));
  const ordered = ["v1", "v2", "v4"] as const;
  const markers: WorldMarker[] = [];
  for (const id of ordered) {
    const report = view.reports.find((r) => r.visit === id) ?? null;
    const done = completed.has(id);
    const isRunning = running?.id === id;
    const isNext = !isRunning && view.next.visit === id;
    const ordinal = report?.ordinal ?? view.progress.completed.find((c) => c.visit === id)?.ordinal ?? (id === "v1" ? 1 : id === "v2" ? 2 : view.next.visit === id ? view.next.ordinal : 3);
    const label = report?.label ?? view.progress.completed.find((c) => c.visit === id)?.label ?? (isRunning ? running!.title : isNext ? view.progress.next.label ?? `Besuch ${ordinal ?? ""}` : `Besuch ${ordinal ?? ""}`);
    markers.push({
      visit: id,
      ordinal,
      label,
      caption: `Besuch ${ordinal ?? ""}`.trim(),
      state: done ? "done" : isRunning ? "running" : isNext ? "next" : "later",
      progress: isRunning && running ? { done: Math.min(running.stageIndex, running.stageCount), count: running.stageCount } : null,
    });
  }
  // A historical v3 record (the retired delayed check) keeps its label in the reports but has no site on the map.
  return markers;
}

type Panel = { kind: "report"; visit: string } | { kind: "logbook" } | { kind: "progress" } | { kind: "supplies" } | null;

function World({ child }: { child: ChildId }) {
  const client = useMemo(() => createLearningClient(), []);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const aliveRef = useRef(true);
  const reportParam = searchParams.get("report");
  const [panel, setPanel] = useState<Panel>(() => (reportParam ? { kind: "report", visit: reportParam } : null));
  const primaryRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    aliveRef.current = true;
    const abort = new AbortController();
    (async () => {
      const outcome = await client.read(child, { signal: abort.signal, timeZone: browserTimeZone() });
      if (!aliveRef.current) return;
      if (outcome.ok) {
        setLoad({ kind: "ready", view: outcome.view });
        return;
      }
      // Only a confirmed "not prepared" answer (404, or 200 with prepared:false) is the not-prepared state; a malformed success is a load error (A07).
      if (outcome.status === 404 || outcome.failure === "unprepared") {
        setLoad({ kind: "unprepared" });
        return;
      }
      // R5-3: an answered auth loss retires the completed drafts of the ended sign-in.
      if (outcome.failure === "unauthorized" || outcome.failure === "no-session") retireAllDrafts(window.sessionStorage);
      setLoad({
        kind: "trouble",
        message:
          outcome.failure === "unavailable"
            ? "Die Expedition ist gerade nicht erreichbar. Deine gespeicherte Basis bleibt sicher."
            : outcome.failure === "unauthorized"
              ? "Bitte melde dich neu an."
              : "Die Expedition lädt gerade nicht. Versuch es gleich nochmal.",
      });
    })();
    return () => {
      aliveRef.current = false;
      abort.abort();
      client.reset();
    };
  }, [child, client]);

  // The URL carries the open report so a reload or back/forward reopens it; the child selection stays in the URL too.
  const setReportParam = useCallback(
    (visit: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("child", child);
      if (visit) params.set("report", visit);
      else params.delete("report");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [child, pathname, router, searchParams],
  );
  const openPanel = (next: Panel) => {
    setPanel(next);
    setReportParam(next?.kind === "report" ? next.visit : null);
  };
  const closePanel = () => openPanel(null);

  if (load.kind === "loading") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-base text-tertiary" role="status">
          Expedition wird geladen …
        </p>
      </div>
    );
  }
  if (load.kind === "unprepared" || (load.kind === "ready" && load.view.child !== child)) return <ExpeditionNotPrepared child={child} />;
  if (load.kind === "trouble") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <BackToHome child={child} />
        <div className="mt-6 rounded-3xl border border-primary bg-primary p-8 text-center">
          <p className="text-lg text-primary" role="status">
            {load.message}
          </p>
        </div>
      </div>
    );
  }

  const view = load.view;
  const running = view.visit;
  const canStart = running !== null || view.next.visit !== null;
  const startLabel = running ? "Weiter" : view.next.visit === "v1" ? "Start" : view.next.visit === "v4" ? `Besuch ${view.next.ordinal ?? 3} starten` : "Weiter";
  const markers = worldMarkers(view);
  const report: VisitReport | null = panel?.kind === "report" ? view.reports.find((r) => r.visit === panel.visit) ?? null : null;
  const missionHref = `/family/learn/mission?child=${child}`;

  const onSelectMarker = (m: WorldMarker) => {
    if (m.state === "done") openPanel({ kind: "report", visit: m.visit });
    else if (m.state === "running") openPanel({ kind: "report", visit: m.visit });
    else if (m.state === "next") router.push(missionHref);
  };

  return (
    <div className="relative h-[calc(100dvh-4.25rem)] min-h-[560px] w-full overflow-hidden" data-testid="world-screen" data-world-next={view.next.visit ?? ""} data-world-running={running?.id ?? ""}>
      {/* One continuous world viewport; the HUD and the one action float over it. */}
      <div className="absolute inset-0">
        <ExpeditionWorld scene={view.scene} markers={markers} pages={view.pages.length} onSelectMarker={onSelectMarker} onOpenLogbook={() => openPanel({ kind: "logbook" })} onOpenSupplies={() => openPanel({ kind: "supplies" })} />
      </div>

      {/* HUD — top right: the one honest count (the shell bar above already carries Home) */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-end gap-3 p-3 sm:p-4">
        <button type="button" onClick={() => openPanel({ kind: "progress" })} className={cn("pointer-events-auto inline-flex min-h-12 items-center gap-2 rounded-full border border-primary bg-primary/90 px-4 text-base text-primary shadow-xs backdrop-blur hover:bg-primary", focusRing)} data-testid="hud-progress" aria-label={`Fertige Besuche: ${view.progress.completedTotal}, diese Woche ${view.progress.completedThisWeek}. Fortschritt öffnen`}>
          <span aria-hidden>✓</span>
          <span>
            {view.progress.completedTotal} {view.progress.completedTotal === 1 ? "Besuch" : "Besuche"} fertig
          </span>
          <span className="text-tertiary">· Woche {view.progress.completedThisWeek}</span>
        </button>
      </div>

      {/* The one dominant action — bottom left, over the world, beside the island */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-start gap-2 px-3 pb-4 sm:px-6 sm:pb-6">
        <div className="w-full max-w-md rounded-3xl border border-primary bg-primary/95 p-4 shadow-md backdrop-blur sm:p-5" data-testid="world-action">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-tertiary">{running ? "Angefangen" : view.next.visit ? "Als Nächstes" : "Alles gespeichert"}</p>
          <p className="mt-1 text-xl font-semibold leading-tight text-primary sm:text-2xl" data-testid="world-next-step">
            {view.nextStep}
          </p>
          {running ? (
            <p className="mt-1 text-base text-tertiary" data-testid="running-visit">
              {running.title} · Schritt {Math.min(running.stageIndex + 1, running.stageCount)} von {running.stageCount}
            </p>
          ) : view.base.name ? (
            <p className="mt-1 text-base text-tertiary">
              Basis „{view.base.name}“{view.base.location ? ` · ${view.base.location.label}` : ""}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {canStart ? (
              <Link ref={primaryRef} href={missionHref} className={cn(primaryButton, "min-h-16 px-8 text-xl")} data-testid="cockpit-start">
                {startLabel}
                <span aria-hidden>→</span>
              </Link>
            ) : (
              <p className="sr-only" data-testid="next-unavailable">
                {view.next.reason === "all-visits-done" ? "Alle Besuche geschafft." : "Gerade nichts Neues — alles ist gespeichert."}
              </p>
            )}
            {running ? (
              <button type="button" onClick={() => openPanel({ kind: "report", visit: running.id })} className={secondaryButton} data-testid="world-partial">
                Zwischenstand
              </button>
            ) : view.progress.recent ? (
              <button type="button" onClick={() => openPanel({ kind: "report", visit: view.progress.recent!.visit })} className={secondaryButton} data-testid="world-last-report">
                Letzter Bericht
              </button>
            ) : null}
          </div>
        </div>
        <p className="rounded-full bg-primary/70 px-3 py-1 text-xs text-stone-800/80 backdrop-blur dark:text-stone-200/80" data-testid="world-retention">
          Deine Eltern können sehen, was du hier lernst.
        </p>
      </div>

      {panel ? (
        <SidePanel onClose={closePanel} title={panel.kind === "report" ? (report ? (report.partial ? "Zwischenstand" : "Bericht") : "Bericht") : panel.kind === "logbook" ? "Logbuch" : panel.kind === "supplies" ? "Vorräte" : "Mein Fortschritt"}>
          {panel.kind === "report" ? (
            report ? (
              <VisitReportView report={report} scene={view.scene} markers={markers} onBack={closePanel} backLabel="Zur Karte" onNext={report.partial ? () => router.push(missionHref) : undefined} nextLabel={report.partial ? "Weitermachen" : undefined} />
            ) : (
              <p className="text-base text-primary" data-testid="report-missing">
                Zu diesem Besuch gibt es keinen Bericht.
              </p>
            )
          ) : panel.kind === "logbook" ? (
            <LogbookPanel view={view} />
          ) : panel.kind === "supplies" ? (
            <ul className="grid gap-2 sm:grid-cols-2" data-testid="supplies-panel">
              {supplyRows(view.scene).map((r) => (
                <li key={r.label} className="rounded-2xl border border-primary bg-primary px-4 py-3 text-lg text-primary">
                  <strong>{r.count}</strong> {r.label}
                </li>
              ))}
            </ul>
          ) : (
            <ProgressPanel progress={view.progress} view={view} onOpenReport={(visit) => openPanel({ kind: "report", visit })} />
          )}
        </SidePanel>
      ) : null}
    </div>
  );
}

function SidePanel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="absolute inset-0 z-20 flex justify-end bg-stone-900/30" role="presentation" onClick={onClose} data-testid="side-panel">
      <section role="dialog" aria-modal="true" aria-label={title} className="flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-secondary p-4 shadow-2xl sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-tertiary">{title}</p>
          <button ref={closeRef} type="button" onClick={onClose} className={cn("inline-flex min-h-12 min-w-12 items-center justify-center rounded-full border border-primary bg-primary text-xl", focusRing)} aria-label="Schliessen" data-testid="panel-close">
            ×
          </button>
        </div>
        <div className="mt-4 flex-1">{children}</div>
      </section>
    </div>
  );
}

function LogbookPanel({ view }: { view: ChildView }) {
  return (
    <div className="flex flex-col gap-4" data-testid="logbook-panel">
      {view.pages.length === 0 ? (
        <p className="text-base text-tertiary">Noch keine Seite gespeichert. Die erste entsteht am Ende deines Besuchs.</p>
      ) : (
        <ul className="grid gap-3">
          {view.pages.map((page, index) => (
            <li key={`${page.visit}-${index}`} id={index === view.pages.findIndex((p) => p.visit === page.visit) ? `pages-${page.visit}` : undefined} className="rounded-2xl border border-primary bg-primary p-4" data-testid="logbook-page">
              <p className="text-sm text-tertiary">{formatDate(page.at)}</p>
              <p className="mt-1 font-semibold text-primary">
                {page.title} — {page.baseName}
              </p>
              <p className="mt-2 text-base text-primary">{page.text}</p>
              {page.explanation ? <p className="mt-2 text-sm text-tertiary">Meine Erklärung: {page.explanation}</p> : null}
            </li>
          ))}
        </ul>
      )}
      {view.vocabulary && view.vocabulary.words.length > 0 ? (
        <section className="rounded-3xl border border-primary bg-primary p-4" data-testid="vocabulary-cue" aria-labelledby="vocab-heading">
          <h2 id="vocab-heading" className="text-lg font-semibold text-primary">
            Wörter zum Üben
          </h2>
          <ul className="mt-3 space-y-2">
            {view.vocabulary.words.map((w) => (
              <li key={w.entryId} className="rounded-2xl bg-secondary px-4 py-3" data-testid={`vocab-word-${w.entryId}`}>
                <p className="text-base font-semibold text-primary">
                  <span lang={w.language}>{w.lemma}</span> <span className="font-normal text-tertiary">= {w.gloss}</span>
                </p>
                <p className="mt-1 text-base text-primary">{w.try}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-tertiary">{view.vocabulary.note}</p>
        </section>
      ) : null}
      <p className="text-xs text-tertiary">Deine Eltern können sehen, was du hier lernst. {view.retention}</p>
    </div>
  );
}

/** The follow-on progress strip, unchanged in meaning: completed visit EVENTS, one next step, the review-grounded recent pair. */
function ProgressPanel({ progress, view, onOpenReport }: { progress: ProgressStrip; view: ChildView; onOpenReport: (visit: string) => void }) {
  const recent = progress.recent;
  return (
    <section className="flex flex-col gap-3" data-testid="progress-strip" aria-labelledby="progress-heading">
      <h2 id="progress-heading" className="text-lg font-semibold text-primary">
        Mein Fortschritt
      </h2>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-base text-primary">
        <p data-testid="progress-week">
          Diese Woche fertig: <strong>{progress.completedThisWeek}</strong> {progress.completedThisWeek === 1 ? "Besuch" : "Besuche"}
        </p>
        <p data-testid="progress-total">
          Insgesamt fertig: <strong>{progress.completedTotal}</strong> {progress.completedTotal === 1 ? "Besuch" : "Besuche"}
        </p>
      </div>
      <p className="text-xs text-tertiary" data-testid="progress-week-label">
        Woche: {progress.week.label}. {progress.counting}
      </p>
      {progress.completed.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Fertige Besuche">
          {progress.completed.map((c) => (
            <li key={`${c.visit}-${c.finishedAt}`}>
              <button type="button" onClick={() => onOpenReport(c.visit)} className={cn("inline-flex min-h-10 items-center gap-1 rounded-full border border-primary bg-primary px-3 text-sm text-primary hover:bg-secondary", focusRing)} data-testid={`progress-visit-${c.visit}`} data-this-week={c.thisWeek ? "true" : "false"}>
                <span aria-hidden>✓</span> {c.label}
                <span className="text-tertiary">· {formatDate(c.finishedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-base text-primary" data-testid="progress-next" data-kind={progress.next.kind}>
        <span className="font-medium">Als Nächstes:</span> {progress.next.text}
      </p>
      {recent ? (
        <div className="rounded-2xl border border-primary bg-primary px-4 py-3" data-testid="progress-recent" data-grounding={recent.grounding.source} data-suppressed={recent.grounding.suppressed?.reason ?? "none"}>
          <p className="text-sm text-tertiary">Zuletzt: {recent.label}</p>
          {recent.did ? (
            <p className="mt-1 text-base text-primary" data-testid="progress-did">
              <span className="font-medium">Das hast du gemacht:</span> {recent.did}
            </p>
          ) : (
            <p className="mt-1 text-base text-primary" data-testid="progress-artifact">
              <span className="font-medium">Entstanden:</span> {recent.artifact.text}
            </p>
          )}
          <p className="mt-1 text-base text-primary" data-testid="progress-try-next">
            {/^Nächstes Mal/.test(recent.tryNext) ? null : <span className="font-medium">Probier als Nächstes: </span>}
            {recent.tryNext}
          </p>
          {recent.grounding.suppressed ? (
            <p className="mt-1 text-xs text-tertiary" data-testid="progress-suppressed">
              {recent.grounding.suppressed.text}
            </p>
          ) : null}
        </div>
      ) : null}
      {view.reports.filter((r) => !r.partial).length ? (
        <p className="text-xs text-tertiary">Tippe auf einen fertigen Besuch, um seinen Bericht zu öffnen.</p>
      ) : null}
    </section>
  );
}

function BackToHome({ child }: { child: ChildId }) {
  return (
    <Link href={`/family/assistant?child=${child}`} className={cn("inline-flex min-h-12 items-center gap-2 rounded-full border border-primary bg-primary/90 px-4 text-base text-primary shadow-xs backdrop-blur hover:bg-primary", focusRing)}>
      <span aria-hidden>←</span> Home
    </Link>
  );
}
