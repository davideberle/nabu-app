// Whole-meal coherence analyzer.
//
// Kitchen owns the contract implemented here (projects/kitchen/DESIGN.md
// §4.3 "Whole-meal coherence contract"); Live Cooking reuses it after every
// component change (projects/live-cooking/DESIGN.md §3 rule 16).
//
// This module is pure and dependency-free — no database, network, framework,
// or recipe-module imports — so the same analyzer runs in planner day
// expansion and in a Cooking Session without either owning the semantics.
//
// Two hard rules shape the design:
//
// 1. Canonical recipes are never touched. The analyzer reads a component's
//    ingredients/method and returns *findings* plus *suggested session
//    adjustments*. Every adjustment targets runtime/session state
//    (component status, a session note, tonight's seasoning) — there is no
//    adjustment shape that can express a canonical recipe edit.
// 2. Conservative over clever. These are ingredient/technique keyword
//    signals, not nutrition analysis and not culinary judgement. A finding
//    only fires when two components measurably collide, so a simple coherent
//    meal returns an empty review rather than generic advice.

export const MEAL_COHERENCE_VERSION = "meal-coherence-1";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type MealComponentRole =
  | "main"
  | "starter"
  | "side"
  | "dessert"
  | "serve-with"
  | "condiment";

/** Lifecycle mirror of live-cooking's component status. */
export type MealComponentStatus = "active" | "optional" | "deferred" | "omitted";

/**
 * A read-only projection of whatever a component actually is — a stored
 * recipe, an imported web recipe, a session dish, or a free-text serve-with
 * line. Nothing here is written back.
 */
export type MealComponent = {
  id: string;
  title: string;
  role: MealComponentRole;
  /** Ingredient item names. Amounts/units are ignored by the analyzer. */
  ingredients?: { item?: string | null }[];
  method?: string[];
  /**
   * Free-text description of tonight's version ("adult gochujang glaze, mild
   * soy-sesame for the kids"). Treated as a weak signal alongside method
   * text — often the only signal an ad-hoc main has.
   */
  notes?: string[];
  /** Total minutes, when the source has trustworthy time metadata. */
  timeMinutes?: number | null;
  /** Defaults to "active". Non-active components are not part of tonight's plate. */
  status?: MealComponentStatus;
};

export type MealInput = {
  main: MealComponent;
  /** Starters, sides, desserts, condiments — anything cooked alongside. */
  components?: MealComponent[];
  /** Free-text table additions ("Steamed rice", "Flatbreads"). */
  serveWith?: string[];
  dayType?: "weekday" | "weekend";
};

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type CoherenceSeverity = "info" | "minor" | "major";

export type CoherenceFindingKind =
  | "seasoning-lane-repeat"
  | "acid-repeat"
  | "sweetness-repeat"
  | "richness-repeat"
  | "starch-repeat"
  | "protein-repeat"
  | "fried-repeat"
  | "redundant-effort"
  | "missing-contrast"
  | "no-temperature-contrast"
  | "execution-pressure"
  | "appliance-contention";

export type CoherenceFinding = {
  kind: CoherenceFindingKind;
  severity: CoherenceSeverity;
  /** Lane/axis identifier when the finding is about a shared element. */
  lane?: string;
  /** One plain sentence, safe to show to a cook. */
  summary: string;
  /** Components involved, in stable meal order. */
  componentIds: string[];
  /** The component that should keep carrying this lane, when one applies. */
  ownerId?: string;
};

/**
 * A change to runtime/session state. There is deliberately no variant that
 * edits a canonical recipe — rebalancing happens tonight, in the session.
 */
export type CoherenceAdjustment =
  | { target: "component-status"; componentId: string; status: MealComponentStatus }
  | { target: "seasoning"; componentId: string; replace: string; with: string }
  | { target: "session-note"; text: string };

export type CoherenceSuggestionKind =
  | "reseason"
  /** Set a component aside for tonight — see the adjustment for which status. */
  | "make-optional"
  | "add-contrast";

export type CoherenceSuggestion = {
  kind: CoherenceSuggestionKind;
  /** Null when the suggestion adds something rather than changing a component. */
  componentId: string | null;
  componentTitle: string | null;
  summary: string;
  adjustment: CoherenceAdjustment;
};

export type LaneOwner = {
  lane: string;
  laneLabel: string;
  componentId: string;
  componentTitle: string;
};

export type MealCoherenceReview = {
  version: typeof MEAL_COHERENCE_VERSION;
  /** Highest finding severity, or "none" for a coherent meal. */
  severity: CoherenceSeverity | "none";
  findings: CoherenceFinding[];
  suggestions: CoherenceSuggestion[];
  /** Which component carries each dominant seasoning lane. */
  laneOwners: LaneOwner[];
  /** Components excluded because they were set aside, for transparency. */
  setAsideIds: string[];
};

// ---------------------------------------------------------------------------
// Signal tables
//
// Patterns run against ASCII-folded lowercase text, so they contain no
// accented characters. None carry the /g flag — a global regex is stateful
// across .test() calls and would make results order-dependent.
// ---------------------------------------------------------------------------

type Lane = {
  id: string;
  label: string;
  pattern: RegExp;
  /** What the non-owner should use instead. Null means "drop, don't reseason". */
  rebalance: string | null;
  /**
   * Severity when two components merely both contain the ingredient.
   *
   * The pungent lanes are "major" outright: a second soy or fish-sauce
   * dressing flattens the plate even in small amounts, and that is the
   * failure this analyzer was built for. Cheese and cured meat are ordinary
   * larder ingredients — parmesan on the pasta and feta in the salad is
   * normal cooking, so they start at "minor" and only escalate when the lane
   * is a defining feature of more than one dish (see LANE_ESCALATION_STRENGTH).
   */
  severity: CoherenceSeverity;
};

/**
 * A component "leads" with a lane when it names it in the title or lists it
 * more than once. Two leading components turn a minor lane repeat into a
 * major one.
 */
const LANE_ESCALATION_STRENGTH = 2;

/**
 * High-impact seasoning lanes. Two components pulling on the same lane is the
 * failure this analyzer exists for: the meal reads as one loud note instead
 * of a plate.
 */
const SEASONING_LANES: Lane[] = [
  {
    id: "soy",
    label: "soy",
    // Explicit forms only, so soy milk and soybeans do not register.
    pattern: /\b(soy sauce|soya sauce|light soy|dark soy|tamari|shoyu|kecap manis|ponzu)\b/,
    rebalance: "lime, sesame oil and salt",
    severity: "major",
  },
  {
    id: "fish-sauce",
    label: "fish sauce",
    pattern: /\b(fish sauce|nam pla|nuoc mam|patis|colatura)\b/,
    rebalance: "lime, salt and a pinch of sugar",
    severity: "major",
  },
  {
    id: "miso",
    label: "miso/doenjang",
    pattern: /\b(miso|doenjang|ssamjang|black bean sauce|douchi)\b/,
    rebalance: "lemon, olive oil and salt",
    severity: "major",
  },
  {
    id: "gochujang",
    label: "gochujang",
    pattern: /\b(gochujang|korean chilli paste|korean chili paste)\b/,
    rebalance: "rice vinegar, sesame oil and a pinch of salt",
    severity: "major",
  },
  {
    id: "ferment",
    label: "kimchi/ferments",
    pattern: /\b(kimchi|sauerkraut|fermented (?:cabbage|vegetables|chilli|chili)|tsukemono|curtido)\b/,
    rebalance: null,
    severity: "major",
  },
  {
    id: "bouillon",
    label: "concentrated bouillon",
    // Concentrated umami boosters only — plain stock in one dish is normal.
    pattern: /\b(bouillon|stock cube|stock powder|marmite|vegeta|knorr|dashi|msg|monosodium glutamate)\b/,
    rebalance: "water plus aromatics, seasoned at the end",
    severity: "major",
  },
  {
    id: "cheese",
    label: "cheese",
    pattern:
      /\b(cheese|parmesan|parmigiano|pecorino|cheddar|gruyere|feta|mozzarella|halloumi|manchego|comte|taleggio|gorgonzola|mascarpone|ricotta|burrata|emmental|raclette|chevre)\b/,
    rebalance: "lemon zest, olive oil and toasted nuts",
    severity: "minor",
  },
  {
    id: "cured-meat",
    label: "cured meat",
    pattern:
      /\b(bacon|pancetta|guanciale|chorizo|prosciutto|serrano ham|parma ham|lardons|salami|speck|nduja|anchovy|anchovies|coppa|soppressata)\b/,
    rebalance: "olives or toasted nuts for salt and depth",
    severity: "minor",
  },
];

/** Composition axes: duplication is a smaller problem than a seasoning clash. */
const ACID_PATTERN =
  /\b(lemon|lime|vinegar|tamarind|sumac|verjus|pomegranate molasses|yuzu|amchur|kokum|kimchi|pickled|pickles)\b/;
const SWEET_PATTERN =
  /\b(sugar|honey|maple syrup|mirin|molasses|agave|palm sugar|jaggery|date syrup|golden syrup|condensed milk)\b/;
// Butter is deliberately absent: it appears in almost every recipe, so it
// would fire on nearly any pair of components.
const RICH_PATTERN =
  /\b(double cream|single cream|heavy cream|whipping cream|creme fraiche|sour cream|clotted cream|cream|coconut milk|coconut cream|mascarpone|tahini|mayonnaise|aioli|ghee)\b/;
const STARCH_PATTERN =
  /\b(rice(?!\s*(?:vinegar|wine))|noodle|noodles|pasta|spaghetti|linguine|penne|orzo|potato|potatoes|bread|flatbread|tortilla|couscous|bulgur|polenta|quinoa|naan|pita|baguette|gnocchi|dumpling|udon|soba|pancake|plain flour|all-purpose flour)\b/;
const PROTEIN_PATTERN =
  /\b(chicken(?!\s*(?:stock|broth|bouillon))|beef|pork|lamb|duck|turkey|tofu|tempeh|paneer|seitan|salmon|cod|tuna|mackerel|prawn|prawns|shrimp|shrimps|squid|chickpea|chickpeas|lentil|lentils|black beans|kidney beans|cannellini beans|butter beans|borlotti beans|egg|eggs)\b/;

/**
 * Frying as execution load. Stir-frying is excluded: a wok pass is ordinary
 * weeknight cooking, not the pan-and-oil contention this flags.
 */
const FRIED_PATTERN =
  /\b(deep[- ]fr(?:y|ied|ying)|shallow[- ]fr(?:y|ied|ying)|pan[- ]fr(?:y|ied|ying)|fried|fritter|fritters|tempura|croquette|croquettes|schnitzel|latke|pancake|pancakes|batter|breadcrumb|panko|fry until golden|fry in batches)\b/;
const STIR_FRY_PATTERN = /\bstir[- ]fr(?:y|ied|ying)\b/;

const OVEN_PATTERN = /\b(oven|bake|baked|baking|roast|roasted|roasting|grill under|broil)\b/;
const HOB_PATTERN =
  /\b(saucepan|frying pan|skillet|wok|large pan|over (?:a )?(?:medium|high|low) heat|simmer|boil|saute|sear)\b/;

/** Freshness and crunch: what a heavy plate is usually missing. */
const FRESH_PATTERN =
  /\b(raw|fresh herbs|mint|coriander|cilantro|parsley|dill|basil|chives|lettuce|rocket|arugula|salad|cucumber|radish|radishes|bean sprouts|sprouts|spring onion|spring onions|scallion|scallions|watercress|zest|herb salad)\b/;
const CRUNCH_PATTERN =
  /\b(cucumber|radish|radishes|bean sprouts|sprouts|cabbage|slaw|nuts|peanuts|almonds|cashews|walnuts|sesame seeds|seeds|pickles|pickled|kimchi|crunchy|crisp|croutons|celery|fennel|apple)\b/;
const COLD_PATTERN =
  /\b(salad|slaw|chilled|cold|raw|pickled|pickles|kimchi|dressing|dip|yogurt|yoghurt|labneh|raita|tzatziki|sorbet|ice cream)\b/;
const HOT_PATTERN =
  /\b(roast|roasted|bake|baked|fry|fried|simmer|simmered|boil|boiled|steam|steamed|grill|grilled|braise|braised|stew|hot|warm through|saute|sear)\b/;

const ROLE_PRIORITY: Record<MealComponentRole, number> = {
  main: 0,
  side: 1,
  starter: 2,
  dessert: 3,
  "serve-with": 4,
  condiment: 5,
};

const SEVERITY_RANK: Record<CoherenceSeverity, number> = {
  info: 1,
  minor: 2,
  major: 3,
};

// ---------------------------------------------------------------------------
// Text preparation
// ---------------------------------------------------------------------------

function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2019\u0027]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

type PreparedComponent = {
  source: MealComponent;
  id: string;
  title: string;
  role: MealComponentRole;
  status: MealComponentStatus;
  index: number;
  /** Folded title. */
  titleText: string;
  /** Folded ingredient item names, one entry per ingredient. */
  ingredientItems: string[];
  /** Folded ingredient items joined, for whole-list matching. */
  ingredientText: string;
  /** Folded method text. */
  methodText: string;
  /** Title + ingredients + method, for presence-style checks. */
  allText: string;
  timeMinutes: number | null;
};

function prepare(component: MealComponent, index: number): PreparedComponent {
  const titleText = fold(component.title ?? "");
  const ingredientItems = (component.ingredients ?? [])
    .map((i) => fold(i?.item ?? ""))
    .filter((t) => t.length > 0);
  const ingredientText = ingredientItems.join(" | ");
  const methodText = fold(
    [...(component.method ?? []), ...(component.notes ?? [])].join(" ")
  );
  return {
    source: component,
    id: component.id,
    title: component.title,
    role: component.role,
    status: component.status ?? "active",
    index,
    titleText,
    ingredientItems,
    ingredientText,
    methodText,
    allText: [titleText, ingredientText, methodText].join(" | "),
    timeMinutes:
      typeof component.timeMinutes === "number" && isFinite(component.timeMinutes)
        ? component.timeMinutes
        : null,
  };
}

/**
 * Seasoning/composition strength. Ingredient entries are the trustworthy
 * signal; the title counts once; method text alone is not enough to claim a
 * component carries a lane (a recipe that says "serve with soy sauce on the
 * side" is not a soy dish).
 */
function laneStrength(c: PreparedComponent, pattern: RegExp): number {
  let strength = 0;
  if (pattern.test(c.titleText)) strength += 1;
  for (const item of c.ingredientItems) {
    if (pattern.test(item)) strength += 1;
  }
  // Serve-with lines have no ingredient list, so the title is all there is.
  if (strength === 0 && c.ingredientItems.length === 0 && pattern.test(c.methodText)) {
    strength += 1;
  }
  return strength;
}

/** Technique presence is a method-and-title signal, not an ingredient one. */
function hasTechnique(c: PreparedComponent, pattern: RegExp): boolean {
  return pattern.test(c.titleText) || pattern.test(c.methodText);
}

function isFried(c: PreparedComponent): boolean {
  if (!hasTechnique(c, FRIED_PATTERN)) return false;
  // A stir-fry that matched only through a generic "fry" form is not the
  // deep/shallow pan work this measures.
  const friedOnlyViaStirFry =
    STIR_FRY_PATTERN.test(c.methodText) &&
    !/\b(deep[- ]fr|shallow[- ]fr|pan[- ]fr|fritter|tempura|croquette|schnitzel|latke|pancake|batter|panko)\b/.test(
      c.allText
    );
  return !friedOnlyViaStirFry;
}

// ---------------------------------------------------------------------------
// Ordering helpers (all deterministic)
// ---------------------------------------------------------------------------

/**
 * Who should keep a lane: the most central dish wins on role, then the
 * strongest signal, then meal order. Never alphabetical or random — the same
 * meal must always produce the same owner.
 */
function pickOwner(
  candidates: { component: PreparedComponent; strength: number }[]
): PreparedComponent {
  const sorted = [...candidates].sort((a, b) => {
    const roleDiff = ROLE_PRIORITY[a.component.role] - ROLE_PRIORITY[b.component.role];
    if (roleDiff !== 0) return roleDiff;
    if (b.strength !== a.strength) return b.strength - a.strength;
    return a.component.index - b.component.index;
  });
  return sorted[0].component;
}

function byMealOrder(a: PreparedComponent, b: PreparedComponent): number {
  return a.index - b.index;
}

function joinTitles(components: PreparedComponent[]): string {
  const titles = components.map((c) => c.title);
  if (titles.length <= 1) return titles[0] ?? "";
  return titles.slice(0, -1).join(", ") + " and " + titles[titles.length - 1];
}

// ---------------------------------------------------------------------------
// Analyzer
// ---------------------------------------------------------------------------

export function analyzeMealCoherence(meal: MealInput): MealCoherenceReview {
  const serveWithComponents: MealComponent[] = (meal.serveWith ?? [])
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .map((text) => ({
      id: `serve-with:${fold(text).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      title: text,
      role: "serve-with" as const,
    }));

  const all = [meal.main, ...(meal.components ?? []), ...serveWithComponents].map(prepare);
  const active = all.filter((c) => c.status === "active");
  const setAsideIds = all.filter((c) => c.status !== "active").map((c) => c.id);

  const findings: CoherenceFinding[] = [];
  const suggestions: CoherenceSuggestion[] = [];
  const laneOwners: LaneOwner[] = [];

  // A single dish cannot collide with anything. Return early rather than
  // inventing advice about a meal that has not been assembled yet.
  if (active.length < 2) {
    return {
      version: MEAL_COHERENCE_VERSION,
      severity: "none",
      findings,
      suggestions,
      laneOwners,
      setAsideIds,
    };
  }

  // ----- 1. repeated strong seasoning lanes -----

  /** componentId -> lane ids it already lost, so we suggest one change per lane. */
  const rebalanced = new Set<string>();

  for (const lane of SEASONING_LANES) {
    const carriers = active
      .map((component) => ({ component, strength: laneStrength(component, lane.pattern) }))
      .filter((entry) => entry.strength > 0);
    if (carriers.length === 0) continue;

    const owner = pickOwner(carriers);
    laneOwners.push({
      lane: lane.id,
      laneLabel: lane.label,
      componentId: owner.id,
      componentTitle: owner.title,
    });

    if (carriers.length < 2) continue;

    const others = carriers
      .map((entry) => entry.component)
      .filter((component) => component.id !== owner.id)
      .sort(byMealOrder);

    // An everyday larder lane only becomes major when it is a defining
    // feature of more than one dish — a gruyere gratin next to cheddar
    // croquettes, not parmesan on the pasta next to feta in the salad.
    const leadingCarriers = carriers.filter(
      (entry) => entry.strength >= LANE_ESCALATION_STRENGTH
    ).length;
    const severity: CoherenceSeverity =
      lane.severity === "major" || leadingCarriers >= 2 ? "major" : lane.severity;

    findings.push({
      kind: "seasoning-lane-repeat",
      severity,
      lane: lane.id,
      summary: `${lane.label} appears in ${joinTitles(
        carriers.map((entry) => entry.component).sort(byMealOrder)
      )}. Let ${owner.title} own it.`,
      componentIds: carriers.map((entry) => entry.component.id).sort(),
      ownerId: owner.id,
    });

    for (const other of others) {
      if (lane.rebalance) {
        const key = `${other.id}::reseason`;
        if (rebalanced.has(key)) continue;
        rebalanced.add(key);
        suggestions.push({
          kind: "reseason",
          componentId: other.id,
          componentTitle: other.title,
          summary: `Season ${other.title} with ${lane.rebalance} instead of ${lane.label}, so ${owner.title} carries the ${lane.label} lane.`,
          adjustment: {
            target: "seasoning",
            componentId: other.id,
            replace: lane.label,
            with: lane.rebalance,
          },
        });
      }
    }
  }

  laneOwners.sort((a, b) => (a.lane < b.lane ? -1 : a.lane > b.lane ? 1 : 0));

  // ----- 2. duplicated composition axes -----

  const axes: {
    kind: CoherenceFindingKind;
    lane: string;
    label: string;
    pattern: RegExp;
    severity: CoherenceSeverity;
    /** Roles where duplication is expected rather than a problem. */
    ignoreRoles?: MealComponentRole[];
  }[] = [
    { kind: "acid-repeat", lane: "acid", label: "Sharp acidity", pattern: ACID_PATTERN, severity: "minor" },
    {
      kind: "sweetness-repeat",
      lane: "sweetness",
      label: "Added sweetness",
      pattern: SWEET_PATTERN,
      severity: "minor",
      ignoreRoles: ["dessert"],
    },
    { kind: "richness-repeat", lane: "richness", label: "Cream/richness", pattern: RICH_PATTERN, severity: "minor" },
    { kind: "starch-repeat", lane: "starch", label: "Starch", pattern: STARCH_PATTERN, severity: "minor" },
    { kind: "protein-repeat", lane: "protein", label: "Substantial protein", pattern: PROTEIN_PATTERN, severity: "minor" },
  ];

  for (const axis of axes) {
    const pool = axis.ignoreRoles
      ? active.filter((c) => !axis.ignoreRoles!.includes(c.role))
      : active;
    const carriers = pool.filter((c) => laneStrength(c, axis.pattern) > 0).sort(byMealOrder);
    if (carriers.length < 2) continue;
    findings.push({
      kind: axis.kind,
      severity: axis.severity,
      lane: axis.lane,
      summary: `${axis.label} is duplicated across ${joinTitles(carriers)}.`,
      componentIds: carriers.map((c) => c.id).sort(),
    });
  }

  // ----- 3. fried elements and execution pressure -----

  const fried = active.filter(isFried).sort(byMealOrder);
  if (fried.length >= 2) {
    findings.push({
      kind: "fried-repeat",
      severity: fried.length >= 3 ? "major" : "minor",
      lane: "fried",
      summary: `${joinTitles(fried)} are all fried — that is repeated texture and repeated pan work.`,
      componentIds: fried.map((c) => c.id).sort(),
    });
    findings.push({
      kind: "execution-pressure",
      severity: fried.length >= 3 ? "major" : "minor",
      summary: `${fried.length} components need frying, which means oil, a pan, and attention at the same time.`,
      componentIds: fried.map((c) => c.id).sort(),
    });
  }

  // ----- 4. redundant effort: a fried/starchy dish that adds nothing new -----
  //
  // The kimchi-pancake case. A component is redundant when a simpler active
  // component already carries its seasoning lane and the redundant one costs
  // frying or extra starch on top.

  const droppable = new Set<string>();
  for (const lane of SEASONING_LANES) {
    const carriers = active
      .map((component) => ({ component, strength: laneStrength(component, lane.pattern) }))
      .filter((entry) => entry.strength > 0);
    if (carriers.length < 2) continue;
    const owner = pickOwner(carriers);
    for (const { component } of carriers) {
      if (component.id === owner.id) continue;
      if (component.role === "main") continue;
      const costsWork = isFried(component) || laneStrength(component, STARCH_PATTERN) > 0;
      if (!costsWork) continue;
      // A component that supplies contrast nobody else does earns its place.
      const suppliesUniqueContrast =
        (CRUNCH_PATTERN.test(component.allText) || FRESH_PATTERN.test(component.allText)) &&
        !isFried(component);
      if (suppliesUniqueContrast) continue;
      droppable.add(component.id);
    }
  }

  for (const component of active.filter((c) => droppable.has(c.id)).sort(byMealOrder)) {
    findings.push({
      kind: "redundant-effort",
      severity: "minor",
      summary: `${component.title} repeats flavours the meal already has and adds fried/starchy work.`,
      componentIds: [component.id],
    });
    // Omitted, not optional: the analyzer has identified a specific component
    // whose lane is already owned by something simpler, and it only adds
    // fried/starchy work on top — the kimchi-pancake case. Kitchen's fixture
    // (`projects/kitchen/DESIGN.md` §4.3) and Live Cooking rule 16 both say the
    // redundant dish is left off tonight. `optional` stays for the less certain
    // set-aside below, where the only signal is a second fried component.
    suggestions.push({
      kind: "make-optional",
      componentId: component.id,
      componentTitle: component.title,
      summary: `Skip ${component.title} tonight — the meal is already covered without it.`,
      adjustment: {
        target: "component-status",
        componentId: component.id,
        status: "omitted",
      },
    });
  }

  // A second fried component that was not already flagged as redundant is
  // still worth offering to set aside.
  if (fried.length >= 2) {
    const lowestPriorityFried = [...fried].sort((a, b) => {
      const roleDiff = ROLE_PRIORITY[b.role] - ROLE_PRIORITY[a.role];
      if (roleDiff !== 0) return roleDiff;
      return b.index - a.index;
    })[0];
    if (lowestPriorityFried.role !== "main" && !droppable.has(lowestPriorityFried.id)) {
      suggestions.push({
        kind: "make-optional",
        componentId: lowestPriorityFried.id,
        componentTitle: lowestPriorityFried.title,
        summary: `Two fried components is a lot of pan work — make ${lowestPriorityFried.title} optional.`,
        adjustment: {
          target: "component-status",
          componentId: lowestPriorityFried.id,
          status: "optional",
        },
      });
    }
  }

  // ----- 5. contrast: freshness, crunch, temperature -----
  //
  // Only meaningful once the plate is actually heavy. A light meal that
  // happens to lack crunch is not a problem worth a warning.

  const remaining = active.filter((c) => !droppable.has(c.id));
  const contrastPool = remaining.length >= 2 ? remaining : active;

  // A fried component's own crispness is not the contrast a rich plate needs
  // — that crunch arrives in oil, not freshness. Only unfried components count.
  const providesFresh = contrastPool.filter((c) => FRESH_PATTERN.test(c.allText) && !isFried(c));
  const providesCrunch = contrastPool.filter((c) => CRUNCH_PATTERN.test(c.allText) && !isFried(c));
  const richCount = contrastPool.filter((c) => laneStrength(c, RICH_PATTERN) > 0).length;
  const starchCount = contrastPool.filter((c) => laneStrength(c, STARCH_PATTERN) > 0).length;
  const friedCount = contrastPool.filter(isFried).length;
  const plateIsHeavy = friedCount >= 1 || richCount >= 2 || starchCount >= 2;

  if (plateIsHeavy && providesFresh.length === 0 && providesCrunch.length === 0) {
    findings.push({
      kind: "missing-contrast",
      severity: "minor",
      summary:
        "Nothing on this plate is fresh or crunchy — it is all soft, rich, or fried.",
      componentIds: contrastPool.map((c) => c.id).sort(),
    });
    suggestions.push({
      kind: "add-contrast",
      componentId: null,
      componentTitle: null,
      summary:
        "Add one raw, sharp element — a herb salad, quick-pickled cucumber, or sliced radish with salt and lemon.",
      adjustment: {
        target: "session-note",
        text: "Add a raw, sharp side for contrast (herb salad, quick pickle, or radish with salt and lemon).",
      },
    });
  }

  const cold = contrastPool.filter(
    (c) => COLD_PATTERN.test(c.titleText) || COLD_PATTERN.test(c.allText)
  );
  const hot = contrastPool.filter((c) => HOT_PATTERN.test(c.allText));
  if (contrastPool.length >= 3 && cold.length === 0 && hot.length === contrastPool.length) {
    findings.push({
      kind: "no-temperature-contrast",
      severity: "info",
      summary: "Every component is served hot; one cold or room-temperature dish would lift the meal.",
      componentIds: contrastPool.map((c) => c.id).sort(),
    });
  }

  // ----- 6. appliance contention and total work -----

  const ovenUsers = remaining.filter((c) => hasTechnique(c, OVEN_PATTERN));
  const hobUsers = remaining.filter((c) => hasTechnique(c, HOB_PATTERN));
  if (ovenUsers.length >= 3) {
    findings.push({
      kind: "appliance-contention",
      severity: "minor",
      summary: `${ovenUsers.length} components need the oven — they cannot all sit at their own temperature.`,
      componentIds: ovenUsers.map((c) => c.id).sort(),
    });
  } else if (hobUsers.length >= 4) {
    findings.push({
      kind: "appliance-contention",
      severity: "info",
      summary: `${hobUsers.length} components need hob time at once.`,
      componentIds: hobUsers.map((c) => c.id).sort(),
    });
  }

  // Only judge total work when every remaining component reports its time —
  // a partial sum would understate the meal and produce misleading advice.
  const timed = remaining.filter((c) => c.timeMinutes !== null);
  if (timed.length === remaining.length && remaining.length >= 2) {
    const total = timed.reduce((sum, c) => sum + (c.timeMinutes ?? 0), 0);
    const budget = meal.dayType === "weekend" ? 210 : 120;
    if (total > budget) {
      findings.push({
        kind: "execution-pressure",
        // A long total is a scheduling heads-up, never a blocking problem:
        // recipe totals include unattended braising and resting, and a slow
        // roast next to a quick side is ordinary cooking.
        severity: "minor",
        summary: `About ${total} minutes of cooking across ${remaining.length} components${
          meal.dayType === "weekend" ? "" : " on a weeknight"
        }.`,
        componentIds: remaining.map((c) => c.id).sort(),
      });
    }
  }

  const severity = findings.reduce<CoherenceSeverity | "none">((worst, finding) => {
    if (worst === "none") return finding.severity;
    return SEVERITY_RANK[finding.severity] > SEVERITY_RANK[worst] ? finding.severity : worst;
  }, "none");

  return {
    version: MEAL_COHERENCE_VERSION,
    severity,
    findings,
    suggestions,
    laneOwners,
    setAsideIds,
  };
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

/**
 * Minimal structural shape of a recipe. Declared here rather than imported so
 * this module stays dependency-free; `Recipe` from ./recipes satisfies it.
 */
export type RecipeLike = {
  id: string;
  name: string;
  ingredients?: { item?: string | null }[];
  method?: string[];
  time?: { prep?: number; cook?: number; total?: number } | null;
};

function recipeMinutes(time: RecipeLike["time"]): number | null {
  if (!time) return null;
  const total = typeof time.total === "number" && isFinite(time.total) ? time.total : 0;
  if (total > 0) return total;
  const prep = typeof time.prep === "number" && isFinite(time.prep) ? time.prep : 0;
  const cook = typeof time.cook === "number" && isFinite(time.cook) ? time.cook : 0;
  return prep + cook > 0 ? prep + cook : null;
}

/** Read-only projection of a recipe into a meal component. Never mutates. */
export function recipeToMealComponent(
  recipe: RecipeLike,
  role: MealComponentRole,
  overrides: { status?: MealComponentStatus; title?: string } = {}
): MealComponent {
  return {
    id: recipe.id,
    title: overrides.title ?? recipe.name,
    role,
    ingredients: (recipe.ingredients ?? []).map((i) => ({ item: i?.item ?? "" })),
    method: recipe.method ?? [],
    timeMinutes: recipeMinutes(recipe.time),
    ...(overrides.status ? { status: overrides.status } : {}),
  };
}

/** True when the review contains something worth interrupting the cook for. */
export function hasBlockingFinding(review: MealCoherenceReview): boolean {
  return review.severity === "major";
}

// ---------------------------------------------------------------------------
// Coherent set selection
//
// The planner scores each complement candidate against the main on its own, so
// two independently sensible sides can land on the same soy dressing or the
// same fryer. This step assembles the *recommended* set as a meal: each role is
// filled against the plate built so far, not against the main in isolation.
//
// Conservative by construction:
//
// - only a candidate that introduces a new `major` conflict is passed over,
//   so ordinary minor overlap never overrides the domain ranking;
// - candidates are tried in the order Kitchen ranked them, so the top pick
//   still wins whenever it fits;
// - a role that has candidates always gets one. If every candidate conflicts,
//   the least-bad one is kept and its conflicts are exposed rather than
//   returning a meal with a hole in it.
// ---------------------------------------------------------------------------

export type MealSetRole = "starter" | "side" | "dessert";

/**
 * Roles are filled most-central-first, mirroring ROLE_PRIORITY: the side sits
 * next to the main on the plate, so it gets first refusal, and the starter and
 * dessert fit around what is already there.
 */
const MEAL_SET_ROLE_ORDER: MealSetRole[] = ["side", "starter", "dessert"];

export type MealSetCandidate = {
  role: MealSetRole;
  /** Ranked position is the array order; the analyzer never re-ranks. */
  component: MealComponent;
};

export type MealSetInput = {
  main: MealComponent;
  /** Ranked candidates per role, best first, exactly as Kitchen ordered them. */
  candidates: MealSetCandidate[];
  /**
   * Components already on the plate (accepted sides, etc). They constrain the
   * selection but are never re-picked and never appear in `selected`.
   */
  assembled?: MealComponent[];
  serveWith?: string[];
  dayType?: "weekday" | "weekend";
};

export type MealSetRejection = {
  componentId: string;
  componentTitle: string;
  /** The major conflict this candidate would have introduced. */
  summary: string;
};

export type MealSetDecision = {
  role: MealSetRole;
  componentId: string;
  componentTitle: string;
  /**
   * `clear` — the pick introduces no major conflict with the assembled plate.
   * `least-bad` — every candidate for the role conflicted; this one conflicts
   * least, and `conflicts` says how.
   */
  outcome: "clear" | "least-bad";
  /** Candidates passed over ahead of this one, in rank order. */
  rejected: MealSetRejection[];
  /** Major findings the pick still carries. Empty when `outcome` is `clear`. */
  conflicts: CoherenceFinding[];
};

export type CoherentMealSet = {
  version: typeof MEAL_COHERENCE_VERSION;
  /** One pick per role that had candidates, in assembly order. */
  selected: { role: MealSetRole; componentId: string; componentTitle: string }[];
  decisions: MealSetDecision[];
  /** Review of the main plus already-assembled components plus the picks. */
  review: MealCoherenceReview;
};

/**
 * Assemble the recommended starter/side/(weekend) dessert set as one meal.
 *
 * Pure and deterministic: same input, same picks. Nothing here mutates the
 * candidates, and the result carries ids only — rationales, scores, and images
 * stay with the caller's own candidate records.
 */
export function selectCoherentMealSet(input: MealSetInput): CoherentMealSet {
  const assembled: MealComponent[] = [...(input.assembled ?? [])];
  const onPlate = new Set(assembled.map((c) => c.id));
  const selected: CoherentMealSet["selected"] = [];
  const decisions: MealSetDecision[] = [];

  for (const role of MEAL_SET_ROLE_ORDER) {
    const pool = input.candidates
      .filter((c) => c.role === role && !onPlate.has(c.component.id))
      // A component's role is the analyzer's centrality signal, so the
      // candidate is projected into the role it is being considered for.
      .map((c) => ({ ...c.component, role: role as MealComponentRole }));
    if (pool.length === 0) continue;

    const attempts = pool.map((component) => {
      const review = analyzeMealCoherence({
        main: input.main,
        components: [...assembled, component],
        serveWith: input.serveWith,
        dayType: input.dayType,
      });
      // Only findings that name this candidate are its fault. A conflict that
      // already existed between the main and the saved plate is not a reason
      // to reject an otherwise good side.
      const blamed = review.findings.filter((f) => f.componentIds.includes(component.id));
      return {
        component,
        major: blamed.filter((f) => f.severity === "major"),
        minorCount: blamed.filter((f) => f.severity === "minor").length,
      };
    });

    let chosenIndex = attempts.findIndex((a) => a.major.length === 0);
    if (chosenIndex === -1) {
      // Every candidate conflicts — keep the least-bad rather than dropping
      // the role. Ties fall back to Kitchen's ranking.
      chosenIndex = attempts.reduce((best, a, i) => {
        const b = attempts[best];
        if (a.major.length !== b.major.length) return a.major.length < b.major.length ? i : best;
        if (a.minorCount !== b.minorCount) return a.minorCount < b.minorCount ? i : best;
        return best;
      }, 0);
    }

    const chosen = attempts[chosenIndex];
    const outcome: MealSetDecision["outcome"] =
      chosen.major.length === 0 ? "clear" : "least-bad";

    decisions.push({
      role,
      componentId: chosen.component.id,
      componentTitle: chosen.component.title,
      outcome,
      rejected: attempts.slice(0, chosenIndex).map((a) => ({
        componentId: a.component.id,
        componentTitle: a.component.title,
        summary: a.major[0]?.summary ?? "",
      })),
      conflicts: chosen.major,
    });
    selected.push({
      role,
      componentId: chosen.component.id,
      componentTitle: chosen.component.title,
    });
    assembled.push(chosen.component);
    onPlate.add(chosen.component.id);
  }

  return {
    version: MEAL_COHERENCE_VERSION,
    selected,
    decisions,
    review: analyzeMealCoherence({
      main: input.main,
      components: assembled,
      serveWith: input.serveWith,
      dayType: input.dayType,
    }),
  };
}
