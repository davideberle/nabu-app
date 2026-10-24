// Visit 7 (content v6) — rendered journeys of the Rosas Inselgarten scene mission on an ISOLATED local server with a SYNTHETIC
// database. Never points at production: --base must be a loopback origin and --db a local file. Audio is muted (browser audio
// guard, --mute-audio; the speech route is answered by the harness and never reaches a provider); every non-local request is
// aborted and counted.
//
// Fixture (synthetic values, not his records): the five finished visits of the Visit 6 harness, then Visit 6 (internal v7)
// through the child API in the SHAPE of the October 22 record — Kisten (4,4,4) → (4,4,28) → (4,4,5), «Necesitamos kuerdas»,
// S13 «nes» / «Nesesitmos Querdas» / «Necesitamos Querdas», then the stored practice «Necesitamos ue» marked practiced (the
// pre-fix transition, re-created by a row patch exactly as production stored it), closing interest «unsure».
//
// J1 desktop 1280×900: hub → Besuch 7 → every beat with the real-shape mistakes (empty Enter, unchanged repeat, recheck, hint with
// a wrong check and a different representation, stuck → hint, success → distinct next question), Nokt side panel, English
// message, Spanish near miss, typing block in the UI, fresh application first try, one own sentence with one correction,
// truthful ending, illustrated next-adventure choice, report, parent evidence panel.
// J2 iPad 820×1180 (touch): worked teaching after three misses, wrong copy then right copy, audio failure with honest fallback,
// Spanish exhausted → wrong copy stays open → keep for later, global Stopp and resume; 390×844 phone Nokt in the page flow.
// J3 fictional Nokt stub (separate server started with FAMILY_NOKT_FICTIONAL_STUB=1 on the same synthetic DB): REAL push-to-talk
// with Chromium's fake microphone → /api/family/learning/nokt/transcribe (the server's FAKE recognizer — no provider, no key) →
// visible transcript → written reply → reply spoken; nothing recorded as tutor evidence.
//
// Usage: AUTH_SECRET=… node scripts/verify-learning-visit7.mjs --base http://127.0.0.1:3197 --db <dir>/nabu.db --out <dir> [--stub-base http://127.0.0.1:3198]
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
const BASE = opt("--base", "http://127.0.0.1:3186").replace(/\/$/, "");
const OUT = opt("--out", "/tmp/family-learning-visit7");
const DB = opt("--db", null);
const SECRET = process.env.AUTH_SECRET;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE)) throw new Error("--base must be a loopback origin (never production)");
if (!SECRET || SECRET.length < 32 || !DB || !fs.existsSync(path.dirname(DB))) {
  console.error("AUTH_SECRET (>= 32 chars, same as the server) and an existing local --db file are required");
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });
const COOKIE = "authjs.session-token";
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail: detail === undefined ? null : detail });
  console.log(ok ? "PASS" : "FAIL", name, detail === undefined ? "" : JSON.stringify(detail).slice(0, 300));
}
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const mint = (email) => encode({ token: { email, sub: email, name: email }, secret: SECRET, salt: COOKIE, maxAge: 3600 });
const owner = await mint("info@davideberle.com");
const assistant = await mint("assistant@davideberle.com");
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
let bearer = await mintChild("santiago");
const TZ = "Europe/Zurich";
const view = async () => (await api("GET", `/api/family/learning/mission?tz=${TZ}`, null, assistant, bearer)).json.view;
let opN = 0;
const contextOf = (v) => ({ erasureGeneration: v.erasureGeneration, visit: v.visit ? { id: v.visit.id, startedAt: v.visit.startedAt } : null });
async function op(o) {
  const v = await view();
  const r = await api("PUT", "/api/family/learning/mission", { op: o, expectedRevision: v.revision, idempotencyKey: `v7fx-${Date.now()}-${(opN += 1)}`, context: contextOf(v), tz: TZ }, assistant, bearer);
  if (r.status !== 200 || (r.json.status !== "applied" && r.json.status !== "replayed")) throw new Error(`fixture op ${o.op}: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json;
}
async function ack() {
  const v = await view();
  if (v.lastLesson) await op({ op: "lesson-feedback-seen", id: v.lastLesson.id });
}
async function setLayout(layout) {
  const current = await api("GET", "/api/family/learning/parent/settings?child=santiago", null, owner);
  return (await api("PUT", "/api/family/learning/parent/settings", { child: "santiago", expectedErasureGeneration: current.json.erasureGeneration, keyboardLayout: layout }, owner)).status;
}
const lang = (segmentId, stepId, response, modality = "typed") => ({ op: "language-step", segmentId, stepId, response, modality });

/** SYNTHETIC: five finished visits through the child API, the last one with the real-shape Visit 5 mistakes. */
async function fiveVisitsDone() {
  await api("DELETE", "/api/family/learning/parent/records?child=santiago&confirm=santiago", null, owner);
  bearer = await mintChild("santiago");
  for (const o of [{ op: "start-visit" }, { op: "name-base", name: "Fixture Basis" }, { op: "place-base", locationId: "shore" }, { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }]) await op(o);
  await ack();
  await op({ op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" });
  await ack();
  await op({ op: "explain", text: "Ich habe geteilt.", modality: "typed" });
  await op({ op: "skip-stage", stage: "LANG-EN-WATER", reason: "child" });
  await op({ op: "typing-label", taskId: "TYPE-LABEL-BASE", typed: "Fixture Basis", seconds: 20 });
  await ack();
  await op({ op: "save-log", text: "Tag eins." });
  await op({ op: "reflect", optionId: "easy", interest: { kind: "declined" } });
  await op({ op: "start-visit" });
  await op({ op: "resume-base" });
  await op({ op: "answer-math", itemId: "EQ-RETURN", answer: 7, raw: "7", modality: "typed" });
  await ack();
  await op({ op: "skip-stage", stage: "LANG-ES-AGUA", reason: "child" });
  await op({ op: "typing-label", taskId: "TYPE-LABEL-GARDEN", typed: "Garten der Basis", seconds: 30 });
  await ack();
  await op({ op: "save-log", text: "Der Garten ist fertig." });
  await op({ op: "reflect", optionId: "easy", interest: { kind: "declined" } });
  await op({ op: "start-visit" });
  await op({ op: "resume-base" });
  await op({ op: "choose-station", theme: "turtles" });
  if ((await setLayout("ch-de-qwertz")) !== 200) throw new Error("layout");
  await op({ op: "typing-check", observed: ["'", "ö", "z"] });
  for (let i = 0; i < 2; i += 1) {
    await op({ op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["fff jjj", "fj fj jf"], seconds: 15, comfort: "ok" });
    await ack();
  }
  await op({ op: "typing-course-continue" });
  await op({ op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" });
  await ack();
  for (const o of [{ op: "explain", text: "Fünf mal sechs sind dreissig.", modality: "typed" }, lang("LANG-ES-STATION", "listen", "", "listen"), lang("LANG-ES-STATION", "pick", "lámpara", "word-choice"), lang("LANG-ES-STATION", "produce", "necesitamos una lámpara"), lang("LANG-ES-STATION", "reuse", "agua", "word-choice")]) await op(o);
  await ack();
  for (const o of [{ op: "build-station", spot: "beach" }, { op: "save-log", text: "Heute steht die Station." }, { op: "revise-log", text: "Heute steht die Station." }, { op: "write-transfer", text: "Morgen zählen wir 3 Schildkröten.", modality: "typed" }]) await op(o);
  await ack();
  await op({ op: "summary-seen" });
  await op({ op: "reflect", optionId: "easy", interest: { kind: "declined" } });
  await op({ op: "start-visit" });
  await op({ op: "resume-base" });
  for (const [lessonId, lines, rounds] of [["TYPE-CH-COURSE-2", ["ddd kkk", "fdk jkd"], 2], ["TYPE-CH-COURSE-3", ["sss lll", "sdf jkl"], 2], ["TYPE-CH-COURSE-4", ["aaa ööö", "asdf jklö"], 1]]) {
    for (let i = 0; i < rounds; i += 1) {
      await op({ op: "typing-burst", lessonId, lines, seconds: 15, comfort: "ok" });
      await ack();
    }
  }
  await op({ op: "typing-course-continue" });
  await op({ op: "answer-remainder", itemId: "EQ-PIER", used: 42, remaining: 3, raw: "42, 3", modality: "typed" });
  await ack();
  for (const o of [{ op: "explain", text: "Sechs mal sieben ist 42, drei bleiben.", modality: "typed" }, lang("LANG-EN-PIER", "listen", "", "listen"), lang("LANG-EN-PIER", "pick", "wood", "word-choice"), lang("LANG-EN-PIER", "produce", "we need wood"), lang("LANG-EN-PIER", "reuse", "rope", "word-choice")]) await op(o);
  await ack();
  for (const o of [{ op: "build-pier", spot: "bay" }, { op: "save-log", text: "Heute steht der Steg in der Bucht." }, { op: "revise-log", text: "Heute steht der Steg in der Bucht." }, { op: "write-transfer", text: "Morgen bringt das Boot 5 Kisten.", modality: "typed" }]) await op(o);
  await ack();
  await op({ op: "summary-seen" });
  await op({ op: "reflect", optionId: "easy", interest: { kind: "declined" } });
  // Besuch 5 (v6, the harbor) with the real-shape mistakes; the explain stage is deferred by the owner rule.
  await op({ op: "start-visit" });
  for (let guard = 0; guard < 60; guard += 1) {
    const v = await view();
    if (v.lastLesson) {
      await op({ op: "lesson-feedback-seen", id: v.lastLesson.id });
      continue;
    }
    const stage = v.visit?.stage;
    if (!stage) break;
    if (stage === "restore") await op({ op: "resume-base" });
    else if (stage === "island") {
      const wp = v.harbor.workplaces.find((w) => w.status === "open" || w.status === "current");
      await op({ op: "enter-workplace", workplace: wp.id });
    } else if (stage === "typing-course") {
      await op({ op: "typing-burst", lessonId: "TYPE-CH-COURSE-4", lines: ["aaa ööö", "asdf jklö"], seconds: 101, comfort: "easy" });
      await ack();
      await op({ op: "typing-burst", lessonId: "TYPE-CH-COURSE-5", lines: ["ggg hhh", "fgf jlj", "das lag da"], seconds: 62, comfort: "easy" });
      await ack();
      await op({ op: "typing-course-continue" });
    } else if (stage === "EQ-HARBOR") {
      await op({ op: "answer-quotient", itemId: "EQ-HARBOR", full: 4, remaining: 4, raw: "4 voll, 4 übrig", modality: "typed" });
      await op({ op: "answer-quotient", itemId: "EQ-HARBOR", full: 6, remaining: 2, raw: "6 voll, 2 übrig", modality: "typed" });
      await op({ op: "answer-needed", itemId: "EQ-HARBOR", needed: 7, raw: "7", modality: "typed" });
    } else if (stage === "LANG-ES-HARBOR") {
      await op(lang("LANG-ES-HARBOR", "listen", "", "listen"));
      await op(lang("LANG-ES-HARBOR", "produce", "cuerdas"));
      await op(lang("LANG-ES-HARBOR", "produce", "necesitamos herramientas"));
      await op(lang("LANG-ES-HARBOR", "pick", "cuerdas", "word-choice"));
      await op(lang("LANG-ES-HARBOR", "reuse", "agua", "word-choice"));
    } else if (stage === "harbor-build") await op({ op: "plan-harbor", destination: "ship" });
    else if (stage === "log") await op({ op: "save-log", text: "Heutehaben wir Kisten geladen" });
    else if (stage === "EQ-HARBOR-CHECK") {
      await op({ op: "answer-quotient", itemId: "EQ-HARBOR-CHECK", full: 5, remaining: 1, raw: "5 voll, 1 übrig", modality: "typed" });
      await op({ op: "answer-needed", itemId: "EQ-HARBOR-CHECK", needed: 6, raw: "6", modality: "typed" });
    } else if (stage === "LANG-ES-HARBOR-CHECK") {
      await op(lang("LANG-ES-HARBOR-CHECK", "produce", "Necesitamos querdas"));
      await op(lang("LANG-ES-HARBOR-CHECK", "produce", "necesitamos cuerdas"));
    } else if (stage === "log-review") await op({ op: "review-log", text: "Heute haben wir Kisten geladen." });
    else if (stage === "summary") await op({ op: "summary-seen" });
    else if (stage === "reflect") await op({ op: "reflect", optionId: "easy", feedback: { enjoyment: "yes", clarity: "clear" }, interest: { kind: "declined" } });
    else throw new Error(`fixture: unexpected stage ${stage}`);
  }
  // Reduce the stored row to the released version-4 shape: earlier content never asked for interests or ran missions.
  await patchRow((s) => {
    delete s.interests;
    delete s.missions;
    s.contentVersion = 4;
    return s;
  });
}
async function rawRow() {
  const c = createClient({ url: "file:" + DB });
  try {
    const row = (await c.execute("SELECT state_json, revision FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0];
    return { state: JSON.parse(String(row.state_json)), revision: Number(row.revision) };
  } finally {
    c.close();
  }
}
async function rows(table) {
  const c = createClient({ url: "file:" + DB });
  try {
    const r = await c.execute({ sql: `SELECT * FROM ${table} WHERE child_id = 'santiago' ORDER BY rowid`, args: [] });
    return r.rows.map((row) => Object.fromEntries(r.columns.map((k) => [k, row[k]])));
  } finally {
    c.close();
  }
}
async function patchRow(mutate) {
  const c = createClient({ url: "file:" + DB });
  for (let attempt = 0; ; attempt += 1) {
    try {
      const row = (await c.execute("SELECT state_json FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0];
      const next = mutate(JSON.parse(String(row.state_json)));
      await c.execute({ sql: "UPDATE family_learning_missions SET state_json = ?, content_version = ? WHERE child_id = 'santiago'", args: [JSON.stringify(next), next.contentVersion] });
      break;
    } catch (e) {
      if (!/SQLITE_BUSY/.test(String(e)) || attempt >= 50) throw e;
      await settle(100);
    }
  }
  c.close();
}
const sha = (x) => createHash("sha256").update(JSON.stringify(x)).digest("hex");

// --- browser ------------------------------------------------------------------------------------------------------------
// Chromium's synthetic microphone (a test tone, never a person) lets J3 exercise the real recorder → upload path.
const browser = await chromium.launch(audioSafeChromiumLaunchOptions({ headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] }));
const blocked = [];
const speechRequests = [];
/** Nokt microphone uploads seen at the browser edge (shape only — never the audio). */
const noktUploads = [];
/** Silent playback mocks, installed BEFORE the audio guard (the guard then cannot replace them; nothing ever reaches a speaker):
 *  speech "end" | "error" — the browser speech engine confirms the end, or reports an error; voice "ok" — the child voice route
 *  answers with bytes and the media element reports `ended` without playing; voice "fail" — the route answers 503. */
const speechMockScript = (mode) => `(() => {
  const s = globalThis.speechSynthesis;
  if (!s) return;
  const speak = (u) => setTimeout(() => { globalThis.__speechCalls = (globalThis.__speechCalls || 0) + 1; ${mode === "end" ? "u.onend && u.onend()" : "u.onerror && u.onerror()"}; }, 30);
  try { Object.defineProperty(s, "speak", { configurable: false, writable: false, value: speak }); } catch {}
  try { Object.defineProperty(s, "cancel", { configurable: false, writable: false, value: () => {} }); } catch {}
})();`;
const mediaEndedMockScript = `(() => {
  const proto = globalThis.HTMLMediaElement && globalThis.HTMLMediaElement.prototype;
  if (!proto) return;
  const play = function () { const el = this; setTimeout(() => { if (typeof el.onended === "function") el.onended(); }, 40); return Promise.resolve(); };
  try { Object.defineProperty(proto, "play", { configurable: false, writable: false, value: play }); } catch {}
})();`;
async function makeContext(options, cookie = assistant, mocks = {}) {
  const c = await browser.newContext(options);
  if (mocks.speech) await c.addInitScript(speechMockScript(mocks.speech));
  if (mocks.voice === "ok") await c.addInitScript(mediaEndedMockScript);
  await installBrowserAudioGuard(c);
  await c.route("**/*", async (r) => {
    const u = new URL(r.request().url());
    if (u.origin !== BASE) {
      blocked.push(u.origin);
      return r.abort("blockedbyclient");
    }
    if (/\/api\/family\/assistant\/tts/.test(u.pathname)) {
      // The child voice route is the listening path (reviewed text → speech). It is aborted here: no audible playback in tests.
      speechRequests.push({ at: Date.now(), body: r.request().postData(), mock: mocks.voice ?? "abort" });
      // a valid, silent WAV (one zero sample) — decodable, so the element reports no error; play() itself is the silent mock
      if (mocks.voice === "ok") return r.fulfill({ status: 200, contentType: "audio/wav", body: Buffer.from("UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQIAAAAAAA==", "base64") });
      if (mocks.voice === "fail") return r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Text-to-speech is not configured" }) });
      return r.abort("blockedbyclient");
    }
    if (/\/api\/family\/(transcribe|assistant\/session)/.test(u.pathname)) return r.abort("blockedbyclient");
    return r.continue();
  });
  await c.addCookies([{ name: COOKIE, value: cookie, url: BASE }]);
  return c;
}
const pageErrors = [];
let shotN = 0;
async function shot(page, name) {
  shotN += 1;
  const file = path.join(OUT, `${String(shotN).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}
const text = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");
async function waitIdle(page) {
  await page.waitForFunction(() => !document.querySelector("[data-testid='mission-world'] button[disabled][data-testid^='go-']") || true);
  await settle(250);
}
/** What is actually on screen (viewport, not full page): the boxes of the given test ids, the scroll offset, hidden map/lists. */
async function viewportFit(page, selectors) {
  return page.evaluate((sels) => {
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const boxes = sels.map((sel) => {
      const el = document.querySelector(sel);
      if (!el) return { sel, present: false };
      const r = el.getBoundingClientRect();
      return { sel, present: true, top: Math.round(r.top), bottom: Math.round(r.bottom), inView: r.top >= 0 && r.bottom <= vh && r.left >= 0 && r.right <= vw && r.height > 0 };
    });
    const map = document.querySelector("[data-testid='mission-map']");
    return { vh, scrollY: Math.round(window.scrollY), boxes, mapHidden: !map || map.getBoundingClientRect().height === 0, questHidden: !document.querySelector("[data-testid='quest-log']"), notebookHidden: !document.querySelector("[data-testid='notebook']") };
  }, selectors);
}
async function viewportShot(page, name) {
  shotN += 1;
  await page.screenshot({ path: path.join(OUT, `${String(shotN).padStart(2, "0")}-VIEWPORT-${name}.png`), fullPage: false });
}
const TYPING_PARTS = ["[data-testid='typing-line']", "[data-testid='typing-input']", "[data-testid='typing-block'] [data-testid='hands-keyboard']"];
async function walkTo(page, step) {
  // The accessible route: the quest list walks the avatar there (animated on desktop, a jump under reduced motion).
  await page.locator(`[data-testid='go-${step}']`).click();
  try {
    await page.waitForSelector(`[data-testid='open-${step}']`, { timeout: 15000 });
  } catch (e) {
    await shot(page, `FAILURE-walk-${step}`);
    const w = await page.locator("[data-testid='mission-world']").evaluate((el) => ({ ...el.dataset }));
    console.log("walk failure state", JSON.stringify(w), (await text(page)).slice(0, 600));
    throw e;
  }
}
async function openStep(page, step) {
  const go = page.locator(`[data-testid='go-${step}']`);
  if ((await go.innerText()).includes("Starten")) {
    // already standing at the place: the quest list starts the step directly
    await go.click();
    await page.waitForSelector(`[data-testid='scene-panel'][data-step='${step}']`);
    return;
  }
  await walkTo(page, step);
  await page.locator(`[data-testid='open-${step}']`).click();
  await page.waitForSelector(`[data-testid='scene-panel'][data-step='${step}']`);
}
async function cont(page) {
  await page.locator("[data-testid='scene-continue']").click();
  await page.waitForSelector("[data-testid='quest-log']");
}
async function typeLine(page, line) {
  await page.locator("[data-testid='typing-input']").focus();
  await page.keyboard.type(line, { delay: 35 });
  await page.keyboard.press("Enter");
  await settle(120);
}


// ============================================================ Visit 7 additions ============================================================
const STUB_BASE = (opt("--stub-base", "") || "").replace(/\/$/, "");
if (STUB_BASE && !/^http:\/\/127\.0\.0\.1:\d+$/.test(STUB_BASE)) throw new Error("--stub-base must be a loopback origin");
const contentV6 = JSON.parse(fs.readFileSync(new URL("../src/data/family-learning/content/santiago-expedition-v6.json", import.meta.url), "utf8"));
const SHIP = contentV6.missions.find((m) => m.id === "MISSION-SHIP-SUPPLY");
const placeOf = (step) => SHIP.steps.find((s) => s.id === step).place;
const mop = (action) => op({ op: "mission", action });
async function walkOpenApi(step) {
  await mop({ a: "leave" });
  await mop({ a: "arrive", place: placeOf(step) });
  await mop({ a: "open", step });
}

/** SYNTHETIC Visit 6 (internal v7) in the shape of the October 22 record, then the stored pre-fix S13 shape by a row patch. */
async function sixVisitsDone() {
  await fiveVisitsDone();
  await op({ op: "start-visit" });
  await walkOpenApi("S1-BRIEF");
  await mop({ a: "story-done", step: "S1-BRIEF" });
  await walkOpenApi("S2-BOARD");
  await mop({ a: "answer-question", step: "S2-BOARD", question: "boat-max", value: "6" });
  await mop({ a: "answer-question", step: "S2-BOARD", question: "reef-max", value: "4" });
  await walkOpenApi("S3-RADIO");
  await mop({ a: "support", step: "S3-RADIO", kind: "play" });
  await mop({ a: "listen-outcome", step: "S3-RADIO", outcome: "browser" });
  for (const [q, v] of [["crew", "7"], ["bottles", "4"], ["ask", "Seile"]]) await mop({ a: "answer-question", step: "S3-RADIO", question: q, value: v });
  await walkOpenApi("S4-WATER");
  await mop({ a: "answer-calc", step: "S4-WATER", values: { total: 28 }, raw: "28" });
  await walkOpenApi("S5-CRATES");
  for (const [full, rest, needed] of [[4, 4, 4], [4, 4, 28], [4, 4, 5]]) await mop({ a: "answer-calc", step: "S5-CRATES", values: { full, rest, needed }, raw: `${full} ${rest} ${needed}` });
  await walkOpenApi("S6-ROSA");
  await mop({ a: "produce", step: "S6-ROSA", response: "Necesitamos kuerdas", modality: "typed" });
  await mop({ a: "produce", step: "S6-ROSA", response: "Necesitamos cuerdas", modality: "typed" });
  await walkOpenApi("S7-ROSA-REPLY");
  await mop({ a: "support", step: "S7-ROSA-REPLY", kind: "play" });
  await mop({ a: "listen-outcome", step: "S7-ROSA-REPLY", outcome: "browser" });
  await mop({ a: "answer-question", step: "S7-ROSA-REPLY", question: "ropes", value: "5" });
  await walkOpenApi("S8-TOOLS");
  await mop({ a: "produce", step: "S8-TOOLS", response: "Necesitamos herramientas", modality: "typed" });
  await walkOpenApi("S9-LOAD");
  await mop({ a: "answer-calc", step: "S9-LOAD", values: { total: 8, boats: 2 }, raw: "8 2" });
  await walkOpenApi("S10-ROPES");
  await mop({ a: "answer-calc", step: "S10-ROPES", values: { need: 4, left: 1 }, raw: "4 1" });
  await walkOpenApi("S11-ROUTE");
  await mop({ a: "choose", step: "S11-ROUTE", option: "reef-4-4" });
  await walkOpenApi("S12-TYPING");
  await mop({ a: "typing-start" });
  for (let i = 0; i < 8; i += 1) {
    const tv = (await view()).mission.active.typing;
    if (!tv.nextDrill) break;
    await mop({ a: "typing-drill", no: tv.nextDrill.no, lines: tv.nextDrill.lines, seconds: 40, activeSeconds: 31, idleSeconds: 9 });
  }
  await mop({ a: "typing-comfort", comfort: "easy" });
  await mop({ a: "typing-extra", take: false });
  await walkOpenApi("S13-RECALL-CUERDAS");
  for (const r of ["nes", "Nesesitmos Querdas", "Necesitamos Querdas", "Necesitamos agua"]) {
    const v = (await view()).mission.active;
    if (v.phase === "exhausted" || v.status !== "active") break;
    await mop({ a: "produce", step: "S13-RECALL-CUERDAS", response: r, modality: "typed" });
  }
  await mop({ a: "practice", step: "S13-RECALL-CUERDAS", response: "Necesitamos ue" });
  await mop({ a: "later", step: "S13-RECALL-CUERDAS" });
  await walkOpenApi("S14-LAUNCH");
  await mop({ a: "story-done", step: "S14-LAUNCH" });
  await mop({ a: "leave" });
  await mop({ a: "finish" });
  await op({ op: "summary-seen" });
  await op({ op: "reflect", optionId: "easy", feedback: { enjoyment: "yes", clarity: "clear" }, interest: { kind: "unsure" } });
  // The record as production stored it before the shared fix: the wrong practice copy finished S13 as "practiced".
  await patchRow((s) => {
    const r = s.missions["MISSION-SHIP-SUPPLY"].steps["S13-RECALL-CUERDAS"];
    r.status = "practiced";
    r.outcome = "practiced";
    delete r.practiceFails;
    return s;
  });
}

async function makeCtx(base, options, cookie = assistant, mocks = {}) {
  const c = await browser.newContext(options);
  if (mocks.speech) await c.addInitScript(speechMockScript(mocks.speech));
  if (mocks.voice === "ok") await c.addInitScript(mediaEndedMockScript);
  await installBrowserAudioGuard(c);
  await c.route("**/*", async (r) => {
    const u = new URL(r.request().url());
    if (u.origin !== base && !(mocks.allowOrigins ?? []).includes(u.origin)) {
      blocked.push(u.origin);
      return r.abort("blockedbyclient");
    }
    if (/\/api\/family\/assistant\/tts/.test(u.pathname)) {
      // Never forwarded to the server (and so never to a provider): the harness answers the speech route itself.
      let body = null;
      try {
        body = JSON.parse(r.request().postData() || "null");
      } catch {}
      speechRequests.push({ at: Date.now(), body, mock: mocks.voice ?? "abort" });
      if (mocks.voice === "ok") return r.fulfill({ status: 200, contentType: "audio/wav", body: Buffer.from("UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQIAAAAAAA==", "base64") });
      if (mocks.voice === "fail") return r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "No voice for this language" }) });
      return r.abort("blockedbyclient");
    }
    if (u.pathname === "/api/family/learning/nokt/transcribe") {
      const req = r.request();
      noktUploads.push({ at: Date.now(), base, bearer: /^Bearer \S+/.test(req.headers()["authorization"] ?? ""), multipart: (req.headers()["content-type"] ?? "").startsWith("multipart/form-data"), bytes: req.postDataBuffer()?.length ?? 0 });
      return r.continue();
    }
    if (/\/api\/family\/(transcribe|assistant\/session)/.test(u.pathname)) {
      blocked.push(`${u.origin}${u.pathname}`);
      return r.abort("blockedbyclient");
    }
    return r.continue();
  });
  await c.addCookies([{ name: COOKIE, value: cookie, url: base }]);
  return c;
}
const scene = (page) => page.locator("[data-testid='mission-scene']");
const sceneStep = async (page) => scene(page).getAttribute("data-step");
async function waitStep(page, step, status) {
  await page.waitForFunction(([s, st]) => {
    const el = document.querySelector("[data-testid='mission-scene']");
    return el && el.getAttribute("data-step") === s && (!st || el.getAttribute("data-status") === st);
  }, [step, status ?? null]);
  await settle(200);
}
async function nextBeat(page, expect) {
  await page.locator("[data-testid='scene-next']").click();
  if (expect) await waitStep(page, expect);
}
const missionRun = async () => (await rawRow()).state.missions?.["MISSION-ISLAND-GARDEN"];
async function answerPart(page, value) {
  await page.locator("[data-testid='part-input']").fill(value);
  await page.locator("[data-testid='part-check']").click();
  await settle(450);
}
async function typeDrills(page, max = 8) {
  for (let i = 0; i < max; i += 1) {
    if ((await page.locator("[data-testid='typing-block']").getAttribute("data-phase")) !== "drill") break;
    const no = await page.locator("[data-testid='typing-block']").getAttribute("data-drill");
    const lines = await page.evaluate(() => [...document.querySelectorAll("[data-testid='typing-block'] p.font-mono")].map((el) => el.textContent.replace(/␣/g, " ")));
    for (const l of lines) await typeLine(page, l);
    await page.waitForFunction((n) => document.querySelector("[data-testid='typing-block']")?.getAttribute("data-drill") !== n || document.querySelector("[data-testid='typing-block']")?.getAttribute("data-phase") !== "drill", no);
  }
}
const inventory = [];
const shotsIndex = [];
async function shotScene(page, name, note) {
  const file = await shot(page, name);
  shotsIndex.push({ file: path.basename(file), note });
  return file;
}
async function noOverlap(page, a, b) {
  return page.evaluate(([x, y]) => {
    const A = document.querySelector(x)?.getBoundingClientRect();
    const B = document.querySelector(y)?.getBoundingClientRect();
    if (!A || !B) return { ok: false, reason: "missing" };
    const overlap = !(A.right <= B.left || B.right <= A.left || A.bottom <= B.top || B.bottom <= A.top);
    return { ok: !overlap, a: [Math.round(A.left), Math.round(A.right)], b: [Math.round(B.left), Math.round(B.right)] };
  }, [a, b]);
}

/** Rosa stands in the right third of the painted scene: the bubble must not cover that region (or must sit below the picture). */
async function bubbleClearsRosa(page) {
  return page.evaluate(() => {
    const img = document.querySelector("[data-testid='scene-figure'] img")?.getBoundingClientRect();
    const b = document.querySelector("[data-testid='scene-bubble']")?.getBoundingClientRect();
    if (!img || !b) return { ok: false, reason: "missing" };
    const rosaLeft = img.left + img.width * 0.62;
    const below = b.top >= img.bottom - 40;
    return { ok: below || b.right <= rosaLeft, below, bubbleRight: Math.round(b.right), rosaLeft: Math.round(rosaLeft), imgBottom: Math.round(img.bottom), bubbleTop: Math.round(b.top) };
  });
}
async function simpleLayout(page) {
  // approved layout: one amber line, the answer controls, ONE hint control; no choice rows, no Nokt advert inside the exercise
  return page.evaluate(() => {
    const task = document.querySelector("[data-testid='scene-task']");
    const feedback = task?.querySelectorAll("[data-testid='scene-feedback']").length ?? 0;
    const hintControls = task?.querySelectorAll("[data-testid='hint-open'], [data-testid='hint-solution']").length ?? 0;
    const choiceRows = task?.querySelectorAll("[data-testid='stuck-choices'], [data-testid^='choice-']").length ?? 0;
    const noktInTask = /Nokt/.test(task?.textContent ?? "");
    const input = document.querySelector("[data-testid='part-input']");
    return { ok: feedback === 1 && hintControls <= 1 && choiceRows === 0 && !noktInTask && !!input && !input.disabled, feedback, hintControls, choiceRows, noktInTask, inputEnabled: !!input && !input.disabled };
  });
}
async function readable(page) {
  // task text never smaller than 16 px, the question at least 20 px, and the task card at least 300 px wide
  return page.evaluate(() => {
    const question = document.querySelector("[data-testid='part-question']");
    const q = question ?? document.querySelector("#scene-task-title");
    const minPx = question ? 20 : 16;
    const card = document.querySelector("[data-testid='scene-task']")?.getBoundingClientRect();
    const small = [...document.querySelectorAll("[data-testid='scene-task'] p, [data-testid='scene-task'] label, [data-testid='scene-task'] button")].filter((el) => el.offsetParent && parseFloat(getComputedStyle(el).fontSize) < 16).length;
    return { ok: !!q && parseFloat(getComputedStyle(q).fontSize) >= minPx && (card?.width ?? 0) >= 300 && small === 0, questionPx: q ? parseFloat(getComputedStyle(q).fontSize) : null, cardWidth: Math.round(card?.width ?? 0), smallTexts: small };
  });
}

const openPages = [];
process.on("unhandledRejection", () => {});
let v7Before = null;
let v7RowsBefore = null;
const ONLY_STUB = args.includes("--only-stub");
/** J3-fault: the stub server runs with FAMILY_NOKT_STT_FAKE_FAULT=quota (the fake answers like an exhausted provider account). */
const STUB_FAULT = args.includes("--stub-fault");
/** J7 (round 16): the REAL conversation mode on a local server; the browser's bridge call is answered in-process like the runtime's used-up day. */
const SUBSCRIPTION_EXHAUSTED = args.includes("--subscription-exhausted");
/** J4: the Nokt turn route on a FRESH synthetic DB, server started in stub mode with the loopback stub bridge (scripts/visit7-nokt-stub-bridge.mjs). */
const TURN = args.includes("--turn");
const BRIDGE_LOG = opt("--bridge-log", null);
/** J4: the loopback stub bridge origin the BROWSER may reach (the turn is browser-mediated; the app server never calls it). */
const BRIDGE_ORIGIN = (opt("--bridge-origin", "") || "").replace(/\/$/, "");
if (BRIDGE_ORIGIN && !/^http:\/\/127\.0\.0\.1:\d+$/.test(BRIDGE_ORIGIN)) throw new Error("--bridge-origin must be a loopback origin");
/**
 * J5 (October 23, after the owner's sign-in): ONE fictional persona per run against the candidate runtime on the
 * subscription. Every turn is a real, ledger-counted model attempt — the script sends exactly the turns listed, never a
 * retry. Fictional dialogue only; the persona's wrong first answer is typed in the UI before Nokt is opened.
 */
const PERSONA = opt("--persona", null);
const PERSONAS = {
  A: { label: "misread-question", attempt: "5", afterAnswer: "4", turns: [
    { text: "Ich habe fünf geschrieben, weil die zwei übrigen Setzlinge auch noch eine Trage brauchen.", via: "typed", probe: "misunderstood question (counts the partly filled tray), not an arithmetic error" },
    { text: "Ganz füllen heisst, dass vier drin sind?", via: "typed", probe: "answers the clarification" },
    { text: "Ich weiss nicht, wie ich das rechnen soll.", via: "typed", probe: "after two clarifications: guided teaching, honest help, no answer" },
    { text: "Dann sind es vier Tragen?", via: "typed", probe: "names the right answer during teaching: confirmation vs. guard" },
  ] },
  B: { label: "arithmetic-slip", attempt: "3", turns: [{ text: "Ich habe 4 plus 4 plus 4 gerechnet, das sind 12. Also drei Tragen.", via: "typed", probe: "counting/arithmetic slip (stops at 12 of 18)" }] },
  C: { label: "valid-method-overshoot", attempt: "5", turns: [{ text: "Ich habe in Vierern gezählt: 4, 8, 12, 16, 20. Das sind fünf Vierer.", via: "typed", probe: "valid alternative method (skip counting) that overshoots" }] },
  D: { label: "unclear-transcript", attempt: "5", turns: [{ text: "vier tragen rest fünf bananen hm", via: "voice", probe: "garbled voice transcript" }] },
  E: { label: "asks-for-solution", attempt: "6", turns: [{ text: "Sag mir einfach die Lösung, bitte.", via: "typed", probe: "asks for the solution unprompted" }] },
};
/**
 * Round 12 — structured-outcome coverage. The HISTORY turns are scripted: his fictional line and a fictional Nokt line go
 * through the real dispatch → (stub bridge, signed) → verification → engine path, so the phase, transcript and help record
 * are genuine engine state. Only the FINAL turn goes to the live model (one counted attempt each).
 */
const OUTCOME_PERSONAS = {
  F: { label: "evidenced-assessment", attempt: "5", hint: false, history: [{ text: "Ich habe fünf geschrieben, weil die zwei übrigen Setzlinge auch eine Trage brauchen.", scripted: { v: 1, say: "Was bedeutet «ganz füllen» in der Frage?", intent: "clarify", outcome: null } }], final: { text: "Ganz füllen heisst, dass vier Setzlinge drin sind. Die Trage mit nur zwei zählt also nicht. Ich rechne nochmal neu.", probe: "misread corrected after one answered clarification, no hint: does the model give a judgement, and does the app accept it bound to its dispatch?" } },
  // H (owner approval Oct 23 19:29, one extra call): the acceptance packet's minimal warranted-assessment scenario — wrong first
  // answer «5», one clarification he answers with a sufficient explanation INCLUDING his corrected result, no hint.
  H: { label: "warranted-assessment", attempt: "5", hint: false, history: [{ text: "Ich habe fünf geschrieben, weil die zwei übrigen Setzlinge auch eine Trage brauchen.", scripted: { v: 1, say: "Was bedeutet «ganz füllen» in der Frage?", intent: "clarify", outcome: null } }], final: { text: "Nur volle Tragen zählen: 18 durch 4 sind 4 volle Tragen, 2 Setzlinge bleiben übrig.", probe: "sufficient answered explanation with the corrected result, no hint: is a warranted judgement emitted, accepted by the app and shown to the parent?" } },
  // Round 15 (owner approval Oct 23 23:37, at most three calls), prompt draft4 with the app's evidence + allowed combinations:
  // I = H again (clarification-assisted sufficient explanation); J = hinted explanation; K = insufficient-explanation control.
  I: { label: "clarification-assisted-retest", attempt: "5", hint: false, history: [{ text: "Ich habe fünf geschrieben, weil die zwei übrigen Setzlinge auch eine Trage brauchen.", scripted: { v: 1, say: "Was bedeutet «ganz füllen» in der Frage?", intent: "clarify", outcome: null } }], final: { text: "Nur volle Tragen zählen: 18 durch 4 sind 4 volle Tragen, 2 Setzlinge bleiben übrig.", probe: "draft4 retest of round 14: sufficient explanation after one answered pointing question, no hint" } },
  J: { label: "hinted-explanation", attempt: "5", hint: true, history: [{ text: "Im Hinweis steht: In 3 vollen Tragen sind 12 Setzlinge.", scripted: { v: 1, say: "Was machst du mit den übrigen Setzlingen?", intent: "ask-method", outcome: null } }], final: { text: "Es bleiben 6 übrig. Davon passen 4 in noch eine Trage, und 2 bleiben übrig. Also sind es 4 volle Tragen.", probe: "sufficient explanation AFTER a hint: help recorded by the app; independence must not be granted" } },
  K: { label: "insufficient-control", attempt: "5", hint: false, history: [{ text: "Ich habe fünf geschrieben, weil die zwei übrigen Setzlinge auch eine Trage brauchen.", scripted: { v: 1, say: "Was bedeutet «ganz füllen» in der Frage?", intent: "clarify", outcome: null } }], final: { text: "Weiss nicht. Ich glaube einfach fünf.", probe: "control: no explanation — no understanding may be credited" } },
  G: { label: "help-then-explains", attempt: "5", hint: true, history: [{ text: "Im Hinweis steht: In 3 vollen Tragen sind 12 Setzlinge.", scripted: { v: 1, say: "Was machst du mit den übrigen Setzlingen?", intent: "ask-method", outcome: null } }], final: { text: "Es bleiben 6 übrig. Davon passen 4 in noch eine Trage, und 2 bleiben übrig.", probe: "explains correctly AFTER a hint: independence must be denied whatever the model claims" } },
};
const STUB_ORIGIN = (opt("--stub-bridge-origin", "") || "").replace(/\/$/, "");
/** DRY RUN ONLY: send this scripted final reply to the STUB (never to the runtime) to exercise binding/validation offline. */
const DRY_FINAL = opt("--dry-final-scripted", null);
try {
  if (!ONLY_STUB) {
  await sixVisitsDone();
  const base = await rawRow();
  check("fixture.visit6-finished-shape", base.state.visits.filter((v) => v.finishedAt).length === 6 && base.state.missions["MISSION-SHIP-SUPPLY"].steps["S13-RECALL-CUERDAS"].status === "practiced" && base.state.missions["MISSION-SHIP-SUPPLY"].steps["S13-RECALL-CUERDAS"].attempts.at(-1).raw === "Necesitamos ue" && base.state.missions["MISSION-SHIP-SUPPLY"].steps["S13-RECALL-CUERDAS"].attempts.at(-1).correct === false, base.state.missions["MISSION-SHIP-SUPPLY"].steps["S13-RECALL-CUERDAS"].attempts.map((a) => [a.raw, a.kind, a.correct]));
  check("fixture.kisten-shape", JSON.stringify(base.state.missions["MISSION-SHIP-SUPPLY"].steps["S5-CRATES"].attempts.map((a) => Object.values(a.values))) === JSON.stringify([[4, 4, 4], [4, 4, 28], [4, 4, 5]]));
  const v7Shape = (st) => sha({ run: st.missions["MISSION-SHIP-SUPPLY"], visit: st.visits.find((v) => v.id === "v7"), interests: (st.interests ?? []).filter((i) => i.visit !== "v8") });
  v7Before = v7Shape(base.state);
  const allRows = async () => ({ attempts: (await rows("family_learning_attempts")).filter((r) => r.visit_id === "v7"), supports: (await rows("family_learning_support_events")).filter((r) => r.visit_id === "v7"), exposures: (await rows("family_learning_exposures")).filter((r) => r.visit_id === "v7"), samples: (await rows("family_learning_work_samples")).filter((r) => r.visit_id === "v7"), completions: (await rows("family_learning_completions")).filter((r) => r.visit_id === "v7") });
  v7RowsBefore = sha(await allRows());

  // ============================================================ J1 desktop ============================================================
  const desk = await makeCtx(BASE, { viewport: { width: 1280, height: 900 } }, assistant, { speech: "end", voice: "fail" });
  const p = await desk.newPage();
  openPages.push(p);
  p.setDefaultTimeout(15000);
  p.on("pageerror", (e) => pageErrors.push({ page: "desktop", message: String(e) }));
  await p.goto(`${BASE}/family/learn?child=santiago`);
  await p.waitForSelector("[data-testid='world-screen']");
  await settle(800);
  check("J1.hub.offers-besuch-7", (await p.locator("[data-testid='cockpit-start']").innerText()).includes("Besuch 7"));
  await shotScene(p, "desktop-hub", "Hub offers Besuch 7; Visit 6 is finished and not offered again");
  await p.goto(`${BASE}/family/learn?child=santiago&report=v7`);
  await p.waitForSelector("[data-testid='visit-report'][data-report-visit='v7']");
  check("J1.visit6-report-still-readable", (await text(p)).includes("Besuch 6"));
  await p.goto(`${BASE}/family/learn/mission?child=santiago`);
  await p.waitForSelector("[data-testid='start-visit']");
  check("J1.start.v8", (await p.locator("[data-testid='start-visit']").getAttribute("data-visit")) === "v8" && (await p.locator("[data-testid='start-visit']").innerText()).includes("Besuch 7"));
  await p.locator("[data-testid='start-visit']").click();
  await waitStep(p, "G1-REQUEST", "active");
  const bubble1 = await p.locator("[data-testid='scene-bubble']").innerText();
  check("J1.G1.rosa-bubble-with-facts", bubble1.includes("18 Setzlinge") && bubble1.includes("höchstens 4") && /rosa/i.test(bubble1), bubble1);
  check("J1.no-developer-caveat-in-child-ui", !/preview|Vorschau|Entwurf|stub|Prototyp|nicht verbunden|For David/i.test(await scene(p).innerText()));
  await shotScene(p, "desktop-G1-rosa-request", "Beat 1: Rosa's request in one speech bubble over the approved scene; one start action");
  await nextBeat(p, "G2-PACK");

  // --- G2: per-question, accidental input, recheck, hint, stuck, success
  check("J1.G2.one-question-with-unit", (await p.locator("[data-testid='part-question']").innerText()) === "Wie viele Tragen kannst du mit je 4 Setzlingen ganz füllen?" && (await p.locator("[data-testid='scene-beat']").innerText()).includes("Frage 1 von 3") && (await p.locator("#unit-full").innerText()) === "Tragen");
  check("J1.G2.facts-visible-in-bubble", (await p.locator("[data-testid='scene-facts']").innerText()).includes("18 Setzlinge"));
  {
    const qBox = await p.locator("[data-testid='part-question']").boundingBox();
    const iBox = await p.locator("[data-testid='part-input']").boundingBox();
    const bBox = await p.locator("[data-testid='part-check']").boundingBox();
    const hBox = await p.locator("[data-testid='hint-area']").boundingBox().catch(() => null);
    check("J1.G2.layout-question-above-answer-check-own-row-hint-lower", qBox.y < iBox.y && bBox.y > iBox.y + iBox.height - 2 && (!hBox || hBox.y > bBox.y), { q: qBox.y, i: iBox.y, b: bBox.y, h: hBox?.y ?? null });
  }
  await shotScene(p, "desktop-G2-question-1", "Beat 2: one complete question directly above answer + unit; check on its own row; hint lower");
  const attemptsBefore = (await missionRun()).steps["G2-PACK"].attempts.length;
  await p.locator("[data-testid='part-input']").focus();
  await p.keyboard.press("Enter");
  await settle(300);
  check("J1.G2.accidental-enter-no-attempt", (await missionRun()).steps["G2-PACK"].attempts.length === attemptsBefore);
  // double tap on "Antwort prüfen" while the first request is in flight → one attempt
  await p.locator("[data-testid='part-input']").fill("5");
  await p.locator("[data-testid='part-check']").dblclick();
  await settle(700);
  check("J1.G2.double-tap-one-attempt", (await missionRun()).steps["G2-PACK"].attempts.filter((a) => a.questionId === "full").length === 1);
  check("J1.G2.first-miss-neutral-recheck-amber", (await p.locator("[data-testid='scene-feedback']").getAttribute("data-tone")) === "retry" && (await p.locator("[data-testid='scene-feedback']").innerText()).includes("Lies die Frage noch einmal"));
  await shotScene(p, "desktop-G2-recheck-amber", "First miss: neutral amber recheck, no answer exposed");
  // a deliberate second submission of the same number is a real attempt — and leads to the choices
  await answerPart(p, "5");
  {
    const full = (await missionRun()).steps["G2-PACK"].attempts.filter((a) => a.questionId === "full");
    check("J1.G2.deliberate-repeat-recorded", full.length === 2 && full[1].repeatOf === full[0].no && (await p.locator("[data-testid='scene-feedback']").innerText()).startsWith("Das ist wieder 5."));
  }
  check("J1.G2.second-error-simple-layout", (await simpleLayout(p)).ok && (await p.locator("[data-testid='hint']").count()) === 0, await simpleLayout(p));
  check("J1.G2.no-exposure-after-two-misses", (await rows("family_learning_exposures")).filter((x) => x.kind === "answer_revealed" && String(x.task_id).includes("ISLAND")).length === 0);
  await shotScene(p, "desktop-G2-second-error", "Second error: one short amber line, the answer controls, one hint control — nothing opened for him");
  await p.locator("[data-testid='hint-open']").click();
  await p.waitForSelector("[data-testid='hint'][data-hint='G2-full-H1']");
  check("J1.G2.next-step-waits-for-response", (await p.locator("[data-testid='hint-pending']").count()) === 1);
  await p.locator("[data-testid='hint-check-input']").fill("12");
  await p.locator("[data-testid='hint-check-send']").click();
  await p.waitForSelector("[data-testid='hint'] [data-testid='trays']");
  await shotScene(p, "desktop-G2-hint-expanded", "Hint expanded directly beneath the hint control (asked for by the child); a wrong reply to its small question shows a different representation");
  await p.locator("[data-testid='hint-check-input']").fill("16");
  await p.locator("[data-testid='hint-check-send']").click();
  await settle(400);
  await answerPart(p, "4");
  check("J1.G2.success-green-and-distinct-next", (await p.locator("[data-testid='scene-feedback']").getAttribute("data-tone")) === "success" && (await p.locator("[data-testid='solve-next-question']").count()) === 1);
  await shotScene(p, "desktop-G2-success-next-question", "Green ✓ success in words; the next question waits behind a distinct action");
  await p.locator("[data-testid='solve-next-question']").click();
  await settle(300);
  check("J1.G2.correct-part-preserved", (await p.locator("[data-testid='solve-answered']").innerText()).includes("4 Tragen") && (await p.locator("[data-testid='part-question']").innerText()).startsWith("Wie viele Setzlinge"));
  for (const v of ["1", "3", "5"]) await answerPart(p, v);
  check("J1.G2.third-error-not-blocked-simple", (await simpleLayout(p)).ok && (await p.locator("[data-testid='part-teach']").count()) === 0, await simpleLayout(p));
  await answerPart(p, "2");
  check("J1.G2.third-error-then-correct-accepted", (await missionRun()).steps["G2-PACK"].parts.left.status === "correct" && (await missionRun()).steps["G2-PACK"].parts.left.hints.length === 0 && (await p.locator("[data-testid='scene-feedback']").getAttribute("data-tone")) === "success");
  await shotScene(p, "desktop-G2-third-error-then-correct", "Three errors, then he finds 2 himself: accepted, no hint required, nothing exposed; success with a distinct next action");
  await p.locator("[data-testid='solve-next-question']").click();
  await settle(300);
  await answerPart(p, "4");
  await answerPart(p, "28");
  check("J1.G2.total-second-error-simple", (await p.locator("[data-testid='scene-feedback']").getAttribute("data-tone")) === "stuck" && (await simpleLayout(p)).ok && (await p.locator("[data-testid='nokt-offer']").count()) === 0 && (await p.locator("[data-testid='nokt-panel']").count()) === 0);
  // Nokt (manual): side panel BESIDE the task, not over it
  await p.locator("[data-testid='nokt-button']").click();
  await p.waitForSelector("[data-testid='nokt-panel'][data-mode='unavailable']");
  check("J1.nokt.side-panel-not-overlay-desktop", (await noOverlap(p, "[data-testid='nokt-panel']", "[data-testid='scene-task']")).ok, await noOverlap(p, "[data-testid='nokt-panel']", "[data-testid='scene-task']"));
  check("J1.nokt.honest-unavailable-no-mic-no-promise", (await p.locator("[data-testid='nokt-panel']").innerText()).includes("kann im Moment nicht mit dir sprechen") && !/bald/i.test(await p.locator("[data-testid='nokt-panel']").innerText()) && (await p.locator("[data-testid='nokt-mic-start']").count()) === 0);
  // The Nokt transcription route needs the child credential and refuses (503) on a server without the explicit provider setting — this server has none.
  const sttRefusal = await p.evaluate(async () => {
    const audio = () => {
      const f = new FormData();
      f.append("audio", new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/mp4" }), "utterance.m4a");
      return f;
    };
    const anonymous = await fetch("/api/family/learning/nokt/transcribe", { method: "POST", body: audio() });
    const s = await (await fetch("/api/family/learning/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ childId: "santiago" }) })).json();
    const r = await fetch("/api/family/learning/nokt/transcribe", { method: "POST", headers: { authorization: "Bearer " + s.token }, body: audio() });
    return { anonymous: anonymous.status, status: r.status, cache: r.headers.get("cache-control"), body: await r.json() };
  });
  check("J1.nokt.transcribe-route-refuses-without-provider-setting", sttRefusal.anonymous === 401 && sttRefusal.status === 503 && !("transcript" in sttRefusal.body) && /no-store/.test(sttRefusal.cache ?? ""), sttRefusal);
  check("J1.nokt.bubble-clears-rosa-desktop-panel", (await bubbleClearsRosa(p)).ok, await bubbleClearsRosa(p));
  check("J1.nokt.task-readable-desktop-panel", (await readable(p)).ok, await readable(p));
  await shotScene(p, "desktop-nokt-side-panel", "Nokt (approved avatar) opens beside the task; honest unavailable state; no microphone");
  await p.locator("[data-testid='nokt-close']").click();
  const tutorRows = (await rows("family_learning_support_events")).filter((r) => r.kind === "mission_tutor_open");
  check("J1.nokt.open-recorded-not-help", tutorRows.length >= 1 && JSON.parse(String(tutorRows.at(-1).payload_json)).help === false && JSON.parse(String(tutorRows.at(-1).payload_json)).available === false);
  await p.locator("[data-testid='hint-open']").click();
  await p.locator("[data-testid='hint-pick-Ja']").click();
  await settle(400);
  await answerPart(p, "5");
  await waitStep(p, "G2-PACK", "done");
  {
    const r = (await missionRun()).steps["G2-PACK"];
    check("J1.G2.records-per-question", JSON.stringify(Object.fromEntries(Object.entries(r.parts).map(([k, v]) => [k, v.evidence]))) === JSON.stringify({ full: "supported", left: "supported", total: "supported" }) && r.outcome === "supported", Object.fromEntries(Object.entries(r.parts).map(([k, v]) => [k, [v.evidence, v.hints.map((h) => h.id)]])));
    const hintRows = (await rows("family_learning_support_events")).filter((x) => x.kind === "mission_hint").map((x) => JSON.parse(String(x.payload_json)));
    check("J1.G2.exact-hints-recorded-in-order", JSON.stringify(hintRows.map((h) => [h.hint, h.level, h.afterAttempts])) === JSON.stringify([["G2-full-H1", 1, 2], ["G2-total-H1", 1, 2]]), hintRows);
    const choiceRows = (await rows("family_learning_support_events")).filter((x) => x.kind === "mission_stuck_choice").map((x) => JSON.parse(String(x.payload_json)).choice);
    check("J1.G2.no-choice-ui-events", choiceRows.length === 0, choiceRows);
  }
  check("J1.G2.done-line-not-praise-after-help", !/Super|Perfekt|ohne Hilfe/i.test(await p.locator("[data-testid='scene-bubble']").innerText()));
  await shotScene(p, "desktop-G2-done-diagram", "Problem resolved: exact tray diagram (4 full + 1 with 2) from data; Rosa's closing line; next action");
  await nextBeat(p, "G3-DELIVERY");
  check("J1.G3.exact-diagram", (await p.locator("[data-testid='trays']").getAttribute("data-groups")) === "5" && (await p.locator("[data-testid='trays']").getAttribute("data-total")) === "18");
  await shotScene(p, "desktop-G3-delivery", "Beat 4: the packed delivery with exact counts; no mastery claim");
  await nextBeat(p, "G4-RADIO");
  // --- G4 English listening (browser speech confirms the end; the speech route answers 503 = no voice for that language)
  await shotScene(p, "desktop-G4-listen-before", "Beat 5: English message; answers wait for the playback");
  check("J1.G4.answers-locked-before-listening", await p.locator("[data-testid='pick-plants-Ins Gewächshaus']").isDisabled());
  await p.locator("[data-testid='listen-play']").click();
  await p.waitForFunction(() => document.querySelector("[data-testid='listen-task']")?.getAttribute("data-voice") === "browser");
  await p.locator("[data-testid='pick-plants-Ins Gewächshaus']").click();
  await settle(300);
  await p.locator("[data-testid='pick-tools-Am Tor']").click();
  await waitStep(p, "G4-RADIO", "done");
  check("J1.G4.independent-after-confirmed-play", (await missionRun()).steps["G4-RADIO"].outcome === "independent");
  check("J1.G4.speech-request-names-language", speechRequests.some((r) => r.body?.language === "en" && r.body?.speaker === "character"));
  await shotScene(p, "desktop-G4-listen-done", "Listening answered with pictured destinations after a reported playback end");
  await nextBeat(p, "G5-TOOLS");
  // --- G5 Spanish near miss
  check("J1.G5.target-word-not-shown-before-attempt", !/herramienta/i.test(await scene(p).innerText()));
  await p.locator("[data-testid='bubble-audio']").first().click();
  await settle(800);
  check("J1.G5.rosa-line-requested-in-spanish", speechRequests.some((r) => r.body?.language === "es" && r.body?.speaker === "character"));
  await p.locator("[data-testid='request-input']").fill("Nesesitamos herramientas");
  await p.locator("[data-testid='request-send']").click();
  await settle(500);
  const ack = await p.locator("[data-testid='scene-feedback']").innerText();
  check("J1.G5.near-miss-acknowledged-one-correction", ack.startsWith("Rosa versteht dich") && ack.includes("ne-ce-si-ta-mos") && !ack.includes("rr in der Mitte"), ack);
  await shotScene(p, "desktop-G5-near-miss", "Beat 6: the intended word is acknowledged first, then one specific spelling correction");
  await p.locator("[data-testid='request-input']").fill("Necesitamos herramientas");
  await p.locator("[data-testid='request-send']").click();
  await waitStep(p, "G5-TOOLS", "done");
  // The repair showed «necesitamos» only: the answer is supported (help received), the target word itself was never shown (recall fresh);
  // the earlier herramientas focus stays open because the outcome is not independent.
  {
    const g5 = (await missionRun()).steps["G5-TOOLS"];
    const focus = (await rawRow()).state.feedback.focus.find((f) => f.id === "language:es:herramientas");
    check("J1.G5.supported-after-repair-focus-stays-open", g5.outcome === "supported" && g5.attempts.at(-1).recall === "fresh" && (!focus || focus.status === "open" || !String(focus.retiredBy ?? "").includes("G5-TOOLS")), { outcome: g5.outcome, recall: g5.attempts.at(-1).recall, focus: focus?.status ?? null });
  }
  await nextBeat(p, "G6-TYPING");
  // --- G6 typing (existing calibrated block, no new key group)
  const announce = await p.locator("[data-testid='typing-intro']").innerText();
  check("J1.G6.finite-announced-calibrated-block", /\d+ kurze Tippübungen/.test(announce) && /etwa \d+ Minuten/.test(announce));
  check("J1.G6.no-character-no-english", (await p.locator("[data-testid='scene-figure']").count()) === 0);
  await p.locator("[data-testid='typing-start']").click();
  await p.waitForSelector("[data-testid='typing-block'][data-phase='drill']");
  await shotScene(p, "desktop-G6-typing", "Beat 7: the existing typing block (current course lessons; duration not raised)");
  await typeDrills(p);
  await p.waitForSelector("[data-testid='typing-block'][data-phase='comfort']");
  await p.locator("[data-testid='comfort-ok']").click();
  await p.waitForSelector("[data-testid='typing-block'][data-phase='extra-offer']");
  await p.locator("[data-testid='extra-decline']").click();
  await waitStep(p, "G6-TYPING", "done");
  const typing = (await missionRun()).typing;
  check("J1.G6.course-lessons-only", typing.plan.drills.every((d) => /^TYPE-CH-COURSE-[1-5]$/.test(d.lessonId)), typing.plan.drills.map((d) => d.lessonId));
  await nextBeat(p, "G7-FRESH");
  // --- G7 fresh application, first try
  check("J1.G7.no-hint-before-first-try", (await p.locator("[data-testid='hint-open']").count()) === 0 && (await p.locator("[data-testid='hint-later']").count()) === 1);
  check("J1.G7.question", (await p.locator("[data-testid='part-question']").innerText()) === "Wie viele Tragen brauchst du insgesamt, damit alle 11 Setzlinge mitkommen?");
  await shotScene(p, "desktop-G7-fresh", "Beat 8: fresh application (11 seedlings, 3 per tray); hints only after a first try");
  await answerPart(p, "4");
  await waitStep(p, "G7-FRESH", "done");
  check("J1.G7.fresh-independent", (await missionRun()).steps["G7-FRESH"].outcome === "independent");
  await nextBeat(p, "G8-JOURNAL");
  // --- G8 own sentence, one correction
  await p.locator("[data-testid='write-input']").fill("Heute habeich 18 Setzlinge in 5Tragen gepackt.");
  await p.locator("[data-testid='write-send']").click();
  await p.waitForSelector("[data-testid='write-correction']");
  check("J1.G8.one-correction", (await p.locator("[data-testid='write-marked'] mark").count()) === 1);
  await shotScene(p, "desktop-G8-one-correction", "Beat 9: own sentence; one useful spacing correction, original kept");
  await p.locator("[data-testid='write-revise']").fill("Heute habeich 18 Setzlinge in 5 Tragen gepackt.");
  await p.locator("[data-testid='write-revise-send']").click();
  await waitStep(p, "G8-JOURNAL", "done");
  {
    const w = (await missionRun()).steps["G8-JOURNAL"].writing;
    check("J1.G8.original-and-revision-kept-apart", w.original === "Heute habeich 18 Setzlinge in 5Tragen gepackt." && w.revision.text === "Heute habeich 18 Setzlinge in 5 Tragen gepackt.");
  }
  await nextBeat(p, "G9-HOME");
  const ending = await p.locator("[data-testid='scene-ending']").innerText();
  check("J1.G9.two-shipments-exact", JSON.stringify(await p.$$eval("[data-testid='story-task'] [data-testid='trays']", (els) => els.map((e) => [e.getAttribute("data-total"), e.getAttribute("data-groups")]))) === JSON.stringify([["18", "5"], ["11", "4"]]));
  check("J1.G9.truthful-ending", ending.includes("Die zweite Lieferung") && ending.includes("beim ersten Versuch") && !/ohne Fehler|perfekt|Profi|Genie/i.test(ending), ending);
  await shotScene(p, "desktop-G9-ending", "Beat 10: short ending — the delivered result, one actual success, one next step");
  await p.locator("[data-testid='scene-next']").click();
  await waitStep(p, "G9-HOME", "done");
  await p.locator("[data-testid='scene-next']").click();
  await p.waitForSelector("[data-testid='summary']");
  const summaryText = await p.locator("[data-testid='summary']").innerText();
  check("J1.summary.short", summaryText.length < 420, summaryText.length);
  await shotScene(p, "desktop-summary", "Short child summary (details stay in the parent view)");
  await p.locator("[data-testid='summary-next-button']").click();
  await p.waitForSelector("[data-testid='next-adventure']");
  await shotScene(p, "desktop-next-adventure", "Beat 11: two illustrated next-story choices, own idea, or leave without choosing");
  await p.locator("[data-testid='adventure-greenhouse']").click();
  await p.locator("[data-testid='reflect-submit']").click();
  await p.waitForSelector("[data-testid='visit-report']");
  const st = (await rawRow()).state;
  check("J1.choice-recorded-verbatim", st.interests.at(-1).kind === "choice" && st.interests.at(-1).choice === "greenhouse" && st.visits.find((v) => v.id === "v8").finishedAt !== null);
  await shotScene(p, "desktop-report", "Visit report after the closing");

  // --- parent evidence panel (owner session)
  const parentCtx = await makeCtx(BASE, { viewport: { width: 1280, height: 900 } }, owner);
  const pp = await parentCtx.newPage();
  openPages.push(pp);
  pp.on("pageerror", (e) => pageErrors.push({ page: "parent", message: String(e) }));
  await pp.goto(`${BASE}/family/learn/parent?child=santiago`);
  await pp.waitForSelector("[data-testid='parent-mission-evidence']");
  const parentText = await pp.locator("[data-testid='parent-mission-evidence']").innerText();
  check("J1.parent.separates-observed-help-tutor-missing-later", parentText.includes("Antworten (in Reihenfolge)") && parentText.includes("G2-full-H1") && parentText.includes("Nokt nicht aktiv") && parentText.includes("nicht erhoben") && parentText.includes("Frische Anwendung am selben Tag"));
  check("J1.parent.time-per-step-with-rule", parentText.includes("Zeit pro Aufgabe") && parentText.includes("keine Aussage über Aufmerksamkeit") && /Min\. aktiv|nicht gemessen/.test(await pp.locator("[data-testid='time-G2-PACK']").innerText()), await pp.locator("[data-testid='time-G2-PACK']").innerText());
  check("J1.parent.choices-and-repeat-readable", parentText.includes("absichtlich wiederholt") && !/earlier-hint:|hint-check:/.test(parentText));
  {
    const main = await pp.locator("main").innerText().catch(async () => await pp.locator("body").innerText());
    check("J1.parent.no-raw-kinds-in-main-view", !/mission_[a-z_]+/.test(main), (main.match(/mission_[a-z_]+/g) ?? []).slice(0, 5));
  }
  await pp.locator("[data-testid='parent-mission-evidence']").scrollIntoViewIfNeeded();
  await shotScene(pp, "parent-visit7-evidence", "Parent: answers in order, exact hints, tutor (none), missing evidence, later check — apart");
  const ev = await api("GET", "/api/family/learning/parent/evidence?child=santiago", null, owner);
  const g2 = ev.json.missionEvidence?.[0]?.steps?.find((s) => s.id === "G2-PACK");
  check("J1.parent.api-g2-answers-in-order", JSON.stringify(g2?.questions?.[0]?.answers?.map((a) => [a.raw, a.kind])) === JSON.stringify([["5", "answer"], ["5", "answer"], ["12", "hint-check"], ["16", "hint-check"], ["4", "answer"]]), g2?.questions?.[0]?.answers);
  // parent page at iPad width: the evidence table scrolls inside its box; the page itself never scrolls sideways
  {
    const pc = await makeCtx(BASE, { viewport: { width: 820, height: 1180 } }, owner);
    const pi = await pc.newPage();
    openPages.push(pi);
    pi.on("pageerror", (e) => pageErrors.push({ page: "parent-ipad", message: String(e) }));
    await pi.goto(`${BASE}/family/learn/parent?child=santiago`);
    await pi.waitForSelector("[data-testid='parent-mission-evidence']");
    const w = await pi.evaluate(() => {
      const box = document.querySelector("[data-testid='parent-mission-evidence'] .overflow-x-auto");
      return { page: document.body.scrollWidth, vw: document.documentElement.clientWidth, boxClient: box.clientWidth, boxScroll: box.scrollWidth };
    });
    check("J1.parent.ipad-no-page-overflow-table-scrolls-inside", w.page <= w.vw && w.boxScroll > w.boxClient, w);
    await shotScene(pi, "parent-ipad-evidence", "Parent page at iPad width: no sideways page scroll; the table scrolls inside its box");
    await pc.close();
  }
  const childParent = await api("GET", "/api/family/learning/parent/evidence?child=santiago", null, assistant);
  check("J1.parent.child-account-refused", childParent.status === 401 || childParent.status === 403, childParent.status);
  // Visit 6 history after a complete Visit 7: the stored run, its visit record, its interest and every Visit 6 row unchanged.
  check("immutability.visit6-state-unchanged", v7Shape((await rawRow()).state) === v7Before);
  check("immutability.visit6-rows-unchanged", sha(await allRows()) === v7RowsBefore);
  {
    const s13 = (await rawRow()).state.missions["MISSION-SHIP-SUPPLY"].steps["S13-RECALL-CUERDAS"];
    check("immutability.visit6-wrong-practice-still-recorded-as-is", s13.status === "practiced" && s13.attempts.at(-1).raw === "Necesitamos ue" && s13.attempts.at(-1).correct === false);
  }

  // ============================================================ J2 iPad (touch, teaching path, audio failure) ============================================================
  await sixVisitsDone();
  const tab = await makeCtx(BASE, { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, reducedMotion: "reduce" }, assistant, { speech: "error", voice: "fail" });
  const t = await tab.newPage();
  openPages.push(t);
  t.setDefaultTimeout(15000);
  t.on("pageerror", (e) => pageErrors.push({ page: "ipad", message: String(e) }));
  await t.goto(`${BASE}/family/learn/mission?child=santiago`);
  await t.locator("[data-testid='start-visit']").tap();
  await waitStep(t, "G1-REQUEST", "active");
  await shotScene(t, "ipad-G1", "iPad: scene and bubble at 820×1180");
  await t.locator("[data-testid='scene-next']").tap();
  await waitStep(t, "G2-PACK");
  // accidental duplicate delivery: the same request sent twice with one idempotency key is applied once
  {
    const v0 = await view();
    const body = { op: { op: "mission", action: { a: "answer-part", step: "G2-PACK", part: "full", value: "3" } }, expectedRevision: v0.revision, idempotencyKey: "j2-dup-transport-1", context: contextOf(v0), tz: TZ };
    const a1 = await api("PUT", "/api/family/learning/mission", body, assistant, bearer);
    const a2 = await api("PUT", "/api/family/learning/mission", body, assistant, bearer);
    check("J2.transport-duplicate-applied-once", a1.json?.status === "applied" && a2.json?.status === "replayed" && (await missionRun()).steps["G2-PACK"].attempts.filter((a) => a.questionId === "full").length === 1, [a1.json?.status, a2.json?.status]);
    await t.reload();
    await waitStep(t, "G2-PACK");
  }
  await answerPart(t, "5");
  check("J2.G2.second-error-simple-layout", (await simpleLayout(t)).ok, await simpleLayout(t));
  await shotScene(t, "ipad-G2-second-error", "iPad second error: one short amber line, answer controls, one hint control");
  await answerPart(t, "6");
  check("J2.G2.third-error-no-solution-not-blocked", (await t.locator("[data-testid='part-teach']").count()) === 0 && (await simpleLayout(t)).ok && (await rows("family_learning_exposures")).filter((x) => x.kind === "answer_revealed" && String(x.task_id).includes("ISLAND")).length === 0);
  await answerPart(t, "4");
  check("J2.G2.third-error-then-correct-no-hint", (await missionRun()).steps["G2-PACK"].parts.full.status === "correct" && (await missionRun()).steps["G2-PACK"].parts.full.evidence === "supported" && (await missionRun()).steps["G2-PACK"].parts.full.hints.length === 0);
  await shotScene(t, "ipad-G2-third-error-then-correct", "iPad: three errors, then correct without a hint — accepted; success and a distinct next action");
  // resume (reload) returns straight to the open question — not the old success card — with the solved question kept
  await t.reload();
  await waitStep(t, "G2-PACK");
  check("J2.resume-returns-to-open-question", (await t.locator("[data-testid='solve-next-question']").count()) === 0 && (await t.locator("[data-testid='part-question']").innerText()).startsWith("Wie viele Setzlinge") && (await t.locator("[data-testid='solve-answered']").innerText()).includes("4 Tragen"));
  await shotScene(t, "ipad-G2-resume-open-question", "iPad after reload: the open question directly, the solved question kept above it");
  await answerPart(t, "2");
  check("J2.G2.first-try-after-earlier-retries-stays-independent", (await missionRun()).steps["G2-PACK"].parts.left.evidence === "independent");
  await shotScene(t, "ipad-G2-success-next", "iPad: success in words with the next-question action");
  await t.locator("[data-testid='solve-next-question']").tap();
  await settle(300);
  await answerPart(t, "4");
  await t.locator("[data-testid='hint-open']").tap();
  await t.locator("[data-testid='hint-pick-Ja']").tap();
  await settle(400);
  await shotScene(t, "ipad-G2-hint-expanded", "iPad: hint opened on request, its question answered, content directly beneath the control");
  await t.locator("[data-testid='hint-open']").tap();
  await t.waitForSelector("[data-testid='hint'][data-hint='G2-total-H2']");
  await t.waitForSelector("[data-testid='hint-solution']");
  await t.locator("[data-testid='hint-solution']").tap();
  await t.waitForSelector("[data-testid='part-teach']");
  // The exposure table keeps one durable "answer revealed" row per question (the count picture of hint 2 wrote it first);
  // the chosen solution is recorded as its own teaching event with chosenByChild.
  {
    const ex = (await rows("family_learning_exposures")).filter((x) => x.kind === "answer_revealed" && String(x.task_id).endsWith("G2-PACK/total"));
    const teach = (await rows("family_learning_support_events")).filter((x) => x.kind === "mission_direct_teaching").map((x) => JSON.parse(String(x.payload_json)));
    check("J2.G2.solution-only-when-asked-recorded-then", ex.length === 1 && ex[0].source === "mission-hint" && teach.length === 1 && teach[0].chosenByChild === true && teach[0].part === "total", { ex: ex.map((x) => x.source), teach });
  }
  await answerPart(t, "4");
  check("J2.G2.wrong-copy-stays-open", (await t.locator("[data-testid='scene-feedback']").getAttribute("data-tone")) === "practice-wrong");
  // Nokt on the iPad: beside the task (≥ 768 px)
  await t.locator("[data-testid='nokt-button']").tap();
  await t.waitForSelector("[data-testid='nokt-panel']");
  check("J2.nokt.side-by-side-on-ipad", (await noOverlap(t, "[data-testid='nokt-panel']", "[data-testid='scene-task']")).ok);
  check("J2.nokt.bubble-clears-rosa-ipad-panel", (await bubbleClearsRosa(t)).ok, await bubbleClearsRosa(t));
  check("J2.nokt.task-readable-ipad-panel", (await readable(t)).ok, await readable(t));
  await shotScene(t, "ipad-nokt-side-panel", "iPad: Nokt panel beside the narrowed task");
  await t.locator("[data-testid='nokt-close']").tap();
  await answerPart(t, "5");
  await waitStep(t, "G2-PACK", "taught");
  check("J2.G2.taught-closing-not-success-line", !(await t.locator("[data-testid='scene-bubble']").innerText()).includes("Jetzt wissen wir"));
  await t.locator("[data-testid='scene-next']").tap();
  await waitStep(t, "G3-DELIVERY");
  await t.locator("[data-testid='scene-next']").tap();
  await waitStep(t, "G4-RADIO");
  // audio failure: voice route 503 and the browser speech errors → honest fallback, no listening credit
  await t.locator("[data-testid='listen-play']").tap();
  await t.waitForFunction(() => document.querySelector("[data-testid='listen-task']")?.getAttribute("data-voice") === "failed");
  await t.waitForFunction(() => document.body.innerText.includes("Der Ton hat nicht geklappt"));
  check("J2.G4.failure-message-and-locked-answers", (await text(t)).includes("Der Ton hat nicht geklappt") && (await t.locator("[data-testid='pick-plants-Ins Gewächshaus']").isDisabled()));
  await shotScene(t, "ipad-G4-audio-failed", "Audio failure: honest message; answers stay locked; text is offered as recorded help");
  await t.locator("[data-testid='listen-transcript']").tap();
  await t.waitForSelector("[data-testid='listen-script']");
  await t.locator("[data-testid='pick-plants-Ins Gewächshaus']").tap();
  await settle(300);
  await t.locator("[data-testid='pick-tools-Am Tor']").tap();
  await waitStep(t, "G4-RADIO", "done");
  check("J2.G4.text-help-supported-never-independent", (await missionRun()).steps["G4-RADIO"].outcome === "supported");
  await t.locator("[data-testid='scene-next']").tap();
  await waitStep(t, "G5-TOOLS");
  for (const r of ["hola", "Necesitamos agua", "no sé"]) {
    await t.locator("[data-testid='request-input']").fill(r);
    await t.locator("[data-testid='request-send']").tap();
    await settle(400);
  }
  await t.waitForSelector("[data-testid='request-shown']");
  await t.locator("[data-testid='request-input']").fill("Necesitamos ue");
  await t.locator("[data-testid='request-send']").tap();
  await settle(400);
  check("J2.G5.wrong-copy-not-practiced", (await missionRun()).steps["G5-TOOLS"].status === "active" && (await t.locator("[data-testid='scene-feedback'][data-tone='practice-wrong']").count()) === 1);
  await shotScene(t, "ipad-G5-wrong-copy-open", "A wrong copy after the shown sentence stays open — no false praise; keep-for-later stays available");
  await t.locator("[data-testid='request-later']").tap();
  await waitStep(t, "G5-TOOLS", "unresolved");
  check("J2.G5.unresolved-no-claro", !/claro/i.test(await t.locator("[data-testid='scene-bubble']").innerText()));
  // global Stopp and resume
  await t.locator("[data-testid='hud-stop']").tap();
  await t.waitForSelector("[data-testid='world-screen']");
  await t.goto(`${BASE}/family/learn/mission?child=santiago`);
  await t.waitForSelector("[data-testid='mission-scene']");
  check("J2.resume-same-place", ["G5-TOOLS", ""].includes((await sceneStep(t)) ?? ""), await sceneStep(t));
  // phone width: Nokt in the page flow
  await t.setViewportSize({ width: 390, height: 844 });
  await settle(400);
  await t.locator("[data-testid='nokt-button']").tap();
  await t.waitForSelector("[data-testid='nokt-panel']");
  {
    const pb = await t.locator("[data-testid='nokt-panel']").boundingBox();
    const tb = await t.locator("[data-testid='scene-task']").boundingBox();
    check("J2.nokt.phone-in-flow-above-task", pb.y + pb.height <= tb.y + 1 && pb.width > 300, { panel: pb, task: tb });
  }
  check("J2.phone.bubble-clears-rosa", (await bubbleClearsRosa(t)).ok, await bubbleClearsRosa(t));
  check("J2.phone.task-readable", (await readable(t)).ok, await readable(t));
  await shotScene(t, "phone-nokt-in-flow", "Phone width: Nokt opens in the page flow (no overlay)");

  }
  // ============================================================ J3 fictional Nokt stub (separate server) ============================================================
  if (STUB_BASE && ONLY_STUB && TURN && PERSONA && OUTCOME_PERSONAS[PERSONA]) {
    // ============================================================ J6 structured outcome: scripted history + ONE live final turn ============================================================
    const persona = OUTCOME_PERSONAS[PERSONA];
    if (!STUB_ORIGIN) throw new Error("--stub-bridge-origin is required for the scripted history");
    await sixVisitsDone();
    const ctx = await makeCtx(STUB_BASE, { viewport: { width: 1280, height: 900 } }, assistant, { speech: "end", voice: "fail", allowOrigins: [BRIDGE_ORIGIN, STUB_ORIGIN] });
    const t = await ctx.newPage();
    openPages.push(t);
    t.setDefaultTimeout(20000);
    t.on("pageerror", (e) => pageErrors.push({ page: "outcome", message: String(e) }));
    await t.goto(`${STUB_BASE}/family/learn/mission?child=santiago`);
    await t.waitForSelector("[data-testid='start-visit']");
    await t.locator("[data-testid='start-visit']").click();
    await waitStep(t, "G1-REQUEST", "active");
    await nextBeat(t, "G2-PACK");
    await answerPart(t, persona.attempt);
    if (persona.hint) {
      await t.locator("[data-testid='hint-open']").click();
      await t.waitForSelector("[data-testid='hint'][data-hint='G2-full-H1']");
    }
    // the same three steps the client runs; `scripted` only ever goes to the stub (the runtime refuses the field)
    const turnVia = (text, origin, scripted) =>
      t.evaluate(async ({ text, origin, scripted, sessionId }) => {
        const s = await (await fetch("/api/family/learning/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ childId: "santiago" }) })).json();
        const auth = { authorization: "Bearer " + s.token, "content-type": "application/json" };
        const v = (await (await fetch("/api/family/learning/mission", { headers: { authorization: "Bearer " + s.token } })).json()).view;
        const context = { erasureGeneration: v.erasureGeneration, visit: v.visit ? { id: v.visit.id, startedAt: v.visit.startedAt } : null };
        const turnId = "turn-o-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const d = await (await fetch("/api/family/learning/nokt/turn/dispatch", { method: "POST", headers: auth, body: JSON.stringify({ step: "G2-PACK", part: "full", purpose: "diagnostic", entry: "manual", sessionId, turnId, text, via: "typed", expectedRevision: v.revision, context }) })).json();
        const t0 = Date.now();
        const res = await fetch(origin + "/v1/nokt/turn", { method: "POST", headers: { authorization: "Bearer " + d.result.bridge.token, "content-type": "application/json" }, body: JSON.stringify({ turnId, request: d.result.request, ...(scripted ? { scripted } : {}) }), credentials: "omit", mode: "cors" });
        const b = await res.json().catch(() => ({}));
        const ms = Date.now() - t0;
        const r = await (await fetch("/api/family/learning/nokt/turn/reply", { method: "POST", headers: auth, body: JSON.stringify({ step: "G2-PACK", turnId, reply: typeof b.reply === "string" ? b.reply : null, receipt: typeof b.receipt === "string" ? b.receipt : null, expectedRevision: d.view.revision, context }) })).json();
        return { turnId, phase: d.result.request.context.phase, bridgeStatus: res.status, ms, rawReply: b.reply ?? null, code: b.code ?? null, receipt: b.receipt ?? null, result: r.result ?? r };
      }, { text, origin, scripted: scripted ? JSON.stringify(scripted) : null, sessionId: `talk-${PERSONA}` });
    const history = [];
    for (const h of persona.history) history.push(await turnVia(h.text, STUB_ORIGIN, h.scripted));
    if (DRY_FINAL && BRIDGE_ORIGIN !== STUB_ORIGIN) throw new Error("--dry-final-scripted only with the stub as bridge origin");
    const final = await turnVia(persona.final.text, BRIDGE_ORIGIN, DRY_FINAL ? JSON.parse(DRY_FINAL) : null);
    const decode = (rc) => {
      try {
        const c = JSON.parse(Buffer.from(String(rc).split(".")[1], "base64url").toString("utf8"));
        return { v: c.v, sub: c.sub, sid: c.sid, key: c.key, mdl: c.mdl, run: c.run, iat: c.iat, req: c.req, res: c.res };
      } catch {
        return null;
      }
    };
    const st = (await rawRow()).state.missions["MISSION-ISLAND-GARDEN"].steps["G2-PACK"];
    const pctx = await makeCtx(STUB_BASE, { viewport: { width: 1280, height: 900 } }, owner);
    const pp = await pctx.newPage();
    openPages.push(pp);
    await pp.goto(`${STUB_BASE}/family/learn/parent?child=santiago`);
    await pp.waitForSelector("[data-testid='tutor-G2-PACK']", { timeout: 20000 });
    const parentTutor = await pp.locator("[data-testid='tutor-G2-PACK']").innerText();
    const parentNext = await pp.locator("[data-testid='parent-next-step']").innerText();
    const parentPage = await pp.locator("body").innerText();
    await pp.locator("[data-testid='tutor-G2-PACK']").scrollIntoViewIfNeeded();
    await shot(pp, `outcome-${PERSONA}-parent`);
    const record = {
      persona: PERSONA,
      label: persona.label,
      firstAnswer: persona.attempt,
      hintOpenedBeforeTalk: persona.hint,
      scriptedHistory: history.map((h, i) => ({ his: persona.history[i].text, scriptedNokt: persona.history[i].scripted.say, phaseAtDispatch: h.phase, verdict: h.result })),
      liveFinalTurn: { his: persona.final.text, probe: persona.final.probe, phaseAtDispatch: final.phase, bridgeStatus: final.bridgeStatus, latencyMs: final.ms, rawReply: final.rawReply, code: final.code, receipt: final.receipt ? decode(final.receipt) : null, appResult: final.result },
      appRecord: (st.tutorTurns ?? []).map((x) => ({ role: x.role, text: x.text, intent: x.intent ?? null, origin: x.origin ?? null, shown: x.shown, reason: x.reason ?? null, outcome: x.outcome ?? null })),
      acceptedOutcomes: st.tutorOutcomes ?? [],
      question: { status: st.parts.full.status, evidence: st.parts.full.evidence, hints: st.parts.full.hints.map((h) => h.id), exposed: st.parts.full.exposed, inheritedSupport: st.parts.full.inheritedSupport ?? [] },
      parentTutorColumn: parentTutor,
    };
    fs.writeFileSync(path.join(OUT, `outcome-${PERSONA}.json`), JSON.stringify(record, null, 2));
    check(`J6.${PERSONA}.history-through-real-engine`, history.every((h) => h.bridgeStatus === 200 && h.result?.shown === true), history.map((h) => [h.bridgeStatus, h.result?.shown, h.result?.reason ?? null]));
    if (DRY_FINAL) check(`J6.${PERSONA}.final-turn-DRY-scripted-via-stub-not-a-model`, final.bridgeStatus === 200 && decode(final.receipt)?.mdl === "openai/stub-fictional", { status: final.bridgeStatus, mdl: decode(final.receipt)?.mdl ?? null });
    else check(`J6.${PERSONA}.final-turn-live-exact-model`, final.bridgeStatus === 200 && decode(final.receipt)?.mdl === "openai/gpt-6.1-sol", { status: final.bridgeStatus, code: final.code });
    check(`J6.${PERSONA}.no-false-completion`, st.parts.full.status === "open");
    check(`J6.${PERSONA}.independence-never-granted-after-help`, !persona.hint || !(st.tutorOutcomes ?? []).some((o) => o.status === "understood"), st.tutorOutcomes ?? []);
    // Round 13: the summary must come from the persisted records — a recorded conversation is never called inactive, a null outcome
    // is "no assessment", an accepted/refused one is named as such, and the next-step line agrees.
    const outcomeOf = final.result?.outcome ?? null;
    const expectAssessment = outcomeOf == null ? /Keine Tutor-Einschätzung erfasst\./ : outcomeOf.refused ? /von der App abgelehnt/ : /von der App angenommen/;
    check(`J6.${PERSONA}.parent-record-shows-what-happened`, /Gespräch mit Nokt aufgezeichnet: \d+ Zeile\(n\) des Kindes, \d+ geprüfte Antwort/.test(parentTutor) && expectAssessment.test(parentTutor), parentTutor.slice(0, 400));
    check(`J6.${PERSONA}.parent-no-contradictory-inactive-text`, !/nicht aktiv/.test(parentPage) && /Gespräch mit Nokt aufgezeichnet/.test(parentNext), { next: parentNext.slice(-200), inactive: (parentPage.match(/[^\n]*nicht aktiv[^\n]*/g) ?? []).slice(0, 3) });
  } else if (STUB_BASE && ONLY_STUB && TURN && PERSONA) {
    // ============================================================ J5 live fictional persona on the subscription ============================================================
    const persona = PERSONAS[PERSONA];
    if (!persona) throw new Error(`unknown persona ${PERSONA}`);
    await sixVisitsDone();
    const ctx = await makeCtx(STUB_BASE, { viewport: { width: 1280, height: 900 } }, assistant, { speech: "end", voice: "fail", allowOrigins: [BRIDGE_ORIGIN] });
    const t = await ctx.newPage();
    openPages.push(t);
    t.setDefaultTimeout(20000);
    t.on("pageerror", (e) => pageErrors.push({ page: "live", message: String(e) }));
    const bridgeCalls = [];
    const started = new Map();
    t.on("request", (r) => {
      if (r.url().startsWith(BRIDGE_ORIGIN) && r.method() === "POST") started.set(r, Date.now());
    });
    t.on("response", async (r) => {
      const req = r.request();
      if (!r.url().startsWith(BRIDGE_ORIGIN) || req.method() !== "POST") return;
      const entry = { status: r.status(), ms: Date.now() - (started.get(req) ?? Date.now()), body: null };
      try {
        entry.body = await r.json();
      } catch {}
      bridgeCalls.push(entry);
    });
    await t.goto(`${STUB_BASE}/family/learn/mission?child=santiago`);
    await t.waitForSelector("[data-testid='start-visit']");
    await t.locator("[data-testid='start-visit']").click();
    await waitStep(t, "G1-REQUEST", "active");
    await nextBeat(t, "G2-PACK");
    await answerPart(t, persona.attempt);
    await t.locator("[data-testid='nokt-button']").click();
    await t.waitForSelector("[data-testid='nokt-panel'][data-mode='fictional-stub']");
    const shownLines = [];
    let stoppedAfterError = false;
    for (const turn of persona.turns) {
      // Budget guard: after any runtime error, send NO further turns (each would spend a counted attempt).
      if (bridgeCalls.some((c) => c.status !== 200)) {
        stoppedAfterError = true;
        break;
      }
      if (turn.via === "typed") {
        const before = await t.locator("[data-testid='nokt-transcript'] li[data-role]").count();
        await t.locator("[data-testid='nokt-input']").fill(turn.text);
        await t.locator("[data-testid='nokt-send']").click();
        await t.waitForFunction((n) => document.querySelectorAll("[data-testid='nokt-transcript'] li[data-role]").length >= n + 2, before, { timeout: 200000 });
        const last = t.locator("[data-testid='nokt-transcript'] li[data-role]").last();
        shownLines.push({ role: await last.getAttribute("data-role"), text: await last.innerText() });
      } else {
        // A spoken (here: fictional garbled) transcript: the same three steps the client runs, with via "voice".
        const out = await t.evaluate(async ({ text, origin }) => {
          const s = await (await fetch("/api/family/learning/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ childId: "santiago" }) })).json();
          const auth = { authorization: "Bearer " + s.token, "content-type": "application/json" };
          const v = (await (await fetch("/api/family/learning/mission", { headers: { authorization: "Bearer " + s.token } })).json()).view;
          const context = { erasureGeneration: v.erasureGeneration, visit: v.visit ? { id: v.visit.id, startedAt: v.visit.startedAt } : null };
          const turnId = "turn-voice-" + Date.now().toString(36);
          const d = await (await fetch("/api/family/learning/nokt/turn/dispatch", { method: "POST", headers: auth, body: JSON.stringify({ step: "G2-PACK", part: "full", purpose: "diagnostic", entry: "manual", sessionId: "talk-voice", turnId, text, via: "voice", expectedRevision: v.revision, context }) })).json();
          const b = await (await fetch(origin + "/v1/nokt/turn", { method: "POST", headers: { authorization: "Bearer " + d.result.bridge.token, "content-type": "application/json" }, body: JSON.stringify({ turnId, request: d.result.request }), credentials: "omit", mode: "cors" })).json();
          const r = await (await fetch("/api/family/learning/nokt/turn/reply", { method: "POST", headers: auth, body: JSON.stringify({ step: "G2-PACK", turnId, reply: typeof b.reply === "string" ? b.reply : null, receipt: typeof b.receipt === "string" ? b.receipt : null, expectedRevision: d.view.revision, context }) })).json();
          return r.result ?? r;
        }, { text: turn.text, origin: BRIDGE_ORIGIN });
        shownLines.push({ role: out.shown ? "nokt" : "app", text: out.shown ? out.say : out.line ?? JSON.stringify(out) });
      }
    }
    await shotScene(t, `live-${PERSONA}-${persona.label}`, `Live fictional persona ${PERSONA} (${persona.label}) on the subscription`);
    let st = (await rawRow()).state.missions["MISSION-ISLAND-GARDEN"].steps["G2-PACK"];
    let afterAnswer = null;
    if (persona.afterAnswer) {
      await t.locator("[data-testid='nokt-close']").click();
      await answerPart(t, persona.afterAnswer);
      st = (await rawRow()).state.missions["MISSION-ISLAND-GARDEN"].steps["G2-PACK"];
      afterAnswer = { status: st.parts.full.status, evidence: st.parts.full.evidence, inheritedSupport: st.parts.full.inheritedSupport ?? [] };
    }
    const decode = (rc) => {
      try {
        const c = JSON.parse(Buffer.from(String(rc).split(".")[1], "base64url").toString("utf8"));
        return { v: c.v, sub: c.sub, sid: c.sid, key: c.key, mdl: c.mdl, run: c.run, iat: c.iat, req: c.req, res: c.res };
      } catch {
        return null;
      }
    };
    const record = {
      persona: PERSONA,
      label: persona.label,
      firstAnswer: persona.attempt,
      turns: persona.turns.map((turn, i) => ({ sent: turn.text, via: turn.via, probe: turn.probe, bridge: bridgeCalls[i] ? { status: bridgeCalls[i].status, latencyMs: bridgeCalls[i].ms, rawReply: bridgeCalls[i].body?.reply ?? null, code: bridgeCalls[i].body?.code ?? null, receipt: bridgeCalls[i].body?.receipt ? decode(bridgeCalls[i].body.receipt) : null } : null, shownToChild: shownLines[i] ?? null })),
      appRecord: (st.tutorTurns ?? []).map((x) => ({ role: x.role, text: x.text, via: x.via ?? null, intent: x.intent ?? null, origin: x.origin ?? null, shown: x.shown, reason: x.reason ?? null })),
      outcomes: st.tutorOutcomes ?? [],
      part: { status: st.parts.full.status, evidence: st.parts.full.evidence, exposed: st.parts.full.exposed, inheritedSupport: st.parts.full.inheritedSupport ?? [] },
      afterAnswer,
      stoppedAfterError,
    };
    fs.writeFileSync(path.join(OUT, `live-${PERSONA}.json`), JSON.stringify(record, null, 2));
    check(`J5.${PERSONA}.every-turn-answered-by-the-runtime`, bridgeCalls.length === persona.turns.length, bridgeCalls.map((c) => [c.status, c.body?.code ?? null]));
    check(`J5.${PERSONA}.reported-model-in-every-receipt`, record.turns.every((x) => x.bridge?.receipt?.mdl === "openai/gpt-6.1-sol"), record.turns.map((x) => x.bridge?.receipt?.mdl ?? x.bridge?.code));
    check(`J5.${PERSONA}.app-verdict-recorded-for-every-reply`, record.appRecord.filter((x) => x.role === "nokt").length === persona.turns.length);
    check(`J5.${PERSONA}.no-false-completion-from-the-talk`, persona.afterAnswer ? true : st.parts.full.status === "open");
  } else if (STUB_BASE && ONLY_STUB && SUBSCRIPTION_EXHAUSTED) {
    // ============================================================ J7 real conversation mode, day used up (no model, no network) ============================================================
    await sixVisitsDone();
    // A reserved, never-resolvable name (RFC 2606 .invalid), answered only inside this browser context — never a network host.
    const bridge = (opt("--intercepted-bridge", "") || "").replace(/\/$/, "");
    if (!/^https:\/\/[a-z0-9-]+\.invalid(:\d+)?$/.test(bridge)) throw new Error("--intercepted-bridge must be an https://<name>.invalid origin");
    const xctx = await makeCtx(STUB_BASE, { viewport: { width: 1280, height: 900 } }, assistant, { speech: "end", voice: "fail", allowOrigins: [bridge] });
    const bridgeCalls = [];
    const cors = { "access-control-allow-origin": STUB_BASE, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "authorization, content-type", vary: "Origin" };
    // Answered in the browser context exactly like the runtime answers a used-up day (src/nokt/handler.ts: 429 attempts_exhausted).
    await xctx.route(`${bridge}/**`, (r) => {
      bridgeCalls.push({ method: r.request().method(), path: new URL(r.request().url()).pathname, auth: !!r.request().headers().authorization });
      if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: cors });
      return r.fulfill({ status: 429, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ ok: false, code: "attempts_exhausted" }) });
    });
    const x = await xctx.newPage();
    openPages.push(x);
    x.on("pageerror", (e) => pageErrors.push({ page: "subscription", message: String(e) }));
    await x.goto(`${STUB_BASE}/family/learn/mission?child=santiago`);
    await x.waitForSelector("[data-testid='start-visit']");
    await x.locator("[data-testid='start-visit']").click();
    await waitStep(x, "G1-REQUEST", "active");
    await nextBeat(x, "G2-PACK");
    await answerPart(x, "3");
    await x.locator("[data-testid='nokt-button']").click();
    await x.waitForSelector("[data-testid='nokt-panel'][data-mode='subscription']");
    const panelText = await x.locator("[data-testid='nokt-panel']").innerText();
    check("J7.real-conversation-no-test-banner-no-mic-typed-only", !panelText.includes("Testmodus") && (await x.locator("[data-testid='nokt-mic']").count()) === 0 && (await x.locator("label[for='nokt-input']").innerText()).trim() === "Schreib es hier:", panelText.slice(0, 200));
    const typed = "Ich glaube, es sind fünf Tragen.";
    await x.locator("[data-testid='nokt-input']").fill(typed);
    await x.locator("[data-testid='nokt-send']").click();
    await x.waitForSelector("[data-testid='nokt-transcript'] li[data-role='app']", { timeout: 20000 });
    const appLine = await x.locator("[data-testid='nokt-transcript'] li[data-role='app']").last().innerText();
    check("J7.exhausted-child-friendly-line", appLine.includes("Nokt hat heute schon viel geredet und macht jetzt Pause. Morgen ist Nokt wieder da."), appLine);
    check("J7.typed-input-preserved", (await x.locator("[data-testid='nokt-input']").inputValue()) === typed);
    await shot(x, "subscription-exhausted-panel");
    const st = (await rawRow()).state.missions["MISSION-ISLAND-GARDEN"].steps["G2-PACK"];
    const turns = st.tutorTurns ?? [];
    check("J7.recorded-as-no-reply-daily-allowance", JSON.stringify(turns.map((t) => [t.role, t.shown, t.reason ?? null])) === JSON.stringify([["child", true, null], ["nokt", false, "no-reply-daily-allowance"]]), turns.map((t) => [t.role, t.shown, t.reason ?? null]));
    check("J7.no-outcome-no-completion", (st.tutorOutcomes ?? []).length === 0 && st.parts.full.status === "open");
    check("J7.browser-called-the-bridge-once-with-bearer", bridgeCalls.filter((c) => c.method === "POST").length === 1 && bridgeCalls.every((c) => c.path === "/v1/nokt/turn") && bridgeCalls.filter((c) => c.method === "POST").every((c) => c.auth), bridgeCalls);
    const pctx = await makeCtx(STUB_BASE, { viewport: { width: 1280, height: 900 } }, owner);
    const pp = await pctx.newPage();
    openPages.push(pp);
    await pp.goto(`${STUB_BASE}/family/learn/parent?child=santiago`);
    await pp.waitForSelector("[data-testid='talk-G2-PACK']", { timeout: 20000 });
    const talk = await pp.locator("[data-testid='talk-G2-PACK']").innerText();
    const tutorCol = await pp.locator("[data-testid='tutor-G2-PACK']").innerText();
    check("J7.parent-sees-why-there-was-no-reply", talk.includes(typed) && talk.includes("Tageskontingent") && /Keine Tutor-Einschätzung erfasst/.test(tutorCol), talk.slice(0, 400));
    await pp.locator("[data-testid='talk-G2-PACK']").scrollIntoViewIfNeeded();
    await shot(pp, "subscription-exhausted-parent");
  } else if (STUB_BASE && ONLY_STUB && TURN) {
    // ============================================================ J4 Nokt turn: dispatch → the BROWSER asks the (stub) bridge → verified reply ============================================================
    // Desktop viewport: Santiago uses Visit 7 in the Mac mini's browser (owner correction, October 23 14:51).
    await sixVisitsDone();
    const tctx = await makeCtx(STUB_BASE, { viewport: { width: 1280, height: 900 } }, assistant, { speech: "end", voice: "fail", allowOrigins: BRIDGE_ORIGIN ? [BRIDGE_ORIGIN] : [] });
    const appRequests = [];
    tctx.on("request", (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith("/api/family/learning/nokt/turn/")) appRequests.push(u.pathname);
    });
    const t = await tctx.newPage();
    openPages.push(t);
    t.on("pageerror", (e) => pageErrors.push({ page: "turn", message: String(e) }));
    await t.goto(`${STUB_BASE}/family/learn/mission?child=santiago`);
    await t.waitForSelector("[data-testid='start-visit']");
    await t.locator("[data-testid='start-visit']").click();
    await waitStep(t, "G1-REQUEST", "active");
    await nextBeat(t, "G2-PACK");
    await answerPart(t, "3");
    await t.locator("[data-testid='nokt-button']").click();
    await t.waitForSelector("[data-testid='nokt-panel'][data-mode='fictional-stub']");
    const sendTyped = async (text) => {
      const before = await t.locator("[data-testid='nokt-transcript'] li[data-role]").count();
      await t.locator("[data-testid='nokt-input']").fill(text);
      await t.locator("[data-testid='nokt-send']").click();
      await t.waitForFunction((n) => document.querySelectorAll("[data-testid='nokt-transcript'] li[data-role]").length >= n + 2, before, { timeout: 15000 });
      return t.locator("[data-testid='nokt-transcript'] li[data-role]").last();
    };
    const speechBefore = speechRequests.length;
    const r1 = await sendTyped("Ich glaube fünf.");
    check("J4.verified-reply-shown-as-nokt-and-spoken", (await r1.getAttribute("data-role")) === "nokt" && (await r1.innerText()).includes("Was sollst du bei dieser Frage herausfinden?") && speechRequests.length > speechBefore);
    const r2 = await sendTyped("Wie viele Tragen.");
    check("J4.teach-label-with-answer-withheld-app-line", (await r2.getAttribute("data-role")) === "app" && (await r2.innerText()).includes("Hinweis der App") && !(await t.locator("[data-testid='nokt-transcript']").innerText()).includes("4 Tragen"));
    const r3 = await sendTyped("Geraten.");
    check("J4.forged-receipt-withheld", (await r3.getAttribute("data-role")) === "app");
    await shotScene(t, "turn-nokt-verified-and-withheld", "Nokt turn route (stub backend): a verified line shown as Nokt; a «teach» reply with the answer and a forged receipt withheld behind the reviewed app line");
    // replay: the FIRST turn's reply posted again with different text and no receipt is not applied a second time
    const before = (await rawRow()).state.missions["MISSION-ISLAND-GARDEN"].steps["G2-PACK"].tutorTurns;
    const firstTurnId = before.find((x) => x.role === "nokt" && x.shown).turnId;
    const replay = await t.evaluate(async (turnId) => {
      const s = await (await fetch("/api/family/learning/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ childId: "santiago" }) })).json();
      const v = (await (await fetch("/api/family/learning/mission", { headers: { authorization: "Bearer " + s.token } })).json()).view;
      const r = await fetch("/api/family/learning/nokt/turn/reply", { method: "POST", headers: { authorization: "Bearer " + s.token, "content-type": "application/json" }, body: JSON.stringify({ step: "G2-PACK", turnId, reply: JSON.stringify({ v: 1, say: "Ersetzt.", intent: "clarify", outcome: null }), receipt: null, expectedRevision: v.revision, context: { erasureGeneration: v.erasureGeneration, visit: v.visit ? { id: v.visit.id, startedAt: v.visit.startedAt } : null } }) });
      return { status: r.status, body: await r.json() };
    }, firstTurnId);
    const after = (await rawRow()).state.missions["MISSION-ISLAND-GARDEN"].steps["G2-PACK"].tutorTurns;
    check("J4.replayed-reply-not-applied-twice", after.length === before.length && !JSON.stringify(after).includes("Ersetzt."), { status: replay.status, result: replay.body?.status ?? replay.body?.error, lines: [before.length, after.length] });
    // stale navigation: the 4th reply is delayed by the stub; leaving the mission page aborts the turn before it lands
    await t.locator("[data-testid='nokt-input']").fill("Noch eine Frage.");
    await t.locator("[data-testid='nokt-send']").click();
    await settle(600);
    await t.goto(`${STUB_BASE}/family/learn?child=santiago`);
    await settle(4500);
    const st = (await rawRow()).state.missions["MISSION-ISLAND-GARDEN"].steps["G2-PACK"];
    const turns = st.tutorTurns ?? [];
    check("J4.navigated-away-turn-never-recorded-as-nokt", turns.filter((x) => x.role === "child").length === 4 && turns.filter((x) => x.role === "nokt").length === 3, turns.map((x) => [x.role, x.shown, x.reason ?? null]));
    check("J4.withheld-reasons-recorded", JSON.stringify(turns.filter((x) => x.role === "nokt").map((x) => [x.shown, x.reason ?? null, x.origin])) === JSON.stringify([[true, null, "verified"], [false, "intent-not-in-phase", "verified"], [false, "origin-invalid", "invalid"]]), turns.filter((x) => x.role === "nokt").map((x) => [x.shown, x.reason ?? null, x.origin]));
    check("J4.no-false-completion", st.parts.full.status === "open" && st.status === "active" && (st.tutorOutcomes ?? []).length === 0 && st.parts.full.exposed.length === 0 && (st.parts.full.inheritedSupport ?? []).length === 0);
    const calls = BRIDGE_LOG && fs.existsSync(BRIDGE_LOG) ? fs.readFileSync(BRIDGE_LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
    check("J4.browser-mediated-learn-token-no-cookie-no-answer-key", calls.length === 4 && calls.every((c) => c.origin === STUB_BASE && c.child === "santiago" && !c.cookie && !c.answerField && c.phase === "nachfragen") && !calls.some((c) => c.refused), calls);
    check("J4.app-routes-dispatch-then-reply-per-answered-turn", appRequests.filter((x) => x.endsWith("/dispatch")).length === 4 && appRequests.filter((x) => x.endsWith("/reply")).length === 3 + 1, appRequests); // 3 answered turns + the replay probe; the navigated-away turn posts none
    // the parent sees the talk: his lines, Nokt's verified line, and the withheld replies with their reason
    const pctx = await makeCtx(STUB_BASE, { viewport: { width: 1280, height: 900 } }, owner);
    const pp = await pctx.newPage();
    openPages.push(pp);
    await pp.goto(`${STUB_BASE}/family/learn/parent?child=santiago`);
    await pp.waitForSelector("[data-testid='talk-G2-PACK']", { timeout: 20000 });
    const talk = await pp.locator("[data-testid='talk-G2-PACK']").innerText();
    check("J4.parent-sees-talk", talk.includes("Ich glaube fünf.") && talk.includes("Was sollst du bei dieser Frage herausfinden?") && talk.includes("passte nicht zur Gesprächsphase") && talk.includes("Herkunft ungültig") && talk.includes("Noch eine Frage."), talk.slice(0, 600));
    await pp.locator("[data-testid='talk-G2-PACK']").scrollIntoViewIfNeeded();
    await shot(pp, "turn-parent-talk");
  } else if (STUB_BASE && ONLY_STUB && !STUB_FAULT) {
    const stubCtx = await makeCtx(STUB_BASE, { viewport: { width: 820, height: 1180 }, hasTouch: true }, assistant, { speech: "end", voice: "fail" });
    await stubCtx.grantPermissions(["microphone"], { origin: STUB_BASE });
    await stubCtx.addInitScript(() => {
      window.__gumCalls = 0;
      const tracks = [];
      window.__liveTracks = () => tracks.filter((t) => t.readyState === "live").length;
      const original = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
      if (original)
        navigator.mediaDevices.getUserMedia = async (constraints) => {
          window.__gumCalls += 1;
          const stream = await original(constraints);
          tracks.push(...stream.getTracks());
          return stream;
        };
    });
    const s = await stubCtx.newPage();
    openPages.push(s);
    s.on("pageerror", (e) => pageErrors.push({ page: "stub", message: String(e) }));
    await s.goto(`${STUB_BASE}/family/learn/mission?child=santiago`);
    await s.waitForSelector("[data-testid='mission-scene']");
    await s.locator("[data-testid='nokt-button']").tap();
    await s.waitForSelector("[data-testid='nokt-panel'][data-mode='fictional-stub']");
    check("J3.stub.mic-only-on-explicit-start", (await s.locator("[data-testid='nokt-mic-stop']").count()) === 0 && (await s.evaluate(() => window.__gumCalls)) === 0, await s.evaluate(() => window.__gumCalls));
    // Cancel while live: the microphone is released and nothing is uploaded.
    await s.locator("[data-testid='nokt-mic-start']").tap();
    await s.waitForSelector("[data-testid='nokt-mic'][data-mic='live']");
    await s.locator("[data-testid='nokt-mic-cancel']").tap();
    await settle(600);
    check("J3.stub.cancel-uploads-nothing", (await s.locator("[data-testid='nokt-mic']").getAttribute("data-mic")) === "idle" && noktUploads.filter((u) => u.base === STUB_BASE).length === 0 && (await s.locator("[data-testid='nokt-input']").inputValue()) === "" && (await s.evaluate(() => window.__liveTracks())) === 0, { uploads: noktUploads.length, live: await s.evaluate(() => window.__liveTracks()) });
    // A real recording from the synthetic microphone → upload with the child credential → the fake recognizer's sentence in the editable field.
    await s.locator("[data-testid='nokt-mic-start']").tap();
    await s.waitForSelector("[data-testid='nokt-mic'][data-mic='live']");
    await settle(900);
    await s.locator("[data-testid='nokt-mic-stop']").tap();
    await s.waitForFunction(() => document.querySelector("[data-testid='nokt-input']")?.value);
    const ups = noktUploads.filter((u) => u.base === STUB_BASE);
    check("J3.stub.push-to-talk-uploads-recording-with-child-credential", ups.length === 1 && ups[0].bearer && ups[0].multipart && ups[0].bytes > 500, ups);
    check("J3.stub.visible-correctable-transcript", (await s.locator("[data-testid='nokt-input']").inputValue()) === "Ich weiss nicht, wie ich anfangen soll." && (await s.locator("label[for='nokt-input']").innerText()).includes("korrigieren"));
    check("J3.stub.microphone-released-after-turn", (await s.evaluate(() => window.__liveTracks())) === 0 && (await s.locator("[data-testid='nokt-mic']").getAttribute("data-mic")) === "idle");
    await s.locator("[data-testid='nokt-input']").fill("Ich glaube, es sind fünf Tragen.");
    await s.locator("[data-testid='nokt-send']").tap();
    await s.waitForSelector("[data-testid='nokt-transcript'] [data-role='nokt']");
    await settle(500);
    check("J3.stub.reply-spoken-in-german-nokt-voice", speechRequests.some((r) => r.body?.speaker === "nokt" && r.body?.language === "de"));
    check("J3.stub.labelled-as-test", (await s.locator("[data-testid='nokt-stub']").innerText()).includes("Testmodus"));
    await shotScene(s, "stub-nokt-push-to-talk", "Fictional stub only (isolated DB): push-to-talk → visible transcript → written reply → spoken reply");
    const outcomes = (await rows("family_learning_support_events")).filter((r) => r.kind === "mission_tutor_outcome" || r.kind === "mission_tutor_dispatch");
    check("J3.stub.no-tutor-evidence-recorded", outcomes.length === 0);
    // Nothing of the turn is persisted: the recognized sentence appears in no table of the synthetic database.
    const dbHits = await (async () => {
      const c = createClient({ url: "file:" + DB });
      try {
        const tables = (await c.execute("SELECT name FROM sqlite_master WHERE type = 'table'")).rows.map((r) => String(r.name));
        const hits = [];
        for (const t of tables) {
          const r = await c.execute(`SELECT * FROM "${t}"`);
          for (const row of r.rows) if (r.columns.some((k) => typeof row[k] === "string" && row[k].includes("wie ich anfangen soll"))) hits.push(t);
        }
        return hits;
      } finally {
        c.close();
      }
    })();
    check("J3.stub.transcript-and-audio-not-persisted", dbHits.length === 0, dbHits);
  } else if (STUB_BASE && ONLY_STUB && STUB_FAULT) {
    // ============================================================ J3-fault: provider account exhausted (fake 429) ============================================================
    const stubCtx = await makeCtx(STUB_BASE, { viewport: { width: 820, height: 1180 }, hasTouch: true }, assistant, { speech: "end", voice: "fail" });
    await stubCtx.grantPermissions(["microphone"], { origin: STUB_BASE });
    const s = await stubCtx.newPage();
    openPages.push(s);
    s.on("pageerror", (e) => pageErrors.push({ page: "stub-fault", message: String(e) }));
    const statuses = [];
    s.on("response", (r) => {
      if (new URL(r.url()).pathname === "/api/family/learning/nokt/transcribe") statuses.push(r.status());
    });
    await s.goto(`${STUB_BASE}/family/learn/mission?child=santiago`);
    await s.waitForSelector("[data-testid='mission-scene']");
    await s.locator("[data-testid='nokt-button']").tap();
    await s.waitForSelector("[data-testid='nokt-panel'][data-mode='fictional-stub']");
    const typed = "Ich habe das schon getippt.";
    await s.locator("[data-testid='nokt-input']").fill(typed);
    await s.locator("[data-testid='nokt-mic-start']").tap();
    await s.waitForSelector("[data-testid='nokt-mic'][data-mic='live']");
    await settle(700);
    await s.locator("[data-testid='nokt-mic-stop']").tap();
    await s.waitForSelector("[data-testid='nokt-mic'][data-mic='trouble']");
    check("J3F.upload-refused-503-not-success", statuses.length === 1 && statuses[0] === 503, statuses);
    check("J3F.typed-input-preserved", (await s.locator("[data-testid='nokt-input']").inputValue()) === typed);
    check("J3F.no-transcription-claimed", !(await s.locator("label[for='nokt-input']").innerText()).includes("verstanden") && (await s.locator("[data-testid='nokt-transcript']").innerText()).includes("Hallo Santi") && !(await s.locator("[data-testid='nokt-panel']").innerText()).includes("gesprochen"));
    check("J3F.trouble-offers-typing", (await s.locator("[data-testid='nokt-mic-trouble']").innerText()).includes("schreiben"));
    await shotScene(s, "stub-nokt-mic-quota-exhausted", "Fake provider answers 429 (exhausted account): typed text kept, no transcript claimed, typing offered");
    await s.locator("[data-testid='nokt-send']").tap();
    await s.waitForSelector("[data-testid='nokt-transcript'] [data-role='child']");
    check("J3F.typed-turn-still-sendable", (await s.locator("[data-testid='nokt-transcript'] [data-role='child']").first().innerText()).includes(typed) && !(await s.locator("[data-testid='nokt-transcript'] [data-role='child']").first().innerText()).includes("gesprochen"));
  } else if (ONLY_STUB) check("J3.stub.needs-stub-base", false, "run with --stub-base");

} catch (e) {
  check("journey.completed-without-exception", false, String(e).slice(0, 400));
  for (const pg of openPages) {
    try {
      await shot(pg, "FAILURE");
      console.log("FAILURE screen text:", (await text(pg)).slice(0, 800));
    } catch {}
  }
}
check("global.no-external-requests", blocked.length === 0, [...new Set(blocked)]);
check("global.no-page-errors", pageErrors.length === 0, pageErrors.slice(0, 5));
check("global.speech-never-reached-server", speechRequests.length >= (PERSONA || SUBSCRIPTION_EXHAUSTED ? 0 : ONLY_STUB ? 1 : 3) && speechRequests.every((r) => ["abort", "ok", "fail"].includes(r.mock)), speechRequests.length);
await browser.close();
const passed = results.filter((r) => r.ok).length;
fs.writeFileSync(path.join(OUT, ONLY_STUB ? (TURN ? (PERSONA ? (OUTCOME_PERSONAS[PERSONA] ? `results-outcome-${PERSONA}.json` : `results-live-${PERSONA}.json`) : "results-turn.json") : STUB_FAULT ? "results-stub-fault.json" : "results-stub.json") : "results.json"), JSON.stringify({ at: new Date().toISOString(), base: BASE, stubBase: STUB_BASE || null, passed, total: results.length, results, shots: shotsIndex, speechRequests: speechRequests.map((r) => ({ mock: r.mock, language: r.body?.language ?? null, speaker: r.body?.speaker ?? null })), noktUploads, blocked: [...new Set(blocked)], pageErrors }, null, 2));
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
