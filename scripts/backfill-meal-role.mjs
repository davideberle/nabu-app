#!/usr/bin/env node
/**
 * Backfill category.meal_role on all static cookbook recipes.
 *
 * meal_role describes the role a dish plays in a meal plan:
 *   main      – centrepiece dish (mains, soups, substantial salads)
 *   side      – accompaniment (sides, vegetables, light salads, bread)
 *   starter   – first course / appetiser
 *   dessert   – sweet course (desserts, baking, chocolate)
 *   component – sauces, bases, condiments (not standalone)
 *   breakfast – morning-specific dishes
 *   drink     – beverages
 *
 * Also fills in category.dish_type for the ~436 recipes that are missing it,
 * using chapter-name and recipe-name heuristics.
 *
 * Run: node scripts/backfill-meal-role.mjs [--dry-run]
 */

import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RECIPES_DIR = join(__dirname, "..", "src", "data", "recipes");
const DRY_RUN = process.argv.includes("--dry-run");

// ── dish_type → meal_role mapping ──

const DISH_TYPE_TO_ROLE = {
  main: "main",
  soup: "main",        // most soups are a meal
  salad: "side",       // default; overridden to "main" for substantial salads
  side: "side",
  vegetable: "side",
  bread: "side",
  starter: "starter",
  dessert: "dessert",
  baking: "dessert",
  condiment: "component",
  base: "component",
  breakfast: "breakfast",
  drink: "drink",
};

// Salads that are substantial enough to be a main
const SUBSTANTIAL_SALAD_PATTERNS = [
  /\b(chicken|beef|lamb|pork|salmon|tuna|prawn|shrimp|tofu|tempeh|halloumi|grain|quinoa|lentil|bean|chickpea|noodle|pasta)\b/i,
];

// ── Chapter-based dish_type inference (for the 436 missing category) ──

const CHAPTER_TO_DISH_TYPE = {
  "main": ["main"], "mains": ["main"], "main course": ["main"],
  "main courses": ["main"], "main dishes": ["main"], "entrées": ["main"],
  "dinner": ["main"], "supper": ["main"],
  "meat": ["main"], "poultry": ["main"], "poultry & meat": ["main"],
  "chicken": ["main"], "lamb": ["main"], "beef": ["main"], "pork": ["main"],
  "fish": ["main"], "fish & seafood": ["main"], "seafood": ["main"],
  "rice": ["main"], "noodles": ["main"], "grains": ["main"],
  "grains & pulses": ["main"], "pasta": ["main"], "curries": ["main"],
  "curry": ["main"], "stews": ["main"], "stew": ["main"],
  "casseroles": ["main"], "one-pot": ["main"], "wok": ["main"],
  "stir-fry": ["main"], "tacos": ["main"],
  "soup": ["soup"], "soups": ["soup"], "soups & stews": ["soup"],
  "salad": ["salad"], "salads": ["salad"],
  "side": ["side"], "sides": ["side"], "side dishes": ["side"],
  "vegetables": ["vegetable", "side"], "vegetable": ["vegetable", "side"],
  "legumes": ["side"], "beans": ["side"],
  "pickles": ["condiment"], "condiments": ["condiment"],
  "sauces": ["condiment"], "sauces & dressings": ["condiment"],
  "dips": ["starter"], "mezze": ["starter"], "appetizers": ["starter"],
  "starters": ["starter"], "snacks": ["starter"],
  "bread": ["bread"], "breads": ["bread"],
  "baking": ["baking"], "pastry": ["baking"], "pastries": ["baking"],
  "breakfast": ["breakfast"], "brunch": ["breakfast"],
  "dessert": ["dessert"], "desserts": ["dessert"], "sweets": ["dessert"],
  "cakes": ["dessert"], "cookies": ["dessert"], "chocolate": ["dessert"],
  "drinks": ["drink"], "beverages": ["drink"], "smoothies": ["drink"],
  "cheese": ["starter"],
};

const NAME_PATTERNS = [
  { pattern: /\b(cake|brownie|cookie|muffin|cupcake|tart|pie|pudding|mousse|sorbet|ice cream|gelato|crumble|fudge|truffle|meringue|macaron|baklava|halva|knafeh)\b/i, types: ["dessert"] },
  { pattern: /\bchocolate\b/i, types: ["dessert"] },
  { pattern: /\b(pancake|waffle|french toast|granola|porridge|oatmeal|johnnycake|frittata|shakshuka)\b/i, types: ["breakfast"] },
  { pattern: /\b(smoothie|juice|lemonade|latte|tea|coffee|milkshake|drink)\b/i, types: ["drink"] },
  { pattern: /\b(soup|chowder|bisque|gazpacho|broth)\b/i, types: ["soup"] },
  { pattern: /\b(salad|slaw|coleslaw)\b/i, types: ["salad"] },
  { pattern: /\b(curry|masala|tikka|korma|vindaloo|jalfrezi|madras|rogan josh|biryani|pilaf|pilau)\b/i, types: ["main"] },
  { pattern: /\b(pasta|spaghetti|penne|rigatoni|linguine|fettuccine|tagliatelle|lasagne?|ravioli|gnocchi|risotto|carbonara|bolognese|arrabbiata|puttanesca)\b/i, types: ["main"] },
  { pattern: /\b(stew|tagine|casserole|pot roast|braise[d]?)\b/i, types: ["main"] },
  { pattern: /\b(stir.?fry|fried rice|noodles?|ramen|pho|pad thai|lo mein|chow mein|bibimbap|jjigae)\b/i, types: ["main"] },
  { pattern: /\b(burger|sandwich|wrap|quesadilla|burrito|taco|enchilada)\b/i, types: ["main"] },
  { pattern: /\b(roast chicken|roast lamb|roast beef|grilled chicken|grilled fish|baked fish|pan.?fried)\b/i, types: ["main"] },
  { pattern: /\b(naan|flatbread|pita|focaccia|ciabatta|sourdough|baguette)\b/i, types: ["bread"] },
  { pattern: /\b(pickle|chutney|relish|salsa|aioli|hummus|baba ganoush|tzatziki|raita|sambal)\b/i, types: ["condiment"] },
  { pattern: /\b(dressing|vinaigrette|sauce|gravy|marinade)\b/i, types: ["condiment"] },
];

function inferDishType(recipe) {
  // Try chapter name
  const chapter = (recipe.source?.chapter || "").toLowerCase().trim();
  for (const [key, types] of Object.entries(CHAPTER_TO_DISH_TYPE)) {
    if (chapter === key || chapter.includes(key)) {
      return types;
    }
  }
  // Try recipe name patterns
  const name = recipe.name || "";
  for (const { pattern, types } of NAME_PATTERNS) {
    if (pattern.test(name)) return types;
  }
  // Secondary name patterns for edge cases
  const name2 = name.toLowerCase();
  if (/\b(pork|beef|lamb|chicken|salmon|tuna|steak|sausage|bacon|cutlet|kabob|omelet|stroganoff|bake|aloo|gobhi)\b/i.test(name)) return ["main"];
  if (/\b(beans?|squash|eggplant|green bean)\b/i.test(name)) return ["side"];
  if (/\b(yogurt|pesto|paste|olive.*tomato)\b/i.test(name)) return ["condiment"];
  if (/\b(rice)\b/i.test(name)) return ["side"];
  if (/\b(cocktail|sparkling)\b/i.test(name)) return ["drink"];
  if (/\b(torte|berries.*cream|sweet roll[s]?)\b/i.test(name)) return ["dessert"];
  if (/\bfull monty\b/i.test(name)) return ["breakfast"];

  // If it has enough substance, assume main
  if (recipe.ingredients?.length >= 5 && recipe.method?.length >= 3) {
    return ["main"];
  }
  return null;
}

// ── Derive meal_role from dish_type + recipe context ──

function deriveMealRole(recipe) {
  const dishTypes = recipe.category?.dish_type ?? [];
  if (dishTypes.length === 0) return null;

  const primary = dishTypes[0].toLowerCase();

  // Special case: substantial salads are mains
  if (primary === "salad") {
    const name = recipe.name || "";
    if (SUBSTANTIAL_SALAD_PATTERNS.some((p) => p.test(name))) {
      return "main";
    }
    // Salads with many ingredients are likely mains
    if (recipe.ingredients?.length >= 8) {
      return "main";
    }
  }

  return DISH_TYPE_TO_ROLE[primary] ?? "main";
}

// ── Main ──

const files = readdirSync(RECIPES_DIR).filter(
  (f) => f.endsWith(".json") && f !== "index.json"
);

let categoryFilled = 0;
let mealRoleAdded = 0;
let mealRoleSkipped = 0;
let filesModified = 0;
const roleDistribution = {};
const ambiguous = []; // recipes where we couldn't determine anything

for (const file of files) {
  const filePath = join(RECIPES_DIR, file);
  const recipe = JSON.parse(readFileSync(filePath, "utf8"));
  let modified = false;

  // Step 1: Fill in missing category.dish_type
  if (!recipe.category || !recipe.category.dish_type?.length) {
    const inferred = inferDishType(recipe);
    if (inferred) {
      recipe.category = {
        dish_type: inferred,
        chapter: recipe.source?.chapter || "",
        ...(recipe.category || {}),
        dish_type: inferred,
      };
      categoryFilled++;
      modified = true;
    } else {
      ambiguous.push({ file, name: recipe.name, cookbook: recipe.source?.cookbook });
      // Still create category stub so meal_role can be set later
    }
  }

  // Step 2: Add meal_role
  if (recipe.category?.dish_type?.length) {
    const role = deriveMealRole(recipe);
    if (role) {
      recipe.category.meal_role = role;
      mealRoleAdded++;
      roleDistribution[role] = (roleDistribution[role] || 0) + 1;
      modified = true;
    } else {
      mealRoleSkipped++;
    }
  } else {
    mealRoleSkipped++;
  }

  if (modified && !DRY_RUN) {
    writeFileSync(filePath, JSON.stringify(recipe, null, 2) + "\n");
    filesModified++;
  } else if (modified) {
    filesModified++;
  }
}

console.log(`\n=== Backfill meal_role results ===`);
console.log(`Total recipes: ${files.length}`);
console.log(`Category dish_type filled: ${categoryFilled}`);
console.log(`meal_role assigned: ${mealRoleAdded}`);
console.log(`meal_role skipped (no dish_type): ${mealRoleSkipped}`);
console.log(`Files modified: ${filesModified}`);
console.log(`\nmeal_role distribution:`, roleDistribution);

if (ambiguous.length > 0) {
  console.log(`\n=== Ambiguous recipes (${ambiguous.length}) — could not determine dish_type ===`);
  for (const r of ambiguous) {
    console.log(`  ${r.file} | ${r.name} | ${r.cookbook}`);
  }
}

if (DRY_RUN) {
  console.log(`\n(dry run — no files were modified)`);
}
