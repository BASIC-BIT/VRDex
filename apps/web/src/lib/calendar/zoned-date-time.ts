type DateTimeLocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

function parseDateTimeLocalParts(value: string, fieldName: string): DateTimeLocalParts {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (match === null) throw new Error(`${fieldName} must be a valid timestamp.`);

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
}

function formatDateTimeLocalParts(parts: DateTimeLocalParts): string {
  return `${parts.year}-${padDatePart(parts.month)}-${padDatePart(parts.day)}T${padDatePart(parts.hour)}:${padDatePart(parts.minute)}`;
}

function getZonedDateTimeParts(timestamp: number, timeZone: string): DateTimeLocalParts {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(timestamp));
  } catch {
    throw new Error("Time zone must be a valid IANA time zone.");
  }

  const valueByType = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(valueByType.get("year")),
    month: Number(valueByType.get("month")),
    day: Number(valueByType.get("day")),
    hour: Number(valueByType.get("hour")),
    minute: Number(valueByType.get("minute")),
  };
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

export function formatZonedDateTimeInput(
  timestamp: number | undefined,
  timeZone: string | undefined,
): string {
  if (timestamp === undefined) return "";
  return formatDateTimeLocalParts(getZonedDateTimeParts(timestamp, timeZone ?? browserTimeZone()));
}

export function parseZonedDateTimeInput(
  value: string,
  timeZone: string,
  fieldName: string,
): number {
  const parts = parseDateTimeLocalParts(value, fieldName);
  const wallTimeUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  let timestamp = wallTimeUtc;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const zonedParts = getZonedDateTimeParts(timestamp, timeZone);
    const zonedWallTimeUtc = Date.UTC(
      zonedParts.year,
      zonedParts.month - 1,
      zonedParts.day,
      zonedParts.hour,
      zonedParts.minute,
    );
    const nextTimestamp = timestamp + wallTimeUtc - zonedWallTimeUtc;
    if (nextTimestamp === timestamp) break;
    timestamp = nextTimestamp;
  }

  if (
    !Number.isFinite(timestamp) ||
    formatDateTimeLocalParts(getZonedDateTimeParts(timestamp, timeZone)) !==
      formatDateTimeLocalParts(parts)
  ) {
    throw new Error(`${fieldName} must be a valid local time in ${timeZone}.`);
  }

  return timestamp;
}
