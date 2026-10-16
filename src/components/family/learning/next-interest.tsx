"use client";

// V6-11: "What do you want to do or learn next time?" — the child's own words, or an honest
// "weiss nicht" / "egal" / "lieber nicht sagen". Nothing is suggested, preselected or inferred.
// Used in every normal closing (reflection) and once at the next entry after an early exit.

import { cn } from "@/components/ui/nabu";

export type InterestAnswer = { kind: "text" | "unsure" | "no-preference" | "declined"; text?: string | null };

export type NextInterestLabels = { prompt: string; hint: string; unsureLabel: string; noPreferenceLabel: string; declineLabel: string };

const chip = "inline-flex min-h-12 items-center justify-center rounded-2xl border border-primary bg-primary px-4 text-base font-medium text-primary transition-colors hover:bg-secondary disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500";

export function NextInterestQuestion({ labels, value, onChange, disabled, intro }: { labels: NextInterestLabels; value: InterestAnswer | null; onChange: (v: InterestAnswer | null) => void; disabled?: boolean; intro?: string }) {
  const text = value?.kind === "text" ? value.text ?? "" : "";
  const pick = (kind: InterestAnswer["kind"]) => onChange(value?.kind === kind ? null : { kind });
  return (
    <div className="grid gap-2" data-testid="next-interest" data-kind={value?.kind ?? ""}>
      {intro ? <p className="text-base text-primary">{intro}</p> : null}
      <label htmlFor="next-interest-text" className="text-lg font-semibold text-primary">
        {labels.prompt}
      </label>
      <p className="text-sm text-tertiary">{labels.hint}</p>
      <textarea
        id="next-interest-text"
        value={text}
        disabled={disabled}
        rows={2}
        maxLength={300}
        onChange={(e) => onChange(e.target.value.length ? { kind: "text", text: e.target.value } : null)}
        className="w-full rounded-2xl border border-primary bg-primary px-4 py-3 text-lg text-primary"
        data-testid="next-interest-text"
      />
      <div className="flex flex-wrap gap-2" role="group" aria-label="Oder eine dieser Antworten">
        {(
          [
            ["unsure", labels.unsureLabel],
            ["no-preference", labels.noPreferenceLabel],
            ["declined", labels.declineLabel],
          ] as const
        ).map(([kind, label]) => (
          <button key={kind} type="button" disabled={disabled} aria-pressed={value?.kind === kind} onClick={() => pick(kind)} className={cn(chip, value?.kind === kind && "ring-2 ring-stone-600 dark:ring-stone-200")} data-testid={`next-interest-${kind}`}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function interestReady(v: InterestAnswer | null): boolean {
  return !!v && (v.kind !== "text" || !!v.text?.trim());
}
