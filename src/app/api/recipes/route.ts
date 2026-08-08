import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { evaluatePlannerWriteAccess } from "@/lib/access";
import {
  createMyRecipe,
  updateMyRecipe,
  deleteMyRecipe,
  getAllMyRecipes,
} from "@/lib/db";

export async function GET() {
  const recipes = await getAllMyRecipes();
  return NextResponse.json(recipes);
}

// My Recipes rows are planner candidate inputs (dish_type/meal_role drive the
// main gate), so every mutation needs the canonical authorized session. The
// add-recipe runtime writes Turso directly and does not use this route.
export async function POST(request: NextRequest) {
  const access = evaluatePlannerWriteAccess(await auth());
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const recipe = await request.json();

  if (!recipe.id || !recipe.name) {
    return NextResponse.json(
      { error: "id and name are required" },
      { status: 400 }
    );
  }

  await createMyRecipe(recipe);
  revalidatePath("/recipes");
  revalidatePath("/recipes/cookbook/my-recipes");
  revalidatePath(`/recipes/${recipe.id}`);
  return NextResponse.json(recipe, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const access = evaluatePlannerWriteAccess(await auth());
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const recipe = await request.json();

  if (!recipe.id) {
    return NextResponse.json(
      { error: "id is required" },
      { status: 400 }
    );
  }

  await updateMyRecipe(recipe.id, recipe);
  revalidatePath("/recipes");
  revalidatePath("/recipes/cookbook/my-recipes");
  revalidatePath(`/recipes/${recipe.id}`);
  return NextResponse.json(recipe);
}

export async function DELETE(request: NextRequest) {
  const access = evaluatePlannerWriteAccess(await auth());
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { id } = await request.json();

  if (!id) {
    return NextResponse.json(
      { error: "id is required" },
      { status: 400 }
    );
  }

  const deleted = await deleteMyRecipe(id);
  if (!deleted) {
    return NextResponse.json(
      { error: `Recipe "${id}" not found` },
      { status: 404 }
    );
  }

  revalidatePath("/recipes");
  revalidatePath("/recipes/cookbook/my-recipes");
  revalidatePath(`/recipes/${id}`);
  return NextResponse.json({ ok: true });
}
