"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  NabuSurface,
  NabuKicker,
  NabuBadge,
  cn,
} from "@/components/ui/nabu";
import type {
  TravelCategory,
  TravelItemStatus,
} from "@/data/travel-san-sebastian";

type StatusMap = Record<string, TravelItemStatus>;

const STATUS_CYCLE: TravelItemStatus[] = ["idea", "planned", "done"];
const STATUS_LABEL: Record<TravelItemStatus, string> = {
  idea: "Idea",
  planned: "Planned",
  done: "Done",
};
const STATUS_TONE: Record<TravelItemStatus, "stone" | "amber" | "green"> = {
  idea: "stone",
  planned: "amber",
  done: "green",
};

function nextStatus(current: TravelItemStatus): TravelItemStatus {
  const idx = STATUS_CYCLE.indexOf(current);
  return STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
}

export function TravelBoard({
  categories,
  initialStates,
}: {
  categories: TravelCategory[];
  initialStates: StatusMap;
}) {
  const router = useRouter();
  const [states, setStates] = useState<StatusMap>(initialStates);
  const [isPending, startTransition] = useTransition();
  const [errorItemId, setErrorItemId] = useState<string | null>(null);

  async function cycleStatus(itemId: string) {
    setErrorItemId(null);
    const effectiveCurrent = states[itemId] ?? "idea";
    const next = nextStatus(effectiveCurrent);
    const hadStoredState = itemId in states;

    // Optimistic update
    setStates((prev) => ({ ...prev, [itemId]: next }));

    const res = await fetch("/api/travel/san-sebastian/state", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, status: next }),
    });

    if (res.ok) {
      startTransition(() => {
        router.refresh();
      });
    } else {
      // Revert
      setStates((prev) => {
        const reverted = { ...prev };
        if (hadStoredState) {
          reverted[itemId] = effectiveCurrent;
        } else {
          delete reverted[itemId];
        }
        return reverted;
      });
      setErrorItemId(itemId);
    }
  }

  // Category-level summary
  function categorySummary(cat: TravelCategory) {
    const planned = cat.items.filter(
      (i) => (states[i.id] ?? "idea") === "planned"
    ).length;
    const done = cat.items.filter(
      (i) => (states[i.id] ?? "idea") === "done"
    ).length;
    const parts: string[] = [];
    if (planned) parts.push(`${planned} planned`);
    if (done) parts.push(`${done} done`);
    return parts.length > 0 ? parts.join(", ") : null;
  }

  return (
    <div className="space-y-8">
      {categories.map((cat) => {
        const summary = categorySummary(cat);
        return (
          <section key={cat.id}>
            <div className="mb-3 flex min-w-0 items-end justify-between gap-2">
              <div className="min-w-0">
                <NabuKicker>
                  {cat.emoji} {cat.name}
                </NabuKicker>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-tertiary">
                  {cat.description}
                </p>
              </div>
              {summary ? (
                <span className="shrink-0 text-xs text-quaternary">
                  {summary}
                </span>
              ) : null}
            </div>

            <div className="space-y-2">
              {cat.items.map((item) => {
                const effectiveStatus: TravelItemStatus =
                  states[item.id] ?? "idea";
                const isDone = effectiveStatus === "done";
                const hasError = errorItemId === item.id;

                return (
                  <NabuSurface
                    key={item.id}
                    as="div"
                    className={cn(
                      "p-3 sm:p-4 transition-opacity",
                      isDone && "opacity-60"
                    )}
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      {/* Status button */}
                      <button
                        type="button"
                        onClick={() => cycleStatus(item.id)}
                        className={cn(
                          "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md border text-xs font-medium transition-colors",
                          effectiveStatus === "done"
                            ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                            : effectiveStatus === "planned"
                              ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                              : "border-stone-300 bg-stone-100 text-stone-500 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-400"
                        )}
                        aria-label={`Mark ${item.label} as ${nextStatus(effectiveStatus)}`}
                      >
                        {effectiveStatus === "done"
                          ? "✓"
                          : effectiveStatus === "planned"
                            ? "◆"
                            : "○"}
                      </button>

                      {/* Content */}
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className={cn(
                              "text-sm font-medium text-primary",
                              isDone && "line-through"
                            )}
                          >
                            {item.label}
                          </span>
                          <NabuBadge tone={STATUS_TONE[effectiveStatus]}>
                            {STATUS_LABEL[effectiveStatus]}
                          </NabuBadge>
                        </div>

                        {/* Meta row */}
                        {(item.timing || item.effort) && (
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-quaternary">
                            {item.timing ? (
                              <span>{item.timing}</span>
                            ) : null}
                            {item.effort ? (
                              <span>Effort: {item.effort}</span>
                            ) : null}
                          </div>
                        )}

                        {item.booking && (
                          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                            {item.booking}
                          </p>
                        )}

                        {item.note && (
                          <p className="mt-1 text-xs leading-relaxed text-tertiary">
                            {item.note}
                          </p>
                        )}

                        {hasError && (
                          <p className="mt-1 text-xs text-red-500">
                            Failed to save — tap again to retry
                          </p>
                        )}
                      </div>
                    </div>
                  </NabuSurface>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
