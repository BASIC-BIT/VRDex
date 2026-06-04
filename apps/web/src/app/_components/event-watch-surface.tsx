"use client";

import { useSyncExternalStore } from "react";

import { buttonVariants } from "@/components/ui/button";
import { Card, Eyebrow } from "@/components/ui/card";
import { cn } from "@/lib/cn";

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
      provider: "Twitch" | "VRCDN" | "YouTube";
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

function isVrcdnHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();

  if (!["panel.vrcdn.live", "status.vrcdn.live", "wiki.vrcdn.live"].includes(normalized) && normalized.endsWith(".vrcdn.live")) {
    return true;
  }

  return normalized === "vrcdn.live";
}

function createVrcdnEmbed(url: URL, label: string): WatchEmbed | null {
  if (!isVrcdnHost(url.hostname)) {
    return null;
  }

  if (/\.(mp4|ogg|webm|m3u8)$/i.test(url.pathname)) {
    return {
      kind: "video",
      provider: "VRCDN",
      src: url.href,
      title: `VRCDN video for ${label}`,
    };
  }

  return {
    kind: "iframe",
    provider: "VRCDN",
    src: url.href,
    title: `VRCDN player for ${label}`,
  };
}

function createWatchEmbed(link: EventWatchMediaLink, browserHostname: string | undefined): WatchEmbed | null {
  const url = parseHttpsUrl(link.url);

  if (!url) {
    return null;
  }

  return createYouTubeEmbed(url, link.label) ?? createTwitchEmbed(url, link.label, browserHostname) ?? createVrcdnEmbed(url, link.label);
}

function WatchFallback({ link }: { link: EventWatchMediaLink }) {
  return (
    <div className="flex h-full min-h-64 flex-col justify-end bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,0.35),transparent_32%),linear-gradient(135deg,#111827,#312e81_58%,#0f172a)] p-5 text-white">
      <p className="font-mono text-xs tracking-[0.22em] text-white/68 uppercase">Watch link</p>
      <h2 className="mt-4 max-w-xl text-3xl font-semibold tracking-[-0.04em]">{link.label}</h2>
    </div>
  );
}

function WatchEmbedFrame({ embed }: { embed: WatchEmbed }) {
  if (embed.kind === "video") {
    return (
      <video
        className="aspect-video w-full bg-slate-950"
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
      className="aspect-video w-full bg-slate-950"
      loading="lazy"
      referrerPolicy="strict-origin-when-cross-origin"
      sandbox="allow-same-origin allow-scripts allow-popups allow-presentation"
      src={embed.src}
      title={embed.title}
    />
  );
}

export function EventWatchSurface({
  doorsOpenAt,
  endAt,
  mediaLinks,
  startAt,
}: {
  doorsOpenAt?: number;
  endAt?: number;
  mediaLinks: EventWatchMediaLink[];
  startAt: number;
}) {
  const browserHostname = useBrowserHostname();
  const currentTimestamp = useCurrentTimestamp();
  const primaryWatchLink = selectPrimaryWatchLink(mediaLinks);

  if (!primaryWatchLink || !isInScheduledWatchWindow({ doorsOpenAt, endAt, now: currentTimestamp, startAt })) {
    return null;
  }

  const primaryWatchUrl = parseHttpsUrl(primaryWatchLink.url);

  if (!primaryWatchUrl) {
    return null;
  }

  const embed = createWatchEmbed(primaryWatchLink, browserHostname);

  return (
    <Card className="overflow-hidden" padding="none" surface="white">
      <div className="grid items-stretch gap-0 lg:grid-cols-[1.35fr_0.65fr]">
        <div className="bg-slate-950">
          {embed ? <WatchEmbedFrame embed={embed} /> : <WatchFallback link={primaryWatchLink} />}
        </div>
        <div className="flex flex-col justify-between gap-6 px-5 py-6 sm:px-6">
          <div>
            <Eyebrow>Watch now</Eyebrow>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">{primaryWatchLink.label}</h2>
          </div>
          <a
            className={cn(buttonVariants({ size: "lg", variant: "primary" }), "w-full sm:w-fit")}
            href={primaryWatchUrl.href}
            rel="noreferrer"
            target="_blank"
          >
            Open watch link
          </a>
        </div>
      </div>
    </Card>
  );
}
