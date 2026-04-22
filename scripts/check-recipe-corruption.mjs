#!/usr/bin/env node
// Regression guard: detect cookbook import corruption in recipe JSON files.
//
// Why: bulk imports from cookbook PDFs sometimes leak non-recipe text into
// the method arrays — chapter headers ("Recipe 3:"), boilerplate
// ("Thank you for downloading this book"), and structural artefacts
// ("Conclusion", "About the Author"). These corrupt the cooking UI.

import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const recipesDir = join(__dirname, "..", "src", "data", "recipes");

const CORRUPTION_PATTERNS = [
  /^Recipe\s+\d+\s*:/i,
  /^Conclusion$/i,
  /^Afterthoughts$/i,
  /^About the Author$/i,
  /^Thank you for downloading this book/i,
];

const files = readdirSync(recipesDir).filter((f) => f.endsWith(".json"));
let failed = false;

for (const file of files) {
  const filePath = join(recipesDir, file);
  let recipe;
  try {
    recipe = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (err) {
    console.error(`FAIL: ${file} is not valid JSON: ${err.message}`);
    failed = true;
    continue;
  }

  const method = recipe.method;
  if (!Array.isArray(method)) continue;

  for (let i = 0; i < method.length; i++) {
    const step = method[i];
    if (typeof step !== "string") continue;
    const trimmed = step.trim();
    for (const pattern of CORRUPTION_PATTERNS) {
      if (pattern.test(trimmed)) {
        console.error(
          `FAIL: ${file} method[${i}] matches corruption pattern ${pattern}: "${trimmed}"`
        );
        failed = true;
      }
    }
  }
}

if (failed) {
  process.exit(1);
} else {
  console.log(`OK: ${files.length} recipes checked, no import corruption found.`);
}
