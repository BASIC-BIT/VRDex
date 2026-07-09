import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export type EventScheduleItem = {
  id: string;
  title: string;
  time: string;
  href?: string;
  host?: string;
  world?: string;
  roleSummary?: string;
  summary?: string;
  meta?: string[];
  status?: "now" | "soon" | "later" | "past";
};

const scheduleItemVariants = cva(
  "grid gap-3 rounded-panel border bg-surface px-4 py-4 transition sm:grid-cols-[5.5rem_1fr] sm:gap-5",
  {
    variants: {
      status: {
        now: "border-accent/55 bg-accent-muted shadow-panel",
        soon: "border-info/35",
        later: "border-border",
        past: "border-border opacity-60",
      },
      interactive: {
        true: "hover:-translate-y-0.5 hover:border-border-strong hover:bg-surface-strong",
        false: "",
      },
    },
    defaultVariants: {
      status: "later",
      interactive: false,
    },
  },
);

function statusLabel(status: EventScheduleItem["status"]) {
  switch (status) {
    case "now":
      return "Now";
    case "soon":
      return "Soon";
    case "past":
      return "Past";
    default:
      return undefined;
  }
}

function EventScheduleRowContent({ item }: { item: EventScheduleItem }) {
  const label = statusLabel(item.status);
  const details = [item.host, item.world, item.roleSummary].filter(Boolean);

  return (
    <>
      <span className="font-mono text-sm leading-6 text-muted sm:pt-0.5">{item.time}</span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-lg font-semibold leading-6 text-foreground">{item.title}</span>
          {label ? (
            <span className="rounded-control border border-border bg-surface-strong px-2 py-0.5 text-xs text-muted">
              {label}
            </span>
          ) : null}
        </span>
        {details.length > 0 ? <span className="mt-2 block text-sm leading-5 text-muted">{details.join(" / ")}</span> : null}
        {item.summary ? <span className="mt-3 line-clamp-2 block text-sm leading-6 text-muted">{item.summary}</span> : null}
        {item.meta && item.meta.length > 0 ? (
          <span className="mt-3 flex flex-wrap gap-2">
            {item.meta.map((value) => (
              <span className="rounded-control bg-surface-muted px-2 py-1 text-xs text-subtle" key={value}>
                {value}
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </>
  );
}

export function EventScheduleRow({
  className,
  item,
}: {
  className?: string;
  item: EventScheduleItem;
}) {
  const rowClassName = cn(scheduleItemVariants({ interactive: Boolean(item.href), status: item.status }), className);

  if (item.href) {
    return (
      <Link className={rowClassName} href={item.href}>
        <EventScheduleRowContent item={item} />
      </Link>
    );
  }

  return (
    <div className={rowClassName}>
      <EventScheduleRowContent item={item} />
    </div>
  );
}

export function EventSchedule({
  children,
  className,
  emptyLabel = "No events are scheduled.",
  items,
}: {
  children?: ReactNode;
  className?: string;
  emptyLabel?: string;
  items: EventScheduleItem[];
}) {
  return (
    <section className={cn("grid gap-3", className)}>
      {children}
      {items.length === 0 ? (
        <div className="rounded-panel border border-dashed border-border bg-surface px-4 py-5 text-sm text-muted">
          {emptyLabel}
        </div>
      ) : (
        <div className="grid gap-2">
          {items.map((item) => (
            <EventScheduleRow item={item} key={item.id} />
          ))}
        </div>
      )}
    </section>
  );
}

export type EventScheduleRowProps = VariantProps<typeof scheduleItemVariants>;
