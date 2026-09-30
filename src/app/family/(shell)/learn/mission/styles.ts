import { cn } from "@/components/ui/nabu";

// Shared button styles for the mission workspace and its redesign stages.
export const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500";
export const primaryButton = cn(
  "inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-stone-900 px-6 text-lg font-semibold text-white shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none motion-reduce:hover:translate-y-0 dark:bg-stone-100 dark:text-stone-900",
  focusRing,
);
export const secondaryButton = cn(
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-primary bg-primary px-5 text-base font-medium text-primary transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
  focusRing,
);
export const chipButton = cn(
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-primary bg-primary px-4 text-lg font-medium text-primary transition-colors hover:bg-secondary disabled:opacity-50 motion-reduce:transition-none",
  focusRing,
);
