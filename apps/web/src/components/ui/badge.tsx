import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/cn";

export const badgeVariants = cva("inline-flex items-center rounded-control px-3 py-1 text-xs", {
  variants: {
    variant: {
      default: "border border-border bg-surface-strong text-foreground",
      muted: "border border-border bg-surface-muted text-muted",
      accent: "bg-accent-muted font-medium text-accent-strong",
      inverse: "bg-white/15 text-white/82",
      inverseMuted: "bg-white/12 text-white/76",
      cyan: "bg-info/14 text-info-strong",
    },
    shape: {
      square: "rounded-control",
      pill: "rounded-full",
    },
    mono: {
      true: "font-mono uppercase tracking-[0.18em]",
      false: "",
    },
  },
  defaultVariants: {
    variant: "default",
    shape: "square",
    mono: false,
  },
});

export type BadgeProps = ComponentPropsWithoutRef<"span"> & VariantProps<typeof badgeVariants>;

export function Badge({ className, mono, shape, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ mono, shape, variant }), className)} {...props} />;
}
