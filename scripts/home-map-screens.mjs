#!/usr/bin/env node
// Step 2 B (2026-11-02): render checks of the isometric home map at 1440×780 with PLACEHOLDER sprites, against an ISOLATED
// local server seeded with scripts/step1-seed.mjs (synthetic: Santiago after Visit 8, Isabel after Visit 2). Loopback only;
// every other origin is blocked; the browser is muted by the audio guard.
//   AUTH_SECRET=… node scripts/home-map-screens.mjs --base http://127.0.0.1:3501 [--off-base http://127.0.0.1:3502] --out <dir>
import fs from "node:fs";
import path from "node:path";
import { encode } from "@auth/core/jwt";
import { chromium } from "/Users/claweberle/.npm-global/lib/node_modules/playwright/index.mjs";
import { audioSafeChromiumLaunchOptions, installBrowserAudioGuard } from "./lib/browser-audio-guard.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const BASE = opt("--base", "http://127.0.0.1:3501");
const OFF = opt("--off-base", null);
const OUT = opt("--out", "/tmp/family-home-map-out");
const VIEWPORT = { width: 1440, height: 780 };
for (const b of [BASE, OFF]) if (b && !/^http:\/\/127\.0\.0\.1:\d+$/.test(b)) throw new Error("loopback only");
const SECRET = process.env.AUTH_SECRET ?? "fable-world-first-synthetic-secret-0123456789abcdef";
fs.mkdirSync(OUT, { recursive: true });
const COOKIE = "authjs.session-token";
const child = await encode({ token: { email: "assistant@davideberle.com", sub: "assistant@davideberle.com", name: "assistant" }, secret: SECRET, salt: COOKIE, maxAge: 3600 });
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail: detail ?? null });
  console.log(ok ? "PASS" : "FAIL", name, detail === undefined ? "" : JSON.stringify(detail).slice(0, 300));
};
const pageErrors = [];
const browser = await chromium.launch(audioSafeChromiumLaunchOptions({ headless: true }));
async function ctx(base, seen) {
  const c = await browser.newContext({ viewport: VIEWPORT, locale: "de-CH", timezoneId: "Europe/Zurich" });
  await installBrowserAudioGuard(c);
  const external = [];
  const requests = [];
  await c.route("**/*", (r) => {
    const u = new URL(r.request().url());
    requests.push(u.pathname);
    if (u.origin !== base) {
      external.push(`${u.origin}${u.pathname}`);
      return r.abort("blockedbyclient");
    }
    return r.continue();
  });
  // Seed the device memory once per tab (a reload must keep what the map itself remembered since).
  if (seen) await c.addInitScript((s) => { if (window.sessionStorage.getItem("seeded")) return; for (const [k, v] of Object.entries(s)) window.localStorage.setItem(k, JSON.stringify(v)); window.sessionStorage.setItem("seeded", "1"); }, seen);
  await c.addCookies([{ name: COOKIE, value: child, url: base }]);
  const page = await c.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  return { c, page, external, requests };
}
let n = 0;
const shot = async (page, name) => {
  n += 1;
  await page.screenshot({ path: path.join(OUT, `${String(n).padStart(2, "0")}-${name}.png`) });
};
const attr = (page, sel, a) => page.locator(sel).first().getAttribute(a);
const noScroll = (page) => page.evaluate(() => ({ h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth, vh: window.innerHeight, vw: window.innerWidth }));
/** Every place label: under its own building, over no other sprite's opaque pixels, no two labels overlapping, today's largest. */
async function labelChecks(page, tag) {
  const labels = await page.evaluate(() => {
    const probe = window.__homeMapProbe;
    const canvas = document.querySelector("[data-testid='home-map-canvas']").getBoundingClientRect();
    return [...document.querySelectorAll("[data-testid^='home-place-']")].map((el) => {
      const b = el.getBoundingClientRect();
      const id = el.getAttribute("data-testid").replace("home-place-", "");
      const r = { x: b.left - canvas.left, y: b.top - canvas.top, w: b.width, h: b.height };
      return { id, state: el.getAttribute("data-state"), ...r, fs: parseFloat(getComputedStyle(el).fontSize), visible: getComputedStyle(el).visibility === "visible", owners: probe.ownersUnder(r), anchor: probe.labelAnchor(id) };
    });
  });
  const over = labels.flatMap((l) => l.owners.filter((o) => o !== l.id).map((o) => `${l.id}→${o}`));
  check(`${tag}.labels-over-no-other-sprite`, labels.length > 0 && over.length === 0, over);
  const clashes = [];
  for (const a of labels) for (const b of labels) if (a.id < b.id && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) clashes.push(`${a.id}×${b.id}`);
  check(`${tag}.labels-do-not-overlap`, clashes.length === 0, clashes);
  // The label's top centre lies inside its own building's footprint diamond or at most 48 px below its front edges
  // (for a place without a building: within 48 px of the place tile).
  const lerpY = (p, q, x) => p.y + ((q.y - p.y) * (x - p.x)) / (q.x - p.x || 1);
  const far = labels.filter((l) => {
    const cx = l.x + l.w / 2;
    const f = l.anchor.footprint;
    if (!f) return Math.hypot(cx - l.anchor.x, l.y - l.anchor.y) > 48;
    if (cx < f.west.x || cx > f.east.x) return true;
    const low = cx <= f.south.x ? lerpY(f.west, f.south, cx) : lerpY(f.south, f.east, cx);
    const up = cx <= f.north.x ? lerpY(f.west, f.north, cx) : lerpY(f.north, f.east, cx);
    return l.y < up - 4 || l.y > low + 48;
  }).map((l) => ({ id: l.id, x: Math.round(l.x + l.w / 2), y: Math.round(l.y) }));
  check(`${tag}.labels-under-own-building`, far.length === 0, far);
  const today = labels.filter((l) => l.state === "current");
  const quiet = labels.filter((l) => l.state !== "current");
  check(`${tag}.today-label-most-visible`, today.length > 0 && today.every((t) => quiet.every((q) => t.fs > q.fs)) && labels.every((l) => l.visible), { today: today.map((t) => [t.id, t.fs]), quiet: quiet.map((q) => [q.id, q.fs]) });
  check(`${tag}.game-reports-no-label-overlap`, (await attr(page, "[data-testid='home-map']", "data-label-overlaps")) === "");
}
async function mapReady(page) {
  await page.waitForSelector("[data-testid='home-map'][data-ready='true']", { timeout: 45000 });
  await page.waitForTimeout(300);
}

// ---------------------------------------------------------------- Santiago: arrival, walk, place → scene → back
try {
  const { c, page, external, requests } = await ctx(BASE, null);
  // Hold the island back for a moment on this first open: the child must see the loading card (avatar + line), not a blank sea.
  await page.route("**/family/home-map/santiago-island*", async (r) => {
    requests.push(new URL(r.request().url()).pathname); // a page route takes the request over from the context recorder
    await new Promise((res) => setTimeout(res, 1200));
    await r.continue();
  });
  const t0 = Date.now();
  await page.goto(`${BASE}/family/learn?child=santiago`);
  await page.waitForSelector("[data-testid='home-map-loading-card']", { timeout: 20000 });
  const card = await page.evaluate(() => ({ text: document.querySelector("[data-testid='home-map-loading-text']")?.textContent ?? "", avatar: getComputedStyle(document.querySelector("[data-testid='home-map-loading-avatar']")).backgroundImage }));
  check("S.loading-card-avatar-and-line", card.text === "Deine Insel lädt …" && /santiago-avatar\.png/.test(card.avatar), card);
  await shot(page, "santiago-loading");
  await mapReady(page);
  check("S.loading-card-gone-when-ready", (await page.locator("[data-testid='home-map'] [data-testid='home-map-loading-card']").count()) === 0);
  check("S.1x-ground-at-1440", requests.includes("/family/home-map/santiago-island@1x.webp") && requests.includes("/family/home-map/water@1x.webp") && !requests.includes("/family/home-map/santiago-island.webp") && !requests.includes("/family/home-map/water.webp"), requests.filter((p) => /island|water/.test(p)));
  const loadMs = Date.now() - t0;
  check("S.map-load-ms", loadMs < 8000, { loadMs });
  check("S.flag-on-start-screen-is-the-map", (await page.locator("[data-testid='world-screen'][data-home-map='true']").count()) === 1);
  const pieces = (await attr(page, "[data-testid='home-map']", "data-pieces")).split(" ");
  check("S.every-piece-drawn", (await attr(page, "[data-testid='home-map']", "data-missing")) === "", await attr(page, "[data-testid='home-map']", "data-missing"));
  check("S.world-from-records", ["s-dock:built", "s-shop:built", "s-office:built", "s-workshop:built", "s-garden-beds:built", "s-greenhouse:built", "s-greenhouse-wing:built", "s-water-tank:site", "s-pipe:site"].every((p) => pieces.includes(p)), pieces);
  check("S.first-open-arrival-plays-latest-visit", (await attr(page, "[data-testid='home-map']", "data-arrival")) === "playing" && (await attr(page, "[data-testid='home-map']", "data-arrivals")) === "s-greenhouse-wing");
  await page.waitForTimeout(700);
  await shot(page, "santiago-arrival-playing");
  await page.keyboard.press("Space");
  await page.waitForTimeout(200);
  check("S.arrival-skippable", (await attr(page, "[data-testid='home-map']", "data-arrival")) === "done");
  const seen = await page.evaluate(() => window.localStorage.getItem("family-home-map:seen:santiago"));
  check("S.seen-remembered-on-device", !!seen && seen.includes("s-greenhouse-wing"), seen);
  const sz = await noScroll(page);
  const tallest = await page.evaluate(() => [...document.querySelectorAll("body *")].map((e) => ({ t: e.tagName + "." + String(e.className).slice(0, 40) + "#" + (e.getAttribute("data-testid") ?? ""), b: Math.round(e.getBoundingClientRect().bottom) })).filter((x) => x.b > window.innerHeight).slice(0, 6));
  check("S.fits-1440x780-no-scroll", sz.h <= sz.vh && sz.w <= sz.vw, { ...sz, tallest });
  check("S.current-place-highlighted", (await page.locator("[data-testid='home-place-office'][data-state='current']").count()) === 1);
  check("S.earlier-places-quiet", (await page.locator("[data-testid='home-place-greenhouse'][data-state='quiet']").count()) === 1);
  check("S.minimal-chrome", (await page.locator("[data-testid='hud-stop']").count()) === 1 && (await page.locator("[data-testid='hud-wordbook'], [data-testid='hud-progress']").count()) === 0);
  await labelChecks(page, "S.start");
  await shot(page, "santiago-map");
  // keys walk along the paths
  await page.locator("[data-testid='home-map']").focus();
  const before = await attr(page, "[data-testid='home-map']", "data-avatar");
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(500);
  const after = await attr(page, "[data-testid='home-map']", "data-avatar");
  check("S.arrow-keys-walk", before !== after, { before, after });
  // tap a place → walks there → the visit starts and the place's scene opens
  await page.locator("[data-testid='home-place-office']").click();
  await page.waitForFunction(() => document.querySelector("[data-testid='home-map']")?.getAttribute("data-walking") === "true", null, { timeout: 5000 }).catch(() => null);
  await page.waitForTimeout(250);
  await shot(page, "santiago-walking");
  await page.waitForURL(/\/family\/learn\/mission/, { timeout: 15000 });
  await page.waitForSelector("[data-testid='story-done'], [data-testid='scene-continue']", { timeout: 30000 });
  check("S.tap-place-starts-scene", (await attr(page, "[data-testid='mission-world']", "data-active")) === "P1-START", await attr(page, "[data-testid='mission-world']", "data-active"));
  check("S.nokt-closed-by-default", (await page.locator("[data-testid='nokt-modal'], [data-testid='nokt-panel']").count()) === 0);
  await shot(page, "santiago-scene-P1");
  await page.locator("[data-testid='story-done']").click();
  await page.waitForSelector("[data-testid='scene-continue']", { timeout: 15000 });
  await page.locator("[data-testid='scene-continue']").click();
  await mapReady(page);
  check("S.back-returns-to-map-at-place", (await attr(page, "[data-testid='home-map']", "data-avatar")) === "10,5" && (await attr(page, "[data-testid='mission-world']", "data-position")) === "office");
  check("S.map-header-only-pause", (await page.locator("[data-testid='hud-stop']").count()) === 1 && (await page.locator("[data-testid='hud-steps'], [data-testid='hud-wordbook']").count()) === 0);
  check("S.next-stations-highlighted", (await page.locator("[data-testid='home-place-shop'][data-state='current']").count()) === 1 && (await page.locator("[data-testid='home-place-office'][data-state='current']").count()) === 1);
  const sz2 = await noScroll(page);
  const below = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().bottom > window.innerHeight && e.getBoundingClientRect().height > 0).map((e) => `${e.tagName}#${e.getAttribute("data-testid") ?? ""}.${String(e.className).slice(0, 50)}:${Math.round(e.getBoundingClientRect().top)}-${Math.round(e.getBoundingClientRect().bottom)}`).slice(-8));
  check("S.mission-map-fits-no-scroll", sz2.h <= sz2.vh, { ...sz2, below });
  await labelChecks(page, "S.mission");
  await shot(page, "santiago-map-after-scene");
  // Nokt on the map: closed until tapped, then the step-1 dock; closes again
  if ((await page.locator("[data-testid='nokt-button']").count()) === 1) {
    await page.locator("[data-testid='nokt-button']").click();
    await page.waitForTimeout(400);
    const open = await page.locator("[data-testid='nokt-modal'], [data-testid='nokt-panel'], [data-testid='nokt-dock']").count();
    check("S.nokt-opens-on-tap", open >= 1, { open });
    await shot(page, "santiago-nokt-open");
    const close = page.locator("[data-testid='nokt-close'], [data-testid='nokt-dock-close'], [aria-label='Nokt schliessen'], [aria-label='Schliessen']").first();
    if (await close.count()) await close.click();
    else await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    check("S.nokt-closes-again", (await page.locator("[data-testid='nokt-modal'], [data-testid='nokt-panel']").count()) === 0);
  } else check("S.nokt-button-on-map", false, "no nokt-button");
  // walk to the shop and into its scene, then back
  await page.locator("[data-testid='home-place-shop']").click();
  await page.waitForFunction(() => (document.querySelector("[data-testid='mission-world']")?.getAttribute("data-active") ?? "") !== "", null, { timeout: 20000 });
  check("S.second-place-opens-its-scene", (await attr(page, "[data-testid='mission-world']", "data-active")) === "P4-REGADERA", await attr(page, "[data-testid='mission-world']", "data-active"));
  await shot(page, "santiago-scene-P4");
  await page.locator("[data-testid='scene-back']").click();
  await mapReady(page);
  check("S.back-from-focused-scene-to-map-at-shop", (await attr(page, "[data-testid='mission-world']", "data-position")) === "shop" && (await attr(page, "[data-testid='home-map']", "data-avatar")) === "6,7");
  // Pause → the start screen (the map again)
  await page.locator("[data-testid='hud-stop']").click();
  await page.waitForURL(/\/family\/learn\?child=santiago$/, { timeout: 15000 });
  await mapReady(page);
  check("S.pause-returns-to-home-map", (await page.locator("[data-testid='world-screen'][data-home-map='true']").count()) === 1);
  check("S.home-map-assets-only-own-world", requests.filter((p) => p.startsWith("/family/home-map/")).every((p) => !/\/i-|isabel/.test(p)), requests.filter((p) => p.startsWith("/family/home-map/")));
  check("S.no-external-requests", external.length === 0, external);
  await c.close();
} catch (e) {
  check("S.flow-completed", false, String(e).slice(0, 300));
}

// ---------------------------------------------------------------- Build animation on a later open (a piece built since last time)
try {
  const { c, page } = await ctx(BASE, { "family-home-map:seen:santiago": ["s-dock", "s-shop", "s-office", "s-workshop", "s-garden-beds", "s-greenhouse"] });
  await page.goto(`${BASE}/family/learn?child=santiago`);
  await mapReady(page);
  check("B.new-piece-arrives", (await attr(page, "[data-testid='home-map']", "data-arrival")) === "playing" && (await attr(page, "[data-testid='home-map']", "data-arrivals")) === "s-greenhouse-wing");
  const t = Date.now();
  await page.waitForFunction(() => document.querySelector("[data-testid='home-map']")?.getAttribute("data-arrival") === "done", null, { timeout: 6000 });
  const ms = Date.now() - t;
  check("B.animation-about-2s", ms > 1000 && ms < 3500, { ms });
  await page.reload();
  await mapReady(page);
  check("B.plays-only-once", (await attr(page, "[data-testid='home-map']", "data-arrivals")) === "" && (await attr(page, "[data-testid='home-map']", "data-arrival")) !== "playing");
  await c.close();
} catch (e) {
  check("B.flow-completed", false, String(e).slice(0, 300));
}

// ---------------------------------------------------------------- Isabel: her own world, garden → workshop scene, Pause → map
try {
  const { c, page, requests } = await ctx(BASE, null);
  await page.route("**/family/home-map/isabel-island*", async (r) => {
    requests.push(new URL(r.request().url()).pathname); // a page route takes the request over from the context recorder
    await new Promise((res) => setTimeout(res, 1200));
    await r.continue();
  });
  await page.goto(`${BASE}/family/learn?child=isabel`);
  await page.waitForSelector("[data-testid='home-map-loading-card']", { timeout: 20000 });
  const icard = await page.evaluate(() => ({ text: document.querySelector("[data-testid='home-map-loading-text']")?.textContent ?? "", avatar: getComputedStyle(document.querySelector("[data-testid='home-map-loading-avatar']")).backgroundImage }));
  check("I.loading-card-avatar-and-line", icard.text === "Dein Garten lädt …" && /isabel-avatar\.png/.test(icard.avatar), icard);
  await shot(page, "isabel-loading");
  await mapReady(page);
  check("I.1x-ground-at-1440", requests.includes("/family/home-map/isabel-island@1x.webp") && !requests.includes("/family/home-map/isabel-island.webp"), requests.filter((p) => /island|water/.test(p)));
  await page.keyboard.press("Space");
  await page.waitForTimeout(200);
  const pieces = (await attr(page, "[data-testid='home-map']", "data-pieces")).split(" ");
  check("I.world-from-records", ["i-garden-house:built", "i-stick-fence:built", "i-flower-garden:built", "i-vegetable-patch:site", "i-harvest-table:site"].every((p) => pieces.includes(p)) && pieces.every((p) => p.startsWith("i-")), pieces);
  check("I.every-piece-drawn", (await attr(page, "[data-testid='home-map']", "data-missing")) === "", await attr(page, "[data-testid='home-map']", "data-missing"));
  check("I.garden-is-today", (await page.locator("[data-testid='home-place-garden'][data-state='current']").count()) === 1);
  const sz = await noScroll(page);
  check("I.fits-1440x780-no-scroll", sz.h <= sz.vh && sz.w <= sz.vw, sz);
  await labelChecks(page, "I.start");
  await shot(page, "isabel-map");
  await page.locator("[data-testid='home-place-garden']").click();
  await page.waitForURL(/\/family\/learn\/mission/, { timeout: 15000 });
  await page.waitForSelector("[data-testid='mission-stage'][data-presentation='workshop']", { timeout: 30000 });
  check("I.tap-garden-starts-her-scene", true);
  await shot(page, "isabel-scene");
  await page.locator("[data-testid='hud-stop']").click();
  await page.waitForURL(/\/family\/learn\?child=isabel$/, { timeout: 15000 });
  await mapReady(page);
  check("I.pause-returns-to-her-map", (await attr(page, "[data-testid='home-map']", "data-child")) === "isabel");
  check("I.only-her-assets", requests.filter((p) => p.startsWith("/family/home-map/")).every((p) => !/\/s-|santiago/.test(p)), requests.filter((p) => p.startsWith("/family/home-map/")));
  await c.close();
} catch (e) {
  check("I.flow-completed", false, String(e).slice(0, 300));
}

// ---------------------------------------------------------------- Flag off: the released screens, no map code fetched
if (OFF) {
  for (const who of ["santiago", "isabel"]) {
    const { c, page, requests } = await ctx(OFF, null);
    await page.goto(`${OFF}/family/learn?child=${who}`);
    await page.waitForTimeout(2500);
    check(`OFF.${who}-released-start-screen`, (await page.locator("[data-testid='home-map'], [data-home-map='true']").count()) === 0);
    check(`OFF.${who}-no-map-assets`, requests.filter((p) => p.startsWith("/family/home-map/")).length === 0);
    const js = requests.filter((p) => p.endsWith(".js"));
    const phaser = [];
    for (const p of js) {
      const body = await page.evaluate(async (u) => (await fetch(u)).text(), p);
      if (/Phaser\.Scene|PHASER/.test(body)) phaser.push(p);
    }
    check(`OFF.${who}-no-phaser-loaded`, phaser.length === 0, phaser);
    await shot(page, `off-${who}`);
    await c.close();
  }
}

check("no-page-errors", pageErrors.length === 0, pageErrors);
await browser.close();
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ base: BASE, off: OFF, viewport: VIEWPORT, at: new Date().toISOString(), results }, null, 1));
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ pass: results.length - failed.length, fail: failed.length }));
process.exit(failed.length ? 1 : 0);
