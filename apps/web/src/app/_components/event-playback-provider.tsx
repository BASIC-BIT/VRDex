"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex-generated-api";
import { EventPlaybackOwner } from "@/lib/event-playback-owner";
import { createRetainedPlaybackAdapter } from "@/lib/event-playback-adapters";
import {
  eventPlaybackRequest,
  profilePlaybackRequest,
} from "@/lib/event-playback-request";
import { retainPlaybackAuthorization } from "@/lib/event-playback-revalidation";
import {
  relayPlaybackEnabled,
  retainForegroundGrant,
} from "@/lib/relay-playback-adapter";
import { EventCompactPlayer } from "./event-compact-player";

const Context = createContext<EventPlaybackOwner | null>(null);
export function useEventPlayback() {
  return useContext(Context);
}
export function useEventPlaybackSnapshot(owner: EventPlaybackOwner) {
  return useSyncExternalStore(
    owner.subscribe,
    owner.getSnapshot,
    owner.getSnapshot,
  );
}

/** Root owner and mount survive route/auth changes. Presentation never reparents media. */
export function EventPlaybackProvider({ children }: { children: ReactNode }) {
  const mount = useRef<HTMLDivElement>(null);
  const [owner] = useState(
    () =>
      new EventPlaybackOwner((request, notify, mode) => {
        if (!mount.current) throw new Error("Playback mount unavailable");
        if (relayPlaybackEnabled()) {
          const url = process.env.NEXT_PUBLIC_CONVEX_URL;
          if (!url) throw Error("Playback unavailable");
          const client = new ConvexHttpClient(url);
          return createRetainedPlaybackAdapter(request, mount.current, notify, {
            mode,
            relay: {
              open: (context, streamId, preferredMode) =>
                client.mutation(api.mediaRelayPlayback.openPlayback, {
                  context,
                  streamId,
                  preferredMode,
                }),
              get: (grantId) =>
                client.query(api.mediaRelayPlayback.getPlayback, { grantId }),
              refresh: (grantId) =>
                client.mutation(api.mediaRelayPlayback.refreshPlayback, {
                  grantId,
                }),
              release: (grantId) =>
                client.mutation(api.mediaRelayPlayback.releasePlayback, {
                  grantId,
                }),
            },
          });
        }
        return createRetainedPlaybackAdapter(request, mount.current, notify, {
          mode,
        });
      }),
  );
  const state = useEventPlaybackSnapshot(owner);
  const generation = owner.generation;
  const active = Boolean(state.request);
  useEffect(() => () => owner.close(), [owner]);
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url || !state.request) return;
    const client = new ConvexHttpClient(url);
    const active = state.request;
    return retainPlaybackAuthorization(owner, async (slug) =>
      "profileId" in active && active.kind === "vrcdn"
        ? profilePlaybackRequest(
            await client.query(api.profiles.getPublicBySlug, { slug }),
            active.sourceId,
          )
        : eventPlaybackRequest(
            await client.query(api.events.getPublicBySlug, { slug }),
          ),
    );
    // Metadata refreshes must not restart the revalidation loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, generation]);
  useEffect(() => {
    if (!relayPlaybackEnabled() || !active) return;
    return retainForegroundGrant(
      owner,
      document,
      () => document.visibilityState === "visible",
    );
  }, [owner, generation, active]);
  return (
    <Context.Provider value={owner}>
      {children}
      <EventCompactPlayer owner={owner} state={state} mount={mount} />
    </Context.Provider>
  );
}
