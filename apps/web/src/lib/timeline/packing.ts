import type { TimelineEvent, TimelineSchedule } from "../../../../../convex/_eventTimelineTypes";

type TimedSchedule = Extract<TimelineSchedule, { kind: "timed" }>;
type TimedItem = { key: string; schedule: TimedSchedule };
export type EventLane = { eventId: string; lane: number };
export type PlanLane = { key: string; lane: number; overlapping: boolean };

function isTimedInterval(schedule: TimelineSchedule): schedule is TimedSchedule {
  return schedule.kind === "timed" && Number.isFinite(schedule.startAt) && Number.isFinite(schedule.endAt) && schedule.endAt > schedule.startAt;
}

function chronological(a: TimedItem, b: TimedItem): number {
  return a.schedule.startAt - b.schedule.startAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

function assignLanes(items: TimedItem[], gap: number, previous: ReadonlyMap<string, number> = new Map()): Array<{ key: string; lane: number }> {
  const lanes = new Map<number, TimedSchedule[]>();
  for (const item of items) {
    const lane = previous.get(item.key);
    if (lane !== undefined) lanes.set(lane, [...(lanes.get(lane) ?? []), item.schedule]);
  }
  return items.map(({ key, schedule }) => {
    const priorLane = previous.get(key);
    if (priorLane !== undefined) return { key, lane: priorLane };
    let lane = 0;
    while (lanes.get(lane)?.some(other =>
      schedule.startAt < other.endAt + gap && other.startAt < schedule.endAt + gap,
    )) lane += 1;
    lanes.set(lane, [...(lanes.get(lane) ?? []), schedule]);
    return { key, lane };
  });
}

/** Pass previous assignments only for an unchanged window with later results appended. */
export function packEvents({ events, previous = [] }: {
  events: ReadonlyArray<Pick<TimelineEvent, "id" | "schedule">>;
  previous?: ReadonlyArray<EventLane>;
}): EventLane[] {
  const items: TimedItem[] = [];
  for (const event of events) {
    if (isTimedInterval(event.schedule)) items.push({ key: event.id, schedule: event.schedule });
  }
  items.sort(chronological);
  return assignLanes(items, 3_600_000, new Map(previous.map(({ eventId, lane }) => [eventId, lane])))
    .map(({ key, lane }) => ({ eventId: key, lane }));
}

export function packPlan({ items }: { items: ReadonlyArray<TimedItem> }): PlanLane[] {
  const sorted = items.filter(item => isTimedInterval(item.schedule)).sort(chronological);
  const conflicts = new Set<string>();
  for (let index = 0; index < sorted.length; index += 1) {
    const item = sorted[index];
    for (const other of sorted.slice(index + 1)) {
      if (other.schedule.startAt >= item.schedule.endAt) break;
      conflicts.add(item.key);
      conflicts.add(other.key);
    }
  }
  return assignLanes(sorted, 0).map(assignment => ({ ...assignment, overlapping: conflicts.has(assignment.key) }));
}
