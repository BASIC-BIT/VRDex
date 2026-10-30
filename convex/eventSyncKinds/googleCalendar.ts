import { listEvents, requireGoogleCalendarEnabled, withGoogleToken } from "../_googleCalendar";
import type { SyncKindHandler } from "./types";

export const googleCalendarHandler: SyncKindHandler = {
  async importPoll(ctx, connector) {
    requireGoogleCalendarEnabled();
    const calendarId = connector.target.calendarId;
    if (!connector.credentialId) throw new Error("CONNECTOR_CREDENTIAL");
    if (!calendarId) throw new Error("CONNECTOR_TARGET");
    await withGoogleToken(ctx, connector.credentialId, token => listEvents(token, calendarId, {}));
  },
};
