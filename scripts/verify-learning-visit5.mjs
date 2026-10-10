// Visit 5 (content version 4, 2026-10-10) — browser + HTTP + database evidence for the harbor chapter `v6` (learner-visible
// Besuch 5): the one next action from the completed-four-visits shape, the island hub with keyboard/click movement and direct
// entry, the free workplace order, the two-part harbor item, the reasoning conversation in the Nabu sidebar (typed path; the
// microphone's failure path under a denied permission; the speech route blocked by the audio guard), the Spanish supplier with
// the recorded translation, the plan, the captain's log, the typing round, the closing check, the writing review, the report,
// the map after the visit, reopening, the parent evidence, stale/replay requests, sibling isolation and the version-3 cap
// parking a running v6. LOCAL production server, synthetic AUTH_SECRET, isolated NABU_DB_DIR; headless Chromium with the
// project audio guard; the bridge, TTS and transcription routes are aborted at the browser (nothing leaves the machine).
//
//   AUTH_SECRET=<server secret> node scripts/verify-learning-visit5.mjs --base http://127.0.0.1:3182 \
//       --out <dir> --db /tmp/<fixture>/nabu.db [--cap-base http://127.0.0.1:3183]
//
// The fixture is built through the child API (deletion through the owner route, then every visit's ops) and the stored row is
// stripped to the released version-3 shape once (short-lived connection while the server is idle). No child record is used.

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
const BASE = opt("--base", "http://127.0.0.1:3182").replace(/\/$/, "");
const CAP_BASE = opt("--cap-base", null);
const OUT = opt("--out", "/tmp/family-learning-visit5");
const DB = opt("--db", null);
const SECRET = process.env.AUTH_SECRET;
if (!SECRET || SECRET.length < 32 || !DB) {
  console.error("AUTH_SECRET (>= 32 chars, same as the server) and --db are required");
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });
const COOKIE = "authjs.session-token";
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(ok ? "PASS" : "FAIL", "[visit5]", name, detail === undefined ? "" : JSON.stringify(detail).slice(0, 400));
}
const mint = (email) => encode({ token: { email, sub: email, name: email }, secret: SECRET, salt: COOKIE, maxAge: 3600 });
const owner = await mint("info@davideberle.com");
const assistant = await mint("assistant@davideberle.com");
async function api(method, url, body, cookie = assistant, bearer, base = BASE) {
  const r = await fetch(base + url, { method, redirect: "manual", headers: { ...(cookie ? { cookie: `${COOKIE}=${cookie}` } : {}), "content-type": "application/json", ...(bearer ? { authorization: "Bearer " + bearer } : {}) }, body: body ? JSON.stringify(body) : undefined });
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
async function op(o, key = `v5j-${(opN += 1)}`) {
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

/** Erase the child (owner route) and rebuild four finished visits through the child API (acknowledging each lesson end). */
async function fourVisitsDone() {
  await api("DELETE", "/api/family/learning/parent/records?child=santiago&confirm=santiago", null, owner);
  bearer = (await api("POST", "/api/family/learning/session", { childId: "santiago" })).json?.token;
  for (const o of [{ op: "start-visit" }, { op: "name-base", name: "Fixture Basis" }, { op: "place-base", locationId: "shore" }, { op: "answer-math", itemId: "EQ-ENTRY", answer: 6, raw: "6", modality: "typed" }]) await op(o);
  await ack();
  await op({ op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" });
  await ack();
  await op({ op: "explain", text: "Ich habe geteilt.", modality: "typed" });
  await op({ op: "skip-stage", stage: "LANG-EN-WATER", reason: "child" });
  await op({ op: "typing-label", taskId: "TYPE-LABEL-BASE", typed: "Fixture Basis", seconds: 20 });
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
  await op({ op: "start-visit" });
  await op({ op: "resume-base" });
  await op({ op: "choose-station", theme: "turtles" });
  if ((await setLayout("ch-de-qwertz")) !== 200) throw new Error("layout");
  await op({ op: "typing-check", observed: CH });
  await op({ op: "typing-course-continue" });
  await op({ op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" });
  await ack();
  for (const o of [{ op: "explain", text: "Fünf mal sechs sind dreissig.", modality: "typed" }, lang("LANG-ES-STATION", "listen", "", "listen"), lang("LANG-ES-STATION", "pick", "lámpara", "word-choice"), lang("LANG-ES-STATION", "produce", "necesitamos una lámpara"), lang("LANG-ES-STATION", "reuse", "agua", "word-choice")]) await op(o);
  await ack();
  for (const o of [{ op: "build-station", spot: "beach" }, { op: "save-log", text: "Heute steht die Station." }, { op: "revise-log", text: "Heute steht die Station." }, { op: "write-transfer", text: "Morgen zählen wir 3 Schildkröten.", modality: "typed" }]) await op(o);
  await ack();
  await op({ op: "summary-seen" });
  await op({ op: "reflect", optionId: "easy" });
  // Besuch 4: the pier chapter with the typing course at lesson 1 twice (two good rounds → lesson 2 stays saved), then everything else.
  await op({ op: "start-visit" });
  await op({ op: "resume-base" });
  await op({ op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["fff jjj", "fj fj jf"], seconds: 15, comfort: "ok" });
  await ack();
  await op({ op: "typing-burst", lessonId: "TYPE-CH-COURSE-1", lines: ["fff jjj", "fj fj jf"], seconds: 15, comfort: "ok" });
  await ack();
  await op({ op: "typing-course-continue" });
  await op({ op: "answer-remainder", itemId: "EQ-PIER", used: 42, remaining: 3, raw: "42, 3", modality: "typed" });
  await ack();
  for (const o of [{ op: "explain", text: "Sechs mal sieben ist 42, drei bleiben.", modality: "typed" }, lang("LANG-EN-PIER", "listen", "", "listen"), lang("LANG-EN-PIER", "pick", "wood", "word-choice"), lang("LANG-EN-PIER", "produce", "we need wood"), lang("LANG-EN-PIER", "reuse", "rope", "word-choice")]) await op(o);
  await ack();
  for (const o of [{ op: "build-pier", spot: "bay" }, { op: "save-log", text: "Heute steht der Steg in der Bucht." }, { op: "revise-log", text: "Heute steht der Steg in der Bucht." }, { op: "write-transfer", text: "Morgen bringt das Boot 5 Kisten.", modality: "typed" }]) await op(o);
  await ack();
  await op({ op: "summary-seen" });
  await op({ op: "reflect", optionId: "easy" });
}

/** The raw stored row (storage boundary). */
async function rawRow() {
  const c = createClient({ url: "file:" + DB });
  try {
    const row = (await c.execute("SELECT state_json, content_version FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0];
    return { state: JSON.parse(String(row.state_json)), contentVersion: Number(row.content_version) };
  } finally {
    c.close();
  }
}
async function patchRow(mutate) {
  const c = createClient({ url: "file:" + DB });
  for (let attempt = 0; ; attempt += 1) {
    try {
      const row = (await c.execute("SELECT state_json FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0];
      const state = JSON.parse(String(row.state_json));
      const next = mutate(state) ?? state;
      await c.execute({ sql: "UPDATE family_learning_missions SET state_json = ?, content_version = ? WHERE child_id = 'santiago'", args: [JSON.stringify(next), next.contentVersion] });
      break;
    } catch (e) {
      if (!/SQLITE_BUSY/.test(String(e)) || attempt >= 50) throw e;
      await settle(100);
    }
  }
  c.close();
}
/** Four finished visits, then the row stripped to the released version-3 shape (no harbor/reasoning/logReviews keys, version 3). */
async function productionShape() {
  await fourVisitsDone();
  await patchRow((s) => {
    delete s.harbor;
    delete s.reasoning;
    delete s.logReviews;
    s.contentVersion = 3;
    return s;
  });
}
async function capApi(p) {
  const r = await fetch(CAP_BASE + p, { redirect: "manual", headers: { cookie: `${COOKIE}=${assistant}`, authorization: "Bearer " + bearer } });
  let json = null;
  try {
    json = await r.json();
  } catch {
    json = null;
  }
  return { status: r.status, json };
}

const browser = await chromium.launch(audioSafeChromiumLaunchOptions({ headless: true }));
async function makeContext(options) {
  const c = await browser.newContext(options);
  await installBrowserAudioGuard(c);
  await c.route("**/*", async (r) => {
    const u = new URL(r.request().url());
    if (u.origin !== BASE) return r.abort("blockedbyclient");
    // The bridge, the child TTS route and the transcription route never leave the machine in this harness.
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
p.setDefaultTimeout(15000);
const t = await tablet.newPage();
t.setDefaultTimeout(15000);
const pageErrors = [];
for (const pg of [p, t]) pg.on("pageerror", (e) => pageErrors.push(String(e)));
const shots = [];
const shot = async (page, name, { full = false } = {}) => {
  const file = `visit5-${name}${page === t ? "-tablet" : ""}.png`;
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
/** Wait (bounded) until the deliberate focus landed on the given control; returns the active test id. */
async function waitActive(testId, page = p, ms = 3000) {
  const until = Date.now() + ms;
  let id = await activeTestId(page);
  while (id !== testId && Date.now() < until) {
    await settle(100);
    id = await activeTestId(page);
  }
  return id;
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
async function guarded(name, fn) {
  try {
    await fn();
  } catch (error) {
    check(`harness: ${name} ran without an uncaught error (${String(error).split("\n")[0]})`, false, String(error).slice(0, 400));
    try {
      await p.screenshot({ path: path.join(OUT, `visit5-FAILURE-${name}.png`), fullPage: true });
      fs.writeFileSync(path.join(OUT, `visit5-FAILURE-${name}.txt`), await p.locator("body").innerText());
    } catch {
      /* ignore */
    }
  }
}
const worldAttr = (page, name) => (name === "data-world-next" || name === "data-world-running" ? tid("world-screen", page) : page.locator("[data-testid='world-screen'] [data-island-variant='full']").first()).getAttribute(name);
const siteState = (page, visit) => page.locator(`[data-part='site'][data-visit='${visit}']`).first().getAttribute("data-state");
const avatarAt = (page = p) => page.locator("[data-testid='island-stage-frame'] [data-island-variant]").first().getAttribute("data-avatar-at");

// ---------------------------------------------------------------------------
// S1 — progression: the one next action from the completed-four-visits (version-3) shape; the island on the map; the cap
// ---------------------------------------------------------------------------
await guarded("S1", async () => {
  await productionShape();
  const row0 = await rawRow();
  check("fixture: the stored row is the released shape (content version 3, four finished visits, no harbor/reasoning/logReviews keys)", row0.contentVersion === 3 && row0.state.visits.filter((v) => v.finishedAt).length === 4 && !("harbor" in row0.state) && !("reasoning" in row0.state), { visits: row0.state.visits.map((v) => v.id) });
  const v = await view();
  check("F1/F2: exactly one next action — Besuch 5 (internal v6), available now; four reports; the wordbook and harbor are served", v.next.visit === "v6" && v.next.ordinal === 5 && v.next.availableAt === null && v.progress.next.kind === "start" && v.progress.next.label === "Besuch 5 — Der Hafen" && v.progress.completedTotal === 4 && v.reports.length === 4 && v.harbor !== null && v.wordbook !== null, v.next);
  const row1 = await rawRow();
  check("reads (migration on load) do not rewrite the stored row; repeated reads are identical", JSON.stringify(row1.state) === JSON.stringify(row0.state) && row1.contentVersion === 3 && JSON.stringify((await view()).next) === JSON.stringify(v.next));
  await goto(p, "/family/learn?child=santiago");
  await tid("world-screen").waitFor();
  await settle(600);
  const facts = { next: await worldAttr(p, "data-world-next"), v6: await siteState(p, "v6"), harbor: await worldAttr(p, "data-world-harbor"), keeper: await p.locator("[data-part='character-keeper']").count(), planner: await p.locator("[data-part='character-planner']").count(), supplier: await p.locator("[data-part='character-supplier']").count(), pier: await worldAttr(p, "data-world-pier"), station: await worldAttr(p, "data-world-station"), start: (await tid("cockpit-start").innerText()).trim() };
  check("F1 map: the island draws the saved base/station/pier AND the three workplaces with their keepers; Besuch 5 is flagged next; the one action says 'Besuch 5 starten'", facts.next === "v6" && facts.v6 === "next" && facts.harbor === "crates" && facts.keeper === 1 && facts.planner === 1 && facts.supplier === 1 && facts.pier === "built" && facts.station === "built" && /Besuch 5 starten/.test(facts.start), facts);
  check("F4 map: the Nabu bubble is present and Nabu opens as a pane bound to the map page", (await tid("nabu-bubble").count()) === 1);
  await tid("nabu-bubble").click();
  await tid("nabu-sidebar").waitFor();
  check("F4 map: without a running visit the sidebar is listen-only (no bridge question can be recorded as task help)", (await tid("nabu-sidebar").getAttribute("data-mode")) === "free" && (await tid("nabu-input").count()) === 0 && /nur zuhören/.test(await tid("nabu-sidebar").innerText()));
  await shot(p, "map-before-desktop");
  await p.keyboard.press("Escape");
  await tid("hud-wordbook").click();
  await tid("wordbook").waitFor();
  check("F3 wordbook: the words met so far are listed per language with picture, meaning and example — no status, count or rank", (await tid("wordbook-es").count()) === 1 && (await tid("wordbook-en").count()) === 1 && (await p.locator("[data-testid^='wordbook-word-']").count()) >= 5 && !/selbständig|%|Rang/.test(await tid("wordbook").innerText()));
  await shot(p, "wordbook-desktop");
  await p.keyboard.press("Escape");
  await goto(t, "/family/learn?child=santiago");
  await tid("world-screen", t).waitFor();
  await settle(600);
  await shot(t, "map-before");
  if (CAP_BASE) {
    const capped = await capApi(`/api/family/learning/mission?tz=${TZ}`);
    check("rollback: the version-3 cap serves the same rows with 'all visits done' (no v6 offered), four reports, no harbor", capped.status === 200 && capped.json.view.next.reason === "all-visits-done" && capped.json.view.reports.length === 4 && capped.json.view.harbor === null, capped.json?.view?.next);
  }
  // sibling isolation
  const isabel = (await api("POST", "/api/family/learning/session", { childId: "isabel" })).json?.token;
  const iv = await api("GET", `/api/family/learning/mission?tz=${TZ}`, null, assistant, isabel);
  const iput = await api("PUT", "/api/family/learning/mission", { op: { op: "start-visit" }, expectedRevision: 0, idempotencyKey: "isabel-1", context: { erasureGeneration: 0, visit: null } }, assistant, isabel);
  check("isolation: Isabel's credential sees no mission (prepared:false) and cannot mutate (404); the owner-only parent routes refuse the assistant account", iv.status === 200 && iv.json.prepared === false && iv.json.view === null && iput.status === 404 && (await api("GET", "/api/family/learning/parent/evidence?child=santiago", null, assistant)).status === 403);
});

// ---------------------------------------------------------------------------
// S2 — the full journey in the browser (planning first, then typing, then the closing check), with renders and the storage boundary
// ---------------------------------------------------------------------------
await guarded("S2", async () => {
  await productionShape();
  const row0 = await rawRow();
  await goto(p, "/family/learn/mission?child=santiago");
  await tid("start-visit").waitFor();
  check("start: the start screen names the harbor chapter and the button says Besuch 5 starten", (await tid("start-visit").getAttribute("data-visit")) === "v6" && /Besuch 5 starten/.test(await tid("start-visit").innerText()) && /Hafen/.test(await body()));
  await enterOn("start-visit");
  await tid("stage-continue").waitFor();
  const row1 = await rawRow();
  check("compat: the first write migrates the row to version 4 with exactly the additive keys harbor/reasoning/logReviews; history and the pilot upgrade date untouched", row1.contentVersion === 4 && JSON.stringify(Object.keys(row1.state).filter((k) => !(k in row0.state)).sort()) === '["harbor","logReviews","reasoning"]' && JSON.stringify(row1.state.visits.slice(0, 4)) === JSON.stringify(row0.state.visits) && row1.state.upgradedAt === row0.state.upgradedAt && Array.isArray(row1.state.visits[4].route), Object.keys(row1.state).sort());
  check("restore: the chapter's story (who / make / done) in three beats; Weiter focused", (await p.locator("[data-testid='mission-intro'] [data-testid='story-beat-item']").count()) === 3 && /38 Kisten/.test(await body()) && (await activeTestId()) === "stage-continue");
  await p.keyboard.press("Enter");
  await tid("island-stage").waitFor();
  await settle(700);
  check("F1 island hub: both workplaces open, the closing check locked; direct-entry buttons present; the avatar stands on the quay; keyboard focus on the first direct button", (await tid("island-direct-typing").getAttribute("data-status")) === "open" && (await tid("island-direct-planning").getAttribute("data-status")) === "open" && (await tid("island-direct-closing").getAttribute("data-status")) === "locked" && (await tid("island-direct-closing").isDisabled()) && (await avatarAt()) === "harbor" && (await waitActive("island-direct-typing")) === "island-direct-typing");
  await shot(p, "island-hub-desktop");
  await goto(t, "/family/learn/mission?child=santiago");
  await tid("island-stage", t).waitFor();
  await settle(500);
  await shot(t, "island-hub");
  // click/tap: walk to the office and enter planning first
  await tid("island-go-office").click();
  await tid("island-arrived").waitFor({ timeout: 10000 });
  check("F1 walk: tapping the Planungsbüro walks the avatar there (path animation) and shows the arrival card with Herr Baumann's German line and 'Eintreten'", (await avatarAt()) === "office" && (await tid("island-arrived").getAttribute("data-place")) === "office" && (await tid("island-character").getAttribute("data-language")) === "de" && (await tid("island-enter-planning").count()) === 1 && (await waitActive("island-enter-planning")) === "island-enter-planning");
  await shot(p, "island-arrived-desktop");
  await p.keyboard.press("Enter");
  await tid("math-question").waitFor();
  const routed = await rawRow();
  check("F1 route: planning first reorders the route (EQ-HARBOR right after the island, typing later), nothing done is touched", routed.state.visits[4].route.slice(1, 4).join(",") === "island,EQ-HARBOR,explain" && routed.state.visits[4].route.indexOf("typing-course") > routed.state.visits[4].route.indexOf("log") && JSON.stringify(routed.state.harbor.entered) === '["planning"]');
  check("F1 EQ-HARBOR: Herr Baumann's beat, the 38-Kisten setup, the two fields Volle Boote / Kisten übrig; the first field is focused; no generic microphone anywhere on the task", (await tid("keeper-planner").count()) === 1 && /38 Kisten/.test(await tid("math-setup").innerText()) && /Wie viele Boote werden voll/.test(await tid("math-question").innerText()) && (await tid("math-answer-full").count()) === 1 && (await waitActive("math-answer-full")) === "math-answer-full" && (await tid("mic-start").count()) === 0 && !/🎙️/.test(await p.locator("main").innerText()));
  await shot(p, "math-desktop");
  await goto(t, "/family/learn/mission?child=santiago");
  await tid("math-question", t).waitFor();
  await shot(t, "math");
  await p.keyboard.type("5");
  await p.keyboard.press("Tab");
  await p.keyboard.type("8");
  await p.keyboard.press("Enter");
  await tid("clarification").waitFor();
  const activeAfterClarify = await waitActive("math-answer-full");
  check("F2 EQ-HARBOR: a wrong part A gets the reviewed clarification (full boats first); the field is focused again", /Zähle die vollen Boote/.test(await tid("clarification").innerText()) && activeAfterClarify === "math-answer-full", activeAfterClarify);
  await p.keyboard.type("6");
  await p.keyboard.press("Tab");
  await p.keyboard.type("2");
  await p.keyboard.press("Enter");
  await tid("math-decision").waitFor();
  const activeB = await waitActive("math-answer-needed");
  check("F1 part B: after a correct part A the decision question (boats for ALL crates) appears with part A acknowledged; the needed field is focused", /Wie viele Boote braucht ihr dafür insgesamt/.test(await tid("math-question").innerText()) && /6 Boote voll, 2 Kisten übrig/.test(await tid("math-part-a").innerText()) && activeB === "math-answer-needed", activeB);
  await shot(p, "math-part-b-desktop");
  await p.keyboard.type("7");
  await p.keyboard.press("Enter");
  await tid("lesson-end").waitFor();
  const afterMath = await evidence();
  const harborAttempts = afterMath.attempts.filter((a) => a.taskId === "EQ-HARBOR");
  check("F2 EQ-HARBOR evidence: three attempts — part A wrong, part A right (supported after the clarification), part B right on its first try but still 'supported' (help on the item is cumulative and conservative); the lesson end names the correction", harborAttempts.length === 3 && harborAttempts[0].correct === false && harborAttempts[1].evidence === "supported" && harborAttempts[2].correct === true && harborAttempts[2].evidence === "supported" && harborAttempts[2].objective === "quotient-groups-needed" && (await tid("lesson-end").getAttribute("data-close")) === "corrected-with-help", harborAttempts.map((a) => [a.objective, a.correct, a.evidence]));
  check("F4: the Nabu sidebar does NOT open over the lesson end (the conversation waits for the acknowledgement)", (await tid("nabu-sidebar").count()) === 0);
  await shot(p, "math-lesson-end-desktop");
  await enterOn("lesson-continue");
  await tid("reasoning-stage").waitFor();
  await tid("nabu-sidebar").waitFor();
  check("F4 reasoning: the explanation stage opens the Nabu sidebar by itself in reasoning mode with the reviewed question; no microphone runs by itself (explicit start button, typed field)", (await tid("nabu-sidebar").getAttribute("data-mode")) === "reasoning" && /Wie hast du das gerechnet/.test(await tid("nabu-thread").innerText()) && (await tid("mic-start").count()) === 1 && (await tid("nabu-input").count()) === 1);
  await shot(p, "reasoning-open-desktop");
  // microphone failure path: the permission is not granted in this context → the recorder cannot start → trouble notice, typed path stays.
  await tid("mic-start").click();
  await tid("mic-trouble").waitFor({ timeout: 10000 });
  check("F4 mic failure: a denied/unavailable microphone shows the recoverable notice and keeps the typed path; no transcript, no audio stored", (await tid("mic-trouble").count()) === 1 && (await tid("nabu-input").count()) === 1 && (await tid("mic-stop").count()) === 0);
  await tid("nabu-input").fill("Ich habe ales mal gerechnet.");
  await tid("nabu-send").click();
  await p.locator("[data-testid='nabu-nabu']").nth(1).waitFor();
  const probe1 = await p.locator("[data-testid='nabu-nabu']").nth(1).innerText();
  check("F4 probing: a vague 'mal gerechnet' gets the reviewed multiplication probe, not a verdict; the child's line is kept verbatim", /Welche Zahlen hast du miteinander malgenommen/.test(probe1) && /ales mal gerechnet/.test(await p.locator("[data-testid='nabu-child']").first().innerText()), probe1);
  await tid("nabu-input").fill("6 mal 7 ist 42, das ist zu viel, also 6 Boote und 2 Kisten übrig");
  await tid("nabu-send").click();
  await tid("reasoning-done").waitFor();
  const reasoningMethod = await tid("reasoning-done").getAttribute("data-method");
  check("F4 valid alternative: 6 × 7 = 42 with the remainder told is ACCEPTED after one neutral probe (multiplication never presumed false); the method is 'explained after probing'", reasoningMethod === "explained-after-probing" && /passt zu den Zahlen/.test(await tid("nabu-thread").innerText()), reasoningMethod);
  await shot(p, "reasoning-done-desktop");
  await goto(t, "/family/learn/mission?child=santiago");
  await settle(600);
  await shot(t, "reasoning-sheet");
  await tid("reasoning-next").click();
  await tid("keeper-supplier").waitFor();
  const ev2 = await evidence();
  const reasoningSample = ev2.samples.filter((s) => s.kind === "reasoning_turn");
  check("F4 evidence: every child turn is a work sample (typed modality), Nabu's probe is a server line (never the child's explanation); the explanation sample carries only the child's words and the method", reasoningSample.length === 2 && reasoningSample.every((s) => s.modality === "typed") && ev2.samples.some((s) => s.kind === "explanation" && /ales mal gerechnet/.test(s.text) && !/Welche Zahlen/.test(s.text) && s.metrics?.method === "explained-after-probing") && ev2.state.reasoning["EQ-HARBOR"].probesUsed === 1, reasoningSample.map((s) => s.text));
  // Spanish supplier: Rosa's welcome in Spanish; the translation is recorded as help BEFORE it is shown
  check("F1 supplier: Rosa greets in Spanish (distinct keeper); the Spanish segment starts with her question; no microphone", (await tid("keeper-supplier").getAttribute("data-language")) === "es" && /Hola, capitán/.test(await tid("keeper-supplier").innerText()) && (await tid("language-continue-step").count()) === 1 && (await tid("mic-start").count()) === 0);
  await tid("character-translate").click();
  await tid("character-translation").waitFor();
  const glossEv = (await evidence()).supports.filter((s) => s.kind === "gloss" && s.payload?.word === "rosa-welcome");
  check("F3/F4 translation as help: 'Was heisst das?' records a gloss support on the segment before the German line is shown", glossEv.length === 1 && /Willkommen im Hafen/.test(await tid("character-translation").innerText()));
  await shot(p, "spanish-desktop");
  check("F4 focus: after the translation is shown, keyboard focus sits on the translation (never dropped to the page)", (await waitActive("character-translation")) === "character-translation");
  await tid("language-continue-step").click();
  await tid("language-input").waitFor();
  check("F3 recall before exposure: the produce step comes BEFORE any sentence shows herramientas; the word list is a help button (not opened)", /Necesitamos/.test(await body()) && (await tid("language-sentence").count()) === 0 && (await waitActive("language-input")) === "language-input");
  await p.keyboard.type("necesitamos herramientas");
  await p.keyboard.press("Enter");
  await tid("pick-cuerdas").waitFor({ timeout: 15000 });
  await tid("pick-cuerdas").click();
  await tid("pick-agua").waitFor();
  check("F3 recognition: cuerdas picked from the pictured supplies — delivered to the base (ropes for the boats)", ((await view()).base.supplies.cuerdas ?? 0) === 1);
  await tid("pick-agua").click();
  await tid("lesson-end").waitFor();
  const langEv = await evidence();
  check("F3 evidence: 'necesitamos herramientas' is independent phrase production (recall in a new context, translation help was on the segment and is recorded); cuerdas/agua recognised", langEv.attempts.some((a) => a.taskId === "LANG-ES-HARBOR/produce" && a.correct === true && a.objective === "language-es-production") && langEv.attempts.some((a) => a.taskId === "LANG-ES-HARBOR/pick" && a.correct === true) && langEv.attempts.some((a) => a.taskId === "LANG-ES-HARBOR/reuse" && a.correct === true), langEv.attempts.filter((a) => a.taskId.startsWith("LANG-ES-HARBOR")).map((a) => [a.taskId, a.evidence, a.support]));
  await enterOn("lesson-continue");
  await tid("harbor-plan").waitFor();
  check("F1 plan: the saved arithmetic (6 full, 2 left, 7 boats) and the three reviewed destinations; ropes acknowledged; first destination focused", /6 Boote sind voll, 2 Kisten bleiben übrig — 7 Boote fahren los/.test(await tid("harbor-plan-load").innerText()) && (await tid("harbor-destination-lighthouse").count()) === 1 && /Seilen von Rosa/.test(await body()) && (await waitActive("harbor-destination-lighthouse")) === "harbor-destination-lighthouse");
  await shot(p, "plan-desktop");
  await p.keyboard.press("Enter");
  await tid("log-input").waitFor();
  const afterPlan = await view();
  check("F1 world change: after the acknowledged plan the saved island has 6 loaded boats, the leftover crates, the destination and the ropes", afterPlan.scene.harbor.planned && afterPlan.scene.harbor.destination === "lighthouse" && afterPlan.scene.harbor.roped && afterPlan.scene.harbor.fullBoats === 6 && afterPlan.scene.harbor.remaining === 2, afterPlan.scene.harbor);
  check("F2 captain's log: Herr Baumann asks for one own sentence; the prompt names what was built or transported; the field is focused; no microphone", /Kapitänslogbuch/.test(await body()) && /gebaut oder transportiert/.test(await body()) && (await waitActive("log-input")) === "log-input" && (await tid("mic-start").count()) === 0);
  await p.reload();
  await p.waitForLoadState("load");
  await tid("log-input").waitFor();
  check("reload mid-visit resumes at the same stage (log) with the same route; the plan survived", (await view()).visit?.stage === "log" && (await view()).scene.harbor.planned === true);
  await p.keyboard.type("wir haben 6 bote beladen und 2 kisten sind übrig");
  await tid("log-save").click();
  await tid("island-stage").waitFor();
  await settle(600);
  check("F1 island after planning: the office is done, the workshop open, the closing check still locked; the avatar stands at the office", (await tid("island-direct-planning").getAttribute("data-status")) === "done" && (await tid("island-direct-typing").getAttribute("data-status")) === "open" && (await tid("island-direct-closing").getAttribute("data-status")) === "locked" && (await avatarAt()) === "office");
  await shot(p, "island-after-planning-desktop");
  // keyboard-only movement: focus the stage, ArrowLeft walks from the office to the workshop, Enter enters
  await p.focus("[data-testid='island-svg']");
  await p.keyboard.press("ArrowLeft");
  await settle(1400);
  await tid("island-arrived").waitFor();
  check("F1 keyboard: ArrowLeft from the office walks to the Tipp-Werkstatt; the arrival card shows Mrs Finley's English line and the enter control takes focus", (await avatarAt()) === "workshop" && (await tid("island-character").getAttribute("data-language")) === "en" && /Welcome back/.test(await tid("island-character").innerText()) && (await waitActive("island-enter-typing")) === "island-enter-typing");
  await p.keyboard.press("Enter");
  await tid("typing-course").waitFor();
  // The saved progression decision (two good rounds → lesson 2 is free) is shown first, as released; the child starts the next lesson.
  if ((await tid("decision-card").count()) > 0) {
    check("F1 typing workshop: the saved decision card (lesson 2 free) is shown before any round — nothing replayed", (await tid("decision-card").getAttribute("data-decision")) === "advance");
    await tid("another-burst").click();
  }
  await tid("course-input").waitFor();
  check("F1 typing workshop: Mrs Finley's English line with a translation on tap; the Swiss-German course continues at the saved lesson 2 (d/k), hands cue compact; instruction unaffected by the keeper's language", (await tid("keeper-keeper").getAttribute("data-language")) === "en" && (await tid("typing-course").getAttribute("data-lesson")) === "TYPE-CH-COURSE-2" && (await tid("hands-keyboard").getAttribute("data-compact")) === "true" && /Jetzt: „d“/.test(await body()));
  await shot(p, "typing-desktop");
  await typeLine(p, "course-input", "ddd kkk");
  await typeLine(p, "course-input", "fdk jkd");
  await tid("comfort-ok").waitFor();
  await enterOn("comfort-ok");
  await tid("lesson-end").waitFor();
  await enterOn("lesson-continue");
  await tid("decision-card").waitFor();
  await tid("course-continue").click();
  await tid("island-stage").waitFor();
  await settle(500);
  check("F1 island after both: the closing check opens (Hafenmeister), both workplaces done", (await tid("island-direct-closing").getAttribute("data-status")) === "open" && (await tid("island-direct-typing").getAttribute("data-status")) === "done" && /Beides geschafft/.test(await body()));
  await shot(p, "island-closing-open-desktop");
  await tid("island-direct-closing").click();
  await tid("math-question").waitFor();
  check("F2 closing check (a): a fresh small variation (26 Kisten, 5 pro Boot) — same-day application, labelled as a check", /26 Kisten/.test(await tid("math-setup").innerText()) && (await view()).math?.id === "EQ-HARBOR-CHECK");
  await p.keyboard.type("5");
  await p.keyboard.press("Tab");
  await p.keyboard.type("1");
  await p.keyboard.press("Enter");
  await tid("math-decision").waitFor();
  await p.keyboard.type("6");
  await p.keyboard.press("Enter");
  await tid("lesson-end").waitFor();
  check("F2 closing check (a) evidence: both parts independent on the first attempt", (await evidence()).attempts.filter((a) => a.taskId === "EQ-HARBOR-CHECK").every((a) => a.evidence === "independent") && (await tid("lesson-end").getAttribute("data-close")) === "none-needed");
  await enterOn("lesson-continue");
  await tid("language-input").waitFor();
  check("F2 closing check (b): recall of the word met today (cuerdas) without the sentence that showed it", /Necesitamos/.test(await body()) && (await tid("language-sentence").count()) === 0 && (await view()).language?.id === "LANG-ES-HARBOR-CHECK");
  await p.keyboard.type("necesitamos cuerdas");
  await p.keyboard.press("Enter");
  await tid("lesson-end").waitFor();
  await enterOn("lesson-continue");
  await tid("log-review").waitFor();
  const reviewView = await view();
  check("F2 closing check (c) writing review: the child's own sentence with a broad diagnosis, TWO taught points (capitalisation, spelling), the clean aspects named, punctuation deferred, the suggestion shown as help, no 'alles richtig'", (await tid("log-review").getAttribute("data-taught")) === "capitalization,spelling" && (await p.locator("[data-testid='log-review-point']").count()) === 3 && /Geprüft und in Ordnung: Inhalt, ganzer Satz, Leerzeichen/.test(await tid("log-review-summary").innerText()) && /Satzzeichen kommt ein andermal/.test(await tid("log-review-summary").innerText()) && (await tid("log-review-suggestion").count()) === 1 && !/alles richtig/i.test(await body()) && reviewView.logReview.unknownWords.length === 0 && (await waitActive("log-review-input")) === "log-review-input");
  await shot(p, "log-review-desktop");
  await goto(t, "/family/learn/mission?child=santiago");
  await tid("log-review", t).waitFor();
  await shot(t, "log-review");
  await tid("log-review-input").fill("Wir haben 6 Boote beladen und 2 Kisten sind übrig.");
  await tid("log-review-save").click();
  await tid("lesson-end").waitFor();
  const reviewEv = (await evidence()).state.logReviews.at(-1);
  check("F2 revision evidence: original kept, revision stored apart, all taught points resolved, evaluated as supported (the suggestion was shown) — never 'independent' after shown help; the own end mark is not a copied suggestion", reviewEv.original === "wir haben 6 bote beladen und 2 kisten sind übrig" && reviewEv.revised === "Wir haben 6 Boote beladen und 2 Kisten sind übrig." && reviewEv.outcome === "revised" && reviewEv.evaluation.copiedSuggestion === false && (await evidence()).attempts.some((a) => a.taskId === "WRITE-LOG-HARBOR" && a.evidence === "supported" && a.correct === true) && (await tid("lesson-end").getAttribute("data-close")) === "corrected-with-practice", reviewEv.evaluation);
  await shot(p, "writing-lesson-end-desktop");
  await enterOn("lesson-continue");
  await tid("summary").waitFor();
  await tid("summary-next-button").click();
  await tid("reflect").waitFor();
  await tid("difficulty-right").click();
  await tid("enjoyment-yes").click();
  await tid("clarity-clear").click();
  await tid("reflect-submit").click();
  await tid("visit-report").waitFor();
  const done = await view();
  check("F2 report: opens by itself after the visit (Besuch 5, complete); the world block lists the loaded boats, the ropes, the plan and the revised log; the artifact is the child's revised sentence; count 5; no sixth visit promised", (await tid("visit-report").getAttribute("data-report-visit")) === "v6" && (await tid("visit-report").getAttribute("data-report-partial")) === "false" && /6 Boote voll beladen, 2 Kisten übrig, 7 Boote für alle/.test(await tid("report-world").innerText()) && /mit Seilen festgemacht/.test(await tid("report-world").innerText()) && (await tid("report-artifact").getAttribute("data-artifact-kind")) === "log-review" && !/Besuch 6/.test(await body()) && done.progress.completedTotal === 5 && done.next.reason === "all-visits-done", { next: done.next, total: done.progress.completedTotal });
  check("F2 report lessons: math (harbor), language (supplier), typing, math (check), language (check), writing (review) — each with its honest close", (await p.locator("[data-testid='report-lesson']").count()) === 6 && (await p.locator("[data-testid='report-lesson'][data-lesson-kind='writing']").getAttribute("data-close")) === "corrected-with-practice");
  await shot(p, "report-desktop");
  await shot(p, "report-full-desktop", { full: true });
  await goto(t, p.url().replace(BASE, ""));
  await tid("visit-report", t).waitFor();
  await shot(t, "report");
  await tid("report-back").click();
  await tid("world-screen").waitFor();
  await settle(600);
  const mapFacts = { harbor: await worldAttr(p, "data-world-harbor"), boats: await p.locator("[data-testid='world-screen'] [data-part='harbor-boat']").count(), roped: await p.locator("[data-testid='world-screen'] [data-part='harbor']").first().getAttribute("data-harbor-roped"), signpost: await p.locator("[data-testid='world-screen'] [data-part='signpost']").count(), v6: await siteState(p, "v6"), next: await worldAttr(p, "data-world-next"), action: (await tid("world-action").innerText()).slice(0, 80) };
  check("F1 map after: 7 boats (6 full + the leftovers), roped, the signpost to the lighthouse island, Besuch 5 flagged done, no further action", mapFacts.harbor === "planned" && mapFacts.boats === 7 && mapFacts.roped === "yes" && mapFacts.signpost === 1 && mapFacts.v6 === "done" && mapFacts.next === "" && /Alle Besuche|Alles gespeichert/.test(mapFacts.action), mapFacts);
  await shot(p, "map-after-desktop");
  await goto(t, "/family/learn?child=santiago");
  await tid("world-screen", t).waitFor();
  await settle(600);
  await shot(t, "map-after");
  await tid("world-site-v6").click();
  await tid("visit-report").waitFor();
  check("F2 reopen: the report reopens from the map flag and from the URL after a reload", (await tid("visit-report").getAttribute("data-report-visit")) === "v6");
  for (let i = 0; i < 40 && !/report=v6/.test(p.url()); i += 1) await settle(100);
  await p.reload();
  await p.waitForLoadState("load");
  await tid("visit-report").waitFor();
  check("F2 reopen after reload: ?report=v6 restores the report", (await tid("visit-report").getAttribute("data-report-visit")) === "v6" && /report=v6/.test(p.url()));
  await p.keyboard.press("Escape");
  // wordbook after the visit: German words met through the captain's log
  await tid("hud-wordbook").click();
  await tid("wordbook").waitFor();
  check("F3 wordbook after: German words from the captain's log (Boot, Kiste, übrig) and the Spanish supplier words (cuerdas, herramientas) are listed; nothing is scored", (await tid("wordbook-de").count()) === 1 && (await tid("wordbook-word-DE-BOOT").count()) === 1 && (await tid("wordbook-word-ES-CUERDAS").count()) === 1 && !/selbständig|%|Rang/.test(await tid("wordbook").innerText()));
  await shot(p, "wordbook-after-desktop");
  await p.keyboard.press("Escape");
  const ev = await evidence();
  const v6 = ev.completions.filter((c) => c.visitId === "v6");
  const de = ev.vocabulary.entries.filter((e) => e.language === "de");
  const herr = ev.vocabulary.entries.find((e) => e.entryId === "ES-HERRAMIENTAS").dimensions.recall;
  const herrObs = ev.vocabulary.observations.find((o) => o.entryId === "ES-HERRAMIENTAS" && o.dimension === "recall" && o.taskId === "LANG-ES-HARBOR");
  check("parent evidence: exactly one review for Besuch 5 (content version 4, current rules); five reviews in total; the ledger has 9 German entries with writing observations from the typed ORIGINAL (bote → incorrect, übrig → independent); herramientas was recalled correctly but AFTER Rosa's translation was opened — recorded as supported (gloss), never independent; cuerdas recalled the same day independently, never 'repeated'", v6.length === 1 && v6[0].contentVersion === 4 && v6[0].derivation?.status === "current" && ev.completions.length === 5 && de.length === 9 && de.find((e) => e.entryId === "DE-BOOT").dimensions.writing.incorrect === 1 && de.find((e) => e.entryId === "DE-UEBRIG").dimensions.writing.independentCorrect === 1 && herr.status === "supported-only" && herr.supportedCorrect === 1 && herrObs?.support.includes("gloss") && ev.vocabulary.entries.find((e) => e.entryId === "ES-CUERDAS").dimensions.recall.status === "independent" && ev.visits.some((x) => x.id === "v6" && x.ordinal === 5), { completions: ev.completions.map((c) => [c.visitId, c.contentVersion]), herr: [herr.status, herrObs?.support], de: de.map((e) => [e.entryId, e.dimensions.writing.status]) });
  const review = v6[0].review;
  check("parent review: answer vs reasoning separated (EQ-HARBOR attempts + EQ-HARBOR/reasoning objective), the captain's log review line with original/taught/clean/revision, independent vs supported per objective, missingness listed", review.learning.objectives.some((o) => o.taskId === "EQ-HARBOR/reasoning" && o.evidence === "independent") && review.learning.objectives.some((o) => o.taskId === "WRITE-LOG-HARBOR" && o.evidence === "supported") && review.learning.whatHappened.some((w) => /Kapitänslogbuch/.test(w) && /Original „wir haben 6 bote/.test(w)) && review.experience.missing.length > 0, review.learning.objectives.map((o) => [o.taskId, o.evidence]));
  // stale tab and replay at the storage boundary
  const rowDone = await rawRow();
  const stale = await api("PUT", "/api/family/learning/mission", { op: { op: "start-visit" }, expectedRevision: rowDone.state.revision - 3, idempotencyKey: `stale-${Date.now()}`, context: { erasureGeneration: 0, visit: null }, tz: TZ }, assistant, bearer);
  const rowAfter = await rawRow();
  check("stale tab: a request from an older view is refused (409 stale) and the stored row is unchanged", stale.status === 409 && stale.json?.status === "stale" && JSON.stringify(rowAfter.state) === JSON.stringify(rowDone.state), { status: stale.status });
  await goto(p, "/family/learn/parent");
  await settle(800);
  await p.locator("button[role='tab']", { hasText: "Deutsch" }).first().click().catch(() => {});
  await settle(400);
  await shot(p, "parent-de-desktop", { full: true });
});

// ---------------------------------------------------------------------------
// S3 — idempotency and the version-3 cap: a replayed key returns the stored outcome; the cap parks a running v6 untouched
// ---------------------------------------------------------------------------
await guarded("S3", async () => {
  await productionShape();
  await op({ op: "start-visit" });
  await op({ op: "resume-base" });
  const first = await opRaw({ op: "enter-workplace", workplace: "planning" }, "replay-key-1");
  const again = await opRaw({ op: "enter-workplace", workplace: "planning" }, "replay-key-1");
  check("idempotency: the same key twice applies once and replays the stored outcome (no second route change, no second entry)", first.json.status === "applied" && again.json.status === "replayed" && JSON.stringify((await rawRow()).state.harbor.entered) === '["planning"]', { first: first.json.status, again: again.json.status });
  const before = await rawRow();
  if (!CAP_BASE) {
    check("rollback cap: --cap-base given", false, "no capped server");
    return;
  }
  const capped = await capApi(`/api/family/learning/mission?tz=${TZ}`);
  check("rollback: the version-3 cap reads the same rows, parks the running Besuch 5 (chapter-unavailable), counts 4 completions, narrates 4 reports, keeps the pier; no harbor view", capped.status === 200 && capped.json.view.visit === null && capped.json.view.next.reason === "chapter-unavailable" && capped.json.view.progress.completedTotal === 4 && capped.json.view.reports.length === 4 && capped.json.view.scene.pier.built === true && capped.json.view.harbor === null, { status: capped.status, next: capped.json?.view?.next });
  const refused = await fetch(CAP_BASE + "/api/family/learning/mission", { method: "PUT", headers: { cookie: `${COOKIE}=${assistant}`, authorization: "Bearer " + bearer, "content-type": "application/json" }, body: JSON.stringify({ op: { op: "start-visit" }, expectedRevision: capped.json.view.revision, idempotencyKey: `cap-${Date.now()}`, context: { erasureGeneration: 0, visit: null }, tz: TZ }) });
  const after = await rawRow();
  check("rollback: the capped build refuses to start anything (refused or stale, never applied) and writes nothing", (refused.status === 422 || refused.status === 409) && JSON.stringify(after.state) === JSON.stringify(before.state) && after.contentVersion === before.contentVersion, { status: refused.status });
  const parent = await fetch(CAP_BASE + "/api/family/learning/parent/evidence?child=santiago", { redirect: "manual", headers: { cookie: `${COOKIE}=${owner}` } });
  const parentJson = await parent.json();
  check("rollback: the parent cockpit on the capped build still reads every row (4 reviews, 5 visits incl. the parked one)", parent.status === 200 && parentJson.completions.length === 4 && parentJson.state.visits.length === 5);
  const resumed = await view();
  check("forward: the uncapped build resumes exactly at EQ-HARBOR with the chosen route, nothing rewritten", resumed.visit?.id === "v6" && resumed.visit?.stage === "EQ-HARBOR" && JSON.stringify((await rawRow()).state) === JSON.stringify(before.state));
  check("no browser page errors", pageErrors.length === 0, pageErrors.slice(0, 3));
});

await browser.close();
const summary = { base: BASE, capBase: CAP_BASE, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results, screenshots: shots, pageErrors };
fs.writeFileSync(path.join(OUT, "visit5-results.json"), JSON.stringify(summary, null, 2));
console.log(`\nvisit5: ${summary.passed} passed, ${summary.failed} failed → ${OUT}`);
process.exit(summary.failed === 0 ? 0 : 1);
