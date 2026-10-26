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
// back to the hint; no microphone. `fictional-stub` (isolated local database
// only): the planned flow — explicit push-to-talk start/stop records real audio
// (family-voice controller) → POST /api/family/learning/nokt/transcribe → a
// visible, correctable transcript → written reply → the same reply spoken in
// German (Nokt voice route; browser German when no Nokt voice exists). Replies
// are canned and labelled as a test; the recognizer is the server's choice
// (fake by default). Cancel, closing Nokt or a task change stops the recording
// and aborts the upload. The stub records nothing as tutor evidence.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { AssistantPortrait } from "@/components/family/assistant-portrait";
import type { ChildId } from "@/lib/family-assistant-turn";
import type { ChildSpeechPlayer } from "@/lib/family-speech";
import { fictionalNoktTransport, type NoktMode, type NoktTurn } from "@/lib/family-learning-nokt";
import type { NoktTranscribeOutcome, NoktTurnInput } from "@/lib/family-learning-client";
import { browserSpeech } from "@/lib/family-learning-listening";
import { startPushToTalk } from "@/lib/family-voice";
import { adaptMediaRecorder } from "./nabu-sidebar";

/** Uploads one recorded turn; the signal cancels upload and provider call. Bound to the child by the caller. */
export type NoktTranscribe = (audio: Blob, fileName: string, signal: AbortSignal) => Promise<NoktTranscribeOutcome>;
/** One Nokt turn through the server (dispatch → backend → verified reply); the caller adopts the returned view. */
export type NoktTurnFn = (turn: NoktTurnInput, signal: AbortSignal) => Promise<{ kind: "shown"; say: string } | { kind: "withheld"; line: string } | { kind: "exhausted" } | { kind: "failed" } | { kind: "cancelled" }>;

/** Shown when the turn could not be made at all (no connection, refused, unavailable) — reviewed app text. */
const NOKT_UNREACHABLE_LINE = "Nokt ist gerade nicht erreichbar. Der Hinweis bei der Aufgabe hilft dir weiter.";
/** Shown when today's replies are used up (the runtime's daily allowance) — reviewed app text, kind, no blame. */
export const NOKT_EXHAUSTED_LINE = "Nokt hat heute schon viel geredet und macht jetzt Pause. Morgen ist Nokt wieder da. Der Hinweis bei der Aufgabe hilft dir weiter.";
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

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

export function NoktPanel({ child, mode, step, part, speech, transcribe = null, turn = null, offer = null, onClose }: { child: ChildId; mode: NoktMode; step: string | null; part: string | null; speech: ChildSpeechPlayer; transcribe?: NoktTranscribe | null; turn?: NoktTurnFn | null; offer?: { onAccept: () => void; onDismiss: () => void } | null; onClose: () => void }) {
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
      {offer ? (
        // Shown only when a verified tutor exists (never in this build): a dismissible offer, never a microphone start.
        <div className="mt-4 grid gap-2" data-testid="nokt-offer">
          <p className="text-lg">Möchtest du mit mir anschauen, was die Frage meint?</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn} style={{ background: "#215c60", color: "white" }} onClick={offer.onAccept}>Ja</button>
            <button type="button" className={btn} style={{ background: "#e6eee7", color: "#21484b" }} onClick={offer.onDismiss}>Nein, danke</button>
          </div>
        </div>
      ) : null}
      {mode === "unavailable" ? (
        <div className="mt-4 grid gap-3" data-testid="nokt-unavailable">
          <p className="text-lg leading-relaxed">Nokt kann im Moment nicht mit dir sprechen.</p>
          <p className="text-lg leading-relaxed">Der Hinweis bei der Aufgabe hilft dir Schritt für Schritt. Du kannst auch einen Erwachsenen fragen.</p>
        </div>
      ) : (
        <Conversation child={child} fictional={mode === "fictional-stub"} step={step} part={part} speech={speech} transcribe={transcribe} turn={turn} />
      )}
      <button type="button" className={`${btn} mt-4`} style={{ background: "#e6eee7", color: "#21484b" }} onClick={onClose} data-testid="nokt-close">
        Schliessen
      </button>
    </aside>
  );
}

/**
 * The conversation: typed (and push-to-talk where transcription is configured). `fictional` = the isolated local stub,
 * labelled «Testmodus» and allowed to fall back to canned replies; the real conversation (`subscription`) never does.
 */
function Conversation({ child, fictional, step, part, speech, transcribe, turn }: { child: ChildId; fictional: boolean; step: string | null; part: string | null; speech: ChildSpeechPlayer; transcribe: NoktTranscribe | null; turn: NoktTurnFn | null }) {
  const transport = useMemo(() => fictionalNoktTransport(), []);
  // One talk per opening of the panel; a pending turn is aborted when the panel closes or the task changes (unmount).
  const sessionId = useMemo(() => newId("s"), []);
  const turnAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    // Leaving the page (navigation, reload, closing the tab) does not unmount React: abort the pending turn here too, so a
    // half-finished turn never posts a reply while the page unloads.
    const abort = () => turnAbortRef.current?.abort();
    window.addEventListener("pagehide", abort);
    return () => {
      window.removeEventListener("pagehide", abort);
      abort();
    };
  }, []);
  const [turns, setTurns] = useState<NoktTurn[]>([]);
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
    if (turn && step && part) {
      // Through the server: his line is recorded, the reply is verified and checked before it is shown as Nokt.
      const abort = new AbortController();
      turnAbortRef.current = abort;
      const out = await turn({ step, part, purpose: "diagnostic", entry: "manual", sessionId, turnId: newId("t"), text, via: childTurn.via }, abort.signal);
      if (abort.signal.aborted || out.kind === "cancelled") return;
      turnAbortRef.current = null;
      setWaiting(false);
      if (out.kind === "shown") {
        setTurns((t) => [...t, { id: `n${t.length}`, role: "nokt", text: out.say, via: "typed", at: Date.now() }]);
        void say(out.say);
        return;
      }
      setTurns((t) => [...t, { id: `a${t.length}`, role: "app", text: out.kind === "withheld" ? out.line : out.kind === "exhausted" ? NOKT_EXHAUSTED_LINE : NOKT_UNREACHABLE_LINE, via: "typed", at: Date.now() }]);
      // No reply from Nokt: his words stay in the box (unless he already typed something new), so nothing he wrote is lost.
      if (out.kind === "exhausted" || out.kind === "failed") setDraft((d) => (d ? d : text));
      return;
    }
    if (!fictional) {
      // The real conversation has no canned fallback: without the server turn it is simply unreachable.
      setWaiting(false);
      setTurns((t) => [...t, { id: `a${t.length}`, role: "app", text: NOKT_UNREACHABLE_LINE, via: "typed", at: Date.now() }]);
      setDraft((d) => (d ? d : text));
      return;
    }
    const reply = await transport.reply({ text, step: step ?? "", part, turns: turns.filter((t) => t.role === "child").length });
    setWaiting(false);
    if (!reply.ok) return;
    setTurns((t) => [...t, { id: `n${t.length}`, role: "nokt", text: reply.text, via: "typed", at: Date.now() }]);
    void say(reply.text);
  };
  return (
    <div className="mt-4 grid gap-3" data-testid={fictional ? "nokt-stub" : "nokt-conversation"}>
      {fictional ? (
        <p className="rounded-xl px-3 py-2 text-base font-semibold" style={{ background: "#fff1d8", color: "#794100" }}>
          Testmodus: erfundene Antworten, kein echter Tutor.
        </p>
      ) : null}
      <ol className="grid gap-2" aria-live="polite" data-testid="nokt-transcript">
        {turns.length === 0 ? <li className="text-lg">Hallo Santi. Was möchtest du wissen?</li> : null}
        {turns.map((t) => (
          <li key={t.id} className="rounded-xl px-3 py-2 text-lg" style={{ background: t.role === "nokt" ? "#edf4e6" : "#f3f4f1" }} data-role={t.role}>
            <span className="text-sm font-bold">{t.role === "nokt" ? "Nokt" : t.role === "app" ? "Hinweis der App" : "Du"}{t.role === "child" && t.via === "voice" ? " (gesprochen)" : ""}</span>
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
      {transcribe ? (
        // Only where the deployment has transcription; otherwise typing is the way to talk to Nokt.
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
          void send();
        }}
      >
        <label htmlFor="nokt-input" className="text-base font-semibold">
          {via === "voice" ? "Das habe ich verstanden — du kannst es korrigieren:" : transcribe ? "Oder schreib es hier:" : "Schreib es hier:"}
        </label>
        <textarea id="nokt-input" rows={2} value={draft} onChange={(e) => setDraft(e.target.value.slice(0, 300))} className="w-full rounded-xl border-2 px-3 py-2 text-lg" style={{ borderColor: "#8ba8a4" }} data-testid="nokt-input" />
        <button type="submit" className={btn} style={{ background: "#215c60", color: "white" }} disabled={!draft.trim() || waiting} data-testid="nokt-send">
          Senden
        </button>
      </form>
    </div>
  );
}

type MicState = "idle" | "starting" | "live" | "transcribing" | "trouble";

/**
 * Explicit push-to-talk for Nokt: nothing starts on its own, the child sees
 * when the microphone is live, and every exit (Fertig, Abbrechen, closing Nokt,
 * a task change unmounting the panel) releases the microphone and aborts a
 * pending upload. The recording lives only in memory until the upload; the
 * transcript only lands in the editable field — never sent without the child.
 */
export function NoktMic({ transcribe, onTranscript }: { transcribe: NoktTranscribe | null; onTranscript: (text: string) => void }) {
  const [mic, setMic] = useState<MicState>("idle");
  const sessionRef = useRef<ReturnType<typeof startPushToTalk> | null>(null);
  const uploadRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);
  useEffect(
    () => () => {
      seqRef.current += 1;
      sessionRef.current?.cancel();
      uploadRef.current?.abort();
    },
    [],
  );
  const start = () => {
    if (!transcribe || typeof navigator === "undefined" || !navigator.mediaDevices || typeof MediaRecorder === "undefined") {
      setMic("trouble");
      return;
    }
    const seq = (seqRef.current += 1);
    setMic("starting");
    sessionRef.current = startPushToTalk({
      getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: true }),
      isTypeSupported: (type) => MediaRecorder.isTypeSupported(type),
      createRecorder: (stream, mimeType, handlers) => adaptMediaRecorder(mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream), handlers),
      onLive: () => {
        if (seqRef.current === seq) setMic("live");
      },
      onSettle: async (outcome) => {
        if (seqRef.current !== seq) return;
        sessionRef.current = null;
        if (outcome.kind !== "recorded") {
          setMic(outcome.kind === "cancelled" ? "idle" : "trouble");
          return;
        }
        setMic("transcribing");
        const upload = new AbortController();
        uploadRef.current = upload;
        const heard = await transcribe(outcome.blob, outcome.fileName, upload.signal);
        if (seqRef.current !== seq) return;
        uploadRef.current = null;
        if (heard.ok) {
          setMic("idle");
          onTranscript(heard.transcript);
        } else setMic(heard.failure === "cancelled" ? "idle" : "trouble");
      },
    });
  };
  const cancel = () => {
    seqRef.current += 1;
    sessionRef.current?.cancel();
    sessionRef.current = null;
    uploadRef.current?.abort();
    uploadRef.current = null;
    setMic("idle");
  };
  const busy = mic === "starting" || mic === "live" || mic === "transcribing";
  return (
    <div className="grid gap-2" data-testid="nokt-mic" data-mic={mic}>
      <div className="flex flex-wrap gap-2">
        {mic === "live" || mic === "starting" ? (
          <button type="button" className={btn} style={{ background: "#a34431", color: "white" }} onClick={() => sessionRef.current?.stop()} aria-live="polite" data-testid="nokt-mic-stop">
            {mic === "live" ? "■ Fertig gesprochen" : "… Mikrofon startet"}
          </button>
        ) : (
          <button type="button" className={btn} style={{ background: "#215c60", color: "white" }} disabled={mic === "transcribing"} onClick={start} data-testid="nokt-mic-start">
            {mic === "transcribing" ? "… ich schreibe mit" : "🎙 Sprechen"}
          </button>
        )}
        {busy ? (
          <button type="button" className={btn} style={{ background: "#e6eee7", color: "#21484b" }} onClick={cancel} data-testid="nokt-mic-cancel">
            Abbrechen
          </button>
        ) : null}
      </div>
      {mic === "trouble" ? (
        <p className="text-base" role="status" data-testid="nokt-mic-trouble">
          Das hat gerade nicht geklappt. Du kannst es nochmal versuchen oder unten schreiben.
        </p>
      ) : null}
    </div>
  );
}
