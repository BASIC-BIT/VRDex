"use client";

import { type ReactNode, useEffect, useState } from "react";

import { VrcdnStreamPlayer } from "./vrcdn-stream-player";
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

type ProfileVrcdnStreamsProps = {
  children: ReactNode;
  initialLiveStates?: VrcdnLiveStates;
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
  children,
  initialLiveStates,
  profileSlug,
  streams,
  twitchContent,
}: ProfileVrcdnStreamsProps) {
  const [liveStates, setLiveStates] = useState<VrcdnLiveStates>(() =>
    mergeConfirmedVrcdnLiveStates({}, initialLiveStates ?? {}),
  );
  const streamIdentity = streams.map(({ streamId }) => streamId).join("\u0000");

  useEffect(() => {
    if (streams.length === 0) {
      return;
    }

    const controller = new AbortController();
    const allStreamIds = streamIdentity.split("\u0000");
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
      retryingStreamIds = new Set(allStreamIds);
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
  }, [profileSlug, streamIdentity, streams.length]);

  const liveStreams = streams.filter(({ streamId }) => liveStates[streamId] === "live");
  const hasWatchSurface = Boolean(twitchContent || liveStreams.length > 0);

  return (
    <div className={cn("grid gap-x-10", hasWatchSurface ? "lg:grid-cols-[minmax(0,1fr)_32rem]" : undefined)}>
      <div>{children}</div>

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
