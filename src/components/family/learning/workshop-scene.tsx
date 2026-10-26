"use client";

// ---------------------------------------------------------------------------
// Isabel Visit 1 — «Old Lilas kleine Werkstatt» (content `isabel-workshop`, presentation `workshop`).
//
// Visually led for a beginning reader (approved scope, David 2026-10-26 15:37): Old Lila says ONE short instruction at a
// time (every German line can be heard with «Anhören» — spoken instructions are access support, recorded as line audio,
// never help), and every answer is a tap on a picture or a small number. Nothing is typed except a number.
//
//  - reading: the word is SHOWN, never spoken, before her attempt; «Buchstaben zusammen anschauen» is an explicit switch to
//    supported letter/word learning (recorded help first, then the word may be heard) — never called independent reading;
//  - listening: Old Lila's instruction is HEARD (the text stays hidden) and answered by picture; without sound an adult may
//    read it aloud — clearly labelled and recorded as help;
//  - the real-world craft happens away from the screen: she may tap what she found; the parent records the rest.
// No Nokt, no microphone, no model: Old Lila's lines are the reviewed content.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { cn } from "@/components/ui/nabu";
import type { MissionActiveView, MissionView } from "@/lib/family-learning-mission";
import type { ChildId } from "@/lib/family-assistant-turn";
import type { ChildSpeechPlayer } from "@/lib/family-speech";
import { browserSpeech, playListening } from "@/lib/family-learning-listening";
import { AssistantPortrait } from "@/components/family/assistant-portrait";
import type { Act } from "./mission-world";
import { Feedback, SolveTask, SpeakerIcon, type SceneTelemetry } from "./mission-scene";
import { WorkshopPictureView, WorkshopRoom } from "./workshop-pictures";

const INK = "#2f2a24";
const ACTION = "#7a4a22";
const CARD = "#fffdf8";
const btn = "inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl px-6 text-xl font-semibold transition-colors focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";
const primary = { background: ACTION, color: "white" } as const;
const secondary = { background: "#f1e6d6", color: "#4a3420" } as const;
const pictureButton = "grid min-h-36 w-40 place-items-center gap-1 rounded-3xl border-4 bg-white p-2 text-lg font-semibold disabled:opacity-50";

export type WorkshopSceneProps = { child: ChildId; mission: MissionView; busy: boolean; act: Act; speech: ChildSpeechPlayer; telemetry: SceneTelemetry };

/** Speaks one German line (child voice route, else the browser's German voice); resolves with the device-reported outcome. */
function useSay(child: ChildId, speech: ChildSpeechPlayer) {
  return async (text: string): Promise<"child-voice" | "browser" | "failed" | "cancelled"> => {
    speech.unlock();
    return playListening(text, "de", { voice: (t) => speech.speak({ childId: child, text: t, language: "de", speaker: "character" }), browser: browserSpeech() });
  };
}

export function WorkshopScene({ child, mission, busy, act, speech, telemetry }: WorkshopSceneProps) {
  const active = mission.active;
  const beat = mission.beat ?? { index: 1, count: mission.steps.length, next: null };
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const opened = useRef(false);
  // The first beat opens by itself so Old Lila's greeting is on screen without an extra tap (a story beat writes no exposure).
  useEffect(() => {
    if (opened.current || busy || active) return;
    const first = mission.steps[0];
    if (first && first.status === "available" && mission.steps.every((s) => s.status === "available" || s.status === "locked")) {
      opened.current = true;
      void act({ a: "open", step: first.id });
    }
  }, [active, busy, mission.steps, act]);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    speech.cancel();
  }, [active?.id, speech]);

  // Advancing happens in two parts: finish/leave the current beat, then — once the FRESH view has rendered (statuses after the
  // write) — open the first beat that is available in the reviewed order. A conditional beat that is not needed is skipped
  // (never shown, never credited); with nothing left, the mission is finished.
  const [advancing, setAdvancing] = useState(false);
  const next = async () => {
    telemetry("beat-next");
    if (active) {
      if (active.status === "active" && (active.kind === "story" || active.kind === "outcome" || active.kind === "craft")) {
        const done = await act({ a: "story-done", step: active.id });
        if (!done || active.kind === "outcome") return;
      }
      const left = await act({ a: "leave" });
      if (!left) return;
    }
    setAdvancing(true);
  };
  useEffect(() => {
    if (!advancing || busy || active) return;
    setAdvancing(false);
    const upcoming = mission.steps.find((s) => s.status === "available" || s.status === "active") ?? null;
    void act(upcoming ? { a: "open", step: upcoming.id } : { a: "finish" });
  }, [advancing, busy, active, mission.steps, act]);

  const lines = active ? (active.status === "active" ? active.intro : active.done) : [];
  const offset = active && active.status !== "active" ? active.intro.length : 0;
  return (
    <div className="grid gap-4 pb-16" style={{ color: INK }} data-testid="workshop-scene" data-step={active?.id ?? ""} data-kind={active?.kind ?? ""} data-status={active?.status ?? ""}>
      <figure className="flex items-start gap-4 rounded-3xl p-4" style={{ background: "#f6ecdc" }} data-testid="workshop-bubble">
        <AssistantPortrait child={child} className="h-20 w-20 shrink-0" />
        <div className="grid min-w-0 gap-2" role="group" aria-label="Old Lila sagt">
          <p className="text-sm font-bold uppercase tracking-wide" style={{ color: ACTION }}>Old Lila</p>
          {lines.map((l, i) => (
            <SpokenLine key={`${active?.id}-${i + offset}`} text={l.text} child={child} speech={speech} onPlayed={(outcome) => { telemetry("line-audio"); if (active) void act({ a: "line-audio", step: active.id, line: i + offset, outcome }); }} />
          ))}
        </div>
      </figure>
      <section className="rounded-3xl p-5 shadow-sm sm:p-7" style={{ background: CARD }} aria-labelledby="workshop-title" data-testid="workshop-task">
        <h2 id="workshop-title" ref={headingRef} tabIndex={-1} className="mb-4 text-base font-semibold outline-none" style={{ color: "#7b6a55" }} data-testid="workshop-beat">
          {active ? active.title : "Werkstatt"} · Teil {beat.index} von {beat.count}
        </h2>
        {active ? <WorkshopTask child={child} mission={mission} active={active} busy={busy} act={act} speech={speech} telemetry={telemetry} onNext={() => void next()} /> : (
          <button type="button" className={btn} style={primary} disabled={busy} onClick={() => void next()} data-testid="workshop-next">
            Weiter
          </button>
        )}
      </section>
    </div>
  );
}

function SpokenLine({ text, child, speech, onPlayed }: { text: string; child: ChildId; speech: ChildSpeechPlayer; onPlayed: (o: "child-voice" | "browser" | "failed") => void }) {
  const say = useSay(child, speech);
  const [state, setState] = useState<"idle" | "playing" | "failed">("idle");
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="workshop-line">
      <p className="text-xl leading-snug sm:text-2xl">{text}</p>
      <button type="button" className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-base font-semibold" style={secondary} disabled={state === "playing"} onClick={async () => {
        setState("playing");
        const outcome = await say(text);
        if (outcome === "cancelled") return setState("idle");
        setState(outcome === "failed" ? "failed" : "idle");
        onPlayed(outcome);
      }} data-testid="workshop-line-audio" data-state={state}>
        <SpeakerIcon /> {state === "playing" ? "… spricht" : state === "failed" ? "Ton geht nicht — nochmal?" : "Anhören"}
      </button>
    </div>
  );
}

/** Hear a reviewed instruction again (access support for a beginning reader; not an answer and not help). */
function SayButton({ child, speech, text, testId }: { child: ChildId; speech: ChildSpeechPlayer; text: string; testId: string }) {
  const say = useSay(child, speech);
  const [playing, setPlaying] = useState(false);
  return (
    <button type="button" className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-base font-semibold" style={secondary} disabled={playing} onClick={async () => { setPlaying(true); await say(text); setPlaying(false); }} data-testid={testId}>
      <SpeakerIcon /> {playing ? "… spricht" : "Anhören"}
    </button>
  );
}

function NextButton({ busy, onNext, label = "Weiter" }: { busy: boolean; onNext: () => void; label?: string }) {
  return (
    <button type="button" className={cn(btn, "justify-self-start")} style={primary} disabled={busy} onClick={onNext} data-testid="workshop-next" autoFocus>
      {label} <span aria-hidden>→</span>
    </button>
  );
}

function WorkshopTask({ child, mission, active, busy, act, speech, telemetry, onNext }: { child: ChildId; mission: MissionView; active: MissionActiveView; busy: boolean; act: Act; speech: ChildSpeechPlayer; telemetry: SceneTelemetry; onNext: () => void }) {
  const finished = active.status !== "active";
  if (active.kind === "story" || active.kind === "outcome") {
    const first = active.id === mission.steps[0]?.id && !finished;
    return (
      <div className="grid gap-4" data-testid="workshop-story">
        {active.kind === "outcome" ? <WorkshopRoom made={active.picture?.id ?? null} label={active.picture ? `Dein Zimmer: ${active.picture.label}` : "Dein Zimmer"} /> : active.picture ? <WorkshopPictureView id={active.picture.id} className="h-32 w-32" /> : null}
        {active.recap ? (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3" style={{ background: "#f3efe6" }}>
            <p className="text-xl" data-testid="workshop-recap">{active.recap}</p>
            <SayButton child={child} speech={speech} text={active.recap} testId="workshop-recap-audio" />
          </div>
        ) : null}
        {active.ending ? (
          <div className="grid gap-2" data-testid="workshop-ending">
            {active.ending.success ? <Feedback tone="success" text={active.ending.success} /> : null}
            <p className="text-lg">{active.ending.next}</p>
          </div>
        ) : null}
        <NextButton busy={busy} onNext={onNext} label={first ? "Los geht's" : active.kind === "outcome" ? (finished ? "Zum Abschluss" : "Fertig") : "Weiter"} />
      </div>
    );
  }
  return (
    <div className="grid gap-5">
      {active.kind === "decide" && active.decide ? <DecideTask active={active} busy={busy} act={act} /> : null}
      {active.kind === "match" ? <PictureQuestions active={active} busy={busy} act={act} /> : null}
      {active.kind === "solve" && active.solve ? <SolveTask active={active} busy={busy} act={act} telemetry={telemetry} applicationNote="Neue Stäbe, neue Zahlen." /> : null}
      {active.kind === "read" ? <ReadTask child={child} active={active} busy={busy} act={act} speech={speech} /> : null}
      {active.kind === "listen" ? <ListenPictures child={child} active={active} busy={busy} act={act} speech={speech} telemetry={telemetry} /> : null}
      {active.kind === "craft" && active.craft ? <CraftTask child={child} speech={speech} active={active} busy={busy} act={act} onDone={onNext} /> : null}
      {finished && active.kind !== "craft" ? <NextButton busy={busy} onNext={onNext} /> : null}
    </div>
  );
}

function DecideTask({ active, busy, act }: { active: MissionActiveView; busy: boolean; act: Act }) {
  const d = active.decide!;
  const chosen = d.picked.find((p) => p.viable) ?? null;
  return (
    <div className="grid gap-3" data-testid="workshop-decide" data-chosen={d.chosen ?? ""}>
      <p className="text-2xl font-semibold">{d.prompt}</p>
      <div className="flex flex-wrap gap-3" role="group" aria-label={d.prompt}>
        {d.options.map((o) => (
          <button key={o.id} type="button" className={pictureButton} style={{ borderColor: d.chosen === o.id ? "#3f7a3a" : "#d9c6aa" }} aria-pressed={d.chosen === o.id} disabled={busy || active.status !== "active"} onClick={() => void act({ a: "decide", step: active.id, option: o.id })} data-testid={`make-${o.id}`}>
            {o.picture ? <WorkshopPictureView id={o.picture} /> : null}
            {o.label}
          </button>
        ))}
      </div>
      {chosen ? <Feedback tone="success" text={chosen.feedback} /> : <p className="text-lg">{d.rule}</p>}
    </div>
  );
}

/** One picture question at a time (materials): the object, then the pictured choices. */
function PictureQuestions({ active, busy, act }: { active: MissionActiveView; busy: boolean; act: Act }) {
  const current = active.questions.find((q) => q.status === "open") ?? null;
  const done = active.questions.filter((q) => q.status !== "open");
  return (
    <div className="grid gap-4" data-testid="workshop-match" data-question={current?.id ?? ""}>
      {done.length ? (
        <ul className="flex flex-wrap gap-3" aria-label="Schon zugeordnet" data-testid="match-done">
          {done.map((q) => (
            <li key={q.id} className="flex items-center gap-2 rounded-2xl px-3 py-2 text-base" style={{ background: q.status === "correct" ? "#e6f3e7" : "#f3efe6" }} data-status={q.status}>
              {q.picture ? <WorkshopPictureView id={q.picture} className="h-10 w-10" /> : null}
              {q.prompt}: <strong>{q.status === "correct" ? q.options?.find((o) => o === q.shownAnswer) ?? "✓" : q.shownAnswer}</strong>
            </li>
          ))}
        </ul>
      ) : null}
      {current ? (
        <div className="grid gap-3" data-testid={`question-${current.id}`}>
          <div className="flex items-center gap-4">
            {current.picture ? <WorkshopPictureView id={current.picture} className="h-28 w-28" title={current.prompt} /> : null}
            <p className="text-2xl font-semibold">{current.prompt}</p>
          </div>
          <div className="flex flex-wrap gap-3" role="group" aria-label={`${current.prompt}: Material wählen`}>
            {(current.options ?? []).map((o) => (
              <button key={o} type="button" className={pictureButton} style={{ borderColor: current.lastWrong === o ? "#c77c14" : "#d9c6aa" }} disabled={busy} onClick={() => void act({ a: "answer-question", step: active.id, question: current.id, value: o })} data-testid={`pick-${current.id}-${o}`}>
                {current.pictures?.[o] ? <WorkshopPictureView id={current.pictures[o]} /> : null}
                {o}
              </button>
            ))}
          </div>
          {current.hint ? <Feedback tone="retry" text={current.hint} /> : null}
        </div>
      ) : null}
      {done.length && !current ? <MatchSummary active={active} /> : null}
    </div>
  );
}

function MatchSummary({ active }: { active: MissionActiveView }) {
  const given = active.questions.filter((q) => q.status === "given");
  return given.length ? <Feedback tone="taught" text={`Old Lila hat ${given.length === 1 ? "eine Antwort" : "Antworten"} gezeigt.`} /> : <Feedback tone="success" text="Alle Materialien zugeordnet." />;
}

function ReadTask({ child, active, busy, act, speech }: { child: ChildId; active: MissionActiveView; busy: boolean; act: Act; speech: ChildSpeechPlayer }) {
  const say = useSay(child, speech);
  const q = active.questions[0];
  const letters = active.letters;
  const open = q?.status === "open";
  return (
    <div className="grid gap-4" data-testid="workshop-read" data-letters={letters?.shown ? "shown" : "no"}>
      {/* The word is SHOWN — never read aloud before her attempt. */}
      <p className="justify-self-start rounded-3xl border-4 px-8 py-4 font-mono text-6xl font-bold tracking-[0.3em]" style={{ borderColor: "#d9c6aa", background: "white" }} lang="de" data-testid="read-word">
        {active.readText}
      </p>
      {letters?.shown ? (
        <div className="grid gap-3 rounded-2xl p-4" style={{ background: "#edf4e6" }} data-testid="read-letters">
          <div className="flex flex-wrap gap-3">
            {letters.shown.letters.map((l, i) => (
              <span key={i} className="grid h-16 w-16 place-items-center rounded-2xl bg-white text-4xl font-bold">
                {l.letter}
              </span>
            ))}
          </div>
          <p className="text-lg">{letters.shown.teach}</p>
          <button type="button" className={cn(btn, "justify-self-start")} style={secondary} onClick={() => void say(letters.shown!.spoken)} data-testid="read-letters-audio">
            <SpeakerIcon /> Buchstaben und Wort anhören
          </button>
        </div>
      ) : null}
      {q ? (
        <div className="grid gap-3" data-testid={`question-${q.id}`} data-status={q.status}>
          <p className="text-xl font-semibold">{q.prompt}</p>
          {open ? (
            <div className="flex flex-wrap gap-3" role="group" aria-label={q.prompt}>
              {(q.options ?? []).map((o) => (
                <button key={o} type="button" className={pictureButton} style={{ borderColor: q.lastWrong === o ? "#c77c14" : "#d9c6aa" }} disabled={busy} onClick={() => void act({ a: "answer-question", step: active.id, question: q.id, value: o })} data-testid={`pick-${q.id}-${o}`} aria-label={o}>
                  {q.pictures?.[o] ? <WorkshopPictureView id={q.pictures[o]} /> : null}
                </button>
              ))}
            </div>
          ) : (
            <Feedback tone={q.status === "correct" ? "success" : "taught"} text={q.status === "correct" ? (letters?.shown ? "Richtig — zusammen mit den Buchstaben." : "Richtig.") : `Das Wort heisst: ${q.shownAnswer}.`} />
          )}
          {q.hint ? <Feedback tone="retry" text={q.hint} /> : null}
        </div>
      ) : null}
      {open && letters?.offered && !letters.shown ? (
        <button type="button" className={cn(btn, "justify-self-start", q?.tries ? "ring-4 ring-amber-400" : "")} style={secondary} disabled={busy} onClick={() => void act({ a: "support", step: active.id, kind: "letters" })} data-testid="read-letters-open">
          Das ist schwer — Buchstaben zusammen anschauen
        </button>
      ) : null}
    </div>
  );
}

function ListenPictures({ child, active, busy, act, speech, telemetry }: { child: ChildId; active: MissionActiveView; busy: boolean; act: Act; speech: ChildSpeechPlayer; telemetry: SceneTelemetry }) {
  const listen = active.listen!;
  const say = useSay(child, speech);
  const [playing, setPlaying] = useState(false);
  const play = async () => {
    telemetry("listen-play");
    // The play is recorded first (not help) and returns the reviewed sentence; the device reports how it ended.
    const res = await act({ a: "support", step: active.id, kind: "play" });
    if (!res) return;
    setPlaying(true);
    const outcome = await say(typeof res.script === "string" ? res.script : "");
    setPlaying(false);
    if (outcome === "cancelled") return;
    await act({ a: "listen-outcome", step: active.id, outcome });
  };
  const canAnswer = listen.completedPlays > 0 || listen.transcriptShown;
  return (
    <div className="grid gap-4" data-testid="workshop-listen">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={btn} style={primary} disabled={busy || playing} onClick={() => void play()} data-testid="listen-play" autoFocus>
          <SpeakerIcon /> {playing ? "… spricht" : listen.plays ? "Nochmal anhören" : "Old Lila anhören"}
        </button>
      </div>
      {listen.script ? (
        <p className="rounded-2xl px-4 py-3 text-lg" style={{ background: "#fff8e1" }} data-testid="listen-adult-read">
          <span className="block text-sm font-semibold uppercase tracking-wide">Für Erwachsene zum Vorlesen (zählt als Hilfe)</span>«{listen.script}»
        </p>
      ) : listen.plays > 0 || listen.failures > 0 ? (
        <button type="button" className="justify-self-start text-base underline underline-offset-4" disabled={busy} onClick={() => void act({ a: "support", step: active.id, kind: "transcript" })} data-testid="listen-adult-open">
          Kein Ton? Ein Erwachsener kann vorlesen (zählt als Hilfe)
        </button>
      ) : null}
      {active.questions.map((q) => (
        <div key={q.id} className="grid gap-2" data-testid={`question-${q.id}`} data-status={q.status}>
          <p className="text-xl font-semibold">{q.prompt}</p>
          {q.status === "open" ? (
            <div className="flex flex-wrap gap-3" role="group" aria-label={q.prompt}>
              {(q.options ?? []).map((o) => (
                <button key={o} type="button" className={pictureButton} style={{ borderColor: q.lastWrong === o ? "#c77c14" : "#d9c6aa" }} disabled={busy || !canAnswer} onClick={() => void act({ a: "answer-question", step: active.id, question: q.id, value: o })} data-testid={`pick-${q.id}-${o}`}>
                  {q.pictures?.[o] ? <WorkshopPictureView id={q.pictures[o]} /> : null}
                  {o}
                </button>
              ))}
            </div>
          ) : (
            <Feedback tone={q.status === "correct" ? "success" : "taught"} text={q.status === "correct" ? "Richtig." : `Gemeint war: ${q.shownAnswer}.`} />
          )}
          {q.hint ? <Feedback tone="retry" text={q.hint} /> : null}
        </div>
      ))}
      {!canAnswer ? <p className="text-lg">Hör zuerst zu. Dann tippst du auf ein Bild.</p> : null}
    </div>
  );
}

function CraftTask({ child, speech, active, busy, act, onDone }: { child: ChildId; speech: ChildSpeechPlayer; active: MissionActiveView; busy: boolean; act: Act; onDone: () => void }) {
  const c = active.craft!;
  const [picked, setPicked] = useState<string[]>(c.found);
  const saved = c.found.length > 0 && c.found.join(",") === picked.join(",");
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : c.find && p.length >= c.find.count ? p : [...p, id]));
  return (
    <div className="grid gap-5" data-testid="workshop-craft">
      <ol className="grid gap-3">
        {c.tasks.map((t, i) => (
          <li key={t.id} className="flex items-center gap-4 rounded-2xl px-4 py-3" style={{ background: "#f6ecdc" }} data-testid={`craft-task-${t.id}`}>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-xl font-bold">{i + 1}</span>
            {t.picture ? <WorkshopPictureView id={t.picture} className="h-16 w-16" /> : null}
            <span className="text-xl">{t.text}</span>
            <SayButton child={child} speech={speech} text={t.text} testId={`craft-task-audio-${t.id}`} />
          </li>
        ))}
      </ol>
      {c.find ? (
        <div className="grid gap-3" data-testid="craft-find">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xl font-semibold">{c.find.prompt}</p>
            <SayButton child={child} speech={speech} text={c.find.prompt} testId="craft-find-audio" />
          </div>
          <div className="flex flex-wrap gap-3" role="group" aria-label={c.find.prompt}>
            {c.find.options.map((o) => (
              <button key={o.id} type="button" className={pictureButton} style={{ borderColor: picked.includes(o.id) ? "#3f7a3a" : "#d9c6aa" }} aria-pressed={picked.includes(o.id)} disabled={busy} onClick={() => toggle(o.id)} data-testid={`found-${o.id}`}>
                <WorkshopPictureView id={o.picture} />
                {o.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={btn} style={secondary} disabled={busy || !picked.length || saved} onClick={() => void act({ a: "craft-found", step: active.id, items: picked })} data-testid="found-save">
              {saved ? "Gespeichert" : `Speichern (${picked.length} von ${c.find.count})`}
            </button>
          </div>
          <p className="text-lg">{c.find.fact}</p>
        </div>
      ) : null}
      <p className="text-base" style={{ color: "#7b6a55" }} data-testid="craft-parent-note">{c.parentNote}</p>
      <NextButton busy={busy} onNext={onDone} label={active.status === "active" ? "Fertig gebastelt — weiter" : "Weiter"} />
    </div>
  );
}
