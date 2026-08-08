/**
 * Meal-planner core: planner-main eligibility, bucket classification, week-id
 * math, planner-facing metadata normalization, candidate-set save sanitation,
 * and the recency/feedback policy windows.
 *
 * Kept free of runtime imports on purpose (the type-only Recipe import is
 * erased): `meals.ts` re-exports everything here so app code keeps importing
 * `@/lib/meals`, while `scripts/verify-meals.mjs`, `scripts/repair-meal-plans.mjs`,
 * and `node --test` load this file directly — Node 24 strips types natively but
 * cannot resolve the `@/` alias or bundle-only imports.
 *
 * These are the authoritative production rules (Kitchen DESIGN.md §4.3 and
 * Phase 3B). Verification must import these exact functions rather than
 * maintaining a divergent copy.
 */

import type { Recipe } from "./recipes.ts";

// ---------------------------------------------------------------------------
// Recipe metadata helpers (moved here from recipes.ts so the gate/classifier
// stay dependency-free; recipes.ts re-exports them unchanged)
// ---------------------------------------------------------------------------

// Cookbook to cuisine mapping
export const COOKBOOK_CUISINES: Record<string, string> = {
  "Ottolenghi: The Cookbook": "Middle Eastern",
  Jerusalem: "Middle Eastern",
  Falastin: "Middle Eastern",
  Persiana: "Middle Eastern",
  "Souk to Table": "Middle Eastern",
  Plenty: "Middle Eastern",
  "Plenty More": "Middle Eastern",
  "Ottolenghi Simple": "Middle Eastern",
  "The Curry Guy": "Indian",
  "The Curry Guy Bible": "Indian",
  "The Indian Vegan": "Indian",
  "Vietnamese Food Any Day": "Vietnamese",
  "Vegan Vietnamese": "Vietnamese",
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
  "The Complete and Authentic Thai Curry Cookbook 2": "Thai",
  "Real Thai Cooking": "Thai",
  "Thai Spice Recipes": "Thai",
  "Vegan Nigerian Kitchen": "Nigerian",
  "Tagine Cookbook": "Moroccan",
};

// Get cuisine for a recipe (sync — pure function)
export function getCuisine(recipe: Recipe): string {
  const cookbook = recipe.source?.cookbook;
  if (cookbook && COOKBOOK_CUISINES[cookbook]) {
    return COOKBOOK_CUISINES[cookbook];
  }
  return "Other";
}

// Get dietary tags for a recipe (sync — pure function)
export function getDietary(recipe: Recipe): string[] {
  return recipe.dietary || recipe.tags?.dietary || [];
}

export function isVegetarianOrVegan(recipe: Recipe): boolean {
  const tags = getDietary(recipe);
  return tags.some(
    (t) =>
      t.toLowerCase() === "vegan" || t.toLowerCase() === "vegetarian"
  );
}

// ---------------------------------------------------------------------------
// Planner-main eligibility gate (authoritative)
// ---------------------------------------------------------------------------

const EXCLUDED_DISH_TYPES = new Set([
  "dessert", "baking", "breakfast", "brunch", "lunch", "snack", "drink",
  "beverage", "condiment", "base", "bread", "component", "garnish", "sauce",
  "dressing", "pickle", "preserve", "chutney", "raita", "salsa", "dip",
]);

/** Chapter names that should never appear in dinner options */
const EXCLUDED_CHAPTER_PATTERNS = [
  "dessert", "sweet", "baking", "patisserie", "pastry",
  "bread", "breakfast", "brunch", "drink", "beverage",
  "smoothie", "mylkshake", "coffee", "basic recipe",
  "basic sauce", "base sauce", "kitchen basic", "know-how",
  "condiment", "pickle", "preserve", "chutney", "raita", "salsa",
  "dip", "dressing", "sauce", "spice blend",
  "desayuno",
];

const NON_MAIN_NAME_PATTERNS = /\b(sauce|dressing|vinaigrette|pickle|pickled|chutney|raita|salsa|dip|relish|jam|marmalade|aioli|mayonnaise|ketchup|paste|rub|spice blend|masala powder|dough)\b/i;
const BREAKFAST_SNACK_PATTERNS = /\b(pancakes?|waffles?|johnnycakes?|french toast|granola|porridge|oatmeal|breakfast|brunch|morning|cereal|muesli|smoothie|juice|milkshake|snack|energy balls?|trail mix|lunch box|lunchbox)\b/i;
const DESSERT_PATTERNS = /\b(cake|brownies?|cookies?|biscuits?|muffins?|cupcakes?|fudge|ice cream|sorbet|pudding|truffles?|macarons?|shrikhand|dessert|pie|tart|crumble|sweet roll)\b/i;

/**
 * Additional unambiguous dessert/pastry identity words, checked against NAMES
 * only. A dish *named* "tiramisu"/"granita"/"croissant" is one; intro prose
 * mentioning these words stays governed by DESSERT_PATTERNS alone so casual
 * mentions ("serve with scones") cannot create new intro-based exclusions.
 * Deliberately absent: words with real savory mains in the corpus —
 * "cheesecake" (Ottolenghi's eggplant cheesecake), "custard" (fresh clam
 * custard), plural "pies"/"tarts" (root vegetable pies, ricotta tarts).
 */
const DESSERT_NAME_PATTERNS = /\b(tiramis[uù]|granitas?|gelato|semifreddo|panna cottas?|baklava|strudels?|kisses|meringues?|pavlovas?|trifles?|cannoli|churros?|biscotti|shortbread|blondies?|doughnuts?|donuts?|croissants?|scones?|bostock|cinnamon rolls?)\b/i;

/** Bread-object identity names that are never a dinner main. */
const BREAD_NAME_PATTERNS = /\b(dinner rolls?|bread rolls?|burger buns?|hot ?dog buns?)\b/i;

/**
 * Title-only savory identity: a protein or savory dish word in the NAME that
 * is incompatible with the dish being a dessert, so intro dessert vocabulary
 * ("tart poached rhubarb", "steamed pork cake") cannot overrule it.
 * Deliberately narrower than the main-signal lexicon: words that appear in
 * dessert titles (bean → vanilla bean, roast/grilled → grilled peaches, bowl,
 * sandwich → ice cream sandwich, rice → rice pudding) are excluded. This only
 * neutralizes dessert prose — breakfast/snack prose keeps its authority, so
 * "eaten as a late-night snack" framing still excludes a protein-titled dish.
 */
const TITLE_SAVORY_IDENTITY = /\b(curry|stew|tagine|ragu|chill?i|ramen|pho|laksa|biryani|pilaf|paella|risotto|pasta|spaghetti|pappardelle|tagliatelle|fettuccine|linguine|macaroni|noodles?|soba|udon|gnocchi|moussaka|lasagn[ae]|quiche|frittata|enchiladas?|quesadillas?|tacos?|fajitas?|burgers?|schnitzels?|kebabs?|koftas?|gyros|shawarma|falafel|dumplings?|chicken|beef|steaks?|pork|lamb|mutton|veal|venison|rabbit|duck|turkey|quails?|sausages?|chorizo|bacon|ham|meatballs?|meatloaf|fish|salmon|tuna|cod|halibut|trout|mackerel|sardines?|anchov\w*|sea ?bass|prawns?|shrimp|crab|lobster|squid|octopus|calamari|mussels?|clams?|scallops?|oysters?|eels?|tofu|tempeh|seitan|paneer|halloumi|lentils?|chickpeas?|dhal|dal)\b/i;

/**
 * Structural batch-yield evidence that a record is a bakery/confection batch
 * or a bulk component, not a plated dinner: "makes about 45 biscuits",
 * "makes 2 small loaves", "makes 1 dozen", "16 bars", "ABOUT 4 CUPS",
 * "makes 160g (…)". Centralized from the supplementary QA heuristics in
 * scripts/verify-quality-gate.mjs (Phase 3B). Plain portion counts carry no
 * signal — mezze/patty mains legitimately say "makes 12" or "makes 16
 * empanadas", and "serves 6 (makes about 24 large ravioli)" stays a main.
 */
const BAKERY_YIELD_PATTERNS = /\b(?:makes?|yields?)\s+(?:about\s+|around\s+|approximately\s+|roughly\s+)?(?:a\s+|one\s+|two\s+|\d)[^,;.]{0,40}?\b(?:dozen|biscuits?|cookies?|kisses|meringues?|macaroons?|macarons?|muffins?|cupcakes?|scones?|brownies?|blondies?|bars?|balls?|bites?|truffles?|pastries|tartlets?|doughnuts?|donuts?|croissants?|loa(?:f|ves)|crackers?|candies)\b/i;
const VOLUME_SERVINGS_PATTERNS = /^\s*(?:makes?\s+|yields?\s+)?(?:about\s+|around\s+|approximately\s+|roughly\s+)?[\d½⅓⅔¼¾⅛⅜⅝⅞.,\s–—-]*[\d½⅓⅔¼¾⅛⅜⅝⅞][\d½⅓⅔¼¾⅛⅜⅝⅞.,\s–—-]*\s*(?:cups?|tbsp|tablespoons?|tsp|teaspoons?|ml|litres?|liters?|g|grams?|kg|kilograms?|jars?)\b/i;
const BARE_CONFECTION_COUNT_PATTERNS = /^\s*(?:about\s+)?\d+\s*(?:small\s+|large\s+|mini\s+)?(?:balls?|bars?|bites?|cookies?|truffles?|muffins?|cupcakes?|brownies?|blondies?|macaroons?|meringues?)\b/i;

/**
 * True when servings or a leaked leading ingredient line carries batch-yield
 * evidence. Corrupt imports drop the yield line into ingredients[0]
 * ("Makes about 45 biscuits" on Mother's Kisses, "Makes around 100 g" on
 * Maria's Ricotta); only leading lines that literally start with
 * makes/yields count, and only with a bakery or volume/weight unit —
 * "Makes 4 pizzas" stays a main.
 */
function hasBatchYieldSignal(recipe: Recipe): boolean {
  const servings = recipe.servings || "";
  if (
    VOLUME_SERVINGS_PATTERNS.test(servings) ||
    BAKERY_YIELD_PATTERNS.test(servings) ||
    BARE_CONFECTION_COUNT_PATTERNS.test(servings)
  ) {
    return true;
  }
  for (const ing of (recipe.ingredients ?? []).slice(0, 2)) {
    const item = typeof ing?.item === "string" ? ing.item.trim() : "";
    if (!/^(makes?|yields?)\b/i.test(item)) continue;
    if (
      BAKERY_YIELD_PATTERNS.test(item) ||
      /\b\d+\s*(?:g|grams?|kg|kilograms?|cups?|tbsp|tablespoons?|ml)\b/i.test(item)
    ) {
      return true;
    }
  }
  return false;
}

function recipeCategoryValues(recipe: Recipe): string[] {
  const values: string[] = [];
  const category = recipe.category as unknown;
  if (category && typeof category === "object") {
    const record = category as { dish_type?: unknown; meal_role?: unknown; chapter?: unknown };
    if (Array.isArray(record.dish_type)) {
      values.push(...record.dish_type.filter((v): v is string => typeof v === "string"));
    }
    if (typeof record.meal_role === "string") values.push(record.meal_role);
    if (typeof record.chapter === "string") values.push(record.chapter);
  } else if (typeof category === "string") {
    values.push(category);
  }
  if (recipe.mealRole) values.push(recipe.mealRole);
  return values.map((value) => value.toLowerCase().trim()).filter(Boolean);
}

/**
 * Explicit structured main declaration: dish_type / meal_role / chapter say
 * main/dinner. This is recipe data, not a heuristic — where it is present it
 * outranks name/intro keyword sniffing in the gate below.
 */
export function hasExplicitMainCategory(recipe: Recipe): boolean {
  const values = recipeCategoryValues(recipe);
  return values.some((value) => ["main", "dinner", "supper", "entree", "entrée"].includes(value));
}

export function hasClearMainSignal(recipe: Recipe): boolean {
  if (hasExplicitMainCategory(recipe)) return true;

  return hasSubstantialMainNameSignal(recipe);
}

export function hasSubstantialMainNameSignal(recipe: Recipe): boolean {
  const text = `${recipe.name} ${(recipe.introduction || recipe.intro || "")}`.toLowerCase();
  return /\b(curry|stew|tagine|rag[uù]|chili|soup|ramen|pho|laksa|pasta|spaghetti|noodle|risotto|biryani|pilaf|taco|enchilada|quesadilla|burger|sandwich|wrap|bowl|roast|grill|grilled|braised|chicken|beef|pork|lamb|fish|salmon|shrimp|tofu|tempeh|lentil|bean)\b/.test(text);
}

/**
 * Returns true if a recipe is suitable as a dinner main dish.
 */
export function isDinnerWorthy(recipe: Recipe): boolean {
  const dishTypes = recipe.category?.dish_type ?? [];
  const lowTypes = dishTypes.map((t) => t.toLowerCase());
  const role = (recipe.mealRole || recipe.category?.meal_role || "").toLowerCase();
  const categoryValues = recipeCategoryValues(recipe);

  // Exclude non-dinner dish types
  if (lowTypes.some((t) => EXCLUDED_DISH_TYPES.has(t))) return false;
  if (categoryValues.some((t) => EXCLUDED_DISH_TYPES.has(t))) return false;

  // Exclude by chapter name
  const chapter = (
    recipe.source?.chapter ||
    recipe.category?.chapter ||
    ""
  ).toLowerCase();
  if (chapter && EXCLUDED_CHAPTER_PATTERNS.some((p) => chapter.includes(p))) return false;

  // Exclude side-only dishes (unless they're also tagged as main/soup/salad)
  const hasMainRole = [...lowTypes, ...categoryValues].some(
    (t) => t === "main" || t === "dinner" || t === "supper" || t === "soup" || t === "salad"
  );
  if (lowTypes.includes("side") && !hasMainRole) return false;
  if (lowTypes.includes("vegetable") && !hasMainRole) return false;
  if (lowTypes.includes("starter") && !hasMainRole) return false;
  if (categoryValues.includes("side") && !hasMainRole) return false;
  if (categoryValues.includes("vegetable") && !hasMainRole) return false;
  if (categoryValues.includes("starter") && !hasMainRole) return false;

  // Trust boundaries for the keyword heuristics below. dish_type "main" is
  // blanket-stamped by several imports (Caramel Cream carries it) and proves
  // nothing, but three signals are deliberate:
  //  - visibility "planner-candidate" or "personal": the user saved this
  //    recipe on purpose — direct intent; intro keyword sniffing must not
  //    override it ("Chicken Tagine with Rhubarb … tart poached rhubarb").
  //    Either curated state also unlocks light-meal names below ("Spinach Feta
  //    Tortilla Wrap … weeknight dinner, sorted"), since a kept web idea keeps
  //    that intent as `personal` once rollover promotes it.
  //  - a soup/salad dish_type: a chosen course label, so prose that mentions
  //    breakfast/snack culture ("ideal after a long morning's skiing", "also
  //    eaten as a late-night snack") does not exclude the dish. Name identity
  //    still applies.
  //  - a savory protein/dish identity in the TITLE: incompatible with being a
  //    dessert, so dessert vocabulary in the intro is incidental prose ("tart
  //    poached rhubarb", Cantonese "pork cake"). Breakfast/snack prose keeps
  //    its authority — a noodle dish can genuinely be snack fare.
  const userPlannerIntent = recipe.visibility === "planner-candidate";
  const userCurated = userPlannerIntent || recipe.visibility === "personal";
  const courseTyped = lowTypes.includes("soup") || lowTypes.includes("salad");
  const nameLower = recipe.name.toLowerCase();
  const savoryTitle = TITLE_SAVORY_IDENTITY.test(nameLower);
  // Intro text is prose: it routinely mentions breakfast/snack/dessert culture
  // without defining the dish ("ideal after a long morning's skiing", "also
  // eaten as a late-night snack", annatto "common in snack foods"). It only
  // counts when no stronger signal exists. Name identity words keep applying.
  const introTrusted = !userCurated && !courseTyped;
  const introDessertTrusted = introTrusted && !savoryTitle;

  // Name-based exclusions for things that slipped through
  const introLower = (recipe.introduction || recipe.intro || "").toLowerCase();
  if (BREAKFAST_SNACK_PATTERNS.test(nameLower)) return false;
  if (introTrusted && BREAKFAST_SNACK_PATTERNS.test(introLower)) return false;

  // Snack-food identity names — never a dinner main
  const snackFoodWords = [
    "snack", "bar ", "energy ball", "trail mix", "dip", "hummus",
    "guacamole", "salsa", "cracker", "chip", "popcorn", "nut butter",
    "lunch box", "lunchbox",
  ];
  if (snackFoodWords.some((w) => nameLower.includes(w))) return false;

  // Light-meal names: dinner-capable when the user curated the recipe
  // ("Spinach Feta Tortilla Wrap … weeknight dinner, sorted"). Both curated
  // states count. `planner-candidate` is a staged web idea he is looking at
  // right now; `personal` is what a kept or assigned one becomes at promotion,
  // which is a *stronger* signal, not a weaker one — reading only the staged
  // state would have made a promoted light meal undinnerable the week after he
  // cooked it.
  const lightMealWords = ["sandwich", "wrap"];
  if (!userCurated && lightMealWords.some((w) => nameLower.includes(w))) return false;

  if (DESSERT_PATTERNS.test(nameLower)) return false;
  if (DESSERT_NAME_PATTERNS.test(nameLower)) return false;
  if (introDessertTrusted && DESSERT_PATTERNS.test(introLower)) return false;

  // Bread/bakery structure beats corrupt "main" labels: bread-object names,
  // batch/volume yields ("makes about 45 biscuits", "ABOUT 4 CUPS"), and
  // yeast-dough roll batches ("Potato Rolls", FOOBY's "Potato dinner rolls").
  // Rice-paper/cabbage/spring rolls carry no yeast, and savory title
  // identities ("The BEST Chicken Kathi rolls") stay untouched.
  if (BREAD_NAME_PATTERNS.test(nameLower)) return false;
  if (hasBatchYieldSignal(recipe)) return false;
  if (
    /\brolls?\b/.test(nameLower) &&
    !savoryTitle &&
    (recipe.ingredients ?? []).some(
      (ing) => typeof ing?.item === "string" && /\byeast\b/i.test(ing.item),
    )
  ) {
    return false;
  }

  // Exclude sauces/dressings/condiments unless the recipe is clearly a full main.
  if (NON_MAIN_NAME_PATTERNS.test(nameLower) && !hasSubstantialMainNameSignal(recipe)) return false;

  // Exclude meal_role mismatches
  if (role === "breakfast" || role === "brunch" || role === "lunch" || role === "drink" || role === "beverage" || role === "snack" || role === "dessert") return false;

  // Must have a reasonable number of ingredients (not just a sauce/dip)
  if (recipe.ingredients.length < 3) return false;

  // Must have method steps
  if (!recipe.method || recipe.method.length < 2) return false;

  return true;
}

export function isMainPlannerCandidate(recipe: Recipe): boolean {
  return isDinnerWorthy(recipe);
}

// ---------------------------------------------------------------------------
// Bucket classification for planner candidates (authoritative)
// ---------------------------------------------------------------------------

export type CandidateBucket = "salad" | "soup" | "vegetarian" | "fish" | "meat";

/**
 * Visible weekly contract for Phase 2:
 *   3 salads, 3 soups, 2 vegetarian mains, 2 fish, 2 meat = 12 total.
 * Ordered by bucket in the above sequence.
 */
export const CANDIDATE_BUCKET_CONTRACT = [3, 3, 2, 2, 2] as const;
export const CANDIDATE_BUCKET_ORDER: CandidateBucket[] = ["salad", "soup", "vegetarian", "fish", "meat"];

/**
 * Cookbooks that are vegetarian/vegan end to end. Provenance-level metadata in
 * the same spirit as COOKBOOK_CUISINES: recipes from these books can never
 * classify as fish/meat, even when analog ingredients use plain shorthand
 * ("sausage, sliced" in The Vegan Korean) or dietary tags are missing entirely
 * (Plenty / Plenty More carry no tags in the bundle).
 */
export const VEGETARIAN_COOKBOOKS = new Set([
  "Afro-Vegan",
  "Black Rican Vegan",
  "Plentiful",
  "Plenty",
  "Plenty More",
  "Tanja Vegetarisch",
  "The High-Protein Vegan Cookbook",
  "The Indian Vegan",
  "The Vegan Korean",
  "Vegan Chocolate",
  "Vegan Nigerian Kitchen",
  "Vegan Vietnamese",
]);

// Compound market names (lingcod, rockcod, blackcod) are single words the
// bare \bcod\b token cannot see; an explicit prefix list recognizes them
// without opening the door to arbitrary substring matches.
const FISH_TOKENS = /\b(salmon|tuna|trouts?|(?:ling|rock|tom|black)?cod|halibut|sea ?bass|bream|snappers?|mackerel|sardines?|anchov\w*|(?!selfish\b)\w*fish|tilapia|haddock|hake|groupers?|barramundi|branzino|turbot|plaice|dover sole|lemon sole|sole fillets?|fillets? of sole|eels?|shrimps?|prawns?|scallops?|crabs?|lobsters?|mussels?|clams?|oysters?|squid|calamari|octopus|seafood|ceviche)\b/i;
const MEAT_TOKENS = /\b(beef|steaks?|brisket|short ribs?|spare ?ribs?|ground beef|sirloin|ribeyes?|oxtails?|veal|venison|elk|schnitzels?|chicken|poultry|poussins?|spatchcocks?|pork|bacon|ham|pancetta|prosciutto|guanciale|lardons?|speck|nduja|sausages?|salchich[oó]n|chorizo|salami|pastrami|kielbasa|merguez|bratwursts?|frankfurters?|pepperoni|mortadella|keema|koftas?|k[öo]ftes?|shawarma|gyros|carnitas|bolognese|lamb|mutton|goats?|ducks?|turkey|goose|quails?|pheasants?|guinea fowl|rabbits?|hares?|boars?|bison|livers?|meatballs?|meatloaf|meat)\b/i;

/**
 * Named soup styles that carry no literal "soup"/"stew" word. Checked before
 * the protein buckets so "Asparagus vichyssoise" lands in soup. Deliberately
 * excludes noodle-soup mains (pho, ramen, laksa): those are protein-led dishes
 * and stay in their protein bucket — "Smoked Turkey Pho" is meat.
 */
const NAMED_SOUP_PATTERNS = /\b(vichyssoise|bisque|minestrone|gazpacho|consomm[eé]|potage)\b/i;

/** A recipe title that declares the dish itself vegetarian/vegan. */
const NAME_VEG_DECLARATION = /\b(vegan|vegetarian|veggie|plant[- ]based|meat[- ]?free|meatless)\b/i;

/**
 * Ingredient-item markers for plant-based analog products. An item carrying
 * one of these is never animal protein no matter which protein word it also
 * contains ("vegan fish sauce", "Lightlife Smoky Bacon Tempeh", "Beyond Meat
 * ground beef", "vegetarian oyster sauce", "chick'n").
 */
const INGREDIENT_ANALOG_MARKERS = /\b(vegan|vegetarian|veggie|plant[- ]based|meat[- ]?free|meatless|fish[- ]?free|mock|faux|imitation|meat substitute|impossible|beyond meat|lightlife|gardein|quorn|tofurky|field roast|tofu|tempeh|seitan|jackfruit|soy curls?|shroom|chi(?:ck|k)[’']?n)\b/i;

/**
 * Protein words acting as condiments, bases, or seasonings rather than the
 * dish's protein: fish/oyster sauce, shrimp paste, chicken stock/bouillon,
 * duck fat, prawn crackers, … Stripped before protein detection.
 */
const NON_PROTEIN_COMPOUNDS = /\b(fish|oyster|shrimp|prawn|anchovy|crab|clam|lobster|scallop|duck|chicken|beef|pork|veal|turkey|lamb|ham|bacon|dashi|bonito|seafood)[-\s]?(sauce|paste|stock|broth|bouillon|gravy|extract|powder|granules|seasoning|salt|essence|fat|dripping|floss|crackers?)\b/gi;

/** Goat dairy is vegetarian; strip it so \bgoat\b only fires on goat meat. */
const GOAT_DAIRY = /\bgoat[’']?s?[-\s](cheese|milk|curd|yog\w*|butter)\b/gi;

/**
 * Stock/broth phrases carry no protein signal. Strip the liquid-base phrase —
 * "broth (chicken or vegetable)", "stock from the lamb masala curry" — while
 * keeping the rest of the line: "pre-cooked lamb …, plus stock from the lamb
 * curry" must stay lamb. Protein-adjacent forms ("chicken stock") are already
 * removed by NON_PROTEIN_COMPOUNDS before this runs.
 */
const STOCK_PHRASE = /\b(stock|broth|bouillon|consomm[eé])\b(\s*\([^)]*\))?[^,;.]{0,60}/gi;

/**
 * A plant word immediately before a protein word names an analog, not the
 * animal: "mushroom scallops", "chickpea tuna", "watermelon tuna",
 * "celeriac schnitzel", "lentil bolognese". Meat-style dish words named
 * after their meat (gyros, shawarma, carnitas, kofta, keema, pastrami) take
 * the same plant prefixes: "chickpea gyros", "jackfruit gyros", "cauliflower
 * shawarma" are vegetarian while bare "gyros"/"chicken gyros" stay meat.
 */
const PLANT_PREFIXED_PROTEIN = /\b(mushroom|shroom|chickpea|jackfruit|tofu|tempeh|seitan|soy|cauliflower|carrot|watermelon|banana([- ]blossom)?|beet(root)?|celeriac|aubergine|eggplant|zucchini|courgette|walnut|lentil|bean)s?[-\s]+['‘’]?(salt(ed)? )?(fish|tuna|salmon|shrimp|prawns?|scallops?|calamari|crab|lobster|chicken|beef|steak|pork|bacon|ham|sausage|chorizo|duck|turkey|schnitzel|bolognese|gyros?|shawarma|carnitas|pastrami|koftas?|k[öo]ftes?|keema|meat(balls?)?)\b['‘’]?/gi;

/**
 * Vegan cookbooks quote their analogs — ‘scallops’, ‘chicken’, ‘salt Fish’,
 * “no chicken”. Quoted spans carry no protein signal. Straight-quote spans
 * only count when the opening quote is not a possessive apostrophe
 * ("My Mom's Tandoori Chicken" keeps its chicken).
 */
function stripQuotedSpans(text: string): string {
  return text
    .replace(/‘[^’]{1,40}’/g, " ")
    .replace(/“[^”]{1,40}”/g, " ")
    .replace(/(^|[\s(,:;/—–-])'[^']{1,40}'(?=$|[\s),.:;!?/—–-])/g, "$1 ")
    .replace(/(^|[\s(,:;/—–-])"[^"]{1,40}"(?=$|[\s),.:;!?/—–-])/g, "$1 ");
}

/** Remove every non-signal protein mention from a text span. */
function stripAnalogProteinMentions(text: string): string {
  let t = stripQuotedSpans(text.toLowerCase())
    .replace(NON_PROTEIN_COMPOUNDS, " ")
    .replace(STOCK_PHRASE, " ")
    .replace(GOAT_DAIRY, " ");
  // In a mushroom context, "oyster" / "scallop" describe the mushroom:
  // "assorted mushrooms (button, shiitake, oyster, enoki)". This must run
  // BEFORE plant-prefix stripping: "king oyster mushroom scallops" would
  // otherwise lose "mushroom scallops" to the prefix rule first, leaving a
  // phantom "oyster" behind to classify as fish.
  if (/mushroom|shroom/.test(t)) t = t.replace(/\b(oyster|scallop)s?\b/g, " ");
  return t.replace(PLANT_PREFIXED_PROTEIN, " ");
}

/** True protein content of one ingredient item, analog/condiment-aware. */
function ingredientRealProtein(itemRaw: string): { fish: boolean; meat: boolean } {
  const item = itemRaw.toLowerCase();
  if (INGREDIENT_ANALOG_MARKERS.test(item)) {
    return { fish: false, meat: false };
  }
  const t = stripAnalogProteinMentions(item);
  return { fish: FISH_TOKENS.test(t), meat: MEAT_TOKENS.test(t) };
}

/**
 * Protein identity from the recipe title. When both a fish and a meat word
 * survive analog stripping, the earlier one names the dish ("Bowl-steamed
 * chicken with salted fish" is meat, "Prawn and Chorizo Quesadilla" is fish).
 */
function nameProteinBucket(name: string): "fish" | "meat" | null {
  if (NAME_VEG_DECLARATION.test(name)) return null;
  const t = stripAnalogProteinMentions(name);
  const fish = FISH_TOKENS.exec(t);
  const meat = MEAT_TOKENS.exec(t);
  if (fish && meat) return fish.index <= meat.index ? "fish" : "meat";
  if (fish) return "fish";
  if (meat) return "meat";
  return null;
}

/**
 * Authoritative bucket classification (Kitchen DESIGN.md §4.3, Phase 3B).
 *
 * Evidence order:
 *   1. course identity — salad, then soup (dish_type or name);
 *   2. declared vegetarian identity — an all-vegetarian source cookbook or a
 *      vegan/vegetarian title is absolute;
 *   3. dietary vegan/vegetarian tags — trusted unless an ingredient line
 *      contains unmarked animal protein (bulk imports mis-tagged real sea
 *      bass/prawn dishes as vegetarian; physical ingredients win over tags);
 *   4. protein identity from the title, then from ingredient lines (meat
 *      before fish on ingredient ties, as before);
 *   5. no animal-protein evidence anywhere — vegetarian. A protein-led main
 *      names its protein; defaulting the remainder to meat invented facts
 *      (beet risotto, kohlrabi curry were "meat").
 *
 * Fish sauce / oyster sauce / shrimp paste / stock / bouillon, quoted or
 * plant-prefixed analog names ("mushroom ‘scallops’"), vegan product brands,
 * and oyster mushrooms are never protein evidence.
 */
export function classifyPlannerBucket(recipe: Recipe): CandidateBucket {
  const dishTypes = (recipe.category?.dish_type ?? []).map((t) => t.toLowerCase());
  const nameLower = recipe.name.toLowerCase();

  // Salad bucket: dish_type includes "salad" or name contains "salad"
  if (dishTypes.includes("salad") || nameLower.includes("salad")) return "salad";

  // Soup bucket: dish_type includes "soup" or name signals soup/stew
  if (dishTypes.includes("soup") || nameLower.includes("soup") || nameLower.includes("stew") || nameLower.includes("chowder") || nameLower.includes("broth") || NAMED_SOUP_PATTERNS.test(nameLower)) return "soup";

  if (VEGETARIAN_COOKBOOKS.has(recipe.source?.cookbook ?? "") || NAME_VEG_DECLARATION.test(recipe.name)) {
    return "vegetarian";
  }

  let realFish = false;
  let realMeat = false;
  for (const ing of recipe.ingredients ?? []) {
    if (typeof ing?.item !== "string" || !ing.item) continue;
    const found = ingredientRealProtein(ing.item);
    realFish ||= found.fish;
    realMeat ||= found.meat;
    if (realFish && realMeat) break;
  }

  if (isVegetarianOrVegan(recipe) && !realFish && !realMeat) return "vegetarian";

  const fromName = nameProteinBucket(recipe.name);
  if (fromName) return fromName;

  if (realMeat) return "meat";
  if (realFish) return "fish";

  return "vegetarian";
}

// ---------------------------------------------------------------------------
// Planner-facing metadata normalization
// ---------------------------------------------------------------------------

/**
 * Cuisines the planner can display with canonical casing. Values from the
 * cookbook map plus cuisines that appear on My Recipes / web imports. Matching
 * is case-insensitive; unknown values are kept verbatim after cleanup so no
 * recipe fact is invented.
 */
const CANONICAL_CUISINES = [
  ...new Set(Object.values(COOKBOOK_CUISINES)),
  "Swiss", "French", "Italian", "Spanish", "Portuguese", "German", "Austrian",
  "British", "Irish", "Scandinavian", "Hungarian", "Polish", "Mediterranean",
  "Japanese", "Chinese", "Thai", "Vietnamese", "Korean", "Indian", "Indonesian",
  "Malaysian", "Filipino", "Middle Eastern", "Lebanese", "Turkish", "Persian",
  "Israeli", "Moroccan", "Tunisian", "Ethiopian", "Nigerian", "African",
  "Caribbean", "Mexican", "Peruvian", "Brazilian", "Argentinian", "American",
  "Cajun", "Creole", "Greek", "International", "Fusion", "Other",
];

const CANONICAL_CUISINE_BY_LOWER = new Map(
  CANONICAL_CUISINES.map((cuisine) => [cuisine.toLowerCase(), cuisine]),
);

function cleanMetadataText(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Deterministically normalize a planner-facing recipe title. Whitespace runs
 * collapse, zero-width characters are dropped, and unicode is NFC-normalized.
 * No recasing or rewording — malformed input degrades to "" so callers keep
 * their existing fallbacks instead of inventing a name.
 */
export function normalizePlannerTitle(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return cleanMetadataText(raw);
}

/**
 * Deterministically normalize a planner-facing cuisine label.
 *
 * Order of truth: the recipe's own `cuisine` field (first entry when it is an
 * array, first comma segment when a scraper produced "a, b"), then the
 * cookbook→cuisine mapping, then "Other". Known cuisines get canonical casing;
 * unknown non-empty values are kept verbatim after cleanup — normalization
 * must never invent a cuisine the data does not state.
 */
export function normalizePlannerCuisine(recipe: Recipe): string {
  const raw = recipe.cuisine;
  const first = Array.isArray(raw)
    ? raw.find((entry) => typeof entry === "string" && entry.trim())
    : raw;

  if (typeof first === "string") {
    const cleaned = cleanMetadataText(first.split(",")[0] ?? "");
    if (cleaned) {
      return CANONICAL_CUISINE_BY_LOWER.get(cleaned.toLowerCase()) ?? cleaned;
    }
  }

  return getCuisine(recipe);
}

// ---------------------------------------------------------------------------
// Recency / feedback policy (Phase 3B)
// ---------------------------------------------------------------------------

export type PlannerPolicy = {
  /** Days a cooked recipe stays out of candidate sets. */
  recentlyCookedDays: number;
  /** Prior ISO weeks whose planned/offered recipes stay excluded. */
  recentWeeksLookback: number;
  /** Days a thumbs-down keeps a recipe suppressed before it may resurface. */
  negativeFeedbackDays: number;
};

export const DEFAULT_PLANNER_POLICY: PlannerPolicy = {
  recentlyCookedDays: 45,
  recentWeeksLookback: 5,
  negativeFeedbackDays: 60,
};

function positiveIntFromEnv(value: string | undefined, fallback: number): number {
  const parsed = value ? parseInt(value, 10) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Resolve the configured planner policy (env-overridable, defaults above). */
export function plannerPolicy(env: Record<string, string | undefined> = process.env): PlannerPolicy {
  return {
    recentlyCookedDays: positiveIntFromEnv(env.PLANNER_RECENTLY_COOKED_DAYS, DEFAULT_PLANNER_POLICY.recentlyCookedDays),
    recentWeeksLookback: positiveIntFromEnv(env.PLANNER_RECENT_WEEKS_LOOKBACK, DEFAULT_PLANNER_POLICY.recentWeeksLookback),
    negativeFeedbackDays: positiveIntFromEnv(env.PLANNER_NEGATIVE_FEEDBACK_DAYS, DEFAULT_PLANNER_POLICY.negativeFeedbackDays),
  };
}

// ---------------------------------------------------------------------------
// Candidate-set save sanitation (Phase 3B)
// ---------------------------------------------------------------------------

/**
 * Exclusion id-sets the canonical save boundary enforces. "Offered" means the
 * recipe sat in a persisted candidate set of a recent *prior* week — the week
 * being saved may keep re-saving its own set.
 */
export type CandidateExclusionSets = {
  recentlyCooked: ReadonlySet<string>;
  recentlyPlanned: ReadonlySet<string>;
  recentlyOffered: ReadonlySet<string>;
  negativeFeedback: ReadonlySet<string>;
};

export type CandidateRemovalReason =
  | "duplicate"
  | "recently-cooked"
  | "recently-planned"
  | "recently-offered"
  | "negative-feedback"
  | "not-main-eligible";

export type CandidateRemoval = {
  recipeId: string;
  recipeName?: string;
  reasons: CandidateRemovalReason[];
};

type SanitizableCandidateItem = {
  recipeId: string;
  recipeName?: string;
};

/**
 * Enforce recent cooked/planned/offered and negative-feedback exclusions on a
 * candidate set at the save boundary. Positive feedback is deliberately not an
 * input: it can never bypass these exclusions.
 *
 * Items assigned to a day of the plan being saved are kept — they are the
 * "visible but disabled" cards of the current week, not fresh offers.
 */
export function sanitizeCandidateItems<T extends SanitizableCandidateItem>(
  items: readonly T[],
  assignedRecipeIds: ReadonlySet<string>,
  exclusions: CandidateExclusionSets,
): { items: T[]; removed: CandidateRemoval[] } {
  const kept: T[] = [];
  const removed: CandidateRemoval[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (!item || typeof item.recipeId !== "string" || !item.recipeId) continue;

    if (seen.has(item.recipeId)) {
      removed.push({ recipeId: item.recipeId, recipeName: item.recipeName, reasons: ["duplicate"] });
      continue;
    }
    seen.add(item.recipeId);

    if (assignedRecipeIds.has(item.recipeId)) {
      kept.push(item);
      continue;
    }

    const reasons: CandidateRemovalReason[] = [];
    if (exclusions.recentlyCooked.has(item.recipeId)) reasons.push("recently-cooked");
    if (exclusions.recentlyPlanned.has(item.recipeId)) reasons.push("recently-planned");
    if (exclusions.recentlyOffered.has(item.recipeId)) reasons.push("recently-offered");
    if (exclusions.negativeFeedback.has(item.recipeId)) reasons.push("negative-feedback");

    if (reasons.length > 0) {
      removed.push({ recipeId: item.recipeId, recipeName: item.recipeName, reasons });
    } else {
      kept.push(item);
    }
  }

  return { items: kept, removed };
}

type ReclassifiableCandidateItem = SanitizableCandidateItem & {
  bucket?: CandidateBucket | string;
  cuisine?: string;
};

export type CandidateRelabel = {
  recipeId: string;
  from: string | undefined;
  to: CandidateBucket;
};

/**
 * Recompute bucket labels (and planner-facing name/cuisine) for candidate
 * items from the authoritative classifier. A persisted label never overrides
 * classification. Items whose recipe cannot be resolved are kept unchanged —
 * dropping data on a resolution failure would invent facts the other way.
 * Resolved items that fail the planner-main gate are dropped.
 */
export async function reclassifyCandidateItems<T extends ReclassifiableCandidateItem>(
  items: readonly T[],
  resolveRecipe: (id: string) => Promise<Recipe | undefined | null>,
): Promise<{ items: T[]; dropped: CandidateRemoval[]; relabeled: CandidateRelabel[] }> {
  const kept: T[] = [];
  const dropped: CandidateRemoval[] = [];
  const relabeled: CandidateRelabel[] = [];

  for (const item of items) {
    let recipe: Recipe | undefined | null;
    try {
      recipe = await resolveRecipe(item.recipeId);
    } catch {
      recipe = null;
    }

    if (!recipe) {
      kept.push(item);
      continue;
    }

    if (!isMainPlannerCandidate(recipe)) {
      dropped.push({ recipeId: item.recipeId, recipeName: item.recipeName, reasons: ["not-main-eligible"] });
      continue;
    }

    const bucket = classifyPlannerBucket(recipe);
    if (item.bucket !== bucket) {
      relabeled.push({ recipeId: item.recipeId, from: item.bucket, to: bucket });
    }
    kept.push({
      ...item,
      bucket,
      recipeName: normalizePlannerTitle(recipe.name) || item.recipeName,
      ...(item.cuisine !== undefined ? { cuisine: normalizePlannerCuisine(recipe) } : {}),
    });
  }

  return { items: kept, dropped, relabeled };
}

// ---------------------------------------------------------------------------
// Week id helpers
// ---------------------------------------------------------------------------

/** Format an ISO week id string from year + week number. */
export function formatWeekId(year: number, week: number): string {
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Parse a "YYYY-Www" string into { year, week }. Returns null on invalid input. */
export function parseWeekId(weekId: string): { year: number; week: number } | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekId);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const week = parseInt(m[2], 10);
  if (week < 1 || week > 53) return null;
  return { year, week };
}

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

/** Current ISO week id (e.g. "2026-W31"). */
export function currentIsoWeekId(now = new Date()): string {
  const { year, week } = getISOWeek(now);
  return formatWeekId(year, week);
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

/**
 * Offset an ISO week by `delta` weeks (positive = forward, negative = back).
 * Handles year boundaries correctly by converting to date, offsetting, and
 * re-deriving the ISO week.
 */
export function offsetWeek(
  year: number,
  week: number,
  delta: number,
): { year: number; week: number } {
  const monday = getWeekMonday(year, week);
  monday.setUTCDate(monday.getUTCDate() + delta * 7);
  return getISOWeek(monday);
}

/** Return previous ISO week ids, newest first. */
export function getRecentWeekIds(weekId: string, lookback: number): string[] {
  const parsed = parseWeekId(weekId);
  if (!parsed || lookback < 1) return [];
  return Array.from({ length: lookback }, (_, i) => {
    const { year, week } = offsetWeek(parsed.year, parsed.week, -(i + 1));
    return formatWeekId(year, week);
  });
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
