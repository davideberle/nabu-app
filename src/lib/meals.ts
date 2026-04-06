import fs from "fs";
import path from "path";
import { type Recipe, getCuisine, getDietary } from "./recipes";

const MEAL_PLANS_DIR =
  "/Users/claweberle/.openclaw/workspace/projects/kitchen/meal-plans";

export type MealPlan = {
  week: string; // "2026-W15"
  days: {
    date: string; // "2026-04-07"
    dayOfWeek: string; // "Monday"
    recipeId: string | null;
    recipeName: string | null;
  }[];
  locked: boolean;
  createdAt: string;
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
  if (recipe.time && recipe.time.total > 0 && recipe.time.total < 45)
    return true;
  return false;
}

function pickWithoutCuisineRepeat(
  pool: Recipe[],
  count: number,
  alreadyPicked: Recipe[]
): Recipe[] {
  const picked: Recipe[] = [];
  const usedCuisines = new Set(alreadyPicked.map((r) => getCuisine(r)));
  const remaining = shuffle(pool);

  for (const r of remaining) {
    if (picked.length >= count) break;
    const cuisine = getCuisine(r);
    // Allow if cuisine wasn't used by the immediately previous pick
    const lastCuisine =
      picked.length > 0 ? getCuisine(picked[picked.length - 1]) : null;
    if (cuisine === lastCuisine) continue;
    // Also try for overall variety
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

export function selectMealOptions(allRecipes: Recipe[]): {
  weekday: Recipe[];
  weekend: Recipe[];
} {
  // Partition recipes
  const vegRecipes = allRecipes.filter(isVegetarianOrVegan);
  const nonVegRecipes = allRecipes.filter((r) => !isVegetarianOrVegan(r));
  const lightRecipes = allRecipes.filter(isLight);
  const pastaRecipes = allRecipes.filter(isPasta);

  // We want 3-4 vegetarian/vegan out of 10 total
  const vegCount = 3 + Math.round(Math.random()); // 3 or 4

  // Weekend: 4 picks. Include at least 1 pasta for Sunday suggestion.
  // Pick 1 pasta (veg or not), then fill remainder ensuring vegCount balance.
  const weekendPasta = shuffle(pastaRecipes).slice(0, 1);
  const weekendPastaIsVeg = weekendPasta.length > 0 && isVegetarianOrVegan(weekendPasta[0]);

  // Determine how many veg we need for weekend (aim for ~1-2)
  const weekendVegTarget = Math.min(2, vegCount);
  const weekendVegNeeded = weekendVegTarget - (weekendPastaIsVeg ? 1 : 0);

  const usedIds = new Set(weekendPasta.map((r) => r.id));
  const weekendVegPicks = pickWithoutCuisineRepeat(
    shuffle(vegRecipes).filter((r) => !usedIds.has(r.id)),
    Math.max(0, weekendVegNeeded),
    weekendPasta
  );
  weekendVegPicks.forEach((r) => usedIds.add(r.id));

  const weekendNonVegNeeded = 4 - weekendPasta.length - weekendVegPicks.length;
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

  // Weekday: 6 picks. Mon/Tue should lean light. Mix veg and non-veg.
  const weekdayVegTarget = vegCount - weekendVegPicks.length - (weekendPastaIsVeg ? 1 : 0);

  // Pick some light options first (for Mon/Tue)
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

  const moreNonVegNeeded = 6 - lightPicks.length - moreVeg.length;
  const moreNonVeg = pickWithoutCuisineRepeat(
    shuffle(nonVegRecipes).filter((r) => !usedIds.has(r.id)),
    moreNonVegNeeded,
    [...lightPicks, ...moreVeg]
  );

  const weekday = shuffle([...lightPicks, ...moreVeg, ...moreNonVeg]);

  return { weekday, weekend };
}

// ----- save / load -----

export function saveMealPlan(plan: MealPlan): void {
  if (!fs.existsSync(MEAL_PLANS_DIR)) {
    fs.mkdirSync(MEAL_PLANS_DIR, { recursive: true });
  }
  const filePath = path.join(MEAL_PLANS_DIR, `${plan.week}.json`);
  fs.writeFileSync(filePath, JSON.stringify(plan, null, 2));
}

export function loadMealPlan(weekId: string): MealPlan | null {
  const filePath = path.join(MEAL_PLANS_DIR, `${weekId}.json`);
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content) as MealPlan;
  } catch {
    return null;
  }
}

// ----- week date helpers -----

/**
 * Get ISO week number and year for a given date.
 */
export function getISOWeek(date: Date): { year: number; week: number } {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
  const dayNum = d.getUTCDay() || 7; // Monday=1 ... Sunday=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // Thursday of this week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );
  return { year: d.getUTCFullYear(), week };
}

/**
 * Get the Monday date of a given ISO week.
 */
export function getWeekMonday(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const mondayOfW1 = new Date(jan4.getTime());
  mondayOfW1.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1);
  const target = new Date(mondayOfW1.getTime());
  target.setUTCDate(mondayOfW1.getUTCDate() + (week - 1) * 7);
  return target;
}

/**
 * Get the dates for the 5 meal plan slots (Mon, Tue, Wed, Thu, Sun) for a given ISO week.
 */
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
