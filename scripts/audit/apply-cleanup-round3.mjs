#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(readFileSync(join(root, "docs", "audits", "recipe-image-cleanup-round3.json"), "utf8"));
const audit = JSON.parse(readFileSync(join(root, "docs", "audits", "recipe-image-audit.json"), "utf8"));
const recipesDir = join(root, "src", "data", "recipes");
const publicDir = join(root, "public", "recipes");
const dryRun = process.argv.includes("--dry-run");
if (manifest.reviewStatus !== "visually-reviewed") throw new Error("round-3 manifest is not visually reviewed");

const perceptual = audit.heuristic.filter((f) => f.type === "many-to-one-perceptual");
const digest = (file) => createHash("sha256").update(readFileSync(join(publicDir, file))).digest("hex");
const repairs = [];
for (const group of manifest.exactGroups.filter((g) => !g.keepAll)) {
  for (const id of group.remove) repairs.push({ id, kind: "exact", group });
}
for (const group of manifest.perceptualGroups.filter((g) => !g.keepAll)) {
  for (const id of group.remove) repairs.push({ id, kind: "perceptual", group });
}

let imagesCleared = 0;
for (const repair of repairs) {
  const path = join(recipesDir, `${repair.id}.json`);
  const recipe = JSON.parse(readFileSync(path, "utf8"));
  if (recipe.image === null) continue;
  const file = basename(recipe.image || "");
  if (!file) throw new Error(`${repair.id} has no local image`);
  if (repair.kind === "exact" && digest(file) !== repair.group.digest) throw new Error(`${repair.id} image digest drifted`);
  if (repair.kind === "perceptual" && !perceptual.some((f) => f.pair.some((p) => p.id === repair.id && p.file === file))) throw new Error(`${repair.id} image pair drifted`);
  if (!dryRun) {
    recipe.image = null;
    writeFileSync(path, `${JSON.stringify(recipe, null, 2)}\n`);
  }
  imagesCleared += 1;
}
console.log(JSON.stringify({ dryRun, imagesCleared, reviewedGroups: manifest.reviewedGroups }));
