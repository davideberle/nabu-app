import { deepEqual, equal } from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { guardWithReleaseKey, RELEASE_KEY_LIMIT, RELEASE_KEY_ROUTES, RELEASE_KEY_WINDOW_MS, releaseTokenMatches, resetReleaseKeyLimit } from "./family-learning-release-key.ts";

const KEY = "synthetic-release-key-0123456789-abcdefghijk";
const env = { FAMILY_RELEASE_TOKEN: KEY };
const noOwner = async () => ({ ok: false as const, status: 401, error: "Unauthorized" });
const owner = async () => ({ ok: true as const });
const run = (authorization: string | null, over: Partial<Parameters<typeof guardWithReleaseKey>[0]> = {}) =>
  guardWithReleaseKey({ authorization, route: "records-snapshot", owner: noOwner, env, log: () => {}, ...over });

const API_ROOT = fileURLToPath(new URL("../app/api", import.meta.url));
function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? routeFiles(full) : name === "route.ts" ? [full] : [];
  });
}

describe("release key", () => {
  beforeEach(resetReleaseKeyLimit);

  it("the right key opens the route", async () => {
    deepEqual(await run(`Bearer ${KEY}`), { ok: true, via: "release-key" });
  });

  it("a wrong key is 401, even alongside a valid owner session", async () => {
    let asked = false;
    const out = await run("Bearer not-the-key", { owner: async () => { asked = true; return { ok: true }; } });
    equal(out.ok, false);
    equal(!out.ok && out.status, 401);
    equal(asked, false);
  });

  it("no key and no owner session is 401", async () => {
    for (const header of [null, "", "Bearer", `Basic ${KEY}`, KEY]) {
      const out = await run(header);
      equal(!out.ok && out.status, 401, String(header));
    }
  });

  it("no key with an owner session behaves as before", async () => {
    deepEqual(await run(null, { owner }), { ok: true, via: "owner" });
  });

  it("unset or too short: off; even the former key only reaches the owner guard", async () => {
    for (const off of [{}, { FAMILY_RELEASE_TOKEN: "" }, { FAMILY_RELEASE_TOKEN: "   " }, { FAMILY_RELEASE_TOKEN: "short" }]) {
      let lines = 0;
      const out = await run(`Bearer ${KEY}`, { env: off, log: () => { lines += 1; } });
      equal(!out.ok && out.status, 401);
      equal(lines, 0);
      deepEqual(await run(`Bearer ${KEY}`, { env: off, owner }), { ok: true, via: "owner" });
    }
    equal(!(await run("Bearer short", { env: { FAMILY_RELEASE_TOKEN: "short" } })).ok, true);
  });

  it("compares by digest, whatever the length", () => {
    equal(releaseTokenMatches(KEY, KEY), true);
    equal(releaseTokenMatches(`${KEY}x`, KEY), false);
    equal(releaseTokenMatches("", KEY), false);
  });

  it("every use leaves one audit line with route, time and result, never the token", async () => {
    const lines: string[] = [];
    const log = (l: string) => lines.push(l);
    const now = () => Date.parse("2026-11-09T09:00:00Z");
    await run(`Bearer ${KEY}`, { log, now });
    await run("Bearer wrong-guess-value", { log, now, route: "narration-recording" });
    deepEqual(lines, [
      "[family/learning/release-key] route=records-snapshot at=2026-11-09T09:00:00.000Z result=allowed",
      "[family/learning/release-key] route=narration-recording at=2026-11-09T09:00:00.000Z result=refused",
    ]);
    equal(lines.some((l) => l.includes(KEY) || l.includes("wrong-guess")), false);
  });

  it("rate limit: refused past the limit, also for the right key, and free again after the window", async () => {
    let t = 1_000_000;
    const now = () => t;
    for (let i = 0; i < RELEASE_KEY_LIMIT; i += 1) equal((await run("Bearer guess", { now })).ok, false);
    const over = await run(`Bearer ${KEY}`, { now });
    equal(!over.ok && over.status, 429);
    t += RELEASE_KEY_WINDOW_MS + 1;
    equal((await run(`Bearer ${KEY}`, { now })).ok, true);
  });

  it("each other route refuses the key: only the two listed routes use the guard, each on its one method", () => {
    const users = routeFiles(API_ROOT).filter((f) => readFileSync(f, "utf8").includes("requireOwnerOrReleaseKey"));
    deepEqual(users.map((f) => relative(API_ROOT, f)).sort(), ["family/learning/parent/narration/route.ts", "family/learning/parent/release-snapshot/route.ts"]);
    const handlers = (src: string) => [...src.matchAll(/export async function ([A-Z]+)\(/g)].map((m) => m[1]);
    const narration = readFileSync(join(API_ROOT, "family/learning/parent/narration/route.ts"), "utf8");
    deepEqual(handlers(narration).sort(), ["GET", "POST"]);
    equal(narration.split("export async function POST")[0].includes("requireOwnerOrReleaseKey("), false, "narration GET stays owner only");
    equal(narration.split("export async function POST")[1].includes('requireOwnerOrReleaseKey(request, "narration-recording")'), true);
    deepEqual(handlers(readFileSync(join(API_ROOT, "family/learning/parent/release-snapshot/route.ts"), "utf8")), ["GET"]);
    deepEqual(Object.values(RELEASE_KEY_ROUTES).map((r) => `${r.method} ${r.path}`).sort(), ["GET /api/family/learning/parent/release-snapshot", "POST /api/family/learning/parent/narration"]);
    // The token's name and the release-key module appear in no route at all; the guard is the only door.
    for (const f of routeFiles(API_ROOT)) {
      const src = readFileSync(f, "utf8");
      equal(src.includes("FAMILY_RELEASE_TOKEN") || src.includes("family-learning-release-key"), false, f);
    }
  });

  it("no CORS and no preflight handler on the key routes", () => {
    for (const r of ["narration", "release-snapshot"]) {
      const src = readFileSync(join(API_ROOT, `family/learning/parent/${r}/route.ts`), "utf8");
      equal(/Access-Control|export async function OPTIONS/.test(src), false, r);
    }
  });

  it("the snapshot writes nothing: no shown-marking, no upkeep, no mutation", () => {
    const src = readFileSync(join(API_ROOT, "family/learning/parent/release-snapshot/route.ts"), "utf8");
    equal(src.includes("readChildViewNoWrite"), true);
    equal(src.includes("noDerivedWrites: true"), true);
    equal(/readChildView\(|applyMutation|\.execute\(|beginWrite/.test(src), false);
    const db = readFileSync(new URL("./family-learning-db.ts", import.meta.url), "utf8");
    const noWrite = db.slice(db.indexOf("export async function readChildViewNoWrite"), db.indexOf("async function childViewWith"));
    equal(noWrite.includes("settleShown"), false);
    equal(db.includes("if (content && !options.noDerivedWrites) await ensureHistoricalCompletions"), true);
    equal(db.includes("if (content && !options.noDerivedWrites) await refreshStaleReviews"), true);
  });
});
