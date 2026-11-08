"use client";

// ---------------------------------------------------------------------------
// Visit 8 (content v7, `presentation: "map"`) — the walkable island between clear task scenes, with Nokt beside it.
//
// The map, walking, arrival card and quest list are the Visit 6 MissionWorld (real movement along reviewed paths; a step
// opens only where it is). Inside a scene, the tasks use the clearer Visit 7 components (one question at a time, one hint
// control) plus the Visit 8 additions: exact floor plans, the judgment between plans, and the own sentence with Nokt's
// reaction to the ORIGINAL and one typed revision.
//
// Nokt sits in a dock beside the map/scene (never over the task):
//   - an open solve question → the task talk (diagnosis/reflection with the app-owned phases — the only assessment path);
//   - anything else on the visit → the `visit` conversation about this page;
//   - right after he deliberately started the visit (and only then) → the one-time spoken welcome;
//   - after a saved sentence → Nokt reads it and talks about it, without a way to close (it ends by itself, by the turn limit or on failure);
//   - after two misses on one question → Nokt opens by itself with a question about his own answer (never an offer of help).
// Nov 8: the dock is a sidebar on every screen, never a modal, and it always starts with Nokt speaking.
// A page change remounts the dock: the pending turn is aborted and its audio stops; a late reply is withheld server-side.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/components/ui/nabu";
import type { ChildView } from "@/lib/family-learning-state";
import type { MissionActiveView, MissionView } from "@/lib/family-learning-mission";
import type { ChildId } from "@/lib/family-assistant-turn";
import type { ChildSpeechPlayer } from "@/lib/family-speech";
import type { NoktMode } from "@/lib/family-learning-nokt";
import { MissionWorld, type Act } from "./mission-world";
import type { WorldMarker } from "./expedition-world";
import { Feedback, ListenTask, RequestTask, SolveTask, Trays, type SceneTelemetry } from "./mission-scene";
import { PlanGrid } from "./plan-grid";
import { NoktButton, NoktPanel, type NoktTranscribe, type NoktTurnFn } from "./nokt-panel";
import { NoktTalk, type NoktTalkTurnFn } from "./nokt-talk";
import { NO_TYPING_HELP } from "@/lib/family-input-hygiene";

const btn = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 text-lg font-semibold transition-colors focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";
const primary = { background: "#215c60", color: "white" } as const;
const secondary = { background: "#e6eee7", color: "#21484b" } as const;

export type MapNokt = {
  mode: NoktMode;
  transcribe: NoktTranscribe | null;
  taskTurn: NoktTurnFn | null;
  talkTurn: NoktTalkTurnFn | null;
  /** He started this visit himself just now (not a reload): the welcome may open once. */
  intentionalEntry: boolean;
  /** The welcome is over (or could not happen): the walk into the first place that was waiting for it may go on. */
  onWelcomeDone?: () => void;
  /** Step 1 (S1-07): ask the Mac mini to be audible (bridge, candidate) when Nokt opens; absent = nothing is sent. */
  onOpen?: (reason: "visit-start" | "nokt-open") => void;
};

type TalkView = NonNullable<NonNullable<ChildView["nokt"]>["talk"]>;

function sessionFor(talk: TalkView | undefined, purpose: string, page: string) {
  const s = talk?.sessions.find((x) => x.purpose === purpose && x.page === page) ?? null;
  return s;
}

export function MapMission({ child, view, mission, markers, busy, act, speech, nokt, telemetry, onWalk }: { child: ChildId; view: ChildView; mission: MissionView; markers: WorldMarker[]; busy: boolean; act: Act; speech: ChildSpeechPlayer; nokt: MapNokt; telemetry: SceneTelemetry; onWalk: () => void }) {
  const active = mission.active;
  const talk = view.nokt?.talk;
  const visitId = view.visit?.id ?? "";
  const page = active ? `visit:${visitId}:step:${active.id}` : `visit:${visitId}:map`;
  const enabled = nokt.mode !== "unavailable";
  const skip = !!talk?.skip;
  const welcomeDue = enabled && !skip && talk?.welcome === "due" && nokt.intentionalEntry;
  const [open, setOpen] = useState<"none" | "welcome" | "page">(welcomeDue ? "welcome" : "none");
  // The deliberate start is confirmed a moment after the mission first renders: open the welcome then — once, never again.
  const welcomed = useRef(welcomeDue);
  useEffect(() => {
    if (welcomeDue && !welcomed.current) {
      welcomed.current = true;
      setOpen("welcome");
    }
  }, [welcomeDue]);
  const endWelcome = useCallback(() => {
    setOpen("none");
    speech.cancel();
    nokt.onWelcomeDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speech]);
  // A different page closes the dock (stale conversation and its audio end with it); the welcome never reopens.
  useEffect(() => {
    if (open === "page") setOpen("none");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);
  // Welcome no longer possible, or a parent switched Nokt off: the visit simply goes on (the door opens now).
  useEffect(() => {
    if (open === "welcome" && (skip || talk?.welcome === "not-applicable")) endWelcome();
  }, [open, skip, talk?.welcome, endWelcome]);
  useEffect(() => {
    if (open !== "none") nokt.onOpen?.("nokt-open");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const solvePart = active?.kind === "solve" && active.status === "active" ? active.solve?.current ?? null : null;
  // Two misses on one question: Nokt opens by itself with a question about his own answer. The record of that moment comes first,
  // so the dispatch below runs on the newest revision.
  const offerPart = !skip && enabled && active ? active.tutor?.offerPart ?? null : null;
  const [nudged, setNudged] = useState<string | null>(null);
  useEffect(() => {
    if (!offerPart || !active) return;
    const key = `${active.id}:${offerPart}`;
    void act({ a: "tutor-offer", step: active.id, part: offerPart, response: "accepted" }).then((done) => {
      if (!done) return;
      setNudged(key);
      setOpen("page");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerPart, active?.id]);

  // After his sentence is saved: Nokt reads it. Nothing can close this talk; it ends with Nokt's last line, the limit or a failure.
  const writePage = active?.kind === "write" ? `visit:${visitId}:write:${active.id}` : null;
  const writing = !skip && enabled && !!nokt.talkTurn && active?.kind === "write" && active.status === "active" && active.write?.original !== null && !!active.write?.nokt;
  const writingSession = writePage ? sessionFor(talk, "writing", writePage) : null;
  const [writingOverFor, setWritingOverFor] = useState<string | null>(null);
  const writingOver = !writing || writingOverFor === writePage || !!writingSession?.ended;
  const endWriting = useCallback((why: "closed" | "failed") => {
    if (!writePage) return;
    setWritingOverFor(writePage);
    // Only when Nokt's reaction did not arrive: the app's held tip stands in (one helper per sentence, never both).
    if (why === "failed" && active?.write?.tipHeld) void act({ a: "writing-tip", step: active.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writePage, active?.id, active?.write?.tipHeld]);
  const writingLive = writing && !writingOver;

  const openDock = () => {
    setOpen("page");
    telemetry("tutor-open");
    if (active) void act({ a: "tutor-open", step: active.id, entry: "manual", part: solvePart });
  };
  const closeDock = () => {
    setOpen("none");
    speech.cancel();
    telemetry("tutor-close");
  };
  const welcomeSession = sessionFor(talk, "welcome", `visit:${visitId}:welcome`);
  const dock: ReactNode = writingLive && writePage ? (
    <aside className="order-first grid max-h-[calc(100dvh-2rem)] content-start gap-3 overflow-y-auto md:sticky md:top-4 md:order-none" data-testid="nokt-sidebar" data-dock="writing">
      <NoktTalk key={writePage} child={child} purpose="writing" sessionId={writingSession && !writingSession.closed ? writingSession.id : null} initialLines={writingSession?.lines ?? []} opener={!writingSession} ended={!!writingSession?.ended} blocking waitingLine="Gib mir ein paar Sekunden …" speech={speech} transcribe={nokt.transcribe} turn={nokt.talkTurn!} title={active?.write?.plural ? "Nokt liest deine Sätze" : "Nokt liest deinen Satz"} testId="nokt-writing" onEnded={endWriting} />
    </aside>
  ) : open === "none" ? null : (
    <aside className="order-first grid max-h-[calc(100dvh-2rem)] content-start gap-3 overflow-y-auto md:sticky md:top-4 md:order-none" data-testid="nokt-sidebar" data-dock={open === "welcome" ? "welcome" : solvePart ? "task" : "visit"}>
      {open === "welcome" ? (
        enabled && nokt.talkTurn ? (
          <NoktTalk key="welcome" child={child} purpose="welcome" sessionId={welcomeSession?.id ?? null} initialLines={welcomeSession?.lines ?? []} opener={!welcomeSession} ended={!!welcomeSession?.ended} blocking speech={speech} transcribe={nokt.transcribe} turn={nokt.talkTurn} title="Nokt begrüsst dich" testId="nokt-welcome" />
        ) : null
      ) : solvePart && active ? (
        <NoktPanel key={`task:${active.id}:${solvePart}`} child={child} mode={nokt.mode} step={active.id} part={solvePart} speech={speech} transcribe={nokt.transcribe} turn={nokt.taskTurn} opener entry={nudged === `${active.id}:${solvePart}` ? "offer" : "manual"} onClose={closeDock} />
      ) : enabled && nokt.talkTurn && !(active?.kind === "write" && !active.write?.original) ? (
        <NoktTalk key={`visit:${page}`} child={child} purpose="visit" sessionId={(() => { const s = sessionFor(talk, "visit", page); return s && !s.closed ? s.id : null; })()} initialLines={sessionFor(talk, "visit", page)?.lines ?? []} opener={false} speech={speech} transcribe={nokt.transcribe} turn={nokt.talkTurn} testId="nokt-visit" />
      ) : (
        <div className="rounded-3xl bg-white p-5 text-lg shadow-sm" style={{ border: "2px solid #dce5df", color: "#203b3d" }} data-testid={enabled ? "nokt-write-first" : "nokt-unavailable"}>
          {enabled ? "Schreib zuerst deinen eigenen Satz. Danach schaut Nokt ihn mit dir an." : "Nokt kann im Moment nicht mit dir sprechen. Der Hinweis bei der Aufgabe hilft dir weiter."}
        </div>
      )}
      {!(solvePart && active) ? (
        <button type="button" className={btn} style={secondary} onClick={open === "welcome" ? endWelcome : closeDock} data-testid="nokt-dock-close">
          {open === "welcome" ? "Los geht's" : "Schliessen"}
        </button>
      ) : null}
    </aside>
  );

  return (
    <div className={cn("grid items-start gap-4", !view.homeMap && "pb-24", dock && "md:grid-cols-[minmax(0,1fr)_380px]")} data-testid="map-mission" data-page={page}>
      <MissionWorld
        child={child}
        view={view}
        mission={mission}
        markers={markers}
        busy={busy}
        speech={speech}
        onWalk={onWalk}
        act={act}
        renderTask={(a) => MapTask({ child, view, active: a, busy, act, speech, telemetry, nokt, writingLive, noktOnTask: open === "page" && !!solvePart })}
        sceneLocked={writingLive}
      />
      {dock}
      {dock || skip ? null : <NoktButton child={child} onOpen={openDock} />}
    </div>
  );
}

/** The body of a Visit 8 scene for the kinds that use the clearer task components; null = MissionWorld's own body. */
export function MapTask({ child, view, active, busy, act, speech, telemetry, nokt, writingLive = false, noktOnTask = false }: { child: ChildId; view: ChildView; active: MissionActiveView; busy: boolean; act: Act; speech: ChildSpeechPlayer; telemetry: SceneTelemetry; nokt: MapNokt; writingLive?: boolean; noktOnTask?: boolean }): ReactNode | null {
  switch (active.kind) {
    case "solve": {
      // Step 1 (S1-01): on the focused screen a fact already said by the story line or the question is not repeated in a box.
      const focused = view.mission?.screen === "focused";
      const said = [...active.intro.map((l) => l.text), ...(active.solve?.parts.map((p) => p.question) ?? [])].join(" ").toLowerCase();
      // Step 1 (review): a formula or rule chip is teaching — on the focused screen it appears only after a miss on the open
      // question (or with the worked solution), never before the first attempt.
      const open = active.solve?.parts.find((p) => p.status === "open") ?? null;
      const afterMiss = !!open && (open.tries > 0 || open.phase !== "answer");
      // Nov 8: one helper per moment. While Nokt talks about this task there is no formula chip and no hint; they return when it closes.
      const facts = noktOnTask ? [] : (active.solve?.facts ?? []).filter((f) => !focused || (afterMiss && !said.includes(f.toLowerCase().replace(/[.]$/, ""))));
      return (
        <div className="grid gap-4" data-testid="map-solve">
          {facts.length ? (
            <ul className="flex flex-wrap gap-2" aria-label="Was du weisst" data-testid="scene-facts">
              {facts.map((f) => (
                <li key={f} className="rounded-full px-3 py-1 text-base font-semibold" style={{ background: "#edf4e6" }}>
                  {f}
                </li>
              ))}
            </ul>
          ) : null}
          {focused && active.solve?.grids?.length ? (
            // Step 1 (review): picture of the field beside the question, so question, input and button stay above the fold.
            <div className="grid items-start gap-6 md:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
              <div className="grid gap-3" data-testid="solve-grids">
                {active.solve.grids.map((g) => (
                  <PlanGrid key={g.label} grid={g} focused />
                ))}
              </div>
              <SolveTask active={active} busy={busy} act={act} telemetry={telemetry} noktOpen={noktOnTask} focused />
            </div>
          ) : (
            <>
              {active.solve?.grids?.length ? (
                <div className="grid gap-3 sm:grid-cols-2" data-testid="solve-grids">
                  {active.solve.grids.map((g) => (
                    <PlanGrid key={g.label} grid={g} />
                  ))}
                </div>
              ) : null}
              <SolveTask active={active} busy={busy} act={act} telemetry={telemetry} noktOpen={noktOnTask} focused={focused} />
            </>
          )}
        </div>
      );
    }
    case "decide":
      return active.decide ? <DecideTask active={active} busy={busy} act={act} /> : null;
    case "listen":
      return <ListenTask child={child} active={active} busy={busy} act={act} speech={speech} telemetry={telemetry} characters={view.mission?.characters ?? []} focused={view.mission?.screen === "focused"} />;
    case "recall":
    case "produce":
      return <RequestTask active={active} busy={busy} act={act} telemetry={telemetry} />;
    case "write":
      return <WriteWithNokt active={active} busy={busy} act={act} nokt={nokt} talkRunning={writingLive} tipEarly={view.mission?.screen === "focused"} />;
    case "outcome":
      return active.grid ? (
        <div className="grid gap-3" data-testid="outcome-plan">
          <PlanGrid grid={active.grid} caption={`Dein Plan: ${active.grid.label}`} highlight showCounts />
          {active.diagram ? <Trays diagram={active.diagram} label="Geliefert" /> : null}
        </div>
      ) : null;
    default:
      return null;
  }
}

function DecideTask({ active, busy, act }: { active: MissionActiveView; busy: boolean; act: Act }) {
  const d = active.decide!;
  const finished = active.status !== "active";
  const last = d.picked[d.picked.length - 1] ?? null;
  return (
    <div className="grid gap-4" data-testid="decide-task" data-chosen={d.chosen ?? ""}>
      <p className="text-2xl font-semibold" data-fold="question">{d.prompt}</p>
      <p className="rounded-xl px-4 py-2 text-lg" style={{ background: "#eef1e8" }} data-testid="decide-rule">
        Regel: {d.rule}
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        {d.options.map((o) => {
          const picked = d.picked.some((p) => p.id === o.id);
          const chosen = d.chosen === o.id;
          return (
            <div key={o.id} className="grid content-start gap-2 rounded-2xl border-2 p-3" style={{ borderColor: chosen ? "#42864f" : picked ? "#c77c14" : "#dce5df", background: "white" }} data-testid={`decide-option-${o.id}`}>
              {o.grid ? <PlanGrid grid={o.grid} caption={o.label} highlight={chosen} showCounts /> : <p className="text-lg font-semibold">{o.label}</p>}
              {!finished ? (
                <button type="button" className={btn} style={primary} disabled={busy} onClick={() => void act({ a: "decide", step: active.id, option: o.id })} data-testid={`decide-pick-${o.id}`} data-fold="input">
                  Diesen Plan wählen
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {last ? <Feedback tone={last.viable ? "success" : "retry"} text={last.feedback} testId="decide-feedback" /> : null}
      {finished && d.reflect ? <p className="text-lg" data-testid="decide-reflect">Wenn du magst, erzähl Nokt: {d.reflect}</p> : null}
    </div>
  );
}

/**
 * The own sentence (content v7): the ORIGINAL is saved as typed; Nokt then reads it in the sidebar and talks about it (no close and
 * no «So lassen» while it does); after that the app's one reviewed tip if Nokt could not give one, and ONE typed revision or
 * «So lassen». Talking with Nokt never replaces the writing: the revision field is typed only.
 */
function WriteWithNokt({ active, busy, act, nokt, talkRunning, tipEarly }: { active: MissionActiveView; busy: boolean; act: Act; nokt: MapNokt; talkRunning: boolean; tipEarly: boolean }) {
  const w = active.write!;
  const [text, setText] = useState("");
  const [revision, setRevision] = useState<string | null>(null);
  const enabled = nokt.mode !== "unavailable" && !!nokt.talkTurn && !!w.nokt;
  // Without Nokt the reviewed tip appears at once; with Nokt, the sidebar's end asks for it (one helper per moment).
  const tipAsked = useRef(false);
  useEffect(() => {
    if (!tipEarly || enabled || w.original === null || !w.tipHeld || tipAsked.current) return;
    tipAsked.current = true;
    void act({ a: "writing-tip", step: active.id });
  }, [tipEarly, enabled, w.original, w.tipHeld, act, active.id]);
  if (active.status !== "active") {
    return (
      <div className="grid gap-3" data-testid="write-done">
        <p className="rounded-2xl px-4 py-3 text-xl" style={{ background: "#fff8e1" }}>
          «{w.revision ?? w.original}»
        </p>
        {w.revision && w.original && w.revision !== w.original ? <p className="text-base">{w.plural ? "Deine ersten Sätze bleiben auch gespeichert" : "Dein erster Satz bleibt auch gespeichert"}: «{w.original}»</p> : null}
        {w.thanks ? <Feedback tone="success" text={w.thanks} /> : null}
      </div>
    );
  }
  if (w.original !== null) {
    const value = revision ?? w.original ?? "";
    return (
      <div className="grid gap-4" data-testid="write-feedback">
        <div>
          <p className="text-base font-semibold">{w.plural ? "Deine Sätze (so bleiben sie gespeichert):" : "Dein Satz (so bleibt er gespeichert):"}</p>
          <p className="rounded-2xl px-4 py-3 text-xl" style={{ background: "#fff8e1" }} data-testid="write-original">
            «{w.original}»
          </p>
        </div>
        {w.correction ? (
          <div className="rounded-2xl px-4 py-3 text-lg" style={{ background: "#eef1e8", borderLeft: "5px solid #215c60" }} data-testid="write-tip" data-rule={w.correction.rule ?? "spacing"}>
            <p className="font-semibold">{w.correction.intro}</p>
            {w.correction.rule && w.correction.rule !== "spacing" ? (
              <p>{w.correction.line}</p>
            ) : (
              <p>
                Hier fehlt ein Abstand:{" "}
                {w.correction.marked.split("|").map((chunk, i) => (
                  <span key={i}>
                    {i > 0 ? <mark className="mx-0.5 rounded px-1" style={{ background: "#c77c14", color: "white" }} aria-label="hier fehlt ein Abstand">␣</mark> : null}
                    {chunk}
                  </span>
                ))}
              </p>
            )}
          </div>
        ) : null}
        {talkRunning ? <p className="text-lg font-semibold" data-testid="write-nokt-reading">Nokt schaut sich das an …</p> : null}
        {talkRunning ? null : <>
        <label htmlFor="map-revise" className="text-lg font-semibold">
          {w.plural ? "Möchtest du deine Sätze noch einmal schreiben? (Schreib sie selbst.)" : "Möchtest du deinen Satz noch einmal schreiben? (Schreib ihn selbst.)"}
        </label>
        <textarea {...NO_TYPING_HELP} id="map-revise" value={value} onChange={(e) => setRevision(e.target.value.slice(0, 300))} rows={2} className="w-full rounded-xl border-2 px-3 py-2 text-xl" style={{ borderColor: "#8ba8a4" }} data-testid="write-revise" data-fold="input" />
        <div className="flex flex-wrap gap-3">
          <button type="button" className={btn} style={primary} disabled={busy || !value.trim()} onClick={() => void act({ a: "revise", step: active.id, text: value })} data-testid="write-revise-send" data-fold="primary">
            Neu ins Gartenbuch
          </button>
          <button type="button" className={btn} style={secondary} disabled={busy} onClick={() => void act({ a: "revise", step: active.id, text: null })} data-testid="write-keep">
            {w.keepLabel}
          </button>
        </div>
        </>}
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
      <label htmlFor="map-write" data-fold="question" className="text-2xl font-semibold">
        {w.prompt}
      </label>
      <p className="text-lg">{w.instruction}</p>
      <textarea {...NO_TYPING_HELP} id="map-write" value={text} onChange={(e) => setText(e.target.value.slice(0, 300))} rows={2} placeholder={w.placeholder ?? undefined} className="w-full rounded-xl border-2 px-3 py-2 text-xl" style={{ borderColor: "#8ba8a4" }} data-testid="write-input" data-fold="input" />
      <div>
        <button type="submit" className={btn} style={primary} disabled={busy || !text.trim()} data-testid="write-send" data-fold="primary">
          Ins Gartenbuch schreiben
        </button>
      </div>
    </form>
  );
}
