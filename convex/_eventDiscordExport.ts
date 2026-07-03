import { createDiscordTimestampSet } from "./_discordTimestamps";
import type { PublicEvent } from "./_eventPublic";

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
  return `- ${cleanPublicText(link.label)}: ${cleanPublicText(link.url)}`;
}

export function formatDiscordEventPost({ canonicalUrl, event }: DiscordEventPostInput): string {
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
