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
  deriveShelfTraits,
  measureCoverage,
  coverageGaps,
  SHELF_POLICY_VERSION,
  type ShelfCandidate,
  type ShelfItem,
  type ShelfTraits,
  type WeeklyShelf,
} from "./planner-shelf.ts";
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
};

function normalizeTime(time: Recipe["time"]): { prep: number; cook: number; total: number } | null {
  if (!time) return null;
  const prep = typeof time.prep === "number" ? time.prep : 0;
  const cook = typeof time.cook === "number" ? time.cook : 0;
  let total = typeof time.total === "number" ? time.total : 0;
  if (total <= 0 && prep + cook > 0) total = prep + cook;
  if (total <= 0) return null;
  return { prep, cook, total };
}

/**
 * Turn a resolved recipe into a shelf candidate: role first, then bucket,
 * cuisine, and the coverage traits the shelf reasons about.
 */
export function toShelfCandidate(recipe: Recipe, origin: CandidateOrigin, now: Date): ShelfCandidate {
  const role = classifyPlannerRole(recipe);
  const traits = deriveShelfTraits(recipe, now);
  const time = normalizeTime(recipe.time);
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
    ...(role.completion ? { completion: role.completion } : {}),
    display: deriveShelfDisplay({ role: role.role, traits, time, completion: role.completion }),
    ...(origin.rank !== undefined ? { rank: origin.rank } : {}),
  };
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
    ...(item.completion ? { completion: item.completion } : {}),
    display: item.display ?? candidateDisplay(item),
  };
}

/**
 * Rebuild live shelf items from a persisted candidate set.
 *
 * Sets written before `planner-shelf-1` carry no origin/role/traits. Rather
 * than inventing them, the recipe is re-resolved and its traits re-derived; an
 * item whose recipe no longer resolves is kept with neutral traits so a
 * targeted replacement can never silently drop a card it failed to read.
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
  }[],
  assignedRecipeIds: ReadonlySet<string>,
  resolveRecipe: (id: string) => Promise<Recipe | undefined | null>,
  now: Date,
): Promise<ShelfItem[]> {
  const hydrated: ShelfItem[] = [];
  for (const item of items) {
    if (!item?.recipeId) continue;
    const assigned = assignedRecipeIds.has(item.recipeId);

    if (item.traits && item.origin && item.role) {
      hydrated.push({
        recipeId: item.recipeId,
        recipeName: item.recipeName ?? item.recipeId,
        origin: item.origin === "web" ? "web" : "catalog",
        discovery: (item.discovery as ShelfItem["discovery"]) ?? "catalog",
        sourceName: item.source?.cookbook ?? null,
        role: item.role as ShelfItem["role"],
        bucket: (item.bucket as ShelfItem["bucket"]) ?? "vegetarian",
        cuisine: item.cuisine ?? "Other",
        image: item.image ?? null,
        traits: item.traits,
        ...(item.completion ? { completion: item.completion } : {}),
        display: item.display ?? candidateDisplay(item),
        reason: item.reason ?? "",
        assigned,
      });
      continue;
    }

    const recipe = await resolveRecipe(item.recipeId).catch(() => null);
    if (recipe) {
      const candidate = toShelfCandidate(
        recipe,
        { origin: item.origin === "web" ? "web" : "catalog", discovery: item.origin === "web" ? "search" : "catalog" },
        now,
      );
      hydrated.push({ ...candidate, reason: item.reason ?? "Saved earlier this week", assigned });
      continue;
    }

    hydrated.push({
      recipeId: item.recipeId,
      recipeName: item.recipeName ?? item.recipeId,
      origin: item.origin === "web" ? "web" : "catalog",
      discovery: "catalog",
      sourceName: item.source?.cookbook ?? null,
      role: "main",
      bucket: (item.bucket as ShelfItem["bucket"]) ?? "vegetarian",
      cuisine: item.cuisine ?? "Other",
      image: item.image ?? null,
      traits: {
        shape: "other",
        protein: "vegetarian",
        starch: "none",
        effort: "medium",
        weekdayFit: true,
        weekendFit: true,
        vegetableDense: false,
        seasonalLocal: false,
        longHaul: false,
      },
      display: item.display ?? candidateDisplay(item),
      reason: item.reason ?? "Saved earlier this week",
      assigned,
    });
  }
  return hydrated;
}

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

    out.push({
      ...item,
      role,
      traits,
      ...(completion ? { completion } : {}),
      display: deriveShelfDisplay({ role, traits, time, completion }),
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

  return { healthy: problems.length === 0, problems };
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
  error?: string;
};

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

    const [existing, web, catalog] = await Promise.all([
      deps.loadPlan(week),
      deps.loadWebCandidates(week),
      deps.loadCatalogCandidates(week),
    ]);

    const assigned = assignedRecipeIdsOf(existing);
    const shelf = assembleWeeklyShelf({
      web: web.filter((c) => c.role === "main" || c.role === "light-meal"),
      catalog: catalog.filter((c) => c.role === "main" || c.role === "light-meal"),
      pairings: [...web, ...catalog].filter((c) => c.role === "pairing"),
      assignedRecipeIds: assigned,
    });

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
        items: shelf.items.map(toCandidateItem),
        reserves: shelf.reserves.map((reserve) => ({
          recipeId: reserve.recipeId,
          recipeName: reserve.recipeName,
          role: reserve.role,
          sourceName: reserve.sourceName ?? null,
          image: reserve.image ?? null,
        })),
        shelfDiagnostics: shelf.diagnostics,
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
    const warnings = [
      ...webWarnings,
      ...(shelf.diagnostics.warnings ?? []),
      ...(health.healthy ? [] : health.problems.map((problem) => `saved shelf: ${problem}`)),
    ];

    await deps.complete?.(week, kind, "succeeded", {
      shelfSize,
      webSelected: shelf.diagnostics.webSelected,
      catalogSelected: shelf.diagnostics.catalogSelected,
      webStatus: ensured.status,
      healthy: health.healthy,
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
export type { WeeklyShelf };
