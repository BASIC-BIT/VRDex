"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EventPlaybackInline } from "@/app/_components/event-playback-inline";
import { useEventPlayback, useEventPlaybackSnapshot } from "@/app/_components/event-playback-provider";
import type { EventPlaybackOwner, PlaybackRequest } from "@/lib/event-playback-owner";
import { retainPlaybackAuthorization } from "@/lib/event-playback-revalidation";

function Fixture({ owner, event = "a", kind = "direct", view }: { owner: EventPlaybackOwner; event?: string; kind?: string; view?: string }) {
  const [startAt] = useState(() => Date.now() - 1000);
  const [gate, setGate] = useState(false);
  const state = useEventPlaybackSnapshot(owner);
  const generation = owner.generation;
  const href = `/playwright/event-persistent?event=${event}&kind=${kind}`;
  const request = useMemo<Extract<PlaybackRequest,{eventId:string}>>(() => {
    const identity = { eventId: event, eventSlug: event, title: event === "a" ? "Harbor Sessions" : "Afterglow", href, startAt };
    const stream = { streamId: "synthetic", pcUrl: "https://stream.vrcdn.live/live/synthetic.live.flv", questUrl: "https://stream.vrcdn.live/live/synthetic.live.ts" };
    if (kind === "sequence") return { ...identity, kind: "performer_sequence", event: { title: identity.title, startAt, slots: [
      { key: "aurora-1", performerId: "aurora", label: "DJ Aurora", startAt, stream },
      { key: "aurora-2", performerId: "aurora", label: "DJ Aurora • Encore", startAt: startAt + 3_600_000, stream },
    ] } };
    if (kind === "twitch") return { ...identity, kind: "twitch", channel: "monstercat", sourceId: "https://www.twitch.tv/monstercat" };
    return { ...identity, kind: "vrcdn", sourceId: kind === "managed" ? "managed-output" : "direct-stream", src: stream.questUrl, transport: "mpegts" };
  }, [event, href, kind, startAt]);
  useEffect(() => {
    if (!state.request) return;
    // Synthetic public projection reader exercises the production polling helper,
    // including when the route has no inline consumer. No production endpoint hook.
    const active = state.request;
    return retainPlaybackAuthorization(owner, async () => {
      const response = await fetch("/playwright-projection.json");
      const projection = await response.json() as { revoked: boolean };
      return projection.revoked ? null : active;
    }, 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, generation]);
  return <main className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
    <nav className="flex flex-wrap gap-6"><Link href={href}>Event</Link><Link href={`${href}&view=profile`}>Profile</Link><Link href={`/playwright/event-persistent?event=${event === "a" ? "b" : "a"}&kind=${kind}`}>Other event</Link></nav>
    <button type="button" onClick={() => setGate(value => !value)}>Toggle auth layout fixture</button>
    {gate ? <div className="h-20" data-auth-gate>Signing in fixture</div> : <article key={view} className="space-y-6">
      <h1 className="text-3xl font-semibold">{view === "profile" ? "DJ Aurora" : request.title}</h1>
      {view === "profile" ? <div className="h-[700px] border-l border-border pl-6">Profile fixture</div> : <EventPlaybackInline owner={owner} request={request} />}
    </article>}
    <div data-fixture-tail className="h-[800px]" /><a href="#top">Back to top</a>
  </main>;
}
export function PersistentFixture(props: { event?: string; kind?: string; view?: string }) {
  const owner = useEventPlayback();
  return owner ? <Fixture owner={owner} {...props} /> : null;
}
