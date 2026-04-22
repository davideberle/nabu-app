import { getDb } from "./db";
import type { Recipe } from "./recipes";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CookingSession = {
  id: string;
  date: string; // YYYY-MM-DD (unique — one session per day)
  recipeId: string;
  recipeName: string;
  recipeData: Recipe;
  serveWith?: string[]; // free-text accompaniments from meal plan
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
  return {
    id: row["id"] as string,
    date: row["date"] as string,
    recipeId: row["recipe_id"] as string,
    recipeName: row["recipe_name"] as string,
    recipeData: JSON.parse(row["recipe_data"] as string) as Recipe,
    ...(serveWithRaw ? { serveWith: JSON.parse(serveWithRaw) as string[] } : {}),
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

/** Mark a session as completed. */
export async function completeSession(id: string): Promise<void> {
  const client = await getDb();
  const now = new Date().toISOString();
  await client.execute({
    sql: "UPDATE cooking_sessions SET status = 'completed', completed_at = ? WHERE id = ?",
    args: [now, id],
  });
}
