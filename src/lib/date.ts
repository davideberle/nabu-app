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
