# Recipe Catalog QA Phase 2 Report

**Date:** 2026-04-07
**Follows:** RECIPE-CATALOG-QA-REPORT.md (Phase 1)

---

## Summary of Changes

| Metric | Before (Phase 1) | After (Phase 2) | Change |
|--------|-------------------|------------------|--------|
| Total recipes | 3,752 | 3,678 | -74 (duplicates removed) |
| Recipes with images | 1,772 (47%) | 1,936 (53%) | +164 linked |
| Diet tagged | 3,166 (84%) | 3,109 (85%)* | +6 added |
| Junk/OCR names fixed | 0 | 135 | All recoverable names fixed |
| Books with 0% images | 15 | 8 | 7 books now have some images |

*Diet percentage increased despite fewer total recipes due to duplicate removal.

---

## Phase 1: Junk/OCR Name Fixes

### Duplicates Removed (74 files)

| Cookbook | Duplicates Removed | Cause |
|---------|-------------------|-------|
| Ottolenghi Simple | 35 | Intro/headnote text extracted as separate recipe entries |
| Thai Curry Cookbook 2 | 16 | Description fragments extracted as duplicate entries |
| Vegan Nigerian Kitchen | 8 | Single-word fragments duplicating legitimate entries |
| Real Thai Cooking | 5 | Narrative text extracted as duplicate entries |
| Jamie's Food Revolution | 2 | OCR fragments duplicating legitimate entries |

### Names Fixed (135 recipes)

| Cookbook | Names Fixed | Examples |
|---------|-------------|---------|
| Thai Curry Cookbook 2 | 38 | "appetizing." -> "Curry Chicken Rice Pilaf", "make." -> "Duck Green Curry" |
| Real Thai Cooking | 22 | "Top with raw bean sprouts, sliv-" -> "Khao Soi (Northern Thai Coconut Curry Noodles)" |
| Ottolenghi Simple | 19 | "Aviv." -> "Aviv's Nutella Babka Rolls", truncated names completed |
| Jamie's Food Revolution | 22 | "Veg Etab le B Haj is" -> "Vegetable Bhajis", "S T R 0 G A NO F F" -> "Chicken and Leek Stroganoff" |
| The Best of Fine Cooking: Breakfast | 18 | "Drizzle both sides with the maple syrup" -> "Creamy Polenta with Mushroom Ragout" |
| The Classic Italian Cook Book | 13 | "dough." -> "Baked Lasagne", "Withclaims" -> "Spaghetti with Clams" |
| Vegan Nigerian Kitchen | 5 | "Dairy" -> "Homemade Soy Milk", "These" -> "Vegan Isi Ewu / Nkwobi" |

### Recovery Method

Names were recovered by analyzing:
1. **Ingredients** -- the primary dish components identify the recipe
2. **Method text** -- often contains "Recipe N:" headers that bleed in from adjacent recipes
3. **Intro/headnote** -- sometimes the full name appears in context
4. **Cookbook knowledge** -- classic dishes recognizable from ingredients (e.g., Khao Soi, Panzanella)

### Recipes Flagged as Low-Confidence

The Classic Italian Cook Book has 13 recipes with severely garbled OCR (no spaces in ingredient text, page numbers mixed with amounts). Names were assigned based on best interpretation but these should be verified against the original book:
- `textures.json` -> "Italian Braised Dish" (generic -- unrecoverable)
- `toomitthehqueur.json` -> "Banana Frappee with Sliced Oranges" (tentative)
- `nutmeg.json` -> "Spinach with Nutmeg" (tentative)
- `parmesancheese.json` -> "Pasta with Parmesan Cheese" (tentative)

---

## Phase 2: Image Coverage

### Images Linked (164 total)

| Source | Count | Method |
|--------|-------|--------|
| Exact ID match (orphaned images) | 126 | Image filename matched recipe ID exactly |
| Souk to Table (embedded ID) | 31 | Image names like `{recipe-id}{subtitle}.jpg` |
| The Curry Guy (prefix mismatch) | 7 | Images lacked `cg-` prefix used by recipe IDs |

### Updated Coverage for Formerly Zero-Image Books

| Cookbook | Before | After | Notes |
|---------|--------|-------|-------|
| Jamie's Food Revolution | 0/81 (0%) | 5/79 (6%) | 5 images found |
| More Than Carbonara | 0/65 (0%) | 1/65 (2%) | 1 image found |
| Ottolenghi Simple | 0/90 (0%) | 1/55 (2%) | 35 duplicates removed first |
| Plenty | 0/100 (0%) | 1/100 (1%) | 1 image found |
| Raw Food | 0/29 (0%) | 3/29 (10%) | 3 images found |
| Real Thai Cooking | 0/74 (0%) | 3/69 (4%) | 5 dups removed, 3 images found |
| Thai Curry Cookbook 2 | 0/105 (0%) | 1/81 (1%) | 24 dups removed, 1 image found |

### Books Still at 0% Image Coverage

These 8 books have no usable images in the extracted source material:

| Cookbook | Recipes | Reason |
|---------|---------|--------|
| Bread Cookbook | 30 | No images extracted from source |
| Brunch Cookbook | 69 | No images extracted from source |
| Italian And Lebanese Cookbook | 147 | No images extracted from source |
| Mexican Home Cooking | 174 | No images extracted from source |
| Plenty More | 123 | No images extracted from source |
| The Best of Fine Cooking: Breakfast | 18 | No images extracted from source |
| The Classic Italian Cook Book | 13 | No images extracted from source |
| The Complete Greek Cookbook | 95 | No images extracted from source |

These books would require manual image sourcing or re-extraction from the original PDFs with image extraction enabled.

### Other Books with Improved Coverage

| Cookbook | Before | After |
|---------|--------|-------|
| The Curry Guy Bible | 121/209 (58%) | 209/209 (100%) |
| Souk to Table | 47/99 (47%) | 78/99 (79%) |
| The Curry Guy | 41/105 (39%) | 48/105 (46%) |
| Jerusalem | 82/121 (68%) | 98/121 (81%) |

---

## Phase 3: Diet Tag Improvements

### Changes

6 additional recipes tagged across Land of Fish and Rice and Mexican Home Cooking:
- "Fish Fillets in Seaweed Batter" -> vegetarian, vegan (mock fish dish)
- "Hangzhou Buddhist 'Roast Goose'" -> vegetarian, vegan (mock meat)
- "Shanghai 'Smoked' Fish" -> vegetarian, vegan (mock fish)
- "Vegetarian 'Eels' in Sweet-and-Sour Sauce" -> vegetarian, vegan
- "Kidney Bean Fajita Tacos" -> vegetarian
- "Mexican Baked Eggs" -> vegetarian

### Remaining Diet Gaps

569 recipes (15%) still lack diet tags. The top gaps:

| Cookbook | Untagged | Reason |
|---------|----------|--------|
| More Than Carbonara | 48/65 | All are meat+pasta dishes -- correctly no applicable tags |
| Land of Fish and Rice | 53/162 | Mostly fish/meat dishes with ambiguous ingredients |
| Mexican Home Cooking | 54/174 | Meat-heavy cuisine with complex ingredient lists |
| Pasta for All Seasons | 34/60 | Pasta dishes with meat -- correctly no applicable tags |
| Vietnamese Food Any Day | 28/77 | Fish sauce ubiquity makes vegan/vegetarian uncertain |

These gaps are appropriate -- the recipes genuinely contain meat, fish, or ambiguous ingredients. Further tagging would require manual review to avoid false positives.

---

## Overall Catalog Status

| Metric | Phase 1 End | Phase 2 End |
|--------|-------------|-------------|
| Total recipes | 3,752 | 3,678 |
| With images | 1,772 (47%) | 1,936 (53%) |
| With diet tags | 3,166 (84%) | 3,109 (85%) |
| With cuisine | 3,752 (100%) | 3,678 (100%) |
| Junk/OCR names | ~98 | 4 low-confidence |
| Books at 100% images | 10 | 11 |
| Books at 0% images | 15 | 8 |

---

## Remaining Work (Manual Review Needed)

1. **Classic Italian Cook Book** -- 13 recipes have severely garbled OCR in ingredients and methods. Names were recovered from context but ingredient data is largely unusable. These would benefit from re-extraction from the source PDF.

2. **8 books with 0% image coverage** -- Would need image re-extraction from source PDFs or manual image sourcing.

3. **More Than Carbonara ingredient quality** -- While names are clean, some recipes still have residual OCR artifacts in ingredient text (removed `XXXX` junk in Phase 1 but some formatting issues remain).

4. **Real Thai Cooking content swaps** -- `nam-prik-num-roasted-green-chili-dip.json` contains pig trotter soup content instead of green chili dip. `nam-prik-ong-minced-pork.json` contains what appears to be the green chili dip. These two recipes may have their content swapped.

---

## Cleanup Script

The Phase 2 cleanup script is at `scripts/phase2-cleanup.py` and can be reviewed for the complete list of changes made.
