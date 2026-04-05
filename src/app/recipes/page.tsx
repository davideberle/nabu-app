import Link from "next/link";
import Image from "next/image";
import { getAllRecipes, getCookbooks, getCuisines, getDietaryOptions, getDietary } from "@/lib/recipes";

function capitalize(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export default function RecipesPage() {
  const recipes = getAllRecipes();
  const cookbooks = getCookbooks();
  const cuisines = getCuisines();
  const dietaryOptions = getDietaryOptions();
  const recipesWithImages = recipes.filter(r => r.image);
  
  // Get 8 featured recipes with images
  const featuredRecipes = recipesWithImages.slice(0, 8);

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
              {recipes.length} recipes · {cookbooks.length} cookbooks
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* Search placeholder */}
        <div className="mb-8">
          <div className="relative">
            <input
              type="text"
              placeholder="Search recipes..."
              className="w-full px-4 py-3 pl-10 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-lg text-stone-700 dark:text-stone-200 placeholder:text-stone-400"
              disabled
            />
            <svg className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <p className="text-xs text-stone-400 mt-2 text-center">Search coming soon</p>
        </div>

        {/* Quick filter pills */}
        <div className="flex gap-2 mb-8 overflow-x-auto pb-2 -mx-4 px-4">
          <Link
            href="/recipes"
            className="text-xs px-4 py-2 bg-stone-800 dark:bg-stone-200 text-white dark:text-stone-900 rounded-full whitespace-nowrap font-medium"
          >
            All ({recipes.length})
          </Link>
          {dietaryOptions.slice(0, 2).map((d) => (
            <Link
              key={d.slug}
              href={`/recipes/dietary/${d.slug}`}
              className="text-xs px-4 py-2 bg-white dark:bg-stone-800 text-stone-600 dark:text-stone-300 rounded-full whitespace-nowrap hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors"
            >
              {d.name} ({d.count})
            </Link>
          ))}
          {cuisines.slice(0, 3).map((c) => (
            <Link
              key={c.slug}
              href={`/recipes/cuisine/${c.slug}`}
              className="text-xs px-4 py-2 bg-white dark:bg-stone-800 text-stone-600 dark:text-stone-300 rounded-full whitespace-nowrap hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors"
            >
              {c.name} ({c.count})
            </Link>
          ))}
        </div>

        {/* Browse by Cookbook */}
        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium tracking-widest uppercase text-stone-500 dark:text-stone-400">
              Browse by Cookbook
            </h2>
            <Link href="/recipes/cookbooks" className="text-xs text-stone-400 hover:text-stone-600 dark:hover:text-stone-300">
              View all →
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
            {cookbooks.slice(0, 6).map((cookbook) => (
              <Link
                key={cookbook.slug}
                href={`/recipes/cookbook/${cookbook.slug}`}
                className="group"
              >
                <div className="relative aspect-[3/4] rounded-lg overflow-hidden bg-stone-200 dark:bg-stone-800 shadow-sm group-hover:shadow-md transition-shadow">
                  {cookbook.cover ? (
                    <Image
                      src={cookbook.cover}
                      alt={cookbook.name}
                      fill
                      className="object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center p-2">
                      <span className="text-center font-serif text-stone-500 dark:text-stone-400 text-[10px] leading-tight">
                        {cookbook.name}
                      </span>
                    </div>
                  )}
                </div>
                <p className="text-[10px] text-stone-500 dark:text-stone-400 mt-1.5 text-center truncate">
                  {cookbook.count} recipes
                </p>
              </Link>
            ))}
          </div>
        </section>

        {/* Browse by Cuisine */}
        <section className="mb-10">
          <h2 className="text-sm font-medium tracking-widest uppercase text-stone-500 dark:text-stone-400 mb-4">
            Browse by Cuisine
          </h2>
          <div className="flex flex-wrap gap-2">
            {cuisines.map((cuisine) => (
              <Link
                key={cuisine.slug}
                href={`/recipes/cuisine/${cuisine.slug}`}
                className="px-4 py-2 bg-white dark:bg-stone-900 rounded-lg border border-stone-100 dark:border-stone-800 hover:border-stone-300 dark:hover:border-stone-600 transition-colors text-sm text-stone-700 dark:text-stone-300"
              >
                {cuisine.name}
                <span className="ml-2 text-stone-400 dark:text-stone-500">{cuisine.count}</span>
              </Link>
            ))}
          </div>
        </section>

        {/* Browse by Dietary */}
        <section className="mb-10">
          <h2 className="text-sm font-medium tracking-widest uppercase text-stone-500 dark:text-stone-400 mb-4">
            Dietary
          </h2>
          <div className="flex flex-wrap gap-2">
            {dietaryOptions.map((d) => (
              <Link
                key={d.slug}
                href={`/recipes/dietary/${d.slug}`}
                className="px-4 py-2 bg-white dark:bg-stone-900 rounded-lg border border-stone-100 dark:border-stone-800 hover:border-stone-300 dark:hover:border-stone-600 transition-colors text-sm text-stone-700 dark:text-stone-300"
              >
                {d.name}
                <span className="ml-2 text-stone-400 dark:text-stone-500">{d.count}</span>
              </Link>
            ))}
          </div>
        </section>

        {/* Featured Recipes with Images */}
        <section>
          <h2 className="text-sm font-medium tracking-widest uppercase text-stone-500 dark:text-stone-400 mb-4">
            Featured Recipes
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {featuredRecipes.map((recipe) => {
              const dietary = getDietary(recipe);
              return (
                <Link
                  key={recipe.id}
                  href={`/recipes/${recipe.id}`}
                  className="group rounded-lg bg-white dark:bg-stone-900 shadow-sm hover:shadow-md transition-shadow overflow-hidden"
                >
                  {recipe.image && (
                    <div className="relative h-36 w-full overflow-hidden">
                      <Image
                        src={recipe.image}
                        alt={recipe.name}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    </div>
                  )}
                  <div className="p-3">
                    <h3 className="font-serif text-sm text-stone-800 dark:text-stone-100 group-hover:text-stone-600 dark:group-hover:text-stone-300 leading-snug line-clamp-2">
                      {recipe.name}
                    </h3>
                    <p className="text-xs text-stone-400 dark:text-stone-500 mt-1">
                      {recipe.source?.cookbook}
                    </p>
                    {dietary.length > 0 && (
                      <div className="flex gap-1 mt-2">
                        {dietary.slice(0, 1).map((tag) => (
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
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
