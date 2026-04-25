import { getDb } from "./db";
import type { Recipe } from "./recipes";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TonightPlan = {
  summary?: string;
  sections: { title: string; items: string[] }[];
  updatedAt?: string;
};

export type CookingFeedback = {
  verdict: "great" | "good" | "okay" | "not-again";
  wouldCookAgain: boolean;
  notes?: string;
  keepForNextTime?: string[];
  changeNextTime?: string[];
  capturedAt: string;
};

export type CookingSession = {
  id: string;
  date: string; // YYYY-MM-DD (unique — one session per day)
  recipeId: string;
  recipeName: string;
  recipeData: Recipe;
  serveWith?: string[]; // free-text accompaniments from meal plan
  tonight?: TonightPlan; // runtime-updatable live plan for tonight
  feedback?: CookingFeedback; // post-cook feedback, set after completion
  status: "active" | "completed";
  currentStep: number;
  startedAt: string;
  completedAt?: string;
  createdAt: string;
};

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function rowToSession(row: Record<string, unknown>): CookingSession {
  const serveWithRaw = row["serve_with"] as string | null;
  const tonightRaw = row["tonight"] as string | null;
  const feedbackRaw = row["feedback"] as string | null;
  return {
    id: row["id"] as string,
    date: row["date"] as string,
    recipeId: row["recipe_id"] as string,
    recipeName: row["recipe_name"] as string,
    recipeData: JSON.parse(row["recipe_data"] as string) as Recipe,
    ...(serveWithRaw ? { serveWith: JSON.parse(serveWithRaw) as string[] } : {}),
    ...(tonightRaw ? { tonight: JSON.parse(tonightRaw) as TonightPlan } : {}),
    ...(feedbackRaw ? { feedback: JSON.parse(feedbackRaw) as CookingFeedback } : {}),
    status: row["status"] as CookingSession["status"],
    currentStep: row["current_step"] as number,
    startedAt: row["started_at"] as string,
    ...(row["completed_at"]
      ? { completedAt: row["completed_at"] as string }
      : {}),
    createdAt: row["created_at"] as string,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Get a cooking session by its id. */
export async function getSessionById(
  id: string
): Promise<CookingSession | null> {
  const client = await getDb();
  const result = await client.execute({
    sql: "SELECT * FROM cooking_sessions WHERE id = ?",
    args: [id],
  });
  if (result.rows.length === 0) return null;
  return rowToSession(result.rows[0] as Record<string, unknown>);
}

/** Get today's cooking session, or null if none exists. */
export async function getTodaySession(
  today?: string
): Promise<CookingSession | null> {
  const date = today ?? new Date().toISOString().split("T")[0];
  const client = await getDb();
  const result = await client.execute({
    sql: "SELECT * FROM cooking_sessions WHERE date = ?",
    args: [date],
  });
  if (result.rows.length === 0) return null;
  return rowToSession(result.rows[0] as Record<string, unknown>);
}

/** Create a new cooking session for a given date + recipe. */
export async function createCookingSession(params: {
  date: string;
  recipeId: string;
  recipeName: string;
  recipeData: Recipe;
  serveWith?: string[];
}): Promise<CookingSession> {
  const client = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const serveWithJson =
    params.serveWith?.length ? JSON.stringify(params.serveWith) : null;
  await client.execute({
    sql: `INSERT INTO cooking_sessions
            (id, date, recipe_id, recipe_name, recipe_data, serve_with, status, current_step, started_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?, ?)`,
    args: [
      id,
      params.date,
      params.recipeId,
      params.recipeName,
      JSON.stringify(params.recipeData),
      serveWithJson,
      now,
      now,
    ],
  });
  return {
    id,
    date: params.date,
    recipeId: params.recipeId,
    recipeName: params.recipeName,
    recipeData: params.recipeData,
    ...(params.serveWith?.length ? { serveWith: params.serveWith } : {}),
    status: "active",
    currentStep: 0,
    startedAt: now,
    createdAt: now,
  };
}

/** Update the current step pointer. */
export async function updateSessionStep(
  id: string,
  step: number
): Promise<void> {
  const client = await getDb();
  await client.execute({
    sql: "UPDATE cooking_sessions SET current_step = ? WHERE id = ?",
    args: [step, id],
  });
}

/** Update the stored recipe snapshot and metadata for a session. */
export async function updateSessionRecipeData(
  id: string,
  updates: {
    recipeName: string;
    recipeData: Recipe;
    serveWith?: string[] | null;
  }
): Promise<void> {
  const client = await getDb();
  const serveWithJson =
    updates.serveWith?.length ? JSON.stringify(updates.serveWith) : null;
  await client.execute({
    sql: `UPDATE cooking_sessions
          SET recipe_name = ?, recipe_data = ?, serve_with = ?
          WHERE id = ?`,
    args: [
      updates.recipeName,
      JSON.stringify(updates.recipeData),
      serveWithJson,
      id,
    ],
  });
}

/** Update the live "tonight" plan block. */
export async function updateSessionTonight(
  id: string,
  tonight: TonightPlan | null
): Promise<void> {
  const client = await getDb();
  await client.execute({
    sql: "UPDATE cooking_sessions SET tonight = ? WHERE id = ?",
    args: [tonight ? JSON.stringify(tonight) : null, id],
  });
}

/** Mark a session as completed. */
export async function completeSession(id: string): Promise<void> {
  const client = await getDb();
  const now = new Date().toISOString();
  await client.execute({
    sql: "UPDATE cooking_sessions SET status = 'completed', completed_at = ? WHERE id = ?",
    args: [now, id],
  });
}

/** Save post-cook feedback on a session. */
export async function updateSessionFeedback(
  id: string,
  feedback: CookingFeedback
): Promise<void> {
  const client = await getDb();
  await client.execute({
    sql: "UPDATE cooking_sessions SET feedback = ? WHERE id = ?",
    args: [JSON.stringify(feedback), id],
  });
}

// ---------------------------------------------------------------------------
// Date-range session lookup — used by planner history projection
// ---------------------------------------------------------------------------

export type SessionSummary = {
  date: string;
  recipeId: string;
  recipeName: string;
  status: CookingSession["status"];
};

/**
 * Get lightweight session summaries for a date range (inclusive).
 * Used by the planner to project planned-vs-cooked status per day.
 */
export async function getSessionsForDateRange(
  from: string,
  to: string,
): Promise<SessionSummary[]> {
  const client = await getDb();
  const result = await client.execute({
    sql: `SELECT date, recipe_id, recipe_name, status
          FROM cooking_sessions
          WHERE date >= ? AND date <= ?
          ORDER BY date ASC`,
    args: [from, to],
  });
  return result.rows.map((row) => ({
    date: (row as Record<string, unknown>)["date"] as string,
    recipeId: (row as Record<string, unknown>)["recipe_id"] as string,
    recipeName: (row as Record<string, unknown>)["recipe_name"] as string,
    status: (row as Record<string, unknown>)["status"] as CookingSession["status"],
  }));
}

// ---------------------------------------------------------------------------
// Recipe history — derived from completed cooking sessions
// ---------------------------------------------------------------------------

export type RecipeHistory = {
  recipeId: string;
  totalCooks: number;
  lastCooked: string; // YYYY-MM-DD
  recentFeedback: {
    date: string;
    verdict: CookingFeedback["verdict"];
    notes?: string;
  }[];
};

/** Derive cooking history for a recipe from completed sessions. */
export async function getRecipeHistory(
  recipeId: string
): Promise<RecipeHistory | null> {
  const client = await getDb();
  const result = await client.execute({
    sql: `SELECT date, feedback FROM cooking_sessions
          WHERE recipe_id = ? AND status = 'completed'
          ORDER BY date DESC`,
    args: [recipeId],
  });

  if (result.rows.length === 0) return null;

  const rows = result.rows as Record<string, unknown>[];
  const recentFeedback: RecipeHistory["recentFeedback"] = [];

  for (const row of rows.slice(0, 3)) {
    const fbRaw = row["feedback"] as string | null;
    if (fbRaw) {
      const fb = JSON.parse(fbRaw) as CookingFeedback;
      recentFeedback.push({
        date: row["date"] as string,
        verdict: fb.verdict,
        ...(fb.notes ? { notes: fb.notes } : {}),
      });
    }
  }

  return {
    recipeId,
    totalCooks: result.rows.length,
    lastCooked: rows[0]["date"] as string,
    recentFeedback,
  };
}
