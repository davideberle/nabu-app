import { deepStrictEqual, equal, rejects } from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createClient, type Client } from "@libsql/client";
import { houseAssets as seedAssets } from "../data/house-assets.ts";

// Next normally resolves this marker internally. In Node's server-side test
// runner only, supply an empty marker so the actual store can be exercised.
register(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: "data:text/javascript,export{}", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
`)}`, import.meta.url);
const { getHouseAssets } = await import("./house-assets.ts");

// Entirely synthetic fixture: no private household records belong in git.
const syntheticAsset = {
  id: "test-lamp",
  name: "Test lamp",
  category: "Test",
  brand: "Example",
  model: "Fixture",
  description: "Synthetic asset for isolated store verification.",
  maintenance: [{ task: "Inspect", frequency: "Annual", notes: "Synthetic note" }],
  statusAreas: [{ label: "Service history", status: "available", detail: "2000-01-01: synthetic inspection" }],
};

describe("private house asset runtime store", () => {
  let client: Client;

  before(async () => {
    const directory = await mkdtemp(join(tmpdir(), "nabu-house-assets-test-"));
    client = createClient({ url: `file:${join(directory, "assets.db")}` });
  });
  after(() => client.close());

  async function write(id: string, data: unknown) {
    await client.execute({
      sql: "INSERT OR REPLACE INTO house_assets (id, data, updated_at) VALUES (?, ?, ?)",
      args: [id, JSON.stringify(data), "2000-01-01T00:00:00Z"],
    });
  }

  it("creates only its table and preserves the complete bundled inventory", async () => {
    deepStrictEqual(await getHouseAssets(client), seedAssets);
    deepStrictEqual(await getHouseAssets(client), seedAssets);
    const schema = await client.execute("PRAGMA table_info(house_assets)");
    deepStrictEqual(schema.rows.map((row) => [row.name, row.type, row.notnull, row.pk]), [
      ["id", "TEXT", 0, 1], ["data", "TEXT", 1, 0], ["updated_at", "TEXT", 1, 0],
    ]);
    const tables = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table'");
    deepStrictEqual(tables.rows.map((row) => row.name), ["house_assets"]);
    const rows = await client.execute("SELECT COUNT(*) AS count FROM house_assets");
    equal(rows.rows[0].count, 0, "seeds are not copied into private runtime storage");
  });

  it("loads a synthetic unknown-year asset with dated service detail and observes later updates", async () => {
    await write(syntheticAsset.id, syntheticAsset);
    const assets = await getHouseAssets(client);
    equal(assets.length, seedAssets.length + 1);
    deepStrictEqual(assets.find((asset) => asset.id === syntheticAsset.id), syntheticAsset);
    equal(assets.find((asset) => asset.id === syntheticAsset.id)?.acquiredYear, undefined);
    await write(syntheticAsset.id, { ...syntheticAsset, name: "Updated test lamp" });
    equal((await getHouseAssets(client)).find((asset) => asset.id === syntheticAsset.id)?.name, "Updated test lamp");
  });

  it("overrides a seed by stable ID without adding a duplicate", async () => {
    const override = { ...syntheticAsset, id: seedAssets[0].id };
    await write(override.id, override);
    const assets = await getHouseAssets(client);
    equal(assets.length, seedAssets.length + 1);
    equal(new Set(assets.map((asset) => asset.id)).size, assets.length);
    deepStrictEqual(assets.find((asset) => asset.id === override.id), override);
    deepStrictEqual(seedAssets[0].name, "Quamar Q50E", "bundled seed remains unchanged");
  });

  it("fails closed for malformed JSON, ID mismatch, and invalid nested or optional fields", async () => {
    const invalidRecords = [
      null,
      { ...syntheticAsset, id: "different-id" },
      { ...syntheticAsset, name: " " },
      { ...syntheticAsset, acquiredYear: null },
      { ...syntheticAsset, acquiredYear: "2000" },
      { ...syntheticAsset, acquiredYear: 2000.5 },
      { ...syntheticAsset, acquiredYear: 0 },
      { ...syntheticAsset, acquiredYear: 10000 },
      { ...syntheticAsset, maintenance: [{ task: "Inspect", frequency: 3 }] },
      { ...syntheticAsset, maintenance: [{ task: "Inspect", frequency: "Annual", notes: {} }] },
      { ...syntheticAsset, statusAreas: [{ label: "Service", status: "invalid" }] },
      { ...syntheticAsset, statusAreas: [{ label: "Service", status: "available", detail: [] }] },
      { ...syntheticAsset, warnings: [5] },
    ];
    for (const record of invalidRecords) {
      await write(syntheticAsset.id, record);
      await rejects(getHouseAssets(client), { message: "Invalid private house asset record" });
    }
    await client.execute({
      sql: "UPDATE house_assets SET data = ? WHERE id = ?",
      args: ["{ malformed synthetic JSON", syntheticAsset.id],
    });
    await rejects(getHouseAssets(client), { message: "Invalid private house asset JSON" });
    await write(syntheticAsset.id, { ...syntheticAsset, acquiredYear: 2000, warnings: ["Synthetic warning"] });
    equal((await getHouseAssets(client)).find((asset) => asset.id === syntheticAsset.id)?.acquiredYear, 2000);
  });

  it("does not hide database failures behind a seed-only inventory", async () => {
    await rejects(getHouseAssets({ execute: async () => { throw new Error("Synthetic database failure"); } }), /Synthetic database failure/);
  });
});
