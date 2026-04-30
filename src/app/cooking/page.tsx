import Link from "next/link";
import { createSessionFromPlan } from "@/lib/cooking";
import type { CookingSession, SessionIngredient, CoachCards } from "@/lib/cooking";
import { getRecipe } from "@/lib/recipes";
import type { Recipe } from "@/lib/recipes";

function today(): string {
  return new Date().toISOString().split("T")[0];
}

export const dynamic = "force-dynamic";

export default async function CookingPage() {
  const date = today();
  // Auto-load existing session or create one from today's meal plan
  const session = await createSessionFromPlan(date);

  // Load full recipe data for side recipes so we can render ingredients + method
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
    <div className="min-h-screen bg-[#f8f6f3] dark:bg-stone-950">
      {/* Header */}
      <header className="border-b border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-xl font-serif text-stone-800 dark:text-stone-100">
                Live Cooking
              </h1>
              <p className="text-xs text-stone-400 dark:text-stone-500">
                {formatDateDisplay(date)}
              </p>
            </div>
          </div>
          {session && (
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusColor(session.status)}`}>
              {session.status}
            </span>
          )}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {session ? (
          <SessionView session={session} sideRecipes={sideRecipes} />
        ) : (
          <EmptyState date={date} />
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session view
// ---------------------------------------------------------------------------

function SessionView({ session, sideRecipes }: { session: CookingSession; sideRecipes: Recipe[] }) {
  const hasSessionIngredients = session.ingredients.session.length > 0;
  const hasSessionMethod = session.method.session.length > 0;
  const mainIngredients = hasSessionIngredients
    ? session.ingredients.session
    : session.ingredients.base;
  const mainMethod = hasSessionMethod
    ? session.method.session
    : session.method.base;

  const hasSides = sideRecipes.length > 0 || session.serveWith.length > 0;

  return (
    <>
      {/* ── Meal overview ── */}
      <section className="rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 p-5">
        <p className="text-xs tracking-widest uppercase text-stone-400 dark:text-stone-500 mb-1">
          Tonight&rsquo;s meal
        </p>
        <h2 className="text-2xl font-serif text-stone-800 dark:text-stone-100 leading-snug">
          {session.anchor.title}
        </h2>

        {hasSides && (
          <p className="text-sm text-stone-500 dark:text-stone-400 mt-2 leading-relaxed">
            {sideRecipes.length > 0 && (
              <>with {sideRecipes.map((r) => r.name).join(" & ")}</>
            )}
            {sideRecipes.length > 0 && session.serveWith.length > 0 && ", "}
            {session.serveWith.length > 0 && (
              <span className="text-stone-400 dark:text-stone-500">
                {sideRecipes.length === 0 ? "served with " : ""}
                {session.serveWith.join(", ").toLowerCase()}
              </span>
            )}
          </p>
        )}

        <div className="flex items-center gap-4 mt-3 text-sm text-stone-500 dark:text-stone-400">
          <span>Serves {session.servings.current}</span>
          {session.servings.current !== session.servings.base && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              (base: {session.servings.base})
            </span>
          )}
          <span className="text-stone-300 dark:text-stone-700">&middot;</span>
          <span className="text-xs">
            {session.anchor.provenance.source}
            {session.anchor.provenance.author && (
              <> &middot; {session.anchor.provenance.author}</>
            )}
          </span>
        </div>

        {/* Cooking flow — a quick practical sequence */}
        <CookingFlowNote
          mainTitle={session.anchor.title}
          sideRecipes={sideRecipes}
          serveWith={session.serveWith}
        />
      </section>

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

      {sideRecipes.map((recipe) => (
        <MealComponentBlock
          key={recipe.id}
          role="side"
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

      {session.serveWith.length > 0 && (
        <section className="rounded-xl bg-white/60 dark:bg-stone-900/60 border border-stone-200 dark:border-stone-800 p-4">
          <p className="text-[10px] tracking-widest uppercase text-stone-400 dark:text-stone-500 mb-1.5">
            Also on the table
          </p>
          <ul className="space-y-1">
            {session.serveWith.map((item, i) => (
              <li key={i} className="text-sm text-stone-500 dark:text-stone-400 flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-stone-300 dark:bg-stone-600 shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Adaptations */}
      {session.adaptations.length > 0 && (
        <section className="rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 p-5">
          <h3 className="text-xs tracking-widest uppercase text-stone-400 dark:text-stone-500 mb-3">
            Session Modifications
          </h3>
          <ul className="space-y-2">
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
        </section>
      )}

      {/* Notes */}
      {session.notes && (
        <section className="rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 p-5">
          <h3 className="text-xs tracking-widest uppercase text-stone-400 dark:text-stone-500 mb-2">
            Notes
          </h3>
          <p className="text-sm text-stone-600 dark:text-stone-400 whitespace-pre-wrap">
            {session.notes}
          </p>
        </section>
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
        <div
          key={cfg.key}
          className={`rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 border-l-4 ${cfg.color} p-4`}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm">{cfg.icon}</span>
            <span className="text-xs font-medium tracking-widest uppercase text-stone-400 dark:text-stone-500">
              {cfg.label}
            </span>
          </div>
          <p className="text-sm text-stone-700 dark:text-stone-300 leading-relaxed">
            {cards[cfg.key]}
          </p>
        </div>
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
  role: "main" | "side";
  title: string;
  servings?: string | number;
  ingredients: SessionIngredient[];
  method: string[];
  modified?: { ingredients: boolean; method: boolean };
}) {
  return (
    <section className="rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 p-5 space-y-5">
      {/* Component header — role label + title */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span
            className={`text-[10px] tracking-widest uppercase font-medium ${
              role === "main"
                ? "text-stone-600 dark:text-stone-300"
                : "text-stone-400 dark:text-stone-500"
            }`}
          >
            {role === "main" ? "Main" : "Side"}
          </span>
        </div>
        <h3 className="text-xl font-serif text-stone-800 dark:text-stone-100 leading-snug">
          {title}
        </h3>
        {servings && (
          <p className="text-xs text-stone-400 dark:text-stone-500 mt-1">
            Serves {servings}
          </p>
        )}
      </div>

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
    </section>
  );
}

// ---------------------------------------------------------------------------
// Ingredient list
// ---------------------------------------------------------------------------

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
    <div className="text-center py-16 space-y-4">
      <div className="text-5xl opacity-30">&#127859;</div>
      <h2 className="text-lg font-serif text-stone-600 dark:text-stone-400">
        Nothing planned for today
      </h2>
      <p className="text-sm text-stone-400 dark:text-stone-500 max-w-sm mx-auto">
        Assign a recipe in the{" "}
        <Link href="/meals" className="underline hover:text-stone-600 dark:hover:text-stone-300">
          meal planner
        </Link>{" "}
        and it will appear here automatically, or ask Nabu on Telegram
        for live cooking help.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cooking flow note — practical sequence summary
// ---------------------------------------------------------------------------

function CookingFlowNote({
  mainTitle,
  sideRecipes,
  serveWith,
}: {
  mainTitle: string;
  sideRecipes: Recipe[];
  serveWith: string[];
}) {
  // Build a short, practical cooking sequence
  const steps: string[] = [];

  if (sideRecipes.length > 0) {
    // When there are sides, suggest starting prep for items that take longest
    steps.push(
      `Read through all recipes. Start any side prep that needs resting or chilling first.`
    );
    steps.push(`Begin the ${mainTitle}.`);
    for (const side of sideRecipes) {
      steps.push(`Prepare the ${side.name} alongside or between main steps.`);
    }
  } else {
    steps.push(`Read through the recipe, then gather your ingredients.`);
    steps.push(`Work through the ${mainTitle} method step by step.`);
  }

  if (serveWith.length > 0) {
    steps.push(
      `Get ${serveWith.join(" and ").toLowerCase()} ready to serve alongside.`
    );
  }

  steps.push("Taste, adjust seasoning, and plate.");

  return (
    <div className="mt-4 pt-3 border-t border-stone-100 dark:border-stone-800">
      <p className="text-[10px] tracking-widest uppercase text-stone-400 dark:text-stone-500 mb-2">
        Cooking flow
      </p>
      <ol className="space-y-1">
        {steps.map((step, i) => (
          <li
            key={i}
            className="text-sm text-stone-500 dark:text-stone-400 flex gap-2"
          >
            <span className="text-stone-300 dark:text-stone-600 shrink-0 tabular-nums">
              {i + 1}.
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusColor(status: string): string {
  switch (status) {
    case "active":
      return "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300";
    case "completed":
      return "bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400";
    case "abandoned":
      return "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400";
    default:
      return "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300";
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
