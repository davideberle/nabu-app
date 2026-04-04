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

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 pb-20">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            href="/recipes"
            className="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            ← Recipes
          </Link>
        </div>
      </header>

      {/* Hero image */}
      {recipe.image && (
        <div className="relative h-64 w-full">
          <Image
            src={recipe.image}
            alt={recipe.name}
            fill
            className="object-cover"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          <div className="absolute bottom-4 left-4 right-4">
            <h1 className="text-2xl font-bold text-white">{recipe.name}</h1>
            <p className="text-white/80 text-sm mt-1">
              {recipe.cookbook} • {recipe.author}
            </p>
          </div>
        </div>
      )}

      <main className="max-w-3xl mx-auto px-4 py-6">
        {/* Header (if no image) */}
        {!recipe.image && (
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
              {recipe.name}
            </h1>
            <div className="flex items-center gap-3 mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              <span>{recipe.cookbook}</span>
              <span>•</span>
              <span>{recipe.author}</span>
            </div>
          </div>
        )}

        {/* Description */}
        {recipe.description && (
          <p className="text-zinc-600 dark:text-zinc-400 mb-6 italic">
            {recipe.description}
          </p>
        )}

        {/* Quick info */}
        <div className="flex items-center gap-4 mb-6">
          <span className="text-sm bg-zinc-100 dark:bg-zinc-800 px-3 py-1.5 rounded-lg">
            🕐 {recipe.time.total} min
          </span>
          <span className="text-sm bg-zinc-100 dark:bg-zinc-800 px-3 py-1.5 rounded-lg">
            👥 {recipe.servings} servings
          </span>
        </div>

        {/* Tags */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {recipe.tags.map((tag) => (
            <span
              key={tag}
              className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-full"
            >
              {tag}
            </span>
          ))}
        </div>

        {/* Ingredients */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
            Ingredients
          </h2>
          <ul className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800">
            {recipe.ingredients.map((ing, i) => (
              <li key={i} className="px-4 py-2.5 flex justify-between items-center">
                <span className="text-zinc-900 dark:text-zinc-100">
                  {ing.item}
                </span>
                <span className="text-zinc-500 dark:text-zinc-400 text-sm">
                  {ing.amount} {ing.unit}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Steps */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
            Method
          </h2>
          <ol className="space-y-4">
            {recipe.steps.map((step, i) => (
              <li key={i} className="flex gap-4">
                <span className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 flex items-center justify-center font-medium text-sm">
                  {i + 1}
                </span>
                <p className="text-zinc-700 dark:text-zinc-300 pt-1 leading-relaxed">
                  {step}
                </p>
              </li>
            ))}
          </ol>
        </section>

        {/* Actions */}
        <div className="flex gap-3">
          <button className="flex-1 py-3 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg text-center transition-colors">
            Start Cooking 👨‍🍳
          </button>
        </div>
      </main>
    </div>
  );
}
