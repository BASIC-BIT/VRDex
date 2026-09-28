"use client";
import { useEffect, useState } from "react";
import { ConvexProviderWithAuth, type ConvexReactClient } from "convex/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { EventIntakeForm } from "../../events/event-intake-form";
import { EventContributionControls } from "../../events/event-contribution-controls";
import type { EventIntakePatch } from "../../../../../../packages/api-contracts/src/event-intake";

const fetchAccessToken = async () => "fixture-token";
const useFixtureAuth = () => ({ isLoading: false, isAuthenticated: true, fetchAccessToken });

// Exercise the connected forms and reactive queries with a local transport.
// The matching backend conflict checks have their own Convex tests.
function revisionFixture(sourceMode?: string, staff = false) {
  let fields: EventIntakePatch = { communitySlug: "afterglow", title: "Original title", eventDate: "2027-07-15", timeTba: true, venueLabel: "Original venue" };
  if (sourceMode) fields = {};
  let version = 1;
  if (sourceMode && typeof sessionStorage !== "undefined") { const stored = sessionStorage.getItem("fixture-source-draft"); if (stored) ({fields, version} = JSON.parse(stored)); }
  let draft = { artworkSourceId: typeof sessionStorage !== "undefined" ? sessionStorage.getItem("fixture-artwork-source") ?? undefined : undefined, _id: "fixture-draft", version, fields, artworkAssetId: typeof sessionStorage !== "undefined" && sessionStorage.getItem("fixture-artwork") ? "art" : undefined };
  let event = { eventId: "fixture-event", updatedAt: version, fields };
  const listeners = new Set<() => void>();
  let access = { canCorrect: !staff, canSuggest: false, canTakeOver: staff, canRemove: staff };
  const empty: unknown[] = [];
  const refresh = (patch: EventIntakePatch) => {
    fields = { ...fields, ...patch };
    version += 1;
    draft = { ...draft, version, fields };
    event = { ...event, updatedAt: version, fields };
    if (sourceMode) sessionStorage.setItem("fixture-source-draft", JSON.stringify({ fields, version }));
    listeners.forEach(listener => listener());
  };
  const client = {
    setAuth(_fetch: unknown, onChange: (authenticated: boolean) => void) { onChange(true); },
    clearAuth() {},
    watchQuery(query: FunctionReference<"query">) {
      return {
        localQueryResult: () => {
          switch (getFunctionName(query)) {
            case "eventIntake:getEventIntakeDraft": return draft;
            case "eventCorrections:getOwnContributedEvent": return event;
            case "eventCorrections:getEventContributionAccess": return access;
            default: return empty;
          }
        },
        onUpdate: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        journal: () => undefined,
      };
    },
    async action(_action: unknown, args: { expectedVersion: number }) {
      if (args.expectedVersion !== version) throw new ConvexError({ code: "VERSION_CONFLICT" });
      sessionStorage.setItem("fixture-published", JSON.stringify(fields));
      return { eventPath: "/playwright-afterglow-social/events/playwright-afterglow-harbor-sessions" };
    },
    async mutation(mutation: FunctionReference<"mutation">, args: Record<string, unknown>) {
      const name = getFunctionName(mutation);
      sessionStorage.setItem("event-intake-revision-submission", JSON.stringify(args));
      if (name === "eventCorrections:takeOverContributedEvent") {
        access = { ...access, canTakeOver: false };
        listeners.forEach(listener => listener());
        return true;
      }
      if (name === "eventCorrections:removeContributedEvent") return true;
      const expected = name === "eventIntake:saveEventIntakeDraft" ? args.expectedVersion : args.expectedUpdatedAt;
      if (expected !== version) throw new ConvexError({ code: "VERSION_CONFLICT" });
      refresh(args.patch as EventIntakePatch);
      return name === "eventIntake:saveEventIntakeDraft" ? { draftId: draft._id, version } : { eventId: event.eventId, updatedAt: version };
    },
  } as unknown as ConvexReactClient;

  const transport: typeof fetch = async (input, init) => {
    if (String(input).endsWith("/fixture-upload")) return new Response(null, { status: 204 });
    const { operation, input: args } = JSON.parse(String(init?.body));
    if ("actorUserId" in args) throw new Error("Browser actor forbidden");
    switch (operation) {
      case "poster_upload_begin": {
        const count = Number(sessionStorage.getItem("fixture-upload-count") ?? "0") + 1;
        sessionStorage.setItem("fixture-upload-count", String(count));
        return Response.json({ posterAssetId: `poster-${count}`, expiresAt: Date.now() + 60000, transfer: { method: "POST", url: `${location.origin}/fixture-upload`, fields: {}, fileField: "file" } });
      }
      case "poster_upload_complete": return Response.json({ posterAssetId: args.posterAssetId });
      case "poster_read": {
        if (sourceMode === "preview-failure") return Response.json({}, { status: 503 });
        if (sourceMode === "replacement-delay" && args.posterAssetId === "poster-2") await new Promise<void>(resolve => window.addEventListener("release-poster-preview", () => resolve(), { once: true }));
        const response = await fetch("/test-media/event-poster.png");
        const dataUrl = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); void response.blob().then(blob => reader.readAsDataURL(blob)); });
        return Response.json({ dataUrl: `${dataUrl}#${args.posterAssetId}` });
      }
      case "artwork_select":
        if (args.expectedVersion !== version) return Response.json({}, { status: 409 });
        draft = { ...draft, artworkAssetId: "art", artworkSourceId: args.posterAssetId };
        sessionStorage.setItem("fixture-artwork-source", args.posterAssetId);
        refresh({}); sessionStorage.setItem("fixture-artwork", "selected");
        return Response.json({ artworkAssetId: "art", version });
      case "extract":
        if (sourceMode === "stale") refresh({ venueLabel: "Changed elsewhere" });
        return Response.json({ event: { title: sourceMode === "poster" ? null : "Afterglow Night", communitySlug: null, eventDate: null, start: null, end: null, timezone: null, venueLabel: null, summary: null, sourceUrl: null }, lineup: [], evidence: [{ fieldPath: "event.title", origin: "text", excerpt: "Afterglow Night", assessment: "explicit" }], questions: [{ fieldPath: sourceMode === "poster" ? "source" : "timezone", reason: sourceMode === "poster" ? "disabled" : "Which time zone?", alternatives: [] }] });
      default: throw new Error("Unexpected fixture operation");
    }
  };
  return { client, refresh, transport };
}

export function EventIntakeRevisionPreview({ correction, sourceMode, staff = false }: { correction: boolean; sourceMode?: string; staff?: boolean }) {
  const [fixture] = useState(() => revisionFixture(sourceMode, staff));
  useEffect(() => {
    if (!sourceMode) return;
    const original = window.fetch;
    window.fetch = (input, init) => ["/api/event-intake", `${location.origin}/fixture-upload`].includes(String(input)) ? fixture.transport(input, init) : original(input, init);
    return () => { window.fetch = original; };
  }, [fixture, sourceMode]);
  const [refreshed, setRefreshed] = useState(false);
  return <ConvexProviderWithAuth client={fixture.client} useAuth={useFixtureAuth}>
    <main className="mx-auto max-w-3xl p-5">
      {sourceMode ? <h1 className="mb-6 text-3xl font-semibold">Add event</h1> : null}
      <button onClick={() => { fixture.refresh({ venueLabel: "New venue" }); setRefreshed(true); }}>Update elsewhere</button>
      {refreshed ? <output>Query refreshed</output> : null}
      {correction ? <EventContributionControls eventId="fixture-event" /> : <EventIntakeForm draftId="fixture-draft" />}
    </main>
  </ConvexProviderWithAuth>;
}
