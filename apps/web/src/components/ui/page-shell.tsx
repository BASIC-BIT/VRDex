import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/cn";

const pageShellVariants = cva("min-h-screen px-6 py-8 text-foreground sm:px-10 lg:px-16", {
  variants: {
    tone: {
      default: "bg-background",
      event: "bg-[linear-gradient(180deg,var(--background),var(--canvas-muted))]",
      world: "bg-[linear-gradient(180deg,var(--background),var(--canvas-muted))]",
    },
  },
  defaultVariants: {
    tone: "default",
  },
});

export type PageShellProps = ComponentPropsWithoutRef<"main"> & VariantProps<typeof pageShellVariants>;

export function PageShell({ className, tone, ...props }: PageShellProps) {
  return <main className={cn(pageShellVariants({ tone }), className)} {...props} />;
}

export function PageContainer({ className, max = "6xl", ...props }: ComponentPropsWithoutRef<"div"> & { max?: "3xl" | "4xl" | "5xl" | "6xl" | "7xl" }) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col gap-6",
        max === "3xl"
          ? "max-w-3xl"
          : max === "4xl"
            ? "max-w-4xl"
            : max === "5xl"
              ? "max-w-5xl"
              : max === "7xl"
                ? "max-w-7xl"
                : "max-w-6xl",
        className,
      )}
      {...props}
    />
  );
}

export function PageNav({ className, ...props }: ComponentPropsWithoutRef<"nav">) {
  return <nav className={cn("flex flex-wrap items-center justify-between gap-3 text-sm", className)} {...props} />;
}

export function BrandLink() {
  return (
    <Link className="font-mono uppercase tracking-[0.28em] text-muted" href="/">
      VRDex
    </Link>
  );
}
