#!/usr/bin/env node
// Pre-aggregate individual recipe JSON files into a single bundle so that
// Turbopack doesn't trace the dynamic fs.readdirSync pattern and bundle
// thousands of files into every serverless function that imports recipes.ts.

import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const recipesDir = join(__dirname, "..", "src", "data", "recipes");
const outFile = join(__dirname, "..", "src", "data", "recipes-bundle.json");

const files = readdirSync(recipesDir)
  .filter((f) => f.endsWith(".json") && f !== "index.json")
  .sort();

const recipes = files.map((f) =>
  JSON.parse(readFileSync(join(recipesDir, f), "utf8"))
);

writeFileSync(outFile, JSON.stringify(recipes));
console.log(`Bundled ${recipes.length} recipes → src/data/recipes-bundle.json`);
