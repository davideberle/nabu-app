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
  TravelItem,
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

/* ------------------------------------------------------------------ */
/*  Compact metadata chips                                             */
/* ------------------------------------------------------------------ */

function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-secondary bg-secondary px-1.5 py-0.5 text-[11px] leading-tight text-tertiary">
      {children}
    </span>
  );
}

function LinkChip({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-md border border-secondary bg-secondary px-1.5 py-0.5 text-[11px] leading-tight text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
    >
      {children}
      <svg className="h-2.5 w-2.5 shrink-0 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </a>
  );
}

function ItemMeta({ item }: { item: TravelItem }) {
  const chips: React.ReactNode[] = [];

  // Price
  if (item.price) {
    chips.push(<MetaChip key="price">{item.price}</MetaChip>);
  }

  // Michelin
  if (item.michelin) {
    chips.push(
      <span
        key="michelin"
        className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-1.5 py-0.5 text-[11px] leading-tight text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
      >
        {item.michelin}
      </span>
    );
  }

  // Google rating
  if (item.googleRating != null) {
    chips.push(
      <MetaChip key="rating">
        <span className="text-amber-500">&#9733;</span> {item.googleRating}
      </MetaChip>
    );
  }

  // Distance from home
  if (item.distanceFromHomeKm != null) {
    chips.push(
      <MetaChip key="dist">{item.distanceFromHomeKm < 1 ? `${item.distanceFromHomeKm * 1000}m` : `${item.distanceFromHomeKm} km`}</MetaChip>
    );
  }

  // Category tag
  if (item.categoryTag) {
    chips.push(
      <MetaChip key="cattag">{item.categoryTag}</MetaChip>
    );
  }

  // Hike stats
  if (item.hikeStats) {
    const h = item.hikeStats;
    chips.push(<MetaChip key="hlen">{h.lengthKm} km</MetaChip>);
    chips.push(<MetaChip key="hdur">{h.duration}</MetaChip>);
    chips.push(<MetaChip key="halt">+{h.altitudeGainM}m</MetaChip>);
    chips.push(<MetaChip key="hdist">{h.distanceFromHomeKm} km from home</MetaChip>);
  }

  // Excursion meta
  if (item.excursionMeta) {
    const e = item.excursionMeta;
    chips.push(<MetaChip key="etime">{e.timeNeeded}</MetaChip>);
    chips.push(<MetaChip key="edist">~{e.distanceKm} km</MetaChip>);
    for (const tag of e.tags) {
      chips.push(
        <MetaChip key={`etag-${tag}`}>{tag}</MetaChip>
      );
    }
  }

  // Hours / schedule
  if (item.hours) {
    chips.push(<MetaChip key="hours">{item.hours}</MetaChip>);
  }
  if (item.schedule) {
    chips.push(<MetaChip key="sched">{item.schedule}</MetaChip>);
  }

  // Links
  if (item.mapUrl) {
    chips.push(
      <LinkChip key="map" href={item.mapUrl}>Map</LinkChip>
    );
  }
  if (item.websiteUrl) {
    chips.push(
      <LinkChip key="web" href={item.websiteUrl}>Web</LinkChip>
    );
  }
  if (item.sourceUrl) {
    chips.push(
      <LinkChip key="src" href={item.sourceUrl}>
        {item.sourceLabel ?? "Source"}
      </LinkChip>
    );
  }

  if (chips.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {chips}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Board                                                              */
/* ------------------------------------------------------------------ */

export function TravelBoard({
  categories,
  initialStates,
}: {
  categories: TravelCategory[];
  initialStates: StatusMap;
}) {
  const router = useRouter();
  const [states, setStates] = useState<StatusMap>(initialStates);
  const [, startTransition] = useTransition();
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

                        {/* Rich metadata chips */}
                        <ItemMeta item={item} />

                        {item.note && (
                          <p className="mt-1.5 text-xs leading-relaxed text-tertiary">
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
