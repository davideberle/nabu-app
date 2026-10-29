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
const SOIL = "#8d6b4a";
const SOIL_DARK = "#6b4f34";
const LEAF = "#4f8f3a";

function Flower({ x, y, h, color }: { x: number; y: number; h: number; color: string }) {
  const top = y - h;
  return (
    <g>
      <path d={`M${x} ${y}V${top + 6}`} stroke={LEAF} strokeWidth={3} />
      <ellipse cx={x - 5} cy={y - h / 2} rx={5} ry={2.5} fill={LEAF} transform={`rotate(-30 ${x - 5} ${y - h / 2})`} />
      {[0, 72, 144, 216, 288].map((a) => <circle key={a} cx={x + 5 * Math.cos((a * Math.PI) / 180)} cy={top + 5 * Math.sin((a * Math.PI) / 180)} r={4} fill={color} />)}
      <circle cx={x} cy={top} r={3} fill="#f7e27a" />
    </g>
  );
}

function Leaf() {
  return (
    <g>
      <path d="M8 50q32-34 64 0q-32 30-64 0z" fill="#7fb069" stroke={LEAF} strokeWidth={2} />
      <path d="M10 50h60" stroke={LEAF} strokeWidth={1.5} />
    </g>
  );
}

/** A snail whose shell sits at (x, y): on the leaf above the vein, or below the leaf's edge. */
function Snail({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <path d={`M${x - 16} ${y + 6}h30q4 0 4-4v-6`} stroke="#c9a46a" strokeWidth={6} strokeLinecap="round" fill="none" />
      <circle cx={x - 2} cy={y - 2} r={10} fill="#b0703a" />
      <path d={`M${x - 2} ${y - 2}m-5 0a5 5 0 1 0 5 -5`} stroke="#7a4a22" strokeWidth={2} fill="none" />
      <path d={`M${x + 18} ${y - 6}l2-8M${x + 18} ${y - 6}l6-6`} stroke="#c9a46a" strokeWidth={2} strokeLinecap="round" />
    </g>
  );
}

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
    // ---- Isabel Visit 2 — «Idas Garten» (same plain vector style; nothing here carries a number a task asks for) ----
    case "garden-empty":
      return (
        <g>
          <rect x={4} y={44} width={72} height={28} rx={4} fill={SOIL} />
          <path d="M10 54h60M10 62h60" stroke={SOIL_DARK} strokeWidth={2} strokeDasharray="5 5" />
          {[8, 24, 40, 56, 72].map((x) => <rect key={x} x={x - 2} y={30} width={4} height={18} fill={WOOD} />)}
          <rect x={4} y={34} width={72} height={3} fill={WOOD_LIGHT} />
        </g>
      );
    case "garden-flowers":
      return (
        <g>
          <rect x={4} y={56} width={72} height={16} rx={4} fill={SOIL} />
          {[16, 32, 48, 64].map((x, i) => <Flower key={x} x={x} y={56} h={20 + (i % 2) * 6} color={["#e8503a", "#f2c14e", "#b07cc6", "#ef7fa8"][i]} />)}
        </g>
      );
    case "garden-vegetables":
      return (
        <g>
          <rect x={4} y={56} width={72} height={16} rx={4} fill={SOIL} />
          {[18, 40, 62].map((x) => (
            <g key={x}>
              <path d={`M${x} 58l-4 14h8z`} fill="#ef8a2c" />
              <path d={`M${x} 58q-6-12-10-14M${x} 58q0-14 0-16M${x} 58q6-12 10-14`} stroke={LEAF} strokeWidth={3} fill="none" strokeLinecap="round" />
            </g>
          ))}
          <circle cx={29} cy={52} r={6} fill="#7fb069" />
          <circle cx={51} cy={52} r={6} fill="#7fb069" />
        </g>
      );
    case "garden-tree":
      return (
        <g>
          <rect x={4} y={62} width={72} height={10} rx={4} fill={SOIL} />
          <rect x={36} y={38} width={8} height={26} fill={WOOD_DARK} />
          <circle cx={40} cy={28} r={20} fill={LEAF} />
          <circle cx={28} cy={34} r={10} fill={LEAF} />
          <circle cx={52} cy={34} r={10} fill={LEAF} />
          {[[32, 24], [46, 20], [50, 36], [30, 38], [40, 32]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r={3.5} fill="#d6342c" />)}
        </g>
      );
    case "nest":
      return (
        <g>
          <ellipse cx={40} cy={50} rx={28} ry={14} fill="#a0743f" />
          <path d="M14 48q26 14 52 0M16 54q24 10 48 0M20 44q20 8 40 0" stroke="#6e4a22" strokeWidth={2} fill="none" />
          <ellipse cx={32} cy={42} rx={7} ry={9} fill="#cfe6f2" />
          <ellipse cx={46} cy={41} rx={7} ry={9} fill="#dcecf5" />
        </g>
      );
    case "hedgehog":
      return (
        <g>
          <path d="M14 56q4-30 34-28q18 2 22 20l4 8z" fill="#6e4a22" />
          <path d="M18 50l-4-8M26 42l-4-10M36 36l-2-11M46 34l2-11M56 38l5-9M63 44l7-6" stroke="#4a3216" strokeWidth={3} strokeLinecap="round" />
          <path d="M62 50q10 0 12 6l-14 2z" fill="#d9a066" />
          <circle cx={73} cy={55} r={2} fill="#222" />
          <circle cx={64} cy={51} r={1.6} fill="#222" />
          <path d="M24 56v6M50 56v6" stroke="#4a3216" strokeWidth={4} strokeLinecap="round" />
        </g>
      );
    case "flowerpot":
      return (
        <g>
          <path d="M22 36h36l-6 34H28z" fill="#c8693f" />
          <rect x={18} y={30} width={44} height={9} rx={2} fill="#b35a33" />
          <path d="M40 30V14" stroke={LEAF} strokeWidth={3} />
          <ellipse cx={34} cy={18} rx={6} ry={3} fill={LEAF} transform="rotate(-30 34 18)" />
          <ellipse cx={46} cy={16} rx={6} ry={3} fill={LEAF} transform="rotate(30 46 16)" />
        </g>
      );
    case "snail-on-leaf":
      return (
        <g>
          <Leaf />
          <Snail x={40} y={34} />
        </g>
      );
    case "snail-under-leaf":
      return (
        <g>
          <Leaf />
          <Snail x={40} y={70} />
        </g>
      );
    case "beetle-on-leaf":
      return (
        <g>
          <Leaf />
          <ellipse cx={40} cy={34} rx={11} ry={9} fill="#d6342c" />
          <path d="M40 25v18" stroke="#222" strokeWidth={1.5} />
          <circle cx={35} cy={32} r={2} fill="#222" />
          <circle cx={45} cy={36} r={2} fill="#222" />
          <circle cx={40} cy={24} r={4} fill="#222" />
        </g>
      );
    case "seed-cup":
      return (
        <g>
          <path d="M24 34h32l-4 36H28z" fill="#f4efe6" stroke="#9a8a74" strokeWidth={2} />
          <rect x={26} y={34} width={28} height={8} fill={SOIL} />
          <path d="M40 34V20" stroke={LEAF} strokeWidth={3} />
          <ellipse cx={34} cy={22} rx={6} ry={3} fill={LEAF} transform="rotate(-25 34 22)" />
          <ellipse cx={46} cy={20} rx={6} ry={3} fill={LEAF} transform="rotate(25 46 20)" />
        </g>
      );
    case "find-flower":
      return (
        <g>
          <Flower x={40} y={70} h={44} color="#e8503a" />
        </g>
      );
    case "find-grass":
      return (
        <g>
          <rect x={6} y={64} width={68} height={8} fill={SOIL} />
          {Array.from({ length: 11 }, (_, i) => <path key={i} d={`M${10 + i * 6} 66q${i % 2 ? 3 : -3}-14 ${i % 2 ? 1 : -1}-${22 + (i % 3) * 6}`} stroke={LEAF} strokeWidth={3} fill="none" strokeLinecap="round" />)}
        </g>
      );
    case "find-houseplant":
      return (
        <g>
          <path d="M28 50h24l-4 22H32z" fill="#5f8fbf" />
          {[-40, -15, 15, 40].map((r) => <ellipse key={r} cx={40} cy={34} rx={5} ry={16} fill={LEAF} transform={`rotate(${r} 40 50)`} />)}
        </g>
      );
    case "find-herbs":
      return (
        <g>
          <rect x={10} y={58} width={60} height={14} rx={3} fill="#c8693f" />
          {[20, 32, 44, 56].map((x) => (
            <g key={x}>
              <path d={`M${x} 58V36`} stroke={LEAF} strokeWidth={2} />
              {[38, 44, 50].map((y) => <ellipse key={y} cx={x + (y % 4 ? 4 : -4)} cy={y} rx={4} ry={2.4} fill="#6ea24a" />)}
            </g>
          ))}
        </g>
      );
    case "next-birdhouse":
      return (
        <g>
          <rect x={38} y={52} width={4} height={22} fill={WOOD_DARK} />
          <rect x={24} y={28} width={32} height={26} fill={WOOD} />
          <path d="M18 30l22-18 22 18z" fill="#b5452f" />
          <circle cx={40} cy={40} r={5} fill={WOOD_DARK} />
          <rect x={38} y={46} width={4} height={6} fill={WOOD_DARK} />
        </g>
      );
    case "next-garden-animals":
      return (
        <g>
          <rect x={4} y={62} width={72} height={10} fill={SOIL} />
          <g transform="translate(-6 8) scale(0.75)"><Snail x={40} y={60} /></g>
          <path d="M44 62q2-18 18-16q10 2 12 12l2 4z" fill="#6e4a22" />
          <path d="M48 54l-3-5M56 48l-1-6M64 48l3-5" stroke="#4a3216" strokeWidth={2.5} strokeLinecap="round" />
          <circle cx={73} cy={60} r={1.6} fill="#222" />
          <path d="M18 20q6-8 12 0q6-8 12 0" stroke="#5b4a33" strokeWidth={2.5} fill="none" />
        </g>
      );
    case "next-harvest":
      return (
        <g>
          <path d="M14 44h52l-6 26H20z" fill={WOOD_LIGHT} stroke={WOOD_DARK} strokeWidth={2} />
          <path d="M18 44q22-26 44 0" stroke={WOOD_DARK} strokeWidth={3} fill="none" />
          <circle cx={30} cy={42} r={7} fill="#d6342c" />
          <circle cx={44} cy={40} r={7} fill="#e05a2a" />
          <path d="M54 44l-3 10h6z" fill="#ef8a2c" />
          <path d="M54 44q-3-6-6-6M54 44v-8M54 44q3-6 6-6" stroke={LEAF} strokeWidth={2} fill="none" />
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
export function Counters({ counters, caption = true }: { counters: MissionCounters; /** Isabel Visit 2 (narrated): the question says it — no caption to read. */ caption?: boolean }) {
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
        <figcaption className={caption ? "text-base" : "sr-only"}>
          {tens} Bündel mit je 10 {unit}
          {loose ? ` und ${loose} einzelne` : ""} {op === "+" ? "und dazu" : "weg:"} {b} {b === 1 ? "einzelnes" : "einzelne"}
        </figcaption>
      </figure>
    );
  }
  const total = op === "+" ? a + b : a;
  const who = counters.actor ?? "Old Lila nimmt";
  if (counters.ask === "missing" && counters.frame) {
    // Visit 2: a full frame of places — `a` filled, `b` empty; the question asks for the empty ones (the missing part).
    return (
      <figure className="grid gap-2" data-testid="counters" data-a={a} data-b={b} data-op={op} data-frame={counters.frame} data-bundles="false">
        <div className="grid w-max grid-cols-5 gap-2 rounded-2xl border-4 p-2" style={{ borderColor: "#c9b28c", background: "#fbf6ec" }} role="img" aria-label={`Platz für ${counters.frame} ${unit}: ${a} stehen da, die anderen Plätze sind leer`}>
          {Array.from({ length: counters.frame }, (_, i) => (
            <svg key={i} viewBox="0 0 40 40" className="h-12 w-12" aria-hidden data-part={i < a ? "filled" : "empty"}>
              {i < a ? <CounterIcon icon={counters.icon} /> : <rect x={5} y={5} width={30} height={30} rx={6} fill="none" stroke="#b9a582" strokeWidth={2} strokeDasharray="4 4" />}
            </svg>
          ))}
        </div>
        <figcaption className={caption ? "text-base" : "sr-only"}>Platz für {counters.frame} {unit}</figcaption>
      </figure>
    );
  }
  return (
    <figure className="grid gap-2" data-testid="counters" data-a={a} data-b={b} data-op={op} data-bundles="false">
      <div className="flex flex-wrap items-center gap-2" role="img" aria-label={op === "+" ? `${a} ${unit} und ${b} ${unit}` : `${a} ${unit}, ${b} davon sind weg`}>
        {Array.from({ length: total }, (_, i) => {
          const second = op === "+" && i >= a;
          const gone = op === "-" && i >= a - b;
          return (
            <svg key={i} viewBox="0 0 40 40" className={counters.icon ? "h-12 w-12" : "h-10 w-10"} aria-hidden data-part={second ? "added" : gone ? "gone" : "first"}>
              {counters.icon ? (
                <g opacity={gone ? 0.4 : 1}>
                  {second ? <rect x={1} y={1} width={38} height={38} rx={8} fill="#dceaf7" /> : null}
                  <CounterIcon icon={counters.icon} />
                </g>
              ) : (
                <rect x={6} y={6} width={28} height={28} rx={4} fill={second ? "#4f8fbf" : WOOD_LIGHT} stroke={WOOD_DARK} strokeWidth={1.5} opacity={gone ? 0.45 : 1} />
              )}
              {gone ? <path d="M8 8l24 24M32 8L8 32" stroke="#a33" strokeWidth={3} strokeLinecap="round" /> : null}
            </svg>
          );
        })}
      </div>
      <figcaption className={caption ? "text-base" : "sr-only"}>{op === "+" ? `${a} ${unit} und ${b} ${unit} dazu` : counters.actor ? `${a} ${unit}. ${who} ${b} davon.` : `${a} ${unit}, ${b} davon nimmt Old Lila weg`}</figcaption>
    </figure>
  );
}

/** Visit 2: one counter drawn as a garden thing (40 × 40). */
function CounterIcon({ icon }: { icon?: string }) {
  switch (icon) {
    case "tulip":
      return (
        <g>
          <path d="M20 36V20" stroke={LEAF} strokeWidth={3} />
          <path d="M12 10q0 12 8 12q8 0 8-12l-4 4-4-6-4 6z" fill="#e8503a" />
        </g>
      );
    case "strawberry":
      return (
        <g>
          <path d="M8 16q12-6 24 0q0 14-12 20q-12-6-12-20z" fill="#d6342c" />
          <path d="M12 14l4-6 4 4 4-4 4 6" fill={LEAF} />
          {[[14, 22], [22, 20], [18, 28], [26, 26]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r={1.2} fill="#f7e27a" />)}
        </g>
      );
    case "pot":
      return (
        <g>
          <path d="M10 16h20l-3 20H13z" fill="#c8693f" />
          <rect x={8} y={12} width={24} height={6} rx={2} fill="#b35a33" />
          <path d="M20 12V4" stroke={LEAF} strokeWidth={2.5} />
        </g>
      );
    case "seed":
      return <ellipse cx={20} cy={20} rx={7} ry={11} fill="#8a5a2b" transform="rotate(25 20 20)" />;
    default:
      return <rect x={6} y={6} width={28} height={28} rx={4} fill={WOOD_LIGHT} stroke={WOOD_DARK} strokeWidth={1.5} />;
  }
}

/** Visit 2: her garden with what she chose to grow (the visible consequence of her own choice). */
export function WorkshopGarden({ grown, label }: { grown: string | null; label: string }) {
  return (
    <figure className="grid justify-items-start gap-2" data-testid="workshop-garden" data-grown={grown ?? ""}>
      <svg viewBox="0 0 240 150" className="h-auto w-full max-w-[360px]" role="img" aria-label={label}>
        <rect x={4} y={4} width={232} height={142} rx={10} fill="#dff0fb" stroke="#6f8f5a" strokeWidth={3} />
        <circle cx={204} cy={30} r={14} fill="#f7d54a" />
        <rect x={4} y={104} width={232} height={42} fill="#7fb069" />
        {[18, 50, 82, 114, 146, 178, 210].map((x) => <rect key={x} x={x} y={84} width={6} height={30} fill={WOOD} />)}
        <rect x={4} y={92} width={232} height={4} fill={WOOD_LIGHT} />
        <g transform="translate(60 40) scale(1.5)">
          <Shape id={(grown ?? "garden-empty") as WorkshopPicture} />
        </g>
      </svg>
      <figcaption className="text-base font-semibold">{label}</figcaption>
    </figure>
  );
}

/** The gardener of Visit 2 — a story character, drawn plainly; deliberately NOT Isabel's assistant portrait (Old Lila). */
export function GardenerPortrait({ className = "h-20 w-20", name }: { className?: string; name: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} role="img" aria-label={name} data-testid="gardener-portrait">
      <circle cx={40} cy={40} r={38} fill="#e7f2dc" />
      <path d="M18 78q0-22 22-22t22 22z" fill="#4f8f3a" />
      <rect x={30} y={58} width={20} height={20} rx={3} fill="#3d6e2c" />
      <circle cx={40} cy={40} r={14} fill="#e8b98f" />
      <path d="M27 40q-2 10 4 14M53 40q2 10-4 14" stroke="#7a4a22" strokeWidth={4} strokeLinecap="round" />
      <ellipse cx={40} cy={28} rx={24} ry={6} fill="#e9c46a" />
      <path d="M28 28q12-20 24 0z" fill="#e9c46a" />
      <path d="M28 27h24" stroke="#c0504d" strokeWidth={3} />
      <circle cx={35} cy={40} r={1.8} fill="#333" />
      <circle cx={45} cy={40} r={1.8} fill="#333" />
      <path d="M35 47q5 4 10 0" stroke="#7a4a22" strokeWidth={2} fill="none" strokeLinecap="round" />
    </svg>
  );
}
