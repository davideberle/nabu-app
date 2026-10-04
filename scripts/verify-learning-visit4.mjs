// Visit 4 (content version 3, 2026-10-04) — browser + HTTP + database evidence for V4-2 … V4-6: the new
// chapter `v5` (Besuch 4) is the one next action from the completed-three-visits shape, the full journey
// (restore → typing course → EQ-PIER → explain → LANG-EN-PIER → pier build → log → revise → transfer →
// summary → reflect → report → map) with desktop/tablet renders, reload/stale/replay recovery, the
// deduplicated parent review, and the version-2 cap parking a running v5 without writing anything. LOCAL production server, synthetic
// AUTH_SECRET, isolated NABU_DB_DIR; headless Chromium with the project audio guard.
//
//   AUTH_SECRET=<server secret> node scripts/verify-learning-visit4.mjs --base http://127.0.0.1:3172 \
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
const CAP_BASE = opt("--cap-base", null); // a second server of the same build with FAMILY_LEARNING_CONTENT_CAP=2 on the same database
const OUT = opt("--out", "/tmp/family-learning-visit4");
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
  console.log(ok ? "PASS" : "FAIL", "[visit4]", name, detail === undefined ? "" : JSON.stringify(detail).slice(0, 400));
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
async function op(o, key = `v4j-${(opN += 1)}`) {
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
  const file = `visit4-${name}${page === t ? "-tablet" : ""}.png`;
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
      await p.screenshot({ path: path.join(OUT, `visit4-FAILURE-${name}.png`), fullPage: true });
      fs.writeFileSync(path.join(OUT, `visit4-FAILURE-${name}.txt`), await p.locator("body").innerText());
    } catch {
      /* ignore */
    }
  }
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
/** v1 + v2 + the station chapter finished through the API, then the row stripped to the released shape (no `pier`, version 2). */
async function productionShape() {
  await resetTwoVisits();
  await toTypingCourse("turtles");
  await op({ op: "typing-course-continue" });
  await op({ op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" });
  await ack();
  for (const o of [{ op: "explain", text: "Fünf mal sechs sind dreissig.", modality: "typed" }, lang("LANG-ES-STATION", "listen", "", "listen"), lang("LANG-ES-STATION", "pick", "lámpara", "word-choice"), lang("LANG-ES-STATION", "produce", "necesitamos una lámpara"), lang("LANG-ES-STATION", "reuse", "agua", "word-choice")]) await op(o);
  await ack();
  for (const o of [{ op: "build-station", spot: "beach" }, { op: "save-log", text: "Heute steht die Station." }, { op: "revise-log", text: "Heute steht die Station." }, { op: "write-transfer", text: "Morgen zählen wir 3 Schildkröten.", modality: "typed" }]) await op(o);
  await ack();
  await op({ op: "summary-seen" });
  await op({ op: "reflect", optionId: "easy" });
  await patchRow((s) => {
    delete s.pier;
    s.contentVersion = 2;
    return s;
  });
}
async function capApi(path) {
  const r = await fetch(CAP_BASE + path, { redirect: "manual", headers: { cookie: `${COOKIE}=${assistant}`, authorization: "Bearer " + bearer } });
  let json = null;
  try {
    json = await r.json();
  } catch {
    json = null;
  }
  return { status: r.status, json };
}
const worldAttr = (page, name) => (name === "data-world-pier" || name === "data-world-boat" ? page.locator("[data-testid='world-screen'] [data-world-variant='full']").first() : tid("world-screen", page)).getAttribute(name);
const siteState = (page, visit) => page.locator(`[data-part='site'][data-visit='${visit}']`).getAttribute("data-state");

// ---------------------------------------------------------------------------
// S1 — V4-2: the one next action from the completed-three-visits shape; empty and partial shapes unchanged
// ---------------------------------------------------------------------------
await guarded("S1", async () => {
  await productionShape();
  const row0 = await rawRow();
  check("fixture: the stored row is the released shape (content version 2, three finished visits, no pier key)", row0.contentVersion === 2 && row0.state.visits.filter((v) => v.finishedAt).length === 3 && !("pier" in row0.state), { visits: row0.state.visits.map((v) => v.id) });
  const v = await view();
  check("V4-2: exactly one next action — Besuch 4 (internal v5), available now, not the retired v3, no replay", v.next.visit === "v5" && v.next.ordinal === 4 && v.next.availableAt === null && v.progress.next.kind === "start" && v.progress.next.label === "Besuch 4 — Der Steg in der Bucht" && v.progress.completedTotal === 3 && v.reports.length === 3, v.next);
  const row1 = await rawRow();
  check("V4-2: reads (migration on load) do not rewrite the stored row; repeated reads are identical", JSON.stringify(row1.state) === JSON.stringify(row0.state) && row1.contentVersion === 2 && JSON.stringify((await view()).next) === JSON.stringify(v.next));
  await goto(p, "/family/learn?child=santiago");
  await tid("world-screen").waitFor();
  check("V4-2 world: the map flags Besuch 4 as next and offers 'Besuch 4 starten' as the one action", (await worldAttr(p, "data-world-next")) === "v5" && (await tid("world-site-v5").count()) === 1 && (await siteState(p, "v5")) === "next" && /Besuch 4 starten/.test(await tid("cockpit-start").innerText()) && (await tid("world-action").count()) === 1);
  await shot(p, "world-before-desktop");
  await goto(t, "/family/learn?child=santiago");
  await tid("world-screen", t).waitFor();
  await shot(t, "world-before");
  await api("DELETE", "/api/family/learning/parent/records?child=santiago&confirm=santiago", null, owner);
  bearer = (await api("POST", "/api/family/learning/session", { childId: "santiago" })).json?.token;
  const empty = await view();
  check("V4-2 empty: a fresh child still starts with Besuch 1", empty.next.visit === "v1" && empty.progress.completedTotal === 0);
  await resetTwoVisits();
  await toTypingCourse("turtles");
  const partial = await view();
  check("V4-2 partial: a running station chapter continues as Besuch 3; Besuch 4 is not offered yet", partial.visit?.id === "v4" && partial.next.visit === "v4" && partial.progress.next.kind === "continue" && partial.progress.completedTotal === 2);
});

// ---------------------------------------------------------------------------
// S2 — V4-3 / V4-4 / V4-5: the full new journey in the browser, with reload, replay and renders
// ---------------------------------------------------------------------------
await guarded("S2", async () => {
  await productionShape();
  const row0 = await rawRow();
  const evBefore = await evidence();
  const versionsBefore = Object.fromEntries(evBefore.completions.map((c) => [c.visitId, c.contentVersion]));
  await goto(p, "/family/learn/mission?child=santiago");
  await tid("start-visit").waitFor();
  check("V4-2 mission start: the start screen names the new chapter and the button says Besuch 4 starten", (await tid("start-visit").getAttribute("data-visit")) === "v5" && /Besuch 4 starten/.test(await tid("start-visit").innerText()) && /Steg in der Bucht/.test(await body()));
  await shot(p, "start-desktop");
  await enterOn("start-visit");
  await tid("stage-continue").waitFor();
  const row1 = await rawRow();
  check("V4-6 migration on the first write: the row is now version 3 with exactly one additive key (pier); history and the pilot upgrade date untouched", row1.contentVersion === 3 && row1.state.contentVersion === 3 && JSON.stringify(Object.keys(row1.state).filter((k) => !(k in row0.state))) === '["pier"]' && JSON.stringify(row1.state.visits.slice(0, 3)) === JSON.stringify(row0.state.visits) && row1.state.upgradedAt === row0.state.upgradedAt);
  check("V4-4 restore: the chapter's story (who / make / done) is shown as three illustrated beats; Weiter is focused", (await p.locator("[data-testid='mission-intro'] [data-testid='story-beat-item']").count()) === 3 && /Kapitän|Boot/.test(await body()) && (await activeTestId()) === "stage-continue");
  await shot(p, "restore-desktop");
  await goto(t, "/family/learn/mission?child=santiago");
  await tid("stage-continue", t).waitFor();
  await shot(t, "restore");
  await p.keyboard.press("Enter");
  await settle(400);
  // the first-use placement demo may open here (no round yet in this course state): it is skippable, as the brief allows
  if ((await tid("placement-demo").count()) > 0) {
    check("V4-4 typing: the first-use hands demonstration opens before the first round and can be skipped by keyboard", (await tid("demo-skip").count()) === 1);
    await tid("demo-skip").click();
  }
  await tid("course-input").waitFor();
  check("V4-1 typing: the course continues with the introduced keys (lesson 1, f/j/space) and the compact hands cue", (await tid("hands-keyboard").getAttribute("data-next-key")) === "f" && (await tid("hands-keyboard").getAttribute("data-compact")) === "true");
  await typeLine(p, "course-input", "fff jjj");
  await typeLine(p, "course-input", "fj fj jf");
  await tid("comfort-ok").waitFor();
  await enterOn("comfort-ok");
  await tid("lesson-end").waitFor();
  await enterOn("lesson-continue");
  await tid("decision-card").waitFor();
  await tid("course-continue").click();
  await tid("math-question").waitFor();
  check("V4-1 EQ-PIER: the richer remainder task (45 Bretter, 6 Abschnitte à 7) with setup, question and the Verbaut field", /45 Bretter/.test(await tid("math-setup").innerText()) && /Wie viele Bretter werden verbaut/.test(await tid("math-question").innerText()) && /Verbaut/.test(await body()) && (await activeTestId()) === "math-answer-used" && (await tid("reminder").count()) === 0);
  await shot(p, "math-desktop");
  await goto(t, "/family/learn/mission?child=santiago");
  await tid("math-question", t).waitFor();
  await shot(t, "math");
  await p.keyboard.type("42");
  await p.keyboard.press("Tab");
  await p.keyboard.type("3");
  await p.keyboard.press("Enter");
  await tid("lesson-end").waitFor();
  const mathView = await view();
  check("V4-3 EQ-PIER: 42 verbaut, 3 übrig is independent on the first typed attempt; the lesson end names it with the verbaut wording", !!mathView.lastLesson?.success?.text.includes("42 verbaut, 3 übrig — ohne Hilfe, beim ersten Versuch") && (await tid("lesson-end").getAttribute("data-close")) === "none-needed" && (await evidence()).attempts.some((a) => a.taskId === "EQ-PIER" && a.evidence === "independent"), mathView.lastLesson?.success);
  await shot(p, "math-lesson-end");
  await enterOn("lesson-continue");
  await tid("explain-input").waitFor();
  await p.keyboard.type("Sechs mal sieben sind 42, drei Bretter bleiben.");
  await p.locator("form:has([data-testid='explain-input']) button[type='submit']").click();
  await tid("language-continue-step").waitFor();
  check("V4-1 LANG-EN-PIER: the English request starts with the captain's sentence (each word a tappable button)", (await tid("language-sentence").innerText()).replace(/\s+/g, " ").includes("We need wood for the pier"));
  await shot(p, "english-listen");
  await enterOn("language-continue-step");
  await tid("pick-wood").waitFor();
  await tid("pick-wood").click();
  await tid("language-input").waitFor();
  check("V4-3 pick: wood is delivered to the base (durable supply)", ((await view()).base.supplies.wood ?? 0) === 1);
  await p.keyboard.type("we need wood");
  await p.keyboard.press("Enter");
  await tid("pick-rope").waitFor({ timeout: 15000 });
  await tid("pick-rope").click();
  await tid("lesson-end").waitFor();
  const langView = await view();
  const produce = langView.lastLesson;
  check("V4-3 production: 'we need wood' is phrase production without help; rope delivered; the lesson closes with no mistake", !!produce?.success?.text.includes("auf Englisch gesagt: „we need wood“ — ohne Hilfe") && produce?.close.kind === "none-needed" && (langView.base.supplies.rope ?? 0) === 1 && (await evidence()).attempts.some((a) => a.taskId === "LANG-EN-PIER/produce" && a.evidence === "independent"), produce?.success);
  await shot(p, "english-lesson-end");
  await enterOn("lesson-continue");
  await tid("pier-build").waitFor();
  check("V4-4 pier build: one instruction, the reviewed spots, wood acknowledged; the first spot is focused; the world has no pier yet", (await tid("pier-spot-bay").count()) === 1 && (await tid("pier-spot-beach").count()) === 1 && /Boot macht am Steg fest/.test(await body()) && (await activeTestId()) === "pier-spot-bay" && (await view()).scene.pier.built === false);
  await shot(p, "pier-build-desktop");
  await goto(t, "/family/learn/mission?child=santiago");
  await tid("pier-build", t).waitFor();
  await shot(t, "pier-build");
  await p.keyboard.press("Enter");
  await tid("log-input").waitFor();
  const afterBuild = await view();
  check("V4-4 world change: after the acknowledged build the saved world has the pier in the bay with the boat moored", afterBuild.scene.pier.built === true && afterBuild.scene.pier.spot === "bay" && afterBuild.scene.pier.boat === true && afterBuild.scene.pier.sections === 6 && afterBuild.scene.pier.planksLeft === 3, afterBuild.scene.pier);
  await p.reload();
  await p.waitForLoadState("load");
  await tid("log-input").waitFor();
  check("V4-2 reload mid-visit resumes at the same stage (log) with the field focused; the pier survived the reload", (await activeTestId()) === "log-input" && (await view()).visit?.stage === "log" && (await view()).scene.pier.built === true);
  await p.keyboard.type("Heute steht der Steg in der Bucht.");
  await tid("log-save").click();
  await tid("revise-input").waitFor();
  check("V4-3 revise: the page without reviewed gaps is reported as 'passt' and moves on with its own Weiter (no invented correction)", (await tid("revise-none").count()) === 1);
  if ((await tid("revise-input").inputValue()) === "") await tid("revise-input").fill("Heute steht der Steg in der Bucht.");
  await tid("revise-save").click();
  await tid("transfer-input").waitFor();
  check("V4-1 transfer: the second fresh check WRITE-TRANSFER-2 asks for a number", /wie viele davon/.test(await body()) && (await view()).transfer?.id === "WRITE-TRANSFER-2");
  await p.keyboard.type("Morgen bringt das Boot 5 Kisten.");
  await tid("transfer-save").click();
  await tid("lesson-end").waitFor();
  check("V4-3 transfer: a clean typed sentence with two reviewed boundaries is limited evidence, never more", (await tid("lesson-end").getAttribute("data-close")) === "none-needed" && (await evidence()).state.transfers.at(-1).assessed === 2);
  await enterOn("lesson-continue");
  await tid("summary").waitFor();
  check("V4-5 summary: success, practice and next step; the artifact names the saved page", (await tid("summary-success").count()) === 1 && (await tid("summary-artifact").count()) === 1);
  await shot(p, "summary-desktop");
  await tid("summary-next-button").click();
  await tid("reflect").waitFor();
  await tid("difficulty-right").click();
  await tid("enjoyment-yes").click();
  await tid("clarity-clear").click();
  await tid("reflect-submit").click();
  await tid("visit-report").waitFor();
  const done = await view();
  check("V4-5 report: the finished visit opens its complete report (Besuch 4), the world block names the pier and the boat, the next step promises no fifth visit; completion count is now 4", (await tid("visit-report").getAttribute("data-report-visit")) === "v5" && (await tid("visit-report").getAttribute("data-report-partial")) === "false" && /Steg gebaut — das Boot hat angelegt/.test(await tid("report-world").innerText()) && !/Besuch 5/.test(await body()) && done.progress.completedTotal === 4 && done.next.reason === "all-visits-done", { next: done.next, total: done.progress.completedTotal });
  await shot(p, "report-desktop");
  await shot(p, "report-full-desktop", { full: true });
  await goto(t, p.url().replace(BASE, ""));
  await tid("visit-report", t).waitFor();
  await shot(t, "report");
  await tid("report-back").click();
  await tid("world-screen").waitFor();
  await settle(600);
  const mapFacts = { pier: await worldAttr(p, "data-world-pier"), boat: await worldAttr(p, "data-world-boat"), v5: await siteState(p, "v5"), next: await worldAttr(p, "data-world-next"), pierParts: await p.locator("[data-testid='world-screen'] [data-part='pier']").count(), boatParts: await p.locator("[data-testid='world-screen'] [data-part='boat']").count(), action: (await tid("world-action").innerText()).slice(0, 80) };
  check("V4-4 map: the pier and the moored boat are drawn, Besuch 4 is flagged done, and the one honest message is 'alle Besuche geschafft' (no further action)", mapFacts.pier === "built" && mapFacts.boat === "moored" && mapFacts.v5 === "done" && mapFacts.next === "" && mapFacts.pierParts >= 1 && mapFacts.boatParts >= 1 && /Alle Besuche|Alles gespeichert/.test(mapFacts.action), mapFacts);
  await shot(p, "world-after-desktop");
  await goto(t, "/family/learn?child=santiago");
  await tid("world-screen", t).waitFor();
  await settle(600);
  await shot(t, "world-after");
  await tid("world-site-v5").click();
  await tid("visit-report").waitFor();
  check("V4-5 reopen: the report reopens from the map flag", (await tid("visit-report").getAttribute("data-report-visit")) === "v5");
  await p.keyboard.press("Escape");
  const ev = await evidence();
  const v5 = ev.completions.filter((c) => c.visitId === "v5");
  check("V4-5 parent: exactly one review for Besuch 4 (content version 3, current rules); the three earlier reviews keep their stored versions; the ledger shows the new English words", v5.length === 1 && v5[0].contentVersion === 3 && v5[0].derivation?.status === "current" && ev.completions.length === 4 && ev.completions.filter((c) => c.visitId !== "v5").every((c) => c.contentVersion === versionsBefore[c.visitId]) && ev.vocabulary.entries.some((e) => e.entryId === "EN-WOOD" && e.dimensions.recall.opportunities === 1) && ev.state.visits.length === 4 && ev.visits.some((x) => x.id === "v5" && x.ordinal === 4), { before: versionsBefore, completions: ev.completions.map((c) => [c.visitId, c.contentVersion]) });
  const rowDone = await rawRow();
  const stale = await api("PUT", "/api/family/learning/mission", { op: { op: "start-visit" }, expectedRevision: rowDone.state.revision - 3, idempotencyKey: `stale-${Date.now()}`, context: { erasureGeneration: 0, visit: null }, tz: TZ }, assistant, bearer);
  const rowAfter = await rawRow();
  check("V4-2 stale tab: a request from an older view is refused (stale) and the stored row is unchanged", stale.status === 409 && stale.json?.status === "stale" && JSON.stringify(rowAfter.state) === JSON.stringify(rowDone.state), { status: stale.status, body: stale.json?.status });
  await goto(p, "/family/learn/parent");
  await settle(800);
  await shot(p, "parent-desktop", { full: true });
});

// ---------------------------------------------------------------------------
// S3 — V4-6: the version-2 cap on the same database parks a running v5 untouched; removing it resumes exactly
// ---------------------------------------------------------------------------
await guarded("S3", async () => {
  if (!CAP_BASE) {
    check("V4-6 cap: --cap-base given", false, "no capped server");
    return;
  }
  await productionShape();
  await op({ op: "start-visit" });
  await op({ op: "resume-base" });
  await op({ op: "skip-stage", stage: "typing-course", reason: "child" });
  const before = await rawRow();
  const capped = await capApi(`/api/family/learning/mission?tz=${TZ}`);
  check("V4-6 cap: the capped build (content version 2) reads the same rows, parks the running Besuch 4 (chapter-unavailable), counts 3 completions, narrates 3 reports, shows the station", capped.status === 200 && capped.json.view.visit === null && capped.json.view.next.reason === "chapter-unavailable" && capped.json.view.progress.completedTotal === 3 && capped.json.view.reports.length === 3 && capped.json.view.scene.station.built === true && /nicht verfügbar/.test(capped.json.view.nextStep), { status: capped.status, next: capped.json?.view?.next, nextStep: capped.json?.view?.nextStep });
  const refused = await fetch(CAP_BASE + "/api/family/learning/mission", { method: "PUT", headers: { cookie: `${COOKIE}=${assistant}`, authorization: "Bearer " + bearer, "content-type": "application/json" }, body: JSON.stringify({ op: { op: "start-visit" }, expectedRevision: capped.json.view.revision, idempotencyKey: `cap-${Date.now()}`, context: { erasureGeneration: 0, visit: null }, tz: TZ }) });
  const after = await rawRow();
  check("V4-6 cap: the capped build refuses to start anything (refused or stale, never applied) and writes nothing", (refused.status === 422 || refused.status === 409) && JSON.stringify(after.state) === JSON.stringify(before.state) && after.contentVersion === before.contentVersion, { status: refused.status });
  const parent = await fetch(CAP_BASE + "/api/family/learning/parent/evidence?child=santiago", { redirect: "manual", headers: { cookie: `${COOKIE}=${owner}` } });
  const parentJson = await parent.json();
  check("V4-6 cap: the parent cockpit on the capped build still reads every row (3 reviews, 4 visits incl. the parked one)", parent.status === 200 && parentJson.completions.length === 3 && parentJson.state.visits.length === 4);
  const resumed = await view();
  check("V4-6 forward: the uncapped build resumes exactly at EQ-PIER, nothing rewritten", resumed.visit?.id === "v5" && resumed.visit?.stage === "EQ-PIER" && JSON.stringify((await rawRow()).state) === JSON.stringify(before.state));
  check("no browser page errors", pageErrors.length === 0, pageErrors.slice(0, 3));
});

await browser.close();
const summary = { base: BASE, capBase: CAP_BASE, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results, screenshots: shots, pageErrors };
fs.writeFileSync(path.join(OUT, "visit4-results.json"), JSON.stringify(summary, null, 2));
console.log(`\nvisit4: ${summary.passed} passed, ${summary.failed} failed → ${OUT}`);
process.exit(summary.failed === 0 ? 0 : 1);
