/**
 * Recipe-render QA (Kitchen DESIGN.md, "Phase 4E — Recommendation quality and
 * recipe-render QA").
 *
 * One deterministic pass a recipe must survive before it may enter a visible
 * candidate shelf. It answers three questions and keeps them apart:
 *
 *   fixes   — unambiguous *presentation* defects that were repaired in the
 *             returned copy (a stranded metric unit moved from the item name
 *             into `unit`, collapsed whitespace inside one step). Source
 *             wording is preserved; nothing is reworded, reordered, or merged.
 *   issues  — defects that make the record unsafe to recommend. The record is
 *             quarantined and the diagnostics say why, so the source/parser
 *             can be repaired later.
 *   ok      — no issues. Only then may the recipe reach a card.
 *
 * Pure and dependency-free: `node --test` loads it directly, and nothing here
 * touches the recipe on disk or in the database.
 */

import type { Ingredient, Recipe } from "./recipes";

export type RecipeQaIssue = {
  field: "ingredients" | "method" | "image" | "time" | "role" | "name";
  code: string;
  message: string;
};

export type RecipeQaFix = {
  field: "ingredients" | "method";
  code: string;
  message: string;
};

export type RecipeQaResult = {
  ok: boolean;
  recipe: Recipe;
  fixes: RecipeQaFix[];
  issues: RecipeQaIssue[];
};

/** Recognised trailing metric units that may be stranded in an item name. */
const STRANDED_UNIT_RE = /^(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l|dl|cl)\b\.?\s+(.+)$/i;
const AMOUNT_ONLY_RE = /^\s*(\d+(?:[.,]\d+)?|[¼½¾⅓⅔⅛]|\d+\s*[¼½¾⅓⅔⅛]|\d+\s*[-–]\s*\d+)\s*$/;
const UNIT_ALREADY_RE = /\b(g|kg|ml|l|dl|cl|tsp|tbsp|cups?|oz|lb)\b/i;
const METRIC_UNIT_SUFFIX_RE = /^(g|kg|ml|l|dl|cl)\b\.?\s*(.*)$/i;

/** Longest step (chars) before it is suspected of being several merged steps. */
export const MAX_STEP_CHARS = 1400;
/** Shortest step (chars) that still reads as an instruction. */
export const MIN_STEP_CHARS = 12;
/** Total-time bounds within which a planner time claim is credible. */
export const MIN_PLAUSIBLE_TOTAL_MINUTES = 10;
export const MAX_PLAUSIBLE_TOTAL_MINUTES = 12 * 60;

function collapseWhitespace(text: string): string {
  return text.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, " ").trim();
}

/**
 * Normalize one ingredient line. Only the unambiguous shapes are touched:
 *
 *   amount "200", item "g flour"        → amount "200", unit "g", item "flour"
 *   amount "",    item "200 g flour"    → amount "200", unit "g", item "flour"
 *   amount "200", unit "", item "g"     → left alone and reported: no item
 *
 * Anything else — ranges, approximations, imperial, a unit that would leave
 * the item empty — is left exactly as it was.
 */
export function normalizeIngredientUnits(ingredient: Ingredient): { ingredient: Ingredient; fix: RecipeQaFix | null } {
  const item = String(ingredient.item ?? "");
  const amount = String(ingredient.amount ?? "").trim();
  const unit = String(ingredient.unit ?? "").trim();

  if (unit) return { ingredient, fix: null };

  // Case A: the amount is a bare number and the item starts with the unit.
  if (amount && AMOUNT_ONLY_RE.test(amount) && !UNIT_ALREADY_RE.test(amount)) {
    const m = item.trim().match(METRIC_UNIT_SUFFIX_RE);
    if (m && m[2].trim().length > 0) {
      const foundUnit = m[1].toLowerCase() === "l" ? "l" : m[1].toLowerCase();
      return {
        ingredient: { ...ingredient, amount, unit: foundUnit, item: m[2].trim() },
        fix: {
          field: "ingredients",
          code: "stranded-unit",
          message: `moved "${m[1]}" from the item name into unit for "${m[2].trim()}"`,
        },
      };
    }
  }

  // Case B: no amount at all, and the item carries "<number> <unit> <name>".
  if (!amount) {
    const m = item.trim().match(STRANDED_UNIT_RE);
    if (m && m[3].trim().length > 0) {
      return {
        ingredient: { ...ingredient, amount: m[1], unit: m[2].toLowerCase(), item: m[3].trim() },
        fix: {
          field: "ingredients",
          code: "stranded-amount-unit",
          message: `moved "${m[1]} ${m[2]}" out of the item name for "${m[3].trim()}"`,
        },
      };
    }
  }

  return { ingredient, fix: null };
}

/**
 * Render an ingredient for a card: number and unit together, then the item.
 * Wording of the item is never altered here.
 */
export function renderIngredientLine(ingredient: Ingredient): string {
  const amount = String(ingredient.amount ?? "").trim();
  const unit = String(ingredient.unit ?? "").trim();
  const item = String(ingredient.item ?? "").trim();
  const quantity = [amount, unit].filter(Boolean).join(" ");
  return [quantity, item].filter(Boolean).join(" ");
}

function isFragment(step: string): boolean {
  const trimmed = step.trim();
  if (trimmed.length < MIN_STEP_CHARS) return true;
  // A step that is just a heading-like fragment ("For the sauce", "Step 2").
  if (/^(step\s*\d+|for the [a-z ]+|method|instructions)[:.]?$/i.test(trimmed)) return true;
  // No verb-ish content: fewer than three words.
  if (trimmed.split(/\s+/).length < 3) return true;
  return false;
}

/** Ends mid-word or mid-clause: a dangling connector or no terminal punctuation after a lowercase word. */
function looksBadlySplit(step: string, next: string | undefined): boolean {
  const trimmed = step.trim();
  if (/[,;:]$/.test(trimmed)) return true;
  if (/\b(and|or|with|the|a|an|to|of|until|then)$/i.test(trimmed)) return true;
  if (next && /^[a-z]/.test(next.trim()) && !/[.!?)]$/.test(trimmed)) return true;
  return false;
}

/**
 * Validate the method. Whitespace and line breaks *inside* a step are
 * collapsed; steps are never joined, split, reordered, or reworded.
 */
export function qaMethodSteps(method: readonly string[] | undefined): {
  method: string[];
  fixes: RecipeQaFix[];
  issues: RecipeQaIssue[];
} {
  const fixes: RecipeQaFix[] = [];
  const issues: RecipeQaIssue[] = [];
  const steps = Array.isArray(method) ? method.map((s) => String(s ?? "")) : [];

  if (steps.length === 0) {
    issues.push({ field: "method", code: "no-steps", message: "method has no steps" });
    return { method: steps, fixes, issues };
  }

  const cleaned: string[] = [];
  for (const step of steps) {
    const collapsed = collapseWhitespace(step);
    if (collapsed !== step) {
      fixes.push({ field: "method", code: "whitespace", message: "collapsed line breaks inside one step" });
    }
    cleaned.push(collapsed);
  }

  const seen = new Set<string>();
  cleaned.forEach((step, index) => {
    if (!step) {
      issues.push({ field: "method", code: "empty-step", message: `step ${index + 1} is empty` });
      return;
    }
    if (isFragment(step)) {
      issues.push({ field: "method", code: "fragment", message: `step ${index + 1} is a fragment: "${step}"` });
    }
    if (step.length > MAX_STEP_CHARS) {
      issues.push({ field: "method", code: "oversized-step", message: `step ${index + 1} is ${step.length} characters and may contain several merged instructions` });
    }
    const key = step.toLowerCase();
    if (seen.has(key)) {
      issues.push({ field: "method", code: "duplicate-step", message: `step ${index + 1} repeats an earlier step` });
    }
    seen.add(key);
    if (looksBadlySplit(step, cleaned[index + 1])) {
      issues.push({ field: "method", code: "badly-split", message: `step ${index + 1} ends mid-sentence: "…${step.slice(-40)}"` });
    }
  });

  return { method: cleaned, fixes, issues };
}

function minutes(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/**
 * Is the stated total credible for what the method asks? A "3-minute" braise
 * is a parser defect, not a quick dinner. Returns the issue, or null.
 */
export function qaTimePlausibility(recipe: Pick<Recipe, "time" | "method" | "ingredients">): RecipeQaIssue | null {
  const total = minutes(recipe.time?.total) || minutes(recipe.time?.prep) + minutes(recipe.time?.cook);
  if (total <= 0) return null; // unknown is allowed; it simply never becomes "quick"
  if (total < MIN_PLAUSIBLE_TOTAL_MINUTES) {
    return { field: "time", code: "implausibly-short", message: `total time of ${total} minutes is not credible for a cooked dinner` };
  }
  if (total > MAX_PLAUSIBLE_TOTAL_MINUTES) {
    return { field: "time", code: "implausibly-long", message: `total time of ${total} minutes exceeds ${MAX_PLAUSIBLE_TOTAL_MINUTES}` };
  }
  const stepCount = (recipe.method ?? []).length;
  const ingredientCount = (recipe.ingredients ?? []).length;
  // Under 15 minutes with a long method or many ingredients is a parse error.
  if (total < 15 && (stepCount >= 5 || ingredientCount >= 10)) {
    return { field: "time", code: "time-method-mismatch", message: `total time of ${total} minutes does not fit ${stepCount} steps and ${ingredientCount} ingredients` };
  }
  return null;
}

/** Roles that can sit in a dinner slot. Mirrors `planner-roles` without importing it. */
export function isDinnerCapableRole(role: string | null | undefined): boolean {
  return role === "main" || role === "light-meal";
}

export type RecipeQaOptions = {
  /** Planner role, when the caller has already classified the recipe. */
  role?: string | null;
  /** Whether the shelf requires an image. Defaults to true. */
  requireImage?: boolean;
};

/**
 * Run the full pass. The returned `recipe` is a normalized *copy*; the input
 * is never mutated.
 */
export function qaRecipeForShelf(recipe: Recipe, options: RecipeQaOptions = {}): RecipeQaResult {
  const fixes: RecipeQaFix[] = [];
  const issues: RecipeQaIssue[] = [];

  if (!recipe.name || !String(recipe.name).trim()) {
    issues.push({ field: "name", code: "missing-name", message: "recipe has no name" });
  }

  if ((options.requireImage ?? true) && !recipe.image) {
    issues.push({ field: "image", code: "missing-image", message: "recipe has no usable image" });
  }

  if (options.role !== undefined && !isDinnerCapableRole(options.role)) {
    issues.push({ field: "role", code: "not-dinner-capable", message: `role ${options.role ?? "unknown"} cannot occupy a dinner slot` });
  }

  const ingredients: Ingredient[] = [];
  const source = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  if (source.length < 3) {
    issues.push({ field: "ingredients", code: "too-few", message: `only ${source.length} ingredient line(s)` });
  }
  source.forEach((raw, index) => {
    const normalized = normalizeIngredientUnits({
      ...raw,
      item: String(raw?.item ?? ""),
      amount: String(raw?.amount ?? ""),
    });
    if (normalized.fix) fixes.push(normalized.fix);
    const ing = normalized.ingredient;
    const item = ing.item.trim();
    if (!item) {
      issues.push({ field: "ingredients", code: "empty-item", message: `ingredient ${index + 1} has no item name` });
    } else if (/^(g|kg|ml|l|dl|cl)\b/i.test(item) && ing.amount.trim() && !ing.unit) {
      // An amount is present but the unit is still in the name and the name
      // would be empty without it — ambiguous, so it is reported, not fixed.
      issues.push({ field: "ingredients", code: "unit-in-item", message: `ingredient ${index + 1} "${item}" carries its unit in the item name` });
    } else if (item.length > 160) {
      issues.push({ field: "ingredients", code: "unreadable", message: `ingredient ${index + 1} is ${item.length} characters long` });
    }
    ingredients.push(ing);
  });

  const method = qaMethodSteps(recipe.method);
  fixes.push(...method.fixes);
  issues.push(...method.issues);

  const time = qaTimePlausibility(recipe);
  if (time) issues.push(time);

  return {
    ok: issues.length === 0,
    recipe: { ...recipe, ingredients, method: method.method },
    fixes,
    issues,
  };
}

/** Compact diagnostics shape persisted alongside a shelf. */
export type RecipeQaDiagnostic = {
  recipeId: string;
  recipeName: string;
  issues: string[];
  fixes: string[];
};

export function summarizeQa(recipe: Pick<Recipe, "id" | "name">, result: RecipeQaResult): RecipeQaDiagnostic {
  return {
    recipeId: recipe.id,
    recipeName: recipe.name,
    issues: result.issues.map((issue) => `${issue.field}/${issue.code}: ${issue.message}`),
    fixes: result.fixes.map((fix) => `${fix.field}/${fix.code}: ${fix.message}`),
  };
}
