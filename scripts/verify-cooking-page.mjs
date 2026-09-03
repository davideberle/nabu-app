#!/usr/bin/env node
// Black-box verification of the rendered /cooking page against the live-cooking
// design contract (DESIGN.md §3 rules 10–11, §7 rendering acceptance criteria).
//
// Run against a LOCAL instance seeded with scripts/seed-cooking-fixture.mjs:
//
//   node scripts/seed-cooking-fixture.mjs --variant farfalle --base http://localhost:3000
//   node scripts/verify-cooking-page.mjs --variant farfalle --base http://localhost:3000
//
// The page is auth-gated; pass the household session cookie via the
// COOKING_PAGE_COOKIE env var (e.g. "authjs.session-token=…") or --cookie.
// `--html-file <path>` verifies a saved document instead of fetching one, so
// the check logic can be exercised without a running instance.
//
// Checks per variant, all on the rendered document (RSC payload stripped):
//   shared       menu → grouped Ingredients → expanded Cook stack, all
//                ingredients before any method, stable dish order, no collapsed
//                active recipe, no timeline/order-of-attack, no chat provenance
//   farfalle     real The Pasta Table anchor linked, integrated substitution
//                ("instead of cherry tomatoes"), override method (never roast
//                the tomatoes), "Adapted tonight" badge
//   synthesized  truthful title, no invented or chat-origin provenance, and a
//                main-only meal legitimately suppressing the menu
//   korean       explicit main leads; its external anchor is the next complete
//                recipe with Judy Joo provenance; set-aside line; drink row
//   cauliflower  grouped Plentiful cauliflower + Love & Lemons chickpea
//                ingredients, then both full methods in explicit chickpeas →
//                main preparation order
//
// The course menu contract (§7): when a meal has more than the single main
// dish, a compact restaurant-style menu precedes all recipe detail; its lanes
// run starter → main → accompaniments → dessert with empty lanes omitted; it
// names dishes only — no ingredients, method, timing or planning shorthand;
// no dish repeats inside it; and the dishes it carries are not restated as a
// generic "also cooking" summary in the recipe context below. The meal then
// gathers ingredients by dish once before an uninterrupted stack of complete,
// expanded methods. A single-dish, main-only meal may omit the menu.

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

const base = arg("base", "http://localhost:3000");
const variant = arg("variant", "farfalle");
const cookie = arg("cookie", process.env.COOKING_PAGE_COOKIE ?? "");
const htmlFile = arg("html-file", "");

let html;
if (htmlFile) {
  html = readFileSync(htmlFile, "utf8");
} else {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) {
    console.error(`Refusing to verify a non-local target: ${base}`);
    process.exit(1);
  }
  const res = await fetch(`${base}/cooking`, {
    headers: cookie ? { cookie } : {},
    redirect: "manual",
  });
  if (res.status !== 200) {
    console.error(
      `GET /cooking returned ${res.status}${res.status === 302 ? " (redirect — missing/invalid session cookie?)" : ""}`,
    );
    process.exit(1);
  }
  html = await res.text();
}

// Visible document text: drop script/style payloads (the RSC flight data
// repeats rendered strings), strip tags, decode the entities we assert on.
function textOf(markup) {
  return markup
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ");
}

const visible = textOf(html);

const failures = [];
function check(label, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures.push(label);
}
function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}
function inOrder(...needles) {
  let last = -1;
  for (const needle of needles) {
    const i = visible.indexOf(needle, last + 1);
    if (i === -1) return false;
    last = i;
  }
  return true;
}
function normalizeDish(text) {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// Document structure: the course menu, the headings, the recipe context
// ---------------------------------------------------------------------------

const MENU_HEADING = /<h2\b[^>]*>\s*Tonight['’]s menu\s*<\/h2>/;
const COURSE_ORDER = ["starter", "main", "accompaniments", "dessert"];

/** The rendered menu, or null when the page presents no menu at all. */
function parseMenu() {
  const heading = MENU_HEADING.exec(html);
  if (!heading) return null;

  const start = heading.index;
  const listEnd = html.indexOf("</dl>", start);
  const end = listEnd === -1 ? start + heading[0].length : listEnd + "</dl>".length;
  const markup = html.slice(start, end);

  const lanes = [
    ...markup.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>[\s\S]*?<dd\b[^>]*>([\s\S]*?)<\/dd>/g),
  ].map((match) => {
    const label = textOf(match[1]).trim();
    return {
      label,
      // "Starters"/"Mains"/"Desserts" are the plural forms of the same lanes.
      kind: COURSE_ORDER.find((k) => normalizeDish(label).replace(/s$/, "") === k.replace(/s$/, "")),
      dishes: textOf(match[2])
        .split("·")
        .map((dish) => dish.trim())
        .filter(Boolean),
    };
  });

  return { start, end, markup, text: textOf(markup), lanes };
}

const menu = parseMenu();

const headings = [...html.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map((match) => ({
  level: Number(match[1]),
  index: match.index,
  text: textOf(match[2]).trim(),
}));

/** The compact context rows inside the main cook card, before its method. */
function recipeContextText() {
  const kicker = visible.indexOf("Tonight’s recipe");
  const method = visible.indexOf("Method", kicker === -1 ? 0 : kicker);
  if (kicker === -1 || method === -1) return "";
  return visible.slice(kicker, method);
}

const ingredientDishes = [...html.matchAll(/data-ingredient-dish="([^"]+)"/g)]
  .map((match) => textOf(match[1]).trim());
const cookDishes = [...html.matchAll(/data-cook-dish="([^"]+)"/g)]
  .map((match) => textOf(match[1]).trim());
const methodHeadings = [...html.matchAll(/<h4\b[^>]*>\s*Method\s*<\/h4>/g)];

function wholeMealChecks({ ingredientGroups, cookOrder }) {
  const ingredientsIndex = visible.indexOf("Ingredients");
  const cookIndex = visible.indexOf("Cook", ingredientsIndex + 1);
  const firstMethod = visible.indexOf("Method", cookIndex + 1);
  const finishIndex = visible.indexOf("Finish session");

  check(
    "hierarchy: menu (when present) → Ingredients → Cook → methods → Finish session",
    ingredientsIndex !== -1 &&
      cookIndex > ingredientsIndex &&
      firstMethod > cookIndex &&
      finishIndex > firstMethod &&
      (!menu || menu.start < html.indexOf(">Ingredients<")),
  );
  check(
    `ingredient groups are stable and dish-grouped [${ingredientGroups.join(" | ")}]`,
    ingredientDishes.join(" | ") === ingredientGroups.join(" | "),
  );
  check(
    "all ingredient groups precede every method",
    [...html.matchAll(/data-ingredient-dish="/g)].every(
      (match) => methodHeadings.length > 0 && match.index < methodHeadings[0].index,
    ),
  );
  check(
    `cook recipes are expanded in stable order [${cookOrder.join(" | ")}]`,
    cookDishes.join(" | ") === cookOrder.join(" | "),
  );
  check(
    "every cook recipe has one complete numbered method sequence",
    methodHeadings.length === cookOrder.length &&
      cookOrder.every((dish) => visible.includes(dish)),
  );
  check("active recipes are never collapsed", !/<details\b/i.test(html));
  check(
    "ingredients appear only in the mise-en-place surface",
    count(visible, "Ingredients") === 1,
  );
  check(
    "the cook stack has no internal navigation dependency",
    !/href=["']#[^"']+/i.test(html),
  );
  const mealBalance = visible.indexOf("Meal balance");
  check(
    "meal balance follows the complete cook stack when present",
    mealBalance === -1 || mealBalance > visible.lastIndexOf("Method"),
  );
}

// Instruction-shaped language: quantities, clock/duration timing, procedural
// connectives and recipe section words. Deliberately not verb-based — real
// dish names carry cooking verbs ("Slow Roasted…", "Steamed…").
const INSTRUCTION_PATTERNS = [
  [/\b\d+([.,/–-]\d+)?\s*(g|kg|mg|ml|cl|l|tbsp|tbs|tsp|oz|lb|lbs|cups?|pinch|cloves?)\b/i, "quantities"],
  [/\b\d+\s*(seconds?|minutes?|mins?|hours?|hrs?)\b/i, "durations"],
  [/\b\d{1,2}[:.]\d{2}\b/, "clock times"],
  [/\b(then|until|meanwhile|whisk together|set the oven)\b/i, "procedural narration"],
  [/\b(ingredients|method|step \d)\b/i, "recipe section words"],
];

function menuChecks(title, { expected }) {
  if (!expected) {
    // A single-dish, main-only meal may suppress the menu entirely (§7).
    check("main-only meal suppresses the course menu", menu === null);
    check(
      "no other dish on the page to justify a menu (no secondary/set-aside blocks)",
      !/also tonight/i.test(visible) && !/set aside tonight/i.test(visible),
    );
    return;
  }

  check("a course menu is rendered", menu !== null);
  if (!menu) return;

  const titleHeading = headings.find((h) => h.text === title);
  check(
    "the menu precedes all recipe detail",
    !!titleHeading &&
      menu.start < titleHeading.index &&
      menu.start < html.indexOf(">Ingredients<"),
  );

  const kinds = menu.lanes.map((lane) => lane.kind);
  check(`every menu lane is a known course (got: ${menu.lanes.map((l) => l.label).join(", ")})`, kinds.every(Boolean));
  check(
    "course lanes run starter → main → accompaniments → dessert",
    kinds.every(Boolean) &&
      kinds.every(
        (kind, i) => i === 0 || COURSE_ORDER.indexOf(kind) > COURSE_ORDER.indexOf(kinds[i - 1]),
      ),
  );
  check("empty course lanes are omitted", menu.lanes.every((lane) => lane.dishes.length > 0));

  const dishes = menu.lanes.flatMap((lane) => lane.dishes);
  check(
    "no dish repeats inside the menu",
    new Set(dishes.map(normalizeDish)).size === dishes.length,
  );
  check("the menu's main lane names the resolved main dish", (menu.lanes.find((l) => l.kind === "main")?.dishes ?? []).includes(title));

  for (const [pattern, what] of INSTRUCTION_PATTERNS) {
    check(`the menu carries no ${what}`, !pattern.test(menu.text));
  }
  check("the menu is dish names only, not steps", !/<(ol|li)\b/i.test(menu.markup));

  const expectedLanes = expected.map((lane) => `${lane.kind}: ${lane.dishes.join(" · ")}`);
  const actualLanes = menu.lanes.map((lane) => `${lane.kind}: ${lane.dishes.join(" · ")}`);
  check(
    `menu courses are exactly [${expectedLanes.join(" | ")}]`,
    actualLanes.join(" | ") === expectedLanes.join(" | "),
  );

  // The menu is the meal's roll call; the recipe context below carries only
  // what the menu cannot (drink, session notes) — never an "also cooking" restatement.
  const context = recipeContextText();
  const restated = dishes.filter((dish) => dish !== title && context.includes(dish));
  check(
    `the recipe context does not restate menu dishes${restated.length ? ` (found: ${restated.join(", ")})` : ""}`,
    restated.length === 0,
  );
  check("no generic 'also cooking' summary alongside the menu", !/also cooking/i.test(visible));
}

function sharedChecks(title, menuExpectation, wholeMealExpectation) {
  check(
    "the main title appears exactly once as a heading",
    headings.filter((h) => h.text === title).length === 1,
  );

  menuChecks(title, menuExpectation);
  wholeMealChecks(wholeMealExpectation);
  check("no second instruction set: 'Meal timeline'", !visible.includes("Meal timeline"));
  check("no second instruction set: 'Order of attack'", !/order of attack/i.test(visible));
  check("no empty default 'Main dish only'", !visible.includes("Main dish only"));
  check("no empty default 'No extra sides'", !visible.includes("No extra sides"));
  check("no chat-origin wording: 'Telegram'", !/telegram/i.test(visible));
  check("no chat-origin wording: 'confirmed by'", !/confirmed by/i.test(visible));
}

if (variant === "farfalle") {
  const title = "Slow Roasted Tomato & Mascarpone Farfalle";
  sharedChecks(title, {
    expected: [
      { kind: "main", dishes: [title] },
      { kind: "accompaniments", dishes: ["Green salad"] },
    ],
  }, {
    ingredientGroups: [title, "Serve with"],
    cookOrder: [title],
  });
  check(
    "real anchor provenance linked to thepastatable.com",
    visible.includes("The Pasta Table") &&
      html.includes("https://www.thepastatable.com/post/slow-roasted-tomato-mascarpone-farfalle"),
  );
  check("substitution integrated: 'instead of cherry tomatoes'", visible.includes("instead of cherry tomatoes"));
  check("peppers are in tonight's recipe", /roasted peppers/i.test(visible));
  check("override method never roasts the tomatoes", !/roast the tomatoes/i.test(visible) && !visible.includes("90 minutes"));
  check("one restrained 'Adapted tonight' badge", count(visible, "Adapted tonight") === 1);
} else if (variant === "synthesized") {
  const title = "Farfalle with Mascarpone, Roasted Peppers and Salmon Steak";
  // Main only, nothing else on the stove: the menu would restate the title
  // standing directly below it, so §7 lets the page suppress it.
  sharedChecks(title, { expected: null }, {
    ingredientGroups: [title],
    cookOrder: [title],
  });
  check(
    "no invented provenance for the synthesized anchor",
    !visible.includes("Tonight's meal as confirmed"),
  );
} else if (variant === "korean") {
  const title = "Gochujang-Glazed Salmon";
  // The title may legitimately recur in prose (meal-balance findings name the
  // dish); the heading contract is pinned by sharedChecks' heading checks.
  sharedChecks(title, {
    expected: [
      { kind: "main", dishes: [title, "Savoury Doenjang-Glazed Aubergine"] },
      {
        kind: "accompaniments",
        dishes: ["Spicy cucumber salad (oi-muchim)", "Steamed Korean short-grain or sushi rice"],
      },
    ],
  }, {
    ingredientGroups: [title, "Savoury Doenjang-Glazed Aubergine", "Serve with"],
    cookOrder: [title, "Savoury Doenjang-Glazed Aubergine"],
  });
  check(
    "set-aside components stay off tonight's menu",
    !(menu?.text ?? "").includes("Kimchi Pancakes"),
  );
  check("current-cook notes render in the context rows", visible.includes("Korean family spread"));
  check("anchor is the second complete cook recipe", cookDishes[1] === "Savoury Doenjang-Glazed Aubergine");
  check("anchor provenance (Judy Joo) renders on the subordinate block", visible.includes("Judy Joo"));
  check("set-aside line for the optional kimchi pancakes", inOrder("Set aside tonight", "Kimchi Pancakes"));
  check("drink guidance renders once in the context rows", inOrder("Drink", "Lenz Trio Weiss"));
} else if (variant === "planned") {
  const title = "Ackee Carbonara";
  sharedChecks(title, {
    expected: [
      { kind: "main", dishes: [title] },
      { kind: "accompaniments", dishes: ["A’ja (Bread Fritters)", "Green salad"] },
    ],
  }, {
    ingredientGroups: [title, "A’ja (Bread Fritters)", "Serve with"],
    cookOrder: [title, "A’ja (Bread Fritters)"],
  });
  check(
    "stored side provenance remains visible",
    visible.includes("Jerusalem") && visible.includes("Yotam Ottolenghi & Sami Tamimi"),
  );
} else if (variant === "cauliflower") {
  const title = "Roasted Cauliflower with Sultanas and Pecan Brown Butter";
  const chickpeas = "Crispy Roasted Chickpeas";
  sharedChecks(title, {
    expected: [
      { kind: "main", dishes: [title] },
      { kind: "accompaniments", dishes: [chickpeas] },
    ],
  }, {
    ingredientGroups: [title, chickpeas],
    cookOrder: [chickpeas, title],
  });
  check(
    "Love & Lemons provenance is visible and linked",
    visible.includes("Love & Lemons") &&
      html.includes("https://www.loveandlemons.com/roasted-chickpeas/"),
  );
  check(
    "all four chickpea ingredients are in the side ingredient group",
    visible.includes("cooked chickpeas, drained and rinsed") &&
      visible.includes("extra-virgin olive oil, for drizzling") &&
      visible.includes("sea salt, generous pinches") &&
      visible.includes("paprika, curry powder, or other spices (optional)"),
  );
  check(
    "the complete six-step chickpea method is expanded inline",
    visible.includes("Remove any loose skins") &&
      visible.includes("if the chickpeas are not crisp enough, keep roasting") &&
      visible.includes("Store roasted chickpeas in a loosely covered container"),
  );
  check(
    "the complete five-step cauliflower method is expanded inline",
    visible.includes("soak the sultanas in the white wine vinegar") &&
      visible.includes("Add the pecans and brown for 4–5 minutes") &&
      visible.includes("Finally scatter the golden raisins around the dish"),
  );
} else {
  console.error(`Unknown variant: ${variant}`);
  process.exit(1);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed for variant ${variant}.`);
  process.exit(1);
}
console.log(`\nAll checks passed for variant ${variant}.`);
