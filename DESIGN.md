# Architecture & Design

## Data layer

### Turso / libSQL (`src/lib/db.ts`)

Single `@libsql/client` connection with auto-migration on first access.
Production uses `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`; local dev falls
back to a file-based SQLite database.

**Schema versions:**

| Version | Migration |
|---------|-----------|
| 0 → 1  | `todos` table + seed data |
| 1 → 2  | `recipes` table + seed My Recipes |

### Recipes (`src/lib/recipes.ts`)

Hybrid loading strategy:

- **Cookbook recipes** (~3,800): loaded from static JSON files in
  `src/data/recipes/` at module init. Filtered to exclude any recipe with
  `source.cookbook === "My Recipes"` to avoid duplicates.
- **My Recipes** (user's personal collection): stored in Turso `recipes`
  table as JSON blobs. Fetched on each request via `getAllMyRecipes()`.

All public recipe functions are async and merge both sources. React's
`cache()` deduplicates `getAllRecipes()` within a single server render.

### Todos (`src/lib/db.ts`)

Full CRUD backed by Turso `todos` table. API routes at `/api/todos`.

## Pages

All recipe pages are async Server Components that `await` recipe data.
`generateStaticParams` is async to support Turso fetch at build time.

## Deployment

Vercel auto-deploys from `main`. The Turso migration runs on first
function invocation, seeding tables idempotently (CREATE TABLE IF NOT
EXISTS + INSERT OR IGNORE for seed data).
