const ADMIN_EMAIL = "info@davideberle.com";
const DEFAULT_TRACKER_ONLY_EMAILS = ["assistant@davideberle.com"];

function parseEmailList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function getTrackerOnlyEmails(): string[] {
  const configured = parseEmailList(process.env.IPAD_TRACKER_ONLY_EMAILS);
  return configured.length > 0 ? configured : DEFAULT_TRACKER_ONLY_EMAILS;
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.toLowerCase() === ADMIN_EMAIL;
}

export function isTrackerOnlyEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return getTrackerOnlyEmails().includes(email.toLowerCase());
}

export function isTrackerAllowedPath(pathname: string): boolean {
  return (
    pathname === "/family/dashboard" ||
    pathname.startsWith("/family/dashboard/")
  );
}

export function isTrackerAllowedApiPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/family/")
  );
}

const ADMIN_ONLY_API_ROUTES: { method: string; path: string }[] = [
  { method: "PUT", path: "/api/family/config" },
  { method: "DELETE", path: "/api/family/completions" },
  { method: "DELETE", path: "/api/family/redemptions" },
];

export function isAdminOnlyApiRoute(method: string, pathname: string): boolean {
  return ADMIN_ONLY_API_ROUTES.some(
    (route) => route.method === method.toUpperCase() && route.path === pathname,
  );
}
