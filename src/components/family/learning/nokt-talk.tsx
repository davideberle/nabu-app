"use client";

// ---------------------------------------------------------------------------
// Nokt — one conversation outside the task talk (content v7, Visit 8): Home, the welcome, during the visit, the reaction
// to his written sentence and the spoken look back.
//
//  - The transcript is the SERVER's: earlier lines of this page come from the persisted conversation (no replay of audio
//    on reload); new lines appear only from the server's answer.
//  - Only a verified, accepted reply is shown as «Nokt» and spoken (German, one voice at a time: the shared speech player
//    cancels whatever played before). Anything else is a reviewed «Hinweis der App», never spoken as Nokt.
//  - The microphone never starts by itself: explicit push-to-talk → editable transcript → he sends it. Typing always works.
//  - Closing the panel, leaving the page or a page/child change aborts the pending turn; a late reply is withheld by the
//    server (page binding) and never appears here.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AssistantPortrait } from "@/components/family/assistant-portrait";
import type { ChildId } from "@/lib/family-assistant-turn";
import type { ChildSpeechPlayer } from "@/lib/family-speech";
import type { NoktTalkLineView, NoktTalkPurpose } from "@/lib/family-learning-nokt-talk";
import { browserSpeech, cancelBrowserSpeech } from "@/lib/family-learning-listening";
import { NoktMic, type NoktTranscribe } from "./nokt-panel";
import { NO_TYPING_HELP } from "@/lib/family-input-hygiene";

export type NoktTalkTurnOutcome = { kind: "shown"; say: string; ended?: boolean } | { kind: "app"; line: string } | { kind: "failed"; line: string } | { kind: "cancelled" };
/** One talk turn through the server (dispatch → family runtime → reply). `text` absent = an opener. */
export type NoktTalkTurnFn = (turn: { purpose: NoktTalkPurpose; sessionId: string; turnId: string; text?: string; via?: "voice" | "typed"; choice?: string }, signal: AbortSignal) => Promise<NoktTalkTurnOutcome>;

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const btn = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-lg font-semibold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:opacity-50";

type Line = NoktTalkLineView & { key: string };

/** Nokt did not answer in time or at all: one friendly line, and the visit goes on (never stuck). */
export const NOKT_FRIENDLY_FAILURE_LINE = "Nokt ist gerade nicht erreichbar. Wir machen einfach weiter.";
const OPENER_TIMEOUT_MS = 30_000;
export type NoktTalkChoice = { id: string; label: string; picture?: ReactNode };

const PLACEHOLDER: Record<NoktTalkPurpose, string> = {
  home: "Hallo Santi! Worüber möchtest du mit Nokt reden?",
  welcome: "",
  visit: "Frag Nokt, wenn du nicht weisst, was hier gemeint ist.",
  writing: "",
  debrief: "",
};

export function NoktTalk({
  child,
  purpose,
  sessionId: persistedSession,
  initialLines,
  opener,
  speech,
  transcribe,
  turn,
  closed = false,
  onLine,
  title = "Nokt",
  testId = "nokt-talk",
  layout = "full",
  choices = null,
  autoFocus = false,
  blocking = false,
  ended = false,
  waitingLine = null,
  onEnded,
}: {
  child: ChildId;
  purpose: NoktTalkPurpose;
  /** The open persisted conversation of this page (continue it), or null for a new one. */
  sessionId: string | null;
  initialLines: NoktTalkLineView[];
  /** Start with Nokt's line (welcome, first look-back question, reaction to the saved sentence) — once, when nothing was said yet. */
  opener: boolean;
  speech: ChildSpeechPlayer;
  transcribe: NoktTranscribe | null;
  turn: NoktTalkTurnFn;
  closed?: boolean;
  onLine?: (line: { role: "nokt" | "app" | "child"; text: string }) => void;
  title?: string;
  testId?: string;
  /** `focus`: only the current exchange is on screen (Nokt's latest line, his latest words); the whole talk folds open. */
  layout?: "full" | "focus";
  /** Reviewed ideas he may tap (the look back's next-interest question); `own` focuses the box for his own words. */
  choices?: NoktTalkChoice[] | null;
  autoFocus?: boolean;
  /** The visit waits for this talk (writing, look back): one failed or late reply ends it with one friendly line, never a retry loop. */
  blocking?: boolean;
  /** Already over (from the saved conversation): nothing is awaited from him. */
  ended?: boolean;
  /** Said and shown while the first reply is on its way («Gib mir ein paar Sekunden …»). */
  waitingLine?: string | null;
  /** The talk is over (Nokt's last line has finished, or it failed). */
  onEnded?: (why: "closed" | "failed") => void;
}) {
  const sessionId = useMemo(() => persistedSession ?? newId("s"), [persistedSession]);
  const [lines, setLines] = useState<Line[]>(() => initialLines.map((l, i) => ({ ...l, key: `p${i}` })));
  const [draft, setDraft] = useState("");
  const [via, setVia] = useState<"voice" | "typed">("typed");
  const [waiting, setWaiting] = useState(false);
  const [over, setOver] = useState(ended);
  const endedRef = useRef(false);
  const finish = (why: "closed" | "failed") => {
    setOver(true);
    if (endedRef.current) return;
    endedRef.current = true;
    onEnded?.(why);
  };
  const abortRef = useRef<AbortController | null>(null);
  const openedRef = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const abort = () => abortRef.current?.abort();
    window.addEventListener("pagehide", abort);
    return () => {
      alive.current = false;
      window.removeEventListener("pagehide", abort);
      abort();
      speech.cancel();
      // A browser fallback voice that is still speaking stops with the panel too.
      cancelBrowserSpeech();
    };
  }, [speech]);

  const say = async (text: string) => {
    speech.unlock();
    const played = await speech.speak({ childId: child, text, language: "de", speaker: "nokt" });
    // Only the ElevenLabs audio plays on success; the browser voice is the fallback, and never after the panel closed.
    if (played === "fallback" && alive.current) await browserSpeech()(text, "de");
  };

  const appLine = (text: string) => {
    setLines((l) => [...l, { role: "app", text, at: new Date().toISOString(), key: newId("a") }]);
    onLine?.({ role: "app", text });
  };
  /** One turn with its time limit; the outcome is applied here so every entry (typed, spoken, tapped) behaves the same. */
  const exchange = async (body: { text?: string; via?: "voice" | "typed"; choice?: string }, opening: boolean) => {
    const abort = new AbortController();
    abortRef.current = abort;
    setWaiting(true);
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, OPENER_TIMEOUT_MS);
    const spoken = opening && waitingLine ? say(waitingLine) : null;
    const out = await turn({ purpose, sessionId, turnId: newId("t"), ...body }, abort.signal);
    window.clearTimeout(timer);
    if (!alive.current) return;
    if (timedOut) {
      abortRef.current = null;
      setWaiting(false);
      appLine(NOKT_FRIENDLY_FAILURE_LINE);
      finish("failed");
      return;
    }
    if (abort.signal.aborted || out.kind === "cancelled") return;
    abortRef.current = null;
    if (spoken) await spoken; // «Gib mir ein paar Sekunden …» is never cut off by the reply
    if (!alive.current) return;
    setWaiting(false);
    if (out.kind === "shown") {
      setLines((l) => [...l, { role: "nokt", text: out.say, at: new Date().toISOString(), key: newId("n") }]);
      onLine?.({ role: "nokt", text: out.say });
      if (out.ended) setOver(true);
      void say(out.say).finally(() => {
        if (out.ended) finish("closed");
      });
      return;
    }
    if (blocking) {
      appLine(out.kind === "app" ? out.line : NOKT_FRIENDLY_FAILURE_LINE);
      finish("failed");
      return;
    }
    appLine(out.line);
    // Nothing he wrote is lost when there was no reply.
    if (out.kind === "failed" && body.text) setDraft((d) => (d ? d : body.text!));
  };
  const run = (text: string | undefined, entered: "voice" | "typed") => exchange(text !== undefined ? { text, via: entered } : {}, text === undefined);

  useEffect(() => {
    if (!opener || openedRef.current || closed || initialLines.length) return;
    openedRef.current = true;
    void run(undefined, "typed");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opener, closed]);

  const send = () => {
    const text = draft.trim();
    if (!text || waiting || closed || over) return;
    setLines((l) => [...l, { role: "child", text, via, at: new Date().toISOString(), key: newId("c") }]);
    onLine?.({ role: "child", text });
    setDraft("");
    setVia("typed");
    void run(text, via);
  };
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const pick = (c: NoktTalkChoice) => {
    if (waiting || closed || over) return;
    setLines((l) => [...l, { role: "child", text: c.label, via: "choice", at: new Date().toISOString(), key: newId("c") }]);
    onLine?.({ role: "child", text: c.label });
    void exchange({ text: c.label, via: "typed", choice: c.id }, false);
  };
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  const lastNokt = [...lines].reverse().find((l) => l.role !== "child") ?? null;
  const lastChild = [...lines].reverse().find((l) => l.role === "child") ?? null;
  // Focus: the current question (Nokt's or the app's latest line) and — while he waits — his own latest words after it.
  const childAfter = lastChild && (!lastNokt || lines.indexOf(lastChild) > lines.indexOf(lastNokt)) ? lastChild : null;
  const shown = layout === "focus" ? [lastNokt, childAfter].filter((x): x is Line => !!x) : lines;
  const line = (t: Line, big = false) => (
    <li key={t.key} className={`rounded-xl px-3 py-2 ${big ? "text-xl leading-snug" : "text-lg"}`} style={{ background: t.role === "nokt" ? "#edf4e6" : t.role === "app" ? "#fff8e1" : "#f3f4f1" }} data-role={t.role}>
      <span className="text-sm font-bold">{t.role === "nokt" ? "Nokt" : t.role === "app" ? "Hinweis der App" : t.via === "sentence" ? "Dein Satz" : t.via === "choice" ? "Du hast gewählt" : "Du"}{t.role === "child" && t.via === "voice" ? " (gesprochen)" : ""}</span>
      <br />
      {t.text}
      {t.role === "nokt" ? (
        <button type="button" className="ml-2 text-base underline" onClick={() => void say(t.text)} data-testid="nokt-talk-repeat">
          Nochmal anhören
        </button>
      ) : null}
    </li>
  );

  return (
    <section className="grid gap-3 rounded-3xl bg-white p-4 shadow-sm" style={{ color: "#203b3d", border: "2px solid #dce5df" }} aria-label={title} data-testid={testId} data-purpose={purpose} data-session={sessionId} data-waiting={waiting ? "true" : "false"} data-over={over ? "true" : "false"}>
      <div className="flex items-center gap-3">
        <AssistantPortrait child={child === "isabel" ? "isabel" : "santiago"} className="h-12 w-12" label="" />
        <h3 className="text-xl font-bold">{title}</h3>
      </div>
      {layout === "focus" && lines.length > shown.length ? (
        <details className="text-base" data-testid="nokt-talk-history">
          <summary className="cursor-pointer underline">Ganzes Gespräch ansehen ({lines.length})</summary>
          <ol className="mt-2 grid gap-2" data-testid="nokt-talk-transcript">
            {lines.map((t) => line(t))}
          </ol>
        </details>
      ) : null}
      <ol className="grid gap-2" aria-live="polite" data-testid={layout === "focus" ? "nokt-talk-current" : "nokt-talk-transcript"}>
        {lines.length === 0 && PLACEHOLDER[purpose] && !waiting ? <li className="text-lg">{PLACEHOLDER[purpose]}</li> : null}
        {shown.map((t) => line(t, layout === "focus" && t.role !== "child"))}
        {waiting ? <li className="text-lg italic" data-testid="nokt-talk-waiting">{lines.length === 0 && waitingLine ? waitingLine : "Nokt überlegt …"}</li> : null}
      </ol>
      {choices?.length && !closed && !over ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Ideen für das nächste Mal" data-testid="nokt-talk-choices">
          {choices.map((c) => (
            <button key={c.id} type="button" className={c.picture ? "grid min-h-28 w-28 place-items-center gap-1 rounded-2xl border-2 p-2 text-lg font-semibold disabled:opacity-50" : "min-h-12 rounded-full border-2 px-4 text-lg font-semibold disabled:opacity-50"} style={{ borderColor: "#8ba8a4", background: "white" }} disabled={waiting} onClick={() => pick(c)} data-testid={`nokt-choice-${c.id}`}>
              {c.picture ?? null}
              {c.label}
            </button>
          ))}
          <button type="button" className="min-h-12 rounded-full border-2 px-4 text-lg font-semibold" style={{ borderColor: "#d6c3a3", background: "#fffdf6" }} disabled={waiting} onClick={() => inputRef.current?.focus()} data-testid="nokt-choice-own">
            Idee
          </button>
        </div>
      ) : null}
      {closed || over ? null : (
        <>
          {transcribe ? (
            <NoktMic
              transcribe={transcribe}
              onTranscript={(text) => {
                setDraft(text.slice(0, 300));
                setVia("voice");
              }}
            />
          ) : null}
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <label htmlFor={`${testId}-input`} className="text-base font-semibold">
              {via === "voice" ? "Das habe ich verstanden — du kannst es korrigieren:" : transcribe ? "Oder schreib es hier:" : "Schreib es hier:"}
            </label>
            <textarea {...NO_TYPING_HELP} id={`${testId}-input`} ref={inputRef} rows={2} value={draft} onChange={(e) => setDraft(e.target.value.slice(0, 300))} className="w-full rounded-xl border-2 px-3 py-2 text-lg" style={{ borderColor: "#8ba8a4" }} data-testid="nokt-talk-input" />
            <button type="submit" className={btn} style={{ background: "#215c60", color: "white" }} disabled={!draft.trim() || waiting} data-testid="nokt-talk-send">
              Senden
            </button>
          </form>
        </>
      )}
    </section>
  );
}
