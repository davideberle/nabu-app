/**
 * Swiss monthly seasonality for the weekly shelf (Kitchen DESIGN.md §4.3.1,
 * "Use an attributable Swiss monthly produce calendar and score defining fresh
 * ingredients").
 *
 * The calendar is Kitchen-owned evidence: `projects/kitchen/planner-evidence/
 * swiss-season-calendar.json`, parsed from the Verband Schweizer
 * Gemüseproduzenten (VSGP) Saisonkalender and mirrored verbatim into
 * `src/data/kitchen/` by `scripts/sync-planner-evidence.mjs`. The app never
 * edits it; this module only reads it.
 *
 * What is decided here, deterministically and from the recipe's own text:
 *
 *   - which ingredients *define* the dish (the produce in its name, and the
 *     substantial produce lines near the top of its list). Aromatics, herbs
 *     and garnish never define a dish, so a seasonal garnish cannot make a
 *     dish seasonal and cannot cancel an out-of-season defining ingredient
 *   - the evidence class of each defining ingredient: `fresh` (VSGP marks the
 *     month), `storage` (marked month in the storage window for a storage
 *     vegetable — a documented planner assumption, the VSGP table itself does
 *     not separate the two), `out-of-season` (in the calendar, month not
 *     marked), `preserved` (canned, dried, frozen, pickled …), `uncertain`
 *     (produce the calendar does not cover — fruit, cultivated mushrooms,
 *     imported produce: no Swiss origin is claimed) or `pantry-neutral`
 *   - one recipe verdict, where a single out-of-season defining ingredient
 *     outranks every in-season one, and a user-facing note only when the
 *     verdict is supported by named produce
 *
 * Bound to the target week (month) and the calendar version, separately from
 * any recipe-content review: a new week recomputes this without touching a
 * cached content review (§4.3.1 binding rule).
 *
 * Pure and dependency-free apart from the mirrored calendar; `node --test`
 * loads it directly.
 */

import { SWISS_SEASON_CALENDAR } from "../data/kitchen/swiss-season-calendar.generated.ts";

export type SeasonStatus = "fresh" | "storage" | "out-of-season" | "preserved" | "pantry-neutral" | "uncertain";

export type SeasonCalendarRow = { name: string; slug: string | null; months: string[] };

export type SeasonCalendar = {
  calendarVersion: string;
  owner: string;
  source: { organization: string; url: string; pdf?: string; pdfSha256?: string; htmlSha256?: string; fetchedAt: string; meaning: string };
  storageProduce: string[];
  minorProduce: string[];
  aliases: { produce: string; pattern: string; label: string }[];
  rows: SeasonCalendarRow[];
};

export type DefiningIngredient = {
  /** The ingredient line as written (item only, never amounts the model would need). */
  ingredient: string;
  /** VSGP row name when the calendar covers the produce. */
  produce: string | null;
  /** The calendar's English cooking term for the produce ("pumpkin", "kale"). */
  label: string;
  status: SeasonStatus;
  /** Where the ingredient was found. */
  from: "name" | "ingredients";
};

export type RecipeSeasonality = {
  calendarVersion: string;
  /** 1–12, the month of the planned week's Thursday. */
  month: number;
  status: SeasonStatus;
  defining: DefiningIngredient[];
  /** Internal reasons; always present. */
  reasons: string[];
  /** Concise user-facing reason. Present only when supported by named produce. */
  note?: string;
};

const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Marked months in this window count as stored harvest for storage produce. */
const STORAGE_WINDOW = new Set(["nov", "dec", "jan", "feb", "mar"]);

/** Ingredient lines that are preserved produce, whatever the produce word says. */
const PRESERVED_RE = /\b(canned|tinned|tin of|can of|cans? |tins? |jarred|jar of|dried|sun-dried|sundried|frozen|pickled|preserved|passata|pur[ée]e|paste|chopped tomatoes|crushed tomatoes|tomato sauce|ketchup|chutney|powder|flakes|stock|broth|juice|oil\b|vinegar)\b/i;

/**
 * Produce the VSGP vegetable calendar does not cover: no Swiss-origin claim
 * either way. Only substantial, dish-defining produce is listed; citrus,
 * ginger, chilli, olives and the like are seasonings and never define a dish.
 */
const UNCOVERED_PRODUCE_RE = /\b(apples?|pears?|plums?|quinces?|grapes?|berr(y|ies)|strawberr\w*|raspberr\w*|blueberr\w*|cherr(y|ies)|apricots?|peach(es)?|nectarines?|figs?|kiwis?|pomegranates?|mushrooms?|cremini|portobello|shiitake|chanterelles?|porcini|avocados?|mango(es)?|bananas?|pineapples?|okra|plantains?|papayas?|passion ?fruit|lychees?|bean ?sprouts?)\b/i;

/** Amount tokens that mark a seasoning-sized quantity, never a defining one. */
const SMALL_AMOUNT_RE = /\b(tsp|teaspoons?|tbsp|tablespoons?|pinch(es)?|dash|sprigs?|a few|to taste|for garnish|to serve|to finish|optional)\b/i;

const UNICODE_FRACTIONS: Record<string, number> = { "¼": 0.25, "½": 0.5, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };

/** How far down the ingredient list produce can still define the dish. */
const DEFINING_LINE_LIMIT = 8;

// ---------------------------------------------------------------------------
// Calendar access
// ---------------------------------------------------------------------------

type CompiledAlias = { produce: string; label: string; re: RegExp };

let compiled: { calendar: SeasonCalendar; aliases: CompiledAlias[]; byName: Map<string, SeasonCalendarRow> } | null = null;

export function assertSeasonCalendar(value: unknown): SeasonCalendar {
  const calendar = value as SeasonCalendar;
  if (!calendar || typeof calendar !== "object") throw new Error("season calendar: not an object");
  if (typeof calendar.calendarVersion !== "string" || !calendar.calendarVersion) throw new Error("season calendar: missing calendarVersion");
  if (!calendar.source || typeof calendar.source.url !== "string" || typeof calendar.source.organization !== "string") {
    throw new Error("season calendar: missing source citation");
  }
  if (!Array.isArray(calendar.rows) || calendar.rows.length === 0) throw new Error("season calendar: no rows");
  const names = new Set<string>();
  for (const row of calendar.rows) {
    if (!row || typeof row.name !== "string" || !Array.isArray(row.months)) throw new Error("season calendar: malformed row");
    for (const month of row.months) {
      if (!(MONTH_KEYS as readonly string[]).includes(month)) throw new Error(`season calendar: unknown month ${month} on ${row.name}`);
    }
    names.add(row.name);
  }
  for (const alias of calendar.aliases ?? []) {
    if (!names.has(alias.produce)) throw new Error(`season calendar: alias for unknown produce ${alias.produce}`);
    if (typeof alias.label !== "string" || !alias.label) throw new Error(`season calendar: alias ${alias.produce} has no label`);
    new RegExp(alias.pattern, "i");
  }
  for (const name of [...(calendar.storageProduce ?? []), ...(calendar.minorProduce ?? [])]) {
    if (!names.has(name)) throw new Error(`season calendar: unknown produce ${name} in storage/minor lists`);
  }
  return calendar;
}

function compiledCalendar() {
  if (compiled) return compiled;
  const calendar = assertSeasonCalendar(SWISS_SEASON_CALENDAR);
  compiled = {
    calendar,
    aliases: calendar.aliases.map((alias) => ({ produce: alias.produce, label: alias.label, re: new RegExp(`\\b(?:${alias.pattern})\\b`, "i") })),
    byName: new Map(calendar.rows.map((row) => [row.name, row])),
  };
  return compiled;
}

export function seasonCalendar(): SeasonCalendar {
  return compiledCalendar().calendar;
}

export function seasonCalendarVersion(): string {
  return compiledCalendar().calendar.calendarVersion;
}

/** Test-only: evaluate `fn` against a different calendar. */
export function withSeasonCalendar<T>(calendar: unknown, fn: () => T): T {
  const previous = compiled;
  const next = assertSeasonCalendar(calendar);
  compiled = {
    calendar: next,
    aliases: next.aliases.map((alias) => ({ produce: alias.produce, label: alias.label, re: new RegExp(`\\b(?:${alias.pattern})\\b`, "i") })),
    byName: new Map(next.rows.map((row) => [row.name, row])),
  };
  try {
    return fn();
  } finally {
    compiled = previous;
  }
}

// ---------------------------------------------------------------------------
// Week → month
// ---------------------------------------------------------------------------

/** The Thursday of an ISO week, which is also the day that fixes its ISO year. */
export function isoWeekThursday(week: string): Date | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!match) return null;
  const year = Number(match[1]);
  const number = Number(match[2]);
  if (number < 1 || number > 53) return null;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const mondayWeek1 = new Date(jan4.getTime() - (jan4Day - 1) * 86_400_000);
  return new Date(mondayWeek1.getTime() + ((number - 1) * 7 + 3) * 86_400_000);
}

/** 1–12 for a week id; falls back to `now` when the id is malformed. */
export function monthForWeek(week: string, now = new Date()): number {
  const thursday = isoWeekThursday(week);
  return (thursday ?? now).getUTCMonth() + 1;
}

export function monthName(month: number): string {
  return MONTH_NAMES[Math.min(12, Math.max(1, month)) - 1];
}

// ---------------------------------------------------------------------------
// Ingredient analysis
// ---------------------------------------------------------------------------

type IngredientLike = { item?: unknown; amount?: unknown; unit?: unknown };

type SeasonalityRecipe = {
  name?: string;
  ingredients?: IngredientLike[];
};

function parseQuantity(amount: string): number | null {
  const text = amount.trim();
  if (!text) return null;
  const unicode = text.match(/^(\d+)?\s*([¼½¾⅓⅔⅛])/);
  if (unicode) return Number(unicode[1] ?? 0) + UNICODE_FRACTIONS[unicode[2]];
  const fraction = text.match(/^(\d+)\s*\/\s*(\d+)/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const mixed = text.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const plain = text.match(/^(\d+(?:[.,]\d+)?)/);
  if (plain) return Number(plain[1].replace(",", "."));
  return null;
}

/**
 * Is this ingredient line substantial enough to define the dish?
 *
 * Weight ≥ 150 g/ml, a cup or more, a whole item or more, or a bunch/head,
 * define; teaspoons, tablespoons, pinches and "to serve" do not. A line with
 * no readable amount is given the benefit of the doubt when it sits near the
 * top of the list.
 */
export function isSubstantialLine(ingredient: IngredientLike, index: number): boolean {
  const amount = String(ingredient.amount ?? "").trim();
  const unit = String(ingredient.unit ?? "").trim().toLowerCase();
  const item = String(ingredient.item ?? "");
  const combined = `${amount} ${unit} ${item}`;
  if (SMALL_AMOUNT_RE.test(combined)) return false;
  const quantity = parseQuantity(amount);
  const unitText = unit || (amount.match(/[a-zA-Z]+\s*$/)?.[0] ?? "").toLowerCase();
  if (quantity === null) return index < DEFINING_LINE_LIMIT;
  if (/^(g|gram|grams|ml|millilit\w*)$/.test(unitText)) return quantity >= 150;
  if (/^(kg|kilo\w*|l|lb|lbs|pound|pounds|litre|liter|litres|liters)$/.test(unitText)) return quantity >= 0.25;
  if (/^(oz|ounce|ounces)$/.test(unitText)) return quantity >= 5;
  if (/^(cups?)$/.test(unitText)) return quantity >= 1;
  if (/^(bunch(es)?|heads?|handfuls?|large|medium|small)$/.test(unitText)) return true;
  return quantity >= 1;
}

function matchProduce(text: string): { produce: string; label: string } | null {
  return matchAllProduce(text)[0] ?? null;
}

/** Every calendar row named in `text`, in text order (first match wins per row). */
function matchAllProduce(text: string): { produce: string; label: string; index: number }[] {
  const hits: { produce: string; label: string; index: number }[] = [];
  for (const alias of compiledCalendar().aliases) {
    const match = alias.re.exec(text);
    if (match && !hits.some((hit) => hit.produce === alias.produce)) hits.push({ produce: alias.produce, label: alias.label, index: match.index });
  }
  return hits.sort((a, b) => a.index - b.index);
}

function statusFor(produce: string, monthKey: string): SeasonStatus {
  const { calendar, byName } = compiledCalendar();
  const row = byName.get(produce);
  if (!row) return "uncertain";
  if (!row.months.includes(monthKey)) return "out-of-season";
  if (calendar.storageProduce.includes(produce) && STORAGE_WINDOW.has(monthKey)) return "storage";
  return "fresh";
}

/**
 * The defining ingredients of a recipe and their evidence class for `month`.
 *
 * Produce named in the title always defines (an onion soup is about onions,
 * however minor onions are elsewhere). In the list, only substantial lines
 * near the top define, and the calendar's minor produce never does.
 */
export function definingIngredients(recipe: SeasonalityRecipe, month: number): DefiningIngredient[] {
  const monthKey = MONTH_KEYS[Math.min(12, Math.max(1, month)) - 1];
  const { calendar } = compiledCalendar();
  const out: DefiningIngredient[] = [];
  const seenProduce = new Set<string>();

  const name = String(recipe.name ?? "");
  for (const named of matchAllProduce(name)) {
    seenProduce.add(named.produce);
    out.push({ ingredient: name, produce: named.produce, label: named.label, status: statusFor(named.produce, monthKey), from: "name" });
  }

  (recipe.ingredients ?? []).forEach((ingredient, index) => {
    const item = String(ingredient?.item ?? "").trim();
    if (!item) return;
    const line = `${String(ingredient?.amount ?? "")} ${String(ingredient?.unit ?? "")} ${item}`;
    const preserved = PRESERVED_RE.test(line);
    const match = matchProduce(item);
    if (match) {
      if (seenProduce.has(match.produce)) return;
      if (calendar.minorProduce.includes(match.produce)) return;
      if (!preserved && !isSubstantialLine(ingredient, index)) return;
      seenProduce.add(match.produce);
      out.push({
        ingredient: item,
        produce: match.produce,
        label: match.label,
        status: preserved ? "preserved" : statusFor(match.produce, monthKey),
        from: "ingredients",
      });
      return;
    }
    const uncovered = UNCOVERED_PRODUCE_RE.exec(item);
    if (uncovered && !preserved && isSubstantialLine(ingredient, index)) {
      const label = uncovered[0].toLowerCase();
      if (seenProduce.has(`~${label}`)) return;
      seenProduce.add(`~${label}`);
      out.push({ ingredient: item, produce: null, label, status: "uncertain", from: "ingredients" });
    }
  });

  return out;
}

function joinLabels(labels: string[]): string {
  const unique = [...new Set(labels)];
  if (unique.length <= 1) return unique[0] ?? "";
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

/**
 * The seasonality verdict for a recipe in a given month.
 *
 * Order of precedence is the contract: one out-of-season defining ingredient
 * makes the dish out of season whatever else is in it; otherwise fresh Swiss
 * produce makes it seasonal; stored harvest alone is `storage`; produce the
 * calendar does not cover is `uncertain` rather than claimed local; a dish
 * with no defining fresh produce at all is pantry-neutral and simply not
 * ranked on seasonality.
 */
export function seasonalityForRecipe(recipe: SeasonalityRecipe, month: number): RecipeSeasonality {
  const { calendar } = compiledCalendar();
  const defining = definingIngredients(recipe, month);
  const by = (status: SeasonStatus) => defining.filter((d) => d.status === status);
  const monthLabel = monthName(month);
  const cite = `${calendar.source.organization} calendar ${calendar.calendarVersion}`;
  const reasons: string[] = [];
  let status: SeasonStatus;
  let note: string | undefined;

  const outOfSeason = by("out-of-season");
  const fresh = by("fresh");
  const storage = by("storage");
  const preserved = by("preserved");
  const uncertain = by("uncertain");

  if (outOfSeason.length > 0) {
    status = "out-of-season";
    const labels = joinLabels(outOfSeason.map((d) => d.label));
    reasons.push(`defining fresh ${labels} outside the Swiss season in ${monthLabel} (${cite})`);
    if (fresh.length > 0) {
      reasons.push(`in-season ${joinLabels(fresh.map((d) => d.label))} does not cancel an out-of-season defining ingredient`);
    }
    note = `Fresh ${labels} ${plural(outOfSeason.map((d) => d.label)) ? "are" : "is"} out of the Swiss season in ${monthLabel}.`;
  } else if (fresh.length > 0) {
    status = "fresh";
    const labels = joinLabels(fresh.map((d) => d.label));
    reasons.push(`defining ${labels} in the Swiss season in ${monthLabel} (${cite})`);
    note = `${capitalize(labels)} ${plural(fresh.map((d) => d.label)) ? "are" : "is"} in season in Switzerland in ${monthLabel}.`;
  } else if (storage.length > 0) {
    status = "storage";
    const labels = joinLabels(storage.map((d) => d.label));
    reasons.push(`defining ${labels} from Swiss storage in ${monthLabel} (${cite}; storage window is a planner assumption)`);
    note = `${capitalize(labels)} ${plural(storage.map((d) => d.label)) ? "come" : "comes"} from stored Swiss harvest in ${monthLabel}.`;
  } else if (uncertain.length > 0) {
    status = "uncertain";
    reasons.push(`defining ${joinLabels(uncertain.map((d) => d.label))} not covered by the ${cite}; no origin claimed`);
  } else if (preserved.length > 0) {
    status = "preserved";
    reasons.push(`defining produce is preserved (${joinLabels(preserved.map((d) => d.label))}); seasonality neutral`);
  } else {
    status = "pantry-neutral";
    reasons.push("no defining fresh produce; seasonality neutral");
  }

  return {
    calendarVersion: calendar.calendarVersion,
    month,
    status,
    defining,
    reasons,
    ...(note ? { note } : {}),
  };
}

/** More than one produce, or a plural word, reads as plural. */
function plural(labels: string[]): boolean {
  const unique = [...new Set(labels)];
  return unique.length > 1 || /(?:s|es)$/.test(unique[0] ?? "");
}

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** Score contribution for the shelf. Neutral classes score nothing. */
export function seasonalityScore(status: SeasonStatus | null | undefined): number {
  switch (status) {
    case "fresh":
      return 3;
    case "storage":
      return 1;
    case "out-of-season":
      return -3;
    default:
      return 0;
  }
}
