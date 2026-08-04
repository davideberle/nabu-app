// Display support for /cooking that is NOT the recipe: table-side extraction,
// recipe-time formatting, and the wine pairing fallback.
//
// The former "order of attack" generator and its successor, the derived meal
// timeline, are both deliberately gone. However filtered, a generated list of
// timing bullets reads as a second instruction set competing with the working
// method. The page has exactly one procedural sequence (live-cooking DESIGN.md
// §3 rule 11); cross-component coordination is carried by the compact overview
// rows and each side's own subordinate recipe block.

// Explicit .ts extension: this module is loaded directly by `node --test`
// (via cooking-guidance.test.ts), whose ESM resolver does not add extensions.
import { isDrinkServeWith, type SessionIngredient } from "./cooking-session.ts";
import type { Recipe } from "./recipes";

export type CookingPairingSuggestion = {
  wine: string;
  nonAlcoholic: string;
};

export type RecipeTime = {
  prep?: string | number;
  cook?: string | number;
  total?: string | number;
};

// ---------------------------------------------------------------------------
// Table sides
// ---------------------------------------------------------------------------

export function extractTableSides(
  ingredients: SessionIngredient[],
  explicitServeWith: string[]
): string[] {
  const sides: string[] = explicitServeWith.filter((item) => !isDrinkServeWith(item));

  for (const ingredient of ingredients) {
    const item = ingredient.item.trim();
    if (!item) continue;
    const servingMatch = item.match(/^(.*?),\s*for serving$/i);
    if (servingMatch?.[1] && !isDrinkServeWith(servingMatch[1])) {
      sides.push(servingMatch[1]);
    }
  }

  return uniqueByNormalized(sides.map(cleanSideLabel).filter(Boolean));
}

// ---------------------------------------------------------------------------
// Recipe time
// ---------------------------------------------------------------------------

export function formatRecipeTime(time?: RecipeTime): string | null {
  if (!time) return null;
  const prep = minutesFromTimeValue(time.prep);
  const cook = minutesFromTimeValue(time.cook);
  const total = minutesFromTimeValue(time.total) || prep + cook;

  if (!total) return null;
  if (prep && cook) {
    return `${formatDuration(total)} total · ${formatDuration(prep)} prep · ${formatDuration(cook)} cook`;
  }
  return `${formatDuration(total)} total`;
}

// ---------------------------------------------------------------------------
// Wine pairing fallback (used only when the session has no coachCards.wine)
// ---------------------------------------------------------------------------

export type PairingInput = {
  mainTitle: string;
  mainRecipe?: Recipe;
  ingredients: SessionIngredient[];
  method: string[];
  tableSides: string[];
};

export function buildPairingSuggestion({
  mainTitle,
  mainRecipe,
  ingredients,
  method,
  tableSides,
}: PairingInput): CookingPairingSuggestion {
  const profile = buildRecipeProfile(mainTitle, mainRecipe, ingredients, method, tableSides);
  return getPairingSuggestion(profile);
}

type MethodStyle = "simmer" | "roast" | "bake" | "quick-stir-fry" | "salad" | "marinate" | "general";

type RecipeProfile = {
  text: string;
  cuisine: string;
  protein: "fish" | "chicken" | "red-meat" | "pork" | "legume" | "vegetable" | "cheese-egg" | "mixed" | "unknown";
  methodStyle: MethodStyle;
  weight: "light" | "medium" | "rich";
  heat: "none" | "mild" | "spicy";
  hasTomato: boolean;
  hasCoconut: boolean;
  hasCreamOrCheese: boolean;
  hasCitrusOrVinegar: boolean;
  hasHerbs: boolean;
};

function buildRecipeProfile(
  title: string,
  recipe: Recipe | undefined,
  ingredients: SessionIngredient[],
  method: string[],
  tableSides: string[]
): RecipeProfile {
  const cuisine = normalizeCuisine(recipe?.cuisine);
  const text = [
    title,
    cuisine,
    recipe?.source?.cookbook,
    recipe?.source?.chapter,
    recipe?.category?.dish_type?.join(" "),
    recipe?.intro,
    recipe?.introduction,
    recipe?.tips,
    recipe?.serving,
    ...ingredients.map((ingredient) => `${ingredient.amount} ${ingredient.unit ?? ""} ${ingredient.item}`),
    ...method,
    ...tableSides,
  ].join(" ").toLowerCase();

  const methodStyle = inferMethodStyle(text, recipe);
  const protein = inferProtein(text);
  const heat = inferHeat(text);
  const hasTomato = /\b(tomato|tomatoes|passata|tomatillo|marinara)\b/.test(text);
  const hasCoconut = /\b(coconut|coconut milk|coconut cream)\b/.test(text);
  const hasCreamOrCheese = /\b(cream|cr[eè]me|cheese|parmesan|pecorino|feta|butter|yogurt|mascarpone)\b/.test(text);
  const hasCitrusOrVinegar = /\b(lemon|lime|orange|vinegar|verjuice|sumac|tamarind|pickle|pickled)\b/.test(text);
  const hasHerbs = /\b(cilantro|coriander|parsley|mint|basil|dill|tarragon|chives|herb|herbs)\b/.test(text);
  const richSignals = [
    hasCreamOrCheese,
    /\b(beef|lamb|pork belly|sausage|bacon|chorizo|duck|short rib|oxtail)\b/.test(text),
    /\b(fried|deep-fried|confit|braised|stew|butter)\b/.test(text),
  ].filter(Boolean).length;
  const lightSignals = [
    protein === "fish" || protein === "vegetable",
    /\b(salad|broth|steamed|poached|grilled|raw)\b/.test(text),
    hasCitrusOrVinegar || hasHerbs,
  ].filter(Boolean).length;
  const weight = richSignals >= 2 ? "rich" : lightSignals >= 2 ? "light" : "medium";

  return {
    text,
    cuisine,
    protein,
    methodStyle,
    weight,
    heat,
    hasTomato,
    hasCoconut,
    hasCreamOrCheese,
    hasCitrusOrVinegar,
    hasHerbs,
  };
}

function getPairingSuggestion(profile: RecipeProfile): CookingPairingSuggestion {
  const t = profile.text;

  if (/sancocho|caribbean|puerto rican|plantain|yuca|calabaza|sofrito/.test(t)) {
    return {
      wine: "Optional: a crisp white with acidity — Albariño, Verdejo or Sauvignon Blanc — works better here than a heavy red.",
      nonAlcoholic: "Non-alc beer is suitable: pick a crisp lager/pilsner or wheat-style NA beer; avoid very bitter IPA with the starchy roots.",
    };
  }

  if (profile.heat === "spicy" || /curry|tagine|harissa|gochujang|kimchi|sichuan|thai/.test(t)) {
    return {
      wine: "Optional: off-dry Riesling, Grüner Veltliner or a chilled light red if the dish is not too hot.",
      nonAlcoholic: "Non-alc beer works well if it is crisp and not too bitter; otherwise sparkling water with lime is safer.",
    };
  }

  if (profile.protein === "fish") {
    const richer = profile.hasCoconut || profile.hasCreamOrCheese || profile.methodStyle === "roast";
    return {
      wine: richer
        ? "Optional: fuller white — Chardonnay, white Rhône or Grüner Veltliner — rather than a sharp lightweight white."
        : "Optional: a bright white — Sauvignon Blanc, Albariño, Chablis or dry Riesling — is the safe lane.",
      nonAlcoholic: "Non-alc pilsner/lager works well with fish; sparkling water with lemon is the cleanest option.",
    };
  }

  if (profile.protein === "chicken") {
    return {
      wine: profile.weight === "rich"
        ? "Optional: Chardonnay or a light Pinot Noir; go brighter if there is lemon or herbs."
        : "Optional: Chardonnay, Grüner Veltliner or a light Pinot Noir depending on how rich the sauce is.",
      nonAlcoholic: "Non-alc wheat beer or lager is usually good; choose sparkling water if the dish is lemony or delicate.",
    };
  }

  if (profile.protein === "red-meat" || profile.protein === "pork") {
    return {
      wine: profile.hasTomato
        ? "Optional: a red with acidity — Chianti, Barbera or Rioja — will handle tomato and richness."
        : "Optional: a medium-bodied red — Rioja, Syrah, Cabernet Franc or Grenache — should have enough structure.",
      nonAlcoholic: "Non-alc dark lager or maltier beer can work; avoid sweet NA drinks with rich meat dishes.",
    };
  }

  if (profile.protein === "legume" || /lentil|bean|chickpea|dal|dhal/.test(t)) {
    return {
      wine: profile.hasTomato
        ? "Optional: Barbera, Chianti or Garnacha — something juicy with enough acidity for tomato and legumes."
        : "Optional: Chenin Blanc, Grüner Veltliner or a light Grenache depending on spice and richness.",
      nonAlcoholic: "Non-alc lager is a good default; add lemony sparkling water if the dish feels earthy or heavy.",
    };
  }

  if (/mushroom|tomato|pasta|eggplant|aubergine|pepper|ratatouille/.test(t)) {
    return {
      wine: "Optional: a juicy medium-bodied red — Chianti, Barbera or a lighter Grenache — should fit.",
      nonAlcoholic: "Non-alc beer can work, especially a maltier lager; sparkling water with lemon keeps it lighter.",
    };
  }

  if (profile.weight === "light" || /salad|asparagus|pea|zucchini|courgette|green bean|broccoli|cauliflower|fennel/.test(t)) {
    return {
      wine: "Optional: keep it fresh — Sauvignon Blanc, Grüner Veltliner, dry Riesling or a crisp rosé.",
      nonAlcoholic: "Non-alc lager is fine if the dish is salty; otherwise sparkling water with citrus is better.",
    };
  }

  return {
    wine: "Optional: choose a bright, food-friendly white or a light red served slightly cool.",
    nonAlcoholic: "Non-alc beer is fine if you want beer; for a cleaner pairing, go sparkling water with citrus.",
  };
}

function inferMethodStyle(text: string, recipe?: Recipe): MethodStyle {
  const dishTypes = recipe?.category?.dish_type?.join(" ").toLowerCase() ?? "";
  if (/\b(marinate|marinating|rest overnight|overnight)\b/.test(text)) return "marinate";
  if (/\b(stir-fry|stir fry|wok)\b/.test(text)) return "quick-stir-fry";
  // Simmer/braise before salad: a curry with "basil leaves" is a simmer dish, not a salad.
  if (/\b(simmer|stew|soup|braise|broth|curry(?!\s*powder))\b/.test(text)) return "simmer";
  if (/\b(salad|slaw)\b/.test(dishTypes) || /\b(dressing|vinaigrette)\b/.test(text)) return "salad";
  if (/\b(roast|grill|barbecue|bbq)\b/.test(text)) return "roast";
  if (/\b(bake|oven)\b/.test(text)) return "bake";
  return "general";
}

function inferProtein(text: string): RecipeProfile["protein"] {
  const hasFish = /\b(fish|salmon|cod|hake|seafood|prawn|shrimp|clam|mussel|tuna|anchovy|sardine)\b/.test(text);
  const hasChicken = /\b(chicken|turkey|poulet)\b/.test(text);
  const hasRedMeat = /\b(beef|lamb|steak|veal|oxtail|short rib)\b/.test(text);
  const hasPork = /\b(pork|bacon|sausage|chorizo|ham|prosciutto)\b/.test(text);
  const hasLegume = /\b(lentil|bean|chickpea|chana|dal|dhal|tofu|tempeh)\b/.test(text);
  const hasCheeseEgg = /\b(egg|eggs|cheese|feta|halloumi|paneer|ricotta)\b/.test(text);
  const count = [hasFish, hasChicken, hasRedMeat, hasPork, hasLegume, hasCheeseEgg].filter(Boolean).length;
  if (count > 1) return "mixed";
  if (hasFish) return "fish";
  if (hasChicken) return "chicken";
  if (hasRedMeat) return "red-meat";
  if (hasPork) return "pork";
  if (hasLegume) return "legume";
  if (hasCheeseEgg) return "cheese-egg";
  if (/\b(vegetable|veg|mushroom|aubergine|eggplant|zucchini|courgette|cauliflower|broccoli)\b/.test(text)) return "vegetable";
  return "unknown";
}

function inferHeat(text: string): RecipeProfile["heat"] {
  if (/\b(very spicy|hot chilli|hot chili|scotch bonnet|habanero|bird'?s eye|gochujang|harissa)\b/.test(text)) return "spicy";
  if (/\b(chilli|chili|jalape[nñ]o|cayenne|pepper flakes|sriracha|sambal|curry paste)\b/.test(text)) return "mild";
  return "none";
}

function normalizeCuisine(cuisine: Recipe["cuisine"] | undefined): string {
  if (Array.isArray(cuisine)) return cuisine.join(" ");
  return cuisine ?? "";
}

// ---------------------------------------------------------------------------
// Shared formatting
// ---------------------------------------------------------------------------

function cleanSideLabel(raw: string): string {
  return raw
    .replace(/^served with\s+/i, "")
    .replace(/^serve with\s+/i, "")
    .replace(/,\s*for serving$/i, "")
    .trim();
}

function uniqueByNormalized(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function minutesFromTimeValue(value?: string | number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;

  const normalized = value.toLowerCase().replace(/¼/g, ".25").replace(/½/g, ".5").replace(/¾/g, ".75");
  let minutes = 0;
  const hourMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)/);
  if (hourMatch) minutes += Number(hourMatch[1]) * 60;

  const minuteMatch = normalized.match(/(\d+)\s*(?:m|min|mins|minute|minutes)/);
  if (minuteMatch) minutes += Number(minuteMatch[1]);

  if (minutes > 0) return minutes;
  const firstNumber = normalized.match(/\d+/);
  return firstNumber ? Number(firstNumber[0]) : 0;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (!mins) return `${hours} hr`;
  return `${hours} hr ${mins} min`;
}
