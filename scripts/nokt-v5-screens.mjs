#!/usr/bin/env node
// Nov 18 (Nokt v5) — render check of the Nokt panel telemetry on `next build` + `next start` with SYNTHETIC records only
// (scripts/next-visits-seed.mjs), the loopback v5 stub bridge (scripts/nokt-v5-stub-bridge.mjs), the fake media stream and the
// local fake recognizer (FAMILY_NOKT_STT_FAKE=1). Muted (Chromium --mute-audio; device speech is stubbed and timed).
// Checks the closed `nokt` events the page sends, in order, for: open → mic start → mic live → transcription ok → sent spoken →
// reply → close; a typed send; and a close while Nokt is speaking. Also: the panel close is stored as the talk's close.
//   PW_CHROME=<chromium> node scripts/nokt-v5-screens.mjs --base http://127.0.0.1:3781 --out /tmp/nov18/shots/nokt-v5
import fs from "node:fs";
import path from "node:path";
import { encode } from "@auth/core/jwt";
import { chromium } from "/Users/claweberle/.npm-global/lib/node_modules/playwright/index.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const BASE = opt("--base", "http://127.0.0.1:3781");
const BRIDGE = opt("--bridge", "http://127.0.0.1:3789");
/** The bridge URL the server was given (https, as the app requires); the browser's calls to it are answered by the loopback stub. */
const BRIDGE_PUBLIC = opt("--bridge-public", "https://nokt-bridge.invalid:8787");
const OUT = opt("--out", "/tmp/nov18/shots/nokt-v5");
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE)) throw new Error("loopback only");
fs.mkdirSync(OUT, { recursive: true });
const SECRET = process.env.AUTH_SECRET ?? "fable-world-first-synthetic-secret-0123456789abcdef";
const COOKIE = "authjs.session-token";
const accounts = [...fs.readFileSync(new URL("./step1-screens.mjs", import.meta.url), "utf8").matchAll(/const (owner|assistant) = await mint\("([^"]+)"\)/g)];
const emailOf = (who) => accounts.find((m) => m[1] === who)[2];
const mint = (who) => encode({ token: { email: emailOf(who), sub: emailOf(who), name: emailOf(who) }, secret: SECRET, salt: COOKIE, maxAge: 7200 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail: detail ?? null });
  console.log(ok ? "PASS" : "FAIL", name, detail === undefined ? "" : JSON.stringify(detail).slice(0, 400));
};
// Device speech is recorded and ends after `__speakMs` (so «Nokt is speaking» lasts as long as the check needs); media muted.
const PROBE = `(() => {
  globalThis.__speech = [];
  globalThis.__speakMs = 300;
  const s = globalThis.speechSynthesis;
  if (s) {
    let timer = null;
    try { Object.defineProperty(s, "speak", { configurable: false, value: (u) => { globalThis.__speech.push(u.text); globalThis.__speaking = true; timer = setTimeout(() => { globalThis.__speaking = false; u.onend && u.onend(); }, globalThis.__speakMs); } }); } catch {}
    try { Object.defineProperty(s, "cancel", { configurable: false, value: () => { if (timer) clearTimeout(timer); globalThis.__speaking = false; } }); } catch {}
    try { Object.defineProperty(s, "getVoices", { configurable: false, value: () => [{ name: "Anna", lang: "de-DE", localService: true }] }); } catch {}
  }
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { this.muted = true; return play.call(this); };
})();`;

const batches = [];
const external = [];
const pageErrors = [];
const browser = await chromium.launch({ headless: true, ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}), args: ["--mute-audio", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const c = await browser.newContext({ viewport: { width: 1440, height: 780 }, locale: "de-CH", timezoneId: "Europe/Zurich", permissions: ["microphone"] });
await c.addInitScript(PROBE);
await c.route("**/*", async (r) => {
  const u = new URL(r.request().url());
  if (u.origin === BRIDGE_PUBLIC) {
    const cors = { "access-control-allow-origin": BASE, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "authorization, content-type", vary: "Origin" };
    if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: cors });
    const res = await fetch(`${BRIDGE}${u.pathname}`, { method: "POST", headers: { origin: BASE, authorization: r.request().headers()["authorization"] ?? "", "content-type": "application/json" }, body: r.request().postData() ?? "" });
    return r.fulfill({ status: res.status, headers: { ...cors, "content-type": "application/json" }, body: await res.text() });
  }
  if (u.origin !== BASE && u.origin !== BRIDGE) {
    external.push(`${u.origin}${u.pathname}`);
    return r.abort("blockedbyclient");
  }
  // No voice provider here: Nokt's line falls back to the (stubbed, timed) device voice.
  if (u.pathname === "/api/family/assistant/tts" || /\/nokt-voice|\/voice\//.test(u.pathname)) return r.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  if (u.pathname === "/api/family/learning/telemetry" && r.request().method() === "POST") {
    try {
      batches.push(JSON.parse(r.request().postData() ?? "{}"));
    } catch {}
  }
  return r.continue();
});
await c.addCookies([{ name: COOKIE, value: await mint("assistant"), url: BASE }]);
const page = await c.newPage();
page.on("pageerror", (e) => pageErrors.push(String(e)));
let n = 0;
const shot = async (name) => page.screenshot({ path: path.join(OUT, `${String((n += 1)).padStart(2, "0")}-${name}.png`) });
const noktLines = () => page.locator("[data-testid='nokt-visit'] li[data-role='nokt']").count();
const speaking = () => page.evaluate(() => !!globalThis.__speaking);

// 1) Start the visit: the welcome opens by itself (panel-open welcome), «Los geht's» closes it (panel-close).
// The real start from the home map (the place's tap), as Santiago starts a visit: the welcome opens by itself.
await page.goto(`${BASE}/family/learn/mission?child=santiago&enter=${opt("--enter", "beach")}`);
await page.waitForSelector("[data-testid='nokt-sidebar'][data-dock='welcome']", { timeout: 25000 });
await page.waitForFunction(() => document.querySelectorAll("[data-testid='nokt-welcome'] li[data-role='nokt']").length > 0, null, { timeout: 40000 });
await settle(800);
await shot("welcome");
await page.locator("[data-testid='nokt-dock-close']").click();
await page.waitForSelector("[data-testid='scene-panel']", { timeout: 15000 }).catch(() => null);
check("V5.walks-in-after-los-gehts", (await page.locator("[data-testid='scene-panel']").count()) > 0);
await settle(2500);
check("V5.no-stale-notice-after-welcome-close", (await page.locator("[data-testid='notice']").count()) === 0, await page.locator("[data-testid='notice']").allInnerTexts());
// Back to the map (the dock's Nokt button is on every screen; the panel close below is what is checked).
if (await page.locator("[data-testid='scene-back']").count()) await page.locator("[data-testid='scene-back']").click().catch(() => null);
await settle(1500);

// 2) Open Nokt, speak (fake microphone + fake recognizer), send, Nokt replies, close when Nokt is quiet.
await page.waitForSelector("[data-testid='nokt-button']", { timeout: 20000 });
await page.locator("[data-testid='nokt-button']").click();
await page.waitForSelector("[data-testid='nokt-visit']", { timeout: 10000 });
await shot("panel-open");
await page.locator("[data-testid='nokt-mic-start']").click();
await page.waitForSelector("[data-testid='nokt-mic-live']", { timeout: 15000 });
await shot("mic-live");
await settle(1200);
await page.locator("[data-testid='nokt-mic-stop']").click();
await page.waitForFunction(() => (document.querySelector("[data-testid='nokt-talk-input']")?.value ?? "").trim().length > 0, null, { timeout: 20000 });
await shot("transcript-in-field");
const before1 = await noktLines();
await page.locator("[data-testid='nokt-talk-send']").click();
await page.waitForFunction((k) => document.querySelectorAll("[data-testid='nokt-visit'] li[data-role='nokt']").length > k, before1, { timeout: 30000 });
await page.waitForFunction(() => !globalThis.__speaking, null, { timeout: 10000 });
await settle(400);
await shot("spoken-reply");
await page.locator("[data-testid='nokt-dock-close']").click();
await settle(1500);

// 3) Reopen, type «weiss nicht», send, reply (a hint, no question), close when quiet.
await page.locator("[data-testid='nokt-button']").click();
await page.waitForSelector("[data-testid='nokt-visit']", { timeout: 10000 });
await page.locator("[data-testid='nokt-talk-input']").fill("weiss nicht");
const before2 = await noktLines();
await page.locator("[data-testid='nokt-talk-send']").click();
await page.waitForFunction((k) => document.querySelectorAll("[data-testid='nokt-visit'] li[data-role='nokt']").length > k, before2, { timeout: 30000 });
await page.waitForFunction(() => !globalThis.__speaking, null, { timeout: 10000 });
const hint = (await page.locator("[data-testid='nokt-visit'] li[data-role='nokt']").last().innerText()).replace(/\s+/g, " ");
check("V5.weiss-nicht-gets-a-hint-without-question", !/\?/.test(hint.replace(/Nochmal anhören/, "")), hint);
await shot("typed-reply");
await page.locator("[data-testid='nokt-dock-close']").click();
await settle(1500);

// 4) Reopen, type, and close while Nokt is still speaking (device speech held for 8 s).
await page.evaluate(() => (globalThis.__speakMs = 8000));
await page.locator("[data-testid='nokt-button']").click();
await page.waitForSelector("[data-testid='nokt-visit']", { timeout: 10000 });
await page.locator("[data-testid='nokt-talk-input']").fill("hilf mir");
const before3 = await noktLines();
await page.locator("[data-testid='nokt-talk-send']").click();
await page.waitForFunction((k) => document.querySelectorAll("[data-testid='nokt-visit'] li[data-role='nokt']").length > k, before3, { timeout: 30000 });
await page.waitForFunction(() => !!globalThis.__speaking, null, { timeout: 5000 });
check("V5.nokt-is-speaking-at-close", await speaking());
await shot("closing-while-speaking");
await page.locator("[data-testid='nokt-dock-close']").click();
await settle(800);
check("V5.close-stops-the-voice", !(await speaking()));
await page.evaluate(() => (globalThis.__speakMs = 300));

// 5) Telemetry goes out every 20 s: wait for the batch, then read the `nokt` events in order.
await settle(23000);
const events = batches.flatMap((b) => b.events ?? []).filter((e) => e.kind === "nokt").sort((a, b) => a.t - b.t);
const names = events.map((e) => `${e.detail.event}${e.detail.purpose ? `:${e.detail.purpose}` : ""}${e.detail.nokt ? `(${e.detail.nokt})` : ""}`);
fs.writeFileSync(path.join(OUT, "nokt-events.json"), JSON.stringify({ names, events, batches: batches.length }, null, 2));
console.log(names.join("  "));
const inOrder = (seq, from = 0) => {
  let i = from;
  for (const want of seq) {
    while (i < names.length && !names[i].startsWith(want)) i += 1;
    if (i >= names.length) return -1;
    i += 1;
  }
  return i;
};
const a = inOrder(["panel-open:welcome", "panel-close:welcome"]);
check("T.welcome-open-close", a > 0);
const b = inOrder(["panel-open:visit", "mic-start:visit", "mic-live:visit", "stt-ok:visit", "sent-spoken:visit", "reply-shown:visit", "panel-close:visit(idle)"], Math.max(a, 0));
check("T.open-mic-live-stt-sent-spoken-reply-close", b > 0, names);
const typed = inOrder(["panel-open:visit", "sent-typed:visit", "reply-shown:visit", "panel-close:visit"], Math.max(b, 0));
check("T.typed-send", typed > 0);
const speakingClose = inOrder(["panel-open:visit", "sent-typed:visit", "reply-shown:visit", "panel-close:visit(speaking)"], Math.max(typed, 0));
check("T.close-while-speaking", speakingClose > 0);
const micLive = events.find((e) => e.detail.event === "mic-live");
check("T.mic-live-carries-ms-only", !!micLive && typeof micLive.detail.ms === "number" && Object.keys(micLive.detail).every((k) => ["event", "purpose", "ms"].includes(k)), micLive?.detail);
check("T.no-text-anywhere", !JSON.stringify(events).match(/weiss nicht|hilf mir|transcript|text/i));

// 6) The panel close is the talk's close on the server (parent evidence, owner session).
const oc = await browser.newContext({ viewport: { width: 1440, height: 780 } });
await oc.addCookies([{ name: COOKIE, value: await mint("owner"), url: BASE }]);
const op = await oc.newPage();
await op.goto(`${BASE}/family/learn/parent?child=santiago`);
const ev = await op.evaluate(async () => (await fetch("/api/family/learning/parent/evidence?child=santiago")).json());
const talks = (ev.noktTalks ?? []).map((t) => ({ purpose: t.purpose, closed: t.closed, lines: t.lines.length }));
fs.writeFileSync(path.join(OUT, "nokt-talks-evidence.json"), JSON.stringify(talks, null, 2));
check("S.visit-talks-closed-by-panel", talks.filter((t) => t.purpose === "visit").length >= 3 && talks.filter((t) => t.purpose === "visit").every((t) => /^Panel geschlossen/.test(t.closed)), talks);
check("S.closed-while-speaking-recorded", talks.some((t) => /während Nokt sprach/.test(t.closed)), talks.map((t) => t.closed));
check("S.welcome-closed", talks.some((t) => t.purpose === "welcome" && /^Panel geschlossen/.test(t.closed)), talks.map((t) => `${t.purpose}: ${t.closed}`));

check("X.no-stale-notice-at-end", (await page.locator("[data-testid='notice']").count()) === 0, await page.locator("[data-testid='notice']").allInnerTexts());
check("X.no-external-requests", external.length === 0, external);
check("X.no-page-errors", pageErrors.length === 0, pageErrors);
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).length, results }, null, 2));
console.log(`PASS ${results.filter((r) => r.ok).length} FAIL ${results.filter((r) => !r.ok).length}`);
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
