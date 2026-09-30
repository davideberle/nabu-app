// HTTP half of the rollback gate: a LOCAL candidate server started with
// FAMILY_LEARNING_CONTENT_CAP=1 on a database whose child has a chapter-4
// visit in flight (e.g. the database left by verify-learning-rollback.mjs).
// Checks that the child cockpit, the mission API and the parent evidence all
// answer 200, that the chapter is parked (nothing offered instead), and that
// nothing is rewritten. Synthetic AUTH_SECRET, no production credential.
//
//   AUTH_SECRET=<same as server> node scripts/verify-learning-rollback-http.mjs --base http://127.0.0.1:3137 --db /tmp/<dir>/nabu.db

import { createRequire } from "node:module";
import { encode } from "@auth/core/jwt";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt("--base", "http://127.0.0.1:3137").replace(/\/$/, "");
const DB = opt("--db", null);
const SECRET = process.env.AUTH_SECRET;
if (!SECRET || SECRET.length < 32) {
  console.error("AUTH_SECRET (>= 32 chars, same as the server) is required");
  process.exit(2);
}
const COOKIE = "authjs.session-token";
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(ok ? "PASS" : "FAIL", name, detail === undefined ? "" : JSON.stringify(detail));
};
const mint = (email) => encode({ token: { email, sub: email, name: email }, secret: SECRET, salt: COOKIE, maxAge: 3600 });
const owner = await mint("info@davideberle.com");
const assistant = await mint("assistant@davideberle.com");
async function call(method, url, body, cookie, bearer) {
  const r = await fetch(BASE + url, { method, redirect: "manual", headers: { cookie: `${COOKIE}=${cookie}`, "content-type": "application/json", ...(bearer ? { authorization: "Bearer " + bearer } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: r.status, json, text };
}
const rowBefore = async () => {
  if (!DB) return null;
  const require = createRequire(import.meta.url);
  const { createClient } = require("@libsql/client");
  const c = createClient({ url: "file:" + DB });
  const row = (await c.execute("SELECT state_json, revision, content_version FROM family_learning_missions WHERE child_id = 'santiago'")).rows[0];
  c.close();
  return row ? { state: String(row.state_json), revision: Number(row.revision), contentVersion: Number(row.content_version) } : null;
};
const before = await rowBefore();

const session = await call("POST", "/api/family/learning/session", { childId: "santiago" }, assistant);
check("capped server mints a child credential (200)", session.status === 200 && !!session.json?.token, session.status);
const bearer = session.json?.token;
const mission = await call("GET", "/api/family/learning/mission", null, assistant, bearer);
const view = mission.json?.view;
check("capped mission API answers 200 with the chapter parked: visit null, reason chapter-unavailable, content v1 served, saved state v2", mission.status === 200 && view && view.visit === null && view.next?.reason === "chapter-unavailable" && view.contentVersion === 2 && /nicht verfügbar/.test(view.nextStep ?? ""), { status: mission.status, next: view?.next, nextStep: view?.nextStep, contentVersion: view?.contentVersion });
check("capped view keeps the base, pages and scene (nothing lost)", view && view.base?.name === "Sonnenküste" && view.pages?.length === 2 && view.scene?.base !== "none", { base: view?.base?.name, pages: view?.pages?.length });
const context = { erasureGeneration: view?.erasureGeneration ?? 0, visit: view?.visit ? { id: view.visit.id, startedAt: view.visit.startedAt } : null };
const refused = await call("PUT", "/api/family/learning/mission", { op: { op: "typing-course-continue" }, expectedRevision: view?.revision ?? 0, idempotencyKey: "rb-http-1", context }, assistant, bearer);
check("a chapter-4 op is refused under the cap (HTTP 422, outcome refused, not applied)", refused.status === 422 && refused.json?.status === "refused", { status: refused.status, outcome: refused.json?.status });
const start = await call("PUT", "/api/family/learning/mission", { op: { op: "start-visit" }, expectedRevision: view?.revision ?? 0, idempotencyKey: "rb-http-2", context }, assistant, bearer);
check("no other visit can start while the chapter is parked (HTTP 422, outcome refused)", start.status === 422 && start.json?.status === "refused", { outcome: start.json?.status });
const cockpit = await fetch(BASE + "/family/learn?child=santiago", { headers: { cookie: `${COOKIE}=${assistant}` } });
const cockpitText = await cockpit.text();
check("child cockpit page renders (200) under the cap", cockpit.status === 200 && cockpitText.length > 1000, cockpit.status);
const evidence = await call("GET", "/api/family/learning/parent/evidence?child=santiago", null, owner);
check("parent evidence answers 200 under the cap with the existing reviews and the v4 records intact", evidence.status === 200 && evidence.json?.completions?.length === 2 && evidence.json?.state?.visits?.some((v) => v.id === "v4") && evidence.json?.contentCounts?.version === 1, { status: evidence.status, completions: evidence.json?.completions?.map((c) => c.visitId), version: evidence.json?.contentCounts?.version });
const parentPage = await fetch(BASE + "/family/learn/parent", { headers: { cookie: `${COOKIE}=${owner}` } });
check("parent page renders (200) under the cap", parentPage.status === 200, parentPage.status);
const after = await rowBefore();
check("the capped server rewrote nothing (state row, revision and stored content version unchanged)", !DB || (before && after && before.state === after.state && before.revision === after.revision && before.contentVersion === after.contentVersion), DB ? { revision: after?.revision, contentVersion: after?.contentVersion } : "no --db given");

const passed = results.filter((r) => r.ok).length;
console.log(JSON.stringify({ base: BASE, passed, total: results.length, results }, null, 2));
console.log(`${passed}/${results.length} capped-server checks passed`);
process.exit(passed === results.length ? 0 : 1);
