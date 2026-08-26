import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import { Children, type ComponentPropsWithoutRef, type ReactNode } from "react";

import { cn } from "@/lib/cn";

export type EventScheduleStatus = "now" | "soon" | "later" | "past";

export type EventScheduleRowProps = Omit<ComponentPropsWithoutRef<"article">, "title"> &
  VariantProps<typeof scheduleItemVariants> & {
  time: ReactNode;
  title: ReactNode;
  href?: string;
  statusLabel?: ReactNode;
  details?: ReactNode;
  summary?: ReactNode;
  metadata?: ReactNode;
  action?: ReactNode;
};

const scheduleItemVariants = cva(
  "grid min-h-row-default gap-3 rounded-panel border bg-surface px-card py-card sm:grid-cols-[var(--spacing-schedule-gutter)_minmax(0,1fr)] sm:gap-5",
  {
    variants: {
      status: {
        now: "border-accent/55 bg-accent-muted shadow-panel",
        soon: "border-info/35",
        later: "border-border",
        past: "border-border opacity-60",
      },
    },
    defaultVariants: {
      status: "later",
    },
  },
);

export function EventScheduleRow({
  action,
  className,
  details,
  href,
  metadata,
  status,
  statusLabel,
  summary,
  time,
  title,
  ...props
}: EventScheduleRowProps) {
  const titleContent = href ? (
    <Link
      className="rounded-control text-section text-foreground underline decoration-transparent underline-offset-4 transition hover:text-accent-strong hover:decoration-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      href={href}
    >
      {title}
    </Link>
  ) : (
    <span className="text-section text-foreground">{title}</span>
  );

  return (
    <article className={cn(scheduleItemVariants({ status }), className)} {...props}>
      <span className="font-mono text-metadata text-muted sm:pt-0.5">{time}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            {titleContent}
            {statusLabel ? (
              <span className="rounded-control border border-border bg-surface-strong px-2 py-0.5 text-caption text-muted">
                {statusLabel}
              </span>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
        {details ? <div className="mt-2 text-body-sm text-muted">{details}</div> : null}
        {summary ? <div className="mt-3 line-clamp-2 text-body-sm text-muted">{summary}</div> : null}
        {metadata ? <div className="mt-3">{metadata}</div> : null}
      </div>
    </article>
  );
}

export function EventSchedule({
  children,
  className,
  empty,
}: {
  children: ReactNode;
  className?: string;
  empty?: ReactNode;
}) {
  const rows = Children.toArray(children).filter((child) => typeof child !== "boolean");
  const hasRows = rows.length > 0;

  return (
    <section className={cn("grid gap-3", className)}>
      {hasRows ? (
        <div className="grid gap-2">{rows}</div>
      ) : empty ? (
        <div className="rounded-panel border border-dashed border-border bg-surface px-4 py-5 text-sm text-muted">
          {empty}
        </div>
      ) : null}
    </section>
  );
}
