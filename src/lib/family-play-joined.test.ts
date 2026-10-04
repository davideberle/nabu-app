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
  createChildPlayAdapter: (opts: Record<string, unknown>) => import("node:http").Server & { store: { loadLease: (id: string) => { consumed: number; state: string; endReason: string | null } | null }; settler: { flush: () => Promise<void>; stop: () => void }; sweep: () => number };
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
  /** When true the fake transport fails every Family call (outage). */
  let outage = false;
  /** Resolves when the next settlement report is observed by the gate (before it is held). */
  let settleObserved: (() => void) | null = null;

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

  let stacks = 0;
  /** One fresh meter data dir per instance: the fake clock restarts at t0 in every case, so no earlier session's deadline may leak in. */
  async function stack(dataDirName = `adapter-${(stacks += 1)}`) {
    const dataDir = join(dir, dataDirName);
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir);
      writeFileSync(join(dataDir, "approvals.json"), JSON.stringify({ version: 1, approvals: [{ gameId: "paid-game-1", children: ["santiago"] }] }));
    }
    const server = mod.createChildPlayAdapter({
      key,
      dataDir,
      settleBase: "http://127.0.0.1:1",
      now: () => clock,
      log: () => {},
      fetchImpl: async (url: string, options: { headers: Record<string, string>; body?: string }) => {
        if (outage) throw new Error("isolated outage");
        const id = new URL(url).pathname.split("/").at(-2)!;
        equal(options.headers["x-family-play-signature"], mod.signSettlement(key, Number(options.headers["x-family-play-timestamp"]), id, options.body || ""));
        if (url.endsWith("/status")) {
          // Like the real status route: one instant for the activation (window grant) and the answer.
          const readAt = new Date(clock);
          const snapshot = (await recordLeaseActivation(id, readAt, client), await getLeaseStatus(id, client, readAt));
          if (statusGate && statusGate.lid === id) await statusGate.gate;
          return Response.json(snapshot ?? { error: "not-found" }, { status: snapshot ? 200 : 404 });
        }
        settleObserved?.();
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
  const cred = (lid: string, ttlSeconds = 1200) => mod.mintPlayCredential(key, { sub: "santiago", scope: "lease", gid: "paid-game-1", lid, mode: "play", metered: true, budget: 900, iat: Math.floor(clock / 1000), exp: Math.floor(clock / 1000) + ttlSeconds, jti: lid });
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
      // A's meter held an authority window until t2 (its read at t0): Family's end takes effect at that fence,
      // B is issued with 898 and A may lawfully measure up to t2.
      ok(b.ok && b.lease.budgetSeconds === 898, `B ${b.ok ? b.lease.budgetSeconds : "-"}`);
      clock = t0 + 3000;
      const cached = await tick(base, "lease-joined-a001", a);
      equal(cached.status, 410, "no cached authority: refused at t3");
      equal(cached.body.consumedSeconds, 2, "the authorized foreground up to Family's effective end (the fence) is charged exactly once");
      await server.settler.flush();
      const meter = server.store.loadLease("lease-joined-a001")!;
      const next = (await getLease("lease-joined-b001", client))!;
      equal(meter.consumed, 2);
      equal(next.budgetSeconds, 898);
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
      // The t2 snapshot's authority window (until t4) closed before it arrived: it is history, not authority.
      // The adapter re-reads, learns Family ended A at the fence t4, charges the interval up to it and refuses play.
      equal(late.status, 410, JSON.stringify(late.body));
      equal(late.body.ended, true);
      equal(late.body.consumedSeconds, 4, "counted exactly up to Family's effective end (the fence at t4), never thawed");
      equal(server.store.loadLease("lease-joined-a002")!.state, "ended");
      clock = t0 + 7000;
      equal((await tick(base, "lease-joined-a002", a)).status, 410);
      await server.settler.flush();
      const meter = server.store.loadLease("lease-joined-a002")!;
      const next = (await getLease("lease-joined-b002", client))!;
      equal(meter.consumed, 4);
      equal(next.budgetSeconds, 896, `successor ${next.budgetSeconds}`);
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
      // A's read at t40 holds a window until t42: Family's end takes effect at that fence, so A may still report up to 42 s.
      equal(b.lease.budgetSeconds, 900 - 42, "A may still report up to the 42 s fence");
      clock = t0 + 42000;
      equal((await tick(base, "lease-joined-a003", a)).status, 410);
      releaseSettle();
      settleGate = null;
      await server.settler.flush();
      const meter = server.store.loadLease("lease-joined-a003")!;
      const next = (await getLease("lease-joined-b003", client))!;
      const old = (await getLease("lease-joined-a003", client))!;
      equal(old.consumedSeconds, 42, "the 40 reported seconds plus the authorized 2 s up to Family's effective end are charged, none refused");
      equal(next.budgetSeconds, 858, "B is reconciled to the real remaining allowance");
      equal(meter.consumed + next.budgetSeconds, 900);
    } finally {
      server.settler.stop();
      await new Promise((r) => server.close(r));
    }
  });
  // ---- round 6: the reviewer's remaining timelines, on the real Family persistence + real adapter --------------

  it("R6-1 expiry-terminal: the credential expires at t5 after an active tick at t0 — the tick at t5 is refused, 5 s are charged and reported, B gets 895", async () => {
    await allowance();
    clock = t0;
    await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-a005", takeover: true, deviceLabel: null, now: at(0) }, client);
    const { server, base } = await stack();
    try {
      const a = cred("lease-joined-a005", 5);
      equal((await tick(base, "lease-joined-a005", a)).status, 200);
      clock = t0 + 5000;
      const refused = await tick(base, "lease-joined-a005", a);
      equal(refused.status, 401);
      await server.settler.flush();
      const meter = server.store.loadLease("lease-joined-a005")!;
      equal(meter.consumed, 5, "known foreground up to the expiry is charged once");
      equal(meter.endReason, "credential-expired");
      const b = await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-b005", takeover: true, deviceLabel: null, now: at(5) }, client);
      ok(b.ok);
      equal(b.lease.budgetSeconds, 895);
      equal(meter.consumed + b.lease.budgetSeconds, 900);
    } finally {
      server.settler.stop();
      await new Promise((r) => server.close(r));
    }
  });

  it("R6-1 outage-end: Family is reachable during the foreground t0–t5 and unreachable first at the explicit end — the end charges 5 s, the queued terminal report lands later, B gets 895", async () => {
    await allowance();
    clock = t0;
    await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-a006", takeover: true, deviceLabel: null, now: at(0) }, client);
    const { server, base } = await stack();
    try {
      const a = cred("lease-joined-a006");
      equal((await tick(base, "lease-joined-a006", a)).status, 200);
      clock = t0 + 5000;
      outage = true;
      const r = await fetch(`${base}/v1/play/lease-joined-a006/end`, { method: "POST", headers: { authorization: `Bearer ${a}`, "content-type": "application/json" }, body: '{"reason":"left"}' });
      const body = (await r.json()) as { consumedSeconds: number };
      equal(r.status, 200);
      equal(body.consumedSeconds, 5, "the end attests the preceding live foreground");
      outage = false;
      await server.settler.flush();
      const old = (await getLease("lease-joined-a006", client))!;
      equal(old.consumedSeconds, 5);
      equal(old.finalSettled, true);
      const b = await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-b006", takeover: true, deviceLabel: null, now: at(5) }, client);
      ok(b.ok);
      equal(b.lease.budgetSeconds, 895);
      equal(5 + b.lease.budgetSeconds, 900);
    } finally {
      server.settler.stop();
      await new Promise((r) => server.close(r));
    }
  });

  it("R6-1 settlement-revocation: ticks to t30 (report held), Family ends A and issues B at t35, the delayed acknowledgement charges the final 5 s once, the sweep adds nothing — 35 + 865 = 900", async () => {
    await allowance();
    clock = t0;
    await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-a007", takeover: true, deviceLabel: null, now: at(0) }, client);
    const { server, base } = await stack();
    try {
      const a = cred("lease-joined-a007");
      equal((await tick(base, "lease-joined-a007", a)).status, 200);
      let releaseSettle!: () => void;
      settleGate = new Promise<void>((r) => { releaseSettle = r; });
      const seen = new Promise<void>((r) => { settleObserved = r; });
      for (let i = 1; i <= 6; i += 1) {
        clock = t0 + i * 5000;
        equal((await tick(base, "lease-joined-a007", a)).status, 200);
      }
      await seen;
      settleObserved = null;
      clock = t0 + 35000;
      equal(await endPlayLease({ leaseId: "lease-joined-a007", personId: "santiago", reason: "left", now: at(35) }, client), true);
      const b = await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-b007", takeover: true, deviceLabel: null, now: at(35) }, client);
      ok(b.ok);
      equal(b.lease.budgetSeconds, 865, "A's 35 s since issue are reserved until it reports");
      releaseSettle();
      settleGate = null;
      await server.settler.flush();
      server.sweep();
      await server.settler.flush();
      const meter = server.store.loadLease("lease-joined-a007")!;
      equal(meter.state, "ended");
      equal(meter.consumed, 35, "the final 5 s up to Family's end are charged once");
      const old = (await getLease("lease-joined-a007", client))!;
      equal(old.consumedSeconds, 35);
      equal(old.finalSettled, true);
      const next = (await getLease("lease-joined-b007", client))!;
      equal(next.budgetSeconds, 865);
      equal(meter.consumed + next.budgetSeconds, 900);
    } finally {
      server.settler.stop();
      await new Promise((r) => server.close(r));
    }
  });

  it("R6-2 short delayed status (1 s): inside its window the t2 answer is authority; Family holds B PENDING until the fence (t4) — another meter refuses B (409) until then, A ends at the fence with 4 s; totals stay at 900", async () => {
    await allowance();
    clock = t0;
    await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-a008", takeover: true, deviceLabel: null, now: at(0) }, client);
    const { server, base } = await stack();
    const other = await stack("adapter-other"); // the meter instance device B reaches (no knowledge of A)
    try {
      const a = cred("lease-joined-a008");
      equal((await tick(base, "lease-joined-a008", a)).status, 200);
      clock = t0 + 2000;
      let release!: () => void;
      statusGate = { lid: "lease-joined-a008", gate: new Promise<void>((r) => { release = r; }) };
      const pending = tick(base, "lease-joined-a008", a); // confirming read at t2: window until t4
      await new Promise((r) => setTimeout(r, 40));
      clock = t0 + 2500;
      await endPlayLease({ leaseId: "lease-joined-a008", personId: "santiago", reason: "left", now: new Date(clock) }, client);
      const b = await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-b008", takeover: true, deviceLabel: null, now: new Date(clock) }, client);
      ok(b.ok);
      equal(b.handoverAt, at(4).toISOString(), "B is fenced by A's window");
      equal(b.lease.budgetSeconds, 896, "A may lawfully still measure up to the fence");
      clock = t0 + 3000;
      release();
      statusGate = null;
      const inside = await pending;
      equal(inside.status, 200, "inside the granted window the answer is authority (Family holds the successor back)");
      equal(inside.body.consumedSeconds, 2);
      // B is NOT runnable anywhere while A's window is open: Family says pending; a meter that does not hold A refuses it and counts nothing.
      const bStatus = (await getLeaseStatus("lease-joined-b008", client, new Date(clock)))!;
      equal(bStatus.state, "pending");
      equal(bStatus.startsAt, at(4).toISOString());
      const bCred = cred("lease-joined-b008");
      const refused = await tick(other.base, "lease-joined-b008", bCred);
      equal(refused.status, 409, JSON.stringify(refused.body));
      equal(other.server.store.loadLease("lease-joined-b008"), null, "never activated while pending");
      // At the fence Family's end applies to A: its next heartbeat is refused and the interval up to t4 is charged once.
      clock = t0 + 5000;
      const after = await tick(base, "lease-joined-a008", a);
      equal(after.status, 410, JSON.stringify(after.body));
      equal(after.body.consumedSeconds, 4);
      // ...and B is runnable: the other meter activates it.
      equal((await getLeaseStatus("lease-joined-b008", client, new Date(clock)))!.state, "active");
      const started = await tick(other.base, "lease-joined-b008", bCred);
      equal(started.status, 200, JSON.stringify(started.body));
      await server.settler.flush();
      const old = (await getLease("lease-joined-a008", client))!;
      const next = (await getLease("lease-joined-b008", client))!;
      equal(old.consumedSeconds, 4);
      equal(old.finalSettled, true);
      equal(next.budgetSeconds, 896);
      equal(old.consumedSeconds + next.budgetSeconds, 900);
      equal((await getPlayState("santiago", client)).activeLease?.id, "lease-joined-b008");
    } finally {
      server.settler.stop();
      other.server.settler.stop();
      await new Promise((r) => server.close(r));
      await new Promise((r) => other.server.close(r));
    }
  });

  it("R6-2 same-meter handover: a pending successor's first read acknowledges the predecessor at once (its foreground counted, terminal report sent) and Family releases the fence before t4; totals stay at 900", async () => {
    await allowance();
    clock = t0;
    await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-a010", takeover: true, deviceLabel: null, now: at(0) }, client);
    const { server, base } = await stack();
    try {
      const a = cred("lease-joined-a010");
      equal((await tick(base, "lease-joined-a010", a)).status, 200);
      clock = t0 + 2000;
      equal((await tick(base, "lease-joined-a010", a)).status, 200); // window until t4
      clock = t0 + 2500;
      await endPlayLease({ leaseId: "lease-joined-a010", personId: "santiago", reason: "left", now: new Date(clock) }, client);
      const b = await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-b010", takeover: true, deviceLabel: null, now: new Date(clock) }, client);
      ok(b.ok);
      equal(b.handoverAt, at(4).toISOString());
      clock = t0 + 3000;
      equal((await getLeaseStatus("lease-joined-b010", client, new Date(clock)))!.state, "pending");
      // B's read acknowledges A on this meter (A's meter ends, 3 s counted and reported, Family releases its fence) —
      // but B is NOT activated while A's frame deadline (t4, the window handed to A's wrapper) is open: 409, retry.
      const blocked = await tick(base, "lease-joined-b010", cred("lease-joined-b010"));
      equal(blocked.status, 409, JSON.stringify(blocked.body));
      ok((blocked.body as { retryAfterMs?: number }).retryAfterMs! <= 1000);
      const meter = server.store.loadLease("lease-joined-a010")!;
      equal(meter.state, "ended");
      equal(meter.consumed, 3, "A: 2 s confirmed + 1 s up to the successor's read (inside A's own window)");
      const old = (await getLease("lease-joined-a010", client))!;
      equal(old.consumedSeconds, 3);
      equal(old.finalSettled, true, "A's terminal report released Family's fence before t4");
      equal((await getLeaseStatus("lease-joined-b010", client, new Date(clock)))!.state, "active");
      equal(server.store.loadLease("lease-joined-b010"), null, "not activated while A's frame may still run");
      clock = t0 + 4000;
      const started = await tick(base, "lease-joined-b010", cred("lease-joined-b010"));
      equal(started.status, 200, JSON.stringify(started.body));
      ok((started.body as { authorizedForMs?: number }).authorizedForMs! > 0, "the answer carries the authority deadline for the frame");
      const next = (await getLease("lease-joined-b010", client))!;
      equal(next.budgetSeconds, 897);
      equal(old.consumedSeconds + next.budgetSeconds, 900);
      equal((await tick(base, "lease-joined-a010", a)).status, 410);
    } finally {
      server.settler.stop();
      await new Promise((r) => server.close(r));
    }
  });

  it("R6-2 exact 2 s status: the t2 answer arrives as its window closes — not authority; A is re-read, ends at Family's fence and B is the single consumer", async () => {
    await allowance();
    clock = t0;
    await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-a009", takeover: true, deviceLabel: null, now: at(0) }, client);
    const { server, base } = await stack();
    try {
      const a = cred("lease-joined-a009");
      equal((await tick(base, "lease-joined-a009", a)).status, 200);
      clock = t0 + 2000;
      let release!: () => void;
      statusGate = { lid: "lease-joined-a009", gate: new Promise<void>((r) => { release = r; }) };
      const pending = tick(base, "lease-joined-a009", a);
      await new Promise((r) => setTimeout(r, 40));
      clock = t0 + 2500;
      await endPlayLease({ leaseId: "lease-joined-a009", personId: "santiago", reason: "left", now: new Date(clock) }, client);
      const b = await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-b009", takeover: true, deviceLabel: null, now: new Date(clock) }, client);
      ok(b.ok);
      clock = t0 + 4000;
      release();
      statusGate = null;
      const late = await pending;
      equal(late.status, 410, JSON.stringify(late.body));
      equal(late.body.consumedSeconds, 4, "counted up to Family's effective end (the fence at t4), never past it");
      equal((await getLeaseStatus("lease-joined-b009", client, new Date(clock)))!.state, "active", "the fence lapsed: B is runnable");
      await server.settler.flush();
      const meter = server.store.loadLease("lease-joined-a009")!;
      const next = (await getLease("lease-joined-b009", client))!;
      equal(meter.consumed + next.budgetSeconds, 900, `measured ${meter.consumed} + usable ${next.budgetSeconds}`);
      const bTick = await tick(base, "lease-joined-b009", cred("lease-joined-b009"));
      equal(bTick.status, 200, JSON.stringify(bTick.body));
    } finally {
      server.settler.stop();
      await new Promise((r) => server.close(r));
    }
  });
});
