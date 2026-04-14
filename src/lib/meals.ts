import { type Recipe, getCuisine, getDietary } from "./recipes";

// ----- season helpers -----

type Season = "spring" | "summer" | "fall" | "winter";

/** Northern-hemisphere season from month (0-indexed). */
function currentSeason(now = new Date()): Season {
  const m = now.getMonth(); // 0=Jan
  if (m >= 2 && m <= 4) return "spring";
  if (m >= 5 && m <= 7) return "summer";
  if (m >= 8 && m <= 10) return "fall";
  return "winter";
}

const OPPOSITE_SEASON: Record<Season, Season> = {
  spring: "fall",
  summer: "winter",
  fall: "spring",
  winter: "summer",
};

/** Keywords that strongly signal a recipe belongs to a particular season. */
const SEASON_SIGNALS: Record<Season, RegExp> = {
  spring: /\b(spring|asparagus|fava bean|ramp|wild garlic|pea shoot|new potato|morel)\b/i,
  summer: /\b(summer|watermelon|peach|grilled corn|zucchini|bbq|barbecue|gazpacho|ice pop|popsicle|sundried)\b/i,
  fall: /\b(fall|autumn|squash|pumpkin|apple cider|wheat berr|cranberr|sweet potato)\b/i,
  winter: /\b(winter|root vegetable|parsnip|turnip|braised|braise|hearty stew|mulled|warming)\b/i,
};

/**
 * Intro phrases that signal a season. Use multi-word phrases or adjective+noun
 * patterns to avoid false positives (e.g. "fall somewhere" ≠ autumn).
 */
const INTRO_SEASON_SIGNALS: Record<Season, RegExp> = {
  spring: /\b(spring (dish|recipe|meal|brunch|dinner|lunch|salad|vegeta|cook|treat|favor)|(in|for|of) spring)\b/i,
  summer: /\b(summer (dish|recipe|meal|salad|treat|favor|cook|grill|bbq)|(in|for|of) summer|hot day|warm[- ]weather)\b/i,
  fall: /\b(fall (dish|recipe|meal|dinner|cook|treat|favor|day|evening)|(in|for|of) (fall|autumn)|autumn(al)?)\b/i,
  winter: /\b(winter (dish|recipe|meal|dinner|cook|treat|favor|warm|stew)|(in|for|of) winter|cold day|cold[- ]weather|fireside)\b/i,
};

/**
 * Returns the primary season a recipe belongs to, or null if season-neutral.
 * Checks name first (strongest signal), then intro text.
 */
function recipeSeason(recipe: Recipe): Season | null {
  const name = recipe.name;
  for (const [season, re] of Object.entries(SEASON_SIGNALS) as [Season, RegExp][]) {
    if (re.test(name)) return season;
  }
  const intro = recipe.introduction || recipe.intro || "";
  if (intro) {
    for (const [season, re] of Object.entries(INTRO_SEASON_SIGNALS) as [Season, RegExp][]) {
      if (re.test(intro)) return season;
    }
  }
  return null; // season-neutral
}

/**
 * Filter out recipes whose season is the OPPOSITE of the current season.
 * Season-neutral and adjacent-season recipes pass through.
 */
function filterBySeason<T extends Recipe>(recipes: T[], now?: Date): T[] {
  const season = currentSeason(now);
  const opposite = OPPOSITE_SEASON[season];
  return recipes.filter((r) => {
    const rs = recipeSeason(r);
    return rs !== opposite;
  });
}

// ----- protein-clash helpers for side pairing -----

const PROTEIN_PATTERNS: { protein: string; re: RegExp }[] = [
  { protein: "beef", re: /\b(beef|steak|brisket|short rib|ground beef|sirloin|ribeye)\b/i },
  { protein: "chicken", re: /\b(chicken|poultry)\b/i },
  { protein: "pork", re: /\b(pork|bacon|ham|pancetta|prosciutto|sausage|chorizo)\b/i },
  { protein: "lamb", re: /\b(lamb|mutton)\b/i },
  { protein: "fish", re: /\b(salmon|tuna|trout|cod|halibut|catfish|sea bass|snapper|mackerel|sardine|anchov|swordfish|fish)\b/i },
  { protein: "seafood", re: /\b(shrimp|prawn|scallop|crab|lobster|mussel|clam|oyster|squid|calamari|octopus|seafood)\b/i },
  { protein: "duck", re: /\b(duck)\b/i },
  { protein: "turkey", re: /\b(turkey)\b/i },
];

/** Returns the set of protein categories present in a recipe (by name + ingredients). */
function detectProteins(recipe: Recipe): Set<string> {
  const found = new Set<string>();
  const text = recipe.name + " " + recipe.ingredients.map((i) => i.item).join(" ");
  for (const { protein, re } of PROTEIN_PATTERNS) {
    if (re.test(text)) found.add(protein);
  }
  // Treat fish and seafood as a single group for clash purposes
  if (found.has("fish") || found.has("seafood")) {
    found.add("fish");
    found.add("seafood");
  }
  return found;
}

/** Returns true if a side's proteins would clash with the main's proteins. */
function hasProteinClash(main: Recipe, side: Recipe): boolean {
  const mainProteins = detectProteins(main);
  if (mainProteins.size === 0) return false; // veg main — anything goes
  const sideProteins = detectProteins(side);
  if (sideProteins.size === 0) return false; // veg side — always fine
  // Clash = side has a DIFFERENT protein than the main
  for (const sp of sideProteins) {
    if (!mainProteins.has(sp)) return true;
  }
  return false;
}

// ----- types -----

export type MealSlot = {
  main: { id: string; name: string };
  sides?: { id: string; name: string }[];
};

export type WeekContextItem = {
  id: string;
  date?: string; // optional day-specific context
  kind: "restaurant" | "guests" | "quick" | "skip" | "leftovers" | "custom";
  note: string;
  effect?: "skip-meal" | "guest-friendly" | "quick-meal" | "light-meal";
};

export type MealPlan = {
  week: string; // "2026-W15"
  days: {
    date: string; // "2026-04-07"
    dayOfWeek: string; // "Monday"
    type: "weekday" | "weekend";
    recipeId: string | null;
    recipeName: string | null;
    meal?: MealSlot | null;
  }[];
  context?: WeekContextItem[];
  notes?: string; // free-text week notes
  locked: boolean;
  createdAt: string;
  updatedAt?: string;
};

export type WeekendMealOption = {
  main: Recipe;
  sides: Recipe[];
};

// ----- helpers -----

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function isVegetarianOrVegan(recipe: Recipe): boolean {
  const tags = getDietary(recipe);
  return tags.some(
    (t) =>
      t.toLowerCase() === "vegan" || t.toLowerCase() === "vegetarian"
  );
}

const PASTA_WORDS = [
  "pasta",
  "spaghetti",
  "penne",
  "linguine",
  "rigatoni",
  "fettuccine",
  "tagliatelle",
  "lasagna",
  "carbonara",
  "orzo",
];

function isPasta(recipe: Recipe): boolean {
  const nameLower = recipe.name.toLowerCase();
  if (PASTA_WORDS.some((w) => nameLower.includes(w))) return true;
  const dishTypes = recipe.category?.dish_type ?? [];
  if (dishTypes.some((d) => d.toLowerCase().includes("pasta"))) return true;
  if (
    recipe.ingredients.some((ing) =>
      PASTA_WORDS.some((w) => ing.item.toLowerCase().includes(w))
    )
  )
    return true;
  return false;
}

const LIGHT_DISH_WORDS = ["salad", "soup", "bowl"];

function isLight(recipe: Recipe): boolean {
  const nameLower = recipe.name.toLowerCase();
  if (LIGHT_DISH_WORDS.some((w) => nameLower.includes(w))) return true;
  const dishTypes = recipe.category?.dish_type ?? [];
  if (
    dishTypes.some((d) =>
      LIGHT_DISH_WORDS.some((w) => d.toLowerCase().includes(w))
    )
  )
    return true;
  if (recipe.time?.total && recipe.time.total > 0 && recipe.time.total < 45)
    return true;
  const dietary = getDietary(recipe);
  if (dietary.some((t) => t.toLowerCase() === "low-calorie")) return true;
  return false;
}

// ----- filtering: only select dinner-worthy recipes -----

const EXCLUDED_DISH_TYPES = new Set([
  "dessert", "baking", "breakfast", "drink", "condiment", "base", "bread",
]);

/** Chapter names that should never appear in dinner options */
const EXCLUDED_CHAPTER_PATTERNS = [
  "dessert", "sweet", "baking", "patisserie", "pastry",
  "bread", "breakfast", "brunch", "drink", "beverage",
  "smoothie", "mylkshake", "coffee", "basic recipe",
  "basic sauce", "base sauce", "kitchen basic", "know-how",
  "condiment", "pickle", "preserve", "chutney", "spice blend",
  "desayuno",
];

/**
 * Returns true if a recipe is suitable as a dinner main dish.
 */
function isDinnerWorthy(recipe: Recipe): boolean {
  const dishTypes = recipe.category?.dish_type ?? [];
  const lowTypes = dishTypes.map((t) => t.toLowerCase());

  // Exclude non-dinner dish types
  if (lowTypes.some((t) => EXCLUDED_DISH_TYPES.has(t))) return false;

  // Exclude by chapter name
  const chapter = (
    recipe.source?.chapter ||
    recipe.category?.chapter ||
    ""
  ).toLowerCase();
  if (chapter && EXCLUDED_CHAPTER_PATTERNS.some((p) => chapter.includes(p))) return false;

  // Exclude side-only dishes (unless they're also tagged as main/soup/salad)
  const hasMainRole = lowTypes.some(
    (t) => t === "main" || t === "soup" || t === "salad"
  );
  if (lowTypes.includes("side") && !hasMainRole) return false;
  if (lowTypes.includes("vegetable") && !hasMainRole) return false;
  if (lowTypes.includes("starter") && !hasMainRole) return false;

  // Name-based exclusions for things that slipped through
  const nameLower = recipe.name.toLowerCase();
  const breakfastWords = ["pancake", "waffle", "johnnycake", "french toast", "granola", "porridge", "oatmeal"];
  if (breakfastWords.some((w) => nameLower.includes(w))) return false;

  const dessertWords = ["cake", "brownie", "cookie", "muffin", "cupcake", "fudge", "ice cream", "sorbet", "pudding", "truffle", "macaron"];
  if (dessertWords.some((w) => nameLower.includes(w))) return false;

  // Exclude sauces/dressings masquerading as recipes
  const sauceWords = ["dressing", "vinaigrette", "aioli", "mayonnaise", "ketchup"];
  if (sauceWords.some((w) => nameLower.includes(w))) return false;

  // Must have a reasonable number of ingredients (not just a sauce/dip)
  if (recipe.ingredients.length < 3) return false;

  // Must have method steps
  if (!recipe.method || recipe.method.length < 2) return false;

  return true;
}

/**
 * Returns true if a recipe works as a side dish for a weekend meal combo.
 */
function isSideDish(recipe: Recipe): boolean {
  const dishTypes = (recipe.category?.dish_type ?? []).map((t) => t.toLowerCase());
  if (dishTypes.includes("side") || dishTypes.includes("vegetable") || dishTypes.includes("salad") || dishTypes.includes("starter")) {
    return true;
  }
  return false;
}

/**
 * Infer a display category for recipe cards.
 */
export function getDisplayCategory(recipe: Recipe): string {
  const dishTypes = (recipe.category?.dish_type ?? []).map((t) => t.toLowerCase());
  const name = recipe.name.toLowerCase();

  if (isPasta(recipe)) return "Pasta";
  if (dishTypes.includes("soup") || name.includes("soup") || name.includes("stew")) return "Soup";
  if (dishTypes.includes("salad") || name.includes("salad")) return "Salad";
  if (name.includes("curry") || name.includes("masala")) return "Curry";
  if (name.includes("bowl")) return "Bowl";
  if (name.includes("stir") && name.includes("fry")) return "Stir-Fry";
  if (name.includes("tagine")) return "Tagine";
  if (name.includes("biryani") || name.includes("rice")) return "Rice";
  if (name.includes("roast")) return "Roast";
  if (name.includes("grill")) return "Grill";
  return "Main";
}

function pickWithoutCuisineRepeat(
  pool: Recipe[],
  count: number,
  alreadyPicked: Recipe[]
): Recipe[] {
  const picked: Recipe[] = [];
  const usedCuisines = new Set(alreadyPicked.map((r) => getCuisine(r)));
  const remaining = shuffle(pool);

  // Prefer recipes with images
  remaining.sort((a, b) => (b.image ? 1 : 0) - (a.image ? 1 : 0));

  for (const r of remaining) {
    if (picked.length >= count) break;
    const cuisine = getCuisine(r);
    const lastCuisine =
      picked.length > 0 ? getCuisine(picked[picked.length - 1]) : null;
    if (cuisine === lastCuisine) continue;
    if (usedCuisines.has(cuisine) && remaining.length > count * 2) continue;
    picked.push(r);
    usedCuisines.add(cuisine);
  }

  // If we couldn't fill, relax constraints
  if (picked.length < count) {
    for (const r of remaining) {
      if (picked.length >= count) break;
      if (picked.some((p) => p.id === r.id)) continue;
      picked.push(r);
    }
  }

  return picked;
}

// ----- main selection -----

export type GenerationHints = {
  skipCount?: number;
  preferQuick?: boolean;
  preferGuestFriendly?: boolean;
};

export function selectMealOptions(
  allRecipes: Recipe[],
  excludeIds?: Set<string>,
  hints?: GenerationHints
): {
  weekday: Recipe[];
  weekend: Recipe[];
  weekendMeals: WeekendMealOption[];
} {
  // Filter to dinner-worthy recipes only
  let dinnerRecipes = allRecipes.filter(isDinnerWorthy);

  // Remove previously-shown recipes
  if (excludeIds && excludeIds.size > 0) {
    dinnerRecipes = dinnerRecipes.filter((r) => !excludeIds.has(r.id));
  }

  // Drop recipes from the opposite season (spring ≠ fall suggestions, etc.)
  dinnerRecipes = filterBySeason(dinnerRecipes);

  // Prefer recipes with images — if we have enough, use only those
  const withImages = dinnerRecipes.filter((r) => !!r.image);
  let pool = withImages.length >= 40 ? withImages : dinnerRecipes;

  // If context requests quick/light meals, boost those in the pool
  if (hints?.preferQuick) {
    const quickPool = pool.filter(isLight);
    if (quickPool.length >= 10) pool = quickPool;
  }

  // Partition recipes
  const vegRecipes = pool.filter(isVegetarianOrVegan);
  const nonVegRecipes = pool.filter((r) => !isVegetarianOrVegan(r));
  const lightRecipes = pool.filter(isLight);
  const pastaRecipes = pool.filter(isPasta);

  // Reduce target counts when days are skipped
  const skip = hints?.skipCount ?? 0;
  const weekdayTarget = Math.max(2, 6 - skip);
  const weekendTarget = Math.max(1, 4 - Math.max(0, skip - 2));

  // We want 3-4 vegetarian/vegan out of 10 total
  const vegCount = 3 + Math.round(Math.random()); // 3 or 4

  // Weekend picks. Include at least 1 pasta for Sunday suggestion.
  const weekendPasta = shuffle(pastaRecipes).slice(0, 1);
  const weekendPastaIsVeg = weekendPasta.length > 0 && isVegetarianOrVegan(weekendPasta[0]);

  const weekendVegTarget = Math.min(2, vegCount);
  const weekendVegNeeded = weekendVegTarget - (weekendPastaIsVeg ? 1 : 0);

  const usedIds = new Set(weekendPasta.map((r) => r.id));
  const weekendVegPicks = pickWithoutCuisineRepeat(
    shuffle(vegRecipes).filter((r) => !usedIds.has(r.id)),
    Math.max(0, weekendVegNeeded),
    weekendPasta
  );
  weekendVegPicks.forEach((r) => usedIds.add(r.id));

  const weekendNonVegNeeded = weekendTarget - weekendPasta.length - weekendVegPicks.length;
  const weekendNonVegPicks = pickWithoutCuisineRepeat(
    shuffle(nonVegRecipes).filter((r) => !usedIds.has(r.id)),
    weekendNonVegNeeded,
    [...weekendPasta, ...weekendVegPicks]
  );
  weekendNonVegPicks.forEach((r) => usedIds.add(r.id));

  const weekend = shuffle([
    ...weekendPasta,
    ...weekendVegPicks,
    ...weekendNonVegPicks,
  ]);

  // Build weekend meal combos with complementary sides from same cuisine.
  // Filter sides: drop opposite-season sides and prevent protein clashes
  // (e.g. no salmon side with a beef main).
  const allSideRecipes = filterBySeason(allRecipes.filter(isSideDish));
  const weekendMeals: WeekendMealOption[] = weekend.map((main) => {
    const mainCuisine = getCuisine(main);
    // Exclude sides whose protein clashes with the main's protein
    const compatibleSides = allSideRecipes.filter(
      (s) => s.id !== main.id && !hasProteinClash(main, s)
    );
    const sameCuisineSides = shuffle(
      compatibleSides.filter((s) => getCuisine(s) === mainCuisine)
    );
    const otherSides = shuffle(
      compatibleSides.filter((s) => getCuisine(s) !== mainCuisine)
    );
    const sides: Recipe[] = [];
    for (const s of sameCuisineSides) {
      if (sides.length >= 2) break;
      sides.push(s);
    }
    for (const s of otherSides) {
      if (sides.length >= 3) break;
      sides.push(s);
    }
    // Backfill same-cuisine if we didn't reach 2 earlier
    for (const s of sameCuisineSides) {
      if (sides.length >= 2) break;
      if (!sides.some((x) => x.id === s.id)) sides.push(s);
    }
    return { main, sides };
  });

  // Weekday picks (reduced by skip count)
  const weekdayVegTarget = vegCount - weekendVegPicks.length - (weekendPastaIsVeg ? 1 : 0);

  const lightPool = shuffle(lightRecipes).filter((r) => !usedIds.has(r.id));
  const lightPicks = lightPool.slice(0, 2);
  lightPicks.forEach((r) => usedIds.add(r.id));

  const lightVegCount = lightPicks.filter(isVegetarianOrVegan).length;
  const remainingVegNeeded = Math.max(0, weekdayVegTarget - lightVegCount);

  const moreVeg = pickWithoutCuisineRepeat(
    shuffle(vegRecipes).filter((r) => !usedIds.has(r.id)),
    remainingVegNeeded,
    lightPicks
  );
  moreVeg.forEach((r) => usedIds.add(r.id));

  const moreNonVegNeeded = weekdayTarget - lightPicks.length - moreVeg.length;
  const moreNonVeg = pickWithoutCuisineRepeat(
    shuffle(nonVegRecipes).filter((r) => !usedIds.has(r.id)),
    moreNonVegNeeded,
    [...lightPicks, ...moreVeg]
  );

  const weekday = shuffle([...lightPicks, ...moreVeg, ...moreNonVeg]);

  return { weekday, weekend, weekendMeals };
}

// ----- week date helpers -----

export function getISOWeek(date: Date): { year: number; week: number } {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );
  return { year: d.getUTCFullYear(), week };
}

export function getWeekMonday(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const mondayOfW1 = new Date(jan4.getTime());
  mondayOfW1.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1);
  const target = new Date(mondayOfW1.getTime());
  target.setUTCDate(mondayOfW1.getUTCDate() + (week - 1) * 7);
  return target;
}

export function getWeekDates(
  year: number,
  week: number
): { date: string; dayOfWeek: string }[] {
  const monday = getWeekMonday(year, week);
  const offsets = [
    { offset: 0, day: "Monday" },
    { offset: 1, day: "Tuesday" },
    { offset: 2, day: "Wednesday" },
    { offset: 3, day: "Thursday" },
    { offset: 6, day: "Sunday" },
  ];
  return offsets.map(({ offset, day }) => {
    const d = new Date(monday.getTime());
    d.setUTCDate(d.getUTCDate() + offset);
    const dateStr = d.toISOString().split("T")[0];
    return { date: dateStr, dayOfWeek: day };
  });
}
