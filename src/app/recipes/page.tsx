import Link from "next/link";
import Image from "next/image";
import { getAllRecipes } from "@/lib/recipes";

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export default function RecipesPage() {
  const recipes = getAllRecipes();
  const recipesWithImages = recipes.filter(r => r.image);
  const chapters = [...new Set(recipes.map(r => r.category.chapter))];

  return (
    <div className="min-h-screen bg-[#f8f6f3] dark:bg-stone-950 pb-20">
      <header className="border-b border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            href="/"
            className="text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-xl font-serif text-stone-800 dark:text-stone-100">
              Recipes
            </h1>
            <p className="text-xs text-stone-400 dark:text-stone-500">
              {recipes.length} recipes · {recipesWithImages.length} with photos
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* Cookbook info */}
        <div className="mb-8 text-center">
          <p className="text-xs tracking-widest uppercase text-stone-400 dark:text-stone-500">
            Yotam Ottolenghi
          </p>
          <h2 className="text-2xl font-serif text-stone-700 dark:text-stone-200 mt-1">
            Ottolenghi: The Cookbook
          </h2>
        </div>

        {/* Chapter filters */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          {chapters.map((chapter) => (
            <span
              key={chapter}
              className="text-xs px-3 py-1.5 bg-white dark:bg-stone-800 text-stone-600 dark:text-stone-400 rounded-full whitespace-nowrap"
            >
              {chapter}
            </span>
          ))}
        </div>

        {/* Recipe Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {recipes.map((recipe) => (
            <Link
              key={recipe.id}
              href={`/recipes/${recipe.id}`}
              className="group rounded-xl bg-white dark:bg-stone-900 shadow-sm hover:shadow-lg transition-shadow overflow-hidden"
            >
              {recipe.image ? (
                <div className="relative h-44 w-full overflow-hidden">
                  <Image
                    src={recipe.image}
                    alt={recipe.name}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                </div>
              ) : (
                <div className="h-32 w-full bg-stone-100 dark:bg-stone-800 flex items-center justify-center">
                  <span className="text-3xl opacity-30">🍽️</span>
                </div>
              )}
              <div className="p-4">
                <h2 className="font-serif text-stone-800 dark:text-stone-100 group-hover:text-stone-600 dark:group-hover:text-stone-300 transition-colors leading-snug">
                  {recipe.name}
                </h2>
                
                <div className="flex items-center gap-2 mt-2 text-xs text-stone-400 dark:text-stone-500">
                  <span>{capitalize(recipe.servings)}</span>
                  <span>·</span>
                  <span>{recipe.category.chapter}</span>
                </div>

                {recipe.tags.dietary.length > 0 && (
                  <div className="flex gap-1.5 mt-2">
                    {recipe.tags.dietary.slice(0, 2).map((tag) => (
                      <span
                        key={tag}
                        className="text-[10px] px-1.5 py-0.5 bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 rounded"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
