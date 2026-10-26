// LK01 (planner, October 26 17:08): prompt versus ticket refresh, on the REAL clock with the REAL Family app binary
// (headless, isolated HOME, muted). Link 1 is issued; the page refreshes at 40 s (link 2); the browser's confirmation
// is answered at 50 s and the app starts COLD with link 1. It must attach with that one link (link 2 is then
// cancelled). Also: a link older than its 60 s is refused, and never more than two links of a lease are valid.
// Game Studio child adapter CANDIDATE + real Family persistence (isolated SQLite).
//   node scripts/verify-native-link-refresh.mjs --adapter <child-play-adapter.mjs> --app "<Deimos Rising Family.app>" --out <dir>
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@libsql/client";
import { ensurePlayTables, issuePlayLease, readLeaseStatusForMeter, settlePlayLease } from "../src/lib/family-play-db.ts";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const mod = await import(opt("--adapter"));
const appPath = opt("--app");
const out = opt("--out", "/tmp/deimos-lk01");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "adapter"), { recursive: true });
fs.mkdirSync(path.join(out, "home"), { recursive: true });
fs.writeFileSync(path.join(out, "adapter", "approvals.json"), JSON.stringify({ version: 1, approvals: [{ gameId: "deimos-rising", children: ["santiago", "isabel"] }] }));
const ORIGIN = "https://app.example.test";
const key = mod.derivePlayKey("lk01-native-secret-0123456789-0123456789-01");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const db = createClient({ url: `file:${path.join(out, "family.sqlite")}` });
await db.execute("CREATE TABLE family_completions (person_id TEXT NOT NULL, routine_id TEXT NOT NULL, week TEXT NOT NULL, day INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'done', note TEXT, challenge TEXT, created_at TEXT NOT NULL, reviewed_at TEXT, credit_count INTEGER NOT NULL DEFAULT 1, awarded_points INTEGER, normalized_summary TEXT, approval_source TEXT, PRIMARY KEY (person_id, routine_id, week, day))");
await db.execute("CREATE TABLE family_reward_redemptions (id TEXT PRIMARY KEY, person_id TEXT, reward_id TEXT, week TEXT, created_at TEXT, charged_points INTEGER)");
await ensurePlayTables(db);
for (const p of ["santiago", "isabel"]) await db.execute({ sql: "INSERT INTO family_play_allowances VALUES (?, 900, 0, ?)", args: [p, new Date().toISOString()] });
const issue = async (person, lid) => { const r = await issuePlayLease({ personId: person, gameId: "deimos-rising", mode: "play", leaseId: lid, takeover: true, deviceLabel: "computer", now: new Date() }, db); if (!r.ok) throw new Error(JSON.stringify(r)); };
const server = mod.createChildPlayAdapter({
  key, dataDir: path.join(out, "adapter"), upstreamOrigin: "http://127.0.0.1:9", allowedOrigin: ORIGIN, settleBase: "http://127.0.0.1:1", log: () => {},
  localAddresses: () => new Set(["127.0.0.1", "::1"]),
  fetchImpl: async (url, options) => {
    const id = new URL(url).pathname.split("/").at(-2);
    if (url.endsWith("/status")) { const s = await readLeaseStatusForMeter(id, new Date(), db); return Response.json(s ?? { error: "not-found" }, { status: s ? 200 : 404 }); }
    return Response.json(await settlePlayLease({ ...JSON.parse(options.body), now: new Date() }, db));
  },
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const call = (method, p, headers, body) => new Promise((resolve, reject) => {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const req = http.request({ hostname: "127.0.0.1", port, path: p, method, agent: false, headers: { ...headers, ...(payload ? { "content-type": "application/json", "content-length": String(payload.length) } : {}) } }, (res) => {
    let b = "";
    res.on("data", (c) => (b += c));
    res.on("end", () => { let json = null; try { json = JSON.parse(b); } catch { json = null; } resolve({ status: res.statusCode, json }); });
  });
  req.on("error", reject);
  req.end(payload ?? undefined);
});
const cred = (sub, lid) => { const n = Math.floor(Date.now() / 1000); return mod.mintPlayCredential(key, { sub, scope: "lease", gid: "deimos-rising", lid, mode: "play", metered: true, budget: 900, iat: n, exp: n + 1200, jti: `${lid}-${Math.random().toString(36).slice(2, 8)}` }); };
const ticket = (lid, token) => call("POST", `/v1/native/${lid}/ticket`, { origin: ORIGIN, authorization: `Bearer ${token}` }, {});
const ticketValue = (r) => /ticket=(.+)$/.exec(String(r.json?.launchUrl ?? ""))?.[1] ?? "";
const redeem = (value) => call("POST", "/v1/native/redeem", {}, { ticket: value, gameId: "deimos-rising" });

const obs = {};
try {
  // Link 1 and, on another child's lease, a link left to expire.
  await issue("santiago", "lease-lk01-cold");
  await issue("isabel", "lease-lk01-expire");
  const tokCold = cred("santiago", "lease-lk01-cold");
  const link1 = await ticket("lease-lk01-cold", tokCold);
  const expiring = await ticket("lease-lk01-expire", cred("isabel", "lease-lk01-expire"));
  const issuedAt = Date.now();
  obs.ticketTtlMs = Number(link1.json?.expiresInMs);
  // The page's 40 s refresh while the browser's confirmation is still open.
  await sleep(40_000);
  const link2 = await ticket("lease-lk01-cold", tokCold);
  // The child confirms at 50 s: the app starts cold with link 1, waits at its menu for 10 s, quits.
  await sleep(Math.max(0, issuedAt + 50_000 - Date.now()));
  fs.writeFileSync(path.join(out, "s.script"), ["30 window focus", "630 quit", ""].join("\n"));
  const child = spawn(path.join(appPath, "Contents", "MacOS", "Deimos Rising Family"), ["--studio-origin", `http://127.0.0.1:${port}`, "--studio-url", link1.json.launchUrl, "--script", path.join(out, "s.script"), "--mute"], {
    env: { PATH: process.env.PATH, HOME: path.join(out, "home"), SDL_VIDEO_DRIVER: "dummy", SDL_RENDER_DRIVER: "software", SDL_AUDIO_DRIVER: "dummy" },
    stdio: ["ignore", "ignore", "ignore"],
  });
  let attachedAt = null;
  const watch = setInterval(() => { const l = server.store.loadLease("lease-lk01-cold"); if (attachedAt === null && l && l.lastTickAt) attachedAt = Date.now() - issuedAt; }, 100);
  await new Promise((r) => child.on("exit", r));
  clearInterval(watch);
  await server.settler.flush().catch(() => {});
  const lease = server.store.loadLease("lease-lk01-cold");
  const link2After = await redeem(ticketValue(link2));
  const log = fs.readFileSync(path.join(out, "home", "Library", "Application Support", "Deimos Rising Family", "DeimosRising.log"), "utf8");
  obs.attachedAtMsAfterIssue = attachedAt;
  obs.clickedTicketSurvivedRefresh = attachedAt !== null && attachedAt > 50_000 && Boolean(link2.json?.launchUrl);
  obs.coldLaunchAttachedWithOneLink = attachedAt !== null && (log.match(/Studio: launch link received/g) || []).length === 1 && link2After.status === 410;
  obs.appLeaseEnd = lease ? `${lease.state}/${lease.endReason}/${lease.consumed}` : null;
  obs.link2AfterAttachStatus = link2After.status;
  // A link older than its promised 60 s is refused.
  await sleep(Math.max(0, issuedAt + 61_000 - Date.now()));
  const expired = await redeem(ticketValue(expiring));
  obs.expiredTicketRefused = expired.status === 410;
  // Never more than two valid links per lease: of three issued in a row, the oldest is gone, the middle one works.
  await issue("santiago", "lease-lk01-three");
  const tok3 = cred("santiago", "lease-lk01-three");
  const a = ticketValue(await ticket("lease-lk01-three", tok3));
  const b = ticketValue(await ticket("lease-lk01-three", tok3));
  const c = ticketValue(await ticket("lease-lk01-three", tok3));
  const rb = await redeem(b);
  const ra = await redeem(a);
  const rc = await redeem(c);
  obs.maxOutstandingTicketsPerLease = rb.status === 200 && ra.status === 410 && rc.status === 410 ? 2 : -1;
  obs.threeLinkStatuses = [ra.status, rb.status, rc.status].join(",");
} finally {
  server.settler.stop();
  await new Promise((r) => server.close(r));
  db.close();
}
fs.writeFileSync(path.join(out, "lk01.json"), `${JSON.stringify(obs, null, 2)}\n`);
console.log(JSON.stringify({ LK01: obs }));
