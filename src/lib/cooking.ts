// Cooking Session types and persistence helpers.
// This module owns the runtime shape for live cooking sessions.
// Domain logic (anchor policy, adaptation lifecycle) lives in projects/live-cooking/.

import { getDb } from "./db";
import { loadMealPlan } from "./meals-persistence";
import { getRecipe } from "./recipes";
import { getISOWeek } from "./meals";

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

export type SessionIngredient = {
  amount: string;
  item: string;
  group?: string | null;
};

export type RelatedRecipe = {
  kind: "side";
  recipeId: string;
  title: string;
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
  notes: string;
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

export async function getCookingSessionForDate(
  date: string
): Promise<CookingSession | null> {
  const client = await getDb();
  const result = await client.execute({
    sql: "SELECT data FROM cooking_sessions WHERE date = ? ORDER BY updated_at DESC LIMIT 1",
    args: [date],
  });
  if (result.rows.length === 0) return null;
  return JSON.parse(result.rows[0]["data"] as string) as CookingSession;
}

export async function getCookingSession(
  id: string
): Promise<CookingSession | null> {
  const client = await getDb();
  const result = await client.execute({
    sql: "SELECT data FROM cooking_sessions WHERE id = ?",
    args: [id],
  });
  if (result.rows.length === 0) return null;
  return JSON.parse(result.rows[0]["data"] as string) as CookingSession;
}

export async function saveCookingSession(
  session: CookingSession
): Promise<void> {
  const client = await getDb();
  const now = new Date().toISOString();
  const updated: CookingSession = {
    ...session,
    updatedAt: now,
    createdAt: session.createdAt || now,
  };

  await client.execute({
    sql: `INSERT INTO cooking_sessions (id, date, data, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            data = excluded.data,
            updated_at = excluded.updated_at`,
    args: [
      updated.id,
      updated.date,
      JSON.stringify(updated),
      updated.createdAt,
      now,
    ],
  });
}

// ---------------------------------------------------------------------------
// Partial update (patch) support
// ---------------------------------------------------------------------------

export type SessionPatch = {
  status?: SessionStatus;
  coachCards?: Partial<CoachCards>;
  notes?: string;
  appendNotes?: string;
  adaptations?: Adaptation[];
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

export async function patchCookingSession(
  id: string,
  patch: SessionPatch
): Promise<CookingSession | null> {
  const session = await getCookingSession(id);
  if (!session) return null;

  const error = validatePatch(patch);
  if (error) throw new Error(error);

  const updated = applyPatch(session, patch);
  await saveCookingSession(updated);
  return updated;
}

// ---------------------------------------------------------------------------
// Session factory: create from a recipe
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Auto-create session from today's meal plan
// ---------------------------------------------------------------------------

export async function createSessionFromPlan(
  date: string
): Promise<CookingSession | null> {
  // Already have a session? Return it.
  const existing = await getCookingSessionForDate(date);
  if (existing) return existing;

  // Find meal plan for this date's ISO week
  const d = new Date(date + "T12:00:00Z");
  const { year, week } = getISOWeek(d);
  const weekId = `${year}-W${String(week).padStart(2, "0")}`;
  const plan = await loadMealPlan(weekId);
  if (!plan) return null;

  // Find assigned recipe for this date
  const daySlot = plan.days.find((day) => day.date === date && day.recipeId);
  if (!daySlot?.recipeId) return null;

  const recipe = await getRecipe(daySlot.recipeId);
  if (!recipe) return null;

  const isMyRecipe = recipe.source?.cookbook === "My Recipes";
  const anchorType: AnchorType = isMyRecipe ? "my-recipe" : "kitchen-recipe";
  const provenance = {
    source: isMyRecipe ? "My Recipes" : recipe.source?.cookbook || "kitchen",
    author: recipe.source?.author,
  };

  const ingredients = recipe.ingredients.map((ing) => ({
    amount: ing.amount,
    item: ing.item,
    group: ing.group ?? null,
  }));

  const meal = daySlot.meal;
  const relatedRecipes: RelatedRecipe[] = [];
  if (meal?.sides) {
    for (const side of meal.sides) {
      relatedRecipes.push({ kind: "side", recipeId: side.id, title: side.name });
    }
  }
  const serveWith = meal?.serveWith ?? [];

  const session = buildSessionFromRecipe({
    date,
    recipeId: recipe.id,
    title: recipe.name,
    source: "meal-plan",
    provenance,
    anchorType,
    servings: recipe.servings || "4",
    ingredients,
    method: recipe.method,
    mealPlanRef: { week: weekId, day: daySlot.dayOfWeek },
    relatedRecipes,
    serveWith,
  });

  await saveCookingSession(session);
  return session;
}

// ---------------------------------------------------------------------------
// Session factory: create from a recipe
// ---------------------------------------------------------------------------

export function buildSessionFromRecipe(opts: {
  date: string;
  recipeId: string;
  title: string;
  source: CookingSession["source"];
  provenance: Anchor["provenance"];
  anchorType: AnchorType;
  servings: string;
  ingredients: SessionIngredient[];
  method: string[];
  mealPlanRef?: CookingSession["mealPlanRef"];
  relatedRecipes?: RelatedRecipe[];
  serveWith?: string[];
}): CookingSession {
  const now = new Date().toISOString();
  const id = `cook_${opts.date}_${opts.recipeId.slice(0, 30)}`;

  return {
    id,
    date: opts.date,
    status: "draft",
    source: opts.source,
    mealPlanRef: opts.mealPlanRef ?? null,
    anchor: {
      type: opts.anchorType,
      recipeId: opts.recipeId,
      title: opts.title,
      provenance: opts.provenance,
    },
    relatedRecipes: opts.relatedRecipes ?? [],
    serveWith: opts.serveWith ?? [],
    servings: {
      base: opts.servings,
      current: opts.servings,
    },
    ingredients: {
      base: opts.ingredients,
      session: [],
    },
    method: {
      base: opts.method,
      session: [],
    },
    adaptations: [],
    coachCards: {
      nextMove: null,
      upgrade: null,
      shortcut: null,
      wine: null,
    },
    notes: "",
    createdAt: now,
    updatedAt: now,
  };
}
