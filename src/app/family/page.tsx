import {
  NabuBadge,
  NabuHeader,
  NabuIconFrame,
  NabuLinkButton,
  NabuMain,
  NabuPageShell,
  NabuSectionHeader,
  NabuStat,
  NabuSurface,
  cn,
} from "@/components/ui/nabu";
import {
  type ComputedMilestone,
  formatMilestoneDate,
  getComputedMilestones,
  getNextMilestone,
} from "@/data/family";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Family — Nabu",
  description: "Family milestones and planning prompts",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type BadgeTone = "stone" | "green" | "amber" | "blue" | "violet" | "red";

function statusTone(m: ComputedMilestone): BadgeTone {
  switch (m.planningStatus) {
    case "planning-window":
      return "amber";
    case "upcoming":
      return "blue";
    default:
      return "stone";
  }
}

function kindEmoji(m: ComputedMilestone): string {
  if (m.kind === "anniversary") return "💍";
  return m.isChild ? "🎂" : "🎉";
}

function countLabel(m: ComputedMilestone): string {
  if (m.kind === "anniversary") return `${ordinal(m.nextCount)} anniversary`;
  return `Turns ${m.nextCount}`;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function daysLabel(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `${days} days`;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function MilestoneCard({ m }: { m: ComputedMilestone }) {
  const tone = statusTone(m);

  return (
    <NabuSurface className="p-4 sm:p-5">
      <div className="flex min-w-0 items-start gap-3">
        <NabuIconFrame className="bg-stone-100 dark:bg-stone-800">
          {kindEmoji(m)}
        </NabuIconFrame>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <h3 className="min-w-0 truncate text-sm font-semibold tracking-[-0.01em] text-primary">
              {m.label}
            </h3>
            <NabuBadge tone={tone} className="shrink-0">
              {daysLabel(m.daysUntil)}
            </NabuBadge>
          </div>
          <p className="mt-1 text-xs text-tertiary">
            {formatMilestoneDate(m.nextOccurrence)} &middot; {countLabel(m)}
          </p>
          <p
            className={cn(
              "mt-2 text-xs font-medium",
              tone === "amber"
                ? "text-utility-warning-600 dark:text-utility-warning-400"
                : "text-quaternary",
            )}
          >
            {m.planningLabel}
          </p>
        </div>
      </div>
    </NabuSurface>
  );
}

function HeroStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: BadgeTone;
}) {
  return (
    <NabuStat label={label} value={value} tone={tone} />
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function FamilyPage() {
  const milestones = getComputedMilestones();
  const next = milestones[0] ?? null;

  const planningCount = milestones.filter(
    (m) => m.planningStatus === "planning-window",
  ).length;
  const upcomingCount = milestones.filter(
    (m) => m.planningStatus === "upcoming",
  ).length;

  return (
    <NabuPageShell>
      <NabuHeader
        title="Family"
        subtitle="Milestones and planning"
        icon="👨‍👩‍👧‍👦"
        backHref="/"
        action={
          <NabuLinkButton href="/family/tracker" tone="secondary" size="sm">
            iPad tracker
          </NabuLinkButton>
        }
      />

      <NabuMain className="space-y-6 pb-20">
        {/* Hero summary */}
        <section className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_0.6fr]">
          <NabuSurface tone="accent" className="p-4 sm:p-5">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <NabuSectionHeader
                  eyebrow="Next milestone"
                  title={
                    next
                      ? `${next.label} — ${daysLabel(next.daysUntil)}`
                      : "No upcoming milestones"
                  }
                  description={
                    next
                      ? `${formatMilestoneDate(next.nextOccurrence)} · ${countLabel(next)}`
                      : undefined
                  }
                />
              </div>
              <NabuIconFrame className="h-9 w-9 border-amber-200/60 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20">
                {next ? kindEmoji(next) : "📅"}
              </NabuIconFrame>
            </div>
          </NabuSurface>

          <NabuSurface tone="muted" className="p-4">
            <NabuSectionHeader eyebrow="Overview" />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <HeroStat
                label="Planning"
                value={planningCount.toString()}
                tone={planningCount > 0 ? "amber" : "stone"}
              />
              <HeroStat
                label="Upcoming"
                value={upcomingCount.toString()}
                tone={upcomingCount > 0 ? "blue" : "stone"}
              />
              <HeroStat
                label="Birthdays"
                value={milestones.filter((m) => m.kind === "birthday").length.toString()}
                tone="green"
              />
              <HeroStat
                label="Anniversaries"
                value={milestones.filter((m) => m.kind === "anniversary").length.toString()}
                tone="violet"
              />
            </div>
          </NabuSurface>
        </section>

        {/* Milestone list */}
        <section>
          <NabuSectionHeader
            className="mb-3"
            eyebrow="Milestones"
            title="Sorted by next occurrence"
          />

          <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {milestones.map((m) => (
              <MilestoneCard key={m.id} m={m} />
            ))}
          </div>
        </section>
      </NabuMain>
    </NabuPageShell>
  );
}
