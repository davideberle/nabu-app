// Joined stack (GP-03/07/08): the REAL Family persistence (isolated SQLite) wired to the REAL Game Studio child
// adapter through its fetch seam, on one fake clock — the independent reviewer's round-4 timelines plus delayed
// status/settlement variants. Skipped when the Game Studio workspace is not present on this machine. Run: npm test

import { equal, ok } from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createClient, type Client } from "@libsql/client";
import { ensurePlayTables, endPlayLease, getLease, getLeaseStatus, getPlayState, issuePlayLease, recordLeaseActivation, settlePlayLease } from "./family-play-db.ts";

const ADAPTER = "/Users/claweberle/.openclaw/workspace/projects/game-studio/server/child-play-adapter.mjs";
const available = existsSync(ADAPTER);

type Adapter = {
  createChildPlayAdapter: (opts: Record<string, unknown>) => import("node:http").Server & { store: { loadLease: (id: string) => { consumed: number; state: string } | null }; settler: { flush: () => Promise<void>; stop: () => void } };
  derivePlayKey: (secret: string) => Buffer;
  mintPlayCredential: (key: Buffer, claims: Record<string, unknown>) => string;
  signSettlement: (key: Buffer, ts: number, leaseId: string, body: string) => string;
};

describe("joined Family + Studio stack", { skip: !available && "game-studio workspace not present" }, () => {
  let mod: Adapter;
  let dir: string;
  let client: Client;
  const t0 = Date.UTC(2026, 9, 4, 12, 0, 0);
  let clock = t0;
  const at = (s: number) => new Date(t0 + s * 1000);
  let key: Buffer;
  const reports: unknown[] = [];
  let statusGate: { lid: string; gate: Promise<void> } | null = null;
  let settleGate: Promise<void> | null = null;

  before(async () => {
    mod = (await import(ADAPTER)) as Adapter;
    dir = mkdtempSync(join(tmpdir(), "family-joined-"));
    client = createClient({ url: `file:${join(dir, "db.sqlite")}` });
    await client.execute("CREATE TABLE family_completions (person_id TEXT, week TEXT, status TEXT, awarded_points INTEGER)");
    await client.execute("CREATE TABLE family_reward_redemptions (id TEXT PRIMARY KEY, person_id TEXT, reward_id TEXT, week TEXT, created_at TEXT, charged_points INTEGER)");
    await ensurePlayTables(client);
    key = mod.derivePlayKey("isolated-fixture-secret-0123456789012345");
    mkdirSync(join(dir, "adapter"));
    writeFileSync(join(dir, "adapter", "approvals.json"), JSON.stringify({ version: 1, approvals: [{ gameId: "paid-game-1", children: ["santiago"] }] }));
  });
  after(() => {
    client?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function stack() {
    const server = mod.createChildPlayAdapter({
      key,
      dataDir: join(dir, "adapter"),
      settleBase: "http://127.0.0.1:1",
      now: () => clock,
      log: () => {},
      fetchImpl: async (url: string, options: { headers: Record<string, string>; body?: string }) => {
        const id = new URL(url).pathname.split("/").at(-2)!;
        equal(options.headers["x-family-play-signature"], mod.signSettlement(key, Number(options.headers["x-family-play-timestamp"]), id, options.body || ""));
        if (url.endsWith("/status")) {
          const snapshot = (await recordLeaseActivation(id, new Date(clock), client), await getLeaseStatus(id, client));
          if (statusGate && statusGate.lid === id) await statusGate.gate;
          return Response.json(snapshot ?? { error: "not-found" }, { status: snapshot ? 200 : 404 });
        }
        if (settleGate) await settleGate;
        const body = JSON.parse(options.body!);
        const result = await settlePlayLease({ ...body, now: new Date(clock) }, client);
        reports.push({ body, result });
        return Response.json(result);
      },
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    return { server, base };
  }
  const cred = (lid: string) => mod.mintPlayCredential(key, { sub: "santiago", scope: "lease", gid: "paid-game-1", lid, mode: "play", metered: true, budget: 900, iat: Math.floor(clock / 1000), exp: Math.floor(clock / 1000) + 1200, jti: lid });
  const tick = async (base: string, lid: string, token: string) => {
    const r = await fetch(`${base}/v1/play/${lid}/tick`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: '{"active":true}' });
    return { status: r.status, body: (await r.json()) as { consumedSeconds: number; ended: boolean } };
  };
  async function allowance(seconds = 900) {
    await client.execute("DELETE FROM family_play_leases");
    await client.execute("DELETE FROM family_play_allowances");
    await client.execute({ sql: "INSERT INTO family_play_allowances VALUES (?, ?, 0, ?)", args: ["santiago", seconds, at(0).toISOString()] });
  }

  it("R4-1 timeline: A activates at t0, Family ends A at t1 and issues B 899, A's heartbeat at t3 is refused and measures nothing — measured + usable = 900", async () => {
    await allowance();
    clock = t0;
    await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-a001", takeover: true, deviceLabel: null, now: at(0) }, client);
    const { server, base } = await stack();
    try {
      const a = cred("lease-joined-a001");
      equal((await tick(base, "lease-joined-a001", a)).status, 200);
      clock = t0 + 1000;
      equal(await endPlayLease({ leaseId: "lease-joined-a001", personId: "santiago", reason: "left", now: at(1) }, client), true);
      const b = await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-b001", takeover: true, deviceLabel: null, now: at(1) }, client);
      ok(b.ok);
      clock = t0 + 3000;
      const cached = await tick(base, "lease-joined-a001", a);
      equal(cached.status, 410, "no cached authority: refused at t3");
      equal(cached.body.consumedSeconds, 1, "the authorized foreground second before Family's end is charged exactly once");
      await server.settler.flush();
      const meter = server.store.loadLease("lease-joined-a001")!;
      const next = (await getLease("lease-joined-b001", client))!;
      equal(meter.consumed, 1);
      equal(next.budgetSeconds, 899);
      equal(meter.consumed + next.budgetSeconds, 900, "known foreground + usable = purchased");
      equal((await getPlayState("santiago", client)).activeLease?.id, "lease-joined-b001");
    } finally {
      server.settler.stop();
      await new Promise((r) => server.close(r));
    }
  });

  it("explicit end: the foreground seconds before a Studio /end are charged once and the successor gets exactly the rest", async () => {
    await allowance();
    clock = t0;
    await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-a004", takeover: true, deviceLabel: null, now: at(0) }, client);
    const { server, base } = await stack();
    try {
      const a = cred("lease-joined-a004");
      equal((await tick(base, "lease-joined-a004", a)).status, 200);
      clock = t0 + 5000;
      const r = await fetch(`${base}/v1/play/lease-joined-a004/end`, { method: "POST", headers: { authorization: `Bearer ${a}`, "content-type": "application/json" }, body: '{"reason":"left"}' });
      const body = (await r.json()) as { consumedSeconds: number };
      equal(r.status, 200);
      equal(body.consumedSeconds, 5);
      await server.settler.flush();
      const b = await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-b004", takeover: true, deviceLabel: null, now: at(5) }, client);
      ok(b.ok);
      equal(b.lease.budgetSeconds, 895);
      equal(5 + b.lease.budgetSeconds, 900);
    } finally {
      server.settler.stop();
      await new Promise((r) => server.close(r));
    }
  });

  it("delayed status variant: Family ends A while A's confirming read is in flight — counting is bounded to the read's instant; B stays the single consumer", async () => {
    await allowance();
    clock = t0;
    await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-a002", takeover: true, deviceLabel: null, now: at(0) }, client);
    const { server, base } = await stack();
    try {
      const a = cred("lease-joined-a002");
      equal((await tick(base, "lease-joined-a002", a)).status, 200);
      clock = t0 + 2000;
      let release!: () => void;
      statusGate = { lid: "lease-joined-a002", gate: new Promise<void>((r) => { release = r; }) };
      const pending = tick(base, "lease-joined-a002", a); // confirming read issued at t2 (Family still says active)
      await new Promise((r) => setTimeout(r, 40));
      clock = t0 + 2500;
      await endPlayLease({ leaseId: "lease-joined-a002", personId: "santiago", reason: "left", now: new Date(clock) }, client);
      const b = await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-b002", takeover: true, deviceLabel: null, now: new Date(clock) }, client);
      ok(b.ok);
      clock = t0 + 6000;
      release();
      statusGate = null;
      const late = await pending;
      // The t2 snapshot is 4 s old when it arrives: it is history, not authority. The adapter re-reads,
      // learns Family ended A at t2.5, charges the authorized interval up to that end and refuses play.
      equal(late.status, 410, JSON.stringify(late.body));
      equal(late.body.ended, true);
      equal(late.body.consumedSeconds, 2.5, "counted exactly up to Family's end at t2.5, never thawed");
      equal(server.store.loadLease("lease-joined-a002")!.state, "ended");
      clock = t0 + 7000;
      equal((await tick(base, "lease-joined-a002", a)).status, 410);
      await server.settler.flush();
      const meter = server.store.loadLease("lease-joined-a002")!;
      const next = (await getLease("lease-joined-b002", client))!;
      equal(meter.consumed, 2.5);
      // The terminal report rounds the fractional last second up (3): the child is charged for it, B gets 897.
      equal(next.budgetSeconds, 897, `successor ${next.budgetSeconds}`);
      ok(meter.consumed + next.budgetSeconds <= 900, `measured ${meter.consumed} + usable ${next.budgetSeconds}`);
      equal((await getPlayState("santiago", client)).activeLease?.id, "lease-joined-b002");
    } finally {
      server.settler.stop();
      await new Promise((r) => server.close(r));
    }
  });

  it("delayed settlement variant: A's final report lands after B was issued — the measured seconds are charged to the child and B shrinks, totals stay at 900", async () => {
    await allowance();
    clock = t0;
    await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-a003", takeover: true, deviceLabel: null, now: at(0) }, client);
    const { server, base } = await stack();
    try {
      const a = cred("lease-joined-a003");
      equal((await tick(base, "lease-joined-a003", a)).status, 200);
      let releaseSettle!: () => void;
      settleGate = new Promise<void>((r) => { releaseSettle = r; });
      for (let i = 1; i <= 8; i += 1) {
        clock = t0 + i * 5000;
        equal((await tick(base, "lease-joined-a003", a)).status, 200);
      }
      // 40 s measured; the 30 s report is stuck in flight. Family ends A at t41 and issues B.
      clock = t0 + 41000;
      await endPlayLease({ leaseId: "lease-joined-a003", personId: "santiago", reason: "left", now: new Date(clock) }, client);
      const b = await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-b003", takeover: true, deviceLabel: null, now: new Date(clock) }, client);
      ok(b.ok);
      equal(b.lease.budgetSeconds, 900 - 41, "A may still report up to the 41 s since issue");
      clock = t0 + 42000;
      equal((await tick(base, "lease-joined-a003", a)).status, 410);
      releaseSettle();
      settleGate = null;
      await server.settler.flush();
      const meter = server.store.loadLease("lease-joined-a003")!;
      const next = (await getLease("lease-joined-b003", client))!;
      const old = (await getLease("lease-joined-a003", client))!;
      equal(old.consumedSeconds, 41, "the 40 reported seconds plus the authorized second up to Family's end at t41 are charged, none refused");
      equal(next.budgetSeconds, 859, "B is reconciled to the real remaining allowance");
      equal(meter.consumed + next.budgetSeconds, 900);
    } finally {
      server.settler.stop();
      await new Promise((r) => server.close(r));
    }
  });
});
