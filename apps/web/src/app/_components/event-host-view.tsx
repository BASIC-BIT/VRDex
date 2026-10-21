"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@convex-generated-api";

import { buttonVariants } from "@/components/ui/button";
import { CopyValueRow } from "@/components/ui/copy-value-row";
import { PageContainer, PageShell } from "@/components/ui/page-shell";
import { eventDjTarget, type DjTarget } from "@/lib/event-dj-target";
import { publicEventPath } from "@/lib/event-path";
import {
  parseSourceObservations,
  reportedSourceState,
  type SourceObservation,
} from "@/lib/event-source-observations";
import { eventLineupForDisplay, type PublicEvent } from "./event-public-page";
import { ViewerLocalEventTimeRange } from "./viewer-local-event-times";
import { VrcdnStreamPlayer } from "./vrcdn-stream-player";

export function EventHostView({ event: initialEvent }: { event: PublicEvent }) {
  const projection = useQuery(api.events.getHostBySlug, { slug: initialEvent.slug, communitySlug: initialEvent.communitySlug ?? '' });
  const event = projection === undefined ? initialEvent : projection;
  return event ? <EventHostContent event={event} /> : null;
}

type HostSourceProps = {
  target: DjTarget;
  observation?: SourceObservation;
  now: number;
  selected: boolean;
  previewing: boolean;
  onPreview: () => void;
};

function HostSource({ target, observation, now, selected, previewing, onPreview }: HostSourceProps) {
  const state = reportedSourceState(observation, now);
  const status = state === "live" ? "Live now" : state === "offline" ? "Offline" : state === "unavailable" ? "Unavailable" : "Unknown";
  const previewUrl = target.questUrl;

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium [overflow-wrap:anywhere]">
          {target.pcUrl ? `VRCDN · ${target.label}` : target.label}
          {selected ? " · Selected source" : ""}
        </span>
        <span className="text-muted" title={observation ? new Date(observation.observedAt).toISOString() : undefined}>
          {status}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {target.pcUrl && target.questUrl ? (
          <>
            <CopyValueRow actionOnly label="PC" value={target.pcUrl} />
            <CopyValueRow actionOnly label="Quest" value={target.questUrl} />
          </>
        ) : <CopyValueRow actionOnly label={target.label} value={target.url} />}
        {previewUrl ? (
          <button className={buttonVariants({ size: "sm", variant: "ghost" })} type="button" onClick={onPreview}>
            {previewing ? "Close preview" : "Preview"}
          </button>
        ) : (
          <a className={buttonVariants({ size: "sm", variant: "ghost" })} href={target.url} target="_blank" rel="noreferrer">Open</a>
        )}
        <details className="min-w-0 basis-full text-sm">
          <summary className="w-fit cursor-pointer text-muted">URLs</summary>
          <div className="mt-2 grid gap-2 [overflow-wrap:anywhere]">
            {target.pcUrl && target.questUrl ? (
              <><code className="text-xs">PC: {target.pcUrl}</code><code className="text-xs">Quest: {target.questUrl}</code></>
            ) : <code className="text-xs">{target.url}</code>}
          </div>
        </details>
      </div>
      {previewing && previewUrl ? (
        <div className="mt-4 overflow-hidden rounded-control border border-border">
          <VrcdnStreamPlayer src={previewUrl} title={target.label} initialMuted initialStarted />
        </div>
      ) : null}
    </div>
  );
}

export function EventHostContent({ event }: { event: PublicEvent }) {
  const [observations, setObservations] = useState<Record<string, SourceObservation>>({});
  const [now, setNow] = useState(0);
  const [preview, setPreview] = useState<{
    slotKey: string;
    sourceKey: string;
    performer: PublicEvent["slots"][number]["performer"];
  } | null>(null);
  const path = publicEventPath(event);
  const lineup = eventLineupForDisplay(event);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      setNow(Date.now());
      try {
        const response = await fetch(`${path}/host/status`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]) });
        if (response.ok) {
          const data = parseSourceObservations(await response.json());
          if (!cancelled) setObservations(data);
        }
      } catch { /* Links remain usable during provider failures. */ }
      finally { if (!cancelled) timer = setTimeout(() => void refresh(), 30_000); }
    };
    void refresh();
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
      clearInterval(clock);
    };
  }, [path]);

  return (
    <PageShell>
      <PageContainer className="py-6 sm:py-10">
        <Link className="text-sm text-muted hover:text-foreground" href={path ?? "/events"}>{event.title}</Link>
        <h1 className="text-3xl font-semibold">Host view</h1>
        <div className="grid gap-3">
          {lineup.map(row => {
            const slot = event.slots.find(slot => slot.playbackKey === row.key);
            const targets = [...new Map((row.performer?.outboundLinks ?? []).flatMap(link => {
              const target = eventDjTarget(link.url);
              return target ? [[target.key, target] as const] : [];
            })).values()];
            const selectedKey = slot?.stream ? `vrcdn:${slot.stream.streamId}` : undefined;
            const primary = targets.find(target => target.key === selectedKey) ?? targets.find(target => target.pcUrl) ?? targets[0];
            const alternatives = targets.filter(target => target.key !== primary?.key);
            const scheduleEnd = row.endAt ?? lineup.find(next => next.position > row.position && next.startAt !== undefined)?.startAt ?? event.endAt;
            const scheduled = now > 0 && row.startAt !== undefined && row.startAt <= now && scheduleEnd !== undefined && now < scheduleEnd;
            const renderSource = (target: DjTarget) => {
              const previewing = preview?.slotKey === row.key && preview.sourceKey === target.key && preview.performer === row.performer;
              return (
                <HostSource
                  key={target.key}
                  target={target}
                  observation={observations[target.key]}
                  now={now}
                  selected={target.key === selectedKey}
                  previewing={previewing}
                  onPreview={() => setPreview(previewing ? null : {
                    slotKey: row.key, sourceKey: target.key, performer: row.performer,
                  })}
                />
              );
            };

            return (
              <section key={row.key} className="min-w-0 rounded-panel border border-border bg-surface-strong p-4 sm:p-5">
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">{row.performer?.displayName ?? row.displayLabel}</h2>
                  {row.startAt !== undefined ? (
                    <span className="text-sm text-muted">
                      <ViewerLocalEventTimeRange startAt={row.startAt} endAt={row.endAt} />
                      {scheduled ? " · Scheduled now" : ""}
                    </span>
                  ) : null}
                </div>
                {row.roleLabel ? <p className="mb-3 text-sm text-muted">{row.roleLabel}</p> : null}
                {primary ? renderSource(primary) : <span className="text-sm text-muted">No links</span>}
                {alternatives.length ? (
                  <details className="mt-3 border-t border-border pt-3" onToggle={event => {
                    if (!event.currentTarget.open && preview?.slotKey === row.key && alternatives.some(target => target.key === preview.sourceKey)) setPreview(null);
                  }}>
                    <summary className="cursor-pointer text-sm text-muted">Other links</summary>
                    <div className="mt-3 grid gap-4">{alternatives.map(renderSource)}</div>
                  </details>
                ) : null}
              </section>
            );
          })}
        </div>
      </PageContainer>
    </PageShell>
  );
}
