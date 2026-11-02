#!/usr/bin/env node
// Step 2 B: measures the home map's load on an ISOLATED local server — the bytes of the map's sprites and of the Phaser
// chunk per child, and the time from navigation to a drawn, labelled map — unthrottled and with Chrome's network
// throttling (to approximate the home Wi-Fi against the CDN). Cold cache for every run. Loopback only.
//   AUTH_SECRET=… node scripts/home-map-measure.mjs --base http://127.0.0.1:3611
import { encode } from "@auth/core/jwt";
import { chromium } from "/Users/claweberle/.npm-global/lib/node_modules/playwright/index.mjs";
import { audioSafeChromiumLaunchOptions, installBrowserAudioGuard } from "./lib/browser-audio-guard.mjs";

const args = process.argv.slice(2);
const BASE = args.includes("--base") ? args[args.indexOf("--base") + 1] : "http://127.0.0.1:3611";
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE)) throw new Error("loopback only");
const SECRET = process.env.AUTH_SECRET ?? "fable-world-first-synthetic-secret-0123456789abcdef";
const COOKIE = "authjs.session-token";
const token = await encode({ token: { email: "assistant@davideberle.com", sub: "assistant@davideberle.com", name: "assistant" }, secret: SECRET, salt: COOKIE, maxAge: 3600 });
const browser = await chromium.launch(audioSafeChromiumLaunchOptions({ headless: true }));
const profiles = [
  { name: "unthrottled", net: null },
  { name: "50 Mbit/s, 20 ms", net: { offline: false, latency: 20, downloadThroughput: (50e6 / 8), uploadThroughput: (10e6 / 8) } },
  { name: "20 Mbit/s, 40 ms", net: { offline: false, latency: 40, downloadThroughput: (20e6 / 8), uploadThroughput: (5e6 / 8) } },
];
const out = [];
for (const child of ["santiago", "isabel"]) {
  for (const prof of profiles) {
    const c = await browser.newContext({ viewport: { width: 1440, height: 780 } });
    await installBrowserAudioGuard(c);
    await c.addCookies([{ name: COOKIE, value: token, url: BASE }]);
    const page = await c.newPage();
    const cdp = await c.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    if (prof.net) await cdp.send("Network.emulateNetworkConditions", prof.net);
    const t0 = Date.now();
    await page.goto(`${BASE}/family/learn?child=${child}`);
    await page.waitForSelector("[data-testid='home-map'][data-ready='true']", { timeout: 120000 });
    const readyMs = Date.now() - t0;
    const res = await page.evaluate(() => performance.getEntriesByType("resource").map((e) => ({ n: new URL(e.name).pathname, b: e.encodedBodySize || e.transferSize || 0 })));
    const sprites = res.filter((r) => r.n.startsWith("/family/home-map/"));
    const js = res.filter((r) => r.n.endsWith(".js"));
    const phaser = js.reduce((m, r) => (r.b > m.b ? r : m), { n: "", b: 0 });
    out.push({ child, profile: prof.name, readyMs, sprites: sprites.length, spriteKB: Math.round(sprites.reduce((s, r) => s + r.b, 0) / 1024), largestJsKB: Math.round(phaser.b / 1024), allKB: Math.round(res.reduce((s, r) => s + r.b, 0) / 1024) });
    console.log(JSON.stringify(out[out.length - 1]));
    await c.close();
  }
}
await browser.close();
