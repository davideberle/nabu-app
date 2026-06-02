import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { UntitledBadge, type UntitledBadgeColor } from "@/components/untitled-ui/badge";
import { UntitledButton } from "@/components/untitled-ui/button";

type MaxWidth = "3xl" | "5xl" | "6xl";
type ButtonTone = "primary" | "secondary" | "ghost" | "danger";
type BadgeTone = "stone" | "green" | "amber" | "blue" | "violet" | "red";
type SurfaceTone = "default" | "muted" | "accent";

const maxWidthClass: Record<MaxWidth, string> = {
  "3xl": "max-w-3xl",
  "5xl": "max-w-5xl",
  "6xl": "max-w-6xl",
};

const badgeToneColor: Record<BadgeTone, UntitledBadgeColor> = {
  stone: "gray",
  green: "success",
  amber: "warning",
  blue: "blue",
  violet: "purple",
  red: "error",
};

const surfaceToneClass: Record<SurfaceTone, string> = {
  default: "border-primary bg-primary shadow-xs dark:shadow-none",
  muted: "border-secondary bg-secondary dark:shadow-none",
  accent:
    "border-utility-orange-200 bg-utility-orange-50/60 dark:border-utility-orange-700/60 dark:bg-utility-orange-950/20 dark:shadow-none",
};

export function cn(
  ...parts: Array<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(" ");
}

export function NabuPageShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-h-screen w-full overflow-x-hidden bg-secondary text-primary",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function NabuHeader({
  title,
  eyebrow,
  subtitle,
  icon,
  backHref,
  action,
  maxWidth = "5xl",
}: {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  icon?: ReactNode;
  backHref?: string;
  action?: ReactNode;
  maxWidth?: MaxWidth;
}) {
  return (
    <header className="border-b border-secondary bg-primary/80 backdrop-blur-xl">
      <div
        className={cn(
          maxWidthClass[maxWidth],
          "mx-auto flex w-full min-w-0 flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6",
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {backHref ? <NabuBackLink href={backHref} /> : null}
          {!backHref && icon ? <NabuIconFrame>{icon}</NabuIconFrame> : null}
          <div className="min-w-0">
            {eyebrow ? <NabuKicker>{eyebrow}</NabuKicker> : null}
            <h1 className="truncate text-lg font-semibold tracking-[-0.02em] text-primary sm:text-xl">
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-0.5 truncate text-xs text-tertiary">
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>
        {action ? <div className="flex max-w-full shrink-0 items-center">{action}</div> : null}
      </div>
    </header>
  );
}

export function NabuBackLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      aria-label="Back"
      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-primary bg-primary text-quaternary shadow-xs transition-colors hover:text-secondary"
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 19l-7-7 7-7" />
      </svg>
    </Link>
  );
}

export function NabuMain({
  children,
  maxWidth = "5xl",
  className,
}: {
  children: ReactNode;
  maxWidth?: MaxWidth;
  className?: string;
}) {
  return (
    <main className={cn(maxWidthClass[maxWidth], "mx-auto w-full min-w-0 px-4 py-5 sm:px-6 sm:py-7", className)}>
      {children}
    </main>
  );
}

export function NabuSurface({
  children,
  className,
  tone = "default",
  as = "section",
}: {
  children: ReactNode;
  className?: string;
  tone?: SurfaceTone;
  as?: "section" | "div" | "article";
}) {
  const Component = as;
  return (
    <Component
      className={cn(
        "min-w-0 max-w-full overflow-hidden rounded-lg border",
        surfaceToneClass[tone],
        className,
      )}
    >
      {children}
    </Component>
  );
}

export function NabuCard({
  children,
  className,
  href,
}: {
  children: ReactNode;
  className?: string;
  href?: string;
}) {
  const base = cn(
    "group min-w-0 max-w-full overflow-hidden rounded-lg border border-primary bg-primary p-4 shadow-xs transition-all dark:shadow-none",
    href && "hover:-translate-y-0.5 hover:border-secondary_hover hover:bg-primary_hover hover:shadow-md dark:hover:shadow-none",
    className,
  );

  if (href) {
    return (
      <Link href={href} className={base}>
        {children}
      </Link>
    );
  }

  return <div className={base}>{children}</div>;
}

export function NabuSectionHeader({
  eyebrow,
  title,
  description,
  action,
  className,
}: {
  eyebrow?: string;
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow ? <NabuKicker>{eyebrow}</NabuKicker> : null}
        {title ? (
          <h2 className="mt-0.5 text-base font-semibold tracking-[-0.02em] text-primary sm:text-lg">
            {title}
          </h2>
        ) : null}
        {description ? (
          <p className="mt-0.5 max-w-2xl text-sm leading-relaxed text-tertiary">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function NabuKicker({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-quaternary">
      {children}
    </p>
  );
}

export function NabuIconFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-primary bg-secondary text-lg shadow-xs",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function NabuBadge({
  children,
  tone = "stone",
  className,
  ...props
}: ComponentPropsWithoutRef<"span"> & {
  children: ReactNode;
  tone?: BadgeTone;
}) {
  return (
    <UntitledBadge {...props} color={badgeToneColor[tone]} size="sm" className={className}>
      {children}
    </UntitledBadge>
  );
}

export const NabuPill = NabuBadge;

export function NabuButton({
  children,
  tone = "primary",
  size = "md",
  className,
  ...props
}: ComponentPropsWithoutRef<"button"> & {
  tone?: ButtonTone;
  size?: "sm" | "md";
}) {
  return (
    <UntitledButton
      {...props}
      color={buttonColor(tone)}
      size={size === "sm" ? "xs" : "md"}
      isDisabled={props.disabled}
      className={cn("rounded-full", className)}
    >
      {children}
    </UntitledButton>
  );
}

export function NabuLinkButton({
  children,
  href,
  tone = "secondary",
  size = "md",
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<typeof Link>, "href"> & {
  href: string;
  tone?: ButtonTone;
  size?: "sm" | "md";
}) {
  return (
    <UntitledButton
      {...props}
      href={href}
      color={buttonColor(tone)}
      size={size === "sm" ? "xs" : "md"}
      className={cn("rounded-full", className)}
    >
      {children}
    </UntitledButton>
  );
}

function buttonColor(tone: ButtonTone): "primary" | "secondary" | "tertiary" | "tertiary-destructive" {
  switch (tone) {
    case "primary":
      return "primary";
    case "secondary":
      return "secondary";
    case "danger":
      return "tertiary-destructive";
    default:
      return "tertiary";
  }
}

export function NabuEmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <NabuSurface tone="muted" className={cn("px-6 py-12 text-center", className)}>
      {icon ? <div className="mb-3 text-4xl opacity-30">{icon}</div> : null}
      <h2 className="text-base font-semibold tracking-[-0.02em] text-primary">
        {title}
      </h2>
      {description ? (
        <div className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-quaternary">
          {description}
        </div>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </NabuSurface>
  );
}

export function NabuStat({
  label,
  value,
  tone = "stone",
}: {
  label: string;
  value: ReactNode;
  tone?: BadgeTone;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-secondary bg-secondary p-2.5">
      <p className="text-[10px] uppercase tracking-[0.14em] text-quaternary">
        {label}
      </p>
      <div className="mt-0.5 flex items-center gap-2 text-sm font-medium text-primary">
        <span className="min-w-0 truncate">{value}</span>
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", badgeDotClass(tone))} />
      </div>
    </div>
  );
}

function badgeDotClass(tone: BadgeTone): string {
  switch (tone) {
    case "green":
      return "bg-emerald-400";
    case "amber":
      return "bg-amber-400";
    case "blue":
      return "bg-blue-400";
    case "violet":
      return "bg-violet-400";
    case "red":
      return "bg-red-400";
    default:
      return "bg-utility-neutral-300 dark:bg-utility-neutral-600";
  }
}
