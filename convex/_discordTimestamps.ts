export const DISCORD_TIMESTAMP_STYLES = ["t", "T", "d", "D", "f", "F", "R"] as const;

export type DiscordTimestampStyle = (typeof DISCORD_TIMESTAMP_STYLES)[number];

export type DiscordTimestampSet = {
  shortTime: string;
  longTime: string;
  shortDate: string;
  longDate: string;
  shortDateTime: string;
  longDateTime: string;
  relative: string;
};

const discordTimestampStyles = new Set<string>(DISCORD_TIMESTAMP_STYLES);

export function toDiscordTimestamp(timestampMs: number, style: DiscordTimestampStyle = "f"): string {
  if (!Number.isFinite(timestampMs)) {
    throw new Error("Discord timestamp source must be a valid timestamp.");
  }

  if (!discordTimestampStyles.has(style)) {
    throw new Error("Discord timestamp style is not supported.");
  }

  return `<t:${Math.floor(timestampMs / 1_000)}:${style}>`;
}

export function createDiscordTimestampSet(timestampMs: number): DiscordTimestampSet {
  return {
    shortTime: toDiscordTimestamp(timestampMs, "t"),
    longTime: toDiscordTimestamp(timestampMs, "T"),
    shortDate: toDiscordTimestamp(timestampMs, "d"),
    longDate: toDiscordTimestamp(timestampMs, "D"),
    shortDateTime: toDiscordTimestamp(timestampMs, "f"),
    longDateTime: toDiscordTimestamp(timestampMs, "F"),
    relative: toDiscordTimestamp(timestampMs, "R"),
  };
}
