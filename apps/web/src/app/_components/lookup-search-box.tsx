"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";

import type {
  PrivateSeedLookupResult,
  ProfileLookupDisplayResult,
  PublicProfileLookupResult,
  SeedLookupViewerAccess,
} from "./profile-lookup-page";
import { EntityImage } from "@/components/ui/entity-image";
import { mergeLookupSuggestions } from "./lookup-suggestion-merge";
import { Input, Textarea } from "@/components/ui/field";

type LookupSuggestionResponse = {
  privateResults: PrivateSeedLookupResult[];
  results: PublicProfileLookupResult[];
  viewerAccess: SeedLookupViewerAccess;
};

type FetchedSuggestions = {
  query: string;
  results: ProfileLookupDisplayResult[];
};

const RECENT_SEARCH_LIMIT = 5;
const RECENT_SEARCHES_STORAGE_KEY = "vrdex.lookup.recentSearches";

function isPrivateSuggestion(
  profile: ProfileLookupDisplayResult,
): profile is PrivateSeedLookupResult {
  return "publicationState" in profile;
}

function profileOptionLabel(profile: ProfileLookupDisplayResult): string {
  if (isPrivateSuggestion(profile)) {
    return profile.source?.name ? `Private seed - ${profile.source.name}` : "Private seed";
  }

  const context = [...new Set([...profile.roleTags, ...profile.tags])].slice(0, 3).join(" / ");

  return context || profile.profilePath;
}

function SuggestionAvatar({ profile }: { profile: ProfileLookupDisplayResult }) {
  const avatarImageUrl = isPrivateSuggestion(profile) ? undefined : profile.avatarImageUrl;

  return (
    <EntityImage
      alt=""
      className="lookup-suggestion-avatar"
      label={profile.displayName}
      sizes="38px"
      src={avatarImageUrl}
    />
  );
}

function parseBulkLookupLines(value: string): string[] {
  return [...new Set(value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))].slice(0, 40);
}

function normalizeRecentSearch(value: string): string | null {
  const trimmed = value.trim().replace(/\s+/g, " ");

  return trimmed || null;
}

function mergeRecentSearch(current: string[], value: string): string[] {
  const normalized = normalizeRecentSearch(value);

  if (!normalized) {
    return current;
  }

  const normalizedKey = normalized.toLowerCase();
  const deduped = current.filter((item) => item.toLowerCase() !== normalizedKey);

  return [normalized, ...deduped].slice(0, RECENT_SEARCH_LIMIT);
}

function readRecentSearches(): string[] {
  try {
    const rawValue = window.localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY);
    const parsedValue: unknown = rawValue ? JSON.parse(rawValue) : [];

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    const recentSearches: string[] = [];
    const seen = new Set<string>();

    for (const item of parsedValue) {
      if (typeof item !== "string") {
        continue;
      }

      const normalized = normalizeRecentSearch(item);

      if (!normalized || seen.has(normalized.toLowerCase())) {
        continue;
      }

      seen.add(normalized.toLowerCase());
      recentSearches.push(normalized);
    }

    return recentSearches.slice(0, RECENT_SEARCH_LIMIT);
  } catch {
    return [];
  }
}

function writeRecentSearches(values: string[]) {
  try {
    window.localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(values));
  } catch {
    return;
  }
}

export function LookupSearchBox({
  initialQuery,
  initialResults,
  isSearching,
  onBulkLookup,
  onClear,
  onLookup,
  showPrivateSuggestions,
}: {
  initialQuery: string;
  initialResults: ProfileLookupDisplayResult[];
  isSearching: boolean;
  onBulkLookup: (lines: string[]) => void;
  onClear: () => void;
  onLookup: (query: string) => void;
  showPrivateSuggestions: boolean;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const [fetchedSuggestions, setFetchedSuggestions] = useState<FetchedSuggestions | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => (
    typeof window === "undefined" ? [] : readRecentSearches()
  ));
  const recentSaveTimeoutRef = useRef<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const normalizedInitialQuery = initialQuery.trim();
  const parsedBulkLines = useMemo(() => parseBulkLookupLines(bulkText), [bulkText]);
  const parsedBulkKey = parsedBulkLines.join("\n");
  const canReuseFetchedSuggestions = fetchedSuggestions !== null && (
    deferredQuery.startsWith(fetchedSuggestions.query) || fetchedSuggestions.query.startsWith(deferredQuery)
  );
  const suggestions =
    bulkMode || deferredQuery.length < 1
      ? []
      : deferredQuery === normalizedInitialQuery
        ? initialResults
        : fetchedSuggestions?.query === deferredQuery
          ? fetchedSuggestions.results
          : canReuseFetchedSuggestions
            ? fetchedSuggestions.results
            : [];
  const recentOptions = bulkMode || deferredQuery.length > 0 ? [] : recentSearches;

  useEffect(() => () => {
    if (recentSaveTimeoutRef.current !== null) {
      window.clearTimeout(recentSaveTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    if (bulkMode || deferredQuery.length < 1 || deferredQuery === normalizedInitialQuery) {
      return;
    }

    const controller = new AbortController();

    fetch(`/lookup/suggest?q=${encodeURIComponent(deferredQuery)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          return {
            privateResults: [],
            results: [],
            viewerAccess: { allowed: false, source: "signed_out" },
          } satisfies LookupSuggestionResponse;
        }

        return await response.json() as LookupSuggestionResponse;
      })
      .then((data) => {
        const privateSuggestionsEnabled = showPrivateSuggestions || data.viewerAccess.source === "super_admin";
        const privateResults = privateSuggestionsEnabled && data.viewerAccess.allowed
          ? data.privateResults
          : [];

        startTransition(() => setFetchedSuggestions({
          query: deferredQuery,
          results: mergeLookupSuggestions(data.results, privateResults),
        }));
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        startTransition(() => setFetchedSuggestions({ query: deferredQuery, results: [] }));
      });

    return () => controller.abort();
  }, [bulkMode, deferredQuery, normalizedInitialQuery, showPrivateSuggestions]);

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
      scheduleRecentSearchSave(nextQuery);
      onLookup(nextQuery);
    } else {
      clearSingleLookup();
    }
  }

  function saveRecentSearch(value: string) {
    setRecentSearches((current) => {
      const nextSearches = mergeRecentSearch(current, value);

      writeRecentSearches(nextSearches);

      return nextSearches;
    });
  }

  function scheduleRecentSearchSave(value: string) {
    const normalized = normalizeRecentSearch(value);

    if (!normalized) {
      return;
    }

    if (recentSaveTimeoutRef.current !== null) {
      window.clearTimeout(recentSaveTimeoutRef.current);
    }

    recentSaveTimeoutRef.current = window.setTimeout(() => {
      saveRecentSearch(normalized);
      recentSaveTimeoutRef.current = null;
    }, 240);
  }

  function clearSingleLookup() {
    setQuery("");
    setFetchedSuggestions(null);
    setIsOpen(true);
    onClear();
  }

  function toggleBulkMode() {
    if (bulkMode) {
      const nextQuery = parsedBulkLines[0] ?? bulkText.trim().replace(/\s+/g, " ");

      setBulkMode(false);
      setIsOpen(false);
      setQuery(nextQuery);

      if (nextQuery) {
        scheduleRecentSearchSave(nextQuery);
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
                  setIsOpen(true);
                  onClear();
                }
              }}
              onFocus={() => setIsOpen(true)}
              onBlur={() => {
                scheduleRecentSearchSave(query);
                window.setTimeout(() => setIsOpen(false), 120);
              }}
            />
            {query.trim() ? (
              <button
                className="lookup-clear-button"
                type="button"
                aria-label="Clear lookup"
                onMouseDown={(event) => event.preventDefault()}
                onClick={clearSingleLookup}
              >
                <svg aria-hidden="true" viewBox="0 0 16 16">
                  <path d="m4.5 4.5 7 7m0-7-7 7" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
                </svg>
              </button>
            ) : null}
            {isOpen && (suggestions.length > 0 || recentOptions.length > 0) ? (
              <div className="lookup-suggestions" role="listbox" aria-label={recentOptions.length > 0 && suggestions.length === 0 ? "Recent lookup searches" : "Lookup suggestions"}>
                {recentOptions.length > 0 && suggestions.length === 0 ? <div className="lookup-suggestions-label">Recent searches</div> : null}
                {recentOptions.map((recentSearch) => (
                  <button
                    className="lookup-suggestion-option lookup-recent-option"
                    key={recentSearch}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => submitQuery(recentSearch)}
                  >
                    <span className="lookup-recent-icon" aria-hidden="true">
                      <svg viewBox="0 0 16 16">
                        <path d="M4.1 5.2A5 5 0 1 1 3 8" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
                        <path d="M4.1 2.6v2.6h2.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
                      </svg>
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{recentSearch}</span>
                      <span className="block truncate text-xs text-muted">Recent search</span>
                    </span>
                  </button>
                ))}
                {suggestions.map((profile) => (
                  <button
                    className="lookup-suggestion-option"
                    key={isPrivateSuggestion(profile) ? `private:${profile.id}` : `public:${profile.slug}`}
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
