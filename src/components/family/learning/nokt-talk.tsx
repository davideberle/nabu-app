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

import { useEffect, useMemo, useRef, useState } from "react";
import { AssistantPortrait } from "@/components/family/assistant-portrait";
import type { ChildId } from "@/lib/family-assistant-turn";
import type { ChildSpeechPlayer } from "@/lib/family-speech";
import type { NoktTalkLineView, NoktTalkPurpose } from "@/lib/family-learning-nokt-talk";
import { browserSpeech } from "@/lib/family-learning-listening";
import { NoktMic, type NoktTranscribe } from "./nokt-panel";

export type NoktTalkTurnOutcome = { kind: "shown"; say: string } | { kind: "app"; line: string } | { kind: "failed"; line: string } | { kind: "cancelled" };
/** One talk turn through the server (dispatch → family runtime → reply). `text` absent = an opener. */
export type NoktTalkTurnFn = (turn: { purpose: NoktTalkPurpose; sessionId: string; turnId: string; text?: string; via?: "voice" | "typed"; choice?: string }, signal: AbortSignal) => Promise<NoktTalkTurnOutcome>;

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const btn = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-lg font-semibold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:opacity-50";

type Line = NoktTalkLineView & { key: string };

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
  choices?: { id: string; label: string }[] | null;
  autoFocus?: boolean;
}) {
  const sessionId = useMemo(() => persistedSession ?? newId("s"), [persistedSession]);
  const [lines, setLines] = useState<Line[]>(() => initialLines.map((l, i) => ({ ...l, key: `p${i}` })));
  const [draft, setDraft] = useState("");
  const [via, setVia] = useState<"voice" | "typed">("typed");
  const [waiting, setWaiting] = useState(false);
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
    };
  }, [speech]);

  const say = async (text: string) => {
    speech.unlock();
    const played = await speech.speak({ childId: child, text, language: "de", speaker: "nokt" });
    if (played === "fallback") await browserSpeech()(text, "de");
  };

  const run = async (text: string | undefined, entered: "voice" | "typed") => {
    const abort = new AbortController();
    abortRef.current = abort;
    setWaiting(true);
    const out = await turn({ purpose, sessionId, turnId: newId("t"), ...(text !== undefined ? { text, via: entered } : {}) }, abort.signal);
    if (!alive.current || abort.signal.aborted || out.kind === "cancelled") return;
    abortRef.current = null;
    setWaiting(false);
    if (out.kind === "shown") {
      setLines((l) => [...l, { role: "nokt", text: out.say, at: new Date().toISOString(), key: newId("n") }]);
      onLine?.({ role: "nokt", text: out.say });
      void say(out.say);
      return;
    }
    setLines((l) => [...l, { role: "app", text: out.line, at: new Date().toISOString(), key: newId("a") }]);
    onLine?.({ role: "app", text: out.line });
    // Nothing he wrote is lost when there was no reply.
    if (out.kind === "failed" && text) setDraft((d) => (d ? d : text));
  };

  useEffect(() => {
    if (!opener || openedRef.current || closed || initialLines.length) return;
    openedRef.current = true;
    void run(undefined, "typed");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opener, closed]);

  const send = () => {
    const text = draft.trim();
    if (!text || waiting || closed) return;
    setLines((l) => [...l, { role: "child", text, via, at: new Date().toISOString(), key: newId("c") }]);
    onLine?.({ role: "child", text });
    setDraft("");
    setVia("typed");
    void run(text, via);
  };
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const pick = (c: { id: string; label: string }) => {
    if (waiting || closed) return;
    setLines((l) => [...l, { role: "child", text: c.label, via: "choice", at: new Date().toISOString(), key: newId("c") }]);
    onLine?.({ role: "child", text: c.label });
    const abort = new AbortController();
    abortRef.current = abort;
    setWaiting(true);
    void turn({ purpose, sessionId, turnId: newId("t"), text: c.label, via: "typed", choice: c.id }, abort.signal).then((out) => {
      if (!alive.current || abort.signal.aborted || out.kind === "cancelled") return;
      abortRef.current = null;
      setWaiting(false);
      if (out.kind === "shown") {
        setLines((l) => [...l, { role: "nokt", text: out.say, at: new Date().toISOString(), key: newId("n") }]);
        void say(out.say);
      } else setLines((l) => [...l, { role: "app", text: out.line, at: new Date().toISOString(), key: newId("a") }]);
    });
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
    <section className="grid gap-3 rounded-3xl bg-white p-4 shadow-sm" style={{ color: "#203b3d", border: "2px solid #dce5df" }} aria-label={title} data-testid={testId} data-purpose={purpose} data-session={sessionId} data-waiting={waiting ? "true" : "false"}>
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
        {waiting ? <li className="text-lg italic" data-testid="nokt-talk-waiting">Nokt überlegt …</li> : null}
      </ol>
      {choices?.length && !closed ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Ideen für das nächste Mal" data-testid="nokt-talk-choices">
          {choices.map((c) => (
            <button key={c.id} type="button" className="min-h-12 rounded-full border-2 px-4 text-lg font-semibold disabled:opacity-50" style={{ borderColor: "#8ba8a4", background: "white" }} disabled={waiting} onClick={() => pick(c)} data-testid={`nokt-choice-${c.id}`}>
              {c.label}
            </button>
          ))}
          <button type="button" className="min-h-12 rounded-full border-2 px-4 text-lg font-semibold" style={{ borderColor: "#d6c3a3", background: "#fffdf6" }} disabled={waiting} onClick={() => inputRef.current?.focus()} data-testid="nokt-choice-own">
            Eigene Idee (sagen oder schreiben)
          </button>
        </div>
      ) : null}
      {closed ? null : (
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
            <textarea id={`${testId}-input`} ref={inputRef} rows={2} value={draft} onChange={(e) => setDraft(e.target.value.slice(0, 300))} className="w-full rounded-xl border-2 px-3 py-2 text-lg" style={{ borderColor: "#8ba8a4" }} data-testid="nokt-talk-input" />
            <button type="submit" className={btn} style={{ background: "#215c60", color: "white" }} disabled={!draft.trim() || waiting} data-testid="nokt-talk-send">
              Senden
            </button>
          </form>
        </>
      )}
    </section>
  );
}
