import type { NextFetchEvent, NextRequest } from "next/server";
import { auth } from "@/auth";
import {
  isAdminOnlyApiRoute,
  isTrackerAllowedApiPath,
  isTrackerAllowedPath,
  isTrackerOnlyEmail,
  isTrustedRuntimeApiRoute,
  withoutSessionRefresh,
} from "@/lib/access";

// The wrapper's overloaded return type demands a route-handler context as the
// second argument; in middleware it is the fetch event.
type AuthMiddleware = (request: NextRequest, event: NextFetchEvent) => Promise<Response | undefined>;

const withAuth = auth((req) => {
  const isLoggedIn = !!req.auth;
  const isLoginPage = req.nextUrl.pathname === "/login";
  const isApiRoute = req.nextUrl.pathname.startsWith("/api/");
  const isTrackerOnly = isTrackerOnlyEmail(req.auth?.user?.email);

  if (isApiRoute) {
    if (isLoggedIn && isTrackerOnly) {
      // Trusted-runtime-capable mutations are decided by the route guard, which
      // is the only place that can see the bearer token: it accepts an
      // authorized household session *or* a valid runtime token, and still
      // refuses a tracker-only session that has neither. Refusing here would
      // block a valid token before it could ever be checked.
      if (isTrustedRuntimeApiRoute(req.method, req.nextUrl.pathname)) {
        return;
      }
      if (
        !isTrackerAllowedApiPath(req.nextUrl.pathname) ||
        isAdminOnlyApiRoute(req.method, req.nextUrl.pathname)
      ) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    return;
  }

  // Redirect to login if not logged in
  if (!isLoggedIn && !isLoginPage) {
    return Response.redirect(new URL("/login", req.nextUrl.origin));
  }

  // Redirect to home if logged in and on login page
  if (isLoggedIn && isLoginPage) {
    return Response.redirect(new URL(isTrackerOnly ? "/family/home" : "/", req.nextUrl.origin));
  }

  // Shared child-device / tracker-only accounts stay inside the family
  // surfaces; anything else lands on the Family Home chooser.
  if (isLoggedIn && isTrackerOnly && !isTrackerAllowedPath(req.nextUrl.pathname)) {
    return Response.redirect(new URL("/family/home", req.nextUrl.origin));
  }
}) as unknown as AuthMiddleware;

/**
 * The NextAuth wrapper above appends a re-signed session cookie to every
 * response it handles. No response leaves the middleware with that refresh
 * (`withoutSessionRefresh`): a page, RSC or API response computed under the
 * owner session but delivered after a sign-out or account switch must not
 * re-install the owner session in the browser (independent privacy review,
 * 2026-09-29). Sign-in and sign-out write their cookies in route handlers and
 * server actions, which Next merges after this and which stay intact. The
 * decision itself (403/redirect/next) is unchanged; sessions simply no longer
 * slide — see the note on `withoutSessionRefresh`.
 */
export default async function middleware(request: NextRequest, event: NextFetchEvent) {
  const response = await withAuth(request, event);
  if (!response) return response;
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: withoutSessionRefresh(response.headers) });
}

export const config = {
  // `family/assistant/manifest.webmanifest` and the two Family Assistant icon
  // PNGs are public install metadata: Safari fetches manifests and Home Screen
  // icons without credentials, so an auth redirect here would break "Add to
  // Home Screen" for the assistant. The exclusions are exact paths on purpose.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest\\.json|family/assistant/manifest\\.webmanifest|family-assistant-icon\\.png|family-assistant-icon-512\\.png|.*\\.svg).*)",
  ],
};
