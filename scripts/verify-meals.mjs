#!/usr/bin/env node
// Targeted verification for meal-planner eligibility and season filtering.
// Run: node scripts/verify-meals.mjs

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
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

function find(id) {
  return bundle.find((r) => r.id === id);
}

// ---- helpers mirroring meals.ts logic ----

const EXCLUDED_DISH_TYPES = new Set([
  "dessert", "baking", "breakfast", "drink", "condiment", "base", "bread",
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
  const breakfastWords = ["pancake", "waffle", "johnnycake", "french toast", "granola", "porridge", "oatmeal"];
  if (breakfastWords.some((w) => nameLower.includes(w))) return false;
  const dessertWords = ["cake", "brownie", "cookie", "muffin", "cupcake", "fudge", "ice cream", "sorbet", "pudding", "truffle", "macaron"];
  if (dessertWords.some((w) => nameLower.includes(w))) return false;
  const sauceWords = ["dressing", "vinaigrette", "aioli", "mayonnaise", "ketchup"];
  if (sauceWords.some((w) => nameLower.includes(w))) return false;
  if (recipe.ingredients.length < 3) return false;
  if (!recipe.method || recipe.method.length < 2) return false;
  return true;
}

function isWeekendMainWorthy(recipe) {
  if (!isDinnerWorthy(recipe)) return false;
  const dishTypes = (recipe.category?.dish_type ?? []).map((t) => t.toLowerCase());
  if (!dishTypes.includes("main")) return false;
  const intro = (recipe.introduction || recipe.intro || "").toLowerCase();
  if (/\b(breakfast|brunch|snack)\b/.test(intro)) return false;
  return true;
}

const SEASON_SIGNALS = {
  spring: /\b(spring|asparagus|fava bean|ramp|wild garlic|pea shoot|new potato|morel)\b/i,
  summer: /\b(summer|watermelon|peach|grilled corn|zucchini|bbq|barbecue|gazpacho|ice pop|popsicle|sundried)\b/i,
  fall: /\b(fall|autumn|squash|pumpkin|apple cider|wheat berr|cranberr|sweet potato)\b/i,
  winter: /\b(winter|root vegetable|parsnip|turnip|braised|braise|hearty stew|mulled|warming)\b/i,
};
const INTRO_SEASON_SIGNALS = {
  spring: /\b(spring (dish|recipe|meal|brunch|dinner|lunch|salad|vegeta|cook|treat|favor)|(in|for|of) spring)\b/i,
  summer: /\b(summer (dish|recipe|meal|salad|treat|favor|cook|grill|bbq)|(in|for|of) summer|hot day|warm[- ]weather)\b/i,
  fall: /\b(fall (dish|recipe|meal|dinner|cook|treat|favor|day|evening)|(in|for|of) (fall|autumn)|autumn(al)?)\b/i,
  winter: /\b(winter (dish|recipe|meal|dinner|cook|treat|favor|warm|stew)|(in|for|of) winter|cold day|cold[- ]weather|fireside)\b/i,
};
const SEASON_NAMES = ["spring", "summer", "fall", "winter"];
const OPPOSITE_SEASON = { spring: "fall", summer: "winter", fall: "spring", winter: "summer" };

function recipeSeason(recipe) {
  const seasonTags = recipe.tags?.season ?? [];
  for (const tag of seasonTags) {
    const lower = tag.toLowerCase();
    if (SEASON_NAMES.includes(lower)) return lower;
  }
  const name = recipe.name;
  for (const [season, re] of Object.entries(SEASON_SIGNALS)) {
    if (re.test(name)) return season;
  }
  const chapter = (recipe.source?.chapter || recipe.category?.chapter || "").toLowerCase().trim();
  if (chapter && SEASON_NAMES.includes(chapter)) return chapter;
  const intro = recipe.introduction || recipe.intro || "";
  if (intro) {
    for (const [season, re] of Object.entries(INTRO_SEASON_SIGNALS)) {
      if (re.test(intro)) return season;
    }
  }
  return null;
}

function filterBySeason(recipes, season) {
  const opposite = OPPOSITE_SEASON[season];
  return recipes.filter((r) => recipeSeason(r) !== opposite);
}

// ---- Specific recipe checks ----

console.log("\n1. Moroccan Mashed Potatoes → must be side, not dinner-worthy");
const mmp = find("moroccan-mashed-potatoes");
assert(mmp, "recipe found");
assert(mmp.category.dish_type.includes("side"), "dish_type is side");
assert(!isDinnerWorthy(mmp), "not dinner-worthy");
assert(!isWeekendMainWorthy(mmp), "not weekend-main-worthy");

console.log("\n2. Tulsi–cinnamon Fruit Bowl → must be breakfast, not dinner-worthy");
const tfb = find("tulsi-cinnamon-fruit-bowl");
assert(tfb, "recipe found");
assert(tfb.category.dish_type.includes("breakfast"), "dish_type is breakfast");
assert(!isDinnerWorthy(tfb), "not dinner-worthy");
assert(!isWeekendMainWorthy(tfb), "not weekend-main-worthy");

console.log("\n3. Seafood, Fennel, and Lime Salad → salad, not weekend main");
const sfl = find("seafood-fennel-and-lime-salad");
assert(sfl, "recipe found");
assert(sfl.category.dish_type.includes("salad"), "dish_type is salad");
assert(!sfl.category.dish_type.includes("main"), "not tagged as main");
const sflDietary = sfl.tags?.dietary ?? sfl.dietary ?? [];
assert(!sflDietary.includes("vegetarian"), "not marked vegetarian (has seafood)");
assert(!sflDietary.includes("vegan"), "not marked vegan (has seafood)");
assert(isDinnerWorthy(sfl), "still dinner-worthy (salad is ok for weekday)");
assert(!isWeekendMainWorthy(sfl), "not weekend-main-worthy");

console.log("\n4. Orecchiette with Escarole → fall season, excluded in spring");
const ore = find("orecchiette-with-escarole-nduja-and-burrata");
assert(ore, "recipe found");
assert(recipeSeason(ore) === "fall", `season detected as fall (got: ${recipeSeason(ore)})`);
const springFiltered = filterBySeason([ore], "spring");
assert(springFiltered.length === 0, "excluded from spring meal plans");
const fallFiltered = filterBySeason([ore], "fall");
assert(fallFiltered.length === 1, "included in fall meal plans");

console.log("\n5. Punjabi Lobia Masala → verify image exists");
const plm = find("punjabi-lobia-masala");
assert(plm, "recipe found");
assert(plm.image === "/recipes/punjabi-lobia-masala.jpg", `image path set: ${plm.image}`);

console.log("\n6. Plain Congee → breakfast, not dinner-worthy");
const pc = find("plain-congee");
assert(pc, "recipe found");
assert(pc.category.dish_type.includes("breakfast"), "dish_type is breakfast");
assert(!isDinnerWorthy(pc), "not dinner-worthy");
assert(!isWeekendMainWorthy(pc), "not weekend-main-worthy");

// ---- Broader sanity checks ----

console.log("\n7. Weekend-main pool is a strict subset of dinner pool");
const dinnerPool = bundle.filter(isDinnerWorthy);
const weekendPool = bundle.filter(isWeekendMainWorthy);
assert(weekendPool.length < dinnerPool.length, `weekend pool (${weekendPool.length}) < dinner pool (${dinnerPool.length})`);
assert(weekendPool.every((r) => dinnerPool.some((d) => d.id === r.id)), "every weekend-main is also dinner-worthy");

console.log("\n8. Spring season filtering excludes fall-tagged recipes");
const springPool = filterBySeason(dinnerPool, "spring");
const fallRecipesInSpring = springPool.filter((r) => recipeSeason(r) === "fall");
assert(fallRecipesInSpring.length === 0, `no fall recipes in spring pool (was ${fallRecipesInSpring.length})`);

console.log(`\n${"=".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
