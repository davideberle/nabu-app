"use client";

// ---------------------------------------------------------------------------
// Visit 8 (content v7) — the short spoken look back that replaces the click-through summary.
//
//  1. The visible result first: his own plan, one success that actually happened, one next step (all from the records).
//  2. Three optional buttons (how it was, fun, clear) — saved BEFORE Nokt speaks, so the look back can use his answers.
//  3. «Mit Nokt zurückschauen»: Nokt asks one short question at a time about his actual work and his buttons, answers what
//     he says, and finally asks what he wants next — his own words are saved verbatim by the server. 1–2 minutes, no test,
//     no endless gate: «Fertig» is always there; the global Stopp pauses (the conversation is saved and continues).
//  4. Without Nokt (switched off, no connection, used-up day) the same closing works with the reviewed next-adventure
//     choices — honestly labelled, nothing pretends Nokt spoke.
// The detailed parent evidence stays separate; nothing here is an assessment, a completion or a reward.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { cn } from "@/components/ui/nabu";
import type { ChildView } from "@/lib/family-learning-state";
import type { ChildId } from "@/lib/family-assistant-turn";
import type { ChildSpeechPlayer } from "@/lib/family-speech";
import type { LearningMutateOutcome } from "@/lib/family-learning-client";
import { PlanGrid } from "./plan-grid";
import { NoktTalk, type NoktTalkTurnFn } from "./nokt-talk";
import { NextAdventureQuestion, NextInterestQuestion, interestReady, type InterestAnswer } from "./next-interest";
import type { NoktTranscribe } from "./nokt-panel";

const btn = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 text-lg font-semibold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:opacity-50";
const primary = { background: "#215c60", color: "white" } as const;
const chip = "inline-flex min-h-12 items-center rounded-full border-2 px-4 text-lg font-semibold disabled:opacity-50";

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
  const visitId = view.visit?.id ?? "";
  const page = `visit:${visitId}:debrief`;
  const session = talk?.sessions.find((s) => s.purpose === "debrief" && s.page === page) ?? null;
  const interestRecorded = !!talk?.debrief?.interestRecorded;
  const [answers, setAnswers] = useState<Record<string, string | null | undefined>>(() => ({ ...(closing?.feedback ?? {}) }));
  const [talking, setTalking] = useState(!!session);
  const [interest, setInterest] = useState<InterestAnswer | null>(null);
  const [key] = useState(newKey);
  const rows = [{ id: "difficulty", prompt: reflection.prompt, options: reflection.options, skipLabel: reflection.skipLabel ?? "Lieber nicht sagen" }, ...reflection.dimensions];

  const pick = (id: string, value: string | null) => {
    const next = { ...answers, [id]: value };
    setAnswers(next);
    void onFeedback(next);
  };
  const finish = () => {
    if (!interestRecorded && reflection.nextInterest && !interestReady(interest)) return;
    void onFinish({ op: "reflect", ...(interestRecorded ? {} : interest ? { interest } : {}) }, key);
  };
  const latest = view.latestInterest && view.latestInterest.visit === visitId ? view.latestInterest : null;

  return (
    <div className="flex flex-col gap-5" data-testid="debrief" data-talking={talking ? "true" : "false"} data-interest={interestRecorded ? "recorded" : "open"}>
      <section className="grid gap-3 rounded-3xl p-4" style={{ background: "#f2f7ee" }} data-testid="debrief-result">
        <h2 className="text-2xl font-bold">Geschafft: {view.visit?.title ?? "dein Besuch"}</h2>
        {closing?.plan ? <PlanGrid grid={closing.plan} caption={`Dein Plan: ${closing.plan.label}`} highlight /> : null}
        {closing?.success ? <p className="text-lg" data-testid="debrief-success">✓ {closing.success}</p> : null}
        {closing?.artifact ? <p className="text-base" data-testid="debrief-artifact">Im Gewächshaus: {closing.artifact}</p> : null}
      </section>

      <section className="grid gap-4" aria-label="Wie war es heute?" data-testid="debrief-buttons">
        {rows.map((row) => (
          <div key={row.id}>
            <p className="text-lg font-semibold">{row.prompt}</p>
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={row.prompt}>
              {row.options.map((o) => (
                <button key={o.id} type="button" className={cn(chip, answers[row.id] === o.id && "ring-2 ring-stone-600")} style={{ borderColor: "#8ba8a4", background: "white" }} aria-pressed={answers[row.id] === o.id} disabled={busy} onClick={() => pick(row.id, o.id)} data-testid={`${row.id}-${o.id}`}>
                  {o.label}
                </button>
              ))}
              <button type="button" className={cn(chip, answers[row.id] === null && "ring-2 ring-stone-600")} style={{ borderColor: "#d6c3a3", background: "#fffdf6" }} aria-pressed={answers[row.id] === null} disabled={busy} onClick={() => pick(row.id, null)} data-testid={`${row.id}-skip`}>
                {row.skipLabel}
              </button>
            </div>
          </div>
        ))}
        <p className="text-sm">Freiwillig — du musst nichts sagen.</p>
      </section>

      {turn ? (
        talking ? (
          <NoktTalk key={page} child={child} purpose="debrief" sessionId={session && !session.closed ? session.id : null} initialLines={session?.lines ?? []} opener={!session} speech={speech} transcribe={transcribe} turn={turn} title="Mit Nokt zurückschauen" testId="nokt-debrief" />
        ) : (
          <button type="button" className={cn(btn, "self-start")} style={primary} disabled={busy} onClick={() => { speech.unlock(); setTalking(true); }} data-testid="debrief-start">
            Mit Nokt zurückschauen
          </button>
        )
      ) : (
        <p className="rounded-2xl px-4 py-3 text-base" style={{ background: "#fff8e1" }} data-testid="debrief-no-nokt">
          Nokt kann gerade nicht mit dir zurückschauen. Unten kannst du sagen, was du als Nächstes machen möchtest.
        </p>
      )}

      {interestRecorded ? (
        <p className="rounded-2xl px-4 py-3 text-lg" style={{ background: "#edf4e6" }} data-testid="debrief-interest">
          Dein Wunsch für das nächste Mal ist gespeichert{latest?.text ? `: «${latest.text}»` : "."}
        </p>
      ) : reflection.nextInterest ? (
        <div className="rounded-3xl border p-4" data-testid="debrief-interest-form">
          {reflection.adventure ? (
            <NextAdventureQuestion adventure={reflection.adventure} labels={reflection.nextInterest} value={interest} onChange={setInterest} disabled={busy} />
          ) : (
            <NextInterestQuestion labels={reflection.nextInterest} value={interest} onChange={setInterest} disabled={busy} />
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={btn} style={primary} disabled={busy || (!interestRecorded && !!reflection.nextInterest && !interestReady(interest))} onClick={finish} data-testid="debrief-finish">
          Fertig — zurück nach Hause
        </button>
        <p className="text-sm">Mit «Stopp» oben kannst du jederzeit aufhören; alles bleibt gespeichert.</p>
      </div>
    </div>
  );
}
