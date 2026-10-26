// AR08 / AR09 (planner, October 26 17:08): native renewal on the REAL clock. The real Family app binary (headless,
// isolated HOME, muted, god + autoplay test hooks) plays level 1 against the Game Studio child adapter CANDIDATE and the
// REAL Family persistence (readLeaseStatusForMeter / settlePlayLease on an isolated SQLite file). Every Family answer is
// delayed by a real wait — half before Family reads, half after, as on a network — with the production 2 s window.
//   AR08: constant 300, 450, 600, 900, 1,200 ms, and an outage beyond the window during play.
//   AR09: the 27 signed-read times measured in the failed real session (October 26, 15:46-15:53), in order, cycled.
//   AR11: continuity headroom at 600 and 900 ms with the unchanged 2 s window and the app's own 800 ms cadence.
// Evidence per run (October 26, AR11): the ENGINE's own frames — DR_TRACE writes one TRACE line per processed gameplay
// frame; the game processes one frame per main-loop frame and its frame limiter paces the loop at the game's 30 fps;
// script marks at ticks 1,500 and 2,900 of the 60 Hz clock bound 23.3 s (~700 frames). The loop's own pacing can lose
// a frame without any Family involvement, so the reference is MEASURED in the same harness run: the identical script
// and level on the standalone build (no Family gate at all), three times; a run's frozen frames are its shortfall
// against the lowest gate-free count. Raw counts are kept; every report through a pass-through proxy between app and meter (arrival ~ the app's send, answer
// time, grant handed, the app's resulting deadline, the meter's window at that moment); every Family read (sent,
// answered, applied — the meter's authority changing).
// Per run, from the meter's own sessions: play span, share that ran, freezes, billing balance (meter = delivered
// observations, Family = ceil(meter), remaining = 900 - Family), and no observed time past any handed deadline.
//   node scripts/verify-native-renewal-realclock.mjs --adapter <child-play-adapter.mjs> --app "<Deimos Rising Family.app>"
//        --live-measurement <live-measurement-parent-20261026.json> --standalone "<Deimos Rising.app>" --out <dir> [--only <name>]
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@libsql/client";
import { ensurePlayTables, issuePlayLease, readLeaseStatusForMeter, settlePlayLease } from "../src/lib/family-play-db.ts";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const adapterPath = opt("--adapter");
const appPath = opt("--app");
const livePath = opt("--live-measurement");
const standalonePath = opt("--standalone");
const out = opt("--out", "/tmp/deimos-realclock");
const only = opt("--only", null);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const mod = await import(adapterPath);
const ORIGIN = "https://app.example.test";
const key = mod.derivePlayKey("realclock-native-secret-0123456789-0123456789");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const live = JSON.parse(fs.readFileSync(livePath, "utf8"));
const realDelays = live.samples.map((x) => x.signedMs);
if (realDelays.length !== 27) throw new Error(`expected 27 live samples, found ${realDelays.length}`);

const SCRIPT = ["30 window focus", "900 char 13", "1500 mark a", "2900 mark b", "3000 keydown 0x01", "3090 keyup 0x01", "3180 quit", ""].join("\n");
const traceBetweenMarks = (logFile) => {
  const lines = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").split("\n") : [];
  const a = lines.findIndex((x) => x === "MARK a");
  const b = lines.findIndex((x) => x === "MARK b");
  return { levelBeforeMarkA: a > 0 && lines.slice(0, a).some((x) => /Level 1 started/.test(x)), between: a >= 0 && b > a ? lines.slice(a, b).filter((x) => x.startsWith("TRACE ")).length : null, total: lines.filter((x) => x.startsWith("TRACE ")).length };
};
/** Gate-free reference: the standalone build plays the same script and level (no meter, no Family). */
async function controlRun(k) {
  const dir = path.join(out, `control-${k}`);
  fs.mkdirSync(path.join(dir, "home"), { recursive: true });
  fs.writeFileSync(path.join(dir, "s.script"), SCRIPT);
  const child = spawn(path.join(standalonePath, "Contents", "MacOS", "Deimos Rising"), ["--script", path.join(dir, "s.script"), "--mute"], {
    env: { PATH: process.env.PATH, HOME: path.join(dir, "home"), SDL_VIDEO_DRIVER: "dummy", SDL_RENDER_DRIVER: "software", SDL_AUDIO_DRIVER: "dummy", DR_GOD: "1", DR_AUTOPLAY: "1", DR_TRACE: "1" },
    stdio: ["ignore", "ignore", "ignore"],
  });
  await new Promise((r) => child.on("exit", r));
  return traceBetweenMarks(path.join(dir, "home", "Library", "Application Support", "Deimos Rising", "DeimosRising.log"));
}
const controls = [];
for (let k = 0; k < 3; k += 1) controls.push(await controlRun(k));
const controlMin = Math.min(...controls.map((c) => (c.between === null ? Infinity : c.between)));
if (!Number.isFinite(controlMin) || !controls.every((c) => c.levelBeforeMarkA)) throw new Error(`gate-free reference failed: ${JSON.stringify(controls)}`);

async function runOnce(name, { delayFor, outageFromMs = null, outageForMs = 0 }) {
  const dir = path.join(out, name);
  fs.mkdirSync(path.join(dir, "adapter"), { recursive: true });
  fs.mkdirSync(path.join(dir, "home"), { recursive: true });
  fs.writeFileSync(path.join(dir, "adapter", "approvals.json"), JSON.stringify({ version: 1, approvals: [{ gameId: "deimos-rising", children: ["santiago"] }] }));
  const db = createClient({ url: `file:${path.join(dir, "family.sqlite")}` });
  await db.execute("CREATE TABLE family_completions (person_id TEXT NOT NULL, routine_id TEXT NOT NULL, week TEXT NOT NULL, day INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'done', note TEXT, challenge TEXT, created_at TEXT NOT NULL, reviewed_at TEXT, credit_count INTEGER NOT NULL DEFAULT 1, awarded_points INTEGER, normalized_summary TEXT, approval_source TEXT, PRIMARY KEY (person_id, routine_id, week, day))");
  await db.execute("CREATE TABLE family_reward_redemptions (id TEXT PRIMARY KEY, person_id TEXT, reward_id TEXT, week TEXT, created_at TEXT, charged_points INTEGER)");
  await ensurePlayTables(db);
  await db.execute({ sql: "INSERT INTO family_play_allowances VALUES ('santiago', 900, 0, ?)", args: [new Date().toISOString()] });
  const lid = `lease-realclock-${name}`;
  const issued = await issuePlayLease({ personId: "santiago", gameId: "deimos-rising", mode: "play", leaseId: lid, takeover: true, deviceLabel: "computer", now: new Date() }, db);
  if (!issued.ok) throw new Error(JSON.stringify(issued));
  let started = 0;
  let outage = false;
  const reads = [];
  const reports = [];
  const applied = [];
  const server = mod.createChildPlayAdapter({
    key, dataDir: path.join(dir, "adapter"), upstreamOrigin: "http://127.0.0.1:9", allowedOrigin: ORIGIN, settleBase: "http://127.0.0.1:1", log: () => {},
    fetchImpl: async (url, options) => {
      if (outage) throw new Error("isolated outage");
      const i = reads.length;
      const d = delayFor(i);
      const entry = { i, at: started ? Date.now() - started : null, delayMs: d, sentAt: Date.now() };
      reads.push(entry);
      await sleep(Math.floor(d / 2));
      const id = new URL(url).pathname.split("/").at(-2);
      let res;
      if (url.endsWith("/status")) {
        const snapshot = await readLeaseStatusForMeter(id, new Date(), db);
        res = Response.json(snapshot ?? { error: "not-found" }, { status: snapshot ? 200 : 404 });
      } else {
        const body = JSON.parse(options.body);
        entry.settlement = true;
        res = Response.json(await settlePlayLease({ ...body, now: new Date() }, db));
      }
      await sleep(d - Math.floor(d / 2));
      entry.respondedAt = Date.now();
      return res;
    },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  // Pass-through proxy between the app and the meter: timestamps every report and its answer.
  const proxy = http.createServer((req, res) => {
    const receivedAt = Date.now();
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const up = http.request({ hostname: "127.0.0.1", port, path: req.url, method: req.method, headers: req.headers, agent: false }, (r) => {
        const out = [];
        r.on("data", (c) => out.push(c));
        r.on("end", () => {
          const text = Buffer.concat(out);
          const repliedAt = Date.now();
          if (/\/v1\/play\/[^/]+\/tick$/.test(req.url || "")) {
            let json = null;
            try { json = JSON.parse(String(text)); } catch { json = null; }
            const grant = json && typeof json.authorizedForMs === "number" ? json.authorizedForMs : 0;
            const l = server.store.loadLease(lid);
            reports.push({ receivedAt, repliedAt, status: r.statusCode, grantMs: grant, appDeadline: grant > 0 ? receivedAt + grant : null, meterWindowEnd: l && typeof l.authorityUntil === "number" ? l.authorityUntil : null });
          }
          res.writeHead(r.statusCode, r.headers);
          res.end(text);
        });
      });
      up.on("error", () => { res.writeHead(502); res.end(); });
      up.end(body);
    });
  });
  await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
  const proxyPort = proxy.address().port;
  // The meter applying a Family answer = its authority window moving (polled every 2 ms).
  let lastWindow = null;
  const poller = setInterval(() => { const l = server.store.loadLease(lid); const w = l && typeof l.authorityUntil === "number" ? l.authorityUntil : null; if (w !== lastWindow) { applied.push({ at: Date.now(), windowEnd: w }); lastWindow = w; } }, 2);
  const nowSec = Math.floor(Date.now() / 1000);
  const token = mod.mintPlayCredential(key, { sub: "santiago", scope: "lease", gid: "deimos-rising", lid, mode: "play", metered: true, budget: 900, iat: nowSec, exp: nowSec + 1200, jti: name });
  const ticket = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: `/v1/native/${lid}/ticket`, method: "POST", headers: { origin: ORIGIN, authorization: `Bearer ${token}`, "content-type": "application/json", "content-length": "2" } }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(b) }));
    });
    req.on("error", reject);
    req.end("{}");
  });
  if (ticket.status !== 201) throw new Error(`ticket ${ticket.status} ${JSON.stringify(ticket.json)}`);
  // Game clock (60 Hz script ticks): Enter at 15 s, autoplay plays level 1 until Esc at 50 s, quit at 53 s.
  fs.writeFileSync(path.join(dir, "s.script"), SCRIPT);
  const exe = path.join(appPath, "Contents", "MacOS", "Deimos Rising Family");
  started = Date.now();
  const child = spawn(exe, ["--studio-origin", `http://127.0.0.1:${proxyPort}`, "--studio-url", ticket.json.launchUrl, "--script", path.join(dir, "s.script"), "--mute"], {
    env: { PATH: process.env.PATH, HOME: path.join(dir, "home"), SDL_VIDEO_DRIVER: "dummy", SDL_RENDER_DRIVER: "software", SDL_AUDIO_DRIVER: "dummy", DR_GOD: "1", DR_AUTOPLAY: "1", DR_TRACE: "1" },
    stdio: ["ignore", "ignore", "ignore"],
  });
  let consumedAtOutage = null;
  let deadlineBeforeOutage = null;
  let outageStartedAt = null;
  let consumedAtOutageEnd = null;
  if (outageFromMs !== null) {
    void (async () => {
      await sleep(outageFromMs);
      const l = server.store.loadLease(lid);
      consumedAtOutage = l ? l.consumed : null;
      deadlineBeforeOutage = l ? l.frameDeadline ?? null : null;
      outageStartedAt = Date.now();
      outage = true;
      await sleep(outageForMs);
      const e = server.store.loadLease(lid);
      consumedAtOutageEnd = e ? e.consumed : null;
      outage = false;
    })();
  }
  await new Promise((r) => child.on("exit", r));
  await sleep(500);
  outage = false;
  await server.settler.flush().catch(() => {});
  await sleep(300);
  await server.settler.flush().catch(() => {});
  const lease = server.store.loadLease(lid);
  clearInterval(poller);
  server.settler.stop();
  await new Promise((r) => server.close(r));
  await new Promise((r) => proxy.close(r));
  // The engine's own record: gameplay frames between the two marks (1,400 main-loop frames apart), and in total.
  const traced = traceBetweenMarks(path.join(dir, "home", "Library", "Application Support", "Deimos Rising Family", "DeimosRising.log"));
  const levelBeforeMarkA = traced.levelBeforeMarkA;
  const tracedBetweenMarks = traced.between;
  const tracedTotal = traced.total;
  const fam = (await db.execute({ sql: "SELECT consumed_seconds, final_settled FROM family_play_leases WHERE id = ?", args: [lid] })).rows[0];
  const remaining = Number((await db.execute("SELECT granted_seconds - consumed_seconds AS r FROM family_play_allowances WHERE person_id = 'santiago'")).rows[0].r);
  db.close();
  const sessions = lease ? [...(lease.closedSessions || []), ...(lease.session ? [lease.session] : [])].map((x) => {
    const grants = Object.values(x.grants || {});
    return { start: Math.min(...grants.map((g) => g.issuedAt)), lastDeadline: Math.max(...grants.map((g) => g.deadline)), observed: x.observed || 0 };
  }).filter((x) => Number.isFinite(x.start)).sort((a, b) => a.start - b.start) : [];
  const ran = sessions.reduce((n, x) => n + x.observed, 0);
  const span = sessions.length ? (sessions.at(-1).start + sessions.at(-1).observed * 1000 - sessions[0].start) / 1000 : 0;
  const familyConsumed = Number(fam.consumed_seconds);
  // Reports during play: did each answer's grant reach the app before the deadline it already held?
  const playFrom = sessions.length ? sessions[0].start : Infinity;
  const playTo = sessions.length ? sessions.at(-1).start + sessions.at(-1).observed * 1000 : -Infinity;
  const inPlay = reports.filter((r) => r.receivedAt >= playFrom - 1000 && r.receivedAt <= playTo);
  let minMarginMs = null;
  let lateGrants = 0;
  for (let k = 1; k < inPlay.length; k += 1) {
    const prev = inPlay[k - 1];
    if (prev.appDeadline === null) continue;
    const margin = prev.appDeadline - inPlay[k].repliedAt;
    if (minMarginMs === null || margin < minMarginMs) minMarginMs = margin;
    if (margin < 0) lateGrants += 1;
  }
  const grantsPastWindow = reports.filter((r) => r.appDeadline !== null && (r.meterWindowEnd === null || r.appDeadline > r.meterWindowEnd + 1)).length;
  const gaps = reports.slice(1).map((r, k) => r.receivedAt - reports[k].receivedAt).filter((g) => g > 0).sort((a, b) => a - b);
  const statusReadsInPlay = reads.filter((r) => !r.settlement && sessions.length && r.at !== null && started + r.at >= sessions[0].start && started + r.at <= sessions.at(-1).start + sessions.at(-1).observed * 1000);
  const result = {
    name,
    exitCode: child.exitCode,
    playSpanSeconds: Math.round(span * 10) / 10,
    ranSeconds: Math.round(ran * 100) / 100,
    runShare: span > 0 ? Math.round((ran / span) * 1000) / 1000 : 0,
    freezes: Math.max(0, sessions.length - 1),
    meterConsumed: lease ? Math.round(lease.consumed * 1000) / 1000 : null,
    familyConsumed,
    familyFinalSettled: Number(fam.final_settled) === 1,
    remaining,
    billedMatchesObserved: lease !== null && Math.abs(lease.consumed - ran) <= 0.01 && familyConsumed === Math.ceil(lease.consumed - 1e-9) && remaining === 900 - familyConsumed && Number(fam.final_settled) === 1,
    // Each session's observed time fits inside the grants handed for it (issue of its first grant .. its last deadline).
    neverCountedPastDeadline: sessions.every((x) => x.observed * 1000 <= x.lastDeadline - x.start + 50),
    statusReads: reads.filter((r) => !r.settlement).length,
    statusReadsDuringPlay: statusReadsInPlay.length,
    firstInPlayReadIndex: statusReadsInPlay.length ? statusReadsInPlay[0].i : null,
    delaysUsedInPlay: statusReadsInPlay.map((r) => r.delayMs),
    engine: { levelBeforeMarkA, ticksBetweenMarks: 1400, gateFreeReferenceFrames: controlMin, tracedBetweenMarks, frozenFramesBetweenMarks: tracedBetweenMarks === null ? null : Math.max(0, controlMin - tracedBetweenMarks), tracedTotal, engineRanSeconds: Math.round((tracedTotal / 30) * 100) / 100 },
    reportsTotal: reports.length,
    reportsInPlay: inPlay.length,
    reportCadenceMedianMs: gaps.length ? gaps[Math.floor(gaps.length / 2)] : null,
    nextGrantMinMarginMs: minMarginMs,
    grantsReachingAppAfterDeadline: lateGrants,
    grantsPastMeterWindow: grantsPastWindow,
    familyReadsTimeline: reads.filter((r) => !r.settlement).map((r) => ({ sentAt: r.sentAt - started, respondedAt: (r.respondedAt ?? 0) - started, delayMs: r.delayMs })),
    authorityAppliedTimeline: applied.map((a) => ({ at: a.at - started, windowEnd: a.windowEnd === null ? null : a.windowEnd - started })),
    reportsTimeline: reports.map((r) => ({ receivedAt: r.receivedAt - started, repliedAt: r.repliedAt - started, status: r.status, grantMs: r.grantMs, appDeadline: r.appDeadline === null ? null : r.appDeadline - started, meterWindowEnd: r.meterWindowEnd === null ? null : r.meterWindowEnd - started })),
  };
  if (outageFromMs !== null) {
    // Counted DURING the outage (meter snapshots at its start and end) may not exceed what the deadline handed before
    // it still covered; no play session may open while Family is unreachable. Play after the outage is ordinary play.
    const duringOutage = consumedAtOutage !== null && consumedAtOutageEnd !== null ? consumedAtOutageEnd - consumedAtOutage : null;
    const allowedDuringOutage = deadlineBeforeOutage !== null && outageStartedAt !== null ? Math.max(0, deadlineBeforeOutage - outageStartedAt) / 1000 : 0;
    const resumedInOutage = sessions.some((x) => x.start > outageStartedAt && x.start < outageStartedAt + outageForMs);
    Object.assign(result, { consumedAtOutage, consumedAtOutageEnd, countedDuringOutage: duringOutage, allowedByHandedDeadline: allowedDuringOutage, resumedDuringOutage: resumedInOutage, outagePausedSafely: duringOutage !== null && duringOutage <= allowedDuringOutage + 0.05 && !resumedInOutage });
  }
  fs.writeFileSync(path.join(dir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.error(JSON.stringify({ ...result, delaysUsedInPlay: undefined, familyReadsTimeline: undefined, authorityAppliedTimeline: undefined, reportsTimeline: undefined }));
  return result;
}

const runs = [];
const plan = [
  ["c300", { delayFor: () => 300 }],
  ["c450", { delayFor: () => 450 }],
  ["c600", { delayFor: () => 600 }],
  ["c900", { delayFor: () => 900 }],
  ["c1200", { delayFor: () => 1200 }],
  // Outage beyond the window, during play (game clock: play starts ~15-18 s after launch).
  ["outage", { delayFor: () => 150, outageFromMs: 30_000, outageForMs: 8_000 }],
  // The 27 measured signed-read times, in order, cycled over every Family request.
  ["replay27", { delayFor: (i) => realDelays[i % realDelays.length] }],
];
for (const [name, cfg] of plan) if (!only || only === name) runs.push(await runOnce(name, cfg));
const by = Object.fromEntries(runs.map((r) => [r.name, r]));
const constant = ["c300", "c450", "c600", "c900", "c1200"].filter((n) => by[n]);
const replay = by.replay27;
const summary = {
  AR08: {
    delaysMeasured: constant.map((n) => n.slice(1)).join(","),
    zeroFreezesAt300: by.c300 ? by.c300.freezes === 0 && by.c300.playSpanSeconds > 20 : null,
    zeroFreezesAt450: by.c450 ? by.c450.freezes === 0 && by.c450.playSpanSeconds > 20 : null,
    billedMatchesObservedAllDelays: constant.every((n) => by[n].billedMatchesObserved),
    neverCountedPastDeadline: [...constant, "outage"].filter((n) => by[n]).every((n) => by[n].neverCountedPastDeadline),
    outagePausedSafely: by.outage ? by.outage.outagePausedSafely === true && by.outage.billedMatchesObserved : null,
    perDelay: JSON.stringify(Object.fromEntries([...constant, "outage"].filter((n) => by[n]).map((n) => [n, { runShare: by[n].runShare, freezes: by[n].freezes, playSpanSeconds: by[n].playSpanSeconds, meterConsumed: by[n].meterConsumed, familyConsumed: by[n].familyConsumed }]))),
  },
  AR09: replay ? {
    // Every Family request takes the next measured delay (cycled, in order); 27 consecutive in-play reads apply all 27.
    delaysReplayed: Math.min(27, replay.statusReadsDuringPlay),
    missingSamples: Math.max(0, 27 - replay.statusReadsDuringPlay),
    freezes: replay.freezes,
    observedConserved: replay.billedMatchesObserved && replay.neverCountedPastDeadline,
    oldLiveVerdictStillFailed: live.verdict && live.verdict.pass === false,
    statusReadsDuringPlay: replay.statusReadsDuringPlay,
    runShare: replay.runShare,
    playSpanSeconds: replay.playSpanSeconds,
  } : null,
};
const engineOk = (r) => r && r.engine.levelBeforeMarkA && r.engine.frozenFramesBetweenMarks === 0;
const continuous = (r) => Boolean(r) && r.freezes === 0 && r.playSpanSeconds >= 25 && engineOk(r);
const beyond = ["c1200", "outage"].filter((n) => by[n]);
summary.AR11 = {
  gateFreeReferenceFramesBetweenMarks: controls.map((c) => c.between).join(","),
  authorityWindowSeconds: mod.AUTHORITY_WINDOW_SECONDS,
  // Measured, not configured: the median interval between the app's reports when answers come back quickly (300 ms).
  nativeReportCadenceMs: by.c300 && by.c300.reportCadenceMedianMs !== null ? Math.round(by.c300.reportCadenceMedianMs / 100) * 100 : null,
  continuousAt600: continuous(by.c600),
  continuousAt900: continuous(by.c900),
  engineFrozenFramesAt600: by.c600 ? by.c600.engine.frozenFramesBetweenMarks : null,
  engineFrozenFramesAt900: by.c900 ? by.c900.engine.frozenFramesBetweenMarks : null,
  nextGrantBeforeDeadlineAt600: Boolean(by.c600) && by.c600.grantsReachingAppAfterDeadline === 0 && by.c600.reportsInPlay >= 25,
  nextGrantBeforeDeadlineAt900: Boolean(by.c900) && by.c900.grantsReachingAppAfterDeadline === 0 && by.c900.reportsInPlay >= 25,
  observedConservedAt600: Boolean(by.c600) && by.c600.billedMatchesObserved && by.c600.neverCountedPastDeadline,
  observedConservedAt900: Boolean(by.c900) && by.c900.billedMatchesObserved && by.c900.neverCountedPastDeadline,
  noGrantPastWindow: runs.every((r) => r.grantsPastMeterWindow === 0),
  beyondWindowPausedSafely: beyond.length === 2 && by.c1200.billedMatchesObserved && by.c1200.neverCountedPastDeadline && by.outage.outagePausedSafely === true && by.outage.billedMatchesObserved,
  beyondWindowUnobservedBilledSeconds: beyond.reduce((n, k) => n + Math.max(0, by[k].familyConsumed - Math.ceil(by[k].engine.engineRanSeconds - 1e-9)), 0),
  minMarginMsAt600: by.c600 ? by.c600.nextGrantMinMarginMs : null,
  minMarginMsAt900: by.c900 ? by.c900.nextGrantMinMarginMs : null,
};
fs.writeFileSync(path.join(out, "realclock.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary));
