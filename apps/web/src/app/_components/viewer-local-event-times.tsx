"use client";

import { useSyncExternalStore } from "react";

import { cn } from "@/lib/cn";
import { formatCalendarDate } from "@/lib/calendar/zoned-date-time";

type ViewerLocalEventTimesProps = {
  timestamp: number;
  className?: string;
};

type ViewerLocalEventTimeRangeProps = {
  className?: string;
  endAt?: number;
  startAt: number;
};

const dateTimeOptions: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
};

const timeOptions: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
};

function formatTimestamp(timestamp: number, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat("en", { ...options, timeZone }).format(new Date(timestamp));
  } catch {
    return new Intl.DateTimeFormat("en", options).format(new Date(timestamp));
  }
}

function subscribeToTimeZone(onStoreChange: () => void): () => void {
  void onStoreChange;
  return () => undefined;
}

function getBrowserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function getServerTimeZone(): string | null {
  return "UTC";
}

function useViewerTimeZone(): string {
  const timeZone = useSyncExternalStore(subscribeToTimeZone, getBrowserTimeZone, getServerTimeZone);

  return timeZone ?? "UTC";
}

export function ViewerLocalEventDateTime({ className, timestamp, eventDate, scheduleKind }: {
  className?: string; timestamp?: number; eventDate?: string; scheduleKind?: "timed" | "date_only";
}) {
  const timeZone = useViewerTimeZone();

  if (scheduleKind === "date_only" && eventDate !== undefined) {
    return <time className={className} dateTime={eventDate}>{formatCalendarDate(eventDate)} · Time TBA</time>;
  }
  if (timestamp === undefined) return null;

  return (
    <time className={className} dateTime={new Date(timestamp).toISOString()}>
      {formatTimestamp(timestamp, timeZone, dateTimeOptions)}
    </time>
  );
}

export function ViewerLocalEventTime({ className, timestamp }: ViewerLocalEventTimesProps) {
  const timeZone = useViewerTimeZone();

  return (
    <time className={className} dateTime={new Date(timestamp).toISOString()}>
      {formatTimestamp(timestamp, timeZone, timeOptions)}
    </time>
  );
}

export function ViewerLocalEventTimeRange({ className, endAt, startAt }: ViewerLocalEventTimeRangeProps) {
  return (
    <span className={cn(className)}>
      <ViewerLocalEventTime timestamp={startAt} />
      {endAt === undefined ? null : (
        <>
          {" - "}
          <ViewerLocalEventTime timestamp={endAt} />
        </>
      )}
    </span>
  );
}
