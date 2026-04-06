import { NextResponse } from "next/server";
import { getAllRecipes, getCuisine, getDietary } from "@/lib/recipes";
import { selectMealOptions } from "@/lib/meals";

function summarize(r: {
  id: string;
  name: string;
  source?: { cookbook: string; author: string; chapter?: string };
  image?: string | null;
  time?: { prep: number; cook: number; total: number };
  dietary?: string[];
  tags?: { dietary: string[] };
}) {
  return {
    id: r.id,
    name: r.name,
    source: r.source,
    image: r.image ?? null,
    dietary: getDietary(r as Parameters<typeof getDietary>[0]),
    cuisine: getCuisine(r as Parameters<typeof getCuisine>[0]),
    time: r.time ?? null,
  };
}

export async function GET() {
  const allRecipes = getAllRecipes();
  const { weekday, weekend } = selectMealOptions(allRecipes);
  return NextResponse.json({
    weekday: weekday.map(summarize),
    weekend: weekend.map(summarize),
  });
}
