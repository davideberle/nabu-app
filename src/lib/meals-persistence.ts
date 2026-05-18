import { getDb } from "./db";
import type { MealPlan } from "./meals";

type MealDay = MealPlan["days"][number];

function timestamp(value: string | undefined | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasAssignedMeal(day: MealDay | undefined): boolean {
  return Boolean(day?.recipeId || day?.meal?.main?.id);
}

function isOpenDay(day: MealDay): boolean {
  return (
    !day.recipeId &&
    !day.recipeName &&
    !day.meal &&
    (day.planningState === undefined || day.planningState === "open")
  );
}

function preserveStoredAssignmentsForStaleSave(
  incomingPlan: MealPlan,
  storedPlan: MealPlan
): MealPlan {
  const incomingAt = timestamp(incomingPlan.updatedAt);
  const storedAt = timestamp(storedPlan.updatedAt);
  if (storedAt === null || (incomingAt !== null && incomingAt >= storedAt)) {
    return incomingPlan;
  }

  const storedDaysByDate = new Map(
    storedPlan.days.map((day) => [day.date, day])
  );
  const days = incomingPlan.days.map((incomingDay) => {
    const storedDay = storedDaysByDate.get(incomingDay.date);
    if (storedDay && isOpenDay(incomingDay) && hasAssignedMeal(storedDay)) {
      return storedDay;
    }
    return incomingDay;
  });

  return { ...incomingPlan, days };
}

export async function saveMealPlan(plan: MealPlan): Promise<void> {
  const client = await getDb();
  const now = new Date().toISOString();
  const existing = await client.execute({
    sql: "SELECT data, updated_at FROM meal_plans WHERE week = ?",
    args: [plan.week],
  });

  const storedPlan =
    existing.rows.length > 0
      ? (JSON.parse(existing.rows[0]["data"] as string) as MealPlan)
      : null;
  if (storedPlan && !storedPlan.updatedAt) {
    storedPlan.updatedAt = existing.rows[0]["updated_at"] as string | undefined;
  }
  const planToSave = storedPlan
    ? preserveStoredAssignmentsForStaleSave(plan, storedPlan)
    : plan;
  const updatedPlan: MealPlan = {
    ...planToSave,
    updatedAt: now,
    createdAt: planToSave.createdAt || storedPlan?.createdAt || now,
  };

  await client.execute({
    sql: `INSERT INTO meal_plans (week, data, locked, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(week) DO UPDATE SET
            data = excluded.data,
            locked = excluded.locked,
            updated_at = excluded.updated_at`,
    args: [
      planToSave.week,
      JSON.stringify(updatedPlan),
      planToSave.locked ? 1 : 0,
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
