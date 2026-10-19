"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useEventPlayback } from "@/app/_components/event-playback-provider";
import { EventPlaybackInline } from "@/app/_components/event-playback-inline";
import type { PlaybackRequest } from "@/lib/event-playback-owner";
export function PlaybackFixture({ eventId, twitch }: { eventId: string; twitch: boolean }) {
  const owner = useEventPlayback();
  const [startAt] = useState(() => Date.now() - 1000);
  const request = useMemo<PlaybackRequest>(() => ({ eventId, eventSlug: eventId, href: `/playwright/event-playback?event=${eventId}`, title: `Event ${eventId}`, startAt,
    ...(twitch ? { kind: "twitch", sourceId: "channel", channel: "fixture" } : { kind: "vrcdn", sourceId: eventId, src: `/retained-test.wav?event=${eventId}`, transport: "video" }),
  }), [eventId, twitch, startAt]);
  return <main className="mx-auto w-full max-w-3xl p-6">
    <Link href={`/playwright/event-playback?event=${eventId === "a" ? "b" : "a"}`}>Other event</Link>
    <Link href="/playwright/event-lineup">Browse</Link>
    {owner && <EventPlaybackInline owner={owner} request={request} />}
  </main>;
}
