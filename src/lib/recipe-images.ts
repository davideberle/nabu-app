import { put, del } from "@vercel/blob";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Recipe image persistence via Vercel Blob
// ---------------------------------------------------------------------------
// In production (Vercel), images are stored in Vercel Blob and referenced by
// their full https URL. Locally / in CI without a Blob token, we fall back to
// the public/ directory so dev still works without external services.
// ---------------------------------------------------------------------------

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

/** Whether we can use Vercel Blob (token is configured). */
export function hasBlobStorage(): boolean {
  return !!BLOB_TOKEN;
}

/**
 * Upload a recipe image and return the public URL to store in recipe.image.
 *
 * @param slug   Recipe slug used as the blob pathname, e.g. "my-recipe"
 * @param body   Image bytes (Buffer, ReadableStream, Blob, etc.)
 * @param contentType  MIME type, e.g. "image/jpeg"
 * @returns The public URL of the persisted image.
 */
export async function uploadRecipeImage(
  slug: string,
  body: Buffer | ReadableStream | Blob,
  contentType: string
): Promise<string> {
  if (!BLOB_TOKEN) {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN is not set. Cannot upload recipe images without Vercel Blob."
    );
  }

  const ext = mimeToExt(contentType);
  const pathname = `recipes/${slug}.${ext}`;

  const result = await put(pathname, body, {
    access: "public",
    contentType,
    allowOverwrite: true,
    token: BLOB_TOKEN,
  });

  return result.url;
}

/**
 * Delete a recipe image from Vercel Blob by its URL.
 */
export async function deleteRecipeImage(url: string): Promise<void> {
  if (!BLOB_TOKEN) return; // nothing to clean up without Blob
  if (!url.startsWith("https://")) return; // not a Blob URL (local path)
  await del(url, { token: BLOB_TOKEN });
}

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

function mimeToExt(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/avif":
      return "avif";
    default:
      return "jpg";
  }
}
