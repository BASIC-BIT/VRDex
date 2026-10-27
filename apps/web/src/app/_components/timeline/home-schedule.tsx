"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PlanReference,
  TimelineRange,
} from "../../../../../../convex/_eventTimelineTypes";
import { Button } from "@/components/ui/button";
import {
  formatZonedDateTimeInput,
  parseZonedDateTimeInput,
} from "@/lib/calendar/zoned-date-time";
import {
  readTimelineNavigation,
  timelineNavigationHref,
  type TimelineNavigation,
} from "@/lib/timeline/navigation";
import { HOUR, inRange } from "@/lib/timeline/window-cache";
import { useTimelinePreferences } from "./use-timeline-preferences";
import { useTimelineData } from "./use-timeline-data";
import { TimelineToolbar } from "./timeline-toolbar";
import { TimelineChart } from "./timeline-chart";
import { TimelineAgenda } from "./timeline-agenda";
import { TimelineNight } from "./timeline-night";
import { isSaved, type TimelineActions } from "./timeline-event-bar";
import styles from "./timeline.module.css";
export type TimelineSelection = {
  eventId: string;
  slug: string;
  slotId?: string;
};
type Runtime = {
  now: number;
  navigation: TimelineNavigation;
  timeZone: string;
  hour12: boolean;
};
export function HomeSchedule({
  onSelectionChange,
}: { onSelectionChange?: (selection: TimelineSelection | null) => void } = {}) {
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const browser = new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
      }).resolvedOptions();
      const navigation = readTimelineNavigation(
        new URLSearchParams(window.location.search),
      );
      setRuntime({
        now: Date.now(),
        navigation,
        timeZone: navigation.timeZone ?? browser.timeZone,
        hour12: browser.hour12 ?? false,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return runtime ? (
    <ScheduleContent runtime={runtime} onSelectionChange={onSelectionChange} />
  ) : (
    <section className={styles.schedule} aria-label="Schedule">
      <h2>Schedule</h2>
      <div className={styles.loading} role="status">
        Loading events
      </div>
    </section>
  );
}
function ScheduleContent({
  runtime,
  onSelectionChange,
}: {
  runtime: Runtime;
  onSelectionChange?: (selection: TimelineSelection | null) => void;
}) {
  const [navigation, setNavigation] = useState<TimelineNavigation>({
    ...runtime.navigation,
    anchor: runtime.navigation.anchor ?? runtime.now - HOUR,
  });
  const [now, setNow] = useState(runtime.now);
  const [width, setWidth] = useState(1000);
  const [selection, setSelection] = useState<TimelineSelection | null>(null);
  const [limit, setLimit] = useState(false);
  const preference = useTimelinePreferences();
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeZone = navigation.timeZone ?? runtime.timeZone;
  const anchor = navigation.anchor ?? now - HOUR;
  const range: TimelineRange = {
    startAt: anchor,
    endAt: anchor + (width / 100) * HOUR,
    timeZone,
  };
  const data = useTimelineData({
    range,
    favoritesOnly: navigation.favoritesOnly,
    favoriteProfileIds: preference.preferences.favoriteProfileIds,
    plan: preference.preferences.plan,
  });
  const cancelReplace = useCallback(() => {
    if (pending.current !== null) {
      clearTimeout(pending.current);
      pending.current = null;
    }
  }, []);
  const writeUrl = useCallback((state: TimelineNavigation, push: boolean) => {
    const href = timelineNavigationHref({
      pathname: window.location.pathname,
      searchParams: new URLSearchParams(window.location.search),
      state,
    });
    window.history[push ? "pushState" : "replaceState"](null, "", href);
  }, []);
  const navigate = (changes: Partial<TimelineNavigation>, push = true) => {
    cancelReplace();
    const next = { ...navigation, ...changes };
    const valid = readTimelineNavigation(
      new URLSearchParams({ at: String(next.anchor) }),
    ).anchor;
    next.anchor = valid ?? Date.now() - HOUR;
    setNavigation(next);
    if (push) writeUrl(next, true);
    else
      pending.current = setTimeout(() => {
        writeUrl(next, false);
        pending.current = null;
      }, 300);
  };
  useEffect(() => {
    const pop = () => {
      cancelReplace();
      const parsed = readTimelineNavigation(
        new URLSearchParams(window.location.search),
      );
      setNavigation({ ...parsed, anchor: parsed.anchor ?? Date.now() - HOUR });
    };
    const clock = setInterval(() => setNow(Date.now()), 60_000);
    window.addEventListener("popstate", pop);
    return () => {
      cancelReplace();
      clearInterval(clock);
      window.removeEventListener("popstate", pop);
    };
  }, [cancelReplace]);
  const onSelect = (next: TimelineSelection) => {
    setSelection(next);
    onSelectionChange?.(next);
  };
  const onSave = (reference: PlanReference) => {
    // A set included by a whole event removes that event's save, never a no-op set.
    const existing = preference.preferences.plan.find(
      (p) => p.eventId === reference.eventId && p.kind === "event",
    );
    const result = isSaved(preference.preferences.plan, reference)
      ? preference.removePlan(existing ?? reference)
      : preference.addPlan(reference);
    setLimit(result.outcome === "limit");
  };
  const actions: TimelineActions = {
    selection,
    plan: preference.preferences.plan,
    favoriteProfileIds: preference.preferences.favoriteProfileIds,
    onSelect,
    onSave,
    onFavorite: (profileId) => {
      const result = preference.preferences.favoriteProfileIds.includes(
        profileId,
      )
        ? preference.removeFavorite(profileId)
        : preference.addFavorite(profileId);
      setLimit(result.outcome === "limit");
    },
  };
  const nextSaved = () => {
    const instants = data.saved
      .flatMap((item) => {
        if (item.kind !== "available" || item.status === "cancelled") return [];
        const schedule = item.slot?.schedule ?? item.event.schedule;
        return schedule.kind === "date_only" ? [] : [schedule.startAt];
      })
      .sort((a, b) => a - b);
    const next =
      instants.find((instant) => instant > range.endAt) ?? instants[0];
    if (next !== undefined) navigate({ anchor: next });
  };
  const visible = data.records.filter((event) => inRange(event, range));
  return (
    <section className={styles.schedule} aria-labelledby="schedule-heading">
      <TimelineToolbar
        navigation={navigation}
        timeZone={timeZone}
        hour12={runtime.hour12}
        date={formatZonedDateTimeInput(anchor, timeZone).slice(0, 10)}
        onNavigate={navigate}
        onDate={(value) => {
          try {
            navigate({
              anchor: parseZonedDateTimeInput(
                `${value}T12:00`,
                timeZone,
                "Date",
              ),
            });
          } catch {
            navigate({ anchor: Date.now() - HOUR });
          }
        }}
        onPan={(hours) => navigate({ anchor: anchor + hours * HOUR })}
        onNow={() => navigate({ anchor: Date.now() - HOUR })}
      />
      {preference.preferences.plan.length > 0 && (
        <TimelineNight
          saved={data.saved}
          range={range}
          onNext={nextSaved}
          onSelect={onSelect}
          onSave={onSave}
        />
      )}
      {navigation.view === "timeline" ? (
        <TimelineChart
          records={data.records}
          saved={data.saved}
          range={range}
          now={now}
          slotCoverage={data.slotCoverage}
          onPan={(instant) => navigate({ anchor: instant }, false)}
          onWidth={setWidth}
          onNext={nextSaved}
          {...actions}
        />
      ) : (
        <TimelineAgenda
          records={visible}
          timeZone={timeZone}
          slotCoverage={data.slotCoverage}
          {...actions}
        />
      )}
      <div
        className={styles.status}
        role="status"
        aria-label="Schedule data state"
        data-state={data.kind}
      >
        {data.kind === "loading" && "Loading events"}
        {data.kind === "error" && (
          <>
            Events unavailable{" "}
            <Button size="sm" onClick={() => void data.retry()}>
              Retry
            </Button>
          </>
        )}
        {data.kind === "partial" && (
          <>
            More events available{" "}
            <Button size="sm" onClick={() => void data.loadMore()}>
              More
            </Button>
          </>
        )}
        {data.kind === "ready" &&
          visible.length === 0 &&
          (navigation.favoritesOnly
            ? "No favorites in this range"
            : "No events in this range")}
        {preference.persistence === "session" && <span>Not saved</span>}
        {limit && <span>Limit reached</span>}
        {data.savedState === "loading" && <span>Loading events</span>}
        {data.savedState === "error" && (
          <>
            <span>Events unavailable</span>
            <Button size="sm" onClick={() => void data.retry()}>
              Retry
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
