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
  const role = inferMealRole(recipe);
  if (role && role !== "main") return false;
  const dishTypes = recipe.category?.dish_type?.map((type) => type.toLowerCase()) ?? [];
  if (dishTypes.some((type) => ["condiment", "dessert", "side"].includes(type))) {
    return false;
  }
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

  try {
    const inspirations = await getWebInspirationsForWeek(week);
    const candidates: RecipeOption[] = [];

    for (const insp of inspirations) {
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
  const importerCount = Math.min(count * 2, 12);
  const customCommand = process.env.KITCHEN_INSPIRATION_IMPORTER_COMMAND;
  const scriptPath = `${process.cwd()}/scripts/weekly-inspirations.mjs`;
  const importerArgs = ["--week", week, "--count", String(importerCount), "--write-app-files", "--write-app-db", "--yes", "--json"];

  try {
    // Run the Kitchen importer
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

    const report = JSON.parse(stdout);

    // Build a set of recipe_id and source_url used in the current week
    // AND recent prior weeks so clicking "Research Web Ideas" cannot just
    // re-return the same ideas already shown this week.
    const recentWeeks = getRecentWeekIds(week, 4);
    const allWeeks = [week, ...recentWeeks.filter((w) => w !== week)];
    const recentInspirations = await Promise.all(
      allWeeks.map((w) => getWebInspirationsForWeek(w)),
    );
    const recentRecipeIds = new Set<string>();
    const recentSourceUrls = new Set<string>();
    for (const weekInsps of recentInspirations) {
      for (const insp of weekInsps) {
        recentRecipeIds.add(insp.recipe_id);
        if (insp.source_url) recentSourceUrls.add(insp.source_url);
      }
    }

    // Fetch the imported My Recipes rows and build candidate cards. A web
    // idea is never returned to the planner unless the importer wrote it to
    // the app DB, so quick view/detail resolution stays normal.
    const candidates: RecipeOption[] = [];
    const missingMyRecipeIds: string[] = [];
    const skippedDuplicates: string[] = [];
    const skippedNonMain: string[] = [];
    for (const imported of report.imported) {
      // Skip if this recipe or URL was already used in recent weeks
      if (recentRecipeIds.has(imported.id) || recentSourceUrls.has(imported.url)) {
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
    console.error("Kitchen importer failed:", error);
    // Extract useful context without leaking full command paths or env details.
    // The importer may print a JSON report to stdout and still exit 1; prefer
    // that structured error over Node's generic "Command failed: /var/task/...".
    let message = "Unknown error";
    let stderr: string | undefined;
    let report: unknown;
    if (error instanceof Error) {
      const execError = error as ImporterExecError;
      const summary = summarizeImporterReport(execError.stdout);
      message = summary.message ?? (stripCommandPrefix(error.message) || "Importer command failed");
      stderr = execError.stderr;
      report = summary.report;
    }
    return NextResponse.json(
      {
        error: `Kitchen importer failed: ${message}`,
        week,
        candidates: [],
        ...(stderr ? { detail: stderr.slice(0, 2000) } : {}),
        ...(report ? { report } : {}),
      },
      { status: 500 }
    );
  }
}
