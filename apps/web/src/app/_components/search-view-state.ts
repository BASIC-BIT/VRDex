export type SearchViewKey = "standard" | "dj";
export type SearchResultFilter = "all" | "event" | "person" | "community" | "world";

export type SearchViewDefinition = {
  key: SearchViewKey;
  label: string;
  description: string;
  defaultFilter: SearchResultFilter;
};

export const SEARCH_VIEWS: Record<SearchViewKey, SearchViewDefinition> = {
  standard: {
    key: "standard",
    label: "All VRDex",
    description: "People, communities, worlds, and events",
    defaultFilter: "all",
  },
  dj: {
    key: "dj",
    label: "DJ links",
    description: "People with performance links and details foregrounded",
    defaultFilter: "person",
  },
};

const SEARCH_FILTERS = new Set<SearchResultFilter>([
  "all",
  "event",
  "person",
  "community",
  "world",
]);

export function parseSearchView(value: string | undefined): SearchViewKey {
  return value === "dj" ? "dj" : "standard";
}

export function parseSearchFilter(
  value: string | undefined,
  view: SearchViewKey = "standard",
): SearchResultFilter {
  if (view === "dj") {
    return SEARCH_VIEWS.dj.defaultFilter;
  }

  return value && SEARCH_FILTERS.has(value as SearchResultFilter)
    ? (value as SearchResultFilter)
    : SEARCH_VIEWS[view].defaultFilter;
}

export function searchHref({
  filter,
  query,
  view = "standard",
}: {
  filter?: SearchResultFilter;
  query?: string;
  view?: SearchViewKey;
}): string {
  const params = new URLSearchParams();
  const normalizedQuery = query?.trim();
  const resolvedFilter = filter ?? SEARCH_VIEWS[view].defaultFilter;

  if (normalizedQuery) {
    params.set("q", normalizedQuery);
  }
  if (view !== "standard") {
    params.set("view", view);
  }
  if (resolvedFilter !== SEARCH_VIEWS[view].defaultFilter) {
    params.set("type", resolvedFilter);
  }

  const encoded = params.toString();
  return encoded ? `/search?${encoded}` : "/search";
}

export function searchSuggestionHref(
  query: string,
  filter: SearchResultFilter = "all",
): string {
  const params = new URLSearchParams({ q: query });

  if (filter !== "all") {
    params.set("type", filter);
  }

  return `/search/suggest?${params.toString()}`;
}
