"use client";

import { useEffect, useState } from "react";

type CookEvent = {
  id: string;
  recipeId: string;
  cookedOn: string;
  source?: string;
  createdAt: string;
};

export default function CookingHistory({ recipeId }: { recipeId: string }) {
  const [events, setEvents] = useState<CookEvent[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadEvents() {
      try {
        const res = await fetch(`/api/cook-events?recipeId=${encodeURIComponent(recipeId)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setEvents(Array.isArray(data) ? data : []);
      } catch {
        // Cooking history is nice-to-have; recipe pages must stay renderable.
      }
    }

    loadEvents();
    return () => {
      cancelled = true;
    };
  }, [recipeId]);

  if (events.length === 0) return null;

  return (
    <section className="px-8 py-6 border-t border-stone-100 dark:border-stone-800">
      <h2 className="text-xs tracking-widest uppercase text-stone-400 dark:text-stone-500 mb-4">
        Cooking History
      </h2>
      <ul className="space-y-3">
        {events.map((event) => {
          const date = new Date(event.cookedOn + "T12:00:00");
          const formatted = date.toLocaleDateString("en-GB", {
            day: "numeric",
            month: "long",
            year: "numeric",
          });
          return (
            <li key={event.id} className="flex items-start gap-3">
              <span className="flex-shrink-0 mt-0.5 w-2 h-2 rounded-full bg-stone-300 dark:bg-stone-600" />
              <div>
                <span className="text-sm font-medium text-stone-600 dark:text-stone-300">
                  {formatted}
                </span>
                {event.source && (
                  <span className="ml-2 text-xs text-stone-400 dark:text-stone-500">
                    {event.source}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
