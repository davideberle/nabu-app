"use client";

// ---------------------------------------------------------------------------
// Visit 6 — the walkable mission (content v5, reviewed mission document).
//
// ONE scene: the painted island of Visit 5 (HarborIsland, static) is the
// ground; this overlay adds the walkable path network, the avatar, the people
// with something to say, the live world changes of the mission and the open
// scene. Scenes and task cards reuse the same painted plates (backdrop crop,
// building, character), the same parchment palette and the same type — no
// separate worksheet look.
//
// Walking is real movement: the arrow keys move the avatar continuously along
// the paths (holding a key keeps walking, letting go stops between places);
// a click or tap walks the shortest path there. Places can also be reached
// from the "Auftrag" list (accessible direct interaction). Reduced motion
// skips the animation, never the path rule. The server only learns where the
// avatar arrived; a step opens only at its own place.
//
// Help is requested from the server and shown only after it was recorded
// (transcript, translation, word help). Listening plays reviewed text through
// the existing child voice route; reading tasks have no audio at all. No
// "Überspringen": Stopp (global) saves and leaves at any time.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { cn } from "@/components/ui/nabu";
import type { ChildView } from "@/lib/family-learning-state";
import type { MissionAction, MissionActiveView, MissionView, TypingBlockView } from "@/lib/family-learning-mission";
import type { ChildId } from "@/lib/family-assistant-turn";
import type { ChildSpeechPlayer } from "@/lib/family-speech";
import { nextExpectedChar } from "@/lib/family-learning-typing-metrics";
import { HarborIsland } from "./harbor-island";
import { plateFor, type PlateId } from "./harbor-island-plates";
import { HandsKeyboard } from "./hands-keyboard";
import { MissionWorldChanges } from "./mission-world-changes";
import type { WorldMarker } from "./expedition-world";

// The one palette of the mission (shared with the island chips): parchment, bark, ink, sea, signal.
const PARCHMENT = "#fff8e8";
const BARK = "#6b4423";
const INK = "#2b2118";
const SEA = "#0f4c81";
const SIGNAL = "#f59e0b";
const OK = "#15803d";

const card = "rounded-3xl border-2 shadow-md";
const cardStyle = { background: PARCHMENT, borderColor: BARK, color: INK } as const;
const btn = "inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border-2 px-5 text-base font-semibold transition-colors focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";
const btnPrimary = cn(btn, "text-white");
const btnPrimaryStyle = { background: BARK, borderColor: BARK } as const;
const btnSecondaryStyle = { background: "#fffdf6", borderColor: BARK, color: INK } as const;

/** Applies one mission action; resolves to the server result (truthy) or null when it was not applied. */
export type Act = (action: MissionAction) => Promise<Record<string, unknown> | null>;

export type MissionWorldProps = {
  child: ChildId;
  view: ChildView;
  mission: MissionView;
  markers: WorldMarker[];
  busy: boolean;
  act: Act;
  speech: ChildSpeechPlayer;
  onWalk?: () => void;
};

// ---------------------------------------------------------------------------
// Geometry and walking
// ---------------------------------------------------------------------------

type Pt = { x: number; y: number };
type Graph = { pos: Record<string, Pt>; adj: Record<string, string[]>; kind: Record<string, "place" | "waypoint"> };

function buildGraph(m: MissionView): Graph {
  const pos: Record<string, Pt> = {};
  const kind: Record<string, "place" | "waypoint"> = {};
  for (const p of m.places) {
    pos[p.id] = { x: p.x, y: p.y };
    kind[p.id] = p.kind;
  }
  const adj: Record<string, string[]> = {};
  for (const [a, b] of m.paths) {
    (adj[a] ??= []).push(b);
    (adj[b] ??= []).push(a);
  }
  return { pos, adj, kind };
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Shortest path (Dijkstra on path lengths) from a node to a node. */
function shortestPath(g: Graph, from: string, to: string): string[] {
  const d: Record<string, number> = { [from]: 0 };
  const prev: Record<string, string | null> = { [from]: null };
  const open = new Set(Object.keys(g.pos));
  while (open.size) {
    let u: string | null = null;
    for (const n of open) if (d[n] !== undefined && (u === null || d[n] < d[u])) u = n;
    if (u === null) break;
    open.delete(u);
    if (u === to) break;
    for (const v of g.adj[u] ?? []) {
      const nd = d[u] + dist(g.pos[u], g.pos[v]);
      if (d[v] === undefined || nd < d[v]) {
        d[v] = nd;
        prev[v] = u;
      }
    }
  }
  if (prev[to] === undefined) return [from];
  const path: string[] = [];
  for (let n: string | null = to; n; n = prev[n] ?? null) path.unshift(n);
  return path;
}

const SPEED = 300; // stage units per second
const ARROWS: Record<string, Pt> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * The walker: a continuous position on the path network. `seg` is the edge being walked ([from, to], t ∈ [0, 1]);
 * at a node `seg` is null. Arrow keys move along the edge that best matches the direction; a route (click/tap or the
 * list) walks node by node. Arrival at a place is reported once, when the avatar stands still there.
 */
function useWalker(g: Graph, start: string, onArrive: (place: string) => void) {
  const [node, setNode] = useState<string>(start);
  const [seg, setSeg] = useState<{ from: string; to: string; t: number } | null>(null);
  const [facingLeft, setFacingLeft] = useState(false);
  const held = useRef<Pt | null>(null);
  const route = useRef<string[]>([]);
  /** True while a click/tap/list route is being walked (its last segment keeps animating after the queue is empty). */
  const routing = useRef(false);
  const raf = useRef<number | null>(null);
  const last = useRef<number>(0);
  const state = useRef({ node: start, seg: null as { from: string; to: string; t: number } | null });
  const arriveRef = useRef(onArrive);
  arriveRef.current = onArrive;

  useEffect(() => {
    // The server moved us (resume, another tab): adopt only when standing still.
    if (!state.current.seg && !route.current.length && state.current.node !== start) {
      state.current = { node: start, seg: null };
      setNode(start);
    }
  }, [start]);

  const commit = () => {
    setNode(state.current.node);
    setSeg(state.current.seg ? { ...state.current.seg } : null);
  };

  const pickEdge = (from: string, dir: Pt): string | null => {
    let best: string | null = null;
    let bestDot = 0.35;
    for (const n of g.adj[from] ?? []) {
      const a = g.pos[from];
      const b = g.pos[n];
      const len = dist(a, b) || 1;
      const dot = ((b.x - a.x) * dir.x + (b.y - a.y) * dir.y) / len;
      if (dot > bestDot) {
        bestDot = dot;
        best = n;
      }
    }
    return best;
  };

  const tick = useCallback(
    (now: number) => {
      const dt = Math.min(0.05, (now - last.current) / 1000);
      last.current = now;
      const s = state.current;
      let moving = false;
      const dir = held.current;
      if (!s.seg) {
        const next = route.current.length ? route.current.shift()! : dir ? pickEdge(s.node, dir) : null;
        if (next && next !== s.node) {
          s.seg = { from: s.node, to: next, t: 0 };
          setFacingLeft(g.pos[next].x < g.pos[s.node].x);
        }
      }
      if (s.seg) {
        const a = g.pos[s.seg.from];
        const b = g.pos[s.seg.to];
        const len = dist(a, b) || 1;
        let sign = 1;
        if (!route.current.length && dir && s.seg.t > 0) {
          const dot = ((b.x - a.x) * dir.x + (b.y - a.y) * dir.y) / len;
          sign = dot < -0.2 ? -1 : 1;
          if (sign < 0) setFacingLeft(a.x < b.x);
        }
        s.seg.t += (sign * SPEED * dt) / len;
        moving = true;
        if (s.seg.t <= 0) {
          s.node = s.seg.from;
          s.seg = null;
        } else if (s.seg.t >= 1) {
          s.node = s.seg.to;
          s.seg = null;
          const isPlace = g.kind[s.node] === "place";
          if (!route.current.length) routing.current = false;
          if (isPlace && !route.current.length) {
            held.current = null;
            arriveRef.current(s.node);
            moving = false;
          }
        }
      }
      commit();
      // Keep walking while a key is held or a route remains; a key released mid-edge stops on the path.
      if (route.current.length || (s.seg && routing.current) || (held.current && (s.seg || pickEdge(s.node, held.current)))) {
        raf.current = requestAnimationFrame(tick);
      } else {
        raf.current = null;
        if (moving && !s.seg && g.kind[s.node] === "place") arriveRef.current(s.node);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [g],
  );

  const kick = () => {
    if (raf.current === null) {
      last.current = performance.now();
      raf.current = requestAnimationFrame(tick);
    }
  };

  const walkTo = useCallback(
    (target: string) => {
      const s = state.current;
      const from = s.seg ? (s.seg.t >= 0.5 ? s.seg.to : s.seg.from) : s.node;
      if (s.seg) {
        s.node = from;
        s.seg = null;
      }
      const path = shortestPath(g, from, target);
      if (prefersReducedMotion()) {
        s.node = target;
        s.seg = null;
        route.current = [];
        commit();
        if (g.kind[target] === "place") arriveRef.current(target);
        return;
      }
      route.current = path.slice(1);
      routing.current = route.current.length > 0;
      if (!route.current.length) {
        if (g.kind[target] === "place") arriveRef.current(target);
        return;
      }
      kick();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [g, tick],
  );

  const press = (key: string) => {
    const dir = ARROWS[key];
    if (!dir) return false;
    route.current = [];
    routing.current = false;
    if (prefersReducedMotion()) {
      const s = state.current;
      const from = s.seg ? s.seg.from : s.node;
      // Reduced motion: one key press = one step along the best path in that direction, to the next place.
      let cur = from;
      let next = pickEdge(cur, dir);
      const visited = new Set([cur]);
      while (next && !visited.has(next)) {
        visited.add(next);
        cur = next;
        if (g.kind[cur] === "place") break;
        next = pickEdge(cur, dir);
      }
      if (cur !== from) {
        s.node = cur;
        s.seg = null;
        commit();
        if (g.kind[cur] === "place") arriveRef.current(cur);
      }
      return true;
    }
    held.current = dir;
    kick();
    return true;
  };
  const release = (key: string) => {
    if (ARROWS[key] && held.current === ARROWS[key]) held.current = null;
  };

  useEffect(() => () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
  }, []);

  const pos: Pt = seg ? { x: g.pos[seg.from].x + (g.pos[seg.to].x - g.pos[seg.from].x) * seg.t, y: g.pos[seg.from].y + (g.pos[seg.to].y - g.pos[seg.from].y) * seg.t } : g.pos[node] ?? { x: 0, y: 0 };
  return { node, seg, pos, facingLeft, walking: !!seg, walkTo, press, release };
}

function useStageFit(ref: React.RefObject<HTMLDivElement | null>) {
  const [fit, setFit] = useState<{ scale: number; ox: number; oy: number; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const scale = Math.min(w / 1600, h / 900);
      setFit({ scale, ox: (w - 1600 * scale) / 2, oy: (h - 900 * scale) / 2, w, h });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return fit;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const CHARACTER_NAME: Record<string, string> = {};

export function MissionWorld({ child, view, mission, markers, busy, act, speech, onWalk }: MissionWorldProps) {
  const graph = useMemo(() => buildGraph(mission), [mission]);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const fit = useStageFit(stageRef);
  const [panel, setPanel] = useState<"none" | "notes">("none");
  const arrive = useCallback(
    (place: string) => {
      if (place !== mission.position) void act({ a: "arrive", place });
    },
    [act, mission.position],
  );
  const walker = useWalker(graph, mission.position, arrive);
  const active = mission.active;
  const placeOf = (id: string) => mission.places.find((p) => p.id === id)!;
  const charName = (id: string | null) => (id ? mission.characters.find((c) => c.id === id)?.name ?? id : null);
  const standing = !walker.walking && walker.node === mission.position;
  const here = standing ? mission.steps.filter((s) => mission.here.includes(s.id)) : [];
  const available = mission.steps.filter((s) => s.status === "available" || s.status === "active");
  const placesWithWork = new Set(available.map((s) => s.place));

  // Enter opens the step where the avatar stands (keyboard-only play).
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (active) return;
    if (e.key === "Enter" || e.key === " ") {
      if (here[0] && !busy) {
        e.preventDefault();
        void act({ a: "open", step: here[0].id });
      }
      return;
    }
    if (walker.press(e.key)) {
      e.preventDefault();
      onWalk?.();
    }
  };
  const onKeyUp = (e: ReactKeyboardEvent<HTMLDivElement>) => walker.release(e.key);

  const onStageClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (active || !svgRef.current) return;
    const pt = svgRef.current.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svgRef.current.getScreenCTM();
    if (!ctm) return;
    const p = pt.matrixTransform(ctm.inverse());
    let best: string | null = null;
    let bestD = 160;
    for (const pl of mission.places) {
      const d = dist(pl, p);
      if (d < bestD) {
        bestD = d;
        best = pl.id;
      }
    }
    if (best) {
      walker.walkTo(best);
      onWalk?.();
    }
  };

  const avatarPlate = plateFor("child");
  const worldProps = mission.world;
  const launched = worldProps.some((w) => w.prop === "sail");

  return (
    <div className="flex w-full flex-col gap-3" data-testid="mission-world" data-position={mission.position} data-walker-at={walker.node} data-walking={walker.walking ? "true" : "false"} data-active={active?.id ?? ""}>
      <div className={cn("grid gap-3", active ? "lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]" : "grid-cols-1")}>
        {/* --- the walkable island --- */}
        <div
          ref={stageRef}
          className="relative w-full overflow-hidden rounded-3xl border-2 outline-none focus-visible:outline-3 focus-visible:outline-amber-500"
          style={{ borderColor: BARK, aspectRatio: "16 / 9", background: SEA }}
          tabIndex={0}
          role="application"
          aria-label={`Insel. Du stehst bei: ${placeOf(walker.node)?.label ?? walker.node}. Mit den Pfeiltasten gehst du auf den Wegen, mit Enter sprichst du mit jemandem.`}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          data-testid="mission-map"
        >
          {/* the saved world as ground — without the earlier chapters' workplace chips and visit flags (they belong to the hub, not to this mission) */}
          <HarborIsland scene={{ ...view.scene, missionWorld: [] }} markers={[]} pages={view.pages.length} harbor={null} variant="stage" labelsToggle={false} chips={false} className="absolute inset-0" />
          <svg ref={svgRef} viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full" onClick={onStageClick} data-testid="mission-overlay">
            <defs>
              <style>{`
                .mw-bob { transform-box: fill-box; transform-origin: center bottom; animation: mw-bob 1.6s ease-in-out infinite; }
                .mw-step { transform-box: fill-box; transform-origin: center bottom; animation: mw-step 0.36s ease-in-out infinite; }
                @keyframes mw-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
                @keyframes mw-step { 0%, 100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-4px) rotate(-2deg); } }
                @media (prefers-reduced-motion: reduce) { .mw-bob, .mw-step { animation: none; } }
              `}</style>
            </defs>
            {/* the paths you can walk: soft trail marks over the painted paths */}
            <g aria-hidden data-part="paths">
              {mission.paths.map(([a, b]) => (
                <line key={`${a}-${b}`} x1={graph.pos[a].x} y1={graph.pos[a].y} x2={graph.pos[b].x} y2={graph.pos[b].y} stroke={PARCHMENT} strokeOpacity={0.55} strokeWidth={5} strokeDasharray="2 14" strokeLinecap="round" />
              ))}
            </g>
            <MissionWorldChanges world={worldProps} pos={graph.pos} />
            {/* places with something to do: a beacon over the place (the person there has information or a task) */}
            {mission.places
              .filter((p) => p.kind === "place" && placesWithWork.has(p.id))
              .map((p) => (
                <g key={p.id} transform={`translate(${p.x} ${p.y - 128})`} aria-hidden data-testid={`beacon-${p.id}`}>
                  <g className="mw-bob">
                    <circle r={22} fill={SIGNAL} stroke={INK} strokeWidth={3} />
                    <text y={9} textAnchor="middle" fontSize={28} fontWeight={800} fill={INK}>
                      !
                    </text>
                  </g>
                </g>
              ))}
            {/* the avatar */}
            <g transform={`translate(${walker.pos.x} ${walker.pos.y + 12}) scale(${walker.facingLeft ? -1 : 1} 1)`} data-part="avatar" data-testid="mission-avatar" data-x={Math.round(walker.pos.x)} data-y={Math.round(walker.pos.y)}>
              <ellipse cx={0} cy={2} rx={20} ry={6} fill="rgba(0,0,0,0.25)" />
              <g className={walker.walking ? "mw-step" : undefined}>
                {avatarPlate ? <image href={avatarPlate.href} x={-17} y={-92} width={34} height={92} /> : <circle cy={-40} r={18} fill={SIGNAL} stroke={INK} strokeWidth={3} />}
              </g>
            </g>
          </svg>
          {/* screen-space labels: readable on a tablet, never scaled with the stage */}
          {fit
            ? mission.places
                .filter((p) => p.kind === "place" && (placesWithWork.has(p.id) || p.id === walker.node))
                .map((p) => {
                  const left = p.x * fit.scale + fit.ox;
                  const top = (p.y - (placesWithWork.has(p.id) ? 160 : 100)) * fit.scale + fit.oy;
                  return (
                    <span key={p.id} className="pointer-events-none absolute -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-full border px-3 text-[14px] font-bold shadow-sm" style={{ left, top, lineHeight: "22px", background: placesWithWork.has(p.id) ? PARCHMENT : INK, color: placesWithWork.has(p.id) ? INK : PARCHMENT, borderColor: BARK }} data-testid={`place-label-${p.id}`}>
                      {p.label}
                    </span>
                  );
                })
            : null}
          {/* arrival card: who is here and what to do — Enter or tap */}
          {!active && here.length && fit ? (
            <div className={cn(card, "absolute z-10 w-[min(92%,360px)] -translate-x-1/2 p-3")} style={{ ...cardStyle, left: Math.min(Math.max(walker.pos.x * fit.scale + fit.ox, 190), fit.w - 190), top: Math.min(walker.pos.y * fit.scale + fit.oy + 24, fit.h - 130) }} data-testid="arrive-card">
              {here.map((s) => (
                <button key={s.id} type="button" disabled={busy} className={cn(btnPrimary, "w-full")} style={btnPrimaryStyle} onClick={() => void act({ a: "open", step: s.id })} data-testid={`open-${s.id}`}>
                  {s.character ? `${charName(s.character)}: ` : ""}
                  {s.title} <span aria-hidden>↵</span>
                </button>
              ))}
            </div>
          ) : null}
          {launched && !active ? (
            <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full border-2 px-4 py-1 text-base font-bold shadow" style={{ ...cardStyle }} data-testid="launched-banner">
              ⛵ Die Boote fahren zum Forschungsschiff
            </div>
          ) : null}
        </div>

        {/* --- the open scene (same palette, same plates) --- */}
        {active ? (
          <ScenePanel child={child} mission={mission} active={active} busy={busy} act={act} speech={speech} placeLabel={placeOf(mission.position)?.label ?? ""} />
        ) : null}
      </div>

      {/* --- quest log, notebook, finish --- */}
      {!active ? (
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <section className={cn(card, "p-4")} style={cardStyle} aria-labelledby="mw-quest" data-testid="quest-log">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="mw-quest" className="text-lg font-bold">
                Auftrag: {mission.title}
              </h2>
              <span className="text-sm font-semibold" data-testid="mission-progress">
                {mission.progress.resolved} von {mission.progress.required} erledigt
              </span>
            </div>
            {mission.canFinish ? (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <p className="text-base font-semibold">Geschafft! Alles ist erledigt.</p>
                <button type="button" className={btnPrimary} style={btnPrimaryStyle} disabled={busy} onClick={() => void act({ a: "finish" })} data-testid="mission-finish">
                  Zum Rückblick →
                </button>
              </div>
            ) : (
              <ul className="mt-2 grid gap-2" data-testid="quest-items">
                {available.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-3 py-2" style={{ borderColor: "#d6c3a3", background: "#fffdf6" }} data-testid={`quest-${s.id}`}>
                    <span className="text-base">
                      <span className="font-semibold">{s.title}</span> <span className="text-sm">· {placeOf(s.place).label}</span>
                      {s.status === "active" ? <span className="ml-2 rounded-full px-2 text-xs font-bold text-white" style={{ background: SIGNAL }}>angefangen</span> : null}
                    </span>
                    <button
                      type="button"
                      className={btn}
                      style={btnSecondaryStyle}
                      disabled={busy || walker.walking}
                      onClick={() => {
                        if (walker.node === s.place && mission.position === s.place) void act({ a: "open", step: s.id });
                        else {
                          walker.walkTo(s.place);
                          onWalk?.();
                        }
                      }}
                      data-testid={`go-${s.id}`}
                    >
                      {walker.node === s.place && mission.position === s.place ? "Starten" : "Hingehen"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-sm">Pfeiltasten: gehen · Enter: sprechen · Tippen auf die Karte: dorthin gehen</p>
          </section>
          <section className={cn(card, "p-4")} style={cardStyle} aria-labelledby="mw-notes" data-testid="notebook">
            <div className="flex items-baseline justify-between">
              <h2 id="mw-notes" className="text-lg font-bold">
                Notizbuch
              </h2>
              <button type="button" className="text-sm underline" onClick={() => setPanel(panel === "notes" ? "none" : "notes")} aria-expanded={panel === "notes"}>
                {panel === "notes" ? "weniger" : "alles"}
              </button>
            </div>
            {mission.facts.length ? (
              <ul className="mt-2 grid gap-1 text-base" data-testid="facts">
                {(panel === "notes" ? mission.facts : mission.facts.slice(-4)).map((f) => (
                  <li key={f.key}>
                    • {f.label}
                    {f.source === "given" ? <span className="text-sm"> (gezeigt)</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-base">Noch leer. Was du erfährst, steht dann hier.</p>
            )}
            {worldProps.length ? <p className="mt-3 text-sm" data-testid="world-summary">Auf der Insel: {worldProps.map((w) => w.label).join(" · ")}</p> : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The open scene
// ---------------------------------------------------------------------------

const CHARACTER_PLATE: Record<string, PlateId> = { keeper: "keeper", planner: "planner", supplier: "supplier" };
const PLACE_PLATE: Record<string, PlateId> = { workshop: "workshop", office: "office", shop: "shop", harbormaster: "harbormaster" };

function SceneHeader({ mission, active, placeLabel }: { mission: MissionView; active: MissionActiveView; placeLabel: string }) {
  const place = mission.places.find((p) => p.id === mission.position);
  const backdrop = plateFor("backdrop");
  const building = place ? PLACE_PLATE[place.id] : undefined;
  const buildingPlate = building ? plateFor(building) : null;
  const ch = active.character ? mission.characters.find((c) => c.id === active.character) : null;
  const chPlate = ch ? plateFor(CHARACTER_PLATE[ch.plate] ?? (ch.plate as PlateId)) : null;
  // The scene is a close-up of the same painting: backdrop zoomed around the place, its building and its person.
  const bx = place ? (place.x / 1600) * 100 : 50;
  const by = place ? (place.y / 900) * 100 : 50;
  return (
    <div className="relative h-40 overflow-hidden rounded-2xl border-2 sm:h-48" style={{ borderColor: BARK, backgroundImage: backdrop ? `url(${backdrop.href})` : undefined, backgroundSize: "330%", backgroundPosition: `${bx}% ${by}%`, backgroundColor: SEA }} data-testid="scene-header">
      <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(255,248,232,0) 45%, rgba(43,33,24,0.55) 100%)" }} />
      {buildingPlate ? <img src={buildingPlate.href} alt="" aria-hidden className="absolute bottom-2 left-3 h-[80%] w-auto drop-shadow" /> : null}
      {chPlate ? <img src={chPlate.href} alt="" aria-hidden className="absolute bottom-0 right-6 h-[96%] w-auto drop-shadow-lg" data-testid="scene-character" /> : null}
      <div className="absolute bottom-2 left-3 right-28 sm:left-auto sm:right-28">
        <p className="inline-block rounded-full border px-3 text-sm font-bold" style={{ ...cardStyle }}>
          {placeLabel}
          {ch && !placeLabel.includes(ch.name) ? ` · ${ch.name}` : ""}
        </p>
      </div>
    </div>
  );
}

function Lines({ lines, mission, act, step, busy, offset }: { lines: MissionActiveView["intro"]; mission: MissionView; act: Act; step: string; busy: boolean; offset: number }) {
  if (!lines.length) return null;
  return (
    <div className="grid gap-2">
      {lines.map((l, i) => {
        const speaker = l.speaker ? mission.characters.find((c) => c.id === l.speaker)?.name ?? null : null;
        const foreign = l.language !== "de";
        return (
          <div key={i} className={cn("rounded-2xl border-2 px-4 py-3", speaker ? "" : "border-dashed")} style={{ borderColor: speaker ? BARK : "#d6c3a3", background: speaker ? "#fffdf6" : "transparent" }} data-testid="scene-line" data-language={l.language}>
            {speaker ? <p className="text-sm font-bold">{speaker}{foreign ? (l.language === "en" ? " · English" : " · Español") : ""}</p> : null}
            <p className="text-lg leading-snug" lang={l.language}>
              {l.text}
            </p>
            {foreign ? (
              l.translated ? (
                <p className="mt-1 text-base italic" data-testid="line-translation">
                  Auf Deutsch: {l.translated}
                </p>
              ) : (
                <button type="button" className="mt-1 text-sm font-semibold underline" disabled={busy} onClick={() => void act({ a: "support", step, kind: "line-translation", line: i + offset })} data-testid="line-translate">
                  Was heisst das? (zählt als Hilfe)
                </button>
              )
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ScenePanel({ child, mission, active, busy, act, speech, placeLabel }: { child: ChildId; mission: MissionView; active: MissionActiveView; busy: boolean; act: Act; speech: ChildSpeechPlayer; placeLabel: string }) {
  const finished = active.status !== "active";
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [active.id]);
  return (
    <section className={cn(card, "flex min-w-0 flex-col gap-3 p-3 sm:p-4")} style={cardStyle} aria-labelledby="mw-scene-title" data-testid="scene-panel" data-step={active.id} data-kind={active.kind} data-status={active.status} data-phase={active.phase}>
      <SceneHeader mission={mission} active={active} placeLabel={placeLabel} />
      <div className="flex items-center justify-between gap-2">
        <h2 id="mw-scene-title" ref={headingRef} tabIndex={-1} className="text-xl font-bold outline-none">
          {active.title}
        </h2>
        <button type="button" className={btn} style={btnSecondaryStyle} disabled={busy} onClick={() => void act({ a: "leave" })} data-testid="scene-leave">
          {finished ? "Weiter auf der Insel →" : "Zurück zur Insel"}
        </button>
      </div>
      {active.kind !== "typing-block" ? <Lines lines={active.intro} mission={mission} act={act} step={active.id} busy={busy} offset={0} /> : null}
      {active.kind === "story" || active.kind === "outcome" ? <StoryTask active={active} busy={busy} act={act} /> : null}
      {active.kind === "read" || active.kind === "listen" ? <QuestionTask child={child} active={active} busy={busy} act={act} speech={speech} /> : null}
      {active.kind === "calc" ? <CalcTask active={active} busy={busy} act={act} /> : null}
      {active.kind === "choice" ? <ChoiceTask active={active} busy={busy} act={act} /> : null}
      {active.kind === "produce" || active.kind === "recall" ? <ProduceTask active={active} busy={busy} act={act} /> : null}
      {active.kind === "typing-block" && active.typing ? <TypingBlock block={active.typing} stepId={active.id} busy={busy} act={act} /> : null}
      {finished ? (
        <div className="grid gap-2" data-testid="scene-done">
          <Lines lines={active.done} mission={mission} act={act} step={active.id} busy={busy} offset={active.intro.length} />
          <button type="button" className={btnPrimary} style={btnPrimaryStyle} disabled={busy} onClick={() => void act({ a: "leave" })} data-testid="scene-continue">
            Weiter auf der Insel →
          </button>
        </div>
      ) : null}
      <p className="text-sm">Du kannst jederzeit oben «Stopp» drücken. Was du gemacht hast, bleibt gespeichert.</p>
    </section>
  );
}

function StoryTask({ active, busy, act }: { active: MissionActiveView; busy: boolean; act: Act }) {
  if (active.status !== "active") return null;
  return (
    <button type="button" className={btnPrimary} style={btnPrimaryStyle} disabled={busy} onClick={() => void act({ a: "story-done", step: active.id })} data-testid="story-done" autoFocus>
      {active.kind === "outcome" ? "⛵ Boote losschicken" : "Verstanden"}
    </button>
  );
}

// --- reading / listening ---------------------------------------------------

function QuestionTask({ child, active, busy, act, speech }: { child: ChildId; active: MissionActiveView; busy: boolean; act: Act; speech: ChildSpeechPlayer }) {
  const listen = active.listen;
  const [playing, setPlaying] = useState(false);
  const [audioNote, setAudioNote] = useState<string | null>(null);
  const [voice, setVoice] = useState<"none" | "child-voice" | "browser">("none");
  const play = async () => {
    if (!listen) return;
    speech.unlock();
    // The play is recorded first (listening record, not help); the reviewed text is then spoken in the child's voice.
    const res = await act({ a: "support", step: active.id, kind: "play" });
    if (!res) return;
    setPlaying(true);
    setAudioNote(null);
    const script = typeof res.script === "string" ? res.script : null;
    const outcome = script ? await speech.speak({ childId: child, text: script }) : "fallback";
    // The player's contract: "fallback" = the child voice could not be fetched or played → the browser's own speech reads the
    // same reviewed text, in the text's language. Nothing here involves any assistant or inference.
    const viaBrowser = outcome === "fallback" && script ? await speakWithBrowser(script, listen.language) : false;
    setVoice(outcome === "played" ? "child-voice" : viaBrowser ? "browser" : "none");
    setPlaying(false);
    if (outcome !== "played" && !viaBrowser) setAudioNote("Der Ton kam gerade nicht. Versuch es noch einmal — oder lass dir danach den Text zeigen (zählt als Hilfe).");
  };
  const open = active.questions.filter((q) => q.status === "open");
  return (
    <div className="grid gap-3" data-testid="question-task" data-mode={listen ? "listening" : "reading"}>
      {active.readText ? (
        <div className="rounded-2xl border-2 px-4 py-3 font-semibold" style={{ borderColor: BARK, background: "#f3e7cf" }} data-testid="read-text">
          {active.readText.split("\n").map((line, i) => (
            <p key={i} className={cn("text-lg leading-snug", i === 0 && "text-xl tracking-wide")}>
              {line}
            </p>
          ))}
        </div>
      ) : null}
      {listen ? (
        <div className="rounded-2xl border-2 px-4 py-3" style={{ borderColor: BARK, background: "#e8f1f8" }} data-testid="listen-box" data-voice={voice}>
          <p className="text-base font-semibold">Hör genau zu — du kannst so oft anhören, wie du willst.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className={btnPrimary} style={btnPrimaryStyle} disabled={busy || playing} onClick={() => void play()} data-testid="listen-play" autoFocus>
              {playing ? "… spielt" : listen.plays ? "🔊 Nochmal anhören" : "🔊 Anhören"}
            </button>
            {listen.plays > 0 && !listen.transcriptShown ? (
              <button type="button" className={btn} style={btnSecondaryStyle} disabled={busy} onClick={() => void act({ a: "support", step: active.id, kind: "transcript" })} data-testid="listen-transcript">
                Text zeigen (zählt als Hilfe)
              </button>
            ) : null}
            {listen.plays > 0 && listen.transcriptShown && !listen.translationShown ? (
              <button type="button" className={btn} style={btnSecondaryStyle} disabled={busy} onClick={() => void act({ a: "support", step: active.id, kind: "translation" })} data-testid="listen-translation">
                Auf Deutsch (zählt als Hilfe)
              </button>
            ) : null}
          </div>
          {audioNote ? <p className="mt-2 text-base" role="status">{audioNote}</p> : null}
          {listen.script ? (
            <p className="mt-2 text-lg" lang={listen.language} data-testid="listen-script">
              {listen.script}
            </p>
          ) : null}
          {listen.translation ? <p className="mt-1 text-base italic">Auf Deutsch: {listen.translation}</p> : null}
        </div>
      ) : null}
      {active.questions.map((q) => (
        <QuestionRow key={q.id} q={q} step={active.id} busy={busy || (!!listen && listen.plays === 0)} act={act} first={q.id === open[0]?.id} />
      ))}
      {listen && listen.plays === 0 ? <p className="text-base">Zuerst anhören, dann antworten.</p> : null}
    </div>
  );
}

/** Browser speech for the reviewed listening text (fallback of the child voice). Resolves true when it was handed to the browser. */
function speakWithBrowser(text: string, language: string): Promise<boolean> {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  if (!synth || typeof SpeechSynthesisUtterance === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = language === "en" ? "en-GB" : language === "es" ? "es-ES" : "de-CH";
      u.rate = 0.9;
      // Bounded wait: some browsers never fire `end` (or a muted test browser never speaks).
      const timer = window.setTimeout(() => resolve(true), Math.min(20000, 1500 + text.length * 70));
      u.onend = () => {
        window.clearTimeout(timer);
        resolve(true);
      };
      u.onerror = () => {
        window.clearTimeout(timer);
        resolve(true);
      };
      synth.speak(u);
    } catch {
      resolve(false);
    }
  });
}

function QuestionRow({ q, step, busy, act, first }: { q: MissionActiveView["questions"][number]; step: string; busy: boolean; act: Act; first: boolean }) {
  const [value, setValue] = useState("");
  const done = q.status !== "open";
  return (
    <div className="rounded-2xl border px-4 py-3" style={{ borderColor: "#d6c3a3", background: "#fffdf6" }} data-testid={`question-${q.id}`} data-status={q.status}>
      <p className="text-lg font-semibold">{q.prompt}</p>
      {done ? (
        <p className="mt-1 text-lg" style={{ color: q.status === "correct" ? OK : INK }}>
          {q.status === "correct" ? "✓ Richtig." : `Die Antwort ist: ${q.shownAnswer}. Merk sie dir für später.`}
        </p>
      ) : q.kind === "pick" ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {(q.options ?? []).map((o, i) => (
            <button key={o} type="button" className={btn} style={btnSecondaryStyle} disabled={busy} onClick={() => void act({ a: "answer-question", step, question: q.id, value: o })} data-testid={`pick-${q.id}-${o}`} autoFocus={first && i === 0}>
              {o}
            </button>
          ))}
        </div>
      ) : (
        <form
          className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && value.trim()) void act({ a: "answer-question", step, question: q.id, value: value.trim() }).then((ok) => ok && setValue(""));
          }}
        >
          <input value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} inputMode="numeric" className="h-12 w-24 rounded-xl border-2 px-3 text-xl font-semibold" style={{ borderColor: BARK }} aria-label={q.prompt} data-testid={`number-${q.id}`} autoFocus={first} />
          <button type="submit" className={btnPrimary} style={btnPrimaryStyle} disabled={busy || !value.trim()}>
            OK
          </button>
        </form>
      )}
      {q.hint ? <p className="mt-1 text-base" data-testid={`hint-${q.id}`}>{q.hint}</p> : null}
    </div>
  );
}

// --- calculation ---------------------------------------------------------------

function Counters({ total, perGroup, unit }: { total: number; perGroup: number; unit: string }) {
  const groups = Math.ceil(total / perGroup);
  const crate = plateFor("crate");
  return (
    <div className="mt-2 flex flex-wrap gap-2" aria-label={`${total} ${unit}, in Gruppen zu ${perGroup}`} data-testid="calc-counters">
      {Array.from({ length: groups }, (_, g) => {
        const n = Math.min(perGroup, total - g * perGroup);
        return (
          <div key={g} className="relative rounded-xl border-2 px-2 pb-1 pt-5" style={{ borderColor: BARK, background: "#f3e7cf", minWidth: 64 }}>
            {crate ? <img src={crate.href} alt="" aria-hidden className="absolute -top-3 left-1 h-6 w-auto" /> : null}
            <div className="grid grid-cols-3 gap-1">
              {Array.from({ length: n }, (_, i) => (
                <span key={i} className="block h-3.5 w-3.5 rounded-full" style={{ background: SEA }} />
              ))}
            </div>
            <span className="mt-1 block text-center text-sm font-bold">{n}</span>
          </div>
        );
      })}
    </div>
  );
}

function CalcTask({ active, busy, act }: { active: MissionActiveView; busy: boolean; act: Act }) {
  const c = active.calc!;
  const [values, setValues] = useState<Record<string, string>>({});
  const done = active.status !== "active";
  const firstRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!done) firstRef.current?.focus();
  }, [done, c.tries]);
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        const parsed: Record<string, number | null> = {};
        for (const f of c.fields) parsed[f.key] = values[f.key] ? Number(values[f.key]) : null;
        void act({ a: "answer-calc", step: active.id, values: parsed, raw: c.fields.map((f) => `${f.label}: ${values[f.key] ?? ""}`).join("; ") });
      }}
      data-testid="calc-task"
    >
      <p className="text-lg font-semibold leading-snug">{c.prompt}</p>
      <div className="grid gap-2">
        {c.fields.map((f, i) => (
          <label key={f.key} className="flex flex-wrap items-center gap-3 rounded-2xl border px-3 py-2" style={{ borderColor: "#d6c3a3", background: "#fffdf6" }}>
            <input
              ref={i === 0 ? firstRef : undefined}
              value={done ? String(f.last ?? "") : values[f.key] ?? ""}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value.replace(/[^0-9]/g, "").slice(0, 4) })}
              inputMode="numeric"
              disabled={done}
              className="h-12 w-24 rounded-xl border-2 px-3 text-xl font-semibold"
              style={{ borderColor: f.correct === true ? OK : BARK }}
              data-testid={`calc-${f.key}`}
            />
            <span className="text-lg">{f.label}</span>
            {f.correct === true && !done ? <span className="text-base font-semibold" style={{ color: OK }}>✓ stimmt</span> : null}
            {f.correct === false && !done ? <span className="text-base">noch einmal schauen</span> : null}
          </label>
        ))}
      </div>
      {c.clarification && !done ? (
        <p className="rounded-2xl border-2 border-dashed px-4 py-2 text-lg" style={{ borderColor: SIGNAL }} data-testid="calc-clarification">
          💡 {c.clarification}
        </p>
      ) : null}
      {c.representation && !done ? (
        <div className="rounded-2xl border-2 px-4 py-2" style={{ borderColor: SIGNAL }} data-testid="calc-representation">
          <p className="text-lg">{c.representation.text}:</p>
          <Counters total={c.representation.total} perGroup={c.representation.perGroup} unit={c.representation.unit} />
        </div>
      ) : null}
      {c.teach ? (
        <p className="rounded-2xl border-2 px-4 py-3 text-lg font-semibold" style={{ borderColor: BARK, background: "#f3e7cf" }} data-testid="calc-teach">
          Zusammen gelöst: {c.teach}
        </p>
      ) : null}
      {done ? null : (
        <button type="submit" className={btnPrimary} style={btnPrimaryStyle} disabled={busy || c.fields.every((f) => !values[f.key])} data-testid="calc-submit">
          Prüfen
        </button>
      )}
    </form>
  );
}

// --- plan choice -------------------------------------------------------------

function ChoiceTask({ active, busy, act }: { active: MissionActiveView; busy: boolean; act: Act }) {
  const ch = active.choice!;
  const done = active.status !== "active";
  const last = ch.picked[ch.picked.length - 1];
  return (
    <div className="grid gap-3" data-testid="choice-task">
      <p className="text-lg font-semibold leading-snug">{ch.prompt}</p>
      <div className="grid gap-2">
        {ch.options.map((o, i) => {
          const tried = ch.picked.find((p) => p.id === o.id);
          return (
            <button key={o.id} type="button" className={cn(btn, "justify-start text-left")} style={{ ...btnSecondaryStyle, borderColor: tried ? (tried.best ? OK : SIGNAL) : BARK }} disabled={busy || done || !!tried} onClick={() => void act({ a: "choose", step: active.id, option: o.id })} data-testid={`choice-${o.id}`} autoFocus={i === 0 && !done}>
              {o.label}
            </button>
          );
        })}
      </div>
      {last ? (
        <p className="rounded-2xl border-2 px-4 py-2 text-lg" style={{ borderColor: last.best ? OK : SIGNAL }} data-testid="choice-feedback">
          {last.best ? "✓ " : ""}
          {last.feedback}
        </p>
      ) : null}
      {ch.teach ? (
        <p className="rounded-2xl border-2 px-4 py-3 text-lg font-semibold" style={{ borderColor: BARK, background: "#f3e7cf" }} data-testid="choice-teach">
          Zusammen geplant: {ch.teach}
        </p>
      ) : null}
    </div>
  );
}

// --- language request (bounded reviewed repair) ------------------------------

function ProduceTask({ active, busy, act }: { active: MissionActiveView; busy: boolean; act: Act }) {
  const p = active.produce!;
  const [text, setText] = useState("");
  const [usedBank, setUsedBank] = useState(false);
  const done = active.status !== "active";
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!done && !p.askMeaning) inputRef.current?.focus();
  }, [done, p.askMeaning, p.tries, active.phase]);
  if (done) return null;
  const exhausted = active.phase === "exhausted";
  return (
    <div className="grid gap-3" data-testid="produce-task" data-language={p.language}>
      <p className="text-lg font-semibold leading-snug">{p.instruction}</p>
      {p.repairLine ? (
        <p className="rounded-2xl border-2 px-4 py-3 text-lg" style={{ borderColor: SIGNAL, background: "#fff4dc" }} data-testid="repair-line" role="status">
          {p.repairLine}
        </p>
      ) : null}
      {p.feedback && !p.repairLine ? (
        <p className="rounded-2xl border-2 px-4 py-3 text-lg" style={{ borderColor: SIGNAL, background: "#fff4dc" }} data-testid="produce-feedback" role="status">
          {p.feedback}
        </p>
      ) : null}
      {p.askMeaning ? (
        <div className="rounded-2xl border-2 px-4 py-3" style={{ borderColor: SIGNAL }} data-testid="ask-meaning">
          <p className="text-lg">Ich bin nicht sicher, welches Wort du meinst mit „{p.askMeaning.given}“. Meinst du …</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {p.askMeaning.options.map((o) => (
              <button key={o.word} type="button" className={btn} style={btnSecondaryStyle} disabled={busy} onClick={() => void act({ a: "meaning", step: active.id, word: o.word })} data-testid={`meaning-${o.word}`}>
                {o.word} ({o.meaningDe})
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {exhausted ? (
        <div className="grid gap-2 rounded-2xl border-2 px-4 py-3" style={{ borderColor: BARK, background: "#f3e7cf" }} data-testid="produce-exhausted">
          <p className="text-lg">
            So sagt man es: <strong lang={p.language}>{p.shownSentence}</strong>
          </p>
          <p className="text-base">Schreib den Satz ab, um ihn zu üben — oder heb ihn fürs nächste Mal auf.</p>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy && text.trim()) void act({ a: "practice", step: active.id, response: text }).then((ok) => ok && setText(""));
            }}
          >
            <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value.slice(0, 200))} lang={p.language} className="h-12 min-w-0 flex-1 rounded-xl border-2 px-3 text-lg" style={{ borderColor: BARK }} aria-label="Satz abschreiben" data-testid="practice-input" autoComplete="off" autoCorrect="off" spellCheck={false} />
            <button type="submit" className={btnPrimary} style={btnPrimaryStyle} disabled={busy || !text.trim()} data-testid="practice-send">
              Üben
            </button>
            <button type="button" className={btn} style={btnSecondaryStyle} disabled={busy} onClick={() => void act({ a: "later", step: active.id })} data-testid="produce-later">
              Fürs nächste Mal aufheben
            </button>
          </form>
        </div>
      ) : (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && text.trim()) void act({ a: "produce", step: active.id, response: text, modality: usedBank ? "word-bank" : "typed" }).then((ok) => ok && setText(""));
          }}
        >
          <label className="text-base font-semibold" htmlFor="mw-produce">
            {p.frame.replace("___", "…")}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input id="mw-produce" ref={inputRef} value={text} onChange={(e) => setText(e.target.value.slice(0, 200))} lang={p.language} disabled={!!p.askMeaning} className="h-12 min-w-0 flex-1 rounded-xl border-2 px-3 text-lg" style={{ borderColor: BARK }} data-testid="produce-input" autoComplete="off" autoCorrect="off" spellCheck={false} />
            <button type="submit" className={btnPrimary} style={btnPrimaryStyle} disabled={busy || !text.trim() || !!p.askMeaning} data-testid="produce-send">
              Sagen
            </button>
          </div>
          {p.wordBank ? (
            <div className="flex flex-wrap gap-2" data-testid="word-bank">
              {p.wordBank.map((w) => (
                <button
                  key={w}
                  type="button"
                  className="rounded-xl border-2 px-3 py-1 text-lg"
                  style={btnSecondaryStyle}
                  onClick={() => {
                    setUsedBank(true);
                    setText((t) => (t.trim() ? `${t.trim()} ${w}` : w.charAt(0).toUpperCase() + w.slice(1)));
                  }}
                >
                  {w}
                </button>
              ))}
            </div>
          ) : (
            <button type="button" className="justify-self-start text-sm font-semibold underline" disabled={busy} onClick={() => void act({ a: "support", step: active.id, kind: "word-bank" })} data-testid="word-bank-open">
              Wörter-Hilfe zeigen (zählt als Hilfe)
            </button>
          )}
          <p className="text-sm">Versuche: {p.tries} von {p.maxTries}</p>
        </form>
      )}
    </div>
  );
}

// --- the typing block (clean: keys and hands only, no character, no decision between drills) ---------------

function TypingBlock({ block, stepId, busy, act }: { block: TypingBlockView; stepId: string; busy: boolean; act: Act }) {
  const drill = block.nextDrill;
  const [lineIndex, setLineIndex] = useState(0);
  const [typed, setTyped] = useState<string[]>([]);
  const [current, setCurrent] = useState("");
  const stamps = useRef<number[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const drillKey = drill ? `${drill.no}-${drill.extra ? "x" : ""}` : "none";
  useEffect(() => {
    setLineIndex(0);
    setTyped([]);
    setCurrent("");
    stamps.current = [];
    inputRef.current?.focus();
  }, [drillKey]);
  // Global pause: leaving mid-drill saves the partial text (never completion).
  const partialRef = useRef({ drill, typed, current });
  partialRef.current = { drill, typed, current };
  // Only when the typing block is LEFT (Stopp, back to the island) — never on a drill change, where nothing is partial.
  useEffect(
    () => () => {
      const p = partialRef.current;
      if (p.drill && (p.typed.length || p.current)) void act({ a: "typing-pause", no: p.drill.no, lines: [...p.typed, p.current], activeSeconds: activeOf(stamps.current, block.idleGapSeconds).active });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  if (block.phase === "not-started") {
    return (
      <div className="grid gap-3" data-testid="typing-block" data-phase="not-started">
        <p className="text-lg">Gleich kommt dein Tippblock. Du siehst nur die Tasten und deine Hände.</p>
        <button type="button" className={btnPrimary} style={btnPrimaryStyle} disabled={busy} onClick={() => void act({ a: "typing-start" })} data-testid="typing-start" autoFocus>
          Tippblock beginnen
        </button>
      </div>
    );
  }
  if (block.phase === "unavailable") {
    return (
      <p className="text-lg" data-testid="typing-block" data-phase="unavailable">
        Die Tastatur ist auf diesem Gerät noch nicht eingerichtet. Der Tippblock bleibt offen — das ist kein Fehler von dir.
      </p>
    );
  }
  if (block.phase === "comfort") {
    return (
      <div className="grid gap-3" data-testid="typing-block" data-phase="comfort">
        <p className="text-xl font-semibold">Alle {block.planned} Übungen geschafft! Wie ging das Tippen?</p>
        <div className="flex flex-wrap gap-2">
          {[
            ["easy", "Leicht"],
            ["ok", "Ging gut"],
            ["hard", "Anstrengend"],
          ].map(([id, label], i) => (
            <button key={id} type="button" className={btn} style={btnSecondaryStyle} disabled={busy} onClick={() => void act({ a: "typing-comfort", comfort: id as "easy" | "ok" | "hard" })} data-testid={`comfort-${id}`} autoFocus={i === 0}>
              {label}
            </button>
          ))}
          <button type="button" className={btn} style={btnSecondaryStyle} disabled={busy} onClick={() => void act({ a: "typing-comfort", comfort: null })} data-testid="comfort-skip">
            Lieber nicht sagen
          </button>
        </div>
      </div>
    );
  }
  if (block.phase === "extra-offer") {
    return (
      <div className="grid gap-3" data-testid="typing-block" data-phase="extra-offer">
        <p className="text-xl font-semibold">Möchtest du noch eine Extra-Übung machen?</p>
        <p className="text-base">Freiwillig — die Mission geht auch ohne weiter.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} style={btnSecondaryStyle} disabled={busy} onClick={() => void act({ a: "typing-extra", take: true })} data-testid="extra-take">
            Ja, eine Extra-Übung
          </button>
          <button type="button" className={btnPrimary} style={btnPrimaryStyle} disabled={busy} onClick={() => void act({ a: "typing-extra", take: false })} data-testid="extra-decline" autoFocus>
            Weiter zur Mission
          </button>
        </div>
      </div>
    );
  }
  if (block.phase === "done" || !drill) {
    return (
      <p className="text-lg" data-testid="typing-block" data-phase="done">
        ✓ Tippblock geschafft.
      </p>
    );
  }
  const expected = drill.lines[lineIndex] ?? "";
  const nextKey = nextExpectedChar(expected, current);
  const wrongKey = (() => {
    const i = current.length - 1;
    return i >= 0 && current[i] !== expected[i] ? current[i] : null;
  })();
  const commitLine = () => {
    const nextTyped = [...typed, current];
    if (lineIndex + 1 < drill.lines.length) {
      setTyped(nextTyped);
      setCurrent("");
      setLineIndex(lineIndex + 1);
      return;
    }
    const s = stamps.current;
    const t = activeOf(s, block.idleGapSeconds);
    const seconds = s.length > 1 ? Math.round((s[s.length - 1] - s[0]) / 1000) : 0;
    setTyped([]);
    setCurrent("");
    partialRef.current = { drill: null, typed: [], current: "" };
    void act({ a: "typing-drill", no: drill.no, lines: nextTyped, seconds, activeSeconds: t.active, idleSeconds: t.idle }).then((ok) => {
      if (!ok) {
        setTyped([]);
        setLineIndex(0);
      }
    });
  };
  return (
    <div className="grid gap-3" data-testid="typing-block" data-phase="drill" data-drill={drill.no} data-extra={drill.extra ? "true" : "false"}>
      <p className="text-base" data-testid="typing-announce">{block.announce}</p>
      <ol className="flex flex-wrap items-center gap-1.5" aria-label={`Übung ${Math.min(block.completed + 1, block.planned)} von ${block.planned}`} data-testid="typing-dots">
        {Array.from({ length: block.planned }, (_, i) => (
          <li key={i} className="h-3 rounded-full" style={{ width: i === block.completed && !drill.extra ? 28 : 12, background: i < block.completed ? OK : i === block.completed && !drill.extra ? SIGNAL : "#d6c3a3" }} aria-hidden />
        ))}
        {drill.extra ? <li className="ml-2 rounded-full px-2 text-sm font-bold text-white" style={{ background: SIGNAL }}>Extra</li> : null}
      </ol>
      <div className="rounded-2xl border-2 px-4 py-3" style={{ borderColor: BARK, background: "#fffdf6" }}>
        {drill.lines.map((line, i) => (
          <p key={i} className={cn("font-mono text-3xl tracking-[0.2em]", i !== lineIndex && "opacity-50")} data-testid={i === lineIndex ? "typing-line" : undefined} aria-current={i === lineIndex ? "true" : undefined}>
            {i < lineIndex ? <span style={{ color: OK }}>{line}</span> : i === lineIndex ? <LineMarks expected={line} typed={current} /> : line}
          </p>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && current.length) commitLine();
        }}
      >
        <input
          ref={inputRef}
          value={current}
          onChange={(e) => {
            stamps.current.push(Date.now());
            setCurrent(e.target.value.slice(0, 60));
          }}
          disabled={busy}
          className="h-14 w-full rounded-xl border-2 px-3 font-mono text-2xl tracking-[0.15em]"
          style={{ borderColor: BARK }}
          aria-label={`Zeile ${lineIndex + 1} von ${drill.lines.length}: ${expected}`}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-testid="typing-input"
        />
        <p className="mt-1 text-sm">Enter: Zeile fertig · Fehler sind erlaubt — tipp einfach weiter.</p>
      </form>
      {block.guide ? <HandsKeyboard fingers={block.guide.fingers} home={block.guide.home} nextKey={nextKey} wrongKey={wrongKey} compact ariaLabel="Tastatur mit Händen" /> : null}
    </div>
  );
}

function LineMarks({ expected, typed }: { expected: string; typed: string }) {
  return (
    <>
      {Array.from(expected).map((ch, i) => {
        const t = typed[i];
        const color = t === undefined ? INK : t === ch ? OK : "#b91c1c";
        return (
          <span key={i} style={{ color, textDecoration: t !== undefined && t !== ch ? "underline" : undefined, borderBottom: i === typed.length ? `3px solid ${SIGNAL}` : undefined }}>
            {ch === " " ? "␣" : ch}
          </span>
        );
      })}
    </>
  );
}

/** Active typing time = sum of gaps between keystrokes up to the idle gap; longer gaps are idle (not practice). */
export function activeOf(stamps: number[], idleGapSeconds: number): { active: number; idle: number } {
  let active = 0;
  let idle = 0;
  for (let i = 1; i < stamps.length; i += 1) {
    const gap = (stamps[i] - stamps[i - 1]) / 1000;
    if (gap <= idleGapSeconds) active += gap;
    else idle += gap;
  }
  return { active: Math.round(active), idle: Math.round(idle) };
}

export function MissionNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-2xl border-2 px-4 py-2 text-base" style={cardStyle}>
      {children}
    </p>
  );
}

void CHARACTER_NAME;
