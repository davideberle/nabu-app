import { auth } from "@/auth";
import {
  isAdminOnlyApiRoute,
  isTrackerAllowedApiPath,
  isTrackerAllowedPath,
  isTrackerOnlyEmail,
  isTrustedRuntimeApiRoute,
} from "@/lib/access";

export default auth((req) => {
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
    return Response.redirect(new URL(isTrackerOnly ? "/family/dashboard" : "/", req.nextUrl.origin));
  }

  // Shared-iPad / tracker-only accounts stay inside the family dashboard.
  if (isLoggedIn && isTrackerOnly && !isTrackerAllowedPath(req.nextUrl.pathname)) {
    return Response.redirect(new URL("/family/dashboard", req.nextUrl.origin));
  }
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest\\.json|.*\\.svg).*)"],
};
