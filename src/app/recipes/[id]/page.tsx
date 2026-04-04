import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getRecipe, getAllRecipes } from "@/lib/recipes";

export function generateStaticParams() {
  return getAllRecipes().map((recipe) => ({
    id: recipe.id,
  }));
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

  // Group ingredients by their group (e.g., "Dressing", "Saffron yogurt")
  const ingredientGroups: { name: string | null; items: typeof recipe.ingredients }[] = [];
  let currentGroup: string | null = null;
  let currentItems: typeof recipe.ingredients = [];

  for (const ing of recipe.ingredients) {
    if (ing.group !== currentGroup) {
      if (currentItems.length > 0) {
        ingredientGroups.push({ name: currentGroup, items: currentItems });
      }
      currentGroup = ing.group || null;
      currentItems = [ing];
    } else {
      currentItems.push(ing);
    }
  }
  if (currentItems.length > 0) {
    ingredientGroups.push({ name: currentGroup, items: currentItems });
  }

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950">
      {/* Back button */}
      <div className="fixed top-4 left-4 z-10">
        <Link
          href="/recipes"
          className="flex items-center justify-center w-10 h-10 rounded-full bg-white/90 dark:bg-stone-900/90 shadow-lg backdrop-blur text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors"
        >
          ←
        </Link>
      </div>

      {/* Hero image */}
      {recipe.image && (
        <div className="relative h-[50vh] w-full">
          <Image
            src={recipe.image}
            alt={recipe.name}
            fill
            className="object-cover"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-t from-stone-950/80 via-stone-950/20 to-transparent" />
        </div>
      )}

      <main className="relative max-w-2xl mx-auto px-6 -mt-32 pb-16">
        <article className="bg-white dark:bg-stone-900 rounded-2xl shadow-xl overflow-hidden">
          {/* Header */}
          <header className="px-6 pt-8 pb-6 border-b border-stone-100 dark:border-stone-800">
            <h1 className="text-2xl md:text-3xl font-serif font-medium text-stone-900 dark:text-stone-100 leading-tight">
              {recipe.name}
            </h1>
            <div className="flex items-center gap-2 mt-3 text-sm text-stone-500 dark:text-stone-400">
              <span>{recipe.source.cookbook}</span>
              {recipe.source.page && (
                <>
                  <span>•</span>
                  <span>p. {recipe.source.page}</span>
                </>
              )}
            </div>
            
            {/* Quick facts */}
            <div className="flex items-center gap-4 mt-4 text-sm text-stone-600 dark:text-stone-400">
              <span>{recipe.servings}</span>
              <span>•</span>
              <span>{recipe.time.total} minutes</span>
            </div>

            {/* Dish type tags */}
            <div className="flex gap-2 mt-4 flex-wrap">
              {recipe.category.dish_type.map((type) => (
                <span
                  key={type}
                  className="text-xs px-2.5 py-1 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-full capitalize"
                >
                  {type}
                </span>
              ))}
            </div>
          </header>

          {/* Introduction - Chef's voice */}
          {recipe.introduction && (
            <section className="px-6 py-6 bg-stone-50 dark:bg-stone-800/50">
              <p className="text-stone-600 dark:text-stone-400 font-serif italic leading-relaxed whitespace-pre-line">
                {recipe.introduction}
              </p>
            </section>
          )}

          {/* Ingredients */}
          <section className="px-6 py-6 border-b border-stone-100 dark:border-stone-800">
            <h2 className="text-lg font-medium text-stone-900 dark:text-stone-100 mb-4">
              Ingredients
            </h2>
            
            {ingredientGroups.map((group, groupIndex) => (
              <div key={groupIndex} className={groupIndex > 0 ? "mt-4" : ""}>
                {group.name && (
                  <h3 className="text-sm font-medium text-stone-500 dark:text-stone-400 uppercase tracking-wide mb-2">
                    {group.name}
                  </h3>
                )}
                <ul className="space-y-2">
                  {group.items.map((ing, i) => (
                    <li
                      key={i}
                      className="flex justify-between items-baseline text-stone-700 dark:text-stone-300"
                    >
                      <span className="font-serif">{ing.original}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>

          {/* Method */}
          <section className="px-6 py-6 border-b border-stone-100 dark:border-stone-800">
            <h2 className="text-lg font-medium text-stone-900 dark:text-stone-100 mb-4">
              Method
            </h2>
            <ol className="space-y-6">
              {recipe.method.map((step, i) => (
                <li key={i} className="flex gap-4">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 flex items-center justify-center text-sm font-medium">
                    {i + 1}
                  </span>
                  <p className="text-stone-700 dark:text-stone-300 font-serif leading-relaxed pt-0.5">
                    {step}
                  </p>
                </li>
              ))}
            </ol>
          </section>

          {/* Serving suggestions */}
          {recipe.serving && (
            <section className="px-6 py-4 bg-amber-50/50 dark:bg-amber-900/10">
              <p className="text-sm text-stone-600 dark:text-stone-400 font-serif italic">
                <span className="font-medium not-italic">To serve:</span> {recipe.serving}
              </p>
            </section>
          )}

          {/* Related recipes */}
          {recipe.related_recipes && recipe.related_recipes.length > 0 && (
            <section className="px-6 py-4 border-t border-stone-100 dark:border-stone-800">
              <p className="text-sm text-stone-500 dark:text-stone-400">
                <span className="font-medium">See also:</span>{" "}
                {recipe.related_recipes.map((rel, i) => (
                  <span key={i}>
                    {i > 0 && ", "}
                    {rel.name}
                    {rel.page && <span className="text-stone-400"> (p. {rel.page})</span>}
                  </span>
                ))}
              </p>
            </section>
          )}

          {/* Footer - dietary tags */}
          <footer className="px-6 py-4 bg-stone-50 dark:bg-stone-800/30 flex items-center justify-between">
            <div className="flex gap-2 flex-wrap">
              {recipe.tags.dietary.map((tag) => (
                <span
                  key={tag}
                  className="text-xs px-2 py-0.5 bg-stone-200 dark:bg-stone-700 text-stone-600 dark:text-stone-400 rounded"
                >
                  {tag}
                </span>
              ))}
            </div>
            <span className="text-xs text-stone-400 dark:text-stone-500">
              {recipe.source.author}
            </span>
          </footer>
        </article>

        {/* Actions */}
        <div className="mt-6 flex gap-3">
          <button className="flex-1 py-3 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-xl text-center transition-colors">
            Start Cooking
          </button>
        </div>
      </main>
    </div>
  );
}
