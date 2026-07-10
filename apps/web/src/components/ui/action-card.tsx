import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/cn";

export const actionCardVariants = cva("group rounded-control border px-4 py-3 text-sm transition", {
  variants: {
    variant: {
      accent: "border-accent/35 bg-accent/10 hover:border-accent hover:bg-accent/15",
      surface: "border-border bg-surface-strong hover:border-accent",
    },
    padding: {
      sm: "px-3 py-2",
      md: "px-4 py-3",
      lg: "px-4 py-4",
    },
  },
  defaultVariants: {
    variant: "surface",
    padding: "md",
  },
});

export const actionLabelClassName =
  "block font-medium text-accent-strong underline decoration-accent/45 underline-offset-4 group-hover:decoration-accent";
export const actionMetaClassName = "mt-1 block text-xs text-muted";
export const inlineActionClassName =
  "font-semibold text-accent-strong underline decoration-accent/45 underline-offset-4 hover:decoration-accent";

export type ActionCardProps = ComponentPropsWithoutRef<"div"> & VariantProps<typeof actionCardVariants>;
export type ActionCardLinkProps = ComponentPropsWithoutRef<typeof Link> & VariantProps<typeof actionCardVariants>;

export function ActionCard({ className, padding, variant, ...props }: ActionCardProps) {
  return <div className={cn(actionCardVariants({ padding, variant }), className)} {...props} />;
}

export function ActionCardLink({ className, padding, variant, ...props }: ActionCardLinkProps) {
  return <Link className={cn(actionCardVariants({ padding, variant }), className)} {...props} />;
}

export function ActionCardLabel({ className, ...props }: ComponentPropsWithoutRef<"span">) {
  return <span className={cn(actionLabelClassName, className)} {...props} />;
}

export function ActionCardMeta({ className, ...props }: ComponentPropsWithoutRef<"span">) {
  return <span className={cn(actionMetaClassName, className)} {...props} />;
}
