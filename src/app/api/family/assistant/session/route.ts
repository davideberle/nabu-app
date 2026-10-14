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
import { readRetirementSessionRequest } from "@/lib/family-assistant-availability";

/** Household authentication is retained. Only explicit, non-AI listening sessions
 * are minted; real-child assistant calls fail closed before configuration or minting.
 * The media-only token cannot authorize an old bridge child-turn endpoint.
 */
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

  const parsed = readRetirementSessionRequest(body);
  if (parsed.status !== 200) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status, headers: NO_STORE });
  }
  const { childId, sessionSuffix } = parsed;

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
