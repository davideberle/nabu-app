import fs from "fs";
import path from "path";

/**
 * Validate that a recipe has a usable image reference.
 *
 * Accepts either:
 * - A full https:// Blob URL (production)
 * - A local /recipes/slug.jpg path that exists in public/ (dev)
 *
 * Throws if the image field is missing or the reference is invalid.
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

  // Local path — verify file exists on disk (dev only)
  const imagePath = path.join(process.cwd(), "public", recipe.image);
  if (!fs.existsSync(imagePath)) {
    throw new Error(
      `My Recipe "${recipe.id}" references image "${recipe.image}" but the file does not exist at ${imagePath}. Upload the image first.`
    );
  }
}
