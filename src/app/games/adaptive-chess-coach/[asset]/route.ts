import { auth } from "@/auth";
import { ADAPTIVE_CHESS_COACH_BUNDLE } from "@/data/adaptive-chess-coach/bundle.generated";
import { todayInZurich } from "@/lib/date";
import { normalizeChildId } from "@/lib/family-child-shell";
import { appOrigin, renderChessDocument } from "@/lib/family-chess-content";
import { derivePlayKey, resolveStudioConfig, verifyPlayCredential } from "@/lib/family-games-token";
import { DAILY_CHESS_GAME_ID } from "@/lib/family-play";
import { chessQualifyingApproval, getLease } from "@/lib/family-play-db";
import { guardScript } from "@/lib/family-play-guard";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, private, max-age=0, must-revalidate", Pragma: "no-cache", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } as const;

function page(status: number, message: string, origin: string): Response {
  const body = `<!doctype html><meta charset="utf-8"><title>Chess Coach</title><body style="margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#1b1f2a;color:#f4f6fb;font:600 20px/1.4 system-ui,sans-serif;text-align:center;padding:24px"><p>${message}</p></body>`;
  return new Response(body, { status, headers: { ...NO_STORE, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": `frame-ancestors ${origin}` } });
}

/**
 * GET /games/adaptive-chess-coach/index.html?child=…&credential=…
 *
 * The ONLY runnable form of the Adaptive Chess Coach (DA-04). The vendored
 * static copy no longer exists; the bundle is embedded at build time and
 * served here as one document with its scripts inlined, behind:
 *   1. the household login (middleware);
 *   2. a Studio lease credential for exactly this game in play mode (signed
 *      with the shared secret; expired/forged/library/studio/other-game → refused);
 *   3. Family's lease row: active, chess-kind, issued for TODAY (Europe/Zurich),
 *      for the credential's child, and that child still qualifies today.
 * The guard the adapter injects into every served game is injected here too
 * (mirror), pointed at the adapter origin for its beacons. Every other asset
 * name answers 404: there is no raw JS at any URL.
 */
export async function GET(request: Request, context: { params: Promise<{ asset: string }> }) {
  const { asset } = await context.params;
  const url = new URL(request.url);
  const origin = appOrigin(request.headers);
  if (asset !== "index.html") return page(404, "Not found.", origin);
  const session = await auth();
  if (!session?.user) return page(401, "Please sign in.", origin);
  const key = derivePlayKey();
  const studio = resolveStudioConfig();
  if (!key || !studio.ok) return page(503, "Game Studio isn't connected on this server yet, so chess can't be timed. Ask a parent.", origin);
  const child = normalizeChildId(url.searchParams.get("child"));
  const token = url.searchParams.get("credential");
  const verified = token ? verifyPlayCredential(key, token, Math.floor(Date.now() / 1000)) : null;
  if (!child || !verified || !verified.ok) return page(401, "This chess link has expired. Open chess again from your Games page.", origin);
  const claims = verified.claims;
  if (claims.scope !== "lease" || claims.gid !== DAILY_CHESS_GAME_ID || claims.mode !== "play" || claims.sub !== child) return page(403, "This chess link does not match your play session.", origin);
  const now = new Date();
  const db = await getDb();
  const lease = await getLease(claims.lid, db);
  if (!lease || lease.personId !== child || lease.gameId !== DAILY_CHESS_GAME_ID || lease.budgetKind !== "chess") return page(403, "This chess link does not match your play session.", origin);
  if (lease.state !== "active") return page(410, "This chess session has ended. Go back to your Games page.", origin);
  if (lease.budgetDate !== todayInZurich(now)) return page(410, "That was yesterday's chess time. Do something useful today and ask a parent to approve it.", origin);
  if ((await chessQualifyingApproval(db, child, now)) === null) return page(403, "Chess is locked right now — today's approval is gone. Ask a parent.", origin);
  const html = renderChessDocument(ADAPTIVE_CHESS_COACH_BUNDLE, guardScript({ allowedOrigin: origin, leaseId: lease.id, beaconBase: studio.studioUrl }));
  return new Response(html, { status: 200, headers: { ...NO_STORE, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": `frame-ancestors ${origin}` } });
}
