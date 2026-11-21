#!/usr/bin/env node
// Nov 21: render checks of Isabel Visit 6 «Das Küken schlüpft» (content v6, visit v7) — the Visit 5 harness (visit11-screens.mjs,
// Nov 18 standard) adapted: 1440 × 780, `next build` + `next start`, SYNTHETIC records (scripts/isabel-v6-seed.mjs), a screenshot
// of every step, the narration sequence, painted pictures must load, no device voice, every clip a catalogued line, no clip says
// her chick's name.
//   node scripts/isabel-v6-screens.mjs --base http://127.0.0.1:3841 --bridge http://127.0.0.1:3842 --out <dir> --who isabel|map-i|after-i
//     [--path main|wrong|mixed] --fresh <catalogue.json> --standin <audio> --clips <dir> [--map] [--roof blue] [--food worms] [--name Pip]
//   main  = right first time everywhere → every harder version; wrong = a miss first everywhere → every easier version;
//   mixed = some of each (a miss on the harder flip, the days easier, food harder, the care decision wrong first, the book
//           with word-by-word help).
// The original header of visit11-screens.mjs follows.
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
const OUT = opt("--out", "/tmp/isv6/shots");
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
const NAME = opt("--name", "Pip");
// Visit 6: the end picture is her roof × her Visit 5 food with the chicks (`chicks-<roof>-<food>`), her chick's name as a text tag.
const endArt = async (page, where) => { const ROOF = opt("--roof", "blue"); const r = await page.evaluate(() => [...document.querySelectorAll("img[data-testid='birdhouse-tree-art']")].map((i) => ({ src: i.getAttribute("src"), ok: i.complete && i.naturalWidth > 0 }))); check(`I.end-picture-${where}-is-${ROOF}-roof-${FOOD}-chicks`, r.length >= 1 && r.every((x) => x.ok && x.src.includes(`chicks-${ROOF}-${FOOD}`)), r); const tag = await page.locator("[data-testid='story-name-tag']").allInnerTexts(); check(`I.end-picture-${where}-shows-the-name-as-text`, tag.length === 1 && tag[0].includes(NAME), tag); };
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
async function isabel() {
  const wrong = PATH === "wrong";
  const mixed = PATH === "mixed";
  const c = await ctx("assistant");
  const page = await c.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(`${BASE}/family/learn?child=isabel`);
  if (MAP_START) {
    await page.waitForSelector("[data-testid='home-map']", { timeout: 40000 });
    await settle(1500);
    await shot(page, "map-before-visit6");
    await page.mouse.click(5, 300);
    await page.goto(`${BASE}/family/learn/mission?child=isabel&enter=birdhouse`).catch(() => null);
  } else {
    await page.waitForSelector("[data-testid='cockpit-start'], [data-testid='start-visit']", { timeout: 30000 });
    if (await sel(page, "[data-testid='cockpit-start']").count()) await sel(page, "[data-testid='cockpit-start']").click();
    await page.waitForSelector("[data-testid='start-visit']", { timeout: 15000 });
    { const hub = (await page.locator("[data-testid='start-screen']").innerText()).replace(/\s+/g, " "); check("I.hub-shows-besuch-6", hub.includes("Das Küken schlüpft") && hub.includes("Heute schlüpfen mit Gärtnerin Ida die Küken."), hub.slice(0, 200)); }
    await shot(page, "start-besuch-6");
    await sel(page, "[data-testid='start-visit']").click();
  }
  const idle = () => page.waitForFunction(() => document.querySelector("[data-testid='workshop-scene']")?.dataset.narration !== "speaking", null, { timeout: 90000 });
  const onStep = async (s, name) => {
    await page.waitForSelector(`[data-testid='workshop-scene'][data-step='${s}']`, { timeout: 30000 });
    await settle(250);
    await pictures(page, `${s}.open`);
    await fold(page, `${s}.open`);
    check(`B.${s}.robins-and-ida`, (await sel(page, "[data-testid='scene-companion']").count()) === 1 && (await sel(page, "[data-testid='gardener-portrait']").count()) >= 1);
    await shot(page, name ?? s);
  };
  const next = async (step, name) => {
    for (let i = 0; i < 3; i += 1) {
      await idle();
      await page.waitForFunction(() => { const b = document.querySelector("[data-testid='workshop-next']"); return b && !b.disabled; }, null, { timeout: 90000 });
      const d = saved(page);
      await sel(page, "[data-testid='workshop-next']").first().click();
      await d;
      await settle(600);
      if (!step || (await sel(page, `[data-testid='workshop-scene'][data-step='${step}']`).count())) break;
    }
    if (step) await onStep(step, name);
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
  const choose = async (v) => {
    await idle();
    const s = `[data-testid='part-choice-${v}']`;
    await page.waitForFunction((x) => { const b = document.querySelector(x); return b && !b.disabled; }, s, { timeout: 20000 });
    const d = saved(page);
    await sel(page, s).click();
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
  const make = async (o) => {
    await idle();
    const d = saved(page);
    await sel(page, `[data-testid='make-${o}']`).click();
    await d;
    await settle(400);
  };
  const play = async () => {
    await idle();
    await sel(page, "[data-testid='listen-play']").first().click();
    await settle(700);
    await idle();
    await page.waitForFunction(() => { const b = document.querySelector("[data-testid='listen-play']"); return b && !b.disabled; }, null, { timeout: 40000 });
  };
  const counters = (layout) => page.evaluate((l) => ({ n: document.querySelectorAll(`[data-testid='counters'][data-layout='${l}']`).length, weeks: document.querySelectorAll("[data-part='week']").length, rows: document.querySelectorAll("[data-part='row']").length, days: document.querySelectorAll("[data-part='day'], [data-part='added']").length, empty: document.querySelectorAll("[data-testid='counters'] [data-part='empty']").length, flights: document.querySelectorAll("[data-part='flight']").length }), layout);

  // 1 — Psst!
  await onStep("I61-PSST", "I61-psst-five-eggs");
  check("I.I61.eggs-scene-large", await page.evaluate(() => { const e = document.querySelector("svg[data-picture='eggs-five']"); return !!e && e.getBoundingClientRect().width >= 250; }));
  // 2 — the number flip by ear
  await next("I62-FLIP", "I62-flip-42-or-24");
  check("I.I62.two-number-choices", (await sel(page, "[data-testid='part-choices'] button").count()) === 2);
  check("I.I62.no-picture-before-the-answer", (await sel(page, "[data-testid='counters']").count()) === 0);
  if (wrong) {
    await choose(24);
    check("I.I62.bags-after-the-miss", (await sel(page, "[data-part='closed-bundle']").count()) === 4, await sel(page, "[data-part='closed-bundle']").count());
    check("I.I62.flip-explained", (await page.locator("[data-testid='solve-task']").innerText()).includes("Vierzig zuerst"));
    await shot(page, "I62-after-a-miss-bags-appear");
    await choose(42);
    await next("I62E-FLIP-EASY", "I62E-easier-12-or-21");
    await choose(12);
    await shot(page, "I62E-richtig");
    await next("I63-EGGS", "I63-read-das-ei-hat-punkte");
  } else {
    await choose(42);
    await shot(page, "I62-richtig-42");
    await next("I62H-FLIP-HARD", "I62H-harder-35-or-53");
    if (mixed) { await choose(53); await shot(page, "I62H-after-a-miss"); }
    await choose(35);
    await next("I63-EGGS", "I63-read-das-ei-hat-punkte");
  }
  // 3 — reading a sentence, the eggs
  check("I.I63.sentence-shown", (await textOf(page, "[data-testid='read-word']")) === "DAS EI HAT PUNKTE.");
  if (wrong) {
    await pick("word", "Blau");
    check("I.I63.word-by-word-after-a-miss", (await textOf(page, "[data-testid='read-letters-open']")).includes("Wort für Wort"));
    await sel(page, "[data-testid='read-letters-open']").click();
    await saved(page).catch(() => null);
    await settle(500);
    check("I.I63.word-tiles", (await page.locator("[data-testid='read-letters'] span").allInnerTexts()).join(" ") === "DAS EI HAT PUNKTE.");
    await shot(page, "I63-word-by-word");
  }
  await pick("word", "Punkte");
  await shot(page, "I63-richtig");
  // 4 — listening fact: who sits on the eggs
  await next("I64-MAMA", "I64-listen-who-sits");
  await play();
  await pictures(page, "I64.after-play");
  await shot(page, "I64-three-pictures");
  if (wrong) await pick("show", "Beide");
  await pick("show", "Mama");
  // 5 — two weeks
  await next("I65-DAYS", "I65-two-week-strips");
  { const r = await counters("weeks"); check("I.I65.two-week-strips-of-7", r.n === 1 && r.weeks === 2 && r.days === 14, r); }
  if (wrong || mixed) {
    await ipart(13); await shot(page, "I65-after-a-miss"); await ipart(14);
    await next("I65E-DAYS-EASY", "I65E-count-the-days");
    await ipart(14);
  } else {
    await ipart(14);
    await next("I65H-DAYS-LEFT", "I65H-tag-9-bis-14");
    { const r = await counters("weeks"); check("I.I65H.nine-done-five-empty", r.days === 9 && r.empty === 5, r); }
    await ipart(5);
  }
  // 6 — doubling caterpillars
  await next("I66-FOOD", "I66-6-and-6-caterpillars");
  if (wrong) { await ipart(11); await ipart(12); await next("I66E-FOOD-EASY", "I66E-3-and-3"); await ipart(6); }
  else { await ipart(12); await next("I66H-FOOD-HARD", "I66H-8-and-8"); await ipart(16); }
  // 7 — Knack!
  await next("I67-KNACK", "I67-knack-chicks-hatch");
  check("I.I67.hatch-scene-large", await page.evaluate(() => { const e = document.querySelector("svg[data-picture='chicks-hatch']"); return !!e && e.getBoundingClientRect().width >= 250; }));
  // 8 — KÜKEN
  await next("I68-KUEKEN", "I68-read-kueken");
  if (wrong) await pick("word", "Kuchen");
  await pick("word", "Küken");
  // 9 — her chick's name
  await next("I69-NAME", "I69-tap-a-chick");
  check("I.I69.five-chicks", (await sel(page, "[data-testid^='chick-']:not([data-testid^='chick-name'])").count()) === 5);
  await idle();
  await sel(page, "[data-testid='chick-3']").click();
  await page.waitForSelector("[data-testid='chick-name-input']");
  await sel(page, "[data-testid='chick-name-input']").fill("Abc3!def ghijklmnop");
  const typed = await sel(page, "[data-testid='chick-name-input']").inputValue();
  check("I.I69.letters-only-at-most-12", typed === "Abcdefghijkl", typed);
  await sel(page, "[data-testid='chick-name-input']").fill(NAME);
  await shot(page, "I69-name-typed");
  { const d = saved(page); await sel(page, "[data-testid='chick-name-save']").click(); await d; await settle(500); }
  await idle();
  await shot(page, "I69-named");
  // 10 — care decision
  await next("I610-FEED", "I610-what-does-a-baby-eat");
  if (wrong || mixed) {
    await make(wrong ? "bread" : "seeds");
    await idle();
    check("I.I610.chick-turns-away", (await sel(page, "[data-testid='care-animal'][data-state='turned-away']").count()) === 1);
    const t = await textOf(page, "[data-testid='workshop-decide']");
    check("I.I610.reason-shown", wrong ? t.includes("Brot macht Vögel krank") : t.includes("Körner sind zu hart für Babys"), t);
    await shot(page, "I610-chick-turns-away");
  }
  await make("caterpillars");
  await idle();
  check("I.I610.fed", (await sel(page, "[data-testid='care-animal'][data-state='fed']").count()) === 1);
  await shot(page, "I610-fed-caterpillars");
  // 11 — counting in tens
  await next("I611-FLIGHTS", "I611-three-rows-of-ten");
  { const r = await counters("rows"); check("I.I611.three-rows-of-ten", r.rows === 3 && r.flights === 30, r); }
  if (wrong) { await ipart(3); await ipart(30); await next("I611E-FLIGHTS-EASY", "I611E-two-rows"); await ipart(20); }
  else { await ipart(30); await next("I611H-FLIGHTS-MORE", "I611H-five-rows"); { const r = await counters("rows"); check("I.I611H.five-rows", r.rows === 5 && r.flights === 50, r); } await ipart(50); }
  // 12 — water
  await next("I612-WATER", "I612-water-fact-and-listen");
  await play();
  await pictures(page, "I612.after-play");
  await shot(page, "I612-four-pictures");
  if (wrong) await pick("show", "Tief, im Gras");
  await pick("show", "Flach, unter dem Busch");
  // 13 — the growth book
  await next("I613-BOOK", "I613-growth-book-page-1");
  check("I.I613.book-shows-her-chicks-name", (await textOf(page, "[data-testid='growth-book-title']")).includes(NAME), await textOf(page, "[data-testid='growth-book-title']"));
  check("I.I613.photo-frame-empty", (await sel(page, "[data-testid='growth-book-photo'][data-filled='false']").count()) === 1);
  if (wrong || mixed) {
    await pick("word", "Flaumig");
    await sel(page, "[data-testid='read-letters-open']").click();
    await saved(page).catch(() => null);
    await settle(500);
    await shot(page, "I613-word-by-word");
  }
  await pick("word", "Nackt");
  check("I.I613.photo-in-the-book", (await sel(page, "[data-testid='growth-book-photo'][data-filled='true'] svg[data-picture='chick-naked']").count()) === 1);
  await shot(page, "I613-page-filled");
  // 14 — end
  await next("I614-END", "I614-end-picture");
  await idle();
  check("I.no-home-task", (await sel(page, "[data-testid='home-task']").count()) === 0);
  await endArt(page, "I614");
  await shot(page, "I614-end-after-narration");
  await next(null);
  if (await sel(page, "[data-testid='workshop-next']").count()) await next(null);
  await page.waitForSelector("[data-testid='workshop-closing']", { timeout: 30000 });
  const cidle = () => page.waitForFunction(() => document.querySelector("[data-testid='workshop-closing']")?.dataset.narration !== "speaking", null, { timeout: 60000 });
  await cidle();
  check("I.end-asks-wie-war-es-heute", (await textOf(page, "[data-testid='closing-question']")).includes("Wie war es heute?"), await textOf(page, "[data-testid='closing-question']"));
  await shot(page, "closing-rating");
  await sel(page, "[data-testid='difficulty-right']").click().catch(async () => sel(page, "[data-testid^='difficulty-']").first().click());
  await settle(500);
  await cidle();
  await pictures(page, "closing-liked");
  const liked = await sel(page, "[data-testid^='liked-']").allInnerTexts();
  check("I.liked-eier-kueken-wasser", ["Eier", "Küken", "Wasser"].every((w) => liked.some((l) => l.includes(w))), liked);
  await shot(page, "closing-what-she-liked");
  await sel(page, "[data-testid='liked-chicks']").click();
  await settle(500);
  await page.waitForFunction(() => document.querySelector("[data-testid='workshop-closing']")?.dataset.step === "next", null, { timeout: 15000 });
  await cidle();
  await pictures(page, "closing-next");
  const labels = await sel(page, "[data-testid='closing-next'] [role='group'] button").allInnerTexts();
  check("I.next-augen-federn-fliegen", ["Augen", "Federn", "Fliegen"].every((w) => labels.some((l) => l.includes(w))) && labels.every((l) => l.replace(/[^\p{L} ]/gu, "").trim().split(/\s+/).length === 1), labels);
  await shot(page, "closing-next-picture-choice");
  await sel(page, "[data-testid='closing-next'] [role='group'] button").first().click();
  await settle(200);
  await page.waitForFunction(() => { const b = document.querySelector("[data-testid='closing-finish']"); return b && !b.disabled; }, null, { timeout: 40000 });
  await sel(page, "[data-testid='closing-finish']").click();
  await page.waitForSelector("[data-testid='workshop-farewell']", { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector("[data-testid='workshop-farewell']")?.dataset.narration !== "speaking", null, { timeout: 40000 });
  const fw = await textOf(page, "[data-testid='workshop-farewell']");
  check("I.farewell-without-a-second-cliffhanger", !fw.includes("Was sieht es dann zuerst?"), fw);
  check("I.farewell-wording", fw.includes("Dein Küken ist geschlüpft. Bis bald!"), fw);
  await pictures(page, "farewell");
  await endArt(page, "farewell");
  await shot(page, "farewell");
  await page.waitForFunction(() => { const b = document.querySelector("[data-testid='farewell-home']"); return b && !b.disabled; }, null, { timeout: 30000 });
  await sel(page, "[data-testid='farewell-home']").click();
  await page.waitForURL((u) => u.pathname !== "/family/learn/mission", { timeout: 25000 });
  const endUrl = new URL(page.url());
  check("I.end-lands-on-the-learning-home", endUrl.pathname === "/family/learn" && endUrl.searchParams.get("child") === "isabel", endUrl.pathname + endUrl.search);
  if (MAP_START) await page.waitForSelector("[data-testid='home-map']", { timeout: 40000 }).catch(() => null);
  await settle(1500);
  await shot(page, "end-on-the-learning-home");
  await keepSeq(page);
  await voiceChecks(page, "I");
  // No clip that played carries her chick's name (every clip is a catalogued line; the catalogue is name-free).
  const played = seqEvents.filter((e) => e.e === "start").map((e) => TEXT_OF.get(e.k) ?? e.k);
  check("I.no-spoken-line-says-the-name", played.length > 20 && played.every((t) => !t.includes(NAME)), { played: played.length });
  const v7 = JSON.parse(fs.readFileSync(new URL("../src/data/family-learning/content/isabel-workshop-v6.json", import.meta.url), "utf8")).missions.find((m) => m.visit === "v7");
  const opening = Object.fromEntries(v7.steps.filter((st) => st.intro?.length).map((st) => [st.id, st.intro[0].text.normalize("NFC").replace(/\s+/g, " ").trim()]));
  const visited = new Set(seqEvents.filter((e) => e.e === "screen").map((e) => e.k.split(":")[1]));
  sequenceChecks("I", {
    opening: Object.fromEntries(Object.entries(opening).filter(([id]) => visited.has(id))),
    heard: ["Das finden wir heute heraus.", "Sie haben noch keine Federn, und ihre Augen sind zu.", "In ein paar Tagen gehen die Augen auf. Was sieht es dann zuerst?", "Dein Küken ist geschlüpft. Bis bald!", "Wie war es heute?"],
    exactly: { "In ein paar Tagen gehen die Augen auf. Was sieht es dann zuerst?": 1 },
  });
  check("I.pictures-actually-checked", picturesSeen >= 30, picturesSeen);
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


try {
  const ROOF = opt("--roof", "blue");
  if (WHO === "isabel") await isabel();
  else if (WHO === "map-i") await map("isabel", ["i-birdhouse:built", "i-feeder:built"], opt("--label", "before"), { files: [`i-birdhouse-tree-${ROOF}-birds-built`, `i-feeder-${FOOD}-built`], absent: [`i-birdhouse-tree-${ROOF}-chicks-built`, "i-water-bowl-built"] });
  else if (WHO === "after-i") await map("isabel", ["i-birdhouse:built", "i-feeder:built", "i-water-bowl:built"], "after", { files: [`i-birdhouse-tree-${ROOF}-chicks-built`, `i-feeder-${FOOD}-built`, "i-water-bowl-built"], absent: [`i-birdhouse-tree-${ROOF}-birds-built`, "i-robins"], label: { "i-birdhouse": `Vogelhaus · ${NAME}` } });
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
