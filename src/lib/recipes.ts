// Recipe types and data loading
// Following design principles: faithful to original, metric units, chef's prose

export type Ingredient = {
  item: string;
  amount: string;
  unit: string;
  original: string; // Chef's exact text
  group?: string;   // e.g., "Dressing", "Saffron yogurt"
};

export type Recipe = {
  id: string;
  name: string;
  source: {
    cookbook: string;
    author: string;
    chapter: string;
    page?: number;
  };
  introduction: string;        // Chef's headnote explaining the dish
  category: {
    dish_type: string[];       // vegetable, salad, etc.
    chapter: string;           // From book structure
  };
  servings: string;            // "serves 4" or "serves 4 to 6"
  time: { prep: number; cook: number; total: number };
  ingredients: Ingredient[];
  method: string[];            // Chef's original prose
  serving?: string;            // Serving suggestions
  related_recipes?: { name: string; page?: number }[];
  tags: {
    dietary: string[];
    season?: string[];
  };
  image: string | null;
};

export const recipes: Recipe[] = [
  {
    id: "roasted-eggplant-with-saffron-yogurt",
    name: "Roasted eggplant with saffron yogurt",
    source: {
      cookbook: "Ottolenghi: The Cookbook",
      author: "Yotam Ottolenghi",
      chapter: "Vegetables – Mighty Eggplant",
      page: 29
    },
    introduction: "This is probably the archetypal Ottolenghi salad: robust contrasting flavors, vibrant and vivacious colors, fresh herbs, and nuts. To create the most impact, we recommend that you serve it from a communal plate brought out to the dining table. It makes an exciting starter and doesn't need much else alongside it.",
    category: {
      dish_type: ["vegetable", "side"],
      chapter: "Vegetables"
    },
    servings: "serves 4",
    time: { prep: 15, cook: 35, total: 50 },
    ingredients: [
      { item: "saffron threads", amount: "1", unit: "small pinch", original: "a small pinch of saffron threads", group: "Saffron yogurt" },
      { item: "hot water", amount: "45", unit: "ml", original: "3 tbsp hot water", group: "Saffron yogurt" },
      { item: "Greek yogurt", amount: "180", unit: "g", original: "¾ cup / 180 g Greek yogurt", group: "Saffron yogurt" },
      { item: "garlic", amount: "1", unit: "clove", original: "1 clove garlic, crushed", group: "Saffron yogurt" },
      { item: "lemon juice", amount: "2.5", unit: "tbsp", original: "2½ tbsp lemon juice", group: "Saffron yogurt" },
      { item: "olive oil", amount: "3", unit: "tbsp", original: "3 tbsp olive oil", group: "Saffron yogurt" },
      { item: "coarse sea salt", amount: "", unit: "", original: "coarse sea salt", group: "Saffron yogurt" },
      { item: "eggplants", amount: "3", unit: "medium", original: "3 medium eggplants, cut into slices ¾ inch / 2 cm thick, or into wedges" },
      { item: "olive oil", amount: "", unit: "", original: "olive oil for brushing" },
      { item: "pine nuts", amount: "2", unit: "tbsp", original: "2 tbsp toasted pine nuts" },
      { item: "pomegranate seeds", amount: "1", unit: "handful", original: "a handful of pomegranate seeds" },
      { item: "basil leaves", amount: "20", unit: "", original: "20 basil leaves" },
      { item: "salt and pepper", amount: "", unit: "", original: "coarse sea salt and freshly ground black pepper" }
    ],
    method: [
      "To make the sauce, infuse the saffron in the hot water in a small bowl for 5 minutes. Pour the infusion into a bowl containing the yogurt, garlic, lemon juice, olive oil, and some salt. Whisk well to get a smooth, golden sauce. Taste and adjust the salt, if necessary, then chill. This sauce will keep well in the fridge for up to 3 days.",
      "Preheat the oven to 220°C. Place the eggplant slices on a baking sheet, brush both sides with plenty of olive oil, and sprinkle with salt and pepper. Roast for 20 to 35 minutes, until the slices take on a beautiful light brown color. Let them cool down. The eggplants will keep in the fridge for 3 days; just let them come to room temperature before serving.",
      "To serve, arrange the eggplant slices on a large plate, slightly overlapping. Drizzle the saffron yogurt over them, sprinkle with the pine nuts and pomegranate seeds, and lay the basil on top."
    ],
    related_recipes: [
      { name: "Marinated Eggplant", page: 26 }
    ],
    tags: {
      dietary: ["vegetarian", "gluten-free"],
      season: ["summer", "autumn"]
    },
    image: "/recipes/roasted-eggplant-with-saffron-yogurt.jpg"
  },
  {
    id: "peaches-and-speck-with-orange-blossom",
    name: "Peaches and speck with orange blossom",
    source: {
      cookbook: "Ottolenghi: The Cookbook",
      author: "Yotam Ottolenghi",
      chapter: "Vegetables",
      page: 13
    },
    introduction: "A substantial starter, this salad is summer bliss, offering contrasting textures and aromas. Use the best ingredients you can get your hands on—it is crucial here. Taste the peaches; they mustn't be floury, just sweet and juicy.\n\nYellow-fleshed peaches are normally less watery than the white variety, so they will grill more readily. Grilling, though, is not essential. It will add to the presentation and give a slight smokiness, but you can choose to skip this step.",
    category: {
      dish_type: ["salad", "starter"],
      chapter: "Vegetables"
    },
    servings: "serves 4 to 6",
    time: { prep: 15, cook: 5, total: 20 },
    ingredients: [
      { item: "ripe peaches", amount: "5", unit: "", original: "5 ripe peaches" },
      { item: "olive oil", amount: "1", unit: "tbsp", original: "1 tbsp olive oil" },
      { item: "endives", amount: "2", unit: "", original: "2 red or white endives, leaves separated" },
      { item: "watercress", amount: "50", unit: "g", original: "1¾ oz / 50 g watercress" },
      { item: "baby chard leaves", amount: "50", unit: "g", original: "1¾ oz / 50 g baby chard leaves or other small leaves" },
      { item: "speck", amount: "100", unit: "g", original: "3½ oz / 100 g speck, thinly sliced (10 to 12 slices)" },
      { item: "salt and pepper", amount: "", unit: "", original: "coarse sea salt and freshly ground black pepper" },
      { item: "orange blossom water", amount: "3", unit: "tbsp", original: "3 tbsp orange blossom water", group: "Dressing" },
      { item: "balsamic vinegar", amount: "1", unit: "tbsp", original: "1 tbsp good-quality balsamic vinegar", group: "Dressing" },
      { item: "maple syrup", amount: "1", unit: "tbsp", original: "1 tbsp maple syrup", group: "Dressing" },
      { item: "olive oil", amount: "3", unit: "tbsp", original: "3 tbsp olive oil", group: "Dressing" }
    ],
    method: [
      "Cut the peaches in half and remove the pits. Slice each half into 3 wedges, place in a bowl, and add the olive oil and some salt and pepper. Toss well to coat them.",
      "Place a ridged grill pan over high heat and leave for a few minutes so it heats up well. Place the peach wedges on the pan and grill for a minute on each side. You want to get nice charcoal lines on all sides. Remove the peaches from the pan and leave to cool.",
      "To make the dressing, place the orange blossom water, vinegar, and maple syrup in a bowl and whisk to combine. Drizzle the oil in slowly while you whisk to get a thick dressing. Season to taste.",
      "On a serving platter, arrange layers of peach, endive, watercress, chard, and speck. Spoon over enough dressing to coat all the ingredients but not to drench them. Serve straight away."
    ],
    tags: {
      dietary: [],
      season: ["summer"]
    },
    image: "/recipes/peaches-and-speck-with-orange-blossom.jpg"
  },
  {
    id: "fennel-and-feta-with-pomegranate-seeds-and-sumac",
    name: "Fennel and feta with pomegranate seeds and sumac",
    source: {
      cookbook: "Ottolenghi: The Cookbook",
      author: "Yotam Ottolenghi",
      chapter: "Vegetables",
      page: 17
    },
    introduction: "This salad is a little festival in itself. The fennel and tarragon, with their echoing flavors, form a solid base on which stronger colors and flavors—pomegranate, feta, sumac—manifest themselves without overwhelming the whole salad. It is distinctly fresh and goes well with roast meats and grilled fish. Crusty bread is almost obligatory to soak up the juices from the plate.",
    category: {
      dish_type: ["salad", "side"],
      chapter: "Vegetables"
    },
    servings: "serves 4",
    time: { prep: 15, cook: 0, total: 15 },
    ingredients: [
      { item: "fennel bulbs", amount: "2", unit: "medium", original: "2 medium fennel bulbs" },
      { item: "feta cheese", amount: "200", unit: "g", original: "7 oz / 200 g feta cheese, crumbled" },
      { item: "pomegranate seeds", amount: "80", unit: "g", original: "½ cup / 80 g pomegranate seeds" },
      { item: "tarragon leaves", amount: "1", unit: "tbsp", original: "1 tbsp tarragon leaves" },
      { item: "sumac", amount: "1.5", unit: "tsp", original: "1½ tsp sumac" },
      { item: "lemon juice", amount: "2", unit: "tbsp", original: "2 tbsp lemon juice" },
      { item: "olive oil", amount: "90", unit: "ml", original: "6 tbsp / 90 ml olive oil" },
      { item: "salt and pepper", amount: "", unit: "", original: "coarse sea salt and freshly ground black pepper" }
    ],
    method: [
      "Remove the tough outer layer of the fennel and cut the bulbs in half lengthwise. Lay each half on its flat side and slice thinly with a sharp knife or a mandoline. Place in a mixing bowl.",
      "Add the feta, pomegranate seeds, tarragon, sumac, lemon juice, and olive oil. Toss very gently so that you don't break the feta up too much.",
      "Taste and add salt and pepper as needed. Pile the salad high on a flat serving plate and serve."
    ],
    serving: "Goes well with roast meats and grilled fish. Crusty bread is almost obligatory to soak up the juices from the plate.",
    tags: {
      dietary: ["vegetarian", "gluten-free"],
      season: ["autumn", "winter"]
    },
    image: "/recipes/fennel-and-feta-with-pomegranate-seeds-and-sumac.jpg"
  },
  {
    id: "burnt-eggplant-with-yellow-pepper-and-red-onion",
    name: "Burnt eggplant with yellow pepper and red onion",
    source: {
      cookbook: "Ottolenghi: The Cookbook",
      author: "Yotam Ottolenghi",
      chapter: "Vegetables – Mighty Eggplant",
      page: 27
    },
    introduction: "This fresh take on the burnt eggplant theme combines sweetness from the pepper with a piquant dressing. The charred flavors work beautifully with the raw onion and herbs.",
    category: {
      dish_type: ["vegetable", "side"],
      chapter: "Vegetables"
    },
    servings: "serves 4",
    time: { prep: 15, cook: 25, total: 40 },
    ingredients: [
      { item: "eggplants", amount: "2", unit: "large", original: "2 large eggplants" },
      { item: "yellow bell pepper", amount: "1", unit: "large", original: "1 large yellow bell pepper" },
      { item: "red onion", amount: "0.5", unit: "", original: "½ red onion, very thinly sliced" },
      { item: "flat-leaf parsley", amount: "15", unit: "g", original: "½ oz / 15 g flat-leaf parsley, chopped" },
      { item: "pomegranate molasses", amount: "1", unit: "tbsp", original: "1 tbsp pomegranate molasses" },
      { item: "olive oil", amount: "3", unit: "tbsp", original: "3 tbsp olive oil" },
      { item: "lemon juice", amount: "1", unit: "tbsp", original: "1 tbsp lemon juice" },
      { item: "salt and pepper", amount: "", unit: "", original: "coarse sea salt and freshly ground black pepper" }
    ],
    method: [
      "Place the eggplants directly over a naked gas flame or under a hot broiler. Turn them occasionally until the skin is completely burnt and the flesh feels soft. This can take up to 15 minutes. Remove from the heat and allow to cool.",
      "Meanwhile, roast the pepper in the same way until charred all over. Place in a bowl, cover with plastic wrap, and leave to steam for 10 minutes. Peel, seed, and cut into thin strips.",
      "Peel the eggplants, making sure you remove all the charred skin. Tear the flesh into long, thin strips and place in a bowl with the pepper strips and red onion.",
      "Add the parsley, pomegranate molasses, olive oil, and lemon juice. Toss gently and season with salt and pepper to taste. Serve at room temperature."
    ],
    tags: {
      dietary: ["vegetarian", "vegan", "gluten-free"],
      season: ["summer", "autumn"]
    },
    image: "/recipes/burnt-eggplant-with-yellow-pepper-and-red-onion.jpg"
  },
  {
    id: "grilled-asparagus-zucchini-and-manouri",
    name: "Grilled asparagus, zucchini, and manouri",
    source: {
      cookbook: "Ottolenghi: The Cookbook",
      author: "Yotam Ottolenghi",
      chapter: "Vegetables – Greens",
      page: 33
    },
    introduction: "This generous salad is almost a meal in itself. It is laden with enough colors, textures, and aromas to be the center of a light spring supper. Its generous creator is Helen Goh, with whom we have had the pleasure of working for the past two years. Since arriving from Australia, Helen has been a continuous source of inspiration and insight for everybody at Ottolenghi, both as a chef and as a sensitive friend.\n\nManouri is a Greek semisoft fresh cheese produced from the drained whey left over after making feta. It is light and creamy and we love using it for its subtlety and the fact that it fries well and keeps its shape. If you can't get hold of it, use a fresh goat cheese but skip the frying, as it will disintegrate. If you like haloumi, it fries and grills very well and will also work here.",
    category: {
      dish_type: ["salad", "vegetable"],
      chapter: "Vegetables"
    },
    servings: "serves 4 to 6",
    time: { prep: 20, cook: 25, total: 45 },
    ingredients: [
      { item: "cherry tomatoes", amount: "350", unit: "g", original: "12 oz / 350 g cherry tomatoes, halved" },
      { item: "olive oil", amount: "140", unit: "ml", original: "9 tbsp / 140 ml olive oil" },
      { item: "asparagus spears", amount: "24", unit: "", original: "24 asparagus spears" },
      { item: "zucchini", amount: "2", unit: "", original: "2 zucchini" },
      { item: "manouri cheese", amount: "200", unit: "g", original: "7 oz / 200 g manouri cheese, sliced ¾ inch / 2 cm thick" },
      { item: "arugula", amount: "25", unit: "g", original: "1¼ cups / 25 g arugula" },
      { item: "salt and pepper", amount: "", unit: "", original: "coarse sea salt and freshly ground black pepper" },
      { item: "olive oil", amount: "75", unit: "ml", original: "5 tbsp / 75 ml olive oil", group: "Basil oil" },
      { item: "garlic", amount: "1", unit: "clove", original: "1 clove garlic, chopped", group: "Basil oil" },
      { item: "basil leaves", amount: "25", unit: "g", original: "1 cup / 25 g basil leaves", group: "Basil oil" },
      { item: "salt", amount: "1", unit: "pinch", original: "pinch of salt", group: "Basil oil" }
    ],
    method: [
      "First make the basil oil. Put all the ingredients in a food processor or blender and process for a few seconds, until you have a rough paste. Set aside.",
      "Preheat the broiler. Place the tomatoes on a baking sheet, drizzle with 2 tablespoons of the olive oil, and season with salt and pepper. Place under the broiler for 15 minutes, or until the tomatoes begin to char and become soft. Remove from the oven and leave to cool.",
      "Meanwhile, trim the bottom off the asparagus spears. Use a vegetable peeler to shave the zucchini lengthwise into thin ribbons, avoiding the seedy center. Place the asparagus and zucchini in a large bowl, add 3 tablespoons of the olive oil, and season with salt and pepper. Toss well.",
      "Heat a ridged grill pan over high heat. Lay the asparagus and zucchini on the pan and grill for 2 to 3 minutes on each side, until charred. Work in batches if necessary. Set aside to cool.",
      "Heat the remaining olive oil in a frying pan over medium-high heat. Add the manouri slices and fry for about 2 minutes on each side, until golden. Remove from the pan.",
      "Arrange the grilled vegetables, tomatoes, cheese, and arugula on serving plates or a large platter. Drizzle with the basil oil and serve."
    ],
    tags: {
      dietary: ["vegetarian"],
      season: ["spring", "summer"]
    },
    image: "/recipes/grilled-asparagus-zucchini-and-manouri.jpg"
  }
];

export function getRecipe(id: string): Recipe | undefined {
  return recipes.find(r => r.id === id);
}

export function getAllRecipes(): Recipe[] {
  return recipes;
}
