import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isTrackerOnlyEmail } from "@/lib/access";
import { upsertSleepReport } from "@/lib/health-db";

const VALID_QUALITIES = ["poor", "ok", "good"];

/**
 * POST /api/health/sleep
 * Body: { date, sleepQuality?, hours?, note? }
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

  const { date, sleepQuality, hours, note } = body;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date required (YYYY-MM-DD)" }, { status: 400 });
  }
  if (sleepQuality !== undefined && (typeof sleepQuality !== "string" || !VALID_QUALITIES.includes(sleepQuality))) {
    return NextResponse.json({ error: "sleepQuality must be poor/ok/good" }, { status: 400 });
  }
  if (hours !== undefined && (typeof hours !== "number" || hours < 0 || hours > 24)) {
    return NextResponse.json({ error: "hours must be 0-24" }, { status: 400 });
  }

  await upsertSleepReport({
    date,
    ...(typeof sleepQuality === "string" ? { sleepQuality } : {}),
    ...(typeof hours === "number" ? { hours } : {}),
    ...(typeof note === "string" ? { note } : {}),
  });

  return NextResponse.json({ ok: true });
}
