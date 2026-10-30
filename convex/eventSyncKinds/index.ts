import type { ConnectorKind } from "../_eventConnectors";
import { googleCalendarHandler } from "./googleCalendar";
import type { SyncKindHandler } from "./types";

// Kind plans register one module each here.
export const syncKindHandlers: Record<ConnectorKind, SyncKindHandler> = {
  discord_announcements: {},
  discord_board: {},
  discord_scheduled_events: {},
  google_calendar: googleCalendarHandler,
  vrchat_calendar: {},
  notion: {},
};
