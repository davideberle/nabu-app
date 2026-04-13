import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// Store DB alongside other app data in the openclaw workspace.
// Falls back to .data/ in the project root for other environments.
const DB_DIR =
  process.env.NABU_DB_DIR ||
  path.join(
    process.env.HOME || "/tmp",
    ".openclaw/workspace/projects/companion-app/app"
  );

const DB_PATH = path.join(DB_DIR, "nabu.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  fs.mkdirSync(DB_DIR, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  migrate(_db);

  return _db;
}

// ---------------------------------------------------------------------------
// Schema & migrations
// ---------------------------------------------------------------------------

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      id    INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO schema_version (id, version) VALUES (1, 0);
  `);

  const version = (
    db.prepare("SELECT version FROM schema_version WHERE id = 1").get() as {
      version: number;
    }
  ).version;

  const migrations: (() => void)[] = [
    // v0 -> v1: create todos table and seed initial data
    () => {
      db.exec(`
        CREATE TABLE todos (
          id          TEXT PRIMARY KEY,
          title       TEXT NOT NULL,
          description TEXT,
          category    TEXT NOT NULL DEFAULT 'personal',
          priority    TEXT NOT NULL DEFAULT 'medium',
          due_date    TEXT,
          completed   INTEGER NOT NULL DEFAULT 0,
          created_at  TEXT NOT NULL
        );
      `);

      // Seed the original hardcoded todos so behaviour is preserved.
      const insert = db.prepare(`
        INSERT INTO todos (id, title, description, category, priority, due_date, completed, created_at)
        VALUES (@id, @title, @description, @category, @priority, @dueDate, @completed, @createdAt)
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
        insert.run(seed);
      }
    },
  ];

  if (version < migrations.length) {
    db.transaction(() => {
      for (let i = version; i < migrations.length; i++) {
        migrations[i]();
      }
      db.prepare("UPDATE schema_version SET version = ? WHERE id = 1").run(
        migrations.length
      );
    })();
  }
}

// ---------------------------------------------------------------------------
// Todo types & helpers
// ---------------------------------------------------------------------------

export type TodoRow = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  priority: string;
  due_date: string | null;
  completed: number; // 0 | 1
  created_at: string;
};

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

export function rowToTodo(row: TodoRow): Todo {
  return {
    id: row.id,
    title: row.title,
    ...(row.description ? { description: row.description } : {}),
    category: row.category as Todo["category"],
    priority: row.priority as Todo["priority"],
    ...(row.due_date ? { dueDate: row.due_date } : {}),
    completed: row.completed === 1,
    createdAt: row.created_at,
  };
}

export function getAllTodos(): Todo[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM todos ORDER BY created_at ASC")
    .all() as TodoRow[];
  return rows.map(rowToTodo);
}

export function getTodo(id: string): Todo | undefined {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM todos WHERE id = ?")
    .get(id) as TodoRow | undefined;
  return row ? rowToTodo(row) : undefined;
}

export function createTodo(
  todo: Omit<Todo, "id" | "completed" | "createdAt"> & {
    id?: string;
    completed?: boolean;
    createdAt?: string;
  }
): Todo {
  const db = getDb();
  const id = todo.id || crypto.randomUUID();
  const createdAt = todo.createdAt || new Date().toISOString();
  db.prepare(
    `INSERT INTO todos (id, title, description, category, priority, due_date, completed, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    todo.title,
    todo.description || null,
    todo.category,
    todo.priority,
    todo.dueDate || null,
    todo.completed ? 1 : 0,
    createdAt
  );
  return getTodo(id)!;
}

export function updateTodo(
  id: string,
  updates: Partial<Omit<Todo, "id" | "createdAt">>
): Todo | undefined {
  const db = getDb();
  const existing = getTodo(id);
  if (!existing) return undefined;

  const sets: string[] = [];
  const values: unknown[] = [];

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
  db.prepare(`UPDATE todos SET ${sets.join(", ")} WHERE id = ?`).run(
    ...values
  );

  return getTodo(id);
}

export function deleteTodo(id: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM todos WHERE id = ?").run(id);
  return result.changes > 0;
}
