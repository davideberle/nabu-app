import Image from "next/image";
import { notFound } from "next/navigation";
import { getRecipe, getAllRecipes, getCourseTags, formatServings, isLowCalorie, getMealRole, normalizeIngredient } from "@/lib/recipes";
import { getCourseTagColor, normalizeTagLabel, PUBLICATION_BADGE_CLASSES } from "@/lib/tag-colors";
import BackButton from "@/components/BackButton";
import CookingHistory from "@/components/CookingHistory";
import { NabuPageShell, NabuBadge, NabuKicker, cn } from "@/components/ui/nabu";

export const revalidate = 60;

export async function generateStaticParams() {
  const recipes = await getAllRecipes();
  return recipes.map((recipe) => ({
    id: recipe.id,
  }));
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Measurement cleanup now uses the centralized normalizeIngredient helper
// from @/lib/recipes — see normalizeIngredient().

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
    'Vegan Chocolate': 'Desserts',
    'The High-Protein Vegan Cookbook': 'Vegan',
    'Zagami Family Cookbook': 'Italian',
  };
  return map[cookbook] || null;
}

// Format cooking time - round to nice intervals
function formatTime(time?: { prep?: string | number; cook?: string | number; total?: string | number }): string | null {
  if (!time) return null;

  function extractMins(val?: string | number): number {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
      const match = val.match(/(\d+)/);
      return match ? parseInt(match[1]) : 0;
    }
    return 0;
  }

  let totalMins = 0;

  // If we have total, use that
  if (time.total) {
    totalMins = extractMins(time.total);
  } else {
    totalMins = extractMins(time.prep) + extractMins(time.cook);
  }

  if (totalMins === 0) return null;

  // Round to nice intervals
  if (totalMins <= 15) return `${Math.round(totalMins / 5) * 5} min`;
  if (totalMins <= 30) return `${Math.round(totalMins / 5) * 5} min`;
  if (totalMins <= 60) return `${Math.round(totalMins / 10) * 10} min`;
  if (totalMins < 90) return '1 hr';
  if (totalMins < 120) return '1.5 hrs';
  return `${Math.round(totalMins / 60)} hrs`;
}

export default async function RecipePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const recipe = await getRecipe(id);

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
    <NabuPageShell>
      {/* Back button — returns to previous page (cookbook, search, etc.) or /recipes for direct links */}
      <div className="fixed top-4 left-4 z-10">
        <BackButton />
      </div>

      {/* Hero image — generous but not overwhelming; object-[center_30%] keeps
           the dish visible rather than cropping to sky/ceiling above the plate */}
      {recipe.image ? (
        <div className="relative h-[55vh] sm:h-[60vh] w-full">
          <Image
            src={recipe.image}
            alt={recipe.name}
            fill
            className="object-cover object-[center_30%]"
            priority
            sizes="100vw"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/5" />
        </div>
      ) : (
        // Spacer for recipes without images
        <div className="h-20" />
      )}

      <main className={cn("relative max-w-2xl mx-auto px-4 pb-16", recipe.image ? "-mt-24" : "pt-4")}>
        <article className="bg-primary border border-primary rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <header className="px-8 pt-10 pb-6">
            {/* Source line with cuisine */}
            {recipe.source && (
              <div className="mb-4 space-y-2">
                <p className="text-xs tracking-widest uppercase text-quaternary">
                  {(() => {
                    const cuisine = recipe.cuisine
                      ? (Array.isArray(recipe.cuisine) ? recipe.cuisine[0] : recipe.cuisine)
                      : getCuisineFromCookbook(recipe.source!.cookbook);
                    return cuisine && <span className="text-secondary">{cuisine} · </span>;
                  })()}
                  {recipe.source.author ? `${recipe.source.author} — ` : ''}{recipe.source.cookbook}
                </p>
                <div className="flex flex-wrap gap-2">
                  <NabuBadge tone="stone">{recipe.source.cookbook}</NabuBadge>
                  {recipe.source.publication && (
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${PUBLICATION_BADGE_CLASSES}`}>
                      {recipe.source.publication}
                    </span>
                  )}
                </div>
              </div>
            )}

            <h1 className="text-3xl md:text-4xl font-serif text-primary leading-tight tracking-tight">
              {recipe.name}
            </h1>

            {/* Info pills */}
            <div className="flex flex-wrap gap-2 mt-5">
              {/* Dish type / course tags */}
              {getCourseTags(recipe).map((type) => (
                <span
                  key={type}
                  className={cn("inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border border-transparent", getCourseTagColor(type))}
                >
                  {normalizeTagLabel(type)}
                </span>
              ))}

              {/* Cooking time */}
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {formatTime(recipe.time as any) && (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-secondary border border-secondary text-secondary">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {formatTime(recipe.time as any)}
                </span>
              )}

              {/* Servings */}
              {recipe.servings && (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-secondary border border-secondary text-secondary">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  {formatServings(recipe.servings)}
                </span>
              )}

              {/* Meal role */}
              {(() => {
                const role = getMealRole(recipe);
                return role && !getCourseTags(recipe).some(t => t.toLowerCase() === role.toLowerCase()) && (
                  <NabuBadge tone="blue">{capitalize(role)}</NabuBadge>
                );
              })()}

              {/* Low calorie */}
              {isLowCalorie(recipe) && (
                <NabuBadge tone="green">Low calorie</NabuBadge>
              )}
            </div>
          </header>

          {/* Decorative divider */}
          <div className="flex items-center justify-center py-2">
            <div className="w-16 h-px bg-secondary" />
          </div>

          {/* Introduction */}
          {(recipe.introduction || recipe.intro) && (
            <section className="px-8 py-6">
              <p className="text-secondary font-serif text-lg leading-relaxed whitespace-pre-line">
                {recipe.introduction || recipe.intro}
              </p>
            </section>
          )}

          {/* Ingredients */}
          <section className="px-8 py-8 bg-secondary border-t border-secondary">
            <NabuKicker>Ingredients</NabuKicker>

            {ingredientGroups.map((group, groupIndex) => (
              <div key={groupIndex} className={groupIndex > 0 ? "mt-6" : "mt-5"}>
                {group.name && (
                  <h3 className="text-sm font-medium text-primary mb-3 pb-1 border-b border-secondary">
                    {group.name}
                  </h3>
                )}
                <ul className="space-y-2">
                  {group.items.map((ing, i) => {
                    const norm = normalizeIngredient(ing.amount, ing.item);
                    return (
                      <li
                        key={i}
                        className="flex justify-between items-baseline"
                      >
                        <span className="text-primary">
                          {capitalize(norm.item)}
                        </span>
                        <span className="text-tertiary text-sm ml-4 tabular-nums">
                          {norm.amount}{ing.unit && ` ${ing.unit}`}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>

          {/* Method */}
          <section className="px-8 py-8 border-t border-secondary">
            <NabuKicker>Method</NabuKicker>
            <ol className="mt-5 space-y-6">
              {recipe.method.map((step, i) => (
                <li key={i} className="flex gap-5">
                  <span className="flex-shrink-0 text-2xl font-serif text-quaternary leading-none pt-1">
                    {i + 1}
                  </span>
                  <p className="text-secondary leading-relaxed">
                    {step}
                  </p>
                </li>
              ))}
            </ol>
          </section>

          {/* Notes/Tips */}
          {recipe.tips && (
            <section className="px-8 py-6 bg-utility-orange-50/70 dark:bg-utility-orange-950/20 border-t border-utility-orange-200 dark:border-utility-orange-700/60">
              <NabuKicker>Notes</NabuKicker>
              <p className="mt-3 text-secondary text-sm leading-relaxed whitespace-pre-line">
                {recipe.tips}
              </p>
            </section>
          )}

          {/* Serving suggestions */}
          {recipe.serving && (
            <section className="px-8 py-5 border-t border-secondary">
              <p className="text-sm text-tertiary italic">
                {recipe.serving}
              </p>
            </section>
          )}

          {/* Related recipes */}
          {recipe.related_recipes && recipe.related_recipes.length > 0 && (
            <section className="px-8 py-4 border-t border-secondary">
              <p className="text-xs text-tertiary">
                See also:{" "}
                {recipe.related_recipes.map((rel, i) => (
                  <span key={i}>
                    {i > 0 && ", "}
                    <span className="text-secondary">{rel.name}</span>
                  </span>
                ))}
              </p>
            </section>
          )}

          {/* Footer - dietary tags */}
          {(() => {
            const dietary = recipe.dietary || recipe.tags?.dietary || [];
            return dietary.length > 0 && (
              <footer className="px-8 py-4 bg-secondary border-t border-secondary">
                <div className="flex flex-wrap gap-2">
                  {dietary.map((tag: string) => (
                    <NabuBadge key={tag} tone="stone">{capitalize(tag)}</NabuBadge>
                  ))}
                </div>
              </footer>
            );
          })()}

          {/* Cooking history — loaded client-side so static recipe prerender never depends on Turso. */}
          <CookingHistory recipeId={recipe.id} />
        </article>
      </main>
    </NabuPageShell>
  );
}
