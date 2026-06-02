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

export function isTrackerOnlyEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return getTrackerOnlyEmails().includes(email.toLowerCase());
}

export function isTrackerAllowedPath(pathname: string): boolean {
  return (
    pathname === "/family" ||
    pathname === "/family/tracker" ||
    pathname.startsWith("/api/auth/")
  );
}
