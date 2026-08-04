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

import {
  analyzeMealCoherence,
  type MealCoherenceReview,
  type MealComponent,
  type MealComponentRole,
  type RecipeLike,
  // Explicit .ts extension: cooking-session.ts is loaded directly by
  // `node --test`, whose ESM resolver does not add extensions.
} from "./meal-coherence.ts";

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
  /**
   * Base-list item this session entry substitutes, matched by name
   * (case-insensitive; descriptors after a comma are ignored). The working
   * list integrates the substitution in place of the matched base row; a
   * blank `item` with `replaces` removes the base row (an omission). Without
   * a match — or without `replaces` and no same-named base row — the entry is
   * an addition. The base list itself is never modified.
   */
  replaces?: string;
};

/**
 * How a session list relates to the base list it sits next to.
 *
 * - `append`   — the session list is a set of adjustments. Ingredient entries
 *   are integrated into the base list in place; method steps continue the
 *   anchor method as one sequence. Only valid when the base instructions
 *   remain true for tonight.
 * - `override` — the session list IS tonight's recipe and replaces the base
 *   list wholesale. This is what the runtime must supply when tonight's
 *   ingredient changes invalidate base steps: once peppers replace the
 *   tomatoes, "roast the tomatoes for 90 minutes" is no longer an instruction
 *   the cook can follow, and appending to it produces a method that
 *   contradicts its own ingredient list.
 *
 * Absent means "infer" — see `isCompleteOverride`. Every session row written
 * before this field existed carries no mode and keeps its previous behaviour.
 */
export type SessionListMode = "append" | "override";

export const VALID_SESSION_LIST_MODES: SessionListMode[] = ["append", "override"];

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
    /** Absent on legacy rows; then the mode is inferred. */
    sessionMode?: SessionListMode;
  };
  method: {
    base: string[];
    session: string[];
    /** Absent on legacy rows; then the mode is inferred. */
    sessionMode?: SessionListMode;
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
  ingredients?: { session: SessionIngredient[]; sessionMode?: SessionListMode };
  method?: { session: string[]; sessionMode?: SessionListMode };
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
  if (patch.ingredients?.session !== undefined) {
    if (!Array.isArray(patch.ingredients.session)) {
      return "ingredients.session must be an array";
    }
    for (const entry of patch.ingredients.session) {
      if (typeof entry !== "object" || entry === null || typeof entry.item !== "string") {
        return "Each session ingredient needs an item string";
      }
      if (entry.replaces !== undefined && typeof entry.replaces !== "string") {
        return "Session ingredient replaces must be a string";
      }
    }
  }
  if (
    patch.ingredients?.sessionMode !== undefined &&
    !VALID_SESSION_LIST_MODES.includes(patch.ingredients.sessionMode)
  ) {
    return `Invalid ingredients.sessionMode: ${String(patch.ingredients.sessionMode)}`;
  }
  if (patch.method?.session !== undefined) {
    if (
      !Array.isArray(patch.method.session) ||
      patch.method.session.some((step) => typeof step !== "string")
    ) {
      return "method.session must be an array of strings";
    }
  }
  if (
    patch.method?.sessionMode !== undefined &&
    !VALID_SESSION_LIST_MODES.includes(patch.method.sessionMode)
  ) {
    return `Invalid method.sessionMode: ${String(patch.method.sessionMode)}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Full-body validation (POST /api/cooking/session)
//
// The route used to accept any JSON with a truthy `id`, `date`, and `anchor`.
// `anchor: "chicken"` passed that check and persisted, and every later read of
// that row threw — `session.anchor.title` was `undefined`, and the derived
// coherence review calls `.toLowerCase()` on it. One malformed POST could make
// both session GET routes permanently 500.
//
// The rules below are structural, not stylistic. Anything genuinely unusable is
// refused with a message the caller can act on; anything merely *absent* is
// normalized to the empty shape the rest of the module already expects, so the
// legacy session shapes already in the database keep round-tripping.
// ---------------------------------------------------------------------------

export type SessionValidation =
  | { ok: true; session: CookingSession }
  | { ok: false; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** An array of strings, dropping blanks. Non-arrays are a caller error. */
function stringArray(value: unknown, field: string): string[] | { error: string } {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return { error: `${field} must be an array of strings` };
  for (const entry of value) {
    if (typeof entry !== "string") return { error: `${field} must contain only strings` };
  }
  return (value as string[]).filter((entry) => entry.trim().length > 0);
}

function ingredientArray(
  value: unknown,
  field: string,
): SessionIngredient[] | { error: string } {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return { error: `${field} must be an array` };
  const result: SessionIngredient[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) return { error: `${field} must contain ingredient objects` };
    if (typeof entry.item !== "string") return { error: `${field} entries need an item string` };
    if (entry.replaces !== undefined && typeof entry.replaces !== "string") {
      return { error: `${field} replaces must be a string when present` };
    }
    result.push({
      amount: typeof entry.amount === "string" ? entry.amount : "",
      item: entry.item,
      ...(typeof entry.unit === "string" ? { unit: entry.unit } : {}),
      ...(typeof entry.group === "string" || entry.group === null
        ? { group: entry.group as string | null }
        : {}),
      ...(typeof entry.replaces === "string" && entry.replaces.trim()
        ? { replaces: entry.replaces }
        : {}),
    });
  }
  return result;
}

/**
 * Validate and normalize a full session body.
 *
 * Returns the session the persistence layer should store — never the caller's
 * object — so an unexpected extra key cannot ride into the row and a missing
 * optional list is filled in rather than left `undefined` for a later reader to
 * trip over.
 */
export function validateSessionBody(body: unknown): SessionValidation {
  if (!isPlainObject(body)) return { ok: false, error: "Session body must be an object" };

  const id = requiredString(body.id);
  if (!id) return { ok: false, error: "Invalid session data: id is required" };
  const date = requiredString(body.date);
  if (!date) return { ok: false, error: "Invalid session data: date is required" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: "Invalid session data: date must be YYYY-MM-DD" };
  }

  // The anchor is what every read path dereferences, so it is the one field
  // that must be a real object with a usable title.
  if (!isPlainObject(body.anchor)) {
    return { ok: false, error: "Invalid session data: anchor must be an object" };
  }
  const anchorTitle = requiredString(body.anchor.title);
  if (!anchorTitle) {
    return { ok: false, error: "Invalid session data: anchor.title is required" };
  }
  if (body.anchor.recipeId !== undefined && typeof body.anchor.recipeId !== "string") {
    return { ok: false, error: "Invalid session data: anchor.recipeId must be a string" };
  }
  if (body.anchor.type !== undefined && typeof body.anchor.type !== "string") {
    return { ok: false, error: "Invalid session data: anchor.type must be a string" };
  }
  if (body.anchor.provenance !== undefined && !isPlainObject(body.anchor.provenance)) {
    return { ok: false, error: "Invalid session data: anchor.provenance must be an object" };
  }
  const provenanceInput = (body.anchor.provenance ?? {}) as Record<string, unknown>;
  const anchor: Anchor = {
    // A legacy anchor without an explicit type is still a real anchor; the
    // stored default is the one every kitchen-sourced session already carries.
    type: (body.anchor.type as AnchorType) ?? "kitchen-recipe",
    ...(typeof body.anchor.recipeId === "string" ? { recipeId: body.anchor.recipeId } : {}),
    title: anchorTitle,
    provenance: {
      source: typeof provenanceInput.source === "string" ? provenanceInput.source : "",
      ...(typeof provenanceInput.url === "string" ? { url: provenanceInput.url } : {}),
      ...(typeof provenanceInput.author === "string" ? { author: provenanceInput.author } : {}),
    },
  };

  if (body.status !== undefined && !VALID_STATUSES.includes(body.status as SessionStatus)) {
    return { ok: false, error: `Invalid session data: unknown status ${String(body.status)}` };
  }
  if (
    body.source !== undefined &&
    !["meal-plan", "ad-hoc", "telegram"].includes(String(body.source))
  ) {
    return { ok: false, error: `Invalid session data: unknown source ${String(body.source)}` };
  }

  if (body.relatedRecipes !== undefined && body.relatedRecipes !== null && !Array.isArray(body.relatedRecipes)) {
    return { ok: false, error: "Invalid session data: relatedRecipes must be an array" };
  }
  const relatedRecipes: RelatedRecipe[] = [];
  for (const entry of (body.relatedRecipes ?? []) as unknown[]) {
    if (!isPlainObject(entry)) {
      return { ok: false, error: "Invalid session data: relatedRecipes entries must be objects" };
    }
    const recipeId = requiredString(entry.recipeId);
    const title = requiredString(entry.title);
    if (!recipeId || !title) {
      return {
        ok: false,
        error: "Invalid session data: each related recipe needs recipeId and title",
      };
    }
    if (entry.status !== undefined && !VALID_COMPONENT_STATUSES.includes(entry.status as ComponentStatus)) {
      return { ok: false, error: `Invalid component status: ${String(entry.status)}` };
    }
    relatedRecipes.push({
      kind:
        entry.kind === "starter" || entry.kind === "dessert"
          ? entry.kind
          : "side",
      recipeId,
      title,
      ...(entry.status ? { status: entry.status as ComponentStatus } : {}),
    });
  }

  const serveWith = stringArray(body.serveWith, "serveWith");
  if (!Array.isArray(serveWith)) return { ok: false, error: serveWith.error };

  if (body.servings !== undefined && body.servings !== null && !isPlainObject(body.servings)) {
    return { ok: false, error: "Invalid session data: servings must be an object" };
  }
  const servingsInput = (body.servings ?? {}) as Record<string, unknown>;

  if (body.ingredients !== undefined && body.ingredients !== null && !isPlainObject(body.ingredients)) {
    return { ok: false, error: "Invalid session data: ingredients must be an object" };
  }
  const ingredientsInput = (body.ingredients ?? {}) as Record<string, unknown>;
  const baseIngredients = ingredientArray(ingredientsInput.base, "ingredients.base");
  if (!Array.isArray(baseIngredients)) return { ok: false, error: baseIngredients.error };
  const sessionIngredients = ingredientArray(ingredientsInput.session, "ingredients.session");
  if (!Array.isArray(sessionIngredients)) return { ok: false, error: sessionIngredients.error };

  if (body.method !== undefined && body.method !== null && !isPlainObject(body.method)) {
    return { ok: false, error: "Invalid session data: method must be an object" };
  }
  const methodInput = (body.method ?? {}) as Record<string, unknown>;
  const baseMethod = stringArray(methodInput.base, "method.base");
  if (!Array.isArray(baseMethod)) return { ok: false, error: baseMethod.error };
  const sessionMethod = stringArray(methodInput.session, "method.session");
  if (!Array.isArray(sessionMethod)) return { ok: false, error: sessionMethod.error };

  // An unknown mode is refused rather than dropped: silently falling back to
  // inference is how a session meant to be a complete override renders as an
  // append. Absent stays absent, so legacy rows round-trip untouched.
  const sessionListMode = (
    value: unknown,
    field: string
  ): SessionListMode | undefined | { error: string } => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string" || !VALID_SESSION_LIST_MODES.includes(value as SessionListMode)) {
      return { error: `Invalid session data: ${field} must be "append" or "override"` };
    }
    return value as SessionListMode;
  };
  const ingredientsMode = sessionListMode(ingredientsInput.sessionMode, "ingredients.sessionMode");
  if (ingredientsMode && typeof ingredientsMode === "object") {
    return { ok: false, error: ingredientsMode.error };
  }
  const methodMode = sessionListMode(methodInput.sessionMode, "method.sessionMode");
  if (methodMode && typeof methodMode === "object") {
    return { ok: false, error: methodMode.error };
  }

  if (body.adaptations !== undefined && body.adaptations !== null && !Array.isArray(body.adaptations)) {
    return { ok: false, error: "Invalid session data: adaptations must be an array" };
  }
  const adaptations: Adaptation[] = [];
  for (const entry of (body.adaptations ?? []) as unknown[]) {
    if (!isPlainObject(entry)) {
      return { ok: false, error: "Invalid session data: adaptations entries must be objects" };
    }
    const adaptationId = requiredString(entry.id);
    const summary = requiredString(entry.summary);
    // The kind enum is deliberately *not* enforced here. A patch is authored
    // now and must use a known kind; a full body can be a replay of a session
    // recorded before a kind was renamed, and an unknown label is readable
    // rather than unusable.
    if (!adaptationId || typeof entry.kind !== "string" || !summary) {
      return {
        ok: false,
        error: "Invalid session data: each adaptation needs id, kind, and summary",
      };
    }
    adaptations.push({
      id: adaptationId,
      kind: entry.kind as AdaptationKind,
      summary,
      ...(typeof entry.messageSource === "string" ? { messageSource: entry.messageSource } : {}),
      createdAt: typeof entry.createdAt === "string" ? entry.createdAt : "",
    });
  }

  if (body.coachCards !== undefined && body.coachCards !== null && !isPlainObject(body.coachCards)) {
    return { ok: false, error: "Invalid session data: coachCards must be an object" };
  }
  const cards = (body.coachCards ?? {}) as Record<string, unknown>;
  const coachCard = (key: string): string | null =>
    typeof cards[key] === "string" ? (cards[key] as string) : null;

  if (body.main !== undefined && body.main !== null) {
    if (!isPlainObject(body.main) || !requiredString(body.main.title)) {
      return { ok: false, error: "Main needs a non-empty title" };
    }
  }
  if (body.heroImage !== undefined && body.heroImage !== null) {
    const url = isPlainObject(body.heroImage) ? body.heroImage.url : undefined;
    if (typeof url !== "string" || !/^(https?:\/\/|\/)/.test(url.trim())) {
      return { ok: false, error: "Hero image needs an http(s) or root-relative url" };
    }
  }
  if (body.story !== undefined && body.story !== null) {
    if (!isPlainObject(body.story) || !requiredString(body.story.text)) {
      return { ok: false, error: "Story needs non-empty text" };
    }
  }
  if (body.mealPlanRef !== undefined && body.mealPlanRef !== null && !isPlainObject(body.mealPlanRef)) {
    return { ok: false, error: "Invalid session data: mealPlanRef must be an object" };
  }

  const session: CookingSession = {
    id,
    date,
    status: (body.status as SessionStatus) ?? "draft",
    source: (body.source as CookingSession["source"]) ?? "ad-hoc",
    mealPlanRef: (body.mealPlanRef as CookingSession["mealPlanRef"]) ?? null,
    anchor,
    main: (body.main as SessionMain | null | undefined) ?? null,
    heroImage: (body.heroImage as SessionHeroImage | null | undefined) ?? null,
    relatedRecipes,
    serveWith,
    servings: {
      base: typeof servingsInput.base === "string" ? servingsInput.base : "",
      current: typeof servingsInput.current === "string" ? servingsInput.current : "",
    },
    ingredients: {
      base: baseIngredients,
      session: sessionIngredients,
      ...(ingredientsMode ? { sessionMode: ingredientsMode as SessionListMode } : {}),
    },
    method: {
      base: baseMethod,
      session: sessionMethod,
      ...(methodMode ? { sessionMode: methodMode as SessionListMode } : {}),
    },
    adaptations,
    coachCards: {
      nextMove: coachCard("nextMove"),
      upgrade: coachCard("upgrade"),
      shortcut: coachCard("shortcut"),
      wine: coachCard("wine"),
    },
    story: (body.story as SessionStory | null | undefined) ?? null,
    notes: typeof body.notes === "string" ? body.notes : "",
    createdAt: typeof body.createdAt === "string" ? body.createdAt : "",
    updatedAt: typeof body.updatedAt === "string" ? body.updatedAt : "",
  };

  return { ok: true, session };
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

  // A patch that rewrites a session list owns that list's mode too: an explicit
  // mode is taken, and an omitted one clears any earlier mode rather than
  // leaving a stale "override" attached to a freshly written adjustment list.
  if (patch.ingredients?.session) {
    updated.ingredients = {
      base: session.ingredients.base,
      session: patch.ingredients.session,
      ...(patch.ingredients.sessionMode ? { sessionMode: patch.ingredients.sessionMode } : {}),
    };
  } else if (patch.ingredients?.sessionMode) {
    updated.ingredients = { ...session.ingredients, sessionMode: patch.ingredients.sessionMode };
  }

  if (patch.method?.session) {
    updated.method = {
      base: session.method.base,
      session: patch.method.session,
      ...(patch.method.sessionMode ? { sessionMode: patch.method.sessionMode } : {}),
    };
  } else if (patch.method?.sessionMode) {
    updated.method = { ...session.method, sessionMode: patch.method.sessionMode };
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
    // A reset clears the session list AND its mode: an "override" left behind
    // by the previous anchor would claim an empty list is tonight's recipe.
    ingredients: resetSessionLists
      ? { base: plan.recipe.ingredients, session: [] }
      : {
          base: plan.recipe.ingredients,
          session: existing.ingredients.session,
          ...(existing.ingredients.sessionMode
            ? { sessionMode: existing.ingredients.sessionMode }
            : {}),
        },
    method: resetSessionLists
      ? { base: plan.recipe.method, session: [] }
      : {
          base: plan.recipe.method,
          session: existing.method.session,
          ...(existing.method.sessionMode ? { sessionMode: existing.method.sessionMode } : {}),
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

// ---------------------------------------------------------------------------
// Recipe provenance (rule 10: chat-origin metadata is never recipe provenance)
// ---------------------------------------------------------------------------

/**
 * Operational/chat wording that must never render as recipe provenance:
 * messenger names, "confirmed by/in", "as discussed", assistant names, and
 * chat-thread phrasing. This guards display only — the stored session keeps
 * its metadata untouched for repair tooling.
 */
const CHAT_ORIGIN_PATTERN =
  /\b(telegram|whatsapp|imessage|signal|discord|slack|nabu|chatgpt|claude|confirmed\s+(?:by|in|via|over)|as\s+discussed|per\s+(?:the\s+)?(?:chat|conversation)|via\s+(?:chat|message)|(?:cooking|group|the)\s+chat|chat\s+(?:message|thread|log))\b/i;

export function isChatOriginText(text: string | null | undefined): boolean {
  return Boolean(text && CHAT_ORIGIN_PATTERN.test(text));
}

/**
 * Displayable source line for a recipe, or null when there is nothing honest
 * to show. Chat-origin/operational wording in either field disqualifies the
 * whole label — a session may keep such metadata internally, but it must
 * never masquerade as where the recipe comes from.
 */
export function recipeProvenanceLabel(provenance: {
  source?: string | null;
  author?: string | null;
}): string | null {
  const source = provenance.source?.trim() ?? "";
  const author = provenance.author?.trim() ?? "";
  if (isChatOriginText(source) || isChatOriginText(author)) return null;
  if (author && source.toLowerCase().includes(author.toLowerCase())) {
    return source || null;
  }
  return [source, author].filter(Boolean).join(" · ") || null;
}

/**
 * The anchor's visible recipe provenance. A synthesized plan has no source
 * recipe, so it gets no provenance line at all — the page shows the best
 * available recipe truth without inventing a source (rendering acceptance
 * criteria, live-cooking DESIGN.md §7).
 */
export function anchorProvenanceLabel(session: CookingSession): string | null {
  if (session.anchor.type === "synthesized-plan") return null;
  return recipeProvenanceLabel(session.anchor.provenance);
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
    const source = hero.source?.trim();
    return {
      kind: "image",
      url: hero.url.trim(),
      alt: hero.alt?.trim() || main.title,
      // A hero credit is provenance too — chat-origin wording never renders.
      source: source && !isChatOriginText(source) ? source : undefined,
    };
  }
  return { kind: "placeholder", title: main.title };
}

/**
 * Is the session list tonight's whole recipe, or a set of adjustments to the
 * base list?
 *
 * An explicit `mode` decides it, and the runtime is expected to set one: the
 * writer knows whether tonight's changes leave the base instructions usable,
 * and length is a poor proxy for that. The 2026-08-03 farfalle session is the
 * proof — one appended salmon step against a four-step base scored "adjustment"
 * and the cook was told to slow-roast cherry tomatoes that peppers had already
 * replaced. A truthful session there is a complete method override, and no
 * threshold can tell that apart from a genuine one-step addition.
 *
 * With no mode — every session row written before this field existed — the
 * original inference is kept unchanged: a session list is "complete" when it
 * has at least 3 items AND covers at least half the base list length.
 */
export function isCompleteOverride(
  sessionList: unknown[],
  baseList: unknown[],
  mode?: SessionListMode
): boolean {
  if (sessionList.length === 0) return false;
  if (mode === "override") return true;
  if (mode === "append") return false;
  if (baseList.length === 0) return true;
  return sessionList.length >= 3 && sessionList.length >= baseList.length * 0.5;
}

/** A row of the integrated working ingredient list. */
export type WorkingIngredient = SessionIngredient & {
  /** Set on rows the session changed tonight: added, substituted, or re-quantified. */
  tonight?: boolean;
  /** For substitutions: the base item text this row stands in for. */
  replacedItem?: string;
};

/** A step of the single working method sequence. */
export type WorkingStep = {
  text: string;
  /** Set on steps the session appended to the anchor method tonight. */
  tonight?: boolean;
};

export type WorkingRecipe = {
  /** One integrated list — session substitutions already applied to the base. */
  ingredients: WorkingIngredient[];
  /** One procedural sequence — never a base list plus a correction list. */
  method: WorkingStep[];
  /** True when a complete session replacement is the rendered version. */
  isSessionVersion: boolean;
  /** True when any session change is integrated — the "Adapted tonight" signal. */
  hasSessionChanges: boolean;
};

function normalizeIngredientText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Item name without trailing descriptors: "cherry tomatoes, halved" → "cherry tomatoes". */
function coreIngredientItem(text: string): string {
  return normalizeIngredientText(text.split(",")[0]);
}

/**
 * Find the base row a session entry targets. Exact item match first, then
 * core-item equality, then — only for an explicit `replaces` — containment
 * either way, so `replaces: "tomatoes"` finds "cherry tomatoes, halved". Rows
 * already claimed by an earlier session entry are skipped. Returns -1 when
 * nothing matches; the caller then treats the entry as an addition.
 *
 * `allowFuzzy` is what keeps an ADDITION from eating a base row. Containment
 * is a reasonable reading of "replace the tomatoes" — David named a target and
 * the nearest base row is what he meant. It is a terrible reading of a plain
 * addition: `salt` is contained in `salted butter` and `lemon` in `lemon zest`,
 * so adding salt silently deleted the butter and adding lemon deleted the zest,
 * removing an ingredient the cook still needs and never showing it anywhere.
 * An addition may still land on a base row by exact or same-core name — that is
 * a re-quantification of the same ingredient, not a different one.
 */
function findBaseMatch(
  base: SessionIngredient[],
  consumed: Set<number>,
  target: string,
  allowFuzzy: boolean
): number {
  const norm = normalizeIngredientText(target);
  if (!norm) return -1;
  const core = coreIngredientItem(target);
  const passes: ((baseItem: string) => boolean)[] = [
    (item) => normalizeIngredientText(item) === norm,
    (item) => coreIngredientItem(item) === core,
  ];
  if (allowFuzzy) {
    passes.push((item) => {
      const baseCore = coreIngredientItem(item);
      return baseCore.includes(core) || core.includes(baseCore);
    });
  }
  for (const matches of passes) {
    for (let i = 0; i < base.length; i++) {
      if (consumed.has(i)) continue;
      if (matches(base[i].item)) return i;
    }
  }
  return -1;
}

/**
 * Integrate partial session ingredients into the base list (rule 10): one
 * list, substitutions applied in place, additions appended, omissions removed.
 * The base array is read, never mutated — the anchor's verbatim ingredients
 * stay canonical in `ingredients.base`.
 */
export function composeWorkingIngredients(
  base: SessionIngredient[],
  session: SessionIngredient[]
): WorkingIngredient[] {
  const working: (WorkingIngredient | null)[] = base.map((row) => ({ ...row }));
  const consumed = new Set<number>();
  const additions: WorkingIngredient[] = [];

  for (const entry of session) {
    const explicitTarget = entry.replaces?.trim() ?? "";
    const isOmission = Boolean(explicitTarget) && !entry.item.trim();
    const target = explicitTarget || entry.item;
    // Fuzzy containment is only ever a reading of an explicit `replaces`.
    const index = findBaseMatch(base, consumed, target, Boolean(explicitTarget));

    if (index === -1) {
      // No matched base row: an omission of something absent is a no-op, and
      // a blank item with no target is noise, not an ingredient.
      if (!isOmission && entry.item.trim()) {
        additions.push({ ...entry, tonight: true });
      }
      continue;
    }

    consumed.add(index);
    if (isOmission) {
      working[index] = null;
      continue;
    }
    const replaced = base[index];
    working[index] = {
      ...entry,
      group: entry.group ?? replaced.group ?? null,
      tonight: true,
      // Only a genuine substitution names what it replaced; a re-quantified
      // row of the same item needs no hint.
      ...(coreIngredientItem(replaced.item) !== coreIngredientItem(entry.item)
        ? { replacedItem: replaced.item }
        : {}),
    };
  }

  return [
    ...working.filter((row): row is WorkingIngredient => row !== null),
    ...additions,
  ];
}

/**
 * Resolve the one working recipe the main block renders (rules 10–11).
 *
 * When an explicit main differs from the anchor, the base lists belong to the
 * anchor dish (rendered separately), so any session lists are tonight's
 * working recipe outright; a stored recipe for the main fills gaps.
 *
 * When the anchor is the main: a complete session list replaces the base
 * wholesale (a coherent replacement flow); a partial session list is
 * integrated — ingredient substitutions applied in place, extra method steps
 * appended to the anchor method as one continuous sequence. There is no
 * detached correction list in any mode.
 */
export function resolveWorkingRecipe(
  session: CookingSession,
  mainRecipe?: { ingredients: SessionIngredient[]; method: string[] } | null
): WorkingRecipe {
  const main = resolveMainDish(session);
  const sessionIngredients = session.ingredients.session;
  const sessionMethod = session.method.session;

  if (main.anchorIsSecondary) {
    const hasSessionLists = sessionIngredients.length > 0 || sessionMethod.length > 0;
    return {
      ingredients: (sessionIngredients.length > 0
        ? sessionIngredients
        : mainRecipe?.ingredients ?? []
      ).map((row) => ({ ...row })),
      method: (sessionMethod.length > 0 ? sessionMethod : mainRecipe?.method ?? []).map(
        (text) => ({ text })
      ),
      isSessionVersion: hasSessionLists,
      hasSessionChanges: hasSessionLists,
    };
  }

  const ingredientsComplete = isCompleteOverride(
    sessionIngredients,
    session.ingredients.base,
    session.ingredients.sessionMode
  );
  const methodComplete = isCompleteOverride(
    sessionMethod,
    session.method.base,
    session.method.sessionMode
  );

  return {
    ingredients: ingredientsComplete
      ? sessionIngredients.map((row) => ({ ...row }))
      : composeWorkingIngredients(session.ingredients.base, sessionIngredients),
    method: methodComplete
      ? sessionMethod.map((text) => ({ text }))
      : [
          ...session.method.base.map((text) => ({ text })),
          ...sessionMethod.map((text) => ({ text, tonight: true })),
        ],
    isSessionVersion: ingredientsComplete || methodComplete,
    hasSessionChanges:
      sessionIngredients.length > 0 || sessionMethod.length > 0,
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

// ---------------------------------------------------------------------------
// Whole-meal coherence (derived, never stored on the anchor)
// ---------------------------------------------------------------------------

/** Recipes the session references, keyed by recipe id. Partial is fine. */
export type SessionRecipeLookup =
  | Map<string, RecipeLike>
  | Record<string, RecipeLike>;

function lookupRecipe(
  lookup: SessionRecipeLookup | undefined,
  recipeId: string | undefined
): RecipeLike | null {
  if (!lookup || !recipeId) return null;
  if (lookup instanceof Map) return lookup.get(recipeId) ?? null;
  return lookup[recipeId] ?? null;
}

function componentKind(kind: RelatedRecipe["kind"]): MealComponentRole {
  return kind === "starter" ? "starter" : kind === "dessert" ? "dessert" : "side";
}

/**
 * Review the session as one meal (live-cooking DESIGN.md §3 rule 16).
 *
 * Pure and non-mutating: it reads the *working* recipe — tonight's session
 * lists where they exist, the base lists otherwise — so a rebalanced glaze is
 * seen while `ingredients.base` / `method.base` stay the anchor's verbatim
 * original. Nothing is written back to the session or to any recipe.
 *
 * `recipes` is an optional lookup for components that resolve to stored
 * recipes. Components missing from it still participate using their titles,
 * which is the only signal an external or ad-hoc dish has anyway.
 */
export function reviewSessionCoherence(
  session: CookingSession,
  recipes?: SessionRecipeLookup
): MealCoherenceReview {
  const resolved = resolveMainDish(session);
  const mainRecipe = lookupRecipe(recipes, resolved.recipeId);
  const working = resolveWorkingRecipe(
    session,
    mainRecipe
      ? {
          ingredients: (mainRecipe.ingredients ?? []).map((i) => ({
            amount: "",
            item: i?.item ?? "",
          })),
          method: mainRecipe.method ?? [],
        }
      : null
  );

  const main: MealComponent = {
    id: resolved.recipeId ?? session.anchor.recipeId ?? session.id,
    title: resolved.title,
    role: "main",
    // The integrated working lists: a substituted-away base ingredient is no
    // longer in tonight's dish, so the review must not count it.
    ingredients: working.ingredients.map(
      ({ tonight: _tonight, replacedItem: _replacedItem, ...ingredient }) => ingredient
    ),
    method: working.method.map((step) => step.text),
    notes: resolved.summary ? [resolved.summary] : [],
    timeMinutes: null,
  };

  const components: MealComponent[] = [];

  // An explicit main displaces the anchor into a secondary dish, still cooked
  // from its own untouched base lists.
  if (resolved.anchorIsSecondary) {
    components.push({
      id: session.anchor.recipeId ?? `${session.id}:anchor`,
      title: session.anchor.title,
      role: "side",
      ingredients: session.ingredients.base,
      method: session.method.base,
      timeMinutes: null,
    });
  }

  for (const related of session.relatedRecipes) {
    const recipe = lookupRecipe(recipes, related.recipeId);
    components.push({
      id: related.recipeId,
      title: related.title,
      role: componentKind(related.kind),
      ingredients: (recipe?.ingredients ?? []).map((i) => ({ item: i?.item ?? "" })),
      method: recipe?.method ?? [],
      status: related.status ?? "active",
      timeMinutes: null,
    });
  }

  return analyzeMealCoherence({
    main,
    components,
    // Only serve-with lines that are genuinely their own dish. A line that
    // restates the main or a listed component ("Gochujang-glazed salmon
    // 700 g", "Kimchi pancakes — optional") is the same dish written twice:
    // counting it again would blame the main for repeating itself and would
    // quietly put a set-aside component back on the plate.
    serveWith: visibleServeWith(
      session,
      session.relatedRecipes.map((r) => r.title)
    ),
  });
}

/**
 * Every recipe id the session references, in review order: the resolved main,
 * the anchor (which renders as a secondary dish when an explicit main displaces
 * it), then each component. Deduplicated, stable, no empty ids.
 */
export function sessionRecipeIds(session: CookingSession): string[] {
  const resolved = resolveMainDish(session);
  const ids = [
    resolved.recipeId,
    session.anchor.recipeId,
    ...session.relatedRecipes.map((r) => r.recipeId),
  ];
  return [...new Set(ids.filter((id): id is string => Boolean(id && id.length > 0)))];
}

/** Resolve one recipe by id. Must reach explicitly referenced recipes that are
 * hidden from browse surfaces — a session side can point at any of them. */
export type SessionRecipeResolver = (
  id: string
) => Promise<RecipeLike | null | undefined>;

/**
 * `reviewSessionCoherence` with the recipe lookup filled in.
 *
 * Kept here, next to the contract, with the resolver injected so it stays
 * testable without a database; `cooking.ts` binds it to `getRecipe`. Purely
 * derived — nothing is written back to the session, the anchor base lists, or
 * any recipe.
 */
export async function resolveSessionCoherence(
  session: CookingSession,
  resolve: SessionRecipeResolver
): Promise<MealCoherenceReview> {
  const ids = sessionRecipeIds(session);
  const found = await Promise.all(ids.map((id) => resolve(id)));
  const lookup = new Map<string, RecipeLike>();
  found.forEach((recipe, i) => {
    if (recipe) lookup.set(ids[i], recipe);
  });
  return reviewSessionCoherence(session, lookup);
}

/**
 * `resolveSessionCoherence` that reports a failure instead of throwing.
 *
 * Rows written before POST validated its body can be structurally unusable —
 * a string anchor, a related recipe with no title. Deriving a review for one of
 * those throws, and a read route must not turn that into a permanent 500 for
 * the whole page. The failure is *returned*, not swallowed: the caller reports
 * it so the row gets repaired rather than quietly losing its meal balance.
 */
export async function resolveSessionCoherenceSafely(
  session: CookingSession,
  resolve: SessionRecipeResolver
): Promise<{ review: MealCoherenceReview | null; error: string | null }> {
  try {
    return { review: await resolveSessionCoherence(session, resolve), error: null };
  } catch (error) {
    return {
      review: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
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

// ---------------------------------------------------------------------------
// Visible session notes (rule 11: hidden when they duplicate the working
// recipe; rule 8: stale/drink/backstory/filler notes are filtered out)
// ---------------------------------------------------------------------------

function meaningfulTokens(text: string): string[] {
  return normalizeDishText(text)
    .split(" ")
    .filter((token) => token.length >= 4);
}

/**
 * Does this note line restate what the working recipe (or its recorded
 * adaptations) already says? A line is a duplicate when it has real substance
 * (3+ meaningful tokens) and nearly all of those tokens already appear in the
 * integrated ingredients, method, or adaptation summaries. Short or mostly
 * novel lines always stay visible.
 */
export function duplicatesWorkingRecipe(
  line: string,
  working: WorkingRecipe,
  adaptations: Adaptation[] = []
): boolean {
  const tokens = meaningfulTokens(line);
  if (tokens.length < 3) return false;
  const corpus = normalizeDishText(
    [
      ...working.ingredients.map(
        (ingredient) => `${ingredient.item} ${ingredient.replacedItem ?? ""}`
      ),
      ...working.method.map((step) => step.text),
      ...adaptations.map((adaptation) => adaptation.summary),
    ].join(" ")
  );
  const hits = tokens.filter((token) => corpus.includes(token)).length;
  return hits / tokens.length >= 0.7;
}

/**
 * The notes `/cooking` should actually show: useful-to-the-cook lines only.
 * Drops blanks, drink-pairing lines (they live in `coachCards.wine`), leftover
 * backstory prefixes, generic filler, very short noise, and — when the working
 * recipe is provided — lines that duplicate it or its adaptations.
 */
export function visibleSessionNotes(
  notes: string,
  working?: WorkingRecipe | null,
  adaptations: Adaptation[] = []
): string | null {
  if (!notes?.trim()) return null;

  const lines = notes
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (isDrinkServeWith(line)) return false;
      if (/^backstory:/i.test(line)) return false;
      if (/^(enjoy|bon app[eé]tit|have a (great|good)|happy cooking|good luck)/i.test(line)) return false;
      if (line.replace(/[^a-zA-Z]/g, "").length < 6) return false;
      if (working && duplicatesWorkingRecipe(line, working, adaptations)) return false;
      return true;
    });

  const result = lines.join("\n").trim();
  return result || null;
}
