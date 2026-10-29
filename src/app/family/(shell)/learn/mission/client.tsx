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
import { HarborIsland } from "@/components/family/learning/harbor-island";
import { MissionWorld } from "@/components/family/learning/mission-world";
import { MissionScene } from "@/components/family/learning/mission-scene";
import { MapMission } from "@/components/family/learning/map-mission";
import { WorkshopScene } from "@/components/family/learning/workshop-scene";
import { IsabelStart } from "@/components/family/learning/workshop-hub";
import { WorkshopClosing, WorkshopFarewell } from "@/components/family/learning/workshop-closing";
import { createNarrationPlayer } from "@/lib/family-narration-player";
import type { NoktTalkTurnFn } from "@/components/family/learning/nokt-talk";
import { Debrief } from "@/components/family/learning/debrief";
import type { MissionAction } from "@/lib/family-learning-mission";
import { CharacterBeat, HarborPlan, IslandStage, LogReview, WordbookPanel } from "@/components/family/learning/harbor-stages";
import { NabuSidebar } from "@/components/family/learning/nabu-sidebar";
import { LIVE_TUTOR_DEFERRED_CHILD_NOTICE, liveTutorDeferred } from "@/lib/family-learning-deferral";
import { isComposing, useDeliberateFocus, useRestoreFocus } from "@/components/family/learning/focus";
import { HandsKeyboard, reachOriginOf } from "@/components/family/learning/hands-keyboard";
import { LessonEnd } from "@/components/family/learning/lesson-end";
import { ReminderCueView } from "@/components/family/learning/reminder-cue";
import { StoryBeat } from "@/components/family/learning/story-beat";
import { VisitReportView } from "@/components/family/learning/visit-report";
import { createChildTurnClient } from "@/lib/family-assistant-client";
import { envelopeRawText, envelopeSpokenText, type ChildId } from "@/lib/family-assistant-turn";
import { browserTimeZone, createLearningClient, type LearningMutateOutcome, type MutationContext } from "@/lib/family-learning-client";
import type { RetryItem } from "@/lib/family-learning-feedback";
import type { RetryOutcome, RetryPayload } from "@/components/family/learning/lesson-end";
import { stageLabel, type ChildView, type LearningOp, type SupportKind } from "@/lib/family-learning-state";
import { createReadAloudController } from "@/lib/family-learning-audio";
import { createTelemetryBuffer, enterStage, noteControl, noteInput, noteOp, noteSubmit, pause as pauseTelemetry, setHidden, takeBatch } from "@/lib/family-learning-telemetry";
import { LogRevise, LogTransfer, PierBuild, ReflectFeedback, StationBuild, StationChoice, Summary, TypingCourse, type DraftContext } from "./redesign-stages";
import { clearChildDrafts, retireAllDrafts, retireMismatched, type DraftIdentity } from "@/lib/family-learning-draft-store";
import { ExpeditionNotPrepared } from "@/components/family/learning/not-prepared";
import { recordSupportConfirmed, type SupportOutcome } from "@/lib/family-learning-tutor";
import { applySaveOutcome, commitLine, createTypingDraft, lessonPayload, markSaving, typeInto, type TypingDraft } from "@/lib/family-learning-typing";
import { nextExpectedChar } from "@/lib/family-learning-typing-metrics";
import { createChildSpeechPlayer, type ChildSpeechPlayer } from "@/lib/family-speech";
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

function parseAnswerNumber(raw: string): number | null {
  const cleaned = raw.trim().replace(",", ".");
  if (!/^\d{1,3}$/.test(cleaned)) return null;
  return Number(cleaned);
}

const HOME_FALLBACK = { left: ["a", "s", "d", "f"], right: ["j", "k", "l", "ö"], anchors: ["f", "j"], thumb: " " };

function Workspace({ child }: { child: ChildId }) {
  const learning = useMemo(() => createLearningClient(), []);
  const tutorClient = useMemo(() => createChildTurnClient(), []);
  // The semantic review of the captain's log goes through the same isolated child transport (session "learn") as every Nabu question.
  const semanticAsk = useCallback(
    async (message: string, signal: AbortSignal, idempotencyKey: string) => {
      const outcome = await tutorClient.ask({ childId: child, sessionSuffix: "learn", message }, { signal, idempotencyKey, noTruncate: true });
      // The EXACT wire text (the receipt signs it); the review never displays it as Nabu's words.
      return { ok: outcome.ok, text: outcome.ok ? envelopeRawText(outcome.envelope) : "", receipt: outcome.ok ? outcome.envelope.meta.receipt ?? null : null };
    },
    [tutorClient, child],
  );
  const speech = useMemo(() => createChildSpeechPlayer(), []);
  // Isabel Visit 2+ (narrated visits): ONE narration player for the page — unlocked only by her deliberate tap; how each line
  // was spoken (prerecorded / German device voice / none / refused) goes to the UX telemetry, never into learning evidence.
  const narrationTelemetryRef = useRef<((name: "narration-recorded" | "narration-device-de" | "narration-no-german-voice" | "narration-blocked") => void) | null>(null);
  const narrator = useMemo(() => createNarrationPlayer({ onLine: (_l, outcome) => narrationTelemetryRef.current?.(outcome === "recorded" ? "narration-recorded" : outcome === "device-de" ? "narration-device-de" : outcome === "no-german-voice" ? "narration-no-german-voice" : "narration-blocked") }), []);
  const [farewell, setFarewell] = useState<{ who: string; lines: string[]; grown: string | null; label: string } | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [nabuOpen, setNabuOpen] = useState(false);
  /** Content v7: he started the running visit himself in this page session (a reload never sets this). */
  const [entered, setEntered] = useState(false);
  /** Content v7: he finished the map mission himself in this page session — the look back's Nokt may open by itself, once. */
  const [closedHere, setClosedHere] = useState(false);
  const [overlay, setOverlay] = useState<"wordbook" | "logbook" | "supplies" | null>(null);
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
  narrationTelemetryRef.current = (name) => {
    telemetryRef.current = noteControl(telemetryRef.current, Date.now(), name);
  };
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
      narrator.stop();
      clearChildDrafts(typeof window !== "undefined" ? window.sessionStorage : null, child);
    };
  }, [refresh, learning, tutorClient, speech, narrator, child]);

  const stageForTelemetry = load.kind === "ready" ? load.view.visit?.stage ?? null : null;
  // Content v6 (N7-02): inside the mission stage the open step is attributed too (closed vocabulary; entry/exit and active time per task).
  const stepForTelemetry = load.kind === "ready" && stageForTelemetry === "mission" ? load.view.mission?.active?.id ?? null : null;
  useEffect(() => {
    telemetryRef.current = enterStage(telemetryRef.current, stageForTelemetry, Date.now(), stepForTelemetry);
    if (stageForTelemetry) flushTelemetry();
  }, [stageForTelemetry, stepForTelemetry, flushTelemetry]);
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

  // The Nabu sidebar: focus returns to where it was when it closes (UX-3); it opens by itself for the reasoning conversation.
  useRestoreFocus(nabuOpen);
  // Only once the previous lesson's feedback is acknowledged: the conversation never opens over the lesson end.
  const reasoningOpen = load.kind === "ready" && !!load.view.reasoning && !load.view.reasoning.deferred && load.view.reasoning.status !== "done" && !load.view.lastLesson;
  const reasoningKey = load.kind === "ready" && load.view.reasoning ? `${load.view.reasoning.itemId}:${load.view.visit?.startedAt ?? ""}` : null;
  const openedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (reasoningOpen && reasoningKey && openedForRef.current !== reasoningKey) {
      openedForRef.current = reasoningKey;
      setNabuOpen(true);
    }
  }, [reasoningOpen, reasoningKey]);
  const gate: Gate = useCallback(() => !nabuOpen && overlay === null, [nabuOpen, overlay]);

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

  /** Content v7: one Nokt conversation turn outside the task talk (welcome, visit, writing, debrief) through the server. */
  const talkTurn: NoktTalkTurnFn = useCallback(
    async (turn, signal) => {
      const current = viewRef.current;
      if (!current) return { kind: "failed", line: "Nokt ist gerade nicht erreichbar." };
      const out = await learning.noktTurn(child, turn, current.revision, { signal, context: contextOfView(current), timeZone: browserTimeZone() });
      if (!aliveRef.current || signal.aborted || (!out.ok && "failure" in out && out.failure === "cancelled")) return { kind: "cancelled" };
      if ("view" in out && out.view) adopt(out.view);
      if (out.ok && out.status !== "stale") {
        const r = out.result as { shown?: boolean; say?: string; line?: string; reason?: string };
        if (r.shown === true && typeof r.say === "string") return { kind: "shown", say: r.say };
        // No reply at all (runtime unreachable, used up, refused): his words go back into the box.
        if (r.shown === false && typeof r.line === "string") return { kind: r.reason?.startsWith("no-reply-") ? "failed" : "app", line: r.line };
      }
      return { kind: "failed", line: "Nokt ist gerade nicht erreichbar. Du kannst es gleich nochmal versuchen." };
    },
    [child, learning, adopt],
  );

  /** Support op → confirmed/not, retrying once on a stale revision. */
  const recordSupportRaw = useCallback(
    async (op: LearningOp & { op: "support" }): Promise<{ outcome: SupportOutcome; revision: number; result?: unknown }> => {
      const result = await mutate(op);
      const revision = viewRef.current?.revision ?? 0;
      if (!result) return { outcome: "failed", revision };
      if (result.ok) return { outcome: result.status, revision, result: "result" in result ? result.result : undefined };
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

  // Isabel Visit 2+ (narrated): the spoken goodbye after her closing answers were saved, then one way home.
  if (farewell) {
    return (
      <WorkshopFarewell
        who={farewell.who}
        lines={farewell.lines}
        grown={farewell.grown}
        label={farewell.label}
        narrator={narrator}
        telemetry={(name) => {
          telemetryRef.current = noteControl(telemetryRef.current, Date.now(), name);
        }}
        onHome={() => router.push(`/family/home?child=${child}`)}
      />
    );
  }

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

  if (!view.visit && view.child === "isabel") {
    // Isabel Visit 1: her own start screen (Old Lila's workshop), never Santiago's island.
    // The deliberate start also unlocks the narration of a narrated visit (nothing is spoken before this tap).
    return <IsabelStart child={child} view={view} busy={busy} notice={notice} onStart={() => { speech.unlock(); narrator.unlock(); void mutate({ op: "start-visit" }); }} />;
  }

  if (!view.visit) {
    return (
      <StartOrWait
        child={child}
        view={view}
        busy={busy}
        onStart={() => {
          // Content v7: a deliberate start (not a reload or resume) may open Nokt's one-time welcome.
          speech.unlock();
          void mutate({ op: "start-visit" }).then((outcome) => {
            if (outcome && outcome.ok && outcome.status === "applied" && (outcome.result as { resumed?: boolean }).resumed === false) setEntered(true);
          });
        }}
        notice={notice}
        markers={markers}
      />
    );
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
        {view.mission?.active?.produce || view.child === "isabel" ? <span className="w-[6.5rem]" aria-hidden /> : <button
          type="button"
          onClick={() => {
            // During a recall step the wordbook SHOWS the target word: opening it is recorded as help on the segment first (IV5-11).
            const recallStep = view.language?.step?.kind === "produce" ? view.language : null;
            if (recallStep) void support("word_choice", recallStep.id, { text: "wordbook-opened" }).then((ok) => ok && setOverlay("wordbook"));
            else setOverlay("wordbook");
          }}
          className={secondaryButton}
          aria-haspopup="dialog"
          data-testid="hud-wordbook"
          data-help={view.language?.step?.kind === "produce" ? "true" : "false"}
        >
          📖 Wörter
        </button>}
      </header>

      {view.base.name && stage !== "mission" ? (
        <p className="mt-2 text-center text-sm text-tertiary" data-testid="hud-location">
          Basis „{view.base.name}“{view.base.location ? ` · ${view.base.location.label}` : ""}
        </p>
      ) : null}

      {notice ? (
        <p className="mt-3 rounded-2xl bg-secondary px-4 py-2 text-base text-primary" role="status" data-testid="notice">
          {notice}
        </p>
      ) : null}

      {stage === "mission" && view.mission && !lastLesson && view.mission.presentation === "scene" ? (
        // Visit 7 (content v6): one illustrated scene, the beats in their reviewed order, Nokt beside the task.
        <div className="mt-3" data-testid="mission-stage" data-presentation="scene">
          <MissionScene
            child={child}
            view={view}
            mission={view.mission}
            busy={busy}
            speech={speech}
            noktMode={view.nokt?.mode ?? "unavailable"}
            noktTranscribe={view.nokt?.mic ? (audio, fileName, signal) => learning.transcribeNokt(child, audio, fileName, { signal }) : null}
            noktTurn={async (turn, signal) => {
              const current = viewRef.current;
              if (!current) return { kind: "failed" };
              const out = await learning.noktTurn(child, turn, current.revision, { signal, context: contextOfView(current), timeZone: browserTimeZone() });
              if (!aliveRef.current || signal.aborted || (!out.ok && "failure" in out && out.failure === "cancelled")) return { kind: "cancelled" };
              if ("view" in out && out.view) adopt(out.view);
              if (out.ok && out.status !== "stale") {
                const r = out.result as { shown?: boolean; say?: string; line?: string; reason?: string };
                if (r.shown === true && typeof r.say === "string") return { kind: "shown", say: r.say };
                if (r.shown === false && r.reason === "no-reply-daily-allowance") return { kind: "exhausted" };
                if (r.shown === false && typeof r.line === "string") return { kind: "withheld", line: r.line };
              }
              return { kind: "failed" };
            }}
            telemetry={(name) => {
              telemetryRef.current = noteControl(telemetryRef.current, Date.now(), name);
            }}
            act={async (action: MissionAction, options?: { idempotencyKey?: string }) => {
              const outcome = await mutate({ op: "mission", action }, options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined);
              return outcome && outcome.ok && (outcome.status === "applied" || outcome.status === "replayed") ? ((outcome.result as Record<string, unknown> | undefined) ?? {}) : null;
            }}
          />
        </div>
      ) : stage === "mission" && view.mission && !lastLesson && view.mission.presentation === "workshop" ? (
        // Isabel Visit 1: Old Lila's workshop — one short instruction and one picture answer at a time; no Nokt, no microphone.
        <div className="mt-3" data-testid="mission-stage" data-presentation="workshop">
          <WorkshopScene
            child={child}
            mission={view.mission}
            busy={busy}
            speech={speech}
            narrator={narrator}
            telemetry={(name) => {
              telemetryRef.current = noteControl(telemetryRef.current, Date.now(), name);
            }}
            act={async (action: MissionAction, options?: { idempotencyKey?: string }) => {
              const outcome = await mutate({ op: "mission", action }, options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined);
              return outcome && outcome.ok && (outcome.status === "applied" || outcome.status === "replayed") ? ((outcome.result as Record<string, unknown> | undefined) ?? {}) : null;
            }}
          />
        </div>
      ) : stage === "mission" && view.mission && !lastLesson && view.mission.presentation === "map" ? (
        // Visit 8 (content v7): the walkable island between clear task scenes, Nokt beside it.
        <div className="mt-3" data-testid="mission-stage" data-presentation="map">
          <MapMission
            child={child}
            view={view}
            mission={view.mission}
            markers={markers}
            busy={busy}
            speech={speech}
            nokt={{
              mode: view.nokt?.mode ?? "unavailable",
              transcribe: view.nokt?.mic ? (audio, fileName, signal) => learning.transcribeNokt(child, audio, fileName, { signal }) : null,
              taskTurn: async (turn, signal) => {
                const current = viewRef.current;
                if (!current) return { kind: "failed" };
                const out = await learning.noktTurn(child, turn, current.revision, { signal, context: contextOfView(current), timeZone: browserTimeZone() });
                if (!aliveRef.current || signal.aborted || (!out.ok && "failure" in out && out.failure === "cancelled")) return { kind: "cancelled" };
                if ("view" in out && out.view) adopt(out.view);
                if (out.ok && out.status !== "stale") {
                  const r = out.result as { shown?: boolean; say?: string; line?: string; reason?: string };
                  if (r.shown === true && typeof r.say === "string") return { kind: "shown", say: r.say };
                  if (r.shown === false && r.reason === "no-reply-daily-allowance") return { kind: "exhausted" };
                  if (r.shown === false && typeof r.line === "string") return { kind: "withheld", line: r.line };
                }
                return { kind: "failed" };
              },
              talkTurn,
              intentionalEntry: entered,
            }}
            telemetry={(name) => {
              telemetryRef.current = noteControl(telemetryRef.current, Date.now(), name);
            }}
            onWalk={() => {
              telemetryRef.current = noteControl(telemetryRef.current, Date.now(), "walk");
            }}
            act={async (action: MissionAction, options?: { idempotencyKey?: string }) => {
              // The deliberate «Zum Rückblick» tap is a user gesture: unlock audio now, so Nokt's first look-back question can be heard.
              if (action.a === "finish") speech.unlock();
              const outcome = await mutate({ op: "mission", action }, options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined);
              const ok = !!outcome && outcome.ok && (outcome.status === "applied" || outcome.status === "replayed");
              if (ok && action.a === "finish" && outcome.status === "applied") setClosedHere(true);
              return ok ? ((outcome.result as Record<string, unknown> | undefined) ?? {}) : null;
            }}
          />
        </div>
      ) : stage === "mission" && view.mission && !lastLesson ? (
        // Visit 6 (content v5): the mission is ONE walkable scene with its own scene panels — not the worksheet card.
        <div className="mt-3" data-testid="mission-stage">
          <MissionWorld
            child={child}
            view={view}
            mission={view.mission}
            markers={markers}
            busy={busy}
            speech={speech}
            onWalk={() => {
              telemetryRef.current = noteControl(telemetryRef.current, Date.now(), "walk");
            }}
            act={async (action: MissionAction) => {
              const outcome = await mutate({ op: "mission", action });
              return outcome && outcome.ok && (outcome.status === "applied" || outcome.status === "replayed") ? ((outcome.result as Record<string, unknown> | undefined) ?? {}) : null;
            }}
          />
        </div>
      ) : null}
      <div className={cn("mt-3 grid flex-1 gap-4", nabuOpen && "lg:mr-[420px]", stage === "mission" && view.mission && !lastLesson && "hidden")}>
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
                {stage === "island" && view.harbor ? <IslandStage view={view} markers={markers} busy={busy} gate={gate} onEnter={(workplace) => void mutate({ op: "enter-workplace", workplace })} onOpenWordbook={() => setOverlay("wordbook")} onOpenLogbook={() => setOverlay("logbook")} onOpenSupplies={() => setOverlay("supplies")} /> : null}
                {stage === "harbor-build" && view.harbor ? <HarborPlan view={view} busy={busy} gate={gate} onPlan={(destination) => void mutate({ op: "plan-harbor", destination })} /> : null}
                {stage === "log-review" && view.logReview ? <LogReview key={identityKey(view)} view={view} busy={busy} gate={gate} onSubmit={(text, clarifications) => void mutate({ op: "review-log", text, clarifications })} onSkip={() => void mutate({ op: "skip-stage", stage: "log-review", reason: optionalReason })} ask={semanticAsk} onDispatch={async (turnId) => { const r = await mutate({ op: "review-log-dispatch", turnId }); return !!r && r.ok && (r.status === "applied" || r.status === "replayed"); }} onSemantic={(turnId, ok, text, receipt) => mutate({ op: "review-log-semantic", turnId, ok, text, ...(receipt !== null && receipt !== undefined ? { receipt } : {}) } as LearningOp)} /> : null}
                {stage === "station-choice" ? <StationChoice view={view} busy={busy} gate={gate} onChoose={(theme) => void mutate({ op: "choose-station", theme })} /> : null}
                {stage === "typing-course" && view.typingCourse && view.harbor && view.visit.id === "v6" ? <KeeperBeat view={view} workplace="typing" lineId="welcome" /> : null}
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
                    onAnswerQuotient={(full, remaining, raw, modality, uncertain) => void mutate({ op: "answer-quotient", itemId: view.math!.id, full, remaining, raw, modality, uncertain })}
                    onAnswerNeeded={(needed, raw, modality, uncertain) => void mutate({ op: "answer-needed", itemId: view.math!.id, needed, raw, modality, uncertain })}
                    onContinue={() => void mutate({ op: "continue-item", itemId: view.math!.id })}
                    onTeach={() => void mutate({ op: "request-teaching", itemId: view.math!.id })}
                    onStop={() => void mutate({ op: "stop-item", itemId: view.math!.id })}
                  />
                ) : null}
                {stage === "explain" && view.reasoning?.deferred ? (
                  <DeferredExplain busy={busy} gate={gate} childTurns={view.reasoning.turns.filter((t) => t.role === "child").length} onContinue={() => void mutate({ op: "skip-stage", stage: "explain", reason: "deferred" })} />
                ) : stage === "explain" && view.reasoning ? (
                  <ReasoningStage view={view} busy={busy} gate={gate} open={nabuOpen} onOpen={() => setNabuOpen(true)} onSkip={() => void mutate({ op: "skip-stage", stage: "explain", reason: optionalReason })} />
                ) : stage === "explain" ? (
                  <Explain
                    busy={busy}
                    gate={gate}
                    overBudget={view.visit.overBudget}
                    onSubmit={(text, modality) => void mutate({ op: "explain", text, modality })}
                    onSkip={() => void mutate({ op: "skip-stage", stage: "explain", reason: optionalReason })}
                  />
                ) : null}
                {view.language && view.harbor && view.language.id === "LANG-ES-HARBOR" ? <KeeperBeat view={view} workplace="supplier" lineId="welcome" onTranslate={() => support("gloss", view.language!.id, { word: "rosa-welcome", language: "es" })} /> : null}
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
                {stage === "reflect" && view.reflection?.closing?.narrated ? (
                  // Isabel Visit 2+: one spoken question per screen, then the spoken goodbye (no Nokt, no microphone).
                  <WorkshopClosing
                    key={identityKey(view)}
                    view={view}
                    busy={busy}
                    narrator={narrator}
                    telemetry={(name) => {
                      telemetryRef.current = noteControl(telemetryRef.current, Date.now(), name);
                    }}
                    onFeedback={(feedback) => mutate({ op: "closing-feedback", feedback } as LearningOp)}
                    onFinish={async (payload, idempotencyKey) => {
                      const identity = visitIdentity();
                      const closing = view.reflection?.closing ?? null;
                      const outcome = await mutate(payload as LearningOp, { idempotencyKey });
                      const ok = !!outcome && outcome.ok && (outcome.status === "applied" || outcome.status === "replayed");
                      if (ok) {
                        flushTelemetry(true, identity, `ui-${idempotencyKey}`);
                        setFarewell({ who: view.visitText?.character ?? "", lines: closing?.farewell ?? [], grown: closing?.made?.picture ?? null, label: closing?.recap ?? closing?.made?.room ?? "" });
                      }
                      return ok;
                    }}
                  />
                ) : stage === "reflect" && view.reflection?.closing ? (
                  // Visit 8 (content v7): the short spoken look back replaces the click-through summary; the form stays the fallback.
                  <Debrief
                    key={identityKey(view)}
                    child={child}
                    view={view}
                    busy={busy}
                    speech={speech}
                    transcribe={view.nokt?.mic ? (audio, fileName, signal) => learning.transcribeNokt(child, audio, fileName, { signal }) : null}
                    turn={view.nokt && view.nokt.mode !== "unavailable" ? talkTurn : null}
                    autoOpen={closedHere}
                    onFeedback={(feedback) => mutate({ op: "closing-feedback", feedback } as LearningOp)}
                    onFinish={async (payload, idempotencyKey) => {
                      const identity = visitIdentity();
                      const outcome = await mutate(payload as LearningOp, { idempotencyKey });
                      if (outcome && outcome.ok && (outcome.status === "applied" || outcome.status === "replayed")) {
                        flushTelemetry(true, identity, `ui-${idempotencyKey}`);
                        // The journey ends where it began: Family Home (the visit report stays reopenable from the hub).
                        router.push(`/family/home?child=${child}`);
                      }
                      return outcome;
                    }}
                  />
                ) : stage === "reflect" && view.reflection ? (
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

      </div>
      {stage === "mission" || view.reflection?.closing ? null : <NabuSidebar
        child={child}
        view={view}
        page="mission"
        speech={speech}
        tutorClient={liveTutorDeferred(view.visit?.id) ? null : tutorClient}
        recordSupport={recordSupportRaw}
        currentRevision={() => viewRef.current?.revision ?? 0}
        isAlive={() => aliveRef.current}
        onReasoningTurn={(text, modality) => mutate({ op: "reasoning-turn", text, modality })}
        onReasoningReply={(turnId, ok, text, receipt) => mutate({ op: "reasoning-reply", turnId, ok, text, ...(receipt !== null && receipt !== undefined ? { receipt } : {}) } as LearningOp)}
        onReasoningChoice={(choice) => mutate({ op: "reasoning-choice", choice })}
        open={nabuOpen}
        onOpenChange={setNabuOpen}
        busy={busy}
      />}
      {overlay ? (
        <Overlay title={overlay === "wordbook" ? "Wörterbuch" : overlay === "logbook" ? "Logbuch" : "Vorräte"} onClose={() => setOverlay(null)}>
          {overlay === "wordbook" ? (
            <WordbookPanel
              view={view}
              onSay={(text) => {
                speech.unlock();
                void speech.speak({ childId: child, text });
              }}
            />
          ) : overlay === "logbook" ? (
            <ul className="grid gap-3" data-testid="logbook-panel">
              {view.pages.map((page, index) => (
                <li key={`${page.visit}-${index}`} className="rounded-2xl border border-primary bg-primary p-4" data-testid="logbook-page">
                  <p className="font-semibold text-primary">{page.title}</p>
                  <p className="mt-2 text-base text-primary">{page.text}</p>
                </li>
              ))}
              {view.pages.length === 0 ? <li className="text-base text-tertiary">Noch keine Seite.</li> : null}
            </ul>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2" data-testid="supplies-panel">
              {Object.entries(view.base.supplies)
                .filter(([, n]) => n > 0)
                .map(([k, n]) => (
                  <li key={k} className="rounded-2xl border border-primary bg-primary px-4 py-3 text-lg text-primary">
                    <strong>{n}</strong> {k}
                  </li>
                ))}
            </ul>
          )}
        </Overlay>
      ) : null}
    </div>
  );
}

/** A dismissable overlay panel (wordbook, logbook, supplies) — Escape closes, focus lands on the close control. */
function Overlay({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-stone-900/30" role="presentation" onClick={onClose} data-testid="mission-overlay">
      <section role="dialog" aria-modal="true" aria-label={title} className="flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-secondary p-4 shadow-2xl sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-tertiary">{title}</p>
          <button ref={closeRef} type="button" onClick={onClose} className={cn("inline-flex min-h-12 min-w-12 items-center justify-center rounded-full border border-primary bg-primary text-xl", focusRing)} aria-label="Schliessen" data-testid="overlay-close">
            ×
          </button>
        </div>
        <div className="mt-4 flex-1">{children}</div>
      </section>
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
        <HarborIsland scene={view.scene} markers={markers} pages={view.pages.length} harbor={view.harbor} variant="strip" />
      </div>
      <div className="mt-4 flex flex-col gap-4">
        <StoryBeat speaker="radio" beats={[{ text: lines[0], scene: view.base.name ? "base" : "team" }]} compact />
        <div className="rounded-3xl border border-primary bg-primary p-5">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-tertiary">{nextDef ? "Jetzt" : "Gespeichert"}</p>
          <h1 className="mt-1 text-2xl font-semibold leading-tight text-primary sm:text-3xl">{view.nextStep}</h1>
          {notice ? <p className="mt-2 text-base text-primary">{notice}</p> : null}
          {nextDef ? (
            <button ref={startRef} type="button" onClick={onStart} disabled={busy} className={cn(primaryButton, "mt-4 min-h-16 px-8 text-xl")} data-testid="start-visit" data-visit={nextDef} data-ordinal={view.next.ordinal ?? ""}>
              {nextDef === "v1" ? "Los geht's" : nextDef === "v4" || nextDef === "v5" || nextDef === "v6" || nextDef === "v7" || nextDef === "v8" || nextDef === "v9" ? `Besuch ${view.next.ordinal ?? (nextDef === "v9" ? 8 : nextDef === "v8" ? 7 : nextDef === "v7" ? 6 : nextDef === "v6" ? 5 : nextDef === "v5" ? 4 : 3)} starten` : nextDef === "v3" ? "Angefangene Aufgabe zu Ende bringen" : "Weiter geht's"}
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
      {intro ? <StoryBeat speaker="radio" beats={view.visit?.id === "v6" ? [{ text: intro.who, scene: "boat" }, { text: intro.make, scene: "team" }, { text: intro.done, scene: "page" }] : view.visit?.id === "v5" ? [{ text: intro.who, scene: "boat" }, { text: intro.make, scene: "pier" }, { text: intro.done, scene: "boat" }] : [{ text: intro.who, scene: "team" }, { text: intro.make, scene: "station" }, { text: intro.done, scene: "lamp" }]} testId="mission-intro" /> : <StoryBeat speaker="team" beats={[{ text: "Deine Vorräte sind noch da. Heute geht die Expedition weiter.", scene: "base" }]} compact />}
      <button ref={ref} type="button" onClick={onContinue} disabled={busy} className={primaryButton} data-testid="stage-continue">
        Weiter
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Math item: typed answer (unaided) or counters (supported), teaching phases
// ---------------------------------------------------------------------------

function MathItem({ child, view, busy, gate, speech, support, onAnswer, onAnswerRemainder, onAnswerQuotient, onAnswerNeeded, onContinue, onTeach, onStop }: {
  child: ChildId;
  view: ChildView;
  busy: boolean;
  gate: Gate;
  speech: ChildSpeechPlayer;
  support: SupportFn;
  onAnswer: (answer: number | null, raw: string, modality: "typed" | "counters" | "spoken", uncertain?: boolean) => void;
  onAnswerRemainder: (used: number | null, remaining: number | null, raw: string, modality: "typed" | "counters" | "spoken", uncertain?: boolean) => void;
  onAnswerQuotient: (full: number | null, remaining: number | null, raw: string, modality: "typed" | "counters", uncertain?: boolean) => void;
  onAnswerNeeded: (needed: number | null, raw: string, modality: "typed", uncertain?: boolean) => void;
  onContinue: () => void;
  onTeach: () => void;
  onStop: () => void;
}) {
  const item = view.math!;
  const quotientItem = item.kind === "quotient";
  const remainderItem = item.kind === "remainder";
  const capacity = remainderItem || quotientItem ? item.perGroup ?? 0 : null;
  const [rawUsed, setRawUsed] = useState("");
  const [rawRemaining, setRawRemaining] = useState("");
  const [raw, setRaw] = useState("");
  const [countersOpen, setCountersOpen] = useState(false);
  const [trays, setTrays] = useState<number[]>(() => Array.from({ length: item.groups }, () => 0));
  const placed = trays.reduce((a, b) => a + b, 0);
  const remaining = item.quantity - placed;
  const partB = quotientItem && item.part === "needed";
  const fullTrays = trays.filter((t) => capacity !== null && t === capacity).length;
  const canAnswer = item.phase === "answer" || item.phase === "clarify" || item.phase === "represent";
  const answerRef = useRef<HTMLInputElement | null>(null);
  const continueRef = useRef<HTMLButtonElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  // Focus the answer field on the item and again after each attempt (clarification, representation) — deliberate transitions only;
  // the item's own second number field may hand focus back to the first one.
  useDeliberateFocus(answerRef, canAnswer && !countersOpen ? `${item.id}:${item.part ?? ""}:${item.phase}:${item.attemptNo}` : null, { gate, within: formRef, enabled: canAnswer && !countersOpen });
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
        {item.taughtQuotient ? (
          <p className="text-base text-primary">
            Wir haben es zusammen gemacht: {item.taughtQuotient.full} {item.group.plural} voll ({item.taughtQuotient.full} × {item.perGroup} = {item.taughtQuotient.full * (item.perGroup ?? 0)}), {item.quantity} − {item.taughtQuotient.full * (item.perGroup ?? 0)} = {item.taughtQuotient.remaining} übrig; für alle {item.unit.plural} braucht es {item.taughtQuotient.needed} {item.group.plural}.
          </p>
        ) : item.taughtAnswers ? (
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
      {quotientItem && view.harbor && item.id === "EQ-HARBOR" && !partB ? <KeeperBeat view={view} workplace="planning" lineId="welcome" /> : null}
      {item.scene && !partB ? <StoryBeat speaker="team" beats={[{ text: item.scene, scene: item.id === "EQ-PIER" || quotientItem ? "boat" : remainderItem ? "garden" : "team" }]} compact /> : null}
      {partB && item.decisionPrompt ? (
        <div data-testid="math-decision">
          <p className="rounded-2xl bg-green-50 px-4 py-2 text-base text-primary dark:bg-green-950/30" data-testid="math-part-a">
            ✓ {item.partA?.full} {item.group.plural} voll, {item.partA?.remaining} {item.unit.plural} übrig.
          </p>
          <p className="mt-3 text-sm font-semibold uppercase tracking-[0.14em] text-tertiary">Mathe · Teil 2</p>
          <h2 className="mt-1 text-2xl font-semibold leading-tight text-primary sm:text-3xl" data-testid="math-question">
            {item.decisionPrompt}
          </h2>
        </div>
      ) : (
        <MathPrompt prompt={item.prompt} />
      )}
      <div className="flex flex-wrap gap-2">
        <AudioControls child={child} speech={speech} text={partB && item.decisionPrompt ? item.decisionPrompt : item.prompt} label="Vorlesen" disabled={busy} beforePlay={() => support("read_aloud", item.id, { text: partB ? "decision" : "prompt" })} />
        {!countersOpen && canAnswer && !partB ? (
          <button type="button" onClick={() => void openCounters()} className={secondaryButton} disabled={busy} data-testid="open-counters">
            {item.groupKind === "people" ? `${item.unit.emoji} ${item.unit.plural} an die ${item.group.plural} verteilen` : `${item.unit.emoji} ${item.unit.plural} in die ${item.group.plural} legen`}
          </button>
        ) : null}
      </div>

      {item.phase === "clarify" && item.clarification ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-base text-amber-900 dark:bg-amber-950/40 dark:text-amber-100" role="status" data-testid="clarification">
          {item.clarification}
          {item.lastPartial ? (item.lastPartial.usedCorrect && !item.lastPartial.remainingCorrect ? (quotientItem ? ` Die vollen ${item.group.plural} stimmen — schau den Rest noch einmal an.` : ` Die ${item.usedWord.past}en ${item.unit.plural} stimmen — schau den Rest noch einmal an.`) : !item.lastPartial.usedCorrect && item.lastPartial.remainingCorrect ? ` Der Rest stimmt — zähle die vollen ${item.group.plural} noch einmal.` : "") : ""}
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

      {countersOpen && canAnswer && !partB ? (
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
          {quotientItem ? (
            <>
              <p className="mt-2 text-sm text-tertiary" data-testid="leftovers">
                Volle {item.group.plural}: {fullTrays} · am Kai: {remaining} {remaining === 1 ? item.unit.singular : item.unit.plural}
              </p>
              <button type="button" disabled={busy || trays.some((t) => t !== 0 && t !== capacity) || remaining >= (capacity ?? 1)} onClick={() => onAnswerQuotient(fullTrays, remaining, `${fullTrays} voll, ${remaining} übrig`, "counters")} className={cn(primaryButton, "mt-4")} data-testid="counters-submit">
                {fullTrays} {item.group.plural} voll (je {capacity}), {remaining} übrig — fertig
              </button>
              {trays.some((t) => t !== 0 && t !== capacity) || remaining >= (capacity ?? 1) ? <p className="mt-2 text-sm text-tertiary">Mach jedes {item.group.singular} ganz voll (genau {capacity}), bis weniger als {capacity} übrig sind. Was nicht mehr passt, bleibt am Kai.</p> : null}
            </>
          ) : remainderItem ? (
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

      {canAnswer && quotientItem && !partB ? (
        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault();
            const full = parseAnswerNumber(rawUsed);
            const rem = parseAnswerNumber(rawRemaining);
            if (full === null || rem === null) return;
            onAnswerQuotient(full, rem, `${rawUsed.trim()} voll, ${rawRemaining.trim()} übrig`, "typed");
            setRawUsed("");
            setRawRemaining("");
          }}
          className="flex flex-wrap items-end gap-3"
          data-testid="math-form-quotient"
        >
          {numberInput({ value: rawUsed, onChange: setRawUsed, label: item.quotientWords?.fullLabel ?? "Voll", testId: "math-answer-full", ref: answerRef })}
          {numberInput({ value: rawRemaining, onChange: setRawRemaining, label: item.quotientWords?.remainingLabel ?? "Übrig", testId: "math-answer-remaining" })}
          <button type="submit" disabled={busy || parseAnswerNumber(rawUsed) === null || parseAnswerNumber(rawRemaining) === null} className={primaryButton} data-testid="math-submit">
            Fertig
          </button>
        </form>
      ) : null}
      {canAnswer && partB ? (
        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault();
            const n = parseAnswerNumber(raw);
            if (n === null) return;
            onAnswerNeeded(n, raw.trim(), "typed");
            setRaw("");
          }}
          className="flex flex-wrap items-end gap-3"
          data-testid="math-form-needed"
        >
          {numberInput({ value: raw, onChange: setRaw, label: item.quotientWords?.neededLabel ?? "Für alle", testId: "math-answer-needed", ref: answerRef })}
          <button type="submit" disabled={busy || parseAnswerNumber(raw) === null} className={primaryButton} data-testid="math-submit">
            Fertig
          </button>
        </form>
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
        </form>
      ) : null}
      {canAnswer && !remainderItem && !quotientItem ? (
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
        </form>
      ) : null}
      {liveTutorDeferred(view.visit?.id) ? null : <p className="text-xs text-tertiary">Fragen oder laut erklären kannst du unten rechts bei Nabu.</p>}
    </div>
  );
}

/** One keeper's reviewed line for the current workplace (English keeper, German planner, Spanish supplier). */
function KeeperBeat({ view, workplace, lineId, onTranslate }: { view: ChildView; workplace: "typing" | "planning" | "supplier"; lineId: string; onTranslate?: () => Promise<boolean> }) {
  const character = workplace === "supplier" ? view.harbor?.characters.find((c) => c.id === "supplier") ?? null : view.harbor?.workplaces.find((w) => w.id === workplace)?.character ?? null;
  if (!character) return null;
  return <CharacterBeat character={character} lineId={lineId} onTranslate={onTranslate} compact testId={`keeper-${character.id}`} />;
}

/** The explanation stage of Visit 5: the conversation lives in the Nabu sidebar; this card opens it and keeps skipping possible. */
/** D1 (temporary scope reduction): an explain stage that is ALREADY active on a deferred visit (saved before the deferral or resumed) — no live invitation; one honest line and Weiter. */
function DeferredExplain({ busy, gate, childTurns, onContinue }: { busy: boolean; gate: Gate; childTurns: number; onContinue: () => void }) {
  const ref = useRef<HTMLButtonElement | null>(null);
  useDeliberateFocus(ref, "reasoning-deferred", { gate });
  return (
    <div className="flex flex-col gap-4" data-testid="reasoning-deferred" data-child-turns={childTurns}>
      <Instruction kicker="Erklären">{LIVE_TUTOR_DEFERRED_CHILD_NOTICE}</Instruction>
      {childTurns ? <p className="text-sm text-tertiary" data-testid="reasoning-deferred-kept">Deine {childTurns === 1 ? "Antwort" : `${childTurns} Antworten`} von vorhin {childTurns === 1 ? "bleibt" : "bleiben"} gespeichert.</p> : null}
      <div className="flex flex-wrap gap-2">
        <button ref={ref} type="button" onClick={onContinue} disabled={busy} className={primaryButton} data-testid="reasoning-deferred-continue">
          Weiter
        </button>
      </div>
    </div>
  );
}

function ReasoningStage({ view, busy, gate, open, onOpen, onSkip }: { view: ChildView; busy: boolean; gate: Gate; open: boolean; onOpen: () => void; onSkip: () => void }) {
  const reasoning = view.reasoning!;
  const ref = useRef<HTMLButtonElement | null>(null);
  useDeliberateFocus(ref, !open ? `reasoning:${reasoning.itemId}` : null, { gate, enabled: !open });
  const childTurns = reasoning.turns.filter((t) => t.role === "child").length;
  return (
    <div className="flex flex-col gap-4" data-testid="reasoning-stage" data-status={reasoning.status}>
      <StoryBeat speaker="team" beats={[{ text: view.harbor?.load ? `${view.harbor.load.fullBoats} Boote voll, ${view.harbor.load.remaining} Kisten übrig, ${view.harbor.load.boatsNeeded ?? "?"} Boote für alle — gut gerechnet.` : "Gut gerechnet.", scene: "boat" }]} compact />
      <Instruction kicker="Erklären">Erzähl Nabu, wie du gerechnet hast.</Instruction>
      <p className="text-base text-tertiary">Nabu fragt dich unten rechts — du kannst sprechen oder schreiben. Nabu hört nur zu, wenn du das Mikrofon startest.</p>
      {childTurns ? <p className="text-sm text-tertiary" data-testid="reasoning-progress">Bis jetzt: {childTurns} {childTurns === 1 ? "Antwort" : "Antworten"} von dir.</p> : null}
      <div className="flex flex-wrap gap-2">
        <button ref={ref} type="button" onClick={onOpen} disabled={busy} className={primaryButton} data-testid="reasoning-open">
          {open ? "Nabu ist offen" : childTurns ? "Weiter mit Nabu" : "Mit Nabu sprechen"}
        </button>
        <button type="button" onClick={onSkip} disabled={busy} className={secondaryButton} data-testid="stage-skip">
          {view.visit?.overBudget ? "Heute überspringen (Zeit)" : "Überspringen"}
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
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useDeliberateFocus(ref, "explain", { gate });
  const modality: "typed" | "spoken" = "typed";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onSubmit(text.trim(), modality);
      }}
      className="flex flex-col gap-4"
    >
      <Instruction kicker="Erklären">Wie hast du das gerechnet?</Instruction>
      <p className="text-base text-tertiary">Ein Satz reicht. Laut erklären kannst du unten rechts bei Nabu.</p>
      <textarea ref={ref} value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={600} className={cn("rounded-2xl border-2 border-primary bg-primary px-4 py-3 text-xl text-primary", focusRing)} data-testid="explain-input" />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy || !text.trim()} className={primaryButton}>
          Speichern
        </button>
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
  const languageLabel = segment.language === "en" ? "English" : "Español";
  const inputRef = useRef<HTMLInputElement | null>(null);
  const continueRef = useRef<HTMLButtonElement | null>(null);
  const firstOptionRef = useRef<HTMLButtonElement | null>(null);
  const canAnswer = !feedback || feedback.retryAllowed;
  const focusKey = step ? `${segment.id}:${step.id}:${feedback?.triesUsed ?? 0}` : null;
  useDeliberateFocus(inputRef, step?.kind === "produce" && canAnswer ? focusKey : null, { gate, enabled: step?.kind === "produce" && canAnswer });
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
        <Instruction kicker={`${languageLabel} · ${step.kind === "produce" ? "Deine Antwort" : step.kind === "pick-supply" ? "Auswählen" : "Zuhören"}`}>{step.instruction}</Instruction>
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
          </form>
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
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useDeliberateFocus(ref, "log", { gate });
  const modality: "typed" | "spoken" = "typed";
  const captain = view.log;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onSubmit(text.trim(), modality);
      }}
      className="flex flex-col gap-4"
    >
      {captain && view.harbor ? <KeeperBeat view={view} workplace="planning" lineId="log" /> : <StoryBeat speaker="logbook" beats={[{ text: `Basis „${view.base.name}“${view.base.location ? ` · ${view.base.location.label}` : ""}`, scene: "page" }]} compact />}
      <Instruction kicker={captain ? "Kapitänslogbuch" : "Logbuch"}>{captain ? captain.prompt : "Was ist heute passiert? Ein, zwei Sätze."}</Instruction>
      {captain ? <p className="text-base text-tertiary" data-testid="log-instruction">{captain.instruction}</p> : null}
      <textarea ref={ref} value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={600} className={cn("rounded-2xl border-2 border-primary bg-primary px-4 py-3 text-xl text-primary", focusRing)} data-testid="log-input" />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy || !text.trim()} className={primaryButton} data-testid="log-save">
          {captain ? "Ins Logbuch eintragen" : "Seite speichern"}
        </button>
      </div>
    </form>
  );
}
