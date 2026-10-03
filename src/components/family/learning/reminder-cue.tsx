"use client";

// ---------------------------------------------------------------------------
// The one next-lesson reminder (world-first 2026-10-03; UX-5c; visual round 1
// V4): by default the concrete cue and the grounding sentence only; where it
// came from and how it retires sit behind a details disclosure. Rendered only
// when the server view carries a `reminder`; nothing is derived here.
// ---------------------------------------------------------------------------

import type { ReminderCue } from "@/lib/family-learning-feedback";
import type { HomePosition } from "./hands-keyboard";
import { MistakeVisualView } from "./visuals";

export function ReminderCueView({ reminder, fingers, home, compact = false }: { reminder: ReminderCue; fingers?: Record<string, string>; home?: HomePosition | null; compact?: boolean }) {
  return (
    <aside className="rounded-2xl border-2 border-dashed border-amber-400 bg-amber-50/80 px-4 py-3 dark:border-amber-600 dark:bg-amber-950/30" role="note" aria-label="Hinweis vom letzten Mal" data-testid="reminder" data-focus={reminder.focusId} data-kind={reminder.kind}>
      <p className="text-base font-semibold text-primary">
        <span className="mr-2 text-xs font-semibold uppercase tracking-[0.14em] text-amber-900/80 dark:text-amber-200/80">Hinweis</span>
        {reminder.cue}
      </p>
      <p className="mt-1 text-sm text-primary" data-testid="reminder-grounding">
        {reminder.grounding}
      </p>
      {!compact && reminder.visual && reminder.visual.kind !== "key" ? (
        <div className="mt-2">
          <MistakeVisualView visual={reminder.visual} fingers={fingers} home={home} />
        </div>
      ) : null}
      <details className="mt-1 text-xs text-tertiary">
        <summary className="cursor-pointer">Woher kommt der Hinweis?</summary>
        <p className="mt-1">Aus {reminder.openedIn.label}. Er verschwindet, wenn es in einer späteren Runde ohne Hilfe klappt.</p>
      </details>
    </aside>
  );
}
