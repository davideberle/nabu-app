// Independent re-acceptance, repair round 2 (2026-10-03) — browser + HTTP evidence for
// R2-1 (every unresolved language item reachable with its own cue, per-item outcomes),
// R2-2 (unscored never resolves a confirmed error; unrelated success never resolves or retires),
// R2-3 (a persisted explanation whose response was lost is shown again before the first retry;
// retry/close response-loss controls retained), R2-4 (current correction dominant across the
// four writing phases, desktop and tablet renders). LOCAL production server, synthetic
// AUTH_SECRET, isolated NABU_DB_DIR; headless Chromium with the project audio guard.
//
//   AUTH_SECRET=<server secret> node scripts/verify-learning-repair2.mjs --base http://127.0.0.1:3172 \
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
const OUT = opt("--out", "/tmp/family-learning-repair2");
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
  console.log(ok ? "PASS" : "FAIL", "[repair2]", name, detail === undefined ? "" : JSON.stringify(detail).slice(0, 400));
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
async function op(o, key = `r2-${(opN += 1)}`) {
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
  const file = `repair2-${name}${page === t ? "-tablet" : ""}.png`;
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
      await p.screenshot({ path: path.join(OUT, `repair2-FAILURE-${name}.png`), fullPage: true });
      fs.writeFileSync(path.join(OUT, `repair2-FAILURE-${name}.txt`), await p.locator("body").innerText());
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

// ---------------------------------------------------------------------------
// S1 — R2-4: the four writing phases, current correction dominant, earlier success attributed (desktop + tablet)
// ---------------------------------------------------------------------------
await guarded("S1", async () => {
  check("fixture: two visits finished, next v4", (await view()).next.visit === "v4");
  await toTransfer();
  await goto(p, "/family/learn/mission?child=santiago");
  await tid("transfer-input").waitFor();
  await p.keyboard.type("Morgen zählt sie3 Schildkröten.");
  await tid("transfer-save").click();
  await tid("lesson-end").waitFor();
  const PAGE_SUCCESS = /Logbuchseite/;
  // offer
  check("R2-4 offer: the headline is the current correction (missing space in the NEW sentence), not the page's success", (await h2()) === "Im neuen Satz fehlt ein Leerzeichen." && (await tid("lesson-headline").getAttribute("data-headline-kind")) === "task", await h2());
  check("R2-4 offer: the earlier success stays visible, subordinate and attributed to the logbook page", (await successTag()) === "P" && PAGE_SUCCESS.test(await tid("lesson-success").innerText()) && /Auch richtig/.test(await tid("lesson-success").innerText()), await tid("lesson-success").innerText());
  check("R2-4 offer: the child's sentence and the offer are on screen, 'Zeigen und üben' focused", /sie3/.test(await body()) && (await activeTestId()) === "repair-start");
  await shot(p, "R2-4-writing-offer");
  await goto(t, "/family/learn/mission?child=santiago");
  await tid("lesson-end", t).waitFor();
  check("R2-4 offer (tablet): same hierarchy", (await h2(t)) === "Im neuen Satz fehlt ein Leerzeichen." && (await successTag(t)) === "P");
  await shot(t, "R2-4-writing-offer");
  // explain
  await p.keyboard.press("Enter");
  await tid("repair-explain").waitFor();
  check("R2-4 explain: the headline names the current step; the marked sentence is shown; the success line stays subordinate", (await h2()) === "So kommt das Leerzeichen an seinen Platz." && (await tid("visual-spacing").count()) === 1 && (await successTag()) === "P" && !PAGE_SUCCESS.test(await h2()));
  await shot(p, "R2-4-writing-explain");
  await t.reload();
  await t.waitForLoadState("load");
  await tid("repair-explain", t).waitFor();
  check("R2-4 explain (tablet): the explanation is shown after a reload (no attempt yet), same headline", (await h2(t)) === "So kommt das Leerzeichen an seinen Platz.");
  await shot(t, "R2-4-writing-explain");
  // retry
  await enterOn("repair-to-retry");
  await tid("retry-sentence").waitFor();
  check("R2-4 retry: the headline is the instruction; the field holds the child's own sentence and is focused", (await h2()) === "Setz das Leerzeichen in deinen Satz ein." && (await tid("retry-sentence").inputValue()) === "Morgen zählt sie3 Schildkröten." && (await activeTestId()) === "retry-sentence");
  await shot(p, "R2-4-writing-retry");
  await tid("repair-to-retry", t).click();
  await tid("retry-sentence", t).waitFor();
  check("R2-4 retry (tablet): same headline and field", (await h2(t)) === "Setz das Leerzeichen in deinen Satz ein.");
  await shot(t, "R2-4-writing-retry");
  // closed
  await p.keyboard.press("Control+A");
  await p.keyboard.press("Meta+A");
  await p.keyboard.type("Morgen zählt sie 3 Schildkröten.");
  await p.keyboard.press("Enter");
  await tid("lesson-close").waitFor();
  check("R2-4 closed: the outcome is the headline; the close box does not repeat it; Weiter focused; success still attributed", (await h2()) === "Mit Üben korrigiert: die Leerzeichen stimmen jetzt." && (await tid("lesson-close").getAttribute("data-close-kind")) === "corrected-with-practice" && !/Mit Üben korrigiert/.test(await tid("lesson-close").innerText()) && (await activeTestId()) === "lesson-continue" && (await successTag()) === "P");
  await shot(p, "R2-4-writing-closed");
  await t.reload();
  await t.waitForLoadState("load");
  await tid("lesson-close", t).waitFor();
  check("R2-4 closed (tablet): same headline after a reload", (await h2(t)) === "Mit Üben korrigiert: die Leerzeichen stimmen jetzt.");
  await shot(t, "R2-4-writing-closed");
  const ev = await evidence();
  check("R2-4 evidence preserved: original flagged transfer, one writing_retry, the page revision untouched", ev.samples.some((s) => s.kind === "writing_transfer" && /sie3/.test(s.text)) && ev.samples.filter((s) => s.kind === "writing_retry").length === 1 && ev.state.feedback.focus.find((f) => f.id === "spacing:rule")?.status === "open");
  // a skipped repair: the honest outcome is the headline too
  await resetTwoVisits();
  await toTransfer();
  await goto(p, "/family/learn/mission?child=santiago");
  await tid("transfer-input").waitFor();
  await p.keyboard.type("Morgen zählt sie3 Schildkröten.");
  await tid("transfer-save").click();
  await tid("lesson-end").waitFor();
  await tid("repair-skip").click();
  await tid("lesson-close").waitFor();
  check("R2-4 skipped: the practice-again outcome is the headline, the success line subordinate", /Leerzeichen üben wir nochmal/.test(await h2()) && (await successTag()) === "P");
  await shot(p, "R2-4-writing-skipped");
});

// ---------------------------------------------------------------------------
// S2 — R2-3: explanation response loss → the explanation is shown before the first retry; retry/close loss controls retained
// ---------------------------------------------------------------------------
await guarded("S2", async () => {
  await resetTwoVisits();
  await toTypingCourse();
  await wrongTypingRound();
  check("R2-3 setup: the typing repair is offered with the task headline", (await tid("repair-start").count()) === 1 && /Eine Taste üben wir: „j“/.test(await h2()));
  lostAfterSave.add("repair-explain");
  await p.keyboard.press("Enter"); // Zeigen und üben — persisted, receipt lost
  await tid("retry-notice").waitFor();
  const v1 = await view();
  check("R2-3: the server recorded the worked example, the browser never showed it — the offer stays with an error notice", v1.lastLesson.repair.explanation.recorded === true && (await tid("repair-explain").count()) === 0 && (await tid("repair-start").count()) === 1 && (await tid("retry-notice").getAttribute("data-notice-kind")) === "error", persistedLosses.at(-1));
  await shot(p, "R2-3-explanation-lost");
  await p.reload();
  await p.waitForLoadState("load");
  await tid("lesson-end").waitFor();
  check("R2-3: after a reload the actual explanation is shown BEFORE the first retry, 'Jetzt probieren' focused", (await tid("repair-explain").count()) === 1 && (await tid("retry-input").count()) === 0 && (await tid("lesson-end").getAttribute("data-phase")) === "explain" && (await activeTestId()) === "repair-to-retry" && (await h2()) === "So triffst du „j“.");
  await shot(p, "R2-3-explanation-after-reload");
  check("R2-3: exactly one mini_lesson support (no second write)", (await evidence()).supports.filter((s) => s.kind === "mini_lesson").length === 1);
  await p.keyboard.press("Enter");
  await tid("retry-input").waitFor();
  check("R2-3: the first retry follows the explanation with its input focused", (await activeTestId()) === "retry-input" && (await tid("retry-line").getAttribute("data-retry-no")) === "1");
  // without a reload: pressing the offer again replays the recorded explanation once and shows it
  await resetTwoVisits();
  await toTypingCourse();
  await wrongTypingRound();
  lostAfterSave.add("repair-explain");
  await p.keyboard.press("Enter");
  await tid("retry-notice").waitFor();
  await enterOn("repair-start");
  await tid("repair-explain").waitFor();
  check("R2-3 (no reload): the second press shows the explanation; the server replayed the single mini_lesson", (await evidence()).supports.filter((s) => s.kind === "mini_lesson").length === 1 && (await activeTestId()) === "repair-to-retry");
  // retained controls: retry response loss, final-retry response loss, close response loss
  await enterOn("repair-to-retry");
  await tid("retry-input").waitFor();
  lostAfterSave.add("typing-retry");
  await typeLine(p, "retry-input", "fff jjj");
  await tid("retry-notice").waitFor();
  check("retained: retry response loss — one retry on the server, the draft still in the field", (await view()).lastLesson.repair.used === 1 && (await tid("retry-input").inputValue()) === "fff jjj");
  await tid("retry-commit").focus();
  await p.keyboard.press("Enter");
  await settle(600);
  check("retained: the repeated commit replays once and moves to retry 2 with the input focused", (await view()).lastLesson.repair.used === 1 && (await evidence()).samples.filter((s) => s.kind === "typing_retry").length === 1 && (await tid("retry-line").getAttribute("data-retry-no")) === "2" && (await activeTestId()) === "retry-input");
  lostAfterSave.add("typing-retry");
  await typeLine(p, "retry-input", "fj fj jf");
  await tid("retry-notice").waitFor();
  check("retained: final retry response loss — the server closed atomically", (await view()).lastLesson.repair.status === "closed");
  await p.reload();
  await p.waitForLoadState("load");
  await tid("lesson-close").waitFor();
  check("retained: reload recovers the closed outcome as the headline with Weiter focused, no duplicate samples", (await activeTestId()) === "lesson-continue" && (await evidence()).samples.filter((s) => s.kind === "typing_retry").length === 2 && /Mit Üben korrigiert|korrigiert/.test(await h2()));
  await enterOn("lesson-continue");
  await tid("decision-card").waitFor();
  await enterOn("another-burst");
  await tid("course-input").waitFor();
  await typeLine(p, "course-input", "fff hhj");
  await typeLine(p, "course-input", "fj fj jf");
  await enterOn("comfort-ok");
  await tid("lesson-end").waitFor();
  lostAfterSave.add("repair-close");
  await tid("repair-skip").click();
  await tid("retry-notice").waitFor();
  check("retained: close response loss — the server saved the skip, the offer keeps its controls", (await view()).lastLesson.repair.status === "closed" && (await tid("repair-skip").count()) === 1);
  await tid("repair-skip").click();
  await tid("lesson-close").waitFor();
  check("retained: the repeated close lands on the honest closed state with Weiter focused", (await activeTestId()) === "lesson-continue" && (await evidence()).supports.filter((s) => s.kind === "step_down" && s.payload?.repairId).length === 2);
});

// ---------------------------------------------------------------------------
// S3 — R2-1: two wrong words → both items reachable, each with its own cue; reload between items; per-item outcomes
// ---------------------------------------------------------------------------
await guarded("S3", async () => {
  await resetTwoVisits();
  await toStationLanguage();
  for (const o of [lang("LANG-ES-STATION", "listen", "", "listen"), lang("LANG-ES-STATION", "pick", "agua", "word-choice"), lang("LANG-ES-STATION", "pick", "herramientas", "word-choice"), lang("LANG-ES-STATION", "produce", "necesitamos una lámpara"), lang("LANG-ES-STATION", "reuse", "herramientas", "word-choice")]) await op(o);
  await goto(p, "/family/learn/mission?child=santiago");
  await tid("pick-semillas").waitFor();
  await tid("pick-semillas").click();
  await tid("lesson-end").waitFor();
  check("R2-1 offer: two unresolved words → the repair offers 2 attempts; headline names the first word", (await tid("lesson-end").getAttribute("data-repair-status")) === "available" && /2 Versuche/.test(await tid("repair-offer").innerText()) && (await h2()) === "Ein Wort üben wir: „lámpara“.");
  await enterOn("repair-start");
  await tid("repair-explain").waitFor();
  check("R2-1 explain: the first word's example", (await tid("visual-word").first().innerText()).includes("lámpara"));
  await enterOn("repair-to-retry");
  await tid("retry-pick-lámpara").waitFor();
  check("R2-1 item 1: its own cue (lámpara) above the reviewed options; first option focused", (await tid("retry-cue").getAttribute("data-cue-word")) === "lámpara" && /^retry-pick-/.test((await activeTestId()) ?? ""));
  await shot(p, "R2-1-item1");
  await tid("retry-pick-lámpara").click();
  await tid("retry-cue").waitFor();
  await settle(300);
  const after1 = await view();
  check("R2-1: correcting the first word keeps the repair OPEN; the second word is the next item with ITS cue (agua = Wasser), first option focused", after1.lastLesson.repair.status === "open" && after1.lastLesson.repair.used === 1 && (await tid("retry-line").getAttribute("data-retry-no")) === "2" && (await tid("retry-cue").getAttribute("data-cue-word")) === "agua" && (await tid("retry-pick-agua").count()) === 1 && (await activeTestId()) === "retry-pick-agua" && (await h2()) === "Jetzt „agua“: wähle noch einmal.", { status: after1.lastLesson.repair.status, remaining: after1.lastLesson.repair.remaining });
  await shot(p, "R2-1-item2");
  await goto(t, "/family/learn/mission?child=santiago");
  await tid("retry-cue", t).waitFor();
  check("R2-1 (tablet, after reload): the second item is where the child continues", (await tid("retry-cue", t).getAttribute("data-cue-word")) === "agua");
  await shot(t, "R2-1-item2");
  await p.reload();
  await p.waitForLoadState("load");
  await tid("retry-pick-agua").waitFor();
  check("R2-1: after a reload the open repair resumes at the second item with the first option focused (keyboard recovery)", (await tid("retry-cue").getAttribute("data-cue-word")) === "agua" && (await activeTestId()) === "retry-pick-agua");
  await p.keyboard.press("Enter"); // agua is the first option and the right one
  await tid("lesson-close").waitFor();
  const ev = await evidence();
  check("R2-1: both words corrected → corrected-with-practice; two language_retry samples; both focuses stay open (helped)", (await tid("lesson-close").getAttribute("data-close-kind")) === "corrected-with-practice" && ev.samples.filter((s) => s.kind === "language_retry").length === 2 && ev.state.feedback.focus.filter((f) => f.id.startsWith("language:es:") && f.status === "open").length === 2);
  await shot(p, "R2-1-closed");
  // per-item outcome through the API: stopping after the first word is practice-again, never "corrected"
  await resetTwoVisits();
  await toStationLanguage();
  for (const o of [lang("LANG-ES-STATION", "listen", "", "listen"), lang("LANG-ES-STATION", "pick", "agua", "word-choice"), lang("LANG-ES-STATION", "pick", "herramientas", "word-choice"), lang("LANG-ES-STATION", "produce", "necesitamos una lámpara"), lang("LANG-ES-STATION", "reuse", "herramientas", "word-choice"), lang("LANG-ES-STATION", "reuse", "semillas", "word-choice")]) await op(o);
  const fb = (await view()).lastLesson;
  await op({ op: "repair-explain", repairId: fb.repair.repairId });
  const r1 = await op({ op: "language-retry", repairId: fb.repair.repairId, retryNo: 1, stepId: "pick", response: "lámpara" });
  const stop = await op({ op: "repair-close", repairId: fb.repair.repairId, reason: "done" });
  check("R2-1 (API): first word corrected, then 'Genug geübt' → practice-again because the second word was never corrected", r1.result.closed === false && stop.result.outcome === "practice-again" && stop.view.lastLesson.close.kind === "practice-again");
  // second word wrong → practice-again with per-item evidence
  await resetTwoVisits();
  await toStationLanguage();
  for (const o of [lang("LANG-ES-STATION", "listen", "", "listen"), lang("LANG-ES-STATION", "pick", "agua", "word-choice"), lang("LANG-ES-STATION", "pick", "herramientas", "word-choice"), lang("LANG-ES-STATION", "produce", "necesitamos una lámpara"), lang("LANG-ES-STATION", "reuse", "herramientas", "word-choice"), lang("LANG-ES-STATION", "reuse", "semillas", "word-choice")]) await op(o);
  const fb2 = (await view()).lastLesson;
  await op({ op: "repair-explain", repairId: fb2.repair.repairId });
  await op({ op: "language-retry", repairId: fb2.repair.repairId, retryNo: 1, stepId: "pick", response: "lámpara" });
  const r2 = await op({ op: "language-retry", repairId: fb2.repair.repairId, retryNo: 2, stepId: "reuse", response: "semillas" });
  check("R2-1 (API): second word still wrong → closed as practice-again; the first word's correct attempt is kept per item", r2.result.closed === true && r2.result.outcome === "practice-again" && r2.view.lastLesson.repair.retries.filter((x) => x.item === "LANG-ES-STATION/pick" && x.result === "correct").length === 1);
});

// ---------------------------------------------------------------------------
// S4 — R2-2: wrong production, unscored second try, correct pick/reuse → the production is still the open item
// ---------------------------------------------------------------------------
await guarded("S4", async () => {
  await resetTwoVisits();
  await toStationLanguage();
  for (const o of [lang("LANG-ES-STATION", "listen", "", "listen"), lang("LANG-ES-STATION", "pick", "agua", "word-choice"), lang("LANG-ES-STATION", "pick", "lámpara", "word-choice"), lang("LANG-ES-STATION", "produce", "agua"), lang("LANG-ES-STATION", "produce", "xxxxxxxx"), { op: "language-continue", segmentId: "LANG-ES-STATION", stepId: "produce" }]) await op(o);
  await goto(p, "/family/learn/mission?child=santiago");
  await tid("pick-agua").waitFor();
  await tid("pick-agua").click(); // the reuse pick is right — unrelated to the production
  await tid("lesson-end").waitFor();
  const v = await view();
  check("R2-2 offer: the wrong production stays unresolved (an unscored try never resolves it; the correct reuse is unrelated) → its own repair", (await tid("lesson-end").getAttribute("data-repair-status")) === "available" && v.lastLesson.repair.items.map((i) => i.kind).join() === "produce" && v.lastLesson.mistakes.some((m) => m.id.startsWith("produce:")) && v.lastLesson.unscored.length === 1 && v.lastLesson.close.kind === "pending", { items: v.lastLesson.repair.items.map((i) => i.item), close: v.lastLesson.close });
  check("R2-2: the focus for lámpara is open and was not retired by the unrelated correct picks", (await evidence()).state.feedback.focus.find((f) => f.id === "language:es:lámpara")?.status === "open");
  await shot(p, "R2-2-offer");
  await enterOn("repair-start");
  await tid("repair-explain").waitFor();
  await enterOn("repair-to-retry");
  await tid("retry-input").waitFor();
  check("R2-2 retry: the same produce frame with the lámpara cue, input focused", (await tid("retry-line").getAttribute("data-retry-kind")) === "produce" && (await tid("retry-cue").getAttribute("data-cue-word")) === "lámpara" && (await activeTestId()) === "retry-input");
  await shot(p, "R2-2-retry");
  await typeLine(p, "retry-input", "necesitamos una lámpara");
  await tid("lesson-close").waitFor();
  const ev = await evidence();
  check("R2-2: the same-item scored correction closes it as corrected; the unscored try is kept as unscored; the focus stays open", (await tid("lesson-close").getAttribute("data-close-kind")) === "corrected-with-practice" && ev.samples.filter((s) => s.kind === "language_retry").length === 1 && ev.state.language["LANG-ES-STATION"].records.filter((r) => r.stepId === "produce" && r.correct === null).length === 1 && ev.state.feedback.focus.find((f) => f.id === "language:es:lámpara")?.status === "open");
  // skipping keeps the honest outcome
  await resetTwoVisits();
  await toStationLanguage();
  for (const o of [lang("LANG-ES-STATION", "listen", "", "listen"), lang("LANG-ES-STATION", "pick", "agua", "word-choice"), lang("LANG-ES-STATION", "pick", "lámpara", "word-choice"), lang("LANG-ES-STATION", "produce", "agua"), lang("LANG-ES-STATION", "produce", "xxxxxxxx"), { op: "language-continue", segmentId: "LANG-ES-STATION", stepId: "produce" }, lang("LANG-ES-STATION", "reuse", "agua", "word-choice")]) await op(o);
  const fb = (await view()).lastLesson;
  const skipped = await op({ op: "lesson-feedback-seen", id: fb.id });
  const after = (await evidence()).state;
  check("R2-2 (API): moving on without the correction → repair skipped, parent sees practice-again, focus open", after.feedback.repairs.find((r) => r.id === fb.id)?.outcome === "skipped" && after.feedback.focus.find((f) => f.id === "language:es:lámpara")?.status === "open" && skipped.view.reports?.length >= 0);
  check("no browser page errors", pageErrors.length === 0, pageErrors.slice(0, 3));
});

await browser.close();
const summary = { base: BASE, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results, screenshots: shots, persistedLosses, pageErrors };
fs.writeFileSync(path.join(OUT, "repair2-results.json"), JSON.stringify(summary, null, 2));
console.log(`\nrepair2: ${summary.passed} passed, ${summary.failed} failed → ${OUT}`);
process.exit(summary.failed === 0 ? 0 : 1);
