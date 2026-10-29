"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { EventPlaybackOwner, type PlaybackRequest } from "@/lib/event-playback-owner";
import { createRetainedPlaybackAdapter } from "@/lib/event-playback-adapters";
import { useEventPlaybackSnapshot } from "../../_components/event-playback-provider";
import { EventCompactPlayer } from "../../_components/event-compact-player";

/** Dev-only UI; Playwright routes this transport to the isolated composed harness. */
import { retainForegroundGrant } from "@/lib/relay-playback-adapter";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function ComposedFixture({ children }: { children?: ReactNode }) {
  const mount = useRef<HTMLDivElement>(null);
  const [request, setRequest] = useState<PlaybackRequest>();
  const away = usePathname().endsWith("/away");
  const [owner] = useState(() => new EventPlaybackOwner((request, notify, mode) => {
    const node = document.querySelector<HTMLElement>("[data-composed] [data-event-playback-mount]");
    if (!node) throw Error("Fixture mount unavailable");
    const call = async (name: string, args: object) => {
      const response = await fetch("/mobile-acceptance/playback", { method: "POST", body: JSON.stringify({ name, ...args }) });
      if (!response.ok) throw Error("Acceptance transport failed");
      return response.json();
    };
    return createRetainedPlaybackAdapter(request, node, notify, { mode, relay: {
      open: (context, streamId, preferredMode, continuationGrantId) => call("openPlayback", { context, streamId, preferredMode, continuationGrantId }),
      get: grantId => call("getPlayback", { grantId }),
      refresh: grantId => call("refreshPlayback", { grantId }),
      restart: grantId => call("restartPlayback", { grantId }),
      release: grantId => call("releasePlayback", { grantId }),
    } });
  }));
  const state = useEventPlaybackSnapshot(owner);
  useEffect(() => retainForegroundGrant(owner, document, () => document.visibilityState === "visible"), [owner]);
  useEffect(() => { let live = true; void fetch("/mobile-acceptance/setup").then(r => r.json()).then(data => { if (live) setRequest(data.request); }); return () => { live = false; owner.close(); }; }, [owner]);
  return <main data-composed data-status={state.status} className="mx-auto w-full max-w-3xl space-y-6 p-5">
    {children}
    <Link className="inline-block mr-4" href={away ? "/playwright/mobile-hls-playback" : "/playwright/mobile-hls-playback/away"}>Navigate</Link>
    {!away && request && <button type="button" aria-label="Play DJ Aurora" onClick={() => void owner.play(request)}>Play</button>}
    <EventCompactPlayer owner={owner} state={state} mount={mount} />
  </main>;
}
