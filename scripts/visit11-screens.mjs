#!/usr/bin/env node
// Nov 18: render checks of Santiago Visit 11 «Den Teich füllen» and Isabel Visit 5 «Die Vögel ziehen ein» at 1440 × 780 on
// `next build` + `next start` with SYNTHETIC records (scripts/visit11-seed.mjs), both paths (right first time / wrong first).
// t12 (release build): the same standard as next-visits-screens.mjs after the Nov 18 integration — per-screen narration
// sequence recorder, painted pictures must load, no device voice, every clip a catalogued line (`--fresh` = the whole served
// catalogue, a long `--standin` clip plays for each), Nokt v5 strict writing in the journal (with the v5 stub bridge), the
// microphone check in the writing panel, the visit ends on the learning Home (the map with `--map`).
//   node scripts/visit11-screens.mjs --base http://127.0.0.1:3831 --bridge http://127.0.0.1:3832 --out <dir>
//     --who santiago|isabel|map-s|map-i|after-s|after-i [--path main|wrong] --fresh <catalogue.json> --standin <audio> --clips <dir>
//     [--map] [--roof red|blue|yellow] [--food seeds|berries|worms]
import fs from "node:fs";
import path from "node:path";
import { encode } from "@auth/core/jwt";
import { chromium } from "/Users/claweberle/.npm-global/lib/node_modules/playwright/index.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const BASE = opt("--base", "http://127.0.0.1:3611");
const CLIPS = opt("--clips", "/tmp/visit10/clips");
const OUT = opt("--out", "/tmp/visit10/shots-v10");
const WHO = opt("--who", "isabel");
const PATH = opt("--path", "main");
const FRESH_LINES = JSON.parse(fs.readFileSync(opt("--fresh", "/tmp/visit10/new-catalog.json"), "utf8")).lines;
const FRESH = new Set(FRESH_LINES.map((l) => `${l.slot}/${l.id}`));
const TEXT_OF = new Map(FRESH_LINES.map((l) => [`${l.slot}/${l.id}`, l.text]));
const MAP_START = args.includes("--map");
// --roof: roof colour override + end-picture colour check (t10-verify).
const ROOF_OPT = opt("--roof", null);
// Visit 5 (t12): the end picture is her roof colour (from Visit 4) × her food choice: `birds-<roof>-<food>`.
const FOOD = opt("--food", "worms");
const endArt = async (page, where) => { const ROOF = opt("--roof", "blue"); const r = await page.evaluate(() => [...document.querySelectorAll("img[data-testid='birdhouse-tree-art']")].map((i) => ({ src: i.getAttribute("src"), ok: i.complete && i.naturalWidth > 0 }))); check(`I.end-picture-${where}-is-${ROOF}-roof-with-${FOOD}`, r.length >= 1 && r.every((x) => x.ok && x.src.includes(`birds-${ROOF}-${FOOD}`)), r); };
// The loopback STUB bridge (scripts/visit10-nokt-bridge.mjs) — never the real one.
const BRIDGE = opt("--bridge", "http://127.0.0.1:3299");
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(BRIDGE)) throw new Error("loopback bridge only");
const VIEWPORT = { width: 1440, height: 780 };
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE)) throw new Error("loopback only");
const SECRET = process.env.AUTH_SECRET ?? "fable-world-first-synthetic-secret-0123456789abcdef";
fs.mkdirSync(OUT, { recursive: true });
const COOKIE = "authjs.session-token";
const accounts = [...fs.readFileSync(new URL("./step1-screens.mjs", import.meta.url), "utf8").matchAll(/const (owner|assistant) = await mint\("([^"]+)"\)/g)];
const emailOf = (who) => accounts.find((m) => m[1] === who)[2];
const mint = (who) => encode({ token: { email: emailOf(who), sub: emailOf(who), name: emailOf(who) }, secret: SECRET, salt: COOKIE, maxAge: 7200 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail: detail ?? null });
  console.log(ok ? "PASS" : "FAIL", name, detail === undefined ? "" : JSON.stringify(detail).slice(0, 280));
};
const pageErrors = [];
const clipLog = { real: new Set(), fresh: new Set(), unknown: [] };
const ttsLog = [];
const standIn = opt("--standin", null) ?? fs.readdirSync(CLIPS).map((f) => path.join(CLIPS, f)).find((f) => f.includes("de-female"));
const standInType = standIn.endsWith(".wav") ? "audio/wav" : "audio/mpeg";
const PROBE = `(() => {
  globalThis.__speech = [];
  const s = globalThis.speechSynthesis;
  if (s) {
    try { Object.defineProperty(s, "speak", { configurable: false, value: (u) => { globalThis.__speech.push({ text: u.text, lang: u.lang }); setTimeout(() => u.onend && u.onend(), 30); } }); } catch {}
    try { Object.defineProperty(s, "cancel", { configurable: false, value: () => {} }); } catch {}
    try { Object.defineProperty(s, "getVoices", { configurable: false, value: () => [{ name: "Anna", lang: "de-DE", localService: true }] }); } catch {}
  }
  const proto = HTMLMediaElement.prototype;
  const play = proto.play;
  // Nov 18: the per-screen sequence recorder.
  const ev = (globalThis.__seq = []);
  const now = () => Math.round(performance.now());
  let lastClip = null;
  let ttsN = 0;
  const f = globalThis.fetch;
  globalThis.fetch = function (input, init) {
    const u = String(input && input.url ? input.url : input);
    const pre = "/api/family/learning/narration/";
    const at = u.indexOf(pre);
    if (at >= 0) { lastClip = u.slice(at + pre.length).split("?")[0]; ev.push({ t: now(), e: "fetch", k: lastClip }); }
    // Nokt's live voice (assistant TTS) also plays as a blob: tag it, so it is never counted as a catalogued line.
    if (u.indexOf("/api/family/assistant/tts") >= 0) { lastClip = "tts:" + (++ttsN); ev.push({ t: now(), e: "fetch", k: lastClip }); }
    return f.call(this, input, init);
  };
  let screen = "";
  const screenOf = () => {
    const w = document.querySelector("[data-testid='workshop-scene']");
    if (w) return "scene:" + w.dataset.step + ":" + w.dataset.status;
    const p = document.querySelector("[data-testid='scene-panel']");
    if (p) return "scene:" + p.dataset.step + ":" + p.dataset.status;
    const c = document.querySelector("[data-testid='workshop-closing']");
    if (c) return "closing:" + c.dataset.step;
    if (document.querySelector("[data-testid='workshop-farewell']")) return "farewell";
    if (document.querySelector("[data-testid='debrief']")) return "debrief";
    if (document.querySelector("[data-testid='home-map']")) return "map";
    return location.pathname;
  };
  // Checked synchronously at every clip start and tap (and polled), so a clip is always attributed to the screen it plays on.
  const sync = () => { const s = screenOf(); if (s !== screen) { screen = s; ev.push({ t: now(), e: "screen", k: s }); } };
  proto.play = function () {
    this.muted = true;
    if (String(this.src).startsWith("blob:")) {
      sync();
      if (!this.__seqHooked) {
        this.__seqHooked = true;
        this.addEventListener("ended", () => ev.push({ t: now(), e: "end", k: this.__seqKey }));
        this.addEventListener("pause", () => { if (!this.ended) ev.push({ t: now(), e: "pause", k: this.__seqKey }); });
      }
      this.__seqKey = lastClip;
      ev.push({ t: now(), e: "start", k: lastClip });
    }
    return play.call(this);
  };
  const tap = (e) => { sync(); const el = e.target && e.target.closest ? e.target.closest("[data-testid]") : null; ev.push({ t: now(), e: "tap", k: el ? el.dataset.testid : "?" }); };
  addEventListener("pointerdown", tap, true);
  addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") tap(e); }, true);
  setInterval(sync, 40);
  // Nokt's microphone: when the recorder really started and first delivered audio, and when the child was told to speak.
  globalThis.__mic = [];
  const MR = globalThis.MediaRecorder;
  if (MR) {
    const mic = globalThis.__mic;
    const start = MR.prototype.start;
    MR.prototype.start = function (...a) {
      mic.push({ t: performance.now(), e: "start-called", slice: a[0] ?? null });
      this.addEventListener("start", () => mic.push({ t: performance.now(), e: "start-event" }));
      let first = true;
      this.addEventListener("dataavailable", (d) => { if (first && d.data && d.data.size > 0) { first = false; mic.push({ t: performance.now(), e: "first-data", size: d.data.size }); } });
      return start.apply(this, a);
    };
    let shown = { wait: false, live: false };
    setInterval(() => {
      const w = !!document.querySelector("[data-testid='nokt-mic-wait']");
      const l = !!document.querySelector("[data-testid='nokt-mic-live']");
      if (w && !shown.wait) mic.push({ t: performance.now(), e: "ui-wait", text: document.querySelector("[data-testid='nokt-mic-wait']").innerText });
      if (l && !shown.live) mic.push({ t: performance.now(), e: "ui-live", text: document.querySelector("[data-testid='nokt-mic-live']").innerText });
      shown = { wait: w, live: l };
    }, 5);
  }
})();`;
// PW_CHROMIUM: an already-installed browser binary when Playwright's expected build is not cached (nothing is downloaded).
const browser = await chromium.launch({ headless: true, ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}), args: ["--mute-audio", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=user-gesture-required"] });
const external = [];
async function ctx(who) {
  const c = await browser.newContext({ viewport: VIEWPORT, locale: "de-CH", timezoneId: "Europe/Zurich" });
  await c.addInitScript(PROBE);
  await c.route("**/*", async (r) => {
    const u = new URL(r.request().url());
    if (u.origin !== BASE && u.origin !== BRIDGE) {
      external.push(`${u.origin}${u.pathname}`);
      return r.abort("blockedbyclient");
    }
    const clip = /\/api\/family\/learning\/narration\/([a-z-]+)\/([A-Za-z0-9_-]+)$/.exec(u.pathname);
    if (clip) {
      const key = `${clip[1]}/${clip[2]}`;
      const real = path.join(CLIPS, `${clip[1]}_${clip[2]}.mp3`);
      if (fs.existsSync(real)) {
        clipLog.real.add(key);
        return r.fulfill({ status: 200, contentType: "audio/mpeg", body: fs.readFileSync(real), headers: { "cache-control": "private, no-cache" } });
      }
      if (FRESH.has(key)) {
        clipLog.fresh.add(key);
        return r.fulfill({ status: 200, contentType: standInType, body: fs.readFileSync(standIn), headers: { "cache-control": "private, no-cache" } });
      }
      clipLog.unknown.push(key);
      return r.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    }
    if (u.pathname === "/api/family/assistant/tts") {
      try { ttsLog.push(JSON.parse(r.request().postData() ?? "{}").text ?? ""); } catch {}
      return r.fulfill({ status: 200, contentType: standInType, body: fs.readFileSync(standIn) });
    }
    return r.continue();
  });
  await c.addCookies([{ name: COOKIE, value: await mint(who), url: BASE }]);
  await c.grantPermissions(["microphone"], { origin: BASE });
  return c;
}

// ---------------------------------------------------------------------------------------------------------------------
// Nov 18: the sequence checks over the recorded events of one page
// ---------------------------------------------------------------------------------------------------------------------
const seqEvents = [];
const keepSeq = async (page) => { try { seqEvents.push(...(await page.evaluate(() => globalThis.__seq.splice(0)))); } catch { /* page gone */ } };
function sequenceChecks(label, expect = {}) {
  const ev = seqEvents;
  const text = (k) => TEXT_OF.get(k) ?? k;
  const cut = [];
  const twice = [];
  let playing = null; // { k, t, tapped }
  let screen = "";
  let screenStarts = new Map(); // key -> tapped since?
  let tappedSinceScreen = false;
  const perScreen = [];
  let cur = { screen: "", starts: [] };
  let starts = 0;
  let ends = 0;
  const interrupt = (why, t) => {
    if (playing && !playing.tapped) cut.push(`${screen}: «${text(playing.k)}» cut by ${why} after ${t - playing.t} ms without a tap`);
    playing = null;
  };
  for (const e of ev) {
    if (e.e === "tap") {
      if (playing) playing.tapped = true;
      tappedSinceScreen = true;
      for (const k of screenStarts.keys()) screenStarts.set(k, true);
    } else if (e.e === "start") {
      starts += 1;
      if (playing) interrupt(`the next clip «${text(e.k)}»`, e.t);
      if (!String(e.k).startsWith("tts:") && screenStarts.has(e.k) && screenStarts.get(e.k) === false) twice.push(`${screen}: «${text(e.k)}» started twice without a tap`);
      screenStarts.set(e.k, false);
      playing = { k: e.k, t: e.t, tapped: false };
      cur.starts.push(e.k);
    } else if (e.e === "end") {
      ends += 1;
      if (playing && playing.k === e.k) playing = null;
    } else if (e.e === "pause") {
      if (playing && playing.k === e.k) interrupt("a pause", e.t);
    } else if (e.e === "screen") {
      if (playing && !playing.tapped) cut.push(`«${text(playing.k)}» still playing when the screen changed ${screen} → ${e.k} without a tap`);
      if (playing) playing.screenChanged = true;
      screen = e.k;
      screenStarts = new Map();
      tappedSinceScreen = false;
      cur = { screen: e.k, starts: [] };
      perScreen.push(cur);
    }
  }
  check(`${label}.SEQ.no-line-cut-without-a-tap`, cut.length === 0, cut.slice(0, 6));
  check(`${label}.SEQ.each-line-once-per-screen`, twice.length === 0, twice.slice(0, 6));
  const startedTexts = ev.filter((e) => e.e === "start").map((e) => text(e.k));
  const endedTexts = ev.filter((e) => e.e === "end").map((e) => text(e.k));
  for (const [step, first] of Object.entries(expect.opening ?? {})) {
    const seg = perScreen.find((x) => x.screen === `scene:${step}:active` && x.starts.length);
    check(`${label}.SEQ.opening-line-starts.${step}`, !!seg && text(seg.starts[0]) === first, seg ? text(seg.starts[0]) : "no clip on this screen");
  }
  for (const t of expect.heard ?? []) check(`${label}.SEQ.line-heard-to-its-end «${t}»`, startedTexts.includes(t) && endedTexts.includes(t), { started: startedTexts.filter((x) => x === t).length, ended: endedTexts.filter((x) => x === t).length });
  for (const [t, n] of Object.entries(expect.exactly ?? {})) check(`${label}.SEQ.said-exactly-${n}x «${t}»`, startedTexts.filter((x) => x === t).length === n, startedTexts.filter((x) => x === t).length);
  seqCounts[label] = { screens: perScreen.length, clipStarts: starts, clipEnds: ends, cut: cut.length, twice: twice.length };
}
const seqCounts = {};
const micTimings = [];
let n = 0;
const shot = async (page, name) => { n += 1; await page.screenshot({ path: path.join(OUT, `${WHO}${PATH === "main" ? "" : "-" + PATH}-${String(n).padStart(2, "0")}-${name}.png`) }); };
const saved = (page) => page.waitForResponse((r) => r.url().includes("/api/family/learning/mission") && r.request().method() === "PUT", { timeout: 20000 });
let picturesSeen = 0;
async function pictures(page, label) {
  const r = await page.evaluate(() => ({
    out: [...document.querySelectorAll("svg[data-picture]")].map((e) => { const b = e.getBBox(); const c = e.getBoundingClientRect(); return { id: e.dataset.picture, kids: e.querySelectorAll("*").length, w: Math.round(b.width), h: Math.round(b.height), on: c.width > 0 && c.height > 0 }; }),
    imgs: [...document.querySelectorAll("[data-testid='harvest-table-art'], [data-testid='scene-portrait'] img, img[data-art]")].map((i) => ({ s: i.getAttribute("src"), n: i.complete ? i.naturalWidth : 0 })),
  }));
  // Nov 18: a painted picture is an `svg[data-picture]` with one `<image>`; its box exists even when the file is missing, so the
  // file itself must load and decode (same session, same URL) or the picture counts as empty.
  r.imgs.push(...(await rasterPictures(page)));
  picturesSeen += r.out.length;
  const bad = r.out.filter((p) => !p.kids || !p.w || !p.h || !p.on);
  const badI = r.imgs.filter((i) => !i.n);
  await scan(page, label);
  check(`PIC.${label}`, !bad.length && !badI.length, bad.length || badI.length ? { bad, badI } : { n: r.out.length });
}
async function rasterPictures(page) {
  return page.evaluate(() => Promise.all([...document.querySelectorAll("svg[data-picture][data-raster]")].map((e) => new Promise((done) => {
    const src = e.dataset.raster;
    const img = new Image();
    img.onload = () => done({ s: src, n: img.naturalWidth, id: e.dataset.picture });
    img.onerror = () => done({ s: src, n: 0, id: e.dataset.picture });
    img.src = src;
  }))));
}
/** No tech word on any child screen (the fictional-mode banner of the test server is not a child line). */
async function scan(page, label) {
  const t = await page.evaluate(() => (document.querySelector("[data-testid='mission-screen']") ?? document.body).innerText);
  const hit = t.replace(/Testmodus[^\n]*/g, "").match(/[^\n]*(gespeichert|Aufgabe|Modus|Version)[^\n]*/i);
  check(`W.${label}`, !hit, hit ? hit[0].slice(0, 120) : undefined);
}
async function fold(page, label) {
  await settle(200);
  const r = await page.evaluate(() => {
    const els = [...document.querySelectorAll("[data-fold]")].filter((e) => e.offsetParent !== null && getComputedStyle(e).visibility !== "hidden");
    const out = els.filter((e) => { const b = e.getBoundingClientRect(); return b.top < 0 || b.bottom > innerHeight; }).map((e) => ({ f: e.dataset.fold, b: Math.round(e.getBoundingClientRect().bottom) }));
    return { y: Math.round(scrollY), n: els.length, out };
  });
  check(`F.${label}`, r.n > 0 && !r.out.length && r.y === 0, r.out.length ? r : undefined);
}
const textOf = async (page, sel) => ((await page.locator(sel).first().innerText()) ?? "").replace(/\s+/g, " ").trim();
const noModal = async (page, label) => check(`NOMODAL.${label}`, (await page.locator("[data-testid='nokt-modal'], [aria-modal='true']").count()) === 0);
const speechTexts = (page) => page.evaluate(() => globalThis.__speech.map((x) => x.text)).catch(() => []);
const voiceChecks = async (page, who) => {
  const speech = await speechTexts(page);
  check(`${who}.no-device-voice`, speech.length === 0, speech.slice(0, 5));
  check(`${who}.every-line-in-a-catalogue`, clipLog.unknown.length === 0, clipLog.unknown.slice(0, 5));
};

const sel = (page, s) => page.locator(s);
const TURTLE = opt("--turtle", "Flip");
async function santiago() {
  const wrong = PATH === "wrong";
  const c = await ctx("assistant");
  const page = await c.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  const banner = async (label) => {
    const r = await page.evaluate(() => ({ banner: !!document.querySelector("[data-testid='scene-banner']"), turtle: !!document.querySelector("[data-testid='scene-companion']") }));
    check(`B.${label}`, r.banner && r.turtle, r);
  };
  const goTo = async (step) => {
    await page.waitForSelector(`[data-testid='go-${step}'], [data-testid='scene-panel'][data-step='${step}']`, { timeout: 25000 });
    if (await sel(page, `[data-testid='scene-panel'][data-step='${step}']`).count()) {
      // Entered from the map: the opening scene is already open.
      await settle(350);
      await pictures(page, `${step}.open`);
      await banner(step);
      return;
    }
    const b = sel(page, `[data-testid='go-${step}']`);
    if ((await b.innerText()).includes("Hingehen")) {
      await b.click();
      await page.waitForFunction((s) => document.querySelector(`[data-testid='go-${s}']`)?.textContent?.includes("Starten"), step, { timeout: 25000 });
    }
    await sel(page, `[data-testid='go-${step}']`).click();
    await page.waitForSelector(`[data-testid='scene-panel'][data-step='${step}']`, { timeout: 20000 });
    await settle(350);
    await pictures(page, `${step}.open`);
    if (step !== "F10-TYPING" && step !== "F11-JOURNAL") await banner(step);
  };
  const leave = async () => {
    await page.waitForFunction(() => { const b = document.querySelector("[data-testid='scene-continue']"); return b && !b.disabled; }, null, { timeout: 40000 });
    await sel(page, "[data-testid='scene-continue']").click();
    await page.waitForSelector("[data-testid='scene-panel']", { state: "detached", timeout: 15000 });
    await settle(250);
  };
  const story = async () => {
    await page.waitForFunction(() => { const b = document.querySelector("[data-testid='story-done']"); return b && !b.disabled; }, null, { timeout: 40000 });
    await sel(page, "[data-testid='story-done']").click();
    await settle(400);
    await leave();
  };
  const part = async (v) => {
    const nq = sel(page, "[data-testid='solve-next-question']");
    if (await nq.count()) await nq.click();
    await sel(page, "[data-testid='part-input']").fill(String(v));
    const d = saved(page);
    await sel(page, "[data-testid='part-check']").click();
    await d;
    await settle(400);
  };
  const pick = async (qid, option) => {
    const s = `[data-testid='pick-${qid}-${option}']`;
    await page.waitForFunction((x) => { const b = document.querySelector(x); return b && !b.disabled; }, s, { timeout: 20000 });
    const d = saved(page);
    await sel(page, s).click();
    await d;
    await settle(400);
  };
  const listen = async () => {
    await page.waitForFunction(() => { const b = document.querySelector("[data-testid='listen-play']"); return b && !b.disabled; }, null, { timeout: 40000 });
    await sel(page, "[data-testid='listen-play']").first().click();
    await settle(500);
    await page.waitForFunction(() => { const b = document.querySelector("[data-testid='listen-play']"); return b && !b.disabled; }, null, { timeout: 60000 });
    await settle(300);
  };
  const lineIdle = () => page.waitForFunction(() => document.querySelector("[data-testid='scene-line-replay']")?.dataset.state === "idle", null, { timeout: 40000 });
  const request = async (text) => {
    await sel(page, "[data-testid='request-input']").fill(text);
    const d = saved(page);
    await sel(page, "[data-testid='request-send']").click();
    await d;
    await settle(500);
  };
  const reveal = async () => { const b = sel(page, "[data-testid='listen-reveal-next']"); if (await b.count()) { await b.click(); await settle(250); } };
  const closeNokt = async () => { const dock = sel(page, "[data-testid='nokt-close'], [data-testid='nokt-dock-close']"); if (await dock.count()) { await dock.first().click(); await settle(300); } };
  const decide = async (id) => { const d = saved(page); await sel(page, `[data-testid='decide-pick-${id}']`).click(); await d; await settle(400); };

  // As the Nov 8 harness: start from the cockpit (server without FAMILY_HOME_MAP); the map checks run separately.
  await page.goto(`${BASE}/family/learn?child=santiago`);
  await page.waitForSelector("[data-testid='cockpit-start'], [data-testid='start-visit']", { timeout: 30000 });
  if (await sel(page, "[data-testid='cockpit-start']").count()) await sel(page, "[data-testid='cockpit-start']").click();
  await page.waitForSelector("[data-testid='start-visit']", { timeout: 15000 });
  check("S.start-is-visit-11", (await sel(page, "[data-testid='start-visit']").getAttribute("data-visit")) === "v12");
  await shot(page, "start-visit-11");
  await sel(page, "[data-testid='start-visit']").click();
  await page.waitForSelector("[data-testid='nokt-sidebar'][data-dock='welcome'], [data-testid='scene-panel']", { timeout: 25000 });
  if (await sel(page, "[data-testid='nokt-sidebar'][data-dock='welcome']").count()) {
    await page.waitForFunction(() => document.querySelector("[data-testid='nokt-welcome']")?.dataset.waiting === "false" && document.querySelectorAll("[data-testid='nokt-welcome'] li").length > 0, null, { timeout: 40000 });
    await sel(page, "[data-testid='nokt-dock-close']").click();
    await settle(300);
  }

  await goTo("F1-POND");
  await fold(page, "F1");
  await shot(page, "F1-rosa-empty-pond");
  await lineIdle();
  await story();
  await goTo("F1R-RADIO");
  await shot(page, "F1R-dr-mateo-sea-water");
  await lineIdle();
  check("S.mateo-spoke-with-es-male", [...clipLog.real, ...clipLog.fresh].some((k) => k.startsWith("es-male/")));
  await story();

  await goTo("F2-AROUND");
  if (wrong) await part(9);
  await part(18);
  await leave();
  await goTo("F2C-STONES");
  await part(12);
  await leave();
  await goTo("F2S-PIEDRAS");
  await lineIdle();
  check("S.word-list-locked-before-a-try", (await sel(page, "[data-testid='hint-open']").count()) === 0);
  await shot(page, "F2S-piedras-from-memory");
  if (wrong) {
    await request("Necesitamos una cosa");
    check("S.word-list-after-one-miss", (await sel(page, "[data-testid='hint-open']").count()) === 1);
  }
  await request("Necesitamos piedras");
  await leave();

  await goTo("F3-TANK");
  await shot(page, "F3-tank-question-from-nov-8");
  if (wrong) await part(14);
  await part(24);
  await part(5);
  await leave();
  if (wrong) { await goTo("F3E-BARREL"); await part(6); await leave(); }
  else { await goTo("F3H-SUMMER"); await shot(page, "F3H-summer"); await part(36); await part(3); await leave(); }

  await goTo("F4-MATEO");
  await listen();
  await pictures(page, "F4.after-play");
  await shot(page, "F4-depth-pictures");
  if (wrong) { await pick("deep", "1 m tief"); await pick("deep", "50 cm tief"); await reveal(); }
  else await pick("deep", "10 cm tief");
  await leave();
  if (wrong) { await goTo("F4E-DIEZ"); await listen(); await pick("deep", "10 cm tief"); await leave(); }
  else { await goTo("F4H-LATER"); await listen(); await pictures(page, "F4H.after-play"); await pick("now", "10 cm tief"); await pick("later", "20 cm tief"); await leave(); }

  await goTo("F5-LITERS");
  await shot(page, "F5-liters");
  if (wrong) await part(120);
  await part(1200);
  await leave();
  if (wrong) { await goTo("F5E-TWO"); await part(240); await leave(); } else { await goTo("F5H-LATER"); await part(2400); await leave(); }
  await goTo("F6-BUCKETS");
  if (wrong) await part(12);
  await part(120);
  await leave();
  if (wrong) { await goTo("F6E-BUCKETS-SMALL"); await part(24); await leave(); } else { await goTo("F6H-BIG-BUCKET"); await part(100); await leave(); }

  await goTo("F7-BOMBA");
  await lineIdle();
  await shot(page, "F7-order-the-pump");
  await request("Necesitamos una bomba");
  await shot(page, "F7-rosa-gives-the-pump");
  await leave();

  await goTo("F7J-SPOT");
  await shot(page, "F7J-three-spots");
  if (wrong) {
    await decide("b");
    await decide("c");
    await page.waitForSelector("[data-testid='nokt-sidebar'][data-dock='visit']", { timeout: 15000 });
    await settle(1200);
    await shot(page, "F7J-nokt-after-two-wrong");
    await closeNokt();
  }
  await decide("a");
  await leave();

  await goTo("F8-PUMP");
  if (wrong) await part(120);
  await part(12);
  await leave();
  if (wrong) { await goTo("F8E-PUMP-SHORT"); await part(3); await leave(); } else { await goTo("F8H-PUMP-LATER"); await part(24); await leave(); }

  await goTo("F9-JUNE");
  await listen();
  await pictures(page, "F9.after-play");
  await shot(page, "F9-june-pump-and-hose");
  if (wrong) await pick("pump", "Vor die Felsen");
  await pick("pump", "Hinter die Felsen");
  await pick("hose", "Über den Sand");
  await leave();
  if (!wrong) { await goTo("F9H-NET"); await listen(); await pictures(page, "F9H.after-play"); await pick("net", "Vor die Pumpe"); await leave(); }

  await goTo("F10-TYPING");
  await sel(page, "[data-testid='typing-start']").click();
  await page.waitForFunction(() => document.querySelector("[data-testid='typing-block']")?.dataset.phase !== "not-started", null, { timeout: 15000 }).catch(() => null);
  const firstPhase = await sel(page, "[data-testid='typing-block']").first().getAttribute("data-phase");
  await shot(page, `F10-typing-${firstPhase}`);
  const typedLines = [];
  for (let guard = 0; guard < 60; guard += 1) {
    await settle(300);
    const phase = await sel(page, "[data-testid='typing-block']").first().getAttribute("data-phase");
    if (phase === "comfort") { await sel(page, "[data-testid='comfort-easy']").click(); continue; }
    if (phase === "extra-offer") { await sel(page, "[data-testid='extra-decline']").click(); continue; }
    if (phase !== "drill") break;
    const lines = await sel(page, "[data-testid='typing-block'] p.font-mono").allInnerTexts();
    for (const line of lines) {
      typedLines.push(line.replace(/\s+/g, " ").trim());
      await sel(page, "[data-testid='typing-input']").type(line.replace(/\s+/g, " ").trim(), { delay: 4 });
      await page.keyboard.press("Enter");
      await settle(80);
    }
  }
  check("S.typing-drills-ran", typedLines.length >= 8, { typed: typedLines.length, firstPhase });
  check("S.no-repeated-drill-line", new Set(typedLines).size === typedLines.length, typedLines.length);
  await page.waitForSelector("[data-testid='scene-continue']", { timeout: 25000 });
  await leave();

  await goTo("F11-JOURNAL");
  await sel(page, "[data-testid='write-input']").fill("Heute haben wir den Teich mit Meerwasser gefuellt. Die Pumpe hat 12 Minuten gebraucht.");
  { const d = saved(page); await sel(page, "[data-testid='write-send']").click(); await d; }
  // Nokt's writing talk is the Nokt tracks' area (strict writing step, merged separately); here only: the step completes.
  const noktWriting = await page.waitForSelector("[data-testid='nokt-sidebar'][data-dock='writing']", { timeout: 10000 }).then(() => true).catch(() => false);
  if (noktWriting) {
    await page.waitForFunction(() => document.querySelector("[data-testid='nokt-writing']")?.dataset.waiting === "false" && document.querySelectorAll("[data-testid='nokt-writing'] li[data-role='nokt']").length >= 1, null, { timeout: 40000 }).catch(() => null);
    await settle(400);
    await shot(page, "F11-nokt-reads");
    if (await sel(page, "[data-testid='nokt-talk-input']").count()) { await sel(page, "[data-testid='nokt-talk-input']").fill("Das Wort Pumpe"); await sel(page, "[data-testid='nokt-talk-send']").click(); }
  }
  check("S.nokt-writing-panel-opened", noktWriting);
  await noModal(page, "writing");
  // Nokt v5 strict writing (t8): no «So lassen»; he rewrites until it is right, then the step is done (as next-visits T10).
  await page.waitForSelector("[data-testid='write-keep'], [data-testid='write-strict']", { timeout: 40000 });
  check("S.strict-writing-step", (await sel(page, "[data-testid='write-strict']").count()) === 1 && (await sel(page, "[data-testid='write-keep']").count()) === 0);
  if (await sel(page, "[data-testid='write-strict']").count()) {
    await micCheck(page, "nokt-writing");
    await page.waitForFunction(() => document.querySelector("[data-testid='nokt-writing']")?.dataset.waiting === "false" && document.querySelectorAll("[data-testid='nokt-writing'] li[data-role='nokt']").length >= 3, null, { timeout: 40000 });
    await page.waitForSelector("[data-testid='write-strict'][data-pending='false']", { timeout: 40000 });
    await settle(600);
    await sel(page, "[data-testid='write-revise']").fill("Heute haben wir den Teich mit Meerwasser gefüllt. Die Pumpe hat 12 Minuten gebraucht.");
    { const d = saved(page).catch(() => null); await sel(page, "[data-testid='write-revise-send']").click(); await d; }
    await page.waitForSelector("[data-testid='write-done']", { timeout: 40000 });
    check("S.strict-writing-done-after-the-right-version", true);
    check("S.strict-writing-no-stale-notice", !(await page.locator("body").innerText()).includes("neuerer Stand"));
    await settle(800);
  }
  for (let i = 0; i < 4 && (await sel(page, "[data-testid='write-keep']").count()); i += 1) {
    const d = saved(page).catch(() => null); await sel(page, "[data-testid='write-keep']").click(); await d; await settle(1200);
  }
  await shot(page, "F11-after-writing");
  await leave();

  await goTo("F12-END");
  check("S.name-in-the-end-line", (await textOf(page, "[data-testid='scene-banner']")).includes(TURTLE), await textOf(page, "[data-testid='scene-banner']"));
  await sel(page, "[data-testid='story-done']").click();
  await settle(500);
  check("S.home-task", (await textOf(page, "[data-testid='home-task']")).includes("Liter"));
  { const r = await page.evaluate(() => [...document.querySelectorAll("img[data-testid='outcome-art']")].map((i) => ({ src: i.getAttribute("src"), ok: i.complete && i.naturalWidth > 0 })));
    check("S.end-picture-flip-in-the-pond", r.length === 1 && r[0].ok && r[0].src.includes("pond-flip"), r); }
  await shot(page, "F12-water-in-the-pond");
  await leave();

  await page.waitForSelector("[data-testid='mission-finish']", { timeout: 20000 });
  await sel(page, "[data-testid='mission-finish']").click();
  await page.waitForSelector("[data-testid='debrief']", { timeout: 20000 });
  await settle(300);
  check("S.end-asks-first", (await textOf(page, "[data-testid='debrief-row-difficulty']")).includes("Wie leicht war es?"));
  await sel(page, "[data-testid='difficulty-easy']").click();
  await settle(800);
  // Nokt's look-back (stub), then the picture choice; answer whatever is asked until the finish button is there.
  for (let guard = 0; guard < 12; guard += 1) {
    if (await sel(page, "[data-testid='adventure-crabs']").count()) {
      await pictures(page, "end-picture-choice");
      const labels = await sel(page, "[data-testid='next-adventure'] [role='group'] button").allInnerTexts();
      check("S.end-picture-choice-one-word", labels.length >= 3 && labels.slice(0, 3).every((l) => l.trim().split(/\s+/).length === 1), labels);
      await shot(page, "end-picture-choice");
      await sel(page, "[data-testid='adventure-crabs']").click();
      await settle(300);
    }
    const fin = sel(page, "[data-testid='debrief-finish']");
    if ((await fin.count()) && !(await fin.isDisabled())) break;
    const input = sel(page, "[data-testid='nokt-debrief'] [data-testid='nokt-talk-input']");
    if ((await input.count()) && (await page.evaluate(() => document.querySelector("[data-testid='nokt-debrief']")?.dataset.waiting === "false"))) {
      await input.fill("Die Pumpe");
      await sel(page, "[data-testid='nokt-debrief'] [data-testid='nokt-talk-send']").click();
    }
    await settle(2500);
  }
  await page.waitForSelector("[data-testid='debrief-finish']", { timeout: 45000 });
  check("S.cliffhanger", (await textOf(page, "[data-testid='debrief-cliffhanger']")).includes("Meeresschildkröte"), await textOf(page, "[data-testid='debrief-cliffhanger']").catch(() => ""));
  await scan(page, "S.end");
  await shot(page, "end-cliffhanger");
  await sel(page, "[data-testid='debrief-finish']").click();
  await page.waitForURL((u) => u.pathname !== "/family/learn/mission", { timeout: 25000 });
  const endUrl = new URL(page.url());
  check("S.MIC.checked-once-at-least", micTimings.length >= 1, micTimings.length);
  check("S.end-lands-on-the-learning-home", endUrl.pathname === "/family/learn" && endUrl.searchParams.get("child") === "santiago", endUrl.pathname + endUrl.search);
  await page.waitForSelector("[data-testid='home-map'], [data-testid='world-screen'], [data-testid='start-visit']", { timeout: 40000 }).catch(() => null);
  await settle(1500);
  await shot(page, "end-on-the-map");
  check("S.visit-finished", true, page.url());
  await keepSeq(page);
  await voiceChecks(page, "S");
  sequenceChecks("S");
  await c.close();
}

async function isabel() {
  const wrong = PATH === "wrong";
  const c = await ctx("assistant");
  const page = await c.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  // The home map leads into the visit (`--map`): the tap on the map is the deliberate start, then the scene opens by itself.
  await page.goto(`${BASE}/family/learn?child=isabel`);
  if (MAP_START) {
    await page.waitForSelector("[data-testid='home-map']", { timeout: 40000 });
    await settle(1500);
    await page.mouse.click(5, 300);
    await page.goto(`${BASE}/family/learn/mission?child=isabel&enter=birdhouse`).catch(() => null);
  } else {
    await page.waitForSelector("[data-testid='cockpit-start'], [data-testid='start-visit']", { timeout: 30000 });
    if (await sel(page, "[data-testid='cockpit-start']").count()) await sel(page, "[data-testid='cockpit-start']").click();
    await page.waitForSelector("[data-testid='start-visit']", { timeout: 15000 });
    await sel(page, "[data-testid='start-visit']").click();
  }
  const idle = () => page.waitForFunction(() => document.querySelector("[data-testid='workshop-scene']")?.dataset.narration !== "speaking", null, { timeout: 90000 });
  const onStep = async (s) => {
    await page.waitForSelector(`[data-testid='workshop-scene'][data-step='${s}']`, { timeout: 30000 });
    await settle(250);
    await pictures(page, `${s}.open`);
    check(`B.${s}.robins-and-ida`, (await sel(page, "[data-testid='scene-companion']").count()) === 1 && (await sel(page, "[data-testid='gardener-portrait']").count()) >= 1);
  };
  // t6: a story/outcome beat takes two taps (finish it — its done line is said — then leave): tap until the wanted beat is open.
  const next = async (step) => {
    for (let i = 0; i < 3; i += 1) {
      await idle();
      await page.waitForFunction(() => { const b = document.querySelector("[data-testid='workshop-next']"); return b && !b.disabled; }, null, { timeout: 90000 });
      const d = saved(page);
      await sel(page, "[data-testid='workshop-next']").first().click();
      await d;
      await settle(600);
      if (!step || (await sel(page, `[data-testid='workshop-scene'][data-step='${step}']`).count())) break;
    }
    if (step) await onStep(step);
  };
  const ipart = async (v) => {
    await idle();
    const nq = sel(page, "[data-testid='solve-next-question']");
    if (await nq.count()) { await nq.click(); await settle(250); await idle(); }
    await sel(page, "[data-testid='part-input']").fill(String(v));
    const d = saved(page);
    await sel(page, "[data-testid='part-check']").click();
    await d;
    await settle(350);
  };
  const pick = async (q, o) => {
    await idle();
    const s = `[data-testid='pick-${q}-${o}']`;
    await page.waitForFunction((x) => { const b = document.querySelector(x); return b && !b.disabled; }, s, { timeout: 20000 });
    const d = saved(page);
    await sel(page, s).click();
    await d;
    await settle(350);
  };
  const bags = async (label) => {
    const r = await page.evaluate(() => ({ closed: document.querySelectorAll("[data-part='closed-bundle']").length, sticks: document.querySelectorAll("[data-testid='counters'] [data-part='loose'] rect").length }));
    check(`I.seed-bags.${label}`, r.closed > 0 && r.sticks === 0, r);
  };
  await onStep("IF1-HELLO");
  await fold(page, "IF1");
  await shot(page, "IF1-robins-moved-in");
  await next("IF2-WARM");
  await bags("IF2");
  await shot(page, "IF2-seed-bags");
  if (wrong) { await ipart(73); await ipart(37); await next("IF2E-WARM-EASY"); await ipart(14); await next("IF2N-NEST"); }
  else { await ipart(37); await next("IF2N-NEST"); }
  await shot(page, "IF2N-read-NEST");
  if (wrong) { await pick("word", "Haus"); check("I.letters-after-a-miss", (await sel(page, "[data-testid='read-letters-open']").count()) === 1); }
  await pick("word", "Nest");
  await next("IF3-SEEDS");
  await shot(page, "IF3-25-or-52");
  if (wrong) { await ipart(25); await ipart(52); await next("IF3E-SEEDS-EASY"); await ipart(12); await next("IF4-MORE"); }
  else { await ipart(52); await next("IF4-MORE"); }
  await shot(page, "IF4-how-many-more");
  { const r = await page.evaluate(() => ({ frame: document.querySelectorAll("[data-testid='counters'][data-frame='30']").length, emptyBag: document.querySelectorAll("[data-part='empty-bundle']").length, sticks: document.querySelectorAll("[data-testid='counters'] svg[viewBox='0 0 10 80']").length }));
    check("I.how-many-more-frame-with-bags", r.frame === 1 && r.emptyBag === 1 && r.sticks === 0, r); }
  if (wrong) { await ipart(20); await ipart(10); await next("IF4E-MORE-EASY"); await ipart(2); await next("IF5-AWAY"); }
  else { await ipart(10); await next("IF4H-MORE-HARD"); await ipart(6); await next("IF5-AWAY"); }
  await shot(page, "IF5-birds-peck");
  if (wrong) { await ipart(20); await ipart(10); await next("IF5E-AWAY-EASY"); await ipart(4); await next("IF6-FUTTER"); }
  else { await ipart(10); await next("IF5H-AWAY-MORE"); await ipart(8); await next("IF6-FUTTER"); }
  await shot(page, "IF6-read-FUTTER");
  await pick("word", "Futter");
  await next("IF7-LISTEN");
  await idle();
  await sel(page, "[data-testid='listen-play']").first().click();
  await settle(700);
  await idle();
  await page.waitForFunction(() => { const b = document.querySelector("[data-testid='listen-play']"); return b && !b.disabled; }, null, { timeout: 40000 });
  await pictures(page, "IF7.after-play");
  await shot(page, "IF7-listen-four-pictures");
  if (wrong) await pick("show", "Blaue Schale, auf dem Brett, beim Haus");
  await pick("show", "Rote Schale, auf dem Brett, beim Haus");
  await next("IF8-FOOD");
  await shot(page, "IF8-food-choice");
  { await idle(); const d = saved(page); await sel(page, `[data-testid='make-${FOOD}']`).click(); await d; await settle(350); }
  await next("IF9-EI");
  await shot(page, "IF9-read-EI");
  if (wrong) await pick("word", "Eis");
  await pick("word", "Ei");
  await next("IF10-HOME");
  await idle();
  check("I.home-task", (await textOf(page, "[data-testid='home-task']")).includes("Vögel"));
  await endArt(page, "IF10");
  await shot(page, "IF10-birds-at-home");
  await next(null);
  if (await sel(page, "[data-testid='workshop-next']").count()) await next(null);
  await page.waitForSelector("[data-testid='workshop-closing']", { timeout: 30000 });
  const cidle = () => page.waitForFunction(() => document.querySelector("[data-testid='workshop-closing']")?.dataset.narration !== "speaking", null, { timeout: 60000 });
  await cidle();
  check("I.end-asks-wie-war-es-heute", (await textOf(page, "[data-testid='closing-question']")).includes("Wie war es heute?"), await textOf(page, "[data-testid='closing-question']"));
  await sel(page, "[data-testid='difficulty-easy']").click();
  await settle(500);
  await cidle();
  await pictures(page, "closing-liked");
  await shot(page, "closing-what-she-liked");
  await sel(page, "[data-testid='liked-seeds']").click();
  await settle(500);
  await page.waitForFunction(() => document.querySelector("[data-testid='workshop-closing']")?.dataset.step === "next", null, { timeout: 15000 });
  await cidle();
  await pictures(page, "closing-next");
  const labels = await sel(page, "[data-testid='closing-next'] [role='group'] button").allInnerTexts();
  check("I.next-picture-choice-one-word", labels.length >= 3 && labels.every((l) => l.replace(/[^\p{L} ]/gu, "").trim().split(/\s+/).length === 1) && labels.some((l) => l.includes("Wolle")), labels);
  await shot(page, "closing-next-picture-choice");
  await sel(page, "[data-testid='closing-next'] [role='group'] button").first().click();
  await settle(200);
  await page.waitForFunction(() => { const b = document.querySelector("[data-testid='closing-finish']"); return b && !b.disabled; }, null, { timeout: 40000 });
  await sel(page, "[data-testid='closing-finish']").click();
  await page.waitForSelector("[data-testid='workshop-farewell']", { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector("[data-testid='workshop-farewell']")?.dataset.narration !== "speaking", null, { timeout: 40000 });
  // t6: the cliffhanger is said on the outcome beat only; the goodbye says only the visit's own line.
  check("I.farewell-without-a-second-cliffhanger", !(await textOf(page, "[data-testid='workshop-farewell']")).includes("Ob bald noch mehr kommen?"));
  check("I.farewell-wording", (await textOf(page, "[data-testid='workshop-farewell']")).includes("Die Vögel haben jetzt Futter. Bis bald!"));
  await pictures(page, "farewell");
  await endArt(page, "farewell");
  await shot(page, "farewell");
  await page.waitForFunction(() => { const b = document.querySelector("[data-testid='farewell-home']"); return b && !b.disabled; }, null, { timeout: 30000 });
  await sel(page, "[data-testid='farewell-home']").click();
  await page.waitForURL((u) => u.pathname !== "/family/learn/mission", { timeout: 25000 });
  const endUrl = new URL(page.url());
  check("I.end-lands-on-the-learning-home", endUrl.pathname === "/family/learn" && endUrl.searchParams.get("child") === "isabel", endUrl.pathname + endUrl.search);
  if (MAP_START) await page.waitForSelector("[data-testid='home-map']", { timeout: 40000 }).catch(() => null);
  check("I.end-shows-the-map", MAP_START ? (await sel(page, "[data-testid='home-map']").count()) === 1 : true);
  await settle(1500);
  await shot(page, "end-on-the-map");
  await keepSeq(page);
  await voiceChecks(page, "I");
  const v6 = JSON.parse(fs.readFileSync(new URL("../src/data/family-learning/content/isabel-workshop-v5.json", import.meta.url), "utf8")).missions.find((m) => m.visit === "v6");
  const opening = Object.fromEntries(v6.steps.filter((st) => st.intro?.length).map((st) => [st.id, st.intro[0].text.normalize("NFC").replace(/\s+/g, " ").trim()]));
  const visited = new Set(seqEvents.filter((e) => e.e === "screen").map((e) => e.k.split(":")[1]));
  sequenceChecks("I", {
    opening: Object.fromEntries(Object.entries(opening).filter(([id]) => visited.has(id))),
    heard: ["Jetzt haben sie bestimmt Hunger.", "Ein Ei im Nest. Ob bald noch mehr kommen?", "Die Vögel haben jetzt Futter. Bis bald!", "Wie war es heute?"],
    exactly: { "Ein Ei im Nest. Ob bald noch mehr kommen?": 1 },
  });
  check("I.pictures-actually-checked", picturesSeen >= 15, picturesSeen);
  await c.close();
}

const labels = async (page, label) => {
  const r = await sel(page, "[data-testid='home-map']").evaluate((e) => ({ overlaps: e.dataset.labelOverlaps, missing: e.dataset.missing, pieces: e.dataset.pieces, unplaced: e.dataset.unplaced }));
  check(`M.labels.${label}`, !r.overlaps && !r.missing && !r.unplaced, r);
  return r;
};
/** The map: the pieces it shows now, every requested file loads, labels clear. */
async function map(child, wanted, label, expect = {}) {
  const c = await ctx("assistant");
  const page = await c.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  const missing = [];
  const files = new Set();
  page.on("response", (r) => {
    if (!r.url().includes("/family/home-map/")) return;
    files.add(r.url().split("/family/home-map/")[1].replace(/\.(png|webp)$/, ""));
    if (r.status() >= 400) missing.push(r.url());
  });
  await page.goto(`${BASE}/family/learn?child=${child}`);
  await page.waitForSelector("[data-testid='home-map'][data-ready='true']", { timeout: 40000 });
  await settle(3000);
  const r = await labels(page, `${child}.${label}`);
  check(`M.${child}.${label}.pieces`, wanted.every((w) => (r.pieces ?? "").includes(w)), r.pieces);
  for (const g of expect.gone ?? []) check(`M.${child}.${label}.gone.${g}`, !(r.pieces ?? "").includes(`${g}:`), r.pieces);
  for (const f of expect.files ?? []) check(`M.${child}.${label}.draws.${f}`, files.has(f), [...files].filter((x) => /birdhouse|feeder|pond|pump|crate|robins/.test(x)));
  for (const f of expect.absent ?? []) check(`M.${child}.${label}.not-drawn.${f}`, !files.has(f));
  const text = await page.locator("[data-testid='home-map']").innerText();
  for (const [, l] of Object.entries(expect.label ?? {})) check(`M.${child}.${label}.label «${l}»`, text.includes(l), text.replace(/\s+/g, " ").slice(0, 200));
  check(`M.${child}.${label}.no-missing-file`, missing.length === 0, missing.slice(0, 4));
  await shot(page, `map-${child}-${label}`);
  await c.close();
}

// Nov 18: the microphone once (fake media stream + fake recognizer): «Jetzt sprechen!» only after the recorder really records.
// t10 integration: callable on any Nokt panel (the look-back has no talk in v5 for this visit; the writing panel has the mic).
async function micCheck(page, SCOPE) {

    await page.waitForFunction((SCOPE) => { const d = document.querySelector(`[data-testid='${SCOPE}']`); return d?.dataset.waiting === "false" && d.querySelector("[data-testid='nokt-mic-start']") && d.querySelectorAll("[data-role='nokt']").length >= 1; }, SCOPE, { timeout: 40000 });
    await settle(400);
    await page.evaluate(() => globalThis.__mic.splice(0));
    const t0 = await page.evaluate(() => performance.now());
    await page.locator(`[data-testid='${SCOPE}'] [data-testid='nokt-mic-start']`).click();
    await page.waitForSelector("[data-testid='nokt-mic-live']", { timeout: 15000 });
    await settle(1200);
    await shot(page, "mic-jetzt-sprechen");
    await page.locator(`[data-testid='${SCOPE}'] [data-testid='nokt-mic-stop']`).click();
    await page.waitForFunction((SCOPE) => (document.querySelector(`[data-testid='${SCOPE}'] [data-testid='nokt-talk-input']`)?.value ?? "").trim().length > 0 || document.querySelector("[data-testid='nokt-mic-trouble']"), SCOPE, { timeout: 20000 });
    const mic = await page.evaluate(() => globalThis.__mic.slice());
    const at = (e) => mic.find((x) => x.e === e)?.t ?? null;
    const r = { tap: Math.round(t0), startCalled: at("start-called"), startEvent: at("start-event"), firstData: at("first-data"), uiWait: at("ui-wait"), uiLive: at("ui-live"), waitText: mic.find((x) => x.e === "ui-wait")?.text ?? null, liveText: mic.find((x) => x.e === "ui-live")?.text ?? null, slice: mic.find((x) => x.e === "start-called")?.slice ?? null };
    for (const k of ["startCalled", "startEvent", "firstData", "uiWait", "uiLive"]) if (r[k] !== null) r[k] = Math.round(r[k] - t0);
    micTimings.push(r);
    check("S.MIC.wait-text-before-live", r.uiWait !== null && (r.waitText ?? "").includes("Mikrofon startet") && r.uiWait <= (r.uiLive ?? Infinity), r);
    check("S.MIC.jetzt-sprechen-only-after-the-recorder-start-event", r.uiLive !== null && r.startEvent !== null && r.uiLive >= r.startEvent, r);
    check("S.MIC.jetzt-sprechen-only-after-the-first-captured-audio", r.uiLive !== null && r.firstData !== null && r.uiLive >= r.firstData, r);
    check("S.MIC.transcript-from-the-fake-recognizer", (await page.locator(`[data-testid='${SCOPE}'] [data-testid='nokt-talk-input']`).inputValue()).trim().length > 0);
    await page.locator(`[data-testid='${SCOPE}'] [data-testid='nokt-talk-send']`).click();
    await settle(300);
  
}

try {
  const ROOF = opt("--roof", "blue");
  const T = opt("--turtle", "Flip");
  if (WHO === "santiago") await santiago();
  else if (WHO === "isabel") await isabel();
  else if (WHO === "map-s") await map("santiago", ["s-pond:built", "s-turtle-crate:built"], opt("--label", "before"), { files: ["s-pond-dug-built", "s-turtle-crate-built"], absent: ["s-pump-built", "s-pond-water-built"], label: { "s-turtle-crate": T } });
  else if (WHO === "map-i") await map("isabel", ["i-birdhouse:built"], opt("--label", "before"), { files: [`i-birdhouse-tree-${ROOF}-built`, "i-robins"], absent: [`i-birdhouse-${ROOF}-built`, "i-feeder-site"] });
  else if (WHO === "after-s") await map("santiago", ["s-pond:built", "s-pump:built"], "after", { files: ["s-pond-water-built", "s-pump-built"], absent: ["s-turtle-crate-built", "s-pond-dug-built"], label: { "s-pond": `Teich · ${T}` }, gone: ["s-turtle-crate"] });
  else if (WHO === "after-i") await map("isabel", ["i-birdhouse:built", "i-feeder:built"], "after", { files: [`i-birdhouse-tree-${ROOF}-birds-built`, `i-feeder-${opt("--food", "worms")}-built`], absent: ["i-robins", `i-birdhouse-tree-${ROOF}-built`] });
} catch (error) {
  check("harness-completed", false, String(error).slice(0, 500));
  const p = browser.contexts()[0]?.pages()[0];
  if (p) await p.screenshot({ path: path.join(OUT, `${WHO}-${PATH}-CRASH.png`) }).catch(() => null);
}
check("no-page-errors", pageErrors.length === 0, pageErrors.slice(0, 4));
check("no-external-requests", external.length === 0, external.slice(0, 4));
await browser.close();
fs.writeFileSync(path.join(OUT, `results-${WHO}-${PATH}${MAP_START ? "-map" : ""}.json`), JSON.stringify({ results, clips: { real: clipLog.real.size, catalogued: clipLog.fresh.size, unknown: clipLog.unknown }, tts: ttsLog.length, sequence: seqCounts, mic: micTimings, events: seqEvents.length, eventLog: seqEvents }, null, 1));
if (Object.keys(seqCounts).length) console.log("sequence", JSON.stringify(seqCounts), "mic", JSON.stringify(micTimings));
const failed = results.filter((r) => !r.ok);
console.log(`\n${WHO}/${PATH}: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
