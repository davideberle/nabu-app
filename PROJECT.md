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
| Meals    | Live   | Weekly meal planner (Phases 1–4: 7-day week, quality-gated candidates, ISO week nav + history, day expansion, side/serve-with, and weekend Sat/Sun breakfast/brunch slots). Turso-backed |
| Cooking  | Live   | Live cooking session, auto-loaded from meal plan. UI intentionally lean: main steps, sides/serve-with, concise wine, optional notes; meal-flow/shortcut/upgrade/session-modification blocks hidden. |
| Family   | Live | `/family` renders family-owned milestones and planning windows; `/family/tracker` is the focused iPad tracker with scoped access and reduced navigation. |
| Wine     | Live   | Household wine-cellar view backed by kitchen-owned seed data mirror; tracks red/white bottles, bottle images, pairing lanes, and consumed status. |
| Music    | Live   | Sonos zone control + discovery review. Discovery cards include cover/year metadata; already-in-library candidates are rejected out of inbox during sync. UI polished with Nabu/Untitled wrapper in `57ae11d8`. |
| Shopping | Stub   | Lists placeholder |
| System   | Stub   | Status placeholder |

## Environment Variables (Vercel)

- `TURSO_DATABASE_URL` — Turso database URL
- `TURSO_AUTH_TOKEN` — Turso auth token
- `AUTH_SECRET` — NextAuth secret
- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` — Google OAuth credentials
- `IPAD_TRACKER_ONLY_EMAILS` — optional comma-separated Google accounts restricted to the family tracker; defaults to `assistant@davideberle.com`
## Current UI refresh status

- 2026-06-02: Focused Family iPad tracker deployed to production (`dpl_H7VYjyBXrw74vB3zdSpCMKTgwoKN`). Added `/family/tracker` as the direct Home Screen target, updated the manifest to start there, and added tracker-only account scoping so restricted accounts are redirected into the tracker and blocked from the wider app. Local build passed, iPad portrait/landscape screenshots were checked, production alias is live, `/family/tracker` redirects unauthenticated users to login, and `/manifest.json` exposes `start_url: "/family/tracker"`.
- 2026-06-02: Family iPad foundation deployed to production (`dpl_Ghf1nTW1kijDPPziocu7ivMTYPw3`). `/family` renders upcoming birthdays/anniversaries, computed ages/counts, and planning-window status from the family domain mirror; dashboard and Today link into it; iPad/PWA safe-area, manifest, and icon support are live. David clarified this is not the finished milestone tracker: the next target is a focused iPad tracker with scoped access and reduced app chrome.
- 2026-06-02: Meal planner quality hardening deployed to production (`dpl_6APPLuH6RRn2NxF2AmsysNLvWLiQ`). Generated candidates now avoid recipes cooked in the last 45 days and recipes planned in the last 5 prior weeks, apply stricter main-dish filtering to planner/web candidates, add cuisine/source diversity scoring, and record cook events at recipe level for mains plus accepted sides. Local and Vercel production builds pass; production `/api/meals/generate` returns `planner-v2.2`.
- 2026-06-01: Meal planner navigation/clarity hotfix deployed to production (`dpl_9gV7HbnxfBmY6p46ZtxEWBYyQb7R`). Week navigation now keeps explicit `?week=YYYY-Www` URLs for current/previous/next weeks, and cooked meal cards show one compact cooked badge instead of a duplicate label. Local and Vercel production builds pass.
- 2026-05-31: Dashboard, shared Nabu surfaces, `/meals`, and `/cooking` visual upgrade pass deployed to production (`dpl_mZP7vk8DNUNPP81QzfJ9X8zhrnk5`). The pass reduces decorative backgrounds/shadows, standardizes calmer 8px-style surfaces, tightens dashboard and meal workflow hierarchy, and preserves session notes plus Monday/Tuesday non-alcoholic pairing hints. Local and Vercel production builds pass.
- 2026-05-23: Recipe detail back button hotfix: recipe links now carry a safe parent `from` target from browse/cookbook/cuisine/dietary/meals surfaces, and the floating recipe back button routes deterministically to that parent instead of relying on browser history (which could jump around after in-page chapter/scroll interactions). Local production build passes.
- Untitled UI/Nabu wrapper foundation is live.
- Dashboard, Meals, and Cooking polish shipped in `dab49fac`.
- Todos, Music, and Music Discovery polish shipped in `57ae11d8`.
- Recipes index, detail, and cookbooks polish shipped (NabuPageShell/NabuHeader/NabuMain/NabuCard/NabuBadge applied; editorial hero preserved).
- Wine cellar polish shipped: grouped red/white sections, hero stock summary, bottle photos, safe unknown-vintage display.
- Remaining Untitled/Nabu rollout candidates: Cookbook/cuisine/dietary sub-pages, Login, Shopping, and System.
