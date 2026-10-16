// Visit 6 (content v5) — rendered end-to-end journeys on an ISOLATED local server with a SYNTHETIC database.
// Never points at production: --base must be a loopback origin and --db a local file. Audio is muted (browser audio guard,
// --mute-audio, the child voice route aborted before it leaves the browser); every non-local request is aborted and counted.
//
// Fixture: five finished visits rebuilt through the child API (the Visit 5 harness sequence plus a Visit 5 harbor chapter with
// the real-shape mistakes: 4 voll/4 übrig, «cuerdas» for «herramientas», «Necesitamos querdas», a missing space in the log sentence) — synthetic values, not his records,
// then the stored row reduced to the released version-4 shape (no missions / interests keys) — the upgrade path production takes.
//
// J1 desktop (1280×900, keyboard first): hub → start → walk (held arrow keys) → every mission step with wrong answers, help,
// the querdas repair, the typing block with a global Stopp mid-drill and resume → launch → summary → closing interest → report →
// hub island → parent planning input. J2 tablet (820×1180, touch, reduced motion): tap-walking, early exit, entry interest prompt,
// resume, a typing drill on the tablet layout.
//
// Usage: AUTH_SECRET=… node scripts/verify-learning-visit6.mjs --base http://127.0.0.1:3186 --db <dir>/nabu.db --out <dir>
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
const OUT = opt("--out", "/tmp/family-learning-visit6");
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
  const r = await api("PUT", "/api/family/learning/mission", { op: o, expectedRevision: v.revision, idempotencyKey: `v6fx-${Date.now()}-${(opN += 1)}`, context: contextOf(v), tz: TZ }, assistant, bearer);
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
const browser = await chromium.launch(audioSafeChromiumLaunchOptions({ headless: true }));
const blocked = [];
const speechRequests = [];
async function makeContext(options, cookie = assistant) {
  const c = await browser.newContext(options);
  await installBrowserAudioGuard(c);
  await c.route("**/*", async (r) => {
    const u = new URL(r.request().url());
    if (u.origin !== BASE) {
      blocked.push(u.origin);
      return r.abort("blockedbyclient");
    }
    if (/\/api\/family\/assistant\/tts/.test(u.pathname)) {
      // The child voice route is the listening path (reviewed text → speech). It is aborted here: no audible playback in tests.
      speechRequests.push({ at: Date.now(), body: r.request().postData() });
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

const openPages = [];
process.on("unhandledRejection", () => {});
try {
await fiveVisitsDone();
const before = await rawRow();
const historicalVisitsHash = sha(before.state.visits);
check("fixture.production-shape", before.state.contentVersion === 4 && !("missions" in before.state) && !("interests" in before.state) && before.state.visits.filter((v) => v.finishedAt).length === 5, { contentVersion: before.state.contentVersion, finished: before.state.visits.filter((v) => v.finishedAt).length });
const historicalRows = { attempts: (await rows("family_learning_attempts")).length, samples: (await rows("family_learning_work_samples")).length, completions: (await rows("family_learning_completions")).length };

// ============================================================ J1 desktop ============================================================
const desk = await makeContext({ viewport: { width: 1280, height: 900 } });
const p = await desk.newPage();
openPages.push(p);
p.setDefaultTimeout(15000);
p.on("pageerror", (e) => pageErrors.push({ page: "desktop", message: String(e) }));
await p.goto(`${BASE}/family/learn?child=santiago`);
await p.waitForSelector("[data-testid='world-screen']");
await settle(800);
check("J1.hub.offers-besuch-6", (await p.locator("[data-testid='cockpit-start']").innerText()).includes("Besuch 6 starten"));
await shot(p, "desktop-hub-before");
// historical reports stay readable
await p.goto(`${BASE}/family/learn?child=santiago&report=v6`);
await p.waitForSelector("[data-testid='visit-report'][data-report-visit='v6']");
check("J1.historical-report.v6", (await text(p)).includes("Besuch 5"));
await p.locator("[data-testid='report-lessons'] summary").click().catch(() => {});
check("J1.historical-report.no-matcher-wording", !/zuordnen|zugeordnet/.test(await p.locator("[data-testid='visit-report']").innerText()));
await shot(p, "desktop-historical-report-v6");
await p.goto(`${BASE}/family/learn?child=santiago&report=v4`);
await p.waitForSelector("[data-testid='visit-report'][data-report-visit='v4']");
check("J1.historical-report.v4", true);

await p.goto(`${BASE}/family/learn/mission?child=santiago`);
await p.waitForSelector("[data-testid='start-visit']");
check("J1.start.v7", (await p.locator("[data-testid='start-visit']").getAttribute("data-visit")) === "v7" && (await p.locator("[data-testid='start-visit']").innerText()).includes("Besuch 6"));
await p.locator("[data-testid='start-visit']").click();
await p.waitForSelector("[data-testid='mission-world']");
await settle(900);
await shot(p, "desktop-mission-map-start");
let body = await text(p);
check("J1.no-generic-read-aloud", !/Vorlesen/.test(body));
check("J1.no-skip", !/Überspringen/.test(body));
check("J1.no-nabu-sidebar-in-mission", (await p.locator("[data-testid^='nabu']").count()) === 0);
check("J1.beacons-show-where-to-go", (await p.locator("[data-testid='beacon-office']").count()) === 1);

// --- walking: hold an arrow key; the avatar moves continuously along the path (not a jump to a destination)
await p.locator("[data-testid='mission-map']").focus();
const pos0 = await p.locator("[data-testid='mission-avatar']").evaluate((el) => [Number(el.dataset.x), Number(el.dataset.y)]);
await p.keyboard.down("ArrowUp");
await settle(220);
const mid = await p.evaluate(() => {
  const a = document.querySelector("[data-testid='mission-avatar']");
  return { x: Number(a.dataset.x), y: Number(a.dataset.y), walking: document.querySelector("[data-testid='mission-world']").dataset.walking };
});
await settle(600);
await p.keyboard.up("ArrowUp");
await settle(900);
const pos1 = await p.locator("[data-testid='mission-avatar']").evaluate((el) => [Number(el.dataset.x), Number(el.dataset.y)]);
const NODES = [[760, 700], [582, 413], [1004, 369], [639, 640], [872, 571], [1074, 562], [459, 300], [389, 413], [980, 505]];
const onNode = (x, y) => NODES.some(([a, b]) => Math.abs(a - x) < 2 && Math.abs(b - y) < 2);
check("J1.walk.continuous-intermediate-position", mid.walking === "true" && !onNode(mid.x, mid.y) && (mid.x !== pos0[0] || mid.y !== pos0[1]), { pos0, mid, pos1 });
check("J1.walk.moved-along-path", pos1[0] !== pos0[0] || pos1[1] !== pos0[1], { pos0, pos1 });
await shot(p, "desktop-walking-arrow-keys");

// --- S1 the brief: walk via the quest list, open with Enter at the place (keyboard path)
await walkTo(p, "S1-BRIEF");
await p.locator("[data-testid='mission-map']").focus();
await p.keyboard.press("Enter");
await p.waitForSelector("[data-testid='scene-panel'][data-step='S1-BRIEF']");
check("J1.S1.scene-uses-painted-character", (await p.locator("[data-testid='scene-character']").count()) === 1);
await shot(p, "desktop-S1-brief-scene");
await p.locator("[data-testid='story-done']").click();
await cont(p);

// --- S2 reading: text shown, no audio of any kind
await openStep(p, "S2-BOARD");
check("J1.S2.reading-text-shown", (await p.locator("[data-testid='read-text']").innerText()).includes("HAFENREGELN"));
check("J1.S2.no-audio-on-reading", (await p.locator("[data-testid='listen-play']").count()) === 0 && !/anhören|Vorlesen/i.test(await p.locator("[data-testid='scene-panel']").innerText()));
await p.locator("[data-testid='number-boat-max']").fill("4");
await p.keyboard.press("Enter");
await p.waitForSelector("[data-testid='hint-boat-max']");
check("J1.S2.hint-after-wrong", (await p.locator("[data-testid='hint-boat-max']").innerText()).includes("erste Regel"));
await shot(p, "desktop-S2-reading-hint");
await p.locator("[data-testid='number-boat-max']").fill("6");
await p.keyboard.press("Enter");
await p.waitForSelector("[data-testid='question-boat-max'][data-status='correct']");
await p.locator("[data-testid='number-reef-max']").fill("4");
await p.keyboard.press("Enter");
await p.waitForSelector("[data-testid='scene-done']");
await cont(p);

// --- S3 listening with Mrs Finley: no answer before listening; the play request goes to the voice route (aborted = muted)
await openStep(p, "S3-RADIO");
check("J1.S3.answers-locked-before-listening", await p.locator("[data-testid='pick-crew-7']").isDisabled());
check("J1.S3.no-transcript-before-listening", (await p.locator("[data-testid='listen-transcript']").count()) === 0 && (await p.locator("[data-testid='listen-script']").count()) === 0);
await shot(p, "desktop-S3-listening-before");
const speechBefore = speechRequests.length;
await p.locator("[data-testid='listen-play']").click();
await settle(1200);
check("J1.S3.play-requests-reviewed-speech-not-ai", speechRequests.length === speechBefore + 1 && JSON.parse(speechRequests.at(-1).body).text.startsWith("Hello, harbor! This is the research ship."), speechRequests.at(-1)?.body?.slice(0, 120));
await p.waitForFunction(() => document.querySelector("[data-testid='listen-box']")?.getAttribute("data-voice") !== "none", null, { timeout: 25000 });
check("J1.S3.voice-fallback-to-browser-speech", (await p.locator("[data-testid='listen-box']").getAttribute("data-voice")) === "browser" && !(await text(p)).includes("Der Ton kam gerade nicht"));
await p.locator("[data-testid='pick-crew-7']").click();
await p.waitForSelector("[data-testid='question-crew'][data-status='correct']");
await p.locator("[data-testid='pick-bottles-2']").click();
await p.waitForSelector("[data-testid='hint-bottles']");
await p.locator("[data-testid='listen-transcript']").click();
await p.waitForSelector("[data-testid='listen-script']");
check("J1.S3.transcript-after-support", (await p.locator("[data-testid='listen-script']").innerText()).includes("seven scientists"));
await shot(p, "desktop-S3-listening-transcript-support");
await p.locator("[data-testid='pick-bottles-4']").click();
await p.waitForSelector("[data-testid='question-bottles'][data-status='correct']");
await p.locator("[data-testid='pick-ask-Seile']").click();
await p.waitForSelector("[data-testid='scene-done']");
await shot(p, "desktop-S3-done");
await cont(p);

// --- S4 calc with one wrong answer → clarification (recorded), then right
await openStep(p, "S4-WATER");
await p.locator("[data-testid='calc-total']").fill("11");
await p.locator("[data-testid='calc-submit']").click();
await p.waitForSelector("[data-testid='calc-clarification']");
await shot(p, "desktop-S4-calc-clarification");
await p.locator("[data-testid='calc-total']").fill("28");
await p.locator("[data-testid='calc-submit']").click();
await p.waitForSelector("[data-testid='scene-done']");
await cont(p);

// --- S5 three fields, one wrong → per-field feedback
await openStep(p, "S5-CRATES");
for (const [k, v] of [["full", "4"], ["rest", "4"], ["needed", "4"]]) await p.locator(`[data-testid='calc-${k}']`).fill(v);
await p.locator("[data-testid='calc-submit']").click();
await p.waitForSelector("[data-testid='calc-clarification']");
check("J1.S5.per-field-feedback", (await p.locator("[data-testid='calc-task']").innerText()).includes("✓ stimmt"));
await shot(p, "desktop-S5-fields");
await p.locator("[data-testid='calc-needed']").fill("5");
await p.locator("[data-testid='calc-submit']").click();
await p.waitForSelector("[data-testid='scene-done']");
await cont(p);
check("J1.world.crates-on-quay", ((await p.locator("[data-testid='mission-world-changes']").getAttribute("data-changes")) ?? "").includes("W-CRATES"));

// --- S6 Rosa: «Necesitamos querdas» → the reviewed repair line, then a supported retry
await openStep(p, "S6-ROSA");
await p.locator("[data-testid='produce-input']").fill("Necesitamos querdas");
await p.locator("[data-testid='produce-send']").click();
await p.waitForSelector("[data-testid='repair-line']");
const repair = await p.locator("[data-testid='repair-line']").innerText();
check("J1.S6.querdas-repair-line", repair === "Du möchtest sagen: Wir brauchen Seile. „Seile“ schreibt man auf Spanisch cuerdas, mit c. Versuch den Satz noch einmal.", repair);
check("J1.S6.no-matcher-wording", !/zuordnen|zugeordnet|nicht bewertet/.test(await text(p)));
await shot(p, "desktop-S6-querdas-repair");
await p.locator("[data-testid='produce-input']").fill("Necesitamos cuerdas");
await p.locator("[data-testid='produce-send']").click();
await p.waitForSelector("[data-testid='scene-done']");
await cont(p);

// --- S7 Rosa's reply (Spanish listening)
await openStep(p, "S7-ROSA-REPLY");
await p.locator("[data-testid='listen-play']").click();
await p.waitForSelector("[data-testid='pick-ropes-5']:not([disabled])", { timeout: 25000 });
await p.locator("[data-testid='pick-ropes-5']").click();
await p.waitForSelector("[data-testid='scene-done']");
await cont(p);

// --- S8 retrieval of Visit 5's missed word
await openStep(p, "S8-TOOLS");
await p.locator("[data-testid='produce-input']").fill("Necesitamos herramientas");
await p.locator("[data-testid='produce-send']").click();
await p.waitForSelector("[data-testid='scene-done']");
await cont(p);

// --- S9, S10 calculations
await openStep(p, "S9-LOAD");
await p.locator("[data-testid='calc-total']").fill("8");
await p.locator("[data-testid='calc-boats']").fill("2");
await p.locator("[data-testid='calc-submit']").click();
await p.waitForSelector("[data-testid='scene-done']");
await cont(p);
await openStep(p, "S10-ROPES");
await p.locator("[data-testid='calc-need']").fill("4");
await p.locator("[data-testid='calc-left']").fill("1");
await p.locator("[data-testid='calc-submit']").click();
await p.waitForSelector("[data-testid='scene-done']");
await shot(p, "desktop-S10-pier");
await cont(p);

// --- S11 plan choice: allowed but slower first → reviewed feedback, then the best plan
await openStep(p, "S11-ROUTE");
await p.locator("[data-testid='choice-around-6-2']").click();
await p.waitForSelector("[data-testid='choice-feedback']");
check("J1.S11.slower-plan-feedback", (await p.locator("[data-testid='choice-feedback']").innerText()).includes("doppelt so lange"));
await shot(p, "desktop-S11-plan-feedback");
await p.locator("[data-testid='choice-reef-4-4']").click();
await p.waitForSelector("[data-testid='scene-done']");
await cont(p);

// --- S12 typing block: clean screen, announced finite block, no decision between drills, global Stopp mid-drill, resume
await openStep(p, "S12-TYPING");
check("J1.S12.no-character-in-typing", (await p.locator("[data-testid='scene-character']").count()) === 0 && !/Mrs Finley/.test(await p.locator("[data-testid='scene-panel']").innerText()));
await p.locator("[data-testid='typing-start']").click();
await p.waitForSelector("[data-testid='typing-block'][data-phase='drill']");
const announce = await p.locator("[data-testid='typing-announce']").innerText();
const planned = Number((announce.match(/(\d+) kurze Tippübungen/) ?? [])[1]);
check("J1.S12.finite-announced-block", planned >= 3 && planned <= 6 && /etwa \d+ Minuten/.test(announce), announce);
await shot(p, "desktop-S12-typing-drill");
async function typeDrill(page) {
  const no = await page.locator("[data-testid='typing-block']").getAttribute("data-drill");
  const lines = await page.evaluate(() => [...document.querySelectorAll("[data-testid='typing-block'] p.font-mono")].map((el) => el.textContent.replace(/␣/g, " ")));
  for (const l of lines) await typeLine(page, l);
  await page.waitForFunction((n) => document.querySelector("[data-testid='typing-block']")?.getAttribute("data-drill") !== n, no);
  return lines;
}
await typeDrill(p);
check("J1.S12.no-decision-between-drills", (await p.locator("[data-testid='decision-card']").count()) === 0 && (await p.locator("[data-testid='typing-block']").getAttribute("data-phase")) === "drill");
// global pause mid-drill
await p.locator("[data-testid='typing-input']").focus();
await p.keyboard.type("gg", { delay: 40 });
await p.locator("[data-testid='hud-stop']").click();
await p.waitForSelector("[data-testid='world-screen']");
await settle(800);
const paused = (await rawRow()).state.missions["MISSION-SHIP-SUPPLY"];
check("J1.S12.pause-saves-partial-not-completion", paused.typing.partials.length >= 1 && paused.typing.completedAt === null && paused.steps["S12-TYPING"].status === "active", { partials: paused.typing.partials.length, drills: paused.typing.drills.length });
await shot(p, "desktop-hub-paused-mid-typing");
await p.goto(`${BASE}/family/learn/mission?child=santiago`);
await p.waitForSelector("[data-testid='typing-block'][data-phase='drill']");
check("J1.S12.resume-at-same-drill", (await p.locator("[data-testid='typing-block']").getAttribute("data-drill")) === "2");
for (let i = 0; i < 8; i += 1) {
  if ((await p.locator("[data-testid='typing-block']").getAttribute("data-phase")) !== "drill") break;
  await typeDrill(p);
}
await p.waitForSelector("[data-testid='typing-block'][data-phase='comfort']");
await shot(p, "desktop-S12-comfort-once");
await p.locator("[data-testid='comfort-ok']").click();
await p.waitForSelector("[data-testid='typing-block'][data-phase='extra-offer']");
await shot(p, "desktop-S12-optional-extra");
await p.locator("[data-testid='extra-decline']").click();
await p.waitForSelector("[data-testid='scene-done']");
await cont(p);

// --- S13 conditional retrieval (S6 was repaired → offered at the pier)
check("J1.S13.offered-after-repair", (await p.locator("[data-testid='quest-S13-RECALL-CUERDAS']").count()) === 1);
await openStep(p, "S13-RECALL-CUERDAS");
await p.locator("[data-testid='produce-input']").fill("Necesitamos cuerdas");
await p.locator("[data-testid='produce-send']").click();
await p.waitForSelector("[data-testid='scene-done']");
await cont(p);

// --- S14 launch → visible world change
await openStep(p, "S14-LAUNCH");
await p.locator("[data-testid='story-done']").click();
await p.waitForSelector("[data-testid='scene-done']");
await shot(p, "desktop-S14-launch-done");
await cont(p);
await settle(800);
check("J1.world.boats-sailing", ((await p.locator("[data-testid='mission-world-changes']").getAttribute("data-changes")) ?? "").includes("W-SAIL") && (await p.locator("[data-testid='launched-banner']").count()) === 1);
await shot(p, "desktop-mission-complete-map");
await p.locator("[data-testid='mission-finish']").click();
await p.waitForSelector("[data-testid='summary']");
await shot(p, "desktop-summary");
check("J1.summary.practiced-names-spelling", (await p.locator("[data-testid='summary']").innerText()).includes("cuerdas, mit c"));
await p.locator("[data-testid='summary-next-button']").click();
await p.waitForSelector("[data-testid='reflect']");
check("J1.reflect.submit-needs-interest", await p.locator("[data-testid='reflect-submit']").isDisabled());
await p.locator("[data-testid='difficulty-right']").click();
const WISH = "Ich möchte ein U-Boot bauen und damit tauchen, vielleicht";
await p.locator("[data-testid='next-interest-text']").fill(WISH);
await shot(p, "desktop-reflect-next-interest");
await p.locator("[data-testid='reflect-submit']").click();
await p.waitForSelector("[data-testid='visit-report'][data-report-visit='v7']");
await settle(600);
check("J1.report.interest-verbatim", (await p.locator("[data-testid='report-interest']").innerText()).includes(`„${WISH}“`));
check("J1.report.mission-steps", (await p.locator("[data-testid^='report-step-']").count()) >= 13);
await shot(p, "desktop-report-v7");
await p.goto(`${BASE}/family/learn?child=santiago`);
await p.waitForSelector("[data-testid='world-screen']");
await settle(900);
check("J1.hub.mission-world-persists", (await p.locator("[data-testid='island-mission-world']").count()) === 1);
check("J1.hub.no-entry-prompt-after-answer", (await p.locator("[data-testid='entry-interest']").count()) === 0);
await shot(p, "desktop-hub-after");

// --- stored evidence: originals, supported retries, help recorded before it was shown, history untouched
const after = await rawRow();
const run = after.state.missions["MISSION-SHIP-SUPPLY"];
check("J1.store.interest-verbatim", after.state.interests?.at(-1)?.text === WISH && after.state.interests.at(-1).source === "closing");
check("J1.store.querdas-original-kept", run.steps["S6-ROSA"].attempts[0].raw === "Necesitamos querdas" && run.steps["S6-ROSA"].attempts[1].evidence === "supported" && run.steps["S6-ROSA"].attempts[1].recall === "after-supplied");
check("J1.store.listen-supported-after-transcript", run.steps["S3-RADIO"].attempts.find((a) => a.questionId === "crew").evidence === "independent" && run.steps["S3-RADIO"].attempts.filter((a) => a.questionId === "bottles").at(-1).evidence === "supported");
const supports = await rows("family_learning_support_events");
const attempts = await rows("family_learning_attempts");
const repairRow = supports.find((s) => s.kind === "mission_language_repair");
const retryRow = attempts.filter((a) => a.task_id === "MISSION-SHIP-SUPPLY/S6-ROSA")[1];
check("J1.store.repair-recorded-before-retry", !!repairRow && !!retryRow && String(repairRow.created_at) <= String(retryRow.created_at), { repair: repairRow?.created_at, retry: retryRow?.created_at });
check("J1.store.transcript-support-row", supports.some((s) => s.kind === "mission_transcript"));
check("J1.store.typing-active-vs-wall", run.typing.drills.every((d) => d.activeSeconds <= d.seconds) && run.typing.completedAt !== null, run.typing.drills.map((d) => [d.no, d.seconds, d.activeSeconds, d.idleSeconds, d.attempted]));
check("J1.store.history-unchanged", sha(after.state.visits.slice(0, 5)) === historicalVisitsHash);
const histAfter = { attempts: attempts.filter((a) => !String(a.task_id).startsWith("MISSION-")).length, completions: (await rows("family_learning_completions")).length };
check("J1.store.historical-rows-kept", histAfter.attempts === historicalRows.attempts && histAfter.completions === historicalRows.completions + 1, { historicalRows, histAfter });

// --- parent: planning input with his own words
const parentCtx = await makeContext({ viewport: { width: 1280, height: 900 } }, owner);
const pp = await parentCtx.newPage();
pp.on("pageerror", (e) => pageErrors.push({ page: "parent", message: String(e) }));
await pp.goto(`${BASE}/family/learn/parent?child=santiago`);
await pp.waitForSelector("[data-testid='parent-planning']", { timeout: 20000 });
check("J1.parent.planning-interest-verbatim", (await pp.locator("[data-testid='planning-interests']").innerText()).includes(WISH));
check("J1.parent.planning-typing-calibration", (await pp.locator("[data-testid='planning-typing']").innerText()).includes("Kalibrierung"));
await shot(pp, "desktop-parent-planning");
const ev = (await api("GET", "/api/family/learning/parent/evidence?child=santiago", null, owner)).json;
check("J1.parent.evidence-planningInput", ev.planningInput?.interests?.some((i) => i.text === WISH));

// ============================================================ J2 tablet ============================================================
await fiveVisitsDone();
const tab = await makeContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: false, reducedMotion: "reduce" });
const t = await tab.newPage();
openPages.push(t);
t.setDefaultTimeout(15000);
t.on("pageerror", (e) => pageErrors.push({ page: "tablet", message: String(e) }));
await t.goto(`${BASE}/family/learn/mission?child=santiago`);
await t.waitForSelector("[data-testid='start-visit']");
await t.locator("[data-testid='start-visit']").tap();
await t.waitForSelector("[data-testid='mission-world']");
await settle(700);
await shot(t, "tablet-mission-map-start");
// tap-walking on the painted map: tap the office (stage 1004, 369)
async function tapStage(page, x, y) {
  const box = await page.locator("[data-testid='mission-map']").boundingBox();
  const scale = Math.min(box.width / 1600, box.height / 900);
  const ox = box.x + (box.width - 1600 * scale) / 2;
  const oy = box.y + (box.height - 900 * scale) / 2;
  await page.touchscreen.tap(ox + x * scale, oy + y * scale);
}
await tapStage(t, 1004, 330);
await t.waitForSelector("[data-testid='open-S1-BRIEF']");
check("J2.tap-walk.arrived-office", (await t.locator("[data-testid='mission-world']").getAttribute("data-walker-at")) === "office");
await t.locator("[data-testid='open-S1-BRIEF']").tap();
await t.waitForSelector("[data-testid='scene-panel'][data-step='S1-BRIEF']");
await shot(t, "tablet-S1-scene");
await t.locator("[data-testid='story-done']").tap();
await t.locator("[data-testid='scene-continue']").tap();
await t.waitForSelector("[data-testid='quest-log']");
await settle(300);
await tapStage(t, 872, 540);
await t.waitForSelector("[data-testid='open-S2-BOARD']");
await t.locator("[data-testid='open-S2-BOARD']").tap();
await t.waitForSelector("[data-testid='read-text']");
await shot(t, "tablet-S2-reading");
// early exit: Stopp in the middle of the reading task → the next entry asks what comes next (nothing inferred)
await t.locator("[data-testid='hud-stop']").tap();
await t.waitForSelector("[data-testid='entry-interest']");
check("J2.early-exit.no-interest-invented", !("interests" in (await rawRow()).state) || (await rawRow()).state.interests.length === 0);
await shot(t, "tablet-hub-entry-interest-prompt");
await t.locator("[data-testid='next-interest-unsure']").tap();
await t.locator("[data-testid='entry-interest-save']").tap();
await t.waitForFunction(() => !document.querySelector("[data-testid='entry-interest']"));
const t2 = (await rawRow()).state;
check("J2.entry-interest.saved-as-unsure", t2.interests?.length === 1 && t2.interests[0].kind === "unsure" && t2.interests[0].source === "entry" && t2.interests[0].text === null);
await t.goto(`${BASE}/family/learn/mission?child=santiago`);
await t.waitForSelector("[data-testid='mission-world']");
await settle(500);
check("J2.resume.position-and-open-step-kept", (await t.locator("[data-testid='mission-world']").getAttribute("data-position")) === "harbormaster" && (await t.locator("[data-testid='scene-panel'][data-step='S2-BOARD']").count()) === 1);
await shot(t, "tablet-resume-S2");
await t.locator("[data-testid='number-boat-max']").fill("6");
await t.locator("[data-testid='number-boat-max']").press("Enter");
await t.waitForSelector("[data-testid='question-boat-max'][data-status='correct']");
await t.locator("[data-testid='number-reef-max']").fill("4");
await t.locator("[data-testid='number-reef-max']").press("Enter");
await t.waitForSelector("[data-testid='scene-done']");
await t.locator("[data-testid='scene-continue']").tap();
await t.waitForSelector("[data-testid='quest-log']");
// typing on the tablet layout (hardware keyboard)
await t.locator("[data-testid='go-S12-TYPING']").tap();
await t.waitForSelector("[data-testid='open-S12-TYPING']");
await t.locator("[data-testid='open-S12-TYPING']").tap();
await t.locator("[data-testid='typing-start']").tap();
await t.waitForSelector("[data-testid='typing-block'][data-phase='drill']");
await shot(t, "tablet-S12-typing");
await t.locator("[data-testid='scene-leave']").tap();
await t.waitForSelector("[data-testid='quest-log']");
await shot(t, "tablet-quest-log");

} catch (e) {
  check("journey.completed-without-exception", false, String(e).slice(0, 400));
  for (const pg of openPages) {
    try {
      await shot(pg, "FAILURE");
      console.log("FAILURE screen text:", (await text(pg)).slice(0, 800));
    } catch {}
  }
}
// ============================================================ global =================================================================
check("global.no-external-requests", blocked.length === 0, [...new Set(blocked)]);
check("global.no-page-errors", pageErrors.length === 0, pageErrors.slice(0, 5));
check("global.speech-never-reached-server", speechRequests.length >= 2, speechRequests.length);
await browser.close();
const passed = results.filter((r) => r.ok).length;
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ at: new Date().toISOString(), base: BASE, passed, total: results.length, results, speechRequests: speechRequests.length, blocked: [...new Set(blocked)], pageErrors }, null, 2));
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
