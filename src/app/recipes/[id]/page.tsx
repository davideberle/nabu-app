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

// Abbreviate and clean up measurements
function cleanAmount(amount: string): string {
  if (!amount) return '';
  return amount
    // Remove imperial measurements in brackets
    .replace(/\s*\([^)]*oz[^)]*\)/gi, '')
    .replace(/\s*\([^)]*lb[^)]*\)/gi, '')
    .replace(/\s*\([^)]*cup[^)]*\)/gi, '')
    .replace(/\s*\([^)]*inch[^)]*\)/gi, '')
    .replace(/\s*\([^)]*in\)/gi, '')
    // Abbreviate common units
    .replace(/\btablespoons?\b/gi, 'tbsp')
    .replace(/\bteaspoons?\b/gi, 'tsp')
    .replace(/\bkilograms?\b/gi, 'kg')
    .replace(/\bgrams?\b/gi, 'g')
    .replace(/\bmillilitres?\b/gi, 'ml')
    .replace(/\blitres?\b/gi, 'l')
    // Clean up extra spaces
    .replace(/\s+/g, ' ')
    .trim();
}

// Get cuisine from cookbook
function getCuisineFromCookbook(cookbook?: string): string | null {
  if (!cookbook) return null;
  const map: Record<string, string> = {
    'Plentiful': 'Caribbean',
    'Ottolenghi: The Cookbook': 'Middle Eastern',
    'Jerusalem': 'Middle Eastern',
    'Falastin': 'Palestinian',
    'Persiana': 'Persian',
    'The Curry Guy': 'Indian',
    'The Curry Guy Bible': 'Indian',
    'The Indian Vegan': 'Indian',
    'Vietnamese Food Any Day': 'Vietnamese',
    'Vegan Vietnamese': 'Vietnamese',
    'Afro-Vegan': 'African & Caribbean',
    'The Vegan Korean': 'Korean',
    'Four Seasons': 'Italian',
    'Souk to Table': 'Middle Eastern',
    'Black Rican Vegan': 'Caribbean',
    'Vegan Nigerian Kitchen': 'Nigerian',
    'Tagine Cookbook': 'Moroccan',
    'Land of Fish and Rice': 'Chinese',
    'Brunch Cookbook': 'American',
    'Vegan Chocolate': 'Desserts',
    'The High-Protein Vegan Cookbook': 'Vegan',
    'Zagami Family Cookbook': 'Italian',
  };
  return map[cookbook] || null;
}

// Format cooking time
function formatTime(time?: { prep?: string; cook?: string; total?: string | number }): string | null {
  if (!time) return null;
  
  // If we have total, use that
  if (time.total) return typeof time.total === 'number' ? `${time.total} min` : time.total;
  
  // Try to extract numbers from prep/cook strings
  const prepMatch = time.prep?.match(/(\d+)/);
  const cookMatch = time.cook?.match(/(\d+)/);
  
  const prep = prepMatch ? parseInt(prepMatch[1]) : 0;
  const cook = cookMatch ? parseInt(cookMatch[1]) : 0;
  
  if (prep + cook > 0) {
    return `${prep + cook} min`;
  }
  
  return null;
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
      {recipe.image ? (
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
      ) : (
        // Spacer for recipes without images
        <div className="h-20" />
      )}

      <main className={`relative max-w-2xl mx-auto px-4 pb-16 ${recipe.image ? '-mt-24' : 'pt-4'}`}>
        <article className="bg-white dark:bg-stone-900 rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <header className="px-8 pt-10 pb-6">
            {/* Source line with cuisine */}
            {recipe.source && (
            <p className="text-xs tracking-widest uppercase text-stone-400 dark:text-stone-500 mb-4">
              {getCuisineFromCookbook(recipe.source.cookbook) && (
                <span className="text-stone-600 dark:text-stone-300">{getCuisineFromCookbook(recipe.source.cookbook)} · </span>
              )}
              {recipe.source.author} — {recipe.source.cookbook}
            </p>
            )}
            
            <h1 className="text-3xl md:text-4xl font-serif text-stone-800 dark:text-stone-100 leading-tight tracking-tight">
              {recipe.name}
            </h1>
            
            {/* Dish type tags */}
            {recipe.category?.dish_type && (
            <div className="flex gap-3 mt-5">
              {recipe.category.dish_type.map((type) => (
                <span
                  key={type}
                  className="text-xs tracking-wide text-stone-500 dark:text-stone-400"
                >
                  {capitalize(type)}
                </span>
              ))}
            </div>
            )}
            <div className="flex gap-3 mt-2 flex-wrap">
              {recipe.servings && (
              <span className="text-xs tracking-wide text-stone-500 dark:text-stone-400">
                {capitalize(recipe.servings)}
              </span>
              )}
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {formatTime(recipe.time as any) && (
              <>
              <span className="text-stone-300 dark:text-stone-600">·</span>
              <span className="text-xs tracking-wide text-stone-500 dark:text-stone-400">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                ⏱ {formatTime(recipe.time as any)}
              </span>
              </>
              )}
            </div>
          </header>

          {/* Decorative divider */}
          <div className="flex items-center justify-center py-2">
            <div className="w-16 h-px bg-stone-200 dark:bg-stone-700" />
          </div>

          {/* Introduction */}
          {(recipe.introduction || recipe.intro) && (
            <section className="px-8 py-6">
              <p className="text-stone-600 dark:text-stone-400 font-serif text-lg leading-relaxed whitespace-pre-line">
                {recipe.introduction || recipe.intro}
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
                        {cleanAmount(ing.amount)}{ing.unit && ` ${ing.unit}`}
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

          {/* Notes/Tips */}
          {recipe.tips && (
            <section className="px-8 py-6 bg-amber-50/50 dark:bg-amber-900/10 border-t border-amber-100 dark:border-amber-900/20">
              <h2 className="text-xs tracking-widest uppercase text-amber-600 dark:text-amber-400 mb-3">
                Notes
              </h2>
              <p className="text-stone-600 dark:text-stone-400 text-sm leading-relaxed whitespace-pre-line">
                {recipe.tips}
              </p>
            </section>
          )}

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
          {(() => {
            const dietary = recipe.dietary || recipe.tags?.dietary || [];
            return dietary.length > 0 && (
            <footer className="px-8 py-4 bg-[#faf9f7] dark:bg-stone-800/30 border-t border-stone-100 dark:border-stone-800">
              <div className="flex gap-3">
                {dietary.map((tag: string) => (
                  <span
                    key={tag}
                    className="text-xs text-stone-400 dark:text-stone-500"
                  >
                    {capitalize(tag)}
                  </span>
                ))}
              </div>
            </footer>
          )})()}
        </article>
      </main>
    </div>
  );
}
