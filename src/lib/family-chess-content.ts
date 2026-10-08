// ---------------------------------------------------------------------------
// Gated delivery of the Adaptive Chess Coach bundle (October 8, 2026).
//
// The Game Studio-owned pilot bundle is embedded at build time
// (`src/data/adaptive-chess-coach/bundle.generated.ts`, parity-checked in
// `prebuild`) and served ONLY by the route handler at
// `/games/adaptive-chess-coach/index.html`, which demands the Studio lease
// credential of an active, chess-kind, today's-date lease whose child is still
// eligible. The four scripts are inlined into that one document, so no raw
// runnable asset exists at any URL. Origin and path are unchanged from the
// vendored static copy, so the game's per-child `localStorage` profile
// (`chess-coach:v1:<child>`) is exactly where it was.
//
// Pure helpers here (no server imports) so the leases route and the tests can
// build/parse the content path.
// ---------------------------------------------------------------------------

import type { ChildId } from "./family-assistant-turn.ts";

export const CHESS_CONTENT_PATH = "/games/adaptive-chess-coach/index.html";

/** The same-origin content URL the guarded play wrapper loads into its frame. */
export function chessContentPath(child: ChildId, credential: string): string {
  return `${CHESS_CONTENT_PATH}?child=${encodeURIComponent(child)}&credential=${encodeURIComponent(credential)}`;
}

/**
 * Inline the bundle's relative `<script src="…">` tags with the embedded
 * sources, and inject the play guard right after `<head>`. Any script tag that
 * does not name an embedded file is dropped rather than left dangling.
 */
export function renderChessDocument(bundle: Readonly<Record<string, string>>, guard: string): string {
  const html = bundle["index.html"];
  if (typeof html !== "string") throw new Error("chess bundle missing index.html");
  const inlined = html.replace(/<script\s+src="([^"]+)"\s*><\/script>/g, (_match, src: string) => {
    const body = bundle[src];
    if (typeof body !== "string") return "";
    // A closing script tag inside the source would end the inline block early.
    return `<script data-chess-asset="${src}">${body.replace(/<\/script/gi, "<\\/script")}</script>`;
  });
  return /<head[^>]*>/i.test(inlined) ? inlined.replace(/<head[^>]*>/i, (tag) => `${tag}${guard}`) : `${guard}${inlined}`;
}

/**
 * The embedding page's origin — the ONLY origin the injected guard accepts
 * heartbeats from and the only one allowed to frame the game. The configured
 * auth URL is the app's canonical origin (local harness and production alike);
 * the forwarded/host headers are the fallback. `request.url` is not used: the
 * server may normalize it to a different host name than the browser sees.
 */
export function appOrigin(headers: Headers, env: Record<string, string | undefined> = process.env): string {
  const configured = env.AUTH_URL ?? env.NEXTAUTH_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      /* fall through to the headers */
    }
  }
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? "localhost";
  const proto = headers.get("x-forwarded-proto") ?? (/^(127\.0\.0\.1|localhost|\[::1\])(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}
