// ---------------------------------------------------------------------------
// Painted plates for the Visit 5 island (art direction 2026-10-10, generated
// reference `learning/visit5-2026-10-10/art/2026-10-10 1718 island-art-direction.webp`).
//
// The island stays an OWNED, LIVE scene: every plate is an optional raster layer
// that replaces exactly one vector counterpart at a fixed anchor, while the live
// state (crates, loaded boats, ropes, destination signpost, flags, status
// badges, labels, the avatar) stays vector on top. No progress or count is ever
// baked into a plate; a plate carries no text. The manifest (ids + sha256) and
// the static-import module are generated from the PNGs actually present under
// `src/assets/family-learning/island/` (`scripts/island-plates.mjs`), so a
// missing plate simply leaves the vector drawing in place. Plates are build-time
// static assets (`/_next/static/media/…`, content-hashed, outside the auth
// middleware — the same locally as on Vercel); they are deliberately not
// `public/` files, which the local auth gate redirects a child session away from.
// ---------------------------------------------------------------------------

import manifest from "@/data/family-learning/island-plates.json";
import { PLATE_ASSETS } from "./harbor-island-plate-assets";

export type PlateId = "crate" | "boat-hull" | "boat-sail" | "pier-module" | "pier-head" | "plank-pile" | "garden-bed" | "seedling" | "station-bed" | "supply-store" | "logbook-stand" | "wordbook-stand" | "marker-turtle" | "marker-waves" | "overlay-forest" | "overlay-crater" | "overlay-ice" | "sky" | "sea" | "backdrop" | "far-mainland" | "far-lighthouse" | "far-ship" | "workshop" | "office" | "shop" | "harbormaster" | "keeper" | "planner" | "supplier" | "child" | "tent" | "hut" | "station" | "pier";

// Reconstructed 2026-10-12 from B3 sealed geometry/receipt; requires fresh verification.
export const ISLAND_NODES = {
  base: [459, 300],
  garden: [389, 413],
  station: [1150, 425],
  pier: [1074, 562],
  harbor: [760, 700],
  workshop: [582, 413],
  office: [1004, 369],
  shop: [639, 640],
  harbormaster: [872, 571],
  logbook: [345, 369],
  supplies: [617, 290],
  wordbook: [980, 505],
} as const;
export const STATION_SPOTS = {
  beach: [1145, 508],
  rocks: [1150, 425],
  dune: [1224, 352],
} as const;
export const BUILDING_SIZE = { hut: [181, 134.5], tent: [197.5, 143], harbormaster: [166.5, 160.5], station: [146.5, 140] } as const;
export const B3_ANCHORS = { hutDoor: 0.40, stationDoor: 0.35, stationLantern: [0.96, 0.55] } as const;

/** Stage-unit anchors (1600 × 900): the box each plate is drawn into. Buildings and characters anchor at their ground point. */
export const PLATE_BOXES: Record<PlateId, { x: number; y: number; width: number; height: number }> = {
  "crate": { x: -25, y: -50, width: 50, height: 50 },
  "boat-hull": { x: -25, y: -50, width: 50, height: 50 },
  "boat-sail": { x: -25, y: -50, width: 50, height: 50 },
  "pier-module": { x: -25, y: -50, width: 50, height: 50 },
  "pier-head": { x: -25, y: -50, width: 50, height: 50 },
  "plank-pile": { x: -25, y: -50, width: 50, height: 50 },
  "garden-bed": { x: -25, y: -50, width: 50, height: 50 },
  "seedling": { x: -25, y: -50, width: 50, height: 50 },
  "station-bed": { x: -25, y: -50, width: 50, height: 50 },
  "supply-store": { x: -25, y: -50, width: 50, height: 50 },
  "logbook-stand": { x: -25, y: -50, width: 50, height: 50 },
  "wordbook-stand": { x: -25, y: -50, width: 50, height: 50 },
  "marker-turtle": { x: -25, y: -50, width: 50, height: 50 },
  "marker-waves": { x: -25, y: -50, width: 50, height: 50 },
  "overlay-forest": { x: -25, y: -50, width: 50, height: 50 },
  "overlay-crater": { x: -25, y: -50, width: 50, height: 50 },
  "overlay-ice": { x: -25, y: -50, width: 50, height: 50 },

  "backdrop": { x: 0, y: 0, width: 1600, height: 900 },
  "sky": { x: 0, y: -2400, width: 1600, height: 2404 },
  "sea": { x: 0, y: 896, width: 1600, height: 2404 },
  "far-mainland": { x: -20, y: 77, width: 540, height: 96 },
  "far-lighthouse": { x: 1318, y: 25, width: 240, height: 150 },
  "far-ship": { x: 545, y: 95, width: 200, height: 80 },
  "workshop": { x: 527, y: 245, width: 168, height: 168 },
  "office": { x: 917, y: 201, width: 168, height: 168 },
  "shop": { x: 552, y: 472, width: 168, height: 168 },
  "keeper": { x: 624.25, y: 309, width: 35.5, height: 106 },
  "planner": { x: 1048.75, y: 258.5, width: 42.5, height: 112.5 },
  "supplier": { x: 679.0, y: 539, width: 44, height: 103 },
  "child": { x: -15.5, y: -83, width: 31, height: 83 },
  "hut": { x: 386.6, y: 165.5, width: 181, height: 134.5 },
  "tent": { x: 360.25, y: 157, width: 197.5, height: 143 },
  "harbormaster": { x: 788.75, y: 410.5, width: 166.5, height: 160.5 },
  "station": { x: -51.275, y: -140, width: 146.5, height: 140 },
  "pier": { x: 1054, y: 522, width: 260, height: 100 },
};

type ManifestPlate = { id: string; file: string; sha256?: string };
const available = new Map<string, ManifestPlate>(((manifest as { plates: ManifestPlate[] }).plates ?? []).map((p) => [p.id, p]));

/** The painted plate for an id (listed in the manifest AND bundled as a static asset), or null when the vector drawing applies. */
export function plateFor(id: PlateId): { href: string; box: { x: number; y: number; width: number; height: number } } | null {
  const asset = available.has(id) ? PLATE_ASSETS[id] : undefined;
  return asset ? { href: asset.src, box: PLATE_BOXES[id] } : null;
}

export function platesPresent(): PlateId[] {
  return [...available.keys()].filter((k): k is PlateId => k in PLATE_BOXES && k in PLATE_ASSETS);
}
