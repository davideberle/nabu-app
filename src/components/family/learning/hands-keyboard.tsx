"use client";

// ---------------------------------------------------------------------------
// Visible hands and keys (world-first learner experience, 2026-10-03; UX-4;
// visual round 1 V2).
//
// An original SVG of the confirmed Swiss-German QWERTZ keyboard with both
// hands resting below it: left a/s/d/f, right j/k/l/ö, the index fingers on
// the f/j bumps, the thumbs on the space bar. The NEXT key and the finger that
// types it are highlighted with the same cue — a bold outline, a fingertip
// dot and a connecting guide line — so the pairing never relies on colour
// alone. Reaches (g from f, h from j, ä from ö) are drawn as an out-and-back
// arrow. Finger names come from the reviewed content (`fingers`), never from a
// guess; keys the content does not assign stay neutral. Two sizes: the LARGE
// diagram for the first-use placement demonstration, replay and worked
// examples; the COMPACT cue (letter rows, space bar, short hands) for routine
// practice so prompt, input, cue and controls fit a 900 px desktop viewport.
// The placement demonstration is a short stepped sequence (no autoplay),
// replayable, keyboard-operable, with no motion under reduced motion. This
// diagram teaches placement; the app records text accuracy only and never
// claims which finger the child actually used.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { cn } from "@/components/ui/nabu";
import { focusRing, primaryButton, secondaryButton } from "@/app/family/(shell)/learn/mission/styles";

export type HomePosition = { left: string[]; right: string[]; anchors: string[]; thumb: string };

export type FingerId = "L5" | "L4" | "L3" | "L2" | "L1" | "R1" | "R2" | "R3" | "R4" | "R5";

/** Parse a reviewed finger name ("Zeigefinger links", "Daumen") into a hand/finger id; null when unknown. */
/** The home key an index/little finger leaves for a short reach (g from f, h from j, ä from ö) — and returns to. */
export function reachOriginOf(key: string | null | undefined): "f" | "j" | "ö" | null {
  return key === "g" ? "f" : key === "h" ? "j" : key === "ä" ? "ö" : null;
}

export function fingerIdOf(name: string | null | undefined): FingerId | null {
  if (!name) return null;
  const n = name.toLowerCase();
  if (n.startsWith("daumen")) return n.includes("links") ? "L1" : "R1";
  const side = n.includes("links") ? "L" : n.includes("rechts") ? "R" : null;
  if (!side) return null;
  if (n.includes("klein")) return `${side}5` as FingerId;
  if (n.includes("ring")) return `${side}4` as FingerId;
  if (n.includes("mittel")) return `${side}3` as FingerId;
  if (n.includes("zeige")) return `${side}2` as FingerId;
  return null;
}

const FINGER_SHORT: Record<FingerId, string> = { L5: "klein", L4: "Ring", L3: "Mittel", L2: "Zeige", L1: "Daumen", R1: "Daumen", R2: "Zeige", R3: "Mittel", R4: "Ring", R5: "klein" };
const HOME_FINGERS: FingerId[] = ["L5", "L4", "L3", "L2", "R2", "R3", "R4", "R5"];

// Physical Swiss-German layout (letters, the keys the content names, the alignment-check keys).
const ROWS: { keys: string[]; offset: number }[] = [
  { keys: ["§", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "'", "^"], offset: 0 },
  { keys: ["q", "w", "e", "r", "t", "z", "u", "i", "o", "p", "ü", "¨"], offset: 0.5 },
  { keys: ["a", "s", "d", "f", "g", "h", "j", "k", "l", "ö", "ä", "$"], offset: 0.8 },
  { keys: ["y", "x", "c", "v", "b", "n", "m", ",", ".", "-"], offset: 1.3 },
];
const KEY = 58;
const GAP = 7;
const PAD = 20;
const KEY_ROW_Y = (row: number) => PAD + row * (KEY + GAP);
const SPACE_ROW = 4;
const SPACE_FROM = 3.3; // key columns the space bar spans
const SPACE_TO = 9.2;
const VIEW_W = 13 * (KEY + GAP) + PAD * 2 + 20;
const BOARD_BOTTOM = KEY_ROW_Y(SPACE_ROW) + KEY + PAD - 8;
const HANDS_TOP = KEY_ROW_Y(SPACE_ROW) + KEY + 10;

type Metrics = { palmDy: number; palmRx: number; palmRy: number; fingerW: number; thumbW: number; labelDy: number; badgeDy: number; viewH: number; compactTop: number };
// viewH leaves room for the finger badge (palm + badgeDy + 14) and, in the large mode, the demo caption below the hand labels.
const LARGE: Metrics = { palmDy: 128, palmRx: 78, palmRy: 62, fingerW: 30, thumbW: 32, labelDy: 90, badgeDy: 104, viewH: HANDS_TOP + 300, compactTop: 0 };
const COMPACT: Metrics = { palmDy: 74, palmRx: 54, palmRy: 36, fingerW: 22, thumbW: 24, labelDy: 50, badgeDy: 62, viewH: HANDS_TOP + 168, compactTop: KEY_ROW_Y(1) - 8 };

function keyCenter(key: string): { x: number; y: number } | null {
  if (key === " ") return { x: PAD + ((SPACE_FROM + SPACE_TO) / 2) * (KEY + GAP), y: KEY_ROW_Y(SPACE_ROW) + KEY / 2 };
  for (let r = 0; r < ROWS.length; r += 1) {
    const i = ROWS[r].keys.indexOf(key);
    if (i >= 0) return { x: PAD + (ROWS[r].offset + i) * (KEY + GAP) + KEY / 2, y: KEY_ROW_Y(r) + KEY / 2 };
  }
  return null;
}

/** Where each fingertip rests at home position (the key centres of a s d f / j k l ö and the space bar). */
function homeFingertips(home: HomePosition): Record<FingerId, { x: number; y: number }> {
  const at = (k: string) => {
    const c = keyCenter(k) ?? { x: VIEW_W / 2, y: KEY_ROW_Y(2) + KEY / 2 };
    return { x: c.x, y: c.y + KEY / 2 + 8 };
  };
  const [la, ls, ld, lf] = [home.left[0] ?? "a", home.left[1] ?? "s", home.left[2] ?? "d", home.left[3] ?? "f"];
  const [rj, rk, rl, ro] = [home.right[0] ?? "j", home.right[1] ?? "k", home.right[2] ?? "l", home.right[3] ?? "ö"];
  const space = keyCenter(" ")!;
  return {
    L5: at(la), L4: at(ls), L3: at(ld), L2: at(lf),
    L1: { x: space.x - 95, y: space.y + KEY / 2 + 4 },
    R1: { x: space.x + 95, y: space.y + KEY / 2 + 4 },
    R2: at(rj), R3: at(rk), R4: at(rl), R5: at(ro),
  };
}

function Hand({ side, tips, active, label, reachTo, m }: { side: "L" | "R"; tips: Record<FingerId, { x: number; y: number }>; active: Set<FingerId>; label: string | null; reachTo: { finger: FingerId; x: number; y: number } | null; m: Metrics }) {
  const ids: FingerId[] = side === "L" ? ["L5", "L4", "L3", "L2"] : ["R2", "R3", "R4", "R5"];
  const thumb: FingerId = side === "L" ? "L1" : "R1";
  const xs = ids.map((id) => tips[id].x);
  const palmX = (Math.min(...xs) + Math.max(...xs)) / 2 + (side === "L" ? 10 : -10);
  const palmY = HANDS_TOP + m.palmDy;
  const skin = "#f1c9a5";
  const skinDark = "#d9a77c";
  const finger = (id: FingerId, w: number) => {
    const tip = tips[id];
    const isActive = active.has(id);
    const targetTip = isActive && reachTo && reachTo.finger === id ? reachTo : tip;
    const baseX = palmX + (tip.x - palmX) * 0.55;
    const baseY = palmY - m.palmRy * 0.45;
    const len = Math.hypot(targetTip.x - baseX, targetTip.y - baseY);
    const angle = (Math.atan2(targetTip.y - baseY, targetTip.x - baseX) * 180) / Math.PI;
    return (
      <g key={id} data-finger={id} data-active={isActive ? "true" : undefined}>
        <g transform={`translate(${baseX} ${baseY}) rotate(${angle})`}>
          <rect x={0} y={-w / 2} width={len} height={w} rx={w / 2} fill={isActive ? "#fde68a" : skin} stroke={isActive ? "#1c1917" : skinDark} strokeWidth={isActive ? 4 : 2} />
        </g>
        {isActive ? <circle cx={targetTip.x} cy={targetTip.y} r={8} fill="#1c1917" /> : <circle cx={tip.x} cy={tip.y} r={4} fill={skinDark} opacity={0.6} />}
      </g>
    );
  };
  const t = tips[thumb];
  const thumbBaseX = palmX + (side === "L" ? m.palmRx * 0.55 : -m.palmRx * 0.55);
  const thumbBaseY = palmY + 6;
  const thumbActive = active.has(thumb);
  const tLen = Math.hypot(t.x - thumbBaseX, t.y - thumbBaseY);
  const tAngle = (Math.atan2(t.y - thumbBaseY, t.x - thumbBaseX) * 180) / Math.PI;
  const labelHere = label && [...active].some((f) => f.startsWith(side));
  return (
    <g data-hand={side}>
      <ellipse cx={palmX} cy={palmY} rx={m.palmRx} ry={m.palmRy} fill={skin} stroke={skinDark} strokeWidth={2} />
      {ids.map((id) => finger(id, m.fingerW))}
      <g transform={`translate(${thumbBaseX} ${thumbBaseY}) rotate(${tAngle})`} data-finger={thumb} data-active={thumbActive ? "true" : undefined}>
        <rect x={0} y={-m.thumbW / 2} width={tLen} height={m.thumbW} rx={m.thumbW / 2} fill={thumbActive ? "#fde68a" : skin} stroke={thumbActive ? "#1c1917" : skinDark} strokeWidth={thumbActive ? 4 : 2} />
      </g>
      {thumbActive ? <circle cx={t.x} cy={t.y} r={8} fill="#1c1917" /> : null}
      {labelHere ? (
        <g>
          <rect x={palmX - 72} y={palmY + m.badgeDy - 14} width={144} height={28} rx={14} fill="#1c1917" />
          <text x={palmX} y={palmY + m.badgeDy + 5} textAnchor="middle" fontSize={15} fontWeight={700} fill="#fff" fontFamily="var(--font-geist-sans), Arial, sans-serif">
            {label}
          </text>
        </g>
      ) : (
        <text x={palmX} y={palmY + m.labelDy} textAnchor="middle" fontSize={14} fontWeight={600} fill="#57534e" fontFamily="var(--font-geist-sans), Arial, sans-serif">
          {side === "L" ? "linke Hand" : "rechte Hand"}
        </text>
      )}
    </g>
  );
}

export type HandsKeyboardProps = {
  fingers: Record<string, string>;
  home: HomePosition;
  /** The key to type next (highlighted with its finger), or null. */
  nextKey: string | null;
  /** A key that was typed instead of `nextKey` (shown crossed, no colour-only cue). */
  wrongKey?: string | null;
  /** Keys the lesson has introduced so far (others stay quiet). */
  introduced?: string[];
  /** Demo frame override: highlight these keys and fingers regardless of nextKey. */
  highlight?: { keys: string[]; fingers: FingerId[]; caption?: string } | null;
  /** Compact cue for routine practice: letter rows + space bar + short hands. */
  compact?: boolean;
  className?: string;
  /** Short status line for assistive tech. */
  ariaLabel?: string;
};

export function HandsKeyboard({ fingers, home, nextKey, wrongKey = null, introduced = [], highlight = null, compact = false, className, ariaLabel }: HandsKeyboardProps) {
  const m = compact ? COMPACT : LARGE;
  const tips = homeFingertips(home);
  const nextFingerName = nextKey ? fingers[nextKey] ?? null : null;
  const nextFinger = highlight ? null : fingerIdOf(nextFingerName);
  const activeKeys = new Set<string>(highlight ? highlight.keys : nextKey ? [nextKey] : []);
  const activeFingers = new Set<FingerId>(highlight ? highlight.fingers : nextFinger ? [nextFinger] : []);
  const homeKeys = new Set<string>([...home.left, ...home.right]);
  const introducedSet = new Set(introduced);
  const reachFrom = nextKey && !highlight ? reachOriginOf(nextKey) : null;
  const target = nextKey ? keyCenter(nextKey) : null;
  const reachTo = reachFrom && target && nextFinger ? { finger: nextFinger, x: target.x, y: target.y + KEY / 2 + 8 } : null;
  const fingerLabel = nextFinger ? (nextFingerName ?? FINGER_SHORT[nextFinger]) : highlight?.fingers.length === 1 ? FINGER_SHORT[highlight.fingers[0]] : null;
  const label = ariaLabel ?? (nextKey ? `Nächste Taste ${nextKey === " " ? "Leertaste" : nextKey}${nextFingerName ? `, ${nextFingerName}` : ""}.` : "Tastatur mit beiden Händen in der Grundstellung.");
  const viewY = compact ? m.compactTop : 0;
  const viewH = m.viewH - viewY;
  return (
    <svg viewBox={`0 ${viewY} ${VIEW_W} ${viewH}`} className={cn("h-auto w-full select-none", className)} role="img" aria-label={label} data-testid="hands-keyboard" data-next-key={nextKey ?? ""} data-next-finger={nextFinger ?? ""} data-compact={compact ? "true" : "false"} data-reach={reachFrom ? `${reachFrom}->${nextKey}` : ""}>
      <rect x={4} y={compact ? viewY + 2 : 4} width={VIEW_W - 8} height={BOARD_BOTTOM - (compact ? viewY + 2 : 4)} rx={22} fill="#e7e5e4" stroke="#d6d3d1" />
      {ROWS.map((row, r) =>
        row.keys.map((k, i) => {
          if (compact && r === 0) return null;
          const x = PAD + (row.offset + i) * (KEY + GAP);
          const y = KEY_ROW_Y(r);
          const isHome = homeKeys.has(k);
          const isActive = activeKeys.has(k);
          const isWrong = wrongKey === k && !isActive;
          const assigned = fingers[k] ?? null;
          const quiet = r === 0 || (!isHome && !introducedSet.has(k) && !assigned && !isActive);
          const anchor = home.anchors.includes(k);
          return (
            <g key={k} data-key={k} data-active={isActive ? "true" : undefined} data-home={isHome ? "true" : undefined}>
              <rect x={x} y={y} width={KEY} height={KEY} rx={10} fill={isActive ? "#fde68a" : isHome ? "#fff7e6" : "#fafaf9"} stroke={isActive ? "#1c1917" : isWrong ? "#b91c1c" : isHome ? "#b45309" : "#d6d3d1"} strokeWidth={isActive ? 5 : isWrong ? 3 : isHome ? 2.5 : 1.5} opacity={quiet ? 0.55 : 1} />
              <text x={x + KEY / 2} y={y + KEY / 2 + 9} textAnchor="middle" fontSize={r === 0 ? 18 : 27} fontWeight={isActive || isHome ? 700 : 500} fill={quiet ? "#78716c" : "#1c1917"} fontFamily="var(--font-geist-mono), ui-monospace, monospace">
                {k}
              </text>
              {anchor ? <rect x={x + KEY / 2 - 9} y={y + 7} width={18} height={4} rx={2} fill="#1c1917" data-bump="true" /> : null}
              {isWrong ? <path d={`M${x + 10} ${y + 10} L${x + KEY - 10} ${y + KEY - 10} M${x + KEY - 10} ${y + 10} L${x + 10} ${y + KEY - 10}`} stroke="#b91c1c" strokeWidth={4} strokeLinecap="round" /> : null}
            </g>
          );
        }),
      )}
      {/* space bar */}
      {(() => {
        const x = PAD + SPACE_FROM * (KEY + GAP);
        const w = (SPACE_TO - SPACE_FROM) * (KEY + GAP) - GAP;
        const y = KEY_ROW_Y(SPACE_ROW);
        const isActive = activeKeys.has(" ");
        return (
          <g data-key=" " data-active={isActive ? "true" : undefined}>
            <rect x={x} y={y} width={w} height={KEY} rx={12} fill={isActive ? "#fde68a" : "#fff7e6"} stroke={isActive ? "#1c1917" : "#b45309"} strokeWidth={isActive ? 5 : 2.5} />
            <text x={x + w / 2} y={y + 22} textAnchor="middle" fontSize={15} fontWeight={700} fill="#1c1917" fontFamily="var(--font-geist-sans), Arial, sans-serif">
              Leertaste · Daumen
            </text>
          </g>
        );
      })()}
      {/* reach arrow (g from f, h from j, ä from ö) and the way back */}
      {reachFrom && target ? (() => {
        const from = keyCenter(reachFrom)!;
        const dir = target.x > from.x ? 1 : -1;
        return (
          <g data-reach-arrow={`${reachFrom}->${nextKey}`} aria-hidden>
            <path d={`M${from.x} ${from.y - 18} Q ${(from.x + target.x) / 2} ${from.y - 46} ${target.x - dir * 10} ${target.y - 18}`} stroke="#1c1917" strokeWidth={4} fill="none" strokeLinecap="round" />
            <polygon points={`${target.x - dir * 10},${target.y - 18} ${target.x - dir * 22},${target.y - 30} ${target.x - dir * 24},${target.y - 12}`} fill="#1c1917" />
            <path d={`M${target.x} ${target.y + 18} Q ${(from.x + target.x) / 2} ${from.y + 46} ${from.x + dir * 10} ${from.y + 18}`} stroke="#78716c" strokeWidth={3} fill="none" strokeDasharray="7 7" strokeLinecap="round" />
          </g>
        );
      })() : null}
      {/* guide line from the active fingertip to the active key */}
      {!highlight && nextFinger && target ? <line x1={reachTo ? reachTo.x : tips[nextFinger].x} y1={(reachTo ? reachTo.y : tips[nextFinger].y) - 8} x2={target.x} y2={target.y + KEY / 2} stroke="#1c1917" strokeWidth={3} strokeDasharray="6 6" aria-hidden /> : null}
      <Hand side="L" tips={tips} active={new Set([...activeFingers].filter((f) => f.startsWith("L")))} label={fingerLabel} reachTo={reachTo} m={m} />
      <Hand side="R" tips={tips} active={new Set([...activeFingers].filter((f) => f.startsWith("R")))} label={fingerLabel} reachTo={reachTo} m={m} />
      {/* The way back is drawn (dashed arrow) and named in the task's instruction line — no text inside the key field, where the moving finger would cover it. */}
      {highlight?.caption && !compact ? (
        <g>
          <rect x={VIEW_W / 2 - 230} y={m.viewH - 44} width={460} height={34} rx={17} fill="#1c1917" />
          <text x={VIEW_W / 2} y={m.viewH - 21} textAnchor="middle" fontSize={17} fontWeight={700} fill="#fff" fontFamily="var(--font-geist-sans), Arial, sans-serif">
            {highlight.caption}
          </text>
        </g>
      ) : null}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// First-use placement demonstration — short, stepped, replayable
// ---------------------------------------------------------------------------

type DemoStep = { title: string; text: string; highlight: { keys: string[]; fingers: FingerId[]; caption: string } };

export function placementDemoSteps(home: HomePosition, lessonKeys: string[]): DemoStep[] {
  const steps: DemoStep[] = [
    { title: "Beide Hände auf die Tastatur", text: `Linke Finger auf ${home.left.join(" ")}, rechte Finger auf ${home.right.join(" ")}.`, highlight: { keys: [...home.left, ...home.right], fingers: HOME_FINGERS, caption: "Grundstellung: acht Finger, acht Tasten" } },
    { title: "Zeigefinger fühlen die Noppen", text: `Auf ${home.anchors.join(" und ")} ist eine kleine Noppe. Damit findest du die Grundstellung, ohne hinzuschauen.`, highlight: { keys: home.anchors, fingers: ["L2", "R2"], caption: `Noppen auf ${home.anchors.join(" und ")}` } },
    { title: "Daumen auf die Leertaste", text: "Ein Daumen tippt die Leertaste — kurz antippen, dann liegt er wieder.", highlight: { keys: [" "], fingers: ["L1", "R1"], caption: "Leertaste mit dem Daumen" } },
  ];
  const reach = ["g", "h"].filter((k) => lessonKeys.includes(k));
  if (reach.length) steps.push({ title: "Kurze Reichweite", text: `Für ${reach.join(" und ")} rutscht der Zeigefinger kurz nach innen — und kommt gleich zurück auf ${home.anchors.join(" / ")}.`, highlight: { keys: reach, fingers: ["L2", "R2"], caption: `${reach.join(" und ")}: hin und zurück` } });
  steps.push({ title: "Langsam und genau", text: "Schau auf die Zeile, tippe Taste für Taste. Tempo zählt nicht.", highlight: { keys: [...home.left, ...home.right, " "], fingers: [...HOME_FINGERS, "L1", "R1"], caption: "Los geht's" } });
  return steps;
}

export function PlacementDemo({ fingers, home, lessonKeys, onDone, autoFocus = true }: { fingers: Record<string, string>; home: HomePosition; lessonKeys: string[]; onDone: () => void; autoFocus?: boolean }) {
  const steps = placementDemoSteps(home, lessonKeys);
  const [index, setIndex] = useState(0);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (autoFocus) nextRef.current?.focus();
  }, [autoFocus, index]);
  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;
  return (
    <div className="flex flex-col gap-3" data-testid="placement-demo" data-step={index + 1} data-steps={steps.length} role="group" aria-label="So liegen die Hände">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xl font-semibold text-primary">{step.title}</p>
        <p className="text-sm text-tertiary">
          {index + 1} / {steps.length}
        </p>
      </div>
      <p className="text-lg leading-snug text-primary">{step.text}</p>
      <div className="rounded-3xl border border-primary bg-white p-2 dark:bg-stone-900">
        <HandsKeyboard fingers={fingers} home={home} nextKey={null} highlight={step.highlight} ariaLabel={`${step.title}: ${step.text}`} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button ref={nextRef} type="button" className={primaryButton} onClick={() => (last ? onDone() : setIndex((i) => i + 1))} data-testid="demo-next">
          {last ? "Los geht's" : "Weiter"}
        </button>
        {index > 0 ? (
          <button type="button" className={secondaryButton} onClick={() => setIndex(0)} data-testid="demo-replay">
            Von vorn
          </button>
        ) : null}
        {!last ? (
          <button type="button" className={cn("inline-flex min-h-12 items-center rounded-full px-4 text-base text-tertiary hover:text-primary", focusRing)} onClick={onDone} data-testid="demo-skip">
            Überspringen
          </button>
        ) : null}
      </div>
    </div>
  );
}
