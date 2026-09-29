#!/usr/bin/env node
// Local HTTP composition check for the learning cockpit's access rule
// (family-assistant DESIGN §7.6; account rule settled 2026-09-29).
//
// Runs against a LOCAL production server started with a known AUTH_SECRET and
// no Turso (SQLite fallback), e.g.
//
//   AUTH_SECRET=<32+ chars> AUTH_URL=http://localhost:3123 GOOGLE_CLIENT_ID=x \
//   GOOGLE_CLIENT_SECRET=y NABU_DB_DIR=$PWD npx next start -p 3123
//   AUTH_SECRET=<same> node scripts/verify-learning-access.mjs --base http://localhost:3123
//
// It mints REAL NextAuth v5 session cookies (JWE via @auth/core/jwt `encode`
// with the same secret and cookie-name salt) for the owner, the assistant
// (shared child device) account, a forged/other account and an expired
// session, and exercises the actual middleware → page → route composition
// over HTTP for every parent endpoint/method in the inventory, the parent
// page, the child routes, a child learning bearer presented to parent routes
// and an obsolete unlock cookie. This is HTTP evidence on a local build —
// not a browser, not production, not physical-device acceptance.

import { encode } from "@auth/core/jwt";

const args = process.argv.slice(2);
const base = (args[args.indexOf("--base") + 1] || "http://localhost:3123").replace(/\/$/, "");
const secret = process.env.AUTH_SECRET;
if (!secret || secret.length < 32) {
  console.error("AUTH_SECRET (>= 32 chars, same as the server) is required");
  process.exit(2);
}
const COOKIE = "authjs.session-token"; // http origin → no __Secure- prefix

async function sessionCookie(email, { expired = false } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const token = await encode({
    token: { email, name: email, sub: email, iat: expired ? now - 7200 : now, exp: expired ? now - 3600 : now + 3600 },
    secret,
    salt: COOKIE,
    maxAge: expired ? -3600 : 3600,
  });
  return `${COOKIE}=${token}`;
}

const OWNER = "info@davideberle.com";
const ASSISTANT = "assistant@davideberle.com";
const OTHER = "someone@example.com";

const PARENT_API = [
  ["GET", "/api/family/learning/parent/evidence?child=santiago"],
  ["POST", "/api/family/learning/parent/corrections", { child: "santiago", attemptId: "00000000-0000-0000-0000-000000000000", note: "x" }],
  ["DELETE", "/api/family/learning/parent/records?child=isabel&confirm=isabel"],
  ["GET", "/api/family/learning/parent/settings?child=santiago"],
  ["PUT", "/api/family/learning/parent/settings", { child: "santiago", expectedErasureGeneration: 0, missionTitle: "Probe" }],
];
const PARENT_PAGE = "/family/learn/parent";

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function call(method, path, { cookie, bearer, body } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (body) headers["content-type"] = "application/json";
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  let json = null;
  try {
    json = await res.clone().json();
  } catch {
    /* not JSON */
  }
  return { status: res.status, location: res.headers.get("location"), json };
}

async function expectAll(label, cookie, expectedStatuses, extra = {}) {
  for (const [method, path, body] of PARENT_API) {
    const r = await call(method, path, { cookie, body, ...extra });
    const ok = expectedStatuses.includes(r.status);
    record(`${label}: ${method} ${path.split("?")[0]}`, ok, `status ${r.status}`);
  }
}

const owner = await sessionCookie(OWNER);
const assistant = await sessionCookie(ASSISTANT);
const other = await sessionCookie(OTHER);
const expiredOwner = await sessionCookie(OWNER, { expired: true });

// 1. Anonymous: page redirects to login, APIs 401.
{
  const page = await call("GET", PARENT_PAGE);
  record("anonymous: parent page redirects to /login", page.status === 302 && /\/login/.test(page.location ?? ""), `status ${page.status} → ${page.location}`);
  await expectAll("anonymous", undefined, [401]);
}
// 2. Assistant (shared child device): page redirected away, APIs 403; child routes reachable.
{
  const page = await call("GET", PARENT_PAGE, { cookie: assistant });
  record("assistant: parent page redirected to /family/dashboard", page.status === 302 && /\/family\/dashboard/.test(page.location ?? ""), `status ${page.status} → ${page.location}`);
  await expectAll("assistant", assistant, [403]);
  const learn = await call("GET", "/family/learn", { cookie: assistant });
  record("assistant: child cockpit page is served", learn.status === 200, `status ${learn.status}`);
  const mint = await call("POST", "/api/family/learning/session", { cookie: assistant, body: { childId: "santiago" } });
  record("assistant: child learning credential is minted", mint.status === 200 && typeof mint.json?.token === "string", `status ${mint.status}`);
  if (mint.json?.token) {
    const view = await call("GET", "/api/family/learning/mission", { cookie: assistant, bearer: mint.json.token });
    record("assistant + child bearer: mission view is served", view.status === 200 && view.json?.view?.child === "santiago", `status ${view.status}`);
    await expectAll("assistant + child bearer on parent routes", assistant, [403], { bearer: mint.json.token });
  }
  const stale = `${assistant}; family_learning_parent_unlock=flt1.obsolete.cookie`;
  await expectAll("assistant + obsolete unlock cookie", stale, [403]);
}
// 3. Other / forged identity: 403 (page redirected; not an allowed account at all → NextAuth signIn callback
//    would have refused it, but a forged cookie must still be refused server-side).
{
  const page = await call("GET", PARENT_PAGE, { cookie: other });
  record("forged other-account cookie: parent page not served", page.status !== 200, `status ${page.status} → ${page.location}`);
  await expectAll("forged other-account cookie", other, [401, 403]);
}
// 4. Expired owner session = signed out: 401/redirect.
{
  const page = await call("GET", PARENT_PAGE, { cookie: expiredOwner });
  record("expired owner session: parent page redirects to /login", page.status === 302 && /\/login/.test(page.location ?? ""), `status ${page.status} → ${page.location}`);
  await expectAll("expired owner session", expiredOwner, [401]);
}
// 5. Owner: page served, evidence readable, child bearer on parent routes irrelevant but harmless.
{
  const page = await call("GET", PARENT_PAGE, { cookie: owner });
  record("owner: parent page is served", page.status === 200, `status ${page.status}`);
  const ev = await call("GET", "/api/family/learning/parent/evidence?child=santiago", { cookie: owner });
  record("owner: evidence readable and stamped with the owner identity", ev.status === 200 && ev.json?.owner === OWNER && ev.json?.child === "santiago", `status ${ev.status}`);
  const settings = await call("GET", "/api/family/learning/parent/settings?child=isabel", { cookie: owner });
  record("owner: settings snapshot carries an erasure generation", settings.status === 200 && Number.isInteger(settings.json?.erasureGeneration), `status ${settings.status}`);
  const put = await call("PUT", "/api/family/learning/parent/settings", { cookie: owner, body: { child: "isabel", expectedErasureGeneration: settings.json?.erasureGeneration ?? 0, missionTitle: "Lokaler Test" } });
  record("owner: settings write with the snapshot generation succeeds", put.status === 200 && put.json?.settings?.missionTitle === "Lokaler Test", `status ${put.status}`);
  const stalePut = await call("PUT", "/api/family/learning/parent/settings", { cookie: owner, body: { child: "isabel", expectedErasureGeneration: (settings.json?.erasureGeneration ?? 0) + 7, missionTitle: "Stale" } });
  record("owner: settings write with a wrong generation is refused (409)", stalePut.status === 409, `status ${stalePut.status}`);
  const learn = await call("GET", "/family/learn", { cookie: owner });
  record("owner: child cockpit page is served too", learn.status === 200, `status ${learn.status}`);
  const del = await call("DELETE", "/api/family/learning/parent/records?child=isabel&confirm=isabel", { cookie: owner });
  record("owner: deletion of the local test child records succeeds", del.status === 200 && del.json?.deleted === true, `status ${del.status}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
