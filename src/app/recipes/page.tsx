import Link from "next/link";
import Image from "next/image";
import { getAllRecipes, getCookbooks, getCuisines, getDietaryOptions, getDietary, getCourseTags } from "@/lib/recipes";
import { getCourseTagColor, normalizeTagLabel } from "@/lib/tag-colors";

export const revalidate = 60;

export default async function RecipesPage() {
  const recipes = await getAllRecipes();
  const cookbooks = await getCookbooks();
  const cuisines = await getCuisines();
  const dietaryOptions = await getDietaryOptions();
  const recipesWithImages = recipes.filter(r => r.image);

  // Get 9 featured recipes with images (3 for hero mosaic + 6 for explore grid)
  const featuredRecipes = recipesWithImages.slice(0, 9);

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
        {/* Hero mosaic — 2 large + 2 small featured recipes */}
        {featuredRecipes.length >= 4 && (
          <section className="mb-10">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {/* Primary hero — spans 2 rows on large screens */}
              <Link
                href={`/recipes/${featuredRecipes[0].id}`}
                className="group col-span-2 lg:col-span-2 lg:row-span-2 relative rounded-2xl overflow-hidden"
              >
                <div className="relative aspect-[16/9] lg:aspect-auto lg:h-full min-h-[240px]">
                  <Image
                    src={featuredRecipes[0].image!}
                    alt={featuredRecipes[0].name}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-700"
                    sizes="(min-width: 1024px) 66vw, 100vw"
                    priority
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
                  <div className="absolute bottom-4 left-5 right-5">
                    <p className="text-[10px] tracking-widest uppercase text-white/60 mb-1">
                      {featuredRecipes[0].source?.cookbook}
                    </p>
                    <h2 className="text-lg sm:text-xl font-serif text-white leading-snug drop-shadow-sm">
                      {featuredRecipes[0].name}
                    </h2>
                  </div>
                </div>
              </Link>
              {/* Secondary tiles */}
              {featuredRecipes.slice(1, 3).map((recipe) => (
                <Link
                  key={recipe.id}
                  href={`/recipes/${recipe.id}`}
                  className="group relative rounded-2xl overflow-hidden"
                >
                  <div className="relative aspect-[4/3]">
                    <Image
                      src={recipe.image!}
                      alt={recipe.name}
                      fill
                      className="object-cover group-hover:scale-105 transition-transform duration-500"
                      sizes="(min-width: 1024px) 33vw, 50vw"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                    <div className="absolute bottom-3 left-3 right-3">
                      <h3 className="text-sm font-serif text-white leading-snug drop-shadow-sm line-clamp-2">
                        {recipe.name}
                      </h3>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* My Recipes quick access */}
        <Link
          href="/recipes/cookbook/my-recipes"
          className="group block mb-8 rounded-xl overflow-hidden bg-white dark:bg-stone-900 shadow-sm hover:shadow-md transition-shadow"
        >
          <div className="flex items-stretch">
            <div className="relative w-28 sm:w-36 shrink-0">
              <Image
                src="/cookbooks/my-recipes-cover.jpg"
                alt="My Recipes"
                fill
                className="object-cover group-hover:scale-105 transition-transform duration-300"
              />
            </div>
            <div className="flex flex-col justify-center px-5 py-4">
              <h2 className="font-serif text-lg text-stone-800 dark:text-stone-100 group-hover:text-stone-600 dark:group-hover:text-stone-300">
                My Recipes
              </h2>
              <p className="text-xs text-stone-400 dark:text-stone-500 mt-1">
                Your personal collection · {cookbooks.find(c => c.slug === 'my-recipes')?.count ?? 0} recipes
              </p>
            </div>
          </div>
        </Link>

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
                      sizes="(min-width: 1024px) 16vw, (min-width: 640px) 25vw, 50vw"
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

        {/* More to explore — editorial recipe cards */}
        <section>
          <h2 className="text-sm font-medium tracking-widest uppercase text-stone-500 dark:text-stone-400 mb-5">
            More to explore
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {featuredRecipes.slice(3, 9).map((recipe) => {
              const dietary = getDietary(recipe);
              const courseTags = getCourseTags(recipe);
              return (
                <Link
                  key={recipe.id}
                  href={`/recipes/${recipe.id}`}
                  className="group rounded-xl bg-white dark:bg-stone-900 shadow-sm hover:shadow-md transition-all overflow-hidden"
                >
                  {recipe.image && (
                    <div className="relative aspect-[4/3] w-full overflow-hidden">
                      <Image
                        src={recipe.image}
                        alt={recipe.name}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-500"
                        sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                      />
                    </div>
                  )}
                  <div className="p-4">
                    <h3 className="font-serif text-[15px] text-stone-800 dark:text-stone-100 group-hover:text-stone-600 dark:group-hover:text-stone-300 leading-snug line-clamp-2">
                      {recipe.name}
                    </h3>
                    <p className="text-xs text-stone-400 dark:text-stone-500 mt-1.5">
                      {recipe.source?.cookbook}
                    </p>
                    {(courseTags.length > 0 || dietary.length > 0) && (
                      <div className="flex gap-1.5 mt-2.5">
                        {courseTags.slice(0, 1).map((tag) => (
                          <span
                            key={tag}
                            className={`text-[10px] px-2 py-0.5 rounded-full ${getCourseTagColor(tag)}`}
                          >
                            {normalizeTagLabel(tag)}
                          </span>
                        ))}
                        {dietary.slice(0, 1).map((tag) => (
                          <span
                            key={tag}
                            className="text-[10px] px-2 py-0.5 bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 rounded-full"
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
