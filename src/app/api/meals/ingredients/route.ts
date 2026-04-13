import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getRecipe } from "@/lib/recipes";

export async function POST(request: NextRequest) {
  try {
    const { recipeIds } = (await request.json()) as {
      recipeIds: string[];
    };
    if (!recipeIds || !Array.isArray(recipeIds)) {
      return NextResponse.json(
        { error: "Missing recipeIds array" },
        { status: 400 }
      );
    }

    const grouped: {
      recipeName: string;
      recipeId: string;
      ingredients: { item: string; amount: string }[];
    }[] = [];

    for (const id of recipeIds) {
      const recipe = await getRecipe(id);
      if (!recipe) continue;
      grouped.push({
        recipeName: recipe.name,
        recipeId: recipe.id,
        ingredients: recipe.ingredients.map((ing) => ({
          item: ing.item,
          amount: ing.amount,
        })),
      });
    }

    return NextResponse.json({ ingredients: grouped });
  } catch {
    return NextResponse.json(
      { error: "Failed to load ingredients" },
      { status: 500 }
    );
  }
}
