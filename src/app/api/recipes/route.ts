import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
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

export async function POST(request: NextRequest) {
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
  return NextResponse.json(recipe, { status: 201 });
}

export async function PUT(request: NextRequest) {
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
  return NextResponse.json(recipe);
}

export async function DELETE(request: NextRequest) {
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
  return NextResponse.json({ ok: true });
}
