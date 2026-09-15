# Planner & UI Feedback Backlog

**Date:** 2026-04-21
**Branch:** `fix/planner-feedback-20260421`
**Author:** David (via Nabu)

---

## 1. Verified Fixed in This Pass

These items were addressed in the two commits on this branch (`07ad5e61`, `33d52aa9` and prior):

| Fix | Files |
|-----|-------|
| Ingredient display now prefers metric measurements; imperial-in-parens stripped centrally | `src/lib/normalize-ingredients.ts` (new), `src/lib/recipes.ts`, `src/app/recipes/[id]/page.tsx`, `src/app/meals/page.tsx` |
| Recipe detail page and planner Quick View both use the same normalizer | `src/app/recipes/[id]/page.tsx`, `src/app/meals/page.tsx` |
| Seasonality filter tightened: only current + trailing season (was: everything except opposite) | `src/lib/meals.ts` |
| Crispy Korean Poke Bowl data fixed (measurements, metadata) | `src/data/recipes/crispy-korean-poke-bowl.json` |
| Stale candidate images reconciled on plan reload | `src/app/meals/page.tsx` (prior commit) |
| Malformed `plan.days` self-healed on load to prevent crash | `src/app/meals/page.tsx` (prior commit) |
| Wrong images nulled for hominy-spinach-broth and celtuce-salad | `src/data/recipes/` (prior commit) |
| Assigned candidates hidden from suggestion grid | `src/app/meals/page.tsx` (prior commit) |
| "This week's suggestions" heading now adapts when viewing Next Week tab | `src/app/meals/page.tsx` (this pass, tiny fix) |

---

## 2. Likely Unresolved Feedback

> Items below are **inferred from reading the current code and design docs**, not from a tracked feedback list. They are labelled accordingly.

### 2a. Planner / `/meals`

| # | Issue | Evidence | Severity |
|---|-------|----------|----------|
| P1 | **"Generate Options" / "Refresh suggestions" is still the primary interaction** — DESIGN.md Phase 3 says candidates should be a saved week artifact and regenerate should be demoted, but the UI still leads with these buttons. | `meals/page.tsx:691-709` | Medium |
| P2 | **No "Turn into meal" day expansion** — Phase 2 goal; no UI or API for expanding a main into main+complements. | DESIGN.md 6.6 Phase 2 | Medium |
| P3 | **No explicit weekday/weekend type indicator on day cards** — the data has `type: "weekday"|"weekend"` but the card only highlights Fri/Sat/Sun day-name color; there is no visual label. | `meals/page.tsx:637` | Low |
| P4 | **Recipe search is still placeholder on `/recipes`** — PROJECT.md lists "Replace placeholder recipe search with real search" as open. The browse page has filter pills but no text search input. | `recipes/page.tsx` | Medium |
| P5 | **Mobile tap targets on day calendar cards are small** — the grid uses `grid-cols-2 sm:grid-cols-4 lg:grid-cols-7` which is reasonable, but on narrow phones the 2-col cards with `min-h-[110px]` plus the context badges can feel cramped. | `meals/page.tsx:613-687` | Low |
| P6 | **No loading skeleton / empty state illustration** — when `planLoading` is true nothing renders in the calendar or candidate area; the page is blank until the fetch completes. | `meals/page.tsx:287,691` | Low |

### 2b. Recipe Detail / `/recipes/[id]`

| # | Issue | Evidence | Severity |
|---|-------|----------|----------|
| R1 | **Quick View modal truncates method to 4 steps with no expand** — user must click "View full recipe" link to see the rest. For quick planning this may be fine, but there is no inline expand. | `meals/page.tsx:1189-1204` | Low |
| R2 | **Cooking history section is server-rendered but has no fallback if DB is slow** — minor, but could cause a visible delay on the recipe detail page. | `recipes/[id]/page.tsx:354-384` | Low |

### 2c. Shopping / `/shopping`

| # | Issue | Evidence | Severity |
|---|-------|----------|----------|
| S1 | **Entire page is still hardcoded mock data** — PROJECT.md and DESIGN.md both flag this. Not wired to kitchen shopping outputs. | `shopping/page.tsx` (all mock) | High |
| S2 | **Visual style mismatch** — Shopping uses `zinc` palette (dashboard style) while Meals and Recipes use the `stone` / warm palette. | `shopping/page.tsx:70` vs `meals/page.tsx:511` | Low |

### 2d. Dashboard / `/`

| # | Issue | Evidence | Severity |
|---|-------|----------|----------|
| D1 | **"Today's Focus" banner is a static placeholder** — always shows "No focus set". | `page.tsx:102-110` | Low |
| D2 | **System status footer is hardcoded green dots** — not connected to real service health. | `page.tsx:142-162` | Low |
| D3 | **Dashboard uses `zinc` palette; Meals/Recipes use `stone`** — minor visual inconsistency across the app. | `page.tsx:68` vs `meals/page.tsx:511` | Low |

---

## 3. Recommended Next Patch Slices

Each slice is designed to be a small, independently reviewable PR.

### Slice A — Planner empty/loading states (small)
- Add a skeleton or spinner while `planLoading` is true.
- Show a gentle empty state when no plan exists for the week.
- **Files:** `src/app/meals/page.tsx`

### Slice B — Recipe text search (medium)
- Add a search input to `/recipes` that filters by name/ingredient.
- **Files:** `src/app/recipes/page.tsx`, possibly `src/lib/recipes.ts`

### Slice C — Shopping palette alignment (tiny)
- Switch `/shopping` from `zinc` to `stone` palette to match Meals/Recipes.
- **Files:** `src/app/shopping/page.tsx`

### Slice D — Candidate-set stability (Phase 3 alignment, medium)
- When a saved `candidateSet` exists, load it without showing "Generate Options" as the primary CTA.
- Demote regenerate to a secondary action.
- **Files:** `src/app/meals/page.tsx`

### Slice E — "Turn into meal" day expansion (Phase 2, larger)
- Add day-level expand UI + API endpoint for complement suggestions.
- **Files:** `src/app/meals/page.tsx`, new API route, `src/lib/meals.ts`

### Slice F — Wire shopping to kitchen outputs (larger)
- Replace mock data with kitchen-owned shopping list data.
- **Files:** `src/app/shopping/page.tsx`, new API route or data loader

---

## 4. File/Screen Index

| Screen | Primary file(s) | Status |
|--------|-----------------|--------|
| `/` (Dashboard) | `src/app/page.tsx` | Live, placeholder elements |
| `/meals` (Planner) | `src/app/meals/page.tsx`, `src/lib/meals.ts` | Live, Phase 1 complete, Phase 2-3 pending |
| `/recipes` (Browse) | `src/app/recipes/page.tsx` | Live, no text search |
| `/recipes/[id]` (Detail) | `src/app/recipes/[id]/page.tsx` | Live, recently improved |
| `/shopping` | `src/app/shopping/page.tsx` | Mock data only |
| `/shopping/print/kids` | `src/app/shopping/print/page.tsx` | Mock data only |
| Ingredient normalization | `src/lib/normalize-ingredients.ts` | New in this branch |
| Planner logic | `src/lib/meals.ts` | Updated seasonality in this branch |
