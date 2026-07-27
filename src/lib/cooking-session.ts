// Cooking Session contract: types, normalization, patch application,
// plan-resync merging, and display resolution.
//
// This module is pure — no database, network, or framework imports — so the
// session semantics defined by projects/live-cooking/DESIGN.md stay testable
// in isolation. Persistence and plan loading live in ./cooking.ts.
//
// Contract rules implemented here (see live-cooking DESIGN.md §3/§4):
// - The anchor's base ingredients/method are the original recipe and are
//   never rewritten by session activity; current-cook changes live in the
//   `session` lists, `main`, `heroImage`, and related-recipe statuses.
// - An explicit `main` names tonight's main dish even when the session was
//   anchored on another dish. Resolution is field-based only — no keyword
//   guessing from ingredient or serve-with text.
// - Plan resync preserves session-local truth: explicit main, hero image,
//   and non-active component statuses survive a resync.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AnchorType =
  | "kitchen-recipe"
  | "my-recipe"
  | "external-recipe"
  | "synthesized-plan";

export type Anchor = {
  type: AnchorType;
  recipeId?: string;
  title: string;
  provenance: {
    source: string; // e.g. "kitchen", "My Recipes", "Serious Eats"
    url?: string;
    author?: string;
  };
};

export type SessionStatus = "draft" | "active" | "completed" | "abandoned";

export type AdaptationKind =
  | "servings"
  | "ingredient-substitution"
  | "ingredient-omission"
  | "time-shortcut"
  | "guest-scaling"
  | "technique-upgrade"
  | "plating-finish"
  | "wine-pairing"
  | "rescue-fix";

export type Adaptation = {
  id: string;
  kind: AdaptationKind;
  summary: string;
  messageSource?: string; // "telegram" | "app"
  createdAt: string;
};

export type CoachCards = {
  nextMove: string | null;
  upgrade: string | null;
  shortcut: string | null;
  wine: string | null;
};

export type SessionStory = {
  title?: string;
  text: string;
  source?: string | null;
  updatedAt?: string;
};

export type SessionIngredient = {
  amount: string;
  item: string;
  unit?: string;
  group?: string | null;
};

/** Lifecycle of a meal component within tonight's session. */
export type ComponentStatus = "active" | "optional" | "deferred" | "omitted";

export type RelatedRecipe = {
  kind: "starter" | "side" | "dessert";
  recipeId: string;
  title: string;
  /** Absent means "active". Non-active components are not cooked tonight. */
  status?: ComponentStatus;
};

/**
 * Explicit main dish for tonight. When set, this — not the anchor — is what
 * the session renders and reports as the main, even if the session was
 * created from another anchor recipe.
 */
export type SessionMain = {
  title: string;
  /** Set when the main resolves to a stored recipe. */
  recipeId?: string;
  /** One short line, e.g. "700 g; adult gochujang glaze, mild for the kids". */
  summary?: string;
  setBy?: "meal-plan" | "telegram" | "app";
};

/**
 * Session-scoped hero image for mains that do not resolve to a stored
 * recipe. When the main has a recipeId, the recipe's own image stays
 * canonical and this field is ignored.
 */
export type SessionHeroImage = {
  url: string;
  alt?: string;
  source?: string;
};

export type CookingSession = {
  id: string;
  date: string; // YYYY-MM-DD
  status: SessionStatus;
  source: "meal-plan" | "ad-hoc" | "telegram";
  mealPlanRef?: {
    week: string;
    day: string;
  } | null;
  anchor: Anchor;
  main?: SessionMain | null;
  heroImage?: SessionHeroImage | null;
  relatedRecipes: RelatedRecipe[];
  serveWith: string[]; // free-text: "Flatbreads", "Basmati rice", etc.
  servings: {
    base: string;
    current: string;
  };
  ingredients: {
    base: SessionIngredient[];
    session: SessionIngredient[];
  };
  method: {
    base: string[];
    session: string[];
  };
  adaptations: Adaptation[];
  coachCards: CoachCards;
  story?: SessionStory | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Serve-with classification (food vs drink)
// ---------------------------------------------------------------------------

const DRINK_SERVE_WITH_PATTERN =
  /\b(wine|riesling|sauvignon|gr[üu]ner|veltliner|chardonnay|albari[nñ]o|verdejo|chablis|ros[eé]|pinot|chianti|barbera|rioja|grenache|garnacha|sparkling|champagne|prosecco|cava|beer|lager|pilsner|ipa|cider|cocktail|mocktail|non[-\s]?alc(?:oholic)?|na\s+(?:wine|beer|riesling|sparkling)|sparkling water)\b/i;

export function isDrinkServeWith(item: string): boolean {
  return DRINK_SERVE_WITH_PATTERN.test(item);
}

export function splitServeWith(items: string[] | undefined): {
  food: string[];
  drinks: string[];
} {
  const food: string[] = [];
  const drinks: string[] = [];
  for (const item of items ?? []) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (isDrinkServeWith(trimmed)) {
      drinks.push(trimmed);
    } else {
      food.push(trimmed);
    }
  }
  return { food: mergeTextLists(food), drinks: mergeTextLists(drinks) };
}

export function drinkText(items: string[]): string | null {
  return items.length > 0 ? items.join(" + ") : null;
}

export function mergeTextLists(...lists: (string[] | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const list of lists) {
    for (const item of list ?? []) {
      const trimmed = item.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase().replace(/\s+/g, " ");
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(trimmed);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Normalization (applied to every session read)
// ---------------------------------------------------------------------------

export function extractBackstoryFromNotes(
  notes: string
): { story: SessionStory; notes: string } | null {
  const prefix = "Backstory:";
  const trimmed = notes.trim();
  if (!trimmed.toLowerCase().startsWith(prefix.toLowerCase())) return null;

  const afterPrefix = trimmed.slice(prefix.length).trim();
  const nextParagraphIndex = afterPrefix.indexOf("\n\n");
  const storyText = nextParagraphIndex === -1
    ? afterPrefix
    : afterPrefix.slice(0, nextParagraphIndex).trim();
  if (!storyText) return null;

  const remainingNotes = nextParagraphIndex === -1
    ? ""
    : afterPrefix.slice(nextParagraphIndex).trim();

  return { story: { text: storyText }, notes: remainingNotes };
}

export function normalizeSession(
  session: CookingSession | null
): CookingSession | null {
  if (!session) return null;
  const extracted = session.story ? null : extractBackstoryFromNotes(session.notes ?? "");
  const split = splitServeWith(session.serveWith);
  const migratedDrink = drinkText(split.drinks);
  return {
    ...session,
    main: session.main?.title?.trim() ? session.main : null,
    heroImage: session.heroImage?.url?.trim() ? session.heroImage : null,
    serveWith: split.food,
    coachCards: {
      ...session.coachCards,
      wine: session.coachCards?.wine ?? migratedDrink,
    },
    story: session.story ?? extracted?.story ?? null,
    notes: extracted ? extracted.notes : (session.notes ?? ""),
  };
}

// ---------------------------------------------------------------------------
// Patch (partial update) support
// ---------------------------------------------------------------------------

export type SessionPatch = {
  status?: SessionStatus;
  coachCards?: Partial<CoachCards>;
  story?: SessionStory | null;
  notes?: string;
  appendNotes?: string;
  adaptations?: Adaptation[];
  main?: SessionMain | null;
  heroImage?: SessionHeroImage | null;
  relatedRecipes?: RelatedRecipe[];
  serveWith?: string[];
  servings?: { current: string };
  ingredients?: { session: SessionIngredient[] };
  method?: { session: string[] };
};

const VALID_STATUSES: SessionStatus[] = [
  "draft",
  "active",
  "completed",
  "abandoned",
];

const VALID_ADAPTATION_KINDS: AdaptationKind[] = [
  "servings",
  "ingredient-substitution",
  "ingredient-omission",
  "time-shortcut",
  "guest-scaling",
  "technique-upgrade",
  "plating-finish",
  "wine-pairing",
  "rescue-fix",
];

const VALID_COMPONENT_STATUSES: ComponentStatus[] = [
  "active",
  "optional",
  "deferred",
  "omitted",
];

export function validatePatch(patch: SessionPatch): string | null {
  if (patch.status && !VALID_STATUSES.includes(patch.status)) {
    return `Invalid status: ${patch.status}`;
  }
  if (patch.adaptations) {
    for (const a of patch.adaptations) {
      if (!a.id || !a.kind || !a.summary) {
        return "Each adaptation needs id, kind, and summary";
      }
      if (!VALID_ADAPTATION_KINDS.includes(a.kind)) {
        return `Invalid adaptation kind: ${a.kind}`;
      }
    }
  }
  if (patch.coachCards) {
    const validKeys = ["nextMove", "upgrade", "shortcut", "wine"];
    for (const key of Object.keys(patch.coachCards)) {
      if (!validKeys.includes(key)) {
        return `Invalid coachCard key: ${key}`;
      }
    }
  }
  if (patch.story !== undefined && patch.story !== null) {
    if (typeof patch.story.text !== "string" || patch.story.text.trim().length === 0) {
      return "Story needs non-empty text";
    }
  }
  if (patch.main !== undefined && patch.main !== null) {
    if (typeof patch.main.title !== "string" || patch.main.title.trim().length === 0) {
      return "Main needs a non-empty title";
    }
  }
  if (patch.heroImage !== undefined && patch.heroImage !== null) {
    const url = patch.heroImage.url;
    if (typeof url !== "string" || !/^(https?:\/\/|\/)/.test(url.trim())) {
      return "Hero image needs an http(s) or root-relative url";
    }
  }
  if (patch.relatedRecipes) {
    for (const r of patch.relatedRecipes) {
      if (r.status && !VALID_COMPONENT_STATUSES.includes(r.status)) {
        return `Invalid component status: ${r.status}`;
      }
    }
  }
  return null;
}

export function applyPatch(
  session: CookingSession,
  patch: SessionPatch
): CookingSession {
  const updated = { ...session };

  if (patch.status) {
    updated.status = patch.status;
  }

  if (patch.coachCards) {
    updated.coachCards = { ...session.coachCards, ...patch.coachCards };
  }

  if (patch.story !== undefined) {
    updated.story = patch.story;
  }

  if (patch.notes !== undefined) {
    updated.notes = patch.notes;
  } else if (patch.appendNotes) {
    updated.notes = session.notes
      ? session.notes + "\n" + patch.appendNotes
      : patch.appendNotes;
  }

  if (patch.adaptations && patch.adaptations.length > 0) {
    updated.adaptations = [...session.adaptations, ...patch.adaptations];
  }

  if (patch.main !== undefined) {
    updated.main = patch.main;
  }

  if (patch.heroImage !== undefined) {
    updated.heroImage = patch.heroImage;
  }

  if (patch.relatedRecipes) {
    updated.relatedRecipes = patch.relatedRecipes;
  }

  if (patch.serveWith) {
    updated.serveWith = patch.serveWith;
  }

  if (patch.servings?.current) {
    updated.servings = { ...session.servings, current: patch.servings.current };
  }

  if (patch.ingredients?.session) {
    updated.ingredients = {
      base: session.ingredients.base,
      session: patch.ingredients.session,
    };
  }

  if (patch.method?.session) {
    updated.method = {
      base: session.method.base,
      session: patch.method.session,
    };
  }

  return updated;
}

// ---------------------------------------------------------------------------
// Plan resync (pure merge; loading and saving live in ./cooking.ts)
// ---------------------------------------------------------------------------

/**
 * Merge related-recipe lists on resync: plan entries are authoritative for
 * membership and kind, but a session-local non-active status (optional /
 * deferred / omitted) survives, so a resync cannot silently reactivate a
 * dish that was set aside during the cook. Extras added via patches are kept.
 */
export function mergeRelatedRecipes(
  plan: RelatedRecipe[],
  existing: RelatedRecipe[]
): RelatedRecipe[] {
  const existingById = new Map(existing.map((r) => [r.recipeId, r]));
  const merged = plan.map((r) => {
    const prior = existingById.get(r.recipeId);
    return prior?.status && prior.status !== "active"
      ? { ...r, status: prior.status }
      : r;
  });
  const planIds = new Set(plan.map((r) => r.recipeId));
  for (const r of existing) {
    if (!planIds.has(r.recipeId)) merged.push(r);
  }
  return merged;
}

export type PlanSyncData = {
  weekId: string;
  dayOfWeek: string;
  anchorType: AnchorType;
  provenance: Anchor["provenance"];
  recipe: {
    id: string;
    name: string;
    servings: string;
    ingredients: SessionIngredient[];
    method: string[];
  };
  relatedRecipes: RelatedRecipe[];
  serveWithFood: string[];
  planDrink: string | null;
};

/**
 * Resync an existing meal-plan session from current plan data while
 * preserving session-local edits: session ingredient/method lists, adjusted
 * servings, explicit main, hero image, component statuses, notes, and cards.
 */
export function syncSessionWithPlan(
  existing: CookingSession,
  plan: PlanSyncData
): CookingSession {
  const mainChanged = existing.anchor.recipeId !== plan.recipe.id;
  // An explicit current-cook main owns the session lists — they are its
  // working recipe, not adjustments to the anchor — so a plan-anchor change
  // must not clear them. Without an explicit main, an anchor change makes
  // the session lists stale and they reset.
  const resetSessionLists = mainChanged && !existing.main?.title?.trim();
  const existingServeWith = splitServeWith(existing.serveWith);
  const existingDrink = drinkText(existingServeWith.drinks);
  const synced: CookingSession = {
    ...existing,
    anchor: {
      type: plan.anchorType,
      recipeId: plan.recipe.id,
      title: plan.recipe.name,
      provenance: plan.provenance,
    },
    mealPlanRef: { week: plan.weekId, day: plan.dayOfWeek },
    relatedRecipes: mergeRelatedRecipes(plan.relatedRecipes, existing.relatedRecipes),
    serveWith: mergeTextLists(existingServeWith.food, plan.serveWithFood),
    // Sync base servings/ingredients/method when main recipe changed,
    // and reset current servings only if user hasn't adjusted them
    servings: mainChanged
      ? { base: plan.recipe.servings, current: plan.recipe.servings }
      : {
          base: plan.recipe.servings,
          current:
            existing.servings.current !== existing.servings.base
              ? existing.servings.current
              : plan.recipe.servings,
        },
    ingredients: {
      base: plan.recipe.ingredients,
      session: resetSessionLists ? [] : existing.ingredients.session,
    },
    method: {
      base: plan.recipe.method,
      session: resetSessionLists ? [] : existing.method.session,
    },
  };
  return {
    ...synced,
    coachCards: {
      ...synced.coachCards,
      nextMove: null,
      upgrade: synced.coachCards.upgrade ?? null,
      wine: synced.coachCards.wine ?? existingDrink ?? plan.planDrink,
    },
  };
}

// ---------------------------------------------------------------------------
// Display resolution (used by /cooking; field-based, no keyword guessing)
// ---------------------------------------------------------------------------

export type ResolvedMain = {
  title: string;
  recipeId?: string;
  summary?: string;
  /** True when session.main overrides the anchor. */
  isExplicit: boolean;
  /** True when the explicit main is a different dish than the anchor, so the
   * anchor recipe renders as a secondary component. */
  anchorIsSecondary: boolean;
};

function normalizeDishText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/\s*[—–-]\s*(optional|to share|if wanted|maybe)\s*$/i, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function resolveMainDish(session: CookingSession): ResolvedMain {
  const main = session.main;
  if (main?.title?.trim()) {
    const sameAsAnchor =
      (!!main.recipeId && main.recipeId === session.anchor.recipeId) ||
      normalizeDishText(main.title) === normalizeDishText(session.anchor.title);
    return {
      title: main.title.trim(),
      recipeId: main.recipeId ?? (sameAsAnchor ? session.anchor.recipeId : undefined),
      summary: main.summary?.trim() || undefined,
      isExplicit: true,
      anchorIsSecondary: !sameAsAnchor,
    };
  }
  return {
    title: session.anchor.title,
    recipeId: session.anchor.recipeId,
    isExplicit: false,
    anchorIsSecondary: false,
  };
}

export type SessionHero =
  | { kind: "image"; url: string; alt: string; source?: string }
  | { kind: "placeholder"; title: string };

/**
 * Hero policy: a stored recipe's own image is canonical for the resolved
 * main; the session hero image covers external/ad-hoc mains; anything else
 * gets a designed placeholder — never a blank area or another dish's photo.
 */
export function resolveSessionHero(
  session: CookingSession,
  mainRecipeImage: string | null | undefined
): SessionHero {
  const main = resolveMainDish(session);
  if (main.recipeId && mainRecipeImage) {
    return { kind: "image", url: mainRecipeImage, alt: main.title };
  }
  const hero = session.heroImage;
  if (hero?.url?.trim()) {
    return {
      kind: "image",
      url: hero.url.trim(),
      alt: hero.alt?.trim() || main.title,
      source: hero.source?.trim() || undefined,
    };
  }
  return { kind: "placeholder", title: main.title };
}

/**
 * Does the session list look like a complete integrated replacement for the
 * base, or just a short list of adjustments/substitutions? A session list is
 * "complete" when it has at least 3 items AND covers at least half the base
 * list length. Below that threshold it renders as adjustments alongside the
 * base recipe.
 */
export function isCompleteOverride(
  sessionList: unknown[],
  baseList: unknown[]
): boolean {
  if (sessionList.length === 0) return false;
  if (baseList.length === 0) return true;
  return sessionList.length >= 3 && sessionList.length >= baseList.length * 0.5;
}

export type WorkingRecipe = {
  ingredients: SessionIngredient[];
  method: string[];
  /** True when the rendered lists are tonight's session version. */
  isSessionVersion: boolean;
  /** Partial session additions rendered alongside the base lists. */
  ingredientAdjustments: SessionIngredient[];
  methodAdjustments: string[];
};

/**
 * Resolve what the main block should render.
 *
 * When an explicit main differs from the anchor, the base lists belong to the
 * anchor dish (rendered separately), so any session lists are tonight's
 * working recipe outright; a stored recipe for the main fills gaps.
 * Otherwise the existing complete-override rule applies.
 */
export function resolveWorkingRecipe(
  session: CookingSession,
  mainRecipe?: { ingredients: SessionIngredient[]; method: string[] } | null
): WorkingRecipe {
  const main = resolveMainDish(session);
  const sessionIngredients = session.ingredients.session;
  const sessionMethod = session.method.session;

  if (main.anchorIsSecondary) {
    return {
      ingredients: sessionIngredients.length > 0
        ? sessionIngredients
        : mainRecipe?.ingredients ?? [],
      method: sessionMethod.length > 0 ? sessionMethod : mainRecipe?.method ?? [],
      isSessionVersion: sessionIngredients.length > 0 || sessionMethod.length > 0,
      ingredientAdjustments: [],
      methodAdjustments: [],
    };
  }

  const ingredientsComplete = isCompleteOverride(sessionIngredients, session.ingredients.base);
  const methodComplete = isCompleteOverride(sessionMethod, session.method.base);
  return {
    ingredients: ingredientsComplete ? sessionIngredients : session.ingredients.base,
    method: methodComplete ? sessionMethod : session.method.base,
    isSessionVersion: ingredientsComplete || methodComplete,
    ingredientAdjustments:
      sessionIngredients.length > 0 && !ingredientsComplete ? sessionIngredients : [],
    methodAdjustments:
      sessionMethod.length > 0 && !methodComplete ? sessionMethod : [],
  };
}

export function activeComponents(session: CookingSession): RelatedRecipe[] {
  return session.relatedRecipes.filter((r) => (r.status ?? "active") === "active");
}

export function setAsideComponents(session: CookingSession): RelatedRecipe[] {
  return session.relatedRecipes.filter((r) => r.status && r.status !== "active");
}

export function componentStatusLabel(status: ComponentStatus): string {
  switch (status) {
    case "optional":
      return "optional";
    case "deferred":
      return "another day";
    case "omitted":
      return "skipped tonight";
    default:
      return "";
  }
}

/**
 * First clause of a canonical servings string, for compact badges. Some
 * source strings jam two clauses together ("serves 2 to 4makes about 8
 * fritters"); a badge should show only the leading clause. Clean strings
 * pass through unchanged — this fixes display only, not canonical data.
 */
export function firstServingsClause(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const match = trimmed.match(
    /^(.+?\d)[\s;,.·—–-]*(?=(?:makes|serves|each|enough|yields|about|plus)\b)/i
  );
  return match ? match[1] : trimmed;
}

/**
 * Serve-with entries the table row should show: everything that is not a
 * drink and does not restate the main or a listed component. Matching is by
 * explicit dish titles only.
 */
export function visibleServeWith(
  session: CookingSession,
  componentTitles: string[]
): string[] {
  const main = resolveMainDish(session);
  const titles = [main.title, session.anchor.title, ...componentTitles]
    .map(normalizeDishText)
    .filter((t) => t.length > 3);

  return session.serveWith.filter((item) => {
    if (isDrinkServeWith(item)) return false;
    const norm = normalizeDishText(item);
    if (!norm) return false;
    return !titles.some(
      (title) => norm.includes(title) || title.includes(norm)
    );
  });
}
