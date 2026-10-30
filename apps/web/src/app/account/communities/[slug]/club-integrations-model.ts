import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex-generated-api";
import {
  allowedDirections,
  type ConnectorDirection,
  type ConnectorKind,
} from "../../../../../../../convex/_eventConnectorModel";

export type Connector = FunctionReturnType<
  typeof api.eventConnectors.listForCommunity
>["connectors"][number];

// notion never renders; the reserved kind cannot be created.
export const KIND_LABELS: Record<ConnectorKind, string> = {
  discord_board: "Event board",
  discord_scheduled_events: "Discord events",
  discord_announcements: "Discord",
  google_calendar: "Google Calendar",
  vrchat_calendar: "VRChat calendar",
  notion: "Notion",
};

export const DIRECTION_LABELS: Record<ConnectorDirection, string> = {
  import: "Import",
  export: "Export",
  bidirectional: "Both",
  off: "Off",
};

export const DIRECTION_HELP: Record<ConnectorDirection, string | null> = {
  import: "Events there appear here.",
  export: "Events here appear there.",
  bidirectional: "Changes on either side reach the other.",
  off: null,
};

export const MODE_LABELS: Record<Connector["mode"], string> = {
  hold: "Hold for review",
  autopublish: "Publish automatically",
};

export const STATE_LABELS: Record<Exclude<Connector["state"], "removed">, string> = {
  active: "Active",
  paused: "Paused",
  needs_reauth: "Needs reconnecting",
};

export function directionOptions(kind: ConnectorKind) {
  return allowedDirections(kind).map((value) => ({ value, label: DIRECTION_LABELS[value] }));
}

export function connectorTargetName({ target }: Connector) {
  return target.channelName ?? target.calendarName ?? target.groupName ?? target.guildName ?? null;
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
export function syncedLabel(lastSyncedAt: number | undefined, now: number): string | null {
  if (lastSyncedAt === undefined) return null;
  const seconds = Math.max(0, (now - lastSyncedAt) / 1000);
  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
    seconds < 60 ? [0, "second"]
    : seconds < 3600 ? [Math.floor(seconds / 60), "minute"]
    : seconds < 86400 ? [Math.floor(seconds / 3600), "hour"]
    : [Math.floor(seconds / 86400), "day"];
  return `Synced ${relative.format(-value, unit)}`;
}

export type GoogleCalendar = FunctionReturnType<typeof api.googleCalendarConnector.listCalendars>[number];
export function primaryFirst(calendars: readonly GoogleCalendar[]): GoogleCalendar[] {
  return [...calendars].sort((a, b) => Number(Boolean(b.primary)) - Number(Boolean(a.primary)));
}

export function connectedCalendarIds(connectors: readonly Pick<Connector, "kind" | "target">[]): string[] {
  return connectors.flatMap(({ kind, target }) =>
    kind === "google_calendar" && target.calendarId ? [target.calendarId] : []);
}

export function pickableCalendars(calendars: readonly GoogleCalendar[], connectedIds: readonly string[]) {
  return calendars.filter((calendar) => !connectedIds.includes(calendar.id));
}
