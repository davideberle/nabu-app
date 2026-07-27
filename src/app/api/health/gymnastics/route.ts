import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isTrackerOnlyEmail } from "@/lib/access";
import { getGymnasticsProgress, setGymnasticsProgress } from "@/lib/health-db";
import { GYMNASTICS_PROGRAM, parseProgressUpdate } from "@/lib/gymnastics";

const PROGRAM_ID = GYMNASTICS_PROGRAM.programId;

/**
 * GET /api/health/gymnastics
 * Returns stored week/session completion for the current program.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (isTrackerOnlyEmail(session.user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const progress = await getGymnasticsProgress(PROGRAM_ID);
  return NextResponse.json({ programId: PROGRAM_ID, progress });
}

/**
 * POST /api/health/gymnastics
 * Body: { week, session, completed: boolean, note?: string }
 * The valid week range and session slots come from the current program, so a
 * program with a different length or a different number of weekly sessions
 * needs no change here. Uncompleting is a POST with completed: false.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (isTrackerOnlyEmail(session.user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
