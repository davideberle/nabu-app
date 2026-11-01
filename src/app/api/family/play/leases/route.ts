import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { NO_STORE, refuse, requireChildGames } from "@/lib/family-games-auth";
import { mintPlayCredential, playCredentialTtlSeconds, resolveStudioConfig } from "@/lib/family-games-token";
import { issuePlayLease } from "@/lib/family-play-db";
import { PLAY_GRACE_SECONDS, PLAY_WARN_SECONDS, STUDIO_SCOPE_GAME_ID, isDailyChessGame, isPlayMode, isValidGameId, playPriceFor } from "@/lib/family-play";
import { chessContentPath } from "@/lib/family-chess-content";

/**
 * POST /api/family/play/leases
 * Body: `{ gameId?, mode: "play" | "edit", takeover?: boolean, device?: string }`
 *
 * Issues the child's single interactive lease and the Studio credential bound
 * to exactly this child, lease and mode (October 8, 2026 policy):
 *   - `mode: "play"` + a Studio game id → paid play on the coin allowance
 *     (credential scope `lease`);
 *   - `mode: "play"` + the chess id → the purchased chess allowance (1 coin /
 *     15 minutes, November 1, 2026); refused `no-allowance` (402) when it is
 *     empty — issuing never buys; the response also carries the same-origin
 *     gated content path for the chess bundle;
 *   - `mode: "edit"` → the paid Studio editor lease (credential scope `studio`,
 *     game id `*`): creating, changing, answering and approving all run on it.
 * A live lease on another device/mode is `lease-held` (409) until the child
 * explicitly takes over. Nothing is unmetered any more.
 *
 * The credential lives as long as the lease can be used in one sitting: its
 * budget plus an unbilled allowance for menus, pauses and loading (bounded,
 * `playCredentialTtlSeconds`). The meter, not the credential, decides what is
 * charged; it ends a lease by itself at exhaustion or after 10 silent minutes.
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
  if (!isPlayMode(record.mode)) return refuse(400, "mode must be play or edit");
  const mode = record.mode;
  if (mode === "play" && !isValidGameId(record.gameId)) return refuse(400, "gameId required");
  const gameId = mode === "edit" ? STUDIO_SCOPE_GAME_ID : (record.gameId as string);
  const takeover = record.takeover === true;
  const device = typeof record.device === "string" ? record.device.trim().slice(0, 40) || null : null;
  const studio = resolveStudioConfig();
  const price = playPriceFor(gameId, mode);
  const leaseId = `lease-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const outcome = await issuePlayLease({ personId: authz.child, gameId, mode, leaseId, takeover, deviceLabel: device });
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.reason, ...outcome, child: authz.child, price }, { status: outcome.reason === "lease-held" ? 409 : 402, headers: NO_STORE });
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  const credential = studio.ok
    ? mintPlayCredential(studio.key, {
        child: authz.child,
        scope: mode === "edit" ? "studio" : "lease",
        gameId,
        leaseId,
        mode,
        metered: outcome.lease.metered,
        budgetSeconds: outcome.lease.budgetSeconds,
        jti: randomUUID(),
        nowSeconds,
        ttlSeconds: playCredentialTtlSeconds(outcome.lease.budgetSeconds),
      })
    : null;
  const chess = mode === "play" && isDailyChessGame(gameId);
  return NextResponse.json(
    {
      child: authz.child,
      lease: outcome.lease,
      replaced: outcome.replaced,
      remainingSeconds: outcome.remainingSeconds,
      // Non-null while a predecessor's authority window fences this lease: the Studio meter reports it `pending` until then.
      handoverAt: outcome.handoverAt,
      price,
      warnSeconds: PLAY_WARN_SECONDS,
      graceSeconds: PLAY_GRACE_SECONDS,
      studio: studio.ok && credential ? { url: studio.studioUrl, token: credential.token, expiresAt: credential.expiresAt } : null,
      // Chess content stays on THIS origin (per-child saves live here); the path is gated by the same lease credential.
      content: chess && credential ? { path: chessContentPath(authz.child, credential.token), expiresAt: credential.expiresAt } : null,
    },
    { status: 201, headers: NO_STORE },
  );
}
