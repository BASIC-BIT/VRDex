import type {
  TimelineDetailRow,
  TimelineEventIdentity,
  TimelineRosterPage,
} from "../../../../../convex/_eventTimelineTypes";
export type DetailRosterState =
  | { kind: "loading" | "unavailable"; eventId: string | null }
  | { kind: "error"; eventId: string; error: unknown }
  | {
      kind: "available";
      eventId: string;
      rows: TimelineDetailRow[];
      host?: TimelineEventIdentity["host"];
      complete: boolean;
      loading: boolean;
      failed: boolean;
    };
export function detailRows(
  rows: ReadonlyArray<TimelineDetailRow>,
): TimelineDetailRow[] {
  const represented = new Set(
    rows.flatMap((row) =>
      row.kind !== "participant" && row.performer ? [row.performer.id] : [],
    ),
  );
  return [...new Map(rows.map((row) => [row.key, row])).values()]
    .filter((row) => {
      if (row.kind !== "participant" || !row.performer) return true;
      if (represented.has(row.performer.id)) return false;
      represented.add(row.performer.id);
      return true;
    })
    .sort(
      (a, b) =>
        Number(a.kind === "participant") - Number(b.kind === "participant") ||
        a.position - b.position ||
        (a.startAt ?? Infinity) - (b.startAt ?? Infinity) ||
        a.key.localeCompare(b.key),
    );
}
export function createDetailRosterController(
  read: (args: {
    eventId: string;
    cursor?: string;
  }) => Promise<TimelineRosterPage>,
) {
  let state: DetailRosterState = { kind: "loading", eventId: null };
  let generation = 0,
    cursor: string | undefined,
    rows: TimelineDetailRow[] = [];
  let running = false;
  const listeners = new Set<() => void>();
  const publish = (next: DetailRosterState) => {
    state = next;
    listeners.forEach((fn) => fn());
  };
  async function more() {
    if (
      running ||
      state.eventId === null ||
      state.kind === "unavailable" ||
      (state.kind === "available" && state.complete)
    )
      return;
    const token = generation,
      eventId = state.eventId;
    running = true;
    if (state.kind === "available")
      publish({ ...state, loading: true, failed: false });
    try {
      for (let budget = 0; budget < 10; budget++) {
        const page = await read({ eventId, cursor });
        if (token !== generation) return;
        if (page.detail?.kind !== "available") {
          rows = [];
          publish({ kind: "unavailable", eventId });
          return;
        }
        rows.push(...page.detail.rows);
        cursor = page.cursor ?? undefined;
        publish({
          kind: "available",
          eventId,
          rows: detailRows(rows),
          host: page.detail.host,
          complete: page.complete,
          loading: !page.complete && budget < 9,
          failed: false,
        });
        if (page.complete) break;
      }
    } catch (error) {
      if (token === generation)
        publish(
          state.kind === "available"
            ? { ...state, loading: false, failed: true }
            : { kind: "error", eventId, error },
        );
    } finally {
      if (token === generation) running = false;
    }
  }
  async function select(eventId: string | null, force = false) {
    if (!force && state.eventId === eventId) return;
    generation++;
    running = false;
    cursor = undefined;
    rows = [];
    publish({ kind: "loading", eventId });
    if (eventId !== null) await more();
  }
  return {
    select,
    more,
    refresh: () => select(state.eventId, true),
    getSnapshot: () => state,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    dispose: () => {
      generation++;
      running = false;
    },
  };
}
