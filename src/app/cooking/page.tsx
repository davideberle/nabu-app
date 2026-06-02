import Image from "next/image";
import Link from "next/link";
import { CompleteSessionButton } from "./complete-session-button";
import { NabuBadge, NabuEmptyState, NabuHeader, NabuKicker, NabuMain, NabuPageShell, NabuSectionHeader, NabuSurface } from "@/components/ui/nabu";
import { createSessionFromPlan } from "@/lib/cooking";
import { todayInZurich } from "@/lib/date";
import type { CookingSession, SessionIngredient } from "@/lib/cooking";
import { buildCookingGuidance, extractTableSides, formatRecipeTime } from "@/lib/cooking-guidance";
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

  // Decide whether session lists are full integrated replacements or just
  // partial adjustments/substitutions. Showing a 2-item substitution list
  // instead of a 15-item ingredient list loses the base recipe.
  const ingredientsComplete = hasSessionIngredients &&
    isCompleteOverride(session.ingredients.session, session.ingredients.base);
  const methodComplete = hasSessionMethod &&
    isCompleteOverride(session.method.session, session.method.base);

  const mainIngredients = ingredientsComplete
    ? session.ingredients.session
    : session.ingredients.base;
  const mainMethod = methodComplete
    ? session.method.session
    : session.method.base;

  // Partial adjustments shown alongside the base recipe
  const ingredientAdjustments = hasSessionIngredients && !ingredientsComplete
    ? session.ingredients.session
    : [];
  const methodAdjustments = hasSessionMethod && !methodComplete
    ? session.method.session
    : [];

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

  return (
    <>
      <MealOverview
        session={session}
        mainRecipe={mainRecipe}
        mealComponents={mealComponents}
        tableSides={tableSides}
        timeLabel={timeLabel}
        mealFlow={guidance.mealFlow}
        wine={session.coachCards.wine || guidance.pairing.wine}
      />

      <StoryCard story={session.story} title={session.anchor.title} />

      {/* ── Meal components: main → sides → serve-with notes ── */}
      <MealComponentBlock
        role="main"
        title={session.anchor.title}
        ingredients={mainIngredients}
        method={mainMethod}
        modified={{ ingredients: ingredientsComplete, method: methodComplete }}
        ingredientAdjustments={ingredientAdjustments}
        methodAdjustments={methodAdjustments}
      />

      {mealComponents.map(({ related, recipe }) => (
        <MealComponentBlock
          key={recipe.id}
          role={related.kind}
          title={recipe.name}
          image={recipe.image}
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

      <NonAlcoholicHint date={session.date} suggestion={guidance.pairing.nonAlcoholic} />

      <SessionNotes notes={session.notes} />

      <NabuSurface className="p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <NabuKicker>Finish session</NabuKicker>
            <p className="mt-1 text-sm leading-relaxed text-tertiary">
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
      <div className="text-center text-xs text-quaternary pb-8">
        Last updated {formatTimestamp(session.updatedAt)}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Meal overview
// ---------------------------------------------------------------------------

function MealOverview({
  session,
  mainRecipe,
  mealComponents,
  tableSides,
  timeLabel,
  mealFlow,
  wine,
}: {
  session: CookingSession;
  mainRecipe?: Recipe;
  mealComponents: Array<{
    related: CookingSession["relatedRecipes"][number];
    recipe: Recipe;
  }>;
  tableSides: string[];
  timeLabel: string | null;
  mealFlow: string[];
  wine: string;
}) {
  const servingLabel = formatServings(session.servings.current);
  const sourceLabel = [
    session.anchor.provenance.source,
    session.anchor.provenance.author,
  ].filter(Boolean).join(" · ");
  const overviewItems = [
    { label: "Main", value: session.anchor.title },
    {
      label: "Cook",
      value: mealComponents.length
        ? mealComponents.map(({ recipe }) => recipe.name).join(" + ")
        : "Main dish only",
    },
    {
      label: "Table",
      value: tableSides.length ? tableSides.join(" + ") : "No extra sides",
    },
    { label: "Drink", value: stripDrinkEmoji(wine).replace(/^Optional:\s*/i, "") },
  ];
  const attackPlan = mealFlow.slice(0, 4);

  return (
    <NabuSurface className="overflow-hidden p-0">
      {mainRecipe?.image && (
        <div className="border-b border-primary bg-secondary">
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

      <div className="space-y-5 p-5">
        <div className="space-y-3">
          <NabuKicker>Tonight</NabuKicker>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-2xl font-semibold leading-tight tracking-[-0.02em] text-primary">
                {session.anchor.title}
              </h2>
              {sourceLabel && (
                <p className="mt-1 text-xs text-tertiary">{sourceLabel}</p>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {servingLabel && <NabuBadge>{servingLabel}</NabuBadge>}
              {session.servings.current !== session.servings.base && formatServings(session.servings.base) && (
                <NabuBadge tone="amber">base: {formatServings(session.servings.base)}</NabuBadge>
              )}
              {timeLabel && <NabuBadge tone="blue">{timeLabel}</NabuBadge>}
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {overviewItems.map((item) => (
            <div key={item.label} className="border-t border-secondary pt-3">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-quaternary">
                {item.label}
              </p>
              <p className="mt-1 text-sm font-medium leading-snug text-primary">
                {item.value}
              </p>
            </div>
          ))}
        </div>

        {attackPlan.length > 0 && (
          <div className="border-t border-secondary pt-4">
            <NabuKicker>Order of attack</NabuKicker>
            <ol className="mt-3 space-y-2.5">
              {attackPlan.map((step, index) => (
                <li key={index} className="grid grid-cols-[1.75rem_1fr] gap-3 text-sm leading-relaxed text-secondary">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-secondary text-xs font-semibold text-quaternary">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </NabuSurface>
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
    <NabuSurface tone="accent" className="p-5">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-50/80 text-lg dark:bg-amber-900/20">
          📜
        </div>
        <div className="min-w-0">
          <NabuKicker>Story of the dish</NabuKicker>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-primary">
            {story.title || title}
          </h2>
          <p className="mt-2.5 whitespace-pre-wrap text-sm leading-7 text-tertiary">
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
  image,
  servings,
  ingredients,
  method,
  modified,
  ingredientAdjustments = [],
  methodAdjustments = [],
}: {
  role: "main" | "starter" | "side" | "dessert";
  title: string;
  image?: string | null;
  servings?: string | number;
  ingredients: SessionIngredient[];
  method: string[];
  modified?: { ingredients: boolean; method: boolean };
  ingredientAdjustments?: SessionIngredient[];
  methodAdjustments?: string[];
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

      {image && (
        <div className="overflow-hidden rounded-lg border border-secondary bg-secondary">
          <Image
            src={image}
            alt={title}
            width={960}
            height={540}
            className="aspect-[16/9] w-full object-cover"
          />
        </div>
      )}

      {/* Ingredients */}
      {ingredients.length > 0 && (
        <div className="pt-3 border-t border-secondary">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs tracking-widest uppercase text-quaternary">
              Ingredients
            </h4>
            {modified?.ingredients && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400">
                modified
              </span>
            )}
          </div>
          <IngredientList ingredients={ingredients} />
        </div>
      )}

      {/* Method */}
      {method.length > 0 && (
        <div className="pt-3 border-t border-secondary">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs tracking-widest uppercase text-quaternary">
              Method
            </h4>
            {modified?.method && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400">
                modified
              </span>
            )}
          </div>
          <ol className="space-y-4">
            {method.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm text-secondary">
                <span className="text-lg font-serif text-quaternary leading-none shrink-0 pt-0.5">
                  {i + 1}
                </span>
                <span className="leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Tonight's changes — shown when session has partial adjustments */}
      {(ingredientAdjustments.length > 0 || methodAdjustments.length > 0) && (
        <div className="pt-3 border-t border-amber-200/50 dark:border-amber-800/30">
          <h4 className="text-xs tracking-widest uppercase text-amber-600 dark:text-amber-400 mb-3">
            Tonight&apos;s changes
          </h4>
          {ingredientAdjustments.length > 0 && (
            <div className="mb-3">
              <p className="text-[10px] tracking-widest uppercase text-quaternary mb-1.5">
                Substitutions
              </p>
              <ul className="space-y-1">
                {ingredientAdjustments.map((ing, i) => (
                  <li key={i} className="text-sm text-amber-700 dark:text-amber-300 flex justify-between gap-4">
                    <span>{ing.item}</span>
                    <span className="text-amber-500 dark:text-amber-400 tabular-nums shrink-0 text-right">
                      {formatIngredientAmount(ing)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {methodAdjustments.length > 0 && (
            <div>
              <p className="text-[10px] tracking-widest uppercase text-quaternary mb-1.5">
                Adjustments
              </p>
              <ul className="space-y-1.5">
                {methodAdjustments.map((note, i) => (
                  <li key={i} className="text-sm text-amber-700 dark:text-amber-300 leading-relaxed">
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          )}
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
          <h4 className="text-xs font-medium text-tertiary mb-1.5">
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
    <li className="text-sm text-secondary flex justify-between gap-4">
      <span>{ing.item}</span>
      <span className="text-quaternary tabular-nums shrink-0 text-right">
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
          <Link href="/meals" className="underline hover:text-secondary">
            meal planner
          </Link>{" "}
          and it will appear here automatically, or ask Nabu on Telegram
          for live cooking help.
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Non-alcoholic pairing hint (Mon/Tue only)
// ---------------------------------------------------------------------------

function NonAlcoholicHint({ date, suggestion }: { date: string; suggestion: string }) {
  const day = new Date(date + "T12:00:00").getDay(); // 0=Sun … 6=Sat
  if (day !== 1 && day !== 2) return null; // Monday or Tuesday only
  if (!suggestion) return null;

  return (
    <NabuSurface tone="accent" className="p-5">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-50/80 text-lg dark:bg-emerald-900/20">
          🍋
        </div>
        <div className="min-w-0">
          <NabuKicker>Non-alcoholic pairing</NabuKicker>
          <p className="mt-1.5 text-sm leading-relaxed text-tertiary">
            {suggestion}
          </p>
        </div>
      </div>
    </NabuSurface>
  );
}

// ---------------------------------------------------------------------------
// Session notes
// ---------------------------------------------------------------------------

function SessionNotes({ notes }: { notes: string }) {
  if (!notes?.trim()) return null;

  return (
    <NabuSurface className="p-5">
      <NabuKicker>Session notes</NabuKicker>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-secondary">
        {notes}
      </p>
    </NabuSurface>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DRINK_EMOJIS = ["🍷", "🥂", "🍾", "🍺"];

function stripDrinkEmoji(text: string): string {
  return text.replace(new RegExp(DRINK_EMOJIS.join("|"), "g"), "").trim();
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

/**
 * Heuristic: does the session list look like a complete integrated replacement
 * for the base, or just a short list of adjustments/substitutions?
 *
 * A session list is "complete" when it has at least 3 items AND covers at
 * least half the base list length. Below that threshold we treat it as
 * partial adjustments that belong *alongside* the base recipe.
 */
function isCompleteOverride(sessionList: unknown[], baseList: unknown[]): boolean {
  if (sessionList.length === 0) return false;
  if (baseList.length === 0) return true;
  return sessionList.length >= 3 && sessionList.length >= baseList.length * 0.5;
}
