"use client";

import type { AnchorHTMLAttributes, ButtonHTMLAttributes, DetailedHTMLProps, ReactNode } from "react";
import Link from "next/link";
import { cx, sortCx } from "@/lib/untitled-ui/cx";

export const untitledButtonStyles = sortCx({
  common: {
    root: [
      "group relative inline-flex h-max cursor-pointer items-center justify-center whitespace-nowrap outline-brand transition duration-100 ease-linear before:absolute focus-visible:outline-2 focus-visible:outline-offset-2",
      "disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
    ].join(" "),
  },
  sizes: {
    xs: "gap-1 rounded-lg px-2.5 py-1.5 text-sm font-semibold before:rounded-[7px]",
    sm: "gap-1 rounded-lg px-3 py-2 text-sm font-semibold before:rounded-[7px]",
    md: "gap-1 rounded-lg px-3.5 py-2.5 text-sm font-semibold before:rounded-[7px]",
    lg: "gap-1.5 rounded-lg px-4 py-2.5 text-md font-semibold before:rounded-[7px]",
    xl: "gap-1.5 rounded-lg px-4.5 py-3 text-md font-semibold before:rounded-[7px]",
  },
  colors: {
    primary: [
      "bg-brand-solid text-white shadow-xs-skeuomorphic ring-1 ring-transparent ring-inset hover:bg-brand-solid_hover",
      "before:absolute before:inset-px before:border before:border-white/12 before:mask-b-from-0%",
    ].join(" "),
    secondary: "bg-primary text-secondary shadow-xs-skeuomorphic ring-1 ring-primary ring-inset hover:bg-primary_hover hover:text-secondary_hover",
    tertiary: "text-tertiary hover:bg-primary_hover hover:text-tertiary_hover",
    "primary-destructive": [
      "bg-error-solid text-white shadow-xs-skeuomorphic ring-1 ring-transparent outline-error ring-inset hover:bg-error-solid_hover",
      "before:absolute before:inset-px before:border before:border-white/12 before:mask-b-from-0%",
    ].join(" "),
    "tertiary-destructive": "text-error-primary outline-error hover:bg-error-primary hover:text-error-primary_hover",
  },
});

type Size = keyof typeof untitledButtonStyles.sizes;
type Color = keyof typeof untitledButtonStyles.colors;

interface CommonProps {
  size?: Size;
  color?: Color;
  isDisabled?: boolean;
  children: ReactNode;
  className?: string;
}

type ButtonProps = CommonProps &
  DetailedHTMLProps<Omit<ButtonHTMLAttributes<HTMLButtonElement>, "color">, HTMLButtonElement>;

type AnchorProps = CommonProps &
  DetailedHTMLProps<Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "color">, HTMLAnchorElement> & {
    href: string;
  };

export type UntitledButtonProps = ButtonProps | AnchorProps;

/**
 * Local FREE Untitled UI button primitive, copied/adapted from @untitleduico/react (MIT).
 * Simplified for this Next.js app: no React Aria dependency, same style contract.
 */
export function UntitledButton({
  size = "sm",
  color = "primary",
  isDisabled,
  children,
  className,
  ...props
}: UntitledButtonProps) {
  const classes = cx(
    untitledButtonStyles.common.root,
    untitledButtonStyles.sizes[size],
    untitledButtonStyles.colors[color],
    className,
  );

  if ("href" in props) {
    const { href, ...anchorProps } = props;
    return (
      <Link
        {...anchorProps}
        href={isDisabled ? "#" : href}
        aria-disabled={isDisabled || undefined}
        className={classes}
      >
        <span data-text className="px-0.5 transition-inherit-all">
          {children}
        </span>
      </Link>
    );
  }

  return (
    <button {...props} disabled={isDisabled || props.disabled} className={classes}>
      <span data-text className="px-0.5 transition-inherit-all">
        {children}
      </span>
    </button>
  );
}
