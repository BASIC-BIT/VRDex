import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/cn";
import { NavUtilities } from "@/components/ui/nav-utilities";

const pageShellVariants = cva("min-h-screen px-6 py-8 text-foreground sm:px-10 lg:px-16", {
  variants: {
    tone: {
      default: "bg-background",
      public: "bg-[linear-gradient(180deg,var(--background),var(--canvas-muted))]",
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

export function PageNav({
  accountMode = "auto",
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"nav"> & { accountMode?: "auto" | "signed-out" }) {
  return (
    <nav
      className={cn(
        // `min-h-16` rather than padding around whatever the page put here.
        // The bar's height was the tallest child plus `py-3`, so it changed
        // between routes: a page with no nav buttons sat shorter than one with
        // them, and the account control growing 40px → 42px when auth resolved
        // shifted the whole page down. A floor taller than any control makes
        // the bar the same height everywhere, and `flex-wrap` still lets a
        // crowded nav grow onto a second row on narrow viewports.
        "sticky top-0 z-40 -mx-3 flex min-h-16 flex-wrap items-center gap-3 border-b border-border bg-background/90 px-3 py-2 text-sm backdrop-blur",
        className,
      )}
      {...props}
    >
      {children}
      <NavUtilities accountMode={accountMode} />
    </nav>
  );
}

export function BrandLink() {
  return (
    <Link className="font-mono uppercase text-muted" href="/">
      VRDex
    </Link>
  );
}
