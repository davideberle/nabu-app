// Pure, dependency-free logic for the recipe image assignment audit.
// Kept separate from the sharp/fs runner so it can be unit tested.

export const SEVERITY = { CONFIRMED: "confirmed", HEURISTIC: "heuristic" };

export function hamming64(a, b) {
  let x = a ^ b;
  let n = 0;
  while (x) { x &= x - 1n; n++; }
  return n;
}

/** dHash from a 9x8 grayscale buffer (row-major). Returns BigInt of 64 bits. */
export function dhashFromGray9x8(buf) {
  if (buf.length < 72) throw new Error(`dhash needs 72 gray bytes, got ${buf.length}`);
  let hash = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = buf[y * 9 + x];
      const right = buf[y * 9 + x + 1];
      hash = (hash << 1n) | (left > right ? 1n : 0n);
    }
  }
  return hash;
}

/** Colour statistics from an RGB raw buffer (no alpha). */
export function colorStats(rgb) {
  const px = rgb.length / 3;
  let sumRg = 0, sumYb = 0, sumRg2 = 0, sumYb2 = 0, white = 0, dark = 0;
  for (let i = 0; i < rgb.length; i += 3) {
    const r = rgb[i], g = rgb[i + 1], b = rgb[i + 2];
    const rg = r - g, yb = 0.5 * (r + g) - b;
    sumRg += rg; sumYb += yb; sumRg2 += rg * rg; sumYb2 += yb * yb;
    if (r > 235 && g > 235 && b > 235) white++;
    if (r < 30 && g < 30 && b < 30) dark++;
  }
  const mRg = sumRg / px, mYb = sumYb / px;
  const sRg = Math.sqrt(Math.max(0, sumRg2 / px - mRg * mRg));
  const sYb = Math.sqrt(Math.max(0, sumYb2 / px - mYb * mYb));
  // Hasler & Süsstrunk colourfulness metric
  const colorfulness = Math.sqrt(sRg * sRg + sYb * sYb) + 0.3 * Math.sqrt(mRg * mRg + mYb * mYb);
  return { colorfulness: round(colorfulness), whiteRatio: round(white / px), darkRatio: round(dark / px) };
}

function round(n) { return Math.round(n * 1000) / 1000; }

export function normalizeTokens(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
}
const STOP = new Set(["the", "and", "with", "for", "from", "of", "in", "a", "an", "to", "or", "on", "de", "la", "le", "les", "au", "aux", "et", "recipe", "recipes", "makes", "serves", "minutes", "mins"]);

/** Summarise OCR output lines for one image. */
export function summarizeOcr(lines, opts = {}) {
  const minConf = opts.minConf ?? 0.5;
  const good = (lines || []).filter((l) => (l.confidence ?? 0) >= minConf && /[a-z]{3,}/i.test(l.text));
  const words = good.flatMap((l) => l.text.split(/\s+/)).filter((w) => /[a-z]{2,}/i.test(w));
  const bigLines = good.filter((l) => (l.h ?? 0) >= 0.035);
  return {
    confidentLines: good.length,
    words: words.length,
    bigLines: bigLines.length,
    text: good.map((l) => l.text).join(" | "),
  };
}

/**
 * Classify an image as probably not a food photo using deterministic heuristics.
 * Returns { kind, confidence, reasons } or null when nothing is suspicious.
 * kind: text-page | title-page | low-colour-graphic
 */
export function classifyNonFood({ ocr, stats, width, height }) {
  const reasons = [];
  if (ocr && ocr.confidentLines >= 8 && ocr.words >= 30) {
    reasons.push(`OCR found ${ocr.confidentLines} confident text lines (${ocr.words} words): looks like a text/recipe page`);
    return { kind: "text-page", confidence: ocr.confidentLines >= 15 ? 0.9 : 0.7, reasons };
  }
  const flat = stats && (stats.whiteRatio >= 0.55 || stats.darkRatio >= 0.7);
  if (ocr && ocr.bigLines >= 1 && ocr.words <= 14 && flat) {
    reasons.push(`large text (${ocr.bigLines} big lines, ${ocr.words} words) on a flat background (white ${stats.whiteRatio}, dark ${stats.darkRatio}): looks like a chapter/title page`);
    return { kind: "title-page", confidence: 0.75, reasons };
  }
  if (stats && stats.colorfulness < 8 && flat) {
    reasons.push(`very low colourfulness (${stats.colorfulness}) with flat background (white ${stats.whiteRatio}, dark ${stats.darkRatio}): possible line drawing/graphic`);
    return { kind: "low-colour-graphic", confidence: 0.5, reasons };
  }
  return null;
}

export function lowResolution(width, height) {
  if (!width || !height) return null;
  const minSide = Math.min(width, height);
  if (minSide < 150) return { severity: SEVERITY.CONFIRMED, confidence: 0.95, reason: `min side ${minSide}px < 150px` };
  if (minSide < 300 || width * height < 120000) return { severity: SEVERITY.HEURISTIC, confidence: 0.7, reason: `min side ${minSide}px or area ${width * height}px below thumbnail threshold` };
  return null;
}

/** Overlap between OCR words and a recipe title: how many title tokens appear in OCR text. */
export function titleOcrOverlap(title, ocrText) {
  const t = new Set(normalizeTokens(title));
  if (t.size === 0) return { own: 0, total: 0 };
  const o = new Set(normalizeTokens(ocrText));
  let n = 0;
  for (const w of t) if (o.has(w)) n++;
  return { own: n, total: t.size };
}

/** Are two recipe names the same recipe (modulo case/punctuation/parser garbling)? */
export function namesEquivalent(a, b) {
  const na = normalizeTokens(a).join(" ");
  const nb = normalizeTokens(b).join(" ");
  return na.length > 0 && na === nb;
}

/**
 * Group recipes sharing an identical image (by digest). Returns groups with >1 distinct recipe.
 */
export function manyToOneGroups(recipeDigests) {
  const byDigest = new Map();
  for (const { id, name, digest } of recipeDigests) {
    if (!digest) continue;
    if (!byDigest.has(digest)) byDigest.set(digest, []);
    byDigest.get(digest).push({ id, name });
  }
  const groups = [];
  for (const [digest, recipes] of byDigest) {
    if (recipes.length < 2) continue;
    const allEquivalent = recipes.every((r) => namesEquivalent(r.name, recipes[0].name));
    groups.push({ digest, recipes, allEquivalent });
  }
  return groups.sort((a, b) => b.recipes.length - a.recipes.length);
}

/** Exact reconciliation: every source file and every app recipe must land in exactly one bucket. */
export function reconcile({ sourceFiles, appRecipes, bundleIds, excludedDirs }) {
  const excluded = sourceFiles.filter((f) => excludedDirs.has(f.dir));
  const active = sourceFiles.filter((f) => !excludedDirs.has(f.dir));
  const unparsable = active.filter((f) => f.error);
  const parsed = active.filter((f) => !f.error);
  const noId = parsed.filter((f) => !f.id);
  const withId = parsed.filter((f) => f.id);
  const idToFiles = new Map();
  for (const f of withId) {
    if (!idToFiles.has(f.id)) idToFiles.set(f.id, []);
    idToFiles.get(f.id).push(f.path);
  }
  const appIds = new Set(appRecipes.map((r) => r.id));
  const sourceIds = [...idToFiles.keys()];
  const sourceInApp = sourceIds.filter((id) => appIds.has(id));
  const sourceOnly = sourceIds.filter((id) => !appIds.has(id));
  const appOnly = appRecipes.filter((r) => !idToFiles.has(r.id)).map((r) => r.id);
  const duplicateSourceIds = [...idToFiles.entries()].filter(([, files]) => files.length > 1).map(([id, files]) => ({ id, files }));
  const bundleSet = new Set(bundleIds);
  const appNotInBundle = appRecipes.filter((r) => !bundleSet.has(r.id)).map((r) => r.id);
  const bundleNotInApp = bundleIds.filter((id) => !appIds.has(id));
  const checks = {
    sourceFilesAccounted: excluded.length + unparsable.length + noId.length + withId.length === sourceFiles.length,
    appRecipesAccounted: sourceInApp.length + appOnly.length === appRecipes.length,
    sourceIdsAccounted: sourceInApp.length + sourceOnly.length === sourceIds.length,
    bundleMatchesApp: appNotInBundle.length === 0 && bundleNotInApp.length === 0 && bundleIds.length === appRecipes.length,
  };
  return {
    counts: {
      sourceFiles: sourceFiles.length,
      sourceExcludedSingleRecipeDirs: excluded.length,
      sourceUnparsable: unparsable.length,
      sourceMissingId: noId.length,
      sourceFilesWithId: withId.length,
      sourceUniqueIds: sourceIds.length,
      sourceIdsDuplicatedAcrossDirs: duplicateSourceIds.length,
      sourceIdsInApp: sourceInApp.length,
      sourceIdsNotInApp: sourceOnly.length,
      appRecipes: appRecipes.length,
      appRecipesWithSource: sourceInApp.length,
      appRecipesWithoutSource: appOnly.length,
      bundleRecipes: bundleIds.length,
    },
    checks,
    allChecksPass: Object.values(checks).every(Boolean),
    detail: { excluded: excluded.map((f) => f.path), unparsable: unparsable.map((f) => ({ path: f.path, error: f.error })), noId: noId.map((f) => f.path), sourceOnly, appOnly, duplicateSourceIds, appNotInBundle, bundleNotInApp },
  };
}

/** Deterministic repair selection: only confirmed low-resolution assignments (min side < 150px). */
export function selectRepairs(audit) {
  return (audit.confirmed || [])
    .filter((f) => f.type === "low-resolution" && Math.min(f.width, f.height) < 150 && typeof f.image === "string" && f.image.startsWith("/recipes/"))
    .map((f) => ({ recipeId: f.recipeId, image: f.image, width: f.width, height: f.height, rule: "R1", reason: f.reasons?.[0] }));
}
