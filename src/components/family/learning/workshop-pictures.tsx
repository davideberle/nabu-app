// ---------------------------------------------------------------------------
// Isabel Visit 1 — «Old Lilas kleine Werkstatt»: the reviewed pictures (vector, no painted art, no network).
//
// Every id is listed in `WORKSHOP_PICTURES` (mission spec) and checked by the content validator, so the content can never
// name a picture that does not exist. The drawings are deliberately plain and unambiguous for a beginning reader: a chair
// that is clearly WOODEN (brown, grain lines), a windowpane that is clearly GLASS (light, see-through, shine), a wall that is
// clearly BRICK (red blocks in a bond). Nothing here carries a number a task asks for: quantities are drawn by `Counters`
// from the data only.
// ---------------------------------------------------------------------------

import type { MissionCounters, WorkshopPicture } from "@/lib/family-learning-mission-spec";

const WOOD = "#b8793f";
const WOOD_DARK = "#7a4a22";
const WOOD_LIGHT = "#d9a066";
const GLASS = "#cfe9f5";
const GLASS_EDGE = "#5b8fa8";
const BRICK = "#b5452f";
const MORTAR = "#ead9c6";

function Grain({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <g stroke={WOOD_DARK} strokeWidth={1} strokeOpacity={0.55} fill="none">
      <path d={`M${x + w * 0.2} ${y + 2} q ${w * 0.08} ${h / 2} 0 ${h - 4}`} />
      <path d={`M${x + w * 0.55} ${y + 2} q -${w * 0.06} ${h / 2} 0 ${h - 4}`} />
      <path d={`M${x + w * 0.8} ${y + 3} q ${w * 0.05} ${h / 2} 0 ${h - 6}`} />
    </g>
  );
}

function Bricks({ x, y, w, h, rows = 5 }: { x: number; y: number; w: number; h: number; rows?: number }) {
  const rh = h / rows;
  const bw = w / 3;
  const out = [];
  for (let r = 0; r < rows; r += 1) {
    const offset = r % 2 ? -bw / 2 : 0;
    for (let c = -1; c < 4; c += 1) {
      const bx = x + offset + c * bw;
      const x0 = Math.max(x, bx);
      const x1 = Math.min(x + w, bx + bw);
      if (x1 - x0 < 2) continue;
      out.push(<rect key={`${r}-${c}`} x={x0 + 1} y={y + r * rh + 1} width={x1 - x0 - 2} height={rh - 2} rx={1.5} fill={BRICK} />);
    }
  }
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={MORTAR} />
      {out}
    </g>
  );
}

function Shape({ id }: { id: WorkshopPicture }) {
  switch (id) {
    case "chair-wood":
      return (
        <g>
          <rect x={22} y={6} width={6} height={46} rx={2} fill={WOOD} />
          <rect x={52} y={6} width={6} height={46} rx={2} fill={WOOD} />
          <rect x={22} y={10} width={36} height={6} rx={2} fill={WOOD_LIGHT} />
          <rect x={22} y={22} width={36} height={6} rx={2} fill={WOOD_LIGHT} />
          <rect x={16} y={48} width={48} height={8} rx={2} fill={WOOD} />
          <Grain x={16} y={48} w={48} h={8} />
          <rect x={18} y={56} width={6} height={20} rx={2} fill={WOOD_DARK} />
          <rect x={56} y={56} width={6} height={20} rx={2} fill={WOOD_DARK} />
        </g>
      );
    case "window-glass":
      return (
        <g>
          <rect x={12} y={8} width={56} height={64} rx={3} fill="#f4efe6" stroke="#8c8c8c" strokeWidth={3} />
          <rect x={18} y={14} width={44} height={52} fill={GLASS} stroke={GLASS_EDGE} strokeWidth={2} />
          <path d="M24 30l12-12M26 42l22-22M40 58l18-18" stroke="white" strokeWidth={3} strokeLinecap="round" opacity={0.9} />
        </g>
      );
    case "wall-brick":
      return (
        <g>
          <Bricks x={8} y={12} w={64} h={56} rows={6} />
          <rect x={8} y={12} width={64} height={56} fill="none" stroke="#7d2e1f" strokeWidth={2} />
        </g>
      );
    case "shelf-wood":
      return (
        <g>
          <rect x={14} y={8} width={6} height={66} fill={WOOD_DARK} />
          <rect x={60} y={8} width={6} height={66} fill={WOOD_DARK} />
          {[14, 36, 58].map((y) => (
            <g key={y}>
              <rect x={14} y={y} width={52} height={6} fill={WOOD} />
              <Grain x={14} y={y} w={52} h={6} />
            </g>
          ))}
          <rect x={24} y={24} width={8} height={12} fill="#5f8fbf" />
          <rect x={34} y={26} width={8} height={10} fill="#e0b84a" />
          <circle cx={52} cy={52} r={5} fill="#7fb069" />
        </g>
      );
    case "material-wood":
      return (
        <g>
          <rect x={10} y={22} width={60} height={36} rx={4} fill={WOOD} />
          <Grain x={10} y={22} w={60} h={36} />
          <ellipse cx={58} cy={40} rx={6} ry={4} fill="none" stroke={WOOD_DARK} strokeWidth={1.2} opacity={0.7} />
        </g>
      );
    case "material-glass":
      return (
        <g>
          <rect x={12} y={18} width={56} height={44} rx={3} fill={GLASS} stroke={GLASS_EDGE} strokeWidth={2.5} />
          <path d="M20 34l12-12M22 50l26-26M44 56l16-16" stroke="white" strokeWidth={3} strokeLinecap="round" />
        </g>
      );
    case "material-brick":
      return (
        <g>
          <rect x={14} y={26} width={52} height={28} rx={3} fill={BRICK} />
          <path d="M18 34h44M18 44h44" stroke="#8f3524" strokeWidth={1} opacity={0.5} />
        </g>
      );
    case "branch":
      return (
        <g stroke={WOOD_DARK} strokeLinecap="round" fill="none">
          <path d="M10 66C30 52 44 40 70 16" strokeWidth={6} />
          <path d="M38 44c-2-10 2-18 8-22" strokeWidth={4} />
          <path d="M54 30c8 0 12 4 14 10" strokeWidth={3} />
          <ellipse cx={46} cy={18} rx={7} ry={4} fill="#6aa84f" stroke="none" transform="rotate(-30 46 18)" />
          <ellipse cx={70} cy={42} rx={7} ry={4} fill="#6aa84f" stroke="none" transform="rotate(20 70 42)" />
        </g>
      );
    case "ball":
      return (
        <g>
          <circle cx={40} cy={42} r={28} fill="#e8503a" />
          <path d="M12 42h56" stroke="white" strokeWidth={5} />
          <path d="M40 14c10 8 10 48 0 56" stroke="#f6c343" strokeWidth={5} fill="none" />
        </g>
      );
    case "house":
      return (
        <g>
          <path d="M10 38L40 12l30 26" fill="#c0504d" />
          <rect x={16} y={36} width={48} height={36} fill="#f2e2c4" stroke="#8a6d46" strokeWidth={2} />
          <rect x={34} y={50} width={12} height={22} fill={WOOD} />
          <rect x={20} y={44} width={10} height={10} fill={GLASS} stroke={GLASS_EDGE} strokeWidth={1.5} />
          <rect x={50} y={44} width={10} height={10} fill={GLASS} stroke={GLASS_EDGE} strokeWidth={1.5} />
        </g>
      );
    case "table-wood":
      return (
        <g>
          <rect x={8} y={26} width={64} height={10} rx={2} fill={WOOD} />
          <Grain x={8} y={26} w={64} h={10} />
          <rect x={14} y={36} width={7} height={34} fill={WOOD_DARK} />
          <rect x={59} y={36} width={7} height={34} fill={WOOD_DARK} />
        </g>
      );
    case "spoon-wood":
      return (
        <g>
          <ellipse cx={30} cy={26} rx={13} ry={17} fill={WOOD_LIGHT} stroke={WOOD_DARK} strokeWidth={1.5} transform="rotate(-35 30 26)" />
          <path d="M38 36L68 68" stroke={WOOD} strokeWidth={7} strokeLinecap="round" />
        </g>
      );
    case "pencil":
      return (
        <g transform="rotate(-35 40 40)">
          <rect x={10} y={34} width={46} height={12} fill="#f2c14e" />
          <path d="M56 34l14 6-14 6z" fill={WOOD_LIGHT} />
          <path d="M66 38l4 2-4 2z" fill="#333" />
          <rect x={4} y={34} width={8} height={12} fill="#e58c8a" />
        </g>
      );
    case "door-wood":
      return (
        <g>
          <rect x={20} y={6} width={40} height={68} rx={2} fill={WOOD} stroke={WOOD_DARK} strokeWidth={2} />
          <Grain x={20} y={6} w={40} h={68} />
          <circle cx={52} cy={42} r={3} fill="#e0b84a" />
        </g>
      );
    case "toy-blocks":
      return (
        <g>
          <rect x={10} y={44} width={26} height={26} rx={2} fill={WOOD_LIGHT} stroke={WOOD_DARK} strokeWidth={1.5} />
          <rect x={40} y={44} width={26} height={26} rx={2} fill={WOOD} stroke={WOOD_DARK} strokeWidth={1.5} />
          <rect x={25} y={16} width={26} height={26} rx={2} fill={WOOD_LIGHT} stroke={WOOD_DARK} strokeWidth={1.5} />
        </g>
      );
    case "frame-wood":
      return (
        <g>
          <rect x={12} y={12} width={56} height={56} fill={WOOD} stroke={WOOD_DARK} strokeWidth={2} />
          <rect x={22} y={22} width={36} height={36} fill="#fff8e7" />
          <path d="M26 52l10-14 8 9 6-6 6 11z" fill="#7fb069" />
        </g>
      );
    case "room":
      return (
        <g>
          <rect x={4} y={6} width={72} height={66} fill="#f6efe2" stroke="#8a6d46" strokeWidth={2} />
          <rect x={4} y={58} width={72} height={14} fill={WOOD_LIGHT} />
        </g>
      );
    case "next-furniture":
      return (
        <g>
          <rect x={8} y={30} width={40} height={8} fill={WOOD} />
          <rect x={12} y={38} width={6} height={30} fill={WOOD_DARK} />
          <rect x={38} y={38} width={6} height={30} fill={WOOD_DARK} />
          <rect x={52} y={22} width={6} height={46} fill={WOOD} />
          <rect x={66} y={22} width={6} height={46} fill={WOOD} />
          <rect x={52} y={44} width={20} height={6} fill={WOOD_LIGHT} />
        </g>
      );
    case "next-garden":
      return (
        <g>
          <rect x={6} y={56} width={68} height={14} fill="#8d6b4a" />
          <path d="M20 56V34M40 56V26M60 56V36" stroke="#3f7a3a" strokeWidth={3} />
          <circle cx={20} cy={30} r={6} fill="#f2c14e" />
          <circle cx={40} cy={22} r={7} fill="#e8503a" />
          <circle cx={60} cy={32} r={6} fill="#b07cc6" />
        </g>
      );
    case "next-animals":
      return (
        <g>
          <ellipse cx={40} cy={50} rx={24} ry={16} fill="#d9a066" />
          <circle cx={58} cy={34} r={11} fill="#d9a066" />
          <path d="M52 26l-2-10 8 6M64 26l4-9 2 10" fill="#b8793f" />
          <circle cx={61} cy={33} r={2} fill="#333" />
          <path d="M22 64v8M34 64v8M46 64v8M56 64v8" stroke="#b8793f" strokeWidth={4} />
        </g>
      );
  }
}

/** One reviewed picture, 80 × 80, with its spoken-free label left to the caller. */
export function WorkshopPictureView({ id, className = "h-20 w-20", title }: { id: string; className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title} data-picture={id}>
      <Shape id={id as WorkshopPicture} />
    </svg>
  );
}

/** Her room with what she chose to make (the visible consequence of her own choice). */
export function WorkshopRoom({ made, label }: { made: string | null; label: string }) {
  return (
    <figure className="grid justify-items-start gap-2" data-testid="workshop-room" data-made={made ?? ""}>
      <svg viewBox="0 0 240 150" className="h-auto w-full max-w-[360px]" role="img" aria-label={label}>
        <rect x={4} y={4} width={232} height={142} rx={10} fill="#f6efe2" stroke="#8a6d46" strokeWidth={3} />
        <rect x={4} y={118} width={232} height={28} fill={WOOD_LIGHT} />
        {made ? (
          <g transform="translate(80 30) scale(1.1)">
            <Shape id={made as WorkshopPicture} />
          </g>
        ) : null}
      </svg>
      <figcaption className="text-base font-semibold">{label}</figcaption>
    </figure>
  );
}

/**
 * Exact small quantities from the data (never from art): `a` and `b` pieces added, or `b` of `a` crossed out. With `bundles`
 * every full ten is one tied bundle of ten sticks. The caption says what is drawn in words, so the picture is never a riddle.
 */
export function Counters({ counters }: { counters: MissionCounters }) {
  const { a, b, op, unit, bundles } = counters;
  if (bundles) {
    const tens = Math.floor(a / 10);
    const loose = a % 10;
    return (
      <figure className="grid gap-2" data-testid="counters" data-a={a} data-b={b} data-op={op} data-bundles="true">
        <div className="flex flex-wrap items-end gap-4" role="img" aria-label={`${tens} Bündel mit je 10 ${unit}${loose ? ` und ${loose} einzelne` : ""} ${op === "+" ? "und" : "weg:"} ${b} einzelne`}>
          {Array.from({ length: tens }, (_, i) => (
            <svg key={`t${i}`} viewBox="0 0 64 80" className="h-20 w-16" aria-hidden data-part="bundle">
              {Array.from({ length: 10 }, (_, k) => (
                <rect key={k} x={4 + k * 5.6} y={6} width={4} height={68} rx={1.5} fill={k % 2 ? WOOD : WOOD_LIGHT} />
              ))}
              <rect x={2} y={34} width={60} height={8} rx={2} fill="#c0504d" />
            </svg>
          ))}
          {Array.from({ length: loose }, (_, i) => (
            <svg key={`l${i}`} viewBox="0 0 10 80" className="h-20 w-2.5" aria-hidden data-part="loose">
              <rect x={3} y={6} width={4} height={68} rx={1.5} fill={WOOD_LIGHT} />
            </svg>
          ))}
          <span className="self-center text-3xl font-bold" aria-hidden>
            {op === "+" ? "+" : "−"}
          </span>
          {Array.from({ length: b }, (_, i) => (
            <svg key={`b${i}`} viewBox="0 0 10 80" className="h-20 w-2.5" aria-hidden data-part="added">
              <rect x={3} y={6} width={4} height={68} rx={1.5} fill="#4f8fbf" />
            </svg>
          ))}
        </div>
        <figcaption className="text-base">
          {tens} Bündel mit je 10 {unit}
          {loose ? ` und ${loose} einzelne` : ""} {op === "+" ? "und dazu" : "weg:"} {b} {b === 1 ? "einzelnes" : "einzelne"}
        </figcaption>
      </figure>
    );
  }
  const total = op === "+" ? a + b : a;
  return (
    <figure className="grid gap-2" data-testid="counters" data-a={a} data-b={b} data-op={op} data-bundles="false">
      <div className="flex flex-wrap items-center gap-2" role="img" aria-label={op === "+" ? `${a} ${unit} und ${b} ${unit}` : `${a} ${unit}, ${b} davon sind weg`}>
        {Array.from({ length: total }, (_, i) => {
          const second = op === "+" && i >= a;
          const gone = op === "-" && i >= a - b;
          return (
            <svg key={i} viewBox="0 0 40 40" className="h-10 w-10" aria-hidden data-part={second ? "added" : gone ? "gone" : "first"}>
              <rect x={6} y={6} width={28} height={28} rx={4} fill={second ? "#4f8fbf" : WOOD_LIGHT} stroke={WOOD_DARK} strokeWidth={1.5} opacity={gone ? 0.45 : 1} />
              {gone ? <path d="M8 8l24 24M32 8L8 32" stroke="#a33" strokeWidth={3} strokeLinecap="round" /> : null}
            </svg>
          );
        })}
      </div>
      <figcaption className="text-base">{op === "+" ? `${a} ${unit} und ${b} ${unit} dazu` : `${a} ${unit}, ${b} davon nimmt Old Lila weg`}</figcaption>
    </figure>
  );
}
