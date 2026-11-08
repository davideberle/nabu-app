#!/usr/bin/env node
// Step 2 B (2026-11-02): writes the PLACEHOLDER sprites of the home map (public/family/home-map/) at the exact sizes and
// anchors of the manifest (src/lib/family-home-map-assets.ts), and the art brief ASSET-MANIFEST.md from the same data.
// Final art replaces the files one by one with the same names; nothing in the code changes.
//   node scripts/home-map-placeholders.mjs --check                       verify every file (name, pixel size); writes nothing
//   node scripts/home-map-placeholders.mjs [--manifest <path/ASSET-MANIFEST.md>]   write placeholders ONLY for missing files
//   node scripts/home-map-placeholders.mjs --force [--manifest …]          regenerate every placeholder (overwrites delivered art!)
//   node scripts/home-map-placeholders.mjs --derive-1x                    write the half-size companions (<id>@1x) of the islands
//                                                                          and the water from the 2× files (resize only, no new art)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { ASSETS, ART_SCALE, TILE_W, TILE_H } from "../src/lib/family-home-map-assets.ts";
import { WORLDS } from "../src/lib/family-home-map.ts";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const args = process.argv.slice(2);
const manifestPath = args.includes("--manifest") ? args[args.indexOf("--manifest") + 1] : null;
const CHECK = args.includes("--check");
const FORCE = args.includes("--force");
const DERIVE_1X = args.includes("--derive-1x");
const out = new URL("../public/family/home-map/", import.meta.url);
fs.mkdirSync(out, { recursive: true });

const T = TILE_W * ART_SCALE; // 256
const H = TILE_H * ART_SCALE; // 128
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const COLOURS = { santiago: ["#9ed36a", "#c98f5a", "#4f7cc4"], isabel: ["#a9da7a", "#d99a6c", "#c25d8a"], shared: ["#cfe8a0", "#b98a5b", "#6b6b6b"] };

/** Diamond of a w×h footprint whose south corner is at (sx, sy), in file px. */
function diamond(w, h, sx, sy) {
  const north = { x: sx + (h - w) * (T / 2), y: sy - (w + h) * (H / 2) };
  const east = { x: sx + h * (T / 2), y: sy - h * (H / 2) };
  const west = { x: sx - w * (T / 2), y: sy - w * (H / 2) };
  return { north, east, south: { x: sx, y: sy }, west };
}
const poly = (pts) => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

function pieceSvg(a) {
  const { w, h } = a.footprint;
  const [ground, wall, roof] = COLOURS[a.world];
  const d = diamond(w, h, a.anchor.x, a.anchor.y - 2);
  const lift = a.size.h - (w + h) * (H / 2) - 8; // the extra height above the footprint
  const up = (p) => ({ x: p.x, y: p.y - lift * 0.8 });
  const site = a.stage === "site";
  const body = site
    ? `<polygon points="${poly([d.north, d.east, d.south, d.west])}" fill="#8a6a45" fill-opacity="0.45" stroke="#5b4026" stroke-width="6" stroke-dasharray="18 12"/>
       ${[d.north, d.east, d.south, d.west].map((p) => `<rect x="${p.x - 5}" y="${p.y - 40}" width="10" height="40" fill="#7a5530"/>`).join("")}`
    : `<polygon points="${poly([d.north, d.east, d.south, d.west])}" fill="${ground}" stroke="#3c5a2a" stroke-width="4"/>
       <polygon points="${poly([d.west, d.south, up(d.south), up(d.west)])}" fill="${wall}" stroke="#4a3520" stroke-width="4"/>
       <polygon points="${poly([d.south, d.east, up(d.east), up(d.south)])}" fill="${wall}" fill-opacity="0.8" stroke="#4a3520" stroke-width="4"/>
       <polygon points="${poly([up(d.north), up(d.east), up(d.south), up(d.west)])}" fill="${roof}" stroke="#2c2c2c" stroke-width="4"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${a.size.w}" height="${a.size.h}">
    ${body}
    <rect x="${a.size.w / 2 - 230}" y="${Math.max(6, a.size.h * 0.18)}" width="460" height="64" rx="16" fill="#ffffff" fill-opacity="0.9"/>
    <text x="${a.size.w / 2}" y="${Math.max(6, a.size.h * 0.18) + 44}" font-family="Helvetica" font-size="34" font-weight="700" text-anchor="middle" fill="#222">${esc(a.id.replace(/-(built|site)$/, ""))}</text>
    <circle cx="${a.anchor.x}" cy="${a.anchor.y - 4}" r="8" fill="#e11d48"/>
    <rect x="1" y="1" width="${a.size.w - 2}" height="${a.size.h - 2}" fill="none" stroke="#000" stroke-opacity="0.25" stroke-width="2" stroke-dasharray="8 8"/>
  </svg>`;
}

function islandSvg(a, world) {
  const ox = a.anchor.x;
  const oy = a.anchor.y;
  const corner = (c, r) => ({ x: ox + (c - r) * (T / 2), y: oy + (c + r) * (H / 2) });
  const n = corner(0, 0), e = corner(12, 0), s = corner(12, 12), w = corner(0, 12);
  const cliff = 120;
  const tiles = [];
  for (let c = 0; c < 12; c += 1) for (let r = 0; r < 12; r += 1) {
    const t = corner(c, r);
    tiles.push(`<polygon points="${poly([t, { x: t.x + T / 2, y: t.y + H / 2 }, { x: t.x, y: t.y + H }, { x: t.x - T / 2, y: t.y + H / 2 }])}" fill="${(c + r) % 2 ? "#9bd06a" : "#93c963"}" stroke="#86b95a" stroke-width="2"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${a.size.w}" height="${a.size.h}">
    <polygon points="${poly([w, s, { x: s.x, y: s.y + cliff }, { x: w.x, y: w.y + cliff }])}" fill="#b07a4c"/>
    <polygon points="${poly([s, e, { x: e.x, y: e.y + cliff }, { x: s.x, y: s.y + cliff }])}" fill="#9a6a40"/>
    ${tiles.join("")}
    <text x="${ox}" y="${s.y + cliff + 70}" font-family="Helvetica" font-size="48" font-weight="700" text-anchor="middle" fill="#ffffff">${esc(world)} island — placeholder</text>
    <circle cx="${ox}" cy="${oy}" r="10" fill="#e11d48"/>
  </svg>`;
}

function avatarSvg(a) {
  const { w: fw, h: fh } = a.frames;
  const dirs = ["SE", "SW", "NE", "NW"];
  const colour = a.world === "santiago" ? "#c9a46a" : "#e48ab0";
  const cells = [];
  for (let row = 0; row < 4; row += 1) for (let col = 0; col < 4; col += 1) {
    const x0 = col * fw, y0 = row * fh, cx = x0 + a.anchor.x, foot = y0 + a.anchor.y;
    const bob = col % 2 ? -6 : 0;
    cells.push(`<ellipse cx="${cx}" cy="${foot}" rx="40" ry="12" fill="#000" fill-opacity="0.18"/>
      <rect x="${cx - 30}" y="${foot - 150 + bob}" width="60" height="110" rx="26" fill="${colour}" stroke="#4a3520" stroke-width="4"/>
      <circle cx="${cx}" cy="${foot - 180 + bob}" r="40" fill="#f2c9a0" stroke="#4a3520" stroke-width="4"/>
      <text x="${cx}" y="${foot - 70}" font-family="Helvetica" font-size="26" font-weight="700" text-anchor="middle" fill="#222">${dirs[row]}${col}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${a.size.w}" height="${a.size.h}">${cells.join("")}</svg>`;
}

function puffSvg(a) {
  const { w: fw } = a.frames;
  const cells = [];
  for (let i = 0; i < 8; i += 1) {
    const r = 30 + i * 18;
    const op = i < 4 ? 0.9 : 0.9 - (i - 3) * 0.18;
    cells.push(`<circle cx="${i * fw + fw / 2}" cy="160" r="${r}" fill="#fff8e1" fill-opacity="${op.toFixed(2)}" stroke="#f5c542" stroke-width="6" stroke-opacity="${op.toFixed(2)}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${a.size.w}" height="${a.size.h}">${cells.join("")}</svg>`;
}

function simpleSvg(a) {
  if (a.id === "water") return `<svg xmlns="http://www.w3.org/2000/svg" width="${a.size.w}" height="${a.size.h}"><rect width="100%" height="100%" fill="#3fc1d4"/><path d="M0 128 Q 128 108 256 128 T 512 128 M0 384 Q 128 364 256 384 T 512 384" stroke="#7fe0ea" stroke-width="6" fill="none"/></svg>`;
  if (a.id === "path-tile") return `<svg xmlns="http://www.w3.org/2000/svg" width="${a.size.w}" height="${a.size.h}"><polygon points="128,0 256,64 128,128 0,64" fill="#e3c38f" stroke="#c9a46a" stroke-width="3"/></svg>`;
  if (a.id === "marker-current") return `<svg xmlns="http://www.w3.org/2000/svg" width="${a.size.w}" height="${a.size.h}"><polygon points="128,6 250,64 128,122 6,64" fill="#ffd54a" fill-opacity="0.45" stroke="#ffb300" stroke-width="8"/></svg>`;
  if (a.id === "sign") return `<svg xmlns="http://www.w3.org/2000/svg" width="${a.size.w}" height="${a.size.h}"><rect x="58" y="40" width="12" height="114" fill="#7a5530"/><rect x="14" y="14" width="100" height="56" rx="8" fill="#d9a066" stroke="#7a5530" stroke-width="5"/><circle cx="64" cy="152" r="5" fill="#e11d48"/></svg>`;
  return null;
}

if (DERIVE_1X) {
  const made = [];
  for (const a of ASSETS.filter((x) => x.oneX)) {
    const src = new URL(`${a.id}.${a.format}`, out).pathname;
    const dst = new URL(`${a.id}@1x.${a.format}`, out).pathname;
    await sharp(src).resize(a.size.w / 2, a.size.h / 2, { kernel: "lanczos3" }).webp({ quality: 86, alphaQuality: 95, effort: 6 }).toFile(dst);
    made.push({ file: `${a.id}@1x.${a.format}`, kb2x: Math.round(fs.statSync(src).size / 1024), kb1x: Math.round(fs.statSync(dst).size / 1024) });
  }
  console.log(JSON.stringify({ derived: made }, null, 1));
  process.exit(0);
}

if (CHECK) {
  const problems = [];
  for (const a of ASSETS.filter((x) => x.oneX)) {
    const file = new URL(`${a.id}@1x.${a.format}`, out).pathname;
    if (!fs.existsSync(file)) {
      problems.push(`${a.id}@1x.${a.format}: missing (run --derive-1x)`);
      continue;
    }
    const meta = await sharp(file).metadata();
    if (meta.width !== a.size.w / 2 || meta.height !== a.size.h / 2) problems.push(`${a.id}@1x.${a.format}: ${meta.width}×${meta.height}, expected ${a.size.w / 2}×${a.size.h / 2}`);
    if (a.id !== "water" && !meta.hasAlpha) problems.push(`${a.id}@1x.${a.format}: no transparency`);
  }
  for (const a of ASSETS) {
    const file = new URL(`${a.id}.${a.format}`, out).pathname;
    if (!fs.existsSync(file)) {
      problems.push(`${a.id}.${a.format}: missing`);
      continue;
    }
    const meta = await sharp(file).metadata();
    if (meta.width !== a.size.w || meta.height !== a.size.h) problems.push(`${a.id}.${a.format}: ${meta.width}×${meta.height}, manifest ${a.size.w}×${a.size.h}`);
    if (a.id !== "water" && !meta.hasAlpha) problems.push(`${a.id}.${a.format}: no transparency`);
  }
  console.log(JSON.stringify({ checked: ASSETS.length, problems }, null, 1));
  process.exit(problems.length ? 1 : 0);
}

let written = 0;
let kept = 0;
for (const a of ASSETS) {
  if (!FORCE && fs.existsSync(new URL(`${a.id}.${a.format}`, out).pathname)) {
    kept += 1;
    continue;
  }
  let svg;
  if (a.kind === "piece") svg = pieceSvg(a);
  else if (a.kind === "island") svg = islandSvg(a, a.world);
  else if (a.kind === "avatar") svg = avatarSvg(a);
  else if (a.kind === "effect") svg = puffSvg(a);
  else if (a.kind === "scene") svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${a.size.w}" height="${a.size.h}"><circle cx="${a.size.w / 2}" cy="${a.size.h / 2}" r="${a.size.w * 0.42}" fill="${a.id.startsWith("turtle") ? "#7fb069" : "#d9b48a"}" stroke="#5b4026" stroke-width="10"/></svg>`;
  else svg = simpleSvg(a);
  if (!svg) throw new Error(`no placeholder for ${a.id}`);
  let img = sharp(Buffer.from(svg)).resize(a.size.w, a.size.h);
  img = a.format === "webp" ? img.webp({ quality: 80, alphaQuality: 90 }) : img.png({ compressionLevel: 9 });
  const file = new URL(`${a.id}.${a.format}`, out);
  await img.toFile(file.pathname);
  const meta = await sharp(file.pathname).metadata();
  if (meta.width !== a.size.w || meta.height !== a.size.h) throw new Error(`${a.id}: ${meta.width}×${meta.height} ≠ manifest ${a.size.w}×${a.size.h}`);
  written += 1;
}
console.log(JSON.stringify({ placeholders: written, kept, dir: out.pathname }));

if (manifestPath) {
  const usedBy = (id) => Object.values(WORLDS).flatMap((w) => w.pieces.filter((p) => id.startsWith(`${p.id}-`)).map((p) => `${w.child} · ${p.label} · built after ${p.builtBy}${p.place ? ` · place «${p.place}»` : ""} · tile c${p.tile.c} r${p.tile.r}`));
  const row = (a) => `| \`${a.id}.${a.format}\` | ${a.kind}${a.stage ? ` (${a.stage})` : ""} | ${a.shows.replace(/\|/g, "/")}${usedBy(a.id).length ? `<br>*${usedBy(a.id).join("; ")}*` : ""} | ${a.footprint ? `${a.footprint.w}×${a.footprint.h}` : "—"} | ${a.size.w}×${a.size.h} | ${a.anchor.x}, ${a.anchor.y} | ${a.frames ? `${a.frames.count} frames of ${a.frames.w}×${a.frames.h}: ${a.frames.layout}` : ""}${a.notes ? `${a.frames ? "<br>" : ""}${a.notes.replace(/\|/g, "/")}` : ""} |`;
  const section = (title, filter) => [`### ${title}`, "", "| File | Kind | What it shows | Footprint (tiles) | Size (px) | Anchor (px) | Frames / notes |", "|---|---|---|---|---|---|---|", ...ASSETS.filter(filter).map(row), ""].join("\n");
  const md = `---
created: 2026-11-02
updated: 2026-11-02
status: active
---

# Home map — asset manifest (step 2B)

Every sprite the isometric home maps need, for both worlds. Style **B «cozy 3D isometric island-builder»** (approved by David on Nov 2, 13:12): match [B-cozy-isometric](style-samples/B-cozy-isometric.webp) (Santiago) and [B-isabel-garden](style-samples/B-isabel-garden.webp) (Isabel). These are style references, not the layout.

**Generated from the code** (\`src/lib/family-home-map-assets.ts\`, by \`scripts/home-map-placeholders.mjs\`); the candidate ships placeholders with exactly these names, sizes and anchors. Replace a file with final art of the same name, size and anchor, and nothing in the code changes.

## Rules for every file

- **Camera:** 2:1 dimetric (true game isometric). A ground tile is a diamond **twice as wide as it is tall**; its edges run at about 26.6° to the horizontal. Same camera height and angle as the references; no perspective distortion, no tilt.
- **Scale:** files are **2×**. One map tile is **256×128 px** in a file (the game draws everything at half size). A footprint of *w×h* tiles is **(w+h)·128 px wide**.
- **Light:** soft from the upper left; contact shadows fall to the lower right, inside the sprite.
- **Background:** transparent (PNG with alpha) for every sprite. The two islands are WebP with alpha; the water is opaque WebP.
- **Anchor:** the listed pixel sits on the map. For buildings and gardens it is the **bottom (south) corner of the footprint diamond**: x = w·128, y = the file's bottom edge. Nothing may hang below that corner except a shadow.
- **Inside the footprint:** a piece stands inside its diamond. It may rise above it (roof, mast, tank) but not spill sideways beyond the file.
- **No text** anywhere: the game writes names in its own font.
- **Stages:** *built* = finished, as in the reference. *site* = the same footprint as a marked plot with stakes and a few materials, used only while that visit is the current one. Sites are listed only for visits that are still to come (Santiago Visit 9, Isabel Visit 3); later stages follow the same pattern.
- **Variants:** some pieces follow the child's own choice in that visit (Isabel's garden and harvest table). Every variant has the same footprint, size and anchor.

## Grid and layout

Both worlds are a **12×12 grid**. Tile (c 0, r 0) is the top corner of the island; c grows towards the right corner and r towards the left corner. Positions of the pieces (top tile of the footprint) are in the table rows. The paths are drawn by the game from \`path-tile\`, so the islands carry **no paths and no buildings**.

${section("Ground and islands", (a) => a.kind === "island" || a.kind === "ground")}
${section("Santiago's pieces", (a) => a.kind === "piece" && a.world === "santiago")}
${section("Isabel's pieces", (a) => a.kind === "piece" && a.world === "isabel")}
${section("Markers, avatars, effects", (a) => a.kind === "marker" || a.kind === "avatar" || a.kind === "effect" || a.kind === "scene")}
**Total:** ${ASSETS.length} files (${ASSETS.filter((a) => a.world === "santiago").length} Santiago, ${ASSETS.filter((a) => a.world === "isabel").length} Isabel, ${ASSETS.filter((a) => a.world === "shared").length} shared).

## Delivery

Put the files in \`public/family/home-map/\` with exactly these names. Check before handing over:
1. pixel size exactly as listed (the placeholder script refuses a mismatch);
2. transparent background (except \`water\`);
3. the anchor pixel sits on the south corner of the footprint (open the matching placeholder at the same size: the red dot marks it).
`;
  fs.writeFileSync(manifestPath, md);
  console.log(JSON.stringify({ manifest: manifestPath }));
}
