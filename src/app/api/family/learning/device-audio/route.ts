import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { buildChildBridgeSession, resolveBridgeMintConfig } from "@/lib/family-assistant-bridge";
import { NO_STORE, refuse, requireChildLearning } from "@/lib/family-learning-auth";
import { NOKT_SESSION_SUFFIX } from "@/lib/family-learning-nokt-turn";

/**
 * POST /api/family/learning/device-audio — Step 1 (2026-11-01, S1-07, candidate).
 *
 * The learning app runs in the browser on the Mac mini; only the family bridge on that machine can unmute it. This route
 * hands the browser a short-lived `learn` credential for the bridge's `/v1/device/audio` (fixed body `{ reason }`, fixed
 * volume set on the Mac mini, rate-limited there). OFF unless `FAMILY_DEVICE_AUDIO=on` and the bridge is configured: then
 * it answers `{ enabled: false }` and the browser sends nothing. The child comes from the verified learning credential.
 */
export async function POST(request: Request) {
  const guard = await requireChildLearning(request);
  if (!guard.ok) return guard.response;
  if (process.env.FAMILY_DEVICE_AUDIO !== "on") return NextResponse.json({ enabled: false }, { headers: NO_STORE });
  const config = resolveBridgeMintConfig(process.env);
  if (!config.ok) return NextResponse.json({ enabled: false }, { headers: NO_STORE });
  try {
    const session = buildChildBridgeSession({ config: config.config, childId: guard.child, sessionSuffix: NOKT_SESSION_SUFFIX, jti: randomUUID(), nowMs: Date.now() });
    return NextResponse.json({ enabled: true, bridge: { url: session.bridgeUrl, token: session.token, expiresAt: session.expiresAt } }, { headers: NO_STORE });
  } catch {
    return refuse(500, "Device audio could not be prepared");
  }
}
