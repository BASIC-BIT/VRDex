"use client";

import { useDeferredValue, useEffect, useRef, useState } from "react";

import { type SearchResultFilter, searchSuggestionHref } from "./search-view-state";

export type SearchSuggestion = {
  entityType: string;
  profileType?: string;
  routePath: string;
  slug: string;
  subtitle?: string;
  title: string;
};

type FetchedSearchSuggestions = {
  query: string;
  results: SearchSuggestion[];
};

/**
 * The typeahead behind every search input: debounced, request-id guarded, and
 * scoped to the caller's filter.
 *
 * `skipWhenEqualTo` is what keeps a server-rendered result page from reopening
 * its own answer as a suggestion list the moment it mounts — the query in the
 * box is already the query on the page, so there is nothing to suggest.
 */
export function useSearchSuggestions(
  query: string,
  filter: SearchResultFilter,
  options?: { skipWhenEqualTo?: string },
) {
  const normalizedQuery = query.trim();
  const deferredQuery = useDeferredValue(normalizedQuery);
  const skipQuery = options?.skipWhenEqualTo?.trim();
  const [fetchedSuggestions, setFetchedSuggestions] = useState<FetchedSearchSuggestions | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const suggestionRequestId = useRef(0);
  const suggestions =
    normalizedQuery.length > 0 &&
    normalizedQuery !== skipQuery &&
    fetchedSuggestions?.query === normalizedQuery
      ? fetchedSuggestions.results
      : [];

  useEffect(() => {
    const requestId = ++suggestionRequestId.current;

    if (deferredQuery.length < 1 || deferredQuery === skipQuery) {
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      fetch(searchSuggestionHref(deferredQuery, filter), {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => response.ok
          ? await response.json() as { results: SearchSuggestion[] }
          : { results: [] })
        .then((data) => {
          if (requestId !== suggestionRequestId.current) {
            return;
          }

          setFetchedSuggestions({ query: deferredQuery, results: data.results });
          setActiveIndex(-1);
        })
        .catch((error: unknown) => {
          if (
            requestId === suggestionRequestId.current &&
            !(error instanceof DOMException && error.name === "AbortError")
          ) {
            setFetchedSuggestions({ query: deferredQuery, results: [] });
          }
        });
    }, 180);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [deferredQuery, filter, skipQuery]);

  return {
    activeIndex,
    reset: () => setFetchedSuggestions(null),
    setActiveIndex,
    suggestions,
  };
}
