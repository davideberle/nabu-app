import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getCookbooks, getRecipesByCookbook, getDietary } from "@/lib/recipes";
import { ChapterNav } from "./ChapterNav";

function capitalize(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Chapter order by cookbook (as they appear in the book)
const CHAPTER_ORDER: Record<string, string[]> = {
  'The Curry Guy Bible': [
    'Basics & Breads', 'Starters & Snacks', 'Curries', 'Accompaniments',
    'Biryanis & Rice', 'Grills & Kebabs', 'Street Food', 'Desserts & Drinks',
    'Base Sauces', 'Spice Blends'
  ],
  'Four Seasons': ['Spring', 'Summer', 'Autumn', 'Winter'],
  'The High-Protein Vegan Cookbook': [
    'Appetizers & Snacks', 'Breakfast', 'Soups & Stews', 'Salads', 'Main Courses', 'Desserts'
  ],
  'The Indian Vegan': [
    'Essentials', 'Small Plates', 'Large Plates', 'Sides', 'Desserts & Drinks', 'Pulp Meal Ideas'
  ],
  'Plentiful': [
    'Dreams', 'Salads', 'Cooking for One', 'Comfort Grub', 'Special Occasions',
    'For Company', 'Sides', 'Desserts', 'Pickles & Condiments'
  ],
  'Afro-Vegan': [
    'Spice Blends & Sauces', 'Appetizers & Snacks', 'Salads & Slaws', 'Vegetables',
    'Grains & Legumes', 'Soups & Stews', 'Main Dishes', 'Desserts', 'Beverages', 'Kitchen Basics'
  ],
  'Black Rican Vegan': [
    'Desayuno (Breakfast)', 'Appetizers', 'Salads & Sides', 'Soups & Stews', 'Main Dishes', 'Desserts'
  ],
  'Souk to Table': [
    'Essentials', 'Dips & Spreads', 'Salads', 'Eggs', 'Grains & Legumes',
    'Vegetables', 'Pasta & Dumplings', 'Meat', 'Fish & Seafood', 'Desserts', 'Drinks'
  ]
};

const DEFAULT_CHAPTER_ORDER = [
  'Starters & Appetizers', 'Soups & Stews', 'Sides', 'Main Dishes', 'Desserts', 'Drinks', 'Other'
];

export function generateStaticParams() {
  const cookbooks = getCookbooks();
  return cookbooks.map((c) => ({ slug: c.slug }));
}

export default async function CookbookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const cookbooks = getCookbooks();
  const cookbook = cookbooks.find(c => c.slug === slug);
  
  if (!cookbook) {
    notFound();
  }
  
  const recipes = getRecipesByCookbook(slug);
  
  // Group recipes by chapter if chapters exist
  const chapters = new Map<string, typeof recipes>();
  let hasChapters = false;
  
  for (const recipe of recipes) {
    const chapter = recipe.source?.chapter || recipe.category?.chapter || '';
    if (chapter) hasChapters = true;
    const key = chapter || '__uncategorized__';
    if (!chapters.has(key)) chapters.set(key, []);
    chapters.get(key)!.push(recipe);
  }
  
  const chapterCount = Array.from(chapters.keys()).filter(k => k !== '__uncategorized__').length;
  const uncategorizedCount = chapters.get('__uncategorized__')?.length || 0;
  const useChapterGrouping = hasChapters && chapterCount > 0 && (uncategorizedCount < recipes.length * 0.5);
  
  // Sort chapters by book order
  const sortChapters = (a: string, b: string) => {
    const order = CHAPTER_ORDER[cookbook.name] || DEFAULT_CHAPTER_ORDER;
    const aIdx = order.indexOf(a);
    const bIdx = order.indexOf(b);
    if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
    if (aIdx === -1) return 1;
    if (bIdx === -1) return -1;
    return aIdx - bIdx;
  };
  
  const groupedRecipes = useChapterGrouping 
    ? Array.from(chapters.entries())
        .filter(([k]) => k !== '__uncategorized__')
        .sort((a, b) => sortChapters(a[0], b[0]))
    : [];
  
  // For sticky nav
  const chapterList = groupedRecipes.map(([name, recipes]) => ({ name, count: recipes.length }));

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
              {cookbook.name}
            </h1>
            <p className="text-xs text-stone-400 dark:text-stone-500">
              {cookbook.author} · {recipes.length} recipes
            </p>
          </div>
        </div>
      </header>

      {/* Sticky chapter nav */}
      {useChapterGrouping && <ChapterNav chapters={chapterList} />}

      <main className="max-w-5xl mx-auto px-4 py-6">
        {useChapterGrouping ? (
          <div className="space-y-10">
            {groupedRecipes.map(([chapterName, chapterRecipes]) => (
              <section 
                key={chapterName}
                id={`chapter-${chapterName.replace(/\s+/g, '-').toLowerCase()}`}
              >
                <h2 className="text-sm font-medium tracking-widest uppercase text-stone-500 dark:text-stone-400 mb-4 pb-2 border-b border-stone-200 dark:border-stone-800">
                  {chapterName}
                  <span className="ml-2 text-xs font-normal normal-case tracking-normal text-stone-400 dark:text-stone-500">
                    ({chapterRecipes.length})
                  </span>
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {chapterRecipes.map((recipe) => {
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
                          <div className="h-32 w-full bg-stone-100 dark:bg-stone-800 flex items-center justify-center">
                            <span className="text-3xl opacity-30">🍽️</span>
                          </div>
                        )}
                        <div className="p-4">
                          <h3 className="font-serif text-stone-800 dark:text-stone-100 group-hover:text-stone-600 dark:group-hover:text-stone-300 transition-colors leading-snug">
                            {recipe.name}
                          </h3>
                          {recipe.servings && (
                            <p className="text-xs text-stone-400 dark:text-stone-500 mt-1">
                              {capitalize(recipe.servings)}
                            </p>
                          )}
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
              </section>
            ))}
          </div>
        ) : (
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
                    <div className="h-32 w-full bg-stone-100 dark:bg-stone-800 flex items-center justify-center">
                      <span className="text-3xl opacity-30">🍽️</span>
                    </div>
                  )}
                  <div className="p-4">
                    <h2 className="font-serif text-stone-800 dark:text-stone-100 group-hover:text-stone-600 dark:group-hover:text-stone-300 transition-colors leading-snug">
                      {recipe.name}
                    </h2>
                    {recipe.servings && (
                      <p className="text-xs text-stone-400 dark:text-stone-500 mt-1">
                        {capitalize(recipe.servings)}
                      </p>
                    )}
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
        )}
      </main>
    </div>
  );
}
