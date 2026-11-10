/**
 * My Recipes writes must work on both `recipes` table shapes.
 *
 * November 10, 2026: the first runtime-token import failed in production with
 * `NOT NULL constraint failed: recipes.name` — live Turso carries `name` and
 * `updated_at` next to the JSON `data`, while the local migration creates only
 * `(id, data, created_at)`. These tests run the real createMyRecipe /
 * updateMyRecipe against both shapes in an isolated local database.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NABU_DB_DIR = mkdtempSync(join(tmpdir(), "my-recipes-schema-test-"));
delete process.env.TURSO_DATABASE_URL;

import { equal, ok, rejects } from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  buildMyRecipeInsert,
  buildMyRecipeUpdate,
  createMyRecipe,
  getDb,
  getMyRecipe,
  updateMyRecipe,
} from "./db.ts";
import type { Recipe } from "./recipes.ts";

const recipe = (id: string, name: string): Recipe =>
  ({
    id,
    name,
    image: `https://example.public.blob.vercel-storage.com/recipes/${id}.jpg`,
    ingredients: [],
    method: [],
  }) as unknown as Recipe;

async function useLocalShape() {
  const db = await getDb();
  await db.execute("DROP TABLE IF EXISTS recipes");
  await db.execute(
    "CREATE TABLE recipes (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL)",
  );
}

// The live Turso shape as written by the earlier direct-import scripts.
async function useProductionShape() {
  const db = await getDb();
  await db.execute("DROP TABLE IF EXISTS recipes");
  await db.execute(
    `CREATE TABLE recipes (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       data TEXT NOT NULL,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL
     )`,
  );
}

describe("My Recipes on the production recipes shape (name, updated_at NOT NULL)", () => {
  beforeEach(useProductionShape);

  it("creates a recipe and fills name and updated_at", async () => {
    await createMyRecipe(recipe("test-soup", "Test Soup"));
    const db = await getDb();
    const row = (await db.execute("SELECT name, created_at, updated_at FROM recipes WHERE id = 'test-soup'")).rows[0];
    equal(row.name, "Test Soup");
    ok(row.created_at);
    equal(row.updated_at, row.created_at);
    equal((await getMyRecipe("test-soup"))?.name, "Test Soup");
  });

  it("updates data, name and updated_at", async () => {
    await createMyRecipe(recipe("test-soup", "Test Soup"));
    const db = await getDb();
    await db.execute("UPDATE recipes SET updated_at = '2000-01-01T00:00:00.000Z' WHERE id = 'test-soup'");
    await updateMyRecipe("test-soup", recipe("test-soup", "Better Test Soup"));
    const row = (await db.execute("SELECT name, updated_at FROM recipes WHERE id = 'test-soup'")).rows[0];
    equal(row.name, "Better Test Soup");
    ok(String(row.updated_at) > "2000-01-01T00:00:00.000Z");
    equal((await getMyRecipe("test-soup"))?.name, "Better Test Soup");
  });

  it("keeps the stored name when an update omits it", async () => {
    await createMyRecipe(recipe("test-soup", "Test Soup"));
    const partial = { ...recipe("test-soup", ""), name: undefined } as unknown as Recipe;
    await updateMyRecipe("test-soup", partial);
    const db = await getDb();
    const row = (await db.execute("SELECT name FROM recipes WHERE id = 'test-soup'")).rows[0];
    equal(row.name, "Test Soup");
  });

  it("still reports a missing recipe on update", async () => {
    await rejects(updateMyRecipe("nope", recipe("nope", "Nope")), /not found/);
  });
});

describe("My Recipes on the local recipes shape (id, data, created_at)", () => {
  beforeEach(useLocalShape);

  it("creates and updates without touching columns that do not exist", async () => {
    await createMyRecipe(recipe("test-soup", "Test Soup"));
    await updateMyRecipe("test-soup", recipe("test-soup", "Better Test Soup"));
    equal((await getMyRecipe("test-soup"))?.name, "Better Test Soup");
  });
});

describe("My Recipes statement builders", () => {
  it("only names the columns the table has", () => {
    const local = buildMyRecipeInsert(new Set(["id", "data", "created_at"]), { id: "a", name: "A" }, "{}", "T");
    equal(local.sql, "INSERT INTO recipes (id, data, created_at) VALUES (?, ?, ?)");
    const prod = buildMyRecipeInsert(
      new Set(["id", "name", "data", "created_at", "updated_at"]),
      { id: "a", name: "A" },
      "{}",
      "T",
    );
    equal(prod.sql, "INSERT INTO recipes (id, data, created_at, name, updated_at) VALUES (?, ?, ?, ?, ?)");
    equal(prod.args.join("|"), "a|{}|T|A|T");
    const upd = buildMyRecipeUpdate(new Set(["id", "data"]), "a", { name: "A" }, "{}", "T");
    equal(upd.sql, "UPDATE recipes SET data = ? WHERE id = ?");
  });
});
