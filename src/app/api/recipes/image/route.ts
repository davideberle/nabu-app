import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { uploadRecipeImage, deleteRecipeImage } from "@/lib/recipe-images";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * POST /api/recipes/image
 * Upload a recipe image to Vercel Blob.
 *
 * Body: multipart/form-data with:
 *   - file: the image file
 *   - slug: the recipe slug (used as filename)
 */
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file");
  const slug = formData.get("slug");

  if (!slug || typeof slug !== "string") {
    return NextResponse.json(
      { error: "slug is required" },
      { status: 400 }
    );
  }

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json(
      { error: "file is required" },
      { status: 400 }
    );
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported image type: ${file.type}` },
      { status: 400 }
    );
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: "Image must be under 5 MB" },
      { status: 400 }
    );
  }

  const url = await uploadRecipeImage(slug, file, file.type);
  return NextResponse.json({ url }, { status: 201 });
}

/**
 * DELETE /api/recipes/image?url=...
 * Remove a recipe image from Vercel Blob.
 */
export async function DELETE(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json(
      { error: "url query parameter is required" },
      { status: 400 }
    );
  }

  await deleteRecipeImage(url);
  return NextResponse.json({ ok: true });
}
