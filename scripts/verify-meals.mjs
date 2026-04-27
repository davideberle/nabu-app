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
  const breakfastWords = ["breakfast", "brunch", "morning", "cereal", "muesli", "smoothie", "juice", "milkshake", "scramble", "scrambled egg", "pancake", "waffle", "johnnycake", "french toast", "granola", "porridge", "oatmeal"];
  if (breakfastWords.some((w) => nameLower.includes(w))) return false;
  const snackWords = ["snack", "bar ", "energy ball", "trail mix", "dip", "hummus", "guacamole", "salsa", "cracker", "chip", "popcorn", "nut butter", "lunch box", "lunchbox", "sandwich", "wrap"];
  if (snackWords.some((w) => nameLower.includes(w))) return false;
  const dessertWords = ["cake", "brownie", "cookie", "muffin", "cupcake", "fudge", "ice cream", "sorbet", "pudding", "truffle", "macaron"];
  if (dessertWords.some((w) => nameLower.includes(w))) return false;
  const sauceWords = ["dressing", "vinaigrette", "aioli", "mayonnaise", "ketchup"];
  if (sauceWords.some((w) => nameLower.includes(w))) return false;
  const mealRole = (recipe.mealRole || recipe.category?.meal_role || "").toLowerCase();
  if (["breakfast", "brunch", "lunch", "drink", "snack"].includes(mealRole)) return false;
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

console.log("\n3. Smoked fish, fennel, and mango salad → salad, not weekend main");
const sfl = find("smoked-fish-fennel-and-mango-salad");
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

console.log("\n5. Punjabi Lobia Masala → image nulled by cleanup (73deb4ed)");
const plm = find("punjabi-lobia-masala");
assert(plm, "recipe found");
assert(plm.image === null || plm.image === undefined, `image is null (got: ${plm.image})`);

console.log("\n6. Plain Congee → breakfast, not dinner-worthy");
const pc = find("plain-congee");
assert(pc, "recipe found");
assert(pc.category.dish_type.includes("breakfast"), "dish_type is breakfast");
assert(!isDinnerWorthy(pc), "not dinner-worthy");
assert(!isWeekendMainWorthy(pc), "not weekend-main-worthy");

console.log("\n6b. Pickled Mustard Greens → condiment, not dinner-worthy");
const pmg = find("pickled-mustard-greens");
assert(pmg, "recipe found");
assert(pmg.category.dish_type.includes("condiment"), `dish_type is condiment (got: ${JSON.stringify(pmg.category.dish_type)})`);
assert(pmg.category.meal_role === "side", `meal_role is side (got: ${pmg.category.meal_role})`);
assert(!isDinnerWorthy(pmg), "not dinner-worthy");
assert(!isWeekendMainWorthy(pmg), "not weekend-main-worthy");
assert(pmg.image === null || pmg.image === undefined, `image is null (got: ${pmg.image})`);

console.log("\n6c. Aluvati → image nulled (illustrative)");
const alu = find("aluvati");
assert(alu, "recipe found");
assert(alu.image === null || alu.image === undefined, `image is null (got: ${alu.image})`);

console.log("\n6d. Triple-grain Herbed Salad Bowl → image nulled");
const tghsb = find("triple-grain-herbed-salad-bowl");
assert(tghsb, "recipe found");
assert(tghsb.image === null || tghsb.image === undefined, `image is null (got: ${tghsb.image})`);

console.log("\n6e. Hominy and Spinach in Tomato-Garlic Broth → image nulled (wrong image)");
const hominy = find("hominy-and-spinach-in-tomato-garlic-broth");
assert(hominy, "recipe found");
assert(hominy.image === null || hominy.image === undefined, `image is null (got: ${hominy.image})`);

console.log("\n6f. Celtuce Salad with Spring Onion Oil → image nulled (wrong image)");
const celtuce = find("celtuce-salad-with-spring-onion-oil");
assert(celtuce, "recipe found");
assert(celtuce.image === null || celtuce.image === undefined, `image is null (got: ${celtuce.image})`);

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

// ---- Phase 2: Bucket classification & candidate contract ----

const FISH_PATTERNS = /\b(salmon|tuna|trout|cod|halibut|catfish|sea bass|snapper|mackerel|sardine|anchov|swordfish|fish|shrimp|prawn|scallop|crab|lobster|mussel|clam|oyster|squid|calamari|octopus|seafood)\b/i;

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
  const ingredientText = recipe.ingredients.map((i) => i.item).join(" ");
  if (dishTypes.includes("salad") || nameLower.includes("salad")) return "salad";
  if (dishTypes.includes("soup") || nameLower.includes("soup") || nameLower.includes("stew") || nameLower.includes("chowder") || nameLower.includes("broth")) return "soup";
  if (isVegetarianOrVegan(recipe)) return "vegetarian";
  if (FISH_PATTERNS.test(nameLower) || FISH_PATTERNS.test(ingredientText)) return "fish";
  return "meat";
}

const BUCKET_ORDER = ["salad", "soup", "vegetarian", "fish", "meat"];
const BUCKET_CONTRACT = [3, 3, 2, 2, 2]; // total = 12

console.log("\n9. Bucket pools have enough recipes to fill contract");
const currentSeason = (() => {
  const m = new Date().getMonth();
  if (m >= 2 && m <= 4) return "spring";
  if (m >= 5 && m <= 7) return "summer";
  if (m >= 8 && m <= 10) return "fall";
  return "winter";
})();
const seasonedPool = filterBySeason(dinnerPool, currentSeason);
const bucketCounts = {};
for (const b of BUCKET_ORDER) bucketCounts[b] = 0;
for (const r of seasonedPool) {
  const b = classifyBucket(r);
  if (b) bucketCounts[b]++;
}
for (let i = 0; i < BUCKET_ORDER.length; i++) {
  const b = BUCKET_ORDER[i];
  const needed = BUCKET_CONTRACT[i];
  assert(
    bucketCounts[b] >= needed,
    `bucket "${b}" has ${bucketCounts[b]} recipes (need >= ${needed})`
  );
}

console.log("\n10. Simulated candidate selection produces exactly 12 items in contract order");
// Simplified simulation — pick from each bucket
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const simBuckets = { salad: [], soup: [], vegetarian: [], fish: [], meat: [] };
for (const r of seasonedPool) {
  const b = classifyBucket(r);
  if (b) simBuckets[b].push(r);
}
const simResult = [];
for (let i = 0; i < BUCKET_ORDER.length; i++) {
  const b = BUCKET_ORDER[i];
  const needed = BUCKET_CONTRACT[i];
  const picks = shuffle(simBuckets[b]).slice(0, needed);
  simResult.push(...picks);
}
assert(simResult.length === 12, `total candidates = ${simResult.length} (expected 12)`);

// Verify order: first 3 are salads, next 3 soups, etc.
let orderCorrect = true;
let idx = 0;
for (let i = 0; i < BUCKET_ORDER.length; i++) {
  for (let j = 0; j < BUCKET_CONTRACT[i]; j++) {
    if (classifyBucket(simResult[idx]) !== BUCKET_ORDER[i]) orderCorrect = false;
    idx++;
  }
}
assert(orderCorrect, "candidates are in correct bucket order (salad→soup→veg→fish→meat)");

console.log("\n11. Saved candidate fidelity: CandidateItem fields non-empty");
// normalizeTime mirrors the API's logic: coerce strings, reject non-finite
function normalizeTime(time) {
  if (!time) return null;
  const parseMin = (v) => {
    if (typeof v === "number" && isFinite(v)) return v;
    if (typeof v === "string") { const n = parseInt(v, 10); return isFinite(n) ? n : 0; }
    return 0;
  };
  const prep = parseMin(time.prep);
  const cook = parseMin(time.cook);
  let total = parseMin(time.total);
  if (total <= 0 && prep + cook > 0) total = prep + cook;
  if (total <= 0) return null;
  return { prep, cook, total };
}

// Simulate what the API would persist
const simSaved = simResult.map((r) => ({
  recipeId: r.id,
  recipeName: r.name,
  source: r.source ?? null,
  image: r.image ?? null,
  dietary: getDietary(r),
  cuisine: "Other",
  time: normalizeTime(r.time),
  category: classifyBucket(r) === "salad" ? "Salad" : "Main",
  lowCalorie: false,
  bucket: classifyBucket(r),
}));
const allHaveId = simSaved.every((c) => c.recipeId && c.recipeName);
assert(allHaveId, "all saved candidates have recipeId and recipeName");
const allHaveBucket = simSaved.every((c) => BUCKET_ORDER.includes(c.bucket));
assert(allHaveBucket, "all saved candidates have valid bucket label");
const noneHaveNaN = simSaved.every(
  (c) => c.time === null || (typeof c.time.total === "number" && !isNaN(c.time.total))
);
assert(noneHaveNaN, "no NaN in saved candidate time fields");

console.log(`\n${"=".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
