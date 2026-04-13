#!/usr/bin/env npx tsx
/**
 * Backfill recipe images from local public/ to Vercel Blob.
 *
 * For each My Recipe in Turso whose image field is a local path (e.g.
 * "/recipes/slug.jpg"), this script uploads the file to Vercel Blob and
 * updates the DB record with the new URL.
 *
 * Recipes whose images are already Blob URLs (https://) are skipped.
 * Recipes with missing local files are reported but not modified.
 *
 * Prerequisites:
 *   - BLOB_READ_WRITE_TOKEN set in environment
 *   - TURSO_DATABASE_URL + TURSO_AUTH_TOKEN set (for production DB)
 *     OR run locally against the file-based DB
 *
 * Usage:
 *   BLOB_READ_WRITE_TOKEN=vercel_blob_rw_... \
 *   TURSO_DATABASE_URL=libsql://... \
 *   TURSO_AUTH_TOKEN=... \
 *   npx tsx scripts/backfill-recipe-images.ts
 */

import fs from "fs";
import path from "path";
import { createClient } from "@libsql/client";
import { put } from "@vercel/blob";

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
if (!BLOB_TOKEN) {
  console.error("Error: BLOB_READ_WRITE_TOKEN is required.");
  process.exit(1);
}

const dbUrl = process.env.TURSO_DATABASE_URL || `file:${process.cwd()}/nabu.db`;
const client = createClient({
  url: dbUrl,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

function mimeForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".avif":
      return "image/avif";
    default:
      return "image/jpeg";
  }
}

async function main() {
  const result = await client.execute("SELECT id, data FROM recipes");

  let skipped = 0;
  let uploaded = 0;
  let missing = 0;

  for (const row of result.rows) {
    const id = row.id as string;
    const recipe = JSON.parse(row.data as string);

    if (!recipe.image) {
      console.log(`  SKIP ${id}: no image field`);
      skipped++;
      continue;
    }

    if (recipe.image.startsWith("https://")) {
      console.log(`  SKIP ${id}: already a Blob URL`);
      skipped++;
      continue;
    }

    // Local path like "/recipes/slug.jpg"
    const localPath = path.join(process.cwd(), "public", recipe.image);
    if (!fs.existsSync(localPath)) {
      console.log(`  MISS ${id}: file not found at ${localPath}`);
      missing++;
      continue;
    }

    const ext = path.extname(localPath);
    const contentType = mimeForExt(ext);
    const fileBuffer = fs.readFileSync(localPath);
    const blobPathname = `recipes/${id}${ext}`;

    console.log(`  UPLOAD ${id}: ${blobPathname} (${fileBuffer.length} bytes)`);

    const blob = await put(blobPathname, fileBuffer, {
      access: "public",
      contentType,
      allowOverwrite: true,
      token: BLOB_TOKEN,
    });

    // Update DB with the Blob URL
    recipe.image = blob.url;
    await client.execute({
      sql: "UPDATE recipes SET data = ? WHERE id = ?",
      args: [JSON.stringify(recipe), id],
    });

    console.log(`    → ${blob.url}`);
    uploaded++;
  }

  console.log(
    `\nDone: ${uploaded} uploaded, ${skipped} skipped, ${missing} missing files.`
  );
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
