#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const recipesDir = join(root, "src", "data", "recipes");
const manifestPath = join(
  root,
  "scripts",
  "manifests",
  "static-recipe-image-blob-manifest.json",
);
const expectedHost = "urojrh970lh6rial.public.blob.vercel-storage.com";
const expectedPrefix = "/cookbook/recipes/";

const recipes = readdirSync(recipesDir)
  .filter((name) => name.endsWith(".json") && name !== "index.json")
  .sort()
  .map((name) => ({
    name,
    data: JSON.parse(readFileSync(join(recipesDir, name), "utf8")),
  }));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const manifestPaths = new Set(manifest.entries.map((entry) => entry.pathname));
const recipePaths = new Set();

for (const recipe of recipes) {
  const image = recipe.data.image;
  if (image == null || image === "") continue;
  if (typeof image !== "string") {
    throw new Error(`${recipe.name}: image must be a string or null`);
  }
  if (image.startsWith("/recipes/")) {
    throw new Error(`${recipe.name}: local cookbook image would bloat every deployment`);
  }
  const url = new URL(image);
  if (url.hostname !== expectedHost || !url.pathname.startsWith(expectedPrefix)) {
    throw new Error(`${recipe.name}: unexpected cookbook image URL ${image}`);
  }
  recipePaths.add(url.pathname.slice(1));
}

const missingFromManifest = [...recipePaths].filter(
  (pathname) => !manifestPaths.has(pathname),
);
const unreferencedManifestEntries = [...manifestPaths].filter(
  (pathname) => !recipePaths.has(pathname),
);
if (missingFromManifest.length || unreferencedManifestEntries.length) {
  throw new Error(
    `Blob manifest mismatch: ${missingFromManifest.length} recipe paths missing, ${unreferencedManifestEntries.length} unreferenced manifest entries`,
  );
}
if (manifest.referencedImageCount !== recipePaths.size) {
  throw new Error(
    `Blob manifest count mismatch: ${manifest.referencedImageCount} != ${recipePaths.size}`,
  );
}

console.log(
  `Verified ${recipes.length} recipes and ${recipePaths.size} manifest-backed cookbook image URLs.`,
);
