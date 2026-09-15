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

## Follow-up Pass — 2026-04-15

### D1 — Restore verified images from source EPUBs
- [x] **Chicken Bastilla** (Persiana p.106, `images/00064.jpeg`): extracted correct photo showing golden filo pies. Caption in EPUB confirms "Chicken Bastilla".
- [x] **Casarecce with Black Cod** (Pasta for All Seasons p.84, `Page_084_Image_0001.jpg`): replaced pasta shape illustration with actual dish photo. Index confirms this image belongs to the recipe.
- [x] **Mocha'r Ghonto** (The Indian Vegan, `P95-1.jpg`): stays null. The source EPUB only has a decorative potato illustration next to this recipe — no recipe photo exists in the book. The existing file in `public/recipes/` is that same illustration (verified byte-identical).

### D2 — Normalize all string time values to numeric minutes
- [x] Converted 545+ prep, 452 cook, and 456 total time fields across 532+ recipes (6 cookbooks: Curry Guy Bible, High-Protein Vegan, Plentiful, Tagine, Souk to Table, Thai Spice)
- Patterns handled: "30 minutes", "1¼ HOURS", ranges (lower bound), concatenated prep+cook, Cyrillic lookalike chars, parenthetical notes
- "Plus ..." context notes (marinating, soaking, etc.) preserved in `tips` field
- Zero remaining string time values in corpus

### Commits (pushed to origin/main)

| SHA | Description |
|-----|-------------|
| `a97d5ea7` | fix(recipes): restore verified images for chicken-bastilla and casarecce |
| `93d0d45e` | fix(recipes): normalize all string time values to numeric minutes |
| `7f921c7a` | chore(recipes): rebundle after image restore and time normalization |

### Validation
- `validate-recipes.mjs`: 0 errors, 1 pre-existing warning (long name)
- `tsc --noEmit`: clean

## Remaining Follow-ups

1. **Mocha'r Ghonto image**: No recipe photo exists in the source EPUB. If David has a photo, manually add it to `public/recipes/mocha-r-ghonto.jpg` and set `"image": "/recipes/mocha-r-ghonto.jpg"` in the JSON.
2. **Lamb Biryani image** (Persiana): JSON correctly has `null`, but `public/recipes/lamb-biryani.jpg` contains a chapter title page ("Soups, stews & tagines"), not a biryani photo. Could extract correct image from EPUB if desired.
3. **Other wrong-image recipes**: A systematic audit comparing EPUB source images to `public/recipes/` could find more mismatches. The overnight pass only checked 5 recipes.
4. **Weekend main strength**: `isFlimsyForWeekend()` may need tuning if David still sees weak weekend mains.
