#!/usr/bin/env node
// Quality-gate verification: exercises the plausibility checks and
// quality-gated candidate selection against known bad examples.
// Run: node scripts/verify-quality-gate.mjs

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bundle = JSON.parse(
  readFileSync(join(__dirname, "..", "src", "data", "recipes-bundle.json"), "utf8")
);

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  \u2713 ${label}`);
    passed++;
  } else {
    console.error(`  \u2717 FAIL: ${label}`);
    failed++;
  }
}

function find(id) {
  return bundle.find((r) => r.id === id);
}

// ---- Mirror the quality-gate logic from meals.ts ----

const EXCLUDED_DISH_TYPES = new Set([
  "dessert", "baking", "breakfast", "drink", "condiment", "base", "bread", "component",
]);
const EXCLUDED_CHAPTER_PATTERNS = [
  "dessert", "sweet", "baking", "patisserie", "pastry",
  "bread", "breakfast", "brunch", "drink", "beverage",
  "smoothie", "mylkshake", "coffee", "basic recipe",
  "basic sauce", "base sauce", "kitchen basic", "know-how",
  "condiment", "pickle", "preserve", "chutney", "spice blend",
  "desayuno",
];

function isDinnerWorthy(recipe) {
  const dishTypes = recipe.category?.dish_type ?? [];
  const lowTypes = dishTypes.map((t) => t.toLowerCase());
  if (lowTypes.some((t) => EXCLUDED_DISH_TYPES.has(t))) return false;
  const chapter = (recipe.source?.chapter || recipe.category?.chapter || "").toLowerCase();
  if (chapter && EXCLUDED_CHAPTER_PATTERNS.some((p) => chapter.includes(p))) return false;
  const hasMainRole = lowTypes.some((t) => t === "main" || t === "soup" || t === "salad");
  if (lowTypes.includes("side") && !hasMainRole) return false;
  if (lowTypes.includes("vegetable") && !hasMainRole) return false;
  if (lowTypes.includes("starter") && !hasMainRole) return false;
  const nameLower = recipe.name.toLowerCase();
  const breakfastWords = ["pancake", "waffle", "johnnycake", "french toast", "granola", "porridge", "oatmeal", "breakfast", "brunch", "morning", "cereal", "muesli", "smoothie", "juice", "milkshake", "scramble", "scrambled egg"];
  if (breakfastWords.some((w) => nameLower.includes(w))) return false;
  const snackWords = ["snack", "bar ", "energy ball", "trail mix", "dip", "hummus", "guacamole", "salsa", "cracker", "chip", "popcorn", "nut butter", "lunch box", "lunchbox", "sandwich", "wrap"];
  if (snackWords.some((w) => nameLower.includes(w))) return false;
  const dessertWords = ["cake", "brownie", "cookie", "muffin", "cupcake", "fudge", "ice cream", "sorbet", "pudding", "truffle", "macaron"];
  if (dessertWords.some((w) => nameLower.includes(w))) return false;
  const sauceWords = ["dressing", "vinaigrette", "aioli", "mayonnaise", "ketchup"];
  if (sauceWords.some((w) => nameLower.includes(w))) return false;
  const role = (recipe.mealRole || recipe.category?.meal_role || "").toLowerCase();
  if (role === "breakfast" || role === "brunch" || role === "lunch" || role === "drink" || role === "snack") return false;
  if (recipe.ingredients.length < 3) return false;
  if (!recipe.method || recipe.method.length < 2) return false;
  return true;
}

// Plausibility checks (mirrors meals.ts checkPlausibility)
const NON_DINNER_SERVINGS =
  /^(makes?\s+)?(about\s+)?[\d\u00bd\u2153\u2154\u00bc\u00be\u215b\u215c\u215d\u215e\u2013\u2014\-\s]*(cup|cups|tbsp|tablespoon|tablespoons|ml|jar|jars|small jar)\b/i;

function isComponentByName(name) {
  const n = name.toLowerCase();
  const guardedWords = ["pickled", "candied"];
  for (const w of guardedWords) {
    if (new RegExp(`\\b${w}\\b`).test(n)) {
      if (!new RegExp(`\\bwith\\s+.*\\b${w}\\b`).test(n)
        && !new RegExp(`&\\s+.*\\b${w}\\b`).test(n)) return true;
    }
  }
  const endComponents = ["relish", "chutney", "compote", "brittle"];
  for (const w of endComponents) {
    if (new RegExp(`\\b${w}\\b`).test(n)) {
      if (!new RegExp(`\\bwith\\s+.*\\b${w}\\b`).test(n)
        && !new RegExp(`&\\s+.*\\b${w}\\b`).test(n)) return true;
    }
  }
  if (/\bglazed (walnut|nut|pecan|almond|cashew|peanut)/i.test(n)) return true;
  if (/\b(granola|spice (blend|mix|rub)|crumble topping)\b/i.test(n)) return true;
  if (/\btoasted (nut|coconut|seed)/i.test(n)
    && !new RegExp(`\\bwith\\s+.*\\btoasted\\b`).test(n)) return true;
  if (/\bspiced (nut|seed|walnut|pecan|almond)/i.test(n)) return true;
  return false;
}

const SIDE_CHAPTER_SIGNALS = [
  "vegetables", "vegetable", "sides", "side dishes",
  "blanched", "steamed", "accompaniment", "garnish",
  "pickle", "pickled", "salting",
];

function checkPlausibility(recipe) {
  const issues = [];
  const dishTypes = (recipe.category?.dish_type ?? []).map(t => t.toLowerCase());
  const mealRole = (recipe.mealRole || recipe.category?.meal_role || "").toLowerCase();
  const servings = (recipe.servings || "");
  const nameLower = recipe.name.toLowerCase();

  if (servings && NON_DINNER_SERVINGS.test(servings)) {
    issues.push(`non-dinner servings: "${servings}"`);
    return { eligible: false, confidence: "high", issues };
  }
  if (isComponentByName(recipe.name)) {
    issues.push(`component/garnish name pattern: "${recipe.name}"`);
    return { eligible: false, confidence: "high", issues };
  }
  if (mealRole === "component" && dishTypes.includes("main")) {
    issues.push(`meal_role "component" contradicts dish_type "main"`);
    return { eligible: false, confidence: "high", issues };
  }
  if (dishTypes.includes("main") && !dishTypes.includes("soup") && !dishTypes.includes("salad")) {
    const chapter = (recipe.source?.chapter || recipe.category?.chapter || "").toLowerCase();
    if (SIDE_CHAPTER_SIGNALS.some(c => chapter.includes(c)) && recipe.ingredients.length < 6) {
      issues.push(`tagged "main" but side-chapter with few ingredients`);
      return { eligible: false, confidence: "medium", issues };
    }
  }
  if (servings && /^(makes?\s+)?\d+\s*(loaf|loaves|batch|dozen)\b/i.test(servings)) {
    issues.push(`non-dinner servings: "${servings}"`);
    return { eligible: false, confidence: "medium", issues };
  }
  return { eligible: true, confidence: "high", issues };
}

/** Combined gate: isDinnerWorthy + plausibility */
function passesQualityGate(recipe) {
  if (!isDinnerWorthy(recipe)) return { pass: false, reason: "not dinner-worthy" };
  const p = checkPlausibility(recipe);
  if (!p.eligible) return { pass: false, reason: p.issues.join("; ") };
  return { pass: true, reason: null };
}

// ===== Tests =====

console.log("\n=== QUALITY GATE VERIFICATION ===\n");

// ---- 1. Known bad examples must be excluded ----

console.log("1. Molasses-Glazed Walnuts → must be excluded (component)");
const mgw = find("molasses-glazed-walnuts");
assert(mgw, "recipe found in bundle");
if (mgw) {
  const result = passesQualityGate(mgw);
  assert(!result.pass, `excluded from quality gate (reason: ${result.reason})`);
  // Specifically: should fail at isDinnerWorthy because "component" is now excluded
  assert(!isDinnerWorthy(mgw), "not dinner-worthy (component dish_type)");
}

console.log("\n2. Steamed green soybeans with ham → must be excluded (side-only)");
const sgs = find("steamed-green-soybeans-with-ham");
assert(sgs, "recipe found in bundle");
if (sgs) {
  const result = passesQualityGate(sgs);
  assert(!result.pass, `excluded from quality gate (reason: ${result.reason})`);
}

console.log("\n3. Sprouting Broccoli with Sweet Tahini → must be excluded (side-only)");
const sbt = find("sprouting-broccoli-with-sweet-tahini");
assert(sbt, "recipe found in bundle");
if (sbt) {
  const result = passesQualityGate(sbt);
  assert(!result.pass, `excluded from quality gate (reason: ${result.reason})`);
}

console.log("\n4. Volume-servings recipes should fail plausibility");
const volumeRecipes = bundle.filter(r => {
  const s = (r.servings || "").toLowerCase();
  return NON_DINNER_SERVINGS.test(s);
});
console.log(`   Found ${volumeRecipes.length} recipes with volume-based servings`);
// Spot-check a few
for (const vr of volumeRecipes.slice(0, 3)) {
  const p = checkPlausibility(vr);
  assert(!p.eligible, `"${vr.name}" (servings: "${vr.servings}") → excluded`);
}

console.log("\n5. Component name patterns should fail plausibility");
const componentByName = bundle.filter(r => isComponentByName(r.name));
console.log(`   Found ${componentByName.length} recipes matching component name patterns`);
for (const cr of componentByName.slice(0, 3)) {
  if (isDinnerWorthy(cr)) {
    // Only test plausibility for recipes that pass isDinnerWorthy
    const p = checkPlausibility(cr);
    assert(!p.eligible, `"${cr.name}" → excluded by plausibility`);
  } else {
    assert(true, `"${cr.name}" → already excluded by isDinnerWorthy`);
  }
}

// ---- 1b. Dishes WITH component garnishes must NOT be excluded ----

console.log("\n5b. Dishes with component garnishes should pass quality gate");
const garnishDishNames = [
  "Za'atar Cod with Relish",
  "Rustic dough-wriggle soup with pickled greens",
  "Globe Artichoke and Mozzarella with Candied Lemon",
  "Quinoa and mango with toasted coconut",
  "Za'atar Roasted Squash with Spiced Yogurt & Pickled Chillies",
  "Smoked trout and endive with dill relish",
];
for (const name of garnishDishNames) {
  assert(!isComponentByName(name), `"${name}" → NOT a component (has garnish)`);
}

// ---- 2. Known good recipes must pass ----

console.log("\n6. Known good dinner mains must pass quality gate");
const goodIds = [
  "spicy-tofu",
  "miso-salmon",
  "chicken-shawarma",
  "thai-green-curry",
  "mushroom-risotto",
];
for (const id of goodIds) {
  const r = find(id);
  if (r) {
    const result = passesQualityGate(r);
    assert(result.pass, `"${r.name}" passes quality gate`);
  } else {
    // Recipe might not exist in this bundle; skip gracefully
    console.log(`  - "${id}" not found in bundle, skipping`);
  }
}

// ---- 3. Broader statistics ----

console.log("\n7. Quality gate statistics on full bundle");
const dinnerPool = bundle.filter(isDinnerWorthy);
const withImages = dinnerPool.filter(r => !!r.image);
let plausibilityExcluded = 0;
const excludedByReason = {};
for (const r of withImages) {
  const p = checkPlausibility(r);
  if (!p.eligible) {
    plausibilityExcluded++;
    for (const issue of p.issues) {
      const key = issue.split(":")[0].trim();
      excludedByReason[key] = (excludedByReason[key] || 0) + 1;
    }
  }
}
console.log(`   Dinner-worthy: ${dinnerPool.length}`);
console.log(`   With images: ${withImages.length}`);
console.log(`   Excluded by plausibility: ${plausibilityExcluded}`);
console.log(`   Eligible after quality gate: ${withImages.length - plausibilityExcluded}`);
if (Object.keys(excludedByReason).length > 0) {
  console.log(`   Exclusion breakdown:`);
  for (const [reason, count] of Object.entries(excludedByReason)) {
    console.log(`     ${reason}: ${count}`);
  }
}
assert(withImages.length - plausibilityExcluded >= 50, `enough eligible recipes for planner (${withImages.length - plausibilityExcluded} >= 50)`);

// ---- 4. Bucket sufficiency after quality gate ----

console.log("\n8. Bucket pools still sufficient after quality gate");

function getDietary(recipe) {
  return recipe.dietary || recipe.tags?.dietary || [];
}
function isVegetarianOrVegan(recipe) {
  const tags = getDietary(recipe);
  return tags.some((t) => t.toLowerCase() === "vegan" || t.toLowerCase() === "vegetarian");
}
function classifyBucket(recipe) {
  const dishTypes = (recipe.category?.dish_type ?? []).map((t) => t.toLowerCase());
  const nameLower = recipe.name.toLowerCase();
  if (dishTypes.includes("salad") || nameLower.includes("salad")) return "salad";
  if (dishTypes.includes("soup") || nameLower.includes("soup") || nameLower.includes("stew") || nameLower.includes("chowder") || nameLower.includes("broth")) return "soup";
  if (isVegetarianOrVegan(recipe)) return "vegetarian";
  return "meat";
}

const BUCKET_ORDER = ["salad", "soup", "vegetarian", "meat"];
const BUCKET_CONTRACT = [3, 3, 2, 4];

const qualityPool = withImages.filter(r => checkPlausibility(r).eligible);
const bucketCounts = {};
for (const b of BUCKET_ORDER) bucketCounts[b] = 0;
for (const r of qualityPool) {
  const b = classifyBucket(r);
  if (b) bucketCounts[b]++;
}
for (let i = 0; i < BUCKET_ORDER.length; i++) {
  const b = BUCKET_ORDER[i];
  const needed = BUCKET_CONTRACT[i];
  assert(
    bucketCounts[b] >= needed * 2,
    `bucket "${b}" has ${bucketCounts[b]} eligible recipes (need >= ${needed * 2} for oversized pool)`
  );
}

// ---- 5. Simulated quality-gated selection ----

console.log("\n9. Simulated quality-gated selection produces 12 items");

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const simBuckets = { salad: [], soup: [], vegetarian: [], meat: [] };
for (const r of qualityPool) {
  const b = classifyBucket(r);
  if (b) simBuckets[b].push(r);
}

// Oversized pick
const oversized = {};
for (let i = 0; i < BUCKET_ORDER.length; i++) {
  const b = BUCKET_ORDER[i];
  const needed = BUCKET_CONTRACT[i];
  oversized[b] = shuffle(simBuckets[b]).slice(0, needed * 2);
}

// Final pick
const simResult = [];
for (let i = 0; i < BUCKET_ORDER.length; i++) {
  const b = BUCKET_ORDER[i];
  const needed = BUCKET_CONTRACT[i];
  simResult.push(...oversized[b].slice(0, needed));
}

assert(simResult.length === 12, `total candidates = ${simResult.length} (expected 12)`);

// All must pass plausibility
const allPassPlausibility = simResult.every(r => checkPlausibility(r).eligible);
assert(allPassPlausibility, "all selected candidates pass plausibility checks");

// Print the selected candidates for inspection
console.log("\n   Selected candidates:");
let idx = 0;
for (let i = 0; i < BUCKET_ORDER.length; i++) {
  for (let j = 0; j < BUCKET_CONTRACT[i] && idx < simResult.length; j++) {
    const r = simResult[idx];
    console.log(`   [${BUCKET_ORDER[i].padEnd(10)}] ${r.name} (${r.id})`);
    idx++;
  }
}

// ---- 6. Specific plausibility exclusion list ----

console.log("\n10. Full list of plausibility-excluded recipes (dinner-worthy with images)");
const excluded = withImages.filter(r => !checkPlausibility(r).eligible);
for (const r of excluded) {
  const p = checkPlausibility(r);
  console.log(`   - ${r.name} (${r.id}): ${p.issues.join("; ")}`);
}

// ---- Summary ----

console.log(`\n${"=".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
