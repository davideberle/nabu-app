"use client";

// ---------------------------------------------------------------------------
// Visit 8 (content v7) — the short spoken look back that replaces the click-through summary.
//
// Nokt leads it. When he deliberately finishes the mission (the «Zum Rückblick» tap, which also unlocks audio), the page
// opens with a short result line and ONE compact choice («Wie war es heute?»), and Nokt is already the main thing on screen:
// it asks its first question by itself — once. Only the current question and his answer box are on screen; the whole
// conversation folds open. When Nokt asks about the next visit, two reviewed ideas, «Eigene Idee» and «Weiss ich noch nicht»
// are offered as taps; his own words count too and are saved verbatim with how they came.
//
// Safe paths: a reload or coming back after «Stopp» shows the saved conversation without speaking and without a new
// opener (one tap continues); without Nokt (switched off, no connection, used-up day) the reviewed ideas are the closing;
// «Fertig» is always there — if nothing about the next visit was said yet, the reviewed choices appear right there.
// The microphone never starts by itself. Nothing here is an assessment, a completion or a reward.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { cn } from "@/components/ui/nabu";
import type { ChildView } from "@/lib/family-learning-state";
import type { ChildId } from "@/lib/family-assistant-turn";
import type { ChildSpeechPlayer } from "@/lib/family-speech";
import type { LearningMutateOutcome } from "@/lib/family-learning-client";
import { PlanGrid, planCountsText } from "./plan-grid";
import { WorkshopRoom } from "./workshop-pictures";
import { NoktTalk, type NoktTalkTurnFn } from "./nokt-talk";
import { NextAdventureQuestion, NextInterestQuestion, interestReady, type InterestAnswer } from "./next-interest";
import type { NoktTranscribe } from "./nokt-panel";

const btn = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 text-lg font-semibold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:opacity-50";
const primary = { background: "#215c60", color: "white" } as const;
const chip = "inline-flex min-h-11 items-center rounded-full border-2 px-4 text-base font-semibold disabled:opacity-50";

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `reflect-${Date.now()}`);

export function Debrief({
  child,
  view,
  busy,
  speech,
  transcribe,
  turn,
  autoOpen,
  onFeedback,
  onFinish,
}: {
  child: ChildId;
  view: ChildView;
  busy: boolean;
  speech: ChildSpeechPlayer;
  transcribe: NoktTranscribe | null;
  turn: NoktTalkTurnFn | null;
  /** He finished the mission himself in this page session (never true after a reload or a return from Stopp). */
  autoOpen: boolean;
  onFeedback: (feedback: Record<string, string | null | undefined>) => Promise<LearningMutateOutcome | null>;
  onFinish: (payload: Record<string, unknown>, idempotencyKey: string) => Promise<LearningMutateOutcome | null>;
}) {
  const reflection = view.reflection!;
  const closing = reflection.closing ?? null;
  const talk = view.nokt?.talk;
  const debrief = talk?.debrief ?? null;
  const visitId = view.visit?.id ?? "";
  const page = `visit:${visitId}:debrief`;
  const session = talk?.sessions.find((s) => s.purpose === "debrief" && s.page === page) ?? null;
  const interestRecorded = !!debrief?.interestRecorded;
  const [answers, setAnswers] = useState<Record<string, string | null | undefined>>(() => ({ ...(closing?.feedback ?? {}) }));
  // Nokt opens by itself only after the deliberate finish; a saved conversation continues; otherwise one explicit tap.
  const [talking, setTalking] = useState(!!session || (autoOpen && !!turn));
  const opened = useRef(talking);
  useEffect(() => {
    if (autoOpen && turn && !opened.current) {
      opened.current = true;
      setTalking(true);
    }
  }, [autoOpen, turn]);
  // Arriving at the look back: start reading at its top (the mission page may have been scrolled to the quest list).
  useEffect(() => {
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, []);
  const [interest, setInterest] = useState<InterestAnswer | null>(null);
  const [showForm, setShowForm] = useState(!turn);
  const [key] = useState(newKey);
  const more = reflection.dimensions;

  const pick = (id: string, value: string | null) => {
    const next = { ...answers, [id]: value };
    setAnswers(next);
    void onFeedback(next);
  };
  const finish = () => {
    if (!interestRecorded && reflection.nextInterest && !interestReady(interest)) {
      setShowForm(true);
      return;
    }
    void onFinish({ op: "reflect", ...(interestRecorded ? {} : interest ? { interest } : {}) }, key);
  };
  const row = (id: string, prompt: string, options: { id: string; label: string }[], skip: string) => (
    <div key={id} className="flex flex-wrap items-center gap-2" role="group" aria-label={prompt} data-testid={`debrief-row-${id}`}>
      <span className="mr-1 text-base font-semibold">{prompt}</span>
      {options.map((o) => (
        <button key={o.id} type="button" className={cn(chip, answers[id] === o.id && "ring-2 ring-stone-600")} style={{ borderColor: "#8ba8a4", background: "white" }} aria-pressed={answers[id] === o.id} disabled={busy} onClick={() => pick(id, o.id)} data-testid={`${id}-${o.id}`}>
          {o.label}
        </button>
      ))}
      <button type="button" className={cn(chip, answers[id] === null && "ring-2 ring-stone-600")} style={{ borderColor: "#d6c3a3", background: "#fffdf6" }} aria-pressed={answers[id] === null} disabled={busy} onClick={() => pick(id, null)} data-testid={`${id}-skip`}>
        {skip}
      </button>
    </div>
  );

  return (
    <div className="flex flex-col gap-4" data-testid="debrief" data-talking={talking ? "true" : "false"} data-interest={interestRecorded ? "recorded" : "open"}>
      <section className="flex items-center gap-4 rounded-3xl p-3" style={{ background: "#f2f7ee" }} data-testid="debrief-result">
        {closing?.plan ? <PlanGrid grid={closing.plan} caption="Dein Plan" highlight compact /> : null}
        {/* Isabel's workshop: the room with what she chose to make (no plan). */}
        {closing?.made ? <div className="w-40 shrink-0"><WorkshopRoom made={closing.made.picture} label={closing.made.room} /></div> : null}
        <div className="min-w-0">
          <h2 className="text-xl font-bold">Geschafft: {view.visit?.title ?? "dein Besuch"}</h2>
          {closing?.success ? <p className="text-base" data-testid="debrief-success">✓ {closing.success}</p> : null}
          {closing?.plan && planCountsText(closing.plan) ? <p className="text-sm" data-testid="debrief-plan-counts">{planCountsText(closing.plan)}</p> : null}
          {closing?.recap ? (
            <p className="text-lg" data-testid="debrief-recap">
              {closing.recap}{" "}
              {child === "isabel" ? (
                <button type="button" className="text-base font-semibold underline underline-offset-4" onClick={() => { speech.unlock(); void speech.speak({ childId: child, text: closing.recap!, language: "de", speaker: "character" }); }} data-testid="debrief-recap-audio">
                  Anhören
                </button>
              ) : null}
            </p>
          ) : null}
        </div>
      </section>

      {row("difficulty", reflection.prompt, reflection.options, reflection.skipLabel ?? "Lieber nicht sagen")}

      {turn ? (
        talking ? (
          <NoktTalk
            key={page}
            child={child}
            purpose="debrief"
            sessionId={session && !session.closed ? session.id : null}
            initialLines={session?.lines ?? []}
            opener={!session}
            speech={speech}
            transcribe={transcribe}
            turn={turn}
            title="Nokt schaut mit dir zurück"
            testId="nokt-debrief"
            layout="focus"
            choices={debrief?.askingNext ? [...debrief.ideas, { id: "unsure", label: "Weiss ich noch nicht" }] : null}
          />
        ) : (
          <button type="button" className={cn(btn, "self-start")} style={primary} disabled={busy} onClick={() => { speech.unlock(); setTalking(true); }} data-testid="debrief-start">
            Mit Nokt zurückschauen
          </button>
        )
      ) : child === "isabel" ? null : (
        <p className="rounded-2xl px-4 py-3 text-base" style={{ background: "#fff8e1" }} data-testid="debrief-no-nokt">
          Nokt kann gerade nicht mit dir zurückschauen. Unten kannst du sagen, was du als Nächstes machen möchtest.
        </p>
      )}

      {interestRecorded ? (
        <p className="rounded-2xl px-4 py-3 text-base" style={{ background: "#edf4e6" }} data-testid="debrief-interest">
          Für das nächste Mal gespeichert{debrief?.wish?.text ? `: «${debrief.wish.text}»` : debrief?.wish?.kind === "unsure" ? ": du weisst es noch nicht" : debrief?.wish?.kind === "declined" ? ": du möchtest es lieber nicht sagen" : "."}
        </p>
      ) : showForm && reflection.nextInterest ? (
        <div className="rounded-3xl border p-4" data-testid="debrief-interest-form">
          {reflection.adventure ? <NextAdventureQuestion adventure={reflection.adventure} labels={reflection.nextInterest} value={interest} onChange={setInterest} disabled={busy} /> : <NextInterestQuestion labels={reflection.nextInterest} value={interest} onChange={setInterest} disabled={busy} />}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={btn} style={primary} disabled={busy || (showForm && !interestRecorded && !!reflection.nextInterest && !interestReady(interest))} onClick={finish} data-testid="debrief-finish">
          Fertig — zurück nach Hause
        </button>
        {!interestRecorded && !showForm ? (
          <button type="button" className="text-base underline" onClick={() => setShowForm(true)} data-testid="debrief-skip-talk">
            Ohne Gespräch wählen
          </button>
        ) : null}
      </div>

      {more.length ? (
        <details className="text-base" data-testid="debrief-more">
          <summary className="cursor-pointer underline">Mehr sagen (freiwillig)</summary>
          <div className="mt-2 grid gap-2">{more.map((d) => row(d.id, d.prompt, d.options, d.skipLabel))}</div>
        </details>
      ) : null}
      <p className="text-sm">{child === "isabel" ? "Mit «Stopp» oben machst du eine Pause; deine Antworten bleiben gespeichert." : "Mit «Stopp» oben machst du eine Pause; das Gespräch bleibt gespeichert."}</p>
    </div>
  );
}
