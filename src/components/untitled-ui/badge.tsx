"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cx } from "@/lib/untitled-ui/cx";

export type UntitledBadgeColor =
  | "gray"
  | "brand"
  | "error"
  | "warning"
  | "success"
  | "blue"
  | "purple"
  | "orange";

export type UntitledBadgeSize = "sm" | "md" | "lg";

const filledColors: Record<UntitledBadgeColor, string> = {
  gray: "bg-utility-neutral-50 text-utility-neutral-700 ring-utility-neutral-200",
  brand: "bg-utility-brand-50 text-utility-brand-700 ring-utility-brand-200",
  error: "bg-utility-red-50 text-utility-red-700 ring-utility-red-200",
  warning: "bg-utility-yellow-50 text-utility-yellow-700 ring-utility-yellow-200",
  success: "bg-utility-green-50 text-utility-green-700 ring-utility-green-200",
  blue: "bg-utility-blue-50 text-utility-blue-700 ring-utility-blue-200",
  purple: "bg-utility-purple-50 text-utility-purple-700 ring-utility-purple-200",
  orange: "bg-utility-orange-50 text-utility-orange-700 ring-utility-orange-200",
};

const sizes: Record<UntitledBadgeSize, string> = {
  sm: "px-2 py-0.5 text-xs font-medium",
  md: "px-2.5 py-0.5 text-sm font-medium",
  lg: "px-3 py-1 text-sm font-medium",
};

export function UntitledBadge({
  children,
  color = "gray",
  size = "sm",
  className,
  ...props
}: ComponentPropsWithoutRef<"span"> & {
  children: ReactNode;
  color?: UntitledBadgeColor;
  size?: UntitledBadgeSize;
}) {
  return (
    <span
      {...props}
      className={cx(
        "inline-flex size-max max-w-full items-center whitespace-nowrap rounded-full ring-1 ring-inset",
        sizes[size],
        filledColors[color],
        className,
      )}
    >
      {children}
    </span>
  );
}
