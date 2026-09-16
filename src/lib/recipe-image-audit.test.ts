import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  hamming64, dhashFromGray9x8, colorStats, summarizeOcr, classifyNonFood, lowResolution,
  titleOcrOverlap, namesEquivalent, manyToOneGroups, reconcile, selectRepairs,
} from "../../scripts/audit/audit-core.mjs";

test("dhash is stable and hamming distance counts differing bits", () => {
  const gradient = Buffer.from(Array.from({ length: 72 }, (_, i) => (i % 9) * 20));
  const h = dhashFromGray9x8(gradient);
  assert.equal(h, BigInt(0)); // left never brighter than right
  const inv = Buffer.from(Array.from({ length: 72 }, (_, i) => 255 - (i % 9) * 20));
  assert.equal(dhashFromGray9x8(inv), BigInt("0xffffffffffffffff"));
  assert.equal(hamming64(BigInt(0), BigInt("0xffffffffffffffff")), 64);
  assert.equal(hamming64(BigInt(11), BigInt(2)), 2);
});

test("colorStats flags flat white pages and colourful photos", () => {
  const white = Buffer.alloc(3 * 16, 255);
  const s = colorStats(white);
  assert.equal(s.whiteRatio, 1);
  assert.equal(s.colorfulness, 0);
  const colourful = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]);
  assert.ok(colorStats(colourful).colorfulness > 50);
});

test("classifyNonFood separates text pages, title pages and photos", () => {
  const lines = Array.from({ length: 20 }, (_, i) => ({ text: `ingredient line number ${i}`, confidence: 0.9, h: 0.01 }));
  const textPage = classifyNonFood({ ocr: summarizeOcr(lines), stats: { whiteRatio: 0.8, darkRatio: 0, colorfulness: 5 }, width: 800, height: 1000 });
  assert.equal(textPage?.kind, "text-page");
  const title = classifyNonFood({ ocr: summarizeOcr([{ text: "VEGETABLES", confidence: 0.9, h: 0.08 }]), stats: { whiteRatio: 0.7, darkRatio: 0, colorfulness: 3 }, width: 800, height: 1000 });
  assert.equal(title?.kind, "title-page");
  const photo = classifyNonFood({ ocr: summarizeOcr([]), stats: { whiteRatio: 0.05, darkRatio: 0.1, colorfulness: 40 }, width: 800, height: 1000 });
  assert.equal(photo, null);
});

test("lowResolution thresholds: icons are confirmed, small thumbs heuristic, photos pass", () => {
  assert.equal(lowResolution(27, 26)?.severity, "confirmed");
  assert.equal(lowResolution(280, 400)?.severity, "heuristic");
  assert.equal(lowResolution(1200, 800), null);
});

test("title/OCR overlap and garbled-name equivalence", () => {
  assert.deepEqual(titleOcrOverlap("Spiced Beef & Potato Cakes", "spiced beef potato cakes kotlet"), { own: 4, total: 4 });
  assert.ok(namesEquivalent("Moroccan Salmon Cakes with Garlic Mayonnaise", "Moroccan Salmon Cakes With Garlic Mayonnaise"));
  assert.ok(!namesEquivalent("Basic Hummus", "Musabaha"));
});

test("manyToOneGroups separates duplicate records from suspicious sharing", () => {
  const groups = manyToOneGroups([
    { id: "a", name: "Moroccan Carrots", digest: "x" },
    { id: "b", name: "moroccan carrots", digest: "x" },
    { id: "c", name: "Basic Hummus", digest: "y" },
    { id: "d", name: "Musabaha", digest: "y" },
    { id: "e", name: "Solo", digest: "z" },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups.find((g) => g.digest === "x")?.allEquivalent, true);
  assert.equal(groups.find((g) => g.digest === "y")?.allEquivalent, false);
});

test("reconcile accounts for every source file and app recipe exactly", () => {
  const r = reconcile({
    sourceFiles: [
      { path: "book/a.json", dir: "book", id: "a" },
      { path: "book2/a.json", dir: "book2", id: "a" },
      { path: "book/index.json", dir: "book", id: null },
      { path: "single/recipe.json", dir: "single", id: "s" },
      { path: "book/b.json", dir: "book", id: "b" },
    ],
    appRecipes: [{ id: "a" }, { id: "app-only" }],
    bundleIds: ["a", "app-only"],
    excludedDirs: new Set(["single"]),
  });
  assert.equal(r.allChecksPass, true);
  assert.equal(r.counts.sourceExcludedSingleRecipeDirs, 1);
  assert.equal(r.counts.sourceMissingId, 1);
  assert.equal(r.counts.sourceUniqueIds, 2);
  assert.equal(r.counts.sourceIdsDuplicatedAcrossDirs, 1);
  assert.deepEqual(r.detail.sourceOnly, ["b"]);
  assert.deepEqual(r.detail.appOnly, ["app-only"]);
});

test("selectRepairs requires explicit reviewed ids and never repairs by size alone", () => {
  const picked = selectRepairs({ confirmed: [
    { type: "low-resolution", recipeId: "icon", image: "/recipes/icon.jpg", width: 27, height: 26, reasons: ["min side 26px < 150px"] },
    { type: "low-resolution", recipeId: "tiny-unreviewed", image: "/recipes/tiny.jpg", width: 20, height: 20 },
    { type: "low-resolution", recipeId: "thumb", image: "/recipes/thumb.jpg", width: 200, height: 300 },
    { type: "broken-missing-file", recipeId: "gone", image: "/recipes/gone.jpg" },
  ] }, new Set(["icon"]));
  assert.deepEqual(picked.map((p: { recipeId: string }) => p.recipeId), ["icon"]);
  assert.equal(selectRepairs({ confirmed: [{ type: "low-resolution", recipeId: "icon", image: "/recipes/icon.jpg", width: 27, height: 26 }] }).length, 0);
});

test("applied repairs are reflected in app recipe data", () => {
  const p = join(process.cwd(), "docs", "audits", "recipe-image-repairs.json");
  if (!existsSync(p)) return; // repairs not yet applied in this checkout
  const record = JSON.parse(readFileSync(p, "utf8"));
  assert.ok(record.count > 0);
  for (const r of record.repairs) {
    const rec = JSON.parse(readFileSync(join(process.cwd(), "src", "data", "recipes", `${r.recipeId}.json`), "utf8"));
    assert.equal(rec.image, null, `${r.recipeId} should have image null`);
    assert.equal(record.reviewStatus, "visually-reviewed");
  }
});
