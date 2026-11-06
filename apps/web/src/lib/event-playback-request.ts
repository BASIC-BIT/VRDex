import { inferLineupEnds } from "@vrdex/api-contracts";
import type { PublicEvent } from "../app/_components/event-public-page";
import type { PlaybackRequest } from "./event-playback-owner";
import { parseVrcdnStreamLinks } from "../../../../convex/_vrcdnLinks";
import { publicEventPath } from "./event-path";

/** Authorization is independent of the new-start calendar window. */
export function eventPlaybackRequest(
  event: PublicEvent | null,
): Extract<PlaybackRequest, { eventId: string }> | null {
  if (
    !event ||
    event.status === "cancelled" ||
    event.scheduleKind === "date_only" ||
    event.startAt === undefined
  )
    return null;
  const identity = {
    eventId: event.id,
    eventSlug: event.slug,
    title: event.title,
    href: publicEventPath(event) ?? `/events/${event.slug}`,
    startAt: event.startAt,
    doorsOpenAt: event.doorsOpenAt,
    endAt: event.endAt,
  };
  const automatic = !event.watchSurfaceEnabled && event.slots.some(slot => slot.stream && slot.playbackKey && Number.isFinite(slot.startAt));
  if ((event.watchMode === "performer_sequence" && event.watchSurfaceEnabled) || automatic)
    return {
      ...identity,
      kind: "performer_sequence",
      ...(automatic ? { localOnly: true as const } : {}),
      event: {
        title: event.title,
        startAt: event.startAt,
        doorsOpenAt: event.doorsOpenAt,
        endAt: event.endAt,
        slots: inferLineupEnds(event.slots.slice().sort((a, b) => a.position - b.position).map((slot) => {
          const rowIndex = event.lineup?.findIndex(row => row.key === slot.playbackKey) ?? -1;
          const followingBlocked = rowIndex >= 0 && rowIndex < (event.lineup?.length ?? 0) - 1 && event.lineup?.[rowIndex + 1].startAt === undefined;
          return {
            key: slot.playbackKey ?? "",
            startAt: slot.startAt,
            endAt: slot.endAt,
            performerId: slot.performer?.slug,
            label: slot.displayLabel,
            stream: slot.stream,
            followingBlocked,
          };
        }), event.endAt),
      },
    };
  if (!event.watchSurfaceEnabled) return null;
  const rank = ["watch", "stream", "vrcdn"];
  const link = event.mediaLinks
    .filter((link) => rank.includes(link.type))
    .sort((a, b) => rank.indexOf(a.type) - rank.indexOf(b.type))[0];
  if (!link) return null;
  const stream = parseVrcdnStreamLinks(link.url);
  if (stream)
    return {
      ...identity,
      kind: "vrcdn",
      sourceId: stream.streamId,
      src: stream.directVideoUrl ?? stream.questUrl,
      transport: stream.directVideoUrl ? "video" : "mpegts",
    };
  try {
    const url = new URL(link.url);
    const host = url.hostname.replace(/^www\./, "");
    if (
      url.protocol !== "https:" ||
      !["twitch.tv", "player.twitch.tv"].includes(host)
    )
      return null;
    const parts = url.pathname.split("/").filter(Boolean);
    const video =
      host === "player.twitch.tv"
        ? url.searchParams.get("video")
        : parts[0] === "videos"
          ? parts[1]
          : null;
    const channel =
      host === "player.twitch.tv"
        ? url.searchParams.get("channel")
        : parts[0] !== "videos"
          ? parts[0]
          : null;
    const collection = url.searchParams.get("collection");
    if (
      channel &&
      /^[a-zA-Z0-9_]{3,25}$/.test(channel) &&
      ![
        "directory",
        "about",
        "downloads",
        "jobs",
        "settings",
        "store",
        "team",
        "turbo",
        "videos",
      ].includes(channel.toLowerCase())
    )
      return { ...identity, kind: "twitch", sourceId: link.url, channel };
    if (video && /^v?\d+$/.test(video))
      return {
        ...identity,
        kind: "twitch",
        sourceId: link.url,
        video: video.startsWith("v") ? video : `v${video}`,
      };
    if (
      host === "player.twitch.tv" &&
      collection &&
      /^[a-zA-Z0-9_-]+$/.test(collection)
    )
      return { ...identity, kind: "twitch", sourceId: link.url, collection };
  } catch {
    /* Unsupported links keep their existing watch surface. */
  }
  return null;
}

export function profilePlaybackRequest(
  profile: {
    id?: string;
    slug: string;
    displayName: string;
    outboundLinks: Array<{ type: string; url: string }>;
  } | null,
  sourceId: string,
): PlaybackRequest | null {
  if (!profile?.id) return null;
  const stream = profile.outboundLinks
    .filter((link) => link.type === "vrcdn")
    .map((link) => parseVrcdnStreamLinks(link.url))
    .find((stream) => stream?.streamId === sourceId);
  if (!stream) return null;
  return {
    kind: "vrcdn",
    profileId: profile.id,
    profileSlug: profile.slug,
    title: `${profile.displayName} - VRDex`,
    href: `/${profile.slug}`,
    sourceId,
    src: stream.directVideoUrl ?? stream.questUrl,
    transport: stream.directVideoUrl ? "video" : "mpegts",
  };
}
