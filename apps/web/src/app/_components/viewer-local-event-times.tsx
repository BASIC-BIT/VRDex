"use client";

import { useSyncExternalStore } from "react";

import { cn } from "@/lib/cn";
import { formatCalendarDate } from "@/lib/calendar/zoned-date-time";

type ViewerLocalEventTimesProps = {
  timestamp: number;
  className?: string;
  timeZone?: string;
  showOffset?: boolean;
  showTimeZone?: boolean;
};

type ViewerLocalEventTimeRangeProps = {
  className?: string;
  endAt?: number;
  startAt: number;
  timeZone?: string;
  showOffset?: boolean;
  showTimeZone?: boolean;
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

function formatTimestamp(
  timestamp: number,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  try {
    return new Intl.DateTimeFormat("en", { ...options, timeZone }).format(
      new Date(timestamp),
    );
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

function useViewerTimeZone(explicitTimeZone?: string): string {
  const timeZone = useSyncExternalStore(
    subscribeToTimeZone,
    getBrowserTimeZone,
    getServerTimeZone,
  );

  return explicitTimeZone ?? timeZone ?? "UTC";
}

export function ViewerLocalEventDateTime({
  className,
  timestamp,
  eventDate,
  scheduleKind,
  timeZone: explicitTimeZone,
  showTimeZone = true,
}: {
  className?: string;
  timestamp?: number;
  eventDate?: string;
  scheduleKind?: "timed" | "date_only";
  timeZone?: string;
  showTimeZone?: boolean;
}) {
  const timeZone = useViewerTimeZone(explicitTimeZone);

  if (scheduleKind === "date_only" && eventDate !== undefined) {
    return (
      <time className={className} dateTime={eventDate}>
        {formatCalendarDate(eventDate)} · Time TBA
      </time>
    );
  }
  if (timestamp === undefined) return null;

  return (
    <time className={className} dateTime={new Date(timestamp).toISOString()}>
      {formatTimestamp(
        timestamp,
        timeZone,
        showTimeZone
          ? dateTimeOptions
          : { ...dateTimeOptions, timeZoneName: undefined },
      )}
    </time>
  );
}

export function ViewerLocalEventTime({
  className,
  timestamp,
  timeZone: explicitTimeZone,
  showOffset = false,
  showTimeZone = true,
}: ViewerLocalEventTimesProps) {
  const timeZone = useViewerTimeZone(explicitTimeZone);

  return (
    <time className={className} dateTime={new Date(timestamp).toISOString()}>
      {formatTimestamp(
        timestamp,
        timeZone,
        showOffset && showTimeZone
          ? { ...timeOptions, timeZoneName: "shortOffset" }
          : timeOptions,
      )}
    </time>
  );
}

export function ViewerLocalEventTimeRange({
  className,
  endAt,
  startAt,
  timeZone,
  showOffset,
  showTimeZone,
}: ViewerLocalEventTimeRangeProps) {
  return (
    <span className={cn(className)}>
      <ViewerLocalEventTime
        timestamp={startAt}
        timeZone={timeZone}
        showOffset={showOffset}
        showTimeZone={showTimeZone}
      />
      {endAt === undefined ? null : (
        <>
          {" - "}
          <ViewerLocalEventTime
            timestamp={endAt}
            timeZone={timeZone}
            showOffset={showOffset}
            showTimeZone={showTimeZone}
          />
        </>
      )}
    </span>
  );
}
