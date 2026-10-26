#!/usr/bin/env node
// ---------------------------------------------------------------------------------------------------------------------
// Isabel Visit 1 — «Old Lilas kleine Werkstatt»: the rendered, FAKE-ONLY journey on an isolated fictional database
// (loopback server, synthetic AUTH_SECRET, no provider, no network). Never production, never a real child's record.
//
//   AUTH_SECRET=… node scripts/verify-learning-isabel.mjs --base http://127.0.0.1:3294 --db <dir>/nabu.db --out <dir> --mode isabel
//   AUTH_SECRET=… node scripts/verify-learning-isabel.mjs --base http://127.0.0.1:3295 --db <dir>/nabu.db --out <dir> --mode isabel-off
//
// --mode isabel      (server with Santiago's Nokt conversation ON, as in production): Home → Lernen → Old Lila's workshop →
//                    every beat with a wrong answer, a hint, Stopp/resume, supported reading, listening, the craft, her room,
//                    the pictured next-interest choice → Home; parent evidence + parent observation; child isolation against
//                    a synthetic Santiago record (byte-identical before/after); no Nokt, no microphone, no bridge call.
// --mode isabel-off  (FAMILY_LEARNING_ISABEL_CONTENT=off): her honest "not prepared" state; Santiago unaffected.
// Speech is answered in the browser (no voice configured, browser speech mocked and counted); nothing is audible.
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
const BASE = opt("--base", "http://127.0.0.1:3294").replace(/\/$/, "");
const OUT = opt("--out", "/tmp/family-learning-isabel");
const DB = opt("--db", null);
const MODE = opt("--mode", "isabel");
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
async function row(child) {
  const r = (await query("SELECT state_json, revision, mission_id, content_version FROM family_learning_missions WHERE child_id = ?", [child]))[0];
  return r ? { state: JSON.parse(String(r.state_json)), revision: Number(r.revision), missionId: String(r.mission_id), contentVersion: Number(r.content_version), hash: createHash("sha256").update(String(r.state_json)).digest("hex") } : null;
}
const TZ = "Europe/Zurich";

// --------------------------------------------------------------------------------------------------------------------------
// Synthetic Santiago record (invented values) so isolation is tested against a real other-child row.
// --------------------------------------------------------------------------------------------------------------------------
const santiagoBearer = await mintChild("santiago");
{
  // A started first visit is enough of a record (a GET alone writes no row).
  const v = await api("GET", `/api/family/learning/mission?tz=${TZ}`, null, assistant, santiagoBearer);
  const put = await api("PUT", "/api/family/learning/mission", { op: { op: "start-visit" }, expectedRevision: v.json.view.revision, idempotencyKey: "santiago-fixture-start", context: { erasureGeneration: v.json.view.erasureGeneration ?? 0, visit: null }, tz: TZ }, assistant, santiagoBearer);
  if (put.status !== 200) throw new Error(`santiago fixture: ${put.status}`);
}
const santiagoBefore = await row("santiago");
const santiagoRowsBefore = Number((await query("SELECT COUNT(*) AS n FROM family_learning_attempts WHERE child_id = 'santiago'"))[0].n);

// --------------------------------------------------------------------------------------------------------------------------
// Browser
// --------------------------------------------------------------------------------------------------------------------------
const browser = await chromium.launch(audioSafeChromiumLaunchOptions({ headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] }));
const blocked = [];
const speechRequests = [];
const pageErrors = [];
const noktCalls = [];
const probeScript = `(() => {
  const s = globalThis.speechSynthesis;
  if (s) {
    const speak = (u) => { globalThis.__speech = (globalThis.__speech || []); globalThis.__speech.push({ text: u.text, lang: u.lang, at: Date.now() }); setTimeout(() => { u.onend && u.onend(); }, 30); };
    try { Object.defineProperty(s, "speak", { configurable: false, writable: false, value: speak }); } catch {}
    try { Object.defineProperty(s, "cancel", { configurable: false, writable: false, value: () => {} }); } catch {}
  }
  const md = globalThis.navigator && navigator.mediaDevices;
  if (md && md.getUserMedia) {
    const orig = md.getUserMedia.bind(md);
    md.getUserMedia = (c) => { globalThis.__gum = (globalThis.__gum || 0) + 1; return orig(c); };
  }
})();`;
async function makeCtx(options, cookie = assistant) {
  const c = await browser.newContext(options);
  await c.addInitScript(probeScript);
  await installBrowserAudioGuard(c);
  await c.route("**/*", async (r) => {
    const u = new URL(r.request().url());
    if (u.origin !== BASE) {
      blocked.push(u.origin);
      return r.abort("blockedbyclient");
    }
    if (/\/api\/family\/assistant\/tts/.test(u.pathname)) {
      let body = null;
      try {
        body = JSON.parse(r.request().postData() || "null");
      } catch {}
      speechRequests.push({ at: Date.now(), body });
      return r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "No voice for this language" }) });
    }
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
async function shot(page, name, fullPage = true) {
  shotN += 1;
  const file = path.join(OUT, `${String(shotN).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage });
  return file;
}
const text = async (page, sel = "body") => (await page.locator(sel).first().innerText()).replace(/\s+/g, " ");
const gumCount = async (page) => page.evaluate(() => globalThis.__gum || 0);
const browserSpoken = async (page) => page.evaluate(() => (globalThis.__speech || []).map((s) => s.text));
async function isabelRun() {
  return (await row("isabel"))?.state.missions?.["MISSION-OLD-LILA-WORKSHOP"] ?? null;
}
async function onStep(page, step) {
  await page.waitForSelector(`[data-testid='workshop-scene'][data-step='${step}']`, { timeout: 20000 });
}
async function nextBeat(page) {
  await page.locator("[data-testid='workshop-next']").first().click();
}
const saved = (page) => page.waitForResponse((r) => r.url().includes("/api/family/learning/mission") && r.request().method() === "PUT", { timeout: 15000 });
async function answerNumber(page, value) {
  await page.locator("[data-testid='part-input']").fill(String(value));
  const done = saved(page);
  await page.locator("[data-testid='part-check']").click();
  await done;
  await settle(400);
}

const rec = { mode: MODE, base: BASE, startedAt: new Date().toISOString() };
const page = await (await makeCtx({ viewport: { width: 1180, height: 820 } })).newPage();
page.on("pageerror", (e) => pageErrors.push(String(e)));
const isabelBearer = await mintChild("isabel");

if (MODE === "rollout-isabel-only") {
  // The child-specific rollout option: this build with FAMILY_LEARNING_CONTENT_CAP=6 (Santiago exactly at Visit 7, Nokt's
  // new conversations absent) and Isabel's workshop ON.
  await page.goto(`${BASE}/family/home?child=santiago`);
  await page.waitForSelector("text=Lernen", { timeout: 30000 });
  await settle(800);
  check("R1.santiago-home-has-no-new-nokt-conversation", (await page.locator("[data-testid='home-nokt-open']").count()) === 0 && (await text(page)).includes("Chat temporarily unavailable"));
  const sv = await api("GET", `/api/family/learning/mission?tz=${TZ}`, null, assistant, santiagoBearer);
  const sev = await api("GET", "/api/family/learning/parent/evidence?child=santiago", null, owner);
  check("R1.santiago-served-content-v6-no-visit-8", sev.json?.contentCounts?.version === 6, sev.json?.contentCounts);
  check("R1.santiago-no-talk-block", !sv.json?.view?.nokt?.talk);
  const home = await api("POST", "/api/family/learning/nokt/turn/dispatch", { purpose: "home", sessionId: "rollout-sess-1", turnId: "rollout-turn-0001", expectedRevision: sv.json.view.revision, context: { erasureGeneration: 0, visit: sv.json.view.visit ? { id: sv.json.view.visit.id, startedAt: sv.json.view.visit.startedAt } : null } }, assistant, santiagoBearer);
  check("R1.santiago-home-dispatch-refused-under-the-cap", home.status === 422 || home.status === 409, home.status);
  await page.goto(`${BASE}/family/learn?child=isabel`);
  await page.waitForSelector("[data-testid='world-screen'][data-child='isabel']", { timeout: 30000 });
  await page.locator("[data-testid='cockpit-start']").click();
  await page.locator("[data-testid='start-visit']").click();
  await page.waitForSelector("[data-testid='workshop-scene'][data-step='W1-HELLO']", { timeout: 20000 });
  check("R1.isabel-workshop-on", (await row("isabel")).missionId === "isabel-workshop");
} else if (MODE === "isabel-off") {
  const v = await api("GET", `/api/family/learning/mission?tz=${TZ}`, null, assistant, isabelBearer);
  check("I1off.api-not-prepared", v.status === 200 && v.json?.prepared === false && v.json?.view === null, v.json);
  await page.goto(`${BASE}/family/learn?child=isabel`);
  await page.waitForSelector("text=Deine Expedition ist noch nicht vorbereitet", { timeout: 30000 });
  check("I1off.hub-honest-not-prepared", true);
  const put = await api("PUT", "/api/family/learning/mission", { op: { op: "start-visit" }, expectedRevision: 0, idempotencyKey: "isabel-off-1", context: { erasureGeneration: 0, visit: null } }, assistant, isabelBearer);
  check("I1off.mutations-refused", put.status === 404, put.status);
  const sv = await api("GET", `/api/family/learning/mission?tz=${TZ}`, null, assistant, santiagoBearer);
  check("I1off.santiago-unaffected", sv.json?.prepared === true && sv.json?.view?.child === "santiago");
  const ev = await api("GET", "/api/family/learning/parent/evidence?child=isabel", null, owner);
  check("I1off.parent-evidence-readable-own-id", ev.status === 200 && ev.json?.prepared === false, { status: ev.status, prepared: ev.json?.prepared });
} else {
  // ---------------------------------------------------------------- I1-01 Entry: Family Home → Lernen → Old Lila's workshop
  await page.goto(`${BASE}/family/home?child=isabel`);
  await page.waitForSelector("text=Lernen", { timeout: 30000 });
  check("I1-01.home-learning-entry-no-nokt", (await page.locator("[data-testid='home-nokt-open']").count()) === 0 && (await page.locator("a[href*='/family/learn']").count()) >= 1);
  await page.locator("a[href*='/family/learn?child=isabel'], a[href*='/family/learn'][href*='isabel']").first().click();
  await page.waitForSelector("[data-testid='world-screen'][data-child='isabel']", { timeout: 30000 });
  const hub = await text(page);
  check("I1-01.hub-is-old-lilas-workshop", hub.includes("Old Lilas kleine Werkstatt") && hub.includes("Old Lila") && !/Basis|Expedition|Insel|Nokt|Santiago/.test(hub), hub.slice(0, 200));
  await shot(page, "isabel-hub");
  await page.locator("[data-testid='cockpit-start']").click();
  await page.waitForSelector("[data-testid='start-screen'][data-child='isabel']", { timeout: 30000 });
  check("I1-01.start-screen-own", !(await page.locator("[data-testid='hud-wordbook']").count()) && (await text(page)).includes("Old Lila"));
  await page.locator("[data-testid='start-visit']").click();
  await onStep(page, "W1-HELLO");
  check("I1-01.visit-started-own-content", (await row("isabel")).missionId === "isabel-workshop" && (await row("isabel")).contentVersion === 1 && (await row("isabel")).state.visits[0]?.id === "v1");
  check("I1-02.no-nokt-control-in-the-workshop", (await page.locator("[data-testid='nokt-button'], [data-testid='nokt-debrief'], [data-testid='hud-wordbook']").count()) === 0);

  // ---------------------------------------------------------------- I1-02 Story: short spoken instructions, a meaningful choice
  const lines = await page.locator("[data-testid='workshop-line']").count();
  check("I1-02.one-or-two-short-lines", lines >= 1 && lines <= 2, lines);
  await page.locator("[data-testid='workshop-line-audio']").first().click();
  await page.waitForFunction(() => (globalThis.__speech || []).length >= 1, null, { timeout: 10000 });
  await settle(400);
  check("I1-02.instruction-heard-on-tap-german-as-character", speechRequests.some((r) => r.body?.childId === "isabel" && r.body?.language === "de" && r.body?.speaker === "character") && (await browserSpoken(page)).some((t) => t.includes("Old Lila")), speechRequests.slice(-1));
  await shot(page, "isabel-hello", false);
  await nextBeat(page);
  await onStep(page, "W2-MAKE");
  check("I1-02.choice-is-pictured", (await page.locator("[data-testid^='make-'] svg[data-picture]").count()) === 4);
  await page.locator("[data-testid='make-chair']").click();
  await page.waitForSelector("[data-testid='workshop-decide'][data-chosen='chair']");
  check("I1-02.choice-recorded-not-scored", (await isabelRun()).steps["W2-MAKE"].attempts[0].raw !== undefined && (await isabelRun()).steps["W2-MAKE"].status === "done");
  await nextBeat(page);

  // ---------------------------------------------------------------- I1-03 Materials: wood chair, glass window, brick wall
  await onStep(page, "W3-MATERIALS");
  check("I1-03.pictured-objects-and-materials", (await page.locator("[data-testid='question-chair'] svg[data-picture='chair-wood']").count()) === 1 && (await page.locator("[data-testid^='pick-chair-'] svg[data-picture^='material-']").count()) === 3);
  await page.locator("[data-testid='pick-chair-Glas']").click();
  await page.waitForSelector("[data-testid='workshop-match'] [data-tone='retry']");
  check("I1-03.wrong-first-try-neutral-retry", (await text(page, "[data-testid='workshop-match']")).includes("braun") && !/super|toll|perfekt|bravo/i.test(await text(page, "[data-testid='workshop-task']")));
  await page.locator("[data-testid='pick-chair-Holz']").click();
  await page.waitForSelector("[data-testid='question-window']");
  await page.locator("[data-testid='pick-window-Glas']").click();
  await page.waitForSelector("[data-testid='question-wall']");
  await page.locator("[data-testid='pick-wall-Ziegel']").click();
  await page.waitForSelector("[data-testid='workshop-scene'][data-step='W3-MATERIALS'][data-status='done']");
  const doneLines = await text(page, "[data-testid='workshop-bubble']");
  check("I1-03.real-houses-combine-materials-and-wood", doneLines.includes("viele Materialien") && doneLines.includes("ganz aus Holz") && !/(euer|dein|unser) Haus (ist|besteht)/i.test(doneLines), doneLines);
  const mat = (await isabelRun()).steps["W3-MATERIALS"];
  check("I1-03.first-attempt-preserved-supported", mat.outcome === "supported" && mat.attempts[0].raw === "Glas" && mat.attempts[0].correct === false, mat.attempts.map((a) => [a.questionId, a.raw, a.evidence]));
  await nextBeat(page);

  // ---------------------------------------------------------------- I1-04 Readiness/math: visible quantities, bundles, fresh check
  await onStep(page, "W4-COUNT");
  check("I1-04.small-sum-visible-counters", (await page.locator("[data-testid='counters'][data-a='5'][data-b='2'][data-op='+']").count()) === 1);
  await answerNumber(page, 7);
  await page.locator("[data-testid='solve-next-question']").click();
  check("I1-04.subtraction-visible-crossed-out", (await page.locator("[data-testid='counters'][data-a='8'][data-b='2'][data-op='-']").count()) === 1 && (await page.locator("[data-testid='counters'] [data-part='gone']").count()) === 2);
  await answerNumber(page, 6);
  await page.waitForSelector("[data-testid='workshop-scene'][data-step='W4-COUNT'][data-status='done']");
  await nextBeat(page);
  await onStep(page, "W5-TENS");
  check("I1-04.tens-two-bundles-one-loose", (await page.locator("[data-testid='counters'][data-bundles='true'] [data-part='bundle']").count()) === 2 && (await page.locator("[data-testid='counters'] [data-part='added']").count()) === 1);
  check("I1-04.bundling-explained-only-after-difficulty", (await page.locator("[data-testid='hint-open']").count()) === 0 && (await page.locator("[data-testid='hint-later']").count()) === 1);
  await answerNumber(page, 12);
  // Stop and resume in the middle: her wrong answer stays, she continues the same question.
  await page.locator("[data-testid='hud-stop']").click();
  await page.waitForSelector("[data-testid='world-screen'][data-child='isabel']", { timeout: 20000 });
  check("I1-01.stop-saves-and-shows-continue", (await text(page, "[data-testid='cockpit-start']")).includes("Weiter"));
  await page.locator("[data-testid='cockpit-start']").click();
  await onStep(page, "W5-TENS");
  check("I1-01.resume-same-question-own-state", (await isabelRun()).steps["W5-TENS"].attempts.length === 1 && (await page.locator("[data-testid='hint-open']").count()) === 1);
  await page.locator("[data-testid='hint-open']").click();
  await page.waitForSelector("[data-testid='hint']");
  check("I1-04.bundling-hint-after-the-miss", (await text(page, "[data-testid='hint']")).includes("10"));
  await page.locator("[data-testid='hint-check-input']").fill("20");
  await page.locator("[data-testid='hint-check-send']").click();
  await page.waitForSelector("[data-testid='hint-feedback']");
  await answerNumber(page, 21);
  await page.waitForSelector("[data-testid='workshop-scene'][data-step='W5-TENS'][data-status='done']");
  const tens = (await isabelRun()).steps["W5-TENS"];
  check("I1-04.first-attempt-and-help-preserved", tens.outcome === "supported" && tens.attempts[0].raw === "12" && tens.parts.total.hints.length === 1, { outcome: tens.outcome, raw: tens.attempts.map((a) => a.raw) });
  await nextBeat(page);
  await onStep(page, "W6-TENS-AGAIN");
  check("I1-04.fresh-check-20-plus-3-different", (await page.locator("[data-testid='counters'][data-a='20'][data-b='3']").count()) === 1 && (await text(page, "[data-testid='workshop-task']")).includes("Neue Stäbe"));
  await answerNumber(page, 23);
  await page.waitForSelector("[data-testid='workshop-scene'][data-step='W6-TENS-AGAIN'][data-status='done']");
  await nextBeat(page);
  await onStep(page, "W8-READ");
  check("I1-04.easier-path-not-needed-after-a-first-try-fresh-check", (await isabelRun()).steps["W7-EASIER"] === undefined);

  // ---------------------------------------------------------------- I1-05 Early literacy: AST, no target audio before the attempt
  check("I1-05.word-shown-pictures-offered", (await text(page, "[data-testid='read-word']")).trim() === "AST" && (await page.locator("[data-testid^='pick-word-'] svg[data-picture]").count()) === 3);
  const spokenBeforeRead = [...speechRequests.map((r) => String(r.body?.text ?? "")), ...(await browserSpoken(page))];
  check("I1-05.target-not-spoken-before-the-attempt", !spokenBeforeRead.some((t) => /\bast\b/i.test(t)), spokenBeforeRead.filter((t) => /ast/i.test(t)));
  await page.locator("[data-testid='pick-word-Ball']").click();
  await page.waitForSelector("[data-testid='workshop-read'] [data-tone='retry']");
  await page.locator("[data-testid='read-letters-open']").click();
  await page.waitForSelector("[data-testid='read-letters']");
  check("I1-05.letter-help-recorded-before-shown", (await isabelRun()).steps["W8-READ"].support.some((s) => s.kind === "letters"));
  await page.locator("[data-testid='read-letters-audio']").click();
  await page.waitForFunction(() => (globalThis.__speech || []).some((s) => /Ast/.test(s.text)), null, { timeout: 10000 });
  check("I1-05.word-spoken-only-after-the-switch", (await browserSpoken(page)).some((t) => t === "A. S. T. Ast."));
  await shot(page, "isabel-read-letters", false);
  await page.locator("[data-testid='pick-word-Ast']").click();
  await page.waitForSelector("[data-testid='workshop-scene'][data-step='W8-READ'][data-status='done']");
  check("I1-05.never-independent-reading", (await isabelRun()).steps["W8-READ"].outcome === "supported" && !(await text(page, "[data-testid='workshop-task']")).includes("selbst gelesen"));
  await nextBeat(page);

  // ---------------------------------------------------------------- I1-06 Listening: «Zeig mir das Fenster», separate record
  await onStep(page, "W9-LISTEN");
  check("I1-06.text-hidden-answers-locked-until-heard", (await page.locator("[data-testid='listen-adult-read']").count()) === 0 && (await page.locator("[data-testid='pick-show-Fenster']").isDisabled()));
  await page.locator("[data-testid='listen-play']").click();
  await page.waitForFunction(() => !document.querySelector("[data-testid='pick-show-Fenster']")?.disabled, null, { timeout: 15000 });
  check("I1-06.instruction-spoken-in-german", (await browserSpoken(page)).includes("Zeig mir das Fenster.") && speechRequests.some((r) => r.body?.text === "Zeig mir das Fenster." && r.body?.language === "de"));
  check("I1-06.adult-read-aloud-fallback-labelled-as-help", (await text(page, "[data-testid='listen-adult-open']")).includes("zählt als Hilfe"));
  await page.locator("[data-testid='pick-show-Fenster']").click();
  await page.waitForSelector("[data-testid='workshop-scene'][data-step='W9-LISTEN'][data-status='done']");
  const lis = (await isabelRun()).steps["W9-LISTEN"];
  check("I1-06.listening-recorded-apart-from-reading", lis.outcome === "independent" && lis.completedPlays === 1 && (await isabelRun()).steps["W8-READ"].outcome === "supported");
  await nextBeat(page);

  // ---------------------------------------------------------------- I1-07 Real-world choice: craft, explanation, three wooden things
  await onStep(page, "W10-CRAFT");
  await page.locator("[data-testid='craft-task-audio-find']").click();
  await page.waitForFunction(() => (globalThis.__speech || []).some((s) => s.text === "Such zu Hause drei Dinge aus Holz."), null, { timeout: 10000 });
  check("I1-07.craft-tasks-can-be-heard", true);
  check("I1-07.build-what-she-chose", (await page.locator("[data-testid='craft-task-build'] svg[data-picture='chair-wood']").count()) === 1 && (await text(page, "[data-testid='craft-task-explain']")).includes("Papa"));
  for (const id of ["table", "spoon", "door", "frame"]) await page.locator(`[data-testid='found-${id}']`).click();
  check("I1-07.three-wooden-things-at-most", (await page.locator("[data-testid^='found-'][aria-pressed='true']").count()) === 3);
  await page.locator("[data-testid='found-save']").click();
  await page.waitForFunction(() => document.querySelector("[data-testid='found-save']")?.textContent?.includes("Gespeichert"), null, { timeout: 10000 });
  const craftText = await text(page, "[data-testid='workshop-craft']");
  check("I1-07.no-trees-per-house-number", !/\d+\s*Bäume/.test(craftText) && craftText.includes("Holz kommt von Bäumen"), craftText.slice(0, 200));
  check("I1-07.her-own-report-saved-unverified", JSON.stringify((await isabelRun()).steps["W10-CRAFT"].found) === JSON.stringify(["table", "spoon", "door"]));
  await shot(page, "isabel-craft");
  await nextBeat(page);

  // ---------------------------------------------------------------- I1-08 Ending: her room, factual recap, pictured next interest
  await onStep(page, "W11-ROOM");
  check("I1-08.her-chosen-room-shown", (await page.locator("[data-testid='workshop-room'][data-made='chair-wood']").count()) === 1);
  const recap = await text(page, "[data-testid='workshop-recap']");
  check("I1-08.recap-one-short-factual-sentence-help-named", recap === "Du hast einen Stuhl gewählt, Materialien zugeordnet, Klötze und Stäbe gezählt, das Wort AST mit Buchstabenhilfe angeschaut und beim Zuhören das richtige Bild gefunden.", recap);
  check("I1-08.room-caption-from-her-choice", (await text(page, "[data-testid='workshop-room']")).includes("Im Zimmer: ein Stuhl"));
  const ending = await text(page, "[data-testid='workshop-ending']");
  check("I1-08.no-false-praise-success-is-a-real-first-try", !ending.includes("alle Materialien beim ersten Versuch") && ending.includes("Klötze zählen: beim ersten Versuch richtig") && !/super|toll|perfekt|bravo|meisterin/i.test(ending), ending);
  check("I1-08.next-step-from-what-is-open", ending.includes("Nächstes Mal schauen wir wieder Buchstaben an.") && !ending.includes("Bündeln"), ending);
  await page.locator("[data-testid='workshop-recap-audio']").click();
  await page.waitForFunction(() => (globalThis.__speech || []).some((s) => s.text.startsWith("Du hast einen Stuhl")), null, { timeout: 10000 });
  check("I1-08.recap-can-be-heard", true);
  await shot(page, "isabel-room");
  await nextBeat(page); // Fertig
  await page.waitForSelector("[data-testid='workshop-next']");
  await nextBeat(page); // Zum Abschluss → finish
  await page.waitForSelector("[data-testid='debrief']", { timeout: 20000 });
  check("I1-08.closing-no-nokt-own-room-and-recap", (await page.locator("[data-testid='nokt-debrief'], [data-testid='debrief-no-nokt'], [data-testid='debrief-start']").count()) === 0 && (await page.locator("[data-testid='debrief-result'] [data-testid='workshop-room']").count()) === 1 && (await page.locator("[data-testid='debrief-recap']").count()) === 1);
  check("I1-08.pictured-next-interest", (await page.locator("[data-testid^='adventure-'] svg[data-picture^='next-']").count()) === 3);
  check("I1-08.no-mastery-on-completion", !/gemeistert|kannst du jetzt|Meister/i.test(await text(page, "[data-testid='debrief']")));
  await shot(page, "isabel-closing", false);
  await page.locator("[data-testid='difficulty-right']").click();
  await page.locator("[data-testid='adventure-furniture']").click();
  await page.locator("[data-testid='debrief-finish']").click();
  await page.waitForURL(/\/family\/home\?child=isabel/, { timeout: 20000 });
  const done = await row("isabel");
  check("I1-08.visit-finished-once-interest-saved", done.state.visits.filter((v) => v.finishedAt).length === 1 && JSON.stringify((done.state.interests ?? []).map((i) => [i.visit, i.kind, i.choice])) === JSON.stringify([["v1", "choice", "furniture"]]));
  const completions = await query("SELECT COUNT(*) AS n FROM family_learning_completions WHERE child_id = 'isabel'").catch(() => [{ n: -1 }]);
  check("I1-08.one-completion-row", Number(completions[0].n) === 1, completions[0]);
  await page.goto(`${BASE}/family/learn?child=isabel`);
  await page.waitForSelector("[data-testid='world-screen'][data-child='isabel']");
  check("I1-08.hub-after-shows-done-and-her-wish-not-a-new-visit", (await page.locator("[data-testid='cockpit-start']").count()) === 0 && (await text(page)).includes("Ein Besuch fertig"));

  // ---------------------------------------------------------------- Evidence for the parent (I1-07/I1-08)
  const pctx = await makeCtx({ viewport: { width: 1280, height: 900 } }, owner);
  const pp = await pctx.newPage();
  pp.on("pageerror", (e) => pageErrors.push(String(e)));
  await pp.goto(`${BASE}/family/learn/parent?child=isabel`);
  await pp.waitForSelector("[role='tab']", { timeout: 30000 });
  await pp.locator("[role='tab']", { hasText: "Isabel" }).click();
  await pp.waitForSelector("[data-testid='parent-mission-evidence'][data-mission='MISSION-OLD-LILA-WORKSHOP']", { timeout: 30000 });
  const ev = await text(pp, "[data-testid='parent-mission-evidence']");
  const w3 = await text(pp, "[data-testid='evidence-W3-MATERIALS']");
  const w5 = await text(pp, "[data-testid='evidence-W5-TENS']");
  check("I1-08.parent-exact-answers-in-order", w3.includes("chair: «Glas» falsch") && w3.includes("chair: «Holz» richtig") && /«12» ✗ .*«21» ✓/.test(w5), { w3: w3.slice(0, 220), w5: w5.slice(0, 260) });
  check("I1-08.parent-support-and-uncertainty-apart", (await text(pp, "[data-testid='evidence-W5-TENS']")).includes("unterstützte Anschauung") && (await text(pp, "[data-testid='evidence-W8-READ']")).includes("kein selbständiges Lesen") && (await text(pp, "[data-testid='evidence-W8-READ']")).includes("Buchstabenhilfe") && (await text(pp, "[data-testid='evidence-W9-LISTEN']")).includes("getrennt von Lesen"));
  check("I1-08.parent-sees-her-own-report-as-unverified", (await text(pp, "[data-testid='evidence-W10-CRAFT']")).includes("Selbst gemeldet (nicht überprüft): gefunden Tisch, Kochlöffel, Tür"));
  check("I1-08.parent-planning-is-isabels", (await text(pp, "[data-testid='parent-planning']")).includes("Isabels Wünsche") && !(await text(pp, "[data-testid='parent-planning']")).includes("Santiagos"));
  check("I1-08.parent-sees-no-santiago-work", !/GREENHOUSE|Gewächshaus|Rosa|Nokt hat/.test(ev));
  await pp.locator("[data-testid='observation-note-build']").fill("Stuhl aus Karton, mit etwas Hilfe beim Kleben");
  await pp.locator("[data-testid='observation-build-with-help']").click();
  await pp.waitForSelector("[data-testid='observation-build'][data-latest='with-help']", { timeout: 15000 });
  await pp.locator("[data-testid='observation-find-done']").click();
  await pp.waitForSelector("[data-testid='observation-find'][data-latest='done']", { timeout: 15000 });
  const obs = await query("SELECT kind, payload_json, mission_id FROM family_learning_support_events WHERE child_id = 'isabel' AND kind = 'parent_observation' ORDER BY created_at");
  check("I1-07.parent-records-done-not-tried-help-not-an-ai-assessment", obs.length === 2 && obs.every((o) => String(o.mission_id) === "isabel-workshop") && JSON.parse(String(obs[0].payload_json)).status === "with-help" && JSON.parse(String(obs[0].payload_json)).recordedBy === "parent" && (await text(pp, "[data-testid='parent-observations']")).includes("keine Bewertung der App oder einer KI"), obs.map((o) => JSON.parse(String(o.payload_json))));
  const attemptsAfterObs = await query("SELECT COUNT(*) AS n FROM family_learning_attempts WHERE child_id = 'isabel' AND task_id LIKE '%W10-CRAFT%'");
  check("I1-07.parent-observation-is-never-a-child-attempt", Number(attemptsAfterObs[0].n) === 0);
  await shot(pp, "isabel-parent");
  const bad = await api("POST", "/api/family/learning/parent/observation", { child: "isabel", visit: "v1", step: "W5-TENS", task: "build", status: "done" }, owner);
  const anon = await api("POST", "/api/family/learning/parent/observation", { child: "isabel", visit: "v1", step: "W10-CRAFT", task: "build", status: "done" }, assistant);
  check("I1-07.observation-only-real-world-tasks-only-the-owner", bad.status === 400 && (anon.status === 401 || anon.status === 403), { bad: bad.status, anon: anon.status });

  // ---------------------------------------------------------------- Child isolation (both directions)
  const iv = await api("GET", `/api/family/learning/mission?tz=${TZ}`, null, assistant, isabelBearer);
  const sv = await api("GET", `/api/family/learning/mission?tz=${TZ}`, null, assistant, santiagoBearer);
  check("I1-09.each-credential-gets-its-own-content", iv.json?.view?.child === "isabel" && iv.json.view.mission === null && sv.json?.view?.child === "santiago" && sv.json.view.visit?.id === "v1" && !JSON.stringify(sv.json.view).includes("Old Lila"), { isabel: iv.json?.view?.child, santiago: sv.json?.view?.child });
  check("I1-09.isabel-view-never-offers-nokt", iv.json?.view?.nokt?.mode === "unavailable" && !iv.json?.view?.nokt?.talk);
  const cross = await api("PUT", "/api/family/learning/mission", { op: { op: "mission", action: { a: "open", step: "H1-PLAN" } }, expectedRevision: iv.json.view.revision, idempotencyKey: "isabel-cross-1", context: { erasureGeneration: iv.json.view.erasureGeneration ?? 0, visit: null } }, assistant, isabelBearer);
  check("I1-09.santiago-steps-unreachable-with-isabels-credential", cross.status === 422 || cross.status === 409, cross.status);
  const nokt = await api("POST", "/api/family/learning/nokt/turn/dispatch", { purpose: "home", sessionId: "isabel-sess-1", turnId: "isabel-turn-0001", expectedRevision: iv.json.view.revision, context: { erasureGeneration: 0, visit: null } }, assistant, isabelBearer);
  check("I1-09.no-old-lila-model-activation-nokt-refuses-isabel", nokt.status === 404 || nokt.status === 503, nokt.status);
  const santiagoAfter = await row("santiago");
  const santiagoRowsAfter = Number((await query("SELECT COUNT(*) AS n FROM family_learning_attempts WHERE child_id = 'santiago'"))[0].n);
  check("I1-09.santiago-record-byte-identical", santiagoAfter.hash === santiagoBefore.hash && santiagoAfter.missionId === "santiago-expedition" && santiagoRowsAfter === santiagoRowsBefore, { before: santiagoBefore.hash.slice(0, 12), after: santiagoAfter.hash.slice(0, 12) });
  const wrongId = await query("SELECT COUNT(*) AS n FROM family_learning_attempts WHERE child_id = 'isabel' AND mission_id != 'isabel-workshop'");
  check("I1-09.isabel-records-under-her-own-content-id", Number(wrongId[0].n) === 0 && Number((await query("SELECT COUNT(*) AS n FROM family_learning_attempts WHERE child_id = 'isabel'"))[0].n) > 0);
  await page.goto(`${BASE}/family/learn?child=santiago`);
  await page.waitForSelector("[data-testid='world-screen']", { timeout: 30000 });
  check("I1-09.santiago-hub-unchanged", (await page.locator("[data-testid='world-screen'][data-child='isabel']").count()) === 0 && (await page.locator("[data-testid='hud-wordbook']").count()) === 1 && !(await text(page)).includes("Old Lila"));
  check("I1-06.no-microphone-ever", (await gumCount(page)) === 0);
}

check("I1.common.no-external-requests", blocked.length === 0, blocked.slice(0, 5));
check("I1.common.no-page-errors", pageErrors.length === 0, pageErrors.slice(0, 3));
check("I1.common.no-nokt-call-for-isabel-from-the-browser", noktCalls.length === 0, noktCalls);
rec.speechRequests = speechRequests.length;
rec.results = results;
rec.passed = results.filter((r) => r.ok).length;
rec.failed = results.filter((r) => !r.ok).length;
fs.writeFileSync(path.join(OUT, `results-${MODE}.json`), JSON.stringify(rec, null, 2));
console.log(`SUMMARY ${MODE}: ${rec.passed} passed, ${rec.failed} failed`);
await browser.close();
process.exit(rec.failed ? 1 : 0);
