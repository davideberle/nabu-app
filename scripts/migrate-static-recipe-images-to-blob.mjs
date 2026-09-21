#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BlobNotFoundError, head, put } from "@vercel/blob";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const recipesDir = join(root, "src", "data", "recipes");
const publicDir = join(root, "public");
const manifestPath = join(
  root,
  "scripts",
  "manifests",
  "static-recipe-image-blob-manifest.json",
);
const apply = process.argv.includes("--apply");
const token = process.env.BLOB_READ_WRITE_TOKEN;
const progressFile = process.env.MIGRATION_PROGRESS_FILE;
const concurrency = Number(process.env.MIGRATION_CONCURRENCY || 6);

if (apply && !token) {
  throw new Error("BLOB_READ_WRITE_TOKEN is required with --apply");
}
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
  throw new Error("MIGRATION_CONCURRENCY must be an integer from 1 to 16");
}

function progress(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  if (progressFile) appendFileSync(progressFile, `${line}\n`);
}

function contentType(path) {
  return (
    {
      ".avif": "image/avif",
      ".gif": "image/gif",
      ".jpeg": "image/jpeg",
      ".jpg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
    }[extname(path).toLowerCase()] || "application/octet-stream"
  );
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function readInventory() {
  const recipeFiles = readdirSync(recipesDir)
    .filter((name) => name.endsWith(".json") && name !== "index.json")
    .sort();
  const recipes = recipeFiles.map((name) => {
    const file = join(recipesDir, name);
    return { file, name, data: JSON.parse(readFileSync(file, "utf8")) };
  });
  const localRefs = [
    ...new Set(
      recipes
        .map(({ data }) => data.image)
        .filter(
          (image) => typeof image === "string" && image.startsWith("/recipes/"),
        ),
    ),
  ].sort();

  const entries = localRefs.map((sourceRef) => {
    const relativePath = sourceRef.replace(/^\//, "");
    const sourcePath = join(publicDir, relativePath);
    const normalizedSource = resolve(sourcePath);
    if (!normalizedSource.startsWith(`${resolve(publicDir)}${posix.sep}`)) {
      throw new Error(`Image path escapes public/: ${sourceRef}`);
    }
    const bytes = readFileSync(sourcePath);
    const pathname = posix.join("cookbook", relativePath);
    return {
      sourceRef,
      sourcePath: relativePath,
      pathname,
      size: statSync(sourcePath).size,
      sha256: sha256(bytes),
      contentType: contentType(sourcePath),
    };
  });

  if (entries.length !== localRefs.length) {
    throw new Error("Image inventory contains duplicate entries");
  }
  return { recipeFiles, recipes, entries };
}

async function uploadEntry(entry) {
  try {
    const existing = await head(entry.pathname, { token });
    if (existing.size !== entry.size) {
      throw new Error(
        `Existing Blob size mismatch for ${entry.pathname}: ${existing.size} != ${entry.size}`,
      );
    }
    return { ...entry, url: existing.url, etag: existing.etag, status: "existing" };
  } catch (error) {
    if (!(error instanceof BlobNotFoundError)) throw error;
  }

  const body = readFileSync(join(publicDir, entry.sourcePath));
  const uploaded = await put(entry.pathname, body, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: entry.contentType,
    cacheControlMaxAge: 31_536_000,
    multipart: entry.size > 5 * 1024 * 1024,
    token,
  });
  const verified = await head(uploaded.pathname, { token });
  if (verified.size !== entry.size || verified.pathname !== entry.pathname) {
    throw new Error(`Post-upload verification failed for ${entry.pathname}`);
  }
  return { ...entry, url: uploaded.url, etag: verified.etag, status: "uploaded" };
}

async function mapConcurrent(items, mapper, limit) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

const { recipeFiles, recipes, entries } = readInventory();
const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
progress(
  `Inventory: ${recipeFiles.length} recipes, ${entries.length} referenced images, ${totalBytes} bytes`,
);

if (!apply) {
  progress("Dry run complete; no uploads or files changed");
  process.exit(0);
}

let completed = 0;
const uploadedEntries = await mapConcurrent(
  entries,
  async (entry) => {
    const result = await uploadEntry(entry);
    completed += 1;
    if (completed % 25 === 0 || completed === entries.length) {
      progress(`Blob reconciliation: ${completed}/${entries.length}`);
    }
    return result;
  },
  concurrency,
);

const bySourceRef = new Map(
  uploadedEntries.map((entry) => [entry.sourceRef, entry.url]),
);
for (const recipe of recipes) {
  if (bySourceRef.has(recipe.data.image)) {
    recipe.data.image = bySourceRef.get(recipe.data.image);
    writeFileSync(recipe.file, `${JSON.stringify(recipe.data, null, 2)}\n`);
  }
}

mkdirSync(dirname(manifestPath), { recursive: true });
const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceCommit: process.env.MIGRATION_SOURCE_COMMIT || null,
  recipeCount: recipeFiles.length,
  referencedImageCount: uploadedEntries.length,
  totalBytes,
  blobPrefix: "cookbook/recipes/",
  entries: uploadedEntries.map(({ status: _status, ...entry }) => entry),
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
progress(
  `Applied: ${uploadedEntries.length} Blob URLs written; manifest ${basename(manifestPath)}`,
);
