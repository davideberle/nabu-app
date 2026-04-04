import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getRecipe, getAllRecipes } from "@/lib/recipes";

export function generateStaticParams() {
  return getAllRecipes().map((recipe) => ({
    id: recipe.id,
  }));
}

// Capitalize first letter
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export default async function RecipePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const recipe = getRecipe(id);

  if (!recipe) {
    notFound();
  }

  // Group ingredients by their group
  const ingredientGroups: { name: string | null; items: typeof recipe.ingredients }[] = [];
  let currentGroup: string | null = null;
  let currentItems: typeof recipe.ingredients = [];

  for (const ing of recipe.ingredients) {
    const group = ing.group || null;
    if (group !== currentGroup) {
      if (currentItems.length > 0) {
        ingredientGroups.push({ name: currentGroup, items: currentItems });
      }
      currentGroup = group;
      currentItems = [ing];
    } else {
      currentItems.push(ing);
    }
  }
  if (currentItems.length > 0) {
    ingredientGroups.push({ name: currentGroup, items: currentItems });
  }

  return (
    <div className="min-h-screen bg-[#f8f6f3] dark:bg-stone-950">
      {/* Back button */}
      <div className="fixed top-4 left-4 z-10">
        <Link
          href="/recipes"
          className="flex items-center justify-center w-10 h-10 rounded-full bg-white/95 dark:bg-stone-900/95 shadow-lg backdrop-blur text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
      </div>

      {/* Hero image */}
      {recipe.image && (
        <div className="relative h-[65vh] w-full">
          <Image
            src={recipe.image}
            alt={recipe.name}
            fill
            className="object-cover object-center"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/10" />
        </div>
      )}

      <main className="relative max-w-2xl mx-auto px-4 -mt-24 pb-16">
        <article className="bg-white dark:bg-stone-900 rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <header className="px-8 pt-10 pb-6">
            {/* Source line */}
            <p className="text-xs tracking-widest uppercase text-stone-400 dark:text-stone-500 mb-4">
              {recipe.source.author} — {recipe.source.cookbook}
            </p>
            
            <h1 className="text-3xl md:text-4xl font-serif text-stone-800 dark:text-stone-100 leading-tight tracking-tight">
              {recipe.name}
            </h1>
            
            {/* Dish type tags */}
            <div className="flex gap-3 mt-5">
              {recipe.category.dish_type.map((type) => (
                <span
                  key={type}
                  className="text-xs tracking-wide text-stone-500 dark:text-stone-400"
                >
                  {capitalize(type)}
                </span>
              ))}
              <span className="text-stone-300 dark:text-stone-600">·</span>
              <span className="text-xs tracking-wide text-stone-500 dark:text-stone-400">
                {capitalize(recipe.servings)}
              </span>
              <span className="text-stone-300 dark:text-stone-600">·</span>
              <span className="text-xs tracking-wide text-stone-500 dark:text-stone-400">
                {recipe.time.total} min
              </span>
            </div>
          </header>

          {/* Decorative divider */}
          <div className="flex items-center justify-center py-2">
            <div className="w-16 h-px bg-stone-200 dark:bg-stone-700" />
          </div>

          {/* Introduction */}
          {recipe.introduction && (
            <section className="px-8 py-6">
              <p className="text-stone-600 dark:text-stone-400 font-serif text-lg leading-relaxed whitespace-pre-line">
                {recipe.introduction}
              </p>
            </section>
          )}

          {/* Ingredients */}
          <section className="px-8 py-8 bg-[#faf9f7] dark:bg-stone-800/30">
            <h2 className="text-xs tracking-widest uppercase text-stone-400 dark:text-stone-500 mb-6">
              Ingredients
            </h2>
            
            {ingredientGroups.map((group, groupIndex) => (
              <div key={groupIndex} className={groupIndex > 0 ? "mt-6" : ""}>
                {group.name && (
                  <h3 className="text-sm font-medium text-stone-700 dark:text-stone-300 mb-3 pb-1 border-b border-stone-200 dark:border-stone-700">
                    {group.name}
                  </h3>
                )}
                <ul className="space-y-2">
                  {group.items.map((ing, i) => (
                    <li
                      key={i}
                      className="flex justify-between items-baseline"
                    >
                      <span className="text-stone-700 dark:text-stone-300">
                        {capitalize(ing.item)}
                      </span>
                      <span className="text-stone-400 dark:text-stone-500 text-sm ml-4 tabular-nums">
                        {ing.amount}{ing.unit && ` ${ing.unit}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>

          {/* Method */}
          <section className="px-8 py-8">
            <h2 className="text-xs tracking-widest uppercase text-stone-400 dark:text-stone-500 mb-6">
              Method
            </h2>
            <ol className="space-y-6">
              {recipe.method.map((step, i) => (
                <li key={i} className="flex gap-5">
                  <span className="flex-shrink-0 text-2xl font-serif text-stone-300 dark:text-stone-600 leading-none pt-1">
                    {i + 1}
                  </span>
                  <p className="text-stone-600 dark:text-stone-400 leading-relaxed">
                    {step}
                  </p>
                </li>
              ))}
            </ol>
          </section>

          {/* Serving suggestions */}
          {recipe.serving && (
            <section className="px-8 py-5 border-t border-stone-100 dark:border-stone-800">
              <p className="text-sm text-stone-500 dark:text-stone-400 italic">
                {recipe.serving}
              </p>
            </section>
          )}

          {/* Related recipes */}
          {recipe.related_recipes && recipe.related_recipes.length > 0 && (
            <section className="px-8 py-4 border-t border-stone-100 dark:border-stone-800">
              <p className="text-xs text-stone-400 dark:text-stone-500">
                See also:{" "}
                {recipe.related_recipes.map((rel, i) => (
                  <span key={i}>
                    {i > 0 && ", "}
                    <span className="text-stone-600 dark:text-stone-400">{rel.name}</span>
                  </span>
                ))}
              </p>
            </section>
          )}

          {/* Footer - dietary tags */}
          {recipe.tags.dietary.length > 0 && (
            <footer className="px-8 py-4 bg-[#faf9f7] dark:bg-stone-800/30 border-t border-stone-100 dark:border-stone-800">
              <div className="flex gap-3">
                {recipe.tags.dietary.map((tag) => (
                  <span
                    key={tag}
                    className="text-xs text-stone-400 dark:text-stone-500"
                  >
                    {capitalize(tag)}
                  </span>
                ))}
              </div>
            </footer>
          )}
        </article>
      </main>
    </div>
  );
}
