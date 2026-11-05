"use client";
import { streamKeyFor } from "@vrdex/media-relay";
import { useEffect, useRef, useState } from "react";
import { EventPlaybackOwner, type PlaybackRequest } from "@/lib/event-playback-owner";
import { createRetainedPlaybackAdapter } from "@/lib/event-playback-adapters";
import { useEventPlaybackSnapshot } from "../../_components/event-playback-provider";
import { EventCompactPlayer } from "../../_components/event-compact-player";
import { EventPlaybackInline } from "../../_components/event-playback-inline";
import type { ReadyPlayback } from "@/lib/native-hls-adapter";

/** Credential-free browser fixture. Only synthetic same-origin playlists are admitted. */
export default function NativeFixture() {
  const mount = useRef<HTMLDivElement>(null);
  const [counts, setCounts] = useState({ opened: 0, released: 0 });
  const [request, setRequest] = useState<Extract<PlaybackRequest, { kind: "performer_sequence" }>>(() => {
    const now = Date.now();
    const stream = (id: string) => ({ streamId: id, pcUrl: `vrcdn:${id}`, questUrl: `vrcdn:${id}` });
    return { kind: "performer_sequence", eventId: "fixture", eventSlug: "fixture", href: "#lineup", title: "Harbor Sessions", startAt: now - 1000, endAt: now + 7200_000,
      event: { title: "Harbor Sessions", startAt: now - 1000, endAt: now + 7200_000, slots: [
        { key: "aurora", performerId: "aurora", label: "DJ Aurora", startAt: now - 1000, endAt: now + 3600_000, stream: stream("FixtureA") },
        { key: "lumen", performerId: "lumen", label: "DJ Lumen", startAt: now + 3600_000, endAt: now + 7200_000, stream: stream("FixtureB") },
      ] } };
  });
  const [grants] = useState(() => new Map<string, ReadyPlayback>());
  const [owner] = useState(() => new EventPlaybackOwner((request, notify, mode) => {
      const node = document.querySelector<HTMLElement>("[data-native-current] [data-event-playback-mount]");
      if (!node) throw Error("Fixture mount unavailable");
      return createRetainedPlaybackAdapter(request, node, notify, { mode, relay: {
        async open(context, streamId) {
          if (context.kind !== "event" || context.eventId !== "fixture") throw Error("Fixture context required");
          const id = crypto.randomUUID();
          const ready: ReadyPlayback = { kind: "ready", grant: { id, context, contextRevision: 1, streamKey: streamKeyFor(streamId), issuedAt: Date.now(), expiresAt: Date.now() + 43_200_000, renditions: ["video", "audio"] },
            videoPlaylist: `${location.origin}/native-lineup-fixture/video/index.m3u8?source=${streamId}`,
            audioPlaylist: `${location.origin}/native-lineup-fixture/audio/index.m3u8?source=${streamId}`,
            metadata: { displayName: context.selectedSourceId === "aurora" ? "DJ Aurora" : "DJ Lumen", artworkAssetId: null, artworkRevision: null } };
          grants.set(id, ready); setCounts(value => ({ ...value, opened: value.opened + 1 })); return ready;
        },
        async get(id) { return grants.get(id); }, async refresh(id) { return grants.get(id); }, async restart(id) { return grants.get(id); },
        async release(id) { if (grants.delete(id)) setCounts(value => ({ ...value, released: value.released + 1 })); },
      } });
    }));
  const state = useEventPlaybackSnapshot(owner);
  useEffect(() => { void owner.setMode("video"); return () => owner.close(); }, [owner]);
  const boundary = () => {
    const now = Date.now();
    const event = { ...request.event, endAt: now - 1, slots: [{ ...request.event.slots[0], endAt: now - 10 }, { ...request.event.slots[1], startAt: now - 10 }] };
    const next = { ...request, event, endAt: event.endAt }; setRequest(next); owner.update(next);
  };
  return <main className="mx-auto w-full max-w-3xl space-y-6 p-5" data-native-current={state.lineup?.current ?? ""} data-native-opened={counts.opened} data-native-released={counts.released}>
    <h1 className="text-2xl">Harbor Sessions</h1>
    <button type="button" onClick={boundary}>Boundary</button>
    <EventPlaybackInline owner={owner} request={request} />
    <EventCompactPlayer owner={owner} state={state} mount={mount} />
  </main>;
}
