import type { ConnectorKind } from "../_eventConnectors";
import { discordBoardHandler } from "./discordBoard";
import { discordScheduledEventsHandler } from "./discordScheduledEvents";
import { googleCalendarHandler } from "./googleCalendar";
import type { SyncKindHandler } from "./types";

// VRChat group calendar (plan 09).
import { vrchatCalendarHandler } from "./vrchatCalendar";

// Kind plans register one module each here.
export const syncKindHandlers: Record<ConnectorKind, SyncKindHandler> = {
  discord_announcements: {},
  discord_board: discordBoardHandler,
  discord_scheduled_events: discordScheduledEventsHandler,
  google_calendar: googleCalendarHandler,
  vrchat_calendar: vrchatCalendarHandler,
  notion: {},
};
