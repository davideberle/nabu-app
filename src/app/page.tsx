import Link from "next/link";
import { auth, signOut } from "@/auth";

const tiles = [
  {
    id: "shopping",
    name: "Shopping",
    emoji: "🛒",
    description: "Kids list, David's list, Bulk",
    href: "/shopping",
    stats: "3 lists",
  },
  {
    id: "recipes",
    name: "Recipes",
    emoji: "🍳",
    description: "Browse, search, cook mode",
    href: "/recipes",
    stats: "47 recipes",
  },
  {
    id: "music",
    name: "Music",
    emoji: "🎵",
    description: "DJ, discoveries, history",
    href: "/music",
    stats: "240+ items",
  },
  {
    id: "system",
    name: "System",
    emoji: "🔧",
    description: "Status, services, logs",
    href: "/system",
    stats: "All green",
  },
];

export default async function Home() {
  const session = await auth();
  
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">📜</span>
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              Nabu
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              {session?.user?.name}
            </span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button
                type="submit"
                className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Today's Focus (placeholder for future) */}
        <div className="mb-8 p-4 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800">
          <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
            <span>🎯</span>
            <span className="font-medium">Today&apos;s Focus:</span>
            <span className="text-blue-600 dark:text-blue-400">
              No focus set — tap a recipe or project to set one
            </span>
          </div>
        </div>

        {/* Tiles Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {tiles.map((tile) => (
            <Link
              key={tile.id}
              href={tile.href}
              className="group p-6 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-2xl">{tile.emoji}</span>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                      {tile.name}
                    </h2>
                  </div>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {tile.description}
                  </p>
                </div>
                <span className="text-xs px-2 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                  {tile.stats}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </main>

      {/* System Status Footer */}
      <footer className="fixed bottom-0 left-0 right-0 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between text-sm">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              <span className="text-zinc-600 dark:text-zinc-400">Voice Relay</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              <span className="text-zinc-600 dark:text-zinc-400">Gateway</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              <span className="text-zinc-600 dark:text-zinc-400">Music Assistant</span>
            </span>
          </div>
          <span className="text-zinc-400 dark:text-zinc-500">
            Last sync: just now
          </span>
        </div>
      </footer>
    </div>
  );
}
