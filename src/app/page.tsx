import { auth, signOut } from "@/auth";
import { NabuCard, NabuHeader, NabuIconFrame, NabuMain, NabuPageShell, NabuPill, NabuSectionHeader, NabuSurface } from "@/components/ui/nabu";
import { initialTodos } from "@/lib/todos";
import { getRecipesByCookbook } from "@/lib/recipes";
import { houseAssets } from "@/data/house-assets";
import { wineBottles } from "@/data/wine-cellar";
import { getNextPlanningMilestone, getNextMilestone, formatMilestoneDate, getComputedMilestones } from "@/data/family";

function getFamilySummary() {
  const planning = getNextPlanningMilestone();
  const next = getNextMilestone();
  const milestones = getComputedMilestones();
  const planningCount = milestones.filter((m) => m.planningStatus === "planning-window").length;
  return { planning, next, planningCount };
}

interface Tile {
  id: string;
  name: string;
  emoji: string;
  description: string;
  href: string;
  stats: string;
}

interface TileCategory {
  label: string;
  tiles: Tile[];
}

async function getTileCategories(): Promise<TileCategory[]> {
  const activeTodos = initialTodos.filter((t) => !t.completed).length;
  const myRecipes = await getRecipesByCookbook("my-recipes");
  const myRecipesCount = myRecipes.length;
  const family = getFamilySummary();

  return [
    {
      label: "Planning & Family",
      tiles: [
        {
          id: "family",
          name: "Family",
          emoji: "👨‍👩‍👧‍👦",
          description: "Birthdays, anniversaries, planning",
          href: "/family",
          stats: family.planningCount > 0
            ? `${family.planningCount} planning`
            : family.next
              ? `${family.next.daysUntil}d`
              : "View",
        },
        {
          id: "san-sebastian",
          name: "San Sebastian",
          emoji: "🏖️",
          description: "Summer trip board — activities, food, hikes",
          href: "/travel/san-sebastian",
          stats: "Plan",
        },
        {
          id: "routines",
          name: "Routines",
          emoji: "📋",
          description: "Family board, weekly routines, rewards",
          href: "/family/dashboard",
          stats: "Board",
        },
        {
          id: "todos",
          name: "Todos",
          emoji: "✅",
          description: "Tasks, reminders, follow-ups",
          href: "/todos",
          stats: `${activeTodos} active`,
        },
      ],
    },
    {
      label: "Food & Cooking",
      tiles: [
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
      ],
    },
    {
      label: "Home & Systems",
      tiles: [
        {
          id: "garden",
          name: "Garden",
          emoji: "🌿",
          description: "Irrigation schedule, rain brake, zones",
          href: "/garden",
          stats: "Auto",
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
          id: "music",
          name: "Music",
          emoji: "🎵",
          description: "DJ, discoveries, history",
          href: "/music",
          stats: "Browse",
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
      ],
    },
  ];
}

export default async function Home() {
  const session = await auth();
  const categories = await getTileCategories();
  const family = getFamilySummary();

  // Build a today description that includes the next family planning item
  let todayTitle = "No focus set";
  let todayDescription =
    "Tap a recipe, meal, or project when something needs to become the main thread.";
  if (family.planning) {
    todayTitle = family.planning.label;
    todayDescription = `${family.planning.planningLabel} — ${formatMilestoneDate(family.planning.nextOccurrence)}`;
  } else if (family.next && family.next.daysUntil <= 30) {
    todayTitle = family.next.label;
    todayDescription = `Coming up in ${family.next.daysUntil} days — ${formatMilestoneDate(family.next.nextOccurrence)}`;
  }

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
                  title={todayTitle}
                  description={todayDescription}
                />
              </div>
              <NabuIconFrame className="h-9 w-9 border-amber-200/60 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20">
                {family.planning ? "👨‍👩‍👧‍👦" : "🎯"}
              </NabuIconFrame>
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

        {/* Categorised tile grids */}
        {categories.map((category) => (
          <section key={category.label}>
            <NabuSectionHeader
              className="mb-3"
              eyebrow={category.label}
            />

            <div className="grid min-w-0 grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
              {category.tiles.map((tile) => (
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
        ))}
      </NabuMain>
    </NabuPageShell>
  );
}
