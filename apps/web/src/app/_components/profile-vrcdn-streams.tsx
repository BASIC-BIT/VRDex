"use client";

import { ExternalLink } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { VrcdnStreamPlayer } from "./vrcdn-stream-player";
import { buttonVariants } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/card";
import { CopyValueRow } from "@/components/ui/copy-value-row";
import { cn } from "@/lib/cn";
import {
  mergeConfirmedVrcdnLiveStates,
  parseVrcdnLiveStates,
  removeVrcdnLiveStates,
  shouldRetryVrcdnLiveStates,
  type VrcdnLiveStates,
  vrcdnLiveRetryDelayMs,
} from "@/lib/vrcdn-live";

export type ProfileVrcdnStream = {
  label: string;
  pcUrl: string;
  questUrl: string;
  streamId: string;
};

type ProfileVrcdnLink = {
  href: string;
  key: string;
  label: string;
  streamId?: string;
};

type ProfileDiscordHandle = {
  handle: string;
  key: string;
};

type ProfileVrcdnStreamsProps = {
  discordHandles: ProfileDiscordHandle[];
  initialLiveStates?: VrcdnLiveStates;
  links: ProfileVrcdnLink[];
  profileSlug: string;
  streams: ProfileVrcdnStream[];
  twitchContent?: ReactNode;
};

function responseStates(value: unknown): VrcdnLiveStates | null {
  if (typeof value !== "object" || value === null || !("states" in value)) {
    return null;
  }

  return parseVrcdnLiveStates(value.states);
}

export function ProfileVrcdnStreams({
  discordHandles,
  initialLiveStates,
  links,
  profileSlug,
  streams,
  twitchContent,
}: ProfileVrcdnStreamsProps) {
  const [liveStates, setLiveStates] = useState<VrcdnLiveStates>(() =>
    mergeConfirmedVrcdnLiveStates({}, initialLiveStates ?? {}),
  );
  const streamIdentity = streams.map(({ streamId }) => streamId).join("\u0000");
  const initialConfirmedIdentity = Object.entries(initialLiveStates ?? {})
    .filter(([, state]) => state !== "unavailable")
    .map(([streamId]) => streamId)
    .sort()
    .join("\u0000");

  useEffect(() => {
    if (streams.length === 0) {
      return;
    }

    const controller = new AbortController();
    const allStreamIds = streamIdentity.split("\u0000");
    const initiallyConfirmedStreamIds = new Set(
      initialConfirmedIdentity ? initialConfirmedIdentity.split("\u0000") : [],
    );
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryingStreamIds = new Set<string>();

    const scheduleRetry = () => {
      retryTimer = setTimeout(() => void loadStates(2), vrcdnLiveRetryDelayMs);
    };

    const clearAfterFinalFailure = (attempt: 1 | 2) => {
      if (attempt === 2) {
        setLiveStates((current) => removeVrcdnLiveStates(current, retryingStreamIds));
      }
    };

    const scheduleFullRetry = () => {
      retryingStreamIds = new Set(
        allStreamIds.filter((streamId) => !initiallyConfirmedStreamIds.has(streamId)),
      );
      scheduleRetry();
    };

    const loadStates = async (attempt: 1 | 2) => {
      try {
        const response = await fetch(
          `/api/profile-live/${encodeURIComponent(profileSlug)}/vrcdn?attempt=${attempt}`,
          { cache: "no-store", signal: controller.signal },
        );

        if (!response.ok) {
          if (attempt === 1 && response.status >= 500) {
            scheduleFullRetry();
          } else {
            clearAfterFinalFailure(attempt);
          }
          return;
        }

        const states = responseStates(await response.json());

        if (states === null) {
          if (attempt === 1) {
            scheduleFullRetry();
          } else {
            clearAfterFinalFailure(attempt);
          }
          return;
        }

        setLiveStates((current) =>
          mergeConfirmedVrcdnLiveStates(attempt === 1 ? current : {}, states),
        );

        if (attempt === 1 && shouldRetryVrcdnLiveStates(states)) {
          retryingStreamIds = new Set(
            Object.entries(states)
              .filter(([, state]) => state === "unavailable")
              .map(([streamId]) => streamId),
          );
          scheduleRetry();
        }
      } catch {
        if (!controller.signal.aborted) {
          if (attempt === 1) {
            scheduleFullRetry();
          } else {
            clearAfterFinalFailure(attempt);
          }
        }
      }
    };

    void loadStates(1);

    return () => {
      controller.abort();
      if (retryTimer !== undefined) {
        clearTimeout(retryTimer);
      }
    };
  }, [initialConfirmedIdentity, profileSlug, streamIdentity, streams.length]);

  const liveStreams = streams.filter(({ streamId }) => liveStates[streamId] === "live");
  const visibleLinks = links.filter(({ streamId }) => !streamId || liveStates[streamId] !== "live");
  const hasLinks = visibleLinks.length > 0 || discordHandles.length > 0;
  const hasWatchSurface = Boolean(twitchContent || liveStreams.length > 0);

  return (
    <div className={cn("grid gap-x-10", hasWatchSurface ? "lg:grid-cols-[minmax(0,1fr)_32rem]" : undefined)}>
      <div>
        {hasLinks ? (
          <section className="py-8">
            <SectionHeading>Links</SectionHeading>
            {visibleLinks.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {visibleLinks.map((link) => (
                  <a
                    className={cn(buttonVariants({ variant: "secondary" }), "gap-2")}
                    href={link.href}
                    key={link.key}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {link.label}
                    <ExternalLink aria-hidden="true" className="size-3.5" />
                  </a>
                ))}
              </div>
            ) : null}
            {discordHandles.map(({ handle, key }) => (
              <CopyValueRow compact className="mt-4" key={key} label="Discord" value={handle} />
            ))}
          </section>
        ) : null}
      </div>

      {hasWatchSurface ? (
        <aside className="border-t border-border py-8 lg:border-t-0 lg:border-l lg:pl-8">
          <SectionHeading>Watch</SectionHeading>
          {twitchContent}
          {liveStreams.map(({ label, pcUrl, questUrl, streamId }) => (
            <div className="pt-5" key={streamId}>
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
                <div className="flex items-center gap-3">
                  <p className="font-medium">{label}</p>
                  <span className="text-sm font-medium text-success">Live now</span>
                </div>
              </div>
              <div className="mb-4 overflow-hidden rounded-control border border-border">
                <VrcdnStreamPlayer
                  src={questUrl}
                  title={liveStreams.length > 1 ? `${label} ${streamId}` : label}
                />
              </div>
              <CopyValueRow label="Quest (MPEG-TS)" value={questUrl} />
              <CopyValueRow label="PC (RTSPT)" value={pcUrl} />
            </div>
          ))}
        </aside>
      ) : null}
    </div>
  );
}
