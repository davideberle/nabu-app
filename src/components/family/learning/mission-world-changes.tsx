"use client";

// The live world changes of a reviewed mission (Visit 6), drawn on the 1600 × 900 island stage: painted plates where the
// art exists (crates, boats), small live marks otherwise (radio signal, rope coils, the planned route). Shared by the
// walkable mission and the hub island, so a change seen during the mission stays on the island afterwards.

import { plateFor, type PlateId } from "./harbor-island-plates";

type Pt = { x: number; y: number };
const PARCHMENT = "#fff8e8";
const INK = "#2b2118";

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
  // Only what the painted set can show is drawn: crates and boats (painted plates) and the planned route as a map annotation in
  // the same style as the walking-path marks. Changes without painted art (radio message, ropes, what is inside a crate) are
  // told in words by the surfaces (place chips, notebook, report) — never drawn as an icon pretending to be world art.
  const has = (prop: string) => world.find((w) => w.prop === prop);
  const crates = has("crates");
  const tools = has("tool-crates");
  const boats = has("boats");
  const route = has("route");
  const sail = has("sail");
  // Content v7: crates stand where the mission put them (Visit 8: at Rosa's shop); earlier missions keep the quay.
  const quay = (crates && pos[crates.place]) || pos.harbor || { x: 760, y: 700 };
  const pier = pos.pier ?? null;
  const moor = pier
    ? [
        { x: pier.x + 110, y: pier.y + 70 },
        { x: pier.x + 230, y: pier.y + 92 },
      ]
    : [];
  const onQuay = (crates?.count ?? 0) + (tools?.count ?? 0);
  // Content v7: the child's own plan as painted beds beside the greenhouse, and the placed plants (painted seedling plates).
  const beds = has("beds");
  const seedlings = has("seedlings");
  const bedAt = beds ? pos[beds.place] : null;
  return (
    <g data-part="mission-world" data-testid={testId} data-changes={world.map((w) => w.id).join(",")} aria-hidden>
      {onQuay && !boats
        ? Array.from({ length: onQuay }, (_, i) => <PlateImg key={`c${i}`} id="crate" x={quay.x - 150 + (i % 4) * 46} y={quay.y - 44 - Math.floor(i / 4) * 34} width={46} height={42} />)
        : null}
      {bedAt && beds
        ? Array.from({ length: Math.min(beds.count, 6) }, (_, i) => <PlateImg key={`bed${i}`} id="garden-bed" x={bedAt.x - 150 + (i % 3) * 62} y={bedAt.y + 18 + Math.floor(i / 3) * 40} width={64} height={44} />)
        : null}
      {bedAt && seedlings
        ? Array.from({ length: Math.min(seedlings.count, 4) }, (_, i) => <PlateImg key={`sd${i}`} id="seedling" x={bedAt.x - 132 + i * 44} y={bedAt.y + 6} width={30} height={29} />)
        : null}
      {route && pier ? <path d={`M ${pier.x + 160} ${pier.y + 60} C ${pier.x + 120} ${pier.y - 220}, 880 260, 690 150`} fill="none" stroke={PARCHMENT} strokeWidth={6} strokeDasharray="2 14" strokeLinecap="round" opacity={0.85} data-part="route" /> : null}
      {boats && !sail
        ? moor.map((b, i) => (
            <g key={`b${i}`} data-part="mission-boat">
              <Boat x={b.x} y={b.y} />
              {[0, 1].map((k) => (
                <PlateImg key={k} id="crate" x={b.x - 40 + k * 30} y={b.y - 46} width={30} height={28} />
              ))}
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
