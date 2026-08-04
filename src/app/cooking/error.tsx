"use client";

// Focused error boundary for /cooking.
//
// The cook is standing at the stove. A single malformed historical session row
// — a legacy shape, a hand-edited field, a recipe lookup that throws — must not
// turn this page into a blank error screen with nothing to cook from. The page
// itself already degrades a bad row to the empty state (see page.tsx); this is
// the backstop for anything the render path cannot anticipate, and it keeps the
// route recoverable with a retry instead of dead.

import Link from "next/link";
import { useEffect } from "react";
import { NabuButton, NabuEmptyState, NabuHeader, NabuMain, NabuPageShell } from "@/components/ui/nabu";

export default function CookingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[cooking] page render failed:", error);
  }, [error]);

  return (
    <NabuPageShell>
      <NabuHeader
        title="Live Cooking"
        eyebrow="Today’s meal"
        backHref="/"
        maxWidth="3xl"
      />
      <NabuMain maxWidth="3xl" className="space-y-6">
        <NabuEmptyState
          icon="🍳"
          title="Tonight’s session could not be opened"
          description={
            <>
              Something in today’s cooking session could not be read. The recipe
              data itself is untouched. Try again, plan the meal in the{" "}
              <Link href="/meals" className="underline hover:text-secondary">
                meal planner
              </Link>
              , or ask Nabu on Telegram for live cooking help.
            </>
          }
          action={
            <NabuButton type="button" tone="secondary" onClick={reset}>
              Try again
            </NabuButton>
          }
        />
      </NabuMain>
    </NabuPageShell>
  );
}
