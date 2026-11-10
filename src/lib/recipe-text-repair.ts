// Deterministic repair of PDF-extraction damage in static cookbook recipes.
//
// November 10, 2026 catalog cleanup (Kitchen plan note
// `kitchen/work/catalog-cleanup-2026-11-10.md`). Several imported books were
// extracted line by line, so one sentence of the method ended up as two or
// three numbered steps ("…, smoked" / "paprika, mix spice powder, …"), and a
// few PDF parsers took the first letter of an ingredient for a unit
// ("1 g" + "reen bell pepper").
//
// This module is a pure, offline data tool. It is used by
// `scripts/repair-recipe-text.mjs` to rewrite the recipe JSON files once, and
// by the tests that pin the rules to real examples. It is not imported by the
// app at runtime.
//
// Rules are deliberately conservative: a step is only joined to the previous
// one when the text itself proves it is the same sentence, words are only
// rejoined when the result is a known word and the fragment is not, and no
// ingredient amount, ingredient name, or instruction is ever invented,
// reordered, or reworded.

export type MethodRepairChange =
  | { kind: "merge"; at: number; reason: string; parts: string[] }
  | { kind: "capitalize"; at: number; before: string }
  | { kind: "ligature"; at: number }
  | { kind: "drop-chapter-tail"; at: number; dropped: string[] }
  | { kind: "drop-empty"; at: number }
  | { kind: "drop-metadata"; at: number; text: string }
  | { kind: "drop-page-note"; at: number; text: string }
  | { kind: "drop-next-recipe"; at: number; dropped: string[] };

export type WordCheck = (word: string) => boolean;

export type MethodRepairOptions = {
  /** True when the lower-cased token is a real word (used for hyphen joins). */
  isWord: WordCheck;
  /** Stricter "is a word on its own" test for fragments. Defaults to `isWord`. */
  isStandaloneWord?: WordCheck;
  /**
   * Normalized titles (see `normalizeTitle`) of the *other* recipes in the
   * same book. A method step that is exactly one of them marks where the next
   * recipe's page bled into this method; it and everything after are dropped.
   */
  otherTitles?: ReadonlySet<string>;
};

/** Lower-case, punctuation-free form used to compare a step with a title. */
export function normalizeTitle(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const TERMINAL_RE = /[.!?]["'”’)\]]*$/;
// Abbreviations that end with a period but do not end the sentence.
const NON_TERMINAL_ABBREVIATION_RE =
  /(?:^|[\s(])(?:e\.g|i\.e|approx|tsp|tbsp|tbs|oz|lb|lbs|min|mins|cm|mm|in|no|vs|pkg|qt|pt|fl|deg|temp)\.$/i;
// Words a sentence cannot end on: when a step ends with one of these, the next
// step is the rest of the same sentence.
const DANGLING_WORD_RE =
  /(?:^|\s)(?:and|or|nor|but|the|a|an|of|to|with|into|in|on|onto|for|from|by|at|over|under|then|as|your|their|its|each|some|about|around|plus|until|till|while|when|if|than|this|that|these|those|is|are|be|was|until|between|through|without|within|per|very|more|less|such|so|out|up|off)$/i;
// Recipe metadata the extractor put into the method ("Cook Time: 45 minutes",
// "Servings Size: 6"). These are not instructions; the recipe already carries
// time and servings in their own fields.
const METADATA_LINE_RE =
  /^(?:(?:prep(?:aration)?|cook(?:ing)?|total|bake|baking|active|inactive|resting|chill(?:ing)?)\s*time|servings?(?:\s*size)?|serves|yield|makes|difficulty)\s*:\s*[^.]{0,40}\.?$/i;
const NOUN_EXPECTING_RE = /(?:^|\s)(?:a|an|the|of|into|onto|in|on|with|from|at|your|each|over|under)$/i;
const PAGE_NOTE_RE = /^(?:pictured|shown|see (?:the )?(?:photo|picture|photograph))\b[^.]{0,60}\.?$/i;
const SEPARATOR_RE = /^[X=_*~•.\-–—]{5,}$/;
// "Poultry and Meat Pasta Recipes", "Mexican Lunch Recipes": a chapter title.
const CHAPTER_TITLE_RE = /^[A-Z][A-Za-z,'’&\- ]{3,60}\bRecipes$/;
const CHAPTER_HEADING_RE = /^(?:chapter|part)\s+(?:\d+|[ivxlc]+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i;

/** Private-use ligature glyphs some PDFs emit for "fi"/"fl"/"ff". */
function fixLigatures(text: string): string {
  return text
    .replace(/ﬁ/g, "fi")
    .replace(/ﬂ/g, "fl")
    .replace(/ﬀ/g, "ff")
    .replace(/ﬃ/g, "ffi")
    .replace(/ﬄ/g, "ffl")
    // Private-use code points (Adobe/Mac encodings): U+F001 = fi, U+F002 = fl.
    // The extractor usually left a space after the glyph ("the  sh").
    .replace(/ ?/g, "fi")
    .replace(/ ?/g, "fl");
}

/**
 * Rejoin words a PDF split after a ligature: "fi sh" → "fish", "fl our" →
 * "flour", "fi nely" → "finely". Only when the joined form is a word;
 * "fl oz" (fluid ounce) is left alone.
 */
export function rejoinLigatureSplits(text: string, isWord: WordCheck): string {
  return text
    // "infl uenced", "briefl y": the ligature at the end of the first half.
    .replace(/\b([A-Za-z]{2,}(?:fi|fl|ff)) ([a-z]{1,6})\b/g, (whole, head: string, tail: string) => {
      const joined = `${head}${tail}`;
      return isWord(joined.toLowerCase()) && !isWord(head.toLowerCase()) ? joined : whole;
    })
    .replace(/\b(ffi|ffl|ff|fi|fl|Fi|Fl) ([a-z]+)\b/g, (whole, head: string, tail: string) => {
    if (head.toLowerCase() === "fl" && tail === "oz") return whole;
    const joined = `${head}${tail}`;
    return isWord(joined.toLowerCase()) ? joined : whole;
  });
}

/**
 * Rejoin a word hyphenated at a line end inside one step: "remain- ing" →
 * "remaining", "oys- ter" → "oyster". Only when the joined form is a word and
 * the second half is not; "medium- low" and "crisp- tender" are left alone.
 */
export function rejoinInlineHyphenation(text: string, isWord: WordCheck, isStandalone: WordCheck = isWord): string {
  return text.replace(/\b([A-Za-z]+)- ([a-z]+)\b/g, (whole, head: string, tail: string) => {
    const joined = `${head}${tail}`;
    if (isWord(joined.toLowerCase()) && !isStandalone(tail)) return joined;
    return whole;
  });
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function endsSentence(step: string): boolean {
  return TERMINAL_RE.test(step) && !NON_TERMINAL_ABBREVIATION_RE.test(step);
}

function startsLowercase(step: string): boolean {
  return /^[a-z]/.test(step);
}

function lastWord(text: string): string {
  const m = text.match(/([A-Za-z]+)-?$/);
  return m ? m[1] : "";
}

function firstWord(text: string): string {
  const m = text.match(/^([A-Za-z]+)/);
  return m ? m[1] : "";
}

/**
 * Decide whether `next` continues the sentence started in `prev`.
 * Returns the joined text, or null when the two are separate steps.
 */
function joinIfContinuation(
  prev: string,
  next: string,
  isWord: WordCheck,
): { text: string; reason: string } | null {
  // A word broken across lines with a hyphen: "pre-" + "heat the oven".
  if (/[A-Za-z]-$/.test(prev) && startsLowercase(next)) {
    const head = lastWord(prev);
    const tail = firstWord(next);
    const solid = `${head}${tail}`.toLowerCase();
    const headIsWord = isWord(head.toLowerCase());
    const tailIsWord = isWord(tail.toLowerCase());
    // "pre-"+"heat" → "preheat"; "one-"+"fourth" stays hyphenated because
    // "onefourth" is not a word; "well-"+"seasoned" likewise.
    if (isWord(solid) && !(headIsWord && tailIsWord && head.length > 3)) {
      return { text: `${prev.slice(0, -1)}${next}`, reason: "hyphenated word split across steps" };
    }
    return { text: `${prev}${next}`, reason: "hyphenated compound split across steps" };
  }

  // Punctuation that can only continue the previous step.
  if (/^[,;:)\]%]/.test(next)) {
    return { text: `${prev}${next}`, reason: "step starts with closing punctuation" };
  }

  if (startsLowercase(next) && !endsSentence(prev)) {
    return { text: `${prev} ${next}`, reason: "sentence continues on the next step" };
  }

  if (!endsSentence(prev) && !/:$/.test(prev)) {
    // "…preheat oven to" / "375°F." and "…roast for" / "15 minutes" are one
    // sentence. A capitalised next step is not joined: after "…better if" a
    // new paragraph usually means the extractor lost text in between, and
    // "…having a" / "2 Put the baking sheet…" is a numbered step, not a
    // quantity.
    if (/,$/.test(prev) || DANGLING_WORD_RE.test(prev)) {
      if (/^[0-9½¼¾⅓⅔⅛]/.test(next) && !/^\d{1,2}[.)]?\s+[A-Z][a-z]{2,}/.test(next) && !/:$/.test(next)) {
        return { text: `${prev} ${next}`, reason: "previous step ends on a dangling comma or connector" };
      }
    }
    // "Heat 2 tablespoons oil in a" / "Dutch oven over medium heat…": an
    // article or preposition needs its noun, even a capitalised one.
    if (NOUN_EXPECTING_RE.test(prev) && /^[A-Z][a-z]/.test(next) && !/:$/.test(next) && !/^\d/.test(next)) {
      return { text: `${prev} ${next}`, reason: "previous step ends on an article or preposition" };
    }
    // "…Roll to form" / "2 sausages—each about 1½ inches wide…": a sentence
    // cut before a quantity that is followed by a lower-case noun.
    if (prev.length > 40 && /^[0-9½¼¾⅓⅔⅛][^\s]*\s+[a-z]/.test(next) && /[a-z]$/.test(prev)) {
      return { text: `${prev} ${next}`, reason: "sentence continues with a quantity on the next step" };
    }
  }
  return null;
}

/**
 * Repair one method array. Returns the new steps and a list of every change
 * so a caller can report them. The input array is not mutated.
 */
export function repairMethodSteps(
  method: readonly unknown[] | undefined,
  options: MethodRepairOptions,
): { steps: string[]; changes: MethodRepairChange[] } {
  const changes: MethodRepairChange[] = [];
  const input = Array.isArray(method) ? method : [];

  const cleaned: string[] = [];
  input.forEach((raw, index) => {
    const original = typeof raw === "string" ? raw : String(raw ?? "");
    const ligatured = rejoinInlineHyphenation(
      rejoinLigatureSplits(fixLigatures(original), options.isWord),
      options.isWord,
      options.isStandaloneWord,
    );
    if (ligatured !== original) changes.push({ kind: "ligature", at: index });
    const text = collapse(ligatured);
    if (!text) {
      changes.push({ kind: "drop-empty", at: index });
      return;
    }
    if (METADATA_LINE_RE.test(text)) {
      changes.push({ kind: "drop-metadata", at: index, text });
      return;
    }
    if (PAGE_NOTE_RE.test(text) || SEPARATOR_RE.test(text)) {
      changes.push({ kind: "drop-page-note", at: index, text });
      return;
    }
    cleaned.push(text);
  });

  // Chapter introductions bled into the end of a method
  // ("The dish is ready to be served." / "Chapter 3: The Famous French
  // Dinner Recipes" / "French dinner recipes are extremely healthy…").
  // Only a heading after at least two real steps is treated as a tail.
  const chapterAt = cleaned.findIndex(
    (step, i) => i >= 2 && (CHAPTER_HEADING_RE.test(step) || CHAPTER_TITLE_RE.test(step)),
  );
  if (chapterAt !== -1) {
    changes.push({ kind: "drop-chapter-tail", at: chapterAt, dropped: cleaned.slice(chapterAt) });
    cleaned.length = chapterAt;
  }

  // The next recipe's page bled in: its title (a recipe of the same book), or
  // any title-like line directly followed by an "Instructions"/"Ingredients"
  // heading. Everything from there on belongs to another recipe.
  const nextRecipeAt = cleaned.findIndex((step, i) => {
    if (i < 1) return false;
    if (options.otherTitles?.has(normalizeTitle(step))) return true;
    const following = cleaned[i + 1] ?? "";
    return (
      /^(?:instructions|ingredients|directions|method)\s*:?$/i.test(following) &&
      step.length < 70 &&
      !/[.:]$/.test(step)
    );
  });
  if (nextRecipeAt !== -1) {
    changes.push({ kind: "drop-next-recipe", at: nextRecipeAt, dropped: cleaned.slice(nextRecipeAt) });
    cleaned.length = nextRecipeAt;
  }

  const out: string[] = [];
  cleaned.forEach((step) => {
    if (out.length > 0) {
      const prev = out[out.length - 1];
      const joined = joinIfContinuation(prev, step, options.isWord);
      if (joined) {
        out[out.length - 1] = joined.text;
        changes.push({ kind: "merge", at: out.length - 1, reason: joined.reason, parts: [prev, step] });
        return;
      }
      if (startsLowercase(step) && endsSentence(prev)) {
        // A new sentence that lost its capital (drop caps, bold run-ins).
        changes.push({ kind: "capitalize", at: out.length, before: step });
        step = step.charAt(0).toUpperCase() + step.slice(1);
      }
    } else if (startsLowercase(step)) {
      changes.push({ kind: "capitalize", at: 0, before: step });
      step = step.charAt(0).toUpperCase() + step.slice(1);
    }
    out.push(step);
  });

  return { steps: out, changes };
}

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

export type IngredientLike = { item?: unknown; amount?: unknown; [key: string]: unknown };

export type IngredientRepairChange = {
  index: number;
  before: { amount: string; item: string };
  after: { amount: string; item: string };
  word: string;
};

export type IngredientRepairOptions = {
  /** True when the rejoined token is a real word ("green", "large"). */
  isWord: WordCheck;
  /**
   * True when the fragment is a word in its own right ("rated", "olive"), in
   * which case the split is ambiguous and left alone. Defaults to `isWord`.
   */
  isStandaloneWord?: WordCheck;
};

/**
 * Rejoin a word the importer split between amount and item:
 *   amount "1 g", item "reen bell pepper, diced" → amount "1", item "green bell pepper, diced"
 *   amount "2 l", item "arge portabella mushroom caps" → amount "2", item "large portabella mushroom caps"
 * and a word split inside the item ("2 a" "vocados" written as "a vocados").
 *
 * Only when the fragment is not a word and the rejoined form is a word.
 * "2 T" + "olive oil" (a real tablespoon) and "1 g" + "rated cheese"
 * (ambiguous: "rated" is a word) are left untouched.
 */
export function repairIngredientSplits<T extends IngredientLike>(
  ingredients: readonly T[] | undefined,
  options: IngredientRepairOptions,
): { ingredients: T[]; changes: IngredientRepairChange[] } {
  const changes: IngredientRepairChange[] = [];
  const list = Array.isArray(ingredients) ? ingredients : [];
  const standalone = options.isStandaloneWord ?? options.isWord;
  const out = list.map((ingredient, index) => {
    if (!ingredient || typeof ingredient !== "object") return ingredient;
    // A bare step number ("1.", "2.") that a PDF parser filed as an
    // ingredient. It is not an ingredient; the row is dropped below.
    if (isStepNumberLine(ingredient)) {
      changes.push({ index, before: { amount: String(ingredient.amount ?? ""), item: String(ingredient.item ?? "") }, after: { amount: "", item: "" }, word: "" });
      return null as unknown as T;
    }
    const amount = typeof ingredient.amount === "string" ? ingredient.amount : "";
    const rawItem = typeof ingredient.item === "string" ? ingredient.item : "";
    if (!rawItem) return ingredient;
    const item = rejoinLigatureSplits(fixLigatures(rawItem), options.isWord);
    if (item !== rawItem) {
      changes.push({ index, before: { amount, item: rawItem }, after: { amount, item }, word: item });
      ingredient = { ...ingredient, item };
    }

    // Case 1: trailing one- or two-letter piece on the amount.
    const amountMatch = amount.match(/^(.*[\d½¼¾⅓⅔⅛][^A-Za-z]*?)\s*([A-Za-z]{1,2})$/);
    if (amountMatch) {
      const head = amountMatch[2];
      const tailMatch = item.match(/^([a-z]+)([\s\S]*)$/);
      if (tailMatch) {
        const tail = tailMatch[1];
        const joined = `${head}${tail}`;
        if (tail.length >= 2 && !standalone(tail) && options.isWord(joined.toLowerCase())) {
          const next = { amount: amountMatch[1].trim(), item: `${joined}${tailMatch[2]}` };
          changes.push({ index, before: { amount, item }, after: next, word: joined });
          return { ...ingredient, amount: next.amount, item: next.item };
        }
      }
    }

    // Case 2: a split inside the item: "a vocados", "fresh p arsley".
    let changed = false;
    const fixed = item.replace(/(^|[\s(])([A-Za-z]) ([a-z]{2,})\b/g, (whole, lead: string, letter: string, rest: string) => {
      const joined = `${letter}${rest}`;
      if (!standalone(rest) && options.isWord(joined.toLowerCase())) {
        changed = true;
        return `${lead}${joined}`;
      }
      return whole;
    });
    if (changed) {
      changes.push({ index, before: { amount, item }, after: { amount, item: fixed }, word: fixed });
      return { ...ingredient, item: fixed };
    }
    return ingredient;
  });
  return { ingredients: (out as (T | null)[]).filter((x): x is T => x !== null), changes };
}

function isStepNumberLine(ingredient: IngredientLike): boolean {
  const item = typeof ingredient.item === "string" ? ingredient.item.trim() : "";
  const amount = typeof ingredient.amount === "string" ? ingredient.amount.trim() : "";
  return !amount && /^\d{1,2}\.$/.test(item);
}

// ---------------------------------------------------------------------------
// Metrics (same definitions as the November 10 baseline)
// ---------------------------------------------------------------------------

export type RecipeTextMetrics = {
  /** Steps shorter than 35 characters. Baseline metric: recipes with ≥ 2. */
  shortSteps: number;
  /** Any step starting with a lowercase letter. Baseline metric. */
  lowercaseStart: boolean;
  /** Adjacent pairs that are provably one sentence (stricter, post-repair). */
  continuationPairs: number;
  /** Ingredient lines with a split word between amount and item. */
  ingredientSplits: number;
};

export function recipeTextMetrics(
  recipe: { method?: readonly unknown[]; ingredients?: readonly IngredientLike[] },
  isWord: WordCheck,
  isStandaloneWord: WordCheck = isWord,
): RecipeTextMetrics {
  const steps = (Array.isArray(recipe.method) ? recipe.method : [])
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);
  let continuationPairs = 0;
  for (let i = 1; i < steps.length; i++) {
    if (joinIfContinuation(steps[i - 1], steps[i], isWord)) continuationPairs++;
  }
  return {
    shortSteps: steps.filter((s) => s.length < 35).length,
    lowercaseStart: steps.some((s) => /^[a-z]/.test(s)),
    continuationPairs,
    ingredientSplits: repairIngredientSplits(recipe.ingredients, { isWord, isStandaloneWord }).changes.length,
  };
}
