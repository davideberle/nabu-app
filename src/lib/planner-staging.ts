/**
 * Hidden web staging, reversible `Keep`, rollover promotion, and expiry
 * (Kitchen DESIGN.md §4.3, "Weekly web inspiration contract").
 *
 * The lifecycle, in one place:
 *
 *   imported  → written with `visibility: "planner-candidate"`, so it powers
 *               planner cards and quick view but never appears in My Recipes or
 *               recipe search
 *   kept      → David pressed Keep. Reversible; persisted across reloads
 *   assigned  → the recipe is on a day of the week. Assignment *is* retention,
 *               with or without a Keep press
 *   promoted  → at week rollover, kept-or-assigned records become normal My
 *               Recipes (`visibility: "personal"`) under their true
 *               publication/source
 *   expired   → unkept, unassigned records are deleted after the retention
 *               window. Only a URL/title fingerprint remains, so a deleted
 *               import is not rediscovered next week
 *
 * Pure and dependency-free; `db.ts` performs the writes these decisions imply.
 */

import type { Recipe } from "./recipes";

/** Documented retention window is 8–12 weeks; 10 is the configured default. */
export const STAGING_RETENTION_WEEKS = 10;
const WEEK_MS = 7 * 86_400_000;
export const STAGING_RETENTION_MS = STAGING_RETENTION_WEEKS * WEEK_MS;

export type StagedWebRecipe = {
  recipeId: string;
  week: string;
  sourceUrl: string;
  sourceName: string;
  importedAt: string;
  /** ISO timestamp when Keep was pressed; null when never kept or un-kept. */
  keptAt: string | null;
  /** ISO timestamp of promotion into My Recipes. */
  promotedAt: string | null;
  recipeName?: string | null;
  /** How the idea was discovered. Shown on the card; never a qualification. */
  discovery?: "editorial" | "search" | null;
};

export type RolloverAction = "promote" | "expire" | "retain";

export type RolloverDecision = {
  record: StagedWebRecipe;
  action: RolloverAction;
  reason: string;
};

export type RolloverPlan = {
  promote: RolloverDecision[];
  expire: RolloverDecision[];
  retain: RolloverDecision[];
};

/**
 * Duplicate fingerprint that outlives an expired staging record.
 *
 * Two independent keys: the canonical URL, and the normalized title. Either one
 * matching is a duplicate, which is what stops a deleted import from being
 * rediscovered under a slightly different URL or a re-slugged page.
 */
export type StagingFingerprint = {
  urlKey: string;
  titleKey: string;
  sourceName: string;
  expiredAt: string;
};

export function canonicalUrlKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    parsed.host = parsed.host.toLowerCase().replace(/^www\./, "");
    return parsed.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return String(url ?? "").trim().toLowerCase();
  }
}

export function normalizedTitleKey(title: string): string {
  return String(title ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function fingerprintFor(record: {
  sourceUrl: string;
  recipeName?: string | null;
  recipeId?: string;
  sourceName?: string;
}, expiredAt: Date): StagingFingerprint {
  return {
    urlKey: canonicalUrlKey(record.sourceUrl),
    titleKey: normalizedTitleKey(record.recipeName ?? record.recipeId ?? ""),
    sourceName: record.sourceName ?? "",
    expiredAt: expiredAt.toISOString(),
  };
}

/** True when a freshly discovered page matches a retained expiry fingerprint. */
export function isFingerprintDuplicate(
  candidate: { url: string; title?: string | null },
  fingerprints: Iterable<StagingFingerprint>,
): boolean {
  const urlKey = canonicalUrlKey(candidate.url);
  const titleKey = normalizedTitleKey(candidate.title ?? "");
  for (const fingerprint of fingerprints) {
    if (fingerprint.urlKey && fingerprint.urlKey === urlKey) return true;
    if (titleKey && fingerprint.titleKey && fingerprint.titleKey === titleKey) return true;
  }
  return false;
}

/** Apply a reversible Keep press. Returns the record as it should be stored. */
export function applyKeep(record: StagedWebRecipe, kept: boolean, at: Date): StagedWebRecipe {
  return { ...record, keptAt: kept ? at.toISOString() : null };
}

/** Retention is Keep **or** assignment — assignment is an equal signal. */
export function isRetained(record: StagedWebRecipe, assignedRecipeIds: ReadonlySet<string>): boolean {
  return Boolean(record.keptAt) || assignedRecipeIds.has(record.recipeId);
}

export type RolloverInput = {
  records: readonly StagedWebRecipe[];
  /** Every recipe id assigned to any day of any week that still matters. */
  assignedRecipeIds: ReadonlySet<string>;
  now: Date;
  retentionMs?: number;
};

/**
 * Decide what happens to each staged record at week rollover.
 *
 * Already-promoted records are retained, not promoted twice — the whole thing
 * is safe to run repeatedly, which is what makes the watchdog idempotent.
 */
export function planRollover(input: RolloverInput): RolloverPlan {
  const retentionMs = input.retentionMs ?? STAGING_RETENTION_MS;
  const plan: RolloverPlan = { promote: [], expire: [], retain: [] };

  for (const record of input.records) {
    if (record.promotedAt) {
      plan.retain.push({ record, action: "retain", reason: "already promoted" });
      continue;
    }
    if (isRetained(record, input.assignedRecipeIds)) {
      plan.promote.push({
        record,
        action: "promote",
        reason: record.keptAt ? "kept" : "assigned to a day",
      });
      continue;
    }
    const importedAt = Date.parse(record.importedAt);
    const age = Number.isFinite(importedAt) ? input.now.getTime() - importedAt : 0;
    if (age >= retentionMs) {
      plan.expire.push({
        record,
        action: "expire",
        reason: `unkept and unassigned for ${STAGING_RETENTION_WEEKS}+ weeks`,
      });
      continue;
    }
    plan.retain.push({ record, action: "retain", reason: "still inside the retention window" });
  }

  return plan;
}

/**
 * The recipe as it should be stored once promoted.
 *
 * Promotion drops the hidden staging state and *keeps the real publication*.
 * A FOOBY recipe must read as FOOBY in My Recipes, not as "My Recipes" — the
 * import metadata is the provenance, not decoration.
 *
 * It becomes `personal` rather than losing its visibility entirely. Keeping or
 * cooking a web idea is deliberate curation, and `personal` is how the planner
 * already records that: browsable and searchable like any other My Recipe (only
 * `planner-candidate` is hidden), but still recognisably David's own choice, so
 * a promoted light meal — a substantial wrap, a loaded flatbread — stays
 * dinner-capable instead of silently dropping out of the planner the moment it
 * left staging.
 */
export function promotedRecipe(recipe: Recipe, record: StagedWebRecipe): Recipe {
  const promoted: Recipe = { ...recipe, visibility: "personal" };

  const existingSource = recipe.source ?? undefined;
  promoted.source = {
    ...(existingSource ?? {}),
    cookbook: record.sourceName || existingSource?.cookbook || "Web inspiration",
    author: existingSource?.author || record.sourceName,
    publication: record.sourceName || existingSource?.publication,
  };

  return promoted;
}

/** True when a stored recipe is still a hidden staging record. */
export function isStagedRecipe(recipe: Pick<Recipe, "visibility"> | null | undefined): boolean {
  return recipe?.visibility === "planner-candidate";
}
