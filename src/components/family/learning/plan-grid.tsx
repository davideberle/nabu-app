"use client";

// ---------------------------------------------------------------------------
// Visit 8 (content v7) — an exact floor plan on a grid of equal fields. Every count a child can read off the picture comes
// from the reviewed cells (`gridCounts`), never from art: `.` empty floor, `W` path, a letter = one bed. The door is drawn
// where the content says; one field carries the "1 m" ruler so the measurement idea stays visible.
// ---------------------------------------------------------------------------

import { gridCounts, type MissionGrid } from "@/lib/family-learning-mission-spec";

const FIELD = 44;
const SOIL = "#e9d9b8";
const PATH = "#b8b1a5";
const BED = "#8cc56f";
const BED_EDGE = "#3f7a3a";
const LINE = "#8a7350";

export function PlanGrid({ grid, caption, highlight }: { grid: MissionGrid; caption?: string; highlight?: boolean }) {
  const counts = gridCounts(grid);
  const cells = grid.cells.map((row) => Array.from(row));
  const w = grid.cols * FIELD;
  const h = grid.rows * FIELD;
  const pad = 22;
  const aria = `${grid.label}: ${grid.cols} Felder lang, ${grid.rows} Felder breit, zusammen ${counts.fields} Felder${counts.path ? `; Weg ${counts.path} Felder` : ""}${counts.beds ? `; ${counts.beds} Beete mit zusammen ${counts.bedFields} Feldern` : ""}.`;
  const bedEdges: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let r = 0; r < grid.rows; r += 1) {
    for (let c = 0; c < grid.cols; c += 1) {
      const v = cells[r][c];
      if (v === "." || v === "W") continue;
      const x = c * FIELD;
      const y = r * FIELD;
      if (cells[r - 1]?.[c] !== v) bedEdges.push({ x1: x, y1: y, x2: x + FIELD, y2: y });
      if (cells[r + 1]?.[c] !== v) bedEdges.push({ x1: x, y1: y + FIELD, x2: x + FIELD, y2: y + FIELD });
      if (cells[r][c - 1] !== v) bedEdges.push({ x1: x, y1: y, x2: x, y2: y + FIELD });
      if (cells[r][c + 1] !== v) bedEdges.push({ x1: x + FIELD, y1: y, x2: x + FIELD, y2: y + FIELD });
    }
  }
  const door = grid.door ?? null;
  const doorRect = door
    ? door.side === "left"
      ? { x: -8, y: door.index * FIELD + 6, w: 8, h: FIELD - 12 }
      : door.side === "right"
        ? { x: w, y: door.index * FIELD + 6, w: 8, h: FIELD - 12 }
        : door.side === "top"
          ? { x: door.index * FIELD + 6, y: -8, w: FIELD - 12, h: 8 }
          : { x: door.index * FIELD + 6, y: h, w: FIELD - 12, h: 8 }
    : null;
  return (
    <figure className="grid gap-2" data-testid="plan-grid" data-label={grid.label} data-fields={counts.fields} data-path={counts.path} data-beds={counts.beds} data-bed-fields={counts.bedFields} data-highlight={highlight ? "true" : "false"}>
      <figcaption className="text-base font-semibold">{caption ?? grid.label}</figcaption>
      <svg role="img" aria-label={aria} viewBox={`${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}`} className="h-auto w-full max-w-[420px]" style={{ outline: highlight ? "4px solid #f59e0b" : undefined, borderRadius: 12 }}>
        {cells.map((row, r) =>
          row.map((v, c) => (
            <rect key={`${r}-${c}`} x={c * FIELD} y={r * FIELD} width={FIELD} height={FIELD} fill={v === "W" ? PATH : v === "." ? SOIL : BED} stroke={LINE} strokeWidth={1} strokeOpacity={0.6} />
          )),
        )}
        {bedEdges.map((e, i) => (
          <line key={i} {...e} stroke={BED_EDGE} strokeWidth={3} strokeLinecap="round" />
        ))}
        <rect x={0} y={0} width={w} height={h} fill="none" stroke="#5a4426" strokeWidth={3} />
        {doorRect ? <rect x={doorRect.x} y={doorRect.y} width={doorRect.w} height={doorRect.h} fill="#6b4423" data-part="door" /> : null}
        {door ? (
          <text x={door.side === "left" ? -12 : door.side === "right" ? w + 12 : doorRect!.x + doorRect!.w / 2} y={door.side === "left" || door.side === "right" ? doorRect!.y + doorRect!.h / 2 + 4 : door.side === "top" ? -12 : h + 18} fontSize={11} textAnchor={door.side === "left" ? "end" : door.side === "right" ? "start" : "middle"} fill="#5a4426" fontWeight={700}>
            Tür
          </text>
        ) : null}
        {/* the measurement idea: one field is 1 m long and 1 m wide */}
        <g aria-hidden>
          <line x1={0} y1={-8} x2={FIELD} y2={-8} stroke="#5a4426" strokeWidth={2} />
          <line x1={0} y1={-12} x2={0} y2={-4} stroke="#5a4426" strokeWidth={2} />
          <line x1={FIELD} y1={-12} x2={FIELD} y2={-4} stroke="#5a4426" strokeWidth={2} />
          <text x={FIELD / 2} y={-13} fontSize={11} textAnchor="middle" fill="#5a4426" fontWeight={700}>
            {grid.fieldMeters} m
          </text>
        </g>
      </svg>
      {counts.path ? (
        <p className="flex flex-wrap gap-3 text-sm" aria-hidden>
          <span><span className="mr-1 inline-block h-3 w-3 rounded-sm align-middle" style={{ background: PATH }} />Weg</span>
          <span><span className="mr-1 inline-block h-3 w-3 rounded-sm align-middle" style={{ background: BED, outline: `2px solid ${BED_EDGE}` }} />Beet</span>
        </p>
      ) : null}
    </figure>
  );
}
