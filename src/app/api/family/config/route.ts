import { NextResponse } from "next/server";
import { getBoardConfig, saveBoardConfig, type FamilyBoardConfig } from "@/lib/family-db";
import { auth } from "@/auth";

/**
 * GET /api/family/config
 * Returns the current board config (routine/reward overrides).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const config = await getBoardConfig();
  return NextResponse.json(config);
}

/**
 * PUT /api/family/config
 * Body: { routineOverrides, rewardOverrides }
 * Persists the full board config. Validates shape and value ranges.
 */
export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const payload = body as Record<string, unknown>;

  // Validate and sanitize overrides
  const routineOverrides: FamilyBoardConfig["routineOverrides"] = {};
  if (payload.routineOverrides && typeof payload.routineOverrides === "object") {
    for (const [key, val] of Object.entries(payload.routineOverrides as Record<string, unknown>)) {
      if (typeof val !== "object" || val === null) continue;
      const ov = val as Record<string, unknown>;
      const entry: Record<string, number | boolean> = {};
      if (typeof ov.weeklyTarget === "number" && ov.weeklyTarget >= 0 && ov.weeklyTarget <= 7) {
        entry.weeklyTarget = Math.round(ov.weeklyTarget);
      }
      if (typeof ov.points === "number" && ov.points >= 0 && ov.points <= 10) {
        entry.points = Math.round(ov.points);
      }
      if (typeof ov.enabled === "boolean") {
        entry.enabled = ov.enabled;
      }
      if (Object.keys(entry).length > 0) routineOverrides[key] = entry;
    }
  }

  const rewardOverrides: FamilyBoardConfig["rewardOverrides"] = {};
  if (payload.rewardOverrides && typeof payload.rewardOverrides === "object") {
    for (const [key, val] of Object.entries(payload.rewardOverrides as Record<string, unknown>)) {
      if (typeof val !== "object" || val === null) continue;
      const ov = val as Record<string, unknown>;
      const entry: Record<string, number | boolean> = {};
      if (typeof ov.costPoints === "number" && ov.costPoints >= 1 && ov.costPoints <= 200) {
        entry.costPoints = Math.round(ov.costPoints);
      }
      if (typeof ov.targetPoints === "number" && ov.targetPoints >= 1 && ov.targetPoints <= 200) {
        entry.targetPoints = Math.round(ov.targetPoints);
      }
      if (typeof ov.enabled === "boolean") {
        entry.enabled = ov.enabled;
      }
      if (Object.keys(entry).length > 0) rewardOverrides[key] = entry;
    }
  }

  await saveBoardConfig({ routineOverrides, rewardOverrides });
  return NextResponse.json({ ok: true });
}
