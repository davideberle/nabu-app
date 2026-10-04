// Joined stack (GP-03/07/08): the REAL Family persistence (isolated SQLite) wired to the REAL Game Studio child
// adapter through its fetch seam, on one fake clock — the independent reviewer's round-4 timelines plus delayed
// status/settlement variants. Skipped when the Game Studio workspace is not present on this machine. Run: npm test

import { deepEqual, equal, ok } from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { createClient, type Client } from "@libsql/client";
import { ensurePlayTables, endPlayLease, getLease, getLeaseStatus, getPlayState, issuePlayLease, recordLeaseActivation, settlePlayLease } from "./family-play-db.ts";
import { createHeartbeat, type HeartbeatInput } from "./family-play-heartbeat.ts";

const ADAPTER = "/Users/claweberle/.openclaw/workspace/projects/game-studio/server/child-play-adapter.mjs";
const available = existsSync(ADAPTER);

type Adapter = {
  createChildPlayAdapter: (opts: Record<string, unknown>) => import("node:http").Server & { store: { loadLease: (id: string) => { consumed: number; state: string; endReason: string | null; lastActive: boolean; session: { evidenced?: boolean } | null } | null }; settler: { flush: () => Promise<void>; stop: () => void }; sweep: () => number };
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
  // A failed case must not leak a held gate into the next one (a held settle gate would hang every later flush).
  beforeEach(() => {
    statusGate = null;
    settleGate = null;
    settleObserved = null;
    outage = false;
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
  /** Play at the wrapper's cadence: one live heartbeat per second from `fromSec`+1 to `toSec` (each inside the 2 s grant handed before it). */
  const playUntil = async (base: string, lid: string, token: string, fromSec: number, toSec: number) => {
    let last: Awaited<ReturnType<typeof tick>> | null = null;
    for (let sec = fromSec + 1; sec <= toSec; sec += 1) {
      clock = t0 + sec * 1000;
      last = await tick(base, lid, token);
      equal(last.status, 200, `heartbeat at t${sec}: ${JSON.stringify(last.body)}`);
    }
    return last;
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
      await playUntil(base, "lease-joined-a004", a, 0, 4);
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
      equal(late.body.consumedSeconds, 2, "counted up to the frame deadline handed at t0 (t2): the frame froze there, before Family's fence at t4");
      equal(server.store.loadLease("lease-joined-a002")!.state, "ended");
      clock = t0 + 7000;
      equal((await tick(base, "lease-joined-a002", a)).status, 410);
      await server.settler.flush();
      const meter = server.store.loadLease("lease-joined-a002")!;
      const next = (await getLease("lease-joined-b002", client))!;
      equal(meter.consumed, 2);
      equal(next.budgetSeconds, 898, `successor ${next.budgetSeconds}`);
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
      await playUntil(base, "lease-joined-a003", a, 0, 40);
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
      await playUntil(base, "lease-joined-a005", a, 0, 4);
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
      await playUntil(base, "lease-joined-a006", a, 0, 4);
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
      await playUntil(base, "lease-joined-a007", a, 0, 30);
      await seen;
      settleObserved = null;
      await playUntil(base, "lease-joined-a007", a, 30, 34);
      clock = t0 + 35000;
      equal(await endPlayLease({ leaseId: "lease-joined-a007", personId: "santiago", reason: "left", now: at(35) }, client), true);
      const b = await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-b007", takeover: true, deviceLabel: null, now: at(35) }, client);
      ok(b.ok);
      equal(b.lease.budgetSeconds, 864, "A's 35 s since issue plus its open window (its t34 read reaches t36) are reserved until it reports");
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
      equal(after.body.consumedSeconds, 2, "A's frame froze at the deadline handed at t0 (t2); the t3 answer handed none it could use");
      // ...and B is runnable: the other meter activates it.
      equal((await getLeaseStatus("lease-joined-b008", client, new Date(clock)))!.state, "active");
      const started = await tick(other.base, "lease-joined-b008", bCred);
      equal(started.status, 200, JSON.stringify(started.body));
      await server.settler.flush();
      const old = (await getLease("lease-joined-a008", client))!;
      const next = (await getLease("lease-joined-b008", client))!;
      equal(old.consumedSeconds, 2);
      equal(old.finalSettled, true);
      equal(next.budgetSeconds, 898);
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
      ok((blocked.body as { retryAfterMs?: number }).retryAfterMs! <= 1500);
      const meter = server.store.loadLease("lease-joined-a010")!;
      equal(meter.state, "ended");
      equal(meter.consumed, 3, "A: 2 s confirmed + 1 s up to the successor's read (inside A's own window)");
      const old = (await getLease("lease-joined-a010", client))!;
      equal(old.consumedSeconds, 3);
      equal(old.finalSettled, true, "A's terminal report released Family's fence before t4");
      equal((await getLeaseStatus("lease-joined-b010", client, new Date(clock)))!.state, "active");
      equal(server.store.loadLease("lease-joined-b010"), null, "not activated while A's frame may still run");
      clock = t0 + 4000;
      equal((await tick(base, "lease-joined-b010", cred("lease-joined-b010"))).status, 409, "at A's deadline itself the guard timer margin still fences B");
      clock = t0 + 4500;
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
      equal(late.body.consumedSeconds, 2, "counted up to the frame deadline handed at t0 (t2), before Family's fence at t4; never past it");
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
  // ---- round 8: foreground bounded by the handed frame deadline; receipts before the lock; stop acknowledgment --------

  for (const variant of ["expiry", "outage", "success", "queued-pause"] as const) {
    it(`R8-1 ${variant}: a renewal whose authority answer is withheld t1→t5 bills only to the frame deadline handed at t0 (2 s); B gets 898`, async () => {
      await allowance();
      clock = t0;
      const lid = `lease-joined-r8-${variant}`;
      await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: lid, takeover: true, deviceLabel: null, now: at(0) }, client);
      const { server, base } = await stack();
      try {
        const a = cred(lid, variant === "expiry" ? 5 : 1200);
        const first = await tick(base, lid, a);
        equal(first.status, 200);
        equal((first.body as { authorizedForMs?: number }).authorizedForMs, 2000);
        clock = t0 + 1000;
        let release!: () => void;
        statusGate = { lid, gate: new Promise<void>((r) => { release = r; }) };
        const renewal = tick(base, lid, a);
        await new Promise((r) => setTimeout(r, 40));
        let paused: Promise<Awaited<ReturnType<typeof tick>>> | null = null;
        if (variant === "queued-pause") {
          clock = t0 + 2000;
          paused = fetch(`${base}/v1/play/${lid}/tick`, { method: "POST", headers: { authorization: `Bearer ${a}`, "content-type": "application/json" }, body: '{"active":false,"paused":true}' }).then(async (r) => ({ status: r.status, body: (await r.json()) as { consumedSeconds: number; ended: boolean } }));
          await new Promise((r) => setTimeout(r, 40));
          equal((server.store.loadLease(lid) as unknown as { foregroundUntil: number }).foregroundUntil, t0 + 2000, "the pause receipt is persisted while the renewal still holds the lock");
        }
        clock = t0 + 5000;
        if (variant === "outage") outage = true;
        release();
        statusGate = null;
        const answer = await renewal;
        if (paused) await paused;
        outage = false;
        equal(answer.status, variant === "expiry" ? 401 : variant === "outage" ? 503 : 200, JSON.stringify(answer.body));
        equal(server.store.loadLease(lid)!.consumed, 2, "foreground stopped at the handed deadline t2");
        const r = await fetch(`${base}/v1/play/${lid}/end`, { method: "POST", headers: { authorization: `Bearer ${a}`, "content-type": "application/json" }, body: '{"reason":"left","frameStopped":true}' });
        ok([200, 410, 401].includes(r.status), `${variant}: end ${r.status}`);
        await server.settler.flush();
        const old = (await getLease(lid, client))!;
        equal(old.consumedSeconds, 2);
        equal(old.finalSettled, true);
        const b = await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: `${lid}-b`, takeover: true, deviceLabel: null, now: at(5) }, client);
        ok(b.ok);
        equal(b.lease.budgetSeconds, 898);
        equal(old.consumedSeconds + b.lease.budgetSeconds, 900);
      } finally {
        server.settler.stop();
        await new Promise((r) => server.close(r));
      }
    });
  }

  it("R8-2 a terminal answer in flight is no acknowledgment: B is refused until A's handed deadline lapses; A's wrapper end with the guard's stop attestation releases it at once", async () => {
    await allowance();
    clock = t0;
    await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-a011", takeover: true, deviceLabel: null, now: at(0) }, client);
    const { server, base } = await stack();
    try {
      const a = cred("lease-joined-a011");
      equal((await tick(base, "lease-joined-a011", a)).status, 200); // A's frame may run until t2
      clock = t0 + 500;
      const b = await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-b011", takeover: true, deviceLabel: null, now: new Date(clock) }, client);
      ok(b.ok);
      const bCred = cred("lease-joined-b011");
      equal((await tick(base, "lease-joined-b011", bCred)).status, 409, "B pending behind A's fence");
      clock = t0 + 800;
      const denied = await tick(base, "lease-joined-a011", a); // 410 written — assume it never reaches A's wrapper
      equal(denied.status, 410);
      await server.settler.flush(); // A's terminal report lands: Family's fence is released — only the frame fence remains
      clock = t0 + 1000;
      equal((await getLeaseStatus("lease-joined-b011", client, new Date(clock)))!.state, "active", "Family would let B run now");
      equal((await tick(base, "lease-joined-b011", bCred)).status, 409, "a written 410 is not a frame-stop acknowledgment");
      const ack = await fetch(`${base}/v1/play/lease-joined-a011/end`, { method: "POST", headers: { authorization: `Bearer ${a}`, "content-type": "application/json" }, body: '{"reason":"stopped","frameStopped":true}' });
      equal(ack.status, 410);
      const started = await tick(base, "lease-joined-b011", bCred);
      equal(started.status, 200, JSON.stringify(started.body));
      await server.settler.flush();
      const old = (await getLease("lease-joined-a011", client))!;
      const next = (await getLease("lease-joined-b011", client))!;
      ok(old.consumedSeconds <= 1);
      equal(old.consumedSeconds + next.budgetSeconds, 900);
    } finally {
      server.settler.stop();
      await new Promise((r) => server.close(r));
    }
  });
  // ---- round 9: prompt stop boundaries, closed segments survive later receipts, recovery thaw = billing restart ----

  it("R9-1 the real heartbeat controller: a pause at t1 behind a foreground renewal held t0.8→t5 is reported at once; the meter bills 1, B gets 899", async () => {
    await allowance();
    clock = t0;
    await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-r9-sf", takeover: true, deviceLabel: null, now: at(0) }, client);
    const { server, base } = await stack();
    try {
      const a = cred("lease-joined-r9-sf");
      equal((await tick(base, "lease-joined-r9-sf", a)).status, 200);
      let paused = false;
      const sends: { at: number; active: boolean; seq: number }[] = [];
      const outcomes: number[] = [];
      let done!: () => void;
      const completed = new Promise<void>((r) => { done = r; });
      const hb = createHeartbeat<{ status: number }>({
        input: (): HeartbeatInput => ({ active: !paused, paused, hidden: false }),
        send: async (input, seq) => {
          sends.push({ at: (clock - t0) / 1000, active: input.active, seq });
          try {
            const r = await fetch(`${base}/v1/play/lease-joined-r9-sf/tick`, { method: "POST", headers: { authorization: `Bearer ${a}`, "content-type": "application/json" }, body: JSON.stringify(input) });
            return { status: r.status };
          } catch {
            return { status: 0 }; // like the wrapper's client: a transport failure is an outcome, never a throw
          }
        },
        onOutcome: (_r, seq) => { outcomes.push(seq); if (seq === 2) done(); },
        intervalMs: 800,
        setTimer: () => 1,
        clearTimer: () => undefined,
      });
      clock = t0 + 800;
      let release!: () => void;
      statusGate = { lid: "lease-joined-r9-sf", gate: new Promise<void>((r) => { release = r; }) };
      hb.request(); // the foreground renewal, held at Family
      await new Promise((r) => setTimeout(r, 60));
      clock = t0 + 1000;
      paused = true;
      hb.request(); // the child pauses: the stop boundary must go out NOW
      await new Promise((r) => setTimeout(r, 60));
      deepEqual(sends.map((x) => [x.at, x.active]), [[0.8, true], [1, false]], "the stop boundary was sent at t1, not after the renewal");
      equal(server.store.loadLease("lease-joined-r9-sf")!.consumed, 1, "closed and counted at the receipt");
      clock = t0 + 5000;
      release();
      statusGate = null;
      await completed;
      await new Promise((r) => setTimeout(r, 60)); // let the coalesced follow-up (paused) settle before stopping
      hb.stop();
      equal(server.store.loadLease("lease-joined-r9-sf")!.consumed, 1);
      const r = await fetch(`${base}/v1/play/lease-joined-r9-sf/end`, { method: "POST", headers: { authorization: `Bearer ${a}`, "content-type": "application/json" }, body: '{"reason":"left","frameStopped":true}' });
      equal(r.status, 200);
      await server.settler.flush();
      const old = (await getLease("lease-joined-r9-sf", client))!;
      equal(old.consumedSeconds, 1);
      const b = await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-r9-sf-b", takeover: true, deviceLabel: null, now: at(5) }, client);
      ok(b.ok);
      equal(b.lease.budgetSeconds, 899);
    } finally {
      server.settler.stop();
      await new Promise((r) => server.close(r));
    }
  });

  it("R9-2 pause received t1 and resume received t4 while a renewal is held t0.8→t5: the closed segment is counted once, 1 + 899", async () => {
    await allowance();
    clock = t0;
    await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-r9-pr", takeover: true, deviceLabel: null, now: at(0) }, client);
    const { server, base } = await stack();
    try {
      const a = cred("lease-joined-r9-pr");
      const post = (body: string) => fetch(`${base}/v1/play/lease-joined-r9-pr/tick`, { method: "POST", headers: { authorization: `Bearer ${a}`, "content-type": "application/json" }, body }).then(async (r) => ({ status: r.status, body: (await r.json()) as { consumedSeconds: number; authorizedForMs?: number } }));
      equal((await tick(base, "lease-joined-r9-pr", a)).status, 200);
      clock = t0 + 800;
      let release!: () => void;
      statusGate = { lid: "lease-joined-r9-pr", gate: new Promise<void>((r) => { release = r; }) };
      const renewal = post('{"active":true}');
      await new Promise((r) => setTimeout(r, 40));
      clock = t0 + 1000;
      const paused = post('{"active":false,"paused":true}');
      await new Promise((r) => setTimeout(r, 40));
      equal(server.store.loadLease("lease-joined-r9-pr")!.consumed, 1);
      clock = t0 + 4000;
      const resumed = post('{"active":true}');
      await new Promise((r) => setTimeout(r, 40));
      equal(server.store.loadLease("lease-joined-r9-pr")!.consumed, 1, "the resume receipt does not reopen the closed segment");
      clock = t0 + 5000;
      release();
      statusGate = null;
      const [ren, pau, res] = await Promise.all([renewal, paused, resumed]);
      equal(ren.status, 200);
      equal(pau.body.consumedSeconds, 1);
      equal(res.body.consumedSeconds, 1, "the resume answer bills 1, not 2");
      ok((res.body.authorizedForMs ?? 0) > 0);
      const r = await fetch(`${base}/v1/play/lease-joined-r9-pr/end`, { method: "POST", headers: { authorization: `Bearer ${a}`, "content-type": "application/json" }, body: '{"reason":"left","frameStopped":true}' });
      equal(((await r.json()) as { consumedSeconds: number }).consumedSeconds, 1);
      await server.settler.flush();
      equal((await getLease("lease-joined-r9-pr", client))!.consumedSeconds, 1);
      const b = await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-r9-pr-b", takeover: true, deviceLabel: null, now: at(5) }, client);
      ok(b.ok);
      equal(b.lease.budgetSeconds, 899);
    } finally {
      server.settler.stop();
      await new Promise((r) => server.close(r));
    }
  });

  it("R9-3 recovery: outage at t1, recovery at t5 with the child's foreground intent, play t5→t7 — three runnable seconds bill 3, B gets 897", async () => {
    await allowance();
    clock = t0;
    await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-r9-rec", takeover: true, deviceLabel: null, now: at(0) }, client);
    const { server, base } = await stack();
    try {
      const a = cred("lease-joined-r9-rec");
      equal((await tick(base, "lease-joined-r9-rec", a)).status, 200);
      clock = t0 + 1000;
      outage = true;
      equal((await tick(base, "lease-joined-r9-rec", a)).status, 503);
      outage = false;
      clock = t0 + 5000;
      const recovery = await tick(base, "lease-joined-r9-rec", a); // the wrapper reports the child's intent (foreground); the frame thaws on this answer
      equal(recovery.status, 200);
      equal(recovery.body.consumedSeconds, 1);
      clock = t0 + 6000;
      equal((await tick(base, "lease-joined-r9-rec", a)).body.consumedSeconds, 2);
      clock = t0 + 7000;
      const r = await fetch(`${base}/v1/play/lease-joined-r9-rec/end`, { method: "POST", headers: { authorization: `Bearer ${a}`, "content-type": "application/json" }, body: '{"reason":"left","frameStopped":true}' });
      equal(((await r.json()) as { consumedSeconds: number }).consumedSeconds, 3);
      await server.settler.flush();
      equal((await getLease("lease-joined-r9-rec", client))!.consumedSeconds, 3);
      const b = await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-r9-rec-b", takeover: true, deviceLabel: null, now: at(7) }, client);
      ok(b.ok);
      equal(b.lease.budgetSeconds, 897);
      equal(3 + b.lease.budgetSeconds, 900);
    } finally {
      server.settler.stop();
      await new Promise((r) => server.close(r));
    }
  });
  // ---- round 10: billing starts at the wrapper's running acknowledgment, never at the server's answer ------------

  /**
   * The wrapper's exact rules (client.tsx) over the real heartbeat controller, with a controllable transport and a
   * modelled guard: the frame is reported running only after the guard's reply (`frameReplyAt`, null = frame never
   * loads); every report names the session grant and the observed running duration.
   */
  function wrapperModel(base: string, lid: string, token: string, opts: { deliverAt?: () => number | null | undefined; frameReplyAt?: () => number | null | undefined; holdRunningUntil?: () => number | null | undefined; guardReplyDelayMs?: () => number } = {}) {
    // The modelled GUARD measures its own running time (thaw instant → freeze), like the real one; its reply to the
    // wrapper may be delayed. The wrapper only forwards the guard's measurement.
    const guard = { thawedAt: 0, ranMs: 0, running: false };
    const guardFreeze = () => { if (guard.running) { guard.ranMs += Math.max(0, clock - guard.thawedAt); guard.running = false; } };
    const guardRanMs = () => guard.ranMs + (guard.running ? Math.max(0, clock - guard.thawedAt) : 0);
    const st = { armed: false, lapsed: false, offline: false, paused: false, authorizedUntil: 0, grantSeq: null as number | null, running: false, thawAt: 0, sessionGrant: null as number | null, lastRunMs: 0, observedMs: 0 };
    const sends: { at: number; active: boolean; foreground: boolean; grant: number | null; runMs: number }[] = [];
    const stopRunning = () => { st.running = false; guardFreeze(); st.observedMs = Math.max(st.observedMs, guardRanMs()); };
    const runMs = () => st.observedMs;
    const hb = createHeartbeat<{ status: number; body: { authorizedForMs?: number; billing?: string; grant?: number; consumedSeconds: number }; sentAt: number; input: HeartbeatInput }>({
      intervalMs: 800,
      setTimer: () => 1,
      clearTimer: () => undefined,
      input: () => {
        const foreground = !st.paused;
        const active = foreground && st.running && st.armed && !st.offline && !st.lapsed;
        if (!active) stopRunning();
        return { active, foreground, paused: st.paused, hidden: false, grant: st.sessionGrant, runMs: runMs() };
      },
      send: async (input) => {
        const sentAt = clock;
        sends.push({ at: (sentAt - t0) / 1000, active: input.active, foreground: Boolean(input.foreground), grant: input.grant ?? null, runMs: input.runMs ?? 0 });
        // Uplink: a running report may be held before it reaches the meter (null = lost: never delivered).
        if (input.active) {
          const until = opts.holdRunningUntil?.();
          if (until === null) await new Promise<never>(() => undefined);
          if (typeof until === "number") await new Promise<void>((r) => { const poll = () => (clock >= until ? r() : setTimeout(poll, 5)); poll(); });
        }
        let status = 0;
        let body = { consumedSeconds: 0 } as { authorizedForMs?: number; billing?: string; grant?: number; consumedSeconds: number };
        try {
          const r = await fetch(`${base}/v1/play/${lid}/tick`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(input) });
          status = r.status;
          body = (await r.json()) as typeof body;
        } catch {
          status = 0;
        }
        const deliverAt = opts.deliverAt?.();
        if (deliverAt === null) await new Promise<never>(() => undefined);
        if (typeof deliverAt === "number") await new Promise<void>((r) => { const poll = () => (clock >= deliverAt ? r() : setTimeout(poll, 5)); poll(); });
        return { status, body, sentAt, input };
      },
      onOutcome: ({ status, body, sentAt, input }) => {
        if (status !== 200) { st.offline = true; st.armed = false; stopRunning(); return; }
        st.authorizedUntil = sentAt + Math.max(0, body.authorizedForMs ?? 0);
        st.lapsed = clock >= st.authorizedUntil;
        st.armed = Boolean(input.foreground) && !st.lapsed && (body.authorizedForMs ?? 0) > 0;
        if (st.armed && typeof body.grant === "number") {
          st.grantSeq = body.grant;
          // A stop report carrying the final duration has been answered: the next thaw opens a new session (client.tsx).
          if (!st.running && body.billing !== "running" && !input.active && st.sessionGrant !== null && input.grant === st.sessionGrant) { st.sessionGrant = null; st.observedMs = 0; guard.ranMs = 0; }
        }
        if (!st.armed) stopRunning();
        st.offline = false;
        // postFrameState → the guard replies (if the frame is loaded) → running starts on its word.
        if (st.armed) {
          const replyAt = opts.frameReplyAt ? opts.frameReplyAt() : clock;
          if (replyAt === null) return; // frame not loaded: no reply, nothing runs, nothing is reported running
          // The guard thaws when the alive message arrives (replyAt) and starts its own clock there.
          const thaw = () => { if (!guard.running) { guard.running = true; guard.thawedAt = clock; } };
          const confirm = () => {
            if (!st.armed || st.paused || st.offline || st.lapsed) return;
            if (st.sessionGrant === null) { st.sessionGrant = st.grantSeq; st.observedMs = 0; }
            st.running = true;
            st.observedMs = Math.max(st.observedMs, guardRanMs());
            hb.request();
          };
          const delay = opts.guardReplyDelayMs ? opts.guardReplyDelayMs() : 0;
          const schedule = (fn: () => void, when: number) => { const poll = () => (clock >= when ? fn() : setTimeout(poll, 5)); poll(); };
          const thawAt = typeof replyAt === "number" ? replyAt : clock;
          schedule(() => { thaw(); schedule(confirm, thawAt + delay); }, thawAt);
        }
      },
    });
    const pause = () => { st.paused = true; st.armed = false; stopRunning(); hb.request(); };
    const watchdog = () => { if (st.armed && clock >= st.authorizedUntil) { st.lapsed = true; st.armed = false; stopRunning(); hb.request(); } };
    /** The actual client.end contract: reason, frameStopped and the wrapper's current observation. */
    const end = async (reason: string, frameStopped: boolean) => {
      stopRunning();
      const r = await fetch(`${base}/v1/play/${lid}/end`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ reason, frameStopped, grant: st.sessionGrant, runMs: st.observedMs }) });
      return { status: r.status, body: (await r.json()) as { consumedSeconds: number } };
    };
    return { hb, st, sends, pause, watchdog, end, guardRanMs };
  }

  async function settle(ms = 60) { await new Promise((r) => setTimeout(r, ms)); }

  it("R10-1 transit: the recovery answer (t5) reaches the wrapper at t6 — billing starts at the running acknowledgment (t6), end t7 bills 2, B gets 898", async () => {
    await allowance();
    clock = t0;
    await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-r10-transit", takeover: true, deviceLabel: null, now: at(0) }, client);
    const { server, base } = await stack();
    try {
      const a = cred("lease-joined-r10-transit");
      let deliverAt: number | null | undefined;
      const w = wrapperModel(base, "lease-joined-r10-transit", a, { deliverAt: () => deliverAt });
      w.hb.request(); // intent at t0 → grant → acknowledgment at t0
      await settle();
      deepEqual(w.sends.slice(0, 2).map((x) => [x.at, x.active, x.foreground]), [[0, false, true], [0, true, true]]);
      ok(w.sends.slice(2).every((x) => x.at === 0 && x.active), "any further report at t0 is a running one");
      clock = t0 + 1000;
      outage = true;
      w.hb.request(); // running renewal → 503: frozen, offline
      await settle();
      outage = false;
      equal(server.store.loadLease("lease-joined-r10-transit")!.consumed, 1);
      clock = t0 + 5000;
      deliverAt = t0 + 6000; // the recovery answer is held in transit until t6
      w.hb.request(); // recovery INTENT (active:false, foreground:true)
      await settle();
      const recoverySend = w.sends.at(-1)!;
      equal(recoverySend.at, 5);
      equal(recoverySend.active, false);
      equal(recoverySend.foreground, true);
      equal(server.store.loadLease("lease-joined-r10-transit")!.consumed, 1, "the server answered but bills nothing while the answer is in transit");
      clock = t0 + 6000;
      deliverAt = undefined;
      await settle(80); // delivered: the wrapper arms and acknowledges with a running report at t6
      equal(w.st.armed, true);
      equal(w.sends[4].active, true, "the acknowledgment is a running report");
      clock = t0 + 7000;
      const r = await fetch(`${base}/v1/play/lease-joined-r10-transit/end`, { method: "POST", headers: { authorization: `Bearer ${a}`, "content-type": "application/json" }, body: '{"reason":"left","frameStopped":true}' });
      const ended = (await r.json()) as { consumedSeconds: number };
      w.hb.stop();
      equal(ended.consumedSeconds, 2, "0→1 and 6→7: transit t5→t6 is never billed");
      await server.settler.flush();
      const b = await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-r10-transit-b", takeover: true, deviceLabel: null, now: at(7) }, client);
      ok(b.ok);
      equal(b.lease.budgetSeconds, 898);
    } finally {
      server.settler.stop();
      await new Promise((r) => server.close(r));
    }
  });

  it("R10-1 expired delivery: the recovery answer (t5) reaches the wrapper at t8, after its own deadline — the frame never thaws, nothing after t1 is billed, B gets 899", async () => {
    await allowance();
    clock = t0;
    await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-r10-expired", takeover: true, deviceLabel: null, now: at(0) }, client);
    const { server, base } = await stack();
    try {
      const a = cred("lease-joined-r10-expired");
      let deliverAt: number | null | undefined;
      const w = wrapperModel(base, "lease-joined-r10-expired", a, { deliverAt: () => deliverAt });
      w.hb.request();
      await settle();
      clock = t0 + 1000;
      outage = true;
      w.hb.request();
      await settle();
      outage = false;
      clock = t0 + 5000;
      deliverAt = t0 + 8000;
      w.hb.request();
      await settle();
      clock = t0 + 8000;
      deliverAt = undefined;
      await settle(80);
      equal(w.st.armed, false, "a grant that arrives after its deadline arms nothing");
      equal(w.st.lapsed, true);
      ok(!w.sends.some((x) => x.at >= 5 && x.active), "no running report was ever sent after the outage");
      const r = await fetch(`${base}/v1/play/lease-joined-r10-expired/end`, { method: "POST", headers: { authorization: `Bearer ${a}`, "content-type": "application/json" }, body: '{"reason":"left","frameStopped":true}' });
      const ended = (await r.json()) as { consumedSeconds: number };
      w.hb.stop();
      equal(ended.consumedSeconds, 1);
      await server.settler.flush();
      const b = await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-r10-expired-b", takeover: true, deviceLabel: null, now: at(8) }, client);
      ok(b.ok);
      equal(b.lease.budgetSeconds, 899);
    } finally {
      server.settler.stop();
      await new Promise((r) => server.close(r));
    }
  });

  it("R10-1 authority latency: Family answers the recovery read at t5.5 — the frame runs t5.5→t6.5 (shortened grant) and exactly that is billed: 2 total, B gets 898", async () => {
    await allowance();
    clock = t0;
    await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-r10-latency", takeover: true, deviceLabel: null, now: at(0) }, client);
    const { server, base } = await stack();
    try {
      const a = cred("lease-joined-r10-latency");
      const w = wrapperModel(base, "lease-joined-r10-latency", a);
      w.hb.request();
      await settle();
      clock = t0 + 1000;
      outage = true;
      w.hb.request();
      await settle();
      outage = false;
      clock = t0 + 5000;
      let release!: () => void;
      statusGate = { lid: "lease-joined-r10-latency", gate: new Promise<void>((r) => { release = r; }) };
      w.hb.request(); // recovery intent; Family's authority answer is held
      await settle();
      clock = t0 + 5500;
      release();
      statusGate = null;
      await settle(80); // answered at t5.5 with a 1.5 s grant (window from the t5 request): armed, acknowledged at t5.5 — the acknowledgment renews the grant
      equal(w.st.armed, true);
      equal(w.sends.at(-1)!.at, 5.5, "the running acknowledgment was sent at the thaw instant");
      equal(w.sends.at(-1)!.active, true);
      equal(server.store.loadLease("lease-joined-r10-latency")!.lastActive, true, "billing starts at the acknowledgment (t5.5), not at the t5 request");
      clock = t0 + 6500;
      const r = await fetch(`${base}/v1/play/lease-joined-r10-latency/end`, { method: "POST", headers: { authorization: `Bearer ${a}`, "content-type": "application/json" }, body: '{"reason":"left","frameStopped":true}' });
      const ended = (await r.json()) as { consumedSeconds: number };
      w.hb.stop();
      equal(ended.consumedSeconds, 2, "0→1 and 5.5→6.5: the half second of authority latency is never billed");
      await server.settler.flush();
      const b = await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-r10-latency-b", takeover: true, deviceLabel: null, now: at(6.5) }, client);
      ok(b.ok);
      equal(b.lease.budgetSeconds, 898);
    } finally {
      server.settler.stop();
      await new Promise((r) => server.close(r));
    }
  });
  // ---- round 11: observed runnable windows — delayed or lost running reports keep genuine play; unloaded frames bill nothing

  it("R11-1 delayed acknowledgment: thaw at t6, running report held until t6.8, renewal t7.4, end t7.6 — the full 0→1 and 6→7.6 (2.6 s) is billed, B gets 897", async () => {
    await allowance();
    clock = t0;
    await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-r11-uplink", takeover: true, deviceLabel: null, now: at(0) }, client);
    const { server, base } = await stack();
    try {
      const a = cred("lease-joined-r11-uplink");
      let deliverAt: number | null | undefined;
      let holdRunningUntil: number | null | undefined;
      const w = wrapperModel(base, "lease-joined-r11-uplink", a, { deliverAt: () => deliverAt, holdRunningUntil: () => holdRunningUntil });
      w.hb.request();
      await settle();
      clock = t0 + 1000;
      outage = true;
      w.hb.request();
      await settle();
      outage = false;
      equal(server.store.loadLease("lease-joined-r11-uplink")!.consumed, 1);
      clock = t0 + 5000;
      deliverAt = t0 + 6000;
      w.hb.request(); // recovery intent; its answer reaches the wrapper at t6
      await settle();
      clock = t0 + 6000;
      deliverAt = undefined;
      holdRunningUntil = t0 + 6800; // the guard confirms the thaw at t6; the running acknowledgment is held in the uplink until t6.8
      await settle(80);
      equal(w.st.running, true);
      equal(w.sends.at(-1)!.at, 6);
      equal(w.sends.at(-1)!.active, true);
      clock = t0 + 6800;
      holdRunningUntil = undefined;
      await settle(80);
      ok(server.store.loadLease("lease-joined-r11-uplink")!.consumed >= 1 && server.store.loadLease("lease-joined-r11-uplink")!.consumed <= 1.8, `only guard-measured time is billed, never a guess about the uplink (${server.store.loadLease("lease-joined-r11-uplink")!.consumed})`);
      clock = t0 + 7400;
      w.hb.request(); // renewal: runMs 1.4 s under the session grant
      await settle();
      ok(server.store.loadLease("lease-joined-r11-uplink")!.consumed >= 1.8, `the renewal carries the guard's last reported duration (${server.store.loadLease("lease-joined-r11-uplink")!.consumed})`);
      clock = t0 + 7600;
      w.pause(); // the stop report closes the session at 1.6 s
      await settle();
      const r = await fetch(`${base}/v1/play/lease-joined-r11-uplink/end`, { method: "POST", headers: { authorization: `Bearer ${a}`, "content-type": "application/json" }, body: JSON.stringify({ reason: "left", frameStopped: true, grant: w.st.sessionGrant, runMs: w.st.lastRunMs }) });
      const ended = (await r.json()) as { consumedSeconds: number };
      w.hb.stop();
      equal(ended.consumedSeconds, 2.6, "0→1 and 6→7.6");
      await server.settler.flush();
      const old = (await getLease("lease-joined-r11-uplink", client))!;
      equal(old.consumedSeconds, 3, "the terminal report rounds the last fraction up");
      const b = await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-r11-uplink-b", takeover: true, deviceLabel: null, now: at(8) }, client);
      ok(b.ok);
      equal(b.lease.budgetSeconds, 897);
    } finally {
      server.settler.stop();
      await new Promise((r) => server.close(r));
    }
  });

  it("R11-1 lost acknowledgment: the running report sent at t6 never arrives, the frame runs to its deadline t7 — the next report recovers the second, 2 billed, B gets 898", async () => {
    await allowance();
    clock = t0;
    await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-r11-lost", takeover: true, deviceLabel: null, now: at(0) }, client);
    const { server, base } = await stack();
    try {
      const a = cred("lease-joined-r11-lost");
      let deliverAt: number | null | undefined;
      let holdRunningUntil: number | null | undefined;
      const w = wrapperModel(base, "lease-joined-r11-lost", a, { deliverAt: () => deliverAt, holdRunningUntil: () => holdRunningUntil });
      w.hb.request();
      await settle();
      clock = t0 + 1000;
      outage = true;
      w.hb.request();
      await settle();
      outage = false;
      clock = t0 + 5000;
      deliverAt = t0 + 6000;
      w.hb.request();
      await settle();
      clock = t0 + 6000;
      deliverAt = undefined;
      holdRunningUntil = null; // the acknowledgment is lost in the uplink
      await settle(80);
      equal(w.st.running, true);
      clock = t0 + 7000;
      w.watchdog(); // the frame froze itself at the deadline handed at t5 (t7): the stop report carries runMs 1000 under the session grant
      await settle(80);
      equal(server.store.loadLease("lease-joined-r11-lost")!.consumed, 2, `0→1 plus the lost acknowledgment's 6→7, recovered from the next report (sends ${JSON.stringify(w.sends)}, session ${JSON.stringify(server.store.loadLease("lease-joined-r11-lost")!.session)})`);
      const r = await fetch(`${base}/v1/play/lease-joined-r11-lost/end`, { method: "POST", headers: { authorization: `Bearer ${a}`, "content-type": "application/json" }, body: JSON.stringify({ reason: "left", frameStopped: true, grant: w.st.sessionGrant, runMs: w.st.lastRunMs }) });
      const ended = (await r.json()) as { consumedSeconds: number };
      w.hb.stop();
      equal(ended.consumedSeconds, 2);
      await server.settler.flush();
      const b = await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-r11-lost-b", takeover: true, deviceLabel: null, now: at(7) }, client);
      ok(b.ok);
      equal(b.lease.budgetSeconds, 898);
    } finally {
      server.settler.stop();
      await new Promise((r) => server.close(r));
    }
  });

  it("R11-2 slow frame: the game document is not loaded for 2 s after the grant — the guard answers nothing, the wrapper never reports running, a pause at t1.4 bills 0", async () => {
    await allowance();
    clock = t0;
    await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-r11-slow", takeover: true, deviceLabel: null, now: at(0) }, client);
    const { server, base } = await stack();
    try {
      const a = cred("lease-joined-r11-slow");
      let frameReplyAt: number | null | undefined = null; // the frame has not loaded
      const w = wrapperModel(base, "lease-joined-r11-slow", a, { frameReplyAt: () => frameReplyAt });
      w.hb.request(); // intent → grant → posted to a frame that is not there yet
      await settle();
      equal(w.st.armed, true);
      equal(w.st.running, false, "no guard reply, no running");
      clock = t0 + 800;
      w.hb.request(); // renewal while still waiting: intent again
      await settle();
      ok(w.sends.every((x) => !x.active), "nothing was ever reported running");
      clock = t0 + 1400;
      w.pause();
      await settle();
      const r = await fetch(`${base}/v1/play/lease-joined-r11-slow/end`, { method: "POST", headers: { authorization: `Bearer ${a}`, "content-type": "application/json" }, body: '{"reason":"left","frameStopped":true}' });
      const ended = (await r.json()) as { consumedSeconds: number };
      w.hb.stop();
      equal(ended.consumedSeconds, 0, "an unloaded frame bills nothing");
      await server.settler.flush();
      const b = await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-r11-slow-b", takeover: true, deviceLabel: null, now: at(2) }, client);
      ok(b.ok);
      equal(b.lease.budgetSeconds, 900);
      // When the frame finally loads and the guard confirms, running starts and billing starts there.
      void frameReplyAt;
    } finally {
      server.settler.stop();
      await new Promise((r) => server.close(r));
    }
  });
  // ---- round 12: guard-measured intervals, the real end contract, and bounded reconciliation after a crash --------

  it("R12-1 delayed guard confirmation: the frame runs from t6, the guard's running reply reaches the wrapper only at t6.8 — the guard's own measurement is billed, 2.6 total, B gets 897", async () => {
    await allowance();
    clock = t0;
    await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-r12-guard", takeover: true, deviceLabel: null, now: at(0) }, client);
    const { server, base } = await stack();
    try {
      const a = cred("lease-joined-r12-guard");
      let deliverAt: number | null | undefined;
      let guardDelay = 0;
      const w = wrapperModel(base, "lease-joined-r12-guard", a, { deliverAt: () => deliverAt, guardReplyDelayMs: () => guardDelay });
      w.hb.request();
      await settle();
      clock = t0 + 1000;
      outage = true;
      w.hb.request();
      await settle();
      outage = false;
      equal(server.store.loadLease("lease-joined-r12-guard")!.consumed, 1);
      clock = t0 + 5000;
      deliverAt = t0 + 6000;
      guardDelay = 800; // the guard thaws at t6 but its reply reaches the wrapper at t6.8
      w.hb.request();
      await settle();
      clock = t0 + 6000;
      deliverAt = undefined;
      await settle(80);
      equal(w.st.running, false, "no reply yet: the wrapper does not claim running");
      clock = t0 + 6800;
      await settle(80);
      equal(w.st.running, true);
      equal(w.sends.at(-1)!.runMs, 800, "the first running report carries the guard's own 0.8 s, not the wrapper's arrival time");
      clock = t0 + 7600;
      const ended = await w.end("left", true);
      w.hb.stop();
      equal(ended.body.consumedSeconds, 2.6, "0→1 and the guard-measured 6→7.6");
      await server.settler.flush();
      const b = await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-r12-guard-b", takeover: true, deviceLabel: null, now: at(8) }, client);
      ok(b.ok);
      equal(b.lease.budgetSeconds, 897);
    } finally {
      server.settler.stop();
      await new Promise((r) => server.close(r));
    }
  });

  it("R12-2 the real end contract: the guard freezes at t1, the end request (reason, frameStopped, grant, runMs) reaches the meter at t1.6 — 1 billed, B gets 899", async () => {
    await allowance();
    clock = t0;
    await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-r12-end", takeover: true, deviceLabel: null, now: at(0) }, client);
    const { server, base } = await stack();
    try {
      const a = cred("lease-joined-r12-end");
      const w = wrapperModel(base, "lease-joined-r12-end", a);
      w.hb.request();
      await settle();
      equal(w.st.running, true);
      clock = t0 + 1000;
      w.st.paused = true; w.st.armed = false; w.pause(); // the guard freezes at t1 (observed 1.0 s)
      await settle();
      clock = t0 + 1600; // the end request is delivered 0.6 s later
      const ended = await w.end("left", true);
      w.hb.stop();
      equal(ended.body.consumedSeconds, 1, "the observed second, never the delivery time");
      await server.settler.flush();
      const b = await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-r12-end-b", takeover: true, deviceLabel: null, now: at(2) }, client);
      ok(b.ok);
      equal(b.lease.budgetSeconds, 899);
    } finally {
      server.settler.stop();
      await new Promise((r) => server.close(r));
    }
  });

  it("R12-3 lost running report and tab crash: the frame ran 0→2 on a valid grant, nothing was ever reported — the successor's activation reconciles the bounded window (2) before releasing the reserve: 2 + 898 = 900", async () => {
    await allowance();
    clock = t0;
    await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-r12-crash", takeover: true, deviceLabel: null, now: at(0) }, client);
    const { server, base } = await stack();
    try {
      const a = cred("lease-joined-r12-crash");
      let holdRunningUntil: number | null | undefined = null; // every running report is lost
      const w = wrapperModel(base, "lease-joined-r12-crash", a, { holdRunningUntil: () => holdRunningUntil });
      w.hb.request(); // intent → grant (deadline t2) → guard thaws → running report lost
      await settle(80);
      equal(w.st.running, true);
      equal(server.store.loadLease("lease-joined-r12-crash")!.session!.evidenced, false, "no report after the grant");
      w.hb.stop(); // the tab crashes at t0.5: nothing is ever sent again
      clock = t0 + 500;
      // Family side: the child starts on another device at t3; A's reserve was held back.
      clock = t0 + 3000;
      await endPlayLease({ leaseId: "lease-joined-r12-crash", personId: "santiago", reason: "takeover", now: new Date(clock) }, client);
      const b = await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-r12-crash-b", takeover: true, deviceLabel: null, now: new Date(clock) }, client);
      ok(b.ok);
      ok(b.lease.budgetSeconds < 900, `A's possible play is reserved (${b.lease.budgetSeconds})`);
      const successor = await fetch(`${base}/v1/play/lease-joined-r12-crash-b/tick`, { method: "POST", headers: { authorization: `Bearer ${cred("lease-joined-r12-crash-b")}`, "content-type": "application/json" }, body: '{"active":false,"foreground":true}' });
      ok([200, 409].includes(successor.status));
      await server.settler.flush();
      const old = server.store.loadLease("lease-joined-r12-crash")!;
      equal(old.state, "ended");
      equal(old.consumed, 2, "reconciled to the window the frame could have run: grant answered at t0, deadline t2");
      const oldFamily = (await getLease("lease-joined-r12-crash", client))!;
      equal(oldFamily.consumedSeconds, 2);
      equal(oldFamily.finalSettled, true);
      const next = (await getLease("lease-joined-r12-crash-b", client))!;
      equal(next.budgetSeconds, 898);
      equal(oldFamily.consumedSeconds + next.budgetSeconds, 900);
    } finally {
      server.settler.stop();
      await new Promise((r) => server.close(r));
    }
  });

  it("R12-3 control: an alive wrapper whose frame never ran reports exactly that and is never reconciled — 0 billed, B gets 900", async () => {
    await allowance();
    clock = t0;
    await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-r12-alive", takeover: true, deviceLabel: null, now: at(0) }, client);
    const { server, base } = await stack();
    try {
      const a = cred("lease-joined-r12-alive");
      const w = wrapperModel(base, "lease-joined-r12-alive", a, { frameReplyAt: () => null });
      w.hb.request();
      await settle();
      clock = t0 + 800;
      w.hb.request(); // the wrapper keeps reporting intent: the frame never confirmed running
      await settle();
      equal(server.store.loadLease("lease-joined-r12-alive")!.session!.evidenced, true);
      clock = t0 + 3000;
      await endPlayLease({ leaseId: "lease-joined-r12-alive", personId: "santiago", reason: "takeover", now: new Date(clock) }, client);
      const b = await issuePlayLease({ personId: "santiago", gameId: "paid-game-1", mode: "play", leaseId: "lease-joined-r12-alive-b", takeover: true, deviceLabel: null, now: new Date(clock) }, client);
      ok(b.ok);
      await fetch(`${base}/v1/play/lease-joined-r12-alive-b/tick`, { method: "POST", headers: { authorization: `Bearer ${cred("lease-joined-r12-alive-b")}`, "content-type": "application/json" }, body: '{"active":false,"foreground":true}' });
      w.hb.stop();
      await server.settler.flush();
      equal(server.store.loadLease("lease-joined-r12-alive")!.consumed, 0);
      equal((await getLease("lease-joined-r12-alive", client))!.consumedSeconds, 0);
      equal((await getLease("lease-joined-r12-alive-b", client))!.budgetSeconds, 900);
    } finally {
      server.settler.stop();
      await new Promise((r) => server.close(r));
    }
  });
});
