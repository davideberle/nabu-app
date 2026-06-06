import { NextResponse } from "next/server";
import { getBoardConfig, saveBoardConfig } from "@/lib/family-db";

/**
 * GET /api/family/config
 * Returns the current board config (routine/reward overrides).
 */
export async function GET() {
  const config = await getBoardConfig();
  return NextResponse.json(config);
}

/**
 * PUT /api/family/config
 * Body: { routineOverrides, rewardOverrides }
 * Persists the full board config.
 */
export async function PUT(request: Request) {
  const body = await request.json();
  const config = {
    routineOverrides: body.routineOverrides ?? {},
    rewardOverrides: body.rewardOverrides ?? {},
  };
  await saveBoardConfig(config);
  return NextResponse.json({ ok: true });
}
