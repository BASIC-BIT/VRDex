"use client";
import { useConvex } from "convex/react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { api } from "@convex-generated-api";
import type { CanonicalEvent } from "@/lib/timeline/event-detail";
import {
  createDetailRosterController,
  type DetailRosterState,
} from "@/lib/timeline/detail-roster";
import type { TimelineDetailRow } from "../../../../../../convex/_eventTimelineTypes";
const detailRange = { startAt: 0, endAt: 1, timeZone: "UTC" }; // Cursor scope only; detail mode reads the whole authored roster.
export function useEventRoster(event: CanonicalEvent | null, slotId?: string) {
  const client = useConvex();
  const controller = useMemo(
    () =>
      createDetailRosterController((args) => {
        if (!client || !event)
          return Promise.reject(Error("Backend unavailable"));
        return client.query(api.eventTimeline.listPublicRoster, {
          eventId: event.id,
          cursor: args.cursor,
          range: detailRange,
          detail: true,
        });
      }),
    [client, event],
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => {
    void controller.select(event?.id ?? null, true);
    const refresh = () => {
      void controller.refresh();
    };
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener("focus", refresh);
      clearInterval(timer);
      controller.dispose();
    };
  }, [controller, event]);
  const [selected, setSelected] = useState<{
    event: CanonicalEvent;
    slotId: string;
    row: TimelineDetailRow;
  } | null>(null);
  useEffect(() => {
    if (!client || !event || !slotId) return;
    let generation = 0;
    const refresh = () => {
      const token = ++generation;
      // Resolves a selected set even beyond the bounded automatic roster budget.
      void client
        .query(api.eventTimeline.resolveSaved, {
          references: [{ kind: "set", eventId: event.id, slotId }],
        })
        .then((results) => {
          if (token !== generation) return;
          const result = results[0];
          if (result?.kind !== "available" || !result.slot) {
            setSelected(null);
            return;
          }
          const slot = result.slot;
          setSelected({
            event,
            slotId,
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
        })
        .catch(() => {
          if (token === generation) setSelected(null);
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      generation++;
      window.removeEventListener("focus", refresh);
      clearInterval(timer);
    };
  }, [client, event, slotId]);
  const state: DetailRosterState =
    snapshot.eventId === event?.id
      ? snapshot
      : { kind: "loading", eventId: event?.id ?? null };
  return {
    state,
    more: controller.more,
    retry: controller.refresh,
    selected:
      selected?.event === event && selected?.slotId === slotId
        ? selected?.row
        : undefined,
  };
}
