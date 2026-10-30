import { createDiscordTimestampSet } from "../_discordTimestamps";
import { cleanPublicText, formatDiscordLineupLines } from "../_eventDiscordExport";
import type { PublicEvent } from "../_eventPublic";

/** A public event plus its absolute https page URL and artwork. */
export type PublicEventProjection = PublicEvent & { url: string; artworkImageUrl?: string };

export type DiscordEmbed = {
  title: string;
  url: string;
  description?: string;
  fields: Array<{ name: string; value: string }>;
  image?: { url: string };
};

// Discord embed limits: https://discord.com/developers/docs/resources/message#embed-object-embed-limits
const TITLE_LIMIT = 256;
const DESCRIPTION_LIMIT = 4096;
const FIELD_VALUE_LIMIT = 1024;
const EMBED_TOTAL_LIMIT = 6000;
const ELLIPSIS = "…";

function clip(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}${ELLIPSIS}` : value;
}

/** Joins rows by newline, dropping trailing rows for a final `…` row when the result would pass `limit`. */
function clipRows(rows: string[], limit: number): string {
  const joined = rows.join("\n");

  if (joined.length <= limit) {
    return joined;
  }

  const kept: string[] = [];
  let length = ELLIPSIS.length;

  for (const row of rows) {
    if (length + row.length + 1 > limit) {
      break;
    }

    kept.push(row);
    length += row.length + 1;
  }

  return [...kept, ELLIPSIS].join("\n");
}

export function renderEventEmbed(event: PublicEventProjection): DiscordEmbed {
  const title = clip(cleanPublicText(event.title), TITLE_LIMIT);
  const eventTime = event.scheduleKind === "date_only" || event.startAt === undefined ? undefined : createDiscordTimestampSet(event.startAt);
  const fields: DiscordEmbed["fields"] = [];
  const addField = (name: string, value: string) => {
    const cleaned = cleanPublicText(value);

    if (cleaned.length > 0) {
      fields.push({ name, value: clip(cleaned, FIELD_VALUE_LIMIT) });
    }
  };

  if (eventTime !== undefined) {
    addField("Time", `${eventTime.longDateTime} (${eventTime.relative})`);
  } else if (event.eventDate !== undefined) {
    addField("Date", `${event.eventDate} (Time TBA)`);
  }

  if (eventTime !== undefined && event.endAt !== undefined) {
    addField("End", createDiscordTimestampSet(event.endAt).shortDateTime);
  }

  addField("Host", event.communityName ?? "");

  const worlds = event.worlds.map((world) => cleanPublicText(world.displayName)).filter((world) => world.length > 0);

  if (worlds.length > 0) {
    addField(worlds.length === 1 ? "World" : "Worlds", worlds.join(", "));
  } else {
    addField("Venue", event.venueLabel ?? "");
  }

  const lineupLines = formatDiscordLineupLines(event);
  const rows = event.status === "cancelled"
    ? ["**Cancelled**", ...(lineupLines.length > 0 ? ["", ...lineupLines] : [])]
    : lineupLines;
  // Four short-named fields at most 1024 each plus a 256 title leave well over zero for the description.
  const fixedLength = title.length + fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);
  const description = clipRows(rows, Math.min(DESCRIPTION_LIMIT, EMBED_TOTAL_LIMIT - fixedLength));

  return {
    title,
    url: event.url,
    ...(description.length > 0 ? { description } : {}),
    fields,
    ...(event.artworkImageUrl !== undefined ? { image: { url: event.artworkImageUrl } } : {}),
  };
}
