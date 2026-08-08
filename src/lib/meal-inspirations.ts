/**
 * Weekly web-inspiration import orchestration (Kitchen DESIGN.md §4.3, Phase
 * 3B). The Kitchen importer script stays authoritative for trusted sources,
 * extraction, staging, and duplicate refusal; this module owns running it from
 * the app runtime and recording provenance for the accepted results.
 *
 * Shared by POST /api/meals/inspirations (explicit "Research Web Ideas") and
 * the fresh-week auto-ensure on GET, so both paths apply identical
 * trusted-source, duplicate, planner-main, and provenance rules.
 */

// Explicit .ts extensions: loaded directly by node --test.
import {
  getMyRecipe,
  getWebInspirationsForWeek,
  recordWebInspiration,
  getPlannerRecencyExclusions,
  claimWeeklyInspirationEnsure,
  completeWeeklyInspirationEnsure,
} from "./db.ts";
import {
  currentIsoWeekId,
  getRecentWeekIds,
  plannerPolicy,
} from "./meals-core.ts";
import { classifyPlannerRole } from "./planner-roles.ts";
import type { Recipe } from "./recipes";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_WEB_INSPIRATION_COUNT = 8;

/**
 * Can this runtime actually run the Kitchen importer?
 *
 * On Vercel it cannot, and pretending otherwise is what produced a healthy
 * twelve-item shelf with `webSelected: 0` in production. The importer needs a
 * writable `public/recipes` directory, the workspace checkout beside the app,
 * a minutes-long budget of outbound scraping, and a child process — a Vercel
 * function has none of those. `execFile` there does not fail loudly with a
 * useful reason; it fails as "0 imported", which reads exactly like a week
 * where the web simply had nothing good.
 *
 * So the platform is asked directly rather than inferred from an error. Web
 * discovery is a **local-runtime** job (`scripts/prepare-weekly-shelf.mjs` on
 * David's Mac), and the deployed app assembles the shelf from what that run
 * already staged.
 *
 * `KITCHEN_INSPIRATION_IMPORTER_COMMAND` is the deliberate override: a runtime
 * that has been given a real importer command has said it can run one.
 */
export function importerRuntimeSupported(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.KITCHEN_INSPIRATION_IMPORTER_COMMAND) return true;
  return !(env.VERCEL || env.VERCEL_ENV);
}

export type ImporterExecError = Error & {
  stdout?: string;
  stderr?: string;
};

export type ImportedItem = {
  id: string;
  url: string;
  source: string;
  /** Editor-curated surface vs targeted-search fallback. */
  discovery?: "editorial" | "search";
  /** Role the importer's classification assigned. */
  role?: string;
};

export type ImporterReport = {
  imported?: ImportedItem[];
  /** Staged pairing/serve-with ideas. They never occupy a main slot. */
  pairings?: ImportedItem[];
  errors?: { message?: string; url?: string }[];
  skipped?: { reason?: string; name?: string; url?: string }[];
};

export type ImporterRunResult = {
  report: ImporterReport;
  stderr?: string;
  /** True when the importer exited nonzero but still produced a valid report. */
  recovered: boolean;
};

/**
 * Recipe/source-URL exclusion ids for web-inspiration candidate filtering:
 * recently cooked, recently planned, offered in recent prior candidate sets,
 * and active negative feedback. The week's own current offers are not
 * excluded — they are exactly what the planner is showing.
 */
export async function getInspirationExclusionIds(week: string): Promise<Set<string>> {
  const exclusions = await getPlannerRecencyExclusions(week);
  return new Set([
    ...exclusions.recentlyCooked,
    ...exclusions.recentlyPlanned,
    ...exclusions.recentlyOffered,
    ...exclusions.negativeFeedback,
  ]);
}

export type InspirationProvenanceSets = {
  currentRecipeIds: Set<string>;
  currentSourceUrls: Set<string>;
  recentRecipeIds: Set<string>;
  recentSourceUrls: Set<string>;
};

/**
 * Recipe ids and source URLs already used by web inspirations in the given
 * week (current) and its recent prior weeks (recent), so re-running discovery
 * cannot re-return ideas David has already been shown.
 */
export async function getInspirationProvenanceSets(
  week: string,
  lookbackWeeks = plannerPolicy().recentWeeksLookback,
): Promise<InspirationProvenanceSets> {
  const recentWeeks = getRecentWeekIds(week, lookbackWeeks);
  const allWeeks = [week, ...recentWeeks.filter((w) => w !== week)];
  const perWeek = await Promise.all(allWeeks.map((w) => getWebInspirationsForWeek(w)));

  const sets: InspirationProvenanceSets = {
    currentRecipeIds: new Set(),
    currentSourceUrls: new Set(),
    recentRecipeIds: new Set(),
    recentSourceUrls: new Set(),
  };
  for (let i = 0; i < perWeek.length; i++) {
    const isCurrentWeek = i === 0;
    for (const insp of perWeek[i]) {
      if (isCurrentWeek) {
        sets.currentRecipeIds.add(insp.recipe_id);
        if (insp.source_url) sets.currentSourceUrls.add(insp.source_url);
      } else {
        sets.recentRecipeIds.add(insp.recipe_id);
        if (insp.source_url) sets.recentSourceUrls.add(insp.source_url);
      }
    }
  }
  return sets;
}

export type RunImporterOptions = {
  /** Test seam: replaces the child-process invocation. */
  exec?: (command: string, args: string[], opts: object) => Promise<{ stdout: string; stderr: string }>;
  /** Test seam: the environment the runtime check reads. */
  env?: Record<string, string | undefined>;
};

/** Thrown instead of spawning on a runtime that cannot host the importer. */
export const IMPORTER_UNSUPPORTED_MESSAGE =
  "The Kitchen importer cannot run in this runtime. Weekly web research runs on " +
  "the local Kitchen runtime (scripts/prepare-weekly-shelf.mjs), which stages the " +
  "week's ideas before /api/meals/prepare assembles the shelf.";

/**
 * Run the Kitchen weekly-inspirations importer for a week.
 *
 * The importer may exit nonzero (code 1) even when it produces a valid JSON
 * report on stdout (e.g. 0 imported, N skipped); that case is recovered and
 * flagged. Throws the original error when stdout holds no parseable report.
 *
 * Refuses outright on a runtime that cannot host a child process at all. That
 * check lives here, at the single place a spawn would happen, so no caller can
 * reintroduce the failure mode by reaching past it.
 */
export async function runInspirationImporter(
  week: string,
  importerCount: number,
  options: RunImporterOptions = {},
): Promise<ImporterRunResult> {
  if (!importerRuntimeSupported(options.env ?? process.env)) {
    throw new Error(IMPORTER_UNSUPPORTED_MESSAGE);
  }
  const customCommand = process.env.KITCHEN_INSPIRATION_IMPORTER_COMMAND;
  const scriptPath = `${process.cwd()}/scripts/weekly-inspirations.mjs`;
  const importerArgs = ["--week", week, "--count", String(importerCount), "--write-app-files", "--write-app-db", "--yes", "--json"];

  const execOpts = {
    env: {
      ...process.env,
      NABU_DB_DIR: process.env.NABU_DB_DIR || process.env.HOME + "/.openclaw/workspace/projects/companion-app/app",
      TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
      TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
      BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    },
    timeout: 60000,
  };
  const exec = options.exec ?? execFileAsync;

  try {
    const { stdout, stderr } = customCommand
      ? await exec(customCommand.split(" ")[0], [...customCommand.split(" ").slice(1), ...importerArgs], execOpts)
      : await exec(process.execPath, [scriptPath, ...importerArgs], execOpts);

    if (stderr && !stderr.includes("warning")) {
      console.error("Kitchen importer stderr:", stderr);
    }
    return { report: JSON.parse(stdout) as ImporterReport, stderr, recovered: false };
  } catch (error) {
    // The importer may print a valid JSON report to stdout and still exit 1
    // (e.g. 0 imported, all skipped). Try to recover the report from stdout.
    if (error instanceof Error) {
      const execError = error as ImporterExecError;
      if (execError.stdout?.trim()) {
        try {
          const report = JSON.parse(execError.stdout) as ImporterReport;
          console.warn("Kitchen importer exited nonzero but produced a valid report; continuing");
          return { report, stderr: execError.stderr, recovered: true };
        } catch {
          // stdout was not valid JSON — genuine failure
        }
      }
    }
    throw error;
  }
}

export type AcceptedImport = {
  recipe: Recipe;
  url: string;
  source: string;
  discovery: "editorial" | "search";
  role: "main" | "light-meal" | "pairing";
};

export type RecordImportsResult = {
  /** Ideas that may occupy a dinner main slot. */
  accepted: AcceptedImport[];
  /** Staged pairing ideas: reserve/serve-with metadata only. */
  pairings: AcceptedImport[];
  skippedDuplicates: string[];
  skippedNonMain: string[];
  missingMyRecipeIds: string[];
};

export type RecordImportsDeps = {
  resolveMyRecipe?: (id: string) => Promise<Recipe | undefined>;
  recordProvenance?: (
    recipeId: string,
    week: string,
    sourceUrl: string,
    sourceName: string,
    discovery?: "editorial" | "search",
  ) => Promise<void>;
};

/**
 * Filter an importer report against duplicate/exclusion/planner-main rules and
 * record week provenance for each accepted recipe. Mutates the provided
 * provenance sets so subsequent acceptances in the same run are deduplicated.
 */
export async function recordEligibleImports(
  week: string,
  report: ImporterReport,
  exclusionIds: ReadonlySet<string>,
  provenance: InspirationProvenanceSets,
  deps: RecordImportsDeps = {},
): Promise<RecordImportsResult> {
  const resolveMyRecipe = deps.resolveMyRecipe ?? getMyRecipe;
  const recordProvenance = deps.recordProvenance ?? recordWebInspiration;

  const result: RecordImportsResult = {
    accepted: [],
    pairings: [],
    skippedDuplicates: [],
    skippedNonMain: [],
    missingMyRecipeIds: [],
  };

  // Mains and pairings both get staged and both get provenance. What differs
  // is where they end up on the shelf: a pairing is reserve/serve-with
  // metadata and can never take a dinner slot.
  const queue = [
    ...(report.imported ?? []).map((item) => ({ item, expected: "main" as const })),
    ...(report.pairings ?? []).map((item) => ({ item, expected: "pairing" as const })),
  ];

  for (const { item: imported } of queue) {
    // Skip if this recipe or URL was already used in recent weeks
    if (
      exclusionIds.has(imported.id) ||
      provenance.recentRecipeIds.has(imported.id) ||
      provenance.recentSourceUrls.has(imported.url) ||
      provenance.currentRecipeIds.has(imported.id) ||
      provenance.currentSourceUrls.has(imported.url)
    ) {
      result.skippedDuplicates.push(imported.id);
      continue;
    }
    const recipe = await resolveMyRecipe(imported.id);
    if (!recipe) {
      result.missingMyRecipeIds.push(imported.id);
      continue;
    }

    // The app re-classifies rather than trusting the importer's own label: the
    // recipe as *stored* is what the planner will show, and this is the same
    // classifier the catalog goes through.
    const role = classifyPlannerRole(recipe);
    if (role.role === "reject") {
      result.skippedNonMain.push(imported.id);
      continue;
    }

    const discovery = imported.discovery === "editorial" ? "editorial" : "search";
    await recordProvenance(imported.id, week, imported.url, imported.source, discovery);
    provenance.currentRecipeIds.add(imported.id);
    if (imported.url) provenance.currentSourceUrls.add(imported.url);

    const accepted: AcceptedImport = {
      recipe,
      url: imported.url,
      source: imported.source,
      discovery,
      role: role.role,
    };
    if (role.role === "pairing") result.pairings.push(accepted);
    else result.accepted.push(accepted);
  }

  return result;
}

export type AutoEnsureParams = {
  week: string;
  /** Stored inspiration rows already present for the week. */
  storedCount: number;
  /** Raw `ensure` query param; "0" opts out for read-only verification. */
  ensureParam: string | null;
  /** True only for the canonical authorized session (never anonymous/tracker). */
  authorizedForEnsure: boolean;
  /** Injectable for tests; defaults to the real current ISO week. */
  currentWeek?: string;
};

/**
 * Decide whether a GET may auto-ensure the weekly inspiration set. The ensure
 * claims a DB row and can run the importer — those are writes, so an
 * unauthenticated or tracker-only read must never trigger them. Past weeks
 * are history and are never backfilled. ISO week ids are fixed-width, so
 * lexicographic order is chronological.
 */
export function shouldAutoEnsureWeeklyInspirations(params: AutoEnsureParams): boolean {
  if (!params.authorizedForEnsure) return false;
  if (params.storedCount > 0) return false;
  if (params.ensureParam === "0") return false;
  if (!/^\d{4}-W\d{2}$/.test(params.week)) return false;
  return params.week >= (params.currentWeek ?? currentIsoWeekId());
}

export type EnsureWeeklyInspirationsResult =
  | { status: "claim-not-acquired" }
  | { status: "succeeded"; accepted: number; skippedDuplicates: number }
  | { status: "failed"; error: string };

export type EnsureDeps = RecordImportsDeps & RunImporterOptions & {
  claim?: (week: string) => Promise<boolean>;
  complete?: (week: string, status: "succeeded" | "failed") => Promise<void>;
};

/**
 * Ensure a FOOBY-led inspiration set exists for a fresh week. Callers check
 * that the week has no stored inspirations before calling. The DB-level claim
 * makes concurrent page loads run the importer at most once, and completed
 * attempts only retry after a cooldown — combined with the importer's own
 * URL/title duplicate refusal and the upsert provenance writes, retries are
 * idempotent and cannot duplicate recipes, URLs, or provenance rows.
 */
export async function ensureWeeklyInspirations(
  week: string,
  count = DEFAULT_WEB_INSPIRATION_COUNT,
  deps: EnsureDeps = {},
): Promise<EnsureWeeklyInspirationsResult> {
  const claim = deps.claim ?? claimWeeklyInspirationEnsure;
  const complete = deps.complete ?? completeWeeklyInspirationEnsure;

  if (!(await claim(week))) {
    return { status: "claim-not-acquired" };
  }

  try {
    // Over-request: the post-import filters (recent duplicates, non-main
    // checks) reject some results, and the importer cannot know about them.
    const importerCount = Math.min(count * 3, 12);
    const [{ report }, exclusionIds, provenance] = await Promise.all([
      runInspirationImporter(week, importerCount, deps),
      getInspirationExclusionIds(week),
      getInspirationProvenanceSets(week),
    ]);
    const recorded = await recordEligibleImports(week, report, exclusionIds, provenance, deps);
    await complete(week, "succeeded");
    return {
      status: "succeeded",
      accepted: recorded.accepted.length,
      skippedDuplicates: recorded.skippedDuplicates.length,
    };
  } catch (error) {
    try {
      await complete(week, "failed");
    } catch {
      // Claim row stays 'running' and unblocks via the staleness window.
    }
    return { status: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * What weekly preparation found when it looked for the week's web ideas.
 *
 * `web-not-staged` is the honest name for the production case: nothing was
 * staged for this week and this runtime cannot go and get it. Preparation still
 * builds a shelf from the catalog — a twelve-idea week is better than none —
 * but the outcome says plainly that research did not happen, so a smoke test,
 * the status endpoint, and the Friday watchdog can all tell the difference
 * between "the web offered nothing" and "nobody asked the web".
 */
export type WebInspirationStatus =
  | { status: "already-staged"; staged: number }
  | { status: "web-not-staged"; reason: string }
  | EnsureWeeklyInspirationsResult;

export type WebStagingDeps = EnsureDeps & {
  loadStoredCount?: (week: string) => Promise<number>;
  env?: Record<string, string | undefined>;
};

/**
 * Resolve the week's web ideas for weekly preparation, without ever assuming a
 * child process is available.
 *
 * Order matters, and the first branch is the one that carries the weight: rows
 * already staged for the week are the answer, whoever wrote them. That is what
 * makes the local-runtime handoff work — `scripts/prepare-weekly-shelf.mjs`
 * stages, then calls `/api/meals/prepare`, and preparation simply finds the
 * work done.
 */
export async function resolveWebInspirations(
  week: string,
  count = DEFAULT_WEB_INSPIRATION_COUNT,
  deps: WebStagingDeps = {},
): Promise<WebInspirationStatus> {
  const loadStoredCount =
    deps.loadStoredCount ?? (async (w: string) => (await getWebInspirationsForWeek(w)).length);

  const staged = await loadStoredCount(week);
  if (staged > 0) return { status: "already-staged", staged };

  if (!importerRuntimeSupported(deps.env ?? process.env)) {
    return {
      status: "web-not-staged",
      reason:
        `No web inspirations are staged for ${week}, and this runtime cannot run the ` +
        "Kitchen importer. Stage them locally with scripts/prepare-weekly-shelf.mjs, " +
        "then re-run preparation.",
    };
  }

  return ensureWeeklyInspirations(week, count, deps);
}
