/**
 * Recipe exposure memory (Kitchen DESIGN.md §4.3, "Exposure and resurfacing
 * policy").
 *
 * Cooked/planned recency and explicit negative feedback stay *harder*
 * exclusions and are not modelled here. This module owns the softer signal
 * David never has to click: a catalog recipe that was put in front of him and
 * quietly not chosen.
 *
 *   1st unselected exposure  → 12-week automatic cooldown
 *   2nd unselected exposure  → out of automatic suggestion entirely, until he
 *                              explicitly asks for it, searches for it, or
 *                              resets the preference. It stays in the recipe
 *                              book the whole time.
 *
 * This replaces the five-week offered-recipe lookback, which was too short and
 * is why familiar unchosen recipes kept coming back.
 *
 * Pure and dependency-free: `db.ts` persists these records, and `node --test`
 * loads this file directly.
 */

/** Weeks a recipe rests after one ignored appearance. */
export const EXPOSURE_COOLDOWN_WEEKS = 12;
const DAY_MS = 86_400_000;
export const EXPOSURE_COOLDOWN_MS = EXPOSURE_COOLDOWN_WEEKS * 7 * DAY_MS;

/** Exposures after which a recipe leaves automatic suggestion entirely. */
export const EXPOSURE_SUPPRESSION_THRESHOLD = 2;

export type ExposureRecord = {
  recipeId: string;
  /** Count of *unselected* exposures. Selection resets this to 0. */
  exposureCount: number;
  firstExposedAt: string;
  lastExposedAt: string;
  /** ISO timestamp until which automatic suggestion is on cooldown. */
  cooldownUntil: string | null;
  /** True once the recipe has left automatic suggestion until an explicit ask. */
  suppressed: boolean;
  /**
   * ISO week whose shelf produced the last counted exposure.
   *
   * This is the durable half of rollover idempotency: the strike itself
   * remembers which week paid for it, so re-running rollover for that week —
   * after a retry, a crash, a lost claim row, or a manual re-trigger — cannot
   * turn one ignored appearance into a second one. Null on records written
   * before this column existed, and after any selection/reset.
   */
  lastCountedWeek: string | null;
  updatedAt: string;
};

export type ExposureState = "available" | "cooldown" | "suppressed";

/** Why a caller is looking at exposure state. Explicit intent bypasses it. */
export type SuggestionMode =
  /** The weekly automatic shelf. Exposure memory applies in full. */
  | "automatic"
  /** David searched, asked for the recipe, or requested it in chat. */
  | "explicit";

function iso(at: Date): string {
  return at.toISOString();
}

/**
 * Has `week`'s shelf already been counted against this recipe, according to the
 * record itself?
 *
 * `lastCountedWeek` is a single marker: it names the *last* week that paid for
 * a strike, and selection deliberately clears it along with the strike. That is
 * right for the recipe's standing but insufficient for re-run safety on its
 * own — see `countedRecipeIds` on `diffShelfExposure` for the durable half.
 */
export function alreadyCountedForWeek(
  record: ExposureRecord | null | undefined,
  week: string | null | undefined,
): boolean {
  return Boolean(week && record?.lastCountedWeek === week);
}

/**
 * Record one *unselected* exposure.
 *
 * Idempotent per week: pass the ISO week whose shelf showed the recipe and a
 * second call for that same week returns the previous record untouched. A
 * second appearance in a *different* week is a real second exposure. Callers
 * that pass no week (unit tests, one-off tooling) get the plain increment and
 * keep whatever week was last counted.
 */
export function recordUnselectedExposure(
  previous: ExposureRecord | null | undefined,
  recipeId: string,
  at: Date,
  countedWeek: string | null = null,
): ExposureRecord {
  if (previous && alreadyCountedForWeek(previous, countedWeek)) return previous;

  const count = (previous?.exposureCount ?? 0) + 1;
  const suppressed = count >= EXPOSURE_SUPPRESSION_THRESHOLD;
  return {
    recipeId,
    exposureCount: count,
    firstExposedAt: previous?.firstExposedAt ?? iso(at),
    lastExposedAt: iso(at),
    // A suppressed recipe has no meaningful cooldown end — it waits for an
    // explicit ask, not for the clock.
    cooldownUntil: suppressed ? null : iso(new Date(at.getTime() + EXPOSURE_COOLDOWN_MS)),
    suppressed,
    lastCountedWeek: countedWeek ?? previous?.lastCountedWeek ?? null,
    updatedAt: iso(at),
  };
}

/**
 * Selection clears exposure memory: the recipe was not ignored, it was chosen.
 * Returns null when there was nothing to clear, so callers can skip the write.
 */
export function clearExposureOnSelection(
  previous: ExposureRecord | null | undefined,
  at: Date,
): ExposureRecord | null {
  if (!previous || (previous.exposureCount === 0 && !previous.suppressed)) return null;
  return {
    ...previous,
    exposureCount: 0,
    cooldownUntil: null,
    suppressed: false,
    // The strike is gone, so the week that paid for it is no longer owed
    // anything either: a later ignored appearance starts from zero again.
    lastCountedWeek: null,
    updatedAt: iso(at),
  };
}

/** Explicit reset (David asked for the recipe back). Same shape as selection. */
export function resetExposure(
  previous: ExposureRecord | null | undefined,
  recipeId: string,
  at: Date,
): ExposureRecord {
  return {
    recipeId,
    exposureCount: 0,
    firstExposedAt: previous?.firstExposedAt ?? iso(at),
    lastExposedAt: previous?.lastExposedAt ?? iso(at),
    cooldownUntil: null,
    suppressed: false,
    lastCountedWeek: null,
    updatedAt: iso(at),
  };
}

export function exposureState(record: ExposureRecord | null | undefined, now: Date): ExposureState {
  if (!record) return "available";
  if (record.suppressed) return "suppressed";
  if (record.cooldownUntil && Date.parse(record.cooldownUntil) > now.getTime()) return "cooldown";
  return "available";
}

/**
 * May the automatic weekly shelf offer this recipe?
 *
 * `explicit` mode always returns true — exposure memory must never make a
 * recipe unreachable when David asks for it by name or searches for it.
 */
export function isSuggestable(
  record: ExposureRecord | null | undefined,
  now: Date,
  mode: SuggestionMode = "automatic",
): boolean {
  if (mode === "explicit") return true;
  return exposureState(record, now) === "available";
}

/**
 * Ids the automatic shelf must not offer, given the whole exposure table.
 * Assigned recipes are handled by the caller: an assigned candidate stays
 * visible-but-disabled and is never treated as an ignored exposure.
 */
export function suppressedRecipeIds(
  records: Iterable<ExposureRecord>,
  now: Date,
): Set<string> {
  const out = new Set<string>();
  for (const record of records) {
    if (exposureState(record, now) !== "available") out.add(record.recipeId);
  }
  return out;
}

export type ExposureDiff = {
  /** Recipes whose exposure was recorded because they were shown and ignored. */
  exposed: ExposureRecord[];
  /** Recipes whose exposure memory was cleared because they were selected. */
  cleared: ExposureRecord[];
  /** Ids skipped because this week's shelf already counted against them. */
  alreadyCounted: string[];
  /**
   * Ids counted by *this* diff, for the caller to append to the durable
   * counted-weeks ledger under `countedWeek`. Empty when no week was supplied.
   */
  newlyCounted: string[];
};

/**
 * Compute the exposure writes for one shelf outcome.
 *
 * `shownIds` is everything the shelf offered; `selectedIds` is everything David
 * actually assigned (or kept). The difference is what he ignored.
 *
 * Re-run safety has two halves, and both are needed:
 *
 *   `countedWeek` — the week whose shelf produced this diff. A record that
 *     already names it is skipped, which covers the ordinary retry.
 *   `countedRecipeIds` — the durable ledger of ids already counted *for that
 *     week*, which survives a later selection. Without it, out-of-order re-runs
 *     silently double-count: W40 records an ignore, W41's selection clears the
 *     strike and the marker with it, and re-running W40 then writes the strike
 *     again — reversing a choice David made. A week in the ledger is finished,
 *     whatever happened to the recipe since.
 *
 * Selected ids are always diffed — clearing is idempotent, and a recipe that
 * was searched for and assigned off-shelf must be able to shed its suppression
 * here regardless of which weeks have been counted.
 */
export function diffShelfExposure(
  shownIds: Iterable<string>,
  selectedIds: ReadonlySet<string>,
  existing: ReadonlyMap<string, ExposureRecord>,
  at: Date,
  options: { countedWeek?: string | null; countedRecipeIds?: ReadonlySet<string> | null } = {},
): ExposureDiff {
  const countedWeek = options.countedWeek ?? null;
  const ledger = options.countedRecipeIds ?? null;
  const exposed: ExposureRecord[] = [];
  const cleared: ExposureRecord[] = [];
  const alreadyCounted: string[] = [];
  const newlyCounted: string[] = [];
  const seen = new Set<string>();

  for (const id of shownIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const previous = existing.get(id) ?? null;
    if (selectedIds.has(id)) {
      const next = clearExposureOnSelection(previous, at);
      if (next) cleared.push(next);
      continue;
    }
    if (alreadyCountedForWeek(previous, countedWeek) || (countedWeek && ledger?.has(id))) {
      alreadyCounted.push(id);
      continue;
    }
    exposed.push(recordUnselectedExposure(previous, id, at, countedWeek));
    if (countedWeek) newlyCounted.push(id);
  }

  return { exposed, cleared, alreadyCounted, newlyCounted };
}
