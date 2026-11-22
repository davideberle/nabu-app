// Chess game records (Nov 22, 2026): the contract between the Game Studio coach and the server, auth, validation,
// idempotency and the owner-only parent read. SYNTHETIC rows on a temp SQLite file only. Run: npm test

import { deepEqual, equal, match, ok } from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createClient, type Client } from "@libsql/client";
import { isAdminOnlyApiRoute, isTrackerAllowedApiPath } from "./access.ts";
import { chessRecordsScript } from "./family-chess-content.ts";
import { handleChessRecordPost, readChessChildView, storeChessGame, type ChessRecordAuth } from "./family-chess-records-db.ts";
import { CHESS_RECORD_MAX_BYTES, createChessRecordLimiter, parseChessRecordBody, type ChessGameRecord } from "./family-chess-records.ts";
import { mintChildGamesToken, readBearer, verifyChildGamesToken } from "./family-games-token.ts";
import type { ChildId } from "./family-assistant-turn.ts";

// The vendored Game Studio bundle (checksum-synced): its record builders are what the browser actually sends.
const require = createRequire(import.meta.url);
const Coach = require("../games/adaptive-chess-coach/chess-coach.js");

const dir = mkdtempSync(join(tmpdir(), "family-chess-records-"));
let n = 0;
const fresh = (): Client => createClient({ url: `file:${join(dir, `db-${(n += 1)}.sqlite`)}` });
const NOW = new Date("2026-11-22T12:00:00.000Z");
const KEY = Buffer.alloc(32, 7);

/** A real game from the coach: Pip resigns after a followed and a kept nudge. */
function coachGame(child: ChildId = "isabel", seq = 1, gameId?: string): ChessGameRecord {
  const profile = Coach.defaultProfile(child);
  const session = Coach.startGame(profile, { opponent: Coach.opponentById("pip"), gameId, startedAt: "2026-11-22T11:40:00.000Z" });
  session.movesPlayed = 14;
  session.activeSeconds = 610;
  session.seq = seq;
  session.nudges = [{ threat: "q", choice: "followed" }, { threat: "n", choice: "kept" }];
  const finished = Coach.finishGame(profile, session, "opponent-resigned", "2026-11-22T11:52:00.000Z", { endReason: "resignation", materialBalance: 11 });
  return Coach.gameRecord({ session, finished, result: "opponent-resigned", endReason: "resignation", endedAt: "2026-11-22T11:52:00.000Z", materialBalance: 11 });
}

/** The route's authorize(): household session + the real `family-games` bearer verification. */
function authorizer(header: string | null, signedIn = true): () => Promise<ChessRecordAuth> {
  return async () => {
    if (!signedIn) return { ok: false, status: 401, error: "Unauthorized" };
    const bearer = readBearer(header);
    if (!bearer) return { ok: false, status: 401, error: "Missing games credential" };
    const v = verifyChildGamesToken(KEY, bearer, Math.floor(NOW.getTime() / 1000));
    return v.ok ? { ok: true, child: v.claims.sub } : { ok: false, status: 401, error: "Invalid games credential" };
  };
}
const bearerFor = (child: ChildId) => `Bearer ${mintChildGamesToken(KEY, child, "jti-" + child, Math.floor(NOW.getTime() / 1000) - 10).token}`;

function post(db: Client, header: string | null, body: unknown, opts: { signedIn?: boolean; admit?: (c: ChildId, t: number) => boolean } = {}) {
  return handleChessRecordPost({
    authorize: authorizer(header, opts.signedIn ?? true),
    rawBody: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    admit: opts.admit ?? (() => true),
    db: async () => db,
    now: () => NOW,
  });
}

describe("contract with the Game Studio coach", () => {
  it("the coach's game record passes the server gate unchanged", () => {
    const rec = coachGame();
    const parsed = parseChessRecordBody(JSON.stringify(rec), NOW.getTime());
    ok(parsed.ok, parsed.ok ? "" : parsed.error);
    if (parsed.ok && parsed.value.kind === "game") {
      equal(parsed.value.result, "opponent-resigned");
      equal(parsed.value.nudgesFollowed, 1);
      equal(parsed.value.nudgesKept, 1);
      equal(parsed.value.levelBefore, 0);
      equal(parsed.value.levelAfter, 1);
      equal(parsed.value.levelReason, "resigned-up");
    }
  });

  it("an unfinished game and an old browser profile (import) pass too", () => {
    const profile = Coach.defaultProfile("isabel");
    const s = Coach.startGame(profile, {});
    s.movesPlayed = 9;
    s.seq = 1;
    const fin = Coach.finishGame(profile, s, "unfinished", "2026-11-22T11:00:00.000Z", { endReason: "time-out", materialBalance: 6 });
    const rec = Coach.gameRecord({ session: s, finished: fin, result: "unfinished", endReason: "time-out", endedAt: "2026-11-22T11:00:00.000Z", materialBalance: 6 });
    const p1 = parseChessRecordBody(JSON.stringify(rec), NOW.getTime());
    ok(p1.ok && p1.value.kind === "game" && p1.value.judged === "win", p1.ok ? "" : p1.error);

    const old = {
      ...Coach.defaultProfile("isabel"),
      history: [{ date: "2026-11-21T10:40:00.000Z", opponentId: "pip", result: "loss", movesPlayed: 33, blunders: 3, hintsTaken: 2 }],
      progressionLog: [{ date: "2026-11-21T10:40:00.000Z", result: "loss", blunders: 3, from: 0, to: 0, reason: "That was a tricky one — easing back a step so the next game is more fun." }],
    };
    const p2 = parseChessRecordBody(JSON.stringify(Coach.importRecord("isabel", old)), NOW.getTime());
    ok(p2.ok && p2.value.kind === "import" && p2.value.profile.history.length === 1, p2.ok ? "" : p2.error);
  });
});

describe("validation", () => {
  const good = () => JSON.parse(JSON.stringify(coachGame())) as Record<string, unknown>;
  const refuse = (body: unknown, why: RegExp) => {
    const r = parseChessRecordBody(typeof body === "string" ? body : JSON.stringify(body), NOW.getTime());
    ok(!r.ok, "must be refused");
    if (!r.ok) match(r.error, why);
  };
  it("refuses unknown keys, free text and names", () => {
    refuse({ ...good(), note: "Isabel was tired" }, /note is not allowed/);
    refuse({ ...good(), profile: { ...(good().profile as object), label: "Isabel's great" } }, /label/);
    const p = good().profile as Record<string, unknown>;
    refuse({ ...good(), profile: { ...p, progressionLog: [{ reasonKey: "other", reason: "free text" }] } }, /reason is not allowed/);
  });
  it("refuses out-of-range numbers, wrong enums and inconsistent counts", () => {
    refuse({ ...good(), levelAfter: 9 }, /levelAfter/);
    refuse({ ...good(), movesPlayed: -1 }, /movesPlayed/);
    refuse({ ...good(), activeSeconds: 99999 }, /activeSeconds/);
    refuse({ ...good(), opponentId: "magnus" }, /opponentId/);
    refuse({ ...good(), nudgesKept: 2 }, /nudge counts/);
    refuse({ ...good(), nudges: [1, 2, 3, 4] }, /at most 3/);
    refuse({ ...good(), result: "unfinished" }, /judged/);
    refuse({ ...good(), endReason: "time-out" }, /endReason/);
    refuse({ ...good(), gameId: "x" }, /game id/);
    refuse({ ...good(), endedAt: "2031-01-01T00:00:00Z" }, /outside the allowed dates/);
    refuse({ ...good(), kind: "other" }, /kind/);
    refuse("not json", /JSON/);
    refuse("x".repeat(CHESS_RECORD_MAX_BYTES + 1), /too large/);
  });
});

describe("POST /api/family/play/chess-games (handler)", () => {
  it("no session or no bearer → 401; a forged bearer → 401", async () => {
    const db = fresh();
    equal((await post(db, null, coachGame())).status, 401);
    equal((await post(db, bearerFor("isabel"), coachGame(), { signedIn: false })).status, 401);
    equal((await post(db, "Bearer not-a-real-token", coachGame())).status, 401);
    const view = await readChessChildView(db, "isabel");
    equal(view.games.length, 0, "nothing stored");
  });

  it("a report for another child is refused (403); a game id never changes owner (409)", async () => {
    const db = fresh();
    equal((await post(db, bearerFor("santiago"), coachGame("isabel"))).status, 403);
    const rec = coachGame("isabel", 1, "g-shared-id-0001");
    equal((await post(db, bearerFor("isabel"), rec)).status, 200);
    const stolen = coachGame("santiago", 5, "g-shared-id-0001");
    const r = await post(db, bearerFor("santiago"), stolen);
    equal(r.status, 409);
    equal((await readChessChildView(db, "isabel")).games[0].seq, 1);
    equal((await readChessChildView(db, "santiago")).games.length, 0);
  });

  it("invalid bodies → 400, too many reports → 429", async () => {
    const db = fresh();
    equal((await post(db, bearerFor("isabel"), { kind: "game" })).status, 400);
    const admit = createChessRecordLimiter(2, 60_000);
    const a = (c: ChildId, t: number) => admit(c, t);
    equal((await post(db, bearerFor("isabel"), coachGame("isabel", 1), { admit: a })).status, 200);
    equal((await post(db, bearerFor("isabel"), coachGame("isabel", 2), { admit: a })).status, 200);
    equal((await post(db, bearerFor("isabel"), coachGame("isabel", 3), { admit: a })).status, 429);
  });

  it("idempotent per game id: a repeat changes nothing, a later report replaces, an older one is ignored", async () => {
    const db = fresh();
    const id = "g-idempotent-0001";
    const r1 = await post(db, bearerFor("isabel"), coachGame("isabel", 1, id));
    deepEqual(r1.body, { ok: true, stored: "inserted" });
    const r2 = await post(db, bearerFor("isabel"), coachGame("isabel", 1, id));
    deepEqual(r2.body, { ok: true, stored: "unchanged" });
    const later = { ...coachGame("isabel", 3, id), movesPlayed: 20 };
    deepEqual((await post(db, bearerFor("isabel"), later)).body, { ok: true, stored: "updated" });
    const stale = { ...coachGame("isabel", 2, id), movesPlayed: 5 };
    deepEqual((await post(db, bearerFor("isabel"), stale)).body, { ok: true, stored: "unchanged" });
    const v = await readChessChildView(db, "isabel");
    equal(v.games.length, 1);
    equal(v.games[0].seq, 3);
    equal(v.games[0].movesPlayed, 20);
  });

  it("the browser import is stored once per child", async () => {
    const db = fresh();
    const p = { ...Coach.defaultProfile("isabel"), history: [{ date: "2026-11-21T10:40:00.000Z", opponentId: "pip", result: "loss", movesPlayed: 33, blunders: 3, hintsTaken: 2 }] };
    deepEqual((await post(db, bearerFor("isabel"), Coach.importRecord("isabel", p))).body, { ok: true, stored: "inserted" });
    const p2 = { ...p, history: [] };
    deepEqual((await post(db, bearerFor("isabel"), Coach.importRecord("isabel", p2))).body, { ok: true, stored: "already-imported" });
    const v = await readChessChildView(db, "isabel");
    equal(v.imported?.history.length, 1);
    equal(v.current?.level, 0, "current falls back to the import while no game was reported");
    equal(v.current?.opponentName, "Pip the Penguin");
  });
});

describe("parent read", () => {
  it("per child: current level and opponent from the latest game, last games newest first", async () => {
    const db = fresh();
    await storeChessGame(db, coachGame("isabel", 1, "g-older-game-0001"), new Date("2026-11-22T11:00:00Z"));
    const newer = { ...coachGame("isabel", 1, "g-newer-game-0002"), endedAt: "2026-11-22T11:59:00.000Z" };
    await storeChessGame(db, newer, new Date("2026-11-22T12:00:00Z"));
    const v = await readChessChildView(db, "isabel");
    deepEqual(v.games.map((g) => g.gameId), ["g-newer-game-0002", "g-older-game-0001"]);
    equal(v.current?.level, 1);
    equal(v.current?.opponentName, "Sir Waffles");
    equal((await readChessChildView(db, "santiago")).current, null, "children never mix");
  });

  it("is owner-only: the records route checks the owner and middleware keeps /api/family/parent/ admin-only", () => {
    equal(isAdminOnlyApiRoute("GET", "/api/family/parent/records"), true);
    const route = readFileSync(new URL("../app/api/family/parent/records/route.ts", import.meta.url), "utf8");
    match(route, /if \(!isAdminEmail\(session\.user\.email\)\) return NextResponse\.json\(\{ error: "Forbidden" \}, \{ status: 403 \}\);/);
    match(route, /chessGames/);
  });

  it("the record route is a child play route: POST only, requireChildGames, reachable from the shared device", () => {
    const route = readFileSync(new URL("../app/api/family/play/chess-games/route.ts", import.meta.url), "utf8");
    match(route, /const authz = await requireChildGames\(request\);/);
    ok(!/export async function (GET|PUT|PATCH|DELETE)/.test(route));
    equal(isAdminOnlyApiRoute("POST", "/api/family/play/chess-games"), false);
    equal(isTrackerAllowedApiPath("/api/family/play/chess-games"), true);
  });
});

describe("chess document config", () => {
  it("injects the record route, the renewal route and the bearer as safe inline JSON", () => {
    const s = chessRecordsScript({ token: "a.b</script><script>x", expiresAt: 123 });
    ok(s.startsWith("<script data-chess-records>window.__CHESS_RECORDS__=Object.freeze("));
    ok(!s.slice(0, -"</script>".length).includes("</script>"), "the token cannot close the script block");
    match(s, /"endpoint":"\/api\/family\/play\/chess-games"/);
    match(s, /"sessionPath":"\/api\/family\/games\/session"/);
    const route = readFileSync(new URL("../app/games/adaptive-chess-coach/[asset]/route.ts", import.meta.url), "utf8");
    match(route, /mintChildGamesToken\(gamesKey, lease\.personId,/);
  });
});
