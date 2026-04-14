import { getDb } from "./db";
import type { MealPlan } from "./meals";

export async function saveMealPlan(plan: MealPlan): Promise<void> {
  const client = await getDb();
  await client.execute({
    sql: `INSERT OR REPLACE INTO meal_plans (week, data, updated_at)
          VALUES (?, ?, ?)`,
    args: [plan.week, JSON.stringify(plan), new Date().toISOString()],
  });
}

export async function loadMealPlan(weekId: string): Promise<MealPlan | null> {
  const client = await getDb();
  const result = await client.execute({
    sql: "SELECT data FROM meal_plans WHERE week = ?",
    args: [weekId],
  });
  if (result.rows.length === 0) return null;
  return JSON.parse(result.rows[0]["data"] as string) as MealPlan;
}
