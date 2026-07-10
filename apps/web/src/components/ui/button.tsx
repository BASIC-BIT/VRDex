import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/cn";

export const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-control text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-60",
  {
    variants: {
      variant: {
        primary: "bg-accent !text-inverse hover:bg-accent-strong",
        secondary: "border border-border bg-surface-strong !text-foreground hover:border-border-strong hover:bg-surface-elevated",
        surface: "border border-border bg-surface !text-foreground hover:border-border-strong hover:bg-surface-strong",
        ghost: "!text-foreground hover:bg-surface-strong",
        inverse: "border border-white/25 bg-white/12 !text-white hover:bg-white/20",
        inversePrimary: "bg-white !text-inverse hover:bg-white/90",
      },
      size: {
        sm: "px-3 py-2",
        md: "px-4 py-2.5",
        lg: "px-5 py-3",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
);

export type ButtonProps = ComponentPropsWithoutRef<"button"> & VariantProps<typeof buttonVariants>;

export function Button({ className, size, variant, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ size, variant }), className)} {...props} />;
}
