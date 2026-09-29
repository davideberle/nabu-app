import Link from "next/link";
import { cn } from "@/components/ui/nabu";
import type { ChildId } from "@/lib/family-assistant-turn";

// The honest "no mission prepared for this child" state (DESIGN §7.6: Isabel
// gets her own not-yet-prepared state and never sees Santiago's base). Shared
// by the cockpit and the mission workspace so a direct mission link or a child
// switch inside the mission shows the same truth — never a "temporary load
// failure" and never a claim that a base is saved.
export function ExpeditionNotPrepared({ child }: { child: ChildId }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link
        href={`/family/assistant?child=${child}`}
        className={cn("inline-flex min-h-12 items-center gap-2 rounded-full px-3 text-base text-tertiary hover:text-primary", "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500")}
      >
        <span aria-hidden>←</span> Home
      </Link>
      <div className="mt-6 rounded-3xl border border-primary bg-primary p-8 text-center" role="status">
        <span className="text-5xl" aria-hidden>
          🧭
        </span>
        <h1 className="mt-4 text-2xl font-semibold text-primary">Deine Expedition ist noch nicht vorbereitet</h1>
        <p className="mt-2 text-base text-tertiary">Für dich gibt es hier bald eine eigene Mission. Bis dahin kannst du Nabu Fragen stellen oder Hörspiele hören.</p>
      </div>
    </div>
  );
}
