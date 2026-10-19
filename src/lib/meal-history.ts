import type { CookEvent } from "./db.ts";
import {
  resolveMainDish,
  type CookingSession,
} from "./cooking-session.ts";
import type { MealPlan } from "./meals.ts";

export type DayHistoryStatus =
  | "planned"
  | "in-progress"
  | "cooked-as-planned"
  | "cooked-other"
  | "planned-unlogged"
  | "skipped"
  | null;

export type DayHistory = {
  date: string;
  status: DayHistoryStatus;
  plannedRecipeId: string | null;
  plannedRecipeName: string | null;
  cookedRecipeId: string | null;
  cookedRecipeName: string | null;
  /**
   * The weekend breakfast/brunch, projected on its own so a brunch and a
   * dinner on the same date never stand in for each other. Present only when
   * the day plans a brunch.
   */
  brunch?: BrunchHistory;
};

export type BrunchHistory = {
  status: Extract<DayHistoryStatus, "planned" | "in-progress" | "cooked-as-planned" | "planned-unlogged">;
  plannedRecipeId: string;
  plannedRecipeName: string;
  cookedRecipeId: string | null;
  cookedRecipeName: string | null;
};

type DaySlot = MealPlan["days"][number];

function uniqueIds(ids: (string | null | undefined)[]): string[] {
  return ids
    .filter((id): id is string => Boolean(id))
    .filter((id, index, all) => all.indexOf(id) === index);
}

/** The day's main-meal recipe ids (dinner main as saved on either field). */
export function getPlannedRecipeIds(slot: DaySlot | null): string[] {
  if (!slot) return [];
  return uniqueIds([slot.recipeId, slot.meal?.main?.id]);
}

/** The day's brunch recipe ids: its main and every structured side. */
export function getBrunchRecipeIds(slot: DaySlot | null): string[] {
  if (!slot?.brunch?.main?.id) return [];
  return uniqueIds([slot.brunch.main.id, ...(slot.brunch.sides ?? []).map((side) => side.id)]);
}

/**
 * Project the plan and durable cooking evidence into one truthful day history.
 *
 * Cook events are explicit and therefore always win. For today or a past date,
 * an ad-hoc or Telegram session is itself evidence that the meal was
 * established, even when nobody pressed Complete. It is "in-progress" today
 * and becomes cooked history after rollover. A session auto-created from the
 * meal plan is weaker evidence and counts only after completion. Abandoned and
 * future sessions never count. The plan remains comparison data; this function
 * never mutates it.
 */
export function projectDayHistory(input: {
  date: string;
  today: string;
  slot: DaySlot | null;
  cookEvents: Pick<CookEvent, "recipeId">[];
  sessions: CookingSession[];
  recipeNames: ReadonlyMap<string, string>;
  intentionallySkipped: boolean;
}): DayHistory {
  const {
    date,
    today,
    slot,
    cookEvents,
    sessions,
    recipeNames,
    intentionallySkipped,
  } = input;
  const plannedIds = getPlannedRecipeIds(slot);
  const hasPlannedRecipe = plannedIds.length > 0;
  const isPast = date < today;
  const isToday = date === today;
  const isFuture = date > today;

  // Brunch evidence belongs to the brunch projection below. A recipe that is
  // planned as both (rare) stays visible to the main meal as well.
  const brunchOnlyIds = new Set(
    getBrunchRecipeIds(slot).filter((id) => !plannedIds.includes(id)),
  );
  const brunchProjection = projectBrunch({ slot, cookEvents, sessions, isPast, isToday, isFuture });
  const mainEvents = cookEvents.filter((event) => !brunchOnlyIds.has(event.recipeId));

  const eligibleSessions = sessions
    .filter((session) => !brunchOnlyIds.has(resolveMainDish(session).recipeId ?? ""))
    .filter((session) =>
      session.status !== "abandoned" &&
      !isFuture &&
      (session.status === "completed" || session.source !== "meal-plan"),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const resolvedSessions = eligibleSessions.map((session) => ({
    session,
    main: resolveMainDish(session),
  }));

  // Completed sessions can record several components. Prefer the event that
  // resolves to the session's explicit main, then preserve the established
  // planned-main preference, then take the newest remaining explicit event.
  const inferredMainIds = new Set(
    resolvedSessions
      .map(({ main }) => main.recipeId)
      .filter((id): id is string => Boolean(id)),
  );
  const explicitEvent =
    mainEvents.find((event) => inferredMainIds.has(event.recipeId)) ??
    mainEvents.find((event) => plannedIds.includes(event.recipeId)) ??
    mainEvents[0] ??
    null;

  let cookedRecipeId: string | null = null;
  let cookedRecipeName: string | null = null;

  if (explicitEvent) {
    cookedRecipeId = explicitEvent.recipeId;
    const matchingSession = resolvedSessions.find(
      ({ main }) => main.recipeId === explicitEvent.recipeId,
    );
    cookedRecipeName =
      recipeNames.get(explicitEvent.recipeId) ??
      matchingSession?.main.title ??
      (plannedIds.includes(explicitEvent.recipeId)
        ? slot?.recipeName ?? slot?.meal?.main?.name ?? null
        : null);
  } else if (resolvedSessions.length > 0) {
    const { main } = resolvedSessions[0];
    cookedRecipeId = main.recipeId ?? null;
    cookedRecipeName = main.title;
  }

  const hasCooked = Boolean(cookedRecipeId || cookedRecipeName);
  const isCurrentSession = Boolean(
    !explicitEvent &&
    isToday &&
    resolvedSessions[0] &&
    resolvedSessions[0].session.status !== "completed" &&
    resolvedSessions[0].session.source !== "meal-plan",
  );
  const cookedAsPlanned = Boolean(
    hasPlannedRecipe && cookedRecipeId && plannedIds.includes(cookedRecipeId),
  );

  let status: DayHistoryStatus = null;
  if (isCurrentSession) {
    status = "in-progress";
  } else if (cookedAsPlanned) {
    status = "cooked-as-planned";
  } else if (hasCooked) {
    status = "cooked-other";
  } else if (hasPlannedRecipe) {
    status = isPast ? "planned-unlogged" : "planned";
  } else if (intentionallySkipped) {
    status = "skipped";
  }

  return {
    date,
    status,
    plannedRecipeId: slot?.recipeId ?? slot?.meal?.main?.id ?? null,
    plannedRecipeName: slot?.recipeName ?? slot?.meal?.main?.name ?? null,
    cookedRecipeId,
    cookedRecipeName,
    ...(brunchProjection ? { brunch: brunchProjection } : {}),
  };
}

/**
 * The brunch counterpart of the main-meal projection: cooked only on an
 * explicit cook event for one of its recipes, or an eligible session whose main
 * is the brunch main. Import or preparation alone is never cooking evidence.
 */
function projectBrunch(input: {
  slot: DaySlot | null;
  cookEvents: Pick<CookEvent, "recipeId">[];
  sessions: CookingSession[];
  isPast: boolean;
  isToday: boolean;
  isFuture: boolean;
}): BrunchHistory | null {
  const { slot, cookEvents, sessions, isPast, isToday, isFuture } = input;
  const main = slot?.brunch?.main;
  if (!main?.id) return null;
  // A side shared with the main meal (a green salad, say) is the main meal's
  // evidence, not the brunch's; only the brunch main and its own sides count.
  const mainMealIds = new Set([
    ...getPlannedRecipeIds(slot),
    ...(slot?.meal?.sides ?? []).map((side) => side.id),
  ]);
  const brunchIds = getBrunchRecipeIds(slot).filter((id) => id === main.id || !mainMealIds.has(id));

  const event =
    cookEvents.find((candidate) => candidate.recipeId === main.id) ??
    cookEvents.find((candidate) => brunchIds.includes(candidate.recipeId)) ??
    null;
  const session = isFuture
    ? null
    : sessions.find((candidate) =>
        candidate.status !== "abandoned" &&
        (candidate.status === "completed" || candidate.source !== "meal-plan") &&
        resolveMainDish(candidate).recipeId === main.id,
      ) ?? null;

  let status: BrunchHistory["status"];
  if (event) status = "cooked-as-planned";
  else if (session && isToday && session.status !== "completed") status = "in-progress";
  else if (session) status = "cooked-as-planned";
  else status = isPast ? "planned-unlogged" : "planned";

  const cooked = Boolean(event || session);
  return {
    status,
    plannedRecipeId: main.id,
    plannedRecipeName: main.name,
    cookedRecipeId: cooked ? main.id : null,
    cookedRecipeName: cooked ? main.name : null,
  };
}
