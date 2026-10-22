import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, useRef, useState } from "react";
import { EventPlaybackOwner } from "@/lib/event-playback-owner";
import { useEventPlaybackSnapshot } from "./event-playback-provider";
import { EventCompactPlayer } from "./event-compact-player";

function CompactFixture() {
  const mount = useRef<HTMLDivElement>(null);
  const [owner] = useState(() => new EventPlaybackOwner(() => ({
    play: async () => true, pause() {}, setVolume() {}, setMuted() {}, update() {}, dispose() {},
  })));
  const state = useEventPlaybackSnapshot(owner);
  useEffect(() => {
    // Storybook presentation only. Browser continuity uses the real MPEG-TS fixture.
    const poster = document.createElement("div");
    poster.className = "aspect-video bg-[linear-gradient(135deg,#2b3a55,#8a93a5)]";
    mount.current?.append(poster);
    void owner.play({ kind: "vrcdn", eventId: "story", eventSlug: "story", title: "Harbor Sessions", href: "/", startAt: Date.now() - 1000, sourceId: "DJ Aurora", src: "", transport: "mpegts" });
    return () => { owner.close(); poster.remove(); };
  }, [owner]);
  return <EventCompactPlayer owner={owner} state={state} mount={mount} />;
}
const meta = { title: "Media/Persistent event player", component: CompactFixture, parameters: { layout: "fullscreen" } } satisfies Meta<typeof CompactFixture>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Compact: Story = {};
