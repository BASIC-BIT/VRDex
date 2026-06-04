"use client";

import { useSyncExternalStore } from "react";

type ViewerLocalEventTimesProps = {
  doorsOpenAt?: number;
  startAt: number;
  endAt?: number;
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

function timeZoneLabel(timeZone: string): string {
  return timeZone.replace(/_/g, " ");
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

function LocalTimeRow({ label, timestamp, timeZone }: { label: string; timestamp: number; timeZone: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium">
        <time dateTime={new Date(timestamp).toISOString()}>{formatEventDate(timestamp, timeZone)}</time>
      </dd>
    </div>
  );
}

export function ViewerLocalEventTimes({ doorsOpenAt, endAt, eventTimezone, startAt }: ViewerLocalEventTimesProps) {
  const timeZone = useSyncExternalStore(subscribeToTimeZone, getBrowserTimeZone, getServerTimeZone);

  return (
    <div className="mt-5 rounded-control border border-border bg-surface px-4 py-3">
      <p className="text-xs font-medium tracking-[0.18em] text-muted uppercase">Your local time</p>
      {timeZone === null ? (
        <p className="mt-3 text-sm leading-6 text-muted">Detecting browser time zone...</p>
      ) : (
        <>
          <dl className="mt-3 grid gap-2 text-sm">
            {doorsOpenAt === undefined ? null : <LocalTimeRow label="Doors open" timeZone={timeZone} timestamp={doorsOpenAt} />}
            <LocalTimeRow label="Start" timeZone={timeZone} timestamp={startAt} />
            {endAt === undefined ? null : <LocalTimeRow label="End" timeZone={timeZone} timestamp={endAt} />}
          </dl>
          <p className="mt-3 text-xs leading-5 text-muted">
            {eventTimezone === timeZone
              ? `Same as canonical event time zone (${timeZoneLabel(timeZone)}).`
              : `Detected browser time zone: ${timeZoneLabel(timeZone)}.`}
          </p>
        </>
      )}
    </div>
  );
}
