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
import type { Recipe } from "@/lib/recipes";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const week = searchParams.get("week") ?? currentIsoWeekId();

  try {
    const inspirations = await getWebInspirationsForWeek(week);
    const candidates: RecipeOption[] = [];

    for (const insp of inspirations) {
      const recipe = await getMyRecipe(insp.recipe_id);
      if (recipe) {
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
  const count = body.count ?? 4;

  // Validate week/count to prevent argument injection
  if (typeof week !== "string" || !/^\d{4}-W\d{2}$/.test(week)) {
    return NextResponse.json({ error: "Invalid week format (expected YYYY-Wnn)" }, { status: 400 });
  }
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 12) {
    return NextResponse.json({ error: "Invalid count (expected 1-12)" }, { status: 400 });
  }

  // Use configured importer or fall back to vendored kitchen importer script
  const customCommand = process.env.KITCHEN_INSPIRATION_IMPORTER_COMMAND;
  const scriptPath = `${process.cwd()}/scripts/weekly-inspirations.mjs`;
  const importerArgs = ["--week", week, "--count", String(count), "--write-app-files", "--write-app-db", "--yes", "--json"];

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
    if (!report.imported || report.imported.length === 0) {
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

    // Fetch the imported recipes and build candidate cards
    const candidates: RecipeOption[] = [];
    for (const imported of report.imported) {
      const recipe = await getMyRecipe(imported.id);
      if (recipe) {
        await recordWebInspiration(imported.id, week, imported.url, imported.source);
        candidates.push(recipeToCandidate(recipe, {
          source_url: imported.url,
          source_name: imported.source,
        }));
      }
    }

    return NextResponse.json({ week, candidates, report });
  } catch (error) {
    console.error("Kitchen importer failed:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: `Kitchen importer failed: ${message}`,
        week,
        candidates: [],
      },
      { status: 500 }
    );
  }
}
