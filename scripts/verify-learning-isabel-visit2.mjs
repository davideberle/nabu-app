#!/usr/bin/env node
// ---------------------------------------------------------------------------------------------------------------------
// Isabel Visit 2 — «Idas Garten» + the narration standard: the rendered, FAKE-ONLY journey on an isolated fictional database
// (loopback server, synthetic AUTH_SECRET, no provider, no network, audio guarded). Never production, never a real child's record.
//
//   AUTH_SECRET=… node scripts/verify-learning-isabel-visit2.mjs --base http://127.0.0.1:3296 --db <dir>/nabu.db --out <dir> --mode v2
//   AUTH_SECRET=… node scripts/verify-learning-isabel-visit2.mjs --base http://127.0.0.1:3298 --db <dir>/nabu.db --out <dir> --mode cap1
//
// --mode v2   (server with Santiago's Nokt conversation ON, as in production): a synthetic Isabel Visit 1 (she chose the wall,
//             tapped «Einen Garten bauen») finished through the API → Family Home → Lernen → Idas Garten → every beat with
//             automatic German narration, a wrong answer + hint + fresh application, the easier path, Stopp/resume and the
//             «Vorlesen» after a reload, supported reading, listening, the optional craft, her garden, the spoken closing and
//             goodbye → Home; speech cancellation on navigation; no German voice; autoplay refused; clip/prepare routes without
//             a voice; Visit 1 records byte-identical; the stored Visit 1 summary corrected on read only; parent evidence and
//             observation; child isolation against a synthetic Santiago record; no Nokt, no microphone.
// --mode cap1 (FAMILY_LEARNING_ISABEL_CONTENT_CAP=1): the released visit set — Visit 1 finished, nothing further, Visit 2 parked.
// Speech: the device voices are MOCKED (a German «Anna» and an English default), every utterance is recorded and ends after a
// moment; nothing is audible (the browser audio guard is installed and the host is muted). Silent passes are NOT audio acceptance.
// ---------------------------------------------------------------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { encode } from "@auth/core/jwt";
import { chromium } from "/Users/claweberle/.npm-global/lib/node_modules/playwright/index.mjs";
import { audioSafeChromiumLaunchOptions, installBrowserAudioGuard } from "./lib/browser-audio-guard.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const require = createRequire(import.meta.url);
const { createClient } = require("@libsql/client");
const BASE = opt("--base", "http://127.0.0.1:3296").replace(/\/$/, "");
const OUT = opt("--out", "/tmp/family-learning-isabel-v2");
const DB = opt("--db", null);
const MODE = opt("--mode", "v2");
const SECRET = process.env.AUTH_SECRET;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE)) throw new Error("--base must be a loopback origin (never production)");
if (!SECRET || SECRET.length < 32 || !DB || !fs.existsSync(path.dirname(DB))) {
  console.error("AUTH_SECRET (>= 32 chars, same as the server) and an existing local --db directory are required");
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });
const COOKIE = "authjs.session-token";
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail: detail === undefined ? null : detail });
  console.log(ok ? "PASS" : "FAIL", name, detail === undefined ? "" : JSON.stringify(detail).slice(0, 400));
}
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const mint = (email) => encode({ token: { email, sub: email, name: email }, secret: SECRET, salt: COOKIE, maxAge: 3600 });
const owner = await mint("info@davideberle.com");
const assistant = await mint("assistant@davideberle.com");
const TZ = "Europe/Zurich";
async function api(method, url, body, cookie = assistant, bearer) {
  const r = await fetch(BASE + url, { method, redirect: "manual", headers: { ...(cookie ? { cookie: `${COOKIE}=${cookie}` } : {}), "content-type": "application/json", ...(bearer ? { authorization: "Bearer " + bearer } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try {
    json = await r.json();
  } catch {
    json = null;
  }
  return { status: r.status, json };
}
async function mintChild(childId) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const r = await api("POST", "/api/family/learning/session", { childId });
    if (r.json?.token) return r.json.token;
    if (r.status !== 429) throw new Error(`child session mint: ${r.status}`);
    await settle(2000);
  }
  throw new Error("child session mint window did not roll");
}
async function query(sql, args = []) {
  const c = createClient({ url: "file:" + DB });
  try {
    return (await c.execute({ sql, args })).rows;
  } finally {
    c.close();
  }
}
const sha = (s) => createHash("sha256").update(String(s)).digest("hex");
async function row(child) {
  const r = (await query("SELECT state_json, revision, mission_id, content_version FROM family_learning_missions WHERE child_id = ?", [child]))[0];
  return r ? { state: JSON.parse(String(r.state_json)), revision: Number(r.revision), missionId: String(r.mission_id), contentVersion: Number(r.content_version), hash: sha(r.state_json) } : null;
}

// --------------------------------------------------------------------------------------------------------------------------
// Fixtures: a synthetic Santiago record and a synthetic finished Isabel Visit 1 (through the real API, her own credential)
// --------------------------------------------------------------------------------------------------------------------------
const santiagoBearer = await mintChild("santiago");
{
  const v = await api("GET", `/api/family/learning/mission?tz=${TZ}`, null, assistant, santiagoBearer);
  const put = await api("PUT", "/api/family/learning/mission", { op: { op: "start-visit" }, expectedRevision: v.json.view.revision, idempotencyKey: "santiago-fixture-start", context: { erasureGeneration: v.json.view.erasureGeneration ?? 0, visit: null }, tz: TZ }, assistant, santiagoBearer);
  if (put.status !== 200) throw new Error(`santiago fixture: ${put.status}`);
}
const santiagoBefore = await row("santiago");
const santiagoRowsBefore = Number((await query("SELECT COUNT(*) AS n FROM family_learning_attempts WHERE child_id = 'santiago'"))[0].n);
const isabelBearer = await mintChild("isabel");
let ivView = (await api("GET", `/api/family/learning/mission?tz=${TZ}`, null, assistant, isabelBearer)).json.view;
let opNo = 0;
async function iop(op) {
  opNo += 1;
  const r = await api("PUT", "/api/family/learning/mission", { op, expectedRevision: ivView.revision, idempotencyKey: `isabel-v1-fixture-${opNo}`, context: { erasureGeneration: ivView.erasureGeneration ?? 0, visit: ivView.visit ? { id: ivView.visit.id, startedAt: ivView.visit.startedAt } : null }, tz: TZ }, assistant, isabelBearer);
  if (r.status !== 200 || !r.json?.view) throw new Error(`isabel fixture op ${JSON.stringify(op).slice(0, 80)}: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  ivView = r.json.view;
  return r.json;
}
const mis = (action) => iop({ op: "mission", action });
{
  await iop({ op: "start-visit" });
  for (const [step, actions] of [
    ["W1-HELLO", [{ a: "story-done", step: "W1-HELLO" }]],
    ["W2-MAKE", [{ a: "decide", step: "W2-MAKE", option: "wall" }]],
    ["W3-MATERIALS", [["chair", "Holz"], ["window", "Glas"], ["wall", "Ziegel"]].map(([question, value]) => ({ a: "answer-question", step: "W3-MATERIALS", question, value }))],
    ["W4-COUNT", [{ a: "answer-part", step: "W4-COUNT", part: "plus", value: "7" }, { a: "answer-part", step: "W4-COUNT", part: "minus", value: "6" }]],
    ["W5-TENS", [{ a: "answer-part", step: "W5-TENS", part: "total", value: "21" }]],
    ["W8-READ", [{ a: "answer-question", step: "W8-READ", question: "word", value: "Ast" }]],
    ["W9-LISTEN", [{ a: "support", step: "W9-LISTEN", kind: "play" }, { a: "listen-outcome", step: "W9-LISTEN", outcome: "browser" }, { a: "answer-question", step: "W9-LISTEN", question: "show", value: "Fenster" }]],
    ["W10-CRAFT", [{ a: "craft-found", step: "W10-CRAFT", items: ["table", "spoon", "door"] }, { a: "story-done", step: "W10-CRAFT" }]],
    ["W11-ROOM", [{ a: "story-done", step: "W11-ROOM" }]],
  ]) {
    await mis({ a: "open", step });
    for (const a of actions) await mis(a);
    if (step !== "W11-ROOM") await mis({ a: "leave" });
  }
  await mis({ a: "finish" });
  await iop({ op: "closing-feedback", feedback: { difficulty: "easy" } });
  await iop({ op: "reflect", interest: { kind: "choice", choice: "garden" } });
}
const v1Snapshot = async () => {
  const r = await row("isabel");
  const attempts = await query("SELECT * FROM family_learning_attempts WHERE child_id = 'isabel' AND visit_id = 'v1' ORDER BY created_at, id");
  const supports = await query("SELECT * FROM family_learning_support_events WHERE child_id = 'isabel' AND visit_id = 'v1' ORDER BY created_at, id");
  const completion = await query("SELECT * FROM family_learning_completions WHERE child_id = 'isabel' AND visit_id = 'v1'");
  return { run: sha(JSON.stringify(r.state.missions["MISSION-OLD-LILA-WORKSHOP"])), visit: sha(JSON.stringify(r.state.visits.find((v) => v.id === "v1"))), interest: sha(JSON.stringify((r.state.interests ?? []).filter((i) => i.visit === "v1"))), attempts: sha(JSON.stringify(attempts)), supports: sha(JSON.stringify(supports)), completion: sha(JSON.stringify(completion)), nAttempts: attempts.length };
};
// The stored Visit 1 review as production's older derivation wrote it (October 28): the choice praised, the shelf named. Synthetic.
{
  const c = (await query("SELECT completion_id, review_json FROM family_learning_completions WHERE child_id = 'isabel' AND visit_id = 'v1'"))[0];
  const review = JSON.parse(String(c.review_json));
  review.learning.childSummary.success = { text: "Was baust du?: „wall“ — ohne Hilfe, beim ersten Versuch.", basis: "MISSION-OLD-LILA-WORKSHOP/W2-MAKE independent" };
  review.learning.childSummary.artifact = { kind: "mission", text: "Im Zimmer: ein Regal." };
  await query("UPDATE family_learning_completions SET review_json = ? WHERE child_id = 'isabel' AND completion_id = ?", [JSON.stringify(review), String(c.completion_id)]);
}
const v1Before = await v1Snapshot();

// --------------------------------------------------------------------------------------------------------------------------
// Browser: device voices mocked (German «Anna» + English default), every utterance recorded with the scene step at that moment
// --------------------------------------------------------------------------------------------------------------------------
const browser = await chromium.launch(audioSafeChromiumLaunchOptions({ headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] }));
const blocked = [];
const pageErrors = [];
const noktCalls = [];
const ttsCalls = [];
const probe = (voices, opts = {}) => `(() => {
  const s = globalThis.speechSynthesis;
  globalThis.__speech = []; globalThis.__cancel = 0; globalThis.__clips = [];
  const step = () => document.querySelector("[data-testid='workshop-scene']")?.dataset.step || document.querySelector("[data-testid='workshop-closing']")?.dataset.step || (document.querySelector("[data-testid='workshop-farewell']") ? "farewell" : "");
  let pending = null;
  if (s) {
    const speak = (u) => { globalThis.__speech.push({ text: u.text, lang: u.lang, step: step(), at: Date.now() }); pending = u; setTimeout(() => { if (pending === u) { pending = null; if (globalThis.__speechFail) { u.onerror && u.onerror({ error: "synthesis-failed" }); } else { u.onend && u.onend(); } } }, globalThis.__speechMs || 30); };
    const cancel = () => { globalThis.__cancel += 1; const u = pending; pending = null; if (u && u.onerror) u.onerror({ error: "interrupted" }); };
    try { Object.defineProperty(s, "speak", { configurable: false, writable: false, value: speak }); } catch {}
    try { Object.defineProperty(s, "cancel", { configurable: false, writable: false, value: cancel }); } catch {}
    try { Object.defineProperty(s, "getVoices", { configurable: false, writable: false, value: () => ${JSON.stringify(voices)} }); } catch {}
  }
  const proto = globalThis.HTMLMediaElement && HTMLMediaElement.prototype;
  if (proto) {
    const play = function () {
      if (String(this.src).startsWith("blob:")) {
        if (globalThis.__denyAudio) return Promise.reject(new DOMException("denied", "NotAllowedError"));
        globalThis.__clips.push({ step: step(), at: Date.now() });
        setTimeout(() => this.dispatchEvent(new Event("ended")), 30);
      }
      return Promise.resolve();
    };
    try { Object.defineProperty(proto, "play", { configurable: false, writable: false, value: play }); } catch {}
  }
  globalThis.__denyAudio = ${opts.denyAudio ? "true" : "false"};
  const md = globalThis.navigator && navigator.mediaDevices;
  if (md && md.getUserMedia) { const orig = md.getUserMedia.bind(md); md.getUserMedia = (c) => { globalThis.__gum = (globalThis.__gum || 0) + 1; return orig(c); }; }
})();`;
const GERMAN = [{ name: "Samantha", lang: "en-US", default: true, localService: true }, { name: "Anna", lang: "de-DE", default: false, localService: true }];
async function makeCtx(options, cookie = assistant, voices = GERMAN, extra = {}) {
  const c = await browser.newContext(options);
  await c.addInitScript(probe(voices, extra));
  await installBrowserAudioGuard(c);
  await c.route("**/*", async (r) => {
    const u = new URL(r.request().url());
    if (u.origin !== BASE) {
      blocked.push(u.origin);
      return r.abort("blockedbyclient");
    }
    if (/\/api\/family\/assistant\/tts/.test(u.pathname)) {
      ttsCalls.push(u.pathname);
      return r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "No voice for this language" }) });
    }
    if (extra.clips && u.pathname.startsWith("/api/family/learning/narration/")) return r.fulfill({ status: 200, contentType: "audio/mpeg", body: Buffer.from("UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQIAAAAAAA==", "base64") }); // a valid silent clip
    if (u.pathname.startsWith("/api/family/learning/nokt/")) noktCalls.push(u.pathname);
    if (/\/api\/family\/(transcribe|assistant\/session)/.test(u.pathname)) {
      blocked.push(`${u.origin}${u.pathname}`);
      return r.abort("blockedbyclient");
    }
    return r.continue();
  });
  await c.addCookies([{ name: COOKIE, value: cookie, url: BASE }]);
  return c;
}
let shotN = 0;
const shots = [];
async function shot(page, name, fullPage = false) {
  shotN += 1;
  const file = path.join(OUT, `${String(shotN).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage });
  shots.push(path.basename(file));
  return file;
}
const text = async (page, sel = "body") => (await page.locator(sel).first().innerText()).replace(/\s+/g, " ").trim();
const allSpoken = [];
const spoken = async (page) => {
  const list = await page.evaluate(() => globalThis.__speech);
  for (const x of list) allSpoken.push(x.text);
  return list;
};
const spokenTexts = async (page) => (await spoken(page)).map((s) => s.text);
const clearSpoken = async (page) => {
  await spoken(page);
  await page.evaluate(() => { globalThis.__speech = []; });
};
async function heard(page, needle, timeout = 10000) {
  await page.waitForFunction((n) => (globalThis.__speech || []).some((s) => s.text.includes(n)), needle, { timeout });
}
async function onStep(page, step, status) {
  await page.waitForSelector(`[data-testid='workshop-scene'][data-step='${step}']${status ? `[data-status='${status}']` : ""}`, { timeout: 20000 });
}
async function narrationIdle(page) {
  await page.waitForFunction(() => { const c = document.querySelector("[data-testid='narration-control']"); return c && c.dataset.state !== "speaking"; }, null, { timeout: 20000 });
}
const saved = (page) => page.waitForResponse((r) => r.url().includes("/api/family/learning/mission") && r.request().method() === "PUT", { timeout: 15000 });
async function next(page) {
  const d = saved(page);
  await page.locator("[data-testid='workshop-next']").first().click();
  await d;
  await settle(300);
}
async function answerNumber(page, value) {
  await page.locator("[data-testid='part-input']").fill(String(value));
  const done = saved(page);
  await page.locator("[data-testid='part-check']").click();
  await done;
  await settle(350);
}
/** Text burden of a narrated screen: visible words in the scene (bubble + task), and the speech controls on it. */
const burden = [];
async function measure(page, name) {
  const words = (await text(page, "[data-testid='workshop-scene'], [data-testid='workshop-closing'], [data-testid='workshop-farewell']")).split(" ").filter(Boolean).length;
  const controls = await page.locator("[data-testid='narration-control']").count();
  const perLine = await page.locator("[data-testid='workshop-line-audio'], [data-testid='craft-task-audio-build'], [data-testid='craft-find-audio'], [data-testid='read-letters-audio'], [data-testid='workshop-recap-audio'], [data-testid='debrief-recap-audio']").count();
  burden.push({ screen: name, words, narrationControls: controls, perLineSpeechButtons: perLine });
  return { words, controls, perLine };
}
const runOf = async () => (await row("isabel"))?.state.missions?.["MISSION-IDA-GARDEN"] ?? null;
const rec = { mode: MODE, base: BASE, startedAt: new Date().toISOString() };
const VIEW = { viewport: { width: 1440, height: 900 } }; // Mac mini browser window (actual use device), not the iPad

if (MODE === "voices-off") {
  // ---------------------------------------------------------------- Ids configured, children's switch off: nothing changes for them
  const iv = await api("GET", `/api/family/learning/mission?tz=${TZ}`, null, assistant, isabelBearer);
  const sv = await api("GET", `/api/family/learning/mission?tz=${TZ}`, null, assistant, santiagoBearer);
  check("VO.children-get-no-story-voices-before-the-switch", JSON.stringify(iv.json?.view?.storyVoices) === "[]" && JSON.stringify(sv.json?.view?.storyVoices) === "[]");
  const r = await api("GET", "/api/family/learning/parent/narration", null, owner);
  check("VO.owner-can-already-prepare-and-audition", r.json?.readiness?.slots?.every((x) => x.configured === true) && r.json.readiness.ready === false);
} else if (MODE === "voices") {
  // ---------------------------------------------------------------- Selected voices configured (fake ids), nothing recorded yet
  const ctx = await makeCtx(VIEW);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(`${BASE}/family/learn?child=isabel`);
  await page.waitForSelector("[data-testid='world-screen'][data-child='isabel'][data-world-next='v2']", { timeout: 30000 });
  await page.locator("[data-testid='cockpit-start']").click();
  await page.locator("[data-testid='start-visit']").click();
  await onStep(page, "IG1-HELLO");
  await page.waitForSelector("[data-testid='narration-control'][data-state='missing']", { timeout: 15000 });
  await settle(800);
  check("V.selected-voice-never-replaced-missing-is-conspicuous", (await spoken(page)).length === 0 && (await text(page, "[data-testid='narration-control']")).includes("Aufnahme fehlt"), await spoken(page));
  check("V.visit-still-usable", await page.locator("[data-testid='workshop-next']").isEnabled());
  const sv = await api("GET", `/api/family/learning/mission?tz=${TZ}`, null, assistant, santiagoBearer);
  check("V.children-see-only-configured-slot-names-never-ids", JSON.stringify(sv.json?.view?.storyVoices) === JSON.stringify(["de-female", "es-female", "en-female"]) && !JSON.stringify(sv.json).includes("FakeVoice"));
  await shot(page, "V-isabel-missing-recording");
  const r = await api("GET", "/api/family/learning/parent/narration", null, owner);
  const rd = r.json?.readiness;
  check("V.readiness-gate-not-ready-per-child-and-slot", rd?.ready === false && JSON.stringify(rd.children.map((c) => [c.child, c.lines, c.characters, c.personal])) === JSON.stringify([["isabel", 123, 4731, 0], ["santiago", 9, 552, 0]]) && JSON.stringify(rd.slots.map((x) => [x.slot, x.configured, x.lines, x.characters])) === JSON.stringify([["de-female", true, 123, 4731], ["es-female", true, 6, 162], ["en-female", true, 3, 390]]) && !JSON.stringify(r.json).includes("FakeVoice"), rd);
  // Owner decision 2026-10-29 12:05: the three name lines are recorded as fixed variants without the name, bound to their source line.
  const variants = r.json.lines.filter((l) => l.sources?.length);
  check("V.name-lines-spoken-as-fixed-variants-bound-to-their-source", JSON.stringify(variants.map((l) => [l.slot, l.text]).sort()) === JSON.stringify([["en-female", "Hello! The new beds are ready. Put the tomatoes next to the door. Put the beans at the back, on the left. Thank you!"], ["es-female", "¡Gracias! Hasta pronto."], ["es-female", "¡Hola!"]]) && variants.every((l) => l.sources.length === 1 && /^n[0-9a-f]{28}$/.test(l.sources[0])) && !r.json.lines.some((l) => /santi|isabel|eberle/i.test(`${l.text} ${l.id} ${(l.sources ?? []).join(" ")}`)) && r.json.lines.every((l) => !l.personal) && r.json.lines.length === 132, variants);
  check("V.no-owner-budget-configured-nothing-can-be-sent", r.json.budget === null);
  for (const [label, extra] of [["missing", {}], ["recorded", { clips: true }]]) {
    const oc = await makeCtx(VIEW, owner, GERMAN, extra);
    const op = await oc.newPage();
    op.on("pageerror", (e) => pageErrors.push(String(e)));
    await op.goto(`${BASE}/family/learn/parent?child=santiago`);
    await op.waitForSelector("[role='tab']", { timeout: 30000 });
    await op.locator("[role='tab']", { hasText: "Einstellungen" }).click();
    await op.waitForSelector("[data-testid='narration-audition']", { timeout: 20000 });
    const rosa = r.json.lines.find((l) => l.child === "santiago" && l.slot === "es-female" && !l.personal);
    const group = rosa.where[0];
    await op.locator(`[data-testid='audition-group-${group}'] summary`).click();
    await op.locator(`[data-testid='audition-line-${rosa.slot}-${rosa.id}'] button`).click();
    await op.waitForFunction((k) => document.querySelector(`[data-testid='audition-line-${k}']`)?.dataset.heard, `${rosa.slot}-${rosa.id}`, { timeout: 10000 });
    const heardAs = await op.locator(`[data-testid='audition-line-${rosa.slot}-${rosa.id}']`).getAttribute("data-heard");
    const devSpoken = await op.evaluate(() => (globalThis.__speech || []).length);
    if (label === "missing") check("V.santiago-rosa-spanish-missing-recording-shown-no-substitute", heardAs === "⚠ Aufnahme fehlt" && devSpoken === 0, { heardAs, devSpoken });
    else check("V.santiago-rosa-spanish-plays-her-es-female-recording", heardAs === "Aufnahme" && devSpoken === 0 && (await op.evaluate(() => globalThis.__clips.length)) === 1, { heardAs });
    if (label === "missing") {
      check("V.owner-panel-says-not-ready", (await op.locator("[data-testid='audition-ready'][data-ready='false']").count()) === 1);
      if ((await op.locator("[data-testid='audition-confirm']").count()) === 1) await op.locator("[data-testid='audition-confirm']").check();
      check("V.owner-panel-without-budget-cannot-record", (await text(op, "[data-testid='audition-budget']")).includes("Kein Aufnahme-Budget") && (await op.locator("[data-testid='audition-prepare-run']").isDisabled()));
      await shot(op, "V-owner-panel-not-ready", true);
    }
    await oc.close();
  }
} else if (MODE === "branches") {
  // ---------------------------------------------------------------- Every remaining branch, rendered, with a screenshot each
  const ctx = await makeCtx(VIEW);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(`${BASE}/family/learn?child=isabel`);
  await page.waitForSelector("[data-testid='world-screen'][data-child='isabel'][data-world-next='v2']", { timeout: 30000 });
  await page.locator("[data-testid='cockpit-start']").click();
  await page.locator("[data-testid='start-visit']").click();
  await onStep(page, "IG1-HELLO");
  await narrationIdle(page);
  await next(page);
  await onStep(page, "IG2-PLANT");
  await narrationIdle(page);
  const d = saved(page);
  await page.locator("[data-testid='make-tree']").click();
  await d;
  await narrationIdle(page);
  await shot(page, "B-IG2-chosen");
  await next(page);
  // Tens: three misses → stuck line → the worked solution on request → a wrong copy → the right copy.
  await onStep(page, "IG3-STICKS");
  for (const v of [12, 12, 50]) { await answerNumber(page, v); await narrationIdle(page); }
  check("B.repeat-of-her-own-number-never-spoken", !(await spokenTexts(page)).some((t) => /\b12\b|\b50\b/.test(t)));
  await shot(page, "B-IG3-stuck");
  // The one hint control: the guided step first (with its small question), then the worked solution on request.
  for (let i = 0; i < 4 && !(await page.locator("[data-testid='part-teach']").count()); i += 1) {
    if (await page.locator("[data-testid='hint-solution']").count()) {
      const c = saved(page);
      await page.locator("[data-testid='hint-solution']").click();
      await c;
    } else if (await page.locator("[data-testid='hint-check-input']").count()) {
      await page.locator("[data-testid='hint-check-input']").fill("30");
      const c = saved(page);
      await page.locator("[data-testid='hint-check-send']").click();
      await c;
    } else if (await page.locator("[data-testid='hint-open']").count()) {
      const c = saved(page);
      await page.locator("[data-testid='hint-open']").click();
      await c;
    }
    await settle(400);
  }
  await page.waitForSelector("[data-testid='part-teach']", { timeout: 10000 });
  await heard(page, "3 Bündel sind 10, 20, 30 Stäbe.");
  check("B.worked-solution-spoken-only-after-it-is-shown", (await runOf()).steps["IG3-STICKS"].parts.total.phase === "taught");
  await narrationIdle(page);
  await shot(page, "B-IG3-solution");
  await answerNumber(page, 31);
  await heard(page, "Noch nicht. Schau die Lösung oben noch einmal an und trag die Zahl ein.");
  await narrationIdle(page);
  await answerNumber(page, 32);
  await narrationIdle(page);
  check("B.taught-is-never-independent", (await runOf()).steps["IG3-STICKS"].outcome === "answer_exposed" || (await runOf()).steps["IG3-STICKS"].outcome === "supported", (await runOf()).steps["IG3-STICKS"].outcome);
  await next(page);
  await onStep(page, "IG4-STICKS-AGAIN");
  await answerNumber(page, 25);
  await narrationIdle(page);
  await shot(page, "B-IG4-fresh");
  await next(page);
  await onStep(page, "IG5-PLANTING");
  await answerNumber(page, 9);
  await page.locator("[data-testid='solve-next-question']").click();
  await answerNumber(page, 5);
  await page.locator("[data-testid='solve-next-question']").click();
  await answerNumber(page, 4);
  await narrationIdle(page);
  await page.locator("[data-testid='hint-open']").click();
  await heard(page, "Zeig auf jeden leeren Platz und zähl.");
  await narrationIdle(page);
  await shot(page, "B-IG5-hint");
  await answerNumber(page, 3);
  await narrationIdle(page);
  await next(page);
  await onStep(page, "IG6-PLANTING-EASIER");
  await narrationIdle(page);
  await shot(page, "B-IG6-easier");
  await answerNumber(page, 6);
  await narrationIdle(page);
  await next(page);
  // Reading: two misses → the word is shown (never credited); only then spoken.
  await onStep(page, "IG7-READ");
  await narrationIdle(page);
  await page.locator("[data-testid='pick-word-Topf']").click();
  await heard(page, "Schau den ersten Buchstaben an.");
  await narrationIdle(page);
  await page.locator("[data-testid='pick-word-Igel']").click();
  await heard(page, "Das Wort heisst: Nest.");
  check("B.word-shown-after-two-misses-not-credited", (await runOf()).steps["IG7-READ"].outcome === "answer_exposed");
  await narrationIdle(page);
  await shot(page, "B-IG7-word-shown");
  await next(page);
  // Listening: the play fails on the device → the adult may read it (help) → two misses → the answer is shown.
  await onStep(page, "IG8-LISTEN");
  await narrationIdle(page);
  await page.evaluate(() => { globalThis.__speechFail = true; });
  await page.locator("[data-testid='listen-play']").click();
  await page.waitForSelector("[data-testid='listen-adult-open']", { timeout: 15000 });
  let lo = [];
  for (let i = 0; i < 20 && !lo.length; i += 1) {
    lo = await query("SELECT payload_json FROM family_learning_support_events WHERE child_id='isabel' AND kind='mission_listen_outcome' AND task_id='MISSION-IDA-GARDEN/IG8-LISTEN'");
    if (!lo.length) await settle(250);
  }
  await page.evaluate(() => { globalThis.__speechFail = false; });
  check("B.failed-play-recorded-as-failed", lo.some((r) => JSON.parse(String(r.payload_json)).outcome === "failed"), lo.map((r) => JSON.parse(String(r.payload_json)).outcome));
  const tr = saved(page);
  await page.locator("[data-testid='listen-adult-open']").click();
  await tr;
  await page.waitForSelector("[data-testid='listen-adult-read']");
  await shot(page, "B-IG8-adult-read");
  await page.locator("[data-testid='pick-show-Käfer auf dem Blatt']").click();
  await heard(page, "Hör noch einmal genau hin");
  await narrationIdle(page);
  await page.locator("[data-testid='pick-show-Schnecke unter dem Blatt']").click();
  await heard(page, "Gemeint war: Schnecke auf dem Blatt.");
  check("B.listening-with-adult-reading-is-help", ["answer_exposed", "supported"].includes((await runOf()).steps["IG8-LISTEN"].outcome));
  await narrationIdle(page);
  await shot(page, "B-IG8-given");
  await next(page);
  // Craft skipped (optional): nothing found, nothing inferred.
  await onStep(page, "IG9-CRAFT");
  await narrationIdle(page);
  await next(page);
  check("B.craft-skipped-nothing-inferred", JSON.stringify((await runOf()).steps["IG9-CRAFT"].found ?? []) === "[]");
  await onStep(page, "IG10-GARDEN");
  await narrationIdle(page);
  const ending = await text(page, "[data-testid='workshop-ending']");
  check("B.ending-honest-after-help", (await page.locator("[data-testid='workshop-garden'][data-grown='garden-tree']").count()) === 1 && !/super|toll|perfekt|bravo/i.test(ending), ending);
  await shot(page, "B-IG10-garden");
  await next(page);
  await onStep(page, "IG10-GARDEN", "done");
  await narrationIdle(page);
  const fin = saved(page);
  await page.locator("[data-testid='workshop-next']").click();
  await fin;
  // Closing: both questions skipped honestly, then «Weiss ich noch nicht».
  await page.waitForSelector("[data-testid='workshop-closing'][data-step='difficulty']", { timeout: 20000 });
  await heard(page, "Lieber nicht sagen");
  await narrationIdle(page);
  await page.locator("[data-testid='difficulty-skip']").click();
  await page.waitForSelector("[data-testid='workshop-closing'][data-step='enjoyment']");
  await narrationIdle(page);
  await shot(page, "B-closing-enjoyment");
  await page.locator("[data-testid='enjoyment-skip']").click();
  await page.waitForSelector("[data-testid='workshop-closing'][data-step='next']");
  await narrationIdle(page);
  await page.locator("[data-testid='next-interest-unsure']").click();
  const rf = saved(page);
  await page.locator("[data-testid='closing-finish']").click();
  await rf;
  await page.waitForSelector("[data-testid='workshop-farewell']", { timeout: 20000 });
  await narrationIdle(page);
  const done = await row("isabel");
  const v2rec = done.state.visits.find((v) => v.id === "v2");
  check("B.skips-saved-as-skipped-unsure-as-unsure", (v2rec.feedback?.skipped ?? []).includes("difficulty") && (v2rec.feedback?.skipped ?? []).includes("enjoyment") && (done.state.interests ?? []).some((i) => i.visit === "v2" && i.kind === "unsure"), { fb: v2rec.feedback, interests: done.state.interests });
  await shot(page, "B-farewell");
  check("B.visit-1-records-untouched", JSON.stringify(await v1Snapshot()) === JSON.stringify(v1Before));
} else if (MODE === "novoice" || MODE === "denied") {
  // ---------------------------------------------------------------- I2-06 device variants on their own database
  const ctx = MODE === "novoice"
    ? await makeCtx(VIEW, assistant, [{ name: "Samantha", lang: "en-US", default: true }, { name: "Daniel", lang: "en-GB" }, { name: "Eddy (Deutsch (Deutschland))", lang: "de-DE" }])
    : await makeCtx(VIEW, assistant, GERMAN, { clips: true, denyAudio: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(`${BASE}/family/learn?child=isabel`);
  await page.waitForSelector("[data-testid='world-screen'][data-child='isabel'][data-world-next='v2']", { timeout: 30000 });
  await page.locator("[data-testid='cockpit-start']").click();
  await page.waitForSelector("[data-testid='start-visit']", { timeout: 30000 });
  await page.locator("[data-testid='start-visit']").click();
  await onStep(page, "IG1-HELLO");
  if (MODE === "novoice") {
    await page.waitForSelector("[data-testid='narration-control'][data-state='unavailable']", { timeout: 15000 });
    check("I2-06.no-german-voice-means-silence-never-an-english-or-novelty-voice", (await spoken(page)).length === 0 && ttsCalls.length === 0, await spoken(page));
    check("I2-06.no-german-voice-is-visible-not-silent-failure", (await text(page, "[data-testid='narration-control']")).includes("Keine Stimme"));
    check("I2-04.visit-still-usable-without-audio", await page.locator("[data-testid='workshop-next']").isEnabled());
    await shot(page, "novoice");
  } else {
    await page.waitForSelector("[data-testid='narration-control'][data-state='blocked']", { timeout: 15000 });
    check("I2-04.autoplay-refused-shows-one-vorlesen-tap", (await text(page, "[data-testid='narration-control']")).includes("Vorlesen") && (await spoken(page)).length === 0);
    await shot(page, "autoplay-refused");
    await page.evaluate(() => { globalThis.__denyAudio = false; });
    await page.locator("[data-testid='narration-control']").click();
    await page.waitForFunction(() => (globalThis.__clips || []).length >= 2, null, { timeout: 15000 });
    await narrationIdle(page);
    check("I2-06.recorded-clips-preferred-over-the-device-voice", (await spoken(page)).length === 0 && (await page.evaluate(() => globalThis.__clips.length)) >= 2, { spoken: await spoken(page), clips: await page.evaluate(() => globalThis.__clips.length) });
  }
} else if (MODE === "cap1") {
  // ---------------------------------------------------------------- Rollback: her released visit set only
  const v = await api("GET", `/api/family/learning/mission?tz=${TZ}`, null, assistant, isabelBearer);
  check("CAP1.content-v1-served-visit-2-not-offered", v.json?.view?.contentVersion === 1 && v.json?.view?.next?.visit === null && !v.json?.view?.visitText, { next: v.json?.view?.next, cv: v.json?.view?.contentVersion });
  const page = await (await makeCtx(VIEW)).newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(`${BASE}/family/learn?child=isabel`);
  await page.waitForSelector("[data-testid='world-screen'][data-child='isabel']", { timeout: 30000 });
  const hub = await text(page);
  check("CAP1.hub-is-the-released-workshop-done", hub.includes("Old Lilas kleine Werkstatt") && (await page.locator("[data-testid='cockpit-start']").count()) === 0 && !/Gärtnerin|Idas Garten|Zum Garten/.test(hub), hub.slice(0, 200)); // «Einen Garten bauen» is her own saved wish, correctly shown
  const ev = await api("GET", "/api/family/learning/parent/evidence?child=isabel", null, owner);
  check("CAP1.parent-evidence-readable", ev.status === 200);
  check("CAP1.visit-1-records-untouched", JSON.stringify(await v1Snapshot()) === JSON.stringify(v1Before));
  // Release configuration: Visit 2 parked, yet the recordings can be prepared and auditioned on the exact build.
  const ready = await api("GET", "/api/family/learning/parent/narration", null, owner);
  check("CAP1.catalogue-available-while-visit-2-is-parked", ready.status === 200 && ready.json?.readiness?.lines === ready.json?.lines?.length && ready.json.lines.length > 100, ready.json?.readiness);
  const clip = await api("GET", `/api/family/learning/narration/${ready.json.lines[0].slot}/${ready.json.lines[0].id}`, null, assistant);
  check("CAP1.isabel-in-the-gardeners-slot-santiago-in-his-characters-slots", ready.json.lines.filter((l) => l.child === "isabel").every((l) => l.slot === "de-female") && JSON.stringify(ready.json.readiness.slots.map((x) => [x.slot, x.configured])) === JSON.stringify([["de-female", false], ["es-female", false], ["en-female", false]]) && ready.json.readiness.ready === false, ready.json.readiness.slots);
  check("CAP1.clip-route-knows-the-catalogue-under-the-cap", clip.status === 404 && clip.json?.error === "Not recorded", clip);
  const oc = await makeCtx(VIEW, owner, GERMAN, { clips: true });
  const op = await oc.newPage();
  op.on("pageerror", (e) => pageErrors.push(String(e)));
  await op.goto(`${BASE}/family/learn/parent?child=isabel`);
  await op.waitForSelector("[role='tab']", { timeout: 30000 });
  await op.locator("[role='tab']", { hasText: "Isabel" }).click();
  await op.locator("[role='tab']", { hasText: "Einstellungen" }).click();
  await op.waitForSelector("[data-testid='narration-audition']", { timeout: 20000 });
  const first = ready.json.lines.find((l) => l.where.includes("IG1-HELLO"));
  await op.locator(`[data-testid='audition-group-IG1-HELLO'] summary`).click();
  await op.locator(`[data-testid='audition-line-${first.slot}-${first.id}'] button`).click();
  await op.waitForFunction((id) => document.querySelector(`[data-testid='audition-line-${id}']`)?.dataset.heard, `${first.slot}-${first.id}`, { timeout: 10000 });
  check("CAP1.owner-audition-plays-the-recording-without-a-visit", (await op.locator(`[data-testid='audition-line-${first.slot}-${first.id}']`).getAttribute("data-heard")) === "Aufnahme" && (await op.evaluate(() => globalThis.__clips.length)) === 1, await op.locator(`[data-testid='audition-line-${first.slot}-${first.id}']`).getAttribute("data-heard"));
  check("CAP1.prepare-needs-the-spend-confirmation", (await op.locator("[data-testid='audition-prepare-run']").isDisabled()));
  await shot(op, "owner-audition", true);
  check("CAP1.audition-started-no-visit", JSON.stringify(await v1Snapshot()) === JSON.stringify(v1Before) && (await row("isabel")).state.visits.length === 1);
  await oc.close();
} else {
  const ctx = await makeCtx(VIEW);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  // ---------------------------------------------------------------- I2-01 Continuity: her existing hub, Visit 2 next, Old Lila hers
  await page.goto(`${BASE}/family/home?child=isabel`);
  await page.waitForSelector("text=Lernen", { timeout: 30000 });
  check("I2-01.home-learning-entry-no-nokt", (await page.locator("[data-testid='home-nokt-open']").count()) === 0);
  await page.locator("a[href*='/family/learn?child=isabel'], a[href*='/family/learn'][href*='isabel']").first().click();
  await page.waitForSelector("[data-testid='world-screen'][data-child='isabel'][data-world-next='v2']", { timeout: 30000 });
  const hub = await text(page);
  check("I2-01.hub-offers-visit-2-after-completed-visit-1", hub.includes("Idas Garten") && hub.includes("Heute baust du mit Gärtnerin Ida einen Garten.") && hub.includes("Ein Besuch fertig") && hub.includes("Für nächstes Mal: «Einen Garten bauen»"), hub.slice(0, 260));
  check("I2-02.old-lila-is-her-assistant-on-the-hub", /old lila/i.test(hub) && !/Nokt|Santiago|Expedition|Insel/.test(hub));
  await shot(page, "hub");
  await page.locator("[data-testid='cockpit-start']").click();
  await page.waitForSelector("[data-testid='start-screen'][data-child='isabel']", { timeout: 30000 });
  await settle(800);
  check("I2-04.nothing-spoken-before-the-deliberate-start", (await spoken(page)).length === 0);
  await shot(page, "start");

  // ---------------------------------------------------------------- I2-04 Narration after the deliberate start; I2-02 the gardener
  await page.locator("[data-testid='start-visit']").click();
  await onStep(page, "IG1-HELLO");
  await heard(page, "Hallo! Ich bin Ida, die Gärtnerin.");
  await heard(page, "Heute bauen wir zusammen einen Garten.");
  const first = await spoken(page);
  check("I2-04.scene-spoken-by-itself-after-start", first.length >= 2 && first.every((s) => s.lang === "de-DE"), first.map((s) => [s.text, s.lang]));
  check("I2-06.explicit-german-voice-never-the-english-default", first.every((s) => /^de/.test(s.lang)));
  const scene = await text(page, "[data-testid='workshop-bubble']");
  check("I2-02.story-character-is-the-gardener-not-old-lila", (await page.locator("[data-testid='workshop-speaker']").textContent()) === "Gärtnerin Ida" && (await page.locator("[data-testid='gardener-portrait']").count()) >= 1 && !/old lila/i.test(scene) && (await page.locator("[data-testid='workshop-scene'] [data-testid='assistant-portrait'], [data-testid='workshop-scene'] img[alt*='Lila']").count()) === 0, scene);
  let b = await measure(page, "IG1-HELLO");
  check("I2-04.one-replay-stop-control-no-per-line-buttons", b.controls === 1 && b.perLine === 0, b);
  check("I2-02.row-one-short-instruction", (await page.locator("[data-testid='workshop-line']").count()) <= 2);
  const r1 = await row("isabel");
  check("I2-01.visit-2-started-under-her-own-content", r1.missionId === "isabel-workshop" && r1.contentVersion === 2 && r1.state.visits.map((v) => v.id).join(",") === "v1,v2" && r1.state.upgradedAt === null, { cv: r1.contentVersion, visits: r1.state.visits.map((v) => v.id), upgradedAt: r1.state.upgradedAt });
  await narrationIdle(page);
  await shot(page, "IG1-hello");

  // ---------------------------------------------------------------- Speech cancellation on navigation (slow device speech)
  await page.evaluate(() => { globalThis.__speechMs = 2500; });
  await page.locator("[data-testid='narration-control']").click(); // «Nochmal hören»
  await page.waitForFunction(() => document.querySelector("[data-testid='narration-control']")?.dataset.state === "speaking", null, { timeout: 5000 });
  const cancelsBefore = await page.evaluate(() => globalThis.__cancel);
  await clearSpoken(page);
  await next(page); // story-done + leave → IG2 (a story beat goes straight on, as in Visit 1)
  await onStep(page, "IG2-PLANT");
  await page.evaluate(() => { globalThis.__speechMs = 30; });
  await heard(page, "Was soll in deinem Garten wachsen?");
  await settle(600);
  const afterNav = await spoken(page);
  const stale = afterNav.filter((s) => s.step === "IG2-PLANT" && /Hallo! Ich bin Ida|Heute bauen wir zusammen|Komm mit in den Garten/.test(s.text));
  check("I2-04.navigation-cancels-old-speech-no-stale-or-overlap", (await page.evaluate(() => globalThis.__cancel)) > cancelsBefore && stale.length === 0, { cancels: (await page.evaluate(() => globalThis.__cancel)) - cancelsBefore, stale });
  check("I2-04.does-not-auto-advance-when-speech-ends", (await page.locator("[data-testid='workshop-scene'][data-step='IG2-PLANT'][data-status='active']").count()) === 1);
  await narrationIdle(page);
  await settle(1500);
  check("I2-04.still-on-the-same-beat-after-speech", (await page.locator("[data-testid='workshop-scene'][data-step='IG2-PLANT'][data-status='active']").count()) === 1);
  b = await measure(page, "IG2-PLANT");
  await shot(page, "IG2-choose");

  // ---------------------------------------------------------------- I2-02 Meaningful choice (never scored)
  await clearSpoken(page);
  const d2 = saved(page);
  await page.locator("[data-testid='make-flowers']").click();
  await d2;
  await heard(page, "Du hast Blumen gewählt.");
  check("I2-05.choice-recorded-unscored", (await runOf()).steps["IG2-PLANT"].attempts[0].choice === "flowers" && (await runOf()).steps["IG2-PLANT"].attempts[0].correct !== false);
  await narrationIdle(page);
  await next(page);

  // ---------------------------------------------------------------- I2-03 Fresh tens retrieval 32 (not 21): wrong → hint after try → right; fresh 25
  await onStep(page, "IG3-STICKS");
  await heard(page, "3 Bündel und 2 einzelne Stäbe");
  check("I2-03.fresh-pictured-tens-not-21", (await page.locator("[data-testid='counters'][data-a='30'][data-b='2'][data-bundles='true']").count()) === 1);
  check("I2-05.math-answer-never-spoken-as-instruction", !(await spokenTexts(page)).some((t) => /\b32\b/.test(t)));
  check("I2-03.no-hint-before-a-first-try", (await page.locator("[data-testid='hint-open']").count()) === 0);
  b = await measure(page, "IG3-STICKS");
  await narrationIdle(page);
  await shot(page, "IG3-sticks");
  await clearSpoken(page);
  await answerNumber(page, 23);
  await heard(page, "Noch nicht. Schau: In jedem Bündel sind 10 Stäbe.");
  check("I2-04.wrong-answer-feedback-spoken", (await spokenTexts(page)).includes("Noch nicht. Schau: In jedem Bündel sind 10 Stäbe."));
  await narrationIdle(page);
  await page.locator("[data-testid='hint-open']").click();
  await heard(page, "Wie viele Stäbe sind in 3 Bündeln?");
  await page.locator("[data-testid='hint-check-input']").fill("30");
  await page.locator("[data-testid='hint-check-send']").click();
  await heard(page, "Genau, 30.");
  await narrationIdle(page);
  await shot(page, "IG3-hint");
  await clearSpoken(page);
  await answerNumber(page, 32);
  await heard(page, "Richtig! 32 Stäbe.");
  const tens = (await runOf()).steps["IG3-STICKS"];
  check("I2-05.first-attempt-and-help-preserved", tens.outcome === "supported" && tens.attempts.filter((a) => a.kind === "answer").map((a) => a.raw).join(",") === "23,32", { outcome: tens.outcome, raw: tens.attempts.map((a) => a.raw) });
  await narrationIdle(page);
  await next(page);
  await onStep(page, "IG4-STICKS-AGAIN");
  await heard(page, "2 Bündel und 5 einzelne Stäbe");
  check("I2-03.fresh-application-only-after-supported-retrieval", (await page.locator("[data-testid='counters'][data-a='20'][data-b='5']").count()) === 1);
  await answerNumber(page, 25);
  await narrationIdle(page);
  await next(page);

  // ---------------------------------------------------------------- I2-03 Slightly extended small numbers; the easier path when needed
  await onStep(page, "IG5-PLANTING");
  await heard(page, "6 Tulpen sind im Beet.");
  check("I2-03.visible-counters-as-garden-things", (await page.locator("[data-testid='counters'][data-a='6'][data-b='3'] svg[data-part='added']").count()) === 3);
  await answerNumber(page, 9);
  await page.locator("[data-testid='solve-next-question']").click();
  await heard(page, "9 Erdbeeren. Ida pflückt 4.");
  await answerNumber(page, 6);
  await heard(page, "Zähl nur die Erdbeeren ohne Kreuz.");
  await answerNumber(page, 5);
  await page.locator("[data-testid='solve-next-question']").click();
  await heard(page, "Hier ist Platz für 10 Töpfe.");
  check("I2-03.missing-part-to-ten-frame", (await page.locator("[data-testid='counters'][data-frame='10'] svg[data-part='empty']").count()) === 3);
  b = await measure(page, "IG5-PLANTING-ten");
  await narrationIdle(page);
  await shot(page, "IG5-ten-frame");
  await answerNumber(page, 3);
  await narrationIdle(page);
  await next(page);
  await onStep(page, "IG6-PLANTING-EASIER");
  check("I2-03.easier-path-after-a-supported-small-sum", (await runOf()).steps["IG5-PLANTING"].outcome !== "independent");

  // ---------------------------------------------------------------- Stop / resume; after the reload only «Vorlesen» speaks
  await narrationIdle(page);
  await page.locator("[data-testid='hud-stop']").click();
  await page.waitForSelector("[data-testid='world-screen'][data-child='isabel']", { timeout: 30000 });
  check("I2-01.stop-saves-and-offers-continue", (await text(page, "[data-testid='cockpit-start']")).includes("Weiter"));
  await clearSpoken(page);
  await page.locator("[data-testid='cockpit-start']").click();
  await onStep(page, "IG6-PLANTING-EASIER");
  await page.waitForSelector("[data-testid='narration-control'][data-state='locked']", { timeout: 10000 });
  await settle(800);
  check("I2-04.resume-speaks-nothing-until-tapped", (await spoken(page)).length === 0);
  await shot(page, "resume-vorlesen");
  await page.locator("[data-testid='narration-control']").click();
  await heard(page, "4 Samen und 2 Samen");
  check("I2-04.vorlesen-reads-the-current-screen", (await spokenTexts(page)).some((t) => t.includes("4 Samen und 2 Samen")));
  await answerNumber(page, 6);
  await narrationIdle(page);
  await next(page);

  // ---------------------------------------------------------------- I2-05 Reading NEST: never spoken before her attempt; letters first
  await onStep(page, "IG7-READ");
  await clearSpoken(page);
  await page.reload();
  await onStep(page, "IG7-READ");
  await page.locator("[data-testid='narration-control'][data-state='locked']").click();
  await heard(page, "Hier steht ein Wort.");
  await narrationIdle(page);
  check("I2-05.reading-word-and-options-not-spoken-before-attempt", !(await spokenTexts(page)).some((t) => /nest|igel|topf/i.test(t)), await spokenTexts(page));
  check("I2-05.options-are-pictures-without-word-labels", (await text(page, "[data-testid='question-word']")).trim() === "" || !/Nest|Igel|Topf/.test(await text(page, "[data-testid='question-word']")));
  b = await measure(page, "IG7-READ");
  await shot(page, "IG7-read");
  await page.locator("[data-testid='pick-word-Igel']").click();
  await heard(page, "Schau den ersten Buchstaben an.");
  check("I2-05.after-a-miss-still-not-the-word", !(await spokenTexts(page)).some((t) => /nest/i.test(t)));
  const lt = saved(page);
  await page.locator("[data-testid='read-letters-open']").click();
  await lt;
  await heard(page, "N. E. S. T. Nest.");
  const support = (await runOf()).steps["IG7-READ"].support.map((x) => x.kind);
  check("I2-05.letter-help-recorded-before-the-word-is-spoken", support.includes("letters"), support);
  await narrationIdle(page);
  await shot(page, "IG7-letters");
  await page.locator("[data-testid='pick-word-Nest']").click();
  await heard(page, "Richtig — zusammen mit den Buchstaben.");
  check("I2-05.never-independent-reading-after-letters", (await runOf()).steps["IG7-READ"].outcome === "supported");
  await narrationIdle(page);
  await next(page);

  // ---------------------------------------------------------------- I2-03/05 Listening: separate, explicit recorded play, answers locked before
  await onStep(page, "IG8-LISTEN");
  await heard(page, "Tipp auf das Ohr und hör gut zu.");
  await narrationIdle(page);
  check("I2-05.listening-options-and-sentence-not-narrated", !(await spokenTexts(page)).some((t) => /schnecke|käfer|blatt/i.test(t)));
  check("I2-03.answers-locked-until-heard", await page.locator("[data-testid='pick-show-Schnecke auf dem Blatt']").isDisabled());
  b = await measure(page, "IG8-LISTEN");
  await shot(page, "IG8-listen");
  await clearSpoken(page);
  await page.locator("[data-testid='listen-play']").click();
  await heard(page, "Zeig mir die Schnecke auf dem Blatt.");
  await page.waitForFunction(() => !document.querySelector("[data-testid='pick-show-Schnecke auf dem Blatt']")?.hasAttribute("disabled"), null, { timeout: 10000 });
  const lrun = (await runOf()).steps["IG8-LISTEN"];
  check("I2-06.listening-outcome-recorded-as-german-device-voice", lrun.plays === 1 && lrun.completedPlays === 1 && (await query("SELECT payload_json FROM family_learning_support_events WHERE child_id='isabel' AND kind='mission_listen_outcome' AND task_id = 'MISSION-IDA-GARDEN/IG8-LISTEN'")).some((r) => JSON.parse(String(r.payload_json)).outcome === "device-de"));
  await page.locator("[data-testid='pick-show-Schnecke unter dem Blatt']").click();
  await heard(page, "Hör noch einmal genau hin");
  await page.locator("[data-testid='pick-show-Schnecke auf dem Blatt']").click();
  await heard(page, "Richtig.");
  check("I2-05.listening-recorded-apart-from-reading", (await runOf()).steps["IG8-LISTEN"].outcome === "supported");
  await narrationIdle(page);
  await next(page);

  // ---------------------------------------------------------------- I2-02 Optional real-world garden craft (her own report, unverified)
  await onStep(page, "IG9-CRAFT");
  await heard(page, "Such drei Dinge, die wachsen.");
  await narrationIdle(page);
  check("I2-02.craft-pictured-optional-no-speech-buttons", (await page.locator("[data-testid='craft-task-build'] svg[data-picture='garden-flowers']").count()) === 1 && (await page.locator("[data-testid^='craft-task-audio']").count()) === 0);
  for (const id of ["flower", "grass", "tree", "houseplant"]) await page.locator(`[data-testid='found-${id}']`).click();
  check("I2-02.three-things-at-most", (await page.locator("[data-testid^='found-'][aria-pressed='true']").count()) === 3);
  await page.locator("[data-testid='found-save']").click();
  await page.waitForFunction(() => document.querySelector("[data-testid='found-save']")?.textContent?.includes("Gespeichert"), null, { timeout: 10000 });
  b = await measure(page, "IG9-CRAFT");
  await shot(page, "IG9-craft", true);
  await next(page);

  // ---------------------------------------------------------------- Ending: her garden, recap, honest success + open item — all spoken
  await onStep(page, "IG10-GARDEN");
  await heard(page, "Im Garten wachsen Blumen.");
  await narrationIdle(page);
  const endSpoken = await spokenTexts(page);
  check("I2-04.ending-spoken", endSpoken.includes("Schau, das ist dein Garten.") && endSpoken.includes("Im Garten wachsen Blumen.") && endSpoken.some((t) => /^Nächstes Mal/.test(t)), endSpoken.slice(-5));
  check("I2-05.garden-shows-her-choice", (await page.locator("[data-testid='workshop-garden'][data-grown='garden-flowers']").count()) === 1);
  const ending = await text(page, "[data-testid='workshop-ending']");
  check("I2-05.no-false-praise-honest-open-item", !/super|toll|perfekt|bravo|meisterin|gewählt/i.test(ending) && ending.includes("Nächstes Mal"), ending);
  b = await measure(page, "IG10-GARDEN");
  await shot(page, "IG10-garden");
  await next(page); // Fertig
  await onStep(page, "IG10-GARDEN", "done");
  await heard(page, "Danke! Bis bald im Garten!");
  await narrationIdle(page);
  const fin = saved(page);
  await page.locator("[data-testid='workshop-next']").click();
  await fin;

  // ---------------------------------------------------------------- The spoken closing, one question per screen, then the spoken goodbye
  await page.waitForSelector("[data-testid='workshop-closing'][data-step='difficulty']", { timeout: 20000 });
  await heard(page, "Wie war es heute?");
  await heard(page, "Schwer");
  check("I2-04.closing-question-and-choices-spoken", (await spokenTexts(page)).includes("Leicht") && (await spokenTexts(page)).includes("Genau richtig"));
  check("I2-02.no-nokt-no-microphone-in-the-closing", (await page.locator("[data-testid='nokt-debrief'], [data-testid='debrief']").count()) === 0);
  b = await measure(page, "closing-difficulty");
  await narrationIdle(page);
  await shot(page, "closing-difficulty");
  await page.locator("[data-testid='difficulty-easy']").click();
  await page.waitForSelector("[data-testid='workshop-closing'][data-step='enjoyment']");
  await heard(page, "Hat es dir Spass gemacht?");
  await narrationIdle(page);
  await page.locator("[data-testid='enjoyment-yes']").click();
  await page.waitForSelector("[data-testid='workshop-closing'][data-step='next']");
  await heard(page, "Was möchtest du nächstes Mal machen?");
  await heard(page, "Oder sag Papa oder Mama deine eigene Idee.");
  b = await measure(page, "closing-next");
  check("I2-02.next-interest-pictured", (await page.locator("[data-testid^='adventure-'] svg[data-picture^='next-']").count()) === 3);
  await narrationIdle(page);
  await shot(page, "closing-next");
  await page.locator("[data-testid='adventure-birdhouse']").click();
  const reflect = saved(page);
  await page.locator("[data-testid='closing-finish']").click();
  await reflect;
  await page.waitForSelector("[data-testid='workshop-farewell']", { timeout: 20000 });
  await heard(page, "Dein Garten ist gespeichert.");
  check("I2-04.goodbye-spoken-and-visible", (await spokenTexts(page)).includes("Danke! Bis bald im Garten!") && (await text(page, "[data-testid='workshop-farewell']")).includes("Bis bald im Garten"));
  b = await measure(page, "farewell");
  await narrationIdle(page);
  await shot(page, "farewell");
  await page.locator("[data-testid='farewell-home']").click();
  await page.waitForURL(/\/family\/home\?child=isabel/, { timeout: 20000 });
  const done = await row("isabel");
  const v2rec = done.state.visits.find((v) => v.id === "v2");
  check("I2-05.closing-answers-and-her-choice-saved", !!v2rec?.finishedAt && JSON.stringify((done.state.interests ?? []).map((i) => [i.visit, i.kind, i.choice])) === JSON.stringify([["v1", "choice", "garden"], ["v2", "choice", "birdhouse"]]) && v2rec.feedback?.answers?.difficulty === "easy" && v2rec.feedback?.answers?.enjoyment === "yes", { interests: done.state.interests, fb: v2rec?.feedback });
  check("I2-01.one-completion-row-per-visit", Number((await query("SELECT COUNT(*) AS n FROM family_learning_completions WHERE child_id = 'isabel'"))[0].n) === 2);

  // ---------------------------------------------------------------- I2-01 Visit 1 evidence and stable ids untouched (no record rewrite)
  const v1After = await v1Snapshot();
  check("I2-01.visit-1-records-byte-identical", JSON.stringify(v1After) === JSON.stringify(v1Before), { before: v1Before, after: v1After });

  // ---------------------------------------------------------------- Clip and preparation routes without a configured voice
  const cat = await api("GET", "/api/family/learning/parent/narration", null, owner);
  check("I2-06.readiness-reports-names-only-no-voice-configured", cat.status === 200 && cat.json?.readiness?.slots?.every((x) => x.configured === false) && cat.json.readiness.lines > 50 && !JSON.stringify(cat.json).match(/sk_|xi-api|[A-Za-z0-9]{32,}/), cat.json?.readiness);
  rec.narrationReadiness = cat.json?.readiness ?? null;
  const prepNo = await api("POST", "/api/family/learning/parent/narration", { confirm: "yes", maxCharacters: 10 }, owner);
  const prepCfg = await api("POST", "/api/family/learning/parent/narration", { confirm: "prepare-narration", maxCharacters: 10 }, owner);
  const prepChild = await api("POST", "/api/family/learning/parent/narration", { confirm: "prepare-narration", maxCharacters: 10 }, assistant);
  check("I2-06.prepare-needs-owner-confirmation-and-a-voice-no-provider-call", prepNo.status === 400 && prepCfg.status === 503 && prepCfg.json?.result?.status === "not-configured" && prepCfg.json.result.personalSkipped === 0 && (prepChild.status === 403 || prepChild.status === 401), { no: prepNo.status, cfg: prepCfg.json?.result, child: prepChild.status });
  const clipUnknown = await api("GET", "/api/family/learning/narration/de-female/n0000000000000000000000000000", null, assistant);
  const clipAnon = await api("GET", "/api/family/learning/narration/de-female/n0000000000000000000000000000", null, null);
  check("I2-06.clip-route-serves-only-recorded-catalogued-lines", clipUnknown.status === 404 && (clipAnon.status === 401 || clipAnon.status === 307 || clipAnon.status === 302), { unknown: clipUnknown.status, anon: clipAnon.status });

  // ---------------------------------------------------------------- I2-05 Parent: Visit 1 summary corrected on read; stored row unchanged
  const compBefore = sha(JSON.stringify(await query("SELECT * FROM family_learning_completions WHERE child_id = 'isabel' AND visit_id = 'v1'")));
  const ev = await api("GET", "/api/family/learning/parent/evidence?child=isabel", null, owner);
  const v1c = (ev.json?.evidence?.completions ?? ev.json?.completions ?? []).find((c) => c.visitId === "v1");
  const cs = v1c?.review?.learning?.childSummary;
  check("I2-05.v1-summary-corrected-on-read-wall-not-shelf-no-choice-praise", cs?.artifact?.text === "Im Zimmer: eine Wand." && !/wall|Was baust du/.test(JSON.stringify(cs)) && v1c?.review?.learning?.childSummaryCorrection?.stored?.artifact?.text === "Im Zimmer: ein Regal.", { now: cs, stored: v1c?.review?.learning?.childSummaryCorrection?.stored });
  check("I2-05.stored-completion-row-not-rewritten", sha(JSON.stringify(await query("SELECT * FROM family_learning_completions WHERE child_id = 'isabel' AND visit_id = 'v1'"))) === compBefore);
  const pctx = await makeCtx({ viewport: { width: 1280, height: 900 } }, owner);
  const pp = await pctx.newPage();
  pp.on("pageerror", (e) => pageErrors.push(String(e)));
  await pp.goto(`${BASE}/family/learn/parent?child=isabel`);
  await pp.waitForSelector("[role='tab']", { timeout: 30000 });
  await pp.locator("[role='tab']", { hasText: "Isabel" }).click();
  await pp.waitForSelector("[data-testid='parent-mission-evidence'][data-mission='MISSION-IDA-GARDEN']", { timeout: 30000 });
  const ig3 = await text(pp, "[data-testid='evidence-IG3-STICKS']");
  check("I2-05.parent-exact-answers-and-help-in-order", /«23» ✗ .*«32» ✓/.test(ig3) && /Hinweis|hint/i.test(ig3), ig3.slice(0, 300));
  check("I2-05.parent-reading-supported-listening-apart", (await text(pp, "[data-testid='evidence-IG7-READ']")).includes("Buchstabenhilfe") && (await text(pp, "[data-testid='evidence-IG8-LISTEN']")).includes("getrennt von Lesen"));
  await pp.locator("[data-testid='observation-v2-build-done']").click();
  await settle(1200);
  await shot(pp, "parent-evidence", true);
  await pp.locator("[role='tab']", { hasText: "Rückblick" }).click();
  await pp.waitForSelector("[data-testid='review-v1']", { timeout: 20000 });
  const note = await text(pp, "[data-testid='review-v1']");
  check("I2-05.parent-sees-correction-note-with-stored-wording", (await pp.locator("[data-testid='review-v1'] [data-testid='review-child-summary-corrected']").count()) === 1 && note.includes("Im Zimmer: eine Wand.") && note.includes("Gespeichert:") && note.includes("Im Zimmer: ein Regal."), note.slice(0, 400));
  const obs = await query("SELECT payload_json FROM family_learning_support_events WHERE child_id = 'isabel' AND kind = 'parent_observation' AND visit_id = 'v2'");
  check("I2-05.parent-observation-distinct-from-child-attempts", obs.length >= 1 && JSON.parse(String(obs[0].payload_json)).recordedBy === "parent" && Number((await query("SELECT COUNT(*) AS n FROM family_learning_attempts WHERE child_id = 'isabel' AND task_id LIKE '%IG9-CRAFT%'"))[0].n) === 0, obs.map((o) => JSON.parse(String(o.payload_json))));
  await shot(pp, "parent-review", true);

  // ---------------------------------------------------------------- Child isolation (both directions); no Nokt; no microphone
  const iv = await api("GET", `/api/family/learning/mission?tz=${TZ}`, null, assistant, isabelBearer);
  const sv = await api("GET", `/api/family/learning/mission?tz=${TZ}`, null, assistant, santiagoBearer);
  check("I2-08.each-credential-gets-its-own-content", iv.json?.view?.child === "isabel" && sv.json?.view?.child === "santiago" && !JSON.stringify(sv.json.view).includes("Gärtnerin Ida") && !sv.json.view.visitText && !JSON.stringify(sv.json.view).includes("\"narration\""));
  const cross = await api("PUT", "/api/family/learning/mission", { op: { op: "mission", action: { a: "open", step: "H1-PLAN" } }, expectedRevision: iv.json.view.revision, idempotencyKey: "isabel-cross-v2", context: { erasureGeneration: iv.json.view.erasureGeneration ?? 0, visit: null } }, assistant, isabelBearer);
  check("I2-08.santiago-steps-unreachable-with-isabels-credential", cross.status === 422 || cross.status === 409, cross.status);
  const nokt = await api("POST", "/api/family/learning/nokt/turn/dispatch", { purpose: "home", sessionId: "isabel-sess-2", turnId: "isabel-turn-0002", expectedRevision: iv.json.view.revision, context: { erasureGeneration: 0, visit: null } }, assistant, isabelBearer);
  check("I2-02.no-live-ai-nokt-refuses-isabel", nokt.status === 404 || nokt.status === 503, nokt.status);
  const santiagoAfter = await row("santiago");
  const santiagoRowsAfter = Number((await query("SELECT COUNT(*) AS n FROM family_learning_attempts WHERE child_id = 'santiago'"))[0].n);
  check("I2-08.santiago-record-byte-identical", santiagoAfter.hash === santiagoBefore.hash && santiagoRowsAfter === santiagoRowsBefore);
  check("I2-08.isabel-records-under-her-own-content-id", Number((await query("SELECT COUNT(*) AS n FROM family_learning_attempts WHERE child_id = 'isabel' AND mission_id != 'isabel-workshop'"))[0].n) === 0);
  check("I2-06.no-microphone-ever", (await page.evaluate(() => globalThis.__gum || 0)) === 0);
  check("I2-06.no-live-tts-route-used-by-the-narrated-visit", ttsCalls.length === 0, ttsCalls.length);
  await pctx.close();
}

// --------------------------------------------------------------------------------------------------------------------------
// Device variants on a second synthetic child state are not possible after the finished visit, so they run as separate modes:
// --mode novoice / --mode denied start a fresh Isabel Visit 2 on their own database (see the reproduction script).
// --------------------------------------------------------------------------------------------------------------------------
// Every text the device actually spoke in this run is a catalogued (prerecordable) line — rendered coverage, all modes.
{
  const cat = await api("GET", "/api/family/learning/parent/narration", null, owner);
  const texts = new Set((cat.json?.lines ?? []).map((l) => l.text));
  const outside = [...new Set(allSpoken)].filter((t) => !texts.has(t));
  check("COMMON.every-spoken-line-is-catalogued", cat.status === 200 && texts.size > 100 && outside.length === 0, { catalogued: texts.size, spokenDistinct: new Set(allSpoken).size, outside });
  rec.spokenDistinct = new Set(allSpoken).size;
}
check("COMMON.no-external-requests", blocked.length === 0, blocked.slice(0, 5));
check("COMMON.no-page-errors", pageErrors.length === 0, pageErrors.slice(0, 3));
check("COMMON.no-nokt-call-from-isabels-browser", noktCalls.length === 0, noktCalls);
rec.burden = burden;
rec.screens = shots;
rec.results = results;
rec.passed = results.filter((r) => r.ok).length;
rec.failed = results.filter((r) => !r.ok).length;
fs.writeFileSync(path.join(OUT, `results-${MODE}.json`), JSON.stringify(rec, null, 2));
console.log(`SUMMARY ${MODE}: ${rec.passed} passed, ${rec.failed} failed`);
await browser.close();
process.exit(rec.failed ? 1 : 0);
