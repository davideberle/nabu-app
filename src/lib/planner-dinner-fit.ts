/**
 * Is a recipe a household dinner, and does it belong to this season?
 *
 * Legacy cookbook labels call many things a "main" that are not a dinner: a
 * preserve ("Tuna in Oil", a 1 kg confit), a sandwich from a "Cooking for
 * One" chapter, a pantry sauce. These checks read the recipe's own name,
 * chapter and season tags. They only ever *exclude* or down-rank; they never
 * promote a recipe or change its stored category.
 */

type FitRecipe = {
  name?: string | null;
  source?: { chapter?: string | null } | null;
  category?: { chapter?: string | null } | null;
  tags?: { season?: string[] | null } | null;
};

/** Dish names that end in a preserve, condiment or pantry component. */
const NOT_DINNER_NAME_END =
  /\b(in (olive )?oil|confit|pickles?|pickled \w+|jam|jelly|chutney|relish|pesto|dressing|vinaigrette|stock|broth|spice (mix|blend)|seasoning|paste|syrup|cordial)\s*$/i;
/** Lunch-for-one formats that are not a family dinner. */
const NOT_DINNER_NAME_ANY = /\b(sando|sandwich(es)?|toastie|lunchbox|lunch box)\b/i;
/** Chapters whose recipes are components, preserves or solo/lunch dishes. */
const NOT_DINNER_CHAPTER =
  /\b(cooking for one|for one|preserv\w*|pantry|condiments?|sauces?( and|&| &)? ?(dressings?)?|dressings?|basics|stocks?|pickl\w*|drinks?|breakfast|snacks?|desserts?|baking|sweets?)\b/i;

export function notDinnerReason(recipe: FitRecipe): string | null {
  const name = String(recipe.name ?? "").trim();
  if (NOT_DINNER_NAME_END.test(name)) return "a preserve or condiment";
  if (NOT_DINNER_NAME_ANY.test(name)) return "a sandwich or lunch dish";
  const chapter = String(recipe.source?.chapter ?? recipe.category?.chapter ?? "").trim();
  if (chapter && NOT_DINNER_CHAPTER.test(chapter)) return `from the "${chapter}" chapter`;
  return null;
}

type Season = "spring" | "summer" | "fall" | "winter";

function seasonOfMonth(month: number): Season {
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "fall";
  return "winter";
}

const SEASON_WORDS: Record<string, Season> = {
  spring: "spring", frühling: "spring", fruehling: "spring",
  summer: "summer", sommer: "summer",
  autumn: "fall", fall: "fall", herbst: "fall",
  winter: "winter",
};

/**
 * True only when the recipe explicitly declares seasons (chapter or tags)
 * and none of them fits the planned month. "All seasons" or no declaration
 * is never off-season.
 */
export function isOffSeason(recipe: FitRecipe, month: number): boolean {
  const declared = new Set<Season>();
  const tags = (recipe.tags?.season ?? []).map((s) => String(s).toLowerCase().trim());
  if (tags.some((s) => s === "all" || s === "any" || s === "year-round")) return false;
  for (const tag of tags) if (SEASON_WORDS[tag]) declared.add(SEASON_WORDS[tag]);
  const chapter = String(recipe.source?.chapter ?? recipe.category?.chapter ?? "").toLowerCase().trim();
  if (SEASON_WORDS[chapter]) declared.add(SEASON_WORDS[chapter]);
  if (declared.size === 0) return false;
  return !declared.has(seasonOfMonth(month));
}
