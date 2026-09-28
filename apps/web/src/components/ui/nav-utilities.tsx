"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useId, useRef, useState } from "react";

import { api } from "@convex-generated-api";
import {
  type SearchSuggestion,
  useSearchSuggestions,
} from "@/app/_components/use-search-suggestions";
import { buttonVariants } from "@/components/ui/button";
import { EntityImage } from "@/components/ui/entity-image";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/cn";
import { captureProductEvent } from "@/lib/posthog";

const convexEnabled = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

/**
 * One height for every nav control, including the loading placeholder.
 *
 * The account control resolved from a 40px skeleton to a 42px chip, which moved
 * the nav border and every route below it once auth settled. Sizing by content
 * is what let that happen, so these are sized by the row instead.
 */
const NAV_CONTROL_HEIGHT = "h-10 py-0";

/**
 * The nav's search: an icon that slides an input out to its left, rather than a
 * link to `/search`.
 *
 * The input is mounted only while open, and not just to keep the closed nav
 * quiet — a permanently rendered box would be a second `combobox` named
 * "Search" on every page, including `/search`, where the real one already is.
 *
 * There is no `<form>` and no submit: Enter on a highlighted suggestion goes to
 * that entity, and Enter on nothing does nothing. Sending a half-typed query to
 * `/search` from a nav that is one keystroke from the answer is the worse of the
 * two outcomes.
 */
function NavSearch() {
  const posthog = usePostHog();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const { activeIndex, setActiveIndex, suggestions } = useSearchSuggestions(query, "all");

  // `restoreFocus` for the closes a keyboard user makes from inside the box.
  // Unmounting the focused input otherwise drops focus to <body>, and the next
  // Tab starts from the top of the page.
  function close({ restoreFocus = false } = {}) {
    setIsOpen(false);
    setQuery("");
    setActiveIndex(-1);
    if (restoreFocus) {
      toggleRef.current?.focus();
    }
  }

  function selectSuggestion(result: SearchSuggestion) {
    captureProductEvent(posthog, "search_result_clicked", {
      entity_type: result.entityType,
      profile_type: result.profileType,
      surface: "nav",
    });
    close();
    router.push(result.routePath);
  }

  return (
    // No `relative` here: the listbox spans `NavUtilities` instead, so it starts
    // under the input and ends under the account control. Anchored to this box
    // it overhung the left edge of a phone screen.
    <div className="flex min-w-0 items-center">
      {isOpen ? (
        <input
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={suggestions.length > 0}
          aria-label="Search VRDex"
          autoFocus
          ref={inputRef}
          // `starting:` is the mount-time half of the slide; the element opens at
          // zero width and transitions to full on its first frame, with no effect
          // to schedule it.
          className="h-10 w-48 min-w-0 rounded-control border border-border bg-surface px-3 text-sm text-foreground opacity-100 outline-none transition-[width,opacity] duration-200 placeholder:text-muted focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 sm:w-64 starting:w-0 starting:opacity-0"
          placeholder="Search..."
          role="combobox"
          value={query}
          // Delayed so a tap on an option lands first. Checked against the live
          // input so a reopen inside the delay is not closed by the old blur.
          onBlur={() => window.setTimeout(() => {
            if (document.activeElement !== inputRef.current) {
              close();
            }
          }, 100)}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setActiveIndex(-1);
          }}
          onKeyDown={(event) => {
            // An IME uses these keys to pick and confirm candidates; they are
            // not combobox moves until composition ends.
            if (event.nativeEvent.isComposing) {
              return;
            }
            if (event.key === "Escape") {
              close({ restoreFocus: true });
              return;
            }
            if (event.key === "ArrowDown" && suggestions.length > 0) {
              event.preventDefault();
              setActiveIndex((current) => (current + 1) % suggestions.length);
              return;
            }
            if (event.key === "ArrowUp" && suggestions.length > 0) {
              event.preventDefault();
              setActiveIndex((current) => current <= 0 ? suggestions.length - 1 : current - 1);
              return;
            }
            if (event.key === "Enter" && activeIndex >= 0 && suggestions[activeIndex]) {
              event.preventDefault();
              selectSuggestion(suggestions[activeIndex]);
            }
          }}
        />
      ) : null}
      <button
        aria-expanded={isOpen}
        aria-label="Search"
        className={cn(buttonVariants({ variant: "ghost" }), "size-10 shrink-0 p-0")}
        ref={toggleRef}
        title="Search"
        type="button"
        // Keep focus on the input so clicking the toggle is one close, not a
        // blur-scheduled close racing a click that reopens.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => isOpen ? close({ restoreFocus: true }) : setIsOpen(true)}
      >
        <Search aria-hidden="true" className="size-4" />
      </button>
      {isOpen && suggestions.length > 0 ? (
        // `z-50` because the nav itself is sticky at `z-40`. Height-capped and
        // scrollable because the page cannot scroll it into view: the nav is stuck.
        <div
          className="absolute inset-x-0 top-full z-50 mt-2 grid max-h-[calc(100dvh-10rem)] overflow-y-auto rounded-card border border-border bg-surface-strong shadow-panel"
          id={listboxId}
          role="listbox"
        >
          {suggestions.map((result, index) => (
            <button
              aria-selected={activeIndex === index}
              className={cn(
                "grid gap-1 px-4 py-3 text-left hover:bg-surface-elevated",
                activeIndex === index ? "bg-surface-elevated" : undefined,
              )}
              id={`${listboxId}-${index}`}
              key={`${result.entityType}:${result.slug}`}
              // `aria-activedescendant` moves the highlight without moving
              // focus, so nothing scrolls a capped list to follow the arrows.
              ref={activeIndex === index ? (element) => element?.scrollIntoView({ block: "nearest" }) : undefined}
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
  );
}

function SignedOutControl() {
  return (
    <Link className={cn(buttonVariants({ variant: "secondary" }), NAV_CONTROL_HEIGHT)} href="/sign-in">
      Sign in
    </Link>
  );
}

function ConnectedAccountControl() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const viewer = useQuery(api.accounts.viewer, isAuthenticated ? {} : "skip");

  if (isLoading) {
    return <span aria-hidden="true" className="h-10 w-24 rounded-control border border-border bg-surface-strong" />;
  }

  if (!isAuthenticated) {
    return <SignedOutControl />;
  }

  const label = viewer?.user.name ?? viewer?.user.email ?? "Account";

  return (
    <Link
      className={cn(buttonVariants({ variant: "secondary" }), NAV_CONTROL_HEIGHT, "gap-2 pr-3 pl-1.5")}
      href="/account"
    >
      <EntityImage alt="" className="size-7 rounded-control" label={label} sizes="28px" src={viewer?.user.image} />
      <span>Account</span>
    </Link>
  );
}

function AccountControl({ mode }: { mode: "auto" | "signed-out" }) {
  return mode === "auto" && convexEnabled ? <ConnectedAccountControl /> : <SignedOutControl />;
}

export function NavUtilities({ accountMode = "auto" }: { accountMode?: "auto" | "signed-out" }) {
  return (
    // `min-w-0` so an open search can shrink to fit a phone-width row; the fixed
    // controls are grouped `shrink-0` so the input is the only thing that gives.
    <div className="relative ml-auto flex min-w-0 items-center justify-end gap-1">
      <NavSearch />
      <div className="flex shrink-0 items-center gap-1">
        <ThemeToggle className="size-10 p-0" />
        <AccountControl mode={accountMode} />
      </div>
    </div>
  );
}
