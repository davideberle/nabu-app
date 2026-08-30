"use client";

// ---------------------------------------------------------------------------
// Record something I did — guided activity capture
// (family-assistant DESIGN.md §2.1; Family DESIGN.md Phase R7)
//
// Choose one of six activities → hear/see its task-specific prompt → one
// large Start/Stop recording control through the existing Scribe v2 path →
// review and correct the editable transcript → submit. Every submission
// enters `pending_review` on the Family-owned completion identity and awards
// nothing until a parent approves it; the receipt says so calmly, with no
// provisional coin. Audio is transient: it exists as an in-memory blob
// between Stop and the `/api/family/transcribe` response and is never stored.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/components/ui/nabu";
import { useChildShell } from "@/components/family/child-shell-provider";
import {
  guidedCategories,
  guidedRoutineFor,
  guidedSubmissionChallenge,
  type GuidedCategory,
} from "@/lib/family-guided-capture";
import { normalizeGuidedSummary } from "@/lib/family-review-queue";
import {
  checkChildUtterance,
  startPushToTalk,
  voiceCaptureSupported,
  type PushToTalkSession,
  type RecorderControl,
  type RecorderHandlers,
} from "@/lib/family-voice";
import {
  createChildSpeechPlayer,
  type ChildSpeechPlayer,
} from "@/lib/family-speech";
import { TALK_BUTTON_SIZE_CLASS } from "@/lib/family-assistant-layout";
import { childShellWeekInfo, resolveShellRoutines, type ChildId } from "@/lib/family-child-shell";
import { currentDayIndex } from "@/data/family-routines";
import type { FamilyBoardConfig } from "@/lib/family-db";

const TRANSCRIBE_PATH = "/api/family/transcribe";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500";

const bigActionClass = cn(
  "flex min-h-24 items-center gap-4 rounded-2xl border border-primary bg-primary px-5 py-4 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-md dark:shadow-none",
  focusRing,
);

const pillButtonClass = cn(
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-primary bg-primary px-5 text-base font-medium text-secondary transition-colors hover:bg-secondary",
  focusRing,
);

function adaptMediaRecorder(
  recorder: MediaRecorder,
  handlers: RecorderHandlers,
): RecorderControl {
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

/** Mic lifecycle inside the record step; truthful about startup. */
type MicState = "idle" | "starting" | "live";

type Step =
  | { kind: "choose" }
  | { kind: "record"; category: GuidedCategory }
  | { kind: "transcribing"; category: GuidedCategory }
  | { kind: "review"; category: GuidedCategory; issue?: string }
  | { kind: "submitting"; category: GuidedCategory }
  | { kind: "receipt"; category: GuidedCategory; summary: string }
  | { kind: "trouble"; category: GuidedCategory; message: string };

export function FamilyRecordClient() {
  // The selected child is owned by the persistent shell provider. Keying the
  // workspace by child means a mid-capture profile switch discards the
  // in-progress recording/draft instead of submitting one child's words
  // under the sibling's identity (same pattern as the assistant Workspace).
  const { child, restored } = useChildShell();
  if (!restored || !child) return null;
  return <RecordWorkspace key={child} child={child} />;
}

function RecordWorkspace({ child }: { child: ChildId }) {
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [micState, setMicState] = useState<MicState>("idle");
  const [draft, setDraft] = useState("");
  const [voiceSupported, setVoiceSupported] = useState(false);
  /**
   * Parent board config, so a routine a parent disabled disappears from the
   * category grid too. Null until loaded; a failed load shows every category
   * (availability over strictness — the server still reviews everything).
   */
  const [config, setConfig] = useState<FamilyBoardConfig | null>(null);

  const recordSessionRef = useRef<PushToTalkSession | null>(null);
  const recordSeqRef = useRef(0);
  const transcribeAbortRef = useRef<AbortController | null>(null);
  const speakTimerRef = useRef<number | null>(null);
  const aliveRef = useRef(true);
  const speechPlayerRef = useRef<ChildSpeechPlayer | null>(null);
  const speechPlayer = useCallback(() => {
    if (speechPlayerRef.current === null) {
      speechPlayerRef.current = createChildSpeechPlayer();
    }
    return speechPlayerRef.current;
  }, []);

  useEffect(() => {
    setVoiceSupported(voiceCaptureSupported(window));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/family/config")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: FamilyBoardConfig | null) => {
        if (!cancelled && data) setConfig(data);
      })
      .catch(() => {
        /* full category list stays available */
      });
    return () => { cancelled = true; };
  }, []);

  const discardRecording = useCallback(() => {
    recordSeqRef.current += 1;
    const session = recordSessionRef.current;
    recordSessionRef.current = null;
    session?.cancel();
    transcribeAbortRef.current?.abort();
    transcribeAbortRef.current = null;
    setMicState("idle");
  }, []);

  const cancelSpeech = useCallback(() => {
    speechPlayerRef.current?.cancel();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* nothing speaking */
      }
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      discardRecording();
      cancelSpeech();
      if (speakTimerRef.current !== null) window.clearTimeout(speakTimerRef.current);
    };
  }, [cancelSpeech, discardRecording]);

  /**
   * Speak the task prompt in the child's voice (ElevenLabs, with the browser
   * synthesis fallback). Visual prompt never depends on this succeeding.
   */
  const speakPrompt = useCallback(
    (category: GuidedCategory) => {
      if (!child) return;
      void speechPlayer()
        .speak({ childId: child, text: category.prompt })
        .then((result) => {
          if (result !== "fallback") return;
          if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
          try {
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(new SpeechSynthesisUtterance(category.prompt));
          } catch {
            /* prompt stays visible */
          }
        })
        .catch(() => {
          /* prompt stays visible */
        });
    },
    [child, speechPlayer],
  );

  const chooseCategory = useCallback(
    (category: GuidedCategory) => {
      // The tap is a user gesture: unlock audio here so the prompt may speak.
      // The speak itself is deferred a beat — `speak()` opens by cancelling
      // current playback, and cancelling the in-flight silent unlock clip in
      // the same tick would keep the element from ever latching as
      // user-activated on iPad Safari.
      speechPlayer().unlock();
      setDraft("");
      setStep({ kind: "record", category });
      if (speakTimerRef.current !== null) window.clearTimeout(speakTimerRef.current);
      speakTimerRef.current = window.setTimeout(() => {
        speakTimerRef.current = null;
        if (aliveRef.current) speakPrompt(category);
      }, 400);
    },
    [speakPrompt, speechPlayer],
  );

  const backToChoose = useCallback(() => {
    discardRecording();
    cancelSpeech();
    setDraft("");
    setStep({ kind: "choose" });
  }, [cancelSpeech, discardRecording]);

  const transcribeRecording = useCallback(
    async (seq: number, category: GuidedCategory, blob: Blob, fileName: string) => {
      try {
        const form = new FormData();
        form.append("audio", blob, fileName);
        const abort = new AbortController();
        transcribeAbortRef.current = abort;
        const response = await fetch(TRANSCRIBE_PATH, {
          method: "POST",
          body: form,
          signal: abort.signal,
        });
        if (recordSeqRef.current !== seq || !aliveRef.current) return;
        if (!response.ok) {
          // 503 (service unconfigured/down) will not get better by retrying;
          // 429 is the shared per-household listening budget. Both steer to
          // typing instead of an endless retry loop.
          setStep({
            kind: "trouble",
            category,
            message:
              response.status === 503
                ? "My ears aren't working right now — type what you did instead."
                : response.status === 429
                  ? "I've been listening a lot just now. Wait a minute, or type what you did."
                  : "My ears aren't working right now. You can try again, or type what you did.",
          });
          return;
        }
        const payload = (await response.json()) as { transcript?: string };
        if (recordSeqRef.current !== seq || !aliveRef.current) return;
        const transcript = (payload.transcript ?? "").trim();
        if (!transcript) {
          setStep({
            kind: "trouble",
            category,
            message: "I couldn't hear anything that time. Want to try again?",
          });
          return;
        }
        setDraft(transcript);
        setStep({ kind: "review", category });
      } catch {
        if (recordSeqRef.current !== seq || !aliveRef.current) return;
        setStep({
          kind: "trouble",
          category,
          message:
            "Something went wrong while I was listening. You can try again, or type what you did.",
        });
      }
    },
    [],
  );

  const startRecording = useCallback(
    (category: GuidedCategory) => {
      if (!voiceCaptureSupported(window)) {
        setStep({ kind: "review", category });
        return;
      }
      cancelSpeech();
      discardRecording();
      const seq = (recordSeqRef.current += 1);
      setMicState("starting");
      recordSessionRef.current = startPushToTalk({
        getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: true }),
        isTypeSupported: (type) => MediaRecorder.isTypeSupported(type),
        createRecorder: (stream, mimeType, handlers) =>
          adaptMediaRecorder(
            mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream),
            handlers,
          ),
        onLive: () => {
          if (recordSeqRef.current === seq && aliveRef.current) setMicState("live");
        },
        onSettle: (outcome) => {
          if (recordSeqRef.current !== seq || !aliveRef.current) return;
          recordSessionRef.current = null;
          setMicState("idle");
          switch (outcome.kind) {
            case "recorded":
              setStep({ kind: "transcribing", category });
              void transcribeRecording(seq, category, outcome.blob, outcome.fileName);
              return;
            case "empty":
              setStep({
                kind: "trouble",
                category,
                message: "I couldn't hear anything that time. Want to try again?",
              });
              return;
            case "denied":
              setStep({
                kind: "trouble",
                category,
                message:
                  "The microphone said no. You can type what you did instead.",
              });
              return;
            case "failed":
              setStep({
                kind: "trouble",
                category,
                message:
                  "The microphone had a problem. You can try again, or type what you did.",
              });
              return;
            case "cancelled":
              return;
          }
        },
      });
    },
    [cancelSpeech, discardRecording, transcribeRecording],
  );

  const stopRecording = useCallback(() => {
    recordSessionRef.current?.stop();
  }, []);

  const submit = useCallback(
    async (category: GuidedCategory) => {
      if (!child) return;
      const checked = checkChildUtterance(draft);
      if (!checked.ok) {
        setStep({
          kind: "review",
          category,
          issue:
            checked.reason === "empty"
              ? "Say or type at least a few words about what you did."
              : `That's a bit long — keep it under ${checked.limit} characters.`,
        });
        return;
      }
      const routine = guidedRoutineFor(child, category.id);
      if (!routine) {
        setStep({
          kind: "trouble",
          category,
          message: "This activity isn't set up for you yet. Ask a parent to check.",
        });
        return;
      }
      setStep({ kind: "submitting", category });
      // Week and day are derived together at submit time so a flow left open
      // across midnight still records a consistent identity.
      const week = childShellWeekInfo(undefined).weekId;
      const day = currentDayIndex();
      try {
        const response = await fetch("/api/family/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            week,
            personId: child,
            routineId: routine.id,
            day,
            status: "pending_review",
            note: checked.text,
            challenge: guidedSubmissionChallenge(category),
          }),
        });
        if (!aliveRef.current) return;
        if (response.status === 409) {
          // The server refuses to overwrite a submission a parent already
          // reviewed (done / on hold) — say so instead of retry-looping.
          setStep({
            kind: "trouble",
            category,
            message:
              "Mama or Papa already looked at this one today. If something changed, tell them!",
          });
          return;
        }
        if (!response.ok) throw new Error("submit failed");
        // Same derivation the server stores — display only.
        setStep({
          kind: "receipt",
          category,
          summary: normalizeGuidedSummary(checked.text),
        });
      } catch {
        if (!aliveRef.current) return;
        setStep({
          kind: "review",
          category,
          issue: "I couldn't save that. Check the words and try sending again.",
        });
      }
    },
    [child, draft],
  );

  const homeHref = `/family/assistant?child=${child}`;

  let content: React.ReactNode = null;

  if (step.kind === "choose") {
    content = (
      <div className="flex min-h-full flex-col justify-center gap-6">
        <div>
          <Link href={homeHref} className={cn(pillButtonClass, "mb-3")}>
            <span aria-hidden>←</span> Home
          </Link>
          <h1 className="text-3xl font-semibold tracking-[-0.02em] text-primary">
            Record something I did
          </h1>
          <p className="mt-1 text-base text-tertiary">
            Pick the activity, then tell me about it.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {guidedCategories
            .filter((category) => {
              // Hide categories whose routine a parent disabled in board
              // config; until config loads, the full set shows.
              if (!config) return true;
              const routine = guidedRoutineFor(child, category.id);
              if (!routine) return false;
              return resolveShellRoutines(config).some((r) => r.id === routine.id);
            })
            .map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => chooseCategory(category)}
              className={bigActionClass}
            >
              <span
                className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-secondary text-3xl"
                aria-hidden
              >
                {category.icon}
              </span>
              <span className="min-w-0 text-lg font-semibold text-primary">
                {category.label}
              </span>
            </button>
            ))}
        </div>
      </div>
    );
  } else if (step.kind === "record") {
    const listening = micState === "live";
    const starting = micState === "starting";
    content = (
      <div className="flex min-h-full flex-col items-center justify-center gap-6 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-tertiary">
          {step.category.icon} {step.category.label}
        </p>
        <h1 className="max-w-xl text-2xl font-semibold leading-snug text-primary">
          {step.category.prompt}
        </h1>
        {voiceSupported ? (
          <>
            <button
              type="button"
              onClick={() => (micState === "idle" ? startRecording(step.category) : stopRecording())}
              aria-pressed={micState !== "idle"}
              aria-label={
                listening
                  ? "Stop recording"
                  : starting
                    ? "Stop — the microphone is still turning on"
                    : "Start recording"
              }
              className={cn(
                TALK_BUTTON_SIZE_CLASS,
                "relative grid place-items-center rounded-full border-4 text-4xl shadow-md transition-colors",
                micState === "idle"
                  ? "border-stone-300 bg-primary hover:bg-secondary"
                  : "border-rose-400 bg-rose-50 dark:bg-rose-950/40",
                focusRing,
              )}
            >
              <span aria-hidden>{micState === "idle" ? "🎙️" : "⏹"}</span>
            </button>
            <p className="text-base font-medium text-secondary" aria-live="polite">
              {listening
                ? "Recording — tap to stop"
                : starting
                  ? "Turning the microphone on…"
                  : "Tap to start talking"}
            </p>
          </>
        ) : (
          <p className="max-w-md text-base text-tertiary">
            This device can&apos;t record audio, so type what you did instead.
          </p>
        )}
        <div className="flex flex-wrap justify-center gap-3">
          {/* Always reachable: a microphone that never comes up (permission
              sheet dismissed, hung getUserMedia) must not strand the child. */}
          <button
            type="button"
            onClick={() => {
              discardRecording();
              setStep({ kind: "review", category: step.category });
            }}
            className={pillButtonClass}
          >
            ⌨️ Type it instead
          </button>
          <button type="button" onClick={backToChoose} className={pillButtonClass}>
            Cancel
          </button>
        </div>
      </div>
    );
  } else if (step.kind === "transcribing") {
    content = (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 text-center">
        <span className="h-10 w-10 animate-spin rounded-full border-2 border-stone-300 border-t-stone-600" aria-hidden />
        <p className="text-lg font-medium text-secondary">Working out what you said…</p>
        {/* A hung upstream must not strand the child on a spinner. */}
        <button
          type="button"
          onClick={() => {
            discardRecording();
            setStep({ kind: "record", category: step.category });
          }}
          className={pillButtonClass}
        >
          Cancel
        </button>
      </div>
    );
  } else if (step.kind === "review") {
    content = (
      <div className="flex min-h-full flex-col justify-center gap-5">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-tertiary">
            {step.category.icon} {step.category.label}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-primary">
            Is this what you did?
          </h1>
          <p className="mt-1 text-base text-tertiary">
            You can fix any word before sending it.
          </p>
        </div>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={4}
          aria-label="What you did — you can fix any word before sending"
          placeholder="Tell me what you did…"
          className={cn(
            "w-full rounded-2xl border border-primary bg-primary px-4 py-3 text-lg leading-relaxed text-primary",
            focusRing,
          )}
        />
        {step.issue && (
          <p className="text-sm font-medium text-rose-600 dark:text-rose-400" role="alert">
            {step.issue}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => submit(step.category)}
            className={cn(
              "inline-flex min-h-14 items-center justify-center gap-2 rounded-full bg-emerald-600 px-6 text-base font-semibold text-white transition-colors hover:bg-emerald-700",
              focusRing,
            )}
          >
            ✅ Send it
          </button>
          {voiceSupported && (
            <button
              type="button"
              onClick={() => {
                setDraft("");
                setStep({ kind: "record", category: step.category });
              }}
              className={pillButtonClass}
            >
              🎙️ Say it again
            </button>
          )}
          <button type="button" onClick={backToChoose} className={pillButtonClass}>
            Cancel
          </button>
        </div>
      </div>
    );
  } else if (step.kind === "submitting") {
    content = (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 text-center">
        <span className="h-10 w-10 animate-spin rounded-full border-2 border-stone-300 border-t-stone-600" aria-hidden />
        <p className="text-lg font-medium text-secondary">Saving…</p>
      </div>
    );
  } else if (step.kind === "receipt") {
    // The calm awaiting-review receipt: no coin, no celebration — approval and
    // any reward stay with the parent review (Family DESIGN.md Phase R7).
    content = (
      <div className="flex min-h-full flex-col items-center justify-center gap-5 text-center">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-secondary text-3xl" aria-hidden>
          {step.category.icon}
        </span>
        <div>
          <h1 className="text-2xl font-semibold text-primary">Saved!</h1>
          <p className="mx-auto mt-2 max-w-md text-base text-secondary">
            Your {step.category.label} note is waiting for Mama or Papa to look at.
          </p>
          {step.summary && (
            <p className="mx-auto mt-3 max-w-md rounded-2xl border border-primary bg-primary px-4 py-3 text-sm text-tertiary">
              &ldquo;{step.summary}&rdquo;
            </p>
          )}
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <button type="button" onClick={backToChoose} className={pillButtonClass}>
            Record another
          </button>
          <Link href={homeHref} className={pillButtonClass}>
            <span aria-hidden>←</span> Home
          </Link>
        </div>
      </div>
    );
  } else if (step.kind === "trouble") {
    content = (
      <div className="flex min-h-full flex-col items-center justify-center gap-5 text-center">
        <p className="max-w-md text-lg font-medium text-secondary">{step.message}</p>
        <div className="flex flex-wrap justify-center gap-3">
          {voiceSupported && (
            <button
              type="button"
              onClick={() => setStep({ kind: "record", category: step.category })}
              className={pillButtonClass}
            >
              🎙️ Try again
            </button>
          )}
          <button
            type="button"
            onClick={() => setStep({ kind: "review", category: step.category })}
            className={pillButtonClass}
          >
            ⌨️ Type it instead
          </button>
          <button type="button" onClick={backToChoose} className={pillButtonClass}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-10 pt-4 sm:px-6">
      {content}
    </main>
  );
}
