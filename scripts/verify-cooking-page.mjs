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
//   shared       meal image/identity → grouped Ingredients → one Method surface
//                grouped by dish → drink/notes near the end; no duplicate menu,
//                collapsed active recipe, timeline/order-of-attack, or chat provenance
//   farfalle     real The Pasta Table anchor linked, integrated substitution
//                ("instead of cherry tomatoes"), override method (never roast
//                the tomatoes), "Adapted tonight" badge
//   synthesized  truthful title and no invented or chat-origin provenance
//   korean       explicit main leads; its external anchor is the next complete
//                method group with Judy Joo provenance; set-aside line; drink row
//   cauliflower  grouped Plentiful cauliflower + Love & Lemons chickpea
//                ingredients, then both full methods in explicit chickpeas →
//                main preparation order
//
// The meal-first contract (§7): the page opens with the image and recipe
// identity, then gathers every ingredient once before a single complete Method
// surface. That surface is subdivided by dish, with every active method expanded.
// Drink guidance and tonight's notes sit near the end rather than interrupting
// the cooking flow.

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
const headings = [...html.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map((match) => ({
  level: Number(match[1]),
  index: match.index,
  text: textOf(match[2]).trim(),
}));

const ingredientDishes = [...html.matchAll(/data-ingredient-dish="([^"]+)"/g)]
  .map((match) => textOf(match[1]).trim());
const cookDishes = [...html.matchAll(/data-cook-dish="([^"]+)"/g)]
  .map((match) => textOf(match[1]).trim());

function wholeMealChecks({ ingredientGroups, cookOrder }) {
  const identityIndex = visible.indexOf("Tonight’s recipe");
  const ingredientsIndex = visible.indexOf("Ingredients");
  const methodIndex = visible.indexOf("Method", ingredientsIndex + 1);
  const finishIndex = visible.indexOf("Finish session");

  check(
    "hierarchy: meal identity → Ingredients → Method → Finish session",
    identityIndex !== -1 &&
    ingredientsIndex !== -1 &&
      ingredientsIndex > identityIndex &&
      methodIndex > ingredientsIndex &&
      finishIndex > methodIndex,
  );
  check("page is introduced as Today’s meal / Live Cooking", inOrder("Live Cooking", "Today’s meal"));
  check(
    `ingredient groups are stable and dish-grouped [${ingredientGroups.join(" | ")}]`,
    ingredientDishes.join(" | ") === ingredientGroups.join(" | "),
  );
  check(
    "all ingredient groups precede every method",
    [...html.matchAll(/data-ingredient-dish="/g)].every((match) => match.index < html.indexOf("data-cook-dish=")),
  );
  check(
    `method groups are expanded in stable order [${cookOrder.join(" | ")}]`,
    cookDishes.join(" | ") === cookOrder.join(" | "),
  );
  check(
    "every method group is visible inside one Method surface",
    count(visible, "Method") === 1 && cookOrder.every((dish) => visible.includes(dish)),
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
    "meal balance follows the complete Method surface when present",
    mealBalance === -1 || mealBalance > methodIndex,
  );
  const drinkIndex = visible.indexOf("Drink", methodIndex + 1);
  const notesIndex = visible.indexOf("Tonight’s notes", methodIndex + 1);
  check(
    "drink and notes stay near the end, in that order when both exist",
    (drinkIndex === -1 || drinkIndex > methodIndex) &&
      (notesIndex === -1 || notesIndex > methodIndex) &&
      (drinkIndex === -1 || notesIndex === -1 || drinkIndex < notesIndex) &&
      (drinkIndex === -1 || drinkIndex < finishIndex) &&
      (notesIndex === -1 || notesIndex < finishIndex),
  );
}

function sharedChecks(title, wholeMealExpectation) {
  check(
    "the main title appears exactly once as a heading",
    headings.filter((h) => h.text === title).length === 1,
  );

  wholeMealChecks(wholeMealExpectation);
  check("the duplicate course menu is gone", !/Tonight['’]s menu/.test(visible));
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
  // Main only, nothing else on the stove.
  sharedChecks(title, {
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
    ingredientGroups: [title, "Savoury Doenjang-Glazed Aubergine", "Serve with"],
    cookOrder: [title, "Savoury Doenjang-Glazed Aubergine"],
  });
  check(
    "set-aside components stay out of ingredients and methods",
    !cookDishes.includes("Kimchi Pancakes") && !ingredientDishes.includes("Kimchi Pancakes"),
  );
  check("current-cook notes render near the end", inOrder("Method", "Korean family spread", "Finish session"));
  check("anchor is the second complete method group", cookDishes[1] === "Savoury Doenjang-Glazed Aubergine");
  check("anchor provenance (Judy Joo) renders on its method group", visible.includes("Judy Joo"));
  check("set-aside line for the optional kimchi pancakes", inOrder("Set aside tonight", "Kimchi Pancakes"));
  check("drink guidance renders once near the end", inOrder("Method", "Drink", "Lenz Trio Weiss", "Finish session"));
} else if (variant === "planned") {
  const title = "Ackee Carbonara";
  sharedChecks(title, {
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
