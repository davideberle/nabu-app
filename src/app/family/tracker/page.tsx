import Link from "next/link";
import type { Metadata } from "next";
import { auth, signOut } from "@/auth";
import {
  NabuBadge,
  NabuIconFrame,
  NabuLinkButton,
  NabuSectionHeader,
  NabuSurface,
  cn,
} from "@/components/ui/nabu";
import {
  type ComputedMilestone,
  formatMilestoneDate,
  getComputedMilestones,
} from "@/data/family";
import { isTrackerOnlyEmail } from "@/lib/access";

export const metadata: Metadata = {
  title: "Family Milestones — Nabu",
  description: "iPad family milestone tracker",
};

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

function kindIcon(m: ComputedMilestone): string {
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

function MilestoneRow({
  milestone,
  featured = false,
}: {
  milestone: ComputedMilestone;
  featured?: boolean;
}) {
  const tone = statusTone(milestone);

  return (
    <article
      className={cn(
        "grid min-h-[104px] min-w-0 grid-cols-[auto_1fr] items-start gap-4 rounded-lg border bg-primary p-4 shadow-xs dark:shadow-none",
        featured
          ? "border-utility-orange-200 bg-utility-orange-50/70 dark:border-utility-orange-700/60 dark:bg-utility-orange-950/20"
          : "border-primary",
      )}
    >
      <NabuIconFrame
        className={cn(
          "h-11 w-11 text-xl",
          featured
            ? "border-amber-200/70 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/20"
            : "bg-stone-100 dark:bg-stone-800",
        )}
      >
        {kindIcon(milestone)}
      </NabuIconFrame>
      <div className="min-w-0">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              className={cn(
                "truncate font-semibold tracking-normal text-primary",
                featured ? "text-xl sm:text-2xl" : "text-base",
              )}
            >
              {milestone.label}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-tertiary">
              {formatMilestoneDate(milestone.nextOccurrence)} ·{" "}
              {countLabel(milestone)}
            </p>
          </div>
          <NabuBadge tone={tone} className="shrink-0">
            {daysLabel(milestone.daysUntil)}
          </NabuBadge>
        </div>
        <p
          className={cn(
            "mt-3 text-sm font-medium",
            tone === "amber"
              ? "text-utility-warning-600 dark:text-utility-warning-400"
              : "text-quaternary",
          )}
        >
          {milestone.planningLabel}
        </p>
      </div>
    </article>
  );
}

function StatBlock({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: BadgeTone;
}) {
  return (
    <div className="rounded-lg border border-secondary bg-secondary p-4">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-quaternary">
        {label}
      </p>
      <div className="mt-3 flex items-end justify-between gap-3">
        <p className="text-3xl font-semibold tracking-normal text-primary">
          {value}
        </p>
        <NabuBadge tone={tone}>{label}</NabuBadge>
      </div>
    </div>
  );
}

export default async function FamilyTrackerPage() {
  const session = await auth();
  const trackerOnly = isTrackerOnlyEmail(session?.user?.email);
  const milestones = getComputedMilestones();
  const [next, ...later] = milestones;
  const planning = milestones.filter((m) => m.planningStatus === "planning-window");
  const upcoming = milestones.filter((m) => m.planningStatus === "upcoming");

  return (
    <main className="min-h-screen overflow-x-hidden bg-secondary px-4 py-5 text-primary sm:px-6 sm:py-7">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 pb-12">
        <header className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <Link href="/family/tracker" className="flex min-w-0 items-center gap-3">
            <NabuIconFrame className="h-11 w-11 border-amber-200/70 bg-amber-50 text-xl dark:border-amber-900/50 dark:bg-amber-900/20">
              👨‍👩‍👧‍👦
            </NabuIconFrame>
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-quaternary">
                iPad tracker
              </p>
              <h1 className="truncate text-2xl font-semibold tracking-normal text-primary sm:text-3xl">
                Family milestones
              </h1>
            </div>
          </Link>

          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            {!trackerOnly ? (
              <NabuLinkButton href="/" tone="secondary" size="sm">
                Dashboard
              </NabuLinkButton>
            ) : null}
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button
                type="submit"
                className="h-8 rounded-full border border-primary bg-primary px-3 text-xs font-medium text-quaternary shadow-xs transition-colors hover:text-secondary dark:shadow-none"
              >
                Sign out
              </button>
            </form>
          </div>
        </header>

        <section className="grid min-w-0 gap-4 lg:grid-cols-[1.45fr_0.55fr]">
          {next ? <MilestoneRow milestone={next} featured /> : null}
          <NabuSurface tone="muted" className="p-4">
            <NabuSectionHeader eyebrow="At a glance" />
            <div className="mt-3 grid grid-cols-2 gap-3">
              <StatBlock
                label="Planning"
                value={planning.length.toString()}
                tone={planning.length > 0 ? "amber" : "stone"}
              />
              <StatBlock
                label="Upcoming"
                value={upcoming.length.toString()}
                tone={upcoming.length > 0 ? "blue" : "stone"}
              />
            </div>
          </NabuSurface>
        </section>

        {planning.length > 0 ? (
          <section>
            <NabuSectionHeader
              className="mb-3"
              eyebrow="Planning now"
              title="Milestones inside their planning window"
            />
            <div className="grid min-w-0 gap-3 md:grid-cols-2">
              {planning.map((milestone) => (
                <MilestoneRow key={milestone.id} milestone={milestone} />
              ))}
            </div>
          </section>
        ) : null}

        <section>
          <NabuSectionHeader
            className="mb-3"
            eyebrow="Timeline"
            title="Next family dates"
          />
          <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {later.map((milestone) => (
              <MilestoneRow key={milestone.id} milestone={milestone} />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
