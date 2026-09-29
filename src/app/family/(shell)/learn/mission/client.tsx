"use client";

// ---------------------------------------------------------------------------
// The mission workspace — /family/learn/mission (family-assistant DESIGN §7.6).
//
// Scene central, tutor panel collapsible beside it. The child names and
// places the base, shares supplies (typed number = unaided; moving counters =
// supported, recorded as such), explains a decision, completes one language
// scene, types a label, saves the expedition log and reflects.
//
// Truthfulness rules implemented here (CONTRACT.md; independent review 2026-09-28):
//  - every confirmed step is a server mutation with an idempotency key and the
//    LATEST revision this client holds (a ref, never a stale closure); the
//    server settles duplicates and stale tabs and always returns the view to
//    render next;
//  - help is recorded durably BEFORE it is shown or played: read-aloud, a
//    gloss, the counters, the word-choice list, a tutor question. "Recorded"
//    means the server answered applied or replayed — a stale or refused
//    answer never counts, and the help is then not shown;
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/components/ui/nabu";
import { useChildShell } from "@/components/family/child-shell-provider";
import { BaseScene } from "@/components/family/learning/base-scene";
import { createChildTurnClient } from "@/lib/family-assistant-client";
import { envelopeSpokenText, type ChildId } from "@/lib/family-assistant-turn";
import { createLearningClient, type LearningMutateOutcome } from "@/lib/family-learning-client";
import { stageLabel, type ChildView, type LearningOp, type SupportKind } from "@/lib/family-learning-state";
import { createReadAloudController } from "@/lib/family-learning-audio";
import { ExpeditionNotPrepared } from "@/components/family/learning/not-prepared";
import { recordSupportConfirmed, runTutorTurn, type SupportOutcome } from "@/lib/family-learning-tutor";
import { applySaveOutcome, commitLine, createTypingDraft, lessonPayload, markSaving, previewLine, typeInto, type TypingDraft } from "@/lib/family-learning-typing";
import { createChildSpeechPlayer, type ChildSpeechPlayer } from "@/lib/family-speech";
import { checkChildUtterance, startPushToTalk, type RecorderControl, type RecorderHandlers } from "@/lib/family-voice";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500";
const primaryButton = cn(
  "inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-stone-900 px-6 text-lg font-semibold text-white shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900",
  focusRing,
);
const secondaryButton = cn(
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-primary bg-primary px-5 text-base font-medium text-primary transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50",
  focusRing,
);
const chipButton = cn(
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-primary bg-primary px-4 text-lg font-medium text-primary transition-colors hover:bg-secondary disabled:opacity-50",
  focusRing,
);
const TRANSCRIBE_PATH = "/api/family/transcribe";
const TUTOR_SESSION_SUFFIX = "learn";
const SLOW_RATE = 0.75;

type Load = { kind: "loading" } | { kind: "ready"; view: ChildView } | { kind: "unprepared" } | { kind: "trouble"; message: string };

/** Text shown when audio could not be fetched or played; the text stays readable and the controls usable. */
const AUDIO_UNAVAILABLE = "Vorlesen geht gerade nicht. Du kannst den Text lesen oder es gleich nochmal versuchen.";

/** Records one support op; true only when the server confirmed it (applied/replayed). */
type SupportFn = (kind: SupportKind, taskId: string | null, payload?: unknown) => Promise<boolean>;

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

function Workspace({ child }: { child: ChildId }) {
  const learning = useMemo(() => createLearningClient(), []);
  const tutorClient = useMemo(() => createChildTurnClient(), []);
  const speech = useMemo(() => createChildSpeechPlayer(), []);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [tutorOpen, setTutorOpen] = useState(false);
  const aliveRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  /** The latest rendered view — the only source of `expectedRevision`. */
  const viewRef = useRef<ChildView | null>(null);

  const adopt = useCallback((view: ChildView) => {
    viewRef.current = view;
    setLoad({ kind: "ready", view });
  }, []);

  const refresh = useCallback(async () => {
    const abort = new AbortController();
    abortRef.current = abort;
    const outcome = await learning.read(child, { signal: abort.signal });
    if (!aliveRef.current) return;
    if (outcome.ok) {
      adopt(outcome.view);
      return;
    }
    // No mission prepared for this child — the server SAID so (404, or a
    // 200 with prepared:false): the same honest state as the cockpit. A
    // malformed success is a load error below, never evidence of absence.
    if (outcome.status === 404 || outcome.failure === "unprepared") {
      viewRef.current = null;
      setLoad({ kind: "unprepared" });
      return;
    }
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
    };
  }, [refresh, learning, tutorClient, speech]);

  /** One confirmed step, always at the latest revision. */
  const mutate = useCallback(
    async (op: LearningOp, options?: { idempotencyKey?: string }): Promise<LearningMutateOutcome | null> => {
      const current = viewRef.current;
      if (!current) return null;
      setBusy(true);
      setNotice(null);
      const abort = new AbortController();
      abortRef.current = abort;
      const outcome = await learning.mutate(child, op, current.revision, { signal: abort.signal, idempotencyKey: options?.idempotencyKey });
      if (!aliveRef.current) return null;
      setBusy(false);
      if (outcome.ok) {
        adopt(outcome.view);
        if (outcome.status === "stale") setNotice("Da war schon ein neuerer Stand — ich zeige dir den aktuellen.");
        return outcome;
      }
      if ("status" in outcome && outcome.status === "refused") {
        adopt(outcome.view);
        setNotice(outcome.code === "not-available" ? "Das ist gerade noch nicht verfügbar." : "Das ging so nicht. Schau nochmal.");
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

  if (load.kind === "loading") {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <p className="text-base text-tertiary" role="status">
          Expedition wird geladen …
        </p>
      </div>
    );
  }
  if (load.kind === "unprepared") {
    return <ExpeditionNotPrepared child={child} />;
  }
  if (load.kind === "trouble") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <Link href={`/family/learn?child=${child}`} className={secondaryButton}>
          ← Zurück
        </Link>
        <p className="mt-6 text-lg text-primary" role="status">
          {load.message}
        </p>
      </div>
    );
  }

  const view = load.view;
  if (!view.visit) {
    return <StartOrWait child={child} view={view} busy={busy} onStart={() => void mutate({ op: "start-visit" })} notice={notice} />;
  }

  const stage = view.visit.stage;
  const optionalReason = view.visit.overBudget ? "time" : "child";

  return (
    <div className="mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/family/learn?child=${child}`} className={secondaryButton} aria-label="Stopp und speichern">
          ■ Stopp
        </Link>
        <div className="min-w-0 text-center">
          <p className="truncate text-sm font-medium text-tertiary">{view.visit.title}</p>
          <p className="truncate text-xs text-tertiary">
            {stage ? stageLabel(stage) : ""} · {view.visit.minutesElapsed} min
          </p>
        </div>
        <button type="button" onClick={() => setTutorOpen((v) => !v)} className={secondaryButton} aria-expanded={tutorOpen} aria-controls="tutor-panel">
          💬 Tutor
        </button>
      </header>

      {notice ? (
        <p className="mt-3 rounded-2xl bg-secondary px-4 py-2 text-base text-primary" role="status">
          {notice}
        </p>
      ) : null}

      <div className={cn("mt-4 grid gap-4", tutorOpen && "lg:grid-cols-[minmax(0,1fr)_360px]")}>
        <main className="min-w-0 overflow-hidden rounded-3xl border border-primary bg-primary shadow-xs dark:shadow-none">
          <BaseScene base={view.base} locations={view.locations} />
          <div className="p-4 sm:p-6">
            {stage === "name-base" ? <NameBase busy={busy} onSubmit={(name) => void mutate({ op: "name-base", name })} /> : null}
            {stage === "place-base" ? <PlaceBase view={view} busy={busy} onSubmit={(locationId) => void mutate({ op: "place-base", locationId })} /> : null}
            {stage === "restore" ? <Restore view={view} busy={busy} onContinue={() => void mutate({ op: "resume-base" })} /> : null}
            {view.math ? (
              <MathItem
                key={view.math.id}
                child={child}
                view={view}
                busy={busy}
                speech={speech}
                support={support}
                onAnswer={(answer, raw, modality, uncertain) => void mutate({ op: "answer-math", itemId: view.math!.id, answer, raw, modality, uncertain })}
                onContinue={() => void mutate({ op: "continue-item", itemId: view.math!.id })}
                onTeach={() => void mutate({ op: "request-teaching", itemId: view.math!.id })}
                onStop={() => void mutate({ op: "stop-item", itemId: view.math!.id })}
              />
            ) : null}
            {stage === "explain" ? (
              <Explain
                busy={busy}
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
                onLesson={(op, idempotencyKey) => mutate(op, { idempotencyKey })}
                onLabel={(taskId, typed, seconds) => void mutate({ op: "typing-label", taskId, typed, seconds })}
                onSkip={() => void mutate({ op: "skip-stage", stage: "typing", reason: optionalReason })}
              />
            ) : null}
            {stage === "log" ? <SaveLog view={view} busy={busy} onSubmit={(text, modality) => void mutate({ op: "save-log", text, modality })} /> : null}
            {stage === "reflect" && view.reflection ? (
              <Reflect prompt={view.reflection.prompt} options={view.reflection.options} busy={busy} onSubmit={(optionId) => void mutate({ op: "reflect", optionId })} />
            ) : null}
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

function AudioControls({
  child,
  speech,
  text,
  label,
  disabled,
  beforePlay,
}: {
  child: ChildId;
  speech: ChildSpeechPlayer;
  text: string;
  label: string;
  disabled: boolean;
  /** Records the read-aloud support; playing happens only when it returns true. */
  beforePlay: () => Promise<boolean>;
}) {
  const [playing, setPlaying] = useState(false);
  const [recorded, setRecorded] = useState(false);
  // Set only when the controller reported "unavailable" for the CURRENT
  // request; cleared when a new request starts. Stop/dispose/superseded never
  // show it (a stale failure must not appear for a control that moved on).
  const [unavailable, setUnavailable] = useState(false);
  const beforePlayRef = useRef(beforePlay);
  beforePlayRef.current = beforePlay;
  // One controller per mounted control (the parent keys controls by text and
  // task). Unmount disposes it, so a support acknowledgement that arrives after
  // the control was removed — task change, selected-word change — can never
  // start old audio; stop() invalidates a pending acknowledgement the same way.
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
    // "superseded": this control's own stop() or a newer request on it already
    // owns the state (an older request never clears a newer one). "disposed":
    // unmounted. Everything else — played, unavailable, not-recorded, or
    // "interrupted" by another speaker (e.g. the tutor reading its reply) —
    // is the current request settling, so the control returns to idle.
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
// Start / wait
// ---------------------------------------------------------------------------

function StartOrWait({ child, view, busy, onStart, notice }: { child: ChildId; view: ChildView; busy: boolean; onStart: () => void; notice: string | null }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link href={`/family/learn?child=${child}`} className={secondaryButton}>
        ← Zurück
      </Link>
      <div className="mt-6 overflow-hidden rounded-3xl border border-primary bg-primary">
        <BaseScene base={view.base} locations={view.locations} />
        <div className="p-6 text-center">
          <h1 className="text-2xl font-semibold text-primary">{view.title}</h1>
          <p className="mt-2 text-base text-tertiary">{view.nextStep}</p>
          {notice ? <p className="mt-2 text-base text-primary">{notice}</p> : null}
          {view.next.visit ? (
            <button type="button" onClick={onStart} disabled={busy} className={cn(primaryButton, "mt-5")}>
              {view.next.visit === "v1" ? "Los geht's" : "Weiter geht's"}
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

function NameBase({ busy, onSubmit }: { busy: boolean; onSubmit: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSubmit(name.trim());
      }}
      className="flex flex-col gap-4"
    >
      <h2 className="text-2xl font-semibold text-primary">Lass uns eine Basis bauen.</h2>
      <p className="text-base text-tertiary">Du entscheidest, wo sie steht. Zuerst: Wie soll sie heissen?</p>
      <label className="text-base font-medium text-primary" htmlFor="base-name">
        Name der Basis
      </label>
      <input id="base-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="off" className={cn("min-h-14 rounded-2xl border border-primary bg-primary px-4 text-xl text-primary", focusRing)} />
      <button type="submit" disabled={busy || !name.trim()} className={primaryButton}>
        Weiter
      </button>
    </form>
  );
}

function PlaceBase({ view, busy, onSubmit }: { view: ChildView; busy: boolean; onSubmit: (locationId: string) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold text-primary">Wo steht „{view.base.name}“?</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {view.locations.map((location) => (
          <button key={location.id} type="button" disabled={busy} onClick={() => onSubmit(location.id)} className={cn(chipButton, "min-h-20 justify-start")}>
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

function Restore({ view, busy, onContinue }: { view: ChildView; busy: boolean; onContinue: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold text-primary">Willkommen zurück auf „{view.base.name}“.</h2>
      <p className="text-base text-tertiary">Deine Vorräte sind noch da. Heute geht die Expedition weiter.</p>
      <button type="button" onClick={onContinue} disabled={busy} className={primaryButton}>
        Weiter
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Math item: typed answer (unaided) or counters (supported), teaching phases
// ---------------------------------------------------------------------------

function MathItem({
  child,
  view,
  busy,
  speech,
  support,
  onAnswer,
  onContinue,
  onTeach,
  onStop,
}: {
  child: ChildId;
  view: ChildView;
  busy: boolean;
  speech: ChildSpeechPlayer;
  support: SupportFn;
  onAnswer: (answer: number | null, raw: string, modality: "typed" | "counters" | "spoken", uncertain?: boolean) => void;
  onContinue: () => void;
  onTeach: () => void;
  onStop: () => void;
}) {
  const item = view.math!;
  const [raw, setRaw] = useState("");
  const [countersOpen, setCountersOpen] = useState(false);
  const [trays, setTrays] = useState<number[]>(() => Array.from({ length: item.groups }, () => 0));
  const [spoken, setSpoken] = useState<{ transcript: string; number: number | null } | null>(null);
  const placed = trays.reduce((a, b) => a + b, 0);
  const remaining = item.quantity - placed;
  const canAnswer = item.phase === "answer" || item.phase === "clarify" || item.phase === "represent";

  useEffect(() => {
    // The representation phase IS the counters (the tutor's move, already
    // recorded server-side as support for this item).
    if (item.phase === "represent") setCountersOpen(true);
  }, [item.phase]);

  const openCounters = async () => {
    // Recorded first; shown only when the server confirmed the support.
    if (await support("counters", item.id)) setCountersOpen(true);
  };

  const moveToTray = (index: number, delta: number) => {
    setTrays((current) => {
      const next = [...current];
      const value = next[index] + delta;
      if (value < 0) return current;
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
        <h2 className="text-2xl font-semibold text-primary">{item.scene ?? "Erledigt."}</h2>
        {item.taughtAnswer !== null ? (
          <p className="text-base text-primary">
            Wir haben es zusammen gemacht: {item.quantity} {item.unit.plural} ÷ {item.groups} = {item.taughtAnswer} pro {item.group.singular}.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm text-tertiary">{item.scene}</p>
        <h2 className="mt-1 text-2xl font-semibold leading-snug text-primary">{item.prompt}</h2>
      </div>
      <div className="flex flex-wrap gap-2">
        <AudioControls child={child} speech={speech} text={item.prompt} label="Vorlesen" disabled={busy} beforePlay={() => support("read_aloud", item.id, { text: "prompt" })} />
        {!countersOpen && canAnswer ? (
          <button type="button" onClick={() => void openCounters()} className={secondaryButton} disabled={busy}>
            🥫 Mit Päckchen legen
          </button>
        ) : null}
      </div>

      {item.phase === "clarify" && item.clarification ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-base text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">{item.clarification}</p>
      ) : null}

      {item.phase === "example" && item.example ? (
        <div className="rounded-2xl bg-secondary p-4">
          <p className="text-base font-semibold text-primary">{item.example.prompt}</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-base text-primary">
            {item.example.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <button type="button" onClick={onContinue} disabled={busy} className={cn(primaryButton, "mt-4")}>
            Jetzt nochmal probieren
          </button>
        </div>
      ) : null}

      {item.teachingOffered ? (
        <div className="rounded-2xl bg-secondary p-4">
          <p className="text-base text-primary">
            {item.phase === "teach-or-stop" ? "Das war knifflig. Sollen wir es zusammen lösen, oder machst du hier Pause?" : "Du kannst es noch einmal probieren — oder wir lösen es zusammen."}
          </p>
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
          <p className="text-base text-primary">{item.representation ?? "Lege die Päckchen in die Fächer."}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-base font-medium text-primary">Übrig: {remaining}</span>
            <span
              draggable={remaining > 0}
              onDragStart={(e) => e.dataTransfer.setData("text/plain", "1")}
              className={cn("inline-flex min-h-12 min-w-12 cursor-grab items-center justify-center rounded-xl bg-primary text-3xl shadow-xs", remaining === 0 && "opacity-40")}
              aria-label={`${item.unit.singular} ziehen`}
            >
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
          <button
            type="button"
            disabled={busy || remaining !== 0 || trays.some((t) => t !== trays[0])}
            onClick={() => onAnswer(trays[0], String(trays[0]), "counters")}
            className={cn(primaryButton, "mt-4")}
          >
            Jede Person bekommt {trays[0]} — fertig
          </button>
          {remaining === 0 && trays.some((t) => t !== trays[0]) ? <p className="mt-2 text-sm text-tertiary">Noch nicht überall gleich viele.</p> : null}
        </div>
      ) : null}

      {canAnswer ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const n = parseAnswerNumber(raw);
            if (n === null) return;
            onAnswer(n, raw.trim(), "typed");
            setRaw("");
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <label className="flex flex-col gap-1 text-base font-medium text-primary">
            Antwort
            <input inputMode="numeric" pattern="[0-9]*" value={raw} onChange={(e) => setRaw(e.target.value)} className={cn("min-h-14 w-32 rounded-2xl border border-primary bg-primary px-4 text-2xl text-primary", focusRing)} aria-describedby="answer-help" />
          </label>
          <span id="answer-help" className="sr-only">
            Zahl eingeben und bestätigen
          </span>
          <button type="submit" disabled={busy || parseAnswerNumber(raw) === null} className={primaryButton}>
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
                  onAnswer(spoken.number, spoken.transcript, "spoken");
                  setSpoken(null);
                }}
                className={primaryButton}
              >
                Ja, {spoken.number}
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
                  onAnswer(null, spoken.transcript, "spoken", true);
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

function Explain({ busy, overBudget, onSubmit, onSkip }: { busy: boolean; overBudget: boolean; onSubmit: (text: string, modality: "typed" | "spoken") => void; onSkip: () => void }) {
  const [text, setText] = useState("");
  const [spokenText, setSpokenText] = useState<string | null>(null);
  const modality: "typed" | "spoken" = spokenText !== null && text === spokenText ? "spoken" : "typed";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onSubmit(text.trim(), modality);
      }}
      className="flex flex-col gap-4"
    >
      <h2 className="text-2xl font-semibold text-primary">Wie hast du das gerechnet?</h2>
      <p className="text-base text-tertiary">Ein Satz reicht. Du kannst schreiben oder sprechen.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={600} className={cn("rounded-2xl border border-primary bg-primary px-4 py-3 text-lg text-primary", focusRing)} />
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
        <button type="button" onClick={onSkip} disabled={busy} className={secondaryButton}>
          {overBudget ? "Heute überspringen (Zeit)" : "Überspringen"}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Language segment
// ---------------------------------------------------------------------------

function LanguageSegment({
  child,
  view,
  busy,
  speech,
  support,
  onStep,
  onContinue,
  onSkip,
}: {
  child: ChildId;
  view: ChildView;
  busy: boolean;
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

  const openGloss = async (word: string) => {
    if (glossOpen === word) {
      setGlossOpen(null);
      return;
    }
    // Recorded first (durable per segment); shown only when confirmed.
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
  // Feedback is bounded and reviewed (content), neutral about plausible wording;
  // after the retry allowance only the explicit continuation remains.
  const canAnswer = !feedback || feedback.retryAllowed;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-tertiary">
            {languageLabel} · {segment.title}
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-primary">{step.instruction}</h2>
        </div>
        <span className="text-sm text-tertiary">
          {segment.stepIndex + 1}/{segment.stepCount}
        </span>
      </div>

      {sentence ? (
        <div className="rounded-2xl bg-secondary p-4">
          <p className="flex flex-wrap gap-x-2 gap-y-1 text-2xl leading-relaxed text-primary" lang={segment.language}>
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
                  className={cn("rounded-lg px-1", focusRing, gloss && "underline decoration-dotted underline-offset-4", selected && "bg-primary ring-2 ring-stone-400")}
                  aria-pressed={selected}
                >
                  {word}
                </button>
              );
            })}
          </p>
          {glossOpen ? (
            <p className="mt-2 rounded-xl bg-primary px-3 py-2 text-base text-primary" lang="de">
              <strong>{glossOpen}</strong> = {glossFor(glossOpen)?.de}. {glossFor(glossOpen)?.example}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <AudioControls key={`sentence:${step.id}`} child={child} speech={speech} text={sentence} label="Satz anhören" disabled={busy} beforePlay={() => support("read_aloud", segment.id, { text: sentence, language: segment.language })} />
            {selectedWord ? (
              <AudioControls key={`word:${step.id}:${selectedWord}`} child={child} speech={speech} text={selectedWord} label={`„${selectedWord}“ anhören`} disabled={busy} beforePlay={() => support("read_aloud", segment.id, { text: selectedWord, word: selectedWord, language: segment.language })} />
            ) : null}
          </div>
          <p className="mt-2 text-sm text-tertiary">Tippe auf ein Wort, um es zu hören; unterstrichene Wörter zeigen die Bedeutung.</p>
        </div>
      ) : null}

      {feedback ? (
        <div
          role="status"
          className={cn(
            "rounded-2xl px-4 py-3 text-base",
            feedback.kind === "incorrect" ? "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100" : "bg-secondary text-primary",
          )}
        >
          <p>{feedback.message}</p>
          <p className="mt-1 text-sm text-tertiary">
            {feedback.kind === "incorrect" ? "Das wurde als „nicht richtig“ gespeichert." : "Deine Antwort ist gespeichert, aber nicht bewertet."}
            {feedback.retryAllowed ? " Du kannst es noch einmal versuchen." : " Ein weiterer Versuch ist hier nicht mehr möglich."}
          </p>
          {feedback.continueOffered ? (
            <button type="button" disabled={busy} onClick={() => onContinue(step.id)} className={cn(secondaryButton, "mt-2")}>
              Weiter ohne Bewertung
            </button>
          ) : null}
        </div>
      ) : null}

      {step.kind === "listen-read" ? (
        <button type="button" disabled={busy} onClick={() => onStep(step.id, "", "listen")} className={primaryButton}>
          Verstanden — weiter
        </button>
      ) : null}

      {step.kind === "pick-supply" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {step.options.map((option) => (
            <button key={option.id} type="button" disabled={busy} onClick={() => onStep(step.id, option.id, "word-choice")} className={cn(chipButton, "min-h-24 flex-col")}>
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
          <p className="text-xl text-primary" lang={segment.language}>
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
                // Text assembled from the word list is copying, and is sent as such.
                onStep(step.id, typed.trim(), choicesOpen ? "word-choice" : "typed");
                setTyped("");
              }}
              className="flex flex-wrap items-end gap-2"
            >
              <input value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={200} lang={segment.language} className={cn("min-h-14 min-w-0 flex-1 rounded-2xl border border-primary bg-primary px-4 text-xl text-primary", focusRing)} aria-label="Antwort" />
              <button type="submit" disabled={busy || !typed.trim()} className={primaryButton}>
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

      <button type="button" onClick={onSkip} disabled={busy} className={cn(secondaryButton, "self-start")}>
        {view.visit?.overBudget ? "Heute überspringen (Zeit)" : "Überspringen"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Typing: home-row lesson (only with a confirmed layout) + a useful label
// ---------------------------------------------------------------------------

function TypingSegment({
  view,
  busy,
  onLesson,
  onLabel,
  onSkip,
}: {
  view: ChildView;
  busy: boolean;
  /** Sends the completed lesson; the same key is reused on every retry. */
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
  const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}`);

  const lessonSaved = draft?.phase === "saved" || lessonDoneOnServer;
  const showLesson = typing.available && !lessonSaved && !skippedLesson && draft !== null;
  const saving = draft?.phase === "saving";

  /** Save (or retry) the completed lesson with its one payload and key. */
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

  // Completing the last line triggers exactly one save; retries are explicit.
  useEffect(() => {
    if (draft?.phase === "completed" && draft.failure === null) void save();
  }, [draft?.phase, draft?.failure, save]);

  const currentLine = draft && typing.available ? typing.lesson.lines[draft.lineIndex] ?? null : null;

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold text-primary">Tippen</h2>
      {showLesson && typing.available && draft ? (
        <div className="rounded-2xl bg-secondary p-4">
          <p className="text-base font-medium text-primary">{typing.lesson.title}</p>
          <p className="mt-1 text-sm text-tertiary">Finger auf die Grundstellung. Langsam und genau ist besser als schnell.</p>
          {draft.phase === "typing" && currentLine ? (
            <>
              <div className="mt-3 flex flex-wrap gap-1" aria-label="Grundstellung">
                {typing.lesson.homeRow.map((key) => (
                  <span key={key} className={cn("flex min-w-12 flex-col items-center rounded-lg border border-primary bg-primary px-2 py-1", currentLine[draft.current.length] === key && "ring-2 ring-stone-500")}>
                    <span className="text-lg font-semibold text-primary">{key}</span>
                    <span className="text-[10px] text-tertiary">{typing.lesson.fingers[key]?.replace("Finger ", "").replace("kleiner", "klein")}</span>
                  </span>
                ))}
              </div>
              <p className="mt-3 font-mono text-2xl tracking-widest text-primary" aria-label="Zeile zum Abtippen">
                {Array.from(currentLine).map((ch, i) => (
                  <span key={i} className={cn(i < draft.current.length && (draft.current[i] === ch ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300"), i === draft.current.length && "underline")}>
                    {ch === " " ? "␣" : ch}
                  </span>
                ))}
              </p>
              <input
                value={draft.current}
                onChange={(e) => setDraft((d) => (d ? typeInto(d, e.target.value, Date.now()) : d))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commit();
                  }
                }}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className={cn("mt-2 min-h-14 w-full rounded-2xl border border-primary bg-primary px-4 font-mono text-2xl text-primary", focusRing)}
                aria-label="Hier tippen"
              />
              <div className="mt-3 flex flex-wrap gap-2">
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
            <div className="mt-3">
              <ul className="space-y-1 font-mono text-sm text-primary">
                {typing.lesson.lines.map((line, i) => {
                  const m = previewLine(line, draft.typedLines[i] ?? "");
                  return (
                    <li key={line}>
                      {line} — {m.correct}/{Array.from(line).length} richtig{m.extra ? `, ${m.extra} zu viel` : ""}{m.omitted ? `, ${m.omitted} fehlen` : ""}
                    </li>
                  );
                })}
              </ul>
              {saving ? <p className="mt-2 text-sm text-tertiary" role="status">… wird gespeichert</p> : null}
              {draft.failure ? (
                <div className="mt-2 flex flex-wrap items-center gap-2" role="status">
                  <span className="text-sm text-primary">
                    {draft.failure === "refused" ? "Das konnte so nicht gespeichert werden." : "Speichern hat nicht geklappt. Dein Training ist noch da."}
                  </span>
                  {draft.failure !== "refused" ? (
                    <button type="button" disabled={busy} onClick={() => void save()} className={secondaryButton}>
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
        </div>
      ) : null}

      {!typing.available ? (
        <p className="rounded-2xl bg-secondary px-4 py-3 text-base text-primary">
          Das Finger-Training kommt, sobald deine Eltern die Tastatur bestätigt haben. Das Schild kannst du trotzdem schreiben.
        </p>
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
          <p className="text-lg text-primary">{typing.label.instruction}</p>
          <p className="font-mono text-2xl text-primary" aria-label="Vorlage">
            {typing.label.target}
          </p>
          <input
            value={labelTyped}
            onChange={(e) => {
              if (labelStartRef.current === null) labelStartRef.current = Date.now();
              setLabelTyped(e.target.value.slice(0, 80));
            }}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className={cn("min-h-14 rounded-2xl border border-primary bg-primary px-4 font-mono text-2xl text-primary", focusRing)}
            aria-label="Schild tippen"
          />
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || labelTyped.length === 0} className={primaryButton}>
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
// Log + reflection
// ---------------------------------------------------------------------------

function SaveLog({ view, busy, onSubmit }: { view: ChildView; busy: boolean; onSubmit: (text: string, modality: "typed" | "spoken") => void }) {
  const [text, setText] = useState("");
  const [spokenText, setSpokenText] = useState<string | null>(null);
  const modality: "typed" | "spoken" = spokenText !== null && text === spokenText ? "spoken" : "typed";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onSubmit(text.trim(), modality);
      }}
      className="flex flex-col gap-4"
    >
      <h2 className="text-2xl font-semibold text-primary">Deine Expeditionsseite</h2>
      <p className="text-base text-tertiary">
        Basis „{view.base.name}“ {view.base.location ? `· ${view.base.location.label}` : ""}. Was ist heute passiert? Ein, zwei Sätze für deine Eltern.
      </p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={600} className={cn("rounded-2xl border border-primary bg-primary px-4 py-3 text-lg text-primary", focusRing)} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy || !text.trim()} className={primaryButton}>
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

function Reflect({ prompt, options, busy, onSubmit }: { prompt: string; options: { id: string; label: string }[]; busy: boolean; onSubmit: (optionId: string) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold text-primary">{prompt}</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {options.map((option) => (
          <button key={option.id} type="button" disabled={busy} onClick={() => onSubmit(option.id)} className={cn(chipButton, "min-h-16")}>
            {option.label}
          </button>
        ))}
      </div>
      <p className="text-sm text-tertiary">Danach ist der Besuch fertig. Deine Seite ist gespeichert.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tutor panel: typed or spoken question → bridge, sequenced by the runner
// ---------------------------------------------------------------------------

function TutorPanel({
  child,
  view,
  speech,
  tutorClient,
  recordSupport,
  currentRevision,
  isAlive,
  onClose,
}: {
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
  useEffect(() => {
    panelAlive.current = true;
    return () => {
      panelAlive.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const ask = async (text: string) => {
    const check = checkChildUtterance(text);
    if (!check.ok) return;
    // The context is captured NOW, so a reply binds to the task the child
    // asked about even if the workspace advances meanwhile.
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
        // Persisted and classified before this line runs.
        setThread((t) => [...t, { role: "tutor", text: result.text }]);
        speech.unlock();
        // Read the reply aloud; if speech cannot be fetched or played, say so
        // (the reply text stays readable above). A cancelled/superseded speech
        // is not a failure and shows nothing.
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
    <aside id="tutor-panel" className="flex max-h-[70vh] flex-col rounded-3xl border border-primary bg-primary p-4 shadow-xs dark:shadow-none lg:max-h-none" aria-label="Tutor">
      <div className="flex items-center justify-between">
        <p className="text-base font-semibold text-primary">Tutor</p>
        <button type="button" onClick={onClose} className={cn("min-h-12 min-w-12 rounded-full text-xl", focusRing)} aria-label="Tutor schliessen">
          ×
        </button>
      </div>
      {view.tutor ? <p className="mt-1 text-sm text-tertiary">Zur Aufgabe: „{view.tutor.prompt}“</p> : <p className="mt-1 text-sm text-tertiary">Frag, was du willst.</p>}
      <div className="mt-3 flex-1 space-y-2 overflow-y-auto" aria-live="polite">
        {thread.map((entry, index) => (
          <p
            key={index}
            className={cn(
              "rounded-2xl px-3 py-2 text-base",
              entry.role === "child" && "bg-secondary text-primary",
              entry.role === "tutor" && "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900",
              entry.role === "note" && "border border-primary text-tertiary",
            )}
          >
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
          <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={1500} placeholder="Was heisst …? Warum …?" className={cn("min-h-14 rounded-2xl border border-primary bg-primary px-4 text-lg text-primary", focusRing)} aria-label="Frage an den Tutor" />
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
