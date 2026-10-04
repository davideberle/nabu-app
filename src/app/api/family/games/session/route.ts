import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isChildId } from "@/lib/family-assistant-turn";
import { NO_STORE, refuse } from "@/lib/family-games-auth";
import { deriveGamesKey, mintChildGamesToken, mintPlayCredential, resolveStudioConfig } from "@/lib/family-games-token";

/**
 * POST /api/family/games/session
 *
 * Mints the child-scoped credentials for the Games surface: the `family-games`
 * bearer every Family play route on this server verifies, and — when the Game
 * Studio child adapter is configured — a library-scope Studio credential plus
 * the adapter origin, so the browser can list and edit through the child
 * adapter on the tailnet. The owner route, its port and its identity are
 * never involved (G1). Same shape and budget as the learning/bridge mints.
 *
 * Request body: `{ childId: "santiago" | "isabel" }`
 * Response: `{ child, token, expiresAt, studio: { url, token, expiresAt } | null }`
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
  const key = deriveGamesKey();
  if (!key) return refuse(503, "Games are not configured on this server");
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
  const nowSeconds = Math.floor(now / 1000);
  const minted = mintChildGamesToken(key, childId, randomUUID(), nowSeconds);
  const studioConfig = resolveStudioConfig();
  const studio = studioConfig.ok
    ? (() => {
        const credential = mintPlayCredential(studioConfig.key, { child: childId, scope: "library", gameId: "*", leaseId: "-", mode: "edit", metered: false, budgetSeconds: 0, jti: randomUUID(), nowSeconds });
        return { url: studioConfig.studioUrl, token: credential.token, expiresAt: credential.expiresAt };
      })()
    : null;
  return NextResponse.json({ child: childId, token: minted.token, expiresAt: minted.expiresAt, studio }, { headers: NO_STORE });
}
