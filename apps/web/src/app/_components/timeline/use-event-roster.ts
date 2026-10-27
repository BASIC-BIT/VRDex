"use client";
import { useConvex } from "convex/react";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { api } from "@convex-generated-api";
import type { CanonicalEvent } from "@/lib/timeline/event-detail";
import {
  createDetailRosterController,
  type DetailRosterState,
} from "@/lib/timeline/detail-roster";
import {
  createSelectedSetController,
  type SelectedSetState,
} from "@/lib/timeline/selected-set";
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
  const selectedController = useMemo(
    () =>
      createSelectedSetController((reference) => {
        if (!client || !event)
          return Promise.reject(Error("Backend unavailable"));
        return client.query(api.eventTimeline.resolveSaved, {
          references: [reference],
        });
      }),
    [client, event],
  );
  const selectedSnapshot = useSyncExternalStore(
    selectedController.subscribe,
    selectedController.getSnapshot,
    selectedController.getSnapshot,
  );
  useEffect(() => {
    void selectedController.select(
      event && slotId ? { kind: "set", eventId: event.id, slotId } : null,
      true,
    );
    const refresh = () => {
      void selectedController.retry();
    };
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      selectedController.dispose();
      window.removeEventListener("focus", refresh);
      clearInterval(timer);
    };
  }, [selectedController, event, slotId]);
  // Do not expose the previous slot before the selection effect commits.
  const selectedRead: SelectedSetState =
    selectedSnapshot.kind !== "idle" &&
    selectedSnapshot.reference.eventId === event?.id &&
    selectedSnapshot.reference.slotId === slotId
      ? selectedSnapshot
      : { kind: "idle" };
  const state: DetailRosterState =
    snapshot.eventId === event?.id
      ? snapshot
      : { kind: "loading", eventId: event?.id ?? null };
  return {
    state,
    more: controller.more,
    retry: controller.refresh,
    selectedRead,
    retrySelected: selectedController.retry,
    selected: selectedRead.kind === "available" ? selectedRead.row : undefined,
  };
}
