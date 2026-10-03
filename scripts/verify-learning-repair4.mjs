// Independent re-acceptance, repair round 4 (R3-F1, 2026-10-03/04) — HTTP + database evidence that
// EVERY new closure of an open repair (explicit close, exhausted close, acknowledgment through
// lesson-feedback-seen) persists the honest outcome from the complete current required-item
// inventory — for current three-item records and for records persisted by earlier rounds (two
// items, or no items, maxRetries 2) — re-read through the API and the raw database row; repeated
// acknowledgment/close stays idempotent; already-closed history stays immutable. LOCAL production server, synthetic
// AUTH_SECRET, isolated NABU_DB_DIR; headless Chromium with the project audio guard.
//
//   AUTH_SECRET=<server secret> node scripts/verify-learning-repair4.mjs --base http://127.0.0.1:3172 \
//       --out <dir> --db /tmp/<fixture>/nabu.db
//
// The fixture is seeded by `verify-learning-world.mjs --seed --fixture completed`; the script resets the
// child through the owner's deletion route and rebuilds visits through the child API between scenarios
// (never through the database file, except the one legacy-row injection for F3, done with a short-lived
// connection while the server is idle).

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { encode } from "@auth/core/jwt";
import { chromium } from "/Users/claweberle/.npm-global/lib/node_modules/playwright/index.mjs";
import { audioSafeChromiumLaunchOptions, installBrowserAudioGuard } from "./lib/browser-audio-guard.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const require = createRequire(import.meta.url);
const { createClient } = require("@libsql/client");
const BASE = opt("--base", "http://127.0.0.1:3172").replace(/\/$/, "");
const OUT = opt("--out", "/tmp/family-learning-repair4");
const DB = opt("--db", null);
const SECRET = process.env.AUTH_SECRET;
if (!SECRET || SECRET.length < 32) {
  console.error("AUTH_SECRET (>= 32 chars, same as the server) is required");
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });
const COOKIE = "authjs.session-token";
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(ok ? "PASS" : "FAIL", "[repair4]", name, detail === undefined ? "" : JSON.stringify(detail).slice(0, 400));
}
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
let bearer = (await api("POST", "/api/family/learning/session", { childId: "santiago" })).json?.token;
if (!bearer) {
  console.error("could not mint a child session; is the server up with the same AUTH_SECRET?");
  process.exit(2);
}
const TZ = "Europe/Zurich";
const view = async () => (await api("GET", `/api/family/learning/mission?tz=${TZ}`, null, assistant, bearer)).json.view;
let opN = 0;
const contextOf = (v) => ({ erasureGeneration: v.erasureGeneration, visit: v.visit ? { id: v.visit.id, startedAt: v.visit.startedAt } : null });
async function opRaw(o, key) {
  const v = await view();
  return api("PUT", "/api/family/learning/mission", { op: o, expectedRevision: v.revision, idempotencyKey: key, context: contextOf(v), tz: TZ }, assistant, bearer);
}
async function op(o, key = `r4-${(opN += 1)}`) {
  const r = await opRaw(o, key);
  if (r.status !== 200 || (r.json.status !== "applied" && r.json.status !== "replayed")) throw new Error(`op ${o.op}: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
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
const evidence = async () => (await api("GET", "/api/family/learning/parent/evidence?child=santiago", null, owner)).json;
const lang = (segmentId, stepId, response, modality = "typed") => ({ op: "language-step", segmentId, stepId, response, modality });
const CH = ["'", "ö", "z"];

/** Erase the child (owner route) and rebuild the two finished visits through the child API (acknowledging each lesson end). */
async function resetTwoVisits() {
  await api("DELETE", "/api/family/learning/parent/records?child=santiago&confirm=santiago", null, owner);
  bearer = (await api("POST", "/api/family/learning/session", { childId: "santiago" })).json?.token;
  for (const o of [{ op: "start-visit" }, { op: "name-base", name: "Sonnenküste" }, { op: "place-base", locationId: "shore" }, { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }]) await op(o);
  await ack();
  await op({ op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" });
  await ack();
  await op({ op: "explain", text: "Ich habe geteilt.", modality: "typed" });
  await op({ op: "skip-stage", stage: "LANG-EN-WATER", reason: "child" });
  await op({ op: "typing-label", taskId: "TYPE-LABEL-BASE", typed: "Sonnenküste", seconds: 20 });
  await ack();
  await op({ op: "save-log", text: "Tag eins." });
  await op({ op: "reflect", optionId: "easy" });
  await op({ op: "start-visit" });
  await op({ op: "resume-base" });
  await op({ op: "answer-math", itemId: "EQ-RETURN", answer: 7, raw: "7", modality: "typed" });
  await ack();
  await op({ op: "skip-stage", stage: "LANG-ES-AGUA", reason: "child" });
  await op({ op: "typing-label", taskId: "TYPE-LABEL-GARDEN", typed: "Garten der Basis", seconds: 30 });
  await ack();
  await op({ op: "save-log", text: "Der Garten ist fertig." });
  await op({ op: "reflect", optionId: "easy" });
}
/** Chapter 4 up to (and including) the typing-course stage with the layout aligned. */
async function toTypingCourse(theme = "turtles") {
  await op({ op: "start-visit" });
  await op({ op: "resume-base" });
  await op({ op: "choose-station", theme });
  if ((await setLayout("ch-de-qwertz")) !== 200) throw new Error("layout");
  await op({ op: "typing-check", observed: CH });
}

const browser = await chromium.launch(audioSafeChromiumLaunchOptions({ headless: true }));
const blocked = new Set();
/** Ops whose NEXT request is forwarded to the server (persisted) but whose response is dropped before the browser sees it. */
const lostAfterSave = new Set();
const persistedLosses = [];
async function makeContext(options) {
  const c = await browser.newContext(options);
  await installBrowserAudioGuard(c);
  await c.route("**/*", async (r) => {
    const u = new URL(r.request().url());
    if (u.origin !== BASE) return r.abort("blockedbyclient");
    if (/\/api\/family\/(assistant\/|transcribe)/.test(u.pathname)) return r.abort("blockedbyclient");
    // Network-failure windows: a PUT whose body op is in `blocked` is aborted BEFORE it reaches the server (the save never happens).
    if (r.request().method() === "PUT" && u.pathname === "/api/family/learning/mission" && blocked.size) {
      try {
        const body = JSON.parse(r.request().postData() ?? "{}");
        if (blocked.has(body.op?.op)) return r.abort("failed");
      } catch {
        /* ignore */
      }
    }
    if (r.request().method() === "PUT" && u.pathname === "/api/family/learning/mission" && lostAfterSave.size) {
      try {
        const body = JSON.parse(r.request().postData() ?? "{}");
        if (lostAfterSave.has(body.op?.op)) {
          lostAfterSave.delete(body.op.op);
          const saved = await r.fetch();
          const response = await saved.json();
          persistedLosses.push({ op: body.op.op, status: saved.status(), outcome: response.status, revision: response.view?.revision, result: response.result });
          return r.abort("failed"); // the server has persisted and answered; only the browser's receipt is lost
        }
      } catch {
        /* ignore */
      }
    }
    return r.continue();
  });
  return c;
}
const desktop = await makeContext({ viewport: { width: 1280, height: 900 } });
await desktop.addCookies([{ name: COOKIE, value: assistant, url: BASE }]);
const tablet = await makeContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: false, reducedMotion: "reduce" });
await tablet.addCookies([{ name: COOKIE, value: assistant, url: BASE }]);
const p = await desktop.newPage();
p.setDefaultTimeout(12000);
const t = await tablet.newPage();
t.setDefaultTimeout(12000);
const pageErrors = [];
for (const pg of [p, t]) pg.on("pageerror", (e) => pageErrors.push(String(e)));
const shots = [];
const shot = async (page, name, { full = false } = {}) => {
  const file = `repair4-${name}${page === t ? "-tablet" : ""}.png`;
  await page.screenshot({ path: path.join(OUT, file), fullPage: full });
  fs.writeFileSync(path.join(OUT, file.replace(/\.png$/, ".txt")), await page.locator("body").innerText());
  shots.push(file);
};
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const tid = (id, page = p) => page.getByTestId(id);
const body = async (page = p) => page.locator("body").innerText();
async function activeTestId(page = p) {
  for (let i = 0; i < 12; i += 1) {
    const id = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? (document.activeElement && document.activeElement !== document.body ? document.activeElement.tagName : null));
    if (id) return id;
    await settle(50);
  }
  return page.evaluate(() => document.activeElement?.tagName ?? null);
}
async function enterOn(testId, page = p) {
  for (let i = 0; i < 24; i += 1) {
    if ((await activeTestId(page)) === testId) break;
    await settle(50);
  }
  await page.keyboard.press("Enter");
}
const opens = [];
async function paceMint() {
  const now = Date.now();
  while (opens.length && now - opens[0] > 61_000) opens.shift();
  if (opens.length >= 27) {
    await new Promise((r) => setTimeout(r, 61_000 - (now - opens[0]) + 200));
    opens.length = 0;
  }
  opens.push(Date.now());
}
async function goto(page, url) {
  await paceMint();
  await page.goto(BASE + url);
  await page.waitForLoadState("load");
  await settle(500);
}
async function typeLine(page, selectorTestId, text) {
  const input = tid(selectorTestId, page);
  await input.waitFor();
  const active = await activeTestId(page);
  check(`focus: ${selectorTestId} is the active element before typing ("${text}")`, active === selectorTestId, active);
  await page.keyboard.type(text, { delay: 15 });
  await page.keyboard.press("Enter");
}
const inViewport = async (locator, page = p) => {
  const box = await locator.boundingBox();
  const h = page.viewportSize().height;
  return !!box && box.y >= 0 && box.y + box.height <= h;
};
async function guarded(name, fn) {
  try {
    await fn();
  } catch (error) {
    check(`harness: ${name} ran without an uncaught error (${String(error).split("\n")[0]})`, false, String(error).slice(0, 400));
    try {
      await p.screenshot({ path: path.join(OUT, `repair4-FAILURE-${name}.png`), fullPage: true });
      fs.writeFileSync(path.join(OUT, `repair4-FAILURE-${name}.txt`), await p.locator("body").innerText());
    } catch {
      /* ignore */
    }
  }
}


const h2 = async (page = p) => (await page.locator("#lesson-end-title").innerText()).trim();
const successTag = async (page = p) => page.evaluate(() => document.querySelector("[data-testid='lesson-success']")?.tagName ?? null);
/** Chapter 4 up to the station language segment (typing course done, EQ-STATION solved, explanation skipped). */
async function toStationLanguage(theme = "turtles") {
  await toTypingCourse(theme);
  await op({ op: "typing-course-continue" });
  await op({ op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" });
  await ack();
  await op({ op: "skip-stage", stage: "explain", reason: "child" });
}
/** Through the station language segment and the station build to the transfer sentence (page without flags). */
async function toTransfer() {
  await toStationLanguage();
  await op({ op: "skip-stage", stage: "LANG-ES-STATION", reason: "child" });
  await op({ op: "build-station", spot: "rocks" });
  await op({ op: "save-log", text: "Heute steht die Station." });
  await op({ op: "revise-log", text: "Heute steht die Station." });
}
async function wrongTypingRound() {
  await goto(p, "/family/learn/mission?child=santiago");
  for (let i = 0; i < 6; i += 1) {
    if ((await tid("placement-demo").count()) === 0) break;
    await enterOn("demo-next");
    await settle(120);
  }
  if ((await tid("decision-card").count()) > 0) await enterOn("another-burst");
  await tid("course-input").waitFor();
  await typeLine(p, "course-input", "fff hhj");
  await typeLine(p, "course-input", "fj fj jf");
  await tid("comfort-ok").waitFor();
  await enterOn("comfort-ok");
  await tid("lesson-end").waitFor();
}


/** pick wrong twice, produce wrong twice (continued), reuse wrong once — the second reuse pick is left to the caller. */
const THREE_WRONG_BUT_LAST = [lang("LANG-ES-STATION", "listen", "", "listen"), lang("LANG-ES-STATION", "pick", "agua", "word-choice"), lang("LANG-ES-STATION", "pick", "herramientas", "word-choice"), lang("LANG-ES-STATION", "produce", "agua"), lang("LANG-ES-STATION", "produce", "agua"), { op: "language-continue", segmentId: "LANG-ES-STATION", stepId: "produce" }, lang("LANG-ES-STATION", "reuse", "herramientas", "word-choice")];
async function threeWrongViaApi() {
  await resetTwoVisits();
  await toStationLanguage();
  for (const o of [...THREE_WRONG_BUT_LAST, lang("LANG-ES-STATION", "reuse", "semillas", "word-choice")]) await op(o);
  return (await view()).lastLesson;
}
const retryOp = (repairId, retryNo, stepId, response) => ({ op: "language-retry", repairId, retryNo, stepId, response });
/** Edit the persisted repair record of the child directly (the only database-level step: it simulates records written by earlier rounds). */
async function patchRepairRecord(mutate) {
  const c = createClient({ url: "file:" + DB });
  for (let attempt = 0; ; attempt += 1) {
    try {
      const row = (await c.execute("SELECT state_json FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0];
      const state = JSON.parse(String(row.state_json));
      state.feedback.repairs = state.feedback.repairs.map((r) => mutate(r));
      await c.execute({ sql: "UPDATE family_learning_missions SET state_json = ? WHERE child_id = 'santiago'", args: [JSON.stringify(state)] });
      break;
    } catch (e) {
      if (!/SQLITE_BUSY/.test(String(e)) || attempt >= 50) throw e;
      await settle(100);
    }
  }
  c.close();
}


/** The raw persisted repair record of the child, read directly from the fixture database (the storage boundary, not a projection). */
async function rawRepair(id) {
  const c = createClient({ url: "file:" + DB });
  try {
    const row = (await c.execute("SELECT state_json FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0];
    const state = JSON.parse(String(row.state_json));
    return { record: state.feedback.repairs.find((r) => r.id === id) ?? null, focus: state.feedback.focus, acknowledged: state.feedback.acknowledged, records: state.language["LANG-ES-STATION"]?.records ?? [] };
  } finally {
    c.close();
  }
}
const shapeRecord = (shape) => (r) => {
  if (shape === "current") return r;
  if (shape === "two-items") return { ...r, items: ["LANG-ES-STATION/pick", "LANG-ES-STATION/produce"], maxRetries: 2 };
  const { items: _items, ...rest } = r;
  return { ...rest, maxRetries: 2 };
};

// ---------------------------------------------------------------------------
// S1 — the six-case differential matrix through the API and the database: current / two-item / no-item × explicit close / acknowledgment
// ---------------------------------------------------------------------------
await guarded("S1", async () => {
  check("fixture: two visits finished, next v4", (await view()).next.visit === "v4");
  for (const shape of ["current", "two-items", "no-items"]) {
    for (const mode of ["repair-close", "lesson-feedback-seen"]) {
      const fb = await threeWrongViaApi();
      const id = fb.repair.repairId;
      await op({ op: "repair-explain", repairId: id });
      if (shape !== "current") await patchRepairRecord((r) => (r.id === id ? shapeRecord(shape)(r) : r));
      const originals = JSON.stringify((await rawRepair(id)).records);
      await op(retryOp(id, 1, "pick", "lámpara"));
      const r2 = await op(retryOp(id, 2, "produce", "necesitamos una lámpara"));
      check(`${shape}/${mode}: two corrections leave the repair open with reuse still required`, r2.result.closed === false && r2.view.lastLesson.repair.status === "open" && r2.view.lastLesson.repair.items.length === 3, { remaining: r2.result.remaining });
      const key = `r4-${shape}-${mode}-${Date.now()}`;
      const closed = await op(mode === "repair-close" ? { op: "repair-close", repairId: id, reason: "skip" } : { op: "lesson-feedback-seen", id }, key);
      const raw = await rawRepair(id);
      const ev = await evidence();
      const parentRecord = ev.state.feedback.repairs.find((r) => r.id === id);
      const reportLesson = closed.view.reports.find((r) => r.visit === "v4")?.lessons.find((l) => l.id === id) ?? null;
      check(`${shape}/${mode}: the NEW stored outcome is practice-again in the raw database row, the parent evidence and the child report; closedAt set; 2 attempts, none fabricated`, raw.record?.outcome === "practice-again" && !!raw.record.closedAt && raw.record.retries.length === 2 && parentRecord?.outcome === "practice-again" && reportLesson?.close.kind === "practice-again" && reportLesson?.repair.outcome === "practice-again", { raw: raw.record?.outcome, parent: parentRecord?.outcome, report: reportLesson?.close.kind, reportOutcome: reportLesson?.repair.outcome });
      check(`${shape}/${mode}: both word focuses stay open; original attempts and the two retry samples untouched`, raw.focus.filter((f) => f.id.startsWith("language:es:")).every((f) => f.status === "open") && JSON.stringify(raw.records) === originals && ev.samples.filter((s) => s.kind === "language_retry").length === 2);
      // idempotency: the same key replays; a fresh acknowledgment is "repeated"; a later close is "repeated"; nothing reopens
      const replay = await op(mode === "repair-close" ? { op: "repair-close", repairId: id, reason: "skip" } : { op: "lesson-feedback-seen", id }, key);
      const ackAgain = mode === "lesson-feedback-seen" ? await op({ op: "lesson-feedback-seen", id }) : null;
      const closeAgain = await op({ op: "repair-close", repairId: id, reason: "done" });
      const late = await opRaw(retryOp(id, 3, "reuse", "agua"), `r4-late-${Date.now()}`);
      const rawAfter = await rawRepair(id);
      check(`${shape}/${mode}: repeated acknowledgment/close is idempotent (replayed / repeated), a late third attempt is refused, the stored row is unchanged`, replay.status === "replayed" && (ackAgain === null || ackAgain.result.repeated === true) && closeAgain.result.repeated === true && late.status === 422 && JSON.stringify(rawAfter.record) === JSON.stringify(raw.record), { replay: replay.status, late: late.json?.message });
    }
  }
});

// ---------------------------------------------------------------------------
// S2 — an ALREADY-closed legacy record stays immutable on acknowledgment; projections stay truthful; exhausted close agrees
// ---------------------------------------------------------------------------
await guarded("S2", async () => {
  let fb = await threeWrongViaApi();
  let id = fb.repair.repairId;
  await op({ op: "repair-explain", repairId: id });
  await patchRepairRecord((r) => (r.id === id ? shapeRecord("two-items")(r) : r));
  await op(retryOp(id, 1, "pick", "lámpara"));
  await op(retryOp(id, 2, "produce", "necesitamos una lámpara"));
  const closedAt = new Date().toISOString();
  await patchRepairRecord((r) => (r.id === id ? { ...r, outcome: "corrected-with-practice", closedAt } : r));
  const ack = await op({ op: "lesson-feedback-seen", id });
  const raw = await rawRepair(id);
  const reportLesson = ack.view.reports.find((r) => r.visit === "v4")?.lessons.find((l) => l.id === id) ?? null;
  check("already-closed legacy record: acknowledgment leaves the stored outcome and closedAt untouched (immutable history), acknowledges the lesson, and the child report / parent projection still read practice-again", raw.record?.outcome === "corrected-with-practice" && raw.record.closedAt === closedAt && raw.record.retries.length === 2 && raw.acknowledged.includes(id) && reportLesson?.close.kind === "practice-again", { raw: raw.record?.outcome, report: reportLesson?.close.kind });
  // the exhausted close (third attempt) on a legacy two-item record agrees with the other paths
  fb = await threeWrongViaApi();
  id = fb.repair.repairId;
  await op({ op: "repair-explain", repairId: id });
  await patchRepairRecord((r) => (r.id === id ? shapeRecord("no-items")(r) : r));
  await op(retryOp(id, 1, "pick", "lámpara"));
  await op(retryOp(id, 2, "produce", "necesitamos una lámpara"));
  const third = await op(retryOp(id, 3, "reuse", "semillas"));
  const rawThird = await rawRepair(id);
  check("no-item legacy record, third attempt wrong → the exhausted close stores practice-again with 3 attempts", third.result.closed === true && third.result.outcome === "practice-again" && rawThird.record?.outcome === "practice-again" && rawThird.record.retries.length === 3);
  fb = await threeWrongViaApi();
  id = fb.repair.repairId;
  await op({ op: "repair-explain", repairId: id });
  await patchRepairRecord((r) => (r.id === id ? shapeRecord("two-items")(r) : r));
  for (const [no, step, resp] of [[1, "pick", "lámpara"], [2, "produce", "necesitamos una lámpara"], [3, "reuse", "agua"]]) await op(retryOp(id, no, step, resp));
  const rawAll = await rawRepair(id);
  check("two-item legacy record, all three corrected → the exhausted close stores corrected-with-practice (every required item corrected)", rawAll.record?.outcome === "corrected-with-practice" && rawAll.record.retries.length === 3);
  check("no browser page errors", pageErrors.length === 0, pageErrors.slice(0, 3));
});

await browser.close();
const summary = { base: BASE, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results, screenshots: shots, pageErrors };
fs.writeFileSync(path.join(OUT, "repair4-results.json"), JSON.stringify(summary, null, 2));
console.log(`\nrepair4: ${summary.passed} passed, ${summary.failed} failed → ${OUT}`);
process.exit(summary.failed === 0 ? 0 : 1);
