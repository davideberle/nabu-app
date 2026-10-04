"use client";

// ---------------------------------------------------------------------------
// The mission workspace — /family/learn/mission (family-assistant DESIGN §7.6;
// world-first learner experience 2026-10-03).
//
// A calm notebook under a thin strip of the child's world: one task at a time,
// a short imperative instruction, the story as a separate illustrated beat.
// Every lesson closes immediately with its evidence-backed feedback and, when
// warranted, the bounded visual mini-lesson with one to three targeted retries
// (UX-5a/5b); the one relevant reminder appears before the next matching
// lesson (UX-5c); a completed visit leads straight into the reopenable report
// before the map (UX-5). Focus moves deliberately to the active answer field
// at task transitions and never steals from the tutor panel or a dialog; Enter
// never submits during IME composition (UX-3). Finger placement is taught with
// the visible hand/keyboard diagram (UX-4).
//
// Truthfulness rules implemented here (CONTRACT.md; independent review 2026-09-28):
//  - every confirmed step is a server mutation with an idempotency key and the
//    LATEST revision this client holds (a ref, never a stale closure); the
//    server settles duplicates and stale tabs and always returns the view to
//    render next;
//  - help is recorded durably BEFORE it is shown or played: read-aloud, a
//    gloss, the counters, the word-choice list, a tutor question, the worked
//    example of a mini-lesson. "Recorded" means the server answered applied or
//    replayed — a stale or refused answer never counts, and the help is then
//    not shown;
//  - the tutor reply is classified and persisted before it is displayed or
//    spoken (`lib/family-learning-tutor.ts`); an unrecorded reply is withheld;
//  - a spoken answer is shown as text and confirmed by the child before it is
//    scored (math and language alike);
//  - unfinished answers never leave the browser; a child switch unmounts this
//    workspace (keyed by child), aborts in-flight fetches and drops the cached
//    credential, so no late reply can appear for the sibling;
//  - audio is optional and interruptible, with repeat, slow and stop; tutor
//    speech and instruction audio never play at the same time.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/components/ui/nabu";
import { useChildShell } from "@/components/family/child-shell-provider";
import { ExpeditionWorld } from "@/components/family/learning/expedition-world";
import { isComposing, useDeliberateFocus, useRestoreFocus } from "@/components/family/learning/focus";
import { HandsKeyboard, reachOriginOf } from "@/components/family/learning/hands-keyboard";
import { LessonEnd } from "@/components/family/learning/lesson-end";
import { ReminderCueView } from "@/components/family/learning/reminder-cue";
import { StoryBeat } from "@/components/family/learning/story-beat";
import { VisitReportView } from "@/components/family/learning/visit-report";
import { createChildTurnClient } from "@/lib/family-assistant-client";
import { envelopeSpokenText, type ChildId } from "@/lib/family-assistant-turn";
import { browserTimeZone, createLearningClient, type LearningMutateOutcome, type MutationContext } from "@/lib/family-learning-client";
import type { RetryItem } from "@/lib/family-learning-feedback";
import type { RetryOutcome, RetryPayload } from "@/components/family/learning/lesson-end";
import { stageLabel, type ChildView, type LearningOp, type SupportKind } from "@/lib/family-learning-state";
import { createReadAloudController } from "@/lib/family-learning-audio";
import { createTelemetryBuffer, enterStage, noteControl, noteInput, noteOp, noteSubmit, pause as pauseTelemetry, setHidden, takeBatch } from "@/lib/family-learning-telemetry";
import { LogRevise, LogTransfer, PierBuild, ReflectFeedback, StationBuild, StationChoice, Summary, TypingCourse, type DraftContext } from "./redesign-stages";
import { clearChildDrafts, retireAllDrafts, retireMismatched, type DraftIdentity } from "@/lib/family-learning-draft-store";
import { ExpeditionNotPrepared } from "@/components/family/learning/not-prepared";
import { recordSupportConfirmed, runTutorTurn, type SupportOutcome } from "@/lib/family-learning-tutor";
import { applySaveOutcome, commitLine, createTypingDraft, lessonPayload, markSaving, typeInto, type TypingDraft } from "@/lib/family-learning-typing";
import { nextExpectedChar } from "@/lib/family-learning-typing-metrics";
import { createChildSpeechPlayer, type ChildSpeechPlayer } from "@/lib/family-speech";
import { checkChildUtterance, startPushToTalk, type RecorderControl, type RecorderHandlers } from "@/lib/family-voice";
import { worldMarkers } from "../client";
import { chipButton, focusRing, primaryButton, secondaryButton } from "./styles";

/** The exact identity a completed draft is bound to: child, content version, visit instance, erasure generation, stage, sign-in. */
function draftIdentityOf(view: ChildView): DraftIdentity {
  return { child: view.child, contentVersion: view.contentVersion, visitId: view.visit?.id ?? "none", visitStartedAt: view.visit?.startedAt ?? "none", erasureGeneration: view.erasureGeneration, stage: view.visit?.stage ?? "none", session: view.sessionFingerprint ?? null };
}

/** R5-1: the request context the server fences on — from the exact identity a form was rendered for, or from a view. */
function contextOf(identity: DraftIdentity): MutationContext {
  return { erasureGeneration: identity.erasureGeneration, visit: identity.visitId === "none" ? null : { id: identity.visitId, startedAt: identity.visitStartedAt } };
}
function contextOfView(view: ChildView): MutationContext {
  return { erasureGeneration: view.erasureGeneration, visit: view.visit ? { id: view.visit.id, startedAt: view.visit.startedAt } : null };
}
/** A completed form is keyed by the identity it was rendered for: a new generation or visit instance remounts it empty (never rebinds old content). */
function identityKey(view: ChildView): string {
  return `${view.erasureGeneration}:${view.visit?.id ?? "none"}:${view.visit?.startedAt ?? "none"}:${view.visit?.stage ?? "none"}`;
}

const TRANSCRIBE_PATH = "/api/family/transcribe";
const TUTOR_SESSION_SUFFIX = "learn";
const SLOW_RATE = 0.75;

type Load = { kind: "loading" } | { kind: "ready"; view: ChildView } | { kind: "unprepared" } | { kind: "trouble"; message: string };

/** Text shown when audio could not be fetched or played; the text stays readable and the controls usable. */
const AUDIO_UNAVAILABLE = "Vorlesen geht gerade nicht. Du kannst den Text lesen oder es gleich nochmal versuchen.";

/** Records one support op; true only when the server confirmed it (applied/replayed). */
type SupportFn = (kind: SupportKind, taskId: string | null, payload?: unknown) => Promise<boolean>;
type Gate = () => boolean;

export function FamilyMissionClient() {
  const { child, restored } = useChildShell();
  if (!restored || !child) return null;
  return <Workspace key={child} child={child} />;
}

function adaptMediaRecorder(recorder: MediaRecorder, handlers: RecorderHandlers): RecorderControl {
  recorder.ondataavailable = (event) => handlers.onData(event.data);
  recorder.onstop = () => handlers.onStop();
  recorder.onerror = () => handlers.onError();
  return {
    start: () => recorder.start(),
    stop: () => recorder.stop(),
    mimeType: () => recorder.mimeType || null,
    detach: () => {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
    },
  };
}

function parseAnswerNumber(raw: string): number | null {
  const cleaned = raw.trim().replace(",", ".");
  if (!/^\d{1,3}$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** German number words a child might say; anything else stays uncertain. */
const NUMBER_WORDS: Record<string, number> = {
  null: 0, eins: 1, ein: 1, eine: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12,
};
function numberFromTranscript(text: string): number | null {
  const m = text.match(/\d{1,3}/);
  if (m) return Number(m[0]);
  const word = text.toLowerCase().match(/[a-zäöü]+/g)?.find((w) => w in NUMBER_WORDS);
  return word ? NUMBER_WORDS[word] : null;
}

const HOME_FALLBACK = { left: ["a", "s", "d", "f"], right: ["j", "k", "l", "ö"], anchors: ["f", "j"], thumb: " " };

function Workspace({ child }: { child: ChildId }) {
  const learning = useMemo(() => createLearningClient(), []);
  const tutorClient = useMemo(() => createChildTurnClient(), []);
  const speech = useMemo(() => createChildSpeechPlayer(), []);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [tutorOpen, setTutorOpen] = useState(false);
  /** The visit whose report is shown (just finished, or reopened through `?report=`). */
  const [reportVisit, setReportVisit] = useState<string | null>(() => searchParams.get("report"));
  const aliveRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  /** The latest rendered view — the only source of `expectedRevision`. */
  const viewRef = useRef<ChildView | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Minimal task telemetry (redesign F6/R3): a ref, never state — it must not
  // re-render the workspace. Batches go out on stage change, every 20 s and
  // on unmount; the idle rule and the event kinds live in the pure module.
  const telemetryRef = useRef(createTelemetryBuffer());
  const flushTelemetry = useCallback(
    (keepalive = false, identity?: { visitId: string; visitStartedAt: string; erasureGeneration: number } | null, batchId?: string) => {
      const taken = takeBatch(telemetryRef.current, Date.now(), batchId ?? (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `b-${Date.now()}`));
      telemetryRef.current = taken.buffer;
      if (!taken.batch) return;
      const current = viewRef.current;
      const target = identity ?? (current?.visit ? { visitId: current.visit.id, visitStartedAt: current.visit.startedAt, erasureGeneration: current.erasureGeneration } : null);
      if (!target) return;
      void learning.sendTelemetry(child, { batchId: taken.batch.batchId, ...target, events: taken.batch.events }, { keepalive });
    },
    [child, learning],
  );
  const visitIdentity = () => {
    const current = viewRef.current;
    return current?.visit ? { visitId: current.visit.id, visitStartedAt: current.visit.startedAt, erasureGeneration: current.erasureGeneration } : null;
  };

  // Recoverable completed drafts (R4-2) live in the tab's sessionStorage, bound to the exact identity of the view.
  const draftStorage = typeof window !== "undefined" ? window.sessionStorage : null;
  const adopt = useCallback((view: ChildView) => {
    viewRef.current = view;
    setLoad({ kind: "ready", view });
    retireMismatched(draftStorage, draftIdentityOf(view));
  }, [draftStorage]);

  const refresh = useCallback(async () => {
    const abort = new AbortController();
    abortRef.current = abort;
    const outcome = await learning.read(child, { signal: abort.signal, timeZone: browserTimeZone() });
    if (!aliveRef.current) return;
    if (outcome.ok) {
      adopt(outcome.view);
      return;
    }
    if (outcome.status === 404 || outcome.failure === "unprepared") {
      viewRef.current = null;
      setLoad({ kind: "unprepared" });
      return;
    }
    if (outcome.failure === "unauthorized" || outcome.failure === "no-session") retireAllDrafts(window.sessionStorage);
    setLoad({
      kind: "trouble",
      message:
        outcome.failure === "unauthorized"
          ? "Bitte melde dich neu an."
          : outcome.failure === "unavailable"
            ? "Die Expedition ist gerade nicht erreichbar. Deine gespeicherte Basis bleibt sicher."
            : "Die Expedition lädt gerade nicht. Versuch es gleich nochmal.",
    });
  }, [child, learning, adopt]);

  useEffect(() => {
    aliveRef.current = true;
    void refresh();
    return () => {
      aliveRef.current = false;
      abortRef.current?.abort();
      learning.reset();
      tutorClient.reset();
      speech.cancel();
      clearChildDrafts(typeof window !== "undefined" ? window.sessionStorage : null, child);
    };
  }, [refresh, learning, tutorClient, speech, child]);

  const stageForTelemetry = load.kind === "ready" ? load.view.visit?.stage ?? null : null;
  useEffect(() => {
    telemetryRef.current = enterStage(telemetryRef.current, stageForTelemetry, Date.now());
    if (stageForTelemetry) flushTelemetry();
  }, [stageForTelemetry, flushTelemetry]);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onInput = () => {
      telemetryRef.current = noteInput(telemetryRef.current, Date.now());
    };
    const onVisibility = () => {
      telemetryRef.current = setHidden(telemetryRef.current, document.visibilityState === "hidden", Date.now());
      if (document.visibilityState === "hidden") flushTelemetry(true);
    };
    document.addEventListener("keydown", onInput);
    document.addEventListener("pointerdown", onInput);
    document.addEventListener("visibilitychange", onVisibility);
    const interval = window.setInterval(() => flushTelemetry(), 20_000);
    return () => {
      document.removeEventListener("keydown", onInput);
      document.removeEventListener("pointerdown", onInput);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(interval);
      flushTelemetry(true);
    };
  }, [flushTelemetry]);

  // Escape closes the tutor panel; focus returns to where it was (UX-3: deliberate restoration).
  useRestoreFocus(tutorOpen);
  useEffect(() => {
    if (!tutorOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTutorOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [tutorOpen]);
  const gate: Gate = useCallback(() => !tutorOpen, [tutorOpen]);

  /** One confirmed step, always at the latest revision. */
  const mutate = useCallback(
    async (op: LearningOp, options?: { idempotencyKey?: string; identity?: DraftIdentity | null }): Promise<LearningMutateOutcome | null> => {
      const current = viewRef.current;
      if (!current) return null;
      setBusy(true);
      setNotice(null);
      const abort = new AbortController();
      abortRef.current = abort;
      const context = options?.identity ? contextOf(options.identity) : contextOfView(current);
      const outcome = await learning.mutate(child, op, current.revision, { signal: abort.signal, idempotencyKey: options?.idempotencyKey, context, timeZone: browserTimeZone() });
      if (!aliveRef.current) return null;
      setBusy(false);
      if (!outcome.ok && "failure" in outcome && (outcome.failure === "unauthorized" || outcome.failure === "no-session")) retireAllDrafts(window.sessionStorage);
      telemetryRef.current = noteSubmit(telemetryRef.current, op.op === "support" ? "hint" : "submit", Date.now(), op.op, outcome.ok, Boolean(options?.idempotencyKey));
      if (!outcome.ok && !("status" in outcome && outcome.status === "refused")) telemetryRef.current = noteOp(telemetryRef.current, "save-failure", Date.now(), op.op);
      if (outcome.ok) {
        adopt(outcome.view);
        if (outcome.status === "stale") setNotice("Da war schon ein neuerer Stand — ich zeige dir den aktuellen.");
        return outcome;
      }
      if ("status" in outcome && outcome.status === "refused") {
        adopt(outcome.view);
        setNotice(outcome.code === "not-available" ? "Das ist gerade noch nicht verfügbar." : outcome.code === "copied-text" ? "Das ist der Satz von vorhin oder die gezeigte Korrektur. Schreib einen neuen Satz — oder wähle „Heute nicht“." : "Das ging so nicht. Schau nochmal.");
        return outcome;
      }
      setNotice(outcome.failure === "network" ? "Keine Verbindung. Dein Fortschritt ist bis hierher gespeichert." : "Etwas hat nicht geklappt. Versuch es nochmal.");
      return outcome;
    },
    [child, learning, adopt],
  );

  /** Support op → confirmed/not, retrying once on a stale revision. */
  const recordSupportRaw = useCallback(
    async (op: LearningOp & { op: "support" }): Promise<{ outcome: SupportOutcome; revision: number }> => {
      const result = await mutate(op);
      const revision = viewRef.current?.revision ?? 0;
      if (!result) return { outcome: "failed", revision };
      if (result.ok) return { outcome: result.status, revision };
      if ("status" in result && result.status === "refused") return { outcome: "refused", revision };
      return { outcome: "failed", revision };
    },
    [mutate],
  );
  const support: SupportFn = useCallback(
    async (kind, taskId, payload) =>
      recordSupportConfirmed(
        { recordSupport: recordSupportRaw, currentRevision: () => viewRef.current?.revision ?? 0 },
        { op: "support", taskId, kind, payload },
      ),
    [recordSupportRaw],
  );

  /** The URL carries the report so a reload shows it again; the child stays in the URL. */
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

  const applied = (outcome: LearningMutateOutcome | null) => !!outcome && outcome.ok && (outcome.status === "applied" || outcome.status === "replayed");

  if (load.kind === "loading") {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <p className="text-base text-tertiary" role="status">
          Expedition wird geladen …
        </p>
      </div>
    );
  }
  if (load.kind === "unprepared") return <ExpeditionNotPrepared child={child} />;
  if (load.kind === "trouble") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <Link href={`/family/learn?child=${child}`} className={secondaryButton}>
          ← Zur Karte
        </Link>
        <p className="mt-6 text-lg text-primary" role="status">
          {load.message}
        </p>
      </div>
    );
  }

  const view = load.view;
  const worldHref = `/family/learn?child=${child}`;
  const markers = worldMarkers(view);
  const fingers = view.typingCourse?.fingers ?? (view.typing && view.typing.available ? view.typing.lesson.fingers : {});
  const home = view.typingCourse?.homePosition ?? (view.typing && view.typing.available ? { left: view.typing.lesson.homeRow.slice(0, 4), right: view.typing.lesson.homeRow.slice(4, 8), anchors: ["f", "j"], thumb: " " } : HOME_FALLBACK);

  // The report of a just-finished (or reopened) visit comes before the map.
  const report = reportVisit ? view.reports.find((r) => r.visit === reportVisit) ?? null : null;
  if (report && (!view.visit || view.visit.id !== report.visit || report.partial)) {
    return (
      <div ref={rootRef} className="mx-auto flex min-h-[calc(100dvh-4.25rem)] w-full max-w-5xl flex-col px-3 py-4 sm:px-4 sm:py-6" data-testid="mission-report-screen">
        {/* The world appears once, inside the report's own "In deiner Welt" block (V3/V4: no cropped strip above focused content). */}
        <VisitReportView
          report={report}
          scene={view.scene}
          markers={markers}
          onBack={() => {
            setReportVisit(null);
            router.push(worldHref);
          }}
          backLabel="Zur Karte"
          onNext={report.partial ? () => { setReportVisit(null); setReportParam(null); } : undefined}
          nextLabel={report.partial ? "Weitermachen" : undefined}
        />
      </div>
    );
  }

  if (!view.visit) {
    return <StartOrWait child={child} view={view} busy={busy} onStart={() => void mutate({ op: "start-visit" })} notice={notice} markers={markers} />;
  }

  const stage = view.visit.stage;
  const optionalReason = view.visit.overBudget ? "time" : "child";
  const draftContext: DraftContext = { storage: draftStorage, identity: draftIdentityOf(view) };
  const lastLesson = view.lastLesson;

  const lessonEndActions = {
    onExplain: async (repairId: string) => applied(await mutate({ op: "repair-explain", repairId })),
    onRetry: async (repairId: string, item: RetryItem, payload: RetryPayload, idempotencyKey: string): Promise<RetryOutcome> => {
      // One retry item → one op of its kind; the same idempotency key is reused after a failed save (exactly-once on the server).
      const op: LearningOp =
        item.kind === "typing-line" || item.kind === "label"
          ? { op: "typing-retry", repairId, retryNo: item.no, lineIndex: item.kind === "typing-line" ? item.lineIndex : 0, typed: payload.typed ?? "", seconds: payload.seconds }
          : item.kind === "sentence"
            ? { op: "writing-retry", repairId, retryNo: item.no, text: payload.text ?? "" }
            : { op: "language-retry", repairId, retryNo: item.no, stepId: item.stepId, response: payload.response ?? "" };
      const outcome = await mutate(op, { idempotencyKey });
      if (!outcome) return { ok: false, remaining: null };
      if (outcome.ok && (outcome.status === "applied" || outcome.status === "replayed")) {
        const r = outcome.result as { result?: "correct" | "incorrect" | "unscored"; remaining?: number; closed?: boolean };
        const repair = outcome.view.lastLesson?.repair;
        const last = repair?.retries[repair.retries.length - 1];
        return { ok: true, result: r.result ?? last?.result, remaining: typeof r.remaining === "number" ? r.remaining : repair?.remaining ?? null, closed: r.closed ?? repair?.status === "closed" };
      }
      return { ok: false, remaining: null, refused: !outcome.ok && "status" in outcome && outcome.status === "refused" };
    },
    onCloseRepair: async (repairId: string, reason: "done" | "skip") => applied(await mutate({ op: "repair-close", repairId, reason })),
    onAcknowledge: async (id: string) => applied(await mutate({ op: "lesson-feedback-seen", id })),
  };

  const dots = Array.from({ length: view.visit.stageCount }, (_, i) => i);

  return (
    <div ref={rootRef} className="mx-auto flex min-h-[calc(100dvh-4.25rem)] w-full max-w-6xl flex-col px-3 py-3 sm:px-4 sm:py-4" data-testid="mission-screen" data-stage={stage ?? ""} data-lesson-end={lastLesson ? "true" : "false"}>
      {/* HUD: Save/Exit · where am I · tutor */}
      <header className="flex items-center justify-between gap-3">
        <Link
          href={worldHref}
          className={secondaryButton}
          aria-label="Stopp und speichern"
          data-testid="hud-stop"
          onClick={() => {
            telemetryRef.current = noteControl(pauseTelemetry(telemetryRef.current, Date.now()), Date.now(), "stop");
            flushTelemetry(true);
          }}
        >
          ■ Stopp
        </Link>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-sm font-semibold text-primary">{view.visit.title}</p>
          <ol className="mt-1 flex items-center justify-center gap-1" aria-label={`Schritt ${Math.min(view.visit.stageIndex + 1, view.visit.stageCount)} von ${view.visit.stageCount}${stage ? `: ${stageLabel(stage)}` : ""}`} data-testid="hud-steps">
            {dots.map((i) => (
              <li key={i} className={cn("h-2 rounded-full", i < view.visit!.stageIndex ? "w-2 bg-stone-900 dark:bg-stone-100" : i === view.visit!.stageIndex ? "w-6 bg-amber-500" : "w-2 bg-stone-300 dark:bg-stone-700")} aria-hidden />
            ))}
          </ol>
        </div>
        <button type="button" onClick={() => setTutorOpen((v) => !v)} className={secondaryButton} aria-expanded={tutorOpen} aria-controls="tutor-panel" data-testid="hud-tutor">
          💬 Tutor
        </button>
      </header>

      {view.base.name ? (
        <p className="mt-2 text-center text-sm text-tertiary" data-testid="hud-location">
          Basis „{view.base.name}“{view.base.location ? ` · ${view.base.location.label}` : ""}
        </p>
      ) : null}

      {notice ? (
        <p className="mt-3 rounded-2xl bg-secondary px-4 py-2 text-base text-primary" role="status" data-testid="notice">
          {notice}
        </p>
      ) : null}

      <div className={cn("mt-3 grid flex-1 gap-4", tutorOpen && "lg:grid-cols-[minmax(0,1fr)_360px]")}>
        <main className="min-w-0 rounded-3xl border border-primary bg-primary p-4 shadow-xs dark:shadow-none sm:p-6">
          <div className="mx-auto w-full max-w-3xl">
            {lastLesson ? (
              <LessonEnd key={lastLesson.id} feedback={lastLesson} actions={lessonEndActions} busy={busy} fingers={fingers} home={home} gate={gate} />
            ) : (
              <>
                {view.reminder && stage !== "typing-course" ? (
                  <div className="mb-4">
                    <ReminderCueView reminder={view.reminder} fingers={fingers} home={home} compact />
                  </div>
                ) : null}
                {stage === "name-base" ? <NameBase busy={busy} gate={gate} onSubmit={(name) => void mutate({ op: "name-base", name })} /> : null}
                {stage === "place-base" ? <PlaceBase view={view} busy={busy} gate={gate} onSubmit={(locationId) => void mutate({ op: "place-base", locationId })} /> : null}
                {stage === "restore" ? <Restore view={view} busy={busy} gate={gate} onContinue={() => void mutate({ op: "resume-base" })} /> : null}
                {stage === "station-choice" ? <StationChoice view={view} busy={busy} gate={gate} onChoose={(theme) => void mutate({ op: "choose-station", theme })} /> : null}
                {stage === "typing-course" && view.typingCourse ? (
                  <TypingCourse
                    key={`course:${view.typingCourse.unavailable ?? "ok"}`}
                    view={view}
                    busy={busy}
                    gate={gate}
                    reminder={view.reminder ? <ReminderCueView reminder={view.reminder} fingers={fingers} home={home} compact /> : null}
                    onCheck={(observed) => void mutate({ op: "typing-check", observed })}
                    onBurst={(op, idempotencyKey) => mutate(op, { idempotencyKey })}
                    onContinue={() => void mutate({ op: "typing-course-continue" })}
                  />
                ) : null}
                {stage === "station-build" ? <StationBuild view={view} busy={busy} gate={gate} onBuild={(spot) => void mutate({ op: "build-station", spot })} /> : null}
                {stage === "pier-build" ? <PierBuild view={view} busy={busy} gate={gate} onBuild={(spot) => void mutate({ op: "build-pier", spot })} /> : null}
                {stage === "log-revise" && view.logRevise ? <LogRevise view={view} busy={busy} gate={gate} onRevise={(text) => void mutate({ op: "revise-log", text })} onSkip={() => void mutate({ op: "skip-stage", stage: "log-revise", reason: optionalReason })} /> : null}
                {stage === "log-transfer" && view.transfer ? <LogTransfer key={identityKey(view)} view={view} busy={busy} gate={gate} drafts={draftContext} onSubmit={(payload, idempotencyKey, identity) => mutate(payload as LearningOp, { idempotencyKey, identity })} onSkip={() => void mutate({ op: "skip-stage", stage: "log-transfer", reason: optionalReason })} /> : null}
                {stage === "summary" && view.summary ? <Summary view={view} busy={busy} gate={gate} onNext={() => void mutate({ op: "summary-seen" })} /> : null}
                {view.math ? (
                  <MathItem
                    key={view.math.id}
                    child={child}
                    view={view}
                    busy={busy}
                    gate={gate}
                    speech={speech}
                    support={support}
                    onAnswer={(answer, raw, modality, uncertain) => void mutate({ op: "answer-math", itemId: view.math!.id, answer, raw, modality, uncertain })}
                    onAnswerRemainder={(used, remaining, raw, modality, uncertain) => void mutate({ op: "answer-remainder", itemId: view.math!.id, used, remaining, raw, modality, uncertain })}
                    onContinue={() => void mutate({ op: "continue-item", itemId: view.math!.id })}
                    onTeach={() => void mutate({ op: "request-teaching", itemId: view.math!.id })}
                    onStop={() => void mutate({ op: "stop-item", itemId: view.math!.id })}
                  />
                ) : null}
                {stage === "explain" ? (
                  <Explain
                    busy={busy}
                    gate={gate}
                    overBudget={view.visit.overBudget}
                    onSubmit={(text, modality) => void mutate({ op: "explain", text, modality })}
                    onSkip={() => void mutate({ op: "skip-stage", stage: "explain", reason: optionalReason })}
                  />
                ) : null}
                {view.language ? (
                  <LanguageSegment
                    key={`${view.language.id}-${view.language.stepIndex}`}
                    child={child}
                    view={view}
                    busy={busy}
                    gate={gate}
                    speech={speech}
                    support={support}
                    onStep={(stepId, response, modality, transcriptConfirmed) => void mutate({ op: "language-step", segmentId: view.language!.id, stepId, response, modality, transcriptConfirmed })}
                    onContinue={(stepId) => void mutate({ op: "language-continue", segmentId: view.language!.id, stepId })}
                    onSkip={() => void mutate({ op: "skip-stage", stage: view.language!.id, reason: optionalReason })}
                  />
                ) : null}
                {view.typing ? (
                  <TypingSegment
                    view={view}
                    busy={busy}
                    gate={gate}
                    onLesson={(op, idempotencyKey) => mutate(op, { idempotencyKey })}
                    onLabel={(taskId, typed, seconds) => void mutate({ op: "typing-label", taskId, typed, seconds })}
                    onSkip={() => void mutate({ op: "skip-stage", stage: "typing", reason: optionalReason })}
                  />
                ) : null}
                {stage === "log" ? <SaveLog view={view} busy={busy} gate={gate} onSubmit={(text, modality) => void mutate({ op: "save-log", text, modality })} /> : null}
                {stage === "reflect" && view.reflection ? (
                  <ReflectFeedback
                    key={identityKey(view)}
                    view={view}
                    busy={busy}
                    gate={gate}
                    drafts={draftContext}
                    onSubmit={async (payload, idempotencyKey, formIdentity) => {
                      // The visit identity is captured BEFORE the finishing write: after it the view has no running
                      // visit, and the remaining buffered UX events would otherwise have nothing to attach to.
                      const identity = visitIdentity();
                      const outcome = await mutate(payload as LearningOp, { idempotencyKey, identity: formIdentity });
                      if (outcome && outcome.ok && (outcome.status === "applied" || outcome.status === "replayed")) {
                        flushTelemetry(true, identity, `ui-${idempotencyKey}`);
                        // The completed visit leads directly to its report (UX-5); the URL keeps it across a reload.
                        if (identity) {
                          setReportVisit(identity.visitId);
                          setReportParam(identity.visitId);
                        }
                      }
                      return outcome;
                    }}
                  />
                ) : null}
              </>
            )}
          </div>
        </main>

        {tutorOpen ? (
          <TutorPanel
            child={child}
            view={view}
            speech={speech}
            tutorClient={tutorClient}
            recordSupport={recordSupportRaw}
            currentRevision={() => viewRef.current?.revision ?? 0}
            isAlive={() => aliveRef.current}
            onClose={() => setTutorOpen(false)}
          />
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audio controls: play / repeat / slow / stop for one text
// ---------------------------------------------------------------------------

function AudioControls({ child, speech, text, label, disabled, beforePlay }: { child: ChildId; speech: ChildSpeechPlayer; text: string; label: string; disabled: boolean; beforePlay: () => Promise<boolean> }) {
  const [playing, setPlaying] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const beforePlayRef = useRef(beforePlay);
  beforePlayRef.current = beforePlay;
  const controller = useMemo(
    () =>
      createReadAloudController({
        record: (t) => beforePlayRef.current().then((ok) => ok && t === text),
        speak: (t, rate) => speech.speak({ childId: child, text: t, rate }),
        cancelSpeech: () => speech.cancel(),
        unlock: () => speech.unlock(),
      }),
    [child, speech, text],
  );
  useEffect(() => () => controller.dispose(), [controller]);

  const play = async (rate?: number) => {
    setUnavailable(false);
    setPlaying(true);
    const result = await controller.play(text, rate);
    if (controller.isRecorded(text)) setRecorded(true);
    if (result === "superseded" || result === "disposed") return;
    setPlaying(false);
    if (result === "unavailable") setUnavailable(true);
  };
  const stop = () => {
    controller.stop();
    setPlaying(false);
    setUnavailable(false);
  };
  return (
    <span className="inline-flex flex-wrap gap-2">
      <button type="button" disabled={disabled || playing} onClick={() => void play()} className={secondaryButton}>
        🔊 {label}
      </button>
      {recorded ? (
        <>
          <button type="button" disabled={disabled || playing} onClick={() => void play()} className={secondaryButton} aria-label={`${label} nochmal`}>
            ↺ Nochmal
          </button>
          <button type="button" disabled={disabled || playing} onClick={() => void play(SLOW_RATE)} className={secondaryButton} aria-label={`${label} langsam`}>
            🐢 Langsam
          </button>
        </>
      ) : null}
      {playing ? (
        <button type="button" onClick={stop} className={secondaryButton}>
          ■ Stopp
        </button>
      ) : null}
      {unavailable ? (
        <span role="status" className="basis-full rounded-xl bg-secondary px-3 py-2 text-sm text-primary">
          {AUDIO_UNAVAILABLE}
        </span>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Start / wait — the story beat and one action
// ---------------------------------------------------------------------------

function StartOrWait({ child, view, busy, onStart, notice, markers }: { child: ChildId; view: ChildView; busy: boolean; onStart: () => void; notice: string | null; markers: ReturnType<typeof worldMarkers> }) {
  const startRef = useRef<HTMLButtonElement | null>(null);
  useDeliberateFocus(startRef, `start:${view.next.visit ?? "none"}`);
  const nextDef = view.next.visit;
  // The chapter's story (who / make / done) comes from the reviewed content once the visit runs; before that the hook is the one line.
  const lines = [view.hook];
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-4.25rem)] w-full max-w-4xl flex-col px-3 py-4 sm:px-4 sm:py-6" data-testid="start-screen">
      <div className="flex items-center justify-between">
        <Link href={`/family/learn?child=${child}`} className={secondaryButton}>
          ← Zur Karte
        </Link>
      </div>
      <div className="mt-3 h-40 shrink-0 overflow-hidden rounded-3xl border border-primary sm:h-56">
        <ExpeditionWorld scene={view.scene} markers={markers} pages={view.pages.length} variant="strip" />
      </div>
      <div className="mt-4 flex flex-col gap-4">
        <StoryBeat speaker="radio" beats={[{ text: lines[0], scene: view.base.name ? "base" : "team" }]} compact />
        <div className="rounded-3xl border border-primary bg-primary p-5">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-tertiary">{nextDef ? "Jetzt" : "Gespeichert"}</p>
          <h1 className="mt-1 text-2xl font-semibold leading-tight text-primary sm:text-3xl">{view.nextStep}</h1>
          {notice ? <p className="mt-2 text-base text-primary">{notice}</p> : null}
          {nextDef ? (
            <button ref={startRef} type="button" onClick={onStart} disabled={busy} className={cn(primaryButton, "mt-4 min-h-16 px-8 text-xl")} data-testid="start-visit" data-visit={nextDef} data-ordinal={view.next.ordinal ?? ""}>
              {nextDef === "v1" ? "Los geht's" : nextDef === "v4" || nextDef === "v5" ? `Besuch ${view.next.ordinal ?? (nextDef === "v5" ? 4 : 3)} starten` : nextDef === "v3" ? "Angefangene Aufgabe zu Ende bringen" : "Weiter geht's"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Base setup
// ---------------------------------------------------------------------------

function Instruction({ children, kicker }: { children: React.ReactNode; kicker?: string }) {
  return (
    <div>
      {kicker ? <p className="text-sm font-semibold uppercase tracking-[0.14em] text-tertiary">{kicker}</p> : null}
      <h2 className="mt-1 text-2xl font-semibold leading-tight text-primary sm:text-3xl">{children}</h2>
    </div>
  );
}

/** The reviewed word problem, split by hierarchy: its setup sentences, then the actual question as the heading (words unchanged). */
function MathPrompt({ prompt }: { prompt: string }) {
  const sentences = prompt.split(/(?<=[.!?])\s+/).filter(Boolean);
  const question = sentences.length > 1 && /\?$/.test(sentences[sentences.length - 1]) ? sentences[sentences.length - 1] : null;
  const setup = question ? sentences.slice(0, -1).join(" ") : null;
  return (
    <div data-testid="math-prompt">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-tertiary">Mathe</p>
      {setup ? (
        <p className="mt-1 text-lg leading-snug text-primary" data-testid="math-setup">
          {setup}
        </p>
      ) : null}
      <h2 className="mt-2 text-2xl font-semibold leading-tight text-primary sm:text-3xl" data-testid="math-question">
        {question ?? prompt}
      </h2>
    </div>
  );
}

function NameBase({ busy, gate, onSubmit }: { busy: boolean; gate: Gate; onSubmit: (name: string) => void }) {
  const [name, setName] = useState("");
  const ref = useRef<HTMLInputElement | null>(null);
  useDeliberateFocus(ref, "name-base", { gate });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSubmit(name.trim());
      }}
      className="flex flex-col gap-4"
    >
      <StoryBeat speaker="radio" beats={[{ text: "Hier baust du deine Basis. Du entscheidest, wo sie steht.", scene: "base" }]} compact />
      <Instruction kicker="Zuerst">Wie soll deine Basis heissen?</Instruction>
      <label className="sr-only" htmlFor="base-name">
        Name der Basis
      </label>
      <input ref={ref} id="base-name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => (e.key === "Enter" && isComposing(e) ? e.preventDefault() : undefined)} maxLength={40} autoComplete="off" className={cn("min-h-16 rounded-2xl border-2 border-primary bg-primary px-4 text-2xl text-primary", focusRing)} data-testid="base-name" />
      <button type="submit" disabled={busy || !name.trim()} className={primaryButton}>
        Weiter
      </button>
    </form>
  );
}

function PlaceBase({ view, busy, gate, onSubmit }: { view: ChildView; busy: boolean; gate: Gate; onSubmit: (locationId: string) => void }) {
  const firstRef = useRef<HTMLButtonElement | null>(null);
  useDeliberateFocus(firstRef, "place-base", { gate });
  return (
    <div className="flex flex-col gap-4">
      <Instruction kicker="Standort">Wo steht „{view.base.name}“?</Instruction>
      <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Standort wählen">
        {view.locations.map((location, i) => (
          <button key={location.id} ref={i === 0 ? firstRef : undefined} type="button" disabled={busy} onClick={() => onSubmit(location.id)} className={cn(chipButton, "min-h-20 justify-start")} data-testid={`location-${location.id}`}>
            <span className="text-3xl" aria-hidden>
              {location.emoji}
            </span>
            {location.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Restore({ view, busy, gate, onContinue }: { view: ChildView; busy: boolean; gate: Gate; onContinue: () => void }) {
  const intro = view.visit?.intro ?? null;
  const ref = useRef<HTMLButtonElement | null>(null);
  useDeliberateFocus(ref, "restore", { gate });
  return (
    <div className="flex flex-col gap-4">
      <Instruction kicker="Willkommen zurück">Auf „{view.base.name}“ geht es weiter.</Instruction>
      {intro ? <StoryBeat speaker="radio" beats={view.visit?.id === "v5" ? [{ text: intro.who, scene: "boat" }, { text: intro.make, scene: "pier" }, { text: intro.done, scene: "boat" }] : [{ text: intro.who, scene: "team" }, { text: intro.make, scene: "station" }, { text: intro.done, scene: "lamp" }]} testId="mission-intro" /> : <StoryBeat speaker="team" beats={[{ text: "Deine Vorräte sind noch da. Heute geht die Expedition weiter.", scene: "base" }]} compact />}
      <button ref={ref} type="button" onClick={onContinue} disabled={busy} className={primaryButton} data-testid="stage-continue">
        Weiter
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Math item: typed answer (unaided) or counters (supported), teaching phases
// ---------------------------------------------------------------------------

function MathItem({ child, view, busy, gate, speech, support, onAnswer, onAnswerRemainder, onContinue, onTeach, onStop }: {
  child: ChildId;
  view: ChildView;
  busy: boolean;
  gate: Gate;
  speech: ChildSpeechPlayer;
  support: SupportFn;
  onAnswer: (answer: number | null, raw: string, modality: "typed" | "counters" | "spoken", uncertain?: boolean) => void;
  onAnswerRemainder: (used: number | null, remaining: number | null, raw: string, modality: "typed" | "counters" | "spoken", uncertain?: boolean) => void;
  onContinue: () => void;
  onTeach: () => void;
  onStop: () => void;
}) {
  const item = view.math!;
  const remainderItem = item.kind === "remainder";
  const capacity = remainderItem ? item.perGroup ?? 0 : null;
  const [rawUsed, setRawUsed] = useState("");
  const [rawRemaining, setRawRemaining] = useState("");
  const [raw, setRaw] = useState("");
  const [countersOpen, setCountersOpen] = useState(false);
  const [trays, setTrays] = useState<number[]>(() => Array.from({ length: item.groups }, () => 0));
  const [spoken, setSpoken] = useState<{ transcript: string; number: number | null; second?: number | null } | null>(null);
  const placed = trays.reduce((a, b) => a + b, 0);
  const remaining = item.quantity - placed;
  const canAnswer = item.phase === "answer" || item.phase === "clarify" || item.phase === "represent";
  const answerRef = useRef<HTMLInputElement | null>(null);
  const continueRef = useRef<HTMLButtonElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  // Focus the answer field on the item and again after each attempt (clarification, representation) — deliberate transitions only;
  // the item's own second number field may hand focus back to the first one.
  useDeliberateFocus(answerRef, canAnswer && !countersOpen ? `${item.id}:${item.phase}:${item.attemptNo}` : null, { gate, within: formRef, enabled: canAnswer && !countersOpen });
  useDeliberateFocus(continueRef, item.phase === "example" ? `${item.id}:example` : null, { gate, enabled: item.phase === "example" });

  useEffect(() => {
    if (item.phase === "represent") setCountersOpen(true);
  }, [item.phase]);

  const openCounters = async () => {
    if (await support("counters", item.id)) setCountersOpen(true);
  };

  const moveToTray = (index: number, delta: number) => {
    setTrays((current) => {
      const next = [...current];
      const value = next[index] + delta;
      if (value < 0) return current;
      if (capacity !== null && value > capacity) return current;
      const total = next.reduce((a, b) => a + b, 0) - next[index] + value;
      if (total > item.quantity) return current;
      next[index] = value;
      return next;
    });
  };

  const onDrop = (index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    moveToTray(index, 1);
  };

  if (item.outcome !== "pending") {
    return (
      <div className="flex flex-col gap-3">
        <Instruction>{item.scene ?? "Erledigt."}</Instruction>
        {item.taughtAnswers ? (
          <p className="text-base text-primary">
            Wir haben es zusammen gemacht: {item.groups} {item.group.plural} × {item.perGroup} = {item.taughtAnswers.used} {item.unit.plural} {item.usedWord.past}, {item.quantity} − {item.taughtAnswers.used} = {item.taughtAnswers.remaining} bleiben übrig.
          </p>
        ) : item.taughtAnswer !== null ? (
          <p className="text-base text-primary">
            Wir haben es zusammen gemacht: {item.quantity} {item.unit.plural} ÷ {item.groups} = {item.taughtAnswer} pro {item.group.singular}.
          </p>
        ) : null}
      </div>
    );
  }

  const numberInput = (props: { value: string; onChange: (v: string) => void; label: string; testId: string; ref?: React.RefObject<HTMLInputElement | null> }) => (
    <label className="flex flex-col gap-1 text-base font-medium text-primary">
      {props.label}
      <input ref={props.ref} inputMode="numeric" pattern="[0-9]*" value={props.value} onChange={(e) => props.onChange(e.target.value)} onKeyDown={(e) => (e.key === "Enter" && isComposing(e) ? e.preventDefault() : undefined)} className={cn("min-h-16 w-32 rounded-2xl border-2 border-primary bg-primary px-4 text-3xl text-primary", focusRing)} aria-label={props.label} data-testid={props.testId} autoComplete="off" />
    </label>
  );

  return (
    <div className="flex flex-col gap-4">
      {item.scene ? <StoryBeat speaker="team" beats={[{ text: item.scene, scene: item.id === "EQ-PIER" ? "boat" : remainderItem ? "garden" : "team" }]} compact /> : null}
      <MathPrompt prompt={item.prompt} />
      <div className="flex flex-wrap gap-2">
        <AudioControls child={child} speech={speech} text={item.prompt} label="Vorlesen" disabled={busy} beforePlay={() => support("read_aloud", item.id, { text: "prompt" })} />
        {!countersOpen && canAnswer ? (
          <button type="button" onClick={() => void openCounters()} className={secondaryButton} disabled={busy} data-testid="open-counters">
            {item.groupKind === "people" ? `${item.unit.emoji} ${item.unit.plural} an die ${item.group.plural} verteilen` : `${item.unit.emoji} ${item.unit.plural} in die ${item.group.plural} legen`}
          </button>
        ) : null}
      </div>

      {item.phase === "clarify" && item.clarification ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-base text-amber-900 dark:bg-amber-950/40 dark:text-amber-100" role="status" data-testid="clarification">
          {item.clarification}
          {item.lastPartial ? (item.lastPartial.usedCorrect && !item.lastPartial.remainingCorrect ? ` Die ${item.usedWord.past}en ${item.unit.plural} stimmen — schau den Rest noch einmal an.` : !item.lastPartial.usedCorrect && item.lastPartial.remainingCorrect ? ` Der Rest stimmt — zähle die vollen ${item.group.plural} noch einmal.` : "") : ""}
        </p>
      ) : null}

      {item.phase === "example" && item.example ? (
        <div className="rounded-2xl bg-secondary p-4">
          <p className="text-base font-semibold text-primary">{item.example.prompt}</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-base text-primary">
            {item.example.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <button ref={continueRef} type="button" onClick={onContinue} disabled={busy} className={cn(primaryButton, "mt-4")}>
            Jetzt nochmal probieren
          </button>
        </div>
      ) : null}

      {item.teachingOffered ? (
        <div className="rounded-2xl bg-secondary p-4">
          <p className="text-base text-primary">{item.phase === "teach-or-stop" ? "Das war knifflig. Sollen wir es zusammen lösen, oder machst du hier Pause?" : "Du kannst es noch einmal probieren — oder wir lösen es zusammen."}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={onTeach} disabled={busy} className={item.phase === "teach-or-stop" ? primaryButton : secondaryButton}>
              Zusammen lösen
            </button>
            <button type="button" onClick={onStop} disabled={busy} className={secondaryButton}>
              Pause hier
            </button>
          </div>
        </div>
      ) : null}

      {countersOpen && canAnswer ? (
        <div className="rounded-2xl border border-primary p-4">
          <p className="text-base text-primary" data-testid="grouping-instruction">
            {item.groupKind === "people"
              ? `${item.representation ? `${item.representation} ` : `Verteile die ${item.unit.plural} an die ${item.group.plural}: alle bekommen gleich viele. `}Jedes Fach unten steht für eine ${item.group.singular.includes("/") ? item.group.singular.replace("/", " oder einen ") : item.group.singular}.`
              : item.representation ?? `Lege die ${item.unit.plural} in die ${item.group.plural}. Jedes ${item.group.singular} bekommt gleich viele.`}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-base font-medium text-primary">Übrig: {remaining}</span>
            <span draggable={remaining > 0} onDragStart={(e) => e.dataTransfer.setData("text/plain", "1")} className={cn("inline-flex min-h-12 min-w-12 cursor-grab items-center justify-center rounded-xl bg-primary text-3xl shadow-xs", remaining === 0 && "opacity-40")} aria-label={`${item.unit.singular} ziehen`}>
              {item.unit.emoji}
            </span>
            <span className="text-sm text-tertiary">Ziehe, oder tippe auf + / −.</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {trays.map((count, index) => (
              <div key={index} onDragOver={(e) => e.preventDefault()} onDrop={onDrop(index)} className="flex min-h-28 flex-col items-center justify-between rounded-2xl bg-secondary p-2">
                <span className="text-2xl" aria-hidden>
                  {item.group.emoji}
                </span>
                <span className="text-xl font-semibold text-primary" aria-live="polite">
                  {count}
                </span>
                <div className="flex gap-1">
                  <button type="button" onClick={() => moveToTray(index, -1)} className={cn("min-h-12 min-w-12 rounded-xl bg-primary text-xl", focusRing)} aria-label={`${item.group.singular} ${index + 1}: eins weniger`}>
                    −
                  </button>
                  <button type="button" onClick={() => moveToTray(index, 1)} className={cn("min-h-12 min-w-12 rounded-xl bg-primary text-xl", focusRing)} aria-label={`${item.group.singular} ${index + 1}: eins mehr`}>
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>
          {remainderItem ? (
            <>
              <p className="mt-2 text-sm text-tertiary" data-testid="leftovers">
                Übrig neben den {item.group.plural}: {remaining} {remaining === 1 ? item.unit.singular : item.unit.plural}
              </p>
              <button type="button" disabled={busy || trays.some((t) => t !== capacity)} onClick={() => onAnswerRemainder(placed, remaining, `${placed} ${item.usedWord.past}, ${remaining} übrig`, "counters")} className={cn(primaryButton, "mt-4")} data-testid="counters-submit">
                {item.groups} {item.group.plural} voll (je {capacity}), {remaining} übrig — fertig
              </button>
              {trays.some((t) => t !== capacity) ? <p className="mt-2 text-sm text-tertiary">Jedes {item.group.singular} soll genau {capacity} bekommen. Was nicht mehr passt, bleibt daneben.</p> : null}
            </>
          ) : (
            <>
              <button type="button" disabled={busy || remaining !== 0 || trays.some((t) => t !== trays[0])} onClick={() => onAnswer(trays[0], String(trays[0]), "counters")} className={cn(primaryButton, "mt-4")} data-testid="counters-submit">
                {item.groupKind === "people" ? `Jede ${item.group.singular.split("/")[0]}, jeder ${item.group.singular.split("/").pop()} bekommt ${trays[0]} — fertig` : `${trays[0]} pro ${item.group.singular} — fertig`}
              </button>
              {remaining === 0 && trays.some((t) => t !== trays[0]) ? <p className="mt-2 text-sm text-tertiary">Noch nicht überall gleich viele.</p> : null}
            </>
          )}
        </div>
      ) : null}

      {canAnswer && remainderItem ? (
        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault();
            const used = parseAnswerNumber(rawUsed);
            const rem = parseAnswerNumber(rawRemaining);
            if (used === null || rem === null) return;
            onAnswerRemainder(used, rem, `${rawUsed.trim()} ${item.usedWord.past}, ${rawRemaining.trim()} übrig`, "typed");
            setRawUsed("");
            setRawRemaining("");
          }}
          className="flex flex-wrap items-end gap-3"
        >
          {numberInput({ value: rawUsed, onChange: setRawUsed, label: item.usedWord.label, testId: "math-answer-used", ref: answerRef })}
          {numberInput({ value: rawRemaining, onChange: setRawRemaining, label: "Übrig", testId: "math-answer-remaining" })}
          <button type="submit" disabled={busy || parseAnswerNumber(rawUsed) === null || parseAnswerNumber(rawRemaining) === null} className={primaryButton} data-testid="math-submit">
            Fertig
          </button>
          <SpokenAnswer
            disabled={busy}
            onTranscript={(transcript) => {
              const numbers = transcript.match(/\d{1,3}/g) ?? [];
              setSpoken({ transcript, number: numbers.length >= 2 ? Number(numbers[0]) : null, second: numbers.length >= 2 ? Number(numbers[1]) : null });
            }}
          />
        </form>
      ) : null}
      {canAnswer && !remainderItem ? (
        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault();
            const n = parseAnswerNumber(raw);
            if (n === null) return;
            onAnswer(n, raw.trim(), "typed");
            setRaw("");
          }}
          className="flex flex-wrap items-end gap-3"
        >
          {numberInput({ value: raw, onChange: setRaw, label: "Antwort", testId: "math-answer", ref: answerRef })}
          <button type="submit" disabled={busy || parseAnswerNumber(raw) === null} className={primaryButton} data-testid="math-submit">
            Fertig
          </button>
          <SpokenAnswer disabled={busy} onTranscript={(transcript) => setSpoken({ transcript, number: numberFromTranscript(transcript) })} />
        </form>
      ) : null}

      {spoken && canAnswer ? (
        <div className="rounded-2xl bg-secondary p-4">
          <p className="text-base text-primary">Ich habe verstanden: „{spoken.transcript}“</p>
          {spoken.number !== null ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (remainderItem) onAnswerRemainder(spoken.number, spoken.second ?? null, spoken.transcript, "spoken");
                  else onAnswer(spoken.number, spoken.transcript, "spoken");
                  setSpoken(null);
                }}
                className={primaryButton}
              >
                Ja, {spoken.number}
                {remainderItem && spoken.second !== null && spoken.second !== undefined ? ` und ${spoken.second}` : ""}
              </button>
              <button type="button" disabled={busy} onClick={() => setSpoken(null)} className={secondaryButton}>
                Nein, nochmal
              </button>
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              <p className="text-sm text-tertiary">Da war keine Zahl dabei — sag sie nochmal oder tippe sie ein.</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (remainderItem) onAnswerRemainder(null, null, spoken.transcript, "spoken", true);
                  else onAnswer(null, spoken.transcript, "spoken", true);
                  setSpoken(null);
                }}
                className={secondaryButton}
              >
                Unklar lassen
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Push-to-talk (records → transcribe → the child confirms the text)
// ---------------------------------------------------------------------------

function SpokenAnswer({ disabled, onTranscript, label = "🎙️ Sagen" }: { disabled: boolean; onTranscript: (transcript: string) => void; label?: string }) {
  const [mic, setMic] = useState<"idle" | "starting" | "live" | "transcribing" | "trouble">("idle");
  const sessionRef = useRef<ReturnType<typeof startPushToTalk> | null>(null);
  const seqRef = useRef(0);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      sessionRef.current?.cancel();
    };
  }, []);

  const start = () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices || typeof MediaRecorder === "undefined") {
      setMic("trouble");
      return;
    }
    const seq = (seqRef.current += 1);
    setMic("starting");
    sessionRef.current = startPushToTalk({
      getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: true }),
      isTypeSupported: (type) => MediaRecorder.isTypeSupported(type),
      createRecorder: (stream, mimeType, handlers) => adaptMediaRecorder(mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream), handlers),
      onLive: () => {
        if (seqRef.current === seq && aliveRef.current) setMic("live");
      },
      onSettle: async (outcome) => {
        if (seqRef.current !== seq || !aliveRef.current) return;
        sessionRef.current = null;
        if (outcome.kind !== "recorded") {
          setMic(outcome.kind === "cancelled" ? "idle" : "trouble");
          return;
        }
        setMic("transcribing");
        try {
          const form = new FormData();
          form.append("audio", outcome.blob, outcome.fileName);
          const response = await fetch(TRANSCRIBE_PATH, { method: "POST", body: form });
          if (!aliveRef.current || seqRef.current !== seq) return;
          if (!response.ok) {
            setMic("trouble");
            return;
          }
          const payload = (await response.json()) as { transcript?: string };
          const transcript = (payload.transcript ?? "").trim();
          setMic("idle");
          if (transcript) onTranscript(transcript);
          else setMic("trouble");
        } catch {
          if (aliveRef.current) setMic("trouble");
        }
      },
    });
  };

  const stop = () => sessionRef.current?.stop();

  if (mic === "live" || mic === "starting") {
    return (
      <button type="button" onClick={stop} className={cn(secondaryButton, "border-red-500 text-red-700 dark:text-red-300")} aria-live="polite">
        {mic === "live" ? "■ Stopp (ich höre zu)" : "… Mikrofon startet"}
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={start} disabled={disabled || mic === "transcribing"} className={secondaryButton}>
        {mic === "transcribing" ? "… ich schreibe mit" : label}
      </button>
      {mic === "trouble" ? <span className="text-sm text-tertiary">Mikrofon geht gerade nicht — tippen klappt.</span> : null}
    </div>
  );
}

/** Shows a transcript and asks the child to confirm it before it is used. */
function ConfirmTranscript({ transcript, busy, onConfirm, onReject }: { transcript: string; busy: boolean; onConfirm: () => void; onReject: () => void }) {
  return (
    <div className="rounded-2xl bg-secondary p-4">
      <p className="text-base text-primary">Ich habe verstanden: „{transcript}“ — stimmt das?</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={onConfirm} className={primaryButton}>
          Ja, so
        </button>
        <button type="button" disabled={busy} onClick={onReject} className={secondaryButton}>
          Nein, nochmal
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Explain (work sample)
// ---------------------------------------------------------------------------

function Explain({ busy, gate, overBudget, onSubmit, onSkip }: { busy: boolean; gate: Gate; overBudget: boolean; onSubmit: (text: string, modality: "typed" | "spoken") => void; onSkip: () => void }) {
  const [text, setText] = useState("");
  const [spokenText, setSpokenText] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useDeliberateFocus(ref, "explain", { gate });
  const modality: "typed" | "spoken" = spokenText !== null && text === spokenText ? "spoken" : "typed";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onSubmit(text.trim(), modality);
      }}
      className="flex flex-col gap-4"
    >
      <Instruction kicker="Erklären">Wie hast du das gerechnet?</Instruction>
      <p className="text-base text-tertiary">Ein Satz reicht — schreiben oder sprechen.</p>
      <textarea ref={ref} value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={600} className={cn("rounded-2xl border-2 border-primary bg-primary px-4 py-3 text-xl text-primary", focusRing)} data-testid="explain-input" />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy || !text.trim()} className={primaryButton}>
          Speichern
        </button>
        <SpokenAnswer
          disabled={busy}
          onTranscript={(t) => {
            setText(t);
            setSpokenText(t);
          }}
        />
        <button type="button" onClick={onSkip} disabled={busy} className={secondaryButton} data-testid="stage-skip">
          {overBudget ? "Heute überspringen (Zeit)" : "Überspringen"}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Language segment
// ---------------------------------------------------------------------------

function LanguageSegment({ child, view, busy, gate, speech, support, onStep, onContinue, onSkip }: {
  child: ChildId;
  view: ChildView;
  busy: boolean;
  gate: Gate;
  speech: ChildSpeechPlayer;
  support: SupportFn;
  onStep: (stepId: string, response: string, modality: "typed" | "spoken" | "word-choice" | "listen", transcriptConfirmed?: boolean) => void;
  onContinue: (stepId: string) => void;
  onSkip: () => void;
}) {
  const segment = view.language!;
  const step = segment.step;
  const feedback = segment.feedback;
  const [glossOpen, setGlossOpen] = useState<string | null>(null);
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [choicesOpen, setChoicesOpen] = useState(false);
  const [pendingTranscript, setPendingTranscript] = useState<string | null>(null);
  const languageLabel = segment.language === "en" ? "English" : "Español";
  const inputRef = useRef<HTMLInputElement | null>(null);
  const continueRef = useRef<HTMLButtonElement | null>(null);
  const firstOptionRef = useRef<HTMLButtonElement | null>(null);
  const canAnswer = !feedback || feedback.retryAllowed;
  const focusKey = step ? `${segment.id}:${step.id}:${feedback?.triesUsed ?? 0}` : null;
  useDeliberateFocus(inputRef, step?.kind === "produce" && canAnswer && pendingTranscript === null ? focusKey : null, { gate, enabled: step?.kind === "produce" && canAnswer && pendingTranscript === null });
  useDeliberateFocus(continueRef, step?.kind === "listen-read" ? focusKey : null, { gate, enabled: step?.kind === "listen-read" });
  useDeliberateFocus(firstOptionRef, step?.kind === "pick-supply" ? focusKey : null, { gate, enabled: step?.kind === "pick-supply" });

  const openGloss = async (word: string) => {
    if (glossOpen === word) {
      setGlossOpen(null);
      return;
    }
    if (await support("gloss", segment.id, { word, language: segment.language })) setGlossOpen(word);
  };

  const openChoices = async () => {
    if (choicesOpen) return;
    if (await support("word_choice", segment.id, { text: "opened" })) setChoicesOpen(true);
  };

  if (!step) return null;

  const sentence = "sentence" in step ? step.sentence : null;
  const words = sentence ? sentence.replace(/[.,!?¡¿]/g, "").split(" ") : [];
  const glossFor = (word: string) => segment.glosses.find((g) => g.word.toLowerCase() === word.toLowerCase());

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <Instruction kicker={`${languageLabel} · ${segment.title}`}>{step.instruction}</Instruction>
        <span className="shrink-0 text-sm text-tertiary">
          {segment.stepIndex + 1}/{segment.stepCount}
        </span>
      </div>

      {sentence ? (
        <div className="rounded-3xl border border-amber-300/70 bg-[linear-gradient(135deg,#fff7e6,#fde8c4)] p-4 dark:border-amber-700/50 dark:bg-[linear-gradient(135deg,#3b2a12,#4a3416)]" data-testid="language-sentence">
          <p className="flex flex-wrap gap-x-2 gap-y-1 text-2xl leading-relaxed text-stone-900 dark:text-amber-50 sm:text-3xl" lang={segment.language}>
            {words.map((word, index) => {
              const gloss = glossFor(word);
              const selected = selectedWord === word;
              return (
                <button
                  key={`${word}-${index}`}
                  type="button"
                  onClick={() => {
                    setSelectedWord(selected ? null : word);
                    if (gloss) void openGloss(gloss.word);
                  }}
                  className={cn("rounded-lg px-1", focusRing, gloss && "underline decoration-dotted underline-offset-4", selected && "bg-white/80 ring-2 ring-stone-400 dark:bg-stone-900/60")}
                  aria-pressed={selected}
                >
                  {word}
                </button>
              );
            })}
          </p>
          {glossOpen ? (
            <p className="mt-2 rounded-xl bg-white/80 px-3 py-2 text-base text-stone-900 dark:bg-stone-900/70 dark:text-amber-50" lang="de" data-testid="gloss">
              <strong>{glossOpen}</strong> = {glossFor(glossOpen)?.de}. {glossFor(glossOpen)?.example}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <AudioControls key={`sentence:${step.id}`} child={child} speech={speech} text={sentence} label="Satz anhören" disabled={busy} beforePlay={() => support("read_aloud", segment.id, { text: sentence, language: segment.language })} />
            {selectedWord ? (
              <AudioControls key={`word:${step.id}:${selectedWord}`} child={child} speech={speech} text={selectedWord} label={`„${selectedWord}“ anhören`} disabled={busy} beforePlay={() => support("read_aloud", segment.id, { text: selectedWord, word: selectedWord, language: segment.language })} />
            ) : null}
          </div>
          <p className="mt-2 text-sm text-stone-700 dark:text-amber-100/80">Tippe auf ein Wort, um es zu hören; unterstrichene Wörter zeigen die Bedeutung.</p>
        </div>
      ) : null}

      {feedback ? (
        <div role="status" className={cn("rounded-2xl px-4 py-3 text-base", feedback.kind === "incorrect" ? "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100" : "bg-secondary text-primary")} data-testid="language-feedback" data-kind={feedback.kind}>
          <p>{feedback.message}</p>
          <p className="mt-1 text-sm text-tertiary">
            {feedback.kind === "incorrect" ? "Das wurde als „nicht richtig“ gespeichert." : "Deine Antwort ist gespeichert, aber nicht bewertet."}
            {feedback.retryAllowed ? " Du kannst es noch einmal versuchen." : " Ein weiterer Versuch ist hier nicht mehr möglich."}
          </p>
          {feedback.continueOffered ? (
            <button type="button" disabled={busy} onClick={() => onContinue(step.id)} className={cn(secondaryButton, "mt-2")} data-testid="language-continue-unscored">
              Weiter ohne Bewertung
            </button>
          ) : null}
        </div>
      ) : null}

      {step.kind === "listen-read" ? (
        <button ref={continueRef} type="button" disabled={busy} onClick={() => onStep(step.id, "", "listen")} className={primaryButton} data-testid="language-continue-step">
          Verstanden — weiter
        </button>
      ) : null}

      {step.kind === "pick-supply" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="group" aria-label="Lieferung wählen">
          {step.options.map((option, i) => (
            <button key={option.id} ref={i === 0 ? firstOptionRef : undefined} type="button" disabled={busy} onClick={() => onStep(step.id, option.id, "word-choice")} className={cn(chipButton, "min-h-24 flex-col")} data-testid={`pick-${option.id}`}>
              <span className="text-3xl" aria-hidden>
                {option.emoji}
              </span>
              <span className="text-sm text-tertiary">{option.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      {step.kind === "produce" && canAnswer ? (
        <div className="flex flex-col gap-3">
          <p className="text-2xl text-primary" lang={segment.language}>
            {step.frame}
          </p>
          {pendingTranscript !== null ? (
            <ConfirmTranscript
              transcript={pendingTranscript}
              busy={busy}
              onConfirm={() => {
                onStep(step.id, pendingTranscript, "spoken", true);
                setPendingTranscript(null);
              }}
              onReject={() => setPendingTranscript(null)}
            />
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (busy || !typed.trim()) return;
                onStep(step.id, typed.trim(), choicesOpen ? "word-choice" : "typed");
                setTyped("");
              }}
              className="flex flex-wrap items-end gap-2"
            >
              <input ref={inputRef} value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => (e.key === "Enter" && isComposing(e) ? e.preventDefault() : undefined)} maxLength={200} lang={segment.language} className={cn("min-h-16 min-w-0 flex-1 rounded-2xl border-2 border-primary bg-primary px-4 text-2xl text-primary", focusRing)} aria-label="Antwort" autoComplete="off" autoCapitalize="off" data-testid="language-input" />
              <button type="submit" disabled={busy || !typed.trim()} className={primaryButton} data-testid="language-send">
                Senden
              </button>
              <SpokenAnswer disabled={busy} onTranscript={(t) => setPendingTranscript(t)} />
            </form>
          )}
          {choicesOpen ? (
            <div className="flex flex-wrap gap-2">
              {step.choices.map((word) => (
                <button key={word} type="button" disabled={busy} onClick={() => setTyped((t) => (t ? `${t} ${word}` : word))} className={chipButton}>
                  {word}
                </button>
              ))}
              <span className="self-center text-sm text-tertiary">Wörter aus der Liste zählen als Hilfe.</span>
            </div>
          ) : (
            <button type="button" disabled={busy} onClick={() => void openChoices()} className={cn(secondaryButton, "self-start")}>
              Wörter zum Auswählen zeigen (zählt als Hilfe)
            </button>
          )}
        </div>
      ) : null}

      <button type="button" onClick={onSkip} disabled={busy} className={cn("inline-flex min-h-12 items-center self-start rounded-full px-4 text-base text-tertiary hover:text-primary", focusRing)} data-testid="stage-skip">
        {view.visit?.overBudget ? "Heute überspringen (Zeit)" : "Überspringen"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Typing (visits 1–2): home-row lesson (only with a confirmed layout) + a useful label
// ---------------------------------------------------------------------------

function TypingSegment({ view, busy, gate, onLesson, onLabel, onSkip }: {
  view: ChildView;
  busy: boolean;
  gate: Gate;
  onLesson: (op: { op: "typing-lesson"; lessonId: string; lines: string[]; seconds: number }, idempotencyKey: string) => Promise<LearningMutateOutcome | null>;
  onLabel: (taskId: string, typed: string, seconds: number) => void;
  onSkip: () => void;
}) {
  const typing = view.typing!;
  const lessonDoneOnServer = typing.available && typing.lessonDone;
  const [draft, setDraft] = useState<TypingDraft | null>(() => (typing.available && !typing.lessonDone ? createTypingDraft(typing.lesson.id, typing.lesson.lines) : null));
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [skippedLesson, setSkippedLesson] = useState(false);
  const [labelTyped, setLabelTyped] = useState("");
  const labelStartRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const labelRef = useRef<HTMLInputElement | null>(null);
  const retryRef = useRef<HTMLButtonElement | null>(null);
  const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}`);

  const lessonSaved = draft?.phase === "saved" || lessonDoneOnServer;
  const showLesson = typing.available && !lessonSaved && !skippedLesson && draft !== null;
  const saving = draft?.phase === "saving";
  const home = typing.available ? { left: typing.lesson.homeRow.slice(0, 4), right: typing.lesson.homeRow.slice(4, 8), anchors: ["f", "j"], thumb: " " } : HOME_FALLBACK;
  useDeliberateFocus(inputRef, showLesson && draft?.phase === "typing" ? `lesson:${draft.lineIndex}` : null, { gate, enabled: showLesson && draft?.phase === "typing" });
  useDeliberateFocus(labelRef, !showLesson && typing.label ? "label" : null, { gate, enabled: !showLesson && !!typing.label });
  useDeliberateFocus(retryRef, draft?.failure ? `failure:${draft.failure}` : null, { gate, enabled: !!draft?.failure });

  const save = useCallback(async () => {
    const current = draftRef.current;
    const payload = current ? lessonPayload(current) : null;
    if (!current || !payload || current.phase === "saving") return;
    setDraft(markSaving(current));
    const outcome = await onLesson(payload.op, payload.idempotencyKey);
    const latest = draftRef.current;
    if (!latest || latest.phase !== "saving") return;
    if (!outcome) {
      setDraft(applySaveOutcome(latest, { kind: "network" }));
      return;
    }
    if (outcome.ok && (outcome.status === "applied" || outcome.status === "replayed")) {
      setDraft(applySaveOutcome(latest, { kind: outcome.status }));
      return;
    }
    if (outcome.ok && outcome.status === "stale") {
      const doneOnServer = !!(outcome.view.typing && outcome.view.typing.available && outcome.view.typing.lessonDone);
      setDraft(applySaveOutcome(latest, { kind: "stale", lessonDoneOnServer: doneOnServer }));
      return;
    }
    if (!outcome.ok && "status" in outcome && outcome.status === "refused") {
      setDraft(applySaveOutcome(latest, { kind: "refused" }));
      return;
    }
    setDraft(applySaveOutcome(latest, { kind: "network" }));
  }, [onLesson]);

  const commit = () => {
    const current = draftRef.current;
    if (!current) return;
    const next = commitLine(current, { busy: busy || current.phase !== "typing", nowMs: Date.now(), newKey });
    if (next === current) return;
    setDraft(next);
  };

  useEffect(() => {
    if (draft?.phase === "completed" && draft.failure === null) void save();
  }, [draft?.phase, draft?.failure, save]);

  const currentLine = draft && typing.available ? typing.lesson.lines[draft.lineIndex] ?? null : null;
  const nextChar = currentLine && draft ? nextExpectedChar(currentLine, draft.current) : null;
  const nextFinger = nextChar && typing.available ? typing.lesson.fingers[nextChar] ?? null : null;

  return (
    <div className="flex flex-col gap-4">
      {showLesson && typing.available && draft ? (
        <>
          <Instruction kicker={`Tippen · ${typing.lesson.title}`}>{draft.phase === "typing" ? (nextChar === null ? "Zeile fertig — Enter." : nextChar === " " ? "Jetzt: Leertaste mit dem Daumen." : reachOriginOf(nextChar) ? `„${nextChar}“ mit dem ${nextFinger ?? "Finger"} — zurück auf „${reachOriginOf(nextChar)}“.` : `Jetzt: „${nextChar}“ mit dem ${nextFinger ?? "Finger"}.`) : "Runde gespeichert."}</Instruction>
          {draft.phase === "typing" && currentLine ? (
            <>
              <p className="font-mono text-3xl tracking-widest text-primary sm:text-4xl" aria-label="Zeile zum Abtippen">
                {Array.from(currentLine).map((ch, i) => {
                  const typedChars = Array.from(draft.current);
                  const state = i < typedChars.length ? (typedChars[i] === ch ? "ok" : "bad") : i === typedChars.length ? "next" : "todo";
                  return (
                    <span key={i} className={cn(state === "ok" && "text-green-700 dark:text-green-300", state === "bad" && "text-red-700 underline decoration-wavy dark:text-red-300", state === "next" && "underline decoration-4 underline-offset-4")}>
                      {ch === " " ? "␣" : ch}
                    </span>
                  );
                })}
              </p>
              <input
                ref={inputRef}
                value={draft.current}
                onChange={(e) => setDraft((d) => (d ? typeInto(d, e.target.value, Date.now()) : d))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !isComposing(e)) {
                    e.preventDefault();
                    commit();
                  }
                }}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
                className={cn("min-h-16 w-full rounded-2xl border-2 border-primary bg-primary px-4 font-mono text-3xl text-primary", focusRing)}
                aria-label="Hier tippen"
                data-testid="lesson-input"
              />
              <div className="mx-auto w-full max-w-[680px] rounded-3xl border border-primary bg-white p-2 dark:bg-stone-900">
                <HandsKeyboard fingers={typing.lesson.fingers} home={home} nextKey={nextChar} introduced={Array.from(new Set(typing.lesson.lines.join("").split("")))} compact />
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy || draft.current.length === 0} onClick={commit} className={primaryButton}>
                  Zeile fertig ({draft.lineIndex + 1}/{typing.lesson.lines.length})
                </button>
                <button type="button" disabled={busy} onClick={() => setSkippedLesson(true)} className={secondaryButton}>
                  Nur das Schild schreiben
                </button>
              </div>
            </>
          ) : null}
          {draft.phase !== "typing" ? (
            <div>
              {saving ? <p className="text-sm text-tertiary" role="status">… wird gespeichert</p> : null}
              {draft.failure ? (
                <div className="flex flex-wrap items-center gap-2" role="status">
                  <span className="text-sm text-primary">{draft.failure === "refused" ? "Das konnte so nicht gespeichert werden." : "Speichern hat nicht geklappt. Dein Training ist noch da."}</span>
                  {draft.failure !== "refused" ? (
                    <button ref={retryRef} type="button" disabled={busy} onClick={() => void save()} className={secondaryButton}>
                      Nochmal speichern
                    </button>
                  ) : null}
                  <button type="button" disabled={busy} onClick={() => setSkippedLesson(true)} className={secondaryButton}>
                    Weiter zum Schild
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      {!typing.available ? (
        <p className="rounded-2xl bg-secondary px-4 py-3 text-base text-primary">Das Finger-Training kommt, sobald deine Eltern die Tastatur bestätigt haben. Das Schild kannst du trotzdem schreiben.</p>
      ) : null}

      {!showLesson && typing.label ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (busy || labelTyped.length === 0) return;
            const seconds = labelStartRef.current ? (Date.now() - labelStartRef.current) / 1000 : 0;
            onLabel(typing.label!.taskId, labelTyped, seconds);
          }}
          className="flex flex-col gap-3"
        >
          <Instruction kicker="Schild">{typing.label.instruction}</Instruction>
          <p className="font-mono text-3xl text-primary" aria-label="Vorlage">
            {typing.label.target}
          </p>
          <input
            ref={labelRef}
            value={labelTyped}
            onChange={(e) => {
              if (labelStartRef.current === null) labelStartRef.current = Date.now();
              setLabelTyped(e.target.value.slice(0, 80));
            }}
            onKeyDown={(e) => (e.key === "Enter" && isComposing(e) ? e.preventDefault() : undefined)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            className={cn("min-h-16 rounded-2xl border-2 border-primary bg-primary px-4 font-mono text-3xl text-primary", focusRing)}
            aria-label="Schild tippen"
            data-testid="label-input"
          />
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || labelTyped.length === 0} className={primaryButton} data-testid="label-save">
              Schild aufhängen
            </button>
            <button type="button" onClick={onSkip} disabled={busy} className={secondaryButton}>
              {view.visit?.overBudget ? "Heute überspringen (Zeit)" : "Überspringen"}
            </button>
          </div>
        </form>
      ) : null}
      {!typing.label && !showLesson ? (
        <button type="button" onClick={onSkip} disabled={busy} className={secondaryButton}>
          Weiter
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

function SaveLog({ view, busy, gate, onSubmit }: { view: ChildView; busy: boolean; gate: Gate; onSubmit: (text: string, modality: "typed" | "spoken") => void }) {
  const [text, setText] = useState("");
  const [spokenText, setSpokenText] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useDeliberateFocus(ref, "log", { gate });
  const modality: "typed" | "spoken" = spokenText !== null && text === spokenText ? "spoken" : "typed";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onSubmit(text.trim(), modality);
      }}
      className="flex flex-col gap-4"
    >
      <StoryBeat speaker="logbook" beats={[{ text: `Basis „${view.base.name}“${view.base.location ? ` · ${view.base.location.label}` : ""}`, scene: "page" }]} compact />
      <Instruction kicker="Logbuch">Was ist heute passiert? Ein, zwei Sätze.</Instruction>
      <textarea ref={ref} value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={600} className={cn("rounded-2xl border-2 border-primary bg-primary px-4 py-3 text-xl text-primary", focusRing)} data-testid="log-input" />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy || !text.trim()} className={primaryButton} data-testid="log-save">
          Seite speichern
        </button>
        <SpokenAnswer
          disabled={busy}
          onTranscript={(t) => {
            setText(t);
            setSpokenText(t);
          }}
        />
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Tutor panel: typed or spoken question → bridge, sequenced by the runner
// ---------------------------------------------------------------------------

function TutorPanel({ child, view, speech, tutorClient, recordSupport, currentRevision, isAlive, onClose }: {
  child: ChildId;
  view: ChildView;
  speech: ChildSpeechPlayer;
  tutorClient: ReturnType<typeof createChildTurnClient>;
  recordSupport: (op: LearningOp & { op: "support" }, expectedRevision: number) => Promise<{ outcome: SupportOutcome; revision: number }>;
  currentRevision: () => number;
  isAlive: () => boolean;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [pendingTranscript, setPendingTranscript] = useState<string | null>(null);
  const [thread, setThread] = useState<{ role: "child" | "tutor" | "note"; text: string }[]>([]);
  const [pending, setPending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const panelAlive = useRef(true);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    panelAlive.current = true;
    // Opening the tutor is the child's deliberate choice: its field takes focus once.
    inputRef.current?.focus();
    return () => {
      panelAlive.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const ask = async (text: string) => {
    const check = checkChildUtterance(text);
    if (!check.ok) return;
    const context = view.tutor;
    setPending(true);
    setThread((t) => [...t, { role: "child", text: check.text }]);
    const result = await runTutorTurn(
      {
        recordSupport,
        currentRevision,
        newTurnId: () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `t-${Date.now()}`),
        isAlive: () => isAlive() && panelAlive.current,
        ask: async (message) => {
          const abort = new AbortController();
          abortRef.current = abort;
          const outcome = await tutorClient.ask({ childId: child, sessionSuffix: TUTOR_SESSION_SUFFIX, message }, { signal: abort.signal });
          return { ok: outcome.ok, text: outcome.ok ? envelopeSpokenText(outcome.envelope) : "" };
        },
      },
      context,
      check.text,
    );
    if (!panelAlive.current) return;
    setPending(false);
    switch (result.status) {
      case "answered":
        setThread((t) => [...t, { role: "tutor", text: result.text }]);
        speech.unlock();
        void speech
          .speak({ childId: child, text: result.text })
          .then((spoken) => {
            if (spoken === "fallback" && panelAlive.current) setThread((t) => [...t, { role: "note", text: "Vorlesen geht gerade nicht — die Antwort steht oben zum Lesen." }]);
          })
          .catch(() => {
            if (panelAlive.current) setThread((t) => [...t, { role: "note", text: "Vorlesen geht gerade nicht — die Antwort steht oben zum Lesen." }]);
          });
        return;
      case "question-not-recorded":
        setThread((t) => [...t, { role: "note", text: "Ich konnte die Frage nicht speichern, darum habe ich sie nicht gestellt. Versuch es gleich nochmal." }]);
        return;
      case "reply-withheld":
        setThread((t) => [...t, { role: "note", text: "Die Antwort konnte nicht gespeichert werden, darum zeige ich sie nicht. Frag gleich nochmal." }]);
        return;
      case "bridge-unavailable":
        setThread((t) => [...t, { role: "note", text: "Der Tutor ist gerade nicht erreichbar. Deine Aufgabe bleibt wie sie ist." }]);
        return;
    }
  };

  return (
    <aside id="tutor-panel" className="flex max-h-[70vh] flex-col rounded-3xl border border-primary bg-primary p-4 shadow-xs dark:shadow-none lg:max-h-none" aria-label="Tutor" data-testid="tutor-panel">
      <div className="flex items-center justify-between">
        <p className="text-base font-semibold text-primary">Tutor</p>
        <button type="button" onClick={onClose} className={cn("min-h-12 min-w-12 rounded-full text-xl", focusRing)} aria-label="Tutor schliessen" data-testid="tutor-close">
          ×
        </button>
      </div>
      {view.tutor ? <p className="mt-1 text-sm text-tertiary">Zur Aufgabe: „{view.tutor.prompt}“</p> : <p className="mt-1 text-sm text-tertiary">Frag, was du willst.</p>}
      <div className="mt-3 flex-1 space-y-2 overflow-y-auto" aria-live="polite">
        {thread.map((entry, index) => (
          <p key={index} className={cn("rounded-2xl px-3 py-2 text-base", entry.role === "child" && "bg-secondary text-primary", entry.role === "tutor" && "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900", entry.role === "note" && "border border-primary text-tertiary")}>
            {entry.text}
          </p>
        ))}
        {pending ? <p className="text-sm text-tertiary">… der Tutor überlegt</p> : null}
      </div>
      {pendingTranscript !== null ? (
        <div className="mt-3">
          <ConfirmTranscript
            transcript={pendingTranscript}
            busy={pending}
            onConfirm={() => {
              const t = pendingTranscript;
              setPendingTranscript(null);
              void ask(t);
            }}
            onReject={() => setPendingTranscript(null)}
          />
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (question.trim() && !pending) {
              void ask(question.trim());
              setQuestion("");
            }
          }}
          className="mt-3 flex flex-col gap-2"
        >
          <input ref={inputRef} value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => (e.key === "Enter" && isComposing(e) ? e.preventDefault() : undefined)} maxLength={1500} placeholder="Was heisst …? Warum …?" className={cn("min-h-14 rounded-2xl border border-primary bg-primary px-4 text-lg text-primary", focusRing)} aria-label="Frage an den Tutor" data-testid="tutor-input" />
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={pending || !question.trim()} className={primaryButton}>
              Fragen
            </button>
            <SpokenAnswer disabled={pending} onTranscript={(t) => setPendingTranscript(t)} label="🎙️ Frage sagen" />
            <button type="button" onClick={() => speech.cancel()} className={secondaryButton}>
              🔇 Stopp
            </button>
          </div>
        </form>
      )}
    </aside>
  );
}
