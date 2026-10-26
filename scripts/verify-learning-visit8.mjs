// Visit 8 (content v7) + continuous Nokt — rendered journeys on an ISOLATED local production server with a SYNTHETIC database.
// Never production: --base must be a loopback origin, --db a local file. Audio is muted (browser audio guard + speech mock;
// the speech route is answered by the harness and never reaches a provider). Every non-local request is aborted and counted —
// except the Nokt bridge, an https://<name>.invalid origin (RFC 2606, can never resolve) answered INSIDE the browser context
// by this script with SCRIPTED fictional replies signed with the synthetic per-run secret (the runtime's fcr1 construction).
// No model, no provider, no credential, no child record.
//
// Modes (one per server instance; the caller starts the server with the matching env):
//   --mode nokt          FAMILY_NOKT_CONVERSATION=subscription, intercepted bridge, FAMILY_NOKT_STT_FAKE=1 (fake recognizer)
//                        J8: Home → Nokt on Home → Lernen → start → one-time welcome → walking map → tasks → task talk →
//                        visit talk → writing reaction → debrief → Home; reload/resume, child switch, stale/forged reply,
//                        failures (unreachable, used-up day, old runtime refusing an opener), push-to-talk, transcript
//                        persistence, parent evidence.
//   --mode off           no Nokt env: the same mission is complete without Nokt; honest unavailable surfaces; fallback debrief.
//
// Usage: AUTH_SECRET=… BRIDGE_SECRET=… node scripts/verify-learning-visit8.mjs --base http://127.0.0.1:3291 --db <dir>/nabu.db --out <dir> --mode nokt --bridge https://nokt-bridge.invalid:8787
import fs from "node:fs";
import path from "node:path";
import { createHash, createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { encode } from "@auth/core/jwt";
import { chromium } from "/Users/claweberle/.npm-global/lib/node_modules/playwright/index.mjs";
import { audioSafeChromiumLaunchOptions, installBrowserAudioGuard } from "./lib/browser-audio-guard.mjs";
import { asLearningContent } from "../src/lib/family-learning-content.ts";
import { newMissionState } from "../src/lib/family-learning-state.ts";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const require = createRequire(import.meta.url);
const { createClient } = require("@libsql/client");
const BASE = opt("--base", "http://127.0.0.1:3291").replace(/\/$/, "");
const OUT = opt("--out", "/tmp/family-learning-visit8");
const DB = opt("--db", null);
const MODE = opt("--mode", "nokt");
const BRIDGE = (opt("--bridge", "") || "").replace(/\/$/, "");
const SECRET = process.env.AUTH_SECRET;
const BRIDGE_SECRET = process.env.BRIDGE_SECRET ?? "";
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE)) throw new Error("--base must be a loopback origin (never production)");
if (MODE.startsWith("nokt") && (!/^https:\/\/[a-z0-9-]+\.invalid(:\d+)?$/.test(BRIDGE) || BRIDGE_SECRET.length < 32)) throw new Error("--bridge must be an https://<name>.invalid origin and BRIDGE_SECRET synthetic (≥ 32 chars)");
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
const TZ = "Europe/Zurich";
async function rawRow() {
  const c = createClient({ url: "file:" + DB });
  try {
    const row = (await c.execute("SELECT state_json, revision FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0];
    return { state: JSON.parse(String(row.state_json)), revision: Number(row.revision) };
  } finally {
    c.close();
  }
}
async function countRows(table) {
  const c = createClient({ url: "file:" + DB });
  try {
    return Number((await c.execute({ sql: `SELECT COUNT(*) AS n FROM ${table} WHERE child_id = 'santiago'`, args: [] })).rows[0].n);
  } finally {
    c.close();
  }
}

// --------------------------------------------------------------------------------------------------------------------------
// Fixture: SYNTHETIC "seven visits finished" (shape only; invented values), written as the child's state row.
// --------------------------------------------------------------------------------------------------------------------------
const content = asLearningContent(JSON.parse(fs.readFileSync(new URL("../src/data/family-learning/content/santiago-expedition-v7.json", import.meta.url), "utf8")));
async function seedSevenVisitsDone() {
  await api("DELETE", "/api/family/learning/parent/records?child=santiago&confirm=santiago", null, owner);
  const bearer = await mintChild("santiago");
  await api("GET", `/api/family/learning/mission?tz=${TZ}`, null, assistant, bearer); // creates the row
  const current = await api("GET", "/api/family/learning/parent/settings?child=santiago", null, owner);
  await api("PUT", "/api/family/learning/parent/settings", { child: "santiago", expectedErasureGeneration: current.json.erasureGeneration, keyboardLayout: "ch-de-qwertz" }, owner);
  const s = newMissionState(content, "santiago", "2026-09-29T10:00:00.000Z");
  const day = (d, h) => new Date(Date.UTC(2026, 8, 29 + d, h, 0, 0)).toISOString();
  s.visits = ["v1", "v2", "v4", "v5", "v6", "v7", "v8"].map((id, i) => ({ id, startedAt: day(i * 3, 10), finishedAt: day(i * 3, 11), stageIndex: 99, skippedStages: [], reflection: "easy" }));
  s.base = { name: "Fixture Basis", locationId: "shore", supplies: {} };
  s.typing.alignment = { layout: "ch-de-qwertz", checkedAt: day(6, 10), result: "match", observed: [], matchesLayout: "ch-de-qwertz" };
  const burst = (seconds) => ({ lessonId: "TYPE-CH-COURSE-5", visit: "v8", lineCount: 3, lines: [], expectedChars: 21, typedChars: 21, correctChars: 21, extraChars: 0, omittedChars: 0, substitutedChars: 0, denominator: 21, accuracy: 1, comfort: "easy", metricVersion: 2, seconds, at: day(18, 10) });
  s.typing.course = { layout: "ch-de-qwertz", lessonIndex: 4, bursts: [burst(25), burst(24)], decision: null, completed: ["TYPE-CH-COURSE-1", "TYPE-CH-COURSE-2", "TYPE-CH-COURSE-3", "TYPE-CH-COURSE-4"] };
  s.interests = [{ id: "fx-interest", visit: "v8", source: "closing", kind: "choice", text: "Das Gewächshaus vergrössern", choice: "greenhouse", at: day(18, 11) }];
  const c = createClient({ url: "file:" + DB });
  try {
    // The row exists after the first child read in some builds and only after the first write in others: upsert it.
    const row = (await c.execute("SELECT revision FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0];
    const revision = row ? Number(row.revision) + 1 : 1;
    s.revision = revision;
    const now = new Date().toISOString();
    if (row) await c.execute({ sql: "UPDATE family_learning_missions SET state_json = ?, revision = ?, content_version = 7, updated_at = ? WHERE child_id = 'santiago'", args: [JSON.stringify(s), revision, now] });
    else await c.execute({ sql: "INSERT INTO family_learning_missions (child_id, mission_id, content_version, revision, state_json, created_at, updated_at) VALUES ('santiago', ?, 7, ?, ?, ?, ?)", args: [content.contentId, revision, JSON.stringify(s), now, now] });
  } finally {
    c.close();
  }
}

// --------------------------------------------------------------------------------------------------------------------------
// The intercepted bridge (in-browser): scripted fictional replies, fcr1-signed with the synthetic secret.
// --------------------------------------------------------------------------------------------------------------------------
const sha = (x) => createHash("sha256").update(x).digest("hex");
const b64u = (x) => Buffer.from(x).toString("base64url");
let bridgeN = 0;
function signReceipt({ child, turnId, request, reply, secret = BRIDGE_SECRET }) {
  const claims = { v: 2, iss: "family-child-bridge", sub: child, sid: "learn", key: turnId, req: sha(JSON.stringify(request)), res: sha(reply), iat: Math.floor(Date.now() / 1000), mdl: "openai/harness-fictional", run: `harness-run-${bridgeN}` };
  const payload = b64u(JSON.stringify(claims));
  return `fcr1.${payload}.${createHmac("sha256", secret).update(`fcr1.${payload}`).digest("base64url")}`;
}
function tokenChild(header) {
  const m = /^Bearer\s+fcm1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(header ?? "");
  if (!m) return null;
  const expected = createHmac("sha256", BRIDGE_SECRET).update(`fcm1.${m[1]}`).digest("base64url");
  if (expected !== m[2]) return null;
  const claims = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8"));
  return claims.sid === "learn" ? claims.sub : null;
}
const say = (text, intent = "ask") => JSON.stringify({ v: 1, say: text, intent, outcome: null });
function scripted(request) {
  const ctx = request.context ?? {};
  const last = [...(request.transcript ?? [])].reverse().find((t) => t.role === "child")?.text ?? "";
  if (!ctx.purpose || ctx.purpose === "diagnostic" || ctx.purpose === "reflection") return say("Was sollst du bei dieser Frage herausfinden?", "clarify");
  switch (ctx.purpose) {
    case "home":
      return say("Hallo Santi! Heute wartet Besuch 8 auf dich: das grössere Gewächshaus.", "respond");
    case "welcome":
      return ctx.phase === "begruessung"
        ? say(`Hallo Santi! ${ctx.hisSavedChoice ? "Du wolltest das Gewächshaus vergrössern. " : ""}Heute planst du den neuen Boden. Bist du bereit?`)
        : say("Schön. Geh zuerst zum Gewächshaus.", "close");
    case "visit":
      return last.includes("[verraten]") ? say("Die Tomaten kommen neben die Tür.", "respond") : say("Schau auf der Karte, wo ein Ausrufezeichen leuchtet. Dort wartet jemand.", "respond");
    case "writing":
      return say("Du hast zwei Pläne verglichen. Wie beginnt ein Satz?", "ask");
    case "debrief":
      return ctx.phase === "rueckblick-start"
        ? say("Was war heute knifflig?")
        : ctx.phase === "rueckblick"
          ? say("Das verstehe ich. Was würdest du jemandem zeigen?")
          : ctx.phase === "naechstes"
            ? say("Danke. Was möchtest du beim nächsten Besuch machen?")
            : say("Danke, Santi! Das merke ich mir für das nächste Mal.", "close");
  }
  return say("Erzähl mir mehr.", "respond");
}
const bridgeCalls = [];
let oldRuntime = false;
async function installBridge(ctx) {
  const cors = { "access-control-allow-origin": BASE, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "authorization, content-type", vary: "Origin" };
  await ctx.route(`${BRIDGE}/**`, async (r) => {
    const req = r.request();
    if (req.method() === "OPTIONS") return r.fulfill({ status: 204, headers: cors });
    const body = JSON.parse(req.postData() || "{}");
    const child = tokenChild(req.headers()["authorization"]);
    const last = [...(body.request?.transcript ?? [])].reverse().find((t) => t.role === "child")?.text ?? "";
    const call = { n: (bridgeN += 1), purpose: body.request?.context?.purpose ?? "task", phase: body.request?.context?.phase ?? null, transcript: body.request?.transcript?.length ?? 0, child, answerKey: /"answers?"\s*:/.test(JSON.stringify(body.request ?? {})), cookie: !!req.headers()["cookie"], context: body.request?.context ?? null, at: Date.now() };
    bridgeCalls.push(call);
    if (!child) return r.fulfill({ status: 401, headers: cors });
    if (oldRuntime && (body.request?.transcript ?? []).length === 0) return r.fulfill({ status: 400, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ ok: false, code: "bad_request" }) });
    if (last.includes("[voll]")) return r.fulfill({ status: 429, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ ok: false, code: "attempts_exhausted" }) });
    if (last.includes("[weg]")) return r.abort("connectionrefused");
    if (last.includes("[langsam]")) await settle(4000);
    const reply = scripted(body.request);
    const receipt = signReceipt({ child, turnId: body.turnId, request: body.request, reply, ...(last.includes("[falsch]") ? { secret: "x".repeat(40) } : {}) });
    return r.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ ok: true, reply, receipt }) });
  });
}

// --------------------------------------------------------------------------------------------------------------------------
// Browser
// --------------------------------------------------------------------------------------------------------------------------
const browser = await chromium.launch(audioSafeChromiumLaunchOptions({ headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] }));
const blocked = [];
const speechRequests = [];
const pageErrors = [];
const transcribeUploads = [];
// Browser speech is mocked (ends after 30 ms) and counted; getUserMedia is counted (the microphone never starts by itself).
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
    if (MODE.startsWith("nokt") && u.origin === BRIDGE) return r.fallback();
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
      // No configured voice (as in production today): the client falls back to the browser's German voice (mocked here).
      return r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "No voice for this language" }) });
    }
    if (u.pathname === "/api/family/learning/nokt/transcribe") transcribeUploads.push({ at: Date.now(), multipart: (r.request().headers()["content-type"] ?? "").startsWith("multipart/form-data") });
    if (/\/api\/family\/(transcribe|assistant\/session)/.test(u.pathname)) {
      blocked.push(`${u.origin}${u.pathname}`);
      return r.abort("blockedbyclient");
    }
    return r.continue();
  });
  if (MODE.startsWith("nokt")) await installBridge(c);
  await c.addCookies([{ name: COOKIE, value: cookie, url: BASE }]);
  return c;
}
let shotN = 0;
async function shot(page, name) {
  shotN += 1;
  const file = path.join(OUT, `${String(shotN).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}
const text = async (page, sel = "body") => (await page.locator(sel).first().innerText()).replace(/\s+/g, " ");
const speechCount = async (page) => (await page.evaluate(() => (globalThis.__speech || []).length));
const gumCount = async (page) => page.evaluate(() => globalThis.__gum || 0);
async function missionRun() {
  return (await rawRow()).state.missions?.["MISSION-GREENHOUSE-GROW"] ?? null;
}
async function talks() {
  return (await rawRow()).state.noktTalks ?? { sessions: [], welcomes: [] };
}

/** Walk on the map to the step's place (real movement through the quest list), then open it. */
async function goTo(page, step) {
  await page.waitForSelector(`[data-testid='go-${step}']`, { timeout: 15000 });
  const btn = page.locator(`[data-testid='go-${step}']`);
  if ((await btn.innerText()).includes("Hingehen")) {
    await btn.click();
    await page.waitForFunction((s) => document.querySelector(`[data-testid='go-${s}']`)?.textContent?.includes("Starten"), step, { timeout: 20000 });
  }
  await page.locator(`[data-testid='go-${step}']`).click();
  await page.waitForSelector(`[data-testid='scene-panel'][data-step='${step}']`, { timeout: 15000 });
}
async function back(page) {
  const done = page.locator("[data-testid='scene-continue']");
  if (await done.count()) await done.click();
  else await page.locator("[data-testid='scene-leave']").click();
  await page.waitForSelector("[data-testid='mission-map']:not([hidden])", { timeout: 15000 });
}
async function answerPart(page, value) {
  const next = page.locator("[data-testid='solve-next-question']");
  if (await next.count()) await next.click();
  await page.locator("[data-testid='part-input']").fill(String(value));
  await page.locator("[data-testid='part-check']").click();
  await settle(400);
}
async function waitStepStatus(step, status) {
  for (let i = 0; i < 60; i += 1) {
    const r = await missionRun();
    if (r?.steps?.[step]?.status === status) return true;
    await settle(250);
  }
  return false;
}
async function talkSend(page, scope, line) {
  const before = await page.locator(`${scope} [data-testid='nokt-talk-transcript'] li[data-role]`).count();
  await page.locator(`${scope} [data-testid='nokt-talk-input']`).fill(line);
  await page.locator(`${scope} [data-testid='nokt-talk-send']`).click();
  await page.waitForFunction(([sc, n]) => document.querySelectorAll(`${sc} [data-testid='nokt-talk-transcript'] li[data-role]`).length >= n + 2, [scope, before], { timeout: 20000 });
  return (await page.locator(`${scope} [data-testid='nokt-talk-transcript'] li[data-role]`).last().innerText()).replace(/\s+/g, " ");
}
async function typeBlock(page) {
  await page.locator("[data-testid='typing-start']").click();
  for (let guard = 0; guard < 40; guard += 1) {
    await settle(300);
    const phase = await page.locator("[data-testid='typing-block']").first().getAttribute("data-phase");
    if (phase === "comfort") {
      await page.locator("[data-testid='comfort-easy']").click();
      continue;
    }
    if (phase === "extra-offer") {
      await page.locator("[data-testid='extra-decline']").click();
      continue;
    }
    if (phase !== "drill") break;
    const lines = await page.locator("[data-testid='typing-block'] p.font-mono").allInnerTexts();
    for (const line of lines) {
      await page.locator("[data-testid='typing-input']").type(line.replace(/\s+/g, " ").trim(), { delay: 8 });
      await page.keyboard.press("Enter");
      await settle(120);
    }
  }
}

const rec = { mode: MODE, base: BASE, bridge: BRIDGE || null, startedAt: new Date().toISOString() };
const page = await (await makeCtx({ viewport: { width: 1280, height: 900 } })).newPage();
page.on("pageerror", (e) => pageErrors.push(String(e)));

await seedSevenVisitsDone();
const evidenceBefore = { attempts: await countRows("family_learning_attempts") };

if (MODE === "nokt") {
  // ---------------------------------------------------------------- J8.1 Home: Nokt on Family Home (manual, typed + push-to-talk)
  await page.goto(`${BASE}/family/home?child=santiago`);
  await page.waitForSelector("[data-testid='home-nokt-open']", { timeout: 30000 });
  check("J8.home.nokt-entry-not-the-retired-chat", !(await text(page)).includes("Chat temporarily unavailable"));
  check("J8.home.no-microphone-on-load", (await gumCount(page)) === 0);
  await page.locator("[data-testid='home-nokt-open']").click();
  await page.waitForSelector("[data-testid='nokt-home']");
  check("J8.home.no-microphone-on-open", (await gumCount(page)) === 0);
  const homeReply = await talkSend(page, "[data-testid='nokt-home']", "Was machen wir heute?");
  check("J8.home.verified-reply-shown-as-nokt", /^Nokt/.test(homeReply) && homeReply.includes("Besuch 8"), homeReply);
  const homeCall = bridgeCalls.at(-1);
  check("J8.home.request-server-built-purpose-home-no-answer-key-no-cookie", homeCall.purpose === "home" && !homeCall.answerKey && !homeCall.cookie && homeCall.child === "santiago", homeCall);
  check("J8.home.request-has-his-saved-wish-only", homeCall.context?.home?.hisLastWish === "Das Gewächshaus vergrössern" && !/isabel|lila/i.test(JSON.stringify(homeCall.context)), homeCall.context);
  await settle(300);
  check("J8.home.reply-spoken-in-german-once", (await page.evaluate(() => (globalThis.__speech || []).filter((s) => s.lang?.startsWith("de")).length)) === 1 && speechRequests.some((r) => r.body?.speaker === "nokt" && r.body?.language === "de"), speechRequests.slice(-1));
  // Push-to-talk: explicit start/stop → fake recognizer → editable transcript → sent as spoken.
  await page.locator("[data-testid='nokt-home'] [data-testid='nokt-mic-start']").click();
  await page.waitForSelector("[data-testid='nokt-home'] [data-testid='nokt-mic-stop']", { timeout: 10000 });
  await settle(600);
  await page.locator("[data-testid='nokt-home'] [data-testid='nokt-mic-stop']").click();
  await page.waitForFunction(() => (document.querySelector("[data-testid='nokt-home'] [data-testid='nokt-talk-input']")?.value ?? "").length > 0, null, { timeout: 15000 });
  const heard = await page.locator("[data-testid='nokt-home'] [data-testid='nokt-talk-input']").inputValue();
  check("J8.home.push-to-talk-explicit-fake-transcript-editable", heard === "Ich weiss nicht, wie ich anfangen soll." && (await gumCount(page)) === 1 && transcribeUploads.length === 1 && transcribeUploads[0].multipart, { heard, uploads: transcribeUploads.length });
  await page.locator("[data-testid='nokt-home'] [data-testid='nokt-talk-input']").fill("Ich weiss nicht, wie ich anfangen soll. Hilfst du mir?");
  await page.locator("[data-testid='nokt-home'] [data-testid='nokt-talk-send']").click();
  await page.waitForFunction(() => document.querySelectorAll("[data-testid='nokt-home'] li[data-role='nokt']").length >= 2, null, { timeout: 15000 });
  const homeSession = (await talks()).sessions.find((s) => s.purpose === "home");
  check("J8.home.spoken-turn-recorded-as-voice-corrected-text", homeSession.turns.some((t) => t.role === "child" && t.via === "voice" && t.text.endsWith("Hilfst du mir?")), homeSession.turns.map((t) => [t.role, t.via]));
  await shot(page, "home-nokt");
  // Transcript persistence: reload, reopen — the earlier lines are there, nothing is re-spoken.
  const spokenBefore = speechRequests.length;
  await page.reload();
  await page.waitForSelector("[data-testid='home-nokt-open']");
  await page.locator("[data-testid='home-nokt-open']").click();
  await page.waitForSelector("[data-testid='nokt-home']");
  const persisted = await page.locator("[data-testid='nokt-home'] li[data-role]").count();
  check("J8.home.transcript-persists-across-reload-not-replayed", persisted === 4 && speechRequests.length === spokenBefore, { persisted });
  // Failures on Home: unreachable runtime, used-up day, forged receipt — honest app lines, his words kept.
  const failLine = await talkSend(page, "[data-testid='nokt-home']", "Hallo [weg]");
  check("J8.fail.unreachable-app-line-words-kept", failLine.startsWith("Hinweis der App") && (await page.locator("[data-testid='nokt-home'] [data-testid='nokt-talk-input']").inputValue()) === "Hallo [weg]", failLine);
  await page.locator("[data-testid='nokt-home'] [data-testid='nokt-talk-input']").fill("");
  const fullLine = await talkSend(page, "[data-testid='nokt-home']", "Noch eine Frage [voll]");
  check("J8.fail.used-up-day-kind-pause-line", fullLine.includes("macht jetzt Pause"), fullLine);
  await page.locator("[data-testid='nokt-home'] [data-testid='nokt-talk-input']").fill("");
  const forged = await talkSend(page, "[data-testid='nokt-home']", "Und jetzt? [falsch]");
  check("J8.fail.forged-receipt-withheld-never-nokt", forged.startsWith("Hinweis der App"), forged);
  const homeTurns = (await talks()).sessions.find((s) => s.purpose === "home").turns.filter((t) => t.role === "nokt");
  check("J8.fail.reasons-recorded", JSON.stringify(homeTurns.slice(-3).map((t) => t.reason)) === JSON.stringify(["no-reply-unreachable", "no-reply-attempts_exhausted", "origin-invalid"]), homeTurns.map((t) => t.reason ?? "shown"));
  await page.locator("[data-testid='home-nokt-close']").click();

  // ---------------------------------------------------------------- J8.2 Lernen → deliberate start → one-time spoken welcome
  await page.goto(`${BASE}/family/learn/mission?child=santiago`);
  await page.waitForSelector("[data-testid='start-visit'][data-visit='v9']", { timeout: 30000 });
  const gumBeforeStart = await gumCount(page);
  await page.locator("[data-testid='start-visit']").click();
  await page.waitForSelector("[data-testid='nokt-welcome'] li[data-role='nokt']", { timeout: 20000 });
  const welcome = await text(page, "[data-testid='nokt-welcome']");
  const welcomeCall = bridgeCalls.at(-1);
  check("J8.welcome.after-deliberate-start-spoken-grounded-in-saved-choice", welcome.includes("Gewächshaus vergrössern") && welcomeCall.purpose === "welcome" && welcomeCall.transcript === 0 && welcomeCall.context?.hisSavedChoice === "Das Gewächshaus vergrössern", welcome);
  check("J8.welcome.no-microphone", (await gumCount(page)) === gumBeforeStart);
  check("J8.welcome.objective-and-readiness-question", /Bist du bereit\?/.test(welcome));
  await shot(page, "welcome");
  const ready = await talkSend(page, "[data-testid='nokt-welcome']", "ja!");
  check("J8.welcome.responds-to-his-answer", ready.includes("Gewächshaus"), ready);
  await page.locator("[data-testid='nokt-dock-close']").click();
  const welcomeCalls = bridgeCalls.filter((c) => c.purpose === "welcome").length;
  await page.reload();
  await page.waitForSelector("[data-testid='mission-map']", { timeout: 30000 });
  await settle(1500);
  check("J8.welcome.not-repeated-after-reload", (await page.locator("[data-testid='nokt-welcome']").count()) === 0 && bridgeCalls.filter((c) => c.purpose === "welcome").length === welcomeCalls);

  // ---------------------------------------------------------------- J8.3 Walking map between task scenes
  const avatarBefore = await page.locator("[data-testid='mission-avatar']").getAttribute("data-x");
  await goTo(page, "H1-PLAN");
  check("J8.map.walked-to-the-greenhouse-before-the-scene", (await missionRun()).position === "greenhouse" && avatarBefore !== null, { position: (await missionRun()).position });
  await page.locator("[data-testid='story-done']").click();
  await back(page);
  await goTo(page, "H2-POTS");
  check("J8.retrieval.no-hint-before-first-try", (await page.locator("[data-testid='hint-later']").count()) === 1 || (await page.locator("[data-testid='hint-open']").count()) === 0);
  await answerPart(page, 3);
  // Task talk (diagnosis) on the open question — the assessment path, with its own phases.
  await page.locator("[data-testid='nokt-button']").click();
  await page.waitForSelector("[data-testid='nokt-panel'][data-mode='subscription']");
  await page.locator("[data-testid='nokt-input']").fill("Ich habe 14 durch 4 gerechnet.");
  await page.locator("[data-testid='nokt-send']").click();
  await page.waitForSelector("[data-testid='nokt-transcript'] li[data-role='nokt']", { timeout: 20000 });
  const taskCall = bridgeCalls.at(-1);
  check("J8.task-talk.diagnostic-bound-to-the-question-no-answer-key", taskCall.purpose === "diagnostic" && taskCall.context?.step === "H2-POTS" && !taskCall.answerKey, taskCall.context);
  await page.locator("[data-testid='nokt-close']").click();
  await page.locator("[data-testid='hint-open']").click();
  await settle(300);
  await answerPart(page, 4);
  check("J8.retrieval.supported-after-hint", (await missionRun()).steps["H2-POTS"].outcome === "supported");
  await back(page);
  check("J8.retrieval.fresh-application-offered", (await page.locator("[data-testid='go-H3-POTS-AGAIN']").count()) === 1);
  await goTo(page, "H3-POTS-AGAIN");
  await answerPart(page, 5);
  check("J8.retrieval.fresh-application-independent", (await missionRun()).steps["H3-POTS-AGAIN"].outcome === "independent");
  await back(page);

  // Visit talk on the map; a slow reply when the child switches profile never appears for anyone.
  await page.locator("[data-testid='nokt-button']").click();
  await page.waitForSelector("[data-testid='nokt-visit']");
  const visitLine = await talkSend(page, "[data-testid='nokt-visit']", "Wohin soll ich jetzt?");
  check("J8.visit-talk.on-the-map-page-bound", visitLine.startsWith("Nokt") && bridgeCalls.at(-1).purpose === "visit", visitLine);
  await page.locator("[data-testid='nokt-visit'] [data-testid='nokt-talk-input']").fill("Und dann? [langsam]");
  await page.locator("[data-testid='nokt-visit'] [data-testid='nokt-talk-send']").click();
  await settle(500);
  const slowTurn = bridgeCalls.length;
  await page.locator("button[aria-label$='switch profile']").click();
  await page.locator("[role='dialog'] button", { hasText: "Isabel" }).click();
  await settle(5000);
  const allTurns = (await talks()).sessions.flatMap((s) => s.turns);
  const slowChild = allTurns.find((t) => t.role === "child" && t.text.includes("[langsam]"));
  const late = allTurns.filter((t) => t.role === "nokt" && t.turnId === slowChild?.turnId);
  check("J8.child-switch.slow-reply-cancelled-not-recorded", !!slowChild && bridgeCalls.length === slowTurn && late.length === 0, { calls: bridgeCalls.length, slowTurn, late: late.length });
  check("J8.child-switch.isabel-sees-no-santiago-talk", !(await text(page)).includes("Wohin soll ich jetzt?"));
  await page.goto(`${BASE}/family/learn/mission?child=santiago`);
  await page.waitForSelector("[data-testid='mission-map']", { timeout: 30000 });

  // ---------------------------------------------------------------- J8.4 Measurement, plans, judgment
  await goTo(page, "H4-FLOOR");
  check("J8.plans.floor-grid-shown-with-meter-ruler", (await page.locator("[data-testid='plan-grid'][data-fields='30']").count()) === 1);
  for (const v of [6, 5, 30]) await answerPart(page, v);
  await back(page);
  await goTo(page, "H5-PLANS");
  check("J8.plans.two-viable-layouts-visible", (await page.locator("[data-testid='plan-grid']").count()) === 2);
  for (const v of [24, 18]) await answerPart(page, v);
  await back(page);
  await goTo(page, "H6-CHOOSE");
  await page.locator("[data-testid='decide-pick-C']").click();
  await page.waitForSelector("[data-testid='decide-feedback'][data-tone='retry']");
  check("J8.plans.non-viable-explained-step-stays-open", (await missionRun()).steps["H6-CHOOSE"].status === "active");
  await page.locator("[data-testid='decide-pick-A']").click();
  await page.waitForSelector("[data-testid='decide-feedback'][data-tone='success']");
  await shot(page, "plan-chosen");
  await back(page);
  await settle(500);
  check("J8.plans.consequence-visible-on-the-map", (await text(page, "[data-testid='world-summary']")).includes("Plan A"));

  // ---------------------------------------------------------------- J8.5 English directions (listening, not reading)
  await goTo(page, "H7-JUNE");
  check("J8.english.no-text-before-listening-and-answers-locked", (await page.locator("[data-testid='listen-script']").count()) === 0 && (await page.locator("[data-testid^='pick-tomatoes-']").first().isDisabled()));
  await page.locator("[data-testid='listen-play']").click();
  await page.waitForFunction(() => !document.querySelector("[data-testid^='pick-tomatoes-']")?.hasAttribute("disabled"), null, { timeout: 15000 });
  check("J8.english.played-in-english-voice", speechRequests.some((r) => r.body?.language === "en"), speechRequests.slice(-1));
  // A visit talk that would disclose an open listening answer is withheld.
  await page.locator("[data-testid='nokt-button']").click();
  const disclosed = await talkSend(page, "[data-testid='nokt-visit']", "Sag mir wo die Tomaten hinkommen [verraten]");
  check("J8.guard.open-answer-disclosure-withheld", disclosed.startsWith("Hinweis der App"), disclosed);
  await page.locator("[data-testid='nokt-dock-close']").click();
  await page.locator("[data-testid='pick-tomatoes-Neben die Tür']").click();
  await settle(300);
  await page.locator("[data-testid='pick-beans-Hinten links']").click();
  await settle(300);
  check("J8.english.listening-independent", (await missionRun()).steps["H7-JUNE"].outcome === "independent");
  await back(page);

  // ---------------------------------------------------------------- J8.6 Spanish: retrieval, then a supported exchange
  await goTo(page, "H8-TOOLS");
  await page.locator("[data-testid='request-input']").fill("Necesitamos herramientas");
  await page.locator("[data-testid='request-send']").click();
  await settle(400);
  await back(page);
  await goTo(page, "H9-WATERING");
  await page.locator("[data-testid='request-input']").fill("Necesitamos una regadera");
  await page.locator("[data-testid='request-send']").click();
  await settle(400);
  const r9 = (await missionRun()).steps["H9-WATERING"];
  check("J8.spanish.new-exchange-supported-not-fresh", r9.outcome === "supported" && r9.attempts[0].recall === "after-supplied", r9.attempts.map((a) => a.recall));
  await back(page);

  // ---------------------------------------------------------------- J8.7 Typing (~5 focused minutes planned, new key group)
  await goTo(page, "H10-TYPING");
  const announce = await text(page, "[data-testid='typing-intro']");
  await typeBlock(page);
  const tb = (await missionRun()).typing;
  check("J8.typing.new-key-group-by-the-existing-rule", tb.plan.lessonId === "TYPE-CH-COURSE-6" && (await rawRow()).state.typing.course.lessonIndex >= 5, { lesson: tb.plan.lessonId });
  check("J8.typing.more-than-six-drills-finite-varied", tb.plan.drills.length > 6 && tb.plan.drills.length <= 14 && new Set(tb.plan.drills.map((d) => d.lines.join("|"))).size >= 4, { drills: tb.plan.drills.length, announce });
  check("J8.typing.announced-plan-is-the-plan-that-ran", announce.includes(`${tb.plan.drills.length} kurze Tippübungen`), announce);
  check("J8.typing.finished-only-by-attempted-drills", tb.completedAt !== null && tb.drills.filter((d) => d.attempted && !d.extra).length === tb.plan.drills.length);
  await back(page);

  // ---------------------------------------------------------------- J8.8 Own sentence → Nokt's reaction to it → one typed revision
  await goTo(page, "H11-JOURNAL");
  await page.locator("[data-testid='nokt-button']").click();
  await page.waitForSelector("[data-testid='nokt-write-first']");
  check("J8.writing.nokt-does-not-help-before-the-first-attempt", (await text(page, "[data-testid='nokt-write-first']")).includes("Schreib zuerst"));
  await page.locator("[data-testid='nokt-dock-close']").click();
  const original = "heute haben wir zwei pläne verglichen";
  await page.locator("[data-testid='write-input']").fill(original);
  await page.locator("[data-testid='write-send']").click();
  await page.waitForSelector("[data-testid='nokt-writing'] li[data-role='nokt']", { timeout: 20000 });
  const writingCall = bridgeCalls.at(-1);
  check("J8.writing.reaction-to-his-actual-sentence", writingCall.purpose === "writing" && writingCall.context?.writing?.hisSentence === original && writingCall.transcript === 1, writingCall.context?.writing);
  check("J8.writing.app-tip-capital-start", (await page.locator("[data-testid='write-tip'][data-rule='capital-start']").count()) === 1);
  await shot(page, "writing-reaction");
  await page.locator("[data-testid='write-revise']").fill("Heute haben wir zwei Pläne verglichen.");
  await page.locator("[data-testid='write-revise-send']").click();
  await settle(500);
  const w = (await missionRun()).steps["H11-JOURNAL"];
  check("J8.writing.original-immutable-revision-apart-supported", w.writing.original === original && w.writing.revision.text === "Heute haben wir zwei Pläne verglichen." && w.attempts[1].evidence === "supported" && w.attempts[1].support.includes("nokt-writing"), { outcome: w.writing.revision.outcome });
  await back(page);

  // ---------------------------------------------------------------- J8.9 Outcome, finish — no premature completion
  await goTo(page, "H12-DONE");
  check("J8.outcome.his-own-plan-shown", (await page.locator("[data-testid='outcome-plan'] [data-testid='plan-grid'][data-label='Plan A: schmaler Weg']").count()) === 1);
  await page.locator("[data-testid='story-done']").click();
  await back(page);
  check("J8.no-premature-completion.visit-still-running-before-finish", (await rawRow()).state.visits.find((v) => v.id === "v9").finishedAt === null);
  await page.locator("[data-testid='mission-finish']").click();
  await page.waitForSelector("[data-testid='debrief']", { timeout: 20000 });

  // ---------------------------------------------------------------- J8.10 Debrief: buttons → one question at a time → his words
  await page.locator("[data-testid='difficulty-right']").click();
  await settle(300);
  await page.locator("[data-testid='enjoyment-yes']").click();
  await settle(300);
  await page.locator("[data-testid='clarity-skip']").click();
  await settle(400);
  check("J8.debrief.buttons-saved-before-nokt", JSON.stringify((await rawRow()).state.visits.find((v) => v.id === "v9").feedback?.answers) === JSON.stringify({ difficulty: "right", enjoyment: "yes" }));
  await page.locator("[data-testid='debrief-start']").click();
  await page.waitForSelector("[data-testid='nokt-debrief'] li[data-role='nokt']", { timeout: 20000 });
  const opener = bridgeCalls.at(-1);
  check("J8.debrief.opener-uses-his-buttons-and-work", opener.purpose === "debrief" && opener.transcript === 0 && Object.values(opener.context?.buttons ?? {}).includes("Ja") && Array.isArray(opener.context?.work) && opener.context.work.length > 5, opener.context?.buttons);
  await talkSend(page, "[data-testid='nokt-debrief']", "die pläne");
  await talkSend(page, "[data-testid='nokt-debrief']", "mein plan");
  const last = await talkSend(page, "[data-testid='nokt-debrief']", "tomaten ernten");
  check("J8.debrief.one-question-at-a-time", (await page.locator("[data-testid='nokt-debrief'] li[data-role='nokt']").allInnerTexts()).every((t) => (t.match(/\?/g) ?? []).length <= 1) && /Danke/.test(last));
  await settle(400);
  const interests = (await rawRow()).state.interests.filter((i) => i.visit === "v9");
  check("J8.debrief.his-own-next-interest-words-verbatim", interests.length === 1 && interests[0].text === "tomaten ernten" && interests[0].source === "debrief", interests);
  check("J8.debrief.no-assessment-no-completion-from-the-talk", (await rawRow()).state.visits.find((v) => v.id === "v9").finishedAt === null);
  await shot(page, "debrief");
  await page.locator("[data-testid='debrief-finish']").click();
  await page.waitForURL(/\/family\/home\?child=santiago/, { timeout: 20000 });
  check("J8.journey.ends-on-family-home", page.url().includes("/family/home"));
  check("J8.journey.visit-finished-once", (await rawRow()).state.visits.filter((v) => v.id === "v9" && v.finishedAt).length === 1);
  await page.waitForSelector("[data-testid='home-nokt-open']", { timeout: 20000 });
  await page.locator("[data-testid='home-nokt-open']").click();
  await page.waitForSelector("[data-testid='nokt-home']");
  check("J8.journey.home-nokt-after-the-visit", (await page.locator("[data-testid='nokt-home'] li[data-role]").count()) >= 4);
  await shot(page, "home-after");

  // ---------------------------------------------------------------- J8.11 Parent evidence: every conversation with provenance
  const pctx = await makeCtx({ viewport: { width: 1280, height: 900 } }, owner);
  const pp = await pctx.newPage();
  pp.on("pageerror", (e) => pageErrors.push(String(e)));
  await pp.goto(`${BASE}/family/learn/parent?child=santiago`);
  await pp.waitForSelector("[data-testid='parent-nokt-talks']", { timeout: 30000 });
  const ptext = await text(pp, "[data-testid='parent-nokt-talks']");
  check("J8.parent.talks-with-provenance-and-withheld-reasons", ["Family Home", "Begrüssung", "Reaktion auf den Satz", "Rückblick am Ende", "harness-fictional", "Herkunft ungültig", "Tageskontingent"].every((x) => ptext.includes(x)), ptext.slice(0, 300));
  check("J8.parent.no-assessment-claim", ptext.includes("keine Bewertung"));
  await shot(pp, "parent-talks");

  rec.oldRuntimeNote = "the opener-refusal journey runs in --mode nokt-old on a fresh database";
}

if (MODE === "nokt-old") {
  // ---------------------------------------------------------------- J8.12 The October 24 runtime refuses an empty transcript (opener)
  oldRuntime = true;
  await page.goto(`${BASE}/family/learn/mission?child=santiago`);
  await page.waitForSelector("[data-testid='start-visit'][data-visit='v9']", { timeout: 30000 });
  await page.locator("[data-testid='start-visit']").click();
  await page.waitForSelector("[data-testid='nokt-welcome'] li[data-role='app']", { timeout: 20000 });
  const line = await text(page, "[data-testid='nokt-welcome']");
  await settle(400);
  check("J8.old-runtime.welcome-falls-back-to-labelled-app-line-not-spoken", line.includes("Hinweis der App") && line.includes("Willkommen") && !speechRequests.some((r) => r.body?.speaker === "nokt"), line);
  const s = (await talks()).sessions.find((x) => x.purpose === "welcome");
  check("J8.old-runtime.recorded-as-runtime-refusal", s.turns.some((t) => t.role === "nokt" && !t.shown && t.reason === "no-reply-bad_request"), s.turns.map((t) => t.reason));
  // Ordinary turns still work against the old runtime.
  await page.locator("[data-testid='nokt-dock-close']").click();
  await page.locator("[data-testid='nokt-button']").click();
  const ok = await talkSend(page, "[data-testid='nokt-visit']", "Wohin soll ich?");
  check("J8.old-runtime.ordinary-turns-unaffected", ok.startsWith("Nokt"), ok);
}

if (MODE === "off") {
  // ---------------------------------------------------------------- J8-off: Nokt not configured — complete visit, honest surfaces
  await page.goto(`${BASE}/family/home?child=santiago`);
  await page.waitForSelector("text=Lernen", { timeout: 30000 });
  await settle(1000);
  check("J8off.home.no-nokt-panel-retired-card-kept", (await page.locator("[data-testid='home-nokt-open']").count()) === 0 && (await text(page)).includes("Chat temporarily unavailable"));
  await page.goto(`${BASE}/family/learn/mission?child=santiago`);
  await page.waitForSelector("[data-testid='start-visit'][data-visit='v9']", { timeout: 30000 });
  await page.locator("[data-testid='start-visit']").click();
  await page.waitForSelector("[data-testid='mission-map']", { timeout: 20000 });
  await settle(800);
  check("J8off.no-welcome", (await page.locator("[data-testid='nokt-welcome']").count()) === 0);
  await page.locator("[data-testid='nokt-button']").click();
  await page.waitForSelector("[data-testid='nokt-unavailable']");
  check("J8off.nokt-honestly-unavailable", (await text(page, "[data-testid='nokt-unavailable']")).includes("kann im Moment nicht"));
  await page.locator("[data-testid='nokt-dock-close']").click();
  await goTo(page, "H1-PLAN");
  await page.locator("[data-testid='story-done']").click();
  await back(page);
  await goTo(page, "H2-POTS");
  await answerPart(page, 4);
  check("J8off.planned-reflection-recorded-not-available", (await missionRun()).steps["H2-POTS"].parts.total.reflection === "not-available");
  await back(page);
  check("J8off.fresh-application-not-needed", (await page.locator("[data-testid='go-H3-POTS-AGAIN']").count()) === 0);
}

check("J8.common.no-external-requests", blocked.length === 0, blocked.slice(0, 5));
check("J8.common.no-page-errors", pageErrors.length === 0, pageErrors.slice(0, 3));
check("J8.common.every-bridge-call-child-bearer-no-cookie-no-answer-key", bridgeCalls.every((c) => c.child === "santiago" && !c.cookie && !c.answerKey), bridgeCalls.filter((c) => c.child !== "santiago" || c.cookie || c.answerKey));
rec.bridgeCalls = bridgeCalls.map(({ context, ...c }) => ({ ...c, contextKeys: context ? Object.keys(context) : [] }));
rec.speechRequests = speechRequests.length;
rec.results = results;
rec.passed = results.filter((r) => r.ok).length;
rec.failed = results.filter((r) => !r.ok).length;
rec.attemptsBefore = evidenceBefore.attempts;
fs.writeFileSync(path.join(OUT, `results-${MODE}.json`), JSON.stringify(rec, null, 2));
console.log(`SUMMARY ${MODE}: ${rec.passed} passed, ${rec.failed} failed`);
await browser.close();
process.exit(rec.failed ? 1 : 0);
