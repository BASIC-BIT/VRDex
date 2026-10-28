"use client";
import { useConvex } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@convex-generated-api";
import { createDiscoveryController, createDiscoverySessionSeed, discoverySnapshotAt, type DiscoveryQuery, type DiscoverySnapshot, type DiscoveryTransport } from "@/lib/discovery/controller";
import { discoveryRotationKey } from "@/lib/discovery/rotation";
import { formatZonedDateTimeInput } from "@/lib/calendar/zoned-date-time";
import { useHomeBrowse } from "../home-browse-provider";
import { useTimelinePreferences } from "../timeline/use-timeline-preferences";

const sessionSeed = createDiscoverySessionSeed({ storage: () => window.sessionStorage, createSeed: () => crypto.randomUUID() });
function liveQuery<T>(create: () => { onUpdate(callback: () => void): () => void; localQueryResult(): T | undefined }): DiscoveryQuery<T> {
  return { subscribe(next, error) {
    try {
      const watch = create();
      const update = () => { try { const value = watch.localQueryResult(); if (value !== undefined) next(value); } catch (failure) { error(failure); } };
      const stop = watch.onUpdate(update); update(); return stop;
    } catch (failure) { error(failure); return () => {}; }
  } };
}
const loading: DiscoverySnapshot = { kind: "loading" };

/** Attach sectionRef to the Discover section. Always render its native Browse link. */
export function useHomeDiscovery() {
  const client = useConvex();
  const browse = useHomeBrowse();
  const { preferences } = useTimelinePreferences();
  const favoritesKey = JSON.stringify(preferences.favoriteProfileIds);
  const timeZone = browse.timeZone;
  const contextKey = JSON.stringify([timeZone, favoritesKey]);
  const [section, setSection] = useState<HTMLElement | null>(null);
  const [active, setActive] = useState(false);
  const [state, setState] = useState<{ key: string; snapshot: DiscoverySnapshot; now: number }>({ key: "", snapshot: loading, now: 0 });
  const controller = useRef<ReturnType<typeof createDiscoveryController> | null>(null);
  const sectionRef = useCallback((node: HTMLElement | null) => setSection(node), []);
  useEffect(() => {
    if (!section || active) return;
    if (typeof IntersectionObserver === "undefined") {
      const frame = requestAnimationFrame(() => setActive(true));
      return () => cancelAnimationFrame(frame);
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setActive(true); observer.disconnect(); }
    }, { rootMargin: "400px" });
    observer.observe(section);
    return () => observer.disconnect();
  }, [section, active]);
  useEffect(() => {
    if (!active || !timeZone) return;
    const transport: DiscoveryTransport = {
      listEvents: args => liveQuery(() => client.watchQuery(api.homeDiscovery.listEvents, args)),
      listClubs: args => liveQuery(() => client.watchQuery(api.homeDiscovery.listClubs, args)),
      eventSignals: args => liveQuery(() => client.watchQuery(api.homeDiscovery.eventSignals, args)),
      profileSignals: args => liveQuery(() => client.watchQuery(api.homeDiscovery.profileSignals, args)),
    };
    // Each effect lifetime owns its controller, including Strict Mode's second setup.
    const current = createDiscoveryController({ transport, concurrency: 3 });
    controller.current = current;
    let alive = true;
    let sampledDate = "";
    const seed = sessionSeed();
    const favoriteProfileIds: string[] = JSON.parse(favoritesKey);
    const update = () => {
      if (alive) setState({ key: contextKey, snapshot: current.getSnapshot(), now: Date.now() });
    };
    const refresh = () => {
      const now = Date.now();
      sampledDate = formatZonedDateTimeInput(now, timeZone).slice(0, 10);
      current.setContext({ now, timeZone, favoriteProfileIds, rotationKey: discoveryRotationKey({ seed, localDate: sampledDate }) });
    };
    const unsubscribe = current.subscribe(update);
    refresh();
    const minute = window.setInterval(() => {
      const localDate = formatZonedDateTimeInput(Date.now(), timeZone).slice(0, 10);
      if (localDate !== sampledDate) refresh();
      else update();
    }, 60_000);
    const timer = window.setInterval(refresh, 300_000);
    const visibility = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      alive = false; unsubscribe(); current.dispose();
      if (controller.current === current) controller.current = null;
      window.clearInterval(minute); window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [active, client, timeZone, favoritesKey, contextKey]);
  const snapshot = state.key === contextKey ? state.snapshot : loading;
  const currentSnapshot = timeZone ? discoverySnapshotAt(snapshot, state.now, timeZone) : loading;
  const retry = useCallback(() => controller.current?.retry(), []);
  return { ...currentSnapshot, sectionRef, retry };
}
