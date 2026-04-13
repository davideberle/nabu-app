import { put, del } from "@vercel/blob";

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
