"use client";

// ---------------------------------------------------------------------------
// The visit report (world-first 2026-10-03; UX-5; visual round 1 V4).
// Unmissable after every completed visit, reopenable from the world and after
// a reload. The top view is short: strength / practice / next step, the
// actual world change (the settlement as it is now plus what changed), and
// the one map action. Every lesson's evidence — original attempts, help
// distinctions, unscored items, retries, references — stays inspectable in a
// details section below. A running visit shows the same shape as an honest
// PARTIAL recap — never as a completed visit. Every line is bound to a
// recorded fact the server put into `VisitReport`.
// ---------------------------------------------------------------------------

import { useRef, useState } from "react";
import { cn } from "@/components/ui/nabu";
import type { LessonFeedback, VisitReport } from "@/lib/family-learning-feedback";
import type { SceneModel } from "@/lib/family-learning-summary";
import { focusRing, primaryButton, secondaryButton } from "@/app/family/(shell)/learn/mission/styles";
import { ExpeditionWorld, type WorldMarker } from "./expedition-world";
import { useDeliberateFocus } from "./focus";

const unlabel = (text: string) => text.replace(/^(Geschafft|Geübt|Nächstes Mal): /, "");

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("de-CH", { weekday: "long", day: "numeric", month: "long" });
  } catch {
    return iso;
  }
}

const CLOSE_LABEL: Record<LessonFeedback["close"]["kind"], string> = {
  "none-needed": "richtig",
  "corrected-with-practice": "mit Üben korrigiert",
  "corrected-with-help": "mit Hilfe korrigiert",
  "practice-again": "üben wir nochmal",
  pending: "offen",
  unscored: "nicht bewertet",
};

const RESULT_LABEL = { correct: "richtig", incorrect: "noch nicht", unscored: "nicht bewertet" } as const;

function LessonRow({ lesson }: { lesson: LessonFeedback }) {
  const [open, setOpen] = useState(false);
  const tone = lesson.close.kind === "none-needed" || lesson.close.kind === "corrected-with-practice" ? "ok" : lesson.close.kind === "unscored" || lesson.close.kind === "pending" ? "neutral" : "warn";
  return (
    <li className="rounded-2xl border border-primary bg-primary" data-testid="report-lesson" data-lesson-kind={lesson.lesson.kind} data-close={lesson.close.kind}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={cn("flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl px-4 py-3 text-left", focusRing)}>
        <span className={cn("inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-sm font-semibold", tone === "ok" && "bg-green-100 text-green-900 dark:bg-green-950/50 dark:text-green-200", tone === "warn" && "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-100", tone === "neutral" && "bg-secondary text-primary")} aria-hidden>
          {tone === "ok" ? "✓" : tone === "warn" ? "↻" : "·"}
        </span>
        <span className="text-base font-semibold text-primary">{lesson.lesson.title}</span>
        <span className="text-sm text-tertiary">{CLOSE_LABEL[lesson.close.kind]}</span>
        <span className="ml-auto text-sm text-tertiary">{open ? "weniger" : "mehr"}</span>
      </button>
      {open ? (
        <div className="space-y-2 px-4 pb-4 text-base text-primary">
          {lesson.success ? <p data-testid="report-lesson-success">✓ {lesson.success.text}</p> : null}
          {lesson.mistakes.map((m) => (
            <p key={m.id} className="rounded-xl bg-amber-50 px-3 py-2 dark:bg-amber-950/40" data-testid="report-lesson-mistake">
              <span className="text-tertiary">Du:</span> <strong className="font-mono">{m.given}</strong>
              {m.expected !== "—" ? (
                <>
                  {" · "}
                  <span className="text-tertiary">richtig:</span> <strong className="font-mono">{m.expected}</strong>
                </>
              ) : null}
              {m.count > 1 ? ` (${m.count}×)` : ""} — {m.correction}
            </p>
          ))}
          {lesson.unscored.map((m) => (
            <p key={m.id} className="rounded-xl bg-secondary px-3 py-2 text-tertiary" data-testid="report-lesson-unscored">
              Nicht bewertet: <span className="font-mono text-primary">{m.given}</span> — {m.correction}
            </p>
          ))}
          {lesson.repair.retries.length ? (
            <p className="text-sm text-tertiary" data-testid="report-lesson-retries">
              Weitere Versuche: {lesson.repair.retries.map((r) => `${r.purpose === "fresh-check" ? "Probe" : "Versuch"} ${r.no} ${RESULT_LABEL[r.result]}`).join(", ")}
              {lesson.repair.explanation ? ` · Beispiel gezeigt: ${lesson.repair.explanation.recorded ? "ja" : "nein"}` : ""}
            </p>
          ) : null}
          <p className="text-sm text-tertiary">{lesson.close.text}</p>
        </div>
      ) : null}
    </li>
  );
}

export function VisitReportView({ report, scene, markers, onBack, backLabel = "Zur Karte", onNext, nextLabel, children }: { report: VisitReport; scene?: SceneModel | null; markers?: WorldMarker[]; onBack: () => void; backLabel?: string; onNext?: () => void; nextLabel?: string; children?: React.ReactNode }) {
  const backRef = useRef<HTMLButtonElement | null>(null);
  useDeliberateFocus(backRef, `report:${report.visit}:${report.startedAt}`);
  const s = report.summary;
  const good = report.lessons.filter((l) => l.close.kind === "none-needed" || l.close.kind === "corrected-with-practice" || l.close.kind === "corrected-with-help").length;
  const openPractice = report.lessons.filter((l) => l.close.kind === "practice-again").length;
  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-4" data-testid="visit-report" data-report-visit={report.visit} data-report-partial={report.partial ? "true" : "false"} aria-labelledby="report-title">
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-tertiary">{report.partial ? "Zwischenstand" : "Dein Bericht"}</p>
        <h1 id="report-title" className="mt-1 text-3xl font-semibold leading-tight tracking-[-0.02em] text-primary sm:text-4xl">
          {report.label}
        </h1>
        <p className="mt-1 text-base text-tertiary">
          {report.partial ? `Angefangen, Schritt ${report.stagesDone} von ${report.stageCount} — noch nicht fertig. Alles bis hier ist gespeichert.` : `Fertig am ${formatDate(report.finishedAt ?? report.startedAt)}.`}
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <section className="rounded-3xl bg-green-50 p-4 dark:bg-green-950/30" data-testid="report-success">
          <p className="text-sm font-semibold uppercase tracking-wide text-green-800 dark:text-green-300">Das ging gut</p>
          <p className="mt-1 text-lg font-medium leading-snug text-primary">{s.success ? unlabel(s.success.text) : report.partial ? "Noch nichts Bewertetes — du bist mitten drin." : "Du hast die Basis besucht."}</p>
        </section>
        <section className="rounded-3xl bg-amber-50 p-4 dark:bg-amber-950/30" data-testid="report-practice">
          <p className="text-sm font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-200">Das übst du</p>
          <p className="mt-1 text-lg font-medium leading-snug text-primary">{s.practiced ? unlabel(s.practiced.text) : "Heute nichts Besonderes."}</p>
        </section>
        <section className="rounded-3xl bg-secondary p-4" data-testid="report-next">
          <p className="text-sm font-semibold uppercase tracking-wide text-tertiary">Nächster Schritt</p>
          <p className="mt-1 text-lg font-medium leading-snug text-primary">{unlabel(s.next.text)}</p>
        </section>
      </div>

      <section className="overflow-hidden rounded-3xl border border-primary bg-primary" data-testid="report-world">
        {scene && markers ? (
          <div className="h-36 sm:h-44">
            <ExpeditionWorld scene={scene} markers={markers} pages={scene.pagesSaved} variant="strip" />
          </div>
        ) : null}
        <div className="p-4">
          <p className="text-sm font-semibold uppercase tracking-wide text-tertiary">In deiner Welt</p>
          {report.worldChanges.length ? (
            <ul className="mt-2 flex flex-wrap gap-2">
              {report.worldChanges.map((c) => (
                <li key={c} className="rounded-full bg-secondary px-3 py-1 text-base text-primary">
                  {c}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-base text-tertiary">{report.partial ? "Bis jetzt hat sich in der Welt noch nichts verändert." : "Heute hat sich in der Welt nichts verändert."}</p>
          )}
          {s.artifact.kind !== "none" ? (
            <p className="mt-2 text-base text-primary" data-testid="report-artifact" data-artifact-kind={s.artifact.kind}>
              <span className="text-tertiary">{s.artifact.kind === "station" ? "Gebaut: " : "Deine Seite: "}</span>
              {s.artifact.text}
            </p>
          ) : (
            <p className="sr-only" data-testid="report-artifact" data-artifact-kind="none">
              {s.artifact.text}
            </p>
          )}
        </div>
      </section>

      {children}

      <div className="flex flex-wrap gap-2">
        <button ref={backRef} type="button" onClick={onBack} className={primaryButton} data-testid="report-back">
          {backLabel}
        </button>
        {onNext && nextLabel ? (
          <button type="button" onClick={onNext} className={secondaryButton} data-testid="report-next-action">
            {nextLabel}
          </button>
        ) : null}
      </div>

      <details className="rounded-2xl border border-primary px-4 py-2" data-testid="report-lessons">
        <summary className={cn("cursor-pointer text-base text-primary", focusRing)}>
          Schritt für Schritt
          <span className="ml-2 text-sm text-tertiary">{report.lessons.length === 0 ? "noch keine Aufgabe fertig" : `${good} von ${report.lessons.length} ohne offene Übung${openPractice ? ` · ${openPractice} zum Üben` : ""}`}</span>
        </summary>
        {report.lessons.length ? (
          <ul className="mt-2 space-y-2">
            {report.lessons.map((l) => (
              <LessonRow key={l.id} lesson={l} />
            ))}
          </ul>
        ) : null}
        <p className="mt-2 text-xs text-tertiary">Jede Zeile hier stammt aus deinen gespeicherten Antworten. Was nicht aufgezeichnet wurde, steht auch nicht hier.</p>
      </details>
    </article>
  );
}
