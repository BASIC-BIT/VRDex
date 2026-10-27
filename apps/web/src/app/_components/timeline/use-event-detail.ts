"use client";
import { useConvex } from "convex/react";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { api } from "@convex-generated-api";
import {
  createEventDetailController,
  type DetailState,
} from "@/lib/timeline/event-detail";
export function useEventDetail({ slug }: { slug: string | null }) {
  const client = useConvex();
  const controller = useMemo(
    () =>
      createEventDetailController((selectedSlug, observer) => {
        if (!client) throw Error("Backend unavailable");
        const watch = client.watchQuery(api.events.getPublicBySlug, {
          slug: selectedSlug,
        });
        const update = () => {
          try {
            const value = watch.localQueryResult();
            if (value !== undefined) observer.value(value);
          } catch (error) {
            observer.error(error);
          }
        };
        const stop = watch.onUpdate(update);
        update();
        return stop;
      }),
    [client],
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => {
    controller.select(slug);
    return controller.dispose;
  }, [controller, slug]);
  // Effects run after paint: never render a prior event for a new selection.
  const state: DetailState =
    snapshot.slug === slug ? snapshot : { kind: "loading", slug };
  return { ...state, retry: controller.retry };
}
