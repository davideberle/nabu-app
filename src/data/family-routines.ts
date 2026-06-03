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
  icon: string;
  taskClass: TaskClass;
  category: RoutineCategory;
  assignedTo: string[];
  /** Days of the week: 0=Mon … 6=Sun. null = every day. */
  days: number[] | null;
  weeklyTarget: number;
  points: number;
  requiresApproval: boolean;
  description?: string;
  moneyLabel?: string;
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

export type RewardDefinition = {
  id: string;
  title: string;
  icon: string;
  period: "daily" | "weekly" | "long-term";
  assignedTo: string[];
  targetPoints: number;
  description: string;
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
  { id: "s-kumon",    title: "Kumon",         icon: "✏️", taskClass: "routine", category: "practice",    assignedTo: ["santiago"], days: [0,1,2,3,4], weeklyTarget: 5, points: 2, requiresApproval: false },
  { id: "s-piano",    title: "Piano practice", icon: "🎹", taskClass: "routine", category: "practice",   assignedTo: ["santiago"], days: [0,2,4], weeklyTarget: 3, points: 2, requiresApproval: false },
  // Santiago — Body / Care
  { id: "s-physio",   title: "Physio exercises", icon: "🏃", taskClass: "routine", category: "body-care", assignedTo: ["santiago"], days: [0,1,2,3,4], weeklyTarget: 5, points: 2, requiresApproval: false },
  // Santiago — Household
  { id: "s-dinner",   title: "Dinner helper",  icon: "🍽️", taskClass: "responsibility", category: "household", assignedTo: ["santiago"], days: [1,3,5], weeklyTarget: 2, points: 1, requiresApproval: false },
  { id: "s-clear",    title: "Clear table",    icon: "🧽", taskClass: "responsibility", category: "household", assignedTo: ["santiago"], days: null, weeklyTarget: 5, points: 1, requiresApproval: false },
  // Santiago — Family contribution
  { id: "s-tidy",     title: "Room tidy",      icon: "🧺", taskClass: "responsibility", category: "family-contribution", assignedTo: ["santiago"], days: [0,1,2,3,4,5,6], weeklyTarget: 5, points: 1, requiresApproval: false },
  // Santiago — Optional job
  { id: "s-grocery",  title: "Claim pocket money", icon: "🛒", taskClass: "job", category: "job", assignedTo: ["santiago"], days: [5], weeklyTarget: 1, points: 0, requiresApproval: true, description: "Weekly grocery shopping job", moneyLabel: "Pocket money" },

  // Isabel — Practice
  { id: "i-kumon",    title: "Kumon",          icon: "✏️", taskClass: "routine", category: "practice",   assignedTo: ["isabel"], days: [0,1,2,3,4], weeklyTarget: 5, points: 2, requiresApproval: false },
  { id: "i-piano",    title: "Piano practice", icon: "🎹", taskClass: "routine", category: "practice",   assignedTo: ["isabel"], days: [1,3], weeklyTarget: 2, points: 2, requiresApproval: false },
  // Isabel — Body / Care
  { id: "i-physio",   title: "Physio exercises", icon: "🏃", taskClass: "routine", category: "body-care", assignedTo: ["isabel"], days: [0,2,4], weeklyTarget: 3, points: 2, requiresApproval: false },
  // Isabel — Household
  { id: "i-dinner",   title: "Dinner helper",  icon: "🍽️", taskClass: "responsibility", category: "household", assignedTo: ["isabel"], days: [0,2,4], weeklyTarget: 2, points: 1, requiresApproval: false },
  { id: "i-clear",    title: "Clear table",    icon: "🧽", taskClass: "responsibility", category: "household", assignedTo: ["isabel"], days: null, weeklyTarget: 5, points: 1, requiresApproval: false },
  // Isabel — Family contribution
  { id: "i-tidy",     title: "Room tidy",      icon: "🧺", taskClass: "responsibility", category: "family-contribution", assignedTo: ["isabel"], days: [0,1,2,3,4,5,6], weeklyTarget: 5, points: 1, requiresApproval: false },
  // Isabel — Optional job
  { id: "i-grocery",  title: "Claim pocket money", icon: "🛒", taskClass: "job", category: "job", assignedTo: ["isabel"], days: [5], weeklyTarget: 1, points: 0, requiresApproval: true, description: "Weekly grocery shopping job", moneyLabel: "Pocket money" },

  // David
  { id: "d-exercise", title: "Exercise",       icon: "💪", taskClass: "routine", category: "body-care",  assignedTo: ["david"], days: [0,1,2,3,4], weeklyTarget: 4, points: 1, requiresApproval: false },
  { id: "d-cook",     title: "Cook dinner",    icon: "🥘", taskClass: "responsibility", category: "household", assignedTo: ["david"], days: null, weeklyTarget: 4, points: 1, requiresApproval: false },

  // Marisol
  { id: "m-yoga",     title: "Yoga",           icon: "🧘", taskClass: "routine", category: "body-care",  assignedTo: ["marisol"], days: [0,2,4], weeklyTarget: 3, points: 1, requiresApproval: false },
  { id: "m-garden",   title: "Garden check",   icon: "🌱", taskClass: "responsibility", category: "household", assignedTo: ["marisol"], days: [5,6], weeklyTarget: 2, points: 1, requiresApproval: false },
];

// ---------------------------------------------------------------------------
// Reward definitions — goals the week pays into
// ---------------------------------------------------------------------------

export const rewardDefinitions: RewardDefinition[] = [
  {
    id: "friends",
    title: "Play with friends",
    icon: "🤝",
    period: "daily",
    assignedTo: ["santiago", "isabel"],
    targetPoints: 4,
    description: "Daily privilege once enough useful things are done.",
  },
  {
    id: "mini-game",
    title: "Mini-game",
    icon: "🎮",
    period: "daily",
    assignedTo: ["santiago", "isabel"],
    targetPoints: 5,
    description: "Small daily screen reward, not the whole economy.",
  },
  {
    id: "movie-night",
    title: "Movie night",
    icon: "🎬",
    period: "weekly",
    assignedTo: ["santiago", "isabel"],
    targetPoints: 24,
    description: "Weekly family reward for a solid week.",
  },
  {
    id: "afternoon-excursion",
    title: "Afternoon excursion",
    icon: "🧭",
    period: "long-term",
    assignedTo: ["santiago", "isabel"],
    targetPoints: 45,
    description: "Longer goal built from several good weeks.",
  },
  {
    id: "proper-trip",
    title: "Proper trip",
    icon: "🗺️",
    period: "long-term",
    assignedTo: ["santiago", "isabel"],
    targetPoints: 90,
    description: "Big shared goal, slow enough to stay special.",
  },
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
  { personId: "santiago", day: 0, title: "Play with friends", status: "earned" },
  { personId: "santiago", day: 1, title: "Mini-game", status: "not-yet" },
  { personId: "isabel",   day: 0, title: "Play with friends", status: "earned" },
  { personId: "isabel",   day: 1, title: "Mini-game", status: "not-yet" },
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

/** Weekly points from done/approved completion records. */
export function weekPoints(
  personId: string,
  completions: CompletionRecord[],
): number {
  const routines = routinesForPerson(personId);
  return completions
    .filter(
      (c) =>
        c.personId === personId &&
        (c.status === "done" || c.status === "approved"),
    )
    .reduce((sum, completion) => {
      const routine = routines.find((r) => r.id === completion.routineId);
      return sum + (routine?.points ?? 0);
    }, 0);
}

/** Progress for one routine row against its weekly target. */
export function routineProgress(
  personId: string,
  routineId: string,
  completions: CompletionRecord[],
): { done: number; target: number } {
  const routine = routineDefinitions.find((r) => r.id === routineId);
  const done = completions.filter(
    (c) =>
      c.personId === personId &&
      c.routineId === routineId &&
      (c.status === "done" || c.status === "approved"),
  ).length;
  return { done, target: routine?.weeklyTarget ?? 0 };
}

export function nextRewardForPerson(
  personId: string,
  points: number,
): { reward: RewardDefinition; missing: number } | null {
  const rewards = rewardDefinitions
    .filter((reward) => reward.assignedTo.includes(personId))
    .sort((a, b) => a.targetPoints - b.targetPoints);
  const next = rewards.find((reward) => points < reward.targetPoints) ?? rewards.at(-1);
  if (!next) return null;
  return { reward: next, missing: Math.max(0, next.targetPoints - points) };
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
