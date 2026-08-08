/**
 * Planner role classification (Kitchen DESIGN.md §4.3, "Weekly preparation and
 * combined-set selection", step 4).
 *
 * Editorial prominence is a discovery signal, not qualification. Every imported
 * or catalog item is classified into the job it can actually do before it is
 * scored:
 *
 *   main       — a dinner main
 *   light-meal — a substantial light meal that can still carry a weekday dinner
 *   pairing     — genuinely useful, but only as a side/starter/serve-with idea;
 *                 it may live on the shelf as reserve/pairing metadata and can
 *                 never occupy a dinner main slot
 *   reject      — desserts, baking/bread, dips, drinks, snacks, condiments,
 *                 components, breakfast/brunch items, collection pages, and
 *                 anything without usable recipe structure
 *
 * The point of the `pairing` outcome is that an appealing seasonal salad from a
 * featured feed is neither mislabelled as a main nor silently thrown away.
 *
 * Dependency-free (the `Recipe` import is type-only and erased) so
 * `node --test` and the verification scripts can load it directly.
 */

import { isDinnerWorthy, hasExplicitMainCategory, hasSubstantialMainNameSignal } from "./meals-core.ts";
import type { Recipe } from "./recipes";

export type PlannerRole = "main" | "light-meal" | "pairing" | "reject";

export type RoleCategory =
  | "dessert"
  | "baking"
  | "bread"
  | "dip"
  | "drink"
  | "snack"
  | "condiment"
  | "component"
  | "breakfast"
  | "collection"
  | "salad"
  | "side"
  | "starter"
  | "soup"
  | "light-meal"
  | "main"
  | "unstructured";

export type RoleClassification = {
  role: PlannerRole;
  category: RoleCategory;
  /** True only for `main` and `light-meal`: may occupy a dinner main slot. */
  mainEligible: boolean;
  /** True for `pairing`: keep as reserve/pairing metadata, never as a main. */
  pairingEligible: boolean;
  reasons: string[];
};

// --- vocabulary ------------------------------------------------------------

const DECLARED_REJECT_TYPES = new Set([
  "dessert", "baking", "bread", "drink", "beverage", "cocktail", "snack",
  "condiment", "component", "base", "garnish", "sauce", "dressing", "pickle",
  "preserve", "chutney", "raita", "salsa", "dip", "breakfast", "brunch",
  "spice-blend", "spice blend",
]);

const DECLARED_PAIRING_TYPES = new Set(["side", "starter", "appetizer", "appetiser", "vegetable"]);

const DRINK_NAME = /\b(cocktail|mocktail|smoothie|juice|lemonade|limeade|iced tea|milkshake|mylkshake|lassi|horchata|spritz|sangria|punch|toddy|coffee|espresso|latte|kombucha|shrub|soda|tonic|cooler|fizz|shandy|mead|infusion|agua fresca)\b/i;
const DESSERT_NAME = /\b(cake|cakes|brownies?|cookies?|biscuits?|muffins?|cupcakes?|fudge|ice cream|sorbet|gelato|granitas?|semifreddo|panna cottas?|puddings?|truffles?|macarons?|meringues?|pavlovas?|trifles?|tiramis[uù]|baklava|strudels?|cannoli|churros?|biscotti|shortbread|blondies?|doughnuts?|donuts?|cobblers?|crumbles?|clafoutis|parfaits?|babka|dessert|sweet roll)\b/i;
const BREAD_NAME = /\b(dinner rolls?|bread rolls?|burger buns?|hot ?dog buns?|focaccia|sourdough|brioche|challah|baguettes?|croissants?|scones?|crackers?|loaf|loaves)\b/i;
const DIP_NAME = /\b(dips?|hummus|guacamole|baba ?ganoush|tapenade|mezze dip)\b/i;
const SNACK_NAME = /\b(snacks?|energy balls?|trail mix|popcorn|chips|crisps|nut butter|bites|lunch ?box|granola bars?)\b/i;
const BREAKFAST_NAME = /\b(pancakes?|waffles?|french toast|granola|porridge|oatmeal|breakfast|brunch|muesli|cereal|overnight oats)\b/i;
const CONDIMENT_NAME = /\b(sauce|dressing|vinaigrette|pickled?|chutney|raita|salsa|relish|pesto|aioli|mayonnaise|ketchup|jam|marmalade|compote|paste|rub|spice blend|masala powder|dough|marinade)\b/i;
/**
 * Collection/roundup pages. A leading count followed anywhere by "recipes"
 * ("29 Easy Vegan Dinner Recipes") is the shape these always take; the named
 * markers catch the rest. A collection is never a recipe.
 */
const COLLECTION_NAME = /^\s*\d+\s+.*\brecipes?\b|\b(recipe roundup|recipe collection|ideas for|what to cook|best .* recipes)\b/i;

/** Names that read as a light meal rather than a component or a full main. */
const LIGHT_MEAL_NAME = /\b(sandwich|sandwiches|wrap|wraps|tartines?|toasties|panini|bruschetta|flatbread|pita pocket|grain bowl|buddha bowl|nourish bowl|salad bowl|frittata|tortilla|omelette|omelet|quiche|galette|savou?ry tart|shakshuka|mezze plate|platter|soup|chowder|broth bowl)\b/i;

/** Protein/legume/substance markers that let a light meal carry a dinner. */
const SUBSTANCE_MARKERS = /\b(chicken|beef|pork|lamb|duck|turkey|fish|salmon|tuna|cod|prawns?|shrimp|tofu|tempeh|seitan|halloumi|paneer|feta|mozzarella|goat[’']?s? cheese|egg|eggs|lentils?|chickpeas?|beans?|quinoa|farro|bulgur|barley|rice|noodles?|pasta|potato|potatoes|freekeh|couscous)\b/i;

const PAIRING_NAME = /\b(salad|slaw|side|sides|greens|roasted vegetables?|grilled vegetables?|pickles?|starter|appetiz|appetis)\b/i;

function categoryValues(recipe: Recipe): string[] {
  const values: string[] = [];
  const category = recipe.category as { dish_type?: unknown; meal_role?: unknown; chapter?: unknown } | undefined;
  if (category && typeof category === "object") {
    if (Array.isArray(category.dish_type)) {
      values.push(...category.dish_type.filter((v): v is string => typeof v === "string"));
    }
    if (typeof category.meal_role === "string") values.push(category.meal_role);
  }
  if (typeof recipe.mealRole === "string") values.push(recipe.mealRole);
  return values.map((v) => v.toLowerCase().trim()).filter(Boolean);
}

/**
 * Minimum structure to be worth classifying at all.
 *
 * One instruction is enough here on purpose. A short, fully quantified salad
 * ("arrange the watermelon, spoon over the goat's cheese, season") is a real,
 * usable serve-with idea. It is `isDinnerWorthy` — not this check — that still
 * requires two method steps before anything can be a dinner **main**, so the
 * existing main gate is untouched; this only stops a genuine pairing from being
 * thrown away as "unstructured".
 */
function hasUsableStructure(recipe: Recipe): boolean {
  return (recipe.ingredients?.length ?? 0) >= 3 && (recipe.method?.length ?? 0) >= 1;
}

function countIngredients(recipe: Recipe): number {
  return recipe.ingredients?.length ?? 0;
}

/**
 * Declared-type rejection. Checked before every name heuristic so a recipe that
 * *says* it is a dessert is a dessert even when the title reads savoury.
 */
function declaredRejectCategory(values: string[]): RoleCategory | null {
  for (const value of values) {
    if (!DECLARED_REJECT_TYPES.has(value)) continue;
    if (value === "dessert") return "dessert";
    if (value === "baking") return "baking";
    if (value === "bread") return "bread";
    if (value === "dip") return "dip";
    if (value === "drink" || value === "beverage" || value === "cocktail") return "drink";
    if (value === "snack") return "snack";
    if (value === "breakfast" || value === "brunch") return "breakfast";
    if (value === "component" || value === "base" || value === "garnish") return "component";
    return "condiment";
  }
  return null;
}

function nameRejectCategory(name: string): RoleCategory | null {
  if (COLLECTION_NAME.test(name)) return "collection";
  if (DRINK_NAME.test(name)) return "drink";
  if (DESSERT_NAME.test(name)) return "dessert";
  if (BREAD_NAME.test(name)) return "bread";
  if (SNACK_NAME.test(name)) return "snack";
  if (BREAKFAST_NAME.test(name)) return "breakfast";
  // A dip/condiment title only rejects when nothing about the dish says main —
  // "Chicken with pesto and beans" is a main that happens to mention pesto.
  return null;
}

/**
 * Classify what job a recipe can do in the weekly planner.
 *
 * `isDinnerWorthy` stays the authoritative main gate (Phase 3B): this function
 * never promotes something the gate refuses. It adds two things the gate has no
 * vocabulary for — the light-meal qualification and the pairing survival path.
 */
export function classifyPlannerRole(recipe: Recipe): RoleClassification {
  const reasons: string[] = [];
  const name = (recipe.name ?? "").toLowerCase();
  const values = categoryValues(recipe);

  if (!hasUsableStructure(recipe)) {
    return {
      role: "reject",
      category: "unstructured",
      mainEligible: false,
      pairingEligible: false,
      reasons: ["not enough recipe structure (needs 3+ ingredients and at least one method step)"],
    };
  }

  const declared = declaredRejectCategory(values);
  if (declared) {
    return {
      role: "reject",
      category: declared,
      mainEligible: false,
      pairingEligible: false,
      reasons: [`declared ${declared} — never a dinner main`],
    };
  }

  const byName = nameRejectCategory(name);
  if (byName) {
    return {
      role: "reject",
      category: byName,
      mainEligible: false,
      pairingEligible: false,
      reasons: [`name reads as ${byName}`],
    };
  }

  // Dips and condiments.
  //
  // The escape hatch is a *substantial main signal* in the title, not a
  // structured `main` label: several imports blanket-stamp `dish_type: ["main"]`
  // (Phase 3B), so "Green Chilli Chutney" and "Baked Goat's Cheese Dip" carry
  // that label and are still not dinner. "Chicken with pesto" keeps its
  // chicken and survives. This mirrors `NON_MAIN_NAME_PATTERNS` in the
  // production main gate rather than inventing a second rule.
  if ((DIP_NAME.test(name) || CONDIMENT_NAME.test(name)) && !hasSubstantialMainNameSignal(recipe)) {
    const category: RoleCategory = DIP_NAME.test(name) ? "dip" : "condiment";
    return {
      role: "reject",
      category,
      mainEligible: false,
      pairingEligible: false,
      reasons: [`name reads as ${category} with no substantial main signal`],
    };
  }

  const declaredPairing = values.find((v) => DECLARED_PAIRING_TYPES.has(v));
  const declaredMain = hasExplicitMainCategory(recipe);
  const dinnerWorthy = isDinnerWorthy(recipe);

  // A declared side/starter that does not also declare itself a main is a
  // pairing idea, whatever the title suggests. This is the watermelon-and-
  // goat's-cheese case: it survives as a pairing rather than being promoted.
  if (declaredPairing && !declaredMain) {
    return {
      role: "pairing",
      category: declaredPairing === "starter" || declaredPairing === "appetizer" || declaredPairing === "appetiser"
        ? "starter"
        : declaredPairing === "vegetable"
          ? "side"
          : (declaredPairing as RoleCategory),
      mainEligible: false,
      pairingEligible: true,
      reasons: [`declared ${declaredPairing} — useful as a pairing, not a dinner main`],
    };
  }

  if (dinnerWorthy) {
    const looksLight = LIGHT_MEAL_NAME.test(name);
    if (looksLight) {
      const substantial =
        SUBSTANCE_MARKERS.test(`${name} ${(recipe.ingredients ?? []).map((i) => i?.item ?? "").join(" ")}`) &&
        countIngredients(recipe) >= 5;
      if (substantial) {
        reasons.push("light meal with enough substance for a weekday dinner");
        return { role: "light-meal", category: "light-meal", mainEligible: true, pairingEligible: true, reasons };
      }
      reasons.push("light-meal shape without enough substance for a dinner main");
      return { role: "pairing", category: "starter", mainEligible: false, pairingEligible: true, reasons };
    }
    reasons.push("passes the planner main gate");
    return { role: "main", category: "main", mainEligible: true, pairingEligible: false, reasons };
  }

  // Refused by the main gate. A salad/side/starter identity with usable
  // structure is still worth keeping as a pairing idea; anything else is out.
  if (PAIRING_NAME.test(name) || values.some((v) => DECLARED_PAIRING_TYPES.has(v))) {
    return {
      role: "pairing",
      category: name.includes("salad") ? "salad" : "side",
      mainEligible: false,
      pairingEligible: true,
      reasons: ["not a dinner main, but usable as a pairing/serve-with idea"],
    };
  }

  return {
    role: "reject",
    category: "unstructured",
    mainEligible: false,
    pairingEligible: false,
    reasons: ["refused by the planner main gate and not usable as a pairing"],
  };
}

/** Convenience predicate: may this recipe fill a dinner main slot? */
export function isMainSlotEligible(recipe: Recipe): boolean {
  return classifyPlannerRole(recipe).mainEligible;
}
