#!/usr/bin/env python3
"""
Recipe Catalog QA Cleanup Script
Normalizes metadata across all recipe JSON files.
"""

import os
import json
import re
import sys
from collections import Counter, defaultdict

RECIPES_DIR = os.path.join(os.path.dirname(__file__), '..', 'src', 'data', 'recipes')

# ── Known dish name words that should stay uppercase ──
UPPERCASE_WORDS = {'BBQ', 'BLT', 'NYC', 'XO', 'DIY'}

# ── Words that should stay lowercase in title case ──
LOWERCASE_WORDS = {'a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor', 'on',
                   'at', 'to', 'by', 'of', 'in', 'with', 'from', 'as', 'is',
                   'de', 'du', 'des', 'le', 'la', 'les', 'al', 'el', 'e',
                   'con', 'di', 'del', 'alla', 'alle', 'agli', 'dei'}

# ── Cookbook → cuisine mapping (matches app's COOKBOOK_CUISINES) ──
COOKBOOK_CUISINE = {
    'Ottolenghi: The Cookbook': 'Middle Eastern',
    'Jerusalem': 'Middle Eastern',
    'Falastin': 'Middle Eastern',
    'Persiana': 'Middle Eastern',
    'Souk to Table': 'Middle Eastern',
    'Plenty': 'Middle Eastern',
    'Plenty More': 'Middle Eastern',
    'Ottolenghi Simple': 'Middle Eastern',
    'The Curry Guy': 'Indian',
    'The Curry Guy Bible': 'Indian',
    'The Indian Vegan': 'Indian',
    'Vietnamese Food Any Day': 'Southeast Asian',
    'Vegan Vietnamese': 'Southeast Asian',
    'Afro-Vegan': 'African & Caribbean',
    'Plentiful': 'Caribbean',
    'Black Rican Vegan': 'Caribbean',
    'The Vegan Korean': 'Korean',
    'Mexican Home Cooking': 'Mexican',
    'Land of Fish and Rice': 'Chinese',
    'Four Seasons': 'Italian',
    'Italian And Lebanese Cookbook': 'Mediterranean',
    'More Than Carbonara': 'Italian',
    'Pasta for All Seasons': 'Italian',
    'The Best Pasta Recipes': 'Italian',
    'The Classic Italian Cook Book': 'Italian',
    'Zagami Family Cookbook': 'Italian',
    'The Authentic Greek Kitchen': 'Greek',
    'The Complete Greek Cookbook': 'Greek',
    'The Complete and Authentic Thai Curry Cookbook 2': 'Southeast Asian',
    'Real Thai Cooking': 'Southeast Asian',
    'Thai Spice Recipes': 'Southeast Asian',
    'Vegan Nigerian Kitchen': 'Nigerian',
    'Tagine Cookbook': 'Moroccan',
    "Jamie's Food Revolution": 'British',
    'The High-Protein Vegan Cookbook': 'Other',
    'Salads & Dressings': 'Other',
    'Vegan Chocolate': 'Other',
    'Superfood Boost': 'Other',
    'Brunch Cookbook': 'Other',
    'Bread Cookbook': 'Other',
    'Raw Food': 'Other',
    'The Best of Fine Cooking: Breakfast': 'American',
    'My Recipes': 'Other',
    'Plentiful': 'Caribbean',
}

# ── Meat/fish keywords for diet inference ──
MEAT_KEYWORDS = [
    'chicken', 'beef', 'pork', 'lamb', 'veal', 'turkey', 'duck', 'goose',
    'bacon', 'ham', 'sausage', 'salami', 'prosciutto', 'pancetta', 'chorizo',
    'steak', 'ribs', 'brisket', 'meatball', 'ground beef', 'ground pork',
    'ground turkey', 'ground lamb', 'mince', 'minced meat',
    'venison', 'rabbit', 'quail', 'pheasant', 'goat',
    'pepperoni', 'mortadella', 'bresaola', 'guanciale',
    'oxtail', 'bone marrow', 'offal', 'liver', 'kidney',
]

FISH_KEYWORDS = [
    'fish', 'salmon', 'tuna', 'cod', 'halibut', 'mackerel', 'sardine',
    'anchovy', 'anchovies', 'shrimp', 'prawn', 'crab', 'crabmeat', 'lobster',
    'clam', 'mussel', 'oyster', 'scallop', 'squid', 'calamari', 'octopus',
    'catfish', 'tilapia', 'trout', 'sea bass', 'snapper', 'swordfish',
    'lingcod', 'monkfish', 'haddock', 'herring', 'eel',
    'fish sauce', 'oyster sauce', 'worcestershire',
    'bacalao', 'salt fish', 'saltfish', 'stockfish', 'ackee',
]

DAIRY_KEYWORDS = [
    'milk', 'cream', 'butter', 'cheese', 'yogurt', 'yoghurt',
    'parmesan', 'mozzarella', 'ricotta', 'mascarpone', 'gorgonzola',
    'feta', 'brie', 'gruyere', 'cheddar', 'gouda', 'halloumi',
    'sour cream', 'crème fraîche', 'creme fraiche', 'buttermilk',
    'ghee', 'paneer', 'labneh', 'whey', 'condensed milk',
    'evaporated milk', 'clotted cream', 'double cream', 'heavy cream',
    'whipped cream', 'cream cheese',
]

EGG_KEYWORDS = ['egg', 'eggs', 'egg yolk', 'egg white', 'meringue', 'mayonnaise']

HONEY_KEYWORDS = ['honey']

# Exclude these from triggering meat/fish (they're plant-based or ambiguous)
FALSE_POSITIVES = [
    'coconut milk', 'coconut cream', 'almond milk', 'oat milk', 'soy milk',
    'rice milk', 'cashew milk', 'hemp milk', 'plant milk', 'vegan butter',
    'cocoa butter', 'shea butter', 'peanut butter', 'almond butter',
    'sunflower butter', 'tahini butter', 'nut butter', 'seed butter',
    'coconut butter', 'apple butter',
    'nutritional yeast', 'vegan cheese', 'dairy-free',
    'mushroom', 'eggplant', 'jackfruit', 'seitan', 'tempeh', 'tofu',
    'vegan mayo', 'vegan mayonnaise',
    'coconut yogurt', 'soy yogurt', 'plant yogurt',
    'vegan cream', 'cashew cream', 'coconut cream',
]

# Gluten sources
GLUTEN_KEYWORDS = [
    'flour', 'wheat', 'bread', 'pasta', 'noodle', 'spaghetti', 'fettuccine',
    'linguine', 'penne', 'rigatoni', 'macaroni', 'lasagna', 'orzo',
    'couscous', 'bulgur', 'semolina', 'seitan', 'barley', 'rye',
    'panko', 'breadcrumb', 'crouton', 'pita', 'tortilla', 'wrap',
    'biscuit', 'cracker', 'pastry', 'pie crust', 'puff pastry',
    'soy sauce', 'teriyaki', 'hoisin',
    'filo', 'phyllo', 'wonton', 'dumpling',
]


def smart_title_case(name):
    """Convert ALL CAPS or messy case to proper title case, preserving dish names."""
    if not name:
        return name

    # Don't touch names that are already mixed case (not all caps)
    if name != name.upper():
        return name

    words = name.split()
    result = []
    for i, word in enumerate(words):
        upper = word.upper()
        if upper in UPPERCASE_WORDS:
            result.append(upper)
        elif i == 0:
            # First word always capitalized
            result.append(word.capitalize())
        elif word.lower() in LOWERCASE_WORDS:
            result.append(word.lower())
        else:
            result.append(word.capitalize())

    return ' '.join(result)


def clean_xxxx_junk(items, field_name):
    """Remove XXXX padding from ingredient lists and methods."""
    cleaned = []
    removed = 0
    for item in items:
        if field_name == 'ingredients':
            # item is a dict
            if isinstance(item, dict):
                val = item.get('item', '') + item.get('amount', '')
                if 'XXXX' in val:
                    removed += 1
                    continue
            cleaned.append(item)
        else:
            # method is a list of strings
            if isinstance(item, str) and 'XXXX' in item:
                removed += 1
                continue
            cleaned.append(item)
    return cleaned, removed


def has_ingredient_match(ingredients_text, keywords, false_positives=None):
    """Check if any keyword appears in ingredients text, excluding false positives."""
    text = ingredients_text.lower()

    # First remove false positives from text
    if false_positives:
        for fp in false_positives:
            text = text.replace(fp.lower(), '')

    for kw in keywords:
        # Word boundary match
        pattern = r'\b' + re.escape(kw.lower()) + r'(?:s|es)?\b'
        if re.search(pattern, text):
            return True
    return False


def infer_diet(recipe):
    """Conservatively infer dietary tags from ingredients."""
    # Build ingredients text
    ingredients = recipe.get('ingredients', [])
    parts = []
    for ing in ingredients:
        if isinstance(ing, dict):
            parts.append(ing.get('item', ''))
            parts.append(ing.get('amount', ''))
        elif isinstance(ing, str):
            parts.append(ing)

    # Also check the recipe name
    name = recipe.get('name', '')
    text = ' '.join(parts)

    # Check for explicit vegan/vegetarian cookbooks
    cookbook = recipe.get('source', {}).get('cookbook', '')
    is_vegan_book = cookbook in [
        'Afro-Vegan', 'Vegan Chocolate', 'The High-Protein Vegan Cookbook',
        'The Indian Vegan', 'The Vegan Korean', 'Vegan Vietnamese',
        'Vegan Nigerian Kitchen', 'Black Rican Vegan', 'Raw Food',
    ]

    has_meat = has_ingredient_match(text, MEAT_KEYWORDS, FALSE_POSITIVES)
    has_fish = has_ingredient_match(text, FISH_KEYWORDS, FALSE_POSITIVES)
    has_dairy = has_ingredient_match(text, DAIRY_KEYWORDS, FALSE_POSITIVES)
    has_egg = has_ingredient_match(text, EGG_KEYWORDS, FALSE_POSITIVES)
    has_honey = has_ingredient_match(text, HONEY_KEYWORDS)
    has_gluten = has_ingredient_match(text, GLUTEN_KEYWORDS)

    # Also check name for meat/fish
    name_has_meat = has_ingredient_match(name, MEAT_KEYWORDS, FALSE_POSITIVES)
    name_has_fish = has_ingredient_match(name, FISH_KEYWORDS, FALSE_POSITIVES)

    tags = []

    if is_vegan_book:
        # Trust the cookbook - it's explicitly vegan
        tags.append('vegan')
        tags.append('vegetarian')
    elif not has_meat and not has_fish and not name_has_meat and not name_has_fish:
        if not has_dairy and not has_egg and not has_honey:
            tags.append('vegan')
            tags.append('vegetarian')
        else:
            tags.append('vegetarian')

    # Gluten-free: only tag if clearly no gluten sources
    # Be very conservative - only for recipes from books where this matters
    # and where ingredients are clean enough to trust
    if not has_gluten and len(ingredients) >= 2:
        tags.append('gluten-free')

    return tags


def remove_numbered_duplicates(recipes_dir):
    """Find and remove numbered-prefix duplicate files from More Than Carbonara."""
    files = [f for f in os.listdir(recipes_dir) if f.endswith('.json')]

    # Group by name (lowercase)
    name_groups = defaultdict(list)
    for f in files:
        with open(os.path.join(recipes_dir, f)) as fh:
            r = json.load(fh)
        name = r.get('name', '').lower().strip()
        book = r.get('source', {}).get('cookbook', '')
        name_groups[(name, book)].append(f)

    removed = []
    for (name, book), file_list in name_groups.items():
        if len(file_list) <= 1:
            continue
        # Only auto-dedupe within same cookbook
        # Prefer non-numbered filename
        numbered = [f for f in file_list if re.match(r'^\d+-', f)]
        non_numbered = [f for f in file_list if not re.match(r'^\d+-', f)]

        if non_numbered and numbered:
            # Remove the numbered versions
            for f in numbered:
                filepath = os.path.join(recipes_dir, f)
                os.remove(filepath)
                removed.append((f, name, book))

    return removed


def process_recipes(dry_run=False):
    """Main cleanup pass."""
    files = sorted([f for f in os.listdir(RECIPES_DIR) if f.endswith('.json')])

    stats = {
        'total': len(files),
        'names_fixed': 0,
        'xxxx_cleaned': 0,
        'cuisine_added': 0,
        'cuisine_fixed': 0,
        'diet_added': 0,
        'diet_updated': 0,
        'duplicates_removed': 0,
        'files_modified': 0,
        'junk_names_flagged': [],
        'truncated_names_flagged': [],
    }

    # Step 1: Remove duplicates
    if not dry_run:
        removed = remove_numbered_duplicates(RECIPES_DIR)
        stats['duplicates_removed'] = len(removed)
        print(f"Removed {len(removed)} duplicate files")
        for f, name, book in removed:
            print(f"  - {f} ({name})")

        # Refresh file list
        files = sorted([f for f in os.listdir(RECIPES_DIR) if f.endswith('.json')])

    # Step 2: Process each recipe
    for filename in files:
        filepath = os.path.join(RECIPES_DIR, filename)
        with open(filepath) as fh:
            recipe = json.load(fh)

        modified = False
        name = recipe.get('name', '')
        cookbook = recipe.get('source', {}).get('cookbook', '') if isinstance(recipe.get('source'), dict) else ''

        # ── Name cleanup ──
        original_name = name

        # Flag sentence-like junk names (don't auto-fix)
        if name and (
            (name[0].islower() and len(name) > 20) or
            name.startswith('This ') or
            name.startswith('Just ') or
            (len(name) > 5 and name.endswith('.')) or
            'XXXX' in name
        ):
            stats['junk_names_flagged'].append((name[:80], cookbook, filename))

        # Flag truncated names (AND ..., fragments)
        if name and name.upper() == name and name.startswith('AND '):
            stats['truncated_names_flagged'].append((name, cookbook, filename))

        # ALL CAPS → Title Case
        if name and name == name.upper() and len(name) > 3:
            new_name = smart_title_case(name)
            if new_name != name:
                recipe['name'] = new_name
                modified = True
                stats['names_fixed'] += 1

        # ── XXXX junk removal ──
        if 'ingredients' in recipe:
            cleaned, removed_count = clean_xxxx_junk(recipe['ingredients'], 'ingredients')
            if removed_count > 0:
                recipe['ingredients'] = cleaned
                modified = True
                stats['xxxx_cleaned'] += removed_count

        if 'method' in recipe:
            cleaned, removed_count = clean_xxxx_junk(recipe['method'], 'method')
            if removed_count > 0:
                recipe['method'] = cleaned
                modified = True
                stats['xxxx_cleaned'] += removed_count

        # ── Cuisine normalization ──
        current_cuisine = recipe.get('cuisine', '')
        expected_cuisine = COOKBOOK_CUISINE.get(cookbook, '')

        if not current_cuisine and expected_cuisine:
            recipe['cuisine'] = expected_cuisine
            modified = True
            stats['cuisine_added'] += 1
        elif current_cuisine and expected_cuisine and current_cuisine != expected_cuisine:
            # Fix mismatches where the cookbook mapping is authoritative
            recipe['cuisine'] = expected_cuisine
            modified = True
            stats['cuisine_fixed'] += 1

        # ── Diet inference ──
        tags_field = recipe.get('tags', {})
        if not isinstance(tags_field, dict):
            tags_field = {}
        existing_diet = recipe.get('dietary', tags_field.get('dietary', []))
        if not isinstance(existing_diet, list):
            existing_diet = []

        inferred = infer_diet(recipe)

        if not existing_diet and inferred:
            # Add new diet tags
            recipe['dietary'] = inferred
            modified = True
            stats['diet_added'] += 1
        elif existing_diet:
            # Merge: keep existing, add new inferred ones
            merged = list(set(existing_diet + inferred))
            merged.sort()
            if set(merged) != set(existing_diet):
                recipe['dietary'] = merged
                modified = True
                stats['diet_updated'] += 1

        # ── Write back ──
        if modified and not dry_run:
            with open(filepath, 'w') as fh:
                json.dump(recipe, fh, indent=2, ensure_ascii=False)
                fh.write('\n')
            stats['files_modified'] += 1

    return stats


if __name__ == '__main__':
    dry_run = '--dry-run' in sys.argv

    if dry_run:
        print("=== DRY RUN MODE ===\n")

    stats = process_recipes(dry_run=dry_run)

    print(f"\n=== CLEANUP RESULTS ===")
    print(f"Total recipes: {stats['total']}")
    print(f"Files modified: {stats['files_modified']}")
    print(f"Duplicates removed: {stats['duplicates_removed']}")
    print(f"Names fixed (caps): {stats['names_fixed']}")
    print(f"XXXX junk lines removed: {stats['xxxx_cleaned']}")
    print(f"Cuisine tags added: {stats['cuisine_added']}")
    print(f"Cuisine tags fixed: {stats['cuisine_fixed']}")
    print(f"Diet tags added: {stats['diet_added']}")
    print(f"Diet tags updated: {stats['diet_updated']}")

    if stats['junk_names_flagged']:
        print(f"\n=== JUNK NAMES (need manual review): {len(stats['junk_names_flagged'])} ===")
        for name, book, f in stats['junk_names_flagged'][:30]:
            print(f"  [{book}] {name}")

    if stats['truncated_names_flagged']:
        print(f"\n=== TRUNCATED NAMES (need manual review): {len(stats['truncated_names_flagged'])} ===")
        for name, book, f in stats['truncated_names_flagged']:
            print(f"  [{book}] {name}")
