"use client";
import { useState } from "react";
import { ConvexProvider, ConvexProviderWithAuth, type ConvexReactClient, useQuery } from "convex/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { api } from "@convex-generated-api";
import { EventPublicPage, type PublicEvent } from "../../_components/event-public-page";
import { EventEditorForm, type EditableEvent } from "../../events/event-editor-form";
import { previewEvent } from "../event-editor/preview";
import { publicProfileOutboundLinks } from "../../../../../../convex/_profilePublic";
import type { Doc } from "../../../../../../convex/_generated/dataModel";
import { parseVrcdnStreamLinks } from "../../../../../../convex/_vrcdnLinks";

const fetchAccessToken = async () => "fixture-token";
const useFixtureAuth = () => ({ isLoading: false, isAuthenticated: true, fetchAccessToken });

const storageKey = "event-lineup-fixture-v1";
const stream = (id: string) => {
  const { streamId, pcUrl, questUrl } = parseVrcdnStreamLinks(`vrcdn:${id}`)!;
  return { streamId, pcUrl, questUrl };
};
const people = {
  aurora: { slug: "aurora", displayName: "Aurora", trustLabel: "claimed_verified" as const,
    imageUrl: "/seed/fixture-avatar-luma.svg",
    outboundLinks: [{ source: "owner_authored", label: "SoundCloud", type: "soundcloud", url: "https://soundcloud.com/aurora" }, { source: "owner_authored", label: "VRCDN", type: "vrcdn", url: "vrcdn:aurora" }, { source: "owner_authored", label: "Twitch", type: "twitch", url: "https://www.twitch.tv/aurora" }] },
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
  mediaLinks: [
    ...previewEvent.mediaLinks,
    { type: "vrcdn", label: "Event stream", url: "vrcdn:event-only", presentation: "copy" },
    { type: "watch", label: "Repeated Twitch", url: "https://twitch.tv/aurora", presentation: "open" },
    { type: "ticket", label: "Tickets", url: "https://example.com/tickets", presentation: "open" },
  ],
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
  const publicEvent = JSON.parse(localStorage.getItem("event-lineup-fixture-public") ?? "null") as PublicEvent | null;
  const listeners = new Set<() => void>();
  window.addEventListener("event-lineup-fixture-refresh", () => {
    event = JSON.parse(localStorage.getItem(storageKey)!) as EditableEvent;
    listeners.forEach(listener => listener());
  });
  const empty: unknown[] = [];
  const outputAccounts = ["first", "second"].map(key => ({ key, label: key, playbackLinks: [
    { platform: "browser", label: key + " output", url: "https://example.com/" + key + ".m3u8" },
    { platform: "standalone", url: "https://example.com/" + key + ".ts" },
    { platform: "pc", url: "rtspt://example.com/" + key },
  ] }));
  let accountsPending = localStorage.getItem("fixture-output-defer-accounts") === "true";
  window.addEventListener("fixture-output-release-accounts", () => { accountsPending = false; listeners.forEach(listener => listener()); }, { once: true });
  const viewer = { user: { defaultEventTimezone: "UTC" } };
  const mediaStatus = { program: null, outputs: [], sessions: [], queuedCommandCount: 0 };
  const read = (name: string, args: Record<string, unknown>) => {
    if (name === "accounts:viewer") return viewer;
    if (name === "events:listVrcdnOutputAccounts") return accountsPending ? undefined : outputAccounts;
    if (name === "profiles:lookupPeople") return Object.values(people).filter(person => `${person.displayName} ${person.slug}`.toLowerCase().includes(String(args.query).toLowerCase())).map(person => ({ ...person, profilePath: `/${person.slug}`, aliases: [], tags: [], genres: [], roleTags: ["DJ"], avatarImageUrl: "imageUrl" in person ? person.imageUrl : undefined }));
    if (name === "profiles:getPublicBySlug" && args.profileType === "person") {
      const person = people[args.slug as keyof typeof people];
      return person ? { ...person, profileType: "person", tags: [], person: { roleTags: ["DJ"] }, avatarImageUrl: "imageUrl" in person ? person.imageUrl : undefined, mediaKit: {} } : null;
    }
    if (name === "profiles:getPublicBySlug") return { slug: args.slug, displayName: "Afterglow", avatarImageUrl: "/seed/fixture-avatar-velvet-circuit.svg", mediaKit: { primaryLogo: { imageUrl: "/seed/fixture-avatar-velvet-circuit.svg" } } };
    if (name === "worlds:getPublicBySlug") return event.worlds.find(world => world.slug === args.slug) ?? null;
    if (name === "events:getEditableBySlug") return event;
    if (name === "events:getPublicBySlug") return publicEvent ?? event;
    if (name === "events:getPersonStreamChoices" && args.slug === localStorage.getItem("fixture-stream-defer-person")) return undefined;
    if (name === "events:getPersonStreamChoices") return event.slots.find(slot => slot.performer?.slug === args.slug)?.streamChoices ?? choices[args.slug as keyof typeof choices] ?? [];
    if (name === "search:searchUniversal") return Object.values(people).filter(person => person.slug.includes(String(args.query))).map(person => ({ slug: person.slug, title: person.displayName, routePath: `/${person.slug}`, imageUrl: "imageUrl" in person ? person.imageUrl : undefined }));
    if (name === "events:getEventMediaControlStatus") return mediaStatus;
    return empty;
  };
  return {
    setAuth(_fetch: unknown, onChange: (authenticated: boolean) => void) { onChange(true); },
    clearAuth() {},
    async query(query: FunctionReference<"query">, args: Record<string, unknown>) { return read(getFunctionName(query), args); },
    watchQuery(query: FunctionReference<"query">, args: Record<string, unknown>) {
      return { localQueryResult: () => read(getFunctionName(query), args),
        onUpdate: (callback: () => void) => { listeners.add(callback); return () => { listeners.delete(callback); }; },
        journal: () => undefined };
    },
    async mutation(mutation: FunctionReference<"mutation">, args: Record<string, unknown>) {
      const command = getFunctionName(mutation);
      if (command === "events:configureVrcdnOutput") {
        localStorage.setItem("fixture-output-submission", JSON.stringify(args));
        if (localStorage.getItem("fixture-output-defer-save") === "true") await new Promise<void>(resolve => window.addEventListener("fixture-output-release-save", () => resolve(), { once: true }));
        if (localStorage.getItem("fixture-output-save-error")) throw new Error("Fixture output failure");
        localStorage.setItem("fixture-output-persisted", JSON.stringify(args));
        return {};
      }
      if (!["events:updateCommunityEvent", "events:createCommunityEvent"].includes(command)) throw new Error("Unsupported fixture mutation");
      localStorage.setItem("event-lineup-fixture-command", command);
      localStorage.setItem("event-lineup-fixture-command-count", String(Number(localStorage.getItem("event-lineup-fixture-command-count") ?? "0") + 1));
      localStorage.setItem(`${storageKey}-submission`, JSON.stringify(args));
      if (localStorage.getItem("event-lineup-fixture-defer-save") === "true") {
        await new Promise<void>(resolve => window.addEventListener("event-lineup-fixture-release-save", () => resolve(), { once: true }));
      }
      const storedSlotAssociations = args.storedSlotAssociations as Array<{ position: number; slotId: string }> | undefined;
      const error = localStorage.getItem("event-lineup-fixture-save-error");
      if (error) throw new Error(error);
      const slots = args.slotLinks === undefined && args.lineup === undefined ? event.slots : ((args.slotLinks ?? (args.lineup as Array<Record<string, unknown>> | undefined)?.filter(row => row.startAt !== undefined).map(row => ({ ...row, displayLabel: row.performerLabel })) ?? event.slots) as Array<Record<string, unknown>>).map((slot, index) => ({
        ...slot, position: slot.position ?? index, playbackKey: storedSlotAssociations?.find(row => row.position === index)?.slotId ?? event.slots.find(row => (row.clientKey ?? row.playbackKey) === slot.clientKey)?.playbackKey ?? `saved-${crypto.randomUUID()}`, discord: previewEvent.slots[0]!.discord, source: previewEvent.source,
        performer: people[slot.personSlug as keyof typeof people],
        streamChoices: choices[slot.personSlug as keyof typeof choices] ?? [],
        selectedStreamId: slot.selectedStreamId ?? undefined,
      }));
      event = { ...event, ...args, slots,
        ...(args.lineup === undefined ? {} : { usesCanonicalLineup: true, lineup: (args.lineup as Array<Record<string, unknown>>).map(row => ({ ...row, key: row.clientKey, displayLabel: row.performerLabel, performer: people[row.personSlug as keyof typeof people] })) }),
      } as EditableEvent;
      // Real editor readback omits cleared optional timing fields.
      for (const key of ["startAt", "endAt", "doorsOpenAt", "timezone"] as const) if (event[key] === null) delete event[key];
      localStorage.setItem(storageKey, JSON.stringify(event));
      listeners.forEach(listener => listener());
      return { slug: event.slug, eventPath: "/playwright-afterglow-social/events/playwright-afterglow-harbor-sessions", preservedParticipantAssociationIds: args.preservedParticipantAssociationIds ?? [], preservedSlotAssociationIds: [...new Set([...slots.map(slot => slot.playbackKey), ...((args.lineup === undefined ? event.retainedLineupAssociations : args.retainedLineupAssociations as { slotIds?: string[] } | undefined)?.slotIds ?? [])])], preservedWorldAssociationIds: args.preservedWorldAssociationIds ?? [], editableWorldAssociation: args.worldSlug === null ? null : event.editableWorldAssociation ?? null,
        ...(storedSlotAssociations === undefined ? {} : { storedSlotAssociations: slots.map((slot, position) => ({ position, slotId: slot.playbackKey })) }),
      };
    },
  } as unknown as ConvexReactClient;
}
function Editor() {
  const [bootstrap] = useState(() => JSON.parse(localStorage.getItem(storageKey) ?? JSON.stringify(fixtureEvent)) as EditableEvent);
  const event = useQuery(api.events.getEditableBySlug, { slug: bootstrap.slug });
  return event ? <main className="mx-auto max-w-6xl p-5"><EventEditorForm savedTimezonePreference={null} communitySlug={bootstrap.communitySlug ?? "afterglow"} communityName={bootstrap.communityName ?? "Afterglow"} demoMode={!new URLSearchParams(window.location.search).has("output")} event={new URLSearchParams(window.location.search).get("mode") === "create" ? undefined : event} /></main> : null;
}
export default function EventLineupFixture() {
  const [client] = useState(fixtureClient);
  const [publicEvent] = useState(() => JSON.parse(localStorage.getItem("event-lineup-fixture-public") ?? JSON.stringify(fixtureEvent)) as PublicEvent);
  if (new URLSearchParams(window.location.search).has("output")) return <ConvexProviderWithAuth client={client} useAuth={useFixtureAuth}><Editor /></ConvexProviderWithAuth>;
  return <ConvexProvider client={client}>{new URLSearchParams(window.location.search).has("editor") ? <Editor /> : <EventPublicPage event={publicEvent} />}</ConvexProvider>;
}
