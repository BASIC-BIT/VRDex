"use client";
import { useState } from "react";
import { ConvexProvider, type ConvexReactClient, useQuery } from "convex/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { api } from "@convex-generated-api";
import { EventPublicPage, type PublicEvent } from "../../_components/event-public-page";
import { EventEditorForm, type EditableEvent } from "../../events/event-editor-form";
import { previewEvent } from "../event-editor/preview";
import { publicProfileOutboundLinks } from "../../../../../../convex/_profilePublic";
import type { Doc } from "../../../../../../convex/_generated/dataModel";
import { parseVrcdnStreamLinks } from "../../../../../../convex/_vrcdnLinks";

const storageKey = "event-lineup-fixture-v1";
const stream = (id: string) => {
  const { streamId, pcUrl, questUrl } = parseVrcdnStreamLinks(`vrcdn:${id}`)!;
  return { streamId, pcUrl, questUrl };
};
const people = {
  aurora: { slug: "aurora", displayName: "Aurora", trustLabel: "claimed_verified" as const,
    outboundLinks: [{ source: "owner_authored", label: "SoundCloud", type: "soundcloud", url: "https://soundcloud.com/aurora" }, { source: "owner_authored", label: "VRCDN", type: "vrcdn", url: "vrcdn:aurora" }] },
  lumen: { slug: "lumen", displayName: "Lumen", trustLabel: "claimed_verified" as const,
    outboundLinks: [{ source: "owner_authored", label: "Main", type: "vrcdn", url: "vrcdn:lumen-main" }, { source: "owner_authored", label: "Visuals", type: "vrcdn", url: "vrcdn:lumen-visuals" }] },
  nova: { slug: "nova", displayName: "Nova", trustLabel: "claimed_verified" as const,
    outboundLinks: [{ source: "owner_authored", label: "Live", type: "vrcdn", url: "vrcdn:nova" }] },
} satisfies Record<string, NonNullable<PublicEvent["slots"][number]["performer"]>>;
const choices = { aurora: [stream("aurora")], lumen: [stream("lumen-main"), stream("lumen-visuals")], nova: [stream("nova")] };
const hiddenLinksProfile = {
  profileType: "person", fieldVisibility: { outboundLinks: "private" },
  outboundLinks: [{ type: "website", label: "Private fixture link", source: "owner_authored", url: "https://example.com/private" }],
} as Doc<"profiles">;
const fixtureEvent: EditableEvent = {
  ...previewEvent,
  watchSurfaceEnabled: true,
  watchMode: "performer_sequence" as const,
  slots: previewEvent.slots.map((slot, index) => ({
    ...slot, playbackKey: `appearance-${index}`, performer: index === 3 ? undefined : index === 2 ? people.lumen : people.aurora,
    displayLabel: index === 3 ? "Closing session" : index === 2 ? "Lumen" : "Aurora",
    streamChoices: index === 3 ? [] : index === 2 ? choices.lumen : choices.aurora,
    selectedStreamId: index === 2 ? "removed-source" : undefined,
  })),
  participants: [{ ...people.nova, roleLabel: "Host", source: previewEvent.source, outboundLinks: [
    ...people.nova.outboundLinks,
    { source: "owner_authored", label: "A very long public archive link for checking narrow screen wrapping", type: "website", url: "https://example.com/archive/long-public-path-with-no-breaks-for-the-mobile-copy-control" },
    { source: "owner_authored", label: "Discord", type: "discord", url: "https://discord.com/users/fixture", handle: "nova.fixture" },
  ] }, { slug: "hidden-links", displayName: "Echo", trustLabel: "claimed_verified", roleLabel: "Staff", source: previewEvent.source,
    outboundLinks: publicProfileOutboundLinks(hiddenLinksProfile, "discovery"),
  }],
};

// Only this guarded route installs the local transport. The production form still
// calls its real query/mutation hooks and runs the normal serialization path.
function fixtureClient() {
  let event = JSON.parse(localStorage.getItem(storageKey) ?? JSON.stringify(fixtureEvent)) as EditableEvent;
  const listeners = new Set<() => void>();
  const empty: unknown[] = [];
  const mediaStatus = { program: null, outputs: [], sessions: [], queuedCommandCount: 0 };
  const read = (name: string, args: Record<string, unknown>) => {
    if (name === "events:getEditableBySlug") return event;
    if (name === "events:getPersonStreamChoices") return choices[args.slug as keyof typeof choices] ?? [];
    if (name === "search:searchUniversal") return Object.values(people).filter(person => person.slug.includes(String(args.query))).map(person => ({ slug: person.slug, title: person.displayName, routePath: `/${person.slug}` }));
    if (name === "events:getEventMediaControlStatus") return mediaStatus;
    return empty;
  };
  return {
    watchQuery(query: FunctionReference<"query">, args: Record<string, unknown>) {
      return { localQueryResult: () => read(getFunctionName(query), args),
        onUpdate: (callback: () => void) => { listeners.add(callback); return () => { listeners.delete(callback); }; },
        journal: () => undefined };
    },
    async mutation(mutation: FunctionReference<"mutation">, args: Record<string, unknown>) {
      if (getFunctionName(mutation) !== "events:updateCommunityEvent") throw new Error("Unsupported fixture mutation");
      localStorage.setItem(`${storageKey}-submission`, JSON.stringify(args));
      const slots = (args.slotLinks as Array<Record<string, unknown>>).map((slot, index) => ({
        ...slot, position: index, playbackKey: `saved-${index}`, discord: previewEvent.slots[0]!.discord, source: previewEvent.source,
        performer: people[slot.personSlug as keyof typeof people],
        streamChoices: choices[slot.personSlug as keyof typeof choices] ?? [],
        selectedStreamId: slot.selectedStreamId ?? undefined,
      }));
      event = { ...event, ...args, slots } as EditableEvent;
      localStorage.setItem(storageKey, JSON.stringify(event));
      listeners.forEach(listener => listener());
      return { slug: event.slug, preservedParticipantAssociationIds: [], preservedSlotAssociationIds: [], preservedWorldAssociationIds: [] };
    },
  } as unknown as ConvexReactClient;
}
function Editor() {
  const event = useQuery(api.events.getEditableBySlug, { slug: previewEvent.slug });
  return event ? <main className="mx-auto max-w-4xl p-5"><EventEditorForm communitySlug="afterglow" demoMode event={event} /></main> : null;
}
export default function EventLineupFixture() {
  const [client] = useState(fixtureClient);
  return <ConvexProvider client={client}>{new URLSearchParams(window.location.search).has("editor") ? <Editor /> : <EventPublicPage event={fixtureEvent} />}</ConvexProvider>;
}
