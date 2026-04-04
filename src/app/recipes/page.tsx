import Link from "next/link";
import Image from "next/image";
import { getAllRecipes } from "@/lib/recipes";

export default function RecipesPage() {
  const recipes = getAllRecipes();

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 pb-20">
      <header className="border-b border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            href="/"
            className="text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
          >
            ← Back
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-2xl">🍳</span>
            <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">
              Recipes
            </h1>
          </div>
          <span className="text-sm text-stone-500 dark:text-stone-400">
            {recipes.length} recipes
          </span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* Cookbook label */}
        <div className="mb-6">
          <span className="text-sm px-3 py-1.5 bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 rounded-full">
            Ottolenghi: The Cookbook
          </span>
          <p className="text-sm text-stone-500 dark:text-stone-400 mt-2">
            142 recipes in collection • 5 processed
          </p>
        </div>

        {/* Recipe Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {recipes.map((recipe) => (
            <Link
              key={recipe.id}
              href={`/recipes/${recipe.id}`}
              className="group rounded-xl bg-white dark:bg-stone-900 shadow-sm hover:shadow-md transition-shadow overflow-hidden"
            >
              {recipe.image && (
                <div className="relative h-48 w-full overflow-hidden">
                  <Image
                    src={recipe.image}
                    alt={recipe.name}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                </div>
              )}
              <div className="p-4">
                <h2 className="font-serif text-lg text-stone-900 dark:text-stone-100 group-hover:text-amber-700 dark:group-hover:text-amber-400 transition-colors">
                  {recipe.name}
                </h2>
                
                <div className="flex items-center gap-2 mt-2 text-sm text-stone-500 dark:text-stone-400">
                  <span>{recipe.servings}</span>
                  <span>•</span>
                  <span>{recipe.time.total} min</span>
                </div>

                <div className="flex gap-2 mt-3 flex-wrap">
                  {recipe.category.dish_type.map((type) => (
                    <span
                      key={type}
                      className="text-xs px-2 py-0.5 bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 rounded capitalize"
                    >
                      {type}
                    </span>
                  ))}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
