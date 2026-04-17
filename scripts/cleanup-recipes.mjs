/**
 * Recipe Cleanup Script
 * - Infer cuisine from cookbook name
 * - Infer category/dish_type from chapter, recipe name, ingredients
 * - Add rough time estimates where missing
 * - Clean up recipe names (remove numbering prefixes)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RECIPES_DIR = path.join(__dirname, "../src/data/recipes");

// ----- Cookbook → Cuisine mapping -----
const COOKBOOK_CUISINES = {
  "Ottolenghi: The Cookbook": "Middle Eastern",
  Jerusalem: "Middle Eastern",
  Falastin: "Middle Eastern",
  Persiana: "Persian",
  "Souk to Table": "Middle Eastern",
  Plenty: "Middle Eastern",
  "Plenty More": "Middle Eastern",
  "Ottolenghi Simple": "Middle Eastern",
  "The Curry Guy": "Indian",
  "The Curry Guy Bible": "Indian",
  "The Indian Vegan": "Indian",
  "Vietnamese Food Any Day": "Southeast Asian",
  "Vegan Vietnamese": "Southeast Asian",
  "Afro-Vegan": "African & Caribbean",
  Plentiful: "Caribbean",
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
  "The Complete and Authentic Thai Curry Cookbook 2": "Southeast Asian",
  "Real Thai Cooking": "Southeast Asian",
  "Thai Spice Recipes": "Southeast Asian",
  "Vegan Nigerian Kitchen": "Nigerian",
  "Tagine Cookbook": "Moroccan",
  "Superfood Boost": "Other",
  "The High-Protein Vegan Cookbook": "Other",
  "Vegan Chocolate": "Other",
  "Salads & Dressings": "Other",
  "Brunch Cookbook": "Other",
  "Raw Food": "Other",
  "Bread Cookbook": "Other",
};

// ----- Chapters that indicate excluded categories -----
const EXCLUDED_CHAPTER_PATTERNS = [
  "dessert",
  "sweet",
  "baking",
  "patisserie",
  "pastry",
  "bread",
  "breakfast",
  "brunch",
  "drink",
  "beverage",
  "smoothie",
  "mylkshake",
  "coffee",
  "basic recipe",
  "basic sauce",
  "base sauce",
  "kitchen basic",
  "know-how",
  "condiment",
  "pickle",
  "preserve",
  "chutney",
  "spice blend",
  "sauce",
  "dressing",
  "desayuno",
];

// ----- Dish type inference from recipe name / ingredients -----
function inferDishType(recipe) {
  const name = recipe.name.toLowerCase();
  const chapter = (
    recipe.source?.chapter ||
    recipe.category?.chapter ||
    ""
  ).toLowerCase();
  const ingredients = (recipe.ingredients || [])
    .map((i) => i.item.toLowerCase())
    .join(" ");

  // Check chapter first
  if (chapter.includes("dessert") || chapter.includes("sweet")) return "dessert";
  if (chapter.includes("baking") || chapter.includes("patisserie")) return "baking";
  if (chapter.includes("bread") && !chapter.includes("&")) return "bread";
  if (chapter.includes("breakfast") || chapter.includes("brunch") || chapter.includes("desayuno"))
    return "breakfast";
  if (chapter.includes("drink") || chapter.includes("beverage") || chapter.includes("smoothie"))
    return "drink";
  if (chapter.includes("condiment") || chapter.includes("pickle") || chapter.includes("chutney"))
    return "condiment";
  if (chapter.includes("basic") || chapter.includes("base sauce") || chapter.includes("spice blend"))
    return "base";

  // Check name patterns
  if (/\b(cake|brownie|cookie|muffin|cupcake|fudge|ice cream|sorbet|pudding|truffle|macaron|tart|pie|crumble|compote|mousse)\b/.test(name))
    return "dessert";
  if (/\b(pancake|waffle|french toast|granola|porridge|oatmeal|johnnycake)\b/.test(name))
    return "breakfast";
  if (/\b(smoothie|juice|lemonade|cocktail|milkshake|lassi|chai)\b/.test(name))
    return "drink";
  if (/\b(chutney|pickle|jam|preserve|relish|ketchup|aioli|vinaigrette|mayonnaise)\b/.test(name))
    return "condiment";

  // Main dish categories
  if (chapter.includes("soup") || /\bsoup\b/.test(name)) return "soup";
  if (chapter.includes("salad") || /\bsalad\b/.test(name)) return "salad";
  if (
    chapter.includes("side") ||
    chapter.includes("accompaniment") ||
    chapter.includes("vegetable")
  ) {
    // If it has substantial protein, it's likely a main
    if (/\b(chicken|beef|lamb|fish|shrimp|pork|tofu|tempeh|seitan)\b/.test(ingredients)) {
      return "main";
    }
    return "side";
  }
  if (chapter.includes("starter") || chapter.includes("appetizer") || chapter.includes("small plate") || chapter.includes("snack"))
    return "starter";
  if (chapter.includes("curry") || chapter.includes("stew")) return "main";
  if (chapter.includes("meat") || chapter.includes("fish") || chapter.includes("poultry") || chapter.includes("seafood"))
    return "main";
  if (chapter.includes("main") || chapter.includes("large plate") || chapter.includes("entree"))
    return "main";
  if (chapter.includes("rice") || chapter.includes("biryani") || chapter.includes("noodle") || chapter.includes("pasta"))
    return "main";
  if (chapter.includes("grain") || chapter.includes("pulse") || chapter.includes("legume"))
    return "main";
  if (chapter.includes("roast") || chapter.includes("grill") || chapter.includes("fry") || chapter.includes("street food"))
    return "main";

  // Fallback: if name suggests main-dish patterns
  if (/\b(curry|stew|roast|stir.?fry|tagine|biryani|risotto|paella|casserole|lasagna|pie|wrap|burger|sandwich)\b/.test(name))
    return "main";
  if (/\b(pasta|spaghetti|penne|linguine|fettuccine|rigatoni|noodle|ramen|pad thai|lo mein)\b/.test(name))
    return "main";
  if (/\b(chicken|beef|lamb|pork|fish|salmon|shrimp|tofu|tempeh)\b/.test(name))
    return "main";

  // If has enough ingredients, likely a main
  if (recipe.ingredients && recipe.ingredients.length >= 5) return "main";

  return "main"; // default
}

// ----- Time estimation -----
function estimateTime(recipe) {
  const name = recipe.name.toLowerCase();
  const method = recipe.method || [];
  const numSteps = method.length;
  const numIngredients = (recipe.ingredients || []).length;
  const chapter = (
    recipe.source?.chapter ||
    recipe.category?.chapter ||
    ""
  ).toLowerCase();

  // Quick dishes
  if (/\b(salad|dressing|smoothie|juice)\b/.test(name)) {
    return { prep: 15, cook: 0, total: 15 };
  }
  if (/\b(soup)\b/.test(name) && !name.includes("slow")) {
    return { prep: 15, cook: 25, total: 40 };
  }
  if (/\b(stir.?fry|pad thai|fried rice)\b/.test(name)) {
    return { prep: 15, cook: 15, total: 30 };
  }

  // Slow dishes
  if (/\b(braise|slow|stew|tagine|roast|bake|lasagna|casserole)\b/.test(name)) {
    return { prep: 20, cook: 60, total: 80 };
  }
  if (/\b(biryani)\b/.test(name)) {
    return { prep: 30, cook: 45, total: 75 };
  }

  // Curry
  if (/\b(curry)\b/.test(name) || chapter.includes("curry")) {
    return { prep: 15, cook: 30, total: 45 };
  }

  // Pasta
  if (/\b(pasta|spaghetti|penne|linguine|fettuccine|rigatoni)\b/.test(name)) {
    return { prep: 10, cook: 25, total: 35 };
  }

  // Estimate from complexity
  const prep = Math.max(10, Math.min(30, numIngredients * 2));
  const cook = Math.max(15, Math.min(60, numSteps * 8));
  return { prep, cook, total: prep + cook };
}

// ----- Clean recipe name (remove numbering prefix) -----
function cleanName(name) {
  // Remove patterns like "(11)     " or "(2)  " at the start
  return name.replace(/^\(\d+\)\s+/, "").trim();
}

// ----- Main cleanup -----
const files = fs.readdirSync(RECIPES_DIR).filter((f) => f.endsWith(".json") && f !== "index.json");

let stats = {
  total: files.length,
  namesCleaned: 0,
  cuisineAdded: 0,
  dishTypeInferred: 0,
  timeEstimated: 0,
  chapterInferred: 0,
};

for (const file of files) {
  const filePath = path.join(RECIPES_DIR, file);
  const recipe = JSON.parse(fs.readFileSync(filePath, "utf8"));
  let modified = false;

  // 1. Clean name
  const cleanedName = cleanName(recipe.name);
  if (cleanedName !== recipe.name) {
    recipe.name = cleanedName;
    modified = true;
    stats.namesCleaned++;
  }

  // 2. Ensure category object exists
  if (!recipe.category) {
    recipe.category = { dish_type: [], chapter: "" };
    modified = true;
  }

  // 3. Infer chapter from source.chapter if category.chapter is missing
  if (!recipe.category.chapter && recipe.source?.chapter) {
    recipe.category.chapter = recipe.source.chapter;
    modified = true;
    stats.chapterInferred++;
  }

  // 4. Infer dish_type if empty
  if (!recipe.category.dish_type || recipe.category.dish_type.length === 0) {
    const inferred = inferDishType(recipe);
    recipe.category.dish_type = [inferred];
    modified = true;
    stats.dishTypeInferred++;
  }

  // 5. Add time estimates where missing
  if (!recipe.time || (!recipe.time.total && !recipe.time.prep && !recipe.time.cook)) {
    recipe.time = estimateTime(recipe);
    modified = true;
    stats.timeEstimated++;
  } else if (recipe.time && !recipe.time.total && (recipe.time.prep || recipe.time.cook)) {
    recipe.time.total = (recipe.time.prep || 0) + (recipe.time.cook || 0);
    modified = true;
    stats.timeEstimated++;
  }

  // 6. Store cuisine tag directly on recipe for faster access
  const cookbook = recipe.source?.cookbook;
  if (cookbook && COOKBOOK_CUISINES[cookbook] && !recipe.cuisine) {
    recipe.cuisine = COOKBOOK_CUISINES[cookbook];
    modified = true;
    stats.cuisineAdded++;
  }

  if (modified) {
    fs.writeFileSync(filePath, JSON.stringify(recipe, null, 2) + "\n");
  }
}

console.log("Recipe cleanup complete!");
console.log(JSON.stringify(stats, null, 2));
