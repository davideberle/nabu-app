// Real-browser + HTTP checks for the world-first learner experience (2026-10-03)
// against a LOCAL production server (synthetic AUTH_SECRET, isolated NABU_DB_DIR).
// Headless Chromium with the project audio guard (muted); Auth.js session
// cookies minted locally. No real .env, data, OAuth or external service.
//
//   node scripts/verify-learning-world.mjs --seed --dir /tmp/<fresh> [--fixture completed|fresh]
//       seeds an isolated fixture: `completed` = v1 + v2 finished under version-1 content (the
//       production-shaped two-visit row, no completion rows); `fresh` = empty database.
//   AUTH_SECRET=<same as server> node scripts/verify-learning-world.mjs --base http://127.0.0.1:3171 \
//       --out /tmp/<dir> --db /tmp/<fresh>/nabu.db --mode baseline|journey|fixtures
//
// Modes:
//   baseline  screenshots of every learner screen as rendered by the checkout under test (API-driven
//             progression, minimal UI interaction) — used for the before/after comparison.
//   journey   the complete keyboard-first child journey through the real UI (world → task → lesson
//             feedback → mini-lesson/retry → typing → completion report → map → reopen report → next
//             relevant lesson reminder), with DOM activeElement checks, reload/duplicate recovery and
//             desktop/tablet screenshots.
//   fixtures  the six UX-5 fixtures through the API + browser: a correct lesson; a confirmed mistake
//             corrected after help; a still-unresolved mistake after the bounded retry; ambiguous/unscored
//             work; an early exit; reminders that are relevant, omitted and retired.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const require = createRequire(import.meta.url);
const { createClient } = require("@libsql/client");

const CH_ALIGNMENT = ["'", "ö", "z"]; // right of 0, right of L, right of T on a Swiss-German input source

if (args.includes("--seed")) {
  const dir = opt("--dir", null);
  if (!dir) throw new Error("--dir required");
  const fixture = opt("--fixture", "completed");
  fs.mkdirSync(dir, { recursive: true });
  const { asLearningContent } = await import("../src/lib/family-learning-content.ts");
  const { applyMutation, ensureLearningTables, readChildView } = await import("../src/lib/family-learning-db.ts");
  const v1 = asLearningContent(JSON.parse(fs.readFileSync(new URL("../src/data/family-learning/content/santiago-expedition-v1.json", import.meta.url), "utf8")));
  const client = createClient({ url: `file:${path.join(dir, "nabu.db")}` });
  await ensureLearningTables(client);
  if (fixture === "completed") {
    let t = Date.now() - 3 * 3600000;
    const now = () => new Date((t += 60000));
    let k = 0;
    const step = async (op) => {
      const view = await readChildView(client, "santiago", v1, now());
      const out = await applyMutation(client, { child: "santiago", op, idempotencyKey: `seed-${(k += 1)}`, expectedRevision: view.revision }, v1, now);
      if (out.status !== "applied") throw new Error(`${op.op}: ${out.status} ${out.message ?? ""}`);
    };
    const lang = (segmentId, stepId, response, modality) => ({ op: "language-step", segmentId, stepId, response, modality });
    for (const op of [
      { op: "start-visit" }, { op: "name-base", name: "Sonnenküste" }, { op: "place-base", locationId: "shore" },
      { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }, { op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" },
      { op: "explain", text: "Ich habe geteilt.", modality: "typed" },
      lang("LANG-EN-WATER", "listen", "", "listen"), lang("LANG-EN-WATER", "pick", "water", "word-choice"), lang("LANG-EN-WATER", "produce", "water", "typed"), lang("LANG-EN-WATER", "reuse", "tools", "word-choice"),
      { op: "typing-label", taskId: "TYPE-LABEL-BASE", typed: "Sonnenküste", seconds: 20 }, { op: "save-log", text: "Ichhabe2Schildkroten gesehen." }, { op: "reflect", optionId: "easy" },
      { op: "start-visit" }, { op: "resume-base" }, { op: "answer-math", itemId: "EQ-RETURN", answer: 7, raw: "7", modality: "typed" },
      lang("LANG-ES-AGUA", "listen", "", "listen"), lang("LANG-ES-AGUA", "pick", "agua", "word-choice"), lang("LANG-ES-AGUA", "produce", "agua", "typed"), lang("LANG-ES-AGUA", "reuse", "herramientas", "word-choice"),
      { op: "typing-label", taskId: "TYPE-LABEL-GARDEN", typed: "Garten der Basis", seconds: 30 }, { op: "save-log", text: "Der Garten ist fertig." }, { op: "reflect", optionId: "easy" },
    ]) await step(op);
    await client.execute("DELETE FROM family_learning_completions WHERE child_id = 'santiago'");
    // Like the live rows: no visit ids on language records, picks classified under the pre-retirement rule, no `feedback` key.
    const row = (await client.execute("SELECT state_json FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0];
    const state = JSON.parse(String(row.state_json));
    for (const seg of Object.values(state.language)) for (const r of seg.records) { delete r.visit; if (r.evidence === "recognition") r.support = ["word-choice"]; }
    delete state.feedback;
    for (const l of state.typing.labels) delete l.errors;
    await client.execute({ sql: "UPDATE family_learning_missions SET state_json = ? WHERE child_id = 'santiago'", args: [JSON.stringify(state)] });
    console.log(JSON.stringify({ seeded: dir, fixture, visits: state.visits.map((v) => ({ id: v.id, finishedAt: v.finishedAt })), keys: Object.keys(state).sort() }));
  } else {
    console.log(JSON.stringify({ seeded: dir, fixture: "fresh" }));
  }
  client.close();
  process.exit(0);
}

const { encode } = await import("@auth/core/jwt");
const { chromium } = await import("/Users/claweberle/.npm-global/lib/node_modules/playwright/index.mjs");
const { audioSafeChromiumLaunchOptions, installBrowserAudioGuard } = await import("./lib/browser-audio-guard.mjs");

const BASE = opt("--base", "http://127.0.0.1:3171").replace(/\/$/, "");
const OUT = opt("--out", "/tmp/family-learning-world");
const DB = opt("--db", null);
const MODE = opt("--mode", "baseline");
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
  console.log(ok ? "PASS" : "FAIL", `[${MODE}]`, name, detail === undefined ? "" : JSON.stringify(detail).slice(0, 400));
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
async function opRaw(o, key, expectedView) {
  const v = expectedView ?? (await view());
  return api("PUT", "/api/family/learning/mission", { op: o, expectedRevision: v.revision, idempotencyKey: key, context: contextOf(v), tz: TZ }, assistant, bearer);
}
async function op(o, key = `w-${MODE}-${(opN += 1)}`) {
  const r = await opRaw(o, key);
  if (r.status !== 200 || (r.json.status !== "applied" && r.json.status !== "replayed")) throw new Error(`op ${o.op}: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json;
}
async function setLayout(layout) {
  const current = await api("GET", "/api/family/learning/parent/settings?child=santiago", null, owner);
  const put = await api("PUT", "/api/family/learning/parent/settings", { child: "santiago", expectedErasureGeneration: current.json.erasureGeneration, keyboardLayout: layout }, owner);
  return put.status;
}
const evidence = async () => (await api("GET", "/api/family/learning/parent/evidence?child=santiago", null, owner)).json;

const browser = await chromium.launch(audioSafeChromiumLaunchOptions({ headless: true }));
async function makeContext(options) {
  const c = await browser.newContext(options);
  await installBrowserAudioGuard(c);
  await c.route("**/*", async (r) => {
    const u = new URL(r.request().url());
    if (u.origin !== BASE) return r.abort("blockedbyclient");
    if (/\/api\/family\/(assistant\/|transcribe)/.test(u.pathname)) return r.abort("blockedbyclient");
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
  const file = `${MODE}-${name}${page === t ? "-tablet" : ""}.png`;
  await page.screenshot({ path: path.join(OUT, file), fullPage: full });
  fs.writeFileSync(path.join(OUT, file.replace(/\.png$/, ".txt")), await page.locator("body").innerText());
  shots.push(file);
};
const opens = [];
async function paceMint() {
  const now = Date.now();
  while (opens.length && now - opens[0] > 61_000) opens.shift();
  if (opens.length >= 27) {
    const wait = 61_000 - (now - opens[0]) + 200;
    await new Promise((r) => setTimeout(r, wait));
    opens.length = 0;
  }
  opens.push(Date.now());
}
async function goto(page, url) {
  await paceMint();
  await page.goto(BASE + url);
  // "load" + a short settle: the workspace keeps a periodic telemetry flush alive, so networkidle never arrives.
  await page.waitForLoadState("load");
  await settle(500);
}
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const tid = (id, page = p) => page.getByTestId(id);
const body = async (page = p) => page.locator("body").innerText();
/** The focused element's test id, after giving a deliberate (next-frame) focus move up to ~600 ms to land. */
async function activeTestId(page = p) {
  for (let i = 0; i < 12; i += 1) {
    const id = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? (document.activeElement && document.activeElement !== document.body ? document.activeElement.tagName : null));
    if (id) return id;
    await settle(50);
  }
  return page.evaluate(() => document.activeElement?.tagName ?? null);
}
const activeTag = (page = p) => page.evaluate(() => document.activeElement?.tagName ?? null);
/** Waits (bounded) for a deliberate focus move to land on `testId`; returns the active test id and the time it took. */
async function activeBecomes(testId, page = p, maxMs = 1500) {
  const started = Date.now();
  let id = null;
  while (Date.now() - started < maxMs) {
    id = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null);
    if (id === testId) break;
    await settle(50);
  }
  return { id, ms: Date.now() - started };
}

// ---------------------------------------------------------------------------
// baseline — API-driven progression, screenshots of every learner screen
// ---------------------------------------------------------------------------
if (MODE === "baseline") {
  const v0 = await view();
  check("fixture: two visits finished, next is v4 (Visit 3)", v0.next.visit === "v4", v0.next);
  await goto(p, "/family/learn?child=santiago");
  await settle(600);
  await shot(p, "01-cockpit");
  await goto(t, "/family/learn?child=santiago");
  await settle(600);
  await shot(t, "01-cockpit");
  await goto(p, "/family/learn/mission?child=santiago");
  await settle(500);
  await shot(p, "02-start");
  await op({ op: "start-visit" });
  await goto(p, "/family/learn/mission?child=santiago");
  await settle(500);
  await shot(p, "03-restore-intro");
  await op({ op: "resume-base" });
  await goto(p, "/family/learn/mission?child=santiago");
  await settle(500);
  await shot(p, "04-station-choice");
  await op({ op: "choose-station", theme: "turtles" });
  check("parent sets the Swiss-German layout", (await setLayout("ch-de-qwertz")) === 200);
  await goto(p, "/family/learn/mission?child=santiago");
  await settle(500);
  await shot(p, "05-typing-alignment");
  await goto(t, "/family/learn/mission?child=santiago");
  await settle(500);
  await shot(t, "05-typing-alignment");
  await op({ op: "typing-check", observed: CH_ALIGNMENT });
  await goto(p, "/family/learn/mission?child=santiago");
  await settle(500);
  await shot(p, "06-typing-lesson");
  await goto(t, "/family/learn/mission?child=santiago");
  await settle(500);
  await shot(t, "06-typing-lesson");
  // One round with mistakes (j typed as h twice) and one clean round — what the child sees afterwards.
  await op({ op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["fff hhj", "fj fj jf"], seconds: 30, comfort: "ok" });
  await goto(p, "/family/learn/mission?child=santiago");
  await settle(500);
  await shot(p, "07-after-typing-round");
  await op({ op: "typing-course-continue" });
  await goto(p, "/family/learn/mission?child=santiago");
  await settle(500);
  await shot(p, "08-math-station");
  await goto(t, "/family/learn/mission?child=santiago");
  await settle(500);
  await shot(t, "08-math-station");
  // A wrong answer first (clarification), then the right one.
  await op({ op: "answer-remainder", itemId: "EQ-STATION", used: 32, remaining: 0, raw: "32, 0", modality: "typed" });
  await goto(p, "/family/learn/mission?child=santiago");
  await settle(500);
  await shot(p, "09-math-after-wrong");
  await op({ op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" });
  await goto(p, "/family/learn/mission?child=santiago");
  await settle(500);
  await shot(p, "10-after-math");
  await op({ op: "skip-stage", stage: "explain", reason: "child" });
  await goto(p, "/family/learn/mission?child=santiago");
  await settle(500);
  await shot(p, "11-spanish");
  await op({ op: "language-step", segmentId: "LANG-ES-STATION", stepId: "listen", response: "", modality: "listen" });
  await op({ op: "language-step", segmentId: "LANG-ES-STATION", stepId: "pick", response: "lámpara", modality: "word-choice" });
  await op({ op: "language-step", segmentId: "LANG-ES-STATION", stepId: "produce", response: "necesitamos una lámpara", modality: "typed" });
  await op({ op: "language-step", segmentId: "LANG-ES-STATION", stepId: "reuse", response: "agua", modality: "word-choice" });
  await goto(p, "/family/learn/mission?child=santiago");
  await settle(500);
  await shot(p, "12-station-build");
  await op({ op: "build-station", spot: "rocks" });
  await op({ op: "save-log", text: "Die Station steht auf den Felsen und 2 Setzlinge sind übrig." });
  await op({ op: "skip-stage", stage: "log-revise", reason: "child" });
  await op({ op: "skip-stage", stage: "log-transfer", reason: "child" });
  await goto(p, "/family/learn/mission?child=santiago");
  await settle(500);
  await shot(p, "13-summary-stage");
  await op({ op: "summary-seen" });
  await goto(p, "/family/learn/mission?child=santiago");
  await settle(500);
  await shot(p, "14-reflect");
  await op({ op: "reflect", optionId: "right", feedback: { enjoyment: "yes", clarity: "clear" } });
  // What the child sees right after the finishing step (the report gap) and back on the cockpit.
  await goto(p, "/family/learn/mission?child=santiago");
  await settle(500);
  await shot(p, "15-after-finish-mission");
  await goto(p, "/family/learn?child=santiago");
  await settle(600);
  await shot(p, "16-after-finish-cockpit");
  await goto(t, "/family/learn?child=santiago");
  await settle(600);
  await shot(t, "16-after-finish-cockpit");
  const after = await view();
  check("after finishing: the view has no running visit and the summary field is null (no reopenable report in the baseline contract)", after.visit === null && after.summary === null, { summary: after.summary, reports: after.reports?.length ?? "absent" });
  check("no browser page errors", pageErrors.length === 0, pageErrors.slice(0, 3));
}

// ---------------------------------------------------------------------------
// journey — the complete child journey through the real UI, keyboard-first
// ---------------------------------------------------------------------------
/** Wait until the deliberate focus move landed on `testId` (≤ ~1.2 s), then press Enter. */
async function enterOn(testId, page = p) {
  for (let i = 0; i < 24; i += 1) {
    if ((await activeTestId(page)) === testId) break;
    await settle(50);
  }
  await page.keyboard.press("Enter");
}
async function typeLine(page, selectorTestId, text) {
  const input = tid(selectorTestId, page);
  await input.waitFor();
  const active = await activeTestId(page);
  check(`focus: the typing field is the active element before typing ("${text}")`, active === selectorTestId, active);
  await page.keyboard.type(text, { delay: 15 });
  await page.keyboard.press("Enter");
}

async function guarded(fn) {
  try {
    await fn();
  } catch (error) {
    check(`harness: no uncaught error (${String(error).split("\n")[0]})`, false, String(error).slice(0, 400));
    try {
      await p.screenshot({ path: path.join(OUT, `${MODE}-FAILURE.png`), fullPage: true });
      fs.writeFileSync(path.join(OUT, `${MODE}-FAILURE.txt`), await p.locator("body").innerText());
    } catch {
      /* ignore */
    }
  }
}

if (MODE === "journey") await guarded(async () => {
  const v0 = await view();
  check("fixture: two visits finished under v1 content, next is Besuch 3 (v4), reports exist for v1 and v2 after upgrade", v0.next.visit === "v4" && Array.isArray(v0.reports) && v0.reports.filter((r) => !r.partial).length === 2, { next: v0.next, reports: v0.reports?.map((r) => [r.visit, r.partial]) });
  check("API: no reminder outside a lesson, no pending lesson feedback at the world", v0.reminder === null && v0.lastLesson === null);

  // --- World
  await goto(p, "/family/learn?child=santiago");
  await tid("cockpit-start").waitFor();
  await settle(600);
  check("world: the screen is the illustrated world with the base, done flags for v1/v2 and the next flag on v4", (await p.locator("[data-part='base'][data-base='hut']").count()) === 1 && (await p.locator("[data-part='site'][data-state='done']").count()) === 2 && (await p.locator("[data-part='site'][data-state='next']").count()) === 1);
  check("world: exactly one dominant action names Besuch 3", (await tid("cockpit-start").innerText()).includes("Besuch 3 starten"));
  const worldText = await body();
  check("world: no delayed-check date, no retired visit, no grade or percent on the map", !/kommt am|von früher|%|Prozent/.test(worldText));
  await shot(p, "01-world");
  await goto(t, "/family/learn?child=santiago");
  await tid("cockpit-start", t).waitFor();
  await settle(600);
  await shot(t, "01-world");
  // Reopen the report of visit 1 from its flag, then reload with the URL — the report survives.
  await tid("world-site-v1").click();
  await tid("visit-report").waitFor();
  check("report: visit 1 report opens from the map flag with success/practice/next/artifact", (await tid("visit-report").getAttribute("data-report-visit")) === "v1" && (await tid("report-success").count()) === 1 && (await tid("report-next").count()) === 1 && (await tid("report-artifact").count()) === 1);
  await shot(p, "02-report-v1-from-map");
  check("report: URL carries the open report", /report=v1/.test(p.url()));
  await p.reload();
  await p.waitForLoadState("load");
  await tid("visit-report").waitFor();
  check("report: survives a reload (reopened from the URL)", (await tid("visit-report").getAttribute("data-report-visit")) === "v1");
  await p.keyboard.press("Escape");
  await settle(200);
  check("report: Escape closes the panel", (await tid("visit-report").count()) === 0);

  // --- Start Visit 3 through the real UI
  await tid("cockpit-start").click();
  await tid("start-visit").waitFor();
  check("start: the story beat is shown separately from the one start action", (await tid("story-beat").count()) >= 1 && (await tid("start-visit").innerText()).includes("Besuch 3"));
  await shot(p, "03-start");
  check("focus: the start button has focus without a click", (await activeTestId()) === "start-visit");
  await p.keyboard.press("Enter");
  await tid("mission-intro").waitFor();
  check("restore: intro as story beat; Weiter focused", (await activeTestId()) === "stage-continue");
  await shot(p, "04-restore");
  await p.keyboard.press("Enter");
  await tid("station-theme-turtles").waitFor();
  check("station choice: first theme focused for keyboard choice", (await activeTestId()) === "station-theme-turtles");
  await shot(p, "05-station-choice");
  await p.keyboard.press("Enter"); // turtles

  // --- Typing course: layout confirmed by the parent, then the alignment check through the UI (keyboard only)
  check("parent sets the Swiss-German layout", (await setLayout("ch-de-qwertz")) === 200);
  await goto(p, "/family/learn/mission?child=santiago");
  await tid("alignment-check").waitFor();
  check("alignment: the first key field is focused", (await activeTestId()) === "alignment-key-right-of-0");
  await shot(p, "06-alignment");
  await p.keyboard.type("'");
  await settle(100);
  check("alignment: typing one key moves focus to the next field (no mouse)", (await activeTestId()) === "alignment-key-right-of-l");
  await p.keyboard.type("ö");
  await settle(100);
  await p.keyboard.type("z");
  await settle(100);
  check("alignment: the submit button is focused after the last key", (await activeTestId()) === "alignment-submit");
  await p.keyboard.press("Enter");
  await tid("placement-demo").waitFor();
  check("hands: the first-use placement demonstration appears with the hand diagram", (await tid("hands-keyboard").count()) >= 1 && (await tid("demo-next").count()) === 1);
  await shot(p, "07-placement-demo");
  await goto(t, "/family/learn/mission?child=santiago");
  await tid("placement-demo", t).waitFor();
  await shot(t, "07-placement-demo");
  for (let i = 0; i < 6; i += 1) {
    if ((await tid("placement-demo").count()) === 0) break;
    check(`demo step ${i + 1}: Weiter/Los focused`, (await activeTestId()) === "demo-next");
    await p.keyboard.press("Enter");
    await settle(150);
  }
  await tid("course-input").waitFor();
  check("typing: after the demo the course input is focused, the hands show the next key f with the left index finger", (await activeTestId()) === "course-input" && (await tid("hands-keyboard").getAttribute("data-next-key")) === "f" && (await tid("hands-keyboard").getAttribute("data-next-finger")) === "L2");
  await shot(p, "08-typing-round");
  // Round 1 with a confirmed mistake on j (typed h) — keyboard only.
  await typeLine(p, "course-input", "fff hhj");
  await typeLine(p, "course-input", "fj fj jf");
  await tid("comfort-ok").waitFor();
  check("typing: after the last line the comfort choice is reachable by keyboard (focused)", (await activeTestId()) === "comfort-ok");
  await enterOn("comfort-ok");
  await tid("lesson-end").waitFor();
  const le = tid("lesson-end");
  check("UX-5a: lesson end shows the one pattern j (typed h, 2×) with the child's key and the finger correction", (await le.getAttribute("data-lesson-kind")) === "typing" && /Du:\s*h \(2×\)/.test(await le.innerText()) && /Richtig:\s*j/.test(await le.innerText()) && /Zeigefinger rechts/.test(await le.innerText()));
  check("UX-5a: a success line is evidence-backed (the clean line is named)", (await tid("lesson-success").count()) === 1 && /fj fj jf/.test(await le.innerText()));
  check("UX-5b: the repair is offered (not forced) with 'Zeigen und üben' focused and 'Heute nicht' available", (await le.getAttribute("data-repair-status")) === "available" && (await activeTestId()) === "repair-start" && (await tid("repair-skip").count()) === 1);
  await shot(p, "09-lesson-end-typing");
  await p.keyboard.press("Enter"); // Zeigen und üben → explanation (recorded first)
  await tid("repair-explain").waitFor();
  check("UX-5b: the worked example shows j with the right index finger on the hand diagram and h crossed", (await tid("visual-key").count()) === 1 && (await tid("hands-keyboard").last().getAttribute("data-next-key")) === "j");
  await shot(p, "10-repair-explain");
  check("focus: 'Jetzt tippen' focused", (await activeTestId()) === "repair-to-retry");
  await enterOn("repair-to-retry");
  await tid("retry-input").waitFor();
  check("UX-5b: retry 1 is the original line and the input is focused", (await tid("retry-line").getAttribute("data-retry-purpose")) === "correct-original" && (await activeTestId()) === "retry-input");
  await shot(p, "11-retry");
  await typeLine(p, "retry-input", "fff jjj");
  await settle(500);
  const afterRetry1 = await view();
  const repair1 = afterRetry1.lastLesson?.repair;
  check("UX-5b: retry 1 recorded separately (result correct on j), the original round untouched, no progression change", repair1 && repair1.retries.length === 1 && repair1.retries[0].result === "correct" && afterRetry1.typingCourse.burstsThisVisit.length === 1 && afterRetry1.typingCourse.decision.action === "repeat", repair1?.retries);
  await tid("retry-input").waitFor();
  check("UX-5b: retry 2 is a fresh check (another line with j)", (await tid("retry-line").getAttribute("data-retry-purpose")) === "fresh-check");
  await typeLine(p, "retry-input", "fj fj jf");
  await tid("lesson-close").waitFor();
  check("UX-5b: the loop closes as 'mit Üben korrigiert' after the bounded retries and Weiter is focused", (await tid("lesson-close").getAttribute("data-close-kind")) === "corrected-with-practice" && (await activeTestId()) === "lesson-continue");
  await shot(p, "12-lesson-closed");
  await enterOn("lesson-continue"); // acknowledge
  await tid("decision-card").waitFor();
  const v1x = await view();
  check("UX-5c: the focus on j stays OPEN after a helped retry (not retention evidence) and a reminder is shown before the next round", v1x.reminder && v1x.reminder.focusId === "typing-key:j" && (await tid("reminder").count()) === 1, v1x.reminder);
  await shot(p, "13-decision-with-reminder");
  // Round 2 (clean) → the later independent check retires the focus.
  check("focus: 'Noch eine Runde' focused on the decision card", (await activeTestId()) === "another-burst");
  await enterOn("another-burst");
  await tid("course-input").waitFor();
  await typeLine(p, "course-input", "fff jjj");
  await typeLine(p, "course-input", "fj fj jf");
  await tid("comfort-ok").waitFor();
  await enterOn("comfort-ok");
  await tid("lesson-end").waitFor();
  check("UX-5a: a clean round closes as 'none-needed' with no repair", (await tid("lesson-end").getAttribute("data-close")) === "none-needed" && (await tid("lesson-end").getAttribute("data-repair-status")) === "none-needed");
  await shot(p, "14-lesson-end-clean");
  await enterOn("lesson-continue");
  const v2x = await view();
  check("UX-5c: the j focus is retired by the later error-free round; no reminder remains", v2x.reminder === null && (await evidence()).state.feedback.focus.find((f) => f.id === "typing-key:j")?.status === "retired");
  await tid("decision-card").waitFor();
  check("typing: one good round of two needed — the server decision is repeat, no reminder on the card", (await tid("decision-card").getAttribute("data-decision")) === "repeat" && (await tid("reminder").count()) === 0);
  await enterOn("another-burst");
  await tid("course-input").waitFor();
  await typeLine(p, "course-input", "fff jjj");
  await typeLine(p, "course-input", "fj fj jf");
  await tid("comfort-ok").waitFor();
  await enterOn("comfort-ok");
  await tid("lesson-end").waitFor();
  await enterOn("lesson-continue");
  await tid("decision-card").waitFor();
  check("typing: after two good rounds the server decision is advance", (await tid("decision-card").getAttribute("data-decision")) === "advance");
  await tid("course-continue").focus();
  await p.keyboard.press("Enter");

  // --- Math with a wrong first answer → clarification → correct → lesson end with the visual
  await tid("math-answer-used").waitFor();
  check("math: the first answer field is focused on the item", (await activeTestId()) === "math-answer-used");
  await shot(p, "15-math");
  await p.keyboard.type("32");
  await p.keyboard.press("Tab");
  await p.keyboard.type("0");
  await p.keyboard.press("Enter");
  await tid("clarification").waitFor();
  const backToUsed = await activeBecomes("math-answer-used");
  check("math: after the wrong answer the clarification shows and focus returns to the first field (from the second one, within 1.5 s)", backToUsed.id === "math-answer-used", backToUsed);
  await shot(p, "16-math-clarify");
  await p.keyboard.type("30");
  await p.keyboard.press("Tab");
  await p.keyboard.type("2");
  await p.keyboard.press("Enter");
  await tid("lesson-end").waitFor();
  const mathLe = await tid("lesson-end").innerText();
  check("UX-5a math: the wrong attempt is named with the child's numbers and the correction, the visual shows the beds", /32 gepflanzt, 0 übrig/.test(mathLe) && (await tid("visual-remainder").count()) === 1 && (await tid("lesson-end").getAttribute("data-close")) === "corrected-with-help");
  await shot(p, "17-lesson-end-math");
  await goto(t, "/family/learn/mission?child=santiago");
  await tid("lesson-end", t).waitFor();
  await shot(t, "17-lesson-end-math");
  await enterOn("lesson-continue");

  // --- Explain (skip), Spanish with an unscored production, station build, log, revise, transfer, summary, reflect
  await tid("stage-skip").waitFor();
  await tid("stage-skip").click();
  await tid("language-continue-step").waitFor();
  check("language: listen step — the continue button is focused", (await activeTestId()) === "language-continue-step");
  await p.keyboard.press("Enter");
  await p.getByTestId("pick-lámpara").waitFor();
  await p.getByTestId("pick-lámpara").click();
  await tid("language-input").waitFor();
  check("language: the produce input is focused", (await activeTestId()) === "language-input");
  await p.keyboard.type("una luz por favor");
  await p.keyboard.press("Enter");
  await settle(600);
  const vLang = await view();
  check("language: a distractor answer is recorded as incorrect with the reviewed correction shown", vLang.language?.feedback?.kind === "incorrect");
  await shot(p, "18-language-feedback");
  await p.keyboard.type("necesitamos una lámpara");
  await p.keyboard.press("Enter");
  await p.getByTestId("pick-agua").waitFor();
  await p.getByTestId("pick-agua").click();
  await tid("lesson-end").waitFor();
  check("UX-5a language: segment end names the wrong word and closes as corrected with practice (second try right)", /una luz por favor/.test(await tid("lesson-end").innerText()) && (await tid("lesson-end").getAttribute("data-close")) === "corrected-with-practice");
  await shot(p, "19-lesson-end-language");
  await enterOn("lesson-continue");
  await tid("station-spot-rocks").waitFor();
  await tid("station-spot-rocks").click();
  await tid("log-input").waitFor();
  check("log: the textarea is focused", (await activeTestId()) === "log-input");
  await p.keyboard.type("Die Station steht auf den Felsen und2 Setzlinge sind übrig.");
  await tid("log-save").click();
  await tid("revise-input").waitFor();
  await shot(p, "20-revise");
  await tid("revise-input").fill("Die Station steht auf den Felsen und 2 Setzlinge sind übrig.");
  await tid("revise-save").click();
  await tid("transfer-input").waitFor();
  await tid("transfer-input").fill("Morgen zählt die Station 3 Schildkröten.");
  await tid("transfer-save").click();
  await tid("lesson-end").waitFor();
  check("UX-5a writing: the spacing lesson closes as corrected with practice (revision + clean transfer)", (await tid("lesson-end").getAttribute("data-lesson-kind")) === "writing" && (await tid("lesson-end").getAttribute("data-close")) === "corrected-with-practice");
  await shot(p, "21-lesson-end-writing");
  await enterOn("lesson-continue");
  await tid("summary").waitFor();
  await shot(p, "22-summary-stage");
  await tid("summary-next-button").click();
  await tid("reflect").waitFor();
  await tid("difficulty-right").click();
  await tid("enjoyment-yes").click();
  await tid("clarity-clear").click();
  await tid("reflect-submit").click();
  await tid("visit-report").waitFor();
  const rep = tid("visit-report");
  check("UX-5 report: the completed visit leads directly to the report (not partial), with success, practice, next step, artifact and world changes", (await rep.getAttribute("data-report-visit")) === "v4" && (await rep.getAttribute("data-report-partial")) === "false" && (await tid("report-world").count()) === 1 && (await tid("report-lesson").count()) >= 4);
  check("report: focus is on 'Zur Karte'", (await activeTestId()) === "report-back");
  await shot(p, "23-report-after-visit", { full: true });
  await goto(t, p.url().replace(BASE, ""));
  await tid("visit-report", t).waitFor();
  await shot(t, "23-report-after-visit", { full: true });
  check("report: the URL carries the report so a reload shows it again", /report=v4/.test(p.url()));
  await p.reload();
  await p.waitForLoadState("load");
  await tid("visit-report").waitFor();
  check("report: after a reload of the mission page the report is still shown", (await rep.getAttribute("data-report-visit")) === "v4");
  await tid("report-back").click();
  await tid("cockpit-start").waitFor().catch(() => null);
  await settle(600);
  check("world after the visit: three done flags, the station with its lamp built on the rocks, five station beds and leftovers", (await p.locator("[data-part='site'][data-state='done']").count()) === 3 && (await p.locator("[data-part='station'][data-lamp='on']").count()) === 1 && (await p.locator("[data-part='station-beds']").count()) === 1 && (await p.locator("[data-part='leftovers']").count()) === 1);
  await shot(p, "24-world-after");
  await goto(t, "/family/learn?child=santiago");
  await settle(600);
  await shot(t, "24-world-after");
  await tid("world-site-v4").click();
  await tid("visit-report").waitFor();
  check("report: reopens from the v4 flag on the map after navigation", (await tid("visit-report").getAttribute("data-report-visit")) === "v4");
  // Parent evidence matches the child report.
  const ev = await evidence();
  const completion = ev.completions.find((c) => c.visitId === "v4");
  check("parent: one review for the v4 completion identity carrying the same child summary and the lessons", completion && completion.review && completion.review.learning.childSummary.next.text === (await view()).reports.find((r) => r.visit === "v4").summary.next.text && Array.isArray(completion.review.learning.lessons) && completion.review.learning.lessons.length >= 4);
  check("parent: typing retries are separate samples (kind typing_retry), rounds unchanged (3 bursts)", ev.samples.filter((s) => s.kind === "typing_retry").length === 2 && ev.samples.filter((s) => s.kind === "typing_burst").length === 3);
  check("no browser page errors", pageErrors.length === 0, pageErrors.slice(0, 3));
});

// ---------------------------------------------------------------------------
// fixtures — the six UX-5 fixtures (API + browser), reload/duplicate recovery, early exit
// ---------------------------------------------------------------------------
if (MODE === "fixtures") await guarded(async () => {
  const v0 = await view();
  check("fixture: two visits finished, next v4", v0.next.visit === "v4");
  await op({ op: "start-visit" });
  await op({ op: "resume-base" });
  await op({ op: "choose-station", theme: "waves" });
  check("parent sets the Swiss-German layout", (await setLayout("ch-de-qwertz")) === 200);
  await op({ op: "typing-check", observed: CH_ALIGNMENT });
  // F1 correct lesson: no mistakes → none-needed, no repair, no focus.
  const r1 = await op({ op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["fff jjj", "fj fj jf"], seconds: 20, comfort: "easy" });
  const f1 = r1.view.lastLesson;
  check("F1 correct lesson: lesson end with success, no mistakes, repair none-needed, close none-needed, no focus opened", f1 && f1.mistakes.length === 0 && f1.repair.status === "none-needed" && f1.close.kind === "none-needed" && f1.success !== null && (await evidence()).state.feedback.focus.length === 0, f1 && { close: f1.close, success: f1.success });
  await op({ op: "lesson-feedback-seen", id: f1.id });
  check("F1: after acknowledging, no pending lesson feedback", (await view()).lastLesson === null);
  // F2 confirmed mistake corrected after help: j→h twice, explain, retry original clean, fresh check clean → corrected-with-practice; focus stays open.
  const r2 = await op({ op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["fff hhj", "fj fj jf"], seconds: 20, comfort: "ok" });
  const f2 = r2.view.lastLesson;
  check("F2: the pattern is j (2×, typed h), repair available with 2 retry items (original + fresh), focus typing-key:j open, no reminder while the feedback is pending", f2 && f2.pattern?.id === "key:j" && f2.pattern.count === 2 && f2.repair.status === "available" && f2.repair.items.length === 2 && r2.view.reminder === null && (await evidence()).state.feedback.focus.find((f) => f.id === "typing-key:j")?.status === "open", f2 && { pattern: f2.pattern, items: f2.repair.items.map((i) => i.purpose), reminder: r2.view.reminder });
  // Retry before the worked example is refused.
  const early = await opRaw({ op: "typing-retry", repairId: f2.repair.repairId, retryNo: 1, lineIndex: f2.repair.items[0].lineIndex, typed: "fff jjj", seconds: 5 }, `w-fx-early-${Date.now()}`);
  check("F2: a retry before the recorded worked example is refused (help is recorded before it is shown)", early.status === 422 && early.json.code === "not-allowed", early.json?.message);
  await op({ op: "repair-explain", repairId: f2.repair.repairId });
  const ex2 = await op({ op: "repair-explain", repairId: f2.repair.repairId });
  check("F2: recording the worked example twice is idempotent (one mini_lesson support event)", ex2.result.repeated === true && (await evidence()).supports.filter((s) => s.kind === "mini_lesson").length === 1);
  const retryKey = `w-fx-retry1-${Date.now()}`;
  const rt1 = await op({ op: "typing-retry", repairId: f2.repair.repairId, retryNo: 1, lineIndex: f2.repair.items[0].lineIndex, typed: "fff jjj", seconds: 6 }, retryKey);
  const rt1again = await op({ op: "typing-retry", repairId: f2.repair.repairId, retryNo: 1, lineIndex: f2.repair.items[0].lineIndex, typed: "fff jjj", seconds: 6 }, retryKey);
  check("F2: the same retry key replays (no second retry row); a duplicate with a new key is refused as stale", rt1again.status === "replayed" && rt1.view.lastLesson.repair.retries.length === 1 && (await opRaw({ op: "typing-retry", repairId: f2.repair.repairId, retryNo: 1, lineIndex: f2.repair.items[0].lineIndex, typed: "fff jjj", seconds: 6 }, `w-fx-dup-${Date.now()}`)).json.code === "stale");
  await op({ op: "typing-retry", repairId: f2.repair.repairId, retryNo: 2, lineIndex: f2.repair.items[1].lineIndex, typed: "fj fj jf", seconds: 6 });
  const over = await opRaw({ op: "typing-retry", repairId: f2.repair.repairId, retryNo: 3, lineIndex: f2.repair.items[0].lineIndex, typed: "fff jjj", seconds: 6 }, `w-fx-over-${Date.now()}`);
  check("F2: the loop is bounded — a third retry beyond the items is refused", over.status === 422, over.json?.message);
  const closed = await op({ op: "repair-close", repairId: f2.repair.repairId, reason: "done" });
  check("F2: close → corrected-with-practice; first attempt (the round) preserved with its errors; retries separate; focus still open (helped retry is not retention evidence)", closed.result.outcome === "corrected-with-practice" && closed.view.lastLesson.close.kind === "corrected-with-practice" && closed.view.typingCourse.burstsThisVisit.length === 2 && (await evidence()).state.typing.course.bursts[1].errors.length === 2 && (await evidence()).state.feedback.focus.find((f) => f.id === "typing-key:j")?.status === "open", closed.view.lastLesson.close);
  await op({ op: "lesson-feedback-seen", id: f2.id });
  const vAfter2 = await view();
  check("F2 → UX-5c: the reminder for j is shown before the next typing round, grounded in the recorded round", vAfter2.reminder?.focusId === "typing-key:j" && /h/.test(vAfter2.reminder.grounding) && /Zeigefinger rechts/.test(vAfter2.reminder.cue), vAfter2.reminder);
  // F3 still unresolved after the bounded retry: k→l twice on lesson 2 is not possible before advance; use the same lesson with d? Lesson 1 only has f/j/space → mistake on f (typed d), retries still wrong.
  const r3 = await op({ op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["ddd jjj", "fj fj jf"], seconds: 20, comfort: "hard" });
  const f3 = r3.view.lastLesson;
  check("F3: pattern f (3×, typed d); the round also retires nothing on j? (j clean here → j focus retired by this later full round)", f3?.pattern?.id === "key:f" && (await evidence()).state.feedback.focus.find((f) => f.id === "typing-key:j")?.status === "retired" && (await evidence()).state.feedback.focus.find((f) => f.id === "typing-key:f")?.status === "open", f3?.pattern);
  await op({ op: "repair-explain", repairId: f3.repair.repairId });
  await op({ op: "typing-retry", repairId: f3.repair.repairId, retryNo: 1, lineIndex: f3.repair.items[0].lineIndex, typed: "ddd jjj", seconds: 6 });
  await op({ op: "typing-retry", repairId: f3.repair.repairId, retryNo: 2, lineIndex: f3.repair.items[1].lineIndex, typed: "dj fj jf", seconds: 6 });
  const closed3 = await op({ op: "repair-close", repairId: f3.repair.repairId, reason: "done" });
  check("F3 still unresolved: close → practice-again (never inferred mastery); focus f stays open", closed3.result.outcome === "practice-again" && closed3.view.lastLesson.close.kind === "practice-again" && (await evidence()).state.feedback.focus.find((f) => f.id === "typing-key:f")?.status === "open");
  await op({ op: "lesson-feedback-seen", id: f3.id });
  const vAfter3 = await view();
  check("F3 → UX-5c: exactly one reminder (the most recent open relevant focus, f), never two", vAfter3.reminder?.focusId === "typing-key:f");
  // A skipped repair: the child moves on without retries → skipped, focus open.
  const r3b = await op({ op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["fff jjj", "fj fj jd"], seconds: 20, comfort: "ok" });
  const f3b = r3b.view.lastLesson;
  check("skip: a round with a single f mistake offers the repair; acknowledging without practice closes it as skipped", f3b?.pattern?.id === "key:f" && f3b.repair.status === "available");
  await op({ op: "lesson-feedback-seen", id: f3b.id });
  check("skip: the repair is recorded as skipped (not failed), focus f open", (await evidence()).state.feedback.repairs.find((r) => r.id === f3b.id)?.outcome === "skipped" && (await evidence()).state.feedback.focus.find((f) => f.id === "typing-key:f")?.status === "open");
  await op({ op: "typing-course-continue" });
  // F4 ambiguous / unscored: a non-numeric spoken transcript on the math item, then the right answer.
  const r4a = await op({ op: "answer-remainder", itemId: "EQ-STATION", used: null, remaining: null, raw: "dreissig und so", modality: "spoken", uncertain: true });
  check("F4: an uncertain transcript is unscored (no clarification, no wrong attempt)", r4a.result.correct === null && r4a.view.math?.phase === "answer" && r4a.view.math.attemptNo === 2);
  const r4 = await op({ op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" });
  const f4 = r4.view.lastLesson;
  check("F4: lesson end lists the unscored attempt apart (never a mistake); the later correct answer keeps its recorded evidence (independent, not 'first attempt'); close is none-needed", f4 && f4.mistakes.length === 0 && f4.unscored.length === 1 && /dreissig/.test(f4.unscored[0].given) && f4.close.kind === "none-needed" && f4.success && /ohne Hilfe/.test(f4.success.text) && !/ersten Versuch/.test(f4.success.text), f4 && { unscored: f4.unscored, success: f4.success });
  check("F4: no math focus opened by an unscored attempt", !(await evidence()).state.feedback.focus.some((f) => f.kind === "math"));
  await op({ op: "lesson-feedback-seen", id: f4.id });
  // F5 early exit: Stopp in the middle → the world shows an honest partial recap, no completion, no report claims completion.
  const vMid = await view();
  check("F5 early exit: the view carries a PARTIAL report for the running visit (stagesDone < stageCount, finishedAt null) and no completion row", vMid.reports.find((r) => r.visit === "v4")?.partial === true && vMid.reports.find((r) => r.visit === "v4").finishedAt === null && (await evidence()).completions.filter((c) => c.visitId === "v4").length === 0);
  await goto(p, "/family/learn?child=santiago");
  await tid("cockpit-start").waitFor();
  check("F5: the world shows the running flag with progress and the 'Zwischenstand' action; the dominant action is Weiter", (await p.locator("[data-part='site'][data-state='running']").count()) === 1 && (await tid("world-partial").count()) === 1 && (await tid("cockpit-start").innerText()).includes("Weiter"));
  await tid("world-partial").click();
  await tid("visit-report").waitFor();
  check("F5: the partial recap is labelled Zwischenstand, never a completed report, and lists the lessons so far", (await tid("visit-report").getAttribute("data-report-partial")) === "true" && /Zwischenstand/.test(await body()) && (await tid("report-lesson").count()) >= 4);
  await shot(p, "F5-partial-recap", { full: true });
  await p.keyboard.press("Escape");
  // F6 reminders: relevant (typing f) only before typing; omitted on math/Spanish; retired after a later clean round.
  const vExplain = await view();
  check("F6 omitted: on the explain stage no reminder is injected", vExplain.visit?.stage === "explain" && vExplain.reminder === null);
  await op({ op: "skip-stage", stage: "explain", reason: "child" });
  const vEs = await view();
  check("F6 omitted: on the Spanish segment no typing reminder appears (no language focus exists)", vEs.visit?.stage === "LANG-ES-STATION" && vEs.reminder === null);
  // Reload/stale/duplicate recovery around the lesson feedback acknowledgement.
  const stale = await opRaw({ op: "lesson-feedback-seen", id: "typing:TYPE-CH-COURSE-1@nonexistent" }, `w-fx-stale-${Date.now()}`);
  check("recovery: acknowledging a lesson that is not pending is refused, nothing changes", stale.status === 422);
  const vReload = await view();
  check("recovery: the view re-read after refusals is unchanged (same revision, same stage)", vReload.revision === vEs.revision && vReload.visit.stage === vEs.visit.stage);
  // Child isolation: Isabel has no mission and sees nothing of Santiago's reports.
  const isabelBearer = (await api("POST", "/api/family/learning/session", { childId: "isabel" })).json?.token;
  const isabelView = isabelBearer ? await api("GET", "/api/family/learning/mission", null, assistant, isabelBearer) : { status: 0, json: null };
  check("isolation: Isabel's credential yields the honest not-prepared answer, never Santiago's reports", isabelView.status === 200 && isabelView.json.prepared === false && isabelView.json.view === null, isabelView.status);
  await goto(p, "/family/learn?child=isabel");
  await settle(500);
  check("isolation: Isabel's screen is the not-prepared state", /noch nicht vorbereitet/.test(await body()));
  await shot(p, "F6-isabel");
  check("no browser page errors", pageErrors.length === 0, pageErrors.slice(0, 3));
});

await browser.close();
const summary = { mode: MODE, base: BASE, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results, screenshots: shots, pageErrors };
fs.writeFileSync(path.join(OUT, `${MODE}-results.json`), JSON.stringify(summary, null, 2));
console.log(`\n${MODE}: ${summary.passed} passed, ${summary.failed} failed → ${OUT}`);
process.exit(summary.failed === 0 ? 0 : 1);
