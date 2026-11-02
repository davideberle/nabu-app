// ---------------------------------------------------------------------------
// Step 2 B (2026-11-02): the children's isometric home map — the WORLD each child has built so far, derived read-only
// from their own records (finished visits and the choices made in them). Nothing is stored on the server; the only
// device-side memory is which built pieces this device has already shown (for the one-time build animation).
//
//  - A piece (dock, greenhouse, garden house …) appears in its BUILT stage once the visit that builds it is finished.
//  - A piece whose visit is the current one shows its SITE stage (a marked plot); pieces of later visits are plain grass.
//  - Places of the current visit are highlighted; places that belong to built pieces are visible but quiet.
//  - Variants come from the child's own choices (e.g. Isabel's garden of flowers or vegetables).
//
// Same framework for both children, separate worlds: every table below is keyed by child, and nothing of one child's
// world can be derived from the other's records.
// The flag FAMILY_HOME_MAP = off | santiago | isabel | all (default off) decides who sees the map at all.
// ---------------------------------------------------------------------------

import type { ChildId } from "./family-assistant-turn.ts";

export type HomeMapFlag = "off" | "santiago" | "isabel" | "all";

export function homeMapFlag(env: Record<string, string | undefined>): HomeMapFlag {
  const v = (env.FAMILY_HOME_MAP ?? "").trim().toLowerCase();
  return v === "santiago" || v === "isabel" || v === "all" ? v : "off";
}

export function homeMapEnabled(flag: HomeMapFlag, child: ChildId): boolean {
  return flag === "all" || flag === child;
}

/** Tile on the isometric grid: column (towards the right corner) and row (towards the left corner). */
export type Tile = { c: number; r: number };

export type PieceDef = {
  id: string;
  label: string;
  /** The visit whose completion builds this piece (content visit id, e.g. "v10"). */
  builtBy: string;
  /** Top tile of the footprint (smallest c and r). */
  tile: Tile;
  /** Footprint in tiles: w along c, h along r. */
  footprint: { w: number; h: number };
  /** The content place (map.places[].id) this piece stands for, if any. */
  place: string | null;
  /** A variant chosen by the child in one step of the building visit: step id → option id → asset suffix. */
  variant?: { step: string; options: Record<string, string>; fallback: string };
};

export type WorldDef = {
  child: ChildId;
  grid: { cols: number; rows: number };
  /** Where the avatar stands when no place is known (the landing spot). */
  spawn: Tile;
  /** The tile in front of each place (where the avatar stops and the place's sign stands). */
  places: Record<string, Tile>;
  /** Walkable path tiles (the avatar walks only on these). */
  paths: Tile[];
  pieces: PieceDef[];
};

/** Straight path segments between tiles (inclusive), along c or r. */
function line(a: Tile, b: Tile): Tile[] {
  const out: Tile[] = [];
  const dc = Math.sign(b.c - a.c);
  const dr = Math.sign(b.r - a.r);
  let c = a.c;
  let r = a.r;
  out.push({ c, r });
  while (c !== b.c || r !== b.r) {
    if (c !== b.c) c += dc;
    else r += dr;
    out.push({ c, r });
  }
  return out;
}
function route(...pts: Tile[]): Tile[] {
  const out: Tile[] = [];
  for (let i = 1; i < pts.length; i += 1) out.push(...line(pts[i - 1], pts[i]));
  return out;
}

// Santiago: the expedition island (style reference B-cozy-isometric). Dock lower left, garden beds left, water tank on
// the hill top left, greenhouse and its wing top right, typing workshop right, Rosa's shop and the planning office.
const SANTIAGO: WorldDef = {
  child: "santiago",
  grid: { cols: 12, rows: 12 },
  spawn: { c: 6, r: 11 },
  // Every place sits on the tile directly in FRONT of its piece (on the piece's lower-left or lower-right edge), so the
  // avatar standing there is never hidden behind the building; no path runs under a footprint.
  places: {
    harbor: { c: 6, r: 11 },
    shop: { c: 6, r: 7 },
    crossing: { c: 6, r: 5 },
    workshop: { c: 8, r: 8 },
    office: { c: 10, r: 5 },
    greenhouse: { c: 6, r: 3 },
    tank: { c: 3, r: 3 },
    garden: { c: 3, r: 8 },
  },
  paths: route({ c: 6, r: 11 }, { c: 6, r: 3 }, { c: 3, r: 3 }).concat(route({ c: 6, r: 5 }, { c: 10, r: 5 }), route({ c: 3, r: 8 }, { c: 8, r: 8 })),
  pieces: [
    { id: "s-dock", label: "Kai und Boot", builtBy: "v6", tile: { c: 4, r: 11 }, footprint: { w: 2, h: 1 }, place: "harbor" },
    { id: "s-shop", label: "Hafenladen", builtBy: "v7", tile: { c: 4, r: 6 }, footprint: { w: 2, h: 2 }, place: "shop" },
    { id: "s-office", label: "Planungsbüro", builtBy: "v7", tile: { c: 10, r: 3 }, footprint: { w: 2, h: 2 }, place: "office" },
    { id: "s-workshop", label: "Tipp-Werkstatt", builtBy: "v7", tile: { c: 8, r: 6 }, footprint: { w: 2, h: 2 }, place: "workshop" },
    { id: "s-garden-beds", label: "Gartenbeete", builtBy: "v8", tile: { c: 2, r: 6 }, footprint: { w: 2, h: 2 }, place: "garden" },
    { id: "s-greenhouse", label: "Gewächshaus", builtBy: "v8", tile: { c: 5, r: 1 }, footprint: { w: 3, h: 2 }, place: "greenhouse" },
    { id: "s-greenhouse-wing", label: "Neuer Flügel", builtBy: "v9", tile: { c: 8, r: 1 }, footprint: { w: 2, h: 2 }, place: null },
    { id: "s-water-tank", label: "Wassertank", builtBy: "v10", tile: { c: 2, r: 1 }, footprint: { w: 2, h: 2 }, place: "tank" },
    { id: "s-pipe", label: "Wasserleitung", builtBy: "v10", tile: { c: 4, r: 1 }, footprint: { w: 1, h: 2 }, place: null },
  ],
};

// Isabel: the garden island (style reference B-isabel-garden). Garden house top left, the stick fence with Ida's gate top
// centre, the flower garden top right, the vegetable patch right and the harvest table left — every place in front of its piece.
const ISABEL: WorldDef = {
  child: "isabel",
  grid: { cols: 12, rows: 12 },
  spawn: { c: 6, r: 9 },
  places: {
    workshop: { c: 3, r: 4 },
    garden: { c: 6, r: 2 },
    patch: { c: 8, r: 6 },
    table: { c: 3, r: 8 },
  },
  paths: route({ c: 6, r: 9 }, { c: 6, r: 2 }).concat(route({ c: 6, r: 4 }, { c: 3, r: 4 }), route({ c: 6, r: 6 }, { c: 8, r: 6 }), route({ c: 6, r: 8 }, { c: 3, r: 8 })),
  pieces: [
    { id: "i-garden-house", label: "Gartenhaus", builtBy: "v1", tile: { c: 1, r: 1 }, footprint: { w: 3, h: 3 }, place: "workshop" },
    { id: "i-stick-fence", label: "Stockzaun mit Tor", builtBy: "v2", tile: { c: 5, r: 1 }, footprint: { w: 3, h: 1 }, place: "garden" },
    { id: "i-flower-garden", label: "Garten", builtBy: "v2", tile: { c: 9, r: 1 }, footprint: { w: 2, h: 2 }, place: null, variant: { step: "IG2-PLANT", options: { flowers: "flowers", vegetables: "vegetables", tree: "tree" }, fallback: "flowers" } },
    { id: "i-vegetable-patch", label: "Gemüsebeet", builtBy: "v4", tile: { c: 8, r: 4 }, footprint: { w: 2, h: 2 }, place: "patch" },
    { id: "i-harvest-table", label: "Erntetisch", builtBy: "v4", tile: { c: 2, r: 7 }, footprint: { w: 2, h: 1 }, place: "table", variant: { step: "IH2-PICK", options: { apples: "apples", carrots: "carrots", corn: "corn" }, fallback: "apples" } },
  ],
};

export const WORLDS: Record<ChildId, WorldDef> = { santiago: SANTIAGO, isabel: ISABEL };

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

export type HomeWorldInput = {
  child: ChildId;
  /** The child's started visits (state.visits). */
  visits: { id: string; finishedAt: string | null }[];
  /** Choices the child made: step id → option id (from the mission runs). */
  choices: Record<string, string>;
  /** The visit the map leads into now (the running visit, else the next offered one); null when none. */
  current: { visit: string; mission: string | null; places: { id: string; label: string; kind?: string }[]; start: string | null } | null;
  /** Built piece ids this device has already shown; null = this device never opened the map. */
  seen: string[] | null;
  /** Where the child last left the map (a place id), e.g. after «back» from a scene. */
  lastPlace?: string | null;
};

export type HomePiece = { id: string; label: string; stage: "built" | "site"; tile: Tile; footprint: { w: number; h: number }; asset: string; place: string | null; builtBy: string; arriving: boolean };
export type HomePlace = { id: string; label: string; tile: Tile; state: "current" | "quiet"; waypoint: boolean };
export type HomeWorld = {
  child: ChildId;
  grid: WorldDef["grid"];
  pieces: HomePiece[];
  places: HomePlace[];
  paths: Tile[];
  avatar: Tile;
  /** Pieces that appear with the build animation this time (built since this device last showed the map). */
  arrivals: string[];
  /** Places of the current visit that have no tile in this world (shown nowhere; reported so content and map stay in step). */
  unplaced: string[];
};

export function deriveHomeWorld(input: HomeWorldInput): HomeWorld {
  const def = WORLDS[input.child];
  const finished = input.visits.filter((v) => !!v.finishedAt);
  const finishedIds = new Set(finished.map((v) => v.id));
  const lastFinished = finished.length ? finished[finished.length - 1].id : null;
  const currentVisit = input.current?.visit ?? null;
  const pieces: HomePiece[] = [];
  for (const p of def.pieces) {
    const built = finishedIds.has(p.builtBy);
    const site = !built && p.builtBy === currentVisit;
    if (!built && !site) continue;
    const variant = p.variant ? (p.variant.options[input.choices[p.variant.step] ?? ""] ?? p.variant.fallback) : null;
    // A site is the same for every variant (the choice is made during that visit); a built piece shows the child's choice.
    const asset = built ? `${p.id}${variant ? `-${variant}` : ""}-built` : `${p.id}-site`;
    pieces.push({ id: p.id, label: p.label, stage: built ? "built" : "site", tile: p.tile, footprint: p.footprint, asset, place: p.place, builtBy: p.builtBy, arriving: false });
  }
  const builtIds = pieces.filter((p) => p.stage === "built").map((p) => p.id);
  // First time on this device: only the latest finished visit's pieces arrive (not the whole history at once).
  const arrivals = input.seen === null ? pieces.filter((p) => p.stage === "built" && p.builtBy === lastFinished).map((p) => p.id) : builtIds.filter((id) => !input.seen!.includes(id));
  for (const p of pieces) p.arriving = arrivals.includes(p.id);

  const places: HomePlace[] = [];
  const unplaced: string[] = [];
  const currentIds = new Set<string>();
  for (const pl of input.current?.places ?? []) {
    const tile = def.places[pl.id];
    if (!tile) {
      unplaced.push(pl.id);
      continue;
    }
    currentIds.add(pl.id);
    places.push({ id: pl.id, label: pl.label, tile, state: "current", waypoint: pl.kind === "waypoint" });
  }
  for (const p of pieces) {
    if (p.stage !== "built" || !p.place || currentIds.has(p.place) || places.some((x) => x.id === p.place)) continue;
    const tile = def.places[p.place];
    if (tile) places.push({ id: p.place, label: p.label, tile, state: "quiet", waypoint: false });
  }
  const at = (id: string | null | undefined) => (id ? def.places[id] ?? null : null);
  const avatar = at(input.lastPlace) ?? at(input.current?.start) ?? def.spawn;
  return { child: input.child, grid: def.grid, pieces, places, paths: def.paths, avatar, arrivals, unplaced };
}

/** Shortest walk along path tiles (4-neighbour BFS); null when the target is not reachable. */
export function walkPath(paths: Tile[], from: Tile, to: Tile): Tile[] | null {
  const key = (t: Tile) => `${t.c},${t.r}`;
  const walkable = new Set(paths.map(key));
  walkable.add(key(from));
  walkable.add(key(to));
  const prev = new Map<string, string | null>([[key(from), null]]);
  const queue: Tile[] = [from];
  while (queue.length) {
    const t = queue.shift()!;
    if (t.c === to.c && t.r === to.r) {
      const out: Tile[] = [];
      let k: string | null = key(t);
      while (k) {
        const [c, r] = k.split(",").map(Number);
        out.unshift({ c, r });
        k = prev.get(k) ?? null;
      }
      return out;
    }
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = { c: t.c + dc, r: t.r + dr };
      if (!walkable.has(key(n)) || prev.has(key(n))) continue;
      prev.set(key(n), key(t));
      queue.push(n);
    }
  }
  return null;
}

/** Device memory of shown pieces (localStorage key per child). */
export const seenKey = (child: ChildId) => `family-home-map:seen:${child}`;
