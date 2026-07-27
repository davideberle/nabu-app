#!/usr/bin/env node
// Seed a deterministic Cooking Session fixture into a LOCAL app instance for
// visual verification of /cooking. Posts through the app's own session API so
// the row always matches the current schema/migrations.
//
// Usage:
//   NABU_DB_DIR=/tmp/nabu-cooking-fixture npm run start   (or npm run dev)
//   node scripts/seed-cooking-fixture.mjs --variant korean [--base http://localhost:3000] [--date YYYY-MM-DD]
//
// Variants:
//   korean        2026-07-26 Korean dinner as repaired truth: explicit salmon
//                 main (external, no stored recipe → placeholder hero),
//                 aubergine anchor as secondary, kimchi pancakes optional.
//   korean-hero   Same, plus a session hero image (layout check only).
//   planned       Meal-plan-style session: stored recipe main with image,
//                 one side recipe, partial session adjustments.

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

const base = arg("base", "http://localhost:3000");
const variant = arg("variant", "korean");
const date = arg("date", localToday());

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) {
  console.error(`Refusing to seed a non-local target: ${base}`);
  process.exit(1);
}

function localToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts;
}

const now = new Date().toISOString();

function koreanSession({ withHeroImage = false } = {}) {
  return {
    id: `cook_${date}_korean_family`,
    date,
    status: "draft",
    source: "telegram",
    mealPlanRef: null,
    anchor: {
      type: "external-recipe",
      title: "Savoury Doenjang-Glazed Aubergine",
      provenance: {
        source: "Judy Joo — Doenjang-glazed grilled Asian aubergine",
        url: "https://www.judyjoo.com/recipes/doenjang-glazed-grilled-asian-aubergine-doenjang-gaji-gui-31/",
        author: "Judy Joo",
      },
    },
    main: {
      title: "Gochujang-Glazed Salmon",
      summary: "700 g — adult gochujang glaze, mild soy-sesame for the kids",
      setBy: "telegram",
    },
    heroImage: withHeroImage
      ? { url: "/recipes/salade-nicoise.jpg", alt: "Layout check only", source: "Fixture stand-in image" }
      : null,
    relatedRecipes: [
      { kind: "side", recipeId: "kimchi-pancakes", title: "Kimchi Pancakes", status: "optional" },
    ],
    serveWith: [
      "Gochujang-glazed salmon (700 g; mild soy-sesame glaze for the kids)",
      "Spicy cucumber salad (oi-muchim)",
      "Steamed Korean short-grain or sushi rice",
      "Kimchi pancakes — optional",
    ],
    servings: { base: "4", current: "4" },
    ingredients: {
      base: [
        { amount: "3–4", item: "Asian aubergines, or 2 large aubergines" },
        { amount: "80", unit: "g", item: "doenjang" },
        { amount: "20–25", unit: "g", item: "honey — reduced from Judy Joo’s recipe for a savourier glaze" },
        { amount: "3", item: "garlic cloves, grated" },
        { amount: "2", item: "spring onions, thinly sliced" },
        { amount: "1", unit: "tbsp", item: "soy sauce" },
        { amount: "1", unit: "tbsp", item: "toasted sesame oil" },
        { amount: "", item: "sesame seeds and gochugaru, to finish" },
      ],
      session: [
        { amount: "700", unit: "g", item: "salmon fillets" },
        { amount: "1.5", unit: "tbsp", item: "gochujang — adults only" },
        { amount: "2", unit: "tbsp", item: "soy sauce — divided" },
        { amount: "2", unit: "tsp", item: "honey or maple syrup — divided" },
        { amount: "2", unit: "tsp", item: "toasted sesame oil — divided" },
        { amount: "1", item: "garlic clove, grated" },
        { amount: "1", unit: "tsp", item: "rice vinegar" },
      ],
    },
    method: {
      base: [
        "Score the aubergine flesh, brush with oil and season lightly.",
        "Grill skin-side up for 3–5 minutes, turn and grill until tender and golden.",
        "Whisk the doenjang, reduced honey, garlic, spring onion, soy and sesame oil; spread over the flesh and grill until bubbling and lightly charred.",
      ],
      session: [
        "Start the rice, then prepare the aubergine and cucumber salad.",
        "Split the salmon: coat the adult portion with gochujang, soy, honey, sesame oil, garlic and rice vinegar; coat the kids’ portion with soy, honey and sesame oil only.",
        "Roast the salmon at 200°C for about 10–13 minutes, then grill/broil briefly for colour; dress the cucumber at the last moment.",
        "Skip the dubu-jorim tonight and keep the kimchi pancake optional; use the tofu for a lighter meal tomorrow.",
      ],
    },
    adaptations: [
      {
        id: "adapt_fixture_salmon",
        kind: "ingredient-substitution",
        summary: "Added 700 g salmon as tonight’s protein; split into adult gochujang and mild kids’ glaze.",
        messageSource: "telegram",
        createdAt: now,
      },
    ],
    coachCards: {
      nextMove: "Start the rice; split and glaze the salmon while the aubergine cooks.",
      upgrade: "Keep the cucumber very cold and sharply dressed to cut the salmon, doenjang and sesame richness.",
      shortcut: "Skip the tofu tonight; the kimchi pancake is optional rather than mandatory.",
      wine: "Lenz Trio Weiss is the first choice for the gochujang salmon; serve at 8–10°C. Savian Bavio is the backup.",
    },
    story: null,
    notes: "Korean family spread. Gochujang is available. Tonight: add 700 g salmon, adults with gochujang glaze and children with mild soy-sesame glaze.",
    createdAt: now,
    updatedAt: now,
  };
}

function plannedSession() {
  return {
    id: `cook_${date}_ackee-carbonara`,
    date,
    status: "active",
    source: "telegram", // keep resync from touching the fixture during checks
    mealPlanRef: null,
    anchor: {
      type: "kitchen-recipe",
      recipeId: "ackee-carbonara",
      title: "Ackee Carbonara",
      provenance: { source: "Fixture cookbook", author: "Fixture" },
    },
    main: null,
    heroImage: null,
    relatedRecipes: [
      { kind: "side", recipeId: "a-ja-bread-fritters", title: "A’ja (Bread Fritters)" },
    ],
    serveWith: ["Green salad"],
    servings: { base: "4", current: "4" },
    ingredients: {
      base: [
        { amount: "400", unit: "g", item: "spaghetti" },
        { amount: "1", unit: "tin", item: "ackee, drained" },
        { amount: "2", item: "garlic cloves" },
        { amount: "100", unit: "ml", item: "plant cream" },
        { amount: "", item: "smoked tofu lardons" },
      ],
      session: [{ amount: "1", unit: "tsp", item: "smoked paprika instead of lardons" }],
    },
    method: {
      base: [
        "Cook the spaghetti until just short of al dente.",
        "Blend the ackee with cream and garlic into a silky sauce.",
        "Toss pasta, sauce and lardons over low heat; season and serve.",
      ],
      session: ["Use smoked paprika in the sauce instead of frying lardons."],
    },
    adaptations: [],
    coachCards: { nextMove: null, upgrade: null, shortcut: null, wine: null },
    story: null,
    notes: "",
    createdAt: now,
    updatedAt: now,
  };
}

const session =
  variant === "planned"
    ? plannedSession()
    : koreanSession({ withHeroImage: variant === "korean-hero" });

const res = await fetch(`${base}/api/cooking/session`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(session),
});
if (!res.ok) {
  console.error(`Seed failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
console.log(`Seeded ${variant} fixture for ${date} at ${base} (session ${session.id})`);
