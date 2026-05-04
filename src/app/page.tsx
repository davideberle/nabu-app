import Link from "next/link";
import { auth, signOut } from "@/auth";
import { NabuCard, NabuHeader, NabuIconFrame, NabuMain, NabuPageShell, NabuPill, NabuSectionHeader, NabuSurface } from "@/components/ui/nabu";
import { initialTodos } from "@/lib/todos";
import { getRecipesByCookbook } from "@/lib/recipes";

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
              className="text-xs font-medium text-stone-400 transition-colors hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-200"
            >
              Sign out
            </button>
          </form>
        }
      />

      <NabuMain className="pb-24">
        <section className="mb-8 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
          <NabuSurface tone="accent" className="p-4 sm:p-6">
            <NabuSectionHeader
              eyebrow="Today"
              title="No focus set"
              description="Tap a recipe, meal, or project when something needs to become the main thread."
              action={<NabuIconFrame className="h-11 w-11 border-amber-100 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20">🎯</NabuIconFrame>}
            />
          </NabuSurface>

          <NabuSurface className="p-4 sm:p-5">
            <NabuSectionHeader eyebrow="Systems" />
            <div className="mt-4 space-y-3 overflow-hidden">
              {["Voice Relay", "Gateway", "Music Assistant"].map((item) => (
                <div key={item} className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-stone-600 dark:text-stone-300">{item}</span>
                  <NabuPill tone="green">Live</NabuPill>
                </div>
              ))}
            </div>
          </NabuSurface>
        </section>

        <NabuSectionHeader
          className="mb-4"
          eyebrow="Surfaces"
          title="What do you need?"
        />

        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
          {tiles.map((tile) => (
            <NabuCard
              key={tile.id}
              href={tile.href}
            >
              <div className="flex min-w-0 items-start justify-between gap-3 overflow-hidden">
                <div className="min-w-0 overflow-hidden">
                  <div className="mb-3 flex min-w-0 items-center gap-3">
                    <NabuIconFrame className="bg-stone-100 transition-colors group-hover:bg-stone-200 dark:bg-stone-800 dark:group-hover:bg-stone-700">
                      {tile.emoji}
                    </NabuIconFrame>
                    <h2 className="min-w-0 truncate text-base font-semibold tracking-[-0.01em] text-primary">
                      {tile.name}
                    </h2>
                  </div>
                  <p className="text-sm leading-6 text-tertiary">
                    {tile.description}
                  </p>
                </div>
                <NabuPill className="hidden shrink-0 sm:inline-flex">{tile.stats}</NabuPill>
              </div>
            </NabuCard>
          ))}
        </div>
      </NabuMain>
    </NabuPageShell>
  );
}
