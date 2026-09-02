"use client";

import { useEffect, useState } from "react";

import { VrcdnStreamPlayer } from "./vrcdn-stream-player";
import { CopyValueRow } from "@/components/ui/copy-value-row";
import {
  parseVrcdnLiveStates,
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
  initialLiveStates?: VrcdnLiveStates;
  profileSlug: string;
  streams: ProfileVrcdnStream[];
};

function responseStates(value: unknown): VrcdnLiveStates | null {
  if (typeof value !== "object" || value === null || !("states" in value)) {
    return null;
  }

  return parseVrcdnLiveStates(value.states);
}

export function ProfileVrcdnStreams({
  initialLiveStates,
  profileSlug,
  streams,
}: ProfileVrcdnStreamsProps) {
  const [liveStates, setLiveStates] = useState<VrcdnLiveStates>(initialLiveStates ?? {});

  useEffect(() => {
    if (initialLiveStates !== undefined || streams.length === 0) {
      return;
    }

    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const scheduleRetry = () => {
      retryTimer = setTimeout(() => void loadStates(2), vrcdnLiveRetryDelayMs);
    };

    const loadStates = async (attempt: 1 | 2) => {
      try {
        const response = await fetch(
          `/api/profile-live/${encodeURIComponent(profileSlug)}/vrcdn?attempt=${attempt}`,
          { cache: "no-store", signal: controller.signal },
        );

        if (!response.ok) {
          if (attempt === 1 && response.status >= 500) {
            scheduleRetry();
          }
          return;
        }

        const states = responseStates(await response.json());

        if (states === null) {
          if (attempt === 1) {
            scheduleRetry();
          }
          return;
        }

        setLiveStates(states);

        if (attempt === 1 && shouldRetryVrcdnLiveStates(states)) {
          scheduleRetry();
        }
      } catch {
        if (attempt === 1 && !controller.signal.aborted) {
          scheduleRetry();
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
  }, [initialLiveStates, profileSlug, streams.length]);

  return streams.map(({ label, pcUrl, questUrl, streamId }) => {
    const isLive = liveStates[streamId] === "live";

    return (
      <div className="pt-5" key={streamId}>
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
          <div className="flex items-center gap-3">
            <p className="font-medium">{label}</p>
            {isLive ? <span className="text-sm font-medium text-success">Live now</span> : null}
          </div>
        </div>
        {isLive ? (
          <div className="mb-4 overflow-hidden rounded-control border border-border">
            <VrcdnStreamPlayer
              src={questUrl}
              title={streams.length > 1 ? `${label} ${streamId}` : label}
            />
          </div>
        ) : null}
        <CopyValueRow label="Quest (MPEG-TS)" value={questUrl} />
        <CopyValueRow label="PC (RTSPT)" value={pcUrl} />
      </div>
    );
  });
}
