// Real-browser + HTTP checks for the September 30 follow-on against a LOCAL
// production server (synthetic AUTH_SECRET, isolated NABU_DB_DIR). Headless
// Chromium, project audio guard, muted. Session cookies are Auth.js JWEs
// minted locally. No real .env, data, OAuth or external service.
//
//   node scripts/verify-learning-followon.mjs --seed --dir /tmp/<fresh> [--backdate-days 10]
//       seeds a production-shaped fixture (v1+v2 done under v1 content with language records,
//       no completion rows, records without visit ids) into <fresh>/nabu.db
//   AUTH_SECRET=<same as server> node scripts/verify-learning-followon.mjs --base http://127.0.0.1:3151 --out /tmp/<dir> --db /tmp/<fresh>/nabu.db

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const require = createRequire(import.meta.url);
const { createClient } = require("@libsql/client");

if (args.includes("--seed")) {
  const dir = opt("--dir", null);
  if (!dir) throw new Error("--dir required");
  const backdateDays = Number(opt("--backdate-days", "0"));
  fs.mkdirSync(dir, { recursive: true });
  const { asLearningContent } = await import("../src/lib/family-learning-content.ts");
  const { applyMutation, ensureLearningTables, readChildView } = await import("../src/lib/family-learning-db.ts");
  const v1 = asLearningContent(JSON.parse(fs.readFileSync(new URL("../src/data/family-learning/content/santiago-expedition-v1.json", import.meta.url), "utf8")));
  const client = createClient({ url: `file:${path.join(dir, "nabu.db")}` });
  await ensureLearningTables(client);
  let t = Date.now() - backdateDays * 86400000 - 3 * 3600000;
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
  const row = (await client.execute("SELECT state_json FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0];
  const state = JSON.parse(String(row.state_json));
  // Like the live rows: no visit ids, and the picks classified under the pre-retirement rule (state AND attempts table).
  for (const seg of Object.values(state.language)) for (const r of seg.records) { delete r.visit; if (r.evidence === "recognition") r.support = ["word-choice"]; }
  await client.execute({ sql: "UPDATE family_learning_missions SET state_json = ? WHERE child_id = 'santiago'", args: [JSON.stringify(state)] });
  await client.execute("UPDATE family_learning_attempts SET support_json = '[\"word-choice\"]', evidence = 'supported' WHERE child_id = 'santiago' AND objective LIKE '%-recognition'");
  console.log(JSON.stringify({ seeded: dir, backdateDays, legacyPicks: true, visits: state.visits.map((v) => ({ id: v.id, finishedAt: v.finishedAt })) }));
  client.close();
  process.exit(0);
}

const { encode } = await import("@auth/core/jwt");
const { chromium } = await import("/Users/claweberle/.npm-global/lib/node_modules/playwright/index.mjs");
const { audioSafeChromiumLaunchOptions, installBrowserAudioGuard } = await import("./lib/browser-audio-guard.mjs");

const BASE = opt("--base", "http://127.0.0.1:3151").replace(/\/$/, "");
const OUT = opt("--out", "/tmp/family-learning-followon");
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
  console.log(ok ? "PASS" : "FAIL", name, detail === undefined ? "" : JSON.stringify(detail).slice(0, 300));
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
const TZ = "Europe/Zurich";
const view = async (tz = TZ) => (await api("GET", `/api/family/learning/mission${tz ? `?tz=${encodeURIComponent(tz)}` : ""}`, null, assistant, bearer)).json.view;
let opN = 0;
const contextOf = (v) => ({ erasureGeneration: v.erasureGeneration, visit: v.visit ? { id: v.visit.id, startedAt: v.visit.startedAt } : null });
async function op(o, key = `fo-${(opN += 1)}`) {
  const v = await view();
  const r = await api("PUT", "/api/family/learning/mission", { op: o, expectedRevision: v.revision, idempotencyKey: key, context: contextOf(v), tz: TZ }, assistant, bearer);
  if (r.status !== 200 || (r.json.status !== "applied" && r.json.status !== "replayed")) throw new Error(`op ${o.op}: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  return r.json;
}
const evidence = async () => (await api("GET", "/api/family/learning/parent/evidence?child=santiago", null, owner)).json;

// ---------------------------------------------------------------------------
// 1. API — old state read by the candidate
// ---------------------------------------------------------------------------
const v0 = await view();
check("API: two-visit row → next is v4 shown as Visit 3, no date, delayed check retired", v0.next.visit === "v4" && v0.next.ordinal === 3 && v0.next.availableAt === null && v0.delayedCheck?.status === "retired" && v0.delayedCheck.childText === "", v0.next);
check("API: nextStep names Besuch 3 and never a returning task", /Besuch 3/.test(v0.nextStep) && !/von früher|kommt am/.test(v0.nextStep), v0.nextStep);
check("API: progress strip counts the two completed events (total 2), next = start Besuch 3, counting rule present", v0.progress.completedTotal === 2 && v0.progress.next.kind === "start" && v0.progress.next.label === "Besuch 3 — Die Beobachtungsstation" && /fertige Besuche/.test(v0.progress.counting), { week: v0.progress.completedThisWeek, total: v0.progress.completedTotal });
check("API: without completion rows the success claim is suppressed (review-missing) and the artifact is shown", v0.progress.recent?.did === null && v0.progress.recent?.grounding.suppressed?.reason === "review-missing" && v0.progress.recent.artifact.text === "Der Garten ist fertig.", v0.progress.recent?.grounding);
check("API: vocabulary cue lists met words only (no lámpara preview), ≤ 3, no digits", v0.vocabulary && v0.vocabulary.words.length > 0 && v0.vocabulary.words.length <= 3 && !v0.vocabulary.words.some((w) => w.entryId === "ES-LAMPARA") && !/\d/.test(v0.vocabulary.words.map((w) => w.try).join(" ")), v0.vocabulary?.words.map((w) => w.entryId));
check("API: no grade-like field in the strip or cue", !/percent|score|rank|grade|isabel/i.test(JSON.stringify({ p: v0.progress, v: v0.vocabulary })));
const vNy = await view("America/New_York");
check("API: the week follows the sent zone (tz honoured, echoed)", vNy.progress.timeZone === "America/New_York" && v0.progress.timeZone === TZ);
const vBad = await view("Mars/Olympus");
check("API: an invalid zone falls back to Europe/Zurich", vBad.progress.timeZone === TZ);
const vAgain = await view();
check("API: reload yields the identical strip and cue (deterministic derivation)", JSON.stringify(vAgain.progress) === JSON.stringify(v0.progress) && JSON.stringify(vAgain.vocabulary) === JSON.stringify(v0.vocabulary));
let stateBefore = null;
if (DB) {
  const c = createClient({ url: "file:" + DB });
  stateBefore = String((await c.execute("SELECT state_json FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0].state_json);
  c.close();
}

// Parent evidence read → historical reviews backfilled → strip now grounded.
const e0 = await evidence();
check("parent API: historical reviews created for v1/v2; vocabulary ledger has 8 observations from the historical records; visits labelled (v4 = Besuch 3, v3 retired)", e0.completions.length === 2 && e0.vocabulary?.observations.length === 8 && e0.visits.find((v) => v.id === "v4")?.label === "Besuch 3 — Die Beobachtungsstation" && e0.visits.find((v) => v.id === "v3")?.retired === true, e0.visits);
check("parent API: delayed check reported as retired with the retirement date, no opening date", e0.delayedCheck?.status === "retired" && /30\. September 2026/.test(e0.delayedCheck.parentText) && !/öffnet am/.test(e0.delayedCheck.parentText));
check("parent API: EN-WATER recall/writing 'independent' (single hit), recognition 'supported-only' (legacy pick row), never 'repeated'; ES-LAMPARA not observed", (() => {
  const w = e0.vocabulary.entries.find((e) => e.entryId === "EN-WATER");
  const l = e0.vocabulary.entries.find((e) => e.entryId === "ES-LAMPARA");
  return w.dimensions.recall.status === "independent" && w.dimensions.recognition.status === "supported-only" && w.dimensions.writing.status === "independent" && l.dimensions.recognition.status === "not-observed" && !JSON.stringify(e0.vocabulary.entries).includes("independent-repeated");
})());
check("coherence: every recognition/recall observation carries exactly the support list and independence of its attempt row (legacy rows included)", e0.vocabulary.observations.filter((o) => o.attemptRef).every((o) => {
  const a = e0.attempts.find((x) => x.taskId === o.attemptRef.taskId && x.attemptNo === o.attemptRef.attemptNo);
  return a && JSON.stringify(a.support) === JSON.stringify(o.support) && o.independent === (a.evidence === "independent" && o.outcome === "correct" && (o.dimension !== "writing" || true));
}));
const v1g = await view();
check("API: after the parent read the strip quotes the stored (historical) review — 'You did' present", v1g.progress.recent?.grounding.source === "review-historical" && typeof v1g.progress.recent.did === "string" && /Setzlinge/.test(v1g.progress.recent.did), v1g.progress.recent?.did);
if (DB) {
  const c = createClient({ url: "file:" + DB });
  const after = String((await c.execute("SELECT state_json FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0].state_json);
  c.close();
  check("DB: the mission row is byte-identical after every read (child + parent)", after === stateBefore);
}

// ---------------------------------------------------------------------------
// 2. Browser — child cockpit and mission workspace
// ---------------------------------------------------------------------------
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
const desktop = await makeContext({ viewport: { width: 1280, height: 900 }, timezoneId: TZ, locale: "de-CH" });
await desktop.addCookies([{ name: COOKIE, value: assistant, url: BASE }]);
const page = await desktop.newPage();
const seenTz = [];
page.on("request", (r) => {
  const u = new URL(r.url());
  if (u.pathname === "/api/family/learning/mission" && u.searchParams.get("tz")) seenTz.push(u.searchParams.get("tz"));
});
await page.goto(`${BASE}/family/learn?child=santiago`, { waitUntil: "networkidle" });
await page.getByTestId("progress-strip").waitFor({ timeout: 20000 });
check("cockpit: the browser sends its IANA zone with the read", seenTz.includes(TZ), seenTz);
const stripText = await page.getByTestId("progress-strip").innerText();
check(`cockpit: strip shows ${v0.progress.completedThisWeek} completed this week (as the API says for this fixture) / 2 total, the week label and the counting rule`, new RegExp(`Diese Woche fertig: ${v0.progress.completedThisWeek}`).test(stripText) && /Insgesamt fertig: 2/.test(stripText) && /Montag, .* bis Sonntag/.test(stripText) && /fertige Besuche/.test(stripText), stripText.slice(0, 200));
check("cockpit: next action names Besuch 3 — Die Beobachtungsstation", /Als Nächstes: Start: Besuch 3 — Die Beobachtungsstation/.test(stripText));
check("cockpit: grounded 'Das hast du gemacht' + 'Probier als Nächstes' from the stored review", (await page.getByTestId("progress-recent").getAttribute("data-grounding")) === "review-historical" && (await page.getByTestId("progress-did").count()) === 1 && (await page.getByTestId("progress-try-next").count()) === 1);
check("cockpit: no delayed-check note, no 'von früher', no 'kommt am' anywhere", (await page.getByTestId("delayed-check-note").count()) === 0 && !/von früher|kommt am/.test(await page.locator("body").innerText()));
check("cockpit: start button reads 'Besuch 3 starten'", /Besuch 3 starten/.test(await page.getByTestId("cockpit-start").innerText()));
check("cockpit: vocabulary cue rendered with met words", (await page.getByTestId("vocabulary-cue").count()) === 1 && (await page.locator('[data-testid^="vocab-word-"]').count()) > 0);
await page.getByTestId("progress-visit-v1").click();
await page.waitForTimeout(300);
check("cockpit: a completed-visit chip opens the underlying page (anchor #pages-v1 exists and is targeted)", (await page.evaluate(() => location.hash)) === "#pages-v1" && (await page.locator("#pages-v1").count()) === 1);
await page.screenshot({ path: path.join(OUT, "cockpit-desktop.png"), fullPage: true });
const tablet = await makeContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, timezoneId: TZ, locale: "de-CH" });
await tablet.addCookies([{ name: COOKIE, value: assistant, url: BASE }]);
const tpage = await tablet.newPage();
await tpage.goto(`${BASE}/family/learn?child=santiago`, { waitUntil: "networkidle" });
await tpage.getByTestId("progress-strip").waitFor({ timeout: 20000 });
await tpage.screenshot({ path: path.join(OUT, "cockpit-tablet.png"), fullPage: true });
check("cockpit (tablet): strip and cue render", (await tpage.getByTestId("vocabulary-cue").count()) === 1);
await tablet.close();

// Mission workspace: start screen and header.
await page.goto(`${BASE}/family/learn/mission?child=santiago`, { waitUntil: "networkidle" });
await page.getByTestId("start-visit").waitFor({ timeout: 20000 });
check("mission: start button says 'Besuch 3 starten' with data-visit v4 / ordinal 3; no delayed-check text", /Besuch 3 starten/.test(await page.getByTestId("start-visit").innerText()) && (await page.getByTestId("start-visit").getAttribute("data-visit")) === "v4" && (await page.getByTestId("start-visit").getAttribute("data-ordinal")) === "3" && (await page.getByTestId("delayed-check-text").count()) === 0);
await page.getByTestId("start-visit").click();
await page.waitForTimeout(1500);
const header = await page.locator("header").filter({ hasText: "Stopp" }).first().innerText();
check("mission: after starting, the workspace header shows 'Besuch 3 — Die Beobachtungsstation' (internal v4)", /Besuch 3 — Die Beobachtungsstation/.test(header) && (await view()).visit?.id === "v4", header.replace(/\n/g, " | "));
await page.screenshot({ path: path.join(OUT, "mission-visit3-started.png"), fullPage: true });
await page.getByRole("link", { name: /Stopp/ }).click();
await page.waitForTimeout(800);
await page.getByTestId("progress-strip").waitFor({ timeout: 20000 });
const runningText = await page.getByTestId("progress-strip").innerText();
check("cockpit: a running visit is 'Weiter mit Besuch 3 — …' and does NOT count as completed (still 2)", /Weiter mit Besuch 3 — Die Beobachtungsstation/.test(runningText) && /Insgesamt fertig: 2/.test(runningText));

// Finish the chapter through the API (Spanish station segment with the lamp), then check the parent cockpit.
for (const o of [
  { op: "resume-base" }, { op: "choose-station", theme: "turtles" }, { op: "skip-stage", stage: "typing-course", reason: "child" },
  { op: "answer-remainder", itemId: "EQ-STATION", used: 30, remaining: 2, raw: "30, 2", modality: "typed" }, { op: "skip-stage", stage: "explain", reason: "child" },
  { op: "language-step", segmentId: "LANG-ES-STATION", stepId: "listen", response: "", modality: "listen" },
  { op: "language-step", segmentId: "LANG-ES-STATION", stepId: "pick", response: "lámpara", modality: "word-choice" },
  { op: "language-step", segmentId: "LANG-ES-STATION", stepId: "produce", response: "necesitamos una lampara", modality: "typed" },
  { op: "language-step", segmentId: "LANG-ES-STATION", stepId: "reuse", response: "agua", modality: "word-choice" },
  { op: "build-station", spot: "rocks" }, { op: "save-log", text: "Die Station steht." }, { op: "skip-stage", stage: "log-revise", reason: "child" }, { op: "skip-stage", stage: "log-transfer", reason: "child" }, { op: "summary-seen" },
]) await op(o);
const finishKey = "fo-finish";
const fin = await op({ op: "reflect", optionId: "right", feedback: { enjoyment: "yes", clarity: "clear" } }, finishKey);
check("API: finishing Visit 3 → total 3, this week +1, next 'all-visits-done', recent grounded in the just-written review", fin.view.progress.completedTotal === 3 && fin.view.progress.next.reason === "all-visits-done" && fin.view.progress.recent?.visit === "v4" && fin.view.progress.recent.grounding.source === "review" && fin.view.progress.recent.label === "Besuch 3 — Die Beobachtungsstation", fin.view.progress.recent?.grounding);
const replay = await api("PUT", "/api/family/learning/mission", { op: { op: "reflect", optionId: "right" }, expectedRevision: fin.view.revision - 1, idempotencyKey: finishKey, context: { erasureGeneration: fin.view.erasureGeneration, visit: null }, tz: TZ }, assistant, bearer);
check("API: lost-ACK retry of the finish replays (same key) with the same counts, nothing doubled", replay.status === 200 && replay.json.status === "replayed" && replay.json.view.progress.completedTotal === 3);
await page.goto(`${BASE}/family/learn?child=santiago`, { waitUntil: "networkidle" });
await page.getByTestId("progress-strip").waitFor({ timeout: 20000 });
const doneText = await page.getByTestId("progress-strip").innerText();
check("cockpit: after the chapter — 3 total, chip 'Besuch 3 — Die Beobachtungsstation', 'Alle Besuche sind geschafft'", /Insgesamt fertig: 3/.test(doneText) && (await page.getByTestId("progress-visit-v4").innerText()).includes("Besuch 3 — Die Beobachtungsstation") && /Alle Besuche sind geschafft/.test(doneText));
await page.screenshot({ path: path.join(OUT, "cockpit-after-visit3.png"), fullPage: true });

// ---------------------------------------------------------------------------
// 3. Parent cockpit (owner) — labels, retired check, vocabulary
// ---------------------------------------------------------------------------
const parentCtx = await makeContext({ viewport: { width: 1280, height: 1000 }, locale: "de-CH" });
await parentCtx.addCookies([{ name: COOKIE, value: owner, url: BASE }]);
const ppage = await parentCtx.newPage();
await ppage.goto(`${BASE}/family/learn/parent`, { waitUntil: "networkidle" });
await ppage.getByTestId("parent-next-step").waitFor({ timeout: 20000 });
const nextStep = await ppage.getByTestId("parent-next-step").innerText();
check("parent: next step says all visits 1–3 are done; no pending delayed check", /Besuche 1–3/.test(nextStep) && !/an seinem Datum|nie vorgezogen/.test(nextStep), nextStep);
check("parent: retired delayed-check panel (status retired, retirement date)", (await ppage.getByTestId("delayed-check-parent").getAttribute("data-status")) === "retired" && /30\. September 2026/.test(await ppage.getByTestId("delayed-check-parent").innerText()));
const mathText = await ppage.locator("body").innerText();
check("parent (math tab): attempts are labelled 'Besuch 3 — Die Beobachtungsstation (v4)'", /Besuch 3 — Die Beobachtungsstation \(v4\)/.test(mathText) || (await (async () => { await ppage.getByRole("button", { name: /EQ-STATION|Beete|Rest/ }).first().click().catch(() => {}); return /Besuch 3 — Die Beobachtungsstation \(v4\)/.test(await ppage.locator("body").innerText()); })()));
await ppage.getByRole("tab", { name: "Spanisch" }).click();
await ppage.getByTestId("vocabulary-es").waitFor({ timeout: 20000 });
check("parent (Spanisch): vocabulary ledger rendered; agua recognition 'selbständig (einzeln)' (new station pick independent, legacy pick supported); lámpara writing 'üben' (accent-less spelling → review), recall 'selbständig (einzeln)'", (await ppage.getByTestId("vocab-dim-ES-AGUA-recognition").getAttribute("data-status")) === "independent" && (await ppage.getByTestId("vocab-dim-ES-LAMPARA-writing").getAttribute("data-status")) === "practice" && (await ppage.getByTestId("vocab-dim-ES-LAMPARA-recall").getAttribute("data-status")) === "independent");
const eFin = await evidence();
check("coherence after the chapter: the new station pick is independent in BOTH the raw attempt row and the ledger; the legacy v2 pick is supported in both", (() => {
  const a = eFin.attempts.find((x) => x.taskId === "LANG-ES-STATION/pick");
  const o = eFin.vocabulary.observations.find((x) => x.id === "ES-LAMPARA/LANG-ES-STATION/pick/1/recognition");
  const la = eFin.attempts.find((x) => x.taskId === "LANG-ES-AGUA/pick");
  const lo = eFin.vocabulary.observations.find((x) => x.id === "ES-AGUA/LANG-ES-AGUA/pick/1/recognition");
  return a?.evidence === "independent" && o?.independent === true && la?.evidence === "supported" && lo?.independent === false && JSON.stringify(lo.support) === JSON.stringify(la.support);
})());
check("parent (Spanisch): the raw 'Erkennen' table and the ledger show the same classification for the same pick (both 'selbständig' for the station pick)", /LANG-ES-STATION\/pick[\s\S]{0,120}selbständig/.test(await ppage.locator("body").innerText()));
check("parent (Spanisch): missingness lines and the pilot-parameter policy note are visible; no status claims mastery (the notes only deny it)", (await ppage.locator('[data-testid^="vocab-missing-"]').count()) > 0 && /Pilot-Parameter/.test(await ppage.getByTestId("vocabulary-es").innerText()) && /keine Beherrschung/.test(await ppage.getByTestId("vocabulary-es").innerText()) && !/beherrscht\b/i.test(await ppage.getByTestId("vocabulary-es").innerText()));
await ppage.getByRole("button", { name: /Beobachtungen zeigen/ }).first().click();
await ppage.locator('[data-testid="vocab-observation"]').first().waitFor({ timeout: 10000 });
const obsText = await ppage.locator('[data-testid^="vocab-observations-"]').first().innerText();
check("parent (Spanisch): an observation row shows task/step/version, context, visit label, modality, stimulus and response", /Aufgabe LANG-ES-/.test(obsText) && /Kontext ES-/.test(obsText) && /Besuch \d/.test(obsText) && /Reiz: „/.test(obsText) && /Antwort: „/.test(obsText), obsText.slice(0, 240));
await ppage.screenshot({ path: path.join(OUT, "parent-spanish-vocabulary.png"), fullPage: true });
await ppage.getByRole("tab", { name: "Englisch" }).click();
await ppage.getByTestId("vocabulary-en").waitFor({ timeout: 20000 });
check("parent (Englisch): water recall 'selbständig (einzeln)', recognition 'nur mit Hilfe' (legacy row, matching the raw table), need/garden 'keine Aufgabe dafür'", (await ppage.getByTestId("vocab-dim-EN-WATER-recall").getAttribute("data-status")) === "independent" && (await ppage.getByTestId("vocab-dim-EN-WATER-recognition").getAttribute("data-status")) === "supported-only" && (await ppage.getByTestId("vocab-dim-EN-NEED-recall").getAttribute("data-status")) === "no-opportunity");
await ppage.getByRole("tab", { name: "Rückblick" }).click();
await ppage.getByTestId("review-v4").waitFor({ timeout: 20000 });
check("parent (Rückblick): the chapter's review card is titled 'Besuch 3 — Die Beobachtungsstation' and states the internal id v4; v1/v2 keep their numbers", /Besuch 3 — Die Beobachtungsstation/.test(await ppage.getByTestId("review-v4").innerText()) && /intern v4/.test(await ppage.getByTestId("review-v4").innerText()) && /Besuch 2 — /.test(await ppage.getByTestId("review-v2").innerText()));
await ppage.screenshot({ path: path.join(OUT, "parent-review-visit3.png"), fullPage: true });
if (DB) {
  const c = createClient({ url: "file:" + DB });
  const reviews = (await c.execute("SELECT visit_id, review_json FROM family_learning_completions WHERE child_id = 'santiago'")).rows;
  c.close();
  const v4 = reviews.find((r) => r.visit_id === "v4");
  check("DB: the stored v4 review carries the derived label; historical v1/v2 review rows were not rewritten for labels (their childSummary titles are the content titles)", JSON.parse(String(v4.review_json)).learning.childSummary.title === "Besuch 3 — Die Beobachtungsstation" && reviews.filter((r) => r.visit_id !== "v4").every((r) => /^Besuch [12] — /.test(JSON.parse(String(r.review_json)).learning.childSummary.title)));
}

// ---------------------------------------------------------------------------
// 4. Roles and isolation
// ---------------------------------------------------------------------------
check("roles: assistant session cannot read parent evidence (403)", (await api("GET", "/api/family/learning/parent/evidence?child=santiago", null, assistant)).status === 403);
check("roles: a stranger session cannot read parent evidence (403)", (await api("GET", "/api/family/learning/parent/evidence?child=santiago", null, stranger)).status === 403);
check("roles: no session → 401 on the child mission API", (await api("GET", "/api/family/learning/mission", null, null, bearer)).status === 401);
const isabelBearer = (await api("POST", "/api/family/learning/session", { childId: "isabel" })).json?.token;
const isabel = await api("GET", "/api/family/learning/mission?tz=Europe/Zurich", null, assistant, isabelBearer);
check("isolation: Isabel's credential gets the honest unprepared answer, never Santiago's strip or words", isabel.status === 200 && isabel.json.prepared === false && isabel.json.view === null);
const parentHtml = await (await fetch(`${BASE}/family/learn/parent`, { headers: { cookie: `${COOKIE}=${assistant}` }, redirect: "manual" })).status;
check("roles: the parent page refuses the assistant session (302/403)", parentHtml === 302 || parentHtml === 403, parentHtml);

// ---------------------------------------------------------------------------
// 5. Deletion — derived data goes with the sources
// ---------------------------------------------------------------------------
const del = await api("DELETE", "/api/family/learning/parent/records?child=santiago&confirm=santiago", null, owner);
check("deletion: accepted with counts (3 completions removed)", del.status === 200 && del.json.counts.family_learning_completions === 3, del.json?.counts);
const eAfter = await evidence();
check("deletion: parent evidence has no state, no completions, no vocabulary observations", eAfter.state === null && eAfter.completions.length === 0 && eAfter.vocabulary.observations.length === 0);
const vAfter = await view();
check("deletion: child strip is empty (0 total, next = start v1), no words, new erasure generation", vAfter.progress.completedTotal === 0 && vAfter.progress.recent === null && vAfter.progress.next.visit === "v1" && vAfter.vocabulary.words.length === 0 && vAfter.erasureGeneration === 1);
await page.goto(`${BASE}/family/learn?child=santiago`, { waitUntil: "networkidle" });
await page.getByTestId("progress-strip").waitFor({ timeout: 20000 });
check("cockpit after deletion: 0 / 0, no vocabulary cue, no completed chips", /Insgesamt fertig: 0/.test(await page.getByTestId("progress-strip").innerText()) && (await page.getByTestId("vocabulary-cue").count()) === 0 && (await page.locator('[data-testid^="progress-visit-"]').count()) === 0);
await page.screenshot({ path: path.join(OUT, "cockpit-after-deletion.png"), fullPage: true });

await browser.close();
const passed = results.filter((r) => r.ok).length;
fs.writeFileSync(path.join(OUT, "followon-results.json"), JSON.stringify({ base: BASE, passed, total: results.length, results }, null, 2));
console.log(`${passed}/${results.length} follow-on checks passed; evidence in ${OUT}`);
process.exit(passed === results.length ? 0 : 1);
