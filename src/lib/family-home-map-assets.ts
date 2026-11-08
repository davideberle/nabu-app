// ---------------------------------------------------------------------------
// Step 2 B (2026-11-02): the sprite manifest of the home map — ONE source for the code, the placeholder generator
// (scripts/home-map-placeholders.mjs) and ASSET-MANIFEST.md for the art pass. Final art replaces the files under
// public/family/home-map/ with the same names, pixel sizes and anchors; no code change is needed.
//
// Geometry («cozy 3D isometric», style B, approved 2026-11-02 13:12): 2:1 dimetric projection (true game isometric,
// ~26.57° tile edges), light from the upper left, soft shadows to the lower right. One map tile is a 128×64 diamond
// in LOGICAL pixels; every file is delivered at 2× (a tile is 256×128 px in the file). The game draws at 0.5 scale.
//
// Anchor = the pixel in the FILE that sits on the map: for pieces, the bottom (south) corner of the footprint diamond.
// A footprint of w×h tiles is (w+h)·128 px wide in the file; its south corner is at x = w·128, y = file height.
// ---------------------------------------------------------------------------

export const TILE_W = 128; // logical
export const TILE_H = 64; // logical
export const ART_SCALE = 2; // files are delivered at 2×

export type AssetKind = "island" | "ground" | "piece" | "marker" | "avatar" | "effect" | "scene";

export type AssetDef = {
  /** File name without extension under public/family/home-map/. */
  id: string;
  world: "santiago" | "isabel" | "shared";
  kind: AssetKind;
  shows: string;
  stage?: "built" | "site";
  footprint?: { w: number; h: number };
  /** File size in px (2×). */
  size: { w: number; h: number };
  /** Anchor in file px. */
  anchor: { x: number; y: number };
  format: "png" | "webp";
  /** Spritesheet frames (left to right, then rows). */
  frames?: { w: number; h: number; count: number; layout: string };
  notes?: string;
  /** A half-size companion `<id>@1x.<format>` exists (resized from the 2× file, no new art): served to windows up to 1440 px. */
  oneX?: true;
};

/** A piece sprite: footprint w×h tiles, extra height above the footprint diamond (logical px). */
function piece(id: string, world: "santiago" | "isabel", shows: string, stage: "built" | "site", w: number, h: number, height: number, notes?: string): AssetDef {
  const fw = (w + h) * (TILE_W / 2) * ART_SCALE;
  const fh = ((w + h) * (TILE_H / 2) + height) * ART_SCALE;
  return { id, world, kind: "piece", shows, stage, footprint: { w, h }, size: { w: fw, h: fh }, anchor: { x: w * (TILE_W / 2) * ART_SCALE, y: fh }, format: "png", notes };
}

const SITE = "Construction site of the same footprint: marked plot (string and wooden stakes on the corners), a few materials stacked, no finished building. Same colours as the island.";

export const ASSETS: AssetDef[] = [
  // Islands: the ground of each world, painted once. Grass with the faint tile pattern of the references, cliffs and the
  // foam line; NO paths, NO buildings, NO characters (they are separate sprites). Transparent outside the island.
  { id: "santiago-island", world: "santiago", kind: "island", shows: "Santiago's expedition island: 12×12 grass tiles on a low cliff (sand-brown earth, grey rocks), a small hill in the top-left quarter (tiles c 0–3, r 0–4) for the water tank, a few trees and rocks ONLY outside the 12×12 grid, gentle foam where the cliffs meet the water.", size: { w: 3328, h: 2048 }, anchor: { x: 1664, y: 256 }, format: "webp", oneX: true, notes: "Anchor = the top corner of tile (c 0, r 0). The grid's left corner is at x 128, right corner at x 3200, bottom corner at y 1792 (file px). Cliffs hang below the grid edge to about y 1920." },
  { id: "isabel-island", world: "isabel", kind: "island", shows: "Isabel's garden island: 12×12 soft grass tiles on a low cliff, a little terrace in the top-left corner (tiles c 0–3, r 0–3) for the garden house, round trees and flower bushes ONLY outside the grid, gentle foam at the water line.", size: { w: 3328, h: 2048 }, anchor: { x: 1664, y: 256 }, format: "webp", oneX: true, notes: "Same geometry as santiago-island." },
  { id: "water", world: "shared", kind: "ground", shows: "Seamless tileable turquoise water with soft light ripples (as in both references).", size: { w: 512, h: 512 }, anchor: { x: 0, y: 0 }, format: "webp", oneX: true, notes: "Must tile seamlessly in both directions; it fills the whole 1440×780 view behind the island." },
  { id: "path-tile", world: "shared", kind: "ground", shows: "One diamond of sandy stone path (warm beige, slightly worn edges), flat on the ground.", size: { w: 256, h: 128 }, anchor: { x: 128, y: 0 }, format: "png", notes: "Exactly one tile diamond, transparent outside it; neighbouring tiles must join without a seam. Anchor = top corner." },

  // Santiago's pieces (built stage; site stage only where the visit is still to come).
  piece("s-dock-built", "santiago", "Wooden pier on posts with rope bollards and a small sailing boat moored at the side (boat on the water side, i.e. lower left).", "built", 2, 1, 160),
  piece("s-shop-built", "santiago", "Rosa's harbor shop: small wooden stall with an awning, crates of supplies and a little sign (no text).", "built", 2, 2, 150),
  piece("s-office-built", "santiago", "Herr Baumann's planning office: small timber house with a drawing table visible through a wide window, rolled plans.", "built", 2, 2, 170),
  piece("s-workshop-built", "santiago", "The typing workshop: wooden cabin with blue roof and chimney, front open with a desk and a keyboard (as in the reference).", "built", 2, 2, 190),
  piece("s-garden-beds-built", "santiago", "Raised wooden garden beds with carrots, tomatoes, lettuce and beets inside a low rustic fence.", "built", 2, 2, 70),
  piece("s-greenhouse-built", "santiago", "Glass greenhouse with white frame and arched door, plants and pots inside (the main hall only).", "built", 3, 2, 220),
  piece("s-greenhouse-wing-built", "santiago", "The expanded greenhouse wing: lower glass annex with flower pots, joining the main hall on its left side.", "built", 2, 2, 150, "Sits right of s-greenhouse; its left edge touches the hall."),
  piece("s-water-tank-built", "santiago", "Wooden water tank on a timber stand with a blue conical roof and metal bands.", "built", 2, 2, 260),
  piece("s-water-tank-site", "santiago", `Water tank site: ${SITE} Stacked planks and a coil of rope.`, "site", 2, 2, 60),
  piece("s-pipe-built", "santiago", "Blue water pipe with metal joints on low wooden supports, running from the tank (left) to the greenhouse (right), on the ground.", "built", 1, 2, 60),
  piece("s-pipe-site", "santiago", `Pipe site: ${SITE} Loose blue pipe pieces lying on the grass (as in the reference).`, "site", 1, 2, 30),

  // Isabel's pieces.
  piece("i-garden-house-built", "isabel", "Old Lila's garden house: timber cottage with blue roof, red round door, ivy, lantern, flower pots and three stone steps.", "built", 3, 3, 230),
  piece("i-stick-fence-built", "isabel", "Stick fence with Ida's wooden gate under a flower arch (the sticks are bundles of ten, tied with string).", "built", 3, 1, 140),
  piece("i-flower-garden-flowers-built", "isabel", "Fenced round flower garden with hydrangeas, tulips and yellow daisies.", "built", 2, 2, 90, "Variant for the choice «Blumen» (IG2-PLANT = flowers)."),
  piece("i-flower-garden-vegetables-built", "isabel", "Fenced garden with small vegetable rows (lettuce, beans).", "built", 2, 2, 90, "Variant for «Gemüse» (IG2-PLANT = vegetables)."),
  piece("i-flower-garden-tree-built", "isabel", "Fenced garden with a young apple tree in the middle.", "built", 2, 2, 200, "Variant for «Einen Apfelbaum» (IG2-PLANT = tree)."),
  piece("i-vegetable-patch-built", "isabel", "Raised vegetable patch with ripe corn cobs and a hazelnut bush beside it.", "built", 2, 2, 140),
  piece("i-vegetable-patch-site", "isabel", `Vegetable patch site: ${SITE} Fresh dark soil and a small watering can.`, "site", 2, 2, 40),
  piece("i-harvest-table-apples-built", "isabel", "Wooden harvest table with a checked cloth and a basket of red apples.", "built", 2, 1, 110, "Variant for «Äpfel» (IH2-PICK = apples)."),
  piece("i-harvest-table-carrots-built", "isabel", "Wooden harvest table with a checked cloth and a basket of carrots.", "built", 2, 1, 110, "Variant for «Karotten» (IH2-PICK = carrots)."),
  piece("i-harvest-table-corn-built", "isabel", "Wooden harvest table with a checked cloth and a basket of corn cobs.", "built", 2, 1, 110, "Variant for «Mais» (IH2-PICK = corn)."),
  piece("i-harvest-table-site", "isabel", `Harvest table site: ${SITE} An empty table top leaning on two trestles.`, "site", 2, 1, 60),

  // Nov 8 arcs: the turtle's pond (Santiago Visit 10 = v11) and the birdhouse (Isabel Visit 4 = v5).
  piece("s-pond-site", "santiago", `Pond site: ${SITE} Stakes marking a rectangle and a neat stack of round stones.`, "site", 2, 2, 40),
  piece("s-pond-dug-built", "santiago", "An empty dug pond with a ring of round stones around the edge (no water yet: the next visit fills it).", "built", 2, 2, 50),
  piece("s-turtle-crate-built", "santiago", "A low wooden crate in a patch of shade with a young sea turtle resting inside, one flipper bandaged.", "built", 1, 1, 70, "Stands from the start of the visit: the turtle arrives in the opening scene."),
  piece("i-birdhouse-site", "isabel", `Birdhouse site: ${SITE} A post in the ground with a small pile of sticks and a few nails.`, "site", 1, 1, 60),
  piece("i-birdhouse-red-built", "isabel", "A small wooden birdhouse with a round hole on a tall post, RED roof.", "built", 1, 1, 150, "Variant for the choice «Rot» (IV10-ROOF = red)."),
  piece("i-birdhouse-blue-built", "isabel", "A small wooden birdhouse with a round hole on a tall post, BLUE roof.", "built", 1, 1, 150, "Variant for «Blau» (IV10-ROOF = blue)."),
  piece("i-birdhouse-yellow-built", "isabel", "A small wooden birdhouse with a round hole on a tall post, YELLOW roof.", "built", 1, 1, 150, "Variant for «Gelb» (IV10-ROOF = yellow)."),

  // Markers and signs (shared by both worlds).
  { id: "marker-current", world: "shared", kind: "marker", shows: "Soft glowing ring on the ground (warm yellow, translucent) marking a place of today's visit.", size: { w: 256, h: 128 }, anchor: { x: 128, y: 64 }, format: "png", notes: "Diamond-shaped glow lying flat on one tile; anchor = tile centre. The game pulses it." },
  { id: "sign", world: "shared", kind: "marker", shows: "Small wooden signpost (blank board on one post, as in the references).", size: { w: 128, h: 160 }, anchor: { x: 64, y: 152 }, format: "png", notes: "No text on the board: the game writes the place name in its own font." },

  // Avatars: 4 walking directions × 4 frames; frame 0 of each row is the standing pose.
  { id: "santiago-avatar", world: "santiago", kind: "avatar", shows: "Santiago's explorer: chibi boy with safari hat, backpack, khaki shorts (as in the reference).", size: { w: 768, h: 1024 }, anchor: { x: 96, y: 244 }, format: "png", frames: { w: 192, h: 256, count: 16, layout: "4 columns (frames) × 4 rows: row 1 walking towards the lower right (south-east), row 2 lower left (south-west), row 3 upper right (north-east), row 4 upper left (north-west)" }, notes: "Anchor per frame = between the feet (x 96, y 244 of each 192×256 frame)." },
  { id: "isabel-avatar", world: "isabel", kind: "avatar", shows: "Isabel's gardener: chibi girl with ponytail, pink jacket and a purple backpack (as in the reference).", size: { w: 768, h: 1024 }, anchor: { x: 96, y: 244 }, format: "png", frames: { w: 192, h: 256, count: 16, layout: "same as santiago-avatar" }, notes: "Anchor per frame = between the feet." },

  // Effects.
  { id: "i-robins", world: "isabel", kind: "effect", shows: "Two small robins (brown back, orange breast) flying as a pair, 4 flapping frames. The game circles them around the birdhouse.", size: { w: 768, h: 192 }, anchor: { x: 96, y: 96 }, format: "png", frames: { w: 192, h: 192, count: 4, layout: "4 frames in one row" }, notes: "Transparent. Frame 0 is also the pair shown beside Ida on her scenes." },
  // Scene sprites (HTML screens, not the map; the same style, facing the viewer).
  { id: "portrait-dr-mateo", world: "santiago", kind: "scene", shows: "Dr. Mateo, a friendly Spanish vet, head and shoulders in a green coat, a radio headset around his neck. Rosa's cousin.", size: { w: 320, h: 320 }, anchor: { x: 0, y: 0 }, format: "png", notes: "Shown in a circle of 80 px: keep the face in the middle." },
  { id: "turtle-scene", world: "santiago", kind: "scene", shows: "The young sea turtle, whole body, one flipper bandaged, looking at the viewer. Transparent background.", size: { w: 320, h: 320 }, anchor: { x: 0, y: 0 }, format: "png", notes: "Shown 64 px beside the character on every scene of this arc." },
  { id: "build-puff", world: "shared", kind: "effect", shows: "Cartoon dust-and-sparkle puff for a piece appearing (8 frames: grow, burst, fade).", size: { w: 3072, h: 256 }, anchor: { x: 192, y: 224 }, format: "png", frames: { w: 384, h: 256, count: 8, layout: "8 frames left to right" }, notes: "Played over the footprint while the piece rises (about 2 s in total with the rise)." },
];

export const assetById = (id: string) => ASSETS.find((a) => a.id === id) ?? null;
export const assetUrl = (a: AssetDef) => `/family/home-map/${a.id}.${a.format}`;
/** The half-size companion of a large ground file (islands, water). */
export const assetUrl1x = (a: AssetDef) => `/family/home-map/${a.id}@1x.${a.format}`;
/** Every file the map may request: the 31 manifest files plus the 1× companions. */
export const ALL_ASSET_URLS: string[] = [...ASSETS.map(assetUrl), ...ASSETS.filter((a) => a.oneX).map(assetUrl1x)];
/** Windows up to this width get the 1× ground (the canvas draws at CSS pixels; the island is shown at ~1100 px there). */
export const ONE_X_MAX_WIDTH = 1440;
