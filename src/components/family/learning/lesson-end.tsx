"use client";

// ---------------------------------------------------------------------------
// Lesson end (world-first 2026-10-03; UX-5a / UX-5b; repair round 1 F2–F4,
// visual round 1 V4).
//
// Shown immediately after a learning activity ends, before the next stage.
// Default view = one specific success (or the one correction), the worked
// example when a repair runs, one honest status line and ONE next action;
// every original attempt, help distinction, unscored item and record
// reference stays inspectable behind "Einzelheiten". Repairs: an offer →
// the worked example (recorded as help BEFORE it is shown) → one to three
// retry items of the same reviewed lesson (typing line, label, the child's
// own sentence, the same pick/produce step) → the honest close. The server
// closes a repair when its items are used up; the client only ever mirrors a
// CONFIRMED close, keeps a keyboard-reachable finish/skip when a repair is
// open with nothing left, and keeps every control after a failed save so the
// child can retry (F3). Every claim comes from `LessonFeedback`.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { cn } from "@/components/ui/nabu";
import type { LessonFeedback, Mistake, RetryCue, RetryItem } from "@/lib/family-learning-feedback";
import { alignTyping } from "@/lib/family-learning-typing-metrics";
import { chipButton, focusRing, primaryButton, secondaryButton } from "@/app/family/(shell)/learn/mission/styles";
import { isComposing, useDeliberateFocus } from "./focus";
import { HandsKeyboard, type HomePosition } from "./hands-keyboard";
import { MistakeVisualView } from "./visuals";

export type RetryPayload = { typed?: string; text?: string; response?: string; seconds: number };
export type RetryOutcome = { ok: boolean; result?: "correct" | "incorrect" | "unscored"; remaining: number | null; closed?: boolean; refused?: boolean };

export type LessonEndActions = {
  /** Record the worked example as shown (UX-5b); resolves true when the server confirmed it. */
  onExplain: (repairId: string) => Promise<boolean>;
  /** Save one retry; the same key is reused on a retry after a failed save. */
  onRetry: (repairId: string, item: RetryItem, payload: RetryPayload, idempotencyKey: string) => Promise<RetryOutcome>;
  /** Close the repair; resolves true only when the server confirmed the close. */
  onCloseRepair: (repairId: string, reason: "done" | "skip") => Promise<boolean>;
  onAcknowledge: (id: string) => Promise<boolean>;
};

const KEY_LABEL = (k: string) => (k === " " ? "Leertaste" : k);

function MistakeRow({ m, compact = false }: { m: Mistake; compact?: boolean }) {
  return (
    <li className={cn("flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-2xl px-4 py-3", m.evidence === "incorrect" ? "bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-50" : "bg-secondary text-primary")} data-testid={`mistake-${m.evidence}`} data-mistake-id={m.id} data-count={m.count}>
      <span className="text-base">
        <span className="text-tertiary">Du:</span> <strong className="font-mono text-lg">{m.given}</strong>
      </span>
      {m.expected !== "—" ? (
        <span className="text-base">
          <span className="text-tertiary">Richtig:</span> <strong className="font-mono text-lg">{m.expected}</strong>
        </span>
      ) : null}
      {!compact ? <span className="basis-full text-base">{m.correction}</span> : null}
      {!compact && m.refs.length ? <span className="basis-full text-xs text-tertiary">{m.refs.join(" · ")}</span> : null}
    </li>
  );
}

const RETRY_LABEL = { typing: { correct: "Taste getroffen", incorrect: "daneben", unscored: "nicht bewertet" }, other: { correct: "richtig", incorrect: "noch nicht", unscored: "nicht bewertet" } };

/** One typed retry (a lesson line or the label): type, Enter commits; composition-safe; focus deliberate. */
function TypedRetry({ item, fingers, home, busy, onCommit, gate, showHands }: { item: Extract<RetryItem, { kind: "typing-line" | "label" }>; fingers: Record<string, string>; home: HomePosition | null; busy: boolean; onCommit: (typed: string, seconds: number) => void; gate: () => boolean; showHands: boolean }) {
  const [typed, setTyped] = useState("");
  const startRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useDeliberateFocus(inputRef, `retry:${item.no}:${item.item}`, { gate });
  const expected = item.text;
  const { ops } = alignTyping(expected, typed);
  let consumed = 0;
  for (const op of ops) if (op.kind === "match" || op.kind === "substitute" || op.kind === "omit") consumed += 1;
  let trailing = 0;
  for (let i = ops.length - 1; i >= 0 && ops[i].kind === "omit"; i -= 1) trailing += 1;
  const nextIndex = consumed - trailing;
  const chars = Array.from(expected);
  const nextKey = nextIndex < chars.length ? chars[nextIndex] : null;
  const commit = () => {
    if (busy || typed.length === 0) return;
    onCommit(typed, startRef.current ? Math.max(0, Math.round((Date.now() - startRef.current) / 1000)) : 0);
  };
  return (
    <div className="flex flex-col gap-3" data-testid="retry-line" data-retry-no={item.no} data-retry-purpose={item.purpose} data-retry-kind={item.kind}>
      <p className="text-base text-primary">
        <span className="font-semibold">{item.kind === "label" ? "Schreib das Schild noch einmal genau:" : item.purpose === "correct-original" ? "Noch einmal diese Zeile:" : "Und zur Probe:"}</span> <span className="text-tertiary">Versuch {item.no}</span>
      </p>
      <p className="font-mono text-3xl tracking-widest text-primary" aria-label="Zeile zum Abtippen">
        {chars.map((ch, i) => {
          const typedChars = Array.from(typed);
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
        value={typed}
        onChange={(e) => {
          if (startRef.current === null) startRef.current = Date.now();
          setTyped(Array.from(e.target.value).slice(0, chars.length + 20).join(""));
        }}
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
        className={cn("min-h-16 w-full rounded-2xl border-2 border-primary bg-white px-4 font-mono text-3xl text-primary dark:bg-stone-900", focusRing)}
        aria-label="Hier tippen"
        data-testid="retry-input"
      />
      {showHands && home ? (
        <div className="mx-auto w-full max-w-[680px] rounded-2xl bg-white p-1 dark:bg-stone-900">
          <HandsKeyboard fingers={fingers} home={home} nextKey={nextKey} introduced={chars} compact />
        </div>
      ) : null}
      <button type="button" disabled={busy || typed.length === 0} onClick={commit} className={cn(primaryButton, "self-start")} data-testid="retry-commit">
        Fertig
      </button>
    </div>
  );
}

/** Correct the child's own sentence (writing): the marked sentence stays visible; Enter in the field saves. */
function SentenceRetry({ item, busy, onCommit, gate }: { item: Extract<RetryItem, { kind: "sentence" }>; busy: boolean; onCommit: (text: string) => void; gate: () => boolean }) {
  const [text, setText] = useState(item.text);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useDeliberateFocus(ref, `retry:${item.no}:sentence`, { gate });
  return (
    <div className="flex flex-col gap-3" data-testid="retry-line" data-retry-no={item.no} data-retry-purpose={item.purpose} data-retry-kind="sentence">
      <p className="text-base text-primary">
        <span className="font-semibold">Setz das Leerzeichen ein:</span> <span className="text-tertiary">Versuch {item.no}</span>
      </p>
      <textarea ref={ref} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !isComposing(e)) { e.preventDefault(); if (!busy && text.trim()) onCommit(text); } }} rows={2} maxLength={600} className={cn("rounded-2xl border-2 border-primary bg-white px-4 py-3 text-xl text-primary dark:bg-stone-900", focusRing)} data-testid="retry-sentence" aria-label="Dein Satz" />
      <button type="button" disabled={busy || !text.trim()} onClick={() => onCommit(text)} className={cn(primaryButton, "self-start")} data-testid="retry-commit">
        Fertig
      </button>
    </div>
  );
}

/** The same reviewed pick again (language): options as buttons, first focused. */
/** The applicable cue of ONE language item (its word, gloss and example) — each unresolved word keeps its own (R2-1). */
function RetryCueView({ cue }: { cue: RetryCue }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-secondary px-3 py-2" data-testid="retry-cue" data-cue-word={cue.word}>
      <MistakeVisualView visual={cue.visual} compact />
      <div className="min-w-0">
        <p className="text-base font-semibold text-primary">{cue.title}</p>
        <p className="text-sm text-tertiary">{cue.text}</p>
      </div>
    </div>
  );
}

function PickRetry({ item, busy, onCommit, gate }: { item: Extract<RetryItem, { kind: "pick" }>; busy: boolean; onCommit: (response: string) => void; gate: () => boolean }) {
  const firstRef = useRef<HTMLButtonElement | null>(null);
  useDeliberateFocus(firstRef, `retry:${item.no}:pick`, { gate });
  return (
    <div className="flex flex-col gap-3" data-testid="retry-line" data-retry-no={item.no} data-retry-purpose={item.purpose} data-retry-kind="pick">
      <p className="text-base text-primary">
        <span className="font-semibold">Wähle noch einmal:</span> <span className="text-tertiary">Versuch {item.no}</span>
      </p>
      <RetryCueView cue={item.cue} />
      <p className="text-xl text-primary">{item.text}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="group" aria-label="Lieferung wählen">
        {item.options.map((o, i) => (
          <button key={o.id} ref={i === 0 ? firstRef : undefined} type="button" disabled={busy} onClick={() => onCommit(o.id)} className={cn(chipButton, "min-h-24 flex-col")} data-testid={`retry-pick-${o.id}`}>
            <span className="text-3xl" aria-hidden>
              {o.emoji}
            </span>
            <span className="text-sm text-tertiary">{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** The same reviewed produce frame again (language). */
function ProduceRetry({ item, busy, onCommit, gate }: { item: Extract<RetryItem, { kind: "produce" }>; busy: boolean; onCommit: (response: string) => void; gate: () => boolean }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLInputElement | null>(null);
  useDeliberateFocus(ref, `retry:${item.no}:produce`, { gate });
  return (
    <div className="flex flex-col gap-3" data-testid="retry-line" data-retry-no={item.no} data-retry-purpose={item.purpose} data-retry-kind="produce">
      <p className="text-base text-primary">
        <span className="font-semibold">Sag es noch einmal:</span> <span className="text-tertiary">Versuch {item.no}</span>
      </p>
      <RetryCueView cue={item.cue} />
      <p className="text-2xl text-primary">{item.frame}</p>
      <input ref={ref} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !isComposing(e)) { e.preventDefault(); if (!busy && text.trim()) onCommit(text.trim()); } }} maxLength={200} autoCapitalize="off" autoComplete="off" className={cn("min-h-16 w-full rounded-2xl border-2 border-primary bg-white px-4 text-2xl text-primary dark:bg-stone-900", focusRing)} aria-label="Antwort" data-testid="retry-input" />
      <button type="button" disabled={busy || !text.trim()} onClick={() => onCommit(text.trim())} className={cn(primaryButton, "self-start")} data-testid="retry-commit">
        Senden
      </button>
    </div>
  );
}

type Phase = "feedback" | "explain" | "retry" | "closed";

export function LessonEnd({ feedback, actions, busy, fingers, home, gate }: { feedback: LessonFeedback; actions: LessonEndActions; busy: boolean; fingers: Record<string, string>; home: HomePosition | null; gate: () => boolean }) {
  const repair = feedback.repair;
  // The phase is derived from the SERVER record on mount (a reload lands where the child was) and only moves on confirmed saves.
  // R2-3: a recorded worked example (the support write landed, the response may not have) never implies the child SAW it — the first
  // retry is reachable only through the explanation screen; after a reload with no attempt yet the explanation shows again.
  const [phase, setPhase] = useState<Phase>(() => (repair.status === "open" ? (repair.used > 0 ? "retry" : "explain") : repair.status === "closed" && feedback.mistakes.length ? "closed" : "feedback"));
  const [notice, setNotice] = useState<{ text: string; kind: "info" | "error" } | null>(null);
  const [saving, setSaving] = useState(false);
  const retryKeyRef = useRef<string | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  useDeliberateFocus(primaryRef, `${feedback.id}:${phase}:${repair.retries.length}:${notice?.kind ?? ""}`, { gate, enabled: phase !== "retry" || !repair.items[repair.used] });

  // A repair closed by the server (last retry, replay, other tab) closes here too; never the other way round.
  useEffect(() => {
    if (repair.status === "closed" && phase !== "closed" && phase !== "feedback") setPhase("closed");
    // R2-3: the server already holds the repair open (a lost response, a stale refresh, another tab) while this screen still shows
    // the offer → move to the explanation (nothing attempted yet) or to the next retry; never leave an open repair without controls.
    if (repair.status === "open" && phase === "feedback") setPhase(repair.used > 0 ? "retry" : "explain");
  }, [repair.status, repair.used, phase]);

  // The next item is indexed by the attempts recorded ON the repair; the listed `retries` also hold the in-task attempts (history).
  const nextItem: RetryItem | null = repair.status === "open" ? repair.items[repair.used] ?? null : null;
  const exhaustedOpen = repair.status === "open" && nextItem === null;
  const pattern = feedback.pattern;
  const others = pattern ? feedback.mistakes.filter((m) => m.id !== pattern.id) : feedback.mistakes;
  const labels = feedback.lesson.kind === "typing" && repair.kind !== "label" ? RETRY_LABEL.typing : RETRY_LABEL.other;

  const startRepair = async () => {
    if (!repair.repairId) return;
    setSaving(true);
    setNotice(null);
    const ok = await actions.onExplain(repair.repairId);
    setSaving(false);
    if (ok) setPhase("explain");
    else setNotice({ text: "Das Beispiel konnte nicht gespeichert werden — nochmal versuchen.", kind: "error" });
  };
  const commitRetry = async (payload: RetryPayload) => {
    if (!repair.repairId || !nextItem) return;
    setSaving(true);
    setNotice(null);
    const key = retryKeyRef.current ?? (retryKeyRef.current = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `r-${Date.now()}`);
    const out = await actions.onRetry(repair.repairId, nextItem, payload, key);
    setSaving(false);
    if (!out.ok) {
      setNotice({ text: out.refused ? "Das ging so nicht — schau, wo du jetzt bist." : "Speichern hat nicht geklappt. Dein Versuch ist noch da — nochmal auf Fertig.", kind: "error" });
      return;
    }
    retryKeyRef.current = null;
    setNotice({ text: out.result === "correct" ? "Gut — das hat gestimmt." : out.result === "unscored" ? "Das konnte nicht bewertet werden." : "Noch nicht ganz — schau es dir nochmal an.", kind: "info" });
    // A confirmed close from the server (items used up) is mirrored by the effect above; nothing is assumed here.
  };
  const finishRepair = async (reason: "done" | "skip") => {
    if (!repair.repairId) return;
    setSaving(true);
    setNotice(null);
    const ok = await actions.onCloseRepair(repair.repairId, reason);
    setSaving(false);
    if (ok) setPhase("closed");
    else setNotice({ text: "Abschliessen hat nicht geklappt — nochmal versuchen. Du kannst auch mit Stopp pausieren; alles bis hier ist gespeichert.", kind: "error" });
  };
  const acknowledge = async () => {
    setSaving(true);
    setNotice(null);
    const ok = await actions.onAcknowledge(feedback.id);
    setSaving(false);
    if (!ok) setNotice({ text: "Weiter hat nicht geklappt — nochmal versuchen.", kind: "error" });
  };

  const kindLabel = feedback.lesson.kind === "typing" ? (repair.kind === "label" || feedback.lesson.ref.startsWith("TYPE-LABEL") ? "Schild" : "Tipp-Runde") : feedback.lesson.kind === "math" ? "Aufgabe" : feedback.lesson.kind === "language" ? "Sprach-Szene" : "Schreiben";
  // R2-4: when a repair drives this screen (offered, running, or closed through it), the CURRENT task, phase and outcome is the
  // dominant headline; an earlier genuine success stays visible but subordinate and attributed to the work it describes.
  const repairDriven = pattern !== null && (repair.status === "available" || repair.status === "open" || (repair.status === "closed" && (repair.used > 0 || repair.outcome === "skipped")));
  const focusKey = repair.focus?.startsWith("typing-key:") ? KEY_LABEL(repair.focus.slice("typing-key:".length)) : null;
  const focusWord = repair.focus?.startsWith("language:") ? repair.focus.split(":").pop() ?? null : null;
  const itemWord = nextItem && (nextItem.kind === "pick" || nextItem.kind === "produce") ? nextItem.cue.word : focusWord;
  const taskHeadline = (): string => {
    const closedNow = phase === "closed" || repair.status === "closed";
    if (closedNow) return feedback.close.text || "Gespeichert.";
    if (exhaustedOpen) return "Deine Versuche sind gespeichert.";
    const n = pattern?.count ?? 1;
    switch (repair.kind) {
      case "writing":
        return phase === "explain" ? "So kommt das Leerzeichen an seinen Platz." : phase === "retry" ? "Setz das Leerzeichen in deinen Satz ein." : n > 1 ? `Im neuen Satz fehlen ${n} Leerzeichen.` : "Im neuen Satz fehlt ein Leerzeichen.";
      case "label":
        return phase === "explain" ? "So steht es auf dem Schild." : phase === "retry" ? "Schreib das Schild noch einmal genau." : "Das Schild schauen wir uns an.";
      case "language":
        return phase === "explain" ? `So heisst „${focusWord ?? "das Wort"}“.` : phase === "retry" ? (nextItem?.kind === "produce" ? `Jetzt „${itemWord}“: sag es noch einmal.` : `Jetzt „${itemWord}“: wähle noch einmal.`) : `Ein Wort üben wir: „${focusWord ?? ""}“.`;
      default:
        return phase === "explain" ? `So triffst du „${focusKey ?? ""}“.` : phase === "retry" ? `Jetzt „${focusKey ?? ""}“ üben.` : `Eine Taste üben wir: „${focusKey ?? ""}“.`;
    }
  };
  const headline = repairDriven ? taskHeadline() : feedback.success ? feedback.success.text : feedback.mistakes.length ? "Eine Stelle schauen wir uns an." : feedback.unscored.length ? "Gespeichert — nicht bewertet." : "Gespeichert.";
  const headlineIsClose = repairDriven && (phase === "closed" || repair.status === "closed");
  const showOffer = repair.status === "available" && phase === "feedback";
  const showClose = feedback.close.kind !== "pending" && (repair.status !== "open" || phase === "closed");
  const focusText = repair.focus?.startsWith("typing-key:") ? `„${KEY_LABEL(repair.focus.slice("typing-key:".length))}“` : repair.kind === "writing" ? "das Leerzeichen" : repair.kind === "label" ? "das Schild" : repair.kind === "language" ? "das Wort" : "";

  return (
    <section className="flex flex-col gap-4" data-testid="lesson-end" data-lesson-kind={feedback.lesson.kind} data-lesson-ref={feedback.lesson.ref} data-close={feedback.close.kind} data-repair-status={repair.status} data-repair-kind={repair.kind ?? ""} data-phase={phase} aria-labelledby="lesson-end-title">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-tertiary">{kindLabel} fertig</p>
        <p className="text-sm text-tertiary">{feedback.lesson.title}</p>
      </header>
      <h2 id="lesson-end-title" className="text-2xl font-semibold leading-tight text-primary sm:text-3xl" data-testid={feedback.success && !repairDriven ? "lesson-success" : "lesson-headline"} data-headline-kind={repairDriven ? "task" : "success"} data-basis={feedback.success && !repairDriven ? feedback.success.basis : undefined}>
        {headline}
      </h2>
      {repairDriven && feedback.success ? (
        <p className="-mt-2 text-base text-tertiary" data-testid="lesson-success" data-basis={feedback.success.basis}>
          <span className="mr-2 rounded-full bg-green-100 px-2 py-0.5 text-sm font-semibold text-green-900 dark:bg-green-950/50 dark:text-green-200">Auch richtig</span>
          {feedback.success.text}
        </p>
      ) : null}

      {(phase === "feedback" || phase === "closed") && pattern ? (
        <div data-testid="lesson-pattern">
          <ul className="space-y-2">
            <MistakeRow m={pattern} compact={phase === "closed"} />
          </ul>
          {/* The worked example of a mistake solved in the loop (help shown there) — not for typing (its hands example lives in the repair) and not after a repair, which already showed it. */}
          {pattern.visual && feedback.lesson.kind !== "typing" && repair.status !== "available" && repair.used === 0 ? (
            <div className="mt-3">
              <MistakeVisualView visual={pattern.visual} fingers={fingers} home={home} />
            </div>
          ) : null}
        </div>
      ) : null}
      {(phase === "feedback" || phase === "closed") && !pattern && feedback.unscored.length ? (
        <ul className="space-y-2" data-testid="lesson-unscored-only">
          {feedback.unscored.map((m) => (
            <MistakeRow key={m.id} m={m} />
          ))}
        </ul>
      ) : null}

      {showOffer && repair.explanation ? (
        <div className="rounded-3xl border-2 border-amber-400 bg-amber-50 p-4 dark:border-amber-600 dark:bg-amber-950/40" data-testid="repair-offer">
          <p className="text-lg font-semibold text-primary">Kurz üben? {repair.items.length === 1 ? "Ein Versuch" : `${repair.items.length} Versuche`} für {focusText}.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button ref={primaryRef} type="button" disabled={busy || saving} onClick={() => void startRepair()} className={primaryButton} data-testid="repair-start">
              Zeigen und üben
            </button>
            <button type="button" disabled={busy || saving} onClick={() => void finishRepair("skip")} className={secondaryButton} data-testid="repair-skip">
              Heute nicht
            </button>
          </div>
        </div>
      ) : null}

      {phase === "explain" && repair.explanation ? (
        <div className="rounded-3xl border border-primary bg-primary p-4" data-testid="repair-explain">
          <p className="text-lg font-semibold text-primary">{repair.explanation.title}</p>
          <p className="mt-1 text-base text-primary">{repair.explanation.text}</p>
          <div className="mt-3">
            <MistakeVisualView visual={repair.explanation.visual} fingers={fingers} home={home} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button ref={primaryRef} type="button" disabled={busy || saving} onClick={() => setPhase("retry")} className={primaryButton} data-testid="repair-to-retry">
              Jetzt probieren
            </button>
            <button type="button" disabled={busy || saving} onClick={() => void finishRepair("skip")} className={secondaryButton} data-testid="repair-stop">
              Aufhören
            </button>
          </div>
        </div>
      ) : null}

      {phase === "retry" && nextItem ? (
        <div className="rounded-3xl border border-primary bg-primary p-4" data-testid="repair-retry" data-remaining={repair.remaining}>
          {nextItem.kind === "typing-line" || nextItem.kind === "label" ? (
            <TypedRetry key={`${nextItem.no}:${nextItem.item}`} item={nextItem} fingers={fingers} home={home} busy={busy || saving} onCommit={(typed, seconds) => void commitRetry({ typed, seconds })} gate={gate} showHands={nextItem.kind === "typing-line"} />
          ) : nextItem.kind === "sentence" ? (
            <SentenceRetry key={`${nextItem.no}:${nextItem.item}`} item={nextItem} busy={busy || saving} onCommit={(text) => void commitRetry({ text, seconds: 0 })} gate={gate} />
          ) : nextItem.kind === "pick" ? (
            <PickRetry key={`${nextItem.no}:${nextItem.item}`} item={nextItem} busy={busy || saving} onCommit={(response) => void commitRetry({ response, seconds: 0 })} gate={gate} />
          ) : (
            <ProduceRetry key={`${nextItem.no}:${nextItem.item}`} item={nextItem} busy={busy || saving} onCommit={(response) => void commitRetry({ response, seconds: 0 })} gate={gate} />
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={busy || saving} onClick={() => void finishRepair(repair.used ? "done" : "skip")} className={cn("inline-flex min-h-12 items-center rounded-full px-4 text-base text-tertiary hover:text-primary", focusRing)} data-testid="repair-finish">
              {repair.used ? "Genug geübt" : "Aufhören"}
            </button>
          </div>
        </div>
      ) : null}

      {/* F3: an open repair with nothing left (reload between the last retry and its close, or a close that never arrived) always keeps a way on. */}
      {phase !== "closed" && exhaustedOpen ? (
        <div className="rounded-3xl border border-primary bg-primary p-4" data-testid="repair-exhausted">
          <p className="text-base text-primary">Deine Versuche sind gespeichert. Jetzt abschliessen.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button ref={primaryRef} type="button" disabled={busy || saving} onClick={() => void finishRepair("done")} className={primaryButton} data-testid="repair-finish">
              Abschliessen
            </button>
          </div>
        </div>
      ) : null}

      {notice ? (
        <p className={cn("rounded-2xl px-4 py-2 text-base", notice.kind === "error" ? "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-100" : "bg-secondary text-primary")} role="status" data-testid="retry-notice" data-notice-kind={notice.kind}>
          {notice.text}
        </p>
      ) : null}

      {showClose ? (
        <div className={cn("rounded-3xl p-4", feedback.close.kind === "corrected-with-practice" || feedback.close.kind === "none-needed" ? "bg-green-50 dark:bg-green-950/30" : feedback.close.kind === "unscored" ? "bg-secondary" : "bg-amber-50 dark:bg-amber-950/30")} data-testid="lesson-close" data-close-kind={feedback.close.kind}>
          <p className="text-lg font-semibold text-primary">{headlineIsClose ? "Alles gespeichert." : feedback.close.text}</p>
          <button ref={phase === "closed" || repair.status !== "available" ? primaryRef : undefined} type="button" disabled={busy || saving} onClick={() => void acknowledge()} className={cn(primaryButton, "mt-3")} data-testid="lesson-continue">
            Weiter
          </button>
        </div>
      ) : null}

      {/* Everything inspectable, never deleted: original attempts, help distinctions, unscored items, retries, references. */}
      {others.length || feedback.unscored.length || repair.retries.length || feedback.success || pattern ? (
        <details className="rounded-2xl border border-primary px-4 py-2" data-testid="lesson-details">
          <summary className={cn("cursor-pointer text-base text-primary", focusRing)} data-testid="lesson-all-toggle">
            Einzelheiten{others.length + feedback.unscored.length ? ` (${others.length + feedback.unscored.length} weitere)` : ""}
          </summary>
          <div className="mt-3 space-y-3" data-testid="lesson-all">
            {feedback.success ? (
              <p className="text-sm text-tertiary">
                Erfolg: {feedback.success.text} <span className="text-xs">({feedback.success.basis})</span>
              </p>
            ) : null}
            {pattern && phase === "closed" ? (
              <ul className="space-y-2">
                <MistakeRow m={pattern} />
              </ul>
            ) : null}
            {others.length ? (
              <ul className="space-y-2">
                {others.map((m) => (
                  <MistakeRow key={m.id} m={m} />
                ))}
              </ul>
            ) : null}
            {feedback.unscored.length && pattern ? (
              <div>
                <p className="text-sm font-semibold text-tertiary">Nicht bewertet (kein Fehler, nur unklar):</p>
                <ul className="mt-1 space-y-2">
                  {feedback.unscored.map((m) => (
                    <MistakeRow key={m.id} m={m} />
                  ))}
                </ul>
              </div>
            ) : null}
            {repair.retries.length ? (
              <ul className="flex flex-wrap gap-2 text-sm" data-testid="repair-retries">
                {repair.retries.map((r) => (
                  <li key={`${r.no}-${r.at}`} className={cn("rounded-full px-3 py-1", r.result === "correct" ? "bg-green-100 text-green-900 dark:bg-green-950/50 dark:text-green-200" : r.result === "unscored" ? "bg-secondary text-primary" : "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-100")} data-retry-result={r.result} data-retry-purpose={r.purpose}>
                    {r.purpose === "fresh-check" ? "Probe" : "Versuch"} {r.no}: {labels[r.result]}
                    {r.text ? ` · „${r.text}“` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
            {repair.explanation ? <p className="text-xs text-tertiary">Beispiel gezeigt: {repair.explanation.recorded ? "ja (gespeichert)" : "nein"}.</p> : null}
            {feedback.close.kind === "corrected-with-practice" ? <p className="text-xs text-tertiary">Korrigiert heisst: in der Wiederholung getroffen — ob es sitzt, zeigt sich beim nächsten Mal.</p> : null}
            {feedback.close.kind === "corrected-with-help" ? <p className="text-xs text-tertiary">Dein erster Versuch bleibt gespeichert; die Hilfe ist dazu notiert.</p> : null}
          </div>
        </details>
      ) : null}
    </section>
  );
}
