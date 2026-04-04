// Recipe types and data loading
// Reads from extracted JSON files in src/data/recipes/

import fs from 'fs';
import path from 'path';

export type Ingredient = {
  item: string;
  amount: string;
  unit: string;
  original: string;
  group?: string | null;
};

export type Recipe = {
  id: string;
  name: string;
  source: {
    cookbook: string;
    author: string;
    chapter: string;
  };
  introduction: string | null;
  category: {
    dish_type: string[];
    chapter: string;
  };
  servings: string;
  time: { prep: number; cook: number; total: number };
  ingredients: Ingredient[];
  method: string[];
  serving?: string;
  related_recipes?: { name: string; page?: number }[];
  tags: {
    dietary: string[];
    season?: string[];
  };
  image: string | null;
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
  return allRecipes.filter(r => r.category.chapter === chapter);
}

export function getRecipesWithImages(): Recipe[] {
  return allRecipes.filter(r => r.image !== null);
}
