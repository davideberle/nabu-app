"use client";

// ---------------------------------------------------------------------------
// Chess Coach launch surface. Embeds the Game Studio-owned pilot bundle
// (vendored at /games/adaptive-chess-coach) in a sandboxed iframe, matching
// Game Studio's own iframe safety model (`allow-scripts allow-same-origin` —
// same-origin is needed so the game can keep its per-child learning profile in
// localStorage; the source is same-origin static content, so this grants no
// cross-origin reach). The validated child id is passed to the game, which
// namespaces its storage by that id.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { cn } from "@/components/ui/nabu";
import { assistantProfileById } from "@/data/family-assistant";
import { childShellDestinationHref, type ChildId } from "@/lib/family-child-shell";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500";

export function ChessCoachClient({ child }: { child: ChildId }) {
  const profile = assistantProfileById(child);
  const gameSrc = `/games/adaptive-chess-coach/index.html?child=${encodeURIComponent(child)}`;

  return (
    <div className="flex h-dvh flex-col bg-secondary text-primary">
      <header className="flex items-center justify-between gap-3 border-b border-primary px-3 py-2">
        <Link
          href={childShellDestinationHref("rewards", child)}
          className={cn(
            "inline-flex min-h-11 items-center gap-2 rounded-full border border-primary bg-primary px-4 py-2 text-sm font-medium text-secondary transition-colors hover:bg-secondary",
            focusRing,
          )}
        >
          ← Rewards
        </Link>
        <p className="text-sm font-semibold">
          {profile ? `${profile.displayName}'s Chess Coach` : "Chess Coach"}
        </p>
        <span aria-hidden className="min-h-11 w-[88px]" />
      </header>

      <iframe
        title="Chess Coach"
        src={gameSrc}
        className="w-full flex-1 border-0"
        sandbox="allow-scripts allow-same-origin"
        allow="fullscreen"
      />
    </div>
  );
}
