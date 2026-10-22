"use client";

import { ConvexProviderWithAuth, type ConvexReactClient } from "convex/react";
import { getFunctionName, type FunctionArgs, type FunctionReference, type FunctionReturnType } from "convex/server";
import { useEffect, useState } from "react";
import { api } from "@convex-generated-api";
import type { Id } from "../../../../../../convex/_generated/dataModel";

import { ManagedEventsPanel } from "@/app/account/events/managed-events-panel";
import type { EventInventoryRow } from "@/app/account/events/event-inventory-list";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";

type InventoryArgs = FunctionArgs<typeof api.eventInventory.listPage>;
type InventoryPage = FunctionReturnType<typeof api.eventInventory.listPage>;

const community = { slug: "afterglow", displayName: "Afterglow" };
const incomplete = { kind: "incomplete", eventDate: null } satisfies EventInventoryRow["schedule"];
// Synthetic identities exist only at this gated transport boundary. Row shapes
// and pagination arguments still derive from the generated production API.
const eventId = (value: string) => value as Id<"events">;
const intakeId = "intake-1" as Id<"eventIntakeDrafts">;
const staffDraft = { kind: "managed_event", id: eventId("staff-1"), eventId: eventId("staff-1"), title: "Harbor sessions", community, schedule: incomplete, thumbnailUrl: "/test-media/event-poster.png", state: "draft", continuation: { kind: "staff_editor", href: "/afterglow/events/harbor/edit" } } satisfies EventInventoryRow;
const rows: EventInventoryRow[] = [
  { kind: "intake_draft", id: intakeId, draftId: intakeId, title: "Harbor sessions", community, schedule: incomplete, thumbnailUrl: null, state: "draft", version: 1, expiresAt: Date.UTC(2099, 10, 20, 10), continuation: { kind: "intake_editor", href: "/events/new?draft=intake-1" } },
  staffDraft,
  { kind: "managed_event", id: eventId("staff-2"), eventId: eventId("staff-2"), title: "Date only night", community, schedule: { kind: "date_only", eventDate: "2099-10-24" }, thumbnailUrl: "/test-media/event-poster.png", state: "published", continuation: { kind: "staff_editor", href: "/afterglow/events/date-only/edit" } },
  { kind: "managed_event", id: eventId("staff-3"), eventId: eventId("staff-3"), title: "Unavailable night", community: { slug: "night-market", displayName: "Night Market" }, schedule: incomplete, thumbnailUrl: null, state: "cancelled", continuation: { kind: "unavailable" } },
  { kind: "own_contribution", id: eventId("own-1"), eventId: eventId("own-1"), title: "Past session", community: { slug: "night-market", displayName: "Night Market" }, schedule: { kind: "timed", startAt: Date.UTC(2020, 0, 1, 22), endAt: Date.UTC(2020, 0, 2, 2), eventDate: "2020-01-01", timezone: "UTC" }, thumbnailUrl: "/test-media/event-poster.png", state: "published", continuation: { kind: "public_event", href: "/night-market/events/past", canCorrect: true, canSuggest: true } },
  { kind: "own_contribution", id: eventId("own-2"), eventId: eventId("own-2"), title: "Retracted night", community, schedule: incomplete, thumbnailUrl: null, state: "retracted", continuation: { kind: "unavailable" } },
];
const matchingRow = (title: string): EventInventoryRow => ({ ...staffDraft, title });

function inventoryFixture(contributorOnly: boolean, failShortcuts: boolean) {
  const listeners = new Set<() => void>();
  const cache = new Map<string, unknown>();
  let shortcutsUnavailable = failShortcuts;
  let slowReleased = false;
  let failed = false;
  let reads = 0;
  sessionStorage.setItem("inventory-later-reads", "0");
  sessionStorage.setItem("inventory-protected-reads", "0");
  const notify = () => listeners.forEach(listener => listener());
  const release = () => { slowReleased = true; cache.clear(); notify(); };
  const recoverShortcuts = () => { shortcutsUnavailable = false; notify(); };
  window.addEventListener("inventory-release", release);
  window.addEventListener("inventory-recover-shortcuts", recoverShortcuts);
  const empty: unknown[] = [];
  const viewer = { user: { id: "fixture-viewer", name: "Fixture organizer", emailVerified: true } };
  const communities = contributorOnly ? [] : [{ profileId: "fixture-community", ...community }];

  function inventoryPage(args: InventoryArgs): InventoryPage | undefined {
    reads += 1;
    sessionStorage.setItem("inventory-protected-reads", String(reads));
    if (args.paginationOpts.numItems !== 20) throw new Error("Inventory fixture requires 20 candidate rows");
    const page = Number(args.paginationOpts.cursor ?? 0);
    if (contributorOnly && page < 4) return { page: [], isDone: false, continueCursor: String(page + 1) };
    if (args.query === "slow" && !slowReleased) return undefined;
    if (args.query === "failure" && !failed) {
      if (page > 0) { failed = true; throw new Error("Fixture contribution source failed"); }
      return { page: [], isDone: false, continueCursor: "1" };
    }
    if (args.query === "later") {
      sessionStorage.setItem("inventory-later-reads", String(Number(sessionStorage.getItem("inventory-later-reads")) + 1));
      return { page: page < 4 ? [] : [matchingRow("Later match")], isDone: page >= 4, continueCursor: String(page + 1) };
    }
    if (args.query === "slow" || args.query === "failure") return { page: [matchingRow(args.query === "slow" ? "Slow stale match" : "Recovered match")], isDone: true, continueCursor: "done" };
    const pageRows = rows.filter(row => {
      if (contributorOnly && row.kind === "managed_event") return false;
      if (args.view === "drafts" && row.state !== "draft") return false;
      if (args.view === "upcoming" && row.title !== "Date only night") return false;
      if (args.view === "past" && row.title !== "Past session") return false;
      return `${row.title ?? ""} ${row.community?.displayName ?? ""}`.toLowerCase().includes(args.query);
    });
    return { page: pageRows, isDone: true, continueCursor: "done" };
  }

  // The native Convex hook owns accumulation, cursors, loading and error
  // propagation. This local adapter replaces only network reads, never hooks.
  const client = {
    setAuth(_fetch: unknown, onChange: (authenticated: boolean) => void) { onChange(true); },
    clearAuth() {},
    logger: { warn() {} },
    async query(query: FunctionReference<"query">, args: { query?: string }) {
      if (getFunctionName(query) === "search:searchUniversal" && args.query?.toLowerCase().includes("aurora")) return [{ entityType: "profile", profileType: "person", slug: "playwright-dj-aurora", title: "Aurora", routePath: "/playwright-dj-aurora" }];
      return empty;
    },
    watchQuery(query: FunctionReference<"query">, args: InventoryArgs) {
      const name = getFunctionName(query);
      const key = JSON.stringify([name, args]);
      return {
        localQueryResult() {
          if (name === "accounts:viewer") return viewer;
          if (name === "events:listManagedCommunities") {
            if (shortcutsUnavailable) throw new Error("Fixture community source failed");
            return communities;
          }
          if (name === "eventCorrections:getEventReportAccess") return !contributorOnly;
          if (name !== "eventInventory:listPage") return empty;
          if (!cache.has(key)) {
            try { cache.set(key, inventoryPage(args)); }
            catch (error) { cache.set(key, error); }
          }
          const result = cache.get(key);
          if (result instanceof Error) throw result;
          return result;
        },
        onUpdate(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        journal: () => undefined,
      };
    },
  } as unknown as ConvexReactClient;
  return { client, dispose: () => { window.removeEventListener("inventory-release", release); window.removeEventListener("inventory-recover-shortcuts", recoverShortcuts); } };
}

function useFixtureAuth(session?: string) {
  const [signedOut, setSignedOut] = useState(session === "signed-out");
  useEffect(() => {
    const signOut = () => setSignedOut(true);
    window.addEventListener("inventory-sign-out", signOut);
    return () => window.removeEventListener("inventory-sign-out", signOut);
  }, []);
  return { isLoading: session === "loading", isAuthenticated: !signedOut && session !== "loading", fetchAccessToken: async () => signedOut ? null : "fixture-token" };
}

export function EventInventoryPreview({ contributorOnly, session }: { contributorOnly: boolean; session?: string }) {
  const [fixture, setFixture] = useState<ReturnType<typeof inventoryFixture> | null>(null);
  useEffect(() => {
    const value = inventoryFixture(contributorOnly, session === "shortcuts-failure");
    setFixture(value);
    return value.dispose;
  }, [contributorOnly, session]);
  const useInventoryFixtureAuth = () => useFixtureAuth(session);
  return fixture ? <ConvexProviderWithAuth client={fixture.client} useAuth={useInventoryFixtureAuth}>
    <div className="ph-no-capture" data-ph-no-capture><PageShell className="py-10"><PageContainer max="5xl"><PageNav><BrandLink /></PageNav><ManagedEventsPanel /></PageContainer></PageShell></div>
  </ConvexProviderWithAuth> : null;
}
