"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useConvex } from "convex/react";
import { Search, ExternalLink } from "lucide-react";
import { api } from "@convex-generated-api";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import {
  personIdentityOption,
  searchIdentityOption,
  type EventIdentityOption,
} from "@/lib/event-editor-identity";
import { ProfileSuggestion } from "../_components/profile-suggestion";

export type EventIdentityPickerProps = {
  kind: EventIdentityOption["kind"];
  selectedSlug?: string | null;
  selectedOption?: EventIdentityOption | null;
  shortcuts?: readonly EventIdentityOption[];
  disabled?: boolean;
  required?: boolean;
  onSelect(option: EventIdentityOption): void;
  /** Presentation hydration only; never treat this as an authored selection. */
  onResolve?(option: EventIdentityOption): void;
  onClear(): void;
  manualAction?: { label: string; onChoose(text: string): void };
};

type SearchState = {
  kind: EventIdentityOption["kind"];
  query: string;
  options: EventIdentityOption[];
};

export function EventIdentityPicker({
  kind,
  selectedSlug,
  selectedOption,
  shortcuts = [],
  disabled,
  required,
  onSelect,
  onResolve,
  onClear,
  manualAction,
}: EventIdentityPickerProps) {
  const client = useConvex();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [fetched, setFetched] = useState<SearchState | null>(null);
  const [cachedSelection, setCachedSelection] =
    useState<EventIdentityOption | null>(null);
  const onResolveRef = useRef(onResolve);
  useEffect(() => { onResolveRef.current = onResolve; }, [onResolve]);
  const changeRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const text = query.trim();
  const label =
    kind === "person"
      ? "Performer"
      : kind === "community"
        ? "Community"
        : "Where";
  const matching = (option: EventIdentityOption | null | undefined) =>
    option?.kind === kind && option.slug === selectedSlug;
  const selected = matching(selectedOption)
    ? selectedOption
    : matching(cachedSelection)
      ? cachedSelection
      : null;
  const showSearch = !selectedSlug || editing;
  const options = text
    ? fetched?.query === text && fetched.kind === kind
      ? fetched.options
      : []
    : shortcuts.filter((option) => option.kind === kind).slice(0, 8);

  useEffect(() => {
    const slug = selectedSlug;
    if (!slug) return;
    let current = true;
    function retainResolved(option: EventIdentityOption) {
      setCachedSelection(option);
      onResolveRef.current?.(option);
    }
    async function hydrate(slug: string) {
      if (kind === "world") {
        const world = await client.query(api.worlds.getPublicBySlug, {
          slug,
          now: Date.now(),
        });
        if (current && world)
          retainResolved({
            kind,
            slug: world.slug,
            title: world.displayName,
            href: `/${world.slug}`,
            imageUrl:
              "heroImageUrl" in world && typeof world.heroImageUrl === "string"
                ? world.heroImageUrl
                : undefined,
            imageKind: "profile",
            context: world.tags.slice(0, 3).join(" / ") || undefined,
          });
      } else {
        const profile = await client.query(api.profiles.getPublicBySlug, {
          slug,
          profileType: kind,
          includeTelemetry: false,
        });
        if (current && profile)
          retainResolved({
            kind,
            slug: profile.slug,
            title: profile.displayName,
            href: `/${profile.slug}`,
            imageUrl: profile.avatarImageUrl,
            imageKind:
              profile.mediaKit.primaryLogo?.imageUrl !== undefined &&
              profile.avatarImageUrl === profile.mediaKit.primaryLogo.imageUrl
                ? "logo"
                : "profile",
            appearance: profile.mediaKit.avatarAppearance,
            trustLabel: profile.trustLabel,
            context:
              [
                ...new Set([
                  ...(profile.profileType === "person"
                    ? profile.person.roleTags
                    : profile.community.categoryTags),
                  ...profile.tags,
                ]),
              ]
                .slice(0, 3)
                .join(" / ") || undefined,
          });
      }
    }
    void hydrate(slug).catch(() => {
      /* Existing links survive unavailable public hydration. */
    });
    return () => {
      current = false;
    };
  }, [client, kind, selectedSlug]);

  useEffect(() => {
    if (!text || !showSearch || disabled) return;
    let current = true;
    async function search() {
      const results =
        kind === "person"
          ? (
              await client.query(api.profiles.lookupPeople, {
                query: text,
                limit: 8,
              })
            ).map(personIdentityOption)
          : (
              await client.query(api.search.searchUniversal, {
                query: text,
                limit: 8,
                ...(kind === "community"
                  ? ({
                      entityType: "profile",
                      profileType: "community",
                    } as const)
                  : ({ entityType: "world" } as const)),
              })
            ).flatMap((result) => searchIdentityOption(result) ?? []);
      if (current)
        setFetched({
          kind,
          query: text,
          options: results.filter((option) => option.kind === kind).slice(0, 8),
        });
    }
    void search().catch(() => {
      if (current) setFetched({ kind, query: text, options: [] });
    });
    return () => {
      current = false;
    };
  }, [client, disabled, kind, showSearch, text]);

  useEffect(() => {
    if (activeIndex >= 0 && open)
      document
        .getElementById(`${listId}-${activeIndex}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, listId, open]);

  function choose(option: EventIdentityOption) {
    setCachedSelection(option);
    setQuery("");
    setEditing(false);
    setOpen(false);
    setActiveIndex(-1);
    onSelect(option);
    requestAnimationFrame(() => changeRef.current?.focus());
  }
  function close() {
    setOpen(false);
    setActiveIndex(-1);
    if (selectedSlug) {
      setEditing(false);
      setQuery("");
      requestAnimationFrame(() => changeRef.current?.focus());
    }
  }

  return (
    <div
      ref={rootRef}
      className="relative grid gap-2"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      {selectedSlug ? (
        <div className="flex min-h-14 items-center gap-3 rounded-md border border-border p-2">
          <div
            className="flex min-w-0 flex-1 items-center gap-3"
            data-testid="selected-identity"
          >
            {selected ? (
              <ProfileSuggestion option={selected} />
            ) : (
              <>
                <span className="h-[38px] w-[38px] shrink-0 animate-pulse rounded-md bg-surface-strong" />
                <span
                  className="h-4 w-28 animate-pulse rounded bg-surface-strong"
                  role="status"
                  aria-label="Loading"
                />
              </>
            )}
          </div>
          <button
            ref={changeRef}
            type="button"
            className="text-sm text-muted hover:text-foreground"
            disabled={disabled}
            onClick={() => {
              setEditing(true);
              setOpen(true);
              requestAnimationFrame(() =>
                rootRef.current?.querySelector("input")?.focus(),
              );
            }}
          >
            Change
          </button>
          <button
            type="button"
            className="text-sm text-muted hover:text-foreground"
            disabled={disabled}
            onClick={() => {
              setQuery("");
              setCachedSelection(null);
              setEditing(false);
              setOpen(true);
              onClear();
              requestAnimationFrame(() =>
                rootRef.current?.querySelector("input")?.focus(),
              );
            }}
          >
            Clear
          </button>
        </div>
      ) : null}
      {showSearch ? (
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted"
          />
          <Input
            // A search query is not an accepted identity or manual value.
            required={required && !selectedSlug}
            pattern={required && !selectedSlug ? "(?!)" : undefined}
            role="combobox"
            aria-label={label}
            aria-autocomplete="list"
            aria-expanded={open && !disabled && options.length > 0}
            aria-controls={
              open && !disabled && options.length > 0 ? listId : undefined
            }
            aria-activedescendant={
              open && !disabled && activeIndex >= 0 && options[activeIndex]
                ? `${listId}-${activeIndex}`
                : undefined
            }
            placeholder={
              kind === "person"
                ? "Search performers"
                : kind === "world"
                  ? "Search worlds"
                  : "Search communities"
            }
            className="w-full pl-9"
            disabled={disabled}
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setActiveIndex(-1);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close();
              }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setOpen(true);
                if (options.length)
                  setActiveIndex((index) =>
                    event.key === "ArrowDown"
                      ? (index + 1) % options.length
                      : index <= 0
                        ? options.length - 1
                        : index - 1,
                  );
              }
              if (event.key === "Enter") {
                event.preventDefault();
                if (
                  open &&
                  !disabled &&
                  activeIndex >= 0 &&
                  options[activeIndex]
                )
                  choose(options[activeIndex]);
              }
            }}
          />
          {open &&
          !disabled &&
          (options.length > 0 || (text && manualAction)) ? (
            <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-border bg-surface-elevated shadow-lg">
              {!text && kind === "community" && options.length > 0 ? (
                <p className="px-3 pt-2 text-xs text-muted">Your communities</p>
              ) : null}
              <div className="grid max-h-80 grid-cols-[minmax(0,1fr)_2.5rem] overflow-y-auto">
                <div id={listId} role="listbox" aria-label={label}>
                  {options.map((option, index) => (
                    <button
                      key={`${option.kind}:${option.slug}`}
                      id={`${listId}-${index}`}
                      type="button"
                      role="option"
                      tabIndex={-1}
                      aria-selected={activeIndex === index}
                      className={cn(
                        "flex h-20 w-full items-center gap-3 px-3 text-left hover:bg-surface-strong",
                        activeIndex === index && "bg-surface-strong",
                      )}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => choose(option)}
                    >
                      <ProfileSuggestion option={option} />
                    </button>
                  ))}
                </div>
                <div aria-label="Profile links">
                  {options.map((option) => (
                    <a
                      key={`${option.kind}:${option.slug}`}
                      href={option.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`View profile for ${option.title}${option.context ? `, ${option.context}` : ""}`}
                      className="flex h-20 items-center justify-center text-muted hover:text-foreground"
                    >
                      <ExternalLink aria-hidden className="h-4 w-4" />
                    </a>
                  ))}
                </div>
              </div>
              {text && manualAction ? (
                <button
                  type="button"
                  className="w-full border-t border-border px-3 py-3 text-left text-sm hover:bg-surface-strong"
                  onClick={() => {
                    manualAction.onChoose(text);
                    setQuery("");
                    setOpen(false);
                    setActiveIndex(-1);
                    requestAnimationFrame(() => {
                      // Preserve a callback's deliberate focus handoff, including
                      // a replacement manual-entry control mounted by its parent.
                      if (document.activeElement === document.body) {
                        rootRef.current?.querySelector("input")?.focus();
                      }
                    });
                  }}
                >
                  {manualAction.label}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
