import { auth } from "@/auth";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isLoginPage = req.nextUrl.pathname === "/login";
  const isApiRoute = req.nextUrl.pathname.startsWith("/api/");

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
    return Response.redirect(new URL("/", req.nextUrl.origin));
  }
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.svg).*)"],
};
