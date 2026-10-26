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
//   - right after he deliberately started the visit (and only then) → the one-time spoken welcome.
// A page change remounts the dock: the pending turn is aborted and its audio stops; a late reply is withheld server-side.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState, type ReactNode } from "react";
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
  const welcomeDue = enabled && talk?.welcome === "due" && nokt.intentionalEntry;
  const [open, setOpen] = useState<"none" | "welcome" | "page">(welcomeDue ? "welcome" : "none");
  // The deliberate start is confirmed a moment after the mission first renders: open the welcome then — once, never again.
  const welcomed = useRef(welcomeDue);
  useEffect(() => {
    if (welcomeDue && !welcomed.current) {
      welcomed.current = true;
      setOpen("welcome");
    }
  }, [welcomeDue]);
  // A different page closes the dock (stale conversation and its audio end with it); the welcome never reopens.
  useEffect(() => {
    if (open === "page") setOpen("none");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);
  useEffect(() => {
    if (open === "welcome" && talk?.welcome === "not-applicable") setOpen("none");
  }, [open, talk?.welcome]);
  const solvePart = active?.kind === "solve" && active.status === "active" ? active.solve?.current ?? null : null;
  const offerPart = active?.tutor?.available || enabled ? active?.tutor?.offerPart ?? null : null;
  useEffect(() => {
    if (offerPart && enabled) setOpen("page");
  }, [offerPart, enabled]);

  const openDock = () => {
    setOpen("page");
    telemetry("tutor-open");
    if (active) void act({ a: "tutor-open", step: active.id, entry: "manual", part: solvePart });
  };
  const dock: ReactNode =
    open === "none" ? null : (
      <aside className="order-first grid content-start gap-3 md:sticky md:top-4 md:order-none" data-testid="nokt-dock" data-dock={open === "welcome" ? "welcome" : solvePart ? "task" : "visit"}>
        {open === "welcome" ? (
          enabled && nokt.talkTurn ? (
            <NoktTalk key="welcome" child={child} purpose="welcome" sessionId={sessionFor(talk, "welcome", `visit:${visitId}:welcome`)?.id ?? null} initialLines={sessionFor(talk, "welcome", `visit:${visitId}:welcome`)?.lines ?? []} opener speech={speech} transcribe={nokt.transcribe} turn={nokt.talkTurn} title="Nokt begrüsst dich" testId="nokt-welcome" />
          ) : null
        ) : solvePart && active ? (
          <NoktPanel
            key={`task:${active.id}:${solvePart}`}
            child={child}
            mode={nokt.mode}
            step={active.id}
            part={solvePart}
            speech={speech}
            transcribe={nokt.transcribe}
            turn={nokt.taskTurn}
            offer={offerPart ? { onAccept: () => void act({ a: "tutor-offer", step: active.id, part: offerPart, response: "accepted" }), onDismiss: () => { telemetry("nokt-offer-dismiss"); void act({ a: "tutor-offer", step: active.id, part: offerPart, response: "dismissed" }); setOpen("none"); } } : null}
            onClose={() => { setOpen("none"); telemetry("tutor-close"); }}
          />
        ) : enabled && nokt.talkTurn && !(active?.kind === "write" && !active.write?.original) ? (
          <NoktTalk key={`visit:${page}`} child={child} purpose="visit" sessionId={(() => { const s = sessionFor(talk, "visit", page); return s && !s.closed ? s.id : null; })()} initialLines={sessionFor(talk, "visit", page)?.lines ?? []} opener={false} speech={speech} transcribe={nokt.transcribe} turn={nokt.talkTurn} testId="nokt-visit" />
        ) : (
          <div className="rounded-3xl bg-white p-5 text-lg shadow-sm" style={{ border: "2px solid #dce5df", color: "#203b3d" }} data-testid={enabled ? "nokt-write-first" : "nokt-unavailable"}>
            {enabled ? "Schreib zuerst deinen eigenen Satz. Danach schaut Nokt ihn mit dir an." : "Nokt kann im Moment nicht mit dir sprechen. Der Hinweis bei der Aufgabe hilft dir weiter."}
          </div>
        )}
        {!(solvePart && active) ? (
          <button type="button" className={btn} style={secondary} onClick={() => { setOpen("none"); speech.cancel(); telemetry("tutor-close"); }} data-testid="nokt-dock-close">
            {open === "welcome" ? "Los geht's" : "Schliessen"}
          </button>
        ) : null}
      </aside>
    );

  return (
    <div className={cn("grid items-start gap-4 pb-24", open !== "none" && "md:grid-cols-[minmax(0,1fr)_360px]")} data-testid="map-mission" data-page={page}>
      <MissionWorld
        child={child}
        view={view}
        mission={mission}
        markers={markers}
        busy={busy}
        speech={speech}
        onWalk={onWalk}
        act={act}
        renderTask={(a) => MapTask({ child, view, active: a, busy, act, speech, telemetry, nokt })}
      />
      {dock}
      {open === "none" ? <NoktButton child={child} onOpen={openDock} /> : null}
    </div>
  );
}

/** The body of a Visit 8 scene for the kinds that use the clearer task components; null = MissionWorld's own body. */
export function MapTask({ child, view, active, busy, act, speech, telemetry, nokt }: { child: ChildId; view: ChildView; active: MissionActiveView; busy: boolean; act: Act; speech: ChildSpeechPlayer; telemetry: SceneTelemetry; nokt: MapNokt }): ReactNode | null {
  switch (active.kind) {
    case "solve":
      return (
        <div className="grid gap-4" data-testid="map-solve">
          {active.solve?.facts.length ? (
            <ul className="flex flex-wrap gap-2" aria-label="Was du weisst" data-testid="scene-facts">
              {active.solve.facts.map((f) => (
                <li key={f} className="rounded-full px-3 py-1 text-base font-semibold" style={{ background: "#edf4e6" }}>
                  {f}
                </li>
              ))}
            </ul>
          ) : null}
          {active.solve?.grids?.length ? (
            <div className="grid gap-3 sm:grid-cols-2" data-testid="solve-grids">
              {active.solve.grids.map((g) => (
                <PlanGrid key={g.label} grid={g} />
              ))}
            </div>
          ) : null}
          <SolveTask active={active} busy={busy} act={act} telemetry={telemetry} />
        </div>
      );
    case "decide":
      return active.decide ? <DecideTask active={active} busy={busy} act={act} /> : null;
    case "listen":
      return <ListenTask child={child} active={active} busy={busy} act={act} speech={speech} telemetry={telemetry} />;
    case "recall":
    case "produce":
      return <RequestTask active={active} busy={busy} act={act} telemetry={telemetry} />;
    case "write":
      return <WriteWithNokt child={child} view={view} active={active} busy={busy} act={act} speech={speech} nokt={nokt} />;
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
      <p className="text-2xl font-semibold">{d.prompt}</p>
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
                <button type="button" className={btn} style={primary} disabled={busy} onClick={() => void act({ a: "decide", step: active.id, option: o.id })} data-testid={`decide-pick-${o.id}`}>
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
 * The own sentence (content v7): the ORIGINAL is saved as typed; then the app's one reviewed tip (spacing, the capital at the
 * start or the end mark) and — with Nokt switched on — Nokt's spoken reaction to that original; then ONE typed revision or
 * «So lassen». Talking with Nokt never replaces the writing: the revision field is typed only.
 */
function WriteWithNokt({ child, view, active, busy, act, speech, nokt }: { child: ChildId; view: ChildView; active: MissionActiveView; busy: boolean; act: Act; speech: ChildSpeechPlayer; nokt: MapNokt }) {
  const w = active.write!;
  const [text, setText] = useState("");
  const [revision, setRevision] = useState<string | null>(null);
  const page = `visit:${view.visit?.id ?? ""}:write:${active.id}`;
  const session = view.nokt?.talk?.sessions.find((s) => s.purpose === "writing" && s.page === page) ?? null;
  const enabled = nokt.mode !== "unavailable" && !!nokt.talkTurn && !!w.nokt;
  if (active.status !== "active") {
    return (
      <div className="grid gap-3" data-testid="write-done">
        <p className="rounded-2xl px-4 py-3 text-xl" style={{ background: "#fff8e1" }}>
          «{w.revision ?? w.original}»
        </p>
        {w.revision && w.original && w.revision !== w.original ? <p className="text-base">Dein erster Satz bleibt auch gespeichert: «{w.original}»</p> : null}
        {w.thanks ? <Feedback tone="success" text={w.thanks} /> : null}
      </div>
    );
  }
  if (w.original !== null) {
    const value = revision ?? w.original ?? "";
    return (
      <div className="grid gap-4" data-testid="write-feedback">
        <div>
          <p className="text-base font-semibold">Dein Satz (so bleibt er gespeichert):</p>
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
        {enabled ? (
          <NoktTalk key={page} child={child} purpose="writing" sessionId={session && !session.closed ? session.id : null} initialLines={session?.lines ?? []} opener speech={speech} transcribe={nokt.transcribe} turn={nokt.talkTurn!} title="Nokt liest deinen Satz" testId="nokt-writing" />
        ) : null}
        <label htmlFor="map-revise" className="text-lg font-semibold">
          Möchtest du deinen Satz noch einmal schreiben? (Schreib ihn selbst.)
        </label>
        <textarea id="map-revise" value={value} onChange={(e) => setRevision(e.target.value.slice(0, 300))} rows={2} className="w-full rounded-xl border-2 px-3 py-2 text-xl" style={{ borderColor: "#8ba8a4" }} data-testid="write-revise" />
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
      <label htmlFor="map-write" className="text-2xl font-semibold">
        {w.prompt}
      </label>
      <p className="text-lg">{w.instruction}</p>
      <textarea id="map-write" value={text} onChange={(e) => setText(e.target.value.slice(0, 300))} rows={2} placeholder={w.placeholder ?? undefined} className="w-full rounded-xl border-2 px-3 py-2 text-xl" style={{ borderColor: "#8ba8a4" }} data-testid="write-input" />
      <div>
        <button type="submit" className={btn} style={primary} disabled={busy || !text.trim()} data-testid="write-send">
          Ins Gartenbuch schreiben
        </button>
      </div>
    </form>
  );
}
