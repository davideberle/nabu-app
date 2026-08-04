import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { evaluateHealthAccess } from "@/lib/access";
import {
  getCompletedGymnasticsHistory,
  getGymnasticsProgress,
  setGymnasticsProgress,
} from "@/lib/health-db";
import {
  GYMNASTICS_ARCHIVE,
  GYMNASTICS_ARCHIVED_PROGRAM_IDS,
  GYMNASTICS_PROGRAM,
  parseProgressUpdate,
  summarizeHistory,
} from "@/lib/gymnastics";

const PROGRAM_ID = GYMNASTICS_PROGRAM.programId;

/**
 * GET /api/health/gymnastics
 *
 * Returns stored week/session completion for the current program, plus a
 * read-only view of completed sessions from the blocks that came before it.
 * `progress` is the only thing POST can write; `history` is never writable.
 */
export async function GET() {
  const access = evaluateHealthAccess(await auth());
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const [progress, historyRows] = await Promise.all([
    getGymnasticsProgress(PROGRAM_ID),
    getCompletedGymnasticsHistory(GYMNASTICS_ARCHIVED_PROGRAM_IDS),
  ]);

  return NextResponse.json({
    programId: PROGRAM_ID,
    progress,
    history: summarizeHistory(GYMNASTICS_ARCHIVE, historyRows, PROGRAM_ID),
  });
}

/**
 * POST /api/health/gymnastics
 * Body: { week, session, completed: boolean, note?: string }
 * The valid week range and session slots come from the current program, so a
 * program with a different length or a different number of weekly sessions
 * needs no change here. Uncompleting is a POST with completed: false.
 */
export async function POST(request: Request) {
  const access = evaluateHealthAccess(await auth());
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseProgressUpdate(body, GYMNASTICS_PROGRAM);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const record = await setGymnasticsProgress({
    programId: PROGRAM_ID,
    ...parsed.value,
  });

  return NextResponse.json({ ok: true, record });
}
