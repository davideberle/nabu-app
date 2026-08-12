import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  BRIDGE_TOKEN_SECRET_ENV,
  BRIDGE_URL_ENV,
  BridgeTokenMintError,
  buildChildBridgeSession,
  resolveBridgeMintConfig,
} from "@/lib/family-assistant-bridge";
import { CHILD_SESSION_SUFFIX_PATTERN, isChildId } from "@/lib/family-assistant-turn";

/**
 * POST /api/family/assistant/session
 *
 * Mints the short-lived, child-scoped credential the iPad uses to talk to the
 * tailnet Family Assistant bridge on the Mac mini.
 *
 * ## What this route is for
 *
 * The Companion App cannot reach the child agents itself: the Gateway is
 * loopback-bound on the Mac mini and its operator bearer must never leave that
 * machine (Family Assistant DESIGN §11). So the browser talks to the bridge
 * directly over the tailnet, and this route is the only thing that decides
 * *whether* a given browser may do that and *as which child*.
 *
 * The authority chain is therefore: household Google session (here) → a signed
 * token naming one child and one surface session (here) → the bridge verifies
 * it and holds the Gateway credential (Mac mini). No step hands the next one
 * more power than it needs.
 *
 * ## What never appears in the response
 *
 * The shared signing secret, the Gateway URL, the Gateway bearer, the child's
 * model or workspace. The body is a subject, a session name, a minutes-long
 * token, and the bridge origin — which is also why the bridge URL is served
 * from here rather than inlined as a `NEXT_PUBLIC_*` build-time constant.
 *
 * Request body: `{ childId: "santiago" | "isabel", sessionSuffix?: string }`
 * Response: `{ child, sessionSuffix, token, expiresAt, bridgeUrl }`
 */

/** Default surface name. The shared iPad is one stable session per child. */
const DEFAULT_SESSION_SUFFIX = "ipad";

/** `no-store, private` on every response: this body carries a credential. */
const NO_STORE = {
  "Cache-Control": "no-store, private, max-age=0, must-revalidate",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
} as const;

/**
 * Per-child mint budget for this server instance.
 *
 * A session token lasts ten minutes, so a healthy iPad mints roughly six per
 * hour per child. This bounds a stuck client (or a script behind a valid
 * household session) without ever getting in a child's way.
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
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: NO_STORE });
  }

  const record = (body ?? {}) as Record<string, unknown>;
  const childId = record.childId;
  if (!isChildId(childId)) {
    return NextResponse.json(
      { error: "childId must be santiago or isabel" },
      { status: 400, headers: NO_STORE },
    );
  }

  // A caller may name the surface but not its shape: the suffix is validated
  // against the same pattern the ingress contract uses, so it can never carry
  // a `:` and re-target the session key at another agent.
  const rawSuffix = typeof record.sessionSuffix === "string" ? record.sessionSuffix.trim() : "";
  const sessionSuffix = rawSuffix || DEFAULT_SESSION_SUFFIX;
  if (!CHILD_SESSION_SUFFIX_PATTERN.test(sessionSuffix)) {
    return NextResponse.json(
      { error: "sessionSuffix must be 1-64 characters of [A-Za-z0-9._-]" },
      { status: 400, headers: NO_STORE },
    );
  }

  const configured = resolveBridgeMintConfig();
  if (!configured.ok) {
    // Fail closed and say so on the server, not in the response: which piece of
    // configuration is missing is an operator fact, not a client fact.
    console.error(
      `[family/assistant/session] bridge not configured (${configured.reason}); ` +
        `set ${BRIDGE_TOKEN_SECRET_ENV} and ${BRIDGE_URL_ENV}`,
    );
    return NextResponse.json(
      { error: "The family assistant bridge is not configured" },
      { status: 503, headers: NO_STORE },
    );
  }

  const nowMs = Date.now();
  if (!admitMint(childId, nowMs)) {
    return NextResponse.json(
      { error: "Too many session requests" },
      { status: 429, headers: { ...NO_STORE, "Retry-After": "30" } },
    );
  }

  try {
    const minted = buildChildBridgeSession({
      config: configured.config,
      childId,
      sessionSuffix,
      jti: randomUUID(),
      nowMs,
    });
    return NextResponse.json(minted, { status: 200, headers: NO_STORE });
  } catch (error) {
    if (error instanceof BridgeTokenMintError) {
      console.error(`[family/assistant/session] mint refused: ${error.reason}`);
      return NextResponse.json({ error: "Could not start an assistant session" }, { status: 400, headers: NO_STORE });
    }
    console.error("[family/assistant/session] unexpected failure", error);
    return NextResponse.json({ error: "Could not start an assistant session" }, { status: 500, headers: NO_STORE });
  }
}
