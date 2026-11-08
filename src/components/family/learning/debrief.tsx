"use client";

// ---------------------------------------------------------------------------
// Visit 8 (content v7) — the short spoken look back that replaces the click-through summary.
//
// Nov 8 order: the app asks «Wie leicht war es?» first; that tap opens Nokt's look back in the sidebar, Nokt speaking first. While
// it runs the visit cannot be closed: no «Fertig», no way around it. It ends with Nokt's last line, the turn limit (about four of
// his turns, the server's) or one friendly line if Nokt fails or takes too long — never stuck. Then the next-visit choice (pictures
// with one word each) and «Fertig». A parent can switch the talk off in the parent settings; nothing on this screen can.
// A reload shows the saved conversation without speaking; the microphone never starts by itself. Nothing here is an assessment.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { cn } from "@/components/ui/nabu";
import type { ChildView } from "@/lib/family-learning-state";
import type { ChildId } from "@/lib/family-assistant-turn";
import type { ChildSpeechPlayer } from "@/lib/family-speech";
import type { LearningMutateOutcome } from "@/lib/family-learning-client";
import { PlanGrid, planCountsText } from "./plan-grid";
import { WorkshopRoom } from "./workshop-pictures";
import { NoktTalk, type NoktTalkTurnFn } from "./nokt-talk";
import { ChoicePicture, NextAdventureQuestion, NextInterestQuestion, choiceWord, interestReady, type InterestAnswer } from "./next-interest";
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
  onFeedback,
  onFinish,
}: {
  child: ChildId;
  view: ChildView;
  busy: boolean;
  speech: ChildSpeechPlayer;
  transcribe: NoktTranscribe | null;
  turn: NoktTalkTurnFn | null;
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
  // Nov 8 order: the app asks first; then Nokt looks back in the sidebar; only when that is over can the visit be closed.
  const difficultyAnswered = "difficulty" in answers;
  const noNokt = !turn || !!talk?.skip;
  // A saved conversation that never got a line from Nokt cannot continue: it does not hold the visit up after a reload.
  const stranded = !!session && !session.lines.some((l) => l.role !== "child");
  const [talking, setTalking] = useState(!!session && !stranded);
  const [talkOver, setTalkOver] = useState(!!session?.ended || stranded);
  const over = noNokt || talkOver;
  // Arriving at the look back: start reading at its top (the mission page may have been scrolled to the quest list).
  useEffect(() => {
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, []);
  const [interest, setInterest] = useState<InterestAnswer | null>(null);
  const [key] = useState(newKey);
  const more = reflection.dimensions;

  const pick = (id: string, value: string | null) => {
    const next = { ...answers, [id]: value };
    setAnswers(next);
    // The tap on the first question is the deliberate gesture Nokt's voice needs; Nokt starts once the answer is saved.
    const startsTalk = id === "difficulty" && !noNokt && !session;
    if (startsTalk) speech.unlock();
    void onFeedback(next).then(() => {
      if (startsTalk) setTalking(true);
    });
  };
  const needsInterest = !interestRecorded && !!reflection.nextInterest;
  const finish = () => {
    if (!over || (needsInterest && !interestReady(interest))) return;
    void onFinish({ op: "reflect", ...(interestRecorded ? {} : interest ? { interest } : {}) }, key);
  };
  const row = (id: string, prompt: string, options: { id: string; label: string }[], skip: string, big = false) => (
    <div key={id} className="flex flex-wrap items-center gap-2" role="group" aria-label={prompt} data-testid={`debrief-row-${id}`}>
      <span className={cn("mr-1 font-semibold", big ? "w-full text-2xl" : "text-base")}>{prompt}</span>
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
  const ideas = debrief?.askingNext
    ? [...(reflection.adventure?.choices.map((c) => ({ id: c.id, label: choiceWord(c), picture: <ChoicePicture picture={c.picture} /> })) ?? debrief.ideas), { id: "unsure", label: "Weiss ich noch nicht" }]
    : null;

  return (
    <div className={cn("grid items-start gap-4", talking && !noNokt && "md:grid-cols-[minmax(0,1fr)_380px]")} data-testid="debrief" data-talking={talking ? "true" : "false"} data-over={over ? "true" : "false"} data-interest={interestRecorded ? "recorded" : "open"}>
      <div className="flex min-w-0 flex-col gap-4">
      <section className="flex items-center gap-4 rounded-3xl p-3" style={{ background: "#f2f7ee" }} data-testid="debrief-result">
        {closing?.plan ? <PlanGrid grid={closing.plan} caption="Dein Plan" highlight compact /> : null}
        {/* Isabel's workshop: the room with what she chose to make (no plan). */}
        {closing?.made ? <div className="w-40 shrink-0"><WorkshopRoom made={closing.made.picture} label={closing.made.room} /></div> : null}
        <div className="min-w-0">
          <h2 className="text-xl font-bold">Geschafft: {view.visit?.title ?? "dein Besuch"}</h2>
          {closing?.success ? <p className="text-base" data-testid="debrief-success">✓ {closing.success}</p> : null}
          {closing?.plan && planCountsText(closing.plan) ? <p className="text-sm" data-testid="debrief-plan-counts">{planCountsText(closing.plan)}</p> : null}
          {closing?.recap ? <p className="text-lg" data-testid="debrief-recap">{closing.recap}</p> : null}
        </div>
      </section>

      {difficultyAnswered ? null : row("difficulty", "Wie leicht war es?", reflection.options, reflection.skipLabel ?? "Lieber nicht sagen", true)}

      {difficultyAnswered && !talking && !noNokt && !over ? (
        // After a reload there is no tap yet that could unlock Nokt's voice: one explicit start.
        <button type="button" className={cn(btn, "self-start")} style={primary} disabled={busy} onClick={() => { speech.unlock(); setTalking(true); }} data-testid="debrief-start">
          Mit Nokt zurückschauen
        </button>
      ) : null}
      {difficultyAnswered && !turn && child !== "isabel" ? (
        <p className="rounded-2xl px-4 py-3 text-base" style={{ background: "#fff8e1" }} data-testid="debrief-no-nokt">
          Nokt kann gerade nicht mit dir zurückschauen. Unten kannst du sagen, was du als Nächstes machen möchtest.
        </p>
      ) : null}

      {difficultyAnswered && over && interestRecorded ? (
        <p className="rounded-2xl px-4 py-3 text-base" style={{ background: "#edf4e6" }} data-testid="debrief-interest">
          Für das nächste Mal gespeichert{debrief?.wish?.text ? `: «${debrief.wish.text}»` : debrief?.wish?.kind === "unsure" ? ": du weisst es noch nicht" : debrief?.wish?.kind === "declined" ? ": du möchtest es lieber nicht sagen" : "."}
        </p>
      ) : difficultyAnswered && over && reflection.nextInterest ? (
        <div className="rounded-3xl border p-4" data-testid="debrief-interest-form">
          {reflection.adventure ? <NextAdventureQuestion adventure={reflection.adventure} labels={reflection.nextInterest} value={interest} onChange={setInterest} disabled={busy} /> : <NextInterestQuestion labels={reflection.nextInterest} value={interest} onChange={setInterest} disabled={busy} />}
        </div>
      ) : null}

      {difficultyAnswered && over ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={btn} style={primary} disabled={busy || (needsInterest && !interestReady(interest))} onClick={finish} data-testid="debrief-finish">
            Fertig — zurück nach Hause
          </button>
        </div>
      ) : null}

      {more.length ? (
        <details className="text-base" data-testid="debrief-more">
          <summary className="cursor-pointer underline">Mehr sagen (freiwillig)</summary>
          <div className="mt-2 grid gap-2">{more.map((d) => row(d.id, d.prompt, d.options, d.skipLabel))}</div>
        </details>
      ) : null}
      <p className="text-sm">{child === "isabel" ? "Mit «Pause» oben machst du eine Pause; deine Antworten bleiben gespeichert." : "Mit «Pause» oben machst du eine Pause; das Gespräch bleibt gespeichert."}</p>
      </div>
      {talking && turn && !noNokt ? (
        <aside className="order-first grid max-h-[calc(100dvh-2rem)] content-start gap-3 overflow-y-auto md:sticky md:top-4 md:order-none" data-testid="nokt-sidebar" data-dock="debrief">
          <NoktTalk key={page} child={child} purpose="debrief" sessionId={session && !session.closed ? session.id : null} initialLines={session?.lines ?? []} opener={!session} ended={!!session?.ended} blocking speech={speech} transcribe={transcribe} turn={turn} title="Nokt schaut mit dir zurück" testId="nokt-debrief" layout="focus" choices={ideas} onEnded={() => setTalkOver(true)} />
        </aside>
      ) : null}
    </div>
  );
}
