import Link from "next/link";
import Image from "next/image";
import { getAllRecipes, getCookbooks, getCuisines, getDietaryOptions, getDietary, getCourseTags, getCuisine, searchRecipes } from "@/lib/recipes";
import { getCourseTagColor, normalizeTagLabel } from "@/lib/tag-colors";
import { NabuPageShell, NabuHeader, NabuMain, NabuSectionHeader, NabuCard, NabuBadge, NabuLinkButton, NabuEmptyState, cn } from "@/components/ui/nabu";

export const revalidate = 60;

type SearchParams = Promise<{ q?: string | string[] }>;

function firstSearchParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function RecipesPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const params = searchParams ? await searchParams : {};
  const query = firstSearchParam(params.q).trim();
  const recipes = await getAllRecipes();
  const cookbooks = await getCookbooks();
  const cuisines = await getCuisines();
  const dietaryOptions = await getDietaryOptions();
  const recipesWithImages = recipes.filter(r => r.image);
  const searchResults = query ? searchRecipes(query, recipes) : [];
  const searchBackHref = query ? `/recipes?q=${encodeURIComponent(query)}` : "/recipes";

  // Get 9 featured recipes with images (3 for hero mosaic + 6 for explore grid)
  const featuredRecipes = recipesWithImages.slice(0, 9);

  return (
    <NabuPageShell>
      <NabuHeader
        title="Recipes"
        subtitle={`${recipes.length} recipes · ${cookbooks.length} cookbooks`}
        backHref="/"
        maxWidth="5xl"
      />

      <NabuMain maxWidth="5xl">
        <form action="/recipes" method="get" className="mb-8">
          <div className="flex flex-col gap-2 rounded-lg border border-primary bg-primary p-3 shadow-xs sm:flex-row">
            <label htmlFor="recipe-search" className="sr-only">
              Search recipes
            </label>
            <input
              id="recipe-search"
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Search recipes, ingredients, cookbooks..."
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-secondary bg-secondary px-3 text-sm text-primary outline-none transition-colors placeholder:text-quaternary focus:border-brand-300 focus:bg-primary"
            />
            <div className="flex gap-2">
              {query ? (
                <NabuLinkButton href="/recipes" tone="ghost" className="shrink-0">
                  Clear
                </NabuLinkButton>
              ) : null}
              <button
                type="submit"
                className="min-h-11 shrink-0 rounded-full bg-brand-solid px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-solid_hover"
              >
                Search
              </button>
            </div>
          </div>
        </form>

        {query ? (
          <section>
            <NabuSectionHeader
              eyebrow="Search Results"
              title={`${searchResults.length} ${searchResults.length === 1 ? "recipe" : "recipes"} for “${query}”`}
              className="mb-5"
            />
            {searchResults.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {searchResults.map((recipe) => {
                  const dietary = getDietary(recipe);
                  const courseTags = getCourseTags(recipe);
                  const cuisine = recipe.cuisine
                    ? (Array.isArray(recipe.cuisine) ? recipe.cuisine[0] : recipe.cuisine)
                    : getCuisine(recipe);

                  return (
                    <NabuCard
                      key={recipe.id}
                      href={`/recipes/${recipe.id}?from=${encodeURIComponent(searchBackHref)}`}
                      className="p-0"
                    >
                      {recipe.image ? (
                        <div className="relative aspect-[4/3] w-full overflow-hidden">
                          <Image
                            src={recipe.image}
                            alt={recipe.name}
                            fill
                            className="object-cover group-hover:scale-105 transition-transform duration-500"
                            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                          />
                        </div>
                      ) : null}
                      <div className="p-4">
                        <h2 className="font-serif text-[15px] leading-snug text-primary line-clamp-2">
                          {recipe.name}
                        </h2>
                        <p className="mt-1.5 text-xs text-tertiary">
                          {[cuisine, recipe.source?.cookbook].filter(Boolean).join(" · ")}
                        </p>
                        {(courseTags.length > 0 || dietary.length > 0) && (
                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            {courseTags.slice(0, 2).map((tag) => (
                              <span
                                key={tag}
                                className={cn("text-[10px] px-2 py-0.5 rounded-full", getCourseTagColor(tag))}
                              >
                                {normalizeTagLabel(tag)}
                              </span>
                            ))}
                            {dietary.slice(0, 1).map((tag) => (
                              <NabuBadge key={tag} tone="stone">{tag}</NabuBadge>
                            ))}
                          </div>
                        )}
                      </div>
                    </NabuCard>
                  );
                })}
              </div>
            ) : (
              <NabuEmptyState
                title="No recipes found"
                description="Try another ingredient, cookbook, cuisine, or tag."
                action={<NabuLinkButton href="/recipes" tone="secondary">Browse recipes</NabuLinkButton>}
              />
            )}
          </section>
        ) : (
          <>
        {/* Hero mosaic — 2 large + 2 small featured recipes */}
        {featuredRecipes.length >= 4 && (
          <section className="mb-10">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {/* Primary hero — spans 2 rows on large screens */}
              <Link
                href={`/recipes/${featuredRecipes[0].id}?from=${encodeURIComponent('/recipes')}`}
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
                  href={`/recipes/${recipe.id}?from=${encodeURIComponent('/recipes')}`}
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
        <NabuCard href="/recipes/cookbook/my-recipes" className="p-0 mb-8">
          <div className="flex items-stretch">
            <div className="relative w-28 sm:w-36 shrink-0 overflow-hidden">
              <Image
                src="/cookbooks/my-recipes-cover.jpg"
                alt="My Recipes"
                fill
                className="object-cover group-hover:scale-105 transition-transform duration-300"
              />
            </div>
            <div className="flex flex-col justify-center px-5 py-4">
              <h2 className="font-serif text-lg text-primary leading-snug">My Recipes</h2>
              <p className="text-xs text-tertiary mt-1">
                Your personal collection · {cookbooks.find(c => c.slug === 'my-recipes')?.count ?? 0} recipes
              </p>
            </div>
          </div>
        </NabuCard>

        {/* Quick filter pills */}
        <div className="flex gap-2 mb-8 overflow-x-auto pb-2 -mx-4 px-4">
          <Link
            href="/recipes"
            className="text-xs px-4 py-2 bg-primary border border-primary text-primary rounded-full whitespace-nowrap font-medium shadow-xs hover:bg-primary_hover transition-colors"
          >
            All ({recipes.length})
          </Link>
          {dietaryOptions.slice(0, 2).map((d) => (
            <Link
              key={d.slug}
              href={`/recipes/dietary/${d.slug}`}
              className="text-xs px-4 py-2 bg-secondary border border-secondary text-secondary rounded-full whitespace-nowrap hover:bg-secondary_hover transition-colors"
            >
              {d.name} ({d.count})
            </Link>
          ))}
          {cuisines.slice(0, 3).map((c) => (
            <Link
              key={c.slug}
              href={`/recipes/cuisine/${c.slug}`}
              className="text-xs px-4 py-2 bg-secondary border border-secondary text-secondary rounded-full whitespace-nowrap hover:bg-secondary_hover transition-colors"
            >
              {c.name} ({c.count})
            </Link>
          ))}
        </div>

        {/* Browse by Cookbook */}
        <section className="mb-10">
          <NabuSectionHeader
            eyebrow="Browse by Cookbook"
            action={<NabuLinkButton href="/recipes/cookbooks" tone="ghost" size="sm">View all →</NabuLinkButton>}
            className="mb-4"
          />
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
            {cookbooks.slice(0, 6).map((cookbook) => (
              <Link
                key={cookbook.slug}
                href={`/recipes/cookbook/${cookbook.slug}`}
                className="group"
              >
                <div className="relative aspect-[3/4] rounded-xl overflow-hidden border border-primary bg-secondary shadow-xs group-hover:shadow-md transition-shadow">
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
                      <span className="text-center font-serif text-quaternary text-[10px] leading-tight">
                        {cookbook.name}
                      </span>
                    </div>
                  )}
                </div>
                <p className="text-[10px] text-tertiary mt-1.5 text-center truncate">
                  {cookbook.count} recipes
                </p>
              </Link>
            ))}
          </div>
        </section>

        {/* Browse by Cuisine */}
        <section className="mb-10">
          <NabuSectionHeader eyebrow="Browse by Cuisine" className="mb-4" />
          <div className="flex flex-wrap gap-2">
            {cuisines.map((cuisine) => (
              <Link
                key={cuisine.slug}
                href={`/recipes/cuisine/${cuisine.slug}`}
                className="px-4 py-2 bg-primary border border-primary rounded-xl text-sm text-primary hover:border-secondary_hover transition-colors"
              >
                {cuisine.name}
                <span className="ml-2 text-quaternary">{cuisine.count}</span>
              </Link>
            ))}
          </div>
        </section>

        {/* Browse by Dietary */}
        <section className="mb-10">
          <NabuSectionHeader eyebrow="Dietary" className="mb-4" />
          <div className="flex flex-wrap gap-2">
            {dietaryOptions.map((d) => (
              <Link
                key={d.slug}
                href={`/recipes/dietary/${d.slug}`}
                className="px-4 py-2 bg-primary border border-primary rounded-xl text-sm text-primary hover:border-secondary_hover transition-colors"
              >
                {d.name}
                <span className="ml-2 text-quaternary">{d.count}</span>
              </Link>
            ))}
          </div>
        </section>

        {/* More to explore — editorial recipe cards */}
        <section>
          <NabuSectionHeader eyebrow="More to explore" className="mb-5" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {featuredRecipes.slice(3, 9).map((recipe) => {
              const dietary = getDietary(recipe);
              const courseTags = getCourseTags(recipe);
              return (
                <NabuCard key={recipe.id} href={`/recipes/${recipe.id}?from=${encodeURIComponent('/recipes')}`} className="p-0">
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
                    <h3 className="font-serif text-[15px] text-primary leading-snug line-clamp-2">
                      {recipe.name}
                    </h3>
                    <p className="text-xs text-tertiary mt-1.5">
                      {recipe.source?.cookbook}
                    </p>
                    {(courseTags.length > 0 || dietary.length > 0) && (
                      <div className="flex gap-1.5 mt-2.5">
                        {courseTags.slice(0, 1).map((tag) => (
                          <span
                            key={tag}
                            className={cn("text-[10px] px-2 py-0.5 rounded-full", getCourseTagColor(tag))}
                          >
                            {normalizeTagLabel(tag)}
                          </span>
                        ))}
                        {dietary.slice(0, 1).map((tag) => (
                          <NabuBadge key={tag} tone="stone">{tag}</NabuBadge>
                        ))}
                      </div>
                    )}
                  </div>
                </NabuCard>
              );
            })}
          </div>
        </section>
          </>
        )}
      </NabuMain>
    </NabuPageShell>
  );
}
