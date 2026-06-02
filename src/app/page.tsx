import Link from "next/link";
import { auth, signOut } from "@/auth";
import { NabuCard, NabuHeader, NabuIconFrame, NabuMain, NabuPageShell, NabuPill, NabuSectionHeader, NabuSurface } from "@/components/ui/nabu";
import { initialTodos } from "@/lib/todos";
import { getRecipesByCookbook } from "@/lib/recipes";
import { houseAssets } from "@/data/house-assets";
import { wineBottles } from "@/data/wine-cellar";

async function getTiles() {
  const activeTodos = initialTodos.filter((t) => !t.completed).length;
  const myRecipes = await getRecipesByCookbook("my-recipes");
  const myRecipesCount = myRecipes.length;

  return [
    {
      id: "todos",
      name: "Todos",
      emoji: "✅",
      description: "Tasks, reminders, follow-ups",
      href: "/todos",
      stats: `${activeTodos} active`,
    },
    {
      id: "shopping",
      name: "Shopping",
      emoji: "🛒",
      description: "Kids list, David's list, Bulk",
      href: "/shopping",
      stats: "Lists",
    },
    {
      id: "recipes",
      name: "Recipes",
      emoji: "🍳",
      description: "Browse, search, cook mode",
      href: "/recipes",
      stats: `${myRecipesCount} saved`,
    },
    {
      id: "music",
      name: "Music",
      emoji: "🎵",
      description: "DJ, discoveries, history",
      href: "/music",
      stats: "Browse",
    },
    {
      id: "garden",
      name: "Garden",
      emoji: "🌿",
      description: "Irrigation schedule, rain brake, zones",
      href: "/garden",
      stats: "Auto",
    },
    {
      id: "cooking",
      name: "Cooking",
      emoji: "🔥",
      description: "Live session for today",
      href: "/cooking",
      stats: "Today",
    },
    {
      id: "meals",
      name: "Meals",
      emoji: "🍽️",
      description: "Weekly meal planning",
      href: "/meals",
      stats: "Plan ahead",
    },
    {
      id: "wine",
      name: "Wine Cellar",
      emoji: "🍷",
      description: "Home stock, pairings, status",
      href: "/wine",
      stats: `${wineBottles.length} bottles`,
    },
    {
      id: "assets",
      name: "House Assets",
      emoji: "🏠",
      description: "Equipment, warranties, maintenance",
      href: "/assets",
      stats: `${houseAssets.length} tracked`,
    },
    {
      id: "system",
      name: "System",
      emoji: "🔧",
      description: "Status, services, logs",
      href: "/system",
      stats: "Status",
    },
  ];
}

export default async function Home() {
  const session = await auth();
  const tiles = await getTiles();

  return (
    <NabuPageShell>
      <NabuHeader
        title="Nabu"
        subtitle={session?.user?.name ?? "Household companion"}
        icon="📜"
        action={
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button
              type="submit"
              className="text-xs font-medium text-quaternary transition-colors hover:text-secondary"
            >
              Sign out
            </button>
          </form>
        }
      />

      <NabuMain className="space-y-6 pb-20">
        {/* Today / Now */}
        <section className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_0.6fr]">
          <NabuSurface tone="accent" className="p-4 sm:p-5">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <NabuSectionHeader
                  eyebrow="Today"
                  title="No focus set"
                  description="Tap a recipe, meal, or project when something needs to become the main thread."
                />
              </div>
              <NabuIconFrame className="h-9 w-9 border-amber-200/60 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20">🎯</NabuIconFrame>
            </div>
          </NabuSurface>

          <NabuSurface tone="muted" className="p-4">
            <NabuSectionHeader eyebrow="Systems" />
            <div className="mt-3 space-y-2">
              {["Voice Relay", "Gateway", "Music Assistant"].map((item) => (
                <div key={item} className="flex min-w-0 items-center justify-between gap-2 text-xs">
                  <span className="truncate text-tertiary">{item}</span>
                  <NabuPill tone="green">Live</NabuPill>
                </div>
              ))}
            </div>
          </NabuSurface>
        </section>

        {/* Surface grid */}
        <section>
          <NabuSectionHeader
            className="mb-3"
            eyebrow="Surfaces"
            title="What do you need?"
          />

          <div className="grid min-w-0 grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
            {tiles.map((tile) => (
              <NabuCard
                key={tile.id}
                href={tile.href}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <NabuIconFrame className="bg-stone-100 transition-colors group-hover:bg-stone-200 dark:bg-stone-800 dark:group-hover:bg-stone-700">
                    {tile.emoji}
                  </NabuIconFrame>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <h2 className="min-w-0 truncate text-sm font-semibold tracking-[-0.01em] text-primary">
                        {tile.name}
                      </h2>
                      <NabuPill className="hidden shrink-0 min-[480px]:inline-flex">{tile.stats}</NabuPill>
                    </div>
                    <p className="mt-0.5 truncate text-xs leading-relaxed text-tertiary">
                      {tile.description}
                    </p>
                  </div>
                </div>
              </NabuCard>
            ))}
          </div>
        </section>
      </NabuMain>
    </NabuPageShell>
  );
}
