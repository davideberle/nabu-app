import { createClient, type Client } from "@libsql/client";

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
      await client.execute("PRAGMA busy_timeout = 5000");
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
          source: { cookbook: "My Recipes", publication: "Das Magazin", author: "Christian Seiler", chapter: "Main Dishes" },
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
          source: { cookbook: "My Recipes", publication: "Fooby", author: "Fooby", chapter: "Baking" },
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
          source: { cookbook: "My Recipes", publication: "Fooby", author: "Fooby", chapter: "Dinner" },
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
