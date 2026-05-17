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
      ? "from-rose-900/20 to-rose-950/40"
      : bottle.color === "rosé"
        ? "from-pink-200/20 to-pink-300/30"
        : "from-amber-100/20 to-amber-200/30";

  return (
    <NabuSurface
      className={`overflow-hidden transition-opacity ${isOut ? "opacity-50" : ""}`}
    >
      {/* Image area / placeholder */}
      {bottle.imageUrl ? (
        <img
          src={bottle.imageUrl}
          alt={`${bottle.wine} by ${bottle.producer}`}
          className="h-36 w-full object-cover"
        />
      ) : (
        <div
          className={`flex h-36 w-full items-center justify-center bg-gradient-to-br ${colorAccent}`}
        >
          <span className="text-4xl opacity-60" aria-hidden="true">
            {bottle.color === "red" ? "🍷" : bottle.color === "rosé" ? "🌸" : "🥂"}
          </span>
        </div>
      )}

      <div className="p-5 sm:p-6">
      <div className="mb-3 flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <NabuKicker>
            {bottle.region}, {bottle.country}
          </NabuKicker>
          <h2 className="mt-1 text-lg font-semibold tracking-[-0.02em] text-primary">
            {bottle.wine}
          </h2>
          <p className="mt-0.5 text-sm text-tertiary">{bottle.producer}</p>
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

      <div className="mb-3 space-y-2">
        <p className="text-sm leading-6 text-tertiary">{bottle.style}</p>
        <div className="rounded-xl border border-secondary bg-secondary p-3">
          <span className="text-xs font-medium text-quaternary">
            Pairs with
          </span>
          <p className="mt-0.5 text-sm leading-5 text-primary">
            {bottle.pairingUse}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <NabuBadge tone="blue">{bottle.appellation}</NabuBadge>
        <NabuBadge tone="stone">{bottle.color}</NabuBadge>
      </div>

      <div className="mt-4">
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
