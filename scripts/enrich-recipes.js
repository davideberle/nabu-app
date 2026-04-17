#!/usr/bin/env node
/**
 * Enrich recipe JSON files with missing cuisine, category, and time data.
 * Run: node scripts/enrich-recipes.js
 */

const fs = require("fs");
const path = require("path");

const RECIPES_DIR = path.join(__dirname, "..", "src", "data", "recipes");

// ── Cookbook → Cuisine mapping (comprehensive) ──

const COOKBOOK_CUISINES = {
  "Ottolenghi: The Cookbook": "Middle Eastern",
  "Jerusalem": "Middle Eastern",
  "Falastin": "Middle Eastern",
  "Persiana": "Middle Eastern",
  "Souk to Table": "Middle Eastern",
  "Plenty": "Middle Eastern",
  "Plenty More": "Middle Eastern",
  "Ottolenghi Simple": "Middle Eastern",
  "The Curry Guy": "Indian",
  "The Curry Guy Bible": "Indian",
  "The Indian Vegan": "Indian",
  "Vietnamese Food Any Day": "Vietnamese",
  "Vegan Vietnamese": "Vietnamese",
  "Afro-Vegan": "African & Caribbean",
  "Plentiful": "Caribbean",
  "Black Rican Vegan": "Caribbean",
  "The Vegan Korean": "Korean",
  "Mexican Home Cooking": "Mexican",
  "Land of Fish and Rice": "Chinese",
  "Four Seasons": "Italian",
  "Italian And Lebanese Cookbook": "Mediterranean",
  "More Than Carbonara": "Italian",
  "Pasta for All Seasons": "Italian",
  "The Best Pasta Recipes": "Italian",
  "The Classic Italian Cook Book": "Italian",
  "Zagami Family Cookbook": "Italian",
  "The Authentic Greek Kitchen": "Greek",
  "The Complete Greek Cookbook": "Greek",
  "The Complete and Authentic Thai Curry Cookbook 2": "Thai",
  "Real Thai Cooking": "Thai",
  "Thai Spice Recipes": "Thai",
  "Vegan Nigerian Kitchen": "Nigerian",
  "Tagine Cookbook": "Moroccan",
  "The High-Protein Vegan Cookbook": "International",
  "Vegan Chocolate": "International",
  "Salads & Dressings": "International",
  "Brunch Cookbook": "International",
  "Superfood Boost": "International",
  "Bread Cookbook": "International",
  "Raw Food": "International",
};

// ── Chapter → dish_type inference ──

const CHAPTER_TO_DISH_TYPE = {
  // Mains
  "main": ["main"],
  "mains": ["main"],
  "main course": ["main"],
  "main courses": ["main"],
  "main dishes": ["main"],
  "entrées": ["main"],
  "entrees": ["main"],
  "dinner": ["main"],
  "supper": ["main"],

  // Proteins
  "meat": ["main"],
  "poultry": ["main"],
  "poultry & meat": ["main"],
  "chicken": ["main"],
  "lamb": ["main"],
  "beef": ["main"],
  "pork": ["main"],
  "fish": ["main"],
  "fish & seafood": ["main"],
  "seafood": ["main"],

  // Grains / carbs that are often mains
  "rice": ["main"],
  "rice dishes": ["main"],
  "noodles": ["main"],
  "noodle dishes": ["main"],
  "grains": ["main"],
  "grains & pulses": ["main"],
  "pasta": ["main"],
  "risotto": ["main"],
  "curries": ["main"],
  "curry": ["main"],
  "stews": ["main"],
  "stew": ["main"],
  "casseroles": ["main"],
  "one-pot": ["main"],
  "wok": ["main"],
  "stir-fry": ["main"],
  "tacos": ["main"],

  // Soups
  "soup": ["soup"],
  "soups": ["soup"],
  "soups & stews": ["soup"],

  // Salads
  "salad": ["salad"],
  "salads": ["salad"],
  "salads & dressings": ["salad"],

  // Sides
  "side": ["side"],
  "sides": ["side"],
  "side dishes": ["side"],
  "vegetables": ["vegetable", "side"],
  "vegetable": ["vegetable", "side"],
  "legumes": ["side"],
  "beans": ["side"],
  "pickles": ["condiment"],
  "condiments": ["condiment"],
  "sauces": ["condiment"],
  "sauces & dressings": ["condiment"],
  "dressings": ["condiment"],
  "dips": ["starter"],
  "mezze": ["starter"],
  "appetizers": ["starter"],
  "starters": ["starter"],
  "snacks": ["starter"],

  // Baking / bread
  "bread": ["bread"],
  "breads": ["bread"],
  "baking": ["baking"],
  "pastry": ["baking"],
  "pastries": ["baking"],

  // Breakfast
  "breakfast": ["breakfast"],
  "brunch": ["breakfast"],

  // Desserts
  "dessert": ["dessert"],
  "desserts": ["dessert"],
  "sweets": ["dessert"],
  "cakes": ["dessert"],
  "cookies": ["dessert"],
  "chocolate": ["dessert"],
  "puddings": ["dessert"],
  "ice cream": ["dessert"],

  // Drinks
  "drinks": ["drink"],
  "beverages": ["drink"],
  "smoothies": ["drink"],
  "cocktails": ["drink"],

  // Cheese (treat as starter/side)
  "cheese": ["starter"],
};

// ── Name-based category inference (fallback) ──

const NAME_PATTERNS = [
  { pattern: /\b(cake|brownie|cookie|muffin|cupcake|tart|pie|pudding|mousse|sorbet|ice cream|gelato|crumble|fudge|truffle|meringue|macaron|baklava|halva|knafeh)\b/i, types: ["dessert"] },
  { pattern: /\bchocolate\b/i, types: ["dessert"] },
  { pattern: /\b(pancake|waffle|french toast|granola|porridge|oatmeal|johnnycake|frittata|shakshuka|eggs?\s)/i, types: ["breakfast"] },
  { pattern: /\b(smoothie|juice|lemonade|latte|tea|coffee|milkshake|drink)\b/i, types: ["drink"] },
  { pattern: /\b(soup|chowder|bisque|gazpacho|broth)\b/i, types: ["soup"] },
  { pattern: /\b(salad|slaw|coleslaw)\b/i, types: ["salad"] },
  { pattern: /\b(curry|masala|tikka|korma|vindaloo|jalfrezi|madras|rogan josh|biryani|pilaf|pilau)\b/i, types: ["main"] },
  { pattern: /\b(pasta|spaghetti|penne|rigatoni|linguine|fettuccine|tagliatelle|tagliolini|lasagne?|ravioli|gnocchi|risotto|carbonara|bolognese|arrabbiata|puttanesca)\b/i, types: ["main"] },
  { pattern: /\b(stew|tagine|casserole|pot roast|braise[d]?)\b/i, types: ["main"] },
  { pattern: /\b(stir.?fry|fried rice|noodles?|ramen|pho|pad thai|lo mein|chow mein|bibimbap|jjigae)\b/i, types: ["main"] },
  { pattern: /\b(burger|sandwich|wrap|quesadilla|burrito|taco|enchilada)\b/i, types: ["main"] },
  { pattern: /\b(roast chicken|roast lamb|roast beef|grilled chicken|grilled fish|baked fish|pan.?fried)\b/i, types: ["main"] },
  { pattern: /\b(naan|flatbread|pita|focaccia|ciabatta|sourdough|baguette|rolls?|buns?)\b/i, types: ["bread"] },
  { pattern: /\b(pickle|chutney|relish|salsa|aioli|hummus|baba ganoush|tzatziki|raita|sambal)\b/i, types: ["condiment"] },
  { pattern: /\b(dressing|vinaigrette|sauce|gravy|marinade)\b/i, types: ["condiment"] },
];

// ── Rough time estimates by dish type ──

const DEFAULT_TIMES = {
  soup: { prep: 15, cook: 30, total: 45 },
  salad: { prep: 15, cook: 0, total: 15 },
  main: { prep: 20, cook: 35, total: 55 },
  side: { prep: 10, cook: 20, total: 30 },
  starter: { prep: 15, cook: 15, total: 30 },
  dessert: { prep: 20, cook: 30, total: 50 },
  baking: { prep: 20, cook: 40, total: 60 },
  bread: { prep: 30, cook: 30, total: 60 },
  breakfast: { prep: 10, cook: 15, total: 25 },
  drink: { prep: 5, cook: 0, total: 5 },
  condiment: { prep: 10, cook: 10, total: 20 },
  vegetable: { prep: 10, cook: 20, total: 30 },
};

// ── Main enrichment logic ──

function inferDishType(recipe) {
  // Try chapter name first
  const chapter = (recipe.source?.chapter || recipe.category?.chapter || "").toLowerCase().trim();
  for (const [key, types] of Object.entries(CHAPTER_TO_DISH_TYPE)) {
    if (chapter === key || chapter.includes(key)) {
      return types;
    }
  }

  // Try recipe name patterns
  const name = recipe.name || "";
  for (const { pattern, types } of NAME_PATTERNS) {
    if (pattern.test(name)) {
      return types;
    }
  }

  // If cookbook is a specific cuisine with protein chapters, assume main
  const cookbook = recipe.source?.cookbook || "";
  if (chapter && /meat|chicken|fish|seafood|lamb|pork|beef|poultry/i.test(chapter)) {
    return ["main"];
  }

  // Default: if it has enough ingredients and method steps, likely a main
  if (recipe.ingredients?.length >= 5 && recipe.method?.length >= 3) {
    return ["main"];
  }

  return null; // Can't determine
}

function enrichRecipe(recipe) {
  let modified = false;

  // 1. Add cuisine tag if cookbook is mapped but recipe has no explicit cuisine field
  // (cuisine is derived at runtime from cookbook, so this is handled by the mapping above —
  //  we just need to make sure the mapping is used in recipes.ts)

  // 2. Add/fix category.dish_type if missing
  if (!recipe.category?.dish_type?.length) {
    const inferred = inferDishType(recipe);
    if (inferred) {
      if (!recipe.category) {
        recipe.category = { dish_type: inferred, chapter: recipe.source?.chapter || "" };
      } else {
        recipe.category.dish_type = inferred;
      }
      modified = true;
    }
  }

  // 3. Add rough time estimate if missing
  if (!recipe.time || recipe.time.total === 0) {
    const types = recipe.category?.dish_type || [];
    const primaryType = types[0];
    if (primaryType && DEFAULT_TIMES[primaryType]) {
      recipe.time = { ...DEFAULT_TIMES[primaryType] };
      modified = true;
    }
  }

  return modified;
}

// ── Run ──

function main() {
  const files = fs.readdirSync(RECIPES_DIR).filter(f => f.endsWith(".json") && f !== "index.json");
  let enriched = 0;
  let categoryAdded = 0;
  let timeAdded = 0;

  for (const file of files) {
    const filePath = path.join(RECIPES_DIR, file);
    const content = fs.readFileSync(filePath, "utf8");
    const recipe = JSON.parse(content);

    const hadCategory = !!recipe.category?.dish_type?.length;
    const hadTime = recipe.time && recipe.time.total > 0;

    const changed = enrichRecipe(recipe);

    if (changed) {
      fs.writeFileSync(filePath, JSON.stringify(recipe, null, 2) + "\n");
      enriched++;
      if (!hadCategory && recipe.category?.dish_type?.length) categoryAdded++;
      if (!hadTime && recipe.time?.total > 0) timeAdded++;
    }
  }

  console.log(`Processed ${files.length} recipes`);
  console.log(`Enriched ${enriched} recipes`);
  console.log(`  Categories added: ${categoryAdded}`);
  console.log(`  Time estimates added: ${timeAdded}`);

  // Print new stats
  let stats = { total: 0, withCategory: 0, withTime: 0, dishTypes: {} };
  for (const file of files) {
    const r = JSON.parse(fs.readFileSync(path.join(RECIPES_DIR, file), "utf8"));
    stats.total++;
    if (r.category?.dish_type?.length) {
      stats.withCategory++;
      r.category.dish_type.forEach(d => { stats.dishTypes[d] = (stats.dishTypes[d] || 0) + 1; });
    }
    if (r.time?.total > 0) stats.withTime++;
  }
  console.log(`\nAfter enrichment:`);
  console.log(`  With category: ${stats.withCategory}/${stats.total}`);
  console.log(`  With time: ${stats.withTime}/${stats.total}`);
  console.log(`  Dish types:`, stats.dishTypes);
}

main();
