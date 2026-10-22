"use client";

import type { FunctionArgs, FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useId } from "react";
import { api } from "@convex-generated-api";

import { ViewerLocalEventDateTime } from "@/app/_components/viewer-local-event-times";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EntityImage } from "@/components/ui/entity-image";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { formatCalendarDate } from "@/lib/calendar/zoned-date-time";

export type EventInventoryRow = FunctionReturnType<typeof api.eventInventory.listPage>["page"][number];
export type EventInventoryCriteria = Omit<FunctionArgs<typeof api.eventInventory.listPage>, "paginationOpts">;
export type EventInventoryView = EventInventoryCriteria["view"];
export type EventInventoryContent =
  | { kind: "failed" }
  | { kind: "loading" | "ready"; rows: EventInventoryRow[]; hasMore: boolean };

export type EventInventoryControlsProps = {
  view: EventInventoryView;
  query: string;
  onViewChange: (view: EventInventoryView) => void;
  onQueryChange: (query: string) => void;
};

export type EventInventoryListProps = {
  content: EventInventoryContent;
  onLoadMore: () => void;
  onRetry: () => void;
};

const views = [
  { value: "all", label: "All" },
  { value: "upcoming", label: "Upcoming" },
  { value: "drafts", label: "Drafts" },
  { value: "past", label: "Past" },
] satisfies { value: EventInventoryView; label: string }[];

const stateLabels = {
  draft: "Draft", published: "Published", cancelled: "Cancelled", retracted: "Retracted",
} satisfies Record<EventInventoryRow["state"], string>;

function InventoryAction({ row, titleId }: { row: EventInventoryRow; titleId: string }) {
  const continuation = row.continuation;
  switch (continuation.kind) {
    case "staff_editor":
      return <Link aria-describedby={titleId} className={buttonVariants({ variant: "secondary", size: "sm" })} href={continuation.href}>{row.state === "draft" ? "Continue" : "Edit"}</Link>;
    case "intake_editor":
      return <Link aria-describedby={titleId} className={buttonVariants({ variant: "secondary", size: "sm" })} href={continuation.href}>Continue</Link>;
    case "public_event":
      return <Link aria-describedby={titleId} className={buttonVariants({ variant: "secondary", size: "sm" })} href={continuation.href}>View event</Link>;
    case "unavailable":
      return <span className="text-sm text-muted">Unavailable</span>;
    default: {
      const exhaustive: never = continuation;
      return exhaustive;
    }
  }
}

function InventoryRow({ row }: { row: EventInventoryRow }) {
  const titleId = useId();
  const title = row.title ?? "Untitled event";
  return (
    <li className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-x-4 gap-y-3 px-4 py-5 sm:grid-cols-[6rem_minmax(0,1fr)_auto] sm:items-center sm:gap-x-5 sm:px-5">
      <EntityImage alt="" className="aspect-[4/3] w-full rounded-control" label={title} sizes="96px" src={row.thumbnailUrl} />
      <div className="min-w-0">
        <h3 className="break-words text-base font-semibold sm:text-lg" id={titleId}>{title}</h3>
        {row.community ? <p className="mt-1 break-words text-sm text-muted">{row.community.displayName}</p> : null}
        {row.schedule.kind === "timed" ? <p className="mt-1 text-sm text-muted"><ViewerLocalEventDateTime timestamp={row.schedule.startAt} /></p>
          : row.schedule.kind === "date_only" ? <p className="mt-1 text-sm text-muted"><ViewerLocalEventDateTime scheduleKind="date_only" eventDate={row.schedule.eventDate} /></p>
            : row.schedule.eventDate ? <p className="mt-1 text-sm text-muted"><time dateTime={row.schedule.eventDate}>{formatCalendarDate(row.schedule.eventDate)}</time></p> : null}
      </div>
      <div className="col-start-2 flex flex-wrap items-center gap-3 sm:col-start-auto sm:justify-end sm:gap-6">
        <div className="text-sm sm:text-right">
          <p>{stateLabels[row.state]}</p>
          {row.kind === "intake_draft" ? <p className="mt-1 text-xs text-muted">Expires <ViewerLocalEventDateTime timestamp={row.expiresAt} /></p> : null}
        </div>
        <InventoryAction row={row} titleId={titleId} />
      </div>
    </li>
  );
}

export function EventInventoryControls({ view, query, onViewChange, onQueryChange }: EventInventoryControlsProps) {
  return <div className="flex flex-wrap items-end justify-between gap-4">
    <div aria-label="Event filters" className="grid w-full grid-cols-4 gap-1 sm:w-auto" role="group">
      {views.map(item => <Button aria-pressed={view === item.value} className={view === item.value ? "border-b-2 border-accent bg-surface-strong" : "border-b-2 border-transparent"} key={item.value} onClick={() => onViewChange(item.value)} variant="ghost">{item.label}</Button>)}
    </div>
    <Field className="w-full sm:max-w-xs">Find an event<Input maxLength={120} onChange={event => onQueryChange(event.currentTarget.value)} type="search" value={query} /></Field>
  </div>;
}

export function EventInventoryList({ content, onLoadMore, onRetry }: EventInventoryListProps) {
  return (
    <div className="grid min-w-0 gap-4">
      {content.kind === "failed" ? <Notice role="alert" variant="error">Unable to load this page.<Button className="ml-3" onClick={onRetry} size="sm">Retry</Button></Notice> : <>
        {content.rows.length > 0 ? <Card padding="none"><ul aria-busy={content.kind === "loading"} aria-label="My events" className="divide-y divide-border">{content.rows.map(row => <InventoryRow key={row.id} row={row} />)}</ul></Card> : null}
        <div aria-live="polite">
          {content.kind === "loading" ? <p aria-busy="true" className="text-sm text-muted">Loading events…</p> : null}
          {content.kind === "ready" && !content.hasMore && content.rows.length === 0 ? <Notice>No events</Notice> : null}
        </div>
        {content.hasMore ? <Button className="justify-self-start" disabled={content.kind === "loading"} onClick={onLoadMore}>Load more</Button> : null}
      </>}
    </div>
  );
}
