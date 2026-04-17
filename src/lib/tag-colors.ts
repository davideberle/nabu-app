// Shared tag color classes for course/category badges.
// Used by recipe pages, cookbook views, and the meal planner so that
// the same label always renders the same color everywhere.

/** Normalize a tag label: trim, capitalize first letter, lowercase rest. */
export function normalizeTagLabel(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

// Maps a normalized course/category label to Tailwind color classes.
// The default (amber) matches the existing recipe-page aesthetic;
// specific categories get distinct colors for quick visual scanning.
const COURSE_TAG_COLORS: Record<string, string> = {
  Pasta: "bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300",
  Curry: "bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300",
  Soup: "bg-sky-100 dark:bg-sky-900 text-sky-700 dark:text-sky-300",
  Salad: "bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300",
  Bowl: "bg-teal-100 dark:bg-teal-900 text-teal-700 dark:text-teal-300",
  "Stir-fry": "bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300",
  Tagine: "bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300",
  Rice: "bg-lime-100 dark:bg-lime-900 text-lime-700 dark:text-lime-300",
  Roast: "bg-rose-100 dark:bg-rose-900 text-rose-700 dark:text-rose-300",
  Grill: "bg-fuchsia-100 dark:bg-fuchsia-900 text-fuchsia-700 dark:text-fuchsia-300",
  Bread: "bg-orange-50 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300",
  Dessert: "bg-pink-100 dark:bg-pink-900 text-pink-700 dark:text-pink-300",
  Drink: "bg-cyan-100 dark:bg-cyan-900 text-cyan-700 dark:text-cyan-300",
  Breakfast: "bg-violet-100 dark:bg-violet-900 text-violet-700 dark:text-violet-300",
  Starter: "bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300",
  Side: "bg-teal-100 dark:bg-teal-900 text-teal-700 dark:text-teal-300",
};

const DEFAULT_COURSE_COLOR =
  "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300";

/**
 * Get Tailwind color classes for a course/category tag.
 * Handles case normalization internally — pass the raw label.
 */
export function getCourseTagColor(tag: string): string {
  const normalized = normalizeTagLabel(tag);
  return COURSE_TAG_COLORS[normalized] || DEFAULT_COURSE_COLOR;
}

// Publication badge styling (consistent across all surfaces).
export const PUBLICATION_BADGE_CLASSES =
  "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800";
