// Rendered-UI check of the native (Deimos Rising) Games card and launcher, October 25, 2026. Everything is local and
// fictional: a LOCAL production server of this checkout (scripts/run-family-home-server.sh) on an isolated SQLite
// database with synthetic secrets, the Game Studio child adapter CANDIDATE, a synthetic upstream, a proxy shaped like
// Tailscale Serve whose "device" address can be switched (the Mac mini, another Mac), headless Chromium (Playwright)
// with desktop-Mac and iPad user agents, and the native client core (studio_harness) standing in for the app.
// The custom-scheme launch link is read from the page and handed to the harness; it is never opened by the browser.
//
//   node scripts/verify-native-launcher.mjs --adapter <child-play-adapter.mjs> --harness <studio_harness> --out <dir>
// Prints one JSON line of observations and writes <out>/results.json and screenshots.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { encode } from "@auth/core/jwt";
import { createClient } from "@libsql/client";
import { audioSafeChromiumLaunchOptions } from "./lib/browser-audio-guard.mjs";
import { ensurePlayTables } from "../src/lib/family-play-db.ts";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const adapterPath = opt("--adapter");
const harness = opt("--harness");
const out = opt("--out", "/tmp/deimos-ui/out");
const app = path.resolve(new URL("..", import.meta.url).pathname);
const PORT = Number(opt("--port", "3191"));
const base = `http://127.0.0.1:${PORT}`;
const dbDir = opt("--db-dir", "/tmp/deimos-ui/db");
const SECRET = "fable-family-home-synthetic-secret-0123456789abcdef";
const GAMES_SECRET = "fable-family-games-synthetic-secret-0123456789abcdef";
const COOKIE = "authjs.session-token";
const MINI = "100.106.216.95";
const REMOTE = "100.101.102.103";
const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const IPAD_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.rmSync(dbDir, { recursive: true, force: true });
fs.mkdirSync(dbDir, { recursive: true });
const obs = {};
const cleanup = [];

try {
  // ---- synthetic upstream + adapter candidate + Serve-like proxy -------------------------------------------------
  const upstream = spawn(process.execPath, [path.join(app, "scripts/fake-studio-upstream.mjs"), "0"], { stdio: ["ignore", "pipe", "inherit"] });
  cleanup.push(() => upstream.kill());
  const upstreamOrigin = await new Promise((resolve) => upstream.stdout.once("data", (d) => resolve(String(d).trim().split("\n")[0])));
  const mod = await import(adapterPath);
  const dataDir = path.join(out, "adapter");
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, "approvals.json"), JSON.stringify({ version: 1, approvals: [{ gameId: "adaptive-chess-coach", children: ["santiago", "isabel"] }, { gameId: "fixture-paid-game", children: ["santiago"] }, { gameId: "deimos-rising", children: ["santiago"] }] }));
  const adapter = mod.createChildPlayAdapter({ secret: GAMES_SECRET, dataDir, upstreamOrigin, allowedOrigin: base, settleBase: base, log: () => {}, localAddresses: () => new Set(["127.0.0.1", "::1", MINI]) });
  await new Promise((r) => adapter.listen(0, "127.0.0.1", r));
  cleanup.push(() => { adapter.settler?.stop(); adapter.close(); });
  const adapterPort = adapter.address().port;
  let device = MINI;
  const proxy = http.createServer((req, res) => {
    const headers = { ...req.headers };
    for (const h of ["x-forwarded-for", "x-forwarded-proto", "x-forwarded-host", "forwarded"]) delete headers[h];
    Object.assign(headers, { "x-forwarded-for": device, "x-forwarded-proto": "https", "x-forwarded-host": "dae-macmini.tail4f656e.ts.net:8444" });
    const up = http.request({ hostname: "127.0.0.1", port: adapterPort, path: req.url, method: req.method, headers, agent: false }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on("error", () => { res.writeHead(502); res.end(); });
    req.pipe(up);
  });
  await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
  cleanup.push(() => proxy.close());
  const studioUrl = `http://127.0.0.1:${proxy.address().port}`;

  // ---- local production server of this checkout ----------------------------------------------------------------
  execFileSync("sh", [path.join(app, "scripts/run-family-home-server.sh"), app, dbDir, String(PORT), studioUrl], { env: { ...process.env, AUTH_SECRET: SECRET, FAMILY_GAMES_TOKEN_SECRET: GAMES_SECRET }, stdio: ["ignore", "pipe", "inherit"] });
  cleanup.push(() => execFileSync("sh", [path.join(app, "scripts/run-family-home-server.sh"), "--stop", dbDir]));
  execFileSync(process.execPath, [path.join(app, "scripts/seed-family-fixture.mjs"), "--base", base, "--db", path.join(dbDir, "nabu.db")], { env: { ...process.env, AUTH_SECRET: SECRET }, stdio: "ignore" });
  const db = createClient({ url: `file:${path.join(dbDir, "nabu.db")}` });
  await ensurePlayTables(db);
  await db.execute({ sql: "INSERT OR REPLACE INTO family_play_allowances VALUES ('santiago', 900, 0, ?)", args: [new Date().toISOString()] });
  const now = Math.floor(Date.now() / 1000);
  const cookieValue = await encode({ token: { email: "assistant@davideberle.com", name: "a", sub: "a", iat: now, exp: now + 3600 }, secret: SECRET, salt: COOKIE, maxAge: 3600 });
  const leases = async () => (await db.execute("SELECT id, game_id, state FROM family_play_leases ORDER BY issued_at")).rows.map((r) => ({ id: String(r.id), game: String(r.game_id), state: String(r.state) }));
  const remaining = async () => { const r = (await db.execute("SELECT granted_seconds - consumed_seconds AS left FROM family_play_allowances WHERE person_id = 'santiago'")).rows[0]; return Number(r.left); };

  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${process.env.HOME}/.npm-global/lib/node_modules/playwright`);
  const browser = await chromium.launch(audioSafeChromiumLaunchOptions({ headless: true }));
  cleanup.push(() => browser.close());
  async function page(ua, touch = false) {
    const ctx = await browser.newContext({ userAgent: ua, viewport: touch ? { width: 1024, height: 1366 } : { width: 1280, height: 860 }, hasTouch: touch, baseURL: base });
    await ctx.addCookies([{ name: COOKIE, value: cookieValue, url: base }]);
    const p = await ctx.newPage();
    // Real iPadOS reports 5 touch points with a desktop (Macintosh) user agent; Playwright's hasTouch alone reports fewer.
    if (touch) await (await ctx.newCDPSession(p)).send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    const errors = [];
    p.on("pageerror", (e) => errors.push(String(e)));
    return { p, ctx, errors };
  }
  const shot = (p, name) => p.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });

  // ---- 1. The family Mac (desktop-Mac browser, Mac mini device address) ------------------------------------------
  device = MINI;
  {
    const { p, ctx, errors } = await page(MAC_UA);
    await p.goto("/family/games?child=santiago");
    const card = p.locator('article[data-game-id="deimos-rising"]');
    await card.waitFor({ timeout: 20000 });
    await card.getByText("Play on this Mac").waitFor({ timeout: 10000 });
    obs.macCardText = (await card.innerText()).replace(/\s+/g, " ").trim();
    obs.macCardHasPlay = (await card.getByRole("link", { name: /Play on this Mac/ }).count()) === 1;
    obs.browserCardsPlay = await p.locator('article[data-game-id="fixture-paid-game"]').getByRole("link", { name: "▶ Play" }).count();
    await shot(p, "1-games-mac");
    const leasesBefore = (await leases()).length;
    await card.getByRole("link", { name: /Play on this Mac/ }).click();
    const launch = p.locator("[data-native-launch]");
    await launch.waitFor({ timeout: 20000 });
    const href = await launch.getAttribute("href");
    obs.launchHrefShape = /^deimos-rising-studio:\/\/play\?ticket=[A-Za-z0-9_-]{43}$/.test(href || "");
    obs.launchHrefHasCredential = (href || "").includes("fgt1");
    const after = await leases();
    obs.macLeaseTaken = after.length === leasesBefore + 1 && after.at(-1).game === "deimos-rising" && after.at(-1).state === "active";
    await shot(p, "2-launcher-ready");
    // The "app": the native client core redeems the page's link on the adapter's loopback listener and reports from
    // its title screen (nothing billed); the page shows it attached.
    const nat = spawn(harness, [], { stdio: ["pipe", "pipe", "inherit"] });
    let buf = "";
    const waiters = [];
    nat.stdout.setEncoding("utf8");
    nat.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); waiters.shift()?.(JSON.parse(l)); } });
    const send = (c) => new Promise((r) => { waiters.push(r); nat.stdin.write(`${c}\n`); });
    await send(`port ${adapterPort}`);
    await send(`time ${Date.now()}`);
    obs.appRedeemed = (await send(`launch ${href}`)).ok === true;
    await send(`time ${Date.now()}`);
    await send("tick");
    await p.locator('[data-native-launcher][data-attached="true"]').waitFor({ timeout: 10000 });
    obs.pageShowsAttached = (await p.getByText("Deimos Rising is open on this Mac").count()) === 1;
    obs.pageClock = (await p.locator("[data-remaining-seconds]").first().getAttribute("data-remaining-seconds")) ?? null;
    await shot(p, "3-launcher-attached");
    // Quit from the title screen: the lease ends, nothing was billed; the page says so.
    await send(`time ${Date.now()}`);
    await send("requestend left");
    await send("end");
    nat.stdin.end();
    await adapter.settler.flush();
    await p.getByText("This play session is over").waitFor({ timeout: 10000 });
    await shot(p, "4-launcher-ended");
    obs.remainingAfterTitleOnly = await remaining();
    obs.macPageErrors = errors.length;
    await ctx.close();
  }

  // ---- 2. A browser game is running; another Mac (desktop UA, other device) opens Games and the launcher URL -------
  {
    const { p, ctx, errors } = await page(MAC_UA);
    device = MINI;
    await p.goto(`/family/games/play?game=fixture-paid-game&child=santiago`);
    await p.waitForTimeout(2500);
    const running = (await leases()).filter((l) => l.state === "active");
    obs.browserGameLeaseActive = running.length === 1 && running[0].game === "fixture-paid-game";
    const remainingBefore = await remaining();
    const leaseCountBefore = (await leases()).length;
    const remote = await page(MAC_UA);
    device = REMOTE;
    await remote.p.goto("/family/games?child=santiago");
    const card = remote.p.locator('article[data-game-id="deimos-rising"]');
    await card.waitFor({ timeout: 20000 });
    await remote.p.waitForTimeout(1500);
    obs.remoteCardHasPlay = (await card.getByRole("link", { name: /Play/ }).count()) > 0;
    obs.remoteCardSaysFamilyMac = (await card.getByText("Plays on the family Mac").count()) === 1;
    await shot(remote.p, "5-games-other-mac");
    await remote.p.goto("/family/games/play?game=deimos-rising&child=santiago");
    await remote.p.locator("[data-native-unsupported]").waitFor({ timeout: 20000 });
    await shot(remote.p, "6-launcher-other-mac");
    const afterRemote = await leases();
    obs.remoteTookLease = afterRemote.length !== leaseCountBefore;
    obs.browserLeaseStillActive = afterRemote.filter((l) => l.state === "active").map((l) => l.game).join(",") === "fixture-paid-game";
    obs.remainingUnchangedByRemote = (await remaining()) === remainingBefore;
    obs.remotePageErrors = remote.errors.length;
    await remote.ctx.close();
    // ---- 3. An iPad on the family Mac's network address cannot either (touch device) ------------------------------
    device = MINI;
    const ipad = await page(IPAD_UA, true);
    await ipad.p.goto("/family/games?child=santiago");
    obs.ipadMaxTouchPoints = await ipad.p.evaluate(() => navigator.maxTouchPoints);
    const icard = ipad.p.locator('article[data-game-id="deimos-rising"]');
    await icard.waitFor({ timeout: 20000 });
    await ipad.p.waitForTimeout(1500);
    obs.ipadCardHasPlay = (await icard.getByRole("link", { name: /Play/ }).count()) > 0;
    await shot(ipad.p, "7-games-ipad");
    await ipad.p.goto("/family/games/play?game=deimos-rising&child=santiago");
    await ipad.p.locator("[data-native-unsupported]").waitFor({ timeout: 20000 });
    obs.ipadTookLease = (await leases()).length !== leaseCountBefore;
    obs.browserLeaseStillActiveAfterIpad = (await leases()).filter((l) => l.state === "active").map((l) => l.game).join(",") === "fixture-paid-game";
    await shot(ipad.p, "8-launcher-ipad");
    obs.ipadPageErrors = ipad.errors.length;
    obs.browserGamePageErrors = errors.length;
    await ipad.ctx.close();
    await ctx.close();
  }
} finally {
  for (const fn of cleanup.reverse()) { try { await fn(); } catch { /* best effort */ } }
}
fs.writeFileSync(path.join(out, "results.json"), `${JSON.stringify(obs, null, 2)}\n`);
console.log(JSON.stringify(obs));
