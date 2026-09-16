#!/usr/bin/env node
// Recipe image assignment audit.
//
//   node scripts/audit/recipe-image-audit.mjs \
//     [--kitchen ../../kitchen] [--ocr tmp-audit/ocr-all.jsonl] \
//     [--out docs/audits/recipe-image-audit.json] [--contact-sheet tmp-audit/contact-sheet.png]
//
// Inventories every app recipe, every assigned image, orphan/broken assets,
// exact + perceptual duplicates, many-to-one assignments, low resolution,
// OCR/colour non-food heuristics, and source-provenance mismatches.
// Heuristic findings are kept separate from confirmed defects.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "fs";
import { join, dirname, resolve, basename } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import sharp from "sharp";
import {
  SEVERITY, hamming64, dhashFromGray9x8, colorStats, summarizeOcr, classifyNonFood,
  lowResolution, titleOcrOverlap, manyToOneGroups, reconcile, namesEquivalent, normalizeTokens,
} from "./audit-core.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, "..", "..");
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true] : []).filter(Boolean));
const KITCHEN = resolve(args.kitchen || join(APP_ROOT, "..", "kitchen"));
const OCR_PATH = args.ocr ? resolve(args.ocr) : null;
const OUT = resolve(args.out || join(APP_ROOT, "docs", "audits", "recipe-image-audit.json"));
const SHEET = args["contact-sheet"] ? resolve(args["contact-sheet"]) : null;
const REPAIRS_PATH = join(APP_ROOT, "docs", "audits", "recipe-image-repairs.json");
const RECIPES_DIR = join(APP_ROOT, "src", "data", "recipes");
const BUNDLE = join(APP_ROOT, "src", "data", "recipes-bundle.json");
const PUBLIC_RECIPES = join(APP_ROOT, "public", "recipes");
// Mirrors kitchen/cookbook-ingestion/sync-source-to-app.cjs EXCLUDED_DIRS
const EXCLUDED_DIRS = new Set(["asparagus-with-hummus", "banana-muesli", "brokkolisalat-mit-kichererbsen-und-erdnuessen", "buttermilk-curry-chicken", "cauliflower-rice", "chicken-harissa-kebabs", "flatbreads-with-lentils", "poulet-tajine", "roasted-kohlrabi-with-sesame-seeds-and-feta", "silken-tofu-bolognese", "weisse-bohnen-suppe-mit-basilikum-und-mandeln", "wild-garlic-and-barley-fritters"]);

const log = (...a) => console.error(...a);

// ---------- inventory ----------
const appRecipes = readdirSync(RECIPES_DIR).filter((f) => f.endsWith(".json") && f !== "index.json").sort().map((f) => {
  const r = JSON.parse(readFileSync(join(RECIPES_DIR, f), "utf8"));
  return { file: f, id: r.id, name: r.name, image: r.image ?? null, cookbook: r.source?.cookbook ?? null, chapter: r.source?.chapter ?? null, ingredientCount: (r.ingredients || []).length, methodCount: (r.method || []).length };
});
const bundleIds = existsSync(BUNDLE) ? JSON.parse(readFileSync(BUNDLE, "utf8")).map((r) => r.id) : [];

const sourceFiles = [];
const sourceById = new Map();
const kitchenRecipes = join(KITCHEN, "recipes");
for (const dir of readdirSync(kitchenRecipes).sort()) {
  const full = join(kitchenRecipes, dir);
  if (!statSync(full).isDirectory()) continue;
  for (const f of readdirSync(full).filter((x) => x.endsWith(".json")).sort()) {
    const p = join(full, f);
    try {
      const r = JSON.parse(readFileSync(p, "utf8"));
      const entry = { path: `${dir}/${f}`, dir, id: r.id ?? null, name: r.name, image: r.image ?? null, cookbook: r.source?.cookbook ?? null };
      sourceFiles.push(entry);
      if (r.id && !EXCLUDED_DIRS.has(dir)) { if (!sourceById.has(r.id)) sourceById.set(r.id, []); sourceById.get(r.id).push(entry); }
    } catch (e) { sourceFiles.push({ path: `${dir}/${f}`, dir, id: null, error: String(e.message || e) }); }
  }
}
const reconciliation = reconcile({ sourceFiles, appRecipes, bundleIds, excludedDirs: EXCLUDED_DIRS });

const publicFiles = readdirSync(PUBLIC_RECIPES).filter((f) => !f.startsWith(".")).sort();
const publicSet = new Set(publicFiles);
const reviewedRepairs = existsSync(REPAIRS_PATH) ? JSON.parse(readFileSync(REPAIRS_PATH, "utf8")) : null;

// ---------- image references ----------
const refs = []; // { recipe, kind: local|external|none, file }
for (const r of appRecipes) {
  if (!r.image) refs.push({ recipe: r, kind: "none" });
  else if (/^https?:\/\//.test(r.image)) refs.push({ recipe: r, kind: "external" });
  else if (r.image.startsWith("/recipes/")) refs.push({ recipe: r, kind: "local", file: r.image.slice("/recipes/".length) });
  else refs.push({ recipe: r, kind: "malformed" });
}
const referencedFiles = new Set(refs.filter((x) => x.kind === "local").map((x) => x.file));
const orphanFiles = publicFiles.filter((f) => !referencedFiles.has(f));

// ---------- OCR ----------
const ocrByFile = new Map();
if (OCR_PATH && existsSync(OCR_PATH)) {
  for (const line of readFileSync(OCR_PATH, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const o = JSON.parse(line);
    ocrByFile.set(basename(o.path), o);
  }
  log(`OCR rows loaded: ${ocrByFile.size}`);
}

// ---------- image analysis (all public files, so orphans are analysed too) ----------
async function analyse(file) {
  const p = join(PUBLIC_RECIPES, file);
  const buf = readFileSync(p);
  const digest = createHash("sha256").update(buf).digest("hex");
  const out = { file, bytes: buf.length, digest };
  try {
    const img = sharp(buf, { failOn: "none" });
    const meta = await img.metadata();
    out.width = meta.width; out.height = meta.height; out.format = meta.format;
    const gray = await img.clone().grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
    out.dhash = dhashFromGray9x8(gray).toString(16).padStart(16, "0");
    const rgb = await img.clone().removeAlpha().resize(48, 48, { fit: "fill" }).raw().toBuffer();
    out.stats = colorStats(rgb);
  } catch (e) { out.decodeError = String(e.message || e); }
  return out;
}
const analysis = new Map();
{
  const queue = [...publicFiles];
  let done = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (queue.length) { const f = queue.shift(); analysis.set(f, await analyse(f)); if (++done % 500 === 0) log(`analysed ${done}/${publicFiles.length}`); }
  }));
}

// ---------- findings ----------
const confirmed = [];
const heuristic = [];
const add = (list, f) => list.push(f);
const nameById = new Map(appRecipes.map((r) => [r.id, r]));

for (const ref of refs) {
  const r = ref.recipe;
  if (ref.kind === "malformed") add(confirmed, { type: "malformed-image-path", recipeId: r.id, image: r.image, confidence: 1, reasons: ["image field is neither /recipes/<file> nor https URL"] });
  if (ref.kind !== "local") continue;
  const a = analysis.get(ref.file);
  if (!a) { add(confirmed, { type: "broken-missing-file", recipeId: r.id, image: r.image, confidence: 1, reasons: ["referenced file does not exist in public/recipes"] }); continue; }
  if (a.decodeError || !a.width) { add(confirmed, { type: "broken-undecodable", recipeId: r.id, image: r.image, confidence: 1, reasons: [a.decodeError || "no dimensions"] }); continue; }
  if (a.bytes === 0) add(confirmed, { type: "broken-empty-file", recipeId: r.id, image: r.image, confidence: 1, reasons: ["0 bytes"] });
  const lr = lowResolution(a.width, a.height);
  if (lr) add(lr.severity === SEVERITY.CONFIRMED ? confirmed : heuristic, { type: "low-resolution", recipeId: r.id, image: r.image, width: a.width, height: a.height, confidence: lr.confidence, reasons: [lr.reason] });
  const ocrRow = ocrByFile.get(ref.file);
  const ocr = ocrRow ? summarizeOcr(ocrRow.lines) : null;
  const nf = classifyNonFood({ ocr, stats: a.stats, width: a.width, height: a.height });
  if (nf) add(heuristic, { type: `non-food:${nf.kind}`, recipeId: r.id, image: r.image, confidence: nf.confidence, reasons: nf.reasons, ocrText: ocr?.text?.slice(0, 200) });
  // Semantic: OCR text names a *different* recipe from the same book but not this one
  if (ocr && ocr.words >= 2) {
    const own = titleOcrOverlap(r.name, ocr.text);
    const ocrTokens = new Set(normalizeTokens(ocr.text));
    let best = null;
    for (const other of appRecipes) {
      if (other.id === r.id || other.cookbook !== r.cookbook) continue;
      const t = normalizeTokens(other.name);
      if (t.length < 2) continue;
      const hits = t.filter((w) => ocrTokens.has(w)).length;
      if (hits >= 2 && hits === t.length && (!best || hits > best.hits)) best = { id: other.id, name: other.name, hits };
    }
    if (best && own.own === 0 && !namesEquivalent(best.name, r.name)) {
      add(heuristic, { type: "ocr-names-other-recipe", recipeId: r.id, image: r.image, confidence: 0.6, reasons: [`OCR text fully matches title of "${best.name}" (${best.id}) and none of this recipe's title tokens`], ocrText: ocr.text.slice(0, 200) });
    }
  }
  // Provenance vs kitchen source
  const src = sourceById.get(r.id);
  if (src) {
    const srcImages = [...new Set(src.map((s) => s.image))];
    if (!srcImages.includes(r.image)) {
      const reasons = srcImages.every((x) => x == null)
        ? ["kitchen source has image:null; app image was added by an app-side backfill and is unverified against source"]
        : [`kitchen source image differs: ${srcImages.join(", ")}`];
      add(heuristic, { type: srcImages.every((x) => x == null) ? "provenance:app-only-image" : "provenance:source-image-differs", recipeId: r.id, image: r.image, sourceImages: srcImages, confidence: 0.4, reasons });
    }
    const srcBooks = [...new Set(src.map((s) => s.cookbook))];
    if (r.cookbook && !srcBooks.includes(r.cookbook)) add(heuristic, { type: "provenance:cookbook-differs", recipeId: r.id, appCookbook: r.cookbook, sourceCookbooks: srcBooks, confidence: 0.5, reasons: ["app source.cookbook differs from kitchen source"] });
  } else {
    add(heuristic, { type: "provenance:no-kitchen-source", recipeId: r.id, image: r.image, confidence: 0.5, reasons: ["app recipe has no matching kitchen source file (id not found)"] });
  }
}
// Source recipes whose source image path is set but file is missing in app
for (const [id, entries] of sourceById) {
  const appR = nameById.get(id);
  for (const e of entries) {
    if (e.image && e.image.startsWith("/recipes/") && !publicSet.has(e.image.slice(9))) {
      add(confirmed, { type: "source-image-missing-in-app", recipeId: id, sourcePath: e.path, image: e.image, appImage: appR?.image ?? null, confidence: 1, reasons: ["kitchen source references an image file that does not exist in app public/recipes"] });
    }
  }
}

// Many-to-one: exact
const recipeDigests = refs.filter((x) => x.kind === "local" && analysis.get(x.file)?.digest).map((x) => ({ id: x.recipe.id, name: x.recipe.name, digest: analysis.get(x.file).digest, file: x.file }));
const exactGroups = manyToOneGroups(recipeDigests);
for (const g of exactGroups) {
  const files = [...new Set(recipeDigests.filter((d) => d.digest === g.digest).map((d) => d.file))];
  if (g.allEquivalent) add(confirmed, { type: "duplicate-recipe-records-share-image", digest: g.digest, recipes: g.recipes, files, confidence: 0.95, reasons: ["distinct recipe ids with equivalent names share a byte-identical image: duplicate recipe records, not an image defect"] });
  else add(heuristic, { type: "many-to-one-exact", digest: g.digest, recipes: g.recipes, files, confidence: 0.8, reasons: [`${g.recipes.length} recipes with different names share a byte-identical image; at most one can be right unless the book prints one photo for several recipes`] });
}
// Perceptual near-duplicates across different recipes (not already exact)
const perceptual = [];
{
  const items = recipeDigests.map((d) => ({ ...d, h: BigInt("0x" + analysis.get(d.file).dhash) }));
  const seenPairs = new Set();
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (a.digest === b.digest || a.id === b.id) continue;
    const d = hamming64(a.h, b.h);
    if (d <= 4) { const k = [a.file, b.file].sort().join("|"); if (seenPairs.has(k)) continue; seenPairs.add(k); perceptual.push({ a: { id: a.id, name: a.name, file: a.file }, b: { id: b.id, name: b.name, file: b.file }, distance: d, equivalentNames: namesEquivalent(a.name, b.name) }); }
  }
}
for (const p of perceptual) add(heuristic, { type: "many-to-one-perceptual", pair: [p.a, p.b], distance: p.distance, confidence: p.distance <= 2 ? 0.7 : 0.5, reasons: [`dHash distance ${p.distance}: visually near-identical images assigned to different recipes${p.equivalentNames ? " (equivalent names: duplicate records)" : ""}`] });

// Orphans, exact duplicates among all files
const orphanDetail = orphanFiles.map((f) => { const a = analysis.get(f); return { file: f, bytes: a?.bytes, width: a?.width, height: a?.height, decodeError: a?.decodeError }; });
const orphanDupOfReferenced = orphanDetail.filter((o) => { const a = analysis.get(o.file); return a && recipeDigests.some((d) => d.digest === a.digest); }).length;

// ---------- salmon cases ----------
const salmon = appRecipes.filter((r) => /salmon/i.test(r.name)).map((r) => {
  const a = r.image?.startsWith("/recipes/") ? analysis.get(r.image.slice(9)) : null;
  const fc = [...confirmed, ...heuristic].filter((f) => f.recipeId === r.id || f.recipes?.some((x) => x.id === r.id) || f.pair?.some((x) => x.id === r.id)).map((f) => f.type);
  return { id: r.id, name: r.name, cookbook: r.cookbook, image: r.image, exists: a ? !a.decodeError : r.image ? false : null, width: a?.width, height: a?.height, digest: a?.digest?.slice(0, 12), source: sourceById.get(r.id)?.map((s) => s.path) ?? [], findings: fc };
});

// ---------- summary ----------
const summary = {
  generatedAt: new Date().toISOString(),
  appRoot: APP_ROOT, kitchenRoot: KITCHEN, ocrUsed: ocrByFile.size > 0, ocrRows: ocrByFile.size,
  visionEmbeddingModel: "not available locally (no CLIP/open_clip weights); semantic title-vs-image similarity skipped, OCR-based title check used instead",
  scopeLimitations: [
    "No local CLIP/open_clip model was available, so semantic title-versus-image comparison was not performed.",
    "The cookbook EPUB/PDF source files were not compared page-by-page, so source-photo assignment remains incomplete for the heuristic queue.",
  ],
  reviewedRepairs: reviewedRepairs ? {
    count: reviewedRepairs.count,
    reviewStatus: reviewedRepairs.reviewStatus,
    rule: reviewedRepairs.rule,
    before: { withLocalImage: refs.filter((x) => x.kind === "local").length + reviewedRepairs.count, orphans: orphanFiles.length - reviewedRepairs.count },
    after: { withLocalImage: refs.filter((x) => x.kind === "local").length, orphans: orphanFiles.length },
    evidenceFile: "docs/audits/recipe-image-repairs.json",
  } : null,
  recipes: {
    total: appRecipes.length,
    withLocalImage: refs.filter((x) => x.kind === "local").length,
    withExternalImage: refs.filter((x) => x.kind === "external").length,
    withoutImage: refs.filter((x) => x.kind === "none").length,
    malformedImage: refs.filter((x) => x.kind === "malformed").length,
  },
  assets: {
    publicFiles: publicFiles.length,
    referencedDistinct: referencedFiles.size,
    referencedExisting: [...referencedFiles].filter((f) => publicSet.has(f)).length,
    referencedMissing: [...referencedFiles].filter((f) => !publicSet.has(f)).length,
    orphans: orphanFiles.length,
    orphansByteIdenticalToReferenced: orphanDupOfReferenced,
    undecodable: [...analysis.values()].filter((a) => a.decodeError).length,
    distinctDigests: new Set([...analysis.values()].map((a) => a.digest)).size,
  },
  findings: {
    confirmed: countBy(confirmed, "type"),
    heuristic: countBy(heuristic, "type"),
    confirmedTotal: confirmed.length, heuristicTotal: heuristic.length,
  },
  reconciliation,
};
function countBy(list, k) { const m = {}; for (const x of list) m[x[k]] = (m[x[k]] || 0) + 1; return m; }

const artifact = { summary, confirmed, heuristic, salmon, orphans: orphanDetail, images: [...analysis.values()].map(({ file, bytes, digest, width, height, format, dhash, stats, decodeError }) => ({ file, bytes, digest, width, height, format, dhash, stats, decodeError })) };
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(artifact, null, 1));
log(`wrote ${OUT}`);
console.log(JSON.stringify(summary, null, 2));

// ---------- contact sheet of high/medium-risk findings ----------
if (SHEET) {
  const picks = [];
  const seen = new Set();
  const push = (category, label, file, stableIds = []) => { if (file && !seen.has(file) && publicSet.has(file)) { seen.add(file); picks.push({ category, label, file, stableIds }); } };
  const sample = (items, limit, fn) => items.slice(0, limit).forEach(fn);
  if (reviewedRepairs) sample(reviewedRepairs.repairs, 12, (r) => push("reviewed-repair", `C reviewed icon ${r.recipeId}`, r.image.slice(9), [r.recipeId]));
  sample(heuristic.filter((h) => h.type === "many-to-one-exact"), 18, (f) => (f.files || []).slice(0, 1).forEach((fl) => push("many-to-one-exact", `H exact ${f.recipes?.[0]?.id || "group"}`, fl, (f.recipes || []).map((r) => r.id))));
  sample(heuristic.filter((h) => h.type === "ocr-names-other-recipe"), 12, (f) => push("ocr-mismatch", `H OCR ${f.recipeId}`, f.image?.slice(9), [f.recipeId]));
  sample(heuristic.filter((h) => h.type === "non-food:text-page" || h.type === "non-food:title-page"), 12, (f) => push("text-or-title-page", `H ${f.type} ${f.recipeId}`, f.image?.slice(9), [f.recipeId]));
  sample(heuristic.filter((h) => h.type === "low-resolution"), 12, (f) => push("low-resolution", `H low-res ${f.recipeId}`, f.image?.slice(9), [f.recipeId]));
  sample(heuristic.filter((h) => h.type === "provenance:cookbook-differs"), 8, (f) => push("cookbook-mismatch", `H cookbook ${f.recipeId}`, nameById.get(f.recipeId)?.image?.slice(9), [f.recipeId]));
  sample(salmon.filter((r) => r.image?.startsWith("/recipes/")), 24, (r) => push("salmon", `S ${r.id}`, r.image.slice(9), [r.id]));
  const cols = 6, cell = 220, labelH = 34, n = Math.min(picks.length, 96);
  const rows = Math.ceil(n / cols);
  const comps = [];
  for (let i = 0; i < n; i++) {
    const { label, file } = picks[i];
    const x = (i % cols) * cell, y = Math.floor(i / cols) * (cell + labelH);
    try {
      const thumb = await sharp(join(PUBLIC_RECIPES, file), { failOn: "none" }).resize(cell - 8, cell - 8, { fit: "inside" }).jpeg().toBuffer();
      comps.push({ input: thumb, left: x + 4, top: y + 4 });
    } catch { /* leave blank */ }
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const svg = `<svg width="${cell}" height="${labelH}"><rect width="100%" height="100%" fill="#111"/><text x="4" y="13" font-size="9" fill="#fff" font-family="monospace">${esc(label.slice(0, 40))}</text><text x="4" y="27" font-size="9" fill="#9cf" font-family="monospace">${esc(file.slice(0, 40))}</text></svg>`;
    comps.push({ input: Buffer.from(svg), left: x, top: y + cell });
  }
  if (n > 0) {
    await sharp({ create: { width: cols * cell, height: rows * (cell + labelH), channels: 3, background: "#222" } }).composite(comps).png().toFile(SHEET);
    writeFileSync(`${SHEET}.json`, JSON.stringify({ generatedAt: summary.generatedAt, sheet: SHEET, tileCount: n, categories: countBy(picks.slice(0, n), "category"), tiles: picks.slice(0, n) }, null, 2));
    log(`contact sheet: ${SHEET} (${n} tiles)`);
  }
}
