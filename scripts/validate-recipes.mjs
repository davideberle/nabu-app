#!/usr/bin/env node
/**
 * Validate static recipe corpus for data-quality issues.
 * Checks classification completeness, structural integrity, and common problems.
 *
 * Run: node scripts/validate-recipes.mjs
 * Exit code 0 = pass (warnings allowed), 1 = errors found.
 */

import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RECIPES_DIR = join(__dirname, "..", "src", "data", "recipes");

const VALID_MEAL_ROLES = new Set([
  "main", "side", "starter", "dessert", "component", "breakfast", "drink",
]);

const VALID_DISH_TYPES = new Set([
  "main", "soup", "salad", "side", "vegetable", "bread", "starter",
  "dessert", "baking", "condiment", "base", "breakfast", "drink",
]);

const files = readdirSync(RECIPES_DIR).filter(
  (f) => f.endsWith(".json") && f !== "index.json"
);

const errors = [];
const warnings = [];
const stats = {
  total: files.length,
  withCategory: 0,
  withMealRole: 0,
  withDishType: 0,
  withImage: 0,
  withTime: 0,
  withServings: 0,
  mealRoles: {},
  dishTypes: {},
  cookbooks: {},
};

for (const file of files) {
  const filePath = join(RECIPES_DIR, file);
  let recipe;
  try {
    recipe = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    errors.push(`${file}: invalid JSON`);
    continue;
  }

  const prefix = `${file} (${recipe.name || "??"})`;

  // ── Required fields ──
  if (!recipe.id) errors.push(`${prefix}: missing id`);
  if (!recipe.name || recipe.name.trim().length === 0) errors.push(`${prefix}: missing or empty name`);
  if (!recipe.source?.cookbook) errors.push(`${prefix}: missing source.cookbook`);
  if (!recipe.ingredients || recipe.ingredients.length === 0) warnings.push(`${prefix}: no ingredients`);
  if (!recipe.method || recipe.method.length === 0) warnings.push(`${prefix}: no method steps`);

  // ── Name quality ──
  if (recipe.name && /^\d+[\.\)]\s/.test(recipe.name)) {
    warnings.push(`${prefix}: name starts with numbering prefix`);
  }
  if (recipe.name && recipe.name.length > 120) {
    warnings.push(`${prefix}: name unusually long (${recipe.name.length} chars)`);
  }
  if (recipe.name && /[^\x20-\x7E\u00C0-\u024F\u0400-\u04FF\u2010-\u2027\u2030-\u205E]/.test(recipe.name)) {
    // Allow Latin, Cyrillic, and common punctuation; flag raw OCR artifacts
    const suspicious = recipe.name.match(/[\x00-\x1F\x7F-\x9F]/g);
    if (suspicious) {
      warnings.push(`${prefix}: name contains control characters`);
    }
  }

  // ── Category / classification ──
  if (!recipe.category || typeof recipe.category !== "object") {
    errors.push(`${prefix}: missing category object`);
  } else {
    stats.withCategory++;

    if (!recipe.category.dish_type || recipe.category.dish_type.length === 0) {
      errors.push(`${prefix}: missing category.dish_type`);
    } else {
      stats.withDishType++;
      for (const dt of recipe.category.dish_type) {
        if (!VALID_DISH_TYPES.has(dt)) {
          warnings.push(`${prefix}: unknown dish_type "${dt}"`);
        }
        stats.dishTypes[dt] = (stats.dishTypes[dt] || 0) + 1;
      }
    }

    if (!recipe.category.meal_role) {
      errors.push(`${prefix}: missing category.meal_role`);
    } else {
      stats.withMealRole++;
      if (!VALID_MEAL_ROLES.has(recipe.category.meal_role)) {
        errors.push(`${prefix}: invalid meal_role "${recipe.category.meal_role}"`);
      }
      stats.mealRoles[recipe.category.meal_role] = (stats.mealRoles[recipe.category.meal_role] || 0) + 1;
    }
  }

  // ── Image ──
  if (recipe.image) {
    stats.withImage++;
    if (typeof recipe.image === "string" && !recipe.image.startsWith("/recipes/") && !recipe.image.startsWith("https://")) {
      warnings.push(`${prefix}: image path doesn't start with /recipes/ or https://`);
    }
  }

  // ── Time ──
  if (recipe.time?.total > 0) stats.withTime++;

  // ── Servings ──
  if (recipe.servings && recipe.servings.trim().length > 0) stats.withServings++;

  // ── Cookbook stats ──
  const cb = recipe.source?.cookbook || "unknown";
  stats.cookbooks[cb] = (stats.cookbooks[cb] || 0) + 1;
}

// ── Report ──

console.log("\n╔══════════════════════════════════════════╗");
console.log("║       Recipe Corpus Validation Report    ║");
console.log("╚══════════════════════════════════════════╝\n");

console.log(`Total recipes: ${stats.total}`);
console.log(`  With category:   ${stats.withCategory}/${stats.total}`);
console.log(`  With dish_type:  ${stats.withDishType}/${stats.total}`);
console.log(`  With meal_role:  ${stats.withMealRole}/${stats.total}`);
console.log(`  With image:      ${stats.withImage}/${stats.total}`);
console.log(`  With time:       ${stats.withTime}/${stats.total}`);
console.log(`  With servings:   ${stats.withServings}/${stats.total}`);

console.log(`\nMeal role distribution:`);
for (const [role, count] of Object.entries(stats.mealRoles).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${role.padEnd(12)} ${count}`);
}

console.log(`\nDish type distribution:`);
for (const [dt, count] of Object.entries(stats.dishTypes).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${dt.padEnd(12)} ${count}`);
}

console.log(`\nCookbooks (${Object.keys(stats.cookbooks).length}):`);
for (const [cb, count] of Object.entries(stats.cookbooks).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${cb.padEnd(45)} ${count}`);
}

if (errors.length > 0) {
  console.log(`\n❌ ERRORS (${errors.length}):`);
  for (const e of errors) console.log(`  ${e}`);
}

if (warnings.length > 0) {
  console.log(`\n⚠  WARNINGS (${warnings.length}):`);
  for (const w of warnings.slice(0, 50)) console.log(`  ${w}`);
  if (warnings.length > 50) console.log(`  ... and ${warnings.length - 50} more`);
}

if (errors.length === 0) {
  console.log("\n✅ Validation passed (0 errors)");
  process.exit(0);
} else {
  console.log(`\n❌ Validation failed (${errors.length} errors, ${warnings.length} warnings)`);
  process.exit(1);
}
