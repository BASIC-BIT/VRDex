"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { readTimelineNavigation } from "@/lib/timeline/navigation";
import { EventDetailPanel } from "./timeline/event-detail-panel";
import { useTimelinePreferences } from "./timeline/use-timeline-preferences";
import type { PreferenceAction } from "@/lib/timeline/preferences";

export type TimelineSelection = { eventId: string; slug: string; slotId?: string };
type Runtime = { kind: "booting"; timeZone: null; hour12: null } | { kind: "ready"; timeZone: string; hour12: boolean };
type BrowseActions = {
  selection: TimelineSelection | null;
  selectEvent(selection: TimelineSelection, invoker: HTMLElement | null): void;
  closeEvent(): void;
  onPreferenceAction(action: PreferenceAction): void;
  setDisplayTimeZone(zone: string): void;
  registerBeforeTimeZoneChange(flush: () => void): () => void;
};
export type HomeBrowse = Runtime & BrowseActions;
const HomeBrowseContext = createContext<HomeBrowse | null>(null);
export function useOptionalHomeBrowse() { return useContext(HomeBrowseContext); }
export function useHomeBrowse(): HomeBrowse {
  const browse = useOptionalHomeBrowse();
  if (!browse) throw new Error("HomeBrowseProvider is required");
  return browse;
}

/** Resolve the heading at close time because ranking may replace its section. */
export function restoreHomeFocus(invoker: HTMLElement | null, headingId: string | null) {
  const target = invoker?.isConnected ? invoker : (headingId ? document.getElementById(headingId) : null) ?? document.getElementById("schedule-heading");
  target?.focus({ preventScroll: true });
}

/** Sole Home inspector owner. Preferences remain in the existing singleton store. */
export function HomeBrowseProvider({ children }: { children: ReactNode }) {
  const [runtime, setRuntime] = useState<Runtime>({ kind: "booting", timeZone: null, hour12: null });
  const [selection, setSelection] = useState<TimelineSelection | null>(null);
  const invoker = useRef<{ element: HTMLElement | null; headingId: string | null }>({ element: null, headingId: null });
  const beforeTimeZoneChange = useRef(new Set<() => void>());
  const preference = useTimelinePreferences();
  const [limit, setLimit] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const browser = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions();
      const navigation = readTimelineNavigation(new URLSearchParams(window.location.search));
      setRuntime({ kind: "ready", timeZone: navigation.timeZone ?? browser.timeZone, hour12: browser.hour12 ?? false });
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const selectEvent = useCallback((next: TimelineSelection, element: HTMLElement | null) => {
    const section = element?.closest("section[aria-labelledby]");
    const headingId = section?.getAttribute("aria-labelledby")?.split(/\s+/)[0];
    invoker.current = { element, headingId: headingId ?? "schedule-heading" };
    setSelection(next);
  }, []);
  const closeEvent = useCallback(() => {
    setSelection(null);
    restoreHomeFocus(invoker.current.element, invoker.current.headingId);
  }, []);
  const setDisplayTimeZone = useCallback((zone: string) => {
    // Validate before flushing navigation or committing an invalid display zone.
    new Intl.DateTimeFormat(undefined, { timeZone: zone });
    beforeTimeZoneChange.current.forEach(flush => flush());
    setRuntime(value => value.kind === "ready" ? { ...value, timeZone: zone } : value);
  }, []);
  const registerBeforeTimeZoneChange = useCallback((flush: () => void) => {
    beforeTimeZoneChange.current.add(flush);
    return () => { beforeTimeZoneChange.current.delete(flush); };
  }, []);
  const { addPlan, removePlan, addFavorite, removeFavorite } = preference;
  const onPreferenceAction = useCallback((action: PreferenceAction) => {
    const result = action.type === "add-plan" ? addPlan(action.reference)
      : action.type === "remove-plan" ? removePlan(action.reference)
        : action.type === "add-favorite" ? addFavorite(action.profileId) : removeFavorite(action.profileId);
    setLimit(result.outcome === "limit");
  }, [addPlan, removePlan, addFavorite, removeFavorite]);
  const value = useMemo<HomeBrowse>(() => ({ ...runtime, selection, selectEvent, closeEvent, onPreferenceAction, setDisplayTimeZone, registerBeforeTimeZoneChange }), [runtime, selection, selectEvent, closeEvent, onPreferenceAction, setDisplayTimeZone, registerBeforeTimeZoneChange]);
  return <HomeBrowseContext.Provider value={value}>
    {children}
    {runtime.kind === "ready" && <EventDetailPanel selection={selection} timeZone={runtime.timeZone} onClose={closeEvent} preferences={preference.preferences} onPreferenceAction={onPreferenceAction} />}
    {limit && <span role="status">Limit reached</span>}
  </HomeBrowseContext.Provider>;
}
