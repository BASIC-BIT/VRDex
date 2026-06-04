import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/cn";

export const noticeVariants = cva("rounded-panel border px-4 py-3 text-sm leading-6", {
  variants: {
    variant: {
      info: "border-border bg-surface-strong text-muted",
      dashed: "border-dashed border-border bg-surface text-muted",
      success: "border-emerald-700/25 bg-emerald-50 text-emerald-950",
      warning: "border-amber-700/25 bg-amber-50 text-amber-950",
      error: "border-accent/35 bg-accent/10 text-accent-strong",
      inverse: "border-white/25 bg-white/14 text-white/78",
    },
  },
  defaultVariants: {
    variant: "info",
  },
});

export type NoticeProps = ComponentPropsWithoutRef<"div"> & VariantProps<typeof noticeVariants>;

export function Notice({ className, variant, ...props }: NoticeProps) {
  return <div className={cn(noticeVariants({ variant }), className)} {...props} />;
}
