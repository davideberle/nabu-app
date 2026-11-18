#!/usr/bin/env node
// Nov 18 (Nokt v5) — render check of the STRICT writing step (T10-JOURNAL, seeded by scripts/nokt-v5-writing-seed.mjs).
// Base: the panel render check below on `next build` + `next start` with SYNTHETIC records only
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
const OUT = opt("--out", "/tmp/nov18/shots/nokt-v5/writing");
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

// 1) Into the journal: he writes a sentence without the full stop.
await page.goto(`${BASE}/family/learn/mission?child=santiago&enter=greenhouse`);
await page.waitForSelector("[data-testid='write-input']", { timeout: 30000 });
await page.locator("[data-testid='write-input']").fill("Die Schildkröte schwimmt im Teich");
await page.locator("[data-testid='write-send']").click();
await page.waitForSelector("[data-testid='nokt-sidebar'][data-dock='writing']", { timeout: 20000 });
await page.waitForFunction(() => document.querySelectorAll("[data-testid='nokt-writing'] li[data-role='nokt']").length > 0, null, { timeout: 40000 });
await page.waitForSelector("[data-testid='write-strict'][data-pending='false']", { timeout: 15000 });
await settle(600);
const strictControls = async (label) => {
  check(`W.${label}.no-keep`, (await page.locator("[data-testid='write-keep']").count()) === 0);
  check(`W.${label}.no-close`, (await page.locator("[data-testid='nokt-dock-close'], [data-testid='nokt-close']").count()) === 0);
  check(`W.${label}.scene-locked`, (await page.locator("[data-testid='scene-back']").count()) === 0);
};
await strictControls("after-first-reaction");
const first = (await page.locator("[data-testid='nokt-writing'] li[data-role='nokt']").last().innerText()).replace(/\s+/g, " ");
check("W.guided-question", /Ende eines Satzes\?/.test(first), first);
check("W.field-prefilled-with-his-version", (await page.locator("[data-testid='write-revise']").inputValue()) === "Die Schildkröte schwimmt im Teich");
await shot("writing-first-reaction");
// 2) He answers Nokt; Nokt asks the next small question (two questions in a row are allowed here).
await page.locator("[data-testid='nokt-talk-input']").fill("ein Punkt");
const k = await page.locator("[data-testid='nokt-writing'] li[data-role='nokt']").count();
await page.locator("[data-testid='nokt-talk-send']").click();
await page.waitForFunction((n) => document.querySelectorAll("[data-testid='nokt-writing'] li[data-role='nokt']").length > n, k, { timeout: 30000 });
const second = (await page.locator("[data-testid='nokt-writing'] li[data-role='nokt']").last().innerText()).replace(/\s+/g, " ");
check("W.second-guided-question", /\?/.test(second.replace(/Nochmal anhören/, "")), second);
await shot("writing-guided");
// 3) He rewrites it; Nokt reads the new version; the app's check and Nokt's close finish the step.
await page.locator("[data-testid='write-revise']").fill("Die Schildkröte schwimmt im Teich.");
await page.locator("[data-testid='write-revise-send']").click();
await page.waitForSelector("[data-testid='write-done']", { timeout: 40000 });
await settle(800);
await shot("writing-done");
check("W.done-after-the-right-version", (await page.locator("[data-testid='write-done']").count()) === 1);
await settle(23000);
const events = batches.flatMap((b) => b.events ?? []).filter((e) => e.kind === "nokt").sort((a, b) => a.t - b.t);
const names = events.map((e) => `${e.detail.event}${e.detail.purpose ? `:${e.detail.purpose}` : ""}${e.detail.nokt ? `(${e.detail.nokt})` : ""}`);
fs.writeFileSync(path.join(OUT, "nokt-events.json"), JSON.stringify({ names, events }, null, 2));
console.log(names.join("  "));
check("W.telemetry-open-sent-replies", names[0] === "panel-open:writing" && names.includes("sent-typed:writing") && names.filter((x) => x.startsWith("reply-shown:writing")).length >= 3, names);
check("W.no-panel-close-in-writing", !names.some((x) => x.startsWith("panel-close")), names);
const oc = await browser.newContext({ viewport: { width: 1440, height: 780 } });
await oc.addCookies([{ name: COOKIE, value: await mint("owner"), url: BASE }]);
const op = await oc.newPage();
await op.goto(`${BASE}/family/learn/parent?child=santiago`);
const ev = await op.evaluate(async () => (await fetch("/api/family/learning/parent/evidence?child=santiago")).json());
const w = (ev.noktTalks ?? []).filter((t) => t.purpose === "writing").map((t) => ({ closed: t.closed, lines: t.lines.map((l) => `${l.who}: ${l.text}`) }));
fs.writeFileSync(path.join(OUT, "writing-talk-evidence.json"), JSON.stringify(w, null, 2));
check("W.writing-talk-closed-as-finished", w.length === 1 && /^beendet/.test(w[0].closed), w);
check("X.no-stale-notice", (await page.locator("[data-testid='notice']").count()) === 0, await page.locator("[data-testid='notice']").allInnerTexts());
check("X.no-external-requests", external.length === 0, external);
check("X.no-page-errors", pageErrors.length === 0, pageErrors);
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).length, results }, null, 2));
console.log(`PASS ${results.filter((r) => r.ok).length} FAIL ${results.filter((r) => !r.ok).length}`);
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
