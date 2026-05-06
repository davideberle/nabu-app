import type { CookingSession, SessionIngredient } from "./cooking";
import type { Recipe } from "./recipes";

export type CookingPairingSuggestion = {
  wine: string;
  nonAlcoholic: string;
};

export type CookingKnowledgeNote = {
  term: string;
  note: string;
};

export type CookingGuidance = {
  mealFlow: string[];
  pairing: CookingPairingSuggestion;
  knowledgeNotes: CookingKnowledgeNote[];
};

export type RecipeTime = {
  prep?: string | number;
  cook?: string | number;
  total?: string | number;
};

type BuildGuidanceInput = {
  session: CookingSession;
  mainRecipe?: Recipe;
  sideRecipes?: Recipe[];
};

export function buildCookingGuidance({
  session,
  mainRecipe,
  sideRecipes = [],
}: BuildGuidanceInput): CookingGuidance {
  const mainIngredients = session.ingredients.session.length > 0
    ? session.ingredients.session
    : session.ingredients.base;
  const mainMethod = session.method.session.length > 0
    ? session.method.session
    : session.method.base;
  const tableSides = extractTableSides(mainIngredients, session.serveWith);
  const profile = buildRecipeProfile(session.anchor.title, mainRecipe, mainIngredients, mainMethod, tableSides);

  return {
    mealFlow: buildMealFlow({
      mainTitle: session.anchor.title,
      mainIngredients,
      mainMethod,
      sideRecipes,
      tableSides,
      profile,
    }),
    pairing: getPairingSuggestion(profile),
    knowledgeNotes: getKnowledgeNotes(profile),
  };
}

export function buildMealFlow({
  mainTitle,
  mainIngredients,
  mainMethod,
  sideRecipes,
  tableSides,
  profile,
}: {
  mainTitle: string;
  mainIngredients: SessionIngredient[];
  mainMethod: string[];
  sideRecipes: Recipe[];
  tableSides: string[];
  profile?: RecipeProfile;
}): string[] {
  const p = profile ?? buildRecipeProfile(mainTitle, undefined, mainIngredients, mainMethod, tableSides);
  const steps: string[] = [];
  const grainSides = tableSides.filter(isGrainOrStarchSide);
  const freshSides = tableSides.filter(isFreshFinishSide);
  const warmAtEndSides = tableSides.filter(isWarmAtEndSide);
  const handledSides = new Set([...grainSides, ...freshSides, ...warmAtEndSides]);
  const otherSides = tableSides.filter((side) => !handledSides.has(side));

  if (p.hasSofrito) {
    steps.push(
      "Make or measure the sofrito first: blend/chop the aromatics if needed, then have it ready before the pot goes on."
    );
    steps.push(
      "Start the pot by heating oil, then sauté sofrito and aromatics until fragrant before adding liquid or longer-cooking ingredients."
    );
  } else if (p.methodStyle === "marinate") {
    steps.push("Check the marinating/resting step first; start that before you prep anything else.");
  } else if (p.methodStyle === "bake") {
    steps.push("Preheat the oven first, then prep the tray/pan and ingredients while it comes up to temperature.");
  } else if (p.methodStyle === "quick-stir-fry") {
    steps.push("Prep every ingredient and sauce before heating the pan; once you start cooking, it moves fast.");
  } else if (p.methodStyle === "salad") {
    steps.push("Make the dressing and any cooked/crunchy elements first; keep delicate leaves or herbs until the end.");
  } else {
    steps.push(`Read the ${mainTitle} method once, then gather and prep the slowest ingredients first.`);
  }

  if (grainSides.length > 0) {
    steps.push(
      `Start ${formatList(grainSides).toLowerCase()} early enough that it can finish and sit covered while the main cooks.`
    );
  }

  if (sideRecipes.length > 0) {
    steps.push(
      `Prep ${formatList(sideRecipes.map((side) => side.name))} before the final cook so the main dish stays the focus.`
    );
  }

  if (p.methodStyle === "simmer") {
    steps.push(`Simmer the ${mainTitle} gently, adding quick-cooking or delicate ingredients near the end.`);
  } else if (p.methodStyle === "roast" || p.methodStyle === "bake") {
    steps.push(`Cook the ${mainTitle}, then use the oven time to clear prep and set up sides.`);
  } else if (p.methodStyle === "quick-stir-fry") {
    steps.push(`Cook the ${mainTitle} hot and fast; do not walk away from the pan.`);
  } else if (p.methodStyle === "salad") {
    steps.push(`Assemble the ${mainTitle} close to serving so it stays crisp.`);
  } else {
    steps.push(`Cook the ${mainTitle}, keeping quick-cooking or delicate ingredients for the end if the recipe calls for them.`);
  }

  if (warmAtEndSides.length > 0) {
    steps.push(`Warm ${formatList(warmAtEndSides).toLowerCase()} near serving time so it does not dry out.`);
  }

  if (freshSides.length > 0) {
    steps.push(`Prepare ${formatList(freshSides).toLowerCase()} at the end so it stays fresh and bright next to the hot food.`);
  }

  if (otherSides.length > 0) {
    steps.push(`Bring ${formatList(otherSides).toLowerCase()} to the table while the main rests or gets its final seasoning.`);
  }

  if (p.needsAcidFinish) {
    steps.push("Taste at the end and add a small hit of acid — lemon, lime or vinegar — if the dish feels heavy or flat.");
  } else {
    steps.push("Taste, adjust salt/herbs, then serve with the sides ready.");
  }

  return steps;
}

export function extractTableSides(
  ingredients: SessionIngredient[],
  explicitServeWith: string[]
): string[] {
  const sides: string[] = [...explicitServeWith];

  for (const ingredient of ingredients) {
    const item = ingredient.item.trim();
    if (!item) continue;
    const servingMatch = item.match(/^(.*?),\s*for serving$/i);
    if (servingMatch?.[1]) {
      sides.push(servingMatch[1]);
    }
  }

  return uniqueByNormalized(sides.map(cleanSideLabel).filter(Boolean));
}

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

type MethodStyle = "simmer" | "roast" | "bake" | "quick-stir-fry" | "salad" | "marinate" | "general";

type RecipeProfile = {
  text: string;
  cuisine: string;
  protein: "fish" | "chicken" | "red-meat" | "pork" | "legume" | "vegetable" | "cheese-egg" | "mixed" | "unknown";
  methodStyle: MethodStyle;
  weight: "light" | "medium" | "rich";
  heat: "none" | "mild" | "spicy";
  hasSofrito: boolean;
  hasTomato: boolean;
  hasCoconut: boolean;
  hasCreamOrCheese: boolean;
  hasCitrusOrVinegar: boolean;
  hasHerbs: boolean;
  needsAcidFinish: boolean;
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
  const needsAcidFinish = (weight === "rich" || hasCoconut || hasTomato || protein === "legume") && !hasCitrusOrVinegar;

  return {
    text,
    cuisine,
    protein,
    methodStyle,
    weight,
    heat,
    hasSofrito: /\bsofrito|sofregit|soffritto\b/.test(text),
    hasTomato,
    hasCoconut,
    hasCreamOrCheese,
    hasCitrusOrVinegar,
    hasHerbs,
    needsAcidFinish,
  };
}

function getKnowledgeNotes(profile: RecipeProfile): CookingKnowledgeNote[] {
  const glossary: { term: string; pattern: RegExp; note: string }[] = [
    {
      term: "Sofrito",
      pattern: /\bsofrito\b/i,
      note: "A cooked aromatic base, usually blended or finely chopped onion/garlic/pepper/herbs. Treat it like the flavor foundation: sauté it in oil until fragrant before adding liquid.",
    },
    {
      term: "Soffritto / soffrito",
      pattern: /\bsoffritto\b/i,
      note: "Italian aromatic base, usually onion, carrot and celery slowly cooked in fat until sweet and soft — not browned hard.",
    },
    {
      term: "Mirepoix",
      pattern: /\bmirepoix\b/i,
      note: "French aromatic base of onion, carrot and celery. Cook it gently first so it sweetens and flavors the whole dish.",
    },
    {
      term: "Deglaze",
      pattern: /\bdeglaz(e|ing)\b/i,
      note: "Add liquid to a hot pan and scrape up the browned bits stuck to the bottom; those bits are concentrated flavor.",
    },
    {
      term: "Reduce",
      pattern: /\breduc(e|ed|ing|tion)\b/i,
      note: "Simmer liquid so water evaporates and the flavor thickens/concentrates. Stop before it gets too salty or sticky.",
    },
    {
      term: "Bloom spices",
      pattern: /\bbloom(?:ing)?\b.*\bspices?\b|\bspices?\b.*\bbloom(?:ing)?\b/i,
      note: "Briefly warm spices in oil or butter before adding liquid; this wakes up fat-soluble aromas. Keep the heat moderate so they do not burn.",
    },
    {
      term: "Temper eggs",
      pattern: /\btemper(?:ed|ing)?\b/i,
      note: "Slowly whisk hot liquid into eggs or dairy before adding them back to the pot, so they warm up without scrambling or splitting.",
    },
    {
      term: "Fold in",
      pattern: /\bfold in\b/i,
      note: "Gently lift and turn the mixture with a spatula instead of stirring hard, so airy or delicate ingredients keep their texture.",
    },
    {
      term: "Bain-marie",
      pattern: /\bbain[- ]marie\b|\bwater bath\b/i,
      note: "A hot-water bath that surrounds a dish with gentle, even heat — common for custards and cheesecakes.",
    },
    {
      term: "Confit",
      pattern: /\bconfit\b/i,
      note: "Slow cooking in fat or oil at low heat until tender. It should be gentle, not a hard fry.",
    },
    {
      term: "Blanch and shock",
      pattern: /\bblanch\b|\bshock\b/i,
      note: "Briefly boil, then cool fast in cold/ice water. This keeps vegetables bright and stops the cooking.",
    },
    {
      term: "Julienne",
      pattern: /\bjulienne\b/i,
      note: "Cut into thin matchsticks. Uniform size matters more than perfection.",
    },
    {
      term: "Chiffonade",
      pattern: /\bchiffonade\b/i,
      note: "Stack leafy herbs/greens, roll them up, then slice thinly into ribbons.",
    },
    {
      term: "Roux",
      pattern: /\broux\b/i,
      note: "Cook flour and fat together before adding liquid; it thickens sauces and removes raw flour taste.",
    },
    {
      term: "Slurry",
      pattern: /\bslurry\b/i,
      note: "Starch mixed with cold liquid before it goes into hot sauce/soup. Add gradually and stir so it thickens smoothly.",
    },
    {
      term: "Emulsify",
      pattern: /\bemulsif(?:y|ied|ying)\b|\bemulsion\b/i,
      note: "Force fat and water-based liquid to combine — usually by whisking/blending while adding oil slowly.",
    },
    {
      term: "Mise en place",
      pattern: /\bmise en place\b/i,
      note: "Have ingredients measured, chopped and ready before cooking. Especially useful for fast recipes where the pan will not wait.",
    },
    {
      term: "Adobo",
      pattern: /\badobo\b/i,
      note: "A seasoned spice blend or marinade; in Puerto Rican-style cooking it often brings garlic, oregano, pepper and salt. Taste before adding more salt.",
    },
    {
      term: "Culantro",
      pattern: /\bculantro\b/i,
      note: "A stronger, long-leaf relative of cilantro/coriander. Use it like a bold herb; if missing, cilantro is the closest easy substitute.",
    },
    {
      term: "Yuca",
      pattern: /\byuca\b|\bcassava\b/i,
      note: "A starchy root, more fibrous than potato. It needs to cook until fully tender; remove any tough woody core if present.",
    },
  ];

  const notes: CookingKnowledgeNote[] = [];
  const seen = new Set<string>();
  for (const item of glossary) {
    if (!item.pattern.test(profile.text)) continue;
    const key = item.term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    notes.push({ term: item.term, note: item.note });
    if (notes.length >= 4) break;
  }
  return notes;
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
  if (/\b(salad|slaw)\b/.test(dishTypes) || /\b(toss|leaves|dressing|vinaigrette)\b/.test(text)) return "salad";
  if (/\b(simmer|stew|soup|braise|broth)\b/.test(text)) return "simmer";
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

function isGrainOrStarchSide(side: string): boolean {
  return /\b(rice|quinoa|couscous|bulgur|farro|barley|noodle|pasta|potato|polenta|millet)\b/i.test(side);
}

function isFreshFinishSide(side: string): boolean {
  return /\b(avocado|salad|slaw|herb|herbs|lime|lemon|salsa|pickle|pickled|yogurt|raita|chutney|cucumber|tomato)\b/i.test(side);
}

function isWarmAtEndSide(side: string): boolean {
  return /\b(bread|naan|pita|tortilla|flatbread|rolls?)\b/i.test(side);
}

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

export function formatList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
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
