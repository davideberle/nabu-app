// Independent re-acceptance, repair round 3 (2026-10-03) — browser + HTTP evidence that ALL
// unresolved language steps (pick, produce, reuse) are reachable with their own cues, one bounded
// attempt each, with honest item-complete closure; keyboard/reload/response-loss recovery on the
// third item; and compatibility of records persisted by earlier rounds (two items, maxRetries 2):
// open ones keep the third step reachable, closed ones read back honestly without fabricated practice. LOCAL production server, synthetic
// AUTH_SECRET, isolated NABU_DB_DIR; headless Chromium with the project audio guard.
//
//   AUTH_SECRET=<server secret> node scripts/verify-learning-repair3.mjs --base http://127.0.0.1:3172 \
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
const OUT = opt("--out", "/tmp/family-learning-repair3");
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
  console.log(ok ? "PASS" : "FAIL", "[repair3]", name, detail === undefined ? "" : JSON.stringify(detail).slice(0, 400));
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
async function op(o, key = `r3-${(opN += 1)}`) {
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
  const file = `repair3-${name}${page === t ? "-tablet" : ""}.png`;
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
      await p.screenshot({ path: path.join(OUT, `repair3-FAILURE-${name}.png`), fullPage: true });
      fs.writeFileSync(path.join(OUT, `repair3-FAILURE-${name}.txt`), await p.locator("body").innerText());
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

// ---------------------------------------------------------------------------
// S1 — three unresolved steps through the browser: three items, own cues, reload before the third, keyboard, honest close
// ---------------------------------------------------------------------------
await guarded("S1", async () => {
  check("fixture: two visits finished, next v4", (await view()).next.visit === "v4");
  await resetTwoVisits();
  await toStationLanguage();
  for (const o of THREE_WRONG_BUT_LAST) await op(o);
  await goto(p, "/family/learn/mission?child=santiago");
  await tid("pick-semillas").waitFor();
  await tid("pick-semillas").click(); // the second wrong reuse pick ends the segment with pick, produce and reuse all unresolved
  await tid("lesson-end").waitFor();
  const before = (await view()).lastLesson;
  check("R3 offer: all three unresolved steps are offered (pick, produce, reuse) with their own cues; 3 attempts", before.repair.items.map((i) => i.item).join() === "LANG-ES-STATION/pick,LANG-ES-STATION/produce,LANG-ES-STATION/reuse" && before.repair.items.map((i) => i.cue?.word).join() === "lámpara,lámpara,agua" && before.repair.remaining === 3 && /3 Versuche/.test(await tid("repair-offer").innerText()), before.repair.items.map((i) => i.item));
  await shot(p, "R3-offer-three");
  await enterOn("repair-start");
  await tid("repair-explain").waitFor();
  await enterOn("repair-to-retry");
  await tid("retry-pick-lámpara").waitFor();
  check("R3 item 1 (pick): cue lámpara, first option focused", (await tid("retry-cue").getAttribute("data-cue-word")) === "lámpara" && /^retry-pick-/.test((await activeTestId()) ?? ""));
  await tid("retry-pick-lámpara").click();
  await tid("retry-input").waitFor();
  check("R3 item 2 (produce): still open, the produce frame with the lámpara cue, input focused", (await view()).lastLesson.repair.status === "open" && (await tid("retry-line").getAttribute("data-retry-kind")) === "produce" && (await tid("retry-cue").getAttribute("data-cue-word")) === "lámpara" && (await activeTestId()) === "retry-input");
  await typeLine(p, "retry-input", "necesitamos una lámpara");
  await tid("retry-pick-agua").waitFor();
  const afterTwo = (await view()).lastLesson;
  check("R3 item 3 (reuse): after two corrections the repair is OPEN, remaining 1, the reuse pick with the agua cue is reachable and focused, no corrected close claimed", afterTwo.repair.status === "open" && afterTwo.repair.remaining === 1 && afterTwo.close.kind === "pending" && (await tid("retry-line").getAttribute("data-retry-no")) === "3" && (await tid("retry-cue").getAttribute("data-cue-word")) === "agua" && (await activeTestId()) === "retry-pick-agua" && (await h2()) === "Jetzt „agua“: wähle noch einmal.", { status: afterTwo.repair.status, remaining: afterTwo.repair.remaining, close: afterTwo.close });
  await shot(p, "R3-item3-desktop");
  await goto(t, "/family/learn/mission?child=santiago");
  await tid("retry-pick-agua", t).waitFor();
  check("R3 item 3 (tablet, fresh load): the third item is where the child continues, its cue shown", (await tid("retry-cue", t).getAttribute("data-cue-word")) === "agua" && (await tid("retry-line", t).getAttribute("data-retry-no")) === "3");
  await shot(t, "R3-item3");
  await p.reload();
  await p.waitForLoadState("load");
  await tid("retry-pick-agua").waitFor();
  check("R3 reload after the second: resumes at the third item with its first option focused (keyboard recovery)", (await tid("retry-cue").getAttribute("data-cue-word")) === "agua" && (await activeTestId()) === "retry-pick-agua" && (await view()).lastLesson.repair.used === 2);
  // response loss on the third attempt: persisted, receipt dropped → the second press replays once
  lostAfterSave.add("language-retry");
  await p.keyboard.press("Enter"); // agua, the first option, is right
  await tid("retry-notice").waitFor();
  check("R3 response loss on the third attempt: the server closed the repair (3 attempts, all correct), the browser shows an error and keeps its controls", (await view()).lastLesson.repair.status === "closed" && (await view()).lastLesson.repair.used === 3 && (await tid("retry-notice").getAttribute("data-notice-kind")) === "error" && (await tid("retry-pick-agua").count()) === 1, persistedLosses.at(-1));
  await tid("retry-pick-agua").click();
  await tid("lesson-close").waitFor();
  const ev = await evidence();
  check("R3 closed: three corrections → corrected-with-practice as the headline; exactly 3 language_retry samples (replay, no duplicate); both focuses stay open (helped)", (await tid("lesson-close").getAttribute("data-close-kind")) === "corrected-with-practice" && ev.samples.filter((s) => s.kind === "language_retry").length === 3 && ev.state.feedback.focus.filter((f) => f.id.startsWith("language:es:") && f.status === "open").length === 2 && (await activeTestId()) === "lesson-continue");
  await shot(p, "R3-closed-three-correct");
  await goto(t, "/family/learn/mission?child=santiago");
  await tid("lesson-close", t).waitFor();
  await shot(t, "R3-closed-three-correct");
});

// ---------------------------------------------------------------------------
// S2 — truthful closures: third wrong, a step left unscored, early stop after the second, skip at the offer
// ---------------------------------------------------------------------------
await guarded("S2", async () => {
  let fb = await threeWrongViaApi();
  await op({ op: "repair-explain", repairId: fb.repair.repairId });
  await op(retryOp(fb.repair.repairId, 1, "pick", "lámpara"));
  await op(retryOp(fb.repair.repairId, 2, "produce", "necesitamos una lámpara"));
  const wrong3 = await op(retryOp(fb.repair.repairId, 3, "reuse", "semillas"));
  check("R3 third wrong: closed as practice-again with the two corrections kept per item", wrong3.result.closed === true && wrong3.result.outcome === "practice-again" && wrong3.view.lastLesson.close.kind === "practice-again" && wrong3.view.lastLesson.repair.retries.filter((r) => r.result === "correct").length === 2);
  await goto(p, "/family/learn/mission?child=santiago");
  await tid("lesson-close").waitFor();
  check("R3 third wrong (browser): the honest outcome is the headline, the success line subordinate", /üben wir nochmal/.test(await h2()) && (await tid("lesson-close").getAttribute("data-close-kind")) === "practice-again");
  await shot(p, "R3-closed-third-wrong");
  fb = await threeWrongViaApi();
  await op({ op: "repair-explain", repairId: fb.repair.repairId });
  await op(retryOp(fb.repair.repairId, 1, "pick", "lámpara"));
  const unclear = await op(retryOp(fb.repair.repairId, 2, "produce", "zzzz"));
  const after3 = await op(retryOp(fb.repair.repairId, 3, "reuse", "agua"));
  check("R3 unscored middle step: the unclear production stays unscored and the close is practice-again although pick and reuse were right", unclear.result.result === "unscored" && after3.result.outcome === "practice-again" && after3.view.lastLesson.close.kind === "practice-again");
  fb = await threeWrongViaApi();
  await op({ op: "repair-explain", repairId: fb.repair.repairId });
  await op(retryOp(fb.repair.repairId, 1, "pick", "lámpara"));
  await op(retryOp(fb.repair.repairId, 2, "produce", "necesitamos una lámpara"));
  await goto(p, "/family/learn/mission?child=santiago");
  await tid("retry-pick-agua").waitFor();
  await tid("repair-finish").click(); // "Genug geübt" after the second
  await tid("lesson-close").waitFor();
  const stopped = (await view()).lastLesson;
  check("R3 early stop after the second: practice-again (reuse never corrected), no fabricated third attempt, Weiter focused", stopped.close.kind === "practice-again" && stopped.repair.used === 2 && (await activeTestId()) === "lesson-continue" && (await evidence()).samples.filter((s) => s.kind === "language_retry").length === 2);
  await shot(p, "R3-closed-early-stop");
  fb = await threeWrongViaApi();
  await goto(p, "/family/learn/mission?child=santiago");
  await tid("repair-skip").waitFor();
  await tid("repair-skip").click();
  await tid("lesson-close").waitFor();
  const ev = await evidence();
  check("R3 skip at the offer: skipped, practice-again, all word focuses open, no retry samples", ev.state.feedback.repairs.find((r) => r.id === fb.id)?.outcome === "skipped" && (await tid("lesson-close").getAttribute("data-close-kind")) === "practice-again" && ev.state.feedback.focus.filter((f) => f.id.startsWith("language:es:")).every((f) => f.status === "open") && ev.samples.filter((s) => s.kind === "language_retry").length === 0);
});

// ---------------------------------------------------------------------------
// S3 — records persisted by earlier rounds (two items, maxRetries 2): open → third step reachable; closed → honest readback
// ---------------------------------------------------------------------------
await guarded("S3", async () => {
  if (!DB) throw new Error("--db is required for the persisted-record scenarios");
  let fb = await threeWrongViaApi();
  await op({ op: "repair-explain", repairId: fb.repair.repairId });
  await patchRepairRecord((r) => (r.id === fb.id ? { ...r, items: ["LANG-ES-STATION/pick", "LANG-ES-STATION/produce"], maxRetries: 2 } : r));
  const legacy = (await view()).lastLesson;
  check("R3 legacy OPEN record (two items, maxRetries 2): the view still offers all three unresolved steps with 3 attempts", legacy.repair.items.length === 3 && legacy.repair.remaining === 3, { items: legacy.repair.items.map((i) => i.item), remaining: legacy.repair.remaining });
  await goto(p, "/family/learn/mission?child=santiago");
  await tid("repair-explain").waitFor(); // nothing attempted yet → the explanation comes first (R2-3), then the first item
  check("R3 legacy OPEN (browser): the explanation shows first, 'Jetzt probieren' focused", (await activeTestId()) === "repair-to-retry");
  await enterOn("repair-to-retry");
  await tid("retry-pick-lámpara").waitFor();
  await tid("retry-pick-lámpara").click();
  await tid("retry-input").waitFor();
  await typeLine(p, "retry-input", "necesitamos una lámpara");
  await tid("retry-pick-agua").waitFor();
  const afterTwo = (await view()).lastLesson;
  check("R3 legacy OPEN: two corrections do not close it (old maxRetries 2 ignored for the unresolved third), reuse reachable and focused", afterTwo.repair.status === "open" && afterTwo.repair.used === 2 && afterTwo.repair.remaining === 1 && (await tid("retry-cue").getAttribute("data-cue-word")) === "agua" && (await activeTestId()) === "retry-pick-agua");
  await shot(p, "R3-legacy-open-item3");
  await tid("retry-pick-agua").click();
  await tid("lesson-close").waitFor();
  check("R3 legacy OPEN: the third correction closes it as corrected-with-practice", (await tid("lesson-close").getAttribute("data-close-kind")) === "corrected-with-practice" && (await view()).lastLesson.repair.used === 3);
  // early stop on a legacy open record after two: the never-listed third step is still required
  fb = await threeWrongViaApi();
  await op({ op: "repair-explain", repairId: fb.repair.repairId });
  await patchRepairRecord((r) => (r.id === fb.id ? { ...r, items: ["LANG-ES-STATION/pick", "LANG-ES-STATION/produce"], maxRetries: 2 } : r));
  await op(retryOp(fb.repair.repairId, 1, "pick", "lámpara"));
  await op(retryOp(fb.repair.repairId, 2, "produce", "necesitamos una lámpara"));
  const stop = await op({ op: "repair-close", repairId: fb.repair.repairId, reason: "done" });
  check("R3 legacy OPEN, stopped after two: practice-again (the third step was required although the old record never listed it)", stop.result.outcome === "practice-again" && stop.view.lastLesson.close.kind === "practice-again");
  // a CLOSED legacy record that claimed 'corrected' with the third step never offered
  fb = await threeWrongViaApi();
  await op({ op: "repair-explain", repairId: fb.repair.repairId });
  await patchRepairRecord((r) => (r.id === fb.id ? { ...r, items: ["LANG-ES-STATION/pick", "LANG-ES-STATION/produce"], maxRetries: 2 } : r));
  await op(retryOp(fb.repair.repairId, 1, "pick", "lámpara"));
  await op(retryOp(fb.repair.repairId, 2, "produce", "necesitamos una lámpara"));
  await patchRepairRecord((r) => (r.id === fb.id ? { ...r, outcome: "corrected-with-practice", closedAt: new Date().toISOString() } : r));
  const closedLegacy = (await view()).lastLesson;
  check("R3 legacy CLOSED record: reads back as practice-again (reuse never corrected), the two recorded corrections kept, no third attempt fabricated, focus agua open", closedLegacy.repair.status === "closed" && closedLegacy.close.kind === "practice-again" && closedLegacy.repair.used === 2 && closedLegacy.repair.retries.filter((r) => r.result === "correct").length === 2 && (await evidence()).state.feedback.focus.find((f) => f.id === "language:es:agua")?.status === "open", { close: closedLegacy.close, used: closedLegacy.repair.used });
  await goto(p, "/family/learn/mission?child=santiago");
  await tid("lesson-close").waitFor();
  check("R3 legacy CLOSED (browser): honest headline and close kind, Weiter focused, no retry controls", /üben wir nochmal/.test(await h2()) && (await tid("lesson-close").getAttribute("data-close-kind")) === "practice-again" && (await tid("retry-line").count()) === 0 && (await activeTestId()) === "lesson-continue");
  await shot(p, "R3-legacy-closed-readback");
  const refused = await opRaw(retryOp(fb.repair.repairId, 3, "reuse", "agua"), `r3-refused-${Date.now()}`);
  check("R3 legacy CLOSED: a late third attempt is refused (closed records are not reopened)", refused.status === 422 && /closed/.test(refused.json?.message ?? ""), refused.json?.message);
  // the parent's evidence agrees with the child view
  const ev = await evidence();
  const lessonsSeen = ev.state.feedback.repairs.find((r) => r.id === fb.id);
  check("R3 legacy CLOSED: the persisted record is untouched (outcome text as written, 2 retries) — readback, not rewrite", lessonsSeen?.outcome === "corrected-with-practice" && lessonsSeen.retries.length === 2);
  check("no browser page errors", pageErrors.length === 0, pageErrors.slice(0, 3));
});

await browser.close();
const summary = { base: BASE, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results, screenshots: shots, persistedLosses, pageErrors };
fs.writeFileSync(path.join(OUT, "repair3-results.json"), JSON.stringify(summary, null, 2));
console.log(`\nrepair3: ${summary.passed} passed, ${summary.failed} failed → ${OUT}`);
process.exit(summary.failed === 0 ? 0 : 1);
