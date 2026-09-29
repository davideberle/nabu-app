// Real-browser regression for the parent cockpit's authorization invalidation
// (independent browser review of 2026-09-29, blockers 1 and 2).
//
// Runs against a LOCAL server started with a known synthetic AUTH_SECRET and an
// isolated NABU_DB_DIR (local SQLite fallback). Nothing here touches the real
// .env, production data or Google OAuth: session cookies are real Auth.js JWEs
// minted locally with @auth/core/jwt, and the private sentinel is written
// through the owner settings API into the isolated database.
//
//   AUTH_SECRET=<32+ chars> AUTH_URL=http://127.0.0.1:3124 GOOGLE_CLIENT_ID=x \
//   GOOGLE_CLIENT_SECRET=y NABU_DB_DIR=/tmp/isolated npx next start -p 3124 -H 127.0.0.1
//   AUTH_SECRET=<same> node scripts/verify-learning-privacy.mjs --base http://127.0.0.1:3124 --out /tmp/isolated/privacy
//
// Scenarios (all headless Chromium, audio guard installed, muted):
//  1. In-flight authorization invalidation: an owner evidence refresh is held
//     after its genuine 200 has been fetched; the cookie switches to the
//     assistant account; Save gets a real 403 and the view clears; releasing
//     the held 200 must NOT restore the private title, the owner badge or hide
//     the denied notice. Also checked for a held settings-save 200 and a held
//     correction 200 (pre-invalidation successes are dropped).
//  2. Session loss in another tab: a real Auth.js sign-out (CSRF + POST
//     /api/auth/signout) in tab B, then tab A is brought to front and receives
//     SYNTHETIC focus / pageshow(persisted) events (labelled as such: headless
//     Chromium does not raise a real BFCache restore); each must clear the
//     private data on its own. visibilitychange is checked separately. Account
//     switching (owner → assistant cookie, then focus) is checked too.
//  3. Normal sign-out in the same tab redirects to login and a reload never
//     shows parent data.
//  4. Session resurrection across response origins (independent privacy-repair
//     review, 2026-09-29): a genuine response fetched under the owner session —
//     child mission API with a real child bearer, a page/RSC document, and
//     GET /api/auth/session — is held and released after (A) an account switch
//     to the assistant cookie or (B) a real Auth.js sign-out. The released
//     response must carry no session cookie, the browser identity must stay
//     assistant / none, and a fresh parent evidence request on focus must stay
//     403 / 401 with the denied view. Sign-in and sign-out cookie writers are
//     proven intact over HTTP (csrf cookie from the csrf endpoint, clearing
//     cookie from a real sign-out); a genuine new owner login is simulated by
//     installing a freshly minted cookie and must recover on the next return.

import fs from "node:fs";
import path from "node:path";
import { decode, encode } from "@auth/core/jwt";
import { chromium } from "/Users/claweberle/.npm-global/lib/node_modules/playwright/index.mjs";
import { audioSafeChromiumLaunchOptions, installBrowserAudioGuard } from "./lib/browser-audio-guard.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt("--base", "http://127.0.0.1:3124").replace(/\/$/, "");
const OUT = opt("--out", "/tmp/family-learning-privacy");
const SECRET = process.env.AUTH_SECRET;
if (!SECRET || SECRET.length < 32) {
  console.error("AUTH_SECRET (>= 32 chars, same as the server) is required");
  process.exit(2);
}
const COOKIE = "authjs.session-token";
const OWNER = "info@davideberle.com";
const ASSISTANT = "assistant@davideberle.com";
const TITLE = "PRIVATE_TITLE_20260929";
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(ok ? "PASS" : "FAIL", name, detail === undefined ? "" : JSON.stringify(detail));
}
const token = (email) => encode({ token: { email, sub: email, name: email }, secret: SECRET, salt: COOKIE, maxAge: 3600 });
async function call(method, url, cookie, body) {
  const res = await fetch(BASE + url, { method, redirect: "manual", headers: { ...(cookie ? { cookie: `${COOKIE}=${cookie}` } : {}), "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

const owner = await token(OWNER);
const assistant = await token(ASSISTANT);

// Seed the private sentinel through the real owner API into the isolated DB.
{
  const current = await call("GET", "/api/family/learning/parent/settings?child=santiago", owner);
  if (current.status !== 200) {
    console.error("server not reachable as owner", current.status, current.text.slice(0, 200));
    process.exit(2);
  }
  const put = await call("PUT", "/api/family/learning/parent/settings", owner, { child: "santiago", expectedErasureGeneration: current.json.erasureGeneration, missionTitle: TITLE });
  check("seed: owner writes private title into isolated DB", put.status === 200, put.status);
}

// Cookie writers over HTTP. No response re-issues the session cookie (the
// sliding refresh is gone everywhere: parent API, child API, page/RSC, other
// APIs, /api/auth/session). The real writers still work: the csrf endpoint
// sets its cookie, a real sign-out returns the clearing session cookie.
{
  const isSession = (c) => /^(?:__Secure-|__Host-)?authjs\.session-token(?:\.\d+)?=/i.test(c);
  const names = (res) => res.headers.getSetCookie().map((c) => c.split("=")[0]);
  const get = (url, cookie, extra = {}) => fetch(BASE + url, { redirect: "manual", headers: { ...(cookie ? { cookie: `${COOKIE}=${cookie}` } : {}), ...extra } });
  const cases = [
    ["parent evidence (owner 200)", "/api/family/learning/parent/evidence?child=santiago", owner],
    ["parent settings (assistant 403)", "/api/family/learning/parent/settings?child=santiago", assistant],
    ["child cockpit page (owner document)", "/family/learn", owner],
    ["family dashboard page (assistant document)", "/family/dashboard", assistant],
    ["parent page RSC payload (owner)", "/family/learn/parent", owner, { rsc: "1" }],
    ["unrelated API (owner)", "/api/planner/week", owner],
    ["auth session endpoint (owner)", "/api/auth/session", owner],
    ["auth session endpoint (assistant)", "/api/auth/session", assistant],
  ];
  for (const [label, url, cookie, extra] of cases) {
    const res = await get(url, cookie, extra);
    const sess = res.headers.getSetCookie().filter(isSession);
    check(`http: no session-cookie write on ${label}`, sess.length === 0, { status: res.status, cookies: names(res) });
  }
  const mission = await get("/api/family/learning/mission", assistant, { authorization: "Bearer " + (await call("POST", "/api/family/learning/session", assistant, { childId: "santiago" })).json.token });
  check("http: child mission API (assistant + child bearer) is 200 without a session-cookie write", mission.status === 200 && mission.headers.getSetCookie().filter(isSession).length === 0, { status: mission.status, cookies: names(mission) });
  // POST /api/auth/session (Auth.js client update()) with a genuine CSRF token: 200, owner, no session-cookie write.
  {
    const csrf = await get("/api/auth/csrf", owner);
    const csrfBody = await csrf.json();
    const csrfCookie = csrf.headers.getSetCookie().filter((c) => c.startsWith("authjs.csrf-token=")).pop();
    const post = await fetch(BASE + "/api/auth/session", { method: "POST", redirect: "manual", headers: { cookie: `${COOKIE}=${owner}; ${csrfCookie.split(";")[0]}`, "content-type": "application/json" }, body: JSON.stringify({ csrfToken: csrfBody.csrfToken, data: {} }) });
    const postBody = await post.json().catch(() => null);
    check("http: POST auth session (update) is 200 for the owner without a session-cookie write", post.status === 200 && postBody?.user?.email === OWNER && post.headers.getSetCookie().filter(isSession).length === 0, { status: post.status, cookies: names(post) });
    // Fixed expiry: the cookie's JWT exp is the enforcement boundary; the session JSON `expires` is only a sliding projection.
    const claims = await decode({ token: owner, secret: SECRET, salt: COOKIE });
    check("http: session JSON expires is a projection; the JWT exp in the browser cookie is unchanged (no cookie was written)", typeof claims?.exp === "number" && postBody?.expires && Date.parse(postBody.expires) > claims.exp * 1000, { jwtExp: claims?.exp, projected: postBody?.expires });
  }
  const sessionRead = await get("/api/auth/session", owner);
  const sessionBody = await sessionRead.json();
  check("http: auth session endpoint still reports the owner (read works, no write)", sessionRead.status === 200 && sessionBody?.user?.email === OWNER);
  const page = await get("/family/learn/parent", owner);
  check("http: non-session Auth.js cookies (csrf, callback-url) still pass through on a page", page.status === 200 && names(page).includes("authjs.csrf-token") && names(page).includes("authjs.callback-url"), names(page));
  // Real writers: csrf endpoint sets its cookie; a real sign-out clears the session cookie.
  const csrf = await get("/api/auth/csrf", owner);
  const csrfBody = await csrf.json();
  // The middleware also appends an Auth.js csrf cookie; the handler's own (last) one matches the token in the body.
  const csrfCookie = csrf.headers.getSetCookie().filter((c) => c.startsWith("authjs.csrf-token=")).pop();
  check("http: csrf endpoint (sign-in flow) sets its cookie", Boolean(csrfCookie && csrfBody.csrfToken), names(csrf));
  const signout = await fetch(BASE + "/api/auth/signout", { method: "POST", redirect: "manual", headers: { cookie: `${COOKIE}=${owner}; ${csrfCookie.split(";")[0]}`, "content-type": "application/x-www-form-urlencoded", "X-Auth-Return-Redirect": "1" }, body: new URLSearchParams({ csrfToken: csrfBody.csrfToken, callbackUrl: BASE + "/login" }) });
  const clearing = signout.headers.getSetCookie().filter(isSession);
  check("http: real sign-out still writes the clearing session cookie (writer intact through middleware)", signout.status === 200 && clearing.length === 1 && /max-age=0|expires=thu, 01 jan 1970/i.test(clearing[0]) && /session-token=;/.test(clearing[0]), { status: signout.status, clearing: clearing.map((c) => c.replace(/=[^;]*/, "=…")) });
}

const browser = await chromium.launch(audioSafeChromiumLaunchOptions({ headless: true }));
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + ".png"), fullPage: true });
async function setSession(context, value) {
  await context.clearCookies();
  if (value) await context.addCookies([{ name: COOKIE, value, url: BASE, httpOnly: true, sameSite: "Lax" }]);
}
async function context() {
  const c = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  await installBrowserAudioGuard(c);
  await c.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (u.origin !== BASE || /\/api\/family\/assistant\/(tts|transcribe|turn|session)/.test(u.pathname)) return r.abort("blockedbyclient");
    return r.continue();
  });
  return c;
}
async function openSettings(c) {
  await setSession(c, owner);
  const p = await c.newPage();
  await p.goto(BASE + "/family/learn/parent");
  await p.getByRole("tab", { name: "Einstellungen", exact: true }).click();
  await p.getByLabel("Missions-Titel").waitFor();
  return p;
}
const titleValue = async (p) => ((await p.getByLabel("Missions-Titel").count()) ? p.getByLabel("Missions-Titel").inputValue() : null);
const deniedVisible = (p) => p.getByRole("heading", { name: "Nur mit dem Eltern-Konto" }).count();
const ownerBadge = (p) => p.getByText("Eltern-Konto " + OWNER).count();
const privateInDom = (p) => p.evaluate((t) => document.documentElement.innerHTML.includes(t) || [...document.querySelectorAll("input")].some((i) => i.value.includes(t)), TITLE);

/** Hold the next matching request after its real response was fetched; returns {info, release}. */
function holdNext(page, pattern) {
  let release;
  const gate = new Promise((r) => (release = r));
  let resolveInfo;
  const info = new Promise((r) => (resolveInfo = r));
  let once = true;
  const handler = async (r) => {
    if (!once) return r.continue();
    once = false;
    const real = await r.fetch();
    const body = await real.body();
    resolveInfo({ status: real.status(), privateData: body.toString().includes(TITLE) });
    await gate;
    await r.fulfill({ response: real, body });
  };
  return { info, release, arm: () => page.route(pattern, handler), disarm: () => page.unroute(pattern, handler) };
}

try {
  // ---------------------------------------------------------------------
  // Scenario 1a: held owner evidence 200, then assistant 403 on Save.
  // ---------------------------------------------------------------------
  {
    const c = await context();
    const p = await openSettings(c);
    check("1a owner sees private title", (await titleValue(p)) === TITLE);
    check("1a owner badge shown", (await ownerBadge(p)) === 1);
    const hold = holdNext(p, "**/api/family/learning/parent/evidence?*");
    await hold.arm();
    await p.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    const heldInfo = await hold.info;
    check("1a held genuine owner evidence 200 with private data", heldInfo.status === 200 && heldInfo.privateData, heldInfo);
    await setSession(c, assistant);
    const put = p.waitForResponse((r) => r.url().includes("/parent/settings") && r.request().method() === "PUT");
    await p.getByRole("button", { name: "Speichern", exact: true }).click();
    const denial = await put;
    await p.getByRole("heading", { name: "Nur mit dem Eltern-Konto" }).waitFor();
    check("1a real 403 on Save clears private settings", denial.status() === 403 && (await titleValue(p)) === null && (await ownerBadge(p)) === 0, denial.status());
    await shot(p, "1a-denied-before-release");
    hold.release();
    await p.waitForResponse((r) => r.url().includes("/parent/evidence") && r.status() === 200);
    await p.waitForTimeout(400);
    const after = { title: await titleValue(p), badge: await ownerBadge(p), denied: await deniedVisible(p), privateInDom: await privateInDom(p) };
    check("1a late pre-switch owner 200 cannot restore evidence, badge or hide the notice", after.title === null && after.badge === 0 && after.denied === 1 && !after.privateInDom, after);
    await shot(p, "1a-after-release");
    await hold.disarm();
    // The assistant session stays denied on further returns (no flicker back to data).
    await p.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await p.waitForTimeout(600);
    const still = { title: await titleValue(p), denied: await deniedVisible(p), badge: await ownerBadge(p), privateInDom: await privateInDom(p), url: p.url() };
    check("1a still denied after focus/visibility with assistant session", still.title === null && still.denied === 1 && !still.privateInDom, still);
    await c.close();
  }

  // ---------------------------------------------------------------------
  // Scenario 1b: held owner settings-save 200 (pre-invalidation success),
  // then a 401 on an evidence refresh: the save's success handler must not
  // trigger a reload or a message; nothing private returns.
  // ---------------------------------------------------------------------
  {
    const c = await context();
    const p = await openSettings(c);
    await p.getByLabel("Einstiegs-Satz").fill("hook-" + Date.now());
    const hold = holdNext(p, "**/api/family/learning/parent/settings");
    await hold.arm();
    await p.getByRole("button", { name: "Speichern", exact: true }).click();
    const heldInfo = await hold.info;
    check("1b held genuine owner settings-save 200", heldInfo.status === 200, heldInfo);
    await setSession(c, null); // session gone entirely
    await p.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await p.getByRole("heading", { name: "Nur mit dem Eltern-Konto" }).waitFor();
    check("1b evidence 401 after session loss clears view", (await titleValue(p)) === null);
    const evidenceCalls = [];
    p.on("request", (r) => {
      if (r.url().includes("/parent/evidence")) evidenceCalls.push(r.url());
    });
    hold.release();
    await p.waitForTimeout(800);
    check("1b released save 200 is dropped: no reload triggered, no 'Gespeichert', no private data", evidenceCalls.length === 0 && (await p.getByText("Gespeichert.").count()) === 0 && (await titleValue(p)) === null && (await deniedVisible(p)) === 1 && !(await privateInDom(p)), { evidenceCalls });
    await shot(p, "1b-after-release");
    await hold.disarm();
    await c.close();
  }

  // ---------------------------------------------------------------------
  // Scenario 1c: held owner evidence 200, then a real 403 on a correction
  // (math tab) — every subcomponent's denial invalidates the same epoch.
  // ---------------------------------------------------------------------
  {
    const c = await context();
    await setSession(c, owner);
    const p = await c.newPage();
    await p.goto(BASE + "/family/learn/parent");
    await p.getByRole("tab", { name: "Mathe", exact: true }).click();
    await p.getByText("Vorgeschlagener nächster Schritt").waitFor();
    const hold = holdNext(p, "**/api/family/learning/parent/evidence?*");
    await hold.arm();
    await p.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    const heldInfo = await hold.info;
    check("1c held owner evidence 200 after synthetic pageshow(persisted)", heldInfo.status === 200, heldInfo);
    await setSession(c, assistant);
    // No attempt exists in the isolated DB to correct; a 403 is reproduced with the records DELETE
    // confirmation flow instead, which is the other write path in the same view.
    await p.getByRole("tab", { name: "Einstellungen", exact: true }).click();
    await p.getByRole("button", { name: "Löschen …", exact: true }).click();
    const del = p.waitForResponse((r) => r.url().includes("/parent/records") && r.request().method() === "DELETE");
    await p.getByRole("button", { name: "Ja, endgültig löschen", exact: true }).click();
    const denial = await del;
    await p.getByRole("heading", { name: "Nur mit dem Eltern-Konto" }).waitFor();
    check("1c real 403 on deletion clears the view", denial.status() === 403 && (await ownerBadge(p)) === 0, denial.status());
    hold.release();
    await p.waitForResponse((r) => r.url().includes("/parent/evidence") && r.status() === 200);
    await p.waitForTimeout(400);
    check("1c late owner 200 stays dropped after a deletion denial", (await ownerBadge(p)) === 0 && (await deniedVisible(p)) === 1 && !(await privateInDom(p)));
    await hold.disarm();
    await c.close();
  }

  // ---------------------------------------------------------------------
  // Scenario 2: real Auth.js sign-out in tab B; tab A on focus / pageshow.
  // ---------------------------------------------------------------------
  for (const trigger of ["focus", "pageshow"]) {
    const c = await context();
    const a = await openSettings(c);
    const b = await c.newPage();
    await b.goto(BASE + "/family/learn/parent");
    await b.getByRole("heading", { name: "Lern-Evidenz" }).waitFor();
    const out = await b.evaluate(async () => {
      const csrf = await fetch("/api/auth/csrf").then((r) => r.json());
      const r = await fetch("/api/auth/signout", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Auth-Return-Redirect": "1" }, body: new URLSearchParams({ csrfToken: csrf.csrfToken, callbackUrl: location.origin + "/login" }) });
      return { status: r.status, session: await fetch("/api/auth/session").then((r) => r.json()) };
    });
    check(`2-${trigger} real Auth.js sign-out in tab B clears the session cookie`, out.status === 200 && !out.session?.user, out);
    check(`2-${trigger} tab A still shows private data before any return event (expected: nothing has told it yet)`, (await titleValue(a)) === TITLE);
    await a.bringToFront();
    // SYNTHETIC event: headless Chromium cannot produce a real BFCache restore or OS-level window focus here.
    await a.evaluate((t) => {
      if (t === "focus") window.dispatchEvent(new Event("focus"));
      else window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    }, trigger);
    await a.getByRole("heading", { name: "Nur mit dem Eltern-Konto" }).waitFor({ timeout: 5000 });
    check(`2-${trigger} synthetic ${trigger} after sign-out clears private data in tab A`, (await titleValue(a)) === null && (await ownerBadge(a)) === 0 && !(await privateInDom(a)));
    await shot(a, `2-${trigger}-after-signout`);
    await a.reload();
    check(`2-${trigger} signed-out reload redirects to login`, new URL(a.url()).pathname === "/login", a.url());
    await c.close();
  }

  // visibilitychange alone (real hidden/visible cycle is not producible headless; synthetic).
  {
    const c = await context();
    const a = await openSettings(c);
    await setSession(c, null);
    await a.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await a.getByRole("heading", { name: "Nur mit dem Eltern-Konto" }).waitFor({ timeout: 5000 });
    check("2-visibility synthetic visibilitychange after session loss clears private data", (await titleValue(a)) === null);
    await c.close();
  }

  // Account switching: owner → assistant cookie in the same browser, then focus.
  {
    const c = await context();
    const a = await openSettings(c);
    await setSession(c, assistant);
    await a.evaluate(() => window.dispatchEvent(new Event("focus")));
    await a.getByRole("heading", { name: "Nur mit dem Eltern-Konto" }).waitFor({ timeout: 5000 });
    check("2-switch account switch to assistant then focus clears private data (403)", (await titleValue(a)) === null && (await ownerBadge(a)) === 0);
    // Switching back to the owner recovers on the next return — a fresh request, not the cleared data.
    await setSession(c, owner);
    await a.evaluate(() => window.dispatchEvent(new Event("focus")));
    await a.getByLabel("Missions-Titel").waitFor({ timeout: 5000 });
    check("2-switch owner session again recovers by a fresh load", (await titleValue(a)) === TITLE && (await ownerBadge(a)) === 1 && (await deniedVisible(a)) === 0);
    await c.close();
  }

  // Scenario 3: normal sign-out in the same tab through the real Auth.js flow.
  {
    const c = await context();
    const a = await openSettings(c);
    await a.evaluate(async () => {
      const csrf = await fetch("/api/auth/csrf").then((r) => r.json());
      await fetch("/api/auth/signout", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Auth-Return-Redirect": "1" }, body: new URLSearchParams({ csrfToken: csrf.csrfToken, callbackUrl: location.origin + "/login" }) });
    });
    await a.evaluate(() => window.dispatchEvent(new Event("focus")));
    await a.getByRole("heading", { name: "Nur mit dem Eltern-Konto" }).waitFor({ timeout: 5000 });
    check("3 same-tab sign-out then focus clears private data", (await titleValue(a)) === null);
    await a.goto(BASE + "/family/learn/parent");
    check("3 signed-out navigation to parent page lands on login", new URL(a.url()).pathname === "/login", a.url());
    const body = await a.content();
    check("3 login page carries no private data", !body.includes(TITLE));
    // Assistant direct URL: redirected away, never served.
    await setSession(c, assistant);
    await a.goto(BASE + "/family/learn/parent");
    check("3 assistant direct URL is redirected away from the parent page", new URL(a.url()).pathname !== "/family/learn/parent" && !(await a.content()).includes(TITLE), a.url());
    await c.close();
  }
  // ---------------------------------------------------------------------
  // Scenario 4: session resurrection across response origins. A genuine
  // response fetched under the owner session is held; authority is lost
  // (A: assistant cookie, B: real Auth.js sign-out); the held response is
  // released; the browser identity must not become the owner again and a
  // fresh evidence request on focus must stay denied.
  // ---------------------------------------------------------------------
  const identity = async (c) => {
    const cookie = (await c.cookies()).find((k) => k.name === COOKIE);
    if (!cookie) return null;
    return (await decode({ token: cookie.value, secret: SECRET, salt: COOKIE }))?.email ?? "unknown";
  };
  const origins = [
    { key: "child-api", label: "child mission API with real child bearer", pattern: "**/api/family/learning/mission?probe=*", start: async (p, bearer, key) => p.evaluate(({ b, k }) => { window.__held = fetch("/api/family/learning/mission?probe=" + k, { headers: { Authorization: "Bearer " + b } }).then((r) => r.status); }, { b: bearer, k: key }) },
    { key: "page", label: "page document (family dashboard)", pattern: "**/family/dashboard?probe=*", start: async (p, _bearer, key) => p.evaluate((k) => { window.__held = fetch("/family/dashboard?probe=" + k, { headers: { Accept: "text/html" } }).then((r) => r.status); }, key) },
    { key: "auth-session", label: "GET /api/auth/session", pattern: "**/api/auth/session?probe=*", start: async (p, _bearer, key) => p.evaluate((k) => { window.__held = fetch("/api/auth/session?probe=" + k).then((r) => r.status); }, key) },
    { key: "auth-session-post", label: "POST /api/auth/session with genuine CSRF (client update)", pattern: "**/api/auth/session?probe=*", start: async (p, _bearer, key) => p.evaluate(async (k) => { const csrf = await fetch("/api/auth/csrf").then((r) => r.json()); window.__held = fetch("/api/auth/session?probe=" + k, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ csrfToken: csrf.csrfToken, data: {} }) }).then((r) => r.status); }, key) },
  ];
  for (const variant of ["assistant-switch", "real-signout"]) {
    for (const origin of origins) {
      const tag = `4-${variant}-${origin.key}`;
      const c = await context();
      const p = await openSettings(c);
      const bearer = (await call("POST", "/api/family/learning/session", owner, { childId: "santiago" })).json.token;
      let release, resolveHeld;
      const gate = new Promise((r) => (release = r));
      const held = new Promise((r) => (resolveHeld = r));
      await p.route(origin.pattern, async (r) => {
        const real = await r.fetch();
        const body = await real.body();
        resolveHeld({ status: real.status(), sessionCookie: real.headersArray().some((h) => h.name.toLowerCase() === "set-cookie" && /^(?:__Secure-)?authjs\.session-token/i.test(h.value)) });
        await gate;
        await r.fulfill({ response: real, body });
      });
      const probeKey = tag + "-" + Date.now();
      await origin.start(p, bearer, probeKey);
      const info = await held;
      check(`${tag} held genuine owner-session response from ${origin.label} is successful and carries NO session cookie`, info.status === 200 && !info.sessionCookie, info);
      if (variant === "assistant-switch") await setSession(c, assistant);
      else {
        const out = await p.evaluate(async () => {
          const csrf = await fetch("/api/auth/csrf").then((r) => r.json());
          const r = await fetch("/api/auth/signout", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Auth-Return-Redirect": "1" }, body: new URLSearchParams({ csrfToken: csrf.csrfToken, callbackUrl: location.origin + "/login" }) });
          return { status: r.status, session: await fetch("/api/auth/session").then((r) => r.json()) };
        });
        check(`${tag} real Auth.js sign-out clears the identity`, out.status === 200 && !out.session?.user && (await identity(c)) === null, out);
      }
      const denied = p.waitForResponse((r) => r.url().includes("/parent/evidence") && [401, 403].includes(r.status()));
      await p.evaluate(() => window.dispatchEvent(new Event("focus")));
      const denial = await denied;
      await p.getByRole("heading", { name: "Nur mit dem Eltern-Konto" }).waitFor();
      check(`${tag} actual denial clears the view before release`, (await titleValue(p)) === null && (await ownerBadge(p)) === 0, denial.status());
      release();
      const heldStatus = await p.evaluate(() => window.__held);
      const idAfter = await identity(c);
      check(`${tag} released response (status ${heldStatus}) does not restore the owner identity`, heldStatus === 200 && idAfter !== OWNER, { identity: idAfter });
      const fresh = p.waitForResponse((r) => r.url().includes("/parent/evidence"));
      await p.evaluate(() => window.dispatchEvent(new Event("focus")));
      const ev = await fresh;
      await p.waitForTimeout(300);
      const after = { evidenceStatus: ev.status(), title: await titleValue(p), badge: await ownerBadge(p), denied: await deniedVisible(p), privateInDom: await privateInDom(p), identity: await identity(c) };
      check(`${tag} fresh evidence request after focus stays denied; no private data returns`, [401, 403].includes(after.evidenceStatus) && after.title === null && after.badge === 0 && after.denied === 1 && !after.privateInDom && after.identity !== OWNER, after);
      if ((origin.key === "child-api" || origin.key === "auth-session-post") && variant === "real-signout") await shot(p, `${tag}-after-focus`);
      // Genuine new owner login (simulated by installing a freshly minted owner cookie) recovers on the next return.
      await setSession(c, await token(OWNER));
      await p.evaluate(() => window.dispatchEvent(new Event("focus")));
      await p.getByLabel("Missions-Titel").waitFor({ timeout: 5000 });
      check(`${tag} a genuine new owner sign-in recovers by a fresh load`, (await titleValue(p)) === TITLE && (await ownerBadge(p)) === 1 && (await deniedVisible(p)) === 0);
      await c.close();
    }
  }
  // ---------------------------------------------------------------------
  // Scenario 5: fixed expiry is enforced. An owner cookie minted with a
  // short JWT lifetime keeps working across repeated returns (each of which
  // used to re-sign it) and stops working once its exp has passed (Auth.js
  // verifies with a 15 s clock tolerance), without any sign-out — the browser
  // still holds the cookie, the server refuses it.
  // ---------------------------------------------------------------------
  {
    const c = await context();
    const lifetime = 12;
    const short = await encode({ token: { email: OWNER, sub: OWNER, name: OWNER }, secret: SECRET, salt: COOKIE, maxAge: lifetime });
    const minted = Date.now();
    await setSession(c, short);
    const p = await c.newPage();
    await p.goto(BASE + "/family/learn/parent");
    await p.getByRole("tab", { name: "Einstellungen", exact: true }).click();
    await p.getByLabel("Missions-Titel").waitFor();
    let refreshes = 0;
    while (Date.now() - minted < (lifetime - 5) * 1000) {
      const ev = p.waitForResponse((r) => r.url().includes("/parent/evidence"));
      await p.evaluate(() => window.dispatchEvent(new Event("focus")));
      if ((await ev).status() === 200) refreshes++;
      await p.waitForTimeout(700);
    }
    check("5 short-lived owner session keeps working across repeated returns before exp", refreshes >= 3 && (await titleValue(p)) === TITLE, { refreshes });
    const before = (await c.cookies()).find((k) => k.name === COOKIE)?.value;
    check("5 the browser cookie was never re-signed by those returns", before === short);
    const clockTolerance = 15; // Auth.js jwt.decode() tolerance, seconds
    await p.waitForTimeout(Math.max(0, minted + (lifetime + clockTolerance + 2) * 1000 - Date.now()));
    const expired = p.waitForResponse((r) => r.url().includes("/parent/evidence"));
    await p.evaluate(() => window.dispatchEvent(new Event("focus")));
    const status = (await expired).status();
    await p.getByRole("heading", { name: "Nur mit dem Eltern-Konto" }).waitFor({ timeout: 5000 });
    check("5 past the JWT exp the same cookie is refused (401) and the view clears — no sliding renewal", status === 401 && (await titleValue(p)) === null && (await ownerBadge(p)) === 0);
    await p.goto(BASE + "/family/learn/parent");
    check("5 navigation with the expired cookie lands on login", new URL(p.url()).pathname === "/login", p.url());
    await c.close();
  }
} catch (error) {
  check("browser harness completion", false, String(error && error.stack ? error.stack : error));
} finally {
  await browser.close();
  fs.writeFileSync(path.join(OUT, "privacy-results.json"), JSON.stringify(results, null, 2));
  const passed = results.filter((r) => r.ok).length;
  console.log("SUMMARY", passed, "/", results.length);
  process.exitCode = results.some((r) => !r.ok) ? 1 : 0;
}
