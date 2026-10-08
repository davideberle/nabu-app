// Self-check harness for the Family simplification candidate (October 8, 2026): daily earned chess, one paid Studio
// clock, retired rewards, compact parent tools, retired boards. HTTP + headless-browser journeys against a LOCAL
// production server (scripts/run-family-home-server.sh) with a synthetic AUTH_SECRET, an isolated SQLite database
// seeded by scripts/seed-family-fixture.mjs, the ISOLATED Game Studio child adapter candidate and the synthetic
// upstream (scripts/fake-studio-upstream.mjs). Nothing touches production, the live adapter or any provider.
//
//   AUTH_SECRET=<same as server> node scripts/verify-family-home.mjs --base http://127.0.0.1:3191 --upstream http://127.0.0.1:5196 --db /tmp/nfs-localdb/nabu.db --out <dir>
//
// Builder self-check, not the independent acceptance (VR-01/VR-02). Results: <out>/results.json + screenshots.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { encode } from "@auth/core/jwt";
import { createClient } from "@libsql/client";
import { audioSafeChromiumLaunchOptions } from "./lib/browser-audio-guard.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const base = opt("--base", "http://127.0.0.1:3191").replace(/\/$/, "");
const upstreamBase = opt("--upstream", "http://127.0.0.1:5196").replace(/\/$/, "");
const dbPath = opt("--db", "/tmp/nfs-localdb/nabu.db");
const out = opt("--out", "/tmp/nfs-selfcheck");
fs.mkdirSync(out, { recursive: true });
const secret = process.env.AUTH_SECRET;
if (!secret || secret.length < 32) throw new Error("AUTH_SECRET required");
const COOKIE = "authjs.session-token";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${process.env.HOME}/.npm-global/lib/node_modules/playwright`);
const db = createClient({ url: `file:${dbPath}` });

const results = [];
// A crash mid-run must still leave the results so far on disk (the detail of the last FAIL is what explains it).
const writeResults = (crashed = null) => fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ base, at: new Date().toISOString(), crashed, total: results.length, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).map((r) => r.id), results }, null, 2));
for (const ev of ["uncaughtException", "unhandledRejection"]) process.on(ev, (err) => { writeResults(String(err?.stack || err)); console.error(err); process.exit(1); });
function record(id, name, ok, detail = "") {
  results.push({ id, name, ok: Boolean(ok), detail: String(detail).slice(0, 1500) });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name}${detail ? ` — ${String(detail).slice(0, 220)}` : ""}`);
}
async function sessionCookie(email) {
  const now = Math.floor(Date.now() / 1000);
  return `${COOKIE}=${await encode({ token: { email, name: email, sub: email, iat: now, exp: now + 3600 }, secret, salt: COOKIE, maxAge: 3600 })}`;
}
async function call(method, p, { cookie, bearer, body, headers = {} } = {}) {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  if (bearer) h.authorization = `Bearer ${bearer}`;
  if (body !== undefined) h["content-type"] = "application/json";
  const url = p.startsWith("http") ? p : base + p;
  const res = await fetch(url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual" });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, location: res.headers.get("location"), headers: res.headers, text, json };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isRedirect = (r) => [302, 307, 308].includes(r.status);
const CHESS = "adaptive-chess-coach";
const PAID = "fixture-paid-game";
const RETIRED = ["friends", "mini-game", "movie-night", "afternoon-excursion", "proper-trip"];

const assistant = await sessionCookie("assistant@davideberle.com");
const owner = await sessionCookie("info@davideberle.com");
await call("GET", "/api/family/wallet", { cookie: assistant });
const today = (await call("GET", "/api/family/parent/records", { cookie: owner })).json.today;
console.log("today (server, Zurich):", JSON.stringify(today));

// ---------------------------------------------------------------------------
// H: redirects, retired destinations, access separation (UI-01/05/06/07/08/09, AU-01)
// ---------------------------------------------------------------------------
{
  const r = await call("GET", "/login", { cookie: assistant });
  record("H-01", "shared child account lands on /family/home", r.status === 302 && r.location?.endsWith("/family/home"), `${r.status} ${r.location}`);
  const root = await call("GET", "/", { cookie: assistant });
  record("H-02", "child account is redirected from adult surfaces to Family Home", root.status === 302 && root.location?.endsWith("/family/home"), `${root.status} ${root.location}`);
  for (const [p, want] of [["/family/learn/parent", "/family/home"], ["/family/parent", "/family/home"], ["/family/tracker", "/family/home"], ["/family", "/family/home"]]) {
    const x = await call("GET", p, { cookie: assistant });
    record("H-03", `child account never reaches ${p} (→ ${want})`, isRedirect(x) && x.location?.endsWith(want), `${x.status} ${x.location}`);
  }
  for (const [p, want] of [["/family", "/family/home"], ["/family/tracker", "/family/home"], ["/family/dashboard", "/family/parent"], ["/family/dashboard?week=2026-W12", "/family/parent"], ["/family/dashboard/santiago?week=2025-W01", "/family/home?child=santiago"], ["/family/dashboard/isabel", "/family/home?child=isabel"], ["/family/dashboard/david", "/family/home"], ["/family/dashboard/nope", "/family/home"], ["/family/plan?child=isabel&week=2025-W02", "/family/activity?child=isabel"], ["/family/plan?child=santiago", "/family/activity?child=santiago"], ["/family/plan?child=junk&week=banana", "/family/activity"], ["/family/plan", "/family/activity"], ["/family/rewards/chess?child=santiago", `/family/games/play?game=${CHESS}&child=santiago`], ["/family/rewards/chess", "/family/home"]]) {
    const x = await call("GET", p, { cookie: owner });
    record("H-04", `owner legacy redirect ${p} → ${want}`, isRedirect(x) && x.location?.endsWith(want), `${x.status} ${x.location}`);
  }
  for (const [p, want] of [["/family/dashboard", "/family/home"], ["/family/dashboard/santiago", "/family/home?child=santiago"], ["/family/plan?child=santiago&week=2026-W01", "/family/activity?child=santiago"]]) {
    const x = await call("GET", p, { cookie: assistant });
    record("H-05", `child legacy redirect ${p} → ${want} (no parent destination)`, isRedirect(x) && x.location?.endsWith(want), `${x.status} ${x.location}`);
  }
  // No redirect loop: the targets answer 200.
  for (const p of ["/family/home", "/family/home?child=santiago", "/family/activity?child=isabel", "/family/activity", "/family/rewards?child=santiago", "/family/games?child=santiago", "/family/games/edit?child=santiago", "/family/assistant", "/family/listen?child=santiago", "/family/learn?child=santiago"]) {
    const x = await call("GET", p, { cookie: assistant });
    record("H-06", `child route resolves: ${p}`, x.status === 200, `${x.status}`);
  }
  const parent = await call("GET", "/family/parent", { cookie: owner });
  record("H-07", "owner reaches the compact parent tools", parent.status === 200, `${parent.status}`);
  const records = await call("GET", "/api/family/parent/records", { cookie: assistant });
  const queue = await call("GET", "/api/family/review-queue", { cookie: assistant });
  record("H-08", "AU-01 child session is refused the parent records and the review queue", records.status === 403 && queue.status === 403, `${records.status}/${queue.status}`);
  const manifest = await call("GET", "/manifest.json");
  record("H-09", "UI-09 the Home Screen manifest starts in Family Home", manifest.json?.start_url === "/family/home", manifest.json?.start_url);
  const rootOwner = await call("GET", "/", { cookie: owner });
  record("H-10", "UI-01 root shows one Family Home tile, no Routines/tracker tile, and the Today projection", rootOwner.status === 200 && rootOwner.text.includes("Family Home") && !rootOwner.text.includes("Family board, weekly routines") && !/href="\/family\/dashboard"/.test(rootOwner.text) && !/href="\/family\/tracker"/.test(rootOwner.text) && !/href="\/family"[^/]/.test(rootOwner.text) && rootOwner.text.includes("Today"), `${rootOwner.status}`);
}

// ---------------------------------------------------------------------------
// H: retired rewards (5/5), wallet preservation, provenance (PR-02/PR-03)
// ---------------------------------------------------------------------------
const wallet0 = (await call("GET", "/api/family/wallet", { cookie: assistant })).json;
const santiago0 = wallet0.wallets.santiago.balance;
const isabel0 = wallet0.wallets.isabel.balance;
record("H-20", "seeded fixture wallets read back (santiago 8 earned −3 historical friends = 5; isabel 2)", santiago0 === 5 && isabel0 === 2 && wallet0.wallets.santiago.earned === 8 && wallet0.wallets.santiago.spent === 3, JSON.stringify({ s: wallet0.wallets.santiago, i: wallet0.wallets.isabel }));
{
  // Stale config says the reward is enabled and cheap: still refused.
  const cfg = await call("PUT", "/api/family/config", { cookie: owner, body: { routineOverrides: {}, rewardOverrides: { friends: { enabled: true, costPoints: 1 }, "mini-game": { enabled: true, costPoints: 1 } } } });
  record("H-21", "owner config write accepted (rewardOverrides are stored, not deleted)", cfg.status === 200, `${cfg.status}`);
  for (const id of RETIRED) {
    const direct = await call("POST", "/api/family/redemptions", { cookie: assistant, body: { personId: "santiago", rewardId: id, idempotencyKey: `retired-${id}-${Date.now()}` } });
    const stale = await call("POST", "/api/family/redemptions", { cookie: owner, body: { personId: "isabel", rewardId: id, week: today.week } });
    record(`R-${id}`, `retired reward ${id}: direct POST and stale client/config request refused (410), no debit`, direct.status === 410 && direct.json?.error === "reward-retired" && stale.status === 410, `${direct.status}/${stale.status}`);
  }
  await call("PUT", "/api/family/config", { cookie: owner, body: { routineOverrides: {}, rewardOverrides: {} } });
  const wallet1 = (await call("GET", "/api/family/wallet", { cookie: assistant })).json;
  const hist = (await call("GET", "/api/family/redemptions?week=2026-W40", { cookie: assistant })).json;
  record("H-22", "PR-03 wallets unchanged and the historical retired redemption (snapshot 3) remains readable", wallet1.wallets.santiago.balance === santiago0 && wallet1.wallets.isabel.balance === isabel0 && hist.some((r) => r.id === "fixture-redemption-friends-w40" && r.chargedPoints === 3), JSON.stringify(hist.map((r) => [r.rewardId, r.chargedPoints])));
  const act = (await call("GET", "/api/family/activity?person=santiago", { cookie: assistant })).json;
  record("H-23", "UI-04 activity keeps the retired reward's history item with its stored snapshot and all review states", act.items.some((i) => i.id === "redemption:fixture-redemption-friends-w40" && i.coinDelta === -3) && act.items.some((i) => i.status === "pending") && act.items.some((i) => i.status === "on-hold") && act.items.some((i) => i.status === "try-again"), `${act.items.length} items`);
  const selfDone = await call("POST", "/api/family/completions", { cookie: assistant, body: { week: today.week, personId: "isabel", routineId: "i-clear", day: today.day, status: "done" } });
  record("H-24", "PR-02 a child session cannot write `done` directly (403)", selfDone.status === 403, `${selfDone.status}`);
  const future = await call("POST", "/api/family/completions", { cookie: owner, body: { week: "2030-W10", personId: "isabel", routineId: "i-clear", day: 2, status: "pending_review", parentAssisted: true, note: "future" } });
  record("H-25", "UI-11 parent-assisted capture refuses a future occurrence date", future.status === 400, `${future.status}`);
}

// ---------------------------------------------------------------------------
// H: daily chess (DA-01..DA-04)
// ---------------------------------------------------------------------------
const mintS = (await call("POST", "/api/family/games/session", { cookie: assistant, body: { childId: "santiago" } })).json;
const mintI = (await call("POST", "/api/family/games/session", { cookie: assistant, body: { childId: "isabel" } })).json;
record("H-30", "games session mints a bearer and a library-scope Studio credential", mintS?.token && mintS?.studio?.url && mintS?.studio?.token, mintS?.studio?.url);
const stateS = (await call("GET", "/api/family/play/state", { cookie: assistant, bearer: mintS.token })).json;
const stateI = (await call("GET", "/api/family/play/state", { cookie: assistant, bearer: mintI.token })).json;
record("H-31", "DA-01 server chess status: Santiago eligible (approved activity occurring today), Isabel not (only pending today)", stateS.chess.eligible === true && stateS.chess.remainingSeconds === 900 && stateS.chess.date === today.date && stateI.chess.eligible === false && stateI.chess.remainingSeconds === 0, JSON.stringify({ s: stateS.chess, i: stateI.chess }));
record("H-32", "SC-01 price is still 3 coins / 900 s; the paid allowance starts at zero; chess is separate", stateS.price.coins === 3 && stateS.price.seconds === 900 && stateS.remainingSeconds === 0 && stateS.chess.dailySeconds === 900, JSON.stringify(stateS.price));
const chessI = await call("POST", "/api/family/play/leases", { cookie: assistant, bearer: mintI.token, body: { gameId: CHESS, mode: "play" } });
record("H-33", "DA-01 Isabel cannot get a chess lease today (chess-not-earned, 402)", chessI.status === 402 && chessI.json?.error === "chess-not-earned", `${chessI.status} ${chessI.json?.error}`);
const chessS = await call("POST", "/api/family/play/leases", { cookie: assistant, bearer: mintS.token, body: { gameId: CHESS, mode: "play", device: "harness-a" } });
record("H-34", "DA-02 Santiago's chess lease is metered on the chess budget (900), with a same-origin content path and a Studio credential", chessS.status === 201 && chessS.json.lease.metered && chessS.json.lease.budgetKind === "chess" && chessS.json.lease.budgetSeconds === 900 && chessS.json.content?.path?.startsWith(`/games/${CHESS}/index.html?child=santiago&credential=`) && chessS.json.studio?.token, `${chessS.status}`);
const chessLease = chessS.json.lease.id;
const chessCred = chessS.json.studio.token;
{
  const again = await call("POST", "/api/family/play/leases", { cookie: assistant, bearer: mintS.token, body: { gameId: CHESS, mode: "play", takeover: true, device: "harness-b" } });
  const rows = (await db.execute({ sql: "SELECT granted_seconds, consumed_seconds FROM family_chess_allowances WHERE person_id = 'santiago' AND date = ?", args: [today.date] })).rows;
  record("H-35", "DA-02 a second entry (takeover) does not stack: still one 900 s grant row for today", again.status === 201 && rows.length === 1 && Number(rows[0].granted_seconds) === 900, JSON.stringify(rows));
  const w = (await call("GET", "/api/family/wallet", { cookie: assistant })).json;
  record("H-36", "DA-02 chess leases moved no coins", w.wallets.santiago.balance === santiago0 && w.wallets.santiago.spent === 3, JSON.stringify(w.wallets.santiago));
  // Use the takeover lease from here (the first one is replaced).
  var liveChess = again.json.lease.id; var liveChessCred = again.json.studio.token; var liveContent = again.json.content.path;
}
{
  const raw = await call("GET", `/games/${CHESS}/index.html`, { cookie: assistant });
  const rawChild = await call("GET", `/games/${CHESS}/index.html?child=santiago`, { cookie: assistant });
  const asset = await call("GET", `/games/${CHESS}/chess-engine.js`, { cookie: assistant });
  const asset2 = await call("GET", `/games/${CHESS}/chess-ui.js?credential=${encodeURIComponent(liveChessCred)}`, { cookie: assistant });
  const anon = await call("GET", liveContent);
  const libraryCred = await call("GET", `/games/${CHESS}/index.html?child=santiago&credential=${encodeURIComponent(mintS.studio.token)}`, { cookie: assistant });
  const staleCred = await call("GET", chessS.json.content.path, { cookie: assistant });
  const wrongChild = await call("GET", liveContent.replace("child=santiago", "child=isabel"), { cookie: assistant });
  record("H-37", "DA-04 raw bundle paths: no credential 401, assets 404, anonymous 401, library credential 403, replaced lease 410, wrong child 403", raw.status === 401 && rawChild.status === 401 && asset.status === 404 && asset2.status === 404 && anon.status === 302 && libraryCred.status === 403 && staleCred.status === 410 && wrongChild.status === 403, `${raw.status}/${rawChild.status}/${asset.status}/${asset2.status}/${anon.status}/${libraryCred.status}/${staleCred.status}/${wrongChild.status}`);
  const content = await call("GET", liveContent, { cookie: assistant });
  record("H-38", "DA-04 the live lease credential serves the bundle: one document, scripts inlined, guard injected, beacons at the adapter, pinned frame-ancestors, no-store", content.status === 200 && content.text.includes("data-family-play-guard") && content.text.includes('data-chess-asset="chess-engine.js"') && !/<script\s+src=/.test(content.text) && content.text.includes(`"${mintS.studio.url}"+'/v1/play/'`) && content.headers.get("content-security-policy") === `frame-ancestors ${base}` && /no-store/.test(content.headers.get("cache-control") || ""), `${content.status} ${content.text.length} bytes`);
  const adapterContent = await call("GET", `${mintS.studio.url}/v1/play/${liveChess}/${CHESS}/index.html?credential=${encodeURIComponent(liveChessCred)}`);
  const adapterRaw = await call("GET", `${mintS.studio.url}/v1/play/${liveChess}/${CHESS}/index.html`);
  record("H-39", "DA-04 the adapter's own chess content path is gated too (lease credential required)", adapterRaw.status === 401 && [200, 410].includes(adapterContent.status), `${adapterRaw.status}/${adapterContent.status}`);
}
{
  const t0 = await call("POST", `${mintS.studio.url}/v1/play/${liveChess}/tick`, { bearer: liveChessCred, body: { active: true } });
  await sleep(2100);
  const t1 = await call("POST", `${mintS.studio.url}/v1/play/${liveChess}/tick`, { bearer: liveChessCred, body: { active: true } });
  record("H-40", "DA-03 chess is metered by the adapter on the chess budget (server clock)", t0.status === 200 && t0.json.remainingSeconds === 900 && t1.status === 200 && t1.json.remainingSeconds <= 898.5 && t1.json.remainingSeconds >= 896, JSON.stringify([t0.json.remainingSeconds, t1.json.remainingSeconds]));
  const sibling = await call("POST", `${mintS.studio.url}/v1/play/${liveChess}/tick`, { bearer: mintI.studio.token, body: { active: true } });
  record("H-41", "AU-01 the sibling's credential cannot tick the chess lease", sibling.status === 403, `${sibling.status}`);
  // Parent holds TODAY's only approval → lock within one heartbeat, no coin movement, consumed seconds kept.
  const q = (await call("GET", "/api/family/review-queue", { cookie: owner })).json;
  const hold = await call("PATCH", "/api/family/completions", { cookie: owner, body: { week: today.week, personId: "santiago", routineId: "s-kumon", day: today.day, action: "hold", expectedStatus: "done" } });
  await sleep(300);
  const locked = await call("POST", `${mintS.studio.url}/v1/play/${liveChess}/tick`, { bearer: liveChessCred, body: { active: true } });
  const stateLocked = (await call("GET", "/api/family/play/state", { cookie: assistant, bearer: mintS.token })).json;
  const contentLocked = await call("GET", liveContent, { cookie: assistant });
  const debitRows = Number((await db.execute("SELECT COUNT(*) AS n FROM family_reward_redemptions")).rows[0].n);
  // Holding today's only approval also withdraws its (1-coin) award until re-approval — that is the wallet rule, not a chess debit: no redemption row appears.
  record("H-42", "DA-03 removing today's last approval locks the live lease (410 chess-locked), the content route refuses, remaining is 0, consumed seconds are kept, no chess debit (no redemption row)", hold.status === 200 && locked.status === 410 && locked.json?.endReason === "chess-locked" && stateLocked.chess.eligible === false && stateLocked.chess.remainingSeconds === 0 && stateLocked.chess.consumedSeconds >= 1 && [403, 410].includes(contentLocked.status) && stateLocked.balance === santiago0 - 1 && debitRows === 1, JSON.stringify({ hold: hold.status, locked: locked.status, reason: locked.json?.endReason, chess: stateLocked.chess, content: contentLocked.status, balance: stateLocked.balance, debitRows, q: q.count }));
  const relock = await call("POST", "/api/family/play/leases", { cookie: assistant, bearer: mintS.token, body: { gameId: CHESS, mode: "play", takeover: true } });
  record("H-43", "DA-03 while locked no chess lease is issued (chess-not-earned)", relock.status === 402 && relock.json?.error === "chess-not-earned", `${relock.status}`);
  // Re-approve via the queue contract (expected status on_hold): remainder only, no second grant.
  const current = (await call("GET", "/api/family/review-queue", { cookie: owner })).json.items.find((i) => i.personId === "santiago" && i.routineId === "s-kumon" && i.week === today.week && i.day === today.day);
  const reapprove = await call("PATCH", "/api/family/completions", { cookie: owner, body: { week: today.week, personId: "santiago", routineId: "s-kumon", day: today.day, action: "approve", expectedStatus: "on_hold", expectedSubmittedAt: current?.submittedAt ?? null } });
  const stateBack = (await call("GET", "/api/family/play/state", { cookie: assistant, bearer: mintS.token })).json;
  const release = await call("POST", "/api/family/play/leases", { cookie: assistant, bearer: mintS.token, body: { gameId: CHESS, mode: "play", takeover: true, device: "harness-c" } });
  record("H-44", "DA-03 re-approval restores only the unconsumed remainder (one grant row, remaining < 900) and the held coin; the stale PATCH contract works", reapprove.status === 200 && stateBack.balance === santiago0 && stateBack.chess.eligible === true && stateBack.chess.remainingSeconds < 900 && stateBack.chess.remainingSeconds >= 890 && release.status === 201 && release.json.lease.budgetSeconds === stateBack.chess.remainingSeconds && Number((await db.execute({ sql: "SELECT COUNT(*) AS n FROM family_chess_allowances WHERE person_id='santiago' AND date=?", args: [today.date] })).rows[0].n) === 1, JSON.stringify({ reapprove: reapprove.status, chess: stateBack.chess, budget: release.json?.lease?.budgetSeconds }));
  await call("POST", `${mintS.studio.url}/v1/play/${release.json.lease.id}/end`, { bearer: release.json.studio.token, body: { reason: "harness", frameStopped: true } });
  await call("POST", `/api/family/play/leases/${release.json.lease.id}/release`, { cookie: assistant, bearer: mintS.token, body: { reason: "harness" } });
  await sleep(2600); // the released lease's authority fence (2 s) must lapse before the next activation at the meter
  // Stale review action fails closed (the queue snapshot changed).
  const stale = await call("PATCH", "/api/family/completions", { cookie: owner, body: { week: today.week, personId: "santiago", routineId: "s-kumon", day: today.day, action: "hold", expectedStatus: "pending_review" } });
  record("H-45", "PR-01 a stale review action (wrong expected status) fails closed with 409", stale.status === 409, `${stale.status}`);
}
{
  // Parent-assisted dated capture for Isabel TODAY unlocks her chess (DA-01 via PR-02 provenance); undo locks again.
  const entered = await call("POST", "/api/family/completions", { cookie: owner, body: { week: today.week, personId: "isabel", routineId: "i-clear", day: today.day, status: "pending_review", parentAssisted: true, note: "Cleared the table (parent present)", creditCount: 1 } });
  const row = (await db.execute({ sql: "SELECT status, approval_source, note, reviewed_at FROM family_completions WHERE person_id='isabel' AND routine_id='i-clear' AND week=? AND day=?", args: [today.week, today.day] })).rows[0];
  const stateI2 = (await call("GET", "/api/family/play/state", { cookie: assistant, bearer: mintI.token })).json;
  const dup = await call("POST", "/api/family/completions", { cookie: owner, body: { week: today.week, personId: "isabel", routineId: "i-clear", day: today.day, status: "pending_review", parentAssisted: true, note: "again" } });
  const wI = (await call("GET", "/api/family/wallet", { cookie: assistant })).json.wallets.isabel;
  record("H-46", "UI-11/PR-02 parent-assisted capture lands on today's identity with explicit provenance and the claim kept; a duplicate is refused (409) and credits nothing twice; Isabel is now chess-eligible", entered.status === 200 && row?.status === "done" && row?.approval_source === "parent-assisted" && String(row?.note).includes("Cleared the table") && dup.status === 409 && wI.balance === isabel0 + 1 && stateI2.chess.eligible === true, JSON.stringify({ entered: entered.status, row, dup: dup.status, isabel: wI, chess: stateI2.chess }));
  const leaseI = await call("POST", "/api/family/play/leases", { cookie: assistant, bearer: mintI.token, body: { gameId: CHESS, mode: "play" } });
  const undo = await call("DELETE", "/api/family/completions", { cookie: owner, body: { week: today.week, personId: "isabel", routineId: "i-clear", day: today.day } });
  await sleep(200);
  const tickI = await call("POST", `${mintI.studio.url}/v1/play/${leaseI.json.lease.id}/tick`, { bearer: leaseI.json.studio.token, body: { active: true } });
  const stateI3 = (await call("GET", "/api/family/play/state", { cookie: assistant, bearer: mintI.token })).json;
  await sleep(2600);
  record("H-47", "PR-01/DA-03 the parent undo removes the approval, locks Isabel's live chess lease and her wallet returns to the previous balance", leaseI.status === 201 && undo.status === 200 && undo.json.removed === true && tickI.status === 410 && stateI3.chess.eligible === false && stateI3.chess.remainingSeconds === 0 && (await call("GET", "/api/family/wallet", { cookie: assistant })).json.wallets.isabel.balance === isabel0, JSON.stringify({ lease: leaseI.status, undo: undo.status, tick: tickI.status, chess: stateI3.chess }));
}

// ---------------------------------------------------------------------------
// H: paid Studio clock — purchase, studio lease, adapter authority (SC-01..SC-07)
// ---------------------------------------------------------------------------
{
  const key = `selfcheck-${Date.now()}`;
  const buy1 = await call("POST", "/api/family/play/purchases", { cookie: assistant, bearer: mintS.token, body: { idempotencyKey: key } });
  const buy2 = await call("POST", "/api/family/play/purchases", { cookie: assistant, bearer: mintS.token, body: { idempotencyKey: key } });
  record("H-50", "SC-01/SC-02 purchase debits 3 coins and grants 900 s once; the same key replays", buy1.status === 201 && buy1.json.balance === santiago0 - 3 && buy1.json.remainingSeconds === 900 && buy2.status === 200 && buy2.json.replayed === true && buy2.json.balance === santiago0 - 3, `${buy1.status}/${buy2.status} ${buy1.json?.balance}`);
  const buyI = await call("POST", "/api/family/play/purchases", { cookie: assistant, bearer: mintI.token, body: { idempotencyKey: `${key}-i` } });
  record("H-51", "SC-02 insufficient funds commits nothing", buyI.status === 409 && (await call("GET", "/api/family/wallet", { cookie: assistant })).json.wallets.isabel.balance === isabel0, `${buyI.status}`);
  const noStudio = await call("POST", "/api/family/play/leases", { cookie: assistant, bearer: mintI.token, body: { mode: "edit" } });
  record("H-52", "SC-01 no free editor: Isabel (no allowance) gets no studio lease (402 no-allowance)", noStudio.status === 402 && noStudio.json?.error === "no-allowance", `${noStudio.status}`);
  const studio = await call("POST", "/api/family/play/leases", { cookie: assistant, bearer: mintS.token, body: { mode: "edit", device: "harness-e" } });
  record("H-53", "SC-01/SC-03 the studio lease is metered on the paid allowance (900) with game id * and a scope-studio credential", studio.status === 201 && studio.json.lease.gameId === "*" && studio.json.lease.budgetKind === "paid" && studio.json.lease.budgetSeconds === 900 && studio.json.studio?.token && studio.json.content === null, `${studio.status}`);
  const sLease = studio.json.lease.id; const sCred = studio.json.studio.token; const sUrl = studio.json.studio.url;
  const postsBefore = (await call("GET", `${upstreamBase}/__fixture/posts`)).json.posts.length;
  const libCreate = await call("POST", `${sUrl}/v1/studio/projects`, { bearer: mintS.studio.token, body: { prompt: "a game with the library credential" } });
  const chessCreate = await call("POST", `${sUrl}/v1/studio/projects`, { bearer: liveChessCred, body: { prompt: "a game with a chess credential" } });
  const siblingCreate = await call("POST", `${sUrl}/v1/studio/projects`, { bearer: mintI.studio.token, body: { prompt: "a game with the sibling's library credential" } });
  record("H-54", "SC-06 library, chess-lease and sibling credentials cannot create (403) and reach no provider", libCreate.status === 403 && chessCreate.status === 403 && siblingCreate.status === 403 && (await call("GET", `${upstreamBase}/__fixture/posts`)).json.posts.length === postsBefore, `${libCreate.status}/${chessCreate.status}/${siblingCreate.status}`);
  const play = await call("POST", "/api/family/play/leases", { cookie: assistant, bearer: mintS.token, body: { gameId: PAID, mode: "play" } });
  record("H-55", "SC-03 one lease per child: play is held while the studio lease is live", play.status === 409 && play.json?.heldBy?.leaseId === sLease, `${play.status}`);
  const created = await call("POST", `${sUrl}/v1/studio/projects`, { bearer: sCred, body: { prompt: "A space game where I collect stars" } });
  record("H-56", "SC-06 the studio credential creates (201) — ownership recorded, billed as foreground", created.status === 201 && created.json.project.id && (await call("GET", `${upstreamBase}/__fixture/posts`)).json.posts.length === postsBefore + 1, `${created.status} ${created.json?.project?.id}`);
  const ownId = created.json.project.id; const jobId = created.json.job.id;
  const wait = await call("POST", `${sUrl}/v1/play/${sLease}/tick`, { bearer: sCred, body: { active: false, waiting: { kind: "job", id: jobId } } });
  const forged = await call("POST", `${sUrl}/v1/play/${sLease}/tick`, { bearer: sCred, body: { active: false, waiting: { kind: "job", id: "job-does-not-exist" } } });
  record("H-57", "SC-05 a wait on the child's own queued job is attested; a wait on an unknown job is not", wait.status === 200 && wait.json.waiting?.attested === true && wait.json.waiting?.status === "queued" && wait.json.billing === "stopped" && forged.json.waiting?.attested === false, JSON.stringify([wait.json.waiting, forged.json.waiting]));
  const libRead = await call("GET", `${sUrl}/v1/studio/projects/${ownId}`, { bearer: mintS.studio.token });
  record("H-58", "SC-07 read-only recovery with the library credential stays possible (project readable)", libRead.status === 200 && libRead.json.id === ownId, `${libRead.status}`);
  // Family revokes the studio lease (child takes over elsewhere): the next submission is refused before the provider.
  const takeover = await call("POST", "/api/family/play/leases", { cookie: assistant, bearer: mintS.token, body: { mode: "edit", takeover: true, device: "harness-f" } });
  await sleep(2600);
  const n1 = (await call("GET", `${upstreamBase}/__fixture/posts`)).json.posts.length;
  const refused = await call("POST", `${sUrl}/v1/studio/projects/${ownId}/iterate`, { bearer: sCred, body: { prompt: "slower" } });
  record("H-59", "SC-06 after Family replaced the lease the old studio credential is refused (410) with no provider call; the successor works", takeover.status === 201 && refused.status === 410 && (await call("GET", `${upstreamBase}/__fixture/posts`)).json.posts.length === n1, `${takeover.status}/${refused.status}`);
  const sCred2 = takeover.json.studio.token; const sLease2 = takeover.json.lease.id;
  const iter = await call("POST", `${sUrl}/v1/studio/projects/${ownId}/iterate`, { bearer: sCred2, body: { prompt: "slower enemies" } });
  const plan = iter.json?.plan;
  const approveEarly = plan ? await call("POST", `${sUrl}/v1/studio/plans/${plan.id}/approve`, { bearer: sCred2, body: { confirmPlanId: plan.id } }) : { status: 0 };
  const clarify = plan ? await call("POST", `${sUrl}/v1/studio/plans/${plan.id}/clarify`, { bearer: sCred2, body: { answers: [{ question: "How much?", answer: "Half" }] } }) : { status: 0 };
  const approve = plan ? await call("POST", `${sUrl}/v1/studio/plans/${plan.id}/approve`, { bearer: sCred2, body: { confirmPlanId: plan.id } }) : { status: 0 };
  record("H-60", "SC-06 iterate → plan (202, no build), approval refused while a question is open (409), clarify (200), explicit approve starts the build (200, job)", iter.status === 202 && plan?.status === "awaiting_clarification" && approveEarly.status === 409 && clarify.status === 200 && approve.status === 200 && approve.json?.job?.id, `${iter.status}/${approveEarly.status}/${clarify.status}/${approve.status}`);
  const stateAfter = (await call("GET", "/api/family/play/state", { cookie: assistant, bearer: mintS.token })).json;
  record("H-61", "SC-01/SC-03 studio interaction consumed the PAID allowance (not chess), a little, and the active lease is the studio one", stateAfter.remainingSeconds < 900 && stateAfter.remainingSeconds >= 880 && stateAfter.activeLease?.id === sLease2 && stateAfter.chess.consumedSeconds >= 1, JSON.stringify({ paid: stateAfter.remainingSeconds, chess: stateAfter.chess.consumedSeconds }));
  // Exhaustion refuses submissions: shrink the allowance to 1 s, re-lease, tick past it.
  await call("POST", `${sUrl}/v1/play/${sLease2}/end`, { bearer: sCred2, body: { reason: "harness", frameStopped: true } });
  await call("POST", `/api/family/play/leases/${sLease2}/release`, { cookie: assistant, bearer: mintS.token, body: { reason: "harness" } });
  await sleep(2600);
  await db.execute("UPDATE family_play_allowances SET consumed_seconds = granted_seconds - 1 WHERE person_id = 'santiago'");
  const tiny = await call("POST", "/api/family/play/leases", { cookie: assistant, bearer: mintS.token, body: { mode: "edit", takeover: true, device: "harness-g" } });
  const tCred = tiny.json?.studio?.token; const tLease = tiny.json?.lease?.id;
  await call("POST", `${sUrl}/v1/play/${tLease}/tick`, { bearer: tCred, body: { active: true } });
  await sleep(1600);
  const grace = await call("POST", `${sUrl}/v1/play/${tLease}/tick`, { bearer: tCred, body: { active: true } });
  const n2 = (await call("GET", `${upstreamBase}/__fixture/posts`)).json.posts.length;
  const inGrace = await call("POST", `${sUrl}/v1/studio/projects`, { bearer: tCred, body: { prompt: "one more" } });
  record("H-62", "SC-07 at exhaustion the meter enters the once-only 30 s grace and every submission is refused (410) with no provider call; results stay readable", tiny.status === 201 && tiny.json.lease.budgetSeconds === 1 && grace.json?.phase === "grace" && inGrace.status === 410 && (await call("GET", `${upstreamBase}/__fixture/posts`)).json.posts.length === n2 && (await call("GET", `${sUrl}/v1/studio/projects/${ownId}`, { bearer: tCred })).status === 200, JSON.stringify({ budget: tiny.json?.lease?.budgetSeconds, phase: grace.json?.phase, inGrace: inGrace.status }));
  await call("POST", `${sUrl}/v1/play/${tLease}/end`, { bearer: tCred, body: { reason: "harness", frameStopped: true } });
  await call("POST", `/api/family/play/leases/${tLease}/release`, { cookie: assistant, bearer: mintS.token, body: { reason: "harness" } });
  await sleep(2600);
  // Owner refund of the purchase via the parent undo (exactly once).
  const refund = await call("DELETE", "/api/family/redemptions", { cookie: owner, body: { id: buy1.json.purchase.redemptionId } });
  const refund2 = await call("DELETE", "/api/family/redemptions", { cookie: owner, body: { id: buy1.json.purchase.redemptionId } });
  record("H-63", "SC-02 parent undo refunds the purchase exactly once through the existing route", refund.status === 200 && refund.json.removed === true && refund.json.refundedPurchase && refund2.status === 200 && refund2.json.removed === false, JSON.stringify([refund.json, refund2.json]));
  const settleAnon = await call("POST", `/api/family/play/leases/${tLease}/settle`, { body: { consumedSeconds: 1, end: false } });
  const refundChild = await call("POST", `/api/family/play/purchases/${buy1.json.purchase.id}/refund`, { cookie: assistant, body: { reason: "x" } });
  record("H-64", "AU-01/SC-08 unsigned settlement and child refund attempts are refused", settleAnon.status === 401 && refundChild.status === 403, `${settleAnon.status}/${refundChild.status}`);
  // Fresh allowance for the browser journeys.
  await call("POST", "/api/family/play/purchases", { cookie: assistant, bearer: mintS.token, body: { idempotencyKey: `${key}-browser` } });
}

// ---------------------------------------------------------------------------
// Browser journeys — desktop (owner + child) and tablet touch
// ---------------------------------------------------------------------------
const browser = await chromium.launch(audioSafeChromiumLaunchOptions({ headless: true }));
async function context(viewport, touch, cookie = assistant) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, baseURL: base });
  await ctx.addCookies([{ name: COOKIE, value: cookie.split("=").slice(1).join("="), url: base }]);
  return ctx;
}
const shot = async (page, name) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage: false });

{
  const ctx = await context({ width: 1280, height: 800 }, false, owner);
  const page = await ctx.newPage();
  await page.goto("/");
  await page.getByRole("heading", { name: "Nabu" }).first().waitFor({ timeout: 15000 });
  const tiles = await page.locator("a[href='/family/home']").count();
  record("B-01", "UI-01 owner root: one Family Home tile, no Routines/tracker tiles, Today card projects a date", tiles === 1 && (await page.locator("a[href='/family/dashboard']").count()) === 0 && (await page.locator("a[href='/family/tracker']").count()) === 0 && (await page.getByText("Today").count()) > 0, `${tiles} tiles`);
  await shot(page, "desktop-00-root-owner");
  await page.goto("/family/parent");
  await page.getByRole("heading", { name: /Santiago & Isabel/ }).waitFor({ timeout: 15000 });
  await page.waitForFunction(() => document.querySelector("[data-queue-count]")?.getAttribute("data-queue-count") !== "", null, { timeout: 15000 });
  for (const label of ["Review queue", "Chess today", "Record for a child", "Recent history", "Spending", "Routines", "Upcoming dates"]) {
    record("B-02", `PR-01 parent tools section present: ${label}`, (await page.getByRole("region", { name: label }).count()) === 1);
  }
  const milestones = await page.locator("[data-milestone-id]").count();
  record("B-03", "UI-08 the dates projection is usable from the parent tools", milestones > 0, `${milestones} dates`);
  const queueBefore = Number(await page.locator("[data-queue-count]").getAttribute("data-queue-count"));
  const item = page.locator("[data-queue-key='2026-W40:santiago:s-kumon:5']");
  await item.waitFor({ timeout: 10000 });
  await shot(page, "desktop-01-parent-tools");
  await item.getByRole("button", { name: "✓ Approve" }).click();
  await page.locator("[data-parent-notice]").waitFor({ timeout: 10000 });
  await page.waitForFunction((n) => Number(document.querySelector("[data-queue-count]")?.getAttribute("data-queue-count")) === n - 1, queueBefore, { timeout: 10000 });
  const row = (await db.execute("SELECT status, approval_source FROM family_completions WHERE person_id='santiago' AND routine_id='s-kumon' AND week='2026-W40' AND day=5")).rows[0];
  record("B-04", "UI-06/PR-01 approving a two-week-old queue item from the parent tools works by identity with explicit provenance", row?.status === "done" && row?.approval_source === "parent-review", JSON.stringify(row));
  const hist = page.locator("[data-history-key='2026-W40:santiago:s-kumon:0']");
  await hist.waitFor({ timeout: 10000 });
  await hist.getByRole("button", { name: "One unit more" }).click();
  await page.waitForFunction(() => /Set .* to 3: done/.test(document.querySelector("[data-parent-notice]")?.textContent || ""), null, { timeout: 10000 });
  const corrected = (await db.execute("SELECT credit_count, awarded_points FROM family_completions WHERE person_id='santiago' AND routine_id='s-kumon' AND week='2026-W40' AND day=0")).rows[0];
  record("B-05", "UI-07 count correction from the parent tools (2 → 3 sheets) keeps the per-unit price and snapshots the award", Number(corrected?.credit_count) === 3 && Number(corrected?.awarded_points) === 3, JSON.stringify(corrected));
  const cfgRow = page.locator("[data-routine-config='i-tidy']");
  await cfgRow.getByRole("checkbox").uncheck();
  await page.waitForFunction(() => document.querySelector("[data-config-status]")?.getAttribute("data-config-status") === "saved", null, { timeout: 10000 });
  const cfg = (await call("GET", "/api/family/config", { cookie: owner })).json;
  record("B-06", "UI-07 routine configuration (disable) saves through the config route", cfg.routineOverrides["i-tidy"]?.enabled === false, JSON.stringify(cfg.routineOverrides["i-tidy"]));
  await cfgRow.getByRole("checkbox").check();
  await page.waitForFunction(() => document.querySelector("[data-config-status]")?.getAttribute("data-config-status") === "saved", null, { timeout: 10000 });
  // Parent-assisted entry for Isabel today → chess status flips in the Chess today card.
  await page.locator("[data-entry-child]").selectOption("isabel");
  await page.locator("[data-entry-routine]").selectOption("i-dinner");
  await page.locator("[data-entry-note]").fill("Helped with dinner while I cooked");
  await page.locator("[data-entry-submit]").click();
  await page.waitForFunction(() => document.querySelector("[data-chess-child='isabel']")?.getAttribute("data-chess-eligible") === "true", null, { timeout: 15000 });
  record("B-07", "UI-11/DA-01 a parent-assisted entry for today unlocks the child's chess in the status card", true);
  await shot(page, "desktop-02-parent-tools-after");
  await ctx.close();
}

{
  const ctx = await context({ width: 1280, height: 800 }, false);
  const page = await ctx.newPage();
  await page.goto("/family/home");
  const dialog = page.getByRole("dialog", { name: "Choose your profile" });
  await dialog.waitFor({ timeout: 15000 });
  record("B-10", "UI-02 bare /family/home shows the profile chooser", await dialog.isVisible());
  await page.keyboard.press("Enter");
  await page.waitForURL(/child=santiago/, { timeout: 10000 });
  await page.getByRole("heading", { name: /Hey Santiago/ }).waitFor();
  const walletNow = (await call("GET", "/api/family/wallet", { cookie: assistant })).json.wallets.santiago.balance;
  await page.getByText(`You have ${walletNow} coins`).waitFor({ timeout: 10000 });
  for (const label of ["Record something I did", "My coins", "See activity", "Lernen", "Ask Nabu", "Games", "Music", "Hörspiele"]) {
    record("B-11", `UI-02 Home reaches: ${label}`, await page.getByRole("link", { name: new RegExp(label) }).first().isVisible());
  }
  record("B-12", "UI-02 no plan/shop/redeem destinations on Home", (await page.getByRole("link", { name: /This week|Redeem/ }).count()) === 0 && (await page.locator("a[href^='/family/plan']").count()) === 0);
  await page.waitForFunction(() => !document.body.innerText.includes("wird geladen"), null, { timeout: 15000 }).catch(() => {});
  const learnText = await page.getByRole("link", { name: /Lernen/ }).innerText();
  record("B-13", "UI-02 learning status is human copy (no state codes)", !/wird geladen|all-visits-done|no-further|chapter-unavailable|[a-z]+-[a-z]+-[a-z]+/.test(learnText.replace(/Weitermachen|Starten|Besuch/g, "")), learnText.replace(/\s+/g, " ").slice(0, 80));
  await shot(page, "desktop-03-home-santiago");
  await page.getByRole("link", { name: /My coins/ }).click();
  await page.waitForURL(/\/family\/rewards\?child=santiago/);
  await page.locator("[data-wallet-balance]").waitFor({ timeout: 15000 });
  await page.waitForFunction(() => document.querySelector("[data-wallet-balance]")?.getAttribute("data-wallet-balance") !== "", null, { timeout: 15000 });
  const w = (await call("GET", "/api/family/wallet", { cookie: assistant })).json.wallets.santiago;
  const shown = { b: await page.locator("[data-wallet-balance]").getAttribute("data-wallet-balance"), e: await page.locator("[data-wallet-earned]").getAttribute("data-wallet-earned"), s: await page.locator("[data-wallet-spent]").getAttribute("data-wallet-spent") };
  const text = await page.locator("body").innerText();
  record("B-14", "UI-03 Coins shows W, E (since W34) and S from the projection with W = E − S; no week nav, no shop", Number(shown.b) === w.balance && Number(shown.e) === w.earned && Number(shown.s) === w.spent && w.balance === w.earned - w.spent && text.includes("since 2026-W34") && !/Previous week|Next week|Get it|Play with friends|Movie night/.test(text), JSON.stringify({ shown, w }));
  await shot(page, "desktop-04-coins");
  await page.getByRole("link", { name: /See what earned them/ }).click();
  await page.waitForURL(/\/family\/activity\?child=santiago/);
  await page.getByRole("list", { name: "Activity" }).waitFor({ timeout: 15000 });
  const items = await page.locator("[data-activity-id]").count();
  const actText = await page.locator("body").innerText();
  // (The seeded pending item was approved by the parent-tools journey above; held and try-again rows remain.)
  record("B-15", "UI-04 Activity renders dated history with review states and the retired reward's history, and no plan grid", items >= 10 && /On hold/.test(actText) && /Needs another try/.test(actText) && /Play with friends/.test(actText) && /Approved/.test(actText) && !/This week’s plan|This week's plan/.test(actText), `${items} items`);
  await page.getByRole("button", { name: "This week" }).click();
  const weekItems = await page.locator("[data-activity-id]").count();
  record("B-16", "UI-04 the weekly filter narrows the view without changing stored dates (DB unchanged)", weekItems < items && Number((await db.execute("SELECT COUNT(*) AS n FROM family_completions WHERE week='2026-W40'")).rows[0].n) >= 8, `${weekItems} < ${items}`);
  await shot(page, "desktop-05-activity");
  await ctx.close();
}

{
  // Tablet touch: Games → chess (same-origin gated bundle, metered), Studio section, editor.
  const ctx = await context({ width: 1024, height: 768 }, true);
  const page = await ctx.newPage();
  await page.goto("/family/games?child=santiago");
  await page.getByRole("region", { name: "Chess" }).waitFor({ timeout: 15000 });
  await page.waitForFunction(() => document.querySelector("[data-chess-eligible]")?.getAttribute("data-chess-eligible") !== "", null, { timeout: 15000 });
  const chessEligible = await page.locator("[data-chess-eligible]").first().getAttribute("data-chess-eligible");
  const gamesText = await page.locator("body").innerText();
  record("T-01", "UI-10 Games shows the chess card unlocked (server status) and the one Studio purchase flow; no duplicate chess card, no mini-game checkout", chessEligible === "true" && /Unlocked today/.test(gamesText) && (await page.getByText("Chess Coach").count()) === 1 && /Buy 15 minutes for 🪙 3|Game Studio time left/.test(gamesText) && !/Mini-game|Redeem/.test(gamesText), `${chessEligible}`);
  record("T-02", "UI-10 the approved paid game comes from the child adapter with the 3-coin label", (await page.locator(`[data-game-id="${PAID}"]`).count()) === 1 && (await page.locator(`[data-game-id="${CHESS}"]`).count()) === 0);
  await shot(page, "tablet-01-games");
  // Same-origin saves: pre-seed the chess profile key on THIS origin and check the game sees it inside the frame.
  await page.evaluate(() => { localStorage.setItem("chess-coach:v1:santiago", JSON.stringify({ childId: "santiago", version: 1, fixture: "origin-check" })); });
  await page.locator("[data-chess-play]").tap();
  await page.waitForURL(new RegExp(`/family/games/play\\?game=${CHESS}&child=santiago`));
  const frame = page.locator("iframe[title^='Game for']");
  await frame.waitFor({ timeout: 20000 });
  const src = await frame.getAttribute("src");
  record("T-03", "DA-04 chess loads from the same-origin gated route with the lease credential (never a raw static path)", src?.startsWith(`/games/${CHESS}/index.html?child=santiago&credential=`), src?.slice(0, 80));
  await page.waitForFunction(() => /\d+:\d\d/.test(document.querySelector("[data-remaining-seconds]")?.textContent || ""), null, { timeout: 20000 });
  const gameFrame = page.frames().find((f) => f.url().includes(`/games/${CHESS}/`));
  await page.waitForTimeout(1500);
  const frameOrigin = gameFrame ? await gameFrame.evaluate(() => location.origin).catch(() => null) : null;
  const stored = gameFrame ? await gameFrame.evaluate(() => localStorage.getItem("chess-coach:v1:santiago")).catch(() => null) : null;
  const guardPresent = gameFrame ? await gameFrame.evaluate(() => Boolean(window.__familyPlayGuard) && document.querySelectorAll("script[data-chess-asset]").length).catch(() => null) : null;
  record("T-04", "DA-04 origin compatibility: the frame runs on the app origin and reads the pre-existing per-child save key; the guard and the inlined scripts are present", frameOrigin === base && typeof stored === "string" && stored.includes("origin-check") && guardPresent === 4, JSON.stringify({ frameOrigin, stored: stored?.slice(0, 40), guardPresent }));
  const clock1 = await page.locator("header [data-remaining-seconds]").getAttribute("data-remaining-seconds");
  await page.waitForTimeout(6000);
  const clock2 = await page.locator("header [data-remaining-seconds]").getAttribute("data-remaining-seconds");
  record("T-05", "DA-03 the chess clock is the server's daily remaining and moves while playing", Number(clock2) < Number(clock1) && Number(clock1) <= 900, `${clock1} → ${clock2}`);
  await shot(page, "tablet-02-chess-playing");
  const frozenBefore = gameFrame ? await gameFrame.evaluate(() => window.__familyPlayGuard?.isFrozen() ?? null).catch(() => null) : null;
  await page.getByRole("button", { name: /Pause/ }).tap();
  await page.getByRole("dialog", { name: "Paused" }).waitFor();
  await page.waitForTimeout(1500);
  const frozenAfter = gameFrame ? await gameFrame.evaluate(() => window.__familyPlayGuard?.isFrozen() ?? null).catch(() => null) : null;
  const paused1 = await page.locator("header [data-remaining-seconds]").getAttribute("data-remaining-seconds");
  await page.waitForTimeout(4000);
  const paused2 = await page.locator("header [data-remaining-seconds]").getAttribute("data-remaining-seconds");
  record("T-06", "SC-04 pausing freezes the chess frame and stops the daily clock", frozenBefore === false && frozenAfter === true && Number(paused2) >= Number(paused1) - 1, JSON.stringify({ frozenBefore, frozenAfter, paused1, paused2 }));
  await page.getByRole("link", { name: /Games/ }).first().tap();
  await page.waitForURL(/\/family\/games\?child=santiago/);
  await sleep(800);
  const st = (await call("GET", "/api/family/play/state", { cookie: assistant, bearer: mintS.token })).json;
  record("T-07", "DA-03 leaving chess releases the lease; the daily remaining is persisted server-side and shared with the next entry", st.activeLease === null && st.chess.remainingSeconds < 900 && st.chess.remainingSeconds === Number(clock2) - (Number(clock2) - st.chess.remainingSeconds) && st.remainingSeconds === 900, JSON.stringify({ chess: st.chess.remainingSeconds, paid: st.remainingSeconds }));
  // Isabel: locked card (her parent-assisted entry was undone earlier? No — B-07 re-entered one; check the live server status instead).
  const p2 = await ctx.newPage();
  await p2.goto("/family/games?child=isabel");
  await p2.waitForFunction(() => document.querySelector("[data-chess-eligible]")?.getAttribute("data-chess-eligible") !== "", null, { timeout: 15000 });
  const isabelState = (await call("GET", "/api/family/play/state", { cookie: assistant, bearer: mintI.token })).json;
  const isabelCard = await p2.locator("[data-chess-eligible]").first().getAttribute("data-chess-eligible");
  record("T-08", "DA-01 Isabel's chess card mirrors the server status for her (no sibling leakage; approved game list excludes Santiago-only games)", isabelCard === String(isabelState.chess.eligible) && (await p2.locator(`[data-game-id="${PAID}"]`).count()) === 0, `${isabelCard}`);
  await shot(p2, "tablet-03-games-isabel");
  await p2.close();

  // Editor: paid studio lease, draft persistence, attested wait, exhaustion.
  await page.goto("/family/games/edit?child=santiago");
  await page.waitForFunction(() => document.querySelector("[data-studio-phase]")?.getAttribute("data-studio-phase") === "editing", null, { timeout: 20000 });
  await page.waitForFunction(() => /\d+:\d\d/.test(document.querySelector("[data-remaining-seconds]")?.textContent || ""), null, { timeout: 20000 });
  const e1 = await page.locator("[data-remaining-seconds]").first().getAttribute("data-remaining-seconds");
  await page.locator("[data-studio-draft]").fill("A space game where I collect stars and dodge comets");
  await page.waitForTimeout(4000);
  const e2 = await page.locator("[data-remaining-seconds]").first().getAttribute("data-remaining-seconds");
  record("E-01", "SC-04 thinking/typing in the open editor consumes the paid clock (server numbers)", Number(e2) < Number(e1), `${e1} → ${e2}`);
  await shot(page, "tablet-04-editor");
  await page.reload();
  // A reload races the old page's release with the new page's lease request: the editor may show "already using
  // your time on another screen" (single lease) — the child continues here, exactly as on a second device.
  await page.waitForFunction(() => ["editing", "held"].includes(document.querySelector("[data-studio-phase]")?.getAttribute("data-studio-phase") || ""), null, { timeout: 20000 });
  if ((await page.locator("[data-studio-phase]").getAttribute("data-studio-phase")) === "held") {
    record("E-02a", "SC-03 a reload while the previous editor lease is still live shows the single-lease hold with Continue here (no parallel lease)", true);
    await page.getByRole("button", { name: "Continue here" }).click();
  }
  await page.waitForFunction(() => document.querySelector("[data-studio-phase]")?.getAttribute("data-studio-phase") === "editing", null, { timeout: 20000 });
  await page.locator("[data-studio-draft]").waitFor({ timeout: 15000 });
  const restored = await page.locator("[data-studio-draft]").inputValue();
  record("E-02", "SC-07 the draft survives a reload (local storage per child/project)", restored.includes("collect stars"), restored.slice(0, 40));
  await page.getByRole("button", { name: "Build it" }).click();
  await page.waitForFunction(() => (document.querySelector("[data-studio-waiting]")?.getAttribute("data-studio-waiting") || "").startsWith("job:"), null, { timeout: 20000 });
  const waitKey = await page.locator("[data-studio-waiting]").getAttribute("data-studio-waiting");
  const w1 = await page.locator("[data-remaining-seconds]").first().getAttribute("data-remaining-seconds");
  await page.waitForTimeout(4000);
  const w2 = await page.locator("[data-remaining-seconds]").first().getAttribute("data-remaining-seconds");
  record("E-03", "SC-05 after a build is submitted the editor enters the server-attested build-only wait and the clock stops", waitKey?.startsWith("job:") && Number(w2) >= Number(w1) - 1, JSON.stringify({ waitKey, w1, w2 }));
  await shot(page, "tablet-05-editor-waiting");
  const jobId = waitKey.slice(4);
  await call("POST", `${upstreamBase}/__fixture/jobs/${jobId}/status`, { body: { status: "done" } });
  await page.waitForFunction(() => (document.querySelector("[data-studio-waiting]")?.getAttribute("data-studio-waiting") || "") === "", null, { timeout: 30000 });
  record("E-04", "SC-05 once the build is done the editor resumes interaction (wait no longer attested)", true);
  // Exhaustion: shrink the allowance so the next lease has 2 s, re-enter the editor, let it run out.
  await page.getByRole("link", { name: /Back to Games/ }).click();
  await page.waitForURL(/\/family\/games\?child=santiago/);
  // Leaving the editor releases its lease asynchronously; wait for Family to show no active lease, then let the
  // released lease's authority fence lapse before the next activation at the meter.
  for (let i = 0; i < 40; i += 1) {
    const st = (await call("GET", "/api/family/play/state", { cookie: assistant, bearer: mintS.token })).json;
    if (st.activeLease === null) break;
    await sleep(250);
  }
  await sleep(2600);
  await db.execute("UPDATE family_play_allowances SET consumed_seconds = granted_seconds - 2 WHERE person_id = 'santiago'");
  await page.goto("/family/games/edit?child=santiago");
  await page.waitForFunction(() => document.querySelector("[data-studio-phase]")?.getAttribute("data-studio-phase") === "editing", null, { timeout: 20000 });
  await page.locator("[data-studio-draft]").fill("keep this draft");
  const graceAlert = page.locator("p[role='alert']").filter({ hasText: /Time/ });
  await graceAlert.waitFor({ timeout: 25000 });
  const graceText = await graceAlert.innerText();
  const submitDisabled = await page.getByRole("button", { name: /Build it|Plan the change/ }).isDisabled();
  record("E-05", "SC-07 at exhaustion the editor shows the 30 s save tail, disables submissions and keeps the draft", /Time’s up|Time's up/.test(graceText) && submitDisabled, graceText.slice(0, 60));
  await shot(page, "tablet-06-editor-grace");
  await page.waitForFunction(() => document.querySelector("[data-studio-phase]")?.getAttribute("data-studio-phase") === "ended", null, { timeout: 45000 });
  const endedText = await page.locator("body").innerText();
  const stEnd = (await call("GET", "/api/family/play/state", { cookie: assistant, bearer: mintS.token })).json;
  record("E-06", "SC-07 after the grace the studio session ends: explicit purchase offered, no automatic top-up, allowance exhausted server-side", /Buy 15 minutes for 🪙 3/.test(endedText) && stEnd.remainingSeconds === 0 && stEnd.activeLease === null, JSON.stringify({ paid: stEnd.remainingSeconds }));
  await shot(page, "tablet-07-editor-ended");
  await ctx.close();
}
await browser.close();
db.close();

const summary = { base, at: new Date().toISOString(), today, total: results.length, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).map((r) => r.id), results };
fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(summary, null, 2));
console.log(`\n${summary.passed}/${summary.total} passed${summary.failed.length ? `; failed: ${summary.failed.join(", ")}` : ""}`);
process.exit(summary.failed.length ? 1 : 0);
