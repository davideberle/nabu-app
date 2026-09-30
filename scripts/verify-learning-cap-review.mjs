// Round-5 R5-4: cap-first truthfulness of an ARCHIVED chapter-4 review.
//
// Seeds a fresh isolated file database with the exact archived round-2 tables
// (every table, byte-for-byte rows), starts the PRODUCTION build capped
// (FAMILY_LEARNING_CONTENT_CAP=1) BEFORE any uncapped evidence read, and checks
// through the real parent tabs and the evidence API that the disproven credit
// (WRITE-TRANSFER-1 "Hallo" as correct/independent) is never presented as
// current evidence, that the chapter-4 rows stay byte-identical across repeated
// reads and a fresh server process, and that removing the cap re-derives the
// review (unscored, earlier derivation disclosed) and resumes the child state.
// Controls: a current-rules stored review under the cap keeps its credit
// (projected UX summary), and erase→read under the cap resurrects nothing.
//
//   AUTH_SECRET=<32+> node scripts/verify-learning-cap-review.mjs \
//     --archived <archived-r2-all-tables.json> --dir /tmp/<fresh> --port 3140 --out /tmp/<fresh>/shots
//
// Spawns its own `next start` processes on --port (capped, capped again, uncapped) and stops them.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(app, "package.json"));
const { createClient } = require("@libsql/client");
const { encode } = await import(path.join(app, "node_modules/@auth/core/jwt.js"));
const { chromium } = await import("/Users/claweberle/.npm-global/lib/node_modules/playwright/index.mjs");
const { audioSafeChromiumLaunchOptions, installBrowserAudioGuard } = await import(path.join(app, "scripts/lib/browser-audio-guard.mjs"));
const db = await import(path.join(app, "src/lib/family-learning-db.ts"));
const { asLearningContent } = await import(path.join(app, "src/lib/family-learning-content.ts"));
const { LEARNING_RULES_VERSION, REVIEW_VERSION } = await import(path.join(app, "src/lib/family-learning-summary.ts"));

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const ARCHIVED = opt("--archived", null);
const DIR = opt("--dir", null);
const PORT = Number(opt("--port", "3140"));
const OUT = opt("--out", DIR ? path.join(DIR, "shots") : "/tmp/family-learning-cap-review");
const SECRET = process.env.AUTH_SECRET;
if (!ARCHIVED || !DIR || !SECRET) {
  console.error("usage: AUTH_SECRET=<32+> node scripts/verify-learning-cap-review.mjs --archived <all-tables.json> --dir <fresh dir> [--port 3140] [--out <dir>]");
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(DIR, { recursive: true });
const BASE = `http://127.0.0.1:${PORT}`;
const COOKIE = "authjs.session-token";
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : " " + JSON.stringify(detail).slice(0, 400)}`);
};
const v1 = asLearningContent(JSON.parse(fs.readFileSync(path.join(app, "src/data/family-learning/content/santiago-expedition-v1.json"), "utf8")));
const v2 = asLearningContent(JSON.parse(fs.readFileSync(path.join(app, "src/data/family-learning/content/santiago-expedition-v2.json"), "utf8")));

// ---- seed: the archived tables, byte-for-byte
const archived = JSON.parse(fs.readFileSync(ARCHIVED, "utf8"));
const dbFile = path.join(DIR, "nabu.db");
for (const f of [dbFile, dbFile + "-wal", dbFile + "-shm"]) if (fs.existsSync(f)) fs.unlinkSync(f);
const seed = createClient({ url: `file:${dbFile}` });
await db.ensureLearningTables(seed);
const tables = Object.keys(archived);
for (const t of tables) for (const r of archived[t]) {
  const k = Object.keys(r);
  await seed.execute({ sql: `INSERT INTO family_learning_${t} (${k.join(",")}) VALUES (${k.map(() => "?").join(",")})`, args: k.map((x) => r[x]) });
}
const v4Rows = async (c) => JSON.stringify({
  completion: (await c.execute("SELECT * FROM family_learning_completions WHERE child_id = 'santiago' AND visit_id = 'v4'")).rows,
  mission: (await c.execute("SELECT * FROM family_learning_missions WHERE child_id = 'santiago'")).rows,
  attempts: (await c.execute("SELECT * FROM family_learning_attempts WHERE child_id = 'santiago' AND visit_id = 'v4'")).rows,
  samples: (await c.execute("SELECT * FROM family_learning_work_samples WHERE child_id = 'santiago' AND visit_id = 'v4'")).rows,
});
const before = await v4Rows(seed);
const archivedReview = JSON.parse(archived.completions.find((r) => r.visit_id === "v4").review_json);
check("archived fixture: v4 review has no rule version and credits WRITE-TRANSFER-1 as correct/independent; the state text is 'Hallo'", archivedReview.identity.reviewVersion === undefined && archivedReview.learning.objectives.some((o) => o.taskId === "WRITE-TRANSFER-1" && o.outcome === "correct" && o.evidence === "independent") && JSON.parse(archived.missions[0].state_json).transfers.at(-1).text === "Hallo");
seed.close();

// ---- servers
let server = null;
async function start(capped) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, AUTH_SECRET: SECRET, AUTH_URL: BASE, GOOGLE_CLIENT_ID: "synthetic", GOOGLE_CLIENT_SECRET: "synthetic", NABU_DB_DIR: DIR, NEXT_TELEMETRY_DISABLED: "1" };
  if (capped) env.FAMILY_LEARNING_CONTENT_CAP = "1";
  const log = fs.openSync(path.join(DIR, `server-${capped ? "capped" : "uncapped"}.log`), "a");
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT), "-H", "127.0.0.1"], { cwd: app, env, stdio: ["ignore", log, log] });
  for (let i = 0; i < 100; i += 1) {
    try {
      await fetch(BASE + "/");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error("server did not start");
}
async function stop() {
  if (!server) return;
  const done = new Promise((r) => server.once("exit", r));
  server.kill("SIGTERM");
  await done;
  server = null;
}
const owner = await encode({ token: { email: "info@davideberle.com", sub: "synthetic-owner", name: "owner" }, secret: SECRET, salt: COOKIE, maxAge: 3600 });
const assistant = await encode({ token: { email: "assistant@davideberle.com", sub: "synthetic-assistant", name: "assistant" }, secret: SECRET, salt: COOKIE, maxAge: 3600 });
const api = async (method, p, body, cookie, bearer) => {
  const headers = { cookie: `${COOKIE}=${cookie}` };
  if (body) headers["content-type"] = "application/json";
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json };
};
const evidence = async () => (await api("GET", "/api/family/learning/parent/evidence?child=santiago", null, owner)).json;

const browser = await chromium.launch(audioSafeChromiumLaunchOptions({ headless: true }));
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
await installBrowserAudioGuard(ctx);
await ctx.route("**/*", (r) => (new URL(r.request().url()).origin !== BASE || /\/api\/family\/(assistant\/|transcribe)/.test(r.request().url()) ? r.abort() : r.continue()));
await ctx.addCookies([{ name: COOKIE, value: owner, url: BASE }]);
const p = await ctx.newPage();
p.setDefaultTimeout(20000);
const shot = async (name) => {
  await p.screenshot({ path: path.join(OUT, `cap-review-${name}.png`), fullPage: true });
  fs.writeFileSync(path.join(OUT, `cap-review-${name}.txt`), await p.locator("body").innerText());
};
const readParent = async () => {
  await p.goto(BASE + "/family/learn/parent");
  await p.getByRole("tab", { name: "Rückblick" }).click();
  await p.getByTestId("review-v4").waitFor();
  const card = p.getByTestId("review-v4");
  const reviewText = await card.innerText();
  const obsolete = await card.locator("[data-testid='review-obsolete']").count();
  const derivation = await card.getAttribute("data-derivation");
  await p.getByRole("tab", { name: "Deutsch" }).click();
  await p.getByTestId("transfers").waitFor();
  const germanText = await p.getByTestId("transfers").innerText();
  return { reviewText, obsolete, derivation, germanText };
};

try {
  // ---- 1. cap-first: production build, capped, no uncapped read has happened
  await start(true);
  let ev = await evidence();
  let c4 = ev.completions.find((c) => c.visitId === "v4");
  check("capped API (cap-first): the archived v4 completion is served as an obsolete derivation with no review credit; raw facts retained", c4 && c4.derivation?.status === "obsolete" && c4.review === null && c4.derivation.storedVersion === 1 && c4.derivation.currentVersion === REVIEW_VERSION && c4.derivation.reason === "visit-not-served" && c4.derivation.retained?.childFeedback?.difficulty === "right", { derivation: c4?.derivation && { ...c4.derivation, retained: undefined } });
  check("capped API: 'independent' appears nowhere in the served v4 completion; completion identity and dates are the archived ones", c4 && !JSON.stringify(c4).includes('"independent"') && c4.completionId === archivedReview.identity.completionId && c4.finishedAt === archived.completions.find((r) => r.visit_id === "v4").finished_at, { id: c4?.completionId });
  check("capped API: the child state still shows the transfer text 'Hallo' as unassessable (read-time derivation), and the served content is version 1", ev.state?.transfers?.at(-1)?.text === "Hallo" && ev.state?.transfers?.at(-1)?.outcome === "unassessable" && ev.contentCounts?.version === 1, { outcome: ev.state?.transfers?.at(-1)?.outcome, version: ev.contentCounts?.version });
  let parent = await readParent();
  await p.getByRole("tab", { name: "Rückblick" }).click();
  await shot("capped-review");
  check("capped parent Rückblick: the v4 card is the explicit 'Auswertung nicht verfügbar' presentation — no WRITE-TRANSFER-1 credit, no 'independent', the reason stated, records declared unchanged", parent.derivation === "obsolete" && parent.obsolete === 1 && !/independent/.test(parent.reviewText) && !/WRITE-TRANSFER-1 v1/.test(parent.reviewText) && /Regelfassung 1/.test(parent.reviewText) && /unverändert erhalten/.test(parent.reviewText) && /Vom Kind gesagt/.test(parent.reviewText), { excerpt: parent.reviewText.slice(0, 300) });
  check("capped parent Deutsch: Hallo is 'nicht bewertet'", /Hallo/.test(parent.germanText) && /nicht bewertet/.test(parent.germanText));
  await p.getByRole("tab", { name: "Deutsch" }).click();
  await shot("capped-german");
  const c1 = createClient({ url: `file:${dbFile}` });
  check("capped: chapter-4 rows (completion, mission state, attempts, samples) are byte-identical after the reads", (await v4Rows(c1)) === before);
  c1.close();
  // repeated read + parent reload
  ev = await evidence();
  parent = await readParent();
  check("capped: a repeated read is stable (still obsolete, still no credit)", ev.completions.find((c) => c.visitId === "v4")?.derivation?.status === "obsolete" && parent.obsolete === 1 && !/independent/.test(parent.reviewText));
  // v1/v2 historical reviews under the cap are refreshed normally (the served content knows them)
  check("capped: the visits the served content knows (v1, v2) carry the current rule version; their credit is unchanged", ev.completions.filter((c) => c.visitId !== "v4").every((c) => c.review?.identity?.reviewVersion === REVIEW_VERSION && c.derivation?.status === "current") && ev.completions.find((c) => c.visitId === "v1")?.review?.learning?.objectives?.some((o) => o.taskId === "EQ-ENTRY" && o.evidence === "independent"), ev.completions.map((c) => [c.visitId, c.derivation?.status, c.review?.identity?.reviewVersion]));
  // capped child cockpit: readable, chapter parked or finished, nothing thrown
  const session = await api("POST", "/api/family/learning/session", { childId: "santiago" }, assistant);
  const bearer = session.json?.token;
  const mission = await api("GET", "/api/family/learning/mission", null, assistant, bearer);
  check("capped child mission API answers 200 (v4 finished in the archived state; nothing thrown)", mission.status === 200 && mission.json?.view?.contentVersion === 2, { status: mission.status, next: mission.json?.view?.next });
  // ---- 2. fresh server PROCESS, still capped
  await stop();
  await start(true);
  ev = await evidence();
  parent = await readParent();
  const c2 = createClient({ url: `file:${dbFile}` });
  check("capped, fresh server process: same obsolete presentation, rows still byte-identical", ev.completions.find((c) => c.visitId === "v4")?.derivation?.status === "obsolete" && parent.obsolete === 1 && !/independent/.test(parent.reviewText) && (await v4Rows(c2)) === before);
  c2.close();
  // ---- 3. control under the cap: a stored review at the current LEARNING rules (version 3) keeps its credit, UX projected, nothing written
  await stop();
  const c3 = createClient({ url: `file:${dbFile}` });
  const stored = JSON.parse(archived.completions.find((r) => r.visit_id === "v4").review_json);
  stored.identity.reviewVersion = LEARNING_RULES_VERSION;
  const obj = stored.learning.objectives.find((o) => o.taskId === "WRITE-TRANSFER-1");
  obj.outcome = "correct";
  obj.evidence = "supported";
  obj.support = ["revision-help"];
  stored.experience.telemetry = { supported: true, batches: 1, events: 3, foregroundActiveSeconds: 0, idleRuleSeconds: 60, hiddenIntervals: 0, saveFailures: 0, retries: 0, corrections: 0, hints: 0, pauses: 0, byStage: {} };
  await c3.execute({ sql: "UPDATE family_learning_completions SET review_json = ? WHERE child_id = 'santiago' AND visit_id = 'v4'", args: [JSON.stringify(stored)] });
  const controlRows = await v4Rows(c3);
  c3.close();
  await start(true);
  ev = await evidence();
  c4 = ev.completions.find((c) => c.visitId === "v4");
  parent = await readParent();
  await p.getByRole("tab", { name: "Rückblick" }).click();
  await shot("capped-control-current-rules");
  const c3b = createClient({ url: `file:${dbFile}` });
  check("capped control: a review stored under the current learning rules is served as stored (supported credit visible, 'projected' note), its UX summary re-derived (feedback-only → not observed, no false zero), nothing written", c4?.derivation?.status === "projected" && c4.review?.learning?.objectives?.some((o) => o.taskId === "WRITE-TRANSFER-1" && o.evidence === "supported") && c4.review?.experience?.telemetry?.uxObserved === false && c4.review?.experience?.telemetry?.foregroundActiveSeconds === null && parent.derivation !== "obsolete" && /supported/.test(parent.reviewText) && /review-projected|Regelfassung 3/.test(parent.reviewText + (await p.getByTestId("review-v4").locator("[data-testid='review-projected']").count())) && (await v4Rows(c3b)) === controlRows, { status: c4?.derivation?.status, ux: c4?.review?.experience?.telemetry?.uxObserved });
  c3b.close();
  // restore the archived review for the uncapped step
  const c3c = createClient({ url: `file:${dbFile}` });
  await c3c.execute({ sql: "UPDATE family_learning_completions SET review_json = ? WHERE child_id = 'santiago' AND visit_id = 'v4'", args: [archived.completions.find((r) => r.visit_id === "v4").review_json] });
  check("archived review restored byte-identically before the uncapped step", (await v4Rows(c3c)) === before);
  c3c.close();
  // ---- 4. cap removed: the same database, uncapped production server
  await stop();
  await start(false);
  ev = await evidence();
  c4 = ev.completions.find((c) => c.visitId === "v4");
  parent = await readParent();
  await p.getByRole("tab", { name: "Rückblick" }).click();
  await shot("uncapped-review");
  check("uncapped: the archived review is re-derived — WRITE-TRANSFER-1 unscored, earlier derivation (independent) disclosed, identity and dates unchanged", c4?.derivation?.status === "current" && c4.review?.identity?.reviewVersion === REVIEW_VERSION && c4.review?.learning?.objectives?.find((o) => o.taskId === "WRITE-TRANSFER-1")?.evidence === "unscored" && c4.review?.previousReviews?.[0]?.objectives?.find((o) => o.taskId === "WRITE-TRANSFER-1")?.evidence === "independent" && c4.completionId === archivedReview.identity.completionId && parent.derivation !== "obsolete" && /nicht bewertet/.test(parent.reviewText) && /Frühere Fassung/.test(parent.reviewText), { evidence: c4?.review?.learning?.objectives?.find((o) => o.taskId === "WRITE-TRANSFER-1")?.evidence });
  const c4db = createClient({ url: `file:${dbFile}` });
  const afterUncapped = JSON.parse(await v4Rows(c4db));
  const beforeParsed = JSON.parse(before);
  check("uncapped: only review_json of the v4 completion changed; mission state, attempts, samples, completion identity and dates are byte-identical", JSON.stringify(afterUncapped.mission) === JSON.stringify(beforeParsed.mission) && JSON.stringify(afterUncapped.attempts) === JSON.stringify(beforeParsed.attempts) && JSON.stringify(afterUncapped.samples) === JSON.stringify(beforeParsed.samples) && afterUncapped.completion[0].completion_id === beforeParsed.completion[0].completion_id && afterUncapped.completion[0].finished_at === beforeParsed.completion[0].finished_at && afterUncapped.completion[0].created_at === beforeParsed.completion[0].created_at && afterUncapped.completion[0].review_json !== beforeParsed.completion[0].review_json);
  c4db.close();
  const missionUncapped = await api("GET", "/api/family/learning/mission", null, assistant, bearer);
  check("uncapped child mission API resumes the saved state (200, content v2, no running visit; the finished chapter is recorded)", missionUncapped.status === 200 && missionUncapped.json?.view?.contentVersion === 2 && missionUncapped.json?.view?.visit === null, { next: missionUncapped.json?.view?.next });
  // ---- 5. erase → read under the cap resurrects nothing
  await stop();
  await start(true);
  const del = await api("DELETE", "/api/family/learning/parent/records?child=santiago&confirm=santiago", null, owner);
  ev = await evidence();
  check("capped erase → read: nothing is resurrected (no completions, no state)", del.status === 200 && ev.completions.length === 0 && ev.state === null, { status: del.status });
} finally {
  await browser.close().catch(() => {});
  await stop();
}
fs.writeFileSync(path.join(OUT, "cap-review-results.json"), JSON.stringify({ results, passed: results.filter((r) => r.ok).length, total: results.length, archived: ARCHIVED, dir: DIR }, null, 2));
const passed = results.filter((r) => r.ok).length;
console.log(`${passed}/${results.length} cap-review checks passed`);
process.exit(passed === results.length ? 0 : 1);
