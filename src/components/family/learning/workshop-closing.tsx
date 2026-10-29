"use client";

// ---------------------------------------------------------------------------------------------------------------------
// Isabel Visit 2+ (narrated workshop) — the closing, one question per screen, every screen spoken by itself (I2-04):
//   1. «Wie war es heute?»  2. «Hat es dir Spass gemacht?»  3. «Was möchtest du nächstes Mal machen?» (pictured)  → goodbye.
// Each answer is saved as she taps it (the existing `closing-feedback` op); «Lieber nicht sagen» is always there and saved as
// skipped, never as an answer. The next-visit choice is her own tap (or an adult writes down her own idea), saved verbatim by
// the existing `reflect` op; nothing is suggested as the right answer or inferred. The goodbye is spoken too (Visit 1's ending
// was text only). Nothing advances by itself.
// ---------------------------------------------------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { cn } from "@/components/ui/nabu";
import type { ChildView } from "@/lib/family-learning-state";
import type { LearningMutateOutcome } from "@/lib/family-learning-client";
import { closingNarration, NARRATION_UI } from "@/lib/family-learning-narration";
import type { NarrationPlayer } from "@/lib/family-narration-player";
import { NarrationControl, useNarration, type NarrationTelemetry } from "./narration";
import type { InterestAnswer } from "./next-interest";
import { GardenerPortrait, WorkshopGarden, WorkshopPictureView } from "./workshop-pictures";

const btn = "inline-flex min-h-16 items-center justify-center gap-2 rounded-2xl px-8 text-xl font-semibold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:opacity-50";
const primary = { background: "#3d5a2a", color: "white" } as const;
const card = "grid min-h-32 w-40 place-items-center gap-1 rounded-3xl border-4 bg-white p-3 text-lg font-semibold disabled:opacity-50";
const FACES: Record<string, string> = { easy: "🙂", right: "😀", tricky: "😣", yes: "😀", partly: "😐", no: "🙁" };
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `reflect-${Date.now()}`);

type Step = "difficulty" | "enjoyment" | "next";

export function WorkshopClosing({ view, busy, narrator, telemetry, onFeedback, onFinish }: {
  view: ChildView;
  busy: boolean;
  narrator: NarrationPlayer;
  telemetry: NarrationTelemetry;
  onFeedback: (feedback: Record<string, string | null | undefined>) => Promise<LearningMutateOutcome | null>;
  /** Saves her next-visit answer and finishes the visit; resolves true when it was saved. */
  onFinish: (payload: Record<string, unknown>, idempotencyKey: string) => Promise<boolean>;
}) {
  const reflection = view.reflection!;
  const closing = reflection.closing ?? null;
  const who = view.visitText?.character ?? "";
  const enjoyment = reflection.dimensions.find((d) => d.id === "enjoyment") ?? null;
  const [answers, setAnswers] = useState<Record<string, string | null | undefined>>(() => ({ ...(closing?.feedback ?? {}) }));
  const [step, setStep] = useState<Step>(() => ("difficulty" in (closing?.feedback ?? {}) ? (enjoyment && !("enjoyment" in (closing?.feedback ?? {})) ? "enjoyment" : "next") : "difficulty"));
  const [interest, setInterest] = useState<InterestAnswer | null>(null);
  const [key] = useState(newKey);
  const adventure = reflection.adventure ?? null;

  const script = useMemo(() => {
    if (step === "difficulty") return closingNarration("difficulty", { prompt: reflection.prompt, options: reflection.options });
    if (step === "enjoyment" && enjoyment) return closingNarration("enjoyment", { prompt: enjoyment.prompt, options: enjoyment.options });
    return closingNarration("next", { prompt: adventure?.prompt ?? reflection.nextInterest?.prompt ?? "", options: [...(adventure?.choices ?? []), { label: NARRATION_UI.ownIdea }, { label: reflection.nextInterest?.unsureLabel ?? "Weiss ich noch nicht" }, { label: NARRATION_UI.thenFinish }] });
  }, [step, reflection, enjoyment, adventure]);
  const narration = useNarration(narrator, script, telemetry);

  const answer = (id: string, value: string | null) => {
    const next = { ...answers, [id]: value };
    setAnswers(next);
    void onFeedback(next);
    setStep(id === "difficulty" && enjoyment ? "enjoyment" : "next");
  };
  const finish = async () => {
    if (!interest || (interest.kind === "text" && !interest.text?.trim())) return;
    narrator.stop();
    await onFinish({ op: "reflect", interest }, key);
  };

  const row = (id: string, options: { id: string; label: string }[], skip: string) => (
    <div className="flex flex-wrap gap-3" role="group" data-testid={`closing-${id}`}>
      {options.map((o) => (
        <button key={o.id} type="button" className={card} style={{ borderColor: answers[id] === o.id ? "#3f7a3a" : "#d9c6aa" }} aria-pressed={answers[id] === o.id} disabled={busy} onClick={() => answer(id, o.id)} data-testid={`${id}-${o.id}`}>
          <span className="text-5xl" aria-hidden>{FACES[o.id] ?? "•"}</span>
          {o.label}
        </button>
      ))}
      <button type="button" className={cn(card, "border-dashed text-base")} style={{ borderColor: "#d9c6aa" }} disabled={busy} onClick={() => answer(id, null)} data-testid={`${id}-skip`}>
        {skip}
      </button>
    </div>
  );

  return (
    <div className="grid gap-5" data-testid="workshop-closing" data-step={step} data-narration={narration.status}>
      <figure className="flex flex-wrap items-center gap-4 rounded-3xl p-4" style={{ background: "#eef5e4" }}>
        <GardenerPortrait name={who} className="h-16 w-16 shrink-0" />
        <p className="min-w-0 flex-1 text-2xl font-semibold" data-testid="closing-question">
          {step === "difficulty" ? reflection.prompt : step === "enjoyment" ? enjoyment?.prompt : adventure?.prompt ?? reflection.nextInterest?.prompt}
        </p>
        <NarrationControl status={narration.status} onReplay={narration.replay} onStop={narration.stop} />
      </figure>
      {step === "difficulty" ? row("difficulty", reflection.options, reflection.skipLabel ?? "Lieber nicht sagen") : null}
      {step === "enjoyment" && enjoyment ? row("enjoyment", enjoyment.options, enjoyment.skipLabel) : null}
      {step === "next" ? (
        <div className="grid gap-4" data-testid="closing-next" data-kind={interest?.kind ?? ""} data-choice={interest?.choice ?? ""}>
          <div className="flex flex-wrap gap-3" role="group" aria-label={adventure?.prompt}>
            {(adventure?.choices ?? []).map((c) => {
              const picked = interest?.kind === "choice" && interest.choice === c.id;
              return (
                <button key={c.id} type="button" className={card} style={{ borderColor: picked ? "#3f7a3a" : "#d9c6aa" }} aria-pressed={picked} disabled={busy} onClick={() => setInterest(picked ? null : { kind: "choice", choice: c.id })} data-testid={`adventure-${c.id}`}>
                  <WorkshopPictureView id={c.picture} />
                  {c.label}
                </button>
              );
            })}
            <button type="button" className={cn(card, "border-dashed")} style={{ borderColor: interest?.kind === "text" ? "#3f7a3a" : "#d9c6aa" }} aria-pressed={interest?.kind === "text"} disabled={busy} onClick={() => setInterest(interest?.kind === "text" ? null : { kind: "text", text: "" })} data-testid="adventure-own">
              <span className="text-4xl" aria-hidden>💬</span>
              {adventure?.ownIdeaLabel ?? "Eigene Idee"}
            </button>
          </div>
          {interest?.kind === "text" ? (
            <label className="grid gap-1 text-base">
              <span>Für Papa oder Mama: Schreibt ihre Idee mit ihren Worten auf.</span>
              <textarea value={interest.text ?? ""} rows={2} maxLength={300} onChange={(e) => setInterest({ kind: "text", text: e.target.value })} className="w-full rounded-2xl border-2 px-4 py-3 text-lg" style={{ borderColor: "#d9c6aa" }} data-testid="adventure-own-text" />
            </label>
          ) : null}
          <div className="flex flex-wrap gap-3">
            {(["unsure", "declined"] as const).map((k) => (
              <button key={k} type="button" className="inline-flex min-h-12 items-center rounded-full border-2 px-4 text-base font-semibold" style={{ borderColor: interest?.kind === k ? "#3f7a3a" : "#d9c6aa", background: "white" }} aria-pressed={interest?.kind === k} disabled={busy} onClick={() => setInterest(interest?.kind === k ? null : { kind: k })} data-testid={`next-interest-${k}`}>
                {k === "unsure" ? reflection.nextInterest?.unsureLabel ?? "Weiss ich noch nicht" : reflection.nextInterest?.declineLabel ?? "Lieber nicht sagen"}
              </button>
            ))}
          </div>
          <button type="button" className={cn(btn, "justify-self-start")} style={primary} disabled={busy || !interest || (interest.kind === "text" && !interest.text?.trim())} onClick={() => void finish()} data-testid="closing-finish">
            Fertig <span aria-hidden>✓</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** The spoken goodbye after the closing (her garden, the reviewed goodbye lines, one way home). */
export function WorkshopFarewell({ who, lines, grown, label, narrator, telemetry, onHome }: { who: string; lines: string[]; grown: string | null; label: string; narrator: NarrationPlayer; telemetry: NarrationTelemetry; onHome: () => void }) {
  const script = useMemo(() => closingNarration("farewell", { lines }), [lines]);
  const narration = useNarration(narrator, script, telemetry);
  return (
    <div className="mx-auto grid max-w-3xl gap-5 px-4 py-6" data-testid="workshop-farewell" data-narration={narration.status}>
      <figure className="flex flex-wrap items-center gap-4 rounded-3xl p-4" style={{ background: "#eef5e4" }}>
        <GardenerPortrait name={who} className="h-20 w-20 shrink-0" />
        <div className="grid min-w-0 flex-1 gap-1">
          {lines.map((l) => (
            <p key={l} className="text-2xl font-semibold">{l}</p>
          ))}
        </div>
        <NarrationControl status={narration.status} onReplay={narration.replay} onStop={narration.stop} />
      </figure>
      <WorkshopGarden grown={grown} label={label} />
      <button type="button" className={cn(btn, "justify-self-start")} style={primary} onClick={() => { narrator.stop(); onHome(); }} data-testid="farewell-home">
        <span aria-hidden>🏠</span> Nach Hause
      </button>
    </div>
  );
}
