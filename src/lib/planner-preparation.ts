/**
 * Weekly preparation, the Friday watchdog, and week rollover (Kitchen
 * DESIGN.md §4.3, "Weekly preparation and combined-set selection").
 *
 *   Thursday 05:30 Europe/Zurich  → prepare next week's shelf
 *   Friday   06:00 Europe/Zurich  → watchdog. A healthy saved set is left
 *                                   untouched; a failed, short, stale or
 *                                   invalid one is repaired
 *   rollover                      → promote kept/assigned web ideas, expire
 *                                   unkept staging, and write exposure memory
 *                                   for catalog ideas that were shown and
 *                                   quietly not chosen
 *
 * Every data dependency is injected. The defaults resolve lazily through
 * dynamic imports so `node --test` can drive the whole orchestration without
 * loading the recipe bundle or opening a database.
 */

import {
  assembleWeeklyShelf,
  assessShelfQuality,
  deriveShelfSeasonality,
  deriveShelfTraits,
  measureCoverage,
  coverageGaps,
  notThisWeekIds,
  SHELF_POLICY_VERSION,
  type PlanContext,
  type ShelfCandidate,
  type ShelfItem,
  type ShelfTraits,
  type WeeklyShelf,
} from "./planner-shelf.ts";
import { monthForWeek, seasonCalendarVersion, type RecipeSeasonality } from "./planner-seasonality.ts";
import {
  combineEligibility,
  isCurrentReviewSummary,
  minimizeRecipeForReview,
  reviewMatches,
  type CandidateReviewRecord,
  type CandidateReviewSummary,
  type ReviewAvailability,
} from "./planner-review.ts";
import { MIN_PLAUSIBLE_TOTAL_MINUTES, MAX_PLAUSIBLE_TOTAL_MINUTES, qaRecipeForShelf, type RecipeQaDiagnostic } from "./recipe-render-qa.ts";
import { SHELF_TARGET } from "./planner-sources.ts";
import { classifyPlannerRole } from "./planner-roles.ts";
import { candidateDisplay, deriveShelfDisplay, type ShelfDisplay } from "./planner-display.ts";
import { diffShelfExposure, type ExposureRecord } from "./planner-exposure.ts";
import {
  planRollover,
  STAGING_RETENTION_MS,
  STAGING_RETENTION_WEEKS,
  type StagedWebRecipe,
} from "./planner-staging.ts";
import {
  classifyPlannerBucket,
  normalizePlannerCuisine,
  normalizePlannerTitle,
  currentIsoWeekId,
  parseWeekId,
  offsetWeek,
  formatWeekId,
  getWeekDates,
} from "./meals-core.ts";
import type { MealPlan } from "./meals";
import type { Recipe } from "./recipes";

// ---------------------------------------------------------------------------
// Candidate conversion
// ---------------------------------------------------------------------------

export type CandidateOrigin = {
  origin: "web" | "catalog";
  discovery: "editorial" | "search" | "catalog";
  sourceName?: string | null;
  rank?: number;
  /** The planned week; seasonality is bound to its month. Defaults to the month of `now`. */
  week?: string;
  /** The planned month, when the caller already resolved it (1–12). Wins over `week`. */
  month?: number;
};

function normalizeTime(time: Recipe["time"]): { prep: number; cook: number; total: number } | null {
  if (!time) return null;
  const prep = typeof time.prep === "number" ? time.prep : 0;
  const cook = typeof time.cook === "number" ? time.cook : 0;
  let total = typeof time.total === "number" ? time.total : 0;
  if (total <= 0 && prep + cook > 0) total = prep + cook;
  if (total <= 0) return null;
  // An implausible total is a parser defect; a card must not render it.
  if (total < MIN_PLAUSIBLE_TOTAL_MINUTES || total > MAX_PLAUSIBLE_TOTAL_MINUTES) return null;
  return { prep, cook, total };
}

/**
 * Turn a resolved recipe into a shelf candidate: role first, then bucket,
 * cuisine, the coverage traits the shelf reasons about, the month-bound
 * seasonality verdict, and the content hash a review is bound to. The review
 * state itself is attached later by `attachReviews`, from persisted records.
 */
export function toShelfCandidate(recipe: Recipe, origin: CandidateOrigin, now: Date): ShelfCandidate {
  const role = classifyPlannerRole(recipe);
  const month = origin.month ?? (origin.week ? monthForWeek(origin.week, now) : now.getUTCMonth() + 1);
  const traits = deriveShelfTraits(recipe, now, { month });
  const seasonality = deriveShelfSeasonality(recipe, now, { month });
  const time = normalizeTime(recipe.time);
  const minimized = minimizeRecipeForReview(recipe);
  return {
    recipeId: recipe.id,
    recipeName: normalizePlannerTitle(recipe.name) || recipe.name,
    origin: origin.origin,
    discovery: origin.discovery,
    sourceName: origin.sourceName ?? recipe.source?.publication ?? recipe.source?.cookbook ?? null,
    role: role.role,
    bucket: classifyPlannerBucket(recipe),
    cuisine: normalizePlannerCuisine(recipe),
    image: recipe.image ?? null,
    dietary: recipe.dietary ?? recipe.tags?.dietary ?? [],
    time,
    category: recipe.category?.dish_type?.[0] ?? "main",
    courseTags: recipe.category?.dish_type ?? [],
    traits,
    seasonality,
    ...(minimized.ok
      ? { contentSha256: minimized.contentSha256 }
      : { review: { state: "excluded-private" as const, reason: minimized.reasons.join("; ") } }),
    ...(role.completion ? { completion: role.completion } : {}),
    display: deriveShelfDisplay({ role: role.role, traits, time, completion: role.completion, seasonality }),
    ...(origin.rank !== undefined ? { rank: origin.rank } : {}),
  };
}

/**
 * Attach persisted content reviews to candidates and decide eligibility.
 *
 * `reviews` is keyed by `${recipeId}:${contentSha256}`, so a record for other
 * content can never match. The combination rule lives in `planner-review.ts`:
 * deterministic gates decide, a review can only hold. `providerStatus`
 * labels the no-review case honestly — an outage is not the same as "never
 * reviewed", and neither is a pass.
 */
export function attachReviews(
  candidates: readonly ShelfCandidate[],
  reviews: ReadonlyMap<string, CandidateReviewRecord>,
  providerStatus: { kind: "ok" } | { kind: "provider-unavailable"; reason: string } = { kind: "ok" },
): { candidates: ShelfCandidate[]; held: { recipeId: string; reason: string }[] } {
  const held: { recipeId: string; reason: string }[] = [];
  const out: ShelfCandidate[] = [];
  for (const candidate of candidates) {
    let availability: ReviewAvailability;
    if (candidate.review?.state === "excluded-private") {
      availability = { kind: "excluded", reason: candidate.review.reason };
    } else if (candidate.contentSha256) {
      const record = reviews.get(`${candidate.recipeId}:${candidate.contentSha256}`);
      if (record && reviewMatches(record, { recipeId: candidate.recipeId, contentSha256: candidate.contentSha256 })) {
        availability = { kind: "record", record };
      } else if (candidate.review?.state === "checked-hold" && candidate.review.contentSha256 === candidate.contentSha256) {
        // A negative decision already carried by the candidate for this exact
        // content (a re-validated prior item) is kept when the record cannot
        // be read again. Only the hold is carried — the conservative
        // direction; a positive summary never survives a missing record.
        availability = { kind: "held-summary", summary: candidate.review };
      } else if (providerStatus.kind === "provider-unavailable") {
        availability = { kind: "provider-unavailable", reason: providerStatus.reason };
      } else {
        availability = { kind: "none" };
      }
    } else {
      availability = { kind: "none" };
    }
    const decision = combineEligibility({
      deterministicMainEligible: candidate.role === "main" || candidate.role === "light-meal",
      availability,
    });
    const review: CandidateReviewSummary = decision.review;
    out.push({ ...candidate, review });
    if (!decision.eligible && review.state === "checked-hold") held.push({ recipeId: candidate.recipeId, reason: review.reason });
  }
  return { candidates: out, held };
}

/** The bindings a candidate set needs reviews for. */
export function reviewBindingsFor(candidates: readonly ShelfCandidate[]): { recipeId: string; contentSha256: string }[] {
  return candidates
    .filter((candidate): candidate is ShelfCandidate & { contentSha256: string } => typeof candidate.contentSha256 === "string")
    .map((candidate) => ({ recipeId: candidate.recipeId, contentSha256: candidate.contentSha256 }));
}

/**
 * The ids catalog gap-fill must not offer for a week.
 *
 * Four layers, and one of them is easy to get wrong:
 *   - recently cooked / recently planned / active negative feedback
 *   - offered by an *older-policy* shelf inside the recent-week window
 *   - exposure memory (12-week cooldown, second-strike suppression)
 *   - staging that is still staging
 *
 * That last one is the subtlety. A `web_recipe_inspirations` row outlives the
 * staging it describes: promotion sets `promoted_at` and turns the recipe into
 * a normal, browsable My Recipe, but the provenance row stays so the source is
 * still known. Excluding every row would therefore make each web idea David
 * kept permanently ineligible for gap-fill — the catalog would quietly shrink
 * by exactly the recipes he liked most. Only *unpromoted* rows are staging, and
 * only those are excluded; the web half of the shelf owns them.
 *
 * Pure so the rule is testable without a database.
 */
export function catalogExclusionIds(input: {
  recentlyCooked: Iterable<string>;
  recentlyPlanned: Iterable<string>;
  negativeFeedback: Iterable<string>;
  legacyOffered: Iterable<string>;
  exposureExcluded: Iterable<string>;
  staged: readonly StagedWebRecipe[];
}): Set<string> {
  return new Set<string>([
    ...input.recentlyCooked,
    ...input.recentlyPlanned,
    ...input.negativeFeedback,
    ...input.legacyOffered,
    ...input.exposureExcluded,
    ...input.staged.filter((record) => !record.promotedAt).map((record) => record.recipeId),
  ]);
}

/** Persisted candidate-set item shape for a shelf entry. */
export function toCandidateItem(item: ShelfItem) {
  return {
    recipeId: item.recipeId,
    recipeName: item.recipeName,
    source: item.sourceName ? { cookbook: item.sourceName, author: item.sourceName } : null,
    image: item.image ?? null,
    dietary: item.dietary ?? [],
    cuisine: item.cuisine,
    time: item.time ?? null,
    category: item.category ?? "main",
    courseTags: item.courseTags ?? [],
    bucket: item.bucket,
    origin: item.origin,
    discovery: item.discovery,
    role: item.role,
    // Internal diagnostic. Persisted for tests and planner diagnostics; the
    // card renders `display` instead.
    reason: item.reason,
    traits: item.traits,
    ...(item.seasonality ? { seasonality: item.seasonality } : {}),
    ...(item.contentSha256 ? { contentSha256: item.contentSha256 } : {}),
    ...(item.review ? { review: item.review } : {}),
    ...(item.completion ? { completion: item.completion } : {}),
    display: item.display ?? candidateDisplay(item),
  };
}

/**
 * Rebuild live shelf items from a persisted candidate set.
 *
 * Every item is re-resolved and passed through the same QA gate as a newly
 * prepared shelf. Persisted metadata is never trusted as proof that the source
 * recipe is still display-safe. Missing or failing recipes are omitted from
 * the visible shelf; assigned day data itself remains untouched.
 */
export async function hydrateShelfItems(
  items: readonly {
    recipeId: string;
    recipeName?: string;
    origin?: string;
    discovery?: string;
    role?: string;
    reason?: string;
    traits?: ShelfTraits;
    bucket?: string;
    cuisine?: string;
    image?: string | null;
    source?: { cookbook?: string } | null;
    time?: { prep: number; cook: number; total: number } | null;
    completion?: string | null;
    display?: ShelfDisplay | null;
    seasonality?: RecipeSeasonality | null;
    contentSha256?: string | null;
    review?: CandidateReviewSummary | null;
  }[],
  assignedRecipeIds: ReadonlySet<string>,
  resolveRecipe: (id: string) => Promise<Recipe | undefined | null>,
  now: Date,
  options: HydrateOptions = {},
): Promise<ShelfItem[]> {
  const hydrated: ShelfItem[] = [];
  const candidates: { item: (typeof items)[number]; candidate: ShelfCandidate; assigned: boolean }[] = [];
  for (const item of items) {
    if (!item?.recipeId) continue;
    const assigned = assignedRecipeIds.has(item.recipeId);

    const recipe = await resolveRecipe(item.recipeId).catch(() => null);
    if (!recipe) continue;
    const role = classifyPlannerRole(recipe);
    if (role.role === "reject" || role.role === "pairing") continue;
    const checked = qaRecipeForShelf(recipe, { role: role.role });
    if (!checked.ok) continue;
    const origin = item.origin === "web" ? "web" : "catalog";
    // The planned month: the caller's week wins; otherwise the month the
    // item was prepared for, which is what a save-boundary re-hydration
    // without a week must keep — never the month of the clock.
    const month = options.week ? monthForWeek(options.week, now) : item.seasonality?.month;
    const candidate = toShelfCandidate(
      checked.recipe,
      {
        origin,
        discovery: origin === "web"
          ? (item.discovery === "editorial" ? "editorial" : "search")
          : "catalog",
        sourceName: item.source?.cookbook ?? null,
        ...(month ? { month } : {}),
      },
      now,
    );
    candidates.push({ item, candidate, assigned });
  }

  // Review binding on read. When persisted records are available they are the
  // authority (a hold written since the shelf was saved applies now; a pass
  // written under another rubric or model is gone). Without them, a stored
  // summary survives only while it is bound to the same content, rubric,
  // model and interpretation. Reads never trigger inference.
  let resolved: Map<string, CandidateReviewRecord> | null = null;
  if (options.resolveReviews) {
    const bindings = reviewBindingsFor(candidates.map((c) => c.candidate));
    resolved = await options.resolveReviews(bindings).catch(() => null);
  } else if (options.reviews) {
    resolved = new Map(options.reviews);
  }
  const attached = resolved
    ? attachReviews(candidates.map((c) => c.candidate), resolved, options.providerStatus ?? { kind: "ok" }).candidates
    : null;

  candidates.forEach(({ item, candidate, assigned }, index) => {
    let review: CandidateReviewSummary;
    if (attached) {
      review = attached[index].review ?? { state: "unreviewed", reason: "no bound review for this content" };
    } else if (candidate.review?.state === "excluded-private") {
      review = candidate.review;
    } else if (isCurrentReviewSummary(item.review, candidate.contentSha256)) {
      review = item.review as CandidateReviewSummary;
    } else {
      review = { state: "unreviewed", reason: item.review ? "stored review is not bound to the current content, rubric, model and interpretation" : "no bound review for this content" };
    }
    hydrated.push({ ...candidate, review, reason: item.reason ?? "Saved earlier this week", assigned });
  });
  return hydrated;
}

export type HydrateOptions = {
  /** The planned week; its month binds the seasonality verdict. */
  week?: string;
  /** Persisted reviews keyed by `${recipeId}:${contentSha256}`; the read authority when given. */
  reviews?: ReadonlyMap<string, CandidateReviewRecord>;
  /** Loads persisted reviews for the hydrated bindings (runtime wiring). */
  resolveReviews?: (bindings: readonly { recipeId: string; contentSha256: string }[]) => Promise<Map<string, CandidateReviewRecord>>;
  providerStatus?: { kind: "ok" } | { kind: "provider-unavailable"; reason: string };
};

/**
 * Attach the shelf presentation contract to persisted candidate items on read.
 *
 * This is what lets an already-prepared week — 2026-W33 in particular — render
 * the three groups, the editorial notes and the light-meal labels without
 * regenerating its shelf or moving a single day assignment. Nothing is written;
 * the items come back with `display` filled in.
 *
 * Role is re-derived from the recipe rather than trusted from disk, for the
 * same reason the bucket label already is: a set saved under an earlier
 * classifier carries labels that are now wrong. A recipe that no longer
 * classifies as main-eligible keeps its stored role — the shelf admitted it,
 * and quietly re-labelling a card as a side is not this function's decision to
 * make.
 */
export async function withShelfDisplay<
  T extends {
    recipeId: string;
    role?: string;
    traits?: ShelfTraits;
    time?: { prep: number; cook: number; total: number } | null;
    completion?: string | null;
    display?: ShelfDisplay | null;
  },
>(
  items: readonly T[],
  resolveRecipe: (id: string) => Promise<Recipe | undefined | null>,
  now: Date,
): Promise<T[]> {
  const out: T[] = [];
  for (const item of items) {
    if (!item?.recipeId) continue;

    let recipe: Recipe | undefined | null = null;
    try {
      recipe = await resolveRecipe(item.recipeId);
    } catch {
      recipe = null;
    }

    if (!recipe) {
      out.push({ ...item, display: candidateDisplay(item) });
      continue;
    }

    const classification = classifyPlannerRole(recipe);
    const role =
      classification.role === "main" || classification.role === "light-meal"
        ? classification.role
        : item.role;
    const traits = item.traits ?? deriveShelfTraits(recipe, now);
    const time = item.time ?? normalizeTime(recipe.time);
    const completion = classification.completion ?? item.completion ?? null;
    const seasonality = (item as { seasonality?: RecipeSeasonality | null }).seasonality ?? null;

    out.push({
      ...item,
      role,
      traits,
      ...(completion ? { completion } : {}),
      display: deriveShelfDisplay({ role, traits, time, completion, seasonality }),
    });
  }
  return out;
}

/** The recipe ids a plan has assigned to a day. Exported for route wiring. */
export function assignedRecipeIdsForPlan(plan: MealPlan | null): Set<string> {
  return assignedRecipeIdsOf(plan);
}

// ---------------------------------------------------------------------------
// Shelf health
// ---------------------------------------------------------------------------

/** A prepared shelf older than this is treated as stale and re-prepared. */
export const SHELF_STALE_DAYS = 10;

export type ShelfHealth = {
  healthy: boolean;
  problems: string[];
};

/**
 * Is the saved shelf good enough to leave alone?
 *
 * The watchdog exists to repair a *bad* set, not to churn a good one — so this
 * is the single place that answers "leave it alone".
 */
export function assessShelfHealth(
  plan: MealPlan | null,
  now: Date,
  options: { minItems?: number; staleDays?: number } = {},
): ShelfHealth {
  const minItems = options.minItems ?? SHELF_TARGET.min;
  const staleDays = options.staleDays ?? SHELF_STALE_DAYS;
  const problems: string[] = [];

  if (!plan) return { healthy: false, problems: ["no saved plan for the week"] };
  const set = plan.candidateSet;
  if (!set) return { healthy: false, problems: ["no saved candidate set"] };
  if (!Array.isArray(set.items) || set.items.length === 0) {
    return { healthy: false, problems: ["candidate set is empty"] };
  }
  if (set.items.length < minItems) {
    problems.push(`only ${set.items.length} ideas saved (target ${minItems})`);
  }
  if (set.policyVersion !== SHELF_POLICY_VERSION) {
    problems.push(`saved under ${set.policyVersion ?? "an unknown policy"}, current is ${SHELF_POLICY_VERSION}`);
  }
  const generatedAt = Date.parse(set.generatedAt ?? "");
  if (!Number.isFinite(generatedAt)) {
    problems.push("candidate set has no usable generatedAt");
  } else if (now.getTime() - generatedAt > staleDays * 86_400_000) {
    problems.push(`candidate set is older than ${staleDays} days`);
  }
  if (set.items.some((item) => !item || typeof item.recipeId !== "string" || !item.recipeId)) {
    problems.push("candidate set contains an item without a recipe id");
  }

  // Quality, not just structure: source yield, cookbook and hero
  // concentration, corrupted traits, implausible timing, effort balance.
  const visible = set.items.filter((item) => item?.recipeId);
  problems.push(
    ...assessShelfQuality(visible, {
      webConsidered: set.shelfDiagnostics?.webConsidered,
      cookbookCapRelaxed: set.shelfDiagnostics?.cookbookCapRelaxed,
    }),
  );

  return { healthy: problems.length === 0, problems };
}

/**
 * What the week already holds, for context-aware completion. Assigned
 * recipes that are not on the shelf (a cooked-by-hand Monday) still count:
 * their traits are derived from the recipe itself.
 */
export async function planContextFor(
  plan: MealPlan | null,
  shelf: readonly ShelfItem[],
  resolveRecipe: (id: string) => Promise<Recipe | undefined | null>,
  now: Date,
): Promise<PlanContext> {
  const assignedIds = assignedRecipeIdsOf(plan);
  const assignedTraits: ShelfTraits[] = [];
  const assignedCuisines: string[] = [];
  for (const id of assignedIds) {
    const onShelf = shelf.find((item) => item.recipeId === id);
    if (onShelf) {
      assignedTraits.push(onShelf.traits);
      assignedCuisines.push(onShelf.cuisine);
      continue;
    }
    const recipe = await resolveRecipe(id).catch(() => null);
    if (!recipe) continue;
    assignedTraits.push(deriveShelfTraits(recipe, now));
    assignedCuisines.push(normalizePlannerCuisine(recipe));
  }
  let openWeekdays = 0;
  let openWeekendDays = 0;
  for (const day of plan?.days ?? []) {
    const state = day.planningState ?? (day.recipeId || day.meal?.main?.id ? "assigned" : "open");
    if (state !== "open") continue;
    if (day.type === "weekend") openWeekendDays += 1;
    else openWeekdays += 1;
  }
  return { assignedTraits, assignedCuisines, openWeekdays, openWeekendDays };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export type PreparationKind = "prepare" | "watchdog" | "rollover";

/**
 * What a save boundary answers with.
 *
 * Preparation must not assume its write landed. The save boundary can refuse
 * the write outright (a locked week), and even on success it can store
 * something other than what was handed to it — sanitation drops candidates,
 * planning states are normalized. `plan` is therefore what is *stored*, and it
 * is what the outcome's shelf size and health are measured from.
 */
export type PlanSaveOutcome =
  | { ok: true; plan: MealPlan }
  | { ok: false; reason: string };

export type PreparationDeps = {
  now?: Date;
  loadPlan: (week: string) => Promise<MealPlan | null>;
  savePlan: (plan: MealPlan) => Promise<PlanSaveOutcome>;
  /**
   * Resolves the week's web ideas. Idempotent on the caller's side.
   *
   * It may only *find* them: on Vercel there is no importer to run, so this
   * reports `web-not-staged` and preparation carries on with the catalog while
   * saying so. See `resolveWebInspirations`.
   */
  ensureWebInspirations: (week: string) => Promise<{
    status: string;
    accepted?: number;
    staged?: number;
    error?: string;
    reason?: string;
  }>;
  /** Staged web ideas for the week, already resolved to shelf candidates. */
  loadWebCandidates: (week: string) => Promise<ShelfCandidate[]>;
  /** Catalog ideas eligible for gap-fill (recency + exposure already applied). */
  loadCatalogCandidates: (week: string) => Promise<ShelfCandidate[]>;
  /** Rejected records and safe auto-fixes observed while the loaders ran. */
  qaDiagnostics?: () => RecipeQaDiagnostic[];
  /**
   * Persisted content reviews for the given bindings, keyed by
   * `${recipeId}:${contentSha256}`. Reads only; preparation never calls a
   * provider. Absent means every candidate is "unreviewed".
   */
  loadReviews?: (bindings: readonly { recipeId: string; contentSha256: string }[]) => Promise<Map<string, CandidateReviewRecord>>;
  /** What the last review run reported, so an outage is labelled as one. */
  reviewProviderStatus?: (week?: string) => Promise<{ kind: "ok" } | { kind: "provider-unavailable"; reason: string }>;
  /**
   * Re-resolve the previously saved shelf items against the live corpus and
   * gates (runtime: `hydrateShelfItems` with the recipe resolver). Used only
   * when a source, loader or provider failure means the fresh pools cannot
   * be trusted to replace a valid shelf. Without it, prior items are checked
   * structurally (role, traits, image) and carried with their saved data.
   */
  revalidatePrior?: (items: NonNullable<MealPlan["candidateSet"]>["items"], assigned: ReadonlySet<string>, week?: string) => Promise<ShelfCandidate[]>;
  claim?: (week: string, kind: PreparationKind) => Promise<boolean>;
  complete?: (week: string, kind: PreparationKind, status: "succeeded" | "failed", summary?: unknown) => Promise<void>;
};

export type PreparationOutcome = {
  week: string;
  kind: PreparationKind;
  status: "prepared" | "already-healthy" | "repaired" | "claim-not-acquired" | "failed";
  /** Size of the *stored* candidate set, after the save boundary had its say. */
  shelfSize?: number;
  /** Health of the stored set. False means the run wrote a set worth repairing. */
  healthy?: boolean;
  webSelected?: number;
  catalogSelected?: number;
  remainingGaps?: string[];
  warnings?: string[];
  /**
   * What happened to web discovery, verbatim from `ensureWebInspirations`.
   *
   * Reported separately from `warnings` so a caller can branch on it. The value
   * production cares about is `web-not-staged`: the shelf is real, the research
   * behind its web half is not.
   */
  webStatus?: string;
  /** Content-review coverage of the stored shelf (§4.3.1). */
  reviewStates?: Partial<Record<string, number>>;
  /** Candidates the content review held out of the automatic shelf. */
  held?: { recipeId: string; reason: string }[];
  /** Loaders that failed; the run carried on with what it had (§4.3.1 "provider failures preserve the prior valid shelf"). */
  loadFailures?: string[];
  /** Previously saved choices carried over after a failure, and prior choices found invalid. */
  retainedPrior?: number;
  invalidPrior?: { recipeId: string; reason: string }[];
  error?: string;
};

/**
 * Transfer a current content-bound hold from a prior candidate onto its fresh
 * twin (same recipe id, same minimized content hash). The fresh candidate
 * stays the one in play; only the negative decision crosses over, and only
 * when the content is identical — changed content gets no inherited review,
 * and a positive summary is never carried. Pure; exported for tests.
 */
export function carryCurrentHolds(prior: readonly ShelfCandidate[], fresh: readonly ShelfCandidate[]): ShelfCandidate[] {
  const holds = new Map<string, CandidateReviewSummary>();
  for (const candidate of prior) {
    const review = candidate.review;
    if (review?.state !== "checked-hold") continue;
    const contentSha256 = review.contentSha256 ?? candidate.contentSha256;
    if (!contentSha256) continue;
    holds.set(`${candidate.recipeId}:${contentSha256}`, { ...review, contentSha256 });
  }
  if (holds.size === 0) return [...fresh];
  return fresh.map((candidate) => {
    if (!candidate.contentSha256) return candidate;
    const hold = holds.get(`${candidate.recipeId}:${candidate.contentSha256}`);
    return hold ? { ...candidate, review: hold } : candidate;
  });
}

/**
 * Structural re-validation of previously saved shelf items, for a run that
 * cannot resolve recipes. A prior item is carried only when it still looks
 * like a dinner-eligible candidate (main/light-meal role, traits, an image,
 * no hold); anything else is reported as invalid rather than kept quietly.
 */
export function priorShelfCandidates(
  items: ReadonlyArray<NonNullable<MealPlan["candidateSet"]>["items"][number]>,
  invalid: { recipeId: string; reason: string }[] = [],
): ShelfCandidate[] {
  const out: ShelfCandidate[] = [];
  for (const item of items) {
    if (!item || typeof item.recipeId !== "string" || !item.recipeId) continue;
    const reasons: string[] = [];
    if (item.role !== "main" && item.role !== "light-meal") reasons.push(`role ${item.role ?? "unknown"} is not dinner-eligible`);
    if (!item.traits) reasons.push("no saved traits");
    if (!item.image) reasons.push("no image");
    if (item.review?.state === "checked-hold") reasons.push("held by the content review");
    if (reasons.length) {
      invalid.push({ recipeId: item.recipeId, reason: reasons.join("; ") });
      continue;
    }
    out.push({
      recipeId: item.recipeId,
      recipeName: item.recipeName,
      origin: item.origin === "web" ? "web" : "catalog",
      discovery: item.origin === "web" ? (item.discovery === "editorial" ? "editorial" : "search") : "catalog",
      sourceName: item.source?.cookbook ?? null,
      role: item.role as ShelfCandidate["role"],
      bucket: item.bucket,
      cuisine: item.cuisine ?? "Other",
      image: item.image ?? null,
      dietary: item.dietary ?? [],
      time: item.time ?? null,
      category: item.category,
      courseTags: item.courseTags ?? [],
      traits: item.traits as ShelfTraits,
      ...(item.completion ? { completion: item.completion } : {}),
      ...(item.display ? { display: item.display } : {}),
      ...(item.seasonality ? { seasonality: item.seasonality } : {}),
      ...(item.contentSha256 ? { contentSha256: item.contentSha256 } : {}),
    });
  }
  return out;
}

function weekDaysFor(week: string): MealPlan["days"] {
  const parsed = parseWeekId(week);
  const dates = parsed ? getWeekDates(parsed.year, parsed.week) : [];
  const WEEKEND = new Set(["Friday", "Saturday", "Sunday"]);
  return dates.map((d) => ({
    date: d.date,
    dayOfWeek: d.dayOfWeek,
    type: (WEEKEND.has(d.dayOfWeek) ? "weekend" : "weekday") as "weekday" | "weekend",
    planningState: "open" as const,
    recipeId: null,
    recipeName: null,
    meal: null,
    brunch: null,
  }));
}

function assignedRecipeIdsOf(plan: MealPlan | null): Set<string> {
  const ids = new Set<string>();
  for (const day of plan?.days ?? []) {
    if (day.planningState === "open" || day.planningState === "skipped") continue;
    if (day.recipeId) ids.add(day.recipeId);
    if (day.meal?.main?.id) ids.add(day.meal.main.id);
    for (const side of day.meal?.sides ?? []) if (side?.id) ids.add(side.id);
    if (day.brunch?.main?.id) ids.add(day.brunch.main.id);
    for (const side of day.brunch?.sides ?? []) if (side?.id) ids.add(side.id);
  }
  return ids;
}

/**
 * Build and persist the combined shelf for a week.
 *
 * Assigned days are never touched: their recipes are pinned into the shelf as
 * visible-but-disabled cards, and the rest of the set is built around them.
 */
export async function prepareWeek(
  week: string,
  deps: PreparationDeps,
  kind: PreparationKind = "prepare",
): Promise<PreparationOutcome> {
  const now = deps.now ?? new Date();
  const claim = deps.claim;
  if (claim && !(await claim(week, kind))) {
    return { week, kind, status: "claim-not-acquired" };
  }

  try {
    const ensured = await deps.ensureWebInspirations(week);
    // Neither of these stops preparation — a catalog-only shelf beats no shelf
    // — but both have to reach the outcome. A run that quietly reports twelve
    // healthy ideas after discovery never happened is how `webSelected: 0`
    // survived a production smoke test.
    const webWarnings: string[] = [];
    if (ensured.status === "failed") {
      console.warn(`Weekly web discovery failed for ${week}: ${ensured.error ?? "unknown error"}`);
      webWarnings.push(`web discovery failed: ${ensured.error ?? "unknown error"}`);
    }
    if (ensured.status === "web-not-staged") {
      console.warn(`No web inspirations staged for ${week}: ${ensured.reason ?? ""}`);
      webWarnings.push(
        `web-not-staged: ${ensured.reason ?? `no web inspirations are staged for ${week}`}`,
      );
    }

    // The saved plan is read first: it is what a failure must preserve. A
    // loader that throws is a failure like a failed discovery, not a reason
    // to replace a valid shelf with nothing.
    const existing = await deps.loadPlan(week);
    const loadFailures: string[] = [];
    const loadSafely = async (label: string, load: () => Promise<ShelfCandidate[]>): Promise<ShelfCandidate[]> => {
      try {
        return await load();
      } catch (error) {
        loadFailures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      }
    };
    const [freshWeb, freshCatalog] = await Promise.all([
      loadSafely("web candidates", () => deps.loadWebCandidates(week)),
      loadSafely("catalog candidates", () => deps.loadCatalogCandidates(week)),
    ]);
    // The failure decision covers the complete review-loading boundary:
    // discovery, both loaders, the provider status and the review-store read
    // for the fresh candidates. Only then is retention decided, so a
    // review store that fails late cannot empty a valid shelf.
    let providerStatus: { kind: "ok" } | { kind: "provider-unavailable"; reason: string } = deps.reviewProviderStatus
      ? await deps.reviewProviderStatus(week).catch((error) => ({ kind: "provider-unavailable" as const, reason: `review status unavailable: ${error instanceof Error ? error.message : String(error)}` }))
      : { kind: "ok" as const };
    const reviews = new Map<string, CandidateReviewRecord>();
    const loadReviewsSafely = async (candidates: readonly ShelfCandidate[]): Promise<void> => {
      if (!deps.loadReviews) return;
      try {
        for (const [key, record] of await deps.loadReviews(reviewBindingsFor(candidates))) reviews.set(key, record);
      } catch (error) {
        // A review store that cannot be read is an outage for this run:
        // nothing is held or passed on its account, everything is labelled.
        providerStatus = { kind: "provider-unavailable", reason: `reviews unavailable: ${error instanceof Error ? error.message : String(error)}` };
      }
    };
    await loadReviewsSafely([...freshWeb, ...freshCatalog]);
    const sourceFailure = ensured.status === "failed" || loadFailures.length > 0 || providerStatus.kind === "provider-unavailable";

    const assigned = assignedRecipeIdsOf(existing);
    // "Not this week" is exposure state for the week and survives a repair:
    // a dismissed idea must not come back because the watchdog rebuilt the set.
    const dismissed = notThisWeekIds(existing?.candidateSet);

    // On any failure above, the previously saved choices stay in the running:
    // re-validated (structurally here, against the corpus and persisted
    // reviews when the runtime supplies `revalidatePrior`), ranked behind
    // fresh candidates and labelled as retained. Nothing is retained after a
    // clean run — a refresh is a refresh — and nothing invalid is retained
    // after a failure.
    let retained: ShelfCandidate[] = [];
    const invalidPrior: { recipeId: string; reason: string }[] = [];
    let rawWeb: ShelfCandidate[] = freshWeb;
    let rawCatalog: ShelfCandidate[] = freshCatalog;
    if (sourceFailure && existing?.candidateSet?.items?.length) {
      const prior = existing.candidateSet.items;
      const revalidated = deps.revalidatePrior
        ? await deps.revalidatePrior(prior, assigned, week).catch((error) => {
            loadFailures.push(`prior revalidation: ${error instanceof Error ? error.message : String(error)}`);
            return null;
          })
        : null;
      const structural = priorShelfCandidates(prior, invalidPrior);
      const pool = revalidated ?? structural;
      if (revalidated) {
        const kept = new Set(revalidated.map((c) => c.recipeId));
        for (const item of prior) if (item?.recipeId && !kept.has(item.recipeId)) invalidPrior.push({ recipeId: item.recipeId, reason: "no longer resolves or passes the gates" });
      }
      // De-duplication keeps the fresh candidate, but a current content-bound
      // hold on its prior twin is the one review state that must survive the
      // swap: it is transferred when id and content are identical, and never
      // onto changed content. Positive states are never carried either way.
      const carried = carryCurrentHolds(pool, [...freshWeb, ...freshCatalog]);
      rawWeb = carried.filter((c) => freshWeb.includes(c) || freshWeb.some((f) => f.recipeId === c.recipeId));
      rawCatalog = carried.filter((c) => !rawWeb.includes(c));
      const freshIds = new Set(carried.map((c) => c.recipeId));
      retained = pool
        .filter((c) => !freshIds.has(c.recipeId))
        .map((c, index) => ({
          ...c,
          rank: 1_000 + index,
          review: c.review?.state === "checked-hold" ? { ...c.review, contentSha256: c.review.contentSha256 ?? c.contentSha256 } : undefined,
          retained: true as const,
        }));
      rawWeb = [...rawWeb, ...retained.filter((c) => c.origin === "web")];
      rawCatalog = [...rawCatalog, ...retained.filter((c) => c.origin === "catalog")];
      // Retained items need their persisted reviews too; a second failure
      // here is the same outage and labels them, it does not reset anything.
      await loadReviewsSafely(retained);
    }

    // Content reviews are read, never requested, here. A candidate whose
    // review holds it is kept out of the automatic shelf; everything else is
    // labelled with its actual state (pass / uncertain / unreviewed /
    // provider-unavailable / excluded) and decided by the deterministic gates.
    const reviewedWeb = attachReviews(rawWeb, reviews, providerStatus);
    const reviewedCatalog = attachReviews(rawCatalog, reviews, providerStatus);
    const web = reviewedWeb.candidates;
    const catalog = reviewedCatalog.candidates;
    const held = [...reviewedWeb.held, ...reviewedCatalog.held];
    const eligible = (c: ShelfCandidate) =>
      (c.role === "main" || c.role === "light-meal") &&
      c.review?.state !== "checked-hold" &&
      (!dismissed.has(c.recipeId) || assigned.has(c.recipeId));
    const shelf = assembleWeeklyShelf({
      web: web.filter(eligible),
      catalog: catalog.filter(eligible),
      pairings: [...web, ...catalog].filter((c) => c.role === "pairing"),
      assignedRecipeIds: assigned,
    });

    // A load failure that leaves nothing to save is a failed preparation, not
    // an empty shelf: the saved plan (if any) stays exactly as it was.
    if (loadFailures.length > 0 && shelf.items.length === 0) {
      const message = `preparation could not load candidates (${loadFailures.join("; ")})`;
      await deps.complete?.(week, kind, "failed", { error: message, loadFailures });
      return { week, kind, status: "failed", error: message, loadFailures, webStatus: ensured.status };
    }

    const base: MealPlan = existing ?? {
      week,
      status: "draft",
      plannerVersion: "vNext-1",
      candidateSet: null,
      days: weekDaysFor(week),
      context: [],
      notes: "",
      locked: false,
      createdAt: now.toISOString(),
    };

    const plan: MealPlan = {
      ...base,
      candidateSet: {
        generatedAt: now.toISOString(),
        policyVersion: SHELF_POLICY_VERSION,
        calendarVersion: seasonCalendarVersion(),
        items: shelf.items.map(toCandidateItem),
        reserves: shelf.reserves.map((reserve) => ({
          recipeId: reserve.recipeId,
          recipeName: reserve.recipeName,
          role: reserve.role,
          sourceName: reserve.sourceName ?? null,
          image: reserve.image ?? null,
        })),
        shelfDiagnostics: { ...shelf.diagnostics, ...(held.length ? { held } : {}) },
        ...(existing?.candidateSet?.notThisWeek?.length ? { notThisWeek: existing.candidateSet.notThisWeek } : {}),
        ...(deps.qaDiagnostics ? { qaDiagnostics: deps.qaDiagnostics() } : {}),
      },
      updatedAt: now.toISOString(),
    };

    // A refused write is a failed preparation, not a quiet success. Reporting
    // "prepared, 13 ideas" for a week whose save was rejected — a locked plan
    // is the standing case — would tell the watchdog and the status endpoint
    // that a shelf exists where none was written.
    const saved = await deps.savePlan(plan);
    if (!saved || !saved.ok) {
      const reason = saved && !saved.ok ? saved.reason : "save returned no result";
      const message = `candidate set was not saved (${reason})`;
      await deps.complete?.(week, kind, "failed", { error: message });
      return { week, kind, status: "failed", error: message };
    }

    // Measure what was stored, not what was sent. The save boundary sanitizes
    // candidates, so the assembled shelf size is an intention and the stored
    // one is the fact — and a set that arrives short or invalid must show up
    // here rather than waiting for the next watchdog run to notice.
    const storedPlan = saved.plan;
    const shelfSize = storedPlan.candidateSet?.items?.length ?? 0;
    const health = assessShelfHealth(storedPlan, now);
    const retainedCount = shelf.items.filter((item) => (item as { retained?: boolean }).retained).length;
    const warnings = [
      ...webWarnings,
      ...loadFailures.map((failure) => `load failed: ${failure}`),
      ...(retainedCount > 0 ? [`retained ${retainedCount} previously saved choice(s) after a failure; ${invalidPrior.length} prior choice(s) no longer valid`] : []),
      ...(shelf.diagnostics.warnings ?? []),
      ...(health.healthy ? [] : health.problems.map((problem) => `saved shelf: ${problem}`)),
    ];

    await deps.complete?.(week, kind, "succeeded", {
      shelfSize,
      webSelected: shelf.diagnostics.webSelected,
      catalogSelected: shelf.diagnostics.catalogSelected,
      webStatus: ensured.status,
      healthy: health.healthy,
      reviewStates: shelf.diagnostics.reviewStates,
      shortfall: shelf.diagnostics.shortfall,
    });

    return {
      week,
      kind,
      status: kind === "watchdog" ? "repaired" : "prepared",
      shelfSize,
      healthy: health.healthy,
      webSelected: shelf.diagnostics.webSelected,
      catalogSelected: shelf.diagnostics.catalogSelected,
      remainingGaps: shelf.diagnostics.remainingGaps,
      warnings,
      webStatus: ensured.status,
      reviewStates: shelf.diagnostics.reviewStates,
      ...(held.length ? { held } : {}),
      ...(loadFailures.length ? { loadFailures } : {}),
      ...(sourceFailure ? { retainedPrior: retainedCount, invalidPrior } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.complete?.(week, kind, "failed", { error: message });
    return { week, kind, status: "failed", error: message };
  }
}

/**
 * Friday repair watchdog. Idempotent by construction: a healthy saved shelf is
 * reported and left exactly as it is, and only an unhealthy one is rebuilt.
 */
export async function runWatchdog(week: string, deps: PreparationDeps): Promise<PreparationOutcome> {
  const now = deps.now ?? new Date();
  const plan = await deps.loadPlan(week);
  const health = assessShelfHealth(plan, now);
  if (health.healthy) {
    await deps.complete?.(week, "watchdog", "succeeded", { action: "left-untouched" });
    return {
      week,
      kind: "watchdog",
      status: "already-healthy",
      shelfSize: plan?.candidateSet?.items?.length ?? 0,
      healthy: true,
    };
  }
  const outcome = await prepareWeek(week, deps, "watchdog");
  return { ...outcome, warnings: [...health.problems, ...(outcome.warnings ?? [])] };
}

// ---------------------------------------------------------------------------
// Rollover
// ---------------------------------------------------------------------------

export type RolloverDeps = {
  now?: Date;
  loadPlan: (week: string) => Promise<MealPlan | null>;
  loadStagedRecipes: (weeks: string[]) => Promise<StagedWebRecipe[]>;
  /**
   * Staged records older than the retention window, whatever week they belong
   * to. The week-window read above can only see a bounded span, so a record
   * whose rollover was missed for longer than that would otherwise never be
   * looked at again. Optional: without it the window read is all there is.
   */
  loadExpirableStagedRecipes?: (before: Date) => Promise<StagedWebRecipe[]>;
  /**
   * Recipe ids assigned across the supplied weeks. Expiry spans the whole
   * retention window, so "assigned" has to as well — otherwise a recipe
   * assigned in an earlier week whose rollover never ran would be deleted as
   * if it had been ignored.
   */
  loadAssignedRecipeIds?: (weeks: string[]) => Promise<Set<string>>;
  /**
   * Recipe ids assigned in `fromWeek` or any later week. Assignment to a
   * *future* week is retention too, and a backwards-only window cannot see it.
   */
  loadAssignedRecipeIdsSince?: (fromWeek: string) => Promise<Set<string>>;
  loadExposureRecords: () => Promise<Map<string, ExposureRecord>>;
  saveExposure: (records: ExposureRecord[]) => Promise<void>;
  /**
   * Write the strikes and their ledger entries in one transaction.
   *
   * Preferred over `saveExposure` + `saveCountedExposureIds`, which can only be
   * issued in sequence and therefore leave a window where a week is half
   * accounted for. Optional so a caller with no transactional store still
   * works; `rolloverWeek` falls back to the two-call path when it is absent.
   */
  saveExposureWithCountedIds?: (
    records: ExposureRecord[],
    week: string,
    recipeIds: string[],
  ) => Promise<void>;
  /**
   * Recipe ids whose exposure has already been counted against `week`, from the
   * durable counted-weeks ledger. This is what makes an *out-of-order* re-run
   * safe: the exposure record's own marker is cleared when a later week's
   * selection clears the strike, and without the ledger a re-run of the older
   * week would then reapply it.
   */
  loadCountedExposureIds: (week: string) => Promise<Set<string>>;
  /** Append (recipe, week) pairs to that ledger. Idempotent per pair. */
  saveCountedExposureIds: (week: string, recipeIds: string[]) => Promise<void>;
  promote: (record: StagedWebRecipe) => Promise<boolean>;
  expire: (record: StagedWebRecipe) => Promise<void>;
  claim?: (week: string, kind: PreparationKind) => Promise<boolean>;
  complete?: (week: string, kind: PreparationKind, status: "succeeded" | "failed", summary?: unknown) => Promise<void>;
};

export type RolloverOutcome = {
  week: string;
  status: "rolled-over" | "claim-not-acquired" | "failed";
  promoted: string[];
  expired: string[];
  retained: number;
  exposuresRecorded: number;
  exposuresCleared: number;
  /** Shelf ideas this week had already been counted against. Re-run evidence. */
  exposuresAlreadyCounted?: number;
  error?: string;
};

/**
 * Roll a finished week over.
 *
 * Two things happen, and both are safe to repeat:
 *   - kept or assigned web ideas are promoted into My Recipes with their real
 *     source; unkept, unassigned staging older than the retention window is
 *     expired down to a duplicate fingerprint
 *   - every catalog idea that was on the shelf and *not* chosen records an
 *     exposure, which is what drives the 12-week cooldown and the second-strike
 *     suppression
 *
 * "Safe to repeat" is a durable property, not a hope pinned on the claim row:
 * promotion skips anything already promoted, and each exposure record stores
 * the week that produced it, so a second rollover of the same week writes
 * nothing new even if the claim state was lost entirely.
 */
export async function rolloverWeek(week: string, deps: RolloverDeps): Promise<RolloverOutcome> {
  const now = deps.now ?? new Date();
  const claim = deps.claim;
  if (claim && !(await claim(week, "rollover"))) {
    return { week, status: "claim-not-acquired", promoted: [], expired: [], retained: 0, exposuresRecorded: 0, exposuresCleared: 0 };
  }

  try {
    const plan = await deps.loadPlan(week);
    const assignedThisWeek = assignedRecipeIdsOf(plan);

    // Staging older than this week is also due for promotion or expiry, so the
    // window this reads has to match the retention window it enforces — plus a
    // direct age query for anything that fell out the back of that window.
    const retentionWeeks = weekSpanEndingAt(week, STAGING_RETENTION_WEEKS + 1);
    const oldestRetainedWeek = retentionWeeks[retentionWeeks.length - 1];
    const [windowStaged, overdueStaged, assignedAcrossWindow, assignedFromWindowOn] = await Promise.all([
      deps.loadStagedRecipes(retentionWeeks),
      deps.loadExpirableStagedRecipes
        ? deps.loadExpirableStagedRecipes(new Date(now.getTime() - STAGING_RETENTION_MS))
        : Promise.resolve<StagedWebRecipe[]>([]),
      deps.loadAssignedRecipeIds
        ? deps.loadAssignedRecipeIds(retentionWeeks)
        : Promise.resolve(new Set<string>()),
      deps.loadAssignedRecipeIdsSince
        ? deps.loadAssignedRecipeIdsSince(oldestRetainedWeek)
        : Promise.resolve(new Set<string>()),
    ]);

    const stagedById = new Map<string, StagedWebRecipe>();
    for (const record of [...windowStaged, ...overdueStaged]) {
      if (record?.recipeId) stagedById.set(record.recipeId, record);
    }
    const staged = [...stagedById.values()];

    // Retention is Keep *or* assignment, and an assignment to a week that has
    // not happened yet counts every bit as much as one in the past.
    const assigned = new Set<string>([
      ...assignedThisWeek,
      ...assignedAcrossWindow,
      ...assignedFromWindowOn,
    ]);

    const rollover = planRollover({ records: staged, assignedRecipeIds: assigned, now });

    const promoted: string[] = [];
    for (const decision of rollover.promote) {
      if (await deps.promote(decision.record)) promoted.push(decision.record.recipeId);
    }
    const expired: string[] = [];
    for (const decision of rollover.expire) {
      await deps.expire(decision.record);
      expired.push(decision.record.recipeId);
    }

    // Exposure applies to catalog ideas only. A web idea that was ignored is
    // handled by staging expiry, not by a 12-week cooldown on a recipe that is
    // about to be deleted.
    //
    // Assigned ids join the diff even when they were never on the shelf: a
    // recipe David searched for and cooked has plainly not been ignored, and
    // this is the path that lifts a suppression he overrode by hand. They can
    // only ever *clear* — `diffShelfExposure` counts nothing that is selected.
    const shown = [
      ...(plan?.candidateSet?.items ?? [])
        .filter((item) => (item as { origin?: string }).origin !== "web")
        .map((item) => item.recipeId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
      // Dismissed with "Not this week": shown and not chosen, exactly one
      // exposure — never a permanent dislike.
      ...(plan?.candidateSet?.notThisWeek ?? [])
        .filter((record) => record?.origin !== "web")
        .map((record) => record.recipeId),
      ...assignedThisWeek,
    ];

    const [existing, countedRecipeIds] = await Promise.all([
      deps.loadExposureRecords(),
      deps.loadCountedExposureIds(week),
    ]);
    // Two guards make a repeated rollover safe. The record's own marker covers
    // the ordinary retry; the counted-weeks ledger covers the re-run that
    // arrives *after* a later week's selection already cleared the strike, when
    // the marker is gone but the week is still finished.
    const diff = diffShelfExposure(shown, assignedThisWeek, existing, now, {
      countedWeek: week,
      countedRecipeIds,
    });
    // Strikes and ledger go down together when the store can do it. Ordering
    // them as two writes was the remaining hole: the marker absorbs an ordinary
    // retry, but a selection in a later week clears that marker, and a re-run
    // arriving after that would reapply a strike the ledger should have
    // retired. One transaction removes the window rather than narrowing it.
    const exposureWrites = [...diff.exposed, ...diff.cleared];
    if (deps.saveExposureWithCountedIds) {
      await deps.saveExposureWithCountedIds(exposureWrites, week, diff.newlyCounted);
    } else {
      await deps.saveExposure(exposureWrites);
      // Fallback ordering: the ledger follows the strikes it describes, so a
      // crash between the two repeats the week once more (which the marker
      // absorbs) instead of losing a strike outright.
      if (diff.newlyCounted.length > 0) {
        await deps.saveCountedExposureIds(week, diff.newlyCounted);
      }
    }

    const summary = {
      promoted: promoted.length,
      expired: expired.length,
      retained: rollover.retain.length,
      exposed: diff.exposed.length,
      cleared: diff.cleared.length,
      alreadyCounted: diff.alreadyCounted.length,
    };
    await deps.complete?.(week, "rollover", "succeeded", summary);

    return {
      week,
      status: "rolled-over",
      promoted,
      expired,
      retained: rollover.retain.length,
      exposuresRecorded: diff.exposed.length,
      exposuresCleared: diff.cleared.length,
      exposuresAlreadyCounted: diff.alreadyCounted.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.complete?.(week, "rollover", "failed", { error: message });
    return { week, status: "failed", promoted: [], expired: [], retained: 0, exposuresRecorded: 0, exposuresCleared: 0, error: message };
  }
}

// ---------------------------------------------------------------------------
// Week helpers
// ---------------------------------------------------------------------------

/** `count` ISO week ids ending at (and including) `week`, newest first. */
export function weekSpanEndingAt(week: string, count: number): string[] {
  const parsed = parseWeekId(week);
  if (!parsed || count < 1) return [week];
  return Array.from({ length: count }, (_, i) => {
    const { year, week: w } = offsetWeek(parsed.year, parsed.week, -i);
    return formatWeekId(year, w);
  });
}

/** The ISO week Thursday preparation targets: the one after the current week. */
export function nextWeekId(now = new Date()): string {
  const parsed = parseWeekId(currentIsoWeekId(now));
  if (!parsed) return currentIsoWeekId(now);
  const { year, week } = offsetWeek(parsed.year, parsed.week, 1);
  return formatWeekId(year, week);
}

/** The ISO week rollover finishes: the one before the current week. */
export function previousWeekId(now = new Date()): string {
  const parsed = parseWeekId(currentIsoWeekId(now));
  if (!parsed) return currentIsoWeekId(now);
  const { year, week } = offsetWeek(parsed.year, parsed.week, -1);
  return formatWeekId(year, week);
}

/** Re-exported so callers do not need a second import for diagnostics. */
export { measureCoverage, coverageGaps, SHELF_POLICY_VERSION };
export { completeShelfAgainstPlan, shortlistShelf, applyNotThisWeek } from "./planner-shelf.ts";
export type { WeeklyShelf };
