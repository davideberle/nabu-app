"use client";

// ---------------------------------------------------------------------------
// Visit 7 — the scene mission (content v6, `presentation: "scene"`).
//
// Approved direction (David, 2026-10-23 08:30/08:51): one coherent illustrated
// scene with the speaking character in a large speech bubble; the facts the
// task needs stay visible in that bubble (no hidden notebook); ONE complete
// question directly above its answer and unit; the check button on its own
// row; amber retry and green ✓ success in words, a distinct next action; the
// reviewed hint lower down with its content directly beneath it; Nokt as a
// separate bottom-right control that opens a side panel beside the task on
// tablet/desktop and in the page flow on narrow screens.
//
// Everything that helps is requested from the server and shown only after it
// was recorded (hint, word options, text of the message, translation, worked
// solution). Character lines are spoken through the language-aware speech
// route; when no voice of that language exists the browser speaks it in that
// language. Nokt is unavailable in every deployed build and says so in child
// words; nothing here pretends a tutor answered.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/components/ui/nabu";
import type { ChildView } from "@/lib/family-learning-state";
import type { MissionActiveView, MissionView, SolvePartView } from "@/lib/family-learning-mission";
import type { MissionDiagram } from "@/lib/family-learning-mission-spec";
import type { ChildId } from "@/lib/family-assistant-turn";
import type { ChildSpeechPlayer } from "@/lib/family-speech";
import type { NoktMode } from "@/lib/family-learning-nokt";
import { browserSpeech, playListening } from "@/lib/family-learning-listening";
import { TypingBlock, type Act } from "./mission-world";
import { NoktButton, NoktPanel, type NoktTranscribe, type NoktTurnFn } from "./nokt-panel";
import { PlanGrid } from "./plan-grid";
import { Counters } from "./workshop-pictures";
import rosaHarbor from "@/assets/family-learning/visit7/rosa-research-harbor.webp";

// The palette of the approved preview: sea-green ink, parchment cards, amber retry, green success.
const INK = "#203b3d";
const DEEP = "#173e42";
const ACTION = "#215c60";
const CARD = "#fffefa";
const WARN_BG = "#fff1d8";
const WARN_INK = "#794100";
const WARN_EDGE = "#c77c14";
const OK_BG = "#e6f3e7";
const OK_INK = "#245733";
const OK_EDGE = "#42864f";

const btn = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 text-lg font-semibold transition-colors focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";
const primary = { background: ACTION, color: "white" } as const;
const secondary = { background: "#e6eee7", color: "#21484b" } as const;
const nextStyle = { background: DEEP, color: "white" } as const;
const card = "rounded-3xl p-5 shadow-sm sm:p-7";

export type SceneTelemetry = (name: "hint-open" | "nokt-offer-dismiss" | "line-audio" | "listen-play" | "beat-next" | "tutor-open" | "tutor-close" | "narration-replay" | "narration-stop" | "narration-unlock" | "narration-recorded" | "narration-device-de" | "narration-no-german-voice" | "narration-blocked") => void;

export type MissionSceneProps = {
  child: ChildId;
  view: ChildView;
  mission: MissionView;
  busy: boolean;
  act: Act;
  speech: ChildSpeechPlayer;
  noktMode: NoktMode;
  /** Uploads one Nokt push-to-talk turn for this child; only used where the panel has a microphone. */
  noktTranscribe?: NoktTranscribe | null;
  /** One Nokt turn through the server; only reached where the server enables Nokt's conversation. */
  noktTurn?: NoktTurnFn | null;
  telemetry: SceneTelemetry;
};

export function MissionScene({ child, view, mission, busy, act, speech, noktMode, noktTranscribe = null, noktTurn = null, telemetry }: MissionSceneProps) {
  const active = mission.active;
  const beat = mission.beat ?? { index: 1, count: mission.steps.length, next: null };
  const [noktOpen, setNoktOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const opened = useRef(false);

  // The very first beat is a story beat: open it so Rosa's request is on screen without an extra tap (no exposure is written for it).
  useEffect(() => {
    if (opened.current || busy || active) return;
    const firstStory = beat.index === 1 && beat.next && mission.steps.find((s) => s.id === beat.next)?.kind === "story" && mission.steps.every((s) => s.status === "available" || s.status === "locked");
    if (firstStory) {
      opened.current = true;
      void act({ a: "open", step: beat.next! });
    }
  }, [active, beat.index, beat.next, busy, mission.steps, act]);
  // A different beat starts reading at its heading; Nokt closes with its task (a task change cancels a stale conversation).
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    setNoktOpen(false);
    speech.cancel();
  }, [active?.id, speech]);

  const next = async () => {
    telemetry("beat-next");
    // Scene missions are linear (each beat requires the one before): the next beat is the following step in the reviewed order.
    const index = active ? mission.steps.findIndex((s) => s.id === active.id) : -1;
    if (active) {
      if (active.status === "active" && (active.kind === "story" || active.kind === "outcome")) {
        const done = await act({ a: "story-done", step: active.id });
        // The ending's goodbye line is shown before the visit closes.
        if (!done || active.kind === "outcome") return;
      }
      const left = await act({ a: "leave" });
      if (!left) return;
    }
    const upcoming = active ? mission.steps[index + 1] ?? null : mission.steps.find((s) => s.status === "available" || s.status === "active") ?? null;
    if (upcoming) await act({ a: "open", step: upcoming.id });
    else await act({ a: "finish" });
  };

  const openNokt = (entry: "manual" | "offer", part: string | null) => {
    setNoktOpen(true);
    telemetry("tutor-open");
    if (active) void act({ a: "tutor-open", step: active.id, entry, part });
  };

  // A tutor's repeated-error offer lives in the side panel (approved preview), only when a verified tutor exists — never in this build.
  const offerPart = active?.tutor?.available ? active.tutor.offerPart : null;
  useEffect(() => {
    if (offerPart) setNoktOpen(true);
  }, [offerPart]);
  const lines = active ? (active.status === "active" ? active.intro : active.done) : [];
  const speakerId = lines.find((l) => l.speaker)?.speaker ?? active?.character ?? null;
  const speaker = speakerId ? mission.characters.find((c) => c.id === speakerId) ?? null : null;
  const facts = active?.solve?.facts ?? null;

  return (
    <div className={cn("grid items-start gap-4 pb-24", noktOpen && "md:grid-cols-[minmax(0,1fr)_360px]")} style={{ color: INK }} data-testid="mission-scene" data-step={active?.id ?? ""} data-kind={active?.kind ?? ""} data-status={active?.status ?? ""} data-phase={active?.phase ?? ""}>
      <div className="grid min-w-0 content-start gap-4">
        {active?.kind === "typing-block" ? null : (
          <figure className="relative overflow-hidden rounded-3xl" style={{ background: "#529eaa" }} data-testid="scene-figure">
            {/* eslint-disable-next-line @next/next/no-img-element -- build-time static asset served under the child access gate */}
            <img src={rosaHarbor.src} width={rosaHarbor.width} height={rosaHarbor.height} alt={mission.scene?.alt ?? ""} className={cn("block w-full object-cover", active && active.kind !== "story" && active.kind !== "outcome" ? "h-[min(38vh,340px)]" : "h-[min(48vh,420px)]")} style={{ objectPosition: "70% 30%" }} />
            {lines.length || facts ? (
              <div className={cn("relative mx-3 -mt-6 mb-3 rounded-3xl px-5 py-4 shadow-lg", noktOpen ? "xl:absolute xl:left-6 xl:top-6 xl:m-0 xl:max-w-[min(52%,520px)]" : "sm:absolute sm:left-6 sm:top-6 sm:m-0 sm:max-w-[min(62%,520px)]")} style={{ background: "#fffef6" }} data-testid="scene-bubble" role="group" aria-label={speaker ? `${speaker.name} sagt` : "Erzählung"}>
                <span aria-hidden className={cn("absolute -right-4 bottom-6 hidden border-[12px] border-transparent", noktOpen ? "xl:block" : "sm:block")} style={{ borderLeftColor: "#fffef6" }} />
                {speaker ? <p className="text-sm font-bold uppercase tracking-wide" style={{ color: "#a34431" }}>{speaker.name}</p> : null}
                <BubbleLines lines={lines} child={child} step={active?.id ?? ""} offset={active && active.status !== "active" ? active.intro.length : 0} act={act} busy={busy} speech={speech} telemetry={telemetry} />
                {facts ? (
                  <ul className="mt-2 flex flex-wrap gap-2" aria-label="Was du weisst" data-testid="scene-facts">
                    {facts.map((f) => (
                      <li key={f} className="rounded-full px-3 py-1 text-base font-semibold" style={{ background: "#edf4e6" }}>
                        {f}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </figure>
        )}

        <section className={card} style={{ background: CARD }} aria-labelledby="scene-task-title" data-testid="scene-task">
          <h2 id="scene-task-title" ref={headingRef} tabIndex={-1} className="mb-3 text-base font-semibold outline-none" style={{ color: "#627876" }} data-testid="scene-beat">
            {active ? active.title : beat.next ? "Weiter im Inselgarten" : "Geschafft"} ·{" "}
            {active?.solve && active.status === "active" ? `Frage ${Math.min(active.solve.parts.filter((x) => x.status !== "open").length + 1, active.solve.total)} von ${active.solve.total}` : `Teil ${beat.index} von ${beat.count}`}
          </h2>
          {!active ? (
            <button type="button" className={btn} style={nextStyle} disabled={busy} onClick={() => void next()} data-testid="scene-next">
              {beat.next ? "Weiter" : "Zum Abschluss"}
            </button>
          ) : (
            <ActiveTask child={child} view={view} mission={mission} active={active} busy={busy} act={act} speech={speech} telemetry={telemetry} onNext={() => void next()} />
          )}
        </section>
      </div>

      {noktOpen ? (
        <NoktPanel
          child={child}
          mode={noktMode}
          step={active?.id ?? null}
          part={active?.solve?.current ?? null}
          speech={speech}
          transcribe={noktTranscribe}
          turn={noktTurn}
          offer={offerPart && active ? { onAccept: () => void act({ a: "tutor-offer", step: active.id, part: offerPart, response: "accepted" }), onDismiss: () => { telemetry("nokt-offer-dismiss"); void act({ a: "tutor-offer", step: active.id, part: offerPart, response: "dismissed" }); setNoktOpen(false); } } : null}
          onClose={() => { setNoktOpen(false); telemetry("tutor-close"); }}
        />
      ) : (
        <NoktButton child={child} onOpen={() => openNokt("manual", active?.solve?.current ?? null)} />
      )}
    </div>
  );
}

// --- the speech bubble ----------------------------------------------------------

function BubbleLines({ lines, child, step, offset, act, busy, speech, telemetry }: { lines: MissionActiveView["intro"]; child: ChildId; step: string; offset: number; act: Act; busy: boolean; speech: ChildSpeechPlayer; telemetry: SceneTelemetry }) {
  return (
    <div className="grid gap-2">
      {lines.map((l, i) => {
        const foreign = l.language !== "de";
        return (
          <div key={i} data-testid="bubble-line" data-language={l.language}>
            <p className={cn("leading-snug", foreign ? "text-xl font-semibold" : "text-lg sm:text-xl")} lang={l.language}>
              {l.text}
            </p>
            {foreign ? (
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <LineAudio text={l.text} language={l.language as "en" | "es"} child={child} speech={speech} onPlayed={(outcome) => { telemetry("line-audio"); void act({ a: "line-audio", step, line: i + offset, outcome }); }} />
                {l.translated ? (
                  <span className="text-base italic" data-testid="bubble-translation">
                    Auf Deutsch: {l.translated}
                  </span>
                ) : (
                  <button type="button" className="text-base font-semibold underline underline-offset-4" disabled={busy} onClick={() => void act({ a: "support", step, kind: "line-translation", line: i + offset })} data-testid="bubble-translate">
                    Was heisst das? (Hilfe)
                  </button>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function LineAudio({ text, language, child, speech, onPlayed }: { text: string; language: "en" | "es"; child: ChildId; speech: ChildSpeechPlayer; onPlayed: (outcome: "child-voice" | "browser" | "failed") => void }) {
  const [state, setState] = useState<"idle" | "playing" | "failed">("idle");
  const play = async () => {
    speech.unlock();
    setState("playing");
    // The character speaks in its own language; with no voice for that language the browser speaks it — never the wrong accent.
    const outcome = await playListening(text, language, { voice: (t) => speech.speak({ childId: child, text: t, language, speaker: "character" }), browser: browserSpeech() });
    if (outcome === "cancelled") return setState("idle");
    setState(outcome === "failed" ? "failed" : "idle");
    onPlayed(outcome);
  };
  return (
    <button type="button" className="inline-flex items-center gap-1 text-base font-semibold underline underline-offset-4" onClick={() => void play()} disabled={state === "playing"} data-testid="bubble-audio" data-state={state}>
      <SpeakerIcon /> {state === "playing" ? "… spielt" : state === "failed" ? "Ton geht nicht — nochmal?" : "Anhören"}
    </button>
  );
}

function SpeakerIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7" />
    </svg>
  );
}

// --- one beat ------------------------------------------------------------------------

function ActiveTask({ child, view, mission, active, busy, act, speech, telemetry, onNext }: { child: ChildId; view: ChildView; mission: MissionView; active: MissionActiveView; busy: boolean; act: Act; speech: ChildSpeechPlayer; telemetry: SceneTelemetry; onNext: () => void }) {
  void view;
  const finished = active.status !== "active";
  const nextLabel = mission.beat?.next || mission.steps.some((s) => s.status === "available" && s.id !== active.id) ? "Weiter" : "Zum Abschluss";
  if (active.kind === "story" || active.kind === "outcome") {
    return (
      <div className="grid gap-4" data-testid="story-task">
        {active.diagram ? <Trays diagram={active.diagram} label={active.kind === "outcome" ? "Im Gewächshaus" : "Die Lieferung"} /> : null}
        {(active.shipments ?? []).map((sh) => (
          <Trays key={sh.label} diagram={sh.diagram} label={sh.label} />
        ))}
        {active.ending ? (
          <div className="grid gap-2" data-testid="scene-ending">
            {active.ending.success ? <Feedback tone="success" text={active.ending.success} /> : null}
            <p className="text-lg">{active.ending.next}</p>
          </div>
        ) : null}
        <button type="button" className={cn(btn, "justify-self-start")} style={nextStyle} disabled={busy} onClick={onNext} data-testid="scene-next">
          {active.id === mission.steps[0]?.id && !finished ? "Los geht's" : active.kind === "outcome" ? (finished ? "Zum Abschluss" : "Fertig") : "Weiter"}
        </button>
      </div>
    );
  }
  return (
    <div className="grid gap-4">
      {active.kind === "solve" && active.solve ? <SolveTask active={active} busy={busy} act={act} telemetry={telemetry} /> : null}
      {active.kind === "listen" ? <ListenTask child={child} active={active} busy={busy} act={act} speech={speech} telemetry={telemetry} /> : null}
      {active.kind === "recall" || active.kind === "produce" ? <RequestTask active={active} busy={busy} act={act} telemetry={telemetry} /> : null}
      {active.kind === "typing-block" && active.typing ? <TypingBlock block={active.typing} stepId={active.id} busy={busy} act={act} /> : null}
      {active.kind === "write" && active.write ? <WriteTask active={active} busy={busy} act={act} /> : null}
      {finished ? (
        <button type="button" className={cn(btn, "justify-self-start")} style={nextStyle} disabled={busy} onClick={onNext} data-testid="scene-next" autoFocus>
          {nextLabel}
        </button>
      ) : null}
    </div>
  );
}

export { SpeakerIcon };

export function Feedback({ tone, text, testId = "scene-feedback" }: { tone: "retry" | "stuck" | "success" | "taught" | "practice-wrong"; text: string; testId?: string }) {
  const good = tone === "success";
  const neutral = tone === "taught";
  return (
    <p
      className="rounded-xl px-4 py-3 text-lg leading-relaxed"
      style={good ? { background: OK_BG, color: OK_INK, borderLeft: `5px solid ${OK_EDGE}` } : neutral ? { background: "#eef1e8", color: INK, borderLeft: `5px solid ${ACTION}` } : { background: WARN_BG, color: WARN_INK, borderLeft: `5px solid ${WARN_EDGE}` }}
      role="status"
      data-testid={testId}
      data-tone={tone}
    >
      {good ? "✓ " : ""}
      {text}
    </p>
  );
}

// --- a problem, one question at a time ------------------------------------------------

export function SolveTask({ active, busy, act, telemetry, applicationNote = "Eine neue Lieferung, neue Zahlen.", quiet = false, onSeen }: { active: MissionActiveView; busy: boolean; act: Act; telemetry: SceneTelemetry; applicationNote?: string; /** Isabel Visit 2 (narrated): less reading — no application note, no «try first» line (the narration says what to do). */ quiet?: boolean; /** Isabel Visit 2: the questions whose success she has moved past (for the narration script). */ onSeen?: (ids: string[]) => void }) {
  const sv = active.solve!;
  const finished = active.status !== "active";
  // After a correct answer the success stays on screen with its own "next question" action; the next question follows on tap.
  // Parts already resolved when this view mounts (reload, Stopp and back) were seen before: return straight to the open question.
  const [seen, setSeen] = useState<string[]>(() => sv.parts.filter((p) => p.status !== "open").map((p) => p.id));
  useEffect(() => {
    onSeen?.(seen);
  }, [seen, onSeen]);
  const resolved = sv.parts.filter((p) => p.status !== "open");
  const lastResolved = resolved[resolved.length - 1] ?? null;
  const waiting = !finished && lastResolved && !seen.includes(lastResolved.id) && sv.parts.some((p) => p.status === "open") ? lastResolved : null;
  const current = waiting ? null : sv.parts.find((p) => p.status === "open") ?? null;
  const shownIndex = current ? sv.parts.indexOf(current) + 1 : Math.min(resolved.length, sv.total);
  return (
    <div className="grid gap-4" data-testid="solve-task" data-part={current?.id ?? waiting?.id ?? ""}>
      {sv.application && !quiet ? <p className="text-base font-semibold">{applicationNote}</p> : null}
      {resolved.length && !quiet ? (
        <ul className="grid gap-1" aria-label="Schon beantwortet" data-testid="solve-answered">
          {resolved.filter((p) => p !== waiting).map((p) => (
            <li key={p.id} className="text-base">
              <span style={{ color: p.status === "correct" ? OK_INK : INK }}>{p.status === "correct" ? "✓" : "•"}</span> {p.question} <strong>{p.value ?? "—"} {p.unit}</strong>
            </li>
          ))}
        </ul>
      ) : null}
      {waiting ? (
        <div className="grid gap-3">
          <p className="text-xl font-semibold">{waiting.question}</p>
          {waiting.feedback ? <Feedback tone={waiting.feedback.tone} text={waiting.feedback.text} /> : null}
          <button type="button" className={cn(btn, "justify-self-start")} style={nextStyle} onClick={() => setSeen((s) => [...s, waiting.id])} autoFocus data-testid="solve-next-question">
            Nächste Frage
          </button>
        </div>
      ) : null}
      {current ? <PartTask key={current.id} part={current} step={active.id} busy={busy} act={act} telemetry={telemetry} quiet={quiet} /> : null}
      {finished ? (
        <>
          {lastResolved?.feedback ? <Feedback tone={lastResolved.feedback.tone} text={lastResolved.feedback.text} /> : null}
          {sv.diagram ? <Trays diagram={sv.diagram} label={`So werden die ${sv.diagram.unit} verpackt`} /> : null}
        </>
      ) : null}
    </div>
  );
}

function PartTask({ part, step, busy, act, telemetry, quiet = false }: { part: SolvePartView; step: string; busy: boolean; act: Act; telemetry: SceneTelemetry; quiet?: boolean }) {
  const [value, setValue] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // One submission at a time: a double tap or a second Enter while the first is in flight is not a second answer.
  const sending = useRef(false);
  const taught = part.phase === "taught";
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, [part.id, part.tries, taught]);
  const submit = async () => {
    const v = value.trim();
    // Accidental Enter / empty or incomplete input never becomes an attempt.
    if (!/^\d{1,4}$/.test(v)) {
      setNotice("Trag eine ganze Zahl ein. Dann drück auf «Antwort prüfen».");
      return;
    }
    if (sending.current) return;
    sending.current = true;
    setNotice(null);
    // The same idempotency key covers network retries of THIS submission; a later deliberate submission gets a new key.
    const key = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `part-${Date.now()}`;
    const res = await act(taught ? { a: "practice-part", step, part: part.id, value: v } : { a: "answer-part", step, part: part.id, value: v }, { idempotencyKey: key });
    sending.current = false;
    if (res) setValue("");
  };
  return (
    <div className="grid gap-4">
      {/* Isabel's workshop: the exact quantities of this question, drawn from the data (absent for every Santiago question). */}
      {part.counters ? <Counters counters={part.counters} caption={!quiet} /> : null}
      {taught ? <p className="text-xl font-semibold leading-snug">{part.question}</p> : null}
      {taught && part.teach ? (
        <div className="rounded-2xl px-4 py-3 text-lg" style={{ background: "#eef1e8", borderLeft: `5px solid ${ACTION}` }} data-testid="part-teach">
          <p className="font-semibold">So rechnet man es:</p>
          <p className="mt-1">{part.teach}</p>
        </div>
      ) : null}
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void submit();
        }}
      >
        <label htmlFor={`part-${part.id}`} className="text-2xl font-semibold leading-snug" data-testid="part-question">
          {taught ? "Trag die Zahl jetzt selbst ein:" : part.question}
        </label>
        <div className="flex items-center gap-3">
          <input id={`part-${part.id}`} ref={inputRef} value={value} onChange={(e) => {
              setNotice(null);
              setValue(e.target.value.replace(/[^0-9]/g, "").slice(0, 4));
            }} inputMode="numeric" autoComplete="off" className="h-14 w-28 rounded-xl border-2 px-3 text-2xl font-semibold disabled:opacity-50" style={{ borderColor: "#8ba8a4" }} aria-describedby={`unit-${part.id}`} data-testid="part-input" />
          <span id={`unit-${part.id}`} className="text-2xl font-semibold">
            {part.unit}
          </span>
        </div>
        <div>
          <button type="submit" className={btn} style={primary} disabled={busy || !value.trim()} data-testid="part-check">
            {quiet ? <><span aria-hidden>✓</span> Prüfen</> : taught ? "Eintragen" : "Antwort prüfen"}
          </button>
        </div>
      </form>
      {notice ? <Feedback tone="retry" text={notice} /> : part.feedback ? <Feedback tone={part.feedback.tone} text={part.feedback.text} /> : null}
      {taught && part.status === "open" && part.practiceLeft === 0 ? (
        <button type="button" className={cn(btn, "justify-self-start")} style={secondary} disabled={busy} onClick={() => void act({ a: "later-part", step, part: part.id })} data-testid="part-later">
          Für später aufheben
        </button>
      ) : null}
      {/* Narrated (quiet): once the worked solution is shown, the earlier hint steps are no longer on screen. */}
      {quiet && taught ? null : <HintArea part={part} step={step} busy={busy} act={act} telemetry={telemetry} emphasize={false} quiet={quiet} />}
    </div>
  );
}

function HintArea({ part, step, busy, act, telemetry, emphasize, quiet = false }: { part: SolvePartView; step: string; busy: boolean; act: Act; telemetry: SceneTelemetry; emphasize: boolean; quiet?: boolean }) {
  if (!part.hints.length && !part.hintsLeft && !part.solutionOffered) return null;
  return (
    <div className="mt-2 grid gap-3 border-t pt-5" style={{ borderColor: "#dce5df" }} data-testid="hint-area">
      {part.hintsLeft === 0 && part.solutionOffered ? (
        <button type="button" className={cn(btn, "justify-self-start")} style={secondary} disabled={busy} onClick={() => { telemetry("hint-open"); void act({ a: "show-solution", step, part: part.id }); }} data-testid="hint-solution">
          💡 Lösung zeigen
        </button>
      ) : null}
      {part.hintsLeft > 0 ? (
        part.hintPending ? (
          <p className="text-base" data-testid="hint-pending">Beantworte zuerst die Frage in diesem Schritt. Dann kommt der nächste.</p>
        ) : part.hintAllowed ? (
          <button
            type="button"
            className={cn(btn, "justify-self-start", emphasize && "ring-4 ring-amber-400")}
            style={secondary}
            disabled={busy}
            onClick={() => {
              telemetry("hint-open");
              void act({ a: "hint", step, part: part.id });
            }}
            data-testid="hint-open"
          >
            💡 {part.hints.length ? "Noch ein Hinweis" : "Hinweis"}
          </button>
        ) : quiet ? null : (
          <p className="text-base" data-testid="hint-later">Probier es zuerst selbst. Danach gibt es hier einen Hinweis.</p>
        )
      ) : null}
      {part.hints.map((h) => (
        <div key={h.id} className="grid gap-3 rounded-2xl p-4" style={{ background: "#edf4e6" }} data-testid="hint" data-hint={h.id}>
          <p className="text-lg">{h.text}</p>
          {h.diagram ? <Trays diagram={h.diagram} label="Zum Zählen" /> : null}
          {h.grid ? <PlanGrid grid={h.grid} /> : null}
          {h.check ? <HintCheck check={h.check} hintId={h.id} part={part.id} step={step} busy={busy} act={act} /> : null}
        </div>
      ))}
    </div>
  );
}

function HintCheck({ check, hintId, part, step, busy, act }: { check: NonNullable<SolvePartView["hints"][number]["check"]>; hintId: string; part: string; step: string; busy: boolean; act: Act }) {
  const [value, setValue] = useState("");
  const send = (v: string) => void act({ a: "hint-check", step, part, hint: hintId, value: v }).then((r) => r && setValue(""));
  return (
    <div className="grid gap-2">
      <p className="text-lg font-semibold">{check.prompt}</p>
      {check.kind === "pick" ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label={check.prompt}>
          {(check.options ?? []).map((o) => (
            <button key={o} type="button" className={btn} style={secondary} disabled={busy} onClick={() => send(o)} data-testid={`hint-pick-${o}`}>
              {o}
            </button>
          ))}
        </div>
      ) : (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && /^\d{1,4}$/.test(value)) send(value);
          }}
        >
          <input value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))} inputMode="numeric" className="h-12 w-24 rounded-xl border-2 px-3 text-xl" style={{ borderColor: "#8ba8a4" }} aria-label={check.prompt} data-testid="hint-check-input" />
          {check.unit ? <span className="text-lg">{check.unit}</span> : null}
          <button type="submit" className={btn} style={primary} disabled={busy || !value} data-testid="hint-check-send">
            Prüfen
          </button>
        </form>
      )}
      {check.reply ? <Feedback tone={check.result === "correct" ? "success" : "retry"} text={check.reply} testId="hint-feedback" /> : null}
      {check.representation ? <Trays diagram={check.representation} label="So sieht es aus" /> : null}
    </div>
  );
}

// --- the exact quantity picture (counts from data, never from art) ----------------------

const CONTAINER_PLURAL: Record<string, string> = { Trage: "Tragen", Kiste: "Kisten", Schachtel: "Schachteln" };

export function Trays({ diagram, label }: { diagram: MissionDiagram; label: string }) {
  const groups = Math.ceil(diagram.total / diagram.perGroup);
  return (
    <figure className="grid gap-2" data-testid="trays" data-total={diagram.total} data-groups={groups}>
      <figcaption className="text-base font-semibold">{label}</figcaption>
      <div className="flex flex-wrap gap-2" role="img" aria-label={`${diagram.total} ${diagram.unit} in ${groups} ${groups === 1 ? diagram.container : CONTAINER_PLURAL[diagram.container] ?? diagram.container}, höchstens ${diagram.perGroup} pro ${diagram.container}`}>
        {Array.from({ length: groups }, (_, g) => {
          const n = Math.min(diagram.perGroup, diagram.total - g * diagram.perGroup);
          return (
            <div key={g} className="rounded-lg border-2 px-2 pb-1 pt-2" style={{ background: "#ddc296", borderColor: "#a48458", minWidth: 24 + diagram.perGroup * 22 }}>
              <div className="flex gap-1">
                {Array.from({ length: n }, (_, i) => (
                  <Seedling key={i} />
                ))}
              </div>
              <span className="block text-center text-sm font-bold" style={{ color: "#5a4426" }}>
                {n}
              </span>
            </div>
          );
        })}
      </div>
    </figure>
  );
}

function Seedling() {
  return (
    <svg aria-hidden viewBox="0 0 20 24" className="h-6 w-5">
      <path d="M10 22V11" stroke="#3f7a3a" strokeWidth={2} />
      <path d="M10 13C5 13 3 9 3 6c4 0 7 2 7 7z" fill="#5fae4e" />
      <path d="M10 11c0-5 3-7 7-7 0 3-2 7-7 7z" fill="#79c463" />
      <rect x={5} y={20} width={10} height={4} rx={1} fill="#9a6b3f" />
    </svg>
  );
}

// --- listening ------------------------------------------------------------------------

const PLACE_PICTURES: Record<string, "greenhouse" | "gate" | "boat"> = { "Ins Gewächshaus": "greenhouse", "Zum Tor": "gate", "Aufs Boot": "boat", "Im Gewächshaus": "greenhouse", "Am Tor": "gate", "Auf dem Boot": "boat" };

export function ListenTask({ child, active, busy, act, speech, telemetry }: { child: ChildId; active: MissionActiveView; busy: boolean; act: Act; speech: ChildSpeechPlayer; telemetry: SceneTelemetry }) {
  const listen = active.listen!;
  const [playing, setPlaying] = useState(false);
  const [last, setLast] = useState<"none" | "child-voice" | "browser" | "failed">("none");
  const play = async () => {
    speech.unlock();
    telemetry("listen-play");
    // The play is recorded (not help) and returns the reviewed text; it is spoken in its language; the device reports the end.
    const res = await act({ a: "support", step: active.id, kind: "play" });
    if (!res) return;
    setPlaying(true);
    const script = typeof res.script === "string" ? res.script : "";
    const outcome = await playListening(script, listen.language, { voice: (t) => speech.speak({ childId: child, text: t, language: listen.language as "en", speaker: "character" }), browser: browserSpeech() });
    setPlaying(false);
    if (outcome === "cancelled") return;
    setLast(outcome);
    await act({ a: "listen-outcome", step: active.id, outcome });
  };
  const canAnswer = listen.completedPlays > 0 || listen.transcriptShown;
  return (
    <div className="grid gap-4" data-testid="listen-task" data-voice={last}>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={btn} style={primary} disabled={busy || playing} onClick={() => void play()} data-testid="listen-play" autoFocus>
          <SpeakerIcon /> {playing ? "… spielt" : listen.plays ? "Nochmal anhören" : "Nachricht anhören"}
        </button>
        {listen.plays > 0 && !listen.transcriptShown ? (
          <button type="button" className={btn} style={secondary} disabled={busy} onClick={() => void act({ a: "support", step: active.id, kind: "transcript" })} data-testid="listen-transcript">
            Text lesen (Hilfe)
          </button>
        ) : null}
      </div>
      {listen.failures > 0 && listen.completedPlays === 0 && !listen.transcriptShown ? (
        <Feedback tone="retry" text="Der Ton hat nicht geklappt. Probier es noch einmal. Oder lies den Text (das zählt als Hilfe)." />
      ) : null}
      {listen.script ? (
        <p className="rounded-xl px-4 py-3 text-lg" lang={listen.language} style={{ background: "#e8f1f8" }} data-testid="listen-script">
          {listen.script}
        </p>
      ) : null}
      {active.questions.map((q) => (
        <div key={q.id} className="grid gap-2" data-testid={`question-${q.id}`} data-status={q.status}>
          <p className="text-xl font-semibold">{q.prompt}</p>
          {q.status === "open" ? (
            <div className="flex flex-wrap gap-3" role="group" aria-label={q.prompt}>
              {(q.options ?? []).map((o) => (
                <button key={o} type="button" className="grid min-h-24 w-36 place-items-center gap-1 rounded-2xl border-2 p-2 text-lg font-semibold disabled:opacity-50" style={{ borderColor: "#8ba8a4", background: "white" }} disabled={busy || !canAnswer} onClick={() => void act({ a: "answer-question", step: active.id, question: q.id, value: o })} data-testid={`pick-${q.id}-${o}`}>
                  {PLACE_PICTURES[o] || !listen.noPictures ? <PlacePicture kind={PLACE_PICTURES[o] ?? "gate"} /> : null}
                  {o}
                </button>
              ))}
            </div>
          ) : (
            <Feedback tone={q.status === "correct" ? "success" : "taught"} text={q.status === "correct" ? "Richtig." : `Die Antwort ist: ${q.shownAnswer}.`} />
          )}
          {q.hint ? <Feedback tone="retry" text={q.hint} /> : null}
        </div>
      ))}
      {!canAnswer && listen.failures === 0 ? <p className="text-lg">Hör zuerst die Nachricht. Dann wählst du.</p> : null}
    </div>
  );
}

export function PlacePicture({ kind }: { kind: "greenhouse" | "gate" | "boat" | "water" }) {
  return (
    <svg aria-hidden viewBox="0 0 64 44" className="h-12 w-16">
      {kind === "greenhouse" ? (
        <g>
          <path d="M8 40V20L32 6l24 14v20z" fill="#d7efe6" stroke="#3b7a6b" strokeWidth={2} />
          <path d="M32 6v34M20 13v27M44 13v27M8 28h48" stroke="#3b7a6b" strokeWidth={1.5} />
          <path d="M26 40c0-6 3-9 6-9s6 3 6 9" fill="#79c463" />
        </g>
      ) : kind === "gate" ? (
        <g stroke="#6b4a2b" strokeWidth={3} fill="none">
          <path d="M10 42V12M54 42V12" />
          <path d="M14 18h36M14 30h36M14 18l36 12" strokeWidth={2.5} />
        </g>
      ) : kind === "boat" ? (
        <g>
          <path d="M6 30h52l-8 10H14z" fill="#2c6e8f" />
          <path d="M30 6v24M30 8l16 18H30z" fill="#f4efe1" stroke="#2c6e8f" strokeWidth={1.5} />
          <path d="M2 42c6-3 10 3 16 0s10 3 16 0 10 3 16 0 10 3 12 0" stroke="#529eaa" strokeWidth={2} fill="none" />
        </g>
      ) : (
        <g>
          <path d="M18 14h24v24a4 4 0 0 1-4 4H22a4 4 0 0 1-4-4z" fill="#9cc9df" stroke="#2c6e8f" strokeWidth={2} />
          <path d="M42 20h8l4 6" stroke="#2c6e8f" strokeWidth={2} fill="none" />
          <path d="M56 30c0 3-2 5-2 5s-2-2-2-5 2-5 2-5 2 2 2 5z" fill="#529eaa" />
        </g>
      )}
    </svg>
  );
}

// --- the Spanish request -------------------------------------------------------------------

export function RequestTask({ active, busy, act, telemetry }: { active: MissionActiveView; busy: boolean; act: Act; telemetry: SceneTelemetry }) {
  const p = active.produce!;
  const [text, setText] = useState("");
  const [usedBank, setUsedBank] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const done = active.status !== "active";
  useEffect(() => {
    if (!done && !p.askMeaning) inputRef.current?.focus({ preventScroll: true });
  }, [done, p.askMeaning, p.tries, active.phase]);
  if (done) return null;
  const exhausted = active.phase === "exhausted";
  const say = () => {
    if (!busy && text.trim()) void act(exhausted ? { a: "practice", step: active.id, response: text } : { a: "produce", step: active.id, response: text, modality: usedBank ? "word-bank" : "typed" }).then((ok) => ok && setText(""));
  };
  return (
    <div className="grid gap-4" data-testid="request-task" data-language={p.language}>
      <p className="text-xl leading-snug">{p.instruction}</p>
      {exhausted && p.shownSentence ? (
        <p className="rounded-2xl px-4 py-3 text-xl" style={{ background: "#eef1e8", borderLeft: `5px solid ${ACTION}` }} data-testid="request-shown">
          So sagt man es: <strong lang={p.language}>{p.shownSentence}</strong>
        </p>
      ) : null}
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          say();
        }}
      >
        <label htmlFor="scene-request" className="text-2xl font-semibold" lang={p.language}>
          {exhausted ? "Schreib den Satz ab:" : p.frame.replace("___", "…")}
        </label>
        <input id="scene-request" ref={inputRef} value={text} onChange={(e) => setText(e.target.value.slice(0, 200))} lang={p.language} disabled={!!p.askMeaning || (exhausted && (p.practiceLeft ?? 1) === 0)} className="h-14 w-full max-w-xl rounded-xl border-2 px-3 text-xl" style={{ borderColor: "#8ba8a4" }} autoComplete="off" autoCorrect="off" spellCheck={false} data-testid="request-input" />
        <div>
          <button type="submit" className={btn} style={primary} disabled={busy || !text.trim() || !!p.askMeaning || (exhausted && (p.practiceLeft ?? 1) === 0)} data-testid="request-send">
            {exhausted ? "Üben" : "Zu Rosa sagen"}
          </button>
        </div>
      </form>
      {p.repairLine ? <Feedback tone="retry" text={p.repairLine} /> : p.feedback ? <Feedback tone="retry" text={p.feedback} /> : null}
      {p.practiceFeedback ? <Feedback tone="practice-wrong" text={p.practiceFeedback} /> : null}
      {p.askMeaning ? (
        <div className="grid gap-2 rounded-2xl px-4 py-3" style={{ background: WARN_BG }} data-testid="ask-meaning">
          <p className="text-lg">Welches Wort meinst du mit «{p.askMeaning.given}»?</p>
          <div className="flex flex-wrap gap-2">
            {p.askMeaning.options.map((o) => (
              <button key={o.word} type="button" className={btn} style={secondary} disabled={busy} onClick={() => void act({ a: "meaning", step: active.id, word: o.word })}>
                {o.word} ({o.meaningDe})
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {exhausted ? (
        <button type="button" className={cn(btn, "justify-self-start")} style={secondary} disabled={busy} onClick={() => void act({ a: "later", step: active.id })} data-testid="request-later">
          Fürs nächste Mal aufheben
        </button>
      ) : (
        <div className="mt-2 grid gap-3 border-t pt-5" style={{ borderColor: "#dce5df" }} data-testid="hint-area">
          {p.wordBank ? (
            <div className="grid gap-2 rounded-2xl p-4" style={{ background: "#edf4e6" }} data-testid="hint">
              <p className="text-lg">Diese Wörter kannst du verwenden:</p>
              <div className="flex flex-wrap gap-2">
                {p.wordBank.map((w) => (
                  <button key={w} type="button" className="min-h-12 rounded-xl border-2 px-4 text-lg" style={{ borderColor: "#8ba8a4", background: "white" }} lang={p.language} onClick={() => { setUsedBank(true); setText((t) => (t.trim() ? `${t.trim()} ${w}` : w.charAt(0).toUpperCase() + w.slice(1))); }}>
                    {w}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <button type="button" className={cn(btn, "justify-self-start")} style={secondary} disabled={busy} onClick={() => { telemetry("hint-open"); void act({ a: "support", step: active.id, kind: "word-bank" }); }} data-testid="hint-open">
              💡 Hinweis: Wörter zeigen
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// --- one own sentence ------------------------------------------------------------------------

function WriteTask({ active, busy, act }: { active: MissionActiveView; busy: boolean; act: Act }) {
  const w = active.write!;
  const [text, setText] = useState("");
  const [revision, setRevision] = useState<string | null>(null);
  if (active.status !== "active") {
    return (
      <div className="grid gap-3" data-testid="write-done">
        <p className="rounded-2xl px-4 py-3 text-xl" style={{ background: "#fff8e1" }}>
          «{w.revision ?? w.original}»
        </p>
        {w.thanks ? <Feedback tone="success" text={w.thanks} /> : null}
      </div>
    );
  }
  if (w.correction) {
    const value = revision ?? w.original ?? "";
    return (
      <div className="grid gap-3" data-testid="write-correction">
        <p className="text-lg">{w.correction.intro} Hier fehlt ein Abstand:</p>
        <p className="rounded-2xl px-4 py-3 text-xl" style={{ background: "#fff8e1" }} data-testid="write-marked">
          {w.correction.marked.split("|").map((chunk, i) => (
            <span key={i}>
              {i > 0 ? <mark className="mx-0.5 rounded px-1" style={{ background: WARN_EDGE, color: "white" }} aria-label="hier fehlt ein Abstand">␣</mark> : null}
              {chunk}
            </span>
          ))}
        </p>
        <label htmlFor="scene-revise" className="text-lg font-semibold">
          Schreib deinen Satz noch einmal:
        </label>
        <textarea id="scene-revise" value={value} onChange={(e) => setRevision(e.target.value.slice(0, 300))} rows={2} className="w-full rounded-xl border-2 px-3 py-2 text-xl" style={{ borderColor: "#8ba8a4" }} data-testid="write-revise" />
        <div className="flex flex-wrap gap-3">
          <button type="button" className={btn} style={primary} disabled={busy || !value.trim()} onClick={() => void act({ a: "revise", step: active.id, text: value })} data-testid="write-revise-send">
            Neu ins Gartenbuch
          </button>
          <button type="button" className={btn} style={secondary} disabled={busy} onClick={() => void act({ a: "revise", step: active.id, text: null })} data-testid="write-keep">
            {w.keepLabel}
          </button>
        </div>
      </div>
    );
  }
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && text.trim()) void act({ a: "write", step: active.id, text });
      }}
      data-testid="write-task"
    >
      <label htmlFor="scene-write" className="text-2xl font-semibold">
        {w.prompt}
      </label>
      <p className="text-lg">{w.instruction}</p>
      <textarea id="scene-write" value={text} onChange={(e) => setText(e.target.value.slice(0, 300))} rows={2} placeholder={w.placeholder ?? undefined} className="w-full rounded-xl border-2 px-3 py-2 text-xl" style={{ borderColor: "#8ba8a4" }} data-testid="write-input" />
      <div>
        <button type="submit" className={btn} style={primary} disabled={busy || !text.trim()} data-testid="write-send">
          Ins Gartenbuch schreiben
        </button>
      </div>
    </form>
  );
}

export function SceneNote({ children }: { children: ReactNode }) {
  return <p className="text-base">{children}</p>;
}
