export type TimelineNavigation = {
  anchor: number | null;
  timeZone: string | null;
  view: "timeline" | "agenda";
  favoritesOnly: boolean;
};
type SearchParams = { get(name: string): string | null; toString(): string };

function readAnchor(value: string | null): number | null {
  if (value === null || !/^-?\d+$/.test(value)) return null;
  const instant = Number(value);
  // Leave a year of padding for timezone conversion, prefetch and date navigation.
  return Number.isSafeInteger(instant) && instant >= Date.parse("0002-01-01T00:00:00Z")
    && instant < Date.parse("9999-01-01T00:00:00Z") ? instant : null;
}

function readTimeZone(value: string | null): string | null {
  if (!value) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return value;
  } catch {
    return null;
  }
}

export function readTimelineNavigation(searchParams: SearchParams): TimelineNavigation {
  return {
    anchor: readAnchor(searchParams.get("at")),
    timeZone: readTimeZone(searchParams.get("tz")),
    view: searchParams.get("scheduleView") === "agenda" ? "agenda" : "timeline",
    favoritesOnly: searchParams.get("favorites") === "1",
  };
}

export function timelineNavigationHref({ pathname, searchParams, state }: {
  pathname: string;
  searchParams: SearchParams;
  state: TimelineNavigation;
}): string {
  const params = new URLSearchParams(searchParams.toString());
  if (state.anchor === null) params.delete("at");
  else params.set("at", String(state.anchor));
  if (state.timeZone === null) params.delete("tz");
  else params.set("tz", state.timeZone);
  if (state.view === "timeline") params.delete("scheduleView");
  else params.set("scheduleView", state.view);
  if (state.favoritesOnly) params.set("favorites", "1");
  else params.delete("favorites");
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
