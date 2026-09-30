"use client";

// ---------------------------------------------------------------------------
// The child learning cockpit — /family/learn (family-assistant DESIGN §7.6).
//
// One primary Start/Continue action, a picture of the saved base, a short next
// step, the saved expedition pages and access to the tutor (through the
// mission workspace). Only genuinely available activities are shown: the
// delayed check appears with its real opening date, never as a fake lock.
// Isabel gets her own not-yet-prepared state and never sees Santiago's base.
//
// Presentation only: the server view (child-scoped credential) is the truth.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { NabuBadge, cn } from "@/components/ui/nabu";
import { useChildShell } from "@/components/family/child-shell-provider";
import type { ChildId } from "@/lib/family-assistant-turn";
import { createLearningClient } from "@/lib/family-learning-client";
import { retireAllDrafts } from "@/lib/family-learning-draft-store";
import type { ChildView } from "@/lib/family-learning-state";
import { BaseScene } from "@/components/family/learning/base-scene";
import { ExpeditionNotPrepared } from "@/components/family/learning/not-prepared";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500";

const primaryButton = cn(
  "inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-stone-900 px-6 text-lg font-semibold text-white shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-md dark:bg-stone-100 dark:text-stone-900",
  focusRing,
);

type Load =
  | { kind: "loading" }
  | { kind: "ready"; view: ChildView }
  | { kind: "unprepared" }
  | { kind: "trouble"; message: string };

export function FamilyLearnClient() {
  const { child, restored } = useChildShell();
  if (!restored || !child) return null;
  // Keyed by child: switching profiles discards the other child's view
  // instantly instead of rendering it for a frame.
  return <Cockpit key={child} child={child} />;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("de-CH", { weekday: "long", day: "numeric", month: "long" });
  } catch {
    return iso;
  }
}

function Cockpit({ child }: { child: ChildId }) {
  const client = useMemo(() => createLearningClient(), []);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    const abort = new AbortController();
    (async () => {
      const outcome = await client.read(child, { signal: abort.signal });
      if (!aliveRef.current) return;
      if (outcome.ok) {
        setLoad({ kind: "ready", view: outcome.view });
        return;
      }
      // Only a confirmed "not prepared" answer (404, or 200 with prepared:false)
      // is the not-prepared state; a malformed success is a load error (A07).
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

  if (load.kind === "loading") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-base text-tertiary" role="status">
          Expedition wird geladen …
        </p>
      </div>
    );
  }

  if (load.kind === "unprepared" || (load.kind === "ready" && load.view.child !== child)) {
    return <ExpeditionNotPrepared child={child} />;
  }

  if (load.kind === "trouble") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <BackToHome child={child} />
        <div className="mt-6 rounded-3xl border border-primary bg-primary p-8 text-center">
          <span className="text-5xl" aria-hidden>
            📡
          </span>
          <p className="mt-4 text-lg text-primary" role="status">
            {load.message}
          </p>
        </div>
      </div>
    );
  }

  const view = load.view;
  const running = view.visit;
  const canStart = running !== null || view.next.visit !== null;
  const startLabel = running ? "Weiter" : view.next.visit === "v1" ? "Start" : view.next.visit === "v4" ? "Neues Kapitel" : view.next.visit === "v3" ? "Kurzer Check" : "Weiter";

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <BackToHome child={child} />

      <header className="mt-4">
        <p className="text-sm font-medium uppercase tracking-wide text-tertiary">Lernen</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-[-0.02em] text-primary">{view.title}</h1>
        <p className="mt-1 text-base text-tertiary">{view.hook}</p>
      </header>

      <section className="mt-6 overflow-hidden rounded-3xl border border-primary bg-primary shadow-xs dark:shadow-none">
        <BaseScene scene={view.scene} compact />
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-lg font-semibold text-primary">
              {view.base.name ? `Basis „${view.base.name}“` : "Noch keine Basis"}
            </p>
            <p className="mt-1 text-base text-tertiary">{view.nextStep}</p>
            {view.delayedCheck && view.delayedCheck.status === "waiting" && canStart ? (
              <p className="mt-1 text-sm text-tertiary" data-testid="delayed-check-note">
                {view.delayedCheck.childText}
              </p>
            ) : null}
            {running ? (
              <p className="mt-1 text-sm text-tertiary">
                {running.title} · Schritt {Math.min(running.stageIndex + 1, running.stageCount)} von {running.stageCount}
              </p>
            ) : null}
          </div>
          {canStart ? (
            <Link href={`/family/learn/mission?child=${child}`} className={primaryButton}>
              {startLabel}
              <span aria-hidden>→</span>
            </Link>
          ) : view.next.availableAt ? (
            <div className="rounded-2xl bg-secondary px-4 py-3 text-sm text-primary" data-testid="delayed-check-waiting">
              {view.delayedCheck?.childText ?? `Eine kurze Aufgabe von früher kommt am ${formatDate(view.next.availableAt)} zurück.`}
            </div>
          ) : (
            <NabuBadge tone="green">Alle Besuche geschafft</NabuBadge>
          )}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold text-primary">Expeditionsseiten</h2>
        {view.pages.length === 0 ? (
          <p className="mt-2 text-base text-tertiary">Noch keine Seite gespeichert. Die erste entsteht am Ende deines Besuchs.</p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {view.pages.map((page, index) => (
              <li key={`${page.visit}-${index}`} className="rounded-2xl border border-primary bg-primary p-4">
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
      </section>

      <p className="mt-8 text-xs text-tertiary">
        Deine Eltern können sehen, was du hier lernst. {view.retention}
      </p>
    </div>
  );
}

function BackToHome({ child }: { child: ChildId }) {
  return (
    <Link href={`/family/assistant?child=${child}`} className={cn("inline-flex min-h-12 items-center gap-2 rounded-full px-3 text-base text-tertiary hover:text-primary", focusRing)}>
      <span aria-hidden>←</span> Home
    </Link>
  );
}
