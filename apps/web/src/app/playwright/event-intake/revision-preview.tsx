"use client";
import { useState } from "react";
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
function revisionFixture() {
  let fields: EventIntakePatch = { communitySlug: "afterglow", title: "Original title", eventDate: "2027-07-15", timeTba: true, venueLabel: "Original venue" };
  let version = 1;
  let draft = { _id: "fixture-draft", version, fields };
  let event = { eventId: "fixture-event", updatedAt: version, fields };
  const listeners = new Set<() => void>();
  const access = { canCorrect: true, canSuggest: false, canTakeOver: false, canRemove: false };
  const empty: unknown[] = [];
  const refresh = (patch: EventIntakePatch) => {
    fields = { ...fields, ...patch };
    version += 1;
    draft = { ...draft, version, fields };
    event = { ...event, updatedAt: version, fields };
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
    async mutation(mutation: FunctionReference<"mutation">, args: Record<string, unknown>) {
      const name = getFunctionName(mutation);
      sessionStorage.setItem("event-intake-revision-submission", JSON.stringify(args));
      const expected = name === "eventIntake:saveEventIntakeDraft" ? args.expectedVersion : args.expectedUpdatedAt;
      if (expected !== version) throw new ConvexError({ code: "VERSION_CONFLICT" });
      refresh(args.patch as EventIntakePatch);
      return name === "eventIntake:saveEventIntakeDraft" ? { draftId: draft._id, version } : { eventId: event.eventId, updatedAt: version };
    },
  } as unknown as ConvexReactClient;
  return { client, refresh };
}

export function EventIntakeRevisionPreview({ correction }: { correction: boolean }) {
  const [fixture] = useState(revisionFixture);
  const [refreshed, setRefreshed] = useState(false);
  return <ConvexProviderWithAuth client={fixture.client} useAuth={useFixtureAuth}>
    <main className="mx-auto max-w-3xl p-5">
      <button onClick={() => { fixture.refresh({ venueLabel: "New venue" }); setRefreshed(true); }}>Update elsewhere</button>
      {refreshed ? <output>Query refreshed</output> : null}
      {correction ? <EventContributionControls eventId="fixture-event" /> : <EventIntakeForm draftId="fixture-draft" />}
    </main>
  </ConvexProviderWithAuth>;
}
