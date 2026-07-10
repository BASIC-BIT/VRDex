import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@/lib/cn";

const entityCardVariants = cva("grid rounded-card border border-border bg-surface", {
  variants: {
    density: {
      compact: "gap-3 p-3 sm:grid-cols-[auto_minmax(0,1fr)]",
      default: "gap-4 p-card sm:grid-cols-[auto_minmax(0,1fr)]",
    },
  },
  defaultVariants: {
    density: "default",
  },
});

export type EntityCardProps = Omit<ComponentPropsWithoutRef<"article">, "title"> &
  VariantProps<typeof entityCardVariants> & {
    media?: ReactNode;
    title: ReactNode;
    href: string;
    description?: ReactNode;
    metadata?: ReactNode;
    actions?: ReactNode;
  };

export function EntityCard({
  actions,
  className,
  density,
  description,
  href,
  media,
  metadata,
  title,
  ...props
}: EntityCardProps) {
  return (
    <article className={cn(entityCardVariants({ density }), className)} {...props}>
      {media ? <div className="shrink-0">{media}</div> : null}
      <div className="min-w-0">
        <h3>
          <Link
            className="rounded-control text-entity text-foreground underline decoration-transparent underline-offset-4 transition hover:text-accent-strong hover:decoration-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            href={href}
          >
            {title}
          </Link>
        </h3>
        {description ? <div className="mt-2 text-body-sm text-muted">{description}</div> : null}
        {metadata ? <div className="mt-3">{metadata}</div> : null}
        {actions ? <div className="mt-4 flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </article>
  );
}
