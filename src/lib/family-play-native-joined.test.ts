// Native Mac game (Deimos Rising) on the joined stack, October 25, 2026: the REAL Family persistence (isolated SQLite)
// + the Game Studio child adapter CANDIDATE + the REAL native authority client (the Family build's C++ core and its
// loopback HTTP client, run by `studio_harness`) — all on ONE fake clock. The harness is driven step by step, so every
// native report and observation reaches the real meter at the instant the test chooses.
//
// Inputs (all required, else the suite is skipped): FAMILY_STUDIO_ADAPTER (+ _SHA256, VR-01) and FAMILY_NATIVE_HARNESS
// (a studio_harness built from the candidate Deimos source). Planner scenarios DR01–DR13: each case records normalized
// observations; when NATIVE_GATE_OBSERVATIONS names a file they are written there for the early failure gate.
// No real child, purchase, wallet or model call is involved.

import { deepEqual, equal, ok } from "node:assert/strict";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { createClient, type Client } from "@libsql/client";
import { endPlayLease, ensurePlayTables, getLease, getLeaseStatus, getPlayState, issuePlayLease, readLeaseStatusForMeter, settlePlayLease } from "./family-play-db.ts";
import { resolveStudioCandidate } from "./family-studio-candidate.ts";
import { DAILY_CHESS_GAME_ID } from "./family-play.ts";
import { nativeLaunchSupport } from "./family-native-games.ts";

const candidate = resolveStudioCandidate();
const HARNESS = process.env.FAMILY_NATIVE_HARNESS ?? "";
const available = candidate !== null && HARNESS !== "" && existsSync(HARNESS);
const ORIGIN = "https://app.example.test";
const NATIVE = "deimos-rising";
const BROWSER = "paid-game-1";

type Obs = Record<string, number | boolean | string | null>;
const observations: Record<string, Obs> = {};
function record(id: string, values: Obs) {
  observations[id] = { ...(observations[id] ?? {}), ...values };
}

type Json = Record<string, unknown> & { status?: number; body?: Record<string, unknown> };

/** One native client process (the Family build's authority core + loopback HTTP), one JSON line per command. */
class Native {
  private proc: ChildProcessByStdio<Writable, Readable, null>;
  private buf = "";
  private waiters: ((line: string) => void)[] = [];
  constructor() {
    this.proc = spawn(HARNESS, [], { stdio: ["pipe", "pipe", "inherit"] });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (d: string) => {
      this.buf += d;
      let i: number;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 1);
        this.waiters.shift()?.(line);
      }
    });
  }
  send(cmd: string): Promise<Json> {
    return new Promise((resolve) => {
      this.waiters.push((line) => resolve(JSON.parse(line) as Json));
      this.proc.stdin.write(`${cmd}\n`);
    });
  }
  /** A crash: the process dies without a word — no end, no final observation. */
  kill() {
    this.proc.kill("SIGKILL");
  }
  async close() {
    if (this.proc.exitCode === null && !this.proc.killed) {
      this.proc.stdin.end();
      await new Promise((r) => this.proc.once("exit", r));
    }
  }
}

/** Raw HTTP with exactly the headers given (the Games page sends its Origin; Node's fetch would add sec-fetch-*). */
function raw(base: string, method: string, path: string, headers: Record<string, string>, body?: unknown): Promise<{ status: number; json: Record<string, unknown> | null; text: string }> {
  const u = new URL(`${base}${path}`);
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: u.hostname, port: u.port, path: `${u.pathname}${u.search}`, method, agent: false, headers: { ...headers, ...(payload ? { "content-type": "application/json", "content-length": String(payload.length) } : {}) } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json: Record<string, unknown> | null = null;
        try { json = JSON.parse(text) as Record<string, unknown>; } catch { json = null; }
        resolve({ status: res.statusCode ?? 0, json, text });
      });
    });
    req.on("error", reject);
    req.end(payload ?? undefined);
  });
}

describe("native Mac game on the joined Family + Studio stack (DR01–DR13)", { skip: !available && "candidate adapter or native harness not named" }, () => {
  type Adapter = {
    createChildPlayAdapter: (opts: Record<string, unknown>) => http.Server & { store: { loadLease: (id: string) => Record<string, unknown> & { consumed: number; state: string; endReason: string | null; endedAt: number | null; frameDeadline?: number | null } | null; dataDir: string }; settler: { flush: () => Promise<void>; stop: () => void }; sweep: () => number; applyStatusAnswer: (leaseId: string, check: Record<string, unknown>) => Promise<{ lease?: Record<string, unknown> } | null> };
    derivePlayKey: (secret: string) => Buffer;
    mintPlayCredential: (key: Buffer, claims: Record<string, unknown>) => string;
    signSettlement: (key: Buffer, ts: number, leaseId: string, body: string) => string;
    LEASE_IDLE_END_SECONDS: number;
  };
  let mod: Adapter;
  let dir: string;
  let client: Client;
  const t0 = Date.UTC(2026, 9, 25, 14, 0, 0);
  let clock = t0;
  let key: Buffer;
  let outage = false;
  /** BX02: how long Family takes to answer a status read (the shared clock advances by it; Family reads midway). */
  let familyLatencyMs = 0;
  let settleGate: Promise<void> | null = null;
  /**
   * Family fixture probes (AR02-AR10, October 26): status reads per lease and how many overlap, an answer held after its
   * snapshot until the test releases it, per-lease outages, and every settlement report received.
   */
  const statusReads = new Map<string, number>();
  const statusInflight = new Map<string, number>();
  const maxStatusInflight = new Map<string, number>();
  const holds = new Map<string, Promise<void>>();
  const brokenLeases = new Set<string>();
  const settlements: Record<string, unknown>[] = [];
  /** Hold the NEXT status answers of `lid`: Family reads at once, the reply is delivered when the returned function runs. */
  function holdStatus(lid: string) {
    let release!: () => void;
    holds.set(lid, new Promise<void>((r) => (release = r)));
    return () => { holds.delete(lid); release(); };
  }
  async function untilReading(lid: string) {
    for (let i = 0; i < 400 && !(statusInflight.get(lid) ?? 0); i += 1) await new Promise((r) => setTimeout(r, 5));
    ok((statusInflight.get(lid) ?? 0) > 0, `no status read in flight for ${lid}`);
  }
  let upstream: http.Server;
  let upstreamOrigin: string;
  const LIVE_IDS = ["6bd56478-5ea0-4f2a-a2db-be8549a88d05", "cb2ad59b-4e92-49d3-abcf-af9d26b439f0", "738a33f8-1fe3-4164-b635-236f596c80e3", "64db53d2-84bb-41bd-9bbe-e5fffffae014", "2bf02071-b51e-43d6-940b-44e0140c256d"];

  before(async () => {
    ok(candidate);
    equal(candidate!.actualSha256, candidate!.sha256, `adapter candidate at ${candidate!.path} hashes ${candidate!.actualSha256}, expected ${candidate!.sha256}`);
    mod = (await import(candidate!.path)) as Adapter;
    dir = mkdtempSync(join(tmpdir(), "family-native-joined-"));
    client = createClient({ url: `file:${join(dir, "db.sqlite")}` });
    await client.execute("CREATE TABLE family_completions (person_id TEXT NOT NULL, routine_id TEXT NOT NULL, week TEXT NOT NULL, day INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'done', note TEXT, challenge TEXT, created_at TEXT NOT NULL, reviewed_at TEXT, credit_count INTEGER NOT NULL DEFAULT 1, awarded_points INTEGER, normalized_summary TEXT, approval_source TEXT, PRIMARY KEY (person_id, routine_id, week, day))");
    await client.execute("CREATE TABLE family_reward_redemptions (id TEXT PRIMARY KEY, person_id TEXT, reward_id TEXT, week TEXT, created_at TEXT, charged_points INTEGER)");
    await ensurePlayTables(client);
    upstream = http.createServer((req, res) => {
      const send = (status: number, body: unknown, type = "application/json") => { res.writeHead(status, { "content-type": type }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
      const m = /^\/api\/projects\/([^/]+)$/.exec(req.url ?? "");
      if (m && (m[1] === BROWSER || LIVE_IDS.includes(m[1]) || m[1] === DAILY_CHESS_GAME_ID)) return send(200, { id: m[1], title: `Game ${m[1].slice(0, 6)}`, prompt: "p", status: "ready", currentVersionId: "v1", versionCount: 1, updatedAt: "x" });
      if ((req.url ?? "").startsWith("/games/")) return send(200, "<!doctype html><html><head><title>g</title></head><body>game</body></html>", "text/html");
      send(404, { error: "not found" });
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", () => r()));
    upstreamOrigin = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
    key = mod.derivePlayKey("isolated-native-secret-0123456789012345");
  });
  after(async () => {
    client?.close();
    await new Promise((r) => upstream?.close(r));
    rmSync(dir, { recursive: true, force: true });
    if (process.env.NATIVE_GATE_OBSERVATIONS) writeFileSync(process.env.NATIVE_GATE_OBSERVATIONS, `${JSON.stringify(observations, null, 2)}\n`);
  });
  beforeEach(() => {
    outage = false;
    familyLatencyMs = 0;
    settleGate = null;
    statusReads.clear();
    statusInflight.clear();
    maxStatusInflight.clear();
    holds.clear();
    brokenLeases.clear();
    settlements.length = 0;
  });

  let stacks = 0;
  async function stack(approvals = [{ gameId: NATIVE, children: ["santiago"] }, { gameId: BROWSER, children: ["santiago"] }, { gameId: DAILY_CHESS_GAME_ID, children: ["santiago", "isabel"] }], existingDataDir: string | null = null) {
    const dataDir = existingDataDir ?? join(dir, `adapter-${(stacks += 1)}`);
    if (!existingDataDir) {
      mkdirSync(dataDir);
      writeFileSync(join(dataDir, "approvals.json"), JSON.stringify({ version: 1, approvals }));
    }
    const server = mod.createChildPlayAdapter({
      key,
      dataDir,
      upstreamOrigin,
      allowedOrigin: ORIGIN,
      settleBase: "http://127.0.0.1:1",
      now: () => clock,
      log: () => {},
      frameFlushMs: 0,
      fetchImpl: async (url: string, options: { headers: Record<string, string>; body?: string }) => {
        if (outage) throw new Error("isolated outage");
        const id = new URL(url).pathname.split("/").at(-2)!;
        equal(options.headers["x-family-play-signature"], mod.signSettlement(key, Number(options.headers["x-family-play-timestamp"]), id, options.body || ""));
        if (url.endsWith("/status")) {
          if (brokenLeases.has(id)) throw new Error("isolated outage for this lease");
          statusReads.set(id, (statusReads.get(id) ?? 0) + 1);
          const inflight = (statusInflight.get(id) ?? 0) + 1;
          statusInflight.set(id, inflight);
          maxStatusInflight.set(id, Math.max(maxStatusInflight.get(id) ?? 0, inflight));
          try {
            const readAt = new Date(clock + Math.floor(familyLatencyMs / 2));
            // The status route's own code (readLeaseStatusForMeter; AR01 proves it equals the former two-step read).
            const snapshot = await readLeaseStatusForMeter(id, readAt, client);
            clock += familyLatencyMs;
            const held = holds.get(id);
            if (held) await held; // answer produced at readAt, delivered when the test releases it
            return Response.json(snapshot ?? { error: "not-found" }, { status: snapshot ? 200 : 404 });
          } finally {
            statusInflight.set(id, (statusInflight.get(id) ?? 1) - 1);
          }
        }
        if (settleGate) await settleGate;
        const body = JSON.parse(options.body!);
        settlements.push(body);
        return Response.json(await settlePlayLease({ ...body, now: new Date(clock) }, client));
      },
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const port = (server.address() as { port: number }).port;
    return { server, base, port, dataDir, close: async () => { server.settler.stop(); await new Promise((r) => server.close(r)); } };
  }
  async function allowance(seconds = 900) {
    await client.execute("DELETE FROM family_play_leases");
    await client.execute("DELETE FROM family_play_allowances");
    await client.execute({ sql: "INSERT INTO family_play_allowances VALUES (?, ?, 0, ?)", args: ["santiago", seconds, new Date(t0).toISOString()] });
  }
  const cred = (lid: string, gid = NATIVE, opts: { ttl?: number; sub?: string; budget?: number } = {}) =>
    mod.mintPlayCredential(key, { sub: opts.sub ?? "santiago", scope: "lease", gid, lid, mode: "play", metered: true, budget: opts.budget ?? 900, iat: Math.floor(clock / 1000), exp: Math.floor(clock / 1000) + (opts.ttl ?? 1200), jti: `${lid}-${Math.random().toString(36).slice(2, 8)}` });
  async function issue(lid: string, gameId = NATIVE) {
    const r = await issuePlayLease({ personId: "santiago", gameId, mode: "play", leaseId: lid, takeover: true, deviceLabel: "computer", now: new Date(clock) }, client);
    ok(r.ok, JSON.stringify(r));
    return r.ok ? r.lease : null!;
  }
  /** Set the shared clock (meter, Family and the native client). */
  async function at(native: Native | null, ms: number) {
    clock = ms;
    if (native) await native.send(`time ${ms}`);
  }
  async function ticket(base: string, lid: string, token: string) {
    return raw(base, "POST", `/v1/native/${lid}/ticket`, { origin: ORIGIN, authorization: `Bearer ${token}` }, {});
  }
  async function launch(native: Native, s: { base: string; port: number }, lid: string, token: string) {
    await native.send(`port ${s.port}`);
    const t = await ticket(s.base, lid, token);
    equal(t.status, 201, t.text);
    const r = await native.send(`launch ${String(t.json!.launchUrl)}`);
    equal(r.ok, true, JSON.stringify(r));
    return r;
  }
  /** Gameplay frames every 100 ms with a report every `tickEvery` ms and observations as due: [from, to]. */
  async function play(native: Native, from: number, to: number, tickEvery = 1000) {
    let lastTick = Number.NEGATIVE_INFINITY;
    let runFrames = 0;
    let lastAnswer: Json | null = null;
    for (let t = from; t <= to; t += 100) {
      await at(native, t);
      if (t - lastTick >= tickEvery) {
        lastAnswer = await native.send("tick");
        lastTick = t;
      }
      const f = await native.send("frame");
      if (f.run) runFrames += 1;
      await native.send("beacon");
    }
    return { runFrames, lastAnswer };
  }
  /** Stop playing at the current instant: leave the game, report the stop, flush the final observation. */
  async function stopPlaying(native: Native) {
    await native.send("game 0");
    await native.send("tick");
    await native.send("beacon");
  }
  async function quit(native: Native) {
    await native.send("requestend left");
    await native.send("beacon");
    return native.send("end");
  }
  const famRemaining = async () => (await getPlayState("santiago", client)).remainingSeconds;
  const famLease = async (lid: string) => (await getLease(lid, client))!;

  // ---- DR01 -------------------------------------------------------------------------------------------------------
  it("DR01 library, ticket, launch, title/menu and level loading consume nothing", async () => {
    await allowance();
    clock = t0;
    await issue("lease-dr01-native1");
    const s = await stack();
    const native = new Native();
    try {
      const library = await raw(s.base, "GET", "/v1/library", { authorization: `Bearer ${mod.mintPlayCredential(key, { sub: "santiago", scope: "library", gid: "*", lid: "-", mode: "edit", metered: false, budget: 0, iat: Math.floor(clock / 1000), exp: Math.floor(clock / 1000) + 600, jti: "lib-dr01" })}` });
      const card = (library.json!.games as { gameId: string; platform?: string; launch?: string }[]).find((g) => g.gameId === NATIVE);
      await at(native, t0);
      await launch(native, s, "lease-dr01-native1", cred("lease-dr01-native1"));
      // 90 s on the title screen / menus: the app reports, but never foreground — nothing is armed or measured.
      for (let t = t0; t <= t0 + 90_000; t += 800) { await at(native, t); await native.send("tick"); }
      // A level starts: entering the game while the level loads is held until a grant arrives; the load is excluded.
      await at(native, t0 + 90_500);
      await native.send("game 1");
      const held = await native.send("frame");
      await native.send("loaded");
      await native.send("game 0");
      await native.send("tick");
      const meterBefore = s.server.store.loadLease("lease-dr01-native1")!.consumed;
      await quit(native);
      await s.server.settler.flush();
      const meter = s.server.store.loadLease("lease-dr01-native1")!;
      equal(meterBefore, 0);
      equal(meter.consumed, 0);
      equal(await famRemaining(), 900);
      record("DR01", { libraryCardPlatform: card?.platform ?? null, libraryCardLaunch: card?.launch ?? null, menuConsumedSeconds: meterBefore, heldBeforeGrant: held.run === false, meterConsumedSeconds: meter.consumed, familyRemainingSeconds: await famRemaining() });
    } finally {
      await native.close();
      await s.close();
    }
  });

  // ---- DR02 -------------------------------------------------------------------------------------------------------
  it("DR02 exactly 10 s of active native gameplay bills 10 s; the remaining allowance is 890", async () => {
    await allowance();
    clock = t0;
    await issue("lease-dr02-native1");
    const s = await stack();
    const native = new Native();
    try {
      await at(native, t0);
      await launch(native, s, "lease-dr02-native1", cred("lease-dr02-native1"));
      await at(native, t0 + 1000);
      await native.send("game 1");
      const { runFrames } = await play(native, t0 + 1000, t0 + 11_000);
      await stopPlaying(native);
      const state = await native.send("state");
      const end = await quit(native);
      await s.server.settler.flush();
      const meter = s.server.store.loadLease("lease-dr02-native1")!;
      const fam = await famLease("lease-dr02-native1");
      const activeAfterQuit = (await getPlayState("santiago", client)).activeLease?.id ?? null;
      equal(meter.consumed, 10);
      equal(fam.consumedSeconds, 10);
      equal(await famRemaining(), 890);
      record("DR02", { familyActiveLeaseAfterQuit: activeAfterQuit, nativeRanMs: Number(state.ranMs), runFrames, meterConsumedSeconds: meter.consumed, familyConsumedSeconds: fam.consumedSeconds, familyRemainingSeconds: await famRemaining(), endStatus: Number((end.answer as Json).status) });
    } finally {
      await native.close();
      await s.close();
    }
  });

  // ---- DR03 -------------------------------------------------------------------------------------------------------
  it("DR03 explicit pause, with a renewal answer delayed past the pause, adds nothing while frozen", async () => {
    await allowance();
    clock = t0;
    await issue("lease-dr03-native1");
    const s = await stack();
    const native = new Native();
    try {
      await at(native, t0);
      await launch(native, s, "lease-dr03-native1", cred("lease-dr03-native1"));
      await native.send("game 1");
      await play(native, t0, t0 + 4900);
      // At 5 s: a renewal goes out (the meter receives it now) but its answer is held back by the network.
      await at(native, t0 + 5000);
      await native.send("frame");
      await native.send("tickbuild");
      await native.send("tickpost");
      await native.send("pause 1"); // Caps Lock pause at the same instant
      // While paused: 2 minutes of pause reports, frames held.
      let frozenRan = false;
      for (let t = t0 + 5000; t <= t0 + 125_000; t += 800) {
        await at(native, t);
        const f = await native.send("frame");
        if (f.run) frozenRan = true;
      }
      // The delayed renewal answer finally arrives (2 minutes late): it must not thaw or arm anything.
      await at(native, t0 + 125_100);
      await native.send("tickapply");
      const afterLate = await native.send("frame");
      const st = await native.send("state");
      await native.send("tick");
      await native.send("beacon");
      const pausedConsumed = s.server.store.loadLease("lease-dr03-native1")!.consumed;
      // Resume for 5 more seconds, then quit.
      await native.send("pause 0");
      await play(native, t0 + 126_000, t0 + 131_000);
      await stopPlaying(native);
      await quit(native);
      await s.server.settler.flush();
      const meter = s.server.store.loadLease("lease-dr03-native1")!;
      equal(pausedConsumed, 5);
      equal(meter.consumed, 10);
      equal(await famRemaining(), 890);
      record("DR03", { consumedAtPauseEnd: pausedConsumed, ranWhilePaused: frozenRan, lateAnswerThawed: afterLate.run === true, lateAnswerArmed: st.armed === true, finalConsumedSeconds: meter.consumed, familyRemainingSeconds: await famRemaining() });
    } finally {
      await native.close();
      await s.close();
    }
  });

  // ---- DR04 -------------------------------------------------------------------------------------------------------
  it("DR04 background/minimized: nothing is measured while the window is not active", async () => {
    await allowance();
    clock = t0;
    await issue("lease-dr04-native1");
    const s = await stack();
    const native = new Native();
    try {
      await at(native, t0);
      await launch(native, s, "lease-dr04-native1", cred("lease-dr04-native1"));
      await native.send("game 1");
      await play(native, t0, t0 + 5000);
      await native.send("hide 1");
      let ranHidden = false;
      for (let t = t0 + 5000; t <= t0 + 305_000; t += 800) {
        await at(native, t);
        await native.send("tick");
        if ((await native.send("frame")).run) ranHidden = true;
        await native.send("beacon");
      }
      const hiddenConsumed = s.server.store.loadLease("lease-dr04-native1")!.consumed;
      await native.send("hide 0");
      await play(native, t0 + 306_000, t0 + 311_000);
      await stopPlaying(native);
      await quit(native);
      await s.server.settler.flush();
      const meter = s.server.store.loadLease("lease-dr04-native1")!;
      equal(hiddenConsumed, 5);
      equal(meter.consumed, 10);
      record("DR04", { consumedAfterFiveMinutesHidden: hiddenConsumed, ranWhileHidden: ranHidden, finalConsumedSeconds: meter.consumed, familyRemainingSeconds: await famRemaining() });
    } finally {
      await native.close();
      await s.close();
    }
  });

  // ---- DR05 -------------------------------------------------------------------------------------------------------
  it("DR05 a slow, lost or expired launch authorization never starts or bills the frozen game", async () => {
    await allowance();
    clock = t0;
    await issue("lease-dr05-native1");
    const s = await stack();
    const native = new Native();
    const native2 = new Native();
    try {
      await at(native, t0);
      await launch(native, s, "lease-dr05-native1", cred("lease-dr05-native1"));
      await native.send("game 1");
      // Slow: the intent report's grant (2 s) arrives 2.5 s later.
      await native.send("tickbuild");
      await native.send("tickpost");
      await at(native, t0 + 2500);
      await native.send("tickapply");
      const slow = await native.send("frame");
      // Lost: the next intent report reaches the meter, its answer never comes back; frames stay held.
      await at(native, t0 + 3000);
      await native.send("tickbuild");
      await native.send("tickpost");
      let ranLost = false;
      for (let t = t0 + 3100; t <= t0 + 20_000; t += 100) { await at(native, t); if ((await native.send("frame")).run) ranLost = true; }
      const stateLost = await native.send("state");
      await native.send("beacon");
      const consumedNoGrant = s.server.store.loadLease("lease-dr05-native1")!.consumed;
      // Expired ticket: minted, then used 61 s later by a second app instance → refused, no lease attached.
      await at(native2, t0 + 21_000);
      await native2.send(`port ${s.port}`);
      const t = await ticket(s.base, "lease-dr05-native1", cred("lease-dr05-native1"));
      await at(native2, t0 + 82_001);
      const expired = await native2.send(`launch ${String(t.json!.launchUrl)}`);
      await native2.send("game 1");
      const noLease = await native2.send("frame");
      // Expired credential behind the lease: the meter refuses (401) → ended, held, nothing billed.
      await issue("lease-dr05-native2");
      const short = cred("lease-dr05-native2", NATIVE, { ttl: 30 });
      const native3 = new Native();
      try {
        await at(native3, clock);
        await launch(native3, s, "lease-dr05-native2", short);
        await native3.send("game 1");
        await at(native3, clock + 31_000);
        const refused = await native3.send("tick");
        const heldExpired = await native3.send("frame");
        await quit(native3);
        record("DR05", { expiredCredentialTickStatus: Number((refused.answer as Json).status), expiredCredentialRan: heldExpired.run === true });
      } finally {
        await native3.close();
      }
      await quit(native);
      await s.server.settler.flush();
      record("DR05", { slowGrantRan: slow.run === true, lostAnswerRan: ranLost, lostAnswerArmed: stateLost.armed === true, consumedWithoutUsableGrant: consumedNoGrant, expiredTicketStatus: Number(expired.status), expiredTicketAttached: expired.ok === true, holdWithoutLease: String(noLease.hold), finalConsumedSeconds: s.server.store.loadLease("lease-dr05-native1")!.consumed, familyRemainingSeconds: await famRemaining() });
      equal(slow.run, false);
      equal(ranLost, false);
      equal(consumedNoGrant, 0);
      equal(expired.ok, false);
      equal(expired.status, 410);
      equal(noLease.hold, "no-lease");
      equal(s.server.store.loadLease("lease-dr05-native1")!.consumed, 0);
    } finally {
      await native.close();
      await native2.close();
      await s.close();
    }
  });

  // ---- DR06 -------------------------------------------------------------------------------------------------------
  it("DR06 Family outage: the game freezes no later than its existing authority deadline and no outage time is charged", async () => {
    await allowance();
    clock = t0;
    await issue("lease-dr06-native1");
    const s = await stack();
    const native = new Native();
    try {
      await at(native, t0);
      await launch(native, s, "lease-dr06-native1", cred("lease-dr06-native1"));
      await native.send("game 1");
      await play(native, t0, t0 + 4900);
      const before = await native.send("state");
      const deadlineBefore = t0 + 4000 + 2000; // the renewal answered at 4 s handed a 2 s window
      // Family becomes unreachable at 5 s: the renewal at 5 s is refused (503) → frozen at once.
      outage = true;
      await at(native, t0 + 5000);
      await native.send("frame");
      const failed = await native.send("tick");
      let frozenAt: number | null = null;
      let ranDuringOutage = false;
      for (let t = t0 + 5000; t <= t0 + 65_000; t += 100) {
        await at(native, t);
        if ((t - t0) % 1000 === 0) await native.send("tick");
        const f = await native.send("frame");
        if (f.run) ranDuringOutage = true;
        else if (frozenAt === null) frozenAt = t;
        await native.send("beacon");
      }
      const outageConsumed = s.server.store.loadLease("lease-dr06-native1")!.consumed;
      outage = false;
      await play(native, t0 + 66_000, t0 + 71_000);
      await stopPlaying(native);
      await quit(native);
      await s.server.settler.flush();
      const meter = s.server.store.loadLease("lease-dr06-native1")!;
      equal(Number((failed.answer as Json).status), 503);
      equal(ranDuringOutage, false);
      ok(frozenAt !== null && frozenAt <= deadlineBefore);
      equal(outageConsumed, 5);
      equal(meter.consumed, 10);
      equal(await famRemaining(), 890);
      record("DR06", { outageTickStatus: Number((failed.answer as Json).status), ranDuringOutage, frozenNoLaterThanDeadline: frozenAt !== null && frozenAt <= deadlineBefore, armedBeforeOutage: before.armed === true, consumedAfterOneMinuteOutage: outageConsumed, finalConsumedSeconds: meter.consumed, familyRemainingSeconds: await famRemaining() });
    } finally {
      await native.close();
      await s.close();
    }
  });

  // ---- DR07 -------------------------------------------------------------------------------------------------------
  it("DR07 exhaustion: one warning, one save tail, then the game stops; refresh and restart cannot extend", async () => {
    await allowance(130);
    clock = t0;
    const lease = await issue("lease-dr07-native1");
    equal(lease.budgetSeconds, 130);
    const s = await stack();
    const native = new Native();
    try {
      await at(native, t0);
      await launch(native, s, "lease-dr07-native1", cred("lease-dr07-native1", NATIVE, { budget: 130 }));
      await native.send("game 1");
      let warnings = 0;
      let graces = 0;
      let graceRunFrames = 0;
      let stoppedAt: number | null = null;
      let endReason = "";
      let stopGame = false;
      let graceStartedAt: number | null = null;
      let lastTick = Number.NEGATIVE_INFINITY;
      for (let t = t0; t <= t0 + 240_000; t += 100) {
        await at(native, t);
        if (t - lastTick >= 1000) { await native.send("tick"); lastTick = t; }
        const n = await native.send("notice");
        if (n.notice === "warning") warnings += 1;
        if (n.notice === "grace") { graces += 1; graceStartedAt = t; }
        const f = await native.send("frame");
        if (graceStartedAt !== null && f.run) graceRunFrames += 1;
        await native.send("beacon");
        if (f.hold === "ended") {
          stoppedAt = t;
          stopGame = f.stopGame === true;
          endReason = String((await native.send("state")).endReason);
          break;
        }
      }
      await native.send("game 0");
      const end = await native.send("end");
      await s.server.settler.flush();
      const meter = s.server.store.loadLease("lease-dr07-native1")!;
      // Refresh: a new ticket for the exhausted lease is refused. Restart: Family has nothing left to lease.
      const refresh = await ticket(s.base, "lease-dr07-native1", cred("lease-dr07-native1", NATIVE, { budget: 130 }));
      const restart = await issuePlayLease({ personId: "santiago", gameId: NATIVE, mode: "play", leaseId: "lease-dr07-native2", takeover: true, deviceLabel: "computer", now: new Date(clock) }, client);
      equal(warnings, 1);
      equal(graces, 1);
      equal(endReason, "exhausted");
      equal(stopGame, true);
      const restartRefused = !restart.ok;
      const restartReason = restart.ok ? null : restart.reason;
      equal(meter.consumed, 130);
      equal(await famRemaining(), 0);
      ok(restartRefused);
      record("DR07", { warningNotices: warnings, graceNotices: graces, graceRunSeconds: graceRunFrames / 10, graceWithinTail: graceRunFrames / 10 <= 30, endReason, stopGame, endStatus: Number((end.answer as Json | undefined)?.status ?? 0), meterConsumedSeconds: meter.consumed, familyRemainingSeconds: await famRemaining(), refreshTicketStatus: refresh.status, restartLeaseRefused: restartRefused, restartReason, stoppedWithinSeconds: stoppedAt === null ? null : (stoppedAt - t0) / 1000 });
    } finally {
      await native.close();
      await s.close();
    }
  });

  // ---- DR08 -------------------------------------------------------------------------------------------------------
  it("DR08 browser → native → browser: one lease at a time, one allowance, no duplicate charge", async () => {
    await allowance();
    clock = t0;
    const s = await stack();
    const native = new Native();
    try {
      // Browser game A: 5 s of play at the wrapper's cadence (legacy attested ticks), then Leave (end + release).
      await issue("lease-dr08-browserA", BROWSER);
      const activeDuringA = (await getPlayState("santiago", client)).activeLease?.id ?? null;
      const a = cred("lease-dr08-browserA", BROWSER);
      for (let sec = 0; sec <= 5; sec += 1) {
        clock = t0 + sec * 1000;
        const r = await raw(s.base, "POST", "/v1/play/lease-dr08-browserA/tick", { authorization: `Bearer ${a}` }, { active: true });
        equal(r.status, 200, r.text);
      }
      clock = t0 + 5000;
      await raw(s.base, "POST", "/v1/play/lease-dr08-browserA/end", { authorization: `Bearer ${a}` }, { reason: "left", frameStopped: true });
      await endPlayLease({ leaseId: "lease-dr08-browserA", personId: "santiago", reason: "left", now: new Date(clock) }, client);
      await s.server.settler.flush();
      // Native B on the same allowance: 10 s, then quit.
      await at(native, t0 + 6000);
      const b = await issue("lease-dr08-nativeB");
      const activeAfterB = (await getPlayState("santiago", client)).activeLease?.id ?? null;
      await launch(native, s, "lease-dr08-nativeB", cred("lease-dr08-nativeB"));
      await native.send("game 1");
      await play(native, t0 + 6000, t0 + 16_000);
      await stopPlaying(native);
      await quit(native);
      await s.server.settler.flush();
      // Browser C again: 5 s.
      clock = t0 + 17_000;
      const c = await issue("lease-dr08-browserC", BROWSER);
      const activeAfterC = (await getPlayState("santiago", client)).activeLease?.id ?? null;
      const cc = cred("lease-dr08-browserC", BROWSER);
      for (let sec = 17; sec <= 22; sec += 1) {
        clock = t0 + sec * 1000;
        equal((await raw(s.base, "POST", "/v1/play/lease-dr08-browserC/tick", { authorization: `Bearer ${cc}` }, { active: true })).status, 200);
      }
      clock = t0 + 22_000;
      await raw(s.base, "POST", "/v1/play/lease-dr08-browserC/end", { authorization: `Bearer ${cc}` }, { reason: "left", frameStopped: true });
      await endPlayLease({ leaseId: "lease-dr08-browserC", personId: "santiago", reason: "left", now: new Date(clock) }, client);
      await s.server.settler.flush();
      const ca = (await famLease("lease-dr08-browserA")).consumedSeconds;
      const cb = (await famLease("lease-dr08-nativeB")).consumedSeconds;
      const cC = (await famLease("lease-dr08-browserC")).consumedSeconds;
      equal(ca, 5);
      equal(cb, 10);
      equal(cC, 5);
      equal(b.budgetSeconds, 895);
      equal(c.budgetSeconds, 885);
      equal(await famRemaining(), 880);
      record("DR08", { browserAConsumed: ca, nativeBBudget: b.budgetSeconds, nativeBConsumed: cb, browserCBudget: c.budgetSeconds, browserCConsumed: cC, totalConsumed: ca + cb + cC, familyRemainingSeconds: await famRemaining(), singleActiveLeaseAfterB: activeAfterB === "lease-dr08-nativeB", singleActiveLeaseAfterC: activeAfterC === "lease-dr08-browserC", singleActiveLeaseDuringA: activeDuringA === "lease-dr08-browserA" });
    } finally {
      await native.close();
      await s.close();
    }
  });

  // ---- DR09 -------------------------------------------------------------------------------------------------------
  it("DR09 crash, restart and a late final settlement: delivered gameplay is charged exactly once", async () => {
    await allowance();
    clock = t0;
    await issue("lease-dr09-native1");
    const s = await stack();
    const native = new Native();
    const restarted = new Native();
    try {
      await at(native, t0);
      await launch(native, s, "lease-dr09-native1", cred("lease-dr09-native1"));
      await native.send("game 1");
      await play(native, t0, t0 + 6000); // the 6 s observation beacon was delivered
      native.kill(); // crash: no stop report, no end
      // The meter finalizes the silent lease on its own (sweep after the idle limit) with the DELIVERED observation only.
      await at(null, t0 + 6000 + mod.LEASE_IDLE_END_SECONDS * 1000 + 1000);
      s.server.sweep();
      // The terminal settlement is held back (late); a restart takes a fresh lease meanwhile.
      let releaseSettle!: () => void;
      settleGate = new Promise<void>((r) => { releaseSettle = r; });
      const flushing = s.server.settler.flush();
      const crashed = s.server.store.loadLease("lease-dr09-native1")!;
      await new Promise((r) => setTimeout(r, 30));
      const fresh = await issue("lease-dr09-native2");
      releaseSettle();
      settleGate = null;
      await flushing;
      await s.server.settler.flush();
      await s.server.settler.flush(); // a duplicate flush adds nothing
      const afterLate = await famRemaining();
      await at(restarted, clock + 1000);
      await launch(restarted, s, "lease-dr09-native2", cred("lease-dr09-native2"));
      await restarted.send("game 1");
      await play(restarted, clock, clock + 4000);
      await stopPlaying(restarted);
      await quit(restarted);
      await s.server.settler.flush();
      const c1 = (await famLease("lease-dr09-native1")).consumedSeconds;
      const c2 = (await famLease("lease-dr09-native2")).consumedSeconds;
      equal(crashed.state, "ended");
      equal(crashed.consumed, 6);
      equal(c1, 6);
      equal(afterLate, 894);
      equal(c2, 4);
      equal(await famRemaining(), 890);
      record("DR09", { crashedLeaseEndReason: String(crashed.endReason), crashedMeterConsumed: crashed.consumed, crashedFamilyConsumed: c1, restartBudgetSeconds: fresh.budgetSeconds, remainingAfterLateSettlement: afterLate, restartConsumed: c2, familyRemainingSeconds: await famRemaining() });
    } finally {
      await native.close();
      await restarted.close();
      await s.close();
    }
  });

  // ---- DR10 -------------------------------------------------------------------------------------------------------
  it("DR10 a successor during native play never overlaps its authority, and a delayed native end charges nothing after the actual stop", async () => {
    await allowance();
    clock = t0;
    await issue("lease-dr10-native1");
    const s = await stack();
    const native = new Native();
    try {
      await at(native, t0);
      await launch(native, s, "lease-dr10-native1", cred("lease-dr10-native1"));
      await native.send("game 1");
      await play(native, t0, t0 + 5000);
      // The child opens a browser game on another screen at 5.5 s ("Continue here"): Family designates C.
      await at(native, t0 + 5500);
      await native.send("frame");
      const c = await issue("lease-dr10-browserC", BROWSER);
      const cc = cred("lease-dr10-browserC", BROWSER);
      // C tries to start at once: fenced (pending) while the native lease's window is open.
      const early = await raw(s.base, "POST", "/v1/play/lease-dr10-browserC/tick", { authorization: `Bearer ${cc}` }, { active: false, foreground: true });
      // The native app keeps rendering frames; its next renewal learns the lease is over → frozen, ended.
      let nativeStoppedAt: number | null = null;
      let lastTick = t0 + 5000;
      for (let t = t0 + 5600; t <= t0 + 12_000; t += 100) {
        await at(native, t);
        if (t - lastTick >= 1000) { await native.send("tick"); lastTick = t; }
        const f = await native.send("frame");
        if (!f.run && nativeStoppedAt === null) nativeStoppedAt = t;
        await native.send("beacon");
        if (f.hold === "ended") break;
      }
      const nativeState = await native.send("state");
      const meterB = s.server.store.loadLease("lease-dr10-native1")!;
      // C's first grant: only after the native lease's fence (its window or the native end).
      let cStartedAt: number | null = null;
      for (let t = clock; t <= t0 + 20_000; t += 250) {
        clock = t;
        const r = await raw(s.base, "POST", "/v1/play/lease-dr10-browserC/tick", { authorization: `Bearer ${cc}` }, { active: false, foreground: true });
        if (r.status === 200 && Number(r.json!.authorizedForMs) > 0) { cStartedAt = t; break; }
      }
      // The native end report arrives late (30 s): it charges nothing beyond what was observed before the stop.
      const beforeLateEnd = s.server.store.loadLease("lease-dr10-native1")!.consumed;
      await at(native, t0 + 40_000);
      await native.send("game 0");
      const lateEnd = await native.send("end");
      await s.server.settler.flush();
      const afterLateEnd = s.server.store.loadLease("lease-dr10-native1")!.consumed;
      const famB = (await famLease("lease-dr10-native1")).consumedSeconds;
      const bEndedAt = meterB.endedAt ?? 0;
      ok(early.status === 409, `C early: ${early.status} ${early.text}`);
      ok(cStartedAt !== null && nativeStoppedAt !== null);
      ok(nativeStoppedAt! <= cStartedAt!, `native stopped ${nativeStoppedAt! - t0} before C started ${cStartedAt! - t0}`);
      equal(afterLateEnd, beforeLateEnd);
      ok(famB + c.budgetSeconds <= 900);
      record("DR10", {
        successorEarlyStatus: early.status,
        nativeEndReason: String(nativeState.endReason),
        nativeStoppedBeforeSuccessorGrant: nativeStoppedAt! <= cStartedAt!,
        meterEndedNoLaterThanSuccessorGrant: bEndedAt <= cStartedAt!,
        nativeObservedSeconds: Math.round(Number(nativeState.ranMs) / 100) / 10,
        nativeChargedSeconds: famB,
        chargedEqualsObservedCeil: famB === Math.ceil(Number(nativeState.ranMs) / 1000),
        lateEndAddedSeconds: afterLateEnd - beforeLateEnd,
        lateEndStatus: Number((lateEnd.answer as Json | undefined)?.status ?? 0),
        conservedTotal: famB + c.budgetSeconds <= 900,
      });
    } finally {
      await native.close();
      await s.close();
    }
  });

  // ---- DR11 -------------------------------------------------------------------------------------------------------
  it("DR11 wrong child or lease, replayed, expired or malformed launch links and any path or command are refused", async () => {
    await allowance();
    clock = t0;
    await issue("lease-dr11-native1");
    const s = await stack();
    const native = new Native();
    try {
      const token = cred("lease-dr11-native1");
      const isabel = cred("lease-dr11-native1", NATIVE, { sub: "isabel" });
      const wrongChild = await ticket(s.base, "lease-dr11-native1", isabel);
      const wrongLease = await ticket(s.base, "lease-dr11-other1", token);
      const browserGame = await ticket(s.base, "lease-dr11-native1", cred("lease-dr11-native1", BROWSER));
      const noOrigin = await raw(s.base, "POST", "/v1/native/lease-dr11-native1/ticket", { authorization: `Bearer ${token}` }, {});
      await native.send(`port ${s.port}`);
      await at(native, t0);
      const good = await ticket(s.base, "lease-dr11-native1", token);
      const url = String(good.json!.launchUrl);
      const first = await native.send(`launch ${url}`);
      const replay = (await raw(s.base, "POST", "/v1/native/redeem", {}, { ticket: url.split("ticket=")[1], gameId: NATIVE })).status;
      const malformed = await raw(s.base, "POST", "/v1/native/redeem", {}, { ticket: "../../../../bin/sh", gameId: NATIVE });
      const command = await raw(s.base, "POST", "/v1/native/redeem", {}, { ticket: "open -a Terminal", gameId: NATIVE });
      const otherGame = await raw(s.base, "POST", "/v1/native/redeem", {}, { ticket: "A".repeat(43), gameId: BROWSER });
      const launcherPath = await raw(s.base, "POST", "/v1/native/open", { origin: ORIGIN, authorization: `Bearer ${token}` }, { path: "/Applications/Calculator.app" });
      const appRejectsFile = await native.send("launch file:///Applications/Calculator.app");
      const appRejectsPath = await native.send(`launch deimos-rising-studio://play?ticket=${"A".repeat(40)}/sh`);
      const isabelTick = await raw(s.base, "POST", "/v1/play/lease-dr11-native1/tick", { authorization: `Bearer ${isabel}` }, { active: false, foreground: true });
      const malformedCred = await raw(s.base, "POST", "/v1/play/lease-dr11-native1/tick", { authorization: `Bearer ${token}x` }, { active: true });
      await quit(native);
      equal(wrongChild.status, 403);
      equal(first.ok, true);
      equal(replay, 410);
      record("DR11", { wrongChildTicket: wrongChild.status, wrongLeaseTicket: wrongLease.status, browserGameTicket: browserGame.status, noOriginTicket: noOrigin.status, firstRedeemAttached: first.ok === true, replayedRedeem: replay, malformedTicket: malformed.status, commandTicket: command.status, otherGameRedeem: otherGame.status, genericLauncherRoute: launcherPath.status, appRejectsFileUrl: appRejectsFile.ok === false, appRejectsPathTicket: appRejectsPath.ok === false, otherChildTick: isabelTick.status, malformedCredentialTick: malformedCred.status, familyRemainingSeconds: await famRemaining() });
    } finally {
      await native.close();
      await s.close();
    }
  });

  // ---- DR12 -------------------------------------------------------------------------------------------------------
  it("DR12 iPad, phone, non-Mac and remote requests cannot launch on the Mac or claim support", async () => {
    const ipad = nativeLaunchSupport({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15", maxTouchPoints: 5 });
    const iphone = nativeLaunchSupport({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15", maxTouchPoints: 5 });
    const windows = nativeLaunchSupport({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36", maxTouchPoints: 0 });
    const android = nativeLaunchSupport({ userAgent: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36", maxTouchPoints: 5 });
    const mac = nativeLaunchSupport({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36", maxTouchPoints: 0 });
    await allowance();
    clock = t0;
    await issue("lease-dr12-native1");
    const s = await stack();
    const native = new Native();
    try {
      const token = cred("lease-dr12-native1");
      const t = await ticket(s.base, "lease-dr12-native1", token);
      const tk = String(t.json!.launchUrl).split("ticket=")[1];
      // A remote tailnet device's request arrives through Tailscale Serve (forwarding headers): never redeemed.
      const viaTailnet = await raw(s.base, "POST", "/v1/native/redeem", { "x-forwarded-for": "100.101.102.103", "x-forwarded-proto": "https", "tailscale-user-login": "child@example.com" }, { ticket: tk, gameId: NATIVE });
      const viaBrowser = await raw(s.base, "POST", "/v1/native/redeem", { origin: ORIGIN, "sec-fetch-site": "cross-site" }, { ticket: tk, gameId: NATIVE });
      const remoteOrigin = await native.send("origin https://dae-macmini.tail4f656e.ts.net:8444");
      const lanOrigin = await native.send("origin http://192.168.1.20:5183");
      const loopback = await native.send("origin http://127.0.0.1:5183");
      // The untouched ticket still works for the local app (the refusals above did not consume it).
      await native.send(`port ${s.port}`);
      const local = await native.send(`launch deimos-rising-studio://play?ticket=${tk}`);
      // A remote Mac's browser (any tailnet device other than this Mac): the device check says no, so the launcher
      // takes no lease; a running browser game and the remaining time stay exactly as they were. Even a ticket request
      // for an existing native lease from that device is refused before any Family read or activation.
      const libTok = mod.mintPlayCredential(key, { sub: "santiago", scope: "library", gid: "*", lid: "-", mode: "edit", metered: false, budget: 0, iat: Math.floor(clock / 1000), exp: Math.floor(clock / 1000) + 600, jti: "lib-dr12" });
      const REMOTE = { "x-forwarded-for": "100.101.102.103" };
      await quit(native);
      await s.server.settler.flush();
      await issue("lease-dr12-browserA", BROWSER);
      const a = cred("lease-dr12-browserA", BROWSER);
      equal((await raw(s.base, "POST", "/v1/play/lease-dr12-browserA/tick", { authorization: `Bearer ${a}` }, { active: true })).status, 200);
      const before = await getPlayState("santiago", client);
      const remoteDevice = await raw(s.base, "GET", "/v1/native/device", { authorization: `Bearer ${libTok}`, ...REMOTE });
      const localDevice = await raw(s.base, "GET", "/v1/native/device", { authorization: `Bearer ${libTok}` });
      const afterCheck = await getPlayState("santiago", client);
      clock += 2000;
      equal((await raw(s.base, "POST", "/v1/play/lease-dr12-browserA/tick", { authorization: `Bearer ${a}` }, { active: true })).status, 200);
      await raw(s.base, "POST", "/v1/play/lease-dr12-browserA/end", { authorization: `Bearer ${a}` }, { reason: "left", frameStopped: true });
      await endPlayLease({ leaseId: "lease-dr12-browserA", personId: "santiago", reason: "left", now: new Date(clock) }, client);
      await s.server.settler.flush();
      await issue("lease-dr12-native2");
      const remoteTicket = await raw(s.base, "POST", "/v1/native/lease-dr12-native2/ticket", { origin: ORIGIN, authorization: `Bearer ${cred("lease-dr12-native2")}`, ...REMOTE }, {});
      const n2Activated = s.server.store.loadLease("lease-dr12-native2") !== null;
      equal(ipad.supported, false);
      equal(mac.supported, true);
      equal(viaTailnet.status, 403);
      record("DR12", {
        remoteDeviceThisMac: remoteDevice.json?.thisMac === true,
        localDeviceThisMac: localDevice.json?.thisMac === true,
        browserLeaseKeptAfterRemoteCheck: afterCheck.activeLease?.id === "lease-dr12-browserA" && before.activeLease?.id === "lease-dr12-browserA",
        remainingUnchangedAfterRemoteCheck: afterCheck.remainingSeconds === before.remainingSeconds,
        remoteTicketStatus: remoteTicket.status,
        remoteTicketActivatedLease: n2Activated,
      });
      record("DR12", { ipadSupported: ipad.supported, iphoneSupported: iphone.supported, windowsSupported: windows.supported, androidSupported: android.supported, macSupported: mac.supported, tailnetRedeemStatus: viaTailnet.status, browserRedeemStatus: viaBrowser.status, appAcceptsRemoteOrigin: Number(remoteOrigin.port) > 0, appAcceptsLanOrigin: Number(lanOrigin.port) > 0, appAcceptsLoopback: Number(loopback.port) === 5183, localAppRedeemAfterRefusals: local.ok === true });
    } finally {
      await native.close();
      await s.close();
    }
  });

  // ---- DR13 -------------------------------------------------------------------------------------------------------
  it("DR13 the five browser paid games and the separately earned chess are unchanged beside the native card", async () => {
    await allowance();
    clock = t0;
    const s = await stack([{ gameId: DAILY_CHESS_GAME_ID, children: ["santiago", "isabel"] }, ...LIVE_IDS.map((gameId) => ({ gameId, children: ["santiago"] })), { gameId: NATIVE, children: ["santiago"] }]);
    try {
      const lib = (sub: string) => mod.mintPlayCredential(key, { sub, scope: "library", gid: "*", lid: "-", mode: "edit", metered: false, budget: 0, iat: Math.floor(clock / 1000), exp: Math.floor(clock / 1000) + 600, jti: `lib-${sub}` });
      const santi = (await raw(s.base, "GET", "/v1/library", { authorization: `Bearer ${lib("santiago")}` })).json!.games as { gameId: string; free: boolean; playable: boolean; launch?: string; platform?: string }[];
      const isabel = (await raw(s.base, "GET", "/v1/library", { authorization: `Bearer ${lib("isabel")}` })).json!.games as { gameId: string }[];
      const browser = santi.filter((g) => LIVE_IDS.includes(g.gameId));
      const browserShapeUnchanged = browser.every((g) => !("launch" in g) && !("platform" in g) && g.playable && !g.free);
      // A browser game still loads its guarded page under its lease; chess still needs today's earned approval.
      await issue("lease-dr13-browser1", LIVE_IDS[0]);
      const page = await raw(s.base, "GET", `/v1/play/lease-dr13-browser1/${LIVE_IDS[0]}/index.html?credential=${encodeURIComponent(cred("lease-dr13-browser1", LIVE_IDS[0]))}`, {});
      const chess = await issuePlayLease({ personId: "santiago", gameId: DAILY_CHESS_GAME_ID, mode: "play", leaseId: "lease-dr13-chess1", takeover: true, deviceLabel: "computer", now: new Date(clock) }, client);
      const chessCard = santi.find((g) => g.gameId === DAILY_CHESS_GAME_ID);
      equal(browser.length, 5);
      ok(browserShapeUnchanged);
      equal(page.status, 200);
      record("DR13", { santiagoGames: santi.length, browserPaidCards: browser.length, browserShapeUnchanged, nativeCards: santi.filter((g) => g.launch === "native").length, chessListedFree: chessCard?.free === true, isabelGames: isabel.map((g) => g.gameId).join(","), browserGuardedPage: page.status, browserPageHasGuard: page.text.includes("data-family-play-guard"), chessWithoutApprovalRefused: !chess.ok, chessRefusalReason: chess.ok ? null : chess.reason });
    } finally {
      await s.close();
    }
  });

  // ---- BX01 (builder-added at parent request) ---------------------------------------------------------------------
  it("BX01 long title and background time up to the 20-minute credential expiry bill only gameplay; reopening continues on the same allowance", async () => {
    await allowance();
    clock = t0;
    await issue("lease-bx01-native1");
    const s = await stack();
    const native = new Native();
    try {
      await at(native, t0);
      await launch(native, s, "lease-bx01-native1", cred("lease-bx01-native1", NATIVE, { ttl: 1200 }));
      // 17 minutes on the title screen (the app keeps reporting, never foreground).
      for (let t = t0; t <= t0 + 17 * 60_000; t += 4000) { await at(native, t); await native.send("tick"); }
      await native.send("game 1");
      await play(native, t0 + 17 * 60_000, t0 + 18 * 60_000);
      // 90 s in the background.
      await native.send("hide 1");
      for (let t = t0 + 18 * 60_000; t <= t0 + 19 * 60_000 + 30_000; t += 1000) { await at(native, t); await native.send("tick"); await native.send("frame"); await native.send("beacon"); }
      await native.send("hide 0");
      // Play from 19:30 across the credential expiry at 20:00 (the meter ends the lease there).
      let endedAt: number | null = null;
      let lastTick = Number.NEGATIVE_INFINITY;
      for (let t = t0 + 19 * 60_000 + 30_000; t <= t0 + 20 * 60_000 + 10_000; t += 100) {
        await at(native, t);
        if (t - lastTick >= 1000) { await native.send("tick"); lastTick = t; }
        const f = await native.send("frame");
        await native.send("beacon");
        if (f.hold === "ended" && endedAt === null) endedAt = t;
      }
      const st = await native.send("state");
      await native.send("end");
      await s.server.settler.flush();
      const first = s.server.store.loadLease("lease-bx01-native1")!;
      const remainingAfterExpiry = await famRemaining();
      // Reopen from the Games page: a new lease on the same allowance, a new link to the SAME running app.
      const again = await issue("lease-bx01-native2");
      const reopen = await launch(native, s, "lease-bx01-native2", cred("lease-bx01-native2"));
      await native.send("game 1");
      await play(native, clock + 1000, clock + 11_000);
      await stopPlaying(native);
      await quit(native);
      await s.server.settler.flush();
      const c2 = (await famLease("lease-bx01-native2")).consumedSeconds;
      // Actual play: 60 s (17:00-18:00) + 30 s (19:30-20:00). The meter bills DELIVERED observations: the last second
      // before the expiry may be reported only after the credential expired (refused), so 89-90 s — never more than the
      // play, never any of the 17 title minutes or the 90 s in the background.
      const billed = first.consumed;
      const remainingNow = await famRemaining();
      record("BX01", { endReasonAtExpiry: String(first.endReason), nativeEndReason: String(st.endReason), billedNotMoreThanPlay: billed <= 90, billedAtLeastPlayMinusOneSecond: billed >= 89, frozenByExpiry: endedAt !== null && endedAt <= t0 + 1_201_000, remainingIsAllowanceMinusBilled: remainingAfterExpiry === 900 - Math.ceil(billed), reopenAttached: reopen.ok === true, reopenBudgetIsRemaining: again.budgetSeconds === remainingAfterExpiry, reopenConsumed: c2, finalRemainingIsExact: remainingNow === remainingAfterExpiry - 10 });
      equal(first.endReason, "credential-expired");
      ok(billed <= 90 && billed >= 89, `billed ${billed}`);
      equal(again.budgetSeconds, remainingAfterExpiry);
      equal(c2, 10);
      equal(remainingNow, remainingAfterExpiry - 10);
    } finally {
      await native.close();
      await s.close();
    }
  });

  // ---- BX02 (builder-added after the October 26 live launch hung) -------------------------------------------------
  // Production: Family's signed status read of an active lease took 3.8-4.0 s (Vercel request log, 09:36-09:40 CET),
  // longer than the 2 s authority window, so every ticket was refused and the launcher kept "Preparing the launch…".
  it("BX02 Family answering slower than the authority window: no ticket, nothing counted, and the meter's end resolves the lease Family recorded as activated; a fast answer plays continuously", async () => {
    await allowance();
    clock = t0;
    await issue("lease-bx02-native1");
    const s = await stack();
    const native = new Native();
    try {
      // (a) The measured production latency: three ticket attempts, 40 s apart (the launcher's refresh), all refused.
      familyLatencyMs = 3900;
      const tok1 = cred("lease-bx02-native1");
      const ticketStatuses: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        ticketStatuses.push((await ticket(s.base, "lease-bx02-native1", tok1)).status);
        clock += 40_000;
      }
      const meterNeverRan = s.server.store.loadLease("lease-bx02-native1") === null;
      const activatedAtFamily = (await famLease("lease-bx02-native1")).activatedAt !== null;
      // The launcher is left: Family releases the lease, then the page's end reaches the meter (same credential).
      await endPlayLease({ leaseId: "lease-bx02-native1", personId: "santiago", reason: "left", now: new Date(clock) }, client);
      const released = await famLease("lease-bx02-native1");
      const reserveHeldBeforeEnd = released.finalSettled ? 0 : Math.max(0, released.capSeconds - released.consumedSeconds);
      const end = await raw(s.base, "POST", "/v1/play/lease-bx02-native1/end", { origin: ORIGIN, authorization: `Bearer ${tok1}` }, { reason: "left", frameStopped: true, grant: null, runMs: null });
      await s.server.settler.flush();
      const resolved = await famLease("lease-bx02-native1");
      familyLatencyMs = 0;
      const next = await issue("lease-bx02-native2");
      record("BX02", {
        ticketStatusesAtProductionLatency: ticketStatuses.join(","),
        meterNeverRanRefusedLease: meterNeverRan,
        familyRecordedActivation: activatedAtFamily,
        reserveHeldAfterReleaseSeconds: reserveHeldBeforeEnd,
        releasedLeaseHeldReserveUntilMeterEnd: reserveHeldBeforeEnd > 0,
        meterEndStatus: end.status,
        familyFinalSettledAfterEnd: resolved.finalSettled,
        familyConsumedAfterEnd: resolved.consumedSeconds,
        nextLeaseBudgetIsFullAllowance: next.budgetSeconds === 900,
      });
      deepEqual(ticketStatuses, [503, 503, 503]);
      ok(meterNeverRan);
      ok(reserveHeldBeforeEnd > 0, "the released, activated lease holds a reserve until the meter reports");
      equal(resolved.finalSettled, true);
      equal(resolved.consumedSeconds, 0);
      equal(next.budgetSeconds, 900);

      // (b) Continuity of play by Family latency (renewal every second, frames every 100 ms; the clock never runs back).
      const runShare = async (lid: string, latency: number) => {
        await issue(lid);
        familyLatencyMs = latency;
        await launch(native, s, lid, cred(lid));
        await native.send("game 1");
        let frames = 0;
        let running = 0;
        let lastTick = Number.NEGATIVE_INFINITY;
        const from = clock + 1000;
        for (let t = from; t <= from + 20_000; t += 100) {
          await at(native, t);
          if (t - lastTick >= 1000) {
            await native.send("tick");
            lastTick = t;
            if (clock > t) { t = clock; await at(native, t); }
          }
          const f = await native.send("frame");
          frames += 1;
          if (f.run) running += 1;
          await native.send("beacon");
        }
        await stopPlaying(native);
        familyLatencyMs = 0;
        await quit(native);
        await s.server.settler.flush();
        clock += 5000;
        return Math.round((running / frames) * 100) / 100;
      };
      const share300 = await runShare("lease-bx02-native3", 300);
      const share600 = await runShare("lease-bx02-native4", 600);
      const share900 = await runShare("lease-bx02-native5", 900);
      const share1500 = await runShare("lease-bx02-native6", 1500);
      record("BX02", { continuousPlayAtFamilyLatency300ms: share300 >= 0.95, runShareAtFamilyLatency300ms: share300, runShareAtFamilyLatency600ms: share600, runShareAtFamilyLatency900ms: share900, runShareAtFamilyLatency1500ms: share1500 });
      ok(share300 >= 0.95, `run share at 300 ms: ${share300}`);
    } finally {
      await native.close();
      await s.close();
    }
  });

  // ======================================================================================================================
  // Planner-owned additional cases AR02-AR07, AR10, LK02 (October 26, 17:08). AR01 lives in
  // family-play-status-consolidated.test.ts, AR08/AR09/LK01 run on the real clock with the real app, LK03 is rendered.
  // ======================================================================================================================
  const INTENT = { active: false, hidden: false, paused: false, foreground: true, grant: null, runMs: null };
  const report = (base: string, lid: string, token: string, body: Record<string, unknown> = INTENT) => raw(base, "POST", `/v1/play/${lid}/tick`, { origin: ORIGIN, authorization: `Bearer ${token}` }, body);
  const endAt = (base: string, lid: string, token: string) => raw(base, "POST", `/v1/play/${lid}/end`, { origin: ORIGIN, authorization: `Bearer ${token}` }, { reason: "left", frameStopped: true, grant: null, runMs: null });
  const redeem = (base: string, ticketValue: string, headers: Record<string, string> = {}) => raw(base, "POST", "/v1/native/redeem", headers, { ticket: ticketValue, gameId: NATIVE });
  const ticketOf = (r: { json: Record<string, unknown> | null }) => /ticket=(.+)$/.exec(String(r.json?.launchUrl ?? ""))?.[1] ?? "";
  const familyRow = async (lid: string) => (await client.execute({ sql: "SELECT * FROM family_play_leases WHERE id = ?", args: [lid] })).rows[0] as Record<string, unknown> | undefined;
  const issueFor = async (person: "santiago" | "isabel", lid: string, gameId: string, takeover = true) => {
    const r = await issuePlayLease({ personId: person, gameId, mode: "play", leaseId: lid, takeover, deviceLabel: "computer", now: new Date(clock) }, client);
    ok(r.ok, JSON.stringify(r));
    return r.ok ? r.lease : null!;
  };
  /** Step the clock until `lid`'s ticket is issued (B becomes playable at the meter); returns that instant. */
  async function firstPlayable(base: string, lid: string, token: string, from: number, to: number) {
    for (let t = from; t <= to; t += 100) {
      clock = t;
      if ((await ticket(base, lid, token)).status === 201) return t;
    }
    return null;
  }

  // ---- AR02 -------------------------------------------------------------------------------------------------------
  it("AR02 real fencing, not a freshness TTL: status versus end/takeover in both orders, replies delayed below and at the 2 s boundary", async () => {
    const cases: Record<string, unknown>[] = [];
    for (const order of ["takeover-before-reply", "reply-before-takeover"]) {
      for (const delay of [0, 1000, 1999, 2000]) {
        await allowance();
        clock = t0;
        const A = `lease-ar02-a-${order.slice(0, 1)}${delay}`;
        const B = `lease-ar02-b-${order.slice(0, 1)}${delay}`;
        await issue(A);
        const s = await stack();
        try {
          const tokA = cred(A);
          equal((await ticket(s.base, A, tokA)).status, 201);
          // A's report at t2: Family snapshots A at once; the reply reaches the meter `delay` ms later.
          clock = t0 + 2000;
          const release = holdStatus(A);
          const pending = report(s.base, A, tokA);
          await untilReading(A);
          if (order === "takeover-before-reply") { clock = t0 + 2500; await issue(B); }
          clock = t0 + 2000 + delay;
          release();
          const r = await pending;
          const repliedAt = clock;
          if (order === "reply-before-takeover") { clock = repliedAt + 1; await issue(B); }
          const rowA = (await familyRow(A))!;
          // Family's fence for A: the end of the window it granted (A's end takes effect there unless A's meter reports
          // its end first — the documented early release of the handover).
          const familyFence = Date.parse(String(rowA["ended_at"] ?? rowA["authority_until"]));
          // The deadline the app holds: counted from the instant it SENT the report (t2), as the native core and the
          // meter's recorded frame deadline do; a deadline already past when the reply arrives thaws nothing.
          const grantMs = r.status === 200 && typeof r.json?.authorizedForMs === "number" ? Number(r.json.authorizedForMs) : 0;
          const handed = t0 + 2000 + grantMs;
          const effectiveHanded = grantMs > 0 && handed > repliedAt ? handed : null;
          const meterFrameDeadline = (s.server.store.loadLease(A)?.frameDeadline as number | null | undefined) ?? null;
          const tokB = cred(B);
          const bFirst = await firstPlayable(s.base, B, tokB, clock, familyFence + 3000);
          cases.push({ order, delay, replyStatus: r.status, grantMs, handedPastFamilyFenceMs: grantMs > 0 ? handed - familyFence : null, effectiveHanded: effectiveHanded !== null, meterFrameDeadlineMatches: meterFrameDeadline === effectiveHanded, bFirstMinusHandedMs: bFirst === null ? null : effectiveHanded === null ? 0 : bFirst - effectiveHanded, bFirstMinusFamilyFenceMs: bFirst === null ? null : bFirst - familyFence });
        } finally {
          await s.close();
        }
      }
    }
    // No grant reaches past Family's fence; the successor never becomes playable before the deadline the predecessor's
    // app actually holds (Family's own fence may be released earlier by the predecessor's terminal report).
    const noGrantPastFence = cases.every((c) => c.handedPastFamilyFenceMs === null || (c.handedPastFamilyFenceMs as number) <= 0) && cases.every((c) => c.meterFrameDeadlineMatches === true);
    const successorNeverPlayableBeforeFence = cases.every((c) => c.bFirstMinusHandedMs !== null && (c.bFirstMinusHandedMs as number) >= 0);
    record("AR02", { casesRun: cases.length, noGrantPastFence, successorNeverPlayableBeforeFence, staleReplyAuthorizedPastFence: !noGrantPastFence, cases: JSON.stringify(cases) });
    ok(noGrantPastFence, JSON.stringify(cases));
    ok(successorNeverPlayableBeforeFence, JSON.stringify(cases));
  });

  // ---- AR03 -------------------------------------------------------------------------------------------------------
  it("AR03 expiry and final-await gates: no launch or gameplay authority from an expired credential/window, checked after every await and at commit", async () => {
    await allowance();
    clock = t0;
    await issue("lease-ar03-a");
    const s = await stack();
    try {
      // An expired credential gets no ticket and no report.
      const short = cred("lease-ar03-a", NATIVE, { ttl: 5 });
      equal((await ticket(s.base, "lease-ar03-a", short)).status, 201);
      clock = t0 + 6000;
      const expiredTicket = await ticket(s.base, "lease-ar03-a", short);
      const expiredReport = await report(s.base, "lease-ar03-a", short);
      // Expiry while a Family read is in flight: the reply is checked against the clock AFTER the await.
      await allowance();
      clock = t0 + 10_000;
      await issue("lease-ar03-b");
      const tokB = cred("lease-ar03-b", NATIVE, { ttl: 5 });
      equal((await ticket(s.base, "lease-ar03-b", tokB)).status, 201);
      clock = t0 + 14_500;
      const release = holdStatus("lease-ar03-b");
      const slow = report(s.base, "lease-ar03-b", tokB);
      await untilReading("lease-ar03-b");
      clock = t0 + 15_500; // past the credential's expiry (t0+15 s)
      release();
      const slowReply = await slow;
      // A reply whose authority window lapsed before it was applied grants nothing (both reads arrive after 2.1 s).
      await allowance();
      clock = t0 + 30_000;
      await issue("lease-ar03-c");
      const tokC = cred("lease-ar03-c");
      equal((await ticket(s.base, "lease-ar03-c", tokC)).status, 201);
      clock = t0 + 31_000;
      familyLatencyMs = 2100;
      const lapsed = await report(s.base, "lease-ar03-c", tokC);
      familyLatencyMs = 0;
      // Local replacement: once the successor is active on this meter, the predecessor is refused.
      clock += 3000;
      await issue("lease-ar03-d");
      const tokD = cred("lease-ar03-d");
      const dFirst = await firstPlayable(s.base, "lease-ar03-d", tokD, clock, clock + 6000);
      const afterReplacement = await report(s.base, "lease-ar03-c", tokC);
      const meterC = s.server.store.loadLease("lease-ar03-c")!;
      const observed = {
        expiredCredentialTicketRefused: expiredTicket.status === 401,
        expiredCredentialReportRefused: expiredReport.status === 401,
        expiryDuringSlowRenewalRefused: slowReply.status === 401 && !(Number(slowReply.json?.authorizedForMs ?? 0) > 0),
        grantAfterWindowLapseMs: Number(lapsed.json?.authorizedForMs ?? 0),
        lapsedReplyStatus: lapsed.status,
        localReplacementFenceHeld: dFirst !== null && afterReplacement.status === 410 && meterC.state === "ended" && !(Number(afterReplacement.json?.authorizedForMs ?? 0) > 0),
        expiredTicketStatus: expiredTicket.status,
        expiredReportStatus: expiredReport.status,
        slowReplyStatus: slowReply.status,
        afterReplacementStatus: afterReplacement.status,
      };
      record("AR03", observed);
      ok(observed.expiredCredentialTicketRefused && observed.expiredCredentialReportRefused && observed.expiryDuringSlowRenewalRefused && observed.localReplacementFenceHeld, JSON.stringify(observed));
      equal(observed.grantAfterWindowLapseMs, 0);
    } finally {
      await s.close();
    }
  });

  // ---- AR04 -------------------------------------------------------------------------------------------------------
  it("AR04 single-flight renewal: a burst of reports for one lease costs one Family read; another lease is not held up", async () => {
    await allowance();
    await client.execute({ sql: "INSERT INTO family_play_allowances VALUES ('isabel', 900, 0, ?)", args: [new Date(t0).toISOString()] });
    clock = t0;
    await issue("lease-ar04-a");
    await issueFor("isabel", "lease-ar04-x", BROWSER);
    const s = await stack([{ gameId: NATIVE, children: ["santiago"] }, { gameId: BROWSER, children: ["santiago", "isabel"] }]);
    try {
      const tokA = cred("lease-ar04-a");
      const tokX = cred("lease-ar04-x", BROWSER, { sub: "isabel" });
      equal((await ticket(s.base, "lease-ar04-a", tokA)).status, 201);
      equal((await report(s.base, "lease-ar04-x", tokX)).status, 200);
      clock = t0 + 1000;
      const readsBefore = statusReads.get("lease-ar04-a") ?? 0;
      const release = holdStatus("lease-ar04-a");
      const burst = Array.from({ length: 5 }, () => report(s.base, "lease-ar04-a", tokA));
      await untilReading("lease-ar04-a");
      // Meanwhile another child's lease is served normally.
      const other = await report(s.base, "lease-ar04-x", tokX);
      const aStillHeld = (statusInflight.get("lease-ar04-a") ?? 0) === 1;
      release();
      const replies = await Promise.all(burst);
      const observed = {
        burstReplies: replies.map((r) => r.status).join(","),
        maxConcurrentFamilyReadsPerLease: maxStatusInflight.get("lease-ar04-a") ?? 0,
        familyReadsForConcurrentBurst: (statusReads.get("lease-ar04-a") ?? 0) - readsBefore,
        otherLeaseIsolated: other.status === 200 && aStillHeld,
        pendingRenewalsAfterBurst: statusInflight.get("lease-ar04-a") ?? 0,
      };
      record("AR04", observed);
      equal(observed.burstReplies, "200,200,200,200,200");
      equal(observed.familyReadsForConcurrentBurst, 1);
      ok(observed.otherLeaseIsolated);
    } finally {
      await s.close();
    }
  });

  // ---- AR05 -------------------------------------------------------------------------------------------------------
  it("AR05 late-result fencing: an answer completing after end, expiry, takeover or a newer answer cannot revive or overwrite", async () => {
    // Each scenario holds lease A's Family answer (snapshot taken, reply delayed) while the lease is moved on, on ONE
    // meter (two live instances on one store cannot exist: one instance per data directory).
    const scenario = async (name: string, ttl: number, move: (st: Awaited<ReturnType<typeof stack>>, lid: string, tok: string) => Promise<unknown>) => {
      await allowance();
      clock = t0;
      const lid = `lease-ar05-${name}`;
      await issue(lid);
      const st = await stack();
      try {
        const tok = cred(lid, NATIVE, { ttl });
        equal((await ticket(st.base, lid, tok)).status, 201);
        clock = t0 + 1000;
        const release = holdStatus(lid);
        const late = report(st.base, lid, tok);
        await untilReading(lid);
        const moved = move(st, lid, tok); // may itself wait for the lease lock held by the late report
        await new Promise((r) => setTimeout(r, 20));
        release();
        const reply = await late;
        const moveResult = await moved;
        await st.server.settler.flush();
        const after = st.server.store.loadLease(lid) as Record<string, unknown>;
        return { reply, after, moveResult };
      } finally {
        await st.close();
      }
    };
    // (1) The app ends the session while its previous report waits for Family: the end's receipt is persisted first.
    const ended = await scenario("end", 1200, async (st, lid, tok) => { clock = t0 + 1200; return endAt(st.base, lid, tok); });
    // (2) The credential expires while the answer is on its way.
    const expired = await scenario("expiry", 2, async () => { clock = t0 + 2500; });
    // (3) A successor's activation ends A on this meter (handover path) while A's answer is still on its way.
    const takeover = await scenario("takeover", 1200, async (st, lid) => {
      clock = t0 + 1500;
      await issue(`${lid}-b`);
      return ticket(st.base, `${lid}-b`, cred(`${lid}-b`));
    });
    // (4) An answer older than the one already applied (unreachable through HTTP within one instance — see
    //     applyStatusAnswer): applied after a newer one, it moves neither window nor cap.
    await allowance();
    clock = t0;
    await issue("lease-ar05-older");
    const o = await stack();
    let lateOlderResultOverwroteNewer = true;
    let newerApplied = false;
    try {
      const tok = cred("lease-ar05-older");
      equal((await ticket(o.base, "lease-ar05-older", tok)).status, 201);
      const status = (budgetSeconds: number) => ({ leaseId: "lease-ar05-older", state: "active", personId: "santiago", gameId: NATIVE, budgetSeconds, metered: true, budgetKind: "paid", authorizedForSeconds: 2 });
      clock = t0 + 3000;
      const newer = await o.server.applyStatusAnswer("lease-ar05-older", { ok: true, status: status(600), requestedAt: t0 + 2900, authorizedUntil: t0 + 4900 });
      newerApplied = (newer?.lease?.authorityUntil === t0 + 4900) && newer?.lease?.budget === 600;
      const snapshot = JSON.stringify(o.server.store.loadLease("lease-ar05-older"));
      await o.server.applyStatusAnswer("lease-ar05-older", { ok: true, status: status(900), requestedAt: t0 + 2500, authorizedUntil: t0 + 4500 });
      lateOlderResultOverwroteNewer = JSON.stringify(o.server.store.loadLease("lease-ar05-older")) !== snapshot;
    } finally {
      await o.close();
    }
    // (5) Family errors are handled: the report fails closed, nothing changes, the meter keeps serving.
    await allowance();
    clock = t0;
    await issue("lease-ar05-error");
    const e = await stack();
    let errorHandled = false;
    try {
      const tok = cred("lease-ar05-error");
      equal((await ticket(e.base, "lease-ar05-error", tok)).status, 201);
      clock = t0 + 1000;
      brokenLeases.add("lease-ar05-error");
      const failed = await report(e.base, "lease-ar05-error", tok);
      brokenLeases.delete("lease-ar05-error");
      const health = await raw(e.base, "GET", "/v1/health", {});
      const afterErr = e.server.store.loadLease("lease-ar05-error")!;
      clock = t0 + 1500;
      const recovered = await report(e.base, "lease-ar05-error", tok);
      errorHandled = failed.status === 503 && health.status === 200 && afterErr.state === "active" && afterErr.consumed === 0 && recovered.status === 200;
    } finally {
      await e.close();
    }
    const grantOf = (r: { status: number; json: Record<string, unknown> | null }) => (r.status === 200 ? Number(r.json?.authorizedForMs ?? 0) : 0);
    const observed = {
      lateResultAfterEndRevived: ended.after.state !== "ended" || Number(ended.after.consumed) !== 0,
      lateResultAfterExpiryRevived: expired.after.state !== "ended" || grantOf(expired.reply) > 0,
      lateResultAfterTakeoverRevived: takeover.after.state !== "ended" || grantOf(takeover.reply) > 0,
      lateOlderResultOverwroteNewer: lateOlderResultOverwroteNewer || !newerApplied,
      familyErrorHandled: errorHandled,
      lateReplies: [ended.reply.status, expired.reply.status, takeover.reply.status].join(","),
      endStatus: (ended.moveResult as { status: number }).status,
      successorTicketStatus: (takeover.moveResult as { status: number }).status,
    };
    record("AR05", observed);
    ok(!observed.lateResultAfterEndRevived && !observed.lateResultAfterExpiryRevived && !observed.lateResultAfterTakeoverRevived && !observed.lateOlderResultOverwroteNewer && observed.familyErrorHandled, JSON.stringify(observed));
  });

  // ---- AR06 -------------------------------------------------------------------------------------------------------
  it("AR06 evidence-conserving terminal paths: observed foreground kept, unobserved time never billed, reserve conserved (R6-1)", async () => {
    /** Frames every 100 ms on a clock that never runs back (a slow Family read may move it), reports every second. */
    async function run(native: Native, from: number, to: number) {
      let runFrames = 0;
      let lastTick = Number.NEGATIVE_INFINITY;
      for (let t = from; t <= to; t += 100) {
        if (clock > t) t = clock;
        await at(native, t);
        if (t - lastTick >= 1000) { await native.send("tick"); lastTick = t; if (clock > t) { t = clock; await at(native, t); } }
        if ((await native.send("frame")).run) runFrames += 1;
        await native.send("beacon");
      }
      return runFrames;
    }
    const sessionsObserved = (l: Record<string, unknown>) => [...((l.closedSessions as { observed?: number }[] | undefined) ?? []), ...(l.session ? [l.session as { observed?: number }] : [])].reduce((n, x) => n + (x.observed ?? 0), 0);
    const paths: Record<string, unknown>[] = [];
    const path = async (name: string, body: (ctx: { s: Awaited<ReturnType<typeof stack>>; native: Native; lid: string; tok: string }) => Promise<{ s: Awaited<ReturnType<typeof stack>>; runFrames: number; successor?: string }>, ttl = 1200) => {
      await allowance();
      clock = t0;
      const lid = `lease-ar06-${name}`;
      await issue(lid);
      const s0 = await stack();
      const native = new Native();
      let s = s0;
      try {
        const tok = cred(lid, NATIVE, { ttl });
        await at(native, t0);
        await launch(native, s0, lid, tok);
        await native.send("game 1");
        const r = await body({ s: s0, native, lid, tok });
        s = r.s;
        await s.server.settler.flush();
        const meter = s.server.store.loadLease(lid)!;
        const fam = await famLease(lid);
        const appRan = r.runFrames / 10;
        const next = r.successor ?? `${lid}-next`;
        if (!r.successor) { clock += 1000; await issue(next); }
        const nextBudget = (await famLease(next)).budgetSeconds;
        const row = {
          path: name,
          appRanSeconds: appRan,
          meterConsumed: Math.round(meter.consumed * 1000) / 1000,
          deliveredObserved: Math.round(sessionsObserved(meter as Record<string, unknown>) * 1000) / 1000,
          familyConsumed: fam.consumedSeconds,
          familyFinal: fam.finalSettled,
          meterState: meter.state,
          endReason: meter.endReason,
          nextBudget,
        };
        paths.push(row);
      } finally {
        await native.close();
        if (s !== s0) await s0.close().catch(() => {});
        await s.close().catch(() => {});
      }
    };
    await path("pause", async ({ s, native }) => {
      const ran = await run(native, t0 + 2000, t0 + 7000);
      await native.send("pause 1");
      const paused = await run(native, t0 + 7100, t0 + 12_000);
      await native.send("pause 0");
      await stopPlaying(native);
      await quit(native);
      return { s, runFrames: ran + paused };
    });
    await path("outage", async ({ s, native }) => {
      const ran = await run(native, t0 + 2000, t0 + 7000);
      outage = true;
      const during = await run(native, t0 + 7100, t0 + 67_000);
      outage = false;
      await stopPlaying(native);
      await quit(native);
      return { s, runFrames: ran + during };
    });
    await path("failed-renewal", async ({ s, native }) => {
      const ran = await run(native, t0 + 2000, t0 + 7000);
      familyLatencyMs = 2100; // every answer arrives after its 2 s window: unusable
      const during = await run(native, clock + 100, clock + 8000);
      familyLatencyMs = 0;
      await stopPlaying(native);
      await quit(native);
      return { s, runFrames: ran + during };
    });
    await path("credential-expiry", async ({ s, native }) => {
      const ran = await run(native, t0 + 2000, t0 + 15_000);
      await native.send("end");
      return { s, runFrames: ran };
    }, 10);
    await path("explicit-end", async ({ s, native }) => {
      const ran = await run(native, t0 + 2000, t0 + 7000);
      await stopPlaying(native);
      await quit(native);
      return { s, runFrames: ran };
    });
    await path("delayed-ack", async ({ s, native, lid }) => {
      let releaseAcks!: () => void;
      settleGate = new Promise<void>((r) => (releaseAcks = r));
      const ran = await run(native, t0 + 2000, t0 + 35_000);
      await issue(`${lid}-b`); // Family hands the time to another device at 35 s
      const after = await run(native, t0 + 35_100, t0 + 45_000);
      releaseAcks();
      settleGate = null;
      await native.send("end");
      return { s, runFrames: ran + after, successor: `${lid}-b` };
    });
    await path("sweep", async ({ s, native }) => {
      const ran = await run(native, t0 + 2000, t0 + 7000);
      native.kill(); // crash: no end, no final observation
      clock = t0 + 7000 + (mod.LEASE_IDLE_END_SECONDS + 60) * 1000;
      s.server.sweep();
      return { s, runFrames: ran };
    });
    await path("restart", async ({ s, native }) => {
      const ran = await run(native, t0 + 2000, t0 + 7000);
      await s.close();
      const s2 = await stack(undefined, s.dataDir);
      await native.send(`port ${s2.port}`);
      const more = await run(native, t0 + 7100, t0 + 12_000);
      await stopPlaying(native);
      await quit(native);
      return { s: s2, runFrames: ran + more };
    });
    const billedOk = (p: Record<string, unknown>) => Math.abs((p.meterConsumed as number) - (p.deliveredObserved as number)) <= 0.001 && p.familyConsumed === Math.ceil((p.meterConsumed as number) - 1e-9) && p.familyFinal === true;
    const unobserved = paths.reduce((n, p) => n + Math.max(0, (p.familyConsumed as number) - Math.ceil((p.appRanSeconds as number) - 1e-9)), 0);
    const observed = {
      pathsCovered: paths.length,
      allPathsBilledEqualsObserved: paths.every(billedOk),
      unobservedSecondsBilled: unobserved,
      allPathsReserveConserved: paths.every((p) => p.nextBudget === 900 - (p.familyConsumed as number)),
      maxObservedNotDeliveredSeconds: Math.max(...paths.map((p) => Math.round(((p.appRanSeconds as number) - (p.deliveredObserved as number)) * 1000) / 1000)),
      paths: JSON.stringify(paths),
    };
    record("AR06", observed);
    ok(observed.allPathsBilledEqualsObserved && observed.allPathsReserveConserved && unobserved === 0, observed.paths);
  });

  // ---- AR07 -------------------------------------------------------------------------------------------------------
  it("AR07 atomic grant/cap view: every reply from one coherent snapshot; stale answers cannot extend grant or cap; exhaustion unchanged", async () => {
    await allowance();
    clock = t0;
    await issue("lease-ar07-a");
    const s = await stack();
    const native = new Native();
    let replyFromSingleSnapshot = true;
    let grantWithinAuthority = true;
    try {
      const tok = cred("lease-ar07-a");
      await at(native, t0);
      await launch(native, s, "lease-ar07-a", tok);
      await native.send("game 1");
      await play(native, t0 + 1000, t0 + 6000);
      for (let i = 0; i < 5; i += 1) {
        clock = t0 + 6100 + i * 300;
        const r = await report(s.base, "lease-ar07-a", tok, { active: false, hidden: false, paused: false, foreground: true, grant: null, runMs: null });
        const l = s.server.store.loadLease("lease-ar07-a")! as Record<string, unknown> & { consumed: number };
        const budget = Number(l.budget);
        const authorityUntil = Number(l.authorityUntil);
        if (Number(r.json?.consumedSeconds) !== Math.round(l.consumed) && Number(r.json?.consumedSeconds) !== l.consumed) replyFromSingleSnapshot = false;
        if (Number(r.json?.remainingSeconds) > budget - l.consumed + 0.001) replyFromSingleSnapshot = false;
        if (Number(r.json?.authorizedForMs ?? 0) > authorityUntil - clock) grantWithinAuthority = false;
      }
    } finally {
      await native.close();
      await s.close();
    }
    // A stale answer applied after a newer one (see AR05) must not raise the cap or extend the window.
    await allowance();
    clock = t0;
    await issue("lease-ar07-b");
    const o = await stack();
    let staleReplyExtendedGrant = true;
    let staleReplyRaisedCap = true;
    try {
      equal((await ticket(o.base, "lease-ar07-b", cred("lease-ar07-b"))).status, 201);
      const status = (budgetSeconds: number) => ({ leaseId: "lease-ar07-b", state: "active", personId: "santiago", gameId: NATIVE, budgetSeconds, metered: true, budgetKind: "paid", authorizedForSeconds: 2 });
      clock = t0 + 3000;
      await o.server.applyStatusAnswer("lease-ar07-b", { ok: true, status: status(600), requestedAt: t0 + 2900, authorizedUntil: t0 + 4900 });
      await o.server.applyStatusAnswer("lease-ar07-b", { ok: true, status: status(900), requestedAt: t0 + 2950, authorizedUntil: t0 + 4950 - 100 });
      await o.server.applyStatusAnswer("lease-ar07-b", { ok: true, status: status(900), requestedAt: t0 + 2000, authorizedUntil: t0 + 5500 });
      const l = o.server.store.loadLease("lease-ar07-b")! as Record<string, unknown>;
      staleReplyExtendedGrant = Number(l.authorityUntil) !== t0 + 4950 - 100;
      staleReplyRaisedCap = Number(l.budget) > 900;
      // The newest answer (2950) applies in full — including its larger budget, which IS Family's authority at its read.
      staleReplyExtendedGrant = staleReplyExtendedGrant || Number(l.authorityReadAt) !== t0 + 2950;
    } finally {
      await o.close();
    }
    // Exhaustion and the save tail as in DR07 (same lease rules, same numbers).
    await allowance(130);
    clock = t0;
    await issue("lease-ar07-exh");
    const e = await stack();
    const en = new Native();
    let warnings = 0;
    let graces = 0;
    let endReason = "";
    let stopGame = false;
    try {
      await at(en, t0);
      await launch(en, e, "lease-ar07-exh", cred("lease-ar07-exh", NATIVE, { budget: 130 }));
      await en.send("game 1");
      let lastTick = Number.NEGATIVE_INFINITY;
      for (let t = t0; t <= t0 + 240_000; t += 100) {
        await at(en, t);
        if (t - lastTick >= 1000) { await en.send("tick"); lastTick = t; }
        const n = await en.send("notice");
        if (n.notice === "warning") warnings += 1;
        if (n.notice === "grace") graces += 1;
        const f = await en.send("frame");
        await en.send("beacon");
        if (f.hold === "ended") { stopGame = f.stopGame === true; endReason = String((await en.send("state")).endReason); break; }
      }
      await en.send("game 0");
      await en.send("end");
      await e.server.settler.flush();
    } finally {
      await en.close();
      await e.close();
    }
    const exhaustionSaveTailUnchanged = warnings === 1 && graces === 1 && endReason === "exhausted" && stopGame && (await famRemaining()) === 0 && e.server.store.loadLease("lease-ar07-exh")!.consumed === 130;
    const observed = { replyFromSingleSnapshot: replyFromSingleSnapshot && grantWithinAuthority, staleReplyExtendedGrant, staleReplyRaisedCap, exhaustionSaveTailUnchanged, warnings, graces, endReason };
    record("AR07", observed);
    ok(observed.replyFromSingleSnapshot && !staleReplyExtendedGrant && !staleReplyRaisedCap && exhaustionSaveTailUnchanged, JSON.stringify(observed));
  });

  // ---- AR10 -------------------------------------------------------------------------------------------------------
  it("AR10 unused-time reconciliation: abandoned launch and an end during a slow renewal keep the full unused budget; terminal reports idempotent and confined", async () => {
    await allowance();
    clock = t0;
    // Abandoned launch: the link was issued (the meter activated the lease), the child left before clicking.
    await issue("lease-ar10-left");
    const s = await stack();
    const native = new Native();
    try {
      const tokL = cred("lease-ar10-left");
      equal((await ticket(s.base, "lease-ar10-left", tokL)).status, 201);
      clock = t0 + 5000;
      await endPlayLease({ leaseId: "lease-ar10-left", personId: "santiago", reason: "left", now: new Date(clock) }, client); // the page: Family first
      await endAt(s.base, "lease-ar10-left", tokL); // then the meter
      await s.server.settler.flush();
      clock = t0 + 6000;
      const a = await issue("lease-ar10-a");
      const abandonedLaunchFullBudget = a.budgetSeconds === 900 && (await famLease("lease-ar10-left")).finalSettled === true;
      // End during a slow renewal: 5 s played, the app's last report waits for Family while the app ends the session.
      const tokA = cred("lease-ar10-a");
      await at(native, t0 + 6000);
      await launch(native, s, "lease-ar10-a", tokA);
      await native.send("game 1");
      await play(native, t0 + 7000, t0 + 12_000);
      await native.send("game 0");
      clock = t0 + 12_100;
      const release = holdStatus("lease-ar10-a");
      const slow = report(s.base, "lease-ar10-a", tokA, { active: false, hidden: false, paused: true, foreground: false, grant: null, runMs: null });
      await untilReading("lease-ar10-a");
      clock = t0 + 12_300;
      const ending = endAt(s.base, "lease-ar10-a", tokA);
      await new Promise((r) => setTimeout(r, 20));
      release();
      await slow;
      await ending;
      await s.server.settler.flush();
      const famA = await famLease("lease-ar10-a");
      const meterA = s.server.store.loadLease("lease-ar10-a")!;
      // Billed = the observed play (5.1 s of frames, delivered) rounded up once; everything else stays available.
      const endDuringSlowRenewalFullUnused = famA.finalSettled === true && meterA.state === "ended" && famA.consumedSeconds === Math.ceil(meterA.consumed - 1e-9) && meterA.consumed <= 5.1 + 1e-9 && (await famRemaining()) === 900 - famA.consumedSeconds;
      // Repeated ends add nothing; a subsequent session gets exactly the unused time.
      await endAt(s.base, "lease-ar10-a", tokA);
      await endAt(s.base, "lease-ar10-a", tokA);
      await s.server.settler.flush();
      clock = t0 + 20_000;
      const next = await issue("lease-ar10-next");
      const subsequentSessionFullBudget = next.budgetSeconds === 900 - famA.consumedSeconds;
      const finals = (lid: string) => settlements.filter((b) => b.leaseId === lid && b.end === true).length;
      const ids = new Set(settlements.map((b) => String(b.leaseId)));
      const observed = {
        abandonedLaunchFullBudget,
        endDuringSlowRenewalFullUnused,
        subsequentSessionFullBudget,
        terminalReportsIdempotent: finals("lease-ar10-a") === 1 && finals("lease-ar10-left") === 1,
        terminalReportsConfinedToLease: [...ids].every((id) => id === "lease-ar10-left" || id === "lease-ar10-a"),
        consumedA: famA.consumedSeconds,
        meterObservedA: meterA.consumed,
        nextBudget: next.budgetSeconds,
        settlementLeases: [...ids].join(","),
      };
      record("AR10", observed);
      ok(observed.abandonedLaunchFullBudget && observed.endDuringSlowRenewalFullUnused && observed.subsequentSessionFullBudget && observed.terminalReportsIdempotent && observed.terminalReportsConfinedToLease, JSON.stringify(observed));
    } finally {
      await native.close();
      await s.close();
    }
  });

  // ---- LK02 -------------------------------------------------------------------------------------------------------
  it("LK02 ticket denial invariants: expired, replayed, wrong-child, remote-device, ended and replaced-lease links stay refused", async () => {
    await allowance();
    await client.execute({ sql: "INSERT INTO family_play_allowances VALUES ('isabel', 900, 0, ?)", args: [new Date(t0).toISOString()] });
    clock = t0;
    await issue("lease-lk02-a");
    const s = await stack([{ gameId: NATIVE, children: ["santiago"] }, { gameId: BROWSER, children: ["santiago", "isabel"] }]);
    try {
      const tok = cred("lease-lk02-a");
      const t1 = ticketOf(await ticket(s.base, "lease-lk02-a", tok));
      clock = t0 + 60_001;
      const expired = await redeem(s.base, t1);
      const t2 = ticketOf(await ticket(s.base, "lease-lk02-a", tok));
      const t3 = ticketOf(await ticket(s.base, "lease-lk02-a", tok));
      const first = await redeem(s.base, t3);
      const replay = await redeem(s.base, t3);
      const sibling = await redeem(s.base, t2);
      // Another child's credential for this lease, a remote device through the proxy, a proxied redemption.
      const wrongChild = await ticket(s.base, "lease-lk02-a", cred("lease-lk02-a", NATIVE, { sub: "isabel" }));
      const remoteTicket = await raw(s.base, "POST", "/v1/native/lease-lk02-a/ticket", { origin: ORIGIN, authorization: `Bearer ${tok}`, "x-forwarded-for": "100.101.102.103" }, {});
      const t4 = ticketOf(await ticket(s.base, "lease-lk02-a", tok));
      const remoteRedeem = await redeem(s.base, t4, { "x-forwarded-for": "100.101.102.103" });
      // Ended lease: its outstanding link is refused.
      await endAt(s.base, "lease-lk02-a", tok);
      const endedRedeem = await redeem(s.base, t4);
      // Replaced lease: a link issued before a takeover is refused once the successor runs on this meter.
      await allowance();
      clock = t0 + 70_000;
      await issue("lease-lk02-r");
      const tokR = cred("lease-lk02-r");
      const tr = ticketOf(await ticket(s.base, "lease-lk02-r", tokR));
      clock = t0 + 71_000;
      await issue("lease-lk02-s");
      const sFirst = await firstPlayable(s.base, "lease-lk02-s", cred("lease-lk02-s"), clock, clock + 6000);
      const replaced = await redeem(s.base, tr);
      const observed = {
        expiredRefused: expired.status === 410,
        replayRefused: first.status === 200 && replay.status === 410,
        wrongChildRefused: wrongChild.status === 403,
        remoteDeviceRefused: remoteTicket.status === 403 && remoteRedeem.status === 403,
        endedLeaseRefused: endedRedeem.status === 410,
        replacedLeaseRefused: sFirst !== null && replaced.status === 410,
        siblingTicketAfterRedeemRefused: sibling.status === 410,
        preTakeoverTicketRefused: sFirst !== null && replaced.status === 410,
        statuses: [expired.status, first.status, replay.status, sibling.status, wrongChild.status, remoteTicket.status, remoteRedeem.status, endedRedeem.status, replaced.status].join(","),
      };
      record("LK02", observed);
      ok(Object.entries(observed).filter(([k]) => k !== "statuses").every(([, v]) => v === true), JSON.stringify(observed));
    } finally {
      await s.close();
    }
  });
});
