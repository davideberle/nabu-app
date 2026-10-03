"use client";

// ---------------------------------------------------------------------------
// The expedition as an illustrated isometric settlement (world-first learner
// experience, 2026-10-03; family-assistant DESIGN §7.6 UX-2; visual round 1 V1).
//
// Pure presentation of durable records: every drawn element corresponds to a
// saved fact of the child's mission — the named/placed base (tent → hut →
// hut with garden) with its name sign, the four garden beds of EQ-RETURN with
// their seedlings, the five station beds of EQ-STATION with the leftovers
// lying beside them, the observation station where it was built and its lamp
// lit only if the Spanish request actually supplied one, ONE supply store
// (inspectable, counts in the panel), the logbook with its page count, and the
// three visit sites of the reviewed content with their true state (done /
// running / next). The island has a readable coastline (beach ring, a bay, a
// headland), three deliberate zones (base plateau, garden terrace, station
// ground) and breathing room between landmarks. The pending destination is
// the principal spatial emphasis (ring + callout). Nothing is invented: no
// locked catalogue, no reward, no score. The only motion is the ring around
// the next destination, disabled under reduced motion. Original geometry and
// palette; no third-party assets.
// ---------------------------------------------------------------------------

import type { ReactNode } from "react";
import { cn } from "@/components/ui/nabu";
import type { SceneModel } from "@/lib/family-learning-summary";

export type WorldSiteState = "done" | "running" | "next" | "later";

export type WorldMarker = {
  visit: string;
  ordinal: number | null;
  label: string;
  /** Short caption under the flag (e.g. "Besuch 1"). */
  caption: string;
  state: WorldSiteState;
  /** Running visit progress for the caption line, when running. */
  progress?: { done: number; count: number } | null;
};

export type ExpeditionWorldProps = {
  scene: SceneModel;
  markers: WorldMarker[];
  /** Pages saved in the logbook. */
  pages: number;
  /** "full" fills its container (16:9 stage, cropped to cover); "strip" shows the settlement band only. */
  variant?: "full" | "strip";
  /** Marker click/Enter → open that visit's report (done) or continue (running/next). */
  onSelectMarker?: (marker: WorldMarker) => void;
  onOpenLogbook?: () => void;
  onOpenSupplies?: () => void;
  /** Accessible description override; computed from the scene otherwise. */
  description?: string;
  className?: string;
  children?: ReactNode;
};

// ---------------------------------------------------------------------------
// Isometric helpers (1600 × 900 stage)
// ---------------------------------------------------------------------------

const TILE_W = 104;
const TILE_H = 52;
const ORIGIN = { x: 800, y: 452 };

/** Project grid coordinates (x right-down, y left-down) and a height z to stage pixels. */
function iso(x: number, y: number, z = 0): [number, number] {
  return [ORIGIN.x + (x - y) * (TILE_W / 2), ORIGIN.y + (x + y) * (TILE_H / 2) - z];
}

function pts(points: [number, number][]): string {
  return points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}

/** A flat diamond tile at grid (x, y) spanning w × h tiles, raised by z. */
function tile(x: number, y: number, w: number, h: number, z = 0): string {
  return pts([iso(x, y, z), iso(x + w, y, z), iso(x + w, y + h, z), iso(x, y + h, z)]);
}

/** An isometric box: top, left (south-west) and right (south-east) faces. */
function Box({ x, y, w, h, z = 0, height, top, left, right, stroke = "rgba(28,25,23,0.18)", children }: { x: number; y: number; w: number; h: number; z?: number; height: number; top: string; left: string; right: string; stroke?: string; children?: ReactNode }) {
  const b = (gx: number, gy: number, gz: number) => iso(gx, gy, gz);
  const topFace = pts([b(x, y, z + height), b(x + w, y, z + height), b(x + w, y + h, z + height), b(x, y + h, z + height)]);
  const leftFace = pts([b(x, y + h, z), b(x + w, y + h, z), b(x + w, y + h, z + height), b(x, y + h, z + height)]);
  const rightFace = pts([b(x + w, y, z), b(x + w, y + h, z), b(x + w, y + h, z + height), b(x + w, y, z + height)]);
  return (
    <g>
      <polygon points={leftFace} fill={left} stroke={stroke} strokeWidth={1} />
      <polygon points={rightFace} fill={right} stroke={stroke} strokeWidth={1} />
      <polygon points={topFace} fill={top} stroke={stroke} strokeWidth={1} />
      {children}
    </g>
  );
}

type Palette = { skyTop: string; skyBottom: string; far: string; farDetail: string; plateTop: string; plateSide: string; plateDeep: string; beach: string; grass: string; soil: string; rock: string; accent: string; sea: boolean; label: string };

const PALETTES: Record<string, Palette> = {
  crater: { skyTop: "#f7dcc0", skyBottom: "#f3c7a0", far: "#8c5a4a", farDetail: "#d9612b", plateTop: "#6f5a55", plateSide: "#4f403d", plateDeep: "#3b302e", beach: "#8c7470", grass: "#7a8a52", soil: "#5a3d2e", rock: "#3b302e", accent: "#f97316", sea: false, label: "Am Kraterrand" },
  ice: { skyTop: "#dbeafe", skyBottom: "#eef6ff", far: "#bcd7ea", farDetail: "#ffffff", plateTop: "#dbeef7", plateSide: "#a9cfe2", plateDeep: "#7fb3cf", beach: "#eef6ff", grass: "#bfe3d0", soil: "#6b4a3a", rock: "#94a3b8", accent: "#0284c7", sea: true, label: "Auf dem Eisfeld" },
  forest: { skyTop: "#e3f1c9", skyBottom: "#f4f9e6", far: "#6b8f4a", farDetail: "#3f6b2f", plateTop: "#86b04f", plateSide: "#5f8637", plateDeep: "#466a2a", beach: "#a9bf72", grass: "#6f9a3c", soil: "#5a3d2e", rock: "#78716c", accent: "#15803d", sea: false, label: "Im Nebelwald" },
  shore: { skyTop: "#bfe6fb", skyBottom: "#fdf1cf", far: "#7cc6ea", farDetail: "#ffffff", plateTop: "#f0dba7", plateSide: "#d9bd84", plateDeep: "#bda06a", beach: "#f7e8bf", grass: "#9ec46a", soil: "#8b5a2b", rock: "#8d8578", accent: "#0ea5e9", sea: true, label: "An der Küste" },
  none: { skyTop: "#e7e5e4", skyBottom: "#f5f3f0", far: "#cfcac6", farDetail: "#ffffff", plateTop: "#d6d0c8", plateSide: "#b8b0a6", plateDeep: "#9a9087", beach: "#e7e5e4", grass: "#c8ccb8", soil: "#8b5a2b", rock: "#a8a29e", accent: "#78716c", sea: false, label: "Noch kein Standort" },
};

const SUPPLY_LABEL: Record<string, string> = { Essenspakete: "Essenspakete", Setzlinge: "Setzlinge", Proben: "Proben", water: "Wasser", agua: "Wasser", tools: "Werkzeug", herramientas: "Werkzeug", seeds: "Samen", semillas: "Samen", lamp: "Lampe", lámpara: "Lampe" };
const LOCATION_LABEL: Record<string, string> = { crater: "Am Kraterrand", ice: "Auf dem Eisfeld", forest: "Im Nebelwald", shore: "An der Küste" };
const SPOT_LABEL: Record<string, string> = { beach: "am Strand", rocks: "auf den Felsen", dune: "auf der Düne" };

/** Supplies merged by meaning (Wasser from water/agua etc.) for the one store label and the panel. */
export function supplyRows(scene: SceneModel): { label: string; count: number }[] {
  const rows = new Map<string, number>();
  for (const s of scene.stores) rows.set(SUPPLY_LABEL[s.key] ?? s.key, (rows.get(SUPPLY_LABEL[s.key] ?? s.key) ?? 0) + s.count);
  return [...rows.entries()].map(([label, count]) => ({ label, count }));
}

/** Plain-language description of what the world shows (assistive tech, parent, tests). */
export function describeWorld(scene: SceneModel, markers: WorldMarker[], pages: number): string {
  const parts: string[] = [];
  if (!scene.name) parts.push("Noch keine Basis — der erste Besuch beginnt mit dem Bauen.");
  else {
    parts.push(`Basis „${scene.name}“${scene.location ? `, ${LOCATION_LABEL[scene.location] ?? scene.location}` : ""}: ${scene.base === "tent" ? "ein Zelt" : "eine Hütte"}.`);
    const garden = scene.beds.filter((b) => b.id.startsWith("garden"));
    const station = scene.beds.filter((b) => b.id.startsWith("station"));
    if (garden.length) parts.push(`${garden.length} Gartenbeete mit je ${garden[0].filled} Setzlingen.`);
    if (station.length) parts.push(`${station.length} Stationsbeete mit je ${station[0].filled} Setzlingen${scene.leftovers ? `, ${scene.leftovers} übrig daneben` : ""}.`);
    if (scene.station.built) parts.push(`Beobachtungsstation ${scene.station.spot ? SPOT_LABEL[scene.station.spot] ?? scene.station.spot : ""}${scene.station.lamp ? ", die Lampe brennt" : ", ohne Lampe"}.`);
    const rows = supplyRows(scene);
    if (rows.length) parts.push(`Vorräte: ${rows.map((r) => `${r.count} ${r.label}`).join(", ")}.`);
    parts.push(`${pages} ${pages === 1 ? "Seite" : "Seiten"} im Logbuch.`);
  }
  const done = markers.filter((m) => m.state === "done").map((m) => m.caption);
  const next = markers.find((m) => m.state === "next" || m.state === "running");
  if (done.length) parts.push(`Fertig: ${done.join(", ")}.`);
  if (next) parts.push(`${next.state === "running" ? "Angefangen" : "Als Nächstes"}: ${next.label}.`);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Scenery pieces
// ---------------------------------------------------------------------------

function Sprout({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} aria-hidden>
      <path d="M0 0 C 0 -8, 1 -14, 2 -20" stroke="#2f7d32" strokeWidth={2.2} fill="none" strokeLinecap="round" />
      <path d="M1 -10 C -8 -12, -12 -18, -9 -24 C -3 -22, 0 -16, 1 -10 Z" fill="#4caf50" />
      <path d="M2 -14 C 10 -16, 14 -22, 11 -28 C 5 -26, 2 -20, 2 -14 Z" fill="#66bb6a" />
    </g>
  );
}

function Bed({ gx, gy, filled, capacity, dark = false }: { gx: number; gy: number; filled: number; capacity: number | null; dark?: boolean }) {
  const [cx, cy] = iso(gx + 0.5, gy + 0.5, 6);
  const n = Math.max(0, Math.min(filled, capacity ?? 8));
  const columns = n <= 4 ? n : Math.ceil(n / 2);
  const rows = n <= 4 ? 1 : 2;
  const sprouts: ReactNode[] = [];
  for (let i = 0; i < n; i += 1) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    sprouts.push(<Sprout key={i} x={cx + (col - (columns - 1) / 2) * 14} y={cy + (row - (rows - 1) / 2) * 9 + 6} scale={0.75} />);
  }
  return (
    <g data-bed-filled={filled} data-bed-capacity={capacity ?? ""}>
      <Box x={gx} y={gy} w={1} h={1} height={6} top={dark ? "#7c4a2a" : "#8b5a2b"} left={dark ? "#5b3419" : "#6b4423"} right={dark ? "#4a2a14" : "#5a371c"} />
      <polygon points={tile(gx + 0.12, gy + 0.12, 0.76, 0.76, 6.5)} fill={dark ? "#5c3a1e" : "#6e4529"} opacity={0.9} />
      {sprouts}
    </g>
  );
}

function Tent({ gx, gy }: { gx: number; gy: number }) {
  const [ax, ay] = iso(gx, gy + 1, 0);
  const [bx, by] = iso(gx + 1.4, gy + 1, 0);
  const [cx, cy] = iso(gx + 1.4, gy, 0);
  const [dx, dy] = iso(gx, gy, 0);
  const ridgeA = iso(gx + 0.7, gy + 1, 70);
  const ridgeB = iso(gx + 0.7, gy, 70);
  return (
    <g data-part="base" data-base="tent">
      <polygon points={pts([[ax, ay], [bx, by], ridgeA])} fill="#e5a33a" stroke="rgba(28,25,23,0.25)" />
      <polygon points={pts([[bx, by], [cx, cy], ridgeB, ridgeA])} fill="#c97f1f" stroke="rgba(28,25,23,0.25)" />
      <polygon points={pts([[ax, ay], [dx, dy], ridgeB, ridgeA])} fill="#f0b74d" stroke="rgba(28,25,23,0.25)" opacity={0.95} />
      <polygon points={pts([[(ax + bx) / 2 - 10, (ay + by) / 2 + 1], [(ax + bx) / 2 + 10, (ay + by) / 2 + 1], [ridgeA[0], ridgeA[1] + 26]])} fill="#5b3a12" />
    </g>
  );
}

function Hut({ gx, gy, name }: { gx: number; gy: number; name: string | null }) {
  const [doorX, doorY] = iso(gx + 1.2, gy + 1.6, 0);
  const [signX, signY] = iso(gx - 0.6, gy + 1.3, 0);
  const signW = Math.max(84, Math.min(210, (name?.length ?? 0) * 12 + 30));
  return (
    <g data-part="base" data-base="hut">
      <Box x={gx} y={gy} w={1.6} h={1.6} height={52} top="#d8c3a5" left="#b48a5a" right="#9a6f43" />
      <polygon points={pts([iso(gx - 0.15, gy - 0.15, 52), iso(gx + 1.75, gy - 0.15, 52), iso(gx + 0.8, gy + 0.8, 112)])} fill="#9f3b2c" stroke="rgba(28,25,23,0.25)" />
      <polygon points={pts([iso(gx + 1.75, gy - 0.15, 52), iso(gx + 1.75, gy + 1.75, 52), iso(gx + 0.8, gy + 0.8, 112)])} fill="#7f2d22" stroke="rgba(28,25,23,0.25)" />
      <polygon points={pts([iso(gx - 0.15, gy + 1.75, 52), iso(gx + 1.75, gy + 1.75, 52), iso(gx + 0.8, gy + 0.8, 112)])} fill="#c04a37" stroke="rgba(28,25,23,0.25)" />
      <polygon points={pts([iso(gx - 0.15, gy - 0.15, 52), iso(gx - 0.15, gy + 1.75, 52), iso(gx + 0.8, gy + 0.8, 112)])} fill="#b2412f" stroke="rgba(28,25,23,0.25)" />
      <rect x={doorX - 9} y={doorY - 36} width={18} height={30} rx={3} fill="#4a2e14" />
      <rect x={doorX + 22} y={doorY - 46} width={14} height={14} rx={2} fill="#dbeafe" stroke="#4a2e14" strokeWidth={2} />
      {name ? (
        <g data-part="sign">
          <line x1={signX} y1={signY + 4} x2={signX} y2={signY - 40} stroke="#5b3a12" strokeWidth={5} strokeLinecap="round" />
          <rect x={signX - signW / 2} y={signY - 66} width={signW} height={30} rx={6} fill="#fff7e6" stroke="#5b3a12" strokeWidth={2.5} />
          <text x={signX} y={signY - 45} textAnchor="middle" fontSize={17} fontWeight={700} fill="#3b2a12" fontFamily="var(--font-geist-sans), Arial, sans-serif">
            {name.length > 16 ? `${name.slice(0, 15)}…` : name}
          </text>
        </g>
      ) : null}
    </g>
  );
}

/** ONE supply store: a crate stack with a single label; the counts live in the panel (consolidated, V1). */
function Store({ gx, gy, kinds, onOpen }: { gx: number; gy: number; kinds: number; onOpen?: () => void }) {
  const [lx, ly] = iso(gx + 0.5, gy + 1.3, 0);
  const body = (
    <g data-part="supplies" data-supply-kinds={kinds}>
      <Box x={gx} y={gy} w={0.8} h={0.8} height={30} top="#e9c38a" left="#c79a5e" right="#a67c48" />
      <Box x={gx + 0.55} y={gy + 0.2} w={0.7} h={0.7} height={26} top="#f1d2a1" left="#d2a66c" right="#b58a55" />
      <Box x={gx + 0.2} y={gy + 0.15} w={0.6} h={0.6} z={30} height={24} top="#f6dcae" left="#d9b079" right="#bc935e" />
      <rect x={lx - 48} y={ly + 2} width={96} height={24} rx={12} fill="rgba(255,255,255,0.92)" stroke="rgba(28,25,23,0.35)" />
      <text x={lx} y={ly + 19} textAnchor="middle" fontSize={14} fontWeight={700} fill="#1c1917" fontFamily="var(--font-geist-sans), Arial, sans-serif">
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

function Station({ gx, gy, lamp, theme }: { gx: number; gy: number; lamp: boolean; theme: string | null }) {
  const [lx, ly] = iso(gx + 0.5, gy + 0.5, 96);
  return (
    <g data-part="station" data-lamp={lamp ? "on" : "off"} data-theme={theme ?? "none"}>
      {lamp ? (
        <>
          <polygon points={pts([[lx, ly], [lx - 150, ly + 230], [lx + 150, ly + 230]])} fill="url(#lampCone)" opacity={0.75} />
          <circle cx={lx} cy={ly} r={46} fill="url(#lampGlow)" />
        </>
      ) : null}
      <Box x={gx} y={gy} w={1} h={1} height={40} top="#cbd5e1" left="#94a3b8" right="#64748b" />
      <Box x={gx + 0.25} y={gy + 0.25} w={0.5} h={0.5} height={88} z={40} top="#e2e8f0" left="#a8b4c4" right="#7d8a9c" />
      <circle cx={lx} cy={ly - 10} r={12} fill={lamp ? "#fde68a" : "#94a3b8"} stroke={lamp ? "#f59e0b" : "#475569"} strokeWidth={3} />
      {theme === "turtles" ? (
        <g transform={`translate(${lx + 70} ${ly + 128})`} aria-hidden>
          <ellipse cx={0} cy={0} rx={16} ry={10} fill="#2f6f4e" />
          <ellipse cx={0} cy={-2} rx={10} ry={6} fill="#4f9a6f" />
          <circle cx={17} cy={-1} r={4} fill="#2f6f4e" />
          <ellipse cx={-14} cy={5} rx={5} ry={3} fill="#2f6f4e" />
          <ellipse cx={11} cy={7} rx={5} ry={3} fill="#2f6f4e" />
        </g>
      ) : null}
      {theme === "waves" ? (
        <g transform={`translate(${lx + 62} ${ly + 120})`} aria-hidden>
          <rect x={-3} y={-30} width={6} height={36} fill="#475569" />
          <path d="M-20 10 q 10 -10 20 0 t 20 0" stroke="#0ea5e9" strokeWidth={4} fill="none" strokeLinecap="round" />
          <circle cx={0} cy={-32} r={6} fill="#0ea5e9" />
        </g>
      ) : null}
    </g>
  );
}

function Logbook({ gx, gy, pages, onOpen }: { gx: number; gy: number; pages: number; onOpen?: () => void }) {
  const [x, y] = iso(gx, gy, 0);
  const inner = (
    <g transform={`translate(${x} ${y})`} data-part="logbook" data-pages={pages}>
      <rect x={-22} y={-40} width={44} height={34} rx={4} fill="#7c2d12" />
      <rect x={-18} y={-37} width={36} height={28} rx={3} fill="#fff7e6" />
      <line x1={-10} y1={-29} x2={10} y2={-29} stroke="#a8a29e" strokeWidth={2} />
      <line x1={-10} y1={-22} x2={10} y2={-22} stroke="#a8a29e" strokeWidth={2} />
      <line x1={-10} y1={-15} x2={4} y2={-15} stroke="#a8a29e" strokeWidth={2} />
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

function Flag({ gx, gy, marker, onSelect }: { gx: number; gy: number; marker: WorldMarker; onSelect?: (m: WorldMarker) => void }) {
  const [x, y] = iso(gx, gy, 0);
  const active = marker.state === "next" || marker.state === "running";
  const done = marker.state === "done";
  const poleColor = done || active ? "#1c1917" : "#a8a29e";
  const flagColor = done ? "#16a34a" : active ? "#f59e0b" : "#d6d3d1";
  const caption = marker.progress && marker.state === "running" ? `${marker.caption} · ${marker.progress.done}/${marker.progress.count}` : marker.caption;
  const body = (
    <g transform={`translate(${x} ${y})`} data-part="site" data-visit={marker.visit} data-state={marker.state}>
      {active ? (
        <>
          <ellipse cx={0} cy={6} rx={60} ry={30} fill="none" stroke="#f59e0b" strokeWidth={5} className="world-pulse" opacity={0.9} />
          <ellipse cx={0} cy={6} rx={76} ry={38} fill="rgba(245,158,11,0.16)" />
          <g data-part="next-callout">
            <rect x={-96} y={-146} width={192} height={34} rx={17} fill="#1c1917" />
            <text x={0} y={-123} textAnchor="middle" fontSize={17} fontWeight={700} fill="#fff" fontFamily="var(--font-geist-sans), Arial, sans-serif">
              {marker.state === "running" ? "Hier geht's weiter" : "Nächstes Ziel"}
            </text>
            <polygon points="-8,-112 8,-112 0,-100" fill="#1c1917" />
          </g>
        </>
      ) : null}
      <ellipse cx={0} cy={8} rx={16} ry={7} fill="rgba(28,25,23,0.25)" />
      <line x1={0} y1={6} x2={0} y2={-84} stroke={poleColor} strokeWidth={4} strokeLinecap="round" />
      <polygon points="0,-84 52,-69 0,-54" fill={flagColor} stroke="rgba(28,25,23,0.3)" />
      {done ? <path d="M13 -73 l 7 7 l 14 -14" stroke="#fff" strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
      {active ? <polygon points="13,-77 32,-69 13,-61" fill="#1c1917" /> : null}
      <rect x={-58} y={14} width={116} height={26} rx={13} fill={active ? "#1c1917" : "rgba(255,255,255,0.92)"} stroke="rgba(28,25,23,0.35)" />
      <text x={0} y={32} textAnchor="middle" fontSize={14} fontWeight={700} fill={active ? "#fff" : "#1c1917"} fontFamily="var(--font-geist-sans), Arial, sans-serif">
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

function Palm({ gx, gy, scale = 1 }: { gx: number; gy: number; scale?: number }) {
  const [x, y] = iso(gx, gy, 0);
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} aria-hidden>
      <path d="M0 0 C 4 -30, 6 -60, 4 -92" stroke="#8b5a2b" strokeWidth={7} fill="none" strokeLinecap="round" />
      {[-70, -30, 10, 50, 100, 150].map((a) => (
        <path key={a} d="M0 0 C 20 -10, 46 -8, 60 6 C 40 2, 18 4, 0 0 Z" fill="#2f7d32" transform={`translate(4 -92) rotate(${a})`} />
      ))}
      <circle cx={4} cy={-90} r={6} fill="#5b3a12" />
    </g>
  );
}

function Rock({ gx, gy, scale = 1, fill }: { gx: number; gy: number; scale?: number; fill: string }) {
  const [x, y] = iso(gx, gy, 0);
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} aria-hidden>
      <polygon points="-34,8 -20,-18 6,-26 30,-12 36,6 14,16 -14,16" fill={fill} stroke="rgba(28,25,23,0.3)" />
      <polygon points="-20,-18 6,-26 30,-12 2,-6" fill="rgba(255,255,255,0.22)" />
    </g>
  );
}

function SkyDetail() {
  return (
    <g aria-hidden>
      <circle cx={1330} cy={120} r={46} fill="#fff4c2" opacity={0.95} />
      <circle cx={1330} cy={120} r={78} fill="#fff4c2" opacity={0.25} />
      {[[220, 150, 1], [560, 90, 0.8], [1010, 170, 0.9]].map(([x, y, k], i) => (
        <g key={i} transform={`translate(${x} ${y}) scale(${k})`} opacity={0.9}>
          <ellipse cx={0} cy={0} rx={70} ry={24} fill="#ffffff" />
          <ellipse cx={-38} cy={6} rx={40} ry={18} fill="#ffffff" />
          <ellipse cx={42} cy={8} rx={46} ry={20} fill="#ffffff" />
          <ellipse cx={10} cy={-14} rx={38} ry={22} fill="#ffffff" />
        </g>
      ))}
      <g stroke="#1c1917" strokeWidth={2.5} fill="none" strokeLinecap="round" opacity={0.5}>
        <path d="M700 210 q 10 -10 20 0 q 10 -10 20 0" />
        <path d="M740 240 q 10 -10 20 0 q 10 -10 20 0" />
      </g>
    </g>
  );
}

function LowerBand({ location, p }: { location: string | null; p: Palette }) {
  return (
    <g aria-hidden>
      <rect x={0} y={360} width={1600} height={540} fill={p.sea ? (location === "ice" ? "#a7d3e9" : "#4fb6e6") : p.plateDeep} opacity={p.sea ? 1 : 0.55} />
      {p.sea ? (
        <>
          <rect x={0} y={360} width={1600} height={540} fill="url(#seaDepth)" />
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <path key={i} d={`M${60 + i * 240} ${720 + (i % 2) * 60} q 30 -14 60 0 t 60 0`} stroke="#ffffff" strokeWidth={3} fill="none" opacity={0.55} />
          ))}
        </>
      ) : (
        [0, 1, 2, 3, 4].map((i) => <ellipse key={i} cx={200 + i * 320} cy={760 + (i % 2) * 50} rx={120} ry={18} fill={p.plateSide} opacity={0.35} />)
      )}
    </g>
  );
}

function FarScenery({ location, p }: { location: string | null; p: Palette }) {
  switch (location) {
    case "crater":
      return (
        <g aria-hidden>
          <polygon points="420,400 700,160 820,210 1000,140 1250,400" fill={p.far} />
          <polygon points="700,160 760,180 820,210 790,178" fill={p.farDetail} opacity={0.8} />
          <ellipse cx={800} cy={130} rx={90} ry={22} fill="#fde68a" opacity={0.45} />
        </g>
      );
    case "ice":
      return (
        <g aria-hidden>
          <polygon points="380,400 520,230 640,310 760,190 900,300 1040,210 1180,320 1300,400" fill={p.far} />
          <polygon points="520,230 560,280 480,280" fill={p.farDetail} />
          <polygon points="760,190 800,260 720,260" fill={p.farDetail} />
        </g>
      );
    case "forest":
      return (
        <g aria-hidden>
          <polygon points="360,400 600,240 840,310 1080,220 1320,400" fill={p.far} />
          {[460, 540, 620, 700, 980, 1060, 1140, 1220].map((x, i) => (
            <polygon key={x} points={`${x},${280 + (i % 2) * 18} ${x + 26},${352} ${x - 26},${352}`} fill={p.farDetail} opacity={0.9} />
          ))}
        </g>
      );
    case "shore":
      return (
        <g aria-hidden>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <path key={i} d={`M${120 + i * 260} 420 q 30 -12 60 0 t 60 0`} stroke={p.farDetail} strokeWidth={3} fill="none" opacity={0.7} />
          ))}
          <ellipse cx={1320} cy={345} rx={120} ry={16} fill="#f0dba7" />
        </g>
      );
    default:
      return null;
  }
}

/** The island: a wide plate with a headland and a bay, a beach ring and three zones (base plateau, garden terrace, station ground). */
function Island({ location, p }: { location: string | null; p: Palette }) {
  const R = 4.6;
  return (
    <g aria-hidden>
      {/* underwater shelf and the plate's sides */}
      <ellipse cx={ORIGIN.x} cy={ORIGIN.y + 150} rx={700} ry={210} fill="#1c1917" opacity={0.12} />
      <Box x={-R - 0.3} y={-R - 0.3} w={2 * R + 0.6} h={2 * R + 0.6} height={16} z={-54} top={p.plateDeep} left={p.plateDeep} right={p.plateDeep} stroke="rgba(0,0,0,0.12)" />
      <Box x={-R} y={-R} w={2 * R} h={2 * R} height={22} z={-36} top={p.plateSide} left={p.plateDeep} right={p.plateDeep} stroke="rgba(0,0,0,0.12)" />
      {/* headland (NW) and the main plate; the bay is the lighter water cut at the SE */}
      <Box x={-R - 1.6} y={-2.6} w={2.4} h={2.0} height={20} z={-16} top={p.beach} left={p.plateSide} right={p.plateDeep} stroke="rgba(0,0,0,0.14)" />
      <Box x={-R + 0.4} y={-R + 0.4} w={2 * R - 0.8} h={2 * R - 0.8} height={20} z={-16} top={p.beach} left={p.plateSide} right={p.plateDeep} stroke="rgba(0,0,0,0.14)" />
      {p.sea ? <polygon points={tile(1.3, 1.6, 2.9, 2.9, 4.5)} fill="#9fd9f3" opacity={0.85} /> : null}
      {p.sea ? <polygon points={tile(1.6, 1.9, 2.3, 2.3, 5)} fill="#5cc3ef" opacity={0.8} /> : null}
      {/* zones */}
      <polygon points={tile(-3.9, -3.9, 3.6, 3.4, 5)} fill={p.grass} opacity={location === "crater" ? 0.5 : 0.85} />
      <polygon points={tile(0.4, -3.9, 3.4, 3.0, 5)} fill={p.soil} opacity={0.35} />
      <polygon points={tile(-3.6, 0.2, 3.4, 3.4, 5)} fill={p.beach} opacity={0.9} />
      {/* beach edge lines */}
      <polygon points={tile(-R + 0.4, -R + 0.4, 2 * R - 0.8, 2 * R - 0.8, 5.5)} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={3} />
      {location === "shore" ? (
        <>
          <Palm gx={-4.1} gy={1.0} />
          <Palm gx={-3.2} gy={3.2} scale={0.85} />
          <Palm gx={3.6} gy={-3.9} scale={0.9} />
          <Rock gx={3.4} gy={0.0} fill={p.rock} />
          <Rock gx={3.9} gy={0.6} scale={0.7} fill={p.rock} />
        </>
      ) : null}
      {location === "forest" ? (
        <>
          {[[-4.0, 0.8], [-3.6, 2.6], [3.6, -3.8], [3.9, 0.4], [-1.2, 3.8]].map(([gx, gy], i) => {
            const [x, y] = iso(gx, gy, 0);
            return (
              <g key={i} transform={`translate(${x} ${y})`}>
                <line x1={0} y1={0} x2={0} y2={-30} stroke="#5b3a12" strokeWidth={5} />
                <polygon points="0,-78 26,-30 -26,-30" fill="#2f7d32" />
                <polygon points="0,-96 20,-56 -20,-56" fill="#3f9142" />
              </g>
            );
          })}
        </>
      ) : null}
      {location === "crater" ? (
        <>
          <polygon points={tile(-4.2, -4.2, 1.6, 1.3, 5)} fill="#2b2220" opacity={0.7} />
          <path d={`M${iso(-1.2, 2.6, 6)[0]} ${iso(-1.2, 2.6, 6)[1]} l 40 -14 l 30 10 l 36 -12`} stroke="#c2410c" strokeWidth={3} fill="none" opacity={0.8} />
          <Rock gx={3.4} gy={0.0} fill={p.rock} />
        </>
      ) : null}
      {location === "ice" ? (
        <>
          <polygon points={tile(-4.0, 1.4, 1.4, 1.6, 5)} fill="#ffffff" opacity={0.55} />
          <path d={`M${iso(1.4, -3.6, 6)[0]} ${iso(1.4, -3.6, 6)[1]} l 40 18 l -8 22`} stroke="#60a5fa" strokeWidth={2.5} fill="none" opacity={0.7} />
          <Rock gx={3.4} gy={0.0} fill={p.rock} />
        </>
      ) : null}
    </g>
  );
}

function Path({ points }: { points: [number, number][] }) {
  const d = points.map(([gx, gy], i) => `${i === 0 ? "M" : "L"}${iso(gx, gy, 6).join(" ")}`).join(" ");
  return (
    <g aria-hidden>
      <path d={d} stroke="rgba(255,247,230,0.9)" strokeWidth={10} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} stroke="#8b5a2b" strokeWidth={4} fill="none" strokeDasharray="14 12" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

const SITE_BASE: [number, number] = [-3.0, -3.2];
const SITE_GARDEN: [number, number] = [1.2, -3.3];
const SITE_STATION: Record<string, [number, number]> = { beach: [-2.2, 1.6], rocks: [3.0, -0.6], dune: [-0.2, 2.6] };

export function ExpeditionWorld({ scene, markers, pages, variant = "full", onSelectMarker, onOpenLogbook, onOpenSupplies, description, className, children }: ExpeditionWorldProps) {
  const p = PALETTES[scene.location ?? "none"] ?? PALETTES.none;
  const garden = scene.beds.filter((b) => b.id.startsWith("garden"));
  const stationBeds = scene.beds.filter((b) => b.id.startsWith("station"));
  const stationSpot = scene.station.spot && SITE_STATION[scene.station.spot] ? scene.station.spot : "beach";
  const stationSite = SITE_STATION[stationSpot];
  const text = description ?? describeWorld(scene, markers, pages);
  const viewBox = variant === "strip" ? "160 120 1280 500" : "0 0 1600 900";
  const byVisit = (id: string) => markers.find((m) => m.visit === id) ?? null;
  const m1 = byVisit("v1");
  const m2 = byVisit("v2");
  const m4 = byVisit("v4");
  const [baseX, baseY] = SITE_BASE;
  const hasBase = Boolean(scene.name);
  const kinds = supplyRows(scene).length;

  return (
    <div className={cn("relative h-full w-full overflow-hidden", className)} data-world-variant={variant} data-world-base={scene.base} data-world-station={scene.station.built ? "built" : "none"} data-world-lamp={scene.station.lamp ? "on" : "off"} data-world-beds={scene.beds.length} data-world-pages={pages}>
      <svg viewBox={viewBox} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full select-none" role="img" aria-label={text} focusable="false">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={p.skyTop} />
            <stop offset="1" stopColor={p.skyBottom} />
          </linearGradient>
          <radialGradient id="lampGlow">
            <stop offset="0" stopColor="#fde68a" stopOpacity={0.95} />
            <stop offset="1" stopColor="#fde68a" stopOpacity={0} />
          </radialGradient>
          <linearGradient id="lampCone" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fde68a" stopOpacity={0.55} />
            <stop offset="1" stopColor="#fde68a" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="seaDepth" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0b6fa8" stopOpacity={0} />
            <stop offset="1" stopColor="#0b6fa8" stopOpacity={0.35} />
          </linearGradient>
          <style>{`
            .world-pulse { transform-box: fill-box; transform-origin: center; animation: world-pulse 2.4s ease-in-out infinite; }
            @keyframes world-pulse { 0%, 100% { transform: scale(1); opacity: 0.9; } 50% { transform: scale(1.12); opacity: 0.5; } }
            @media (prefers-reduced-motion: reduce) { .world-pulse { animation: none; } }
          `}</style>
        </defs>
        <rect x={0} y={0} width={1600} height={900} fill="url(#sky)" />
        <SkyDetail />
        <LowerBand location={scene.location} p={p} />
        <FarScenery location={scene.location} p={p} />
        <Island location={scene.location} p={p} />

        {/* route: base → garden, base → station */}
        <Path points={[[baseX + 0.9, baseY + 1.9], [-0.4, -0.4], [SITE_GARDEN[0] + 0.4, SITE_GARDEN[1] + 2.3]]} />
        <Path points={[[-0.4, -0.4], [stationSite[0] + 0.6, stationSite[1] - 0.3]]} />

        {/* the one supply store, behind the base */}
        {hasBase && kinds > 0 ? <Store gx={baseX + 2.1} gy={baseY - 1.0} kinds={kinds} onOpen={onOpenSupplies} /> : null}

        {/* site 1: the base */}
        {!hasBase ? <polygon points={tile(baseX, baseY, 1.6, 1.6, 6)} fill="rgba(255,247,230,0.55)" stroke="#8b5a2b" strokeWidth={2} strokeDasharray="8 8" /> : scene.base === "tent" ? <Tent gx={baseX} gy={baseY} /> : <Hut gx={baseX} gy={baseY} name={scene.name} />}
        {hasBase ? <Logbook gx={baseX - 0.7} gy={baseY + 2.4} pages={pages} onOpen={onOpenLogbook} /> : null}

        {/* site 2: the garden (EQ-RETURN) */}
        {garden.length ? (
          <g data-part="garden">
            {garden.map((b, i) => (
              <Bed key={b.id} gx={SITE_GARDEN[0] + (i % 2) * 1.1} gy={SITE_GARDEN[1] + Math.floor(i / 2) * 1.1} filled={b.filled} capacity={b.capacity} />
            ))}
          </g>
        ) : (
          <polygon points={tile(SITE_GARDEN[0], SITE_GARDEN[1], 2.2, 2.2, 6)} fill="rgba(255,247,230,0.35)" stroke="#8b5a2b" strokeWidth={2} strokeDasharray="8 8" />
        )}

        {/* site 3: the observation station (EQ-STATION beds + build) */}
        {stationBeds.length ? (
          <g data-part="station-beds">
            {stationBeds.map((b, i) => (
              <Bed key={b.id} gx={stationSite[0] - 1.6 + i * 0.66} gy={stationSite[1] + 1.4 - i * 0.1} filled={b.filled} capacity={b.capacity} dark />
            ))}
            {scene.leftovers > 0 ? (
              <g data-part="leftovers">
                {Array.from({ length: Math.min(scene.leftovers, 6) }).map((_, i) => {
                  const [x, y] = iso(stationSite[0] + 1.9 + (i % 3) * 0.22, stationSite[1] + 1.6 + Math.floor(i / 3) * 0.3, 4);
                  return <Sprout key={i} x={x} y={y} scale={0.8} />;
                })}
                <text x={iso(stationSite[0] + 2.1, stationSite[1] + 1.75, 0)[0] + 26} y={iso(stationSite[0] + 2.1, stationSite[1] + 1.75, 0)[1] + 8} textAnchor="start" fontSize={13} fontWeight={600} fill="#3b2a12" fontFamily="var(--font-geist-sans), Arial, sans-serif">
                  {scene.leftovers} übrig
                </text>
              </g>
            ) : null}
          </g>
        ) : null}
        {scene.station.built ? <Station gx={stationSite[0]} gy={stationSite[1]} lamp={scene.station.lamp} theme={scene.station.theme} /> : <polygon points={tile(stationSite[0], stationSite[1], 1.2, 1.2, 6)} fill="rgba(255,247,230,0.35)" stroke="#64748b" strokeWidth={2} strokeDasharray="8 8" />}

        {/* flags: the true state of each visit site */}
        {m1 ? <Flag gx={baseX + 2.3} gy={baseY + 2.4} marker={m1} onSelect={onSelectMarker} /> : null}
        {m2 ? <Flag gx={SITE_GARDEN[0] + 2.6} gy={SITE_GARDEN[1] + 1.6} marker={m2} onSelect={onSelectMarker} /> : null}
        {m4 ? <Flag gx={stationSite[0] + 1.9} gy={stationSite[1] + 0.1} marker={m4} onSelect={onSelectMarker} /> : null}
      </svg>
      {children}
    </div>
  );
}
