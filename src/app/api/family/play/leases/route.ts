import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { NO_STORE, refuse, requireChildGames } from "@/lib/family-games-auth";
import { mintPlayCredential, resolveStudioConfig } from "@/lib/family-games-token";
import { issuePlayLease } from "@/lib/family-play-db";
import { PLAY_GRACE_SECONDS, PLAY_WARN_SECONDS, isPlayMode, isValidGameId, playPriceFor } from "@/lib/family-play";

/**
 * POST /api/family/play/leases
 * Body: `{ gameId, mode: "play" | "edit", takeover?: boolean, device?: string }`
 *
 * Issues the child's single consuming lease (GP-03) and the Studio play
 * credential bound to exactly this child, game, lease and mode (GP-08). A
 * metered lease needs remaining allowance; a live lease on another device is
 * reported as `lease-held` until the child explicitly takes over. Free games
 * and Edit mode get an unmetered lease — authorization without a clock.
 */
export async function POST(request: Request) {
  const authz = await requireChildGames(request);
  if (!authz.ok) return authz.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse(400, "Body must be JSON");
  }
  const record = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (!isValidGameId(record.gameId)) return refuse(400, "gameId required");
  if (!isPlayMode(record.mode)) return refuse(400, "mode must be play or edit");
  const takeover = record.takeover === true;
  const device = typeof record.device === "string" ? record.device.trim().slice(0, 40) || null : null;
  const studio = resolveStudioConfig();
  const price = playPriceFor(record.gameId, record.mode);
  const leaseId = `lease-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const outcome = await issuePlayLease({ personId: authz.child, gameId: record.gameId, mode: record.mode, leaseId, takeover, deviceLabel: device });
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.reason, ...outcome, child: authz.child, price }, { status: outcome.reason === "lease-held" ? 409 : 402, headers: NO_STORE });
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  const credential = studio.ok
    ? mintPlayCredential(studio.key, {
        child: authz.child,
        scope: "lease",
        gameId: record.gameId,
        leaseId,
        mode: record.mode,
        metered: outcome.lease.metered,
        budgetSeconds: outcome.lease.budgetSeconds,
        jti: randomUUID(),
        nowSeconds,
      })
    : null;
  return NextResponse.json(
    {
      child: authz.child,
      lease: outcome.lease,
      replaced: outcome.replaced,
      remainingSeconds: outcome.remainingSeconds,
      price,
      warnSeconds: PLAY_WARN_SECONDS,
      graceSeconds: PLAY_GRACE_SECONDS,
      studio: studio.ok && credential ? { url: studio.studioUrl, token: credential.token, expiresAt: credential.expiresAt } : null,
    },
    { status: 201, headers: NO_STORE },
  );
}
