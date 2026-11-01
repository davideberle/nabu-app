#!/usr/bin/env node
// Step 1 (2026-11-01): rendered walk-through of both new visits at the Mac mini window size (1440 × 900), on an ISOLATED
// loopback server with SYNTHETIC records (scripts/step1-seed.mjs). Never production. Nokt is switched on with an unreachable
// `.invalid` bridge, so its failure path is what renders. Browser audio is guarded and Chromium is muted: nothing is audible.
//   AUTH_SECRET=… node scripts/step1-screens.mjs --base http://127.0.0.1:3391 --out <dir>
import fs from "node:fs";
import path from "node:path";
import { encode } from "@auth/core/jwt";
import { chromium } from "/Users/claweberle/.npm-global/lib/node_modules/playwright/index.mjs";
import { audioSafeChromiumLaunchOptions, installBrowserAudioGuard } from "./lib/browser-audio-guard.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const BASE = opt("--base", "http://127.0.0.1:3391");
const OUT = opt("--out", "/tmp/family-step1-out/screens");
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE)) throw new Error("loopback only");
const SECRET = process.env.AUTH_SECRET ?? "fable-world-first-synthetic-secret-0123456789abcdef";
fs.mkdirSync(OUT, { recursive: true });
const COOKIE = "authjs.session-token";
const mint = (email) => encode({ token: { email, sub: email, name: email }, secret: SECRET, salt: COOKIE, maxAge: 3600 });
const owner = await mint("info@davideberle.com");
const assistant = await mint("assistant@davideberle.com");
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail: detail ?? null });
  console.log(ok ? "PASS" : "FAIL", name, detail === undefined ? "" : JSON.stringify(detail).slice(0, 300));
};
const pageErrors = [];
const external = [];
const browser = await chromium.launch(audioSafeChromiumLaunchOptions({ headless: true }));
async function ctx(cookie) {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "de-CH", timezoneId: "Europe/Zurich" });
  await installBrowserAudioGuard(c);
  await c.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (u.origin !== BASE) {
      external.push(`${u.origin}${u.pathname}`);
      return r.abort("blockedbyclient");
    }
    return r.continue();
  });
  await c.addCookies([{ name: COOKIE, value: cookie, url: BASE }]);
  return c;
}
let n = 0;
const shot = async (page, name, fullPage = false) => {
  n += 1;
  const file = path.join(OUT, `${String(n).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage });
  return file;
};
const saved = (page) => page.waitForResponse((r) => r.url().includes("/api/family/learning/mission") && r.request().method() === "PUT", { timeout: 15000 });
async function goTo(page, step) {
  await page.waitForSelector(`[data-testid='go-${step}']`, { timeout: 15000 });
  const btn = page.locator(`[data-testid='go-${step}']`);
  if ((await btn.innerText()).includes("Hingehen")) {
    await btn.click();
    await page.waitForFunction((s) => document.querySelector(`[data-testid='go-${s}']`)?.textContent?.includes("Starten"), step, { timeout: 20000 });
  }
  await page.locator(`[data-testid='go-${step}']`).click();
  await page.waitForSelector(`[data-testid='scene-panel'][data-step='${step}']`, { timeout: 15000 });
  await settle(400);
}
async function leave(page) {
  await page.locator("[data-testid='scene-continue']").click();
  await page.waitForSelector("[data-testid='scene-panel']", { state: "detached", timeout: 15000 });
  await settle(300);
}
async function part(page, value) {
  const next = page.locator("[data-testid='solve-next-question']");
  if (await next.count()) await next.click();
  await page.locator("[data-testid='part-input']").fill(String(value));
  const d = saved(page);
  await page.locator("[data-testid='part-check']").click();
  await d;
  await settle(400);
}
const visibleText = async (page, sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, " ").trim();

// ------------------------------------------------------------------------------------------------ Santiago, Visit 9
{
  const c = await ctx(assistant);
  const page = await c.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(`${BASE}/family/learn?child=santiago`);
  await page.waitForSelector("[data-testid='cockpit-start'], [data-testid='start-visit']", { timeout: 30000 });
  await shot(page, "santiago-hub");
  if (await page.locator("[data-testid='cockpit-start']").count()) await page.locator("[data-testid='cockpit-start']").click();
  await page.waitForSelector("[data-testid='start-visit']", { timeout: 15000 });
  await page.locator("[data-testid='start-visit']").click();
  await page.waitForSelector("[data-testid='map-mission']", { timeout: 20000 });
  // Nokt's welcome: modal, the only interaction; with the unreachable bridge it says one friendly line and closes by itself.
  const modal = await page.waitForSelector("[data-testid='nokt-modal']", { timeout: 8000 }).catch(() => null);
  check("S.nokt-welcome-opens-as-modal", !!modal);
  await settle(1500);
  await shot(page, "santiago-nokt-welcome-modal");
  await page.waitForSelector("[data-testid='nokt-modal']", { state: "detached", timeout: 15000 }).catch(() => null);
  check("S.nokt-modal-closes-itself-without-reply", (await page.locator("[data-testid='nokt-modal']").count()) === 0);
  check("S.no-permanent-word-bank", (await page.locator("[data-testid='hud-wordbook']").count()) === 0);
  await shot(page, "santiago-map");

  await goTo(page, "P1-START");
  check("S.focused-no-breadcrumb", (await page.locator("[data-testid='scene-bar']").count()) === 0);
  check("S.focused-no-stop-note", !(await visibleText(page, "[data-testid='scene-panel']")).includes("jederzeit oben"));
  await shot(page, "santiago-P1-start");
  await page.locator("[data-testid='story-done']").click();
  await settle(500);
  await leave(page);

  await goTo(page, "P2-PIPES");
  check("S.warmup-facts-not-duplicated", (await page.locator("[data-testid='scene-facts']").count()) === 0);
  await shot(page, "santiago-P2-warmup-pipes");
  await part(page, 5);
  await part(page, 2);
  await shot(page, "santiago-P2-done");
  await leave(page);

  await goTo(page, "P3-TANKBED");
  check("S.calculation-input", (await page.locator("[data-testid='part-input'][data-kind='calculation']").count()) === 1);
  await page.locator("[data-testid='part-input']").fill("4 x 7");
  await shot(page, "santiago-P3-written-calculation");
  {
    const d = saved(page);
    await page.locator("[data-testid='part-check']").click();
    await d;
    await settle(400);
  }
  await leave(page);

  await goTo(page, "P4-REGADERA");
  await shot(page, "santiago-P4-rosa-spanish");
  await page.locator("[data-testid='request-input']").fill("Necesitamos una regadera");
  {
    const d = saved(page);
    await page.locator("[data-testid='request-send']").click();
    await d;
    await settle(500);
  }
  await leave(page);

  await goTo(page, "P5-BEDS");
  await part(page, "5 x 6");
  await part(page, 24);
  await page.waitForSelector("[data-testid='solve-methods']", { timeout: 10000 });
  await shot(page, "santiago-P5-ways-side-by-side");
  {
    const d = saved(page);
    await page.locator("[data-testid='method-minus']").click();
    await d;
    await settle(400);
  }
  await leave(page);
  check("S.harder-version-offered-after-right-first-time", (await page.locator("[data-testid='go-P5H-BEDS-BIG']").count()) === 1);

  await goTo(page, "P6-EDGE");
  await shot(page, "santiago-P6-cm-around-inside");
  await part(page, 200);
  await part(page, 14);
  await part(page, "3 x 4");
  await leave(page);

  await goTo(page, "P6D-ROUTE");
  await shot(page, "santiago-P6D-route");
  {
    const d = saved(page);
    await page.locator("[data-testid='decide-pick-edge']").click();
    await d;
    await settle(400);
  }
  await leave(page);

  await goTo(page, "P7-JUNE");
  await shot(page, "santiago-P7-june-english");
  await leave(page).catch(() => page.locator("[data-testid='scene-back']").click());
  await settle(500);

  await goTo(page, "P11-JOURNAL");
  await shot(page, "santiago-P11-write");
  await page.locator("[data-testid='write-input']").fill("Heute haben wir eine Wasserleitung gebaut. Das Wasser fliesst ins Gewächshaus");
  {
    const d = saved(page);
    await page.locator("[data-testid='write-send']").click();
    await d;
    await settle(800);
  }
  const wmodal = await page.waitForSelector("[data-testid='nokt-modal']", { timeout: 8000 }).catch(() => null);
  check("S.writing-nokt-first-as-modal", !!wmodal);
  await shot(page, "santiago-P11-nokt-modal");
  await page.waitForSelector("[data-testid='write-tip']", { timeout: 15000 }).catch(() => null);
  await page.waitForSelector("[data-testid='nokt-modal']", { state: "detached", timeout: 15000 }).catch(() => null);
  check("S.app-tip-only-after-nokt-failed", (await page.locator("[data-testid='write-tip']").count()) === 1 && (await page.locator("[data-testid='nokt-modal']").count()) === 0);
  await shot(page, "santiago-P11-tip-after-nokt-failed");
  const inputs = await page.$$eval("input:not([type=checkbox]), textarea", (els) => els.map((e) => ({ ac: e.getAttribute("autocomplete"), co: e.getAttribute("autocorrect"), ca: e.getAttribute("autocapitalize"), sc: e.getAttribute("spellcheck"), ws: e.getAttribute("writingsuggestions") })));
  check("S.no-typing-help-on-every-field", inputs.length > 0 && inputs.every((x) => x.ac === "off" && x.co === "off" && x.ca === "off" && x.sc === "false" && x.ws === "false"), inputs);
  await c.close();
}

// ------------------------------------------------------------------------------------------------ Isabel, Visit 3
{
  const c = await ctx(assistant);
  const page = await c.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(`${BASE}/family/learn?child=isabel`);
  await page.waitForSelector("[data-testid='cockpit-start'], [data-testid='start-visit']", { timeout: 30000 });
  await shot(page, "isabel-hub");
  if (await page.locator("[data-testid='cockpit-start']").count()) await page.locator("[data-testid='cockpit-start']").click();
  await page.waitForSelector("[data-testid='start-visit']", { timeout: 15000 });
  await page.locator("[data-testid='start-visit']").click();
  const onStep = (s) => page.waitForSelector(`[data-testid='workshop-scene'][data-step='${s}']`, { timeout: 20000 });
  let sawWaiting = false;
  const next = async () => {
    // S1-02: while the narration speaks, «Weiter» is disabled; «Stopp» stays available (the guarded speech never ends by itself).
    const speaking = await page.locator("[data-testid='narration-control'][data-state='speaking']").count();
    if (speaking) {
      if (await page.locator("[data-testid='workshop-next'][data-waiting='narration']").count()) sawWaiting = (await page.locator("[data-testid='workshop-next']").first().isDisabled()) || sawWaiting;
      await page.locator("[data-testid='narration-control']").first().click();
      await settle(300);
    }
    const d = saved(page);
    await page.locator("[data-testid='workshop-next']").first().click();
    await d;
    await settle(500);
  };
  const ipart = async (v) => {
    const nq = page.locator("[data-testid='solve-next-question']");
    if (await nq.count()) await nq.click();
    await page.locator("[data-testid='part-input']").fill(String(v));
    const d = saved(page);
    await page.locator("[data-testid='part-check']").click();
    await d;
    await settle(450);
  };
  await onStep("IH1-HELLO");
  await settle(800);
  await shot(page, "isabel-IH1-hello");
  await next();
  await onStep("IH2-PICK");
  await shot(page, "isabel-IH2-what-to-harvest");
  {
    const d = saved(page);
    await page.locator("[data-testid='make-apples']").click();
    await d;
    await settle(400);
  }
  await next();
  await onStep("IH3-BUNDLE");
  await shot(page, "isabel-IH3-count-one-bundle");
  await ipart(10);
  await next();
  await onStep("IH4-TENS");
  check("I.closed-bundles", (await page.locator("[data-bundles='closed']").count()) >= 1);
  await shot(page, "isabel-IH4-closed-bundles");
  await ipart(43);
  await ipart(23);
  await shot(page, "isabel-IH4-apples-bag");
  await ipart(14);
  await next();
  await onStep("IH6-PLUS");
  await ipart(10);
  await ipart(10);
  await next();
  await onStep("IH6H-BRIDGE");
  await shot(page, "isabel-IH6H-harder-bridge");
  await ipart(2);
  await ipart(13);
  await next();
  await onStep("IH7-READ");
  await shot(page, "isabel-IH7-read-MAIS");
  check("I.weiter-disabled-while-narration-speaks", sawWaiting);
  await c.close();
}

// ------------------------------------------------------------------------------------------------ Parent, English report
{
  const c = await ctx(owner);
  const page = await c.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(`${BASE}/family/learn/parent?child=santiago`);
  await page.waitForSelector("[data-testid='report-en']", { timeout: 30000 }).catch(() => null);
  check("P.english-report", (await page.locator("[data-testid='report-en']").count()) === 1);
  check("P.nokt-did-not-respond", (await page.locator("[data-testid='report-en-nokt']").count()) >= 1 && /Nokt did not respond/.test(await visibleText(page, "[data-testid='report-en-nokt']")));
  await page.locator("[data-testid='report-en']").scrollIntoViewIfNeeded();
  await shot(page, "parent-santiago-report-en");
  const ev = await page.evaluate(async () => (await fetch("/api/family/learning/parent/evidence?child=santiago")).json());
  const tip = (ev.supports ?? []).find((x) => /correction$/.test(x.kind) && x.payload?.after === "nokt-unavailable");
  const failedReply = (ev.supports ?? []).filter((x) => x.taskId?.includes("P11-JOURNAL") || x.kind?.includes("talk")).map((x) => x.kind);
  check("S.app-tip-recorded-only-after-nokt-did-not-react", !!tip, failedReply);
  await page.goto(`${BASE}/family/learn/parent?child=isabel`);
  await page.waitForSelector("[data-testid='report-en']", { timeout: 30000 }).catch(() => null);
  await shot(page, "parent-isabel-report-en");
  await c.close();
}

check("no-page-errors", pageErrors.length === 0, pageErrors);
check("no-external-requests-except-the-invalid-bridge", external.every((u) => u.includes(".invalid")), [...new Set(external)]);
await browser.close();
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), results, external: [...new Set(external)] }, null, 1));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
