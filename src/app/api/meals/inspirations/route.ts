/**
 * GET  /api/meals/inspirations?week=<ISO-week>
 * POST /api/meals/inspirations with { week, count }
 *
 * GET:  Return stored web inspirations for the given week as planner candidate cards.
 * POST: Trigger Kitchen importer (if configured), then return the result.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getWebInspirationsForWeek,
  recordWebInspiration,
  getMyRecipe,
} from "@/lib/db";
import { getRecentWeekIds } from "@/lib/meals";
import { loadMealPlan } from "@/lib/meals-persistence";
import type { Recipe } from "@/lib/recipes";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const NON_MAIN_ROLES = new Set(["component", "base", "condiment", "garnish", "drink", "beverage", "breakfast", "snack", "dessert", "side"]);
const NON_MAIN_DISH_TYPES = new Set(["condiment", "dessert", "side", "component", "base", "garnish", "sauce", "dressing", "drink", "beverage", "breakfast", "snack"]);

const execFileAsync = promisify(execFile);

type ImporterExecError = Error & {
  stdout?: string;
  stderr?: string;
};

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
};

function currentIsoWeekId(date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function inferMealRole(recipe: Recipe): string {
  const role = (recipe as Record<string, unknown>).mealRole as string | undefined
    ?? recipe.category?.meal_role;
  if (role) return role;
  const name = recipe.name?.toLowerCase() ?? "";
  if (/chutney|pickle|relish|raita|salsa/.test(name)) return "condiment";
  if (/shrikhand|dessert|cake|pie|pudding|mousse|sorbet|ice cream/.test(name)) return "dessert";
  return "main";
}

function isMainPlannerCandidate(recipe: Recipe): boolean {
  const role = inferMealRole(recipe).toLowerCase();
  if (NON_MAIN_ROLES.has(role)) return false;
  const dishTypes = recipe.category?.dish_type?.map((type) => type.toLowerCase()) ?? [];
  if (dishTypes.some((type) => NON_MAIN_DISH_TYPES.has(type))) return false;
  return true;
}

function recipeToCandidate(recipe: Recipe, provenance: { source_url: string; source_name: string }): RecipeOption {
  return {
    id: recipe.id,
    name: recipe.name,
    source: {
      cookbook: recipe.source?.cookbook || "My Recipes",
      author: recipe.source?.author || provenance.source_name,
      chapter: recipe.source?.chapter,
      publication: `${provenance.source_name} · Web inspiration`,
    },
    image: recipe.image ?? null,
    dietary: recipe.dietary ?? [],
    cuisine: Array.isArray(recipe.cuisine) ? recipe.cuisine[0] ?? "" : recipe.cuisine ?? "",
    time: recipe.time ?? {},
    category: recipe.category?.dish_type?.[0] ?? "main",
    courseTags: recipe.category?.dish_type ?? ["main"],
  };
}

function stripCommandPrefix(message: string): string {
  return message
    .replace(/^Command failed:[^\n]*(?:\n|$)/, "")
    .trim();
}

function summarizeImporterReport(stdout?: string): { message?: string; report?: unknown } {
  if (!stdout?.trim()) return {};
  try {
    const report = JSON.parse(stdout) as {
      imported?: unknown[];
      errors?: { message?: string; url?: string }[];
      skipped?: { reason?: string; name?: string; url?: string }[];
    };
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
    Math.max(1, Number(searchParams.get("count")) || 6),
    12,
  );

  try {
    const inspirations = await getWebInspirationsForWeek(week);
    const candidates: RecipeOption[] = [];

    for (const insp of inspirations) {
      if (candidates.length >= limit) break;
      const recipe = await getMyRecipe(insp.recipe_id);
      if (recipe && isMainPlannerCandidate(recipe)) {
        candidates.push(recipeToCandidate(recipe, {
          source_url: insp.source_url,
          source_name: insp.source_name,
        }));
      }
    }

    return NextResponse.json({ week, candidates });
  } catch (error) {
    console.error("Failed to fetch web inspirations:", error);
    return NextResponse.json(
      { error: "Failed to fetch web inspirations" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  let body: { week?: string; count?: number } = {};
  try {
    body = await request.json();
  } catch {
    // Body parse failed; use defaults
  }

  const week = body.week ?? currentIsoWeekId();
  const count = body.count ?? 6;

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

  // Use configured importer or fall back to vendored kitchen importer script.
  // Over-request from the importer because the API applies additional filtering
  // (recent-week duplicates, non-main checks) that the importer cannot know
  // about. This way we're far more likely to end up with `count` candidates
  // after post-import filtering instead of a surprising short list.
  const importerCount = Math.min(count * 3, 12);
  const customCommand = process.env.KITCHEN_INSPIRATION_IMPORTER_COMMAND;
  const scriptPath = `${process.cwd()}/scripts/weekly-inspirations.mjs`;
  const importerArgs = ["--week", week, "--count", String(importerCount), "--write-app-files", "--write-app-db", "--yes", "--json"];

  // Run the Kitchen importer. It may exit nonzero (code 1) even when it
  // produces a valid JSON report on stdout (e.g. 0 imported, N skipped).
  // We parse stdout from the exec error in that case and continue with
  // the stored-week top-up path instead of returning 500.
  let report: { imported?: { id: string; url: string; source: string }[]; errors?: { message?: string; url?: string }[]; skipped?: { reason?: string; name?: string; url?: string }[] };
  let importerStderr: string | undefined;

  try {
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

    const { stdout, stderr } = customCommand
      ? await execFileAsync(customCommand.split(" ")[0], [...customCommand.split(" ").slice(1), ...importerArgs], execOpts)
      : await execFileAsync(process.execPath, [scriptPath, ...importerArgs], execOpts);

    if (stderr && !stderr.includes("warning")) {
      console.error("Kitchen importer stderr:", stderr);
    }
    importerStderr = stderr;

    report = JSON.parse(stdout);
  } catch (error) {
    // The importer may print a valid JSON report to stdout and still exit 1
    // (e.g. 0 imported, all skipped). Try to recover the report from stdout.
    let recoveredReport: typeof report | undefined;
    if (error instanceof Error) {
      const execError = error as ImporterExecError;
      importerStderr = execError.stderr;
      if (execError.stdout?.trim()) {
        try {
          recoveredReport = JSON.parse(execError.stdout);
        } catch {
          // stdout was not valid JSON — genuine failure
        }
      }
    }

    if (recoveredReport) {
      // We have a structured report despite nonzero exit — continue with it
      console.warn("Kitchen importer exited nonzero but produced a valid report; continuing with top-up path");
      report = recoveredReport;
    } else {
      // Genuine failure: no parseable report. Try stored top-up as last resort.
      console.error("Kitchen importer failed:", error);
      try {
        const storedInspirations = await getWebInspirationsForWeek(week);
        const recentWeeks = getRecentWeekIds(week, 4);
        const priorWeeks = recentWeeks.filter((w) => w !== week);
        const priorInspirations = await Promise.all(priorWeeks.map((w) => getWebInspirationsForWeek(w)));
        const recentRecipeIds = new Set<string>();
        const recentSourceUrls = new Set<string>();
        for (const weekInsps of priorInspirations) {
          for (const insp of weekInsps) {
            recentRecipeIds.add(insp.recipe_id);
            if (insp.source_url) recentSourceUrls.add(insp.source_url);
          }
        }

        const fallbackCandidates: RecipeOption[] = [];
        for (const insp of storedInspirations) {
          if (fallbackCandidates.length >= count) break;
          if (recentRecipeIds.has(insp.recipe_id) || (insp.source_url && recentSourceUrls.has(insp.source_url))) continue;
          const recipe = await getMyRecipe(insp.recipe_id);
          if (recipe && isMainPlannerCandidate(recipe)) {
            fallbackCandidates.push(recipeToCandidate(recipe, {
              source_url: insp.source_url,
              source_name: insp.source_name,
            }));
          }
        }

        if (fallbackCandidates.length > 0) {
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
      let stderrDetail: string | undefined;
      if (error instanceof Error) {
        message = stripCommandPrefix(error.message) || "Importer command failed";
        stderrDetail = (error as ImporterExecError).stderr;
      }
      return NextResponse.json(
        {
          error: `Kitchen importer failed: ${message}`,
          week,
          candidates: [],
          ...(stderrDetail ? { detail: stderrDetail.slice(0, 2000) } : {}),
        },
        { status: 500 }
      );
    }
  }

  // From here on we have a valid `report` — either from a clean exit or
  // recovered from a nonzero exit with parseable stdout.
  try {
    // Build a set of recipe_id and source_url used in the current week
    // AND recent prior weeks so clicking "Research Web Ideas" cannot just
    // re-return the same ideas already shown this week.
    const recentWeeks = getRecentWeekIds(week, 4);
    const allWeeks = [week, ...recentWeeks.filter((w) => w !== week)];
    const recentInspirations = await Promise.all(
      allWeeks.map((w) => getWebInspirationsForWeek(w)),
    );
    const currentRecipeIds = new Set<string>();
    const currentSourceUrls = new Set<string>();
    const recentRecipeIds = new Set<string>();
    const recentSourceUrls = new Set<string>();
    for (let i = 0; i < recentInspirations.length; i++) {
      const weekInsps = recentInspirations[i];
      const isCurrentWeek = i === 0;
      for (const insp of weekInsps) {
        if (isCurrentWeek) {
          currentRecipeIds.add(insp.recipe_id);
          if (insp.source_url) currentSourceUrls.add(insp.source_url);
        } else {
          recentRecipeIds.add(insp.recipe_id);
          if (insp.source_url) recentSourceUrls.add(insp.source_url);
        }
      }
    }

    // Fetch the imported My Recipes rows and build candidate cards. A web
    // idea is never returned to the planner unless the importer wrote it to
    // the app DB, so quick view/detail resolution stays normal.
    const candidates: RecipeOption[] = [];
    const missingMyRecipeIds: string[] = [];
    const skippedDuplicates: string[] = [];
    const skippedNonMain: string[] = [];
    for (const imported of (report.imported ?? [])) {
      // Skip if this recipe or URL was already used in recent weeks
      if (recentRecipeIds.has(imported.id) || recentSourceUrls.has(imported.url) || currentRecipeIds.has(imported.id) || currentSourceUrls.has(imported.url)) {
        skippedDuplicates.push(imported.id);
        continue;
      }
      const recipe = await getMyRecipe(imported.id);
      if (recipe) {
        if (!isMainPlannerCandidate(recipe)) {
          skippedNonMain.push(imported.id);
          continue;
        }
        await recordWebInspiration(imported.id, week, imported.url, imported.source);
        currentRecipeIds.add(imported.id);
        if (imported.url) currentSourceUrls.add(imported.url);
        candidates.push(recipeToCandidate(recipe, {
          source_url: imported.url,
          source_name: imported.source,
        }));
      } else {
        missingMyRecipeIds.push(imported.id);
      }
    }

    // If the importer ran out of fresh/new URLs after filtering, top up with
    // older stored inspirations that are still valid main candidates and not
    // already in the recent/current provenance set. This keeps the UI contract
    // stable: Research Web Ideas should return up to the requested count, not
    // a surprising short list because some newly imported pages were sides or
    // duplicate source URLs.
    if (candidates.length < count) {
      const storedInspirations = await getWebInspirationsForWeek(week);
      for (const insp of storedInspirations) {
        if (candidates.length >= count) break;
        // Current-week stored ideas are allowed here as top-ups: they are
        // exactly what David is already looking at. We only exclude prior-week
        // repeats and already-returned cards.
        if (recentRecipeIds.has(insp.recipe_id) || (insp.source_url && recentSourceUrls.has(insp.source_url))) continue;
        if (candidates.some((c) => c.id === insp.recipe_id)) continue;
        const recipe = await getMyRecipe(insp.recipe_id);
        if (recipe && isMainPlannerCandidate(recipe)) {
          candidates.push(recipeToCandidate(recipe, {
            source_url: insp.source_url,
            source_name: insp.source_name,
          }));
        }
      }
    }

    const returnedCandidates = candidates.slice(0, count);
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
