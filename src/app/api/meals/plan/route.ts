import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { saveMealPlan, loadMealPlan, type MealPlan } from "@/lib/meals";

export async function GET(request: NextRequest) {
  const week = request.nextUrl.searchParams.get("week");
  if (!week) {
    return NextResponse.json(
      { error: "Missing week query param" },
      { status: 400 }
    );
  }
  const plan = loadMealPlan(week);
  if (!plan) {
    return NextResponse.json(null);
  }
  return NextResponse.json(plan);
}

export async function POST(request: NextRequest) {
  try {
    const plan = (await request.json()) as MealPlan;
    if (!plan.week || !plan.days) {
      return NextResponse.json(
        { error: "Invalid plan data" },
        { status: 400 }
      );
    }
    saveMealPlan(plan);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to save plan" },
      { status: 500 }
    );
  }
}
