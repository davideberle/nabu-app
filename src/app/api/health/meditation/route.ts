import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isTrackerOnlyEmail } from "@/lib/access";
import { upsertMeditationLog } from "@/lib/health-db";

/**
 * POST /api/health/meditation
 * Body: { date, completed, minutes?, note? }
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

  const { date, completed, minutes, note } = body;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date required (YYYY-MM-DD)" }, { status: 400 });
  }
  if (typeof completed !== "boolean") {
    return NextResponse.json({ error: "completed (boolean) required" }, { status: 400 });
  }
  if (minutes !== undefined && (typeof minutes !== "number" || minutes < 0)) {
    return NextResponse.json({ error: "minutes must be >= 0" }, { status: 400 });
  }

  await upsertMeditationLog({
    date,
    completed,
    ...(typeof minutes === "number" ? { minutes } : {}),
    ...(typeof note === "string" ? { note } : {}),
  });

  return NextResponse.json({ ok: true });
}
