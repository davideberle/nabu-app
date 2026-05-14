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
| Todos    | Live   | Full CRUD, Turso-backed. UI polished with Nabu/Untitled wrapper in `57ae11d8`. |
| Recipes  | Live   | ~3,527 cookbook recipes (static JSON, classified by meal_role) + My Recipes (Turso), with cook history shown on recipe pages |
| Meals    | Live   | Weekly meal planner (Phases 1–3 done: 7-day week, quality-gated candidates, ISO week nav + history). Phase 4 active: day expansion, side/serve-with, UX polish. Turso-backed |
| Cooking  | Live   | Live cooking session, auto-loaded from meal plan. UI intentionally lean: main steps, sides/serve-with, concise wine, optional notes; meal-flow/shortcut/upgrade/session-modification blocks hidden. |
| Music    | Live   | Sonos zone control + discovery review. Discovery cards include cover/year metadata; already-in-library candidates are rejected out of inbox during sync. UI polished with Nabu/Untitled wrapper in `57ae11d8`. |
| Shopping | Stub   | Lists placeholder |
| System   | Stub   | Status placeholder |

## Environment Variables (Vercel)

- `TURSO_DATABASE_URL` — Turso database URL
- `TURSO_AUTH_TOKEN` — Turso auth token
- `AUTH_SECRET` — NextAuth secret
- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` — Google OAuth credentials
## Current UI refresh status

- Untitled UI/Nabu wrapper foundation is live.
- Dashboard, Meals, and Cooking polish shipped in `dab49fac`.
- Todos, Music, and Music Discovery polish shipped in `57ae11d8`.
- Recipes index, detail, and cookbooks polish shipped (NabuPageShell/NabuHeader/NabuMain/NabuCard/NabuBadge applied; editorial hero preserved).
- Remaining Untitled/Nabu rollout candidates: Cookbook/cuisine/dietary sub-pages, Login, Shopping, and System.

