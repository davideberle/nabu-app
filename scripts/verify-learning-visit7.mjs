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
    if (u.origin !== base) {
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
  if (STUB_BASE && ONLY_STUB) {
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
check("global.speech-never-reached-server", speechRequests.length >= (ONLY_STUB ? 1 : 3) && speechRequests.every((r) => ["abort", "ok", "fail"].includes(r.mock)), speechRequests.length);
await browser.close();
const passed = results.filter((r) => r.ok).length;
fs.writeFileSync(path.join(OUT, ONLY_STUB ? "results-stub.json" : "results.json"), JSON.stringify({ at: new Date().toISOString(), base: BASE, stubBase: STUB_BASE || null, passed, total: results.length, results, shots: shotsIndex, speechRequests: speechRequests.map((r) => ({ mock: r.mock, language: r.body?.language ?? null, speaker: r.body?.speaker ?? null })), noktUploads, blocked: [...new Set(blocked)], pageErrors }, null, 2));
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
