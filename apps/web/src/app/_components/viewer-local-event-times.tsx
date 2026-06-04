"use client";

import { useSyncExternalStore } from "react";

type ViewerLocalEventTimesProps = {
  timestamp: number;
  eventTimezone?: string;
};

const dateTimeOptions: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
};

function formatEventDate(timestamp: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en", { ...dateTimeOptions, timeZone }).format(new Date(timestamp));
  } catch {
    return new Intl.DateTimeFormat("en", dateTimeOptions).format(new Date(timestamp));
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
  return null;
}

export function ViewerLocalEventTime({ eventTimezone, timestamp }: ViewerLocalEventTimesProps) {
  const timeZone = useSyncExternalStore(subscribeToTimeZone, getBrowserTimeZone, getServerTimeZone);

  if (timeZone === null || !eventTimezone || eventTimezone === timeZone) {
    return null;
  }

  return (
    <span className="mt-1 block text-xs leading-5 text-muted">
      Your time: <time dateTime={new Date(timestamp).toISOString()}>{formatEventDate(timestamp, timeZone)}</time>
    </span>
  );
}
