import Link from "next/link";
import Image from "next/image";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/cn";
import { NavUtilities } from "@/components/ui/nav-utilities";

// `px-4` below `sm`, because this gutter is the outermost of three: the shell,
// then a card, then the padding on each row inside it. Each is defensible alone,
// and together they left a phone-width panel about two thirds of the screen.
const pageShellVariants = cva("flex-1 px-4 py-8 text-foreground sm:px-10 lg:px-16", {
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
  showMyEvents = true,
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"nav"> & { accountMode?: "auto" | "signed-out"; showMyEvents?: boolean }) {
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
      <NavUtilities accountMode={accountMode} showMyEvents={showMyEvents} />
    </nav>
  );
}

export function BrandLink({ variant = "text" }: { variant?: "text" | "wordmark" }) {
  return (
    <Link
      className={variant === "wordmark"
        ? "inline-flex shrink-0 items-center rounded-control bg-media px-2 py-1 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        : "font-mono uppercase text-muted"}
      href="/"
    >
      {variant === "wordmark" ? (
        <Image
          alt="VRDex"
          className="h-auto w-[137px]"
          height={132}
          priority
          src="/brand/vrdex-wordmark.svg"
          unoptimized
          width={469}
        />
      ) : "VRDex"}
    </Link>
  );
}
