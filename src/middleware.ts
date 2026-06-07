import { auth } from "@/auth";
import { isTrackerAllowedPath, isTrackerOnlyEmail } from "@/lib/access";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isLoginPage = req.nextUrl.pathname === "/login";
  const isApiRoute = req.nextUrl.pathname.startsWith("/api/");
  const isTrackerOnly = isTrackerOnlyEmail(req.auth?.user?.email);

  // Allow all API routes (includes /api/auth) — they handle their own auth
  if (isApiRoute) {
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

  // Shared-iPad / tracker-only accounts stay inside the family surfaces.
  if (isLoggedIn && isTrackerOnly && !isTrackerAllowedPath(req.nextUrl.pathname)) {
    return Response.redirect(new URL("/family/dashboard", req.nextUrl.origin));
  }
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest\\.json|.*\\.svg).*)"],
};
