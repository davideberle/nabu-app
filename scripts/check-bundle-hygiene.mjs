#!/usr/bin/env node
// Regression guard: shared server libs must NOT import Node fs/path directly.
//
// Why: Turbopack traces fs.readdirSync / path.join calls and bundles every file
// they could touch (recipe JSONs, public/ images) into each serverless function.
// This caused 1 GB+ deploy artifacts and Vercel build failures.
//
// Allowed fs/path usage is limited to isolated modules that are only imported
// by a single API route (e.g. meals-persistence.ts, bundle-recipes.mjs).

import { readFileSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const libDir = join(__dirname, "..", "src", "lib");

// Files that are widely imported and must stay fs/path-free
const GUARDED_FILES = [
  "recipes.ts",
  "meals.ts",
  "db.ts",
  "recipe-images.ts",
  "recipe-image-validation.ts",
];

const FS_PATH_IMPORT = /^\s*import\b.*["'](fs|path|node:fs|node:path)["']/m;

let failed = false;

for (const file of GUARDED_FILES) {
  const filePath = join(libDir, file);
  let content;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    // File may not exist (e.g. removed) — that's fine
    continue;
  }
  if (FS_PATH_IMPORT.test(content)) {
    console.error(
      `FAIL: ${file} imports fs or path. This will cause Turbopack to bundle ` +
        `filesystem-adjacent assets into every serverless function. ` +
        `Move fs usage to an isolated module (see meals-persistence.ts pattern).`
    );
    failed = true;
  }
}

if (failed) {
  process.exit(1);
} else {
  console.log("OK: shared libs are free of fs/path imports.");
}
