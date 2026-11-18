#!/usr/bin/env node
// Nov 18 (coin redemption simplification): screenshots of the child's coin screens (Coins = /family/rewards, Games) at
// 1440×780 and 390×844 for a child with enough coins (Santiago) and one with too few for Game Studio (Isabel), against an
// ISOLATED local server seeded with scripts/seed-family-fixture.mjs. Loopback only; every other origin is blocked; muted.
// Opening a confirmation is shown, but nothing is ever bought.
//   AUTH_SECRET=… node scripts/coins-screens.mjs --base http://127.0.0.1:3731 --out <dir> --prefix before|after
import fs from "node:fs";
import path from "node:path";
import { encode } from "@auth/core/jwt";
import { chromium } from "/Users/claweberle/.npm-global/lib/node_modules/playwright/index.mjs";
import { audioSafeChromiumLaunchOptions, installBrowserAudioGuard } from "./lib/browser-audio-guard.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const BASE = opt("--base", "http://127.0.0.1:3731");
const OUT = opt("--out", "/tmp/nov18/shots/coins");
const PREFIX = opt("--prefix", "after");
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE)) throw new Error("loopback only");
const SECRET = process.env.AUTH_SECRET;
if (!SECRET) throw new Error("AUTH_SECRET required");
fs.mkdirSync(OUT, { recursive: true });
const COOKIE = "authjs.session-token";
const token = await encode({ token: { email: "assistant@davideberle.com", sub: "assistant@davideberle.com", name: "assistant" }, secret: SECRET, salt: COOKIE, maxAge: 3600 });
const browser = await chromium.launch(audioSafeChromiumLaunchOptions({ headless: true, ...(process.env.COINS_CHROMIUM ? { executablePath: process.env.COINS_CHROMIUM } : {}) }));
const errors = [];
const purchases = [];
for (const [vw, vh] of [[1440, 780], [390, 844]]) {
  for (const child of ["santiago", "isabel"]) {
    const c = await browser.newContext({ viewport: { width: vw, height: vh }, locale: "de-CH", timezoneId: "Europe/Zurich", hasTouch: vw < 500, isMobile: vw < 500 });
    await installBrowserAudioGuard(c);
    await c.route("**/*", (r) => {
      const u = new URL(r.request().url());
      if (u.origin !== BASE) return r.abort("blockedbyclient");
      if (r.request().method() === "POST" && /purchases/.test(u.pathname)) { purchases.push(u.pathname); return r.abort("blockedbyclient"); }
      return r.continue();
    });
    await c.addCookies([{ name: COOKIE, value: token, url: BASE }]);
    const page = await c.newPage();
    page.on("pageerror", (e) => errors.push(String(e)));
    for (const [name, p] of [["coins", "/family/rewards"], ["games", "/family/games"]]) {
      await page.goto(`${BASE}${p}?child=${child}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1200);
      const file = path.join(OUT, `${PREFIX}-${name}-${child}-${vw}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log("shot", file);
    }
    // After: open (never confirm) the chess confirmation on the Coins screen.
    if (PREFIX === "after") {
      await page.goto(`${BASE}/family/rewards?child=${child}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(800);
      const buy = page.locator("[data-redeem-buy='chess']");
      if (await buy.count() && await buy.isEnabled()) {
        await buy.click();
        await page.waitForTimeout(300);
        const file = path.join(OUT, `${PREFIX}-coins-confirm-${child}-${vw}.png`);
        await page.screenshot({ path: file, fullPage: true });
        console.log("shot", file);
      }
    }
    await c.close();
  }
}
// --buy (synthetic DB only): Santiago buys ONE chess block on Coins with a double tap on «Ja»; exactly one coin must go.
if (args.includes("--buy")) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "de-CH", hasTouch: true, isMobile: true });
  await installBrowserAudioGuard(c);
  const posts = [];
  await c.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (u.origin !== BASE) return r.abort("blockedbyclient");
    if (r.request().method() === "POST" && /purchases/.test(u.pathname)) posts.push(r.request().postData());
    return r.continue();
  });
  await c.addCookies([{ name: COOKIE, value: token, url: BASE }]);
  const page = await c.newPage();
  await page.goto(`${BASE}/family/rewards?child=santiago`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const before = await page.locator("[data-wallet-balance]").getAttribute("data-wallet-balance");
  await page.locator("[data-redeem-buy='chess']").click();
  // Three taps in the same tick (faster than any re-render): the guard must let exactly one purchase through.
  await page.locator("[data-redeem-confirm='chess']").waitFor();
  await page.evaluate(() => { const b = document.querySelector("[data-redeem-confirm='chess']"); b.click(); b.click(); b.click(); });
  await page.waitForSelector("[data-redeem-left='chess']", { timeout: 15000 });
  await page.waitForTimeout(1500);
  const after = await page.locator("[data-wallet-balance]").getAttribute("data-wallet-balance");
  const file = path.join(OUT, `${PREFIX}-coins-bought-santiago-390.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log("shot", file);
  const keys = new Set(posts.map((p) => JSON.parse(p).idempotencyKey));
  console.log(JSON.stringify({ buy: { before, after, posts: posts.length, distinctKeys: keys.size } }));
  await c.close();
}
await browser.close();
console.log(JSON.stringify({ pageErrors: errors, blockedPurchasePosts: purchases }));
