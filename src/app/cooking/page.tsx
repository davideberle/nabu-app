import Image from "next/image";
import Link from "next/link";
import { CompleteSessionButton } from "./complete-session-button";
import { MealBalancePanel } from "./meal-balance";
import { NabuBadge, NabuEmptyState, NabuHeader, NabuKicker, NabuMain, NabuPageShell, NabuSurface } from "@/components/ui/nabu";
import { createSessionFromPlan, deriveSessionCoherence } from "@/lib/cooking";
import type { MealCoherenceReview } from "@/lib/meal-coherence";
import { todayInZurich } from "@/lib/date";
import {
  activeComponents,
  anchorProvenanceLabel,
  componentStatusLabel,
  firstServingsClause,
  orderedCookStack,
  recipeProvenanceLabel,
  resolveMainDish,
  resolveSessionHero,
  resolveWorkingRecipe,
  setAsideComponents,
  visibleServeWith,
  visibleSessionNotes,
} from "@/lib/cooking-session";
import type {
  CookingSession,
  RelatedRecipe,
  ResolvedMain,
  SessionHero,
  SessionIngredient,
  WorkingIngredient,
  WorkingRecipe,
  WorkingStep,
} from "@/lib/cooking-session";
import {
  buildCourseMenu,
  buildPairingSuggestion,
  extractTableSides,
  formatRecipeTime,
} from "@/lib/cooking-guidance";
import type { MenuCourse } from "@/lib/cooking-guidance";
import { formatServings, getRecipe } from "@/lib/recipes";
import type { Recipe } from "@/lib/recipes";

export const dynamic = "force-dynamic";

export default async function CookingPage() {
  const date = todayInZurich();
  // Auto-load existing session or create one from today's meal plan.
  //
  // A malformed historical row — a legacy shape, a hand-edited field, an anchor
  // that is not an object — must not blank the page the cook is standing at the
  // stove with. Loading and resolving the main is where such a row throws, so
  // both degrade to the useful empty state rather than the error screen.
  // ./error.tsx is the backstop for anything further down the render.
  let session: CookingSession | null = null;
  let resolved: ResolvedMain | null = null;
  try {
    session = await createSessionFromPlan(date);
    // The rendered main is the resolved main dish, which may differ from the
    // anchor when the session established an explicit main (e.g. via Telegram).
    resolved = session ? resolveMainDish(session) : null;
  } catch (error) {
    console.error(`[cooking] session for ${date} could not be loaded:`, error);
    session = null;
    resolved = null;
  }
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
  // Derived on every render, never stored (live-cooking DESIGN.md §3 rule 16).
  // A malformed historical row must not blank the page the cook is standing at
  // the stove with — the balance panel simply does not render for it.
  let coherence: MealCoherenceReview | null = null;
  if (session) {
    try {
      coherence = await deriveSessionCoherence(session);
    } catch (error) {
      console.error(
        `[cooking] coherence review failed for session ${session.id}:`,
        error,
      );
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
            coherence={coherence}
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
  coherence,
}: {
  session: CookingSession;
  resolved: ResolvedMain;
  mainRecipe?: Recipe;
  anchorRecipe?: Recipe;
  sideRecipes: Recipe[];
  coherence: MealCoherenceReview | null;
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
  const plainServeWith = visibleServeWith(session, componentTitles);
  const tableSides = extractTableSides(working.ingredients, plainServeWith);
  const timeLabel = formatRecipeTime(mainRecipe?.time);

  // The whole meal, as a menu: course label and dish name only. Components
  // without a stored recipe record are still on tonight's stove, so they keep
  // their session title rather than dropping off the menu.
  const menu = buildCourseMenu({
    mainTitle: resolved.title,
    alsoMains: resolved.anchorIsSecondary ? [session.anchor.title] : [],
    components: activeComponents(session).map((related) => ({
      kind: related.kind,
      title: sideRecipeById.get(related.recipeId)?.name ?? related.title,
    })),
    tableSides,
  });

  const pairing = buildPairingSuggestion({
    mainTitle: resolved.title,
    mainRecipe,
    ingredients: working.ingredients,
    method: working.method.map((step) => step.text),
    tableSides,
  });

  // Real recipe identity: the anchor's provenance when it is the main, the
  // stored main recipe's source when an explicit main displaced the anchor.
  // Chat-origin/internal wording never renders (rule 10).
  const mainProvenance = resolved.anchorIsSecondary
    ? mainRecipe
      ? recipeProvenanceLabel({
          source: mainRecipe.source?.publication ?? mainRecipe.source?.cookbook,
          author: mainRecipe.source?.author,
        })
      : null
    : anchorProvenanceLabel(session);
  const provenanceUrl =
    !resolved.anchorIsSecondary && mainProvenance
      ? session.anchor.provenance.url
      : undefined;

  const notes = visibleSessionNotes(session.notes, working, session.adaptations);
  const drink = stripDrinkEmoji(session.coachCards.wine || pairing.wine).replace(
    /^Optional:\s*/i,
    ""
  );
  const cookStack = orderedCookStack(session);

  return (
    <>
      {/* ── What the meal is, before any recipe detail ── */}
      {menu.length > 0 && <CourseMenu courses={menu} />}

      {/* ── One mise-en-place pass: every ingredient before any method ── */}
      <MealIngredients
        groups={[
          { title: resolved.title, roleLabel: "Main", ingredients: working.ingredients },
          ...(resolved.anchorIsSecondary && session.ingredients.base.length > 0
            ? [{
                title: session.anchor.title,
                roleLabel: "Also tonight",
                ingredients: session.ingredients.base,
              }]
            : []),
          ...mealComponents
            .filter(({ recipe }) => recipe.ingredients.length > 0)
            .map(({ related, recipe }) => ({
              title: recipe.name,
              roleLabel: componentRoleLabel(related.kind),
              ingredients: toSessionIngredients(recipe.ingredients),
            })),
        ]}
        serveWith={plainServeWith}
      />

      {/* ── One uninterrupted cook stack: full methods, all expanded ── */}
      <section aria-labelledby="cook-heading" className="space-y-4">
        <div className="px-1">
          <NabuKicker>Preparation</NabuKicker>
          <h2 id="cook-heading" className="mt-1 text-xl font-semibold tracking-[-0.02em] text-primary">
            Cook
          </h2>
        </div>

        {cookStack.map((dish) => {
          if (dish.kind === "main") {
            return (
              <div key="main" data-cook-dish={resolved.title}>
                <MainCookRecipe
                  resolved={resolved}
                  hero={hero}
                  provenance={mainProvenance}
                  provenanceUrl={provenanceUrl}
                  servingLabel={formatServings(session.servings.current)}
                  timeLabel={timeLabel}
                  working={working}
                  drink={drink}
                  notes={notes}
                />
              </div>
            );
          }

          if (dish.kind === "anchor") {
            return (
              <CookRecipeBlock
                key="secondary-anchor"
                roleLabel="Also tonight"
                title={session.anchor.title}
                sourceLine={anchorProvenanceLabel(session) ?? undefined}
                sourceUrl={session.anchor.provenance.url}
                image={anchorRecipe?.image}
                servings={anchorRecipe?.servings}
                method={session.method.base}
              />
            );
          }

          const component = mealComponents.find(
            ({ related }) => related.recipeId === dish.ref,
          );
          if (!component) return null;
          const { related, recipe } = component;
          return (
            <CookRecipeBlock
              key={recipe.id}
              roleLabel={componentRoleLabel(related.kind)}
              title={recipe.name}
              sourceLine={recipeProvenanceLabel({
                source: recipe.source?.publication ?? recipe.source?.cookbook,
                author: recipe.source?.author,
              }) ?? undefined}
              sourceUrl={recipe.source?.url}
              image={recipe.image}
              servings={recipe.servings}
              timeLabel={formatRecipeTime(recipe.time)}
              method={recipe.method}
            />
          );
        })}
      </section>

      {/* ── Support, subordinate to the complete cook stack ── */}
      {coherence && (
        <MealBalancePanel
          sessionId={session.id}
          review={coherence}
          relatedRecipes={session.relatedRecipes}
        />
      )}

      {setAside.length > 0 && <SetAsideRow components={setAside} />}

      <StoryCard story={session.story} />

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
// Course menu — the orientation surface above the recipe: course label and
// dish names in dining order, nothing else. One quiet block of label rows
// rather than a card per course, so the recipe below stays the anchor.
// ---------------------------------------------------------------------------

function CourseMenu({ courses }: { courses: MenuCourse[] }) {
  return (
    <NabuSurface className="p-5">
      <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-quaternary">
        Tonight’s menu
      </h2>
      <dl className="mt-3 space-y-2">
        {courses.map((course) => (
          <div key={course.kind} className="flex gap-3">
            <dt className="w-24 shrink-0 pt-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-quaternary">
              {course.label}
            </dt>
            <dd className="min-w-0 text-sm leading-relaxed text-secondary">
              {course.dishes.join(" · ")}
            </dd>
          </div>
        ))}
      </dl>
    </NabuSurface>
  );
}

// ---------------------------------------------------------------------------
// The main cook card — recipe identity, useful current-cook context, and the
// resolved working method. Ingredients live in the mise-en-place surface above
// so every active dish can be gathered before any method begins.
//
// The dishes of the meal belong to the menu above, so the context carries only
// what the menu cannot: the drink and the session notes worth reading.
// ---------------------------------------------------------------------------

function MainCookRecipe({
  resolved,
  hero,
  provenance,
  provenanceUrl,
  servingLabel,
  timeLabel,
  working,
  drink,
  notes,
}: {
  resolved: ResolvedMain;
  hero: SessionHero;
  provenance: string | null;
  provenanceUrl?: string;
  servingLabel: string;
  timeLabel: string | null;
  working: WorkingRecipe;
  drink: string;
  notes: string | null;
}) {
  const contextRows = [
    drink ? { label: "Drink", value: drink } : null,
    notes ? { label: "Notes", value: notes } : null,
  ].filter((row): row is { label: string; value: string } => row !== null);

  return (
    <NabuSurface className="overflow-hidden p-0">
      <SessionHeroArea hero={hero} />

      <div className="p-5">
        <NabuKicker>Tonight’s recipe</NabuKicker>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold leading-tight tracking-[-0.02em] text-primary">
              {resolved.title}
            </h2>
            {resolved.summary && (
              <p className="mt-1 text-sm text-tertiary">{resolved.summary}</p>
            )}
            {provenance && (
              <p className="mt-1 text-xs text-tertiary">
                {isLinkableUrl(provenanceUrl) ? (
                  <a
                    href={provenanceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-secondary underline-offset-2 hover:text-secondary"
                  >
                    {provenance}
                  </a>
                ) : (
                  provenance
                )}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {servingLabel && <NabuBadge>{servingLabel}</NabuBadge>}
            {timeLabel && <NabuBadge tone="blue">{timeLabel}</NabuBadge>}
            {working.hasSessionChanges && (
              <NabuBadge tone="amber">Adapted tonight</NabuBadge>
            )}
          </div>
        </div>

        {contextRows.length > 0 && (
          <div className="mt-5 space-y-2 border-t border-secondary pt-4">
            {contextRows.map((row) => (
              <div key={row.label} className="flex gap-3">
                <span className="w-24 shrink-0 pt-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-quaternary">
                  {row.label}
                </span>
                <span className="min-w-0 whitespace-pre-wrap text-sm leading-relaxed text-secondary">
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        )}

        {working.method.length > 0 && (
          <div className="mt-5 border-t border-secondary pt-4">
            <h4 className="mb-3 text-xs uppercase tracking-widest text-quaternary">
              Method
            </h4>
            <MethodSteps steps={working.method} />
          </div>
        )}
      </div>
    </NabuSurface>
  );
}

type IngredientDishGroup = {
  title: string;
  roleLabel: string;
  ingredients: WorkingIngredient[];
};

function MealIngredients({
  groups,
  serveWith,
}: {
  groups: IngredientDishGroup[];
  serveWith: string[];
}) {
  const visibleGroups = groups.filter((group) => group.ingredients.length > 0);
  if (visibleGroups.length === 0 && serveWith.length === 0) return null;

  return (
    <NabuSurface className="p-5">
      <NabuKicker>Mise en place</NabuKicker>
      <h2 className="mt-1 text-xl font-semibold tracking-[-0.02em] text-primary">
        Ingredients
      </h2>
      <div className="mt-5 space-y-6">
        {visibleGroups.map((group, index) => (
          <section
            key={`${group.roleLabel}-${group.title}`}
            data-ingredient-dish={group.title}
            className={index > 0 ? "border-t border-secondary pt-5" : undefined}
          >
            <NabuKicker>{group.roleLabel}</NabuKicker>
            <p className="mt-0.5 mb-3 text-base font-semibold tracking-[-0.02em] text-primary">
              {group.title}
            </p>
            <IngredientList ingredients={group.ingredients} />
          </section>
        ))}
        {serveWith.length > 0 && (
          <section
            data-ingredient-dish="Serve with"
            className={visibleGroups.length > 0 ? "border-t border-secondary pt-5" : undefined}
          >
            <NabuKicker>At the table</NabuKicker>
            <p className="mt-0.5 mb-3 text-base font-semibold tracking-[-0.02em] text-primary">
              Serve with
            </p>
            <ul className="space-y-1.5">
              {serveWith.map((item) => (
                <li key={item} className="text-sm leading-relaxed text-secondary">
                  {item}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </NabuSurface>
  );
}

function isLinkableUrl(url: string | undefined): url is string {
  return !!url && /^https?:\/\//i.test(url.trim());
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
// Story card — reading for while things simmer, subordinate to the recipe.
// The heading renders only when the story has its own title, so the main
// dish title never appears twice on the page.
// ---------------------------------------------------------------------------

function StoryCard({ story }: { story: CookingSession["story"] }) {
  if (!story?.text) return null;

  return (
    <NabuSurface tone="accent" className="p-5">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-50/80 text-lg dark:bg-amber-900/20">
          📜
        </div>
        <div className="min-w-0">
          <NabuKicker>Story of the dish</NabuKicker>
          {story.title?.trim() && (
            <h3 className="mt-1 text-lg font-semibold tracking-tight text-primary">
              {story.title}
            </h3>
          )}
          <p className="mt-2.5 whitespace-pre-wrap text-sm leading-7 text-tertiary">
            {story.text}
          </p>
        </div>
      </div>
    </NabuSurface>
  );
}

// ---------------------------------------------------------------------------
// Supporting cook recipe — complete and always expanded. Source links are
// useful provenance, never a substitute for the method on this page.
// ---------------------------------------------------------------------------

function CookRecipeBlock({
  roleLabel,
  title,
  sourceLine,
  sourceUrl,
  image,
  servings,
  timeLabel,
  method,
}: {
  roleLabel: string;
  title: string;
  sourceLine?: string;
  sourceUrl?: string;
  image?: string | null;
  servings?: string | number;
  timeLabel?: string | null;
  method: string[];
}) {
  const servingLabel = servings
    ? formatServings(firstServingsClause(String(servings)))
    : "";

  return (
    <div data-cook-dish={title}>
    <NabuSurface className="overflow-hidden p-0">
      {image && (
        <div className="border-b border-primary bg-secondary">
          <HeroImage src={image} alt={title} />
        </div>
      )}
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <NabuKicker>{roleLabel}</NabuKicker>
            <h3 className="mt-0.5 text-base font-semibold tracking-[-0.02em] text-primary">
              {title}
            </h3>
            {sourceLine && (
              <p className="mt-0.5 text-xs text-tertiary">
                {isLinkableUrl(sourceUrl) ? (
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-secondary underline-offset-2 hover:text-secondary"
                  >
                    {sourceLine}
                  </a>
                ) : sourceLine}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            {servingLabel && <NabuBadge>{servingLabel}</NabuBadge>}
            {timeLabel && <NabuBadge tone="blue">{timeLabel}</NabuBadge>}
          </div>
        </div>

        {method.length > 0 && (
          <div className="mt-5 border-t border-secondary pt-4">
            <h4 className="mb-3 text-xs uppercase tracking-widest text-quaternary">
              Method
            </h4>
            <MethodSteps steps={method} />
          </div>
        )}
      </div>
    </NabuSurface>
    </div>
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

function IngredientList({ ingredients }: { ingredients: WorkingIngredient[] }) {
  const hasGroups = ingredients.some((i) => i.group);
  const groups = new Map<string, WorkingIngredient[]>();
  for (const ing of ingredients) {
    const g = hasGroups ? (ing.group || "Other") : "";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(ing);
  }

  return (
    <div className="space-y-4">
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

function IngredientRow({ ing }: { ing: WorkingIngredient }) {
  return (
    <li className="flex justify-between gap-4 text-sm text-secondary">
      <span>
        {ing.item}
        {ing.replacedItem && (
          <span className="text-xs text-quaternary">
            {" "}
            — instead of {replacedItemLabel(ing.replacedItem)}
          </span>
        )}
      </span>
      <span className="shrink-0 text-right tabular-nums text-quaternary">
        {formatIngredientAmount(ing)}
      </span>
    </li>
  );
}

/** "cherry tomatoes, halved" → "cherry tomatoes": the hint names the
 * ingredient that was swapped out, not its prep instructions. */
function replacedItemLabel(item: string): string {
  return item.split(",")[0].trim() || item.trim();
}

function MethodSteps({ steps }: { steps: (WorkingStep | string)[] }) {
  return (
    <ol className="space-y-4">
      {steps.map((step, i) => (
        <li key={i} className="flex gap-3 text-sm text-secondary">
          <span className="shrink-0 pt-0.5 font-serif text-lg leading-none text-quaternary">
            {i + 1}
          </span>
          <span className="leading-relaxed">
            {typeof step === "string" ? step : step.text}
          </span>
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
