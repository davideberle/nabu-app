#!/usr/bin/env node
// Nov 22: render checks of Isabel Visit 7 «Wann kann Isa sehen?» (content v7, visit v8) — the Visit 6 harness (isabel-v6-screens.mjs)
// adapted: 1440 × 780, `next build` + `next start`, SYNTHETIC records (scripts/isabel-v7-seed.mjs: her real shape after Visit 6), a
// screenshot of every step, the narration sequence, painted pictures must load, no device voice, every clip a catalogued line, no
// clip says her chick's name; the app-wide feedback lock (a tap during the correction has no effect).
//   node scripts/isabel-v7-screens.mjs --base http://127.0.0.1:3851 --bridge http://127.0.0.1:3852 --out <dir> --who isabel|map-i|after-i
//     [--path main|wrong|mixed] [--show] --fresh <catalogue.json> --standin <audio> --clips <dir> [--map] [--roof blue] [--food worms] [--name Isa]
//   main  = right first time everywhere → every harder version, «Ich weiss es» right (with --show: «Zeig es mir»);
//   wrong = a miss first everywhere → every easier version, «Zeig es mir», the lock checked on the number flip;
//   mixed = «Ich weiss es» wrong, some misses (harder flip, coins harder, days easier, writing with tiles, book word by word).
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
const OUT = opt("--out", "/tmp/isv7/shots");
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
const NAME = opt("--name", "Isa");
// Visit 7: the end picture is her chick peeking out of her roof colour's birdhouse (`peek-<roof>`), her chick's name as a text tag.
const endArt = async (page, where) => { const ROOF = opt("--roof", "blue"); const r = await page.evaluate(() => [...document.querySelectorAll("img[data-testid='birdhouse-tree-art']")].map((i) => ({ src: i.getAttribute("src"), ok: i.complete && i.naturalWidth > 0 }))); check(`I.end-picture-${where}-is-${ROOF}-peek`, r.length >= 1 && r.every((x) => x.ok && x.src.includes(`peek-${ROOF}`)), r); const tag = await page.locator("[data-testid='story-name-tag']").allInnerTexts(); check(`I.end-picture-${where}-shows-the-name-as-text`, tag.length === 1 && tag[0].includes(NAME), tag); };
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
  // «Ich weiss es» (know) on main and mixed; «Zeig es mir» (show) on wrong and with --show.
  const know = !wrong && !args.includes("--show");
  const c = await ctx("assistant");
  const page = await c.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  let puts = 0;
  page.on("request", (r) => { if (r.url().includes("/api/family/learning/mission") && r.method() === "PUT") puts += 1; });
  await page.goto(`${BASE}/family/learn?child=isabel`);
  if (MAP_START) {
    await page.waitForSelector("[data-testid='home-map']", { timeout: 40000 });
    await settle(1500);
    await shot(page, "map-before-visit7");
    await page.mouse.click(5, 300);
    await page.goto(`${BASE}/family/learn/mission?child=isabel&enter=birdhouse`).catch(() => null);
  } else {
    await page.waitForSelector("[data-testid='cockpit-start'], [data-testid='start-visit']", { timeout: 30000 });
    if (await sel(page, "[data-testid='cockpit-start']").count()) await sel(page, "[data-testid='cockpit-start']").click();
    await page.waitForSelector("[data-testid='start-visit']", { timeout: 15000 });
    { const hub = (await page.locator("[data-testid='start-screen']").innerText()).replace(/\s+/g, " "); check("I.hub-shows-besuch-7-with-her-chicks-name", hub.includes(`Wann kann ${NAME} sehen?`) && hub.includes("Heute besuchst du mit Gärtnerin Ida dein Küken."), hub.slice(0, 220)); }
    await shot(page, "start-besuch-7");
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
  const enabled = (s) => page.waitForFunction((x) => { const b = document.querySelector(x); return b && !b.disabled && !b.closest("fieldset[disabled]"); }, s, { timeout: 30000 });
  const tapSave = async (s) => { await idle(); await enabled(s); const d = saved(page); await sel(page, s).click(); await d; await settle(350); };
  const ipart = async (v) => {
    await idle();
    const nq = sel(page, "[data-testid='solve-next-question']");
    if (await nq.count()) { await enabled("[data-testid='solve-next-question']"); await nq.click(); await settle(250); await idle(); }
    await enabled("[data-testid='part-input']");
    await sel(page, "[data-testid='part-input']").fill(String(v));
    const d = saved(page);
    await sel(page, "[data-testid='part-check']").click();
    await d;
    await settle(350);
  };
  const choose = async (v) => {
    await idle();
    const nq = sel(page, "[data-testid='solve-next-question']");
    if (await nq.count()) { await enabled("[data-testid='solve-next-question']"); await nq.click(); await settle(300); await idle(); }
    await tapSave(`[data-testid='part-choice-${v}']`);
  };
  const pick = (q, o) => tapSave(`[data-testid='pick-${q}-${o}']`);
  const make = (o) => tapSave(`[data-testid='make-${o}']`);
  const play = async () => {
    await idle();
    await enabled("[data-testid='listen-play']");
    await sel(page, "[data-testid='listen-play']").first().click();
    await settle(700);
    await idle();
    await page.waitForFunction(() => { const b = document.querySelector("[data-testid='listen-play']"); return !b || !b.disabled; }, null, { timeout: 40000 });
    await settle(300);
    await idle();
  };
  const order = async (seq, name) => {
    await idle();
    await page.waitForSelector("[data-testid='order-board']", { timeout: 20000 });
    for (let i = 0; i < seq.length; i += 1) {
      const s = `[data-testid='order-pick-${seq[i]}']`;
      await enabled(s);
      if (i < seq.length - 1) { await sel(page, s).click(); await settle(250); if (i === 0 && name) await shot(page, name); }
      else { const d = saved(page); await sel(page, s).click(); await d; await settle(400); }
    }
  };
  const multi = async (opts) => {
    await idle();
    for (const o of opts) { await enabled(`[data-testid='multi-egg-${o}']`); await sel(page, `[data-testid='multi-egg-${o}']`).click(); await settle(150); }
    await tapSave("[data-testid='multi-done']");
  };
  const counters = (layout) => page.evaluate((l) => ({ n: document.querySelectorAll(`[data-testid='counters'][data-layout='${l}']`).length, rows: document.querySelectorAll("[data-part='row']").length, coins: document.querySelectorAll("[data-part='flight']").length, days: document.querySelectorAll("[data-testid='counters'] [data-part='day']").length, empty: document.querySelectorAll("[data-testid='counters'] [data-part='empty']").length, nums: [...document.querySelectorAll("[data-testid='counters'][data-layout='strip'] text")].map((t) => t.textContent).join(",") }), layout);

  // 1 — Psst! day 4, eyes closed; her chick's name as a text tag on the scene
  await onStep("I71-PSST", "I71-psst-day-4");
  check("I.I71.nest-scene-large", await page.evaluate(() => { const e = document.querySelector("svg[data-picture='chicks-day4']"); return !!e && e.getBoundingClientRect().width >= 250; }));
  check("I.I71.name-tag-is-text", (await textOf(page, "[data-testid='story-name-tag']")).includes(NAME), await textOf(page, "[data-testid='story-name-tag']"));
  // 2 — Weisst du noch? (delayed recall)
  await next("I72-RECALL", "I72-recall-what-do-chicks-eat");
  if (wrong || mixed) {
    await make("seeds");
    await idle();
    check("I.I72.chick-turns-away", (await sel(page, "[data-testid='care-animal'][data-state='turned-away']").count()) === 1);
    check("I.I72.reason-shown", (await textOf(page, "[data-testid='workshop-decide']")).includes("Körner sind zu hart für Babys"));
    await shot(page, "I72-recall-after-a-miss");
  }
  await make("caterpillars");
  await idle();
  await shot(page, "I72-richtig");
  // 3 — the number flip taught first (bags appear: tens, then ones), then by ear
  await next("I73-FLIP", "I73-taught-63-bags-appear");
  check("I.I73.bags-appear-while-the-number-is-said", (await sel(page, "[data-testid='counters'][data-appear='true'] [data-part='closed-bundle']").count()) === 6 && (await sel(page, "[data-testid='counters'][data-appear='true'] [data-part='loose']").count()) === 3);
  await choose(63);
  await shot(page, "I73-richtig-63");
  await idle();
  await sel(page, "[data-testid='solve-next-question']").click().catch(() => null);
  await settle(400);
  await idle();
  check("I.I73.ear-item-no-bags-before-the-answer", (await sel(page, "[data-testid='counters']").count()) === 0);
  check("I.I73.bubble-shows-the-ear-items-own-line", (await textOf(page, "[data-testid='workshop-line']")) === "Siebenundvierzig Federn. Welche Zahl ist das?", await textOf(page, "[data-testid='workshop-line']"));
  await shot(page, "I73-by-ear-47-or-74");
  if (wrong) {
    // App-wide fix: the correction plays — the answers are locked; a tap on 47 while it plays does nothing.
    await choose(74);
    const locked = await page.waitForFunction(() => document.querySelector("[data-testid='workshop-answers']")?.dataset.locked === "feedback", null, { timeout: 4000 }).then(() => true).catch(() => false);
    const before = puts;
    const btn = await page.evaluate(() => { const b = document.querySelector("[data-testid='part-choice-47']"); const f = b?.closest("fieldset"); return { disabled: !!f?.disabled, opacity: f ? getComputedStyle(f).opacity : null }; });
    check("I.I73.bubble-during-the-correction-is-the-47-item", (await textOf(page, "[data-testid='workshop-line']")) === "Siebenundvierzig Federn. Welche Zahl ist das?", await textOf(page, "[data-testid='workshop-line']"));
    await shot(page, "I73-LOCKED-while-the-correction-plays");
    await sel(page, "[data-testid='part-choice-47']").click({ force: true, timeout: 1500 }).catch(() => null);
    await settle(400);
    const stillOpen = await page.evaluate(() => !document.querySelector("[data-testid='workshop-scene']")?.dataset.status?.match(/done/));
    check("I.LOCK.answers-locked-and-dimmed-while-the-correction-plays", locked && btn.disabled && Number(btn.opacity) < 1, btn);
    check("I.LOCK.a-tap-during-the-correction-has-no-effect", puts === before && stillOpen, { puts: puts - before });
    check("I.LOCK.replay-stays-available", (await sel(page, "[data-testid='narration-control']").count()) === 1 && !(await page.evaluate(() => !!document.querySelector("[data-testid='narration-control']")?.closest("fieldset"))));
    await idle();
    await page.waitForFunction(() => document.querySelector("[data-testid='workshop-answers']")?.dataset.locked === "open", null, { timeout: 8000 });
    check("I.LOCK.unlocks-when-the-line-ends", true);
    check("I.I73.bags-after-the-miss", (await sel(page, "[data-part='closed-bundle']").count()) === 4, await sel(page, "[data-part='closed-bundle']").count());
    await shot(page, "I73-unlocked-bags-appear");
    await choose(47);
    await next("I74-HATCH", "I74-hatch-know-or-show");
  } else {
    await choose(47);
    await next("I73H-FLIP-HARD", "I73H-harder-81-or-18");
    if (mixed) { await choose(18); await shot(page, "I73H-after-a-miss"); }
    await choose(81);
    await next("I74-HATCH", "I74-hatch-know-or-show");
  }
  // 4 — how a chick hatches: «Ich weiss es» / «Zeig es mir»
  check("I.I74.two-buttons", (await sel(page, "[data-testid='prior-know']").count()) === 1 && (await textOf(page, "[data-testid='listen-play']")).includes("Zeig es mir"));
  if (know) {
    await tapSave("[data-testid='prior-know']");
    check("I.I74.board-before-the-explanation", (await sel(page, "[data-testid='order-board']").count()) === 1 && (await sel(page, "[data-testid='order-taught']").count()) === 0);
    if (mixed) {
      await order(["Raus", "Loch", "Riss"], "I74-know-ordering");
      await idle();
      check("I.I74.prior-wrong-then-explanation", (await textOf(page, "[data-testid='workshop-listen']")).includes("Noch nicht ganz"));
      await shot(page, "I74-know-wrong");
      await play();
      await shot(page, "I74-after-the-explanation");
      await order(["Loch", "Riss", "Raus"]);
    } else {
      await order(["Loch", "Riss", "Raus"], "I74-know-ordering");
      await idle();
      await shot(page, "I74-know-right-then-hear");
      await play();
    }
  } else {
    await enabled("[data-testid='listen-play']");
    await sel(page, "[data-testid='listen-play']").click();
    await page.waitForSelector("[data-testid='order-taught']", { timeout: 8000 }).then(() => null).catch(() => null);
    check("I.I74.pictures-in-order-while-explained", (await sel(page, "[data-testid='order-taught'] li").count()) === 3);
    await shot(page, "I74-show-explanation-with-pictures");
    await settle(700);
    await idle();
    await page.waitForSelector("[data-testid='order-board']", { timeout: 20000 });
    if (wrong) {
      await order(["Riss", "Loch", "Raus"], "I74-show-ordering");
      await idle();
      check("I.I74.first-picture-shown-after-a-miss", (await sel(page, "[data-testid='order-slot-1'][data-filled='Loch']").count()) === 1);
      await shot(page, "I74-first-picture-shown");
      await order(["Riss", "Raus"]);
    } else await order(["Loch", "Riss", "Raus"], "I74-show-ordering");
  }
  await idle();
  check("I.I74.solved-in-order", (await sel(page, "[data-testid='order-solved'] li").count()) === 3);
  await shot(page, "I74-solved");
  // 5 — EIZAHN
  await next("I75-EIZAHN", "I75-read-eizahn");
  check("I.I75.word-shown", (await textOf(page, "[data-testid='read-word']")) === "EIZAHN");
  if (wrong) {
    await pick("word", "Zahn");
    await sel(page, "[data-testid='read-letters-open']").click();
    await saved(page).catch(() => null);
    await settle(500);
    await shot(page, "I75-letters");
  }
  await pick("word", "Eizahn");
  await shot(page, "I75-richtig");
  // 6 — egg or belly (several answers)
  await next("I76-EGG", "I76-egg-or-belly");
  await play();
  await pictures(page, "I76.after-play");
  await shot(page, "I76-four-animals");
  if (wrong || mixed) { await multi(["Vogel", "Hund"]); await idle(); await shot(page, "I76-after-a-miss"); }
  await multi(["Vogel", "Schildkröte"]);
  await idle();
  await shot(page, "I76-richtig");
  // 7 — milk?
  await next("I77-MILK", "I77-milk-or-caterpillars");
  await play();
  if (wrong) await pick("show", "Milch");
  await pick("show", "Raupen");
  // 8 — coins in tens
  await next("I78-COINS", "I78-five-rows-of-coins");
  { const r = await counters("rows"); check("I.I78.five-rows-of-ten-coins", r.rows === 5 && r.coins === 50, r); }
  if (wrong) { await ipart(5); await ipart(50); await next("I78E-COINS-EASY", "I78E-two-rows"); { const r = await counters("rows"); check("I.I78E.two-rows", r.rows === 2 && r.coins === 20, r); } await ipart(20); }
  else { await ipart(50); await next("I78H-COINS-MAMA", "I78H-six-rows"); { const r = await counters("rows"); check("I.I78H.six-rows", r.rows === 6 && r.coins === 60, r); } if (mixed) await ipart(50); await ipart(60); }
  // 9 — day 6, two details
  await next("I79-DAY6", "I79-day-6-listen");
  await play();
  await pictures(page, "I79.after-play");
  await shot(page, "I79-four-chicks");
  if (wrong) await pick("show", "Augen auf, Schnabel zu");
  await pick("show", "Augen auf, Schnabel auf");
  // 10 — days left on the 1–14 strip
  await next("I710-DAYS", "I710-strip-6-to-14");
  { const r = await counters("strip"); check("I.I710.strip-1-14-six-over-eight-empty", r.n === 1 && r.days === 6 && r.empty === 8 && r.nums === Array.from({ length: 14 }, (_, i) => i + 1).join(","), r); }
  if (wrong || mixed) { await ipart(14); await ipart(8); await next("I710E-DAYS-EASY", "I710E-strip-6-to-10"); { const r = await counters("strip"); check("I.I710E.strip-1-10", r.days === 6 && r.empty === 4, r); } await ipart(4); }
  else await ipart(8);
  // 11 — writing AUGE
  await next("I711-AUGE", "I711-write-auge");
  check("I.I711.word-not-on-screen-before", !(await textOf(page, "[data-testid='workshop-scene']")).toUpperCase().includes("AUGE"), await textOf(page, "[data-testid='workshop-line']"));
  await idle();
  if (wrong || mixed) {
    await sel(page, "[data-testid='spell-input']").fill("Oge");
    await tapSave("[data-testid='spell-done']");
    await idle();
    check("I.I711.tiles-after-a-miss", (await sel(page, "[data-testid='spell-tiles'] [data-testid^='spell-tile-']").count()) === 6);
    await shot(page, "I711-tiles");
    for (const t of ["A", "U", "G", "E"]) { await enabled(`[data-testid='spell-tile-${t}']`); await sel(page, `[data-testid='spell-tile-${t}']`).click(); await settle(120); }
    check("I.I711.tiles-build-the-word", (await sel(page, "[data-testid='spell-input']").inputValue()) === "AUGE");
    await tapSave("[data-testid='spell-done']");
  } else {
    await sel(page, "[data-testid='spell-input']").fill("auge");
    await shot(page, "I711-typed");
    await tapSave("[data-testid='spell-done']");
  }
  await idle();
  await shot(page, "I711-richtig");
  // 12 — the growth book: page 1 from last time, turn the page, page 2
  await next("I712-BOOK", "I712-book-page-1-from-last-time");
  check("I.I712.page-1-with-her-chicks-name", (await textOf(page, "[data-testid='growth-book-title']")).includes(`${NAME} · Seite 1`) && (await textOf(page, "[data-testid='growth-book-previous-text']")) === "TAG 1: NACKT UND BLIND.", await textOf(page, "[data-testid='growth-book-title']"));
  await idle();
  await sel(page, "[data-testid='book-turn']").click();
  await settle(700);
  check("I.I712.page-2", (await textOf(page, "[data-testid='growth-book-title']")).includes("Seite 2") && (await textOf(page, "[data-testid='read-word']")) === "TAG 6: DIE AUGEN SIND AUF.");
  await shot(page, "I712-page-2");
  if (wrong || mixed) {
    await pick("word", "Federn");
    await sel(page, "[data-testid='read-letters-open']").click();
    await saved(page).catch(() => null);
    await settle(500);
    await shot(page, "I712-word-by-word");
  }
  await pick("word", "Augen auf");
  check("I.I712.photo-in-the-book", (await sel(page, "[data-testid='growth-book-photo'][data-filled='true'] svg[data-picture='chick-eyes-open-beak-closed']").count()) === 1);
  await shot(page, "I712-page-2-filled");
  // 13 — end
  await next("I713-END", "I713-end-picture");
  await idle();
  check("I.no-home-task", (await sel(page, "[data-testid='home-task']").count()) === 0);
  await endArt(page, "I713");
  await shot(page, "I713-end-after-narration");
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
  check("I.liked-eibilder-fuenfraeppler-augen", ["Ei-Bilder", "Fünfräppler", "Augen"].every((w) => liked.some((l) => l.includes(w))), liked);
  await shot(page, "closing-what-she-liked");
  await sel(page, "[data-testid='liked-eyes']").click();
  await settle(500);
  await page.waitForFunction(() => document.querySelector("[data-testid='workshop-closing']")?.dataset.step === "next", null, { timeout: 15000 });
  await cidle();
  await pictures(page, "closing-next");
  const labels = await sel(page, "[data-testid='closing-next'] [role='group'] button").allInnerTexts();
  check("I.next-federn-fliegen-baden", ["Federn", "Fliegen", "Baden"].every((w) => labels.some((l) => l.includes(w))) && labels.every((l) => l.replace(/[^\p{L} ]/gu, "").trim().split(/\s+/).length === 1), labels);
  await shot(page, "closing-next-picture-choice");
  await sel(page, "[data-testid='closing-next'] [role='group'] button").first().click();
  await settle(200);
  await page.waitForFunction(() => { const b = document.querySelector("[data-testid='closing-finish']"); return b && !b.disabled; }, null, { timeout: 40000 });
  await sel(page, "[data-testid='closing-finish']").click();
  await page.waitForSelector("[data-testid='workshop-farewell']", { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector("[data-testid='workshop-farewell']")?.dataset.narration !== "speaking", null, { timeout: 40000 });
  const fw = await textOf(page, "[data-testid='workshop-farewell']");
  check("I.farewell-without-a-second-cliffhanger", !fw.includes("kleine Röhrchen"), fw);
  check("I.farewell-wording", fw.includes("Bis bald bei deinem Küken!"), fw);
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
  const v8 = JSON.parse(fs.readFileSync(new URL("../src/data/family-learning/content/isabel-workshop-v7.json", import.meta.url), "utf8")).missions.find((m) => m.visit === "v8");
  const opening = Object.fromEntries(v8.steps.filter((st) => st.intro?.length).map((st) => [st.id, st.intro[0].text.normalize("NFC").replace(/\s+/g, " ").trim()]));
  const visited = new Set(seqEvents.filter((e) => e.e === "screen").map((e) => e.k.split(":")[1]));
  const explanation = v8.steps.find((s) => s.id === "I74-HATCH").text.body;
  sequenceChecks("I", {
    opening: Object.fromEntries(Object.entries(opening).filter(([id]) => visited.has(id) && id !== "I74-HATCH")),
    heard: ["Das finden wir heute heraus.", "Bald wachsen deinem Küken Federn. Zuerst sehen sie aus wie kleine Röhrchen.", "Bis bald bei deinem Küken!", "Wie war es heute?", explanation],
    exactly: { "Bald wachsen deinem Küken Federn. Zuerst sehen sie aus wie kleine Röhrchen.": 1, [explanation]: 1 },
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
  else if (WHO === "map-i") await map("isabel", ["i-birdhouse:built", "i-feeder:built", "i-water-bowl:built"], opt("--label", "before"), { files: [`i-birdhouse-tree-${ROOF}-chicks-built`, `i-feeder-${FOOD}-built`, "i-water-bowl-built"], absent: [`i-birdhouse-tree-${ROOF}-peek-built`], label: { "i-birdhouse": "Vogelhaus" } }); // before the visit the birdhouse carries the visit's entry label (as before Visit 6)
  else if (WHO === "after-i") await map("isabel", ["i-birdhouse:built", "i-feeder:built", "i-water-bowl:built"], "after", { files: [`i-birdhouse-tree-${ROOF}-peek-built`, `i-feeder-${FOOD}-built`, "i-water-bowl-built"], absent: [`i-birdhouse-tree-${ROOF}-chicks-built`, "i-robins"], label: { "i-birdhouse": `Vogelhaus · ${NAME}` } });
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
