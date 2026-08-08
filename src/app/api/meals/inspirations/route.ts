/**
 * GET  /api/meals/inspirations?week=<ISO-week>[&ensure=0]
 * POST /api/meals/inspirations with { week, count }
 *
 * GET:  Return stored web inspirations for the given week as planner candidate
 *       cards. For a fresh current/future week with no stored set, first
 *       ensures the FOOBY-led weekly set automatically (idempotent via a
 *       DB-level claim; `ensure=0` opts out for read-only verification).
 * POST: Trigger Kitchen importer (if configured), then return the result.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { evaluatePlannerWriteAccess } from "@/lib/access";
import { getWebInspirationsForWeek, getMyRecipe, getStagedWebRecipes } from "@/lib/db";
import { currentIsoWeekId, normalizePlannerCuisine, normalizePlannerTitle } from "@/lib/meals";
import { classifyPlannerRole } from "@/lib/planner-roles";
import { visibleCapForSource } from "@/lib/planner-sources";
import { loadMealPlan } from "@/lib/meals-persistence";
import {
  DEFAULT_WEB_INSPIRATION_COUNT,
  IMPORTER_UNSUPPORTED_MESSAGE,
  getInspirationExclusionIds,
  getInspirationProvenanceSets,
  importerRuntimeSupported,
  recordEligibleImports,
  resolveWebInspirations,
  runInspirationImporter,
  shouldAutoEnsureWeeklyInspirations,
  type ImporterExecError,
  type ImporterReport,
} from "@/lib/meal-inspirations";
import type { Recipe } from "@/lib/recipes";

type RecipeOption = {
  id: string;
  name: string;
  source?: { cookbook: string; author: string; chapter?: string; publication?: string };
  image?: string | null;
  dietary: string[];
  cuisine: string;
  time: { prep?: number; cook?: number; total?: number };
  category: string;
  courseTags: string[];
  /** Always "web" here — these cards expose Keep and show their publication. */
  origin: "web";
  /** Editor-curated surface vs targeted-search fallback. Shown, never implied. */
  discovery: "editorial" | "search";
  /** `pairing` ideas are serve-with suggestions, not dinner mains. */
  role: "main" | "light-meal" | "pairing";
  /** Reversible Keep state, persisted across reloads. */
  kept: boolean;
  sourceName: string;
};

function recipeToCandidate(
  recipe: Recipe,
  provenance: { source_url: string; source_name: string; discovery?: string | null; kept?: boolean },
): RecipeOption {
  const role = classifyPlannerRole(recipe);
  return {
    id: recipe.id,
    name: normalizePlannerTitle(recipe.name) || recipe.name,
    origin: "web",
    discovery: provenance.discovery === "editorial" ? "editorial" : "search",
    role: role.role === "reject" ? "pairing" : role.role,
    kept: Boolean(provenance.kept),
    sourceName: provenance.source_name,
    source: {
      cookbook: recipe.source?.cookbook || "My Recipes",
      author: recipe.source?.author || provenance.source_name,
      chapter: recipe.source?.chapter,
      publication: `${provenance.source_name} · Web inspiration`,
    },
    image: recipe.image ?? null,
    dietary: recipe.dietary ?? [],
    cuisine: normalizePlannerCuisine(recipe),
    time: recipe.time ?? {},
    category: recipe.category?.dish_type?.[0] ?? "main",
    courseTags: recipe.category?.dish_type ?? ["main"],
  };
}

function balanceBySource(candidates: RecipeOption[]): RecipeOption[] {
  if (candidates.length <= 1) return candidates;
  const bySource = new Map<string, RecipeOption[]>();
  for (const c of candidates) {
    const key = c.sourceName || c.source?.publication || c.source?.cookbook || "unknown";
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key)!.push(c);
  }
  const result: RecipeOption[] = [];
  const buckets = [...bySource.values()].map((arr) => ({ arr, idx: 0 }));
  let progress = true;
  while (progress) {
    progress = false;
    for (const b of buckets) {
      if (b.idx < b.arr.length) {
        result.push(b.arr[b.idx++]);
        progress = true;
      }
    }
  }
  return result;
}

/**
 * Apply the Kitchen registry's per-source visible caps.
 *
 * This replaces `selectFoobyLedMix`, which *targeted* six FOOBY ideas out of
 * nine and topped up from elsewhere only afterwards. A cap is a ceiling: FOOBY
 * contributes at most three, most other sources at most two, and a weak week
 * simply yields fewer web ideas rather than being padded to a quota.
 */
function applySourceCaps(candidates: RecipeOption[], count: number): RecipeOption[] {
  const used = new Map<string, number>();
  const selected: RecipeOption[] = [];
  for (const candidate of balanceBySource(candidates)) {
    if (selected.length >= count) break;
    const key = candidate.sourceName || candidate.source?.cookbook || "unknown";
    const cap = visibleCapForSource(key);
    const soFar = used.get(key) ?? 0;
    if (soFar >= cap) continue;
    used.set(key, soFar + 1);
    selected.push(candidate);
  }
  return selected;
}

function stripCommandPrefix(message: string): string {
  return message
    .replace(/^Command failed:[^\n]*(?:\n|$)/, "")
    .trim();
}

function summarizeImporterReport(stdout?: string): { message?: string; report?: unknown } {
  if (!stdout?.trim()) return {};
  try {
    const report = JSON.parse(stdout) as ImporterReport;
    const firstError = report.errors?.find((err) => err?.message);
    if (firstError?.message) {
      return { message: firstError.message, report };
    }
    const importedCount = report.imported?.length ?? 0;
    const skippedCount = report.skipped?.length ?? 0;
    return {
      message: `Importer exited without importing recipes (${importedCount} imported, ${skippedCount} skipped)`,
      report,
    };
  } catch {
    return {};
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const week = searchParams.get("week") ?? currentIsoWeekId();
  const limit = Math.min(
    Math.max(1, Number(searchParams.get("count")) || DEFAULT_WEB_INSPIRATION_COUNT),
    12,
  );

  try {
    let inspirations = await getWebInspirationsForWeek(week);

    // Fresh current/future week: ensure the FOOBY-led weekly set once,
    // automatically. The ensure claims a DB row and may run the importer —
    // writes, so only the canonical authorized session triggers it; anonymous
    // and tracker-only requests read stored rows only. The claim keeps
    // concurrent loads from double-running the importer; `ensure=0` keeps
    // read-only verification side-effect free.
    if (
      shouldAutoEnsureWeeklyInspirations({
        week,
        storedCount: inspirations.length,
        ensureParam: searchParams.get("ensure"),
        authorizedForEnsure: evaluatePlannerWriteAccess(await auth()).allowed,
      })
    ) {
      // `resolveWebInspirations`, not `ensureWeeklyInspirations`: on Vercel
      // there is no importer to run, and it says so without burning the claim.
      const ensured = await resolveWebInspirations(week);
      if (ensured.status === "failed") {
        console.error(`Weekly inspiration ensure failed for ${week}:`, ensured.error);
      }
      if (ensured.status === "web-not-staged") {
        console.warn(`No web inspirations staged for ${week}: ${ensured.reason}`);
      }
      if (ensured.status === "succeeded") {
        inspirations = await getWebInspirationsForWeek(week);
      }
    }

    const exclusionIds = await getInspirationExclusionIds(week);
    // Keep state and discovery mode come from the staging rows, so a reload
    // renders exactly the Keep David last chose.
    const keepState = new Map(
      (await getStagedWebRecipes([week])).map((record) => [record.recipeId, record]),
    );
    const candidates: RecipeOption[] = [];
    const pairings: RecipeOption[] = [];

    for (const insp of inspirations) {
      if (candidates.length >= limit) break;
      if (exclusionIds.has(insp.recipe_id)) continue;
      const recipe = await getMyRecipe(insp.recipe_id);
      if (!recipe) continue;
      const role = classifyPlannerRole(recipe);
      if (role.role === "reject") continue;
      const card = recipeToCandidate(recipe, {
        source_url: insp.source_url,
        source_name: insp.source_name,
        discovery: keepState.get(insp.recipe_id)?.discovery ?? null,
        kept: Boolean(keepState.get(insp.recipe_id)?.keptAt),
      });
      // A pairing is returned separately so no caller can mistake a featured
      // seasonal salad for a dinner main.
      if (role.role === "pairing") pairings.push(card);
      else candidates.push(card);
    }

    return NextResponse.json({ week, candidates: applySourceCaps(candidates, limit), pairings });
  } catch (error) {
    console.error("Failed to fetch web inspirations:", error);
    return NextResponse.json(
      { error: "Failed to fetch web inspirations" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const access = evaluatePlannerWriteAccess(await auth());
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  let body: { week?: string; count?: number } = {};
  try {
    body = await request.json();
  } catch {
    // Body parse failed; use defaults
  }

  const week = body.week ?? currentIsoWeekId();
  const count = body.count ?? DEFAULT_WEB_INSPIRATION_COUNT;

  // "Research Web Ideas" runs the Kitchen importer as a child process. That is
  // genuinely supported locally and genuinely impossible on Vercel, so the
  // deployed app refuses it in as many words instead of shelling out and
  // reporting the resulting emptiness as "the importer found no new recipes".
  if (!importerRuntimeSupported()) {
    return NextResponse.json(
      { error: IMPORTER_UNSUPPORTED_MESSAGE, status: "importer-unavailable", week, candidates: [] },
      { status: 503 },
    );
  }

  // Validate week/count to prevent argument injection
  if (typeof week !== "string" || !/^\d{4}-W\d{2}$/.test(week)) {
    return NextResponse.json({ error: "Invalid week format (expected YYYY-Wnn)" }, { status: 400 });
  }
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 12) {
    return NextResponse.json({ error: "Invalid count (expected 1-12)" }, { status: 400 });
  }

  // Reject if the target week plan is locked
  const weekPlan = await loadMealPlan(week);
  if (weekPlan?.locked) {
    return NextResponse.json(
      { error: "Plan is locked", locked: true },
      { status: 409 },
    );
  }
  const plannerExclusionIds = await getInspirationExclusionIds(week);

  // Run the Kitchen importer. Over-request because the API applies additional
  // filtering (recent-week duplicates, non-main checks) that the importer
  // cannot know about — this way we're far more likely to end up with `count`
  // candidates after post-import filtering instead of a surprising short list.
  const importerCount = Math.min(count * 3, 12);
  let report: ImporterReport;
  let importerStderr: string | undefined;

  try {
    const run = await runInspirationImporter(week, importerCount);
    report = run.report;
    importerStderr = run.stderr;
  } catch (error) {
    // Genuine failure: no parseable report. Try stored top-up as last resort.
    console.error("Kitchen importer failed:", error);
    if (error instanceof Error) {
      importerStderr = (error as ImporterExecError).stderr;
    }
    try {
      const storedInspirations = await getWebInspirationsForWeek(week);
      const provenance = await getInspirationProvenanceSets(week);

      const fallbackPool: RecipeOption[] = [];
      for (const insp of storedInspirations) {
        if (plannerExclusionIds.has(insp.recipe_id)) continue;
        if (provenance.recentRecipeIds.has(insp.recipe_id) || (insp.source_url && provenance.recentSourceUrls.has(insp.source_url))) continue;
        const recipe = await getMyRecipe(insp.recipe_id);
        if (recipe && classifyPlannerRole(recipe).role !== "reject") {
          fallbackPool.push(recipeToCandidate(recipe, {
            source_url: insp.source_url,
            source_name: insp.source_name,
          }));
        }
      }

      if (fallbackPool.length > 0) {
        const fallbackCandidates = applySourceCaps(fallbackPool, count);
        return NextResponse.json({
          week,
          candidates: fallbackCandidates,
          warning: "Importer failed; returning stored inspirations as fallback",
        });
      }
    } catch (topUpError) {
      console.error("Stored top-up also failed:", topUpError);
    }

    let message = "Unknown error";
    if (error instanceof Error) {
      message = stripCommandPrefix(error.message) || "Importer command failed";
    }
    return NextResponse.json(
      {
        error: `Kitchen importer failed: ${message}`,
        week,
        candidates: [],
        ...(importerStderr ? { detail: importerStderr.slice(0, 2000) } : {}),
      },
      { status: 500 }
    );
  }

  // From here on we have a valid `report` — either from a clean exit or
  // recovered from a nonzero exit with parseable stdout.
  try {
    // Recipe ids/URLs used in the current week AND recent prior weeks, so
    // clicking "Research Web Ideas" cannot just re-return the same ideas
    // already shown this week.
    const provenance = await getInspirationProvenanceSets(week);

    // Filter the report and record provenance for accepted imports. A web
    // idea is never returned to the planner unless the importer wrote it to
    // the app DB, so quick view/detail resolution stays normal.
    const recorded = await recordEligibleImports(week, report, plannerExclusionIds, provenance);
    const candidates: RecipeOption[] = recorded.accepted.map(({ recipe, url, source, discovery }) =>
      recipeToCandidate(recipe, { source_url: url, source_name: source, discovery }),
    );
    const pairings: RecipeOption[] = recorded.pairings.map(({ recipe, url, source, discovery }) =>
      recipeToCandidate(recipe, { source_url: url, source_name: source, discovery }),
    );
    const { skippedDuplicates, skippedNonMain, missingMyRecipeIds } = recorded;

    // If the importer ran out of fresh/new URLs after filtering, top up with
    // older stored inspirations that are still valid main candidates and not
    // already in the recent/current provenance set. This keeps the UI contract
    // stable: Research Web Ideas should return up to the requested count, not
    // a surprising short list because some newly imported pages were sides or
    // duplicate source URLs.
    if (candidates.length < count) {
      const storedInspirations = await getWebInspirationsForWeek(week);
      // Gather ALL eligible stored rows so balanceBySource can diversify
      // across sources before we trim to count. Without this, imported_at
      // DESC ordering causes the newest source to fill every slot.
      const topUpPool: RecipeOption[] = [];
      for (const insp of storedInspirations) {
        // Current-week stored ideas are allowed here as top-ups: they are
        // exactly what David is already looking at. We only exclude prior-week
        // repeats and already-returned cards.
        if (plannerExclusionIds.has(insp.recipe_id)) continue;
        if (provenance.recentRecipeIds.has(insp.recipe_id) || (insp.source_url && provenance.recentSourceUrls.has(insp.source_url))) continue;
        if (candidates.some((c) => c.id === insp.recipe_id)) continue;
        const recipe = await getMyRecipe(insp.recipe_id);
        if (recipe && classifyPlannerRole(recipe).role !== "reject") {
          topUpPool.push(recipeToCandidate(recipe, {
            source_url: insp.source_url,
            source_name: insp.source_name,
          }));
        }
      }
      const slotsNeeded = count - candidates.length;
      const balancedTopUps = applySourceCaps(topUpPool, slotsNeeded);
      candidates.push(...balancedTopUps.slice(0, slotsNeeded));
    }

    // Preserve David's intended source mix: FOOBY is the primary weekly feed,
    // with a smaller outside-source top-up for variety.
    const returnedCandidates = applySourceCaps(candidates, count);
    const partialResult = returnedCandidates.length > 0 && returnedCandidates.length < count;

    if (returnedCandidates.length === 0 && (!report.imported || report.imported.length === 0)) {
      return NextResponse.json(
        {
          error: "Kitchen importer found no new recipes",
          week,
          candidates: [],
          report,
        },
        { status: 200 }
      );
    }

    // All imported results were recent duplicates
    if (candidates.length === 0 && skippedDuplicates.length > 0) {
      return NextResponse.json(
        {
          error: `All ${skippedDuplicates.length} imported recipe(s) were already used in recent weeks`,
          week,
          candidates: [],
          skippedDuplicates,
          ...(skippedNonMain.length > 0 ? { skippedNonMain } : {}),
          report,
        },
        { status: 200 },
      );
    }

    if (candidates.length === 0 && missingMyRecipeIds.length > 0) {
      return NextResponse.json(
        {
          error: "Kitchen importer staged recipes, but they were not available in My Recipes",
          week,
          candidates: [],
          missingMyRecipeIds,
          report,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      week,
      candidates: returnedCandidates,
      ...(pairings.length > 0 ? { pairings } : {}),
      ...(partialResult ? { warning: `Only ${returnedCandidates.length} fresh main candidate(s) found after filtering importer results` } : {}),
      ...(skippedDuplicates.length > 0 ? { skippedDuplicates } : {}),
      ...(skippedNonMain.length > 0 ? { skippedNonMain } : {}),
      ...(missingMyRecipeIds.length > 0 ? { missingMyRecipeIds } : {}),
      report,
    });
  } catch (error) {
    console.error("Post-import processing failed:", error);
    return NextResponse.json(
      { error: "Failed to process importer results", week, candidates: [] },
      { status: 500 }
    );
  }
}
