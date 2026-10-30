"use client";

import { ConvexProvider, ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { useState } from "react";

import { EventEditorPage } from "../../events/event-editor-page";
import { EventSeriesNote } from "../../events/event-series-controls";
import type { EditableEvent } from "../../events/event-editor-form";

const previewClient = new ConvexReactClient("https://playwright-preview.convex.cloud");

export const previewEvent: EditableEvent = {
  id: "event-editor-preview",
  slug: "harbor-sessions-7k2m4q",
  title: "Afterglow Harbor Sessions",
  startAt: Date.UTC(2026, 8, 12, 22),
  doorsOpenAt: Date.UTC(2026, 8, 12, 21, 45),
  endAt: Date.UTC(2026, 8, 13, 2),
  timezone: "America/Indiana/Indianapolis",
  status: "scheduled",
  communityName: "Afterglow",
  communitySlug: "afterglow",
  summary: "An evening of music at the harbor.",
  source: {
    sourceType: "community",
    label: "Afterglow calendar",
    url: "https://example.com/events/harbor-sessions",
  },
  watchSurfaceEnabled: false,
  authoredMediaLinks: [],
  mediaLinks: [],
  worlds: [],
  participants: [],
  participantCount: 2,
  slotCount: 4,
  slots: [
    {
      clientKey: "preview-aurora",
      position: 0,
      startAt: Date.UTC(2026, 8, 12, 22),
      endAt: Date.UTC(2026, 8, 12, 23),
      displayLabel: "Aurora",
      roleLabel: "DJ",
      discord: previewDiscordTimestamps(),
      performer: { slug: "aurora", displayName: "Aurora", trustLabel: "claimed_verified" },
      source: { sourceType: "community", label: "Afterglow calendar" },
    },
    {
      clientKey: "preview-neon",
      position: 1,
      startAt: Date.UTC(2026, 8, 12, 23),
      endAt: Date.UTC(2026, 8, 13, 0),
      displayLabel: "Neon Harbor",
      roleLabel: "DJ",
      discord: previewDiscordTimestamps(),
      source: { sourceType: "community", label: "Afterglow calendar" },
    },
    {
      clientKey: "preview-lumen",
      position: 2,
      startAt: Date.UTC(2026, 8, 13, 0),
      endAt: Date.UTC(2026, 8, 13, 1),
      displayLabel: "Lumen",
      roleLabel: "DJ",
      discord: previewDiscordTimestamps(),
      performer: { slug: "lumen", displayName: "Lumen", trustLabel: "claimed_verified" },
      source: { sourceType: "community", label: "Afterglow calendar" },
    },
    {
      clientKey: "preview-closing",
      position: 3,
      startAt: Date.UTC(2026, 8, 13, 1),
      endAt: Date.UTC(2026, 8, 13, 2),
      displayLabel: "Closing session",
      roleLabel: "DJ",
      discord: previewDiscordTimestamps(),
      source: { sourceType: "community", label: "Afterglow calendar" },
    },
  ],
  notes: "Confirm the final artwork before publishing.",
  publicationState: "published",
  preservedParticipantAssociationIds: [],
  preservedSlotAssociationIds: [],
  preservedWorldAssociationIds: [],
};

function previewDiscordTimestamps() {
  return {
    shortTime: "<t:0:t>",
    longTime: "<t:0:T>",
    shortDate: "<t:0:d>",
    longDate: "<t:0:D>",
    shortDateTime: "<t:0:f>",
    longDateTime: "<t:0:F>",
    relative: "<t:0:R>",
  };
}

// Far ahead of both the server clock and the frozen test clock, so the night reads as upcoming on either.
const previewSeriesEvent: EditableEvent = {
  ...previewEvent,
  startAt: Date.UTC(2099, 8, 12, 22),
  doorsOpenAt: Date.UTC(2099, 8, 12, 21, 45),
  endAt: Date.UTC(2099, 8, 13, 2),
  slots: [],
  slotCount: 0,
  series: {
    id: "series-editor-preview",
    title: "Afterglow Harbor Sessions",
    summary: "An evening of music at the harbor.",
    timezone: "America/Indiana/Indianapolis",
    rule: { frequency: "weekly", weekday: 6, startTime: "18:00" },
    startsOn: "2099-09-12",
    state: "active",
  },
  overrides: ["summary"],
};

const serverRefusal = "Field is not overridden on this night.";

/** Stands in for Convex on the series editor: records each save, and refuses them under `?fail=1`. */
function seriesEditorClient(fail: boolean) {
  return {
    async mutation(_mutation: unknown, args: unknown) {
      const page = window as unknown as { seriesUpdates?: unknown[] };
      page.seriesUpdates = [...(page.seriesUpdates ?? []), args];
      if (fail) throw new Error(serverRefusal);
    },
  } as unknown as ConvexReactClient;
}

const fetchFixtureToken = async () => "fixture-token";
const useFixtureAuth = () => ({ isLoading: false, isAuthenticated: true, fetchAccessToken: fetchFixtureToken });

/** The whole editor without demoMode: the flag reads on and each mutation is recorded. `?fail=1` refuses the first series create. */
function connectedEditorClient(fail: boolean) {
  let refuseSeriesCreate = fail;
  return {
    setAuth(_fetch: unknown, onChange: (authenticated: boolean) => void) { onChange(true); },
    clearAuth() {},
    async query(query: FunctionReference<"query">) {
      return getFunctionName(query) === "events:getEditableBySlug"
        ? { preservedParticipantAssociationIds: [], preservedSlotAssociationIds: [], preservedWorldAssociationIds: [] }
        : null;
    },
    watchQuery(query: FunctionReference<"query">) {
      return { localQueryResult: () => getFunctionName(query) === "eventSeries:isEnabled" ? true : undefined, onUpdate: () => () => {}, journal: () => undefined };
    },
    async mutation(mutation: FunctionReference<"mutation">, args: unknown) {
      const name = getFunctionName(mutation);
      const page = window as unknown as { editorMutations?: unknown[] };
      page.editorMutations = [...(page.editorMutations ?? []), { name, args }];
      if (name === "eventSeries:create" && refuseSeriesCreate) {
        refuseSeriesCreate = false;
        throw new Error(serverRefusal);
      }
      return { slug: "harbor-night", eventPath: "/playwright/event-editor" };
    },
  } as unknown as ConvexReactClient;
}

export function EventEditorPreview({ connected = false, fail = false }: { connected?: boolean; fail?: boolean }) {
  const [client] = useState(() => connected ? connectedEditorClient(fail) : previewClient);
  if (connected) {
    return <ConvexProviderWithAuth client={client} useAuth={useFixtureAuth}><EventEditorPage communityName="Afterglow" communitySlug="afterglow" /></ConvexProviderWithAuth>;
  }
  return (
    <ConvexProvider client={previewClient}>
      <EventEditorPage communityName="Afterglow" communitySlug="afterglow" demoMode />
    </ConvexProvider>
  );
}

export function EventEditorEditPreview({ ended = false, fail = false, flagOff = false, past = false, scope, series = false }: { ended?: boolean; fail?: boolean; flagOff?: boolean; past?: boolean; scope?: string; series?: boolean }) {
  const seriesEditor = series && scope === "series" && !ended && !flagOff;
  const seriesNight = {
    ...previewSeriesEvent,
    ...(past ? { startAt: Date.UTC(2020, 8, 12, 22), doorsOpenAt: undefined, endAt: undefined } : {}),
    series: { ...previewSeriesEvent.series!, state: ended ? "ended" as const : "active" as const },
  };
  const [client] = useState(() => seriesEditor ? seriesEditorClient(fail) : previewClient);
  if (series && fail && !seriesEditor) {
    return <EventSeriesNote communitySlug="afterglow" editSeries eventSlug={previewEvent.slug!} overrides={["summary"]} onReset={() => Promise.reject(new Error(serverRefusal))} />;
  }
  return (
    <ConvexProvider client={client}>
      <EventEditorPage
        communityName="Afterglow"
        communitySlug="afterglow"
        demoMode={!seriesEditor}
        discordPostText="Afterglow Harbor Sessions\nhttps://vrdex.net/afterglow/events/harbor-sessions-7k2m4q"
        event={series ? seriesNight : previewEvent}
        recurringEnabled={!flagOff}
        scope={scope}
      />
    </ConvexProvider>
  );
}
