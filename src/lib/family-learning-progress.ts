// ---------------------------------------------------------------------------
// Learner-entry progress strip (DESIGN §7.6, September 30 follow-on).
//
// Pure and deterministic over the saved mission state, the reviewed content,
// the learner's time zone and the stored parent reviews the DB layer hands
// in. It counts completed visit EVENTS (a visit's `finishedAt`), never starts,
// task attempts or time on screen; the week is the child's local Monday–Sunday
// calendar week; the "You did / Try next" pair is quoted from the stored
// review of the most recent completed visit and is SUPPRESSED (artifact and
// an ordinary next step instead) when that review is missing, obsolete or
// carries no success line. No grade, no percentage, no sibling data.
// ---------------------------------------------------------------------------

import type { LearningContent, VisitId } from "./family-learning-content.ts";
import type { MissionState } from "./family-learning-state.ts";
import { buildVisitSummary, LEARNING_RULES_VERSION, visitLabel, visitOrdinal, visitSubtitle, type VisitSummary } from "./family-learning-summary.ts";

/** Household default; the client sends its own IANA zone and the server validates it. */
export const DEFAULT_LEARNER_TIME_ZONE = "Europe/Zurich";

/** A stored parent review, as far as the strip needs it (read from `family_learning_completions`). */
export type ProgressReviewSource = {
  visitId: string;
  visitStartedAt: string;
  historical: boolean;
  reviewVersion: number | null;
  childSummary: VisitSummary | null;
};

export type ProgressSources = { reviews: ProgressReviewSource[] };

export type ProgressCompletedVisit = { visit: VisitId; ordinal: number | null; label: string; finishedAt: string; thisWeek: boolean; pages: number };

export type ProgressNext =
  | { kind: "continue"; visit: VisitId; ordinal: number | null; label: string; text: string; reason: null }
  | { kind: "start"; visit: VisitId; ordinal: number | null; label: string; text: string; reason: null }
  | { kind: "none"; visit: null; ordinal: null; label: null; text: string; reason: string };

export type ProgressRecent = {
  visit: VisitId;
  ordinal: number | null;
  label: string;
  finishedAt: string;
  /** Evidence-bound "You did …" sentence from the stored review, or null when suppressed. */
  did: string | null;
  /** "Try next …" sentence (the review's recommendation, or an ordinary next step when suppressed). */
  tryNext: string;
  artifact: { kind: "page" | "station" | "pier" | "revision" | "none"; text: string };
  /** Where the sentences come from; `suppressed` explains why no success claim is shown. */
  grounding: { source: "review" | "review-historical" | "none"; reviewVersion: number | null; suppressed: { reason: "review-missing" | "review-obsolete" | "no-success-line" | "visit-not-served"; text: string } | null };
};

export type ProgressStrip = {
  timeZone: string;
  week: { start: string; end: string; label: string };
  completedThisWeek: number;
  completedTotal: number;
  completed: ProgressCompletedVisit[];
  next: ProgressNext;
  recent: ProgressRecent | null;
  /** Honest counting rule, shown to the child in one line. */
  counting: string;
};

const TZ_PATTERN = /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/;

/** A syntactically and Intl-valid IANA zone, or the household default. Never throws. */
export function resolveTimeZone(value: unknown): string {
  if (typeof value !== "string" || !TZ_PATTERN.test(value)) return DEFAULT_LEARNER_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return DEFAULT_LEARNER_TIME_ZONE;
  }
}

type CivilParts = { y: number; m: number; d: number; h: number; mi: number; s: number; weekday: number };

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function civilParts(t: number, timeZone: string): CivilParts {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const get: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(t))) if (p.type !== "literal") get[p.type] = p.value;
  return { y: Number(get.year), m: Number(get.month), d: Number(get.day), h: Number(get.hour) % 24, mi: Number(get.minute), s: Number(get.second), weekday: WEEKDAYS[get.weekday] ?? 1 };
}

function zoneOffsetMs(t: number, timeZone: string): number {
  const p = civilParts(t, timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000;
}

/** The UTC instant of local midnight on the civil date (y, m, d) in the zone; DST-safe by re-evaluating the offset. */
export function localMidnightUtc(y: number, m: number, d: number, timeZone: string): number {
  const civil = Date.UTC(y, m - 1, d);
  let t = civil;
  for (let i = 0; i < 3; i += 1) {
    const next = civil - zoneOffsetMs(t, timeZone);
    if (next === t) break;
    t = next;
  }
  return t;
}

/** Monday 00:00 (inclusive) to next Monday 00:00 (exclusive) of the local week containing `now`. */
export function localWeekBounds(now: Date, timeZone: string): { start: number; end: number } {
  const p = civilParts(now.getTime(), timeZone);
  const monday = new Date(Date.UTC(p.y, p.m - 1, p.d - (p.weekday - 1)));
  const nextMonday = new Date(Date.UTC(p.y, p.m - 1, p.d - (p.weekday - 1) + 7));
  return {
    start: localMidnightUtc(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), timeZone),
    end: localMidnightUtc(nextMonday.getUTCFullYear(), nextMonday.getUTCMonth() + 1, nextMonday.getUTCDate(), timeZone),
  };
}

function weekLabel(start: number, end: number, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat("de-CH", { timeZone, day: "numeric", month: "long" });
  return `Montag, ${fmt.format(new Date(start))} bis Sonntag, ${fmt.format(new Date(end - 1))}`;
}

export const COUNTING_RULE = "Gezählt werden fertige Besuche — nicht Starts, einzelne Aufgaben oder Zeit am Bildschirm.";

export function buildProgress(state: MissionState, content: LearningContent, input: { now: Date; timeZone: string | null; sources: ProgressSources | null }): ProgressStrip {
  const timeZone = resolveTimeZone(input.timeZone);
  const { start, end } = localWeekBounds(input.now, timeZone);
  const finished = state.visits.filter((v): v is typeof v & { finishedAt: string } => typeof v.finishedAt === "string").slice().sort((a, b) => (a.finishedAt < b.finishedAt ? -1 : a.finishedAt > b.finishedAt ? 1 : 0));
  const completed: ProgressCompletedVisit[] = finished.map((v) => {
    const t = Date.parse(v.finishedAt);
    return {
      visit: v.id,
      ordinal: visitOrdinal(state, v.id),
      label: content.visits.some((d) => d.id === v.id) ? visitLabel(state, content, v.id) : `Besuch ${visitOrdinal(state, v.id) ?? "?"}`,
      finishedAt: v.finishedAt,
      thisWeek: Number.isFinite(t) && t >= start && t < end,
      pages: state.pages.filter((p) => p.visit === v.id && p.at >= v.startedAt && p.at <= v.finishedAt).length,
    };
  });

  // Next action — exactly one, derived from the same availability rule the start button uses.
  const running = state.visits.find((v) => v.finishedAt === null) ?? null;
  const served = (id: VisitId) => content.visits.some((d) => d.id === id);
  let next: ProgressNext;
  if (running && !served(running.id)) next = { kind: "none", visit: null, ordinal: null, label: null, text: "Dein angefangenes Kapitel ist gerade nicht verfügbar. Alles ist gespeichert.", reason: "chapter-unavailable" };
  else if (running) next = { kind: "continue", visit: running.id, ordinal: visitOrdinal(state, running.id), label: visitLabel(state, content, running.id), text: `Weiter mit ${visitLabel(state, content, running.id)}.`, reason: null };
  else {
    const done = new Set(finished.map((v) => v.id));
    const candidate: VisitId | null = !done.has("v1") ? "v1" : !done.has("v2") ? "v2" : served("v4") && !done.has("v4") ? "v4" : served("v5") && !done.has("v5") ? "v5" : null;
    if (candidate) next = { kind: "start", visit: candidate, ordinal: visitOrdinal(state, candidate), label: visitLabel(state, content, candidate), text: candidate === "v1" ? "Start: Baue deine Basis." : `Start: ${visitLabel(state, content, candidate)}.`, reason: null };
    else if (!served("v4")) next = { kind: "none", visit: null, ordinal: null, label: null, text: "Das nächste Kapitel ist gerade nicht verfügbar. Alles ist gespeichert.", reason: "no-further-visit-served" };
    else next = { kind: "none", visit: null, ordinal: null, label: null, text: "Alle Besuche sind geschafft. Neue Aufgaben kommen erst nach einer Prüfung dazu.", reason: "all-visits-done" };
  }

  // Recent — the most recently completed visit, quoted from its stored review or honestly suppressed.
  let recent: ProgressRecent | null = null;
  const last = finished.length ? finished[finished.length - 1] : null;
  if (last) {
    const label = served(last.id) ? visitLabel(state, content, last.id) : `Besuch ${visitOrdinal(state, last.id) ?? "?"}`;
    const ordinaryNext = next.text;
    const source = input.sources?.reviews.find((r) => r.visitId === last.id && r.visitStartedAt === last.startedAt) ?? null;
    const factualArtifact = served(last.id) ? buildVisitSummary(state, content, last.id).artifact : { kind: "none" as const, text: "Keine Seite aus diesem Besuch." };
    const suppress = (reason: NonNullable<ProgressRecent["grounding"]["suppressed"]>["reason"], text: string): ProgressRecent => ({
      visit: last.id,
      ordinal: visitOrdinal(state, last.id),
      label,
      finishedAt: last.finishedAt,
      did: null,
      tryNext: ordinaryNext,
      artifact: factualArtifact,
      grounding: { source: "none", reviewVersion: source?.reviewVersion ?? null, suppressed: { reason, text } },
    });
    if (!served(last.id)) recent = suppress("visit-not-served", "Der Rückblick zu diesem Besuch ist gerade nicht verfügbar.");
    else if (!source || !source.childSummary) recent = suppress("review-missing", "Der Rückblick zu diesem Besuch ist noch nicht erstellt.");
    else if (source.reviewVersion !== null && source.reviewVersion < LEARNING_RULES_VERSION) recent = suppress("review-obsolete", "Der Rückblick zu diesem Besuch stammt aus einer älteren Regelfassung und wird nicht zitiert.");
    else if (source.reviewVersion === null) recent = suppress("review-obsolete", "Der Rückblick zu diesem Besuch hat keine Regelfassung und wird nicht zitiert.");
    else {
      const summary = source.childSummary;
      recent = {
        visit: last.id,
        ordinal: visitOrdinal(state, last.id),
        label,
        finishedAt: last.finishedAt,
        did: summary.success?.text ?? null,
        tryNext: summary.next.text,
        artifact: summary.artifact,
        grounding: { source: source.historical ? "review-historical" : "review", reviewVersion: source.reviewVersion, suppressed: summary.success ? null : { reason: "no-success-line", text: "Der Rückblick nennt keinen Erfolg — hier ist, was entstanden ist." } },
      };
    }
  }

  return {
    timeZone,
    week: { start: new Date(start).toISOString(), end: new Date(end).toISOString(), label: weekLabel(start, end, timeZone) },
    completedThisWeek: completed.filter((c) => c.thisWeek).length,
    completedTotal: completed.length,
    completed,
    next,
    recent,
    counting: COUNTING_RULE,
  };
}

export { visitSubtitle };
