import "server-only";

import type { Client } from "@libsql/client";
import { houseAssets as seedAssets, type HouseAsset } from "../data/house-assets.ts";
import { getDb } from "./db.ts";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOptionalText(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

/** Validate runtime records before rendering; never include private data in errors. */
function parseAsset(id: unknown, data: unknown): HouseAsset {
  let asset: unknown;
  try {
    if (typeof data !== "string") throw new Error();
    asset = JSON.parse(data);
  } catch {
    throw new Error("Invalid private house asset JSON");
  }

  if (
    !isObject(asset) ||
    !isText(id) || asset.id !== id ||
    ![asset.name, asset.category, asset.brand, asset.model, asset.description].every(isText) ||
    (asset.acquiredYear !== undefined && (
      !Number.isInteger(asset.acquiredYear) ||
      typeof asset.acquiredYear !== "number" ||
      asset.acquiredYear < 1 || asset.acquiredYear > 9999
    )) ||
    !Array.isArray(asset.maintenance) ||
    !asset.maintenance.every((task: unknown) =>
      isObject(task) && isText(task.task) && isText(task.frequency) && isOptionalText(task.notes)
    ) ||
    !Array.isArray(asset.statusAreas) ||
    !asset.statusAreas.every((area: unknown) =>
      isObject(area) && isText(area.label) &&
      ["available", "pending", "not-tracked"].includes(String(area.status)) &&
      isOptionalText(area.detail)
    ) ||
    (asset.warnings !== undefined && (
      !Array.isArray(asset.warnings) || !asset.warnings.every(isText)
    ))
  ) {
    throw new Error("Invalid private house asset record");
  }

  return asset as unknown as HouseAsset;
}

/**
 * Runtime-only private records override bundled seeds by stable ID.
 * The injectable client is for isolated database verification, not a write API.
 * Do not fall back to a partial inventory when the private store is unavailable.
 */
export async function getHouseAssets(client?: Pick<Client, "execute">): Promise<HouseAsset[]> {
  const db = client ?? await getDb();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS house_assets (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  const result = await db.execute("SELECT id, data FROM house_assets ORDER BY id");
  const assets = new Map(seedAssets.map((asset) => [asset.id, asset]));
  for (const row of result.rows) {
    const asset = parseAsset(row.id, row.data);
    assets.set(asset.id, asset);
  }
  return [...assets.values()];
}
