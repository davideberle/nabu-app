import Link from "next/link";

export default function RecipesPage() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            href="/"
            className="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            ← Back
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-2xl">🍳</span>
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              Recipes
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="text-center py-16 text-zinc-500 dark:text-zinc-400">
          <span className="text-4xl mb-4 block">🍳</span>
          <p className="text-lg">Coming soon</p>
          <p className="text-sm mt-2">Recipe browser with cook mode</p>
        </div>
      </main>
    </div>
  );
}
