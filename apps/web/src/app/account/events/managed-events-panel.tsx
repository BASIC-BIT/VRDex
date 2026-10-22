"use client";

import Link from "next/link";
import { useConvexAuth, usePaginatedQuery, useQuery } from "convex/react";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@convex-generated-api";

import { buttonVariants } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { EventInventoryList, type EventInventoryCriteria, type EventInventoryListProps, type EventInventoryView } from "./event-inventory-list";

const candidatePageSize = 20;
const maxAutomaticAdvances = 3;

type InventoryControls = Pick<EventInventoryListProps, "view" | "query" | "onViewChange" | "onQueryChange" | "onRetry">;

class InventoryErrorBoundary extends Component<InventoryControls & { children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <EventInventoryList {...this.props} content={{ kind: "failed" }} onLoadMore={() => undefined} /> : this.props.children;
  }
}

function InventoryPager({ criteria, controls }: { criteria: EventInventoryCriteria; controls: InventoryControls }) {
  const { results, status, loadMore } = usePaginatedQuery(api.eventInventory.listPage, criteria, { initialNumItems: candidatePageSize });
  // Only traversal progress lives here. Query results remain owned by Convex so
  // session/authority changes cannot leave a stale copied inventory behind.
  const progress = useRef<{ automaticAdvances: number; previousCount: number; handled: typeof loadMore | null }>({ automaticAdvances: 0, previousCount: 0, handled: null });
  useEffect(() => {
    if (status !== "CanLoadMore" || progress.current.handled === loadMore) return;
    const emptyPage = results.length === progress.current.previousCount;
    progress.current.handled = loadMore;
    progress.current.previousCount = results.length;
    if (emptyPage && progress.current.automaticAdvances < maxAutomaticAdvances) {
      progress.current.automaticAdvances += 1;
      loadMore(candidatePageSize);
    }
  }, [status, results.length, loadMore]);

  return <EventInventoryList {...controls} content={{
    kind: status === "LoadingFirstPage" || status === "LoadingMore" ? "loading" : "ready",
    rows: results,
    hasMore: status === "CanLoadMore" || status === "LoadingMore",
  }} onLoadMore={() => loadMore(candidatePageSize)} />;
}

function InventoryTraversal({ timeZone, normalizedQuery, controls }: { timeZone: string; normalizedQuery: string; controls: InventoryControls }) {
  const [asOf] = useState(Date.now);
  return <InventoryPager controls={controls} criteria={{ view: controls.view, query: normalizedQuery, timeZone, asOf }} />;
}

function InventoryShortcuts() {
  const communities = useQuery(api.events.listManagedCommunities, {});
  const reportsAllowed = useQuery(api.eventCorrections.getEventReportAccess, {});
  return <div className="flex flex-wrap gap-2">
    {reportsAllowed ? <Link className={buttonVariants({ variant: "secondary" })} href="/account/events/reports">Event reports</Link> : null}
    {communities?.map(community => <Link aria-label={`Add event for ${community.displayName}`} className={buttonVariants({ variant: "secondary" })} href={`/${community.slug}/events/create`} key={community.profileId}>{`Manage ${community.displayName} event`}</Link>)}
  </div>;
}

function ConnectedInventory({ viewerId }: { viewerId: string }) {
  const [view, setView] = useState<EventInventoryView>("all");
  const [query, setQuery] = useState("");
  const [timeZone, setTimeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [refresh, setRefresh] = useState(0);
  const normalizedQuery = query.trim().replace(/\s+/g, " ").toLowerCase();

  useEffect(() => {
    const browserClock = () => ({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", day: new Date().toLocaleDateString("en-CA") });
    let clock = browserClock();
    const refreshClock = (force: boolean) => {
      const next = browserClock();
      if (force || next.timeZone !== clock.timeZone || next.day !== clock.day) {
        setTimeZone(next.timeZone);
        setRefresh(value => value + 1);
        clock = next;
      }
    };
    const onFocus = () => refreshClock(true);
    const onVisibility = () => { if (document.visibilityState === "visible") refreshClock(true); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = window.setInterval(() => refreshClock(false), 60_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(timer);
    };
  }, []);

  const traversalKey = JSON.stringify([viewerId, view, normalizedQuery, timeZone, refresh]);
  const controls = { view, query, onViewChange: setView, onQueryChange: setQuery, onRetry: () => setRefresh(value => value + 1) };
  return <InventoryErrorBoundary {...controls} key={traversalKey}>
    <div className="grid min-w-0 gap-6">
      <InventoryShortcuts />
      <InventoryTraversal controls={controls} normalizedQuery={normalizedQuery} timeZone={timeZone} />
    </div>
  </InventoryErrorBoundary>;
}

export function ManagedEventsPanel() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const viewer = useQuery(api.accounts.viewer, isAuthenticated && !isLoading ? {} : "skip");
  return <div className="grid min-w-0 gap-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <SectionTitle>My events</SectionTitle>
      <Link className={buttonVariants({ variant: "primary" })} href="/events/new">Add event</Link>
    </div>
    {isLoading || (isAuthenticated && viewer === undefined) ? <p aria-busy="true" className="text-sm text-muted">Loading events…</p>
      : !isAuthenticated ? <Link className={buttonVariants({ variant: "secondary" })} href="/sign-in?returnTo=%2Faccount%2Fevents">Sign in</Link>
        : viewer ? <ConnectedInventory key={viewer.user.id} viewerId={viewer.user.id} /> : <Notice variant="warning">You do not have access to this page.</Notice>}
  </div>;
}
