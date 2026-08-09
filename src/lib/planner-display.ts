/**
 * The shelf presentation contract (Kitchen DESIGN.md §4.3, "Shelf presentation
 * contract").
 *
 * Every visible idea carries two separate explanations and they must not be
 * confused:
 *
 *   `reason`  — the internal diagnostic. "From your recipe book to cover the
 *               soup gap" is true, useful in tests and planner diagnostics, and
 *               has no business on a card. It stays in the contract; nothing
 *               here renders it.
 *   `display` — what the card actually says: which of the three groups the idea
 *               belongs to, a short editorial note about the kind of meal it
 *               makes, whether it is a light meal, and — only when there is a
 *               concrete one — the single thing that turns it into dinner.
 *
 * The three groups describe **meal character, not calendar placement**. A
 * "Worth more time" idea can perfectly well be assigned to a Wednesday; nothing
 * here says otherwise, and the vocabulary is chosen so it cannot.
 *
 * Pure and deterministic: the same item always produces the same words, so the
 * copy is testable and a card never changes its mind between renders. Type-only
 * imports keep this loadable from the client bundle and from `node --test`.
 */

import type { EffortLane, MealShape, ProteinLane, ShelfTraits, StarchLane } from "./planner-shelf.ts";
import type { PlannerRole } from "./planner-roles.ts";

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export type ShelfGroup = "easy-light" | "everyday-dinners" | "worth-more-time";

/** Render order. Empty groups are omitted by the caller, never reordered. */
export const SHELF_GROUP_ORDER: readonly ShelfGroup[] = [
  "easy-light",
  "everyday-dinners",
  "worth-more-time",
] as const;

export const SHELF_GROUP_LABELS: Record<ShelfGroup, string> = {
  "easy-light": "Easy & light",
  "everyday-dinners": "Everyday dinners",
  "worth-more-time": "Worth more time",
};

/**
 * One line under each group heading. Written to describe effort and meal shape
 * without ever implying a day of the week.
 */
export const SHELF_GROUP_DESCRIPTIONS: Record<ShelfGroup, string> = {
  "easy-light": "Quick to cook or light on the plate.",
  "everyday-dinners": "Complete dinners without a project attached.",
  "worth-more-time": "Slower, richer, or multi-component cooking.",
};

export type ShelfDisplay = {
  group: ShelfGroup;
  /** Kitchen's editorial note. Rendered as-is; never re-derived by the UI. */
  note: string;
  /** True for a substantial light meal. The card labels these explicitly. */
  lightMeal: boolean;
  /** One concrete accompaniment. Present only when there is a real one. */
  makeItDinner?: string;
};

// ---------------------------------------------------------------------------
// Forbidden vocabulary
// ---------------------------------------------------------------------------

/**
 * Words that belong to the selector, not to David.
 *
 * "Cover the curry gap" is an honest description of why the assembler picked
 * something and a baffling thing to read on a recipe card. This is the guard
 * that keeps the two vocabularies apart, and it is asserted over the whole
 * generated corpus in the tests rather than trusted by eye.
 */
export const SELECTOR_VOCABULARY =
  /\b(gaps?|buckets?|coverage|backfill|back-fill|quotas?|selector|slots?|lanes?|shelf|candidate set|policy|policies|diagnostics?|admission|cap|caps|fill|filled|round out|top up)\b/i;

/** Does this text leak internal selector vocabulary? */
export function containsSelectorVocabulary(text: string): boolean {
  return SELECTOR_VOCABULARY.test(text);
}

// ---------------------------------------------------------------------------
// Editorial note
// ---------------------------------------------------------------------------

const SHAPE_PHRASE: Record<MealShape, string> = {
  salad: "A fresh salad",
  soup: "A warming soup",
  "stew-curry": "A simmered stew",
  bowl: "A composed bowl",
  pasta: "A comforting pasta",
  "roast-bake": "An oven-baked main",
  "stir-fry": "A fast pan dish",
  grill: "A charred, smoky main",
  other: "A straightforward main",
};

/** Light meals lead with what they are, not with the technique that made them. */
const LIGHT_SHAPE_PHRASE: Partial<Record<MealShape, string>> = {
  grill: "A light plate",
  "roast-bake": "A light plate",
  "stir-fry": "A light plate",
  other: "A light plate",
};

const PROTEIN_PHRASE: Partial<Record<ProteinLane, string>> = {
  vegan: "plant-based",
  vegetarian: "meat-free",
  fish: "built around fish",
};

const STARCH_PHRASE: Partial<Record<StarchLane, string>> = {
  rice: "rice-based",
  bread: "bread-led",
  legume: "legume-heavy",
};

function effortPhrase(effort: EffortLane, totalMinutes: number | null): string | null {
  if (effort === "project") return "worth a slower evening";
  if (effort === "quick") {
    if (totalMinutes && totalMinutes >= 10) return `on the table in about ${Math.round(totalMinutes / 5) * 5} minutes`;
    return "quick to get on the table";
  }
  return null;
}

export type ShelfDisplayInput = {
  role?: PlannerRole | string | null;
  traits?: Partial<ShelfTraits> | null;
  time?: { total?: number | null } | null;
  /** Kitchen-supplied accompaniment, from the recipe's own serving guidance. */
  completion?: string | null;
};

const DEFAULT_TRAITS: ShelfTraits = {
  shape: "other",
  protein: "vegetarian",
  starch: "none",
  effort: "medium",
  weekdayFit: true,
  weekendFit: true,
  vegetableDense: false,
  seasonalLocal: false,
  longHaul: false,
};

/**
 * Which group an idea belongs to.
 *
 * Deliberately effort- and shape-driven, and deliberately silent about days:
 * a light meal is easy whatever the weather, a 2-hour braise is a project on a
 * Tuesday as much as on a Saturday.
 */
export function shelfGroupFor(role: string | null | undefined, traits: ShelfTraits): ShelfGroup {
  if (role === "light-meal") return "easy-light";
  if (traits.effort === "project") return "worth-more-time";
  if (traits.effort === "quick") return "easy-light";
  if (traits.shape === "salad") return "easy-light";
  return "everyday-dinners";
}

/**
 * The editorial note: what kind of meal this makes, and why it is attractive
 * now. One sentence, assembled from the traits Kitchen already derived.
 */
export function editorialNoteFor(role: string | null | undefined, traits: ShelfTraits, totalMinutes: number | null): string {
  const lightMeal = role === "light-meal";
  const opening = (lightMeal && LIGHT_SHAPE_PHRASE[traits.shape]) || SHAPE_PHRASE[traits.shape] || SHAPE_PHRASE.other;

  const qualities: string[] = [];
  const protein = PROTEIN_PHRASE[traits.protein];
  if (protein) qualities.push(protein);
  if (traits.seasonalLocal) qualities.push("in season right now");
  else if (traits.vegetableDense) qualities.push("full of vegetables");
  else {
    const starch = STARCH_PHRASE[traits.starch];
    if (starch) qualities.push(starch);
  }

  const effort = effortPhrase(traits.effort, totalMinutes);
  const parts = [opening];
  if (qualities.length > 0) parts.push(qualities.join(" and "));
  if (effort) parts.push(effort);

  return `${parts.join(", ")}.`;
}

/**
 * The full display contract for one idea.
 *
 * Everything it needs is already persisted on a `planner-shelf-1` candidate —
 * role and traits — so an existing saved week gains its groups and notes on
 * read, without regenerating anything or moving a single day assignment.
 */
export function deriveShelfDisplay(input: ShelfDisplayInput): ShelfDisplay {
  const traits: ShelfTraits = { ...DEFAULT_TRAITS, ...(input.traits ?? {}) };
  const lightMeal = input.role === "light-meal";
  const total = typeof input.time?.total === "number" && input.time.total > 0 ? input.time.total : null;

  return {
    group: shelfGroupFor(input.role, traits),
    note: editorialNoteFor(input.role, traits, total),
    lightMeal,
    ...(lightMeal && input.completion ? { makeItDinner: input.completion } : {}),
  };
}

// ---------------------------------------------------------------------------
// Legacy normalization
// ---------------------------------------------------------------------------

type DisplayableCandidateItem = {
  role?: string | null;
  traits?: Partial<ShelfTraits> | null;
  time?: { total?: number | null } | null;
  completion?: string | null;
  display?: Partial<ShelfDisplay> | null;
  /** A persisted candidate carries much more than this; the rest is ignored. */
  [key: string]: unknown;
};

/**
 * The display contract for a persisted candidate item, deriving it when the
 * item predates the contract.
 *
 * A stored `display` wins so a card cannot change its wording under David
 * mid-week; anything older is derived from the role and traits the shelf
 * already saved. An item with neither still gets a usable, honest note from the
 * neutral defaults rather than an empty card.
 */
export function candidateDisplay(item: DisplayableCandidateItem | null | undefined): ShelfDisplay {
  const stored = item?.display;
  if (stored && typeof stored.note === "string" && stored.note && stored.group) {
    return {
      group: stored.group,
      note: stored.note,
      lightMeal: Boolean(stored.lightMeal),
      ...(stored.makeItDinner ? { makeItDinner: stored.makeItDinner } : {}),
    };
  }
  return deriveShelfDisplay({
    role: item?.role ?? null,
    traits: item?.traits ?? null,
    time: item?.time ?? null,
    completion: item?.completion ?? null,
  });
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export type ShelfGroupSection<T> = {
  group: ShelfGroup;
  label: string;
  description: string;
  items: T[];
};

/**
 * Split a shelf into its rendered sections, in contract order, dropping the
 * groups nothing landed in. Within a group the caller's order is preserved —
 * grouping is a presentation move, not a re-ranking.
 */
export function groupShelfItems<T>(
  items: readonly T[],
  displayOf: (item: T) => ShelfDisplay,
): ShelfGroupSection<T>[] {
  const byGroup = new Map<ShelfGroup, T[]>();
  for (const item of items) {
    const group = displayOf(item).group;
    const bucketed = byGroup.get(group);
    if (bucketed) bucketed.push(item);
    else byGroup.set(group, [item]);
  }
  return SHELF_GROUP_ORDER.filter((group) => (byGroup.get(group)?.length ?? 0) > 0).map((group) => ({
    group,
    label: SHELF_GROUP_LABELS[group],
    description: SHELF_GROUP_DESCRIPTIONS[group],
    items: byGroup.get(group) ?? [],
  }));
}
