"use client";
import { EventOperatorPreview, type PreviewSource } from "@/app/_components/event-operator-preview";
import { EventWatchSurface } from "@/app/_components/event-watch-surface";
import { VrcdnStreamPlayer } from "@/app/_components/vrcdn-stream-player";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useEventPlayback } from "@/app/_components/event-playback-provider";
import { EventPlaybackInline } from "@/app/_components/event-playback-inline";
import type { PlaybackRequest } from "@/lib/event-playback-owner";
export function PlaybackFixture({ eventId, twitch }: { eventId: string; twitch: boolean }) {
  const owner = useEventPlayback();
  const [operatorPreview,setOperatorPreview]=useState(false);
  const [previewSource, setPreviewSource] = useState<PreviewSource>({
    input: { kind: "twitch", channel: "preview" },
    publicUrl: "https://www.twitch.tv/preview", label: "Operator preview",
  });
  const [startAt] = useState(() => Date.now() - 1000);
  const request = useMemo<PlaybackRequest>(() => ({ eventId, eventSlug: eventId, href: `/playwright/event-playback?event=${eventId}`, title: `Event ${eventId}`, startAt,
    ...(twitch ? { kind: "twitch", sourceId: "channel", channel: "fixture" } : { kind: "vrcdn", sourceId: eventId, src: `/retained-test.wav?event=${eventId}`, transport: "video" }),
  }), [eventId, twitch, startAt]);
  return <main className="mx-auto w-full max-w-3xl p-6">
    <Link href={`/playwright/event-playback?event=${eventId === "a" ? "b" : "a"}`}>Other event</Link>
    <Link href="/playwright/event-lineup">Browse</Link>
    <EventWatchSurface enabled startAt={startAt} mediaLinks={[{ type: "watch", label: "Legacy", url: "https://youtube.com/watch?v=fixture123", presentation: "open" }]} />
    <EventWatchSurface enabled startAt={startAt} mediaLinks={[{ type: "watch", label: "Clip", url: "https://clips.twitch.tv/Fixture", presentation: "open" }]} />
    <VrcdnStreamPlayer initialMuted src="/preview.live.ts" title="Preview" />
    <VrcdnStreamPlayer src="/profile.live.ts" title="Profile" />
    <button onClick={()=>setOperatorPreview(true)}>Operator preview</button>
    {operatorPreview ? <>
      <button onClick={() => setPreviewSource(current => ({ ...current, label: "Renamed preview" }))}>Rename preview</button>
      <button onClick={() => setPreviewSource(current => ({ ...current, input: { kind: "twitch", channel: "replacement" }, publicUrl: "https://www.twitch.tv/replacement" }))}>Replace preview</button>
      <EventOperatorPreview source={previewSource} onClose={() => setOperatorPreview(false)} />
    </> : null}
    {owner && <EventPlaybackInline owner={owner} request={request} />}
  </main>;
}
