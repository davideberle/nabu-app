import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isChildId } from "@/lib/family-assistant-turn";
import { NO_STORE, refuse } from "@/lib/family-learning-auth";
import { deriveLearningKey, mintChildLearningToken } from "@/lib/family-learning-token";

/**
 * POST /api/family/learning/session
 *
 * Mints the short-lived, child-scoped learning credential (family-assistant
 * DESIGN §7.6 "Derive child authority server-side using the existing
 * scoped-session model"). Same shape as the bridge mint route: a household
 * session names a child from the closed allowlist and receives a token whose
 * subject is exactly that child. Every learning route then takes the child
 * from the verified token and ignores any child id in the body or query.
 *
 * Request body: `{ childId: "santiago" | "isabel" }`
 * Response: `{ child, token, expiresAt }`
 */

const MINTS_PER_WINDOW = 30;
const MINT_WINDOW_MS = 60_000;
const mintWindows = new Map<string, { startedAt: number; count: number }>();

function admitMint(childId: string, nowMs: number): boolean {
  const existing = mintWindows.get(childId);
  if (!existing || nowMs - existing.startedAt >= MINT_WINDOW_MS) {
    mintWindows.set(childId, { startedAt: nowMs, count: 1 });
    return true;
  }
  if (existing.count >= MINTS_PER_WINDOW) return false;
  existing.count += 1;
  return true;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return refuse(401, "Unauthorized");
  const key = deriveLearningKey();
  if (!key) return refuse(503, "Learning is not configured on this server");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse(400, "Body must be JSON");
  }
  const childId = typeof body === "object" && body !== null ? (body as { childId?: unknown }).childId : undefined;
  if (!isChildId(childId)) return refuse(400, "childId must be santiago or isabel");
  const now = Date.now();
  if (!admitMint(childId, now)) return refuse(429, "Too many sessions requested");

  const minted = mintChildLearningToken(key, childId, randomUUID(), Math.floor(now / 1000));
  return NextResponse.json({ child: childId, token: minted.token, expiresAt: minted.expiresAt }, { headers: NO_STORE });
}
