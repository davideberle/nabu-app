import { createClient, type Client } from "@libsql/client";
import { assertRecipeImageValid } from "./recipe-image-validation";

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
    }
    await migrate(client);
    _migrated = true;
  }
  return client;
}

// ---------------------------------------------------------------------------
// Schema & migrations
// ---------------------------------------------------------------------------

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

    // v7 -> v8: create candidate_feedback table for planner thumbs up/down
    async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS candidate_feedback (
          recipe_id  TEXT NOT NULL,
          week       TEXT NOT NULL,
          feedback   TEXT NOT NULL CHECK (feedback IN ('up', 'down')),
          created_at TEXT NOT NULL,
          PRIMARY KEY (recipe_id, week)
        )
      `);
      await client.execute(`
        CREATE INDEX IF NOT EXISTS idx_candidate_feedback_week
          ON candidate_feedback (week)
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
  return result.rows.map((row) => JSON.parse(row["data"] as string) as Recipe);
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

// ---------------------------------------------------------------------------
// Candidate feedback helpers (planner thumbs up / down)
// ---------------------------------------------------------------------------

export type CandidateFeedback = {
  recipeId: string;
  week: string;
  feedback: "up" | "down";
  createdAt: string;
};

/** Get all feedback for a given week. */
export async function getCandidateFeedback(
  week: string
): Promise<CandidateFeedback[]> {
  const client = await getDb();
  const result = await client.execute({
    sql: "SELECT recipe_id, week, feedback, created_at FROM candidate_feedback WHERE week = ?",
    args: [week],
  });
  return result.rows.map((row) => ({
    recipeId: row["recipe_id"] as string,
    week: row["week"] as string,
    feedback: row["feedback"] as "up" | "down",
    createdAt: row["created_at"] as string,
  }));
}

/** Get all thumbs-down recipe IDs (across all weeks) for exclusion. */
export async function getThumbsDownRecipeIds(): Promise<Set<string>> {
  const client = await getDb();
  const result = await client.execute(
    "SELECT DISTINCT recipe_id FROM candidate_feedback WHERE feedback = 'down'"
  );
  return new Set(result.rows.map((row) => row["recipe_id"] as string));
}

/** Upsert feedback for a recipe in a given week. */
export async function setCandidateFeedback(
  recipeId: string,
  week: string,
  feedback: "up" | "down"
): Promise<void> {
  const client = await getDb();
  await client.execute({
    sql: `INSERT INTO candidate_feedback (recipe_id, week, feedback, created_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(recipe_id, week) DO UPDATE SET
            feedback = excluded.feedback,
            created_at = excluded.created_at`,
    args: [recipeId, week, feedback, new Date().toISOString()],
  });
}

/** Remove feedback for a recipe in a given week. */
export async function removeCandidateFeedback(
  recipeId: string,
  week: string
): Promise<void> {
  const client = await getDb();
  await client.execute({
    sql: "DELETE FROM candidate_feedback WHERE recipe_id = ? AND week = ?",
    args: [recipeId, week],
  });
}
