// Cooking Session persistence and plan wiring.
// The session contract itself (types, normalization, patching, resync
// merging, display resolution) lives in ./cooking-session.ts, which is pure
// and unit-testable; this module owns database access and plan loading.
// Domain logic (anchor policy, adaptation lifecycle) lives in projects/live-cooking/.

import { createCookEventIfMissing, getDb } from "./db";
import { loadMealPlan } from "./meals-persistence";
import { getRecipe } from "./recipes";
import { getISOWeek } from "./meals";
import {
  applyPatch,
  drinkText,
  normalizeSession,
  resolveSessionCoherence,
  splitServeWith,
  syncSessionWithPlan,
  validatePatch,
  type AnchorType,
  type CookingSession,
  type RelatedRecipe,
  type SessionIngredient,
  type SessionPatch,
  type SessionStatus,
} from "./cooking-session";
import type { MealCoherenceReview } from "./meal-coherence";

export * from "./cooking-session";

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

type CookingSessionRow = Record<string, unknown>;

function safeParse<T>(raw: unknown): T | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function legacyRowToSession(row: CookingSessionRow): CookingSession | null {
  const recipeId = row["recipe_id"] as string | null;
  const recipeName = row["recipe_name"] as string | null;
  const recipeData = safeParse<{
    source?: { cookbook?: string; author?: string };
    servings?: string;
    ingredients?: { amount?: string; item?: string; unit?: string; group?: string | null }[];
    method?: string[];
  }>(row["recipe_data"]);

  if (!recipeId || !recipeName || !recipeData) return null;

  const now = new Date().toISOString();
  const statusRaw = row["status"] as string | null;
  const status: SessionStatus =
    statusRaw === "completed" ? "completed" : statusRaw === "abandoned" ? "abandoned" : "active";
  const ingredients = (recipeData.ingredients ?? []).map((ing) => ({
    amount: ing.amount ?? "",
    item: ing.item ?? "",
    unit: ing.unit,
    group: ing.group ?? null,
  }));

  return {
    id: row["id"] as string,
    date: row["date"] as string,
    status,
    source: "meal-plan",
    mealPlanRef: null,
    anchor: {
      type: recipeData.source?.cookbook === "My Recipes" ? "my-recipe" : "kitchen-recipe",
      recipeId,
      title: recipeName,
      provenance: {
        source: recipeData.source?.cookbook || "kitchen",
        author: recipeData.source?.author,
      },
    },
    relatedRecipes: [],
    serveWith: safeParse<string[]>(row["serve_with"]) ?? [],
    servings: {
      base: recipeData.servings || "4",
      current: recipeData.servings || "4",
    },
    ingredients: { base: ingredients, session: [] },
    method: { base: recipeData.method ?? [], session: [] },
    adaptations: [],
    coachCards: { nextMove: null, upgrade: null, shortcut: null, wine: null },
    story: null,
    notes: "",
    createdAt: (row["created_at"] as string | null) || now,
    updatedAt:
      (row["updated_at"] as string | null) ||
      (row["started_at"] as string | null) ||
      (row["created_at"] as string | null) ||
      now,
  };
}

function rowToSession(row: CookingSessionRow): CookingSession | null {
  return normalizeSession(safeParse<CookingSession>(row["data"]) ?? legacyRowToSession(row));
}

export async function getCookingSessionForDate(
  date: string
): Promise<CookingSession | null> {
  const client = await getDb();
  const result = await client.execute({
    sql: `SELECT * FROM cooking_sessions
          WHERE date = ?
          ORDER BY COALESCE(updated_at, created_at) DESC
          LIMIT 1`,
    args: [date],
  });
  if (result.rows.length === 0) return null;
  return rowToSession(result.rows[0] as CookingSessionRow);
}

export async function getSessionsForDateRange(
  from: string,
  to: string
): Promise<CookingSession[]> {
  const client = await getDb();
  const result = await client.execute({
    sql: `SELECT * FROM cooking_sessions
          WHERE date >= ? AND date <= ?
          ORDER BY date`,
    args: [from, to],
  });
  return result.rows
    .map((row) => rowToSession(row as CookingSessionRow))
    .filter((session): session is CookingSession => session !== null);
}

export async function getCookingSession(
  id: string
): Promise<CookingSession | null> {
  const client = await getDb();
  const result = await client.execute({
    sql: "SELECT * FROM cooking_sessions WHERE id = ?",
    args: [id],
  });
  if (result.rows.length === 0) return null;
  return rowToSession(result.rows[0] as CookingSessionRow);
}

// Production still carries the original cooking_sessions schema with NOT NULL
// legacy columns (recipe_id, recipe_name, ...), while freshly migrated local
// databases only have the canonical (id, date, data, timestamps) shape.
// Detect once which shape we are writing to.
let _hasLegacySessionColumns: boolean | null = null;

async function hasLegacySessionColumns(
  client: Awaited<ReturnType<typeof getDb>>
): Promise<boolean> {
  if (_hasLegacySessionColumns !== null) return _hasLegacySessionColumns;
  const info = await client.execute("PRAGMA table_info(cooking_sessions)");
  _hasLegacySessionColumns = info.rows.some((row) => row["name"] === "recipe_id");
  return _hasLegacySessionColumns;
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

  const data = JSON.stringify(updated);

  if (!(await hasLegacySessionColumns(client))) {
    await client.execute({
      sql: `INSERT INTO cooking_sessions (id, date, data, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              date = excluded.date,
              data = excluded.data,
              updated_at = excluded.updated_at`,
      args: [updated.id, updated.date, data, updated.createdAt, now],
    });
    return;
  }

  // Keep writing the legacy columns too: production still has NOT NULL
  // constraints from the original cooking_sessions schema. The app reads the
  // canonical JSON `data` field when present, while these columns preserve
  // compatibility for existing table constraints and older rows.
  const legacyRecipeData = JSON.stringify({
    source: {
      cookbook: updated.anchor.provenance.source,
      author: updated.anchor.provenance.author,
    },
    servings: updated.servings.base,
    ingredients: updated.ingredients.base,
    method: updated.method.base,
  });
  const completedAt = updated.status === "completed" ? now : null;

  await client.execute({
    sql: `INSERT INTO cooking_sessions
            (id, date, recipe_id, recipe_name, recipe_data, status, current_step,
             started_at, completed_at, created_at, serve_with, data, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            date = excluded.date,
            recipe_id = excluded.recipe_id,
            recipe_name = excluded.recipe_name,
            recipe_data = excluded.recipe_data,
            status = excluded.status,
            completed_at = excluded.completed_at,
            serve_with = excluded.serve_with,
            data = excluded.data,
            updated_at = excluded.updated_at`,
    args: [
      updated.id,
      updated.date,
      updated.anchor.recipeId ?? updated.id,
      updated.anchor.title,
      legacyRecipeData,
      updated.status,
      0,
      updated.createdAt,
      completedAt,
      updated.createdAt,
      JSON.stringify(updated.serveWith),
      data,
      now,
    ],
  });
}

// ---------------------------------------------------------------------------
// Whole-meal coherence (derived on read, never persisted)
// ---------------------------------------------------------------------------

/**
 * Review a session as one meal, loading the recipes it references.
 *
 * `getRecipe` is the explicit-reference resolver: it reaches My Recipes and the
 * full static bundle including hidden cookbooks, which the browsable
 * `getAllRecipes` collection excludes. A session side from a hidden cookbook
 * must still be reviewed.
 *
 * The result is derived on every read and never stored: it is not written back
 * to the session row, and it never mutates the anchor's base lists (see
 * live-cooking DESIGN.md §3 rule 16).
 */
export async function deriveSessionCoherence(
  session: CookingSession
): Promise<MealCoherenceReview> {
  return resolveSessionCoherence(session, getRecipe);
}

/**
 * A session as the GET APIs return it: the stored session plus the derived
 * review under an extra top-level `coherence` key. Existing clients that read
 * only session fields are unaffected; `coherence` is never persisted, and the
 * POST route strips it if a client round-trips a GET response back.
 */
export type CookingSessionWithCoherence = CookingSession & {
  coherence: MealCoherenceReview;
};

export async function withSessionCoherence(
  session: CookingSession
): Promise<CookingSessionWithCoherence> {
  return { ...session, coherence: await deriveSessionCoherence(session) };
}

// ---------------------------------------------------------------------------
// Partial update (patch) support
// ---------------------------------------------------------------------------

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
  if (patch.status === "completed") {
    await recordCookEventForSession(updated);
  }
  return updated;
}

async function recordCookEventForSession(session: CookingSession): Promise<void> {
  const recipeIds = new Set<string>();
  if (session.anchor.recipeId) recipeIds.add(session.anchor.recipeId);
  if (session.main?.recipeId) recipeIds.add(session.main.recipeId);
  for (const related of session.relatedRecipes) {
    if (!related.recipeId) continue;
    // Components that were set aside tonight were not cooked.
    if (related.status && related.status !== "active") continue;
    recipeIds.add(related.recipeId);
  }
  if (recipeIds.size === 0) return;

  await Promise.all(
    [...recipeIds].map((recipeId) =>
      createCookEventIfMissing({
        recipeId,
        cookedOn: session.date,
        source: "live-cooking",
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Auto-create session from today's meal plan
// ---------------------------------------------------------------------------

export async function createSessionFromPlan(
  date: string
): Promise<CookingSession | null> {
  // Already have a session? For ad-hoc/Telegram sessions, return as-is —
  // resync must never overwrite an explicitly established session.
  // For meal-plan sessions, sync plan-derived fields below.
  const existing = await getCookingSessionForDate(date);
  if (existing && existing.source !== "meal-plan") return existing;

  // Find meal plan for this date's ISO week
  const d = new Date(date + "T12:00:00Z");
  const { year, week } = getISOWeek(d);
  const weekId = `${year}-W${String(week).padStart(2, "0")}`;
  const plan = await loadMealPlan(weekId);
  if (!plan) return existing ?? null;

  // Find assigned recipe for this date
  const daySlot = plan.days.find((day) => day.date === date && day.recipeId);
  if (!daySlot?.recipeId) return existing ?? null;

  const recipe = await getRecipe(daySlot.recipeId);
  if (!recipe) return existing ?? null;

  const isMyRecipe = recipe.source?.cookbook === "My Recipes";
  const anchorType: AnchorType = isMyRecipe ? "my-recipe" : "kitchen-recipe";
  const provenance = {
    source: isMyRecipe ? "My Recipes" : recipe.source?.cookbook || "kitchen",
    author: recipe.source?.author,
  };

  const ingredients = recipe.ingredients.map((ing) => ({
    amount: ing.amount,
    item: ing.item,
    unit: ing.unit,
    group: ing.group ?? null,
  }));

  const meal = daySlot.meal;
  const relatedRecipes: RelatedRecipe[] = [];
  if (meal?.sides) {
    for (const side of meal.sides) {
      const rawKind = (side as { kind?: string }).kind;
      const kind = rawKind === "starter" || rawKind === "dessert" ? rawKind : "side";
      relatedRecipes.push({ kind, recipeId: side.id, title: side.name });
    }
  }
  const planServeWith = splitServeWith(meal?.serveWith);
  const serveWith = planServeWith.food;
  const planDrink = drinkText(planServeWith.drinks);

  // Existing meal-plan session: sync plan-derived fields, preserve user edits
  if (existing) {
    const synced = syncSessionWithPlan(existing, {
      weekId,
      dayOfWeek: daySlot.dayOfWeek,
      anchorType,
      provenance,
      recipe: {
        id: recipe.id,
        name: recipe.name,
        servings: recipe.servings || "4",
        ingredients,
        method: recipe.method,
      },
      relatedRecipes,
      serveWithFood: serveWith,
      planDrink,
    });
    await saveCookingSession(synced);
    return synced;
  }

  // No existing session — create fresh
  const sessionBase = buildSessionFromRecipe({
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
  const session: CookingSession = {
    ...sessionBase,
    coachCards: {
      nextMove: null,
      upgrade: null,
      shortcut: null,
      wine: planDrink,
    },
  };

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
  provenance: CookingSession["anchor"]["provenance"];
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
    status: "active",
    source: opts.source,
    mealPlanRef: opts.mealPlanRef ?? null,
    anchor: {
      type: opts.anchorType,
      recipeId: opts.recipeId,
      title: opts.title,
      provenance: opts.provenance,
    },
    main: null,
    heroImage: null,
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
    story: null,
    notes: "",
    createdAt: now,
    updatedAt: now,
  };
}
