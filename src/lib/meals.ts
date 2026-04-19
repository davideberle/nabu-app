import { type Recipe, getCuisine, getDietary, isLowCalorie } from "./recipes";

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

/** Adjacent seasons that are "close enough" to not penalise. */
const ADJACENT_SEASONS: Record<Season, Season[]> = {
  spring: ["winter", "summer"],
  summer: ["spring", "fall"],
  fall: ["summer", "winter"],
  winter: ["fall", "spring"],
};

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

const SEASON_NAMES: Season[] = ["spring", "summer", "fall", "winter"];

/**
 * Returns the primary season a recipe belongs to, or null if season-neutral.
 * Priority: explicit tags.season > name keywords > chapter name > intro text.
 */
function recipeSeason(recipe: Recipe): Season | null {
  // 1. Explicit season tags (strongest signal)
  const seasonTags = recipe.tags?.season ?? [];
  for (const tag of seasonTags) {
    const lower = tag.toLowerCase() as Season;
    if (SEASON_NAMES.includes(lower)) return lower;
  }

  // 2. Name keywords
  const name = recipe.name;
  for (const [season, re] of Object.entries(SEASON_SIGNALS) as [Season, RegExp][]) {
    if (re.test(name)) return season;
  }

  // 3. Chapter name (exact match only, e.g. "Fall", "Spring")
  const chapter = (recipe.source?.chapter || recipe.category?.chapter || "").toLowerCase().trim();
  if (chapter && SEASON_NAMES.includes(chapter as Season)) return chapter as Season;

  // 4. Intro text patterns
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

export type CandidateItem = {
  recipeId: string;
  recipeName: string;
  source?: { cookbook: string; author: string; chapter?: string } | null;
  image?: string | null;
  dietary: string[];
  cuisine: string;
  time: { prep: number; cook: number; total: number } | null;
  category: string;
  lowCalorie?: boolean;
  bucket: CandidateBucket;
};

export type CandidateBucket = "salad" | "soup" | "vegetarian" | "fish" | "meat";

export type CandidateSet = {
  generatedAt: string;
  policyVersion: string;
  bucketContract: readonly [number, number, number, number, number]; // salad, soup, veg, fish, meat
  items: CandidateItem[];
};

export type DayPlanningState = "open" | "assigned" | "meal" | "skipped";

export type MealPlan = {
  week: string; // "2026-W15"
  status?: "draft" | "finalized";
  plannerVersion?: string;
  candidateSet?: CandidateSet | null;
  days: {
    date: string; // "2026-04-07"
    dayOfWeek: string; // "Monday"
    type: "weekday" | "weekend";
    planningState?: DayPlanningState;
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
  rationale?: string;
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

function isLight(recipe: Recipe): boolean {
  if (isLowCalorie(recipe)) return true;
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
  const breakfastWords = [
    "pancake", "waffle", "johnnycake", "french toast", "granola",
    "porridge", "oatmeal", "breakfast", "brunch", "morning",
    "cereal", "muesli", "smoothie", "juice", "milkshake",
    "scramble", "scrambled egg",
  ];
  if (breakfastWords.some((w) => nameLower.includes(w))) return false;

  // Snack/lunch/non-dinner items
  const snackWords = [
    "snack", "bar ", "energy ball", "trail mix", "dip", "hummus",
    "guacamole", "salsa", "cracker", "chip", "popcorn", "nut butter",
    "lunch box", "lunchbox", "sandwich", "wrap",
  ];
  if (snackWords.some((w) => nameLower.includes(w))) return false;

  const dessertWords = ["cake", "brownie", "cookie", "muffin", "cupcake", "fudge", "ice cream", "sorbet", "pudding", "truffle", "macaron"];
  if (dessertWords.some((w) => nameLower.includes(w))) return false;

  // Exclude sauces/dressings masquerading as recipes
  const sauceWords = ["dressing", "vinaigrette", "aioli", "mayonnaise", "ketchup"];
  if (sauceWords.some((w) => nameLower.includes(w))) return false;

  // Exclude meal_role mismatches
  const role = (recipe.mealRole || recipe.category?.meal_role || "").toLowerCase();
  if (role === "breakfast" || role === "brunch" || role === "lunch" || role === "drink" || role === "snack") return false;

  // Must have a reasonable number of ingredients (not just a sauce/dip)
  if (recipe.ingredients.length < 3) return false;

  // Must have method steps
  if (!recipe.method || recipe.method.length < 2) return false;

  return true;
}

/**
 * Stricter filter for weekend mains: must be dinner-worthy AND substantial
 * enough for a weekend dinner. Excludes salad-only, soup-only (unless also
 * tagged "main"), and recipes whose intro signals breakfast/snack.
 */
function isWeekendMainWorthy(recipe: Recipe): boolean {
  if (!isDinnerWorthy(recipe)) return false;

  const dishTypes = (recipe.category?.dish_type ?? []).map((t) => t.toLowerCase());

  // Must have "main" in dish_type — salad-only or soup-only are too light
  if (!dishTypes.includes("main")) return false;

  // Exclude recipes whose intro clearly marks them as breakfast/snack
  const intro = (recipe.introduction || recipe.intro || "").toLowerCase();
  if (/\b(breakfast|brunch|snack)\b/.test(intro)) return false;

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

// ----- adaptive side-count heuristic -----

/** Dominant starch/base family in a side dish, used to prevent duplicate pairings. */
function dominantBase(recipe: Recipe): string | null {
  const text = (recipe.name + " " + recipe.ingredients.map((i) => i.item).join(" ")).toLowerCase();
  const bases: [string, RegExp][] = [
    ["potato", /\b(potato|roast potato|mash|fries|chips|rösti|hasselback)\b/],
    ["rice", /\b(rice|pilaf|pilau|biryani|risotto)\b/],
    ["bread", /\b(bread|flatbread|naan|pita|focaccia|ciabatta|rolls)\b/],
    ["pasta", /\b(pasta|noodle|spaghetti|penne|orzo|couscous)\b/],
    ["grain", /\b(quinoa|bulgur|freekeh|farro|polenta|grits|barley)\b/],
    ["lentil", /\b(lentil|dal|dhal)\b/],
    ["bean", /\b(bean|chickpea|cannellini|black bean|kidney bean)\b/],
  ];
  for (const [family, re] of bases) {
    if (re.test(text)) return family;
  }
  return null;
}

/**
 * Returns a sensible side-count range based on meal type and cuisine.
 * Pasta/noodle dishes need 0-1 sides; standard mains 1-2; feast/mezze styles can have more.
 */
function getSideCountRange(main: Recipe): { min: number; max: number; rationale: string } {
  const nameLower = main.name.toLowerCase();
  const cuisine = getCuisine(main);

  // Pasta & noodle dishes are complete — 0-1 sides (maybe a salad)
  if (isPasta(main) || nameLower.includes("noodle") || nameLower.includes("ramen") || nameLower.includes("pho") || nameLower.includes("laksa")) {
    return { min: 0, max: 1, rationale: "Complete dish — a simple salad at most." };
  }

  // Curries/stews served with rice/bread are fairly complete
  if (nameLower.includes("curry") || nameLower.includes("stew") || nameLower.includes("tagine") || nameLower.includes("dal") || nameLower.includes("chili")) {
    return { min: 0, max: 1, rationale: "Served with rice or bread — needs little else." };
  }

  // Bowls, biryanis, risottos are self-contained
  if (nameLower.includes("bowl") || nameLower.includes("biryani") || nameLower.includes("risotto") || nameLower.includes("fried rice")) {
    return { min: 0, max: 1, rationale: "A complete one-dish meal." };
  }

  // Mezze/Middle Eastern/feast-style meals benefit from more sides
  const feastCuisines = ["Middle Eastern", "Lebanese", "Turkish", "Greek", "Indian", "Ethiopian"];
  if (feastCuisines.includes(cuisine)) {
    return { min: 1, max: 3, rationale: "Feast-style spread with complementary sides." };
  }

  // Standard mains: 1-2 sides
  return { min: 1, max: 2, rationale: "Classic main with a side or two." };
}

/** Build a one-sentence rationale explaining the weekend side selection. */
function buildRationale(main: Recipe, sides: Recipe[], baseRationale: string): string {
  if (sides.length === 0) return baseRationale;
  const sideNames = sides.map((s) => s.name).join(" and ");
  return `${baseRationale.replace(/\.$/, "")} — paired with ${sideNames}.`;
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

  // Weekend-worthy subset: stricter than general dinner pool
  const weekendPool = pool.filter(isWeekendMainWorthy);
  const weekendVegRecipes = weekendPool.filter(isVegetarianOrVegan);
  const weekendNonVegRecipes = weekendPool.filter((r) => !isVegetarianOrVegan(r));
  const weekendPastaRecipes = weekendPool.filter(isPasta);


  // Reduce target counts when days are skipped
  const skip = hints?.skipCount ?? 0;
  const weekdayTarget = Math.max(2, 6 - skip);
  const weekendTarget = Math.max(1, 4 - Math.max(0, skip - 2));

  // We want 3-4 vegetarian/vegan out of 10 total
  const vegCount = 3 + Math.round(Math.random()); // 3 or 4

  // Weekend picks. Include at least 1 pasta for Sunday suggestion.
  const weekendPasta = shuffle(weekendPastaRecipes).slice(0, 1);
  const weekendPastaIsVeg = weekendPasta.length > 0 && isVegetarianOrVegan(weekendPasta[0]);

  const weekendVegTarget = Math.min(2, vegCount);
  const weekendVegNeeded = weekendVegTarget - (weekendPastaIsVeg ? 1 : 0);

  const usedIds = new Set(weekendPasta.map((r) => r.id));
  const weekendVegPicks = pickWithoutCuisineRepeat(
    shuffle(weekendVegRecipes).filter((r) => !usedIds.has(r.id)),
    Math.max(0, weekendVegNeeded),
    weekendPasta
  );
  weekendVegPicks.forEach((r) => usedIds.add(r.id));

  const weekendNonVegNeeded = weekendTarget - weekendPasta.length - weekendVegPicks.length;
  const weekendNonVegPicks = pickWithoutCuisineRepeat(
    shuffle(weekendNonVegRecipes).filter((r) => !usedIds.has(r.id)),
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
  // Filter sides: drop opposite-season sides and prevent protein clashes.
  const allSideRecipes = filterBySeason(allRecipes.filter(isSideDish));
  const weekendMeals: WeekendMealOption[] = weekend.map((main) => {
    const mainCuisine = getCuisine(main);

    // Adaptive side count based on meal type/cuisine
    const { min: minSides, max: maxSides, rationale } = getSideCountRange(main);

    if (maxSides === 0) {
      return { main, sides: [], rationale };
    }

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
    const usedBases = new Set<string>();

    // Pre-seed with the main's dominant base so we never pair e.g. potato curry + roast potatoes
    const mainBase = dominantBase(main);
    if (mainBase) usedBases.add(mainBase);

    function canAddSide(s: Recipe): boolean {
      const base = dominantBase(s);
      if (base && usedBases.has(base)) return false;
      return true;
    }

    function addSide(s: Recipe) {
      sides.push(s);
      const base = dominantBase(s);
      if (base) usedBases.add(base);
    }

    // Prefer same-cuisine sides, then fill with others
    for (const s of sameCuisineSides) {
      if (sides.length >= maxSides) break;
      if (canAddSide(s)) addSide(s);
    }
    for (const s of otherSides) {
      if (sides.length >= maxSides) break;
      if (canAddSide(s)) addSide(s);
    }
    // Relax base constraint if we haven't hit minimum
    if (sides.length < minSides) {
      for (const s of [...sameCuisineSides, ...otherSides]) {
        if (sides.length >= minSides) break;
        if (!sides.some((x) => x.id === s.id)) sides.push(s);
      }
    }

    return { main, sides, rationale: buildRationale(main, sides, rationale) };
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

// ----- bucket classification for planner candidates -----

const FISH_PATTERNS = /\b(salmon|tuna|trout|cod|halibut|catfish|sea bass|snapper|mackerel|sardine|anchov|swordfish|fish|shrimp|prawn|scallop|crab|lobster|mussel|clam|oyster|squid|calamari|octopus|seafood)\b/i;

function classifyBucket(recipe: Recipe): CandidateBucket | null {
  const dishTypes = (recipe.category?.dish_type ?? []).map((t) => t.toLowerCase());
  const nameLower = recipe.name.toLowerCase();
  const ingredientText = recipe.ingredients.map((i) => i.item).join(" ");

  // Salad bucket: dish_type includes "salad" or name contains "salad"
  if (dishTypes.includes("salad") || nameLower.includes("salad")) return "salad";

  // Soup bucket: dish_type includes "soup" or name signals soup/stew
  if (dishTypes.includes("soup") || nameLower.includes("soup") || nameLower.includes("stew") || nameLower.includes("chowder") || nameLower.includes("broth")) return "soup";

  // Vegetarian/vegan
  if (isVegetarianOrVegan(recipe)) return "vegetarian";

  // Fish/seafood
  if (FISH_PATTERNS.test(nameLower) || FISH_PATTERNS.test(ingredientText)) return "fish";

  // Remaining non-vegetarian = meat
  return "meat";
}

/**
 * Visible weekly contract for Phase 2:
 *   3 salads, 3 soups, 2 vegetarian mains, 2 fish mains, 2 meat mains = 12 total.
 * Ordered by bucket in the above sequence.
 */
export const CANDIDATE_BUCKET_CONTRACT = [3, 3, 2, 2, 2] as const;
export const CANDIDATE_BUCKET_ORDER: CandidateBucket[] = ["salad", "soup", "vegetarian", "fish", "meat"];

export function selectCandidateMains(
  allRecipes: Recipe[],
  excludeIds?: Set<string>,
  _hints?: GenerationHints
): Recipe[] {
  // Filter to dinner-worthy, exclude recently used, drop opposite season
  let pool = allRecipes.filter(isDinnerWorthy);
  if (excludeIds && excludeIds.size > 0) {
    pool = pool.filter((r) => !excludeIds.has(r.id));
  }
  pool = filterBySeason(pool);

  // Prefer recipes with images
  const withImages = pool.filter((r) => !!r.image);
  if (withImages.length >= 40) pool = withImages;

  // Partition by bucket
  const buckets: Record<CandidateBucket, Recipe[]> = {
    salad: [],
    soup: [],
    vegetarian: [],
    fish: [],
    meat: [],
  };
  for (const r of pool) {
    const b = classifyBucket(r);
    if (b) buckets[b].push(r);
  }

  // Pick from each bucket with cuisine diversity
  const result: Recipe[] = [];
  for (let i = 0; i < CANDIDATE_BUCKET_ORDER.length; i++) {
    const bucket = CANDIDATE_BUCKET_ORDER[i];
    const needed = CANDIDATE_BUCKET_CONTRACT[i];
    const picks = pickWithoutCuisineRepeat(
      shuffle(buckets[bucket]),
      needed,
      result
    );
    result.push(...picks);
  }

  return result;
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
    { offset: 4, day: "Friday" },
    { offset: 5, day: "Saturday" },
    { offset: 6, day: "Sunday" },
  ];
  return offsets.map(({ offset, day }) => {
    const d = new Date(monday.getTime());
    d.setUTCDate(d.getUTCDate() + offset);
    const dateStr = d.toISOString().split("T")[0];
    return { date: dateStr, dayOfWeek: day };
  });
}
