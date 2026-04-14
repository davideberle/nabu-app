import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getCuisines, getRecipesByCuisine, getDietary, formatServings } from "@/lib/recipes";

export const revalidate = 60;

function capitalize(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export async function generateStaticParams() {
  const cuisines = await getCuisines();
  return cuisines.map((c) => ({ slug: c.slug }));
}

export default async function CuisinePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const cuisines = await getCuisines();
  const cuisine = cuisines.find(c => c.slug === slug);

  if (!cuisine) {
    notFound();
  }

  const recipes = await getRecipesByCuisine(slug);

  return (
    <div className="min-h-screen bg-[#f8f6f3] dark:bg-stone-950 pb-20">
      <header className="border-b border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            href="/recipes"
            className="text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-xl font-serif text-stone-800 dark:text-stone-100">
              {cuisine.name} Recipes
            </h1>
            <p className="text-xs text-stone-400 dark:text-stone-500">
              {recipes.length} recipes
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {recipes.map((recipe) => {
            const dietary = getDietary(recipe);

            return (
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
                  <div className="h-32 w-full bg-gradient-to-br from-stone-100 to-stone-200 dark:from-stone-800 dark:to-stone-900 flex items-center justify-center">
                    <span className="font-serif text-4xl text-stone-300 dark:text-stone-600 select-none">{recipe.name.charAt(0)}</span>
                  </div>
                )}
                <div className="p-4">
                  <h2 className="font-serif text-stone-800 dark:text-stone-100 group-hover:text-stone-600 dark:group-hover:text-stone-300 transition-colors leading-snug">
                    {recipe.name}
                  </h2>

                  <div className="flex items-center gap-2 mt-2 text-xs text-stone-400 dark:text-stone-500">
                    {recipe.servings && <span>{formatServings(recipe.servings)}</span>}
                    {recipe.source?.cookbook && (
                      <>
                        <span>·</span>
                        <span>{recipe.source.cookbook}</span>
                      </>
                    )}
                  </div>

                  {dietary.length > 0 && (
                    <div className="flex gap-1.5 mt-2">
                      {dietary.slice(0, 2).map((tag: string) => (
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
      </main>
    </div>
  );
}
