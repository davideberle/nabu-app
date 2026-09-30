// Real-browser journeys for the approved learning redesign (2026-09-29,
// milestones A–C) against a LOCAL production server with a synthetic
// AUTH_SECRET and an isolated NABU_DB_DIR. Headless Chromium, project audio
// guard, muted: no audio is ever produced. Session cookies are Auth.js JWEs
// minted locally. No real .env, data, OAuth or external service.
//
//   AUTH_SECRET=<same as server> node scripts/verify-learning-redesign.mjs \
//     --base http://127.0.0.1:3131 --out /tmp/<dir> --mode empty|completed|due|feedback|decisions|round5
//
// Modes:
//   empty      fresh database: visit 1 through the real UI up to the first
//              item (item-specific counter labels), visits 1+2 finished through
//              the child API, chapter 4 through the real UI, parent cockpit,
//              telemetry, completion replay, deletion.
//   completed  database seeded by seed-learning-redesign-fixture.mjs (two
//              visits under v1 content, no completion rows): upgrade on read,
//              historical reviews, no reset, chapter 4 through the real UI.
//   due        same fixture with records backdated 10 days (server clock
//              untouched): the delayed check is offered before chapter 4 and
//              runs through the UI; then chapter 4 is offered.
//   feedback   (needs --db) completed fixture: reflection feedback matrix
//              (answered / explicitly skipped / left open per dimension),
//              feedback telemetry delivery, stable-key retries for the transfer
//              and reflection paths (pre-commit failure, post-commit lost ACK,
//              duplicate submit), the copied-correction refusal after a skipped
//              revision and an unassessable sentence. Round 4: server-owned
//              feedback telemetry under a lost ACK + reload and under aborted
//              telemetry POSTs (R4-1); recoverable completed drafts across a
//              hard reload with the same key, whitespace/identity semantics,
//              changed text, lost ACK, discard, other sign-in, leaving the
//              workspace and erasure (R4-2); the archived-shape stored review
//              crediting "Hallo" re-derived with disclosed provenance (R4-3).
//   round5     (needs --db) same fixture and setup as feedback, own server:
//              the mounted old draft after erase + same-revision
//              recreation is refused server-side for both operations, in both
//              orders (R5-1); feedback-only completions report UX as not
//              observed, never zero (R5-2); the real Auth.js sign-out, an
//              expired session, a late response and an account switch retire
//              completed drafts (R5-3); composed failed-log-save and
//              clean-log → independent transfer branches.
//   decisions  (needs --db) completed fixture: the four real server decisions
//              repeat / smaller / advance / stop, each under a normal ACK, a
//              post-commit lost ACK + "Nochmal speichern", and a reload; plus
//              the declined-theme Spanish coherence and the v1 recipient wording.

import fs from "node:fs";
import path from "node:path";
import { encode } from "@auth/core/jwt";
import { chromium } from "/Users/claweberle/.npm-global/lib/node_modules/playwright/index.mjs";
import { audioSafeChromiumLaunchOptions, installBrowserAudioGuard } from "./lib/browser-audio-guard.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt("--base", "http://127.0.0.1:3131").replace(/\/$/, "");
const OUT = opt("--out", "/tmp/family-learning-redesign");
const MODE = opt("--mode", "empty");
const DB = opt("--db", null); // optional: path to the server's nabu.db for persisted-JSON inspection (same machine)
/** Harness-only: a short-lived connection to the server's SQLite file (retries while the server holds the lock). */
async function withDbFile(fn) {
  const { createRequire } = await import("node:module");
  const req = createRequire(import.meta.url);
  const { createClient } = req("@libsql/client");
  const c = createClient({ url: "file:" + DB });
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await fn(c);
      } catch (e) {
        if (!/SQLITE_BUSY/.test(String(e)) || attempt >= 50) throw e;
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  } finally {
    c.close();
  }
}
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
  console.log(ok ? "PASS" : "FAIL", `[${MODE}]`, name, detail === undefined ? "" : JSON.stringify(detail));
}
const mint = (email) => encode({ token: { email, sub: email, name: email }, secret: SECRET, salt: COOKIE, maxAge: 3600 });
const owner = await mint("info@davideberle.com");
const assistant = await mint("assistant@davideberle.com");
const stranger = await mint("someone-else@example.com");
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
const bearer = (await api("POST", "/api/family/learning/session", { childId: "santiago" })).json?.token;
if (!bearer) {
  console.error("could not mint a child session; is the server up with the same AUTH_SECRET?");
  process.exit(2);
}
const view = async () => (await api("GET", "/api/family/learning/mission", null, assistant, bearer)).json.view;
let opN = 0;
const contextOf = (v) => ({ erasureGeneration: v.erasureGeneration, visit: v.visit ? { id: v.visit.id, startedAt: v.visit.startedAt } : null });
async function op(o, key = `j-${MODE}-${(opN += 1)}`) {
  const v = await view();
  const r = await api("PUT", "/api/family/learning/mission", { op: o, expectedRevision: v.revision, idempotencyKey: key, context: contextOf(v) }, assistant, bearer);
  if (r.status !== 200 || (r.json.status !== "applied" && r.json.status !== "replayed")) throw new Error(`op ${o.op}: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  return r.json;
}
const evidence = async () => (await api("GET", "/api/family/learning/parent/evidence?child=santiago", null, owner)).json;
async function setLayout(layout) {
  const current = await api("GET", "/api/family/learning/parent/settings?child=santiago", null, owner);
  const put = await api("PUT", "/api/family/learning/parent/settings", { child: "santiago", expectedErasureGeneration: current.json.erasureGeneration, keyboardLayout: layout }, owner);
  return put.status;
}

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
const parentCtx = await makeContext({ viewport: { width: 1280, height: 1000 } });
await parentCtx.addCookies([{ name: COOKIE, value: owner, url: BASE }]);
const p = await desktop.newPage();
p.setDefaultTimeout(10000);
const t = await tablet.newPage();
t.setDefaultTimeout(10000);
const pp = await parentCtx.newPage();
pp.setDefaultTimeout(10000);
const pageErrors = [];
for (const pg of [p, t, pp]) pg.on("pageerror", (e) => pageErrors.push(String(e)));
const shot = async (page, name) => {
  await page.screenshot({ path: path.join(OUT, `${MODE}-${name}.png`), fullPage: true });
  fs.writeFileSync(path.join(OUT, `${MODE}-${name}.txt`), await page.locator("body").innerText());
};
const click = (name, page = p) => page.getByRole("button", { name, exact: true }).click();
const body = (page = p) => page.locator("body").innerText();
const tid = (id, page = p) => page.getByTestId(id);
// Child-facing copy uses the German long date ("5. Oktober"); the parent cockpit the same.
const fmtDate = (iso) => new Date(iso).toLocaleDateString("de-CH", { day: "numeric", month: "long" });

const opens = [];
async function paceMint() {
  // Each page load mints a child credential; the server admits 30 per minute per child. Wait out the window instead of hitting 429.
  const now = Date.now();
  while (opens.length && now - opens[0] > 61_000) opens.shift();
  if (opens.length >= 27) {
    const wait = 61_000 - (now - opens[0]) + 200;
    await new Promise((r) => setTimeout(r, wait));
    opens.length = 0;
  }
  opens.push(Date.now());
}
async function openMission() {
  await paceMint();
  await p.goto(BASE + "/family/learn/mission?child=santiago");
}

/** Chapter 4 (visit 4) through the real UI on the desktop page; screenshots on desktop and tablet. */
async function runVisit4(prefix) {
  const before = await view();
  check(`${prefix} chapter 4 is the next visit`, before.next.visit === "v4", before.next);
  // Cockpit: next chapter + real delayed-check date.
  await p.goto(BASE + "/family/learn?child=santiago");
  await p.getByRole("link", { name: "Neues Kapitel" }).waitFor();
  const cockpitText = await body();
  const dc = before.delayedCheck;
  check(`${prefix} cockpit shows the delayed check with its actual date (server-derived), status ${dc?.status}`, dc && dc.status === "waiting" && cockpitText.includes(fmtDate(dc.availableAt)), { availableAt: dc?.availableAt, anchor: dc?.anchor });
  await shot(p, `${prefix}-cockpit-desktop`);
  await t.goto(BASE + "/family/learn?child=santiago");
  await t.getByRole("link", { name: "Neues Kapitel" }).waitFor();
  await shot(t, `${prefix}-cockpit-tablet`);

  await openMission();
  await tid("start-visit").waitFor();
  check(`${prefix} start screen names the new chapter and explains the delayed check`, (await tid("start-visit").innerText()).includes("Neues Kapitel") && (await tid("delayed-check-text").innerText()).includes(fmtDate(dc.availableAt)));
  await shot(p, `${prefix}-start`);
  await tid("start-visit").click();

  // restore: intro (who / make / done)
  await tid("mission-intro").waitFor();
  const intro = await tid("mission-intro").innerText();
  check(`${prefix} restore shows the chapter intro (who, make, done)`, /Biolog/.test(intro) && /Station/.test(intro), intro.slice(0, 160));
  check(`${prefix} scene persists the base (hut, garden beds) before anything new is built`, (await p.locator("[data-scene-base]").first().getAttribute("data-scene-base")) !== "none" && (await p.locator("[data-scene-station]").first().getAttribute("data-scene-station")) === "none");
  await shot(p, `${prefix}-restore`);
  await click("Weiter");

  // station choice: keyboard activation of a real button
  await tid("station-theme-turtles").waitFor();
  const refKind = await tid("station-reference").getAttribute("data-reference");
  const refText = await tid("station-reference").innerText();
  const savedLogs = (await view()).pages.map((pg) => pg.text);
  check(`${prefix} station prompt refers only to saved work (kind ${refKind})`, (refKind === "turtles-in-log") === savedLogs.some((t) => /schildkr[öo]t/i.test(t)) && (refKind === "turtles-in-log" ? /erwähnt/.test(refText) : !/Schildkr/.test(refText)), { refKind, refText, savedLogs });
  await shot(p, `${prefix}-station-choice`);
  await tid("station-theme-turtles").focus();
  await p.keyboard.press("Enter");
  await p.getByRole("heading", { name: "Tippen" }).waitFor();
  check(`${prefix} station theme chosen by keyboard (Enter on the focused button)`, (await view()).station?.theme === "turtles");
  // C4 composed path: Stopp is the pause — it closes the active interval, flushes with keepalive and returns to the cockpit; the visit stays where it was.
  await tid("course-input").count(); // (locked state; nothing to type yet)
  await p.getByRole("link", { name: "Stopp und speichern" }).click();
  await p.getByRole("link", { name: "Weiter" }).waitFor();
  const afterStop = await view();
  check(`${prefix} Stopp returns to the cockpit and keeps the running visit at its stage`, afterStop.visit?.id === "v4" && afterStop.visit.stage === "typing-course");
  await openMission();
  await p.getByRole("heading", { name: "Tippen" }).waitFor();

  // typing course: layout unconfirmed → parent confirms → alignment check → mismatch → match → lessons
  const unconfirmed = await tid("typing-unavailable").innerText();
  check(`${prefix} typing course is locked while the parent has not confirmed the layout (no silent fallback)`, /Eltern/.test(unconfirmed) && (await p.getByTestId("course-input").count()) === 0, unconfirmed);
  await shot(p, `${prefix}-typing-layout-unconfirmed`);
  check(`${prefix} parent confirms the physical layout (owner API)`, (await setLayout("ch-de-qwertz")) === 200);
  await p.reload();
  await tid("alignment-check").waitFor();
  await shot(p, `${prefix}-typing-alignment-check`);
  for (const [id, ch] of [["right-of-0", "ß"], ["right-of-l", "ö"], ["right-of-t", "z"]]) await tid(`alignment-key-${id}`).fill(ch);
  await tid("alignment-submit").click();
  await tid("alignment-mismatch").waitFor();
  const mismatch = await tid("alignment-mismatch").innerText();
  check(`${prefix} mismatching input source is reported with the parent-side fix; course stays locked`, /Systemeinstellungen/.test(mismatch) && /de-DE|Deutsche/.test(mismatch) && (await p.getByTestId("course-input").count()) === 0, mismatch.slice(0, 200));
  await shot(p, `${prefix}-typing-alignment-mismatch`);
  for (const [id, ch] of [["right-of-0", "'"], ["right-of-l", "ö"], ["right-of-t", "z"]]) await tid(`alignment-key-${id}`).fill(ch);
  await tid("alignment-submit").click();
  await tid("course-input").waitFor();
  const lessonText = await body();
  check(`${prefix} after a matching check the first lesson opens with home position, finger and spacebar guidance`, /Grundstellung/.test(lessonText) && /Daumen/.test(lessonText) && /Leertaste/.test(lessonText) && /Lektion 1 von 5/.test(lessonText));
  check(`${prefix} next-key guidance names the next character and its finger`, /Jetzt: „f“/.test(await tid("next-key").innerText()), await tid("next-key").innerText());
  await shot(p, `${prefix}-typing-lesson`);
  await t.goto(BASE + "/family/learn/mission?child=santiago");
  await t.getByTestId("course-input").waitFor();
  await shot(t, `${prefix}-typing-lesson-tablet`);
  // burst 1: exact lines by keyboard
  await tid("course-input").focus();
  await p.keyboard.type("fff ");
  check(`${prefix} guidance moves to the next expected key after real keystrokes`, /Jetzt: „j“/.test(await tid("next-key").innerText()), await tid("next-key").innerText());
  await p.keyboard.type("jjj");
  await p.keyboard.press("Enter");
  await tid("course-input").focus();
  await p.keyboard.type("fj fj jf");
  await p.keyboard.press("Enter");
  await tid("comfort-ok").waitFor();
  await tid("comfort-ok").click();
  await tid("decision").waitFor();
  const d1 = await tid("decision").innerText();
  check(`${prefix} first accurate burst → repeat (needs two good bursts), stated honestly`, /Noch eine Runde/.test(d1), d1);
  await shot(p, `${prefix}-typing-burst1`);
  // burst 2: one insertion in line 1, one omission in line 2 (alignment, not positional)
  await tid("another-burst").click();
  await tid("course-input").focus();
  await p.keyboard.type("fffx jjj");
  await p.keyboard.press("Enter");
  await tid("course-input").focus();
  await p.keyboard.type("fj fjjf");
  await p.keyboard.press("Enter");
  await tid("comfort-hard").waitFor();
  const preview = await tid("burst-result").innerText();
  check(`${prefix} insertion and omission are counted per line without cancelling the rest of the line`, /7\/7 richtig, 1 zu viel/.test(preview) && /7\/8 richtig, 1 fehlen/.test(preview), preview.slice(0, 160));
  await tid("comfort-hard").click();
  await tid("decision").waitFor();
  const bursts = await tid("bursts-this-visit").innerText();
  check(`${prefix} both bursts are listed with correct/extra/omitted counts and comfort`, /Runde 1 \(L1\): 15 von 15 richtig/.test(bursts) && /Runde 2 \(L1\): 14 von 16 richtig, 1 zu viel, 1 fehlen · Anstrengend/.test(bursts), bursts);
  const courseState = (await view()).typingCourse;
  check(`${prefix} server-side course state: lesson 1 unchanged, two bursts, metric v2 substitutions/extra/omitted`, courseState.lesson.id === "TYPE-CH-COURSE-1" && courseState.burstsThisVisit.length === 2 && courseState.burstsThisVisit[1].extraChars === 1 && courseState.burstsThisVisit[1].omittedChars === 1, courseState.burstsThisVisit);
  await shot(p, `${prefix}-typing-burst2`);
  // C3: a reload restores the SAVED decision and its next-step choice (no silent full restart).
  await p.reload();
  await tid("decision-card").waitFor();
  check(`${prefix} reload restores the saved 'repeat' decision with its choices instead of a restarted input`, (await tid("decision-card").getAttribute("data-decision")) === "repeat" && (await p.getByTestId("course-input").count()) === 0 && (await tid("another-burst").count()) === 1 && (await tid("course-continue").count()) === 1);
  await shot(p, `${prefix}-typing-reload-decision`);
  await tid("another-burst").click();
  await tid("course-input").waitFor();
  await tid("course-input").focus();
  await p.keyboard.type("fxf jxj");
  await p.keyboard.press("Enter");
  await tid("course-input").focus();
  await p.keyboard.type("fj fjjf");
  await p.keyboard.press("Enter");
  await tid("comfort-hard").waitFor();
  await tid("comfort-hard").click();
  await tid("decision-card").waitFor();
  check(`${prefix} two hard/inaccurate bursts in a row → 'smaller' with a shorter-burst choice`, (await tid("decision-card").getAttribute("data-decision")) === "smaller" && (await tid("shorter-burst").count()) === 1, await tid("decision").innerText());
  await p.reload();
  await tid("decision-card").waitFor();
  check(`${prefix} the 'smaller' decision survives a reload`, (await tid("decision-card").getAttribute("data-decision")) === "smaller");
  await shot(p, `${prefix}-typing-smaller`);
  await tid("shorter-burst").click();
  await tid("course-input").waitFor();
  check(`${prefix} the shorter burst is one line only`, /\(1\/1\)/.test(await body()));
  await tid("course-input").focus();
  await p.keyboard.type("fff jjj");
  await p.keyboard.press("Enter");
  await tid("comfort-ok").waitFor();
  await tid("comfort-ok").click();
  await tid("decision-card").waitFor();
  const afterShort = (await view()).typingCourse;
  check(`${prefix} a perfect shorter burst is recorded as practice (lineCount 1) and does not promote`, afterShort.burstsThisVisit.length === 4 && afterShort.burstsThisVisit[3].lineCount === 1 && afterShort.burstsThisVisit[3].accuracy === 1 && afterShort.decision.action === "repeat" && afterShort.lesson.id === "TYPE-CH-COURSE-1", afterShort.burstsThisVisit.map((b) => [b.lineCount, b.accuracy, b.comfort]));
  check(`${prefix} the burst list marks the short round`, /Runde 4 \(L1, kurz\): 7 von 7 richtig/.test(await tid("bursts-this-visit").innerText()), await tid("bursts-this-visit").innerText());
  await shot(p, `${prefix}-typing-short-burst`);
  await tid("course-continue").click();

  // EQ-STATION: remainder — typed partial answer, then counters with capacity and visible leftovers
  await p.getByLabel("Gepflanzt").waitFor();
  const mathText = await body();
  check(`${prefix} remainder item asks for two numbers with item/recipient wording (Setzlinge / Beete)`, /Setzlinge/.test(mathText) && /Beete/.test(mathText) && /Gepflanzt/.test(mathText) && /Übrig/.test(mathText));
  await p.getByLabel("Gepflanzt").fill("30");
  await p.getByLabel("Übrig").fill("0");
  await click("Fertig");
  await tid("clarification").waitFor();
  const clar = await tid("clarification").innerText();
  check(`${prefix} partial answer (30 planted, 0 left) gets a clarification naming which part is right`, /gepflanzten Setzlinge stimmen/.test(clar), clar);
  await shot(p, `${prefix}-math-station-clarify`);
  await tid("open-counters").waitFor();
  check(`${prefix} counter control is labelled with the actual items and recipients`, /Setzlinge in die Beete legen/.test(await tid("open-counters").innerText()));
  await tid("open-counters").click();
  for (let bed = 1; bed <= 5; bed += 1) for (let i = 0; i < 6; i += 1) await p.getByRole("button", { name: `Beet ${bed}: eins mehr` }).click();
  await p.getByRole("button", { name: "Beet 1: eins mehr" }).click(); // capacity: no-op
  const leftovers = await tid("leftovers").innerText();
  check(`${prefix} five full beds of six leave two visible leftovers; a seventh seedling does not fit`, /2 Setzlinge/.test(leftovers), leftovers);
  check(`${prefix} submit button states the grouping and the remainder`, /5 Beete voll \(je 6\), 2 übrig/.test(await tid("counters-submit").innerText()));
  await shot(p, `${prefix}-math-station-counters`);
  await t.goto(BASE + "/family/learn/mission?child=santiago");
  await t.getByLabel("Gepflanzt").waitFor();
  await shot(t, `${prefix}-math-station-tablet`);
  await tid("counters-submit").click();
  await p.getByRole("heading", { name: "Wie hast du das gerechnet?" }).waitFor();
  const stationState = (await view()).math;
  check(`${prefix} remainder answer recorded; stage advanced to explain`, stationState === null || stationState.id !== "EQ-STATION");
  await p.locator("textarea").fill("Fünf Beete mal sechs sind dreissig, zwei bleiben übrig.");
  await click("Speichern");

  // LANG-ES-STATION: listen → pick → produce (full phrase) → reuse (changed application)
  await click("Verstanden — weiter");
  await p.getByRole("button", { name: /Lampe/ }).click();
  await p.getByLabel("Antwort", { exact: true }).waitFor();
  await shot(p, `${prefix}-lang-es-produce`);
  await p.getByLabel("Antwort", { exact: true }).fill("Necesitamos una lámpara.");
  await click("Senden");
  await p.getByText("4/4").waitFor();
  const langText = await body();
  check(`${prefix} the reuse step changes the situation (night, turtles, water) instead of repeating the phrase`, /noche/.test(langText) && /tortugas/.test(langText));
  await shot(p, `${prefix}-lang-es-reuse`);
  await p.getByRole("button", { name: /Wasser/ }).click();

  // station build: click a spot; the scene changes (station built, lamp lit because a lamp was actually supplied)
  await tid("station-spot-beach").waitFor();
  check(`${prefix} build step reports that the ordered lamp is available`, /mit der Lampe/.test(await body()));
  await shot(p, `${prefix}-station-build`);
  // V2: a failed save never shows the construction as built; the retry builds it.
  {
    let aborted = false;
    const failOnce = async (route) => {
      if (route.request().method() === "PUT" && route.request().postDataJSON()?.op?.op === "build-station" && !aborted) {
        aborted = true;
        await route.abort("failed");
        return;
      }
      await route.continue();
    };
    await p.route("**/api/family/learning/mission", failOnce);
    await tid("station-spot-beach").click();
    await p.getByText("Keine Verbindung").waitFor();
    const sceneAfterFail = p.locator("[data-scene-base]").first();
    check(`${prefix} a failed build save shows a notice and the scene still has NO station (nothing durable was faked)`, aborted && (await sceneAfterFail.getAttribute("data-scene-station")) === "none" && (await tid("station-spot-beach").count()) === 1);
    await p.unroute("**/api/family/learning/mission", failOnce);
  }
  await tid("station-spot-beach").click();
  await p.getByRole("heading", { name: "Deine Expeditionsseite" }).waitFor();
  const sceneEl = p.locator("[data-scene-base]").first();
  check(`${prefix} scene shows the built station with its lamp lit and the station beds with leftovers`, (await sceneEl.getAttribute("data-scene-station")) === "built" && (await sceneEl.getAttribute("data-scene-lamp")) === "on" && Number(await sceneEl.getAttribute("data-scene-beds")) >= 5);
  await shot(p, `${prefix}-scene-after-build`);
  await t.goto(BASE + "/family/learn/mission?child=santiago");
  await t.locator("[data-scene-station='built']").first().waitFor();
  const stationTransition = await t.locator("[data-part='station']").first().evaluate((el) => getComputedStyle(el).transitionDuration);
  check(`${prefix} reduced motion: the station has no transition on the tablet (prefers-reduced-motion)`, stationTransition === "0s", stationTransition);
  await shot(t, `${prefix}-scene-after-build-tablet`);

  // log + revision (original preserved, spacing only)
  await p.locator("textarea").fill("Ichhabe2Schildkroten gesehen.");
  await click("Seite speichern");
  await tid("revise-help").waitFor();
  const help = await tid("revise-help").innerText();
  check(`${prefix} revision shows the child's own sentence with marked boundaries and says spelling is not today's topic`, /Ich\|habe\|2\|Schildkroten/.test(help) && /Rechtschreibung/.test(help), help.slice(0, 200));
  await shot(p, `${prefix}-log-revise`);
  await tid("revise-input").fill("Ich habe 2 Schildkroten gesehen.");
  await tid("revise-save").click();

  // fresh transfer sentence (R2-3): a NEW sentence after the revision; empty mode clean, completed mode flagged
  await tid("transfer").waitFor();
  check(`${prefix} the fresh transfer check follows the revision with its own prompt (WRITE-TRANSFER-1)`, /morgen beobachten/.test(await body()) && (await view()).transfer?.id === "WRITE-TRANSFER-1" && (await view()).transfer?.helpExposed === true);
  await shot(p, `${prefix}-transfer`);
  const transferText = prefix === "completed" ? "Morgenzählt die Station2Wellen." : "Morgen zählt die Station 3 Wellen.";
  await tid("transfer-input").fill(transferText);
  await tid("transfer-save").click();
  await tid("summary").waitFor();
  const transferRec = (await evidence()).state.transfers.at(-1);
  check(`${prefix} transfer recorded as first-attempt evidence with exposure and assessed count (${transferRec?.outcome}, assessed ${transferRec?.assessed})`, transferRec && transferRec.text === transferText && transferRec.helpExposed === true && transferRec.assessed === 2 && transferRec.outcome === (prefix === "completed" ? "flagged" : "clean") && (prefix !== "completed" || transferRec.flagged.length === 2), transferRec);

  // summary
  await tid("summary").waitFor();
  const summary = await body();
  check(`${prefix} summary names one success, one practice focus and a next step with the artifact`, (await tid("summary-success").count()) === 1 && (await tid("summary-next").count()) === 1 && (await tid("summary-artifact").count()) === 1, summary.slice(0, 300));
  const sv = (await view()).summary;
  check(`${prefix} summary lines cite stored records (basis) and the recommendation branch is outcome-sensitive`, sv && sv.success && sv.success.basis && sv.next.branch && (sv.artifact.kind === "station" || sv.artifact.kind === "revision"), { success: sv?.success, next: sv?.next, artifact: sv?.artifact });
  await shot(p, `${prefix}-summary`);
  await t.goto(BASE + "/family/learn/mission?child=santiago");
  await t.getByTestId("summary").waitFor();
  await shot(t, `${prefix}-summary-tablet`);
  await tid("summary-next-button").click();
  // reflection with optional feedback (R2-5): difficulty required, enjoyment answered, clarity explicitly skipped
  await tid("reflect").waitFor();
  check(`${prefix} 'Fertig' is available with nothing chosen: all three dimensions are optional (nothing is coerced)`, !(await tid("reflect-submit").isDisabled()) && (await tid("difficulty-skip").count()) === 1);
  await tid("difficulty-right").click();
  await tid("enjoyment-yes").click();
  await tid("clarity-skip").click();
  await shot(p, `${prefix}-reflect-feedback`);
  await tid("reflect-submit").click();
  await tid("start-visit").waitFor({ state: "detached" }).catch(() => {});
  const after = await view();
  const v4rec = (await evidence()).state.visits.find((v) => v.id === "v4");
  check(`${prefix} feedback stored on the visit: difficulty right, enjoyment yes, clarity skipped explicitly`, v4rec?.reflection === "right" && v4rec?.feedback?.answers?.enjoyment === "yes" && v4rec?.feedback?.skipped?.includes("clarity") && v4rec?.feedback?.unanswered?.length === 0, v4rec?.feedback);
  if (DB) {
    const fbEvents = await withDbFile(async (c) => {
      const rows = (await c.execute({ sql: "SELECT events_json FROM family_learning_telemetry WHERE child_id = 'santiago' AND visit_id = 'v4' AND visit_started_at = ?", args: [v4rec.startedAt] })).rows;
      return rows.flatMap((r) => JSON.parse(String(r.events_json))).filter((e) => e.kind === "feedback");
    });
    check(`${prefix} the real workspace delivered exactly the answered dimensions as feedback telemetry for the finished visit (2 events)`, fbEvents.length === 2 && fbEvents.some((e) => e.detail.dimension === "difficulty" && e.detail.option === "right") && fbEvents.some((e) => e.detail.dimension === "enjoyment" && e.detail.option === "yes"), fbEvents);
  }
  check(`${prefix} chapter 4 finished; the delayed check remains for its date; chapter 4 is not offered again`, after.visit === null && after.visits === undefined && after.next.visit !== "v4" && after.delayedCheck?.status === "waiting", after.next);
  await shot(p, `${prefix}-after-visit4`);
  const revision = (await evidence()).state.logRevisions;
  check(`${prefix} evidence keeps the original log sentence and the revision (support preserved)`, revision.length === 1 && revision[0].original === "Ichhabe2Schildkroten gesehen." && revision[0].revised === "Ich habe 2 Schildkroten gesehen." && revision[0].outcome === "revised", revision[0]);
}

async function parentCockpit(prefix, expectHistorical) {
  await pp.goto(BASE + "/family/learn/parent");
  await pp.getByRole("tab", { name: "Rückblick" }).waitFor();
  await pp.getByRole("tab", { name: "Mathe" }).click();
  await tid("delayed-check-parent", pp).waitFor();
  const dcp = await tid("delayed-check-parent", pp).innerText();
  check(`${prefix} parent math tab explains the delayed-check date from the anchor, server clock`, /öffnet am/.test(dcp) && /Server-Uhr/.test(dcp), dcp);
  await shot(pp, `${prefix}-parent-math`);
  await pp.getByRole("tab", { name: "Tippen" }).click();
  await tid("typing-setup", pp).waitFor();
  const setup = await tid("typing-setup", pp).innerText();
  check(`${prefix} parent typing tab shows the confirmed physical layout, the device check result and the course position`, /Schweizer Tastatur/.test(setup) && /passt \(geprüft/.test(setup) && /Lektion 1/.test(setup) && /4 Runden/.test(setup), setup);
  check(`${prefix} parent typing tab labels metric versions on samples`, /Metrik v2/.test(await body(pp)));
  const lines = await pp.locator("[data-testid='burst-lines']").allInnerTexts();
  check(`${prefix} parent typing tab shows per-line aggregates of the course bursts (insertion/omission per line)`, lines.some((l) => /Zeile 1: 7 von 8 richtig, 1 zu viel/.test(l) && /Zeile 2: 7 von 8 richtig, 1 fehlen/.test(l)), lines);
  await shot(pp, `${prefix}-parent-typing`);
  await pp.getByRole("tab", { name: "Deutsch" }).click();
  await tid("log-revisions", pp).waitFor();
  check(`${prefix} parent German tab lists the revision with original, revised text and marked boundaries`, /Original: Ichhabe2Schildkroten/.test(await tid("log-revisions", pp).innerText()) && /alle behoben/.test(await tid("log-revisions", pp).innerText()));
  await tid("transfers", pp).waitFor();
  const transfersText = await tid("transfers", pp).innerText();
  check(`${prefix} parent German tab lists the fresh transfer sentence with assessed count, outcome and exposure`, /WRITE-TRANSFER-1 v1/.test(transfersText) && /Hilfe vorher gezeigt: ja/.test(transfersText) && (prefix === "completed" ? /2 geprüfte Stellen, 2 ohne Leerzeichen/.test(transfersText) : /2 geprüfte Stellen, alle richtig/.test(transfersText)), transfersText);
  await pp.getByRole("tab", { name: "Rückblick" }).click();
  await tid("review-v4", pp).waitFor();
  const cards = await pp.locator("[data-testid^='review-v']").count();
  const hist1 = await pp.locator("[data-testid='review-v1']").getAttribute("data-historical");
  check(`${prefix} review tab: one card per completed visit (${cards}), v1 historical=${hist1}`, cards === 3 && hist1 === (expectHistorical ? "true" : "false"));
  const v4card = await tid("review-v4", pp).innerText();
  check(`${prefix} v4 review separates learning from experience, shows telemetry counts and missingness, cockpit delivery`, /Lernen/.test(v4card) && /Erlebnis und Bedienung/.test(v4card) && /Pakete/.test(v4card) && /Zustellung: Eltern-Bereich/.test(v4card), v4card.slice(0, 400));
  const fbText = await pp.locator("[data-testid='review-v4'] [data-testid='child-feedback']").innerText();
  check(`${prefix} v4 review shows the child's own feedback separately (difficulty right, Spass Ja, Klarheit nicht gesagt)`, /Schwierigkeit right/.test(fbText) && /Spass yes/.test(fbText) && /Klarheit nicht gesagt/.test(fbText), fbText);
  const evV4 = (await evidence()).completions.find((c) => c.visitId === "v4");
  check(`${prefix} v4 review carries feedback telemetry events produced by the real workspace (kind feedback)`, evV4 && evV4.review.experience.telemetry.events > 0 && (await evidence()).telemetry.byVisit.v4 > 0, evV4?.review?.experience?.telemetry);
  const pauseMatch = v4card.match(/(\d+)× Stopp\/Pause/);
  check(`${prefix} the review counts the real Stopp as a pause (composed C4 path, keepalive flush)`, pauseMatch !== null && Number(pauseMatch[1]) >= 1, pauseMatch?.[0]);
  check(`${prefix} review tab states the missing Clavus adult-side capability`, /keinen belegten Weg/.test(await body(pp)));
  await shot(pp, `${prefix}-parent-review`);
  const ev = await evidence();
  check(`${prefix} telemetry batches were stored for v4 with bounded events`, ev.telemetry.batches >= 1 && ev.telemetry.byVisit.v4 > 0, ev.telemetry);
  check(`${prefix} exactly one completion row per visit`, new Set(ev.completions.map((c) => c.visitId)).size === ev.completions.length && ev.completions.length === 3, ev.completions.map((c) => [c.visitId, c.historical, c.contentVersion]));
}

try {
  if (MODE === "empty") {
    // ---- Visit 1 through the real UI up to the first item; item-specific labels.
    await p.goto(BASE + "/family/learn?child=santiago");
    await shot(p, "cockpit-fresh");
    await p.getByRole("link", { name: "Start" }).click();
    await click("Los geht's");
    await p.getByLabel("Name der Basis").fill("Sonnenküste");
    await p.getByLabel("Name der Basis").press("Enter");
    await p.getByRole("heading", { name: "Wo steht „Sonnenküste“?" }).waitFor();
    await click(/An der Küste/);
    await tid("open-counters").waitFor();
    check("v1 counter control distributes packs AMONG explorers (people), not into them (R2-6)", /Essenspakete an die Forscher verteilen/.test(await tid("open-counters").innerText()), await tid("open-counters").innerText());
    await tid("open-counters").click();
    for (let g = 1; g <= 4; g += 1) for (let i = 0; i < 6; i += 1) await p.getByRole("button", { name: `Forscher ${g}: eins mehr` }).click();
    check("v1 counters submit says what each explorer gets (R2-6)", /Jede Forscherin, jeder Forscher bekommt 6 — fertig/.test(await tid("counters-submit").innerText()), await tid("counters-submit").innerText());
    await shot(p, "v1-counters");
    const instruction = await tid("grouping-instruction").innerText();
    check("v1 EQ-ENTRY expanded grouping instruction before any answer distributes among explorers and explains the trays (R3-5)", /Verteile die Essenspakete an die Forscher/.test(instruction) && /Jedes Fach unten steht für eine Forscherin oder einen Forscher/.test(instruction) && !/in die Forscher/.test(instruction), instruction);
    await tid("counters-submit").click();
    await p.getByLabel("Antwort", { exact: true }).waitFor();
    // EQ-FRESH: the same before any answer
    await tid("open-counters").click();
    const freshInstruction = await tid("grouping-instruction").innerText();
    check("v1 EQ-FRESH expanded grouping instruction is recipient-aware too (R3-5)", /Verteile die Essenspakete an die Forscher/.test(freshInstruction) && !/in die Forscher/.test(freshInstruction), freshInstruction);
    await p.reload();
    await p.getByLabel("Antwort", { exact: true }).waitFor();
    // ---- Rest of visits 1 and 2 through the child API (same state machine).
    for (const o of [
      { op: "answer-math", itemId: "EQ-FRESH", answer: 7, raw: "7", modality: "typed" },
      { op: "explain", text: "Ich habe geteilt.", modality: "typed" }, { op: "skip-stage", stage: "LANG-EN-WATER", reason: "child" },
      { op: "typing-label", taskId: "TYPE-LABEL-BASE", typed: "Sonnenküste", seconds: 20 }, { op: "save-log", text: "Ichhabe2Schildkroten gesehen." }, { op: "reflect", optionId: "easy" },
      { op: "start-visit" }, { op: "resume-base" }, { op: "answer-math", itemId: "EQ-RETURN", answer: 7, raw: "7", modality: "typed" },
      { op: "skip-stage", stage: "LANG-ES-AGUA", reason: "child" }, { op: "typing-label", taskId: "TYPE-LABEL-GARDEN", typed: "Garten der Basis", seconds: 30 },
      { op: "save-log", text: "Der Garten ist fertig." },
    ]) await op(o);
    // completion dedup at the finishing write: replay (same key) and retry (new key) never add a row
    const v = await view();
    const finishKey = "finish-v2-key";
    const first = await api("PUT", "/api/family/learning/mission", { op: { op: "reflect", optionId: "easy" }, expectedRevision: v.revision, idempotencyKey: finishKey, context: contextOf(v) }, assistant, bearer);
    const replay = await api("PUT", "/api/family/learning/mission", { op: { op: "reflect", optionId: "easy" }, expectedRevision: v.revision, idempotencyKey: finishKey, context: contextOf(v) }, assistant, bearer);
    const retry = await api("PUT", "/api/family/learning/mission", { op: { op: "reflect", optionId: "easy" }, expectedRevision: v.revision, idempotencyKey: "finish-v2-key-2", context: contextOf(v) }, assistant, bearer);
    const ev2 = await evidence();
    check("finishing v2: applied once, replayed on the same key, stale on a new key; exactly one completion for v2", first.json.status === "applied" && replay.json.status === "replayed" && retry.json.status === "stale" && ev2.completions.filter((c) => c.visitId === "v2").length === 1, { first: first.json.status, replay: replay.json.status, retry: retry.json.status, completions: ev2.completions.map((c) => c.visitId) });
    await runVisit4("empty");
    await parentCockpit("empty", false);
    // ---- Telemetry boundary
    const idView = await view();
    const v4Started = (await evidence()).state.visits.find((v) => v.id === "v4").startedAt;
    const ident = { visitId: "v4", visitStartedAt: v4Started, erasureGeneration: idView.erasureGeneration };
    const bad = await api("POST", "/api/family/learning/telemetry", { ...ident, batchId: "x", events: [] }, assistant, "not-a-token");
    check("telemetry with an invalid child token is refused (401)", bad.status === 401, bad.status);
    const noId = await api("POST", "/api/family/learning/telemetry", { batchId: "no-identity", visitId: "v4", events: [] }, assistant, bearer);
    check("a batch without the visit instance / generation identity is refused (400)", noId.status === 400, noId.status);
    const big = await api("POST", "/api/family/learning/telemetry", { ...ident, batchId: "big-batch", events: Array.from({ length: 250 }, (_, i) => ({ t: i, kind: "control", detail: { name: "stop" } })) }, assistant, bearer);
    const big2 = await api("POST", "/api/family/learning/telemetry", { ...ident, batchId: "big-batch", events: [{ t: 1, kind: "control", detail: { name: "stop" } }] }, assistant, bearer);
    check("telemetry batches are bounded (max 200 events) and idempotent by batch id", big.status === 200 && big.json.accepted <= 200 && big2.status === 200 && big2.json.stored === false, { big: big.json, again: big2.json });
    const raw = await api("POST", "/api/family/learning/telemetry", { ...ident, batchId: "raw-batch", events: [{ t: 1, kind: "keystream", detail: { keys: "secret" } }] }, assistant, bearer);
    check("unknown telemetry kinds (e.g. a key stream) are dropped, never stored", raw.status === 200 && raw.json.accepted === 0, raw.json);
    const priv = await api("POST", "/api/family/learning/telemetry", { ...ident, batchId: "private-probe", events: [{ t: 1, kind: "control", stage: "my private typed words", detail: { key: "PRIVATE_RAW_KEY", text: "PRIVATE_RAW_TEXT" } }, { t: 2, kind: "control", stage: "log", detail: { name: "stop", text: "PRIVATE_RAW_TEXT" } }, { t: 3, kind: "submit", stage: "log", detail: { op: "save-log", ok: true, raw: "PRIVATE_LOG_TEXT" } }] }, assistant, bearer);
    check("through the real route, free text is dropped and only enumerated fields are accepted (2 of 3 events)", priv.status === 200 && priv.json.stored === true && priv.json.accepted === 2, priv.json);
    if (DB) {
      const { createRequire } = await import("node:module");
      const req = createRequire(import.meta.url);
      const { createClient } = req("@libsql/client");
      const dbc = createClient({ url: "file:" + DB });
      const row = (await dbc.execute({ sql: "SELECT events_json, visit_started_at, erasure_generation FROM family_learning_telemetry WHERE batch_id = ?", args: ["private-probe"] })).rows[0];
      dbc.close();
      const json = String(row?.events_json ?? "");
      check("persisted JSON of the probe batch contains no private text and carries the visit instance + generation", row && !json.includes("PRIVATE") && JSON.parse(json).length === 2 && String(row.visit_started_at) === v4Started && Number(row.erasure_generation) === ident.erasureGeneration, { json, visit_started_at: row?.visit_started_at, erasure_generation: row?.erasure_generation });
    } else {
      check("persisted JSON inspection skipped (no --db given)", true);
    }
    // ---- Unauthorized parent access
    check("parent evidence: assistant account 403, stranger 403, no cookie 401", (await api("GET", "/api/family/learning/parent/evidence?child=santiago", null, assistant)).status === 403 && (await api("GET", "/api/family/learning/parent/evidence?child=santiago", null, stranger)).status === 403 && (await api("GET", "/api/family/learning/parent/evidence?child=santiago", null, null)).status === 401);
    const strangerCtx = await makeContext({ viewport: { width: 1280, height: 900 } });
    await strangerCtx.addCookies([{ name: COOKIE, value: assistant, url: BASE }]);
    const sp = await strangerCtx.newPage();
    await sp.goto(BASE + "/family/learn/parent");
    await sp.waitForLoadState("networkidle");
    const spText = await sp.locator("body").innerText();
    check("parent page with the assistant account shows no review content", !/Rückblick/.test(spText) && !/Sonnenküste/.test(spText), spText.slice(0, 160));
    await strangerCtx.close();
    // ---- Deletion of derived and queued data
    const del = await api("DELETE", "/api/family/learning/parent/records?child=santiago&confirm=santiago", null, owner);
    const evd = await evidence();
    check("erasure deletes completions, telemetry and state together", del.status === 200 && evd.completions.length === 0 && evd.telemetry.batches === 0 && evd.state === null && evd.attempts.length === 0, { counts: del.json?.counts });
    const late = await api("POST", "/api/family/learning/telemetry", { ...ident, batchId: "late-after-erasure", events: [{ t: 1, kind: "submit", detail: { op: "save-log", ok: true } }] }, assistant, bearer);
    const evLate = await evidence();
    check("a late telemetry batch with the still-valid child credential after erasure is dropped by its stale generation (no resurrection)", late.status === 200 && late.json.stored === false && late.json.reason === "generation" && evLate.telemetry.batches === 0, late.json);
    // The verifier's replay: erase, start a fresh v1, replay the old batch → still dropped; old identity never attaches to the new visit.
    await op({ op: "start-visit" });
    const oldReplay = await api("POST", "/api/family/learning/telemetry", { ...ident, batchId: "old-batch-replay", events: [{ t: 1, kind: "hidden" }] }, assistant, bearer);
    const freshView = await view();
    const wrongInstance = await api("POST", "/api/family/learning/telemetry", { visitId: "v1", visitStartedAt: v4Started, erasureGeneration: freshView.erasureGeneration, batchId: "old-instance", events: [{ t: 1, kind: "hidden" }] }, assistant, bearer);
    check("after erasure + a fresh visit, an old batch (stale generation) and an old visit instance (new generation) are both dropped", oldReplay.json.reason === "generation" && wrongInstance.json.reason === "no-visit" && (await evidence()).telemetry.batches === 0, { replay: oldReplay.json, wrongInstance: wrongInstance.json });
    await p.goto(BASE + "/family/learn?child=santiago");
    await p.getByRole("link", { name: /Start|Weiter/ }).waitFor();
    check("after erasure the child cockpit starts fresh (a new visit 1, no base, no pages)", freshView.base.name === null && freshView.pages.length === 0 && freshView.visit?.id === "v1");
    await shot(p, "after-erasure");
  }

  if (MODE === "completed") {
    const fixture = JSON.parse(fs.readFileSync(path.join(path.dirname(OUT), "fixture.json"), "utf8"));
    const v0 = await view();
    check("fixture state served upgraded (content v2) with both historical visits and the base preserved", v0.contentVersion === 2 && v0.base.name === "Sonnenküste" && v0.pages.length === 2 && v0.next.visit === "v4", { next: v0.next, pages: v0.pages.length });
    const ev0 = await evidence();
    check("historical completions backfilled once for v1 and v2 (historical=true, content v1), no telemetry", ev0.completions.length === 2 && ev0.completions.every((c) => c.historical && c.contentVersion === 1) && ev0.telemetry.batches === 0, ev0.completions.map((c) => [c.visitId, c.historical, c.contentVersion]));
    const ev0b = await evidence();
    check("a second read does not duplicate historical completions", ev0b.completions.length === 2);
    check("raw attempts/samples untouched by the upgrade (3 attempts, 5 samples as seeded)", ev0.attempts.length === fixture.attempts && ev0.samples.length === fixture.samples, { attempts: ev0.attempts.length, samples: ev0.samples.length });
    await pp.goto(BASE + "/family/learn/parent");
    await pp.getByRole("tab", { name: "Rückblick" }).click();
    await tid("review-v1", pp).waitFor();
    check("parent review tab labels historical reviews and shows no fabricated experience data", (await tid("review-v1", pp).getAttribute("data-historical")) === "true" && /Rückwirkend/.test(await tid("review-v1", pp).innerText()) && /Keine Bedienungs-Daten/.test(await tid("review-v1", pp).innerText()));
    await shot(pp, "parent-review-historical");
    await runVisit4("completed");
    await parentCockpit("completed", true);
    const evEnd = await evidence();
    check("live records preserved after chapter 4: v1/v2 visits, pages and first attempts unchanged", evEnd.state.visits[0].finishedAt === fixture.visits[0].finishedAt && evEnd.state.visits[1].finishedAt === fixture.visits[1].finishedAt && evEnd.state.pages.length === 3 && evEnd.attempts.slice(0, 3).every((a) => ["EQ-ENTRY", "EQ-FRESH", "EQ-RETURN"].includes(a.taskId)), evEnd.state.visits.map((v) => v.id));
  }

  if (MODE === "feedback" || MODE === "round5") {
    if (!DB) throw new Error("--db is required for the feedback and round5 modes");
    // Reach the reflection stage once through the real API (declined theme, skipped course), then snapshot the row.
    await setLayout("ch-de-qwertz");
    for (const o of [{ op: "start-visit" }, { op: "resume-base" }, { op: "choose-station", theme: "none" }, { op: "typing-course-continue" }, { op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" }, { op: "skip-stage", stage: "explain", reason: "child" }, { op: "skip-stage", stage: "LANG-ES-STATION", reason: "child" }, { op: "build-station", spot: "rocks" }]) await op(o);
    const atLog = await withDbFile(async (c) => (await c.execute("SELECT state_json, revision FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0]);
    await op({ op: "save-log", text: "Ichhabe2Schildkroten gesehen." });
    const atRevise = await withDbFile(async (c) => (await c.execute("SELECT state_json, revision FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0]);
    await op({ op: "skip-stage", stage: "log-revise", reason: "child" });
    const atTransfer = await withDbFile(async (c) => (await c.execute("SELECT state_json, revision FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0]);
    await op({ op: "write-transfer", text: "Morgen zählt die Station 3 Wellen.", modality: "typed" });
    await op({ op: "summary-seen" });
    const atReflect = await withDbFile(async (c) => (await c.execute("SELECT state_json, revision FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0]);
    const restoreTo = async (snap) => {
      await withDbFile(async (c) => {
        await c.execute({ sql: "UPDATE family_learning_missions SET state_json = ?, revision = ? WHERE child_id = 'santiago'", args: [String(snap.state_json), Number(snap.revision)] });
        await c.execute("DELETE FROM family_learning_mutations WHERE child_id = 'santiago' AND idempotency_key LIKE 'j-feedback-%'");
        await c.execute("DELETE FROM family_learning_completions WHERE child_id = 'santiago' AND visit_id = 'v4'");
        await c.execute("DELETE FROM family_learning_telemetry WHERE child_id = 'santiago' AND visit_id = 'v4'");
        // Evidence rows written by earlier cases of this mode belong to the state being discarded (harness reset only).
        await c.execute("DELETE FROM family_learning_attempts WHERE child_id = 'santiago' AND visit_id = 'v4' AND task_id = 'WRITE-TRANSFER-1'");
        await c.execute("DELETE FROM family_learning_work_samples WHERE child_id = 'santiago' AND visit_id = 'v4' AND kind = 'writing_transfer'");
      });
      await new Promise((r) => setTimeout(r, 250));
    };
    const v4Started = JSON.parse(String(atReflect.state_json)).visits.find((v) => v.id === "v4").startedAt;
    const feedbackEvents = () => withDbFile(async (c) => (await c.execute({ sql: "SELECT batch_id, events_json FROM family_learning_telemetry WHERE child_id = 'santiago' AND visit_id = 'v4' AND visit_started_at = ?", args: [v4Started] })).rows.flatMap((r) => JSON.parse(String(r.events_json)).filter((e) => e.kind === "feedback").map((e) => ({ batch: r.batch_id, ...e.detail }))));
    const openReflect = async () => {
      await openMission();
      await tid("reflect").waitFor();
    };
    const visitRec = async () => (await evidence()).state.visits.find((v) => v.id === "v4");
    const openTransfer = async () => {
      await openMission();
      await tid("transfer").waitFor();
    };
    if (MODE === "feedback") {
    // ---- matrix: each dimension answered / explicitly skipped / left open
    const matrix = [
      { name: "all answered", clicks: ["difficulty-right", "enjoyment-yes", "clarity-clear"], answers: { difficulty: "right", enjoyment: "yes", clarity: "clear" }, skipped: [], unanswered: [], events: 3 },
      { name: "only difficulty", clicks: ["difficulty-tricky"], answers: { difficulty: "tricky" }, skipped: [], unanswered: ["enjoyment", "clarity"], events: 1 },
      { name: "only enjoyment", clicks: ["enjoyment-partly"], answers: { enjoyment: "partly" }, skipped: [], unanswered: ["difficulty", "clarity"], events: 1 },
      { name: "only clarity", clicks: ["clarity-unclear"], answers: { clarity: "unclear" }, skipped: [], unanswered: ["difficulty", "enjoyment"], events: 1 },
      { name: "all explicitly skipped", clicks: ["difficulty-skip", "enjoyment-skip", "clarity-skip"], answers: {}, skipped: ["difficulty", "enjoyment", "clarity"], unanswered: [], events: 0 },
      { name: "all left open", clicks: [], answers: {}, skipped: [], unanswered: ["difficulty", "enjoyment", "clarity"], events: 0 },
      { name: "difficulty skipped, others answered", clicks: ["difficulty-skip", "enjoyment-no", "clarity-partly"], answers: { enjoyment: "no", clarity: "partly" }, skipped: ["difficulty"], unanswered: [], events: 2 },
    ];
    for (const m of matrix) {
      await restoreTo(atReflect);
      await openReflect();
      for (const id of m.clicks) await tid(id).click();
      await tid("reflect-submit").click();
      await tid("start-visit").waitFor().catch(() => {});
      const rec = await visitRec();
      const events = await feedbackEvents();
      const answersOk = JSON.stringify(rec?.feedback?.answers ?? {}) === JSON.stringify(m.answers);
      const eventsOk = events.length === m.events && Object.entries(m.answers).every(([d, o]) => events.some((e) => e.dimension === d && e.option === o));
      check(`feedback matrix: ${m.name} → stored answers/skipped/unanswered and ${m.events} delivered feedback event(s)`, rec?.finishedAt && answersOk && JSON.stringify(rec.feedback.skipped) === JSON.stringify(m.skipped) && JSON.stringify(rec.feedback.unanswered) === JSON.stringify(m.unanswered) && (rec.reflection ?? null) === (m.answers.difficulty ?? null) && eventsOk, { feedback: rec?.feedback, events });
      if (m.name === "all answered") {
        await pp.goto(BASE + "/family/learn/parent");
        await pp.getByRole("tab", { name: "Rückblick" }).click();
        await tid("review-v4", pp).waitFor();
        const fb = await pp.locator("[data-testid='review-v4'] [data-testid='child-feedback']").innerText();
        check("feedback matrix: the parent review shows the three answered values", /Schwierigkeit right/.test(fb) && /Spass yes/.test(fb) && /Klarheit clear/.test(fb), fb);
        await shot(pp, "feedback-parent-all-answered");
      }
      if (m.name === "difficulty skipped, others answered") {
        await pp.goto(BASE + "/family/learn/parent");
        await pp.getByRole("tab", { name: "Rückblick" }).click();
        await tid("review-v4", pp).waitFor();
        const fb = await pp.locator("[data-testid='review-v4'] [data-testid='child-feedback']").innerText();
        check("feedback matrix: the parent review distinguishes 'nicht gesagt' (skipped) from answers", /Schwierigkeit nicht gesagt/.test(fb) && /Spass no/.test(fb) && /Klarheit partly/.test(fb), fb);
      }
      if (m.name === "all left open") {
        await pp.goto(BASE + "/family/learn/parent");
        await pp.getByRole("tab", { name: "Rückblick" }).click();
        await tid("review-v4", pp).waitFor();
        const fb = await pp.locator("[data-testid='review-v4'] [data-testid='child-feedback']").innerText();
        check("feedback matrix: the parent review shows 'offen gelassen' for dimensions left open", /Schwierigkeit offen gelassen/.test(fb) && /Spass offen gelassen/.test(fb) && /Klarheit offen gelassen/.test(fb), fb);
        await shot(pp, "feedback-parent-left-open");
      }
    }
    // ---- R4-1: answered feedback survives a committed-but-lost ACK followed by a hard reload (server-owned write)
    await restoreTo(atReflect);
    await openReflect();
    {
      let dropped = false;
      let droppedStatus = null;
      const lostAckReload = async (route) => {
        const body = route.request().postDataJSON();
        if (route.request().method() === "PUT" && body?.op?.op === "reflect" && !dropped) {
          dropped = true;
          const real = await route.fetch();
          droppedStatus = (await real.json()).status;
          await route.abort("failed");
          return;
        }
        await route.continue();
      };
      await p.route("**/api/family/learning/mission", lostAckReload);
      await tid("difficulty-right").click();
      await tid("enjoyment-yes").click();
      await tid("clarity-clear").click();
      await tid("reflect-submit").click();
      await tid("reflect-notice").waitFor();
      await p.unroute("**/api/family/learning/mission", lostAckReload);
      await p.reload();
      await tid("reflect").waitFor({ state: "detached" });
      const ev = await feedbackEvents();
      const rec = await visitRec();
      check("R4-1: reflect committed, ACK dropped, hard reload before any retry → one completion, ratings and all 3 feedback events durable", droppedStatus === "applied" && rec?.finishedAt && ev.length === 3 && (await evidence()).completions.filter((c) => c.visitId === "v4").length === 1 && ev.every((e) => e.batch.startsWith("fb-")), { events: ev, feedback: rec?.feedback });
      await shot(p, "r4-1-lost-ack-reload");
    }
    // ---- R4-1: a failed telemetry POST after a successful reflect cannot lose the answered feedback (it is not client-delivered)
    await restoreTo(atReflect);
    await openReflect();
    {
      let blocked = 0;
      const blockTelemetry = async (route) => {
        blocked += 1;
        await route.abort("failed");
      };
      await p.route("**/api/family/learning/telemetry", blockTelemetry);
      await tid("difficulty-tricky").click();
      await tid("enjoyment-partly").click();
      await tid("clarity-partly").click();
      await tid("reflect-submit").click();
      await tid("reflect").waitFor({ state: "detached" });
      await p.unroute("**/api/family/learning/telemetry", blockTelemetry);
      await p.reload();
      const ev = await feedbackEvents();
      check("R4-1: every telemetry POST aborted, reload → the 3 answered feedback events are still stored with the finished visit", ev.length === 3 && blocked >= 1 && ev.every((e) => e.batch.startsWith("fb-")), { events: ev, blocked });
    }
    // ---- R4-2: a completed reflection whose request failed before commit survives a hard reload and retries with the same key
    await restoreTo(atReflect);
    await openReflect();
    {
      const keys = [];
      let dropPre = true;
      const preFail = async (route) => {
        const body = route.request().postDataJSON();
        if (route.request().method() === "PUT" && body?.op?.op === "reflect") {
          keys.push(body.idempotencyKey);
          if (dropPre) {
            dropPre = false;
            await route.abort("failed");
            return;
          }
        }
        await route.continue();
      };
      await p.route("**/api/family/learning/mission", preFail);
      await tid("difficulty-right").click();
      await tid("enjoyment-yes").click();
      await tid("clarity-skip").click();
      await tid("reflect-submit").click();
      await tid("reflect-notice").waitFor();
      await p.reload();
      await tid("reflect-notice").waitFor();
      const restored = { difficulty: await tid("difficulty-right").getAttribute("aria-pressed"), enjoyment: await tid("enjoyment-yes").getAttribute("aria-pressed"), claritySkip: await tid("clarity-skip").getAttribute("aria-pressed"), notice: await tid("reflect-notice").getAttribute("data-restored"), discard: await tid("reflect-discard").count() };
      check("R4-2: reflect failed before commit → hard reload restores the selected answers, the explicit skip and a recover/discard choice", restored.difficulty === "true" && restored.enjoyment === "true" && restored.claritySkip === "true" && restored.notice === "true" && restored.discard === 1 && (await visitRec())?.finishedAt === null, restored);
      await shot(p, "r4-2-reflect-restored");
      await tid("reflect-submit").click();
      await tid("reflect").waitFor({ state: "detached" });
      await p.unroute("**/api/family/learning/mission", preFail);
      const rec = await visitRec();
      check("R4-2: the retry after reload uses the same key and the same payload; one completion; feedback stored once", keys.length === 2 && keys[0] === keys[1] && rec?.reflection === "right" && rec?.feedback?.answers?.enjoyment === "yes" && rec?.feedback?.skipped?.includes("clarity") && (await feedbackEvents()).length === 2 && (await evidence()).completions.filter((c) => c.visitId === "v4").length === 1, { keys });
      check("R4-2: after reconciliation the recoverable draft is retired from the tab", (await p.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith("family-learning-draft")))).length === 0);
    }
    // ---- R4-2: a completed transfer whose request failed before commit survives a hard reload; whitespace and identity semantics
    await restoreTo(atTransfer);
    await openTransfer();
    {
      const sent = [];
      let dropT = true;
      const preFailT = async (route) => {
        const body = route.request().postDataJSON();
        if (route.request().method() === "PUT" && body?.op?.op === "write-transfer") {
          sent.push({ key: body.idempotencyKey, text: body.op.text });
          if (dropT) {
            dropT = false;
            await route.abort("failed");
            return;
          }
        }
        await route.continue();
      };
      await p.route("**/api/family/learning/mission", preFailT);
      await tid("transfer-input").fill("Ich sehe 3 Wellen.");
      await tid("transfer-save").click();
      await tid("transfer-notice").waitFor();
      await p.reload();
      await tid("transfer-notice").waitFor();
      check("R4-2: transfer failed before commit → hard reload restores the exact sentence with a recover/discard choice", (await tid("transfer-input").inputValue()) === "Ich sehe 3 Wellen." && (await tid("transfer-notice").getAttribute("data-restored")) === "true" && (await tid("transfer-discard").count()) === 1 && ((await evidence()).state.transfers ?? []).length === 0);
      await shot(p, "r4-2-transfer-restored");
      // Whitespace-only edit after the failure: the sent body and its identity are normalised consistently (same sentence, same key).
      await tid("transfer-input").fill("Ich  sehe 3 Wellen.");
      await tid("transfer-save").click();
      await tid("summary").waitFor();
      await p.unroute("**/api/family/learning/mission", preFailT);
      const rec = (await evidence()).state.transfers.at(-1);
      check("R4-2: a whitespace-only change is the same completed sentence: same key, the stored/sent text is the normalised sentence, one row", sent.length === 2 && sent[0].key === sent[1].key && sent[1].text === "Ich sehe 3 Wellen." && rec?.text === "Ich sehe 3 Wellen." && ((await evidence()).state.transfers ?? []).length === 1, { sent, stored: rec?.text });
    }
    // ---- R4-2: a deliberately changed sentence after a failure is a new draft (new key), never a replay of the old text
    await restoreTo(atTransfer);
    await openTransfer();
    {
      const sent = [];
      let dropT = true;
      const preFailT = async (route) => {
        const body = route.request().postDataJSON();
        if (route.request().method() === "PUT" && body?.op?.op === "write-transfer") {
          sent.push({ key: body.idempotencyKey, text: body.op.text });
          if (dropT) {
            dropT = false;
            await route.abort("failed");
            return;
          }
        }
        await route.continue();
      };
      await p.route("**/api/family/learning/mission", preFailT);
      await tid("transfer-input").fill("Ich sehe 3 Wellen.");
      await tid("transfer-save").click();
      await tid("transfer-notice").waitFor();
      await tid("transfer-input").fill("Ich sehe 4 Wellen.");
      await tid("transfer-save").click();
      await tid("summary").waitFor();
      await p.unroute("**/api/family/learning/mission", preFailT);
      const rec = (await evidence()).state.transfers.at(-1);
      check("R4-2: changed words after a failure → a new key and the changed sentence is what is stored", sent.length === 2 && sent[0].key !== sent[1].key && rec?.text === "Ich sehe 4 Wellen." && ((await evidence()).state.transfers ?? []).length === 1, { sent, stored: rec?.text });
    }
    // ---- R4-2: lost ACK (committed) then hard reload → the stage has moved on; the draft is retired, one row, no second submission
    await restoreTo(atTransfer);
    await openTransfer();
    {
      let dropped = false;
      const lostAckT = async (route) => {
        const body = route.request().postDataJSON();
        if (route.request().method() === "PUT" && body?.op?.op === "write-transfer" && !dropped) {
          dropped = true;
          await route.fetch();
          await route.abort("failed");
          return;
        }
        await route.continue();
      };
      await p.route("**/api/family/learning/mission", lostAckT);
      await tid("transfer-input").fill("Ich sehe 3 Wellen.");
      await tid("transfer-save").click();
      await tid("transfer-notice").waitFor();
      await p.unroute("**/api/family/learning/mission", lostAckT);
      await p.reload();
      await tid("summary").waitFor();
      const drafts = await p.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith("family-learning-draft")));
      check("R4-2: committed lost ACK + reload → the summary is shown, the stale draft is retired, exactly one transfer row", dropped && drafts.length === 0 && ((await evidence()).state.transfers ?? []).length === 1, { drafts });
    }
    // ---- R4-2: deliberate discard; child switch and other sign-in never expose a draft
    await restoreTo(atTransfer);
    await openTransfer();
    {
      let dropT = true;
      const preFailT = async (route) => {
        const body = route.request().postDataJSON();
        if (route.request().method() === "PUT" && body?.op?.op === "write-transfer" && dropT) {
          dropT = false;
          await route.abort("failed");
          return;
        }
        await route.continue();
      };
      await p.route("**/api/family/learning/mission", preFailT);
      await tid("transfer-input").fill("Ich sehe 3 Wellen.");
      await tid("transfer-save").click();
      await tid("transfer-notice").waitFor();
      await p.unroute("**/api/family/learning/mission", preFailT);
      const storedKeys = await p.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith("family-learning-draft")));
      check("R4-2: the recoverable draft is keyed by child and op only (bounded storage)", storedKeys.length === 1 && storedKeys[0] === "family-learning-draft:santiago:write-transfer", storedKeys);
      // Another sign-in in the same tab (a second session token, even for the same account) must not see the draft: the sign-in fingerprint differs.
      const stored = await p.evaluate(() => sessionStorage.getItem("family-learning-draft:santiago:write-transfer"));
      const otherSignIn = await mint("assistant@davideberle.com");
      await desktop.addCookies([{ name: COOKIE, value: otherSignIn, url: BASE }]);
      await p.evaluate((raw) => sessionStorage.setItem("family-learning-draft:santiago:write-transfer", raw), stored);
      await openTransfer();
      check("R4-2: a different sign-in never restores the draft (retired by the sign-in fingerprint)", otherSignIn !== assistant && (await tid("transfer-input").inputValue()) === "" && (await tid("transfer-notice").count()) === 0 && (await p.evaluate(() => sessionStorage.getItem("family-learning-draft:santiago:write-transfer"))) === null);
      await desktop.addCookies([{ name: COOKIE, value: assistant, url: BASE }]);
      // Leaving the workspace (Stopp → cockpit; the same path a child switch or sign-out navigation takes) retires the drafts.
      await p.evaluate((raw) => sessionStorage.setItem("family-learning-draft:santiago:write-transfer", raw), stored);
      await openTransfer();
      check("R4-2: the same sign-in restores it again", (await tid("transfer-input").inputValue()) === "Ich sehe 3 Wellen.");
      await p.getByRole("link", { name: "Stopp und speichern" }).click();
      await p.getByRole("link", { name: /Start|Weiter/ }).waitFor();
      check("R4-2: leaving the workspace retires the child's drafts (child switch / sign-out path)", (await p.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith("family-learning-draft")))).length === 0);
      await p.evaluate((raw) => sessionStorage.setItem("family-learning-draft:santiago:write-transfer", raw), stored);
      await openTransfer();
      check("R4-2: restored once more before the deliberate discard", (await tid("transfer-input").inputValue()) === "Ich sehe 3 Wellen.");
      await tid("transfer-discard").click();
      check("R4-2: 'Verwerfen' discards the draft deliberately (form empty, storage cleared, no row)", (await tid("transfer-input").inputValue()) === "" && (await p.evaluate(() => sessionStorage.getItem("family-learning-draft:santiago:write-transfer"))) === null && ((await evidence()).state.transfers ?? []).length === 0);
      await shot(p, "r4-2-transfer-discarded");
    }
    // ---- R4-3: an archived-shape stored review that still credits an unassessable transfer is re-derived; provenance shown
    await restoreTo(atReflect);
    await op({ op: "reflect", optionId: "right" });
    await withDbFile(async (c) => {
      const row = (await c.execute("SELECT state_json, revision FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0];
      const s = JSON.parse(String(row.state_json));
      const t = s.transfers.at(-1);
      delete t.assessed;
      t.text = "Hallo";
      t.outcome = "clean";
      await c.execute({ sql: "UPDATE family_learning_missions SET state_json = ? WHERE child_id = 'santiago'", args: [JSON.stringify(s)] });
      const rev = (await c.execute("SELECT review_json FROM family_learning_completions WHERE child_id = 'santiago' AND visit_id = 'v4'")).rows[0];
      const review = JSON.parse(String(rev.review_json));
      delete review.identity.reviewVersion;
      delete review.identity.derivedAt;
      delete review.previousReviews;
      const obj = review.learning.objectives.find((o) => o.taskId === "WRITE-TRANSFER-1");
      obj.outcome = "correct";
      obj.evidence = "independent";
      obj.support = [];
      await c.execute({ sql: "UPDATE family_learning_completions SET review_json = ? WHERE child_id = 'santiago' AND visit_id = 'v4'", args: [JSON.stringify(review)] });
    });
    await pp.goto(BASE + "/family/learn/parent");
    await pp.getByRole("tab", { name: "Rückblick" }).click();
    await tid("review-v4", pp).waitFor();
    const legacyCard = await tid("review-v4", pp).innerText();
    const refreshedNote = await pp.locator("[data-testid='review-v4'] [data-testid='review-refreshed']").innerText().catch(() => "");
    check("R4-3: the parent Rückblick no longer credits the archived 'Hallo' transfer — it is unscored, the earlier derivation is disclosed, identity kept", /WRITE-TRANSFER-1 v\d+[^\n]*nicht bewertet\s*\n\s*unscored/.test(legacyCard) && /Frühere Fassung/.test(refreshedNote) && /war „correct\/independent“, jetzt „unscored\/unscored“/.test(refreshedNote) && /Ableitung Fassung 4/.test(legacyCard), { refreshedNote });
    await shot(pp, "r4-3-legacy-review-refreshed");
    await pp.getByRole("tab", { name: "Deutsch" }).click();
    await tid("transfers", pp).waitFor();
    check("R4-3: the German tab agrees (nicht bewertet)", /keine geprüfte Stelle im Satz — nicht bewertet/.test(await tid("transfers", pp).innerText()));
    await pp.reload();
    await pp.getByRole("tab", { name: "Rückblick" }).click();
    await tid("review-v4", pp).waitFor();
    check("R4-3: a repeated read is stable (still one earlier derivation, no second refresh)", (await pp.locator("[data-testid='review-v4'] [data-testid='review-refreshed'] li").count()) === 1);
    // ---- R3-4: stable keys on the reflection path (pre-commit failure, post-commit lost ACK, duplicate submit)
    const putKeys = [];
    const collect = async (route) => {
      if (route.request().method() === "PUT") putKeys.push({ key: route.request().postDataJSON()?.idempotencyKey, op: route.request().postDataJSON()?.op?.op, revision: route.request().postDataJSON()?.expectedRevision });
      await route.continue();
    };
    // pre-commit failure: abort before the server sees it
    await restoreTo(atReflect);
    await openReflect();
    putKeys.length = 0;
    let dropPre = true;
    const preFail = async (route) => {
      const body = route.request().postDataJSON();
      if (route.request().method() === "PUT" && body?.op?.op === "reflect") {
        putKeys.push({ key: body.idempotencyKey, op: "reflect", revision: body.expectedRevision });
        if (dropPre) {
          dropPre = false;
          await route.abort("failed");
          return;
        }
      }
      await route.continue();
    };
    await p.route("**/api/family/learning/mission", preFail);
    await tid("difficulty-right").click();
    await tid("enjoyment-yes").click();
    await tid("reflect-submit").click();
    await tid("reflect-notice").waitFor();
    check("reflect pre-commit failure: a truthful recoverable notice, the answers stay, the visit is not finished", /nicht geklappt/.test(await tid("reflect-notice").innerText()) && (await visitRec())?.finishedAt === null && /Nochmal speichern/.test(await tid("reflect-submit").innerText()));
    await tid("reflect-submit").click();
    await tid("start-visit").waitFor().catch(() => {});
    await p.unroute("**/api/family/learning/mission", preFail);
    const eventsPre = await feedbackEvents();
    check("reflect pre-commit failure + retry: same payload, same idempotency key, applied once, feedback delivered once", putKeys.length === 2 && putKeys[0].key === putKeys[1].key && (await visitRec())?.finishedAt && eventsPre.length === 2 && (await evidence()).completions.filter((c) => c.visitId === "v4").length === 1, { keys: putKeys.map((k) => k.key), events: eventsPre.length });
    // post-commit lost ACK: real response fetched, then aborted
    await restoreTo(atReflect);
    await openReflect();
    putKeys.length = 0;
    let dropped = false;
    let droppedStatus = null;
    const lostAck = async (route) => {
      const body = route.request().postDataJSON();
      if (route.request().method() === "PUT" && body?.op?.op === "reflect") {
        putKeys.push({ key: body.idempotencyKey, op: "reflect", revision: body.expectedRevision });
        if (!dropped) {
          dropped = true;
          const real = await route.fetch();
          droppedStatus = (await real.json()).status;
          await route.abort("failed");
          return;
        }
      }
      await route.continue();
    };
    await p.route("**/api/family/learning/mission", lostAck);
    await tid("difficulty-easy").click();
    await tid("clarity-clear").click();
    await tid("reflect-submit").click();
    await tid("reflect-notice").waitFor();
    check("reflect post-commit lost ACK: the server committed, the child sees a recoverable notice, nothing advanced falsely", droppedStatus === "applied" && (await visitRec())?.finishedAt && (await tid("reflect").count()) === 1);
    await tid("reflect-submit").click();
    await tid("start-visit").waitFor().catch(() => {});
    await p.unroute("**/api/family/learning/mission", lostAck);
    const eventsLost = await feedbackEvents();
    check("reflect post-commit lost ACK + retry: same key → replayed, exactly one completion, feedback events exactly once (deterministic batch id)", putKeys.length === 2 && putKeys[0].key === putKeys[1].key && (await evidence()).completions.filter((c) => c.visitId === "v4").length === 1 && eventsLost.length === 2 && new Set(eventsLost.map((e) => e.batch)).size === 1, { keys: putKeys.map((k) => k.key), events: eventsLost });
    await shot(p, "feedback-lost-ack-retry");
    // duplicate submit race
    await restoreTo(atReflect);
    await openReflect();
    putKeys.length = 0;
    await p.route("**/api/family/learning/mission", collect);
    await tid("difficulty-right").click();
    await tid("reflect-submit").dispatchEvent("click");
    await tid("reflect-submit").dispatchEvent("click");
    await tid("start-visit").waitFor().catch(() => {});
    await p.unroute("**/api/family/learning/mission", collect);
    check("reflect duplicate submit race: one PUT for one completed draft", putKeys.filter((k) => k.op === "reflect").length === 1 && (await evidence()).completions.filter((c) => c.visitId === "v4").length === 1, putKeys);
    // ---- R3-4 on the transfer path + R3-2 + R3-1 through the real UI
    await restoreTo(atTransfer);
    await openTransfer();
    putKeys.length = 0;
    let dropT = true;
    const preFailT = async (route) => {
      const body = route.request().postDataJSON();
      if (route.request().method() === "PUT" && body?.op?.op === "write-transfer") {
        putKeys.push({ key: body.idempotencyKey, op: "write-transfer", revision: body.expectedRevision });
        if (dropT) {
          dropT = false;
          await route.abort("failed");
          return;
        }
      }
      await route.continue();
    };
    await p.route("**/api/family/learning/mission", preFailT);
    await tid("transfer-input").fill("Morgen zählt die Station 3 Wellen.");
    await tid("transfer-save").click();
    await tid("transfer-notice").waitFor();
    check("transfer pre-commit failure: notice, sentence kept, no row", (await tid("transfer-notice").getAttribute("data-failure")) === "network" && ((await evidence()).state.transfers ?? []).length === 0 && (await tid("transfer-input").inputValue()) === "Morgen zählt die Station 3 Wellen.");
    await tid("transfer-save").click();
    await tid("summary").waitFor();
    await p.unroute("**/api/family/learning/mission", preFailT);
    check("transfer pre-commit failure + retry: same key, exactly one transfer row (assessed 2, clean)", putKeys.length === 2 && putKeys[0].key === putKeys[1].key && ((await evidence()).state.transfers ?? []).length === 1 && (await evidence()).state.transfers[0].assessed === 2 && (await evidence()).state.transfers[0].outcome === "clean", putKeys.map((k) => k.key));
    await restoreTo(atTransfer);
    await openTransfer();
    putKeys.length = 0;
    let droppedT = false;
    let droppedTStatus = null;
    const lostAckT = async (route) => {
      const body = route.request().postDataJSON();
      if (route.request().method() === "PUT" && body?.op?.op === "write-transfer") {
        putKeys.push({ key: body.idempotencyKey, op: "write-transfer", revision: body.expectedRevision });
        if (!droppedT) {
          droppedT = true;
          const real = await route.fetch();
          droppedTStatus = (await real.json()).status;
          await route.abort("failed");
          return;
        }
      }
      await route.continue();
    };
    await p.route("**/api/family/learning/mission", lostAckT);
    await tid("transfer-input").fill("Morgen zählt die Station 3 Wellen.");
    await tid("transfer-save").click();
    await tid("transfer-notice").waitFor();
    await tid("transfer-save").click();
    await tid("summary").waitFor();
    await p.unroute("**/api/family/learning/mission", lostAckT);
    check("transfer post-commit lost ACK + retry: same key → replayed, one row, the summary opens after the retry", droppedTStatus === "applied" && putKeys.length === 2 && putKeys[0].key === putKeys[1].key && ((await evidence()).state.transfers ?? []).length === 1, putKeys.map((k) => k.key));
    await shot(p, "transfer-lost-ack-summary");
    // stale: the server moved on (skip applied by another tab) → the retry is stale, the page refreshes to the summary, no row
    await restoreTo(atTransfer);
    await openTransfer();
    await tid("transfer-input").fill("Morgen zählt die Station 3 Wellen.");
    await op({ op: "skip-stage", stage: "log-transfer", reason: "child" });
    await tid("transfer-save").click();
    await tid("summary").waitFor();
    const staleRec = (await evidence()).state.transfers.at(-1);
    check("transfer stale (another tab skipped first): no false row, the current stage is shown", staleRec?.outcome === "skipped" && ((await evidence()).state.transfers ?? []).length === 1, staleRec);
    // R3-2: the shown correction after a SKIPPED revision is refused with guidance and no row; a new sentence then works
    await restoreTo(atTransfer);
    await openTransfer();
    await tid("transfer-input").fill("Ich habe 2 Schildkroten gesehen.");
    await tid("transfer-save").click();
    await tid("transfer-notice").waitFor();
    check("R3-2: the shown correction (revision skipped) is refused with the copied-text guidance and no transfer row", (await tid("transfer-notice").getAttribute("data-code")) === "copied-text" && /Satz von vorhin/.test(await tid("transfer-notice").innerText()) && ((await evidence()).state.transfers ?? []).length === 0 && (await tid("transfer").count()) === 1);
    await shot(p, "transfer-copied-refused");
    await tid("transfer-input").fill("Ich|habe|2|Schildkroten gesehen");
    await tid("transfer-save").click();
    await tid("transfer-notice").waitFor();
    check("R3-2: the marked form is refused too", (await tid("transfer-notice").getAttribute("data-code")) === "copied-text");
    await tid("transfer-input").fill("Ich habe 3 Wellen gesehen.");
    await tid("transfer-save").click();
    await tid("summary").waitFor();
    const okRec = (await evidence()).state.transfers.at(-1);
    check("R3-2: a genuinely different reviewed sentence is accepted with exposure retained (supported)", okRec?.outcome === "clean" && okRec?.helpExposed === true && (await evidence()).attempts.filter((a) => a.taskId === "WRITE-TRANSFER-1").at(-1)?.evidence === "supported", okRec);
    // R3-1: an unassessable sentence through the UI stays unscored and is shown so to the parent
    await restoreTo(atTransfer);
    await openTransfer();
    await tid("transfer-input").fill("Hallo");
    await tid("transfer-save").click();
    await tid("summary").waitFor();
    const unRec = (await evidence()).state.transfers.at(-1);
    const unAttempt = (await evidence()).attempts.filter((a) => a.taskId === "WRITE-TRANSFER-1").at(-1);
    check("R3-1: 'Hallo' is unassessable → outcome unassessable, attempt unscored, no summary success from it", unRec?.outcome === "unassessable" && unRec?.assessed === 0 && unAttempt?.evidence === "unscored" && unAttempt?.correct === null && !/neuer Satz/i.test((await view()).summary?.success?.text ?? ""), { unRec, evidence: unAttempt?.evidence });
    await pp.goto(BASE + "/family/learn/parent");
    await pp.getByRole("tab", { name: "Deutsch" }).click();
    await tid("transfers", pp).waitFor();
    check("R3-1: the parent German tab says 'nicht bewertet' for the unassessable sentence", /keine geprüfte Stelle im Satz — nicht bewertet/.test(await tid("transfers", pp).innerText()), await tid("transfers", pp).innerText());
    await shot(pp, "transfer-unassessable-parent");
    // ---- R4-2: erasure — a completed failed draft bound to the old generation is retired at the next load, never sent or shown
    await restoreTo(atTransfer);
    await openTransfer();
    {
      let dropT = true;
      const preFailT = async (route) => {
        const body = route.request().postDataJSON();
        if (route.request().method() === "PUT" && body?.op?.op === "write-transfer" && dropT) {
          dropT = false;
          await route.abort("failed");
          return;
        }
        await route.continue();
      };
      await p.route("**/api/family/learning/mission", preFailT);
      await tid("transfer-input").fill("Ich sehe 3 Wellen.");
      await tid("transfer-save").click();
      await tid("transfer-notice").waitFor();
      await p.unroute("**/api/family/learning/mission", preFailT);
      const beforeErase = await p.evaluate(() => sessionStorage.getItem("family-learning-draft:santiago:write-transfer"));
      check("R4-2: a completed failed draft is stored before erasure", beforeErase !== null);
      const del = await api("DELETE", "/api/family/learning/parent/records?child=santiago&confirm=santiago", null, owner);
      await openMission();
      // After erasure the child starts fresh: the workspace shows the start view (no running visit, no stage form).
      await tid("start-visit").waitFor();
      await p.waitForTimeout(300);
      check("R4-2: after erasure the draft of the old generation is retired and never sent or shown", del.status === 200 && (await p.evaluate(() => sessionStorage.getItem("family-learning-draft:santiago:write-transfer"))) === null && (await tid("transfer").count()) === 0 && ((await evidence()).state?.transfers ?? []).length === 0);
      await shot(p, "r4-2-after-erasure");
    }
    }
    if (MODE === "round5") {
    // =====================================================================
    // Round 5 (own mode / own server: the cases rebuild the mission row from the snapshots after each erasure)
    // =====================================================================
    /** Rebuild the mission row from a snapshot (INSERT after an erasure, UPDATE otherwise); the visit start can be shifted so the instance differs. */
    const recreate = async (snap, shiftMs = 0) => {
      await withDbFile(async (c) => {
        const state = JSON.parse(String(snap.state_json));
        if (shiftMs) for (const v of state.visits) if (v.id === "v4") v.startedAt = new Date(Date.parse(v.startedAt) + shiftMs).toISOString();
        const now = new Date().toISOString();
        await c.execute({ sql: "INSERT INTO family_learning_missions (child_id, mission_id, content_version, revision, state_json, created_at, updated_at) VALUES ('santiago', 'santiago-expedition', 2, ?, ?, ?, ?) ON CONFLICT(child_id, mission_id) DO UPDATE SET revision = excluded.revision, state_json = excluded.state_json, updated_at = excluded.updated_at", args: [Number(snap.revision), JSON.stringify(state), now, now] });
        await c.execute("DELETE FROM family_learning_mutations WHERE child_id = 'santiago' AND idempotency_key LIKE 'j-feedback-%'");
        await c.execute("DELETE FROM family_learning_completions WHERE child_id = 'santiago' AND visit_id = 'v4'");
        await c.execute("DELETE FROM family_learning_telemetry WHERE child_id = 'santiago' AND visit_id = 'v4'");
        await c.execute("DELETE FROM family_learning_attempts WHERE child_id = 'santiago' AND visit_id = 'v4' AND task_id = 'WRITE-TRANSFER-1'");
        await c.execute("DELETE FROM family_learning_work_samples WHERE child_id = 'santiago' AND visit_id = 'v4' AND kind = 'writing_transfer'");
      });
      await new Promise((r) => setTimeout(r, 250));
    };
    const erase = async () => {
      const del = await api("DELETE", "/api/family/learning/parent/records?child=santiago&confirm=santiago", null, owner);
      if (del.status !== 200) throw new Error("erasure failed " + del.status);
      return del;
    };
    const textAnywhere = (needle) => withDbFile(async (c) => {
      const hits = [];
      for (const t of ["missions", "mutations", "attempts", "work_samples", "completions", "telemetry", "exposures", "support_events"]) {
        const rows = (await c.execute(`SELECT * FROM family_learning_${t} WHERE child_id = 'santiago'`)).rows;
        if (JSON.stringify(rows).includes(needle)) hits.push(t);
      }
      return hits;
    });
    const draftKeys = () => p.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith("family-learning-draft")));
    const fbEvents = () => withDbFile(async (c) => (await c.execute("SELECT events_json FROM family_learning_telemetry WHERE child_id = 'santiago' AND visit_id = 'v4'")).rows.flatMap((r) => JSON.parse(String(r.events_json)).filter((e) => e.kind === "feedback")));
    const completions4 = async () => (await evidence()).completions.filter((c) => c.visitId === "v4").length;
    const abortOnce = (opName) => {
      let dropped = false;
      const handler = async (route) => {
        const body = route.request().postDataJSON();
        if (route.request().method() === "PUT" && body?.op?.op === opName && !dropped) {
          dropped = true;
          await route.abort("failed");
          return;
        }
        await route.continue();
      };
      return handler;
    };
    // ---- R5-1 transfer: erase → legitimate recreation to the SAME revision → the still-mounted old draft is refused (409 stale), nothing stored
    await recreate(atTransfer);
    await openTransfer();
    {
      const h = abortOnce("write-transfer");
      await p.route("**/api/family/learning/mission", h);
      await tid("transfer-input").fill("Ich sehe 3 Wellen.");
      await tid("transfer-save").click();
      await tid("transfer-notice").waitFor();
      await p.unroute("**/api/family/learning/mission", h);
      const oldView = await view();
      const oldDraft = await p.evaluate(() => sessionStorage.getItem("family-learning-draft:santiago:write-transfer"));
      await erase();
      await recreate(atTransfer, 1000);
      const newView = await view();
      check("R5-1 transfer setup: after erasure the recreated state has the same revision, a different generation and a different visit start", oldDraft !== null && newView.revision === oldView.revision && newView.erasureGeneration !== oldView.erasureGeneration && newView.visit.startedAt !== oldView.visit.startedAt, { revision: newView.revision, gen: [oldView.erasureGeneration, newView.erasureGeneration] });
      const responseP = p.waitForResponse((r) => r.url().includes("/api/family/learning/mission") && r.request().method() === "PUT");
      await tid("transfer-save").click();
      const response = await responseP;
      const body = await response.json();
      const sent = response.request().postDataJSON();
      await p.waitForTimeout(300);
      check("R5-1 transfer (erase first): the mounted old draft's retry carries the old identity and is refused as stale (409), never applied", response.status() === 409 && body.status === "stale" && sent.context?.erasureGeneration === oldView.erasureGeneration && sent.context?.visit?.startedAt === oldView.visit.startedAt && sent.expectedRevision === oldView.revision, { status: response.status(), outcome: body.status, context: sent.context });
      check("R5-1 transfer (erase first): zero resurrection — no transfer row, the text in no table, no ledger row, the draft retired from the tab", ((await evidence()).state.transfers ?? []).length === 0 && (await textAnywhere("Wellen")).length === 0 && (await withDbFile(async (c) => Number((await c.execute({ sql: "SELECT COUNT(*) AS c FROM family_learning_mutations WHERE idempotency_key = ?", args: [sent.idempotencyKey] })).rows[0].c))) === 0 && (await draftKeys()).length === 0, { hits: await textAnywhere("Wellen") });
      await shot(p, "r5-1-transfer-stale-after-erasure");
      // new key, old identity, through the API: stale as well
      const apiOld = await api("PUT", "/api/family/learning/mission", { op: { op: "write-transfer", text: "Ich sehe 3 Wellen.", modality: "typed" }, expectedRevision: oldView.revision, idempotencyKey: `r5-old-${Date.now()}`, context: contextOf(oldView) }, assistant, bearer);
      const apiNoCtx = await api("PUT", "/api/family/learning/mission", { op: { op: "write-transfer", text: "Ich sehe 3 Wellen.", modality: "typed" }, expectedRevision: oldView.revision, idempotencyKey: `r5-noctx-${Date.now()}` }, assistant, bearer);
      check("R5-1 transfer: a NEW key with the old identity is stale (409); a request without any context is refused by the route (400) — the server boundary does not depend on browser cleanup", apiOld.status === 409 && apiOld.json?.status === "stale" && apiNoCtx.status === 400 && ((await evidence()).state.transfers ?? []).length === 0, { apiOld: apiOld.status, apiNoCtx: apiNoCtx.status });
      // positive: after a reload the form is empty (old draft retired); fresh work in the new generation applies once; its lost-ACK retry replays
      await paceMint();
      await p.reload();
      await tid("transfer").waitFor();
      check("R5-1 transfer: after reload nothing of the old draft is shown", (await tid("transfer-input").inputValue()) === "" && (await tid("transfer-notice").count()) === 0);
      const keys = [];
      let lostOnce = false;
      const lostAck = async (route) => {
        const b = route.request().postDataJSON();
        if (route.request().method() === "PUT" && b?.op?.op === "write-transfer") {
          keys.push({ key: b.idempotencyKey, gen: b.context?.erasureGeneration });
          if (!lostOnce) {
            lostOnce = true;
            await route.fetch();
            await route.abort("failed");
            return;
          }
        }
        await route.continue();
      };
      await p.route("**/api/family/learning/mission", lostAck);
      await tid("transfer-input").fill("Ich sehe 3 Wellen.");
      await tid("transfer-save").click();
      await tid("transfer-notice").waitFor();
      await tid("transfer-save").click();
      await tid("summary").waitFor();
      await p.unroute("**/api/family/learning/mission", lostAck);
      check("R5-1 transfer positive: fresh work in the new generation applies once; its same-generation lost-ACK retry replays (same key, one row, new generation)", keys.length === 2 && keys[0].key === keys[1].key && keys[0].gen === newView.erasureGeneration && ((await evidence()).state.transfers ?? []).length === 1 && (await evidence()).erasureGeneration === newView.erasureGeneration, keys);
    }
    // ---- R5-1 transfer: the request is IN FLIGHT when erasure + recreation complete → still refused
    await erase();
    await recreate(atTransfer);
    await openTransfer();
    {
      let held = null;
      let seen;
      const gotIt = new Promise((r) => (seen = r));
      const hold = async (route) => {
        const b = route.request().postDataJSON();
        if (route.request().method() === "PUT" && b?.op?.op === "write-transfer" && !held) {
          held = route;
          seen();
          return;
        }
        await route.continue();
      };
      await p.route("**/api/family/learning/mission", hold);
      const oldView = await view();
      await tid("transfer-input").fill("Ich sehe 3 Wellen.");
      await tid("transfer-save").click();
      await gotIt;
      await erase();
      await recreate(atTransfer, 2000);
      const responseP = p.waitForResponse((r) => r.url().includes("/api/family/learning/mission") && r.request().method() === "PUT");
      await held.continue();
      const response = await responseP;
      const body = await response.json();
      await p.unroute("**/api/family/learning/mission", hold);
      await p.waitForTimeout(300);
      check("R5-1 transfer (request in flight, erasure completes first): refused as stale (409); nothing stored; draft retired", response.status() === 409 && body.status === "stale" && body.view?.erasureGeneration !== oldView.erasureGeneration && ((await evidence()).state.transfers ?? []).length === 0 && (await textAnywhere("Wellen")).length === 0 && (await draftKeys()).length === 0, { status: response.status() });
    }
    // ---- R5-1 reflect: the same two orders for the finishing request
    await erase();
    await recreate(atReflect);
    await openReflect();
    {
      const h = abortOnce("reflect");
      await p.route("**/api/family/learning/mission", h);
      await tid("difficulty-right").click();
      await tid("enjoyment-yes").click();
      await tid("clarity-clear").click();
      await tid("reflect-submit").click();
      await tid("reflect-notice").waitFor();
      await p.unroute("**/api/family/learning/mission", h);
      const oldView = await view();
      await erase();
      await recreate(atReflect, 1000);
      const newView = await view();
      const responseP = p.waitForResponse((r) => r.url().includes("/api/family/learning/mission") && r.request().method() === "PUT");
      await tid("reflect-submit").click();
      const response = await responseP;
      const body = await response.json();
      await p.waitForTimeout(300);
      check("R5-1 reflect (erase first): the mounted old finishing draft is refused as stale (409) after recreation to the same revision; no completion, no review, no feedback telemetry, draft retired", newView.revision === oldView.revision && response.status() === 409 && body.status === "stale" && (await completions4()) === 0 && (await fbEvents()).length === 0 && (await draftKeys()).length === 0, { status: response.status(), outcome: body.status });
      await shot(p, "r5-1-reflect-stale-after-erasure");
      await paceMint();
      await p.reload();
      await tid("reflect").waitFor();
      check("R5-1 reflect: after reload no old answer is pre-selected", (await tid("difficulty-right").getAttribute("aria-pressed")) === "false" && (await tid("enjoyment-yes").getAttribute("aria-pressed")) === "false" && (await tid("reflect-notice").count()) === 0);
      await tid("difficulty-right").click();
      await tid("enjoyment-yes").click();
      await tid("clarity-clear").click();
      await tid("reflect-submit").click();
      await tid("reflect").waitFor({ state: "detached" });
      check("R5-1 reflect positive: the fresh finish in the new generation yields exactly one completion and 3 feedback events", (await completions4()) === 1 && (await fbEvents()).length === 3 && (await evidence()).erasureGeneration === newView.erasureGeneration);
    }
    await erase();
    await recreate(atReflect);
    await openReflect();
    {
      let held = null;
      let seen;
      const gotIt = new Promise((r) => (seen = r));
      const hold = async (route) => {
        const b = route.request().postDataJSON();
        if (route.request().method() === "PUT" && b?.op?.op === "reflect" && !held) {
          held = route;
          seen();
          return;
        }
        await route.continue();
      };
      await p.route("**/api/family/learning/mission", hold);
      await tid("difficulty-right").click();
      await tid("enjoyment-yes").click();
      await tid("clarity-clear").click();
      await tid("reflect-submit").click();
      await gotIt;
      await erase();
      await recreate(atReflect, 2000);
      const responseP = p.waitForResponse((r) => r.url().includes("/api/family/learning/mission") && r.request().method() === "PUT");
      await held.continue();
      const response = await responseP;
      const body = await response.json();
      await p.unroute("**/api/family/learning/mission", hold);
      await p.waitForTimeout(300);
      check("R5-1 reflect (request in flight, erasure completes first): refused as stale (409); no completion, no telemetry, draft retired", response.status() === 409 && body.status === "stale" && (await completions4()) === 0 && (await fbEvents()).length === 0 && (await draftKeys()).length === 0, { status: response.status() });
    }
    // ---- R5-2: server-owned feedback without any client UX telemetry → the parent sees "nicht erfasst", never measured zeros
    await erase();
    await recreate(atReflect);
    {
      let blocked = 0;
      const block = async (route) => {
        blocked += 1;
        await route.abort("failed");
      };
      // The block is installed BEFORE the page loads: every client telemetry POST of this visit (mount flush included) is absent.
      await p.route("**/api/family/learning/telemetry", block);
      await openReflect();
      await tid("difficulty-right").click();
      await tid("enjoyment-yes").click();
      await tid("clarity-clear").click();
      await tid("reflect-submit").click();
      await tid("reflect").waitFor({ state: "detached" });
      await p.waitForTimeout(500);
      await p.unroute("**/api/family/learning/telemetry", block);
      const ev = await evidence();
      const c4 = ev.completions.find((c) => c.visitId === "v4");
      const t = c4?.review?.experience?.telemetry;
      check("R5-2 API: feedback-only completion → telemetry supported (3 feedback events) but uxObserved=false; active seconds, hidden intervals, pauses, save failures and retries are null, not 0; the review says 'nicht erfasst'", blocked >= 1 && t && t.supported === true && t.uxObserved === false && t.feedbackEvents === 3 && t.uxEvents === 0 && t.foregroundActiveSeconds === null && t.hiddenIntervals === null && t.pauses === null && t.saveFailures === null && t.retries === null && c4.review.experience.hypotheses.length === 0 && c4.review.experience.missing.some((m) => /nicht erfasst/.test(m)) && c4.review.experience.childFeedback.difficulty === "right", { telemetry: t, blocked });
      await pp.goto(BASE + "/family/learn/parent");
      await pp.getByRole("tab", { name: "Rückblick" }).click();
      await tid("review-v4", pp).waitFor();
      const card = await tid("review-v4", pp).innerText();
      check("R5-2 parent Rückblick: 'Bedienungs-Daten: nicht erfasst' is shown; no 'aktive Zeit im Vordergrund 0 s', no '0× Fenster verlassen', no '0 Speicherfehler'; the child's answers are shown", (await pp.locator("[data-testid='review-v4'] [data-testid='ux-missing']").count()) === 1 && !/aktive Zeit im Vordergrund 0 s/.test(card) && !/0× Fenster verlassen/.test(card) && !/0 Speicherfehler/.test(card) && /Schwierigkeit right/.test(card) && /unbekannt, nicht null/.test(card), { excerpt: card.match(/Bedienungs-Daten[^\n]*/)?.[0] });
      await shot(pp, "r5-2-feedback-only-parent");
      // Legacy: the same completion stored under the round-4 rules with false zeros → re-derived on the next read
      await withDbFile(async (c) => {
        const row = (await c.execute("SELECT review_json FROM family_learning_completions WHERE child_id = 'santiago' AND visit_id = 'v4'")).rows[0];
        const old = JSON.parse(String(row.review_json));
        old.identity.reviewVersion = 3;
        delete old.previousReviews;
        old.experience.telemetry = { supported: true, batches: 1, events: 3, foregroundActiveSeconds: 0, idleRuleSeconds: 60, hiddenIntervals: 0, saveFailures: 0, retries: 0, corrections: 0, hints: 0, pauses: 0, byStage: {} };
        old.experience.missing = old.experience.missing.filter((m) => !/nicht erfasst/.test(m));
        await c.execute({ sql: "UPDATE family_learning_completions SET review_json = ? WHERE child_id = 'santiago' AND visit_id = 'v4'", args: [JSON.stringify(old)] });
      });
      const ev2 = await evidence();
      const t2 = ev2.completions.find((c) => c.visitId === "v4")?.review?.experience?.telemetry;
      await pp.reload();
      await pp.getByRole("tab", { name: "Rückblick" }).click();
      await tid("review-v4", pp).waitFor();
      const card2 = await tid("review-v4", pp).innerText();
      check("R5-2 legacy stored review with false zeros: re-derived on read (version 4, earlier derivation kept), the parent shows 'nicht erfasst' and never the stored zeros", t2 && t2.uxObserved === false && t2.foregroundActiveSeconds === null && ev2.completions.find((c) => c.visitId === "v4").review.identity.reviewVersion === 4 && ev2.completions.find((c) => c.visitId === "v4").review.previousReviews?.length === 1 && (await pp.locator("[data-testid='review-v4'] [data-testid='ux-missing']").count()) === 1 && !/aktive Zeit im Vordergrund 0 s/.test(card2) && /Frühere Fassung/.test(card2), { version: ev2.completions.find((c) => c.visitId === "v4").review.identity.reviewVersion });
    }
    // R5-2 control: telemetry delivered normally → observed numbers (a genuine zero stays 0)
    await erase();
    await recreate(atReflect);
    await openReflect();
    {
      await tid("difficulty-right").click();
      await tid("enjoyment-yes").click();
      await tid("clarity-clear").click();
      await tid("reflect-submit").click();
      await tid("reflect").waitFor({ state: "detached" });
      await p.waitForTimeout(800);
      const ev = await evidence();
      const t = ev.completions.find((c) => c.visitId === "v4")?.review?.experience?.telemetry;
      await pp.goto(BASE + "/family/learn/parent");
      await pp.getByRole("tab", { name: "Rückblick" }).click();
      await tid("review-v4", pp).waitFor();
      const card = await tid("review-v4", pp).innerText();
      check("R5-2 control: delivered UX telemetry → uxObserved=true with numbers (genuine 0 save failures stays 0), feedback counted separately, unobserved stages listed", t && t.uxObserved === true && t.uxEvents > 0 && t.feedbackEvents === 3 && typeof t.foregroundActiveSeconds === "number" && t.saveFailures === 0 && Array.isArray(t.unobservedStages) && (await pp.locator("[data-testid='review-v4'] [data-testid='ux-observed']").count()) === 1 && /Bedienungs-Ereignisse/.test(card) && /nur übermittelte Pakete/.test(card), { ux: t?.uxEvents, fb: t?.feedbackEvents, active: t?.foregroundActiveSeconds });
      await shot(pp, "r5-2-observed-parent");
    }
    // ---- R5-3: the real Auth.js sign-out retires completed drafts; expired session; late response; account switch; same-sign-in reload control
    const signOutFromPage = () => p.evaluate(async () => {
      const csrf = await fetch("/api/auth/csrf").then((r) => r.json());
      const res = await fetch("/api/auth/signout", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Auth-Return-Redirect": "1" }, body: new URLSearchParams({ csrfToken: csrf.csrfToken, callbackUrl: location.origin + "/login" }) });
      return { status: res.status, body: await res.json().catch(() => null) };
    });
    for (const kind of ["transfer", "reflect"]) {
      await erase();
      await recreate(kind === "transfer" ? atTransfer : atReflect);
      await desktop.addCookies([{ name: COOKIE, value: assistant, url: BASE }]);
      if (kind === "transfer") await openTransfer();
      else await openReflect();
      const h = abortOnce(kind === "transfer" ? "write-transfer" : "reflect");
      await p.route("**/api/family/learning/mission", h);
      if (kind === "transfer") {
        await tid("transfer-input").fill("Ich sehe 3 Wellen.");
        await tid("transfer-save").click();
        await tid("transfer-notice").waitFor();
      } else {
        await tid("difficulty-right").click();
        await tid("enjoyment-yes").click();
        await tid("reflect-submit").click();
        await tid("reflect-notice").waitFor();
      }
      await p.unroute("**/api/family/learning/mission", h);
      const before = await draftKeys();
      // same-sign-in reload control: the draft survives a reload
      await paceMint();
      await p.reload();
      await tid(kind === "transfer" ? "transfer-notice" : "reflect-notice").waitFor();
      check(`R5-3 ${kind} control: the completed draft survives a same-sign-in reload`, before.length === 1 && (await draftKeys()).length === 1);
      const signout = await signOutFromPage();
      const session = await (await p.request.get(BASE + "/api/auth/session")).json().catch(() => null);
      await p.goto(BASE + "/login");
      await p.getByText("Continue with Google").waitFor();
      await p.waitForTimeout(200);
      const after = await draftKeys();
      check(`R5-3 ${kind}: the real Auth.js sign-out (200, session null, sign-in page shown) retires the completed draft from the tab`, signout.status === 200 && (session === null || !session?.user) && after.length === 0, { signout: signout.status, session, after });
      if (kind === "transfer") await shot(p, "r5-3-after-signout-login");
      // sign in again (same account, new token = new sign-in) and open learning: nothing of the old draft
      await desktop.addCookies([{ name: COOKIE, value: assistant, url: BASE }]);
      if (kind === "transfer") {
        await openTransfer();
        check("R5-3 transfer: after signing in again nothing is restored, submitted or repopulated", (await tid("transfer-input").inputValue()) === "" && (await tid("transfer-notice").count()) === 0 && ((await evidence()).state.transfers ?? []).length === 0 && (await draftKeys()).length === 0);
      } else {
        await openReflect();
        check("R5-3 reflect: after signing in again nothing is restored, submitted or repopulated", (await tid("difficulty-right").getAttribute("aria-pressed")) === "false" && (await tid("reflect-notice").count()) === 0 && (await completions4()) === 0 && (await draftKeys()).length === 0);
      }
    }
    // account switch: a draft of sign-in A, sign-out, sign-in B (another token): nothing restored, storage empty
    await erase();
    await recreate(atTransfer);
    await openTransfer();
    {
      const h = abortOnce("write-transfer");
      await p.route("**/api/family/learning/mission", h);
      await tid("transfer-input").fill("Ich sehe 3 Wellen.");
      await tid("transfer-save").click();
      await tid("transfer-notice").waitFor();
      await p.unroute("**/api/family/learning/mission", h);
      await signOutFromPage();
      await p.goto(BASE + "/login");
      await p.getByText("Continue with Google").waitFor();
      const other = await mint("assistant@davideberle.com");
      await desktop.addCookies([{ name: COOKIE, value: other, url: BASE }]);
      await openTransfer();
      check("R5-3 account switch / relogin: after sign-out and a different sign-in nothing is restored and the storage is empty", (await tid("transfer-input").inputValue()) === "" && (await draftKeys()).length === 0 && ((await evidence()).state.transfers ?? []).length === 0);
      await desktop.addCookies([{ name: COOKIE, value: assistant, url: BASE }]);
    }
    // expired / lost session while the form is mounted: the retry answers 401 → the draft is retired in place
    await erase();
    await recreate(atTransfer);
    await openTransfer();
    {
      const h = abortOnce("write-transfer");
      await p.route("**/api/family/learning/mission", h);
      await tid("transfer-input").fill("Ich sehe 3 Wellen.");
      await tid("transfer-save").click();
      await tid("transfer-notice").waitFor();
      await p.unroute("**/api/family/learning/mission", h);
      await desktop.clearCookies();
      const responseP = p.waitForResponse((r) => r.url().includes("/api/family/learning/") && (r.status() === 401 || r.status() === 403));
      await tid("transfer-save").click();
      const response = await responseP;
      await p.waitForTimeout(400);
      check("R5-3 expired session in place: the retry is answered 401/403 and the completed draft is retired, never re-saved", (response.status() === 401 || response.status() === 403) && (await draftKeys()).length === 0 && ((await evidence()).state.transfers ?? []).length === 0, { status: response.status(), url: response.url().replace(BASE, "") });
      await desktop.addCookies([{ name: COOKIE, value: assistant, url: BASE }]);
    }
    // late response after sign-out: the request is in flight when the child signs out and the sign-in page is shown
    await erase();
    await recreate(atTransfer);
    await openTransfer();
    {
      let held = null;
      let seen;
      const gotIt = new Promise((r) => (seen = r));
      const hold = async (route) => {
        const b = route.request().postDataJSON();
        if (route.request().method() === "PUT" && b?.op?.op === "write-transfer" && !held) {
          held = route;
          seen();
          return;
        }
        await route.continue();
      };
      await p.route("**/api/family/learning/mission", hold);
      await tid("transfer-input").fill("Ich sehe 3 Wellen.");
      await tid("transfer-save").click();
      await gotIt;
      await signOutFromPage();
      await p.goto(BASE + "/login");
      await p.getByText("Continue with Google").waitFor();
      await held.abort("failed").catch(() => {});
      await p.unroute("**/api/family/learning/mission", hold).catch(() => {});
      await p.waitForTimeout(300);
      check("R5-3 late response after sign-out: the draft stays retired; nothing is re-saved or submitted", (await draftKeys()).length === 0 && ((await evidence()).state.transfers ?? []).length === 0);
      await desktop.addCookies([{ name: COOKIE, value: assistant, url: BASE }]);
    }
    // ---- composed gaps (W4/V2): a failed log save leaves no page and no artifact until the retry succeeds; a clean log + clean transfer earns limited independent credit
    await erase();
    await recreate(atLog);
    await openMission();
    {
      await p.locator("form textarea").first().waitFor();
      const h = abortOnce("save-log");
      await p.route("**/api/family/learning/mission", h);
      await p.locator("form textarea").first().fill("Ich sehe 2 Wellen.");
      await p.locator("form button[type=submit]").first().click();
      await p.getByText("Keine Verbindung").waitFor();
      await p.unroute("**/api/family/learning/mission", h);
      const pagesBefore = (await evidence()).state.pages.length;
      check("composed: a failed log save leaves no page (no artifact can be claimed) and the child sees a truthful notice", pagesBefore === 2 && (await p.locator("form textarea").first().inputValue()) === "Ich sehe 2 Wellen.");
      await p.locator("form button[type=submit]").first().click();
      await tid("revise-none").waitFor();
      check("composed: the retry saves the page; a clean sentence has nothing to fix (no help shown)", (await evidence()).state.pages.length === 3 && (await tid("revise-help").count()) === 0);
      await tid("revise-save").click();
      await tid("transfer").waitFor();
      await tid("transfer-input").fill("Ich sehe 3 Wellen.");
      await tid("transfer-save").click();
      await tid("summary").waitFor();
      const artifact = await tid("summary-artifact").innerText();
      const success = (await tid("summary-success").count()) ? await tid("summary-success").innerText() : "";
      check("composed: the summary artifact is the saved page (the success line cites the independent math attempt, which ranks first; the sentence is credited in the review below)", /Ich sehe 2 Wellen\./.test(artifact) && success.length > 0, { artifact, success });
      await tid("summary-next-button").click();
      await tid("reflect").waitFor();
      await tid("difficulty-right").click();
      await tid("reflect-submit").click();
      await tid("reflect").waitFor({ state: "detached" });
      const rec = (await evidence()).state.transfers.at(-1);
      const obj = (await evidence()).completions.find((c) => c.visitId === "v4")?.review?.learning?.objectives?.find((o) => o.taskId === "WRITE-TRANSFER-1");
      check("composed: clean log (no help shown) + clean assessable transfer → WRITE-TRANSFER-1 correct/independent (limited credit, uncertainty stated); helped controls stay 'supported' elsewhere in this run", rec?.outcome === "clean" && rec?.helpExposed === false && obj?.outcome === "correct" && obj?.evidence === "independent" && typeof obj?.uncertainty === "string", { rec: { outcome: rec?.outcome, helpExposed: rec?.helpExposed, assessed: rec?.assessed }, obj });
      await shot(p, "composed-clean-log-independent-transfer");
    }
    }
  }

  if (MODE === "decisions") {
    if (!DB) throw new Error("--db is required for the decisions mode");
    const { createRequire } = await import("node:module");
    const req = createRequire(import.meta.url);
    const { createClient } = req("@libsql/client");
    // Reach the typing course once through the real API (declined theme), then snapshot the mission row.
    await setLayout("ch-de-qwertz");
    for (const o of [{ op: "start-visit" }, { op: "resume-base" }, { op: "choose-station", theme: "none" }, { op: "typing-check", observed: ["'", "ö", "z"] }]) await op(o);
    // Harness-only fixture reset on the server's SQLite file: a short-lived second connection per reset (opened, used, closed) so the
    // server's own writer never competes with a lingering harness connection; retried on SQLITE_BUSY. Production uses Turso, not a shared file.
    const withDb = async (fn) => {
      const c = createClient({ url: "file:" + DB });
      try {
        for (let attempt = 0; ; attempt += 1) {
          try {
            return await fn(c);
          } catch (e) {
            if (!/SQLITE_BUSY/.test(String(e)) || attempt >= 50) throw e;
            await new Promise((r) => setTimeout(r, 100));
          }
        }
      } finally {
        c.close();
      }
    };
    const snap = await withDb(async (c) => (await c.execute("SELECT state_json, revision FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0]);
    const restore = async () => {
      await withDb(async (c) => {
        await c.execute({ sql: "UPDATE family_learning_missions SET state_json = ?, revision = ? WHERE child_id = 'santiago'", args: [String(snap.state_json), Number(snap.revision)] });
        await c.execute("DELETE FROM family_learning_mutations WHERE child_id = 'santiago' AND idempotency_key LIKE 'j-decisions-%'");
      });
      await new Promise((r) => setTimeout(r, 250));
    };
    const burstApi = async (comfort) => {
      // A server 500 here can only be the file-database lock contention caused by the harness reset above; retry a few times (harness accommodation, never a candidate expectation).
      for (let attempt = 0; ; attempt += 1) {
        const v = await view();
        try {
          return await op({ op: "typing-burst", lessonId: v.typingCourse.lesson.id, lines: v.typingCourse.lesson.lines, seconds: 5, comfort });
        } catch (e) {
          if (!/: 500 /.test(String(e)) || attempt >= 5) throw e;
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    };
    const burstUI = async (comfort) => {
      const v = await view();
      for (const line of v.typingCourse.lesson.lines) {
        await tid("course-input").fill(line);
        await tid("course-input").press("Enter");
      }
      await tid(`comfort-${comfort}`).click();
    };
    const card = async () => ({ cards: await tid("decision-card").count(), action: await tid("decision-card").getAttribute("data-decision").catch(() => null), inputs: await tid("course-input").count(), next: await tid("course-continue").count(), shorter: await tid("shorter-burst").count(), again: await tid("another-burst").count() });
    const openCourse = async () => {
      await openMission();
      await p.getByRole("heading", { name: /Tippen/ }).waitFor();
    };
    for (const action of ["repeat", "smaller", "advance", "stop"]) {
      // ---- normal ACK through the UI
      await restore();
      if (action === "smaller") await burstApi("hard");
      if (action === "advance") await burstApi("ok");
      if (action === "stop") for (let i = 0; i < 9; i += 1) await burstApi("ok");
      await openCourse();
      if (await tid("another-burst").count()) await tid("another-burst").click();
      await tid("course-input").waitFor();
      const lessonBefore = (await view()).typingCourse.lesson.id;
      await burstUI(action === "smaller" ? "hard" : "ok");
      await tid("decision-card").waitFor();
      const normal = await card();
      const afterNormal = (await view()).typingCourse;
      check(`decisions: ${action} — normal ACK shows the decision card with its choices (no silent continuation)`, afterNormal.decision.action === action && normal.cards === 1 && normal.action === action && normal.inputs === 0 && normal.next === 1 && (action === "stop" ? normal.again === 0 : normal.again === 1) && (action === "smaller" ? normal.shorter === 1 : normal.shorter === 0), { normal, decision: afterNormal.decision, lessonBefore, lessonNow: afterNormal.lesson.id });
      await shot(p, `decision-${action}-normal`);
      if (action === "advance") {
        check("decisions: advance — the card names the next lesson and the input is not opened until the child chooses", /nächste Lektion \(d und k\)/.test(await tid("decision").innerText()) && afterNormal.lesson.id === "TYPE-CH-COURSE-2", await tid("decision").innerText());
        await tid("another-burst").click();
        await tid("course-input").waitFor();
        check("decisions: advance — 'Nächste Lektion starten' opens lesson 2's full lines", /Lektion 2 von 5/.test(await body()) && /\(1\/2\)/.test(await body()));
      }
      // ---- reload after the normal ACK
      await p.reload();
      await p.getByRole("heading", { name: /Tippen/ }).waitFor();
      const reload1 = await card();
      check(`decisions: ${action} — reload restores the durable decision`, reload1.cards === 1 && reload1.action === action && reload1.inputs === 0, reload1);
      // ---- post-commit lost ACK, then "Nochmal speichern" (the verifier's technique: fetch the real response, then abort)
      await restore();
      if (action === "smaller") await burstApi("hard");
      if (action === "advance") await burstApi("ok");
      if (action === "stop") for (let i = 0; i < 9; i += 1) await burstApi("ok");
      await openCourse();
      if (await tid("another-burst").count()) await tid("another-burst").click();
      await tid("course-input").waitFor();
      let dropped = false;
      let droppedStatus = null;
      const handler = async (route) => {
        if (route.request().method() === "PUT" && route.request().postDataJSON()?.op?.op === "typing-burst" && !dropped) {
          dropped = true;
          const real = await route.fetch();
          droppedStatus = (await real.json()).status;
          await route.abort("failed");
          return;
        }
        await route.continue();
      };
      await p.route("**/api/family/learning/mission", handler);
      await burstUI(action === "smaller" ? "hard" : "ok");
      await p.getByRole("button", { name: "Nochmal speichern", exact: true }).waitFor();
      const committed = (await view()).typingCourse;
      await p.getByRole("button", { name: "Nochmal speichern", exact: true }).click();
      await tid("decision-card").waitFor();
      const retryUI = await card();
      const afterRetry = (await view()).typingCourse;
      check(`decisions: ${action} — post-commit lost ACK + retry restores the decision without a duplicate burst`, dropped && droppedStatus === "applied" && committed.decision.action === action && afterRetry.burstsThisVisit.length === committed.burstsThisVisit.length && retryUI.cards === 1 && retryUI.action === action && retryUI.inputs === 0 && retryUI.next === 1, { droppedStatus, counts: [committed.burstsThisVisit.length, afterRetry.burstsThisVisit.length], retryUI });
      await shot(p, `decision-${action}-lost-ack-retry`);
      await p.unroute("**/api/family/learning/mission", handler);
      await p.reload();
      await p.getByRole("heading", { name: /Tippen/ }).waitFor();
      const reload2 = await card();
      check(`decisions: ${action} — reload after the lost ACK keeps the decision`, reload2.cards === 1 && reload2.action === action && reload2.inputs === 0, reload2);
    }
    // ---- declined theme: the later Spanish reuse step must not demand the turtle request (R2-4)
    await restore();
    await op({ op: "typing-course-continue" });
    await op({ op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" });
    await op({ op: "skip-stage", stage: "explain", reason: "child" });
    for (const o of [
      { op: "language-step", segmentId: "LANG-ES-STATION", stepId: "listen", response: "", modality: "listen" },
      { op: "language-step", segmentId: "LANG-ES-STATION", stepId: "pick", response: "lámpara", modality: "word-choice" },
      { op: "language-step", segmentId: "LANG-ES-STATION", stepId: "produce", response: "Necesitamos una lámpara.", modality: "typed" },
    ]) await op(o);
    await openMission();
    await p.getByText("4/4").waitFor();
    const reuseText = await body();
    const reuseWords = reuseText.replace(/\s+/g, " ");
    check("declined theme (none): the rendered reuse request names the station, not turtles", /Necesitamos agua para la estación/.test(reuseWords) && !/tortugas/.test(reuseWords), reuseWords.match(/Es de noche[^.]*\.[^.]*\./)?.[0]);
    await shot(p, "declined-theme-reuse");
    await p.getByRole("button", { name: /Wasser/ }).click();
    await tid("station-spot-beach").waitFor();
    const reuseRec = (await evidence()).state.language["LANG-ES-STATION"].records.at(-1);
    check("declined theme: the record keeps the variant actually shown", reuseRec?.variant === "none" && reuseRec?.correct === true, reuseRec);
  }

  if (MODE === "due") {
    const v0 = await view();
    check("backdated fixture (records 10 days old, server clock untouched): the delayed check is offered before chapter 4", v0.next.visit === "v3" && v0.delayedCheck?.status === "open", { next: v0.next, delayedCheck: v0.delayedCheck });
    await p.goto(BASE + "/family/learn?child=santiago");
    await p.getByRole("link", { name: "Kurzer Check" }).waitFor();
    await shot(p, "cockpit-due");
    await openMission();
    await tid("start-visit").waitFor();
    check("start screen names the short check and explains it is a task from earlier", /Kurzer Check von früher/.test(await tid("start-visit").innerText()) && /früher/.test(await tid("delayed-check-text").innerText()), await tid("delayed-check-text").innerText());
    await shot(p, "due-start");
    await tid("start-visit").click();
    await click("Weiter");
    await p.getByLabel("Antwort", { exact: true }).waitFor();
    check("EQ-DELAY is shown with its own items (Proben / Kisten)", /Proben/.test(await body()) && /Kisten/.test(await body()));
    await p.getByLabel("Antwort", { exact: true }).fill("8");
    await click("Fertig");
    await p.getByRole("heading", { name: "Deine Expeditionsseite" }).waitFor();
    await p.locator("textarea").fill("Proben verpackt.");
    await click("Seite speichern");
    await tid("difficulty-right").click();
    await tid("reflect-submit").click();
    await tid("start-visit").waitFor().catch(() => {});
    const v3 = await view();
    const v3fb = (await evidence()).state.visits.find((v) => v.id === "v3")?.feedback;
    check("delayed check: optional feedback left open is recorded as unanswered (not skipped, never an answer)", v3.visits === undefined && v3fb?.unanswered?.length === 2 && v3fb?.skipped?.length === 0 && v3fb?.answers?.difficulty === "right", v3fb);
    check("delayed check finished with the true elapsed interval recorded; chapter 4 offered next", v3.next.visit === "v4" && v3.delayedCheck?.status === "done", { next: v3.next, dc: v3.delayedCheck });
    const ev = await evidence();
    const delay = ev.attempts.find((a) => a.taskId === "EQ-DELAY");
    check("EQ-DELAY attempt carries seconds since teaching anchor ≥ 6 days (real difference of stored timestamps)", delay && delay.secondsSinceTeaching >= 6 * 86400, { secondsSinceTeaching: delay?.secondsSinceTeaching });
    await pp.goto(BASE + "/family/learn/parent");
    await pp.getByRole("tab", { name: "Mathe" }).click();
    await tid("delayed-check-parent", pp).waitFor().catch(() => {});
    await shot(pp, "parent-math-due");
    await p.goto(BASE + "/family/learn?child=santiago");
    await p.getByRole("link", { name: "Neues Kapitel" }).waitFor();
    check("after the delayed check the cockpit offers the new chapter", true);
    await shot(p, "cockpit-after-due");
  }
} catch (error) {
  check("journey completed without an unexpected exception", false, String(error && error.stack ? error.stack.split("\n").slice(0, 4).join(" | ") : error));
  try {
    await shot(p, "exception");
  } catch {
    /* page gone */
  }
  await shot(p, "failure-desktop").catch(() => {});
  await shot(pp, "failure-parent").catch(() => {});
}
check("no uncaught page errors on any surface", pageErrors.length === 0, pageErrors);
await browser.close();
const passed = results.filter((r) => r.ok).length;
fs.writeFileSync(path.join(OUT, `${MODE}-results.json`), JSON.stringify({ mode: MODE, base: BASE, passed, total: results.length, results }, null, 2));
console.log(`${passed}/${results.length} checks passed (${MODE})`);
process.exit(passed === results.length ? 0 : 1);
