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
//
// Checks per variant, all on the rendered document (RSC payload stripped):
//   shared       one <h2> recipe title, title → Ingredients → Method → Finish
//                hierarchy, no timeline/order-of-attack, no empty overview
//                defaults, no chat-origin provenance wording
//   farfalle     real The Pasta Table anchor linked, integrated substitution
//                ("instead of cherry tomatoes"), override method (never roast
//                the tomatoes), "Adapted tonight" badge
//   synthesized  truthful title, no invented or chat-origin provenance
//   korean       explicit main leads; anchor + Judy Joo provenance subordinate
//                after the method; set-aside line; drink row

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

const base = arg("base", "http://localhost:3000");
const variant = arg("variant", "farfalle");
const cookie = arg("cookie", process.env.COOKING_PAGE_COOKIE ?? "");

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
const html = await res.text();

// Visible document text: drop script/style payloads (the RSC flight data
// repeats rendered strings), strip tags, decode the entities we assert on.
const visible = html
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"')
  .replace(/&#x27;|&#39;/g, "'")
  .replace(/\s+/g, " ");

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

function sharedChecks(title) {
  const h2s = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g)];
  check("exactly one <h2> heading (the recipe title, rendered once)", h2s.length === 1);
  const heading = (h2s[0]?.[1] ?? "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
  check(`the single heading is the recipe title: ${title}`, heading === title);
  check(
    "hierarchy: title → Ingredients → Method → Finish session",
    inOrder(title, "Ingredients", "Method", "Finish session"),
  );
  check("no second instruction set: 'Meal timeline'", !visible.includes("Meal timeline"));
  check("no second instruction set: 'Order of attack'", !/order of attack/i.test(visible));
  check("no empty default 'Main dish only'", !visible.includes("Main dish only"));
  check("no empty default 'No extra sides'", !visible.includes("No extra sides"));
  check("no chat-origin wording: 'Telegram'", !/telegram/i.test(visible));
  check("no chat-origin wording: 'confirmed by'", !/confirmed by/i.test(visible));
}

if (variant === "farfalle") {
  const title = "Slow Roasted Tomato & Mascarpone Farfalle";
  sharedChecks(title);
  check("title appears exactly once in the document", count(visible, title) === 1);
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
  sharedChecks(title);
  check("title appears exactly once in the document", count(visible, title) === 1);
  check(
    "no invented provenance for the synthesized anchor",
    !visible.includes("Tonight's meal as confirmed"),
  );
} else if (variant === "korean") {
  const title = "Gochujang-Glazed Salmon";
  // The title may legitimately recur in prose (meal-balance findings name the
  // dish); the heading contract is pinned by sharedChecks' single-<h2> check.
  sharedChecks(title);
  check("current-cook notes render in the context rows", visible.includes("Korean family spread"));
  check(
    "anchor is subordinate: method before 'Also tonight' aubergine block",
    inOrder("Method", "Also tonight", "Savoury Doenjang-Glazed Aubergine"),
  );
  check("anchor provenance (Judy Joo) renders on the subordinate block", visible.includes("Judy Joo"));
  check("set-aside line for the optional kimchi pancakes", inOrder("Set aside tonight", "Kimchi Pancakes"));
  check("drink guidance renders once in the context rows", inOrder("Drink", "Lenz Trio Weiss"));
} else {
  console.error(`Unknown variant: ${variant}`);
  process.exit(1);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed for variant ${variant}.`);
  process.exit(1);
}
console.log(`\nAll checks passed for variant ${variant}.`);
