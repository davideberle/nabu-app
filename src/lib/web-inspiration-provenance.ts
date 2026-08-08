/**
 * The one definition of a `web_recipe_inspirations` provenance write.
 *
 * Two runtimes have to record the same fact — "this recipe came from this page,
 * on this source, for this week, found this way":
 *
 *   - the app (`db.ts`), when a browser-triggered research run accepts an idea
 *   - the Kitchen importer (`scripts/weekly-inspirations.mjs`), which is what
 *     actually performs the weekly staging write on David's Mac
 *
 * They must not drift. Production and older local databases also carry two
 * different shapes of this table — a rich one keyed by `id` with a unique
 * `source_url`, and the original compact one keyed by `recipe_id` — and getting
 * that wrong in one of the two writers is exactly the kind of silent divergence
 * that produced a shelf with `webSelected: 0`.
 *
 * So the statement itself lives here: pure, dependency-free, and shared. The
 * callers supply a client and the values; this module decides the SQL. Node
 * strips the types, so the importer can import it directly.
 */

/** Discovery mode. Shown on the card; never a qualification. */
export type WebInspirationDiscovery = "editorial" | "search";

export type WebInspirationProvenanceInput = {
  recipeId: string;
  week: string;
  sourceUrl: string;
  sourceName: string;
  discovery: WebInspirationDiscovery;
  /** Denormalized display fields, only stored by the rich schema. */
  recipeName?: string | null;
  image?: string | null;
};

export type SqlStatement = { sql: string; args: (string | number | null)[] };

/**
 * The compact table, exactly as migration v9 created it.
 *
 * The importer may meet a database that has never been opened by the app (a
 * fresh local fixture), so it needs to be able to create the table — and it has
 * to create *this* table, not a lookalike.
 */
export const WEB_INSPIRATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS web_recipe_inspirations (
    recipe_id   TEXT PRIMARY KEY,
    week        TEXT NOT NULL,
    source_url  TEXT NOT NULL,
    source_name TEXT NOT NULL,
    imported_at TEXT
  )
`;

export const WEB_INSPIRATIONS_WEEK_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_web_recipe_inspirations_week
    ON web_recipe_inspirations (week)
`;

/**
 * Columns added after the table was first created. Both writers add whichever
 * are missing before writing, so a provenance row always carries its staging
 * state and its discovery mode.
 */
export const WEB_INSPIRATION_ADDED_COLUMNS: readonly { name: string; type: string }[] = [
  { name: "kept_at", type: "TEXT" },
  { name: "promoted_at", type: "TEXT" },
  { name: "discovery", type: "TEXT" },
  { name: "imported_at", type: "TEXT" },
];

/** True when the table is the richer production shape keyed by `id`. */
export function isRichWebInspirationSchema(columns: ReadonlySet<string>): boolean {
  return columns.has("id");
}

/**
 * The upsert for one provenance row.
 *
 * Idempotent on both shapes, which is what makes a re-run of the weekly staging
 * safe: the rich table conflicts on its unique `source_url` and the compact one
 * on `recipe_id`, and either way the row is refreshed rather than duplicated.
 *
 * `kept_at` and `promoted_at` are deliberately never written here. They are
 * David's retention state, and a re-import must not quietly un-keep an idea he
 * already pressed Keep on.
 */
export function buildWebInspirationUpsert(
  columns: ReadonlySet<string>,
  input: WebInspirationProvenanceInput,
  context: { id: string; now: string },
): SqlStatement {
  if (isRichWebInspirationSchema(columns)) {
    return {
      sql: `INSERT INTO web_recipe_inspirations
              (id, week, recipe_id, recipe_name, source_name, source_url, image, status, provenance_json, created_at, updated_at, imported_at, discovery)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (source_url) DO UPDATE SET
              recipe_name = excluded.recipe_name,
              source_name = excluded.source_name,
              image = excluded.image,
              status = excluded.status,
              discovery = excluded.discovery,
              updated_at = excluded.updated_at`,
      args: [
        context.id,
        input.week,
        input.recipeId,
        input.recipeName || input.recipeId,
        input.sourceName,
        input.sourceUrl,
        input.image ?? null,
        "imported",
        JSON.stringify({ source: "weekly-inspirations", discovery: input.discovery }),
        context.now,
        context.now,
        context.now,
        input.discovery,
      ],
    };
  }

  return {
    sql: `INSERT INTO web_recipe_inspirations (recipe_id, week, source_url, source_name, imported_at, discovery)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (recipe_id) DO UPDATE SET
            source_name = excluded.source_name,
            discovery = excluded.discovery`,
    args: [
      input.recipeId,
      input.week,
      input.sourceUrl,
      input.sourceName,
      context.now,
      input.discovery,
    ],
  };
}

/** Normalize whatever a caller labelled the discovery mode as. */
export function normalizeDiscovery(value: unknown): WebInspirationDiscovery {
  return value === "editorial" ? "editorial" : "search";
}
