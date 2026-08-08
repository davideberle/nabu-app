import { createClient, type Client } from "@libsql/client";
// Explicit .ts extensions: db.ts is loaded directly by node --test and the
// repair/backfill script, whose ESM resolver does not add extensions.
import { assertRecipeImageValid } from "./recipe-image-validation.ts";
import {
  getRecentWeekIds,
  plannerPolicy,
  type PlannerPolicy,
} from "./meals-core.ts";
import {
  resetExposure,
  suppressedRecipeIds,
  type ExposureRecord,
} from "./planner-exposure.ts";
import {
  applyKeep,
  fingerprintFor,
  isStagedRecipe,
  promotedRecipe,
  type StagedWebRecipe,
  type StagingFingerprint,
} from "./planner-staging.ts";

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------
// Production / Vercel: set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.
// Local dev without Turso: leave both unset → falls back to a local SQLite
// file via the file: protocol (no network, no account required).
// ---------------------------------------------------------------------------

function buildUrl(): string {
  if (process.env.TURSO_DATABASE_URL) return process.env.TURSO_DATABASE_URL;
  const dir =
    process.env.NABU_DB_DIR ||
    (process.env.HOME
      ? `${process.env.HOME}/.openclaw/workspace/projects/companion-app/app`
      : "/tmp");
  return `file:${dir}/nabu.db`;
}

let _client: Client | null = null;
let _migrated = false;

function getClient(): Client {
  if (_client) return _client;
  _client = createClient({
    url: buildUrl(),
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  return _client;
}

export async function getDb(): Promise<Client> {
  const client = getClient();
  if (!_migrated) {
    // Enable WAL + busy_timeout for local file-based builds with parallel workers
    if (!process.env.TURSO_DATABASE_URL) {
      await client.execute("PRAGMA journal_mode = WAL");
      await client.execute("PRAGMA busy_timeout = 30000");
      // The first build after a new migration has every worker racing the
      // same migration write; WAL recovery can still surface SQLITE_BUSY
      // before busy_timeout applies, so retry briefly instead of failing.
      let attempts = 0;
      for (;;) {
        try {
          await migrate(client);
          break;
        } catch (error) {
          const busy =
            error instanceof Error && /SQLITE_BUSY/.test(String((error as { code?: string }).code ?? error.message));
          if (!busy || attempts >= 5) throw error;
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 250 * attempts));
        }
      }
    } else {
      await migrate(client);
    }
    _migrated = true;
  }
  return client;
}

// ---------------------------------------------------------------------------
// Schema & migrations
// ---------------------------------------------------------------------------

/**
 * Add a column only when it is missing.
 *
 * Production and older local databases disagree about several table shapes
 * (`web_recipe_inspirations` most of all), so a migration that blindly ALTERs
 * would fail on one of them. Reading `PRAGMA table_info` first keeps the
 * migration re-runnable and safe on both.
 */
async function addColumnIfMissing(
  client: Client,
  table: string,
  column: string,
  type: string,
): Promise<void> {
  const info = await client.execute(`PRAGMA table_info(${table})`);
  if (info.rows.some((row) => String(row.name) === column)) return;
  await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

async function migrate(client: Client) {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS schema_version (
      id    INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL DEFAULT 0
    )
  `);
  await client.execute(
    "INSERT OR IGNORE INTO schema_version (id, version) VALUES (1, 0)"
  );

  const versionResult = await client.execute(
    "SELECT version FROM schema_version WHERE id = 1"
  );
  const version = versionResult.rows[0]["version"] as number;

  const migrations: (() => Promise<void>)[] = [
    // v0 -> v1: create todos table and seed initial data
    async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS todos (
          id          TEXT PRIMARY KEY,
          title       TEXT NOT NULL,
          description TEXT,
          category    TEXT NOT NULL DEFAULT 'personal',
          priority    TEXT NOT NULL DEFAULT 'medium',
          due_date    TEXT,
          completed   INTEGER NOT NULL DEFAULT 0,
          created_at  TEXT NOT NULL
        )
      `);

      const seeds = [
        {
          id: "1",
          title: "Check kids' next doctor checkup",
          description: "Find out when the next scheduled checkup is",
          category: "family",
          priority: "medium",
          dueDate: null,
          completed: 0,
          createdAt: "2026-04-04T14:39:00Z",
        },
        {
          id: "2",
          title: "Call Gundeli Velos to fix e-bike",
          description: "E-bike needs repair",
          category: "home",
          priority: "medium",
          dueDate: null,
          completed: 0,
          createdAt: "2026-04-04T14:39:00Z",
        },
        {
          id: "3",
          title: "Review deeper backup strategy",
          description:
            "Decide whether to back up nested project repos and other state beyond the nightly root-workspace backup.",
          category: "work",
          priority: "medium",
          dueDate: null,
          completed: 0,
          createdAt: "2026-04-08T06:10:00Z",
        },
        {
          id: "4",
          title: "Document macOS Local Network permission root cause",
          description:
            "Write down that denying Local Network access for Terminal/Homebrew Node on the Mac mini broke Node LAN access, Sonos discovery, and the voice assistant debugging path.",
          category: "work",
          priority: "medium",
          dueDate: null,
          completed: 0,
          createdAt: "2026-04-08T17:36:00Z",
        },
      ];

      for (const seed of seeds) {
        await client.execute({
          sql: `INSERT OR IGNORE INTO todos (id, title, description, category, priority, due_date, completed, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            seed.id,
            seed.title,
            seed.description,
            seed.category,
            seed.priority,
            seed.dueDate,
            seed.completed,
            seed.createdAt,
          ],
        });
      }
    },

    // v1 -> v2: create recipes table and seed My Recipes
    async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS recipes (
          id         TEXT PRIMARY KEY,
          data       TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);

      const myRecipes = [
        {
          id: "ungarisches-paprikahuhn",
          name: "Ungarisches Paprikahuhn",
          image: "/recipes/ungarisches-paprikahuhn.jpg",
          source: { cookbook: "My Recipes", publication: "Das Magazin", author: "Christian Seiler" },
          cuisine: ["Hungarian"],
          category: "Main",
          servings: "4 servings",
          time: { total: 75, cook: 45 },
          intro: "A classic Hungarian paprika chicken (paprikás csirke) from Das Magazin, with onions, sweet and rose paprika, broth, tomatoes, and sour cream.",
          ingredients: [
            { amount: "1", item: "chicken, about 1.5 kg, cut into pieces" },
            { amount: "300 g", item: "onions, finely chopped" },
            { amount: "10 g", item: "garlic, pressed" },
            { amount: "40 ml", item: "pork or goose lard" },
            { amount: "10 g", item: "rose paprika powder" },
            { amount: "20 g", item: "sweet paprika powder" },
            { amount: "250 ml", item: "chicken broth" },
            { amount: "2", item: "tomatoes, chopped" },
            { amount: "250 g", item: "full-fat sour cream" },
            { amount: "10 g", item: "flour" },
            { amount: "5 g", item: "salt" },
          ],
          method: [
            "Melt the lard in a large braising pot over medium heat and sauté the onions until golden.",
            "Take the pot off the heat and let it cool slightly. Stir in the garlic and both paprika powders. Do not add paprika while the onions are too hot, or it can turn bitter.",
            "Salt the chicken pieces and add them to the pot with the chopped tomatoes. Mix well, pour in the chicken broth, cover, and braise on the lowest heat for 45 minutes.",
            "Near the end, whisk the sour cream with the flour and temper it with a little hot sauce from the pot. Stir it back into the chicken and bring briefly to a boil until the sauce turns creamy.",
            "Serve immediately, ideally with nokedli or spätzli. Good white bread also works well.",
          ],
          dietary: [],
          tags: ["Chicken", "Paprika", "Stew", "Main Dish", "Das Magazin"],
        },
        {
          id: "safran-honig-zopfkranz",
          name: "Safran-Honig-Zopfkranz",
          image: "/recipes/safran-honig-zopfkranz.jpg",
          source: { cookbook: "My Recipes", publication: "Fooby", author: "Fooby" },
          cuisine: "Swiss",
          category: "Bread",
          servings: "1 bread wreath (about 12 slices)",
          time: { prep: 25, total: 180 },
          intro: "A stunning saffron and honey braided bread wreath (Zopfkranz) — golden, fragrant, and lightly sweet. Perfect for Easter brunch or any festive breakfast.",
          tips: "The bread wreath tastes best served lukewarm.",
          ingredients: [
            { amount: "500 g", item: "Zopfmehl (braiding/bread flour)", group: "Dough" },
            { amount: "1¾ tsp", item: "salt", group: "Dough" },
            { amount: "½ cube", item: "fresh yeast (about 20 g), crumbled", group: "Dough" },
            { amount: "40 g", item: "cold butter, in small pieces", group: "Dough" },
            { amount: "250 g", item: "low-fat quark (Halbfettquark)", group: "Dough" },
            { amount: "50 g", item: "liquid honey", group: "Dough" },
            { amount: "1.5 dl", item: "water", group: "Dough" },
            { amount: "1 packet", item: "saffron threads", group: "Dough" },
            { amount: "1", item: "egg, beaten", group: "Topping" },
            { amount: "1 tbsp", item: "pearl sugar (Hagelzucker)", group: "Topping" },
            { amount: "2 tbsp", item: "liquid honey, for glazing", group: "Glaze" },
          ],
          method: [
            "Combine the flour, salt, and crumbled yeast in a large bowl and mix. Add the butter, quark, and honey.",
            "Stir the saffron into the water, then pour into the bowl. Mix and knead into a soft, smooth dough.",
            "Cover and let rise at room temperature for about 1½ hours until doubled in size.",
            "Divide the dough into two equal portions and roll each into a strand about 1 metre long. Braid the two strands together.",
            "Place the braid on a baking-paper-lined tray and join the ends to form a wreath. Cover and let rise for another 30 minutes.",
            "Brush the wreath with beaten egg and sprinkle with pearl sugar.",
            "Bake in the lower half of a preheated 180 °C oven for about 35 minutes.",
            "Remove from the oven and immediately brush with honey while still hot. Let cool slightly on a wire rack.",
          ],
          dietary: ["vegetarian"],
          tags: ["Bread", "Baking", "Brunch", "Easter", "Saffron", "Honey", "Swiss", "Fooby"],
          mealRole: "bread",
          madeHistory: [{ date: "2026-04-05", note: "Made last Sunday." }],
          lastMade: "2026-04-05",
        },
        {
          id: "wild-garlic-and-barley-fritters",
          name: "Wild Garlic and Barley Fritters",
          image: "/recipes/wild-garlic-and-barley-fritters.jpg",
          source: { cookbook: "My Recipes", publication: "Fooby", author: "Fooby" },
          cuisine: "Swiss",
          category: "dinner",
          servings: "4",
          time: { prep: 25, cook: 20, total: 45 },
          intro: "Crispy wild garlic and barley fritters with a tangy mustard cream dip — a light, seasonal spring dinner.",
          tips: "Rollgerste / Perlgerste is the right barley here — not barley flakes or barley flour. Let the cooked barley cool a little before mixing so the batter tightens up properly. Very good with a crisp green salad, asparagus, peas, or a yogurt-lemon side.",
          ingredients: [
            { amount: "100 g", item: "hulled pearl barley (Rollgerste)", group: "Fritters" },
            { amount: "600 ml", item: "vegetable bouillon", group: "Fritters" },
            { amount: "150 g", item: "carrots, coarsely grated", group: "Fritters" },
            { amount: "40 g", item: "white flour", group: "Fritters" },
            { amount: "1", item: "egg", group: "Fritters" },
            { amount: "1 bunch", item: "wild garlic, finely sliced", group: "Fritters" },
            { amount: "", item: "oil, for frying", group: "Fritters" },
            { amount: "", item: "salt and pepper", group: "Fritters" },
            { amount: "200 g", item: "sour single cream", group: "Dip" },
            { amount: "1.5 tbsp", item: "mustard", group: "Dip" },
            { amount: "", item: "a little salt", group: "Dip" },
          ],
          method: [
            "Bring the vegetable bouillon to the boil. Add the pearl barley and cook for about 20 minutes until tender, stirring occasionally.",
            "Drain the barley, transfer to a bowl, and leave it to cool slightly.",
            "Add the carrots, flour, egg, and wild garlic to the cooled barley. Mix well, season with salt and pepper, and stir until everything holds together.",
            "In a small bowl, mix the sour single cream with the mustard and a little salt to make the dip.",
            "Heat a little oil in a non-stick frying pan. Add the barley mixture in portions of about 1.5 tablespoons, flattening each into a small fritter.",
            "Fry for about 4 minutes per side until golden and cooked through.",
            "Serve the fritters hot with the mustard cream dip.",
          ],
          dietary: ["vegetarian"],
          tags: ["Spring", "Fritters", "Wild Garlic", "Family", "Fooby"],
          mealRole: "main",
        },
      ];

      for (const recipe of myRecipes) {
        await client.execute({
          sql: "INSERT OR IGNORE INTO recipes (id, data, created_at) VALUES (?, ?, ?)",
          args: [recipe.id, JSON.stringify(recipe), new Date().toISOString()],
        });
      }
    },

    // v2 -> v3: strip source.chapter from My Recipes — those values were
    // informal category labels (e.g. "Main Dishes", "Dinner") that the
    // cookbook page mistakenly displayed as chapter headings.
    async () => {
      const rows = await client.execute(
        "SELECT id, data FROM recipes"
      );
      for (const row of rows.rows) {
        const recipe = JSON.parse(row["data"] as string);
        if (recipe.source?.cookbook === "My Recipes" && recipe.source?.chapter) {
          delete recipe.source.chapter;
          await client.execute({
            sql: "UPDATE recipes SET data = ? WHERE id = ?",
            args: [JSON.stringify(recipe), row["id"] as string],
          });
        }
      }
    },

    // v3 -> v4: create meal_plans table for DB-backed weekly meal plans
    async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS meal_plans (
          week       TEXT PRIMARY KEY,
          data       TEXT NOT NULL,
          locked     INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
    },

    // v4 -> v5: create cook_events table for cooking history
    async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS cook_events (
          id         TEXT PRIMARY KEY,
          recipe_id  TEXT NOT NULL,
          cooked_on  TEXT NOT NULL,
          note       TEXT,
          source     TEXT,
          created_at TEXT NOT NULL
        )
      `);
      await client.execute(`
        CREATE INDEX IF NOT EXISTS idx_cook_events_recipe
          ON cook_events (recipe_id, cooked_on DESC)
      `);
      await client.execute(`
        CREATE INDEX IF NOT EXISTS idx_cook_events_date
          ON cook_events (cooked_on DESC)
      `);

      // Seed: David cooked white bean soup yesterday (2026-04-16)
      await client.execute({
        sql: `INSERT OR IGNORE INTO cook_events (id, recipe_id, cooked_on, note, source, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          "seed-white-bean-soup-20260416",
          "weisse-bohnen-suppe-mit-basilikum-und-mandeln",
          "2026-04-16",
          "Weisse-Bohnen-Suppe from Tanja Vegetarisch — creamy and delicious with the almond-basil pesto.",
          "seed",
          new Date().toISOString(),
        ],
      });
    },

    // v5 -> v6: import Schoggi-Weggli and Zopf from FOOBY into My Recipes
    async () => {
      const foobyImports = [
        {
          id: "schoggi-weggli",
          name: "Schoggi-Weggli",
          image: "/recipes/schoggi-weggli.jpg",
          source: { cookbook: "My Recipes", publication: "Fooby", author: "Fooby" },
          cuisine: "Swiss",
          category: "Bread",
          servings: "16 rolls",
          time: { prep: 25, total: 205 },
          intro: "Classic Swiss chocolate bread rolls — soft milk dough studded with dark chocolate chunks. Perfect for breakfast or a snack.",
          ingredients: [
            { amount: "500 g", item: "Halbweissmehl (semi-white flour)", group: "Dough" },
            { amount: "1½ EL", item: "sugar", group: "Dough" },
            { amount: "½ cube", item: "fresh yeast (about 20 g), crumbled", group: "Dough" },
            { amount: "1½ tsp", item: "salt", group: "Dough" },
            { amount: "3.5 dl", item: "milk", group: "Dough" },
            { amount: "60 g", item: "butter", group: "Dough" },
            { amount: "100 g", item: "dark chocolate, roughly chopped", group: "Dough" },
            { amount: "1", item: "egg, beaten", group: "Topping" },
          ],
          method: [
            "Combine the flour, salt, sugar, and crumbled yeast in a bowl and mix. Add the milk and knead with the dough hooks of a hand mixer for about 5 minutes.",
            "Add the butter and continue kneading for about 5 minutes until the dough is soft and smooth. Knead in the chopped chocolate.",
            "Cover and let rise at room temperature for about 2 hours until doubled in size.",
            "Divide the dough into 16 portions, shape into balls, and place on two baking-paper-lined trays. Cover and let rise for another 30 minutes.",
            "Brush the rolls with beaten egg.",
            "Bake each tray for about 15 minutes in the lower half of a 220 °C preheated oven. Cool on a wire rack.",
          ],
          dietary: ["vegetarian"],
          tags: ["Bread", "Baking", "Breakfast", "Chocolate", "Swiss", "Fooby"],
          mealRole: "bread",
        },
        {
          id: "zopf",
          name: "Zopf",
          image: "/recipes/zopf.jpg",
          source: { cookbook: "My Recipes", publication: "Fooby", author: "Fooby" },
          cuisine: "Swiss",
          category: "Bread",
          servings: "1 braided loaf (about 10 slices)",
          time: { prep: 40, total: 195 },
          intro: "The quintessential Swiss Sunday bread — a rich, buttery braided loaf with a golden egg-wash crust. A staple of every Swiss brunch table.",
          ingredients: [
            { amount: "500 g", item: "Zopfmehl (braiding/bread flour)", group: "Dough" },
            { amount: "1 tsp", item: "sugar", group: "Dough" },
            { amount: "½ cube", item: "fresh yeast (about 20 g), crumbled", group: "Dough" },
            { amount: "¾ EL", item: "salt", group: "Dough" },
            { amount: "80 g", item: "butter, in small pieces", group: "Dough" },
            { amount: "2", item: "eggs (1 for dough, 1 for glazing)", group: "Dough" },
            { amount: "2.5 dl", item: "milk", group: "Dough" },
          ],
          method: [
            "Combine the flour, salt, and sugar in a bowl and mix. Crumble in the yeast. Cut the butter into pieces, add with one egg and the milk, and knead into a soft, smooth dough.",
            "Cover and let rise at room temperature for about 1½ hours until doubled in size.",
            "Halve the dough and roll each half into a strand about 70 cm long, tapering slightly at the ends.",
            "Lay the two strands in a cross. Take the bottom end of the lower strand over to the opposite side, then repeat with the other strand. Continue braiding to the ends.",
            "Pinch the ends together and tuck them under the loaf. Place on a baking-paper-lined tray.",
            "Beat the remaining egg, brush the loaf, and let rise for another 30 minutes. Brush with egg again.",
            "Bake for about 35 minutes in the lower half of a 200 °C preheated oven. Cool on a wire rack.",
          ],
          dietary: ["vegetarian"],
          tags: ["Bread", "Baking", "Brunch", "Breakfast", "Swiss", "Fooby"],
          mealRole: "bread",
        },
      ];

      for (const recipe of foobyImports) {
        await client.execute({
          sql: "INSERT OR IGNORE INTO recipes (id, data, created_at) VALUES (?, ?, ?)",
          args: [recipe.id, JSON.stringify(recipe), new Date().toISOString()],
        });
      }
    },

    // v6 -> v7: create cooking_sessions table for live cooking sessions
    async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS cooking_sessions (
          id         TEXT PRIMARY KEY,
          date       TEXT NOT NULL,
          data       TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
      await client.execute(`
        CREATE INDEX IF NOT EXISTS idx_cooking_sessions_date
          ON cooking_sessions (date DESC)
      `);
    },

    // v7 -> v8: create recipe_feedback table for planner candidate preferences
    async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS recipe_feedback (
          recipe_id  TEXT PRIMARY KEY,
          feedback   TEXT NOT NULL CHECK (feedback IN ('up', 'down')),
          updated_at TEXT NOT NULL
        )
      `);
    },

    // v8 -> v9: create web_recipe_inspirations provenance table
    async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS web_recipe_inspirations (
          recipe_id   TEXT PRIMARY KEY,
          week        TEXT NOT NULL,
          source_url  TEXT NOT NULL,
          source_name TEXT NOT NULL,
          imported_at TEXT NOT NULL
        )
      `);
      await client.execute(`
        CREATE INDEX IF NOT EXISTS idx_web_recipe_inspirations_week
          ON web_recipe_inspirations (week)
      `);
    },

    // v9 -> v10: repair older web_recipe_inspirations tables created before imported_at existed
    async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS web_recipe_inspirations (
          recipe_id   TEXT PRIMARY KEY,
          week        TEXT NOT NULL,
          source_url  TEXT NOT NULL,
          source_name TEXT NOT NULL,
          imported_at TEXT
        )
      `);
      const columns = await client.execute("PRAGMA table_info(web_recipe_inspirations)");
      const hasImportedAt = columns.rows.some((row) => row.name === "imported_at");
      if (!hasImportedAt) {
        await client.execute("ALTER TABLE web_recipe_inspirations ADD COLUMN imported_at TEXT");
      }
      await client.execute("UPDATE web_recipe_inspirations SET imported_at = COALESCE(imported_at, datetime('now'))");
      await client.execute(`
        CREATE INDEX IF NOT EXISTS idx_web_recipe_inspirations_week
          ON web_recipe_inspirations (week)
      `);
    },

    // v10 -> v11: create wine_cellar_status table for tracking consumed bottles
    async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS wine_cellar_status (
          bottle_id  TEXT PRIMARY KEY,
          status     TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'out')),
          updated_at TEXT NOT NULL
        )
      `);
    },

    // v11 -> v12: create travel_item_states table for trip board status tracking
    async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS travel_item_states (
          trip_id    TEXT NOT NULL,
          item_id    TEXT NOT NULL,
          status     TEXT NOT NULL CHECK (status IN ('idea', 'planned', 'done')),
          updated_at TEXT NOT NULL,
          PRIMARY KEY (trip_id, item_id)
        )
      `);
    },

    // v12 -> v13: family board — completions, reward redemptions, board config
    async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS family_completions (
          person_id  TEXT NOT NULL,
          routine_id TEXT NOT NULL,
          week       TEXT NOT NULL,
          day        INTEGER NOT NULL,
          status     TEXT NOT NULL DEFAULT 'done',
          note       TEXT,
          created_at TEXT NOT NULL,
          PRIMARY KEY (person_id, routine_id, week, day)
        )
      `);
      await client.execute(`
        CREATE INDEX IF NOT EXISTS idx_family_completions_week
          ON family_completions (week, person_id)
      `);

      await client.execute(`
        CREATE TABLE IF NOT EXISTS family_reward_redemptions (
          id         TEXT PRIMARY KEY,
          person_id  TEXT NOT NULL,
          reward_id  TEXT NOT NULL,
          week       TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      await client.execute(`
        CREATE INDEX IF NOT EXISTS idx_family_redemptions_week
          ON family_reward_redemptions (week, person_id)
      `);

      await client.execute(`
        CREATE TABLE IF NOT EXISTS family_board_config (
          id         TEXT PRIMARY KEY DEFAULT 'default',
          data       TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
    },

    // v13 -> v14: health dashboard tables
    async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS health_daily_logs (
          date                TEXT PRIMARY KEY,
          breakfast_override  TEXT,
          lunch_note          TEXT,
          dinner_source       TEXT,
          dinner_summary      TEXT,
          day_note            TEXT,
          created_at          TEXT NOT NULL,
          updated_at          TEXT NOT NULL
        )
      `);

      await client.execute(`
        CREATE TABLE IF NOT EXISTS health_alcohol_events (
          id                    TEXT PRIMARY KEY,
          date                  TEXT NOT NULL,
          drink_type            TEXT NOT NULL,
          amount_label          TEXT,
          estimated_grams       REAL,
          context               TEXT,
          created_at            TEXT NOT NULL
        )
      `);
      await client.execute(`
        CREATE INDEX IF NOT EXISTS idx_health_alcohol_date
          ON health_alcohol_events (date)
      `);

      await client.execute(`
        CREATE TABLE IF NOT EXISTS health_sleep_reports (
          date           TEXT PRIMARY KEY,
          sleep_quality  TEXT,
          hours          REAL,
          note           TEXT,
          created_at     TEXT NOT NULL
        )
      `);

      await client.execute(`
        CREATE TABLE IF NOT EXISTS health_meditation_logs (
          date       TEXT PRIMARY KEY,
          minutes    INTEGER,
          completed  INTEGER NOT NULL DEFAULT 0,
          note       TEXT,
          created_at TEXT NOT NULL
        )
      `);
    },

    // v14 -> v15: weekly inspiration auto-ensure claims (Phase 3B) — one row
    // per ISO week so concurrent page loads cannot double-run the importer.
    async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS weekly_inspiration_ensure_runs (
          week         TEXT PRIMARY KEY,
          status       TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
          attempted_at TEXT NOT NULL,
          completed_at TEXT
        )
      `);
    },

    // v15 -> v16: weekly shopping drafts and the Bring outbox (Phase 4C).
    //
    // One draft per ISO week. `plan_fingerprint` pins the draft to the exact
    // set of planned recipes it was generated from, and `stale` records that a
    // meal-changing edit has since invalidated it — a stale or fingerprint-
    // mismatched draft can never be synced.
    //
    // The outbox is the only path from Vercel toward Bring: approval writes
    // rows here, and a trusted local worker consumes them. `id` is derived
    // from (week, channel, item) so re-approving a week cannot create a second
    // row for the same item.
    async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS shopping_drafts (
          week             TEXT PRIMARY KEY,
          status           TEXT NOT NULL CHECK (status IN ('draft', 'approved')),
          plan_fingerprint TEXT NOT NULL,
          stale            INTEGER NOT NULL DEFAULT 0,
          data             TEXT NOT NULL,
          approved_at      TEXT,
          created_at       TEXT NOT NULL,
          updated_at       TEXT NOT NULL
        )
      `);
      await client.execute(`
        CREATE TABLE IF NOT EXISTS shopping_outbox (
          id               TEXT PRIMARY KEY,
          week             TEXT NOT NULL,
          channel          TEXT NOT NULL,
          item_id          TEXT NOT NULL,
          item_name        TEXT NOT NULL,
          quantity         TEXT,
          reason           TEXT,
          plan_fingerprint TEXT NOT NULL,
          status           TEXT NOT NULL CHECK (status IN ('pending', 'synced', 'failed', 'cancelled')),
          attempts         INTEGER NOT NULL DEFAULT 0,
          last_error       TEXT,
          synced_at        TEXT,
          created_at       TEXT NOT NULL,
          updated_at       TEXT NOT NULL
        )
      `);
      await client.execute(`
        CREATE INDEX IF NOT EXISTS idx_shopping_outbox_status
          ON shopping_outbox (status, channel)
      `);
      await client.execute(`
        CREATE INDEX IF NOT EXISTS idx_shopping_outbox_week
          ON shopping_outbox (week)
      `);
    },

    // v16 -> v17: weekly preparation — exposure memory, web staging retention,
    // duplicate fingerprints, and preparation-run claims (Kitchen DESIGN.md
    // §4.3 "Weekly preparation", "Exposure and resurfacing policy", and the
    // web-inspiration lifecycle).
    //
    // `recipe_exposure` replaces the five-week offered lookback: one row per
    // catalog recipe that has been shown and not chosen. `web_recipe_inspirations`
    // gains the retention columns (`kept_at`, `promoted_at`) that make Keep
    // reversible and rollover promotion idempotent. `web_inspiration_fingerprints`
    // outlives expired staging rows so a deleted import is not rediscovered.
    // `planner_preparation_runs` is the claim that makes Thursday preparation
    // and the Friday watchdog safe to re-run.
    async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS recipe_exposure (
          recipe_id        TEXT PRIMARY KEY,
          exposure_count   INTEGER NOT NULL DEFAULT 0,
          first_exposed_at TEXT NOT NULL,
          last_exposed_at  TEXT NOT NULL,
          cooldown_until   TEXT,
          suppressed       INTEGER NOT NULL DEFAULT 0,
          updated_at       TEXT NOT NULL
        )
      `);
      await client.execute(`
        CREATE INDEX IF NOT EXISTS idx_recipe_exposure_cooldown
          ON recipe_exposure (suppressed, cooldown_until)
      `);

      await addColumnIfMissing(client, "web_recipe_inspirations", "kept_at", "TEXT");
      await addColumnIfMissing(client, "web_recipe_inspirations", "promoted_at", "TEXT");
      // How the idea was found. Editorial prominence is a discovery signal the
      // planner card shows honestly; it never implies planner eligibility.
      await addColumnIfMissing(client, "web_recipe_inspirations", "discovery", "TEXT");

      await client.execute(`
        CREATE TABLE IF NOT EXISTS web_inspiration_fingerprints (
          url_key     TEXT PRIMARY KEY,
          title_key   TEXT NOT NULL,
          source_name TEXT NOT NULL,
          expired_at  TEXT NOT NULL
        )
      `);
      await client.execute(`
        CREATE INDEX IF NOT EXISTS idx_web_inspiration_fingerprints_title
          ON web_inspiration_fingerprints (title_key)
      `);

      await client.execute(`
        CREATE TABLE IF NOT EXISTS planner_preparation_runs (
          week         TEXT NOT NULL,
          kind         TEXT NOT NULL CHECK (kind IN ('prepare', 'watchdog', 'rollover')),
          status       TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
          attempted_at TEXT NOT NULL,
          completed_at TEXT,
          summary      TEXT,
          PRIMARY KEY (week, kind)
        )
      `);
    },

    // v17 -> v18: durable rollover idempotency for exposure memory.
    //
    // `last_counted_week` records which week's shelf paid for the exposure that
    // is stored. Rollover reads it before writing, so re-running a week — after
    // a retry, a crash between the write and the claim update, or a manually
    // re-triggered run — can never turn one ignored appearance into a second
    // strike. Additive and idempotent: an existing row simply has NULL here and
    // behaves exactly as it did before.
    //
    // The CREATE comes first because a database can sit at v17 without ever
    // having run the v17 body — an older, shorter migrations array bumped some
    // live databases past a version whose statements they never executed, which
    // is the same drift `ensurePreparationTables` exists to absorb. Altering a
    // table that was never created would fail the whole migration, and with it
    // the build.
    async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS recipe_exposure (
          recipe_id        TEXT PRIMARY KEY,
          exposure_count   INTEGER NOT NULL DEFAULT 0,
          first_exposed_at TEXT NOT NULL,
          last_exposed_at  TEXT NOT NULL,
          cooldown_until   TEXT,
          suppressed       INTEGER NOT NULL DEFAULT 0,
          last_counted_week TEXT,
          updated_at       TEXT NOT NULL
        )
      `);
      await addColumnIfMissing(client, "recipe_exposure", "last_counted_week", "TEXT");
    },

    // v18 -> v19: the durable counted-weeks ledger for exposure.
    //
    // `last_counted_week` alone only survives an *in-order* retry. Selection
    // clears the strike and the marker together — correctly, since the recipe
    // is no longer being ignored — which leaves an older week's rollover free
    // to run again and reapply a strike the selection had already answered.
    // One row per (recipe, week) that was ever counted, never cleared by a
    // selection, closes that: a week in this table is finished for that recipe,
    // whatever happened afterwards.
    //
    // Purely additive: nothing reads it as a precondition, so an empty table on
    // an existing database behaves exactly as before.
    async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS recipe_exposure_weeks (
          recipe_id  TEXT NOT NULL,
          week       TEXT NOT NULL,
          counted_at TEXT NOT NULL,
          PRIMARY KEY (recipe_id, week)
        )
      `);
      await client.execute(`
        CREATE INDEX IF NOT EXISTS idx_recipe_exposure_weeks_week
          ON recipe_exposure_weeks (week)
      `);
    },
  ];

  if (version < migrations.length) {
    for (let i = version; i < migrations.length; i++) {
      await migrations[i]();
    }
    await client.execute({
      sql: "UPDATE schema_version SET version = ? WHERE id = 1",
      args: [migrations.length],
    });
  }
}

// ---------------------------------------------------------------------------
// Todo types & helpers
// ---------------------------------------------------------------------------

export type Todo = {
  id: string;
  title: string;
  description?: string;
  category: "family" | "home" | "work" | "personal";
  priority: "high" | "medium" | "low";
  dueDate?: string;
  completed: boolean;
  createdAt: string;
};

function rowToTodo(row: Record<string, unknown>): Todo {
  return {
    id: row["id"] as string,
    title: row["title"] as string,
    ...(row["description"] ? { description: row["description"] as string } : {}),
    category: row["category"] as Todo["category"],
    priority: row["priority"] as Todo["priority"],
    ...(row["due_date"] ? { dueDate: row["due_date"] as string } : {}),
    completed: (row["completed"] as number) === 1,
    createdAt: row["created_at"] as string,
  };
}

export async function getAllTodos(): Promise<Todo[]> {
  const client = await getDb();
  const result = await client.execute(
    "SELECT * FROM todos ORDER BY created_at ASC"
  );
  return result.rows.map((row) => rowToTodo(row as Record<string, unknown>));
}

export async function getTodo(id: string): Promise<Todo | undefined> {
  const client = await getDb();
  const result = await client.execute({
    sql: "SELECT * FROM todos WHERE id = ?",
    args: [id],
  });
  if (result.rows.length === 0) return undefined;
  return rowToTodo(result.rows[0] as Record<string, unknown>);
}

export async function createTodo(
  todo: Omit<Todo, "id" | "completed" | "createdAt"> & {
    id?: string;
    completed?: boolean;
    createdAt?: string;
  }
): Promise<Todo> {
  const client = await getDb();
  const id = todo.id || crypto.randomUUID();
  const createdAt = todo.createdAt || new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO todos (id, title, description, category, priority, due_date, completed, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      todo.title,
      todo.description || null,
      todo.category,
      todo.priority,
      todo.dueDate || null,
      todo.completed ? 1 : 0,
      createdAt,
    ],
  });
  return (await getTodo(id))!;
}

export async function updateTodo(
  id: string,
  updates: Partial<Omit<Todo, "id" | "createdAt">>
): Promise<Todo | undefined> {
  const existing = await getTodo(id);
  if (!existing) return undefined;

  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  if (updates.title !== undefined) {
    sets.push("title = ?");
    values.push(updates.title);
  }
  if (updates.description !== undefined) {
    sets.push("description = ?");
    values.push(updates.description || null);
  }
  if (updates.category !== undefined) {
    sets.push("category = ?");
    values.push(updates.category);
  }
  if (updates.priority !== undefined) {
    sets.push("priority = ?");
    values.push(updates.priority);
  }
  if (updates.dueDate !== undefined) {
    sets.push("due_date = ?");
    values.push(updates.dueDate || null);
  }
  if (updates.completed !== undefined) {
    sets.push("completed = ?");
    values.push(updates.completed ? 1 : 0);
  }

  if (sets.length === 0) return existing;

  values.push(id);
  const client = await getDb();
  await client.execute({
    sql: `UPDATE todos SET ${sets.join(", ")} WHERE id = ?`,
    args: values,
  });

  return getTodo(id);
}

export async function deleteTodo(id: string): Promise<boolean> {
  const client = await getDb();
  const result = await client.execute({
    sql: "DELETE FROM todos WHERE id = ?",
    args: [id],
  });
  return result.rowsAffected > 0;
}

// ---------------------------------------------------------------------------
// Recipe helpers (Turso-backed)
// ---------------------------------------------------------------------------

import type { Recipe } from "./recipes";

export async function getAllMyRecipes(): Promise<Recipe[]> {
  const client = await getDb();
  const result = await client.execute("SELECT data FROM recipes ORDER BY id");
  return result.rows
    .map((row) => JSON.parse(row["data"] as string) as Recipe)
    .filter((recipe) => recipe.visibility !== "planner-candidate");
}

export async function getMyRecipe(id: string): Promise<Recipe | undefined> {
  const client = await getDb();
  const result = await client.execute({
    sql: "SELECT data FROM recipes WHERE id = ?",
    args: [id],
  });
  if (result.rows.length === 0) return undefined;
  return JSON.parse(result.rows[0]["data"] as string) as Recipe;
}

// Image validation is handled by assertRecipeImageValid from recipe-images.ts.
// It accepts both Vercel Blob URLs (https://...) and local public/ paths.

export async function createMyRecipe(recipe: Recipe): Promise<void> {
  assertRecipeImageValid(recipe);

  const client = await getDb();
  await client.execute({
    sql: "INSERT INTO recipes (id, data, created_at) VALUES (?, ?, ?)",
    args: [recipe.id, JSON.stringify(recipe), new Date().toISOString()],
  });
}

export async function updateMyRecipe(
  id: string,
  recipe: Recipe
): Promise<void> {
  assertRecipeImageValid(recipe);

  const client = await getDb();
  const result = await client.execute({
    sql: "UPDATE recipes SET data = ? WHERE id = ?",
    args: [JSON.stringify(recipe), id],
  });
  if (result.rowsAffected === 0) {
    throw new Error(`My Recipe "${id}" not found in database.`);
  }
}

export async function deleteMyRecipe(id: string): Promise<boolean> {
  const client = await getDb();
  const result = await client.execute({
    sql: "DELETE FROM recipes WHERE id = ?",
    args: [id],
  });
  return result.rowsAffected > 0;
}


function collectMealSlotRecipeIds(slot: unknown, ids: Set<string>) {
  if (!slot || typeof slot !== "object") return;
  const record = slot as {
    main?: { id?: unknown };
    sides?: { id?: unknown }[];
  };
  if (typeof record.main?.id === "string" && record.main.id) {
    ids.add(record.main.id);
  }
  if (Array.isArray(record.sides)) {
    for (const side of record.sides) {
      if (typeof side?.id === "string" && side.id) ids.add(side.id);
    }
  }
}

function collectMealPlanRecipeIds(plan: { days?: unknown }): string[] {
  const ids = new Set<string>();
  const days = Array.isArray(plan.days) ? plan.days : [];
  for (const day of days) {
    if (!day || typeof day !== "object") continue;
    const record = day as Record<string, unknown>;
    if (typeof record.recipeId === "string" && record.recipeId) {
      ids.add(record.recipeId);
    }
    collectMealSlotRecipeIds(record.meal, ids);
    collectMealSlotRecipeIds(record.brunch, ids);
  }
  return [...ids];
}

function collectMealPlanCandidateRecipeIds(plan: { candidateSet?: unknown }): string[] {
  const ids = new Set<string>();
  const candidateSet = plan.candidateSet;
  if (!candidateSet || typeof candidateSet !== "object") return [];

  const items = (candidateSet as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const recipeId = (item as { recipeId?: unknown }).recipeId;
    if (typeof recipeId === "string" && recipeId) ids.add(recipeId);
  }
  return [...ids];
}

/** Get meal recipe IDs planned in the supplied ISO weeks, including sides/brunch. */
export async function getPlannedRecipeIdsForWeeks(
  weeks: string[]
): Promise<Set<string>> {
  const uniqueWeeks = [...new Set(weeks.filter(Boolean))];
  const ids = new Set<string>();
  if (uniqueWeeks.length === 0) return ids;

  const client = await getDb();
  const placeholders = uniqueWeeks.map(() => "?").join(", ");
  const result = await client.execute({
    sql: `SELECT data FROM meal_plans WHERE week IN (${placeholders})`,
    args: uniqueWeeks,
  });

  for (const row of result.rows) {
    try {
      const plan = JSON.parse(row["data"] as string) as { days?: unknown };
      for (const id of collectMealPlanRecipeIds(plan)) ids.add(id);
    } catch {
      // Ignore one malformed historical plan rather than breaking generation.
    }
  }

  return ids;
}

/**
 * Meal recipe ids planned in `fromWeek` **or any later week**, including sides
 * and brunch.
 *
 * Rollover needs this because retention is not bounded by the past: a staged
 * web idea can be assigned to a week that has not happened yet, and a bounded
 * backwards window would happily expire it. Week ids sort lexicographically
 * (`YYYY-Www`), so a single `>=` comparison is the whole query.
 */
export async function getPlannedRecipeIdsSince(fromWeek: string): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!fromWeek) return ids;

  const client = await getDb();
  const result = await client.execute({
    sql: "SELECT data FROM meal_plans WHERE week >= ?",
    args: [fromWeek],
  });

  for (const row of result.rows) {
    try {
      const plan = JSON.parse(row["data"] as string) as { days?: unknown };
      for (const id of collectMealPlanRecipeIds(plan)) ids.add(id);
    } catch {
      // Ignore one malformed historical plan rather than breaking rollover.
    }
  }

  return ids;
}

/**
 * Candidate recipe ids offered in the supplied weeks by shelves written under
 * an **older policy than** `currentPolicyVersion`.
 *
 * Exposure memory is the authoritative "he saw this and passed" signal for
 * shelves the current policy produced, and layering the old five-week offered
 * lookback on top of it would double-count the same appearance and shorten a
 * deliberate 12-week rest to five. Sets written before this policy never
 * produced an exposure record, though, so they still need the old guard — this
 * query returns exactly those and nothing else.
 */
export async function getLegacyOfferedRecipeIds(
  weeks: string[],
  currentPolicyVersion: string,
): Promise<Set<string>> {
  const uniqueWeeks = [...new Set(weeks.filter(Boolean))];
  const ids = new Set<string>();
  if (uniqueWeeks.length === 0) return ids;

  const client = await getDb();
  const placeholders = uniqueWeeks.map(() => "?").join(", ");
  const result = await client.execute({
    sql: `SELECT data FROM meal_plans WHERE week IN (${placeholders})`,
    args: uniqueWeeks,
  });

  for (const row of result.rows) {
    try {
      const plan = JSON.parse(row["data"] as string) as {
        candidateSet?: { policyVersion?: unknown } | null;
      };
      if (plan.candidateSet?.policyVersion === currentPolicyVersion) continue;
      for (const id of collectMealPlanCandidateRecipeIds(plan)) ids.add(id);
    } catch {
      // Ignore one malformed historical plan rather than breaking generation.
    }
  }

  return ids;
}

/** Get candidate recipe IDs saved on meal plans for the supplied ISO weeks. */
export async function getPlannerCandidateRecipeIdsForWeeks(
  weeks: string[]
): Promise<Set<string>> {
  const uniqueWeeks = [...new Set(weeks.filter(Boolean))];
  const ids = new Set<string>();
  if (uniqueWeeks.length === 0) return ids;

  const client = await getDb();
  const placeholders = uniqueWeeks.map(() => "?").join(", ");
  const result = await client.execute({
    sql: `SELECT data FROM meal_plans WHERE week IN (${placeholders})`,
    args: uniqueWeeks,
  });

  for (const row of result.rows) {
    try {
      const plan = JSON.parse(row["data"] as string) as { candidateSet?: unknown };
      for (const id of collectMealPlanCandidateRecipeIds(plan)) ids.add(id);
    } catch {
      // Ignore one malformed historical plan rather than breaking generation.
    }
  }

  return ids;
}

// ---------------------------------------------------------------------------
// Cook event types & helpers
// ---------------------------------------------------------------------------

export type CookEvent = {
  id: string;
  recipeId: string;
  cookedOn: string; // YYYY-MM-DD
  note?: string;
  source?: string; // e.g. "manual", "seed", "planner"
  createdAt: string;
};

function rowToCookEvent(row: Record<string, unknown>): CookEvent {
  return {
    id: row["id"] as string,
    recipeId: row["recipe_id"] as string,
    cookedOn: row["cooked_on"] as string,
    ...(row["note"] ? { note: row["note"] as string } : {}),
    ...(row["source"] ? { source: row["source"] as string } : {}),
    createdAt: row["created_at"] as string,
  };
}

/** Get all cook events for a specific recipe, newest first. */
export async function getCookEventsForRecipe(
  recipeId: string
): Promise<CookEvent[]> {
  const client = await getDb();
  const result = await client.execute({
    sql: "SELECT * FROM cook_events WHERE recipe_id = ? ORDER BY cooked_on DESC",
    args: [recipeId],
  });
  return result.rows.map((row) => rowToCookEvent(row as Record<string, unknown>));
}

/** Get the most recent cook events across all recipes, newest first. */
export async function getRecentCookEvents(
  limit = 20
): Promise<CookEvent[]> {
  const client = await getDb();
  const result = await client.execute({
    sql: "SELECT * FROM cook_events ORDER BY cooked_on DESC LIMIT ?",
    args: [limit],
  });
  return result.rows.map((row) => rowToCookEvent(row as Record<string, unknown>));
}

/** Get cook events for a date range, newest event first within each day. */
export async function getCookEventsForDateRange(
  from: string,
  to: string
): Promise<CookEvent[]> {
  const client = await getDb();
  const result = await client.execute({
    sql: `SELECT * FROM cook_events
          WHERE cooked_on >= ? AND cooked_on <= ?
          ORDER BY cooked_on DESC, created_at DESC`,
    args: [from, to],
  });
  return result.rows.map((row) => rowToCookEvent(row as Record<string, unknown>));
}

/** Get the last cooked date for a recipe, or null if never cooked. */
export async function getLastCookedDate(
  recipeId: string
): Promise<string | null> {
  const client = await getDb();
  const result = await client.execute({
    sql: "SELECT cooked_on FROM cook_events WHERE recipe_id = ? ORDER BY cooked_on DESC LIMIT 1",
    args: [recipeId],
  });
  if (result.rows.length === 0) return null;
  return result.rows[0]["cooked_on"] as string;
}

/** Get recipe IDs cooked in the last N days, for planner recency bias. */
export async function getRecentlyCookedRecipeIds(
  days = 14
): Promise<Set<string>> {
  const client = await getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split("T")[0];
  const result = await client.execute({
    sql: "SELECT DISTINCT recipe_id FROM cook_events WHERE cooked_on >= ?",
    args: [cutoffStr],
  });
  return new Set(result.rows.map((row) => row["recipe_id"] as string));
}

/** Log a new cook event. */
export async function createCookEvent(event: {
  recipeId: string;
  cookedOn: string;
  note?: string;
  source?: string;
}): Promise<CookEvent> {
  const client = await getDb();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO cook_events (id, recipe_id, cooked_on, note, source, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      event.recipeId,
      event.cookedOn,
      event.note || null,
      event.source || "manual",
      createdAt,
    ],
  });
  return {
    id,
    recipeId: event.recipeId,
    cookedOn: event.cookedOn,
    ...(event.note ? { note: event.note } : {}),
    source: event.source || "manual",
    createdAt,
  };
}

export async function createCookEventIfMissing(event: {
  recipeId: string;
  cookedOn: string;
  note?: string;
  source?: string;
}): Promise<{ event: CookEvent; created: boolean }> {
  const source = event.source || "manual";
  const client = await getDb();
  const existing = await client.execute({
    sql: `SELECT * FROM cook_events
          WHERE recipe_id = ? AND cooked_on = ? AND COALESCE(source, 'manual') = ?
          ORDER BY created_at DESC
          LIMIT 1`,
    args: [event.recipeId, event.cookedOn, source],
  });

  if (existing.rows.length > 0) {
    return {
      event: rowToCookEvent(existing.rows[0] as Record<string, unknown>),
      created: false,
    };
  }

  return {
    event: await createCookEvent({ ...event, source }),
    created: true,
  };
}

// ---------------------------------------------------------------------------
// Recipe feedback helpers (planner candidate preferences)
// ---------------------------------------------------------------------------

export type RecipeFeedback = {
  recipeId: string;
  feedback: "up" | "down";
  updatedAt: string;
};

/** Get all recipe feedback entries. */
export async function getAllRecipeFeedback(): Promise<RecipeFeedback[]> {
  const client = await getDb();
  const result = await client.execute(
    "SELECT recipe_id, feedback, updated_at FROM recipe_feedback"
  );
  return result.rows.map((row) => ({
    recipeId: row["recipe_id"] as string,
    feedback: row["feedback"] as "up" | "down",
    updatedAt: row["updated_at"] as string,
  }));
}

/** Set feedback for a recipe (upsert). Pass null to remove. */
export async function setRecipeFeedback(
  recipeId: string,
  feedback: "up" | "down" | null
): Promise<void> {
  const client = await getDb();
  if (feedback === null) {
    await client.execute({
      sql: "DELETE FROM recipe_feedback WHERE recipe_id = ?",
      args: [recipeId],
    });
  } else {
    await client.execute({
      sql: `INSERT INTO recipe_feedback (recipe_id, feedback, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT (recipe_id) DO UPDATE SET feedback = ?, updated_at = ?`,
      args: [recipeId, feedback, new Date().toISOString(), feedback, new Date().toISOString()],
    });
  }
}

/**
 * Get recipe IDs that have been thumbs-downed. With `withinDays`, only
 * feedback given inside that suppression window counts — older thumbs-downs
 * have served their time and the recipe may resurface (Phase 3B resurfacing
 * rules).
 */
export async function getThumbsDownRecipeIds(withinDays?: number): Promise<Set<string>> {
  const client = await getDb();
  if (withinDays === undefined) {
    const result = await client.execute(
      "SELECT recipe_id FROM recipe_feedback WHERE feedback = 'down'"
    );
    return new Set(result.rows.map((row) => row["recipe_id"] as string));
  }
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - withinDays);
  const result = await client.execute({
    sql: "SELECT recipe_id FROM recipe_feedback WHERE feedback = 'down' AND updated_at >= ?",
    args: [cutoff.toISOString()],
  });
  return new Set(result.rows.map((row) => row["recipe_id"] as string));
}

/** Get recipe IDs that have been thumbs-upped. */
export async function getThumbsUpRecipeIds(): Promise<Set<string>> {
  const client = await getDb();
  const result = await client.execute(
    "SELECT recipe_id FROM recipe_feedback WHERE feedback = 'up'"
  );
  return new Set(result.rows.map((row) => row["recipe_id"] as string));
}

// ---------------------------------------------------------------------------
// Planner recency exclusions (Phase 3B)
// ---------------------------------------------------------------------------

export type PlannerRecencyExclusions = {
  /** Recipes cooked within the policy's cooked window. */
  recentlyCooked: Set<string>;
  /** Recipes planned (main/sides/brunch) in recent prior weeks. */
  recentlyPlanned: Set<string>;
  /** Recipes offered in persisted candidate sets of recent prior weeks. */
  recentlyOffered: Set<string>;
  /** Recipes offered in the given week's own persisted candidate set. */
  currentWeekOffered: Set<string>;
  /** Recipes under an active thumbs-down suppression window. */
  negativeFeedback: Set<string>;
};

/**
 * One authoritative assembly of the planner's recency/feedback exclusion sets
 * for a week. Candidate generation, web-inspiration filtering, and the
 * candidate-set save boundary all read from this instead of composing their
 * own variants.
 */
export async function getPlannerRecencyExclusions(
  week: string,
  policy: PlannerPolicy = plannerPolicy(),
): Promise<PlannerRecencyExclusions> {
  const priorWeeks = getRecentWeekIds(week, policy.recentWeeksLookback);
  const [recentlyCooked, recentlyPlanned, recentlyOffered, currentWeekOffered, negativeFeedback] =
    await Promise.all([
      getRecentlyCookedRecipeIds(policy.recentlyCookedDays),
      getPlannedRecipeIdsForWeeks(priorWeeks),
      getPlannerCandidateRecipeIdsForWeeks(priorWeeks),
      getPlannerCandidateRecipeIdsForWeeks([week]),
      getThumbsDownRecipeIds(policy.negativeFeedbackDays),
    ]);
  return { recentlyCooked, recentlyPlanned, recentlyOffered, currentWeekOffered, negativeFeedback };
}

// ---------------------------------------------------------------------------
// Weekly inspiration ensure claims (Phase 3B)
// ---------------------------------------------------------------------------

/**
 * Idempotently ensure the ensure-runs table exists. Guards against
 * schema_version being ahead of the migrations array, mirroring
 * ensureTravelItemStatesTable.
 */
async function ensureWeeklyInspirationEnsureTable(client: Client): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS weekly_inspiration_ensure_runs (
      week         TEXT PRIMARY KEY,
      status       TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
      attempted_at TEXT NOT NULL,
      completed_at TEXT
    )
  `);
}

const ENSURE_STALE_RUNNING_MINUTES = 10;
const ENSURE_RETRY_COOLDOWN_MINUTES = 6 * 60;

/**
 * Atomically claim the weekly-inspiration ensure slot for a week. Returns true
 * when this caller should run the importer. A completed attempt (succeeded or
 * failed) blocks re-claims until the cooldown passes, so retries stay
 * idempotent and bounded; a crashed `running` row unblocks after a short
 * staleness window.
 */
export async function claimWeeklyInspirationEnsure(week: string): Promise<boolean> {
  const client = await getDb();
  await ensureWeeklyInspirationEnsureTable(client);
  const now = new Date();
  const staleRunning = new Date(now.getTime() - ENSURE_STALE_RUNNING_MINUTES * 60_000).toISOString();
  const retryCutoff = new Date(now.getTime() - ENSURE_RETRY_COOLDOWN_MINUTES * 60_000).toISOString();
  const result = await client.execute({
    sql: `INSERT INTO weekly_inspiration_ensure_runs (week, status, attempted_at, completed_at)
          VALUES (?, 'running', ?, NULL)
          ON CONFLICT(week) DO UPDATE SET
            status = 'running',
            attempted_at = excluded.attempted_at,
            completed_at = NULL
          WHERE (weekly_inspiration_ensure_runs.status = 'running' AND weekly_inspiration_ensure_runs.attempted_at < ?)
             OR (weekly_inspiration_ensure_runs.status IN ('succeeded', 'failed') AND weekly_inspiration_ensure_runs.attempted_at < ?)`,
    args: [week, now.toISOString(), staleRunning, retryCutoff],
  });
  return result.rowsAffected > 0;
}

/** Record the outcome of a claimed weekly-inspiration ensure run. */
export async function completeWeeklyInspirationEnsure(
  week: string,
  status: "succeeded" | "failed",
): Promise<void> {
  const client = await getDb();
  await ensureWeeklyInspirationEnsureTable(client);
  await client.execute({
    sql: `UPDATE weekly_inspiration_ensure_runs
          SET status = ?, completed_at = ?
          WHERE week = ?`,
    args: [status, new Date().toISOString(), week],
  });
}

// ---------------------------------------------------------------------------
// Web recipe inspirations provenance
// ---------------------------------------------------------------------------

export type WebRecipeInspiration = {
  recipe_id: string;
  week: string;
  source_url: string;
  source_name: string;
  imported_at: string;
  recipe_name?: string;
  image?: string | null;
  status?: string;
};

async function getWebInspirationColumns(client: Client): Promise<Set<string>> {
  const columns = await client.execute("PRAGMA table_info(web_recipe_inspirations)");
  return new Set(columns.rows.map((row) => String(row.name)));
}

async function hasWebInspirationImportedAt(client: Client): Promise<boolean> {
  const columns = await getWebInspirationColumns(client);
  return columns.has("imported_at");
}

/** Get recent web inspiration provenance rows, newest first. */
export async function getRecentWebInspirations(
  limit = 100
): Promise<WebRecipeInspiration[]> {
  const client = await getDb();
  const hasImportedAt = await hasWebInspirationImportedAt(client);
  if (!hasImportedAt) {
    await client.execute("ALTER TABLE web_recipe_inspirations ADD COLUMN imported_at TEXT");
  }
  const result = await client.execute({
    sql: `SELECT * FROM web_recipe_inspirations
          ORDER BY COALESCE(imported_at, updated_at, created_at, week) DESC
          LIMIT ?`,
    args: [limit],
  });
  return result.rows as unknown as WebRecipeInspiration[];
}

/** Record provenance for a web inspiration recipe. */
export async function recordWebInspiration(
  recipeId: string,
  week: string,
  sourceUrl: string,
  sourceName: string,
  discovery: "editorial" | "search" = "search"
): Promise<void> {
  const client = await getDb();
  await ensureStagingColumns(client);
  const columns = await getWebInspirationColumns(client);
  if (!columns.has("imported_at")) {
    await client.execute("ALTER TABLE web_recipe_inspirations ADD COLUMN imported_at TEXT");
    columns.add("imported_at");
  }

  const now = new Date().toISOString();

  // The live Turso table has richer provenance columns than older local DBs.
  // Fill those columns when present, but keep the old compact schema working too.
  if (columns.has("id")) {
    let recipeName = recipeId;
    let image: string | null = null;
    const recipeResult = await client.execute({
      sql: "SELECT data FROM recipes WHERE id = ?",
      args: [recipeId],
    });
    if (recipeResult.rows.length > 0) {
      try {
        const recipe = JSON.parse(recipeResult.rows[0]["data"] as string) as Recipe;
        recipeName = recipe.name || recipeId;
        image = recipe.image || null;
      } catch {
        // Keep provenance recording best-effort; recipe JSON is still stored separately.
      }
    }

    await client.execute({
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
        crypto.randomUUID(),
        week,
        recipeId,
        recipeName,
        sourceName,
        sourceUrl,
        image,
        "imported",
        JSON.stringify({ source: "weekly-inspirations", discovery }),
        now,
        now,
        now,
        discovery,
      ],
    });
    return;
  }

  await client.execute({
    sql: `INSERT INTO web_recipe_inspirations (recipe_id, week, source_url, source_name, imported_at, discovery)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (recipe_id) DO UPDATE SET
            source_name = excluded.source_name,
            discovery = excluded.discovery`,
    args: [
      recipeId,
      week,
      sourceUrl,
      sourceName,
      now,
      discovery,
    ],
  });
}

/** Get all web inspirations for a given ISO week. */
export async function getWebInspirationsForWeek(
  week: string
): Promise<WebRecipeInspiration[]> {
  const client = await getDb();
  const hasImportedAt = await hasWebInspirationImportedAt(client);
  if (!hasImportedAt) {
    await client.execute("ALTER TABLE web_recipe_inspirations ADD COLUMN imported_at TEXT");
  }
  const result = await client.execute({
    sql: "SELECT * FROM web_recipe_inspirations WHERE week = ? ORDER BY imported_at DESC",
    args: [week],
  });
  return result.rows as unknown as WebRecipeInspiration[];
}

// ---------------------------------------------------------------------------
// Recipe exposure memory (weekly preparation)
// ---------------------------------------------------------------------------

/**
 * Idempotently ensure the weekly-preparation tables exist, mirroring
 * `ensureWeeklyInspirationEnsureTable`. Guards against a `schema_version` that
 * is ahead of the migrations array on an older database.
 */
async function ensurePreparationTables(client: Client): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS recipe_exposure (
      recipe_id        TEXT PRIMARY KEY,
      exposure_count   INTEGER NOT NULL DEFAULT 0,
      first_exposed_at TEXT NOT NULL,
      last_exposed_at  TEXT NOT NULL,
      cooldown_until   TEXT,
      suppressed       INTEGER NOT NULL DEFAULT 0,
      last_counted_week TEXT,
      updated_at       TEXT NOT NULL
    )
  `);
  // A table created by the v17 migration predates the column. Adding it here
  // too keeps the rollover idempotency guarantee true on a database whose
  // schema_version ran ahead of this code.
  await addColumnIfMissing(client, "recipe_exposure", "last_counted_week", "TEXT");
  await client.execute(`
    CREATE TABLE IF NOT EXISTS recipe_exposure_weeks (
      recipe_id  TEXT NOT NULL,
      week       TEXT NOT NULL,
      counted_at TEXT NOT NULL,
      PRIMARY KEY (recipe_id, week)
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS web_inspiration_fingerprints (
      url_key     TEXT PRIMARY KEY,
      title_key   TEXT NOT NULL,
      source_name TEXT NOT NULL,
      expired_at  TEXT NOT NULL
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS planner_preparation_runs (
      week         TEXT NOT NULL,
      kind         TEXT NOT NULL CHECK (kind IN ('prepare', 'watchdog', 'rollover')),
      status       TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
      attempted_at TEXT NOT NULL,
      completed_at TEXT,
      summary      TEXT,
      PRIMARY KEY (week, kind)
    )
  `);
}

function rowToExposure(row: Record<string, unknown>): ExposureRecord {
  return {
    recipeId: row["recipe_id"] as string,
    exposureCount: Number(row["exposure_count"] ?? 0),
    firstExposedAt: row["first_exposed_at"] as string,
    lastExposedAt: row["last_exposed_at"] as string,
    cooldownUntil: (row["cooldown_until"] as string | null) ?? null,
    suppressed: Number(row["suppressed"] ?? 0) === 1,
    lastCountedWeek: (row["last_counted_week"] as string | null) ?? null,
    updatedAt: row["updated_at"] as string,
  };
}

/** Every exposure record, keyed by recipe id. */
export async function getExposureRecords(): Promise<Map<string, ExposureRecord>> {
  const client = await getDb();
  await ensurePreparationTables(client);
  const result = await client.execute("SELECT * FROM recipe_exposure");
  return new Map(result.rows.map((row) => {
    const record = rowToExposure(row as unknown as Record<string, unknown>);
    return [record.recipeId, record];
  }));
}

/**
 * Recipe ids the *automatic* shelf must not offer: on cooldown after one
 * ignored appearance, or suppressed after a second. Explicit search/request
 * paths deliberately do not call this.
 */
export async function getExposureExcludedRecipeIds(now = new Date()): Promise<Set<string>> {
  const records = await getExposureRecords();
  return suppressedRecipeIds(records.values(), now);
}

export async function saveExposureRecords(records: readonly ExposureRecord[]): Promise<void> {
  if (records.length === 0) return;
  const client = await getDb();
  await ensurePreparationTables(client);
  await client.batch(
    records.map((record) => ({
      sql: `INSERT INTO recipe_exposure
              (recipe_id, exposure_count, first_exposed_at, last_exposed_at, cooldown_until, suppressed, last_counted_week, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (recipe_id) DO UPDATE SET
              exposure_count = excluded.exposure_count,
              last_exposed_at = excluded.last_exposed_at,
              cooldown_until = excluded.cooldown_until,
              suppressed = excluded.suppressed,
              last_counted_week = excluded.last_counted_week,
              updated_at = excluded.updated_at`,
      args: [
        record.recipeId,
        record.exposureCount,
        record.firstExposedAt,
        record.lastExposedAt,
        record.cooldownUntil,
        record.suppressed ? 1 : 0,
        record.lastCountedWeek,
        record.updatedAt,
      ],
    })),
    "write",
  );
}

/**
 * Recipe ids whose exposure has already been counted against `week`.
 *
 * The durable half of rollover idempotency. Unlike `recipe_exposure`, these
 * rows are never cleared by a selection: they record which weeks have been
 * *processed*, not what a recipe's current standing is. That distinction is
 * what stops a re-run of an older week from reapplying a strike that a later
 * week's selection already cleared.
 */
export async function getCountedExposureRecipeIds(week: string): Promise<Set<string>> {
  if (!week) return new Set<string>();
  const client = await getDb();
  await ensurePreparationTables(client);
  const result = await client.execute({
    sql: "SELECT recipe_id FROM recipe_exposure_weeks WHERE week = ?",
    args: [week],
  });
  return new Set(result.rows.map((row) => String(row["recipe_id"])));
}

/** Append counted (recipe, week) pairs. Idempotent: a repeat is a no-op. */
export async function saveCountedExposureRecipeIds(
  week: string,
  recipeIds: readonly string[],
  at = new Date(),
): Promise<void> {
  const unique = [...new Set(recipeIds.filter(Boolean))];
  if (!week || unique.length === 0) return;
  const client = await getDb();
  await ensurePreparationTables(client);
  await client.batch(
    unique.map((recipeId) => ({
      sql: `INSERT INTO recipe_exposure_weeks (recipe_id, week, counted_at)
            VALUES (?, ?, ?)
            ON CONFLICT (recipe_id, week) DO NOTHING`,
      args: [recipeId, week, at.toISOString()],
    })),
    "write",
  );
}

/** Explicit reset — David asked for a suppressed recipe back. */
export async function resetRecipeExposure(recipeId: string, at = new Date()): Promise<void> {
  const records = await getExposureRecords();
  await saveExposureRecords([resetExposure(records.get(recipeId) ?? null, recipeId, at)]);
}

// ---------------------------------------------------------------------------
// Web staging retention, Keep, promotion, expiry
// ---------------------------------------------------------------------------

function rowToStagedWebRecipe(row: Record<string, unknown>): StagedWebRecipe {
  return {
    recipeId: String(row["recipe_id"] ?? ""),
    week: String(row["week"] ?? ""),
    sourceUrl: String(row["source_url"] ?? ""),
    sourceName: String(row["source_name"] ?? ""),
    importedAt: String(row["imported_at"] ?? row["created_at"] ?? ""),
    keptAt: (row["kept_at"] as string | null) ?? null,
    promotedAt: (row["promoted_at"] as string | null) ?? null,
    recipeName: (row["recipe_name"] as string | null) ?? null,
    discovery: ((row["discovery"] as string | null) ?? null) as StagedWebRecipe["discovery"],
  };
}

async function ensureStagingColumns(client: Client): Promise<void> {
  await addColumnIfMissing(client, "web_recipe_inspirations", "kept_at", "TEXT");
  await addColumnIfMissing(client, "web_recipe_inspirations", "promoted_at", "TEXT");
  await addColumnIfMissing(client, "web_recipe_inspirations", "discovery", "TEXT");
}

/** All staged web records, optionally limited to specific ISO weeks. */
export async function getStagedWebRecipes(weeks?: readonly string[]): Promise<StagedWebRecipe[]> {
  const client = await getDb();
  await ensureStagingColumns(client);
  const unique = weeks ? [...new Set(weeks.filter(Boolean))] : null;
  if (unique && unique.length === 0) return [];
  const result = unique
    ? await client.execute({
        sql: `SELECT * FROM web_recipe_inspirations WHERE week IN (${unique.map(() => "?").join(", ")})`,
        args: unique,
      })
    : await client.execute("SELECT * FROM web_recipe_inspirations");
  return result.rows.map((row) => rowToStagedWebRecipe(row as unknown as Record<string, unknown>));
}

/**
 * Staged web records imported before `before`, whatever week they belong to.
 *
 * Rollover used to look at a bounded span of recent weeks, which meant a
 * record whose rollover was missed for longer than the retention window was
 * never read again and leaked forever. Age is the actual rule the retention
 * window states, so this asks for age directly.
 */
export async function getStagedWebRecipesImportedBefore(before: Date): Promise<StagedWebRecipe[]> {
  const client = await getDb();
  await ensureStagingColumns(client);
  const columns = await getWebInspirationColumns(client);
  // Older compact tables have no created_at/updated_at; a row with no usable
  // timestamp at all is returned rather than hidden, and `planRollover` treats
  // its age as zero, so it is retained instead of being deleted on a guess.
  const timestamps = ["imported_at", "created_at", "updated_at"].filter((column) => columns.has(column));
  if (timestamps.length === 0) return [];
  const expression = timestamps.length === 1 ? timestamps[0] : `COALESCE(${timestamps.join(", ")})`;
  const result = await client.execute({
    sql: `SELECT * FROM web_recipe_inspirations WHERE ${expression} IS NULL OR ${expression} < ?`,
    args: [before.toISOString()],
  });
  return result.rows.map((row) => rowToStagedWebRecipe(row as unknown as Record<string, unknown>));
}

/**
 * Toggle the reversible Keep intent for a staged web recipe. Returns the stored
 * record, or null when the recipe is not a staged web idea for that week.
 */
export async function setWebInspirationKeep(
  recipeId: string,
  kept: boolean,
  at = new Date(),
): Promise<StagedWebRecipe | null> {
  const client = await getDb();
  await ensureStagingColumns(client);
  const existing = await client.execute({
    sql: "SELECT * FROM web_recipe_inspirations WHERE recipe_id = ? LIMIT 1",
    args: [recipeId],
  });
  if (existing.rows.length === 0) return null;

  const record = applyKeep(
    rowToStagedWebRecipe(existing.rows[0] as unknown as Record<string, unknown>),
    kept,
    at,
  );
  await client.execute({
    sql: "UPDATE web_recipe_inspirations SET kept_at = ? WHERE recipe_id = ?",
    args: [record.keptAt, recipeId],
  });
  return record;
}

/**
 * Promote a staged web recipe into normal My Recipes, preserving its true
 * publication/source. Idempotent: a record with `promoted_at` set is left alone.
 */
export async function promoteStagedWebRecipe(
  record: StagedWebRecipe,
  at = new Date(),
): Promise<boolean> {
  const client = await getDb();
  await ensureStagingColumns(client);
  const result = await client.execute({
    sql: "SELECT data FROM recipes WHERE id = ?",
    args: [record.recipeId],
  });
  if (result.rows.length === 0) return false;

  const stored = JSON.parse(result.rows[0]["data"] as string) as Recipe;
  const promoted = promotedRecipe(stored, record);
  const columns = await client.execute("PRAGMA table_info(recipes)");
  const hasUpdatedAt = columns.rows.some((row) => String(row.name) === "updated_at");
  await client.execute({
    sql: hasUpdatedAt
      ? "UPDATE recipes SET data = ?, updated_at = ? WHERE id = ?"
      : "UPDATE recipes SET data = ? WHERE id = ?",
    args: hasUpdatedAt
      ? [JSON.stringify(promoted), at.toISOString(), record.recipeId]
      : [JSON.stringify(promoted), record.recipeId],
  });
  await client.execute({
    sql: "UPDATE web_recipe_inspirations SET promoted_at = ? WHERE recipe_id = ?",
    args: [at.toISOString(), record.recipeId],
  });
  return true;
}

/**
 * Expire an unkept staging record: delete the hidden recipe row and the
 * provenance row, but keep a lightweight fingerprint so the same page is not
 * rediscovered next week.
 */
export async function expireStagedWebRecipe(
  record: StagedWebRecipe,
  at = new Date(),
): Promise<void> {
  const client = await getDb();
  await ensurePreparationTables(client);

  const fingerprint = fingerprintFor(record, at);
  await client.execute({
    sql: `INSERT INTO web_inspiration_fingerprints (url_key, title_key, source_name, expired_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (url_key) DO UPDATE SET
            title_key = excluded.title_key,
            source_name = excluded.source_name,
            expired_at = excluded.expired_at`,
    args: [fingerprint.urlKey, fingerprint.titleKey, fingerprint.sourceName, fingerprint.expiredAt],
  });

  // Only a still-hidden staging row is deleted. A recipe that was promoted (or
  // manually un-hidden) is David's now and must survive expiry of its provenance.
  const stored = await client.execute({
    sql: "SELECT data FROM recipes WHERE id = ?",
    args: [record.recipeId],
  });
  if (stored.rows.length > 0) {
    const recipe = JSON.parse(stored.rows[0]["data"] as string) as Recipe;
    if (isStagedRecipe(recipe)) {
      await client.execute({ sql: "DELETE FROM recipes WHERE id = ?", args: [record.recipeId] });
    }
  }
  await client.execute({
    sql: "DELETE FROM web_recipe_inspirations WHERE recipe_id = ?",
    args: [record.recipeId],
  });
}

export async function getStagingFingerprints(): Promise<StagingFingerprint[]> {
  const client = await getDb();
  await ensurePreparationTables(client);
  const result = await client.execute("SELECT * FROM web_inspiration_fingerprints");
  return result.rows.map((row) => ({
    urlKey: String(row["url_key"] ?? ""),
    titleKey: String(row["title_key"] ?? ""),
    sourceName: String(row["source_name"] ?? ""),
    expiredAt: String(row["expired_at"] ?? ""),
  }));
}

// ---------------------------------------------------------------------------
// Weekly preparation / watchdog run claims
// ---------------------------------------------------------------------------

export type PreparationKind = "prepare" | "watchdog" | "rollover";

const PREPARATION_STALE_RUNNING_MINUTES = 15;

/**
 * Atomically claim a preparation run for (week, kind). Returns true when this
 * caller should do the work.
 *
 * Unlike the inspiration ensure claim there is no success cooldown: the Friday
 * watchdog is *meant* to run after Thursday's preparation succeeded. What the
 * claim prevents is two concurrent runs of the same kind, and it releases a
 * crashed `running` row after a staleness window.
 */
export async function claimPlannerPreparation(
  week: string,
  kind: PreparationKind,
  now = new Date(),
): Promise<boolean> {
  const client = await getDb();
  await ensurePreparationTables(client);
  const staleRunning = new Date(now.getTime() - PREPARATION_STALE_RUNNING_MINUTES * 60_000).toISOString();
  const result = await client.execute({
    sql: `INSERT INTO planner_preparation_runs (week, kind, status, attempted_at, completed_at, summary)
          VALUES (?, ?, 'running', ?, NULL, NULL)
          ON CONFLICT(week, kind) DO UPDATE SET
            status = 'running',
            attempted_at = excluded.attempted_at,
            completed_at = NULL,
            summary = NULL
          WHERE planner_preparation_runs.status <> 'running'
             OR planner_preparation_runs.attempted_at < ?`,
    args: [week, kind, now.toISOString(), staleRunning],
  });
  return result.rowsAffected > 0;
}

export async function completePlannerPreparation(
  week: string,
  kind: PreparationKind,
  status: "succeeded" | "failed",
  summary?: unknown,
  now = new Date(),
): Promise<void> {
  const client = await getDb();
  await ensurePreparationTables(client);
  await client.execute({
    sql: `UPDATE planner_preparation_runs
          SET status = ?, completed_at = ?, summary = ?
          WHERE week = ? AND kind = ?`,
    args: [status, now.toISOString(), summary === undefined ? null : JSON.stringify(summary), week, kind],
  });
}

export type PreparationRun = {
  week: string;
  kind: PreparationKind;
  status: "running" | "succeeded" | "failed";
  attemptedAt: string;
  completedAt: string | null;
  summary: unknown;
};

export async function getPlannerPreparationRuns(week: string): Promise<PreparationRun[]> {
  const client = await getDb();
  await ensurePreparationTables(client);
  const result = await client.execute({
    sql: "SELECT * FROM planner_preparation_runs WHERE week = ?",
    args: [week],
  });
  return result.rows.map((row) => {
    const summaryRaw = row["summary"] as string | null;
    let summary: unknown = null;
    if (summaryRaw) {
      try { summary = JSON.parse(summaryRaw); } catch { summary = summaryRaw; }
    }
    return {
      week: String(row["week"]),
      kind: String(row["kind"]) as PreparationKind,
      status: String(row["status"]) as "running" | "succeeded" | "failed",
      attemptedAt: String(row["attempted_at"]),
      completedAt: (row["completed_at"] as string | null) ?? null,
      summary,
    };
  });
}

// ---------------------------------------------------------------------------
// Wine cellar helpers
// ---------------------------------------------------------------------------

export type WineCellarStatus = {
  bottleId: string;
  status: "available" | "out";
  updatedAt: string;
};

/** Get status map for all bottles that have a status row. */
export async function getWineCellarStatuses(): Promise<
  Map<string, WineCellarStatus>
> {
  const client = await getDb();
  try {
    const result = await client.execute(
      "SELECT bottle_id, status, updated_at FROM wine_cellar_status"
    );
    const map = new Map<string, WineCellarStatus>();
    for (const row of result.rows) {
      map.set(row["bottle_id"] as string, {
        bottleId: row["bottle_id"] as string,
        status: row["status"] as "available" | "out",
        updatedAt: row["updated_at"] as string,
      });
    }
    return map;
  } catch {
    // Table may not exist yet if migration hasn't run (e.g. build prerender)
    return new Map();
  }
}

/** Mark a bottle as "out" (consumed). */
export async function markBottleOut(bottleId: string): Promise<void> {
  const client = await getDb();
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO wine_cellar_status (bottle_id, status, updated_at)
          VALUES (?, 'out', ?)
          ON CONFLICT (bottle_id) DO UPDATE SET status = 'out', updated_at = ?`,
    args: [bottleId, now, now],
  });
}

/** Mark a bottle back as "available" (undo). */
export async function markBottleAvailable(bottleId: string): Promise<void> {
  const client = await getDb();
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO wine_cellar_status (bottle_id, status, updated_at)
          VALUES (?, 'available', ?)
          ON CONFLICT (bottle_id) DO UPDATE SET status = 'available', updated_at = ?`,
    args: [bottleId, now, now],
  });
}

// ---------------------------------------------------------------------------
// Travel item state helpers
// ---------------------------------------------------------------------------

export type TravelItemState = {
  tripId: string;
  itemId: string;
  status: "idea" | "planned" | "done";
  updatedAt: string;
};

/**
 * Idempotently ensure the travel_item_states table exists.
 * Guards against schema_version being ahead of the migrations array,
 * which can cause the migration that creates this table to be skipped.
 */
async function ensureTravelItemStatesTable(client: Client): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS travel_item_states (
      trip_id    TEXT NOT NULL,
      item_id    TEXT NOT NULL,
      status     TEXT NOT NULL CHECK (status IN ('idea', 'planned', 'done')),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (trip_id, item_id)
    )
  `);
}

/** Get all item states for a trip. */
export async function getTravelItemStates(
  tripId: string
): Promise<Map<string, TravelItemState>> {
  const client = await getDb();
  await ensureTravelItemStatesTable(client);
  try {
    const result = await client.execute({
      sql: "SELECT trip_id, item_id, status, updated_at FROM travel_item_states WHERE trip_id = ?",
      args: [tripId],
    });
    const map = new Map<string, TravelItemState>();
    for (const row of result.rows) {
      map.set(row["item_id"] as string, {
        tripId: row["trip_id"] as string,
        itemId: row["item_id"] as string,
        status: row["status"] as "idea" | "planned" | "done",
        updatedAt: row["updated_at"] as string,
      });
    }
    return map;
  } catch {
    return new Map();
  }
}

/** Set the status for a travel item (upsert). */
export async function setTravelItemStatus(
  tripId: string,
  itemId: string,
  status: "idea" | "planned" | "done"
): Promise<void> {
  const client = await getDb();
  await ensureTravelItemStatesTable(client);
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO travel_item_states (trip_id, item_id, status, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (trip_id, item_id) DO UPDATE SET status = ?, updated_at = ?`,
    args: [tripId, itemId, status, now, status, now],
  });
}

// ---------------------------------------------------------------------------
// Shopping invalidation at the meal-plan save boundary
//
// The planner owns one shopping invariant: a draft is only ever shoppable
// while it still matches the plan it came from. A meal-changing edit or an
// explicit reopen has to withdraw it in the same transaction as the plan
// write, which is what these two helpers do. The draft/outbox read and write
// surfaces themselves belong to the shopping feature and land with it.
// ---------------------------------------------------------------------------

/**
 * Why a week's shopping state is being invalidated, and how far.
 *
 * `markStale` distinguishes the two cases:
 *
 * - a meal-changing edit (`markStale: true`) — the draft is now about a meal
 *   that is not happening, so it must be regenerated before it can be approved;
 * - an explicit reopen (`markStale: false`) — the planned meals are unchanged,
 *   so the draft still describes the right week, but the approval it was
 *   syncing under is withdrawn and its queued rows are cancelled.
 */
export type ShoppingInvalidation = { markStale: boolean; reason: string };

const INVALIDATION_SQL = {
  draft: `UPDATE shopping_drafts
          SET stale = MAX(stale, ?), status = 'draft', approved_at = NULL, updated_at = ?
          WHERE week = ?`,
  outbox: `UPDATE shopping_outbox
           SET status = 'cancelled', last_error = ?, updated_at = ?
           WHERE week = ? AND status IN ('pending', 'failed')`,
};

/**
 * Invalidate a week's shopping draft.
 *
 * Returns the draft to `draft` status, optionally marks it stale, and cancels
 * every still-pending or failed outbox row for the week. A `synced` row is left
 * alone — it already reached Bring, and cancelling it would misreport history.
 *
 * Safe to call for a week with no draft: it is a no-op. Database errors are
 * **not** swallowed; the v16 migration guarantees these tables exist, so a
 * failure here is a real failure and the caller must treat it as one.
 *
 * Callers that also write the meal plan must use
 * `saveMealPlanRowWithInvalidation` instead, so the two cannot come apart.
 */
export async function invalidateShoppingDraftForWeek(
  week: string,
  invalidation: ShoppingInvalidation = { markStale: true, reason: "plan changed after approval" },
): Promise<{ invalidatedDraft: boolean; cancelledItems: number }> {
  const client = await getDb();
  const now = new Date().toISOString();
  const [draft, cancelled] = await client.batch(
    [
      { sql: INVALIDATION_SQL.draft, args: [invalidation.markStale ? 1 : 0, now, week] },
      { sql: INVALIDATION_SQL.outbox, args: [invalidation.reason, now, week] },
    ],
    "write",
  );
  return {
    invalidatedDraft: Number(draft.rowsAffected ?? 0) > 0,
    cancelledItems: Number(cancelled.rowsAffected ?? 0),
  };
}

/**
 * Write a meal plan row and, in the same transaction, invalidate the week's
 * shopping state.
 *
 * The reason this is one statement group and not three calls: the plan write
 * and the invalidation are a single fact about the week. Writing the plan first
 * and invalidating afterwards leaves a window — and, if the invalidation fails,
 * a permanent state — where a finalized-looking draft and its pending outbox
 * rows describe meals that are no longer planned. The worker would then sync
 * them. Either everything lands or nothing does.
 */
export async function saveMealPlanRowWithInvalidation(input: {
  week: string;
  data: string;
  locked: boolean;
  createdAt: string;
  updatedAt: string;
  invalidate: ShoppingInvalidation | null;
}): Promise<{ invalidatedDraft: boolean; cancelledItems: number }> {
  const client = await getDb();
  const planStatement = {
    sql: `INSERT INTO meal_plans (week, data, locked, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(week) DO UPDATE SET
            data = excluded.data,
            locked = excluded.locked,
            updated_at = excluded.updated_at`,
    args: [input.week, input.data, input.locked ? 1 : 0, input.createdAt, input.updatedAt],
  };

  if (!input.invalidate) {
    await client.execute(planStatement);
    return { invalidatedDraft: false, cancelledItems: 0 };
  }

  const [, draft, cancelled] = await client.batch(
    [
      planStatement,
      {
        sql: INVALIDATION_SQL.draft,
        args: [input.invalidate.markStale ? 1 : 0, input.updatedAt, input.week],
      },
      {
        sql: INVALIDATION_SQL.outbox,
        args: [input.invalidate.reason, input.updatedAt, input.week],
      },
    ],
    "write",
  );
  return {
    invalidatedDraft: Number(draft.rowsAffected ?? 0) > 0,
    cancelledItems: Number(cancelled.rowsAffected ?? 0),
  };
}
