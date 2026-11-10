#!/usr/bin/env node
// One-off, re-runnable repair of split method steps and split ingredient
// words in the static cookbook catalog (November 10, 2026 catalog cleanup).
//
//   node scripts/repair-recipe-text.mjs                 # report only
//   node scripts/repair-recipe-text.mjs --write         # rewrite src/data/recipes/*.json
//   node scripts/repair-recipe-text.mjs --write --kitchen <kitchen recipes dir>
//        also applies the identical repair to Kitchen source files whose
//        method/ingredients are byte-identical to the app copy before repair
//   --report <file>   write the per-recipe change log as JSON
//
// The rules live in src/lib/recipe-text-repair.ts and are pinned by
// src/lib/recipe-text-repair.test.ts. Ingredient amounts and names are never
// invented; steps are only joined when the text proves they are one sentence.

import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  repairMethodSteps,
  repairIngredientSplits,
  recipeTextMetrics,
  normalizeTitle,
} from "../src/lib/recipe-text-repair.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const recipesDir = join(root, "src", "data", "recipes");
const args = process.argv.slice(2);
const write = args.includes("--write");
const kitchenDir = args.includes("--kitchen") ? args[args.indexOf("--kitchen") + 1] : null;
const reportPath = args.includes("--report") ? args[args.indexOf("--report") + 1] : null;

const files = readdirSync(recipesDir).filter((f) => f.endsWith(".json") && f !== "index.json").sort();
const recipes = files.map((file) => ({ file, data: JSON.parse(readFileSync(join(recipesDir, file), "utf8")) }));

// ---- Lexicon --------------------------------------------------------------
// Method, intro and title text are not affected by the ingredient split bug,
// so a token that occurs there repeatedly is a real word. The system word list
// only confirms *joined* words, never fragments: it contains obscure entries
// ("reen") that would otherwise block a correct repair.
const proseCounts = new Map();
const ingredientCounts = new Map();
function count(map, text) {
  for (const token of String(text ?? "").toLowerCase().match(/[a-z]+/g) ?? []) {
    map.set(token, (map.get(token) ?? 0) + 1);
  }
}
for (const { data } of recipes) {
  for (const step of data.method ?? []) count(proseCounts, step);
  count(proseCounts, data.intro);
  count(proseCounts, data.name);
  for (const ing of data.ingredients ?? []) count(ingredientCounts, ing?.item);
}
let dictionary = new Set();
if (existsSync("/usr/share/dict/words")) {
  dictionary = new Set(readFileSync("/usr/share/dict/words", "utf8").toLowerCase().split("\n"));
}
const isWord = (w) => {
  const word = w.toLowerCase();
  return (proseCounts.get(word) ?? 0) >= 2 || (ingredientCounts.get(word) ?? 0) >= 5 || dictionary.has(word);
};
// Stricter test for "this fragment is a word in its own right".
const fragmentIsWord = (w) => {
  const word = w.toLowerCase();
  if ((proseCounts.get(word) ?? 0) >= 3) return true;
  return word.length >= 5 && dictionary.has(word);
};

// ---- Source rebuilds -------------------------------------------------------
// Methods rebuilt from the original book text (see the JSON for evidence).
const rebuildsPath = join(root, "scripts", "data", "recipe-method-rebuilds-20261110.json");
const rebuilds = existsSync(rebuildsPath) ? JSON.parse(readFileSync(rebuildsPath, "utf8")).recipes : {};

// ---- Repair ---------------------------------------------------------------
const book = (r) => r.source?.cookbook ?? "?";
const titlesByBook = new Map();
for (const { data } of recipes) {
  const list = titlesByBook.get(book(data)) ?? [];
  list.push(normalizeTitle(data.name ?? ""));
  titlesByBook.set(book(data), list);
}
const log = [];
const perBook = new Map();
const bump = (b, key, n = 1) => {
  const row = perBook.get(b) ?? { recipes: 0, fragmentedBefore: 0, fragmentedAfter: 0, lowercaseBefore: 0, lowercaseAfter: 0, continuationBefore: 0, continuationAfter: 0, ingredientSplitBefore: 0, ingredientSplitAfter: 0, methodChanged: 0, ingredientsChanged: 0, sourceRebuilt: 0 };
  row[key] += n;
  perBook.set(b, row);
};
let changedFiles = 0;
const changedById = new Map();

for (const entry of recipes) {
  const { data } = entry;
  const b = book(data);
  bump(b, "recipes");
  const before = recipeTextMetrics(data, isWord, fragmentIsWord);
  const otherTitles = new Set(
    (titlesByBook.get(b) ?? []).filter((t) => t !== normalizeTitle(data.name ?? "")),
  );
  const rebuilt = rebuilds[data.id]?.method;
  const method = repairMethodSteps(rebuilt ?? data.method, { isWord, isStandaloneWord: fragmentIsWord, otherTitles });
  if (rebuilt) method.changes.unshift({ kind: "source-rebuild", at: 0, evidence: rebuilds[data.id].evidence });
  if (rebuilt) bump(b, "sourceRebuilt");
  const ingredients = repairIngredientSplits(data.ingredients, { isWord, isStandaloneWord: fragmentIsWord });

  const next = { ...data };
  let changed = false;
  if (JSON.stringify(method.steps) !== JSON.stringify(data.method)) {
    next.method = method.steps;
    changed = true;
    bump(b, "methodChanged");
  }
  if (ingredients.changes.length) {
    next.ingredients = ingredients.ingredients;
    changed = true;
    bump(b, "ingredientsChanged");
  }
  const ingChanges = ingredients.changes;

  const after = recipeTextMetrics(next, isWord, fragmentIsWord);
  if (before.shortSteps >= 2) bump(b, "fragmentedBefore");
  if (after.shortSteps >= 2) bump(b, "fragmentedAfter");
  if (before.lowercaseStart) bump(b, "lowercaseBefore");
  if (after.lowercaseStart) bump(b, "lowercaseAfter");
  if (before.continuationPairs > 0) bump(b, "continuationBefore");
  if (after.continuationPairs > 0) bump(b, "continuationAfter");
  if (before.ingredientSplits) bump(b, "ingredientSplitBefore");
  if (after.ingredientSplits) bump(b, "ingredientSplitAfter");

  if (changed) {
    changedFiles++;
    changedById.set(data.id, { before: data, after: next });
    log.push({
      id: data.id,
      file: entry.file,
      cookbook: b,
      methodBefore: data.method,
      methodAfter: next.method,
      methodChanges: method.changes,
      ingredientChanges: ingChanges,
    });
    if (write) writeFileSync(join(recipesDir, entry.file), JSON.stringify(next, null, 2) + "\n");
  }
}

// ---- Kitchen source -------------------------------------------------------
const kitchen = { scanned: 0, updated: 0, skippedDiverged: [], files: [] };
if (kitchenDir) {
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".json")) {
        let source;
        try {
          source = JSON.parse(readFileSync(path, "utf8"));
        } catch {
          continue;
        }
        if (!source || typeof source !== "object" || !source.id) continue;
        const hit = changedById.get(source.id);
        if (!hit) continue;
        kitchen.scanned++;
        const updated = { ...source };
        let touched = false;
        for (const field of ["method", "ingredients"]) {
          const appBefore = JSON.stringify(hit.before[field]);
          const appAfter = JSON.stringify(hit.after[field]);
          if (appBefore === appAfter) continue;
          if (JSON.stringify(source[field]) === appBefore) {
            updated[field] = hit.after[field];
            touched = true;
          } else {
            kitchen.skippedDiverged.push({ id: source.id, field, path });
          }
        }
        if (touched) {
          kitchen.updated++;
          kitchen.files.push(path);
          if (write) writeFileSync(path, JSON.stringify(updated, null, 2) + "\n");
        }
      }
    }
  };
  walk(kitchenDir);
}

// ---- Report ---------------------------------------------------------------
const totals = {};
for (const row of perBook.values()) for (const [k, v] of Object.entries(row)) totals[k] = (totals[k] ?? 0) + v;
console.log(`${write ? "Rewrote" : "Would rewrite"} ${changedFiles} of ${recipes.length} recipe files.`);
console.table(Object.fromEntries([...perBook.entries()].sort((a, b) => b[1].continuationBefore - a[1].continuationBefore)));
console.log("Totals", totals);
if (kitchenDir) console.log(`Kitchen source: ${kitchen.updated} files ${write ? "updated" : "would update"}, ${kitchen.skippedDiverged.length} field(s) skipped because the source differs from the app copy.`);
if (reportPath) {
  writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), write, totals, perBook: Object.fromEntries(perBook), kitchen, changes: log }, null, 1));
  console.log(`Report: ${reportPath}`);
}
