#!/usr/bin/env node
// Step 2 A (2026-11-02): renders the parent's level-based learning report at 1440×780 against an ISOLATED local server
// seeded with scripts/step2-seed.mjs (synthetic records only), checks what the page must show and takes screenshots.
// Loopback only; every non-local request is blocked; the browser is muted by the audio guard.
//   AUTH_SECRET=… node scripts/step2-screens.mjs --base http://127.0.0.1:3392 --out <dir>
import fs from "node:fs";
import path from "node:path";
import { encode } from "@auth/core/jwt";
import { chromium } from "/Users/claweberle/.npm-global/lib/node_modules/playwright/index.mjs";
import { audioSafeChromiumLaunchOptions, installBrowserAudioGuard } from "./lib/browser-audio-guard.mjs";
import { openParentTab } from "./lib/parent-tabs.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const BASE = opt("--base", "http://127.0.0.1:3392");
const OUT = opt("--out", "/tmp/family-step2-out/screens");
const VIEWPORT = { width: 1440, height: 780 };
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE)) throw new Error("loopback only");
const SECRET = process.env.AUTH_SECRET ?? "fable-world-first-synthetic-secret-0123456789abcdef";
fs.mkdirSync(OUT, { recursive: true });
const COOKIE = "authjs.session-token";
const mint = (email) => encode({ token: { email, sub: email, name: email }, secret: SECRET, salt: COOKIE, maxAge: 3600 });
const owner = await mint("info@davideberle.com");
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail: detail ?? null });
  console.log(ok ? "PASS" : "FAIL", name, detail === undefined ? "" : JSON.stringify(detail).slice(0, 300));
};
const pageErrors = [];
const external = [];
const browser = await chromium.launch(audioSafeChromiumLaunchOptions({ headless: true }));
const c = await browser.newContext({ viewport: VIEWPORT, locale: "en-US", timezoneId: "Europe/Zurich" });
await installBrowserAudioGuard(c);
await c.route("**/*", (r) => {
  const u = new URL(r.request().url());
  if (u.origin !== BASE) {
    external.push(`${u.origin}${u.pathname}`);
    return r.abort("blockedbyclient");
  }
  return r.continue();
});
await c.addCookies([{ name: COOKIE, value: owner, url: BASE }]);
const page = await c.newPage();
page.on("pageerror", (e) => pageErrors.push(String(e)));
let n = 0;
const shot = async (name, fullPage = false) => {
  n += 1;
  const file = path.join(OUT, `${String(n).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage });
  return file;
};
const text = (sel) => page.locator(sel).first().innerText();

await page.goto(`${BASE}/family/learn/parent`);
for (const child of ["santiago", "isabel"]) {
  if (child === "isabel") await page.getByRole("tab", { name: "Isabel", exact: true }).click();
  await page.waitForFunction((c) => !!document.querySelector("[data-testid='learning-ladder']") && document.querySelector("[data-testid='learning-ladder'] h2")?.textContent?.toLowerCase().startsWith(c), child, { timeout: 30000 });
  await page.waitForTimeout(300);
  const ev = await page.evaluate(async (c) => (await fetch(`/api/family/learning/parent/evidence?child=${c}`)).json(), child);
  const l = ev.ladder;
  check(`${child}.ladder-served`, !!l && Array.isArray(l.rows), l ? l.rows.length : null);
  check(`${child}.label-estimates`, (await text("[data-testid='ladder-label']")) === "Estimates from a few tasks, not test scores.");
  check(`${child}.summary-three-lines`, (await page.locator("[data-testid='ladder-summary'] li").count()) === 3, await text("[data-testid='ladder-summary']"));
  check(`${child}.kumon-reference`, (await text("[data-testid='ladder-kumon']")).includes(child === "santiago" ? "level D" : "level A"));
  const recon = await text("[data-testid='ladder-reconciliation']");
  check(`${child}.reconciliation-adds-up`, l.reconciliation.found === l.reconciliation.mapped + l.reconciliation.notASkill.length + l.reconciliation.unmapped.length && recon.includes(`${l.reconciliation.found} found`), recon);
  check(`${child}.no-unknown-objectives`, l.reconciliation.unmapped.length === 0, l.reconciliation.unmapped);
  check(`${child}.unmapped-listed-visibly`, (await page.locator("[data-testid='ladder-unmapped'] li").count()) === l.reconciliation.notASkill.length + l.reconciliation.unmapped.length);
  check(`${child}.visit-details-collapsed`, (await page.locator("[data-testid='visit-details']").getAttribute("open")) === null);
  check(`${child}.trend-one-dot-per-visit`, l.rows.every((r) => r.trend.length === (ev.state?.visits ?? []).length));
  check(`${child}.lp21-or-cefr-on-every-row`, l.rows.every((r) => (r.reference.kind === "lp21" ? /Zyklus/.test(r.reference.cycle) : r.reference.steps.length > 0)));
  check(`${child}.status-per-row`, Object.fromEntries(l.rows.map((r) => [r.id, r.status])));
  check(`${child}.summary`, true, l.summary);
  if (child === "santiago") {
    const mult = l.rows.find((r) => r.id === "s-multiply");
    check("santiago.helped-here-downgrades", mult.evidence.parentHelped === 1 && mult.attempts.find((a) => a.parentHelped)?.level === "with-help", mult.attempts.map((a) => a.level));
    check("santiago.typing-block", !!l.typing && (await page.locator("[data-testid='ladder-typing']").count()) === 1, l.typing?.lesson);
  } else {
    check("isabel.only-her-rows", l.rows.every((r) => r.id.startsWith("i-")) && l.rows.length === 4);
    check("isabel.no-language-or-typing-rows", !l.typing && l.rows.every((r) => r.subject === "math" || r.subject === "german"));
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(5, 5);
  await shot(`parent-${child}-1440x780`);
  await shot(`parent-${child}-full`, true);
}
// Visit details: opens on request and keeps the earlier views (latest visits, tabs, «I helped here» where answers exist).
await page.locator("[data-testid='visit-details'] > summary").click();
await page.waitForTimeout(300);
check("visit-details-opens", (await page.locator("[data-testid='visit-details']").getAttribute("open")) !== null);
check("visit-details-has-earlier-tabs", (await page.getByRole("tab", { name: "Mathe", exact: true }).count()) === 1 && (await page.getByRole("tab", { name: "Einstellungen", exact: true }).count()) === 1);
await page.locator("[data-testid='visit-details']").scrollIntoViewIfNeeded();
await shot("parent-isabel-visit-details-open");
// Every earlier German view still opens inside «Visit details» (both children), without a page error.
for (const child of ["santiago", "isabel"]) {
  await page.getByRole("tab", { name: child === "santiago" ? "Santiago" : "Isabel", exact: true }).click();
  await page.waitForFunction((c) => document.querySelector("[data-testid='learning-ladder'] h2")?.textContent?.toLowerCase().startsWith(c), child, { timeout: 30000 });
  const opened = [];
  for (const tab of ["Mathe", "Deutsch", "Englisch", "Spanisch", "Tippen", "Rückblick", "Einstellungen"]) {
    await openParentTab(page, tab, { exact: true });
    await page.waitForTimeout(150);
    const selected = await page.getByRole("tab", { name: tab, exact: true }).getAttribute("aria-selected");
    const h = await page.locator("[data-testid='visit-details'] h2").count();
    opened.push(`${tab}:${selected === "true" && h > 0 ? "ok" : "missing"}`);
  }
  check(`${child}.earlier-views-open-inside-visit-details`, opened.every((x) => x.endsWith(":ok")), opened);
}

check("no-page-errors", pageErrors.length === 0, pageErrors);
check("no-external-requests", external.length === 0, [...new Set(external)]);
await browser.close();
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ base: BASE, viewport: VIEWPORT, at: new Date().toISOString(), results, external: [...new Set(external)] }, null, 1));
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ pass: results.length - failed.length, fail: failed.length }));
process.exit(failed.length ? 1 : 0);
