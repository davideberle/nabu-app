import Link from "next/link";
import { notFound } from "next/navigation";

// Recipes data - will be loaded from JSON files later
const recipesData: Record<string, {
  id: string;
  name: string;
  author: string;
  cookbook: string;
  category: string;
  servings: number;
  time: { prep: number; cook: number; total: number };
  tags: string[];
  ingredients: { item: string; amount: number | string; unit: string }[];
  steps: string[];
}> = {
  "shakshuka": {
    id: "shakshuka",
    name: "Shakshuka",
    author: "Yotam Ottolenghi",
    cookbook: "Ottolenghi",
    category: "main",
    servings: 4,
    time: { prep: 15, cook: 30, total: 45 },
    tags: ["vegetarian", "brunch", "one-pan", "gluten-free"],
    ingredients: [
      { item: "olive oil", amount: 60, unit: "ml" },
      { item: "onion", amount: 2, unit: "medium" },
      { item: "red bell pepper", amount: 2, unit: "" },
      { item: "garlic cloves", amount: 4, unit: "" },
      { item: "cumin seeds", amount: 1, unit: "tsp" },
      { item: "paprika", amount: 1, unit: "tsp" },
      { item: "cayenne pepper", amount: 0.25, unit: "tsp" },
      { item: "canned whole tomatoes", amount: 800, unit: "g" },
      { item: "sugar", amount: 1, unit: "tsp" },
      { item: "salt", amount: 1, unit: "tsp" },
      { item: "eggs", amount: 6, unit: "large" },
      { item: "feta cheese", amount: 100, unit: "g" },
      { item: "cilantro", amount: 15, unit: "g" },
      { item: "crusty bread", amount: 1, unit: "loaf" },
    ],
    steps: [
      "Heat olive oil in a large, deep frying pan over medium heat. Add sliced onions and cook for 8-10 minutes until soft and golden.",
      "Add sliced peppers and cook for another 5 minutes until softened.",
      "Stir in minced garlic, cumin, paprika and cayenne. Cook for 1 minute until fragrant.",
      "Pour in tomatoes, breaking them up with a spoon. Add sugar and salt. Simmer for 10-15 minutes until thickened.",
      "Make 6 wells in the sauce and crack an egg into each. Cover and cook for 8-10 minutes until whites are set but yolks are still runny.",
      "Crumble feta over the top and scatter with chopped cilantro.",
      "Serve immediately with crusty bread for dipping.",
    ],
  },
  "roasted-cauliflower-tahini": {
    id: "roasted-cauliflower-tahini",
    name: "Roasted Cauliflower with Tahini",
    author: "Yotam Ottolenghi",
    cookbook: "Ottolenghi",
    category: "side",
    servings: 4,
    time: { prep: 10, cook: 40, total: 50 },
    tags: ["vegetarian", "vegan", "gluten-free"],
    ingredients: [
      { item: "cauliflower", amount: 1, unit: "large head" },
      { item: "olive oil", amount: 80, unit: "ml" },
      { item: "salt", amount: 1, unit: "tsp" },
      { item: "tahini", amount: 100, unit: "g" },
      { item: "lemon juice", amount: 2, unit: "tbsp" },
      { item: "garlic clove", amount: 1, unit: "" },
      { item: "water", amount: 60, unit: "ml" },
      { item: "flat-leaf parsley", amount: 15, unit: "g" },
      { item: "pomegranate seeds", amount: 50, unit: "g" },
    ],
    steps: [
      "Preheat oven to 220°C (200°C fan).",
      "Cut the cauliflower into large florets, keeping some stem attached. Place on a baking tray.",
      "Drizzle generously with olive oil and season with salt. Toss to coat.",
      "Roast for 35-40 minutes until deep golden and slightly charred at the edges.",
      "Make the tahini sauce: whisk tahini with lemon juice, crushed garlic, and water until smooth and pourable. Season with salt.",
      "Arrange cauliflower on a serving plate, drizzle with tahini sauce.",
      "Scatter with chopped parsley and pomegranate seeds. Serve warm.",
    ],
  },
  "watermelon-feta-salad": {
    id: "watermelon-feta-salad",
    name: "Watermelon, Feta and Toasted Sunflower Seeds",
    author: "Yotam Ottolenghi",
    cookbook: "Ottolenghi",
    category: "starter",
    servings: 4,
    time: { prep: 15, cook: 5, total: 20 },
    tags: ["vegetarian", "salad", "summer", "quick"],
    ingredients: [
      { item: "sunflower seeds", amount: 50, unit: "g" },
      { item: "watermelon", amount: 800, unit: "g" },
      { item: "feta cheese", amount: 200, unit: "g" },
      { item: "fresh mint leaves", amount: 20, unit: "g" },
      { item: "olive oil", amount: 60, unit: "ml" },
      { item: "red wine vinegar", amount: 1, unit: "tbsp" },
      { item: "salt", amount: 1, unit: "pinch" },
      { item: "black pepper", amount: 1, unit: "pinch" },
    ],
    steps: [
      "Toast the sunflower seeds in a dry pan over medium heat until golden. Set aside to cool.",
      "Cut the watermelon into irregular chunks, removing the rind. Place in a large serving bowl.",
      "Crumble the feta over the watermelon.",
      "Tear the mint leaves and scatter over the salad.",
      "Whisk together the olive oil and red wine vinegar with a pinch of salt and pepper.",
      "Drizzle the dressing over the salad, scatter with toasted seeds, and serve immediately.",
    ],
  },
  "lamb-shawarma": {
    id: "lamb-shawarma",
    name: "Lamb Shawarma",
    author: "Yotam Ottolenghi",
    cookbook: "Ottolenghi",
    category: "main",
    servings: 6,
    time: { prep: 20, cook: 90, total: 110 },
    tags: ["meat", "special-occasion", "make-ahead"],
    ingredients: [
      { item: "lamb shoulder, boneless", amount: 1.2, unit: "kg" },
      { item: "onion", amount: 2, unit: "large" },
      { item: "garlic cloves", amount: 6, unit: "" },
      { item: "ground cumin", amount: 2, unit: "tsp" },
      { item: "ground coriander", amount: 2, unit: "tsp" },
      { item: "ground cardamom", amount: 1, unit: "tsp" },
      { item: "ground cinnamon", amount: 0.5, unit: "tsp" },
      { item: "turmeric", amount: 0.5, unit: "tsp" },
      { item: "paprika", amount: 1, unit: "tsp" },
      { item: "olive oil", amount: 80, unit: "ml" },
      { item: "lemon juice", amount: 60, unit: "ml" },
      { item: "salt", amount: 2, unit: "tsp" },
      { item: "flatbreads", amount: 6, unit: "" },
      { item: "tahini sauce", amount: 200, unit: "ml" },
      { item: "pickled turnips", amount: 100, unit: "g" },
      { item: "fresh herbs", amount: 30, unit: "g" },
    ],
    steps: [
      "Cut lamb into 5cm chunks. Place in a large bowl.",
      "Blend onions, garlic, all spices, olive oil, lemon juice and salt into a paste. Pour over lamb and mix well. Cover and marinate for at least 4 hours, preferably overnight.",
      "Preheat oven to 200°C. Transfer lamb and marinade to a roasting tin, spread in a single layer.",
      "Roast for 30 minutes, then reduce to 170°C and cook for another hour, turning halfway.",
      "The lamb should be dark, caramelized and falling apart. Shred with two forks.",
      "Warm the flatbreads. Fill with lamb, drizzle with tahini, add pickled turnips and fresh herbs.",
      "Roll up and serve immediately.",
    ],
  },
  "grilled-quail-mograbiah": {
    id: "grilled-quail-mograbiah",
    name: "Grilled Quail with Mograbiah Salad",
    author: "Yotam Ottolenghi",
    cookbook: "Ottolenghi",
    category: "main",
    servings: 4,
    time: { prep: 30, cook: 30, total: 60 },
    tags: ["poultry", "grilling", "special-occasion"],
    ingredients: [
      { item: "dried barberries", amount: 2, unit: "tbsp" },
      { item: "ground turmeric", amount: 1, unit: "tbsp" },
      { item: "paprika", amount: 0.5, unit: "tbsp" },
      { item: "salt", amount: 1, unit: "pinch" },
      { item: "garlic cloves", amount: 4, unit: "cloves" },
      { item: "fresh ginger", amount: 30, unit: "g" },
      { item: "honey", amount: 2, unit: "tbsp" },
      { item: "olive oil", amount: 180, unit: "ml" },
      { item: "quail, butterflied", amount: 8, unit: "large" },
      { item: "mograbiah or fregola", amount: 125, unit: "g" },
      { item: "unsalted butter", amount: 10, unit: "g" },
      { item: "mild red chile", amount: 1, unit: "" },
      { item: "green onion", amount: 1, unit: "" },
      { item: "lemon", amount: 1, unit: "" },
      { item: "flat-leaf parsley", amount: 3, unit: "tbsp" },
      { item: "cilantro", amount: 3, unit: "tbsp" },
      { item: "mint", amount: 3, unit: "tbsp" },
    ],
    steps: [
      "To make the marinade, put all the spices and salt in a small food processor or spice grinder and pulse to get a fine powder. Add the garlic and ginger and work into a paste. Transfer to a large bowl and whisk in the honey and oil. Add the quail and massage with the marinade. Cover and chill for at least 4 hours, preferably overnight.",
      "To make the salad, bring 1 liter water to a boil with a pinch of salt and add the mograbiah. Simmer for 15-18 minutes until tender. Strain, transfer to a bowl, add butter and oil, season well. Set aside to cool.",
      "Cut the chile in half, remove seeds, chop finely. Finely slice the green onion. Add to the cooling mograbiah.",
      "Segment the lemon: trim top and bottom, follow curves to remove skin and pith. Cut along membranes to release segments into the bowl. Squeeze in remaining juice.",
      "Place a ridged grill pan over medium heat. Lay the quail on it, spaced apart, and grill for 10-14 minutes, turning halfway through.",
      "When quail are almost ready, stir the herbs into the mograbiah. Taste and adjust seasoning.",
      "Pile the salad onto serving dishes and place 2 quail per portion on top. Serve at once.",
    ],
  },
};

export default async function RecipePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const recipe = recipesData[id];

  if (!recipe) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 pb-20">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            href="/recipes"
            className="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            ← Recipes
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            {recipe.name}
          </h1>
          <div className="flex items-center gap-3 mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            <span>{recipe.cookbook}</span>
            <span>•</span>
            <span>{recipe.author}</span>
          </div>
          <div className="flex items-center gap-4 mt-3">
            <span className="text-sm bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded">
              🕐 {recipe.time.total} min
            </span>
            <span className="text-sm bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded">
              👥 {recipe.servings} servings
            </span>
          </div>
          <div className="flex gap-2 mt-3 flex-wrap">
            {recipe.tags.map((tag) => (
              <span
                key={tag}
                className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-full"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        {/* Ingredients */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
            Ingredients
          </h2>
          <ul className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800">
            {recipe.ingredients.map((ing, i) => (
              <li key={i} className="px-4 py-2 flex justify-between">
                <span className="text-zinc-900 dark:text-zinc-100">
                  {ing.item}
                </span>
                <span className="text-zinc-500 dark:text-zinc-400">
                  {ing.amount} {ing.unit}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Steps */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
            Method
          </h2>
          <ol className="space-y-4">
            {recipe.steps.map((step, i) => (
              <li key={i} className="flex gap-4">
                <span className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 flex items-center justify-center font-medium text-sm">
                  {i + 1}
                </span>
                <p className="text-zinc-700 dark:text-zinc-300 pt-1">{step}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Actions */}
        <div className="flex gap-3">
          <Link
            href={`/recipes/${recipe.id}/cook`}
            className="flex-1 py-3 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg text-center transition-colors"
          >
            Start Cooking 👨‍🍳
          </Link>
        </div>
      </main>
    </div>
  );
}
