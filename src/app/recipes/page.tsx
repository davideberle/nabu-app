import Link from "next/link";
import Image from "next/image";
import { getAllRecipes } from "@/lib/recipes";

const categoryColors: Record<string, string> = {
  starter: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  main: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  side: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  dessert: "bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300",
  baking: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
};

export default function RecipesPage() {
  const recipes = getAllRecipes();

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 pb-20">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            href="/"
            className="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            ← Back
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-2xl">🍳</span>
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              Recipes
            </h1>
          </div>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {recipes.length} recipes
          </span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* Cookbook label */}
        <div className="mb-4 flex items-center gap-2">
          <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            From:
          </span>
          <span className="text-sm px-2 py-1 bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 rounded-full">
            Ottolenghi: The Cookbook
          </span>
        </div>

        {/* Recipe Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {recipes.map((recipe) => (
            <Link
              key={recipe.id}
              href={`/recipes/${recipe.id}`}
              className="group rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors overflow-hidden"
            >
              {recipe.image && (
                <div className="relative h-40 w-full">
                  <Image
                    src={recipe.image}
                    alt={recipe.name}
                    fill
                    className="object-cover"
                  />
                </div>
              )}
              <div className="p-4">
                <h2 className="font-medium text-zinc-900 dark:text-zinc-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                  {recipe.name}
                </h2>
                {recipe.description && (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 line-clamp-2">
                    {recipe.description}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      categoryColors[recipe.category] || "bg-zinc-100"
                    }`}
                  >
                    {recipe.category}
                  </span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {recipe.time.total} min
                  </span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    👥 {recipe.servings}
                  </span>
                </div>
                <div className="flex gap-1 mt-2 flex-wrap">
                  {recipe.tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="text-xs px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </Link>
          ))}
        </div>

        <p className="mt-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
          142 recipes in collection • More being processed
        </p>
      </main>
    </div>
  );
}
