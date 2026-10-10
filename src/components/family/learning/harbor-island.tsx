"use client";

// ---------------------------------------------------------------------------
// The island (Visit 5, 2026-10-10; family-assistant DESIGN §7.6 "Visit 5 — the
// harbor", feedback group F1).
//
// One illustrated 2.5D island, drawn from durable records only: the named
// base (tent → hut → hut with garden) with its sign, the four garden beds, the
// five station beds with their leftovers, the observation station with its
// lamp (lit only when the Spanish request supplied one), the pier with the
// supply boat (moored only when wood was supplied), and — new — the harbor:
// the quay with its crates, the loaded boats once the arithmetic is done, the
// ropes only when cuerdas were supplied, the destination signpost once the
// plan is saved. The three workplaces stand on the island with their keepers
// (English typing-workshop keeper, German planner, Spanish supplier); the
// child's avatar walks between places with the arrow keys or by tapping a
// destination (instant under reduced motion). Direct entry never depends on
// walking: the parent screen renders direct-entry buttons beside the stage.
// Original vector artwork; no third-party assets; no score, no reward, no
// locked catalogue. Flags keep the released marker contract (data-part="site").
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
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
};

// ---------------------------------------------------------------------------
// Stage geometry (1600 × 900): where everything stands
// ---------------------------------------------------------------------------

type P = [number, number];
const POS: Record<IslandPlace, P> = {
  base: [310, 500],
  garden: [610, 475],
  station: [1360, 470],
  pier: [1190, 735],
  harbor: [600, 745],
  workshop: [830, 470],
  office: [1085, 505],
  shop: [470, 660],
  harbormaster: [820, 650],
  logbook: [230, 610],
  supplies: [440, 415],
  wordbook: [1110, 615],
};
/** Walking graph: a destination's neighbours (the avatar steps along these edges with the arrow keys). */
const EDGES: [IslandPlace, IslandPlace][] = [
  ["base", "garden"], ["base", "logbook"], ["base", "supplies"], ["garden", "workshop"], ["garden", "shop"], ["workshop", "office"], ["workshop", "harbormaster"],
  ["office", "station"], ["office", "pier"], ["office", "wordbook"], ["shop", "harbor"], ["harbor", "harbormaster"], ["harbormaster", "wordbook"], ["wordbook", "pier"], ["supplies", "workshop"],
];
const STATION_POS: Record<string, P> = { beach: [1330, 560], rocks: [1400, 440], dune: [1250, 420] };

const SUPPLY_LABEL: Record<string, string> = { Essenspakete: "Essenspakete", Setzlinge: "Setzlinge", Proben: "Proben", Bretter: "Bretter", Kisten: "Kisten", water: "Wasser", agua: "Wasser", tools: "Werkzeug", herramientas: "Werkzeug", seeds: "Samen", semillas: "Samen", lamp: "Lampe", lámpara: "Lampe", wood: "Holz", rope: "Seil", cuerdas: "Seile", cajas: "Kisten" };
const LOCATION_LABEL: Record<string, string> = { crater: "Am Kraterrand", ice: "Auf dem Eisfeld", forest: "Im Nebelwald", shore: "An der Küste" };
const DESTINATION_LABEL: Record<string, string> = { lighthouse: "Leuchtturm-Insel", mainland: "Festland", ship: "Forschungsschiff" };

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
// Artwork pieces
// ---------------------------------------------------------------------------

function Sky() {
  return (
    <g aria-hidden>
      <rect x={0} y={0} width={1600} height={900} fill="url(#isl-sky)" />
      <circle cx={1290} cy={150} r={58} fill="#fff1b8" />
      <circle cx={1290} cy={150} r={110} fill="#fff1b8" opacity={0.18} />
      {[[180, 140, 1], [520, 90, 0.8], [980, 160, 0.9], [1440, 230, 0.7]].map(([x, y, k], i) => (
        <g key={i} transform={`translate(${x} ${y}) scale(${k})`} opacity={0.92}>
          <ellipse cx={0} cy={0} rx={82} ry={26} fill="#ffffff" />
          <ellipse cx={-46} cy={8} rx={46} ry={20} fill="#ffffff" />
          <ellipse cx={50} cy={10} rx={54} ry={22} fill="#ffffff" />
          <ellipse cx={8} cy={-16} rx={44} ry={24} fill="#ffffff" />
        </g>
      ))}
      <g stroke="#1c1917" strokeWidth={2.5} fill="none" strokeLinecap="round" opacity={0.45}>
        <path d="M700 230 q 12 -12 24 0 q 12 -12 24 0" />
        <path d="M760 262 q 12 -12 24 0 q 12 -12 24 0" />
      </g>
    </g>
  );
}

/** The far shore: the three reviewed destinations on the horizon (lighthouse island, mainland, research ship). */
function Horizon({ destination }: { destination: string | null }) {
  const glow = (id: string) => (destination === id ? 1 : 0.75);
  return (
    <g aria-hidden>
      <rect x={0} y={330} width={1600} height={570} fill="url(#isl-sea)" />
      {/* mainland (left) */}
      <g opacity={glow("mainland")} data-part="far-mainland">
        <path d="M-20 334 L 90 262 L 180 300 L 260 250 L 350 310 L 430 282 L 520 334 Z" fill="#8fb1c9" />
        <path d="M90 262 L 130 280 L 180 300 Z" fill="#ffffff" opacity={0.6} />
        <path d="M260 250 L 300 272 L 350 310 Z" fill="#ffffff" opacity={0.6} />
      </g>
      {/* lighthouse island (right) */}
      <g opacity={glow("lighthouse")} data-part="far-lighthouse">
        <ellipse cx={1440} cy={334} rx={120} ry={16} fill="#8fb1c9" />
        <rect x={1424} y={262} width={28} height={72} fill="#f3f4f6" stroke="#64748b" strokeWidth={2} />
        <rect x={1424} y={286} width={28} height={12} fill="#dc2626" />
        <rect x={1424} y={310} width={28} height={12} fill="#dc2626" />
        <rect x={1420} y={250} width={36} height={14} fill="#1c1917" />
        <circle cx={1438} cy={257} r={5} fill="#fde68a" />
      </g>
      {/* research ship (centre) */}
      <g opacity={glow("ship")} data-part="far-ship">
        <path d="M880 334 h 150 l -22 -22 h -110 z" fill="#475569" />
        <rect x={930} y={292} width={50} height={22} fill="#e2e8f0" stroke="#475569" strokeWidth={1.5} />
        <rect x={948} y={274} width={10} height={18} fill="#64748b" />
      </g>
      {/* gentle swell */}
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <path key={i} d={`M${40 + i * 210} ${420 + (i % 2) * 40} q 26 -12 52 0 t 52 0`} stroke="#ffffff" strokeWidth={3} fill="none" opacity={0.45} />
      ))}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <path key={`w${i}`} d={`M${120 + i * 260} ${840 + (i % 2) * 24} q 30 -14 60 0 t 60 0`} stroke="#ffffff" strokeWidth={3.5} fill="none" opacity={0.6} className="isl-wave" />
      ))}
    </g>
  );
}

/** The island mass: cliffs on the left, a grassy plateau, a sandy shore with a bay on the right and the harbour quay on the left. */
function Land({ location }: { location: string | null }) {
  const grass = location === "ice" ? "#cfe8dc" : location === "crater" ? "#9aa85c" : "#86b34f";
  const grassDark = location === "ice" ? "#a9d3c0" : location === "crater" ? "#7b8747" : "#5e9136";
  const cliff = location === "ice" ? "#a9cfe2" : location === "crater" ? "#5a4a46" : "#a97d55";
  const cliffDark = location === "ice" ? "#7fb3cf" : location === "crater" ? "#3b302e" : "#7c5a3c";
  const sand = location === "ice" ? "#eef6ff" : "#f1dfa8";
  return (
    <g aria-hidden>
      {/* underwater shelf */}
      <path d="M90 560 C 60 700, 160 820, 420 830 L 1240 850 C 1500 850, 1580 720, 1520 560 C 1480 440, 1300 400, 1100 390 C 900 380, 700 360, 420 380 C 240 395, 110 460, 90 560 Z" fill="#2f8fc2" opacity={0.5} />
      {/* cliff body (below the plateau edge) */}
      <path d="M120 560 C 100 660, 170 760, 400 775 L 960 790 C 1200 790, 1480 760, 1500 640 L 1500 560 C 1480 450, 1300 410, 1100 400 C 900 390, 700 370, 420 390 C 240 405, 130 470, 120 560 Z" fill={cliffDark} />
      <path d="M130 545 C 115 630, 180 720, 400 735 L 960 750 C 1180 750, 1440 720, 1470 620 L 1470 555 C 1455 460, 1290 420, 1100 410 C 900 400, 700 382, 420 400 C 250 414, 140 470, 130 545 Z" fill={cliff} />
      {/* plateau */}
      <path d="M140 520 C 150 450, 280 400, 440 392 C 700 376, 900 392, 1100 404 C 1290 414, 1440 450, 1450 530 C 1440 600, 1300 640, 1180 660 C 980 690, 760 700, 560 690 C 380 680, 170 620, 140 520 Z" fill={grass} />
      <path d="M200 520 C 240 470, 330 440, 460 432 C 640 420, 820 440, 1000 450 C 1150 458, 1300 490, 1320 540" stroke={grassDark} strokeWidth={0} fill="none" />
      <path d="M960 460 C 1100 455, 1250 480, 1340 530 C 1360 580, 1280 620, 1180 640 C 1120 648, 1060 650, 1010 640 C 980 600, 950 530, 960 460 Z" fill={grassDark} opacity={0.35} />
      {/* beach ring along the south shore and the bay */}
      <path d="M560 690 C 760 700, 980 690, 1180 660 C 1300 640, 1440 600, 1450 530 L 1480 560 C 1480 640, 1340 690, 1200 715 C 1000 750, 760 760, 560 745 Z" fill={sand} />
      <path d="M1130 660 C 1220 650, 1310 680, 1340 740 C 1320 790, 1240 810, 1160 800 C 1100 790, 1060 740, 1130 660 Z" fill="#7fd0f3" opacity={0.9} data-part="bay" />
      <path d="M1140 672 C 1215 664, 1290 690, 1316 736 C 1300 776, 1236 792, 1172 784 C 1120 776, 1090 740, 1140 672 Z" fill="#5cc3ef" opacity={0.85} />
      {/* harbour quay (stone) */}
      <path d="M300 718 L 920 712 L 920 760 L 300 766 Z" fill="#9ca3af" data-part="quay" />
      <path d="M300 718 L 920 712 L 920 728 L 300 734 Z" fill="#cbd5e1" />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <rect key={i} x={312 + i * 78} y={736} width={60} height={22} fill="#6b7280" opacity={0.35} />
      ))}
      {[340, 520, 700, 880].map((x) => (
        <g key={x}>
          <circle cx={x} cy={716} r={9} fill="#374151" />
          <rect x={x - 6} y={700} width={12} height={16} rx={3} fill="#4b5563" />
        </g>
      ))}
      {/* path network */}
      {EDGES.map(([a, b]) => (
        <path key={`${a}-${b}`} d={`M${POS[a][0]} ${POS[a][1] + 22} L ${POS[b][0]} ${POS[b][1] + 22}`} stroke="rgba(255,247,230,0.75)" strokeWidth={9} fill="none" strokeLinecap="round" />
      ))}
      {EDGES.map(([a, b]) => (
        <path key={`d-${a}-${b}`} d={`M${POS[a][0]} ${POS[a][1] + 22} L ${POS[b][0]} ${POS[b][1] + 22}`} stroke="#b08a5a" strokeWidth={3} fill="none" strokeDasharray="12 12" strokeLinecap="round" opacity={0.8} />
      ))}
      {/* palms and rocks */}
      <Palm x={200} y={440} scale={0.9} />
      <Palm x={1470} y={560} scale={0.8} />
      <Palm x={700} y={640} scale={0.7} />
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
      <path d="M0 0 C 6 -30, 8 -60, 4 -92" stroke="#8b5a2b" strokeWidth={7} fill="none" strokeLinecap="round" />
      {[-70, -30, 10, 50, 100, 150].map((a) => (
        <path key={a} d="M0 0 C 20 -10, 48 -8, 62 6 C 42 2, 18 4, 0 0 Z" fill="#2f7d32" transform={`translate(4 -92) rotate(${a})`} />
      ))}
      <circle cx={4} cy={-90} r={6} fill="#5b3a12" />
    </g>
  );
}

function Pine({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} aria-hidden>
      <rect x={-4} y={-30} width={8} height={30} fill="#5b3a12" />
      <polygon points="0,-82 28,-32 -28,-32" fill="#2f7d32" />
      <polygon points="0,-100 22,-58 -22,-58" fill="#3f9142" />
    </g>
  );
}

function Rock({ x, y, fill, scale = 1 }: { x: number; y: number; fill: string; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} aria-hidden>
      <polygon points="-34,8 -20,-18 6,-26 30,-12 36,6 14,16 -14,16" fill={fill} stroke="rgba(28,25,23,0.3)" />
      <polygon points="-20,-18 6,-26 30,-12 2,-6" fill="rgba(255,255,255,0.25)" />
    </g>
  );
}

/** A little wooden house with a gabled roof, a door, a lit window and a sign. */
function House({ x, y, w = 120, h = 78, wall, roof, sign, door = "#4a2e14", flagColor, scale = 1, children }: { x: number; y: number; w?: number; h?: number; wall: string; roof: string; sign: string; door?: string; flagColor?: string; scale?: number; children?: ReactNode }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <ellipse cx={0} cy={6} rx={w * 0.62} ry={12} fill="rgba(28,25,23,0.18)" />
      <rect x={-w / 2} y={-h} width={w} height={h} fill={wall} stroke="rgba(28,25,23,0.35)" strokeWidth={2} />
      <polygon points={`${-w / 2 - 12},${-h} ${0},${-h - 46} ${w / 2 + 12},${-h}`} fill={roof} stroke="rgba(28,25,23,0.35)" strokeWidth={2} />
      <rect x={-w / 2 - 12} y={-h - 2} width={w + 24} height={8} fill="rgba(0,0,0,0.15)" />
      <rect x={-14} y={-h + 32} width={28} height={h - 32} rx={3} fill={door} />
      <circle cx={8} cy={-h / 2 + 10} r={2.2} fill="#fde68a" />
      <rect x={w / 2 - 40} y={-h + 18} width={26} height={22} rx={3} fill="#fde68a" stroke="#4a2e14" strokeWidth={2} />
      <line x1={w / 2 - 27} y1={-h + 18} x2={w / 2 - 27} y2={-h + 40} stroke="#4a2e14" strokeWidth={1.5} />
      <line x1={w / 2 - 40} y1={-h + 29} x2={w / 2 - 14} y2={-h + 29} stroke="#4a2e14" strokeWidth={1.5} />
      <rect x={-w / 2 + 12} y={-h - 30} width={w - 24} height={26} rx={6} fill="#fff7e6" stroke="#5b3a12" strokeWidth={2} />
      <text x={0} y={-h - 11} textAnchor="middle" fontSize={15} fontWeight={700} fill="#3b2a12" fontFamily="var(--font-geist-sans), Arial, sans-serif">
        {sign}
      </text>
      {flagColor ? (
        <g>
          <line x1={w / 2 + 6} y1={-h - 40} x2={w / 2 + 6} y2={-h + 4} stroke="#1c1917" strokeWidth={3} />
          <polygon points={`${w / 2 + 6},${-h - 40} ${w / 2 + 40},${-h - 30} ${w / 2 + 6},${-h - 20}`} fill={flagColor} className="isl-flag" />
        </g>
      ) : null}
      {children}
    </g>
  );
}

/** A character standing at a door: simple, distinct silhouettes (keeper: glasses + cardigan; planner: hard hat + map; supplier: cap + apron). */
function Person({ x, y, kind, speaking = false }: { x: number; y: number; kind: "keeper" | "planner" | "supplier" | "child"; speaking?: boolean }) {
  const skin = "#f1c9a5";
  const clothes = kind === "keeper" ? "#7c3aed" : kind === "planner" ? "#0ea5e9" : kind === "supplier" ? "#f97316" : "#15803d";
  return (
    <g transform={`translate(${x} ${y})`} data-part={kind === "child" ? "avatar" : `character-${kind}`} aria-hidden>
      <ellipse cx={0} cy={2} rx={16} ry={5} fill="rgba(28,25,23,0.25)" />
      <rect x={-7} y={-26} width={5} height={24} rx={2} fill="#1c1917" />
      <rect x={2} y={-26} width={5} height={24} rx={2} fill="#1c1917" />
      <path d="M-16 -28 c 2 -24 10 -34 16 -34 s 14 10 16 34 Z" fill={clothes} stroke="#1c1917" strokeWidth={1.5} />
      {kind === "supplier" ? <rect x={-9} y={-50} width={18} height={22} rx={3} fill="#fff7e6" opacity={0.9} /> : null}
      <circle cx={0} cy={-70} r={12} fill={skin} stroke="#1c1917" strokeWidth={1.5} />
      {kind === "keeper" ? (
        <>
          <path d="M-12 -74 q 12 -16 24 0 v 4 q -12 -8 -24 0 Z" fill="#9ca3af" />
          <circle cx={-5} cy={-69} r={4} fill="none" stroke="#1c1917" strokeWidth={1.5} />
          <circle cx={5} cy={-69} r={4} fill="none" stroke="#1c1917" strokeWidth={1.5} />
        </>
      ) : null}
      {kind === "planner" ? (
        <>
          <path d="M-14 -76 q 14 -14 28 0 l 2 4 h -32 Z" fill="#fde047" stroke="#1c1917" strokeWidth={1.5} />
          <rect x={10} y={-56} width={18} height={14} rx={2} fill="#fff7e6" stroke="#1c1917" strokeWidth={1.5} transform="rotate(-12 19 -49)" />
        </>
      ) : null}
      {kind === "supplier" ? (
        <>
          <path d="M-13 -74 q 13 -14 26 0 v 2 h -30 Z" fill="#dc2626" />
          <rect x={-16} y={-78} width={8} height={4} fill="#dc2626" />
          <path d="M-12 -78 q 12 -6 24 0" stroke="#1c1917" strokeWidth={1} fill="none" />
        </>
      ) : null}
      {kind === "child" ? (
        <>
          <path d="M-15 -74 q 15 -18 30 0 v 3 h -34 Z" fill="#b45309" stroke="#1c1917" strokeWidth={1.5} />
          <rect x={-20} y={-78} width={40} height={5} rx={2} fill="#b45309" />
          <rect x={8} y={-56} width={12} height={22} rx={3} fill="#dc2626" stroke="#1c1917" strokeWidth={1.5} />
        </>
      ) : null}
      <circle cx={-4} cy={-70} r={1.3} fill="#1c1917" />
      <circle cx={4} cy={-70} r={1.3} fill="#1c1917" />
      <path d="M-4 -64 q 4 3 8 0" stroke="#1c1917" strokeWidth={1.3} fill="none" />
      {speaking ? <ellipse cx={26} cy={-88} rx={14} ry={9} fill="#ffffff" stroke="#1c1917" strokeWidth={1.5} /> : null}
    </g>
  );
}

function Crate({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} aria-hidden>
      <rect x={-13} y={-24} width={26} height={24} fill="#c58a4a" stroke="#7c4a2a" strokeWidth={1.5} />
      <line x1={-13} y1={-12} x2={13} y2={-12} stroke="#7c4a2a" strokeWidth={1.5} />
      <line x1={0} y1={-24} x2={0} y2={0} stroke="#7c4a2a" strokeWidth={1.5} />
    </g>
  );
}

/** A loaded boat in the harbour water: `crates` boxes on deck, a rope to the quay when `roped`. */
function Boat({ x, y, crates, capacity, roped, sail }: { x: number; y: number; crates: number; capacity: number; roped: boolean; sail: boolean }) {
  const cols = Math.min(capacity, 6);
  return (
    <g transform={`translate(${x} ${y})`} data-part="harbor-boat" data-crates={crates} aria-hidden>
      {roped ? <path d="M-30 -8 q -14 -24 -22 -60" stroke="#7c4a2a" strokeWidth={2.5} fill="none" /> : null}
      <path d="M-44 -6 h 88 l -14 20 h -60 z" fill="#0ea5e9" stroke="#0c4a6e" strokeWidth={3} />
      <path d="M-40 -6 h 80" stroke="#fff7e6" strokeWidth={3} />
      {Array.from({ length: crates }).map((_, i) => (
        <Crate key={i} x={-28 + (i % cols) * 12} y={-6 - Math.floor(i / cols) * 10} scale={0.5} />
      ))}
      {sail ? (
        <>
          <rect x={30} y={-58} width={3} height={52} fill="#1c1917" />
          <polygon points="33,-56 56,-22 33,-22" fill="#fde68a" stroke="#1c1917" strokeWidth={1.5} />
        </>
      ) : null}
    </g>
  );
}

function Pier({ x, y, boat, sections }: { x: number; y: number; boat: boolean; sections: number }) {
  const len = 36 * Math.max(sections, 4);
  return (
    <g transform={`translate(${x} ${y})`} data-part="pier" data-boat={boat ? "moored" : "none"} data-sections={sections} aria-hidden>
      {Array.from({ length: Math.max(sections, 4) + 1 }).map((_, i) => (
        <rect key={i} x={i * 36 * 0.85 - 3} y={i * 14 + 8} width={6} height={22} fill="#5b3a12" />
      ))}
      <path d={`M-10 0 L ${len * 0.85 + 10} ${len * 0.39} L ${len * 0.85 + 10} ${len * 0.39 + 10} L -10 10 Z`} fill="#8b5a2b" />
      <path d={`M-10 0 L ${len * 0.85 + 10} ${len * 0.39} L ${len * 0.85 - 4} ${len * 0.39 - 14} L -24 -14 Z`} fill="#c58a4a" />
      {Array.from({ length: Math.max(sections, 4) * 2 }).map((_, i) => {
        const t = (i + 0.5) / (Math.max(sections, 4) * 2);
        return <line key={i} x1={-10 + t * (len * 0.85 + 20)} y1={t * len * 0.39} x2={-24 + t * (len * 0.85 + 20)} y2={-14 + t * len * 0.39} stroke="#7c4a2a" strokeWidth={1.2} opacity={0.7} />;
      })}
      {boat ? (
        <g transform={`translate(${len * 0.85 + 50} ${len * 0.39 + 18})`}>
          <path d="M-46 -4 h 88 l -16 22 h -56 z" fill="#0ea5e9" stroke="#0c4a6e" strokeWidth={3} />
          <path d="M-40 -4 h 76" stroke="#fff7e6" strokeWidth={3} />
          <rect x={-2} y={-62} width={4} height={58} fill="#1c1917" />
          <polygon points="2,-60 44,-18 2,-18" fill="#fde68a" stroke="#1c1917" strokeWidth={2} />
          <polygon points="-2,-54 -30,-22 -2,-22" fill="#fff7e6" stroke="#1c1917" strokeWidth={2} />
        </g>
      ) : null}
    </g>
  );
}

function Station({ x, y, lamp, theme }: { x: number; y: number; lamp: boolean; theme: string | null }) {
  return (
    <g transform={`translate(${x} ${y})`} data-part="station" data-lamp={lamp ? "on" : "off"} data-theme={theme ?? "none"} aria-hidden>
      {lamp ? (
        <>
          <polygon points="0,-118 -140,100 140,100" fill="url(#isl-lampCone)" opacity={0.7} />
          <circle cx={0} cy={-118} r={40} fill="url(#isl-lampGlow)" />
        </>
      ) : null}
      <ellipse cx={0} cy={6} rx={46} ry={12} fill="rgba(28,25,23,0.2)" />
      <rect x={-34} y={-40} width={68} height={40} fill="#cbd5e1" stroke="#475569" strokeWidth={2} />
      <rect x={-16} y={-110} width={32} height={70} fill="#e2e8f0" stroke="#475569" strokeWidth={2} />
      <rect x={-10} y={-96} width={20} height={14} fill="#bfe6fb" stroke="#475569" strokeWidth={1.5} />
      <circle cx={0} cy={-118} r={11} fill={lamp ? "#fde68a" : "#94a3b8"} stroke={lamp ? "#f59e0b" : "#475569"} strokeWidth={3} />
      {theme === "turtles" ? (
        <g transform="translate(60 -4)">
          <ellipse cx={0} cy={0} rx={16} ry={10} fill="#2f6f4e" />
          <ellipse cx={0} cy={-2} rx={10} ry={6} fill="#4f9a6f" />
          <circle cx={17} cy={-1} r={4} fill="#2f6f4e" />
        </g>
      ) : null}
      {theme === "waves" ? (
        <g transform="translate(56 -10)">
          <rect x={-3} y={-30} width={6} height={36} fill="#475569" />
          <path d="M-20 10 q 10 -10 20 0 t 20 0" stroke="#0ea5e9" strokeWidth={4} fill="none" strokeLinecap="round" />
        </g>
      ) : null}
    </g>
  );
}

function Bed({ x, y, filled, dark = false, scale = 1 }: { x: number; y: number; filled: number; dark?: boolean; scale?: number }) {
  const n = Math.max(0, Math.min(filled, 8));
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} data-bed-filled={filled} aria-hidden>
      <rect x={-26} y={-6} width={52} height={14} rx={3} fill={dark ? "#6e4529" : "#8b5a2b"} stroke="#5a371c" strokeWidth={1.5} />
      {Array.from({ length: n }).map((_, i) => (
        <path key={i} d={`M${-20 + i * 6} -6 c 0 -5 1 -8 1 -11 m -1 6 c -4 -1 -6 -4 -5 -7 c 3 1 5 3 5 7`} stroke="#2f7d32" strokeWidth={1.6} fill="none" strokeLinecap="round" />
      ))}
    </g>
  );
}

function Tent({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} data-part="base" data-base="tent" aria-hidden>
      <ellipse cx={0} cy={6} rx={70} ry={12} fill="rgba(28,25,23,0.18)" />
      <polygon points="-70,0 0,-78 70,0" fill="#e5a33a" stroke="rgba(28,25,23,0.3)" strokeWidth={2} />
      <polygon points="-14,0 0,-78 14,0" fill="#5b3a12" />
    </g>
  );
}

function Hut({ x, y, name, garden }: { x: number; y: number; name: string | null; garden: boolean }) {
  return (
    <g data-part="base" data-base={garden ? "hut-garden" : "hut"}>
      <House x={x} y={y} w={130} h={80} wall="#d8c3a5" roof="#9f3b2c" sign={name ? (name.length > 16 ? `${name.slice(0, 15)}…` : name) : "Basis"} />
      <g transform={`translate(${x - 90} ${y})`} aria-hidden>
        <line x1={0} y1={4} x2={0} y2={-40} stroke="#5b3a12" strokeWidth={5} strokeLinecap="round" />
        <rect x={-36} y={-66} width={72} height={28} rx={6} fill="#fff7e6" stroke="#5b3a12" strokeWidth={2.5} />
        <text x={0} y={-46} textAnchor="middle" fontSize={14} fontWeight={700} fill="#3b2a12" fontFamily="var(--font-geist-sans), Arial, sans-serif">
          Basis
        </text>
      </g>
    </g>
  );
}

function Store({ x, y, kinds, onOpen }: { x: number; y: number; kinds: number; onOpen?: () => void }) {
  const body = (
    <g transform={`translate(${x} ${y})`} data-part="supplies" data-supply-kinds={kinds}>
      <Crate x={-18} y={0} />
      <Crate x={12} y={0} />
      <Crate x={-3} y={-24} />
      <rect x={-48} y={6} width={96} height={24} rx={12} fill="rgba(255,255,255,0.92)" stroke="rgba(28,25,23,0.35)" />
      <text x={0} y={23} textAnchor="middle" fontSize={14} fontWeight={700} fill="#1c1917" fontFamily="var(--font-geist-sans), Arial, sans-serif">
        Vorräte · {kinds}
      </text>
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
      <rect x={-22} y={-40} width={44} height={34} rx={4} fill="#7c2d12" />
      <rect x={-18} y={-37} width={36} height={28} rx={3} fill="#fff7e6" />
      <line x1={-10} y1={-29} x2={10} y2={-29} stroke="#a8a29e" strokeWidth={2} />
      <line x1={-10} y1={-22} x2={10} y2={-22} stroke="#a8a29e" strokeWidth={2} />
      <circle cx={20} cy={-40} r={12} fill="#1c1917" />
      <text x={20} y={-36} textAnchor="middle" fontSize={13} fontWeight={700} fill="#fff" fontFamily="var(--font-geist-sans), Arial, sans-serif">
        {pages}
      </text>
      <text x={0} y={16} textAnchor="middle" fontSize={14} fontWeight={600} fill="#3b2a12" fontFamily="var(--font-geist-sans), Arial, sans-serif">
        Logbuch
      </text>
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
      <rect x={-20} y={-38} width={40} height={32} rx={4} fill="#1d4ed8" />
      <rect x={-16} y={-35} width={32} height={26} rx={3} fill="#eff6ff" />
      <text x={0} y={-16} textAnchor="middle" fontSize={11} fontWeight={700} fill="#1d4ed8" fontFamily="var(--font-geist-sans), Arial, sans-serif">
        abc
      </text>
      <text x={0} y={16} textAnchor="middle" fontSize={14} fontWeight={600} fill="#1e3a8a" fontFamily="var(--font-geist-sans), Arial, sans-serif">
        Wörterbuch
      </text>
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
  const active = marker.state === "next" || marker.state === "running";
  const done = marker.state === "done";
  const poleColor = done || active ? "#1c1917" : "#a8a29e";
  const flagColor = done ? "#16a34a" : active ? "#f59e0b" : "#d6d3d1";
  const caption = marker.progress && marker.state === "running" ? `${marker.caption} · ${marker.progress.done}/${marker.progress.count}` : marker.caption;
  const body = (
    <g transform={`translate(${x} ${y})`} data-part="site" data-visit={marker.visit} data-state={marker.state}>
      {active ? (
        <>
          <ellipse cx={0} cy={6} rx={54} ry={22} fill="none" stroke="#f59e0b" strokeWidth={5} className="isl-pulse" opacity={0.9} />
          <ellipse cx={0} cy={6} rx={68} ry={30} fill="rgba(245,158,11,0.16)" />
          <g data-part="next-callout">
            <rect x={-92} y={-136} width={184} height={32} rx={16} fill="#1c1917" />
            <text x={0} y={-114} textAnchor="middle" fontSize={16} fontWeight={700} fill="#fff" fontFamily="var(--font-geist-sans), Arial, sans-serif">
              {marker.state === "running" ? "Hier geht's weiter" : "Nächstes Ziel"}
            </text>
            <polygon points="-8,-104 8,-104 0,-92" fill="#1c1917" />
          </g>
        </>
      ) : null}
      <ellipse cx={0} cy={8} rx={14} ry={6} fill="rgba(28,25,23,0.25)" />
      <line x1={0} y1={6} x2={0} y2={-78} stroke={poleColor} strokeWidth={4} strokeLinecap="round" />
      <polygon points="0,-78 48,-64 0,-50" fill={flagColor} stroke="rgba(28,25,23,0.3)" className={active ? "isl-flag" : undefined} />
      {done ? <path d="M12 -68 l 6 6 l 13 -13" stroke="#fff" strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
      <rect x={-54} y={12} width={108} height={24} rx={12} fill={active ? "#1c1917" : "rgba(255,255,255,0.92)"} stroke="rgba(28,25,23,0.35)" />
      <text x={0} y={29} textAnchor="middle" fontSize={13} fontWeight={700} fill={active ? "#fff" : "#1c1917"} fontFamily="var(--font-geist-sans), Arial, sans-serif">
        {caption}
      </text>
    </g>
  );
  if (!onSelect || marker.state === "later") return body;
  return (
    <g role="button" tabIndex={0} aria-label={`${marker.label}${done ? " — Bericht öffnen" : active ? " — hier geht es weiter" : ""}`} className="cursor-pointer outline-none" onClick={() => onSelect(marker)} onKeyDown={(e) => (e.key === "Enter" || e.key === " " ? (e.preventDefault(), onSelect(marker)) : undefined)} data-testid={`world-site-${marker.visit}`}>
      {body}
    </g>
  );
}

/** A status badge over a workplace: done (✓), current (▶), open (free), locked (lock). */
function StatusBadge({ x, y, status }: { x: number; y: number; status: WorkplaceStatus }) {
  const fill = status === "done" ? "#16a34a" : status === "current" ? "#f59e0b" : status === "open" ? "#0ea5e9" : "#9ca3af";
  const glyph = status === "done" ? "✓" : status === "current" ? "▶" : status === "open" ? "→" : "🔒";
  return (
    <g transform={`translate(${x} ${y})`} data-workplace-status={status} aria-hidden>
      <circle cx={0} cy={0} r={15} fill={fill} stroke="#fff" strokeWidth={3} />
      <text x={0} y={5} textAnchor="middle" fontSize={status === "locked" ? 13 : 16} fontWeight={700} fill="#fff" fontFamily="var(--font-geist-sans), Arial, sans-serif">
        {glyph}
      </text>
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

export function HarborIsland({ scene, markers, pages, harbor = null, variant = "full", destinations, avatarAt = null, onArrive, onSelectMarker, onOpenLogbook, onOpenSupplies, onOpenWordbook, description, className, children, arriveHint = null }: HarborIslandProps) {
  const text = description ?? describeIsland(scene, markers, pages, harbor);
  // The full map crops the empty sky (the island band is what the child reads); the stage variant keeps the whole picture.
  const viewBox = variant === "strip" ? "120 300 1380 540" : variant === "full" ? "0 150 1600 750" : "0 0 1600 900";
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
    <div className={cn("relative h-full w-full overflow-hidden", className)} data-island-variant={variant} data-world-variant={variant} data-world-base={scene.base} data-world-station={scene.station.built ? "built" : "none"} data-world-lamp={scene.station.lamp ? "on" : "off"} data-world-beds={scene.beds.length} data-world-pages={pages} data-world-pier={scene.pier.built ? "built" : scene.pier.sections ? "planks" : "none"} data-world-boat={scene.pier.boat ? "moored" : "none"} data-world-harbor={scene.harbor.planned ? "planned" : scene.harbor.fullBoats ? "loaded" : "crates"} data-avatar-at={at}>
      <svg viewBox={viewBox} preserveAspectRatio={variant === "stage" ? "xMidYMid meet" : "xMidYMid slice"} className="absolute inset-0 h-full w-full select-none outline-none" role={destinations ? "application" : "img"} aria-label={text} tabIndex={destinations ? 0 : undefined} onKeyDown={onKey} focusable={destinations ? "true" : "false"} data-testid="island-svg">
        <defs>
          <linearGradient id="isl-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8fd3f4" />
            <stop offset="0.6" stopColor="#d6ecfb" />
            <stop offset="1" stopColor="#fdf1cf" />
          </linearGradient>
          <linearGradient id="isl-sea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#4aa3d6" />
            <stop offset="0.4" stopColor="#2f8fc2" />
            <stop offset="1" stopColor="#0b5e8c" />
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

        {/* --- the base, garden, station (saved from visits 1–3) --- */}
        {!hasBase ? <ellipse cx={POS.base[0]} cy={POS.base[1]} rx={70} ry={20} fill="rgba(255,247,230,0.55)" stroke="#8b5a2b" strokeWidth={2} strokeDasharray="8 8" /> : scene.base === "tent" ? <Tent x={POS.base[0]} y={POS.base[1]} /> : <Hut x={POS.base[0]} y={POS.base[1]} name={scene.name} garden={scene.base === "hut-garden"} />}
        {hasBase && kinds > 0 ? <Store x={POS.supplies[0]} y={POS.supplies[1]} kinds={kinds} onOpen={onOpenSupplies} /> : null}
        {hasBase ? <Logbook x={POS.logbook[0]} y={POS.logbook[1]} pages={pages} onOpen={onOpenLogbook} /> : null}
        {garden.length ? (
          <g data-part="garden">
            {garden.map((b, i) => (
              <Bed key={b.id} x={POS.garden[0] - 40 + (i % 2) * 60} y={POS.garden[1] - 10 + Math.floor(i / 2) * 22} filled={b.filled} />
            ))}
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
                <text x={stationPos[0] + 50} y={stationPos[1] + 52} fontSize={13} fontWeight={600} fill="#3b2a12" fontFamily="var(--font-geist-sans), Arial, sans-serif">
                  {scene.leftovers} übrig
                </text>
              </g>
            ) : null}
          </g>
        ) : null}
        {scene.station.built ? <Station x={stationPos[0]} y={stationPos[1]} lamp={scene.station.lamp} theme={scene.station.theme} /> : <ellipse cx={stationPos[0]} cy={stationPos[1]} rx={46} ry={14} fill="rgba(255,247,230,0.35)" stroke="#64748b" strokeWidth={2} strokeDasharray="8 8" />}

        {/* --- the pier (visit 4) --- */}
        {scene.pier.built ? <Pier x={POS.pier[0] - 40} y={POS.pier[1] - 10} boat={scene.pier.boat} sections={scene.pier.sections} /> : scene.pier.sections ? <g data-part="plank-pile">{[0, 1, 2].map((i) => <rect key={i} x={POS.pier[0] - 60 + i * 24} y={POS.pier[1] - 20 - (i % 2) * 6} width={20} height={6} fill="#c58a4a" stroke="#7c4a2a" />)}</g> : null}

        {/* --- the harbor (visit 5): crates on the quay, boats in the water, the signpost --- */}
        <g data-part="harbor" data-harbor-boats={scene.harbor.fullBoats} data-harbor-remaining={scene.harbor.remaining} data-harbor-roped={scene.harbor.roped ? "yes" : "no"} data-harbor-destination={scene.harbor.destination ?? ""}>
          {scene.harbor.fullBoats === 0 ? (
            <g data-part="harbor-crates">
              {Array.from({ length: 12 }).map((_, i) => (
                <Crate key={i} x={700 + (i % 6) * 30} y={708 - Math.floor(i / 6) * 22} scale={0.85} />
              ))}
              <rect x={690} y={768} width={140} height={22} rx={11} fill="rgba(255,255,255,0.92)" stroke="rgba(28,25,23,0.35)" />
              <text x={760} y={784} textAnchor="middle" fontSize={13} fontWeight={700} fill="#1c1917" fontFamily="var(--font-geist-sans), Arial, sans-serif">
                Kisten warten am Kai
              </text>
            </g>
          ) : (
            <>
              {Array.from({ length: Math.min(scene.harbor.fullBoats, 6) }).map((_, i) => (
                <Boat key={i} x={360 + i * 96} y={818 + (i % 2) * 10} crates={scene.harbor.perBoat} capacity={scene.harbor.perBoat} roped={scene.harbor.roped} sail={i % 3 === 0} />
              ))}
              {scene.harbor.remaining > 0 ? <Boat x={360 + Math.min(scene.harbor.fullBoats, 6) * 96} y={828} crates={scene.harbor.remaining} capacity={scene.harbor.perBoat} roped={scene.harbor.roped} sail={false} /> : null}
              <rect x={548} y={770} width={220} height={24} rx={12} fill="rgba(255,255,255,0.92)" stroke="rgba(28,25,23,0.35)" />
              <text x={658} y={787} textAnchor="middle" fontSize={13} fontWeight={700} fill="#1c1917" fontFamily="var(--font-geist-sans), Arial, sans-serif">
                {scene.harbor.fullBoats} Boote voll · {scene.harbor.remaining} Kisten übrig
              </text>
            </>
          )}
          {scene.harbor.planned && scene.harbor.destination ? (
            <g transform="translate(300 700)" data-part="signpost">
              <line x1={0} y1={0} x2={0} y2={-70} stroke="#5b3a12" strokeWidth={5} strokeLinecap="round" />
              <polygon points="-4,-66 86,-66 100,-54 86,-42 -4,-42" fill="#fff7e6" stroke="#5b3a12" strokeWidth={2.5} />
              <text x={42} y={-49} textAnchor="middle" fontSize={13} fontWeight={700} fill="#3b2a12" fontFamily="var(--font-geist-sans), Arial, sans-serif">
                {DESTINATION_LABEL[scene.harbor.destination] ?? scene.harbor.destination}
              </text>
            </g>
          ) : null}
        </g>

        {/* --- the three workplaces with their keepers --- */}
        <g data-part="workshop" data-workplace="typing" data-status={wp("typing")?.status ?? "none"}>
          <House x={POS.workshop[0]} y={POS.workshop[1]} w={132} h={82} wall="#e9d5ff" roof="#6d28d9" sign="Tipp-Werkstatt" flagColor="#1d4ed8">
            {/* a keyboard sign */}
            <rect x={-54} y={-50} width={42} height={16} rx={3} fill="#1c1917" />
            {[0, 1, 2, 3, 4].map((i) => (
              <rect key={i} x={-51 + i * 8} y={-47} width={6} height={4} fill="#fde68a" />
            ))}
            {[0, 1, 2, 3].map((i) => (
              <rect key={`b${i}`} x={-49 + i * 8} y={-41} width={6} height={4} fill="#fde68a" />
            ))}
          </House>
          <Person x={POS.workshop[0] + 52} y={POS.workshop[1] + 2} kind="keeper" />
          {wp("typing") ? <StatusBadge x={POS.workshop[0] - 60} y={POS.workshop[1] - 130} status={wp("typing")!.status} /> : null}
        </g>
        <g data-part="office" data-workplace="planning" data-status={wp("planning")?.status ?? "none"}>
          <House x={POS.office[0]} y={POS.office[1]} w={140} h={84} wall="#dbeafe" roof="#1e3a8a" sign="Planungsbüro" flagColor="#dc2626">
            {/* a map board */}
            <rect x={-60} y={-60} width={44} height={32} rx={3} fill="#fff7e6" stroke="#1c1917" strokeWidth={1.5} />
            <path d="M-54 -40 q 10 -16 22 -6 t 14 -8" stroke="#0ea5e9" strokeWidth={2} fill="none" />
            <circle cx={-30} cy={-50} r={2.5} fill="#dc2626" />
          </House>
          <Person x={POS.office[0] + 58} y={POS.office[1] + 2} kind="planner" />
          {wp("planning") ? <StatusBadge x={POS.office[0] - 64} y={POS.office[1] - 134} status={wp("planning")!.status} /> : null}
        </g>
        <g data-part="shop" data-workplace="supplier">
          <House x={POS.shop[0]} y={POS.shop[1]} w={134} h={66} wall="#fed7aa" roof="#c2410c" sign="Hafenladen · Rosa">
            {/* an awning */}
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <rect key={i} x={-67 + i * 23} y={-66} width={23} height={14} fill={i % 2 ? "#fff7e6" : "#dc2626"} />
            ))}
            <Crate x={-40} y={0} scale={0.6} />
            <path d="M34 -12 q 8 -10 16 0 q -8 6 -16 0" fill="#7c4a2a" />
          </House>
          <Person x={POS.shop[0] + 52} y={POS.shop[1] + 2} kind="supplier" />
        </g>
        <g data-part="harbormaster" data-workplace="closing" data-status={wp("closing")?.status ?? "none"}>
          <g transform={`translate(${POS.harbormaster[0]} ${POS.harbormaster[1]})`}>
            <ellipse cx={0} cy={6} rx={60} ry={12} fill="rgba(28,25,23,0.18)" />
            <rect x={-52} y={-30} width={104} height={30} rx={4} fill="#8b5a2b" stroke="#5a371c" strokeWidth={2} />
            <rect x={-56} y={-36} width={112} height={8} rx={2} fill="#c58a4a" stroke="#5a371c" strokeWidth={1.5} />
            <rect x={-40} y={-50} width={36} height={14} rx={2} fill="#fff7e6" stroke="#1c1917" strokeWidth={1.5} />
            <line x1={-34} y1={-45} x2={-10} y2={-45} stroke="#1c1917" strokeWidth={1.5} />
            <line x1={-34} y1={-41} x2={-16} y2={-41} stroke="#1c1917" strokeWidth={1.5} />
            <rect x={-40} y={-82} width={80} height={24} rx={6} fill="#fff7e6" stroke="#5b3a12" strokeWidth={2} />
            <text x={0} y={-65} textAnchor="middle" fontSize={13} fontWeight={700} fill="#3b2a12" fontFamily="var(--font-geist-sans), Arial, sans-serif">
              Hafenmeister
            </text>
          </g>
          {wp("closing") ? <StatusBadge x={POS.harbormaster[0] + 62} y={POS.harbormaster[1] - 70} status={wp("closing")!.status} /> : null}
        </g>
        <Wordbook x={POS.wordbook[0]} y={POS.wordbook[1]} onOpen={onOpenWordbook} />

        {/* flags: the true state of each visit site */}
        {m1 ? <Flag x={POS.base[0] - 120} y={POS.base[1] + 40} marker={m1} onSelect={onSelectMarker} /> : null}
        {m2 ? <Flag x={POS.garden[0] + 110} y={POS.garden[1] + 50} marker={m2} onSelect={onSelectMarker} /> : null}
        {m4 ? <Flag x={stationPos[0] - 100} y={stationPos[1] + 10} marker={m4} onSelect={onSelectMarker} /> : null}
        {m5 ? <Flag x={POS.pier[0] + 120} y={POS.pier[1] - 50} marker={m5} onSelect={onSelectMarker} /> : null}
        {m6 ? <Flag x={980} y={715} marker={m6} onSelect={onSelectMarker} /> : null}

        {/* destination hotspots (click/tap to walk) */}
        {hotspot("workshop", "Tipp-Werkstatt", 180, 150)}
        {hotspot("office", "Planungsbüro", 190, 150)}
        {hotspot("harbormaster", "Hafenmeister-Tisch", 150, 100)}
        {hotspot("shop", "Hafenladen", 170, 120)}
        {hotspot("base", "Basis", 170, 140)}
        {hotspot("garden", "Garten", 150, 70)}
        {hotspot("station", "Station", 140, 140, stationPos[0] - POS.station[0], stationPos[1] - POS.station[1])}
        {hotspot("pier", "Steg", 180, 80)}
        {hotspot("harbor", "Kai", 240, 80)}
        {hotspot("wordbook", "Wörterbuch", 110, 70)}

        {/* the avatar */}
        {destinations ? (
          <g transform={`translate(${avatarPos[0]} ${avatarPos[1] + 22}) scale(${facingLeft ? -1 : 1} 1)`} data-part="avatar-anchor" data-walking={walk ? "true" : "false"}>
            <Person x={0} y={0} kind="child" />
          </g>
        ) : null}
        {destinations && !walk && arriveHint ? (
          <g transform={`translate(${avatarPos[0]} ${avatarPos[1] - 76})`} data-part="arrive-hint" aria-hidden>
            <rect x={-70} y={-24} width={140} height={28} rx={14} fill="#1c1917" />
            <text x={0} y={-5} textAnchor="middle" fontSize={14} fontWeight={700} fill="#fff" fontFamily="var(--font-geist-sans), Arial, sans-serif">
              {arriveHint}
            </text>
          </g>
        ) : null}
      </svg>
      {children}
    </div>
  );
}
