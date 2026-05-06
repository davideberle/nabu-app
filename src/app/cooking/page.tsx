import Image from "next/image";
import Link from "next/link";
import { CompleteSessionButton } from "./complete-session-button";
import { NabuBadge, NabuEmptyState, NabuHeader, NabuKicker, NabuMain, NabuPageShell, NabuSectionHeader, NabuSurface } from "@/components/ui/nabu";
import { createSessionFromPlan } from "@/lib/cooking";
import { todayInZurich } from "@/lib/date";
import type { CookingSession, SessionIngredient, CoachCards } from "@/lib/cooking";
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
        action={session ? (
          <NabuBadge tone={statusTone(session.status)}>{session.status}</NabuBadge>
        ) : null}
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
      {/* ── Meal overview ── */}
      <NabuSurface className="p-5">
        <NabuSectionHeader
          eyebrow="Tonight’s meal"
          title={session.anchor.title}
          action={
            <CompleteSessionButton
              sessionId={session.id}
              completed={session.status === "completed"}
            />
          }
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

        {/* Cooking flow — a quick practical sequence */}
        <CookingFlowNote steps={guidance.mealFlow} timeLabel={timeLabel} />

        <PairingSuggestions pairing={guidance.pairing} />
      </NabuSurface>

      {/* Coach cards */}
      <CoachCardsSection cards={session.coachCards} />

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
          <NabuKicker>Also on the table</NabuKicker>
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

      {/* Adaptations */}
      {session.adaptations.length > 0 && (
        <NabuSurface className="p-5">
          <NabuKicker>Session Modifications</NabuKicker>
          <ul className="mt-3 space-y-2">
            {session.adaptations.map((a) => (
              <li key={a.id} className="flex items-start gap-2 text-sm">
                <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 mt-0.5">
                  {a.kind}
                </span>
                <span className="text-stone-600 dark:text-stone-400">
                  {a.summary}
                </span>
              </li>
            ))}
          </ul>
        </NabuSurface>
      )}

      {/* Notes */}
      {session.notes && (
        <NabuSurface className="p-5">
          <NabuKicker>Notes</NabuKicker>
          <p className="mt-2 whitespace-pre-wrap text-sm text-stone-600 dark:text-stone-400">
            {session.notes}
          </p>
        </NabuSurface>
      )}

      {/* Footer meta */}
      <div className="text-center text-xs text-stone-400 dark:text-stone-600 pb-8">
        Last updated {formatTimestamp(session.updatedAt)}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Coach cards
// ---------------------------------------------------------------------------

const CARD_CONFIG: { key: keyof CoachCards; label: string; icon: string; color: string }[] = [
  { key: "nextMove", label: "Next move", icon: "\uD83D\uDD25", color: "border-l-orange-400" },
  { key: "upgrade", label: "Upgrade", icon: "\u2728", color: "border-l-violet-400" },
  { key: "shortcut", label: "Shortcut", icon: "\u23F1\uFE0F", color: "border-l-sky-400" },
  { key: "wine", label: "Wine", icon: "\uD83C\uDF77", color: "border-l-rose-400" },
];

function CoachCardsSection({ cards }: { cards: CoachCards }) {
  const active = CARD_CONFIG.filter((c) => cards[c.key]);
  if (active.length === 0) return null;

  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {active.map((cfg) => (
        <NabuSurface
          key={cfg.key}
          as="div"
          className={`border-l-4 ${cfg.color} p-4`}
        >
          <div className="mb-1 flex items-center gap-2">
            <span className="text-sm">{cfg.icon}</span>
            <NabuKicker>{cfg.label}</NabuKicker>
          </div>
          <p className="text-sm leading-relaxed text-stone-700 dark:text-stone-300">
            {cards[cfg.key]}
          </p>
        </NabuSurface>
      ))}
    </section>
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

// ---------------------------------------------------------------------------
// Cooking flow note — practical sequence summary
// ---------------------------------------------------------------------------

function CookingFlowNote({
  steps,
  timeLabel,
}: {
  steps: string[];
  timeLabel: string | null;
}) {
  return (
    <div className="mt-4 pt-3 border-t border-stone-100 dark:border-stone-800">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[10px] tracking-widest uppercase text-stone-400 dark:text-stone-500">
          Meal flow
        </p>
        {timeLabel && (
          <span className="text-xs text-stone-400 dark:text-stone-500">
            {timeLabel}
          </span>
        )}
      </div>
      <ol className="space-y-2">
        {steps.map((step, i) => (
          <li
            key={i}
            className="flex gap-2 text-sm text-stone-600 dark:text-stone-400"
          >
            <span className="shrink-0 tabular-nums text-stone-300 dark:text-stone-600">
              {i + 1}.
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function PairingSuggestions({
  pairing,
}: {
  pairing: { wine: string; nonAlcoholic: string };
}) {
  return (
    <div className="mt-4 grid gap-3 border-t border-stone-100 pt-3 sm:grid-cols-2 dark:border-stone-800">
      <div>
        <p className="text-[10px] tracking-widest uppercase text-stone-400 dark:text-stone-500">
          Wine
        </p>
        <p className="mt-1 text-sm leading-relaxed text-stone-600 dark:text-stone-400">
          {pairing.wine}
        </p>
      </div>
      <div>
        <p className="text-[10px] tracking-widest uppercase text-stone-400 dark:text-stone-500">
          Non-alcoholic
        </p>
        <p className="mt-1 text-sm leading-relaxed text-stone-600 dark:text-stone-400">
          {pairing.nonAlcoholic}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusTone(status: string): "stone" | "green" | "amber" | "red" {
  switch (status) {
    case "active":
      return "green";
    case "completed":
      return "stone";
    case "abandoned":
      return "red";
    default:
      return "amber";
  }
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
