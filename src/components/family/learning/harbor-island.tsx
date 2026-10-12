"use client";

// ---------------------------------------------------------------------------
// The island (Visit 5, 2026-10-10; family-assistant DESIGN §7.6 "Visit 5 — the
// harbor", feedback group F1; repair round 1: cohesive illustrated scenery).
//
// One illustrated 2.5D island, drawn from durable records only: the named
// base (tent → hut → hut with garden) with its sign, the four garden beds, the
// five station beds with their leftovers, the observation station with its
// lamp (lit only when the Spanish request supplied one), the pier with the
// supply boat (moored only when wood was supplied), and the harbor: the stone
// quay with its crates, the loaded boats once the arithmetic is done, the
// ropes only when cuerdas were supplied, the destination signpost once the
// plan is saved. The three workplaces stand on the island with their keepers
// (English typing-workshop keeper, German planner, Spanish supplier); the
// child's avatar walks between places with the arrow keys or by tapping a
// destination (instant under reduced motion). Direct entry never depends on
// walking: the parent screen renders direct-entry buttons beside the stage.
//
// Artwork: original vector illustration in one consistent style — soft
// atmospheric layers (sky, far hills, sea, shallows), a layered island with
// cliff strata and rounded grass, timber-and-plaster buildings with tiled
// roofs, shutters, hanging sign boards, and characters with faces, arms and
// clothes. Functional hit targets (hotspots, badges, flags) are separate from
// the artwork and keep the released marker contract (data-part="site").
// Label hierarchy: the three workplaces carry large sign boards and status
// badges; the saved places carry small plates; the visit flags sit beside the
// places they belong to. No third-party assets; no score, no reward.
// ---------------------------------------------------------------------------

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { cn } from "@/components/ui/nabu";
import type { SceneModel } from "@/lib/family-learning-summary";
import type { HarborView, HarborWorkplaceView, WorkplaceStatus } from "@/lib/family-learning-state";
import type { WorldMarker } from "./expedition-world";

export type IslandPlace = "base" | "garden" | "station" | "pier" | "harbor" | "workshop" | "office" | "shop" | "harbormaster" | "logbook" | "supplies" | "wordbook";

export type IslandDestination = {
  id: IslandPlace;
  label: string;
  /** What arriving means (shown on the arrive card). */
  action: string;
  enabled: boolean;
  /** For workplaces: the honest status from the server view. */
  status?: WorkplaceStatus;
  workplace?: HarborWorkplaceView["id"];
};

export type HarborIslandProps = {
  scene: SceneModel;
  markers: WorldMarker[];
  pages: number;
  harbor?: HarborView | null;
  /** "full" fills its container (16:9 stage, cropped to cover); "strip" shows the island band only; "stage" keeps the whole stage visible (contain). */
  variant?: "full" | "strip" | "stage";
  /** The walkable destinations; omitted = a static picture. */
  destinations?: IslandDestination[];
  /** Where the avatar stands (a destination id); defaults to the harbor quay. */
  avatarAt?: IslandPlace | null;
  /** The avatar arrived at a destination (walked or jumped). */
  onArrive?: (destination: IslandDestination) => void;
  onSelectMarker?: (marker: WorldMarker) => void;
  onOpenLogbook?: () => void;
  onOpenSupplies?: () => void;
  onOpenWordbook?: () => void;
  /** Accessible description override; computed from the scene otherwise. */
  description?: string;
  className?: string;
  children?: ReactNode;
  /** Shown as a caption under the avatar once arrived (e.g. "Enter"); null hides it. */
  arriveHint?: string | null;
  /**
   * Label mode (UI pass 2026-10-11). "focused" (default): only the three workplace labels and the selected arrival are shown — as
   * screen-space chips with a fixed font size, readable on a tablet; the saved-place plates, counts and visit captions in the artwork
   * are hidden until the child switches to "all" with the on-stage toggle (keyboard reachable). Nothing is removed from the record:
   * flags, places and hit targets stay; only their small in-stage captions are folded away.
   */
  labels?: "focused" | "all";
  /** Whether the on-stage toggle between the two label modes is offered (default: everywhere but the strip). */
  labelsToggle?: boolean;
};

// ---------------------------------------------------------------------------
// Stage geometry (1600 × 900): where everything stands
// ---------------------------------------------------------------------------

type P = [number, number];
// Art probe B1 (2026-10-11): the nodes live beside the plate boxes (one table, measured on the painted terrain); topology below is unchanged.
const POS: Record<IslandPlace, P> = Object.fromEntries(Object.entries(ISLAND_NODES).map(([k, v]) => [k, [v[0], v[1]]])) as Record<IslandPlace, P>;
/** Walking graph: a destination's neighbours (the avatar steps along these edges with the arrow keys). */
const EDGES: [IslandPlace, IslandPlace][] = [
  ["base", "garden"], ["base", "logbook"], ["base", "supplies"], ["garden", "workshop"], ["garden", "shop"], ["workshop", "office"], ["workshop", "harbormaster"],
  ["office", "station"], ["office", "pier"], ["office", "wordbook"], ["shop", "harbor"], ["harbor", "harbormaster"], ["harbormaster", "wordbook"], ["wordbook", "pier"], ["supplies", "workshop"],
];
/** Moorings in the water off the painted quay's south-east face — boats never sit on the stone, and they stay inside the desktop
 *  map's cover framing (x ≥ 640) and clear of the page's status card (lower-left), so the loaded boats are actually seen. */
const BOAT_MOORINGS: P[] = [[700, 858], [810, 856], [920, 850], [1030, 846], [760, 886], [870, 884], [980, 880]];
const STATION_POS: Record<string, P> = Object.fromEntries(Object.entries(STATION_SPOTS).map(([k, v]) => [k, [v[0], v[1]]])) as Record<string, P>;

/** Horizon row of the painted terrain (art probe B1): the far destinations are lifted from the vector horizon (352) onto it. */
const PAINTED_HORIZON_Y = 167;
const SUPPLY_LABEL: Record<string, string> = { Essenspakete: "Essenspakete", Setzlinge: "Setzlinge", Proben: "Proben", Bretter: "Bretter", Kisten: "Kisten", water: "Wasser", agua: "Wasser", tools: "Werkzeug", herramientas: "Werkzeug", seeds: "Samen", semillas: "Samen", lamp: "Lampe", lámpara: "Lampe", wood: "Holz", rope: "Seil", cuerdas: "Seile", cajas: "Kisten" };
const LOCATION_LABEL: Record<string, string> = { crater: "Am Kraterrand", ice: "Auf dem Eisfeld", forest: "Im Nebelwald", shore: "An der Küste" };
const DESTINATION_LABEL: Record<string, string> = { lighthouse: "Leuchtturm-Insel", mainland: "Festland", ship: "Forschungsschiff" };

import { B3_ANCHORS, ISLAND_NODES, PLATE_BOXES, STATION_SPOTS, plateFor, type PlateId } from "./harbor-island-plates";

/** Label mode shared with the drawing helpers: `all` shows every in-stage caption; `hub` = a walkable stage (no "where next" callouts there). */
const LabelsCtx = createContext<{ all: boolean; hub: boolean }>({ all: true, hub: false });

/** Fallback names for the selected-arrival chip (destinations may carry their own label). */
const PLACE_NAME: Record<IslandPlace, string> = { base: "Basis", garden: "Garten", station: "Station", pier: "Steg", harbor: "Kai", workshop: "Tipp-Werkstatt", office: "Planungsbüro", shop: "Hafenladen · Rosa", harbormaster: "Hafenmeister", logbook: "Logbuch", supplies: "Vorräte", wordbook: "Wörterbuch" };

const FONT = "var(--font-geist-sans), Arial, sans-serif";
const INK = "#2b2118";
const INK_SOFT = "rgba(43,33,24,0.35)";

export function islandSupplyRows(scene: SceneModel): { label: string; count: number }[] {
  const rows = new Map<string, number>();
  for (const s of scene.stores) rows.set(SUPPLY_LABEL[s.key] ?? s.key, (rows.get(SUPPLY_LABEL[s.key] ?? s.key) ?? 0) + s.count);
  return [...rows.entries()].map(([label, count]) => ({ label, count }));
}

/** Plain-language description of the island (assistive tech, parent, tests). */
export function describeIsland(scene: SceneModel, markers: WorldMarker[], pages: number, harbor?: HarborView | null): string {
  const parts: string[] = [];
  if (!scene.name) parts.push("Eine Insel mit Hafen, Tipp-Werkstatt, Planungsbüro und Hafenladen. Noch keine Basis — der erste Besuch beginnt mit dem Bauen.");
  else {
    parts.push(`Basis „${scene.name}“${scene.location ? `, ${LOCATION_LABEL[scene.location] ?? scene.location}` : ""}: ${scene.base === "tent" ? "ein Zelt" : "eine Hütte"}.`);
    const garden = scene.beds.filter((b) => b.id.startsWith("garden"));
    const station = scene.beds.filter((b) => b.id.startsWith("station"));
    if (garden.length) parts.push(`${garden.length} Gartenbeete mit je ${garden[0].filled} Setzlingen.`);
    if (station.length) parts.push(`${station.length} Stationsbeete${scene.leftovers ? `, ${scene.leftovers} Setzlinge übrig daneben` : ""}.`);
    if (scene.station.built) parts.push(`Beobachtungsstation${scene.station.lamp ? ", die Lampe brennt" : ", ohne Lampe"}.`);
    if (scene.pier.built) parts.push(`Steg${scene.pier.boat ? ", das Boot hat angelegt" : ", das Boot wartet noch draussen"}.`);
    if (scene.harbor.fullBoats) parts.push(`Hafen: ${scene.harbor.fullBoats} volle Boote, ${scene.harbor.remaining} Kisten übrig${scene.harbor.boatsNeeded ? `, ${scene.harbor.boatsNeeded} Boote für alle` : ""}${scene.harbor.planned && scene.harbor.destination ? `, Ziel ${DESTINATION_LABEL[scene.harbor.destination] ?? scene.harbor.destination}` : ""}${scene.harbor.roped ? ", mit Seilen festgemacht" : ""}.`);
    else parts.push("Am Kai warten Kisten auf die Boote.");
    const rows = islandSupplyRows(scene);
    if (rows.length) parts.push(`Vorräte: ${rows.map((r) => `${r.count} ${r.label}`).join(", ")}.`);
    parts.push(`${pages} ${pages === 1 ? "Seite" : "Seiten"} im Logbuch.`);
  }
  parts.push("Werkstätten: Tipp-Werkstatt (Mrs Finley, English), Planungsbüro (Herr Baumann), Hafenladen (Rosa, Español).");
  if (harbor) parts.push(harbor.workplaces.map((w) => `${w.label}: ${w.status === "done" ? "fertig" : w.status === "current" ? "angefangen" : w.status === "open" ? "offen" : "noch zu"}`).join(", ") + ".");
  const done = markers.filter((m) => m.state === "done").map((m) => m.caption);
  const next = markers.find((m) => m.state === "next" || m.state === "running");
  if (done.length) parts.push(`Fertig: ${done.join(", ")}.`);
  if (next) parts.push(`${next.state === "running" ? "Angefangen" : "Als Nächstes"}: ${next.label}.`);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Artwork pieces — one style: soft fills, warm ink outlines (1.5–2.5), 2.5D top faces, hanging sign boards
// ---------------------------------------------------------------------------

/** Width of a sign board for `text` at `size` (used to place badges beside boards, never over the text). */
function signWidth(text: string, size = 16): number {
  return Math.max(80, text.length * size * 0.62 + 28);
}

/** A sign board with readable text (hung on two short chains when `hung`). */
function SignBoard({ x, y, text, width, size = 16, hung = false, tone = "wood" }: { x: number; y: number; text: string; width?: number; size?: number; hung?: boolean; tone?: "wood" | "paper" | "dark" }) {
  const labels = useContext(LabelsCtx);
  const w = width ?? signWidth(text, size);
  if (!labels.all) return null;
  const fill = tone === "dark" ? INK : tone === "paper" ? "#fff8e8" : "#e8c893";
  const stroke = tone === "dark" ? INK : "#6b4423";
  const color = tone === "dark" ? "#fff8e8" : "#3b2a12";
  return (
    <g transform={`translate(${x} ${y})`} aria-hidden>
      {hung ? (
        <>
          <line x1={-w / 2 + 12} y1={-16} x2={-w / 2 + 12} y2={0} stroke="#6b4423" strokeWidth={2} />
          <line x1={w / 2 - 12} y1={-16} x2={w / 2 - 12} y2={0} stroke="#6b4423" strokeWidth={2} />
        </>
      ) : null}
      <rect x={-w / 2} y={0} width={w} height={size + 14} rx={5} fill={fill} stroke={stroke} strokeWidth={2} />
      {tone === "wood" ? <line x1={-w / 2 + 6} y1={(size + 14) / 2} x2={w / 2 - 6} y2={(size + 14) / 2} stroke="#c9a46b" strokeWidth={1} opacity={0.7} /> : null}
      <text x={0} y={size + 2} textAnchor="middle" fontSize={size} fontWeight={700} fill={color} fontFamily={FONT}>
        {text}
      </text>
    </g>
  );
}

function Sky() {
  return (
    <g aria-hidden>
      <rect x={0} y={0} width={1600} height={900} fill="url(#isl-sky)" />
      <circle cx={1270} cy={168} r={150} fill="url(#isl-sunHalo)" />
      <circle cx={1270} cy={168} r={54} fill="#fff4c4" stroke="#ffe9a3" strokeWidth={6} />
      {[[180, 150, 1.1], [520, 100, 0.85], [900, 190, 0.75], [1430, 250, 0.7]].map(([x, y, k], i) => (
        <g key={i} transform={`translate(${x} ${y}) scale(${k})`}>
          <ellipse cx={0} cy={6} rx={96} ry={22} fill="#dbeaf5" />
          <ellipse cx={0} cy={0} rx={82} ry={26} fill="#ffffff" />
          <ellipse cx={-48} cy={8} rx={46} ry={20} fill="#ffffff" />
          <ellipse cx={52} cy={10} rx={54} ry={22} fill="#ffffff" />
          <ellipse cx={8} cy={-16} rx={44} ry={24} fill="#ffffff" />
          <ellipse cx={-10} cy={12} rx={60} ry={12} fill="#eaf3fa" />
        </g>
      ))}
      <g stroke={INK} strokeWidth={2.2} fill="none" strokeLinecap="round" opacity={0.5}>
        <path d="M700 230 q 12 -12 24 0 q 12 -12 24 0" />
        <path d="M760 262 q 10 -10 20 0 q 10 -10 20 0" />
        <path d="M1080 212 q 12 -12 24 0 q 12 -12 24 0" />
      </g>
      {/* far hills with atmospheric perspective */}
      <path d="M0 338 C 120 300, 260 286, 420 318 C 560 346, 700 300, 860 322 C 1000 342, 1140 292, 1280 316 C 1400 336, 1520 306, 1600 326 L 1600 360 L 0 360 Z" fill="#c4dbea" />
      <path d="M0 352 C 160 326, 300 318, 470 342 C 620 362, 760 330, 930 348 C 1080 364, 1220 326, 1380 346 C 1480 358, 1560 346, 1600 350 L 1600 372 L 0 372 Z" fill="#a9c7dc" />
    </g>
  );
}

/** The far shore: the three reviewed destinations on the horizon (lighthouse island, mainland, research ship). */
function Horizon({ destination }: { destination: string | null }) {
  return (
    <g aria-hidden>
      <rect x={0} y={352} width={1600} height={548} fill="url(#isl-sea)" />
      <rect x={0} y={352} width={1600} height={26} fill="#ffffff" opacity={0.18} />
      <FarDestinations destination={destination} />
      {/* shallows around the island */}
      <path d="M60 600 C 40 740, 150 850, 440 862 L 1260 876 C 1540 872, 1600 740, 1560 580 C 1520 440, 1320 392, 1100 380 C 900 368, 680 346, 400 372 C 220 390, 90 460, 60 600 Z" fill="#6fc8ea" opacity={0.55} />
      {/* soft swell lines */}
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <path key={i} d={`M${60 + i * 230} ${430 + (i % 2) * 36} q 30 -10 60 0 t 60 0`} stroke="#ffffff" strokeWidth={3} fill="none" opacity={0.35} strokeLinecap="round" />
      ))}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <path key={`w${i}`} d={`M${100 + i * 270} ${846 + (i % 2) * 22} q 32 -14 64 0 t 64 0`} stroke="#ffffff" strokeWidth={4} fill="none" opacity={0.55} strokeLinecap="round" className="isl-wave" />
      ))}
    </g>
  );
}

/** The three reviewed destinations (mainland, lighthouse island, research ship) with their live lighting; drawn on the vector horizon
 *  (y 352) or, when the painted terrain is mounted, shifted up onto ITS horizon (`dy`) above the plate — the chosen destination stays lit
 *  until the painted far-destination plates (art batch B5) replace these drawings. */
function FarDestinations({ destination, dy = 0 }: { destination: string | null; dy?: number }) {
  const glow = (id: string) => (destination === id ? 1 : 0.8);
  if (plateFor("far-mainland") && plateFor("far-lighthouse") && plateFor("far-ship")) return <g aria-hidden data-part="far-destinations">
    <g opacity={glow("mainland")} data-part="far-mainland"><Sprite id="far-mainland" x={100} y={85} width={300} height={85} /></g>
    <g opacity={glow("lighthouse")} data-part="far-lighthouse"><Sprite id="far-lighthouse" x={1260} y={55} width={180} height={112} /></g>
    <g opacity={glow("ship")} data-part="far-ship"><Sprite id="far-ship" x={610} y={95} width={150} height={72} /></g>
  </g>;
  return (
    <g aria-hidden transform={dy ? `translate(800 ${352 + dy}) scale(0.7) translate(-800 -352)` : undefined} data-part="far-destinations">
      {/* mainland (left): a headland with a small village */}
      <g opacity={glow("mainland")} data-part="far-mainland">
        <path d="M-20 356 L 80 292 L 170 318 L 250 270 L 340 322 L 420 300 L 520 356 Z" fill="#7fa6c0" />
        <path d="M80 292 L 118 306 L 170 318 Z" fill="#ffffff" opacity={0.5} />
        <path d="M250 270 L 288 290 L 340 322 Z" fill="#ffffff" opacity={0.5} />
        {[300, 330, 360].map((x, i) => (
          <g key={x} transform={`translate(${x} ${338 - i * 3})`}>
            <rect x={-7} y={-10} width={14} height={10} fill="#f3e9d8" />
            <polygon points="-9,-10 0,-18 9,-10" fill="#b4533a" />
          </g>
        ))}
      </g>
      {/* lighthouse island (right) */}
      <g opacity={glow("lighthouse")} data-part="far-lighthouse">
        <ellipse cx={1440} cy={356} rx={130} ry={18} fill="#7fa6c0" />
        <path d="M1330 354 q 40 -30 90 -18 q 60 -14 120 18 Z" fill="#6f98b4" />
        <rect x={1420} y={258} width={36} height={96} rx={3} fill="#f6f2ea" stroke="#5f6f7e" strokeWidth={2} />
        <rect x={1420} y={282} width={36} height={14} fill="#d9402f" />
        <rect x={1420} y={312} width={36} height={14} fill="#d9402f" />
        <rect x={1414} y={246} width={48} height={14} rx={3} fill={INK} />
        <rect x={1426} y={232} width={24} height={14} fill="#fde68a" stroke={INK} strokeWidth={2} />
        <polygon points="1414,232 1438,218 1462,232" fill="#5f6f7e" />
        <circle cx={1438} cy={239} r={5} fill="#fff4c4" />
      </g>
      {/* research ship (centre) */}
      <g opacity={glow("ship")} data-part="far-ship">
        <path d="M560 356 h 170 l -26 -24 h -120 z" fill="#44546a" />
        <rect x={615} y={312} width={64} height={22} rx={2} fill="#e6edf3" stroke="#44546a" strokeWidth={1.5} />
        <rect x={634} y={290} width={14} height={22} fill="#5f6f7e" />
        <rect x={650} y={300} width={6} height={12} fill="#5f6f7e" />
        <circle cx={626} cy={323} r={2.5} fill="#44546a" />
        <circle cx={640} cy={323} r={2.5} fill="#44546a" />
      </g>
    </g>
  );
}

/**
 * Base-location state on the painted terrain (art probe B1, interim until painted overlay sprites exist — art batch B4b): the painted
 * plateau is one summer meadow, so the saved location is shown as a translucent wash clipped to the plateau plus its marks (forest
 * pines, crater rim, ice drifts). Nothing is dropped silently: `data-location` names the state and the parent/report text is unchanged.
 */
function LocationOverlay({ location }: { location: string | null }) {
  if (!location || location === "shore") return <g data-part="location-overlay" data-location={location ?? "none"} />;
  // Painted location sprites now carry the saved state; no flat oval wash over the terrain.
  return (
    <g data-part="location-overlay" data-location={location} aria-hidden>

      {location === "forest" ? [[330, 330], [760, 262], [1240, 392]].map(([x, y], i) => <Sprite key={i} id="overlay-forest" x={x-55} y={y-90} width={110} height={90} />) : null}
      {location === "crater" ? <Sprite id="overlay-crater" x={560} y={200} width={230} height={100} /> : null}
      {location === "ice" ? [[420, 330], [760, 300], [1050, 330], [620, 520], [980, 560], [1240, 440]].map(([x,y],i) => <Sprite key={i} id="overlay-ice" x={x-55} y={y-24} width={110} height={48} />) : null}
    </g>
  );
}

/** The island mass: cliffs with strata on the left, a rounded grassy plateau, a sandy shore with a bay on the right and the stone quay on the left. */
function Land({ location }: { location: string | null }) {
  const grass = location === "ice" ? "#cfe8dc" : location === "crater" ? "#a3af5a" : "#8fc25a";
  const grassLight = location === "ice" ? "#e4f3eb" : location === "crater" ? "#bcc56f" : "#a9d36f";
  const grassDark = location === "ice" ? "#a9d3c0" : location === "crater" ? "#7b8747" : "#6ba043";
  const cliff = location === "ice" ? "#a9cfe2" : location === "crater" ? "#6b5650" : "#b8865c";
  const cliffDark = location === "ice" ? "#7fb3cf" : location === "crater" ? "#3f3331" : "#8a6040";
  const sand = location === "ice" ? "#eef6ff" : "#f3e2b0";
  const sandDark = location === "ice" ? "#d9e9f7" : "#e2c98c";
  return (
    <g aria-hidden>
      {/* underwater shelf */}
      <path d="M90 560 C 60 700, 160 820, 420 830 L 1240 850 C 1500 850, 1580 720, 1520 560 C 1480 440, 1300 400, 1100 390 C 900 380, 700 360, 420 380 C 240 395, 110 460, 90 560 Z" fill="#2e86b8" opacity={0.35} />
      {/* cliff body with strata */}
      <path d="M120 560 C 100 660, 170 760, 400 775 L 960 790 C 1200 790, 1480 760, 1500 640 L 1500 560 C 1480 450, 1300 410, 1100 400 C 900 390, 700 370, 420 390 C 240 405, 130 470, 120 560 Z" fill={cliffDark} />
      <path d="M130 545 C 115 630, 180 720, 400 735 L 960 750 C 1180 750, 1440 720, 1470 620 L 1470 555 C 1455 460, 1290 420, 1100 410 C 900 400, 700 382, 420 400 C 250 414, 140 470, 130 545 Z" fill={cliff} />
      <g stroke={cliffDark} strokeWidth={2} fill="none" opacity={0.45}>
        <path d="M150 600 C 260 640, 420 668, 560 680" />
        <path d="M170 650 C 280 690, 440 706, 580 712" />
        <path d="M1200 700 C 1300 690, 1400 672, 1450 640" />
        <path d="M1240 735 C 1340 724, 1420 700, 1460 672" />
      </g>
      {/* plateau: base grass, lighter centre, a darker rim on the east */}
      <path d="M140 520 C 150 450, 280 400, 440 392 C 700 376, 900 392, 1100 404 C 1290 414, 1440 450, 1450 530 C 1440 600, 1300 640, 1180 660 C 980 690, 760 700, 560 690 C 380 680, 170 620, 140 520 Z" fill={grass} />
      <path d="M260 500 C 300 450, 420 430, 560 426 C 760 420, 900 432, 1040 446 C 1140 456, 1220 486, 1230 530 C 1210 580, 1100 610, 980 622 C 820 640, 640 640, 480 624 C 350 610, 250 570, 260 500 Z" fill={grassLight} opacity={0.55} />
      <path d="M960 460 C 1100 455, 1250 480, 1340 530 C 1360 580, 1280 620, 1180 640 C 1120 648, 1060 650, 1010 640 C 980 600, 950 530, 960 460 Z" fill={grassDark} opacity={0.3} />
      <path d="M140 520 C 150 450, 280 400, 440 392 C 700 376, 900 392, 1100 404 C 1290 414, 1440 450, 1450 530 C 1440 600, 1300 640, 1180 660 C 980 690, 760 700, 560 690 C 380 680, 170 620, 140 520 Z" fill="url(#isl-grass)" />
      <path d="M140 520 C 150 450, 280 400, 440 392 C 700 376, 900 392, 1100 404 C 1290 414, 1440 450, 1450 530 C 1440 600, 1300 640, 1180 660 C 980 690, 760 700, 560 690 C 380 680, 170 620, 140 520 Z" fill="url(#isl-sunlight)" />
      {/* flower beds and meadow patches (painted reference: dense foliage with blossoms) */}
      {[[1300, 560, "#e5484d"], [1240, 610, "#f59e0b"], [420, 520, "#a78bfa"], [700, 450, "#e5484d"], [1020, 610, "#f472b6"]].map(([x, y, c], i) => (
        <g key={i} transform={`translate(${x} ${y})`}>
          {[[-10, 0], [6, -6], [14, 4], [-2, 8], [-16, 10]].map(([dx, dy], k) => <circle key={k} cx={dx} cy={dy} r={2.6} fill={c as string} opacity={0.9} />)}
        </g>
      ))}
      {/* grass tufts */}
      {[[240, 470], [380, 440], [560, 560], [720, 540], [940, 560], [1020, 430], [1240, 500], [1300, 600], [660, 600], [900, 420]].map(([x, y], i) => (
        <path key={i} d={`M${x} ${y} q 3 -9 6 0 m -2 1 q 3 -8 7 -1 m -11 0 q -2 -8 -6 -2`} stroke={grassDark} strokeWidth={1.8} fill="none" strokeLinecap="round" opacity={0.8} />
      ))}
      {/* beach ring along the south shore and the bay */}
      <path d="M560 690 C 760 700, 980 690, 1180 660 C 1300 640, 1440 600, 1450 530 L 1480 560 C 1480 640, 1340 690, 1200 715 C 1000 750, 760 760, 560 745 Z" fill={sand} />
      <path d="M600 735 C 760 748, 980 738, 1180 706 C 1280 690, 1380 660, 1440 620" stroke={sandDark} strokeWidth={5} fill="none" opacity={0.7} />
      <path d="M1130 660 C 1220 650, 1310 680, 1340 740 C 1320 790, 1240 810, 1160 800 C 1100 790, 1060 740, 1130 660 Z" fill="url(#isl-bay)" data-part="bay" />
      <path d="M1150 676 C 1210 668, 1280 690, 1300 730" stroke="#ffffff" strokeWidth={3} fill="none" opacity={0.6} strokeLinecap="round" />
      {/* harbour quay (stone blocks) */}
      <path d="M300 718 L 920 712 L 920 766 L 300 772 Z" fill="#8f98a3" data-part="quay" />
      <path d="M300 718 L 920 712 L 920 766 L 300 772 Z" fill="url(#isl-stone)" opacity={0.85} />
      <path d="M300 718 L 920 712 L 920 730 L 300 736 Z" fill="#d7dde4" />
      <path d="M300 772 C 400 768, 700 770, 920 766" stroke="#5f7a4a" strokeWidth={3} fill="none" opacity={0.5} />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <g key={i}>
          <rect x={312 + i * 78} y={738} width={64} height={14} fill="#aab2bc" stroke="#6f7883" strokeWidth={1} />
          <rect x={352 + i * 78} y={752} width={64} height={14} fill="#a0a8b2" stroke="#6f7883" strokeWidth={1} />
        </g>
      ))}
      {[340, 520, 700, 880].map((x) => (
        <g key={x}>
          <rect x={x - 7} y={698} width={14} height={20} rx={4} fill="#3f4852" />
          <ellipse cx={x} cy={698} rx={8} ry={4} fill="#5b6672" />
        </g>
      ))}
      {/* lantern post on the quay */}
      <g transform="translate(930 700)">
        <line x1={0} y1={14} x2={0} y2={-58} stroke="#3f4852" strokeWidth={4} strokeLinecap="round" />
        <rect x={-8} y={-74} width={16} height={18} rx={3} fill="#fde68a" stroke="#3f4852" strokeWidth={2} />
        <polygon points="-11,-74 0,-82 11,-74" fill="#3f4852" />
      </g>
      {/* path network: soft sand ribbons with a lighter centre */}
      {EDGES.map(([a, b]) => (
        <path key={`${a}-${b}`} d={`M${POS[a][0]} ${POS[a][1] + 22} L ${POS[b][0]} ${POS[b][1] + 22}`} stroke={sandDark} strokeWidth={14} fill="none" strokeLinecap="round" opacity={0.75} />
      ))}
      {EDGES.map(([a, b]) => (
        <path key={`c-${a}-${b}`} d={`M${POS[a][0]} ${POS[a][1] + 22} L ${POS[b][0]} ${POS[b][1] + 22}`} stroke={sand} strokeWidth={6} fill="none" strokeLinecap="round" opacity={0.9} />
      ))}
      {EDGES.map(([a, b]) => (
        <path key={`t-${a}-${b}`} d={`M${POS[a][0]} ${POS[a][1] + 22} L ${POS[b][0]} ${POS[b][1] + 22}`} stroke={sandDark} strokeWidth={2} fill="none" strokeLinecap="round" strokeDasharray="2 14" opacity={0.6} />
      ))}
      {/* trees, bushes and rocks */}
      <Palm x={200} y={440} scale={0.95} />
      <Palm x={1470} y={560} scale={0.85} />
      <Palm x={700} y={640} scale={0.75} />
      <Bush x={520} y={560} />
      <Bush x={960} y={590} scale={0.8} />
      <Bush x={1240} y={560} scale={0.9} />
      <Tree x={330} y={430} scale={0.9} />
      <Tree x={650} y={445} scale={0.75} />
      <Tree x={990} y={470} scale={0.8} />
      <Tree x={1380} y={480} scale={0.95} />
      <Bush x={760} y={520} scale={0.7} />
      <Bush x={1150} y={450} scale={0.7} />
      <Bush x={300} y={600} scale={0.65} />
      <Rock x={1250} y={640} fill={cliffDark} scale={0.8} />
      <Rock x={160} y={590} fill={cliffDark} />
      {location === "forest" ? [[260, 430], [1200, 445], [1440, 520]].map(([x, y], i) => <Pine key={i} x={x} y={y} />) : null}
      {location === "crater" ? <path d="M150 520 C 190 480, 260 470, 300 500" stroke="#c2410c" strokeWidth={4} fill="none" opacity={0.8} /> : null}
    </g>
  );
}

function Palm({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} aria-hidden>
      <ellipse cx={4} cy={4} rx={22} ry={6} fill="rgba(43,33,24,0.18)" />
      <path d="M0 0 C 6 -30, 8 -60, 4 -92" stroke="#8b5a2b" strokeWidth={8} fill="none" strokeLinecap="round" />
      <path d="M0 0 C 6 -30, 8 -60, 4 -92" stroke="#b07a3e" strokeWidth={3} fill="none" strokeLinecap="round" strokeDasharray="6 8" />
      {[-80, -40, 0, 40, 90, 140, 190].map((a) => (
        <g key={a} transform={`translate(4 -92) rotate(${a})`}>
          <path d="M0 0 C 22 -12, 52 -10, 68 6 C 48 4, 20 6, 0 0 Z" fill="#2f8f3a" />
          <path d="M0 0 C 22 -8, 48 -6, 62 4" stroke="#1f6a2a" strokeWidth={1.5} fill="none" />
        </g>
      ))}
      <circle cx={0} cy={-88} r={5} fill="#6b4423" />
      <circle cx={9} cy={-86} r={5} fill="#6b4423" />
    </g>
  );
}

function Bush({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} aria-hidden>
      <ellipse cx={0} cy={6} rx={30} ry={7} fill="rgba(43,33,24,0.15)" />
      <circle cx={-14} cy={-8} r={17} fill="#3f8233" />
      <circle cx={13} cy={-10} r={19} fill="#4a9a3c" />
      <circle cx={0} cy={-2} r={17} fill="url(#isl-leaf)" />
      <circle cx={-10} cy={-16} r={9} fill="#8bd36a" opacity={0.7} />
      <circle cx={14} cy={-20} r={7} fill="#a6e38a" opacity={0.6} />
      <circle cx={-6} cy={-18} r={3} fill="#e5484d" />
      <circle cx={14} cy={-6} r={3} fill="#e5484d" />
      <circle cx={4} cy={-26} r={2.5} fill="#fde68a" />
    </g>
  );
}

/** A round deciduous tree with a layered, lit canopy (painted reference: dense leafy clusters). */
function Tree({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} aria-hidden>
      <ellipse cx={4} cy={6} rx={34} ry={8} fill="rgba(43,33,24,0.18)" />
      <path d="M-5 0 C -3 -20, -2 -36, 0 -50 C 2 -36, 3 -20, 5 0 Z" fill="#6b4423" />
      <circle cx={-18} cy={-48} r={22} fill="#2f6e2a" />
      <circle cx={18} cy={-50} r={24} fill="#3f8233" />
      <circle cx={0} cy={-66} r={24} fill="#4a9a3c" />
      <circle cx={0} cy={-56} r={26} fill="url(#isl-leaf)" />
      <circle cx={-10} cy={-72} r={10} fill="#8bd36a" opacity={0.75} />
      <circle cx={12} cy={-78} r={8} fill="#a6e38a" opacity={0.65} />
      <circle cx={-24} cy={-40} r={8} fill="#2a5f26" opacity={0.6} />
    </g>
  );
}

function Pine({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} aria-hidden>
      <rect x={-4} y={-18} width={8} height={20} fill="#5b3a12" />
      <polygon points="-30,-14 0,-58 30,-14" fill="#2e6b3a" />
      <polygon points="-24,-38 0,-78 24,-38" fill="#3a8248" />
      <polygon points="-16,-62 0,-96 16,-62" fill="#4a9a58" />
    </g>
  );
}

function Rock({ x, y, fill, scale = 1 }: { x: number; y: number; fill: string; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} aria-hidden>
      <path d="M-30 10 L -20 -14 L 4 -24 L 28 -8 L 32 10 Z" fill={fill} />
      <path d="M-20 -14 L 4 -24 L 10 -4 Z" fill="#ffffff" opacity={0.25} />
    </g>
  );
}

type RoofStyle = "gable" | "hip" | "slate";

/**
 * A timber-and-plaster building: plinth, wall with plank shading, a framed door with a step, windows with crossbars,
 * shutters and a sill, a tiled roof with an overhang, optional chimney and awning, and a sign board hung under the eave.
 */
function Building({ x, y, w = 120, h = 78, wall, trim, roof, roofStyle = "gable", sign, door = "#5a3516", chimney = false, awning, flagColor, windows = 1, scale = 1, children }: { x: number; y: number; w?: number; h?: number; wall: string; trim: string; roof: string; roofStyle?: RoofStyle; sign: string | null; door?: string; chimney?: boolean; awning?: [string, string]; flagColor?: string; windows?: 1 | 2; scale?: number; children?: ReactNode }) {
  const peak = roofStyle === "slate" ? 40 : 52;
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} filter="url(#isl-soft)">
      <ellipse cx={0} cy={8} rx={w * 0.66} ry={13} fill="rgba(43,33,24,0.2)" />
      {/* plinth */}
      <rect x={-w / 2 - 4} y={-6} width={w + 8} height={10} rx={2} fill="#9a8f82" stroke={INK_SOFT} strokeWidth={1.5} />
      <rect x={-w / 2 - 4} y={-6} width={w + 8} height={10} rx={2} fill="url(#isl-stone)" opacity={0.6} />
      {/* half-timber beams on the hip-roofed office; stone base course on the others */}
      {roofStyle === "hip" ? (
        <g stroke={trim} strokeWidth={3} opacity={0.55} strokeLinecap="round">
          <line x1={-w / 2 + 6} y1={-h + 8} x2={-w / 2 + 6} y2={-4} />
          <line x1={w / 2 - 6} y1={-h + 8} x2={w / 2 - 6} y2={-4} />
          <line x1={-w / 2 + 6} y1={-h / 2} x2={-w / 2 + 34} y2={-h + 10} />
          <line x1={w / 2 - 6} y1={-h / 2} x2={w / 2 - 34} y2={-h + 10} />
        </g>
      ) : (
        <rect x={-w / 2} y={-14} width={w} height={10} fill="url(#isl-stone)" opacity={0.5} />
      )}
      {/* wall */}
      <rect x={-w / 2} y={-h} width={w} height={h} fill={wall} stroke={INK_SOFT} strokeWidth={2} />
      {[0.25, 0.5, 0.75].map((t) => (
        <line key={t} x1={-w / 2 + 3} y1={-h + h * t} x2={w / 2 - 3} y2={-h + h * t} stroke={trim} strokeWidth={1.2} opacity={0.35} />
      ))}
      <rect x={-w / 2} y={-h} width={w} height={6} fill="rgba(0,0,0,0.12)" />
      {/* door with frame and step */}
      <rect x={-17} y={-h + 34} width={34} height={h - 34} rx={4} fill={trim} />
      <rect x={-13} y={-h + 38} width={26} height={h - 38} rx={3} fill={door} />
      <rect x={-13} y={-h + 38} width={26} height={h - 38} rx={3} fill="url(#isl-doorShade)" />
      <circle cx={8} cy={-h / 2 + 14} r={2.4} fill="#fde68a" />
      <rect x={-20} y={-2} width={40} height={5} rx={2} fill="#b9ad9d" />
      {/* windows */}
      {(windows === 2 ? [w / 2 - 44, -w / 2 + 20] : [w / 2 - 44]).map((wx, i) => (
        <g key={i}>
          <rect x={wx - 5} y={-h + 14} width={34} height={30} rx={3} fill={trim} />
          <rect x={wx} y={-h + 19} width={24} height={20} fill="#bfe6fb" stroke={trim} strokeWidth={1.5} />
          <line x1={wx + 12} y1={-h + 19} x2={wx + 12} y2={-h + 39} stroke={trim} strokeWidth={1.5} />
          <line x1={wx} y1={-h + 29} x2={wx + 24} y2={-h + 29} stroke={trim} strokeWidth={1.5} />
          <rect x={wx - 12} y={-h + 18} width={7} height={22} rx={1} fill={roof} opacity={0.85} />
          <rect x={wx + 29} y={-h + 18} width={7} height={22} rx={1} fill={roof} opacity={0.85} />
          <rect x={wx - 7} y={-h + 44} width={38} height={4} rx={1} fill={trim} />
          <path d={`M${wx - 2} ${-h + 44} q 4 -8 8 0 q 4 -8 8 0 q 4 -8 8 0`} fill="#e5484d" />
        </g>
      ))}
      {/* awning */}
      {awning ? (
        <g>
          {Array.from({ length: Math.floor((w + 16) / 22) }).map((_, i) => (
            <path key={i} d={`M${-w / 2 - 8 + i * 22} ${-h + 10} h 22 l 4 14 q -15 8 -30 0 z`} fill={i % 2 ? awning[0] : awning[1]} stroke={INK_SOFT} strokeWidth={1} />
          ))}
        </g>
      ) : null}
      {/* roof */}
      {roofStyle === "hip" ? (
        <g>
          <polygon points={`${-w / 2 - 16},${-h} ${-w / 2 + 18},${-h - peak} ${w / 2 - 18},${-h - peak} ${w / 2 + 16},${-h}`} fill={roof} stroke={INK_SOFT} strokeWidth={2} />
          <polygon points={`${-w / 2 - 16},${-h} ${-w / 2 + 18},${-h - peak} ${w / 2 - 18},${-h - peak} ${w / 2 + 16},${-h}`} fill="url(#isl-tiles)" />
          <line x1={-w / 2 + 18} y1={-h - peak} x2={w / 2 - 18} y2={-h - peak} stroke={INK} strokeWidth={3} strokeLinecap="round" />
        </g>
      ) : (
        <g>
          <polygon points={`${-w / 2 - 16},${-h} 0,${-h - peak} ${w / 2 + 16},${-h}`} fill={roof} stroke={INK_SOFT} strokeWidth={2} />
          <polygon points={`${-w / 2 - 16},${-h} 0,${-h - peak} ${w / 2 + 16},${-h}`} fill={roofStyle === "slate" ? "url(#isl-slate)" : "url(#isl-tiles)"} />
        </g>
      )}
      <g opacity={0.3} stroke="#1c1917" strokeWidth={1.2} fill="none">
        {[0.3, 0.55, 0.8].map((t) => (
          <path key={t} d={roofStyle === "hip" ? `M${-w / 2 - 16 + (w / 2 - 2 + 16) * t * 0.5} ${-h - peak * t} L ${w / 2 + 16 - (w / 2 - 2 + 16) * t * 0.5} ${-h - peak * t}` : `M${-w / 2 - 16 + (w / 2 + 16) * t} ${-h - peak * t} L ${w / 2 + 16 - (w / 2 + 16) * t} ${-h - peak * t}`} />
        ))}
      </g>
      <rect x={-w / 2 - 16} y={-h - 3} width={w + 32} height={7} fill={INK} opacity={0.25} />
      {chimney ? (
        <g>
          <rect x={w / 2 - 36} y={-h - peak + 14} width={14} height={24} fill={trim} stroke={INK_SOFT} strokeWidth={1.5} />
          <rect x={w / 2 - 39} y={-h - peak + 10} width={20} height={6} fill={INK} opacity={0.7} />
          <path d={`M${w / 2 - 29} ${-h - peak + 4} q -8 -10 2 -18 q -10 -8 2 -16`} stroke="#ffffff" strokeWidth={3} fill="none" opacity={0.7} strokeLinecap="round" />
        </g>
      ) : null}
      {flagColor ? (
        <g>
          <line x1={w / 2 + 10} y1={-h - 48} x2={w / 2 + 10} y2={-h + 4} stroke={INK} strokeWidth={3} />
          <polygon points={`${w / 2 + 10},${-h - 48} ${w / 2 + 46},${-h - 38} ${w / 2 + 10},${-h - 28}`} fill={flagColor} className="isl-flag" />
        </g>
      ) : null}
      {/* hanging sign board (null = the label is a screen-space chip) */}
      {sign ? <SignBoard x={0} y={-h - peak - 8 - 30} text={sign} hung={false} size={17} /> : null}
      {children}
    </g>
  );
}

/** A painted plate (optional raster layer) at its fixed anchor box; null when the vector drawing applies. */
function Plate({ id, fit = "xMidYMax meet" }: { id: PlateId; fit?: "xMidYMax meet" | "none" }) {
  const p = plateFor(id);
  if (!p) return null;
  return <image href={p.href} x={p.box.x} y={p.box.y} width={p.box.width} height={p.box.height} preserveAspectRatio={fit} data-plate={id} aria-hidden />;
}

/** A character: rounded body with arms and shoes, a face, and a distinct outfit (keeper: bun + glasses + cardigan; planner: hard hat + vest + map; supplier: cap + apron + rope; child: backpack, waving). */
/** Individually placed painted prop; counts and interactivity remain live. */
function Sprite({ id, x, y, width, height }: { id: PlateId; x: number; y: number; width: number; height: number }) {
  const plate = plateFor(id);
  return plate ? <image href={plate.href} x={x} y={y} width={width} height={height} preserveAspectRatio="xMidYMax meet" data-sprite={id} /> : null;
}

function Person({ x, y, kind, speaking = false }: { x: number; y: number; kind: "keeper" | "planner" | "supplier" | "child"; speaking?: boolean }) {
  const skin = kind === "supplier" ? "#e0a97e" : kind === "child" ? "#d9a07a" : "#f1c9a5";
  const clothes = kind === "keeper" ? "#7c3aed" : kind === "planner" ? "#0284c7" : kind === "supplier" ? "#f97316" : "#15803d";
  const trousers = kind === "keeper" ? "#3b2a12" : kind === "planner" ? "#334155" : kind === "supplier" ? "#1e3a8a" : "#1d4ed8";
  return (
    <g transform={`translate(${x} ${y})`} data-part={kind === "child" ? "avatar" : `character-${kind}`} aria-hidden>
      <ellipse cx={0} cy={3} rx={20} ry={6} fill="rgba(43,33,24,0.25)" />
      {/* legs and shoes */}
      <rect x={-10} y={-30} width={8} height={28} rx={3} fill={trousers} />
      <rect x={2} y={-30} width={8} height={28} rx={3} fill={trousers} />
      <ellipse cx={-6} cy={0} rx={7} ry={3.5} fill={INK} />
      <ellipse cx={6} cy={0} rx={7} ry={3.5} fill={INK} />
      {/* body */}
      <path d="M-17 -30 q -2 -32 17 -36 q 19 4 17 36 Z" fill={clothes} stroke={INK} strokeWidth={1.6} />
      {kind === "supplier" ? <path d="M-11 -56 h 22 v 26 h -22 z" fill="#fff7e6" opacity={0.95} /> : null}
      {kind === "planner" ? <path d="M-14 -62 h 28 v 30 h -28 z" fill="#facc15" opacity={0.9} /> : null}
      {kind === "keeper" ? <line x1={0} y1={-64} x2={0} y2={-32} stroke="#5b21b6" strokeWidth={2} /> : null}
      {/* arms */}
      <path d={kind === "child" ? "M14 -56 q 14 -2 18 -26" : "M14 -56 q 14 8 14 26"} stroke={clothes} strokeWidth={7} fill="none" strokeLinecap="round" />
      <path d="M-14 -56 q -14 8 -14 26" stroke={clothes} strokeWidth={7} fill="none" strokeLinecap="round" />
      <circle cx={kind === "child" ? 32 : 28} cy={kind === "child" ? -82 : -30} r={4.5} fill={skin} />
      <circle cx={-28} cy={-30} r={4.5} fill={skin} />
      {/* held props */}
      {kind === "keeper" ? <rect x={20} y={-42} width={22} height={12} rx={2} fill={INK} transform="rotate(-20 31 -36)" /> : null}
      {kind === "planner" ? <rect x={20} y={-44} width={10} height={26} rx={3} fill="#fff7e6" stroke={INK} strokeWidth={1.4} transform="rotate(-18 25 -31)" /> : null}
      {kind === "supplier" ? <circle cx={-30} cy={-24} r={9} fill="none" stroke="#8b5a2b" strokeWidth={4} /> : null}
      {/* head */}
      <circle cx={0} cy={-80} r={15} fill={skin} stroke={INK} strokeWidth={1.6} />
      {kind === "keeper" ? (
        <>
          <path d="M-15 -84 q 15 -20 30 0 v 3 q -15 -8 -30 0 Z" fill="#9ca3af" />
          <circle cx={0} cy={-98} r={7} fill="#9ca3af" />
          <circle cx={-6} cy={-79} r={5} fill="none" stroke={INK} strokeWidth={1.6} />
          <circle cx={6} cy={-79} r={5} fill="none" stroke={INK} strokeWidth={1.6} />
          <line x1={-1} y1={-79} x2={1} y2={-79} stroke={INK} strokeWidth={1.6} />
        </>
      ) : null}
      {kind === "planner" ? (
        <>
          <path d="M-17 -87 q 17 -18 34 0 l 3 5 h -40 Z" fill="#facc15" stroke={INK} strokeWidth={1.6} />
          <rect x={-20} y={-84} width={40} height={4} rx={2} fill="#eab308" />
        </>
      ) : null}
      {kind === "supplier" ? (
        <>
          <path d="M-16 -86 q 16 -16 32 0 v 3 h -34 Z" fill="#dc2626" />
          <rect x={-22} y={-86} width={16} height={5} rx={2} fill="#dc2626" />
          <path d="M-14 -70 q 14 8 28 0" stroke="#3b2a12" strokeWidth={0} fill="none" />
          <path d="M-13 -69 q 0 14 8 10" stroke="#3b2a12" strokeWidth={3} fill="none" strokeLinecap="round" />
          <path d="M13 -69 q 0 14 -8 10" stroke="#3b2a12" strokeWidth={3} fill="none" strokeLinecap="round" />
        </>
      ) : null}
      {kind === "child" ? (
        <>
          <path d="M-17 -84 q 17 -22 34 0 v 4 h -36 Z" fill="#7c4a2a" stroke={INK} strokeWidth={1.6} />
          <path d="M-12 -92 q 6 -8 12 -2 q 6 -8 12 0" stroke="#7c4a2a" strokeWidth={5} fill="none" strokeLinecap="round" />
          <rect x={-24} y={-62} width={12} height={26} rx={4} fill="#dc2626" stroke={INK} strokeWidth={1.4} />
        </>
      ) : null}
      {/* face */}
      <circle cx={-5} cy={-80} r={1.6} fill={INK} />
      <circle cx={5} cy={-80} r={1.6} fill={INK} />
      <path d="M-5 -73 q 5 4 10 0" stroke={INK} strokeWidth={1.5} fill="none" strokeLinecap="round" />
      <circle cx={-9} cy={-75} r={2.5} fill="#f87171" opacity={0.45} />
      <circle cx={9} cy={-75} r={2.5} fill="#f87171" opacity={0.45} />
      {speaking ? <ellipse cx={28} cy={-100} rx={14} ry={9} fill="#ffffff" stroke={INK} strokeWidth={1.5} /> : null}
    </g>
  );
}

/** A wooden crate: 2.5D (lighter top face), three planks, corner nails, a small label. */
function Crate({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  if (plateFor("crate")) return <g transform={`translate(${x} ${y}) scale(${scale})`} aria-hidden><Sprite id="crate" x={-18} y={-34} width={36} height={34} /></g>;
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} aria-hidden>
      <rect x={-14} y={-26} width={28} height={26} fill="#c98f52" stroke="#6b4423" strokeWidth={1.6} />
      <polygon points="-14,-26 -6,-34 22,-34 14,-26" fill="#e0ad73" stroke="#6b4423" strokeWidth={1.6} />
      <polygon points="14,-26 22,-34 22,-8 14,0" fill="#a9733f" stroke="#6b4423" strokeWidth={1.6} />
      <line x1={-14} y1={-17} x2={14} y2={-17} stroke="#6b4423" strokeWidth={1.3} />
      <line x1={-14} y1={-9} x2={14} y2={-9} stroke="#6b4423" strokeWidth={1.3} />
      <rect x={-7} y={-23} width={10} height={5} fill="#fff7e6" opacity={0.9} />
      {[[-11, -23], [11, -23], [-11, -3], [11, -3]].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={1.1} fill="#3b2a12" />
      ))}
    </g>
  );
}

/** A loaded boat in the harbour water: planked hull, gunwale, `crates` boxes on deck, a rope to the quay when `roped`, a reflection. */
function Boat({ x, y, crates, capacity, roped, sail, decorative = false }: { x: number; y: number; crates: number; capacity: number; roped: boolean; sail: boolean; decorative?: boolean }) {
  const cols = Math.max(1, Math.min(capacity, 3));
  if (plateFor("boat-hull")) return <g transform={`translate(${x} ${y})`} data-part={decorative ? "pier-boat" : "harbor-boat"} data-crates={crates} aria-hidden>
    <ellipse cx={0} cy={18} rx={46} ry={6} fill="#0b5e8c" opacity={0.25} />
    {roped ? <path d="M-34 -10 q -16 -26 -24 -64" stroke="#8b5a2b" strokeWidth={3} fill="none" /> : null}
    <Sprite id="boat-hull" x={-50} y={-18} width={100} height={38} />
    {Array.from({ length: crates }).map((_, i) => <Crate key={i} x={-22 + (i % cols) * 20} y={-10 - Math.floor(i / cols) * 16} scale={0.55} />)}
    {sail ? <Sprite id="boat-sail" x={28} y={-76} width={36} height={68} /> : null}
  </g>;
  return (
    <g transform={`translate(${x} ${y})`} data-part="harbor-boat" data-crates={crates} aria-hidden>
      <ellipse cx={0} cy={18} rx={46} ry={6} fill="#0b5e8c" opacity={0.25} />
      {roped ? <path d="M-34 -10 q -16 -26 -24 -64" stroke="#8b5a2b" strokeWidth={3} fill="none" /> : null}
      {Array.from({ length: crates }).map((_, i) => (
        <Crate key={i} x={-22 + (i % cols) * 20} y={-10 - Math.floor(i / cols) * 16} scale={0.55} />
      ))}
      <path d="M-48 -8 h 96 l -16 22 h -64 z" fill="#1d7fb5" stroke="#0c4a6e" strokeWidth={3} />
      <path d="M-44 -1 h 88" stroke="#0c4a6e" strokeWidth={1.5} opacity={0.6} />
      <path d="M-40 6 h 80" stroke="#0c4a6e" strokeWidth={1.5} opacity={0.6} />
      <path d="M-46 -8 h 92" stroke="#fff7e6" strokeWidth={4} />
      <path d="M48 -8 l 12 -6 l -6 10" fill="#1d7fb5" stroke="#0c4a6e" strokeWidth={3} strokeLinejoin="round" />
      {sail ? (
        <>
          <rect x={30} y={-66} width={4} height={58} fill={INK} />
          <polygon points="34,-62 62,-22 34,-22" fill="#fde68a" stroke={INK} strokeWidth={1.6} />
          <polygon points="34,-66 50,-60 34,-54" fill="#dc2626" />
        </>
      ) : null}
    </g>
  );
}

function Pier({ x, y, boat, sections }: { x: number; y: number; boat: boolean; sections: number }) {
  const len = 36 * Math.max(sections, 4);
  if (plateFor("pier-module")) return <g transform={`translate(${x} ${y})`} data-part="pier" data-boat={boat ? "moored" : "none"} data-sections={sections} aria-hidden>
    {Array.from({ length: Math.max(sections, 4) }).map((_, i) => <Sprite key={i} id="pier-module" x={i * 30.6 - 24} y={i * 14 - 22} width={50} height={43} />)}
    <Sprite id="pier-head" x={len * 0.85 - 15} y={len * 0.39 - 20} width={35} height={44} />
    {boat ? <Boat x={len * 0.85 + 60} y={len * 0.39 + 18} crates={0} capacity={6} roped={false} sail decorative /> : null}
  </g>;
  return (
    <g transform={`translate(${x} ${y})`} data-part="pier" data-boat={boat ? "moored" : "none"} data-sections={sections} aria-hidden>
      {Array.from({ length: Math.max(sections, 4) + 1 }).map((_, i) => (
        <rect key={i} x={i * 36 * 0.85 - 4} y={i * 14 + 8} width={8} height={24} rx={2} fill="#5b3a12" />
      ))}
      <path d={`M-10 0 L ${len * 0.85 + 10} ${len * 0.39} L ${len * 0.85 + 10} ${len * 0.39 + 10} L -10 10 Z`} fill="#8b5a2b" />
      <path d={`M-10 0 L ${len * 0.85 + 10} ${len * 0.39} L ${len * 0.85 - 4} ${len * 0.39 - 14} L -24 -14 Z`} fill="#c98f52" />
      {Array.from({ length: Math.max(sections, 4) * 2 }).map((_, i) => {
        const t = (i + 0.5) / (Math.max(sections, 4) * 2);
        return <line key={i} x1={-10 + t * (len * 0.85 + 20)} y1={t * len * 0.39} x2={-24 + t * (len * 0.85 + 20)} y2={-14 + t * len * 0.39} stroke="#7c4a2a" strokeWidth={1.4} opacity={0.7} />;
      })}
      {boat ? (
        <g transform={`translate(${len * 0.85 + 50} ${len * 0.39 + 18})`}>
          <ellipse cx={0} cy={22} rx={50} ry={6} fill="#0b5e8c" opacity={0.25} />
          <path d="M-46 -4 h 88 l -16 22 h -56 z" fill="#1d7fb5" stroke="#0c4a6e" strokeWidth={3} />
          <path d="M-42 4 h 80" stroke="#0c4a6e" strokeWidth={1.5} opacity={0.6} />
          <path d="M-40 -4 h 76" stroke="#fff7e6" strokeWidth={4} />
          <rect x={-2} y={-62} width={4} height={58} fill={INK} />
          <polygon points="2,-60 44,-18 2,-18" fill="#fde68a" stroke={INK} strokeWidth={2} />
          <polygon points="-2,-54 -30,-22 -2,-22" fill="#fff7e6" stroke={INK} strokeWidth={2} />
        </g>
      ) : null}
    </g>
  );
}

function Station({ x, y, lamp, theme }: { x: number; y: number; lamp: boolean; theme: string | null }) {
  const plate = plateFor("station");
  if (plate) {
    // B3: the painted observatory (lantern UNLIT in the plate); the saved lamp state stays a live additive overlay drawn at the painted
    // lantern, the saved theme marker stays vector beside the building, the contact shadow is drawn by the app.
    const b = plate.box;
    const lx = b.x + b.width * B3_ANCHORS.stationLantern[0];
    const ly = b.y + b.height * B3_ANCHORS.stationLantern[1];
    return (
      <g transform={`translate(${x} ${y})`} data-part="station" data-lamp={lamp ? "on" : "off"} data-theme={theme ?? "none"} data-painted="true" aria-hidden>
        <ellipse cx={b.x + b.width / 2} cy={8} rx={b.width * 0.5} ry={13} fill="rgba(43,33,24,0.2)" />
        <Plate id="station" />
        {lamp ? (
          <g data-part="station-lamp">
            <polygon points={`${lx},${ly} ${lx - 120},100 ${lx + 120},100`} fill="url(#isl-lampCone)" opacity={0.7} />
            <circle cx={lx} cy={ly} r={34} fill="url(#isl-lampGlow)" />
          </g>
        ) : null}
        {theme === "turtles" ? <g data-part="station-theme"><Sprite id="marker-turtle" x={b.x - 38} y={-26} width={38} height={26} /></g> : null}
        {theme === "waves" ? <g data-part="station-theme"><Sprite id="marker-waves" x={b.x - 38} y={-34} width={32} height={34} /></g> : null}
      </g>
    );
  }
  return (
    <g transform={`translate(${x} ${y})`} data-part="station" data-lamp={lamp ? "on" : "off"} data-theme={theme ?? "none"} aria-hidden>
      {lamp ? (
        <>
          <polygon points="0,-118 -140,100 140,100" fill="url(#isl-lampCone)" opacity={0.7} />
          <circle cx={0} cy={-118} r={40} fill="url(#isl-lampGlow)" />
        </>
      ) : null}
      <ellipse cx={0} cy={8} rx={50} ry={13} fill="rgba(43,33,24,0.2)" />
      <rect x={-38} y={-6} width={76} height={10} rx={2} fill="#9a8f82" />
      <rect x={-34} y={-44} width={68} height={40} fill="#d5dde6" stroke="#4b5a6b" strokeWidth={2} />
      <rect x={-16} y={-112} width={32} height={70} fill="#e9eef3" stroke="#4b5a6b" strokeWidth={2} />
      <rect x={-10} y={-98} width={20} height={14} fill="#bfe6fb" stroke="#4b5a6b" strokeWidth={1.5} />
      <rect x={-26} y={-36} width={14} height={14} fill="#bfe6fb" stroke="#4b5a6b" strokeWidth={1.5} />
      <rect x={12} y={-36} width={14} height={14} fill="#bfe6fb" stroke="#4b5a6b" strokeWidth={1.5} />
      <polygon points="-20,-112 0,-126 20,-112" fill="#4b5a6b" />
      <circle cx={0} cy={-128} r={11} fill={lamp ? "#fde68a" : "#94a3b8"} stroke={lamp ? "#f59e0b" : "#4b5a6b"} strokeWidth={3} />
      {theme === "turtles" ? (
        <g transform="translate(62 -2)">
          <ellipse cx={0} cy={0} rx={17} ry={11} fill="#2f6f4e" />
          <ellipse cx={0} cy={-2} rx={11} ry={7} fill="#4f9a6f" />
          <circle cx={18} cy={-1} r={4.5} fill="#2f6f4e" />
          <circle cx={19} cy={-2} r={1} fill={INK} />
        </g>
      ) : null}
      {theme === "waves" ? (
        <g transform="translate(58 -10)">
          <rect x={-3} y={-30} width={6} height={36} fill="#4b5a6b" />
          <path d="M-20 10 q 10 -10 20 0 t 20 0" stroke="#0ea5e9" strokeWidth={4} fill="none" strokeLinecap="round" />
        </g>
      ) : null}
    </g>
  );
}

function Bed({ x, y, filled, dark = false, scale = 1 }: { x: number; y: number; filled: number; dark?: boolean; scale?: number }) {
  const n = Math.max(0, Math.min(filled, 8));
  if (plateFor("garden-bed")) return <g transform={`translate(${x} ${y}) scale(${scale})`} data-bed-filled={filled} aria-hidden>
    <Sprite id={dark ? "station-bed" : "garden-bed"} x={-29} y={-20} width={58} height={33} />
    {Array.from({ length: n }).map((_, i) => <Sprite key={i} id="seedling" x={-24 + (i % 4) * 12} y={-20 + Math.floor(i / 4) * 8} width={10} height={14} />)}
  </g>;
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} data-bed-filled={filled} aria-hidden>
      <rect x={-28} y={-4} width={56} height={16} rx={4} fill={dark ? "#6e4529" : "#8b5a2b"} stroke="#5a371c" strokeWidth={1.5} />
      <rect x={-26} y={-6} width={52} height={6} rx={3} fill={dark ? "#86593a" : "#a9733f"} />
      {Array.from({ length: n }).map((_, i) => (
        <path key={i} d={`M${-21 + i * 6} -6 c 0 -5 1 -8 1 -11 m -1 6 c -4 -1 -6 -4 -5 -7 c 3 1 5 3 5 7`} stroke="#2f7d32" strokeWidth={1.7} fill="none" strokeLinecap="round" />
      ))}
    </g>
  );
}

function Tent({ x, y }: { x: number; y: number }) {
  if (plateFor("tent")) {
    // B3: the painted tent on the base node (box centred on the ground point); contact shadow by the app
    return (
      <g data-part="base" data-base="tent" data-painted="true" aria-hidden>
        <ellipse cx={x} cy={y + 8} rx={PLATE_BOXES.tent.width * 0.48} ry={13} fill="rgba(43,33,24,0.2)" />
        <Plate id="tent" />
      </g>
    );
  }
  return (
    <g transform={`translate(${x} ${y})`} data-part="base" data-base="tent" aria-hidden>
      <ellipse cx={0} cy={8} rx={74} ry={13} fill="rgba(43,33,24,0.2)" />
      <polygon points="-72,0 0,-82 72,0" fill="#e9a640" stroke={INK_SOFT} strokeWidth={2} />
      <polygon points="-72,0 0,-82 -40,0" fill="#d1912f" />
      <polygon points="-16,0 0,-82 16,0" fill="#5b3a12" />
      <line x1={0} y1={-82} x2={0} y2={-96} stroke={INK} strokeWidth={3} />
      <polygon points="0,-96 22,-90 0,-84" fill="#dc2626" />
    </g>
  );
}

function Hut({ x, y, name, garden }: { x: number; y: number; name: string | null; garden: boolean }) {
  if (plateFor("hut")) {
    // B3: the painted hut, DOOR-anchored on the base node; the base's saved NAME stays a live sign on the post beside it
    // (the plate carries no text), the garden variant keeps its data attribute (the beds are drawn separately).
    const b = PLATE_BOXES.hut;
    return (
      <g data-part="base" data-base={garden ? "hut-garden" : "hut"} data-painted="true">
        <ellipse cx={b.x + b.width / 2} cy={y + 8} rx={b.width * 0.5} ry={13} fill="rgba(43,33,24,0.2)" />
        <Plate id="hut" />
        <g transform={`translate(${b.x - 24} ${y})`} aria-hidden>
          <line x1={0} y1={4} x2={0} y2={-44} stroke="#5b3a12" strokeWidth={5} strokeLinecap="round" />
          <SignBoard x={0} y={-72} text={name ? (name.length > 16 ? `${name.slice(0, 15)}…` : name) : "Basis"} size={14} />
        </g>
      </g>
    );
  }
  return (
    <g data-part="base" data-base={garden ? "hut-garden" : "hut"}>
      <Building x={x} y={y} w={130} h={80} wall="#e6d2b3" trim="#8b5a2b" roof="#b4533a" roofStyle="gable" chimney sign={name ? (name.length > 16 ? `${name.slice(0, 15)}…` : name) : "Basis"} />
      <g transform={`translate(${x - 96} ${y})`} aria-hidden>
        <line x1={0} y1={4} x2={0} y2={-44} stroke="#5b3a12" strokeWidth={5} strokeLinecap="round" />
        <SignBoard x={0} y={-72} text="Basis" size={14} />
      </g>
    </g>
  );
}

function Store({ x, y, kinds, onOpen }: { x: number; y: number; kinds: number; onOpen?: () => void }) {
  const body = (
    <g transform={`translate(${x} ${y})`} data-part="supplies" data-supply-kinds={kinds}>
      <ellipse cx={0} cy={6} rx={40} ry={9} fill="rgba(43,33,24,0.18)" />
      <Sprite id="supply-store" x={-28} y={-65} width={56} height={65} />
      <SignBoard x={0} y={10} text={`Vorräte · ${kinds}`} size={14} tone="paper" />
    </g>
  );
  if (!onOpen) return body;
  return (
    <g role="button" tabIndex={0} aria-label={`Vorräte ansehen, ${kinds} Arten`} className="cursor-pointer outline-none" onClick={onOpen} onKeyDown={(e) => (e.key === "Enter" || e.key === " " ? (e.preventDefault(), onOpen()) : undefined)} data-testid="world-supplies">
      {body}
    </g>
  );
}

function Logbook({ x, y, pages, onOpen }: { x: number; y: number; pages: number; onOpen?: () => void }) {
  const inner = (
    <g transform={`translate(${x} ${y})`} data-part="logbook" data-pages={pages}>
      <ellipse cx={0} cy={2} rx={30} ry={7} fill="rgba(43,33,24,0.18)" />
      <Sprite id="logbook-stand" x={-25} y={-64} width={50} height={64} />
      <circle cx={22} cy={-44} r={13} fill={INK} />
      <text x={22} y={-39} textAnchor="middle" fontSize={14} fontWeight={700} fill="#fff" fontFamily={FONT}>
        {pages}
      </text>
      <SignBoard x={0} y={6} text="Logbuch" size={14} tone="paper" />
    </g>
  );
  if (!onOpen) return inner;
  return (
    <g role="button" tabIndex={0} aria-label={`Logbuch öffnen, ${pages} ${pages === 1 ? "Seite" : "Seiten"}`} className="cursor-pointer outline-none" onClick={onOpen} onKeyDown={(e) => (e.key === "Enter" || e.key === " " ? (e.preventDefault(), onOpen()) : undefined)} data-testid="world-logbook">
      {inner}
    </g>
  );
}

function Wordbook({ x, y, onOpen }: { x: number; y: number; onOpen?: () => void }) {
  const inner = (
    <g transform={`translate(${x} ${y})`} data-part="wordbook">
      <ellipse cx={0} cy={2} rx={28} ry={7} fill="rgba(43,33,24,0.18)" />
      <Sprite id="wordbook-stand" x={-24} y={-64} width={48} height={64} />
      <SignBoard x={0} y={6} text="Wörterbuch" size={14} tone="paper" />
    </g>
  );
  if (!onOpen) return inner;
  return (
    <g role="button" tabIndex={0} aria-label="Wörterbuch öffnen" className="cursor-pointer outline-none" onClick={onOpen} onKeyDown={(e) => (e.key === "Enter" || e.key === " " ? (e.preventDefault(), onOpen()) : undefined)} data-testid="world-wordbook">
      {inner}
    </g>
  );
}

function Flag({ x, y, marker, onSelect }: { x: number; y: number; marker: WorldMarker; onSelect?: (m: WorldMarker) => void }) {
  const labels = useContext(LabelsCtx);
  const active = marker.state === "next" || marker.state === "running";
  // the "where next" callout is the map's one next-signal; on the walkable hub the headline and the arrival card carry that, so it is folded away there
  const callout = active && (labels.all || !labels.hub);
  const done = marker.state === "done";
  const poleColor = done || active ? INK : "#a8a29e";
  const flagColor = done ? "#16a34a" : active ? "#f59e0b" : "#d6d3d1";
  const caption = marker.progress && marker.state === "running" ? `${marker.caption} · ${marker.progress.done}/${marker.progress.count}` : marker.caption;
  const body = (
    <g transform={`translate(${x} ${y})`} data-part="site" data-visit={marker.visit} data-state={marker.state}>
      {callout ? (
        <>
          <ellipse cx={0} cy={6} rx={54} ry={22} fill="none" stroke="#f59e0b" strokeWidth={5} className="isl-pulse" opacity={0.9} />
          <ellipse cx={0} cy={6} rx={68} ry={30} fill="rgba(245,158,11,0.16)" />
          <g data-part="next-callout">
            <rect x={-96} y={-140} width={192} height={34} rx={17} fill={INK} />
            <text x={0} y={-116} textAnchor="middle" fontSize={17} fontWeight={700} fill="#fff" fontFamily={FONT}>
              {marker.state === "running" ? "Hier geht's weiter" : "Nächstes Ziel"}
            </text>
            <polygon points="-8,-106 8,-106 0,-94" fill={INK} />
          </g>
        </>
      ) : null}
      <rect x={-30} y={-88} width={86} height={104} fill="transparent" data-part="site-hit" />
      <ellipse cx={0} cy={8} rx={14} ry={6} fill="rgba(43,33,24,0.25)" />
      <line x1={0} y1={6} x2={0} y2={-78} stroke={poleColor} strokeWidth={4} strokeLinecap="round" />
      <polygon points="0,-78 48,-64 0,-50" fill={flagColor} stroke={INK_SOFT} className={active ? "isl-flag" : undefined} />
      {done ? <path d="M12 -68 l 6 6 l 13 -13" stroke="#fff" strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
      {labels.all ? (
        <>
          <rect x={-58} y={12} width={116} height={26} rx={13} fill={active ? INK : "rgba(255,255,255,0.94)"} stroke={INK_SOFT} />
          <text x={0} y={30} textAnchor="middle" fontSize={14} fontWeight={700} fill={active ? "#fff" : INK} fontFamily={FONT}>
            {caption}
          </text>
        </>
      ) : null}
    </g>
  );
  if (!onSelect || marker.state === "later") return body;
  return (
    <g role="button" tabIndex={0} aria-label={`${marker.label}${done ? " — Bericht öffnen" : active ? " — hier geht es weiter" : ""}`} className="cursor-pointer outline-none" onClick={() => onSelect(marker)} onKeyDown={(e) => (e.key === "Enter" || e.key === " " ? (e.preventDefault(), onSelect(marker)) : undefined)} data-testid={`world-site-${marker.visit}`}>
      {body}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Avatar movement
// ---------------------------------------------------------------------------

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Shortest path over the walking graph (BFS). */
function pathBetween(from: IslandPlace, to: IslandPlace): IslandPlace[] {
  if (from === to) return [from];
  const adj = new Map<IslandPlace, IslandPlace[]>();
  for (const [a, b] of EDGES) {
    adj.set(a, [...(adj.get(a) ?? []), b]);
    adj.set(b, [...(adj.get(b) ?? []), a]);
  }
  const prev = new Map<IslandPlace, IslandPlace | null>([[from, null]]);
  const queue: IslandPlace[] = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === to) break;
    for (const n of adj.get(cur) ?? []) {
      if (prev.has(n)) continue;
      prev.set(n, cur);
      queue.push(n);
    }
  }
  if (!prev.has(to)) return [from, to];
  const out: IslandPlace[] = [];
  let cur: IslandPlace | null = to;
  while (cur) {
    out.unshift(cur);
    cur = prev.get(cur) ?? null;
  }
  return out;
}

/** The neighbour in the pressed direction (largest component along the axis), or null. */
function neighbourInDirection(from: IslandPlace, dir: "left" | "right" | "up" | "down", allowed: Set<IslandPlace>): IslandPlace | null {
  const [fx, fy] = POS[from];
  let best: { id: IslandPlace; score: number } | null = null;
  for (const [a, b] of EDGES) {
    const other = a === from ? b : b === from ? a : null;
    if (!other || !allowed.has(other)) continue;
    const [ox, oy] = POS[other];
    const dx = ox - fx;
    const dy = oy - fy;
    const score = dir === "left" ? -dx - Math.abs(dy) * 0.5 : dir === "right" ? dx - Math.abs(dy) * 0.5 : dir === "up" ? -dy - Math.abs(dx) * 0.5 : dy - Math.abs(dx) * 0.5;
    const along = dir === "left" ? -dx : dir === "right" ? dx : dir === "up" ? -dy : dy;
    if (along <= 20) continue;
    if (!best || score > best.score) best = { id: other, score };
  }
  return best?.id ?? null;
}

const STEP_MS = 520;

export function HarborIsland({ scene, markers, pages, harbor = null, variant = "full", destinations, avatarAt = null, onArrive, onSelectMarker, onOpenLogbook, onOpenSupplies, onOpenWordbook, description, className, children, arriveHint = null, labels = "focused", labelsToggle = variant !== "strip" }: HarborIslandProps) {
  const [allLabels, setAllLabels] = useState(labels === "all");
  useEffect(() => setAllLabels(labels === "all"), [labels]);
  // screen-space mapping of the stage (viewBox → container px) for the label chips: computed from the actual box, so the chips keep a
  // fixed CSS font size instead of scaling with the 1600-unit stage (readable at 820 px)
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState<{ scale: number; ox: number; oy: number } | null>(null);
  // Portrait map (correction ID03/22, 2026-10-11): the full map used to cover its viewport (slice), which on a portrait tablet
  // cropped the office and three completed flags out of reach. In portrait the map now CONTAINS the whole island (meet) with
  // sky above and sea below, so every destination, label and flag stays visible, tappable and keyboard-reachable; landscape keeps
  // the cover framing.
  const [portrait, setPortrait] = useState(false);
  const contain = variant === "stage" || (variant === "full" && portrait);
  const text = description ?? describeIsland(scene, markers, pages, harbor);
  // The full map keeps a band of sky above the island (the island reads as a place, not a cut-out); the stage variant keeps the whole picture.
  const viewBox = variant === "strip" ? "0 260 1600 625" : variant === "full" ? "0 120 1600 780" : "0 0 1600 900";
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const [vx, vy, vw, vh] = viewBox.split(" ").map(Number);
    const compute = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      const isPortrait = variant === "full" && w < h;
      setPortrait(isPortrait);
      const s = variant === "stage" || isPortrait ? Math.min(w / vw, h / vh) : Math.max(w / vw, h / vh);
      setFit({ scale: s, ox: (w - vw * s) / 2 - vx * s, oy: (h - vh * s) / 2 - vy * s });
    };
    compute();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewBox, variant]);
  const garden = scene.beds.filter((b) => b.id.startsWith("garden"));
  const stationBeds = scene.beds.filter((b) => b.id.startsWith("station"));
  const stationPos = STATION_POS[scene.station.spot ?? "rocks"] ?? POS.station;
  const kinds = islandSupplyRows(scene).length;
  const hasBase = Boolean(scene.name);
  const byVisit = (id: string) => markers.find((m) => m.visit === id) ?? null;
  const wp = (id: HarborWorkplaceView["id"]) => harbor?.workplaces.find((w) => w.id === id) ?? null;
  const walkable = useMemo(() => new Set<IslandPlace>((destinations ?? []).map((d) => d.id)), [destinations]);

  // --- avatar: position (interpolated along the path), target, arrival
  const start: IslandPlace = avatarAt ?? "harbor";
  const [at, setAt] = useState<IslandPlace>(start);
  const [walk, setWalk] = useState<{ path: IslandPlace[]; index: number; t: number } | null>(null);
  const targetRef = useRef<IslandDestination | null>(null);
  const rafRef = useRef<number | null>(null);
  const arriveRef = useRef(onArrive);
  arriveRef.current = onArrive;
  useEffect(() => {
    setAt(start);
    setWalk(null);
    targetRef.current = null;
  }, [start]);
  useEffect(() => () => (rafRef.current !== null ? cancelAnimationFrame(rafRef.current) : undefined), []);

  const goTo = useCallback(
    (dest: IslandDestination) => {
      if (!dest.enabled) return;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      const path = pathBetween(at, dest.id);
      if (path.length <= 1 || prefersReducedMotion()) {
        setAt(dest.id);
        setWalk(null);
        arriveRef.current?.(dest);
        return;
      }
      targetRef.current = dest;
      let index = 0;
      let startedAt: number | null = null;
      const tick = (now: number) => {
        if (startedAt === null) startedAt = now;
        const t = Math.min(1, (now - startedAt) / STEP_MS);
        setWalk({ path, index, t });
        if (t >= 1) {
          index += 1;
          startedAt = null;
          if (index >= path.length - 1) {
            setAt(dest.id);
            setWalk(null);
            rafRef.current = null;
            if (targetRef.current === dest) arriveRef.current?.(dest);
            return;
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [at],
  );

  const onKey = (e: ReactKeyboardEvent<SVGSVGElement>) => {
    if (!destinations) return;
    const dir = e.key === "ArrowLeft" ? "left" : e.key === "ArrowRight" ? "right" : e.key === "ArrowUp" ? "up" : e.key === "ArrowDown" ? "down" : null;
    if (dir) {
      e.preventDefault();
      const next = neighbourInDirection(at, dir, walkable);
      const dest = next ? destinations.find((d) => d.id === next) ?? null : null;
      if (dest) goTo({ ...dest, enabled: true });
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      const here = destinations.find((d) => d.id === at);
      if (here && here.enabled) {
        e.preventDefault();
        arriveRef.current?.(here);
      }
    }
  };

  const avatarPos: P = (() => {
    if (!walk) return POS[at];
    const [ax, ay] = POS[walk.path[walk.index]];
    const [bx, by] = POS[walk.path[Math.min(walk.index + 1, walk.path.length - 1)]];
    return [ax + (bx - ax) * walk.t, ay + (by - ay) * walk.t];
  })();
  const facingLeft = walk ? POS[walk.path[Math.min(walk.index + 1, walk.path.length - 1)]][0] < POS[walk.path[walk.index]][0] : false;

  const m1 = byVisit("v1");
  const m2 = byVisit("v2");
  const m4 = byVisit("v4");
  const m5 = byVisit("v5");
  const m6 = byVisit("v6");
  const dest = (id: IslandPlace) => destinations?.find((d) => d.id === id) ?? null;
  // Label chips (screen space): the three workplaces always, the selected arrival when it is another place. Anchored just above
  // each roof; the workshop chip follows the painted plate's box when the plate is mounted (the plate is door-anchored, so its
  // box centre is right of the ground point).
  const backdropPlate = plateFor("backdrop");
  const workshopPlate = plateFor("workshop");
  const officePlate = plateFor("office");
  const shopPlate = plateFor("shop");
  // B3: painted base (tent / hut), kiosk and station — their boxes drive the chips and the hit targets like the three workplaces
  const harbormasterPlate = plateFor("harbormaster");
  const baseBox = !hasBase ? null : scene.base === "tent" ? (plateFor("tent") ? PLATE_BOXES.tent : null) : plateFor("hut") ? PLATE_BOXES.hut : null;
  const stationBox = scene.station.built && plateFor("station") ? PLATE_BOXES.station : null;
  const workshopChipX = workshopPlate ? PLATE_BOXES.workshop.x + PLATE_BOXES.workshop.width / 2 : POS.workshop[0];
  const workshopChipY = workshopPlate ? PLATE_BOXES.workshop.y - 8 : POS.workshop[1] - 84 - 40 - 12;
  const officeChipX = officePlate ? PLATE_BOXES.office.x + PLATE_BOXES.office.width / 2 + 24 : POS.office[0] + 24;
  // with the painted office its chip would share the workshop chip's row; it hangs on the office roof ridge instead (one row lower, never overlapping the workshop chip)
  const officeChipY = officePlate ? PLATE_BOXES.office.y + 34 : POS.office[1] - 86 - 52 - 8;
  const shopChipX = shopPlate ? PLATE_BOXES.shop.x + PLATE_BOXES.shop.width / 2 : POS.shop[0];
  const shopChipY = shopPlate ? PLATE_BOXES.shop.y - 8 : POS.shop[1] - 68 - 52 - 8;
  const CHIP_ANCHOR: Record<IslandPlace, P> = {
    workshop: [workshopChipX, workshopChipY],
    office: [officeChipX, officeChipY],
    harbormaster: [POS.harbormaster[0], harbormasterPlate ? PLATE_BOXES.harbormaster.y - 8 : POS.harbormaster[1] - 118 - 8],
    shop: [shopChipX, shopChipY],
    base: baseBox ? [baseBox.x + baseBox.width / 2, baseBox.y - 8] : [POS.base[0], POS.base[1] - 80 - 52 - 8],
    garden: [POS.garden[0], POS.garden[1] - 44],
    station: stationBox ? [stationPos[0] + stationBox.x + stationBox.width / 2, stationPos[1] + stationBox.y - 8] : [stationPos[0], stationPos[1] - 140],
    pier: [POS.pier[0], POS.pier[1] - 70],
    harbor: [POS.harbor[0], POS.harbor[1] - 44],
    logbook: [POS.logbook[0], POS.logbook[1] - 60],
    supplies: [POS.supplies[0], POS.supplies[1] - 50],
    wordbook: [POS.wordbook[0], POS.wordbook[1] - 56],
  };
  const chips: { id: IslandPlace; text: string; status: WorkplaceStatus | null; primary: boolean }[] = [
    { id: "workshop", text: "Tipp-Werkstatt", status: wp("typing")?.status ?? null, primary: true },
    { id: "office", text: "Planungsbüro", status: wp("planning")?.status ?? null, primary: true },
    { id: "harbormaster", text: "Hafenmeister", status: wp("closing")?.status ?? null, primary: true },
  ];
  if (destinations && !walk && !chips.some((c) => c.id === at)) chips.push({ id: at, text: destinations.find((d) => d.id === at)?.label ?? PLACE_NAME[at], status: null, primary: false });
  const hotspot = (id: IslandPlace, label: string, w: number, h: number, dx = 0, dy = 0) => {
    const d = dest(id);
    if (!d) return null;
    const [x, y] = POS[id];
    return (
      <g key={`hs-${id}`} role="button" tabIndex={-1} aria-label={`${label}${d.enabled ? " — hingehen" : " (noch zu)"}`} className={d.enabled ? "cursor-pointer outline-none" : "cursor-default outline-none"} onClick={() => d.enabled && goTo(d)} data-testid={`island-go-${id}`} data-enabled={d.enabled ? "true" : "false"}>
        <rect x={x - w / 2 + dx} y={y - h + dy} width={w} height={h + 20} fill="transparent" />
      </g>
    );
  };

  return (
    <div ref={rootRef} className={cn("relative h-full w-full overflow-hidden", className)} style={variant === "full" ? { background: "linear-gradient(180deg, #7cc4ec 0%, #c6e5f7 38%, #2f8bc9 62%, #0f4c81 100%)" } : undefined} data-island-variant={variant} data-island-framing={contain ? "contain" : "cover"} data-island-labels={allLabels ? "all" : "focused"} data-world-variant={variant} data-world-base={scene.base} data-world-station={scene.station.built ? "built" : "none"} data-world-lamp={scene.station.lamp ? "on" : "off"} data-world-beds={scene.beds.length} data-world-pages={pages} data-world-pier={scene.pier.built ? "built" : scene.pier.sections ? "planks" : "none"} data-world-boat={scene.pier.boat ? "moored" : "none"} data-world-harbor={scene.harbor.planned ? "planned" : scene.harbor.fullBoats ? "loaded" : "crates"} data-avatar-at={at}>
      <LabelsCtx.Provider value={{ all: allLabels, hub: Boolean(destinations) }}>
      <svg viewBox={viewBox} preserveAspectRatio={contain ? "xMidYMid meet" : "xMidYMid slice"} className="absolute inset-0 h-full w-full select-none outline-none" role={destinations ? "application" : "img"} aria-label={text} tabIndex={destinations ? 0 : undefined} onKeyDown={onKey} focusable={destinations ? "true" : "false"} data-testid="island-svg">
        <defs>
          <linearGradient id="isl-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#7cc4ec" />
            <stop offset="0.45" stopColor="#c6e5f7" />
            <stop offset="1" stopColor="#fbeecf" />
          </linearGradient>
          <radialGradient id="isl-sunHalo">
            <stop offset="0" stopColor="#fff4c4" stopOpacity={0.9} />
            <stop offset="1" stopColor="#fff4c4" stopOpacity={0} />
          </radialGradient>
          <linearGradient id="isl-sea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5fb2de" />
            <stop offset="0.35" stopColor="#2f8fc2" />
            <stop offset="1" stopColor="#0d5a86" />
          </linearGradient>
          <radialGradient id="isl-bay" cx="0.5" cy="0.4">
            <stop offset="0" stopColor="#9fe0f7" />
            <stop offset="1" stopColor="#4fb6e6" />
          </radialGradient>
          {/* painterly texture layer (art direction 2026-10-10): tiles, slate, quay stone, planks, grass, a soft shadow and a sunlight wash */}
          <pattern id="isl-tiles" width="22" height="12" patternUnits="userSpaceOnUse">
            <path d="M0 12 a 11 11 0 0 1 22 0" fill="none" stroke="#000" strokeOpacity={0.22} strokeWidth={1.6} />
            <path d="M-11 6 a 11 11 0 0 1 22 0 M11 6 a 11 11 0 0 1 22 0" fill="none" stroke="#fff" strokeOpacity={0.14} strokeWidth={1.2} />
          </pattern>
          <pattern id="isl-slate" width="18" height="10" patternUnits="userSpaceOnUse">
            <rect x="0" y="0" width="9" height="5" fill="#000" fillOpacity={0.14} />
            <rect x="9" y="5" width="9" height="5" fill="#000" fillOpacity={0.14} />
            <rect x="0" y="5" width="9" height="5" fill="#fff" fillOpacity={0.06} />
          </pattern>
          <pattern id="isl-stone" width="40" height="22" patternUnits="userSpaceOnUse">
            <rect x="1" y="1" width="18" height="9" rx="2" fill="#cbd2da" stroke="#7b8590" strokeWidth={1} />
            <rect x="21" y="1" width="18" height="9" rx="2" fill="#b9c1ca" stroke="#7b8590" strokeWidth={1} />
            <rect x="-9" y="12" width="18" height="9" rx="2" fill="#bfc7cf" stroke="#7b8590" strokeWidth={1} />
            <rect x="11" y="12" width="18" height="9" rx="2" fill="#c7ced6" stroke="#7b8590" strokeWidth={1} />
            <rect x="31" y="12" width="18" height="9" rx="2" fill="#b5bdc6" stroke="#7b8590" strokeWidth={1} />
          </pattern>
          <pattern id="isl-planks" width="14" height="60" patternUnits="userSpaceOnUse">
            <rect x="0" y="0" width="14" height="60" fill="#c98f52" />
            <line x1="13" y1="0" x2="13" y2="60" stroke="#7c4a2a" strokeWidth={1.2} />
            <line x1="4" y1="8" x2="6" y2="30" stroke="#a8713a" strokeWidth={1} opacity={0.6} />
          </pattern>
          <pattern id="isl-grass" width="26" height="18" patternUnits="userSpaceOnUse">
            <path d="M3 14 q 2 -6 4 0 M12 9 q 2 -6 4 0 M20 15 q 2 -6 4 0" stroke="#4f8a2e" strokeOpacity={0.35} strokeWidth={1.4} fill="none" strokeLinecap="round" />
          </pattern>
          <radialGradient id="isl-sunlight" cx="0.62" cy="0.3" r="0.7">
            <stop offset="0" stopColor="#fff7c2" stopOpacity={0.35} />
            <stop offset="1" stopColor="#fff7c2" stopOpacity={0} />
          </radialGradient>
          <radialGradient id="isl-leaf">
            <stop offset="0" stopColor="#8bd36a" />
            <stop offset="0.7" stopColor="#4f9a3b" />
            <stop offset="1" stopColor="#2f6e2a" />
          </radialGradient>
          <filter id="isl-soft" x="-20%" y="-20%" width="140%" height="160%">
            <feDropShadow dx="0" dy="4" stdDeviation="3" floodColor="#2b2118" floodOpacity="0.28" />
          </filter>
          <linearGradient id="isl-doorShade" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#000000" stopOpacity={0.18} />
            <stop offset="1" stopColor="#000000" stopOpacity={0} />
          </linearGradient>
          <radialGradient id="isl-lampGlow">
            <stop offset="0" stopColor="#fde68a" stopOpacity={0.95} />
            <stop offset="1" stopColor="#fde68a" stopOpacity={0} />
          </radialGradient>
          <linearGradient id="isl-lampCone" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fde68a" stopOpacity={0.55} />
            <stop offset="1" stopColor="#fde68a" stopOpacity={0} />
          </linearGradient>
          <style>{`
            .isl-pulse { transform-box: fill-box; transform-origin: center; animation: isl-pulse 2.4s ease-in-out infinite; }
            .isl-flag { transform-box: fill-box; transform-origin: left center; animation: isl-flag 3s ease-in-out infinite; }
            .isl-wave { animation: isl-wave 5s ease-in-out infinite; }
            @keyframes isl-pulse { 0%, 100% { transform: scale(1); opacity: 0.9; } 50% { transform: scale(1.12); opacity: 0.5; } }
            @keyframes isl-flag { 0%, 100% { transform: skewY(0deg); } 50% { transform: skewY(-4deg); } }
            @keyframes isl-wave { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(14px); } }
            @media (prefers-reduced-motion: reduce) { .isl-pulse, .isl-flag, .isl-wave { animation: none; } }
          `}</style>
        </defs>
        <Sky />
        <Horizon destination={scene.harbor.planned ? scene.harbor.destination : null} />
        <Land location={scene.location} />
        {/* painted plates, when present: the backdrop covers sky/sea/land; far destinations keep their live lighting via the vector layer beneath */}
        {/* B3: the painting's own sky and sea continue above and below it (stretched gradient plates derived from its edge rows, drawn
            UNDER the backdrop with a 4-unit overlap so the join has no half-covered row) — the portrait "contain" framing shows no flat
            band and no horizontal join; in the landscape "cover" framing they are off-screen */}
        {backdropPlate ? <Plate id="sky" fit="none" /> : null}
        {backdropPlate ? <Plate id="sea" fit="none" /> : null}
        <Plate id="backdrop" />
        {backdropPlate ? <FarDestinations destination={scene.harbor.planned ? scene.harbor.destination : null} dy={PAINTED_HORIZON_Y - 352} /> : null}
        {backdropPlate ? <LocationOverlay location={scene.location} /> : null}

        {/* --- the base, garden, station (saved from visits 1–3) --- */}
        {!hasBase ? <ellipse cx={POS.base[0]} cy={POS.base[1]} rx={70} ry={20} fill="rgba(255,247,230,0.55)" stroke="#8b5a2b" strokeWidth={2} strokeDasharray="8 8" /> : scene.base === "tent" ? <Tent x={POS.base[0]} y={POS.base[1]} /> : <Hut x={POS.base[0]} y={POS.base[1]} name={scene.name} garden={scene.base === "hut-garden"} />}
        {hasBase && kinds > 0 ? <Store x={POS.supplies[0]} y={POS.supplies[1]} kinds={kinds} onOpen={onOpenSupplies} /> : null}
        {hasBase ? <Logbook x={POS.logbook[0]} y={POS.logbook[1]} pages={pages} onOpen={onOpenLogbook} /> : null}
        {garden.length ? (
          <g data-part="garden">
            <rect x={POS.garden[0] - 78} y={POS.garden[1] - 28} width={156} height={62} rx={8} fill="#7a9a46" opacity={0.35} />
            {[-78, 78].map((dx) => (
              <g key={dx}>
                {[0, 1, 2, 3].map((i) => (
                  <rect key={i} x={POS.garden[0] + dx - 2} y={POS.garden[1] - 26 + i * 16} width={4} height={10} fill="#8b5a2b" />
                ))}
              </g>
            ))}
            {garden.map((b, i) => (
              <Bed key={b.id} x={POS.garden[0] - 40 + (i % 2) * 62} y={POS.garden[1] - 12 + Math.floor(i / 2) * 24} filled={b.filled} />
            ))}
            <SignBoard x={POS.garden[0]} y={POS.garden[1] + 36} text="Garten" size={13} tone="paper" />
          </g>
        ) : (
          <ellipse cx={POS.garden[0]} cy={POS.garden[1]} rx={60} ry={18} fill="rgba(255,247,230,0.35)" stroke="#8b5a2b" strokeWidth={2} strokeDasharray="8 8" />
        )}
        {stationBeds.length ? (
          <g data-part="station-beds">
            {stationBeds.map((b, i) => (
              <Bed key={b.id} x={stationPos[0] - 120 + i * 30} y={stationPos[1] + 40 + (i % 2) * 8} filled={b.filled} dark scale={0.7} />
            ))}
            {scene.leftovers > 0 ? (
              <g data-part="leftovers">
                <SignBoard x={stationPos[0] + 70} y={stationPos[1] + 34} text={`${scene.leftovers} übrig`} size={13} tone="paper" />
              </g>
            ) : null}
          </g>
        ) : null}
        {scene.station.built ? <Station x={stationPos[0]} y={stationPos[1]} lamp={scene.station.lamp} theme={scene.station.theme} /> : <ellipse cx={stationPos[0]} cy={stationPos[1]} rx={46} ry={14} fill="rgba(255,247,230,0.35)" stroke="#64748b" strokeWidth={2} strokeDasharray="8 8" />}

        {/* --- the pier (visit 4) --- */}
        {scene.pier.built ? <Pier x={POS.pier[0] - 40} y={POS.pier[1] - 10} boat={scene.pier.boat} sections={scene.pier.sections} /> : scene.pier.sections ? <g data-part="plank-pile"><Sprite id="plank-pile" x={POS.pier[0]-60} y={POS.pier[1]-35} width={75} height={35} /></g> : null}

        {/* --- the harbor (visit 5): crates on the quay, boats in the water, the signpost --- */}
        <g data-part="harbor" data-harbor-boats={scene.harbor.fullBoats} data-harbor-remaining={scene.harbor.remaining} data-harbor-roped={scene.harbor.roped ? "yes" : "no"} data-harbor-destination={scene.harbor.destination ?? ""}>
          {scene.harbor.fullBoats === 0 ? (
            <g data-part="harbor-crates">
              {[[-64, 12], [-32, 12], [0, 12], [32, 12], [64, 12], [-48, -14], [-16, -14], [16, -14], [48, -14], [-32, -40], [0, -40], [32, -40]].map(([dx, dy], i) => (
                <Crate key={i} x={POS.harbor[0] + dx} y={POS.harbor[1] + dy} scale={0.95} />
              ))}
              <SignBoard x={POS.harbor[0]} y={POS.harbor[1] + 22} text="Kisten warten am Kai" size={14} tone="paper" />
            </g>
          ) : (
            <>
              {Array.from({ length: Math.min(scene.harbor.fullBoats, 6) }).map((_, i) => (
                <Boat key={i} x={BOAT_MOORINGS[i][0]} y={BOAT_MOORINGS[i][1]} crates={scene.harbor.perBoat} capacity={scene.harbor.perBoat} roped={scene.harbor.roped} sail={i % 3 === 0} />
              ))}
              {scene.harbor.remaining > 0 ? <Boat x={BOAT_MOORINGS[Math.min(scene.harbor.fullBoats, 6)][0]} y={BOAT_MOORINGS[Math.min(scene.harbor.fullBoats, 6)][1]} crates={scene.harbor.remaining} capacity={scene.harbor.perBoat} roped={scene.harbor.roped} sail={false} /> : null}
              <SignBoard x={POS.harbor[0]} y={POS.harbor[1] + 40} text={`${scene.harbor.fullBoats} Boote voll · ${scene.harbor.remaining} Kisten übrig`} size={14} tone="paper" />
            </>
          )}
          {scene.harbor.planned && scene.harbor.destination ? (
            <g transform={`translate(${POS.harbor[0] + 150} ${POS.harbor[1] - 10})`} data-part="signpost">
              <line x1={0} y1={0} x2={0} y2={-74} stroke="#5b3a12" strokeWidth={6} strokeLinecap="round" />
              <polygon points="4,-70 -112,-70 -128,-56 -112,-42 4,-42" fill="#e8c893" stroke="#6b4423" strokeWidth={2.5} />
              <text x={-54} y={-50} textAnchor="middle" fontSize={14} fontWeight={700} fill="#3b2a12" fontFamily={FONT}>
                {DESTINATION_LABEL[scene.harbor.destination] ?? scene.harbor.destination}
              </text>
            </g>
          ) : null}
        </g>

        {/* --- the three workplaces with their keepers --- */}
        <g data-part="workshop" data-workplace="typing" data-status={wp("typing")?.status ?? "none"}>
          {workshopPlate ? <><ellipse cx={workshopChipX} cy={POS.workshop[1] + 8} rx={PLATE_BOXES.workshop.width * 0.48} ry={12} fill="rgba(43,33,24,0.22)" /><Plate id="workshop" /></> : <Building x={POS.workshop[0]} y={POS.workshop[1]} w={138} h={84} wall="#ead9fb" trim="#5b21b6" roof="#5b4b8a" roofStyle="slate" sign={null} flagColor="#1d4ed8" windows={2}>
            {/* a keyboard sign over the door */}
            <rect x={-26} y={-84 + 6} width={52} height={18} rx={3} fill={INK} />
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <rect key={i} x={-23 + i * 8} y={-84 + 9} width={6} height={4} rx={1} fill="#fde68a" />
            ))}
            {[0, 1, 2, 3, 4].map((i) => (
              <rect key={`b${i}`} x={-19 + i * 8} y={-84 + 15} width={6} height={4} rx={1} fill="#fde68a" />
            ))}
          </Building>}
          {plateFor("keeper") ? <g data-part="character-keeper" data-painted="true"><Plate id="keeper" /></g> : <Person x={POS.workshop[0] + 60} y={POS.workshop[1] + 2} kind="keeper" />}
        </g>
        <g data-part="office" data-workplace="planning" data-status={wp("planning")?.status ?? "none"}>
          {officePlate ? <><ellipse cx={PLATE_BOXES.office.x + PLATE_BOXES.office.width / 2} cy={POS.office[1] + 8} rx={PLATE_BOXES.office.width * 0.48} ry={12} fill="rgba(43,33,24,0.22)" /><Plate id="office" /></> : <Building x={POS.office[0]} y={POS.office[1]} w={146} h={86} wall="#dbeafe" trim="#1e3a8a" roof="#1e40af" roofStyle="hip" sign={null} flagColor="#dc2626" chimney>
            {/* a map board beside the door */}
            <rect x={-66} y={-66} width={44} height={32} rx={3} fill="#fff7e6" stroke={INK} strokeWidth={1.5} />
            <path d="M-60 -46 q 10 -16 22 -6 t 14 -8" stroke="#0ea5e9" strokeWidth={2} fill="none" />
            <circle cx={-36} cy={-56} r={2.5} fill="#dc2626" />
          </Building>}
          {plateFor("planner") ? <g data-part="character-planner" data-painted="true"><Plate id="planner" /></g> : <Person x={POS.office[0] + 66} y={POS.office[1] + 2} kind="planner" />}
        </g>
        <g data-part="shop" data-workplace="supplier">
          {shopPlate ? <><ellipse cx={PLATE_BOXES.shop.x + PLATE_BOXES.shop.width / 2} cy={POS.shop[1] + 8} rx={PLATE_BOXES.shop.width * 0.48} ry={12} fill="rgba(43,33,24,0.22)" /><Plate id="shop" />{/* live supplies stay vector beside the painted shop (crates are never painted) */}<Crate x={PLATE_BOXES.shop.x - 14} y={POS.shop[1] + 2} scale={0.7} /><Crate x={PLATE_BOXES.shop.x - 14} y={POS.shop[1] - 18} scale={0.6} /><SignBoard x={shopChipX} y={PLATE_BOXES.shop.y - 38} text="Hafenladen · Rosa" size={17} /></> : <Building x={POS.shop[0]} y={POS.shop[1]} w={138} h={68} wall="#fde7c7" trim="#9a3412" roof="#c2410c" roofStyle="gable" sign="Hafenladen · Rosa" awning={["#fff7e6", "#dc2626"]}>
            <Crate x={-48} y={0} scale={0.7} />
            <Crate x={-48} y={-20} scale={0.6} />
            <circle cx={40} cy={-14} r={9} fill="none" stroke="#8b5a2b" strokeWidth={4} />
          </Building>}
          {plateFor("supplier") ? <g data-part="character-supplier" data-painted="true"><Plate id="supplier" /></g> : <Person x={POS.shop[0] + 62} y={POS.shop[1] + 2} kind="supplier" />}
        </g>
        <g data-part="harbormaster" data-workplace="closing" data-status={wp("closing")?.status ?? "none"} data-painted={harbormasterPlate ? "true" : undefined}>
          {harbormasterPlate ? (
            // B3: the painted kiosk (open counter facing the viewer, bell, log, blank board — the status badge stays the live chip)
            <g>
              <ellipse cx={POS.harbormaster[0]} cy={POS.harbormaster[1] + 8} rx={PLATE_BOXES.harbormaster.width * 0.5} ry={13} fill="rgba(43,33,24,0.2)" />
              <Plate id="harbormaster" />
            </g>
          ) : (
          <g transform={`translate(${POS.harbormaster[0]} ${POS.harbormaster[1]})`}>
            <ellipse cx={0} cy={8} rx={66} ry={13} fill="rgba(43,33,24,0.2)" />
            {/* a kiosk: two posts, a canopy, a counter with the harbour log and a bell */}
            <rect x={-54} y={-96} width={6} height={96} fill="#5b3a12" />
            <rect x={48} y={-96} width={6} height={96} fill="#5b3a12" />
            <polygon points="-66,-96 0,-118 66,-96 66,-88 -66,-88" fill="#1e3a8a" stroke={INK_SOFT} strokeWidth={2} />
            <polygon points="-66,-88 0,-110 66,-88" fill="#ffffff" opacity={0.12} />
            <rect x={-54} y={-34} width={108} height={34} rx={3} fill="#8b5a2b" stroke="#5a371c" strokeWidth={2} />
            <rect x={-58} y={-40} width={116} height={8} rx={2} fill="#c98f52" stroke="#5a371c" strokeWidth={1.5} />
            <line x1={-54} y1={-17} x2={54} y2={-17} stroke="#5a371c" strokeWidth={1.2} opacity={0.6} />
            <rect x={-40} y={-54} width={36} height={14} rx={2} fill="#fff7e6" stroke={INK} strokeWidth={1.5} />
            <line x1={-34} y1={-49} x2={-10} y2={-49} stroke={INK} strokeWidth={1.5} />
            <line x1={-34} y1={-45} x2={-16} y2={-45} stroke={INK} strokeWidth={1.5} />
            <path d="M26 -54 q 0 -12 10 -12 q 10 0 10 12 z" fill="#d4a017" stroke={INK} strokeWidth={1.5} />
            <circle cx={36} cy={-52} r={2} fill={INK} />
          </g>
          )}
        </g>
        <Wordbook x={POS.wordbook[0]} y={POS.wordbook[1]} onOpen={onOpenWordbook} />

        {/* flags: the true state of each visit site */}
        {m1 ? <Flag x={POS.base[0] - 150} y={POS.base[1] + 60} marker={m1} onSelect={onSelectMarker} /> : null}
        {m2 ? <Flag x={POS.garden[0] + 120} y={POS.garden[1] + 50} marker={m2} onSelect={onSelectMarker} /> : null}
        {/* B3: the station flag stands to the right of the painted station (its box spans 51 units left / 95 right of the spot) */}
        {m4 ? <Flag x={stationPos[0] + 110} y={stationPos[1] - 38} marker={m4} onSelect={onSelectMarker} /> : null}
        {/* B3: the pier flag stands on the pier near its head (the painted station occupies the beach head above the pier's root; run 3
            showed the root position stacking the station, pier and harbormaster flags on top of each other on the tablet) */}
        {m5 ? <Flag x={POS.pier[0] + 150} y={POS.pier[1] + 46} marker={m5} onSelect={onSelectMarker} /> : null}
        {m6 ? <Flag x={POS.harbormaster[0] + 170} y={POS.harbormaster[1] + 70} marker={m6} onSelect={onSelectMarker} /> : null}

        {/* destination hotspots (click/tap to walk) */}
        {hotspot("workshop", "Tipp-Werkstatt", workshopPlate ? PLATE_BOXES.workshop.width + 4 : 190, workshopPlate ? PLATE_BOXES.workshop.height : 170, workshopPlate ? workshopChipX - POS.workshop[0] : 0)}
        {hotspot("office", "Planungsbüro", officePlate ? PLATE_BOXES.office.width + 4 : 200, officePlate ? PLATE_BOXES.office.height : 170, officePlate ? PLATE_BOXES.office.x + PLATE_BOXES.office.width / 2 - POS.office[0] : 0)}
        {hotspot("harbormaster", "Hafenmeister-Tisch", harbormasterPlate ? PLATE_BOXES.harbormaster.width + 4 : 160, harbormasterPlate ? PLATE_BOXES.harbormaster.height : 150)}
        {hotspot("shop", "Hafenladen", shopPlate ? PLATE_BOXES.shop.width + 4 : 180, shopPlate ? PLATE_BOXES.shop.height : 140, shopPlate ? PLATE_BOXES.shop.x + PLATE_BOXES.shop.width / 2 - POS.shop[0] : 0)}
        {hotspot("base", "Basis", baseBox ? baseBox.width + 4 : 170, baseBox ? baseBox.height : 160, baseBox ? baseBox.x + baseBox.width / 2 - POS.base[0] : 0)}
        {hotspot("garden", "Garten", 160, 70)}
        {hotspot("station", "Station", stationBox ? stationBox.width + 4 : 140, stationBox ? stationBox.height : 150, stationPos[0] - POS.station[0] + (stationBox ? stationBox.x + stationBox.width / 2 : 0), stationPos[1] - POS.station[1])}
        {hotspot("pier", "Steg", 180, 80)}
        {hotspot("harbor", "Kai", 240, 80)}
        {hotspot("wordbook", "Wörterbuch", 110, 70)}

        {/* the avatar */}
        {destinations ? (
          <g transform={`translate(${avatarPos[0]} ${avatarPos[1] + 22}) scale(${facingLeft ? -1 : 1} 1)`} data-part="avatar-anchor" data-walking={walk ? "true" : "false"}>
            {plateFor("child") ? <g data-part="avatar" data-painted="true"><Plate id="child" /></g> : <Person x={0} y={0} kind="child" />}
          </g>
        ) : null}
        {destinations && !walk && arriveHint ? (
          <g transform={`translate(${avatarPos[0]} ${avatarPos[1] - 86})`} data-part="arrive-hint" aria-hidden>
            <rect x={-72} y={-24} width={144} height={30} rx={15} fill={INK} />
            <text x={0} y={-4} textAnchor="middle" fontSize={15} fontWeight={700} fill="#fff" fontFamily={FONT}>
              {arriveHint}
            </text>
          </g>
        ) : null}
      </svg>
      </LabelsCtx.Provider>
      {/* screen-space labels: fixed font size, positioned from the measured stage box; never a hit target (the SVG hotspots below take the taps) */}
      <div className="pointer-events-none absolute inset-0" data-testid="island-labels" data-labels={allLabels ? "all" : "focused"} aria-hidden>
        {fit
          ? chips.map((c) => {
              const [x, y] = CHIP_ANCHOR[c.id];
              const px = x * fit.scale + fit.ox;
              const py = y * fit.scale + fit.oy;
              const el = rootRef.current;
              if (el && (px < 8 || px > el.clientWidth - 8 || py < 8 || py > el.clientHeight + 8)) return null;
              const fill = c.status === "done" ? "#16a34a" : c.status === "current" ? "#f59e0b" : c.status === "open" ? "#0ea5e9" : "#9ca3af";
              const glyph = c.status === "done" ? "✓" : c.status === "current" ? "▶" : c.status === "open" ? "→" : c.status === "locked" ? "🔒" : c.status === "skipped" ? "↺" : null;
              return (
                <span
                  key={c.id}
                  data-testid={`island-label-${c.id}`}
                  data-primary={c.primary ? "true" : "false"}
                  data-status={c.status ?? ""}
                  className="absolute inline-flex -translate-x-1/2 -translate-y-full items-center gap-1.5 whitespace-nowrap rounded-full border shadow-sm"
                  style={{ left: px, top: py, fontSize: 14, lineHeight: "20px", fontWeight: 700, padding: "2px 10px", background: c.primary ? "#fff8e8" : "#2b2118", color: c.primary ? "#3b2a12" : "#fff8e8", borderColor: "#6b4423" }}
                >
                  {c.text}
                  {glyph ? (
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[12px] text-white" style={{ background: fill }} data-workplace-status={c.status ?? ""}>
                      {glyph}
                    </span>
                  ) : null}
                </span>
              );
            })
          : null}
      </div>
      {labelsToggle ? (
        <button
          type="button"
          onClick={() => setAllLabels((v) => !v)}
          aria-pressed={allLabels}
          className="absolute left-2 top-2 z-10 inline-flex min-h-9 items-center gap-1.5 rounded-full border border-primary bg-primary/90 px-3 text-sm font-semibold text-primary shadow-xs backdrop-blur hover:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          data-testid="island-labels-toggle"
        >
          <span aria-hidden>{allLabels ? "▾" : "▸"}</span>
          {allLabels ? "Weniger Schilder" : "Alle Schilder"}
        </button>
      ) : null}
      {children}
    </div>
  );
}
