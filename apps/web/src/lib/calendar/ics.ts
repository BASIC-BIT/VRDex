export type PublicCalendarEvent = {
  slug: string;
  title: string;
  startAt: number;
  endAt?: number;
  summary?: string;
  communityName?: string;
  worlds: Array<{
    displayName: string;
  }>;
};

type CreatePublicEventIcsOptions = {
  canonicalUrl: string;
  now?: number;
};

const ICS_PRODUCT_ID = "-//VRDex//Public Event Calendar//EN";
const ICS_LINE_OCTET_LIMIT = 75;

const textEncoder = new TextEncoder();

export function escapeIcsText(value: string): string {
  return value
    .replace(/\u0000/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

export function foldIcsLine(line: string): string {
  if (textEncoder.encode(line).length <= ICS_LINE_OCTET_LIMIT) {
    return line;
  }

  const segments: string[] = [];
  let current = "";
  let currentOctets = 0;

  for (const character of line) {
    const characterOctets = textEncoder.encode(character).length;
    const segmentLimit = segments.length === 0 ? ICS_LINE_OCTET_LIMIT : ICS_LINE_OCTET_LIMIT - 1;

    if (current !== "" && currentOctets + characterOctets > segmentLimit) {
      segments.push(current);
      current = character;
      currentOctets = characterOctets;
      continue;
    }

    current += character;
    currentOctets += characterOctets;
  }

  if (current !== "") {
    segments.push(current);
  }

  return segments.map((segment, index) => (index === 0 ? segment : ` ${segment}`)).join("\r\n");
}

export function formatIcsUtcTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp)) {
    throw new Error("Calendar timestamp must be finite.");
  }

  const date = new Date(timestamp);
  const year = date.getUTCFullYear().toString().padStart(4, "0");
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  const hours = date.getUTCHours().toString().padStart(2, "0");
  const minutes = date.getUTCMinutes().toString().padStart(2, "0");
  const seconds = date.getUTCSeconds().toString().padStart(2, "0");

  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

export function publicEventIcsFilename(slug: string): string {
  const basename = slug.replace(/[^a-z0-9-]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

  return `${basename || "event"}.ics`;
}

export function createPublicEventIcs(event: PublicCalendarEvent, options: CreatePublicEventIcsOptions): string {
  const canonicalUrl = safeHttpUrl(options.canonicalUrl);

  if (canonicalUrl === null) {
    throw new Error("Calendar export URL must be an absolute HTTP URL.");
  }

  const location = event.worlds.map((world) => world.displayName).filter(Boolean).join(", ") || event.communityName;
  const description = event.summary ? `${event.summary}\n\n${canonicalUrl}` : canonicalUrl;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    property("PRODID", ICS_PRODUCT_ID),
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    property("UID", `${event.slug}@${new URL(canonicalUrl).host}`, { escapeValue: false }),
    property("DTSTAMP", formatIcsUtcTimestamp(options.now ?? Date.now()), { escapeValue: false }),
    property("DTSTART", formatIcsUtcTimestamp(event.startAt), { escapeValue: false }),
    ...optionalEndAtLine(event),
    "STATUS:CONFIRMED",
    property("SUMMARY", event.title),
    property("DESCRIPTION", description),
    ...optionalTextProperty("LOCATION", location),
    property("URL", canonicalUrl, { escapeValue: false }),
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

function optionalEndAtLine(event: PublicCalendarEvent): string[] {
  if (event.endAt === undefined || event.endAt <= event.startAt) {
    return [];
  }

  return [property("DTEND", formatIcsUtcTimestamp(event.endAt), { escapeValue: false })];
}

function optionalTextProperty(name: string, value: string | undefined): string[] {
  return value === undefined || value.trim() === "" ? [] : [property(name, value)];
}

function property(name: string, value: string, options: { escapeValue?: boolean } = {}): string {
  return `${name}:${options.escapeValue === false ? value : escapeIcsText(value)}`;
}

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);

    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
