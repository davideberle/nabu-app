"use client";

// ---------------------------------------------------------------------------
// Nokt — Santiago's tutor control on the learning surface (content v6, N7-03/N7-04).
//
// A separate bottom-right control (never the task hint). Opening it never starts
// a microphone. On tablet/desktop the panel sits BESIDE the task (the task column
// narrows, nothing is covered); on narrow screens it opens in the page flow with
// focus on its heading. A task change closes it and cancels its audio.
//
// `unavailable` (every deployed build): an honest child-level line and the way
// back to the hint. `fictional-stub` (isolated local database only): renders
// the planned flow — explicit push-to-talk start/stop → visible, correctable
// transcript → written reply → the same reply spoken in German (Nokt voice
// route; browser German when no Nokt voice exists) — with canned replies that
// are labelled as a test. The stub records nothing as tutor evidence.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { AssistantPortrait } from "@/components/family/assistant-portrait";
import type { ChildId } from "@/lib/family-assistant-turn";
import type { ChildSpeechPlayer } from "@/lib/family-speech";
import { fictionalNoktTransport, type NoktMode, type NoktTurn } from "@/lib/family-learning-nokt";
import { browserSpeech } from "@/lib/family-learning-listening";

const btn = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-lg font-semibold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:opacity-50";

export function NoktButton({ child, onOpen }: { child: ChildId; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="fixed bottom-4 right-4 z-30 inline-flex items-center gap-3 rounded-full py-2 pl-2 pr-5 text-lg font-semibold text-white shadow-lg focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-500 sm:bottom-6 sm:right-6"
      style={{ background: "#263740", bottom: "max(1rem, var(--clavus-bottom, 0px))" }}
      aria-label="Mit Nokt sprechen"
      data-testid="nokt-button"
    >
      <AssistantPortrait child={child === "isabel" ? "isabel" : "santiago"} className="h-12 w-12" label="" />
      Nokt
    </button>
  );
}

export function NoktPanel({ child, mode, step, part, speech, onClose }: { child: ChildId; mode: NoktMode; step: string | null; part: string | null; speech: ChildSpeechPlayer; onClose: () => void }) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: false });
    return () => speech.cancel();
  }, [speech]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <aside className="order-first self-start rounded-3xl bg-white p-5 shadow-lg md:sticky md:top-4 md:order-none" style={{ color: "#203b3d", border: "2px solid #dce5df" }} aria-labelledby="nokt-title" data-testid="nokt-panel" data-mode={mode}>
      <div className="flex items-center gap-3">
        <AssistantPortrait child={child === "isabel" ? "isabel" : "santiago"} className="h-16 w-16" label="" />
        <h2 id="nokt-title" ref={headingRef} tabIndex={-1} className="text-2xl font-bold outline-none">
          Nokt
        </h2>
      </div>
      {mode === "unavailable" ? (
        <div className="mt-4 grid gap-3" data-testid="nokt-unavailable">
          <p className="text-lg leading-relaxed">Nokt kann im Moment nicht mit dir sprechen.</p>
          <p className="text-lg leading-relaxed">Der Hinweis bei der Aufgabe hilft dir Schritt für Schritt. Du kannst auch einen Erwachsenen fragen.</p>
        </div>
      ) : (
        <StubConversation child={child} step={step} part={part} speech={speech} />
      )}
      <button type="button" className={`${btn} mt-4`} style={{ background: "#e6eee7", color: "#21484b" }} onClick={onClose} data-testid="nokt-close">
        Schliessen
      </button>
    </aside>
  );
}

/** The planned German-voice interaction with fictional canned replies (isolated local database only). */
function StubConversation({ child, step, part, speech }: { child: ChildId; step: string | null; part: string | null; speech: ChildSpeechPlayer }) {
  const transport = useMemo(() => fictionalNoktTransport(), []);
  const [turns, setTurns] = useState<NoktTurn[]>([]);
  const [recording, setRecording] = useState(false);
  const [draft, setDraft] = useState("");
  const [via, setVia] = useState<"voice" | "typed">("typed");
  const [waiting, setWaiting] = useState(false);
  const say = async (text: string) => {
    speech.unlock();
    const played = await speech.speak({ childId: child, text, language: "de", speaker: "nokt" });
    if (played === "fallback") await browserSpeech()(text, "de");
  };
  const send = async () => {
    const text = draft.trim();
    if (!text || waiting) return;
    const childTurn: NoktTurn = { id: `c${turns.length}`, role: "child", text, via, at: Date.now() };
    setTurns((t) => [...t, childTurn]);
    setDraft("");
    setVia("typed");
    setWaiting(true);
    const reply = await transport.reply({ text, step: step ?? "", part, turns: turns.filter((t) => t.role === "child").length });
    setWaiting(false);
    if (!reply.ok) return;
    setTurns((t) => [...t, { id: `n${t.length}`, role: "nokt", text: reply.text, via: "typed", at: Date.now() }]);
    void say(reply.text);
  };
  return (
    <div className="mt-4 grid gap-3" data-testid="nokt-stub">
      <p className="rounded-xl px-3 py-2 text-base font-semibold" style={{ background: "#fff1d8", color: "#794100" }}>
        Testmodus: erfundene Antworten, kein echter Tutor.
      </p>
      <ol className="grid gap-2" aria-live="polite" data-testid="nokt-transcript">
        {turns.length === 0 ? <li className="text-lg">Hallo Santi. Was möchtest du wissen?</li> : null}
        {turns.map((t) => (
          <li key={t.id} className="rounded-xl px-3 py-2 text-lg" style={{ background: t.role === "nokt" ? "#edf4e6" : "#f3f4f1" }} data-role={t.role}>
            <span className="text-sm font-bold">{t.role === "nokt" ? "Nokt" : "Du"}{t.via === "voice" ? " (gesprochen)" : ""}</span>
            <br />
            {t.text}
            {t.role === "nokt" ? (
              <button type="button" className="ml-2 text-base underline" onClick={() => void say(t.text)}>
                Nochmal anhören
              </button>
            ) : null}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        {recording ? (
          <button
            type="button"
            className={btn}
            style={{ background: "#a34431", color: "white" }}
            onClick={async () => {
              setRecording(false);
              const heard = await transport.transcribe();
              if (heard.ok) {
                setDraft(heard.text);
                setVia("voice");
              }
            }}
            data-testid="nokt-mic-stop"
          >
            ■ Fertig gesprochen
          </button>
        ) : (
          <button type="button" className={btn} style={{ background: "#215c60", color: "white" }} onClick={() => setRecording(true)} data-testid="nokt-mic-start">
            🎙 Sprechen
          </button>
        )}
      </div>
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label htmlFor="nokt-input" className="text-base font-semibold">
          {via === "voice" ? "Das habe ich verstanden — du kannst es korrigieren:" : "Oder schreib es hier:"}
        </label>
        <textarea id="nokt-input" rows={2} value={draft} onChange={(e) => setDraft(e.target.value.slice(0, 300))} className="w-full rounded-xl border-2 px-3 py-2 text-lg" style={{ borderColor: "#8ba8a4" }} data-testid="nokt-input" />
        <button type="submit" className={btn} style={{ background: "#215c60", color: "white" }} disabled={!draft.trim() || waiting} data-testid="nokt-send">
          Senden
        </button>
      </form>
    </div>
  );
}
