"use client";

// The live world changes of a reviewed mission (Visit 6), drawn on the 1600 × 900 island stage: painted plates where the
// art exists (crates, boats), small live marks otherwise (radio signal, rope coils, the planned route). Shared by the
// walkable mission and the hub island, so a change seen during the mission stays on the island afterwards.

import { plateFor, type PlateId } from "./harbor-island-plates";

type Pt = { x: number; y: number };
const PARCHMENT = "#fff8e8";
const INK = "#2b2118";
const SIGNAL = "#f59e0b";

export type MissionWorldChange = { id: string; prop: string; place: string; count: number; label: string };

/** Ground points of the mission places (the reviewed map of MISSION-SHIP-SUPPLY uses the island nodes). */
export const DEFAULT_MISSION_POS: Record<string, Pt> = { harbor: { x: 760, y: 700 }, workshop: { x: 582, y: 413 }, office: { x: 1004, y: 369 }, shop: { x: 639, y: 640 }, harbormaster: { x: 872, y: 571 }, pier: { x: 1074, y: 562 }, base: { x: 459, y: 300 } };

// ---------------------------------------------------------------------------
// World changes of the mission (live overlay, plates where painted art exists)
// ---------------------------------------------------------------------------

function PlateImg({ id, x, y, width, height, opacity }: { id: PlateId; x: number; y: number; width: number; height: number; opacity?: number }) {
  const p = plateFor(id);
  if (!p) return <rect x={x} y={y} width={width} height={height} rx={6} fill="#a16207" stroke={INK} strokeWidth={2} opacity={opacity} />;
  return <image href={p.href} x={x} y={y} width={width} height={height} opacity={opacity} preserveAspectRatio="xMidYMax meet" />;
}

function Boat({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <PlateImg id="boat-hull" x={-60} y={-26} width={120} height={52} />
      <PlateImg id="boat-sail" x={-24} y={-92} width={60} height={66} />
    </g>
  );
}

export function MissionWorldChanges({ world, pos, testId = "mission-world-changes" }: { world: MissionWorldChange[]; pos: Record<string, Pt>; testId?: string }) {
  const has = (prop: string) => world.find((w) => w.prop === prop);
  const crates = has("crates");
  const tools = has("tool-crates");
  const boats = has("boats");
  const roped = world.find((w) => w.prop === "ropes" && w.place === "pier");
  const ropesShop = world.find((w) => w.prop === "ropes" && w.place === "shop");
  const route = has("route");
  const sail = has("sail");
  const radio = has("radio");
  const quay = pos.harbor;
  const pier = pos.pier;
  const shop = pos.shop;
  const ws = pos.workshop;
  const moor = [
    { x: pier.x + 110, y: pier.y + 70 },
    { x: pier.x + 230, y: pier.y + 92 },
  ];
  return (
    <g data-part="mission-world" data-testid={testId} data-changes={world.map((w) => w.id).join(",")}>
      {radio ? (
        <g transform={`translate(${ws.x + 46} ${ws.y - 150})`} data-part="radio" aria-hidden>
          <line x1={0} y1={0} x2={0} y2={-48} stroke={INK} strokeWidth={4} />
          <circle cy={-52} r={6} fill={SIGNAL} />
          {[16, 28, 40].map((r) => (
            <path key={r} d={`M ${-r} ${-52 - r * 0.6} A ${r} ${r} 0 0 1 ${r} ${-52 - r * 0.6}`} fill="none" stroke={SIGNAL} strokeWidth={3} opacity={0.8} />
          ))}
        </g>
      ) : null}
      {crates && !boats
        ? Array.from({ length: crates.count }, (_, i) => <PlateImg key={`c${i}`} id="crate" x={quay.x - 120 + (i % 3) * 44} y={quay.y - 40 - Math.floor(i / 3) * 34} width={44} height={40} />)
        : null}
      {tools && !boats
        ? Array.from({ length: tools.count }, (_, i) => (
            <g key={`t${i}`}>
              <PlateImg id="crate" x={quay.x + 30 + i * 44} y={quay.y - 40} width={44} height={40} />
              <text x={quay.x + 52 + i * 44} y={quay.y - 46} textAnchor="middle" fontSize={20} aria-hidden>
                🔧
              </text>
            </g>
          ))
        : null}
      {ropesShop ? (
        <g transform={`translate(${shop.x + 70} ${shop.y - 10})`} data-part="rope-coils" aria-hidden>
          {Array.from({ length: Math.min(ropesShop.count, 5) }, (_, i) => (
            <g key={i} transform={`translate(${i * 16} ${-(i % 2) * 8})`}>
              <ellipse rx={13} ry={8} fill="none" stroke="#b45309" strokeWidth={5} />
              <ellipse rx={6} ry={3.5} fill="none" stroke="#b45309" strokeWidth={4} />
            </g>
          ))}
        </g>
      ) : null}
      {route ? <path d={`M ${pier.x + 160} ${pier.y + 60} C ${pier.x + 120} ${pier.y - 220}, 880 260, 690 150`} fill="none" stroke={PARCHMENT} strokeWidth={6} strokeDasharray="14 12" strokeLinecap="round" opacity={0.9} data-part="route" /> : null}
      {boats && !sail
        ? moor.map((b, i) => (
            <g key={`b${i}`} data-part="mission-boat">
              <Boat x={b.x} y={b.y} />
              {roped ? <line x1={b.x - 50} y1={b.y - 8} x2={pier.x + 20 + i * 40} y2={pier.y + 8} stroke="#b45309" strokeWidth={4} /> : null}
            </g>
          ))
        : null}
      {sail ? (
        // Launched: the two boats are out on the planned route, close to the research ship on the horizon (small = far away).
        <g data-part="sailing">
          {[
            { x: 760, y: 214 },
            { x: 830, y: 236 },
          ].map((b, i) => (
            <g key={i} transform={`translate(${b.x} ${b.y}) scale(0.42)`}>
              <Boat x={0} y={0} />
            </g>
          ))}
        </g>
      ) : null}
    </g>
  );
}

