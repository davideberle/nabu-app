// Recipe types and data loading
// Reads from extracted JSON files in src/data/recipes/

import fs from 'fs';
import path from 'path';

export type Ingredient = {
  item: string;
  amount: string;
  unit?: string;
  original?: string;
  group?: string | null;
};

export type Recipe = {
  id: string;
  name: string;
  source?: {
    cookbook: string;
    author: string;
    chapter?: string;
  };
  introduction?: string | null;
  intro?: string;
  tips?: string;
  category?: {
    dish_type: string[];
    chapter: string;
  };
  servings: string;
  time?: { prep: number; cook: number; total: number };
  ingredients: Ingredient[];
  method: string[];
  serving?: string;
  related_recipes?: { name: string; page?: number }[];
  tags?: {
    dietary: string[];
    season?: string[];
  };
  dietary?: string[];
  image?: string | null;
};

// Cookbook to cuisine mapping
const COOKBOOK_CUISINES: Record<string, string> = {
  'Ottolenghi: The Cookbook': 'Middle Eastern',
  'Jerusalem': 'Middle Eastern',
  'Falastin': 'Middle Eastern',
  'Persiana': 'Middle Eastern',
  'Souk to Table': 'Middle Eastern',
  'The Curry Guy': 'Indian',
  'The Indian Vegan': 'Indian',
  'Vietnamese Food Any Day': 'Vietnamese',
  'Vegan Vietnamese': 'Vietnamese',
  'Afro-Vegan': 'African & Caribbean',
  'Plentiful': 'Caribbean',
  'The Vegan Korean': 'Korean',
};

// Load recipes from JSON files at build time
function loadRecipes(): Recipe[] {
  const recipesDir = path.join(process.cwd(), 'src/data/recipes');
  
  try {
    const files = fs.readdirSync(recipesDir);
    const recipes: Recipe[] = [];
    
    for (const file of files) {
      if (file.endsWith('.json') && file !== 'index.json') {
        const filePath = path.join(recipesDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const recipe = JSON.parse(content);
        recipes.push(recipe);
      }
    }
    
    // Sort by name
    recipes.sort((a, b) => a.name.localeCompare(b.name));
    
    return recipes;
  } catch (err) {
    console.error('Error loading recipes:', err);
    return [];
  }
}

// Cache recipes at module load
const allRecipes = loadRecipes();

export function getRecipe(id: string): Recipe | undefined {
  return allRecipes.find(r => r.id === id);
}

export function getAllRecipes(): Recipe[] {
  return allRecipes;
}

export function getRecipesByChapter(chapter: string): Recipe[] {
  return allRecipes.filter(r => r.source?.chapter === chapter || r.category?.chapter === chapter);
}

export function getRecipesWithImages(): Recipe[] {
  return allRecipes.filter(r => r.image !== null);
}

// Get cuisine for a recipe
export function getCuisine(recipe: Recipe): string {
  const cookbook = recipe.source?.cookbook;
  if (cookbook && COOKBOOK_CUISINES[cookbook]) {
    return COOKBOOK_CUISINES[cookbook];
  }
  return 'Other';
}

// Get dietary tags for a recipe (normalized)
export function getDietary(recipe: Recipe): string[] {
  return recipe.dietary || recipe.tags?.dietary || [];
}

// Cookbook cover images (extracted from EPUBs + Open Library)
const COOKBOOK_COVERS: Record<string, string> = {
  'Ottolenghi: The Cookbook': '/cookbooks/ottolenghi-the-cookbook.jpg',
  'Jerusalem': '/cookbooks/jerusalem.jpg',
  'Falastin': '/cookbooks/falastin.jpg',
  'Persiana': '/cookbooks/persiana.jpg',
  'The Curry Guy': '/cookbooks/the-curry-guy.jpg',
  'The Curry Guy Bible': '/cookbooks/the-curry-guy-bible.jpg',
  'The Indian Vegan': '/cookbooks/the-indian-vegan.jpg',
  'Vietnamese Food Any Day': '/cookbooks/vietnamese-food-any-day.jpg',
  'Afro-Vegan': '/cookbooks/afro-vegan.jpg',
  'Plentiful': '/cookbooks/plentiful.jpg',
  'The Vegan Korean': '/cookbooks/the-vegan-korean.jpg',
  'Black Rican Vegan': '/cookbooks/black-rican-vegan.jpg',
  'Brunch Cookbook': '/cookbooks/brunch-cookbook.jpg',
  'Four Seasons': '/cookbooks/four-seasons.jpg',
  'The High-Protein Vegan Cookbook': '/cookbooks/the-high-protein-vegan-cookbook.jpg',
  'Land of Fish and Rice': '/cookbooks/land-of-fish-and-rice.jpg',
  'Vegan Chocolate': '/cookbooks/vegan-chocolate.jpg',
  'The Authentic Greek Kitchen': '/cookbooks/the-authentic-greek-kitchen.jpg',
  'Zagami Family Cookbook': '/cookbooks/zagami-family-cookbook.jpg',
};

// Get all unique cookbooks with counts
export function getCookbooks(): { name: string; slug: string; count: number; author?: string; cover?: string }[] {
  const cookbookMap = new Map<string, { count: number; author?: string }>();
  
  for (const recipe of allRecipes) {
    const cookbook = recipe.source?.cookbook;
    if (cookbook) {
      const existing = cookbookMap.get(cookbook);
      if (existing) {
        existing.count++;
      } else {
        cookbookMap.set(cookbook, { count: 1, author: recipe.source?.author });
      }
    }
  }
  
  return Array.from(cookbookMap.entries())
    .map(([name, data]) => ({
      name,
      slug: slugify(name),
      count: data.count,
      author: data.author,
      cover: COOKBOOK_COVERS[name]
    }))
    .sort((a, b) => b.count - a.count);
}

// Get all unique cuisines with counts
export function getCuisines(): { name: string; slug: string; count: number }[] {
  const cuisineMap = new Map<string, number>();
  
  for (const recipe of allRecipes) {
    const cuisine = getCuisine(recipe);
    cuisineMap.set(cuisine, (cuisineMap.get(cuisine) || 0) + 1);
  }
  
  return Array.from(cuisineMap.entries())
    .map(([name, count]) => ({
      name,
      slug: slugify(name),
      count
    }))
    .sort((a, b) => b.count - a.count);
}

// Get recipes by cookbook
export function getRecipesByCookbook(cookbookSlug: string): Recipe[] {
  return allRecipes.filter(r => {
    const cookbook = r.source?.cookbook;
    return cookbook && slugify(cookbook) === cookbookSlug;
  });
}

// Get recipes by cuisine
export function getRecipesByCuisine(cuisineSlug: string): Recipe[] {
  return allRecipes.filter(r => slugify(getCuisine(r)) === cuisineSlug);
}

// Get recipes by dietary tag
export function getRecipesByDietary(dietary: string): Recipe[] {
  return allRecipes.filter(r => {
    const tags = getDietary(r);
    return tags.includes(dietary.toLowerCase());
  });
}

// Helper to create URL-safe slugs
function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// Get dietary options with counts
export function getDietaryOptions(): { name: string; slug: string; count: number }[] {
  const dietaryMap = new Map<string, number>();
  
  for (const recipe of allRecipes) {
    const tags = getDietary(recipe);
    for (const tag of tags) {
      dietaryMap.set(tag, (dietaryMap.get(tag) || 0) + 1);
    }
  }
  
  return Array.from(dietaryMap.entries())
    .map(([name, count]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      slug: name.toLowerCase(),
      count
    }))
    .sort((a, b) => b.count - a.count);
}
