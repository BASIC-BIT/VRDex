"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { X } from "lucide-react";
import { type FormEvent, useId, useRef, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { EntityImage } from "@/components/ui/entity-image";
import { ProfileAvatarImage } from "@/components/ui/profile-avatar-image";
import { VerifiedTrustMark } from "@/components/ui/verified-trust-mark";
import { cn } from "@/lib/cn";
import { captureProductEvent } from "@/lib/posthog";
import { type SearchSuggestion, useSearchSuggestions } from "./use-search-suggestions";
import { searchHref, type SearchResultFilter } from "./search-view-state";

type PublicSearchControlProps = {
  action?: string;
  className?: string;
  defaultQuery?: string;
  filter?: SearchResultFilter;
  surface?: "home" | "search";
  tone?: "default" | "inverse";
};

// URL query changes remount editing state, including selection and requests.
export function PublicSearchControl(props: PublicSearchControlProps) {
  return <SearchControl key={props.defaultQuery ?? ""} {...props} />;
}

function SearchControl({
  action = "/search", className, defaultQuery, filter = "all", surface = "search", tone = "inverse",
}: PublicSearchControlProps) {
  const posthog = usePostHog();
  const router = useRouter();
  const [query, setQuery] = useState(defaultQuery ?? "");
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const { activeIndex, reset, setActiveIndex, suggestions } = useSearchSuggestions(query, filter, {
    skipWhenEqualTo: defaultQuery,
  });
  const preview = suggestions.slice(0, 5);
  const expanded = isOpen && preview.length > 0;
  const selectedIndex = expanded && activeIndex < preview.length ? activeIndex : -1;
  const isInverse = tone === "inverse";
  const resultsHref = searchHref({ query, filter }).replace(/^\/search/, action);

  function dismiss() {
    setIsOpen(false);
    setActiveIndex(-1);
  }

  function captureSubmission() {
    if (query.trim()) captureProductEvent(posthog, "search_submitted", { surface, view_key: "standard" });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    captureSubmission();
    dismiss();
    router.push(resultsHref);
  }

  function selectSuggestion(result: SearchSuggestion) {
    captureProductEvent(posthog, "search_result_clicked", {
      entity_type: result.entityType, profile_type: result.profileType, surface,
    });
    dismiss();
    reset();
    router.push(result.routePath);
  }

  return (
    <form
      action={action}
      className={cn("flex flex-col gap-3 sm:flex-row", className)}
      method="get"
      onSubmit={onSubmit}
    >
      <div className="relative min-w-0 flex-1" onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) dismiss();
      }}>
        <input
          aria-activedescendant={selectedIndex >= 0 ? `${listboxId}-${selectedIndex}` : undefined}
          aria-autocomplete="list"
          aria-controls={expanded ? listboxId : undefined}
          aria-expanded={expanded}
          aria-label="Search VRDex"
          autoComplete="off"
          className={cn(
            "min-h-14 w-full rounded-control border py-3 pr-12 pl-5 text-base outline-none focus-visible:ring-2",
            isInverse
              ? "border-white/25 bg-white/16 text-white placeholder:text-white/62 focus:border-white/70 focus-visible:ring-white/25"
              : "border-border bg-surface text-foreground placeholder:text-muted focus:border-accent focus-visible:ring-accent/20",
          )}
          name="q"
          placeholder="Search people, communities, worlds, events..."
          ref={inputRef}
          role="combobox"
          value={query}
          onChange={(event) => {
            if (event.currentTarget.value.trim() !== query.trim()) reset();
            else setActiveIndex(-1);
            setQuery(event.currentTarget.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            if (event.key === "Escape") {
              event.preventDefault();
              dismiss();
            } else if (event.key === "ArrowDown" && preview.length > 0) {
              event.preventDefault();
              setIsOpen(true);
              setActiveIndex((current) => (current + 1) % preview.length);
            } else if (event.key === "ArrowUp" && preview.length > 0) {
              event.preventDefault();
              setIsOpen(true);
              setActiveIndex((current) => current <= 0 ? preview.length - 1 : current - 1);
            } else if (event.key === "Enter" && selectedIndex >= 0 && preview[selectedIndex]) {
              event.preventDefault();
              selectSuggestion(preview[selectedIndex]);
            }
          }}
        />
        {query ? (
          <button
            aria-label="Clear search"
            className={cn("absolute top-2 right-1 flex size-10 items-center justify-center rounded-control focus-visible:ring-2 focus-visible:ring-focus", isInverse ? "text-white/70 hover:text-white" : "text-muted hover:text-foreground")}
            type="button"
            onClick={() => {
              reset();
              setQuery("");
              dismiss();
              inputRef.current?.focus();
            }}
          ><X aria-hidden="true" className="size-4" /></button>
        ) : null}
        {expanded ? (
          <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-card border border-border bg-surface-strong text-foreground shadow-panel">
            <div id={listboxId} role="listbox" aria-label="Search suggestions">
              {preview.map((result, index) => {
                const label = result.entityType === "profile"
                  ? result.profileType === "person" ? "Person" : "Community"
                  : result.entityType === "event" ? "Event" : "World";
                const logoOnly = !result.profileImageUrl && Boolean(result.logoImageUrl);
                const imageUrl = result.profileImageUrl ?? result.imageUrl ?? result.logoImageUrl;
                return (
                  <button
                    aria-selected={selectedIndex === index}
                    className={cn("flex min-h-16 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-elevated", selectedIndex === index ? "bg-surface-elevated" : undefined)}
                    id={`${listboxId}-${index}`}
                    key={`${result.entityType}:${result.slug}`}
                    role="option"
                    tabIndex={-1}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectSuggestion(result)}
                  >
                    <span className="relative shrink-0">
                      {result.entityType === "profile" && !logoOnly ? (
                        <ProfileAvatarImage alt="" appearance={result.avatarAppearance} className="size-9 rounded-control" label={result.title} sizes="36px" src={imageUrl} />
                      ) : (
                        <EntityImage alt="" className="size-9 rounded-control" imageClassName={logoOnly ? "object-contain" : undefined} label={result.title} sizes="36px" src={imageUrl} />
                      )}
                      {result.trustLabel === "claimed_verified" ? <VerifiedTrustMark className="verified-trust-mark--avatar" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{result.title}</span>
                      {result.trustLabel === "community_submitted" || result.trustLabel === "unclaimed" ? (
                        <span className="block truncate text-xs text-muted">{result.trustLabel === "community_submitted" ? "Community submitted" : "Unclaimed"}</span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-xs text-muted">{label}</span>
                  </button>
                );
              })}
            </div>
            <Link className="block border-t border-border px-4 py-3 text-sm text-muted hover:bg-surface-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus" href={resultsHref} onClick={() => { captureSubmission(); dismiss(); }}>View all results</Link>
          </div>
        ) : null}
      </div>
      {filter === "all" ? null : <input name="type" type="hidden" value={filter} />}
      <button className={cn(buttonVariants({ size: "lg", variant: isInverse ? "inversePrimary" : "primary" }), "min-h-14 px-6 font-semibold")} type="submit">Search VRDex</button>
    </form>
  );
}
