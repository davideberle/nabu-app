# Nabu — Companion App

Personal household companion app for the Eberle family. Deployed on Vercel at
https://app.davideberle.com.

## Stack

- **Framework**: Next.js 16 (App Router, Server Components)
- **Auth**: NextAuth v5 (Google OAuth, single-user allow-list)
- **Database**: Turso (libSQL) via `@libsql/client` — shared by todos, My Recipes, meal plans, and cook history
- **Styling**: Tailwind CSS v4
- **Hosting**: Vercel (auto-deploy from `main`)

## Modules

| Module   | Status | Notes |
|----------|--------|-------|
| Todos    | Live   | Full CRUD, Turso-backed |
| Recipes  | Live   | ~3,527 cookbook recipes (static JSON, classified by meal_role) + My Recipes (Turso), with cook history shown on recipe pages |
| Meals    | Live   | Weekly meal planner with bucket-based candidate selection (salad/soup/veg/fish/meat contract, Phase 2), cuisine diversity, Turso-backed |
| Music    | Live   | Sonos zone control |
| Shopping | Stub   | Lists placeholder |
| System   | Stub   | Status placeholder |

## Environment Variables (Vercel)

- `TURSO_DATABASE_URL` — Turso database URL
- `TURSO_AUTH_TOKEN` — Turso auth token
- `AUTH_SECRET` — NextAuth secret
- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` — Google OAuth credentials
