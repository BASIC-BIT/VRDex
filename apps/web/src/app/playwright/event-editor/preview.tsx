"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";

import { EventEditorPage } from "../../events/event-editor-page";
import type { EditableEvent } from "../../events/event-editor-form";

const previewClient = new ConvexReactClient("https://playwright-preview.convex.cloud");

const previewEvent: EditableEvent = {
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
      position: 1,
      startAt: Date.UTC(2026, 8, 12, 23),
      endAt: Date.UTC(2026, 8, 13, 0),
      displayLabel: "Neon Harbor",
      roleLabel: "DJ",
      discord: previewDiscordTimestamps(),
      source: { sourceType: "community", label: "Afterglow calendar" },
    },
    {
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

export function EventEditorPreview() {
  return (
    <ConvexProvider client={previewClient}>
      <EventEditorPage communityName="Afterglow" communitySlug="afterglow" demoMode />
    </ConvexProvider>
  );
}

export function EventEditorEditPreview() {
  return (
    <ConvexProvider client={previewClient}>
      <EventEditorPage
        communityName="Afterglow"
        communitySlug="afterglow"
        demoMode
        discordPostText="Afterglow Harbor Sessions\nhttps://vrdex.net/afterglow/events/harbor-sessions-7k2m4q"
        event={previewEvent}
      />
    </ConvexProvider>
  );
}
