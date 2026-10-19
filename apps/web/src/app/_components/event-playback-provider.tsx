"use client";
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex-generated-api";
import { EventPlaybackOwner } from "@/lib/event-playback-owner";
import { createEventPlaybackAdapter } from "@/lib/event-playback-adapters";
import { eventPlaybackRequest } from "@/lib/event-playback-request";
import { retainPlaybackAuthorization } from "@/lib/event-playback-revalidation";
import { EventCompactPlayer } from "./event-compact-player";

const Context = createContext<EventPlaybackOwner | null>(null);
export function useEventPlayback() { return useContext(Context); }
export function useEventPlaybackSnapshot(owner: EventPlaybackOwner) { return useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot); }

/** Root owner and mount survive route/auth changes. Presentation never reparents media. */
export function EventPlaybackProvider({ children }: { children: ReactNode }) {
  const mount = useRef<HTMLDivElement>(null);
  const [owner] = useState(() => new EventPlaybackOwner((request, notify) => {
    if (!mount.current) throw new Error("Playback mount unavailable");
    return createEventPlaybackAdapter(request, mount.current, notify);
  }));
  const state = useEventPlaybackSnapshot(owner);
  const generation = owner.generation;
  useEffect(() => () => owner.close(), [owner]);
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url || !state.request) return;
    const client = new ConvexHttpClient(url);
    return retainPlaybackAuthorization(owner, async slug => eventPlaybackRequest(await client.query(api.events.getPublicBySlug, { slug })));
    // Metadata refreshes must not restart the revalidation loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, generation]);
  return <Context.Provider value={owner}>
    {children}
    <EventCompactPlayer owner={owner} state={state} mount={mount} />
  </Context.Provider>;
}
