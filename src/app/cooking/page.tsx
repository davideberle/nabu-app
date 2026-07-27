import Image from "next/image";
import Link from "next/link";
import { CompleteSessionButton } from "./complete-session-button";
import { NabuBadge, NabuEmptyState, NabuHeader, NabuKicker, NabuMain, NabuPageShell, NabuSectionHeader, NabuSurface } from "@/components/ui/nabu";
import { createSessionFromPlan } from "@/lib/cooking";
import { todayInZurich } from "@/lib/date";
import {
  activeComponents,
  componentStatusLabel,
  firstServingsClause,
  isDrinkServeWith,
  resolveMainDish,
  resolveSessionHero,
  resolveWorkingRecipe,
  setAsideComponents,
  visibleServeWith,
} from "@/lib/cooking-session";
import type {
  CookingSession,
  RelatedRecipe,
  ResolvedMain,
  SessionHero,
  SessionIngredient,
  WorkingRecipe,
} from "@/lib/cooking-session";
import { buildCookingGuidance, extractTableSides, formatRecipeTime } from "@/lib/cooking-guidance";
import { formatServings, getRecipe } from "@/lib/recipes";
import type { Recipe } from "@/lib/recipes";

export const dynamic = "force-dynamic";

export default async function CookingPage() {
  const date = todayInZurich();
  // Auto-load existing session or create one from today's meal plan
  const session = await createSessionFromPlan(date);

  // The rendered main is the resolved main dish, which may differ from the
  // anchor when the session established an explicit main (e.g. via Telegram).
  const resolved = session ? resolveMainDish(session) : null;
  const mainRecipe = resolved?.recipeId
    ? await getRecipe(resolved.recipeId)
    : undefined;
  const anchorRecipe =
    session && resolved?.anchorIsSecondary && session.anchor.recipeId
      ? await getRecipe(session.anchor.recipeId)
      : undefined;
  const sideRecipes: Recipe[] = [];
  if (session) {
    const results = await Promise.all(
      activeComponents(session).map((r) => getRecipe(r.recipeId))
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
        {session && resolved ? (
          <SessionView
            session={session}
            resolved={resolved}
            mainRecipe={mainRecipe ?? undefined}
            anchorRecipe={anchorRecipe ?? undefined}
            sideRecipes={sideRecipes}
          />
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
  resolved,
  mainRecipe,
  anchorRecipe,
  sideRecipes,
}: {
  session: CookingSession;
  resolved: ResolvedMain;
  mainRecipe?: Recipe;
  anchorRecipe?: Recipe;
  sideRecipes: Recipe[];
}) {
  const hero = resolveSessionHero(session, mainRecipe?.image);
  const working = resolveWorkingRecipe(
    session,
    mainRecipe
      ? { ingredients: toSessionIngredients(mainRecipe.ingredients), method: mainRecipe.method }
      : null
  );

  const sideRecipeById = new Map(sideRecipes.map((recipe) => [recipe.id, recipe]));
  const mealComponents = activeComponents(session)
    .map((related) => ({ related, recipe: sideRecipeById.get(related.recipeId) }))
    .filter((item): item is { related: RelatedRecipe; recipe: Recipe } => !!item.recipe);
  const setAside = setAsideComponents(session);

  const componentTitles = session.relatedRecipes.map((r) => r.title);
  const tableSides = extractTableSides(
    [...working.ingredients, ...working.ingredientAdjustments],
    visibleServeWith(session, componentTitles)
  );
  const guidance = buildCookingGuidance({
    session,
    mainRecipe,
    sideRecipes: mealComponents.map(({ recipe }) => recipe),
  });
  const timeLabel = formatRecipeTime(mainRecipe?.time);

  const alsoCooking = [
    ...(resolved.anchorIsSecondary ? [session.anchor.title] : []),
    ...mealComponents.map(({ recipe }) => recipe.name),
  ];

  return (
    <>
      <MealOverview
        session={session}
        resolved={resolved}
        hero={hero}
        alsoCooking={alsoCooking}
        tableSides={tableSides}
        timeLabel={timeLabel}
        mealFlow={guidance.mealFlow}
        wine={session.coachCards.wine || guidance.pairing.wine}
      />

      <StoryCard story={session.story} title={resolved.title} />

      <SessionNotes notes={session.notes} />

      {/* ── Main dish: tonight's working recipe ── */}
      <MainDishBlock session={session} resolved={resolved} working={working} />

      {/* ── Secondary dishes, subordinate but complete ── */}
      {resolved.anchorIsSecondary && (
        <CollapsedRecipeBlock
          roleLabel="Also tonight"
          title={session.anchor.title}
          sourceLine={provenanceLabel(session)}
          image={anchorRecipe?.image}
          servings={anchorRecipe?.servings}
          ingredients={session.ingredients.base}
          method={session.method.base}
        />
      )}

      {mealComponents.map(({ related, recipe }) => (
        <CollapsedRecipeBlock
          key={recipe.id}
          roleLabel={componentRoleLabel(related.kind)}
          title={recipe.name}
          image={recipe.image}
          servings={recipe.servings}
          ingredients={toSessionIngredients(recipe.ingredients)}
          method={recipe.method}
        />
      ))}

      {setAside.length > 0 && <SetAsideRow components={setAside} />}

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
// Meal overview — hero, tonight's line-up, order of attack
// ---------------------------------------------------------------------------

function MealOverview({
  session,
  resolved,
  hero,
  alsoCooking,
  tableSides,
  timeLabel,
  mealFlow,
  wine,
}: {
  session: CookingSession;
  resolved: ResolvedMain;
  hero: SessionHero;
  alsoCooking: string[];
  tableSides: string[];
  timeLabel: string | null;
  mealFlow: string[];
  wine: string;
}) {
  const servingLabel = formatServings(session.servings.current);
  const subtitle =
    resolved.summary ??
    (resolved.anchorIsSecondary ? null : provenanceLabel(session));
  const overviewItems = [
    {
      label: "Also cooking",
      value: alsoCooking.length ? alsoCooking.join(" + ") : "Main dish only",
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
      <SessionHeroArea hero={hero} />

      <div className="space-y-5 p-5">
        <div className="space-y-3">
          <NabuKicker>Tonight</NabuKicker>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-2xl font-semibold leading-tight tracking-[-0.02em] text-primary">
                {resolved.title}
              </h2>
              {subtitle && (
                <p className="mt-1 text-xs text-tertiary">{subtitle}</p>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {servingLabel && <NabuBadge>{servingLabel}</NabuBadge>}
              {timeLabel && <NabuBadge tone="blue">{timeLabel}</NabuBadge>}
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
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
// Hero area — recipe/session image, or a designed fallback (never blank)
// ---------------------------------------------------------------------------

function SessionHeroArea({ hero }: { hero: SessionHero }) {
  if (hero.kind === "image") {
    return (
      <div className="border-b border-primary bg-secondary">
        <HeroImage src={hero.url} alt={hero.alt} />
        {hero.source && (
          <p className="px-5 pt-2 text-[10px] text-quaternary">{hero.source}</p>
        )}
      </div>
    );
  }

  const initial = hero.title.trim().charAt(0).toUpperCase() || "•";
  return (
    <div className="relative h-28 overflow-hidden border-b border-primary bg-gradient-to-br from-utility-orange-50 via-utility-orange-50/40 to-transparent sm:h-32">
      <span
        aria-hidden
        className="absolute -top-8 right-2 select-none font-serif text-[10rem] leading-none text-utility-orange-200/60"
      >
        {initial}
      </span>
      <p className="absolute bottom-4 left-5 text-[11px] font-medium uppercase tracking-[0.18em] text-utility-orange-500">
        Tonight’s table
      </p>
    </div>
  );
}

function HeroImage({ src, alt }: { src: string; alt: string }) {
  // next/image only serves local assets and configured remote hosts; other
  // truthful session-supplied URLs fall back to a plain eager image.
  if (isOptimizableImageSrc(src)) {
    return (
      <Image
        src={src}
        alt={alt}
        width={960}
        height={540}
        preload
        className="aspect-[16/9] w-full object-cover"
      />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src}
      alt={alt}
      loading="eager"
      className="aspect-[16/9] w-full object-cover"
    />
  );
}

function isOptimizableImageSrc(src: string): boolean {
  if (src.startsWith("/")) return true;
  try {
    const host = new URL(src).hostname;
    return host.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
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
// Main dish block — tonight's working recipe in neutral text
// ---------------------------------------------------------------------------

function MainDishBlock({
  session,
  resolved,
  working,
}: {
  session: CookingSession;
  resolved: ResolvedMain;
  working: WorkingRecipe;
}) {
  const provenanceLine = working.isSessionVersion
    ? resolved.anchorIsSecondary
      ? "Tonight’s working recipe, updated live from the cooking chat."
      : joinMeta("Tonight’s version", provenanceLabel(session))
    : provenanceLabel(session);

  return (
    <NabuSurface className="space-y-5 p-5">
      <div>
        <NabuSectionHeader
          eyebrow="Main"
          title={resolved.title}
          action={
            working.isSessionVersion ? (
              <NabuBadge tone="amber">Tonight’s version</NabuBadge>
            ) : null
          }
        />
        {provenanceLine && (
          <p className="mt-1 text-xs text-tertiary">{provenanceLine}</p>
        )}
      </div>

      {working.ingredients.length + working.ingredientAdjustments.length > 0 && (
        <div className="border-t border-secondary pt-3">
          <h4 className="mb-3 text-xs uppercase tracking-widest text-quaternary">
            Ingredients
          </h4>
          <IngredientList
            ingredients={working.ingredients}
            tonightExtras={working.ingredientAdjustments}
          />
        </div>
      )}

      {working.method.length + working.methodAdjustments.length > 0 && (
        <div className="border-t border-secondary pt-3">
          <h4 className="mb-3 text-xs uppercase tracking-widest text-quaternary">
            Method
          </h4>
          {working.methodAdjustments.length > 0 && (
            <div className="mb-4">
              <TonightGroupLabel />
              <ul className="mt-1.5 space-y-1.5">
                {working.methodAdjustments.map((note, i) => (
                  <li key={i} className="text-sm leading-relaxed text-secondary">
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <MethodSteps steps={working.method} />
        </div>
      )}
    </NabuSurface>
  );
}

function provenanceLabel(session: CookingSession): string {
  const { source, author } = session.anchor.provenance;
  if (author && source?.toLowerCase().includes(author.toLowerCase())) {
    return source;
  }
  return [source, author].filter(Boolean).join(" · ");
}

function joinMeta(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------------------
// Secondary recipe block — collapsed, subordinate to the main dish
// ---------------------------------------------------------------------------

function CollapsedRecipeBlock({
  roleLabel,
  title,
  sourceLine,
  image,
  servings,
  ingredients,
  method,
}: {
  roleLabel: string;
  title: string;
  sourceLine?: string;
  image?: string | null;
  servings?: string | number;
  ingredients: SessionIngredient[];
  method: string[];
}) {
  const servingLabel = servings
    ? formatServings(firstServingsClause(String(servings)))
    : "";

  return (
    <NabuSurface className="p-0">
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <NabuKicker>{roleLabel}</NabuKicker>
          <h3 className="mt-0.5 text-base font-semibold tracking-[-0.02em] text-primary">
            {title}
          </h3>
          {sourceLine && (
            <p className="mt-0.5 text-xs text-tertiary">{sourceLine}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {servingLabel && <NabuBadge>{servingLabel}</NabuBadge>}
          <svg
            className="h-4 w-4 text-quaternary transition-transform group-open:rotate-180"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </summary>

      <div className="space-y-5 border-t border-secondary p-5">
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

        {ingredients.length > 0 && (
          <div>
            <h4 className="mb-3 text-xs uppercase tracking-widest text-quaternary">
              Ingredients
            </h4>
            <IngredientList ingredients={ingredients} />
          </div>
        )}

        {method.length > 0 && (
          <div>
            <h4 className="mb-3 text-xs uppercase tracking-widest text-quaternary">
              Method
            </h4>
            <MethodSteps steps={method} />
          </div>
        )}
      </div>
    </details>
    </NabuSurface>
  );
}

function SetAsideRow({ components }: { components: RelatedRecipe[] }) {
  const parts = components.map((component) => {
    const label = component.status ? componentStatusLabel(component.status) : "";
    return label ? `${component.title} (${label})` : component.title;
  });
  return (
    <p className="px-1 text-xs leading-relaxed text-quaternary">
      Set aside tonight: {parts.join(" · ")}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Shared ingredient / method rendering (neutral text)
// ---------------------------------------------------------------------------

function componentRoleLabel(role: "starter" | "side" | "dessert"): string {
  switch (role) {
    case "starter":
      return "Starter";
    case "dessert":
      return "Dessert";
    default:
      return "Side";
  }
}

function TonightGroupLabel() {
  return (
    <h5 className="text-xs font-medium text-tertiary">
      <span aria-hidden className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle" />
      Tonight
    </h5>
  );
}

function IngredientList({
  ingredients,
  tonightExtras = [],
}: {
  ingredients: SessionIngredient[];
  tonightExtras?: SessionIngredient[];
}) {
  const hasGroups = ingredients.some((i) => i.group);
  const groups = new Map<string, SessionIngredient[]>();
  for (const ing of ingredients) {
    const g = hasGroups ? (ing.group || "Other") : "";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(ing);
  }

  return (
    <div className="space-y-4">
      {/* Session additions grouped once under a quiet "Tonight" label */}
      {tonightExtras.length > 0 && (
        <div>
          <TonightGroupLabel />
          <ul className="mt-1.5 space-y-1.5">
            {tonightExtras.map((ing, i) => (
              <IngredientRow key={`t-${i}`} ing={ing} />
            ))}
          </ul>
        </div>
      )}
      {Array.from(groups.entries()).map(([group, ings]) => (
        <div key={group || "_ungrouped"}>
          {group && (
            <h5 className="mb-1.5 text-xs font-medium text-tertiary">
              {group}
            </h5>
          )}
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
    <li className="flex justify-between gap-4 text-sm text-secondary">
      <span>{ing.item}</span>
      <span className="shrink-0 text-right tabular-nums text-quaternary">
        {formatIngredientAmount(ing)}
      </span>
    </li>
  );
}

function MethodSteps({ steps }: { steps: string[] }) {
  return (
    <ol className="space-y-4">
      {steps.map((step, i) => (
        <li key={i} className="flex gap-3 text-sm text-secondary">
          <span className="shrink-0 pt-0.5 font-serif text-lg leading-none text-quaternary">
            {i + 1}
          </span>
          <span className="leading-relaxed">{step}</span>
        </li>
      ))}
    </ol>
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

function toSessionIngredients(ingredients: Recipe["ingredients"]): SessionIngredient[] {
  return ingredients.map((ing) => ({
    amount: ing.amount,
    item: ing.item,
    unit: ing.unit,
    group: ing.group ?? null,
  }));
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
// Session notes
// ---------------------------------------------------------------------------

function SessionNotes({ notes }: { notes: string }) {
  const useful = filterSessionNotes(notes);
  if (!useful) return null;

  return (
    <div className="px-1">
      <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-quaternary">
        Tonight&apos;s notes
      </p>
      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-tertiary">
        {useful}
      </p>
    </div>
  );
}

function filterSessionNotes(notes: string): string | null {
  if (!notes?.trim()) return null;

  const lines = notes
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => {
      if (!l) return false;
      // Drop drink-pairing lines
      if (isDrinkServeWith(l)) return false;
      // Drop leftover backstory prefixes
      if (/^backstory:/i.test(l)) return false;
      // Drop generic filler
      if (/^(enjoy|bon app[eé]tit|have a (great|good)|happy cooking|good luck)/i.test(l)) return false;
      // Drop very short noise (e.g. "ok", "done", "—")
      if (l.replace(/[^a-zA-Z]/g, "").length < 6) return false;
      return true;
    });

  const result = lines.join("\n").trim();
  return result || null;
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
