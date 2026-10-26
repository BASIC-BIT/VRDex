import { fixtureCapacityResolver } from "../scripts/_event-allocation-fixture.mjs";

export async function loadEventsWithFixtureCapacity() {
  const events = await import("../../convex/events");
  return {
    ...events,
    scheduleEventMediaWorker: events.createScheduleEventMediaWorker(fixtureCapacityResolver),
  };
}
