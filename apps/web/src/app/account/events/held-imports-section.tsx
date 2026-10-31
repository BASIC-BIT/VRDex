"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useId, useState, type ComponentProps } from "react";
import { api } from "@convex-generated-api";

import { ViewerLocalEventDateTime } from "@/app/_components/viewer-local-event-times";
import { Button, buttonVariants } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Table, TableCell, TableFrame, TableHead, TableHeaderCell } from "@/components/ui/table";
import { formatCalendarDate } from "@/lib/calendar/zoned-date-time";
import { InventoryScheduleText } from "./event-inventory-list";

type HeldImportRow = FunctionReturnType<typeof api.eventInventory.listHeldImports>[number];
type HeldDraftRow = Exclude<HeldImportRow, { kind: "flag" }>;
type HeldFlagRow = Extract<HeldImportRow, { kind: "flag" }>;
type HeldChange = Extract<HeldImportRow, { kind: "update" }>["changes"][number];
type ReportFailure = (message: string | null) => void;

const heading = "Waiting for review";
const columns = ["Title", "Date", "Community", "Channel", "Author", "Source", "Actions"];
const changeLabels = {
  title: "Event title", eventDate: "Date", timeTba: "Time TBA", timezone: "Time zone", start: "Starts", end: "Ends", doors: "Doors",
  venueLabel: "Where", worldSlug: "World", summary: "Description", sourceUrl: "Source URL", lineup: "Lineup",
} satisfies Record<HeldChange["field"], string>;
const flagLabels = { source_deleted: "Discord post deleted", external_deleted: "Deleted at the source" } satisfies Record<HeldFlagRow["reason"], string>;

// An imported date is free text until it publishes; a bad one must not take My events down.
function dateText(value: string) {
  try { return formatCalendarDate(value); } catch { return value; }
}

function ChangeValue({ field, value }: { field: HeldChange["field"]; value: HeldChange["before"] }) {
  if (typeof value === "number") return <ViewerLocalEventDateTime timestamp={value} />;
  return field === "eventDate" && value !== null ? dateText(value) : value;
}

function HeldAction({ failure, onFailure, run, ...props }: ComponentProps<typeof Button> & { failure: string; onFailure: ReportFailure; run: () => Promise<unknown> }) {
  const [running, setRunning] = useState(false);
  const act = async () => {
    setRunning(true);
    onFailure(null);
    try { await run(); } catch { onFailure(failure); } finally { setRunning(false); }
  };
  return <Button disabled={running} onClick={() => void act()} size="sm" {...props} />;
}

function HeldDraft({ onFailure, row }: { onFailure: ReportFailure; row: HeldDraftRow }) {
  const titleId = useId();
  const publish = useMutation(api.eventIntakeHeld.publish);
  const dismiss = useMutation(api.eventIntakeHeld.dismiss);
  const { draftId } = row;
  return <tr>
    <TableCell>
      <div className="font-medium" id={titleId}>
        {row.kind === "update" ? <>Update to <Link className="underline" href={row.target.href}>{row.target.title}</Link></> : row.title ?? "Untitled event"}
      </div>
      {row.kind === "update" ? <ul className="mt-1 space-y-1 wrap-anywhere text-xs text-muted">
        {row.changes.map(({ field, before, after }) => <li key={field}>{changeLabels[field]}: <ChangeValue field={field} value={before} /> → <ChangeValue field={field} value={after} /></li>)}
      </ul> : null}
    </TableCell>
    <TableCell><InventoryScheduleText schedule={row.schedule} /></TableCell>
    <TableCell>{row.community.displayName}</TableCell>
    <TableCell>{row.targetName}</TableCell>
    <TableCell>{row.author}</TableCell>
    <TableCell>{row.sourceUrl ? <a aria-describedby={titleId} className="underline" href={row.sourceUrl} rel="noreferrer" target="_blank">Source</a> : null}</TableCell>
    <TableCell>
      <div className="flex gap-2">
        <Link aria-describedby={titleId} className={buttonVariants({ variant: "secondary", size: "sm" })} href={row.openHref}>Open</Link>
        <HeldAction aria-describedby={titleId} failure="Unable to publish." onFailure={onFailure} run={() => publish({ draftId })}>Publish</HeldAction>
        <HeldAction aria-describedby={titleId} failure="Unable to dismiss." onFailure={onFailure} run={() => dismiss({ draftId })} variant="ghost">Dismiss</HeldAction>
      </div>
    </TableCell>
  </tr>;
}

function HeldFlag({ onFailure, row }: { onFailure: ReportFailure; row: HeldFlagRow }) {
  const titleId = useId();
  const dismissFlag = useMutation(api.eventIntakeHeld.dismissFlag);
  return <tr>
    <TableCell><Link className="font-medium underline" href={row.href} id={titleId}>{row.title}</Link></TableCell>
    <TableCell colSpan={5}>{flagLabels[row.reason]}</TableCell>
    <TableCell><HeldAction aria-describedby={titleId} failure="Unable to keep." onFailure={onFailure} run={() => dismissFlag({ eventId: row.eventId })}>Keep</HeldAction></TableCell>
  </tr>;
}

export function HeldImportsSection() {
  const rows = useQuery(api.eventInventory.listHeldImports, {});
  const [failure, setFailure] = useState<string | null>(null);
  const [listed, setListed] = useState(rows);
  if (rows !== listed) {
    setListed(rows);
    setFailure(null);
  }
  if (!rows?.length) return null;
  return <section aria-labelledby="held-imports-heading" className="grid min-w-0 gap-3">
    <h3 className="text-lg font-semibold" id="held-imports-heading">{heading}</h3>
    <TableFrame>
      <Table className="min-w-[56rem]">
        <TableHead><tr>{columns.map(column => <TableHeaderCell key={column}>{column}</TableHeaderCell>)}</tr></TableHead>
        <tbody className="divide-y divide-border">
          {rows.map(row => row.kind === "flag"
            ? <HeldFlag key={`${row.eventId}:${row.reason}`} onFailure={setFailure} row={row} />
            : <HeldDraft key={row.draftId} onFailure={setFailure} row={row} />)}
        </tbody>
      </Table>
    </TableFrame>
    {failure ? <Notice role="alert" variant="error">{failure}</Notice> : null}
  </section>;
}
