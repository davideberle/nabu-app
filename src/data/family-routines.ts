// ---------------------------------------------------------------------------
// Family Routines — mock seed data for Phase R2 static prototype
// ---------------------------------------------------------------------------

export type FamilyPerson = {
  id: string;
  displayName: string;
  role: "parent" | "child";
  colorToken: string;
};

export type RoutineCategory =
  | "practice"
  | "body-care"
  | "household"
  | "family-contribution"
  | "job"
  | "reward";

export type TaskClass = "routine" | "responsibility" | "privilege" | "job";

export type CompletionStatus =
  | "planned"
  | "done"
  | "submitted"
  | "approved"
  | "skipped"
  | "missed"
  | "needs-help";

export type RewardStatus = "not-yet" | "earned" | "approved" | "redeemed";

export type RoutineDefinition = {
  id: string;
  title: string;
  taskClass: TaskClass;
  category: RoutineCategory;
  assignedTo: string[];
  /** Days of the week: 0=Mon … 6=Sun. null = every day. */
  days: number[] | null;
  requiresApproval: boolean;
  description?: string;
};

export type CompletionRecord = {
  routineId: string;
  personId: string;
  /** 0-based day index (Mon=0 … Sun=6) */
  day: number;
  status: CompletionStatus;
  note?: string;
};

export type RewardRecord = {
  personId: string;
  day: number;
  title: string;
  status: RewardStatus;
};

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export const familyMembers: FamilyPerson[] = [
  { id: "david", displayName: "David", role: "parent", colorToken: "blue" },
  { id: "marisol", displayName: "Marisol", role: "parent", colorToken: "violet" },
  { id: "santiago", displayName: "Santiago", role: "child", colorToken: "amber" },
  { id: "isabel", displayName: "Isabel", role: "child", colorToken: "green" },
];

// ---------------------------------------------------------------------------
// Category display metadata
// ---------------------------------------------------------------------------

export const categoryMeta: Record<RoutineCategory, { label: string; order: number }> = {
  practice:              { label: "Practice",              order: 0 },
  "body-care":           { label: "Body / Care",           order: 1 },
  household:             { label: "Household",             order: 2 },
  "family-contribution": { label: "Family Contribution",   order: 3 },
  job:                   { label: "Optional Jobs",         order: 4 },
  reward:                { label: "Rewards",               order: 5 },
};

export const swimlaneCategories: RoutineCategory[] = [
  "practice",
  "body-care",
  "household",
  "family-contribution",
  "job",
  "reward",
];

// ---------------------------------------------------------------------------
// Routine definitions
// ---------------------------------------------------------------------------

export const routineDefinitions: RoutineDefinition[] = [
  // Santiago — Practice
  { id: "s-kumon",    title: "Kumon",         taskClass: "routine", category: "practice",    assignedTo: ["santiago"], days: [0,1,2,3,4], requiresApproval: false },
  { id: "s-piano",    title: "Piano practice", taskClass: "routine", category: "practice",   assignedTo: ["santiago"], days: [0,2,4], requiresApproval: false },
  // Santiago — Body / Care
  { id: "s-physio",   title: "Physio exercises", taskClass: "routine", category: "body-care", assignedTo: ["santiago"], days: [0,1,2,3,4], requiresApproval: false },
  // Santiago — Household
  { id: "s-dinner",   title: "Dinner helper",  taskClass: "responsibility", category: "household", assignedTo: ["santiago"], days: [1,3,5], requiresApproval: false },
  { id: "s-clear",    title: "Clear table",    taskClass: "responsibility", category: "household", assignedTo: ["santiago"], days: null, requiresApproval: false },
  // Santiago — Family contribution
  { id: "s-tidy",     title: "Room tidy",      taskClass: "responsibility", category: "family-contribution", assignedTo: ["santiago"], days: [0,1,2,3,4,5,6], requiresApproval: false },
  // Santiago — Optional job
  { id: "s-grocery",  title: "Grocery helper",  taskClass: "job", category: "job", assignedTo: ["santiago"], days: [5], requiresApproval: true, description: "Help with the weekly shop" },

  // Isabel — Practice
  { id: "i-kumon",    title: "Kumon",          taskClass: "routine", category: "practice",   assignedTo: ["isabel"], days: [0,1,2,3,4], requiresApproval: false },
  { id: "i-piano",    title: "Piano practice", taskClass: "routine", category: "practice",   assignedTo: ["isabel"], days: [1,3], requiresApproval: false },
  // Isabel — Body / Care
  { id: "i-physio",   title: "Physio exercises", taskClass: "routine", category: "body-care", assignedTo: ["isabel"], days: [0,2,4], requiresApproval: false },
  // Isabel — Household
  { id: "i-dinner",   title: "Dinner helper",  taskClass: "responsibility", category: "household", assignedTo: ["isabel"], days: [0,2,4], requiresApproval: false },
  { id: "i-clear",    title: "Clear table",    taskClass: "responsibility", category: "household", assignedTo: ["isabel"], days: null, requiresApproval: false },
  // Isabel — Family contribution
  { id: "i-tidy",     title: "Room tidy",      taskClass: "responsibility", category: "family-contribution", assignedTo: ["isabel"], days: [0,1,2,3,4,5,6], requiresApproval: false },
  // Isabel — Optional job
  { id: "i-craft",    title: "Craft cleanup",  taskClass: "job", category: "job", assignedTo: ["isabel"], days: [6], requiresApproval: true, description: "Organise the craft shelf" },

  // David
  { id: "d-exercise", title: "Exercise",       taskClass: "routine", category: "body-care",  assignedTo: ["david"], days: [0,1,2,3,4], requiresApproval: false },
  { id: "d-cook",     title: "Cook dinner",    taskClass: "responsibility", category: "household", assignedTo: ["david"], days: null, requiresApproval: false },

  // Marisol
  { id: "m-yoga",     title: "Yoga",           taskClass: "routine", category: "body-care",  assignedTo: ["marisol"], days: [0,2,4], requiresApproval: false },
  { id: "m-garden",   title: "Garden check",   taskClass: "responsibility", category: "household", assignedTo: ["marisol"], days: [5,6], requiresApproval: false },
];

// ---------------------------------------------------------------------------
// Initial completion records (sample week state for the prototype)
// ---------------------------------------------------------------------------

export const initialCompletions: CompletionRecord[] = [
  // Santiago — Mon (day 0)
  { routineId: "s-kumon",  personId: "santiago", day: 0, status: "done" },
  { routineId: "s-piano",  personId: "santiago", day: 0, status: "done" },
  { routineId: "s-physio", personId: "santiago", day: 0, status: "done" },
  { routineId: "s-clear",  personId: "santiago", day: 0, status: "done" },
  { routineId: "s-tidy",   personId: "santiago", day: 0, status: "done" },
  // Santiago — Tue (day 1)
  { routineId: "s-kumon",  personId: "santiago", day: 1, status: "done" },
  { routineId: "s-physio", personId: "santiago", day: 1, status: "submitted", note: "Did 3 of 5 sets" },
  { routineId: "s-dinner", personId: "santiago", day: 1, status: "planned" },
  { routineId: "s-clear",  personId: "santiago", day: 1, status: "planned" },
  { routineId: "s-tidy",   personId: "santiago", day: 1, status: "done" },

  // Isabel — Mon (day 0)
  { routineId: "i-kumon",  personId: "isabel", day: 0, status: "done" },
  { routineId: "i-dinner", personId: "isabel", day: 0, status: "done" },
  { routineId: "i-clear",  personId: "isabel", day: 0, status: "done" },
  { routineId: "i-tidy",   personId: "isabel", day: 0, status: "done" },
  // Isabel — Tue (day 1)
  { routineId: "i-kumon",  personId: "isabel", day: 1, status: "done" },
  { routineId: "i-piano",  personId: "isabel", day: 1, status: "planned" },
  { routineId: "i-clear",  personId: "isabel", day: 1, status: "planned" },
  { routineId: "i-tidy",   personId: "isabel", day: 1, status: "planned" },

  // David — Mon
  { routineId: "d-exercise", personId: "david", day: 0, status: "done" },
  { routineId: "d-cook",     personId: "david", day: 0, status: "done" },
  // David — Tue
  { routineId: "d-exercise", personId: "david", day: 1, status: "planned" },
  { routineId: "d-cook",     personId: "david", day: 1, status: "planned" },
];

// ---------------------------------------------------------------------------
// Reward records
// ---------------------------------------------------------------------------

export const initialRewards: RewardRecord[] = [
  { personId: "santiago", day: 0, title: "Chosen activity", status: "earned" },
  { personId: "santiago", day: 1, title: "Chosen activity", status: "not-yet" },
  { personId: "isabel",   day: 0, title: "Chosen activity", status: "earned" },
  { personId: "isabel",   day: 1, title: "Chosen activity", status: "not-yet" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Get the current weekday as 0-based (Mon=0). */
export function currentDayIndex(): number {
  const jsDay = new Date().getDay(); // 0=Sun
  return jsDay === 0 ? 6 : jsDay - 1;
}

/** Get routines assigned to a person for a specific day. */
export function routinesForPersonDay(
  personId: string,
  day: number,
): RoutineDefinition[] {
  return routineDefinitions.filter(
    (r) =>
      r.assignedTo.includes(personId) &&
      (r.days === null || r.days.includes(day)),
  );
}

/** Get routines for a person grouped by category. */
export function routinesForPerson(personId: string): RoutineDefinition[] {
  return routineDefinitions.filter((r) => r.assignedTo.includes(personId));
}

/** Summarise a person's week completion. */
export function weekSummary(
  personId: string,
  completions: CompletionRecord[],
): { done: number; planned: number; submitted: number; total: number } {
  const mine = completions.filter((c) => c.personId === personId);
  const done = mine.filter((c) => c.status === "done" || c.status === "approved").length;
  const submitted = mine.filter((c) => c.status === "submitted").length;
  const planned = mine.filter((c) => c.status === "planned").length;
  return { done, planned, submitted, total: mine.length };
}

/** Today status label for overview cards. */
export function todayStatusLabel(
  personId: string,
  completions: CompletionRecord[],
  today: number,
): string {
  const todayTasks = completions.filter(
    (c) => c.personId === personId && c.day === today,
  );
  if (todayTasks.length === 0) return "Rest day";
  const done = todayTasks.filter((c) => c.status === "done" || c.status === "approved").length;
  const submitted = todayTasks.filter((c) => c.status === "submitted").length;
  if (submitted > 0) return "Waiting for review";
  if (done === todayTasks.length) return "All done";
  const remaining = todayTasks.length - done;
  return `${remaining} remaining`;
}
