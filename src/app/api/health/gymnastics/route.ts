import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isTrackerOnlyEmail } from "@/lib/access";
import { getGymnasticsProgress, setGymnasticsProgress } from "@/lib/health-db";
import { GYMNASTICS_PROGRAM } from "@/lib/gymnastics";

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
 * Body: { week: 1-10, session: "A" | "B", completed: boolean, note?: string }
 * Marks or unmarks a session. Uncompleting is a POST with completed: false.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (isTrackerOnlyEmail(session.user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { week, session: sessionKey, completed, note } = body;

  if (
    typeof week !== "number" ||
    !Number.isInteger(week) ||
    week < 1 ||
    week > GYMNASTICS_PROGRAM.durationWeeks
  ) {
    return NextResponse.json(
      { error: `week must be an integer 1-${GYMNASTICS_PROGRAM.durationWeeks}` },
      { status: 400 },
    );
  }
  if (sessionKey !== "A" && sessionKey !== "B") {
    return NextResponse.json({ error: 'session must be "A" or "B"' }, { status: 400 });
  }
  if (typeof completed !== "boolean") {
    return NextResponse.json({ error: "completed (boolean) required" }, { status: 400 });
  }

  const record = await setGymnasticsProgress({
    programId: PROGRAM_ID,
    week,
    session: sessionKey,
    completed,
    ...(typeof note === "string" ? { note } : {}),
  });

  return NextResponse.json({ ok: true, record });
}
