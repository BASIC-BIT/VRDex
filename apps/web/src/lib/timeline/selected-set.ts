import type {
  PlanReference,
  SavedResolution,
  TimelineDetailRow,
} from "../../../../../convex/_eventTimelineTypes";

type SelectedReference = Extract<PlanReference, { kind: "set" }>;
export type SelectedSetState =
  | { kind: "idle" }
  | { kind: "loading" | "unavailable"; reference: SelectedReference }
  | { kind: "error"; reference: SelectedReference; error: unknown }
  | { kind: "available"; reference: SelectedReference; row: TimelineDetailRow };

/** The selected set has its own read lifetime and Retry, independent of roster pages. */
export function createSelectedSetController(
  read: (reference: SelectedReference) => Promise<SavedResolution[]>,
) {
  let state: SelectedSetState = { kind: "idle" };
  let generation = 0;
  const listeners = new Set<() => void>();
  const publish = (next: SelectedSetState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  async function select(reference: SelectedReference | null, force = false) {
    if (
      !force &&
      reference !== null &&
      state.kind !== "idle" &&
      state.reference.eventId === reference.eventId &&
      state.reference.slotId === reference.slotId
    )
      return;
    const token = ++generation;
    if (reference === null) {
      publish({ kind: "idle" });
      return;
    }
    publish({ kind: "loading", reference });
    try {
      const result = (await read(reference))[0];
      if (token !== generation) return;
      if (
        result?.kind !== "available" ||
        !result.slot ||
        result.slot.id !== reference.slotId ||
        result.slot.eventId !== reference.eventId
      ) {
        publish({ kind: "unavailable", reference });
        return;
      }
      const slot = result.slot;
      publish({
        kind: "available",
        reference,
        row: {
          kind: "slot",
          key: slot.id,
          position: Number.MAX_SAFE_INTEGER,
          displayLabel: slot.displayLabel,
          startAt: slot.schedule.startAt,
          ...(slot.schedule.kind === "timed"
            ? { endAt: slot.schedule.endAt }
            : {}),
          performer: slot.performer,
        },
      });
    } catch (error) {
      if (token === generation) publish({ kind: "error", reference, error });
    }
  }
  return {
    select,
    retry: () =>
      state.kind === "idle" ? Promise.resolve() : select(state.reference, true),
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      generation++;
    },
  };
}
