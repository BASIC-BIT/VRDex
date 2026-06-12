"use client";

import Image from "next/image";
import { useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";

import type { PublicProfileLookupResult } from "./profile-lookup-page";
import { Input, Textarea } from "@/components/ui/field";

type LookupSuggestionResponse = {
  results: PublicProfileLookupResult[];
};

type FetchedSuggestions = {
  query: string;
  results: PublicProfileLookupResult[];
};

function profileOptionLabel(profile: PublicProfileLookupResult): string {
  const context = [...new Set([...profile.roleTags, ...profile.tags])].slice(0, 3).join(" / ");

  return context || profile.profilePath;
}

function SuggestionAvatar({ profile }: { profile: PublicProfileLookupResult }) {
  const initials = profile.displayName.trim().slice(0, 2).toUpperCase();

  return (
    <span className="lookup-suggestion-avatar" aria-hidden="true">
      {profile.avatarImageUrl ? <Image alt="" height={38} src={profile.avatarImageUrl} unoptimized width={38} /> : <span>{initials}</span>}
    </span>
  );
}

function parseBulkLookupLines(value: string): string[] {
  return [...new Set(value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))].slice(0, 40);
}

export function LookupSearchBox({
  initialQuery,
  initialResults,
  isSearching,
  onBulkLookup,
  onClear,
  onLookup,
}: {
  initialQuery: string;
  initialResults: PublicProfileLookupResult[];
  isSearching: boolean;
  onBulkLookup: (lines: string[]) => void;
  onClear: () => void;
  onLookup: (query: string) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const [fetchedSuggestions, setFetchedSuggestions] = useState<FetchedSuggestions | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const normalizedInitialQuery = initialQuery.trim();
  const parsedBulkLines = useMemo(() => parseBulkLookupLines(bulkText), [bulkText]);
  const parsedBulkKey = parsedBulkLines.join("\n");
  const canReuseFetchedSuggestions = fetchedSuggestions !== null && (
    deferredQuery.startsWith(fetchedSuggestions.query) || fetchedSuggestions.query.startsWith(deferredQuery)
  );
  const suggestions =
    bulkMode || deferredQuery.length < 2
      ? []
      : deferredQuery === normalizedInitialQuery
        ? initialResults
        : fetchedSuggestions?.query === deferredQuery
          ? fetchedSuggestions.results
          : canReuseFetchedSuggestions
            ? fetchedSuggestions.results
            : [];

  useEffect(() => {
    if (bulkMode || deferredQuery.length < 2 || deferredQuery === normalizedInitialQuery) {
      return;
    }

    const controller = new AbortController();

    fetch(`/lookup/suggest?q=${encodeURIComponent(deferredQuery)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          return { results: [] } satisfies LookupSuggestionResponse;
        }

        return await response.json() as LookupSuggestionResponse;
      })
      .then((data) => {
        startTransition(() => setFetchedSuggestions({ query: deferredQuery, results: data.results }));
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        startTransition(() => setFetchedSuggestions({ query: deferredQuery, results: [] }));
      });

    return () => controller.abort();
  }, [bulkMode, deferredQuery, normalizedInitialQuery]);

  useEffect(() => {
    if (!bulkMode) {
      return;
    }

    if (parsedBulkLines.length === 0) {
      onBulkLookup([]);
      return;
    }

    const timeoutId = window.setTimeout(() => onBulkLookup(parsedBulkLines), 320);

    return () => window.clearTimeout(timeoutId);
  }, [bulkMode, onBulkLookup, parsedBulkKey, parsedBulkLines]);

  function submitQuery(value: string) {
    const nextQuery = value.trim();

    if (nextQuery) {
      setQuery(nextQuery);
      setIsOpen(false);
      onLookup(nextQuery);
    } else {
      clearSingleLookup();
    }
  }

  function clearSingleLookup() {
    setQuery("");
    setFetchedSuggestions(null);
    setIsOpen(false);
    onClear();
  }

  function toggleBulkMode() {
    if (bulkMode) {
      const nextQuery = parsedBulkLines[0] ?? bulkText.trim().replace(/\s+/g, " ");

      setBulkMode(false);
      setIsOpen(false);
      setQuery(nextQuery);

      if (nextQuery) {
        onLookup(nextQuery);
      } else {
        onBulkLookup([]);
      }

      return;
    }

    setBulkText((current) => current.trim() ? current : query.trim());
    setBulkMode(true);
    setIsOpen(false);
  }

  return (
    <div className="grid gap-2">
      <form
        action="/lookup"
        className={bulkMode ? "lookup-bulk-form" : "lookup-single-form"}
        onSubmit={(event) => {
          event.preventDefault();

          if (bulkMode) {
            onBulkLookup(parsedBulkLines);
            return;
          }

          submitQuery(query);
        }}
      >
        {bulkMode ? (
          <div className="lookup-bulk-editor">
            <Textarea
              aria-label="Lineup text"
              className="lookup-input min-h-20 resize-y font-mono text-sm"
              placeholder={'Paste one performer per line, e.g.\nBASICBIT\nDJ Aurora'}
              value={bulkText}
              onChange={(event) => setBulkText(event.currentTarget.value)}
            />
            <div className="flex flex-wrap justify-between gap-3 text-xs text-muted">
              <span>{parsedBulkLines.length} lookup {parsedBulkLines.length === 1 ? "line" : "lines"}</span>
              <span>Live lookup from pasted lines.</span>
            </div>
          </div>
        ) : (
          <div className="relative">
            <Input
              aria-label="DJ name"
              className="lookup-input lookup-input--clearable h-10 w-full"
              name="q"
              placeholder="Name or genre"
              value={query}
              onChange={(event) => {
                const nextQuery = event.currentTarget.value;

                setQuery(nextQuery);
                setIsOpen(true);

                if (nextQuery.trim().length === 0) {
                  setFetchedSuggestions(null);
                  setIsOpen(false);
                  onClear();
                }
              }}
              onFocus={() => setIsOpen(true)}
            />
            {query.trim() ? (
              <button className="lookup-clear-button" type="button" aria-label="Clear lookup" onClick={clearSingleLookup}>
                <svg aria-hidden="true" viewBox="0 0 16 16">
                  <path d="m4.5 4.5 7 7m0-7-7 7" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
                </svg>
              </button>
            ) : null}
            {isOpen && suggestions.length > 0 ? (
              <div className="lookup-suggestions" role="listbox" aria-label="Lookup suggestions">
                {suggestions.map((profile) => (
                  <button
                    className="lookup-suggestion-option"
                    key={profile.slug}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => submitQuery(profile.displayName)}
                  >
                    <SuggestionAvatar profile={profile} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{profile.displayName}</span>
                      <span className="block truncate text-xs text-muted">{profileOptionLabel(profile)}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}
        <button className="lookup-submit-button" disabled={isSearching} type="submit">
          {bulkMode ? "Lookup lineup" : "Lookup"}
        </button>
        <button
          className="lookup-mode-toggle"
          type="button"
          aria-pressed={bulkMode}
          onClick={toggleBulkMode}
        >
          {bulkMode ? "Single" : "Bulk"}
        </button>
      </form>
      {isPending ? <span className="sr-only">Updating lookup suggestions</span> : null}
    </div>
  );
}
