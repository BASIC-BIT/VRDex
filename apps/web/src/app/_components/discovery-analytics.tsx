"use client";

import Link, { type LinkProps } from "next/link";
import { useRouter } from "next/navigation";
import { useFeatureFlagEnabled, usePostHog } from "posthog-js/react";
import {
  type FormEvent,
  type ReactNode,
  useDeferredValue,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  captureProductEvent,
  type DiscoveryAnalyticsSurface,
  type ProductAnalyticsEvent,
} from "@/lib/posthog";

type TrackedDiscoveryEvent = Extract<
  ProductAnalyticsEvent,
  "discovery_filter_selected" | "event_card_clicked" | "featured_card_clicked" | "search_result_clicked"
>;

type TrackedDiscoveryProperties = {
  discovery_filter_selected: { scope: string; surface: "home_terms" };
  event_card_clicked: { entity_type: "event"; surface: DiscoveryAnalyticsSurface };
  featured_card_clicked: { entity_type: string; surface: "featured" };
  search_result_clicked: { entity_type: string; profile_type?: string; surface: DiscoveryAnalyticsSurface };
};

type SearchSuggestion = {
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

export function DiscoveryFeatureGate({
  children,
  flag,
}: {
  children: ReactNode;
  flag: string;
}) {
  const enabled = useFeatureFlagEnabled(flag);

  return enabled === true ? children : null;
}

export function DiscoverySearchForm({
  action = "/search",
  className,
  defaultQuery,
  surface = "search",
  tone = "inverse",
}: {
  action?: string;
  className?: string;
  defaultQuery?: string;
  surface?: "home" | "search";
  tone?: "default" | "inverse";
}) {
  const posthog = usePostHog();
  const router = useRouter();
  const isInverse = tone === "inverse";
  const [query, setQuery] = useState(defaultQuery ?? "");
  const normalizedQuery = query.trim();
  const deferredQuery = useDeferredValue(normalizedQuery);
  const [fetchedSuggestions, setFetchedSuggestions] = useState<FetchedSearchSuggestions | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isOpen, setIsOpen] = useState(false);
  const listboxId = useId();
  const suggestionRequestId = useRef(0);
  const suggestions = fetchedSuggestions?.query === normalizedQuery
    ? fetchedSuggestions.results
    : [];
  const visibleSuggestions =
    normalizedQuery.length > 0 && normalizedQuery !== defaultQuery?.trim() ? suggestions : [];

  useEffect(() => {
    const requestId = ++suggestionRequestId.current;

    if (deferredQuery.length < 1 || deferredQuery === defaultQuery?.trim()) {
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      fetch(`/search/suggest?q=${encodeURIComponent(deferredQuery)}`, {
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
  }, [defaultQuery, deferredQuery]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const formData = new FormData(event.currentTarget);
    const query = String(formData.get("q") ?? "").trim();

    if (query) {
      captureProductEvent(posthog, "search_submitted", { surface, view_key: "standard" });
    }
  }

  function selectSuggestion(result: SearchSuggestion) {
    captureProductEvent(posthog, "search_result_clicked", {
      entity_type: result.entityType,
      profile_type: result.profileType,
      surface,
    });
    setIsOpen(false);
    router.push(result.routePath);
  }

  return (
    <form className={cn("flex flex-col gap-3 sm:flex-row", className)} action={action} onSubmit={onSubmit}>
      <div className="relative flex-1">
        <input
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={isOpen && visibleSuggestions.length > 0}
          className={cn(
            "min-h-14 w-full rounded-control border px-5 text-base outline-none focus-visible:ring-2",
            isInverse
              ? "border-white/25 bg-white/16 text-white placeholder:text-white/62 focus:border-white/70 focus-visible:ring-white/25"
              : "border-border bg-surface text-foreground placeholder:text-muted focus:border-accent focus-visible:ring-accent/20",
          )}
          name="q"
          placeholder="Search people, communities, worlds, events..."
          role="combobox"
          value={query}
          onBlur={() => window.setTimeout(() => setIsOpen(false), 100)}
          onChange={(event) => {
            const nextQuery = event.currentTarget.value;
            setQuery(nextQuery);
            setIsOpen(true);
            setActiveIndex(-1);
            if (!nextQuery.trim()) {
              setFetchedSuggestions(null);
            }
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setIsOpen(false);
              setActiveIndex(-1);
              return;
            }
            if (event.key === "ArrowDown" && visibleSuggestions.length > 0) {
              event.preventDefault();
              setIsOpen(true);
              setActiveIndex((current) => (current + 1) % visibleSuggestions.length);
              return;
            }
            if (event.key === "ArrowUp" && visibleSuggestions.length > 0) {
              event.preventDefault();
              setIsOpen(true);
              setActiveIndex((current) => current <= 0 ? visibleSuggestions.length - 1 : current - 1);
              return;
            }
            if (event.key === "Enter" && activeIndex >= 0 && visibleSuggestions[activeIndex]) {
              event.preventDefault();
              selectSuggestion(visibleSuggestions[activeIndex]);
            }
          }}
        />
        {isOpen && visibleSuggestions.length > 0 ? (
          <div
            className="absolute z-30 mt-2 grid w-full overflow-hidden rounded-card border border-border bg-surface shadow-panel"
            id={listboxId}
            role="listbox"
          >
            {visibleSuggestions.map((result, index) => (
              <button
                aria-selected={activeIndex === index}
                className={cn(
                  "grid gap-1 px-4 py-3 text-left hover:bg-surface-strong",
                  activeIndex === index ? "bg-surface-strong" : undefined,
                )}
                id={`${listboxId}-${index}`}
                key={`${result.entityType}:${result.slug}`}
                role="option"
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectSuggestion(result)}
              >
                <span className="font-medium">{result.title}</span>
                <span className="text-xs text-muted">{result.subtitle ?? result.entityType}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <button
        className={cn(
          buttonVariants({ size: "lg", variant: isInverse ? "inversePrimary" : "primary" }),
          "min-h-14 px-6 font-semibold",
        )}
        type="submit"
      >
        Search VRDex
      </button>
    </form>
  );
}

export function TrackedDiscoveryLink<Event extends TrackedDiscoveryEvent>({
  children,
  eventName,
  properties,
  ...props
}: LinkProps & {
  children: ReactNode;
  className?: string;
  eventName: Event;
  properties: TrackedDiscoveryProperties[Event];
}) {
  const posthog = usePostHog();

  return (
    <Link
      {...props}
      onClick={() => {
        posthog?.capture(eventName, properties);
      }}
    >
      {children}
    </Link>
  );
}
