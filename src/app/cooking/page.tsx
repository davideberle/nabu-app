import Image from "next/image";
import Link from "next/link";
import { CompleteSessionButton } from "./complete-session-button";
import { NabuBadge, NabuEmptyState, NabuHeader, NabuKicker, NabuMain, NabuPageShell, NabuSectionHeader, NabuSurface } from "@/components/ui/nabu";
import { createSessionFromPlan } from "@/lib/cooking";
import { todayInZurich } from "@/lib/date";
import type { CookingSession, SessionIngredient } from "@/lib/cooking";
import { buildCookingGuidance, extractTableSides, formatList, formatRecipeTime } from "@/lib/cooking-guidance";
import { formatServings, getRecipe } from "@/lib/recipes";
import type { Recipe } from "@/lib/recipes";

export const dynamic = "force-dynamic";

export default async function CookingPage() {
  const date = todayInZurich();
  // Auto-load existing session or create one from today's meal plan
  const session = await createSessionFromPlan(date);

  // Load full recipe data for the main image/time and for side recipe blocks.
  const mainRecipe = session?.anchor.recipeId
    ? await getRecipe(session.anchor.recipeId)
    : undefined;
  const sideRecipes: Recipe[] = [];
  if (session) {
    const results = await Promise.all(
      session.relatedRecipes.map((r) => getRecipe(r.recipeId))
    );
    for (const r of results) {
      if (r) sideRecipes.push(r);
    }
  }

  return (
    <NabuPageShell>
      <NabuHeader
        title="Live Cooking"
        eyebrow="Today’s meal"
        subtitle={formatDateDisplay(date)}
        backHref="/"
        maxWidth="3xl"
      />

      <NabuMain maxWidth="3xl" className="space-y-6">
        {session ? (
          <SessionView session={session} sideRecipes={sideRecipes} mainRecipe={mainRecipe} />
        ) : (
          <EmptyState date={date} />
        )}
      </NabuMain>
    </NabuPageShell>
  );
}

// ---------------------------------------------------------------------------
// Session view
// ---------------------------------------------------------------------------

function SessionView({
  session,
  sideRecipes,
  mainRecipe,
}: {
  session: CookingSession;
  sideRecipes: Recipe[];
  mainRecipe?: Recipe;
}) {
  const hasSessionIngredients = session.ingredients.session.length > 0;
  const hasSessionMethod = session.method.session.length > 0;
  const mainIngredients = hasSessionIngredients
    ? session.ingredients.session
    : session.ingredients.base;
  const mainMethod = hasSessionMethod
    ? session.method.session
    : session.method.base;

  const sideRecipeById = new Map(sideRecipes.map((recipe) => [recipe.id, recipe]));
  const mealComponents = session.relatedRecipes
    .map((related) => ({ related, recipe: sideRecipeById.get(related.recipeId) }))
    .filter((item): item is { related: CookingSession["relatedRecipes"][number]; recipe: Recipe } => !!item.recipe);
  const tableSides = extractTableSides(mainIngredients, session.serveWith);
  const guidance = buildCookingGuidance({
    session,
    mainRecipe,
    sideRecipes: mealComponents.map(({ recipe }) => recipe),
  });
  const timeLabel = formatRecipeTime(mainRecipe?.time);
  const hasSides = mealComponents.length > 0 || tableSides.length > 0;

  return (
    <>
      <StoryCard story={session.story} title={session.anchor.title} />

      {/* ── Meal overview ── */}
      <NabuSurface className="p-5">
        <NabuSectionHeader
          eyebrow="Tonight’s meal"
          title={session.anchor.title}
        />

        {hasSides && (
          <p className="mt-2 text-sm leading-relaxed text-stone-500 dark:text-stone-400">
            {mealComponents.length > 0 && (
              <>with {mealComponents.map(({ recipe }) => recipe.name).join(" & ")}</>
            )}
            {mealComponents.length > 0 && tableSides.length > 0 && ", "}
            {tableSides.length > 0 && (
              <span className="text-stone-400 dark:text-stone-500">
                {mealComponents.length === 0 ? "served with " : ""}
                {formatList(tableSides).toLowerCase()}
              </span>
            )}
          </p>
        )}

        {mainRecipe?.image && (
          <div className="mt-4 overflow-hidden rounded-2xl border border-stone-100 bg-stone-100 dark:border-stone-800 dark:bg-stone-900">
            <Image
              src={mainRecipe.image}
              alt={session.anchor.title}
              width={960}
              height={540}
              priority
              className="aspect-[16/9] w-full object-cover"
            />
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-stone-500 dark:text-stone-400">
          {formatServings(session.servings.current) && (
            <NabuBadge>{formatServings(session.servings.current)}</NabuBadge>
          )}
          {session.servings.current !== session.servings.base && formatServings(session.servings.base) && (
            <NabuBadge tone="amber">base: {formatServings(session.servings.base)}</NabuBadge>
          )}
          {timeLabel && <NabuBadge tone="blue">{timeLabel}</NabuBadge>}
          <span className="text-xs">
            {session.anchor.provenance.source}
            {session.anchor.provenance.author && (
              <> &middot; {session.anchor.provenance.author}</>
            )}
          </span>
        </div>

      </NabuSurface>

      {/* ── Meal components: main → sides → serve-with notes ── */}
      <MealComponentBlock
        role="main"
        title={session.anchor.title}
        ingredients={mainIngredients}
        method={mainMethod}
        modified={{ ingredients: hasSessionIngredients, method: hasSessionMethod }}
      />

      {mealComponents.map(({ related, recipe }) => (
        <MealComponentBlock
          key={recipe.id}
          role={related.kind}
          title={recipe.name}
          servings={recipe.servings}
          ingredients={recipe.ingredients.map((ing) => ({
            amount: ing.amount,
            item: ing.item,
            unit: ing.unit,
            group: ing.group ?? null,
          }))}
          method={recipe.method}
        />
      ))}

      {tableSides.length > 0 && (
        <NabuSurface tone="muted" className="p-4">
          <NabuKicker>Serve with</NabuKicker>
          <ul className="mt-2 space-y-1">
            {tableSides.map((item, i) => (
              <li key={i} className="flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                <span className="h-1 w-1 shrink-0 rounded-full bg-stone-300 dark:bg-stone-600" />
                {item}
              </li>
            ))}
          </ul>
        </NabuSurface>
      )}

      <PairingSuggestions
        pairing={guidance.pairing}
        wineOverride={session.coachCards.wine}
        date={session.date}
      />

      {/* Notes */}
      {session.notes && (
        <NabuSurface className="p-5">
          <NabuKicker>Notes</NabuKicker>
          <p className="mt-2 whitespace-pre-wrap text-sm text-stone-600 dark:text-stone-400">
            {session.notes}
          </p>
        </NabuSurface>
      )}

      <NabuSurface className="p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <NabuKicker>Finish session</NabuKicker>
            <p className="mt-1 text-sm leading-relaxed text-stone-500 dark:text-stone-400">
              Mark this meal as cooked when dinner is actually done.
            </p>
          </div>
          <CompleteSessionButton
            sessionId={session.id}
            completed={session.status === "completed"}
          />
        </div>
      </NabuSurface>

      {/* Footer meta */}
      <div className="text-center text-xs text-stone-400 dark:text-stone-600 pb-8">
        Last updated {formatTimestamp(session.updatedAt)}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Story card
// ---------------------------------------------------------------------------

function StoryCard({
  story,
  title,
}: {
  story: CookingSession["story"];
  title: string;
}) {
  if (!story?.text) return null;

  return (
    <NabuSurface className="overflow-hidden border-amber-100 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-5 dark:border-amber-900/40 dark:from-amber-950/30 dark:via-stone-950 dark:to-orange-950/20">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-lg dark:bg-amber-900/40">
          📜
        </div>
        <div>
          <NabuKicker>Story of the dish</NabuKicker>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-stone-950 dark:text-stone-50">
            {story.title || title}
          </h2>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-stone-700 dark:text-stone-300">
            {story.text}
          </p>
        </div>
      </div>
    </NabuSurface>
  );
}

// ---------------------------------------------------------------------------
// Unified meal component block — used for both main dish and side recipes
// ---------------------------------------------------------------------------

function MealComponentBlock({
  role,
  title,
  servings,
  ingredients,
  method,
  modified,
}: {
  role: "main" | "starter" | "side" | "dessert";
  title: string;
  servings?: string | number;
  ingredients: SessionIngredient[];
  method: string[];
  modified?: { ingredients: boolean; method: boolean };
}) {
  const servingLabel = servings ? formatServings(String(servings)) : "";

  return (
    <NabuSurface className="space-y-5 p-5">
      {/* Component header — role label + title */}
      <NabuSectionHeader
        eyebrow={componentRoleLabel(role)}
        title={title}
        action={servingLabel ? <NabuBadge>{servingLabel}</NabuBadge> : null}
      />

      {/* Ingredients */}
      {ingredients.length > 0 && (
        <div className="pt-3 border-t border-stone-100 dark:border-stone-800">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs tracking-widest uppercase text-stone-400 dark:text-stone-500">
              Ingredients
            </h4>
            {modified?.ingredients && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                modified
              </span>
            )}
          </div>
          <IngredientList ingredients={ingredients} />
        </div>
      )}

      {/* Method */}
      {method.length > 0 && (
        <div className="pt-3 border-t border-stone-100 dark:border-stone-800">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs tracking-widest uppercase text-stone-400 dark:text-stone-500">
              Method
            </h4>
            {modified?.method && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                modified
              </span>
            )}
          </div>
          <ol className="space-y-4">
            {method.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm text-stone-600 dark:text-stone-400">
                <span className="text-lg font-serif text-stone-300 dark:text-stone-600 leading-none shrink-0 pt-0.5">
                  {i + 1}
                </span>
                <span className="leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </NabuSurface>
  );
}

// ---------------------------------------------------------------------------
// Ingredient list
// ---------------------------------------------------------------------------

function componentRoleLabel(role: "main" | "starter" | "side" | "dessert"): string {
  switch (role) {
    case "main":
      return "Main";
    case "starter":
      return "Starter";
    case "dessert":
      return "Dessert";
    default:
      return "Side";
  }
}

function IngredientList({ ingredients }: { ingredients: SessionIngredient[] }) {
  // Group ingredients if groups exist
  const hasGroups = ingredients.some((i) => i.group);

  if (!hasGroups) {
    return (
      <ul className="space-y-1.5">
        {ingredients.map((ing, i) => (
          <IngredientRow key={i} ing={ing} />
        ))}
      </ul>
    );
  }

  const groups = new Map<string, SessionIngredient[]>();
  for (const ing of ingredients) {
    const g = ing.group || "Other";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(ing);
  }

  return (
    <div className="space-y-4">
      {Array.from(groups.entries()).map(([group, ings]) => (
        <div key={group}>
          <h4 className="text-xs font-medium text-stone-500 dark:text-stone-400 mb-1.5">
            {group}
          </h4>
          <ul className="space-y-1.5">
            {ings.map((ing, i) => (
              <IngredientRow key={i} ing={ing} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function IngredientRow({ ing }: { ing: SessionIngredient }) {
  return (
    <li className="text-sm text-stone-600 dark:text-stone-400 flex justify-between gap-4">
      <span>{ing.item}</span>
      <span className="text-stone-400 dark:text-stone-500 tabular-nums shrink-0 text-right">
        {formatIngredientAmount(ing)}
      </span>
    </li>
  );
}

function formatIngredientAmount(ing: SessionIngredient): string {
  const amount = ing.amount?.trim() ?? "";
  const unit = ing.unit?.trim() ?? "";
  if (!amount) return unit;
  if (!unit) return amount;
  if (amount.toLowerCase().endsWith(unit.toLowerCase())) return amount;
  return `${amount} ${unit}`;
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ date }: { date: string }) {
  return (
    <NabuEmptyState
      icon="🍳"
      title="Nothing planned for today"
      description={
        <>
          Assign a recipe in the{" "}
          <Link href="/meals" className="underline hover:text-stone-600 dark:hover:text-stone-300">
            meal planner
          </Link>{" "}
          and it will appear here automatically, or ask Nabu on Telegram
          for live cooking help.
        </>
      }
    />
  );
}

function PairingSuggestions({
  pairing,
  wineOverride,
  date,
}: {
  pairing: { wine: string; nonAlcoholic: string };
  wineOverride?: string | null;
  date: string;
}) {
  const wine = withDrinkEmoji(wineOverride?.trim() || pairing.wine, "🍷");
  const showNonAlcoholic = isMondayOrTuesday(date);

  return (
    <NabuSurface className="overflow-hidden p-5">
      <div className="mb-4 flex items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violet-50 text-lg dark:bg-violet-950/40">
          {firstDrinkEmoji(wine) ?? "🍷"}
        </div>
        <div>
          <NabuKicker>Wine</NabuKicker>
          <h2 className="mt-1 text-lg font-semibold tracking-[-0.02em] text-primary">
            Pair with this meal
          </h2>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-stone-100 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900/40">
          <p className="text-[10px] tracking-widest uppercase text-stone-400 dark:text-stone-500">
            Wine
          </p>
          <p className="mt-2 text-sm leading-relaxed text-stone-700 dark:text-stone-300">
            {wine}
          </p>
        </div>
        {showNonAlcoholic && (
          <div className="rounded-2xl border border-stone-100 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900/40">
            <p className="text-[10px] tracking-widest uppercase text-stone-400 dark:text-stone-500">
              Non-alcoholic
            </p>
            <p className="mt-2 text-sm leading-relaxed text-stone-700 dark:text-stone-300">
              {pairing.nonAlcoholic}
            </p>
          </div>
        )}
      </div>
    </NabuSurface>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DRINK_EMOJIS = ["🍷", "🥂", "🍾", "🍺"];

function firstDrinkEmoji(text: string): string | null {
  return DRINK_EMOJIS.find((emoji) => text.includes(emoji)) ?? null;
}

function withDrinkEmoji(text: string, fallback: string): string {
  return firstDrinkEmoji(text) ? text : `${fallback} ${text}`;
}

function isMondayOrTuesday(date: string): boolean {
  const day = new Date(date + "T12:00:00").getDay();
  return day === 1 || day === 2;
}

function formatDateDisplay(date: string): string {
  const d = new Date(date + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
