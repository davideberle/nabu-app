/**
 * The combined weekly idea shelf (Kitchen DESIGN.md §4.3, "Weekly preparation
 * and combined-set selection" and "Weekly food-pattern policy").
 *
 * One persisted set of roughly 12–14 ideas, not two shelves. Web research runs
 * first and its strongest ~5–7 qualified ideas survive; the local catalog then
 * fills only the coverage gaps the web set actually left. Source quotas are
 * caps, never obligations — a weak editorial week contributes fewer ideas and
 * the catalog covers more.
 *
 * Everything here is pure and deterministic: no clock beyond an injected `now`,
 * no randomness, no database. `node --test` loads it directly.
 */

import { visibleCapForSource, SHELF_TARGET, WEB_TARGET } from "./planner-sources.ts";
import type { PlannerRole } from "./planner-roles.ts";
import type { CandidateBucket } from "./meals-core.ts";

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

export type MealShape =
  | "salad" | "soup" | "stew-curry" | "bowl" | "pasta"
  | "roast-bake" | "stir-fry" | "grill" | "other";

export type ProteinLane = "vegan" | "vegetarian" | "fish" | "meat";
export type StarchLane = "pasta" | "rice" | "bread" | "potato" | "grain" | "legume" | "none";
export type EffortLane = "quick" | "medium" | "project";

export type ShelfTraits = {
  shape: MealShape;
  protein: ProteinLane;
  starch: StarchLane;
  effort: EffortLane;
  weekdayFit: boolean;
  weekendFit: boolean;
  vegetableDense: boolean;
  /** Reads as Swiss/European seasonal produce for the week's season. */
  seasonalLocal: boolean;
  /** Ingredient-led long-haul produce (avocado, mango, …). Soft penalty only. */
  longHaul: boolean;
};

export type ShelfCandidate = {
  recipeId: string;
  recipeName: string;
  origin: "web" | "catalog";
  /** How the idea was found. Editorial prominence is a signal, not a promise. */
  discovery: "editorial" | "search" | "catalog";
  /** Publication/source label used for the per-source cap. */
  sourceName?: string | null;
  role: PlannerRole;
  bucket: CandidateBucket;
  cuisine: string;
  image?: string | null;
  dietary?: string[];
  time?: { prep: number; cook: number; total: number } | null;
  category?: string;
  courseTags?: string[];
  traits: ShelfTraits;
  /** Ranking hint from the caller (editorial order, catalog score). Lower first. */
  rank?: number;
};

export type ShelfItem = ShelfCandidate & {
  /** Why this idea is on the shelf. Rendered as-is; never re-derived by the UI. */
  reason: string;
  /** Assigned to a day of the week being planned — visible but disabled. */
  assigned: boolean;
};

export type ShelfDiagnostics = {
  policyVersion: string;
  webConsidered: number;
  webSelected: number;
  catalogConsidered: number;
  catalogSelected: number;
  assignedPinned: number;
  /** Coverage gaps that were still open when the catalog fill finished. */
  remainingGaps: string[];
  /** Gaps the catalog fill closed, in the order they were closed. */
  closedGaps: string[];
  /** Ideas refused, with the rule that refused them. */
  rejected: { recipeId: string; reason: string }[];
  coverage: ShelfCoverage;
  warnings: string[];
};

export type ShelfCoverage = {
  total: number;
  shapes: Record<string, number>;
  proteins: Record<ProteinLane, number>;
  starches: Record<string, number>;
  cuisines: Record<string, number>;
  sources: Record<string, number>;
  efforts: Record<EffortLane, number>;
  weekendCapable: number;
  weekdayCapable: number;
  plantForwardShare: number;
  longHaul: number;
  seasonalLocal: number;
};

export type WeeklyShelf = {
  items: ShelfItem[];
  /** Pairing/serve-with ideas kept as metadata. They never occupy a main slot. */
  reserves: ShelfCandidate[];
  diagnostics: ShelfDiagnostics;
};

export const SHELF_POLICY_VERSION = "planner-shelf-1";

// ---------------------------------------------------------------------------
// Set-level caps (Kitchen "Weekly food-pattern policy")
// ---------------------------------------------------------------------------

export const SHELF_LIMITS = {
  /** "normally offer at most two pasta ideas across the combined shelf" */
  maxPasta: 2,
  /** No single cuisine may define the week. */
  maxPerCuisine: 3,
  /** Repeated non-pasta bases stay bounded too. */
  maxPerStarch: 3,
  /** Meat is occasional rather than a standing quota. */
  maxMeat: 2,
  /** Fish is a useful weekly lane, not a filler. */
  maxFish: 2,
  /** Long-haul-produce-led ideas should not accumulate across the week. */
  maxLongHaul: 2,
  /** Most dinners should be vegetarian or vegan. */
  minPlantForwardShare: 0.5,
  /** At least one longer weekend idea when the pool offers one. */
  minWeekendProjects: 1,
  /** Weekday cooking needs genuinely quick options. */
  minQuickWeekday: 3,
} as const;

// ---------------------------------------------------------------------------
// Trait derivation
// ---------------------------------------------------------------------------

type TraitSourceRecipe = {
  name?: string;
  cuisine?: unknown;
  dietary?: string[];
  tags?: { dietary?: string[]; season?: string[] } | null;
  category?: { dish_type?: string[] } | null;
  time?: { prep?: unknown; cook?: unknown; total?: unknown } | null;
  ingredients?: { item?: string }[];
  introduction?: string | null;
  intro?: string | null;
};

const SHAPE_PATTERNS: [MealShape, RegExp][] = [
  ["salad", /\b(salad|slaw|panzanella|tabbouleh)\b/],
  ["soup", /\b(soup|chowder|bisque|broth|minestrone|gazpacho|vichyssoise|potage|ramen|pho|laksa)\b/],
  ["stew-curry", /\b(stew|curry|tagine|dal|dhal|chill?i|braise|braised|goulash|ragout|rag[uù])\b/],
  ["pasta", /\b(pasta|spaghetti|penne|linguine|rigatoni|fettuccine|tagliatelle|pappardelle|lasagn[ae]|orzo|gnocchi|macaroni|carbonara|noodles?)\b/],
  ["bowl", /\b(bowl|buddha bowl|poke|burrito bowl|grain bowl)\b/],
  ["stir-fry", /\b(stir[- ]?fr(y|ied)|wok)\b/],
  ["grill", /\b(grill|grilled|barbecue|bbq|skewers?|kebabs?|souvlaki)\b/],
  ["roast-bake", /\b(roast|roasted|bake|baked|traybake|sheet pan|gratin|casserole|pie|tart|galette|frittata|quiche)\b/],
];

const STARCH_PATTERNS: [StarchLane, RegExp][] = [
  ["pasta", /\b(pasta|spaghetti|penne|linguine|rigatoni|fettuccine|tagliatelle|pappardelle|lasagn[ae]|orzo|macaroni|gnocchi|noodles?|soba|udon|ramen)\b/],
  ["rice", /\b(rice|risotto|pilaf|pilau|biryani|paella|congee)\b/],
  ["potato", /\b(potato|potatoes|r[öo]sti|gnocchi di patate|mash|fries)\b/],
  ["bread", /\b(bread|flatbread|naan|pita|tortilla|focaccia|baguette|sourdough|bun)\b/],
  ["grain", /\b(quinoa|bulgur|freekeh|farro|barley|couscous|polenta|millet|spelt)\b/],
  ["legume", /\b(lentils?|chickpeas?|beans?|dal|dhal|black beans?|cannellini|butter beans?)\b/],
];

const FISH_WORDS = /\b(salmon|tuna|trout|cod|halibut|sea ?bass|bream|snapper|mackerel|sardines?|anchov\w*|prawns?|shrimps?|scallops?|mussels?|clams?|squid|calamari|octopus|seafood|fish)\b/;
const MEAT_WORDS = /\b(chicken|beef|steak|pork|bacon|ham|lamb|mutton|duck|turkey|sausage|chorizo|veal|venison|meatballs?|prosciutto|pancetta|guanciale|salami)\b/;
const VEGAN_MARKERS = /\b(vegan|plant[- ]based)\b/;
const DAIRY_EGG = /\b(cheese|butter|cream|milk|yog(h)?urt|egg|eggs|parmesan|feta|halloumi|mozzarella|ricotta|mascarpone|honey)\b/;

const VEGETABLE_WORDS = /\b(tomato|courgette|zucchini|aubergine|eggplant|pepper|spinach|kale|chard|broccoli|cauliflower|carrot|fennel|leek|cabbage|beet|beetroot|celeriac|celery|pumpkin|squash|asparagus|pea|peas|green beans?|mushroom|onion|shallot|garlic|cucumber|radish|artichoke|corn|lettuce|rocket|arugula|herb)\b/g;

const LONG_HAUL_WORDS = /\b(avocado|mango|papaya|pineapple|passion ?fruit|banana|coconut milk|coconut cream|lime|lychee|dragon ?fruit|macadamia|cashew|quinoa)\b/;

const SEASONAL_BY_SEASON: Record<string, RegExp> = {
  spring: /\b(asparagus|rhubarb|radish|spring onion|wild garlic|ramp|pea|peas|new potato|morel|spinach|chard|nettle)\b/,
  summer: /\b(tomato|courgette|zucchini|aubergine|eggplant|pepper|cucumber|green beans?|corn|apricot|peach|plum|berry|berries|basil|melon|watermelon|fennel|chanterelle)\b/,
  fall: /\b(pumpkin|squash|mushroom|chestnut|apple|pear|grape|kale|cabbage|leek|celeriac|beet|beetroot|quince|walnut)\b/,
  winter: /\b(cabbage|kale|leek|parsnip|turnip|celeriac|beet|beetroot|potato|carrot|onion|chicory|endive|swede|salsify)\b/,
};

export function seasonForDate(now: Date): "spring" | "summer" | "fall" | "winter" {
  const m = now.getUTCMonth();
  if (m >= 2 && m <= 4) return "spring";
  if (m >= 5 && m <= 7) return "summer";
  if (m >= 8 && m <= 10) return "fall";
  return "winter";
}

function minutes(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/**
 * Derive the coverage traits the shelf reasons about. Deterministic text
 * analysis over name + ingredients + intro; nothing is invented that the recipe
 * does not state.
 */
export function deriveShelfTraits(recipe: TraitSourceRecipe, now: Date): ShelfTraits {
  const name = String(recipe.name ?? "").toLowerCase();
  const ingredientText = (recipe.ingredients ?? [])
    .map((ing) => String(ing?.item ?? "").toLowerCase())
    .join(" ");
  const intro = String(recipe.introduction ?? recipe.intro ?? "").toLowerCase();
  const all = `${name} ${ingredientText} ${intro}`;
  const dishTypes = (recipe.category?.dish_type ?? []).map((t) => String(t).toLowerCase());
  const dietary = [...(recipe.dietary ?? []), ...(recipe.tags?.dietary ?? [])].map((t) => t.toLowerCase());

  let shape: MealShape = "other";
  if (dishTypes.includes("salad")) shape = "salad";
  else if (dishTypes.includes("soup")) shape = "soup";
  else {
    for (const [candidate, re] of SHAPE_PATTERNS) {
      if (re.test(name)) { shape = candidate; break; }
    }
  }

  let starch: StarchLane = "none";
  for (const [lane, re] of STARCH_PATTERNS) {
    if (re.test(name) || re.test(ingredientText)) { starch = lane; break; }
  }

  const declaredVegan = dietary.includes("vegan") || VEGAN_MARKERS.test(name);
  const declaredVegetarian = declaredVegan || dietary.includes("vegetarian");
  const hasFish = FISH_WORDS.test(name) || FISH_WORDS.test(ingredientText);
  const hasMeat = MEAT_WORDS.test(name) || MEAT_WORDS.test(ingredientText);

  let protein: ProteinLane;
  if (declaredVegetarian && !hasFish && !hasMeat) {
    protein = declaredVegan ? "vegan" : "vegetarian";
  } else if (hasMeat) {
    protein = "meat";
  } else if (hasFish) {
    protein = "fish";
  } else {
    protein = DAIRY_EGG.test(ingredientText) ? "vegetarian" : "vegan";
  }

  const total = minutes(recipe.time?.total) || minutes(recipe.time?.prep) + minutes(recipe.time?.cook);
  const effort: EffortLane = total > 0 && total <= 35 ? "quick" : total >= 90 ? "project" : "medium";

  const vegetableMatches = new Set(ingredientText.match(VEGETABLE_WORDS) ?? []);
  const season = seasonForDate(now);

  return {
    shape,
    protein,
    starch,
    effort,
    weekdayFit: effort !== "project",
    weekendFit: effort !== "quick" || shape === "roast-bake" || shape === "grill",
    vegetableDense: vegetableMatches.size >= 3,
    seasonalLocal: SEASONAL_BY_SEASON[season].test(all),
    longHaul: LONG_HAUL_WORDS.test(name) || LONG_HAUL_WORDS.test(ingredientText),
  };
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

function emptyCoverage(): ShelfCoverage {
  return {
    total: 0,
    shapes: {},
    proteins: { vegan: 0, vegetarian: 0, fish: 0, meat: 0 },
    starches: {},
    cuisines: {},
    sources: {},
    efforts: { quick: 0, medium: 0, project: 0 },
    weekendCapable: 0,
    weekdayCapable: 0,
    plantForwardShare: 0,
    longHaul: 0,
    seasonalLocal: 0,
  };
}

function bump(record: Record<string, number>, key: string) {
  record[key] = (record[key] ?? 0) + 1;
}

export function measureCoverage(items: readonly ShelfCandidate[]): ShelfCoverage {
  const coverage = emptyCoverage();
  for (const item of items) {
    coverage.total += 1;
    bump(coverage.shapes, item.traits.shape);
    coverage.proteins[item.traits.protein] += 1;
    bump(coverage.starches, item.traits.starch);
    bump(coverage.cuisines, item.cuisine || "Other");
    bump(coverage.sources, sourceKey(item));
    coverage.efforts[item.traits.effort] += 1;
    if (item.traits.weekendFit) coverage.weekendCapable += 1;
    if (item.traits.weekdayFit) coverage.weekdayCapable += 1;
    if (item.traits.longHaul) coverage.longHaul += 1;
    if (item.traits.seasonalLocal) coverage.seasonalLocal += 1;
  }
  const plant = coverage.proteins.vegan + coverage.proteins.vegetarian;
  coverage.plantForwardShare = coverage.total > 0 ? plant / coverage.total : 0;
  return coverage;
}

function sourceKey(item: ShelfCandidate): string {
  if (item.origin === "catalog") return "catalog";
  return item.sourceName?.trim() || "Unknown source";
}

/**
 * Named coverage gaps, most important first. This is the whole point of the
 * two-pass design: the catalog is told what is *missing*, not what bucket to
 * fill.
 */
export function coverageGaps(coverage: ShelfCoverage): string[] {
  const gaps: string[] = [];
  const plant = coverage.proteins.vegan + coverage.proteins.vegetarian;

  if (coverage.total > 0 && plant / coverage.total < SHELF_LIMITS.minPlantForwardShare) {
    gaps.push("plant-forward");
  }
  if (coverage.proteins.fish === 0) gaps.push("fish");
  if ((coverage.efforts.quick ?? 0) < SHELF_LIMITS.minQuickWeekday) gaps.push("quick-weekday");
  if ((coverage.shapes.soup ?? 0) === 0) gaps.push("soup");
  if ((coverage.shapes.salad ?? 0) === 0) gaps.push("salad");
  if ((coverage.shapes["stew-curry"] ?? 0) === 0) gaps.push("stew-curry");
  if ((coverage.efforts.project ?? 0) < SHELF_LIMITS.minWeekendProjects) gaps.push("weekend-project");
  if (coverage.seasonalLocal === 0) gaps.push("seasonal-local");
  if (coverage.total > 0 && coverage.proteins.meat === 0) gaps.push("meat-optional");
  return gaps;
}

function closesGap(gap: string, candidate: ShelfCandidate): boolean {
  switch (gap) {
    case "plant-forward":
      return candidate.traits.protein === "vegan" || candidate.traits.protein === "vegetarian";
    case "fish":
      return candidate.traits.protein === "fish";
    case "meat-optional":
      return candidate.traits.protein === "meat";
    case "quick-weekday":
      return candidate.traits.effort === "quick" && candidate.traits.weekdayFit;
    case "weekend-project":
      return candidate.traits.effort === "project" || candidate.traits.weekendFit;
    case "seasonal-local":
      return candidate.traits.seasonalLocal;
    case "soup":
    case "salad":
    case "stew-curry":
      return candidate.traits.shape === gap;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Admission rules
// ---------------------------------------------------------------------------

export type AdmissionRefusal = { ok: false; reason: string };
export type AdmissionResult = { ok: true } | AdmissionRefusal;

/**
 * May `candidate` join the shelf as it currently stands?
 *
 * These are the "does the week feel like one repeated lane" rules. They apply
 * identically to web and catalog ideas — a featured pasta still counts against
 * the pasta cap.
 */
export function canAdmit(candidate: ShelfCandidate, current: readonly ShelfCandidate[]): AdmissionResult {
  if (candidate.role !== "main" && candidate.role !== "light-meal") {
    return { ok: false, reason: `role ${candidate.role} cannot occupy a main slot` };
  }
  if (current.some((item) => item.recipeId === candidate.recipeId)) {
    return { ok: false, reason: "already on the shelf" };
  }

  const coverage = measureCoverage(current);

  if (candidate.traits.starch === "pasta" && (coverage.starches.pasta ?? 0) >= SHELF_LIMITS.maxPasta) {
    return { ok: false, reason: `pasta lane already at ${SHELF_LIMITS.maxPasta}` };
  }
  if (
    candidate.traits.starch !== "none" &&
    candidate.traits.starch !== "pasta" &&
    (coverage.starches[candidate.traits.starch] ?? 0) >= SHELF_LIMITS.maxPerStarch
  ) {
    return { ok: false, reason: `${candidate.traits.starch} base already at ${SHELF_LIMITS.maxPerStarch}` };
  }
  const cuisine = candidate.cuisine || "Other";
  if (cuisine !== "Other" && (coverage.cuisines[cuisine] ?? 0) >= SHELF_LIMITS.maxPerCuisine) {
    return { ok: false, reason: `${cuisine} already at ${SHELF_LIMITS.maxPerCuisine}` };
  }
  if (candidate.traits.protein === "meat" && coverage.proteins.meat >= SHELF_LIMITS.maxMeat) {
    return { ok: false, reason: `meat lane already at ${SHELF_LIMITS.maxMeat}` };
  }
  if (candidate.traits.protein === "fish" && coverage.proteins.fish >= SHELF_LIMITS.maxFish) {
    return { ok: false, reason: `fish lane already at ${SHELF_LIMITS.maxFish}` };
  }
  if (candidate.traits.longHaul && coverage.longHaul >= SHELF_LIMITS.maxLongHaul) {
    return { ok: false, reason: `long-haul-produce ideas already at ${SHELF_LIMITS.maxLongHaul}` };
  }
  if (candidate.origin === "web") {
    const key = sourceKey(candidate);
    const cap = visibleCapForSource(candidate.sourceName ?? key);
    if ((coverage.sources[key] ?? 0) >= cap) {
      return { ok: false, reason: `${key} already at its cap of ${cap}` };
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function stableNoise(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

/**
 * Household-fit score. Higher is better. Deterministic: the only tiebreak is a
 * stable hash of the recipe id, so the same pool always produces the same set.
 */
export function scoreCandidate(candidate: ShelfCandidate): number {
  const t = candidate.traits;
  let score = 0;

  // Editorial discovery is a strong signal — but only a signal.
  if (candidate.discovery === "editorial") score += 4;
  if (candidate.image) score += 2;

  if (t.protein === "vegan") score += 3;
  else if (t.protein === "vegetarian") score += 2;
  else if (t.protein === "fish") score += 1;
  else score -= 1;

  if (t.vegetableDense) score += 2;
  if (t.seasonalLocal) score += 3;
  if (t.longHaul) score -= 2;
  if (t.effort === "quick") score += 2;
  else if (t.effort === "project") score += 1;

  if (candidate.role === "light-meal") score -= 1;

  // Caller-supplied ordering (editorial position, catalog pre-rank).
  if (typeof candidate.rank === "number") score -= candidate.rank * 0.25;

  return score + stableNoise(candidate.recipeId) * 0.4;
}

function byScoreDesc(a: ShelfCandidate, b: ShelfCandidate): number {
  return scoreCandidate(b) - scoreCandidate(a);
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export type AssembleShelfInput = {
  /** Qualified web ideas, already role-classified. Oversized pool expected. */
  web: readonly ShelfCandidate[];
  /** Catalog ideas available for gap-fill, already exposure/recency filtered. */
  catalog: readonly ShelfCandidate[];
  /** Pairing/serve-with ideas kept as reserve metadata. */
  pairings?: readonly ShelfCandidate[];
  /** Recipe ids already assigned to a day. They stay pinned and disabled. */
  assignedRecipeIds?: ReadonlySet<string>;
  target?: { min: number; max: number };
  webTarget?: { min: number; max: number };
};

/**
 * Assemble the persisted weekly shelf.
 *
 * Order matters and is the contract:
 *   1. pin assigned recipes (they are fixed, and visible-but-disabled)
 *   2. take the strongest qualified web ideas, subject to caps
 *   3. measure what the web set actually covers
 *   4. fill only the open gaps from the catalog, then top up to the target
 */
export function assembleWeeklyShelf(input: AssembleShelfInput): WeeklyShelf {
  const target = input.target ?? SHELF_TARGET;
  const webTarget = input.webTarget ?? WEB_TARGET;
  const assigned = input.assignedRecipeIds ?? new Set<string>();

  const rejected: { recipeId: string; reason: string }[] = [];
  const selected: ShelfItem[] = [];
  const closedGaps: string[] = [];

  const admit = (candidate: ShelfCandidate, reason: string, isAssigned: boolean) => {
    selected.push({ ...candidate, reason, assigned: isAssigned });
  };

  // --- 1. Assigned recipes are fixed. They never compete for a slot and no
  // cap can evict them: they are already on a day of the week.
  const assignedPool = [...input.web, ...input.catalog].filter((c) => assigned.has(c.recipeId));
  const pinnedIds = new Set<string>();
  for (const candidate of assignedPool) {
    if (pinnedIds.has(candidate.recipeId)) continue;
    pinnedIds.add(candidate.recipeId);
    admit(candidate, "Assigned to a day this week", true);
  }

  // --- 2. Web first.
  const webPool = input.web
    .filter((c) => !pinnedIds.has(c.recipeId))
    .slice()
    .sort(byScoreDesc);

  let webSelected = 0;
  for (const candidate of webPool) {
    if (webSelected >= webTarget.max) break;
    if (selected.length >= target.max) break;
    const verdict = canAdmit(candidate, selected);
    if (!verdict.ok) {
      rejected.push({ recipeId: candidate.recipeId, reason: verdict.reason });
      continue;
    }
    admit(
      candidate,
      candidate.discovery === "editorial"
        ? `Editor-curated pick from ${sourceKey(candidate)}`
        : `Targeted web find from ${sourceKey(candidate)}`,
      false,
    );
    webSelected += 1;
  }

  // --- 3. Measure, then --- 4. fill only the gaps.
  const catalogPool = input.catalog
    .filter((c) => !selected.some((s) => s.recipeId === c.recipeId))
    .slice()
    .sort(byScoreDesc);
  const usedCatalog = new Set<string>();
  let catalogSelected = 0;

  const fillOneGap = (gap: string): boolean => {
    for (const candidate of catalogPool) {
      if (usedCatalog.has(candidate.recipeId)) continue;
      if (!closesGap(gap, candidate)) continue;
      const verdict = canAdmit(candidate, selected);
      if (!verdict.ok) continue;
      usedCatalog.add(candidate.recipeId);
      admit(candidate, `From your recipe book to cover the ${gap.replace(/-/g, " ")} gap`, false);
      catalogSelected += 1;
      closedGaps.push(gap);
      return true;
    }
    return false;
  };

  // Gaps are recomputed after every fill: closing "plant-forward" can close
  // "quick-weekday" at the same time, and the next choice must know that.
  let guard = 0;
  while (selected.length < target.max && guard < 64) {
    guard += 1;
    const gaps = coverageGaps(measureCoverage(selected));
    const open = gaps.filter((gap) => gap !== "meat-optional" || selected.length < target.min);
    if (open.length === 0) break;
    let filledAny = false;
    for (const gap of open) {
      if (selected.length >= target.max) break;
      if (fillOneGap(gap)) { filledAny = true; break; }
    }
    if (!filledAny) break;
  }

  // Top up to the minimum shelf size with the strongest remaining catalog
  // ideas that still pass the set-level rules.
  for (const candidate of catalogPool) {
    if (selected.length >= target.min) break;
    if (usedCatalog.has(candidate.recipeId)) continue;
    const verdict = canAdmit(candidate, selected);
    if (!verdict.ok) {
      rejected.push({ recipeId: candidate.recipeId, reason: verdict.reason });
      continue;
    }
    usedCatalog.add(candidate.recipeId);
    admit(candidate, "From your recipe book to round out the week", false);
    catalogSelected += 1;
  }

  const coverage = measureCoverage(selected);
  const remainingGaps = coverageGaps(coverage);
  const warnings: string[] = [];
  if (selected.length < target.min) {
    warnings.push(`Shelf has ${selected.length} ideas, below the target of ${target.min}`);
  }
  if (webSelected < webTarget.min) {
    warnings.push(`Only ${webSelected} qualified web ideas survived (target ${webTarget.min}–${webTarget.max})`);
  }
  if (coverage.plantForwardShare < SHELF_LIMITS.minPlantForwardShare) {
    warnings.push("Shelf is not plant-forward enough for a normal week");
  }

  return {
    items: selected,
    reserves: (input.pairings ?? []).filter((p) => p.role === "pairing" || p.role === "light-meal"),
    diagnostics: {
      policyVersion: SHELF_POLICY_VERSION,
      webConsidered: input.web.length,
      webSelected,
      catalogConsidered: input.catalog.length,
      catalogSelected,
      assignedPinned: pinnedIds.size,
      remainingGaps,
      closedGaps,
      rejected,
      coverage,
      warnings,
    },
  };
}

// ---------------------------------------------------------------------------
// Targeted replacement (chat-driven wishes and plan completion)
// ---------------------------------------------------------------------------

export type ReplacementRequest = {
  /** Explicit ids to drop. Assigned ids in this list are ignored, not removed. */
  removeRecipeIds?: readonly string[];
  /** Drop unassigned shelf ideas whose trait matches, e.g. `{ protein: "meat" }`. */
  dropWhere?: Partial<Pick<ShelfTraits, "protein" | "shape" | "starch" | "effort">>;
  /** Fresh candidates offered as replacements, best first. */
  replacements: readonly ShelfCandidate[];
  /** Free-text wish, echoed into the reason so the card explains itself. */
  wish?: string;
};

export type ReplacementResult = {
  shelf: ShelfItem[];
  removed: { recipeId: string; reason: string }[];
  added: ShelfItem[];
  /** Ids that were requested for removal but are assigned, so were kept. */
  protectedAssigned: string[];
  coverage: ShelfCoverage;
  remainingGaps: string[];
  warnings: string[];
};

/**
 * Replace only the *unassigned* recommendations of an existing shelf.
 *
 * The week is never rerolled: every assigned day keeps its recipe, and the
 * result is revalidated against the same set-level rules so a chat wish cannot
 * quietly create three pasta nights. When the request removes nothing — every
 * match was assigned, or nothing matched — the shelf is left as it is apart
 * from a top-up if it was already short of the minimum.
 */
export function applyTargetedReplacement(
  shelf: readonly ShelfItem[],
  request: ReplacementRequest,
  options: { target?: { min: number; max: number } } = {},
): ReplacementResult {
  const target = options.target ?? SHELF_TARGET;
  const explicitRemovals = new Set(request.removeRecipeIds ?? []);
  const removed: { recipeId: string; reason: string }[] = [];
  const protectedAssigned: string[] = [];

  const matchesDropWhere = (item: ShelfItem): boolean => {
    const where = request.dropWhere;
    if (!where) return false;
    return (Object.keys(where) as (keyof typeof where)[]).every(
      (key) => item.traits[key] === where[key],
    );
  };

  const kept: ShelfItem[] = [];
  for (const item of shelf) {
    const wanted = explicitRemovals.has(item.recipeId) || matchesDropWhere(item);
    if (!wanted) {
      kept.push(item);
      continue;
    }
    if (item.assigned) {
      protectedAssigned.push(item.recipeId);
      kept.push(item);
      continue;
    }
    removed.push({
      recipeId: item.recipeId,
      reason: explicitRemovals.has(item.recipeId) ? "explicitly replaced" : "matched the requested change",
    });
  }

  // Nothing removed means nothing to swap in. A request that only named
  // assigned cards must leave the shelf alone rather than quietly appending
  // unrelated ideas under a "swapped in for your wish" reason it never earned.
  // A genuinely short shelf is still topped up — but only to the minimum, and
  // it says plainly that it is rounding out the week, not honouring a swap.
  const swapped = removed.length > 0;
  const ceiling = swapped ? target.max : target.min;

  const added: ShelfItem[] = [];
  const pool = request.replacements.slice().sort(byScoreDesc);
  for (const candidate of pool) {
    if (kept.length + added.length >= ceiling) break;
    if (swapped && added.length >= removed.length && kept.length + added.length >= target.min) break;
    const verdict = canAdmit(candidate, [...kept, ...added]);
    if (!verdict.ok) continue;
    const item: ShelfItem = {
      ...candidate,
      assigned: false,
      reason: swapped
        ? request.wish
          ? `Swapped in for: ${request.wish}`
          : "Swapped in to replace an idea you passed on"
        : "From your recipe book to round out the week",
    };
    added.push(item);
  }

  const next = [...kept, ...added];
  const coverage = measureCoverage(next);
  const warnings: string[] = [];
  if (next.length < target.min) {
    warnings.push(`Shelf has ${next.length} ideas after the change, below the target of ${target.min}`);
  }
  if (added.length < removed.length) {
    warnings.push(`Removed ${removed.length} idea(s) but only ${added.length} replacement(s) qualified`);
  }
  if (!swapped && protectedAssigned.length > 0) {
    warnings.push(
      `Nothing was replaced: every idea you named is assigned to a day (${protectedAssigned.join(", ")})`,
    );
  }

  return {
    shelf: next,
    removed,
    added,
    protectedAssigned,
    coverage,
    remainingGaps: coverageGaps(coverage),
    warnings,
  };
}
