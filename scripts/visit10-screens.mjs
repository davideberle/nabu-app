#!/usr/bin/env node
// Visit 10 (Nov 8) render checks at the Mac mini's real Chrome viewport (1440 × 780), on `next build` + `next start` with SYNTHETIC
// records. The two classes of failure that passed earlier checks are checked for here, not mocked away:
//  - pictures: EVERY `svg[data-picture]` on EVERY screen must contain drawn children and have a non-zero box;
//  - voice: the clip route answers with the REAL recorded production clips (GET-only download, kept outside the repo); a line the
//    store does not hold is a failure, and any device voice (speechSynthesis) on a narrated screen is a failure.
// Audio really plays (that is what proves speed and end-of-line timing) but is muted: Audio elements are muted and Chromium runs
// with --mute-audio. Nothing is audible on the Mac.
//   node scripts/visit10-screens.mjs --base http://127.0.0.1:3611 --clips <dir> --index <clips-index.json> --out <dir> --who isabel|santiago|santiago-fail|parent [--path main|wrong]
import fs from "node:fs";
import path from "node:path";
import { encode } from "@auth/core/jwt";
import { chromium } from "/Users/claweberle/.npm-global/lib/node_modules/playwright/index.mjs";
import { openParentTab } from "./lib/parent-tabs.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const BASE = opt("--base", "http://127.0.0.1:3611");
const CLIPS = opt("--clips", "/tmp/visit10/clips");
const INDEX = opt("--index", "/tmp/visit10/clips-index.json");
const OUT = opt("--out", "/tmp/visit10/shots");
const WHO = opt("--who", "isabel");
const PATH = opt("--path", "main");
const VIEWPORT = { width: 1440, height: 780 };
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE)) throw new Error("loopback only");
const SECRET = process.env.AUTH_SECRET ?? "fable-world-first-synthetic-secret-0123456789abcdef";
fs.mkdirSync(OUT, { recursive: true });
const COOKIE = "authjs.session-token";
// The loopback sessions use the same two identities as the earlier render script (read locally, never retyped here).
const accounts = [...fs.readFileSync(new URL("./step1-screens.mjs", import.meta.url), "utf8").matchAll(/const (owner|assistant) = await mint\("([^"]+)"\)/g)];
const emailOf = (who) => accounts.find((m) => m[1] === who)[2];
const mint = (who) => encode({ token: { email: emailOf(who), sub: emailOf(who), name: emailOf(who) }, secret: SECRET, salt: COOKIE, maxAge: 7200 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail: detail ?? null });
  console.log(ok ? "PASS" : "FAIL", name, detail === undefined ? "" : JSON.stringify(detail).slice(0, 300));
};
const pageErrors = [];
const clipLog = { served: [], missing: [] };
const ttsLog = [];
const ttsClip = fs.readdirSync(CLIPS).map((f) => path.join(CLIPS, f)).find((f) => f.includes("de-female"));

// Records device speech instead of allowing it; records the rate of every clip that plays; mutes every media element.
const PROBE = `(() => {
  globalThis.__speech = [];
  globalThis.__plays = [];
  const s = globalThis.speechSynthesis;
  if (s) {
    try { Object.defineProperty(s, "speak", { configurable: false, value: (u) => { globalThis.__speech.push({ text: u.text, lang: u.lang }); setTimeout(() => u.onend && u.onend(), 30); } }); } catch {}
    try { Object.defineProperty(s, "cancel", { configurable: false, value: () => {} }); } catch {}
    try { Object.defineProperty(s, "getVoices", { configurable: false, value: () => [{ name: "Anna", lang: "de-DE", localService: true }] }); } catch {}
  }
  const proto = HTMLMediaElement.prototype;
  const play = proto.play;
  proto.play = function () {
    this.muted = true;
    if (String(this.src).startsWith("blob:")) globalThis.__plays.push({ rate: this.playbackRate, def: this.defaultPlaybackRate, pitch: this.preservesPitch });
    return play.call(this);
  };
})();`;

const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
const external = [];
async function ctx(cookie) {
  const c = await browser.newContext({ viewport: VIEWPORT, locale: "de-CH", timezoneId: "Europe/Zurich" });
  await c.addInitScript(PROBE);
  await c.route("**/*", async (r) => {
    const u = new URL(r.request().url());
    const bridge = /^http:\/\/127\.0\.0\.1:(3299|8797)$/.test(u.origin);
    if (u.origin !== BASE && !bridge) {
      external.push(`${u.origin}${u.pathname}`);
      return r.abort("blockedbyclient");
    }
    const clip = /\/api\/family\/learning\/narration\/([a-z-]+)\/([A-Za-z0-9_-]+)$/.exec(u.pathname);
    if (clip) {
      const f = path.join(CLIPS, `${clip[1]}_${clip[2]}.mp3`);
      if (!fs.existsSync(f)) {
        clipLog.missing.push(`${clip[1]}/${clip[2]}`);
        return r.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      }
      clipLog.served.push(`${clip[1]}/${clip[2]}`);
      return r.fulfill({ status: 200, contentType: "audio/mpeg", body: fs.readFileSync(f), headers: { "cache-control": "private, no-cache" } });
    }
    if (u.pathname === "/api/family/assistant/tts") {
      try { ttsLog.push(JSON.parse(r.request().postData() ?? "{}").text ?? ""); } catch {}
      return r.fulfill({ status: 200, contentType: "audio/mpeg", body: fs.readFileSync(ttsClip) });
    }
    return r.continue();
  });
  await c.addCookies([{ name: COOKIE, value: cookie, url: BASE }]);
  return c;
}
let n = 0;
const shot = async (page, name) => {
  n += 1;
  await page.screenshot({ path: path.join(OUT, `${WHO}${PATH === "main" ? "" : "-" + PATH}-${String(n).padStart(2, "0")}-${name}.png`) });
};
const saved = (page) => page.waitForResponse((r) => r.url().includes("/api/family/learning/mission") && r.request().method() === "PUT", { timeout: 20000 });

/** The check that would have caught the empty pictures: every picture on screen must really have drawn something. */
let picturesSeen = 0;
async function pictures(page, label) {
  const r = await page.evaluate(() => {
    const out = [...document.querySelectorAll("svg[data-picture]")].map((e) => {
      const box = e.getBBox ? e.getBBox() : { width: 0, height: 0 };
      const rect = e.getBoundingClientRect();
      return { id: e.dataset.picture, children: e.querySelectorAll("*").length, w: Math.round(box.width), h: Math.round(box.height), onScreen: rect.width > 0 && rect.height > 0 };
    });
    const imgs = [...document.querySelectorAll("[data-testid='harvest-table-art'], [data-testid='scene-portrait'] img")].map((i) => ({ src: i.getAttribute("src"), natural: i.naturalWidth }));
    return { out, imgs };
  });
  picturesSeen += r.out.length;
  const bad = r.out.filter((p) => p.children === 0 || p.w === 0 || p.h === 0 || !p.onScreen);
  const badImg = r.imgs.filter((i) => !i.natural);
  check(`PIC.${label}`, bad.length === 0 && badImg.length === 0, bad.length || badImg.length ? { bad, badImg } : { n: r.out.length });
}
async function fold(page, label) {
  await settle(250);
  const r = await page.evaluate(() => {
    const els = [...document.querySelectorAll("[data-fold]")].filter((e) => e.offsetParent !== null && getComputedStyle(e).visibility !== "hidden");
    const h = innerHeight;
    const out = els.filter((e) => { const b = e.getBoundingClientRect(); return b.top < 0 || b.bottom > h; }).map((e) => ({ f: e.dataset.fold, t: e.textContent.slice(0, 40), b: Math.round(e.getBoundingClientRect().bottom) }));
    return { scrollY: Math.round(scrollY), n: els.length, out };
  });
  check(`F.${label}`, r.n > 0 && r.out.length === 0 && r.scrollY === 0, r.out.length ? r : undefined);
}
const speechTexts = (page) => page.evaluate(() => globalThis.__speech.map((x) => x.text));
const noModal = async (page, label) => check(`NOMODAL.${label}`, (await page.locator("[data-testid='nokt-modal'], [aria-modal='true']").count()) === 0);
const textOf = async (page, sel) => ((await page.locator(sel).first().innerText()) ?? "").replace(/\s+/g, " ").trim();

async function isabel() {
  const c = await ctx(await mint("assistant"));
  const page = await c.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(`${BASE}/family/learn?child=isabel`);
  await page.waitForSelector("[data-testid='cockpit-start'], [data-testid='start-visit']", { timeout: 30000 });
  if (await page.locator("[data-testid='cockpit-start']").count()) await page.locator("[data-testid='cockpit-start']").click();
  await page.waitForSelector("[data-testid='start-visit']", { timeout: 15000 });
  await page.locator("[data-testid='start-visit']").click();
  let gateSeen = false;
  let stopSeen = false;
  const idle = () => page.waitForFunction(() => document.querySelector("[data-testid='workshop-scene']")?.dataset.narration !== "speaking", null, { timeout: 60000 });
  const onStep = async (s) => {
    await page.waitForSelector(`[data-testid='workshop-scene'][data-step='${s}']`, { timeout: 30000 });
    await settle(250);
    const w = page.locator("[data-testid='workshop-next']");
    if ((await w.count()) && (await page.locator("[data-testid='workshop-scene'][data-narration='speaking']").count())) gateSeen = (await w.first().isDisabled()) || gateSeen;
    if ((await page.locator("[data-testid='narration-control'][data-state='speaking']").count()) && !(await page.locator("[data-testid='narration-control'][data-state='speaking']").first().isDisabled())) stopSeen = true;
    await pictures(page, `${s}.open`);
  };
  const clickNext = async () => {
    await idle();
    await page.waitForFunction(() => { const b = document.querySelector("[data-testid='workshop-next']"); return b && !b.disabled; }, null, { timeout: 60000 });
    const d = saved(page);
    await page.locator("[data-testid='workshop-next']").first().click();
    await d;
    await settle(400);
  };
  const next = async (step) => {
    await clickNext();
    if (step) await onStep(step);
  };
  const ipart = async (v) => {
    await idle();
    const nq = page.locator("[data-testid='solve-next-question']");
    if (await nq.count()) { await nq.click(); await settle(250); await idle(); }
    await page.locator("[data-testid='part-input']").fill(String(v));
    const d = saved(page);
    await page.locator("[data-testid='part-check']").click();
    await d;
    await settle(350);
  };
  const pick = async (qid, option) => {
    await idle();
    const sel = `[data-testid='pick-${qid}-${option}']`;
    await page.waitForFunction((s) => { const b = document.querySelector(s); return b && !b.disabled; }, sel, { timeout: 20000 });
    const d = saved(page);
    await page.locator(sel).click();
    await d;
    await settle(350);
  };
  await onStep("IH1-HELLO");
  await shot(page, "IH1-hello");
  await next("IH2-PICK");
  await shot(page, "IH2-what-to-harvest");
  { await idle(); const d = saved(page); await page.locator("[data-testid='make-carrots']").click(); await d; await settle(350); }
  await next("IH3-BUNDLE");
  await ipart(10);
  await next("IH4-TENS");
  if (PATH === "main") {
    await ipart(43); await ipart(23); await ipart(14);
    await next("IH6-PLUS");
    await ipart(10); await ipart(10);
    await next("IH6H-BRIDGE");
    await ipart(2); await ipart(13);
  } else {
    await ipart(34); await ipart(43); await ipart(23); await ipart(14);
    await next("IH5-TENS-AGAIN");
    await ipart(36);
    await next("IH6-PLUS");
    await ipart(9); await ipart(10); await ipart(10);
    await next("IH6E-SMALL");
    await ipart(5);
  }
  await next("IH7-READ");
  await shot(page, "IH7-read-MAIS-pictures");
  await fold(page, "IH7");
  if (PATH === "main") {
    await pick("word", "Mais");
  } else {
    await pick("word", "Nuss");
    await settle(300);
    await pictures(page, "IH7.after-miss");
    await shot(page, "IH7-after-miss");
    await pick("word", "Apfel");
    await settle(300);
  }
  await next("IH8-READ");
  await shot(page, "IH8-read-NUSS-pictures");
  await pick("word", "Nuss");
  await next("IH9-PHRASE");
  await shot(page, "IH9-phrase-pictures");
  await pick("word", "Nuss und Mais");
  await next("IH10-LISTEN");
  await shot(page, "IH10-listen");
  await idle();
  await page.locator("[data-testid='listen-play']").first().click();
  await settle(800);
  await idle();
  await page.waitForFunction(() => { const b = document.querySelector("[data-testid='listen-play']"); return b && !b.disabled; }, null, { timeout: 40000 });
  await pictures(page, "IH10.after-play");
  await pick("show", "Roter Apfel im kleinen Korb");
  await next("IH11-HARVEST");
  await idle();
  check("I.harvest-table-art", (await page.locator("[data-testid='harvest-table-art']").count()) === 1);
  await shot(page, "IH11-harvest-table");
  await fold(page, "IH11");
  check("I.weiter-disabled-while-speaking", gateSeen);
  check("R3.no-stop-control", !stopSeen && (await page.locator("[aria-label='Vorlesen stoppen']").count()) === 0);
  await clickNext();
  if (await page.locator("[data-testid='workshop-next']").count()) await clickNext();
  await page.waitForSelector("[data-testid='workshop-closing']", { timeout: 30000 });
  const cidle = () => page.waitForFunction(() => document.querySelector("[data-testid='workshop-closing']")?.dataset.narration !== "speaking", null, { timeout: 60000 });
  await cidle();
  await shot(page, "closing-difficulty");
  await page.locator("[data-testid='difficulty-easy']").click();
  await settle(500);
  await cidle();
  if ((await page.locator("[data-testid='workshop-closing']").getAttribute("data-step")) === "enjoyment") {
    await page.locator("[data-testid='enjoyment-yes']").click();
    await settle(500);
  }
  await page.waitForFunction(() => document.querySelector("[data-testid='workshop-closing']")?.dataset.step === "next", null, { timeout: 15000 });
  await settle(400);
  const before = clipLog.served.length;
  await cidle();
  await settle(500);
  check("I.next-choice-speaks-only-the-question", clipLog.served.length - before <= 1, clipLog.served.length - before);
  await pictures(page, "closing-next");
  const labels = await page.locator("[data-testid='closing-next'] [role='group'] button").allInnerTexts();
  check("I.next-choice-one-word-each", labels.length >= 2 && labels.every((l) => l.replace(/[^\p{L} ]/gu, "").trim().split(/\s+/).length === 1), labels);
  await shot(page, "closing-next-pictures");
  await page.locator("[data-testid='closing-next'] [role='group'] button").first().click();
  await settle(200);
  await page.locator("[data-testid='closing-finish']").click();
  await page.waitForSelector("[data-testid='workshop-farewell']", { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector("[data-testid='workshop-farewell']")?.dataset.narration !== "speaking", null, { timeout: 40000 });
  await pictures(page, "farewell");
  await shot(page, "farewell");
  const speech = await speechTexts(page);
  check("I.no-device-voice-anywhere", speech.length === 0, speech);
  const plays = await page.evaluate(() => globalThis.__plays);
  check("I.every-clip-at-0.88-pitch-kept", plays.length > 20 && plays.every((p) => Math.abs(p.rate - 0.88) < 0.001 && Math.abs(p.def - 0.88) < 0.001 && p.pitch === true), { n: plays.length, odd: plays.filter((p) => Math.abs(p.rate - 0.88) >= 0.001).slice(0, 3) });
  check("I.real-clips-served", clipLog.served.length > 20, clipLog.served.length);
  check("I.no-missing-clip", clipLog.missing.length === 0, clipLog.missing);
  check("I.pictures-actually-checked", picturesSeen >= 15, picturesSeen);
  await c.close();
}

async function santiago(fail) {
  const c = await ctx(await mint("assistant"));
  const page = await c.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  const goTo = async (step) => {
    await page.waitForSelector(`[data-testid='go-${step}']`, { timeout: 20000 });
    const b = page.locator(`[data-testid='go-${step}']`);
    if ((await b.innerText()).includes("Hingehen")) {
      await b.click();
      await page.waitForFunction((s) => document.querySelector(`[data-testid='go-${s}']`)?.textContent?.includes("Starten"), step, { timeout: 25000 });
    }
    await page.locator(`[data-testid='go-${step}']`).click();
    await page.waitForSelector(`[data-testid='scene-panel'][data-step='${step}']`, { timeout: 20000 });
    await settle(350);
    await pictures(page, `${step}.open`);
  };
  const banner = async (label) => {
    const r = await page.evaluate(() => ({ banner: !!document.querySelector("[data-testid='scene-banner']"), portrait: document.querySelector("[data-testid='scene-portrait'] img")?.naturalWidth ?? 0, header: !!document.querySelector("[data-testid='scene-header']"), translate: document.querySelectorAll("[data-testid='line-translate'], [data-testid='line-translation']").length }));
    check(`B.banner.${label}`, r.banner && r.portrait > 0 && !r.header && r.translate === 0, r);
  };
  const leave = async () => {
    await page.waitForFunction(() => { const b = document.querySelector("[data-testid='scene-continue']"); return b && !b.disabled; }, null, { timeout: 30000 });
    await page.locator("[data-testid='scene-continue']").click();
    await page.waitForSelector("[data-testid='scene-panel']", { state: "detached", timeout: 15000 });
    await settle(250);
  };
  const part = async (v) => {
    const nq = page.locator("[data-testid='solve-next-question']");
    if (await nq.count()) await nq.click();
    await page.locator("[data-testid='part-input']").fill(String(v));
    const d = saved(page);
    await page.locator("[data-testid='part-check']").click();
    await d;
    await settle(400);
  };
  const pick = async (qid, option) => {
    const sel = `[data-testid='pick-${qid}-${option}']`;
    await page.waitForFunction((s) => { const b = document.querySelector(s); return b && !b.disabled; }, sel, { timeout: 20000 });
    const d = saved(page);
    await page.locator(sel).click();
    await d;
    await settle(400);
  };
  const listen = async () => {
    await page.locator("[data-testid='listen-play']").first().click();
    await settle(500);
    await page.waitForFunction(() => { const b = document.querySelector("[data-testid='listen-play']"); return b && !b.disabled; }, null, { timeout: 60000 });
    await settle(300);
  };
  const request = async (text) => {
    await page.locator("[data-testid='request-input']").fill(text);
    const d = saved(page);
    await page.locator("[data-testid='request-send']").click();
    await d;
    await settle(500);
  };
  const method = async (id) => {
    await page.waitForSelector("[data-testid='solve-methods']", { timeout: 10000 });
    const d = saved(page);
    await page.locator(`[data-testid='method-${id}']`).click();
    await d;
    await settle(350);
  };
  const lineIdle = () => page.waitForFunction(() => document.querySelector("[data-testid='scene-line-replay']")?.dataset.state === "idle", null, { timeout: 30000 });

  await page.goto(`${BASE}/family/learn?child=santiago`);
  await page.waitForSelector("[data-testid='cockpit-start'], [data-testid='start-visit']", { timeout: 30000 });
  if (await page.locator("[data-testid='cockpit-start']").count()) await page.locator("[data-testid='cockpit-start']").click();
  await page.waitForSelector("[data-testid='start-visit']", { timeout: 15000 });
  await page.locator("[data-testid='start-visit']").click();
  await page.waitForSelector("[data-testid='map-mission']", { timeout: 20000 });
  await page.waitForSelector("[data-testid='nokt-sidebar'][data-dock='welcome']", { timeout: 12000 });
  await noModal(page, "welcome");
  await page.waitForFunction(() => document.querySelector("[data-testid='nokt-welcome']")?.dataset.waiting === "false" && document.querySelectorAll("[data-testid='nokt-welcome'] li").length > 0, null, { timeout: 40000 });
  await settle(600);
  {
    const t = await textOf(page, "[data-testid='nokt-welcome']");
    check("C.welcome-spoken-or-friendly", fail ? /Willkommen|erreichbar/.test(t) : ttsLog.some((x) => /Hallo Santi/.test(x)), { t: t.slice(0, 120), tts: ttsLog.slice(0, 2) });
  }
  await shot(page, "welcome-sidebar");
  await page.locator("[data-testid='nokt-dock-close']").click();
  await settle(400);

  await goTo("P1-START");
  await banner("P1");
  await fold(page, "P1");
  await shot(page, "P1-banner");
  await page.locator("[data-testid='story-done']").click();
  await settle(400);
  await leave();

  await goTo("P2-PIPES");
  await part(5);
  await part(2);
  await leave();
  await goTo("P3-TANKBED");
  await banner("P3");
  await shot(page, "P3-calc");
  await part("4 x 7");
  await leave();
  await goTo("P4-REGADERA");
  await banner("P4-es");
  await settle(1200);
  await shot(page, "P4-rosa-es");
  await lineIdle();
  await request("Necesitamos una regadera");
  await leave();

  await goTo("P5-BEDS");
  await part("5 x 6");
  await part(24);
  await method("minus");
  await leave();
  await goTo("P5H-BEDS-BIG");
  await part("6 x 8");
  await part(32);
  await method("rows");
  await leave();

  // Two misses on one question: Nokt opens itself, asking about his own answer.
  await goTo("P6-EDGE");
  await part(200);
  await part(12);
  await part(7);
  await page.waitForSelector("[data-testid='nokt-sidebar'][data-dock='task']", { timeout: 15000 });
  await noModal(page, "task");
  await page.waitForFunction(() => { const t = document.querySelector("[data-testid='nokt-panel']")?.textContent ?? ""; return /Warum|erreichbar|Antwort/.test(t) && !document.querySelector("[data-testid='nokt-thinking']"); }, null, { timeout: 40000 });
  await settle(700);
  {
    const t = await textOf(page, "[data-testid='nokt-panel']");
    if (fail) check("C.task-failure-friendly", /erreichbar/.test(t), t.slice(0, 160));
    else {
      check("C.opens-with-his-own-wrong-answer", /Warum hast du 7/.test(t), t.slice(0, 160));
      check("C.never-offers-help", !/Brauchst du Hilfe|Möchtest du mit mir anschauen/.test(t));
      check("C.opener-spoken", ttsLog.some((x) => /Warum hast du 7/.test(x)));
    }
    const panel = await textOf(page, "[data-testid='scene-panel']");
    check("R1.one-helper-while-nokt-open", panel.includes("Noch nicht richtig.") && !/Hinweis/.test(panel) && (await page.locator("[data-testid='scene-facts'], [data-testid='hint-area']").count()) === 0, panel.slice(-200));
  }
  await shot(page, "P6-two-misses-nokt");
  check("C.task-stays-usable", await page.locator("[data-testid='part-input']").isVisible());
  await page.locator("[data-testid='nokt-close']").click();
  await settle(300);
  check("R1.hint-returns-after-nokt", (await page.locator("[data-testid='hint-area']").count()) === 1);
  await part(14);
  await part("3 x 4");
  await leave();
  // Two misses mean «not independent»: the easier and the normal-again version follow.
  await goTo("P6E-EDGE-SMALL");
  await part(10);
  await part("2 x 3");
  await leave();
  await goTo("P6N-EDGE-AGAIN");
  await part(16);
  await part("3 x 5");
  await leave();
  await goTo("P6D-ROUTE");
  { const d = saved(page); await page.locator("[data-testid='decide-pick-edge']").click(); await d; await settle(400); }
  await leave();

  await goTo("P7-JUNE");
  await banner("P7");
  await shot(page, "P7-june");
  await listen();
  check("R2.no-text-help-by-default", (await page.locator("[data-testid='listen-transcript']").count()) === 0);
  await pick("can", "Neben den Tank");
  await pick("hose", "Hinter die Bank");
  await pick("bucket", "Zwischen die Beete");
  await page.waitForSelector("[data-testid='scene-continue']", { timeout: 15000 });
  await settle(200);
  {
    const waiting = await page.locator("[data-testid='scene-continue']").isDisabled();
    await shot(page, "P7-thank-you");
    check("B.june-says-thank-you", clipLog.served.includes(`en-female/${THANK_YOU}`), { THANK_YOU });
    check("A4.weiter-waits-for-spoken-line", waiting);
    check("R2.no-text-help-on-spoken-reply", (await page.locator("[data-testid='listen-transcript']").count()) === 0);
  }
  await leave();

  await goTo("P7H-JUNE-MORE");
  await listen();
  await pick("tap", "Hinter dem Schuppen");
  check("R2.text-help-after-a-miss", (await page.locator("[data-testid='listen-transcript']").count()) === 1);
  await pick("tap", "Rechts neben der Tür");
  await page.waitForSelector("[data-testid='listen-reveal-next']", { timeout: 15000 });
  {
    const t = await textOf(page, "[data-testid='listen-task']");
    check("A6.shown-answer-really-shown", t.includes("Die Antwort ist: Links neben der Tür."), t.slice(0, 200));
    check("A6.next-question-waits", (await page.locator("[data-testid='question-pipe']").count()) === 0);
    await shot(page, "P7H-answer-really-shown");
  }
  await page.locator("[data-testid='listen-reveal-next']").click();
  await settle(300);
  await pick("pipe", "Hinter dem Schuppen");
  await leave();

  await goTo("P8-ROSA");
  await listen();
  await pick("count", "3");
  await pick("more", "Einen Wasserhahn");
  await page.waitForSelector("[data-testid='scene-continue']", { timeout: 15000 });
  await settle(200);
  check("B.rosa-says-gracias", clipLog.served.includes(`es-female/${GRACIAS}`));
  await leave();
  await goTo("P8H-ROSA-MORE");
  await listen();
  await pick("count", "4");
  await pick("more", "Eine grosse Giesskanne");
  await leave();

  await goTo("P9-TUBO");
  await lineIdle();
  await page.locator("[data-testid='hint-open']").click();
  await page.waitForSelector("[data-testid='word-bank-word']", { timeout: 15000 });
  {
    const r = await page.evaluate(() => ({ words: document.querySelectorAll("[data-testid='word-bank-word']").length, buttons: document.querySelectorAll("[data-testid='hint'] button").length, before: document.querySelector("[data-testid='request-input']").value }));
    await page.locator("[data-testid='word-bank-word']").first().click({ force: true });
    await settle(150);
    const after = await page.locator("[data-testid='request-input']").inputValue();
    check("B.word-bank-display-only", r.words > 0 && r.buttons === 0 && after === r.before, { ...r, after });
    await shot(page, "P9-word-bank");
  }
  await request("Necesitamos un tubo");
  await leave();

  await goTo("P10-TYPING");
  await page.locator("[data-testid='typing-start']").click();
  for (let guard = 0; guard < 60; guard += 1) {
    await settle(300);
    const phase = await page.locator("[data-testid='typing-block']").first().getAttribute("data-phase");
    if (phase === "comfort") { await page.locator("[data-testid='comfort-easy']").click(); continue; }
    if (phase === "extra-offer") { await page.locator("[data-testid='extra-decline']").click(); continue; }
    if (phase !== "drill") break;
    const lines = await page.locator("[data-testid='typing-block'] p.font-mono").allInnerTexts();
    for (const line of lines) {
      await page.locator("[data-testid='typing-input']").type(line.replace(/\s+/g, " ").trim(), { delay: 4 });
      await page.keyboard.press("Enter");
      await settle(80);
    }
  }
  await page.waitForSelector("[data-testid='scene-continue']", { timeout: 25000 });
  await leave();

  await goTo("P11-JOURNAL");
  await banner("P11");
  await page.locator("[data-testid='write-input']").fill("Heute haben wir eine Wasserleitung gebaut. Das Wasser fliesst ins Gewächshaus");
  { const d = saved(page); await page.locator("[data-testid='write-send']").click(); await d; }
  await page.waitForSelector("[data-testid='nokt-sidebar'][data-dock='writing']", { timeout: 10000 });
  await noModal(page, "writing");
  await settle(150);
  check("C.writing-says-reading", /paar Sekunden|überlegt|erreichbar/.test(await textOf(page, "[data-testid='nokt-writing']")));
  check("C.writing-no-close-no-keep", (await page.locator("[data-testid='nokt-dock-close'], [data-testid='nokt-writing-close'], [data-testid='write-keep'], [data-testid='scene-back']").count()) === 0);
  await shot(page, "P11-nokt-reading");
  if (!fail) {
    await page.waitForFunction(() => document.querySelector("[data-testid='nokt-writing']")?.dataset.waiting === "false" && document.querySelectorAll("[data-testid='nokt-writing'] li[data-role='nokt']").length >= 1, null, { timeout: 40000 });
    check("C.writing-waiting-line-spoken", ttsLog.some((t) => /paar Sekunden/.test(t)));
    await settle(500);
    await shot(page, "P11-nokt-talks");
    check("C.writing-still-no-keep", (await page.locator("[data-testid='write-keep']").count()) === 0);
    await page.locator("[data-testid='nokt-talk-input']").fill("Das Wort Wasser");
    await page.locator("[data-testid='nokt-talk-send']").click();
  }
  await page.waitForSelector("[data-testid='write-keep']", { timeout: 40000 });
  check("C.writing-ends-then-revise", (await page.locator("[data-testid='nokt-sidebar']").count()) === 0 && (await page.locator("[data-testid='write-revise']").count()) === 1);
  if (fail) check("C.writing-failure-app-tip", (await page.locator("[data-testid='write-tip']").count()) === 1);
  await fold(page, "P11.revise");
  await shot(page, "P11-after-nokt");
  { const d = saved(page); await page.locator("[data-testid='write-revise']").fill("Heute haben wir eine Wasserleitung gebaut. Das Wasser fliesst ins Gewächshaus."); await page.locator("[data-testid='write-revise-send']").click(); await d; await settle(400); }
  await leave();

  await goTo("P12-DONE");
  await page.locator("[data-testid='story-done']").click();
  await settle(500);
  await leave();
  await page.waitForSelector("[data-testid='mission-finish']", { timeout: 20000 });
  await page.locator("[data-testid='mission-finish']").click();
  await page.waitForSelector("[data-testid='debrief']", { timeout: 20000 });
  await settle(400);
  check("C.end-asks-app-first", (await page.locator("[data-testid='debrief-row-difficulty']").count()) === 1 && (await page.locator("[data-testid='nokt-sidebar']").count()) === 0);
  check("C.end-question-wording", (await textOf(page, "[data-testid='debrief-row-difficulty']")).includes("Wie leicht war es?"));
  await shot(page, "end-app-question");
  await page.locator("[data-testid='difficulty-easy']").click();
  await page.waitForSelector("[data-testid='nokt-sidebar'][data-dock='debrief']", { timeout: 10000 });
  await noModal(page, "debrief");
  check("C.cant-close-while-nokt-talks", (await page.locator("[data-testid='debrief-finish'], [data-testid='debrief-skip-talk']").count()) === 0);
  if (!fail) {
    const answer = async (text) => {
      await page.waitForFunction(() => { const d = document.querySelector("[data-testid='nokt-debrief']"); return d?.dataset.waiting === "false" && d.querySelector("[data-testid='nokt-talk-input']") && d.querySelectorAll("[data-role='nokt']").length >= 1; }, null, { timeout: 40000 });
      await settle(500);
      await page.locator("[data-testid='nokt-debrief'] [data-testid='nokt-talk-input']").fill(text);
      await page.locator("[data-testid='nokt-debrief'] [data-testid='nokt-talk-send']").click();
      await settle(300);
    };
    await answer("Das Rohr um das Beet");
    await shot(page, "end-nokt-lookback");
    check("C.reply-reached-the-screen", (await page.locator("[data-testid='nokt-debrief'] [data-role='nokt']").count()) >= 1);
    check("C.still-cant-close", (await page.locator("[data-testid='debrief-finish']").count()) === 0);
    await answer("Die Rechnung mit dem Rand");
    await page.waitForFunction(() => { const d = document.querySelector("[data-testid='nokt-debrief']"); return d?.dataset.waiting === "false" && d.querySelector("[data-testid='nokt-talk-choices']"); }, null, { timeout: 40000 });
    await settle(400);
    await pictures(page, "end-nokt-choices");
    {
      const labels = (await page.locator("[data-testid='nokt-talk-choices'] button").allInnerTexts()).map((l) => l.trim());
      check("A5.nokt-choices-one-word-pictures", labels.filter((l) => l !== "Weiss ich noch nicht").every((l) => l.split(/\s+/).length === 1), labels);
      const said = ttsLog.at(-1) ?? "";
      check("A5.nokt-does-not-read-the-options", !/Gewächshaus ernten|Teich anlegen/.test(said), said);
      await shot(page, "end-nokt-next-pictures");
    }
    await page.locator("[data-testid='nokt-debrief'] [data-testid^='nokt-choice-pond']").click();
  }
  await page.waitForSelector("[data-testid='debrief-finish']", { timeout: 45000 });
  await settle(400);
  if (fail) {
    await page.waitForSelector("[data-testid='debrief-interest-form']", { timeout: 8000 });
    await pictures(page, "end-form");
    const labels = (await page.locator("[data-testid='next-adventure'] [role='group']").first().locator("button").allInnerTexts()).map((l) => l.replace(/[^\p{L} ]/gu, "").trim());
    check("A5.form-one-word-pictures", labels.every((l) => l.split(/\s+/).length === 1), labels);
    check("C.failure-one-friendly-line", (await page.locator("[data-testid='nokt-debrief'] [data-role='app']").count()) === 1);
    await shot(page, "end-after-failure");
    await page.locator("[data-testid='next-adventure'] [role='group']").first().locator("button").first().click();
  } else await shot(page, "end-after-nokt");
  await page.locator("[data-testid='debrief-finish']").click();
  await page.waitForURL(/\/family\/home/, { timeout: 25000 });
  check("C.visit-finished", true);
  const speech = await speechTexts(page).catch(() => []);
  check("S.no-device-voice-for-recorded-lines", !speech.some((t) => /Thank you|Gracias|June|Rosa/.test(t)), speech);
  check("S.no-missing-clip", clipLog.missing.length === 0, clipLog.missing);
  await c.close();
}

/** The real start from the home map: Nokt greets first (sidebar, on the map); the walk in waits for «Los geht's». */
async function mapWelcome() {
  const c = await ctx(await mint("assistant"));
  const page = await c.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(`${BASE}/family/learn/mission?child=santiago&enter=office`);
  await page.waitForSelector("[data-testid='nokt-sidebar'][data-dock='welcome']", { timeout: 25000 });
  await noModal(page, "map-welcome");
  await page.waitForFunction(() => document.querySelectorAll("[data-testid='nokt-welcome'] li[data-role='nokt']").length > 0, null, { timeout: 40000 });
  await settle(700);
  check("MAP.welcome-happens-on-map-start", ttsLog.some((t) => /Hallo Santi/.test(t)), ttsLog.slice(0, 2));
  check("MAP.no-step-opened-yet", (await page.locator("[data-testid='scene-panel']").count()) === 0);
  await shot(page, "map-welcome");
  await page.locator("[data-testid='nokt-dock-close']").click();
  await page.waitForSelector("[data-testid='scene-panel'][data-step='P1-START']", { timeout: 15000 });
  check("MAP.walks-in-after-los-gehts", true);
  await settle(400);
  await shot(page, "map-then-first-scene");
  await c.close();
}

/** The «Display error, not evidence» annotation on Isabel's reading tasks: synthetic records of the Isabel run. */
async function parentIsabel() {
  const c = await ctx(await mint("owner"));
  const page = await c.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(`${BASE}/family/learn/parent?child=isabel`);
  await page.waitForSelector("[data-testid='visit-details']", { timeout: 40000 });
  const post = () => page.evaluate(async () => (await fetch("/api/family/learning/parent/corrections", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ child: "isabel", displayError: { visit: "v4", steps: ["IH7-READ", "IH8-READ", "IH9-PHRASE"], observation: "Synthetic check by hand." } }) })).json());
  const first = await post();
  check("R4.applied-once", first.annotated >= 3 && first.observed === 3, first);
  const second = await post();
  check("R4.safe-to-send-twice", second.annotated === 0 && second.observed === 0, second);
  await page.reload();
  await page.waitForSelector("[data-testid='visit-details']", { timeout: 40000 });
  await page.getByRole("tab", { name: "Isabel", exact: true }).click();
  await settle(1200);
  if ((await page.locator("[data-testid='visit-details']").getAttribute("open")) === null) await page.locator("[data-testid='visit-details'] > summary").click();
  await page.waitForSelector("[data-testid='report-en-task-IH7-READ']", { timeout: 20000 });
  check("R4.shown-in-visit-details", (await page.locator("[data-testid='report-en-display-error']").count()) >= 3 && (await page.locator("[data-testid='report-en-parent-observation']").count()) === 3);
  await page.locator("[data-testid='report-en-task-IH7-READ']").scrollIntoViewIfNeeded();
  await shot(page, "report-display-error");
  const ev = await page.evaluate(async () => (await fetch("/api/family/learning/parent/evidence?child=isabel")).json());
  const row = ev.ladder.rows.find((r) => r.id === "i-read");
  const v4 = row.attempts.filter((a) => a.visit === "v4");
  check("R4.ladder-excludes-the-answers", v4.length === 3 && v4.every((a) => a.task.includes("parent-reading-check")), v4.map((a) => a.task));
  check("R4.ladder-counts-with-help-not-own", v4.every((a) => a.level === "with-help"), v4.map((a) => a.level));
  const rows = ev.attempts.filter((a) => /IH[789]-/.test(a.taskId));
  check("R4.original-answers-untouched", rows.length >= 3 && rows.every((a) => typeof a.evidence === "string" && a.answer?.raw));
  await c.close();
}

async function parent() {
  const c = await ctx(await mint("owner"));
  const page = await c.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(`${BASE}/family/learn/parent?child=santiago`);
  await page.waitForSelector("[data-testid='visit-details']", { timeout: 40000 });
  await page.locator("[data-testid='visit-details'] > summary").click();
  await page.waitForSelector("[data-testid='report-en']", { timeout: 20000 });
  const before = await page.locator("[data-testid='report-en-task-helped-here']").count();
  check("D.button-on-tasks", before > 0, before);
  const task = page.locator("[data-testid='report-en-task-P6-EDGE']").first();
  await task.scrollIntoViewIfNeeded();
  await task.locator("[data-testid='report-en-task-helped-here']").click();
  await page.waitForSelector("[data-testid='report-en-task-P6-EDGE'] [data-testid='report-en-task-helped']", { timeout: 15000 });
  check("D.marked-whole-task", (await page.locator("[data-testid='report-en-task-P6-EDGE'] [data-testid='report-en-helped']").count()) >= 1);
  await shot(page, "report-task-helped");
  const ev = await page.evaluate(async () => (await fetch("/api/family/learning/parent/evidence?child=santiago")).json());
  const edge = (ev.attempts ?? []).filter((a) => a.taskId.includes("P6-EDGE/") && a.parentCorrection);
  check("D.original-kept-beside-correction", edge.length > 0 && edge.every((a) => typeof a.evidence === "string"), edge.length);
  check("D.wrong-answer-not-credited", edge.filter((a) => a.correct === false).every((a) => !a.parentCorrection.evidence), edge.map((a) => [a.correct, a.parentCorrection.evidence]));
  await openParentTab(page, "Einstellungen", { exact: true });
  await settle(800);
  const skip = await page.locator("[data-testid='settings-nokt-skip']").count();
  check("C.parent-skip-in-settings", skip === 1, skip);
  if (skip) await page.locator("[data-testid='settings-nokt-skip']").scrollIntoViewIfNeeded();
  await shot(page, "settings-nokt-skip");
  await c.close();
}

const idx = JSON.parse(fs.readFileSync(INDEX, "utf8"));
const THANK_YOU = idx.lines.find((l) => l.text === "Thank you!" && l.slot === "en-female")?.id;
const GRACIAS = idx.lines.find((l) => l.text === "¡Gracias!" && l.slot === "es-female")?.id;

try {
  if (WHO === "isabel") await isabel();
  else if (WHO === "santiago") await santiago(false);
  else if (WHO === "santiago-fail") await santiago(true);
  else if (WHO === "parent") await parent();
  else if (WHO === "map") await mapWelcome();
  else if (WHO === "parent-isabel") await parentIsabel();
} catch (error) {
  check("harness-completed", false, String(error).slice(0, 500));
  const p = browser.contexts()[0]?.pages()[0];
  if (p) await p.screenshot({ path: path.join(OUT, `${WHO}-${PATH}-CRASH.png`) }).catch(() => null);
}
check("no-page-errors", pageErrors.length === 0, pageErrors.slice(0, 4));
check("no-external-requests", external.length === 0, external.slice(0, 4));
await browser.close();
fs.writeFileSync(path.join(OUT, `results-${WHO}-${PATH}.json`), JSON.stringify({ results, clips: { served: clipLog.served.length, unique: new Set(clipLog.served).size, missing: clipLog.missing }, tts: ttsLog.length }, null, 1));
const failed = results.filter((r) => !r.ok);
console.log(`\n${WHO}/${PATH}: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
