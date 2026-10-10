"use client";

// ---------------------------------------------------------------------------
// The Nabu sidebar (Visit 5, 2026-10-10; family-assistant DESIGN §7.6
// "Visit 5 — the harbor", feedback group F4).
//
// One persistent bottom-right bubble on the learning pages. Open, it is a side
// pane on wide screens (the task stays visible) and a bottom sheet on narrow
// ones. Two modes, both bound to the SERVER view:
//
//  - reasoning: after the harbor item the server runs the reviewed probe
//    script (`reasoning-turn` / `reasoning-choice`); the thread shown here IS
//    the server's record, Nabu's lines are spoken through the existing child
//    TTS route, and the child answers by explicit push-to-talk (visible start,
//    stop, confirmed transcript) or by typing. Nothing is scored here.
//  - free: a question goes to the isolated child assistant (existing bridge
//    transport) with the server-built context block (page, task, the child's
//    own work, island state, objective, prior attempts, open focus) prepended
//    by `runTutorTurn`; the question is recorded as support BEFORE dispatch
//    and the reply classified BEFORE it is shown (unchanged contract).
//
// Stale turns are cancelled: the sidebar aborts in-flight work when the
// child or the task binding changes, and a reply that arrives for an older
// binding is withheld with a short note. No silent or background listening;
// the recording is transient and never stored (family-voice contract).
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/components/ui/nabu";
import { createChildTurnClient } from "@/lib/family-assistant-client";
import { envelopeSpokenText, type ChildId } from "@/lib/family-assistant-turn";
import type { LearningMutateOutcome } from "@/lib/family-learning-client";
import type { ChildView, LearningOp } from "@/lib/family-learning-state";
import { recordSupportConfirmed, runTutorTurn, type SupportOutcome } from "@/lib/family-learning-tutor";
import type { ChildSpeechPlayer } from "@/lib/family-speech";
import { checkChildUtterance, startPushToTalk, type RecorderControl, type RecorderHandlers } from "@/lib/family-voice";
import { focusRing, primaryButton, secondaryButton } from "@/app/family/(shell)/learn/mission/styles";
import { isComposing } from "./focus";

const TRANSCRIBE_PATH = "/api/family/transcribe";
const TUTOR_SESSION_SUFFIX = "learn";

export type NabuSidebarProps = {
  child: ChildId;
  view: ChildView;
  page: "map" | "mission";
  speech: ChildSpeechPlayer;
  /** Free questions (bridge). Omit on surfaces without a tutor client. */
  tutorClient?: ReturnType<typeof createChildTurnClient> | null;
  recordSupport?: (op: LearningOp & { op: "support" }, expectedRevision: number) => Promise<{ outcome: SupportOutcome; revision: number }>;
  currentRevision?: () => number;
  isAlive?: () => boolean;
  /** Reasoning conversation ops (mission page only). */
  onReasoningTurn?: (text: string, modality: "typed" | "spoken") => Promise<LearningMutateOutcome | null>;
  onReasoningChoice?: (choice: "counters" | "teach" | "continue") => Promise<LearningMutateOutcome | null>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when the reasoning conversation is finished and the child taps "Weiter". */
  onReasoningDone?: () => void;
  busy?: boolean;
};

type Entry = { role: "child" | "nabu" | "note"; text: string; modality?: "typed" | "spoken"; key: string };
/** The finished conversation, kept on the client until the child taps "Weiter" (the server moved the stage on in the same write). */
type Finished = { turns: Entry[]; method: string; methodLabel: string };

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

/** The binding a turn belongs to: child, page, task, stage — a reply for another binding is stale. */
function bindingOf(child: ChildId, page: string, view: ChildView): string {
  return `${child}:${page}:${view.visit?.id ?? "none"}:${view.visit?.stage ?? "none"}:${view.tutor?.taskId ?? "none"}:${view.reasoning?.itemId ?? ""}`;
}

/** Explicit push-to-talk: a visible start, a stop while live, a transcribing state and a typed fallback. Nothing starts on its own. */
export function PushToTalk({ disabled, onTranscript, onStateChange, label = "🎙️ Sprechen" }: { disabled: boolean; onTranscript: (transcript: string) => void; onStateChange?: (state: "idle" | "starting" | "live" | "transcribing" | "trouble") => void; label?: string }) {
  const [mic, setMicState] = useState<"idle" | "starting" | "live" | "transcribing" | "trouble">("idle");
  const setMic = useCallback(
    (s: typeof mic) => {
      setMicState(s);
      onStateChange?.(s);
    },
    [onStateChange],
  );
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
  const cancel = () => {
    seqRef.current += 1;
    sessionRef.current?.cancel();
    sessionRef.current = null;
    setMic("idle");
  };
  if (mic === "live" || mic === "starting") {
    return (
      <span className="inline-flex flex-wrap gap-2">
        <button type="button" onClick={stop} className={cn(primaryButton, "bg-red-700 dark:bg-red-300")} aria-live="polite" data-testid="mic-stop">
          {mic === "live" ? "■ Stopp (ich höre zu)" : "… Mikrofon startet"}
        </button>
        <button type="button" onClick={cancel} className={secondaryButton} data-testid="mic-cancel">
          Abbrechen
        </button>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" onClick={start} disabled={disabled || mic === "transcribing"} className={secondaryButton} data-testid="mic-start" data-mic={mic}>
        {mic === "transcribing" ? "… ich schreibe mit" : label}
      </button>
      {mic === "trouble" ? (
        <span className="text-sm text-tertiary" role="status" data-testid="mic-trouble">
          Mikrofon geht gerade nicht — tippen klappt.
        </span>
      ) : null}
    </span>
  );
}

export function NabuSidebar({ child, view, page, speech, tutorClient = null, recordSupport, currentRevision, isAlive, onReasoningTurn, onReasoningChoice, open, onOpenChange, onReasoningDone, busy = false }: NabuSidebarProps) {
  const reasoning = view.reasoning;
  const mode: "reasoning" | "free" = reasoning && page === "mission" ? "reasoning" : "free";
  const binding = bindingOf(child, page, view);
  const [freeThread, setFreeThread] = useState<Entry[]>([]);
  const [pendingChild, setPendingChild] = useState<string | null>(null);
  const [pendingTranscript, setPendingTranscript] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [speechNote, setSpeechNote] = useState<string | null>(null);
  const [finished, setFinished] = useState<Finished | null>(null);
  const finishedRef = useRef<Finished | null>(null);
  finishedRef.current = finished;
  const abortRef = useRef<AbortController | null>(null);
  const bindingRef = useRef(binding);
  const aliveRef = useRef(true);
  const spokenRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // A binding change (child, page, task, stage) cancels in-flight work and clears the free thread; the reasoning thread is the server's.
  useEffect(() => {
    if (bindingRef.current !== binding) {
      abortRef.current?.abort();
      abortRef.current = null;
      bindingRef.current = binding;
      setPendingChild(null);
      setPendingTranscript(null);
      setSending(false);
      // A finished conversation is shown until the child moves on; its stage change is expected, not a stale turn.
      if (!finishedRef.current) {
        setFreeThread((t) => (t.length ? [...t, { role: "note", text: "Die Aufgabe hat gewechselt — ich antworte jetzt zur neuen.", key: `n-${Date.now()}` }] : t));
        speech.cancel();
        setSpeaking(false);
      }
    }
  }, [binding, speech]);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      abortRef.current?.abort();
      speech.cancel();
    };
  }, [speech]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);
  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  const speak = useCallback(
    async (text: string) => {
      speech.unlock();
      setSpeechNote(null);
      setSpeaking(true);
      try {
        const result = await speech.speak({ childId: child, text });
        if (!aliveRef.current) return;
        if (result === "fallback") setSpeechNote("Vorlesen geht gerade nicht — der Text steht oben zum Lesen.");
      } catch {
        if (aliveRef.current) setSpeechNote("Vorlesen geht gerade nicht — der Text steht oben zum Lesen.");
      } finally {
        if (aliveRef.current) setSpeaking(false);
      }
    },
    [child, speech],
  );

  // Reasoning mode: speak each NEW Nabu line once the sidebar is open (never twice for the same line).
  const lastNabu = reasoning ? [...reasoning.turns].reverse().find((t) => t.role === "nabu") ?? null : null;
  useEffect(() => {
    if (!open || mode !== "reasoning" || !lastNabu) return;
    const key = `${reasoning?.itemId}:${lastNabu.at}:${lastNabu.text}`;
    if (spokenRef.current === key) return;
    spokenRef.current = key;
    void speak(lastNabu.text);
  }, [open, mode, lastNabu, reasoning?.itemId, speak]);

  const submitReasoning = async (text: string, modality: "typed" | "spoken") => {
    if (!onReasoningTurn || sending) return;
    const check = checkChildUtterance(text);
    if (!check.ok) return;
    setSending(true);
    setPendingChild(check.text);
    const before: Entry[] = reasoning ? reasoning.turns.map((t, i) => ({ role: t.role, text: t.text, modality: t.modality ?? undefined, key: `r-${i}` })) : [];
    const outcome = await onReasoningTurn(check.text, modality);
    if (!aliveRef.current) return;
    setSending(false);
    setPendingChild(null);
    if (outcome && !outcome.ok && "failure" in outcome) setFreeThread((t) => [...t, { role: "note", text: "Das konnte ich gerade nicht speichern. Sag es gleich nochmal.", key: `n-${Date.now()}` }]);
    if (outcome && outcome.ok && (outcome.status === "applied" || outcome.status === "replayed")) {
      const r = outcome.result as { done?: boolean; nabu?: string; method?: string | null; methodLabel?: string };
      if (r.done && typeof r.nabu === "string") {
        // The server closed the conversation and moved the stage on in the same write; keep the thread and the honest method until "Weiter".
        setFinished({ turns: [...before, { role: "child", text: check.text, modality, key: `c-${Date.now()}` }, { role: "nabu", text: r.nabu, key: `a-${Date.now()}` }], method: r.method ?? "unscored", methodLabel: r.methodLabel ?? (r.method ?? "") });
        void speak(r.nabu);
      }
    }
  };

  const askFree = async (text: string) => {
    if (!tutorClient || !recordSupport || !currentRevision || sending) return;
    const check = checkChildUtterance(text);
    if (!check.ok) return;
    const sentBinding = bindingRef.current;
    setSending(true);
    setFreeThread((t) => [...t, { role: "child", text: check.text, key: `c-${Date.now()}` }]);
    const abort = new AbortController();
    abortRef.current = abort;
    const result = await runTutorTurn(
      {
        recordSupport,
        currentRevision,
        newTurnId: () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `t-${Date.now()}`),
        isAlive: () => (isAlive ? isAlive() : true) && aliveRef.current && bindingRef.current === sentBinding,
        ask: async (message) => {
          const outcome = await tutorClient.ask({ childId: child, sessionSuffix: TUTOR_SESSION_SUFFIX, message }, { signal: abort.signal });
          return { ok: outcome.ok, text: outcome.ok ? envelopeSpokenText(outcome.envelope) : "" };
        },
      },
      view.tutor,
      check.text,
    );
    if (!aliveRef.current) return;
    setSending(false);
    if (bindingRef.current !== sentBinding) return; // stale: already noted by the binding effect
    switch (result.status) {
      case "answered":
        setFreeThread((t) => [...t, { role: "nabu", text: result.text, key: `a-${Date.now()}` }]);
        void speak(result.text);
        return;
      case "question-not-recorded":
        setFreeThread((t) => [...t, { role: "note", text: "Ich konnte die Frage nicht speichern, darum habe ich sie nicht gestellt. Versuch es gleich nochmal.", key: `n-${Date.now()}` }]);
        return;
      case "reply-withheld":
        setFreeThread((t) => [...t, { role: "note", text: result.reason === "gone" ? "Die Aufgabe hat gewechselt — die alte Antwort zeige ich nicht mehr." : "Die Antwort konnte nicht gespeichert werden, darum zeige ich sie nicht. Frag gleich nochmal.", key: `n-${Date.now()}` }]);
        return;
      case "bridge-unavailable":
        setFreeThread((t) => [...t, { role: "note", text: "Ich bin gerade nicht erreichbar. Deine Aufgabe bleibt wie sie ist.", key: `n-${Date.now()}` }]);
        return;
    }
  };

  const submit = (text: string, modality: "typed" | "spoken") => {
    if (mode === "reasoning") void submitReasoning(text, modality);
    else void askFree(text);
  };

  const entries: Entry[] = useMemo(() => {
    if (finished) return finished.turns;
    if (mode === "reasoning" && reasoning) {
      const base: Entry[] = reasoning.turns.map((t, i) => ({ role: t.role, text: t.text, modality: t.modality ?? undefined, key: `r-${i}` }));
      return pendingChild ? [...base, { role: "child", text: pendingChild, key: "pending" }] : base;
    }
    return freeThread;
  }, [mode, reasoning, pendingChild, freeThread, finished]);

  const contextLine = finished ? "Dein Rechenweg ist gespeichert." : mode === "reasoning" ? "Erzähl mir deinen Rechenweg — sprechen oder schreiben." : view.tutor ? (view.tutor.page === "map" ? "Frag mich zur Insel oder zum nächsten Schritt." : `Zur Aufgabe: „${view.tutor.prompt.length > 90 ? `${view.tutor.prompt.slice(0, 88)}…` : view.tutor.prompt}“`) : "Frag, was du willst.";
  const canType = finished ? false : mode === "reasoning" ? !!onReasoningTurn && reasoning?.status === "open" : !!tutorClient;
  const done = !!finished || (mode === "reasoning" && reasoning?.status === "done");
  const doneMethod = finished?.method ?? reasoning?.method ?? "";
  const doneLabel = finished?.methodLabel ?? reasoning?.methodLabel ?? "";
  const shownMode: "reasoning" | "free" = finished ? "reasoning" : mode;

  return (
    <>
      {/* the bubble — always reachable, bottom right */}
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={cn("fixed bottom-4 right-4 z-30 inline-flex min-h-14 items-center gap-2 rounded-full border-2 border-stone-900 bg-amber-300 px-4 text-base font-semibold text-stone-900 shadow-lg hover:bg-amber-200 dark:border-amber-200", focusRing, open && "sr-only")}
        aria-expanded={open}
        aria-controls="nabu-sidebar"
        data-testid="nabu-bubble"
        data-mode={shownMode}
      >
        <NabuFace />
        Nabu
        {mode === "reasoning" && !done ? <span className="ml-1 inline-block h-2.5 w-2.5 rounded-full bg-red-600" aria-label="wartet auf dich" /> : null}
      </button>

      {open ? (
        <aside
          id="nabu-sidebar"
          role="dialog"
          aria-modal="false"
          aria-label="Nabu"
          className="fixed inset-x-0 bottom-0 z-30 flex max-h-[72vh] flex-col rounded-t-3xl border-t border-primary bg-primary p-4 shadow-2xl lg:inset-x-auto lg:bottom-4 lg:right-4 lg:top-20 lg:max-h-none lg:w-[400px] lg:rounded-3xl lg:border"
          data-testid="nabu-sidebar"
          data-mode={shownMode}
          data-binding={binding}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <NabuFace />
              <p className="text-base font-semibold text-primary">Nabu</p>
            </div>
            <button ref={closeRef} type="button" onClick={() => onOpenChange(false)} className={cn("min-h-12 min-w-12 rounded-full text-xl", focusRing)} aria-label="Nabu schliessen" data-testid="nabu-close">
              ×
            </button>
          </div>
          <p className="mt-1 text-sm text-tertiary" data-testid="nabu-context">
            {contextLine}
          </p>
          <div className="mt-3 min-h-24 flex-1 space-y-2 overflow-y-auto" aria-live="polite" data-testid="nabu-thread">
            {entries.length === 0 ? <p className="text-sm text-tertiary">{shownMode === "free" ? "Ich kenne deine aktuelle Aufgabe und deine Insel. Was möchtest du wissen?" : ""}</p> : null}
            {entries.map((entry) => (
              <p key={entry.key} className={cn("rounded-2xl px-3 py-2 text-base", entry.role === "child" && "ml-6 bg-secondary text-primary", entry.role === "nabu" && "mr-6 bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900", entry.role === "note" && "border border-primary text-tertiary")} data-testid={`nabu-${entry.role}`} data-modality={entry.modality ?? ""}>
                {entry.text}
                {entry.role === "child" && entry.modality === "spoken" ? <span className="ml-2 text-xs opacity-70">(gesprochen)</span> : null}
              </p>
            ))}
            {sending ? <p className="text-sm text-tertiary">… Nabu überlegt</p> : null}
          </div>
          {speechNote ? (
            <p className="mt-2 text-xs text-tertiary" role="status">
              {speechNote}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {(finished || (lastNabu && mode === "reasoning")) ? (
              <button type="button" onClick={() => void speak(finished ? finished.turns[finished.turns.length - 1].text : lastNabu!.text)} disabled={speaking} className={secondaryButton} data-testid="nabu-repeat">
                🔊 Nochmal
              </button>
            ) : null}
            {speaking ? (
              <button type="button" onClick={() => speech.cancel()} className={secondaryButton} data-testid="nabu-speech-stop">
                🔇 Stopp
              </button>
            ) : null}
          </div>

          {mode === "reasoning" && reasoning?.choices && onReasoningChoice ? (
            <div className="mt-3 flex flex-wrap gap-2" data-testid="reasoning-choices">
              {reasoning.choices.counters ? (
                <button type="button" disabled={busy} onClick={() => void onReasoningChoice("counters")} className={primaryButton} data-testid="reasoning-counters">
                  📦 Zusammen legen
                </button>
              ) : null}
              <button type="button" disabled={busy} onClick={() => void onReasoningChoice("teach")} className={secondaryButton} data-testid="reasoning-teach">
                Zeig mir, wie du rechnest
              </button>
              <button type="button" disabled={busy} onClick={() => void onReasoningChoice("continue")} className={secondaryButton} data-testid="reasoning-continue">
                Weiter ohne Erklärung
              </button>
            </div>
          ) : null}

          {done ? (
            <div className="mt-3 rounded-2xl bg-secondary p-3" data-testid="reasoning-done" data-method={doneMethod}>
              <p className="text-base text-primary">Gespeichert: {doneLabel}.</p>
              <button
                type="button"
                onClick={() => {
                  setFinished(null);
                  onReasoningDone?.();
                  onOpenChange(false);
                }}
                className={cn(primaryButton, "mt-2")}
                data-testid="reasoning-next"
              >
                Weiter
              </button>
            </div>
          ) : null}

          {canType && !done ? (
            pendingTranscript !== null ? (
              <div className="mt-3 rounded-2xl bg-secondary p-3" data-testid="nabu-confirm">
                <p className="text-base text-primary">Ich habe verstanden: „{pendingTranscript}“ — stimmt das?</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={sending}
                    onClick={() => {
                      const t = pendingTranscript;
                      setPendingTranscript(null);
                      submit(t, "spoken");
                    }}
                    className={primaryButton}
                    data-testid="nabu-confirm-yes"
                  >
                    Ja, so
                  </button>
                  <button type="button" disabled={sending} onClick={() => setPendingTranscript(null)} className={secondaryButton} data-testid="nabu-confirm-no">
                    Nein, nochmal
                  </button>
                </div>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (question.trim() && !sending) {
                    submit(question.trim(), "typed");
                    setQuestion("");
                  }
                }}
                className="mt-3 flex flex-col gap-2"
              >
                <div className="flex flex-wrap gap-2">
                  <PushToTalk disabled={sending || busy} onTranscript={(t) => setPendingTranscript(t)} label={mode === "reasoning" ? "🎙️ Sprechen" : "🎙️ Frage sagen"} />
                </div>
                <label className="sr-only" htmlFor="nabu-input">
                  {mode === "reasoning" ? "Deine Erklärung" : "Frage an Nabu"}
                </label>
                <div className="flex gap-2">
                  <input ref={inputRef} id="nabu-input" value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => (e.key === "Enter" && isComposing(e) ? e.preventDefault() : undefined)} maxLength={600} placeholder={mode === "reasoning" ? "… oder schreib es hier" : "Was heisst …? Warum …?"} className={cn("min-h-14 min-w-0 flex-1 rounded-2xl border border-primary bg-primary px-4 text-lg text-primary", focusRing)} data-testid="nabu-input" autoComplete="off" />
                  <button type="submit" disabled={sending || busy || !question.trim()} className={primaryButton} data-testid="nabu-send">
                    {mode === "reasoning" ? "Senden" : "Fragen"}
                  </button>
                </div>
              </form>
            )
          ) : null}
          {shownMode === "free" && !tutorClient ? <p className="mt-3 text-sm text-tertiary">Hier kann ich nur zuhören — Fragen stellst du in der Aufgabe.</p> : null}
          <p className="mt-2 text-xs text-tertiary">Das Mikrofon läuft nur, wenn du es startest. Gesprochenes wird nicht als Schreibweise bewertet.</p>
        </aside>
      ) : null}
    </>
  );
}

function NabuFace() {
  return (
    <svg viewBox="0 0 40 40" className="h-8 w-8 shrink-0" aria-hidden>
      <circle cx={20} cy={20} r={18} fill="#fde68a" stroke="#1c1917" strokeWidth={2} />
      <circle cx={14} cy={17} r={2.6} fill="#1c1917" />
      <circle cx={26} cy={17} r={2.6} fill="#1c1917" />
      <path d="M12 25 q 8 7 16 0" stroke="#1c1917" strokeWidth={2.2} fill="none" strokeLinecap="round" />
      <path d="M8 10 q 12 -10 24 0" stroke="#1c1917" strokeWidth={2} fill="none" />
    </svg>
  );
}

export { recordSupportConfirmed };
