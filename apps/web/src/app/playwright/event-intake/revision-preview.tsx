"use client";
import { useEffect, useState } from "react";
import { ConvexProviderWithAuth, type ConvexReactClient } from "convex/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { BrandLink, PageNav } from "@/components/ui/page-shell";
import { EventIntakeForm } from "../../events/event-intake-form";
import { EventContributionControls } from "../../events/event-contribution-controls";
import type { EventIntakePatch } from "../../../../../../packages/api-contracts/src/event-intake";

const fetchAccessToken = async () => "fixture-token";
const useFixtureAuth = () => ({ isLoading: false, isAuthenticated: true, fetchAccessToken });

// Exercise the connected forms and reactive queries with a local transport.
// The matching backend conflict checks have their own Convex tests.
function revisionFixture(correction: boolean, sourceMode?: string, staff = false) {
  let fields: EventIntakePatch = { communitySlug: "afterglow", title: "Original title", eventDate: "2027-07-15", timeTba: true, venueLabel: "Original venue" };
  if (correction) fields.lineup = [{ clientKey: "private-person", position: 0, performerLabel: "Private performer" }];
  if (sourceMode) fields = {};
  let version = 1;
  let completion: { sourceId: string; version: number } | undefined;
  let droppedCompletion = false;
  if (sourceMode && typeof sessionStorage !== "undefined") { const stored = sessionStorage.getItem("fixture-source-draft"); if (stored) ({fields, version} = JSON.parse(stored)); }
  let draft = { artworkSourceId: typeof sessionStorage !== "undefined" ? sessionStorage.getItem("fixture-artwork-source") ?? undefined : undefined, _id: "fixture-draft", version, fields, artworkAssetId: typeof sessionStorage !== "undefined" && sessionStorage.getItem("fixture-artwork") ? "art" : undefined };
  let event = { eventId: "fixture-event", updatedAt: version, fields };
  const listeners = new Set<() => void>();
  let access = { canCorrect: !staff, canSuggest: false, canTakeOver: staff, canRemove: staff };
  const empty: unknown[] = [];
  const communities = [{ slug: "afterglow", title: "Afterglow", imageUrl: "/test-media/event-poster.png" }, { slug: "playwright-afterglow-social", title: "Afterglow Social", imageUrl: "/test-media/event-poster.png" }];
  const publicCommunities = [...communities, { slug: "night-market", title: "Night Market", imageUrl: "/test-media/event-poster.png" }];
  const scrollCommunities = Array.from({ length: 8 }, (_, index) => ({ slug: `scroll-community-${index + 1}`, title: `Scroll Community ${index + 1}` }));
  let searchLoading = sourceMode === "search-loading";
  if (searchLoading && typeof window !== "undefined") window.addEventListener("release-community-search", () => { searchLoading = false; listeners.forEach(listener => listener()); }, { once: true });
  const people = [{ slug: "aurora", title: "Aurora", imageUrl: "/test-media/event-poster.png" }];
  const viewer = { user: { name: "Fixture contributor" } };
  const refresh = (patch: EventIntakePatch) => {
    fields = { ...fields, ...patch };
    if (draft?.artworkSourceId && "posterSourceId" in patch && fields.posterSourceId !== draft.artworkSourceId) {
      draft = { ...draft, artworkSourceId: undefined, artworkAssetId: undefined };
      sessionStorage.removeItem("fixture-artwork-source");
    }
    version += 1;
    draft = { ...draft, version, fields };
    event = { ...event, updatedAt: version, fields };
    if (sourceMode) sessionStorage.setItem("fixture-source-draft", JSON.stringify({ fields, version }));
    listeners.forEach(listener => listener());
  };
  const client = {
    setAuth(_fetch: unknown, onChange: (authenticated: boolean) => void) { onChange(true); },
    clearAuth() {},
    async query(query: FunctionReference<"query">, args: { query?: string; profileType?: string; entityType?: string; slug?: string }) {
      const name = getFunctionName(query);
      if (name === "profiles:getPublicBySlug") {
        const community = publicCommunities.find(item => item.slug === args.slug);
        return community ? { slug: community.slug, displayName: community.title, avatarImageUrl: community.imageUrl, mediaKit: { primaryLogo: { imageUrl: community.imageUrl } } } : null;
      }
      if (name === "worlds:getPublicBySlug") return args.slug === "harbor-world" ? { slug: args.slug, displayName: "Harbor World", tags: [], heroImageUrl: "/test-media/event-poster.png" } : null;
      if (name === "search:searchUniversal") {
        if (searchLoading) await new Promise<void>(resolve => window.addEventListener("release-community-search", () => resolve(), { once: true }));
        if (args.entityType === "world") return [{ entityType: "world", slug: "harbor-world", title: "Harbor World", routePath: "/harbor-world", imageUrl: "/test-media/event-poster.png" }];
        const query = args.query?.toLowerCase() ?? "";
        return (query.startsWith("scroll") ? scrollCommunities : publicCommunities).filter(item => `${item.title} ${item.slug}`.toLowerCase().includes(query)).map(item => ({ ...item, entityType: "profile", profileType: "community", routePath: `/${item.slug}`, logoImageUrl: "imageUrl" in item ? item.imageUrl : undefined }));
      }
      return null;
    },
    watchQuery(query: FunctionReference<"query">, args?: { query?: string; profileType?: string }) {
      return {
        localQueryResult: () => {
          switch (getFunctionName(query)) {
            case "eventIntake:getEventIntakeDraft": return draft;
            case "accounts:viewer": return viewer;
            case "events:listManagedCommunities": return communities.map((community, index) => ({ profileId: `community-${index}`, slug: community.slug, displayName: community.title, imageUrl: community.imageUrl, roleLabel: index === 0 ? "Owner" : "Staff" }));
            case "search:searchUniversal": {
              if (args?.profileType === "community") {
                if (searchLoading) return undefined;
                const query = args.query?.toLowerCase() ?? "";
                const results = query.startsWith("scroll") ? scrollCommunities : communities;
                return results.filter(community => `${community.title} ${community.slug}`.toLowerCase().includes(query));
              }
              return args?.profileType === "person" && args.query?.toLowerCase().includes("aurora") ? people : empty;
            }
            case "eventCorrections:getOwnContributedEvent": return event;
            case "eventCorrections:getEventContributionAccess": return access;
            default: return empty;
          }
        },
        onUpdate: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        journal: () => undefined,
      };
    },
    async action(action: FunctionReference<"action">, args: { expectedVersion: number }) {
      sessionStorage.setItem("event-intake-review-command", getFunctionName(action));
      if (args.expectedVersion !== version) throw new ConvexError({ code: "VERSION_CONFLICT" });
      if (sourceMode === "duplicates" && !fields.duplicateAcknowledgements?.includes("similar-event")) throw new ConvexError({ code: "NEAR_DUPLICATE", choices: [{ eventId: "similar-event", title: "Another Afterglow Night", eventPath: "/playwright-afterglow-social/events/playwright-afterglow-harbor-sessions" }] });
      sessionStorage.setItem("fixture-published", JSON.stringify(fields));
      return { eventPath: "/playwright-afterglow-social/events/playwright-afterglow-harbor-sessions" };
    },
    async mutation(mutation: FunctionReference<"mutation">, args: Record<string, unknown>) {
      const name = getFunctionName(mutation);
      sessionStorage.setItem("event-intake-review-command", name);
      sessionStorage.setItem("event-intake-review-count", String(Number(sessionStorage.getItem("event-intake-review-count") ?? "0") + 1));
      if (sessionStorage.getItem("event-intake-review-defer") === "true") await new Promise<void>(resolve => window.addEventListener("event-intake-review-release", () => resolve(), { once: true }));
      sessionStorage.setItem("event-intake-revision-submission", JSON.stringify(args));
      if (name === "eventCorrections:takeOverContributedEvent") {
        access = { ...access, canTakeOver: false };
        listeners.forEach(listener => listener());
        return true;
      }
      if (name === "eventCorrections:removeContributedEvent") return true;
      const expected = name === "eventIntake:saveEventIntakeDraft" ? args.expectedVersion : args.expectedUpdatedAt;
      if (expected !== version) throw new ConvexError({ code: "VERSION_CONFLICT" });
      const patch = args.patch as EventIntakePatch;
      refresh(patch);
      return name === "eventIntake:saveEventIntakeDraft" ? { draftId: draft._id, version } : { eventId: event.eventId, updatedAt: version };
    },
  } as unknown as ConvexReactClient;

  const transport: typeof fetch = async (input, init) => {
    if (String(input).endsWith("/fixture-upload")) {
      if (sourceMode === "upload-stale") refresh({ venueLabel: "Changed elsewhere" });
      return new Response(null, { status: 204 });
    }
    const { operation, input: args } = JSON.parse(String(init?.body));
    if ("actorUserId" in args) throw new Error("Browser actor forbidden");
    switch (operation) {
      case "poster_upload_begin": {
        const count = Number(sessionStorage.getItem("fixture-upload-count") ?? "0") + 1;
        sessionStorage.setItem("fixture-upload-count", String(count));
        return Response.json({ posterAssetId: `poster-${count}`, expiresAt: Date.now() + 60000, transfer: { method: "POST", url: `${location.origin}/fixture-upload`, fields: {}, fileField: "file" } });
      }
      case "poster_upload_complete":
        if (sourceMode === "completion-delay") await new Promise<void>(resolve => window.addEventListener("release-poster-completion", () => resolve(), { once: true }));
        if (sourceMode === "derivative-failure" && !sessionStorage.getItem("fixture-derivative-failed")) { sessionStorage.setItem("fixture-derivative-failed", "true"); return Response.json({}, { status: 503 }); }
        if (args.expectedVersion !== undefined && args.expectedVersion !== version && !(completion && completion.sourceId === args.posterAssetId && completion.version === version && args.expectedVersion === version - 1)) return Response.json({}, { status: 409 });
        if (!draft.artworkSourceId && fields.posterSourceId === args.posterAssetId) {
          draft = { ...draft, artworkSourceId: args.posterAssetId, artworkAssetId: "art" };
          sessionStorage.setItem("fixture-artwork-source", args.posterAssetId);
          refresh({});
          completion = { sourceId: args.posterAssetId, version };
        }
        if (sourceMode === "completion-response-lost" && !droppedCompletion) { droppedCompletion = true; throw new TypeError("Failed to fetch"); }
        return Response.json({ posterAssetId: args.posterAssetId, version, artworkAssetId: draft.artworkSourceId === args.posterAssetId ? "art" : undefined });
      case "poster_read": {
        if (sourceMode === "preview-failure") return Response.json({}, { status: 503 });
        if (sourceMode === "replacement-delay" && args.posterAssetId === "poster-2") await new Promise<void>(resolve => window.addEventListener("release-poster-preview", () => resolve(), { once: true }));
        const response = await fetch("/test-media/event-poster.png");
        const dataUrl = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); void response.blob().then(blob => reader.readAsDataURL(blob)); });
        return Response.json({ dataUrl: `${dataUrl}#${args.posterAssetId}` });
      }
      case "artwork_select": {
        if (args.expectedVersion !== version) return Response.json({}, { status: 409 });
        const sourceId = args.posterAssetId;
        draft = { ...draft, artworkAssetId: sourceId ? "art" : undefined, artworkSourceId: sourceId ?? undefined };
        if (sourceId) sessionStorage.setItem("fixture-artwork-source", sourceId);
        else sessionStorage.removeItem("fixture-artwork-source");
        refresh({}); sessionStorage.setItem("fixture-artwork", "selected");
        return Response.json({ artworkAssetId: sourceId ? "art" : null, artworkSourceId: sourceId, version });
      }
      case "extract":
        if (sourceMode === "extraction-delay") await new Promise<void>(resolve => window.addEventListener("release-extraction", () => resolve(), { once: true }));
        sessionStorage.setItem("fixture-extraction", JSON.stringify(args));
        if (sourceMode === "stale") refresh({ venueLabel: "Changed elsewhere" });
        return Response.json({ event: { title: sourceMode === "poster" ? null : "Afterglow Night", communitySlug: null, eventDate: null, start: null, end: null, startDate: null, endDate: null, timezone: null, venueLabel: null, summary: null, sourceUrl: null }, lineup: [], evidence: [{ fieldPath: "event.title", origin: "text", excerpt: "Afterglow Night", assessment: "explicit" }], questions: [{ fieldPath: sourceMode === "poster" ? "source" : "timezone", reason: sourceMode === "poster" ? "disabled" : "Which time zone?", alternatives: [] }] });
      default: throw new Error("Unexpected fixture operation");
    }
  };
  return { client, refresh, transport };
}

export function EventIntakeRevisionPreview({ correction, sourceMode, staff = false, initialCommunitySlug }: { correction: boolean; sourceMode?: string; staff?: boolean; initialCommunitySlug?: string }) {
  const [fixture] = useState(() => revisionFixture(correction, sourceMode, staff));
  useEffect(() => {
    if (!sourceMode) return;
    const original = window.fetch;
    window.fetch = (input, init) => ["/api/event-intake", `${location.origin}/fixture-upload`].includes(String(input)) ? fixture.transport(input, init) : original(input, init);
    return () => { window.fetch = original; };
  }, [fixture, sourceMode]);
  const [refreshed, setRefreshed] = useState(false);
  return <ConvexProviderWithAuth client={fixture.client} useAuth={useFixtureAuth}>
    <main className="mx-auto w-full max-w-6xl p-5">
      {sourceMode ? <PageNav><BrandLink /></PageNav> : null}
      {!sourceMode ? <button onClick={() => { fixture.refresh({ venueLabel: "New venue" }); setRefreshed(true); }}>Update elsewhere</button> : null}
      {refreshed ? <output>Query refreshed</output> : null}
      {correction ? <EventContributionControls eventId="fixture-event" /> : <EventIntakeForm heading={sourceMode ? <h1 className="text-3xl font-semibold">Add event</h1> : undefined} draftId={initialCommunitySlug ? undefined : "fixture-draft"} initialCommunitySlug={initialCommunitySlug} />}
    </main>
  </ConvexProviderWithAuth>;
}
