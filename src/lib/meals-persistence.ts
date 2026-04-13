import fs from "fs";
import path from "path";
import type { MealPlan } from "./meals";

const MEAL_PLANS_DIR =
  "/Users/claweberle/.openclaw/workspace/projects/kitchen/meal-plans";

export function saveMealPlan(plan: MealPlan): void {
  if (!fs.existsSync(MEAL_PLANS_DIR)) {
    fs.mkdirSync(MEAL_PLANS_DIR, { recursive: true });
  }
  const filePath = path.join(MEAL_PLANS_DIR, `${plan.week}.json`);
  fs.writeFileSync(filePath, JSON.stringify(plan, null, 2));
}

export function loadMealPlan(weekId: string): MealPlan | null {
  const filePath = path.join(MEAL_PLANS_DIR, `${weekId}.json`);
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content) as MealPlan;
  } catch {
    return null;
  }
}
