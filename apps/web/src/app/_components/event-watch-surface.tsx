"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { parseVrcdnStreamLinks } from "../../../../../convex/_vrcdnLinks";

type EventMediaLinkType = "event_page" | "watch" | "stream" | "vrcdn" | "discord" | "ticket" | "other";
type EventMediaLinkPresentation = "open" | "copy";

type EventWatchMediaLink = {
  type: EventMediaLinkType;
  label: string;
  url: string;
  presentation: EventMediaLinkPresentation;
};

type WatchEmbed =
  | {
      kind: "iframe";
      provider: "Twitch" | "YouTube";
      src: string;
      title: string;
    }
  | {
      kind: "hls";
      provider: "VRCDN";
      src: string;
      title: string;
    }
  | {
      kind: "video";
      provider: "VRCDN";
      src: string;
      title: string;
    };

const twitchReservedPaths = new Set([
  "about",
  "directory",
  "downloads",
  "jobs",
  "p",
  "settings",
  "store",
  "team",
  "turbo",
  "videos",
]);

function subscribeToLocation(callback: () => void) {
  const id = window.setTimeout(callback, 0);
  window.addEventListener("popstate", callback);

  return () => {
    window.clearTimeout(id);
    window.removeEventListener("popstate", callback);
  };
}

function subscribeToNow(callback: () => void) {
  const timeoutId = window.setTimeout(callback, 0);
  const intervalId = window.setInterval(callback, 60_000);

  return () => {
    window.clearTimeout(timeoutId);
    window.clearInterval(intervalId);
  };
}

function getBrowserHostname() {
  return window.location.hostname;
}

function getServerHostname() {
  return undefined;
}

function getBrowserNow() {
  return Date.now();
}

function getServerNow() {
  return null;
}

function useBrowserHostname() {
  return useSyncExternalStore(subscribeToLocation, getBrowserHostname, getServerHostname);
}

function useCurrentTimestamp() {
  return useSyncExternalStore(subscribeToNow, getBrowserNow, getServerNow);
}

function isInScheduledWatchWindow({
  doorsOpenAt,
  endAt,
  now,
  startAt,
}: {
  doorsOpenAt?: number;
  endAt?: number;
  now: number | null;
  startAt: number;
}) {
  if (now === null) {
    return false;
  }

  const opensAt = doorsOpenAt ?? startAt;
  const closesAt = endAt ?? startAt + 6 * 60 * 60 * 1000;

  return now >= opensAt && now <= closesAt;
}

function parseHttpsUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

function parseWatchOpenUrl(url: string): URL | null {
  // VRCDN has nothing to open. The stream plays in the embed below, and the only
  // pages on that host are the operator panel and the wiki -- so this handed the
  // caller `https://vrcdn.live/<id>`, a 404 wearing the shape of a destination.
  // No open affordance is the honest answer.
  if (parseVrcdnStreamLinks(url) !== null) {
    return null;
  }

  return parseHttpsUrl(url);
}

function selectPrimaryWatchLink(mediaLinks: EventWatchMediaLink[]): EventWatchMediaLink | null {
  const ranks: Partial<Record<EventMediaLinkType, number>> = {
    watch: 0,
    stream: 1,
    vrcdn: 2,
  };

  return (
    mediaLinks
      .map((link, index) => ({ index, link, rank: ranks[link.type] }))
      .filter((entry): entry is { index: number; link: EventWatchMediaLink; rank: number } => entry.rank !== undefined)
      .sort((a, b) => a.rank - b.rank || a.index - b.index)[0]?.link ?? null
  );
}

function cleanPathSegment(segment: string | undefined): string | null {
  if (!segment) {
    return null;
  }

  const decoded = decodeURIComponent(segment).trim();
  return decoded && /^[a-zA-Z0-9_-]+$/.test(decoded) ? decoded : null;
}

function getYouTubeVideoId(url: URL): string | null {
  const hostname = url.hostname.replace(/^www\./, "").toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  let videoId: string | null = null;

  if (hostname === "youtu.be") {
    videoId = cleanPathSegment(segments[0]);
  }

  if (hostname === "youtube.com" || hostname === "youtube-nocookie.com") {
    if (segments[0] === "watch") {
      videoId = cleanPathSegment(url.searchParams.get("v") ?? undefined);
    }

    if (segments[0] === "embed" || segments[0] === "live" || segments[0] === "shorts") {
      videoId = cleanPathSegment(segments[1]);
    }
  }

  return videoId && /^[a-zA-Z0-9_-]{6,}$/.test(videoId) ? videoId : null;
}

function createYouTubeEmbed(url: URL, label: string): WatchEmbed | null {
  const videoId = getYouTubeVideoId(url);

  if (!videoId) {
    return null;
  }

  const embedUrl = new URL(`https://www.youtube-nocookie.com/embed/${videoId}`);
  embedUrl.searchParams.set("rel", "0");

  return {
    kind: "iframe",
    provider: "YouTube",
    src: embedUrl.href,
    title: `YouTube player for ${label}`,
  };
}

function sanitizeTwitchChannel(value: string | null): string | null {
  return value && /^[a-zA-Z0-9_]{3,25}$/.test(value) && !twitchReservedPaths.has(value.toLowerCase()) ? value : null;
}

function sanitizeTwitchVideo(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.startsWith("v") ? value.slice(1) : value;
  return /^\d+$/.test(normalized) ? `v${normalized}` : null;
}

function sanitizeTwitchToken(value: string | null): string | null {
  return value && /^[a-zA-Z0-9_-]+$/.test(value) ? value : null;
}

function createTwitchEmbed(url: URL, label: string, browserHostname: string | undefined): WatchEmbed | null {
  if (!browserHostname) {
    return null;
  }

  const hostname = url.hostname.replace(/^www\./, "").toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  let embedUrl: URL | null = null;

  if (hostname === "clips.twitch.tv") {
    const clip = sanitizeTwitchToken(segments[0] ?? null);

    if (clip) {
      embedUrl = new URL("https://clips.twitch.tv/embed");
      embedUrl.searchParams.set("clip", clip);
    }
  }

  if (hostname === "player.twitch.tv") {
    const channel = sanitizeTwitchChannel(url.searchParams.get("channel"));
    const video = sanitizeTwitchVideo(url.searchParams.get("video"));
    const collection = sanitizeTwitchToken(url.searchParams.get("collection"));

    if (channel || video || collection) {
      embedUrl = new URL("https://player.twitch.tv/");
      if (channel) {
        embedUrl.searchParams.set("channel", channel);
      } else if (video) {
        embedUrl.searchParams.set("video", video);
      } else if (collection) {
        embedUrl.searchParams.set("collection", collection);
      }
    }
  }

  if (hostname === "twitch.tv") {
    if (segments[0] === "videos") {
      const video = sanitizeTwitchVideo(segments[1] ?? null);

      if (video) {
        embedUrl = new URL("https://player.twitch.tv/");
        embedUrl.searchParams.set("video", video);
      }
    } else {
      const channel = sanitizeTwitchChannel(segments[0] ?? null);

      if (channel) {
        embedUrl = new URL("https://player.twitch.tv/");
        embedUrl.searchParams.set("channel", channel);
      }
    }
  }

  if (!embedUrl) {
    return null;
  }

  embedUrl.searchParams.set("parent", browserHostname);
  embedUrl.searchParams.set("autoplay", "false");

  return {
    kind: "iframe",
    provider: "Twitch",
    src: embedUrl.href,
    title: `Twitch player for ${label}`,
  };
}

function createVrcdnEmbed(url: string, label: string): WatchEmbed | null {
  const vrcdnLinks = parseVrcdnStreamLinks(url);

  if (vrcdnLinks === null) {
    return null;
  }

  if (vrcdnLinks.directVideoUrl !== undefined) {
    return {
      kind: "video",
      provider: "VRCDN",
      src: vrcdnLinks.directVideoUrl,
      title: `VRCDN video for ${label}`,
    };
  }

  return {
    kind: "hls",
    provider: "VRCDN",
    src: vrcdnLinks.hlsUrl,
    title: `VRCDN stream for ${label}`,
  };
}

function createWatchEmbed(link: EventWatchMediaLink, browserHostname: string | undefined): WatchEmbed | null {
  const vrcdnEmbed = createVrcdnEmbed(link.url, link.label);

  if (vrcdnEmbed !== null) {
    return vrcdnEmbed;
  }

  const url = parseHttpsUrl(link.url);

  if (!url) {
    return null;
  }

  return createYouTubeEmbed(url, link.label) ?? createTwitchEmbed(url, link.label, browserHostname);
}

function WatchFallback() {
  return (
    <div className="flex aspect-video min-h-64 items-center justify-center bg-[linear-gradient(135deg,var(--media),var(--surface-raised))] p-5 text-white">
      <div className="flex size-16 items-center justify-center rounded-control border border-white/30 bg-white/16 shadow-panel">
        <span
          aria-hidden="true"
          className="ml-1 h-0 w-0 border-y-[9px] border-l-[14px] border-y-transparent border-l-white"
        />
      </div>
    </div>
  );
}

function WatchEmbedFrame({ embed }: { embed: WatchEmbed }) {
  if (embed.kind === "hls") {
    return <WatchHlsVideo embed={embed} />;
  }

  if (embed.kind === "video") {
    return (
      <video
        className="aspect-video w-full bg-media"
        controls
        preload="metadata"
        src={embed.src}
        title={embed.title}
      />
    );
  }

  return (
    <iframe
      allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
      allowFullScreen
      className="aspect-video w-full bg-media"
      loading="lazy"
      referrerPolicy="strict-origin-when-cross-origin"
      sandbox="allow-same-origin allow-scripts allow-popups allow-presentation"
      src={embed.src}
      title={embed.title}
    />
  );
}

function WatchHlsVideo({ embed }: { embed: Extract<WatchEmbed, { kind: "hls" }> }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    let cancelled = false;
    let hls: { destroy: () => void } | null = null;
    setUnsupported(false);

    if (video.canPlayType("application/vnd.apple.mpegurl") || video.canPlayType("application/x-mpegURL")) {
      video.src = embed.src;

      return () => {
        video.removeAttribute("src");
        video.load();
      };
    }

    void import("hls.js")
      .then(({ default: Hls }) => {
        if (cancelled || !videoRef.current) {
          return;
        }

        if (!Hls.isSupported()) {
          setUnsupported(true);
          return;
        }

        const player = new Hls();
        player.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            setUnsupported(true);
          }
        });
        player.loadSource(embed.src);
        player.attachMedia(videoRef.current);
        hls = player;
      })
      .catch(() => {
        if (!cancelled) {
          setUnsupported(true);
        }
      });

    return () => {
      cancelled = true;
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [embed.src]);

  if (unsupported) {
    return <WatchFallback />;
  }

  return (
    <video
      ref={videoRef}
      className="aspect-video w-full bg-media"
      controls
      preload="metadata"
      title={embed.title}
    />
  );
}

export function EventWatchSurface({
  doorsOpenAt,
  endAt,
  enabled,
  mediaLinks,
  startAt,
}: {
  doorsOpenAt?: number;
  endAt?: number;
  enabled: boolean;
  mediaLinks: EventWatchMediaLink[];
  startAt: number;
}) {
  const browserHostname = useBrowserHostname();
  const currentTimestamp = useCurrentTimestamp();
  const primaryWatchLink = selectPrimaryWatchLink(mediaLinks);

  if (!enabled || !primaryWatchLink || !isInScheduledWatchWindow({ doorsOpenAt, endAt, now: currentTimestamp, startAt })) {
    return null;
  }

  const primaryWatchUrl = parseWatchOpenUrl(primaryWatchLink.url);

  if (!primaryWatchUrl) {
    return null;
  }

  const embed = createWatchEmbed(primaryWatchLink, browserHostname);

  return (
    <Card className="overflow-hidden" padding="none" surface="white">
      <div className="bg-media">
        {embed ? <WatchEmbedFrame embed={embed} /> : <WatchFallback />}
      </div>
      <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold tracking-[-0.02em]">{primaryWatchLink.label}</h2>
        <a
          className={cn(buttonVariants({ size: "sm", variant: "primary" }), "w-full sm:w-fit")}
          href={primaryWatchUrl.href}
          rel="noreferrer"
          target="_blank"
        >
          Open stream
        </a>
      </div>
    </Card>
  );
}
