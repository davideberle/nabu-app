"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  NabuSurface,
  NabuKicker,
  NabuBadge,
  NabuButton,
} from "@/components/ui/nabu";
import type { WineBottle } from "@/data/wine-cellar";

type BottleWithStatus = WineBottle & { status: "available" | "out" };

export function WineBottleCard({ bottle }: { bottle: BottleWithStatus }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [optimisticStatus, setOptimisticStatus] = useState(bottle.status);
  const isOut = optimisticStatus === "out";

  async function toggle() {
    const action = isOut ? "mark-available" : "mark-out";
    setOptimisticStatus(isOut ? "available" : "out");
    const res = await fetch("/api/wine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bottleId: bottle.id, action }),
    });
    if (res.ok) {
      startTransition(() => {
        router.refresh();
      });
    } else {
      setOptimisticStatus(isOut ? "out" : "available");
    }
  }

  const pending = isPending;
  const colorAccent =
    bottle.color === "red"
      ? "from-red-950/10 via-stone-100 to-rose-950/20 dark:from-red-950/30 dark:via-stone-900 dark:to-rose-950/40"
      : bottle.color === "rosé"
        ? "from-pink-100 via-stone-50 to-rose-100 dark:from-pink-950/30 dark:via-stone-900 dark:to-rose-950/30"
        : "from-amber-50 via-stone-50 to-lime-50 dark:from-amber-950/20 dark:via-stone-900 dark:to-lime-950/20";

  return (
    <NabuSurface
      className={`grid overflow-hidden transition-opacity sm:grid-cols-[170px_minmax(0,1fr)] ${isOut ? "opacity-50" : ""}`}
    >
      <div
        className={`relative flex min-h-56 items-center justify-center overflow-hidden bg-gradient-to-br p-5 sm:min-h-full ${colorAccent}`}
      >
        <div className="absolute inset-x-8 bottom-5 h-6 rounded-full bg-black/10 blur-xl dark:bg-black/30" />
        {bottle.imageUrl ? (
          <img
            src={bottle.imageUrl}
            alt={`${bottle.wine} by ${bottle.producer}`}
            className="relative z-10 max-h-60 w-auto max-w-full object-contain drop-shadow-xl"
          />
        ) : (
          <span className="relative z-10 text-4xl opacity-60" aria-hidden="true">
            {bottle.color === "red" ? "🍷" : bottle.color === "rosé" ? "🌸" : "🥂"}
          </span>
        )}
      </div>

      <div className="p-5 sm:p-6">
        <div className="mb-4 flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <NabuKicker>
              {bottle.region}, {bottle.country}
            </NabuKicker>
            <h2 className="mt-1 text-xl font-semibold text-primary">
              {bottle.wine}
            </h2>
            <p className="mt-0.5 text-sm text-tertiary">{bottle.producer}</p>
            {bottle.grapes ? (
              <p className="mt-2 text-xs font-medium text-quaternary">
                {bottle.grapes}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <NabuBadge tone="stone">{bottle.vintage}</NabuBadge>
            {isOut ? (
              <NabuBadge tone="red">Out</NabuBadge>
            ) : (
              <NabuBadge tone="green">In stock</NabuBadge>
            )}
          </div>
        </div>

        <div className="mb-4 space-y-3">
          <p className="text-sm leading-6 text-tertiary">{bottle.style}</p>
          <div className="border-l-2 border-secondary pl-3">
            <span className="text-xs font-medium text-quaternary">Pairing lane</span>
            <p className="mt-1 text-sm leading-6 text-primary">
              {bottle.pairingUse}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <NabuBadge tone="blue">{bottle.appellation}</NabuBadge>
          <NabuBadge tone="stone">{bottle.color}</NabuBadge>
        </div>

        <div className="mt-5">
          <NabuButton
            tone={isOut ? "secondary" : "danger"}
            size="sm"
            disabled={pending}
            onClick={toggle}
          >
            {pending
              ? "Updating..."
              : isOut
                ? "Mark available"
                : "We're out"}
          </NabuButton>
        </div>
      </div>
    </NabuSurface>
  );
}
