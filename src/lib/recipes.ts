// Recipe types and data loading
// In production, this would load from an API or database

export type Ingredient = {
  amount: string;
  unit: string;
  item: string;
};

export type Recipe = {
  id: string;
  name: string;
  author: string;
  cookbook: string;
  description?: string;
  category: string;
  cuisine: string;
  servings: number;
  time: { prep: number; cook: number; total: number };
  tags: string[];
  ingredients: Ingredient[];
  steps: string[];
  image: string | null;
};

// Hardcoded recipes from Ottolenghi extraction
// In future: load from API or JSON files
export const recipes: Recipe[] = [
  {
    id: "peaches-and-speck-with-orange-blossom",
    name: "Peaches and speck with orange blossom",
    author: "Yotam Ottolenghi",
    cookbook: "Ottolenghi: The Cookbook",
    description: "A substantial starter, this salad is summer bliss, offering contrasting textures and aromas.",
    category: "starter",
    cuisine: "middle-eastern",
    servings: 4,
    time: { prep: 15, cook: 5, total: 20 },
    tags: ["summer", "salad", "quick"],
    ingredients: [
      { amount: "5", unit: "", item: "ripe peaches" },
      { amount: "1", unit: "tbsp", item: "olive oil" },
      { amount: "2", unit: "", item: "red or white endives, leaves separated" },
      { amount: "50", unit: "g", item: "watercress" },
      { amount: "50", unit: "g", item: "baby chard leaves" },
      { amount: "100", unit: "g", item: "speck, thinly sliced" },
      { amount: "3", unit: "tbsp", item: "orange blossom water" },
      { amount: "1", unit: "tbsp", item: "balsamic vinegar" },
      { amount: "1", unit: "tbsp", item: "maple syrup" },
      { amount: "3", unit: "tbsp", item: "olive oil (for dressing)" },
    ],
    steps: [
      "Cut the peaches in half and remove the pits. Slice each half into 3 wedges, place in a bowl, and add the olive oil and some salt and pepper. Toss well to coat them.",
      "Place a ridged grill pan over high heat. Place the peach wedges on the pan and grill for a minute on each side until you get nice charcoal lines. Remove and leave to cool.",
      "To make the dressing, whisk together the orange blossom water, vinegar, and maple syrup. Drizzle the oil in slowly while whisking to get a thick dressing. Season to taste.",
      "On a serving platter, arrange layers of peach, endive, watercress, chard, and speck. Spoon over enough dressing to coat all the ingredients. Serve straight away.",
    ],
    image: "/recipes/peaches-and-speck-with-orange-blossom.jpg",
  },
  {
    id: "burnt-eggplant-with-yellow-pepper-and-red-onion",
    name: "Burnt eggplant with yellow pepper and red onion",
    author: "Yotam Ottolenghi",
    cookbook: "Ottolenghi: The Cookbook",
    description: "Smoky charred eggplant with sweet peppers and tangy dressing.",
    category: "side",
    cuisine: "middle-eastern",
    servings: 4,
    time: { prep: 15, cook: 40, total: 55 },
    tags: ["vegetarian", "vegan", "gluten-free"],
    ingredients: [
      { amount: "2", unit: "large", item: "eggplants" },
      { amount: "2", unit: "", item: "yellow bell peppers" },
      { amount: "1", unit: "medium", item: "red onion, thinly sliced" },
      { amount: "2", unit: "tbsp", item: "olive oil" },
      { amount: "1", unit: "tbsp", item: "lemon juice" },
      { amount: "1", unit: "tbsp", item: "pomegranate molasses" },
      { amount: "2", unit: "tbsp", item: "chopped flat-leaf parsley" },
      { amount: "", unit: "", item: "salt and black pepper" },
    ],
    steps: [
      "Place the eggplants directly over a gas flame or under a hot broiler. Turn occasionally until the skin is charred all over and the flesh is soft, about 15 minutes. Set aside to cool.",
      "Roast or char the peppers until blackened. Place in a bowl, cover with plastic wrap, and let steam for 10 minutes. Peel, seed, and slice into strips.",
      "Peel the eggplants and tear the flesh into long strips. Place in a bowl with the peppers and onion.",
      "Drizzle with olive oil, lemon juice, and pomegranate molasses. Toss gently, season with salt and pepper, and scatter with parsley.",
    ],
    image: "/recipes/burnt-eggplant-with-yellow-pepper-and-red-onion.jpg",
  },
  {
    id: "roasted-eggplant-with-saffron-yogurt",
    name: "Roasted eggplant with saffron yogurt",
    author: "Yotam Ottolenghi",
    cookbook: "Ottolenghi: The Cookbook",
    description: "Silky roasted eggplant topped with golden saffron yogurt.",
    category: "side",
    cuisine: "middle-eastern",
    servings: 4,
    time: { prep: 15, cook: 45, total: 60 },
    tags: ["vegetarian", "gluten-free"],
    ingredients: [
      { amount: "2", unit: "large", item: "eggplants" },
      { amount: "4", unit: "tbsp", item: "olive oil" },
      { amount: "1", unit: "pinch", item: "saffron threads" },
      { amount: "2", unit: "tbsp", item: "hot water" },
      { amount: "200", unit: "g", item: "Greek yogurt" },
      { amount: "1", unit: "clove", item: "garlic, crushed" },
      { amount: "2", unit: "tbsp", item: "chopped mint" },
      { amount: "1", unit: "tbsp", item: "pomegranate seeds" },
    ],
    steps: [
      "Preheat oven to 200°C. Cut the eggplants in half lengthwise and score the flesh in a crosshatch pattern.",
      "Brush generously with olive oil and season with salt. Place cut-side down on a baking sheet and roast for 40-45 minutes until completely soft.",
      "Steep the saffron in hot water for 5 minutes. Mix the yogurt with garlic, saffron water, and a pinch of salt.",
      "Place the eggplants cut-side up on a serving plate. Spoon over the saffron yogurt, scatter with mint and pomegranate seeds.",
    ],
    image: "/recipes/roasted-eggplant-with-saffron-yogurt.jpg",
  },
  {
    id: "fennel-and-feta-with-pomegranate-seeds-and-sumac",
    name: "Fennel and feta with pomegranate seeds and sumac",
    author: "Yotam Ottolenghi",
    cookbook: "Ottolenghi: The Cookbook",
    description: "A refreshing salad with anise-scented fennel and tangy sumac.",
    category: "starter",
    cuisine: "middle-eastern",
    servings: 4,
    time: { prep: 15, cook: 0, total: 15 },
    tags: ["vegetarian", "salad", "quick", "no-cook"],
    ingredients: [
      { amount: "2", unit: "medium", item: "fennel bulbs" },
      { amount: "150", unit: "g", item: "feta cheese" },
      { amount: "3", unit: "tbsp", item: "pomegranate seeds" },
      { amount: "2", unit: "tsp", item: "sumac" },
      { amount: "3", unit: "tbsp", item: "olive oil" },
      { amount: "1", unit: "tbsp", item: "lemon juice" },
      { amount: "2", unit: "tbsp", item: "chopped mint" },
    ],
    steps: [
      "Remove the tough outer layer of the fennel. Cut in half and slice very thinly, ideally on a mandoline. Place in ice water for 10 minutes to crisp up, then drain well.",
      "Arrange the fennel on a serving plate. Crumble the feta over the top.",
      "Scatter with pomegranate seeds and dust generously with sumac.",
      "Drizzle with olive oil and lemon juice. Finish with mint leaves and serve immediately.",
    ],
    image: "/recipes/fennel-and-feta-with-pomegranate-seeds-and-sumac.jpg",
  },
  {
    id: "grilled-asparagus-zucchini-and-manouri",
    name: "Grilled asparagus, zucchini, and manouri",
    author: "Yotam Ottolenghi",
    cookbook: "Ottolenghi: The Cookbook",
    description: "Charred spring vegetables with creamy Greek cheese.",
    category: "side",
    cuisine: "middle-eastern",
    servings: 4,
    time: { prep: 10, cook: 15, total: 25 },
    tags: ["vegetarian", "grilling", "spring"],
    ingredients: [
      { amount: "400", unit: "g", item: "asparagus, trimmed" },
      { amount: "2", unit: "medium", item: "zucchini" },
      { amount: "200", unit: "g", item: "manouri or halloumi cheese" },
      { amount: "4", unit: "tbsp", item: "olive oil" },
      { amount: "1", unit: "", item: "lemon, zested and juiced" },
      { amount: "2", unit: "tbsp", item: "chopped dill" },
      { amount: "1", unit: "tbsp", item: "capers" },
    ],
    steps: [
      "Heat a ridged grill pan over high heat. Slice the zucchini lengthwise into 5mm strips.",
      "Toss asparagus and zucchini with 2 tbsp olive oil and season well. Grill in batches until charred and tender, about 3-4 minutes per side.",
      "Slice the cheese into 1cm slices and grill until golden on both sides.",
      "Arrange vegetables and cheese on a platter. Drizzle with remaining oil and lemon juice, scatter with zest, dill, and capers.",
    ],
    image: "/recipes/grilled-asparagus-zucchini-and-manouri.jpg",
  },
];

export function getRecipe(id: string): Recipe | undefined {
  return recipes.find(r => r.id === id);
}

export function getAllRecipes(): Recipe[] {
  return recipes;
}
