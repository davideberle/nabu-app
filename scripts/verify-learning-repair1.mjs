// Independent repair round 1 (2026-10-03) — browser + HTTP evidence for F1–F4, the
// reload / failed-save / replay windows of the repair loop, keyboard recovery and the
// target-size renders the visual round asked for. LOCAL production server, synthetic
// AUTH_SECRET, isolated NABU_DB_DIR; headless Chromium with the project audio guard.
//
//   AUTH_SECRET=<server secret> node scripts/verify-learning-repair1.mjs --base http://127.0.0.1:3172 \
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
const OUT = opt("--out", "/tmp/family-learning-repair1");
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
  console.log(ok ? "PASS" : "FAIL", "[repair1]", name, detail === undefined ? "" : JSON.stringify(detail).slice(0, 400));
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
async function op(o, key = `r1-${(opN += 1)}`) {
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
  const file = `repair1-${name}${page === t ? "-tablet" : ""}.png`;
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
      await p.screenshot({ path: path.join(OUT, `repair1-FAILURE-${name}.png`), fullPage: true });
      fs.writeFileSync(path.join(OUT, `repair1-FAILURE-${name}.txt`), await p.locator("body").innerText());
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// S1 — F1 (spoken spacing), F4 (ambiguous language), F2 writing repair through the keyboard, the report renders
// ---------------------------------------------------------------------------
await guarded("S1", async () => {
  const v0 = await view();
  check("fixture: two visits finished, next v4", v0.next.visit === "v4");
  await toTypingCourse();
  await op({ op: "typing-course-continue" });
  await op({ op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" });
  await ack();
  await op({ op: "skip-stage", stage: "explain", reason: "child" });
  // F4: wrong pick → right pick → unscored production → continue → right reuse
  for (const o of [lang("LANG-ES-STATION", "listen", "", "listen"), lang("LANG-ES-STATION", "pick", "agua", "word-choice"), lang("LANG-ES-STATION", "pick", "lámpara", "word-choice"), lang("LANG-ES-STATION", "produce", "xxxxxxxx"), { op: "language-continue", segmentId: "LANG-ES-STATION", stepId: "produce" }]) await op(o);
  const f4 = (await op(lang("LANG-ES-STATION", "reuse", "agua", "word-choice"))).view.lastLesson;
  check("F4: retries are the same-item pick (correct) and the reuse fresh check (correct); the unscored production is listed apart and never an incorrect retry", f4 && JSON.stringify(f4.repair.retries.map((r) => [r.item, r.purpose, r.result])) === JSON.stringify([["LANG-ES-STATION/pick", "correct-original", "correct"], ["LANG-ES-STATION/reuse", "fresh-check", "correct"]]) && f4.unscored.length === 1 && f4.close.kind === "corrected-with-practice", f4 && { retries: f4.repair.retries, unscored: f4.unscored.map((m) => m.given) });
  await ack();
  await op({ op: "build-station", spot: "rocks" });
  await op({ op: "save-log", text: "Heute steht die Station." });
  await op({ op: "revise-log", text: "Heute steht die Station." });
  // F1: a spoken transfer — unscored everywhere
  const f1 = (await op({ op: "write-transfer", text: "Morgen zählt sie3 Schildkröten.", modality: "spoken" })).view.lastLesson;
  const ev1 = await evidence();
  check("F1: spoken sie3 is unscored in the attempt row, listed apart in the lesson end, no mistake, no repair, close unscored, no spacing focus, parent evidence agrees", f1 && f1.mistakes.length === 0 && f1.unscored.length === 1 && f1.repair.status === "none-needed" && f1.close.kind === "unscored" && ev1.state.feedback.focus.every((f) => f.kind !== "spacing") && ev1.attempts.find((a) => a.taskId === "WRITE-TRANSFER-1")?.evidence === "unscored", f1 && { unscored: f1.unscored, focus: ev1.state.feedback.focus });
  // Reset and redo the writing with a TYPED flagged transfer through the UI (F2) — keyboard only from the transfer field.
  await resetTwoVisits();
  await toTypingCourse();
  await op({ op: "typing-course-continue" });
  await op({ op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" });
  await ack();
  await op({ op: "skip-stage", stage: "explain", reason: "child" });
  await op({ op: "skip-stage", stage: "LANG-ES-STATION", reason: "child" });
  await op({ op: "build-station", spot: "rocks" });
  await op({ op: "save-log", text: "Heute steht die Station." });
  await op({ op: "revise-log", text: "Heute steht die Station." });
  await goto(p, "/family/learn/mission?child=santiago");
  await tid("transfer-input").waitFor();
  check("focus: the transfer field is focused", (await activeTestId()) === "transfer-input");
  await p.keyboard.type("Morgen zählt sie3 Schildkröten.");
  await tid("transfer-save").click();
  await tid("lesson-end").waitFor();
  const le = tid("lesson-end");
  check("F2 writing: the first typed transfer error is offered a repair (available, kind writing), it is NOT a retry", (await le.getAttribute("data-repair-status")) === "available" && (await le.getAttribute("data-repair-kind")) === "writing" && (await tid("repair-retries").count()) === 0 && (await activeTestId()) === "repair-start");
  await shot(p, "F2-writing-offer");
  await p.keyboard.press("Enter"); // Zeigen und üben → example recorded first
  await tid("repair-explain").waitFor();
  check("F2 writing: the worked example shows the marked sentence; the server recorded it before it was shown", (await tid("visual-spacing").count()) === 1 && (await view()).lastLesson.repair.explanation.recorded === true);
  await shot(p, "F2-writing-explain");
  await enterOn("repair-to-retry");
  await tid("retry-sentence").waitFor();
  check("F2 writing: the correction field holds the child's own sentence and is focused", (await tid("retry-sentence").inputValue()) === "Morgen zählt sie3 Schildkröten." && (await activeTestId()) === "retry-sentence");
  await shot(p, "F2-writing-retry");
  await p.keyboard.press("Control+A");
  await p.keyboard.press("Meta+A");
  await p.keyboard.type("Morgen zählt sie 3 Schildkröten.");
  await p.keyboard.press("Enter");
  await tid("lesson-close").waitFor();
  check("F2 writing: the corrected sentence closes the repair as corrected with practice (server-confirmed), Weiter focused", (await tid("lesson-close").getAttribute("data-close-kind")) === "corrected-with-practice" && (await activeTestId()) === "lesson-continue");
  const ev2 = await evidence();
  check("F2 writing: original transfer preserved as flagged; one writing_retry sample; mini_lesson support recorded; spacing focus open (helped)", ev2.samples.some((s) => s.kind === "writing_transfer" && /sie3/.test(s.text)) && ev2.samples.filter((s) => s.kind === "writing_retry").length === 1 && ev2.supports.some((s) => s.kind === "mini_lesson") && ev2.state.feedback.focus.find((f) => f.id === "spacing:rule")?.status === "open");
  await shot(p, "F2-writing-closed");
  await enterOn("lesson-continue");
  await tid("summary").waitFor();
  await tid("summary-next-button").click();
  await tid("reflect").waitFor();
  await tid("difficulty-right").click();
  await tid("enjoyment-yes").click();
  await tid("clarity-clear").click();
  await tid("reflect-submit").click();
  await tid("visit-report").waitFor();
  check("report: top view has strength / practice / next, the world change block and the map action; lessons folded in details", (await tid("report-success").count()) === 1 && (await tid("report-world").count()) === 1 && (await inViewport(tid("report-back"))) && (await p.locator("details[data-testid='report-lessons']").getAttribute("open")) === null);
  await shot(p, "report-top-desktop");
  await shot(p, "report-full-desktop", { full: true });
  await goto(t, p.url().replace(BASE, ""));
  await tid("visit-report", t).waitFor();
  await shot(t, "report-top");
  await tid("report-back").click();
  await tid("cockpit-start").waitFor().catch(() => null);
  await settle(600);
  await shot(p, "world-after-desktop");
  await tid("world-site-v4").click();
  await tid("visit-report").waitFor();
  check("report: reopens from the map flag in the drawer, heading at the top", (await tid("visit-report").getAttribute("data-report-visit")) === "v4" && (await inViewport(p.locator("#report-title"))));
  await shot(p, "report-reopen-drawer");
  await p.keyboard.press("Escape");
});

// ---------------------------------------------------------------------------
// S2 — F3: failed save / failed close / reload windows of the typing repair, keyboard recovery; compact cue fit; hands states
// ---------------------------------------------------------------------------
await guarded("S2", async () => {
  await resetTwoVisits();
  await toTypingCourse();
  await goto(p, "/family/learn/mission?child=santiago");
  // skip the first-use demo quickly through the keyboard
  for (let i = 0; i < 6; i += 1) {
    if ((await tid("placement-demo").count()) === 0) break;
    await enterOn("demo-next");
    await settle(120);
  }
  await tid("course-input").waitFor();
  check("V2: in routine practice the cue is COMPACT and prompt, input, cue and controls fit the 900 px viewport", (await tid("hands-keyboard").getAttribute("data-compact")) === "true" && (await inViewport(tid("course-commit"))) && (await inViewport(tid("course-enough"))) && (await inViewport(tid("course-line"))));
  await shot(p, "V2-typing-compact");
  // space state: after "fff" the next key is the space bar
  await p.keyboard.type("fff", { delay: 15 });
  await settle(150);
  check("V2 hands: after fff the next key is the space bar with the thumb", (await tid("hands-keyboard").getAttribute("data-next-key")) === " " && (await p.locator("[data-finger='L1'][data-active='true'], [data-finger='R1'][data-active='true']").count()) >= 1);
  await shot(p, "V2-hands-space");
  await p.keyboard.type(" hhj", { delay: 15 });
  await p.keyboard.press("Enter");
  await typeLine(p, "course-input", "fj fj jf");
  await tid("comfort-ok").waitFor();
  await enterOn("comfort-ok");
  await tid("lesson-end").waitFor();
  check("V4: the lesson end defaults to one headline, one correction, one offer; evidence details are folded", (await tid("lesson-pattern").count()) === 1 && (await tid("repair-offer").count()) === 1 && (await p.locator("details[data-testid='lesson-details']").getAttribute("open")) === null && (await inViewport(tid("repair-start"))));
  await shot(p, "V4-lesson-end-typing");
  // failed close in the offer: "Heute nicht" with the close aborted → error notice, controls stay
  blocked.add("repair-close");
  await tid("repair-skip").click();
  await tid("retry-notice").waitFor();
  check("F3: a failed close keeps the offer on screen with an error notice (no forced closed UI)", (await tid("retry-notice").getAttribute("data-notice-kind")) === "error" && (await tid("repair-skip").count()) === 1 && (await tid("lesson-close").count()) === 0);
  blocked.delete("repair-close");
  await shot(p, "F3-failed-close");
  await enterOn("repair-start");
  await tid("repair-explain").waitFor();
  await enterOn("repair-to-retry");
  await tid("retry-input").waitFor();
  check("V2 retry: the compact hands cue sits under the retry line and the commit control fits the viewport", (await tid("hands-keyboard").last().getAttribute("data-compact")) === "true" && (await inViewport(tid("retry-commit"))));
  await shot(p, "V2-retry-compact");
  // failed save of retry 1 → error, same key reused on the next Fertig
  blocked.add("typing-retry");
  await typeLine(p, "retry-input", "fff jjj");
  await tid("retry-notice").waitFor();
  check("F3: a failed retry save keeps the retry line and shows an actionable error", (await tid("retry-notice").getAttribute("data-notice-kind")) === "error" && (await tid("retry-input").count()) === 1 && (await tid("retry-input").inputValue()) === "fff jjj");
  blocked.delete("typing-retry");
  await tid("retry-commit").focus();
  await p.keyboard.press("Enter");
  await settle(800);
  const afterR1 = await view();
  check("F3: the retried save lands exactly once (one retry, one sample)", afterR1.lastLesson.repair.retries.length === 1 && (await evidence()).samples.filter((s) => s.kind === "typing_retry").length === 1);
  // reload between retry 1 and retry 2: lands on retry 2 with the input focused
  await p.reload();
  await p.waitForLoadState("load");
  await tid("retry-input").waitFor();
  check("F3: after a reload the open repair resumes at retry 2 (fresh check) with the input focused", (await tid("retry-line").getAttribute("data-retry-no")) === "2" && (await activeTestId()) === "retry-input");
  // the last retry closes in the same write → closed UI only after the confirmed save
  await typeLine(p, "retry-input", "fj fj jf");
  await tid("lesson-close").waitFor();
  check("F3: the last retry closes the repair in one write; the UI shows the confirmed close with Weiter focused", (await tid("lesson-close").getAttribute("data-close-kind")) === "corrected-with-practice" && (await activeTestId()) === "lesson-continue" && (await view()).lastLesson.repair.status === "closed");
  // legacy candidate-1 row: open with all items used and no close → the UI still offers a finish control
  if (DB) {
    const c = createClient({ url: "file:" + DB });
    for (let attempt = 0; ; attempt += 1) {
      try {
        const row = (await c.execute("SELECT state_json FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0];
        const state = JSON.parse(String(row.state_json));
        state.feedback.repairs[0].outcome = "open";
        state.feedback.repairs[0].closedAt = null;
        await c.execute({ sql: "UPDATE family_learning_missions SET state_json = ? WHERE child_id = 'santiago'", args: [JSON.stringify(state)] });
        break;
      } catch (e) {
        if (!/SQLITE_BUSY/.test(String(e)) || attempt >= 50) throw e;
        await settle(100);
      }
    }
    c.close();
    await p.reload();
    await p.waitForLoadState("load");
    await tid("repair-exhausted").waitFor();
    check("F3 legacy: an open repair with nothing left shows Abschliessen (focused); Enter closes it honestly", (await activeTestId()) === "repair-finish");
    await shot(p, "F3-exhausted-finish");
    await p.keyboard.press("Enter");
    await tid("lesson-close").waitFor();
    check("F3 legacy: closed as corrected with practice from the recorded retries", (await tid("lesson-close").getAttribute("data-close-kind")) === "corrected-with-practice");
  }
  await enterOn("lesson-continue");
  await tid("decision-card").waitFor();
  check("V4 reminder: the cue is short by default, provenance behind a detail", (await tid("reminder").count()) === 1 && (await p.locator("[data-testid='reminder'] details").getAttribute("open")) === null);
  await shot(p, "V4-reminder-compact");
  // Hands reach states: advance the course to lesson 5 through the API (two good rounds per lesson), then render g and h.
  for (const lessonId of ["TYPE-CH-COURSE-1", "TYPE-CH-COURSE-2", "TYPE-CH-COURSE-3", "TYPE-CH-COURSE-4"]) {
    const lines = { "TYPE-CH-COURSE-1": ["fff jjj", "fj fj jf"], "TYPE-CH-COURSE-2": ["ddd kkk", "fdk jkd"], "TYPE-CH-COURSE-3": ["sss lll", "sdf jkl"], "TYPE-CH-COURSE-4": ["aaa ööö", "asdf jklö"] }[lessonId];
    for (let i = 0; i < 2; i += 1) {
      const v = await view();
      if (v.typingCourse?.lesson?.id !== lessonId) break;
      await op({ op: "typing-burst", lessonId, lines, seconds: 15, comfort: "ok" });
      await ack();
    }
  }
  const v5 = await view();
  check("hands: the course reached lesson 5 (g and h)", v5.typingCourse?.lesson?.id === "TYPE-CH-COURSE-5", v5.typingCourse?.lesson?.id);
  await goto(p, "/family/learn/mission?child=santiago");
  if ((await tid("decision-card").count()) > 0) await enterOn("another-burst");
  await tid("course-input").waitFor();
  check("hands: the first key of lesson 5 is g — the diagram shows the f→g reach and the way back, and the instruction names the return to f", (await tid("hands-keyboard").getAttribute("data-next-key")) === "g" && (await tid("hands-keyboard").getAttribute("data-reach")) === "f->g" && (await p.locator("[data-reach-arrow='f->g']").count()) === 1 && /zurück auf „f“/.test(await body()));
  check("V2 fit: on the reach lesson too, prompt, line, input, cue and controls fit the 900 px desktop viewport", (await inViewport(tid("course-commit"))) && (await inViewport(tid("course-enough"))));
  await shot(p, "V2-hands-reach-g");
  await p.keyboard.type("ggg ", { delay: 15 });
  await settle(150);
  check("hands: after ggg and the space the next key is h with the j→h reach and the return to j named", (await tid("hands-keyboard").getAttribute("data-next-key")) === "h" && (await tid("hands-keyboard").getAttribute("data-reach")) === "j->h" && /zurück auf „j“/.test(await body()) && (await inViewport(tid("course-commit"))));
  await shot(p, "V2-hands-reach-h");
  await goto(t, "/family/learn/mission?child=santiago");
  if ((await tid("placement-demo", t).count()) > 0) await tid("demo-skip", t).click();
  if ((await tid("decision-card", t).count()) > 0) await tid("another-burst", t).click();
  await tid("placement-demo", t).count();
  await shot(t, "V2-typing-compact");
});

// ---------------------------------------------------------------------------
// S3 — tablet math task (hierarchy), label repair through the keyboard, language repair at a terminal wrong pick
// ---------------------------------------------------------------------------
await guarded("S3", async () => {
  await resetTwoVisits();
  await toTypingCourse("waves");
  await op({ op: "typing-course-continue" });
  await goto(t, "/family/learn/mission?child=santiago");
  await tid("math-question", t).waitFor();
  check("V3 math (tablet): setup and question are separated by hierarchy; no world strip in focused work; location cue present", (await tid("math-setup", t).count()) === 1 && (await tid("math-question", t).innerText()).endsWith("?") && (await t.locator("[data-world-variant='strip']").count()) === 0 && (await tid("hud-location", t).count()) === 1);
  await shot(t, "V3-math-task");
  await goto(p, "/family/learn/mission?child=santiago");
  await tid("math-question").waitFor();
  await shot(p, "V3-math-task");
  // language: reuse pick wrong twice through the UI → terminal error → repair with the same pick (keyboard: Enter on the focused first option would be wrong; choose agua)
  await op({ op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" });
  await ack();
  await op({ op: "skip-stage", stage: "explain", reason: "child" });
  for (const o of [lang("LANG-ES-STATION", "listen", "", "listen"), lang("LANG-ES-STATION", "pick", "lámpara", "word-choice"), lang("LANG-ES-STATION", "produce", "necesitamos una lámpara"), lang("LANG-ES-STATION", "reuse", "herramientas", "word-choice")]) await op(o);
  await goto(p, "/family/learn/mission?child=santiago");
  await tid("pick-semillas").waitFor();
  await tid("pick-semillas").click(); // second wrong pick → segment ends with the reuse step still wrong
  await tid("lesson-end").waitFor();
  check("F2 language: a pick still wrong after its two tries offers the same pick as a repair; the in-loop second try is listed as the one incorrect retry", (await tid("lesson-end").getAttribute("data-repair-kind")) === "language" && (await tid("lesson-end").getAttribute("data-repair-status")) === "available" && (await activeTestId()) === "repair-start");
  await shot(p, "F2-language-offer");
  await p.keyboard.press("Enter");
  await tid("repair-explain").waitFor();
  check("F2 language: the worked example is the word with its gloss", (await tid("visual-word").count()) === 1);
  await enterOn("repair-to-retry");
  await tid("retry-pick-agua").waitFor();
  check("F2 language: the retry shows the reviewed options again; the first option is focused for keyboard choice", (await activeTestId()) === "retry-pick-agua" || /^retry-pick-/.test((await activeTestId()) ?? ""));
  await shot(p, "F2-language-retry");
  await tid("retry-pick-agua").click();
  await tid("lesson-close").waitFor();
  const ev3 = await evidence();
  check("F2 language: closed as corrected with practice; the retry is a language_retry sample, NOT a language record; the focus for agua stays open (helped)", (await tid("lesson-close").getAttribute("data-close-kind")) === "corrected-with-practice" && ev3.samples.filter((s) => s.kind === "language_retry").length === 1 && ev3.state.language["LANG-ES-STATION"].records.filter((r) => r.stepId === "reuse").length === 2 && ev3.state.feedback.focus.find((f) => f.id === "language:es:agua")?.status === "open");
  await enterOn("lesson-continue");
  // label repair on a fresh child (visit 1): the label typed wrong → offer → keyboard retry → closed
  await api("DELETE", "/api/family/learning/parent/records?child=santiago&confirm=santiago", null, owner);
  bearer = (await api("POST", "/api/family/learning/session", { childId: "santiago" })).json?.token;
  for (const o of [{ op: "start-visit" }, { op: "name-base", name: "Sonnenküste" }, { op: "place-base", locationId: "shore" }, { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }]) await op(o);
  await ack();
  await op({ op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" });
  await ack();
  await op({ op: "explain", text: "Ich habe geteilt.", modality: "typed" });
  await op({ op: "skip-stage", stage: "LANG-EN-WATER", reason: "child" });
  await goto(p, "/family/learn/mission?child=santiago");
  await tid("label-input").waitFor();
  check("label: the label field is focused (no layout confirmed → no lesson, the label is the task)", (await activeTestId()) === "label-input");
  await p.keyboard.type("Sonenküste");
  await p.keyboard.press("Enter");
  await tid("lesson-end").waitFor();
  check("F2 label: a label written wrong offers its own repair (kind label) with the target shown", (await tid("lesson-end").getAttribute("data-repair-kind")) === "label" && (await tid("lesson-end").getAttribute("data-repair-status")) === "available");
  await shot(p, "F2-label-offer");
  await enterOn("repair-start");
  await tid("repair-explain").waitFor();
  check("F2 label: the worked example compares the target with what was typed", (await tid("visual-label").count()) === 1);
  await enterOn("repair-to-retry");
  await tid("retry-input").waitFor();
  await typeLine(p, "retry-input", "Sonnenküste");
  await tid("lesson-close").waitFor();
  check("F2 label: one exact attempt closes the repair as corrected with practice; the original label record stays as typed", (await tid("lesson-close").getAttribute("data-close-kind")) === "corrected-with-practice" && (await evidence()).state.typing.labels[0].typed === "Sonenküste");
  await shot(p, "F2-label-closed");
  check("no browser page errors", pageErrors.length === 0, pageErrors.slice(0, 3));
});

await browser.close();
const summary = { base: BASE, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results, screenshots: shots, pageErrors };
fs.writeFileSync(path.join(OUT, "repair1-results.json"), JSON.stringify(summary, null, 2));
console.log(`\nrepair1: ${summary.passed} passed, ${summary.failed} failed → ${OUT}`);
process.exit(summary.failed === 0 ? 0 : 1);
