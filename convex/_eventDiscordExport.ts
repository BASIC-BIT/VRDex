import { createDiscordTimestampSet } from "./_discordTimestamps";
import type { PublicEvent } from "./_eventPublic";
import { vrcdnPlaybackHref } from "./_vrcdnLinks";

export type DiscordEventPostInput = {
  event: PublicEvent;
  canonicalUrl: string;
};

function cleanPublicText(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}

function optionalPublicText(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const cleaned = cleanPublicText(value);
  return cleaned.length === 0 ? undefined : cleaned;
}

function formatLabelSuffix(label: string): string {
  const cleaned = cleanPublicText(label);
  return cleaned.length > 0 && cleaned !== "Performer" ? ` - ${cleaned}` : "";
}

function formatSlotRange(slot: PublicEvent["slots"][number]): string {
  const start = slot.discord.shortTime;

  if (slot.endAt === undefined) {
    return start;
  }

  return `${start}-${createDiscordTimestampSet(slot.endAt).shortTime}`;
}

function formatSlotLine(slot: PublicEvent["slots"][number]): string {
  return `- ${formatSlotRange(slot)} - ${cleanPublicText(slot.displayLabel)}${formatLabelSuffix(slot.roleLabel)}`;
}

function formatParticipantLine(participant: PublicEvent["participants"][number]): string {
  return `- ${cleanPublicText(participant.displayName)}${formatLabelSuffix(participant.roleLabel)}`;
}

function formatMediaLinkLine(link: PublicEvent["mediaLinks"][number]): string {
  // Resolved rather than printed as stored. This is plain text pasted into
  // Discord, so unlike the web renderers there is nothing downstream to turn a
  // `vrcdn:<id>` back into a destination -- it would arrive as an opaque,
  // unclickable token where a playable address belongs.
  const url = vrcdnPlaybackHref(link.url) ?? link.url;

  return `- ${cleanPublicText(link.label)}: ${cleanPublicText(url)}`;
}

export function formatDiscordEventPost({ canonicalUrl, event }: DiscordEventPostInput): string | null {
  if (event.status === "cancelled") {
    return null;
  }

  const eventTime = createDiscordTimestampSet(event.startAt);
  const lines = [
    `**${cleanPublicText(event.title)}**`,
    cleanPublicText(canonicalUrl),
    "",
  ];
  const host = optionalPublicText(event.communityName);
  const worlds = event.worlds
    .map((world) => cleanPublicText(world.displayName))
    .filter((world) => world.length > 0);

  if (host !== undefined) {
    lines.push(`Host: ${host}`);
  }

  if (worlds.length > 0) {
    lines.push(`${worlds.length === 1 ? "World" : "Worlds"}: ${worlds.join(", ")}`);
  }

  lines.push(`Time: ${eventTime.longDateTime} (${eventTime.relative})`);

  if (event.doorsOpenAt !== undefined) {
    lines.push(`Doors: ${createDiscordTimestampSet(event.doorsOpenAt).shortDateTime}`);
  }

  if (event.endAt !== undefined) {
    lines.push(`End: ${createDiscordTimestampSet(event.endAt).shortDateTime}`);
  }

  const lineupLines = event.slots.length > 0
    ? event.slots.map(formatSlotLine)
    : event.participants.map(formatParticipantLine);

  if (lineupLines.length > 0) {
    lines.push("", "Lineup:", ...lineupLines);
  }

  const linkLines = event.mediaLinks.map(formatMediaLinkLine);

  if (linkLines.length > 0) {
    lines.push("", "Links:", ...linkLines);
  }

  return lines.join("\n");
}
