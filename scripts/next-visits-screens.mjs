#!/usr/bin/env node
// Nov 8: render checks of the first arc visits (Santiago Visit 10, Isabel Visit 4) at 1440 × 780 on `next build` + `next start` with
// SYNTHETIC records, both paths (right first time / wrong first). The same standard as the last round:
//  - every `svg[data-picture]` on every screen has drawn children and a non-zero box;
//  - every narrated line must be a real recorded production clip or a line of the NEW catalogue (not recorded yet: a stand-in plays,
//    counted separately). Anything else, or any device voice on a narrated screen, is a failure.
// Audio really plays, muted (Audio muted, Chromium --mute-audio).
//   node scripts/next-visits-screens.mjs --base http://127.0.0.1:3611 --out <dir> --who santiago|isabel|map-s|map-i|fail [--path main|wrong] [--clips <dir>] [--index <json>] [--fresh <json>] [--standin <audio>] [--map]
//
// Nov 18 additions (visit flow):
//  - `--standin <file>`: the stand-in clip for catalogue lines without a real recording. Use a LONG one (4–6 s) so an early
//    advance is caught. `--fresh` may list the WHOLE catalogue of both children (each line still counted against it).
//  - Per-screen sequence recorder: every clip fetch/start/end/interruption, every child tap and every screen change is logged
//    in the page. Fails when (a) a clip is interrupted (pause, another clip, a screen change) without a child tap since it
//    started, (b) the same line starts twice on one screen without a tap in between, (c) the opening line of a narrated beat is
//    not the first line started there, (d) a done line of Isabel's story/outcome beats never starts or never ends,
//    (e) the cliffhanger starts more than once. Counts per run go into the results file.
//  - Santiago's look back uses Nokt's microphone once (Chromium fake media stream, fake recognizer FAMILY_NOKT_STT_FAKE=1):
//    «Jetzt sprechen!» must appear only after the MediaRecorder `start` event AND its first non-empty `dataavailable`.
//  - The end of each visit must land on the learning Home screen (/family/learn, the map with FAMILY_HOME_MAP), never /family/home.
//  - `--map` (Isabel): start the visit from the home map (`?enter=<place>`), as on the children's device, and end on the map.
//    Santiago's map-mode mission is walked on the island (no quest buttons), which this walk does not drive: use `--who map-s`.
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
    imgs: [...document.querySelectorAll("[data-testid='harvest-table-art'], [data-testid='scene-portrait'] img")].map((i) => ({ s: i.getAttribute("src"), n: i.naturalWidth })),
  }));
  picturesSeen += r.out.length;
  const bad = r.out.filter((p) => !p.kids || !p.w || !p.h || !p.on);
  const badI = r.imgs.filter((i) => !i.n);
  await scan(page, label);
  check(`PIC.${label}`, !bad.length && !badI.length, bad.length || badI.length ? { bad, badI } : { n: r.out.length });
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

async function santiago() {
  const wrong = PATH === "wrong";
  const c = await ctx("assistant");
  const page = await c.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  const banner = async (label) => {
    const r = await page.evaluate(() => ({ banner: !!document.querySelector("[data-testid='scene-banner']"), portrait: document.querySelector("[data-testid='scene-portrait'] img")?.naturalWidth ?? 0, turtle: getComputedStyle(document.querySelector("[data-testid='scene-companion']") ?? document.body).backgroundImage.includes("turtle-scene") }));
    check(`B.${label}`, r.banner && r.portrait > 0 && r.turtle, r);
  };
  const goTo = async (step) => {
    // --map: the map start already walked into the first scene.
    if (await page.locator(`[data-testid='scene-panel'][data-step='${step}']`).count()) {
      await settle(350);
      await pictures(page, `${step}.open`);
      if (step !== "T9-TYPING") await banner(step);
      return;
    }
    await page.waitForSelector(`[data-testid='go-${step}']`, { timeout: 25000 });
    const b = page.locator(`[data-testid='go-${step}']`);
    if ((await b.innerText()).includes("Hingehen")) {
      await b.click();
      await page.waitForFunction((s) => document.querySelector(`[data-testid='go-${s}']`)?.textContent?.includes("Starten"), step, { timeout: 25000 });
    }
    await page.locator(`[data-testid='go-${step}']`).click();
    await page.waitForSelector(`[data-testid='scene-panel'][data-step='${step}']`, { timeout: 20000 });
    await settle(350);
    await pictures(page, `${step}.open`);
    if (step !== "T9-TYPING") await banner(step);
  };
  const leave = async () => {
    await page.waitForFunction(() => { const b = document.querySelector("[data-testid='scene-continue']"); return b && !b.disabled; }, null, { timeout: 40000 });
    await page.locator("[data-testid='scene-continue']").click();
    await page.waitForSelector("[data-testid='scene-panel']", { state: "detached", timeout: 15000 });
    await settle(250);
  };
  const story = async () => {
    await page.waitForFunction(() => { const b = document.querySelector("[data-testid='story-done']"); return b && !b.disabled; }, null, { timeout: 40000 });
    await page.locator("[data-testid='story-done']").click();
    await settle(400);
    await leave();
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
    await page.waitForFunction(() => { const b = document.querySelector("[data-testid='listen-play']"); return b && !b.disabled; }, null, { timeout: 40000 });
    await page.locator("[data-testid='listen-play']").first().click();
    await settle(500);
    await page.waitForFunction(() => { const b = document.querySelector("[data-testid='listen-play']"); return b && !b.disabled; }, null, { timeout: 60000 });
    await settle(300);
  };
  const lineIdle = () => page.waitForFunction(() => document.querySelector("[data-testid='scene-line-replay']")?.dataset.state === "idle", null, { timeout: 40000 });
  const request = async (text) => {
    await page.locator("[data-testid='request-input']").fill(text);
    const d = saved(page);
    await page.locator("[data-testid='request-send']").click();
    await d;
    await settle(500);
  };
  const reveal = async () => {
    const b = page.locator("[data-testid='listen-reveal-next']");
    if (await b.count()) { await b.click(); await settle(250); }
  };
  const closeNokt = async () => {
    const dock = page.locator("[data-testid='nokt-close'], [data-testid='nokt-dock-close']");
    if (await dock.count()) { await dock.first().click(); await settle(300); }
  };

  await page.goto(`${BASE}/family/learn?child=santiago`);
  await page.waitForSelector("[data-testid='cockpit-start'], [data-testid='start-visit']", { timeout: 30000 });
  if (await page.locator("[data-testid='cockpit-start']").count()) await page.locator("[data-testid='cockpit-start']").click();
  await page.waitForSelector("[data-testid='start-visit']", { timeout: 15000 });
  check("S.start-is-visit-10", (await page.locator("[data-testid='start-visit']").getAttribute("data-visit")) === "v11");
  await page.locator("[data-testid='start-visit']").click();
  await page.waitForSelector("[data-testid='nokt-sidebar'][data-dock='welcome']", { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector("[data-testid='nokt-welcome']")?.dataset.waiting === "false" && document.querySelectorAll("[data-testid='nokt-welcome'] li").length > 0, null, { timeout: 40000 });
  await page.locator("[data-testid='nokt-dock-close']").click();
  await settle(300);

  await goTo("T1-BEACH");
  await fold(page, "T1");
  await shot(page, "T1-rosa-and-turtle");
  await lineIdle();
  await story();
  await goTo("T1R-RADIO");
  check("S.mateo-is-on-screen", (await textOf(page, "[data-testid='scene-banner']")).includes("DR. MATEO") || (await textOf(page, "[data-testid='scene-banner']")).includes("Dr. Mateo"));
  await shot(page, "T1R-dr-mateo");
  await lineIdle();
  check("S.mateo-spoke-with-es-male", [...clipLog.real, ...clipLog.fresh].some((k) => k.startsWith("es-male/")));
  await story();

  await goTo("T2-AROUND");
  if (wrong) await part(8);
  await part(16);
  await leave();
  await goTo("T2G-GRID");
  await part("6 x 4");
  await leave();
  await goTo("T2S-TUBO");
  await shot(page, "T2S-word-list-locked");
  await lineIdle();
  check("S.word-list-locked-before-a-try", (await page.locator("[data-testid='hint-open']").count()) === 0);
  await request(wrong ? "Necesitamos una cosa" : "Necesitamos un tubo");
  if (wrong) {
    check("S.word-list-after-one-miss", (await page.locator("[data-testid='hint-open']").count()) === 1);
    await page.locator("[data-testid='hint-open']").click();
    await page.waitForSelector("[data-testid='word-bank-word']", { timeout: 12000 });
    await shot(page, "T2S-word-list-after-miss");
    await request("Necesitamos un tubo");
  }
  await leave();

  await goTo("T3-MATEO");
  await shot(page, "T3-mateo-listen");
  await listen();
  await pictures(page, "T3.after-play");
  await fold(page, "T3");
  if (wrong) {
    await pick("plan", "5 m lang, 3 m breit");
    await pick("plan", "4 m lang, 2 m breit");
    await reveal();
  } else await pick("plan", "4 m lang, 3 m breit");
  await leave();
  if (wrong) {
    await goTo("T3E-LENGTH");
    await listen();
    await pictures(page, "T3E.after-play");
    await shot(page, "T3E-only-the-length");
    await pick("len", "4 m");
    await leave();
  } else {
    await goTo("T3H-DEPTH");
    await listen();
    await pictures(page, "T3H.after-play");
    await shot(page, "T3H-depth-side-view");
    await pick("deep", "1 m tief");
    await leave();
  }

  await goTo("T4-AREA");
  await shot(page, "T4-area");
  if (wrong) await part("3 x 3");
  await part("4 x 3");
  await leave();
  if (wrong) { await goTo("T4E-SMALL"); await part("3 x 2"); await leave(); }
  else { await goTo("T4H-BEACH"); await shot(page, "T4H-with-beach"); await part("4 x 4"); await leave(); }

  await goTo("T5-STONES");
  if (wrong) { await part(12); await part(7); await page.waitForSelector("[data-testid='nokt-sidebar'][data-dock='task']", { timeout: 15000 }); await settle(1200); await shot(page, "T5-two-misses-nokt"); await closeNokt(); }
  await part(14);
  await part(14);
  await leave();
  if (wrong) { await goTo("T5E-SMALL"); await part(10); await leave(); }
  else { await goTo("T5H-HALF"); await part(28); await leave(); }

  await goTo("T6-SPOT");
  await shot(page, "T6-three-spots");
  if (wrong) {
    { const d = saved(page); await page.locator("[data-testid='decide-pick-b']").click(); await d; await settle(400); }
    check("S.one-wrong-pick-no-nokt", (await page.locator("[data-testid='nokt-sidebar']").count()) === 0);
    { const d = saved(page); await page.locator("[data-testid='decide-pick-c']").click(); await d; await settle(400); }
    await page.waitForSelector("[data-testid='nokt-sidebar'][data-dock='visit']", { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll("[data-testid='nokt-visit'] [data-role]").length > 0, null, { timeout: 30000 });
    await settle(600);
    await shot(page, "T6-nokt-after-two-wrong");
    check("S.nokt-asks-after-two-wrong", true);
    await closeNokt();
  }
  { const d = saved(page); await page.locator("[data-testid='decide-pick-a']").click(); await d; await settle(400); }
  await leave();

  await goTo("T7-JUNE");
  await listen();
  await pictures(page, "T7.after-play");
  await shot(page, "T7-june-positions");
  if (wrong) await pick("crate", "In der Sonne, neben dem Teich");
  await pick("crate", "Im Schatten, neben dem Teich");
  await pick("food", "Hinter die Kiste");
  await leave();
  if (!wrong) {
    await goTo("T7H-BETWEEN");
    await listen();
    await pictures(page, "T7H.after-play");
    await pick("crate", "Zwischen Teich und Baum");
    await leave();
  }

  await goTo("T8-PIEDRAS");
  await lineIdle();
  await shot(page, "T8-piedras");
  await request("Necesitamos piedras");
  await leave();

  await goTo("T9-TYPING");
  await page.locator("[data-testid='typing-start']").click();
  const typedLines = [];
  for (let guard = 0; guard < 60; guard += 1) {
    await settle(300);
    const phase = await page.locator("[data-testid='typing-block']").first().getAttribute("data-phase");
    if (phase === "comfort") { await page.locator("[data-testid='comfort-easy']").click(); continue; }
    if (phase === "extra-offer") { await page.locator("[data-testid='extra-decline']").click(); continue; }
    if (phase !== "drill") break;
    const lines = await page.locator("[data-testid='typing-block'] p.font-mono").allInnerTexts();
    for (const line of lines) {
      typedLines.push(line.replace(/\s+/g, " ").trim());
      await page.locator("[data-testid='typing-input']").type(line.replace(/\s+/g, " ").trim(), { delay: 4 });
      await page.keyboard.press("Enter");
      await settle(80);
    }
  }
  check("S.no-repeated-drill-line", new Set(typedLines).size === typedLines.length, typedLines.length);
  await page.waitForSelector("[data-testid='scene-continue']", { timeout: 25000 });
  await leave();

  await goTo("T10-JOURNAL");
  await page.locator("[data-testid='write-input']").fill("Heute haben wir eine Schildkroete gefunden. Sie bekommt einen Teich");
  { const d = saved(page); await page.locator("[data-testid='write-send']").click(); await d; }
  await page.waitForSelector("[data-testid='nokt-sidebar'][data-dock='writing']", { timeout: 10000 });
  await noModal(page, "writing");
  await page.waitForFunction(() => document.querySelector("[data-testid='nokt-writing']")?.dataset.waiting === "false" && document.querySelectorAll("[data-testid='nokt-writing'] li[data-role='nokt']").length >= 1, null, { timeout: 40000 });
  await settle(400);
  await shot(page, "T10-nokt-reads");
  await page.locator("[data-testid='nokt-talk-input']").fill("Das Wort Teich");
  await page.locator("[data-testid='nokt-talk-send']").click();
  await page.waitForSelector("[data-testid='write-keep']", { timeout: 40000 });
  // Nov 14 journal flow: the second-try field shows beside the talk; «So lassen» may need the talk's last reply first. Tap it
  // until the scene accepts it (bounded), then leave.
  for (let i = 0; i < 4 && (await page.locator("[data-testid='write-keep']").count()); i += 1) {
    await page.waitForFunction(() => { const b = document.querySelector("[data-testid='write-keep']"); return !b || !b.disabled; }, null, { timeout: 20000 });
    if (!(await page.locator("[data-testid='write-keep']").count())) break;
    const d = saved(page).catch(() => null);
    await page.locator("[data-testid='write-keep']").click();
    await d;
    await settle(1200);
  }
  await shot(page, "T10-after-keep");
  await leave();

  await goTo("T11-NAME");
  await pictures(page, "T11.open");
  await shot(page, "T11-name-pictures");
  if (wrong) {
    await page.locator("[data-testid='decide-own-open']").click();
    await page.locator("[data-testid='decide-own-input']").fill("Kira99!");
    check("S.own-name-letters-only", (await page.locator("[data-testid='decide-own-input']").inputValue()) === "Kira");
    { const d = saved(page); await page.locator("[data-testid='decide-own-send']").click(); await d; await settle(400); }
  } else { const d = saved(page); await page.locator("[data-testid='decide-pick-tula']").click(); await d; await settle(400); }
  const name = wrong ? "Kira" : "Tula";
  await page.waitForSelector("[data-testid='scene-continue']", { timeout: 15000 });
  check("S.name-on-screen", (await textOf(page, "[data-testid='scene-banner']")).includes(name), await textOf(page, "[data-testid='scene-banner']"));
  await shot(page, "T11-name-chosen");
  await leave();

  await goTo("T12-END");
  check("S.name-used-in-later-line", (await textOf(page, "[data-testid='scene-banner']")).includes(name));
  await page.locator("[data-testid='story-done']").click();
  await settle(500);
  check("S.home-task", (await textOf(page, "[data-testid='home-task']")).includes("4 m"));
  await shot(page, "T12-home-task");
  await leave();

  await page.waitForSelector("[data-testid='mission-finish']", { timeout: 20000 });
  await page.locator("[data-testid='mission-finish']").click();
  await page.waitForSelector("[data-testid='debrief']", { timeout: 20000 });
  await settle(300);
  check("S.end-asks-first", (await textOf(page, "[data-testid='debrief-row-difficulty']")).includes("Wie leicht war es?"));
  await page.locator("[data-testid='difficulty-easy']").click();
  await page.waitForSelector("[data-testid='nokt-sidebar'][data-dock='debrief']", { timeout: 10000 });
  const answer = async (t) => {
    await page.waitForFunction(() => { const d = document.querySelector("[data-testid='nokt-debrief']"); return d?.dataset.waiting === "false" && d.querySelector("[data-testid='nokt-talk-input']") && d.querySelectorAll("[data-role='nokt']").length >= 1; }, null, { timeout: 40000 });
    await settle(400);
    await page.locator("[data-testid='nokt-debrief'] [data-testid='nokt-talk-input']").fill(t);
    await page.locator("[data-testid='nokt-debrief'] [data-testid='nokt-talk-send']").click();
    await settle(300);
  };
  // Nov 18: the microphone once (fake media stream + fake recognizer): «Jetzt sprechen!» only after the recorder really records.
  {
    await page.waitForFunction(() => { const d = document.querySelector("[data-testid='nokt-debrief']"); return d?.dataset.waiting === "false" && d.querySelector("[data-testid='nokt-mic-start']") && d.querySelectorAll("[data-role='nokt']").length >= 1; }, null, { timeout: 40000 });
    await settle(400);
    await page.evaluate(() => globalThis.__mic.splice(0));
    const t0 = await page.evaluate(() => performance.now());
    await page.locator("[data-testid='nokt-debrief'] [data-testid='nokt-mic-start']").click();
    await page.waitForSelector("[data-testid='nokt-mic-live']", { timeout: 15000 });
    await settle(1200);
    await shot(page, "mic-jetzt-sprechen");
    await page.locator("[data-testid='nokt-debrief'] [data-testid='nokt-mic-stop']").click();
    await page.waitForFunction(() => (document.querySelector("[data-testid='nokt-debrief'] [data-testid='nokt-talk-input']")?.value ?? "").trim().length > 0 || document.querySelector("[data-testid='nokt-mic-trouble']"), null, { timeout: 20000 });
    const mic = await page.evaluate(() => globalThis.__mic.slice());
    const at = (e) => mic.find((x) => x.e === e)?.t ?? null;
    const r = { tap: Math.round(t0), startCalled: at("start-called"), startEvent: at("start-event"), firstData: at("first-data"), uiWait: at("ui-wait"), uiLive: at("ui-live"), waitText: mic.find((x) => x.e === "ui-wait")?.text ?? null, liveText: mic.find((x) => x.e === "ui-live")?.text ?? null, slice: mic.find((x) => x.e === "start-called")?.slice ?? null };
    for (const k of ["startCalled", "startEvent", "firstData", "uiWait", "uiLive"]) if (r[k] !== null) r[k] = Math.round(r[k] - t0);
    micTimings.push(r);
    check("S.MIC.wait-text-before-live", r.uiWait !== null && (r.waitText ?? "").includes("Mikrofon startet") && r.uiWait <= (r.uiLive ?? Infinity), r);
    check("S.MIC.jetzt-sprechen-only-after-the-recorder-start-event", r.uiLive !== null && r.startEvent !== null && r.uiLive >= r.startEvent, r);
    check("S.MIC.jetzt-sprechen-only-after-the-first-captured-audio", r.uiLive !== null && r.firstData !== null && r.uiLive >= r.firstData, r);
    check("S.MIC.transcript-from-the-fake-recognizer", (await page.locator("[data-testid='nokt-debrief'] [data-testid='nokt-talk-input']").inputValue()).trim().length > 0);
    await page.locator("[data-testid='nokt-debrief'] [data-testid='nokt-talk-send']").click();
    await settle(300);
  }
  await answer("Die Steine");
  await page.waitForSelector("[data-testid='debrief-finish']", { timeout: 45000 });
  await settle(400);
  check("S.no-next-visit-question", (await page.locator("[data-testid='debrief-interest-form'], [data-testid='nokt-talk-choices']").count()) === 0);
  check("S.cliffhanger", (await textOf(page, "[data-testid='debrief-cliffhanger']")).includes("Wie viel") || (await textOf(page, "[data-testid='debrief-cliffhanger']")).includes("wie viel"));
  await scan(page, "S.end");
  await shot(page, "end-cliffhanger");
  await page.locator("[data-testid='debrief-finish']").click();
  // Nov 18: the end of the visit lands on the learning Home screen (the map), never on Family Home.
  await page.waitForURL((u) => u.pathname !== "/family/learn/mission", { timeout: 25000 });
  const endUrl = new URL(page.url());
  check("S.end-lands-on-the-learning-home", endUrl.pathname === "/family/learn" && endUrl.searchParams.get("child") === "santiago", endUrl.pathname + endUrl.search);
  await page.waitForSelector("[data-testid='home-map'], [data-testid='world-screen'], [data-testid='cockpit-start'], [data-testid='start-visit']", { timeout: 40000 });
  if (MAP_START) await page.waitForSelector("[data-testid='home-map']", { timeout: 40000 }).catch(() => null);
  check("S.end-shows-the-map", MAP_START ? (await page.locator("[data-testid='home-map']").count()) === 1 : true);
  await settle(1500);
  await shot(page, "end-on-the-map");
  check("S.visit-finished", true);
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
  await page.goto(`${BASE}/family/learn?child=isabel`);
  if (MAP_START) {
    await page.waitForSelector("[data-testid='home-map']", { timeout: 40000 });
    await settle(1500);
    // The tap on the map is the deliberate start (sticky user activation), then the scene opens by itself.
    await page.mouse.click(5, 300);
    await page.goto(`${BASE}/family/learn/mission?child=isabel&enter=birdhouse`).catch(() => null);
  } else {
    await page.waitForSelector("[data-testid='cockpit-start'], [data-testid='start-visit']", { timeout: 30000 });
    if (await page.locator("[data-testid='cockpit-start']").count()) await page.locator("[data-testid='cockpit-start']").click();
    await page.waitForSelector("[data-testid='start-visit']", { timeout: 15000 });
    await page.locator("[data-testid='start-visit']").click();
  }
  let gateSeen = false;
  let stopSeen = false;
  const idle = () => page.waitForFunction(() => document.querySelector("[data-testid='workshop-scene']")?.dataset.narration !== "speaking", null, { timeout: 90000 });
  const onStep = async (s) => {
    await page.waitForSelector(`[data-testid='workshop-scene'][data-step='${s}']`, { timeout: 30000 });
    await settle(250);
    const w = page.locator("[data-testid='workshop-next']");
    if ((await w.count()) && (await page.locator("[data-testid='workshop-scene'][data-narration='speaking']").count())) gateSeen = (await w.first().isDisabled()) || gateSeen;
    const sp = page.locator("[data-testid='narration-control'][data-state='speaking']");
    if ((await sp.count()) && !(await sp.first().isDisabled())) stopSeen = true;
    await pictures(page, `${s}.open`);
    check(`B.${s}.robins-and-ida`, (await page.locator("[data-testid='scene-companion']").count()) === 1 && (await page.locator("[data-testid='gardener-portrait']").count()) >= 1);
  };
  // Nov 18: a story/outcome beat takes two taps (finish it — its done line is said — then leave), so tap «Weiter» until the
  // wanted beat is open.
  const next = async (step) => {
    for (let i = 0; i < 3; i += 1) {
      await idle();
      await page.waitForFunction(() => { const b = document.querySelector("[data-testid='workshop-next']"); return b && !b.disabled; }, null, { timeout: 90000 });
      const d = saved(page);
      await page.locator("[data-testid='workshop-next']").first().click();
      await d;
      await settle(600);
      if (!step || (await page.locator(`[data-testid='workshop-scene'][data-step='${step}']`).count())) break;
    }
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
  const pick = async (q, o) => {
    await idle();
    const sel = `[data-testid='pick-${q}-${o}']`;
    await page.waitForFunction((s) => { const b = document.querySelector(s); return b && !b.disabled; }, sel, { timeout: 20000 });
    const d = saved(page);
    await page.locator(sel).click();
    await d;
    await settle(350);
  };
  await onStep("IV1-HELLO");
  await fold(page, "IV1");
  await shot(page, "IV1-ida-and-robins");
  await next("IV2-WARM");
  await shot(page, "IV2-closed-bundles");
  if (wrong) { await ipart(40); await ipart(45); await next("IV2E-WARM-EASY"); await shot(page, "IV2E-easier"); await ipart(23); await next("IV2N-NEST"); }
  else { await ipart(45); await next("IV2N-NEST"); }
  await shot(page, "IV2N-read-NEST");
  check("I.letters-hidden-before-a-miss", (await page.locator("[data-testid='read-letters-open']").count()) === 0);
  if (wrong) {
    await pick("word", "Haus");
    check("I.letters-after-a-miss", (await page.locator("[data-testid='read-letters-open']").count()) === 1);
    await idle();
    { const d = saved(page); await page.locator("[data-testid='read-letters-open']").click(); await d; await settle(400); }
    await idle();
    await shot(page, "IV2N-letters-after-miss");
    await pick("word", "Nest");
  } else await pick("word", "Nest");
  await next("IV3-WALLS");
  if (wrong) { await ipart(16); await ipart(26); await next("IV3E-WALLS-EASY"); await ipart(13); await next("IV4-ENOUGH"); }
  else { await ipart(26); await next("IV4-ENOUGH"); }
  await shot(page, "IV4-how-many-missing");
  if (wrong) { await ipart(3); await ipart(4); await next("IV4E-ENOUGH-EASY"); await ipart(2); await next("IV5-NAILS"); }
  else { await ipart(4); await next("IV4H-ENOUGH-MORE"); await shot(page, "IV4H-to-40"); await ipart(14); await next("IV5-NAILS"); }
  await shot(page, "IV5-nails");
  if (wrong) { await ipart(12); await ipart(13); await next("IV5E-NAILS-EASY"); await ipart(9); await next("IV6-VOGEL"); }
  else { await ipart(13); await next("IV5H-NAILS-MORE"); await ipart(14); await next("IV6-VOGEL"); }
  await shot(page, "IV6-read-VOGEL");
  await fold(page, "IV6");
  await pick("word", "Vogel");
  await next("IV7-HAUS");
  await pick("word", "Haus");
  await next("IV8-PHRASE");
  await shot(page, "IV8-phrase");
  if (wrong) {
    await pick("word", "Ein Vogel");
    await pick("word", "Ein Haus");
    await idle();
    check("I.phrase-given-wording", (await textOf(page, "[data-testid='workshop-read']")).includes("Da steht: Ein Vogelhaus."), await textOf(page, "[data-testid='workshop-read']"));
    await shot(page, "IV8-phrase-given");
  } else await pick("word", "Ein Vogelhaus");
  await next("IV9-LISTEN");
  await idle();
  await page.locator("[data-testid='listen-play']").first().click();
  await settle(700);
  await idle();
  await page.waitForFunction(() => { const b = document.querySelector("[data-testid='listen-play']"); return b && !b.disabled; }, null, { timeout: 40000 });
  check("I.no-kein-ton-link-after-a-normal-play", (await page.locator("[data-testid='listen-adult-open']").count()) === 0 && !(await textOf(page, "[data-testid='workshop-task']")).includes("Kein Ton"));
  await pictures(page, "IV9.after-play");
  await shot(page, "IV9-listen-four-pictures");
  if (wrong) {
    await pick("show", "Grosser Baum, unten, neben dem Fenster");
    await idle();
    await page.waitForFunction(() => { const b = document.querySelector("[data-testid='listen-play']"); return b && !b.disabled; }, null, { timeout: 40000 });
    await pick("show", "Kleiner Baum, neben dem Fenster");
    await idle();
    check("I.listen-given-wording", (await textOf(page, "[data-testid='workshop-task']")).includes("Ida meinte: am grossen Baum, hoch oben, neben dem Fenster."));
    await shot(page, "IV9-listen-given");
  } else await pick("show", "Grosser Baum, hoch, neben dem Fenster");
  await next("IV10-ROOF");
  await shot(page, "IV10-roof-color");
  { await idle(); const d = saved(page); await page.locator(`[data-testid='make-${wrong ? "blue" : "red"}']`).click(); await d; await settle(350); }
  await next("IV11-HOME");
  await idle();
  check("I.home-task", (await textOf(page, "[data-testid='home-task']")).includes("Fenster"));
  await shot(page, "IV11-birdhouse");
  await fold(page, "IV11");
  check("I.weiter-waits-for-the-line", gateSeen);
  check("I.replay-only", !stopSeen && (await page.locator("[aria-label='Vorlesen stoppen']").count()) === 0);
  await next(null);
  if (await page.locator("[data-testid='workshop-next']").count()) await next(null);
  await page.waitForSelector("[data-testid='workshop-closing']", { timeout: 30000 });
  const cidle = () => page.waitForFunction(() => document.querySelector("[data-testid='workshop-closing']")?.dataset.narration !== "speaking", null, { timeout: 60000 });
  await cidle();
  check("I.end-asks-how-easy", (await textOf(page, "[data-testid='closing-question']")).includes("Wie leicht war es?"));
  await page.locator("[data-testid='difficulty-easy']").click();
  await settle(500);
  await cidle();
  await pictures(page, "closing-liked");
  await shot(page, "closing-what-she-liked");
  await page.locator("[data-testid='liked-sticks']").click();
  await settle(500);
  await page.waitForFunction(() => document.querySelector("[data-testid='workshop-closing']")?.dataset.step === "next", null, { timeout: 15000 });
  await cidle();
  await pictures(page, "closing-next");
  const labels = await page.locator("[data-testid='closing-next'] [role='group'] button").allInnerTexts();
  check("I.next-is-what-the-birds-need", labels.length >= 3 && labels.every((l) => l.replace(/[^\p{L} ]/gu, "").trim().split(/\s+/).length === 1) && labels.some((l) => l.includes("Futter")), labels);
  await shot(page, "closing-birds-need-next");
  await page.locator("[data-testid='closing-next'] [role='group'] button").first().click();
  await settle(200);
  await page.waitForFunction(() => { const b = document.querySelector("[data-testid='closing-finish']"); return b && !b.disabled; }, null, { timeout: 40000 });
  await page.locator("[data-testid='closing-finish']").click();
  await page.waitForSelector("[data-testid='workshop-farewell']", { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector("[data-testid='workshop-farewell']")?.dataset.narration !== "speaking", null, { timeout: 60000 });
  // Nov 18: the cliffhanger was said on the outcome beat; the goodbye says only the visit's own line (no second cliffhanger).
  check("I.farewell-without-a-second-cliffhanger", !(await textOf(page, "[data-testid='workshop-farewell']")).includes("Ob sie einziehen?"));
  check("I.farewell-wording", (await textOf(page, "[data-testid='workshop-farewell']")).includes("Dein Vogelhaus steht jetzt im Garten. Bis bald!"));
  await pictures(page, "farewell");
  await shot(page, "farewell");
  await page.waitForFunction(() => { const b = document.querySelector("[data-testid='farewell-home']"); return b && !b.disabled; }, null, { timeout: 30000 });
  await page.locator("[data-testid='farewell-home']").click();
  await page.waitForURL((u) => u.pathname !== "/family/learn/mission", { timeout: 25000 });
  const endUrl = new URL(page.url());
  check("I.end-lands-on-the-learning-home", endUrl.pathname === "/family/learn" && endUrl.searchParams.get("child") === "isabel", endUrl.pathname + endUrl.search);
  await page.waitForSelector("[data-testid='home-map'], [data-testid='workshop-hub'], [data-testid='world-screen'], [data-testid='cockpit-start'], [data-testid='start-visit']", { timeout: 40000 });
  if (MAP_START) await page.waitForSelector("[data-testid='home-map']", { timeout: 40000 }).catch(() => null);
  check("I.end-shows-the-map", MAP_START ? (await page.locator("[data-testid='home-map']").count()) === 1 : true);
  await settle(1500);
  await shot(page, "end-on-the-map");
  await keepSeq(page);
  await voiceChecks(page, "I");
  const v5 = JSON.parse(fs.readFileSync(new URL("../src/data/family-learning/content/isabel-workshop-v4.json", import.meta.url), "utf8")).missions.find((m) => m.visit === "v5");
  const opening = Object.fromEntries(v5.steps.filter((st) => st.intro?.length).map((st) => [st.id, st.intro[0].text.normalize("NFC").replace(/\s+/g, " ").trim()]));
  const visited = new Set(seqEvents.filter((e) => e.e === "screen").map((e) => e.k.split(":")[1]));
  sequenceChecks("I", {
    opening: Object.fromEntries(Object.entries(opening).filter(([id]) => visited.has(id))),
    heard: ["Bauen wir ihnen ein Haus?", "Ob sie einziehen?", "Schau! Die zwei Vögel landen auf dem Dach.", "Dein Vogelhaus steht jetzt im Garten. Bis bald!"],
    exactly: { "Ob sie einziehen?": 1, "Schau! Die zwei Vögel landen auf dem Dach.": 1 },
  });
  check("I.pictures-actually-checked", picturesSeen >= 15, picturesSeen);
  await c.close();
}

const labels = async (page, label) => {
  const r = await page.locator("[data-testid='home-map']").evaluate((e) => ({ overlaps: e.dataset.labelOverlaps, missing: e.dataset.missing, pieces: e.dataset.pieces, unplaced: e.dataset.unplaced }));
  check(`M.labels.${label}`, !r.overlaps && !r.missing && !r.unplaced, r);
  return r;
};

/** After both visits: the built pieces, the child's choice on the map, the labels under their own pieces. */
async function mapAfter(child, wanted) {
  const c = await ctx("assistant");
  const page = await c.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(`${BASE}/family/learn?child=${child}`);
  await page.waitForSelector("[data-testid='home-map'][data-ready='true']", { timeout: 40000 });
  await settle(3000);
  const r = await labels(page, `${child}.after`);
  check(`M.${child}.built-pieces`, wanted.every((w) => r.pieces.includes(w)), r.pieces);
  await shot(page, `map-${child}-after-the-visit`);
  await c.close();
}

/** The start from the home map, with the new pieces on it. */
async function map(child, place, firstStep, pieces) {
  const c = await ctx("assistant");
  const page = await c.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  const missing = [];
  page.on("response", (r) => { if (r.url().includes("/family/home-map/") && r.status() >= 400) missing.push(r.url()); });
  await page.goto(`${BASE}/family/learn?child=${child}`);
  await page.waitForSelector("[data-testid='home-map'][data-ready='true'], [data-testid='home-map']", { timeout: 40000 });
  await settle(2500);
  await labels(page, `${child}.offered`);
  await shot(page, `map-${child}-before-the-visit`);
  for (const id of pieces.before) check(`M.${child}.loads-${id}`, await page.evaluate(async (u) => (await fetch(u)).ok, `/family/home-map/${id}.png`));
  await page.goto(`${BASE}/family/learn/mission?child=${child}&enter=${place}`);
  if (child === "santiago") {
    await page.waitForSelector("[data-testid='nokt-sidebar'][data-dock='welcome']", { timeout: 25000 });
    await settle(1500);
    await shot(page, `map-${child}-welcome`);
    await page.locator("[data-testid='nokt-dock-close']").click();
    await page.waitForSelector(`[data-testid='scene-panel'][data-step='${firstStep}']`, { timeout: 15000 });
    check(`M.${child}.opening-scene-after-welcome`, true);
  } else {
    await page.waitForSelector(`[data-testid='workshop-scene'][data-step='${firstStep}']`, { timeout: 25000 });
    check(`M.${child}.opening-scene`, true);
  }
  await settle(500);
  await page.goto(`${BASE}/family/learn?child=${child}`);
  await page.waitForSelector("[data-testid='home-map'][data-ready='true']", { timeout: 40000 });
  await settle(2500);
  await labels(page, `${child}.running`);
  await shot(page, `map-${child}-during-the-visit`);
  check(`M.${child}.no-missing-file`, missing.length === 0, missing.slice(0, 4));
  await c.close();
}

try {
  if (WHO === "santiago") await santiago();
  else if (WHO === "isabel") await isabel();
  else if (WHO === "map-s") await map("santiago", "beach", "T1-BEACH", { before: ["s-pond-site", "s-turtle-crate-built", "s-pond-dug-built", "portrait-dr-mateo", "turtle-scene"] });
  else if (WHO === "after-s") await mapAfter("santiago", ["s-pond:built", "s-turtle-crate:built"]);
  else if (WHO === "after-i") await mapAfter("isabel", ["i-birdhouse:built"]);
  else if (WHO === "map-i") await map("isabel", "birdhouse", "IV1-HELLO", { before: ["i-birdhouse-site", "i-birdhouse-red-built", "i-robins"] });
} catch (error) {
  check("harness-completed", false, String(error).slice(0, 500));
  const p = browser.contexts()[0]?.pages()[0];
  if (p) await p.screenshot({ path: path.join(OUT, `${WHO}-${PATH}-CRASH.png`) }).catch(() => null);
}
check("no-page-errors", pageErrors.length === 0, pageErrors.slice(0, 4));
check("no-external-requests", external.length === 0, external.slice(0, 4));
await browser.close();
fs.writeFileSync(path.join(OUT, `results-${WHO}-${PATH}${MAP_START ? "-map" : ""}.json`), JSON.stringify({ results, clips: { real: clipLog.real.size, newLines: clipLog.fresh.size, unknown: clipLog.unknown }, tts: ttsLog.length, sequence: seqCounts, mic: micTimings, events: seqEvents.length, eventLog: seqEvents }, null, 1));
if (Object.keys(seqCounts).length) console.log("sequence", JSON.stringify(seqCounts), "mic", JSON.stringify(micTimings));
const failed = results.filter((r) => !r.ok);
console.log(`\n${WHO}/${PATH}: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
