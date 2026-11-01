#!/usr/bin/env node
// Step 1 (2026-11-01): rendered walk-through of both new visits at the Mac mini's real Chrome viewport (1440 × 780: a 1440 × 900
// window minus the browser toolbars), on an ISOLATED
// loopback server with SYNTHETIC records (scripts/step1-seed.mjs). Never production. Nokt is switched on with an unreachable
// `.invalid` bridge, so its failure path is what renders. Browser audio is guarded and Chromium is muted: nothing is audible.
//   AUTH_SECRET=… node scripts/step1-screens.mjs --base http://127.0.0.1:3391 --out <dir> [--path main|wrong]
// --path main: right first time everywhere (harder versions); --path wrong: a miss first on each main station (easier versions).
// Device voices are MOCKED (German, English, Spanish): every utterance ends after a moment; nothing is ever audible.
import fs from "node:fs";
import path from "node:path";
import { encode } from "@auth/core/jwt";
import { chromium } from "/Users/claweberle/.npm-global/lib/node_modules/playwright/index.mjs";
import { audioSafeChromiumLaunchOptions, installBrowserAudioGuard } from "./lib/browser-audio-guard.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const BASE = opt("--base", "http://127.0.0.1:3391");
const OUT = opt("--out", "/tmp/family-step1-out/screens");
const PATH = opt("--path", "main");
const VIEWPORT = { width: 1440, height: 780 };
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
const PROBE = `(() => {
  const s = globalThis.speechSynthesis;
  globalThis.__speech = [];
  let pending = null;
  if (s) {
    const speak = (u) => { globalThis.__speech.push({ text: u.text, lang: u.lang }); pending = u; setTimeout(() => { if (pending === u) { pending = null; u.onend && u.onend(); } }, globalThis.__speechMs || 900); };
    const cancel = () => { const u = pending; pending = null; if (u && u.onerror) u.onerror({ error: "interrupted" }); };
    const voices = [{ name: "Anna", lang: "de-DE", default: false, localService: true }, { name: "Samantha", lang: "en-US", default: true, localService: true }, { name: "Mónica", lang: "es-ES", default: false, localService: true }];
    try { Object.defineProperty(s, "speak", { configurable: false, writable: false, value: speak }); } catch {}
    try { Object.defineProperty(s, "cancel", { configurable: false, writable: false, value: cancel }); } catch {}
    try { Object.defineProperty(s, "getVoices", { configurable: false, writable: false, value: () => voices }); } catch {}
  }
})();`;
const external = [];
const browser = await chromium.launch(audioSafeChromiumLaunchOptions({ headless: true }));
async function ctx(cookie) {
  const c = await browser.newContext({ viewport: VIEWPORT, locale: "de-CH", timezoneId: "Europe/Zurich" });
  await c.addInitScript(PROBE);
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
  const file = path.join(OUT, `${PATH === "main" ? "" : "w"}${String(n).padStart(2, "0")}-${name}.png`);
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
  await fold(page, `${PATH}.${step}.open`);
}
async function leave(page) {
  await page.locator("[data-testid='scene-continue']").click();
  await page.waitForSelector("[data-testid='scene-panel']", { state: "detached", timeout: 15000 });
  await settle(300);
}
async function part(page, value, label = null) {
  const next = page.locator("[data-testid='solve-next-question']");
  if (await next.count()) await next.click();
  if (label) await fold(page, label);
  await page.locator("[data-testid='part-input']").fill(String(value));
  const d = saved(page);
  await page.locator("[data-testid='part-check']").click();
  await d;
  await settle(400);
}
const visibleText = async (page, sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, " ").trim();
/** Above the fold (review item 1): every visible question, input and primary button of the screen lies inside the 780 px viewport, unscrolled. */
const folds = [];
async function fold(page, label) {
  await settle(250);
  const r = await page.evaluate(() => {
    const els = [...document.querySelectorAll("[data-fold]")].filter((e) => e.offsetParent !== null && getComputedStyle(e).visibility !== "hidden" && !e.closest("[data-testid='nokt-modal']"));
    const h = innerHeight;
    const out = els.filter((e) => { const b = e.getBoundingClientRect(); return b.top < 0 || b.bottom > h; }).map((e) => { const b = e.getBoundingClientRect(); return { f: e.dataset.fold, t: (e.textContent || e.getAttribute("placeholder") || "").trim().slice(0, 40), top: Math.round(b.top), bottom: Math.round(b.bottom) }; });
    return { scrollY: Math.round(scrollY), h, kinds: [...new Set(els.map((e) => e.dataset.fold))], n: els.length, out };
  });
  const ok = r.n > 0 && r.out.length === 0 && r.scrollY === 0 && (r.kinds.includes("primary") || r.kinds.includes("input"));
  folds.push({ label, ok, ...r });
  check(`F.${label}`, ok, ok ? undefined : r);
}
async function pick(page, qid, option) {
  const sel = `[data-testid='pick-${qid}-${option}']`;
  await page.waitForFunction((s) => { const b = document.querySelector(s); return b && !b.hasAttribute("disabled"); }, sel, { timeout: 15000 });
  const d = saved(page);
  await page.locator(sel).click();
  await d;
  await settle(400);
}
async function listen(page) {
  await page.locator("[data-testid='listen-play']").first().click();
  await settle(1200);
}

async function request(page, text) {
  await page.locator("[data-testid='request-input']").fill(text);
  const d = saved(page);
  await page.locator("[data-testid='request-send']").click();
  await d;
  await settle(500);
}
async function method(page, id) {
  await page.waitForSelector("[data-testid='solve-methods']", { timeout: 10000 });
  const d = saved(page);
  await page.locator(`[data-testid='method-${id}']`).click();
  await d;
  await settle(400);
}
async function typeBlock(page) {
  await page.locator("[data-testid='typing-start']").click();
  for (let guard = 0; guard < 60; guard += 1) {
    await settle(300);
    const phase = await page.locator("[data-testid='typing-block']").first().getAttribute("data-phase");
    if (phase === "comfort") { await page.locator("[data-testid='comfort-easy']").click(); continue; }
    if (phase === "extra-offer") { await page.locator("[data-testid='extra-decline']").click(); continue; }
    if (phase !== "drill") break;
    const lines = await page.locator("[data-testid='typing-block'] p.font-mono").allInnerTexts();
    for (const line of lines) {
      await page.locator("[data-testid='typing-input']").type(line.replace(/\s+/g, " ").trim(), { delay: 5 });
      await page.keyboard.press("Enter");
      await settle(100);
    }
  }
}
const oneStopControl = async (page, who) => {
  const r = await page.evaluate(() => ({
    hud: document.querySelector("[data-testid='hud-stop']")?.textContent?.trim() ?? null,
    stopps: [...document.querySelectorAll("button, a")].filter((e) => e.offsetParent !== null && /^■?\s*Stopp$/.test((e.textContent || "").trim())).length,
    narration: document.querySelector("[data-testid='narration-control']")?.textContent?.trim() ?? null,
  }));
  check(`B.${who}.one-stop-control-pause-and-icon`, r.hud?.includes("Pause") && r.stopps === 0 && (r.narration === null || r.narration.length <= 2), r);
};

// ------------------------------------------------------------------------------------------------ Santiago, Visit 9
{
  const c = await ctx(assistant);
  const page = await c.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(`${BASE}/family/learn?child=santiago`);
  await page.waitForSelector("[data-testid='cockpit-start'], [data-testid='start-visit']", { timeout: 30000 });
  if (PATH === "main") await shot(page, "santiago-hub");
  if (await page.locator("[data-testid='cockpit-start']").count()) await page.locator("[data-testid='cockpit-start']").click();
  await page.waitForSelector("[data-testid='start-visit']", { timeout: 15000 });
  await page.locator("[data-testid='start-visit']").click();
  await page.waitForSelector("[data-testid='map-mission']", { timeout: 20000 });
  const modal = await page.waitForSelector("[data-testid='nokt-modal']", { timeout: 8000 }).catch(() => null);
  if (PATH === "main") {
    check("S.nokt-welcome-opens-as-modal", !!modal);
    await settle(1500);
    await shot(page, "santiago-nokt-welcome-modal");
  }
  await page.waitForSelector("[data-testid='nokt-modal']", { state: "detached", timeout: 15000 }).catch(() => null);
  if (PATH === "main") {
    check("S.nokt-modal-closes-itself-without-reply", (await page.locator("[data-testid='nokt-modal']").count()) === 0);
    check("S.no-permanent-word-bank", (await page.locator("[data-testid='hud-wordbook']").count()) === 0);
    await oneStopControl(page, "santiago");
    await shot(page, "santiago-map");
  }

  await goTo(page, "P1-START");
  if (PATH === "main") {
    check("S.focused-no-breadcrumb", (await page.locator("[data-testid='scene-bar']").count()) === 0);
    check("S.focused-no-stop-note", !(await visibleText(page, "[data-testid='scene-panel']")).includes("jederzeit oben"));
    await shot(page, "santiago-P1-start");
  }
  await page.locator("[data-testid='story-done']").click();
  await settle(500);
  await leave(page);

  await goTo(page, "P2-PIPES");
  if (PATH === "main") {
    check("S.warmup-facts-not-duplicated", (await page.locator("[data-testid='scene-facts']").count()) === 0);
    await shot(page, "santiago-P2-warmup-pipes");
  }
  await part(page, 5);
  await part(page, 2, `${PATH}.P2-PIPES.cut`);
  await leave(page);

  await goTo(page, "P3-TANKBED");
  if (PATH === "main") {
    check("S.calculation-input", (await page.locator("[data-testid='part-input'][data-kind='calculation']").count()) === 1);
    check("S.no-formula-chip-before-first-attempt", (await page.locator("[data-testid='scene-facts']").count()) === 0);
    check("S.no-duplicate-grid-caption", !(await visibleText(page, "[data-testid='scene-panel']")).includes("Das Beet beim Tank: 4 Reihen"));
    check("S.placeholder-is-not-the-answer", !/\d/.test((await page.locator("[data-testid='part-input']").getAttribute("placeholder")) ?? ""));
    await page.locator("[data-testid='part-input']").fill("4 x 7");
    await shot(page, "santiago-P3-written-calculation");
    await page.locator("[data-testid='part-input']").fill("");
  }
  await part(page, "4 x 7");
  await leave(page);

  await goTo(page, "P4-REGADERA");
  if (PATH === "main") await shot(page, "santiago-P4-rosa-spanish");
  await request(page, "Necesitamos una regadera");
  await leave(page);

  if (PATH === "main") {
    await goTo(page, "P5-BEDS");
    await part(page, "5 x 6");
    await part(page, 24, "main.P5-BEDS.beds");
    await page.waitForSelector("[data-testid='solve-methods']", { timeout: 10000 });
    await fold(page, "main.P5-BEDS.methods");
    await shot(page, "santiago-P5-ways-side-by-side");
    await method(page, "minus");
    await leave(page);
    check("S.harder-version-offered-after-right-first-time", (await page.locator("[data-testid='go-P5H-BEDS-BIG']").count()) === 1);
    await goTo(page, "P5H-BEDS-BIG");
    await shot(page, "santiago-P5H-harder");
    await part(page, "6 x 8");
    await part(page, 36, "main.P5H-BEDS-BIG.beds");
    await method(page, "rows");
    await leave(page);

    await goTo(page, "P6-EDGE");
    await shot(page, "santiago-P6-cm-around-inside");
    await part(page, 200);
    await part(page, 14, "main.P6-EDGE.around");
    await part(page, "3 x 4", "main.P6-EDGE.inside");
    await leave(page);
    await goTo(page, "P6H-LITERS");
    await shot(page, "santiago-P6H-liters");
    await part(page, 24);
    await part(page, 5, "main.P6H-LITERS.days");
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
    await listen(page);
    await pick(page, "can", "Neben den Tank");
    await pick(page, "hose", "Hinter die Bank");
    await pick(page, "bucket", "Zwischen die Beete");
    await leave(page);
    await goTo(page, "P7H-JUNE-MORE");
    await listen(page);
    await pick(page, "tap", "Links neben der Tür");
    await pick(page, "pipe", "Hinter dem Schuppen");
    await leave(page);

    await goTo(page, "P8-ROSA");
    await shot(page, "santiago-P8-rosa-listening");
    await listen(page);
    await pick(page, "count", "3");
    await pick(page, "more", "Einen Wasserhahn");
    await leave(page);
    await goTo(page, "P8H-ROSA-MORE");
    await listen(page);
    await pick(page, "count", "4");
    await pick(page, "more", "Eine grosse Giesskanne");
    await leave(page);
    await goTo(page, "P9-TUBO");
    await request(page, "Necesitamos un tubo");
    await leave(page);

    await goTo(page, "P10-TYPING");
    await shot(page, "santiago-P10-typing");
    await typeBlock(page);
    await page.waitForSelector("[data-testid='scene-continue']", { timeout: 20000 });
    await leave(page);

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
    check("S.writing-plural-labels", (await visibleText(page, "[data-testid='scene-panel']")).includes("Deine Sätze"));
    await fold(page, "main.P11-JOURNAL.revise");
    await shot(page, "santiago-P11-tip-after-nokt-failed");
    const inputs = await page.$$eval("input:not([type=checkbox]), textarea", (els) => els.map((e) => ({ ac: e.getAttribute("autocomplete"), co: e.getAttribute("autocorrect"), ca: e.getAttribute("autocapitalize"), sc: e.getAttribute("spellcheck"), ws: e.getAttribute("writingsuggestions") })));
    check("S.no-typing-help-on-every-field", inputs.length > 0 && inputs.every((x) => x.ac === "off" && x.co === "off" && x.ca === "off" && x.sc === "false" && x.ws === "false"), inputs);
    {
      const d = saved(page);
      await page.locator("[data-testid='write-revise']").fill("Heute haben wir eine Wasserleitung gebaut. Das Wasser fliesst ins Gewächshaus.");
      await page.locator("[data-testid='write-revise-send']").click();
      await d;
      await settle(500);
    }
    await leave(page);

    await goTo(page, "P12-DONE");
    await page.locator("[data-testid='story-done']").click();
    await settle(600);
    await fold(page, "main.P12-DONE.home");
    check("S.home-task-shown", (await page.locator("[data-testid='home-task']").count()) === 1);
    await shot(page, "santiago-P12-home-task");
  } else {
    // Wrong path: a miss first on each main station → teaching, the easier version, then a fresh normal one.
    await goTo(page, "P5-BEDS");
    await part(page, "5 x 5");
    check("S.formula-chip-after-a-miss", (await page.locator("[data-testid='scene-facts']").count()) === 1);
    await fold(page, "wrong.P5-BEDS.after-miss");
    await shot(page, "santiago-P5-after-a-miss");
    await part(page, "5 x 6");
    await part(page, 24);
    await method(page, "count");
    await leave(page);
    check("S.easier-version-offered-after-a-miss", (await page.locator("[data-testid='go-P5E-BEDS-SMALL']").count()) === 1 && (await page.locator("[data-testid='go-P5H-BEDS-BIG']").count()) === 0);
    await goTo(page, "P5E-BEDS-SMALL");
    await shot(page, "santiago-P5E-easier");
    await part(page, "3 x 4");
    await part(page, 8, "wrong.P5E-BEDS-SMALL.beds");
    await method(page, "minus");
    await leave(page);
    await goTo(page, "P5N-BEDS-AGAIN");
    await part(page, "5 x 4");
    await part(page, 16, "wrong.P5N-BEDS-AGAIN.beds");
    await method(page, "minus");
    await leave(page);

    await goTo(page, "P6-EDGE");
    await part(page, 20);
    await part(page, 200);
    await part(page, 14);
    await part(page, "3 x 4");
    await leave(page);
    await goTo(page, "P6E-EDGE-SMALL");
    await part(page, 10);
    await part(page, "2 x 3", "wrong.P6E-EDGE-SMALL.inside");
    await leave(page);
    await goTo(page, "P6N-EDGE-AGAIN");
    await part(page, 16);
    await part(page, "3 x 5", "wrong.P6N-EDGE-AGAIN.inside");
    await leave(page);

    await goTo(page, "P7-JUNE");
    await listen(page);
    await pick(page, "can", "Hinter die Bank");
    await pick(page, "can", "Neben den Tank");
    await pick(page, "hose", "Hinter die Bank");
    await pick(page, "bucket", "Zwischen die Beete");
    await leave(page);
    await goTo(page, "P7E-JUNE-SHORT");
    await shot(page, "santiago-P7E-easier");
    await listen(page);
    await pick(page, "bucket", "Rechts neben die Tür");
    await leave(page);

    await goTo(page, "P8-ROSA");
    await listen(page);
    await pick(page, "count", "2");
    await pick(page, "count", "3");
    await pick(page, "more", "Einen Wasserhahn");
    await leave(page);
    await goTo(page, "P8E-ROSA-SHORT");
    await listen(page);
    await pick(page, "count", "2");
    await leave(page);
  }
  await c.close();
}

// ------------------------------------------------------------------------------------------------ Isabel, Visit 3
{
  const c = await ctx(assistant);
  const page = await c.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(`${BASE}/family/learn?child=isabel`);
  await page.waitForSelector("[data-testid='cockpit-start'], [data-testid='start-visit']", { timeout: 30000 });
  if (PATH === "main") await shot(page, "isabel-hub");
  if (await page.locator("[data-testid='cockpit-start']").count()) await page.locator("[data-testid='cockpit-start']").click();
  await page.waitForSelector("[data-testid='start-visit']", { timeout: 15000 });
  await page.locator("[data-testid='start-visit']").click();
  let sawWaiting = false;
  const idle = () => page.waitForFunction(() => !document.querySelector("[data-testid='narration-control'][data-state='speaking']"), null, { timeout: 30000 });
  const onStep = async (s) => {
    await page.waitForSelector(`[data-testid='workshop-scene'][data-step='${s}']`, { timeout: 20000 });
    await settle(300);
    if (await page.locator("[data-testid='narration-control'][data-state='speaking']").count()) {
      const w = page.locator("[data-testid='workshop-next'][data-waiting='narration']");
      if (await w.count()) sawWaiting = (await w.first().isDisabled()) || sawWaiting;
    }
    await fold(page, `${PATH}.I.${s}.open`);
  };
  const next = async () => {
    await idle();
    const d = saved(page);
    await page.locator("[data-testid='workshop-next']").first().click();
    await d;
    await settle(500);
  };
  const ipart = async (v, label = null) => {
    const nq = page.locator("[data-testid='solve-next-question']");
    if (await nq.count()) await nq.click();
    if (label) await fold(page, label);
    await page.locator("[data-testid='part-input']").fill(String(v));
    const d = saved(page);
    await page.locator("[data-testid='part-check']").click();
    await d;
    await settle(450);
  };
  await onStep("IH1-HELLO");
  if (PATH === "main") {
    await oneStopControl(page, "isabel");
    await shot(page, "isabel-IH1-hello");
  }
  await next();
  await onStep("IH2-PICK");
  if (PATH === "main") await shot(page, "isabel-IH2-what-to-harvest");
  {
    const d = saved(page);
    await page.locator("[data-testid='make-apples']").click();
    await d;
    await settle(400);
  }
  await next();
  await onStep("IH3-BUNDLE");
  if (PATH === "main") await shot(page, "isabel-IH3-count-one-bundle");
  await ipart(10);
  await next();
  await onStep("IH4-TENS");
  if (PATH === "main") {
    check("I.closed-bundles-without-a-number", (await page.locator("[data-bundles='closed']").count()) >= 1 && (await page.locator("[data-part='closed-bundle'] text").count()) === 0);
    await shot(page, "isabel-IH4-closed-bundles");
    await ipart(43);
    await ipart(23, "main.I.IH4-TENS.which");
    await ipart(14, "main.I.IH4-TENS.apples");
    await shot(page, "isabel-IH4-done");
    await next();
    await onStep("IH6-PLUS");
    await ipart(10);
    await ipart(10, "main.I.IH6-PLUS.minus");
    await next();
    await onStep("IH6H-BRIDGE");
    await shot(page, "isabel-IH6H-harder-bridge");
    await ipart(2);
    await ipart(13, "main.I.IH6H-BRIDGE.sum");
    await next();
    await onStep("IH7-READ");
    await shot(page, "isabel-IH7-read-MAIS");
    await pick(page, "word", "Mais");
    await next();
    await onStep("IH8-READ");
    await pick(page, "word", "Nuss");
    await next();
    await onStep("IH9-PHRASE");
    await shot(page, "isabel-IH9-phrase");
    await pick(page, "word", "Nuss und Mais");
    await next();
    await onStep("IH10-LISTEN");
    await shot(page, "isabel-IH10-listen");
    await listen(page);
    await pick(page, "show", "Roter Apfel im kleinen Korb");
    await next();
    await onStep("IH11-HARVEST");
    await idle();
    check("I.home-task-shown", (await page.locator("[data-testid='home-task']").count()) === 1);
    await shot(page, "isabel-IH11-harvest-home-task");
    check("I.weiter-disabled-while-narration-speaks", sawWaiting);
  } else {
    await ipart(34);
    await ipart(43);
    await ipart(23);
    await ipart(14);
    await next();
    await onStep("IH5-TENS-AGAIN");
    await shot(page, "isabel-IH5-fresh-tens");
    await ipart(36);
    await next();
    await onStep("IH6-PLUS");
    await ipart(9);
    await ipart(10);
    await ipart(10);
    await next();
    await onStep("IH6E-SMALL");
    await shot(page, "isabel-IH6E-easier");
    await ipart(5);
  }
  await c.close();
}

// ------------------------------------------------------------------------------------------------ Parent, English report
if (PATH === "main") {
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
  check("S.app-tip-recorded-only-after-nokt-did-not-react", !!tip);
  await page.goto(`${BASE}/family/learn/parent?child=isabel`);
  await page.waitForSelector("[data-testid='report-en']", { timeout: 30000 }).catch(() => null);
  await shot(page, "parent-isabel-report-en");
  await c.close();
}

check("no-page-errors", pageErrors.length === 0, pageErrors);
check("no-external-requests-except-the-invalid-bridge", external.every((u) => u.includes(".invalid")), [...new Set(external)]);
await browser.close();
fs.writeFileSync(path.join(OUT, `results-${PATH}.json`), JSON.stringify({ base: BASE, path: PATH, viewport: VIEWPORT, at: new Date().toISOString(), results, folds, external: [...new Set(external)] }, null, 1));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed (${folds.length} above-the-fold screens)`);
process.exit(failed ? 1 : 0);
