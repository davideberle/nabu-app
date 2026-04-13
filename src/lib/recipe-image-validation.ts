/**
 * Validate that a recipe has a usable image reference.
 *
 * Accepts either:
 * - A full https:// Blob URL (production / Vercel)
 * - A local /recipes/slug.jpg path (dev — format-checked only)
 *
 * Throws if the image field is missing or the format is invalid.
 *
 * IMPORTANT: This module must NOT import Node `fs` or `path` — even a
 * conditional `require("fs")` is traced by Turbopack and causes it to
 * bundle the entire public/recipes directory (1 GB+) into every
 * serverless function that transitively imports this file.
 */
export function assertRecipeImageValid(recipe: {
  id: string;
  image?: string | null;
}): void {
  if (!recipe.image) {
    throw new Error(
      `My Recipe "${recipe.id}" is missing the image field. Every My Recipe must have a persisted image.`
    );
  }

  // Full URL (Vercel Blob or any external host) — trust it
  if (recipe.image.startsWith("https://")) {
    return;
  }

  // Local path — validate format (must look like /recipes/<slug>.<ext>)
  if (!/^\/recipes\/[\w-]+\.\w+$/.test(recipe.image)) {
    throw new Error(
      `My Recipe "${recipe.id}" has an invalid image path "${recipe.image}". ` +
        `Expected a Blob URL (https://…) or a local path like /recipes/my-dish.jpg.`
    );
  }
}
