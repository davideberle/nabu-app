// Contract tests for the /api/health/gymnastics read/write boundary.
//
// The route handler itself cannot be imported here — it resolves the `@/` alias
// and pulls in `next/server` and NextAuth, which a plain `node --test` run
// cannot load. So the decisions the route delegates to are composed in exactly
// the order the route composes them:
//
//   GET  → evaluateHealthAccess → { programId, progress, history }
//   POST → evaluateHealthAccess → parseProgressUpdate → write under programId
//
// Two properties matter and are pinned here:
//
//   1. **Tracker-only accounts see no health data at all.** Health is personal,
//      so the shared-iPad account is refused the GET, not just the POST.
//   2. **History is read-only and current progress is isolated.** Nothing POST
//      accepts can write outside the current program id, and nothing in the GET
//      body's `history` can come from anywhere but stored rows.
//
// Run with: npm test  (node --test; Node 24 strips types natively)

import { readFileSync } from "node:fs";
import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateHealthAccess, type PlannerWriteSession } from "./access.ts";
import {
  parseProgressUpdate,
  summarizeHistory,
  archivedProgramIds,
  type GymnasticsArchive,
  type GymnasticsHistoryRow,
  type GymnasticsProgram,
  type GymnasticsProgressRow,
} from "./gymnastics-core.ts";

const PROGRAM: GymnasticsProgram = JSON.parse(
  readFileSync(new URL("../data/gymnastics-program.json", import.meta.url), "utf8"),
);
const ARCHIVE: GymnasticsArchive = JSON.parse(
  readFileSync(new URL("../data/gymnastics-archive.json", import.meta.url), "utf8"),
);
const PROGRAM_ID = PROGRAM.programId;

const OWNER: PlannerWriteSession = { user: { email: "info@davideberle.com" } };
const TRACKER: PlannerWriteSession = { user: { email: "assistant@davideberle.com" } };

type GetBody =
  | { status: 401 | 403; body: { error: string } }
  | {
      status: 200;
      body: {
        programId: string;
        progress: GymnasticsProgressRow[];
        history: ReturnType<typeof summarizeHistory>;
      };
    };

/**
 * GET, composed the way the route composes it. `progress` and `historyRows`
 * stand in for the two database reads — the only inputs the route has.
 */
function get(
  session: PlannerWriteSession,
  progress: GymnasticsProgressRow[] = [],
  historyRows: GymnasticsHistoryRow[] = [],
): GetBody {
  const access = evaluateHealthAccess(session);
  if (!access.allowed) return { status: access.status, body: { error: access.error } };
  return {
    status: 200,
    body: {
      programId: PROGRAM_ID,
      progress,
      history: summarizeHistory(ARCHIVE, historyRows, PROGRAM_ID),
    },
  };
}

/** POST, composed the way the route composes it. */
function post(session: PlannerWriteSession, body: unknown) {
  const access = evaluateHealthAccess(session);
  if (!access.allowed) return { status: access.status, body: { error: access.error } };
  const parsed = parseProgressUpdate(body, PROGRAM);
  if (!parsed.ok) return { status: 400 as const, body: { error: parsed.error } };
  return {
    status: 200 as const,
    // What the route hands to setGymnasticsProgress: the program id is stamped
    // by the server, never taken from the request.
    write: { programId: PROGRAM_ID, ...parsed.value },
  };
}

const completedRow = (
  programId: string,
  week: number,
  session: "A" | "B" | "C",
  note?: string,
): GymnasticsHistoryRow => ({
  programId,
  week,
  session,
  completed: true,
  completedAt: `2026-07-2${week}T12:00:00.000Z`,
  ...(note ? { note } : {}),
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe("health API access", () => {
  it("refuses a signed-out request on both verbs", () => {
    for (const session of [null, undefined, {}, { user: null }] as PlannerWriteSession[]) {
      equal(get(session).status, 401);
      equal(post(session, { week: 1, session: "A", completed: true }).status, 401);
    }
  });

  it("refuses the tracker-only shared iPad account on both verbs", () => {
    const read = get(TRACKER, [], [completedRow("gym-link-two-kip-2wk-v1", 1, "A")]);
    equal(read.status, 403);
    deepStrictEqual(read.body, { error: "Forbidden" });
    equal(post(TRACKER, { week: 1, session: "A", completed: true }).status, 403);
  });

  it("leaks no history to a refused reader", () => {
    const read = get(TRACKER, [], [completedRow("gym-link-two-kip-2wk-v1", 1, "A")]);
    ok(!("history" in read.body));
    ok(!("progress" in read.body));
  });

  it("lets David through", () => {
    equal(get(OWNER).status, 200);
    equal(post(OWNER, { week: 1, session: "A", completed: true }).status, 200);
  });

  it("uses one rule for both verbs, so a read can never be looser than a write", () => {
    const toggle = { week: 1, session: "A", completed: true };
    for (const session of [null, TRACKER, OWNER] as PlannerWriteSession[]) {
      equal(get(session).status, post(session, toggle).status, String(session?.user?.email));
    }
  });
});

// ---------------------------------------------------------------------------
// GET response shape
// ---------------------------------------------------------------------------

describe("GET response shape", () => {
  it("returns the current program id, its progress, and history", () => {
    const read = get(OWNER, [{ week: 1, session: "A", completed: true, completedAt: null }], [
      completedRow("gym-link-two-kip-2wk-v1", 1, "A", "4×5 beat swings."),
    ]);
    equal(read.status, 200);
    if (read.status !== 200) return;
    deepStrictEqual(Object.keys(read.body).sort(), ["history", "programId", "progress"]);
    equal(read.body.programId, PROGRAM_ID);
    equal(read.body.progress.length, 1);
    equal(read.body.history.length, 1);
  });

  it("shapes each history block as title + count + dated entries", () => {
    const read = get(OWNER, [], [
      completedRow("gym-link-two-kip-2wk-v1", 1, "A", "4×5 beat swings."),
      completedRow("gym-link-two-kip-2wk-v1", 1, "B"),
    ]);
    if (read.status !== 200) throw new Error("expected 200");
    const [block] = read.body.history;
    equal(block.programId, "gym-link-two-kip-2wk-v1");
    equal(block.title, "Link Two Kipping Pull-Ups");
    equal(block.completedCount, 2);
    equal(block.entries.length, 2);
    equal(block.entries[0].label, "Find the return");
    equal(block.entries[0].completedAt, "2026-07-21T12:00:00.000Z");
    equal(block.entries[0].note, "4×5 beat swings.");
  });

  it("returns an empty history rather than inventing one when no rows exist", () => {
    const read = get(OWNER, [], []);
    if (read.status !== 200) throw new Error("expected 200");
    deepStrictEqual(read.body.history, []);
  });

  it("never reports the current block as history, whatever rows come back", () => {
    const read = get(OWNER, [], [
      completedRow(PROGRAM_ID, 1, "A"),
      completedRow(PROGRAM_ID, 2, "B"),
    ]);
    if (read.status !== 200) throw new Error("expected 200");
    deepStrictEqual(read.body.history, []);
  });

  it("only ever queries retired program ids", () => {
    const ids = archivedProgramIds(ARCHIVE, PROGRAM_ID);
    ok(ids.length > 0);
    ok(!ids.includes(PROGRAM_ID));
  });
});

// ---------------------------------------------------------------------------
// POST — writes stay inside the current block
// ---------------------------------------------------------------------------

describe("POST progress isolation", () => {
  it("stamps the current program id and ignores one supplied by the client", () => {
    const result = post(OWNER, {
      week: 1,
      session: "A",
      completed: true,
      programId: "gym-link-two-kip-2wk-v1",
    });
    equal(result.status, 200);
    if (result.status !== 200) return;
    equal(result.write.programId, PROGRAM_ID);
    deepStrictEqual(Object.keys(result.write).sort(), [
      "completed",
      "programId",
      "session",
      "week",
    ]);
  });

  it("rejects a slot or week that belongs to a retired block", () => {
    // Session C and weeks 4+ existed in earlier blocks; neither is writable now.
    equal(post(OWNER, { week: 1, session: "C", completed: true }).status, 400);
    equal(post(OWNER, { week: 4, session: "A", completed: true }).status, 400);
    equal(post(OWNER, { week: 10, session: "B", completed: true }).status, 400);
  });

  it("accepts every real slot of the current block and nothing else", () => {
    for (const week of [1, 2, 3]) {
      for (const s of ["A", "B"]) {
        const r = post(OWNER, { week, session: s, completed: true });
        equal(r.status, 200, `week ${week} session ${s}`);
        if (r.status === 200) equal(r.write.programId, PROGRAM_ID);
      }
    }
  });

  it("has no way to write a history row — the archived ids are never a write target", () => {
    for (const archivedId of archivedProgramIds(ARCHIVE, PROGRAM_ID)) {
      const r = post(OWNER, { week: 1, session: "A", completed: true, programId: archivedId });
      if (r.status === 200) ok(r.write.programId !== archivedId);
    }
  });
});
