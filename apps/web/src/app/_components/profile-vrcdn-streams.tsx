"use client";

import { ExternalLink } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePostHog } from "posthog-js/react";

import { VrcdnStreamPlayer } from "./vrcdn-stream-player";
import { buttonVariants } from "@/components/ui/button";
import { VerifiedTrustMark } from "@/components/ui/verified-trust-mark";
import { SectionHeading } from "@/components/ui/card";
import { CopyValueRow } from "@/components/ui/copy-value-row";
import { cn } from "@/lib/cn";
import {
  parseVrcdnLiveStates,
  type VrcdnLiveStates,
} from "@/lib/vrcdn-live";
import { VrcdnLiveHeartbeat } from "@/lib/vrcdn-live-heartbeat";
import {
  applyVrcdnLiveStates,
  createVrcdnLiveLifecycles,
  type VrcdnLiveLifecycles,
} from "@/lib/vrcdn-live-lifecycle";
import { captureProductEvent } from "@/lib/posthog";

export type ProfileVrcdnStream = {
  claimable: boolean;
  key: string;
  label: string;
  pcUrl: string;
  previewUrl: string;
  questUrl: string;
  streamId: string;
};

type ProfileVrcdnLink = {
  verified?: boolean;
  href: string;
  key: string;
  label: string;
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
  const posthog = usePostHog();
  const claimableStreamIds = useMemo(() => [
    ...new Set(streams.filter(({ claimable }) => claimable).map(({ streamId }) => streamId)),
  ], [streams]);
  const streamIdentity = claimableStreamIds.join("\u0000");
  const [lifecycles, setLifecycles] = useState<VrcdnLiveLifecycles>(() =>
    createVrcdnLiveLifecycles(claimableStreamIds, initialLiveStates ?? {}, Date.now()),
  );
  const lifecyclesRef = useRef(lifecycles);
  const heartbeatRef = useRef<VrcdnLiveHeartbeat>(null);
  const [activePlaybackStreamIds, setActivePlaybackStreamIds] = useState<Set<string>>(
    () => new Set(),
  );
  const conflictEpisodesRef = useRef(new Set<string>());

  useEffect(() => {
    if (claimableStreamIds.length === 0) {
      return;
    }

    const heartbeat = new VrcdnLiveHeartbeat({
      probe: async (signal) => {
        let states: VrcdnLiveStates = {};

        try {
          const response = await fetch(
            `/api/profile-live/${encodeURIComponent(profileSlug)}/vrcdn`,
            { cache: "no-store", signal },
          );

          if (response.ok) {
            const parsed = responseStates(await response.json());
            if (parsed !== null) {
              states = parsed;
            }
          }
        } catch {
          if (signal.aborted) {
            return { hasUnavailable: false };
          }
        }

        const result = applyVrcdnLiveStates(
          lifecyclesRef.current,
          claimableStreamIds,
          states,
          Date.now(),
        );
        lifecyclesRef.current = result.lifecycles;
        setLifecycles(result.lifecycles);

        return {
          hasUnavailable: result.hasUnavailable,
          ...(result.pendingOfflineDelayMs === undefined
            ? {}
            : { pendingOfflineDelayMs: result.pendingOfflineDelayMs }),
        };
      },
    });
    heartbeatRef.current = heartbeat;
    heartbeat.start();

    return () => {
      if (heartbeatRef.current === heartbeat) {
        heartbeatRef.current = null;
      }
      heartbeat.stop();
    };
  }, [claimableStreamIds, profileSlug, streamIdentity]);

  useEffect(() => {
    heartbeatRef.current?.setPlaybackActive(activePlaybackStreamIds.size > 0);
  }, [activePlaybackStreamIds]);

  useEffect(() => {
    for (const streamId of claimableStreamIds) {
      const lifecycle = lifecycles[streamId];
      const playbackActive = activePlaybackStreamIds.has(streamId);
      const conflict = lifecycle?.presentation === "offline" && playbackActive;

      if (conflict && !conflictEpisodesRef.current.has(streamId)) {
        conflictEpisodesRef.current.add(streamId);
        captureProductEvent(posthog, "media_state_anomaly_detected", {
          anomaly_kind: "confirmed_offline_while_playing",
          provider: "vrcdn",
          surface: "profile",
        });
      } else if (lifecycle?.presentation === "live" || !playbackActive) {
        conflictEpisodesRef.current.delete(streamId);
      }
    }
  }, [activePlaybackStreamIds, claimableStreamIds, lifecycles, posthog]);

  const handlePlaybackActiveChange = useCallback((streamId: string, active: boolean) => {
    setActivePlaybackStreamIds((current) => {
      const next = new Set(current);
      if (active) {
        next.add(streamId);
      } else {
        next.delete(streamId);
      }
      return next;
    });
  }, []);

  const requestSanityCheck = useCallback(() => {
    heartbeatRef.current?.requestSanityCheck();
  }, []);

  const hasLinks = links.length > 0 || discordHandles.length > 0;
  const hasWatchSurface = Boolean(twitchContent || streams.length > 0);

  return (
    <div className={cn("grid gap-x-10", hasWatchSurface ? "lg:grid-cols-[minmax(0,1fr)_32rem]" : undefined)}>
      <div>
        {hasLinks ? (
          <section className="py-8">
            <SectionHeading>Links</SectionHeading>
            {links.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {links.map((link) => (
                  <a
                    className={cn(buttonVariants({ variant: "secondary" }), "gap-2")}
                    href={link.href}
                    key={link.key}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {link.label}
                    {link.verified ? <VerifiedTrustMark label="Verified VRChat connection" /> : null}
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
          {streams.map(({ claimable, key, label, pcUrl, previewUrl, questUrl, streamId }, index) => {
            const lifecycle = lifecycles[streamId];
            const live = claimable && lifecycle?.presentation === "live";
            const playbackActive = activePlaybackStreamIds.has(streamId);
            const showPlayer = claimable && (
              live || lifecycle?.status === "pending_offline" || playbackActive
            );
            const title = streams.length > 1 ? `${label} ${streamId}` : label;

            return (
              <div className={cn("pt-5", index > 0 && "mt-5 border-t border-border")} key={key}>
                <div className="flex items-center gap-3 pb-3">
                  <p className="font-medium">{label}</p>
                  {live ? <span className="text-sm font-medium text-success">Live now</span> : null}
                </div>
                <a
                  aria-label={`Open preview for ${title}`}
                  className={cn(buttonVariants({ variant: "secondary" }), "mb-4 gap-2")}
                  href={previewUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open preview
                  <ExternalLink aria-hidden="true" className="size-3.5" />
                </a>
                <CopyValueRow label="Quest (MPEG-TS)" value={questUrl} />
                <CopyValueRow label="PC (RTSPT)" value={pcUrl} />
                {showPlayer ? (
                  <div className="mt-4 overflow-hidden rounded-control border border-border">
                    <VrcdnStreamPlayer
                      onHealthSignal={requestSanityCheck}
                      onPlaybackActiveChange={(active) => handlePlaybackActiveChange(streamId, active)}
                      src={questUrl}
                      title={title}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </aside>
      ) : null}
    </div>
  );
}
