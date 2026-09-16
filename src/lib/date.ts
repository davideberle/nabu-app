const ZURICH_TZ = "Europe/Zurich";

function partsForTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return {
    year: get("year") ?? "",
    month: get("month") ?? "",
    day: get("day") ?? "",
  };
}

/**
 * Return the household-local date used by live cooking and meal planning.
 * Vercel runs in UTC, while David cooks in Switzerland; using ISO UTC dates
 * makes /cooking fall back to yesterday after local midnight.
 */
export function todayInZurich(now = new Date()): string {
  const { year, month, day } = partsForTimeZone(now, ZURICH_TZ);
  return `${year}-${month}-${day}`;
}

export function localDateInZurich(date: Date): string {
  const { year, month, day } = partsForTimeZone(date, ZURICH_TZ);
  return `${year}-${month}-${day}`;
}

/**
 * Return the ISO week for the Europe/Zurich wall date. This must not depend on
 * the server's process timezone (Vercel hosts run in UTC).
 */
export function isoWeekIdInZurich(now = new Date()): string {
  const { year, month, day } = partsForTimeZone(now, ZURICH_TZ);
  const wallDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const dayNumber = wallDate.getUTCDay() || 7;
  wallDate.setUTCDate(wallDate.getUTCDate() + 4 - dayNumber);
  const isoYear = wallDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((wallDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}
