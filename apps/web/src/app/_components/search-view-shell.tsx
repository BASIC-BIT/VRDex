import Link from "next/link";
import type { ReactNode } from "react";

import { searchHref, type SearchViewKey } from "./search-view-state";
import { buttonVariants } from "@/components/ui/button";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
import { cn } from "@/lib/cn";

const SEARCH_CONTEXT = "Search across public people, communities, worlds, and events.";

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
              {activeView === "standard" ? "Search results" : "Search VRDex"}
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-muted sm:text-base">{SEARCH_CONTEXT}</p>
          </div>
          {activeView === "dj" ? (
            <Link className="w-fit text-sm font-medium text-accent-strong underline underline-offset-4" href={searchHref({ query })}>
              Search results
            </Link>
          ) : null}
          {searchControl}
        </header>

        {children}
      </PageContainer>
    </PageShell>
  );
}
