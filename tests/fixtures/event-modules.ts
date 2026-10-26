import { resolveSyntheticAllocation } from "./event-capacity.mjs";

/** Real handlers with explicitly synthetic, nonproduction scheduling capacity. */
export async function loadFixtureEvents() {
  const events = await import("../../convex/events");
  return {
    ...events,
    scheduleEventMediaWorker: events.createScheduleEventMediaWorker(resolveSyntheticAllocation),
  };
}
