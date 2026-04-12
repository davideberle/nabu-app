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
  // Local fallback: file-based SQLite in the project directory.
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
        CREATE TABLE todos (
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
          sql: `INSERT INTO todos (id, title, description, category, priority, due_date, completed, created_at)
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
