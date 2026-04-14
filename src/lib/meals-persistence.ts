import { getDb } from "./db";
import type { MealPlan } from "./meals";

export async function saveMealPlan(plan: MealPlan): Promise<void> {
  const client = await getDb();
  const now = new Date().toISOString();
  const updatedPlan: MealPlan = {
    ...plan,
    updatedAt: now,
    createdAt: plan.createdAt || now,
  };

  await client.execute({
    sql: `INSERT INTO meal_plans (week, data, locked, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(week) DO UPDATE SET
            data = excluded.data,
            locked = excluded.locked,
            updated_at = excluded.updated_at`,
    args: [
      plan.week,
      JSON.stringify(updatedPlan),
      plan.locked ? 1 : 0,
      updatedPlan.createdAt,
      now,
    ],
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
