// Route-level authorization for the New plays routes: browser session vs
// trusted runtime token, per operation. Also pins each route file to the
// operation it must guard with, so a route cannot silently fall back to the
// looser session-or-runtime guard.
import { describe, it } from "node:test";
import { deepStrictEqual, equal, match } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateNewPlaysRouteAccess,
  RUNTIME_ONLY_OPERATIONS,
  type NewPlaysRouteOperation,
} from "./music-new-plays-auth.ts";

const TOKEN = "runtime-token-with-enough-length-0123456789";
const BROWSER = { user: { email: "info@davideberle.com" } };
const TRACKER = { user: { email: "assistant@davideberle.com" } };
const ALL: NewPlaysRouteOperation[] = ["list", "mirror-put", "enqueue", "outbox-get", "ack"];

describe("evaluateNewPlaysRouteAccess", () => {
  it("runtime-only operations are exactly mirror PUT, pending-outbox GET and ack POST", () => {
    deepStrictEqual([...RUNTIME_ONLY_OPERATIONS].sort(), ["ack", "mirror-put", "outbox-get"]);
  });

  it("an ordinary signed-in browser may list and enqueue only", () => {
    delete process.env.IPAD_TRACKER_ONLY_EMAILS;
    deepStrictEqual(evaluateNewPlaysRouteAccess("list", BROWSER, null, { token: TOKEN }), { allowed: true, via: "session" });
    deepStrictEqual(evaluateNewPlaysRouteAccess("enqueue", BROWSER, null, { token: TOKEN }), { allowed: true, via: "session" });
    for (const op of ["mirror-put", "outbox-get", "ack"] as const) {
      deepStrictEqual(evaluateNewPlaysRouteAccess(op, BROWSER, null, { token: TOKEN }), { allowed: false, status: 403, error: "Forbidden" }, op);
    }
  });

  it("the trusted runtime token authorizes every operation", () => {
    for (const op of ALL) {
      deepStrictEqual(evaluateNewPlaysRouteAccess(op, null, `Bearer ${TOKEN}`, { token: TOKEN }), { allowed: true, via: "trusted-runtime" }, op);
    }
  });

  it("a browser session plus a WRONG bearer is still just a browser", () => {
    deepStrictEqual(evaluateNewPlaysRouteAccess("mirror-put", BROWSER, "Bearer nope-nope-nope-nope-nope-nope", { token: TOKEN }), { allowed: false, status: 403, error: "Forbidden" });
    deepStrictEqual(evaluateNewPlaysRouteAccess("list", BROWSER, "Bearer nope-nope-nope-nope-nope-nope", { token: TOKEN }), { allowed: true, via: "session" });
  });

  it("no configured server token: bearer grants nothing, runtime-only ops are unreachable", () => {
    for (const op of ["mirror-put", "outbox-get", "ack"] as const) {
      deepStrictEqual(evaluateNewPlaysRouteAccess(op, null, `Bearer ${TOKEN}`, { token: null }), { allowed: false, status: 401, error: "Unauthorized" }, op);
      deepStrictEqual(evaluateNewPlaysRouteAccess(op, BROWSER, `Bearer ${TOKEN}`, { token: null }), { allowed: false, status: 403, error: "Forbidden" }, op);
    }
  });

  it("anonymous gets 401 and the tracker-only iPad account gets 403 everywhere", () => {
    delete process.env.IPAD_TRACKER_ONLY_EMAILS;
    for (const op of ALL) {
      deepStrictEqual(evaluateNewPlaysRouteAccess(op, null, null, { token: TOKEN }), { allowed: false, status: 401, error: "Unauthorized" }, op);
      deepStrictEqual(evaluateNewPlaysRouteAccess(op, TRACKER, null, { token: TOKEN }), { allowed: false, status: 403, error: "Forbidden" }, op);
    }
  });
});

describe("route files bind to the per-operation guard", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const routes = join(here, "..", "app", "api", "music", "new-plays");
  const read = (rel: string) => readFileSync(join(routes, rel), "utf8");

  it("GET/PUT /api/music/new-plays guard list vs mirror-put", () => {
    const src = read("route.ts");
    match(src, /export async function GET[\s\S]*?guardNewPlaysRoute\(request, "list"\)/);
    match(src, /export async function PUT[\s\S]*?guardNewPlaysRoute\(request, "mirror-put"\)/);
    equal(src.includes("guardRuntimeWrite("), false);
  });

  it("POST/GET /api/music/new-plays/actions guard enqueue vs outbox-get", () => {
    const src = read("actions/route.ts");
    match(src, /export async function POST[\s\S]*?guardNewPlaysRoute\(request, "enqueue"\)/);
    match(src, /export async function GET[\s\S]*?guardNewPlaysRoute\(request, "outbox-get"\)/);
    equal(src.includes("guardRuntimeWrite("), false);
  });

  it("POST /api/music/new-plays/actions/ack guards ack", () => {
    const src = read("actions/ack/route.ts");
    match(src, /export async function POST[\s\S]*?guardNewPlaysRoute\(request, "ack"\)/);
    equal(src.includes("guardRuntimeWrite("), false);
  });
});
