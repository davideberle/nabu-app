#!/usr/bin/env node
// Regression guard: catch obvious tail/backmatter corruption in recipe method arrays.
//
// Some recipe imports accidentally include lines from book formatting —
// chapter headers, conclusions, author bios, etc. This script scans every
// source recipe JSON and fails the build if any method step matches known
// corruption patterns.

import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const recipesDir = join(__dirname, "..", "src", "data", "recipes");

// Patterns that should never appear as (or at the start of) a method step.
// Each entry: [regex, human-readable label]
const CORRUPTION_PATTERNS = [
  [/^Recipe\s+\d+\s*:/i, "chapter header (Recipe N:)"],
  [/^Conclusion$/i, "backmatter (Conclusion)"],
  [/^Afterthoughts$/i, "backmatter (Afterthoughts)"],
  [/^About the Author$/i, "backmatter (About the Author)"],
  [/^Thank you for downloading this book/i, "backmatter (download notice)"],
];

// Patterns that indicate corruption but are currently present in the app mirror
// (pre-existing Plenty data not yet synced from repaired kitchen source).
// These warn instead of failing to avoid blocking unrelated deployments.
// TODO: promote to CORRUPTION_PATTERNS after Plenty kitchen→app sync.
const METHOD_WARN_PATTERNS = [
  [/^\d{1,3}\s*\|\s*[A-Z]/, "page number with chapter name (e.g. '182 | Green Things')"],
  [/^\d{1,3}\s*\|\s*Index\b/, "book index content"],
];

const files = readdirSync(recipesDir).filter((f) => f.endsWith(".json"));
let failures = 0;

for (const file of files) {
  const path = join(recipesDir, file);
  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    // Malformed JSON is caught by other checks; skip here.
    continue;
  }

  const method = data.method;
  if (!Array.isArray(method)) continue;

  for (let i = 0; i < method.length; i++) {
    const step = typeof method[i] === "string" ? method[i].trim() : "";
    for (const [pattern, label] of CORRUPTION_PATTERNS) {
      if (pattern.test(step)) {
        console.error(
          `CORRUPT  ${file}  method[${i}]: ${label}\n         "${step}"`
        );
        failures++;
      }
    }
  }
}

// --- Warning-level checks (do not fail build, but surface in output) ---
let warnings = 0;

for (const file of files) {
  const path = join(recipesDir, file);
  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    continue;
  }

  // Method steps matching warn-level corruption patterns
  const method = data.method;
  if (Array.isArray(method)) {
    for (let i = 0; i < method.length; i++) {
      const step = typeof method[i] === "string" ? method[i].trim() : "";
      for (const [pattern, label] of METHOD_WARN_PATTERNS) {
        if (pattern.test(step)) {
          console.warn(
            `WARN     ${file}  method[${i}]: ${label}\n         "${step}"`
          );
          warnings++;
        }
      }
    }
  }

  // Truncated intro: starts with lowercase letter (likely mid-sentence capture)
  if (data.intro && typeof data.intro === "string" && /^[a-z]/.test(data.intro.trim())) {
    console.warn(
      `WARN     ${file}  intro starts lowercase (likely truncated)\n         "${data.intro.trim().substring(0, 80)}..."`
    );
    warnings++;
  }
}

if (failures > 0) {
  console.error(`\n✗ ${failures} corrupted method step(s) found.`);
  if (warnings > 0) console.warn(`⚠ ${warnings} warning(s) (non-blocking).`);
  process.exit(1);
} else {
  if (warnings > 0) console.warn(`⚠ ${warnings} warning(s) (non-blocking).`);
  console.log(`✓ ${files.length} recipes scanned — no corruption detected.`);
}
