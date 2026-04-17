import Link from "next/link";
import Image from "next/image";
import { getCookbooks } from "@/lib/recipes";

export const revalidate = 60;

export default async function CookbooksPage() {
  const cookbooks = await getCookbooks();
  const totalRecipes = cookbooks.reduce((sum, c) => sum + c.count, 0);

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
              Cookbooks
            </h1>
            <p className="text-xs text-stone-400 dark:text-stone-500">
              {cookbooks.length} books · {totalRecipes} recipes
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
          {cookbooks.map((cookbook) => (
            <Link
              key={cookbook.slug}
              href={`/recipes/cookbook/${cookbook.slug}`}
              className="group"
            >
              <div className="relative aspect-[3/4] rounded-lg overflow-hidden bg-stone-200 dark:bg-stone-800 shadow-md group-hover:shadow-xl transition-shadow">
                {cookbook.cover ? (
                  <Image
                    src={cookbook.cover}
                    alt={cookbook.name}
                    fill
                    sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center p-4">
                    <span className="text-center font-serif text-stone-500 dark:text-stone-400 text-sm leading-tight">
                      {cookbook.name}
                    </span>
                  </div>
                )}
                {/* Gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>

              <div className="mt-3">
                <h2 className="font-serif text-stone-800 dark:text-stone-100 text-sm leading-tight group-hover:text-stone-600 dark:group-hover:text-stone-300 line-clamp-2">
                  {cookbook.name}
                </h2>
                {cookbook.author && (
                  <p className="text-xs text-stone-400 dark:text-stone-500 mt-1 line-clamp-1">
                    {cookbook.author}
                  </p>
                )}
                <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
                  {cookbook.count} recipes
                </p>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
