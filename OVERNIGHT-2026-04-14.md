# Overnight Work Plan — 2026-04-14

## Workstream A: Planner Logic Fixes (`src/lib/meals.ts`)

- [x] **A1 — Prevent starch duplication between main and sides**
  Seed `usedBases` with the main dish's dominant base so a potato curry never gets paired with roast potatoes.

- [x] **A2 — Filter breakfast/lunch/brunch meal_role from dinner suggestions**
  Added `lunch` and `brunch` to meal_role exclusion in `isDinnerWorthy()`.

## Workstream B: Recipe Data Fixes (individual JSON files)

- [x] **B1 — Fix Persiana "Chicken" → "Chicken Bastilla"**
  Renamed `chicken.json` → `chicken-bastilla.json`, fixed name + id, nulled wrong image (showed "Persian Saffron Chicken, Fennel & Barberry Stew" instead of Bastilla).

- [x] **B2 — Fix Veggie Thai Curry Soup timing + ingredients**
  Fixed `time.prep` from string `"30 minutes"` to `30`, `time.total` from `5` to `45`, added `cook: 15`. Extracted amounts from 3 ingredient item names.

- [x] **B3 — Fix Moroccan Kofte and Sausage Stew categorization**
  Changed `dish_type` from `["soup"]` to `["stew", "main"]`. Moved notes out of ingredients into `tips` field. Fixed ground beef amount parsing. Fixed prep from string to numeric. Corrected total time to 60 min.

- [x] **B4 — Null wrong images for Casarecce and Mocha'r Ghonto**
  - Casarecce: was showing pasta shape illustration, not the dish. Also fixed total time 16 → 35.
  - Mocha'r Ghonto: was showing potato illustration, not banana flower dish.

## Workstream C: Validation & Bundle

- [x] **C1 — Rebundle recipes + validate + tsc**
  Added "stew" to `VALID_DISH_TYPES` in validator. All 3560 recipes rebundled. Validation: 0 errors, 1 pre-existing warning (long name). tsc: clean.

---

## Commits (pushed to origin/main)

| SHA | Description |
|-----|-------------|
| `eec08f19` | fix(meals): prevent starch duplication and filter lunch/brunch from dinner |
| `89e28e8a` | fix(recipes): correct 5 recipe data quality issues |
| `b1e169f9` | chore(recipes): rebundle after data fixes, add stew to valid dish_types |

## Follow-ups for David

1. **Wrong images — source recovery**: The 3 nulled images (chicken-bastilla, casarecce, mocha-r-ghonto) need correct photos extracted from the source EPUBs. The Persiana EPUB is available at the Google Drive path in the brief. The other two cookbooks (Pasta for All Seasons, The Indian Vegan) should also be in nabu-share if available.
2. **~546 recipes have `time.prep` as strings** (e.g. `"30 minutes"`, `"10 MINS, PLUS MARINATING TIME"`). Only the 2 recipes David flagged tonight were fixed. A parser script could normalize these corpus-wide, but that's a broader sweep best done with review.
3. **Weekend main strength**: `isFlimsyForWeekend()` already filters simple soups/salads. If David still sees weak weekend mains, the threshold may need further tuning (e.g. minimum ingredient count or cook time).
