// Corpus QA: run the Phase 4E render-QA gate over the bundled recipe corpus and
// report how many main-capable recipes pass, are auto-fixed, or are quarantined.
// Read-only. Usage: node scripts/recipe-render-qa-corpus.mjs [--verbose]
import { readFileSync } from "node:fs";
import { qaRecipeForShelf, summarizeQa } from "../src/lib/recipe-render-qa.ts";
import { classifyPlannerRole } from "../src/lib/planner-roles.ts";
import { deriveShelfTraits } from "../src/lib/planner-shelf.ts";

const verbose = process.argv.includes("--verbose");
const recipes = JSON.parse(readFileSync(new URL("../src/data/recipes-bundle.json", import.meta.url), "utf8"));
const now = new Date();
let considered = 0, passed = 0, fixed = 0, quarantined = 0, veganAsFish = 0;
const issueCounts = new Map();
for (const recipe of recipes) {
  const role = classifyPlannerRole(recipe);
  if (role.role !== "main" && role.role !== "light-meal") continue;
  if (!recipe.image) continue;
  considered += 1;
  const result = qaRecipeForShelf(recipe, { role: role.role });
  if (result.fixes.length) fixed += 1;
  if (result.ok) passed += 1;
  else {
    quarantined += 1;
    for (const issue of result.issues) issueCounts.set(issue.code, (issueCounts.get(issue.code) ?? 0) + 1);
    if (verbose) console.log(JSON.stringify(summarizeQa(recipe, result)));
  }
  const traits = deriveShelfTraits(recipe, now);
  const dietary = [...(recipe.dietary ?? []), ...(recipe.tags?.dietary ?? [])].map((d) => String(d).toLowerCase());
  if ((dietary.includes("vegan") || dietary.includes("vegetarian")) && (traits.protein === "fish" || traits.protein === "meat")) veganAsFish += 1;
}
console.log(JSON.stringify({ considered, passed, fixed, quarantined, veganOrVegetarianClassifiedAsAnimal: veganAsFish, issues: Object.fromEntries(issueCounts) }, null, 2));
