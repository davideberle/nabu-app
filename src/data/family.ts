/**
 * Family milestone data projection.
 *
 * Canonical source: projects/family/DATES.md
 * Generated data: src/data/family-dates.generated.json (via scripts/generate-family-dates.mjs)
 * This module computes display values (ages, days-until, planning status)
 * from the generated data. It does not own family facts.
 */

import generatedData from "./family-dates.generated.json";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MilestoneKind = "birthday" | "anniversary";

export type PlanningStatus =
  | "planning-window" // within the lead-time window
  | "upcoming" // < 30 days but outside planning window
  | "later"; // > 30 days

export interface FamilyMilestone {
  id: string;
  label: string;
  kind: MilestoneKind;
  /** DD.MM.YYYY from DATES.md */
  canonicalDate: string;
  /** Optional note from DATES.md */
  note?: string;
  /** Whether this person is a child (age-aware recommendations) */
  isChild?: boolean;
}

export interface ComputedMilestone extends FamilyMilestone {
  nextOccurrence: Date;
  daysUntil: number;
  /** Age (birthday) or anniversary count */
  nextCount: number;
  planningStatus: PlanningStatus;
  /** Human-readable planning label */
  planningLabel: string;
  /** Start of planning window as days-before */
  planningWindowDays: number;
}

// ---------------------------------------------------------------------------
// Data from generated JSON (sourced from projects/family/DATES.md)
// ---------------------------------------------------------------------------

const MILESTONES: FamilyMilestone[] = generatedData.milestones as FamilyMilestone[];

// ---------------------------------------------------------------------------
// Planning rules (from DATES.md via generated JSON)
// ---------------------------------------------------------------------------

const KIDS_PLANNING_DAYS = generatedData.planningRules.kidsPlanningStartWeeks * 7;
const MAJOR_PLANNING_DAYS = generatedData.planningRules.majorPlanningStartWeeks * 7;

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

function parseDDMMYYYY(s: string): { day: number; month: number; year: number } {
  const [d, m, y] = s.split(".").map(Number);
  return { day: d, month: m, year: y };
}

function nextOccurrence(day: number, month: number, today: Date): Date {
  const y = today.getFullYear();
  // month is 1-based from DATES.md, Date uses 0-based
  let next = new Date(y, month - 1, day);
  // If this year's date has already passed, use next year
  if (next.getTime() < startOfDay(today).getTime()) {
    next = new Date(y + 1, month - 1, day);
  }
  return next;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysBetween(a: Date, b: Date): number {
  const msPerDay = 86_400_000;
  return Math.round((b.getTime() - a.getTime()) / msPerDay);
}

function computeCount(
  kind: MilestoneKind,
  originYear: number,
  nextOccurrenceDate: Date,
): number {
  return nextOccurrenceDate.getFullYear() - originYear;
}

function getPlanningWindowDays(m: FamilyMilestone): number {
  return m.isChild ? KIDS_PLANNING_DAYS : MAJOR_PLANNING_DAYS;
}

function getPlanningStatus(daysUntil: number, windowDays: number): PlanningStatus {
  if (daysUntil <= windowDays) return "planning-window";
  if (daysUntil <= 30) return "upcoming";
  return "later";
}

function getPlanningLabel(status: PlanningStatus, daysUntil: number, isChild?: boolean): string {
  switch (status) {
    case "planning-window":
      return isChild
        ? `Start planning — ${daysUntil} days`
        : `Time to plan — ${daysUntil} days`;
    case "upcoming":
      return `Coming up — ${daysUntil} days`;
    case "later":
      return daysUntil <= 90
        ? `In ${Math.ceil(daysUntil / 7)} weeks`
        : `In ${Math.round(daysUntil / 30)} months`;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute all milestones with derived display values, sorted by next occurrence.
 */
export function getComputedMilestones(now?: Date): ComputedMilestone[] {
  const today = now ?? new Date();

  return MILESTONES.map((m) => {
    const { day, month, year } = parseDDMMYYYY(m.canonicalDate);
    const next = nextOccurrence(day, month, today);
    const days = daysBetween(startOfDay(today), next);
    const count = computeCount(m.kind, year, next);
    const windowDays = getPlanningWindowDays(m);
    const status = getPlanningStatus(days, windowDays);

    return {
      ...m,
      nextOccurrence: next,
      daysUntil: days,
      nextCount: count,
      planningStatus: status,
      planningLabel: getPlanningLabel(status, days, m.isChild),
      planningWindowDays: windowDays,
    };
  }).sort((a, b) => a.daysUntil - b.daysUntil);
}

/**
 * Get the next milestone that is in a planning window (if any).
 * Useful for the dashboard Today summary.
 */
export function getNextPlanningMilestone(now?: Date): ComputedMilestone | null {
  const milestones = getComputedMilestones(now);
  return milestones.find((m) => m.planningStatus === "planning-window") ?? null;
}

/**
 * Get the soonest upcoming milestone regardless of planning status.
 */
export function getNextMilestone(now?: Date): ComputedMilestone | null {
  const milestones = getComputedMilestones(now);
  return milestones[0] ?? null;
}

/**
 * Format a date as a readable string (e.g. "29 October").
 */
export function formatMilestoneDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
}
