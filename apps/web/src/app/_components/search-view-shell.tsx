import Link from "next/link";
import type { ReactNode } from "react";

import { searchHref, SEARCH_VIEWS, type SearchViewKey } from "./search-view-state";
import { buttonVariants } from "@/components/ui/button";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
import { cn } from "@/lib/cn";

const SEARCH_CONTEXT = "Search across public people, communities, worlds, and events.";

function SearchViewSwitcher({
  activeView,
  query,
}: {
  activeView: SearchViewKey;
  query?: string;
}) {
  return (
    <nav aria-label="Search view" className="-mb-px flex min-w-0 gap-5 overflow-x-auto border-b border-border">
      {Object.values(SEARCH_VIEWS).map((view) => {
        const active = view.key === activeView;

        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-11 shrink-0 items-center border-b-2 px-0.5 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-accent/30",
              active
                ? "border-accent text-foreground"
                : "border-transparent text-muted hover:border-border-strong hover:text-foreground",
            )}
            href={searchHref({ query, view: view.key })}
            key={view.key}
          >
            {view.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function SearchViewShell({
  activeView,
  children,
  className,
  query,
  searchControl,
}: {
  activeView: SearchViewKey;
  children: ReactNode;
  className?: string;
  query?: string;
  searchControl: ReactNode;
}) {
  return (
    <PageShell className={className}>
      <PageContainer className="gap-5" max="7xl">
        <PageNav>
          <BrandLink />
          <Link className={cn(buttonVariants({ variant: "secondary" }), "ml-auto")} href="/submit">
            Add profile
          </Link>
        </PageNav>

        <header className="grid gap-4 pt-2">
          <div className="grid gap-2">
            <h1 className="text-3xl leading-none font-semibold tracking-[-0.045em] sm:text-5xl">
              Search VRDex
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-muted sm:text-base">{SEARCH_CONTEXT}</p>
          </div>
          <SearchViewSwitcher activeView={activeView} query={query} />
          {searchControl}
        </header>

        {children}
      </PageContainer>
    </PageShell>
  );
}
