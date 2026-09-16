#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifestPath = join(root, "docs", "audits", "recipe-image-cleanup-round2.json");
const auditPath = join(root, "docs", "audits", "recipe-image-audit.json");
const recipesDir = join(root, "src", "data", "recipes");
const publicDir = join(root, "public", "recipes");
const quarantineDir = join(root, "docs", "audits", "quarantine", "recipe-duplicates-20260916");
const dryRun = process.argv.includes("--dry-run");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const audit = JSON.parse(readFileSync(auditPath, "utf8"));
if (manifest.reviewStatus !== "visually-reviewed") throw new Error("round-2 manifest is not visually reviewed");

const findings = new Map(
  [...audit.confirmed, ...audit.heuristic]
    .filter((f) => f.recipeId && f.image)
    .map((f) => [`${f.type}|${f.recipeId}|${f.image}`, f]),
);

let imagesCleared = 0;
for (const repair of manifest.imageRepairs) {
  const evidenceKey = `${repair.evidence}|${repair.recipeId}|${repair.image}`;
  if (!findings.has(evidenceKey)) throw new Error(`audit no longer proves ${evidenceKey}`);
  const recipePath = join(recipesDir, `${repair.recipeId}.json`);
  const recipe = JSON.parse(readFileSync(recipePath, "utf8"));
  if (recipe.image === null) continue;
  if (recipe.image !== repair.image) throw new Error(`${repair.recipeId} image drifted to ${recipe.image}`);
  if (!dryRun) {
    recipe.image = null;
    writeFileSync(recipePath, `${JSON.stringify(recipe, null, 2)}\n`);
  }
  imagesCleared += 1;
}

const duplicateFindings = new Map(
  audit.confirmed
    .filter((f) => f.type === "duplicate-recipe-records-share-image")
    .flatMap((f) => f.recipes.map((r) => [r.id, f])),
);
let duplicatesQuarantined = 0;
if (!dryRun) mkdirSync(quarantineDir, { recursive: true });
for (const pair of manifest.duplicateRecipes) {
  const finding = duplicateFindings.get(pair.quarantineId);
  if (!finding || finding.digest !== pair.digest || !finding.recipes.some((r) => r.id === pair.canonicalId)) {
    throw new Error(`audit no longer proves duplicate pair ${pair.quarantineId} -> ${pair.canonicalId}`);
  }
  const sourcePath = join(recipesDir, `${pair.quarantineId}.json`);
  const targetPath = join(quarantineDir, `${pair.quarantineId}.json`);
  const canonicalPath = join(recipesDir, `${pair.canonicalId}.json`);
  if (!existsSync(canonicalPath)) throw new Error(`missing canonical record ${pair.canonicalId}`);
  if (!existsSync(sourcePath)) {
    if (existsSync(targetPath)) continue;
    throw new Error(`missing duplicate record ${pair.quarantineId}`);
  }
  const duplicate = JSON.parse(readFileSync(sourcePath, "utf8"));
  const canonical = JSON.parse(readFileSync(canonicalPath, "utf8"));
  const duplicateImage = basename(duplicate.image || "");
  const canonicalImage = basename(canonical.image || "");
  const digest = (file) => createHash("sha256").update(readFileSync(join(publicDir, file))).digest("hex");
  if (!duplicateImage || !canonicalImage || digest(duplicateImage) !== pair.digest || digest(canonicalImage) !== pair.digest) {
    throw new Error(`image evidence drifted for duplicate pair ${pair.quarantineId} -> ${pair.canonicalId}`);
  }
  if (!dryRun) renameSync(sourcePath, targetPath);
  duplicatesQuarantined += 1;
}

console.log(JSON.stringify({ dryRun, imagesCleared, duplicatesQuarantined }));
