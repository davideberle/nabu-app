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
};

type DaySlot = MealPlan["days"][number];

export function getPlannedRecipeIds(slot: DaySlot | null): string[] {
  if (!slot) return [];
  return [slot.recipeId, slot.meal?.main?.id, slot.brunch?.main?.id]
    .filter((id): id is string => Boolean(id))
    .filter((id, index, ids) => ids.indexOf(id) === index);
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

  const eligibleSessions = sessions
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
    cookEvents.find((event) => inferredMainIds.has(event.recipeId)) ??
    cookEvents.find((event) => plannedIds.includes(event.recipeId)) ??
    cookEvents[0] ??
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
        ? slot?.recipeName ?? slot?.meal?.main?.name ?? slot?.brunch?.main?.name ?? null
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
  };
}
