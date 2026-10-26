"use client";

import { type SetStateAction, useDeferredValue, useEffect, useRef, useState } from "react";

import { parsePublicSearchSuggestions, type SearchSuggestion } from "@/lib/public-search-suggestions";
import { type SearchResultFilter, searchSuggestionHref } from "./search-view-state";

export type { SearchSuggestion } from "@/lib/public-search-suggestions";

type FetchedSearchSuggestions = { identity: string; results: SearchSuggestion[] };

export function useSearchSuggestions(
  query: string,
  filter: SearchResultFilter,
  options?: { skipWhenEqualTo?: string },
) {
  const normalizedQuery = query.trim();
  const deferredQuery = useDeferredValue(normalizedQuery);
  const skipQuery = options?.skipWhenEqualTo?.trim();
  const identity = searchSuggestionHref(normalizedQuery, filter);
  const [fetchedSuggestions, setFetchedSuggestions] = useState<FetchedSearchSuggestions | null>(null);
  const [selection, setSelection] = useState<{ identity: string; index: number } | null>(null);
  const suggestionRequestId = useRef(0);
  const activeController = useRef<AbortController | null>(null);
  const suggestions = normalizedQuery.length > 0 && normalizedQuery !== skipQuery &&
    fetchedSuggestions?.identity === identity ? fetchedSuggestions.results : [];
  const activeIndex = selection?.identity === identity && suggestions[selection.index] ? selection.index : -1;

  useEffect(() => {
    const requestId = ++suggestionRequestId.current;
    if (!deferredQuery || deferredQuery !== normalizedQuery || deferredQuery === skipQuery) return;

    const controller = new AbortController();
    activeController.current = controller;
    const timeoutId = window.setTimeout(() => {
      fetch(identity, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          const value: unknown = response.ok ? await response.json() : null;
          return parsePublicSearchSuggestions(value);
        })
        .then((results) => {
          if (requestId !== suggestionRequestId.current || controller.signal.aborted) return;
          setFetchedSuggestions({ identity, results });
          setSelection(null);
        })
        .catch(() => {
          if (requestId === suggestionRequestId.current && !controller.signal.aborted) {
            setFetchedSuggestions({ identity, results: [] });
          }
        });
    }, 180);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [deferredQuery, identity, normalizedQuery, skipQuery]);

  return {
    activeIndex,
    reset: () => {
      ++suggestionRequestId.current;
      activeController.current?.abort();
      setFetchedSuggestions(null);
      setSelection(null);
    },
    setActiveIndex: (next: SetStateAction<number>) => setSelection((current) => ({
      identity,
      index: typeof next === "function"
        ? next(current?.identity === identity ? current.index : -1)
        : next,
    })),
    suggestions,
  };
}
